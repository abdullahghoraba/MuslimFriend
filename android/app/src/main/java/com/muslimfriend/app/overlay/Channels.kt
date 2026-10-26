package com.muslimfriend.app.overlay

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import com.muslimfriend.app.R

/** Notification channels. Users can tune each one separately in system settings. */
object Channels {
    const val ATHAN = "athan"
    const val ATHAN_PRE = "athan_reminders"
    const val OVERLAY_SERVICE = "overlay_service"
    const val MORNING_EVENING = "morning_evening"
    const val SLEEP = "sleep"
    const val FRIDAY = "friday"
    const val PERIODIC = "periodic_athkar"
    const val QURAN = "quran_wird"
    const val WORSHIP = "fasting_qada"

    fun ensure(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        val channels = listOf(
            NotificationChannel(ATHAN, context.getString(R.string.channel_athan), NotificationManager.IMPORTANCE_HIGH).apply { setSound(null, null) },
            NotificationChannel(ATHAN_PRE, context.getString(R.string.channel_athan_pre), NotificationManager.IMPORTANCE_DEFAULT),
            NotificationChannel(OVERLAY_SERVICE, context.getString(R.string.channel_overlay_service), NotificationManager.IMPORTANCE_LOW).apply {
                description = context.getString(R.string.channel_overlay_service_desc)
                setShowBadge(false)
            },
            NotificationChannel(MORNING_EVENING, context.getString(R.string.channel_morning_evening), NotificationManager.IMPORTANCE_DEFAULT),
            NotificationChannel(SLEEP, context.getString(R.string.channel_sleep), NotificationManager.IMPORTANCE_DEFAULT),
            NotificationChannel(FRIDAY, context.getString(R.string.channel_friday), NotificationManager.IMPORTANCE_DEFAULT),
            NotificationChannel(QURAN, context.getString(R.string.channel_quran), NotificationManager.IMPORTANCE_DEFAULT),
            NotificationChannel(WORSHIP, context.getString(R.string.channel_worship), NotificationManager.IMPORTANCE_DEFAULT),
            NotificationChannel(PERIODIC, context.getString(R.string.channel_periodic), NotificationManager.IMPORTANCE_LOW).apply {
                description = context.getString(R.string.channel_periodic_desc)
            },
        )
        nm.createNotificationChannels(channels)
    }

    /** Maps a reminder kind from the app to its channel. */
    fun forKind(kind: String): String = when (kind) {
        "morning", "evening" -> MORNING_EVENING
        "sleep" -> SLEEP
        "friday-kahf", "friday-salawat" -> FRIDAY
        "wird", "hifz" -> QURAN
        "fasting", "qada" -> WORSHIP
        else -> PERIODIC
    }
}
