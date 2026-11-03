package com.muslimfriend.app.studio

import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File

/**
 * Copies a recitation recorded in the app (a file in the app's own storage) into the phone's gallery (videos, in
 * Movies/Muslim Friend) or music (audio, in Music/Muslim Friend) through MediaStore, which needs no storage
 * permission on Android 10+. Older Android answers "unsupported" and the app offers the share sheet instead.
 */
@CapacitorPlugin(name = "MediaSaver")
class MediaSaverPlugin : Plugin() {
    @PluginMethod
    fun save(call: PluginCall) {
        val path = call.getString("path") ?: return call.reject("path is required")
        val name = call.getString("name") ?: return call.reject("name is required")
        val mime = call.getString("mime") ?: return call.reject("mime is required")
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return call.reject("unsupported", "UNSUPPORTED")
        val file = File(Uri.parse(path).path ?: path)
        // Only the app's own files: the web side cannot pass a path elsewhere on the phone.
        val own = listOf(context.filesDir, context.cacheDir).any { file.canonicalPath.startsWith(it.canonicalPath + File.separator) }
        if (!own || !file.isFile) return call.reject("not an app file")
        val video = mime.startsWith("video/")
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, (if (video) Environment.DIRECTORY_MOVIES else Environment.DIRECTORY_MUSIC) + "/Muslim Friend")
            put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
        val collection = if (video) MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        else MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
        Thread {
            val resolver = context.contentResolver
            var uri: Uri? = null
            try {
                uri = resolver.insert(collection, values) ?: throw IllegalStateException("insert failed")
                resolver.openOutputStream(uri)!!.use { out -> file.inputStream().use { it.copyTo(out) } }
                resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
                call.resolve(JSObject().put("uri", uri.toString()))
            } catch (e: Exception) {
                uri?.let { runCatching { resolver.delete(it, null, null) } }
                call.reject(e.message ?: "save failed")
            }
        }.start()
    }
}
