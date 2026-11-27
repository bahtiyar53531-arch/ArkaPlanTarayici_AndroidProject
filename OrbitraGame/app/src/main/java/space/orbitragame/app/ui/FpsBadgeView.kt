package space.orbitragame.app.ui

import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.util.AttributeSet
import android.view.View
import kotlin.math.roundToInt

/**
 * Sade FPS gostergesi: yalnizca "60 FPS". Ayrinti yok.
 * Sabit boyutludur: deger degisince yalnizca kendini yeniden cizer, ekrani
 * yeniden yerlestirmez (oyuna ek yuk binmez).
 */
class FpsBadgeView @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {

    private val dp = resources.displayMetrics.density
    private val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x99000814.toInt() }
    private val numPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = Typeface.create("sans-serif-condensed", Typeface.BOLD)
        textSize = 15f * dp
        textAlign = Paint.Align.RIGHT
    }
    private val unitPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        typeface = Typeface.create("sans-serif-condensed", Typeface.BOLD)
        textSize = 10f * dp
        color = 0xCCEAF6FF.toInt()
    }
    private val rect = RectF()
    private var text = "--"
    private var color = COLOR_IDLE

    init {
        contentDescription = "FPS"
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    /** null: oyun su an kare cizmiyor (or. giris sayfasi). */
    fun setFps(fps: Double?) {
        val newText = fps?.roundToInt()?.coerceIn(0, 999)?.toString() ?: "--"
        val newColor = when {
            fps == null -> COLOR_IDLE
            fps >= 50 -> COLOR_GOOD
            fps >= 30 -> COLOR_WARN
            else -> COLOR_BAD
        }
        if (newText == text && newColor == color) return
        text = newText
        color = newColor
        invalidate()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        // "000 FPS" icin sabit boyut
        val w = numPaint.measureText("000") + unitPaint.measureText(" FPS") + 16 * dp
        setMeasuredDimension(w.roundToInt(), (24 * dp).roundToInt())
    }

    override fun onDraw(canvas: Canvas) {
        rect.set(0f, 0f, width.toFloat(), height.toFloat())
        canvas.drawRoundRect(rect, height / 2f, height / 2f, bg)
        val unitW = unitPaint.measureText(" FPS")
        val baseline = height / 2f - (numPaint.descent() + numPaint.ascent()) / 2f
        val numRight = width - 8 * dp - unitW
        numPaint.color = color
        canvas.drawText(text, numRight, baseline, numPaint)
        canvas.drawText(" FPS", numRight, baseline, unitPaint)
    }

    private companion object {
        const val COLOR_GOOD = 0xFF3DF2A5.toInt()
        const val COLOR_WARN = 0xFFFFC547.toInt()
        const val COLOR_BAD = 0xFFFF5C6C.toInt()
        const val COLOR_IDLE = 0xFF9FB2CC.toInt()
    }
}
