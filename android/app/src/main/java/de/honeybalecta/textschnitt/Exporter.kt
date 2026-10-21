package de.honeybalecta.textschnitt

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Typeface
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.OverlaySettings
import androidx.media3.common.VideoCompositorSettings
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.MatrixTransformation
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.Presentation
import androidx.media3.effect.StaticOverlaySettings
import androidx.media3.effect.TextureOverlay
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.VideoEncoderSettings
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.roundToLong

/**
 * Baut aus dem Schnittplan der Oberfläche eine Media3-Komposition:
 *  – Hauptspur: behaltene Abschnitte + Einschübe (mit Zoom-Effekten), auf Ausgabegröße gebracht
 *  – Overlay-Spur (oben): B-Roll und Bild-im-Bild, dazwischen Lücken, gesteuert per Deckkraft
 *  – Untertitel als eingebranntes Bild-Overlay über allem
 */
@OptIn(UnstableApi::class)
class Exporter(private val ctx: Context, private val plan: JSONObject, private val job: Job) {
    private val main = Handler(Looper.getMainLooper())
    private var transformer: Transformer? = null
    private lateinit var outFile: File
    private val w = plan.getInt("width")
    private val h = plan.getInt("height")

    private fun us(sec: Double) = (sec * 1_000_000).roundToLong()
    private val fps = plan.optDouble("fps", 30.0).let { if (it < 1 || it > 240) 30.0 else it }

    /** Ein Clip aus dem Plan: Video mit Ausschnitt oder Foto mit fester Dauer. */
    private fun item(o: JSONObject, inS: Double, outS: Double, removeAudio: Boolean, effects: List<Effect>): EditedMediaItem {
        val b = if (o.optBoolean("image")) EditedMediaItem.Builder(
            MediaItem.Builder().setUri(Uri.parse(o.getString("uri"))).setImageDurationMs(((outS - inS) * 1000).roundToLong()).build()
        ).setFrameRate(Math.round(fps).toInt())
        else EditedMediaItem.Builder(clip(o.getString("uri"), inS, outS)).setRemoveAudio(removeAudio)
        return b.setEffects(Effects(listOf(), effects)).build()
    }

    private fun clip(uri: String, inS: Double, outS: Double): MediaItem =
        MediaItem.Builder().setUri(Uri.parse(uri)).setClippingConfiguration(
            MediaItem.ClippingConfiguration.Builder()
                .setStartPositionMs((inS * 1000).roundToLong())
                .setEndPositionMs((outS * 1000).roundToLong()).build()
        ).build()

    fun start() {
        job.message = "Export wird vorbereitet …"
        // Hauptspur
        val segs = plan.getJSONArray("segments")
        val mainItems = ArrayList<EditedMediaItem>()
        for (i in 0 until segs.length()) {
            val s = segs.getJSONObject(i)
            val fx = ArrayList<Effect>()
            val zooms = s.optJSONArray("zooms")
            if (zooms != null && zooms.length() > 0) fx.add(ZoomEffect(s.getDouble("in"), zooms))
            fx.add(Presentation.createForWidthAndHeight(w, h, Presentation.LAYOUT_SCALE_TO_FIT))
            mainItems.add(item(s, s.getDouble("in"), s.getDouble("out"), false, fx))
        }
        require(mainItems.isNotEmpty()) { "Nach dem Schnitt bleibt nichts übrig." }
        // Ton und Bild ausdrücklich: Einschübe ohne Tonspur bekommen so Stille statt eines Fehlers
        val mainSeq = EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_AUDIO, C.TRACK_TYPE_VIDEO))
            .addItems(mainItems).build()

        // Overlays (B-Roll / Bild-im-Bild)
        val ovs = plan.optJSONArray("overlays") ?: JSONArray()
        val composition = if (ovs.length() > 0) {
            val total = plan.getDouble("total")
            val list = (0 until ovs.length()).map { ovs.getJSONObject(it) }.sortedBy { it.getDouble("at") }
            val seq = EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_VIDEO))
            val spans = ArrayList<OvSpan>()
            var cursor = 0.0
            for (o in list) {
                val at = maxOf(o.getDouble("at"), cursor)
                val inS = o.getDouble("in"); val outS = o.getDouble("out")
                val dur = minOf(outS - inS, total - at)
                if (dur <= 0.05) continue
                if (at - cursor > 0.01) seq.addGap(us(at - cursor))
                seq.addItem(item(o, inS, inS + dur, true, listOf(Presentation.createForWidthAndHeight(w, h, Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP))))
                spans.add(OvSpan(at, at + dur, o.getString("mode"), o.optString("corner", "or"), o.optDouble("size", 0.33).toFloat()))
                cursor = at + dur
            }
            if (spans.isEmpty()) Composition.Builder(mainSeq)
            else {
                if (total - cursor > 0.01) seq.addGap(us(total - cursor))
                Composition.Builder(seq.build(), mainSeq).setVideoCompositorSettings(OvSettings(w, h, spans))
            }
        } else Composition.Builder(mainSeq)

        // Untertitel
        val subs = plan.optJSONObject("subs")
        if (subs != null && subs.getJSONArray("cues").length() > 0) {
            val overlay: TextureOverlay = SubtitleOverlay(w, h, subs.getJSONArray("cues"), subs.getJSONObject("style"))
            composition.setEffects(Effects(listOf(), listOf(OverlayEffect(listOf(overlay)))))
        }

        outFile = File(ctx.cacheDir, "export_${System.currentTimeMillis()}.mp4")
        // Bitrate passend zur Auflösung (≈ 0,14 Bit pro Pixel), damit die Qualität dem Original nahekommt
        val bitrate = (w.toDouble() * h * fps * 0.14).coerceIn(4e6, 80e6).toInt()
        val encoders = DefaultEncoderFactory.Builder(ctx)
            .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(bitrate).build())
            .setEnableFallback(true).build()
        val t = Transformer.Builder(ctx)
            .setEncoderFactory(encoders)
            .setVideoMimeType(MimeTypes.VIDEO_H264)
            .setAudioMimeType(MimeTypes.AUDIO_AAC)
            .addListener(object : Transformer.Listener {
                override fun onCompleted(composition: Composition, exportResult: ExportResult) = finish()
                override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                    outFile.delete()
                    job.fail(IllegalStateException("Export fehlgeschlagen: ${exportException.errorCodeName} – ${exportException.cause?.message ?: exportException.message}"))
                }
            })
            .build()
        transformer = t
        job.onCancel { main.post { runCatching { t.cancel() }; outFile.delete(); job.fail(CancelledException()) } }
        job.message = "Exportiere …"
        t.start(composition.build(), outFile.absolutePath)
        poll()
    }

    private fun poll() {
        val t = transformer ?: return
        if (job.status != "running") return
        val holder = ProgressHolder()
        if (t.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) {
            job.progress = holder.progress / 100.0 * 0.97
            job.message = "Exportiere … ${holder.progress} %"
        }
        main.postDelayed({ poll() }, 400)
    }

    private fun finish() {
        job.message = "Speichere in der Galerie …"
        Thread {
            var uri: Uri? = null
            try {
                val base = plan.optString("name", "Textschnitt").ifBlank { "Textschnitt" }
                    .replace(Regex("[\\\\/:*?\"<>|]"), "_").take(80)
                val stamp = java.text.SimpleDateFormat("yyyyMMdd_HHmmss", java.util.Locale.GERMANY).format(java.util.Date())
                val name = "${base}_$stamp.mp4"
                val now = System.currentTimeMillis()
                val values = ContentValues().apply {
                    put(MediaStore.Video.Media.DISPLAY_NAME, name)
                    put(MediaStore.Video.Media.TITLE, base)
                    put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
                    put(MediaStore.Video.Media.RELATIVE_PATH, "DCIM/Textschnitt")
                    put(MediaStore.Video.Media.DATE_TAKEN, now)
                    put(MediaStore.Video.Media.DATE_ADDED, now / 1000)
                    put(MediaStore.Video.Media.DATE_MODIFIED, now / 1000)
                    put(MediaStore.Video.Media.IS_PENDING, 1)
                }
                val coll = MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                uri = ctx.contentResolver.insert(coll, values) ?: throw IllegalStateException("Galerie nicht erreichbar")
                ctx.contentResolver.openOutputStream(uri, "w")!!.use { out -> outFile.inputStream().use { it.copyTo(out, 1 shl 20) } }
                values.clear(); values.put(MediaStore.Video.Media.IS_PENDING, 0)
                ctx.contentResolver.update(uri, values, null, null)
                outFile.delete()
                job.done(JSONObject().put("uri", uri.toString()).put("name", name).put("folder", "DCIM/Textschnitt"))
            } catch (e: Throwable) {
                uri?.let { runCatching { ctx.contentResolver.delete(it, null, null) } }
                job.fail(e)
            }
        }.start()
    }

    // ── Overlay-Steuerung ──
    data class OvSpan(val a: Double, val b: Double, val mode: String, val corner: String, val size: Float)

    class OvSettings(private val w: Int, private val h: Int, private val spans: List<OvSpan>) : VideoCompositorSettings {
        private val hidden = StaticOverlaySettings.Builder().setAlphaScale(0f).build()
        private val full = StaticOverlaySettings.Builder().build()
        override fun getOutputSize(inputSizes: List<Size>): Size = Size(w, h)
        override fun getOverlaySettings(inputId: Int, presentationTimeUs: Long): OverlaySettings {
            if (inputId != 0) return full // Hauptspur
            val t = presentationTimeUs / 1e6
            val s = spans.firstOrNull { t >= it.a - 0.001 && t < it.b } ?: return hidden
            if (s.mode != "pip") return full
            val m = 0.06f // Rand in NDC
            val right = s.corner.endsWith("r"); val top = s.corner.startsWith("o")
            val my = m * w / h
            return StaticOverlaySettings.Builder()
                .setScale(s.size, s.size)
                .setOverlayFrameAnchor(if (right) 1f else -1f, if (top) 1f else -1f)
                .setBackgroundFrameAnchor(if (right) 1f - m else -1f + m, if (top) 1f - my else -1f + my)
                .build()
        }
    }

    // ── Zoom (Sprung oder Fahrt) – Zeiten in Sekunden der Quelle ──
    class ZoomEffect(private val segIn: Double, zooms: JSONArray) : MatrixTransformation {
        private data class Z(val at: Double, val dur: Double, val kind: String, val strength: Double, val cx: Double, val cy: Double)
        private val zs = (0 until zooms.length()).map { zooms.getJSONObject(it) }.map {
            Z(it.getDouble("at"), it.getDouble("dur"), it.getString("kind"), it.getDouble("strength"), it.getDouble("cx"), it.getDouble("cy"))
        }
        private var first = Long.MIN_VALUE
        override fun getMatrix(presentationTimeUs: Long): Matrix {
            if (first == Long.MIN_VALUE) first = presentationTimeUs
            val src = segIn + (presentationTimeUs - first) / 1e6
            var s = 1.0; var cx = 0.5; var cy = 0.5
            for (z in zs) {
                if (src < z.at || src > z.at + z.dur) continue
                val p = ((src - z.at) / z.dur).coerceIn(0.0, 1.0); val e = p * p * (3 - 2 * p)
                s = when (z.kind) { "punch" -> z.strength; "out" -> z.strength + (1 - z.strength) * e; else -> 1 + (z.strength - 1) * e }
                cx = z.cx; cy = z.cy
            }
            val m = Matrix()
            if (s > 1.0005) m.setScale(s.toFloat(), s.toFloat(), (2 * cx - 1).toFloat(), (1 - 2 * cy).toFloat())
            return m
        }
    }

    // ── Untertitel als Bild-Overlay in Ausgabegröße ──
    class SubtitleOverlay(private val w: Int, private val h: Int, cues: JSONArray, style: JSONObject) : BitmapOverlay() {
        private data class Cue(val s: Double, val e: Double, val text: String)
        private val list = (0 until cues.length()).map { cues.getJSONObject(it) }.map { Cue(it.getDouble("start"), it.getDouble("end"), it.getString("text")) }
        private val blank: Bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        private var curIdx = -2
        private var cur: Bitmap = blank
        private val size = (when (style.optString("size", "mittel")) { "klein" -> 0.045; "groß" -> 0.075; else -> 0.058 } * minOf(w, h) * (if (h > w) 1.25 else 1.0)).toFloat()
        private val pos = style.optString("pos", "unten")
        private val color = runCatching { Color.parseColor(style.optString("color", "#FFFFFF")) }.getOrDefault(Color.WHITE)
        private val outline = style.optBoolean("outline", true)

        override fun getBitmap(presentationTimeUs: Long): Bitmap {
            val t = presentationTimeUs / 1e6
            val idx = list.indexOfFirst { t >= it.s && t < it.e }
            if (idx != curIdx) { curIdx = idx; cur = if (idx < 0) blank else render(list[idx].text) }
            return cur
        }

        private fun render(text: String): Bitmap {
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val c = Canvas(bmp)
            val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { textSize = size; typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD) }
            val width = (w * 0.88).toInt()
            fun layout(p: TextPaint) = StaticLayout.Builder.obtain(text, 0, text.length, p, width)
                .setAlignment(Layout.Alignment.ALIGN_CENTER).setLineSpacing(0f, 1.08f).build()
            val fill = layout(paint.apply { color = this@SubtitleOverlay.color; style = Paint.Style.FILL })
            val margin = h * 0.07f
            val y = when (pos) { "oben" -> margin; "mitte" -> (h - fill.height) / 2f; else -> h - margin - fill.height }
            c.save(); c.translate((w - width) / 2f, y)
            if (outline) {
                val sp = TextPaint(paint).apply { style = Paint.Style.STROKE; strokeWidth = size / 7f; strokeJoin = Paint.Join.ROUND; color = Color.BLACK }
                layout(sp).draw(c)
            } else {
                paint.setShadowLayer(size / 10f, 0f, size / 20f, Color.argb(200, 0, 0, 0))
            }
            fill.draw(c)
            c.restore()
            return bmp
        }

        override fun getOverlaySettings(presentationTimeUs: Long): OverlaySettings = StaticOverlaySettings.Builder().build()
    }
}
