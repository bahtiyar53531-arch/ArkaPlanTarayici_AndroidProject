package space.orbitragame.app.web

import android.net.Uri
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient

/** WebView istemcilerinin Activity'ye bildirdigi olaylar. */
interface GameWebHost {
    fun onMainFrameStarted(url: String)
    fun onMainFrameCommitVisible(url: String)
    fun onMainFrameFinished(url: String)
    fun onMainFrameProgress(progress: Int)
    fun onMainFrameError(kind: ErrorKind, description: String, httpCode: Int? = null)
    fun onBlockedNavigation(url: String, reason: String)
    fun onExternalLink(url: String)
    fun onRendererGone(crashed: Boolean)
    fun onPermissionRequest(request: PermissionRequest)
    fun onFileChooser(callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean

    enum class ErrorKind { OFFLINE, NETWORK, SSL, HTTP }
}
