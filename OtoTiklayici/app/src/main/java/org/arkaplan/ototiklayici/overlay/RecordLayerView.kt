package org.arkaplan.ototiklayici.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Typeface
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import org.arkaplan.ototiklayici.engine.RecordedGesture
import org.arkaplan.ototiklayici.engine.TouchRecorder

/**
 * Kayıt sırasında tüm ekranı kaplayan, dokunuşları yakalayan katman.
 * Her tamamlanan hareket [onGesture] ile bildirilir; oturum isterse onu alttaki uygulamaya aktarır.
 */
@SuppressLint("ViewConstructor")
class RecordLayerView(context: Context, private val recorder: TouchRecorder) : View(context) {

    var onGesture: ((RecordedGesture) -> Unit)? = null

    var gestureCount = 0
        set(value) { field = value; invalidate() }
    var forwarding = false
        set(value) { field = value; invalidate() }
    var startedAt = SystemClock.elapsedRealtime()

    private val location = IntArray(2)
    private val live = HashMap<Int, Path>()
    private val fading = ArrayList<Pair<Path, Long>>()

    private val border = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        color = OverlayColors.RECORD
        strokeWidth = context.dp(4f)
    }
    private val tint = Paint().apply { color = 0x14FF3B30 }
    private val trail = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = context.dp(5f)
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        color = 0xCCFF3B30.toInt()
    }
    private val badgeBg = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xE6000000.toInt() }
    private val badgeText = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        color = 0xFFFFFFFF.toInt()
        textSize = context.sp(13f)
        typeface = Typeface.DEFAULT_BOLD
        textAlign = Paint.Align.CENTER
    }
    private val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = OverlayColors.RECORD }
    private val badgeRect = RectF()

    private val ticker = object : Runnable {
        override fun run() {
            invalidate()
            postDelayed(this, 500)
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        post(ticker)
    }

    override fun onDetachedFromWindow() {
        removeCallbacks(ticker)
        super.onDetachedFromWindow()
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        if (event.actionMasked == MotionEvent.ACTION_DOWN) getLocationOnScreen(location)
        val ox = location[0].toFloat()
        val oy = location[1].toFloat()
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
                val i = event.actionIndex
                val id = event.getPointerId(i)
                recorder.down(id, event.getX(i) + ox, event.getY(i) + oy, event.eventTime)
                live[id] = Path().apply { moveTo(event.getX(i), event.getY(i)) }
            }
            MotionEvent.ACTION_MOVE -> {
                for (h in 0 until event.historySize) {
                    val t = event.getHistoricalEventTime(h)
                    for (i in 0 until event.pointerCount) {
                        val id = event.getPointerId(i)
                        val x = event.getHistoricalX(i, h)
                        val y = event.getHistoricalY(i, h)
                        recorder.move(id, x + ox, y + oy, t)
                        live[id]?.lineTo(x, y)
                    }
                }
                for (i in 0 until event.pointerCount) {
                    val id = event.getPointerId(i)
                    recorder.move(id, event.getX(i) + ox, event.getY(i) + oy, event.eventTime)
                    live[id]?.lineTo(event.getX(i), event.getY(i))
                }
            }
            MotionEvent.ACTION_POINTER_UP, MotionEvent.ACTION_UP -> {
                val i = event.actionIndex
                val id = event.getPointerId(i)
                live.remove(id)?.let { fading += it to SystemClock.uptimeMillis() }
                val g = recorder.up(id, event.getX(i) + ox, event.getY(i) + oy, event.eventTime)
                if (g != null) onGesture?.invoke(g)
            }
            MotionEvent.ACTION_CANCEL -> {
                recorder.cancel()
                live.clear()
            }
        }
        invalidate()
        return true
    }

    override fun onDraw(canvas: Canvas) {
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), tint)
        val inset = border.strokeWidth / 2
        canvas.drawRect(inset, inset, width - inset, height - inset, border)

        for (p in live.values) canvas.drawPath(p, trail)
        val now = SystemClock.uptimeMillis()
        fading.removeAll { now - it.second > 600 }
        for ((p, start) in fading) {
            trail.alpha = (204 * (1f - (now - start) / 600f)).toInt().coerceIn(0, 204)
            canvas.drawPath(p, trail)
        }
        trail.alpha = 204
        if (fading.isNotEmpty()) postInvalidateOnAnimation()

        val elapsed = formatDuration(SystemClock.elapsedRealtime() - startedAt)
        val label = if (forwarding) "Aktarılıyor…  $elapsed" else "KAYIT  $elapsed  ·  $gestureCount hareket"
        val w = badgeText.measureText(label) + context.dp(40f)
        val h = context.dp(30f)
        val top = context.dp(44f)
        val rect = badgeRect.apply { set((width - w) / 2, top, (width + w) / 2, top + h) }
        canvas.drawRoundRect(rect, h / 2, h / 2, badgeBg)
        val blinkOn = (SystemClock.elapsedRealtime() / 500) % 2 == 0L
        if (blinkOn || forwarding) canvas.drawCircle(rect.left + context.dp(16f), rect.centerY(), context.dp(5f), dot)
        canvas.drawText(label, rect.centerX() + context.dp(8f), rect.centerY() + badgeText.textSize / 3, badgeText)
    }
}
