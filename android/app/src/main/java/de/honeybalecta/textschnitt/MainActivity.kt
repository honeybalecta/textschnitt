package de.honeybalecta.textschnitt

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.os.Build
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat

/** Ein Fenster mit der Web-Oberfläche; die Arbeit erledigt [Bridge]. */
class MainActivity : ComponentActivity() {
    lateinit var web: WebView
        private set
    private lateinit var bridge: Bridge
    private lateinit var server: LocalServer

    private val picker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        bridge.onPicked(if (uri == null) emptyList() else listOf(uri))
    }
    private val multiPicker = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris: List<Uri> ->
        bridge.onPicked(uris)
    }

    private val createDoc = registerForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")) { uri: Uri? ->
        bridge.onCreated(uri)
    }
    fun launchCreate(name: String) = createDoc.launch(name)

    // Dateiauswahl über <input type=file> (HoneyDeck im Reiter „Folien“: Importe)
    private var fileCb: ValueCallback<Array<Uri>>? = null
    private val fileChooser = registerForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris: List<Uri> ->
        fileCb?.onReceiveValue(uris.toTypedArray()); fileCb = null
    }

    private val notifPerm = registerForActivityResult(ActivityResultContracts.RequestPermission()) { }
    private var notifAsked = false

    /** Einmal nach der Erlaubnis für Benachrichtigungen fragen (Fortschritt im Hintergrund). */
    fun askNotifications() = runOnUiThread {
        if (notifAsked || Build.VERSION.SDK_INT < 33) return@runOnUiThread
        notifAsked = true
        if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            notifPerm.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    fun setFullscreenUi(on: Boolean) {
        val c = WindowCompat.getInsetsController(window, window.decorView)
        if (on) { c.systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE; c.hide(WindowInsetsCompat.Type.systemBars()) }
        else c.show(WindowInsetsCompat.Type.systemBars())
    }

    override fun onResume() { super.onResume(); App.visible = true }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = FrameLayout(this)
        root.setBackgroundColor(0xFF131312.toInt())
        web = WebView(this)
        root.addView(web, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        setContentView(root)
        // Platz für Status- und Navigationsleiste lassen (Android 15 zeichnet randlos)
        ViewCompat.setOnApplyWindowInsetsListener(root) { v, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            v.setPadding(bars.left, bars.top, bars.right, maxOf(bars.bottom, ime.bottom))
            WindowInsetsCompat.CONSUMED
        }

        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            textZoom = 100
        }
        bridge = Bridge(this)
        web.addJavascriptInterface(bridge, "TS")
        web.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(view: WebView, cb: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean {
                fileCb?.onReceiveValue(null); fileCb = cb
                // Endungen wie „.honeydeck“ kennt Android nicht als Dateityp: dann alle Dateien anbieten, sonst blieben nur Bilder sichtbar
                val acc = params.acceptTypes.flatMap { it.split(',') }.map { it.trim() }.filter { it.isNotEmpty() }
                val types = acc.filter { it.contains('/') }.toTypedArray()
                val onlyImages = acc.isNotEmpty() && acc.all { it.startsWith("image/") }
                return runCatching { fileChooser.launch(if (onlyImages) types else arrayOf("*/*")); true }
                    .getOrElse { fileCb = null; false }
            }
        }
        server = LocalServer(applicationContext).start()
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.host != "127.0.0.1"
        }
        onBackPressedDispatcher.addCallback(this) {
            web.evaluateJavascript("window.TSApp && TSApp.onBack()") { r -> if (r != "true") finish() }
        }
        web.loadUrl(server.base + "index.html")
    }

    override fun onPause() {
        super.onPause()
        App.visible = false
        web.evaluateJavascript("window.TSApp && TSApp.onPause()", null)
    }

    override fun onDestroy() {
        web.destroy()
        server.stop()
        super.onDestroy()
    }

    fun launchPicker(mimes: Array<String>, multiple: Boolean) = if (multiple) multiPicker.launch(mimes) else picker.launch(mimes)
}
