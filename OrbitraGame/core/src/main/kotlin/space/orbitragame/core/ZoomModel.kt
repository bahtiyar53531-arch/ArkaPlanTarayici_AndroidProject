package space.orbitragame.core

import kotlin.math.roundToInt

/**
 * Oyun olcegi (zoom). Tarayicinin KENDI sayfa olcegi kullanilir (viewport):
 * oyun "ekran / olcek" genisliginde yerlesir, Chromium bunu dogal
 * cozunurlukte ekrana sigdirir. Android tarafinda gorunum olceklenmez;
 * bu sayede cizim alani hesaplari bozulmaz (siyah alan olusmaz) ve
 * dokunmalar tarayici tarafindan dogru donusturulur.
 */
class ZoomModel(
    val minScale: Float = MIN,
    val maxScale: Float = MAX,
    val step: Float = 0.1f,
    initial: Float = DEFAULT,
) {
    var scale: Float = clamp(initial)
        private set

    fun zoomIn(): Float = set(scale + step)

    fun zoomOut(): Float = set(scale - step)

    fun reset(): Float = set(DEFAULT)

    fun set(value: Float): Float {
        scale = clamp(value)
        return scale
    }

    val canZoomIn: Boolean get() = scale < maxScale - EPS
    val canZoomOut: Boolean get() = scale > minScale + EPS
    val isDefault: Boolean get() = kotlin.math.abs(scale - DEFAULT) < EPS

    val percentLabel: String get() = "%" + (scale * 100).roundToInt()

    private fun clamp(v: Float): Float {
        // 0.1 adimlarina yuvarla (kayan nokta birikimini onler)
        val rounded = (v * 100).roundToInt() / 100f
        return rounded.coerceIn(minScale, maxScale)
    }

    companion object {
        const val DEFAULT = 1.0f
        const val MIN = 0.3f
        const val MAX = 1.6f
        /** Chromium'un izin verdigi en kucuk sayfa olcegi. */
        const val ENGINE_MIN = 0.25f
        private const val EPS = 0.001f

        /**
         * Kucuk pencerede (PiP) oyunun yerlesim genisligini sabit tutan etkin sayfa olcegi.
         * Tam ekrandaki genislik [fullWidthPx], PiP penceresi [pipWidthPx].
         */
        fun pipScale(userScale: Float, fullWidthPx: Int, pipWidthPx: Int): Float {
            if (fullWidthPx <= 0 || pipWidthPx <= 0) return userScale
            return (userScale * pipWidthPx / fullWidthPx).coerceIn(ENGINE_MIN, MAX)
        }

        /**
         * Kap (ekran) boyutuna ve olcege gore WebView'in yerlesim boyutunu hesaplar.
         * @return (genislik, yukseklik) piksel
         */
        fun layoutSizeFor(containerW: Int, containerH: Int, scale: Float): Pair<Int, Int> {
            if (containerW <= 0 || containerH <= 0 || scale <= 0f) return containerW to containerH
            return (containerW / scale).roundToInt() to (containerH / scale).roundToInt()
        }

        /**
         * Kucuk pencere (PiP) icin: oyunun yerlesim boyutunu sabit tutup
         * pencereye sigacak olcegi hesaplar. Oyun yeniden boyutlanmaz.
         */
        fun fitScale(contentW: Int, contentH: Int, windowW: Int, windowH: Int): Float {
            if (contentW <= 0 || contentH <= 0 || windowW <= 0 || windowH <= 0) return 1f
            return minOf(windowW.toFloat() / contentW, windowH.toFloat() / contentH)
        }
    }
}
