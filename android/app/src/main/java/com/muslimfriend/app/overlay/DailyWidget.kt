package com.muslimfriend.app.overlay

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import com.muslimfriend.app.MainActivity
import com.muslimfriend.app.R
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId

/** Home-screen widget with the verse of the day; tapping it opens that page of the mushaf. */
class VerseWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = DailyWidget.update(context, manager, ids, DailyWidget.VERSE)

    /** The midnight alarm redraws both widgets. */
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == DailyWidget.ACTION_REFRESH) DailyWidget.updateAll(context) else super.onReceive(context, intent)
    }
}

/** Home-screen widget with the hadith of the day; tapping it opens the app's home. */
class HadithWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) = DailyWidget.update(context, manager, ids, DailyWidget.HADITH)
}

/**
 * The app sends a week of verses and hadith (one per day), so the widgets move on to the next day at midnight
 * even when the app isn't opened.
 */
object DailyWidget {
    const val VERSE = "verse"
    const val HADITH = "hadith"
    private const val PREFS = "muslimfriend_daily_widget"

    /** [days]: [{ date: "2026-10-31", verse: { text, ref, route }, hadith: { text, ref, route } }]. */
    fun setData(c: Context, days: JSONArray, titles: JSONObject, appName: String) {
        c.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString("days", days.toString()).putString("titles", titles.toString()).putString("appName", appName).apply()
        updateAll(c)
    }

    fun updateAll(c: Context) {
        val manager = AppWidgetManager.getInstance(c)
        update(c, manager, manager.getAppWidgetIds(ComponentName(c, VerseWidget::class.java)), VERSE)
        update(c, manager, manager.getAppWidgetIds(ComponentName(c, HadithWidget::class.java)), HADITH)
    }

    fun update(c: Context, manager: AppWidgetManager, ids: IntArray, kind: String) {
        if (ids.isEmpty()) return
        val p = c.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val days = runCatching { JSONArray(p.getString("days", "[]")) }.getOrDefault(JSONArray())
        val titles = runCatching { JSONObject(p.getString("titles", "{}")) }.getOrDefault(JSONObject())
        val today = LocalDate.now(ZoneId.systemDefault()).toString()
        // Today's entry, or the latest one before today when the app hasn't sent a newer week.
        val entry = (0 until days.length()).mapNotNull { days.optJSONObject(it) }
            .filter { it.optString("date") <= today }.maxByOrNull { it.optString("date") }?.optJSONObject(kind)
        val title = titles.optString(kind).ifBlank { c.getString(if (kind == VERSE) R.string.widget_verse else R.string.widget_hadith) }
        for (id in ids) {
            val views = RemoteViews(c.packageName, R.layout.daily_widget)
            views.setTextViewText(R.id.daily_title, title)
            views.setTextViewText(R.id.daily_text, entry?.optString("text")?.ifBlank { null } ?: c.getString(R.string.widget_daily_empty))
            views.setTextViewText(R.id.daily_ref, entry?.optString("ref") ?: p.getString("appName", c.getString(R.string.app_name)))
            val route = entry?.optString("route")?.ifBlank { null } ?: "/home"
            val open = PendingIntent.getActivity(
                c, if (kind == VERSE) 4110 else 4111,
                Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                    .putExtra(Notifications.EXTRA_ROUTE, route),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            views.setOnClickPendingIntent(R.id.daily_root, open)
            manager.updateAppWidget(id, views)
        }
        scheduleMidnight(c)
    }

    /** Redraws both widgets just after midnight, so the new day's verse and hadith appear. */
    private fun scheduleMidnight(c: Context) {
        val zone = ZoneId.systemDefault()
        val at = LocalDate.now(zone).plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli() + 60_000
        val intent = Intent(c, VerseWidget::class.java).setAction(ACTION_REFRESH)
        val pending = PendingIntent.getBroadcast(c, 4112, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        // Inexact but allowed in Doze, without the exact-alarm permission.
        c.getSystemService(AlarmManager::class.java).setAndAllowWhileIdle(AlarmManager.RTC, at, pending)
    }

    const val ACTION_REFRESH = "com.muslimfriend.app.DAILY_WIDGET_REFRESH"
}
