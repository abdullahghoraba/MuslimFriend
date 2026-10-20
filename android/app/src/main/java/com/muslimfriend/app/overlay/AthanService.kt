package com.muslimfriend.app.overlay

import android.app.Service
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.muslimfriend.app.MainActivity
import com.muslimfriend.app.R
import org.json.JSONObject
import java.io.File

class AthanService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var focus: AudioFocusRequest? = null
    private var event: AthanEvent? = null
    private var preview = false
    private val timeout = Runnable { finishPlayback() }
    private val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build()
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) { finishPlayback(); return START_NOT_STICKY }
        val incoming = runCatching { AthanEvent.fromJson(JSONObject(intent?.getStringExtra("event") ?: "")) }.getOrNull()
        if (incoming == null) { stopSelf(); return START_NOT_STICKY }
        release()
        event = incoming
        preview = intent?.getBooleanExtra("preview", false) ?: false
        Channels.ensure(this)
        try {
            startForeground(NOTIFICATION_ID, notification(this, incoming, true).build())
            if (incoming.sound == "none") { finishPlayback(); return START_NOT_STICKY }
            val audio = getSystemService(AudioManager::class.java)
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT)
                .setAudioAttributes(attributes).setOnAudioFocusChangeListener { change ->
                    if (change == AudioManager.AUDIOFOCUS_LOSS || change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) finishPlayback()
                }.build()
            focus = request
            if (audio.requestAudioFocus(request) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                finishPlayback(); return START_NOT_STICKY
            }
            val media = MediaPlayer()
            player = media
            media.setAudioAttributes(attributes)
            setSource(media, incoming.sound)
            media.setVolume(incoming.volume, incoming.volume)
            media.setOnCompletionListener { finishPlayback() }
            media.setOnErrorListener { _, _, _ -> finishPlayback(); true }
            media.setOnPreparedListener { if (player === it) it.start() }
            handler.postDelayed(timeout, if (preview) 30_000L else 6 * 60_000L)
            media.prepareAsync()
        } catch (_: Exception) { finishPlayback() }
        return START_NOT_STICKY
    }
    private fun setSource(media: MediaPlayer, sound: String) {
        val file = if (sound.startsWith("file:")) File(sound.removePrefix("file:")).canonicalFile else null
        val privateRoots = listOfNotNull(filesDir, cacheDir, noBackupFilesDir, getExternalFilesDir(null)).map { it.canonicalFile }
        if (file != null && file.isFile && privateRoots.any { file.path.startsWith(it.path + File.separator) }) {
            runCatching { media.setDataSource(file.path) }.onSuccess { return }
            media.reset(); media.setAudioAttributes(attributes)
        }
        if (sound == "system") {
            for (type in listOf(RingtoneManager.TYPE_ALARM, RingtoneManager.TYPE_NOTIFICATION)) {
                val uri = RingtoneManager.getDefaultUri(type) ?: continue
                runCatching { media.setDataSource(this, uri) }.onSuccess { return }
                media.reset(); media.setAudioAttributes(attributes)
            }
        }
        resources.openRawResourceFd(R.raw.athan_tone).use { media.setDataSource(it.fileDescriptor, it.startOffset, it.length) }
    }
    private fun release() {
        handler.removeCallbacks(timeout)
        player?.let { runCatching { it.release() } }; player = null
        focus?.let { getSystemService(AudioManager::class.java).abandonAudioFocusRequest(it) }; focus = null
    }
    private fun finishPlayback() {
        val finished = event
        event = null
        release()
        if (!preview && finished?.kind == "athan") runCatching { AthanSilence.begin(this, finished.silentMinutes) }
        stopForeground(STOP_FOREGROUND_REMOVE)
        // Keep a quiet record of the athan ("It's time for Fajr") once the sound has stopped.
        if (!preview && finished != null) post(this, finished.copy(sound = "none"))
        stopSelf()
    }
    override fun onDestroy() { release(); super.onDestroy() }
    companion object {
        const val ACTION_STOP = "com.muslimfriend.app.ATHAN_STOP"
        private const val NOTIFICATION_ID = 4101
        fun intent(c: Context, e: AthanEvent, preview: Boolean = false) = Intent(c, AthanService::class.java)
            .putExtra("event", e.toJson().toString()).putExtra("preview", preview)
        private fun notification(c: Context, e: AthanEvent, ongoing: Boolean): NotificationCompat.Builder {
            val open = PendingIntent.getActivity(c, 4101, Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val channel = if (e.kind == "athan") Channels.ATHAN else Channels.ATHAN_PRE
            val builder = NotificationCompat.Builder(c, channel).setSmallIcon(R.drawable.ic_stat_athkar)
                .setContentTitle(e.title).setContentText(e.body).setStyle(NotificationCompat.BigTextStyle().bigText(e.body))
                .setContentIntent(open).setPriority(NotificationCompat.PRIORITY_HIGH).setOngoing(ongoing).setAutoCancel(!ongoing)
                .setSilent(e.sound == "none" || ongoing)
            if (ongoing) builder.addAction(0, c.getString(R.string.athan_stop), PendingIntent.getService(c, 4101,
                Intent(c, AthanService::class.java).setAction(ACTION_STOP), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE))
            return builder
        }
        fun post(c: Context, e: AthanEvent) {
            Channels.ensure(c)
            runCatching { NotificationManagerCompat.from(c).notify(4200 + (e.id.hashCode() and 0xFFFF), notification(c, e, false).build()) }
        }
    }
}
