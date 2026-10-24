package de.honeybalecta.textschnitt

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager

/**
 * Hält die App am Leben, solange transkribiert oder exportiert wird – auch wenn sie verlassen
 * oder das Gerät gesperrt wird. Zeigt den Fortschritt als Benachrichtigung.
 */
class WorkService : Service() {
    companion object {
        private const val CH_RUN = "arbeit"
        private const val CH_DONE = "fertig"
        private const val ID_RUN = 1
        private const val ID_DONE = 2
        @Volatile private var running = false
        private val tracked = java.util.concurrent.CopyOnWriteArrayList<Pair<Job, String>>()

        /** Vorgang beobachten; startet den Dienst, falls nötig. [what] z. B. „Transkription“. */
        fun track(ctx: Context, job: Job, what: String) {
            tracked.add(job to what)
            if (running) return
            running = true
            val i = Intent(ctx, WorkService::class.java)
            runCatching { ctx.startForegroundService(i) }.onFailure { running = false }
        }
    }

    private val main = Handler(Looper.getMainLooper())
    private var wake: PowerManager.WakeLock? = null
    private var lastDone: Pair<Job, String>? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CH_RUN, "Laufende Arbeiten", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Fortschritt von Transkription und Export"; setShowBadge(false) })
        nm.createNotificationChannel(NotificationChannel(CH_DONE, "Fertig", NotificationManager.IMPORTANCE_DEFAULT).apply {
            description = "Meldung, wenn eine Transkription oder ein Export fertig ist" })
        wake = (getSystemService(Context.POWER_SERVICE) as PowerManager)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Textschnitt:arbeit").apply { setReferenceCounted(false); acquire(6 * 3600_000L) }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val n = build(current())
        if (Build.VERSION.SDK_INT >= 29) startForeground(ID_RUN, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else startForeground(ID_RUN, n)
        main.removeCallbacksAndMessages(null)
        main.post(tick)
        return START_NOT_STICKY
    }

    private fun current(): Pair<Job, String>? {
        tracked.removeAll { (j, w) -> if (j.status != "running") { if (j.status == "done") lastDone = j to w; true } else false }
        return tracked.firstOrNull()
    }

    private val tick = object : Runnable {
        override fun run() {
            val cur = current()
            if (cur == null) { finish(); return }
            getSystemService(NotificationManager::class.java).notify(ID_RUN, build(cur))
            main.postDelayed(this, 1000)
        }
    }

    private fun openApp(): PendingIntent = PendingIntent.getActivity(this, 0,
        Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    private fun build(cur: Pair<Job, String>?): Notification {
        val b = Notification.Builder(this, CH_RUN).setSmallIcon(R.drawable.ic_stat).setOngoing(true)
            .setOnlyAlertOnce(true).setContentIntent(openApp()).setCategory(Notification.CATEGORY_PROGRESS)
        if (cur == null) return b.setContentTitle("Textschnitt arbeitet …").build()
        val (job, what) = cur
        val pct = (job.progress * 100).toInt().coerceIn(0, 100)
        val more = tracked.size - 1
        return b.setContentTitle("$what · $pct %" + if (more > 0) " (+$more)" else "")
            .setContentText(job.message.ifBlank { "läuft im Hintergrund weiter" })
            .setProgress(100, pct, job.progress <= 0.0).build()
    }

    private fun finish() {
        running = false
        val done = lastDone
        if (done != null && !App.visible) {
            getSystemService(NotificationManager::class.java).notify(ID_DONE, Notification.Builder(this, CH_DONE)
                .setSmallIcon(R.drawable.ic_stat).setAutoCancel(true).setContentIntent(openApp())
                .setContentTitle("${done.second} fertig").setContentText("Zum Weiterarbeiten antippen").build())
        }
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }

    override fun onDestroy() {
        main.removeCallbacksAndMessages(null)
        runCatching { wake?.release() }
        running = false
        super.onDestroy()
    }
}

/** Ob die Oberfläche gerade sichtbar ist (dann keine „fertig“-Meldung). */
object App { @Volatile var visible = false }
