package com.muslimathkar.app.overlay

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.location.Location
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.CancellationSignal
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * Bridge between the web app and the native overlay service, reminders and the few
 * platform settings a WebView cannot reach.
 */
@CapacitorPlugin(
    name = "AthkarOverlay",
    permissions = [
        Permission(alias = "notifications", strings = [Manifest.permission.POST_NOTIFICATIONS]),
        Permission(alias = "location", strings = [Manifest.permission.ACCESS_COARSE_LOCATION]),
    ],
)
class AthkarOverlayPlugin : Plugin() {
    private val store by lazy { OverlayStore(context) }
    private var launchRoute: String? = null

    override fun load() {
        Channels.ensure(context)
        launchRoute = activity?.intent?.getStringExtra(Notifications.EXTRA_ROUTE)
    }

    override fun handleOnNewIntent(intent: Intent) {
        super.handleOnNewIntent(intent)
        intent.getStringExtra(Notifications.EXTRA_ROUTE)?.let { route ->
            launchRoute = route
            notifyListeners("launchRoute", JSObject().put("route", route))
        }
    }

    // ---- Overlay permission ------------------------------------------------------------

    @PluginMethod
    fun checkOverlayPermission(call: PluginCall) {
        call.resolve(JSObject().put("granted", OverlayController.canDrawOverlays(context)))
    }

    /** Opens the system "Display over other apps" screen for this package. */
    @PluginMethod
    fun requestOverlayPermission(call: PluginCall) {
        val intent = Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${context.packageName}"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { context.startActivity(intent) }
            .onFailure { context.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
        call.resolve()
    }

    // ---- Service ------------------------------------------------------------------------

    /** Saves config and starts the service. Call only from a user action while the app is visible. */
    @PluginMethod
    fun start(call: PluginCall) {
        call.getObject("config")?.let { store.config = OverlayConfig.fromJson(it).copy(enabled = true) }
            ?: run { store.config = store.config.copy(enabled = true) }
        val started = OverlayController.start(context)
        call.resolve(JSObject().put("started", started).put("fallbackReason", store.fallbackReason))
    }

    @PluginMethod
    fun stop(call: PluginCall) {
        store.config = store.config.copy(enabled = false)
        OverlayController.stop(context)
        call.resolve()
    }

    @PluginMethod
    fun updateConfig(call: PluginCall) {
        val json = call.getObject("config") ?: return call.reject("config is required")
        store.config = OverlayConfig.fromJson(json)
        OverlayController.sendToService(context, OverlayService.ACTION_CONFIG_CHANGED)
        call.resolve()
    }

    @PluginMethod
    fun setPool(call: PluginCall) {
        val items = call.getArray("items") ?: return call.reject("items is required")
        val list = (0 until items.length()).mapNotNull { i ->
            val o = items.optJSONObject(i) ?: return@mapNotNull null
            OverlayDhikr(o.optString("id"), o.optString("text"), o.optString("categoryId"), o.optInt("repeatCount", 1))
        }.filter { it.id.isNotBlank() && it.text.isNotBlank() }
        store.pool = list
        call.resolve(JSObject().put("count", list.size))
    }

    @PluginMethod
    fun isRunning(call: PluginCall) {
        call.resolve(
            JSObject()
                .put("running", OverlayService.running)
                .put("enabled", store.config.enabled)
                .put("pausedUntil", store.pausedUntil)
                .put("fallbackReason", store.fallbackReason),
        )
    }

    /** pausedUntil: epoch ms, or 0 to resume. */
    @PluginMethod
    fun pause(call: PluginCall) {
        store.pausedUntil = call.getLong("until") ?: 0L
        call.resolve()
    }

    /** Shows one overlay immediately (preview from the settings screen). */
    @PluginMethod
    fun preview(call: PluginCall) {
        if (!OverlayService.running) return call.reject("Overlay service is not running")
        OverlayController.sendToService(context, OverlayService.ACTION_SHOW_NOW)
        call.resolve()
    }

    @PluginMethod
    fun clearFallbackNotice(call: PluginCall) {
        store.fallbackReason = null
        call.resolve()
    }

    /** Counts taken with the overlay "+1" button: [{date, dhikrId, count}]. Cleared unless clear=false. */
    @PluginMethod
    fun getNativeCounters(call: PluginCall) {
        val counts = store.takeCounts(call.getBoolean("clear", true) ?: true)
        call.resolve(JSObject().put("counts", JSArray(counts.toString())))
    }

    // ---- Floating tasbih counter ------------------------------------------------------

    /**
     * Turns the floating counter on/off and pushes the counter it mirrors.
     * Turning it on must come from a user action in the foreground (it may start the service).
     */
    @PluginMethod
    fun setBubble(call: PluginCall) {
        val current = store.bubble
        val enabled = call.getBoolean("enabled", current.enabled) ?: current.enabled
        val next = current.copy(
            enabled = enabled,
            counterId = call.getLong("counterId") ?: current.counterId,
            name = call.getString("name", current.name) ?: current.name,
            count = call.getInt("count") ?: current.count,
            target = call.getInt("target") ?: current.target,
            language = call.getString("language", current.language) ?: current.language,
        )
        store.bubble = next
        val started = if (enabled) OverlayController.start(context) else {
            OverlayController.sendToService(context, OverlayService.ACTION_BUBBLE_CHANGED)
            false
        }
        call.resolve(JSObject().put("running", started || OverlayService.running).put("fallbackReason", store.fallbackReason))
    }

    @PluginMethod
    fun getBubble(call: PluginCall) {
        call.resolve(JSObject(store.bubble.toJson().toString()).put("running", OverlayService.running))
    }

    /** Taps (and resets) made on the bubble since the last sync: [{counterId, delta, reset}]. */
    @PluginMethod
    fun takeBubbleCounts(call: PluginCall) {
        val pending = store.takeBubblePending(call.getBoolean("clear", true) ?: true)
        call.resolve(JSObject().put("counts", JSArray(pending.toString())))
    }

    /** The bubble hides while the app itself is on screen. */
    @PluginMethod
    fun setAppVisible(call: PluginCall) {
        store.appVisible = call.getBoolean("visible", false) ?: false
        OverlayController.sendToService(context, OverlayService.ACTION_APP_VISIBILITY)
        call.resolve()
    }

    // ---- Reminders ----------------------------------------------------------------------

    @PluginMethod
    fun scheduleReminders(call: PluginCall) {
        val arr = call.getArray("reminders") ?: return call.reject("reminders is required")
        val list = (0 until arr.length()).mapNotNull { i -> arr.optJSONObject(i)?.let(ReminderScheduler::fromJson) }
        ReminderScheduler.replaceAll(context, list)
        call.resolve(JSObject().put("scheduled", ReminderScheduler.pending(context).size))
    }

    @PluginMethod
    fun cancelReminders(call: PluginCall) {
        ReminderScheduler.cancelAll(context)
        call.resolve()
    }

    @PluginMethod
    fun consumeLaunchRoute(call: PluginCall) {
        val route = launchRoute
        launchRoute = null
        call.resolve(JSObject().put("route", route))
    }

    // ---- Notifications permission (runtime on Android 13+) -----------------------------

    @PluginMethod
    fun checkNotificationPermission(call: PluginCall) {
        call.resolve(JSObject().put("granted", NotificationManagerCompat.from(context).areNotificationsEnabled()))
    }

    @PluginMethod
    fun requestNotificationPermission(call: PluginCall) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU || getPermissionState("notifications") == PermissionState.GRANTED) {
            return checkNotificationPermission(call)
        }
        requestPermissionForAlias("notifications", call, "notificationPermissionCallback")
    }

    @PermissionCallback
    private fun notificationPermissionCallback(call: PluginCall) = checkNotificationPermission(call)

    // ---- Battery optimisation guidance -------------------------------------------------

    @PluginMethod
    fun isIgnoringBatteryOptimizations(call: PluginCall) {
        val pm = context.getSystemService(android.os.PowerManager::class.java)
        call.resolve(JSObject().put("ignoring", pm.isIgnoringBatteryOptimizations(context.packageName)))
    }

    /** Opens the battery optimisation list (no REQUEST_IGNORE_BATTERY_OPTIMIZATIONS permission needed). */
    @PluginMethod
    fun openBatteryOptimizationSettings(call: PluginCall) {
        val intents = listOf(
            Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS),
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}")),
        )
        val opened = intents.any { intent ->
            runCatching { context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.isSuccess
        }
        call.resolve(JSObject().put("opened", opened))
    }

    @PluginMethod
    fun openAppSettings(call: PluginCall) {
        context.startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        call.resolve()
    }

    /** Opens this app's Play Store page (Play app if present, otherwise the browser). */
    @PluginMethod
    fun openStoreListing(call: PluginCall) {
        val pkg = context.packageName
        val opened = listOf(
            Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$pkg")),
            Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$pkg")),
        ).any { runCatching { context.startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.isSuccess }
        call.resolve(JSObject().put("opened", opened))
    }

    @PluginMethod
    fun getDeviceInfo(call: PluginCall) {
        call.resolve(JSObject().put("manufacturer", Build.MANUFACTURER).put("sdkInt", Build.VERSION.SDK_INT))
    }

    // ---- Approximate location (only when the user picks auto-location) -----------------

    @PluginMethod
    fun getApproximateLocation(call: PluginCall) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "locationPermissionCallback")
            return
        }
        readLocation(call)
    }

    @PermissionCallback
    private fun locationPermissionCallback(call: PluginCall) {
        if (getPermissionState("location") == PermissionState.GRANTED) readLocation(call)
        else call.reject("Location permission denied", "DENIED")
    }

    @SuppressLint("MissingPermission")
    private fun readLocation(call: PluginCall) {
        val lm = context.getSystemService(LocationManager::class.java)
        val provider = LocationManager.NETWORK_PROVIDER.takeIf { lm.isProviderEnabled(it) }
            ?: LocationManager.PASSIVE_PROVIDER
        val resolve = { loc: Location? ->
            if (loc == null) call.reject("Location unavailable", "UNAVAILABLE")
            else call.resolve(JSObject().put("latitude", loc.latitude).put("longitude", loc.longitude))
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            lm.getCurrentLocation(provider, CancellationSignal(), ContextCompat.getMainExecutor(context)) { loc ->
                resolve(loc ?: lm.getLastKnownLocation(provider))
            }
        } else {
            resolve(lm.getLastKnownLocation(provider) ?: lm.getLastKnownLocation(LocationManager.PASSIVE_PROVIDER))
        }
    }
}
