package de.honeybalecta.textschnitt

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** Whisper-Modelle (ggml): eines steckt in der App, weitere werden bei Bedarf geladen. */
object Models {
    data class M(val name: String, val label: String, val file: String, val sizeMb: Int, val recommended: Boolean = false) {
        val url get() = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/$file"
    }

    val all = listOf(
        M("base", "base · am schnellsten", "ggml-base-q5_1.bin", 57),
        M("small", "small · schnell & gut", "ggml-small-q5_1.bin", 190, recommended = true),
        M("large-v3-turbo", "large-v3-turbo · am genauesten, langsam", "ggml-large-v3-turbo-q5_0.bin", 574),
    )

    private fun dir(ctx: Context) = File(ctx.filesDir, "models").apply { mkdirs() }
    private fun bundled(ctx: Context, m: M) = runCatching { ctx.assets.list("models")?.contains(m.file) == true }.getOrDefault(false)
    private fun local(ctx: Context, m: M) = File(dir(ctx), m.file)

    fun list(ctx: Context): String = JSONArray().apply {
        for (m in all) put(JSONObject().apply {
            put("name", m.name); put("label", m.label); put("sizeMb", m.sizeMb); put("recommended", m.recommended)
            put("bundled", bundled(ctx, m)); put("installed", local(ctx, m).exists() || bundled(ctx, m))
        })
    }.toString()

    /** Pfad zur Modelldatei; ein mitgeliefertes Modell wird beim ersten Mal aus der App kopiert. */
    fun path(ctx: Context, name: String, job: Job): String {
        val m = all.firstOrNull { it.name == name } ?: throw IllegalArgumentException("Unbekanntes Modell: $name")
        val f = local(ctx, m)
        if (f.exists()) return f.absolutePath
        if (!bundled(ctx, m)) throw IllegalStateException("Das Modell „${m.name}“ ist noch nicht geladen (⚙ auf der Startseite).")
        job.message = "Modell wird vorbereitet (nur beim ersten Mal) …"
        val tmp = File(f.path + ".part")
        ctx.assets.open("models/${m.file}").use { input -> tmp.outputStream().use { input.copyTo(it, 1 shl 20) } }
        tmp.renameTo(f)
        return f.absolutePath
    }

    fun download(ctx: Context, name: String, job: Job): Any? {
        val m = all.firstOrNull { it.name == name } ?: throw IllegalArgumentException("Unbekanntes Modell: $name")
        val f = local(ctx, m)
        if (f.exists()) return null
        val tmp = File(f.path + ".part")
        var url = URL(m.url)
        var conn: HttpURLConnection
        var hops = 0
        while (true) {
            conn = url.openConnection() as HttpURLConnection
            conn.instanceFollowRedirects = false
            conn.connectTimeout = 20000; conn.readTimeout = 30000
            val code = conn.responseCode
            if (code in 300..399 && hops++ < 8) { url = URL(url, conn.getHeaderField("Location")); conn.disconnect(); continue }
            if (code != 200) throw IllegalStateException("Download fehlgeschlagen (HTTP $code)")
            break
        }
        val total = conn.contentLengthLong.takeIf { it > 0 } ?: (m.sizeMb * 1_000_000L)
        job.onCancel { runCatching { conn.disconnect() } }
        conn.inputStream.use { input ->
            tmp.outputStream().use { out ->
                val buf = ByteArray(1 shl 16); var done = 0L
                while (true) {
                    job.check()
                    val n = input.read(buf); if (n < 0) break
                    out.write(buf, 0, n); done += n
                    job.progress = (done.toDouble() / total).coerceAtMost(0.99)
                    job.message = "%.0f von %d MB".format(done / 1e6, total / 1_000_000)
                }
            }
        }
        if (!tmp.renameTo(f)) throw IllegalStateException("Modell konnte nicht gespeichert werden")
        return null
    }
}
