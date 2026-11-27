package space.orbitragame.app.ui

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BitmapShader
import android.graphics.Canvas
import android.graphics.ColorFilter
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Rect
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.drawable.Drawable
import space.orbitragame.app.R
import kotlin.math.max

/**
 * Gercekci "cam panel" arka plani: render edilmis uzay sahnesinin bulaniklastirilmis
 * goruntusu (center-crop) + koyu degrade + ince turkuaz kenar. Menu ve paneller icin.
 */
class GlassPanelDrawable(context: Context, private val radiusPx: Float) : Drawable() {

    private val bitmap: Bitmap? = shared(context)
    private val imagePaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val shadePaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE
        strokeWidth = context.resources.displayMetrics.density
        color = 0x8819E3D6.toInt()
    }
    private val rect = RectF()
    private val matrix = Matrix()

    override fun onBoundsChange(bounds: Rect) {
        super.onBoundsChange(bounds)
        rect.set(bounds)
        bitmap?.let { b ->
            val s = max(bounds.width().toFloat() / b.width, bounds.height().toFloat() / b.height)
            matrix.setScale(s, s)
            matrix.postTranslate(bounds.left + (bounds.width() - b.width * s) / 2f, bounds.top + (bounds.height() - b.height * s) / 2f)
            imagePaint.shader = BitmapShader(b, Shader.TileMode.CLAMP, Shader.TileMode.CLAMP).apply { setLocalMatrix(matrix) }
        }
        shadePaint.shader = LinearGradient(0f, bounds.top.toFloat(), 0f, bounds.bottom.toFloat(), 0xB0050A1E.toInt(), 0xD8020610.toInt(), Shader.TileMode.CLAMP)
    }

    override fun draw(canvas: Canvas) {
        if (imagePaint.shader != null) canvas.drawRoundRect(rect, radiusPx, radiusPx, imagePaint)
        canvas.drawRoundRect(rect, radiusPx, radiusPx, shadePaint)
        val inset = strokePaint.strokeWidth / 2
        rect.inset(inset, inset)
        canvas.drawRoundRect(rect, radiusPx, radiusPx, strokePaint)
        rect.inset(-inset, -inset)
    }

    override fun getOutline(outline: Outline) {
        outline.setRoundRect(bounds, radiusPx)
    }

    override fun setAlpha(alpha: Int) {
        imagePaint.alpha = alpha; shadePaint.alpha = alpha; strokePaint.alpha = alpha
    }

    override fun setColorFilter(colorFilter: ColorFilter?) {
        imagePaint.colorFilter = colorFilter
    }

    @Deprecated("Deprecated in Java")
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT

    companion object {
        @Volatile private var cached: Bitmap? = null

        private fun shared(context: Context): Bitmap? {
            cached?.let { return it }
            return runCatching { BitmapFactory.decodeResource(context.resources, R.drawable.panel_blur) }.getOrNull()?.also { cached = it }
        }
    }
}
