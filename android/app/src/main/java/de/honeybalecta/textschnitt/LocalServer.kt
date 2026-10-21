package de.honeybalecta.textschnitt

import android.content.Context
import android.content.res.AssetFileDescriptor
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import java.io.FilterInputStream
import java.io.InputStream

/**
 * Liefert die Oberfläche (assets/web) und Videos aus content://-Adressen an die WebView –
 * mit Byte-Bereichen (Range), damit der Player springen kann.
 */
object LocalServer {
    const val HOST = "ts.app"

    fun handle(ctx: Context, req: WebResourceRequest): WebResourceResponse? {
        val url = req.url
        if (url.host != HOST) return null
        return try {
            when (url.path) {
                "/media" -> media(ctx, Uri.parse(url.getQueryParameter("u") ?: return notFound()), req.requestHeaders)
                else -> asset(ctx, (url.path ?: "/").trimStart('/').ifEmpty { "index.html" })
            }
        } catch (e: Exception) {
            WebResourceResponse("text/plain", "utf-8", 500, "Error", mapOf(), (e.message ?: "Fehler").byteInputStream())
        }
    }

    private fun notFound() = WebResourceResponse("text/plain", "utf-8", 404, "Not Found", mapOf(), "".byteInputStream())

    private fun asset(ctx: Context, path: String): WebResourceResponse {
        if (path.contains("..")) return notFound()
        val mime = when (path.substringAfterLast('.')) {
            "html" -> "text/html"; "js" -> "application/javascript"; "css" -> "text/css"
            "svg" -> "image/svg+xml"; "png" -> "image/png"; "json" -> "application/json"; else -> "application/octet-stream"
        }
        val stream = try { ctx.assets.open("web/$path") } catch (e: Exception) { return notFound() }
        return WebResourceResponse(mime, "utf-8", 200, "OK", mapOf("Cache-Control" to "no-cache"), stream)
    }

    private fun sizeOf(ctx: Context, uri: Uri, afd: AssetFileDescriptor): Long {
        if (afd.length != AssetFileDescriptor.UNKNOWN_LENGTH) return afd.length
        ctx.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst() && !c.isNull(0)) return c.getLong(0)
        }
        return -1
    }

    private fun media(ctx: Context, uri: Uri, headers: Map<String, String>): WebResourceResponse {
        val afd = ctx.contentResolver.openAssetFileDescriptor(uri, "r") ?: return notFound()
        val size = sizeOf(ctx, uri, afd)
        val mime = ctx.contentResolver.getType(uri) ?: "video/mp4"
        val range = headers.entries.firstOrNull { it.key.equals("Range", true) }?.value
        val input = afd.createInputStream()
        if (range == null || size <= 0) {
            val h = mutableMapOf("Accept-Ranges" to "bytes")
            if (size > 0) h["Content-Length"] = size.toString()
            return WebResourceResponse(mime, null, 200, "OK", h, input)
        }
        val m = Regex("bytes=(\\d*)-(\\d*)").find(range)
        var start = m?.groupValues?.get(1)?.toLongOrNull() ?: 0L
        var end = m?.groupValues?.get(2)?.toLongOrNull() ?: (size - 1)
        if (m != null && m.groupValues[1].isEmpty() && m.groupValues[2].isNotEmpty()) { // bytes=-N
            start = size - m.groupValues[2].toLong(); end = size - 1
        }
        end = minOf(end, size - 1)
        if (start > end) {
            input.close()
            return WebResourceResponse(mime, null, 416, "Range Not Satisfiable", mapOf("Content-Range" to "bytes */$size"), "".byteInputStream())
        }
        var skipped = 0L
        while (skipped < start) {
            val s = input.skip(start - skipped)
            if (s <= 0) break
            skipped += s
        }
        val len = end - start + 1
        val h = mapOf(
            "Accept-Ranges" to "bytes",
            "Content-Range" to "bytes $start-$end/$size",
            "Content-Length" to len.toString(),
        )
        return WebResourceResponse(mime, null, 206, "Partial Content", h, Limited(input, len))
    }

    private class Limited(src: InputStream, private var left: Long) : FilterInputStream(src) {
        override fun read(): Int { if (left <= 0) return -1; val r = super.read(); if (r >= 0) left--; return r }
        override fun read(b: ByteArray, off: Int, len: Int): Int {
            if (left <= 0) return -1
            val r = super.read(b, off, minOf(len.toLong(), left).toInt())
            if (r > 0) left -= r
            return r
        }
        override fun available(): Int = minOf(super.available().toLong(), left).toInt()
    }
}
