package org.arkaplan.ototiklayici.engine

import org.arkaplan.ototiklayici.model.GestureAction
import org.arkaplan.ototiklayici.model.Macro
import org.arkaplan.ototiklayici.model.MacroAction
import org.arkaplan.ototiklayici.model.RunSettings
import org.arkaplan.ototiklayici.model.StrokeData
import org.arkaplan.ototiklayici.model.SwipeAction
import org.arkaplan.ototiklayici.model.TapAction
import org.arkaplan.ototiklayici.model.TimedPoint
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.roundToLong
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.random.Random

/**
 * Oynatmadan hemen önce her adıma ekran ölçeği, hız çarpanı ve
 * insan benzeri rastgelelik (konum ve süre sapması) uygular.
 */
class ActionTransformer(
    private val scaleX: Float,
    private val scaleY: Float,
    speed: Float,
    private val randomOffsetPx: Int,
    private val randomDelayMs: Int,
    private val random: Random = Random.Default,
) {
    private val speed = speed.coerceIn(Macro.MIN_SPEED, Macro.MAX_SPEED)

    fun transform(action: MacroAction): MacroAction {
        val (dx, dy) = randomOffset()
        return when (action) {
            is TapAction -> action.copy(
                x = action.x * scaleX + dx,
                y = action.y * scaleY + dy,
                durationMs = scaleTime(action.durationMs).coerceAtLeast(1),
                countGapMs = scaleTime(action.countGapMs).coerceAtLeast(1),
            )
            is SwipeAction -> action.copy(
                x1 = action.x1 * scaleX + dx,
                y1 = action.y1 * scaleY + dy,
                x2 = action.x2 * scaleX + dx,
                y2 = action.y2 * scaleY + dy,
                durationMs = scaleTime(action.durationMs).coerceAtLeast(1),
                holdMs = scaleTime(action.holdMs),
            )
            is GestureAction -> action.copy(
                strokes = action.strokes.map { stroke ->
                    StrokeData(stroke.points.map {
                        TimedPoint(it.x * scaleX + dx, it.y * scaleY + dy, scaleTime(it.t))
                    })
                }
            )
        }
    }

    /** Adımdan sonra beklenecek süre (rastgele sapma ve hız uygulanmış). */
    fun delayAfter(action: MacroAction): Long = jitteredDelay(action.delayAfterMs)

    fun jitteredDelay(baseMs: Long): Long {
        val jitter = if (randomDelayMs > 0) random.nextLong(-randomDelayMs.toLong(), randomDelayMs.toLong() + 1) else 0L
        return scaleTime((baseMs + jitter).coerceAtLeast(0))
    }

    private fun scaleTime(ms: Long): Long = (ms / speed).roundToLong().coerceAtLeast(0)

    private fun randomOffset(): Pair<Float, Float> {
        if (randomOffsetPx <= 0) return 0f to 0f
        // Disk içinde düzgün dağılım.
        val r = randomOffsetPx * sqrt(random.nextDouble())
        val theta = random.nextDouble() * 2 * PI
        return (r * cos(theta)).toFloat() to (r * sin(theta)).toFloat()
    }

    companion object {
        fun forMacro(
            macro: Macro,
            settings: RunSettings,
            screenWidth: Int,
            screenHeight: Int,
            random: Random = Random.Default,
        ): ActionTransformer {
            val canScale = settings.scaleToScreen && macro.screenWidth > 0 && macro.screenHeight > 0
            val sx = if (canScale) screenWidth.toFloat() / macro.screenWidth else 1f
            val sy = if (canScale) screenHeight.toFloat() / macro.screenHeight else 1f
            return ActionTransformer(sx, sy, settings.speed, settings.randomOffsetPx, settings.randomDelayMs, random)
        }
    }
}
