package org.arkaplan.ototiklayici.ui

import android.app.Application
import android.net.Uri
import androidx.compose.runtime.mutableStateListOf
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.arkaplan.ototiklayici.OtoApp
import org.arkaplan.ototiklayici.data.AppSettings
import org.arkaplan.ototiklayici.model.Macro
import org.arkaplan.ototiklayici.service.ServiceBridge
import org.arkaplan.ototiklayici.util.SystemSettings

sealed interface Screen {
    data object Home : Screen
    data object Settings : Screen
    data object Help : Screen
    data class Editor(val macroId: String) : Screen
}

class MainViewModel(application: Application) : AndroidViewModel(application) {
    private val app = application as OtoApp

    val macros: StateFlow<List<Macro>> = app.macros.macros
    val settings: StateFlow<AppSettings> = app.settings.settings
    val serviceConnected: StateFlow<Boolean> = ServiceBridge.connected
    val panelOpen: StateFlow<Boolean> = ServiceBridge.panelOpen
    val running: StateFlow<Boolean> = ServiceBridge.running

    private val _serviceEnabled = MutableStateFlow(false)
    val serviceEnabled: StateFlow<Boolean> = _serviceEnabled.asStateFlow()

    private val _batteryOk = MutableStateFlow(true)
    val batteryOk: StateFlow<Boolean> = _batteryOk.asStateFlow()

    private val _messages = Channel<String>(Channel.BUFFERED)
    val messages = _messages.receiveAsFlow()

    /** Basit gezinme yığını; yapılandırma değişikliklerinde korunur. */
    val backStack = mutableStateListOf<Screen>(Screen.Home)

    fun navigate(screen: Screen) {
        if (backStack.lastOrNull() != screen) backStack += screen
    }

    fun back(): Boolean {
        if (backStack.size <= 1) return false
        backStack.removeAt(backStack.lastIndex)
        return true
    }

    fun openEditor(id: String) {
        while (backStack.size > 1) backStack.removeAt(backStack.lastIndex)
        backStack += Screen.Editor(id)
    }

    fun refreshSystemState() {
        val ctx = getApplication<Application>()
        _serviceEnabled.value = SystemSettings.isServiceEnabled(ctx)
        _batteryOk.value = SystemSettings.isIgnoringBatteryOptimizations(ctx)
    }

    fun closePanel() = ServiceBridge.closePanel()

    fun resetPanelPosition() {
        viewModelScope.launch {
            app.settings.savePanelPosition(-1, -1)
            message("Panel bir sonraki açılışta varsayılan konumda olacak")
        }
    }

    fun message(text: String) {
        _messages.trySend(text)
    }

    fun updateSettings(transform: (AppSettings) -> AppSettings) {
        viewModelScope.launch { app.settings.update(transform) }
    }

    fun saveMacro(macro: Macro, onSaved: (Macro) -> Unit = {}) {
        viewModelScope.launch {
            val saved = app.macros.save(macro)
            onSaved(saved)
        }
    }

    fun deleteMacro(id: String) {
        viewModelScope.launch {
            val name = app.macros.get(id)?.name
            app.macros.delete(id)
            message("“${name ?: "Makro"}” silindi")
        }
    }

    fun duplicateMacro(id: String) {
        viewModelScope.launch {
            app.macros.duplicate(id)?.let { message("“${it.name}” oluşturuldu") }
        }
    }

    fun exportTo(uri: Uri, ids: List<String>?) {
        viewModelScope.launch {
            val list = if (ids == null) macros.value else macros.value.filter { it.id in ids }
            val result = runCatching {
                withContext(Dispatchers.IO) {
                    val text = app.macros.exportJson(list)
                    getApplication<Application>().contentResolver.openOutputStream(uri, "wt")?.use {
                        it.write(text.toByteArray(Charsets.UTF_8))
                    } ?: error("Dosya açılamadı")
                }
            }
            message(if (result.isSuccess) "${list.size} makro dışa aktarıldı" else "Dışa aktarma başarısız: ${result.exceptionOrNull()?.message}")
        }
    }

    fun importFrom(uri: Uri) {
        viewModelScope.launch {
            val result = runCatching {
                val text = withContext(Dispatchers.IO) {
                    getApplication<Application>().contentResolver.openInputStream(uri)?.use {
                        it.readBytes().toString(Charsets.UTF_8)
                    } ?: error("Dosya okunamadı")
                }
                app.macros.importJson(text)
            }
            message(
                result.fold(
                    onSuccess = { "$it makro içe aktarıldı" },
                    onFailure = { "Geçersiz yedek dosyası" },
                )
            )
        }
    }
}
