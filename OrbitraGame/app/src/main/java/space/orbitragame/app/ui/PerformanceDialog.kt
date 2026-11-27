package space.orbitragame.app.ui

import android.content.Context
import android.content.res.ColorStateList
import android.util.TypedValue
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.widget.SwitchCompat
import space.orbitragame.app.settings.AppSettings
import space.orbitragame.core.RenderQuality

/**
 * Performans ayarlari: render kalitesi (otomatik/sabit), ekran yenileme hizi,
 * kararli performans modu. Degisiklikler canli uygulanir.
 */
object PerformanceDialog {

    data class Status(
        val deviceDpr: Float,
        val effectiveDpr: Float,
        val autoLevel: RenderQuality?,
        val autoDisabled: Boolean,
        val appliedHz: Float?,
        val maxHz: Float?,
        val sustainedSupported: Boolean,
    )

    fun show(context: Context, settings: AppSettings, status: Status, onChanged: (reloadRecommended: Boolean) -> Unit) {
        val dp = context.resources.displayMetrics.density
        val root = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            val p = (20 * dp).toInt()
            setPadding(p, (6 * dp).toInt(), p, (6 * dp).toInt())
        }
        fun header(t: String) = TextView(context).apply {
            text = t
            setTextColor(0xFF19E3D6.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            setPadding(0, (12 * dp).toInt(), 0, (2 * dp).toInt())
        }
        fun note(t: String) = TextView(context).apply {
            text = t
            setTextColor(0xFF9FB8D9.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
        }
        fun radio(text: String, checked: Boolean) = RadioButton(context).apply {
            this.text = text
            isChecked = checked
            setTextColor(0xFFEAF6FF.toInt())
            buttonTintList = ColorStateList.valueOf(0xFF19E3D6.toInt())
            id = android.view.View.generateViewId()
        }

        // ---- Render kalitesi ----
        root.addView(header("Render kalitesi (oyun çözünürlüğü)"))
        val autoText = buildString {
            append("Otomatik (önerilen)")
            if (settings.renderQuality == null) {
                status.autoLevel?.let { append(" · şu an: ${it.label}") }
                if (status.autoDisabled) append(" · çözünürlük FPS'i etkilemiyor")
            }
        }
        val qGroup = RadioGroup(context)
        val qOptions = listOf<Pair<RenderQuality?, String>>(null to autoText) +
            RenderQuality.entries.map { it to (if (it.dprCap > 0) "${it.label} (x${it.dprCap})" else it.label) }
        val qIds = HashMap<Int, RenderQuality?>()
        for ((q, label) in qOptions) {
            val rb = radio(label, settings.renderQuality == q)
            qIds[rb.id] = q
            qGroup.addView(rb)
        }
        root.addView(qGroup)
        root.addView(note("Cihaz x%.2f · oyuna şu an verilen x%.2f. Düşük değer = daha az piksel = daha yüksek FPS. Bazı oyunlar değişikliği yeniden yüklemede uygular.".format(status.deviceDpr, status.effectiveDpr)))

        // ---- Yenileme hizi ----
        root.addView(header("Ekran yenileme hızı"))
        val rGroup = RadioGroup(context)
        val rIds = HashMap<Int, AppSettings.RefreshMode>()
        for (m in AppSettings.RefreshMode.entries) {
            val rb = radio(m.label, settings.refreshMode == m)
            rIds[rb.id] = m
            rGroup.addView(rb)
        }
        root.addView(rGroup)
        root.addView(note(buildString {
            append("Ekran en fazla ${status.maxHz?.toInt() ?: "?"} Hz")
            status.appliedHz?.let { append(" · uygulanan ${it.toInt()} Hz") }
            append(". Oyun 90/120 Hz'e yetişemiyorsa 60 Hz daha akıcı ve serin çalışır.")
        }))

        // ---- Kararli performans ----
        if (status.sustainedSupported) {
            root.addView(header("Isınma"))
            root.addView(SwitchCompat(context).apply {
                text = "Kararlı performans modu"
                isChecked = settings.sustainedPerformance
                setTextColor(0xFFEAF6FF.toInt())
                setOnCheckedChangeListener { _, c -> settings.sustainedPerformance = c; onChanged(false) }
            }, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            root.addView(note("Uzun oyunlarda ısınınca ani FPS düşüşleri yerine sabit bir hızda çalışır."))
        }

        qGroup.setOnCheckedChangeListener { _, id ->
            if (id in qIds) { settings.renderQuality = qIds[id]; onChanged(true) }
        }
        rGroup.setOnCheckedChangeListener { _, id ->
            rIds[id]?.let { settings.refreshMode = it; onChanged(false) }
        }

        AlertDialog.Builder(context)
            .setTitle("Performans")
            .setView(ScrollView(context).apply { addView(root) })
            .setPositiveButton("Tamam", null)
            .show()
    }
}
