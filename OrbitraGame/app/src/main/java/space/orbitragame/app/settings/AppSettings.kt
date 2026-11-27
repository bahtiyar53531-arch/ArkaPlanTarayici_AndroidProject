package space.orbitragame.app.settings

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import space.orbitragame.core.ZoomModel

/**
 * Kullanici tercihleri (sifre/oturum bilgisi BURADA TUTULMAZ).
 * Bilerek az secenek: geri kalan her sey otomatik.
 */
class AppSettings(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences("orbitra_settings", Context.MODE_PRIVATE)

    enum class Orientation(val label: String) {
        AUTO("Otomatik"), LANDSCAPE("Yatay"), PORTRAIT("Dikey");

        fun next(): Orientation = entries[(ordinal + 1) % entries.size]
    }

    /** PC gorunumu seviyeleri: ust pencerelerin olcegi. */
    enum class PcView(val label: String, val scale: Float) {
        OFF("Kapalı", 1f), MEDIUM("Orta", 0.75f), STRONG("Güçlü", 0.6f);

        fun next(): PcView = entries[(ordinal + 1) % entries.size]

        companion object {
            fun fromScale(s: Float): PcView = entries.minByOrNull { kotlin.math.abs(it.scale - s) } ?: OFF
        }
    }

    var orientation: Orientation
        get() = runCatching { Orientation.valueOf(prefs.getString(K_ORIENTATION, null) ?: "AUTO") }.getOrDefault(Orientation.AUTO)
        set(v) = prefs.edit { putString(K_ORIENTATION, v.name) }

    var showFps: Boolean
        get() = prefs.getBoolean(K_SHOW_FPS, false)
        set(v) = prefs.edit { putBoolean(K_SHOW_FPS, v) }

    var zoomScale: Float
        get() = prefs.getFloat(K_ZOOM, ZoomModel.DEFAULT)
        set(v) = prefs.edit { putFloat(K_ZOOM, v) }

    var pcView: PcView
        get() = PcView.fromScale(prefs.getFloat(K_HUD_TOP, 1f))
        set(v) = prefs.edit { putFloat(K_HUD_TOP, v.scale) }

    /** Ana ekrana donuldugunde otomatik kucuk pencere (PiP). */
    var autoPip: Boolean
        get() = prefs.getBoolean(K_AUTO_PIP, true)
        set(v) = prefs.edit { putBoolean(K_AUTO_PIP, v) }

    /** Arka planda baglantiyi koru (on plan servisi, ekran kapaliyken de). */
    var keepAliveInBackground: Boolean
        get() = prefs.getBoolean(K_KEEP_ALIVE, true)
        set(v) = prefs.edit { putBoolean(K_KEEP_ALIVE, v) }

    /** Tam ekranda kamera/centik alanini da kullan. */
    var useCutoutArea: Boolean
        get() = prefs.getBoolean(K_CUTOUT, false)
        set(v) = prefs.edit { putBoolean(K_CUTOUT, v) }

    /** Kontrol dugmesinin konumu (ekran oranlari, 0..1). */
    var controlButtonX: Float
        get() = prefs.getFloat(K_BTN_X, 1f)
        set(v) = prefs.edit { putFloat(K_BTN_X, v) }
    var controlButtonY: Float
        get() = prefs.getFloat(K_BTN_Y, 0.42f)
        set(v) = prefs.edit { putFloat(K_BTN_Y, v) }

    /** FPS rozetinin konumu. */
    var fpsX: Float
        get() = prefs.getFloat(K_PANEL_X, 0f)
        set(v) = prefs.edit { putFloat(K_PANEL_X, v) }
    var fpsY: Float
        get() = prefs.getFloat(K_PANEL_Y, 0f)
        set(v) = prefs.edit { putFloat(K_PANEL_Y, v) }

    var notificationPermissionAsked: Boolean
        get() = prefs.getBoolean(K_NOTIF_ASKED, false)
        set(v) = prefs.edit { putBoolean(K_NOTIF_ASKED, v) }

    var batteryPromptShown: Boolean
        get() = prefs.getBoolean(K_BATTERY_ASKED, false)
        set(v) = prefs.edit { putBoolean(K_BATTERY_ASKED, v) }

    private companion object {
        const val K_ORIENTATION = "orientation"
        const val K_SHOW_FPS = "show_fps"
        const val K_ZOOM = "zoom_scale"
        const val K_HUD_TOP = "hud_top"
        const val K_AUTO_PIP = "auto_pip"
        const val K_KEEP_ALIVE = "keep_alive"
        const val K_CUTOUT = "use_cutout"
        const val K_BTN_X = "btn_x"
        const val K_BTN_Y = "btn_y"
        const val K_PANEL_X = "panel_x"
        const val K_PANEL_Y = "panel_y"
        const val K_NOTIF_ASKED = "notif_asked"
        const val K_BATTERY_ASKED = "battery_asked"
    }
}
