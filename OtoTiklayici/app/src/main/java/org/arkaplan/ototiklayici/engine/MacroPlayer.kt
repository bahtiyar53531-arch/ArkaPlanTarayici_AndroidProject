package org.arkaplan.ototiklayici.engine

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.arkaplan.ototiklayici.model.Macro
import org.arkaplan.ototiklayici.model.MacroAction
import org.arkaplan.ototiklayici.model.StopMode

enum class DispatchResult {
    /** Hareket tamamlandı. */
    COMPLETED,

    /** Sistem hareketi yarıda kesti (ör. kullanıcı ekrana dokundu). Oynatma sürer. */
    CANCELLED,

    /** Sistem hareketi kabul etmedi (servis bağlı değil vb.). Oynatma durur. */
    REJECTED,
}

/** Planlanmış hareketleri gerçekten ekrana gönderen katman (Android'de erişilebilirlik servisi). */
fun interface GestureExecutor {
    suspend fun execute(dispatches: List<PlannedDispatch>): DispatchResult
}

enum class FinishReason { COMPLETED, STOPPED, TIME_LIMIT, ERROR }

sealed interface PlayerState {
    data object Idle : PlayerState

    data class Countdown(val secondsLeft: Int) : PlayerState

    data class Running(
        val cycle: Int,
        val totalCycles: Int?,
        val actionIndex: Int,
        val actionCount: Int,
        val taps: Long,
        val startedAt: Long,
        val timeLimitMs: Long?,
    ) : PlayerState

    data class Finished(
        val reason: FinishReason,
        val cycles: Int,
        val taps: Long,
        val elapsedMs: Long,
    ) : PlayerState
}

/**
 * Bir makroyu, çalıştırma ayarlarına göre (sonsuz / tur sayısı / süre) döngüde oynatır.
 */
class MacroPlayer(
    private val scope: CoroutineScope,
    private val executor: GestureExecutor,
    private val clock: () -> Long,
) {
    private val _state = MutableStateFlow<PlayerState>(PlayerState.Idle)
    val state: StateFlow<PlayerState> = _state.asStateFlow()

    private var job: Job? = null
    private var generation = 0

    val isActive: Boolean get() = job?.isActive == true

    /** Her adım ekrana gönderilmeden hemen önce çağrılır (dokunuş göstergesi için). */
    var onBeforeAction: ((MacroAction) -> Unit)? = null

    /** Oynatma her ne sebeple biterse bitsin çağrılır. */
    var onFinished: ((PlayerState.Finished) -> Unit)? = null

    fun start(macro: Macro, config: PlannerConfig, transformer: ActionTransformer) {
        stop()
        val actions = macro.enabledActions
        if (actions.isEmpty()) return
        val settings = macro.settings
        val totalCycles = if (settings.stopMode == StopMode.CYCLES) settings.cycles.coerceAtLeast(1) else null
        val timeLimitMs = if (settings.stopMode == StopMode.TIME) settings.timeLimitSec.coerceAtLeast(1) * 1000L else null

        val myGeneration = ++generation
        job = scope.launch {
            var cycles = 0
            var taps = 0L
            var startedAt = clock()
            var reason = FinishReason.COMPLETED
            try {
                for (s in settings.startDelaySec downTo 1) {
                    _state.value = PlayerState.Countdown(s)
                    delay(1000)
                }
                startedAt = clock()

                suspend fun runLoop(): Boolean {
                    while (currentCoroutineContext().isActive) {
                        if (totalCycles != null && cycles >= totalCycles) return true
                        for ((index, original) in actions.withIndex()) {
                            _state.value = PlayerState.Running(
                                cycle = cycles + 1,
                                totalCycles = totalCycles,
                                actionIndex = index,
                                actionCount = actions.size,
                                taps = taps,
                                startedAt = startedAt,
                                timeLimitMs = timeLimitMs,
                            )
                            val action = transformer.transform(original)
                            val plan = GesturePlanner.plan(action, config)
                            onBeforeAction?.invoke(action)
                            when (executor.execute(plan)) {
                                DispatchResult.COMPLETED -> taps += original.tapWeight
                                DispatchResult.CANCELLED -> Unit
                                DispatchResult.REJECTED -> return false
                            }
                            val wait = transformer.delayAfter(original)
                            if (wait > 0) delay(wait)
                        }
                        cycles++
                        if (settings.cycleDelayMs > 0 && (totalCycles == null || cycles < totalCycles)) {
                            delay(transformer.jitteredDelay(settings.cycleDelayMs))
                        }
                    }
                    return true
                }

                val outcome = if (timeLimitMs != null) withTimeoutOrNull(timeLimitMs) { runLoop() } else runLoop()
                reason = when (outcome) {
                    null -> FinishReason.TIME_LIMIT
                    false -> FinishReason.ERROR
                    true -> FinishReason.COMPLETED
                }
            } catch (e: CancellationException) {
                reason = FinishReason.STOPPED
                throw e
            } finally {
                val finished = PlayerState.Finished(reason, cycles, taps, (clock() - startedAt).coerceAtLeast(0))
                // Bu sırada yeni bir oynatma başlatıldıysa onun durumunu ezme.
                if (myGeneration == generation) {
                    _state.value = finished
                    onFinished?.invoke(finished)
                }
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
    }

    fun reset() {
        if (!isActive) _state.value = PlayerState.Idle
    }
}
