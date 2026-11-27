package org.arkaplan.ototiklayici.ui

import android.text.format.DateUtils
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilledTonalIconButton
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.arkaplan.ototiklayici.R
import org.arkaplan.ototiklayici.model.GestureAction
import org.arkaplan.ototiklayici.model.Macro
import org.arkaplan.ototiklayici.model.StopMode
import org.arkaplan.ototiklayici.model.SwipeAction
import org.arkaplan.ototiklayici.model.TapAction
import org.arkaplan.ototiklayici.overlay.formatDuration
import org.arkaplan.ototiklayici.service.PanelRequest

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    vm: MainViewModel,
    snackbar: SnackbarHostState,
    onOpenPanel: (PanelRequest) -> Unit,
    onEnableService: () -> Unit,
    onAppInfo: () -> Unit,
) {
    val macros by vm.macros.collectAsStateWithLifecycle()
    val connected by vm.serviceConnected.collectAsStateWithLifecycle()
    val enabled by vm.serviceEnabled.collectAsStateWithLifecycle()
    val panelOpen by vm.panelOpen.collectAsStateWithLifecycle()
    val running by vm.running.collectAsStateWithLifecycle()
    val settings by vm.settings.collectAsStateWithLifecycle()

    var pendingDelete by remember { mutableStateOf<Macro?>(null) }
    var exportIds by remember { mutableStateOf<List<String>?>(null) }
    val exportLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) vm.exportTo(uri, exportIds)
    }
    val importLauncher = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) vm.importFrom(uri)
    }

    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    Scaffold(
        modifier = Modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = {
            LargeTopAppBar(
                title = { Text("Oto Tıklayıcı", fontWeight = FontWeight.Bold) },
                actions = {
                    IconButton(onClick = { vm.navigate(Screen.Help) }) { AppIcon(R.drawable.ic_help, "Yardım") }
                    IconButton(onClick = { vm.navigate(Screen.Settings) }) { AppIcon(R.drawable.ic_settings, "Ayarlar") }
                },
                scrollBehavior = scroll,
            )
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        LazyColumn(
            contentPadding = PaddingValues(
                start = 16.dp,
                end = 16.dp,
                top = padding.calculateTopPadding() + 4.dp,
                bottom = padding.calculateBottomPadding() + 24.dp,
            ),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            item {
                ServiceCard(
                    connected = connected,
                    enabled = enabled,
                    panelOpen = panelOpen,
                    running = running,
                    onEnable = onEnableService,
                    onAppInfo = onAppInfo,
                    onHelp = { vm.navigate(Screen.Help) },
                    onClosePanel = { vm.closePanel() },
                )
            }
            item { SectionTitle("Hızlı başlat") }
            item {
                ModeCard(
                    icon = R.drawable.ic_touch,
                    title = "Tek nokta",
                    text = "Tek bir hedefe belirlediğin aralıkla durmadan dokunur. En hızlı oto tıklama.",
                    accent = MaterialTheme.colorScheme.primary,
                    onClick = { onOpenPanel(PanelRequest.SingleTarget) },
                )
            }
            item {
                ModeCard(
                    icon = R.drawable.ic_targets,
                    title = "Çoklu nokta",
                    text = "Sıralı dokunma ve kaydırma hedefleri; her birinin kendi bekleme ve süresi.",
                    accent = MaterialTheme.colorScheme.tertiary,
                    onClick = { onOpenPanel(PanelRequest.MultiTarget) },
                )
            }
            item {
                ModeCard(
                    icon = R.drawable.ic_gesture,
                    title = "Kaydet & tekrarla",
                    text = "Ekranda yaptığın dokunma, kaydırma, sürükleme ve çoklu parmak hareketlerini zamanlamasıyla kaydeder, aynen tekrarlar.",
                    accent = Color(0xFFE5484D),
                    onClick = { onOpenPanel(PanelRequest.Record) },
                )
            }
            item {
                StatsRow(
                    macroCount = macros.size,
                    totalTaps = settings.totalTaps,
                    totalRuns = settings.totalRuns,
                )
            }
            item {
                Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
                    SectionTitle("Makrolarım", Modifier.weight(1f))
                    TextButton(onClick = { importLauncher.launch(arrayOf("application/json", "text/plain", "*/*")) }) {
                        AppIcon(R.drawable.ic_file_in, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("İçe aktar")
                    }
                }
            }
            if (macros.isEmpty()) {
                item { EmptyMacros() }
            }
            items(macros, key = { it.id }) { macro ->
                MacroCard(
                    macro = macro,
                    onOpen = { vm.navigate(Screen.Editor(macro.id)) },
                    onRun = { onOpenPanel(PanelRequest.OpenMacro(macro.id)) },
                    onDuplicate = { vm.duplicateMacro(macro.id) },
                    onExport = {
                        exportIds = listOf(macro.id)
                        exportLauncher.launch(fileNameFor(macro.name))
                    },
                    onDelete = { pendingDelete = macro },
                    modifier = Modifier.animateItem(),
                )
            }
        }
    }

    pendingDelete?.let { macro ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text("Makro silinsin mi?") },
            text = { Text("“${macro.name}” kalıcı olarak silinecek.") },
            confirmButton = {
                Button(onClick = { vm.deleteMacro(macro.id); pendingDelete = null }) { Text("Sil") }
            },
            dismissButton = { TextButton(onClick = { pendingDelete = null }) { Text("Vazgeç") } },
        )
    }
}

fun fileNameFor(name: String): String {
    val clean = name.replace(Regex("[^\\p{L}\\p{N}_ -]"), "").trim().ifEmpty { "makro" }
    return "$clean.json"
}

@Composable
private fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = MaterialTheme.typography.titleMedium,
        fontWeight = FontWeight.SemiBold,
        modifier = modifier.padding(top = 8.dp, start = 4.dp),
    )
}

@Composable
private fun ServiceCard(
    connected: Boolean,
    enabled: Boolean,
    panelOpen: Boolean,
    running: Boolean,
    onEnable: () -> Unit,
    onAppInfo: () -> Unit,
    onHelp: () -> Unit,
    onClosePanel: () -> Unit,
) {
    val scheme = MaterialTheme.colorScheme
    val ok = connected
    Card(
        colors = CardDefaults.cardColors(
            containerColor = if (ok) scheme.tertiaryContainer else scheme.errorContainer,
            contentColor = if (ok) scheme.onTertiaryContainer else scheme.onErrorContainer,
        ),
        shape = MaterialTheme.shapes.extraLarge,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                AppIcon(if (ok) R.drawable.ic_check_circle else R.drawable.ic_warning, modifier = Modifier.size(28.dp))
                Spacer(Modifier.width(12.dp))
                Column {
                    Text(
                        when {
                            !ok -> "Erişilebilirlik servisi kapalı"
                            running -> "Çalışıyor"
                            panelOpen -> "Panel ekranda"
                            else -> "Hazır"
                        },
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                    Text(
                        when {
                            !ok && enabled -> "Servis açık görünüyor ama bağlanmadı. Kapatıp yeniden açmayı dene."
                            !ok -> "Dokunuşları uygulayabilmek için Oto Tıklayıcı servisini açman gerekiyor."
                            panelOpen -> "Yüzen panel açık. Kapatmak için ✕ veya aşağıdaki düğme."
                            else -> "Bir mod seç; panel ekranda belirir, istediğin uygulamaya geç."
                        },
                        style = MaterialTheme.typography.bodyMedium,
                    )
                }
            }
            if (!ok) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = onEnable) { Text("Servisi aç") }
                    OutlinedButton(onClick = onHelp) { Text("Açılmıyor mu?") }
                }
                Text(
                    "Android 13 ve sonrası: “Kısıtlanmış ayar” uyarısı çıkarsa Uygulama bilgisi › ⋮ › “Kısıtlanmış ayarlara izin ver” seçeneğini aç.",
                    style = MaterialTheme.typography.bodySmall,
                )
                TextButton(onClick = onAppInfo, contentPadding = PaddingValues(0.dp)) { Text("Uygulama bilgisini aç") }
            } else if (panelOpen) {
                FilledTonalButton(onClick = onClosePanel) { Text("Paneli kapat") }
            }
        }
    }
}

@Composable
private fun ModeCard(icon: Int, title: String, text: String, accent: Color, onClick: () -> Unit) {
    Card(
        onClick = onClick,
        shape = MaterialTheme.shapes.extraLarge,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Row(Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = CircleShape, color = accent.copy(alpha = 0.16f), contentColor = accent) {
                Box(Modifier.size(52.dp), contentAlignment = Alignment.Center) {
                    AppIcon(icon, modifier = Modifier.size(28.dp))
                }
            }
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.width(8.dp))
            AppIcon(R.drawable.ic_play, modifier = Modifier.size(22.dp))
        }
    }
}

@Composable
private fun StatsRow(macroCount: Int, totalTaps: Long, totalRuns: Long) {
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxWidth()) {
        StatTile("Makro", macroCount.toString(), Modifier.weight(1f))
        StatTile("Toplam dokunuş", formatCount(totalTaps), Modifier.weight(1f))
        StatTile("Çalıştırma", formatCount(totalRuns), Modifier.weight(1f))
    }
}

@Composable
private fun StatTile(label: String, value: String, modifier: Modifier) {
    Surface(shape = MaterialTheme.shapes.large, color = MaterialTheme.colorScheme.secondaryContainer, modifier = modifier) {
        Column(Modifier.padding(horizontal = 12.dp, vertical = 10.dp)) {
            Text(value, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, maxLines = 1)
            Text(label, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

fun formatCount(n: Long): String = when {
    n >= 1_000_000_000 -> "%.1f Mr".format(n / 1_000_000_000.0)
    n >= 1_000_000 -> "%.1f Mn".format(n / 1_000_000.0)
    n >= 10_000 -> "%.1f B".format(n / 1_000.0)
    else -> n.toString()
}

@Composable
private fun EmptyMacros() {
    Surface(shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surfaceContainerLow, modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            AppIcon(R.drawable.ic_save, modifier = Modifier.size(36.dp))
            Spacer(Modifier.height(8.dp))
            Text("Henüz kayıtlı makro yok", style = MaterialTheme.typography.titleSmall)
            Text(
                "Paneldeki 💾 düğmesiyle hedeflerini veya kayıtlarını sakla; burada listelenir, düzenlenir ve paylaşılır.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

@Composable
private fun MacroCard(
    macro: Macro,
    onOpen: () -> Unit,
    onRun: () -> Unit,
    onDuplicate: () -> Unit,
    onExport: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var menu by remember { mutableStateOf(false) }
    val icon = when {
        macro.actions.any { it is GestureAction } -> R.drawable.ic_gesture
        macro.actions.size == 1 && macro.actions[0] is TapAction -> R.drawable.ic_touch
        macro.actions.any { it is SwipeAction } -> R.drawable.ic_swipe
        else -> R.drawable.ic_targets
    }
    Card(
        shape = MaterialTheme.shapes.extraLarge,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
        modifier = modifier.fillMaxWidth().clickable(onClick = onOpen),
    ) {
        Row(Modifier.padding(start = 16.dp, top = 12.dp, bottom = 12.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            AppIcon(icon, modifier = Modifier.size(26.dp))
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(macro.name, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(
                    macroSummary(macro),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 2,
                )
            }
            FilledTonalIconButton(onClick = onRun) { AppIcon(R.drawable.ic_play, "Panelde aç") }
            Box {
                IconButton(onClick = { menu = true }) { AppIcon(R.drawable.ic_more, "Diğer") }
                DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                    DropdownMenuItem(text = { Text("Düzenle") }, leadingIcon = { AppIcon(R.drawable.ic_edit) }, onClick = { menu = false; onOpen() })
                    DropdownMenuItem(text = { Text("Kopyala") }, leadingIcon = { AppIcon(R.drawable.ic_copy) }, onClick = { menu = false; onDuplicate() })
                    DropdownMenuItem(text = { Text("Dışa aktar") }, leadingIcon = { AppIcon(R.drawable.ic_file_out) }, onClick = { menu = false; onExport() })
                    DropdownMenuItem(text = { Text("Sil") }, leadingIcon = { AppIcon(R.drawable.ic_delete) }, onClick = { menu = false; onDelete() })
                }
            }
        }
    }
}

fun macroSummary(macro: Macro): String {
    val repeat = when (macro.settings.stopMode) {
        StopMode.INFINITE -> "sonsuz"
        StopMode.CYCLES -> "${macro.settings.cycles} tur"
        StopMode.TIME -> formatDuration(macro.settings.timeLimitSec * 1000L)
    }
    val cycle = macro.estimatedCycleMs()
    val cycleText = if (cycle < 1000) "${cycle} ms/tur" else "≈${formatDuration(cycle)}/tur"
    val parts = mutableListOf("${macro.actions.size} adım", repeat, cycleText)
    if (macro.settings.speed != 1f) parts += "${"%.2f".format(macro.settings.speed).trimEnd('0').trimEnd(',', '.')}×"
    val last = if (macro.lastRunAt > 0) {
        "Son: " + DateUtils.getRelativeTimeSpanString(macro.lastRunAt, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS) +
            " · ${macro.runCount} kez"
    } else "Henüz çalıştırılmadı"
    return parts.joinToString(" · ") + "\n" + last
}
