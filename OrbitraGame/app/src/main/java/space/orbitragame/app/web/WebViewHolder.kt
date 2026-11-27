package space.orbitragame.app.web

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Context
import android.content.MutableContextWrapper
import android.view.ViewGroup

/**
 * WebView'i Activity'den bagimsiz tutar. Activity sistem tarafindan yeniden
 * olusturulsa bile (ornegin bellek nedeniyle) surec yasadigi surece ayni
 * WebView ve oyun oturumu kullanilir; sayfa yeniden yuklenmez.
 *
 * MutableContextWrapper sayesinde WebView, bagli oldugu Activity'yi
 * kullanir (diyaloglar, secim listeleri dogru calisir) ve Activity
 * kapandiginda bellek sizintisi olmaz.
 */
@SuppressLint("StaticFieldLeak") // Bilincli: WebView surec boyunca tutulur; Activity ayrilinca baglam uygulama baglamina doner.
object WebViewHolder {

    private var contextWrapper: MutableContextWrapper? = null
    var webView: GameWebView? = null
        private set

    /** WebView'e bagli olcum koprusu (WebView ile birlikte yasar). */
    var bridge: JsBridge? = null

    /** Var olan WebView'i dondurur veya yenisini olusturur. */
    fun obtain(activity: Activity, factory: (Context) -> GameWebView): Pair<GameWebView, Boolean> {
        val existing = webView
        if (existing != null) {
            contextWrapper?.baseContext = activity
            (existing.parent as? ViewGroup)?.removeView(existing)
            return existing to false
        }
        val wrapper = MutableContextWrapper(activity)
        contextWrapper = wrapper
        val created = factory(wrapper)
        webView = created
        return created to true
    }

    /** Activity yok edilirken (yeniden olusturulacaksa) WebView'i ayir ama koru. */
    fun detach(appContext: Context) {
        bridge?.listener = null
        val wv = webView ?: return
        (wv.parent as? ViewGroup)?.removeView(wv)
        contextWrapper?.baseContext = appContext.applicationContext
    }

    /** WebView'i tamamen yok et (cikis, cokme, yeniden baslatma). */
    fun destroy() {
        val wv = webView ?: return
        webView = null
        contextWrapper = null
        bridge?.listener = null
        bridge = null
        runCatching {
            (wv.parent as? ViewGroup)?.removeView(wv)
            wv.stopLoading()
            wv.webChromeClient = null
            wv.loadUrl("about:blank")
            wv.removeAllViews()
            wv.destroy()
        }
    }
}
