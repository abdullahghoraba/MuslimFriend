package com.muslimfriend.app.tasmee

import android.Manifest
import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
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
 * what it hears as it goes ("partial") and after each pause ("final"). Android stops listening after a silence, so it
 * starts again until the reader stops. Events: partial {text}, final {text}, error {code}, state {listening}.
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

    @PluginMethod
    fun available(call: PluginCall) {
        call.resolve(JSObject().put("available", SpeechRecognizer.isRecognitionAvailable(context)))
    }

    @PluginMethod
    fun start(call: PluginCall) {
        language = call.getString("language") ?: "ar-SA"
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
            putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            // Reciters pause between ayat and draw out the long vowels: wait longer before deciding they finished.
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS, 2500L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_POSSIBLY_COMPLETE_SILENCE_LENGTH_MILLIS, 2000L)
            putExtra(RecognizerIntent.EXTRA_SPEECH_INPUT_MINIMUM_LENGTH_MILLIS, 15000L)
        }
        r.startListening(intent)
    }

    private fun text(results: Bundle?): String =
        results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull() ?: ""

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}
        override fun onEvent(eventType: Int, params: Bundle?) {}

        override fun onPartialResults(partialResults: Bundle?) {
            val t = text(partialResults)
            if (t.isNotBlank()) notifyListeners("partial", JSObject().put("text", t))
        }

        override fun onResults(results: Bundle?) {
            val t = text(results)
            if (t.isNotBlank()) notifyListeners("final", JSObject().put("text", t))
            // Keep listening: the next ayah.
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
