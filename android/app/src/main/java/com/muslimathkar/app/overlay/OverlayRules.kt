package com.muslimathkar.app.overlay

/** Pure decision logic for the overlay, kept free of Android types so it can be unit-tested. */
object OverlayRules {

    /** True when [minuteOfDay] falls inside the quiet window; handles windows that cross midnight. */
    fun isQuiet(config: OverlayConfig, minuteOfDay: Int): Boolean {
        if (!config.quietHoursEnabled || config.quietStart == config.quietEnd) return false
        return if (config.quietStart < config.quietEnd) {
            minuteOfDay >= config.quietStart && minuteOfDay < config.quietEnd
        } else {
            minuteOfDay >= config.quietStart || minuteOfDay < config.quietEnd
        }
    }

    fun isPaused(pausedUntil: Long, now: Long): Boolean = pausedUntil > now

    /**
     * Whether a timer tick may show the overlay now. Unlock-only mode never shows on ticks;
     * a minimum gap avoids showing twice when an unlock and a tick coincide.
     */
    fun shouldShowOnTick(config: OverlayConfig, now: Long, lastShownAt: Long): Boolean {
        if (config.frequencyMinutes <= 0) return false
        val minGap = config.frequencyMinutes * 60_000L - 30_000L
        return now - lastShownAt >= minGap
    }

    /** On unlock: always in unlock mode; in timed mode only if the period has elapsed while locked. */
    fun shouldShowOnUnlock(config: OverlayConfig, now: Long, lastShownAt: Long): Boolean {
        if (config.frequencyMinutes <= 0) return now - lastShownAt >= 5_000L
        return now - lastShownAt >= config.frequencyMinutes * 60_000L
    }

    /** Round-robin through the pool. Returns the item and the next index to store. */
    fun pick(pool: List<OverlayDhikr>, index: Int): Pair<OverlayDhikr, Int>? {
        if (pool.isEmpty()) return null
        val i = Math.floorMod(index, pool.size)
        return pool[i] to (i + 1) % pool.size
    }
}
