package space.orbitragame.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.ActivityManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Rect
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.view.View
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.widget.Button
import android.widget.FrameLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService
import androidx.core.graphics.Insets
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.isVisible
import androidx.lifecycle.Lifecycle
import androidx.webkit.WebSettingsCompat
import androidx.webkit.WebViewFeature
import space.orbitragame.app.service.GameSessionService
import space.orbitragame.app.settings.AppSettings
import space.orbitragame.app.system.DeviceStats
import space.orbitragame.app.system.DisplayController
import space.orbitragame.app.system.FrameRateMonitor
import space.orbitragame.app.system.NetworkMonitor
import space.orbitragame.app.system.PingMonitor
import space.orbitragame.app.system.PipController
import space.orbitragame.app.ui.ControlButtonView
import space.orbitragame.app.ui.ControlMenuView
import space.orbitragame.app.ui.DragHelper
import space.orbitragame.app.ui.GameViewport
import space.orbitragame.app.ui.PerfPanelView
import space.orbitragame.app.ui.SettingsDialog
import space.orbitragame.app.ui.SpaceLoadingView
import space.orbitragame.app.ui.ZoomOverlayView
import space.orbitragame.app.web.GameChromeClient
import space.orbitragame.app.web.GameWebHost
import space.orbitragame.app.web.GameWebView
import space.orbitragame.app.web.GameWebViewClient
import space.orbitragame.app.web.JsBridge
import space.orbitragame.app.web.WebViewHolder
import space.orbitragame.core.ConnectionTracker
import space.orbitragame.core.FpsStats
import space.orbitragame.core.GameConfig
import space.orbitragame.core.LoadingProgressModel
import space.orbitragame.core.PingStats
import space.orbitragame.core.ReconnectPolicy
import space.orbitragame.core.UrlPolicy
import space.orbitragame.core.ZoomModel
import java.util.concurrent.Executors
import kotlin.math.max

/**
 * ORBITRAGAME.SPACE ana ekrani.
 *
 * Sorumluluklar:
 *  - Acilis ekrani ve GERCEK yukleme ilerlemesi
 *  - Oyun WebView'inin kurulumu ve yasam dongusu (gereksiz yenileme yok)
 *  - Tam ekran / yon / zoom / kucuk pencere (PiP)
 *  - FPS ve ping paneli
 *  - Baglanti izleme ve kontrollu yeniden baglanma
 *  - Arka planda baglanti koruma (on plan servisi)
 */
class MainActivity : AppCompatActivity(), GameWebHost, JsBridge.Listener {

    // ---- Gorunumler ----
    private lateinit var root: FrameLayout
    private lateinit var gameContainer: FrameLayout
    private lateinit var overlayLayer: FrameLayout
    private lateinit var loadingView: SpaceLoadingView
    private lateinit var perfPanel: PerfPanelView
    private lateinit var controlButton: ControlButtonView
    private lateinit var pageProgress: View
    private lateinit var banner: View
    private lateinit var bannerText: TextView
    private lateinit var bannerAction: Button
    private lateinit var errorOverlay: View
    private lateinit var errorTitle: TextView
    private lateinit var errorMessage: TextView
    private var menuView: ControlMenuView? = null
    private var menuScrim: View? = null
    private var zoomOverlay: ZoomOverlayView? = null

    // ---- Bilesenler ----
    private lateinit var settings: AppSettings
    private lateinit var screen: DisplayController
    private lateinit var pip: PipController
    private lateinit var viewport: GameViewport
    private lateinit var network: NetworkMonitor
    private lateinit var pingMonitor: PingMonitor
    private lateinit var frameMonitor: FrameRateMonitor
    private lateinit var deviceStats: DeviceStats
    private var bridge: JsBridge? = null
    private val loading = LoadingProgressModel()
    private val tracker = ConnectionTracker()
    private val reconnectPolicy = ReconnectPolicy()
    private val gameFps = FpsStats()
    private val handler = Handler(Looper.getMainLooper())
    private val statsExecutor = Executors.newSingleThreadExecutor { r -> Thread(r, "orbitra-stats").apply { isDaemon = true } }

    private var webView: GameWebView? = null

    // ---- Durum ----
    private var loadingVisible = true
    private var currentUrl: String? = null
    private var isGamePage = false
    private var pageLoading = false
    private var errorThisLoad = false
    private var errorVisible = false
    private var lastErrorKind: GameWebHost.ErrorKind? = null
    private var pendingLoad = false
    private var pendingReconnect = false
    private var pendingRecreate = false
    private var inPip = false
    private var isStarted = false
    private var serviceRequested = false
    private var lowLatencyLock: WifiManager.WifiLock? = null

    // Panel verileri
    private var browserFps: Double? = null
    private var screenFps: Double? = null
    private var jsHeapMb: Int? = null
    private var pendingGameFps = -1.0
    private var lastDevice: DeviceStats.Snapshot? = null
    private var statsTick = 0
    private var batteryTipShown = false

    // ---- Izin / dosya secici ----
    private var pendingPermission: PermissionRequest? = null
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val micPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        val req = pendingPermission ?: return@registerForActivityResult
        pendingPermission = null
        if (granted) req.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE)) else req.deny()
    }

    private val notificationPermission = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    private val fileChooser = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        fileCallback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data))
        fileCallback = null
    }

    private val appReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            when (intent.action) {
                PipController.ACTION_PIP_RECONNECT -> reconnect(showLoading = false)
                GameSessionService.ACTION_QUIT_APP -> quitApp()
            }
        }
    }

    // =====================================================================
    // Yasam dongusu
    // =====================================================================

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        bindViews()

        settings = AppSettings(this)
        screen = DisplayController(this)
        pip = PipController(this)
        viewport = GameViewport(gameContainer, ZoomModel(initial = settings.zoomScale))
        deviceStats = DeviceStats(this)
        network = NetworkMonitor(this, ::onNetworkChanged)
        pingMonitor = PingMonitor(::pingTarget) { if (!isDestroyed) renderPanel() }
        frameMonitor = FrameRateMonitor(window) { fps -> screenFps = fps }

        screen.applyFullscreen(settings.fullscreen)
        screen.applyOrientation(settings.orientation)
        setupInsets()
        setupTaskDescription()
        setupOverlays()
        setupBackHandling()
        registerAppReceiver()
        network.start()

        loadingView.setProgress(loading.percent, loading.stage.label)

        // Acilis ekrani bir kare cizildikten sonra tarayici motorunu hazirla.
        loadingView.post { createEngine() }
    }

    override fun onStart() {
        super.onStart()
        isStarted = true
        if (pendingRecreate) {
            pendingRecreate = false
            recreateEngine()
        } else if (pendingReconnect && network.state.connected) {
            pendingReconnect = false
            reconnect(showLoading = true)
        }
    }

    override fun onResume() {
        super.onResume()
        webView?.onResume()
        stopSessionService()
        screen.reapply()
        updateScreenOn()
        acquireLowLatencyWifi()
        refreshPanel()
        updatePipParams()
    }

    override fun onPause() {
        super.onPause()
        CookieManager.getInstance().flush()
        // Android 12+ on plan servisinin arka plandan baslatilmasina izin vermez;
        // Activity hala gorunurken (onPause) baslatiyoruz.
        if (!isFinishing && isGamePage && settings.keepAliveInBackground) {
            serviceRequested = GameSessionService.start(this, settings.keepAwakeScreenOff) || serviceRequested
        }
    }

    override fun onStop() {
        super.onStop()
        isStarted = false
        releaseLowLatencyWifi()
        stopMonitors()
        if (!settings.keepAliveInBackground && !isFinishing) {
            // Pil tasarrufu modu: oyun motoru duraklatilir (baglanti kopabilir).
            webView?.onPause()
        }
    }

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        runCatching { unregisterReceiver(appReceiver) }
        network.stop()
        pingMonitor.shutdown()
        frameMonitor.stop()
        statsExecutor.shutdownNow()
        if (isFinishing) {
            stopSessionService()
            WebViewHolder.destroy()
            loadingView.release()
        } else {
            // Sistem Activity'yi yeniden olusturacak: WebView (oyun oturumu) korunur.
            WebViewHolder.detach(this)
        }
        webView = null
        super.onDestroy()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) screen.reapply()
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        // Ekran dondurme / boyut degisimi: Activity yeniden olusturulmaz,
        // oyun sayfasi yeniden yuklenmez; yalnizca yerlesim guncellenir.
        root.post {
            viewport.apply()
            placeOverlays()
            updatePipParams()
        }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        // Android 8-11: ana ekrana donuste kucuk pencereye gec.
        if (shouldAutoPip() && !pip.systemHandlesAutoEnter) pip.enter()
    }

    override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        inPip = isInPictureInPictureMode
        closeMenu()
        closeZoomOverlay()
        overlayLayer.isVisible = !inPip
        if (inPip) banner.isVisible = false
        pageProgress.isVisible = false
        ViewCompat.requestApplyInsets(root)
        viewport.setPip(inPip)
        if (inPip) {
            stopMonitors()
        } else if (lifecycle.currentState == Lifecycle.State.CREATED) {
            // Kullanici kucuk pencereyi kapatti (X).
            if (!settings.keepAliveInBackground) finish()
        } else {
            screen.reapply()
            refreshPanel()
        }
    }

    // =====================================================================
    // Tarayici motoru
    // =====================================================================

    private fun createEngine() {
        val (wv, isNew) = WebViewHolder.obtain(this, ::buildWebView)
        webView = wv
        val b = WebViewHolder.bridge ?: JsBridge().also { WebViewHolder.bridge = it }
        b.listener = this
        bridge = b
        viewport.attach(wv)
        if (isNew) {
            loading.onEngineReady()
            updateLoadingUi()
            startInitialLoad()
        } else {
            // Activity yeniden olusturuldu ama oyun oturumu yasiyor: yeniden yukleme YOK.
            wv.webViewClient = GameWebViewClient(this, b)
            wv.webChromeClient = GameChromeClient(this)
            currentUrl = wv.url
            isGamePage = UrlPolicy.isGamePage(currentUrl)
            hideLoading(immediate = true)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun buildWebView(context: Context): GameWebView {
        val wv = GameWebView(context)
        wv.keepAliveWhenHidden = settings.keepAliveInBackground
        wv.setBackgroundColor(Color.BLACK)
        wv.isVerticalScrollBarEnabled = false
        wv.isHorizontalScrollBarEnabled = false
        wv.overScrollMode = View.OVER_SCROLL_NEVER
        wv.isFocusable = true
        wv.isFocusableInTouchMode = true

        with(wv.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            useWideViewPort = true
            loadWithOverviewMode = false
            setSupportZoom(true) // Yalnizca sayfa izin veriyorsa (viewport meta) tarayici yakinlastirmasi
            builtInZoomControls = true
            displayZoomControls = false
            textZoom = 100 // Sistem yazi boyutu oyun yerlesimini bozmasin
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            cacheMode = WebSettings.LOAD_DEFAULT
            offscreenPreRaster = true
            setGeolocationEnabled(false)
            userAgentString = "$userAgentString OrbitraGameAndroid/${BuildConfig.VERSION_NAME}"
        }
        // Istege bagli ozellikler: eski/uretici WebView surumlerinde desteklenmeyebilir;
        // desteklenmezse uygulama yine de calisir.
        runCatching {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.ALGORITHMIC_DARKENING)) {
                WebSettingsCompat.setAlgorithmicDarkeningAllowed(wv.settings, false)
            }
        }
        runCatching {
            if (WebViewFeature.isFeatureSupported(WebViewFeature.SAFE_BROWSING_ENABLE)) {
                WebSettingsCompat.setSafeBrowsingEnabled(wv.settings, true)
            }
        }
        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(wv, true) // captcha / dogrulama cerceveleri icin
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // Arka planda oyun motorunun (renderer) sistemce kapatilma ihtimalini azaltir.
            wv.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, !settings.keepAliveInBackground)
        }
        wv.setDownloadListener { url, _, _, _, _ ->
            if (url.startsWith("https://")) openExternal(url)
        }
        // Olcum koprusu (FPS / soket durumu). Kurulamazsa oyun yine calisir, yalnizca olcum olmaz.
        val b = JsBridge().also { it.listener = this }
        WebViewHolder.bridge = b
        bridge = b
        runCatching { b.install(this, wv) }
        wv.webViewClient = GameWebViewClient(this, b)
        wv.webChromeClient = GameChromeClient(this)
        return wv
    }

    private fun startInitialLoad() {
        if (!network.state.connected) {
            pendingLoad = true
            loadingView.setStatus("İnternet bağlantısı bekleniyor…", warning = true)
            return
        }
        pendingLoad = false
        loadingView.setStatus(null)
        loadGame()
    }

    private fun loadGame() {
        val wv = webView ?: return
        errorThisLoad = false
        loading.onRequestSent()
        updateLoadingUi()
        wv.loadUrl(GameConfig.GAME_URL)
        handler.removeCallbacks(loadTimeout)
        handler.postDelayed(loadTimeout, LOAD_TIMEOUT_MS)
    }

    private val loadTimeout = Runnable {
        if (loadingVisible && loading.stage.ordinal < LoadingProgressModel.Stage.RESOURCES.ordinal) {
            onMainFrameError(GameWebHost.ErrorKind.NETWORK, "Sunucu ${LOAD_TIMEOUT_MS / 1000} saniye içinde yanıt vermedi.")
        }
    }

    /** Oyuna yeniden baglan: oyun adresini temiz sekilde yeniden yukler (oturum cerezleri korunur). */
    private fun reconnect(showLoading: Boolean) {
        handler.removeCallbacks(reconnectRunnable)
        hideBanner()
        hideError()
        val wv = webView
        if (wv == null) {
            recreateEngine(); return
        }
        if (!network.state.connected) {
            pendingReconnect = true
            showBanner("İnternet bağlantısı bekleniyor…", null, null)
            return
        }
        if (showLoading) showLoadingOverlay()
        loadGame()
    }

    /** Oyun motoru coktugunde veya kapatildiginda temiz bir WebView kur. */
    private fun recreateEngine() {
        WebViewHolder.destroy()
        webView = null
        tracker.onPageStarted()
        showLoadingOverlay()
        createEngine()
    }

    private fun showLoadingOverlay() {
        loading.reset()
        loading.onEngineReady()
        loadingVisible = true
        loadingView.animate().cancel()
        loadingView.alpha = 1f
        loadingView.isVisible = true
        loadingView.setStatus(null)
        updateLoadingUi()
    }

    private fun updateLoadingUi() {
        loadingView.setProgress(loading.percent, loading.stage.label)
    }

    private fun markReady() {
        if (!loadingVisible) return
        handler.removeCallbacks(readyFallback)
        loading.onGameReady()
        updateLoadingUi()
        waitForLoadingBarThenHide()
    }

    private fun waitForLoadingBarThenHide() {
        if (!loadingVisible) return
        if (loadingView.isVisuallyComplete) {
            handler.postDelayed({ hideLoading(immediate = false) }, 250)
        } else {
            handler.postDelayed({ waitForLoadingBarThenHide() }, 40)
        }
    }

    private val readyFallback = Runnable { markReady() }

    private fun hideLoading(immediate: Boolean) {
        loadingVisible = false
        handler.removeCallbacks(loadTimeout)
        if (immediate) {
            loadingView.isVisible = false
        } else {
            loadingView.animate().alpha(0f).setDuration(380).withEndAction {
                loadingView.isVisible = false
            }.start()
        }
        webView?.requestFocus()
        onGameScreenShown()
    }

    private fun onGameScreenShown() {
        refreshPanel()
        updatePipParams()
        maybeAskNotificationPermission()
    }

    // =====================================================================
    // GameWebHost (WebView olaylari)
    // =====================================================================

    override fun onMainFrameStarted(url: String) {
        currentUrl = url
        isGamePage = UrlPolicy.isGamePage(url)
        pageLoading = true
        tracker.onPageStarted()
        if (loadingVisible) {
            loading.onServerResponded()
            updateLoadingUi()
        }
        showPageProgress(10)
        updatePipParams()
    }

    override fun onMainFrameCommitVisible(url: String) {
        if (loadingVisible) {
            loading.onServerResponded()
            updateLoadingUi()
            // Emniyet: sayfa icerigi gorundu ama yukleme hic "bitmedi" ise ekrani acik tutma.
            handler.removeCallbacks(readyFallback)
            handler.postDelayed(readyFallback, COMMIT_FALLBACK_MS)
        }
    }

    override fun onMainFrameProgress(progress: Int) {
        if (loadingVisible) {
            loading.onWebProgress(progress)
            updateLoadingUi()
        }
        showPageProgress(progress)
    }

    override fun onMainFrameFinished(url: String) {
        pageLoading = false
        currentUrl = url
        isGamePage = UrlPolicy.isGamePage(url)
        hidePageProgress()
        CookieManager.getInstance().flush()
        if (!errorThisLoad) {
            hideError()
            if (!isGamePage) reconnectPolicy.onConnected() // sayfa basariyla yuklendi
        }
        updateScreenOn()
        if (loadingVisible && !errorThisLoad) {
            loading.onPageLoaded()
            updateLoadingUi()
            if (isGamePage) {
                // Oyun cizmeye baslayinca JS "hazir" sinyali gelir; gelmezse yedek sure.
                handler.removeCallbacks(readyFallback)
                handler.postDelayed(readyFallback, READY_FALLBACK_MS)
            } else {
                // Giris / kayit sayfasi: kullanicinin etkilesimi gerekiyor.
                markReady()
            }
        }
        updatePipParams()
        if (isGamePage && !loadingVisible && !errorThisLoad) onGameScreenShown()
    }

    override fun onMainFrameError(kind: GameWebHost.ErrorKind, description: String, httpCode: Int?) {
        errorThisLoad = true
        pageLoading = false
        hidePageProgress()
        val effective = if (!network.state.connected) GameWebHost.ErrorKind.OFFLINE else kind
        lastErrorKind = effective
        val (title, msg) = when (effective) {
            GameWebHost.ErrorKind.OFFLINE -> getString(R.string.error_title_offline) to getString(R.string.error_msg_offline)
            GameWebHost.ErrorKind.SSL -> getString(R.string.error_title_ssl) to getString(R.string.error_msg_ssl)
            GameWebHost.ErrorKind.HTTP -> getString(R.string.error_title_server) to "Sunucu geçici olarak yanıt vermiyor ($description)."
            GameWebHost.ErrorKind.NETWORK -> getString(R.string.error_title_server) to description
        }
        showError(title, msg)
        if (loadingVisible) hideLoading(immediate = true)
        // Gecici ag/sunucu hatalarinda otomatik yeniden deneme
        if (settings.autoReconnect && (effective == GameWebHost.ErrorKind.NETWORK || effective == GameWebHost.ErrorKind.HTTP)) {
            scheduleReconnect("Sunucuya ulaşılamadı")
        }
    }

    override fun onBlockedNavigation(url: String, reason: String) {
        val host = UrlPolicy.hostOf(url) ?: url.take(40)
        if (url.startsWith("https://")) {
            showBanner("Oyun dışı sayfa engellendi: $host", "Tarayıcıda aç") { openExternal(url) }
        } else {
            showBanner("Güvenilmeyen yönlendirme engellendi", null, null)
        }
        // Engellenen sayfa yuklenmeye baslamissa guvenli sayfaya geri don.
        val wv = webView ?: return
        val cur = wv.url
        if (cur != null && !UrlPolicy.isTrustedUrl(cur) && !cur.startsWith("about:")) {
            if (wv.canGoBack()) wv.goBack() else wv.loadUrl(GameConfig.GAME_URL)
        }
    }

    override fun onExternalLink(url: String) {
        AlertDialog.Builder(this)
            .setTitle(R.string.external_link_title)
            .setMessage(getString(R.string.external_link_msg, url.take(120)))
            .setPositiveButton(R.string.open) { _, _ -> openExternal(url) }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    override fun onRendererGone(crashed: Boolean) {
        // WebView kullanilamaz durumda: guvenle yok et ve yeniden kur.
        WebViewHolder.destroy()
        webView = null
        tracker.onPageStarted()
        if (isStarted || inPip) {
            recreateEngine()
            showBanner(if (crashed) "Oyun motoru hata verdi ve yeniden başlatıldı" else "Bellek yetersizliği nedeniyle oyun motoru yeniden başlatıldı", null, null)
        } else {
            pendingRecreate = true
        }
    }

    override fun onPermissionRequest(request: PermissionRequest) {
        val origin = request.origin?.toString() ?: ""
        val trusted = UrlPolicy.isTrustedUrl(origin)
        val wantsAudio = request.resources.contains(PermissionRequest.RESOURCE_AUDIO_CAPTURE)
        if (!trusted || !wantsAudio) {
            request.deny(); return
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
            request.grant(arrayOf(PermissionRequest.RESOURCE_AUDIO_CAPTURE))
        } else {
            pendingPermission?.deny()
            pendingPermission = request
            micPermission.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    override fun onFileChooser(callback: ValueCallback<Array<Uri>>, params: WebChromeClient.FileChooserParams): Boolean {
        fileCallback?.onReceiveValue(null)
        fileCallback = callback
        return try {
            fileChooser.launch(params.createIntent())
            true
        } catch (e: Exception) {
            fileCallback = null
            false
        }
    }

    // =====================================================================
    // JsBridge.Listener (olcum verileri)
    // =====================================================================

    override fun onGameStats(gameFrames: Int, elapsedMs: Int, isTop: Boolean) {
        val fps = gameFrames * 1000.0 / elapsedMs
        // Oyun bir iframe icinde olabilir: en yuksek degeri veren cerceve oyundur.
        pendingGameFps = max(pendingGameFps, fps)
    }

    override fun onBrowserFrames(frames: Int, elapsedMs: Int) {
        browserFps = frames * 1000.0 / elapsedMs
    }

    override fun onJsHeap(mb: Int) {
        jsHeapMb = mb
    }

    override fun onGameReady() {
        // Giris sayfasindaki arka plan animasyonu "hazir" sayilmaz; yalnizca oyun sayfasi.
        if (isGamePage) markReady()
    }

    override fun onSocketEvent(event: String, id: String, host: String?, port: Int?, code: Int?) {
        val before = tracker.state
        when (event) {
            "create" -> tracker.onSocketCreated(id, host, port)
            "open" -> {
                tracker.onSocketOpen(id)
                reconnectPolicy.onConnected()
                handler.removeCallbacks(reconnectRunnable)
                if (before == ConnectionTracker.State.DISCONNECTED) {
                    showBanner("Sunucu bağlantısı yeniden kuruldu", null, null)
                }
            }
            "close" -> {
                tracker.onSocketClosed(id, System.currentTimeMillis())
                if (tracker.state == ConnectionTracker.State.DISCONNECTED && isGamePage && !pageLoading) {
                    scheduleReconnect("Sunucu bağlantısı koptu")
                }
            }
        }
        refreshPanel()
    }

    override fun onPageVisibility(visible: Boolean) = Unit

    // =====================================================================
    // Baglanti / yeniden baglanma
    // =====================================================================

    private val reconnectRunnable = Runnable {
        if (tracker.state == ConnectionTracker.State.CONNECTED) return@Runnable // oyun kendi toparlandi
        if (!network.state.connected) {
            pendingReconnect = true; return@Runnable
        }
        if (!isStarted && !inPip) {
            pendingReconnect = true; return@Runnable
        }
        reconnectPolicy.onAttempt()
        reconnect(showLoading = !inPip)
    }

    private fun scheduleReconnect(reason: String) {
        handler.removeCallbacks(reconnectRunnable)
        if (!settings.autoReconnect) {
            showBanner(reason, getString(R.string.menu_reconnect)) { reconnect(showLoading = true) }
            return
        }
        val delay = reconnectPolicy.nextDelayMs()
        if (delay == null) {
            showBanner("$reason. Otomatik deneme sınırı doldu.", getString(R.string.menu_reconnect)) {
                reconnectPolicy.onConnected()
                reconnect(showLoading = true)
            }
            return
        }
        showBanner("$reason — ${delay / 1000} sn içinde yeniden bağlanılacak", "Şimdi bağlan") {
            reconnectPolicy.onAttempt()
            reconnect(showLoading = true)
        }
        handler.postDelayed(reconnectRunnable, delay)
    }

    private fun onNetworkChanged(state: NetworkMonitor.State) {
        refreshPanel()
        if (!state.connected) {
            if (!loadingVisible && !errorVisible) showBanner("İnternet bağlantısı kesildi — bekleniyor…", null, null)
            return
        }
        when {
            pendingLoad -> startInitialLoad()
            errorVisible && lastErrorKind != GameWebHost.ErrorKind.SSL -> reconnect(showLoading = true)
            pendingReconnect && (isStarted || inPip) -> {
                pendingReconnect = false
                reconnect(showLoading = !inPip)
            }
            tracker.state == ConnectionTracker.State.DISCONNECTED && isGamePage -> scheduleReconnect("Ağ değişti")
            else -> if (banner.isVisible) hideBanner()
        }
    }

    private fun pingTarget(): Pair<String, Int> =
        (tracker.lastHost ?: GameConfig.DEFAULT_PING_HOST) to (tracker.lastPort ?: GameConfig.DEFAULT_PING_PORT)

    // =====================================================================
    // Arayuz: menu, panel, zoom, banner, hata
    // =====================================================================

    private fun bindViews() {
        root = findViewById(R.id.root)
        gameContainer = findViewById(R.id.gameContainer)
        overlayLayer = findViewById(R.id.overlayLayer)
        loadingView = findViewById(R.id.loadingView)
        perfPanel = findViewById(R.id.perfPanel)
        controlButton = findViewById(R.id.controlButton)
        pageProgress = findViewById(R.id.pageProgress)
        banner = findViewById(R.id.banner)
        bannerText = findViewById(R.id.bannerText)
        bannerAction = findViewById(R.id.bannerAction)
        errorOverlay = findViewById(R.id.errorOverlay)
        errorTitle = findViewById(R.id.errorTitle)
        errorMessage = findViewById(R.id.errorMessage)
        findViewById<Button>(R.id.errorRetry).setOnClickListener {
            reconnectPolicy.onConnected()
            reconnect(showLoading = true)
        }
    }

    private fun setupInsets() {
        ViewCompat.setOnApplyWindowInsetsListener(root) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val cutout = insets.getInsets(WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            val safe = when {
                inPip -> Insets.NONE
                screen.isFullscreen -> cutout
                else -> Insets.max(bars, cutout)
            }
            gameContainer.setPadding(safe.left, safe.top, safe.right, max(safe.bottom, if (inPip) 0 else ime.bottom))
            val gap = (6 * resources.displayMetrics.density).toInt() // kenarlara yapismasin
            overlayLayer.setPadding(safe.left + gap, safe.top + gap, safe.right + gap, max(safe.bottom, if (inPip) 0 else ime.bottom) + gap)
            (banner.layoutParams as? FrameLayout.LayoutParams)?.let {
                it.topMargin = safe.top + (12 * resources.displayMetrics.density).toInt()
                banner.layoutParams = it
            }
            root.post { placeOverlays() }
            insets
        }
    }

    private fun setupTaskDescription() {
        val color = ContextCompat.getColor(this, R.color.space_black)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            setTaskDescription(
                ActivityManager.TaskDescription.Builder()
                    .setLabel(GameConfig.APP_NAME)
                    .setIcon(R.mipmap.ic_launcher)
                    .setPrimaryColor(color)
                    .setBackgroundColor(color)
                    .build(),
            )
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            @Suppress("DEPRECATION")
            setTaskDescription(ActivityManager.TaskDescription(GameConfig.APP_NAME, R.mipmap.ic_launcher, color))
        } else {
            @Suppress("DEPRECATION")
            setTaskDescription(ActivityManager.TaskDescription(GameConfig.APP_NAME, BitmapFactory.decodeResource(resources, R.mipmap.ic_launcher), color))
        }
    }

    private fun setupOverlays() {
        DragHelper(
            controlButton, snapToEdges = true,
            onClick = { toggleMenu() },
            onMoved = { fx, fy -> settings.controlButtonX = fx; settings.controlButtonY = fy },
            onTouchStateChanged = { touching -> if (touching) controlButton.wake() else controlButton.scheduleFade() },
        ).attach()
        DragHelper(
            perfPanel, snapToEdges = false,
            onClick = { perfPanel.expanded = !perfPanel.expanded; root.post { placeOverlays() } },
            onMoved = { fx, fy -> settings.panelX = fx; settings.panelY = fy },
        ).attach()
        overlayLayer.addOnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> placeOverlays() }
    }

    private fun placeOverlays() {
        DragHelper.place(controlButton, settings.controlButtonX, settings.controlButtonY)
        if (perfPanel.isVisible) DragHelper.place(perfPanel, settings.panelX, settings.panelY)
    }

    private fun setupBackHandling() {
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                val wv = webView
                when {
                    zoomOverlay != null -> closeZoomOverlay()
                    menuView != null -> closeMenu()
                    !isGamePage && wv != null && wv.canGoBack() -> wv.goBack()
                    else -> showExitDialog()
                }
            }
        })
    }

    private fun showExitDialog() {
        val options = ArrayList<Pair<String, () -> Unit>>()
        if (pip.isSupported && isGamePage) options += getString(R.string.exit_pip) to { enterPip() }
        options += getString(R.string.exit_background) to { moveTaskToBack(true); Unit }
        options += getString(R.string.exit_quit) to { quitApp() }
        AlertDialog.Builder(this)
            .setTitle(R.string.exit_title)
            .setItems(options.map { it.first }.toTypedArray()) { _, which -> options[which].second() }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun quitApp() {
        stopSessionService()
        finishAndRemoveTask()
    }

    private fun toggleMenu() {
        if (menuView != null) closeMenu() else openMenu()
    }

    private fun openMenu() {
        if (inPip) return
        controlButton.wake()
        val scrim = View(this).apply {
            setBackgroundColor(0x33000000)
            isClickable = true
            setOnClickListener { closeMenu() }
        }
        val menu = ControlMenuView(this, ::onMenuAction)
        bindMenu(menu)
        root.addView(scrim, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        root.addView(menu, FrameLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        menuScrim = scrim
        menuView = menu
        menu.alpha = 0f
        menu.post { positionMenu(menu); menu.animate().alpha(1f).setDuration(140).start() }
    }

    private fun bindMenu(menu: ControlMenuView) {
        val z = viewport.zoom
        menu.bind(
            fullscreen = screen.isFullscreen,
            orientation = settings.orientation.name,
            fps = settings.showFps,
            ping = settings.showPing,
            zoomPercent = z.percentLabel,
            canZoomIn = z.canZoomIn,
            canZoomOut = z.canZoomOut,
            pipAvailable = pip.isSupported,
        )
    }

    /** Menuyu kontrol dugmesinin yanina, ekran disina tasmayacak sekilde yerlestir. */
    private fun positionMenu(menu: View) {
        val margin = 8 * resources.displayMetrics.density
        val btnX = controlButton.translationX + overlayLayer.left
        val btnY = controlButton.translationY + overlayLayer.top
        val onRight = btnX + controlButton.width / 2f > root.width / 2f
        val x = if (onRight) btnX - menu.width - margin else btnX + controlButton.width + margin
        val y = btnY + controlButton.height / 2f - menu.height / 2f
        val minX = overlayLayer.paddingLeft + margin
        val maxX = root.width - overlayLayer.paddingRight - menu.width - margin
        val minY = overlayLayer.paddingTop + margin
        val maxY = root.height - overlayLayer.paddingBottom - menu.height - margin
        menu.translationX = x.coerceIn(minX, max(minX, maxX))
        menu.translationY = y.coerceIn(minY, max(minY, maxY))
    }

    private fun closeMenu() {
        menuView?.let { root.removeView(it) }
        menuScrim?.let { root.removeView(it) }
        menuView = null
        menuScrim = null
        controlButton.scheduleFade()
    }

    private fun onMenuAction(action: ControlMenuView.Action) {
        when (action) {
            ControlMenuView.Action.FULLSCREEN -> {
                settings.fullscreen = !screen.isFullscreen
                screen.applyFullscreen(settings.fullscreen)
                ViewCompat.requestApplyInsets(root)
            }
            ControlMenuView.Action.PORTRAIT -> setOrientation(AppSettings.Orientation.PORTRAIT)
            ControlMenuView.Action.LANDSCAPE -> setOrientation(AppSettings.Orientation.LANDSCAPE)
            ControlMenuView.Action.AUTO_ROTATE -> setOrientation(AppSettings.Orientation.AUTO)
            ControlMenuView.Action.FPS -> {
                settings.showFps = !settings.showFps
                refreshPanel()
            }
            ControlMenuView.Action.PING -> {
                settings.showPing = !settings.showPing
                refreshPanel()
            }
            ControlMenuView.Action.ZOOM_IN -> applyZoom(viewport.zoom.zoomIn())
            ControlMenuView.Action.ZOOM_OUT -> applyZoom(viewport.zoom.zoomOut())
            ControlMenuView.Action.ZOOM_RESET -> applyZoom(viewport.zoom.reset())
            ControlMenuView.Action.ZOOM_PINCH -> {
                closeMenu(); openZoomOverlay(); return
            }
            ControlMenuView.Action.PIP -> {
                closeMenu(); enterPip(); return
            }
            ControlMenuView.Action.RECONNECT -> {
                closeMenu()
                reconnectPolicy.onConnected()
                reconnect(showLoading = true)
                return
            }
            ControlMenuView.Action.RESTART -> {
                closeMenu(); confirmRestart(); return
            }
            ControlMenuView.Action.SETTINGS -> {
                closeMenu()
                SettingsDialog.show(this, settings, ::onSettingsChanged)
                return
            }
            ControlMenuView.Action.CLOSE -> {
                closeMenu(); return
            }
        }
        menuView?.let { bindMenu(it); it.post { positionMenu(it) } }
    }

    private fun setOrientation(o: AppSettings.Orientation) {
        settings.orientation = o
        screen.applyOrientation(o)
    }

    private fun applyZoom(scale: Float) {
        settings.zoomScale = scale
        viewport.apply()
        zoomOverlay?.refresh()
        updatePipParams()
    }

    private fun openZoomOverlay() {
        if (zoomOverlay != null) return
        val overlay = ZoomOverlayView(
            this,
            currentScale = { viewport.zoom.scale },
            onScale = { s -> applyZoom(viewport.zoom.set(s)) },
            onDone = { closeZoomOverlay() },
        )
        root.addView(overlay, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        zoomOverlay = overlay
    }

    private fun closeZoomOverlay() {
        zoomOverlay?.let { root.removeView(it) }
        zoomOverlay = null
    }

    private fun confirmRestart() {
        AlertDialog.Builder(this)
            .setTitle(R.string.restart_confirm_title)
            .setMessage(R.string.restart_confirm_msg)
            .setPositiveButton(R.string.restart) { _, _ ->
                CookieManager.getInstance().flush()
                stopSessionService()
                WebViewHolder.destroy()
                RestartActivity.restart(this)
            }
            .setNegativeButton(R.string.cancel, null)
            .show()
    }

    private fun onSettingsChanged() {
        webView?.keepAliveWhenHidden = settings.keepAliveInBackground
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            webView?.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, !settings.keepAliveInBackground)
        }
        updateScreenOn()
        releaseLowLatencyWifi()
        acquireLowLatencyWifi()
        updatePipParams()
    }

    private fun showBanner(text: String, action: String?, onAction: (() -> Unit)?) {
        if (inPip) return
        bannerText.text = text
        if (action != null && onAction != null) {
            bannerAction.text = action
            bannerAction.isVisible = true
            bannerAction.setOnClickListener { hideBanner(); onAction() }
        } else {
            bannerAction.isVisible = false
        }
        banner.isVisible = true
        handler.removeCallbacks(hideBannerRunnable)
        handler.postDelayed(hideBannerRunnable, if (action != null) 15_000 else 4_000)
    }

    private val hideBannerRunnable = Runnable { hideBanner() }

    private fun hideBanner() {
        banner.isVisible = false
    }

    private fun showError(title: String, message: String) {
        errorTitle.text = title
        errorMessage.text = message
        errorOverlay.isVisible = true
        errorVisible = true
    }

    private fun hideError() {
        errorOverlay.isVisible = false
        errorVisible = false
    }

    private fun showPageProgress(progress: Int) {
        if (loadingVisible || inPip || progress >= 100) {
            if (progress >= 100) hidePageProgress()
            return
        }
        pageProgress.isVisible = true
        val lp = pageProgress.layoutParams
        lp.width = root.width * progress.coerceIn(5, 100) / 100
        pageProgress.layoutParams = lp
    }

    private fun hidePageProgress() {
        pageProgress.isVisible = false
    }

    // =====================================================================
    // Performans paneli
    // =====================================================================

    private val statsTicker = object : Runnable {
        override fun run() {
            statsTick++
            if (pendingGameFps >= 0) {
                gameFps.add(pendingGameFps)
                pendingGameFps = -1.0
            }
            if (statsTick % 3 == 1) {
                val includePss = statsTick % 6 == 1
                statsExecutor.execute {
                    val snap = deviceStats.snapshot(includePss)
                    handler.post {
                        lastDevice = snap.copy(appPssMb = snap.appPssMb ?: lastDevice?.appPssMb)
                    }
                }
            }
            renderPanel()
            handler.postDelayed(this, 1000)
        }
    }

    private fun refreshPanel() {
        if (!::settings.isInitialized || isDestroyed) return
        val on = (settings.showFps || settings.showPing) && !inPip
        perfPanel.showFps = settings.showFps
        perfPanel.showPing = settings.showPing
        perfPanel.isVisible = on
        bridge?.setStatsEnabled(settings.showFps && !inPip)
        val active = on && isStarted
        if (settings.showFps && active) frameMonitor.start() else frameMonitor.stop()
        if (settings.showPing && active) pingMonitor.start() else pingMonitor.stop()
        handler.removeCallbacks(statsTicker)
        pendingGameFps = -1.0 // eski olcum kalintisi ilk ornegi bozmasin
        if (active) handler.post(statsTicker)
        if (!settings.showFps) {
            gameFps.clear(); browserFps = null; screenFps = null
        }
        renderPanel()
        root.post { placeOverlays() }
    }

    private fun stopMonitors() {
        frameMonitor.stop()
        pingMonitor.stop()
        handler.removeCallbacks(statsTicker)
        bridge?.setStatsEnabled(false)
    }

    private fun renderPanel() {
        if (!perfPanel.isVisible) return
        val p = pingMonitor.stats
        val d = lastDevice
        val socketText: String
        val socketColor: Int
        when (tracker.state) {
            ConnectionTracker.State.CONNECTED -> {
                socketText = "Bağlı (${tracker.openCount})"; socketColor = PerfPanelView.COLOR_GOOD
            }
            ConnectionTracker.State.CONNECTING -> {
                socketText = "Bağlanıyor…"; socketColor = PerfPanelView.COLOR_WARN
            }
            ConnectionTracker.State.DISCONNECTED -> {
                socketText = "Koptu"; socketColor = PerfPanelView.COLOR_BAD
            }
            ConnectionTracker.State.NO_SOCKET -> {
                socketText = if (isGamePage) "Oyun soketi yok" else "Oyunda değil"; socketColor = PerfPanelView.COLOR_DIM
            }
        }
        val pingColor = when (p.quality()) {
            PingStats.Quality.GOOD -> PerfPanelView.COLOR_GOOD
            PingStats.Quality.FAIR -> PerfPanelView.COLOR_WARN
            PingStats.Quality.POOR, PingStats.Quality.OFFLINE -> PerfPanelView.COLOR_BAD
            PingStats.Quality.UNKNOWN -> PerfPanelView.COLOR_DIM
        }
        // View uzerinden: pencereye bagli degilse null doner, asla istisna firlatmaz.
        val refresh = window?.decorView?.display?.refreshRate
        perfPanel.update(
            PerfPanelView.Data(
                gameFps = gameFps.current,
                gameAvg = gameFps.average,
                gameMin = gameFps.min,
                lowFps = gameFps.isLow,
                browserFps = browserFps,
                screenFps = screenFps,
                refreshRate = refresh,
                appMemMb = d?.appPssMb,
                jsHeapMb = jsHeapMb,
                sysAvailMb = d?.sysAvailMb,
                sysTotalMb = d?.sysTotalMb,
                thermal = d?.thermal,
                battery = d?.batteryPct,
                pingMs = if (p.lastSucceeded) p.last else null,
                pingJitter = p.jitter,
                pingLoss = p.lossPercent,
                pingColor = pingColor,
                network = network.state.label,
                socket = socketText,
                socketColor = socketColor,
            ),
        )
    }

    // =====================================================================
    // PiP, servis, sistem
    // =====================================================================

    private fun shouldAutoPip(): Boolean =
        settings.autoPip && pip.isSupported && isGamePage && !isFinishing && webView != null

    private fun updatePipParams() {
        if (!::pip.isInitialized || !pip.isSupported) return
        val r = Rect()
        gameContainer.getGlobalVisibleRect(r)
        pip.update(
            viewport.layoutW.takeIf { it > 0 } ?: gameContainer.width,
            viewport.layoutH.takeIf { it > 0 } ?: gameContainer.height,
            r.takeIf { !it.isEmpty },
            shouldAutoPip(),
        )
    }

    private fun enterPip() {
        when {
            !pip.isSupported -> showBanner(getString(R.string.pip_not_supported), null, null)
            !pip.isAllowedByUser() -> showBanner(getString(R.string.pip_disabled), null, null)
            else -> {
                updatePipParams()
                if (!pip.enter()) showBanner(getString(R.string.pip_not_supported), null, null)
            }
        }
    }

    private fun stopSessionService() {
        if (serviceRequested || GameSessionService.isRunning) {
            GameSessionService.stop(this)
            serviceRequested = false
        }
    }

    private fun updateScreenOn() {
        screen.keepScreenOn(settings.keepScreenOn && isGamePage)
    }

    private fun acquireLowLatencyWifi() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || !settings.lowLatencyWifi || lowLatencyLock != null) return
        val wm = applicationContext.getSystemService<WifiManager>() ?: return
        lowLatencyLock = runCatching {
            wm.createWifiLock(WifiManager.WIFI_MODE_FULL_LOW_LATENCY, "OrbitraGame::LowLatency").apply {
                setReferenceCounted(false); acquire()
            }
        }.getOrNull()
    }

    private fun releaseLowLatencyWifi() {
        runCatching { lowLatencyLock?.takeIf { it.isHeld }?.release() }
        lowLatencyLock = null
    }

    private fun maybeAskNotificationPermission() {
        if (!isGamePage) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && settings.keepAliveInBackground && !settings.notificationPermissionAsked &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            settings.notificationPermissionAsked = true
            notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
            return
        }
        // Tek seferlik ipucu: pil optimizasyonu arka plan baglantisini kesebilir.
        val pm = getSystemService<PowerManager>()
        if (!batteryTipShown && !settings.batteryPromptShown && settings.keepAliveInBackground &&
            pm != null && !pm.isIgnoringBatteryOptimizations(packageName)
        ) {
            batteryTipShown = true
            settings.batteryPromptShown = true
            showBanner("Arka planda kesintisiz bağlantı için pil optimizasyonunu kapatabilirsin.", "Ayarla") {
                SettingsDialog.requestIgnoreBatteryOptimizations(this)
            }
        }
    }

    private fun openExternal(url: String) {
        runCatching {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE))
        }.onFailure { showBanner("Bağlantıyı açacak uygulama bulunamadı", null, null) }
    }

    private fun registerAppReceiver() {
        val filter = IntentFilter().apply {
            addAction(PipController.ACTION_PIP_RECONNECT)
            addAction(GameSessionService.ACTION_QUIT_APP)
        }
        ContextCompat.registerReceiver(this, appReceiver, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
    }

    private companion object {
        const val LOAD_TIMEOUT_MS = 30_000L
        const val READY_FALLBACK_MS = 10_000L
        const val COMMIT_FALLBACK_MS = 20_000L
    }
}
