package de.honeybalecta.textschnitt

import android.content.Context
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import org.json.JSONObject

/** Liest Länge, Größe, Drehung und Bildrate eines Videos. */
object Probe {
    fun probe(ctx: Context, uri: Uri): JSONObject? {
        val r = MediaMetadataRetriever()
        try {
            r.setDataSource(ctx, uri)
            fun meta(k: Int) = r.extractMetadata(k)
            val durMs = meta(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: return null
            val hasVideo = meta(MediaMetadataRetriever.METADATA_KEY_HAS_VIDEO) == "yes"
            val hasAudio = meta(MediaMetadataRetriever.METADATA_KEY_HAS_AUDIO) == "yes"
            val w = meta(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
            val h = meta(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
            val rot = meta(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
            var fps = 30.0
            runCatching {
                val ex = MediaExtractor(); ex.setDataSource(ctx, uri, null)
                for (i in 0 until ex.trackCount) {
                    val f = ex.getTrackFormat(i)
                    if (f.getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true && f.containsKey(MediaFormat.KEY_FRAME_RATE)) {
                        fps = runCatching { f.getInteger(MediaFormat.KEY_FRAME_RATE).toDouble() }
                            .getOrElse { f.getFloat(MediaFormat.KEY_FRAME_RATE).toDouble() }
                        break
                    }
                }
                ex.release()
            }
            if (fps < 1 || fps > 240) fps = 30.0
            var name = uri.lastPathSegment ?: "Video"
            ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst() && !c.isNull(0)) name = c.getString(0)
            }
            return JSONObject().apply {
                put("uri", uri.toString()); put("name", name); put("duration", durMs / 1000.0)
                put("width", w); put("height", h); put("rotation", rot); put("fps", fps)
                put("hasAudio", hasAudio); put("hasVideo", hasVideo)
            }
        } catch (e: Exception) {
            return null
        } finally {
            runCatching { r.release() }
        }
    }
}
