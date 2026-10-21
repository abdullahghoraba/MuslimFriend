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
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.WindowManager
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import java.text.NumberFormat
import java.util.Locale
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.min

private const val REMOVE_SIZE_DP = 64
private const val MINI_BUTTON_DP = 28
private const val CARD_WIDTH_DP = 236
private const val RESET_CONFIRM_MS = 2000L

private const val GREEN = 0xF22E7D61.toInt()
private const val GREEN_DARK = 0xF21A4D3C.toInt()
private const val GOLD = 0xFFE0B66A.toInt()
private const val INK = 0xE61C1F1E.toInt()
private const val WHITE = 0xFFFFFFFF.toInt()

/**
 * Floating tasbih counter over other apps, in two forms:
 * - **small**: a round counter with three small buttons on its edge — ↺ reset, ✕ close, ⤢ expand;
 * - **expanded**: a card with the counter name, a large count you tap anywhere to count,
 *   a progress bar, and reset / open app / minimise / close buttons.
 * Tap counts with a short vibration; drag to move; drag onto the ✕ target at the bottom to turn it off.
 * Reset asks for a second tap within 2 s so a stray touch can't wipe the count.
 * The window only covers the counter, so the app underneath stays fully usable.
 */
class TasbihBubble(
    private val context: Context,
    private val store: OverlayStore,
    private val onOpenApp: () -> Unit,
    private val onHide: () -> Unit,
) {
    private val wm = context.getSystemService(WindowManager::class.java)
    private val handler = Handler(Looper.getMainLooper())
    private var root: View? = null
    private var bubbleView: BubbleView? = null
    private var bigCount: TextView? = null
    private var bigTarget: TextView? = null
    private var progress: ProgressLine? = null
    private var resetButtons = mutableListOf<TextView>()
    private lateinit var params: WindowManager.LayoutParams
    /** Current bubble diameter in px (user-adjustable). */
    private var sizePx = 0
    private var expanded = false
    private var resetArmed = false
    private val disarmReset = Runnable { setResetArmed(false) }

    val isShowing: Boolean get() = root != null

    fun show() {
        if (root != null) {
            refresh()
            return
        }
        val state = store.bubble
        sizePx = dp(state.sizeDp)
        expanded = state.expanded
        val metrics = context.resources.displayMetrics
        params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT,
        ).apply {
            gravity = Gravity.TOP or Gravity.LEFT
            x = if (state.x >= 0) state.x else metrics.widthPixels - sizePx - dp(16)
            y = if (state.y >= 0) state.y else (metrics.heightPixels * 0.35f).toInt()
            title = "Muslim Friend tasbih"
        }
        attach(if (expanded) buildCard(state) else buildBubble(state), fadeIn = true)
    }

    /** Applies count, size and opacity changes made in the app while the counter is showing. */
    fun refresh() {
        val state = store.bubble
        if (root == null) return
        root?.alpha = state.opacity
        val size = dp(state.sizeDp)
        if (size != sizePx && !expanded) {
            sizePx = size
            rebuild()
            return
        }
        sizePx = size
        updateViews(state)
    }

    fun hide() {
        handler.removeCallbacksAndMessages(null)
        hideRemoveTarget()
        val view = root ?: return
        root = null
        bubbleView = null
        bigCount = null
        bigTarget = null
        progress = null
        resetButtons.clear()
        runCatching { wm.removeViewImmediate(view) }
    }

    // ---- building the two forms ----------------------------------------------------------

    private fun attach(view: View, fadeIn: Boolean) {
        runCatching { wm.addView(view, params) }.onFailure { return }
        root = view
        val opacity = store.bubble.opacity
        if (fadeIn) {
            view.alpha = 0f
            view.animate().alpha(opacity).setDuration(180).start()
        } else {
            view.alpha = opacity
        }
    }

    private fun rebuild() {
        val old = root ?: return
        resetButtons.clear()
        setResetArmed(false)
        runCatching { wm.removeViewImmediate(old) }
        root = null
        val state = store.bubble
        attach(if (expanded) buildCard(state) else buildBubble(state), fadeIn = false)
        root?.post { clampIntoScreen() }
    }

    private fun setExpanded(value: Boolean) {
        expanded = value
        store.bubble = store.bubble.copy(expanded = value)
        rebuild()
    }

    /** Small form: the round counter with three mini buttons on its edge. */
    @SuppressLint("ClickableViewAccessibility")
    private fun buildBubble(state: BubbleState): View {
        val ar = state.language == "ar"
        val pad = dp(MINI_BUTTON_DP) / 2
        val frame = FrameLayout(context).apply { clipChildren = false; clipToPadding = false }
        val bubble = BubbleView(context).apply {
            update(state)
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
            isFocusable = true
        }
        frame.addView(bubble, FrameLayout.LayoutParams(sizePx, sizePx).apply { setMargins(pad, pad, pad, pad) })
        bubbleView = bubble

        val mini = dp(MINI_BUTTON_DP)
        frame.addView(miniButton("✕", if (ar) "إغلاق العداد العائم" else "Close floating counter") { onHide() },
            FrameLayout.LayoutParams(mini, mini, Gravity.TOP or Gravity.END))
        frame.addView(miniButton("⤢", if (ar) "تكبير العداد" else "Expand counter") { setExpanded(true) },
            FrameLayout.LayoutParams(mini, mini, Gravity.TOP or Gravity.START))
        frame.addView(resetButton(compact = true, ar),
            FrameLayout.LayoutParams(mini, mini, Gravity.BOTTOM or Gravity.START))

        dragAndTap(handle = bubble, onTap = { count() }, pressFeedback = bubble::pressed)
        bubble.setOnClickListener { count() } // TalkBack double-tap
        return frame
    }

    /** Expanded form: a card with a large count and labelled buttons. */
    @SuppressLint("ClickableViewAccessibility")
    private fun buildCard(state: BubbleState): View {
        val ar = state.language == "ar"
        val card = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            layoutDirection = if (ar) View.LAYOUT_DIRECTION_RTL else View.LAYOUT_DIRECTION_LTR
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(GREEN, GREEN_DARK)).apply {
                cornerRadius = dp(22).toFloat()
            }
            elevation = dp(10).toFloat()
            setPadding(dp(12), dp(6), dp(12), dp(12))
        }

        // Header: name + minimise + close. Dragging the header moves the card.
        val header = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(44)
        }
        val name = TextView(context).apply {
            text = state.name.ifBlank { if (ar) "تسبيح" else "Tasbih" }
            setTextColor(WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            typeface = Typeface.DEFAULT_BOLD
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
        }
        header.addView(name, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        header.addView(iconButton("⤡", if (ar) "تصغير العداد" else "Minimise counter") { setExpanded(false) },
            LinearLayout.LayoutParams(dp(44), dp(44)))
        header.addView(iconButton("✕", if (ar) "إغلاق العداد العائم" else "Close floating counter") { onHide() },
            LinearLayout.LayoutParams(dp(44), dp(44)))
        card.addView(header)

        // Body: big count — tap anywhere here to count.
        val body = LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(0, dp(6), 0, dp(10))
            background = GradientDrawable().apply { cornerRadius = dp(16).toFloat(); setColor(0x22FFFFFF) }
            isClickable = true
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
        }
        val count = TextView(context).apply {
            setTextColor(WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 46f)
            typeface = Typeface.DEFAULT_BOLD
            gravity = Gravity.CENTER
        }
        val target = TextView(context).apply {
            setTextColor(0xCCFFFFFF.toInt())
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
            gravity = Gravity.CENTER
        }
        val line = ProgressLine(context)
        body.addView(count)
        body.addView(target)
        body.addView(line, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(6)).apply {
            setMargins(dp(18), dp(8), dp(18), 0)
        })
        card.addView(body, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        bigCount = count
        bigTarget = target
        progress = line

        // Footer: reset + open app.
        val footer = LinearLayout(context).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(0, dp(10), 0, 0)
        }
        footer.addView(resetButton(compact = false, ar), LinearLayout.LayoutParams(0, dp(44), 1f).apply { marginEnd = dp(8) })
        footer.addView(pillButton(if (ar) "فتح التطبيق" else "Open app") { onOpenApp() },
            LinearLayout.LayoutParams(0, dp(44), 1f))
        card.addView(footer)

        updateViews(state)
        dragAndTap(handle = header, onTap = null, pressFeedback = null)
        dragAndTap(handle = body, onTap = { count() }, pressFeedback = { p ->
            body.animate().scaleX(if (p) 0.97f else 1f).scaleY(if (p) 0.97f else 1f).setDuration(80).start()
        })
        body.setOnClickListener { count() }

        return FrameLayout(context).apply {
            addView(card, FrameLayout.LayoutParams(dp(CARD_WIDTH_DP), ViewGroup.LayoutParams.WRAP_CONTENT))
        }
    }

    private fun updateViews(state: BubbleState) {
        bubbleView?.update(state)
        val fmt = NumberFormat.getIntegerInstance(if (state.language == "ar") Locale.forLanguageTag("ar-EG") else Locale.ENGLISH)
        bigCount?.text = fmt.format(state.count)
        bigTarget?.text = when {
            state.target <= 0 -> ""
            state.language == "ar" -> "الهدف ${fmt.format(state.target)} · الدورة ${fmt.format(state.count / state.target + 1)}"
            else -> "Target ${state.target} · round ${state.count / state.target + 1}"
        }
        progress?.set(cycleFraction(state))
        (bigCount?.parent as? View)?.contentDescription = bubbleView?.contentDescription ?: describe(state)
    }

    // ---- buttons ---------------------------------------------------------------------------

    private fun miniButton(symbol: String, label: String, onClick: () -> Unit) = TextView(context).apply {
        text = symbol
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
        setTextColor(WHITE)
        gravity = Gravity.CENTER
        contentDescription = label
        background = GradientDrawable().apply { shape = GradientDrawable.OVAL; setColor(INK); setStroke(dp(1), 0x55FFFFFF) }
        elevation = dp(4).toFloat()
        setOnClickListener { onClick() }
    }

    private fun iconButton(symbol: String, label: String, onClick: () -> Unit) = TextView(context).apply {
        text = symbol
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
        setTextColor(WHITE)
        gravity = Gravity.CENTER
        contentDescription = label
        setOnClickListener { onClick() }
    }

    private fun pillButton(label: String, onClick: () -> Unit) = TextView(context).apply {
        text = label
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        setTextColor(WHITE)
        gravity = Gravity.CENTER
        background = GradientDrawable().apply { cornerRadius = dp(14).toFloat(); setColor(0x33FFFFFF) }
        setOnClickListener { onClick() }
    }

    /** Reset with confirmation: first tap arms it (label changes), second tap within 2 s resets. */
    private fun resetButton(compact: Boolean, ar: Boolean): TextView {
        val b = if (compact) miniButton("↺", if (ar) "تصفير العداد" else "Reset counter") { onResetTapped() }
        else pillButton(if (ar) "↺ تصفير" else "↺ Reset") { onResetTapped() }
        b.tag = compact
        resetButtons.add(b)
        return b
    }

    private fun onResetTapped() {
        if (!resetArmed) {
            setResetArmed(true)
            vibrate(20)
            return
        }
        setResetArmed(false)
        updateViews(store.bubbleReset())
        vibrate(60)
    }

    private fun setResetArmed(armed: Boolean) {
        resetArmed = armed
        handler.removeCallbacks(disarmReset)
        if (armed) handler.postDelayed(disarmReset, RESET_CONFIRM_MS)
        val ar = store.bubble.language == "ar"
        for (b in resetButtons) {
            val compact = b.tag == true
            b.text = when {
                compact && armed -> "؟"
                compact -> "↺"
                armed -> if (ar) "اضغط للتأكيد" else "Tap to confirm"
                else -> if (ar) "↺ تصفير" else "↺ Reset"
            }
            (b.background as? GradientDrawable)?.setColor(
                if (armed) 0xEED0453B.toInt() else if (compact) INK else 0x33FFFFFF,
            )
        }
    }

    // ---- touch: tap to count, drag to move, drop on ✕ to close --------------------------------

    @SuppressLint("ClickableViewAccessibility")
    private fun dragAndTap(handle: View, onTap: (() -> Unit)?, pressFeedback: ((Boolean) -> Unit)?) {
        val slop = ViewConfiguration.get(context).scaledTouchSlop
        var downX = 0f
        var downY = 0f
        var startX = 0
        var startY = 0
        var dragging = false
        handle.setOnTouchListener { _, e ->
            when (e.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    downX = e.rawX; downY = e.rawY
                    startX = params.x; startY = params.y
                    dragging = false
                    pressFeedback?.invoke(true)
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = e.rawX - downX
                    val dy = e.rawY - downY
                    if (!dragging && (abs(dx) > slop || abs(dy) > slop)) {
                        dragging = true
                        pressFeedback?.invoke(false)
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
                    pressFeedback?.invoke(false)
                    val dropToRemove = dragging && overRemove
                    hideRemoveTarget()
                    when {
                        dropToRemove -> { vibrate(60); onHide() }
                        dragging -> if (expanded) clampIntoScreen() else snapToEdge()
                        e.actionMasked == MotionEvent.ACTION_UP -> onTap?.invoke()
                    }
                    true
                }
                else -> false
            }
        }
    }

    private var removeView: TextView? = null
    private var overRemove = false

    /** A round ✕ target at the bottom centre while dragging; dropping on it turns the counter off. */
    private fun showRemoveTarget() {
        if (removeView != null) return
        val ar = store.bubble.language == "ar"
        val target = TextView(context).apply {
            text = "✕"
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            setTextColor(WHITE)
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
            // Purely visual: never takes touches, so the drag keeps going to the counter.
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

    // ---- counting & placement --------------------------------------------------------------

    private fun count() {
        val next = store.bubbleTap()
        updateViews(next)
        if (next.target > 0 && next.count % next.target == 0) {
            vibrate(400)
            bubbleView?.celebrate()
        } else {
            vibrate(18)
        }
        root?.announceForAccessibility(describe(next))
    }

    private fun snapToEdge() {
        val metrics = context.resources.displayMetrics
        val width = root?.width?.takeIf { it > 0 } ?: (sizePx + dp(MINI_BUTTON_DP))
        val toLeft = params.x + width / 2 < metrics.widthPixels / 2
        params.x = if (toLeft) 0 else metrics.widthPixels - width
        params.y = params.y.coerceIn(dp(24), metrics.heightPixels - width - dp(96))
        root?.let { runCatching { wm.updateViewLayout(it, params) } }
        store.bubble = store.bubble.copy(x = params.x, y = params.y)
    }

    /** Keeps the expanded card fully on screen. */
    private fun clampIntoScreen() {
        val view = root ?: return
        val metrics = context.resources.displayMetrics
        params.x = params.x.coerceIn(0, (metrics.widthPixels - view.width).coerceAtLeast(0))
        params.y = params.y.coerceIn(dp(24), (metrics.heightPixels - view.height - dp(48)).coerceAtLeast(dp(24)))
        runCatching { wm.updateViewLayout(view, params) }
        store.bubble = store.bubble.copy(x = params.x, y = params.y)
    }

    private fun describe(s: BubbleState): String {
        val fmt = NumberFormat.getIntegerInstance(if (s.language == "ar") Locale.forLanguageTag("ar-EG") else Locale.ENGLISH)
        return if (s.language == "ar") {
            "${s.name.ifBlank { "تسبيح" }}: ${fmt.format(s.count)}" + (if (s.target > 0) " من ${fmt.format(s.target)}" else "") + ". اضغط للعد"
        } else {
            "${s.name.ifBlank { "Tasbih" }}: ${s.count}" + (if (s.target > 0) " of ${s.target}" else "") + ". Tap to count"
        }
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

    /** Fraction of the current target cycle (1 when exactly on a multiple of the target). */
    private fun cycleFraction(s: BubbleState): Float {
        if (s.target <= 0) return 0f
        val inCycle = s.count % s.target
        return if (s.count > 0 && inCycle == 0) 1f else inCycle / s.target.toFloat()
    }

    /** Thin rounded progress bar for the expanded card. */
    private class ProgressLine(context: Context) : View(context) {
        private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0x40FFFFFF }
        private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = GOLD }
        private val rect = RectF()
        private var fraction = 0f

        fun set(f: Float) {
            fraction = f.coerceIn(0f, 1f)
            invalidate()
        }

        override fun onDraw(canvas: Canvas) {
            val r = height / 2f
            rect.set(0f, 0f, width.toFloat(), height.toFloat())
            canvas.drawRoundRect(rect, r, r, track)
            val w = width * fraction
            if (w <= 0f) return
            // Fill from the reading start: right edge in RTL.
            if (layoutDirection == View.LAYOUT_DIRECTION_RTL) rect.set(width - w, 0f, width.toFloat(), height.toFloat())
            else rect.set(0f, 0f, w, height.toFloat())
            canvas.drawRoundRect(rect, r, r, fill)
        }
    }

    /** The round counter: count in the middle, a progress ring for the current target cycle. */
    private class BubbleView(context: Context) : View(context) {
        private val density = context.resources.displayMetrics.density
        private val bg = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = GREEN }
        private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE; strokeWidth = 3.5f * density; color = 0x40FFFFFF
        }
        private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE; strokeWidth = 3.5f * density; color = GOLD; strokeCap = Paint.Cap.ROUND
        }
        private val text = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = WHITE; textAlign = Paint.Align.CENTER; typeface = Typeface.DEFAULT_BOLD
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
