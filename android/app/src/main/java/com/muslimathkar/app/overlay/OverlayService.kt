package com.muslimathkar.app.overlay

import android.app.KeyguardManager
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.muslimathkar.app.MainActivity
import com.muslimathkar.app.R
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.time.LocalDateTime

/**
 * Foreground service (type specialUse) that shows a dhikr card over other apps periodically
 * or on unlock. It reads everything from [OverlayStore], so it runs without the WebView.
 *
 * Battery: the timer only runs while the screen is on and unlocked; it is cancelled on SCREEN_OFF.
 */
class OverlayService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var ticker: Job? = null
    private lateinit var store: OverlayStore
    private lateinit var window: OverlayWindow
    private var receiverRegistered = false

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                Intent.ACTION_SCREEN_OFF -> {
                    stopTicker()
                    window.hide(animate = false)
                }
                Intent.ACTION_USER_PRESENT -> onUnlocked()
                // Devices without a secure lock screen never send USER_PRESENT.
                Intent.ACTION_SCREEN_ON -> if (!isLocked()) onUnlocked()
            }
        }
    }

    override fun onCreate() {
        super.onCreate()
        running = true
        store = OverlayStore(this)
        window = OverlayWindow(this) { dhikr -> store.addCount(dhikr.id) }
        Channels.ensure(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Must call startForeground promptly on every start.
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
        } else {
            0
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), type)

        when (intent?.action) {
            ACTION_STOP -> {
                store.config = store.config.copy(enabled = false)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_PAUSE_HOUR -> {
                store.pausedUntil = System.currentTimeMillis() + 60 * 60_000L
                window.hide()
            }
            ACTION_RESUME -> store.pausedUntil = 0L
            ACTION_SHOW_NOW -> showNext(force = true)
            ACTION_CONFIG_CHANGED -> {
                if (!store.config.enabled) {
                    stopSelf()
                    return START_NOT_STICKY
                }
                restartTicker()
            }
        }

        if (!receiverRegistered) {
            val filter = IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_ON)
                addAction(Intent.ACTION_SCREEN_OFF)
                addAction(Intent.ACTION_USER_PRESENT)
            }
            // System broadcasts: not exported to other apps.
            ContextCompat.registerReceiver(this, screenReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
            receiverRegistered = true
        }
        if (isScreenUsable() && ticker == null) startTicker()
        return START_STICKY
    }

    private fun onUnlocked() {
        val now = System.currentTimeMillis()
        if (OverlayRules.shouldShowOnUnlock(store.config, now, store.lastShownAt)) showNext()
        startTicker()
    }

    private fun startTicker() {
        if (ticker?.isActive == true) return
        ticker = scope.launch {
            while (isActive) {
                delay(TICK_MS)
                if (OverlayRules.shouldShowOnTick(store.config, System.currentTimeMillis(), store.lastShownAt)) showNext()
            }
        }
    }

    private fun stopTicker() {
        ticker?.cancel()
        ticker = null
    }

    private fun restartTicker() {
        stopTicker()
        if (isScreenUsable()) startTicker()
    }

    private fun showNext(force: Boolean = false) {
        val config = store.config
        val now = System.currentTimeMillis()
        if (!force) {
            if (!config.enabled || !isScreenUsable()) return
            if (OverlayRules.isPaused(store.pausedUntil, now)) return
            val t = LocalDateTime.now()
            if (OverlayRules.isQuiet(config, t.hour * 60 + t.minute)) return
        }
        if (!OverlayController.canDrawOverlays(this)) return
        val (dhikr, next) = OverlayRules.pick(store.pool, store.nextIndex) ?: return
        store.nextIndex = next
        store.lastShownAt = now
        window.show(dhikr, config)
    }

    private fun isLocked(): Boolean = getSystemService(KeyguardManager::class.java).isKeyguardLocked

    private fun isScreenUsable(): Boolean =
        getSystemService(PowerManager::class.java).isInteractive && !isLocked()

    private fun buildNotification(): Notification {
        val config = store.config
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val pause = PendingIntent.getService(
            this, 1, Intent(this, OverlayService::class.java).setAction(ACTION_PAUSE_HOUR),
            PendingIntent.FLAG_IMMUTABLE,
        )
        val stop = PendingIntent.getService(
            this, 2, Intent(this, OverlayService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE,
        )
        return NotificationCompat.Builder(this, Channels.OVERLAY_SERVICE)
            .setSmallIcon(R.drawable.ic_stat_athkar)
            .setContentTitle(config.notificationTitle.ifBlank { getString(R.string.overlay_notification_title) })
            .setContentText(config.notificationText.ifBlank { getString(R.string.overlay_notification_text) })
            .setContentIntent(open)
            .setOngoing(true)
            .setSilent(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(0, config.actionPause.ifBlank { getString(R.string.overlay_action_pause) }, pause)
            .addAction(0, config.actionStop.ifBlank { getString(R.string.overlay_action_stop) }, stop)
            .build()
    }

    override fun onDestroy() {
        running = false
        stopTicker()
        scope.cancel()
        if (receiverRegistered) runCatching { unregisterReceiver(screenReceiver) }
        window.hide(animate = false)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        const val NOTIFICATION_ID = 1001
        const val ACTION_STOP = "com.muslimathkar.app.overlay.STOP"
        const val ACTION_PAUSE_HOUR = "com.muslimathkar.app.overlay.PAUSE_HOUR"
        const val ACTION_RESUME = "com.muslimathkar.app.overlay.RESUME"
        const val ACTION_SHOW_NOW = "com.muslimathkar.app.overlay.SHOW_NOW"
        const val ACTION_CONFIG_CHANGED = "com.muslimathkar.app.overlay.CONFIG_CHANGED"
        private const val TICK_MS = 30_000L

        @Volatile
        var running = false
            private set
    }
}
