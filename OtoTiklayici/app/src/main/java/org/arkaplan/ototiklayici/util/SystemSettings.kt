package org.arkaplan.ototiklayici.util

import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.core.net.toUri
import android.os.PowerManager
import android.provider.Settings
import android.widget.Toast
import org.arkaplan.ototiklayici.service.AutoClickService

/** Sistem ayarlarına giden kısayollar ve izin durumları. */
object SystemSettings {

    fun serviceComponent(context: Context) = ComponentName(context, AutoClickService::class.java)

    /** Kullanıcı servisi ayarlardan açmış mı (bağlanmış olmasa bile). */
    fun isServiceEnabled(context: Context): Boolean {
        val enabled = Settings.Secure.getString(
            context.contentResolver,
            Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
        ) ?: return false
        val mine = serviceComponent(context)
        return enabled.split(':').any { ComponentName.unflattenFromString(it) == mine }
    }

    fun openAccessibilitySettings(context: Context) {
        // Önce doğrudan servisin sayfasını dene, olmazsa genel erişilebilirlik listesi.
        val details = Intent("android.settings.ACCESSIBILITY_DETAILS_SETTINGS")
            .putExtra(Intent.EXTRA_COMPONENT_NAME, serviceComponent(context).flattenToString())
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (tryStart(context, details)) return
        if (tryStart(context, Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))) return
        Toast.makeText(context, "Ayarlar açılamadı", Toast.LENGTH_SHORT).show()
    }

    fun openAppInfo(context: Context) {
        val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, "package:${context.packageName}".toUri())
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        tryStart(context, intent)
    }

    fun isIgnoringBatteryOptimizations(context: Context): Boolean =
        context.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(context.packageName)

    @SuppressLint("BatteryLife")
    fun requestIgnoreBatteryOptimizations(context: Context) {
        val direct = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, "package:${context.packageName}".toUri())
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (tryStart(context, direct)) return
        tryStart(context, Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    private fun tryStart(context: Context, intent: Intent): Boolean = try {
        context.startActivity(intent)
        true
    } catch (_: Exception) {
        false
    }
}
