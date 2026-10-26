package com.muslimfriend.app.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.content.res.Configuration
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Handler
import android.os.Looper
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import kotlin.math.abs

/**
 * The floating dhikr card. A TYPE_APPLICATION_OVERLAY window that is not focusable and is
 * not touch-modal, so touches outside its bounds go to the app underneath.
 */
class OverlayWindow(
    private val context: Context,
    private val onCount: (OverlayDhikr) -> Unit,
) {
    private val wm = context.getSystemService(WindowManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private var root: View? = null
    private val dismissRunnable = Runnable { hide() }

    val isShowing: Boolean get() = root != null

    @SuppressLint("ClickableViewAccessibility")
    fun show(dhikr: OverlayDhikr, config: OverlayConfig) {
        hide(animate = false)
        val dark = when (config.style) {
            "dark" -> true
            "light" -> false
            else -> (context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES
        }
        val bg = if (dark) 0xFF1A201E.toInt() else 0xFFFFFFFF.toInt()
        val fg = if (dark) 0xFFE8ECEA.toInt() else 0xFF1C1F1E.toInt()
        val accent = if (dark) 0xFF5CC2AE.toInt() else 0xFF0F6B5C.toInt()
        val accentOn = if (dark) 0xFF0B1F1B.toInt() else 0xFFFFFFFF.toInt()
        val textSp = when (config.size) { "small" -> 17f; "large" -> 26f; else -> 21f }

        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = View.LAYOUT_DIRECTION_RTL
            setPadding(dp(18), dp(14), dp(18), dp(10))
            background = GradientDrawable().apply {
                cornerRadius = dp(20).toFloat()
                setColor(bg)
                setStroke(dp(1), if (dark) 0xFF2B3431.toInt() else 0xFFE3DED3.toInt())
            }
            elevation = dp(8).toFloat()
            alpha = 0f
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
        }

        val text = TextView(context).apply {
            this.text = dhikr.text
            setTextColor(fg)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, textSp)
            typeface = amiri(context)
            gravity = Gravity.CENTER
            textDirection = View.TEXT_DIRECTION_RTL
            textAlignment = View.TEXT_ALIGNMENT_CENTER
            setLineSpacing(0f, 1.35f)
            maxLines = if (config.size == "small") 4 else 7
            ellipsize = android.text.TextUtils.TruncateAt.END
            contentDescription = dhikr.text
        }
        card.addView(text, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT))

        val plusOne = Button(context).apply {
            this.text = "+1"
            setTextColor(accentOn)
            isAllCaps = false
            minHeight = dp(48)
            minWidth = dp(72)
            background = GradientDrawable().apply { cornerRadius = dp(24).toFloat(); setColor(accent) }
            contentDescription = NativeLabels.get(config.labels, config.language, "addOne", "زيادة العداد بواحد", "Add one to the counter")
            setOnClickListener {
                onCount(dhikr)
                animate().scaleX(1.15f).scaleY(1.15f).setDuration(90).withEndAction {
                    animate().scaleX(1f).scaleY(1f).setDuration(90).start()
                }.start()
                restartTimer(config)
            }
        }
        val close = TextView(context).apply {
            this.text = "✕"
            setTextColor(fg)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            gravity = Gravity.CENTER
            minHeight = dp(48)
            minWidth = dp(48)
            contentDescription = NativeLabels.get(config.labels, config.language, "dismiss", "إغلاق", "Dismiss")
            setOnClickListener { hide() }
        }
        val row = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(close)
            addView(View(context), LinearLayout.LayoutParams(0, 1, 1f))
            addView(plusOne)
        }
        card.addView(row, LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT).apply {
            topMargin = dp(6)
        })

        // Swipe sideways or tap the text to dismiss.
        var downX = 0f
        card.setOnTouchListener { v, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> { downX = e.rawX; handler.removeCallbacks(dismissRunnable); true }
                MotionEvent.ACTION_MOVE -> { v.translationX = e.rawX - downX; v.alpha = config.opacity * (1f - abs(v.translationX) / v.width.coerceAtLeast(1)); true }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    val dx = e.rawX - downX
                    if (abs(dx) > v.width / 3f || (abs(dx) < dp(8) && e.actionMasked == MotionEvent.ACTION_UP)) {
                        v.animate().translationX(if (dx >= 0) v.width.toFloat() else -v.width.toFloat()).alpha(0f).setDuration(160)
                            .withEndAction { hide(animate = false) }.start()
                    } else {
                        v.animate().translationX(0f).alpha(config.opacity).setDuration(150).start()
                        restartTimer(config)
                    }
                    true
                }
                else -> false
            }
        }

        val metrics = context.resources.displayMetrics
        val widthFraction = when (config.size) { "small" -> 0.78f; "large" -> 0.94f; else -> 0.88f }
        val params = WindowManager.LayoutParams(
            (metrics.widthPixels * widthFraction).toInt(),
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.CENTER_HORIZONTAL or when (config.position) {
                "center" -> Gravity.CENTER_VERTICAL
                "bottom" -> Gravity.BOTTOM
                else -> Gravity.TOP
            }
            y = if (config.position == "center") 0 else dp(56)
            title = "Muslim Friend overlay"
        }

        runCatching { wm.addView(card, params) }.onFailure { return }
        root = card
        card.animate().alpha(config.opacity).setDuration(220).start()
        card.announceForAccessibility(dhikr.text)
        restartTimer(config)
    }

    private fun restartTimer(config: OverlayConfig) {
        handler.removeCallbacks(dismissRunnable)
        handler.postDelayed(dismissRunnable, config.displaySeconds * 1000L)
    }

    fun hide(animate: Boolean = true) {
        handler.removeCallbacks(dismissRunnable)
        val view = root ?: return
        root = null
        val remove = { runCatching { wm.removeViewImmediate(view) } }
        if (animate && view.isAttachedToWindow) {
            view.animate().alpha(0f).setDuration(200).withEndAction { remove() }.start()
        } else {
            remove()
        }
    }

    private fun dp(v: Int): Int = (v * context.resources.displayMetrics.density).toInt()

    companion object {
        private var cachedFont: Typeface? = null

        /** Amiri is bundled with the web assets (public/assets/fonts), so no duplicate copy is needed. */
        fun amiri(context: Context): Typeface = cachedFont ?: runCatching {
            Typeface.createFromAsset(context.assets, "public/assets/fonts/Amiri-Regular.ttf")
        }.getOrDefault(Typeface.SERIF).also { cachedFont = it }
    }
}
