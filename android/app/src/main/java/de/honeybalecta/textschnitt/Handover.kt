package de.honeybalecta.textschnitt

import android.content.Context
import android.net.Uri
import org.json.JSONObject
import java.io.BufferedInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FilterInputStream
import java.io.InputStream
import java.net.InetSocketAddress
import java.net.Socket

/**
 * Übergabe im Heimnetz: Die Windows-App öffnet für die Dauer ihres Blatts „Ans Handy übergeben“ einen Empfang und zeigt dessen
 * Adresse als QR-Code (http://<Adresse im Heimnetz>:<Port>/h/<Einmal-Kennung>). Von dort holt die App ein Projektpaket oder
 * gibt eines zurück – ohne Datei, die man verschicken muss.
 *
 * Gesprochen wird schlichtes HTTP über eine eigene Verbindung, nur zu Adressen im Heimnetz. So bleiben die Netz-Regeln der App
 * streng (unverschlüsselt ist sonst allein der Server auf dem Handy selbst erlaubt).
 */
object Handover {
    private class Target(val host: String, val port: Int, val path: String)

    private val LOCAL = Regex("""^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|169\.254\.\d{1,3}\.\d{1,3})$""")

    private fun parse(url: String): Target {
        val u = Uri.parse(url.trim())
        val host = u.host ?: ""
        val path = (u.path ?: "").trimEnd('/')
        if (u.scheme != "http" || u.port <= 0 || !path.startsWith("/h/") || path.length < 9) throw IllegalArgumentException("Diese Adresse passt nicht.")
        if (!LOCAL.matches(host)) throw IllegalArgumentException("Die Übergabe geht nur zu einem Computer im eigenen WLAN.")
        return Target(host, u.port, path)
    }

    private fun connect(t: Target, readTimeoutMs: Int): Socket =
        Socket().apply { connect(InetSocketAddress(t.host, t.port), 6000); soTimeout = readTimeoutMs }

    private fun line(inp: InputStream): String {
        val b = ByteArrayOutputStream()
        while (true) {
            val c = inp.read()
            if (c < 0 || c == '\n'.code) break
            if (c != '\r'.code) b.write(c)
            if (b.size() > 8192) throw IllegalStateException("Antwort des Computers ist unlesbar.")
        }
        return String(b.toByteArray(), Charsets.ISO_8859_1)
    }

    /** Statuszeile und Kopfzeilen lesen; Rückgabe: Statuscode und Länge des Rumpfs (−1 = unbekannt). */
    private fun head(inp: InputStream): Pair<Int, Long> {
        val code = line(inp).split(' ').getOrNull(1)?.toIntOrNull() ?: throw IllegalStateException("Antwort des Computers ist unlesbar.")
        var len = -1L
        while (true) {
            val l = line(inp)
            if (l.isEmpty()) break
            val k = l.substringBefore(':').trim().lowercase()
            if (k == "content-length") len = l.substringAfter(':').trim().toLongOrNull() ?: -1L
        }
        return code to len
    }

    private fun body(inp: InputStream, len: Long): String {
        val out = ByteArrayOutputStream(); val buf = ByteArray(8192); var left = if (len < 0) 1_000_000L else minOf(len, 1_000_000L)
        while (left > 0) { val r = inp.read(buf, 0, minOf(buf.size.toLong(), left).toInt()); if (r < 0) break; out.write(buf, 0, r); left -= r }
        return String(out.toByteArray(), Charsets.UTF_8)
    }

    private fun request(t: Target, method: String, sub: String, extra: String = ""): String =
        "$method ${t.path}/$sub HTTP/1.1\r\nHost: ${t.host}:${t.port}\r\nUser-Agent: HoneyCut-Android\r\nConnection: close\r\n$extra\r\n"

    /** Höchstens n Bytes aus der Verbindung – der Rumpf einer Antwort. */
    private class Limited(inp: InputStream, private var left: Long) : FilterInputStream(inp) {
        override fun read(): Int { if (left <= 0) return -1; val r = super.read(); if (r >= 0) left--; return r }
        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (left <= 0) return -1
            val r = super.read(b, off, minOf(len.toLong(), left).toInt()); if (r > 0) left -= r
            return r
        }
    }

    private fun errorOf(text: String, code: Int): String =
        runCatching { JSONObject(text).optString("error") }.getOrDefault("").ifBlank { "Der Computer meldet einen Fehler ($code)." }

    /** Auskunft des Computers: {app: "honeycut", version, offer: {name, bytes, project} | null}. */
    fun info(url: String): JSONObject {
        val t = parse(url)
        return connect(t, 8000).use { s ->
            s.getOutputStream().apply { write(request(t, "GET", "info").toByteArray(Charsets.ISO_8859_1)); flush() }
            val inp = BufferedInputStream(s.getInputStream(), 8192)
            val (code, len) = head(inp)
            val text = body(inp, len)
            if (code != 200) throw IllegalStateException(if (code == 404) "Die Verbindung am Computer ist geschlossen. Bitte dort neu öffnen und den QR-Code noch einmal scannen." else errorOf(text, code))
            JSONObject(text)
        }
    }

    /** Holt das angebotene Projekt und entpackt es beim Empfang; Rückgabe wie beim Paket-Import ({header, map}). */
    fun fetch(ctx: Context, url: String, job: Job, fontDir: File): JSONObject {
        val t = parse(url)
        job.message = "Verbinde mit dem Computer …"
        val s = connect(t, 60000)
        job.onCancel { runCatching { s.close() } }
        return s.use {
            s.getOutputStream().apply { write(request(t, "GET", "paket").toByteArray(Charsets.ISO_8859_1)); flush() }
            val inp = BufferedInputStream(s.getInputStream(), 1 shl 16)
            val (code, len) = head(inp)
            if (code != 200) throw IllegalStateException(if (code == 404) "Am Computer steht kein Projekt mehr bereit." else errorOf(body(inp, len), code))
            Package.readFrom(ctx, if (len >= 0) Limited(inp, len) else inp, job, fontDir, "Projekt wird geholt")
        }
    }

    /** Packt ein Projekt und überträgt es an den Computer; Rückgabe: {ok, name, bytes}. */
    fun send(ctx: Context, url: String, spec: JSONObject, job: Job): JSONObject {
        val t = parse(url)
        job.message = "Projekt wird vorbereitet …"
        val p = Package.prepare(ctx, spec)
        // Platz auf dem Computer vorab erfragen: Eine Sendung, die er mittendrin abweisen müsste, beginnt gar nicht erst
        val free = runCatching { info(url).optLong("free", -1L) }.getOrDefault(-1L)
        if (free in 0 until p.bytes) throw IllegalStateException("Auf dem Computer ist zu wenig Platz frei.")
        val s = connect(t, 120000)
        job.onCancel { runCatching { s.close() } }
        return s.use {
            val out = s.getOutputStream()
            out.write(request(t, "POST", "zurueck", "Content-Type: application/octet-stream\r\nContent-Length: ${p.bytes}\r\n").toByteArray(Charsets.ISO_8859_1))
            val inp = BufferedInputStream(s.getInputStream(), 8192)
            try {
                Package.writeTo(ctx, out, p, job, "Wird übertragen")
                out.flush()
            } catch (e: java.io.IOException) {
                // Der Computer hat vorzeitig geantwortet (z. B. zu wenig Platz) und die Verbindung geschlossen: seine Meldung zeigen
                job.check()
                val early = runCatching { val (c, l) = head(inp); errorOf(body(inp, l), c) }.getOrNull()
                throw IllegalStateException(early ?: "Die Verbindung zum Computer ist abgerissen.")
            }
            job.message = "Der Computer legt das Projekt ab …"
            val (code, len) = head(inp)
            val text = body(inp, len)
            if (code != 200) throw IllegalStateException(errorOf(text, code))
            JSONObject().put("ok", true).put("name", p.name).put("bytes", p.bytes)
        }
    }
}
