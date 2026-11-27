package org.arkaplan.ototiklayici

import android.content.Intent
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.arkaplan.ototiklayici.service.PanelRequest
import org.arkaplan.ototiklayici.service.ServiceBridge
import org.arkaplan.ototiklayici.ui.AppRoot
import org.arkaplan.ototiklayici.ui.MainViewModel
import org.arkaplan.ototiklayici.ui.theme.OtoTheme
import org.arkaplan.ototiklayici.util.SystemSettings

class MainActivity : ComponentActivity() {

    private val vm: MainViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        publishShortcuts()
        if (savedInstanceState == null) handleIntent(intent)
        setContent {
            val settings by vm.settings.collectAsStateWithLifecycle()
            OtoTheme(settings.themeMode, settings.dynamicColor) {
                AppRoot(
                    vm = vm,
                    onOpenPanel = ::openPanel,
                    onEnableService = { SystemSettings.openAccessibilitySettings(this) },
                    onAppInfo = { SystemSettings.openAppInfo(this) },
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        vm.refreshSystemState()
    }

    private fun handleIntent(intent: Intent?) {
        intent ?: return
        intent.getStringExtra(EXTRA_EDIT_MACRO)?.let { id ->
            vm.openEditor(id)
            intent.removeExtra(EXTRA_EDIT_MACRO)
        }
        val request = when (intent.action) {
            ACTION_SINGLE -> PanelRequest.SingleTarget
            ACTION_MULTI -> PanelRequest.MultiTarget
            ACTION_RECORD -> PanelRequest.Record
            else -> null
        }
        if (request != null) {
            val shortcutId = when (request) {
                PanelRequest.SingleTarget -> "single"
                PanelRequest.MultiTarget -> "multi"
                else -> "record"
            }
            runCatching { getSystemService(ShortcutManager::class.java)?.reportShortcutUsed(shortcutId) }
            intent.action = Intent.ACTION_MAIN
            // Servis bağlanana kadar kısa bir an geçebilir; bağlı değilse kullanıcıyı yönlendir.
            window.decorView.post { openPanel(request) }
        }
    }

    /** Paneli açar ve uygulamayı arka plana alır; böylece hedef uygulamaya geçilebilir. */
    private fun openPanel(request: PanelRequest) {
        if (ServiceBridge.openPanel(request)) {
            moveTaskToBack(true)
        } else {
            vm.message("Önce erişilebilirlik servisini aç")
            SystemSettings.openAccessibilitySettings(this)
        }
    }

    private fun publishShortcuts() {
        val manager = getSystemService(ShortcutManager::class.java) ?: return
        fun shortcut(id: String, label: String, icon: Int, action: String, rank: Int) =
            ShortcutInfo.Builder(this, id)
                .setShortLabel(label)
                .setLongLabel(label)
                .setIcon(Icon.createWithResource(this, icon))
                .setIntent(Intent(this, MainActivity::class.java).setAction(action))
                .setRank(rank)
                .build()
        runCatching {
            manager.dynamicShortcuts = listOf(
                shortcut("single", "Tek nokta", R.drawable.ic_shortcut_touch, ACTION_SINGLE, 0),
                shortcut("multi", "Çoklu nokta", R.drawable.ic_shortcut_targets, ACTION_MULTI, 1),
                shortcut("record", "Kaydet & tekrarla", R.drawable.ic_shortcut_record, ACTION_RECORD, 2),
            )
        }
    }

    companion object {
        const val EXTRA_EDIT_MACRO = "edit_macro_id"
        const val ACTION_SINGLE = "org.arkaplan.ototiklayici.action.SINGLE"
        const val ACTION_MULTI = "org.arkaplan.ototiklayici.action.MULTI"
        const val ACTION_RECORD = "org.arkaplan.ototiklayici.action.RECORD"
    }
}
