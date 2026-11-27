package space.orbitragame.core

import kotlin.math.roundToInt

/**
 * Oyun olcegi (zoom). CSS veya oyun koduna dokunmaz: WebView'in yerlesim
 * boyutu (CSS viewport) "ekran / olcek" yapilir ve gorunum Android tarafinda
 * "olcek" kadar buyutulur/kucultulur. Boylece:
 *  - Oyun her zaman tum ekrani doldurur (kaydirma gerekmez),
 *  - Dokunma koordinatlarini Android otomatik donusturur,
 *  - WebGL tuvali bozulmaz; oyun sadece ekrani farkli boyutta gorur.
 */
class ZoomModel(
    val minScale: Float = 0.6f,
    val maxScale: Float = 1.8f,
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
        private const val EPS = 0.001f

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
