package com.alunsbillah.app.studio

import android.content.ContentValues
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMuxer
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
import java.nio.ByteBuffer

/**
 * Copies a recitation recorded in the app (a file in the app's own storage) into the phone's gallery (videos, in
 * Movies/Al-Uns Billah) or music (audio, in Music/Al-Uns Billah) through MediaStore, which needs no storage
 * permission on Android 10+. Older Android answers "unsupported" and the app offers the share sheet instead.
 *
 * [finalize] rewrites a recording as a standard file: the WebView's recorder writes a fragmented MP4 (or a WebM)
 * whose header gives no length, which galleries and WhatsApp read as a few seconds long, or empty.
 */
@CapacitorPlugin(name = "MediaSaver")
class MediaSaverPlugin : Plugin() {
    /** Only the app's own files: the web side cannot pass a path elsewhere on the phone. */
    private fun ownFile(path: String): File? {
        val file = File(Uri.parse(path).path ?: path)
        val own = listOf(context.filesDir, context.cacheDir).any { file.canonicalPath.startsWith(it.canonicalPath + File.separator) }
        return if (own && file.isFile) file else null
    }

    @PluginMethod
    fun save(call: PluginCall) {
        val path = call.getString("path") ?: return call.reject("path is required")
        val name = call.getString("name") ?: return call.reject("name is required")
        val mime = call.getString("mime") ?: return call.reject("mime is required")
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return call.reject("unsupported", "UNSUPPORTED")
        val file = ownFile(path) ?: return call.reject("not an app file")
        val video = mime.startsWith("video/")
        val values = ContentValues().apply {
            put(MediaStore.MediaColumns.DISPLAY_NAME, name)
            put(MediaStore.MediaColumns.MIME_TYPE, mime)
            put(MediaStore.MediaColumns.RELATIVE_PATH, (if (video) Environment.DIRECTORY_MOVIES else Environment.DIRECTORY_MUSIC) + "/Al-Uns Billah")
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

    /**
     * Copies every sample of the recording into a new MP4 (or WebM) written by Android's own muxer, which stores the
     * length and the sample tables up front, then puts it in place of the original. Resolves with the length in
     * seconds; on any failure the original is left untouched (and the web side keeps it as it is).
     */
    @PluginMethod
    fun finalize(call: PluginCall) {
        val path = call.getString("path") ?: return call.reject("path is required")
        val file = ownFile(path) ?: return call.reject("not an app file")
        Thread {
            val tmp = File(file.parentFile, file.name + ".fixing")
            var extractor: MediaExtractor? = null
            var muxer: MediaMuxer? = null
            try {
                val ex = MediaExtractor().also { extractor = it }
                ex.setDataSource(file.absolutePath)
                val webm = file.name.endsWith(".webm", ignoreCase = true)
                val mx = MediaMuxer(
                    tmp.absolutePath,
                    if (webm) MediaMuxer.OutputFormat.MUXER_OUTPUT_WEBM else MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4,
                ).also { muxer = it }
                val tracks = IntArray(ex.trackCount) { -1 }
                var maxSample = 4 shl 20
                for (i in 0 until ex.trackCount) {
                    val format = ex.getTrackFormat(i)
                    val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
                    if (!mime.startsWith("audio/") && !mime.startsWith("video/")) continue
                    if (format.containsKey(MediaFormat.KEY_MAX_INPUT_SIZE)) {
                        maxSample = maxOf(maxSample, format.getInteger(MediaFormat.KEY_MAX_INPUT_SIZE))
                    }
                    tracks[i] = mx.addTrack(format)
                    ex.selectTrack(i)
                }
                if (tracks.all { it < 0 }) throw IllegalStateException("no tracks")
                val buffer = ByteBuffer.allocateDirect(maxSample)
                val info = MediaCodec.BufferInfo()
                mx.start()
                var end = 0L
                while (true) {
                    val track = ex.sampleTrackIndex
                    if (track < 0) break
                    buffer.clear()
                    val size = ex.readSampleData(buffer, 0)
                    if (size < 0) break
                    val time = maxOf(0L, ex.sampleTime)
                    val key = ex.sampleFlags and MediaExtractor.SAMPLE_FLAG_SYNC != 0
                    info.set(0, size, time, if (key) MediaCodec.BUFFER_FLAG_KEY_FRAME else 0)
                    if (tracks[track] >= 0) mx.writeSampleData(tracks[track], buffer, info)
                    end = maxOf(end, time)
                    ex.advance()
                }
                mx.stop()
                mx.release(); muxer = null
                ex.release(); extractor = null
                if (tmp.length() == 0L) throw IllegalStateException("empty output")
                if (!tmp.renameTo(file)) {
                    tmp.copyTo(file, overwrite = true)
                    tmp.delete()
                }
                call.resolve(JSObject().put("duration", end / 1_000_000.0))
            } catch (e: Exception) {
                runCatching { muxer?.release() }
                runCatching { extractor?.release() }
                tmp.delete()
                call.reject(e.message ?: "finalize failed")
            }
        }.start()
    }
}
