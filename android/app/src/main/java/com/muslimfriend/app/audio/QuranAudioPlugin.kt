package com.muslimfriend.app.audio

import android.os.Handler
import android.os.Looper
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/** Bridge between the web app's players (Listen and the mushaf) and the native [AudioEngine]. */
@CapacitorPlugin(name = "QuranAudio")
class QuranAudioPlugin : Plugin() {
    private val main = Handler(Looper.getMainLooper())

    override fun load() {
        main.post { AudioEngine.listener = { notifyListeners("state", JSObject.fromJSONObject(it)) } }
    }

    override fun handleOnDestroy() {
        main.post { AudioEngine.listener = null }
    }

    /** Runs [block] on the player's thread and resolves [call] after it. */
    private fun onMain(call: PluginCall, block: () -> Unit) {
        main.post {
            try { block(); call.resolve() } catch (e: Exception) { call.reject(e.message ?: "Audio error") }
        }
    }

    @PluginMethod
    fun play(call: PluginCall) {
        val arr = call.getArray("items") ?: return call.reject("items is required")
        val items = (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            AudioItem(o.getString("url"), o.optString("title"), o.optString("artist"), o.optString("album"), o.optString("group", i.toString()))
        }
        if (items.isEmpty()) return call.reject("items is empty")
        onMain(call) {
            AudioEngine.play(
                context, call.getString("session") ?: "", items, call.getInt("index") ?: 0,
                ((call.getDouble("position") ?: 0.0) * 1000).toLong(), call.getString("repeat") ?: "off",
                (call.getFloat("speed") ?: 1f).coerceIn(0.25f, 4f), call.getBoolean("live") ?: false,
            )
        }
    }

    @PluginMethod fun toggle(call: PluginCall) = onMain(call) { AudioEngine.toggle() }
    @PluginMethod fun stop(call: PluginCall) = onMain(call) { AudioEngine.stop() }
    @PluginMethod fun next(call: PluginCall) = onMain(call) { AudioEngine.next() }
    @PluginMethod fun previous(call: PluginCall) = onMain(call) { AudioEngine.previous() }
    @PluginMethod fun seek(call: PluginCall) = onMain(call) { AudioEngine.seek(((call.getDouble("position") ?: 0.0) * 1000).toLong()) }
    @PluginMethod fun setRepeat(call: PluginCall) = onMain(call) { AudioEngine.setRepeat(call.getString("repeat") ?: "off") }
    @PluginMethod fun setSpeed(call: PluginCall) = onMain(call) { AudioEngine.setSpeed((call.getFloat("speed") ?: 1f).coerceIn(0.25f, 4f)) }
    @PluginMethod fun setSleep(call: PluginCall) = onMain(call) { AudioEngine.setSleep(call.getInt("minutes") ?: 0) }

    @PluginMethod
    fun getState(call: PluginCall) { main.post { call.resolve(JSObject.fromJSONObject(AudioEngine.state())) } }
}
