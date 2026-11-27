package org.arkaplan.ototiklayici.service

import android.accessibilityservice.AccessibilityService
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.res.Configuration
import android.os.Build
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent
import androidx.core.content.ContextCompat
import org.arkaplan.ototiklayici.overlay.OverlaySession

/**
 * Uygulamanın kalbi: dokunuşları sisteme bu erişilebilirlik servisi enjekte eder ve
 * yüzen paneli (izin istemeyen erişilebilirlik overlay'i olarak) çizer.
 * Ekran içeriğini okumaz.
 */
class AutoClickService : AccessibilityService() {

    private var session: OverlaySession? = null

    private val screenReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (intent.action == Intent.ACTION_SCREEN_OFF) session?.onScreenOff()
        }
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        session = OverlaySession(this)
        ContextCompat.registerReceiver(
            this, screenReceiver, IntentFilter(Intent.ACTION_SCREEN_OFF), ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        ServiceBridge.attach(this)
    }

    fun openPanel(request: PanelRequest) {
        (session ?: OverlaySession(this).also { session = it }).open(request)
    }

    fun closePanel() {
        session?.close()
    }

    /** Hızlı ayar kutucuğu için: açıksa kapat, kapalıysa son türde aç. */
    fun togglePanel() {
        val s = session ?: return
        if (s.isOpen) {
            s.close()
        } else {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                performGlobalAction(GLOBAL_ACTION_DISMISS_NOTIFICATION_SHADE)
            }
            s.open(PanelRequest.Resume)
        }
    }

    val isPanelOpen: Boolean get() = session?.isOpen == true

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event?.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            val pkg = event.packageName?.toString() ?: return
            session?.onForegroundPackage(pkg)
        }
    }

    /** Ses tuşu basışını durdurmak için tükettiysek, bırakma olayını da tüketiriz. */
    private var consumedVolumeKey = false

    override fun onKeyEvent(event: KeyEvent): Boolean {
        val code = event.keyCode
        if (code != KeyEvent.KEYCODE_VOLUME_DOWN && code != KeyEvent.KEYCODE_VOLUME_UP) return false
        val s = session ?: return false
        return when (event.action) {
            KeyEvent.ACTION_DOWN -> {
                if (event.repeatCount == 0 && s.isRunning) consumedVolumeKey = s.onVolumeKey()
                consumedVolumeKey
            }
            KeyEvent.ACTION_UP -> consumedVolumeKey.also { consumedVolumeKey = false }
            else -> false
        }
    }

    override fun onConfigurationChanged(newConfig: Configuration) {
        super.onConfigurationChanged(newConfig)
        session?.onConfigurationChanged()
    }

    override fun onInterrupt() = Unit

    override fun onUnbind(intent: Intent?): Boolean {
        teardown()
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        teardown()
        super.onDestroy()
    }

    private fun teardown() {
        session?.destroy()
        session = null
        runCatching { unregisterReceiver(screenReceiver) }
        ServiceBridge.detach(this)
    }
}
