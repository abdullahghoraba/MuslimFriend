package com.muslimfriend.app.overlay

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.provider.Settings
import androidx.core.content.ContextCompat

/**
 * Starts/stops the overlay service and owns the notification-only fallback.
 *
 * Android 12+ forbids most background foreground-service starts. Exemptions we rely on:
 * a user action while the app is in the foreground, BOOT_COMPLETED / MY_PACKAGE_REPLACED,
 * and a notification action. On Android 15+ SYSTEM_ALERT_WINDOW alone no longer exempts
 * a start unless an overlay is already visible, so any other start can fail. When it does,
 * we fall back to periodic notifications (inexact alarms) and tell the user on next app open.
 */
object OverlayController {
    const val FALLBACK_FGS_NOT_ALLOWED = "fgs_not_allowed"
    const val FALLBACK_NO_OVERLAY_PERMISSION = "no_overlay_permission"

    fun canDrawOverlays(context: Context): Boolean = Settings.canDrawOverlays(context)

    /** Returns true if the foreground service was started. */
    fun start(context: Context): Boolean {
        val store = OverlayStore(context)
        // The service hosts both the athkar overlay and the floating tasbih counter.
        if (!store.config.enabled && !store.bubble.enabled) return false
        if (!canDrawOverlays(context)) {
            if (store.config.enabled) enableFallback(context, FALLBACK_NO_OVERLAY_PERMISSION)
            return false
        }
        if (OverlayService.running) {
            sendToService(context, OverlayService.ACTION_BUBBLE_CHANGED)
            return true
        }
        return try {
            ContextCompat.startForegroundService(context, Intent(context, OverlayService::class.java))
            store.fallbackReason = null
            cancelPeriodic(context)
            true
        } catch (e: Exception) {
            // ForegroundServiceStartNotAllowedException (Android 12+) extends IllegalStateException,
            // which older versions throw for a disallowed background start.
            if (e is IllegalStateException) {
                if (store.config.enabled) enableFallback(context, FALLBACK_FGS_NOT_ALLOWED)
                else store.fallbackReason = FALLBACK_FGS_NOT_ALLOWED
                false
            } else {
                throw e
            }
        }
    }

    fun stop(context: Context) {
        context.stopService(Intent(context, OverlayService::class.java))
        cancelPeriodic(context)
    }

    fun sendToService(context: Context, action: String) {
        if (!OverlayService.running) return
        context.startService(Intent(context, OverlayService::class.java).setAction(action))
    }

    private fun enableFallback(context: Context, reason: String) {
        OverlayStore(context).fallbackReason = reason
        schedulePeriodic(context)
    }

    /** Notification-only mode: an inexact repeating alarm posts one dhikr notification per period. */
    fun schedulePeriodic(context: Context) {
        val config = OverlayStore(context).config
        if (!config.enabled) return
        // Inexact alarms are batched; anything under 15 minutes would just be clipped.
        val minutes = config.frequencyMinutes.coerceAtLeast(15).toLong()
        val am = context.getSystemService(AlarmManager::class.java)
        val first = SystemClock.elapsedRealtime() + minutes * 60_000L
        am.setWindow(AlarmManager.ELAPSED_REALTIME, first, 10 * 60_000L, periodicIntent(context))
    }

    fun cancelPeriodic(context: Context) {
        context.getSystemService(AlarmManager::class.java).cancel(periodicIntent(context))
    }

    private fun periodicIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(
        context,
        2001,
        Intent(context, PeriodicReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
}
