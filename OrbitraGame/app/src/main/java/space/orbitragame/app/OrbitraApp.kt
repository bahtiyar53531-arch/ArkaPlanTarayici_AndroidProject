package space.orbitragame.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.os.Build
import androidx.core.content.getSystemService

class OrbitraApp : Application() {

    override fun onCreate() {
        super.onCreate()
        createNotificationChannels()
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService<NotificationManager>() ?: return
        val channel = NotificationChannel(
            CHANNEL_SESSION,
            getString(R.string.notif_channel_session),
            NotificationManager.IMPORTANCE_LOW, // ses/titresim yok
        ).apply {
            description = getString(R.string.notif_channel_session_desc)
            setShowBadge(false)
        }
        nm.createNotificationChannel(channel)
    }

    companion object {
        const val CHANNEL_SESSION = "game_session"
    }
}
