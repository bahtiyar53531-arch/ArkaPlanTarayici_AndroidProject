package org.arkaplan.ototiklayici.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Typeface
import android.view.Gravity
import android.view.View
import android.widget.ImageButton
import android.widget.LinearLayout
import android.widget.TextView
import org.arkaplan.ototiklayici.R
import org.arkaplan.ototiklayici.data.PanelOrientation
import kotlin.math.roundToInt

/** Sürüklenebilir yüzen kontrol paneli. Olaylar [OverlaySession] tarafından bağlanır. */
@SuppressLint("ViewConstructor")
class PanelView(
    context: Context,
    orientation: PanelOrientation,
    scale: Float,
) : LinearLayout(context) {

    private val buttonSize = context.dpi(44f * scale.coerceIn(0.6f, 1.6f))

    val handle: ImageButton = button(R.drawable.ic_drag, "Taşı / küçült")
    val play: ImageButton = button(R.drawable.ic_play, "Başlat / durdur")
    val record: ImageButton = button(R.drawable.ic_record, "Hareketlerini kaydet")
    val addTap: ImageButton = button(R.drawable.ic_add, "Dokunma hedefi ekle")
    val addSwipe: ImageButton = button(R.drawable.ic_swipe, "Kaydırma hedefi ekle")
    val undo: ImageButton = button(R.drawable.ic_undo, "Son adımı sil (uzun bas: hepsini)")
    val eye: ImageButton = button(R.drawable.ic_visibility, "Hedefleri göster / gizle")
    val tune: ImageButton = button(R.drawable.ic_tune, "Tekrar ve hız ayarları")
    val save: ImageButton = button(R.drawable.ic_save, "Kaydet (uzun bas: farklı kaydet)")
    val close: ImageButton = button(R.drawable.ic_close, "Paneli kapat")

    val status: TextView = TextView(context).apply {
        setTextColor(OverlayColors.ON_SURFACE)
        textSize = 9.5f * scale.coerceIn(0.6f, 1.6f)
        typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        gravity = Gravity.CENTER
        includeFontPadding = false
        maxLines = 3
    }

    private val collapsible: List<View> = listOf(record, addTap, addSwipe, undo, eye, tune, save, close, status)

    var collapsed = false
        set(value) {
            field = value
            collapsible.forEach { it.visibility = if (value) GONE else VISIBLE }
        }

    init {
        this.orientation = if (orientation == PanelOrientation.VERTICAL) VERTICAL else HORIZONTAL
        gravity = Gravity.CENTER
        val pad = context.dpi(4f)
        setPadding(pad, pad, pad, pad)
        background = roundedBackground(OverlayColors.PANEL_BG, context.dp(28f), 0x33FFFFFF, context.dpi(1f))
        elevation = context.dp(6f)
        listOf(handle, play, record, addTap, addSwipe, undo, eye, tune, save, close).forEach {
            addView(it, LayoutParams(buttonSize, buttonSize))
        }
        val statusParams = if (orientation == PanelOrientation.VERTICAL) {
            LayoutParams(buttonSize + context.dpi(6f), LayoutParams.WRAP_CONTENT).apply {
                topMargin = context.dpi(2f)
                bottomMargin = context.dpi(4f)
            }
        } else {
            LayoutParams(LayoutParams.WRAP_CONTENT, buttonSize).apply {
                marginStart = context.dpi(4f)
                marginEnd = context.dpi(8f)
            }
        }
        addView(status, statusParams)
        play.setActiveColor(OverlayColors.PLAY)
    }

    private fun button(icon: Int, description: String): ImageButton =
        context.panelButton(icon, description, (buttonSize * 1f).roundToInt())
}
