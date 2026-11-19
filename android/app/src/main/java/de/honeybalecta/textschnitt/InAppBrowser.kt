package de.honeybalecta.textschnitt

import android.annotation.SuppressLint
import android.app.Dialog
import android.graphics.Color
import android.graphics.drawable.ColorDrawable
import android.text.TextUtils
import android.view.Gravity
import android.view.KeyEvent
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import org.json.JSONObject

/**
 * HoneyRec: eingebauter Browser. Webseiten (etwa Links aus einem PDF) öffnen sich in einer Ebene über der App – der
 * Standardbrowser des Handys wird nicht aufgerufen. Die Aufnahme im Hintergrund läuft dabei weiter.
 */
class InAppBrowser(private val act: MainActivity) {
    private var dlg: Dialog? = null
    private var web: WebView? = null
    private var title: TextView? = null
    @Volatile private var url = ""

    private fun btn(label: String, fn: () -> Unit) = Button(act).apply {
        text = label; isAllCaps = false; setTextColor(Color.parseColor("#EDE7DA")); textSize = 15f
        setBackgroundColor(Color.TRANSPARENT); setOnClickListener { fn() }
        minWidth = 0; minimumWidth = 0; setPadding(28, 0, 28, 0)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun build(): Dialog {
        val root = LinearLayout(act).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(Color.parseColor("#131312")) }
        val bar = LinearLayout(act).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL; setPadding(8, 8, 8, 8) }
        val t = TextView(act).apply {
            setTextColor(Color.parseColor("#CFC6B0")); textSize = 13f; maxLines = 1; ellipsize = TextUtils.TruncateAt.MIDDLE
        }
        title = t
        bar.addView(btn("◀") { web?.let { if (it.canGoBack()) it.goBack() } })
        bar.addView(btn("▶") { web?.let { if (it.canGoForward()) it.goForward() } })
        bar.addView(btn("⟳") { web?.reload() })
        bar.addView(t, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
        bar.addView(btn("Schließen") { close() })
        val w = WebView(act).apply {
            settings.javaScriptEnabled = true; settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = true; settings.setSupportMultipleWindows(false)
            settings.allowFileAccess = false; settings.allowContentAccess = false
            webViewClient = object : WebViewClient() {
                // Webseiten bleiben hier; andere Schemata (Mail, Telefon, Apps) werden nicht geöffnet
                override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                    request.url.scheme?.lowercase() !in setOf("http", "https")
                override fun onPageFinished(view: WebView, u: String) { this@InAppBrowser.url = u; this@InAppBrowser.title?.text = view.title?.ifBlank { u } ?: u }
            }
            webChromeClient = WebChromeClient()
        }
        web = w
        root.addView(bar, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT))
        root.addView(w, LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f))
        return Dialog(act, android.R.style.Theme_Black_NoTitleBar).apply {
            setContentView(root)
            window?.setBackgroundDrawable(ColorDrawable(Color.parseColor("#131312")))
            window?.setLayout(WindowManager.LayoutParams.MATCH_PARENT, WindowManager.LayoutParams.MATCH_PARENT)
            setOnKeyListener { _, code, ev ->
                if (code == KeyEvent.KEYCODE_BACK && ev.action == KeyEvent.ACTION_UP) {
                    val v = web; if (v != null && v.canGoBack()) v.goBack() else hide(); true
                } else false
            }
        }
    }

    fun call(action: String, u: String): String {
        val res = JSONObject().put("ok", true)
        act.runOnUiThread {
            when (action) {
                "open" -> if (u.startsWith("http://") || u.startsWith("https://")) {
                    val d = dlg ?: build().also { dlg = it }
                    url = u; title?.text = u; web?.loadUrl(u); d.show()
                }
                "back" -> web?.let { if (it.canGoBack()) it.goBack() }
                "forward" -> web?.let { if (it.canGoForward()) it.goForward() }
                "reload" -> web?.reload()
                "show" -> dlg?.show()
                "close" -> close()
            }
        }
        return res.put("open", action != "close" && (dlg != null || action == "open")).put("url", if (action == "open") u else url).toString()
    }

    private fun close() { dlg?.dismiss(); web?.destroy(); web = null; dlg = null; url = "" }
}
