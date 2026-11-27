package org.arkaplan.ototiklayici.ui

import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.arkaplan.ototiklayici.BuildConfigInfo
import org.arkaplan.ototiklayici.R
import org.arkaplan.ototiklayici.data.PanelOrientation
import org.arkaplan.ototiklayici.data.ThemeMode
import org.arkaplan.ototiklayici.util.SystemSettings
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(vm: MainViewModel, snackbar: SnackbarHostState) {
    val s by vm.settings.collectAsStateWithLifecycle()
    val batteryOk by vm.batteryOk.collectAsStateWithLifecycle()
    val macros by vm.macros.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val exportLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) vm.exportTo(uri, null)
    }
    val importLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) vm.importFrom(uri)
    }
    val scroll = TopAppBarDefaults.pinnedScrollBehavior()

    Scaffold(
        modifier = Modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = {
            TopAppBar(
                title = { Text("Ayarlar") },
                navigationIcon = { IconButton(onClick = { vm.back() }) { AppIcon(R.drawable.ic_back, "Geri") } },
                scrollBehavior = scroll,
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = padding.calculateTopPadding() + 8.dp, bottom = padding.calculateBottomPadding() + 32.dp),
            verticalArrangement = Arrangement.spacedBy(20.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            item {
                SectionCard("Yeni hedefler için varsayılanlar") {
                    NumberField("Tıklama aralığı (bekleme)", s.defaultIntervalMs, { v -> vm.updateSettings { it.copy(defaultIntervalMs = v) } }, max = 86_400_000, suffix = "ms",
                        supporting = "Tek nokta modunda iki dokunuş arası süre")
                    NumberField("Dokunma (basma) süresi", s.defaultTapDurationMs, { v -> vm.updateSettings { it.copy(defaultTapDurationMs = v) } }, min = 1, max = 59_000, suffix = "ms")
                    NumberField("Kaydırma süresi", s.defaultSwipeDurationMs, { v -> vm.updateSettings { it.copy(defaultSwipeDurationMs = v) } }, min = 1, max = 59_000, suffix = "ms")
                    NumberField("Rastgele gecikme ±", s.defaultRandomDelayMs.toLong(), { v -> vm.updateSettings { it.copy(defaultRandomDelayMs = v.toInt()) } }, max = 60_000, suffix = "ms")
                    NumberField("Rastgele konum sapması ±", s.defaultRandomOffsetPx.toLong(), { v -> vm.updateSettings { it.copy(defaultRandomOffsetPx = v.toInt()) } }, max = 500, suffix = "px")
                }
            }
            item {
                SectionCard("Yüzen panel") {
                    SliderRow("Panel boyutu", s.panelScale, { v -> vm.updateSettings { it.copy(panelScale = (v * 20).roundToInt() / 20f) } }, 0.7f..1.5f, "%d%%".format((s.panelScale * 100).roundToInt()))
                    SliderRow("Panel opaklığı", s.panelOpacity, { v -> vm.updateSettings { it.copy(panelOpacity = (v * 20).roundToInt() / 20f) } }, 0.3f..1f, "%d%%".format((s.panelOpacity * 100).roundToInt()))
                    Text("Panel yönü", style = MaterialTheme.typography.bodyLarge)
                    SegmentedChoice(
                        listOf(PanelOrientation.VERTICAL to "Dikey", PanelOrientation.HORIZONTAL to "Yatay"),
                        s.panelOrientation,
                        { v -> vm.updateSettings { it.copy(panelOrientation = v) } },
                    )
                    SwitchRow("Çalışırken paneli küçült", s.collapsePanelWhileRunning, { v -> vm.updateSettings { it.copy(collapsePanelWhileRunning = v) } },
                        subtitle = "Yalnızca taşıma ve durdur düğmesi kalır")
                    OutlinedButton(onClick = { vm.resetPanelPosition() }) { Text("Panel konumunu sıfırla") }
                    Text("Boyut, opaklık ve yön panel bir sonraki açılışında uygulanır.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            item {
                SectionCard("Hedef işaretleri") {
                    SliderRow("Hedef boyutu", s.targetSizeDp.toFloat(), { v -> vm.updateSettings { it.copy(targetSizeDp = v.roundToInt()) } }, 32f..88f, "${s.targetSizeDp} dp")
                    SliderRow("Hedef opaklığı", s.targetOpacity, { v -> vm.updateSettings { it.copy(targetOpacity = (v * 20).roundToInt() / 20f) } }, 0.2f..1f, "%d%%".format((s.targetOpacity * 100).roundToInt()))
                    SwitchRow("Çalışırken hedefleri soluklaştır", s.dimTargetsWhileRunning, { v -> vm.updateSettings { it.copy(dimTargetsWhileRunning = v) } })
                    SwitchRow("Dokunuş göstergesi", s.showTouchFeedback, { v -> vm.updateSettings { it.copy(showTouchFeedback = v) } },
                        subtitle = "Her dokunuşta küçük bir halka animasyonu gösterir")
                }
            }
            item {
                SectionCard("Oynatma ve güvenlik") {
                    SwitchRow("Ses tuşuyla durdur", s.volumeKeyStop, { v -> vm.updateSettings { it.copy(volumeKeyStop = v) } },
                        subtitle = "Çalışırken ses açma/kısma tuşu oynatmayı anında durdurur")
                    SwitchRow("Ekran kapanınca durdur", s.stopOnScreenOff, { v -> vm.updateSettings { it.copy(stopOnScreenOff = v) } })
                    SwitchRow("Uygulama değişince durdur", s.stopOnAppChange, { v -> vm.updateSettings { it.copy(stopOnAppChange = v) } },
                        subtitle = "Başladığın uygulamadan çıkılırsa yanlış yere dokunmayı önler")
                    SwitchRow("Ekranı açık tut", s.keepScreenOn, { v -> vm.updateSettings { it.copy(keepScreenOn = v) } },
                        subtitle = "Oynatma sürerken ekran kararmaz")
                    SwitchRow("Titreşim", s.vibrate, { v -> vm.updateSettings { it.copy(vibrate = v) } },
                        subtitle = "Başlat, durdur ve kayıtta kısa titreşim")
                }
            }
            item {
                SectionCard("Kaydet & tekrarla") {
                    SwitchRow("Dokunuşları uygulamaya ilet", s.recordPassThrough, { v -> vm.updateSettings { it.copy(recordPassThrough = v) } },
                        subtitle = "Açıkken kayıt sırasında uygulamayı normal kullanırsın. Kapalıyken dokunuşlar yalnızca kaydedilir.")
                    SwitchRow("Hassas hız profili", s.preciseReplay, { v -> vm.updateSettings { it.copy(preciseReplay = v) } },
                        subtitle = "Sürüklemelerdeki duraklama ve hızlanmaları birebir tekrarlar")
                }
            }
            item {
                SectionCard("Görünüm") {
                    SegmentedChoice(
                        listOf(ThemeMode.SYSTEM to "Sistem", ThemeMode.LIGHT to "Açık", ThemeMode.DARK to "Koyu"),
                        s.themeMode,
                        { v -> vm.updateSettings { it.copy(themeMode = v) } },
                    )
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                        SwitchRow("Duvar kağıdı renkleri (Material You)", s.dynamicColor, { v -> vm.updateSettings { it.copy(dynamicColor = v) } })
                    }
                }
            }
            item {
                SectionCard("Yedekleme") {
                    Text("${macros.size} makro kayıtlı. Yedek dosyasını başka bir telefona taşıyıp içe aktarabilirsin.", style = MaterialTheme.typography.bodyMedium)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        FilledTonalButton(
                            onClick = {
                                val stamp = SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date())
                                exportLauncher.launch("oto-tiklayici-yedek-$stamp.json")
                            },
                            enabled = macros.isNotEmpty(),
                            modifier = Modifier.weight(1f),
                        ) {
                            AppIcon(R.drawable.ic_file_out, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("Dışa aktar")
                        }
                        FilledTonalButton(onClick = { importLauncher.launch(arrayOf("application/json", "text/plain", "*/*")) }, modifier = Modifier.weight(1f)) {
                            AppIcon(R.drawable.ic_file_in, modifier = Modifier.size(18.dp))
                            Spacer(Modifier.width(6.dp))
                            Text("İçe aktar")
                        }
                    }
                }
            }
            item {
                SectionCard("Sistem") {
                    SwitchRow(
                        "Pil optimizasyonu kapalı",
                        batteryOk,
                        { SystemSettings.requestIgnoreBatteryOptimizations(context) },
                        subtitle = if (batteryOk) "Sistem servisi arka planda kapatmaz" else "Bazı telefonlar servisi kapatabilir; kapatman önerilir",
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { SystemSettings.openAccessibilitySettings(context) }) { Text("Erişilebilirlik") }
                        OutlinedButton(onClick = { SystemSettings.openAppInfo(context) }) { Text("Uygulama bilgisi") }
                    }
                }
            }
            item {
                SectionCard("Hakkında") {
                    Text("Oto Tıklayıcı ${BuildConfigInfo.versionName(context)}", style = MaterialTheme.typography.bodyLarge)
                    Text(
                        "Toplam ${formatCount(s.totalTaps)} dokunuş · ${formatCount(s.totalRuns)} çalıştırma\n" +
                            "İnternet izni yoktur; makroların yalnızca bu cihazda saklanır.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}
