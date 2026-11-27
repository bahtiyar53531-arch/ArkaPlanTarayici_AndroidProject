package space.orbitragame.app.web

import android.annotation.SuppressLint
import android.content.Context
import android.view.View
import android.webkit.WebView

/**
 * Oyun icin WebView.
 *
 * [keepAliveWhenHidden] acikken uygulama arka plana gectiginde Android'in
 * gonderdigi "pencere gizlendi" (GONE) bildirimi Chromium'a iletilmez. Boylece
 * sayfa "gorunur" kalir ve Chromium'un gizli sekme zamanlayici kisitlamalari
 * (timer throttling) devreye girmez; oyunun kalp atisi (heartbeat) ve
 * WebSocket mesajlari islenmeye devam eder.
 *
 * Not: Bu bir "en iyi caba" yontemidir. Android/uretici pil yonetimi sureci
 * yine de kisitlayabilir; bu nedenle on plan servisi ile birlikte kullanilir.
 */
@SuppressLint("ViewConstructor")
class GameWebView(context: Context) : WebView(context) {

    var keepAliveWhenHidden: Boolean = true

    override fun onWindowVisibilityChanged(visibility: Int) {
        if (keepAliveWhenHidden && visibility == View.GONE) return
        super.onWindowVisibilityChanged(if (keepAliveWhenHidden) View.VISIBLE else visibility)
    }
}
