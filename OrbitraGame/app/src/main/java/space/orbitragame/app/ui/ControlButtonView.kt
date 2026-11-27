package space.orbitragame.app.ui

import android.content.Context
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.util.AttributeSet
import android.view.View
import space.orbitragame.app.R

/**
 * Kucuk, suruklenebilir, yari saydam kontrol dugmesi. Kullanilmadiginda
 * soluklasir; oyun dugmelerinin ustunde kalirsa kullanici istedigi kenara
 * tasiyabilir (konum kaydedilir).
 */
class ControlButtonView @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {

    private val dp = resources.displayMetrics.density
    private val logo = BitmapFactory.decodeResource(resources, R.drawable.brand_mark)
    private val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xCC06102E.toInt() }
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = 0xCC19E3D6.toInt(); strokeWidth = 1.5f * dp }
    private val bmp = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val rect = RectF()
    private val fadeRunnable = Runnable { animate().alpha(IDLE_ALPHA).setDuration(400).start() }

    init {
        isClickable = true
        isFocusable = true
        contentDescription = context.getString(R.string.control_button)
        alpha = IDLE_ALPHA
    }

    fun wake() {
        removeCallbacks(fadeRunnable)
        animate().cancel()
        alpha = 1f
    }

    fun scheduleFade() {
        removeCallbacks(fadeRunnable)
        postDelayed(fadeRunnable, 2500)
    }

    override fun onDraw(canvas: Canvas) {
        val r = width / 2f
        canvas.drawCircle(r, r, r - ring.strokeWidth, bg)
        canvas.drawCircle(r, r, r - ring.strokeWidth, ring)
        val inset = width * 0.08f
        rect.set(inset, inset, width - inset, height - inset)
        canvas.drawBitmap(logo, null, rect, bmp)
    }

    override fun performClick(): Boolean {
        super.performClick()
        return true
    }

    companion object {
        const val IDLE_ALPHA = 0.5f
    }
}
