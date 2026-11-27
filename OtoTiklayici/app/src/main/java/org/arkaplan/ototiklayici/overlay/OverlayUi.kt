package org.arkaplan.ototiklayici.overlay

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.PixelFormat
import android.graphics.Point
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.hardware.display.DisplayManager
import android.os.Build
import android.util.DisplayMetrics
import android.util.TypedValue
import android.view.Display
import android.view.Gravity
import android.view.WindowManager
import android.widget.ImageButton
import kotlin.math.roundToInt

/** Overlay pencerelerinde kullanılan ortak renkler (koyu tema). */
object OverlayColors {
    const val PANEL_BG = 0xFF1C1F26.toInt()
    const val SURFACE = 0xFF262A33.toInt()
    const val SURFACE_VARIANT = 0xFF323744.toInt()
    const val ON_SURFACE = 0xFFECEFF4.toInt()
    const val ON_SURFACE_DIM = 0xFFA9B0BF.toInt()
    const val ACCENT = 0xFF5B8CFF.toInt()
    const val PLAY = 0xFF22C55E.toInt()
    const val STOP = 0xFFEF4444.toInt()
    const val RECORD = 0xFFFF3B30.toInt()
    const val TAP = 0xFF3B82F6.toInt()
    const val SWIPE_START = 0xFF10B981.toInt()
    const val SWIPE_END = 0xFFF59E0B.toInt()
    const val GESTURE = 0xFFA855F7.toInt()
    const val SCRIM = 0x99000000.toInt()
}

fun Context.dp(value: Float): Float =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value, resources.displayMetrics)

fun Context.dpi(value: Float): Int = dp(value).roundToInt()

fun Context.sp(value: Float): Float =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, value, resources.displayMetrics)

/** Erişilebilirlik overlay penceresi için yerleşim parametreleri (izin gerektirmez). */
fun overlayParams(
    width: Int,
    height: Int,
    touchable: Boolean = true,
    focusable: Boolean = false,
): WindowManager.LayoutParams {
    var flags = WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
        WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS or
        WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED
    if (!focusable) flags = flags or WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
    if (!touchable) flags = flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
    return WindowManager.LayoutParams(
        width,
        height,
        WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
        flags,
        PixelFormat.TRANSLUCENT,
    ).apply {
        gravity = Gravity.TOP or Gravity.START
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
        }
        if (focusable) {
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_ADJUST_PAN or
                WindowManager.LayoutParams.SOFT_INPUT_STATE_HIDDEN
        }
    }
}

fun WindowManager.LayoutParams.setTouchable(touchable: Boolean) {
    flags = if (touchable) {
        flags and WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE.inv()
    } else {
        flags or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
    }
}

fun WindowManager.LayoutParams.setKeepScreenOn(on: Boolean) {
    flags = if (on) {
        flags or WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON
    } else {
        flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON.inv()
    }
}

/** Gerçek ekran boyutu (sistem çubukları dahil), piksel. */
@Suppress("DEPRECATION")
fun Context.realScreenSize(): Point {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        try {
            val bounds = getSystemService(WindowManager::class.java).maximumWindowMetrics.bounds
            if (bounds.width() > 0 && bounds.height() > 0) return Point(bounds.width(), bounds.height())
        } catch (_: RuntimeException) {
            // Görsel olmayan bağlamda erişilemezse ekran bilgisine düş.
        }
    }
    val display = getSystemService(DisplayManager::class.java).getDisplay(Display.DEFAULT_DISPLAY)
    val metrics = DisplayMetrics()
    display.getRealMetrics(metrics)
    return Point(metrics.widthPixels, metrics.heightPixels)
}

fun roundedBackground(color: Int, radiusPx: Float, strokeColor: Int = 0, strokeWidthPx: Int = 0) =
    GradientDrawable().apply {
        shape = GradientDrawable.RECTANGLE
        cornerRadius = radiusPx
        setColor(color)
        if (strokeWidthPx > 0) setStroke(strokeWidthPx, strokeColor)
    }

fun circleBackground(color: Int) = GradientDrawable().apply {
    shape = GradientDrawable.OVAL
    setColor(color)
}

/** Dairesel dalga efektli, ikonlu panel düğmesi. */
fun Context.panelButton(iconRes: Int, description: String, sizePx: Int): ImageButton =
    ImageButton(this).apply {
        setImageResource(iconRes)
        contentDescription = description
        imageTintList = ColorStateList.valueOf(OverlayColors.ON_SURFACE)
        scaleType = android.widget.ImageView.ScaleType.CENTER_INSIDE
        val pad = (sizePx * 0.22f).roundToInt()
        setPadding(pad, pad, pad, pad)
        background = RippleDrawable(
            ColorStateList.valueOf(0x40FFFFFF),
            circleBackground(Color.TRANSPARENT),
            circleBackground(Color.WHITE),
        )
        tooltipText = description
    }

fun ImageButton.setActiveColor(color: Int?) {
    background = RippleDrawable(
        ColorStateList.valueOf(0x40FFFFFF),
        circleBackground(color ?: Color.TRANSPARENT),
        circleBackground(Color.WHITE),
    )
}

fun ImageButton.setUsable(usable: Boolean) {
    isEnabled = usable
    alpha = if (usable) 1f else 0.35f
}

fun formatDuration(ms: Long): String {
    val total = ms / 1000
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%02d:%02d".format(m, s)
}
