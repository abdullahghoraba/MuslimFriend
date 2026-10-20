package com.muslimfriend.app.overlay

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import org.json.JSONArray
import org.json.JSONObject

data class Reminder(val id: String, val kind: String, val title: String, val body: String, val at: Long, val route: String?)

/**
 * Reminders are computed in the app (prayer times shift daily) and handed over as a list
 * covering the coming weeks. Only the next one is armed, as an inexact alarm
 * (setAndAllowWhileIdle) — no SCHEDULE_EXACT_ALARM / USE_EXACT_ALARM is requested.
 * The app re-sends the list on every launch and resume, which keeps the times current.
 */
object ReminderScheduler {
    private const val PREFS = "muslimfriend_reminders"
    private const val KEY_LIST = "list"
    /** Reminders more than this late (e.g. phone was off) are dropped instead of shown. */
    private const val STALE_MS = 2 * 60 * 60_000L

    fun replaceAll(context: Context, reminders: List<Reminder>) {
        val now = System.currentTimeMillis()
        save(context, reminders.filter { it.at > now }.sortedBy { it.at })
        scheduleNext(context)
    }

    fun cancelAll(context: Context) {
        save(context, emptyList())
        context.getSystemService(AlarmManager::class.java).cancel(alarmIntent(context))
    }

    fun pending(context: Context): List<Reminder> = load(context)

    fun scheduleNext(context: Context) {
        val am = context.getSystemService(AlarmManager::class.java)
        val next = load(context).firstOrNull()
        if (next == null) {
            am.cancel(alarmIntent(context))
            return
        }
        // Inexact but allowed during Doze; Android 12+ delivers within about an hour at worst,
        // typically within minutes when the device is in use.
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.at, alarmIntent(context))
    }

    /** Shows every reminder that is due and removes it from the list. */
    fun fireDue(context: Context) {
        val now = System.currentTimeMillis()
        val (due, later) = load(context).partition { it.at <= now + 60_000L }
        due.filter { now - it.at <= STALE_MS }.forEach { r ->
            Notifications.post(context, Channels.forKind(r.kind), 3000 + (r.id.hashCode() and 0x0FFF), r.title, r.body, r.route)
        }
        save(context, later)
    }

    private fun alarmIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(
        context, 3001, Intent(context, ReminderReceiver::class.java),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    private fun load(context: Context): List<Reminder> {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_LIST, null) ?: return emptyList()
        val arr = runCatching { JSONArray(raw) }.getOrNull() ?: return emptyList()
        return (0 until arr.length()).mapNotNull { i -> arr.optJSONObject(i)?.let(::fromJson) }.sortedBy { it.at }
    }

    private fun save(context: Context, list: List<Reminder>) {
        val arr = JSONArray()
        list.forEach { arr.put(toJson(it)) }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString(KEY_LIST, arr.toString()).apply()
    }

    fun fromJson(o: JSONObject): Reminder? {
        val at = o.optLong("at", 0L)
        val id = o.optString("id")
        if (at <= 0L || id.isBlank()) return null
        return Reminder(id, o.optString("kind"), o.optString("title"), o.optString("body"), at, o.optString("route").ifBlank { null })
    }

    private fun toJson(r: Reminder): JSONObject = JSONObject()
        .put("id", r.id).put("kind", r.kind).put("title", r.title).put("body", r.body).put("at", r.at)
        .put("route", r.route ?: "")
}
