package de.honeybalecta.textschnitt

import android.annotation.SuppressLint
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.FrameLayout
import androidx.activity.ComponentActivity
import androidx.activity.addCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

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

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = FrameLayout(this)
        root.setBackgroundColor(0xFFFAF6EE.toInt())
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
        web.webChromeClient = WebChromeClient()
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
        web.evaluateJavascript("window.TSApp && TSApp.onPause()", null)
    }

    override fun onDestroy() {
        web.destroy()
        server.stop()
        super.onDestroy()
    }

    fun launchPicker(mimes: Array<String>, multiple: Boolean) = if (multiple) multiPicker.launch(mimes) else picker.launch(mimes)
}
