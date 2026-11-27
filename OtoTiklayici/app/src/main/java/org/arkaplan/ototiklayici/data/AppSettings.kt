package org.arkaplan.ototiklayici.data

enum class ThemeMode { SYSTEM, LIGHT, DARK }

enum class PanelOrientation { VERTICAL, HORIZONTAL }

/** Uygulama genelindeki ayarlar. Yeni makrolar varsayılanlarını buradan alır. */
data class AppSettings(
    // Varsayılanlar
    val defaultIntervalMs: Long = 100,
    val defaultTapDurationMs: Long = 40,
    val defaultSwipeDurationMs: Long = 300,
    val defaultRandomDelayMs: Int = 0,
    val defaultRandomOffsetPx: Int = 0,
    // Yüzen panel ve hedefler
    val panelScale: Float = 1f,
    val panelOpacity: Float = 0.95f,
    val panelOrientation: PanelOrientation = PanelOrientation.VERTICAL,
    val collapsePanelWhileRunning: Boolean = false,
    val targetSizeDp: Int = 52,
    val targetOpacity: Float = 0.85f,
    val dimTargetsWhileRunning: Boolean = true,
    // Davranış
    val showTouchFeedback: Boolean = true,
    val vibrate: Boolean = true,
    val keepScreenOn: Boolean = true,
    val volumeKeyStop: Boolean = true,
    val stopOnScreenOff: Boolean = true,
    val stopOnAppChange: Boolean = false,
    // Kayıt
    val recordPassThrough: Boolean = true,
    val preciseReplay: Boolean = true,
    // Görünüm
    val themeMode: ThemeMode = ThemeMode.SYSTEM,
    val dynamicColor: Boolean = true,
    // Panel konumu ve istatistik
    val panelX: Int = -1,
    val panelY: Int = -1,
    val totalTaps: Long = 0,
    val totalRuns: Long = 0,
)
