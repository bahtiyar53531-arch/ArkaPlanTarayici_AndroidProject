package space.orbitragame.app.web

import android.graphics.Bitmap
import android.net.http.SslError
import android.os.Build
import android.util.Log
import android.webkit.RenderProcessGoneDetail
import android.webkit.SslErrorHandler
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import space.orbitragame.core.NavigationDecision
import space.orbitragame.core.UrlPolicy

/**
 * Gezinme guvenligi ve sayfa yasam dongusu.
 *  - Yalnizca orbitragame.space (ve alt alan adlari) uygulama icinde acilir.
 *  - http -> https zorunlu.
 *  - SSL hatalarinda baglanti ASLA devam ettirilmez.
 *  - Dis baglantilar yalnizca kullanici dokunduysa ve onaylarsa tarayicida acilir.
 */
class GameWebViewClient(
    private val host: GameWebHost,
    private val bridge: JsBridge,
) : WebViewClient() {

    override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
        if (!request.isForMainFrame) {
            // Alt cerceveler (captcha vb.) yalnizca HTTPS ile yuklenebilir.
            val scheme = request.url.scheme?.lowercase()
            return !(scheme == "https" || scheme == "about" || scheme == "data" || scheme == "blob")
        }
        val url = request.url.toString()
        return when (val d = UrlPolicy.decideMainFrame(url, request.hasGesture())) {
            NavigationDecision.Allow -> false
            is NavigationDecision.UpgradeToHttps -> {
                view.loadUrl(d.httpsUrl); true
            }
            is NavigationDecision.OpenExternally -> {
                host.onExternalLink(d.url); true
            }
            is NavigationDecision.Block -> {
                host.onBlockedNavigation(url, d.reason); true
            }
        }
    }

    override fun onPageStarted(view: WebView, url: String, favicon: Bitmap?) {
        super.onPageStarted(view, url, favicon)
        // Yonlendirme sonucu guvenilmeyen bir adrese varildiysa durdur.
        if (!url.startsWith("about:") && !UrlPolicy.isTrustedUrl(url)) {
            view.stopLoading()
            host.onBlockedNavigation(url, "Guvenilmeyen yonlendirme")
            return
        }
        bridge.onPageStarted()
        bridge.injectFallbackIfNeeded(view, url)
        host.onMainFrameStarted(url)
    }

    override fun onPageCommitVisible(view: WebView, url: String) {
        super.onPageCommitVisible(view, url)
        host.onMainFrameCommitVisible(url)
    }

    override fun onPageFinished(view: WebView, url: String) {
        super.onPageFinished(view, url)
        host.onMainFrameFinished(url)
    }

    override fun onReceivedError(view: WebView, request: WebResourceRequest, error: WebResourceError) {
        if (!request.isForMainFrame) return
        val kind = when (error.errorCode) {
            ERROR_HOST_LOOKUP, ERROR_CONNECT, ERROR_TIMEOUT -> GameWebHost.ErrorKind.NETWORK
            ERROR_FAILED_SSL_HANDSHAKE -> GameWebHost.ErrorKind.SSL
            else -> GameWebHost.ErrorKind.NETWORK
        }
        host.onMainFrameError(kind, "${error.description} (${error.errorCode})")
    }

    override fun onReceivedHttpError(view: WebView, request: WebResourceRequest, errorResponse: WebResourceResponse) {
        // 403/429 gibi yanitlar (Cloudflare dogrulamasi vb.) kullanicinin gormesi
        // gereken gercek sayfalardir; yalnizca sunucu hatalari (5xx) ele alinir.
        if (request.isForMainFrame && errorResponse.statusCode >= 500) {
            host.onMainFrameError(GameWebHost.ErrorKind.HTTP, "HTTP ${errorResponse.statusCode}", errorResponse.statusCode)
        }
    }

    override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
        // GUVENLIK: SSL dogrulamasi asla atlanmaz.
        handler.cancel()
        Log.w(TAG, "SSL hatasi: ${error.primaryError} ${error.url}")
        if (UrlPolicy.isTrustedHost(UrlPolicy.hostOf(error.url))) {
            host.onMainFrameError(GameWebHost.ErrorKind.SSL, "SSL ${error.primaryError}")
        }
    }

    override fun onRenderProcessGone(view: WebView, detail: RenderProcessGoneDetail): Boolean {
        // Tarayici motoru (renderer) bellek nedeniyle sistemce kapatildi veya coktu.
        // true donerek uygulamanin cokmesini engelliyoruz; WebView yeniden kurulacak.
        val crashed = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) detail.didCrash() else true
        host.onRendererGone(crashed)
        return true
    }

    private companion object {
        const val TAG = "OrbitraWeb"
    }
}
