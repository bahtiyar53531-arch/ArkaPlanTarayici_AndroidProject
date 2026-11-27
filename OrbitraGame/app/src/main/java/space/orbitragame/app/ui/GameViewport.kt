package space.orbitragame.app.ui

import android.view.View
import android.widget.FrameLayout
import space.orbitragame.core.ZoomModel

/**
 * WebView'in kap icindeki boyutunu ve olcegini yonetir.
 *
 *  Normal mod : yerlesim = kap / zoom, gorunum olcegi = zoom
 *               -> oyun tum alani doldurur, dokunmalar Android tarafindan
 *                  otomatik donusturulur, oyun koduna/CSS'e dokunulmaz.
 *  PiP modu   : yerlesim PiP oncesindeki boyutta DONDURULUR ve kucuk
 *               pencereye sigdirilir -> oyun yeniden boyutlanmaz/bozulmaz.
 */
class GameViewport(private val container: FrameLayout, val zoom: ZoomModel) {

    private var webView: View? = null
    private var inPip = false
    private var frozenW = 0
    private var frozenH = 0

    /** Son uygulanan yerlesim boyutu (PiP en-boy orani icin). */
    var layoutW = 0
        private set
    var layoutH = 0
        private set

    private val listener = View.OnLayoutChangeListener { _, l, t, r, b, ol, ot, or_, ob ->
        if (r - l != or_ - ol || b - t != ob - ot) apply()
    }

    init {
        container.addOnLayoutChangeListener(listener)
    }

    fun attach(view: View) {
        webView = view
        if (view.parent !== container) {
            (view.parent as? android.view.ViewGroup)?.removeView(view)
            container.addView(view, 0, FrameLayout.LayoutParams(1, 1))
        }
        view.pivotX = 0f
        view.pivotY = 0f
        container.post { apply() }
    }

    fun setPip(pip: Boolean) {
        if (pip && !inPip) {
            frozenW = layoutW
            frozenH = layoutH
        }
        inPip = pip
        apply()
    }

    fun apply() {
        val v = webView ?: return
        val cw = container.width - container.paddingLeft - container.paddingRight
        val ch = container.height - container.paddingTop - container.paddingBottom
        if (cw <= 0 || ch <= 0) return

        val (w, h, s) = if (inPip && frozenW > 0 && frozenH > 0) {
            Triple(frozenW, frozenH, ZoomModel.fitScale(frozenW, frozenH, cw, ch))
        } else {
            val (lw, lh) = ZoomModel.layoutSizeFor(cw, ch, zoom.scale)
            Triple(lw, lh, zoom.scale)
        }
        val lp = v.layoutParams as? FrameLayout.LayoutParams ?: FrameLayout.LayoutParams(w, h)
        if (lp.width != w || lp.height != h) {
            lp.width = w
            lp.height = h
            v.layoutParams = lp
        }
        layoutW = w
        layoutH = h
        v.scaleX = s
        v.scaleY = s
        // PiP'te en-boy farki varsa ortala
        v.translationX = ((cw - w * s) / 2f).coerceAtLeast(0f)
        v.translationY = ((ch - h * s) / 2f).coerceAtLeast(0f)
    }
}
