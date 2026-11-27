package space.orbitragame.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UrlPolicyTest {

    @Test fun gameUrlAllowed() {
        assertEquals(NavigationDecision.Allow, UrlPolicy.decideMainFrame(GameConfig.GAME_URL, false))
        assertEquals(NavigationDecision.Allow, UrlPolicy.decideMainFrame("https://orbitragame.space/login?ReturnUrl=%2Foyun", false))
        assertEquals(NavigationDecision.Allow, UrlPolicy.decideMainFrame("https://www.orbitragame.space/", false))
        assertEquals(NavigationDecision.Allow, UrlPolicy.decideMainFrame("https://ORBITRAGAME.SPACE./oyun", false))
    }

    @Test fun httpIsUpgraded() {
        val d = UrlPolicy.decideMainFrame("http://orbitragame.space/oyun", false)
        assertEquals(NavigationDecision.UpgradeToHttps("https://orbitragame.space/oyun"), d)
    }

    @Test fun lookalikeDomainsBlocked() {
        listOf(
            "https://evilorbitragame.space/",
            "https://orbitragame.space.evil.com/",
            "https://orbitragame.spacex.com/",
            "https://orbitragame.space@evil.com/oyun",
        ).forEach { url ->
            val d = UrlPolicy.decideMainFrame(url, false)
            assertTrue("$url -> $d", d is NavigationDecision.Block)
        }
    }

    @Test fun externalLinksNeedGesture() {
        val noGesture = UrlPolicy.decideMainFrame("https://discord.gg/abc", false)
        assertTrue(noGesture is NavigationDecision.Block)
        val withGesture = UrlPolicy.decideMainFrame("https://discord.gg/abc", true)
        assertEquals(NavigationDecision.OpenExternally("https://discord.gg/abc"), withGesture)
        // Guvenilmeyen alan adinda duz HTTP harici bile acilmaz
        assertTrue(UrlPolicy.decideMainFrame("http://example.com", true) is NavigationDecision.Block)
    }

    @Test fun dangerousSchemesBlocked() {
        listOf("javascript:alert(1)", "file:///sdcard/x.html", "content://x/y", "intent://scan#Intent;end", "data:text/html,hi")
            .forEach { assertTrue(it, UrlPolicy.decideMainFrame(it, true) is NavigationDecision.Block) }
    }

    @Test fun mailtoOnlyWithGesture() {
        assertTrue(UrlPolicy.decideMainFrame("mailto:a@b.c", true) is NavigationDecision.OpenExternally)
        assertTrue(UrlPolicy.decideMainFrame("mailto:a@b.c", false) is NavigationDecision.Block)
    }

    @Test fun trustedHostChecks() {
        assertTrue(UrlPolicy.isTrustedHost("orbitragame.space"))
        assertTrue(UrlPolicy.isTrustedHost("cdn.orbitragame.space"))
        assertFalse(UrlPolicy.isTrustedHost("xorbitragame.space"))
        assertFalse(UrlPolicy.isTrustedHost(null))
        assertFalse(UrlPolicy.isTrustedUrl("http://orbitragame.space/"))
        assertTrue(UrlPolicy.isTrustedUrl("https://orbitragame.space/"))
    }

    @Test fun gamePageDetection() {
        assertTrue(UrlPolicy.isGamePage("https://orbitragame.space/oyun"))
        assertTrue(UrlPolicy.isGamePage("https://orbitragame.space/oyun/c/1"))
        assertFalse(UrlPolicy.isGamePage("https://orbitragame.space/oyunlar"))
        assertFalse(UrlPolicy.isGamePage("https://orbitragame.space/login?ReturnUrl=%2Foyun"))
        assertFalse(UrlPolicy.isGamePage("https://evil.com/oyun"))
    }
}
