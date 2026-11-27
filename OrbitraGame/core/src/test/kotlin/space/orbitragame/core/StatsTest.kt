package space.orbitragame.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StatsTest {



    @Test fun zoomClampsAndSteps() {
        val z = ZoomModel()
        assertTrue(z.isDefault)
        repeat(20) { z.zoomIn() }
        assertEquals(1.6f, z.scale, 0.0001f)
        assertFalse(z.canZoomIn)
        repeat(30) { z.zoomOut() }
        assertEquals(0.3f, z.scale, 0.0001f)
        z.reset()
        assertEquals("%100", z.percentLabel)
    }

    @Test fun zoomLayoutSize() {
        assertEquals(2000 to 1000, ZoomModel.layoutSizeFor(1000, 500, 0.5f))
        assertEquals(500 to 250, ZoomModel.layoutSizeFor(1000, 500, 2f))
        assertEquals(0.25f, ZoomModel.fitScale(1000, 2000, 250, 600), 0.0001f)
    }

    @Test fun pipScaleKeepsLayoutWidthWithinEngineLimit() {
        // 1080 px genislikte %100 -> 540 px PiP: olcek 0.5 (yerlesim genisligi ayni kalir)
        assertEquals(0.5f, ZoomModel.pipScale(1f, 1080, 540), 0.0001f)
        // Cok kucuk pencere: Chromium alt siniri 0.25
        assertEquals(0.25f, ZoomModel.pipScale(0.4f, 1080, 300), 0.0001f)
    }

    @Test fun adaptiveQualityLowersThenRevertsIfUseless() {
        val q = AdaptiveQualityController(windowSamples = 3, cooldownMs = 1000)
        var t = 0L
        fun feed(v: Double): AdaptiveQualityController.Decision { t += 1000; return q.onSample(v, t) }
        assertEquals(AdaptiveQualityController.Decision.None, feed(60.0))
        feed(58.0); feed(59.0)
        assertEquals(RenderQuality.BALANCED, q.level)
        // FPS dustu -> bir kademe dusur
        feed(30.0); feed(31.0)
        val d = feed(29.0)
        assertTrue(d is AdaptiveQualityController.Decision.Lowered)
        assertEquals(RenderQuality.PERFORMANCE, q.level)
        // Dusurme ise yaramadi -> geri al ve devre disi birak
        feed(30.0); feed(30.0)
        val r = feed(31.0)
        assertEquals(AdaptiveQualityController.Decision.Reverted(RenderQuality.BALANCED), r)
        assertTrue(q.disabled)
        feed(20.0); feed(20.0)
        assertEquals(AdaptiveQualityController.Decision.None, feed(20.0))
    }

    @Test fun adaptiveQualityKeepsHelpfulDrop() {
        val q = AdaptiveQualityController(windowSamples = 2, cooldownMs = 0)
        var t = 0L
        fun feed(v: Double) = q.onSample(v, ++t)
        feed(30.0); feed(30.0) // -> PERFORMANCE
        assertEquals(RenderQuality.PERFORMANCE, q.level)
        feed(55.0); feed(56.0) // iyilesti -> korunur
        assertEquals(RenderQuality.PERFORMANCE, q.level)
        assertFalse(q.disabled)
    }

    @Test fun adaptiveQualityRespectsFloor() {
        val q = AdaptiveQualityController(start = RenderQuality.BALANCED, floor = RenderQuality.PERFORMANCE, windowSamples = 1, cooldownMs = 0)
        q.onSample(20.0, 1) // BALANCED -> PERFORMANCE
        assertEquals(RenderQuality.PERFORMANCE, q.level)
        assertFalse("etkisi henuz olculmedi", q.settled)
        q.onSample(45.0, 2) // iyilesti -> korunur, alt sinirda oldugu icin artik degismez
        assertEquals(RenderQuality.PERFORMANCE, q.level)
        assertTrue(q.settled)
        q.onSample(10.0, 3)
        assertEquals("alt sinirin altina inilmez", RenderQuality.PERFORMANCE, q.level)
    }

    @Test fun thermalSevereLowersQuality() {
        val q = AdaptiveQualityController(windowSamples = 1, cooldownMs = 0)
        val d = q.onSample(60.0, 1, thermalSevere = true)
        assertTrue(d is AdaptiveQualityController.Decision.Lowered)
    }

    @Test fun reconnectBackoff() {
        val r = ReconnectPolicy(listOf(1, 2, 3))
        assertEquals(1L, r.nextDelayMs()); r.onAttempt()
        assertEquals(2L, r.nextDelayMs()); r.onAttempt()
        assertEquals(3L, r.nextDelayMs()); r.onAttempt()
        assertNull(r.nextDelayMs())
        assertTrue(r.exhausted)
        r.onConnected()
        assertEquals(1L, r.nextDelayMs())
    }

    @Test fun connectionTracker() {
        val c = ConnectionTracker()
        assertEquals(ConnectionTracker.State.NO_SOCKET, c.state)
        c.onSocketCreated("a1", "orbitragame.space", 443)
        assertEquals(ConnectionTracker.State.CONNECTING, c.state)
        c.onSocketOpen("a1")
        assertEquals(ConnectionTracker.State.CONNECTED, c.state)
        c.onSocketCreated("a2", "evil.com", 443)
        assertEquals("orbitragame.space", c.lastHost) // guvenilmeyen host ping hedefi olmaz
        c.onSocketClosed("a1", 1234)
        assertEquals(1234L, c.lastCloseAtMs)
        c.onSocketClosed("a2", 1300)
        assertEquals(ConnectionTracker.State.DISCONNECTED, c.state)
        c.onPageStarted()
        assertEquals(ConnectionTracker.State.NO_SOCKET, c.state)
    }
}
