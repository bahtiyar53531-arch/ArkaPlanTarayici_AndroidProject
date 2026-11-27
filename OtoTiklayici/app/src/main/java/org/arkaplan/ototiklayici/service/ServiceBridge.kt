package org.arkaplan.ototiklayici.service

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.lang.ref.WeakReference

/** Panelin hangi içerikle açılacağı. */
sealed interface PanelRequest {
    /** Ekranın ortasında tek bir hedefle başla. */
    data object SingleTarget : PanelRequest

    /** Boş bir çoklu hedef oturumu. */
    data object MultiTarget : PanelRequest

    /** Kaydet & tekrarla oturumu (kayıt düğmesi vurgulu). */
    data object Record : PanelRequest

    /** Bellekteki son oturumu geri aç (yoksa boş çoklu hedef). */
    data object Resume : PanelRequest

    /** Kayıtlı bir makroyu yükle; [autoStart] ise hemen oynat. */
    data class OpenMacro(val macroId: String, val autoStart: Boolean = false) : PanelRequest
}

/**
 * Uygulama arayüzü, hızlı ayar kutucuğu ve erişilebilirlik servisi arasındaki köprü.
 * Hepsi aynı süreçte çalıştığı için doğrudan referans yeterlidir.
 */
object ServiceBridge {
    private var serviceRef: WeakReference<AutoClickService>? = null

    private val _connected = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = _connected.asStateFlow()

    private val _panelOpen = MutableStateFlow(false)
    val panelOpen: StateFlow<Boolean> = _panelOpen.asStateFlow()

    private val _running = MutableStateFlow(false)
    val running: StateFlow<Boolean> = _running.asStateFlow()

    val service: AutoClickService? get() = serviceRef?.get()

    internal fun attach(service: AutoClickService) {
        serviceRef = WeakReference(service)
        _connected.value = true
    }

    internal fun detach(service: AutoClickService) {
        if (serviceRef?.get() === service) {
            serviceRef = null
            _connected.value = false
            _panelOpen.value = false
            _running.value = false
        }
    }

    internal fun setPanelOpen(open: Boolean) {
        _panelOpen.value = open
    }

    internal fun setRunning(running: Boolean) {
        _running.value = running
    }

    /** Servis bağlıysa paneli açar ve true döner. */
    fun openPanel(request: PanelRequest): Boolean {
        val s = service ?: return false
        s.openPanel(request)
        return true
    }

    fun closePanel() {
        service?.closePanel()
    }
}
