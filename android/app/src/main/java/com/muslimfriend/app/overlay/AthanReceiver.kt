package com.muslimfriend.app.overlay

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

class AthanReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Channels.ensure(context)
        AthanScheduler.takeDue(context).forEach { event ->
            if ((event.kind == "athan" || event.kind == "voice") && event.sound != "none") {
                runCatching { ContextCompat.startForegroundService(context, AthanService.intent(context, event)) }
                    .onFailure { AthanService.post(context, event) }
            } else {
                AthanService.post(context, event)
                if (event.kind == "athan") runCatching { AthanSilence.begin(context, event.silentMinutes) }
            }
        }
        AthanScheduler.scheduleNext(context)
        PrayerWidget.updateAll(context)
    }
}

class AthanRestoreReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) { AthanSilence.restore(context) }
}
