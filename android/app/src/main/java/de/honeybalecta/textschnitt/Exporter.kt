package de.honeybalecta.textschnitt

import android.content.ContentValues
import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Typeface
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.text.Layout
import android.text.SpannableString
import android.text.Spanned
import android.text.StaticLayout
import android.text.TextPaint
import android.text.style.ForegroundColorSpan
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.Effect
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.OverlaySettings
import androidx.media3.common.VideoCompositorSettings
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.ChannelMixingAudioProcessor
import androidx.media3.common.audio.ChannelMixingMatrix
import androidx.media3.common.audio.GainProcessor
import androidx.media3.common.audio.SpeedProvider
import androidx.media3.effect.BitmapOverlay
import androidx.media3.effect.Brightness
import androidx.media3.effect.Contrast
import androidx.media3.effect.HslAdjustment
import androidx.media3.effect.RgbAdjustment
import androidx.media3.effect.RgbFilter
import androidx.media3.effect.MatrixTransformation
import androidx.media3.effect.OverlayEffect
import androidx.media3.effect.Presentation
import androidx.media3.effect.StaticOverlaySettings
import androidx.media3.effect.TextureOverlay
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.VideoEncoderSettings
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.EditedMediaItemSequence
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import kotlin.math.roundToLong

/**
 * Baut aus dem Schnittplan der Oberfläche eine Media3-Komposition:
 *  – Hauptspur: behaltene Abschnitte + Einschübe (mit Zoom-Effekten), auf Ausgabegröße gebracht
 *  – Overlay-Spur (oben): B-Roll und Bild-im-Bild, dazwischen Lücken, gesteuert per Deckkraft
 *  – Übergänge: eine Bildspur direkt über der Hauptspur mit dem Bild des anderen Clips (Blende, versetzter Bildwechsel)
 *  – Untertitel als eingebranntes Bild-Overlay über allem
 */
@OptIn(UnstableApi::class)
class Exporter(private val ctx: Context, private val plan: JSONObject, private val job: Job) {
    private val main = Handler(Looper.getMainLooper())
    private var transformer: Transformer? = null
    private lateinit var outFile: File
    private val w = plan.getInt("width")
    private val h = plan.getInt("height")

    private fun us(sec: Double) = (sec * 1_000_000).roundToLong()

    private companion object {
        const val STALL_MS = 60_000L   // so lange darf zwischen zwei fertigen Bildern nichts ankommen
        /** Kurze Ton-Blende an jeder Schnittkante der Hauptspur (wie unter Windows und im Browser), in Sekunden. */
        const val CUT_FADE = 0.008
    }

    /** Ausschnitt in der Quelle als NDC (links, rechts, unten, oben), wenn der vergrößerte Clip das Bild ganz füllt. */
    private fun coverWindow(s: JSONObject, sc: Double, tx: Double, ty: Double): FloatArray? {
        if (sc <= 1.001) return null
        val src = plan.optJSONArray("sources")?.optJSONObject(s.optInt("src", -1)) ?: return null
        val sw = src.optDouble("width", 0.0); val sh = src.optDouble("height", 0.0); if (sw < 2 || sh < 2) return null
        val W = w.toDouble(); val H = h.toDouble(); val k = minOf(W / sw, H / sh)
        val ox = (W - sw * k) / 2; val oy = (H - sh * k) / 2; val vw = W / sc; val vh = H / sc
        val cx = W / 2 - tx * W / sc; val cy = H / 2 - ty * H / sc
        val xs = (cx - vw / 2 - ox) / k; val ys = (cy - vh / 2 - oy) / k; val ws = vw / k; val hs = vh / k
        if (xs < -1 || ys < -1 || xs + ws > sw + 1 || ys + hs > sh + 1) return null
        val x0 = xs.coerceIn(0.0, sw - ws); val y0 = ys.coerceIn(0.0, sh - hs)
        return floatArrayOf((-1 + 2 * x0 / sw).toFloat(), (-1 + 2 * (x0 + ws) / sw).toFloat(), (1 - 2 * (y0 + hs) / sh).toFloat(), (1 - 2 * y0 / sh).toFloat())
    }
    private val fps = plan.optDouble("fps", 30.0).let { if (it < 1 || it > 240) 30.0 else it }

    // „Musik weicht der Sprache“: Verlauf in Ausgabezeit (Sekunden, Werte 0…1) für Tonspuren mit duck = true
    private val duckT: DoubleArray
    private val duckG: FloatArray
    init {
        val pts = runCatching { plan.optJSONArray("duck")?.let { a -> (0 until a.length()).map { a.getJSONArray(it) }.map { Pair(it.getDouble(0), it.getDouble(1).toFloat()) } } }.getOrNull() ?: emptyList()
        duckT = DoubleArray(pts.size) { pts[it].first }; duckG = FloatArray(pts.size) { pts[it].second }
    }

    // „Stimme aufbereiten“: Die Rauschschätzung wandert je Aufnahme von Clip zu Clip dieses Exports
    private val voiceShared = VoiceProcessor.Shared()

    /** Prozessor für einen Abschnitt der Hauptspur mit voice = {k: Aufnahme, lvl: Pegelverlauf in Quellzeit}; sonst null. */
    private fun voiceFor(o: JSONObject, speed: Double): AudioProcessor? {
        val v = o.optJSONObject("voice") ?: return null
        val pts = runCatching { v.optJSONArray("lvl")?.let { a -> (0 until a.length()).map { a.getJSONArray(it) }.map { Pair(it.getDouble(0), it.getDouble(1)) } } }.getOrNull() ?: emptyList()
        return VoiceProcessor(voiceShared, v.optString("k", o.optString("uri")), DoubleArray(pts.size) { pts[it].first }, DoubleArray(pts.size) { pts[it].second.coerceIn(0.1, 4.0) }, speed)
    }

    /** Ton eines Elements neben der Hauptspur: Lautstärke und – wenn es der Sprache weicht – die Absenkung ab seiner Stelle at. */
    private fun sideAudio(o: JSONObject, at: Double, dur: Double): ArrayList<AudioProcessor> {
        val ap = ArrayList<AudioProcessor>()
        val vol = o.optDouble("vol", 1.0).toFloat()
        if (Math.abs(vol - 1f) > 0.001) ap.add(ChannelMixingAudioProcessor().apply { for (ch in 1..6) putChannelMixingMatrix(ChannelMixingMatrix.createForConstantGain(ch, ch).scaleBy(vol.coerceIn(0f, 8f))) })
        if (o.optBoolean("duck") && duckT.isNotEmpty()) ap.add(GainProcessor(GainCurve(duckT, duckG, at, 0.0, dur)))
        return ap
    }

    /** Ein Clip aus dem Plan: Video mit Ausschnitt oder Foto mit fester Dauer – plus Tempo, Lautstärke, Farbe.
     *  fade: kurze Ton-Blende an Anfang und Ende des Clips in Sekunden (Schnittkanten der Hauptspur). */
    private fun item(o: JSONObject, inS: Double, outS: Double, removeAudio: Boolean, effects: List<Effect>, removeVideo: Boolean = false, pre: List<Effect> = emptyList(), fade: Double = 0.0): EditedMediaItem {
        val b = if (o.optBoolean("image")) EditedMediaItem.Builder(
            MediaItem.Builder().setUri(Uri.parse(o.getString("uri"))).setImageDurationMs(((outS - inS) * 1000).roundToLong()).build()
        ).setFrameRate(Math.round(fps).toInt())
        else EditedMediaItem.Builder(clip(o.getString("uri"), inS, outS)).setRemoveAudio(removeAudio)
        val fx = ArrayList<Effect>(pre)   // Freistellen zuerst – auf dem unveränderten Bild, wie in der Vorschau
        // Weißabgleich: Verstärkung je Farbkanal (wb = [r, g, b])
        o.optJSONArray("wb")?.let { a -> if (a.length() >= 3) { val g = FloatArray(3) { a.optDouble(it, 1.0).toFloat().coerceIn(0.25f, 4f) }
            if (g.any { Math.abs(it - 1f) > 0.001f }) fx.add(RgbAdjustment.Builder().setRedScale(g[0]).setGreenScale(g[1]).setBlueScale(g[2]).build()) } }
        val bright = o.optDouble("bright", 0.0).toFloat(); if (Math.abs(bright) > 0.001) fx.add(Brightness(bright.coerceIn(-1f, 1f)))
        val contrast = o.optDouble("contrast", 0.0).toFloat(); if (Math.abs(contrast) > 0.001) fx.add(Contrast(contrast.coerceIn(-1f, 1f)))
        val sat = o.optDouble("sat", 0.0).toFloat(); if (Math.abs(sat) > 0.01) fx.add(HslAdjustment.Builder().adjustSaturation(sat.coerceIn(-100f, 100f)).build())
        if (o.optBoolean("gray")) fx.add(RgbFilter.createGrayscaleFilter())
        fx.addAll(effects)
        val audio = ArrayList<AudioProcessor>()
        val vol = o.optDouble("vol", 1.0).toFloat()
        if (!removeAudio && Math.abs(vol - 1f) > 0.001) {
            val mix = ChannelMixingAudioProcessor()
            for (ch in 1..6) mix.putChannelMixingMatrix(ChannelMixingMatrix.createForConstantGain(ch, ch).scaleBy(vol.coerceIn(0f, 8f)))
            audio.add(mix)
        }
        val speed = o.optDouble("speed", 1.0).toFloat().coerceIn(0.25f, 4f)
        // Die Position der Ton-Prozessoren zählt in Ausgabezeit des Clips (das Tempo ist dann schon angewandt)
        if (!removeAudio && !o.optBoolean("image") && o.optBoolean("hasAudio", true)) voiceFor(o, speed.toDouble())?.let { audio.add(0, it) }   // vor Lautstärke und Blenden
        if (!removeAudio && fade > 0 && !o.optBoolean("image") && o.optBoolean("hasAudio", true))
            audio.add(GainProcessor(GainCurve(DoubleArray(0), FloatArray(0), 0.0, fade, (outS - inS) / speed)))
        if (Math.abs(speed - 1f) > 0.001) b.setSpeed(object : SpeedProvider {
            override fun getSpeed(timeUs: Long): Float = speed
            override fun getNextSpeedChangeTimeUs(timeUs: Long): Long = C.TIME_UNSET
        })
        if (removeVideo) b.setRemoveVideo(true)
        return b.setEffects(Effects(audio, if (removeVideo) listOf() else fx)).build()
    }

    private fun clip(uri: String, inS: Double, outS: Double): MediaItem =
        MediaItem.Builder().setUri(Uri.parse(uri)).setClippingConfiguration(
            MediaItem.ClippingConfiguration.Builder()
                .setStartPositionMs((inS * 1000).roundToLong())
                .setEndPositionMs((outS * 1000).roundToLong()).build()
        ).build()

    private val audioOnly = plan.optString("format") == "audio"

    /** Nur Ton: Hauptspur, hörbare Videospuren und Tonspuren gemischt als M4A (AAC). */
    private fun startAudio(): Composition.Builder {
        val segs = plan.getJSONArray("segments")
        val main = EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_AUDIO)); var n = 0
        for (i in 0 until segs.length()) {
            val s = segs.getJSONObject(i)
            val inS = s.getDouble("in"); val outS = s.getDouble("out"); val sp = s.optDouble("speed", 1.0).coerceIn(0.25, 4.0)
            if (outS - inS <= 0.01) continue
            if (s.optBoolean("image")) { main.addGap(us((outS - inS) / sp)); continue }
            main.addItem(item(s, inS, outS, false, emptyList(), removeVideo = true, fade = CUT_FADE)); n++
        }
        require(n > 0) { "Im Schnitt ist kein Ton enthalten." }
        val total = plan.getDouble("total")
        val ovs = plan.optJSONArray("overlays") ?: JSONArray()
        val hearable = (0 until ovs.length()).map { ovs.getJSONObject(it) }.filter {
            it.optString("mode") == "audio" || (it.optDouble("vol", 0.0) > 0 && it.optBoolean("hasAudio", true) && !it.optBoolean("image")) }
        val seqs = arrayListOf(main.build())
        for ((_, l0) in hearable.groupBy { (if (it.optString("mode") == "audio") "a" else "v") + it.optInt("track", 1) }) {
            val seq = EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_AUDIO)); var cursor = 0.0; var k = 0
            for (o in l0.sortedBy { it.getDouble("at") }) {
                val at = maxOf(o.getDouble("at"), cursor); val inS = o.getDouble("in"); val dur = minOf(o.getDouble("out") - inS, total - at)
                if (dur <= 0.05) continue
                if (at - cursor > 0.01) seq.addGap(us(at - cursor))
                seq.addItem(EditedMediaItem.Builder(clip(o.getString("uri"), inS, inS + dur)).setRemoveVideo(true).setEffects(Effects(sideAudio(o, at, dur), listOf())).build())
                cursor = at + dur; k++
            }
            if (k == 0) continue
            if (total - cursor > 0.01) seq.addGap(us(total - cursor))
            seqs.add(seq.build())
        }
        return Composition.Builder(seqs)
    }

    // Hintergrundbilder fürs Freistellen, je Datei einmal geladen (höchstens 2048 px Kante)
    private val backdrops = HashMap<String, Bitmap?>()
    private fun backdropOf(uri: String): Bitmap? {
        if (uri.isEmpty()) return null
        return backdrops.getOrPut(uri) { runCatching {
            val u = Uri.parse(uri)
            fun open() = if (u.scheme == "content") ctx.contentResolver.openInputStream(u) else u.path?.let { java.io.FileInputStream(it) }
            val b = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
            open()?.use { android.graphics.BitmapFactory.decodeStream(it, null, b) }
            var n = 1; while (maxOf(b.outWidth, b.outHeight) / n > 2048) n *= 2
            open()?.use { android.graphics.BitmapFactory.decodeStream(it, null, android.graphics.BitmapFactory.Options().apply { inSampleSize = n }) }
        }.getOrNull() }
    }

    private fun colorBitmap(hex: String): Bitmap = Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888).apply {
        eraseColor(runCatching { android.graphics.Color.parseColor(hex) }.getOrDefault(android.graphics.Color.BLACK)) }

    /** Ein Abschnitt im Aufbau der Hauptspur: eingepasst, mit Zoom, Lage und Größe, Farben und Freistellen.
     *  layer: als Bild-Ebene eines Übergangs – ohne Ton und bis an den Bildrand deckend. */
    private fun mainItem(s: JSONObject, layer: Boolean = false): EditedMediaItem {
        val fx = ArrayList<Effect>()
        var zooms = s.optJSONArray("zooms")
        var sc = s.optDouble("sc", 1.0); var tx = s.optDouble("tx", 0.0); var ty = s.optDouble("ty", 0.0)
        // Keyframes: Lage und Größe ändern sich über die Zeit (ein Keyframe = feste Werte)
        val kfA = s.optJSONArray("kf")
        val kfs = if (kfA == null) emptyList() else (0 until kfA.length()).map { kfA.getJSONObject(it) }
            .map { doubleArrayOf(it.optDouble("t", 0.0), it.optDouble("tx", 0.0), it.optDouble("ty", 0.0), it.optDouble("sc", 1.0).coerceIn(0.05, 20.0)) }.sortedBy { it[0] }
        if (kfs.size == 1) { tx = kfs[0][1]; ty = kfs[0][2]; sc = kfs[0][3] }
        val animated = kfs.size >= 2
        // Vergrößerter Ausschnitt, der das Bild füllt (z. B. 9:16 aus 16:9): direkt aus der Quelle ausschneiden (bleibt scharf)
        val win = if (animated) null else coverWindow(s, sc, tx, ty)
        if (win != null) {
            fx.add(androidx.media3.effect.Crop(win[0], win[1], win[2], win[3]))
            if (zooms != null) zooms = JSONArray().also { a -> for (k in 0 until zooms!!.length()) a.put(JSONObject(zooms!!.getJSONObject(k).toString()).apply {
                put("cx", (0.5 + (optDouble("cx", 0.5) - 0.5) * sc + tx).coerceIn(0.0, 1.0)); put("cy", (0.5 + (optDouble("cy", 0.5) - 0.5) * sc + ty).coerceIn(0.0, 1.0)) }) }
        }
        if (zooms != null && zooms.length() > 0) fx.add(ZoomEffect(s.getDouble("in"), zooms))
        fx.add(Presentation.createForWidthAndHeight(w, h, Presentation.LAYOUT_SCALE_TO_FIT))
        // Lage und Größe des Clips (Mitte verschieben, um die Mitte skalieren)
        if (animated) fx.add(KeyframeEffect(kfs, s.optDouble("speed", 1.0).coerceIn(0.25, 4.0)))
        else if (win == null && (Math.abs(sc - 1) > 1e-3 || Math.abs(tx) > 1e-4 || Math.abs(ty) > 1e-4)) fx.add(TransformEffect(sc.toFloat(), tx.toFloat(), ty.toFloat()))
        val key = s.optJSONObject("key")
        val keyed = key != null && s.optBoolean("hasVideo", true)
        // Freigestellt: Das Hauptbild bleibt durchsichtig, bis Lage und Größe stehen; dann kommt der Hintergrund dahinter (Bild oder
        // Farbe) und füllt die ganze Fläche – auch die Ränder eines eingepassten oder verkleinerten Bilds
        val backdrop = if (keyed) (backdropOf(key!!.optString("bgImg")) ?: colorBitmap(key.optString("bg", "#000000"))) else null
        if (backdrop != null) fx.add(BackdropEffect(backdrop))
        if (layer) fx.add(OpaqueEffect())
        return item(s, s.getDouble("in"), s.getDouble("out"), layer, fx,
            pre = if (keyed) listOf(ChromaKeyEffect(key!!, backdrop == null)) else emptyList(), fade = if (layer) 0.0 else CUT_FADE)
    }

    fun start() {
        job.message = "Export wird vorbereitet …"
        if (audioOnly) { launch(startAudio()); return }
        // Hauptspur
        val segs = plan.getJSONArray("segments")
        val mainItems = ArrayList<EditedMediaItem>()
        for (i in 0 until segs.length()) mainItems.add(mainItem(segs.getJSONObject(i)))
        require(mainItems.isNotEmpty()) { "Nach dem Schnitt bleibt nichts übrig." }
        // Ton und Bild ausdrücklich: Einschübe ohne Tonspur bekommen so Stille statt eines Fehlers
        val mainSeq = EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_AUDIO, C.TRACK_TYPE_VIDEO))
            .addItems(mainItems).build()

        // Videospuren über der Hauptspur: je Spur eine Sequenz (oberste Spur zuerst, die Hauptspur zuletzt)
        val ovs = plan.optJSONArray("overlays") ?: JSONArray()
        val total = plan.getDouble("total")
        val allOv = (0 until ovs.length()).map { ovs.getJSONObject(it) }
        // Bilder über allem (top: Formen, abgedeckte Bereiche, Fortschrittsbalken) liegen als Overlay auf dem fertigen Bild, nicht als Spur
        val isTop = { o: JSONObject -> o.optBoolean("top") && o.optBoolean("image") }
        val byTrack = allOv.filter { it.optString("mode") != "audio" && !isTop(it) }.groupBy { it.optInt("track", 1) }
        // Tonspuren (Musik, Geräusche): je Spur eine reine Ton-Sequenz hinter der Hauptspur
        val audSeqs = ArrayList<EditedMediaItemSequence>()
        for ((_, l0) in allOv.filter { it.optString("mode") == "audio" }.groupBy { it.optInt("track", 1) }) {
            val seq = EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_AUDIO)); var cursor = 0.0; var n = 0
            for (o in l0.sortedBy { it.getDouble("at") }) {
                val at = maxOf(o.getDouble("at"), cursor); val inS = o.getDouble("in"); val dur = minOf(o.getDouble("out") - inS, total - at)
                if (dur <= 0.05) continue
                if (at - cursor > 0.01) seq.addGap(us(at - cursor))
                seq.addItem(EditedMediaItem.Builder(clip(o.getString("uri"), inS, inS + dur)).setRemoveVideo(true).setEffects(Effects(sideAudio(o, at, dur), listOf())).build())
                cursor = at + dur; n++
            }
            if (n == 0) continue
            if (total - cursor > 0.01) seq.addGap(us(total - cursor))
            audSeqs.add(seq.build())
        }
        val seqs = ArrayList<EditedMediaItemSequence>()
        val trackSpans = ArrayList<List<OvSpan>>()
        for (trk in byTrack.keys.sortedDescending()) {
            val list = byTrack.getValue(trk).sortedBy { it.getDouble("at") }
            // Ton nur, wenn ein Element dieser Spur hörbar ist
            val withAudio = list.any { it.optDouble("vol", 0.0) > 0 && it.optBoolean("hasAudio", true) && !it.optBoolean("image") }
            val seq = EditedMediaItemSequence.Builder(if (withAudio) setOf(C.TRACK_TYPE_AUDIO, C.TRACK_TYPE_VIDEO) else setOf(C.TRACK_TYPE_VIDEO))
            val spans = ArrayList<OvSpan>()
            var cursor = 0.0
            for (o in list) {
                val at = maxOf(o.getDouble("at"), cursor)
                val inS = o.getDouble("in"); val outS = o.getDouble("out")
                val dur = minOf(outS - inS, total - at)
                if (dur <= 0.05) continue
                if (at - cursor > 0.01) seq.addGap(us(at - cursor))
                val free = o.has("w")
                val aspect = maxOf(0.05, o.optDouble("aspect", 16.0 / 9))
                val kf = o.optJSONArray("kf")?.let { a -> (0 until a.length()).map { a.getJSONObject(it) }.map { floatArrayOf(it.getDouble("t").toFloat(), it.getDouble("x").toFloat(), it.getDouble("y").toFloat(), it.getDouble("w").toFloat()) } } ?: emptyList()
                // Frei liegendes Element: Bild in der größten benötigten Breite, Seitenverhältnis des Clips
                val baseW = if (free) maxOf(o.getDouble("w"), kf.maxOfOrNull { it[3].toDouble() } ?: 0.0).coerceIn(0.02, 20.0) else 1.0
                // sehr große Elemente (z. B. hohe Screenshots) als kleinere Textur, die beim Zusammensetzen hochskaliert wird
                val texR = if (free) minOf(1.0, 4096.0 / maxOf(w * baseW, w * baseW / aspect)) else 1.0
                val pw = if (free) (maxOf(2.0, w * baseW * texR) / 2).toInt() * 2 else w
                val ph = if (free) (maxOf(2.0, pw / aspect) / 2).toInt() * 2 else h
                val o2 = JSONObject(o.toString()).put("vol", if (withAudio) o.optDouble("vol", 0.0) else 1.0)
                // Zuschnitt (Anteile links/oben/rechts/unten) zuerst, dann auf die Zielgröße bringen
                val cr = o.optJSONObject("crop")
                val cropFx: List<Effect> = if (cr == null) emptyList() else {
                    val cl = cr.optDouble("l", 0.0).toFloat(); val ct = cr.optDouble("t", 0.0).toFloat(); val crr = cr.optDouble("r", 0.0).toFloat(); val cb = cr.optDouble("b", 0.0).toFloat()
                    listOf(androidx.media3.effect.Crop(-1f + 2f * cl, 1f - 2f * crr, -1f + 2f * cb, 1f - 2f * ct))
                }
                val key = o.optJSONObject("key")
                seq.addItem(item(o2, inS, inS + dur, !withAudio || o.optBoolean("image"), cropFx + listOf(Presentation.createForWidthAndHeight(pw, ph, Presentation.LAYOUT_SCALE_TO_FIT_WITH_CROP)),
                    pre = if (key != null) listOf(ChromaKeyEffect(key, false)) else emptyList()))
                spans.add(OvSpan(at, at + dur, o.getString("mode"), o.optString("corner", "or"), o.optDouble("size", 0.33).toFloat(),
                    free, o.optDouble("x", 0.5).toFloat(), o.optDouble("y", 0.5).toFloat(), o.optDouble("w", 1.0).toFloat(), (baseW * texR).toFloat(), kf,
                    o.optDouble("opacity", 1.0).toFloat().coerceIn(0f, 1f), asp = aspect.toFloat()))
                cursor = at + dur
            }
            if (spans.isEmpty()) continue
            if (total - cursor > 0.01) seq.addGap(us(total - cursor))
            seqs.add(seq.build()); trackSpans.add(spans)
        }
        // Übergänge (plan.trans): eine eigene Bildspur direkt über der Hauptspur. Jede Ebene zeigt das Bild des anderen Clips,
        // sichtbar von at − lead bis at + d + tail; im Fenster [at, at + d) läuft die Deckkraft von a0 nach a1. An der Schnittseite
        // ist die Ebene deckend und läuft dort bildgleich mit der Hauptspur weiter (lead bzw. tail): Media3 führt die Spuren auf ein
        // Bild genau zusammen (jeweils das zeitlich nächste Bild) – der Wechsel am Schnitt bleibt so unsichtbar.
        val trans = plan.optJSONArray("trans") ?: JSONArray()
        val trSeq = EditedMediaItemSequence.Builder(setOf(C.TRACK_TYPE_VIDEO))
        val trSpans = ArrayList<OvSpan>()
        var trCursor = 0.0
        for (t in (0 until trans.length()).map { trans.getJSONObject(it) }.sortedBy { it.optDouble("at", 0.0) - it.optDouble("lead", 0.0) }) {
            val s = t.optJSONObject("seg") ?: continue
            val at = t.optDouble("at", -1.0); val d = t.optDouble("d", 0.0)
            if (at < 0 || d < 0.04) continue
            val from = at - t.optDouble("lead", 0.0).coerceAtLeast(0.0)
            if (from < trCursor - 0.02) continue   // läge über der vorigen Ebene – die Oberfläche legt Übergänge nie übereinander
            val startAt = if (from - trCursor > 0.01) from else trCursor
            val sp = s.optDouble("speed", 1.0).coerceIn(0.25, 4.0)
            val inS = s.getDouble("in")
            val len = minOf((s.getDouble("out") - inS) / sp, total - startAt)
            if (len <= 0.05) continue
            if (startAt > trCursor) trSeq.addGap(us(startAt - trCursor))
            trSeq.addItem(mainItem(JSONObject(s.toString()).put("out", inS + len * sp), layer = true))
            trSpans.add(OvSpan(startAt, startAt + len, "trans", "", 1f, r0 = at, r1 = at + d,
                a0 = t.optDouble("a0", 1.0).toFloat().coerceIn(0f, 1f), a1 = t.optDouble("a1", 1.0).toFloat().coerceIn(0f, 1f)))
            trCursor = startAt + len
        }
        if (trSpans.isNotEmpty()) {
            if (total - trCursor > 0.01) trSeq.addGap(us(total - trCursor))
            seqs.add(trSeq.build()); trackSpans.add(trSpans)
        }
        val composition = if (seqs.isEmpty()) Composition.Builder(listOf(mainSeq) + audSeqs)
            else Composition.Builder(seqs + mainSeq + audSeqs).setVideoCompositorSettings(OvSettings(w, h, trackSpans))

        // Auf dem fertig zusammengesetzten Bild, in dieser Reihenfolge: unkenntlich gemachte Bereiche (plan.blurs), Bilder über
        // allem (Formen, abgedeckte Bereiche, Fortschrittsbalken), zuletzt Untertitel, Titel und Textzeile.
        val topFx = ArrayList<Effect>()
        val regions = RegionBlurEffect.parse(plan.optJSONArray("blurs"), w)
        // je Durchgang höchstens vier Bereiche zugleich; mehr laufen in weiteren Durchgängen
        for (c in OvGeom.chunks(regions.size, 4)) topFx.add(RegionBlurEffect(regions.subList(c[0], c[1]), w, h))
        val layers = ArrayList<TextureOverlay>(TopOverlay.lanes(allOv, w, h, total))
        // Ist „Untertitel einbrennen“ aus, bleiben nur Titel und Textzeile im Bild.
        val subs = plan.optJSONObject("subs")
        if (subs != null) {
            val all = subs.getJSONArray("cues")
            val cues = if (plan.optBoolean("burn", true)) all else JSONArray().also { only ->
                for (i in 0 until all.length()) { val c = all.getJSONObject(i); if (c.optBoolean("title")) only.put(c) }
            }
            if (cues.length() > 0) layers.add(SubtitleOverlay(ctx, w, h, cues, subs.getJSONObject("style"), subs.optJSONObject("fonts")))
        }
        // eine Overlay-Stufe nimmt nur wenige Bilder auf einmal (Textureinheiten des Geräts): in Gruppen zu sechs
        for (c in OvGeom.chunks(layers.size, 6)) topFx.add(OverlayEffect(layers.subList(c[0], c[1]).toList()))
        if (topFx.isNotEmpty()) composition.setEffects(Effects(listOf(), topFx))

        // Handyvideos sind oft HDR (HLG/HDR10). Bild-Overlays (Untertitel, Fotos) gehen in HDR nicht –
        // deshalb wird beim Export nach SDR umgerechnet; das ist auch das Format, das überall abspielbar ist.
        composition.setHdrMode(Composition.HDR_MODE_TONE_MAP_HDR_TO_SDR_USING_OPEN_GL)
        launch(composition)
    }

    private fun launch(composition: Composition.Builder) {
        outFile = File(ctx.cacheDir, "export_${System.currentTimeMillis()}." + (if (audioOnly) "m4a" else "mp4"))
        // Bitrate passend zur Auflösung (Bit pro Pixel je Qualitätsstufe), damit die Qualität dem Original nahekommt
        val bpp = when (plan.optString("quality", "standard")) { "hoch" -> 0.22; "klein" -> 0.08; else -> 0.14 }
        val bitrate = (w.toDouble() * h * fps * bpp).coerceIn(3e6, 90e6).toInt()
        val encoders = DefaultEncoderFactory.Builder(ctx)
            .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(bitrate).build())
            .setEnableFallback(true).build()
        val t = Transformer.Builder(ctx)
            .setEncoderFactory(encoders)
            .setVideoMimeType(MimeTypes.VIDEO_H264)
            .setAudioMimeType(MimeTypes.AUDIO_AAC)
            // Media3 bricht ab, wenn zehn Sekunden lang kein fertiges Bild ankommt. Schwere Stellen (viele Ebenen, hohe Auflösung,
            // Wechsel zwischen Clips) brauchen auf manchen Geräten länger – deshalb eine Minute Geduld.
            .setMaxDelayBetweenMuxerSamplesMs(STALL_MS)
            .addListener(object : Transformer.Listener {
                override fun onCompleted(composition: Composition, exportResult: ExportResult) = finish()
                override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                    outFile.delete()
                    val stall = exportException.errorCode == ExportException.ERROR_CODE_MUXING_TIMEOUT
                    val was = if (stall) "Der Export ist stehen geblieben: ${STALL_MS / 1000} Sekunden lang kam kein fertiges Bild mehr an"
                              else "Export fehlgeschlagen: ${exportException.errorCodeName} – ${exportException.cause?.message ?: exportException.message}"
                    job.fail(IllegalStateException(was + stelle() + (if (stall) " (${exportException.errorCodeName})" else "")))
                }
            })
            .build()
        transformer = t
        job.onCancel { main.post { runCatching { t.cancel() }; outFile.delete(); job.fail(CancelledException()) } }
        job.message = "Exportiere …"
        t.start(composition.build(), outFile.absolutePath)
        poll()
    }

    // Für Fehlermeldungen: wo im Video der Export zuletzt war und was dort liegt (Clip, Ebenen, Übergang) – auf wenige Sekunden genau
    private var lastProgress = 0
    private fun stelle(): String = runCatching {
        val total = plan.optDouble("total", 0.0)
        if (total <= 0) return@runCatching ""
        val t = total * lastProgress / 100.0
        val teile = ArrayList<String>()
        val segs = plan.optJSONArray("segments")
        if (segs != null && !audioOnly) {
            var c = 0.0
            for (i in 0 until segs.length()) {
                val s = segs.getJSONObject(i)
                val d = (s.optDouble("out", 0.0) - s.optDouble("in", 0.0)) / s.optDouble("speed", 1.0).coerceIn(0.25, 4.0)
                if (t < c + d + 0.5 || i == segs.length() - 1) { teile.add("Clip ${i + 1} von ${segs.length()}"); break }
                c += d
            }
        }
        val ovs = plan.optJSONArray("overlays")
        if (ovs != null) {
            var bild = 0; var video = 0; var ton = 0
            for (i in 0 until ovs.length()) {
                val o = ovs.getJSONObject(i); val at = o.optDouble("at", 0.0); val d = o.optDouble("out", 0.0) - o.optDouble("in", 0.0)
                if (t < at - 3 || t > at + d + 3) continue
                if (o.optString("mode") == "audio") ton++ else if (o.optBoolean("image")) bild++ else video++
            }
            if (video > 0) teile.add(if (video == 1) "ein Video auf einer Spur darüber" else "$video Videos auf Spuren darüber")
            if (bild > 0) teile.add(if (bild == 1) "ein Bild oder eine Folie" else "$bild Bilder oder Folien")
            if (ton > 0) teile.add(if (ton == 1) "eine Tonspur" else "$ton Tonspuren")
        }
        val trans = plan.optJSONArray("trans")
        if (trans != null) for (i in 0 until trans.length()) {
            val at = trans.getJSONObject(i).optDouble("at", -99.0); val d = trans.getJSONObject(i).optDouble("d", 0.0)
            if (t >= at - 3 && t <= at + d + 3) { teile.add("ein Übergang"); break }
        }
        val m = (t / 60).toInt(); val sek = (t % 60).toInt()
        ". Stelle im Video: etwa $m:${sek.toString().padStart(2, '0')}" + (if (teile.isEmpty()) "" else " (dort: " + teile.joinToString(", ") + ")")
    }.getOrDefault("")

    private fun poll() {
        val t = transformer ?: return
        if (job.status != "running") return
        val holder = ProgressHolder()
        if (t.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) {
            lastProgress = holder.progress
            job.progress = holder.progress / 100.0 * 0.97
            job.message = "Exportiere … ${holder.progress} %"
        }
        main.postDelayed({ poll() }, 400)
    }

    private fun finish() {
        job.message = if (audioOnly) "Speichere bei der Musik …" else "Speichere in der Galerie …"
        Thread {
            var uri: Uri? = null
            try {
                val base = plan.optString("name", "HoneyCut").ifBlank { "HoneyCut" }
                    .replace(Regex("[\\\\/:*?\"<>|]"), "_").take(80)
                val stamp = java.text.SimpleDateFormat("yyyyMMdd_HHmmss", java.util.Locale.GERMANY).format(java.util.Date())
                val name = "${base}_$stamp." + (if (audioOnly) "m4a" else "mp4")
                val folder = if (audioOnly) "Music/HoneyCut" else "DCIM/HoneyCut"
                val now = System.currentTimeMillis()
                val values = ContentValues().apply {
                    put(MediaStore.MediaColumns.DISPLAY_NAME, name)
                    put(MediaStore.MediaColumns.TITLE, base)
                    put(MediaStore.MediaColumns.MIME_TYPE, if (audioOnly) "audio/mp4" else "video/mp4")
                    put(MediaStore.MediaColumns.RELATIVE_PATH, folder)
                    if (!audioOnly) put(MediaStore.Video.Media.DATE_TAKEN, now)
                    put(MediaStore.MediaColumns.DATE_ADDED, now / 1000)
                    put(MediaStore.MediaColumns.DATE_MODIFIED, now / 1000)
                    put(MediaStore.MediaColumns.IS_PENDING, 1)
                }
                val coll = if (audioOnly) MediaStore.Audio.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                           else MediaStore.Video.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY)
                uri = ctx.contentResolver.insert(coll, values) ?: throw IllegalStateException("Galerie nicht erreichbar")
                ctx.contentResolver.openOutputStream(uri, "w")!!.use { out -> outFile.inputStream().use { it.copyTo(out, 1 shl 20) } }
                values.clear(); values.put(MediaStore.MediaColumns.IS_PENDING, 0)
                ctx.contentResolver.update(uri, values, null, null)
                outFile.delete()
                job.done(JSONObject().put("uri", uri.toString()).put("name", name).put("folder", folder))
            } catch (e: Throwable) {
                uri?.let { runCatching { ctx.contentResolver.delete(it, null, null) } }
                job.fail(e)
            }
        }.start()
    }

    // ── Overlay-Steuerung ──
    data class OvSpan(val a: Double, val b: Double, val mode: String, val corner: String, val size: Float,
                      val free: Boolean = false, val x: Float = 0.5f, val y: Float = 0.5f, val wf: Float = 1f, val baseW: Float = 1f,
                      val kf: List<FloatArray> = emptyList(), val alpha: Float = 1f,
                      val r0: Double = 0.0, val r1: Double = 0.0, val a0: Float = 1f, val a1: Float = 1f,   // Übergang: Deckkraft a0 → a1 von r0 bis r1
                      val asp: Float = 16f / 9f)   // Seitenverhältnis eines frei liegenden Elements (für seine Höhe im Bild)

    class OvSettings(private val w: Int, private val h: Int, private val tracks: List<List<OvSpan>>) : VideoCompositorSettings {
        private val hidden = StaticOverlaySettings.Builder().setAlphaScale(0f).build()
        private val full = StaticOverlaySettings.Builder().build()
        override fun getOutputSize(inputSizes: List<Size>): Size = Size(w, h)
        override fun getOverlaySettings(inputId: Int, presentationTimeUs: Long): OverlaySettings {
            if (inputId >= tracks.size) return full // Hauptspur
            val t = presentationTimeUs / 1e6
            val s = tracks[inputId].firstOrNull { t >= it.a - 0.001 && t < it.b } ?: return hidden
            if (s.mode == "trans") {   // Übergang: vor dem Fenster der Anfangswert, im Fenster die Rampe, dahinter der Endwert
                val f = if (s.r1 > s.r0) ((t - s.r0) / (s.r1 - s.r0)).coerceIn(0.0, 1.0).toFloat() else 1f
                val al = (s.a0 + (s.a1 - s.a0) * f).coerceIn(0f, 1f)
                return if (al >= 0.999f) full else StaticOverlaySettings.Builder().setAlphaScale(al).build()
            }
            if (s.free) {
                // Keyframes: stückweise linear; Bild liegt in der Breite baseW vor und wird auf die aktuelle Breite skaliert
                var x = s.x; var y = s.y; var wf = s.wf
                if (s.kf.isNotEmpty()) {
                    val rel = (t - s.a).toFloat(); val k = s.kf
                    when {
                        rel <= k[0][0] -> { x = k[0][1]; y = k[0][2]; wf = k[0][3] }
                        rel >= k.last()[0] -> { x = k.last()[1]; y = k.last()[2]; wf = k.last()[3] }
                        else -> for (i in 0 until k.size - 1) if (rel < k[i + 1][0]) {
                            val f = (rel - k[i][0]) / maxOf(1e-6f, k[i + 1][0] - k[i][0])
                            x = k[i][1] + (k[i + 1][1] - k[i][1]) * f; y = k[i][2] + (k[i + 1][2] - k[i][2]) * f; wf = k[i][3] + (k[i + 1][3] - k[i][3]) * f
                            break
                        }
                    }
                }
                val sc = wf / s.baseW
                // Die Mitte darf außerhalb des Bilds liegen (große oder herangefahrene Elemente): Media3 nimmt für die Anker nur −1 … 1
                // an und brach den Export sonst ab. Dann sitzt der Anker an der Stelle des Elements, die auf dem Bildrand liegt.
                val ax = OvGeom.anchor(x * 2 - 1, wf) ?: return hidden
                val ay = OvGeom.anchor(1 - y * 2, wf * w / (maxOf(0.05f, s.asp) * h)) ?: return hidden
                return StaticOverlaySettings.Builder().setScale(sc, sc).setAlphaScale(s.alpha)
                    .setOverlayFrameAnchor(ax[0], ay[0]).setBackgroundFrameAnchor(ax[1], ay[1]).build()
            }
            if (s.mode != "pip") return full
            val m = 0.06f // Rand in NDC
            val right = s.corner.endsWith("r"); val top = s.corner.startsWith("o")
            val my = m * w / h
            return StaticOverlaySettings.Builder()
                .setScale(s.size, s.size)
                .setOverlayFrameAnchor(if (right) 1f else -1f, if (top) 1f else -1f)
                .setBackgroundFrameAnchor(if (right) 1f - m else -1f + m, if (top) 1f - my else -1f + my)
                .build()
        }
    }

    // ── Lage und Größe eines Hauptspur-Clips ──
    class TransformEffect(private val sc: Float, private val tx: Float, private val ty: Float) : MatrixTransformation {
        override fun getMatrix(presentationTimeUs: Long): Matrix = Matrix().apply { setScale(sc, sc); postTranslate(2 * tx, -2 * ty) }
    }

    // ── Keyframes der Hauptspur: Lage/Größe stückweise linear; t = Quellsekunden ab Abschnittsbeginn ──
    class KeyframeEffect(private val kf: List<DoubleArray>, private val speed: Double) : MatrixTransformation {
        private var first = Long.MIN_VALUE
        override fun getMatrix(presentationTimeUs: Long): Matrix {
            if (first == Long.MIN_VALUE) first = presentationTimeUs
            val rel = (presentationTimeUs - first) / 1e6 * speed
            var tx = kf[0][1]; var ty = kf[0][2]; var sc = kf[0][3]
            when {
                rel <= kf[0][0] -> {}
                rel >= kf.last()[0] -> { tx = kf.last()[1]; ty = kf.last()[2]; sc = kf.last()[3] }
                else -> for (i in 0 until kf.size - 1) if (rel < kf[i + 1][0]) {
                    val f = (rel - kf[i][0]) / maxOf(1e-6, kf[i + 1][0] - kf[i][0])
                    tx = kf[i][1] + (kf[i + 1][1] - kf[i][1]) * f; ty = kf[i][2] + (kf[i + 1][2] - kf[i][2]) * f; sc = kf[i][3] + (kf[i + 1][3] - kf[i][3]) * f
                    break
                }
            }
            return Matrix().apply { setScale(sc.toFloat(), sc.toFloat()); postTranslate((2 * tx).toFloat(), (-2 * ty).toFloat()) }
        }
    }

    // ── Zoom (Sprung oder Fahrt) – Zeiten in Sekunden der Quelle ──
    class ZoomEffect(private val segIn: Double, zooms: JSONArray) : MatrixTransformation {
        private data class Z(val at: Double, val dur: Double, val kind: String, val strength: Double, val cx: Double, val cy: Double)
        private val zs = (0 until zooms.length()).map { zooms.getJSONObject(it) }.map {
            Z(it.getDouble("at"), it.getDouble("dur"), it.getString("kind"), it.getDouble("strength"), it.getDouble("cx"), it.getDouble("cy"))
        }
        private var first = Long.MIN_VALUE
        override fun getMatrix(presentationTimeUs: Long): Matrix {
            if (first == Long.MIN_VALUE) first = presentationTimeUs
            val src = segIn + (presentationTimeUs - first) / 1e6
            var s = 1.0; var cx = 0.5; var cy = 0.5
            for (z in zs) {
                if (src < z.at || src > z.at + z.dur) continue
                val p = ((src - z.at) / z.dur).coerceIn(0.0, 1.0); val e = p * p * (3 - 2 * p)
                s = when (z.kind) { "punch" -> z.strength; "out" -> z.strength + (1 - z.strength) * e; else -> 1 + (z.strength - 1) * e }
                cx = z.cx; cy = z.cy
            }
            val m = Matrix()
            if (s > 1.0005) m.setScale(s.toFloat(), s.toFloat(), (2 * cx - 1).toFloat(), (1 - 2 * cy).toFloat())
            return m
        }
    }

    // ── Untertitel als Bild-Overlay in Ausgabegröße, an freier Position (x/y = Mittelpunkt, 0…1) ──
    class SubtitleOverlay(ctx: Context, private val w: Int, private val h: Int, cues: JSONArray, style: JSONObject, fonts: JSONObject?) : BitmapOverlay() {
        // Effekte (2.32), bezogen auf die Wörter des Textes in ihrer Reihenfolge: words = Beginn und Ende je Wort (Ausgabezeit),
        // hl = Farbe des gesprochenen Worts, build = Wörter erscheinen erst beim Sprechen, spans = Farbe einzelner Wörter,
        // anim = fade | pop beim Erscheinen. ranges = Zeichenbereiche der Wörter im Text.
        private data class Cue(val s: Double, val e: Double, val text: String, val x: Float, val y: Float, val size: Float, val color: Int, val outline: Boolean, val bg: Boolean, val face: Typeface, val stroke: Int,
                               val words: List<DoubleArray>, val hl: Int?, val build: Boolean, val spans: Map<Int, Int>, val anim: String, val ranges: List<IntRange>) {
            val fx: Boolean get() = words.isNotEmpty() || spans.isNotEmpty() || anim.isNotEmpty()
        }
        private val animS = 0.16
        private fun animP(c: Cue, t: Double): Float = if (c.anim.isEmpty()) 1f else ((t - c.s) / animS).coerceIn(0.0, 1.0).toFloat()
        // Farbe je Wort zum Zeitpunkt t: null = Grundfarbe, Color.TRANSPARENT = noch verborgen
        private fun wordColors(c: Cue, t: Double): Array<Int?> {
            val tt = if (c.anim.isNotEmpty() && t < c.s + animS) c.s else t   // während der Animation gilt der Stand vom Anfang
            return Array(c.ranges.size) { i ->
                var v: Int? = c.spans[i]
                if (i < c.words.size) {
                    val span = c.words[i]
                    if (c.build && tt < span[0] - 1e-6) v = Color.TRANSPARENT
                    else if (c.hl != null && tt >= span[0] - 1e-6 && tt < span[1] - 1e-6) v = c.hl
                }
                v
            }
        }
        private val faces = HashMap<String, Typeface>()
        private val bold = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
        // Mitgelieferte Schriften liegen in den Assets (web/fonts), eigene im App-Verzeichnis
        private val faceOf: (String) -> Typeface = { key ->
            if (key.isEmpty() || fonts?.optJSONObject(key) == null) bold
            else faces.getOrPut(key) {
                val f = fonts.getJSONObject(key)
                runCatching {
                    if (f.has("file")) Typeface.createFromAsset(ctx.assets, "web/fonts/" + File(f.getString("file")).name)
                    else Typeface.createFromFile(f.getString("uri"))
                }.getOrDefault(bold)
            }
        }
        private fun fxColor(s: String): Int? = if (s.isEmpty()) null else runCatching { Color.parseColor(s) }.getOrNull()
        private fun fxWords(o: JSONObject): List<DoubleArray> {
            val a = o.optJSONArray("words") ?: return emptyList()
            if (fxColor(o.optString("hl", "")) == null && !o.optBoolean("build")) return emptyList()
            val out = ArrayList<DoubleArray>()
            for (k in 0 until a.length()) { val p = a.optJSONArray(k) ?: break; out.add(doubleArrayOf(p.optDouble(0, 0.0), p.optDouble(1, 0.0))) }
            return out
        }
        private fun fxSpans(o: JSONObject): Map<Int, Int> {
            val a = o.optJSONArray("spans") ?: return emptyMap()
            val m = HashMap<Int, Int>()
            for (k in 0 until a.length()) { val p = a.optJSONArray(k) ?: continue; val col = fxColor(p.optString(1, "")) ?: continue; m[p.optInt(0, -1)] = col }
            return m
        }
        private val baseFace = faceOf(style.optString("font", ""))
        private val defX = style.optDouble("x", 0.5).toFloat()
        private val defY = style.optDouble("y", when (style.optString("pos", "unten")) { "oben" -> 0.12; "mitte" -> 0.5; else -> 0.88 }).toFloat()
        private val baseSize = (when (style.optString("size", "mittel")) { "klein" -> 0.045; "groß" -> 0.075; else -> 0.058 } * minOf(w, h) * (if (h > w) 1.25 else 1.0)).toFloat()
        private val baseColor = runCatching { Color.parseColor(style.optString("color", "#FFFFFF")) }.getOrDefault(Color.WHITE)
        private val baseOutline = style.optBoolean("outline", true)
        private val baseStroke = runCatching { Color.parseColor(style.optString("outlineColor", "#000000").ifEmpty { "#000000" }) }.getOrDefault(Color.BLACK)
        private val list = (0 until cues.length()).map { cues.getJSONObject(it) }.map {
            val isTitle = it.optBoolean("title")
            Cue(it.getDouble("start"), it.getDouble("end"), it.getString("text"),
                if (it.isNull("x")) defX else it.optDouble("x", defX.toDouble()).toFloat(),
                if (it.isNull("y")) defY else it.optDouble("y", defY.toDouble()).toFloat(),
                if (it.isNull("size")) baseSize else (it.getDouble("size") * minOf(w, h) * (if (h > w) 1.25 else 1.0)).toFloat(),
                if (it.isNull("color")) baseColor else runCatching { Color.parseColor(it.getString("color")) }.getOrDefault(baseColor),
                if (it.has("outline") && !it.isNull("outline")) it.optBoolean("outline", true) else baseOutline,
                it.optBoolean("bg"),
                if (isTitle || it.has("font")) faceOf(it.optString("font", "")) else baseFace,
                if (it.has("outlineColor") && !it.isNull("outlineColor")) runCatching { Color.parseColor(it.getString("outlineColor")) }.getOrDefault(baseStroke) else if (isTitle) Color.BLACK else baseStroke,
                fxWords(it), fxColor(it.optString("hl", "")), it.optBoolean("build"), fxSpans(it), it.optString("anim", "").let { a -> if (a == "fade" || a == "pop") a else "" },
                Regex("\\S+").findAll(it.getString("text")).map { m -> m.range }.toList())
        }
        // Ein einziges Bild, das bei jedem Wechsel neu bemalt wird (spart bei 4K viel Speicher)
        private val bmp: Bitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        private var curKey = "?"

        override fun getBitmap(presentationTimeUs: Long): Bitmap {
            val t = presentationTimeUs / 1e6
            // Untertitel und Titel können gleichzeitig sichtbar sein
            val act = list.indices.filter { t >= list[it].s && t < list[it].e }
            // Mit Effekten gehört zum Schlüssel, was die Wörter gerade zeigen und wie weit die Animation ist (acht Stufen)
            val key = act.joinToString(",") { i ->
                val cue = list[i]
                if (!cue.fx) "$i" else "$i:" + wordColors(cue, t).joinToString("") { v -> v?.toString(16) ?: "-" } + ":" + (animP(cue, t) * 8).toInt()
            }
            if (key != curKey) {
                curKey = key
                bmp.eraseColor(Color.TRANSPARENT)
                for (i in act) render(list[i], t)
            }
            return bmp
        }

        private fun render(cue: Cue, t: Double) {
            val c = Canvas(bmp)
            val text = cue.text
            val size = cue.size
            val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply { textSize = size; typeface = cue.face }
            val width = (w * 0.88).toInt()
            val colors = if (cue.fx) wordColors(cue, t) else null
            // Füllung: jedes Wort in seiner Farbe; Umrandung: nur die verborgenen Wörter fallen weg
            fun marked(strokePass: Boolean): CharSequence {
                if (colors == null) return text
                val sp = SpannableString(text)
                for ((i, r) in cue.ranges.withIndex()) {
                    val v = colors[i] ?: continue
                    if (strokePass && v != Color.TRANSPARENT) continue
                    sp.setSpan(ForegroundColorSpan(v), r.first, r.last + 1, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
                }
                return sp
            }
            fun layout(p: TextPaint, cs: CharSequence = text) = StaticLayout.Builder.obtain(cs, 0, cs.length, p, width)
                .setAlignment(Layout.Alignment.ALIGN_CENTER).setLineSpacing(0f, 1.08f).build()
            val fill = layout(paint.apply { color = cue.color; style = Paint.Style.FILL }, marked(false))
            // tatsächliche Breite des Textblocks, damit er ganz im Bild bleibt
            var lw = 0f
            for (i in 0 until fill.lineCount) lw = maxOf(lw, fill.getLineWidth(i))
            val m = 0.02f
            val cx = if (lw >= w * (1 - 2 * m)) w / 2f else (cue.x * w).coerceIn(lw / 2 + m * w, w - lw / 2 - m * w)
            val top = (cue.y * h - fill.height / 2f).coerceIn(m * h, maxOf(m * h, h - m * h - fill.height))
            // Einblenden und Aufpoppen: der ganze Untertitel samt Kasten, um seine Mitte
            val prog = animP(cue, t)
            val layers = c.saveCount
            if (cue.anim == "pop") { c.save(); val sc = 0.84f + 0.16f * prog; c.scale(sc, sc, cx, top + fill.height / 2f) }
            if (cue.anim == "fade" && prog < 1f) c.saveLayerAlpha(0f, 0f, w.toFloat(), h.toFloat(), (255 * prog).toInt())
            if (cue.bg) {
                val pad = size * 0.25f
                val box = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.argb(140, 0, 0, 0) }
                c.drawRoundRect(cx - lw / 2 - pad, top - pad * 0.6f, cx + lw / 2 + pad, top + fill.height + pad * 0.6f, size * 0.15f, size * 0.15f, box)
            }
            c.save(); c.translate(cx - width / 2f, top)
            if (cue.outline && !cue.bg) {
                val sp = TextPaint(paint).apply { style = Paint.Style.STROKE; strokeWidth = size / 7f; strokeJoin = Paint.Join.ROUND; color = cue.stroke }
                layout(sp, marked(true)).draw(c)
            } else {
                paint.setShadowLayer(size / 10f, 0f, size / 20f, Color.argb(200, 0, 0, 0))
            }
            fill.draw(c)
            c.restore()
            c.restoreToCount(layers)
        }

        override fun getOverlaySettings(presentationTimeUs: Long): OverlaySettings = StaticOverlaySettings.Builder().build()
    }
}
