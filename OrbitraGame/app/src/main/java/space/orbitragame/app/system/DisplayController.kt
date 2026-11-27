package space.orbitragame.app.system

import android.app.Activity
import android.content.pm.ActivityInfo
import android.os.PowerManager
import android.view.Display
import android.view.WindowManager
import androidx.core.content.getSystemService
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import space.orbitragame.app.settings.AppSettings

/** Tam ekran, ekran yonu ve ekranin acik kalmasi. */
class DisplayController(private val activity: Activity) {

    private val window get() = activity.window
    private val controller get() = WindowCompat.getInsetsController(window, window.decorView)

    init {
        // Kenardan kenara cizim; bosluklari (inset) kendimiz yonetiriz.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        controller.isAppearanceLightStatusBars = false
        controller.isAppearanceLightNavigationBars = false
    }

    var isFullscreen: Boolean = false
        private set

    fun applyFullscreen(on: Boolean) {
        isFullscreen = on
        if (on) {
            controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            controller.hide(WindowInsetsCompat.Type.systemBars())
        } else {
            controller.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    /** Pencere odagi geri geldiginde (bildirim paneli vb.) tam ekrani yeniden uygula. */
    fun reapply() {
        if (isFullscreen) applyFullscreen(true)
    }

    fun applyOrientation(o: AppSettings.Orientation) {
        activity.requestedOrientation = when (o) {
            AppSettings.Orientation.AUTO -> ActivityInfo.SCREEN_ORIENTATION_FULL_USER
            AppSettings.Orientation.PORTRAIT -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
            AppSettings.Orientation.LANDSCAPE -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        }
    }

    private fun currentDisplay(): Display? = window.decorView.display ?: run {
        @Suppress("DEPRECATION") activity.windowManager.defaultDisplay
    }

    /**
     * Ekran yenileme hizi. "60 Hz kararli" oyunun 90/120 Hz'de gucunun yetmeyip
     * dalgalanmasini (takilma) onler; "En yuksek" guclu cihazlar icin.
     * @return uygulanan hiz (Hz) veya sistem varsayilaninda null
     */
    fun applyRefreshMode(mode: AppSettings.RefreshMode): Float? {
        val disp = currentDisplay() ?: return null
        val current = disp.mode
        val sameRes = disp.supportedModes.filter { it.physicalWidth == current.physicalWidth && it.physicalHeight == current.physicalHeight }
        val target = when (mode) {
            AppSettings.RefreshMode.SYSTEM -> null
            AppSettings.RefreshMode.STABLE_60 -> sameRes.minByOrNull { kotlin.math.abs(it.refreshRate - 60f) }
            AppSettings.RefreshMode.MAX -> sameRes.maxByOrNull { it.refreshRate }
        }
        val lp = window.attributes
        lp.preferredDisplayModeId = target?.modeId ?: 0
        lp.preferredRefreshRate = target?.refreshRate ?: 0f
        window.attributes = lp
        return target?.refreshRate
    }

    /** Cihazin destekledigi en yuksek yenileme hizi (bilgi icin). */
    fun maxRefreshRate(): Float? = currentDisplay()?.supportedModes?.maxOfOrNull { it.refreshRate }

    val sustainedSupported: Boolean
        get() = activity.getSystemService<PowerManager>()?.isSustainedPerformanceModeSupported == true

    /**
     * Kararli performans modu: islemci/GPU isinca ani dususler yerine
     * surdurulebilir sabit bir hizda calisir (uzun oyunlarda daha az takilma).
     */
    fun applySustained(on: Boolean) {
        if (sustainedSupported) runCatching { window.setSustainedPerformanceMode(on) }
    }

    fun keepScreenOn(on: Boolean) {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
}
