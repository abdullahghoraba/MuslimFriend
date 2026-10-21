package com.muslimfriend.app.overlay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.database.ContentObserver
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.content.ContextCompat
import kotlin.math.sqrt

private const val VOLUME_CHANGED = "android.media.VOLUME_CHANGED_ACTION"

/** Pure detection rules, kept separate so they can be unit-tested. */
object StopRules {
    /** Above this |z| (m/s²) the phone is lying clearly face up (z > 0) or face down (z < 0). */
    const val FLAT_Z = 7f
    /** Total acceleration, in g, that counts as one shake. */
    const val SHAKE_G = 2.5f
    const val SHAKES_NEEDED = 2
    const val SHAKE_WINDOW_MS = 1200L

    /** +1 face up, -1 face down, 0 in between (held, tilted). */
    fun face(z: Float): Int = when {
        z > FLAT_Z -> 1
        z < -FLAT_Z -> -1
        else -> 0
    }

    /** True when the phone went from clearly face up to clearly face down, or the other way round. */
    fun flipped(previousFace: Int, face: Int): Boolean = previousFace != 0 && face != 0 && face != previousFace

    fun gForce(x: Float, y: Float, z: Float): Float = sqrt(x * x + y * y + z * z) / SensorManager.GRAVITY_EARTH
}

/**
 * While the athan plays, stops it when the user turns the phone over (face up ↔ face down),
 * shakes it, or presses a volume button (any stream volume change). Each is optional.
 */
class AthanStopGestures(
    private val context: Context,
    private val flip: Boolean,
    private val shake: Boolean,
    private val volume: Boolean,
    private val onStop: () -> Unit,
) : SensorEventListener {
    private val handler = Handler(Looper.getMainLooper())
    private val sensors = context.getSystemService(SensorManager::class.java)
    private val audio = context.getSystemService(AudioManager::class.java)
    private var lastFace = 0
    private var shakeTimes = ArrayDeque<Long>()
    private var stopped = false
    private var volumes: List<Int> = emptyList()
    private val streams = listOf(AudioManager.STREAM_ALARM, AudioManager.STREAM_MUSIC, AudioManager.STREAM_RING, AudioManager.STREAM_NOTIFICATION)

    private val volumeObserver = object : ContentObserver(handler) {
        override fun onChange(selfChange: Boolean) {
            val now = currentVolumes()
            if (now != volumes) trigger()
        }
    }

    fun start() {
        if (flip || shake) {
            sensors?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)?.let {
                sensors.registerListener(this, it, SensorManager.SENSOR_DELAY_UI, handler)
            }
        }
        if (volume) {
            volumes = currentVolumes()
            runCatching { context.contentResolver.registerContentObserver(Settings.System.CONTENT_URI, true, volumeObserver) }
            // Some phones only announce volume changes through this (unofficial but long-standing) broadcast.
            runCatching {
                ContextCompat.registerReceiver(context, volumeReceiver, IntentFilter(VOLUME_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED)
                receiverRegistered = true
            }
        }
    }

    fun stop() {
        stopped = true
        runCatching { sensors?.unregisterListener(this) }
        runCatching { context.contentResolver.unregisterContentObserver(volumeObserver) }
        if (receiverRegistered) runCatching { context.unregisterReceiver(volumeReceiver) }
        receiverRegistered = false
    }

    private var receiverRegistered = false
    private val volumeReceiver = object : BroadcastReceiver() {
        override fun onReceive(c: Context, intent: Intent) {
            if (currentVolumes() != volumes) trigger()
        }
    }

    override fun onSensorChanged(event: SensorEvent) {
        if (stopped) return
        val (x, y, z) = event.values
        if (flip) {
            val face = StopRules.face(z)
            if (StopRules.flipped(lastFace, face)) return trigger()
            if (face != 0) lastFace = face
        }
        if (shake && StopRules.gForce(x, y, z) > StopRules.SHAKE_G) {
            val now = System.currentTimeMillis()
            if (shakeTimes.lastOrNull()?.let { now - it < 250 } == true) return // same jolt
            shakeTimes.addLast(now)
            while (shakeTimes.isNotEmpty() && now - shakeTimes.first() > StopRules.SHAKE_WINDOW_MS) shakeTimes.removeFirst()
            if (shakeTimes.size >= StopRules.SHAKES_NEEDED) trigger()
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) = Unit

    private fun currentVolumes(): List<Int> = streams.map { runCatching { audio.getStreamVolume(it) }.getOrDefault(-1) }

    private fun trigger() {
        if (stopped) return
        stop()
        onStop()
    }
}
