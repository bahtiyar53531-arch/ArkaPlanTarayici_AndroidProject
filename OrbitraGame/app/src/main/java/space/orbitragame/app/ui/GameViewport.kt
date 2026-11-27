package space.orbitragame.app.ui

import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import space.orbitragame.core.ZoomModel
import kotlin.math.roundToInt

/**
 * WebView'i oyun alanina yerlestirir ve "etkin sayfa olcegini" hesaplar.
 *
 * Onemli: WebView Android tarafinda OLCEKLENMEZ / KAYDIRILMAZ (bir onceki
 * surumde bu yontem bazi cihazlarda ekranin bir kisminin siyah kalmasina
 * yol aciyordu). Yakinlastirma tarayicinin kendi sayfa olcegiyle yapilir;
 * bu sinif yalnizca hangi olcegin uygulanacagini hesaplar.
 *
 *  Normal mod : etkin olcek = kullanicinin oyun olcegi
 *  PiP modu   : etkin olcek = oyun olcegi x (PiP genisligi / tam ekran genisligi)
 *               -> oyunun yerlesim genisligi sabit kalir, kucuk pencerede bozulmaz.
 */
class GameViewport(
    private val container: FrameLayout,
    val zoom: ZoomModel,
    private val onChanged: (effectiveScale: Float, vwCss: Int) -> Unit,
) {
    private var webView: View? = null
    private var inPip = false
    private var fullWidthPx = 0
    private var lastScale = -1f
    private var lastVw = -1
    private val density = container.resources.displayMetrics.density

    private val listener = View.OnLayoutChangeListener { _, l, t, r, b, ol, ot, or_, ob ->
        if (r - l != or_ - ol || b - t != ob - ot) apply()
    }

    init {
        container.addOnLayoutChangeListener(listener)
    }

    val effectiveScale: Float get() = if (lastScale > 0) lastScale else zoom.scale

    fun attach(view: View) {
        webView = view
        if (view.parent !== container) {
            (view.parent as? ViewGroup)?.removeView(view)
            container.addView(view, 0, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        } else {
            view.layoutParams = FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        }
        // Eski surumden kalmis olabilecek donusumleri temizle
        view.scaleX = 1f; view.scaleY = 1f; view.translationX = 0f; view.translationY = 0f
        container.post { apply(force = true) }
    }

    fun setPip(pip: Boolean) {
        if (pip && !inPip) fullWidthPx = innerWidth().takeIf { it > 0 } ?: fullWidthPx
        inPip = pip
        apply()
    }

    /** Klavye icin oyun alanini yukari kaydir (oyun yeniden boyutlanmaz). */
    fun setKeyboardShift(px: Int) {
        container.translationY = -px.toFloat()
    }

    private fun innerWidth() = container.width - container.paddingLeft - container.paddingRight

    fun apply(force: Boolean = false) {
        val w = innerWidth()
        if (w <= 0) return
        val scale = if (inPip && fullWidthPx > 0) ZoomModel.pipScale(zoom.scale, fullWidthPx, w) else zoom.scale
        // Olcek > 1 icin viewport genisligi = mevcut WebView genisligi (CSS px) / olcek
        val vwCss = (w / density).roundToInt()
        if (!force && scale == lastScale && vwCss == lastVw) return
        lastScale = scale
        lastVw = vwCss
        onChanged(scale, vwCss)
    }
}
