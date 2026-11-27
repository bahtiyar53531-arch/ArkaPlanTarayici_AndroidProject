package space.orbitragame.core

/**
 * Acilis ekranindaki yuzde gostergesi. Tum degerler GERCEK olaylara dayanir;
 * zamanlayiciyla sahte ilerleme uretilmez.
 *
 *  %0  Uygulama baslatiliyor        -> Activity olusturuldu
 *  %20 Tarayici motoru hazirlaniyor -> WebView olusturuldu
 *  %40 Oyun sunucusuna baglaniliyor -> Istek gonderildi (loadUrl)
 *  %60 Oyun kaynaklari yukleniyor   -> Sunucu yanit verdi, sayfa basladi
 *  %80 Oyun ekrani hazirlaniyor     -> Sayfa ve kaynaklari yuklendi
 *  %100 Oyuna giris yapiliyor       -> Oyun cizmeye basladi / giris sayfasi hazir
 */
class LoadingProgressModel {

    enum class Stage(val basePercent: Int, val label: String) {
        STARTING(0, "Uygulama başlatılıyor"),
        ENGINE(20, "Tarayıcı motoru hazırlanıyor"),
        CONNECTING(40, "Oyun sunucusuna bağlanılıyor"),
        RESOURCES(60, "Oyun kaynakları yükleniyor"),
        PREPARING(80, "Oyun ekranı hazırlanıyor"),
        ENTERING(100, "Oyuna giriş yapılıyor"),
    }

    var stage: Stage = Stage.STARTING
        private set

    /** Chromium'un bildirdigi gercek sayfa yukleme ilerlemesi (0..100). */
    private var webProgress: Int = 0

    /** Gosterilecek yuzde (0..100). Asla geri gitmez. */
    var percent: Int = 0
        private set

    fun onEngineReady() = advanceTo(Stage.ENGINE)

    fun onRequestSent() = advanceTo(Stage.CONNECTING)

    fun onServerResponded() = advanceTo(Stage.RESOURCES)

    fun onPageLoaded() = advanceTo(Stage.PREPARING)

    fun onGameReady() = advanceTo(Stage.ENTERING)

    /** WebChromeClient.onProgressChanged degeri. */
    fun onWebProgress(progress: Int) {
        webProgress = progress.coerceIn(0, 100)
        recompute()
    }

    /** Yeni bir yukleme (yeniden baglanma) baslarken sifirla. */
    fun reset() {
        stage = Stage.STARTING
        webProgress = 0
        percent = 0
    }

    val isComplete: Boolean get() = stage == Stage.ENTERING

    private fun advanceTo(target: Stage) {
        if (target.ordinal > stage.ordinal) stage = target
        recompute()
    }

    private fun recompute() {
        val computed = when (stage) {
            // Sunucu yaniti beklenirken yalnizca Chromium'un erken ilerlemesi
            // (DNS/TLS/istek) 40..59 araliginda yansitilir.
            Stage.CONNECTING -> 40 + (webProgress.coerceAtMost(50) * 19 / 50)
            // Kaynaklar yuklenirken gercek ilerleme 60..79 araligina eslenir.
            Stage.RESOURCES -> 60 + (webProgress * 19 / 100)
            else -> stage.basePercent
        }
        percent = maxOf(percent, computed.coerceIn(0, 100))
    }
}
