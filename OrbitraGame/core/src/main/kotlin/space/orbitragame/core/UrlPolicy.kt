package space.orbitragame.core

import java.net.URI
import java.util.Locale

/** Bir gezinme isteginin nasil ele alinacagi. */
sealed class NavigationDecision {
    /** Uygulama icinde ac. */
    data object Allow : NavigationDecision()

    /** Ayni adresin HTTPS surumune yonlendir (http -> https). */
    data class UpgradeToHttps(val httpsUrl: String) : NavigationDecision()

    /** Kullanici tiklamasiyla gelen dis baglanti: sistem tarayicisinda ac. */
    data class OpenExternally(val url: String) : NavigationDecision()

    /** Guvenilmeyen / otomatik yonlendirme: engelle. */
    data class Block(val reason: String) : NavigationDecision()
}

/**
 * Alan adi beyaz listesi. Yalnizca orbitragame.space ve alt alan adlari
 * uygulama icinde acilir. Diger her sey ya engellenir ya da kullanici
 * tiklamasi varsa harici tarayiciya devredilir.
 */
object UrlPolicy {

    private val EXTERNAL_SCHEMES = setOf("mailto", "tel")
    private val ALWAYS_BLOCKED_SCHEMES = setOf("javascript", "file", "content", "intent", "data", "blob", "ftp")

    fun hostOf(url: String): String? = try {
        URI(url.trim()).host?.lowercase(Locale.ROOT)?.trimEnd('.')
    } catch (e: Exception) {
        null
    }

    /** host tam olarak kok alan adi veya onun bir alt alan adi mi? */
    fun isTrustedHost(host: String?): Boolean {
        if (host.isNullOrBlank()) return false
        val h = host.lowercase(Locale.ROOT).trimEnd('.')
        return h == GameConfig.ROOT_DOMAIN || h.endsWith("." + GameConfig.ROOT_DOMAIN)
    }

    fun isTrustedUrl(url: String): Boolean {
        val uri = parse(url) ?: return false
        return uri.scheme.equals("https", ignoreCase = true) && uri.userInfo == null && isTrustedHost(uri.host)
    }

    /**
     * Ana cerceve (main frame) gezinmesi icin karar verir.
     * @param hasUserGesture istek kullanicinin dokunmasiyla mi baslatildi
     */
    fun decideMainFrame(url: String, hasUserGesture: Boolean): NavigationDecision {
        if (url.equals("about:blank", ignoreCase = true)) return NavigationDecision.Allow
        val uri = parse(url) ?: return NavigationDecision.Block("Gecersiz adres")
        val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return NavigationDecision.Block("Sema yok")

        if (scheme in ALWAYS_BLOCKED_SCHEMES) return NavigationDecision.Block("Izin verilmeyen sema: $scheme")
        if (scheme in EXTERNAL_SCHEMES) {
            return if (hasUserGesture) NavigationDecision.OpenExternally(url)
            else NavigationDecision.Block("Otomatik harici yonlendirme")
        }
        if (scheme != "https" && scheme != "http") return NavigationDecision.Block("Desteklenmeyen sema: $scheme")

        // https://orbitragame.space@kotu.site gibi kullanici-bilgisi hilelerine karsi
        if (uri.userInfo != null) return NavigationDecision.Block("Adreste kullanici bilgisi var")

        val trusted = isTrustedHost(uri.host)
        if (trusted) {
            if (scheme == "http") {
                val https = "https" + url.trim().substring(4)
                return NavigationDecision.UpgradeToHttps(https)
            }
            return NavigationDecision.Allow
        }

        // Guvenilmeyen alan adi
        return if (hasUserGesture && scheme == "https") NavigationDecision.OpenExternally(url)
        else NavigationDecision.Block("Guvenilmeyen alan adi: ${uri.host}")
    }

    /** Adres oyun sayfasi mi (giris sonrasi /oyun)? */
    fun isGamePage(url: String?): Boolean {
        if (url == null || !isTrustedUrl(url)) return false
        val path = parse(url)?.path ?: return false
        return path == GameConfig.GAME_PATH || path.startsWith(GameConfig.GAME_PATH + "/")
    }

    private fun parse(url: String): URI? = try {
        URI(url.trim())
    } catch (e: Exception) {
        null
    }
}
