package space.orbitragame.core

/**
 * Kontrollu yeniden baglanma: oyunun kendi baglantisi koparsa once oyunun
 * kendisinin toparlanmasi icin beklenir; toparlanmazsa artan araliklarla
 * (backoff) sinirli sayida yeniden baglanma denenir.
 */
class ReconnectPolicy(
    private val delaysMs: List<Long> = listOf(8_000, 15_000, 30_000, 60_000, 120_000),
) {
    var attempts: Int = 0
        private set

    /** Bir sonraki deneme icin beklenecek sure; deneme hakki bittiyse null. */
    fun nextDelayMs(): Long? = delaysMs.getOrNull(attempts)

    /** Deneme yapildiginda cagrilir. */
    fun onAttempt() {
        attempts++
    }

    /** Baglanti basariyla kuruldugunda sayac sifirlanir. */
    fun onConnected() {
        attempts = 0
    }

    val exhausted: Boolean get() = attempts >= delaysMs.size

    val maxAttempts: Int get() = delaysMs.size
}
