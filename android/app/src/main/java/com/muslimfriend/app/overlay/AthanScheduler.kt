package com.muslimfriend.app.overlay

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject

data class AthanEvent(val id: String, val prayer: String, val kind: String, val at: Long,
    val title: String, val body: String, val sound: String, val volume: Float, val silentMinutes: Int = 0,
    /** Ways to stop the sound: "flip", "shake", "volume". */
    val stopOn: Set<String> = emptySet(),
    /** Spoken with text-to-speech when sound is "voice". */
    val speech: String = "") {
    fun toJson(): JSONObject = JSONObject().put("id", id).put("prayer", prayer).put("kind", kind)
        .put("at", at).put("title", title).put("body", body).put("sound", sound)
        .put("volume", volume.toDouble()).put("silentMinutes", silentMinutes)
        .put("stopOn", org.json.JSONArray(stopOn.toList())).put("speech", speech)
    companion object {
        val STOP_WAYS = setOf("flip", "shake", "volume")
        fun fromJson(o: JSONObject): AthanEvent {
            val sound = o.getString("sound")
            val volume = o.getDouble("volume")
            require(o.getString("id").isNotBlank() && o.getLong("at") > 0)
            require(o.getString("prayer") in setOf("fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"))
            require(o.getString("kind") in setOf("athan", "pre", "iqama", "voice"))
            require(sound in setOf("none", "system", "tone", "athan", "voice") || (sound.startsWith("file:/")))
            require(volume.isFinite() && volume in 0.0..1.0)
            return AthanEvent(o.getString("id"), o.getString("prayer"), o.getString("kind"), o.getLong("at"),
                o.getString("title"), o.getString("body"), sound, volume.toFloat(), o.optInt("silentMinutes", 0).coerceAtLeast(0),
                o.optJSONArray("stopOn")?.let { arr -> (0 until arr.length()).map { arr.optString(it) }.filter { it in STOP_WAYS }.toSet() }
                    ?: emptySet(),
                o.optString("speech", "").take(200))
        }
    }
}

object AthanRules {
    const val STALE_MS = 15 * 60_000L
    fun next(events: List<AthanEvent>, now: Long): AthanEvent? = events.filter { it.at > now }.minByOrNull { it.at }
    fun restoreAt(now: Long, minutes: Int): Long = now + minutes.coerceAtLeast(0).toLong() * 60_000L
}

object AthanScheduler {
    private fun prefs(c: Context) = c.getSharedPreferences("muslimfriend_athan", Context.MODE_PRIVATE)
    fun canExact(c: Context): Boolean = Build.VERSION.SDK_INT < 31 || c.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()
    fun pending(c: Context): List<AthanEvent> = runCatching {
        val arr = JSONArray(prefs(c).getString("events", "[]"))
        (0 until arr.length()).mapNotNull { runCatching { AthanEvent.fromJson(arr.getJSONObject(it)) }.getOrNull() }
    }.getOrDefault(emptyList())
    private fun save(c: Context, events: List<AthanEvent>) {
        prefs(c).edit().putString("events", JSONArray().apply { events.forEach { put(it.toJson()) } }.toString()).apply()
    }
    @Synchronized fun replaceAll(c: Context, events: List<AthanEvent>): Boolean {
        save(c, events.filter { it.at > System.currentTimeMillis() }.distinctBy { it.id }.sortedBy { it.at })
        return scheduleNext(c)
    }
    @Synchronized fun cancel(c: Context) {
        save(c, emptyList())
        c.getSystemService(AlarmManager::class.java).cancel(alarm(c))
    }
    private fun alarm(c: Context) = PendingIntent.getBroadcast(c, 4100, Intent(c, AthanReceiver::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    @Synchronized fun scheduleNext(c: Context): Boolean {
        val now = System.currentTimeMillis()
        val events = pending(c).filter { it.at >= now - AthanRules.STALE_MS }
        save(c, events)
        val am = c.getSystemService(AlarmManager::class.java)
        am.cancel(alarm(c))
        // Retain late events for delivery after reboot or an inexact alarm delay.
        val next = events.filter { it.at <= now }.minByOrNull { it.at }
            ?: AthanRules.next(events, now) ?: return canExact(c)
        if (canExact(c)) {
            try { am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, maxOf(now + 100, next.at), alarm(c)); return true }
            catch (_: SecurityException) { /* access changed while scheduling */ }
        }
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, maxOf(now + 100, next.at), alarm(c))
        return false
    }
    @Synchronized fun takeDue(c: Context): List<AthanEvent> {
        val now = System.currentTimeMillis()
        val events = pending(c)
        save(c, events.filter { it.at > now })
        return events.filter { it.at <= now && it.at >= now - AthanRules.STALE_MS }.sortedBy { it.at }
    }
}
