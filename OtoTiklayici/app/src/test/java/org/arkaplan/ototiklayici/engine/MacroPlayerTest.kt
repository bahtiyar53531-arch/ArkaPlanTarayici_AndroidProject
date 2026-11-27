package org.arkaplan.ototiklayici.engine

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.currentTime
import kotlinx.coroutines.test.runCurrent
import org.arkaplan.ototiklayici.model.Macro
import org.arkaplan.ototiklayici.model.RunSettings
import org.arkaplan.ototiklayici.model.StopMode
import org.arkaplan.ototiklayici.model.TapAction
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class MacroPlayerTest {
    private val config = PlannerConfig(1080, 2400)
    private val noJitter = ActionTransformer(1f, 1f, 1f, 0, 0)

    private fun macro(settings: RunSettings, vararg actions: TapAction) =
        Macro(id = "m", name = "m", actions = actions.toList(), settings = settings)

    @Test
    fun runsExactCycleCount() {
        val scope = TestScope(StandardTestDispatcher())
        var calls = 0
        val player = MacroPlayer(scope, { calls++; DispatchResult.COMPLETED }, { scope.currentTime })
        player.start(
            macro(RunSettings(stopMode = StopMode.CYCLES, cycles = 3), TapAction(1, 1f, 1f), TapAction(2, 2f, 2f, count = 2)),
            config, noJitter,
        )
        scope.advanceUntilIdle()
        assertEquals(6, calls)
        val finished = player.state.value as PlayerState.Finished
        assertEquals(FinishReason.COMPLETED, finished.reason)
        assertEquals(3, finished.cycles)
        assertEquals(9L, finished.taps)
    }

    @Test
    fun timeLimitStopsPlayback() {
        val scope = TestScope(StandardTestDispatcher())
        val player = MacroPlayer(scope, { DispatchResult.COMPLETED }, { scope.currentTime })
        player.start(macro(RunSettings(stopMode = StopMode.TIME, timeLimitSec = 2), TapAction(1, 1f, 1f, delayAfterMs = 100)), config, noJitter)
        scope.advanceUntilIdle()
        val finished = player.state.value as PlayerState.Finished
        assertEquals(FinishReason.TIME_LIMIT, finished.reason)
        assertTrue(finished.taps in 19L..21L)
    }

    @Test
    fun countdownThenStopByUser() {
        val scope = TestScope(StandardTestDispatcher())
        val player = MacroPlayer(scope, { DispatchResult.COMPLETED }, { scope.currentTime })
        player.start(macro(RunSettings(startDelaySec = 3), TapAction(1, 1f, 1f)), config, noJitter)
        scope.runCurrent()
        assertEquals(PlayerState.Countdown(3), player.state.value)
        scope.advanceTimeBy(3500)
        assertTrue(player.state.value is PlayerState.Running)
        player.stop()
        scope.runCurrent()
        assertEquals(FinishReason.STOPPED, (player.state.value as PlayerState.Finished).reason)
    }

    @Test
    fun rejectedDispatchStopsWithError() {
        val scope = TestScope(StandardTestDispatcher())
        val player = MacroPlayer(scope, { DispatchResult.REJECTED }, { scope.currentTime })
        player.start(macro(RunSettings(), TapAction(1, 1f, 1f)), config, noJitter)
        scope.advanceUntilIdle()
        assertEquals(FinishReason.ERROR, (player.state.value as PlayerState.Finished).reason)
    }

    @Test
    fun restartDoesNotGetOverwrittenByOldRun() {
        val scope = TestScope(StandardTestDispatcher())
        var finishedCount = 0
        val player = MacroPlayer(scope, { DispatchResult.COMPLETED }, { scope.currentTime })
        player.onFinished = { finishedCount++ }
        val m = macro(RunSettings(), TapAction(1, 1f, 1f))
        player.start(m, config, noJitter)
        scope.runCurrent()
        player.start(m, config, noJitter)
        scope.runCurrent()
        assertTrue(player.state.value is PlayerState.Running)
        assertEquals(0, finishedCount)
        player.stop()
        scope.runCurrent()
    }
}
