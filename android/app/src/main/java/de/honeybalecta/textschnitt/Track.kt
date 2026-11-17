package de.honeybalecta.textschnitt

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.util.Base64
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.Segmentation
import com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions
import org.json.JSONObject
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.roundToInt

/**
 * Person im Bild halten (2.39): liest in festen Abständen ein verkleinertes Bild, lässt ML Kit die Person erkennen
 * (Selfie-Segmentierung, Modell im Programm enthalten) und mittelt die Maske auf 32 × 18 Felder. Aus den Masken
 * rechnet die Oberfläche den Kameraweg (core/web/folgen.js) – genau wie am Windows-Rechner (RVM) und im Browser (MediaPipe).
 * Ergebnis: {step, w, h, n, data} – data ist Base64 mit n·w·h Bytes (0 … 255).
 */
object Track {
    private const val GW = 32
    private const val GH = 18
    private const val MAX = 2400

    fun run(ctx: Context, uri: String, job: Job): JSONObject {
        val src = Uri.parse(uri)
        val info = Probe.probe(ctx, src) ?: throw IllegalStateException("Datei nicht lesbar")
        if (!info.optBoolean("hasVideo", true) || info.optString("kind") == "image") throw IllegalStateException("Die Person lässt sich nur in Videos verfolgen.")
        val dur = info.optDouble("duration", 0.0)
        if (dur <= 0.0) throw IllegalStateException("Das Video ließ sich nicht lesen.")
        val step = maxOf(0.25, ceil(dur / MAX * 20.0) / 20.0)
        val n = maxOf(1, floor(dur / step).toInt())
        val out = ByteArray(n * GW * GH)
        val segmenter = Segmentation.getClient(
            SelfieSegmenterOptions.Builder().setDetectorMode(SelfieSegmenterOptions.SINGLE_IMAGE_MODE).enableRawSizeMask().build())
        val mmr = MediaMetadataRetriever()
        job.message = "Person wird gesucht …"
        try {
            mmr.setDataSource(ctx, src)
            for (i in 0 until n) {
                job.check()
                val full = mmr.getFrameAtTime((i * step * 1e6).toLong(), MediaMetadataRetriever.OPTION_CLOSEST)
                if (full != null) {
                    val k = minOf(1.0, 320.0 / maxOf(full.width, full.height))
                    val sw = maxOf(32, (full.width * k).roundToInt())
                    val sh = maxOf(32, (full.height * k).roundToInt())
                    val small = Bitmap.createScaledBitmap(full, sw, sh, true)
                    val argb = if (small.config == Bitmap.Config.ARGB_8888) small else small.copy(Bitmap.Config.ARGB_8888, false)
                    val mask = Tasks.await(segmenter.process(InputImage.fromBitmap(argb, 0)))
                    val buf = mask.buffer
                    buf.rewind()
                    val mw = mask.width
                    val mh = mask.height
                    val sum = FloatArray(GW * GH)
                    val cnt = IntArray(GW * GH)
                    for (y in 0 until mh) {
                        val gy = minOf(GH - 1, y * GH / mh)
                        for (x in 0 until mw) {
                            val c = gy * GW + minOf(GW - 1, x * GW / mw)
                            sum[c] += buf.getFloat().coerceIn(0f, 1f)
                            cnt[c]++
                        }
                    }
                    val o = i * GW * GH
                    for (c in 0 until GW * GH) out[o + c] = (if (cnt[c] > 0) (sum[c] / cnt[c] * 255f).roundToInt().coerceIn(0, 255) else 0).toByte()
                    if (argb !== small) argb.recycle()
                    if (small !== full) small.recycle()
                    full.recycle()
                }
                job.progress = minOf(0.99, (i + 1).toDouble() / n)
                if (i % 8 == 0) job.message = "Person wird gesucht … ${(i * step).toInt()} von ${dur.toInt()} s"
            }
        } finally {
            runCatching { mmr.release() }
            runCatching { segmenter.close() }
        }
        return JSONObject().put("step", step).put("w", GW).put("h", GH).put("n", n).put("data", Base64.encodeToString(out, Base64.NO_WRAP))
    }
}
