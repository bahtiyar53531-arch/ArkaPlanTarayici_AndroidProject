package space.orbitragame.app.system

import android.os.Handler
import android.os.Looper
import space.orbitragame.core.PingStats
import space.orbitragame.core.UrlPolicy
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

/**
 * Ping olcumu: oyunun WebSocket sunucusuna (veya bilinmiyorsa
 * orbitragame.space:443) TCP el sikismasi suresi olculur.
 *
 * Neden bu yontem?
 *  - Oyunun kendi soket trafigine HICBIR paket eklenmez (oyuna mudahale yok).
 *  - HTTP istegi gonderilmez; sunucu tarafinda bot korumasini tetiklemez.
 *  - TCP SYN/SYN-ACK suresi ag gecikmesinin (RTT) dogrudan olcusudur.
 *  - DNS cozumlemesi onbellege alinir ve olcume dahil edilmez.
 */
class PingMonitor(
    private val targetProvider: () -> Pair<String, Int>,
    private val onResult: (PingStats) -> Unit,
) {
    val stats = PingStats(window = 20)
    private val executor = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "orbitra-ping").apply { isDaemon = true } }
    private val main = Handler(Looper.getMainLooper())
    private var task: ScheduledFuture<*>? = null

    private var cachedHost: String? = null
    private var cachedAddr: InetAddress? = null
    private var cachedAt = 0L

    val isRunning: Boolean get() = task != null

    fun start(intervalMs: Long = 2_000) {
        if (task != null) return
        task = executor.scheduleWithFixedDelay({ measureOnce() }, 0, intervalMs, TimeUnit.MILLISECONDS)
    }

    fun stop() {
        task?.cancel(false)
        task = null
    }

    fun shutdown() {
        stop()
        executor.shutdownNow()
    }

    private fun resolve(host: String): InetAddress {
        val now = System.currentTimeMillis()
        val cached = cachedAddr
        if (cached != null && cachedHost == host && now - cachedAt < 60_000) return cached
        val addr = InetAddress.getByName(host)
        cachedHost = host; cachedAddr = addr; cachedAt = now
        return addr
    }

    private fun measureOnce() {
        val (host, port) = targetProvider()
        // Guvenlik: yalnizca oyunun alan adlarina olcum yapilir.
        if (!UrlPolicy.isTrustedHost(host)) return
        val rtt = try {
            val addr = resolve(host)
            Socket().use { s ->
                s.tcpNoDelay = true
                val t0 = System.nanoTime()
                s.connect(InetSocketAddress(addr, port), 3_000)
                (System.nanoTime() - t0) / 1_000_000
            }
        } catch (e: Exception) {
            cachedAddr = null
            null
        }
        main.post {
            if (rtt != null) stats.addSuccess(rtt) else stats.addFailure()
            onResult(stats)
        }
    }
}
