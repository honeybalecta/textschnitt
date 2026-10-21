package de.honeybalecta.textschnitt

import android.util.Log
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.Executors

class CancelledException : RuntimeException("Abgebrochen")

/** Ein lang laufender Vorgang, dessen Stand die Oberfläche abfragt. */
class Job {
    val id: String = UUID.randomUUID().toString().take(10)
    @Volatile var status = "running"
    @Volatile var progress = 0.0
    @Volatile var message = ""
    @Volatile var result: Any? = null
    @Volatile var error: String? = null
    @Volatile var cancelled = false
        private set
    private val onCancel = CopyOnWriteArrayList<() -> Unit>()

    fun onCancel(fn: () -> Unit) { onCancel.add(fn); if (cancelled) fn() }
    fun cancel() { if (status != "running") return; cancelled = true; onCancel.forEach { runCatching(it) } }
    fun check() { if (cancelled) throw CancelledException() }
    fun done(r: Any?) { result = r; progress = 1.0; status = "done" }
    fun fail(e: Throwable) {
        if (cancelled || e is CancelledException) { status = "cancelled"; return }
        Log.e("Textschnitt", "Job fehlgeschlagen", e)
        error = e.message ?: e.javaClass.simpleName
        status = "error"
    }

    fun toJson(): String = JSONObject().apply {
        put("id", id); put("status", status); put("progress", progress); put("message", message)
        put("result", result ?: JSONObject.NULL); put("error", error ?: JSONObject.NULL)
    }.toString()
}

object Jobs {
    private val all = ConcurrentHashMap<String, Job>()
    private val pool = Executors.newCachedThreadPool()

    fun create(): Job = Job().also { all[it.id] = it }
    fun get(id: String): Job? = all[id]

    /** Startet [block] im Hintergrund; das Ergebnis wird zu job.result. */
    fun start(block: (Job) -> Any?): Job {
        val job = create()
        pool.execute {
            try { val r = block(job); if (job.cancelled) job.fail(CancelledException()) else job.done(r) }
            catch (e: Throwable) { job.fail(e) }
        }
        return job
    }
}
