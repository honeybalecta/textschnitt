package de.honeybalecta.textschnitt

import android.content.Context
import android.content.res.AssetFileDescriptor
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.MimeTypeMap
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.EOFException
import java.io.File
import java.io.InputStream
import java.io.OutputStream

/** MIME-Typ einer Datei, auch für file://-Adressen (dort über die Endung). */
fun mimeOf(ctx: Context, uri: Uri): String? = ctx.contentResolver.getType(uri)
    ?: MimeTypeMap.getSingleton().getMimeTypeFromExtension(MimeTypeMap.getFileExtensionFromUrl(uri.toString()).lowercase())

/**
 * Projektpaket (.honeycut): ein Projekt samt Videos, Bildern und Schriften, um auf einem anderen Gerät weiterzuarbeiten.
 * Aufbau: "HONEYCUT1\n", 8 Byte Länge (little endian), Kopf als JSON (UTF-8), danach die Dateien in der Reihenfolge des Kopfes.
 * Den Kopf (Projekt mit Platzhaltern statt Dateipfaden) baut die Oberfläche; hier werden nur Bytes geschrieben und gelesen.
 */
object Package {
    private val MAGIC = "HONEYCUT1\n".toByteArray(Charsets.US_ASCII)

    private fun sizeOf(ctx: Context, uri: Uri): Long {
        if (uri.scheme == "file" || uri.scheme == null) return File(uri.path ?: uri.toString()).length()
        var len = runCatching { ctx.contentResolver.openAssetFileDescriptor(uri, "r")?.use { it.length } }.getOrNull() ?: AssetFileDescriptor.UNKNOWN_LENGTH
        if (len < 0) ctx.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c -> if (c.moveToFirst() && !c.isNull(0)) len = c.getLong(0) }
        return len
    }
    private fun open(ctx: Context, uri: String): InputStream =
        if (uri.startsWith("/")) File(uri).inputStream() else ctx.contentResolver.openInputStream(Uri.parse(uri))!!
    private fun uriOf(uri: String): Uri = if (uri.startsWith("/")) Uri.fromFile(File(uri)) else Uri.parse(uri)

    private fun copy(inp: InputStream, out: OutputStream, n: Long, job: Job, done: LongArray, total: Long, label: String) {
        val buf = ByteArray(1 shl 16); var left = n
        while (left > 0) {
            job.check()
            val r = inp.read(buf, 0, minOf(buf.size.toLong(), left).toInt())
            if (r < 0) throw EOFException("Datei endet zu früh: $label")
            out.write(buf, 0, r); left -= r; done[0] += r
            if (total > 0) job.progress = (done[0].toDouble() / total).coerceAtMost(0.99)
        }
        job.message = "$label · ${done[0] / 1_000_000} von ${total / 1_000_000} MB"
    }

    /** spec: {header:{…, files:[{n, name, kind, …}]}, files:[{n, uri, include}]} → schreibt das Paket nach dest. */
    fun write(ctx: Context, dest: Uri, spec: JSONObject, job: Job): JSONObject {
        val header = spec.getJSONObject("header")
        val hf = header.getJSONArray("files")
        val src = spec.getJSONArray("files")
        val plan = ArrayList<Pair<String, Long>>()   // Quelle, Größe – in Reihenfolge des Kopfes
        for (i in 0 until hf.length()) {
            val h = hf.getJSONObject(i)
            val s = (0 until src.length()).map { src.getJSONObject(it) }.firstOrNull { it.getString("n") == h.getString("n") }
            val size = if (s != null && s.optBoolean("include", true)) runCatching { sizeOf(ctx, uriOf(s.getString("uri"))) }.getOrDefault(-1L) else -1L
            h.put("size", maxOf(0L, size)); h.put("included", size > 0)
            if (size > 0) plan.add(s!!.getString("uri") to size)
        }
        val total = plan.sumOf { it.second }
        val head = header.toString().toByteArray(Charsets.UTF_8)
        val done = longArrayOf(0)
        ctx.contentResolver.openOutputStream(dest, "w")!!.use { raw ->
            BufferedOutputStream(raw, 1 shl 16).use { out ->
                out.write(MAGIC)
                val len = head.size.toLong()
                for (k in 0 until 8) out.write(((len shr (8 * k)) and 0xFF).toInt())
                out.write(head)
                for ((uri, size) in plan) {
                    open(ctx, uri).use { inp -> copy(BufferedInputStream(inp, 1 shl 16), out, size, job, done, total, "Projekt wird gepackt") }
                }
            }
        }
        return JSONObject().put("bytes", total + head.size + 18).put("name", spec.optString("name"))
    }

    /** Liest ein Paket: Dateien landen im App-Ordner „Importiert“, Schriften bei den eigenen Schriften. */
    fun read(ctx: Context, src: Uri, job: Job, fontDir: File): JSONObject {
        ctx.contentResolver.openInputStream(src)!!.use { raw ->
            val inp = BufferedInputStream(raw, 1 shl 16)
            val magic = ByteArray(MAGIC.size); readFully(inp, magic)
            if (!magic.contentEquals(MAGIC)) throw IllegalArgumentException("Das ist kein HoneyCut-Projekt (.honeycut).")
            val lb = ByteArray(8); readFully(inp, lb)
            var len = 0L; for (k in 0 until 8) len = len or ((lb[k].toLong() and 0xFF) shl (8 * k))
            if (len <= 0 || len > 200_000_000) throw IllegalArgumentException("Projektdatei ist beschädigt.")
            val hb = ByteArray(len.toInt()); readFully(inp, hb)
            val header = JSONObject(String(hb, Charsets.UTF_8))
            val pid = header.optJSONObject("project")?.optString("id").orEmpty().filter { it.isLetterOrDigit() || it == '-' || it == '_' }.ifBlank { "projekt" }
            val dir = File(ctx.getExternalFilesDir(null) ?: ctx.filesDir, "Importiert/$pid").apply { mkdirs() }
            val files = header.getJSONArray("files")
            val total = (0 until files.length()).sumOf { files.getJSONObject(it).let { f -> if (f.optBoolean("included")) f.optLong("size") else 0L } }
            val done = longArrayOf(0); val map = JSONObject()
            for (i in 0 until files.length()) {
                val f = files.getJSONObject(i)
                if (!f.optBoolean("included")) continue
                val size = f.getLong("size")
                val name = f.optString("name").replace(Regex("[^\\p{L}\\p{N} _.()-]"), "_").ifBlank { f.getString("n") }.take(120)
                if (f.optString("kind") == "font") {
                    val bytes = ByteArray(size.toInt()); readFully(inp, bytes); done[0] += size
                    var out = File(fontDir, name); var k = 2
                    while (out.exists() && !out.readBytes().contentEquals(bytes)) out = File(fontDir, "${name.substringBeforeLast('.')}_${k++}.${name.substringAfterLast('.', "ttf")}")
                    if (!out.exists()) out.writeBytes(bytes)
                    map.put(f.getString("n"), out.path); continue
                }
                var out = File(dir, name); var k = 2
                while (out.exists() && out.length() != size) out = File(dir, "${name.substringBeforeLast('.')}_${k++}.${name.substringAfterLast('.', "")}")
                if (out.exists() && out.length() == size) skip(inp, size, job, done, total)   // schon da (erneuter Import)
                else {
                    val tmp = File(out.path + ".part")
                    tmp.outputStream().use { o -> BufferedOutputStream(o, 1 shl 16).use { copy(inp, it, size, job, done, total, "Projekt wird entpackt") } }
                    if (!tmp.renameTo(out)) { tmp.copyTo(out, true); tmp.delete() }
                }
                map.put(f.getString("n"), Uri.fromFile(out).toString())
            }
            return JSONObject().put("header", header).put("map", map)
        }
    }

    private fun readFully(inp: InputStream, b: ByteArray) {
        var o = 0
        while (o < b.size) { val r = inp.read(b, o, b.size - o); if (r < 0) throw EOFException("Projektdatei ist unvollständig."); o += r }
    }
    private fun skip(inp: InputStream, n: Long, job: Job, done: LongArray, total: Long) {
        var left = n; val buf = ByteArray(1 shl 16)
        while (left > 0) { job.check(); val r = inp.read(buf, 0, minOf(buf.size.toLong(), left).toInt()); if (r < 0) throw EOFException("Projektdatei ist unvollständig."); left -= r; done[0] += r }
        if (total > 0) job.progress = (done[0].toDouble() / total).coerceAtMost(0.99)
    }
}
