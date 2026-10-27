package de.honeybalecta.textschnitt

import android.content.Context
import android.net.Uri
import org.json.JSONObject

/** Schnittstelle zu whisper.cpp (libtsnative.so). */
object Whisper {
    init { System.loadLibrary("tsnative") }

    interface Progress { fun onProgress(percent: Int) }

    @JvmStatic external fun transcribe(model: String, audio: FloatArray, language: String, prompt: String, threads: Int, cb: Progress): ByteArray
    @JvmStatic external fun abort()
    @JvmStatic external fun systemInfo(): String
}

object Transcriber {
    private val FILLER_PROMPT = mapOf(
        "de" to "Ähm, also, äh, ich mein, hm, ja. Also ich – ich wollte, das ist, das ist ja so. Ähm, äh.",
        "en" to "Um, uh, so, like, you know, hmm. So I – I wanted, this is, this is like. Uh, um.",
    )

    fun run(ctx: Context, uri: Uri, model: String, lang: String, fillers: Boolean, job: Job): JSONObject {
        val t0 = System.currentTimeMillis()
        job.message = "Ton wird gelesen …"
        val audio = AudioDecoder.decode(ctx, uri, job, 0.08)
        job.check()
        val modelPath = Models.path(ctx, model, job)
        job.check()
        val cores = Runtime.getRuntime().availableProcessors()
        val threads = (cores - 2).coerceIn(2, 6)
        job.message = "Transkribiere …"
        job.onCancel { Whisper.abort() }
        val tStart = System.currentTimeMillis()
        val prompt = if (fillers) FILLER_PROMPT[lang.ifEmpty { "de" }] ?: "" else ""
        val bytes = Whisper.transcribe(modelPath, audio, lang, prompt, threads, object : Whisper.Progress {
            override fun onProgress(percent: Int) {
                job.progress = 0.08 + 0.91 * percent / 100.0
                val el = (System.currentTimeMillis() - tStart) / 1000
                val rest = if (percent in 3..99) (el * (100 - percent) / percent) else -1
                job.message = "Transkribiere … $percent %" + if (rest >= 0) " · noch ca. ${rest / 60}:${"%02d".format(rest % 60)}" else ""
            }
        })
        job.check()
        val res = JSONObject(String(bytes, Charsets.UTF_8))
        if (res.has("error")) throw IllegalStateException(res.getString("error"))
        res.put("seconds", (System.currentTimeMillis() - t0) / 1000)
        res.put("env", envelope(audio))
        return res
    }

    /** Einzelne Stellen getrennt transkribieren (Lücken, die im Zusammenhang ausgelassen wurden). Zeiten in Sekunden der Datei. */
    fun runRanges(ctx: Context, uri: Uri, model: String, lang: String, ranges: org.json.JSONArray, job: Job): JSONObject {
        job.message = "Ton wird gelesen …"
        val audio = AudioDecoder.decode(ctx, uri, job, 0.3)
        job.check()
        val modelPath = Models.path(ctx, model, job)
        val threads = (Runtime.getRuntime().availableProcessors() - 2).coerceIn(2, 6)
        job.onCancel { Whisper.abort() }
        val out = org.json.JSONArray()
        val pad = 0.15
        for (n in 0 until ranges.length()) {
            job.check()
            job.message = "Nicht erkannte Stellen nachhören (${n + 1} von ${ranges.length()})"
            job.progress = 0.3 + 0.7 * n / ranges.length()
            val r = ranges.getJSONArray(n)
            val s0 = maxOf(0, ((r.getDouble(0) - pad) * 16000).toInt()); val e0 = minOf(audio.size, ((r.getDouble(1) + pad) * 16000).toInt())
            val words = org.json.JSONArray()
            if (e0 - s0 >= 3200) {
                val res = JSONObject(String(Whisper.transcribe(modelPath, audio.copyOfRange(s0, e0), lang, "", threads, object : Whisper.Progress {
                    override fun onProgress(percent: Int) {}
                }), Charsets.UTF_8))
                val ws = res.optJSONArray("words") ?: org.json.JSONArray()
                for (i in 0 until ws.length()) {
                    val w = ws.getJSONObject(i)
                    words.put(JSONObject().put("text", w.getString("text")).put("start", w.getDouble("start") + s0 / 16000.0)
                        .put("end", w.getDouble("end") + s0 / 16000.0).put("prob", w.optDouble("prob", 0.5)))
                }
            }
            out.put(JSONObject().put("words", words))
        }
        return JSONObject().put("ranges", out)
    }

    /** Lautstärke in 10-ms-Schritten (dB, 0…255) als Base64 – damit setzt die Oberfläche Schnitte in Sprechpausen. */
    fun envelope(a: FloatArray): String {
        val n = a.size / 160
        val out = ByteArray(n)
        for (i in 0 until n) {
            var sum = 0.0
            for (j in i * 160 until i * 160 + 160) { val x = a[j].toDouble(); sum += x * x }
            val db = (20 * kotlin.math.log10(kotlin.math.sqrt(sum / 160) + 1e-9)).coerceIn(-90.0, 0.0)
            out[i] = Math.round((db + 90) * 2.8).toInt().coerceIn(0, 255).toByte()
        }
        return android.util.Base64.encodeToString(out, android.util.Base64.NO_WRAP)
    }
}
