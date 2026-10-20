package com.muslimfriend.app.overlay

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.muslimfriend.app.MainActivity
import com.muslimfriend.app.R
import java.time.LocalDateTime

/**
 * Restores the overlay service and the reminder alarm after reboot or an app update.
 * Both broadcasts are exempt from the background foreground-service start restriction,
 * and specialUse is not among the types Android 15 blocks from BOOT_COMPLETED.
 */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        Channels.ensure(context)
        OverlayController.start(context)
        ReminderScheduler.scheduleNext(context)
    }
}

/** Notification-only fallback: posts one dhikr, then re-arms the inexact alarm. */
class PeriodicReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val store = OverlayStore(context)
        val config = store.config
        if (!config.enabled) return
        // If the service is running again there is nothing to do here.
        if (OverlayService.running) return
        val now = System.currentTimeMillis()
        val t = LocalDateTime.now()
        val quiet = OverlayRules.isQuiet(config, t.hour * 60 + t.minute) || OverlayRules.isPaused(store.pausedUntil, now)
        if (!quiet) {
            OverlayRules.pick(store.pool, store.nextIndex)?.let { (dhikr, next) ->
                store.nextIndex = next
                Notifications.post(context, Channels.PERIODIC, PERIODIC_NOTIFICATION_ID, null, dhikr.text, route = null)
            }
        }
        OverlayController.schedulePeriodic(context)
    }

    companion object {
        private const val PERIODIC_NOTIFICATION_ID = 1500
    }
}

/** Fires the next due reminder notification and schedules the following one. */
class ReminderReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        ReminderScheduler.fireDue(context)
        ReminderScheduler.scheduleNext(context)
    }
}

object Notifications {
    const val EXTRA_ROUTE = "com.muslimfriend.app.ROUTE"

    fun post(context: Context, channel: String, id: Int, title: String?, text: String, route: String?) {
        Channels.ensure(context)
        val nm = NotificationManagerCompat.from(context)
        if (!nm.areNotificationsEnabled()) return
        val open = PendingIntent.getActivity(
            context, id,
            Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                .apply { if (route != null) putExtra(EXTRA_ROUTE, route) },
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val builder = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_stat_athkar)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setContentIntent(open)
            .setAutoCancel(true)
        if (!title.isNullOrBlank()) builder.setContentTitle(title)
        try {
            nm.notify(id, builder.build())
        } catch (_: SecurityException) {
            // POST_NOTIFICATIONS revoked between the check and the call.
        }
    }
}
