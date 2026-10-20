package com.muslimfriend.app.overlay

import android.app.AlarmManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioManager

/** Persist the original mode before changing it; overlapping quiet periods extend one restore. */
object AthanSilence {
    private fun prefs(c: Context) = c.getSharedPreferences("muslimfriend_athan", Context.MODE_PRIVATE)
    private fun alarm(c: Context) = PendingIntent.getBroadcast(c, 4102, Intent(c, AthanRestoreReceiver::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    fun hasAccess(c: Context) = c.getSystemService(NotificationManager::class.java).isNotificationPolicyAccessGranted
    @Synchronized fun begin(c: Context, minutes: Int) {
        if (minutes <= 0 || !hasAccess(c)) return
        val p = prefs(c)
        val audio = c.getSystemService(AudioManager::class.java)
        val nm = c.getSystemService(NotificationManager::class.java)
        if (!p.contains("previousRinger")) p.edit().putInt("previousRinger", audio.ringerMode)
            .putInt("previousFilter", nm.currentInterruptionFilter).commit()
        val until = maxOf(p.getLong("restoreAt", 0), AthanRules.restoreAt(System.currentTimeMillis(), minutes))
        p.edit().putLong("restoreAt", until).commit()
        // Arm restoration first, so a process death after muting cannot lose the timer.
        rearm(c)
        runCatching { audio.ringerMode = AudioManager.RINGER_MODE_SILENT }
            .onFailure { runCatching { nm.setInterruptionFilter(NotificationManager.INTERRUPTION_FILTER_PRIORITY) } }
    }
    fun rearm(c: Context) {
        val at = prefs(c).getLong("restoreAt", 0)
        if (at == 0L) return
        if (at <= System.currentTimeMillis()) { restore(c); return }
        c.getSystemService(AlarmManager::class.java).setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, alarm(c))
    }
    @Synchronized fun restore(c: Context) {
        val p = prefs(c)
        if (!p.contains("previousRinger")) return
        if (p.getLong("restoreAt", 0) > System.currentTimeMillis()) { rearm(c); return }
        val success = runCatching {
            c.getSystemService(AudioManager::class.java).ringerMode = p.getInt("previousRinger", AudioManager.RINGER_MODE_NORMAL)
            if (hasAccess(c)) c.getSystemService(NotificationManager::class.java).setInterruptionFilter(p.getInt("previousFilter", NotificationManager.INTERRUPTION_FILTER_ALL))
        }.isSuccess
        if (success) p.edit().remove("previousRinger").remove("previousFilter").remove("restoreAt").apply()
    }
}
