package com.muslimfriend.app.overlay

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.WindowManager
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.LinearLayout
import android.widget.TextView
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.min

private const val REMOVE_SIZE_DP = 64

/**
 * Floating tasbih counter ("chat head") over other apps.
 * Tap = +1 with a short vibration; drag to move (snaps to the nearest side);
 * long-press = small menu (reset, open app, hide). The window only covers the bubble itself,
 * so the app underneath (e.g. Facebook) stays fully usable.
 */
class TasbihBubble(
    private val context: Context,
    private val store: OverlayStore,
    private val onOpenApp: () -> Unit,
    private val onHide: () -> Unit,
) {
    private val wm = context.getSystemService(WindowManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private var root: LinearLayout? = null
    private var bubbleView: BubbleView? = null
    private var menu: LinearLayout? = null
    private lateinit var params: WindowManager.LayoutParams
    /** Current bubble diameter in px (user-adjustable). */
    private var sizePx = 0

    val isShowing: Boolean get() = root != null

    @SuppressLint("ClickableViewAccessibility")
    fun show() {
        if (root != null) {
            refresh()
            return
        }
        val state = store.bubble
        val size = dp(state.sizeDp)
        sizePx = size
        val bubble = BubbleView(context).apply {
            update(state)
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
            isFocusable = true
        }
        val actions = buildMenu()
        val container = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            addView(bubble, LinearLayout.LayoutParams(size, size))
            addView(actions)
        }

        val metrics = context.resources.displayMetrics
        params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.LEFT
            x = if (state.x >= 0) state.x else metrics.widthPixels - size - dp(8)
            y = if (state.y >= 0) state.y else (metrics.heightPixels * 0.35f).toInt()
            title = "Muslim Friend tasbih"
        }

        attachTouch(bubble, container)
        runCatching { wm.addView(container, params) }.onFailure { return }
        root = container
        bubbleView = bubble
        menu = actions
        container.alpha = 0f
        container.animate().alpha(state.opacity).setDuration(180).start()
    }

    /** Applies count, size and opacity changes made in the app while the bubble is showing. */
    fun refresh() {
        val state = store.bubble
        val view = bubbleView ?: return
        view.update(state)
        root?.alpha = state.opacity
        val size = dp(state.sizeDp)
        if (size != sizePx) {
            sizePx = size
            view.layoutParams = LinearLayout.LayoutParams(size, size)
            snapToEdge()
        }
    }

    fun hide() {
        handler.removeCallbacksAndMessages(null)
        hideRemoveTarget()
        val view = root ?: return
        root = null
        bubbleView = null
        menu = null
        runCatching { wm.removeViewImmediate(view) }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun attachTouch(bubble: BubbleView, container: LinearLayout) {
        val slop = ViewConfiguration.get(context).scaledTouchSlop
        var downRawX = 0f
        var downRawY = 0f
        var startX = 0
        var startY = 0
        var dragging = false
        var longPressed = false
        val longPress = Runnable {
            longPressed = true
            vibrate(30)
            toggleMenu()
        }

        // Taps outside the window collapse the menu.
        container.setOnTouchListener { _, e ->
            if (e.actionMasked == MotionEvent.ACTION_OUTSIDE) setMenuVisible(false)
            false
        }

        bubble.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downRawX = e.rawX; downRawY = e.rawY
                    startX = params.x; startY = params.y
                    dragging = false; longPressed = false
                    handler.postDelayed(longPress, ViewConfiguration.getLongPressTimeout().toLong())
                    bubble.pressed(true)
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downRawX
                    val dy = e.rawY - downRawY
                    if (!dragging && (abs(dx) > slop || abs(dy) > slop)) {
                        dragging = true
                        handler.removeCallbacks(longPress)
                        setMenuVisible(false)
                        showRemoveTarget()
                    }
                    if (dragging) {
                        params.x = (startX + dx).toInt()
                        params.y = (startY + dy).toInt()
                        root?.let { runCatching { wm.updateViewLayout(it, params) } }
                        updateRemoveTarget(e.rawX, e.rawY)
                    }
                    true
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    handler.removeCallbacks(longPress)
                    bubble.pressed(false)
                    val dropToRemove = dragging && overRemove
                    hideRemoveTarget()
                    when {
                        dropToRemove -> {
                            vibrate(60)
                            onHide()
                        }
                        dragging -> snapToEdge()
                        longPressed -> Unit
                        e.actionMasked == MotionEvent.ACTION_UP -> {
                            if (menu?.visibility == View.VISIBLE) setMenuVisible(false) else count()
                        }
                    }
                    true
                }
                else -> false
            }
        }

        // TalkBack: a double-tap activates "click" → count.
        bubble.setOnClickListener { count() }
    }

    // ---- Drag-to-remove target (like Android chat heads) -------------------------------------

    private var removeView: TextView? = null
    private var overRemove = false

    /** A round ✕ target at the bottom centre while the bubble is dragged; dropping on it turns the counter off. */
    private fun showRemoveTarget() {
        if (removeView != null) return
        val ar = store.bubble.language == "ar"
        val target = TextView(context).apply {
            text = "✕"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            setTextColor(0xFFFFFFFF.toInt())
            gravity = Gravity.CENTER
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(0xCC1C1F1E.toInt())
                setStroke(dp(2), 0x66FFFFFF)
            }
            contentDescription = if (ar) "اسحب هنا لإيقاف العداد العائم" else "Drag here to remove the floating counter"
            alpha = 0f
        }
        val size = dp(REMOVE_SIZE_DP)
        val lp = WindowManager.LayoutParams(
            size, size,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            // Purely visual: never takes touches, so the drag keeps going to the bubble.
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL
            y = dp(48)
            title = "Muslim Friend remove target"
        }
        runCatching { wm.addView(target, lp) }.onFailure { return }
        removeView = target
        overRemove = false
        target.animate().alpha(1f).setDuration(150).start()
    }

    private fun updateRemoveTarget(rawX: Float, rawY: Float) {
        val target = removeView ?: return
        val metrics = context.resources.displayMetrics
        val cx = metrics.widthPixels / 2f
        val cy = metrics.heightPixels - dp(48) - dp(REMOVE_SIZE_DP) / 2f
        val near = hypot(rawX - cx, rawY - cy) < dp(REMOVE_SIZE_DP)
        if (near != overRemove) {
            overRemove = near
            if (near) vibrate(25)
            target.animate().scaleX(if (near) 1.25f else 1f).scaleY(if (near) 1.25f else 1f).setDuration(120).start()
            (target.background as? GradientDrawable)?.setColor(if (near) 0xEED0453B.toInt() else 0xCC1C1F1E.toInt())
        }
    }

    private fun hideRemoveTarget() {
        val target = removeView ?: return
        removeView = null
        runCatching { wm.removeViewImmediate(target) }
    }

    private fun count() {
        val next = store.bubbleTap()
        bubbleView?.update(next)
        if (next.target > 0 && next.count % next.target == 0) {
            vibrate(400)
            bubbleView?.celebrate()
        } else {
            vibrate(18)
        }
        bubbleView?.announceForAccessibility(bubbleView?.contentDescription)
    }

    private fun snapToEdge() {
        val metrics = context.resources.displayMetrics
        val toLeft = params.x + sizePx / 2 < metrics.widthPixels / 2
        params.x = if (toLeft) dp(4) else metrics.widthPixels - sizePx - dp(4)
        params.y = params.y.coerceIn(dp(24), metrics.heightPixels - dp(120))
        root?.let { runCatching { wm.updateViewLayout(it, params) } }
        store.bubble = store.bubble.copy(x = params.x, y = params.y)
    }

    private fun buildMenu(): LinearLayout {
        val ar = store.bubble.language == "ar"
        fun action(symbol: String, label: String, onClick: () -> Unit) = TextView(context).apply {
            text = symbol
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
            setTextColor(0xFFFFFFFF.toInt())
            gravity = Gravity.CENTER
            contentDescription = label
            background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(0xE61C1F1E.toInt()) }
            setOnClickListener { onClick() }
        }
        return LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            visibility = View.GONE
            setPadding(dp(6), 0, dp(6), 0)
            val lp = { LinearLayout.LayoutParams(dp(48), dp(48)).apply { marginStart = dp(4) } }
            addView(action("↺", if (ar) "تصفير العداد" else "Reset counter") {
                bubbleView?.update(store.bubbleReset())
                setMenuVisible(false)
            }, lp())
            addView(action("⤢", if (ar) "فتح التطبيق" else "Open app") {
                setMenuVisible(false)
                onOpenApp()
            }, lp())
            addView(action("✕", if (ar) "إخفاء العداد العائم" else "Hide floating counter") {
                onHide()
            }, lp())
        }
    }

    private fun toggleMenu() = setMenuVisible(menu?.visibility != View.VISIBLE)

    private fun setMenuVisible(visible: Boolean) {
        val m = menu ?: return
        m.visibility = if (visible) View.VISIBLE else View.GONE
        // On the right edge, put the menu on the inner side of the bubble.
        val onRight = params.x > context.resources.displayMetrics.widthPixels / 2
        root?.layoutDirection = if (onRight) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
        if (visible && onRight) {
            params.x = context.resources.displayMetrics.widthPixels - sizePx - dp(4) - dp(3 * 52 + 12)
        } else if (!visible && onRight) {
            params.x = context.resources.displayMetrics.widthPixels - sizePx - dp(4)
        }
        root?.let { runCatching { wm.updateViewLayout(it, params) } }
    }

    @Suppress("DEPRECATION")
    private fun vibrate(ms: Long) {
        val vibrator: Vibrator? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            context.getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            context.getSystemService(Vibrator::class.java)
        }
        vibrator?.vibrate(VibrationEffect.createOneShot(ms, VibrationEffect.DEFAULT_AMPLITUDE))
    }

    private fun dp(v: Int): Int = (v * context.resources.displayMetrics.density).toInt()

    /** The round counter: count in the middle, a progress ring for the current target cycle. */
    private class BubbleView(context: Context) : View(context) {
        private val density = context.resources.displayMetrics.density
        private val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xF20F6B5C.toInt() }
        private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE; strokeWidth = 3.5f * density; color = 0x40FFFFFF
        }
        private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE; strokeWidth = 3.5f * density; color = 0xFFE0B66A.toInt(); strokeCap = Paint.Cap.ROUND
        }
        private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = 0xFFFFFFFF.toInt(); textAlign = Paint.Align.CENTER; typeface = Typeface.DEFAULT_BOLD
        }
        private val oval = RectF()
        private var state = BubbleState()
        private var label = "0"

        fun update(s: BubbleState) {
            state = s
            val fmt = NumberFormat.getIntegerInstance(if (s.language == "ar") Locale.forLanguageTag("ar-EG") else Locale.ENGLISH)
            label = fmt.format(s.count)
            contentDescription = if (s.language == "ar") {
                "${s.name.ifBlank { "تسبيح" }}: ${fmt.format(s.count)}" + (if (s.target > 0) " من ${fmt.format(s.target)}" else "") + ". اضغط للعد"
            } else {
                "${s.name.ifBlank { "Tasbih" }}: ${s.count}" + (if (s.target > 0) " of ${s.target}" else "") + ". Tap to count"
            }
            invalidate()
        }

        fun pressed(p: Boolean) {
            animate().scaleX(if (p) 0.92f else 1f).scaleY(if (p) 0.92f else 1f).setDuration(80).start()
        }

        fun celebrate() {
            animate().scaleX(1.18f).scaleY(1.18f).setDuration(140).withEndAction {
                animate().scaleX(1f).scaleY(1f).setDuration(160).start()
            }.start()
        }

        override fun onDraw(canvas: Canvas) {
            val cx = width / 2f
            val cy = height / 2f
            val r = min(width, height) / 2f - 2 * density
            canvas.drawCircle(cx, cy, r, bg)
            val inset = 4 * density
            oval.set(cx - r + inset, cy - r + inset, cx + r - inset, cy + r - inset)
            canvas.drawOval(oval, track)
            if (state.target > 0) {
                val inCycle = state.count % state.target
                val fraction = if (state.count > 0 && inCycle == 0) 1f else inCycle / state.target.toFloat()
                canvas.drawArc(oval, -90f, 360f * fraction, false, ring)
            }
            // Number scales with the bubble so every size stays readable.
            text.textSize = min(width, height) * (if (label.length > 3) 0.24f else 0.31f)
            canvas.drawText(label, cx, cy - (text.descent() + text.ascent()) / 2, text)
        }

        override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
            super.onInitializeAccessibilityNodeInfo(info)
            info.className = "android.widget.Button"
        }
    }
}
