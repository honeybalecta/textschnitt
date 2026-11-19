package de.honeybalecta.textschnitt

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import androidx.window.area.WindowAreaCapability
import androidx.window.area.WindowAreaController
import androidx.window.area.WindowAreaInfo
import androidx.window.area.WindowAreaSession
import androidx.window.area.WindowAreaSessionCallback
import androidx.window.core.ExperimentalWindowApi
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * HoneyRec auf Foldables im Buchformat (Galaxy Z Fold, Pixel Fold): Im aufgeklappten Zustand zieht die App auf den
 * Außenbildschirm um („Rear Display Mode“ von Android). Er liegt dann auf derselben Seite wie die Hauptkameras – man sieht sich
 * selbst und steuert die Aufnahme wie im zugeklappten Zustand, aufgenommen wird mit der Hauptkamera.
 * Geräte ohne diese Möglichkeit melden „unsupported“; HoneyRec blendet den Knopf dann aus.
 */
@OptIn(ExperimentalWindowApi::class)
class RearDisplay(private val act: MainActivity) {
    private val ctrl: WindowAreaController? = runCatching { WindowAreaController.getOrCreate() }.getOrNull()
    @Volatile private var info: WindowAreaInfo? = null
    @Volatile private var status = "unsupported"   // unsupported | unavailable | available | active
    private var session: WindowAreaSession? = null

    init {
        val c = ctrl
        if (c != null) act.lifecycleScope.launch {
            act.repeatOnLifecycle(Lifecycle.State.STARTED) {
                c.windowAreaInfos.collect { list ->
                    val i = list.firstOrNull { it.type == WindowAreaInfo.Type.TYPE_REAR_FACING }
                    info = i
                    val st = i?.getCapability(WindowAreaCapability.Operation.OPERATION_TRANSFER_ACTIVITY_TO_AREA)?.status
                    status = when (st) {
                        WindowAreaCapability.Status.WINDOW_AREA_STATUS_ACTIVE -> "active"
                        WindowAreaCapability.Status.WINDOW_AREA_STATUS_AVAILABLE -> "available"
                        WindowAreaCapability.Status.WINDOW_AREA_STATUS_UNAVAILABLE -> "unavailable"
                        else -> "unsupported"
                    }
                    notifyJs(null)
                }
            }
        }
    }

    private fun state(): JSONObject = JSONObject().put("status", if (session != null) "active" else status)

    private fun notifyJs(err: String?) {
        val o = state(); if (err != null) o.put("error", err)
        act.runOnUiThread { runCatching { act.web.evaluateJavascript("window.TSApp && TSApp.onRear && TSApp.onRear(${o})", null) } }
    }

    fun call(action: String): String {
        when (action) {
            "on" -> act.runOnUiThread {
                val c = ctrl; val i = info
                if (c == null || i == null || session != null) return@runOnUiThread
                runCatching {
                    c.transferActivityToWindowArea(i.token, act, act.mainExecutor, object : WindowAreaSessionCallback {
                        override fun onSessionStarted(session: WindowAreaSession) { this@RearDisplay.session = session; notifyJs(null) }
                        override fun onSessionEnded(t: Throwable?) { this@RearDisplay.session = null; notifyJs(t?.message) }
                    })
                }.onFailure { notifyJs(it.message ?: "Außenbildschirm nicht verfügbar") }
            }
            "off" -> act.runOnUiThread { runCatching { session?.close() }; session = null; notifyJs(null) }
        }
        return state().toString()
    }
}
