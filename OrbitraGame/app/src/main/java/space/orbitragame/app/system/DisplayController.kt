package space.orbitragame.app.system

import android.app.Activity
import android.content.pm.ActivityInfo
import android.view.WindowManager
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

    fun keepScreenOn(on: Boolean) {
        if (on) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
}
