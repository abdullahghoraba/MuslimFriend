package com.muslimfriend.app.overlay
import org.junit.Assert.*
import org.junit.Test
import org.json.JSONObject
class AthanRulesTest {
    @Test fun flipIsDetectedBothWaysButNotFromTilted() {
        assertEquals(1, StopRules.face(9.5f))
        assertEquals(-1, StopRules.face(-9.5f))
        assertEquals(0, StopRules.face(3f))
        assertTrue(StopRules.flipped(1, -1))
        assertTrue(StopRules.flipped(-1, 1))
        assertFalse(StopRules.flipped(0, -1)) // was held/tilted, e.g. already face down when it started
        assertFalse(StopRules.flipped(1, 0))
        assertFalse(StopRules.flipped(1, 1))
    }

    @Test fun shakeNeedsAStrongJolt() {
        assertTrue(StopRules.gForce(0f, 0f, 9.81f) < StopRules.SHAKE_G)
        assertTrue(StopRules.gForce(20f, 15f, 9.81f) > StopRules.SHAKE_G)
    }

    @Test fun stopWaysRoundTripAndUnknownOnesAreDropped() {
        val json = org.json.JSONObject().put("id", "a").put("prayer", "fajr").put("kind", "athan").put("at", 1L)
            .put("title", "t").put("body", "b").put("sound", "tone").put("volume", 0.5)
            .put("stopOn", org.json.JSONArray(listOf("flip", "volume", "bogus")))
        val event = AthanEvent.fromJson(json)
        assertEquals(setOf("flip", "volume"), event.stopOn)
        assertEquals(event, AthanEvent.fromJson(event.toJson()))
        assertEquals(emptySet<String>(), AthanEvent.fromJson(json.apply { remove("stopOn") }).stopOn)
    }

    private fun event(at: Long) = AthanEvent("fajr", "fajr", "athan", at, "الفجر", "حان وقت الصلاة", "tone", 0.5f, 12)
    @Test fun nextSkipsPastAndSelectsEarliestRegardlessOfOrder() {
        val events = listOf(event(900), event(3000), event(1000), event(2000))
        assertEquals(2000L, AthanRules.next(events, 1000)!!.at)
        assertNull(AthanRules.next(events, 3000)); assertNull(AthanRules.next(emptyList(), 1000))
    }
    @Test fun restoreTimeUsesMinutesWithoutIntOverflow() {
        assertEquals(721000L, AthanRules.restoreAt(1000, 12))
        assertEquals(1000L, AthanRules.restoreAt(1000, -1))
        assertEquals(128849018820000L, AthanRules.restoreAt(0, Int.MAX_VALUE))
    }
    @Test fun jsonRoundTripPreservesUnicodeAndAllFields() {
        for (sound in listOf("none", "system", "tone", "file:/data/user/0/com.muslimfriend.app/files/أذان.mp3")) {
            val original = event(1792520000000).copy(sound = sound)
            assertEquals(original, AthanEvent.fromJson(JSONObject(original.toJson().toString())))
        }
    }
    @Test fun invalidEventIsRejected() {
        assertThrows(IllegalArgumentException::class.java) { AthanEvent.fromJson(event(1).toJson().put("volume", 1.2)) }
        assertThrows(IllegalArgumentException::class.java) { AthanEvent.fromJson(event(1).toJson().put("sound", "file:relative.mp3")) }
    }
}
