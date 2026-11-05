package com.muslimfriend.app.overlay

import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.speech.tts.Voice
import android.util.Log
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.Locale
import kotlin.math.sqrt

/**
 * Speaks the app's reminders in a man's voice. Phones do not say which of their voices is a man's (Google's names
 * are codes like "ar-xa-x-ard-local"), so the first time a language is spoken each installed voice for it says the
 * sentence into a file, its pitch is measured (a man's voice is about 85-155 Hz, a woman's 165-255 Hz), and the
 * deepest is kept for that engine and language. When the phone has no man's voice, the deepest one is lowered.
 */
object MaleVoice {
    private const val TAG = "MaleVoice"
    private const val PREFS = "tts-male-voice"
    private const val MALE_HZ = 190.0
    private const val LOWERED_PITCH = 0.78f

    /** Sets the man's voice (and pitch) on [tts] for [locale], measuring the voices once; then calls [done]. */
    fun apply(context: Context, tts: TextToSpeech, locale: Locale, text: String, handler: Handler, attempt: Int = 0, done: () -> Unit) {
        val voices = candidates(tts, locale)
        if (voices.isEmpty()) {
            // Right after the engine starts its voice list can still be empty: ask again shortly.
            if (attempt < 4) handler.postDelayed({ apply(context, tts, locale, text, handler, attempt + 1, done) }, 300) else done()
            return
        }
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val key = "${tts.defaultEngine}|${locale.language}|${voices.joinToString(",") { it.name }.hashCode()}"
        prefs.getString(key, null)?.split('|')?.let { saved ->
            val voice = voices.firstOrNull { it.name == saved[0] }
            if (voice != null) {
                tts.voice = voice
                tts.setPitch(saved.getOrNull(1)?.toFloatOrNull() ?: 1f)
                done(); return
            }
        }
        // A name that says it (some engines do: "...-male", Samsung's "SMTm..").
        voices.firstOrNull { male(it.name) }?.let { voice ->
            tts.voice = voice; tts.setPitch(1f)
            prefs.edit().putString(key, "${voice.name}|1").apply()
            done(); return
        }
        // Otherwise measure them (even a single voice: it is lowered when it is a woman's).
        val sample = text.ifBlank { "الله أكبر" }
        val pitches = HashMap<String, Double>()
        val dir = File(context.cacheDir, "tts-probe").apply { mkdirs() }
        var finished = false
        fun finish() {
            if (finished) return
            finished = true
            dir.listFiles()?.forEach { it.delete() }
            val best = voices.filter { pitches[it.name] != null }.minByOrNull { pitches[it.name]!! }
            if (best == null) { done(); return }
            val hz = pitches[best.name]!!
            val pitch = if (hz > MALE_HZ) LOWERED_PITCH else 1f
            Log.i(TAG, "voices ${pitches.entries.joinToString { "${it.key}=${it.value.toInt()}Hz" }}; chose ${best.name} pitch $pitch")
            runCatching { tts.voice = best; tts.setPitch(pitch) }
            prefs.edit().putString(key, "${best.name}|$pitch").apply()
            done()
        }
        // Never keep the reminder waiting long: speak with whatever is known after 10 s.
        handler.postDelayed({ finish() }, 10_000)
        val list = voices.take(8)
        fun probe(i: Int) {
            if (finished) return
            if (i >= list.size) { finish(); return }
            val voice = list[i]
            val file = File(dir, "v$i.wav")
            tts.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                override fun onStart(id: String?) {}
                override fun onDone(id: String?) {
                    handler.post {
                        if (id == "probe$i") {
                            runCatching { pitchOf(file) }.getOrNull()?.let { pitches[voice.name] = it }
                            probe(i + 1)
                        }
                    }
                }
                @Deprecated("Deprecated in Java")
                override fun onError(id: String?) { handler.post { if (id == "probe$i") probe(i + 1) } }
            })
            val ok = runCatching {
                tts.voice = voice
                tts.setPitch(1f)
                tts.synthesizeToFile(sample, Bundle(), file, "probe$i") == TextToSpeech.SUCCESS
            }.getOrDefault(false)
            if (!ok) handler.post { probe(i + 1) }
        }
        probe(0)
    }

    private fun male(name: String): Boolean {
        val n = name.lowercase(Locale.ROOT)
        return (Regex("(^|[^a-z])male") in n && "female" !in n) || Regex("smtm\\d") in n
    }

    /** The installed voices of the language: the offline ones, or the online ones when the phone has none. */
    private fun candidates(tts: TextToSpeech, locale: Locale): List<Voice> = runCatching {
        val all = tts.voices.orEmpty().filter { v ->
            v.locale.language == locale.language && TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED !in v.features.orEmpty()
        }.sortedBy { it.name }
        Log.i(TAG, "voices for ${locale.language}: ${all.joinToString { it.name }}")
        all.filter { !it.isNetworkConnectionRequired }.ifEmpty { all }
    }.getOrDefault(emptyList())

    /** Median pitch (Hz) of the voiced parts of a 16-bit PCM WAV file, or null. */
    internal fun pitchOf(file: File): Double? {
        val (rate, samples) = readWav(file) ?: return null
        return medianPitch(samples, rate)
    }

    internal fun medianPitch(x: FloatArray, rate: Int): Double? {
        val frame = (rate * 0.04).toInt()
        val hop = (rate * 0.02).toInt()
        if (x.size < frame * 3) return null
        val energies = ArrayList<Double>()
        var start = 0
        while (start + frame <= x.size) {
            var e = 0.0
            for (i in start until start + frame) e += x[i] * x[i]
            energies.add(sqrt(e / frame)); start += hop
        }
        val loud = (energies.maxOrNull() ?: return null) * 0.3
        val minLag = rate / 350
        val maxLag = rate / 70
        val found = ArrayList<Double>()
        energies.forEachIndexed { f, e ->
            if (e < loud) return@forEachIndexed
            val s = f * hop
            if (s + frame + maxLag > x.size) return@forEachIndexed
            var e0 = 0.0
            for (i in s until s + frame) e0 += x[i] * x[i]
            var bestLag = 0; var best = 0.0
            for (lag in minLag..maxLag) {
                var c = 0.0; var el = 0.0
                for (i in s until s + frame) { c += x[i] * x[i + lag]; el += x[i + lag] * x[i + lag] }
                val r = c / sqrt(e0 * el + 1e-12)
                if (r > best) { best = r; bestLag = lag }
            }
            // Prefer the fundamental over its multiples: the shortest lag nearly as good as the best.
            if (best > 0.6) {
                var lag = bestLag
                for (div in 4 downTo 2) {
                    val l = bestLag / div
                    if (l < minLag) continue
                    var c = 0.0; var el = 0.0
                    for (i in s until s + frame) { c += x[i] * x[i + l]; el += x[i + l] * x[i + l] }
                    if (c / sqrt(e0 * el + 1e-12) > best * 0.9) { lag = l; break }
                }
                found.add(rate.toDouble() / lag)
            }
        }
        if (found.size < 5) return null
        found.sort()
        return found[found.size / 2]
    }

    private fun readWav(file: File): Pair<Int, FloatArray>? {
        RandomAccessFile(file, "r").use { f ->
            if (f.length() < 44) return null
            val head = ByteArray(12); f.readFully(head)
            if (String(head, 0, 4) != "RIFF" || String(head, 8, 4) != "WAVE") return null
            var rate = 0; var bits = 0; var channels = 1
            while (f.filePointer + 8 <= f.length()) {
                val chunk = ByteArray(8); f.readFully(chunk)
                val id = String(chunk, 0, 4)
                val size = ByteBuffer.wrap(chunk, 4, 4).order(ByteOrder.LITTLE_ENDIAN).int.toLong() and 0xffffffffL
                if (id == "fmt ") {
                    val fmt = ByteArray(size.toInt().coerceAtMost(64)); f.readFully(fmt)
                    val b = ByteBuffer.wrap(fmt).order(ByteOrder.LITTLE_ENDIAN)
                    channels = b.getShort(2).toInt(); rate = b.getInt(4); bits = b.getShort(14).toInt()
                    f.seek(f.filePointer + size - fmt.size)
                } else if (id == "data") {
                    if (bits != 16 || rate <= 0 || channels < 1) return null
                    // Some engines write 0 or a huge size while streaming; read to the end of the file then.
                    val n = (if (size in 1..(f.length() - f.filePointer)) size else f.length() - f.filePointer).toInt()
                    val bytes = ByteArray(n); f.readFully(bytes)
                    val b = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN)
                    val frames = n / (2 * channels)
                    return rate to FloatArray(frames) { b.getShort(it * 2 * channels) / 32768f }
                } else f.seek(f.filePointer + size + (size and 1))
            }
        }
        return null
    }
}
