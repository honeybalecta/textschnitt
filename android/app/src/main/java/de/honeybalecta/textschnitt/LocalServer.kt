package de.honeybalecta.textschnitt

import android.content.Context
import android.content.res.AssetFileDescriptor
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import android.util.LruCache
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import java.security.SecureRandom
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Kleiner HTTP-Server nur für die App (127.0.0.1, mit Zufallsschlüssel im Pfad).
 * Liefert Oberfläche, Videos (mit Byte-Bereichen, damit der Player springen kann) und Vorschaubilder.
 */
class LocalServer(private val ctx: Context) {
    companion object { const val DECK_PACKAGE = "de.honeybalecta.honeydeck" }
    private val token = ByteArray(12).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
    private val server = ServerSocket(0, 64, InetAddress.getByName("127.0.0.1"))
    private val pool = Executors.newCachedThreadPool()
    @Volatile private var running = true
    private val thumbs = object : LruCache<String, ByteArray>(24 * 1024 * 1024) { override fun sizeOf(key: String, value: ByteArray) = value.size }
    private val retrievers = ConcurrentHashMap<String, MediaMetadataRetriever>()

    val base: String get() = "http://127.0.0.1:${server.localPort}/$token/"

    fun start(): LocalServer {
        Thread({
            while (running) {
                val s = try { server.accept() } catch (e: Exception) { if (running) continue else break }
                pool.execute { serve(s) }
            }
        }, "ts-http").apply { isDaemon = true }.start()
        return this
    }

    fun stop() {
        running = false
        runCatching { server.close() }
        retrievers.values.forEach { runCatching { it.release() } }
        pool.shutdownNow()
    }

    // ───────── HTTP ─────────
    private class Req(val method: String, val path: String, val query: Map<String, String>, val headers: Map<String, String>)

    private fun readLine(inp: InputStream): String? {
        val sb = StringBuilder()
        while (true) {
            val c = inp.read()
            if (c < 0) return if (sb.isEmpty()) null else sb.toString()
            if (c == '\n'.code) return sb.toString().trimEnd('\r')
            sb.append(c.toChar())
            if (sb.length > 16384) return null
        }
    }

    private fun parse(inp: InputStream): Req? {
        val first = readLine(inp) ?: return null
        val parts = first.split(" ")
        if (parts.size < 2) return null
        val headers = HashMap<String, String>()
        while (true) {
            val l = readLine(inp) ?: return null
            if (l.isEmpty()) break
            val i = l.indexOf(':')
            if (i > 0) headers[l.substring(0, i).trim().lowercase()] = l.substring(i + 1).trim()
        }
        val target = parts[1]
        val qi = target.indexOf('?')
        val path = if (qi >= 0) target.substring(0, qi) else target
        val query = HashMap<String, String>()
        if (qi >= 0) for (kv in target.substring(qi + 1).split('&')) {
            val e = kv.indexOf('=')
            if (e > 0) query[URLDecoder.decode(kv.substring(0, e), "UTF-8")] = URLDecoder.decode(kv.substring(e + 1), "UTF-8")
        }
        return Req(parts[0], URLDecoder.decode(path, "UTF-8"), query, headers)
    }

    private fun serve(sock: Socket) {
        sock.use { s ->
            s.soTimeout = 20000
            s.tcpNoDelay = true
            val inp = BufferedInputStream(s.getInputStream())
            val out = s.getOutputStream()
            try {
                while (true) {
                    val r = parse(inp) ?: return
                    val prefix = "/$token/"
                    if (!r.path.startsWith(prefix)) { send(out, 404, "Not Found", "text/plain", "nicht gefunden".toByteArray()); return }
                    val sub = r.path.removePrefix(prefix)
                    when {
                        sub == "media" -> media(out, r)
                        sub == "thumb" -> thumb(out, r)
                        sub.startsWith("deck/") -> deckAsset(out, sub.removePrefix("deck/").ifEmpty { "index.html" })
                        else -> asset(out, sub.ifEmpty { "index.html" })
                    }
                    out.flush()
                    if (r.headers["connection"]?.equals("close", true) == true) return
                }
            } catch (e: Exception) {
                // Der Player bricht Verbindungen beim Springen ab – das ist normal.
            }
        }
    }

    private fun header(out: OutputStream, code: Int, reason: String, type: String, len: Long, extra: Map<String, String> = emptyMap()) {
        val sb = StringBuilder("HTTP/1.1 $code $reason\r\nContent-Type: $type\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\n")
        sb.append(if (len >= 0) "Content-Length: $len\r\nConnection: keep-alive\r\n" else "Connection: close\r\n")
        for ((k, v) in extra) sb.append(k).append(": ").append(v).append("\r\n")
        sb.append("\r\n")
        out.write(sb.toString().toByteArray(Charsets.ISO_8859_1))
    }

    private fun send(out: OutputStream, code: Int, reason: String, type: String, body: ByteArray) {
        header(out, code, reason, type, body.size.toLong()); out.write(body)
    }

    // HoneyDeck: Dateien kommen aus der installierten HoneyDeck-App (fehlt sie, gibt es 404 und HoneyCut nutzt den eingebauten Folien-Reiter)
    private fun deckAsset(out: OutputStream, path: String) {
        if (path.contains("..")) { send(out, 404, "Not Found", "text/plain", ByteArray(0)); return }
        val bytes = runCatching { ctx.createPackageContext(DECK_PACKAGE, 0).assets.open("deck/$path").use { it.readBytes() } }.getOrNull()
            ?: run { send(out, 404, "Not Found", "text/plain", ByteArray(0)); return }
        send(out, 200, "OK", typeOf(path), bytes)
    }

    private fun typeOf(path: String) = when (path.substringAfterLast('.')) {
        "html" -> "text/html; charset=utf-8"; "js" -> "application/javascript; charset=utf-8"; "css" -> "text/css; charset=utf-8"
        "svg" -> "image/svg+xml"; "png" -> "image/png"; "ttf" -> "font/ttf"; "otf" -> "font/otf"; "webmanifest" -> "application/manifest+json"
        "txt", "md" -> "text/plain; charset=utf-8"; else -> "application/octet-stream"
    }

    private fun asset(out: OutputStream, path: String) {
        if (path.contains("..")) { send(out, 404, "Not Found", "text/plain", ByteArray(0)); return }
        val type = when (path.substringAfterLast('.')) {
            "html" -> "text/html; charset=utf-8"; "js" -> "application/javascript; charset=utf-8"; "css" -> "text/css; charset=utf-8"
            "svg" -> "image/svg+xml"; "png" -> "image/png"; "ttf" -> "font/ttf"; "otf" -> "font/otf"
            "txt", "md" -> "text/plain; charset=utf-8"; else -> "application/octet-stream"
        }
        val bytes = try { ctx.assets.open("web/$path").use { it.readBytes() } } catch (e: Exception) { send(out, 404, "Not Found", "text/plain", ByteArray(0)); return }
        send(out, 200, "OK", type, bytes)
    }

    // ───────── Video mit Byte-Bereichen ─────────
    private fun media(out: OutputStream, r: Req) {
        val fontDir = File(ctx.filesDir, "fonts").canonicalPath + File.separator
        val file = r.query["f"]?.let { File(it) }?.takeIf { it.exists() && (it.canonicalPath.startsWith(ctx.cacheDir.canonicalPath) || it.canonicalPath.startsWith(fontDir)) }
        val uri = r.query["u"]?.let { Uri.parse(it) }
        val (size, type, open) = when {
            file != null -> Triple(file.length(), when (file.extension.lowercase()) { "ttf" -> "font/ttf"; "otf" -> "font/otf"; else -> "video/mp4" }) { FileInputStream(file) as InputStream }
            uri != null -> {
                val afd = ctx.contentResolver.openAssetFileDescriptor(uri, "r") ?: run { send(out, 404, "Not Found", "text/plain", ByteArray(0)); return }
                var len = afd.length
                if (len == AssetFileDescriptor.UNKNOWN_LENGTH) {
                    ctx.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c -> if (c.moveToFirst() && !c.isNull(0)) len = c.getLong(0) }
                }
                runCatching { afd.close() }
                Triple(len, mimeOf(ctx, uri) ?: "video/mp4") { ctx.contentResolver.openInputStream(uri)!! }
            }
            else -> { send(out, 400, "Bad Request", "text/plain", ByteArray(0)); return }
        }
        if (size <= 0) { // Größe unbekannt: alles am Stück
            open().use { inp -> header(out, 200, "OK", type, -1, mapOf("Accept-Ranges" to "none")); inp.copyTo(out, 1 shl 16) }
            out.flush(); throw java.io.EOFException("Ende ohne Länge")
        }
        var start = 0L
        var end = size - 1
        var partial = false
        r.headers["range"]?.let { range ->
            val m = Regex("bytes=(\\d*)-(\\d*)").find(range)
            if (m != null) {
                partial = true
                val a = m.groupValues[1]; val b = m.groupValues[2]
                if (a.isEmpty() && b.isNotEmpty()) { start = maxOf(0, size - b.toLong()) }
                else { start = a.toLongOrNull() ?: 0L; if (b.isNotEmpty()) end = minOf(b.toLong(), size - 1) }
            }
        }
        if (start >= size) {
            header(out, 416, "Range Not Satisfiable", type, 0, mapOf("Content-Range" to "bytes */$size")); return
        }
        val len = end - start + 1
        if (r.method == "HEAD") { header(out, if (partial) 206 else 200, if (partial) "Partial Content" else "OK", type, len, mapOf("Accept-Ranges" to "bytes")); return }
        open().use { inp ->
            var skipped = 0L
            while (skipped < start) { val n = inp.skip(start - skipped); if (n <= 0) { if (inp.read() < 0) break; skipped++ } else skipped += n }
            val extra = mutableMapOf("Accept-Ranges" to "bytes")
            if (partial) extra["Content-Range"] = "bytes $start-$end/$size"
            header(out, if (partial) 206 else 200, if (partial) "Partial Content" else "OK", type, len, extra)
            val buf = ByteArray(1 shl 16); var left = len
            while (left > 0) {
                val n = inp.read(buf, 0, minOf(buf.size.toLong(), left).toInt()); if (n < 0) break
                out.write(buf, 0, n); left -= n
            }
        }
    }

    // ───────── Vorschaubilder für die Zeitleiste ─────────
    private fun thumb(out: OutputStream, r: Req) {
        val u = r.query["u"] ?: return send(out, 400, "Bad Request", "text/plain", ByteArray(0))
        val t = r.query["t"]?.toDoubleOrNull() ?: 0.0
        val h = (r.query["h"]?.toIntOrNull() ?: 120).coerceIn(32, 360)
        val key = "$u|$t|$h"
        val bytes = thumbs.get(key) ?: imageThumb(u, h, key) ?: run {
            val mmr = retrievers.getOrPut(u) { MediaMetadataRetriever().apply { setDataSource(ctx, Uri.parse(u)) } }
            val bmp: Bitmap? = synchronized(mmr) {
                runCatching {
                    val w0 = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 16
                    val h0 = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 9
                    val rot = mmr.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
                    val (dw, dh) = if (rot % 180 != 0) h0 to w0 else w0 to h0
                    val tw = maxOf(16, h * dw / maxOf(1, dh))
                    mmr.getScaledFrameAtTime((t * 1_000_000).toLong(), MediaMetadataRetriever.OPTION_CLOSEST_SYNC, tw, h)
                }.onFailure { Log.w("Textschnitt", "Vorschaubild", it) }.getOrNull()
            }
            if (bmp == null) return send(out, 404, "Not Found", "text/plain", ByteArray(0))
            val bo = ByteArrayOutputStream(); bmp.compress(Bitmap.CompressFormat.JPEG, 72, bo); bmp.recycle()
            bo.toByteArray().also { thumbs.put(key, it) }
        }
        send(out, 200, "OK", "image/jpeg", bytes)
    }

    /** Vorschau für Fotos: verkleinert dekodieren, EXIF-Drehung anwenden. */
    private fun imageThumb(u: String, h: Int, key: String): ByteArray? {
        val uri = Uri.parse(u)
        if (mimeOf(ctx, uri)?.startsWith("image/") != true) return null
        return runCatching {
            val o = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
            ctx.contentResolver.openInputStream(uri)!!.use { android.graphics.BitmapFactory.decodeStream(it, null, o) }
            var sample = 1
            while (minOf(o.outWidth, o.outHeight) / (sample * 2) >= h) sample *= 2
            val bmp0 = ctx.contentResolver.openInputStream(uri)!!.use {
                android.graphics.BitmapFactory.decodeStream(it, null, android.graphics.BitmapFactory.Options().apply { inSampleSize = sample })
            } ?: return null
            val rot = Probe.exifRotation(ctx, uri)
            val m = android.graphics.Matrix().apply { postRotate(rot.toFloat()) }
            val rotated = if (rot != 0) Bitmap.createBitmap(bmp0, 0, 0, bmp0.width, bmp0.height, m, true) else bmp0
            val scaled = Bitmap.createScaledBitmap(rotated, maxOf(16, rotated.width * h / maxOf(1, rotated.height)), h, true)
            val bo = ByteArrayOutputStream(); scaled.compress(Bitmap.CompressFormat.JPEG, 75, bo)
            bo.toByteArray().also { thumbs.put(key, it) }
        }.getOrNull()
    }
}
