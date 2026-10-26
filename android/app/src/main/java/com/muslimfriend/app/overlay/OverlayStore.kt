package com.muslimfriend.app.overlay

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate

/** A dhikr the overlay can show. Written by the app through the plugin. */
data class OverlayDhikr(val id: String, val text: String, val categoryId: String, val repeatCount: Int)

/** Overlay settings as configured on the Overlay settings screen. */
data class OverlayConfig(
    val enabled: Boolean = false,
    /** Minutes between overlays; 0 means "on every unlock". */
    val frequencyMinutes: Int = 15,
    val displaySeconds: Int = 8,
    /** "top" | "center" | "bottom" */
    val position: String = "top",
    /** "small" | "medium" | "large" */
    val size: String = "medium",
    /** 0.3 – 1.0 */
    val opacity: Float = 0.95f,
    /** "system" | "light" | "dark" */
    val style: String = "system",
    val quietHoursEnabled: Boolean = false,
    /** Minutes after midnight. */
    val quietStart: Int = 22 * 60,
    val quietEnd: Int = 6 * 60,
    val language: String = "ar",
    val notificationTitle: String = "",
    val notificationText: String = "",
    val actionPause: String = "Pause 1h",
    val actionStop: String = "Stop",
    /** Texts of the overlay card in the app language (see NativeLabels). */
    val labels: Map<String, String> = emptyMap(),
) {
    fun toJson(): JSONObject = JSONObject()
        .put("enabled", enabled)
        .put("frequencyMinutes", frequencyMinutes)
        .put("displaySeconds", displaySeconds)
        .put("position", position)
        .put("size", size)
        .put("opacity", opacity.toDouble())
        .put("style", style)
        .put("quietHoursEnabled", quietHoursEnabled)
        .put("quietStart", quietStart)
        .put("quietEnd", quietEnd)
        .put("language", language)
        .put("notificationTitle", notificationTitle)
        .put("notificationText", notificationText)
        .put("actionPause", actionPause)
        .put("actionStop", actionStop)
        .put("labels", JSONObject(labels))

    companion object {
        fun fromJson(o: JSONObject?): OverlayConfig {
            if (o == null) return OverlayConfig()
            val d = OverlayConfig()
            return OverlayConfig(
                enabled = o.optBoolean("enabled", d.enabled),
                frequencyMinutes = o.optInt("frequencyMinutes", d.frequencyMinutes).coerceIn(0, 24 * 60),
                displaySeconds = o.optInt("displaySeconds", d.displaySeconds).coerceIn(3, 60),
                position = o.optString("position", d.position).takeIf { it in setOf("top", "center", "bottom") } ?: d.position,
                size = o.optString("size", d.size).takeIf { it in setOf("small", "medium", "large") } ?: d.size,
                opacity = o.optDouble("opacity", d.opacity.toDouble()).toFloat().coerceIn(0.3f, 1f),
                style = o.optString("style", d.style).takeIf { it in setOf("system", "light", "dark") } ?: d.style,
                quietHoursEnabled = o.optBoolean("quietHoursEnabled", d.quietHoursEnabled),
                quietStart = o.optInt("quietStart", d.quietStart).coerceIn(0, 24 * 60 - 1),
                quietEnd = o.optInt("quietEnd", d.quietEnd).coerceIn(0, 24 * 60 - 1),
                language = o.optString("language", d.language),
                notificationTitle = o.optString("notificationTitle", d.notificationTitle),
                notificationText = o.optString("notificationText", d.notificationText),
                actionPause = o.optString("actionPause", d.actionPause),
                actionStop = o.optString("actionStop", d.actionStop),
                labels = NativeLabels.parse(o.optJSONObject("labels")),
            )
        }
    }
}

/**
 * Native storage shared by the plugin, the foreground service and the receivers,
 * so the overlay keeps working while the WebView is not running.
 */
class OverlayStore(context: Context) {
    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences("muslimfriend_overlay", Context.MODE_PRIVATE)

    var config: OverlayConfig
        get() = OverlayConfig.fromJson(prefs.getString(KEY_CONFIG, null)?.let { runCatching { JSONObject(it) }.getOrNull() })
        set(value) = prefs.edit().putString(KEY_CONFIG, value.toJson().toString()).apply()

    var pool: List<OverlayDhikr>
        get() {
            val raw = prefs.getString(KEY_POOL, null) ?: return emptyList()
            val arr = runCatching { JSONArray(raw) }.getOrNull() ?: return emptyList()
            return (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                val text = o.optString("text")
                if (text.isBlank()) null
                else OverlayDhikr(o.optString("id"), text, o.optString("categoryId"), o.optInt("repeatCount", 1))
            }
        }
        set(value) {
            val arr = JSONArray()
            value.forEach {
                arr.put(JSONObject().put("id", it.id).put("text", it.text).put("categoryId", it.categoryId).put("repeatCount", it.repeatCount))
            }
            prefs.edit().putString(KEY_POOL, arr.toString()).apply()
        }

    /** Epoch millis until which the overlay is paused (0 = not paused). */
    var pausedUntil: Long
        get() = prefs.getLong(KEY_PAUSED_UNTIL, 0L)
        set(value) = prefs.edit().putLong(KEY_PAUSED_UNTIL, value).apply()

    /** Index into the pool, so athkar rotate instead of repeating at random. */
    var nextIndex: Int
        get() = prefs.getInt(KEY_NEXT_INDEX, 0)
        set(value) = prefs.edit().putInt(KEY_NEXT_INDEX, value).apply()

    /** Set when the service could not start and the app fell back to notification-only mode. */
    var fallbackReason: String?
        get() = prefs.getString(KEY_FALLBACK, null)
        set(value) = prefs.edit().apply { if (value == null) remove(KEY_FALLBACK) else putString(KEY_FALLBACK, value) }.apply()

    var lastShownAt: Long
        get() = prefs.getLong(KEY_LAST_SHOWN, 0L)
        set(value) = prefs.edit().putLong(KEY_LAST_SHOWN, value).apply()

    /** Adds one count taken in the overlay; drained into SQLite by the app on resume. */
    @Synchronized
    fun addCount(dhikrId: String, date: LocalDate = LocalDate.now()) {
        val counts = readCounts()
        val key = "$date|$dhikrId"
        counts.put(key, counts.optInt(key, 0) + 1)
        prefs.edit().putString(KEY_COUNTS, counts.toString()).apply()
    }

    /** Returns pending counts as [{date, dhikrId, count}] and clears them if [clear]. */
    @Synchronized
    fun takeCounts(clear: Boolean): JSONArray {
        val counts = readCounts()
        val out = JSONArray()
        counts.keys().forEach { key ->
            val sep = key.indexOf('|')
            if (sep > 0) {
                out.put(JSONObject().put("date", key.substring(0, sep)).put("dhikrId", key.substring(sep + 1)).put("count", counts.optInt(key)))
            }
        }
        if (clear) prefs.edit().remove(KEY_COUNTS).apply()
        return out
    }

    private fun readCounts(): JSONObject =
        prefs.getString(KEY_COUNTS, null)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: JSONObject()

    // ---- Floating tasbih bubble -----------------------------------------------------------

    var bubble: BubbleState
        get() = BubbleState.fromJson(prefs.getString(KEY_BUBBLE, null)?.let { runCatching { JSONObject(it) }.getOrNull() })
        set(value) = prefs.edit().putString(KEY_BUBBLE, value.toJson().toString()).apply()

    /** True while the app's own UI is on screen; the bubble hides so it does not cover the app. */
    var appVisible: Boolean
        get() = prefs.getBoolean(KEY_APP_VISIBLE, false)
        set(value) = prefs.edit().putBoolean(KEY_APP_VISIBLE, value).apply()

    /** Records one bubble tap: bumps the displayed count and the pending delta for the app to sync. */
    @Synchronized
    fun bubbleTap(): BubbleState {
        val b = bubble
        val next = b.copy(count = b.count + 1)
        bubble = next
        val p = readBubblePending()
        val key = b.counterId.toString()
        val entry = p.optJSONObject(key) ?: JSONObject().put("delta", 0).put("reset", false)
        entry.put("delta", entry.optInt("delta") + 1)
        p.put(key, entry)
        prefs.edit().putString(KEY_BUBBLE_PENDING, p.toString()).apply()
        return next
    }

    /** Reset from the bubble menu: later taps count from zero, and the app resets its counter on sync. */
    @Synchronized
    fun bubbleReset(): BubbleState {
        val b = bubble.copy(count = 0)
        bubble = b
        val p = readBubblePending()
        p.put(b.counterId.toString(), JSONObject().put("delta", 0).put("reset", true))
        prefs.edit().putString(KEY_BUBBLE_PENDING, p.toString()).apply()
        return b
    }

    /** Returns [{counterId, delta, reset}] and clears them if [clear]. */
    @Synchronized
    fun takeBubblePending(clear: Boolean): JSONArray {
        val p = readBubblePending()
        val out = JSONArray()
        p.keys().forEach { key ->
            val e = p.optJSONObject(key) ?: return@forEach
            out.put(JSONObject().put("counterId", key.toLongOrNull() ?: 0L).put("delta", e.optInt("delta")).put("reset", e.optBoolean("reset")))
        }
        if (clear) prefs.edit().remove(KEY_BUBBLE_PENDING).apply()
        return out
    }

    private fun readBubblePending(): JSONObject =
        prefs.getString(KEY_BUBBLE_PENDING, null)?.let { runCatching { JSONObject(it) }.getOrNull() } ?: JSONObject()

    companion object {
        private const val KEY_CONFIG = "config"
        private const val KEY_POOL = "pool"
        private const val KEY_PAUSED_UNTIL = "pausedUntil"
        private const val KEY_NEXT_INDEX = "nextIndex"
        private const val KEY_FALLBACK = "fallbackReason"
        private const val KEY_COUNTS = "counts"
        private const val KEY_LAST_SHOWN = "lastShownAt"
        private const val KEY_BUBBLE = "bubble"
        private const val KEY_BUBBLE_PENDING = "bubblePending"
        private const val KEY_APP_VISIBLE = "appVisible"
    }
}

/** Floating tasbih counter shown over other apps. */
data class BubbleState(
    val enabled: Boolean = false,
    val counterId: Long = 0,
    val name: String = "",
    val count: Int = 0,
    /** 0 = open-ended. */
    val target: Int = 33,
    /** Last position in px; -1 = not placed yet. */
    val x: Int = -1,
    val y: Int = -1,
    val language: String = "ar",
    /** Bubble diameter in dp (44–120). */
    val sizeDp: Int = 64,
    /** 0.4–1. */
    val opacity: Float = 1f,
    /** Large card instead of the round bubble (toggled on the bubble itself). */
    val expanded: Boolean = false,
    /** Texts of the bubble in the app language (see NativeLabels). */
    val labels: Map<String, String> = emptyMap(),
) {
    fun toJson(): JSONObject = JSONObject()
        .put("enabled", enabled).put("counterId", counterId).put("name", name).put("count", count)
        .put("target", target).put("x", x).put("y", y).put("language", language)
        .put("sizeDp", sizeDp).put("opacity", opacity.toDouble()).put("expanded", expanded)
        .put("labels", JSONObject(labels))

    companion object {
        fun fromJson(o: JSONObject?): BubbleState {
            if (o == null) return BubbleState()
            return BubbleState(
                enabled = o.optBoolean("enabled", false),
                counterId = o.optLong("counterId", 0),
                name = o.optString("name", ""),
                count = o.optInt("count", 0).coerceAtLeast(0),
                target = o.optInt("target", 33).coerceIn(0, 100_000),
                x = o.optInt("x", -1),
                y = o.optInt("y", -1),
                language = o.optString("language", "ar"),
                sizeDp = o.optInt("sizeDp", 64).coerceIn(44, 120),
                opacity = o.optDouble("opacity", 1.0).toFloat().coerceIn(0.4f, 1f),
                expanded = o.optBoolean("expanded", false),
                labels = NativeLabels.parse(o.optJSONObject("labels")),
            )
        }
    }
}
