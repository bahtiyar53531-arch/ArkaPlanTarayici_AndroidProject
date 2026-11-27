package space.orbitragame.app.web

import android.graphics.Bitmap
import android.net.Uri
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import space.orbitragame.app.BuildConfig

class GameChromeClient(private val host: GameWebHost) : WebChromeClient() {

    override fun onProgressChanged(view: WebView, newProgress: Int) {
        host.onMainFrameProgress(newProgress)
    }

    override fun onPermissionRequest(request: PermissionRequest) {
        host.onPermissionRequest(request)
    }

    override fun onGeolocationPermissionsShowPrompt(origin: String?, callback: GeolocationPermissions.Callback) {
        callback.invoke(origin, false, false) // konum izni verilmez
    }

    override fun onShowFileChooser(
        webView: WebView,
        filePathCallback: ValueCallback<Array<Uri>>,
        fileChooserParams: FileChooserParams,
    ): Boolean = host.onFileChooser(filePathCallback, fileChooserParams)

    override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean {
        if (BuildConfig.DEBUG) {
            Log.d("OrbitraConsole", "${consoleMessage.messageLevel()}: ${consoleMessage.message()} @${consoleMessage.lineNumber()}")
        }
        return true
    }

    /** Video oynaticilarda gri "play" gorseli yerine seffaf poster. */
    override fun getDefaultVideoPoster(): Bitmap = Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
}
