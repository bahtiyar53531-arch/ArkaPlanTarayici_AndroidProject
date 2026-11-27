package space.orbitragame.app.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import space.orbitragame.app.R

/**
 * Iki parmakla yakinlastirma modu. Yalnizca kullanici menuden actiginda
 * gorunur ve bu sure boyunca dokunuslar oyuna GONDERILMEZ. Boylece oyunun
 * kendi iki parmak hareketleriyle asla cakisma olmaz.
 */
@SuppressLint("ViewConstructor")
class ZoomOverlayView(
    context: Context,
    private val currentScale: () -> Float,
    private val onScale: (Float) -> Unit,
    private val onDone: () -> Unit,
) : FrameLayout(context) {

    private val dp = resources.displayMetrics.density
    private val percent: TextView
    private var gestureScale = 1f

    private val detector = ScaleGestureDetector(context, object : ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScaleBegin(detector: ScaleGestureDetector): Boolean {
            gestureScale = currentScale()
            return true
        }

        override fun onScale(detector: ScaleGestureDetector): Boolean {
            gestureScale *= detector.scaleFactor
            onScale(gestureScale)
            refresh()
            return true
        }
    })

    init {
        setBackgroundColor(0x33000000)
        isClickable = true
        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setBackgroundResource(R.drawable.bg_panel)
            val p = (14 * dp).toInt()
            setPadding(p, p, p, p)
        }
        percent = TextView(context).apply {
            setTextColor(0xFF19E3D6.toInt())
            typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            gravity = Gravity.CENTER
        }
        val hint = TextView(context).apply {
            setText(R.string.zoom_mode_hint)
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            gravity = Gravity.CENTER
        }
        val done = Button(context).apply {
            setText(R.string.zoom_mode_done)
            setTextColor(Color.WHITE)
            setBackgroundResource(R.drawable.bg_button_primary)
            isAllCaps = false
            setOnClickListener { onDone() }
        }
        card.addView(percent)
        card.addView(hint, LinearLayout.LayoutParams(LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = (6 * dp).toInt() })
        card.addView(done, LinearLayout.LayoutParams((140 * dp).toInt(), (44 * dp).toInt()).apply { topMargin = (12 * dp).toInt() })
        addView(card, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply {
            bottomMargin = (32 * dp).toInt()
        })
        refresh()
    }

    fun refresh() {
        percent.text = "%" + (currentScale() * 100).toInt()
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        detector.onTouchEvent(event)
        return true
    }
}
