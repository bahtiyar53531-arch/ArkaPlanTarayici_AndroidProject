package space.orbitragame.app.settings

import android.content.Context
import android.content.SharedPreferences
import androidx.core.content.edit
import space.orbitragame.core.ZoomModel

/** Kullanici tercihleri (sifre/oturum bilgisi BURADA TUTULMAZ). */
class AppSettings(context: Context) {

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences("orbitra_settings", Context.MODE_PRIVATE)

    enum class Orientation { AUTO, PORTRAIT, LANDSCAPE }

    var fullscreen: Boolean
        get() = prefs.getBoolean(K_FULLSCREEN, true)
        set(v) = prefs.edit { putBoolean(K_FULLSCREEN, v) }

    var orientation: Orientation
        get() = runCatching { Orientation.valueOf(prefs.getString(K_ORIENTATION, null) ?: "AUTO") }.getOrDefault(Orientation.AUTO)
        set(v) = prefs.edit { putString(K_ORIENTATION, v.name) }

    var showFps: Boolean
        get() = prefs.getBoolean(K_SHOW_FPS, false)
        set(v) = prefs.edit { putBoolean(K_SHOW_FPS, v) }

    var showPing: Boolean
        get() = prefs.getBoolean(K_SHOW_PING, false)
        set(v) = prefs.edit { putBoolean(K_SHOW_PING, v) }

    var zoomScale: Float
        get() = prefs.getFloat(K_ZOOM, ZoomModel.DEFAULT)
        set(v) = prefs.edit { putFloat(K_ZOOM, v) }

    /** Ana ekrana donuldugunde otomatik kucuk pencere (PiP). */
    var autoPip: Boolean
        get() = prefs.getBoolean(K_AUTO_PIP, true)
        set(v) = prefs.edit { putBoolean(K_AUTO_PIP, v) }

    /** Arka planda baglantiyi koru (on plan servisi + WebView canli tutma). */
    var keepAliveInBackground: Boolean
        get() = prefs.getBoolean(K_KEEP_ALIVE, true)
        set(v) = prefs.edit { putBoolean(K_KEEP_ALIVE, v) }

    /** Ekran kapaliyken de CPU/Wi-Fi'yi uyanik tut (pil tuketir). */
    var keepAwakeScreenOff: Boolean
        get() = prefs.getBoolean(K_WAKE, true)
        set(v) = prefs.edit { putBoolean(K_WAKE, v) }

    var autoReconnect: Boolean
        get() = prefs.getBoolean(K_AUTO_RECONNECT, true)
        set(v) = prefs.edit { putBoolean(K_AUTO_RECONNECT, v) }

    var keepScreenOn: Boolean
        get() = prefs.getBoolean(K_SCREEN_ON, true)
        set(v) = prefs.edit { putBoolean(K_SCREEN_ON, v) }

    /** Wi-Fi dusuk gecikme modu (Android 10+). */
    var lowLatencyWifi: Boolean
        get() = prefs.getBoolean(K_LOW_LATENCY, true)
        set(v) = prefs.edit { putBoolean(K_LOW_LATENCY, v) }

    /** Kontrol dugmesinin konumu (ekran oranlari, 0..1). */
    var controlButtonX: Float
        get() = prefs.getFloat(K_BTN_X, 1f)
        set(v) = prefs.edit { putFloat(K_BTN_X, v) }
    var controlButtonY: Float
        get() = prefs.getFloat(K_BTN_Y, 0.42f)
        set(v) = prefs.edit { putFloat(K_BTN_Y, v) }

    var panelX: Float
        get() = prefs.getFloat(K_PANEL_X, 0f)
        set(v) = prefs.edit { putFloat(K_PANEL_X, v) }
    var panelY: Float
        get() = prefs.getFloat(K_PANEL_Y, 0f)
        set(v) = prefs.edit { putFloat(K_PANEL_Y, v) }

    var notificationPermissionAsked: Boolean
        get() = prefs.getBoolean(K_NOTIF_ASKED, false)
        set(v) = prefs.edit { putBoolean(K_NOTIF_ASKED, v) }

    var batteryPromptShown: Boolean
        get() = prefs.getBoolean(K_BATTERY_ASKED, false)
        set(v) = prefs.edit { putBoolean(K_BATTERY_ASKED, v) }

    private companion object {
        const val K_FULLSCREEN = "fullscreen"
        const val K_ORIENTATION = "orientation"
        const val K_SHOW_FPS = "show_fps"
        const val K_SHOW_PING = "show_ping"
        const val K_ZOOM = "zoom_scale"
        const val K_AUTO_PIP = "auto_pip"
        const val K_KEEP_ALIVE = "keep_alive"
        const val K_WAKE = "keep_awake_screen_off"
        const val K_AUTO_RECONNECT = "auto_reconnect"
        const val K_SCREEN_ON = "keep_screen_on"
        const val K_LOW_LATENCY = "low_latency_wifi"
        const val K_BTN_X = "btn_x"
        const val K_BTN_Y = "btn_y"
        const val K_PANEL_X = "panel_x"
        const val K_PANEL_Y = "panel_y"
        const val K_NOTIF_ASKED = "notif_asked"
        const val K_BATTERY_ASKED = "battery_asked"
    }
}
