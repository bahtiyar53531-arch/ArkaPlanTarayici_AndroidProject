package org.arkaplan.ototiklayici.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.BottomAppBar
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import org.arkaplan.ototiklayici.R
import org.arkaplan.ototiklayici.model.GestureAction
import org.arkaplan.ototiklayici.model.Macro
import org.arkaplan.ototiklayici.model.MacroAction
import org.arkaplan.ototiklayici.model.RunSettings
import org.arkaplan.ototiklayici.model.StopMode
import org.arkaplan.ototiklayici.model.SwipeAction
import org.arkaplan.ototiklayici.model.TapAction
import org.arkaplan.ototiklayici.model.actionDurationMs
import org.arkaplan.ototiklayici.overlay.formatDuration
import org.arkaplan.ototiklayici.service.PanelRequest
import kotlin.math.roundToInt

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MacroEditorScreen(
    vm: MainViewModel,
    macroId: String,
    snackbar: SnackbarHostState,
    onOpenPanel: (PanelRequest) -> Unit,
) {
    val macros by vm.macros.collectAsStateWithLifecycle()
    val source = macros.firstOrNull { it.id == macroId }
    var draft by remember(macroId) { mutableStateOf<Macro?>(null) }
    LaunchedEffect(source?.id) {
        if (draft == null && source != null) draft = source
    }
    var confirmLeave by remember { mutableStateOf(false) }
    var bulkDelay by remember { mutableStateOf(false) }

    val current = draft
    val dirty = current != null && source != null && current.copy(updatedAt = 0, runCount = 0, lastRunAt = 0) !=
        source.copy(updatedAt = 0, runCount = 0, lastRunAt = 0)

    BackHandler(enabled = dirty) { confirmLeave = true }

    fun save(then: (Macro) -> Unit = {}) {
        val d = draft ?: return
        vm.saveMacro(d.copy(name = d.name.ifBlank { "Adsız makro" })) { saved ->
            draft = saved
            vm.message("Kaydedildi")
            then(saved)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(current?.name?.ifBlank { "Adsız makro" } ?: "Makro", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = { if (dirty) confirmLeave = true else vm.back() }) { AppIcon(R.drawable.ic_back, "Geri") }
                },
                actions = {
                    IconButton(onClick = { save() }, enabled = dirty) { AppIcon(R.drawable.ic_check, "Kaydet") }
                },
            )
        },
        bottomBar = {
            if (current != null) {
                BottomAppBar {
                    Spacer(Modifier.width(8.dp))
                    Text(
                        "${current.actions.size} adım · ${cycleLabel(current)}",
                        style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f),
                    )
                    FilledTonalButton(onClick = { save() }, enabled = dirty) { Text("Kaydet") }
                    Spacer(Modifier.width(8.dp))
                    Button(onClick = {
                        if (dirty) save { onOpenPanel(PanelRequest.OpenMacro(it.id)) } else onOpenPanel(PanelRequest.OpenMacro(macroId))
                    }) {
                        AppIcon(R.drawable.ic_play, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Panelde aç")
                    }
                    Spacer(Modifier.width(8.dp))
                }
            }
        },
        snackbarHost = { SnackbarHost(snackbar) },
    ) { padding ->
        if (current == null) {
            Box(Modifier.fillMaxSize().padding(padding), contentAlignment = Alignment.Center) {
                if (macros.isEmpty()) CircularProgressIndicator() else Text("Makro bulunamadı")
            }
            return@Scaffold
        }
        LazyColumn(
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = padding.calculateTopPadding() + 8.dp, bottom = padding.calculateBottomPadding() + 24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            item {
                OutlinedTextField(
                    value = current.name,
                    onValueChange = { draft = current.copy(name = it.take(80)) },
                    label = { Text("Makro adı") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
            item {
                RunSettingsEditor(current.settings) { draft = current.copy(settings = it) }
            }
            item {
                if (current.screenWidth > 0) {
                    Text(
                        "Kaydedildiği ekran: ${current.screenWidth} × ${current.screenHeight} piksel",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 8.dp),
                    )
                }
            }
            item {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        "Adımlar (${current.actions.size})",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                        modifier = Modifier.weight(1f).padding(start = 8.dp),
                    )
                    TextButton(onClick = { bulkDelay = true }, enabled = current.actions.isNotEmpty()) { Text("Tüm beklemeler") }
                }
            }
            if (current.actions.isEmpty()) {
                item {
                    Text(
                        "Bu makroda adım yok. Panelde aç ve ＋ ile hedef ekle ya da ● ile kaydet.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 8.dp),
                    )
                }
            }
            itemsIndexed(current.actions, key = { _, a -> a.id }) { index, action ->
                ActionEditor(
                    index = index,
                    action = action,
                    isFirst = index == 0,
                    isLast = index == current.actions.lastIndex,
                    onChange = { updated ->
                        draft = current.copy(actions = current.actions.map { if (it.id == updated.id) updated else it })
                    },
                    onMove = { delta ->
                        val list = current.actions.toMutableList()
                        val target = (index + delta).coerceIn(0, list.lastIndex)
                        list.add(target, list.removeAt(index))
                        draft = current.copy(actions = list)
                    },
                    onDuplicate = {
                        val list = current.actions.toMutableList()
                        val newId = (list.maxOfOrNull { it.id } ?: 0L) + 1
                        list.add(index + 1, action.withId(newId))
                        draft = current.copy(actions = list)
                    },
                    onDelete = { draft = current.copy(actions = current.actions.filterNot { it.id == action.id }) },
                    modifier = Modifier.animateItem(),
                )
            }
        }
    }

    if (confirmLeave) {
        AlertDialog(
            onDismissRequest = { confirmLeave = false },
            title = { Text("Değişiklikler kaydedilsin mi?") },
            text = { Text("Kaydetmeden çıkarsan yaptığın değişiklikler kaybolur.") },
            confirmButton = {
                Button(onClick = { confirmLeave = false; save { vm.back() } }) { Text("Kaydet") }
            },
            dismissButton = {
                TextButton(onClick = { confirmLeave = false; draft = source; vm.back() }) { Text("Kaydetme") }
            },
        )
    }

    if (bulkDelay && current != null) {
        var value by remember { mutableLongStateOf(current.actions.firstOrNull()?.delayAfterMs ?: 100L) }
        AlertDialog(
            onDismissRequest = { bulkDelay = false },
            title = { Text("Tüm adımların beklemesi") },
            text = {
                Column {
                    Text("Her adımdan sonraki bekleme süresi aynı değere ayarlanır.", style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.size(12.dp))
                    NumberField("Bekleme", value, { value = it }, suffix = "ms", max = 86_400_000)
                }
            },
            confirmButton = {
                Button(onClick = {
                    draft = current.copy(actions = current.actions.map { it.withDelay(value) })
                    bulkDelay = false
                }) { Text("Uygula") }
            },
            dismissButton = { TextButton(onClick = { bulkDelay = false }) { Text("Vazgeç") } },
        )
    }
}

private fun cycleLabel(macro: Macro): String {
    val ms = macro.estimatedCycleMs()
    return if (ms < 1000) "$ms ms/tur" else "≈${formatDuration(ms)}/tur"
}

@Composable
fun RunSettingsEditor(settings: RunSettings, onChange: (RunSettings) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        SectionCard("Tekrar") {
            SegmentedChoice(
                options = listOf(StopMode.INFINITE to "Sonsuz", StopMode.CYCLES to "Tur sayısı", StopMode.TIME to "Süre"),
                selected = settings.stopMode,
                onSelect = { onChange(settings.copy(stopMode = it)) },
            )
            when (settings.stopMode) {
                StopMode.INFINITE -> Text(
                    "Sen durdurana kadar devam eder (■, ses tuşu veya ekranı kapatarak).",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                StopMode.CYCLES -> NumberField(
                    "Tur sayısı", settings.cycles.toLong(), { onChange(settings.copy(cycles = it.toInt())) },
                    min = 1, max = 10_000_000, suffix = "tur",
                )
                StopMode.TIME -> {
                    val total = settings.timeLimitSec
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        NumberField("Saat", (total / 3600).toLong(), { h ->
                            onChange(settings.copy(timeLimitSec = (h * 3600 + total % 3600).toInt().coerceAtLeast(1)))
                        }, Modifier.weight(1f), max = 240)
                        NumberField("Dakika", ((total % 3600) / 60).toLong(), { m ->
                            onChange(settings.copy(timeLimitSec = (total / 3600 * 3600 + m * 60 + total % 60).toInt().coerceAtLeast(1)))
                        }, Modifier.weight(1f), max = 59)
                        NumberField("Saniye", (total % 60).toLong(), { s ->
                            onChange(settings.copy(timeLimitSec = (total / 60 * 60 + s).toInt().coerceAtLeast(1)))
                        }, Modifier.weight(1f), max = 59)
                    }
                }
            }
            NumberField(
                "Başlamadan önce geri sayım", settings.startDelaySec.toLong(),
                { onChange(settings.copy(startDelaySec = it.toInt())) }, max = 3600, suffix = "sn",
            )
            NumberField(
                "Turlar arası bekleme", settings.cycleDelayMs,
                { onChange(settings.copy(cycleDelayMs = it)) }, max = 86_400_000, suffix = "ms",
            )
        }
        SectionCard("Hız") {
            SliderRow(
                title = "Oynatma hızı",
                value = settings.speed,
                onValueChange = { onChange(settings.copy(speed = (it * 20).roundToInt() / 20f)) },
                valueRange = 0.25f..4f,
                valueLabel = "%.2f×".format(settings.speed),
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(0.5f, 1f, 2f, 4f).forEach { v ->
                    FilterChip(
                        selected = settings.speed == v,
                        onClick = { onChange(settings.copy(speed = v)) },
                        label = { Text(if (v == 0.5f) "0,5×" else "${v.toInt()}×") },
                    )
                }
            }
            Text(
                "Hız; beklemeleri ve hareket sürelerini birlikte ölçekler. Kayıtlar 1× hızda gerçek zamanlamasıyla oynar.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        SectionCard("İnsan gibi davranış") {
            NumberField(
                "Rastgele gecikme ±", settings.randomDelayMs.toLong(),
                { onChange(settings.copy(randomDelayMs = it.toInt())) }, max = 60_000, suffix = "ms",
                supporting = "Her beklemeye rastgele eklenir/çıkarılır",
            )
            NumberField(
                "Rastgele konum sapması ±", settings.randomOffsetPx.toLong(),
                { onChange(settings.copy(randomOffsetPx = it.toInt())) }, max = 500, suffix = "px",
                supporting = "Her dokunuş hedefin etrafında rastgele bir noktaya düşer",
            )
            SwitchRow(
                "Ekran boyutuna göre oranla",
                settings.scaleToScreen,
                { onChange(settings.copy(scaleToScreen = it)) },
                subtitle = "Farklı çözünürlük veya yönde konumları orantılı uyarlar",
            )
        }
    }
}

@Composable
private fun ActionEditor(
    index: Int,
    action: MacroAction,
    isFirst: Boolean,
    isLast: Boolean,
    onChange: (MacroAction) -> Unit,
    onMove: (Int) -> Unit,
    onDuplicate: () -> Unit,
    onDelete: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val (icon, title) = when (action) {
        is TapAction -> R.drawable.ic_touch to when {
            action.count == 2 -> "Çift dokunma"
            action.count > 2 -> "${action.count}× dokunma"
            action.durationMs >= 500 -> "Uzun basma"
            else -> "Dokunma"
        }
        is SwipeAction -> R.drawable.ic_swipe to if (action.holdMs > 0) "Sürükle-bırak" else "Kaydırma"
        is GestureAction -> R.drawable.ic_gesture to if (action.strokes.size > 1) "${action.strokes.size} parmak hareket" else "Serbest hareket"
    }
    Surface(
        shape = MaterialTheme.shapes.extraLarge,
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        modifier = modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(start = 16.dp, end = 8.dp, top = 8.dp, bottom = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer) {
                    Box(Modifier.size(30.dp), contentAlignment = Alignment.Center) {
                        Text("${index + 1}", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                    }
                }
                Spacer(Modifier.width(10.dp))
                AppIcon(icon, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(6.dp))
                Column(Modifier.weight(1f)) {
                    Text(title, style = MaterialTheme.typography.titleSmall)
                    Text(
                        describe(action),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Switch(checked = action.enabled, onCheckedChange = { onChange(action.withEnabled(it)) })
            }
            Spacer(Modifier.size(8.dp))
            Column(Modifier.padding(end = 8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                when (action) {
                    is TapAction -> {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            NumberField("X", action.x.roundToInt().toLong(), { onChange(action.copy(x = it.toFloat())) }, Modifier.weight(1f), max = 20_000)
                            NumberField("Y", action.y.roundToInt().toLong(), { onChange(action.copy(y = it.toFloat())) }, Modifier.weight(1f), max = 20_000)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            NumberField("Basma", action.durationMs, { onChange(action.copy(durationMs = it)) }, Modifier.weight(1f), min = 1, max = 59_000, suffix = "ms")
                            NumberField("Tık sayısı", action.count.toLong(), { onChange(action.copy(count = it.toInt())) }, Modifier.weight(1f), min = 1, max = 10)
                        }
                        if (action.count > 1) {
                            NumberField("Tıklar arası", action.countGapMs, { onChange(action.copy(countGapMs = it)) }, min = 1, max = 5_000, suffix = "ms")
                        }
                    }
                    is SwipeAction -> {
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            NumberField("X₁", action.x1.roundToInt().toLong(), { onChange(action.copy(x1 = it.toFloat())) }, Modifier.weight(1f), max = 20_000)
                            NumberField("Y₁", action.y1.roundToInt().toLong(), { onChange(action.copy(y1 = it.toFloat())) }, Modifier.weight(1f), max = 20_000)
                            NumberField("X₂", action.x2.roundToInt().toLong(), { onChange(action.copy(x2 = it.toFloat())) }, Modifier.weight(1f), max = 20_000)
                            NumberField("Y₂", action.y2.roundToInt().toLong(), { onChange(action.copy(y2 = it.toFloat())) }, Modifier.weight(1f), max = 20_000)
                        }
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            NumberField("Süre", action.durationMs, { onChange(action.copy(durationMs = it)) }, Modifier.weight(1f), min = 1, max = 59_000, suffix = "ms")
                            NumberField("Basılı tut", action.holdMs, { onChange(action.copy(holdMs = it)) }, Modifier.weight(1f), max = 59_000, suffix = "ms")
                        }
                    }
                    is GestureAction -> Unit
                }
                NumberField(
                    "Sonraki adıma kadar bekleme", action.delayAfterMs,
                    { onChange(action.withDelay(it)) }, max = 86_400_000, suffix = "ms",
                )
            }
            Row(horizontalArrangement = Arrangement.End, modifier = Modifier.fillMaxWidth()) {
                IconButton(onClick = { onMove(-1) }, enabled = !isFirst) { AppIcon(R.drawable.ic_arrow_up, "Yukarı taşı") }
                IconButton(onClick = { onMove(1) }, enabled = !isLast) { AppIcon(R.drawable.ic_arrow_down, "Aşağı taşı") }
                IconButton(onClick = onDuplicate) { AppIcon(R.drawable.ic_copy, "Kopyala") }
                IconButton(onClick = onDelete) { AppIcon(R.drawable.ic_delete, "Sil") }
            }
        }
    }
}

private fun describe(action: MacroAction): String = when (action) {
    is TapAction -> "(${action.x.roundToInt()}, ${action.y.roundToInt()}) · ${action.durationMs} ms basma"
    is SwipeAction -> "(${action.x1.roundToInt()}, ${action.y1.roundToInt()}) → (${action.x2.roundToInt()}, ${action.y2.roundToInt()}) · ${action.durationMs} ms"
    is GestureAction -> {
        val first = action.strokes.firstOrNull()?.points?.firstOrNull()
        val start = first?.let { "(${it.x.roundToInt()}, ${it.y.roundToInt()}) başlangıç · " } ?: ""
        "$start${actionDurationMs(action)} ms · ${action.strokes.sumOf { it.points.size }} nokta"
    }
}
