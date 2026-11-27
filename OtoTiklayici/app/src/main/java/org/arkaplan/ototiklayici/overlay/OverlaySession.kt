package org.arkaplan.ototiklayici.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.view.ContextThemeWrapper
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.widget.Toast
import kotlinx.coroutines.Job
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.arkaplan.ototiklayici.MainActivity
import org.arkaplan.ototiklayici.R
import org.arkaplan.ototiklayici.data.AppSettings
import org.arkaplan.ototiklayici.data.MacroRepository
import org.arkaplan.ototiklayici.engine.ActionTransformer
import org.arkaplan.ototiklayici.engine.FinishReason
import org.arkaplan.ototiklayici.engine.GesturePlanner
import org.arkaplan.ototiklayici.engine.MacroPlayer
import org.arkaplan.ototiklayici.engine.PlannerConfig
import org.arkaplan.ototiklayici.engine.PlayerState
import org.arkaplan.ototiklayici.engine.RecordedGesture
import org.arkaplan.ototiklayici.engine.RecordingConverter
import org.arkaplan.ototiklayici.engine.TouchRecorder
import org.arkaplan.ototiklayici.model.GestureAction
import org.arkaplan.ototiklayici.model.Macro
import org.arkaplan.ototiklayici.model.MacroAction
import org.arkaplan.ototiklayici.model.Point
import org.arkaplan.ototiklayici.model.RunSettings
import org.arkaplan.ototiklayici.model.StopMode
import org.arkaplan.ototiklayici.model.SwipeAction
import org.arkaplan.ototiklayici.model.TapAction
import org.arkaplan.ototiklayici.otoApp
import org.arkaplan.ototiklayici.service.AccessibilityGestureExecutor
import org.arkaplan.ototiklayici.service.PanelRequest
import org.arkaplan.ototiklayici.service.ServiceBridge
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Yüzen panel oturumu: düzenlenen makro, ekrandaki tüm overlay pencereleri,
 * oynatıcı ve kaydedici burada bir araya gelir. Yalnızca ana iş parçacığında kullanılır.
 */
class OverlaySession(private val service: android.accessibilityservice.AccessibilityService) {

    private val ctx: Context = ContextThemeWrapper(service, android.R.style.Theme_DeviceDefault)
    private val wm: WindowManager = service.getSystemService(WindowManager::class.java)
    private val app = service.otoApp
    private val scope = MainScope()
    private val executor = AccessibilityGestureExecutor(service)
    private val player = MacroPlayer(scope, executor) { SystemClock.elapsedRealtime() }
    private val dialog = OverlayDialog(ctx, wm)
    private val settings: AppSettings get() = app.settings.settings.value

    // ---- Düzenlenen makro ----
    private var macroId: String? = null
    private var macroName = ""
    private var createdAt = 0L
    private var runCount = 0
    private var lastRunAt = 0L
    private var runSettings = RunSettings()
    private val actions = mutableListOf<MacroAction>()
    private var dirty = false
    private var idCounter = System.currentTimeMillis()

    // ---- Pencereler ----
    private var panel: PanelView? = null
    private var panelParams: WindowManager.LayoutParams? = null
    private var canvas: CanvasLayerView? = null
    private val markers = LinkedHashMap<Long, MarkerSet>()
    private var recordLayer: RecordLayerView? = null
    private var recordParams: WindowManager.LayoutParams? = null
    private val recordedGestures = mutableListOf<RecordedGesture>()
    private var forwardJob: Job? = null
    private var tickerJob: Job? = null

    private var targetsVisible = true
    private var screen = ctx.realScreenSize()
    private var lastForegroundPackage: String? = null
    private var runPackage: String? = null

    private class MarkerWindow(val view: TargetMarkerView, val params: WindowManager.LayoutParams)
    private class MarkerSet(val start: MarkerWindow, val end: MarkerWindow?)

    val isOpen: Boolean get() = panel != null
    val isRunning: Boolean get() = player.isActive

    init {
        player.onBeforeAction = { action -> showTouchFeedback(action) }
        player.onFinished = { finished -> onPlaybackFinished(finished) }
        scope.launch { player.state.collect { renderStatus() } }
    }

    // =====================================================================
    // Açma / kapama
    // =====================================================================

    fun open(request: PanelRequest) {
        if (isOpen && isRecording) stopRecording()
        if (isOpen && dirty && actions.isNotEmpty()) {
            // Kaydedilmemiş adımlar varken sormadan yeni oturuma geçme (oynatma sürüyor olsa bile).
            if (isRunning) player.stop()
            confirmUnsaved(onContinue = { openNow(request) })
            return
        }
        openNow(request)
    }

    private fun openNow(request: PanelRequest) {
        player.stop()
        removeAllWindows()
        screen = ctx.realScreenSize()
        when (request) {
            PanelRequest.SingleTarget -> {
                newSession("Tek nokta")
                actions += newTap(screen.x / 2f, screen.y / 2f)
            }
            PanelRequest.MultiTarget -> {
                newSession("Çoklu nokta")
                toast("＋ ile hedef ekle, sürükleyerek yerleştir. Hedefe dokunarak ayarla.")
            }
            PanelRequest.Record -> {
                newSession("Kayıt")
                toast("Hazır olduğunda kırmızı ● ile kaydı başlat. Yaptığın her şey kaydedilir.")
            }
            PanelRequest.Resume -> {
                // Bellekteki son oturumu (kapatılmış olsa bile) geri getir.
                if (actions.isEmpty() && macroId == null) newSession("Çoklu nokta")
            }
            is PanelRequest.OpenMacro -> {
                val macro = app.macros.get(request.macroId)
                if (macro == null) {
                    toast("Makro bulunamadı")
                    ServiceBridge.setPanelOpen(false)
                    return
                }
                loadMacro(macro)
            }
        }
        showWindows()
        ServiceBridge.setPanelOpen(true)
        if (request is PanelRequest.OpenMacro && request.autoStart) panel?.post { play() }
    }

    fun close() {
        if (isRunning) player.stop()
        if (isRecording) stopRecording()
        if (dirty && actions.isNotEmpty()) {
            confirmUnsaved(onContinue = { closeNow() })
        } else {
            closeNow()
        }
    }

    fun closeNow() {
        player.stop()
        forwardJob?.cancel()
        removeAllWindows()
        ServiceBridge.setPanelOpen(false)
        ServiceBridge.setRunning(false)
    }

    fun destroy() {
        closeNow()
        scope.cancel()
    }

    private fun newSession(name: String) {
        macroId = null
        macroName = name
        createdAt = 0
        runCount = 0
        lastRunAt = 0
        val s = settings
        runSettings = RunSettings(randomDelayMs = s.defaultRandomDelayMs, randomOffsetPx = s.defaultRandomOffsetPx)
        actions.clear()
        dirty = false
    }

    private fun loadMacro(macro: Macro) {
        macroId = macro.id
        macroName = macro.name
        createdAt = macro.createdAt
        runCount = macro.runCount
        lastRunAt = macro.lastRunAt
        runSettings = macro.settings
        actions.clear()
        // Farklı ekran boyutunda kaydedildiyse koordinatları bu ekrana uyarla.
        val needsScale = macro.settings.scaleToScreen && macro.screenWidth > 0 && macro.screenHeight > 0 &&
            (macro.screenWidth != screen.x || macro.screenHeight != screen.y)
        val transformer = if (needsScale) {
            ActionTransformer(screen.x.toFloat() / macro.screenWidth, screen.y.toFloat() / macro.screenHeight, 1f, 0, 0)
        } else null
        macro.actions.forEach { actions += transformer?.transform(it) ?: it }
        idCounter = max(idCounter, (actions.maxOfOrNull { it.id } ?: 0L) + 1)
        dirty = false
    }

    private fun buildMacro(): Macro = Macro(
        id = macroId ?: MacroRepository.newId(),
        name = macroName,
        actions = actions.toList(),
        settings = runSettings,
        screenWidth = screen.x,
        screenHeight = screen.y,
        createdAt = createdAt,
        runCount = runCount,
        lastRunAt = lastRunAt,
    )

    private fun nextId(): Long = ++idCounter

    private fun newTap(x: Float, y: Float) = TapAction(
        id = nextId(),
        x = x,
        y = y,
        durationMs = settings.defaultTapDurationMs,
        delayAfterMs = settings.defaultIntervalMs,
    )

    // =====================================================================
    // Pencereler
    // =====================================================================

    private fun showWindows() {
        val layer = CanvasLayerView(ctx)
        val layerParams = overlayParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            touchable = false,
        )
        if (addWindow(layer, layerParams)) canvas = layer
        rebuildMarkers()
        createPanel()
        renderStatus()
    }

    private fun addWindow(view: View, params: WindowManager.LayoutParams): Boolean = try {
        wm.addView(view, params)
        true
    } catch (e: RuntimeException) {
        false
    }

    private fun removeWindow(view: View?) {
        if (view == null) return
        runCatching { wm.removeView(view) }
    }

    private fun updateWindow(view: View?, params: WindowManager.LayoutParams?) {
        if (view == null || params == null || !view.isAttachedToWindow) return
        runCatching { wm.updateViewLayout(view, params) }
    }

    private fun removeAllWindows() {
        dialog.dismiss()
        stopTicker()
        recordLayer?.let { removeWindow(it) }
        recordLayer = null
        markers.values.forEach {
            removeWindow(it.start.view)
            removeWindow(it.end?.view)
        }
        markers.clear()
        removeWindow(canvas)
        canvas = null
        removeWindow(panel)
        panel = null
        panelParams = null
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun createPanel() {
        val s = settings
        val view = PanelView(ctx, s.panelOrientation, s.panelScale)
        view.alpha = s.panelOpacity.coerceIn(0.3f, 1f)
        val params = overlayParams(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT)
        if (s.panelX >= 0 && s.panelY >= 0) {
            params.x = s.panelX
            params.y = s.panelY
        } else {
            params.x = ctx.dpi(8f)
            params.y = (screen.y * 0.22f).roundToInt()
        }
        clampPanel(view, params)

        view.play.setOnClickListener { if (isRunning) stop() else play() }
        view.record.setOnClickListener { if (isRecording) stopRecording() else startRecording() }
        view.addTap.setOnClickListener { addTapTarget() }
        view.addSwipe.setOnClickListener { addSwipeTarget() }
        view.undo.setOnClickListener { removeLast() }
        view.undo.setOnLongClickListener { confirmClearAll(); true }
        view.eye.setOnClickListener { setTargetsVisible(!targetsVisible) }
        view.tune.setOnClickListener { showRunSettings() }
        view.save.setOnClickListener { save(asNew = false) }
        view.save.setOnLongClickListener { save(asNew = true); true }
        view.close.setOnClickListener { close() }
        attachPanelDrag(view, params)

        if (addWindow(view, params)) {
            panel = view
            panelParams = params
        }
        renderPanel()
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun attachPanelDrag(view: PanelView, params: WindowManager.LayoutParams) {
        val slop = ViewConfiguration.get(ctx).scaledTouchSlop
        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        var dragging = false
        view.handle.setOnTouchListener { v, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX
                    downY = e.rawY
                    startX = params.x
                    startY = params.y
                    dragging = false
                    v.isPressed = true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downX
                    val dy = e.rawY - downY
                    if (!dragging && (abs(dx) > slop || abs(dy) > slop)) dragging = true
                    if (dragging) {
                        params.x = startX + dx.roundToInt()
                        params.y = startY + dy.roundToInt()
                        clampPanel(view, params)
                        updateWindow(view, params)
                    }
                }
                MotionEvent.ACTION_UP -> {
                    v.isPressed = false
                    if (dragging) {
                        scope.launch { app.settings.savePanelPosition(params.x, params.y) }
                    } else {
                        view.collapsed = !view.collapsed
                        view.post { clampPanel(view, params); updateWindow(view, params) }
                    }
                }
                MotionEvent.ACTION_CANCEL -> v.isPressed = false
            }
            true
        }
    }

    private fun clampPanel(view: View, params: WindowManager.LayoutParams) {
        val w = if (view.width > 0) view.width else ctx.dpi(56f)
        val h = if (view.height > 0) view.height else ctx.dpi(200f)
        params.x = params.x.coerceIn(0, max(0, screen.x - w))
        params.y = params.y.coerceIn(0, max(0, screen.y - h))
    }

    private fun bringPanelToFront() {
        val view = panel ?: return
        val params = panelParams ?: return
        removeWindow(view)
        addWindow(view, params)
    }

    fun onConfigurationChanged() {
        if (!isOpen) return
        screen = ctx.realScreenSize()
        panel?.let { p -> panelParams?.let { clampPanel(p, it); updateWindow(p, it) } }
        canvas?.invalidate()
    }

    // =====================================================================
    // Hedef işaretleri
    // =====================================================================

    private val targetSizePx: Int get() = ctx.dpi(settings.targetSizeDp.toFloat().coerceIn(28f, 96f))

    private fun rebuildMarkers() {
        markers.values.forEach {
            removeWindow(it.start.view)
            removeWindow(it.end?.view)
        }
        markers.clear()
        var windows = 0
        actions.forEachIndexed { index, action ->
            when (action) {
                is TapAction -> if (windows < MAX_MARKER_WINDOWS) {
                    addTapMarker(action, index)
                    windows++
                }
                is SwipeAction -> if (windows + 2 <= MAX_MARKER_WINDOWS) {
                    addSwipeMarkers(action, index)
                    windows += 2
                }
                is GestureAction -> Unit
            }
        }
        applyMarkerState()
        refreshGuides()
        bringPanelToFront()
    }

    private fun markerColor(action: MacroAction, base: Int) = if (action.enabled) base else 0xFF6B7280.toInt()

    private fun createMarker(cx: Float, cy: Float, color: Int, label: String, hollow: Boolean): MarkerWindow {
        val size = targetSizePx
        val view = TargetMarkerView(ctx, color, label, hollow)
        view.alpha = settings.targetOpacity.coerceIn(0.2f, 1f)
        val params = overlayParams(size, size).apply {
            x = (cx - size / 2f).roundToInt()
            y = (cy - size / 2f).roundToInt()
        }
        addWindow(view, params)
        return MarkerWindow(view, params)
    }

    private fun markerCenter(w: MarkerWindow): Point {
        val size = w.params.width
        return Point(w.params.x + size / 2f, w.params.y + size / 2f)
    }

    private fun addTapMarker(action: TapAction, index: Int) {
        val label = (index + 1).toString() + if (action.count > 1) "×${action.count}" else ""
        val w = createMarker(action.x, action.y, markerColor(action, OverlayColors.TAP), label, hollow = false)
        bindDrag(w, action.id, isEnd = false)
        markers[action.id] = MarkerSet(w, null)
    }

    private fun addSwipeMarkers(action: SwipeAction, index: Int) {
        val label = (index + 1).toString()
        val start = createMarker(action.x1, action.y1, markerColor(action, OverlayColors.SWIPE_START), label, hollow = false)
        val end = createMarker(action.x2, action.y2, markerColor(action, OverlayColors.SWIPE_END), "", hollow = true)
        bindDrag(start, action.id, isEnd = false)
        bindDrag(end, action.id, isEnd = true)
        markers[action.id] = MarkerSet(start, end)
    }

    private fun bindDrag(w: MarkerWindow, actionId: Long, isEnd: Boolean) {
        var startX = 0
        var startY = 0
        w.view.onDragStart = {
            startX = w.params.x
            startY = w.params.y
        }
        w.view.onDrag = { dx, dy ->
            val size = w.params.width
            w.params.x = (startX + dx.roundToInt()).coerceIn(-size / 2, screen.x - size / 2)
            w.params.y = (startY + dy.roundToInt()).coerceIn(-size / 2, screen.y - size / 2)
            updateWindow(w.view, w.params)
            syncActionFromMarker(actionId, isEnd, w)
        }
        w.view.onDragEnd = {
            syncActionFromMarker(actionId, isEnd, w)
            dirty = true
        }
        w.view.onClick = { editAction(actionId) }
    }

    private fun syncActionFromMarker(actionId: Long, isEnd: Boolean, w: MarkerWindow) {
        val index = actions.indexOfFirst { it.id == actionId }
        if (index < 0) return
        val c = markerCenter(w)
        actions[index] = when (val a = actions[index]) {
            is TapAction -> a.copy(x = c.x, y = c.y)
            is SwipeAction -> if (isEnd) a.copy(x2 = c.x, y2 = c.y) else a.copy(x1 = c.x, y1 = c.y)
            is GestureAction -> a
        }
        if (actions[index] is SwipeAction) refreshGuides()
    }

    /** Kaydırma okları, kayıtlı hareket izleri ve pencereye dönüşmeyen hedefleri çizim katmanına aktarır. */
    private fun refreshGuides() {
        val layer = canvas ?: return
        val arrows = mutableListOf<CanvasLayerView.Arrow>()
        val trails = mutableListOf<CanvasLayerView.Trail>()
        val dots = mutableListOf<CanvasLayerView.Dot>()
        actions.forEachIndexed { index, a ->
            val label = (index + 1).toString()
            when (a) {
                is SwipeAction -> arrows += CanvasLayerView.Arrow(
                    Point(a.x1, a.y1), Point(a.x2, a.y2), markerColor(a, OverlayColors.SWIPE_END),
                )
                is GestureAction -> a.strokes.forEachIndexed { si, stroke ->
                    trails += CanvasLayerView.Trail(
                        stroke.points.map { Point(it.x, it.y) },
                        markerColor(a, OverlayColors.GESTURE),
                        if (si == 0) label else "",
                    )
                    if (stroke.points.size == 1) {
                        dots += CanvasLayerView.Dot(Point(stroke.points[0].x, stroke.points[0].y), markerColor(a, OverlayColors.GESTURE), if (si == 0) label else "")
                    }
                }
                is TapAction -> if (a.id !in markers) {
                    dots += CanvasLayerView.Dot(Point(a.x, a.y), markerColor(a, OverlayColors.TAP), label)
                }
            }
        }
        layer.arrows = arrows
        layer.trails = trails
        layer.dots = dots
    }

    /** Oynatma sırasında hedefler dokunulamaz olmalı; yoksa enjekte edilen dokunuşu kendileri yakalar. */
    private fun applyMarkerState() {
        val running = isRunning
        val s = settings
        val baseAlpha = s.targetOpacity.coerceIn(0.2f, 1f)
        val alpha = if (running && s.dimTargetsWhileRunning) baseAlpha * 0.35f else baseAlpha
        markers.values.forEach { set ->
            listOfNotNull(set.start, set.end).forEach { w ->
                val touchable = !running && targetsVisible && !isRecording
                w.params.setTouchable(touchable)
                updateWindow(w.view, w.params)
                w.view.visibility = if (targetsVisible) View.VISIBLE else View.INVISIBLE
                w.view.alpha = alpha
            }
        }
        canvas?.guidesVisible = targetsVisible
        canvas?.guidesAlpha = if (running && s.dimTargetsWhileRunning) 0.35f else 1f
    }

    private fun setTargetsVisible(visible: Boolean) {
        targetsVisible = visible
        applyMarkerState()
        renderPanel()
    }

    // =====================================================================
    // Düzenleme
    // =====================================================================

    private fun addTapTarget() {
        if (isRunning || isRecording) return
        val n = actions.size
        val step = ctx.dp(34f)
        val x = (screen.x / 2f + ((n % 5) - 2) * step).coerceIn(step, screen.x - step)
        val y = (screen.y / 2f + ((n / 5) % 5 - 2) * step).coerceIn(step, screen.y - step)
        val tap = newTap(x, y)
        actions += tap
        dirty = true
        if (!targetsVisible) setTargetsVisible(true)
        if (markers.size < MAX_MARKER_WINDOWS) addTapMarker(tap, actions.lastIndex)
        applyMarkerState()
        refreshGuides()
        bringPanelToFront()
        renderStatus()
    }

    private fun addSwipeTarget() {
        if (isRunning || isRecording) return
        val cy = screen.y / 2f + ((actions.size % 4) - 1.5f) * ctx.dp(40f)
        val swipe = SwipeAction(
            id = nextId(),
            x1 = screen.x * 0.25f,
            y1 = cy,
            x2 = screen.x * 0.75f,
            y2 = cy,
            durationMs = settings.defaultSwipeDurationMs,
            delayAfterMs = max(settings.defaultIntervalMs, 300L),
        )
        actions += swipe
        dirty = true
        if (!targetsVisible) setTargetsVisible(true)
        if (markers.size + 2 <= MAX_MARKER_WINDOWS) addSwipeMarkers(swipe, actions.lastIndex)
        applyMarkerState()
        refreshGuides()
        bringPanelToFront()
        renderStatus()
    }

    private fun removeLast() {
        if (isRunning || isRecording || actions.isEmpty()) return
        val removed = actions.removeAt(actions.lastIndex)
        markers.remove(removed.id)?.let {
            removeWindow(it.start.view)
            removeWindow(it.end?.view)
        }
        dirty = true
        refreshGuides()
        renderStatus()
    }

    private fun confirmClearAll() {
        if (isRunning || isRecording || actions.isEmpty()) return
        dialog.show("Tüm adımlar silinsin mi?") {
            message("${actions.size} adımın hepsi bu panelden kaldırılacak. Kaydetmediğin sürece kayıtlı makro değişmez.")
            button("İptal")
            button("Hepsini sil", OverlayDialog.Style.DANGER) {
                actions.clear()
                dirty = true
                rebuildMarkers()
                renderStatus()
                true
            }
        }
    }

    private fun replaceAction(updated: MacroAction) {
        val index = actions.indexOfFirst { it.id == updated.id }
        if (index >= 0) actions[index] = updated
        dirty = true
    }

    private fun editAction(actionId: Long) {
        if (isRunning || isRecording) return
        val index = actions.indexOfFirst { it.id == actionId }
        if (index < 0) return
        when (val a = actions[index]) {
            is TapAction -> dialog.show("${index + 1}. adım · Dokunma") {
                val delay = number("Sonraki adıma kadar bekleme (ms)", a.delayAfterMs, 0, 86_400_000)
                val duration = number("Basılı tutma süresi (ms) — uzun basma için artır", a.durationMs, 1, 59_000)
                val count = number("Art arda tık sayısı (1 = tek, 2 = çift tık…)", a.count.toLong(), 1, 10)
                val gap = number("Art arda tıklar arası (ms)", a.countGapMs, 1, 5_000)
                val enabled = switch("Bu adım etkin", a.enabled)
                button("Sil", OverlayDialog.Style.DANGER) { deleteAction(a.id); true }
                button("Kopyala") { duplicateAction(a.id); true }
                spacer()
                button("İptal")
                button("Tamam", OverlayDialog.Style.PRIMARY) {
                    replaceAction(
                        a.copy(
                            delayAfterMs = delay(),
                            durationMs = duration(),
                            count = count().toInt(),
                            countGapMs = gap(),
                            enabled = enabled(),
                        )
                    )
                    rebuildMarkers()
                    true
                }
            }
            is SwipeAction -> dialog.show("${index + 1}. adım · Kaydırma") {
                val delay = number("Sonraki adıma kadar bekleme (ms)", a.delayAfterMs, 0, 86_400_000)
                val duration = number("Kaydırma süresi (ms) — kısa = hızlı fırlatma", a.durationMs, 1, 59_000)
                val hold = number("Başta basılı tutma (ms) — sürükle-bırak için", a.holdMs, 0, 59_000)
                val enabled = switch("Bu adım etkin", a.enabled)
                button("Sil", OverlayDialog.Style.DANGER) { deleteAction(a.id); true }
                button("Ters çevir") {
                    replaceAction(a.copy(x1 = a.x2, y1 = a.y2, x2 = a.x1, y2 = a.y1))
                    rebuildMarkers()
                    true
                }
                spacer()
                button("İptal")
                button("Tamam", OverlayDialog.Style.PRIMARY) {
                    replaceAction(a.copy(delayAfterMs = delay(), durationMs = duration(), holdMs = hold(), enabled = enabled()))
                    rebuildMarkers()
                    true
                }
            }
            is GestureAction -> Unit
        }
    }

    private fun deleteAction(id: Long) {
        actions.removeAll { it.id == id }
        dirty = true
        rebuildMarkers()
        renderStatus()
    }

    private fun duplicateAction(id: Long) {
        val index = actions.indexOfFirst { it.id == id }
        if (index < 0) return
        val offset = ctx.dp(30f)
        val copy = when (val a = actions[index]) {
            is TapAction -> a.copy(id = nextId(), x = (a.x + offset).coerceAtMost(screen.x - 1f), y = (a.y + offset).coerceAtMost(screen.y - 1f))
            is SwipeAction -> a.copy(id = nextId(), y1 = a.y1 + offset, y2 = a.y2 + offset)
            is GestureAction -> a.copy(id = nextId())
        }
        actions.add(index + 1, copy)
        dirty = true
        rebuildMarkers()
        renderStatus()
    }

    private fun showRunSettings() {
        if (isRunning || isRecording) return
        val r = runSettings
        dialog.show("Çalıştırma ayarları") {
            val mode = choice("Tekrar", listOf("Sonsuz", "Tur sayısı", "Süre"), r.stopMode.ordinal)
            val cycles = number("Tur sayısı", r.cycles.toLong(), 1, 10_000_000)
            val time = number("Süre (saniye)", r.timeLimitSec.toLong(), 1, 864_000)
            val speed = number("Hız (%) — 100 normal, 200 iki kat hızlı", (r.speed * 100).roundToInt().toLong(), 10, 1000)
            val start = number("Başlamadan önce geri sayım (sn)", r.startDelaySec.toLong(), 0, 3600)
            val cycleDelay = number("Turlar arası bekleme (ms)", r.cycleDelayMs, 0, 86_400_000)
            val jitterDelay = number("Rastgele gecikme ± (ms) — insan gibi", r.randomDelayMs.toLong(), 0, 60_000)
            val jitterPos = number("Rastgele konum sapması ± (piksel)", r.randomOffsetPx.toLong(), 0, 500)
            val allDelay = optionalNumber("Tüm adımların beklemesini ayarla (ms)", 0, 86_400_000, "Boş bırak = değiştirme")
            val scale = switch("Farklı ekran boyutunda konumları oranla", r.scaleToScreen)
            fun apply() {
                runSettings = r.copy(
                    stopMode = StopMode.entries[mode()],
                    cycles = cycles().toInt(),
                    timeLimitSec = time().toInt(),
                    speed = speed() / 100f,
                    startDelaySec = start().toInt(),
                    cycleDelayMs = cycleDelay(),
                    randomDelayMs = jitterDelay().toInt(),
                    randomOffsetPx = jitterPos().toInt(),
                    scaleToScreen = scale(),
                )
                allDelay()?.let { d -> actions.replaceAll { it.withDelay(d) } }
                if (runSettings != r || allDelay() != null) dirty = true
                renderStatus()
            }
            button("Gelişmiş") {
                apply()
                openInApp()
                true
            }
            spacer()
            button("İptal")
            button("Uygula", OverlayDialog.Style.PRIMARY) {
                apply()
                true
            }
        }
    }

    // =====================================================================
    // Kaydetme
    // =====================================================================

    private fun defaultName(): String {
        val stamp = SimpleDateFormat("d MMM HH:mm", Locale.forLanguageTag("tr")).format(Date())
        return "$macroName · $stamp"
    }

    private fun save(asNew: Boolean) {
        if (isRunning || isRecording) return
        if (actions.isEmpty()) {
            toast("Kaydedilecek adım yok")
            return
        }
        if (macroId != null && !asNew) {
            persist(macroName, asNew = false)
            return
        }
        dialog.show(if (asNew) "Farklı kaydet" else "Makroyu kaydet") {
            val name = text("Ad", if (macroId == null) defaultName() else "$macroName (kopya)")
            button("İptal")
            button("Kaydet", OverlayDialog.Style.PRIMARY) {
                persist(name().ifBlank { defaultName() }, asNew = true)
                true
            }
        }
    }

    private fun persist(name: String, asNew: Boolean, then: (() -> Unit)? = null) {
        val base = buildMacro()
        val macro = if (asNew) {
            base.copy(id = MacroRepository.newId(), name = name, createdAt = 0, runCount = 0, lastRunAt = 0)
        } else base.copy(name = name)
        scope.launch {
            val saved = app.macros.save(macro)
            macroId = saved.id
            macroName = saved.name
            createdAt = saved.createdAt
            dirty = false
            toast("“${saved.name}” kaydedildi")
            then?.invoke()
        }
    }

    private fun confirmUnsaved(onContinue: () -> Unit) {
        dialog.show("Kaydedilmemiş değişiklikler") {
            message("Paneldeki ${actions.size} adım henüz kaydedilmedi.")
            button("Atma", OverlayDialog.Style.DANGER) {
                dirty = false
                actions.clear()
                macroId = null
                onContinue()
                false
            }
            spacer()
            button("İptal")
            button("Kaydet", OverlayDialog.Style.PRIMARY) {
                persist(if (macroId == null) defaultName() else macroName, asNew = macroId == null) { onContinue() }
                true
            }
        }
    }

    /** Makroyu kaydedip uygulamadaki gelişmiş düzenleyicide açar. */
    private fun openInApp() {
        val launch: (String) -> Unit = { id ->
            closeNow()
            val intent = Intent(service, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                putExtra(MainActivity.EXTRA_EDIT_MACRO, id)
            }
            service.startActivity(intent)
        }
        if (actions.isEmpty() && macroId == null) {
            toast("Önce en az bir adım ekle")
            return
        }
        if (macroId != null && !dirty) {
            launch(macroId!!)
        } else {
            persist(if (macroId == null) defaultName() else macroName, asNew = macroId == null) {
                macroId?.let(launch)
            }
        }
    }

    // =====================================================================
    // Oynatma
    // =====================================================================

    private fun plannerConfig() = PlannerConfig(
        screenWidth = screen.x,
        screenHeight = screen.y,
        maxStrokes = AccessibilityGestureExecutor.maxStrokes.coerceIn(1, 20),
        maxDurationMs = AccessibilityGestureExecutor.maxDurationMs,
        precise = settings.preciseReplay,
    )

    fun play() {
        if (isRunning) return
        if (isRecording) stopRecording()
        if (actions.none { it.enabled }) {
            toast("Önce bir hedef ekle veya hareket kaydet")
            return
        }
        dialog.dismiss()
        val macro = buildMacro()
        runPackage = lastForegroundPackage
        warnIfUnderPanel()
        // Koordinatlar zaten bu ekrana göre; yalnızca hız ve rastgelelik uygulanır.
        val transformer = ActionTransformer(
            1f, 1f, runSettings.speed, runSettings.randomOffsetPx, runSettings.randomDelayMs,
        )
        player.start(macro, plannerConfig(), transformer, warmupMs = PLAY_WARMUP_MS)
        ServiceBridge.setRunning(true)
        vibrate(35)
        if (settings.collapsePanelWhileRunning) panel?.collapsed = true
        panelParams?.let { it.setKeepScreenOn(settings.keepScreenOn); updateWindow(panel, it) }
        applyMarkerState()
        renderPanel()
        startTicker()
    }

    fun stop() {
        if (!isRunning) return
        player.stop()
    }

    private fun onPlaybackFinished(f: PlayerState.Finished) {
        ServiceBridge.setRunning(false)
        stopTicker()
        canvas?.countdown = null
        panelParams?.let { it.setKeepScreenOn(false); updateWindow(panel, it) }
        if (settings.collapsePanelWhileRunning) panel?.collapsed = false
        applyMarkerState()
        renderPanel()
        renderStatus()
        vibrate(60)
        when (f.reason) {
            FinishReason.COMPLETED -> toast("Tamamlandı: ${f.cycles} tur, ${f.taps} dokunuş")
            FinishReason.TIME_LIMIT -> toast("Süre doldu: ${f.taps} dokunuş")
            FinishReason.ERROR -> toast("Sistem hareketi kabul etmedi. Erişilebilirlik servisini kapatıp açmayı dene.")
            FinishReason.STOPPED -> Unit
        }
        val id = macroId
        scope.launch {
            if (f.taps > 0 || f.cycles > 0) app.settings.addStats(f.taps)
            if (id != null && !dirty) app.macros.markRun(id)
        }
    }

    private fun showTouchFeedback(action: MacroAction) {
        if (!settings.showTouchFeedback) return
        val layer = canvas ?: return
        when (action) {
            is TapAction -> layer.showTouch(Point(action.x, action.y))
            is SwipeAction -> layer.showTouch(Point(action.x2, action.y2), listOf(Point(action.x1, action.y1), Point(action.x2, action.y2)))
            is GestureAction -> action.strokes.forEach { s ->
                val pts = s.points.map { Point(it.x, it.y) }
                layer.showTouch(pts.last(), pts)
            }
        }
    }

    private fun warnIfUnderPanel() {
        val view = panel ?: return
        val p = panelParams ?: return
        val left = p.x
        val top = p.y
        val right = p.x + view.width
        val bottom = p.y + view.height
        val covered = actions.filter { it.enabled }.any { a ->
            val pt = when (a) {
                is TapAction -> Point(a.x, a.y)
                is SwipeAction -> Point(a.x1, a.y1)
                is GestureAction -> a.strokes.firstOrNull()?.points?.firstOrNull()?.let { Point(it.x, it.y) }
            } ?: return@any false
            pt.x >= left && pt.x <= right && pt.y >= top && pt.y <= bottom
        }
        if (covered) toast("Uyarı: bazı hedefler panelin altında kalıyor, paneli kenara taşı.")
    }

    private fun startTicker() {
        stopTicker()
        tickerJob = scope.launch {
            while (isActive) {
                renderStatus()
                delay(500)
            }
        }
    }

    private fun stopTicker() {
        tickerJob?.cancel()
        tickerJob = null
    }

    // =====================================================================
    // Kayıt
    // =====================================================================

    val isRecording: Boolean get() = recordLayer != null

    private fun startRecording() {
        if (isRunning || isRecording) return
        dialog.dismiss()
        recordedGestures.clear()
        val recorder = TouchRecorder()
        val layer = RecordLayerView(ctx, recorder)
        layer.onGesture = { g -> onRecordedGesture(g) }
        val params = overlayParams(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT)
        if (!addWindow(layer, params)) {
            toast("Kayıt katmanı açılamadı")
            return
        }
        recordLayer = layer
        recordParams = params
        bringPanelToFront()
        applyMarkerState()
        renderPanel()
        vibrate(35)
        if (settings.recordPassThrough) {
            toast("Kayıt başladı. Dokunuşların uygulamaya da iletilir.")
        } else {
            toast("Kayıt başladı (aktarım kapalı: dokunuşlar yalnızca kaydedilir).")
        }
    }

    private fun onRecordedGesture(g: RecordedGesture) {
        recordedGestures += g
        val layer = recordLayer ?: return
        layer.gestureCount = recordedGestures.size
        if (settings.recordPassThrough) forward(g)
    }

    /**
     * Kaydedilen hareketi alttaki uygulamaya aktarır: katman kısa süre dokunulamaz yapılır,
     * aynı hareket enjekte edilir, sonra katman yeniden dokunuş yakalamaya başlar.
     */
    private fun forward(g: RecordedGesture) {
        val layer = recordLayer ?: return
        val params = recordParams ?: return
        forwardJob?.cancel()
        forwardJob = scope.launch {
            layer.forwarding = true
            params.setTouchable(false)
            updateWindow(layer, params)
            try {
                delay(FORWARD_SETTLE_MS) // Giriş sisteminin pencere değişikliğini alması için.
                executor.execute(GesturePlanner.planGesture(g.strokes, plannerConfig()))
            } finally {
                if (recordLayer === layer) {
                    params.setTouchable(true)
                    updateWindow(layer, params)
                    layer.forwarding = false
                }
            }
        }
    }

    private fun stopRecording() {
        val layer = recordLayer ?: return
        forwardJob?.cancel()
        recordLayer = null
        recordParams = null
        removeWindow(layer)
        val tapSlop = ViewConfiguration.get(ctx).scaledTouchSlop.toFloat()
        val newActions = RecordingConverter.toActions(
            recordedGestures.toList(),
            tapSlopPx = tapSlop,
            lastDelayMs = max(settings.defaultIntervalMs, 500L),
        ) { nextId() }
        recordedGestures.clear()
        if (newActions.isNotEmpty()) {
            actions += newActions
            dirty = true
            toast("${newActions.size} hareket kaydedildi. ▶ ile tekrarla.")
        } else {
            toast("Hiç hareket kaydedilmedi")
        }
        rebuildMarkers()
        renderPanel()
        renderStatus()
        vibrate(35)
    }

    // =====================================================================
    // Dış olaylar (servisten)
    // =====================================================================

    fun onForegroundPackage(pkg: String) {
        if (pkg == service.packageName) return
        if (isRunning && settings.stopOnAppChange && runPackage != null && pkg != runPackage && pkg !in ignoredPackages()) {
            stop()
            toast("Uygulama değişti, oynatma durduruldu")
        }
        if (!isRunning) lastForegroundPackage = pkg
    }

    fun onScreenOff() {
        if (isRunning && settings.stopOnScreenOff) stop()
        if (isRecording) stopRecording()
    }

    /** Ses tuşu ile durdurma. Olay tüketildiyse true. */
    fun onVolumeKey(): Boolean {
        if (!settings.volumeKeyStop) return false
        if (isRunning) {
            stop()
            toast("Ses tuşuyla durduruldu")
            return true
        }
        return false
    }

    private fun ignoredPackages(): Set<String> {
        val ime = runCatching {
            service.getSystemService(android.view.inputmethod.InputMethodManager::class.java)
                .enabledInputMethodList.map { it.packageName }
        }.getOrDefault(emptyList())
        return setOf("com.android.systemui", "android") + ime
    }

    // =====================================================================
    // Arayüz durumu
    // =====================================================================

    private fun renderPanel() {
        val p = panel ?: return
        val running = isRunning
        val recording = isRecording
        p.play.setImageResource(if (running) R.drawable.ic_stop else R.drawable.ic_play)
        p.play.setActiveColor(if (running) OverlayColors.STOP else OverlayColors.PLAY)
        p.record.setActiveColor(if (recording) OverlayColors.RECORD else null)
        p.record.setImageResource(if (recording) R.drawable.ic_stop else R.drawable.ic_record)
        p.record.setUsable(!running)
        p.eye.setImageResource(if (targetsVisible) R.drawable.ic_visibility else R.drawable.ic_visibility_off)
        val editable = !running && !recording
        listOf(p.addTap, p.addSwipe, p.undo, p.tune, p.save).forEach { it.setUsable(editable) }
    }

    @SuppressLint("SetTextI18n")
    private fun renderStatus() {
        val p = panel ?: return
        when (val st = player.state.value) {
            is PlayerState.Countdown -> {
                canvas?.countdown = st.secondsLeft
                p.status.text = "⏱ ${st.secondsLeft}"
            }
            is PlayerState.Running -> {
                canvas?.countdown = null
                val cycle = if (st.totalCycles != null) "${st.cycle}/${st.totalCycles}" else "${st.cycle}. tur"
                val elapsed = SystemClock.elapsedRealtime() - st.startedAt
                val time = if (st.timeLimitMs != null) formatDuration((st.timeLimitMs - elapsed).coerceAtLeast(0)) else formatDuration(elapsed)
                p.status.text = "$cycle\n${compact(st.taps)}\n$time"
            }
            else -> {
                canvas?.countdown = null
                p.status.text = if (isRecording) "● kayıt" else "${actions.size} adım"
            }
        }
    }

    private fun compact(n: Long): String = when {
        n >= 1_000_000 -> "%.1fM".format(Locale.US, n / 1_000_000.0)
        n >= 10_000 -> "%.1fB".format(Locale.US, n / 1_000.0)
        else -> n.toString()
    }

    private fun toast(message: String) {
        Toast.makeText(service, message, Toast.LENGTH_SHORT).show()
    }

    private fun vibrate(ms: Long) {
        if (!settings.vibrate) return
        val vibrator: Vibrator? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            service.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            service.getSystemService(Vibrator::class.java)
        }
        runCatching { vibrator?.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE)) }
    }

    companion object {
        /** Bundan fazla hedef için ayrı pencere açılmaz; çizim katmanında gösterilir. */
        private const val MAX_MARKER_WINDOWS = 40
        private const val FORWARD_SETTLE_MS = 48L
        private const val PLAY_WARMUP_MS = 80L
    }
}
