@file:androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)

package com.muslimfriend.app.audio

import android.app.PendingIntent
import android.content.Intent
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import com.muslimfriend.app.MainActivity
import com.muslimfriend.app.R

/**
 * Keeps Quran playback going in the background (foreground service of type mediaPlayback while it plays) and shows
 * it on the lock screen, in the notification and to headphones and Bluetooth buttons. The notification opens the app.
 */
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        setMediaNotificationProvider(DefaultMediaNotificationProvider.Builder(this).build().apply { setSmallIcon(R.drawable.ic_stat_athkar) })
        session = MediaSession.Builder(this, GroupedPlayer(AudioEngine.player(this))).setSessionActivity(open).build().also { addSession(it) }
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    override fun onDestroy() {
        // The player itself stays with AudioEngine: the app may start playing again before the next service is created.
        session?.release()
        session = null
        super.onDestroy()
    }

    /** Next / previous from the notification, lock screen and headphones skip an ayah's repeats, like the app's buttons. */
    private class GroupedPlayer(player: Player) : ForwardingPlayer(player) {
        override fun seekToNext() = AudioEngine.next()
        override fun seekToNextMediaItem() = AudioEngine.next()
        override fun seekToPrevious() = AudioEngine.previous()
        override fun seekToPreviousMediaItem() = AudioEngine.previous()
        override fun hasNextMediaItem() = AudioEngine.hasNext()
        override fun stop() = AudioEngine.stop()
    }
}
