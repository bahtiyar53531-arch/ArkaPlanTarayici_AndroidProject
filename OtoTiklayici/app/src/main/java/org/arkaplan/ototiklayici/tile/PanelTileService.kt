package org.arkaplan.ototiklayici.tile

import android.annotation.SuppressLint
import android.app.PendingIntent
import android.content.Intent
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import org.arkaplan.ototiklayici.MainActivity
import org.arkaplan.ototiklayici.service.ServiceBridge

/** Bildirim panelindeki hızlı ayar kutucuğu: yüzen paneli tek dokunuşla aç/kapat. */
class PanelTileService : TileService() {

    override fun onStartListening() {
        super.onStartListening()
        refresh()
    }

    override fun onClick() {
        super.onClick()
        val service = ServiceBridge.service
        if (service == null) {
            openApp()
            return
        }
        service.togglePanel()
        refresh()
    }

    private fun refresh() {
        val tile = qsTile ?: return
        val connected = ServiceBridge.connected.value
        tile.state = when {
            !connected -> Tile.STATE_INACTIVE
            ServiceBridge.panelOpen.value -> Tile.STATE_ACTIVE
            else -> Tile.STATE_INACTIVE
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.subtitle = when {
                !connected -> "Servis kapalı"
                ServiceBridge.running.value -> "Çalışıyor"
                ServiceBridge.panelOpen.value -> "Panel açık"
                else -> "Kapalı"
            }
        }
        tile.updateTile()
    }

    @SuppressLint("StartActivityAndCollapseDeprecated")
    private fun openApp() {
        val intent = Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            val pending = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE)
            startActivityAndCollapse(pending)
        } else {
            @Suppress("DEPRECATION")
            startActivityAndCollapse(intent)
        }
    }
}
