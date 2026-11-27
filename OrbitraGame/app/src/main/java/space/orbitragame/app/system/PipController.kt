package space.orbitragame.app.system

import android.app.Activity
import android.app.AppOpsManager
import android.app.PendingIntent
import android.app.PictureInPictureParams
import android.app.RemoteAction
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Rect
import android.graphics.drawable.Icon
import android.os.Build
import android.os.Process
import android.util.Log
import android.util.Rational
import androidx.annotation.RequiresApi
import space.orbitragame.app.R

/**
 * Kucuk pencere (Picture-in-Picture) yonetimi.
 * Pencerenin boyutunu ve konumunu Android yonetir: kullanici surukleyerek
 * tasiyabilir, iki parmakla boyutlandirabilir, kenara iterek gizleyebilir;
 * pencereye dokunup "genislet" ile tek dokunusta tam ekrana donulur.
 */
class PipController(private val activity: Activity) {

    val isSupported: Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            activity.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)

    private var aspect = Rational(16, 9)
    private var sourceRect: Rect? = null
    private var autoEnter = false

    /** Kullanici PiP iznini ayarlardan kapatmis mi? */
    fun isAllowedByUser(): Boolean {
        if (!isSupported || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
        return try {
            val ops = activity.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
            @Suppress("DEPRECATION")
            val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_PICTURE_IN_PICTURE, Process.myUid(), activity.packageName)
            } else {
                ops.checkOpNoThrow(AppOpsManager.OPSTR_PICTURE_IN_PICTURE, Process.myUid(), activity.packageName)
            }
            mode == AppOpsManager.MODE_ALLOWED
        } catch (e: Exception) {
            true
        }
    }

    fun update(contentW: Int, contentH: Int, source: Rect?, autoEnterEnabled: Boolean) {
        if (!isSupported || Build.VERSION.SDK_INT < Build.VERSION_CODES.O || contentW <= 0 || contentH <= 0) return
        aspect = clampAspect(contentW, contentH)
        sourceRect = source
        autoEnter = autoEnterEnabled
        runCatching { activity.setPictureInPictureParams(buildParams()) }
            .onFailure { Log.w(TAG, "PiP parametreleri ayarlanamadi", it) }
    }

    /** Kucuk pencereye gec. Basarili olursa true. */
    fun enter(): Boolean {
        if (!isSupported || Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return false
        return runCatching { activity.enterPictureInPictureMode(buildParams()) }
            .onFailure { Log.w(TAG, "PiP baslatilamadi", it) }
            .getOrDefault(false)
    }

    /** Android 12+ ana ekrana donuste sistem otomatik gecis yapar. */
    val systemHandlesAutoEnter: Boolean get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S

    @RequiresApi(Build.VERSION_CODES.O)
    private fun buildParams(): PictureInPictureParams {
        val b = PictureInPictureParams.Builder()
            .setAspectRatio(aspect)
            .setActions(listOf(reconnectAction()))
        sourceRect?.let { b.setSourceRectHint(it) }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            b.setAutoEnterEnabled(autoEnter)
            b.setSeamlessResizeEnabled(true)
        }
        return b.build()
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun reconnectAction(): RemoteAction {
        val intent = Intent(ACTION_PIP_RECONNECT).setPackage(activity.packageName)
        val pi = PendingIntent.getBroadcast(
            activity, 1, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val title = activity.getString(R.string.pip_reconnect)
        return RemoteAction(Icon.createWithResource(activity, R.drawable.ic_refresh), title, title, pi)
    }

    private fun clampAspect(w: Int, h: Int): Rational {
        // Android'in kabul ettigi aralik: 1:2.39 .. 2.39:1
        val r = w.toFloat() / h
        return when {
            r > 2.39f -> Rational(239, 100)
            r < 1f / 2.39f -> Rational(100, 239)
            else -> Rational(w, h)
        }
    }

    companion object {
        private const val TAG = "OrbitraPip"
        const val ACTION_PIP_RECONNECT = "space.orbitragame.app.PIP_RECONNECT"
    }
}
