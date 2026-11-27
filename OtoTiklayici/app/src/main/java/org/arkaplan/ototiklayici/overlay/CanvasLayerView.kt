package org.arkaplan.ototiklayici.overlay

import android.content.Context
import android.graphics.Canvas
import android.graphics.DashPathEffect
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Typeface
import android.os.SystemClock
import android.view.View
import androidx.core.graphics.withTranslation
import org.arkaplan.ototiklayici.model.Point
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin

/**
 * Tam ekran, dokunulamayan çizim katmanı: kaydırma okları, kayıtlı hareket izleri,
 * pencereye dönüştürülmeyen hedefler, dokunuş göstergeleri ve geri sayım.
 * Koordinatlar ekran koordinatıdır; katmanın ekrandaki konumu düşülerek çizilir.
 */
class CanvasLayerView(context: Context) : View(context) {

    data class Arrow(val from: Point, val to: Point, val color: Int)
    data class Trail(val points: List<Point>, val color: Int, val label: String)
    data class Dot(val at: Point, val color: Int, val label: String)

    private data class Ripple(val at: Point, val trail: List<Point>?, val start: Long)

    var arrows: List<Arrow> = emptyList()
        set(value) { field = value; invalidate() }
    var trails: List<Trail> = emptyList()
        set(value) { field = value; invalidate() }
    var dots: List<Dot> = emptyList()
        set(value) { field = value; invalidate() }
    var countdown: Int? = null
        set(value) { field = value; invalidate() }
    var guidesVisible = true
        set(value) { field = value; invalidate() }
    var guidesAlpha = 1f
        set(value) { field = value; invalidate() }

    private val ripples = ArrayList<Ripple>()
    private val location = IntArray(2)

    private val linePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        strokeWidth = context.dp(3f)
    }
    private val dashPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        strokeWidth = context.dp(2.5f)
        pathEffect = DashPathEffect(floatArrayOf(context.dp(8f), context.dp(6f)), 0f)
    }
    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL }
    private val textPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFFFFFFFF.toInt()
        textAlign = Paint.Align.CENTER
        typeface = Typeface.DEFAULT_BOLD
        textSize = context.sp(12f)
        setShadowLayer(context.dp(2f), 0f, 0f, 0xFF000000.toInt())
    }
    private val countdownPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFFFFFFFF.toInt()
        textAlign = Paint.Align.CENTER
        typeface = Typeface.DEFAULT_BOLD
        textSize = context.sp(96f)
        setShadowLayer(context.dp(8f), 0f, 0f, 0xCC000000.toInt())
    }
    private val ripplePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = context.dp(3f)
    }

    fun showTouch(at: Point, trail: List<Point>? = null) {
        ripples += Ripple(at, trail, SystemClock.uptimeMillis())
        if (ripples.size > 40) ripples.removeAt(0)
        postInvalidateOnAnimation()
    }

    override fun onDraw(canvas: Canvas) {
        getLocationOnScreen(location)
        canvas.withTranslation(-location[0].toFloat(), -location[1].toFloat()) {
            if (guidesVisible) drawGuides(this)
            drawRipples(this)
        }

        countdown?.let {
            canvas.drawText(it.toString(), width / 2f, height / 2f + countdownPaint.textSize / 3f, countdownPaint)
        }
    }

    private fun withAlpha(color: Int, alpha: Float): Int {
        val a = ((color ushr 24) * alpha).toInt().coerceIn(0, 255)
        return (a shl 24) or (color and 0x00FFFFFF)
    }

    private fun drawGuides(canvas: Canvas) {
        for (t in trails) {
            if (t.points.size < 2) continue
            dashPaint.color = withAlpha(t.color, 0.85f * guidesAlpha)
            val path = Path().apply {
                moveTo(t.points[0].x, t.points[0].y)
                for (i in 1 until t.points.size) lineTo(t.points[i].x, t.points[i].y)
            }
            canvas.drawPath(path, dashPaint)
            fillPaint.color = withAlpha(t.color, guidesAlpha)
            canvas.drawCircle(t.points[0].x, t.points[0].y, context.dp(5f), fillPaint)
            textPaint.alpha = (255 * guidesAlpha).toInt()
            canvas.drawText(t.label, t.points[0].x, t.points[0].y - context.dp(9f), textPaint)
        }
        for (a in arrows) {
            linePaint.color = withAlpha(a.color, 0.9f * guidesAlpha)
            canvas.drawLine(a.from.x, a.from.y, a.to.x, a.to.y, linePaint)
            val angle = atan2((a.to.y - a.from.y).toDouble(), (a.to.x - a.from.x).toDouble())
            val len = context.dp(16f)
            val spread = Math.toRadians(28.0)
            // Ok ucu, bitiş işaretinin kenarında dursun.
            val tipBack = context.dp(18f)
            val tipX = a.to.x - (tipBack * cos(angle)).toFloat()
            val tipY = a.to.y - (tipBack * sin(angle)).toFloat()
            val path = Path().apply {
                moveTo(tipX, tipY)
                lineTo((tipX - len * cos(angle - spread)).toFloat(), (tipY - len * sin(angle - spread)).toFloat())
                lineTo((tipX - len * cos(angle + spread)).toFloat(), (tipY - len * sin(angle + spread)).toFloat())
                close()
            }
            fillPaint.color = withAlpha(a.color, guidesAlpha)
            canvas.drawPath(path, fillPaint)
        }
        for (d in dots) {
            fillPaint.color = withAlpha(d.color, 0.9f * guidesAlpha)
            canvas.drawCircle(d.at.x, d.at.y, context.dp(7f), fillPaint)
            textPaint.alpha = (255 * guidesAlpha).toInt()
            canvas.drawText(d.label, d.at.x, d.at.y - context.dp(11f), textPaint)
        }
        textPaint.alpha = 255
    }

    private fun drawRipples(canvas: Canvas) {
        if (ripples.isEmpty()) return
        val now = SystemClock.uptimeMillis()
        val it = ripples.iterator()
        while (it.hasNext()) {
            val r = it.next()
            val f = (now - r.start) / RIPPLE_MS.toFloat()
            if (f >= 1f) {
                it.remove()
                continue
            }
            val alpha = ((1f - f) * 230).toInt()
            r.trail?.takeIf { t -> t.size > 1 }?.let { t ->
                linePaint.color = (alpha shl 24) or 0x00FFEB3B
                val path = Path().apply {
                    moveTo(t[0].x, t[0].y)
                    for (i in 1 until t.size) lineTo(t[i].x, t[i].y)
                }
                canvas.drawPath(path, linePaint)
            }
            ripplePaint.color = (alpha shl 24) or 0x00FFEB3B
            canvas.drawCircle(r.at.x, r.at.y, context.dp(10f + 26f * f), ripplePaint)
            fillPaint.color = (alpha / 2 shl 24) or 0x00FFEB3B
            canvas.drawCircle(r.at.x, r.at.y, context.dp(8f), fillPaint)
        }
        if (ripples.isNotEmpty()) postInvalidateOnAnimation()
    }

    companion object {
        private const val RIPPLE_MS = 450L
    }
}
