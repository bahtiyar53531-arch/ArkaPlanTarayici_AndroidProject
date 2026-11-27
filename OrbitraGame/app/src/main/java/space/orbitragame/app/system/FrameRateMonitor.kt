package space.orbitragame.app.system

import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.view.FrameMetrics
import android.view.Window
import java.util.concurrent.atomic.AtomicInteger

/**
 * Ekrana gercekten cizilen kare sayisi (Android FrameMetrics).
 * WebView yeni bir kare urettiginde uygulama penceresi yeniden cizilir;
 * bu sayac "Ekran FPS" degeridir (tarayici/oyun FPS'inden ayridir).
 */
class FrameRateMonitor(private val window: Window, private val onFps: (Double) -> Unit) {

    private val frames = AtomicInteger(0)
    private var thread: HandlerThread? = null
    private val main = Handler(Looper.getMainLooper())
    private var lastAt = 0L
    private var running = false

    private val listener = Window.OnFrameMetricsAvailableListener { _, _: FrameMetrics, _ ->
        frames.incrementAndGet()
    }

    private val ticker = object : Runnable {
        override fun run() {
            if (!running) return
            val now = SystemClock.elapsedRealtime()
            val dt = (now - lastAt).coerceAtLeast(1)
            lastAt = now
            onFps(frames.getAndSet(0) * 1000.0 / dt)
            main.postDelayed(this, 1000)
        }
    }

    fun start() {
        if (running) return
        running = true
        val t = HandlerThread("orbitra-frames").apply { start() }
        thread = t
        runCatching { window.addOnFrameMetricsAvailableListener(listener, Handler(t.looper)) }
        frames.set(0)
        lastAt = SystemClock.elapsedRealtime()
        main.postDelayed(ticker, 1000)
    }

    fun stop() {
        if (!running) return
        running = false
        main.removeCallbacks(ticker)
        runCatching { window.removeOnFrameMetricsAvailableListener(listener) }
        thread?.quitSafely()
        thread = null
    }
}
