package space.orbitragame.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class LoadingProgressModelTest {

    @Test fun stagesMapToSpecPercents() {
        val m = LoadingProgressModel()
        assertEquals(0, m.percent)
        m.onEngineReady(); assertEquals(20, m.percent)
        m.onRequestSent(); assertEquals(40, m.percent)
        m.onServerResponded(); assertEquals(60, m.percent)
        m.onPageLoaded(); assertEquals(80, m.percent)
        m.onGameReady(); assertEquals(100, m.percent)
        assertTrue(m.isComplete)
    }

    @Test fun realWebProgressFillsBetweenStages() {
        val m = LoadingProgressModel()
        m.onEngineReady(); m.onRequestSent(); m.onServerResponded()
        m.onWebProgress(50)
        assertTrue(m.percent in 61..79)
        m.onWebProgress(100)
        assertEquals(79, m.percent)
        m.onPageLoaded()
        assertEquals(80, m.percent)
    }

    @Test fun neverGoesBackwardsAndNoFakeProgress() {
        val m = LoadingProgressModel()
        m.onEngineReady(); m.onRequestSent(); m.onServerResponded(); m.onWebProgress(90)
        val before = m.percent
        m.onWebProgress(10) // yeni alt-kaynak ilerlemesi dusuk gelse bile
        assertEquals(before, m.percent)
        // Olay olmadan asla 80'e ulasmaz
        assertTrue(m.percent < 80)
    }

    @Test fun resetStartsOver() {
        val m = LoadingProgressModel()
        m.onEngineReady(); m.onRequestSent(); m.onGameReady()
        m.reset()
        assertEquals(0, m.percent)
        assertEquals(LoadingProgressModel.Stage.STARTING, m.stage)
    }
}
