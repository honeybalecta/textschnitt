package de.honeybalecta.textschnitt

import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import android.webkit.JavascriptInterface
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/** Alles, was die Oberfläche über window.TS aufrufen kann. */
class Bridge(private val act: MainActivity) {
    private val ctx = act.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private val projects = File(ctx.filesDir, "projects").apply { mkdirs() }
    @Volatile private var pickId: String? = null

    private fun js(code: String) = main.post { act.web.evaluateJavascript(code, null) }
    private fun q(s: String) = JSONObject.quote(s)
    private fun safeId(id: String) = id.filter { it.isLetterOrDigit() || it == '-' || it == '_' }.take(40)

    // ── Dateiauswahl ──
    @Volatile private var pickKind: String = "video"

    /** kind: "videos" = mehrere Videos (Liste), "clip" = ein Video oder Foto, sonst ein Video. */
    @JavascriptInterface
    fun pick(id: String, kind: String) {
        pickId = id; pickKind = kind
        val mimes = when (kind) {
            "clip" -> arrayOf("video/*", "image/*")
            "clips" -> arrayOf("video/*", "image/*", "audio/*")
            "font" -> arrayOf("font/*", "application/x-font-ttf", "application/x-font-otf", "application/font-sfnt", "application/vnd.ms-opentype", "application/octet-stream")
            else -> arrayOf("video/*")
        }
        main.post { act.launchPicker(mimes, kind == "videos" || kind == "clips" || kind == "font") }
    }

    // ── Eigene Schriften (für alle Projekte) ──
    private val fontDir get() = File(ctx.filesDir, "fonts").apply { mkdirs() }

    @JavascriptInterface
    fun fonts(): String {
        val arr = JSONArray()
        fontDir.listFiles()?.filter { it.isFile && it.extension.lowercase() in setOf("ttf", "otf") }?.sortedBy { it.name }?.forEach {
            arr.put(JSONObject().put("uri", it.path).put("name", it.name))
        }
        return arr.toString()
    }

    @JavascriptInterface
    fun deleteFont(uri: String) {
        val f = File(uri)
        if (f.parentFile?.canonicalPath == fontDir.canonicalPath) f.delete()
    }

    /** Schriftdatei ins App-Verzeichnis kopieren; null, wenn es keine TTF/OTF ist. */
    private fun importFont(u: Uri): JSONObject? = runCatching {
        val bytes = ctx.contentResolver.openInputStream(u)?.use { it.readBytes() } ?: return null
        if (bytes.size < 12) return null
        val sig = String(bytes, 0, 4, Charsets.ISO_8859_1)
        val ext = when { sig == "OTTO" -> "otf"; sig == "\u0000\u0001\u0000\u0000" || sig == "true" -> "ttf"; else -> return null }
        var name = ctx.contentResolver.query(u, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
            if (c.moveToFirst()) c.getString(0) else null } ?: "Schrift.$ext"
        name = name.substringBeforeLast('.').replace(Regex("[^\\w\\- ]"), "_").ifBlank { "Schrift" }
        var f = File(fontDir, "$name.$ext"); var k = 2
        while (f.exists() && !f.readBytes().contentEquals(bytes)) f = File(fontDir, "${name}_${k++}.$ext")
        if (!f.exists()) f.writeBytes(bytes)
        JSONObject().put("uri", f.path).put("name", f.name)
    }.getOrNull()

    fun onPicked(uris: List<Uri>) {
        val id = pickId ?: return
        pickId = null
        if (uris.isEmpty()) { js("TSApp.onPicked(${q(id)}, null)"); return }
        if (pickKind == "font") {
            Thread {
                val res = uris.mapNotNull { importFont(it) }.lastOrNull()
                js("TSApp.onPicked(${q(id)}, ${if (res == null) "null" else q(res.toString())})")
            }.start()
            return
        }
        if (pickKind == "package") {
            val job = Jobs.start { Package.read(ctx, uris[0], it, fontDir) }.also { WorkService.track(ctx, it, "Projekt-Import") }
            js("TSApp.onPicked(${q(id)}, ${q(JSONObject().put("job", job.id).toString())})")
            return
        }
        uris.forEach { runCatching { ctx.contentResolver.takePersistableUriPermission(it, Intent.FLAG_GRANT_READ_URI_PERMISSION) } }
        val multi = pickKind == "videos" || pickKind == "clips"
        Thread {
            val infos = uris.mapNotNull { Probe.probe(ctx, it) }
            val res = when {
                infos.isEmpty() -> null
                multi -> JSONArray(infos).toString()
                else -> infos[0].toString()
            }
            js("TSApp.onPicked(${q(id)}, ${if (res == null) "null" else q(res)})")
        }.start()
    }

    // ── Projektpakete (.honeycut): auf einem anderen Gerät weiterarbeiten ──
    @Volatile private var pkgSpec: String? = null

    @JavascriptInterface
    fun exportPackage(id: String, spec: String) {
        pickId = id; pkgSpec = spec
        val name = runCatching { JSONObject(spec).optString("name") }.getOrDefault("").ifBlank { "Projekt" }
            .replace(Regex("[^\\p{L}\\p{N} _.()-]"), "_").take(80) + ".honeycut"
        main.post { act.launchCreate(name) }
    }

    fun onCreated(uri: Uri?) {
        val id = pickId ?: return; pickId = null
        val spec = pkgSpec; pkgSpec = null
        if (uri == null || spec == null) { js("TSApp.onPicked(${q(id)}, null)"); return }
        val job = Jobs.start { Package.write(ctx, uri, JSONObject(spec), it) }.also { WorkService.track(ctx, it, "Projekt-Export") }
        js("TSApp.onPicked(${q(id)}, ${q(JSONObject().put("job", job.id).toString())})")
    }

    @JavascriptInterface
    fun importPackage(id: String) {
        pickId = id; pickKind = "package"
        main.post { act.launchPicker(arrayOf("application/octet-stream", "*/*"), false) }
    }

    /** Erzeugtes Bild (z. B. Folie aus dem B-Roll-Generator) als PNG ablegen; Rückgabe wie bei der Dateiauswahl. */
    @JavascriptInterface
    fun saveImage(name: String, b64: String, width: Int, height: Int, project: String): String {
        val dir = File(ctx.getExternalFilesDir(null) ?: ctx.filesDir, "Folien/" + safeId(project).ifBlank { "allgemein" }).apply { mkdirs() }
        var n = name.replace(Regex("[^\\w.\\-]"), "_").take(80); if (!n.lowercase().endsWith(".png")) n += ".png"
        val f = File(dir, n)
        f.writeBytes(android.util.Base64.decode(b64.substringAfter(","), android.util.Base64.DEFAULT))
        return JSONObject().put("uri", Uri.fromFile(f).toString()).put("name", n).put("kind", "image").put("duration", 600.0)
            .put("width", width).put("height", height).put("rotation", 0).put("fps", 30.0).put("hasAudio", false).put("hasVideo", true).toString()
    }

    // ── Projekte ──
    @JavascriptInterface
    fun listProjects(): String {
        val arr = JSONArray()
        projects.listFiles { f -> f.extension == "json" }?.forEach { f ->
            runCatching {
                val p = JSONObject(f.readText())
                val srcs = p.optJSONArray("sources") ?: JSONArray().put(p.getJSONObject("main"))
                var dur = 0.0
                for (i in 0 until srcs.length()) dur += srcs.getJSONObject(i).optDouble("duration", 0.0)
                arr.put(JSONObject().apply {
                    put("id", p.getString("id")); put("name", p.optString("name"))
                    put("updated", p.optLong("updated")); put("duration", dur); put("sources", srcs.length())
                    put("transcribed", (p.optJSONArray("tokens")?.length() ?: 0) > 0)
                })
            }
        }
        return arr.toString()
    }

    @JavascriptInterface
    fun loadProject(id: String): String = File(projects, safeId(id) + ".json").takeIf { it.exists() }?.readText() ?: ""

    @JavascriptInterface
    fun saveProject(id: String, json: String): String {
        val f = File(projects, safeId(id) + ".json")
        val tmp = File(f.path + ".tmp")
        tmp.writeText(json)
        if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
        return "ok"
    }

    @JavascriptInterface
    fun deleteProject(id: String) { File(projects, safeId(id) + ".json").delete() }

    // ── Modelle, Transkription, Export ──
    @JavascriptInterface fun models(): String = Models.list(ctx)

    @JavascriptInterface
    fun downloadModel(name: String): String = Jobs.start { Models.download(ctx, name, it) }.id

    @JavascriptInterface
    fun transcribe(uri: String, model: String, lang: String, fillers: Boolean): String =
        Jobs.start { Transcriber.run(ctx, Uri.parse(uri), model, lang, fillers, it) }.also {
            act.askNotifications(); WorkService.track(ctx, it, "Transkription") }.id

    @JavascriptInterface
    fun transcribeRanges(uri: String, model: String, lang: String, ranges: String): String =
        Jobs.start { Transcriber.runRanges(ctx, Uri.parse(uri), model, lang, JSONArray(ranges), it) }.also { WorkService.track(ctx, it, "Transkription") }.id

    @JavascriptInterface
    fun envelope(uri: String): String = Jobs.start {
        val audio = AudioDecoder.decode(ctx, Uri.parse(uri), it, 0.95)
        JSONObject().put("env", Transcriber.envelope(audio))
    }.id

    @JavascriptInterface
    fun exportVideo(plan: String): String {
        val job = Jobs.create()
        main.post {
            try { Exporter(ctx, JSONObject(plan), job).start(); WorkService.track(ctx, job, "Export") } catch (e: Throwable) { job.fail(e) }
        }
        return job.id
    }

    @JavascriptInterface
    fun autoMatte(uri: String): String {
        val job = Jobs.create()
        main.post { try { Matte.start(ctx, uri, job); WorkService.track(ctx, job, "Freistellen") } catch (e: Throwable) { job.fail(e) } }
        return job.id
    }

    @JavascriptInterface
    fun makeProxy(uri: String): String {
        val job = Jobs.create()
        main.post { try { Proxy.start(ctx, uri, job) } catch (e: Throwable) { job.fail(e) } }
        return job.id
    }

    @JavascriptInterface fun job(id: String): String = Jobs.get(id)?.toJson() ?: "null"
    @JavascriptInterface fun cancel(id: String) { Jobs.get(id)?.cancel() }

    // ── Teilen, Ansehen, Bildschirm wach halten ──
    @JavascriptInterface
    fun share(uri: String) = main.post {
        val i = Intent(Intent.ACTION_SEND).setType("video/mp4").putExtra(Intent.EXTRA_STREAM, Uri.parse(uri))
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        act.startActivity(Intent.createChooser(i, "Video teilen"))
    }.let { }

    /** Projektdatei (Transkript, Schnitt, Lautstärkeverlauf) zum Weitergeben, z. B. zur Fehlersuche. */
    @JavascriptInterface
    fun shareProject(id: String) = main.post {
        runCatching {
            val src = File(projects, safeId(id) + ".json")
            val dir = File(act.cacheDir, "share").apply { mkdirs() }
            val name = runCatching { JSONObject(src.readText()).optString("name") }.getOrDefault("").ifBlank { "Projekt" }
                .replace(Regex("[^\\p{L}\\p{N} _.-]"), "_").take(60)
            val f = File(dir, "$name.textschnitt.json")
            src.copyTo(f, overwrite = true)
            val uri = androidx.core.content.FileProvider.getUriForFile(act, act.packageName + ".files", f)
            val i = Intent(Intent.ACTION_SEND).setType("application/json").putExtra(Intent.EXTRA_STREAM, uri)
                .putExtra(Intent.EXTRA_SUBJECT, "HoneyCut-Projekt: $name").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            act.startActivity(Intent.createChooser(i, "Projektdatei teilen"))
        }
    }.let { }

    /** Text in die Zwischenablage (zuverlässiger als navigator.clipboard in der WebView). */
    @JavascriptInterface
    fun copyText(text: String): Boolean = runCatching {
        val cm = ctx.getSystemService(android.content.Context.CLIPBOARD_SERVICE) as android.content.ClipboardManager
        cm.setPrimaryClip(android.content.ClipData.newPlainText("HoneyCut-Transkript", text)); true
    }.getOrDefault(false)

    /** Datei in „Downloads/<Ordner>“ speichern (z. B. Transkript als Word-Datei). */
    @JavascriptInterface
    fun saveFile(name: String, mime: String, b64: String, folder: String): String = saveTo(name, mime, b64, folder.ifBlank { "HoneyCut" })

    /** Datei aus HoneyDeck (Bilder, PDF, ZIP, .honeydeck) in „Downloads/HoneyDeck“ speichern. Rückgabe: Hinweis für die Oberfläche. */
    @JavascriptInterface
    fun saveFile(name: String, mime: String, b64: String): String = saveTo(name, mime, b64, "HoneyDeck")

    private fun saveTo(name: String, mime: String, b64: String, folder: String): String = runCatching {
        val data = android.util.Base64.decode(b64, android.util.Base64.DEFAULT)
        val clean = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").take(120).ifBlank { "HoneyDeck" }
        val values = android.content.ContentValues().apply {
            put(android.provider.MediaStore.MediaColumns.DISPLAY_NAME, clean)
            put(android.provider.MediaStore.MediaColumns.MIME_TYPE, mime.ifBlank { "application/octet-stream" })
            put(android.provider.MediaStore.MediaColumns.RELATIVE_PATH, android.os.Environment.DIRECTORY_DOWNLOADS + "/" + folder.replace(Regex("[^\\p{L}\\p{N} _-]"), "_"))
        }
        val uri = ctx.contentResolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("kein Speicherplatz")
        ctx.contentResolver.openOutputStream(uri)!!.use { it.write(data) }
        "Gespeichert in Downloads/$folder: $clean"
    }.getOrElse { "Speichern fehlgeschlagen: ${it.message}" }

    @JavascriptInterface
    fun view(uri: String) = main.post {
        runCatching {
            act.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(Uri.parse(uri), "video/mp4").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
        }
    }.let { }

    @JavascriptInterface
    fun keepAwake(on: Boolean) = main.post {
        if (on) act.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else act.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }.let { }

    /** Vollbild-Vorschau: Status- und Navigationsleiste ausblenden. */
    @JavascriptInterface
    fun immersive(on: Boolean): Boolean { main.post { act.setFullscreenUi(on) }; return true }

    @JavascriptInterface
    fun info(): String = JSONObject().apply {
        put("platform", "android")
        put("exportFormats", JSONArray().put("video").put("audio")); put("audioFormats", JSONArray().put("m4a")); put("matte", true)
        put("version", ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName)
        put("whisper", runCatching { Whisper.systemInfo() }.getOrDefault("?"))
    }.toString()
}
