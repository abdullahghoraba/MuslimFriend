package com.muslimathkar.app.overlay

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OverlayRulesTest {
    private val quietNight = OverlayConfig(quietHoursEnabled = true, quietStart = 22 * 60, quietEnd = 6 * 60)
    private val quietDay = OverlayConfig(quietHoursEnabled = true, quietStart = 13 * 60, quietEnd = 14 * 60)

    @Test fun quietWindowAcrossMidnight() {
        assertTrue(OverlayRules.isQuiet(quietNight, 23 * 60))
        assertTrue(OverlayRules.isQuiet(quietNight, 0))
        assertTrue(OverlayRules.isQuiet(quietNight, 5 * 60 + 59))
        assertFalse(OverlayRules.isQuiet(quietNight, 6 * 60))
        assertFalse(OverlayRules.isQuiet(quietNight, 12 * 60))
    }

    @Test fun quietWindowSameDay() {
        assertTrue(OverlayRules.isQuiet(quietDay, 13 * 60 + 30))
        assertFalse(OverlayRules.isQuiet(quietDay, 14 * 60))
        assertFalse(OverlayRules.isQuiet(quietDay, 12 * 60))
    }

    @Test fun quietDisabledOrEmpty() {
        assertFalse(OverlayRules.isQuiet(quietNight.copy(quietHoursEnabled = false), 23 * 60))
        assertFalse(OverlayRules.isQuiet(quietNight.copy(quietEnd = 22 * 60), 23 * 60))
    }

    @Test fun tickRespectsFrequency() {
        val c = OverlayConfig(frequencyMinutes = 15)
        assertFalse(OverlayRules.shouldShowOnTick(c, now = 10 * 60_000L, lastShownAt = 0))
        assertTrue(OverlayRules.shouldShowOnTick(c, now = 15 * 60_000L, lastShownAt = 0))
        assertFalse(OverlayRules.shouldShowOnTick(c.copy(frequencyMinutes = 0), now = Long.MAX_VALUE / 2, lastShownAt = 0))
    }

    @Test fun unlockMode() {
        val unlock = OverlayConfig(frequencyMinutes = 0)
        assertTrue(OverlayRules.shouldShowOnUnlock(unlock, now = 10_000, lastShownAt = 0))
        assertFalse(OverlayRules.shouldShowOnUnlock(unlock, now = 3_000, lastShownAt = 0))
        val timed = OverlayConfig(frequencyMinutes = 30)
        assertFalse(OverlayRules.shouldShowOnUnlock(timed, now = 10 * 60_000L, lastShownAt = 0))
        assertTrue(OverlayRules.shouldShowOnUnlock(timed, now = 31 * 60_000L, lastShownAt = 0))
    }

    @Test fun pickRotates() {
        val pool = listOf(OverlayDhikr("a", "x", "c", 1), OverlayDhikr("b", "y", "c", 1))
        assertEquals("a" to 1, OverlayRules.pick(pool, 0)!!.let { it.first.id to it.second })
        assertEquals("b" to 0, OverlayRules.pick(pool, 1)!!.let { it.first.id to it.second })
        assertEquals("a", OverlayRules.pick(pool, 7 - 1)!!.first.id)
        assertNull(OverlayRules.pick(emptyList(), 0))
    }

    @Test fun pause() {
        assertTrue(OverlayRules.isPaused(pausedUntil = 2_000, now = 1_000))
        assertFalse(OverlayRules.isPaused(pausedUntil = 0, now = 1_000))
    }
}
