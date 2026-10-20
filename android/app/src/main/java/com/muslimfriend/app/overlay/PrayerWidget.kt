package com.muslimfriend.app.overlay

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.text.format.DateFormat
import android.view.View
import android.widget.RemoteViews
import com.muslimfriend.app.MainActivity
import com.muslimfriend.app.R
import org.json.JSONArray
import java.time.Instant
import java.time.ZoneId
import java.util.Date

class PrayerWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) { ids.forEach { update(context, manager, it) } }
    companion object {
        fun setData(c: Context, prayers: JSONArray, nextLabel: String, appName: String) {
            c.getSharedPreferences("muslimfriend_widget", Context.MODE_PRIVATE).edit()
                .putString("prayers", prayers.toString()).putString("nextLabel", nextLabel).putString("appName", appName).apply()
            updateAll(c)
        }
        fun updateAll(c: Context) {
            val manager = AppWidgetManager.getInstance(c)
            manager.getAppWidgetIds(ComponentName(c, PrayerWidget::class.java)).forEach { update(c, manager, it) }
        }
        private fun update(c: Context, manager: AppWidgetManager, id: Int) {
            val p = c.getSharedPreferences("muslimfriend_widget", Context.MODE_PRIVATE)
            val arr = runCatching { JSONArray(p.getString("prayers", "[]")) }.getOrDefault(JSONArray())
            val prayers = (0 until arr.length()).mapNotNull { i -> arr.optJSONObject(i)?.let { it.optString("name") to it.optLong("at") } }.sortedBy { it.second }
            val now = System.currentTimeMillis()
            val future = prayers.filter { it.second > now }
            val next = future.firstOrNull()
            val views = RemoteViews(c.packageName, R.layout.prayer_widget)
            views.setTextViewText(R.id.widget_app, p.getString("appName", c.getString(R.string.app_name)))
            val time = java.text.SimpleDateFormat(if (DateFormat.is24HourFormat(c)) "HH:mm" else "h:mm a", java.util.Locale.getDefault())
            views.setTextViewText(R.id.widget_next, next?.let { p.getString("nextLabel", c.getString(R.string.widget_next)) + " · " + it.first + " " + time.format(Date(it.second)) } ?: c.getString(R.string.widget_empty))
            val mins = next?.let { ((it.second - now + 59_999) / 60_000) } ?: 0
            views.setTextViewText(R.id.widget_countdown, if (next == null) "" else c.getString(R.string.widget_in, mins / 60, mins % 60))
            views.setViewVisibility(R.id.widget_clock, if (next != null && Build.VERSION.SDK_INT >= 24) View.VISIBLE else View.GONE)
            if (next != null && Build.VERSION.SDK_INT >= 24) {
                views.setChronometer(R.id.widget_clock, SystemClock.elapsedRealtime() + next.second - now, null, true)
                views.setChronometerCountDown(R.id.widget_clock, true)
            }
            val zone = ZoneId.systemDefault()
            val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
            views.setTextViewText(R.id.widget_remaining, future.filter { Instant.ofEpochMilli(it.second).atZone(zone).toLocalDate() == today }
                .joinToString("   ·   ") { it.first + " " + time.format(Date(it.second)) })
            val open = PendingIntent.getActivity(c, 4104, Intent(c, MainActivity::class.java), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            views.setOnClickPendingIntent(R.id.widget_root, open)
            manager.updateAppWidget(id, views)
        }
    }
}
