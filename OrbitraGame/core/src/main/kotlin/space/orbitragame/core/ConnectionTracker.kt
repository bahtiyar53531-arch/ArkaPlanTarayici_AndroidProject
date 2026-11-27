package space.orbitragame.core

/**
 * Sayfadaki oyun WebSocket baglantilarinin durumunu izler (yalnizca gozlem;
 * oyunun trafigine dokunulmaz). JS tarafindan gelen "acildi/kapandi"
 * olaylariyla beslenir.
 */
class ConnectionTracker {

    enum class State { NO_SOCKET, CONNECTING, CONNECTED, DISCONNECTED }

    private val open = mutableSetOf<String>()
    private val connecting = mutableSetOf<String>()

    /** Bu sayfa yuklemesinde en az bir soket acildi mi? */
    var hadSocket: Boolean = false
        private set

    /** Son bilinen soket sunucusu (ping icin). */
    var lastHost: String? = null
        private set
    var lastPort: Int? = null
        private set

    var lastCloseAtMs: Long = 0
        private set

    fun onPageStarted() {
        open.clear()
        connecting.clear()
        hadSocket = false
        lastCloseAtMs = 0
    }

    fun onSocketCreated(id: String, host: String?, port: Int?) {
        connecting += id
        if (host != null && UrlPolicy.isTrustedHost(host)) {
            lastHost = host
            lastPort = port
        }
    }

    fun onSocketOpen(id: String) {
        connecting -= id
        open += id
        hadSocket = true
    }

    fun onSocketClosed(id: String, nowMs: Long) {
        val wasOpen = open.remove(id)
        connecting -= id
        if (wasOpen && open.isEmpty()) lastCloseAtMs = nowMs
    }

    val openCount: Int get() = open.size

    val state: State
        get() = when {
            open.isNotEmpty() -> State.CONNECTED
            connecting.isNotEmpty() -> State.CONNECTING
            hadSocket -> State.DISCONNECTED
            else -> State.NO_SOCKET
        }
}
