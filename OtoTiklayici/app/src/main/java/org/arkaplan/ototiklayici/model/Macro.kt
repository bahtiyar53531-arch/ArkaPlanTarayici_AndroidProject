package org.arkaplan.ototiklayici.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** Ekran üzerinde bir nokta (piksel, ekran koordinatı). */
@Serializable
data class Point(val x: Float, val y: Float)

/** Zaman damgalı nokta. [t] hareketin başlangıcından itibaren milisaniye. */
@Serializable
data class TimedPoint(val x: Float, val y: Float, val t: Long)

/** Tek bir parmağın izi. Noktalar zamana göre sıralıdır. */
@Serializable
data class StrokeData(val points: List<TimedPoint>) {
    val startTime: Long get() = points.first().t
    val endTime: Long get() = points.last().t
    val duration: Long get() = endTime - startTime
}

/** Bir makronun tek adımı. Her adımdan sonra [delayAfterMs] kadar beklenir. */
@Serializable
sealed class MacroAction {
    abstract val id: Long
    abstract val delayAfterMs: Long
    abstract val enabled: Boolean

    abstract fun withDelay(delayMs: Long): MacroAction
    abstract fun withEnabled(value: Boolean): MacroAction
    abstract fun withId(newId: Long): MacroAction

    /** Bu adımın kaç dokunuş saydığı (istatistik için). */
    abstract val tapWeight: Int
}

/** Tek noktaya dokunma. [count] > 1 ise art arda hızlı dokunuşlar (çift/üçlü tık). */
@Serializable
@SerialName("tap")
data class TapAction(
    override val id: Long,
    val x: Float,
    val y: Float,
    val durationMs: Long = 40,
    val count: Int = 1,
    val countGapMs: Long = 70,
    override val delayAfterMs: Long = 100,
    override val enabled: Boolean = true,
) : MacroAction() {
    override fun withDelay(delayMs: Long) = copy(delayAfterMs = delayMs)
    override fun withEnabled(value: Boolean) = copy(enabled = value)
    override fun withId(newId: Long) = copy(id = newId)
    override val tapWeight: Int get() = count.coerceAtLeast(1)
}

/** İki nokta arasında kaydırma. [holdMs] > 0 ise önce basılı tutup sonra sürükler (sürükle-bırak). */
@Serializable
@SerialName("swipe")
data class SwipeAction(
    override val id: Long,
    val x1: Float,
    val y1: Float,
    val x2: Float,
    val y2: Float,
    val durationMs: Long = 300,
    val holdMs: Long = 0,
    override val delayAfterMs: Long = 300,
    override val enabled: Boolean = true,
) : MacroAction() {
    override fun withDelay(delayMs: Long) = copy(delayAfterMs = delayMs)
    override fun withEnabled(value: Boolean) = copy(enabled = value)
    override fun withId(newId: Long) = copy(id = newId)
    override val tapWeight: Int get() = 1
}

/** Kaydedilmiş serbest hareket: bir veya birden çok parmak, gerçek zamanlamasıyla. */
@Serializable
@SerialName("gesture")
data class GestureAction(
    override val id: Long,
    val strokes: List<StrokeData>,
    override val delayAfterMs: Long = 300,
    override val enabled: Boolean = true,
) : MacroAction() {
    override fun withDelay(delayMs: Long) = copy(delayAfterMs = delayMs)
    override fun withEnabled(value: Boolean) = copy(enabled = value)
    override fun withId(newId: Long) = copy(id = newId)
    override val tapWeight: Int get() = 1
    val durationMs: Long
        get() = if (strokes.isEmpty()) 0 else strokes.maxOf { it.endTime } - strokes.minOf { it.startTime }
}

@Serializable
enum class StopMode { INFINITE, CYCLES, TIME }

/** Makronun nasıl oynatılacağı. */
@Serializable
data class RunSettings(
    val stopMode: StopMode = StopMode.INFINITE,
    val cycles: Int = 10,
    val timeLimitSec: Int = 60,
    val startDelaySec: Int = 0,
    val cycleDelayMs: Long = 0,
    /** Oynatma hızı çarpanı: 2.0 = iki kat hızlı. Beklemeler ve hareket süreleri ölçeklenir. */
    val speed: Float = 1f,
    /** Her beklemeye ± rastgele eklenen süre (insan gibi davranış). */
    val randomDelayMs: Int = 0,
    /** Her dokunuşun konumuna eklenen rastgele sapma yarıçapı (piksel). */
    val randomOffsetPx: Int = 0,
    /** Makro farklı ekran boyutunda/yönünde oynatılırsa koordinatları oranla. */
    val scaleToScreen: Boolean = true,
)

@Serializable
data class Macro(
    val id: String,
    val name: String,
    val actions: List<MacroAction> = emptyList(),
    val settings: RunSettings = RunSettings(),
    val screenWidth: Int = 0,
    val screenHeight: Int = 0,
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
    val runCount: Int = 0,
    val lastRunAt: Long = 0,
    val formatVersion: Int = 1,
) {
    val enabledActions: List<MacroAction> get() = actions.filter { it.enabled }

    /** Tek turun yaklaşık süresi (ms), hız çarpanı uygulanmış. */
    fun estimatedCycleMs(): Long {
        val speed = settings.speed.coerceIn(MIN_SPEED, MAX_SPEED)
        val raw = enabledActions.sumOf { actionDurationMs(it) + it.delayAfterMs } + settings.cycleDelayMs
        return (raw / speed).toLong()
    }

    companion object {
        const val MIN_SPEED = 0.1f
        const val MAX_SPEED = 10f
    }
}

fun actionDurationMs(action: MacroAction): Long = when (action) {
    is TapAction -> action.durationMs * action.count.coerceAtLeast(1) +
        action.countGapMs * (action.count.coerceAtLeast(1) - 1)
    is SwipeAction -> action.holdMs + action.durationMs
    is GestureAction -> action.durationMs
}

/** Yedekleme/paylaşım dosyası biçimi. */
@Serializable
data class MacroBundle(
    val format: String = FORMAT_ID,
    val version: Int = 1,
    val exportedAt: Long = 0,
    val macros: List<Macro> = emptyList(),
) {
    companion object {
        const val FORMAT_ID = "ototiklayici"
    }
}
