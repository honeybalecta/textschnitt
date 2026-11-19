package de.honeybalecta.textschnitt

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.core.content.FileProvider
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.UnstableApi
import androidx.media3.transformer.Composition
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * HoneyRec auf Android: Die Oberfläche nimmt im WebView mit MediaRecorder auf und schickt jede Sekunde ein Stück an den
 * lokalen Server (POST rec/chunk). Die Stücke wachsen als „.part“-Datei; beim Abschluss schreibt Media3 daraus eine normale,
 * durchsuchbare MP4 (H.264/AAC) – die rohen Dateien des WebViews lassen sich sonst nicht zuverlässig springen.
 */
@OptIn(UnstableApi::class)
object Rec {
    private class Open(val file: File) { @Volatile var bytes = 0L }
    private val open = ConcurrentHashMap<String, Open>()

    fun root(ctx: Context): File = File(ctx.getExternalFilesDir(null) ?: ctx.filesDir, "HoneyRec").apply { mkdirs() }
    private fun clean(s: String, fallback: String) = s.replace(Regex("[\\\\/:*?\"<>|]"), "_").trim(' ', '.').take(80).ifBlank { fallback }
    fun dir(ctx: Context, session: String): File = File(root(ctx), clean(session, "Aufnahme")).apply { mkdirs() }

    fun open(ctx: Context, spec: JSONObject): JSONObject {
        val d = dir(ctx, spec.optString("session"))
        val stem = clean(spec.optString("name"), "Take").take(60)
        val ext = if (spec.optString("mime").contains("webm")) "webm" else "mp4"
        var name = stem; var k = 2
        while (listOf("$ext.part", "roh.$ext", "mp4", "tmp.mp4").any { File(d, "$name.$it").exists() }) name = "$stem (${k++})"
        val f = File(d, "$name.$ext.part")
        f.writeBytes(ByteArray(0))
        val id = UUID.randomUUID().toString().replace("-", "").take(12)
        open[id] = Open(f)
        return JSONObject().put("id", id).put("dir", d.absolutePath).put("file", f.name)
    }

    /** Ein Stück anhängen: genau [len] Bytes aus [inp] (Körper der HTTP-Anfrage). */
    fun append(id: String, inp: InputStream, len: Long): Long {
        val o = open[id] ?: throw IllegalStateException("Diese Aufnahme ist nicht mehr offen.")
        synchronized(o) {
            FileOutputStream(o.file, true).use { out ->
                val buf = ByteArray(1 shl 16); var left = len
                while (left > 0) {
                    val n = inp.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
                    if (n < 0) throw java.io.EOFException("Stück unvollständig")
                    out.write(buf, 0, n); left -= n
                }
            }
            o.bytes += len
            return o.bytes
        }
    }

    private fun uriOf(ctx: Context, f: File): Uri = FileProvider.getUriForFile(ctx, ctx.packageName + ".files", f)

    private fun info(ctx: Context, f: File, meta: JSONObject, stem: String): JSONObject {
        val uri = uriOf(ctx, f)
        val j = Probe.probe(ctx, uri) ?: JSONObject().put("kind", "video").put("hasVideo", true).put("hasAudio", true)
            .put("width", meta.optInt("width")).put("height", meta.optInt("height")).put("fps", 30.0).put("rotation", 0)
        j.put("uri", uri.toString()).put("name", stem)
        if (j.optDouble("duration", 0.0) <= 0.0) j.put("duration", meta.optDouble("duration", 0.0))
        return j
    }

    /** Aufnahme abschließen: roh behalten, in MP4 umschreiben, Ergebnis wie bei der Dateiauswahl (Medium als JSON). */
    fun close(ctx: Context, id: String, meta: JSONObject, job: Job) {
        val o = open.remove(id) ?: return job.fail(IllegalStateException("Diese Aufnahme ist nicht mehr offen."))
        val part = o.file
        val name = part.name.removeSuffix(".part")                   // „Take 01.webm“
        val stem = name.substringBeforeLast('.')
        val raw = File(part.parentFile, "$stem.roh.${name.substringAfterLast('.')}")
        part.renameTo(raw)
        val out = File(part.parentFile, "$stem.mp4")
        val tmp = File(part.parentFile, "$stem.tmp.mp4")
        val main = Handler(Looper.getMainLooper())
        job.message = "Aufnahme wird gesichert …"
        main.post {
            try {
                val t = Transformer.Builder(ctx)
                    .setVideoMimeType(MimeTypes.VIDEO_H264).setAudioMimeType(MimeTypes.AUDIO_AAC)
                    .addListener(object : Transformer.Listener {
                        override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                            Jobs.start { tmp.renameTo(out); raw.delete(); info(ctx, out, meta, stem) }.let { relay(it, job) }
                        }
                        override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                            // Lieber die rohe Aufnahme behalten als gar nichts
                            tmp.delete()
                            Jobs.start { info(ctx, raw, meta, stem) }.let { relay(it, job) }
                        }
                    }).build()
                t.start(EditedMediaItem.Builder(MediaItem.fromUri(Uri.fromFile(raw))).build(), tmp.absolutePath)
                val holder = ProgressHolder()
                fun poll() {
                    if (job.status != "running") return
                    if (t.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) job.progress = holder.progress / 100.0
                    main.postDelayed({ poll() }, 400)
                }
                poll()
            } catch (e: Throwable) {
                Jobs.start { info(ctx, raw, meta, stem) }.let { relay(it, job) }
            }
        }
    }

    /** Ergebnis eines Hilfsauftrags an den eigentlichen Auftrag weiterreichen. */
    private fun relay(inner: Job, outer: Job) {
        Thread {
            while (inner.status == "running") Thread.sleep(50)
            if (inner.status == "done") outer.done(inner.result) else outer.fail(IllegalStateException(inner.error ?: "Sichern fehlgeschlagen"))
        }.start()
    }
}
