package org.arkaplan.ototiklayici.engine

import org.arkaplan.ototiklayici.model.GestureAction
import org.arkaplan.ototiklayici.model.MacroAction
import org.arkaplan.ototiklayici.model.Point
import org.arkaplan.ototiklayici.model.StrokeData
import org.arkaplan.ototiklayici.model.SwipeAction
import org.arkaplan.ototiklayici.model.TapAction
import org.arkaplan.ototiklayici.model.TimedPoint
import kotlin.math.abs
import kotlin.math.hypot

/**
 * Sistemin hareket enjeksiyonuna (GestureDescription) gönderilecek tek bir parmak izi.
 * Android sınıflarından bağımsızdır; böylece JVM üzerinde test edilebilir.
 *
 * @property key Aynı fiziksel parmağı birden çok gönderim boyunca izlemek için kimlik.
 * @property continuesPrevious Bir önceki gönderimdeki aynı [key] izinin devamı mı (parmak kalkmaz).
 * @property willContinue Bu iz bir sonraki gönderimde devam edecek mi (parmak basılı kalır).
 */
data class PlannedStroke(
    val key: Int,
    val points: List<Point>,
    val startTime: Long,
    val duration: Long,
    val willContinue: Boolean = false,
    val continuesPrevious: Boolean = false,
)

/** Tek bir dispatchGesture çağrısına karşılık gelir. */
data class PlannedDispatch(val strokes: List<PlannedStroke>) {
    val totalDuration: Long get() = strokes.maxOfOrNull { it.startTime + it.duration } ?: 0
}

data class PlannerConfig(
    val screenWidth: Int,
    val screenHeight: Int,
    val maxStrokes: Int = 10,
    val maxDurationMs: Long = 60_000,
    /** Kayıtlı tek parmak hareketlerini hız profiliyle birlikte parçalı oynat. */
    val precise: Boolean = true,
    /** Hassas modda tek düze hız varsayımından izin verilen en büyük sapma (piksel). */
    val toleranceTrackPx: Float = 20f,
    val maxSegments: Int = 120,
)

object GesturePlanner {

    fun plan(action: MacroAction, config: PlannerConfig): List<PlannedDispatch> = when (action) {
        is TapAction -> planTap(action.x, action.y, action.durationMs, action.count, action.countGapMs, config)
        is SwipeAction -> planSwipe(action, config)
        is GestureAction -> planGesture(action.strokes, config)
    }

    fun planTap(
        x: Float,
        y: Float,
        durationMs: Long,
        count: Int,
        gapMs: Long,
        config: PlannerConfig,
    ): List<PlannedDispatch> {
        val p = clamp(Point(x, y), config)
        val duration = durationMs.coerceIn(1, config.maxDurationMs)
        val gap = gapMs.coerceAtLeast(1)
        val total = count.coerceAtLeast(1)
        val perDispatch = config.maxStrokes.coerceAtLeast(1)
        val result = mutableListOf<PlannedDispatch>()
        var done = 0
        while (done < total) {
            val strokes = mutableListOf<PlannedStroke>()
            var start = 0L
            while (done < total && strokes.size < perDispatch && start + duration <= config.maxDurationMs) {
                strokes += PlannedStroke(key = done, points = listOf(p), startTime = start, duration = duration)
                start += duration + gap
                done++
            }
            if (strokes.isEmpty()) break
            result += PlannedDispatch(strokes)
        }
        return result
    }

    fun planSwipe(action: SwipeAction, config: PlannerConfig): List<PlannedDispatch> {
        val a = clamp(Point(action.x1, action.y1), config)
        val b = clamp(Point(action.x2, action.y2), config)
        val duration = action.durationMs.coerceIn(1, config.maxDurationMs)
        if (action.holdMs <= 0) {
            return listOf(PlannedDispatch(listOf(PlannedStroke(0, listOf(a, b), 0, duration))))
        }
        val hold = action.holdMs.coerceIn(1, config.maxDurationMs)
        return listOf(
            PlannedDispatch(listOf(PlannedStroke(0, listOf(a, a), 0, hold, willContinue = true))),
            PlannedDispatch(listOf(PlannedStroke(0, listOf(a, b), 0, duration, continuesPrevious = true))),
        )
    }

    fun planGesture(strokes: List<StrokeData>, config: PlannerConfig): List<PlannedDispatch> {
        val usable = strokes.filter { it.points.isNotEmpty() }.sortedBy { it.startTime }
        if (usable.isEmpty()) return emptyList()

        if (usable.size == 1 && config.precise && usable[0].points.size > 2) {
            val pts = usable[0].points
            val segments = segmentWithBudget(pts, config)
            if (segments.size > 1) {
                return segments.mapIndexed { index, range ->
                    val slice = pts.subList(range.first, range.last + 1)
                    PlannedDispatch(
                        listOf(
                            PlannedStroke(
                                key = 0,
                                points = slice.map { clamp(Point(it.x, it.y), config) },
                                startTime = 0,
                                duration = (slice.last().t - slice.first().t).coerceIn(1, config.maxDurationMs),
                                willContinue = index < segments.lastIndex,
                                continuesPrevious = index > 0,
                            )
                        )
                    )
                }
            }
        }

        val t0 = usable.first().startTime
        val planned = usable.take(config.maxStrokes).mapIndexedNotNull { index, stroke ->
            val start = stroke.startTime - t0
            if (start >= config.maxDurationMs) return@mapIndexedNotNull null
            val duration = stroke.duration.coerceAtLeast(1).coerceAtMost(config.maxDurationMs - start)
            PlannedStroke(
                key = index,
                points = stroke.points.map { clamp(Point(it.x, it.y), config) },
                startTime = start,
                duration = duration.coerceAtLeast(1),
            )
        }
        return if (planned.isEmpty()) emptyList() else listOf(PlannedDispatch(planned))
    }

    private fun segmentWithBudget(pts: List<TimedPoint>, config: PlannerConfig): List<IntRange> {
        var tolerance = config.toleranceTrackPx
        var segments = segmentStroke(pts, tolerance, config.maxDurationMs - 1)
        while (segments.size > config.maxSegments && tolerance < 2000f) {
            tolerance *= 2f
            segments = segmentStroke(pts, tolerance, config.maxDurationMs - 1)
        }
        return segments
    }

    /**
     * Bir izi, her parçada parmağın yaklaşık sabit hızla ilerlediği parçalara böler.
     * Parçalar uç noktalarını paylaşır (i. parçanın sonu = i+1. parçanın başı).
     *
     * Ölçüt: parça içindeki her nokta için "tek düze hızla gitseydi o anda yol üzerinde
     * nerede olurdu" ile "gerçekte nerede" arasındaki yol farkı [tolerancePx]'i aşmamalı.
     * Böylece basılı tutma - sürükleme - durma gibi hız değişimleri korunur.
     */
    internal fun segmentStroke(pts: List<TimedPoint>, tolerancePx: Float, maxSegmentMs: Long): List<IntRange> {
        val n = pts.size
        if (n < 2) return listOf(0 until n)
        val cum = DoubleArray(n)
        for (i in 1 until n) {
            cum[i] = cum[i - 1] + hypot((pts[i].x - pts[i - 1].x).toDouble(), (pts[i].y - pts[i - 1].y).toDouble())
        }

        fun fits(s: Int, e: Int): Boolean {
            val span = (pts[e].t - pts[s].t).toDouble()
            val length = cum[e] - cum[s]
            if (length <= tolerancePx) return true
            if (span <= 0.0) return false
            for (j in s + 1 until e) {
                val expected = length * (pts[j].t - pts[s].t) / span
                val actual = cum[j] - cum[s]
                if (abs(expected - actual) > tolerancePx) return false
            }
            return true
        }

        val result = mutableListOf<IntRange>()
        var s = 0
        while (s < n - 1) {
            var good = s + 1
            var e = s + 2
            while (e < n) {
                if (pts[e].t - pts[s].t > maxSegmentMs) break
                if (!fits(s, e)) break
                good = e
                e++
            }
            result += s..good
            s = good
        }
        return result
    }

    private fun clamp(p: Point, config: PlannerConfig): Point {
        val maxX = if (config.screenWidth > 0) (config.screenWidth - 1).toFloat() else Float.MAX_VALUE
        val maxY = if (config.screenHeight > 0) (config.screenHeight - 1).toFloat() else Float.MAX_VALUE
        return Point(p.x.coerceIn(0f, maxX), p.y.coerceIn(0f, maxY))
    }
}
