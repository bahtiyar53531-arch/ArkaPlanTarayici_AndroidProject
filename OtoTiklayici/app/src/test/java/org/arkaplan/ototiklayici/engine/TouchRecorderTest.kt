package org.arkaplan.ototiklayici.engine

import org.arkaplan.ototiklayici.model.GestureAction
import org.arkaplan.ototiklayici.model.TapAction
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TouchRecorderTest {

    @Test
    fun tapThenSwipeBecomeTapAndGestureWithRealDelay() {
        val r = TouchRecorder()
        r.down(0, 100f, 100f, 1000)
        r.move(0, 102f, 101f, 1030)
        val tap = r.up(0, 102f, 101f, 1080)!!
        assertEquals(80L, tap.strokes.single().duration)

        r.down(0, 100f, 1000f, 1500)
        for (i in 1..10) r.move(0, 100f + i * 40f, 1000f, 1500L + i * 20)
        val swipe = r.up(0, 500f, 1000f, 1720)!!

        var id = 0L
        val actions = RecordingConverter.toActions(listOf(tap, swipe), tapSlopPx = 12f, lastDelayMs = 300) { ++id }
        val first = actions[0] as TapAction
        assertEquals(100f, first.x)
        assertEquals(80L, first.durationMs)
        assertEquals(420L, first.delayAfterMs) // 1500 - 1080
        val second = actions[1] as GestureAction
        assertEquals(220L, second.durationMs)
        assertEquals(300L, second.delayAfterMs)
    }

    @Test
    fun multiTouchCompletesWhenLastFingerLifts() {
        val r = TouchRecorder()
        r.down(0, 100f, 100f, 0)
        r.down(1, 400f, 400f, 30)
        r.move(0, 50f, 50f, 100)
        r.move(1, 450f, 450f, 100)
        assertNull(r.up(0, 40f, 40f, 150))
        assertTrue(r.isTouching)
        val g = r.up(1, 460f, 460f, 200)!!
        assertEquals(2, g.strokes.size)
        assertEquals(listOf(0L, 30L), g.strokes.map { it.startTime }.sorted())
        val action = RecordingConverter.toAction(g, 12f, 0, 1)
        assertTrue(action is GestureAction)
    }

    @Test
    fun smallJitterIsDownsampled() {
        val r = TouchRecorder(minSampleDistancePx = 2f, maxSampleIntervalMs = 1000)
        r.down(0, 0f, 0f, 0)
        for (i in 1..50) r.move(0, (i % 2) * 0.5f, 0f, i.toLong())
        val g = r.up(0, 0f, 0f, 60)!!
        assertEquals(2, g.strokes.single().points.size)
    }

    @Test
    fun cancelDropsGesture() {
        val r = TouchRecorder()
        r.down(0, 0f, 0f, 0)
        r.cancel()
        assertNull(r.up(0, 0f, 0f, 10))
    }
}
