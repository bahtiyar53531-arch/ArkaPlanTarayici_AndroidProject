package space.orbitragame.app.ui

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.annotation.DrawableRes
import androidx.core.content.res.ResourcesCompat
import space.orbitragame.app.R

/**
 * Sade ve hafif kontrol menusu: bir zoom satiri + 6 dugme.
 * Bir kez olusturulur, sonra yalnizca gosterilip gizlenir (her acilista
 * yeniden kurulmaz). Golge, resim veya bulaniklik yok: oyunun ustunde
 * acikken bile cizim maliyeti cok dusuktur.
 */
@SuppressLint("ViewConstructor")
class ControlMenuView(context: Context, private val onAction: (Action) -> Unit) : LinearLayout(context) {

    enum class Action { ZOOM_OUT, ZOOM_IN, ZOOM_RESET, FPS, PC_VIEW, ORIENTATION, PIP, RECONNECT, SETTINGS, CLOSE }

    data class State(
        val zoomLabel: String,
        val canZoomIn: Boolean,
        val canZoomOut: Boolean,
        val fpsOn: Boolean,
        val pcLabel: String,
        val pcOn: Boolean,
        val orientationLabel: String,
        val pipAvailable: Boolean,
    )

    private val dp = resources.displayMetrics.density
    private val zoomText: TextView
    private val zoomOut: TextView
    private val zoomIn: TextView
    private val items = HashMap<Action, LinearLayout>()
    private val states = HashMap<Action, TextView>()

    init {
        orientation = VERTICAL
        setBackgroundResource(R.drawable.bg_menu_panel)
        val p = (12 * dp).toInt()
        setPadding(p, (10 * dp).toInt(), p, p)
        isClickable = true // alttaki oyuna dokunus gecmesin

        // ---- Ust satir: zoom (- %100 +) ve kapat ----
        val header = LinearLayout(context).apply { orientation = HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        zoomOut = roundButton("−", context.getString(R.string.menu_zoom_out)) { onAction(Action.ZOOM_OUT) }
        zoomIn = roundButton("+", context.getString(R.string.menu_zoom_in)) { onAction(Action.ZOOM_IN) }
        zoomText = TextView(context).apply {
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            typeface = ResourcesCompat.getFont(context, R.font.orbitron_bold)
            gravity = Gravity.CENTER
            minWidth = (64 * dp).toInt()
            contentDescription = context.getString(R.string.menu_zoom_reset)
            setOnClickListener { onAction(Action.ZOOM_RESET) } // dokun: %100'e don
        }
        val close = ImageView(context).apply {
            setImageResource(R.drawable.ic_close)
            imageTintList = ColorStateList.valueOf(0xFFB7C9E6.toInt())
            contentDescription = context.getString(R.string.menu_close)
            val s = (8 * dp).toInt()
            setPadding(s, s, s, s)
            setBackgroundResource(R.drawable.bg_round_button)
            setOnClickListener { onAction(Action.CLOSE) }
        }
        val size = (40 * dp).toInt()
        header.addView(zoomOut, LayoutParams(size, size))
        header.addView(zoomText, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT))
        header.addView(zoomIn, LayoutParams(size, size))
        header.addView(View(context), LayoutParams(0, 1, 1f))
        header.addView(close, LayoutParams(size, size))
        // Ust satir izgara genisliginde sabit: esnek bosluk menuyu ekran genisligine yaymasin.
        val gridWidth = (3 * (92 + 6) * dp).toInt()
        addView(header, LayoutParams(gridWidth, LayoutParams.WRAP_CONTENT).apply { bottomMargin = (8 * dp).toInt() })

        // ---- 6 dugme ----
        val rows = listOf(
            listOf(Triple(Action.FPS, R.drawable.ic_speed, R.string.menu_fps), Triple(Action.PC_VIEW, R.drawable.ic_pc, R.string.menu_pc_view), Triple(Action.ORIENTATION, R.drawable.ic_auto_rotate, R.string.menu_orientation)),
            listOf(Triple(Action.PIP, R.drawable.ic_pip, R.string.menu_pip), Triple(Action.RECONNECT, R.drawable.ic_refresh, R.string.menu_reconnect), Triple(Action.SETTINGS, R.drawable.ic_settings, R.string.menu_settings)),
        )
        for (row in rows) {
            val rowView = LinearLayout(context).apply { orientation = HORIZONTAL }
            for ((action, icon, label) in row) rowView.addView(item(action, icon, label), LayoutParams((92 * dp).toInt(), (70 * dp).toInt()).apply {
                val m = (3 * dp).toInt(); setMargins(m, m, m, m)
            })
            addView(rowView)
        }
    }

    private fun roundButton(text: String, desc: String, onClick: () -> Unit) = TextView(context).apply {
        this.text = text
        setTextColor(Color.WHITE)
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
        gravity = Gravity.CENTER
        includeFontPadding = false
        contentDescription = desc
        setBackgroundResource(R.drawable.bg_round_button)
        setOnClickListener { onClick() }
    }

    private fun item(action: Action, @DrawableRes icon: Int, label: Int): View {
        val box = LinearLayout(context).apply {
            orientation = VERTICAL
            gravity = Gravity.CENTER
            setBackgroundResource(R.drawable.bg_menu_item)
            isClickable = true
            isFocusable = true
            contentDescription = context.getString(label)
            setOnClickListener { onAction(action) }
        }
        box.addView(ImageView(context).apply {
            setImageResource(icon)
            imageTintList = ColorStateList.valueOf(0xFFEAF6FF.toInt())
        }, LayoutParams((22 * dp).toInt(), (22 * dp).toInt()))
        box.addView(TextView(context).apply {
            setText(label)
            setTextColor(0xFFEAF6FF.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11.5f)
            typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
            gravity = Gravity.CENTER
            maxLines = 1
        }, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply { topMargin = (3 * dp).toInt() })
        val state = TextView(context).apply {
            setTextColor(0xFF19E3D6.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 10f)
            gravity = Gravity.CENTER
            maxLines = 1
        }
        box.addView(state)
        items[action] = box
        states[action] = state
        return box
    }

    /** Menu acilmadan once guncel durumla isaretlenir. */
    fun bind(s: State) {
        zoomText.text = s.zoomLabel
        zoomOut.isEnabled = s.canZoomOut; zoomOut.alpha = if (s.canZoomOut) 1f else 0.35f
        zoomIn.isEnabled = s.canZoomIn; zoomIn.alpha = if (s.canZoomIn) 1f else 0.35f
        items[Action.FPS]?.isActivated = s.fpsOn
        states[Action.FPS]?.text = context.getString(if (s.fpsOn) R.string.state_on else R.string.state_off)
        items[Action.PC_VIEW]?.isActivated = s.pcOn
        states[Action.PC_VIEW]?.text = s.pcLabel
        states[Action.ORIENTATION]?.text = s.orientationLabel
        items[Action.PIP]?.alpha = if (s.pipAvailable) 1f else 0.4f
        states[Action.PIP]?.text = ""
        states[Action.RECONNECT]?.text = ""
        states[Action.SETTINGS]?.text = ""
    }
}
