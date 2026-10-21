package de.honeybalecta.textschnitt

import android.annotation.SuppressLint
import android.net.Uri
import android.os.Bundle
import android.view.ViewGroup
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

/** Ein Fenster mit der Web-Oberfläche; die Arbeit erledigt [Bridge]. */
class MainActivity : ComponentActivity() {
    lateinit var web: WebView
        private set
    private lateinit var bridge: Bridge

    private val picker = registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        bridge.onPicked(uri)
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
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                LocalServer.handle(this@MainActivity, request)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                request.url.host != LocalServer.HOST
        }
        onBackPressedDispatcher.addCallback(this) {
            web.evaluateJavascript("window.TSApp && TSApp.onBack()") { r -> if (r != "true") finish() }
        }
        if (savedInstanceState == null) web.loadUrl("https://${LocalServer.HOST}/index.html")
        else web.restoreState(savedInstanceState)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onPause() {
        super.onPause()
        web.evaluateJavascript("window.TSApp && TSApp.onPause()", null)
    }

    override fun onDestroy() {
        web.destroy()
        super.onDestroy()
    }

    fun launchPicker(mimes: Array<String>) = picker.launch(mimes)
}
