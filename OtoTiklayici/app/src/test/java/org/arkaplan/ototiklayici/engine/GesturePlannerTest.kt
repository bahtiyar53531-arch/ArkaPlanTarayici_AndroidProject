package org.arkaplan.ototiklayici.engine

import org.arkaplan.ototiklayici.model.StrokeData
import org.arkaplan.ototiklayici.model.SwipeAction
import org.arkaplan.ototiklayici.model.TimedPoint
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GesturePlannerTest {
    private val config = PlannerConfig(screenWidth = 1080, screenHeight = 2400)

    @Test
    fun singleTapIsOneStrokeWithPositiveDuration() {
        val plan = GesturePlanner.planTap(100f, 200f, 0, 1, 70, config)
        assertEquals(1, plan.size)
        val stroke = plan[0].strokes.single()
        assertEquals(1L, stroke.duration)
        assertEquals(100f, stroke.points.single().x)
    }

    @Test
    fun multiTapIsSequentialStrokes() {
        val plan = GesturePlanner.planTap(10f, 10f, 40, 3, 60, config)
        val strokes = plan.single().strokes
        assertEquals(listOf(0L, 100L, 200L), strokes.map { it.startTime })
        assertTrue(strokes.none { it.willContinue || it.continuesPrevious })
    }

    @Test
    fun tapsBeyondStrokeLimitAreSplit() {
        val plan = GesturePlanner.planTap(10f, 10f, 10, 25, 10, config.copy(maxStrokes = 10))
        assertEquals(listOf(10, 10, 5), plan.map { it.strokes.size })
    }

    @Test
    fun coordinatesAreClampedToScreen() {
        val plan = GesturePlanner.planTap(-50f, 5000f, 10, 1, 10, config)
        val p = plan.single().strokes.single().points.single()
        assertEquals(0f, p.x)
        assertEquals(2399f, p.y)
    }

    @Test
    fun swipeWithHoldContinuesSameStroke() {
        val plan = GesturePlanner.planSwipe(SwipeAction(1, 10f, 10f, 500f, 10f, durationMs = 300, holdMs = 800), config)
        assertEquals(2, plan.size)
        assertTrue(plan[0].strokes.single().willContinue)
        assertEquals(800L, plan[0].strokes.single().duration)
        assertTrue(plan[1].strokes.single().continuesPrevious)
        assertFalse(plan[1].strokes.single().willContinue)
        assertEquals(plan[0].strokes.single().points.last(), plan[1].strokes.single().points.first())
    }

    @Test
    fun uniformDragIsOneDispatch() {
        val pts = (0..50).map { TimedPoint(100f + it * 10f, 500f, it * 10L) }
        val plan = GesturePlanner.planGesture(listOf(StrokeData(pts)), config)
        assertEquals(1, plan.size)
        assertEquals(500L, plan[0].strokes.single().duration)
    }

    @Test
    fun holdThenDragIsSplitAndContinuous() {
        // 1 saniye yerinde (küçük titreme), sonra 200 ms'de 600 px sürükleme.
        val hold = (0..20).map { TimedPoint(300f + (it % 2), 800f, it * 50L) }
        val drag = (1..20).map { TimedPoint(300f + it * 30f, 800f, 1000L + it * 10L) }
        val plan = GesturePlanner.planGesture(listOf(StrokeData(hold + drag)), config)
        assertTrue("parçalanmalı", plan.size >= 2)
        plan.forEachIndexed { i, d ->
            val s = d.strokes.single()
            assertEquals(i > 0, s.continuesPrevious)
            assertEquals(i < plan.lastIndex, s.willContinue)
            if (i > 0) assertEquals(plan[i - 1].strokes.single().points.last(), s.points.first())
        }
        val first = plan.first().strokes.single()
        assertTrue("basılı tutma korunmalı: ${first.duration}", first.duration >= 900)
        assertEquals(1200L, plan.sumOf { it.strokes.single().duration })
    }

    @Test
    fun impreciseModeKeepsSingleDispatch() {
        val hold = (0..20).map { TimedPoint(300f, 800f, it * 50L) }
        val drag = (1..20).map { TimedPoint(300f + it * 30f, 800f, 1000L + it * 10L) }
        val plan = GesturePlanner.planGesture(listOf(StrokeData(hold + drag)), config.copy(precise = false))
        assertEquals(1, plan.size)
    }

    @Test
    fun multiTouchKeepsRelativeStartTimes() {
        val a = StrokeData(listOf(TimedPoint(100f, 100f, 1000), TimedPoint(50f, 50f, 1300)))
        val b = StrokeData(listOf(TimedPoint(300f, 300f, 1050), TimedPoint(350f, 350f, 1300)))
        val plan = GesturePlanner.planGesture(listOf(b, a), config)
        val strokes = plan.single().strokes
        assertEquals(listOf(0L, 50L), strokes.map { it.startTime })
        assertEquals(listOf(300L, 250L), strokes.map { it.duration })
    }

    @Test
    fun segmentsShareEndpoints() {
        val pts = listOf(0L, 100, 200, 300, 1300, 1310, 1320).mapIndexed { i, t -> TimedPoint(i * 50f, 0f, t) }
        val segs = GesturePlanner.segmentStroke(pts, 20f, 59_000)
        assertEquals(0, segs.first().first)
        assertEquals(pts.lastIndex, segs.last().last)
        for (i in 1 until segs.size) assertEquals(segs[i - 1].last, segs[i].first)
    }
}
