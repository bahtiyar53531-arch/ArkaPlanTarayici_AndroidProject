package space.orbitragame.core

import kotlin.math.abs

/** Ping (gidis-donus suresi) olcumlerini tutar. */
class PingStats(private val window: Int = 20) {
    private val results = ArrayDeque<Long?>() // null = basarisiz olcum

    fun addSuccess(rttMs: Long) = push(rttMs.coerceAtLeast(0))

    fun addFailure() = push(null)

    fun clear() = results.clear()

    private fun push(v: Long?) {
        results.addLast(v)
        while (results.size > window) results.removeFirst()
    }

    private val ok: List<Long> get() = results.filterNotNull()

    /** Son basarili olcum. */
    val last: Long? get() = results.lastOrNull()

    val lastSucceeded: Boolean get() = results.lastOrNull() != null

    val average: Long? get() = ok.takeIf { it.isNotEmpty() }?.average()?.toLong()

    val median: Long?
        get() {
            val s = ok.sorted()
            if (s.isEmpty()) return null
            return if (s.size % 2 == 1) s[s.size / 2] else (s[s.size / 2 - 1] + s[s.size / 2]) / 2
        }

    /** Ardisik olcumler arasindaki ortalama fark (ms). */
    val jitter: Long?
        get() {
            val s = ok
            if (s.size < 2) return null
            return s.zipWithNext { a, b -> abs(b - a) }.average().toLong()
        }

    /** Kayip orani (0..100). */
    val lossPercent: Int
        get() = if (results.isEmpty()) 0 else results.count { it == null } * 100 / results.size

    /** Ping kalitesi siniflandirmasi. */
    fun quality(): Quality {
        val m = median ?: return if (results.isNotEmpty()) Quality.OFFLINE else Quality.UNKNOWN
        if (!lastSucceeded && lossPercent >= 50) return Quality.OFFLINE
        return when {
            m < 80 -> Quality.GOOD
            m < 160 -> Quality.FAIR
            else -> Quality.POOR
        }
    }

    enum class Quality { UNKNOWN, GOOD, FAIR, POOR, OFFLINE }
}
