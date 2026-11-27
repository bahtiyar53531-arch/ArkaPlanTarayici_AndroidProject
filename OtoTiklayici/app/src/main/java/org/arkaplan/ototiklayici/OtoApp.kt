package org.arkaplan.ototiklayici

import android.app.Application
import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import org.arkaplan.ototiklayici.data.MacroRepository
import org.arkaplan.ototiklayici.data.SettingsRepository

class OtoApp : Application() {
    val appScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    lateinit var macros: MacroRepository
        private set
    lateinit var settings: SettingsRepository
        private set

    override fun onCreate() {
        super.onCreate()
        macros = MacroRepository(this, appScope)
        settings = SettingsRepository(this, appScope)
    }
}

val Context.otoApp: OtoApp get() = applicationContext as OtoApp
