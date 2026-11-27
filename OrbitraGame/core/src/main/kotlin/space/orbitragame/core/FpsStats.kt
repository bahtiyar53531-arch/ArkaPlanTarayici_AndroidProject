package space.orbitragame.core

/**
 * Saniyelik FPS orneklerinden anlik, ortalama ve en dusuk degerleri hesaplar.
 * Ornekler disaridan (JS sayaci veya Android FrameMetrics) saniyede bir eklenir.
 */
class FpsStats(
    private val averageWindowSeconds: Int = 60,
    private val lowFpsThreshold: Int = 30,
    private val lowFpsSustainSeconds: Int = 3,
) {
    private val samples = ArrayDeque<Double>()

    /** Son ornek (anlik FPS). Ornek yoksa null. */
    var current: Double? = null
        private set

    fun add(fps: Double) {
        val v = fps.coerceIn(0.0, 1000.0)
        current = v
        samples.addLast(v)
        while (samples.size > averageWindowSeconds) samples.removeFirst()
    }

    fun clear() {
        samples.clear()
        current = null
    }

    val sampleCount: Int get() = samples.size

    /** Pencere icindeki ortalama FPS. */
    val average: Double?
        get() = if (samples.isEmpty()) null else samples.average()

    /** Pencere icindeki en dusuk FPS. */
    val min: Double?
        get() = samples.minOrNull()

    /**
     * Son [lowFpsSustainSeconds] saniyenin tamami esigin altindaysa true.
     * Tek bir anlik dusus uyari uretmez.
     */
    val isLow: Boolean
        get() {
            if (samples.size < lowFpsSustainSeconds) return false
            return samples.takeLast(lowFpsSustainSeconds).all { it < lowFpsThreshold }
        }
}
