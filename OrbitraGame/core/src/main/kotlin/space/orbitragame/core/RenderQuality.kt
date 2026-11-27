package space.orbitragame.core

/**
 * Render kalitesi = oyunun gordugu devicePixelRatio ust siniri.
 * Oyun tuvalini "CSS boyutu x devicePixelRatio" ile olusturuyorsa daha
 * dusuk deger daha az piksel = daha yuksek FPS demektir. Tarayicinin kendi
 * yazi/arayuz cizimi etkilenmez.
 */
enum class RenderQuality(val label: String, val dprCap: Float) {
    MAX("Maksimum (cihaz)", 0f),
    HIGH("Yüksek", 2.5f),
    BALANCED("Dengeli", 2.0f),
    PERFORMANCE("Performans", 1.5f),
    ULTRA("Ultra performans", 1.0f);

    fun lower(): RenderQuality? = entries.getOrNull(ordinal + 1)
}

/**
 * Otomatik (uyarlanabilir) kalite. Yalnizca DUSURUR, kendiliginden yukseltmez
 * (salinimi onlemek icin). Bir dusurme FPS'i iyilestirmediyse geri alir ve
 * o oturumda bir daha dusurmez (sorun cozunurlukte degil demektir).
 */
class AdaptiveQualityController(
    start: RenderQuality = RenderQuality.BALANCED,
    /** Otomatik olarak inilebilecek en dusuk seviye (goruntu fazla bulaniklasmasin). */
    private val floor: RenderQuality = RenderQuality.ULTRA,
    private val lowFpsThreshold: Double = 40.0,
    private val windowSamples: Int = 6,
    private val cooldownMs: Long = 20_000,
    private val minImprovement: Double = 0.10,
) {
    var level: RenderQuality = start
        private set

    /** Otomatik dusurme bu oturumda devre disi mi (faydasiz bulundu). */
    var disabled = false
        private set

    private val samples = ArrayDeque<Double>()
    private var lastChangeAt = Long.MIN_VALUE / 2
    private var pendingCheck: Pair<RenderQuality, Double>? = null // (onceki seviye, onceki ort. FPS)

    sealed class Decision {
        data object None : Decision()
        data class Lowered(val from: RenderQuality, val to: RenderQuality, val reason: String) : Decision()
        data class Reverted(val to: RenderQuality) : Decision()
    }

    /** Seviye artik degismeyecek mi (alt sinira inildi veya devre disi)? */
    val settled: Boolean get() = pendingCheck == null && (disabled || (level.lower()?.let { it.ordinal > floor.ordinal } ?: true))

    fun reset(start: RenderQuality = RenderQuality.BALANCED) {
        level = start; disabled = false; samples.clear(); pendingCheck = null; lastChangeAt = Long.MIN_VALUE / 2
    }

    /** Saniyelik oyun FPS ornegi. [thermalSevere] cihaz asiri isindiysa true. */
    fun onSample(fps: Double, nowMs: Long, thermalSevere: Boolean = false): Decision {
        samples.addLast(fps)
        while (samples.size > windowSamples) samples.removeFirst()
        if (nowMs - lastChangeAt < cooldownMs || samples.size < windowSamples) return Decision.None
        val avg = samples.average()

        // Onceki dusurmenin etkisini degerlendir
        pendingCheck?.let { (prev, before) ->
            pendingCheck = null
            if (before > 0 && avg < before * (1 + minImprovement) && avg < lowFpsThreshold) {
                level = prev
                disabled = true
                lastChangeAt = nowMs
                samples.clear()
                return Decision.Reverted(prev)
            }
        }
        if (disabled) return Decision.None

        val reason = when {
            thermalSevere -> "cihaz çok ısındı"
            avg < lowFpsThreshold -> "FPS düşük (ort. ${avg.toInt()})"
            else -> return Decision.None
        }
        val next = level.lower()?.takeIf { it.ordinal <= floor.ordinal } ?: return Decision.None
        val from = level
        pendingCheck = from to avg
        level = next
        lastChangeAt = nowMs
        samples.clear()
        return Decision.Lowered(from, next, reason)
    }
}
