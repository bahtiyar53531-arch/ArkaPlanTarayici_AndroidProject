package space.orbitragame.app.ui

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewOutlineProvider
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.SeekBar
import android.widget.TextView
import androidx.core.content.res.ResourcesCompat
import space.orbitragame.app.R
import kotlin.math.roundToInt

/**
 * "PC gorunumu" paneli. Uc ayar canli uygulanir, oyun arkada gorunur kalir:
 *  - Oyun olcegi    : tum oyun (gemi + pencereler) yakin/uzak, %30-%160
 *  - Ust pencereler : yalnizca ekranin ust yarisindaki kutular (Gemi, P.E.T., Gorev, ust cubuk)
 *  - Alt kontroller : hotbar, joystick, pilot penceresi
 * Gemi ve harita (oyunun cizim alani) pencere olceklerinden ETKILENMEZ.
 */
@SuppressLint("ViewConstructor")
class ViewPanelView(
    context: Context,
    zoom: Float,
    hudTop: Float,
    hudBottom: Float,
    private val listener: Listener,
) : FrameLayout(context) {

    interface Listener {
        fun onZoomChanged(scale: Float)
        fun onHudChanged(top: Float, bottom: Float)
        fun onPanelClosed()
    }

    private val dp = resources.displayMetrics.density
    private var top = hudTop
    private var bottom = hudBottom
    private val zoomBar: SeekBar
    private val topBar: SeekBar
    private val bottomBar: SeekBar
    private val zoomText: TextView
    private val topText: TextView
    private val bottomText: TextView
    private val status: TextView

    init {
        isClickable = false
        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            background = GlassPanelDrawable(context, 18 * dp)
            outlineProvider = ViewOutlineProvider.BACKGROUND
            clipToOutline = true
            elevation = 14 * dp
            val p = (14 * dp).toInt()
            setPadding(p, (10 * dp).toInt(), p, p)
            isClickable = true
        }
        val title = TextView(context).apply {
            text = "PC GÖRÜNÜMÜ"
            typeface = ResourcesCompat.getFont(context, R.font.orbitron_bold)
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            letterSpacing = 0.08f
        }
        status = TextView(context).apply {
            setTextColor(0xFF9FB8D9.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            text = "Gemi ve harita değişmez; yalnızca pencereler küçülür."
        }
        card.addView(title)
        card.addView(status)

        zoomText = label()
        zoomBar = bar(((ZOOM_MAX - ZOOM_MIN) * 100).roundToInt(), ((zoom - ZOOM_MIN) * 100).roundToInt()) { v ->
            val s = ZOOM_MIN + v / 100f
            zoomText.text = "Oyun ölçeği (gemi + pencereler)  %${(s * 100).roundToInt()}"
            listener.onZoomChanged(s)
        }
        topText = label()
        topBar = bar(((1f - HUD_MIN) * 100).roundToInt(), ((hudTop - HUD_MIN) * 100).roundToInt()) { v ->
            top = HUD_MIN + v / 100f
            topText.text = "Üst pencereler  %${(top * 100).roundToInt()}"
            listener.onHudChanged(top, bottom)
        }
        bottomText = label()
        bottomBar = bar(((1f - HUD_MIN) * 100).roundToInt(), ((hudBottom - HUD_MIN) * 100).roundToInt()) { v ->
            bottom = HUD_MIN + v / 100f
            bottomText.text = "Alt kontroller  %${(bottom * 100).roundToInt()}"
            listener.onHudChanged(top, bottom)
        }
        zoomText.text = "Oyun ölçeği (gemi + pencereler)  %${(zoom * 100).roundToInt()}"
        topText.text = "Üst pencereler  %${(hudTop * 100).roundToInt()}"
        bottomText.text = "Alt kontroller  %${(hudBottom * 100).roundToInt()}"

        card.addView(topText); card.addView(topBar)
        card.addView(bottomText); card.addView(bottomBar)
        card.addView(zoomText); card.addView(zoomBar)

        val buttons = LinearLayout(context).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER }
        buttons.addView(button("PC hazır ayarı", primary = false) {
            setValues(top = PC_TOP, bottom = PC_BOTTOM)
        })
        buttons.addView(button("Sıfırla", primary = false) {
            setValues(top = 1f, bottom = 1f)
            zoomBar.progress = ((1f - ZOOM_MIN) * 100).roundToInt()
        })
        buttons.addView(button("Bitti", primary = true) { listener.onPanelClosed() })
        card.addView(buttons, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply { topMargin = (10 * dp).toInt() })

        val w = minOf((440 * dp).toInt(), resources.displayMetrics.widthPixels - (24 * dp).toInt())
        addView(card, LayoutParams(w, LayoutParams.WRAP_CONTENT, Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL).apply {
            bottomMargin = (12 * dp).toInt()
        })
    }

    /** Kac pencereye uygulandigini goster (0 ise oyun arayuzu tuval icinde cizilmis olabilir). */
    fun setAppliedCount(n: Int) {
        status.text = when {
            top >= 0.999f && bottom >= 0.999f -> "Gemi ve harita değişmez; yalnızca pencereler küçülür."
            n > 0 -> "$n arayüz öğesi küçültüldü · gemi ve harita aynı boyutta."
            else -> "Küçültülecek pencere bulunamadı (oyun ekranında olmalısın)."
        }
    }

    private fun setValues(top: Float, bottom: Float) {
        topBar.progress = ((top - HUD_MIN) * 100).roundToInt()
        bottomBar.progress = ((bottom - HUD_MIN) * 100).roundToInt()
    }

    private fun label() = TextView(context).apply {
        setTextColor(0xFFEAF6FF.toInt())
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        setPadding(0, (10 * dp).toInt(), 0, 0)
    }

    private fun bar(max: Int, value: Int, onChange: (Int) -> Unit) = SeekBar(context).apply {
        this.max = max
        progress = value.coerceIn(0, max)
        progressTintList = ColorStateList.valueOf(0xFF19E3D6.toInt())
        thumbTintList = ColorStateList.valueOf(0xFF9FF7FF.toInt())
        progressBackgroundTintList = ColorStateList.valueOf(0x55FFFFFF)
        setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
            override fun onProgressChanged(seekBar: SeekBar?, p: Int, fromUser: Boolean) = onChange(p)
            override fun onStartTrackingTouch(seekBar: SeekBar?) = Unit
            override fun onStopTrackingTouch(seekBar: SeekBar?) = Unit
        })
    }

    private fun button(text: String, primary: Boolean, onClick: () -> Unit) = Button(context).apply {
        this.text = text
        isAllCaps = false
        setTextColor(Color.WHITE)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
        setBackgroundResource(if (primary) R.drawable.bg_button_primary else R.drawable.bg_menu_item)
        minWidth = 0
        minimumWidth = 0
        setPadding((12 * dp).toInt(), 0, (12 * dp).toInt(), 0)
        layoutParams = LinearLayout.LayoutParams(0, (40 * dp).toInt(), 1f).apply {
            val m = (4 * dp).toInt(); setMargins(m, 0, m, 0)
        }
        setOnClickListener { onClick() }
    }

    companion object {
        const val ZOOM_MIN = 0.3f
        const val ZOOM_MAX = 1.6f
        const val HUD_MIN = 0.4f
        const val PC_TOP = 0.6f
        const val PC_BOTTOM = 1.0f
    }
}
