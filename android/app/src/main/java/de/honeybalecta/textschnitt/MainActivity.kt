package de.honeybalecta.textschnitt

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.PermissionRequest
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
    lateinit var rear: RearDisplay
        private set
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

    // HoneyRec: Kamera und Mikrofon für getUserMedia im WebView – erst die Android-Erlaubnis, dann die Freigabe für die Seite
    private var mediaReq: PermissionRequest? = null
    private val mediaPerm = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
        val req = mediaReq ?: return@registerForActivityResult; mediaReq = null
        val ok = req.resources.filter { r -> androidPermsOf(r).let { ps -> ps.isNotEmpty() && ps.all { res[it] == true || checkSelfPermission(it) == PackageManager.PERMISSION_GRANTED } } }
        if (ok.isEmpty()) req.deny() else req.grant(ok.toTypedArray())
    }
    private fun androidPermsOf(res: String): List<String> = when (res) {
        PermissionRequest.RESOURCE_VIDEO_CAPTURE -> listOf(Manifest.permission.CAMERA)
        PermissionRequest.RESOURCE_AUDIO_CAPTURE -> listOf(Manifest.permission.RECORD_AUDIO)
        else -> emptyList()
    }
    private fun onMediaPermission(req: PermissionRequest) = runOnUiThread {
        // Nur die eigene Oberfläche (lokaler Server) darf Kamera und Mikrofon anfragen
        if (req.origin?.host != "127.0.0.1") return@runOnUiThread req.deny()
        val known = req.resources.filter { it == PermissionRequest.RESOURCE_VIDEO_CAPTURE || it == PermissionRequest.RESOURCE_AUDIO_CAPTURE }
        if (known.isEmpty()) return@runOnUiThread req.deny()
        val missing = known.flatMap { androidPermsOf(it) }.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isEmpty()) req.grant(known.toTypedArray())
        else { mediaReq?.deny(); mediaReq = req; mediaPerm.launch(missing.toTypedArray()) }
    }

    /** Welche Seite ein Start öffnet: das Symbol „HoneyRec“ (RecAlias) die Aufnahme, „ScriptGenius“ (PlanAlias) den Planer, sonst HoneyCut. */
    private fun pageOf(i: Intent?): String {
        val c = i?.component?.className ?: ""
        return if (c.endsWith(".RecAlias")) "rec.html" else if (c.endsWith(".PlanAlias")) "plan.html" else "index.html"
    }
    private var page = "index.html"
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
        rear = RearDisplay(this)
        bridge = Bridge(this)
        web.addJavascriptInterface(bridge, "TS")
        web.webChromeClient = object : WebChromeClient() {
            override fun onPermissionRequest(request: PermissionRequest) = onMediaPermission(request)
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
            override fun onPageFinished(view: WebView, url: String) {
                pageReady = true
                pendingHandover?.let { pendingHandover = null; deliverHandover(it) }
            }
        }
        pendingHandover = handoverOf(intent)
        onBackPressedDispatcher.addCallback(this) {
            web.evaluateJavascript("window.TSApp && TSApp.onBack()") { r -> if (r != "true") finish() }
        }
        page = pageOf(intent)
        web.loadUrl(server.base + page)
    }

    // ── Übergabe im Heimnetz: Die Seite des Computers öffnet die App über honeycut://uebergabe?u=<Adresse> ──
    private var pageReady = false
    private var pendingHandover: String? = null
    private fun handoverOf(i: Intent?): String? =
        i?.data?.takeIf { it.scheme == "honeycut" && it.host == "uebergabe" }?.getQueryParameter("u")?.takeIf { it.isNotBlank() }
    private fun deliverHandover(url: String) {
        web.evaluateJavascript("window.TSApp && TSApp.onHandover && TSApp.onHandover(" + org.json.JSONObject.quote(url) + ")", null)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        // Anderes Startsymbol angetippt (HoneyCut, HoneyRec, ScriptGenius): Seite wechseln – eine laufende Aufnahme darf das nicht abbrechen
        if (intent.action == Intent.ACTION_MAIN) {
            val want = pageOf(intent)
            val now = web.url?.substringAfterLast('/')?.substringBefore('?')?.substringBefore('#') ?: page
            if (want != now) web.evaluateJavascript("(window.TSApp && TSApp.onSwitch) ? TSApp.onSwitch() : 'go'") { r ->
                if (r == "\"go\"") { page = want; web.loadUrl(server.base + want) }
            }
            return
        }
        val url = handoverOf(intent) ?: return
        if (pageReady) deliverHandover(url) else pendingHandover = url
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
