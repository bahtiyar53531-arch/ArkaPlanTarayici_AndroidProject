package space.orbitragame.app

import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Looper
import android.view.MotionEvent
import android.view.View
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import space.orbitragame.app.settings.AppSettings
import space.orbitragame.app.ui.PerfPanelView
import space.orbitragame.app.ui.SpaceLoadingView
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * Arayuz duman testleri + ekran goruntuleri (Robolectric, gercek Skia cizimi).
 * Goruntuler app/build/screenshots/ altina yazilir.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w411dp-h891dp-port-xxhdpi")
class UiScreenshotTest {

    private val outDir = File("build/screenshots").apply { mkdirs() }

    private fun capture(view: View, w: Int, h: Int, name: String): Bitmap {
        view.measure(View.MeasureSpec.makeMeasureSpec(w, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        view.layout(0, 0, w, h)
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        view.draw(Canvas(bmp))
        File(outDir, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        return bmp
    }

    private fun idle(ms: Long) = shadowOf(Looper.getMainLooper()).idleFor(ms, TimeUnit.MILLISECONDS)

    @Test
    fun loadingScreenRendersRealProgress() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        val v = SpaceLoadingView(ctx)
        v.setProgress(60, "Oyun kaynakları yükleniyor")
        // Animasyon hedefe ulassin (gosterilen deger hedefi asla gecmez)
        repeat(30) { idle(50); capture(v, 1080, 2400, "01_acilis_ekrani_yuzde60") }
        v.setProgress(100, "Oyuna giriş yapılıyor")
        repeat(30) { idle(50); capture(v, 1080, 2400, "02_acilis_ekrani_yuzde100") }
        assertTrue(v.isVisuallyComplete)
        v.setStatus("İnternet bağlantısı bekleniyor…", warning = true)
        idle(50)
        capture(v, 2400, 1080, "03_acilis_ekrani_yatay")
    }

    @Test
    fun perfPanelRendersAllMetrics() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        val p = PerfPanelView(ctx)
        p.update(
            PerfPanelView.Data(
                gameFps = 58.0, gameAvg = 57.2, gameMin = 41.0, lowFps = false, browserFps = 60.0, screenFps = 59.0,
                refreshRate = 120f, appMemMb = 182, jsHeapMb = 64, sysAvailMb = 2150, sysTotalMb = 7800, thermal = "Normal",
                battery = 78, pingMs = 42, pingJitter = 5, pingLoss = 0, pingColor = PerfPanelView.COLOR_GOOD,
                network = "Wi-Fi", socket = "Bağlı (1)", socketColor = PerfPanelView.COLOR_GOOD,
            ),
        )
        p.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED)
        capture(p, p.measuredWidth, p.measuredHeight, "04_performans_paneli")
        p.update(PerfPanelView.Data(gameFps = 22.0, gameAvg = 24.0, gameMin = 18.0, lowFps = true, pingMs = 210, pingColor = PerfPanelView.COLOR_BAD, socket = "Koptu", socketColor = PerfPanelView.COLOR_BAD))
        p.measure(View.MeasureSpec.UNSPECIFIED, View.MeasureSpec.UNSPECIFIED)
        capture(p, p.measuredWidth, p.measuredHeight, "05_performans_paneli_dusuk_fps")
    }

    @Test
    fun mainActivityLifecycleAndMenu() {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        AppSettings(ctx).apply { showFps = true; showPing = true }
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        val activity = controller.get()
        idle(500)
        val root = activity.window.decorView
        capture(root, 1080, 2400, "06_uygulama_acilis")

        // Yukleme ekranini gec (test ortaminda gercek sayfa yok)
        activity.findViewById<View>(R.id.loadingView).visibility = View.GONE
        idle(100)

        // Kontrol dugmesine dokun -> menu acilir
        val btn = activity.findViewById<View>(R.id.controlButton)
        assertNotNull(btn)
        val t = android.os.SystemClock.uptimeMillis()
        btn.dispatchTouchEvent(MotionEvent.obtain(t, t, MotionEvent.ACTION_DOWN, 10f, 10f, 0))
        btn.dispatchTouchEvent(MotionEvent.obtain(t, t + 50, MotionEvent.ACTION_UP, 10f, 10f, 0))
        idle(400)
        capture(root, 1080, 2400, "07_kontrol_menusu")

        // Yasam dongusu: arka plan -> on plan -> cikis
        controller.pause().stop()
        idle(200)
        controller.start().resume()
        idle(200)
        activity.finish()
        controller.pause().stop().destroy()
    }
}
