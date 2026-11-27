package org.arkaplan.ototiklayici.service

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.util.Log
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import org.arkaplan.ototiklayici.engine.DispatchResult
import org.arkaplan.ototiklayici.engine.GestureExecutor
import org.arkaplan.ototiklayici.engine.PlannedDispatch
import org.arkaplan.ototiklayici.engine.PlannedStroke
import kotlin.coroutines.resume

/** Planlanmış hareketleri erişilebilirlik servisinin dispatchGesture API'si ile ekrana uygular. */
class AccessibilityGestureExecutor(private val service: AccessibilityService) : GestureExecutor {

    override suspend fun execute(dispatches: List<PlannedDispatch>): DispatchResult {
        if (dispatches.isEmpty()) return DispatchResult.COMPLETED
        val previous = HashMap<Int, GestureDescription.StrokeDescription>()
        val lastPoints = HashMap<Int, PlannedStroke>()
        var fingerStillDown = false
        try {
            for (dispatch in dispatches) {
                val gesture = try {
                    build(dispatch, previous, lastPoints)
                } catch (e: RuntimeException) {
                    Log.w(TAG, "Hareket oluşturulamadı", e)
                    return DispatchResult.CANCELLED
                }
                fingerStillDown = dispatch.strokes.any { it.willContinue }
                val result = dispatch(gesture)
                if (result != DispatchResult.COMPLETED) {
                    fingerStillDown = false
                    return result
                }
            }
            fingerStillDown = false
            return DispatchResult.COMPLETED
        } finally {
            if (fingerStillDown) {
                // Oynatma durduruldu ama parmak hâlâ basılı: yerinde bırak.
                withContext(NonCancellable) { releaseFingers(previous, lastPoints) }
            }
        }
    }

    private fun build(
        dispatch: PlannedDispatch,
        previous: HashMap<Int, GestureDescription.StrokeDescription>,
        lastPoints: HashMap<Int, PlannedStroke>,
    ): GestureDescription {
        val builder = GestureDescription.Builder()
        for (s in dispatch.strokes) {
            val path = Path().apply {
                val first = s.points.first()
                moveTo(first.x, first.y)
                for (i in 1 until s.points.size) lineTo(s.points[i].x, s.points[i].y)
            }
            val prev = if (s.continuesPrevious) previous[s.key] else null
            val stroke = prev?.continueStroke(path, s.startTime, s.duration, s.willContinue)
                ?: GestureDescription.StrokeDescription(path, s.startTime, s.duration, s.willContinue)
            builder.addStroke(stroke)
            previous[s.key] = stroke
            lastPoints[s.key] = s
        }
        return builder.build()
    }

    private suspend fun releaseFingers(
        previous: HashMap<Int, GestureDescription.StrokeDescription>,
        lastPoints: HashMap<Int, PlannedStroke>,
    ) {
        try {
            val builder = GestureDescription.Builder()
            var any = false
            for ((key, stroke) in previous) {
                if (!stroke.willContinue()) continue
                val p = lastPoints[key]?.points?.last() ?: continue
                val path = Path().apply { moveTo(p.x, p.y) }
                builder.addStroke(stroke.continueStroke(path, 0, 1, false))
                any = true
            }
            if (any) dispatch(builder.build())
        } catch (e: RuntimeException) {
            Log.w(TAG, "Parmak bırakılamadı", e)
        }
    }

    private suspend fun dispatch(gesture: GestureDescription): DispatchResult =
        suspendCancellableCoroutine { cont ->
            val callback = object : AccessibilityService.GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    if (cont.isActive) cont.resume(DispatchResult.COMPLETED)
                }

                override fun onCancelled(gestureDescription: GestureDescription?) {
                    if (cont.isActive) cont.resume(DispatchResult.CANCELLED)
                }
            }
            val accepted = try {
                service.dispatchGesture(gesture, callback, null)
            } catch (e: RuntimeException) {
                Log.w(TAG, "dispatchGesture hatası", e)
                false
            }
            if (!accepted && cont.isActive) cont.resume(DispatchResult.REJECTED)
        }

    companion object {
        private const val TAG = "GestureExecutor"

        val maxStrokes: Int get() = GestureDescription.getMaxStrokeCount()
        val maxDurationMs: Long get() = GestureDescription.getMaxGestureDuration()
    }
}
