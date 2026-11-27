package org.arkaplan.ototiklayici.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Typeface
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import kotlin.math.abs
import kotlin.math.min

/**
 * Ekrandaki sürüklenebilir hedef işareti. Merkezindeki artı, dokunuşun gerçekleşeceği noktadır.
 * Sürükleme ve dokunma olaylarını dinleyicilere iletir; pencereyi taşımak oturumun işidir.
 */
@SuppressLint("ViewConstructor")
class TargetMarkerView(
    context: Context,
    private var color: Int,
    var label: String,
    private val hollow: Boolean = false,
) : View(context) {

    var onDragStart: (() -> Unit)? = null
    var onDrag: ((dx: Float, dy: Float) -> Unit)? = null
    var onDragEnd: (() -> Unit)? = null
    var onClick: (() -> Unit)? = null

    private val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
    private var downRawX = 0f
    private var downRawY = 0f
    private var dragging = false
    private var highlighted = false

    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE }
    private val cross = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        color = 0xFFFFFFFF.toInt()
    }
    private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFFFFFFFF.toInt()
        textAlign = Paint.Align.CENTER
        typeface = Typeface.DEFAULT_BOLD
    }

    fun setColor(newColor: Int) {
        color = newColor
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        val cx = width / 2f
        val cy = height / 2f
        val r = min(width, height) / 2f
        val stroke = r * 0.12f
        ring.strokeWidth = stroke
        ring.color = if (highlighted) 0xFFFFFFFF.toInt() else color
        fill.color = (color and 0x00FFFFFF) or (if (hollow) 0x33000000 else 0x99000000.toInt())
        canvas.drawCircle(cx, cy, r - stroke, fill)
        canvas.drawCircle(cx, cy, r - stroke, ring)

        cross.strokeWidth = stroke * 0.5f
        val c = r * 0.22f
        canvas.drawLine(cx - c, cy, cx + c, cy, cross)
        canvas.drawLine(cx, cy - c, cx, cy + c, cross)

        if (label.isNotEmpty()) {
            text.textSize = r * if (label.length > 2) 0.42f else 0.55f
            // Etiketi artının biraz üstüne yaz ki merkez görünür kalsın.
            canvas.drawText(label, cx, cy - r * 0.32f, text)
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downRawX = event.rawX
                downRawY = event.rawY
                dragging = false
                highlighted = true
                invalidate()
            }
            MotionEvent.ACTION_MOVE -> {
                val dx = event.rawX - downRawX
                val dy = event.rawY - downRawY
                if (!dragging && (abs(dx) > touchSlop || abs(dy) > touchSlop)) {
                    dragging = true
                    onDragStart?.invoke()
                }
                if (dragging) onDrag?.invoke(dx, dy)
            }
            MotionEvent.ACTION_UP -> {
                highlighted = false
                invalidate()
                if (dragging) onDragEnd?.invoke() else onClick?.invoke()
                dragging = false
            }
            MotionEvent.ACTION_CANCEL -> {
                highlighted = false
                invalidate()
                if (dragging) onDragEnd?.invoke()
                dragging = false
            }
        }
        return true
    }
}
