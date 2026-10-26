package com.muslimfriend.app.overlay

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.location.CurrentLocationRequest
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.android.gms.tasks.CancellationTokenSource
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
        Permission(alias = "preciseLocation", strings = [Manifest.permission.ACCESS_FINE_LOCATION]),
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

    // ---- Native athan and widget ---------------------------------------------------------
    @PluginMethod
    fun canScheduleExactAlarms(call: PluginCall) { call.resolve(JSObject().put("granted", AthanScheduler.canExact(context))) }
    @PluginMethod
    fun openExactAlarmSettings(call: PluginCall) {
        if (Build.VERSION.SDK_INT < 31) { call.resolve(); return }
        openAthanSettings(call, Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + context.packageName)))
    }
    @PluginMethod
    fun scheduleAthan(call: PluginCall) {
        val arr = call.getArray("events") ?: return call.reject("events is required")
        try {
            val events = (0 until arr.length()).map { AthanEvent.fromJson(arr.getJSONObject(it)) }
            val exact = AthanScheduler.replaceAll(context, events)
            call.resolve(JSObject().put("scheduled", AthanScheduler.pending(context).size).put("exact", exact))
        } catch (e: Exception) { call.reject("Unable to schedule athan: " + e.message) }
    }
    @PluginMethod
    fun cancelAthan(call: PluginCall) { AthanScheduler.cancel(context); call.resolve() }
    @PluginMethod
    fun previewAthan(call: PluginCall) {
        try {
            val sound = call.getString("sound") ?: "tone"
            val speech = call.getString("speech") ?: ""
            val event = AthanEvent.fromJson(org.json.JSONObject().put("id", "preview").put("prayer", "fajr")
                .put("kind", if (sound == "voice") "voice" else "athan").put("at", System.currentTimeMillis())
                .put("title", speech.ifBlank { context.getString(com.muslimfriend.app.R.string.channel_athan) })
                .put("body", "").put("sound", sound).put("volume", call.getFloat("volume") ?: 1f)
                .put("stopOn", call.getArray("stopOn") ?: org.json.JSONArray()).put("speech", speech))
            ContextCompat.startForegroundService(context, AthanService.intent(context, event, true))
            call.resolve()
        } catch (e: Exception) { call.reject("Unable to preview athan: " + e.message) }
    }
    @PluginMethod
    fun stopAthan(call: PluginCall) {
        try { context.startService(Intent(context, AthanService::class.java).setAction(AthanService.ACTION_STOP)); call.resolve() }
        catch (e: Exception) { call.reject("Unable to stop athan: " + e.message) }
    }
    @PluginMethod
    fun hasDndAccess(call: PluginCall) { call.resolve(JSObject().put("granted", AthanSilence.hasAccess(context))) }
    @PluginMethod
    fun openDndAccessSettings(call: PluginCall) { openAthanSettings(call, Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)) }
    private fun openAthanSettings(call: PluginCall, intent: Intent) {
        try { context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)); call.resolve() }
        catch (e: Exception) { call.reject("Unable to open settings: " + e.message) }
    }
    @PluginMethod
    fun setWidgetData(call: PluginCall) {
        val prayers = call.getArray("prayers") ?: return call.reject("prayers is required")
        val label = call.getString("nextLabel") ?: return call.reject("nextLabel is required")
        val appName = call.getString("appName") ?: return call.reject("appName is required")
        try {
            for (i in 0 until prayers.length()) {
                val prayer = prayers.getJSONObject(i)
                require(prayer.getString("name").isNotBlank() && prayer.getLong("at") > 0)
            }
            PrayerWidget.setData(context, prayers, label, appName); call.resolve()
        } catch (e: Exception) { call.reject("Invalid widget data: " + e.message) }
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
            sizeDp = (call.getInt("sizeDp") ?: current.sizeDp).coerceIn(44, 120),
            opacity = (call.getFloat("opacity") ?: current.opacity).coerceIn(0.4f, 1f),
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
            // Asks for both: Android 12+ lets the user pick "precise" or "approximate", and either works.
            requestPermissionForAliases(arrayOf("location", "preciseLocation"), call, "locationPermissionCallback")
            return
        }
        readLocation(call)
    }

    @PermissionCallback
    private fun locationPermissionCallback(call: PluginCall) {
        if (getPermissionState("location") == PermissionState.GRANTED) readLocation(call)
        else call.reject("Location permission denied", "DENIED")
    }

    /**
     * Current position. Uses Google's fused location when Google Play services are on the phone (GPS, Wi-Fi and cell
     * towers together, the most reliable indoors), else Android's own providers. Rejects with "OFF" when location
     * is switched off on the phone.
     */
    @SuppressLint("MissingPermission")
    private fun readLocation(call: PluginCall) {
        val lm = context.getSystemService(LocationManager::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && !lm.isLocationEnabled) {
            call.reject("Location is turned off", "OFF")
            return
        }
        val hasPlayServices = runCatching {
            GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
        }.getOrDefault(false)
        if (!hasPlayServices) return readWithLocationManager(call, lm)
        val precise = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        val client = LocationServices.getFusedLocationProviderClient(context)
        val request = CurrentLocationRequest.Builder()
            .setPriority(if (precise) Priority.PRIORITY_HIGH_ACCURACY else Priority.PRIORITY_BALANCED_POWER_ACCURACY)
            .setDurationMillis(25_000)
            .setMaxUpdateAgeMillis(5 * 60_000)
            .build()
        val resolve = { loc: Location -> call.resolve(JSObject().put("latitude", loc.latitude).put("longitude", loc.longitude)) }
        // No fix from Google's service (or an error): its last known position, then Android's own providers.
        val fallback = {
            client.lastLocation
                .addOnSuccessListener { last -> if (last != null) resolve(last) else readWithLocationManager(call, lm) }
                .addOnFailureListener { readWithLocationManager(call, lm) }
        }
        runCatching {
            client.getCurrentLocation(request, CancellationTokenSource().token)
                .addOnSuccessListener { loc -> if (loc != null) resolve(loc) else fallback() }
                .addOnFailureListener { fallback() }
        }.onFailure { readWithLocationManager(call, lm) }
    }

    /**
     * Without Google Play services: listens to every enabled provider at once (fused, network, and GPS when the
     * user allowed precise location) and takes the first accurate fix, else the most accurate one within 25 s,
     * else the freshest last-known fix. A good fix from the last few minutes is used straight away.
     */
    @SuppressLint("MissingPermission")
    private fun readWithLocationManager(call: PluginCall, lm: LocationManager) {
        val precise = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
        // An approximate fix is about 2 km off on purpose; that still moves prayer times by seconds, not minutes.
        val goodEnough = if (precise) 150f else 3_000f
        val enabled = lm.getProviders(true)
        val providers = enabled.filter { it != LocationManager.PASSIVE_PROVIDER && (precise || it != LocationManager.GPS_PROVIDER) }
        val lastKnown = enabled.mapNotNull { p -> runCatching { lm.getLastKnownLocation(p) }.getOrNull() }.maxByOrNull { it.time }
        val resolve = { loc: Location -> call.resolve(JSObject().put("latitude", loc.latitude).put("longitude", loc.longitude)) }
        if (lastKnown != null && System.currentTimeMillis() - lastKnown.time < 5 * 60_000 && lastKnown.accuracy <= goodEnough) {
            resolve(lastKnown)
            return
        }
        val handler = Handler(Looper.getMainLooper())
        var best: Location? = null
        var done = false
        lateinit var listener: LocationListener
        val finish = {
            if (!done) {
                done = true
                handler.removeCallbacksAndMessages(null)
                runCatching { lm.removeUpdates(listener) }
                val loc = best ?: lastKnown
                if (loc == null) call.reject("Location unavailable", "UNAVAILABLE") else resolve(loc)
            }
        }
        listener = object : LocationListener {
            override fun onLocationChanged(loc: Location) {
                if (best.let { it == null || loc.accuracy < it.accuracy }) best = loc
                if (loc.accuracy <= goodEnough) finish()
            }
            // Android 8-10 declare these without a default body.
            override fun onProviderEnabled(provider: String) {}
            override fun onProviderDisabled(provider: String) {}
            @Deprecated("Deprecated in Java")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
        }
        val listening = providers.count { p ->
            runCatching { lm.requestLocationUpdates(p, 1_000L, 0f, listener, Looper.getMainLooper()) }.isSuccess
        }
        if (listening == 0) finish() else handler.postDelayed({ finish() }, 25_000)
    }

    @PluginMethod
    fun openLocationSettings(call: PluginCall) {
        runCatching {
            context.startActivity(Intent(android.provider.Settings.ACTION_LOCATION_SOURCE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
        call.resolve()
    }
}
