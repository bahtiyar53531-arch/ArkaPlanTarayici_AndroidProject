package space.orbitragame.app.ui

import android.content.Context
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.media.MediaPlayer
import android.util.AttributeSet
import android.util.Log
import android.view.Surface
import android.view.TextureView
import space.orbitragame.app.R
import kotlin.math.max

/**
 * Acilis ekraninin sinematik video arka plani (sessiz, dongulu, ekranı dolduracak
 * sekilde kirpilir). Dikey ve yatay icin ayri video kullanilir. Video
 * oynatilamazsa [onError] cagrilir ve acilis ekrani hareketsiz goruntuye doner.
 *
 * Ses odagi ISTENMEZ: kullanicinin calan muzigini kesmez.
 */
class SplashVideoView @JvmOverloads constructor(context: Context, attrs: AttributeSet? = null) :
    TextureView(context, attrs), TextureView.SurfaceTextureListener {

    var onFirstFrame: (() -> Unit)? = null
    var onError: (() -> Unit)? = null

    private var player: MediaPlayer? = null
    private var surface: Surface? = null
    private var currentRes = 0
    private var videoW = 0
    private var videoH = 0
    private var active = false

    init {
        surfaceTextureListener = this
        isOpaque = false
    }

    /** Oynatmayi baslat (yuzey hazir olunca otomatik baslar). */
    fun start() {
        active = true
        maybePrepare()
    }

    /** Tamamen durdur ve kaynaklari serbest birak. */
    fun release() {
        active = false
        releasePlayer()
        runCatching { surface?.release() }
        surface = null
    }

    private fun wantedRes(): Int = if (width > height) R.raw.splash_landscape else R.raw.splash_portrait

    private fun maybePrepare() {
        if (!active || surface == null || width == 0 || height == 0) return
        val res = wantedRes()
        if (res == currentRes && player != null) return
        releasePlayer()
        currentRes = res
        try {
            val afd = resources.openRawResourceFd(res)
            val mp = MediaPlayer()
            mp.setDataSource(afd.fileDescriptor, afd.startOffset, afd.length)
            afd.close()
            mp.setSurface(surface)
            mp.isLooping = true
            mp.setVolume(0f, 0f)
            mp.setOnPreparedListener {
                videoW = it.videoWidth; videoH = it.videoHeight
                applyCrop()
                if (active) it.start()
            }
            mp.setOnInfoListener { _, what, _ ->
                if (what == MediaPlayer.MEDIA_INFO_VIDEO_RENDERING_START) onFirstFrame?.invoke()
                false
            }
            mp.setOnErrorListener { _, what, extra ->
                Log.w(TAG, "Video hatasi $what/$extra")
                releasePlayer()
                onError?.invoke()
                true
            }
            mp.prepareAsync()
            player = mp
        } catch (e: Exception) {
            Log.w(TAG, "Video acilamadi", e)
            releasePlayer()
            onError?.invoke()
        }
    }

    private fun releasePlayer() {
        val p = player ?: return
        player = null
        currentRes = 0
        runCatching { p.stop() }
        runCatching { p.release() }
    }

    /** Videoyu en-boy oranini bozmadan ekrani dolduracak sekilde kirp (center-crop). */
    private fun applyCrop() {
        if (videoW <= 0 || videoH <= 0 || width == 0 || height == 0) return
        val s = max(width.toFloat() / videoW, height.toFloat() / videoH)
        val m = Matrix()
        m.setScale(videoW * s / width, videoH * s / height, width / 2f, height / 2f)
        setTransform(m)
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        applyCrop()
        // Yon degistiyse uygun videoya gec
        if (active && player != null && wantedRes() != currentRes) maybePrepare()
    }

    override fun onSurfaceTextureAvailable(st: SurfaceTexture, w: Int, h: Int) {
        surface = Surface(st)
        maybePrepare()
    }

    override fun onSurfaceTextureSizeChanged(st: SurfaceTexture, w: Int, h: Int) = applyCrop()

    override fun onSurfaceTextureDestroyed(st: SurfaceTexture): Boolean {
        releasePlayer()
        runCatching { surface?.release() }
        surface = null
        return true
    }

    override fun onSurfaceTextureUpdated(st: SurfaceTexture) = Unit

    private companion object {
        const val TAG = "OrbitraSplash"
    }
}
