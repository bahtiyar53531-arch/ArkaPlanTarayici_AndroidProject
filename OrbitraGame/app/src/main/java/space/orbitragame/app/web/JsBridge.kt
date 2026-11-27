package space.orbitragame.app.web

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.util.Log
import android.webkit.WebView
import androidx.webkit.JavaScriptReplyProxy
import androidx.webkit.ScriptHandler
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import org.json.JSONObject
import space.orbitragame.app.BuildConfig
import space.orbitragame.core.GameConfig
import space.orbitragame.core.UrlPolicy

/**
 * Sayfa <-> uygulama koprusu.
 *
 * Guvenlik:
 *  - addJavascriptInterface KULLANILMAZ (sayfaya Java nesnesi acilmaz).
 *  - androidx.webkit WebMessageListener yalnizca guvenilen kaynaklara
 *    (https://orbitragame.space) enjekte edilir; diger kaynaklar koprunun
 *    varligini bile goremez.
 *  - Gelen her mesaj boyut, kaynak ve icerik acisindan dogrulanir.
 *  - Sayfadan uygulamaya yalnizca olcum verisi gelir; sayfa uygulamaya komut veremez.
 *  - Uygulamadan sayfaya yalnizca kullanicinin sectigi gorunum ayarlari gider
 *    (oyun olcegi, render kalitesi, pencere olcegi).
 */
class JsBridge {

    /** Olaylari alan ekran. Activity yeniden olusturulursa yenisine baglanir. */
    var listener: Listener? = null

    interface Listener {
        fun onGameStats(gameFrames: Int, elapsedMs: Int, isTop: Boolean)
        fun onBrowserFrames(frames: Int, elapsedMs: Int)
        fun onJsHeap(mb: Int)
        fun onGameReady()
        fun onSocketEvent(event: String, id: String, host: String?, port: Int?, code: Int?)
        fun onPageVisibility(visible: Boolean)
        fun onHudApplied(count: Int)
        fun onFocusRect(topCss: Int, bottomCss: Int)
        fun onFocusCleared()
    }

    /** Sayfaya giden gorunum ayarlari. */
    data class PageConfig(
        val scale: Float = 1f,     // tarayici sayfa olcegi (oyun olcegi)
        val vwCss: Int = 0,        // WebView genisligi (CSS px, olcek 1'de)
        val dprCap: Float = 0f,    // render kalitesi ust siniri (0 = sinirsiz)
        val hudTop: Float = 1f,    // ust pencereler olcegi
        val hudBottom: Float = 1f, // alt kontroller olcegi
    ) {
        fun toJson(): String = JSONObject()
            .put("scale", scale.toDouble()).put("vw", vwCss).put("dprCap", dprCap.toDouble())
            .put("hudTop", hudTop.toDouble()).put("hudBottom", hudBottom.toDouble()).toString()
    }

    private val replyProxies = LinkedHashSet<JavaScriptReplyProxy>()
    private var statsEnabled = false
    private var browserLoop = false
    var config = PageConfig()
        private set
    private var startScript: ScriptHandler? = null
    private var webViewRef: WebView? = null
    var documentStartSupported = false
        private set

    private var probeScript: String? = null

    /** WebView olusturulduktan hemen sonra, ilk yuklemeden ONCE cagrilmalidir. */
    @SuppressLint("RequiresFeature")
    fun install(context: Context, webView: WebView, initial: PageConfig) {
        config = initial
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            Log.w(TAG, "WebMessageListener desteklenmiyor; olcum koprusu devre disi")
            return
        }
        val script = context.assets.open("js/orbitra_probe.js").bufferedReader().use { it.readText() }
        probeScript = script
        WebViewCompat.addWebMessageListener(webView, OBJECT_NAME, GameConfig.TRUSTED_ORIGINS) { _, message, sourceOrigin, _, replyProxy ->
            handle(message, sourceOrigin, replyProxy)
        }
        webViewRef = webView
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            registerStartScript(webView)
            documentStartSupported = true
        }
    }

    /** Ayarlar betigin basina gomulur: oyun daha ilk satirinda dogru olcek/DPR'i gorur. */
    private fun scriptWithConfig(): String? = probeScript?.let { "window.__orbitraCfg=${config.toJson()};\n$it" }

    @SuppressLint("RequiresFeature")
    private fun registerStartScript(webView: WebView) {
        val script = scriptWithConfig() ?: return
        runCatching { startScript?.remove() }
        startScript = WebViewCompat.addDocumentStartJavaScript(webView, script, GameConfig.TRUSTED_ORIGINS)
    }

    /** Gorunum ayarlarini canli uygula ve sonraki sayfa yuklemeleri icin sakla. */
    fun updateConfig(newConfig: PageConfig) {
        if (newConfig == config) return
        config = newConfig
        broadcast(JSONObject(newConfig.toJson()).put("cmd", "cfg").toString())
        val wv = webViewRef
        if (documentStartSupported && wv != null) runCatching { registerStartScript(wv) }
    }

    /**
     * Eski WebView surumleri icin yedek: belge-basi enjeksiyonu yoksa betik
     * sayfa basladiginda calistirilir (WebSocket gozlemi gec kalabilir).
     */
    fun injectFallbackIfNeeded(webView: WebView, url: String?) {
        if (documentStartSupported) return
        val script = scriptWithConfig() ?: return
        if (url != null && UrlPolicy.isTrustedUrl(url)) webView.evaluateJavascript(script, null)
    }

    /** Yeni sayfa yuklemesi basladiginda eski cerceve baglantilarini unut. */
    fun onPageStarted() {
        replyProxies.clear()
    }

    /**
     * Olcum raporlarini ac/kapat. [on]: saniyelik oyun FPS raporu (panel veya
     * otomatik kalite icin). [browser]: tarayici FPS dongusu (yalnizca panel acikken).
     */
    fun setStatsEnabled(on: Boolean, browser: Boolean = on) {
        if (on == statsEnabled && browser == browserLoop) return
        statsEnabled = on
        browserLoop = browser && on
        broadcast(statsJson())
    }

    private fun statsJson() = """{"cmd":"stats","on":$statsEnabled,"browser":$browserLoop}"""

    /** Klavye acildiginda odaktaki alanin konumunu iste. */
    fun requestFocusRect() = broadcast("""{"cmd":"focus?"}""")

    @SuppressLint("RequiresFeature")
    private fun broadcast(json: String) {
        val dead = ArrayList<JavaScriptReplyProxy>()
        for (p in replyProxies) {
            runCatching { p.postMessage(json) }.onFailure { dead += p }
        }
        replyProxies.removeAll(dead.toSet())
    }

    // Bu metod yalnizca WEB_MESSAGE_LISTENER destekleniyorsa (install icinde kontrol edilir) cagrilir.
    @SuppressLint("RequiresFeature")
    private fun handle(message: WebMessageCompat, sourceOrigin: Uri, replyProxy: JavaScriptReplyProxy) {
        // Kaynak dogrulamasi (ikinci savunma hatti)
        val origin = sourceOrigin.toString().trimEnd('/')
        if (origin !in GameConfig.TRUSTED_ORIGINS) return
        val data = message.data ?: return
        if (data.length > MAX_MESSAGE) return
        val o = runCatching { JSONObject(data) }.getOrNull() ?: return

        when (o.optString("t")) {
            "hello" -> {
                replyProxies += replyProxy
                if (statsEnabled) runCatching { replyProxy.postMessage(statsJson()) }
            }
            "stats" -> {
                val dt = o.optInt("dt", 1000).coerceIn(1, 60_000)
                val g = o.optInt("g", 0).coerceIn(0, 10_000)
                val top = o.optBoolean("top", false)
                val l = listener ?: return
                l.onGameStats(g, dt, top)
                if (top && o.has("b")) l.onBrowserFrames(o.optInt("b", 0).coerceIn(0, 10_000), dt)
                if (top && o.has("heap")) l.onJsHeap(o.optInt("heap", 0).coerceIn(0, 100_000))
                if (top) l.onPageVisibility(o.optString("vis") != "hidden")
            }
            "ready" -> listener?.onGameReady()
            "hud" -> listener?.onHudApplied(o.optInt("n", 0).coerceIn(0, 10_000))
            "focus" -> listener?.onFocusRect(o.optInt("top", 0).coerceIn(-100_000, 100_000), o.optInt("bottom", 0).coerceIn(-100_000, 100_000))
            "blur" -> listener?.onFocusCleared()
            "ws" -> {
                val e = o.optString("e")
                val id = o.optString("id").take(32)
                if (id.isEmpty() || e !in setOf("create", "open", "close")) return
                val host = o.optString("host").takeIf { it.isNotEmpty() }?.take(253)
                val port = if (o.has("port")) o.optInt("port").takeIf { it in 1..65535 } else null
                val code = if (o.has("code")) o.optInt("code") else null
                listener?.onSocketEvent(e, id, host, port, code)
            }
            else -> if (BuildConfig.DEBUG) Log.d(TAG, "Bilinmeyen mesaj: ${data.take(80)}")
        }
    }

    companion object {
        private const val TAG = "OrbitraBridge"
        const val OBJECT_NAME = "OrbitraNative"
        private const val MAX_MESSAGE = 2048
    }
}
