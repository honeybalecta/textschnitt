package de.honeybalecta.honeydeck

import android.annotation.SuppressLint
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.provider.OpenableColumns
import android.util.Base64
import android.view.ViewGroup
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

/** HoneyDeck auf Android: die gemeinsame Oberfläche (assets/deck) in einer WebView.
 *  Feste Adresse https://appassets.androidplatform.net/deck/ – damit bleiben die gespeicherten Präsentationen (IndexedDB) erhalten. */
class MainActivity : ComponentActivity() {
    private lateinit var web: WebView
    private var fileCb: ValueCallback<Array<Uri>>? = null
    private val fileChooser = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris: List<Uri> ->
        fileCb?.onReceiveValue(uris.toTypedArray()); fileCb = null
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = FrameLayout(this)
        root.setBackgroundColor(0xFF131312.toInt())
        web = WebView(this)
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            databaseEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            textZoom = 100
        }
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/deck/") { path ->
                runCatching {
                    val p = path.ifEmpty { "index.html" }
                    WebResourceResponse(typeOf(p), null, assets.open("deck/$p"))
                }.getOrNull()
            }.build()
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? = loader.shouldInterceptRequest(request.url)
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean = request.url.host != "appassets.androidplatform.net"
            override fun onPageFinished(view: WebView, url: String) { handleIntent(intent) }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCb?.onReceiveValue(null); fileCb = cb
                return runCatching { fileChooser.launch(arrayOf("*/*")); true }.getOrElse { fileCb = null; false }
            }
        }
        web.addJavascriptInterface(Native(), "DeckNative")
        onBackPressedDispatcher.addCallback(this) {
            web.evaluateJavascript("window.HDBack && HDBack()") { r -> if (r != "true") finish() }
        }
        web.loadUrl("https://appassets.androidplatform.net/deck/index.html")
    }

    override fun onNewIntent(intent: Intent) { super.onNewIntent(intent); setIntent(intent); handleIntent(intent) }

    /** Über „Teilen“ oder „Öffnen mit“ übergebene Datei an die Oberfläche geben (wie ein Import). */
    private var handled: Intent? = null
    private fun handleIntent(i: Intent?) {
        if (i == null || i === handled) return
        val uri: Uri = when (i.action) {
            Intent.ACTION_SEND -> @Suppress("DEPRECATION") (i.getParcelableExtra(Intent.EXTRA_STREAM) as? Uri) ?: run {
                val txt = i.getStringExtra(Intent.EXTRA_TEXT) ?: return
                handled = i
                web.evaluateJavascript("window.HDImportText && HDImportText(${JSONObject.quote(txt)})", null); return
            }
            Intent.ACTION_VIEW -> i.data ?: return
            else -> return
        }
        handled = i
        runCatching {
            var name = "Datei"
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst() && !c.isNull(0)) name = c.getString(0) }
            val bytes = contentResolver.openInputStream(uri)!!.use { it.readBytes() }
            val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
            web.evaluateJavascript("window.HDImportB64 && HDImportB64(${JSONObject.quote(name)}, ${JSONObject.quote(b64)})", null)
        }
    }

    private fun typeOf(path: String) = when (path.substringAfterLast('.')) {
        "html" -> "text/html"; "js" -> "application/javascript"; "css" -> "text/css"; "svg" -> "image/svg+xml"; "png" -> "image/png"
        "ttf" -> "font/ttf"; "otf" -> "font/otf"; "webmanifest" -> "application/manifest+json"; "txt", "md" -> "text/plain"; else -> "application/octet-stream"
    }

    inner class Native {
        /** Datei in „Downloads/HoneyDeck“ speichern. Rückgabe: Hinweis für die Oberfläche. */
        @JavascriptInterface
        fun saveFile(name: String, mime: String, b64: String): String = runCatching {
            val data = Base64.decode(b64, Base64.DEFAULT)
            val clean = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").take(120).ifBlank { "HoneyDeck" }
            val values = ContentValues().apply {
                put(MediaStore.MediaColumns.DISPLAY_NAME, clean)
                put(MediaStore.MediaColumns.MIME_TYPE, mime.ifBlank { "application/octet-stream" })
                put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/HoneyDeck")
            }
            val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: error("kein Speicherplatz")
            contentResolver.openOutputStream(uri)!!.use { it.write(data) }
            "Gespeichert in Downloads/HoneyDeck: $clean"
        }.getOrElse { "Speichern fehlgeschlagen: ${it.message}" }

        /** Gespeicherte Datei teilen (z. B. an HoneyCut, Drive oder Messenger). */
        @JavascriptInterface
        fun platform(): String = "android"
    }
}
