package space.orbitragame.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class StatsTest {

    @Test fun fpsAverageMinAndLowWarning() {
        val f = FpsStats(averageWindowSeconds = 5, lowFpsThreshold = 30, lowFpsSustainSeconds = 3)
        assertNull(f.average)
        listOf(60.0, 58.0, 25.0, 60.0).forEach(f::add)
        assertEquals(60.0, f.current!!, 0.001)
        assertEquals(25.0, f.min!!, 0.001)
        assertFalse("tek dusus uyari vermemeli", f.isLow)
        listOf(20.0, 22.0, 18.0).forEach(f::add)
        assertTrue(f.isLow)
        assertEquals(5, f.sampleCount)
    }

    @Test fun pingStats() {
        val p = PingStats(window = 5)
        assertEquals(PingStats.Quality.UNKNOWN, p.quality())
        listOf(40L, 50L, 60L).forEach(p::addSuccess)
        assertEquals(50L, p.median)
        assertEquals(10L, p.jitter)
        assertEquals(PingStats.Quality.GOOD, p.quality())
        p.addFailure(); p.addFailure(); p.addFailure()
        assertEquals(60, p.lossPercent)
        assertEquals(PingStats.Quality.OFFLINE, p.quality())
    }

    @Test fun zoomClampsAndSteps() {
        val z = ZoomModel()
        assertTrue(z.isDefault)
        repeat(20) { z.zoomIn() }
        assertEquals(1.8f, z.scale, 0.0001f)
        assertFalse(z.canZoomIn)
        repeat(30) { z.zoomOut() }
        assertEquals(0.6f, z.scale, 0.0001f)
        z.reset()
        assertEquals("%100", z.percentLabel)
    }

    @Test fun zoomLayoutSize() {
        assertEquals(2000 to 1000, ZoomModel.layoutSizeFor(1000, 500, 0.5f))
        assertEquals(500 to 250, ZoomModel.layoutSizeFor(1000, 500, 2f))
        assertEquals(0.25f, ZoomModel.fitScale(1000, 2000, 250, 600), 0.0001f)
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
