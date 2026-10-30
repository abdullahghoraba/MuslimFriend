@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package com.muslimfriend.app.audio

import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import org.json.JSONObject

/** One file of the queue. Items of the same [group] (an ayah and its repeats) count as one for next / previous. */
data class AudioItem(val url: String, val title: String, val artist: String, val album: String, val group: String)

/**
 * The app's one Quran player: whole suras and radios from Listen, and the mushaf's verse-by-verse recitation.
 * It runs natively so playback goes on with the screen off or the app in the background: the queue advances,
 * streams reconnect and the sleep timer fires without the web view. [PlaybackService] shows it on the lock
 * screen and in the notification. Every call must be made on the main thread.
 */
object AudioEngine {
    private val main = Handler(Looper.getMainLooper())
    private var exo: ExoPlayer? = null
    private lateinit var app: Context
    /** Who started the queue ('listen' or 'mushaf'), so each screen follows only its own playback. */
    private var session = ""
    private var live = false
    private var attempts = 0
    private var error = false
    var sleepAt = 0L
        private set
    /** Receives the player's state whenever it changes, and every second while playing. */
    var listener: ((JSONObject) -> Unit)? = null

    private val sleep = Runnable { stop() }
    private val ticker = object : Runnable {
        override fun run() {
            emit()
            if (exo?.isPlaying == true) main.postDelayed(this, 1000)
        }
    }

    fun player(context: Context): ExoPlayer {
        exo?.let { return it }
        app = context.applicationContext
        val http = DefaultHttpDataSource.Factory().setUserAgent("MuslimFriend").setAllowCrossProtocolRedirects(false)
        return ExoPlayer.Builder(app)
            .setMediaSourceFactory(DefaultMediaSourceFactory(DefaultDataSource.Factory(app, http)))
            // Pauses for calls and other apps' audio, resumes after a short interruption.
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).build(), true)
            // Pauses when headphones are unplugged.
            .setHandleAudioBecomingNoisy(true)
            // Keeps the CPU and Wi-Fi awake while streaming with the screen off.
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
            .also { p ->
                exo = p
                p.addListener(object : Player.Listener {
                    override fun onIsPlayingChanged(isPlaying: Boolean) {
                        if (isPlaying) { attempts = 0; error = false; main.removeCallbacks(ticker); main.post(ticker) } else emit()
                    }
                    override fun onPlaybackStateChanged(state: Int) {
                        // A radio stream that closed: reconnect at the live point.
                        if (state == Player.STATE_ENDED && live) { p.seekToDefaultPosition(); p.prepare(); p.play() }
                        emit()
                    }
                    override fun onMediaItemTransition(item: MediaItem?, reason: Int) = emit()
                    override fun onPlayerError(e: PlaybackException) {
                        // A stream that would not load or dropped: try twice more before showing the error.
                        if (attempts++ < 2) {
                            main.postDelayed({ if (exo === p && p.mediaItemCount > 0) { p.prepare(); p.play() } }, 1500)
                        } else {
                            error = true
                        }
                        emit()
                    }
                })
            }
    }

    fun play(context: Context, session: String, items: List<AudioItem>, index: Int, positionMs: Long, repeat: String, speed: Float, live: Boolean) {
        val p = player(context)
        this.session = session
        this.live = live
        attempts = 0
        error = false
        // The service puts the player on the lock screen and keeps it alive in the background.
        runCatching { context.startService(Intent(context, PlaybackService::class.java)) }
        p.setMediaItems(items.map { it.toMediaItem(live) }, index.coerceIn(0, (items.size - 1).coerceAtLeast(0)), positionMs)
        p.repeatMode = repeatMode(repeat)
        p.setPlaybackSpeed(speed)
        p.prepare()
        p.play()
        emit()
    }

    fun toggle() {
        val p = exo ?: return
        when {
            p.isPlaying || (p.playWhenReady && p.playbackState == Player.STATE_BUFFERING) -> p.pause()
            // A live stream resumes at the live point, not where it was paused.
            live -> { p.seekToDefaultPosition(); p.prepare(); p.play() }
            p.playbackState == Player.STATE_IDLE || p.playbackState == Player.STATE_ENDED -> {
                if (p.playbackState == Player.STATE_ENDED) p.seekToDefaultPosition()
                attempts = 0; error = false; p.prepare(); p.play()
            }
            else -> p.play()
        }
    }

    fun stop() {
        main.removeCallbacks(sleep)
        sleepAt = 0
        exo?.let { it.stop(); it.clearMediaItems() }
        emit()
        session = ""
        live = false
    }

    fun seek(positionMs: Long) { exo?.seekTo(positionMs.coerceAtLeast(0)) }

    /** The first item of the next group (the next ayah after this one's repeats); wraps when the queue repeats. */
    fun next() {
        val p = exo ?: return
        val n = p.mediaItemCount
        if (n == 0) return
        val group = p.currentMediaItem?.mediaId
        for (i in p.currentMediaItemIndex + 1 until n) if (p.getMediaItemAt(i).mediaId != group) return p.seekTo(i, 0)
        if (p.repeatMode == Player.REPEAT_MODE_ALL) p.seekTo(0, 0)
    }

    /** The start of the previous group, or of this one when it is the first. */
    fun previous() {
        val p = exo ?: return
        if (p.mediaItemCount == 0) return
        var start = p.currentMediaItemIndex
        val group = p.currentMediaItem?.mediaId
        while (start > 0 && p.getMediaItemAt(start - 1).mediaId == group) start--
        if (start == 0) return p.seekTo(0, 0)
        var prev = start - 1
        val prevGroup = p.getMediaItemAt(prev).mediaId
        while (prev > 0 && p.getMediaItemAt(prev - 1).mediaId == prevGroup) prev--
        p.seekTo(prev, 0)
    }

    fun hasNext(): Boolean {
        val p = exo ?: return false
        if (p.repeatMode == Player.REPEAT_MODE_ALL && p.mediaItemCount > 0) return true
        val group = p.currentMediaItem?.mediaId
        return (p.currentMediaItemIndex + 1 until p.mediaItemCount).any { p.getMediaItemAt(it).mediaId != group }
    }

    fun setRepeat(repeat: String) { exo?.repeatMode = repeatMode(repeat) }
    fun setSpeed(speed: Float) { exo?.setPlaybackSpeed(speed) }

    /** Stops playback after [minutes]; 0 cancels. */
    fun setSleep(minutes: Int) {
        main.removeCallbacks(sleep)
        sleepAt = if (minutes > 0) System.currentTimeMillis() + minutes * 60_000L else 0
        if (minutes > 0) main.postDelayed(sleep, minutes * 60_000L)
        emit()
    }

    fun state(): JSONObject {
        val p = exo
        val item = p?.currentMediaItem
        val duration = p?.duration ?: C.TIME_UNSET
        return JSONObject()
            .put("session", session)
            .put("index", if (item == null) -1 else p.currentMediaItemIndex)
            .put("group", item?.mediaId ?: "")
            .put("playing", p?.isPlaying == true)
            .put("buffering", p != null && p.playWhenReady && p.playbackState == Player.STATE_BUFFERING)
            .put("ended", p?.playbackState == Player.STATE_ENDED && !live)
            .put("error", error)
            .put("position", (p?.currentPosition ?: 0) / 1000.0)
            .put("duration", if (live || duration == C.TIME_UNSET) 0.0 else duration / 1000.0)
            .put("sleepAt", sleepAt)
    }

    private fun emit() { listener?.invoke(state()) }

    private fun repeatMode(repeat: String) = when (repeat) {
        "one" -> Player.REPEAT_MODE_ONE
        "all" -> Player.REPEAT_MODE_ALL
        else -> Player.REPEAT_MODE_OFF
    }

    private fun AudioItem.toMediaItem(live: Boolean): MediaItem = MediaItem.Builder()
        .setUri(url)
        .setMediaId(group)
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle(title)
                .setArtist(artist.ifBlank { null })
                .setAlbumTitle(album.ifBlank { null })
                .setIsPlayable(true)
                .setMediaType(if (live) MediaMetadata.MEDIA_TYPE_RADIO_STATION else MediaMetadata.MEDIA_TYPE_MUSIC)
                .build(),
        )
        .build()
}
