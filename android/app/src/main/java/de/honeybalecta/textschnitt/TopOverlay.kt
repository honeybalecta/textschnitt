package de.honeybalecta.textschnitt

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.media3.common.OverlaySettings
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.StaticOverlaySettings
import org.json.JSONObject

/**
 * Bilder über allem im Android-Export: Formen, abgedeckte Bereiche und der Fortschrittsbalken (Einblendungen des Plans mit
 * top = true). Sie liegen als Overlay auf dem fertig zusammengesetzten Bild – hinter dem Unkenntlich-Machen und unter den
 * Untertiteln – und brauchen so keine eigene Bildspur. Eine Bahn zeigt zur Zeit höchstens ein Bild; Lage, Größe und Keyframes
 * wie bei einer frei liegenden Einblendung (x, y Mitte und w Breite als Anteile des Bilds).
 */
@UnstableApi
class TopOverlay(private val items: List<Item>, private val w: Int, private val h: Int) : BitmapOverlay() {
    class Item(val a: Double, val b: Double, val path: String, val x: Float, val y: Float, val w: Float, val alpha: Float, val kf: Array<FloatArray>) {
        var bmp: Bitmap? = null
        var failed = false
    }

    private val empty: Bitmap = Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888)
    private val hidden: OverlaySettings = StaticOverlaySettings.Builder().setAlphaScale(0f).build()

    /** Das Bild, das zur Zeit t zu sehen ist – geladen, sobald es gebraucht wird; abgelaufene Bilder werden freigegeben. */
    private fun cur(us: Long): Item? {
        val t = us / 1e6
        var hit: Item? = null
        for (x in items) {
            if (t >= x.b) { x.bmp = null; continue }
            if (hit == null && t >= x.a - 0.001) hit = x
        }
        val item = hit ?: return null
        if (item.bmp == null && !item.failed) {
            item.bmp = runCatching { BitmapFactory.decodeFile(item.path) }.getOrNull()
            if (item.bmp == null) item.failed = true
        }
        return if (item.bmp == null) null else item
    }

    override fun getBitmap(presentationTimeUs: Long): Bitmap = cur(presentationTimeUs)?.bmp ?: empty

    override fun getOverlaySettings(presentationTimeUs: Long): OverlaySettings {
        val item = cur(presentationTimeUs) ?: return hidden
        val bmp = item.bmp ?: return hidden
        val v = OvGeom.at(item.kf, (presentationTimeUs / 1e6 - item.a).toFloat(), item.x, item.y, item.w)
        // Das Bild liegt in seiner eigenen Pixelgröße vor: auf die gewünschte Breite bringen (Anteil der Bildbreite)
        val sc = v[2] * w / bmp.width
        val ax = OvGeom.anchor(v[0] * 2 - 1, sc * bmp.width / w) ?: return hidden
        val ay = OvGeom.anchor(1 - v[1] * 2, sc * bmp.height / h) ?: return hidden
        return StaticOverlaySettings.Builder().setScale(sc, sc).setAlphaScale(item.alpha)
            .setOverlayFrameAnchor(ax[0], ay[0]).setBackgroundFrameAnchor(ax[1], ay[1]).build()
    }

    companion object {
        /** Bahnen aus den top-Einblendungen des Plans: je Spur eine, in der Reihenfolge der Spuren (untere zuerst). */
        fun lanes(ovs: List<JSONObject>, w: Int, h: Int, total: Double): List<TopOverlay> =
            ovs.filter { it.optBoolean("top") && it.optBoolean("image") && it.optString("mode") != "audio" }
                .groupBy { it.optInt("track", 100) }.toSortedMap().values.mapNotNull { list ->
                    val items = list.sortedBy { it.optDouble("at", 0.0) }.mapNotNull { o ->
                        val at = o.optDouble("at", 0.0); val dur = minOf(o.optDouble("out", 0.0) - o.optDouble("in", 0.0), total - at)
                        val path = runCatching { Uri.parse(o.optString("uri")).path }.getOrNull()
                        // Das Titelbild als erstes Bild des Videos (first) steht nur ein Bild lang – kürzer als jede andere Einblendung
                        if (dur <= (if (o.optBoolean("first")) 0.001 else 0.02) || path == null || path.isEmpty() || !o.has("w")) null else {
                            val kfA = o.optJSONArray("kf")
                            val kf: List<FloatArray> = if (kfA == null || kfA.length() < 2) emptyList() else (0 until kfA.length()).mapNotNull { kfA.optJSONObject(it) }
                                .map { floatArrayOf(it.optDouble("t", 0.0).toFloat(), it.optDouble("x", 0.5).toFloat(), it.optDouble("y", 0.5).toFloat(), it.optDouble("w", 1.0).toFloat()) }.sortedBy { it[0] }
                            Item(at, at + dur, path, o.optDouble("x", 0.5).toFloat(), o.optDouble("y", 0.5).toFloat(), o.optDouble("w", 1.0).toFloat(),
                                o.optDouble("opacity", 1.0).toFloat().coerceIn(0f, 1f), kf.toTypedArray())
                        }
                    }
                    if (items.isEmpty()) null else TopOverlay(items, w, h)
                }
    }
}
