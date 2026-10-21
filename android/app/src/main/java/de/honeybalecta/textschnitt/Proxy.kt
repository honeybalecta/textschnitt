package de.honeybalecta.textschnitt

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Presentation
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import org.json.JSONObject
import java.io.File

/** Erzeugt eine leichte Vorschau-Datei (720p, H.264), wenn das Handy das Original nicht abspielen kann. */
@OptIn(UnstableApi::class)
object Proxy {
    fun start(ctx: Context, uri: String, job: Job) {
        val main = Handler(Looper.getMainLooper())
        val dir = File(ctx.cacheDir, "proxy").apply { mkdirs() }
        val out = File(dir, "p_${uri.hashCode().toUInt()}.mp4")
        if (out.exists() && out.length() > 0) { job.done(JSONObject().put("path", out.absolutePath)); return }
        val tmp = File(dir, out.name + ".part.mp4")
        val item = EditedMediaItem.Builder(MediaItem.fromUri(Uri.parse(uri)))
            .setEffects(Effects(listOf(), listOf(Presentation.createForShortSide(720))))
            .build()
        val t = Transformer.Builder(ctx)
            .setVideoMimeType(MimeTypes.VIDEO_H264).setAudioMimeType(MimeTypes.AUDIO_AAC)
            .addListener(object : Transformer.Listener {
                override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                    tmp.renameTo(out); job.done(JSONObject().put("path", out.absolutePath))
                }
                override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                    tmp.delete(); job.fail(IllegalStateException("Vorschau fehlgeschlagen: ${exportException.errorCodeName}"))
                }
            }).build()
        job.onCancel { main.post { runCatching { t.cancel() }; tmp.delete(); job.fail(CancelledException()) } }
        job.message = "Vorschau wird erstellt …"
        t.start(item, tmp.absolutePath)
        val holder = ProgressHolder()
        fun poll() {
            if (job.status != "running") return
            if (t.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) { job.progress = holder.progress / 100.0; job.message = "Vorschau wird erstellt … ${holder.progress} %" }
            main.postDelayed({ poll() }, 400)
        }
        poll()
    }
}
