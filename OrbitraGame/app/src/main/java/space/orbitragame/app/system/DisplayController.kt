package space.orbitragame.app.system

import android.app.Activity
import android.content.pm.ActivityInfo
import android.view.Display
import android.view.WindowManager
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import space.orbitragame.app.settings.AppSettings
import kotlin.math.abs

/** Tam ekran, ekran yonu, ekranin acik kalmasi ve kararli yenileme hizi. */
class DisplayController(private val activity: Activity) {

    private val window get() = activity.window
    private val controller get() = WindowCompat.getInsetsController(window, window.decorView)

    init {
        // Kenardan kenara cizim; bosluklari (inset) kendimiz yonetiriz.
        WindowCompat.setDecorFitsSystemWindows(window, false)
        controller.isAppearanceLightStatusBars = false
        controller.isAppearanceLightNavigationBars = false
    }

    /** Oyun her zaman gercek tam ekran calisir (durum/gezinme cubugu gizli). */
    fun applyFullscreen() {
        controller.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
    }

    fun applyOrientation(o: AppSettings.Orientation) {
        activity.requestedOrientation = when (o) {
            AppSettings.Orientation.AUTO -> ActivityInfo.SCREEN_ORIENTATION_FULL_USER
            AppSettings.Orientation.PORTRAIT -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_PORTRAIT
            AppSettings.Orientation.LANDSCAPE -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        }
    }

    fun keepScreenOn(on: Boolean) {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    private fun currentDisplay(): Display? = window.decorView.display ?: run {
        @Suppress("DEPRECATION") activity.windowManager.defaultDisplay
    }

    /**
     * Kararli 60 Hz: tarayici oyunlari 90/120 Hz'e cogu zaman yetisemez; o zaman
     * kareler duzensiz gelir (takilma hissi) ve telefon isinir. 60 Hz'de kare
     * temposu duzenli, pil ve isi daha dusuk olur.
     */
    fun preferStable60Hz() {
        val disp = currentDisplay() ?: return
        val current = disp.mode
        val target = disp.supportedModes
            .filter { it.physicalWidth == current.physicalWidth && it.physicalHeight == current.physicalHeight }
            .minByOrNull { abs(it.refreshRate - 60f) } ?: return
        val lp = window.attributes
        if (lp.preferredDisplayModeId == target.modeId) return
        lp.preferredDisplayModeId = target.modeId
        lp.preferredRefreshRate = target.refreshRate
        window.attributes = lp
    }
}
