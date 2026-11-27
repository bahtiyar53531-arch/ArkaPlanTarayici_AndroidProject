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
 * Kucuk performans paneli. Dokununca kompakt/genis arasinda gecer,
 * surukleyerek tasinabilir. Oyun kontrollerini kapatmamak icin kucuk ve
 * yari saydamdir.
 */
class PerfPanelView @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) : View(context, attrs) {

    data class Data(
        // FPS
        val gameFps: Double? = null,
        val gameAvg: Double? = null,
        val gameMin: Double? = null,
        val lowFps: Boolean = false,
        val browserFps: Double? = null,
        val screenFps: Double? = null,
        val refreshRate: Float? = null,
        val appMemMb: Int? = null,
        val jsHeapMb: Int? = null,
        val sysAvailMb: Long? = null,
        val sysTotalMb: Long? = null,
        val thermal: String? = null,
        val battery: Int? = null,
        // Ping / ag
        val pingMs: Long? = null,
        val pingJitter: Long? = null,
        val pingLoss: Int = 0,
        val pingColor: Int = COLOR_DIM,
        val network: String = "—",
        val socket: String = "—",
        val socketColor: Int = COLOR_DIM,
    )

    var showFps = true
        set(v) { field = v; requestLayout(); invalidate() }
    var showPing = true
        set(v) { field = v; requestLayout(); invalidate() }
    var expanded = true
        set(v) { field = v; requestLayout(); invalidate() }

    private var data = Data()
    private val dp = resources.displayMetrics.density
    private val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xB3040A1F.toInt() }
    private val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = dp; color = 0x5519E3D6 }
    private val big = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD); textSize = 13f * dp }
    private val small = Paint(Paint.ANTI_ALIAS_FLAG).apply { typeface = Typeface.MONOSPACE; textSize = 10.5f * dp; color = COLOR_DIM }
    private val rect = RectF()
    private val pad = 8f * dp

    private data class Line(val text: String, val color: Int, val bold: Boolean)
    private val lines = ArrayList<Line>()

    fun update(d: Data) {
        data = d
        rebuild()
        requestLayout()
        invalidate()
    }

    private fun fmt(v: Double?) = v?.roundToInt()?.toString() ?: "—"

    private fun rebuild() {
        lines.clear()
        val d = data
        if (showFps) {
            val fpsColor = when {
                d.gameFps == null -> COLOR_DIM
                d.lowFps -> COLOR_BAD
                (d.gameFps) < 45 -> COLOR_WARN
                else -> COLOR_GOOD
            }
            val head = if (d.gameFps != null) "FPS ${fmt(d.gameFps)}" else "FPS — (oyun karesi yok)"
            lines += Line(if (expanded && d.gameFps != null) "$head  ort ${fmt(d.gameAvg)} · min ${fmt(d.gameMin)}" else head, fpsColor, true)
            if (d.lowFps) lines += Line("⚠ DÜŞÜK FPS", COLOR_BAD, true)
            if (expanded) {
                val hz = d.refreshRate?.let { " · ${it.roundToInt()}Hz" } ?: ""
                lines += Line("Tarayıcı ${fmt(d.browserFps)} · Ekran ${fmt(d.screenFps)}$hz", COLOR_DIM, false)
                val mem = buildString {
                    append("Bellek: ")
                    append(d.appMemMb?.let { "Uyg $it MB" } ?: "Uyg —")
                    d.jsHeapMb?.let { append(" · JS $it MB") }
                }
                lines += Line(mem, COLOR_DIM, false)
                if (d.sysAvailMb != null && d.sysTotalMb != null && d.sysTotalMb > 0) {
                    lines += Line("Sistem RAM: %.1f / %.1f GB boş".format(d.sysAvailMb / 1024.0, d.sysTotalMb / 1024.0), COLOR_DIM, false)
                }
                val sys = listOfNotNull(d.thermal?.let { "Isı: $it" }, d.battery?.let { "Pil %$it" }).joinToString(" · ")
                if (sys.isNotEmpty()) lines += Line(sys, COLOR_DIM, false)
            }
        }
        if (showPing) {
            val ping = d.pingMs?.let { "PING $it ms" } ?: "PING —"
            val extra = if (expanded && d.pingMs != null) "  ±${d.pingJitter ?: 0} · kayıp %${d.pingLoss}" else ""
            lines += Line(ping + extra, d.pingColor, true)
            if (expanded) {
                lines += Line("Ağ: ${d.network}", COLOR_DIM, false)
                lines += Line("Sunucu: ${d.socket}", d.socketColor, false)
            }
        }
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        if (lines.isEmpty()) rebuild()
        var maxW = 0f
        var h = pad
        for (l in lines) {
            val p = if (l.bold) big else small
            maxW = maxOf(maxW, p.measureText(l.text))
            h += p.fontSpacing
        }
        h += pad * 0.6f
        setMeasuredDimension((maxW + pad * 2).roundToInt().coerceAtLeast((60 * dp).toInt()), h.roundToInt())
    }

    override fun onDraw(canvas: Canvas) {
        rect.set(0f, 0f, width.toFloat(), height.toFloat())
        canvas.drawRoundRect(rect, 10 * dp, 10 * dp, bg)
        rect.inset(stroke.strokeWidth / 2, stroke.strokeWidth / 2)
        canvas.drawRoundRect(rect, 10 * dp, 10 * dp, stroke)
        var y = pad
        for (l in lines) {
            val p = if (l.bold) big else small
            y += -p.ascent()
            p.color = l.color
            canvas.drawText(l.text, pad, y, p)
            y += p.descent()
        }
    }

    override fun performClick(): Boolean {
        super.performClick()
        return true
    }

    companion object {
        const val COLOR_GOOD = 0xFF3DF2A5.toInt()
        const val COLOR_WARN = 0xFFFFB547.toInt()
        const val COLOR_BAD = 0xFFFF5C6C.toInt()
        const val COLOR_DIM = 0xFFB7C9E6.toInt()
        const val COLOR_INFO = 0xFF9FF7FF.toInt()
    }
}
