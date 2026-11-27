package space.orbitragame.core

/**
 * Uygulamanin tek oyun hedefi ve guvenilen alan adlari.
 * Burada degisiklik yapmak tum uygulamanin davranisini belirler.
 */
object GameConfig {
    const val APP_NAME = "ORBITRAGAME.SPACE"

    /** Uygulama acildiginda yuklenen tek oyun adresi. */
    const val GAME_URL = "https://orbitragame.space/oyun"

    /** Oyun sayfasinin yolu (giris sonrasi buraya donulur). */
    const val GAME_PATH = "/oyun"

    /** Kok alan adi. Alt alan adlari (www., cdn. vb.) da guvenilir sayilir. */
    const val ROOT_DOMAIN = "orbitragame.space"

    /** JS kopru mesajlarinin kabul edildigi kaynaklar (origin). */
    val TRUSTED_ORIGINS: Set<String> = setOf(
        "https://orbitragame.space",
        "https://www.orbitragame.space",
    )
}
