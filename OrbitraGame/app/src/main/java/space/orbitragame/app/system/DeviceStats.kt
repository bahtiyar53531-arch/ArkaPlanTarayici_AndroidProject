package space.orbitragame.app.system

import android.app.ActivityManager
import android.content.Context
import android.os.BatteryManager
import android.os.Build
import android.os.Debug
import android.os.PowerManager
import androidx.core.content.getSystemService

/** Erisilebilen sistem performans bilgileri. */
class DeviceStats(context: Context) {

    data class Snapshot(
        val appPssMb: Int?,
        val sysAvailMb: Long,
        val sysTotalMb: Long,
        val lowMemory: Boolean,
        val thermal: String?,
        val batteryPct: Int?,
        val charging: Boolean,
        val thermalSevere: Boolean = false,
    )

    private val app = context.applicationContext
    private val am = app.getSystemService<ActivityManager>()
    private val pm = app.getSystemService<PowerManager>()
    private val bm = app.getSystemService<BatteryManager>()

    /** Arka plan is parcaciginda cagrilmalidir (PSS olcumu birkac ms surebilir). */
    fun snapshot(includePss: Boolean): Snapshot {
        val mi = ActivityManager.MemoryInfo()
        am?.getMemoryInfo(mi)
        val pss = if (includePss) runCatching { (Debug.getPss() / 1024).toInt() }.getOrNull()?.takeIf { it > 0 } else null
        val thermal = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            when (pm?.currentThermalStatus) {
                PowerManager.THERMAL_STATUS_NONE -> "Normal"
                PowerManager.THERMAL_STATUS_LIGHT -> "Hafif ısınma"
                PowerManager.THERMAL_STATUS_MODERATE -> "Orta ısınma"
                PowerManager.THERMAL_STATUS_SEVERE -> "Yüksek ısınma"
                PowerManager.THERMAL_STATUS_CRITICAL, PowerManager.THERMAL_STATUS_EMERGENCY, PowerManager.THERMAL_STATUS_SHUTDOWN -> "Kritik ısınma"
                else -> null
            }
        } else null
        val battery = bm?.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY)?.takeIf { it in 0..100 }
        val charging = bm?.isCharging ?: false
        val severe = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && (pm?.currentThermalStatus ?: 0) >= PowerManager.THERMAL_STATUS_SEVERE
        return Snapshot(pss, mi.availMem / 1_048_576, mi.totalMem / 1_048_576, mi.lowMemory, thermal, battery, charging, severe)
    }
}
