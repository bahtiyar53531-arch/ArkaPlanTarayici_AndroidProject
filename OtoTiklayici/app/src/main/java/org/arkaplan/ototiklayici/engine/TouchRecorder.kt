package org.arkaplan.ototiklayici.engine

import org.arkaplan.ototiklayici.model.GestureAction
import org.arkaplan.ototiklayici.model.MacroAction
import org.arkaplan.ototiklayici.model.StrokeData
import org.arkaplan.ototiklayici.model.TapAction
import org.arkaplan.ototiklayici.model.TimedPoint
import kotlin.math.hypot

/** Kayıt sırasında tamamlanmış tek bir hareket (tüm parmaklar kalktığında biter). */
data class RecordedGesture(
    /** Mutlak başlangıç zamanı (ms, örn. SystemClock.uptimeMillis). */
    val startTime: Long,
    /** Mutlak bitiş zamanı. */
    val endTime: Long,
    /** Zamanları [startTime]'a göre göreli izler. */
    val strokes: List<StrokeData>,
)

/**
 * Ham dokunma olaylarını (parmak kimliği + ekran koordinatı + zaman) hareketlere dönüştürür.
 * MotionEvent'ten bağımsızdır; servis olayları buraya aktarır.
 */
class TouchRecorder(
    private val minSampleDistancePx: Float = 1.5f,
    private val maxSampleIntervalMs: Long = 40,
) {
    private val active = LinkedHashMap<Int, MutableList<TimedPoint>>()
    private val finished = mutableListOf<List<TimedPoint>>()
    private var gestureStart = -1L

    val isTouching: Boolean get() = active.isNotEmpty()

    fun down(pointerId: Int, x: Float, y: Float, time: Long) {
        if (active.isEmpty() && finished.isEmpty()) gestureStart = time
        active[pointerId] = mutableListOf(TimedPoint(x, y, time))
    }

    fun move(pointerId: Int, x: Float, y: Float, time: Long) {
        val list = active[pointerId] ?: return
        val last = list.last()
        if (time < last.t) return
        val dist = hypot(x - last.x, y - last.y)
        if (dist >= minSampleDistancePx || time - last.t >= maxSampleIntervalMs) {
            list += TimedPoint(x, y, time)
        }
    }

    /** Parmak kalktı. Son parmak da kalktıysa tamamlanan hareketi döndürür. */
    fun up(pointerId: Int, x: Float, y: Float, time: Long): RecordedGesture? {
        val list = active.remove(pointerId) ?: return null
        val last = list.last()
        if (time >= last.t) {
            if (time == last.t && list.size > 1) list[list.lastIndex] = TimedPoint(x, y, time)
            else list += TimedPoint(x, y, time)
        }
        finished += list
        if (active.isNotEmpty()) return null
        val start = gestureStart
        val strokes = finished.map { pts -> StrokeData(pts.map { TimedPoint(it.x, it.y, it.t - start) }) }
        val end = finished.maxOf { it.last().t }
        finished.clear()
        gestureStart = -1L
        return RecordedGesture(start, end, strokes)
    }

    fun cancel() {
        active.clear()
        finished.clear()
        gestureStart = -1L
    }
}

object RecordingConverter {

    /**
     * Kaydedilen hareketleri makro adımlarına çevirir. Yerinde kalan tek parmaklı
     * hareketler (titreme payı [tapSlopPx] içinde) dokunma/uzun basma olur; diğerleri
     * gerçek izleriyle serbest hareket olarak saklanır. Adımlar arası beklemeler
     * gerçek zamanlamadan hesaplanır.
     */
    fun toActions(
        gestures: List<RecordedGesture>,
        tapSlopPx: Float,
        lastDelayMs: Long,
        nextId: () -> Long,
    ): List<MacroAction> = gestures.mapIndexed { index, g ->
        val delay = if (index < gestures.lastIndex) {
            (gestures[index + 1].startTime - g.endTime).coerceAtLeast(0)
        } else lastDelayMs
        toAction(g, tapSlopPx, delay, nextId())
    }

    fun toAction(g: RecordedGesture, tapSlopPx: Float, delayAfterMs: Long, id: Long): MacroAction {
        val single = g.strokes.singleOrNull()
        if (single != null && isStationary(single, tapSlopPx)) {
            val first = single.points.first()
            return TapAction(
                id = id,
                x = first.x,
                y = first.y,
                durationMs = single.duration.coerceAtLeast(1),
                delayAfterMs = delayAfterMs,
            )
        }
        return GestureAction(id = id, strokes = g.strokes, delayAfterMs = delayAfterMs)
    }

    private fun isStationary(stroke: StrokeData, slop: Float): Boolean {
        val first = stroke.points.first()
        return stroke.points.all { hypot(it.x - first.x, it.y - first.y) <= slop }
    }
}
