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
    @JavascriptInterface
    fun pick(id: String, kind: String) {
        pickId = id
        main.post { act.launchPicker(arrayOf("video/*")) }
    }

    fun onPicked(uri: Uri?) {
        val id = pickId ?: return
        pickId = null
        if (uri == null) { js("TSApp.onPicked(${q(id)}, null)"); return }
        runCatching { ctx.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        Thread {
            val info = Probe.probe(ctx, uri)
            js("TSApp.onPicked(${q(id)}, ${if (info == null) "null" else q(info.toString())})")
        }.start()
    }

    // ── Projekte ──
    @JavascriptInterface
    fun listProjects(): String {
        val arr = JSONArray()
        projects.listFiles { f -> f.extension == "json" }?.forEach { f ->
            runCatching {
                val p = JSONObject(f.readText())
                arr.put(JSONObject().apply {
                    put("id", p.getString("id")); put("name", p.optString("name"))
                    put("updated", p.optLong("updated")); put("duration", p.getJSONObject("main").optDouble("duration"))
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
        Jobs.start { Transcriber.run(ctx, Uri.parse(uri), model, lang, fillers, it) }.id

    @JavascriptInterface
    fun exportVideo(plan: String): String {
        val job = Jobs.create()
        main.post {
            try { Exporter(ctx, JSONObject(plan), job).start() } catch (e: Throwable) { job.fail(e) }
        }
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

    @JavascriptInterface
    fun info(): String = JSONObject().apply {
        put("version", ctx.packageManager.getPackageInfo(ctx.packageName, 0).versionName)
        put("whisper", runCatching { Whisper.systemInfo() }.getOrDefault("?"))
    }.toString()
}
