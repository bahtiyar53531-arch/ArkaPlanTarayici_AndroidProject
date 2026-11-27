package space.orbitragame.app.ui

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RadialGradient
import android.graphics.RectF
import android.graphics.Shader
import android.graphics.Typeface
import android.os.SystemClock
import android.util.AttributeSet
import android.view.View
import androidx.core.content.res.ResourcesCompat
import space.orbitragame.app.R
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.random.Random

/**
 * ORBITRAGAME.SPACE acilis / yukleme ekrani.
 * Tek bir View icinde: uzay arka plani, parildayan yildizlar, donen spiral
 * galaksi, yorungede ucan uzay gemileri, logo, yuzde gostergeli yukleme cubugu.
 *
 * Yuzde degeri disaridan GERCEK yukleme olaylarina gore verilir ([setProgress]);
 * gorunen deger yalnizca hedefe dogru yumusakca ilerler, asla onune gecmez.
 */
class SpaceLoadingView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : View(context, attrs) {

    private val dp = resources.displayMetrics.density
    private val rnd = Random(42)

    // ---- Durum ----
    private var targetPercent = 0
    private var shownPercent = 0f
    private var stageLabel = "Uygulama başlatılıyor"
    private var statusLine: String? = null
    private var statusIsWarning = false
    private val startedAt = SystemClock.uptimeMillis()
    private var lastFrameAt = startedAt

    // ---- Kaynaklar ----
    private var background: Bitmap? = null
    private val bgMatrix = Matrix()
    private val logo: Bitmap? = BitmapFactory.decodeResource(resources, R.drawable.brand_mark)
    private val typeBrand: Typeface? = ResourcesCompat.getFont(context, R.font.orbitron_black)
    private val typeBold: Typeface? = ResourcesCompat.getFont(context, R.font.orbitron_bold)

    // ---- Boyalar ----
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val bmpPaint = Paint(Paint.ANTI_ALIAS_FLAG or Paint.FILTER_BITMAP_FLAG)
    private val starPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val glowPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val trailPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeCap = Paint.Cap.ROUND }
    private val brandPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER; typeface = typeBrand }
    private val subPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER; typeface = typeBold; color = 0xFF19E3D6.toInt() }
    private val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER; color = 0xFFBFD6F5.toInt(); typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL) }
    private val percentPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.RIGHT; color = Color.WHITE; typeface = typeBold }
    private val trackPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x26FFFFFF }
    private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val shipHull = Paint(Paint.ANTI_ALIAS_FLAG)
    private val shipAccent = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFF19E3D6.toInt() }
    private val shipPath = Path()
    private val rect = RectF()

    // ---- Yildizlar ----
    private class Star(var x: Float, var y: Float, val r: Float, val phase: Float, val speed: Float, val layer: Int, val color: Int)
    private val stars = ArrayList<Star>()

    // ---- Gemiler ----
    private class Ship(var t: Float, val speed: Float, val y0: Float, val amp: Float, val scale: Float, val dir: Int, val wobble: Float) {
        // Gemi-yerel koordinatlarda sabit golgelendiriciler (her karede yeniden olusturulmaz)
        val trail: Shader = LinearGradient(-6f * scale, 0f, -70f * scale, 0f, 0xCC9FF7FF.toInt(), 0x0019E3D6, Shader.TileMode.CLAMP)
        val engine: Shader = RadialGradient(0f, 0f, 5f * scale, intArrayOf(0xEEFFFFFF.toInt(), 0x667FF6FF, 0x00000000), floatArrayOf(0f, 0.4f, 1f), Shader.TileMode.CLAMP)
        val hull: Shader = LinearGradient(0f, -4.6f * scale, 0f, 4.6f * scale, 0xFFFFFFFF.toInt(), 0xFF7FB8E6.toInt(), Shader.TileMode.CLAMP)
    }

    // Boyuta bagli, onceden olusturulan golgelendiriciler
    private var logoGlow: Shader? = null
    private var logoGlowR = 1f
    private val headGlow: Shader by lazy {
        RadialGradient(0f, 0f, 6f * dp * 3.2f, intArrayOf(0xAA9FF7FF.toInt(), 0x00000000), null, Shader.TileMode.CLAMP)
    }
    private var barShader: Shader? = null
    private var barShaderKey = 0f
    private val ships = ArrayList<Ship>()

    init {
        setLayerType(LAYER_TYPE_HARDWARE, null)
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_YES
        contentDescription = "ORBITRAGAME.SPACE yükleniyor"
    }

    /**
     * true: arkada sinematik video oynuyor (SplashVideoView). Bu durumda arka plan,
     * yildizlar, galaksi ve gemiler video tarafindan saglanir; burada yalnizca
     * okunabilirlik golgesi, marka yazisi ve yukleme cubugu cizilir.
     */
    var videoBackdrop: Boolean = false
        set(v) {
            if (field == v) return
            field = v
            brandPaint.shader = null
            if (v) { background?.recycle(); background = null }
            else if (width > 0 && height > 0) loadBackground(width, height)
            postInvalidateOnAnimation()
        }
    private val shadePaint = Paint()
    private var shadeH = 0

    /** Gercek yukleme olaylarindan gelen yuzde ve asama metni. */
    fun setProgress(percent: Int, label: String) {
        targetPercent = percent.coerceIn(0, 100)
        stageLabel = label
        contentDescription = "Yükleniyor yüzde $targetPercent. $label"
        postInvalidateOnAnimation()
    }

    /** Ek durum satiri (or. "Internet baglantisi bekleniyor"). null = gizle. */
    fun setStatus(text: String?, warning: Boolean = false) {
        statusLine = text
        statusIsWarning = warning
        postInvalidateOnAnimation()
    }

    /** Gosterilen yuzde hedefe ulasti mi (gecis animasyonu icin). */
    val isVisuallyComplete: Boolean get() = shownPercent >= 99.5f && targetPercent >= 100

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (w == 0 || h == 0) return
        shadeH = 0
        buildStars(w, h)
        buildShips(w, h)
        if (!videoBackdrop) loadBackground(w, h)
        brandPaint.shader = null
        logoGlowR = min(w, h) * 0.34f * 0.8f
        logoGlow = RadialGradient(0f, 0f, logoGlowR, intArrayOf(0x5519E3D6, 0x222F7BFF, 0x00000000), floatArrayOf(0f, 0.5f, 1f), Shader.TileMode.CLAMP)
        barShader = null
    }

    private fun loadBackground(w: Int, h: Int) {
        if (background != null) { fitBackground(w, h); return }
        val opts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeResource(resources, R.drawable.bg_space, opts)
        var sample = 1
        while (opts.outWidth / (sample * 2) >= w && opts.outHeight / (sample * 2) >= h) sample *= 2
        background = runCatching {
            BitmapFactory.decodeResource(resources, R.drawable.bg_space, BitmapFactory.Options().apply { inSampleSize = sample })
        }.getOrNull()
        fitBackground(w, h)
    }

    private fun fitBackground(w: Int, h: Int) {
        val bg = background ?: return
        val s = max(w.toFloat() / bg.width, h.toFloat() / bg.height)
        bgMatrix.reset()
        bgMatrix.setScale(s, s)
        bgMatrix.postTranslate((w - bg.width * s) / 2f, (h - bg.height * s) / 2f)
    }

    private fun buildStars(w: Int, h: Int) {
        stars.clear()
        val count = ((w * h) / (dp * dp * 900f)).roundToInt().coerceIn(80, 260)
        repeat(count) {
            val layer = when { it % 7 == 0 -> 2; it % 3 == 0 -> 1; else -> 0 }
            val color = when (rnd.nextInt(10)) { 0 -> 0xFF9FF7FF.toInt(); 1 -> 0xFFBFD4FF.toInt(); else -> Color.WHITE }
            stars += Star(
                rnd.nextFloat() * w, rnd.nextFloat() * h,
                (0.5f + rnd.nextFloat().pow(3) * (1.4f + layer)) * dp * 0.8f,
                rnd.nextFloat() * 6.28f, 0.6f + rnd.nextFloat() * 2.2f, layer, color,
            )
        }
    }

    private fun buildShips(w: Int, h: Int) {
        ships.clear()
        repeat(4) { i ->
            ships += Ship(
                t = rnd.nextFloat(),
                speed = 0.035f + rnd.nextFloat() * 0.05f,
                y0 = h * (0.12f + 0.76f * rnd.nextFloat()),
                amp = h * (0.03f + rnd.nextFloat() * 0.07f),
                scale = dp * (0.75f + rnd.nextFloat() * 0.9f) * (if (i == 0) 1.4f else 1f),
                dir = if (i % 2 == 0) 1 else -1,
                wobble = rnd.nextFloat() * 6.28f,
            )
        }
    }

    @SuppressLint("DrawAllocation") // Tek seferlik: yazi golgelendiricisi yalnizca boyut degisince olusturulur
    override fun onDraw(canvas: Canvas) {
        val w = width.toFloat()
        val h = height.toFloat()
        val now = SystemClock.uptimeMillis()
        val time = (now - startedAt) / 1000f
        val dt = ((now - lastFrameAt) / 1000f).coerceIn(0f, 0.1f)
        lastFrameAt = now

        // Gosterilen yuzdeyi hedefe yumusakca yaklastir (hedefi asla gecmez).
        if (shownPercent < targetPercent) {
            val speed = max(30f, (targetPercent - shownPercent) * 4f) // yuzde / saniye
            shownPercent = min(targetPercent.toFloat(), shownPercent + speed * dt)
        }

        val landscape = w > h
        val logoCy = h * (if (landscape) 0.27f else 0.36f)
        val logoSize = min(w, h) * (if (landscape) 0.28f else 0.34f)
        val brandSize: Float
        val brandY: Float
        if (videoBackdrop) {
            // Video uzerinde okunabilirlik icin yumusak ust/alt golge
            if (shadeH != height) {
                shadeH = height
                shadePaint.shader = LinearGradient(0f, 0f, 0f, h,
                    intArrayOf(0x99000000.toInt(), 0x00000000, 0x00000000, 0xB3000000.toInt()),
                    floatArrayOf(0f, 0.28f, 0.6f, 1f), Shader.TileMode.CLAMP)
            }
            canvas.drawRect(0f, 0f, w, h, shadePaint)
            brandSize = min(w * 0.088f, 44f * dp)
            brandY = h * (if (landscape) 0.40f else 0.40f)
        } else {
            drawProceduralScene(canvas, w, h, dt, time, logoCy, logoSize)
            brandSize = min(w * 0.072f, 34f * dp)
            brandY = logoCy + logoSize * 0.62f + brandSize
        }
        drawForeground(canvas, w, h, brandSize, brandY)
        if (visibility == VISIBLE && isAttachedToWindow) postInvalidateOnAnimation()
    }

    /** Video yoksa: hareketsiz arka plan + galaksi + yildizlar + gemiler + logo. */
    private fun drawProceduralScene(canvas: Canvas, w: Float, h: Float, dt: Float, time: Float, logoCy: Float, logoSize: Float) {
        // 1) Arka plan
        val bg = background
        if (bg != null) canvas.drawBitmap(bg, bgMatrix, bmpPaint) else canvas.drawColor(0xFF02040D.toInt())

        // 3) Yildizlar (parildama + katmanli kayma)
        for (s in stars) {
            val drift = (s.layer + 1) * 4f * dp * dt
            s.y += drift
            if (s.y > h + 4) { s.y = -4f; s.x = rnd.nextFloat() * w }
            val tw = 0.55f + 0.45f * sin(time * s.speed + s.phase)
            starPaint.color = s.color
            starPaint.alpha = (tw * (150 + s.layer * 45)).roundToInt().coerceIn(0, 255)
            canvas.drawCircle(s.x, s.y, s.r, starPaint)
            if (s.layer == 2 && tw > 0.85f) {
                starPaint.alpha = 60
                canvas.drawCircle(s.x, s.y, s.r * 3f, starPaint)
            }
        }

        // 4) Uzay gemileri: yalnizca gercekci arka plan yuklenemezse (dusuk bellek) cizilir
        if (bg == null) for (sh in ships) {
            sh.t += sh.speed * dt
            if (sh.t > 1.15f) sh.t = -0.15f
            drawShip(canvas, sh, w, time)
        }

        // 5) Logo + parlama
        logoGlow?.let { shader ->
            val pulse = 0.94f + 0.06f * sin(time * 2.2f)
            canvas.save()
            canvas.translate(w / 2f, logoCy)
            canvas.scale(pulse, pulse)
            glowPaint.shader = shader
            canvas.drawCircle(0f, 0f, logoGlowR, glowPaint)
            canvas.restore()
        }
        logo?.let {
            val bob = sin(time * 1.6f) * dp * 3f
            rect.set(w / 2f - logoSize / 2f, logoCy - logoSize / 2f + bob, w / 2f + logoSize / 2f, logoCy + logoSize / 2f + bob)
            canvas.drawBitmap(it, null, rect, bmpPaint)
        }

    }

    /** Marka yazisi + yukleme cubugu + metinler (her iki modda). */
    private fun drawForeground(canvas: Canvas, w: Float, h: Float, brandSize: Float, brandY: Float) {
        // 6) Marka yazisi
        brandPaint.textSize = brandSize
        brandPaint.letterSpacing = 0.06f
        if (brandPaint.shader == null) {
            brandPaint.shader = LinearGradient(0f, brandY - brandSize, 0f, brandY, 0xFFFFFFFF.toInt(), 0xFF7FE3FF.toInt(), Shader.TileMode.CLAMP)
        }
        brandPaint.setShadowLayer(brandSize * 0.25f, 0f, 0f, 0x8819E3D6.toInt())
        canvas.drawText("ORBITRAGAME", w / 2f, brandY, brandPaint)
        subPaint.textSize = brandSize * 0.62f
        subPaint.letterSpacing = 0.45f
        canvas.drawText(".SPACE", w / 2f + subPaint.textSize * 0.2f, brandY + brandSize * 1.15f, subPaint)

        // 7) Yukleme cubugu
        val barW = min(w * 0.74f, 420f * dp)
        val barH = 6f * dp
        val barX = (w - barW) / 2f
        val bottomRoom = (if (statusLine != null) 64f else 40f) * dp
        val barY = min(max(brandY + brandSize * 2.4f, h * 0.74f), h - bottomRoom - barH)
        rect.set(barX, barY, barX + barW, barY + barH)
        canvas.drawRoundRect(rect, barH, barH, trackPaint)
        val fillW = barW * (shownPercent / 100f)
        if (fillW > 0.5f) {
            val key = barX * 31 + barW
            if (barShader == null || barShaderKey != key) {
                barShader = LinearGradient(barX, 0f, barX + barW, 0f, 0xFF2F7BFF.toInt(), 0xFF19E3D6.toInt(), Shader.TileMode.CLAMP)
                barShaderKey = key
            }
            fillPaint.shader = barShader
            rect.set(barX, barY, barX + fillW, barY + barH)
            canvas.drawRoundRect(rect, barH, barH, fillPaint)
            // Ilerleme ucunda parlama
            canvas.save()
            canvas.translate(barX + fillW, barY + barH / 2)
            glowPaint.shader = headGlow
            canvas.drawCircle(0f, 0f, barH * 3.2f, glowPaint)
            canvas.restore()
        }

        // Yuzde ve asama metni
        percentPaint.textSize = 15f * dp
        canvas.drawText("%" + shownPercent.roundToInt(), barX + barW, barY - 10f * dp, percentPaint)
        labelPaint.textSize = 14f * dp
        labelPaint.color = 0xFFBFD6F5.toInt()
        canvas.drawText(stageLabel, w / 2f, barY + barH + 26f * dp, labelPaint)
        statusLine?.let {
            labelPaint.textSize = 13f * dp
            labelPaint.color = if (statusIsWarning) 0xFFFFB547.toInt() else 0xFF9FB8D9.toInt()
            canvas.drawText(it, w / 2f, barY + barH + 50f * dp, labelPaint)
        }
    }

    private fun drawShip(canvas: Canvas, sh: Ship, w: Float, time: Float) {
        val x = if (sh.dir > 0) -w * 0.1f + sh.t * w * 1.2f else w * 1.1f - sh.t * w * 1.2f
        val y = sh.y0 + sin(sh.t * 6.28f + sh.wobble) * sh.amp
        val dy = cos(sh.t * 6.28f + sh.wobble) * sh.amp * 6.28f / (w * 1.2f)
        val angle = Math.toDegrees(kotlin.math.atan2(dy.toDouble(), sh.dir.toDouble())).toFloat()
        val s = sh.scale

        canvas.save()
        canvas.translate(x, y)
        canvas.rotate(angle)
        // Motor izi
        trailPaint.strokeWidth = 2.2f * s
        trailPaint.shader = sh.trail
        canvas.drawLine(-6f * s, 0f, -70f * s, 0f, trailPaint)
        // Motor parlamasi (titresim olcekle yapilir)
        val flicker = 0.8f + 0.2f * sin(time * 30f + sh.wobble)
        canvas.save()
        canvas.translate(-6.5f * s, 0f)
        canvas.scale(flicker, flicker)
        glowPaint.shader = sh.engine
        canvas.drawCircle(0f, 0f, 5f * s, glowPaint)
        canvas.restore()
        // Govde
        shipPath.reset()
        shipPath.moveTo(7.5f * s, 0f)
        shipPath.lineTo(-3.8f * s, -4.6f * s)
        shipPath.lineTo(-2.2f * s, -1.3f * s)
        shipPath.lineTo(-6.2f * s, -1.9f * s)
        shipPath.lineTo(-6.2f * s, 1.9f * s)
        shipPath.lineTo(-2.2f * s, 1.3f * s)
        shipPath.lineTo(-3.8f * s, 4.6f * s)
        shipPath.close()
        shipHull.shader = sh.hull
        canvas.drawPath(shipPath, shipHull)
        canvas.drawOval(0.4f * s, -0.9f * s, 4.4f * s, 0.9f * s, shipAccent)
        canvas.restore()
    }

    override fun onVisibilityChanged(changedView: View, visibility: Int) {
        super.onVisibilityChanged(changedView, visibility)
        if (visibility == VISIBLE) {
            if (!videoBackdrop && background == null && width > 0 && height > 0) loadBackground(width, height)
            lastFrameAt = SystemClock.uptimeMillis()
            postInvalidateOnAnimation()
        }
    }

    /** Ekran kapandiktan sonra buyuk bitmap'leri serbest birak. */
    fun release() {
        background?.recycle(); background = null
    }
}
