package space.orbitragame.app.system

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.content.getSystemService

/** Ag baglantisi durumunu izler (Wi-Fi / mobil / yok). */
class NetworkMonitor(context: Context, private val onChange: (State) -> Unit) {

    data class State(
        val connected: Boolean,
        val validated: Boolean,
        val type: String,
        val metered: Boolean,
        val downKbps: Int,
        val signal: Int?, // Android 10+: RSSI (Wi-Fi) veya sinyal seviyesi
    ) {
        val label: String
            get() = if (!connected) "Bağlantı yok" else buildString {
                append(type)
                if (!validated) append(" (internet doğrulanamadı)")
            }
    }

    private val cm = context.getSystemService<ConnectivityManager>()
    private val main = Handler(Looper.getMainLooper())
    @Volatile var state: State = State(false, false, "—", false, 0, null)
        private set

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = refresh()
        override fun onLost(network: Network) = refresh()
        override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) = refresh()
    }
    private var registered = false

    fun start() {
        val c = cm ?: return
        if (registered) return
        runCatching { c.registerDefaultNetworkCallback(callback) }.onSuccess { registered = true }
        refresh()
    }

    fun stop() {
        val c = cm ?: return
        if (!registered) return
        runCatching { c.unregisterNetworkCallback(callback) }
        registered = false
    }

    private fun refresh() {
        val s = compute()
        main.post {
            val changed = s.connected != state.connected || s.validated != state.validated || s.type != state.type
            state = s
            if (changed) onChange(s)
        }
    }

    private fun compute(): State {
        val c = cm ?: return State(false, false, "—", false, 0, null)
        val net = c.activeNetwork ?: return State(false, false, "—", false, 0, null)
        val caps = c.getNetworkCapabilities(net) ?: return State(false, false, "—", false, 0, null)
        val type = when {
            caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> "Wi-Fi"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> "Mobil veri"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> "Ethernet"
            caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN) -> "VPN"
            else -> "Diğer"
        }
        val connected = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
        val validated = caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
        val metered = !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
        val signal = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) caps.signalStrength.takeIf { it != Int.MIN_VALUE } else null
        return State(connected, validated, type, metered, caps.linkDownstreamBandwidthKbps, signal)
    }
}
