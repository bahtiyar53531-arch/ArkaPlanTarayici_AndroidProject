package space.orbitragame.app.service

import android.annotation.SuppressLint
import android.app.Notification
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import androidx.core.content.getSystemService
import space.orbitragame.app.MainActivity
import space.orbitragame.app.OrbitraApp
import space.orbitragame.app.R

/**
 * Uygulama arka plandayken (veya kucuk penceredeyken) oyun oturumunu
 * korumak icin on plan servisi.
 *
 *  - Surecin oncelligini yuksek tutar; Android'in sureci/oyun motorunu
 *    kapatma ihtimalini azaltir.
 *  - Istege bagli: ekran kapaliyken CPU (PARTIAL_WAKE_LOCK) ve Wi-Fi'yi
 *    uyanik tutar. Kilitler en fazla [MAX_LOCK_MS] surer.
 *  - Kullanici uygulamaya dondugunde hemen durdurulur.
 */
class GameSessionService : Service() {

    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopSelfSafely()
            return START_NOT_STICKY
        }
        if (intent?.action == ACTION_QUIT) {
            // Bildirimdeki "Kapat": uygulamayi tamamen kapat.
            sendBroadcast(Intent(ACTION_QUIT_APP).setPackage(packageName))
            stopSelfSafely()
            return START_NOT_STICKY
        }
        val keepAwake = intent?.getBooleanExtra(EXTRA_KEEP_AWAKE, false) ?: false
        try {
            val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE
            } else 0
            ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(), type)
        } catch (e: Exception) {
            Log.w(TAG, "On plan servisi baslatilamadi", e)
            stopSelf()
            return START_NOT_STICKY
        }
        if (keepAwake) acquireLocks() else releaseLocks()
        isRunning = true
        return START_NOT_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        // Kullanici uygulamayi son uygulamalardan kaydirarak kapatti.
        sendBroadcast(Intent(ACTION_QUIT_APP).setPackage(packageName))
        stopSelfSafely()
        super.onTaskRemoved(rootIntent)
    }

    override fun onDestroy() {
        releaseLocks()
        isRunning = false
        super.onDestroy()
    }

    private fun stopSelfSafely() {
        releaseLocks()
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE)
        stopSelf()
        isRunning = false
    }

    @SuppressLint("WakelockTimeout")
    private fun acquireLocks() {
        if (wakeLock?.isHeld != true) {
            wakeLock = getSystemService<PowerManager>()
                ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "OrbitraGame::Session")
                ?.apply { setReferenceCounted(false); acquire(MAX_LOCK_MS) }
        }
        if (wifiLock?.isHeld != true) {
            val wm = applicationContext.getSystemService<WifiManager>()
            @Suppress("DEPRECATION")
            wifiLock = wm?.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "OrbitraGame::Wifi")
                ?.apply { setReferenceCounted(false); acquire() }
        }
    }

    private fun releaseLocks() {
        runCatching { if (wakeLock?.isHeld == true) wakeLock?.release() }
        runCatching { if (wifiLock?.isHeld == true) wifiLock?.release() }
        wakeLock = null
        wifiLock = null
    }

    private fun buildNotification(): Notification {
        val openIntent = Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)
        val openPi = PendingIntent.getActivity(this, 10, openIntent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val quitPi = PendingIntent.getService(
            this, 11, Intent(this, GameSessionService::class.java).setAction(ACTION_QUIT),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return NotificationCompat.Builder(this, OrbitraApp.CHANNEL_SESSION)
            .setSmallIcon(R.drawable.ic_stat_orbitra)
            .setColor(ContextCompat.getColor(this, R.color.space_turquoise))
            .setContentTitle(getString(R.string.notif_title))
            .setContentText(getString(R.string.notif_text))
            .setContentIntent(openPi)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .addAction(R.drawable.ic_pip, getString(R.string.notif_return), openPi)
            .addAction(R.drawable.ic_close, getString(R.string.notif_close), quitPi)
            .build()
    }

    companion object {
        private const val TAG = "OrbitraService"
        private const val NOTIFICATION_ID = 7001
        private const val MAX_LOCK_MS = 3L * 60 * 60 * 1000 // 3 saat guvenlik siniri
        private const val EXTRA_KEEP_AWAKE = "keep_awake"
        private const val ACTION_STOP = "space.orbitragame.app.STOP_SESSION"
        private const val ACTION_QUIT = "space.orbitragame.app.QUIT_FROM_NOTIFICATION"
        const val ACTION_QUIT_APP = "space.orbitragame.app.QUIT_APP"

        @Volatile var isRunning: Boolean = false
            private set

        /** Activity hala gorunurken (onPause) cagrilmalidir; Android 12+ arka plandan baslatmayi yasaklar. */
        fun start(context: Context, keepAwake: Boolean): Boolean = try {
            val i = Intent(context, GameSessionService::class.java).putExtra(EXTRA_KEEP_AWAKE, keepAwake)
            ContextCompat.startForegroundService(context, i)
            true
        } catch (e: Exception) {
            Log.w(TAG, "Servis baslatilamadi: ${e.javaClass.simpleName}")
            false
        }

        /**
         * Durdurma istegi siraya alinir: servis henuz baslamadiysa bile once
         * startForeground cagrilir, ardindan durur (Android 8/9 cokmesini onler).
         */
        fun stop(context: Context) {
            runCatching { context.startService(Intent(context, GameSessionService::class.java).setAction(ACTION_STOP)) }
                .onFailure { runCatching { context.stopService(Intent(context, GameSessionService::class.java)) } }
        }
    }
}
