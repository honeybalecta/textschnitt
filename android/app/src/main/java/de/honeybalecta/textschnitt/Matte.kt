package de.honeybalecta.textschnitt

import android.content.Context
import android.graphics.Bitmap
import android.net.Uri
import android.opengl.GLES20
import android.os.Handler
import android.os.Looper
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.GlProgram
import androidx.media3.common.util.GlUtil
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BaseGlShaderProgram
import androidx.media3.effect.GlEffect
import androidx.media3.effect.GlShaderProgram
import androidx.media3.transformer.Composition
import androidx.media3.transformer.DefaultEncoderFactory
import androidx.media3.transformer.EditedMediaItem
import androidx.media3.transformer.Effects
import androidx.media3.transformer.ExportException
import androidx.media3.transformer.ExportResult
import androidx.media3.transformer.ProgressHolder
import androidx.media3.transformer.Transformer
import androidx.media3.transformer.VideoEncoderSettings
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.segmentation.Segmentation
import com.google.mlkit.vision.segmentation.Segmenter
import com.google.mlkit.vision.segmentation.selfie.SelfieSegmenterOptions
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Automatisch freistellen: Erzeugt eine Kopie des Videos, in der alles außer der Person in Schlüsselgrün steht.
 * Die Person erkennt ML Kit (Selfie-Segmentierung, Modell im Programm enthalten, kein Netz nötig); das Zusammen-
 * setzen läuft Bild für Bild in OpenGL innerhalb des Media3-Transformers. Danach wird die Datei wie ein
 * Greenscreen freigestellt – genau wie am Windows-Rechner (RVM) und im Browser (MediaPipe).
 */
@OptIn(UnstableApi::class)
object Matte {
    const val BG = "#00ff00"

    fun start(ctx: Context, uri: String, job: Job) {
        val main = Handler(Looper.getMainLooper())
        val src = Uri.parse(uri)
        val info = Probe.probe(ctx, src) ?: throw IllegalStateException("Datei nicht lesbar")
        if (!info.optBoolean("hasVideo", true) || info.optString("kind") == "image") throw IllegalStateException("Freistellen geht nur mit Videos.")
        val dir = File(ctx.getExternalFilesDir(null) ?: ctx.filesDir, "Freigestellt").apply { mkdirs() }
        val out = File(dir, "m_${uri.hashCode().toUInt()}.mp4")
        val name = info.optString("name", "Video").substringBeforeLast('.') + " – freigestellt"
        fun result(): JSONObject = (Probe.probe(ctx, Uri.fromFile(out)) ?: JSONObject().put("uri", Uri.fromFile(out).toString()))
            .put("name", name).put("orig", uri)
        if (out.exists() && out.length() > 0) { job.done(result()); return }
        val tmp = File(dir, out.name + ".part.mp4")
        val w = info.optInt("width", 1280); val h = info.optInt("height", 720); val fps = info.optDouble("fps", 30.0)
        val bitrate = (w.toDouble() * h * fps * 0.14).coerceIn(4e6, 80e6).toInt()
        val encoders = DefaultEncoderFactory.Builder(ctx)
            .setRequestedVideoEncoderSettings(VideoEncoderSettings.Builder().setBitrate(bitrate).build())
            .setEnableFallback(true).build()
        val item = EditedMediaItem.Builder(MediaItem.fromUri(src))
            .setEffects(Effects(listOf(), listOf(SegmentEffect(job)))).build()
        val t = Transformer.Builder(ctx)
            .setEncoderFactory(encoders)
            .setVideoMimeType(MimeTypes.VIDEO_H264).setAudioMimeType(MimeTypes.AUDIO_AAC)
            .addListener(object : Transformer.Listener {
                override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                    tmp.renameTo(out); job.done(result())
                }
                override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                    tmp.delete(); job.fail(IllegalStateException("Freistellen fehlgeschlagen: ${exportException.errorCodeName} – ${exportException.cause?.message ?: exportException.message}"))
                }
            }).build()
        job.onCancel { main.post { runCatching { t.cancel() }; tmp.delete(); job.fail(CancelledException()) } }
        job.message = "Person wird erkannt und freigestellt …"
        t.start(item, tmp.absolutePath)
        val holder = ProgressHolder()
        fun poll() {
            if (job.status != "running") return
            if (t.getProgress(holder) == Transformer.PROGRESS_STATE_AVAILABLE) { job.progress = holder.progress / 100.0 * 0.98; job.message = "Person wird freigestellt … ${holder.progress} %" }
            main.postDelayed({ poll() }, 500)
        }
        poll()
    }

    /** GL-Effekt: verkleinertes Bild auslesen → ML Kit → Maske als Textur → Person über Grün zeichnen. */
    private class SegmentEffect(private val job: Job) : GlEffect {
        override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram = Program(job)
    }

    private class Program(private val job: Job) : BaseGlShaderProgram(false, 1) {
        private val copy = GlProgram(VS, FS_COPY)
        private val comp = GlProgram(VS, FS_COMP)
        private val segmenter: Segmenter = Segmentation.getClient(
            SelfieSegmenterOptions.Builder().setDetectorMode(SelfieSegmenterOptions.STREAM_MODE).enableRawSizeMask().build())
        private var sw = 0; private var sh = 0
        private var fbo = 0; private var smallTex = 0; private var maskTex = 0
        private var pixels: ByteBuffer? = null
        private var rows: IntArray? = null
        private var bmp: Bitmap? = null
        private var maskBytes: ByteBuffer? = null
        private var mw = 0; private var mh = 0

        init {
            for (p in listOf(copy, comp)) p.setBufferAttribute("aFramePosition", GlUtil.getNormalizedCoordinateBounds(), GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE)
        }

        override fun configure(inputWidth: Int, inputHeight: Int): Size {
            // Erkennung auf höchstens 320 px Kante – das Modell rechnet ohnehin mit 256×256
            val k = minOf(1.0, 320.0 / maxOf(inputWidth, inputHeight))
            sw = maxOf(16, (inputWidth * k).toInt()); sh = maxOf(16, (inputHeight * k).toInt())
            release(fboOnly = true)
            smallTex = GlUtil.createTexture(sw, sh, false)
            fbo = GlUtil.createFboForTexture(smallTex)
            maskTex = GlUtil.generateTexture()
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, maskTex)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
            pixels = ByteBuffer.allocateDirect(sw * sh * 4).order(ByteOrder.nativeOrder())
            rows = IntArray(sw * sh)
            bmp = Bitmap.createBitmap(sw, sh, Bitmap.Config.ARGB_8888)
            return Size(inputWidth, inputHeight)
        }

        override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
            job.check()
            val prevFbo = IntArray(1); GLES20.glGetIntegerv(GLES20.GL_FRAMEBUFFER_BINDING, prevFbo, 0)
            val vp = IntArray(4); GLES20.glGetIntegerv(GLES20.GL_VIEWPORT, vp, 0)
            // 1) verkleinert in den Zwischenpuffer zeichnen und auslesen
            GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fbo)
            GLES20.glViewport(0, 0, sw, sh)
            copy.use(); copy.setSamplerTexIdUniform("uTexSampler", inputTexId, 0); copy.bindAttributesAndUniforms()
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            val px = pixels!!; px.rewind()
            GLES20.glReadPixels(0, 0, sw, sh, GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, px)
            GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, prevFbo[0])
            GLES20.glViewport(vp[0], vp[1], vp[2], vp[3])
            // 2) Person erkennen (Bild steht in GL kopfüber: Zeilen umdrehen)
            val r = rows!!; px.rewind()
            for (y in 0 until sh) { val o = (sh - 1 - y) * sw
                for (x in 0 until sw) { val i = (y * sw + x) * 4
                    val red = px.get(i).toInt() and 255; val g = px.get(i + 1).toInt() and 255; val b = px.get(i + 2).toInt() and 255
                    r[o + x] = (255 shl 24) or (red shl 16) or (g shl 8) or b } }
            val bm = bmp!!; bm.setPixels(r, 0, sw, 0, 0, sw, sh)
            val mask = Tasks.await(segmenter.process(InputImage.fromBitmap(bm, 0)))
            val buf = mask.buffer; buf.rewind()
            if (mask.width != mw || mask.height != mh || maskBytes == null) { mw = mask.width; mh = mask.height; maskBytes = ByteBuffer.allocateDirect(mw * mh) }
            val mb = maskBytes!!; mb.rewind()
            for (i in 0 until mw * mh) mb.put((buf.getFloat().coerceIn(0f, 1f) * 255f).toInt().toByte())
            mb.rewind()
            GLES20.glActiveTexture(GLES20.GL_TEXTURE1)
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, maskTex)
            GLES20.glPixelStorei(GLES20.GL_UNPACK_ALIGNMENT, 1)
            GLES20.glTexImage2D(GLES20.GL_TEXTURE_2D, 0, GLES20.GL_LUMINANCE, mw, mh, 0, GLES20.GL_LUMINANCE, GLES20.GL_UNSIGNED_BYTE, mb)
            GLES20.glPixelStorei(GLES20.GL_UNPACK_ALIGNMENT, 4)
            // 3) Person über Grün in das Ausgabebild zeichnen
            comp.use()
            comp.setSamplerTexIdUniform("uTexSampler", inputTexId, 0)
            comp.setSamplerTexIdUniform("uMask", maskTex, 1)
            comp.bindAttributesAndUniforms()
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            GlUtil.checkGlError()
        }

        private fun release(fboOnly: Boolean) {
            if (fbo != 0) { GlUtil.deleteFbo(fbo); fbo = 0 }
            if (smallTex != 0) { GlUtil.deleteTexture(smallTex); smallTex = 0 }
            if (maskTex != 0) { GlUtil.deleteTexture(maskTex); maskTex = 0 }
            if (!fboOnly) { copy.delete(); comp.delete(); runCatching { segmenter.close() }; bmp?.recycle(); bmp = null }
        }

        override fun release() { super.release(); release(fboOnly = false) }

        companion object {
            const val VS = """attribute vec4 aFramePosition;
varying vec2 vTexSamplingCoord;
void main(){ gl_Position = aFramePosition; vTexSamplingCoord = aFramePosition.xy * 0.5 + 0.5; }"""
            const val FS_COPY = """precision mediump float;
uniform sampler2D uTexSampler;
varying vec2 vTexSamplingCoord;
void main(){ gl_FragColor = texture2D(uTexSampler, vTexSamplingCoord); }"""
            // Maske kommt aus dem Bitmap (Zeile 0 oben), die Textur steht kopfüber dazu: y spiegeln
            const val FS_COMP = """precision mediump float;
uniform sampler2D uTexSampler;
uniform sampler2D uMask;
varying vec2 vTexSamplingCoord;
void main(){
  vec4 c = texture2D(uTexSampler, vTexSamplingCoord);
  float m = texture2D(uMask, vec2(vTexSamplingCoord.x, 1.0 - vTexSamplingCoord.y)).r;
  m = smoothstep(0.35, 0.65, m);
  gl_FragColor = vec4(mix(vec3(0.0, 1.0, 0.0), c.rgb, m), 1.0);
}"""
        }
    }
}
