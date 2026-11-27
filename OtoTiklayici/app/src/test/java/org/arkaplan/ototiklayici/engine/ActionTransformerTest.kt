package org.arkaplan.ototiklayici.engine

import org.arkaplan.ototiklayici.model.Macro
import org.arkaplan.ototiklayici.model.RunSettings
import org.arkaplan.ototiklayici.model.TapAction
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.hypot
import kotlin.random.Random

class ActionTransformerTest {

    @Test
    fun speedScalesDurationsAndDelays() {
        val t = ActionTransformer(1f, 1f, speed = 2f, randomOffsetPx = 0, randomDelayMs = 0)
        val tap = TapAction(1, 10f, 10f, durationMs = 100, delayAfterMs = 1000)
        assertEquals(50L, (t.transform(tap) as TapAction).durationMs)
        assertEquals(500L, t.delayAfter(tap))
    }

    @Test
    fun randomOffsetStaysWithinRadius() {
        val t = ActionTransformer(1f, 1f, 1f, randomOffsetPx = 15, randomDelayMs = 0, random = Random(42))
        repeat(500) {
            val out = t.transform(TapAction(1, 500f, 500f)) as TapAction
            assertTrue(hypot(out.x - 500f, out.y - 500f) <= 15.001f)
        }
    }

    @Test
    fun randomDelayStaysWithinRange() {
        val t = ActionTransformer(1f, 1f, 1f, randomOffsetPx = 0, randomDelayMs = 50, random = Random(7))
        repeat(500) {
            val d = t.jitteredDelay(100)
            assertTrue(d in 50..150)
        }
    }

    @Test
    fun macroIsScaledToCurrentScreen() {
        val macro = Macro(id = "a", name = "a", screenWidth = 1000, screenHeight = 2000)
        val t = ActionTransformer.forMacro(macro, RunSettings(), 500, 1000)
        val out = t.transform(TapAction(1, 800f, 1600f)) as TapAction
        assertEquals(400f, out.x)
        assertEquals(800f, out.y)
    }
}
