package org.arkaplan.ototiklayici.data

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.MutablePreferences
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.floatPreferencesKey
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "ayarlar")

class SettingsRepository(context: Context, scope: CoroutineScope) {
    private val store = context.applicationContext.dataStore

    private object K {
        val interval = longPreferencesKey("default_interval_ms")
        val tapDuration = longPreferencesKey("default_tap_duration_ms")
        val swipeDuration = longPreferencesKey("default_swipe_duration_ms")
        val randomDelay = intPreferencesKey("default_random_delay_ms")
        val randomOffset = intPreferencesKey("default_random_offset_px")
        val panelScale = floatPreferencesKey("panel_scale")
        val panelOpacity = floatPreferencesKey("panel_opacity")
        val panelOrientation = stringPreferencesKey("panel_orientation")
        val collapsePanel = booleanPreferencesKey("collapse_panel_running")
        val targetSize = intPreferencesKey("target_size_dp")
        val targetOpacity = floatPreferencesKey("target_opacity")
        val dimTargets = booleanPreferencesKey("dim_targets_running")
        val touchFeedback = booleanPreferencesKey("touch_feedback")
        val vibrate = booleanPreferencesKey("vibrate")
        val keepScreenOn = booleanPreferencesKey("keep_screen_on")
        val volumeStop = booleanPreferencesKey("volume_key_stop")
        val screenOffStop = booleanPreferencesKey("stop_on_screen_off")
        val appChangeStop = booleanPreferencesKey("stop_on_app_change")
        val passThrough = booleanPreferencesKey("record_pass_through")
        val precise = booleanPreferencesKey("precise_replay")
        val theme = stringPreferencesKey("theme_mode")
        val dynamicColor = booleanPreferencesKey("dynamic_color")
        val panelX = intPreferencesKey("panel_x")
        val panelY = intPreferencesKey("panel_y")
        val totalTaps = longPreferencesKey("total_taps")
        val totalRuns = longPreferencesKey("total_runs")
    }

    val settings: StateFlow<AppSettings> = store.data
        .map { it.toSettings() }
        .stateIn(scope, SharingStarted.Eagerly, AppSettings())

    suspend fun update(transform: (AppSettings) -> AppSettings) {
        store.edit { prefs ->
            val updated = transform(prefs.toSettings())
            prefs.write(updated)
        }
    }

    suspend fun addStats(taps: Long, runs: Long = 1) {
        store.edit { prefs ->
            prefs[K.totalTaps] = (prefs[K.totalTaps] ?: 0L) + taps
            prefs[K.totalRuns] = (prefs[K.totalRuns] ?: 0L) + runs
        }
    }

    suspend fun savePanelPosition(x: Int, y: Int) {
        store.edit { prefs ->
            prefs[K.panelX] = x
            prefs[K.panelY] = y
        }
    }

    private fun Preferences.toSettings(): AppSettings {
        val d = AppSettings()
        return AppSettings(
            defaultIntervalMs = this[K.interval] ?: d.defaultIntervalMs,
            defaultTapDurationMs = this[K.tapDuration] ?: d.defaultTapDurationMs,
            defaultSwipeDurationMs = this[K.swipeDuration] ?: d.defaultSwipeDurationMs,
            defaultRandomDelayMs = this[K.randomDelay] ?: d.defaultRandomDelayMs,
            defaultRandomOffsetPx = this[K.randomOffset] ?: d.defaultRandomOffsetPx,
            panelScale = this[K.panelScale] ?: d.panelScale,
            panelOpacity = this[K.panelOpacity] ?: d.panelOpacity,
            panelOrientation = enumOr(this[K.panelOrientation], d.panelOrientation),
            collapsePanelWhileRunning = this[K.collapsePanel] ?: d.collapsePanelWhileRunning,
            targetSizeDp = this[K.targetSize] ?: d.targetSizeDp,
            targetOpacity = this[K.targetOpacity] ?: d.targetOpacity,
            dimTargetsWhileRunning = this[K.dimTargets] ?: d.dimTargetsWhileRunning,
            showTouchFeedback = this[K.touchFeedback] ?: d.showTouchFeedback,
            vibrate = this[K.vibrate] ?: d.vibrate,
            keepScreenOn = this[K.keepScreenOn] ?: d.keepScreenOn,
            volumeKeyStop = this[K.volumeStop] ?: d.volumeKeyStop,
            stopOnScreenOff = this[K.screenOffStop] ?: d.stopOnScreenOff,
            stopOnAppChange = this[K.appChangeStop] ?: d.stopOnAppChange,
            recordPassThrough = this[K.passThrough] ?: d.recordPassThrough,
            preciseReplay = this[K.precise] ?: d.preciseReplay,
            themeMode = enumOr(this[K.theme], d.themeMode),
            dynamicColor = this[K.dynamicColor] ?: d.dynamicColor,
            panelX = this[K.panelX] ?: d.panelX,
            panelY = this[K.panelY] ?: d.panelY,
            totalTaps = this[K.totalTaps] ?: d.totalTaps,
            totalRuns = this[K.totalRuns] ?: d.totalRuns,
        )
    }

    private fun MutablePreferences.write(s: AppSettings) {
        this[K.interval] = s.defaultIntervalMs
        this[K.tapDuration] = s.defaultTapDurationMs
        this[K.swipeDuration] = s.defaultSwipeDurationMs
        this[K.randomDelay] = s.defaultRandomDelayMs
        this[K.randomOffset] = s.defaultRandomOffsetPx
        this[K.panelScale] = s.panelScale
        this[K.panelOpacity] = s.panelOpacity
        this[K.panelOrientation] = s.panelOrientation.name
        this[K.collapsePanel] = s.collapsePanelWhileRunning
        this[K.targetSize] = s.targetSizeDp
        this[K.targetOpacity] = s.targetOpacity
        this[K.dimTargets] = s.dimTargetsWhileRunning
        this[K.touchFeedback] = s.showTouchFeedback
        this[K.vibrate] = s.vibrate
        this[K.keepScreenOn] = s.keepScreenOn
        this[K.volumeStop] = s.volumeKeyStop
        this[K.screenOffStop] = s.stopOnScreenOff
        this[K.appChangeStop] = s.stopOnAppChange
        this[K.passThrough] = s.recordPassThrough
        this[K.precise] = s.preciseReplay
        this[K.theme] = s.themeMode.name
        this[K.dynamicColor] = s.dynamicColor
        // panelX/panelY ve istatistikler kendi metotlarıyla yazılır.
    }

    private inline fun <reified E : Enum<E>> enumOr(value: String?, default: E): E =
        value?.let { v -> enumValues<E>().firstOrNull { it.name == v } } ?: default
}
