package org.arkaplan.ototiklayici.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Typeface
import android.text.InputType
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.EditText
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Overlay üzerinde gösterilen basit iletişim kutusu (ekranın üst kısmında bir kart).
 * Klavye açılabilsin diye penceresi odaklanabilir yapılır.
 */
class OverlayDialog(private val context: Context, private val wm: WindowManager) {

    enum class Style { PRIMARY, NORMAL, DANGER }

    private var root: View? = null

    val isShowing: Boolean get() = root != null

    fun show(title: String, build: Builder.() -> Unit) {
        dismiss()
        val builder = Builder(context).apply(build)
        val screen = context.realScreenSize()

        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            val pad = context.dpi(20f)
            setPadding(pad, pad, pad, context.dpi(12f))
            background = roundedBackground(OverlayColors.SURFACE, context.dp(24f))
            elevation = context.dp(12f)
            isClickable = true
            addView(TextView(context).apply {
                text = title
                textSize = 19f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(OverlayColors.ON_SURFACE)
                setPadding(0, 0, 0, context.dpi(8f))
            })
            val scroll = ScrollView(context).apply {
                isFillViewport = false
                addView(builder.body)
            }
            addView(scroll, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
            addView(builder.buttonRow, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { topMargin = context.dpi(8f) })
        }

        val scrim = object : FrameLayout(context) {
            override fun dispatchKeyEvent(event: KeyEvent): Boolean {
                if (event.keyCode == KeyEvent.KEYCODE_BACK) {
                    if (event.action == KeyEvent.ACTION_UP) dismiss()
                    return true
                }
                return super.dispatchKeyEvent(event)
            }
        }.apply {
            setBackgroundColor(OverlayColors.SCRIM)
            setOnClickListener { if (builder.cancelable) dismiss() }
            val width = min(screen.x - context.dpi(32f), context.dpi(440f))
            val maxHeight = (screen.y * 0.62f).roundToInt()
            card.measure(
                View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(maxHeight, View.MeasureSpec.AT_MOST),
            )
            addView(card, FrameLayout.LayoutParams(width, min(card.measuredHeight, maxHeight)).apply {
                gravity = Gravity.TOP or Gravity.CENTER_HORIZONTAL
                topMargin = (screen.y * 0.1f).roundToInt()
            })
        }
        builder.onDismissRequest = { dismiss() }
        val params = overlayParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            touchable = true,
            focusable = true,
        )
        try {
            wm.addView(scrim, params)
            root = scrim
        } catch (_: RuntimeException) {
            root = null
        }
    }

    fun dismiss() {
        root?.let { runCatching { wm.removeView(it) } }
        root = null
    }

    class Builder(private val context: Context) {
        val body = LinearLayout(context).apply { orientation = LinearLayout.VERTICAL }
        val buttonRow = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.END or Gravity.CENTER_VERTICAL
        }
        var cancelable = true
        internal var onDismissRequest: () -> Unit = {}

        fun message(text: String) {
            body.addView(TextView(context).apply {
                this.text = text
                textSize = 14.5f
                setTextColor(OverlayColors.ON_SURFACE_DIM)
                setLineSpacing(0f, 1.15f)
                setPadding(0, context.dpi(2f), 0, context.dpi(10f))
            })
        }

        private fun label(text: String) = TextView(context).apply {
            this.text = text
            textSize = 13f
            setTextColor(OverlayColors.ON_SURFACE_DIM)
            setPadding(0, context.dpi(8f), 0, 0)
        }

        private fun editText(value: String, numeric: Boolean) = EditText(context).apply {
            setText(value)
            setSelectAllOnFocus(true)
            setSingleLine()
            textSize = 16f
            setTextColor(OverlayColors.ON_SURFACE)
            backgroundTintList = ColorStateList.valueOf(OverlayColors.ACCENT)
            inputType = if (numeric) {
                InputType.TYPE_CLASS_NUMBER
            } else {
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
            }
        }

        /** Tam sayı alanı. Dönen fonksiyon, geçerli değeri sınırlar içinde verir. */
        fun number(label: String, value: Long, min: Long, max: Long, hint: String? = null): () -> Long {
            body.addView(label(label))
            val edit = editText(value.toString(), numeric = true)
            hint?.let { edit.hint = it }
            body.addView(edit)
            return { edit.text.toString().toLongOrNull()?.coerceIn(min, max) ?: value.coerceIn(min, max) }
        }

        /** Boş bırakılabilen tam sayı alanı (boşsa null). */
        fun optionalNumber(label: String, min: Long, max: Long, hint: String): () -> Long? {
            body.addView(label(label))
            val edit = editText("", numeric = true).apply { this.hint = hint }
            edit.setHintTextColor(0x66FFFFFF)
            body.addView(edit)
            return { edit.text.toString().toLongOrNull()?.coerceIn(min, max) }
        }

        fun text(label: String, value: String): () -> String {
            body.addView(label(label))
            val edit = editText(value, numeric = false)
            body.addView(edit)
            edit.post { edit.requestFocus() }
            return { edit.text.toString().trim() }
        }

        @SuppressLint("UseSwitchCompatOrMaterialCode")
        fun switch(label: String, checked: Boolean): () -> Boolean {
            val sw = Switch(context).apply {
                text = label
                isChecked = checked
                textSize = 14.5f
                setTextColor(OverlayColors.ON_SURFACE)
                setPadding(0, context.dpi(10f), 0, context.dpi(4f))
            }
            body.addView(sw)
            return { sw.isChecked }
        }

        /** Yan yana seçenek düğmeleri (tek seçim). */
        fun choice(label: String, options: List<String>, selected: Int, onChange: (Int) -> Unit = {}): () -> Int {
            body.addView(label(label))
            var current = selected
            val row = LinearLayout(context).apply {
                orientation = LinearLayout.HORIZONTAL
                setPadding(0, context.dpi(6f), 0, context.dpi(2f))
            }
            val chips = options.mapIndexed { index, option ->
                TextView(context).apply {
                    text = option
                    textSize = 13.5f
                    gravity = Gravity.CENTER
                    typeface = Typeface.DEFAULT_BOLD
                    val ph = context.dpi(10f)
                    setPadding(ph, context.dpi(9f), ph, context.dpi(9f))
                    setOnClickListener {
                        current = index
                        refreshChips(this@apply.parent as LinearLayout, current)
                        onChange(index)
                    }
                }
            }
            chips.forEach {
                row.addView(it, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                    marginEnd = context.dpi(6f)
                })
            }
            refreshChips(row, current)
            body.addView(row)
            return { current }
        }

        private fun refreshChips(row: LinearLayout, selected: Int) {
            for (i in 0 until row.childCount) {
                val chip = row.getChildAt(i) as TextView
                val on = i == selected
                chip.setTextColor(if (on) 0xFFFFFFFF.toInt() else OverlayColors.ON_SURFACE_DIM)
                chip.background = roundedBackground(
                    if (on) OverlayColors.ACCENT else OverlayColors.SURFACE_VARIANT,
                    context.dp(12f),
                )
            }
        }

        /** [action] true dönerse kutu kapanır. */
        fun button(text: String, style: Style = Style.NORMAL, action: () -> Boolean = { true }) {
            val color = when (style) {
                Style.PRIMARY -> OverlayColors.ACCENT
                Style.DANGER -> OverlayColors.STOP
                Style.NORMAL -> OverlayColors.ON_SURFACE
            }
            val view = TextView(context).apply {
                this.text = text
                textSize = 14.5f
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(if (style == Style.PRIMARY) 0xFFFFFFFF.toInt() else color)
                val ph = context.dpi(14f)
                setPadding(ph, context.dpi(10f), ph, context.dpi(10f))
                background = if (style == Style.PRIMARY) roundedBackground(color, context.dp(20f)) else null
                setOnClickListener { if (action()) onDismissRequest() }
            }
            buttonRow.addView(view, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { marginStart = context.dpi(4f) })
        }

        /** Düğme satırının soluna yaslanan esnek boşluk. */
        fun spacer() {
            buttonRow.addView(View(context), LinearLayout.LayoutParams(0, 1, 1f))
        }
    }
}
