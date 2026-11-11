package com.alunsbillah.app.tasmee

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * Tasmee' with the phone's own speech recognition (free, no download): listens continuously in Arabic and reports
 * what it hears as it goes ("partial") and after each pause ("final"), each with the recogniser's alternatives (up to
 * 5) so the app can take the one that fits the ayat. On Android 13+ it runs a segmented session (one long session
 * that reports each phrase, so no words are lost while the recogniser restarts) and is biased toward the ayat being
 * recited. Older phones stop after a silence, so it starts again until the reader stops.
 * Events: partial {text, alternatives}, final {text, alternatives}, level {level 0..1}, error {code}, state {listening}.
 */
@CapacitorPlugin(
    name = "Speech",
    permissions = [Permission(alias = "microphone", strings = [Manifest.permission.RECORD_AUDIO])],
)
class SpeechPlugin : Plugin() {
    private val main = Handler(Looper.getMainLooper())
    private var recognizer: SpeechRecognizer? = null
    private var listening = false
    private var language = "ar-SA"
    private var bias: ArrayList<String> = arrayListOf()
    private var lastLevel = 0L

    @PluginMethod
    fun available(call: PluginCall) {
        call.resolve(JSObject().put("available", SpeechRecognizer.isRecognitionAvailable(context)))
    }

    @PluginMethod
    fun start(call: PluginCall) {
        language = call.getString("language") ?: "ar-SA"
        bias = ArrayList(call.getArray("bias")?.toList<String>()?.take(100) ?: emptyList())
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            requestPermissionForAlias("microphone", call, "afterPermission")
            return
        }
        begin(call)
    }

    @PermissionCallback
    private fun afterPermission(call: PluginCall) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) begin(call)
        else call.reject("Microphone permission denied", "DENIED")
    }

    private fun begin(call: PluginCall) {
        if (!SpeechRecognizer.isRecognitionAvailable(context)) return call.reject("Speech recognition unavailable", "UNAVAILABLE")
        main.post {
            listening = true
            listen()
            notifyListeners("state", JSObject().put("listening", true))
            call.resolve()
        }
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        main.post {
            listening = false
            recognizer?.stopListening()
            recognizer?.destroy()
            recognizer = null
            notifyListeners("state", JSObject().put("listening", false))
            call.resolve()
        }
    }

    override fun handleOnDestroy() {
        main.post {
            listening = false
            recognizer?.destroy()
            recognizer = null
        }
    }

    private fun listen() {
        if (!listening) return
        val r = recognizer ?: SpeechRecognizer.createSpeechRecognizer(context).also {
            it.setRecognitionListener(listener)
            recognizer = it
        }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, language)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, language)
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 5)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                // One session that reports each phrase (onSegmentResults) and ends only after a long silence.
                putExtra(RecognizerIntent.EXTRA_SEGMENTED_SESSION, RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS)
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 30000L)
                if (bias.isNotEmpty()) putStringArrayListExtra(RecognizerIntent.EXTRA_BIASING_STRINGS, bias)
            } else {
                // Reciters pause between ayat and draw out the long vowels: wait longer before deciding they finished.
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L)
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2000L)
                putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 15000L)
            }
        }
        r.startListening(intent)
    }

    /** {text, alternatives}: the best guess and all of them (the app chooses by the ayat), or null if nothing. */
    private fun payload(results: Bundle?): JSObject? {
        val all = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.filter { it.isNotBlank() } ?: return null
        if (all.isEmpty()) return null
        return JSObject().put("text", all[0]).put("alternatives", JSArray(all))
    }

    private fun final(results: Bundle?) {
        payload(results)?.let { notifyListeners("final", it) }
    }

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {
            val now = System.currentTimeMillis()
            if (now - lastLevel < 120) return
            lastLevel = now
            // About -2 dB (quiet) to 10 dB (loud speech).
            notifyListeners("level", JSObject().put("level", ((rmsdB + 2f) / 12f).coerceIn(0f, 1f).toDouble()))
        }
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onEvent(eventType: Int, params: Bundle?) {}

        override fun onPartialResults(partialResults: Bundle?) {
            payload(partialResults)?.let { notifyListeners("partial", it) }
        }

        override fun onResults(results: Bundle?) {
            final(results)
            // Keep listening: the next ayah.
            main.postDelayed({ listen() }, 50)
        }

        // Segmented session (Android 13+): a phrase, then the session goes on.
        override fun onSegmentResults(segmentResults: Bundle) {
            final(segmentResults)
        }

        override fun onEndOfSegmentedSession() {
            main.postDelayed({ listen() }, 50)
        }

        override fun onError(error: Int) {
            when (error) {
                // Silence or nothing understood: just listen again.
                SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> main.postDelayed({ listen() }, 50)
                SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> main.postDelayed({ listen() }, 300)
                else -> {
                    notifyListeners("error", JSObject().put("code", error))
                    if (listening && error != SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS) {
                        recognizer?.destroy()
                        recognizer = null
                        main.postDelayed({ listen() }, 500)
                    }
                }
            }
        }
    }
}
