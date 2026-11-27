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
import android.widget.ScrollView
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.widget.SwitchCompat
import androidx.core.content.getSystemService
import androidx.webkit.WebViewCompat
import space.orbitragame.app.BuildConfig
import space.orbitragame.app.R
import space.orbitragame.app.settings.AppSettings

/** Arka plan, baglanti ve performans ayarlari. */
object SettingsDialog {

    fun show(context: Context, settings: AppSettings, onChanged: () -> Unit) {
        val dp = context.resources.displayMetrics.density
        val list = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            val p = (20 * dp).toInt()
            setPadding(p, (8 * dp).toInt(), p, (8 * dp).toInt())
        }

        fun switch(title: String, desc: String, value: Boolean, set: (Boolean) -> Unit) {
            val sw = SwitchCompat(context).apply {
                text = title
                isChecked = value
                setTextColor(0xFFEAF6FF.toInt())
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
                setPadding(0, (10 * dp).toInt(), 0, 0)
                setOnCheckedChangeListener { _, checked -> set(checked); onChanged() }
            }
            val d = TextView(context).apply {
                text = desc
                setTextColor(0xFF9FB8D9.toInt())
                setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
                setPadding(0, 0, (48 * dp).toInt(), (6 * dp).toInt())
            }
            list.addView(sw, ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            list.addView(d)
        }

        switch("Otomatik küçük pencere", "Ana ekrana dönünce oyun köşede küçük pencerede canlı devam eder. En güçlü bağlantı koruma yöntemidir.", settings.autoPip) { settings.autoPip = it }
        switch("Arka planda bağlantıyı koru", "Uygulama arka plandayken oyun motoru çalışmaya devam eder ve bildirim gösterilir.", settings.keepAliveInBackground) { settings.keepAliveInBackground = it }
        switch("Ekran kapalıyken de koru", "İşlemci ve Wi-Fi uyanık tutulur (en fazla 3 saat). Daha fazla pil kullanır.", settings.keepAwakeScreenOff) { settings.keepAwakeScreenOff = it }
        switch("Otomatik yeniden bağlan", "Sunucu bağlantısı koparsa ve oyun kendi kendine toparlanmazsa artan aralıklarla yeniden bağlanır.", settings.autoReconnect) { settings.autoReconnect = it }
        switch("Ekranı açık tut", "Oyun sırasında ekran kararmaz.", settings.keepScreenOn) { settings.keepScreenOn = it }
        switch("Kamera / çentik alanını kullan", "Tam ekranda ekranın kenarındaki kamera bölgesi de oyuna verilir (siyah şerit kalmaz).", settings.useCutoutArea) { settings.useCutoutArea = it }
        switch("Düşük gecikmeli Wi-Fi", "Android 10+ cihazlarda Wi-Fi gecikme dalgalanmasını azaltır.", settings.lowLatencyWifi) { settings.lowLatencyWifi = it }

        val pm = context.getSystemService<PowerManager>()
        val ignoring = pm?.isIgnoringBatteryOptimizations(context.packageName) == true
        val battery = Button(context).apply {
            isAllCaps = false
            setTextColor(0xFFFFFFFF.toInt())
            setBackgroundResource(R.drawable.bg_button_primary)
            text = if (ignoring) "Pil optimizasyonu kapalı ✓" else "Pil optimizasyonunu kapat (önerilir)"
            isEnabled = !ignoring
            alpha = if (ignoring) 0.6f else 1f
            setOnClickListener { requestIgnoreBatteryOptimizations(context) }
        }
        list.addView(battery, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, (44 * dp).toInt()).apply { topMargin = (14 * dp).toInt() })

        val webViewPkg = runCatching { WebViewCompat.getCurrentWebViewPackage(context) }.getOrNull()
        val info = TextView(context).apply {
            text = buildString {
                append("Sürüm ${BuildConfig.VERSION_NAME}")
                webViewPkg?.let { append("\nTarayıcı motoru: Chromium WebView ${it.versionName}") }
                append("\nAndroid ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
            }
            setTextColor(0xFF7F98BD.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 11f)
            setPadding(0, (14 * dp).toInt(), 0, 0)
        }
        list.addView(info)

        AlertDialog.Builder(context)
            .setTitle(R.string.settings_title)
            .setView(ScrollView(context).apply { addView(list) })
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
