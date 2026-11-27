package space.orbitragame.app.ui

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.util.TypedValue
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.widget.SwitchCompat
import androidx.core.content.getSystemService
import androidx.webkit.WebViewCompat
import space.orbitragame.app.BuildConfig
import space.orbitragame.app.R
import space.orbitragame.app.settings.AppSettings

/**
 * Sade ayarlar: yalnizca 3 secenek. Geri kalan her sey (render kalitesi,
 * ekran hizi, yeniden baglanma, ekranin acik kalmasi, dusuk gecikmeli Wi-Fi)
 * otomatik yonetilir.
 */
object SettingsDialog {

    fun show(context: Context, settings: AppSettings, onChanged: () -> Unit, onRestart: () -> Unit) {
        val dp = context.resources.displayMetrics.density
        val list = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            val p = (20 * dp).toInt()
            setPadding(p, (6 * dp).toInt(), p, (4 * dp).toInt())
        }

        fun switch(title: String, desc: String, value: Boolean, set: (Boolean) -> Unit) {
            list.addView(SwitchCompat(context).apply {
                text = title
                isChecked = value
                setTextColor(0xFFEAF6FF.toInt())
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                setPadding(0, (10 * dp).toInt(), 0, 0)
                setOnCheckedChangeListener { _, checked -> set(checked); onChanged() }
            }, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            list.addView(TextView(context).apply {
                text = desc
                setTextColor(0xFF9FB8D9.toInt())
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                setPadding(0, 0, (48 * dp).toInt(), (4 * dp).toInt())
            })
        }

        switch("Arka planda bağlı kal", "Uygulamadan çıkınca oyun bağlantısı korunur.", settings.keepAliveInBackground) { settings.keepAliveInBackground = it }
        switch("Küçük pencere", "Ana ekrana dönünce oyun köşede devam eder.", settings.autoPip) { settings.autoPip = it }
        switch("Kamera alanını kullan", "Kenardaki siyah şerit kalkar, oyun tüm ekranı kullanır.", settings.useCutoutArea) { settings.useCutoutArea = it }

        var dialog: AlertDialog? = null
        fun button(text: String, onClick: () -> Unit) = Button(context).apply {
            this.text = text
            isAllCaps = false
            setTextColor(0xFFFFFFFF.toInt())
            setBackgroundResource(R.drawable.bg_menu_item)
            setOnClickListener { onClick() }
        }
        val pm = context.getSystemService<PowerManager>()
        if (pm?.isIgnoringBatteryOptimizations(context.packageName) != true) {
            list.addView(button("Pil kısıtlamasını kaldır (önerilir)") { requestIgnoreBatteryOptimizations(context) },
                LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (44 * dp).toInt()).apply { topMargin = (12 * dp).toInt() })
        }
        list.addView(button(context.getString(R.string.restart)) { dialog?.dismiss(); onRestart() },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (44 * dp).toInt()).apply { topMargin = (8 * dp).toInt() })

        val webViewPkg = runCatching { WebViewCompat.getCurrentWebViewPackage(context) }.getOrNull()
        list.addView(TextView(context).apply {
            text = "Sürüm ${BuildConfig.VERSION_NAME}" + (webViewPkg?.let { " · Chromium ${it.versionName?.substringBefore('.')}" } ?: "") +
                " · Android ${Build.VERSION.RELEASE}"
            setTextColor(0xFF7F98BD.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            setPadding(0, (12 * dp).toInt(), 0, 0)
        })

        dialog = AlertDialog.Builder(context)
            .setTitle(R.string.settings_title)
            .setView(list)
            .setPositiveButton(R.string.ok, null)
            .show()
    }

    @SuppressLint("BatteryLife")
    fun requestIgnoreBatteryOptimizations(context: Context) {
        val direct = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))
        val fallback = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
        runCatching { context.startActivity(direct) }.onFailure { runCatching { context.startActivity(fallback) } }
    }
}
