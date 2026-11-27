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
 * Acilir kapanir uygulama kontrol menusu. Yalnizca kontrol dugmesine
 * dokunuldugunda gorunur; kapaliyken oyun ekranini hic kaplamaz.
 */
@SuppressLint("ViewConstructor")
class ControlMenuView(context: Context, private val onAction: (Action) -> Unit) : LinearLayout(context) {

    enum class Action {
        FULLSCREEN, PORTRAIT, LANDSCAPE, AUTO_ROTATE,
        FPS, PING, ZOOM_IN, ZOOM_OUT, ZOOM_RESET, ZOOM_PINCH,
        PIP, RECONNECT, RESTART, SETTINGS, CLOSE,
    }

    private val dp = resources.displayMetrics.density
    private val items = HashMap<Action, LinearLayout>()
    private val labels = HashMap<Action, TextView>()
    private val icons = HashMap<Action, ImageView>()
    private val zoomLabel: TextView

    init {
        orientation = VERTICAL
        setBackgroundResource(R.drawable.bg_panel)
        val p = (10 * dp).toInt()
        setPadding(p, p, p, p)
        elevation = 12 * dp
        isClickable = true // alttaki oyuna dokunus gecmesin

        // Baslik
        val header = LinearLayout(context).apply {
            orientation = HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
        }
        val brand = TextView(context).apply {
            text = "ORBITRAGAME.SPACE"
            typeface = ResourcesCompat.getFont(context, R.font.orbitron_bold)
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            letterSpacing = 0.05f
        }
        zoomLabel = TextView(context).apply {
            setTextColor(0xFF19E3D6.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            typeface = Typeface.MONOSPACE
            setPadding((8 * dp).toInt(), 0, (8 * dp).toInt(), 0)
        }
        val close = ImageView(context).apply {
            setImageResource(R.drawable.ic_close)
            imageTintList = ColorStateList.valueOf(0xFFB7C9E6.toInt())
            contentDescription = context.getString(R.string.menu_close)
            val s = (8 * dp).toInt()
            setPadding(s, s, s, s)
            setBackgroundResource(R.drawable.bg_menu_item)
            setOnClickListener { onAction(Action.CLOSE) }
        }
        header.addView(brand, LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
        header.addView(zoomLabel)
        header.addView(close, LayoutParams((36 * dp).toInt(), (36 * dp).toInt()))
        addView(header, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply { bottomMargin = (6 * dp).toInt() })

        val rows = listOf(
            listOf(
                Triple(Action.FULLSCREEN, R.drawable.ic_fullscreen, R.string.menu_fullscreen),
                Triple(Action.PORTRAIT, R.drawable.ic_portrait, R.string.menu_portrait),
                Triple(Action.LANDSCAPE, R.drawable.ic_landscape, R.string.menu_landscape),
                Triple(Action.AUTO_ROTATE, R.drawable.ic_auto_rotate, R.string.menu_auto_rotate),
            ),
            listOf(
                Triple(Action.FPS, R.drawable.ic_speed, R.string.menu_fps),
                Triple(Action.PING, R.drawable.ic_signal, R.string.menu_ping),
                Triple(Action.PIP, R.drawable.ic_pip, R.string.menu_pip),
                Triple(Action.SETTINGS, R.drawable.ic_settings, R.string.menu_settings),
            ),
            listOf(
                Triple(Action.ZOOM_IN, R.drawable.ic_zoom_in, R.string.menu_zoom_in),
                Triple(Action.ZOOM_OUT, R.drawable.ic_zoom_out, R.string.menu_zoom_out),
                Triple(Action.ZOOM_RESET, R.drawable.ic_zoom_reset, R.string.menu_zoom_reset),
                Triple(Action.ZOOM_PINCH, R.drawable.ic_pinch, R.string.menu_zoom_pinch),
            ),
            listOf(
                Triple(Action.RECONNECT, R.drawable.ic_refresh, R.string.menu_reconnect),
                Triple(Action.RESTART, R.drawable.ic_power, R.string.menu_restart),
            ),
        )
        for (row in rows) {
            val rowView = LinearLayout(context).apply { orientation = HORIZONTAL }
            for ((action, icon, label) in row) rowView.addView(makeItem(action, icon, label), LayoutParams((74 * dp).toInt(), (62 * dp).toInt()).apply {
                val m = (3 * dp).toInt(); setMargins(m, m, m, m)
            })
            addView(rowView)
        }
    }

    private fun makeItem(action: Action, @DrawableRes icon: Int, label: Int): View {
        val item = LinearLayout(context).apply {
            orientation = VERTICAL
            gravity = Gravity.CENTER
            setBackgroundResource(R.drawable.bg_menu_item)
            isClickable = true
            isFocusable = true
            contentDescription = context.getString(label)
            setOnClickListener { onAction(action) }
        }
        val iv = ImageView(context).apply {
            setImageResource(icon)
            imageTintList = ColorStateList.valueOf(0xFFEAF6FF.toInt())
        }
        val tv = TextView(context).apply {
            setText(label)
            setTextColor(0xFFCFE2FA.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 10.5f)
            gravity = Gravity.CENTER
            maxLines = 1
        }
        item.addView(iv, LayoutParams((22 * dp).toInt(), (22 * dp).toInt()))
        item.addView(tv, LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply { topMargin = (4 * dp).toInt() })
        items[action] = item
        labels[action] = tv
        icons[action] = iv
        return item
    }

    /** Menu acilmadan once guncel durumla isaretlenir. */
    fun bind(
        fullscreen: Boolean, orientation: String, fps: Boolean, ping: Boolean,
        zoomPercent: String, canZoomIn: Boolean, canZoomOut: Boolean, pipAvailable: Boolean,
    ) {
        items[Action.FULLSCREEN]?.isActivated = fullscreen
        icons[Action.FULLSCREEN]?.setImageResource(if (fullscreen) R.drawable.ic_fullscreen_exit else R.drawable.ic_fullscreen)
        items[Action.PORTRAIT]?.isActivated = orientation == "PORTRAIT"
        items[Action.LANDSCAPE]?.isActivated = orientation == "LANDSCAPE"
        items[Action.AUTO_ROTATE]?.isActivated = orientation == "AUTO"
        items[Action.FPS]?.isActivated = fps
        items[Action.PING]?.isActivated = ping
        items[Action.ZOOM_IN]?.isEnabled = canZoomIn
        items[Action.ZOOM_OUT]?.isEnabled = canZoomOut
        items[Action.ZOOM_IN]?.alpha = if (canZoomIn) 1f else 0.4f
        items[Action.ZOOM_OUT]?.alpha = if (canZoomOut) 1f else 0.4f
        items[Action.PIP]?.alpha = if (pipAvailable) 1f else 0.4f
        zoomLabel.text = "Ölçek $zoomPercent"
    }
}
