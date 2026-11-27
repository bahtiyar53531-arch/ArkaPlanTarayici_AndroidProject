package space.orbitragame.app.ui

import android.annotation.SuppressLint
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import kotlin.math.abs

/**
 * Bir gorunumu ebeveyni icinde surukletir; kisa dokunusu tiklama sayar.
 * Konum translationX/Y ile tutulur ve ekran oranlari (0..1) olarak bildirilir.
 */
class DragHelper(
    private val view: View,
    private val snapToEdges: Boolean,
    private val onClick: () -> Unit,
    private val onMoved: (fx: Float, fy: Float) -> Unit,
    private val onTouchStateChanged: (touching: Boolean) -> Unit = {},
) : View.OnTouchListener {

    private val slop = ViewConfiguration.get(view.context).scaledTouchSlop
    private var downX = 0f
    private var downY = 0f
    private var startTx = 0f
    private var startTy = 0f
    private var dragging = false

    @SuppressLint("ClickableViewAccessibility")
    fun attach() = view.setOnTouchListener(this)

    override fun onTouch(v: View, e: MotionEvent): Boolean {
        val parent = v.parent as? View ?: return false
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = e.rawX; downY = e.rawY
                startTx = v.translationX; startTy = v.translationY
                dragging = false
                onTouchStateChanged(true)
                v.isPressed = true
            }
            MotionEvent.ACTION_MOVE -> {
                val dx = e.rawX - downX
                val dy = e.rawY - downY
                if (!dragging && (abs(dx) > slop || abs(dy) > slop)) dragging = true
                if (dragging) {
                    v.translationX = (startTx + dx).coerceIn(minX(parent), maxX(v, parent))
                    v.translationY = (startTy + dy).coerceIn(minY(parent), maxY(v, parent))
                }
            }
            MotionEvent.ACTION_UP -> {
                v.isPressed = false
                onTouchStateChanged(false)
                if (!dragging) {
                    v.performClick()
                    onClick()
                } else {
                    if (snapToEdges) {
                        val center = v.translationX + v.width / 2f
                        val targetX = if (center < parent.width / 2f) minX(parent) else maxX(v, parent)
                        v.animate().translationX(targetX).setDuration(160).withEndAction { report(v, parent) }.start()
                    } else report(v, parent)
                }
            }
            MotionEvent.ACTION_CANCEL -> {
                v.isPressed = false
                onTouchStateChanged(false)
            }
        }
        return true
    }

    private fun report(v: View, parent: View) {
        val rangeX = (maxX(v, parent) - minX(parent)).coerceAtLeast(1f)
        val rangeY = (maxY(v, parent) - minY(parent)).coerceAtLeast(1f)
        onMoved((v.translationX - minX(parent)) / rangeX, (v.translationY - minY(parent)) / rangeY)
    }

    private fun minX(p: View) = p.paddingLeft.toFloat()
    private fun minY(p: View) = p.paddingTop.toFloat()
    private fun maxX(v: View, p: View) = (p.width - p.paddingRight - v.width).toFloat().coerceAtLeast(minX(p))
    private fun maxY(v: View, p: View) = (p.height - p.paddingBottom - v.height).toFloat().coerceAtLeast(minY(p))

    companion object {
        /** Kayitli oranlara gore gorunumu yerlestir. */
        fun place(v: View, fx: Float, fy: Float) {
            val p = v.parent as? View ?: return
            if (p.width == 0 || v.width == 0) return
            val minX = p.paddingLeft.toFloat()
            val minY = p.paddingTop.toFloat()
            val maxX = (p.width - p.paddingRight - v.width).toFloat().coerceAtLeast(minX)
            val maxY = (p.height - p.paddingBottom - v.height).toFloat().coerceAtLeast(minY)
            v.translationX = minX + (maxX - minX) * fx.coerceIn(0f, 1f)
            v.translationY = minY + (maxY - minY) * fy.coerceIn(0f, 1f)
        }
    }
}
