package org.arkaplan.ototiklayici

import android.content.Context
import android.os.Build

object BuildConfigInfo {
    fun versionName(context: Context): String = try {
        val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.packageManager.getPackageInfo(context.packageName, android.content.pm.PackageManager.PackageInfoFlags.of(0))
        } else {
            @Suppress("DEPRECATION")
            context.packageManager.getPackageInfo(context.packageName, 0)
        }
        info.versionName ?: ""
    } catch (_: Exception) {
        ""
    }
}
