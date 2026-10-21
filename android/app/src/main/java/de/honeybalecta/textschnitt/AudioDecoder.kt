package de.honeybalecta.textschnitt

import android.content.Context
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.exp

/** Dekodiert die Tonspur und liefert 16-kHz-Mono als Float – so, wie Whisper es braucht. */
object AudioDecoder {
    fun decode(ctx: Context, uri: Uri, job: Job, progressSpan: Double): FloatArray {
        val ex = MediaExtractor()
        ex.setDataSource(ctx, uri, null)
        var track = -1
        var fmt: MediaFormat? = null
        for (i in 0 until ex.trackCount) {
            val f = ex.getTrackFormat(i)
            if (f.getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true) { track = i; fmt = f; break }
        }
        if (track < 0 || fmt == null) { ex.release(); throw IllegalStateException("Keine Tonspur gefunden") }
        ex.selectTrack(track)
        val mime = fmt.getString(MediaFormat.KEY_MIME)!!
        val durUs = if (fmt.containsKey(MediaFormat.KEY_DURATION)) fmt.getLong(MediaFormat.KEY_DURATION) else 0L
        val codec = MediaCodec.createDecoderByType(mime)
        codec.configure(fmt, null, null, 0)
        codec.start()

        var rate = fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        var channels = fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
        var encoding = AudioFormat.ENCODING_PCM_16BIT
        val out = FloatBuf((durUs / 1e6 * 16000).toInt().coerceAtLeast(16000) + 16000)
        var rs = Resampler(rate, out)
        val info = MediaCodec.BufferInfo()
        var inDone = false
        var outDone = false
        try {
            while (!outDone) {
                job.check()
                if (!inDone) {
                    val ii = codec.dequeueInputBuffer(10_000)
                    if (ii >= 0) {
                        val buf = codec.getInputBuffer(ii)!!
                        val n = ex.readSampleData(buf, 0)
                        if (n < 0) { codec.queueInputBuffer(ii, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inDone = true }
                        else { codec.queueInputBuffer(ii, 0, n, ex.sampleTime, 0); ex.advance() }
                    }
                }
                val oi = codec.dequeueOutputBuffer(info, 10_000)
                if (oi >= 0) {
                    if (info.size > 0) {
                        val ob = codec.getOutputBuffer(oi)!!.order(ByteOrder.nativeOrder())
                        ob.position(info.offset); ob.limit(info.offset + info.size)
                        if (encoding == AudioFormat.ENCODING_PCM_FLOAT) {
                            val fb = ob.asFloatBuffer(); val frames = fb.remaining() / channels
                            for (f in 0 until frames) { var s = 0f; for (c in 0 until channels) s += fb.get(); rs.push(s / channels) }
                        } else {
                            val sb = ob.asShortBuffer(); val frames = sb.remaining() / channels
                            for (f in 0 until frames) { var s = 0f; for (c in 0 until channels) s += sb.get(); rs.push(s / channels / 32768f) }
                        }
                        if (durUs > 0) {
                            job.progress = progressSpan * (info.presentationTimeUs.toDouble() / durUs).coerceIn(0.0, 1.0)
                            job.message = "Ton wird gelesen … ${(100 * info.presentationTimeUs / durUs).coerceIn(0, 100)} %"
                        }
                    }
                    codec.releaseOutputBuffer(oi, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) outDone = true
                } else if (oi == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    val of = codec.outputFormat
                    rate = of.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                    channels = of.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    encoding = if (of.containsKey(MediaFormat.KEY_PCM_ENCODING)) of.getInteger(MediaFormat.KEY_PCM_ENCODING) else AudioFormat.ENCODING_PCM_16BIT
                    rs = Resampler(rate, out)
                }
            }
        } finally {
            runCatching { codec.stop() }; codec.release(); ex.release()
        }
        return out.toArray()
    }

    class FloatBuf(cap: Int) {
        private var a = FloatArray(cap); var n = 0; private set
        fun add(x: Float) { if (n == a.size) a = a.copyOf(a.size * 2); a[n++] = x }
        fun toArray(): FloatArray = a.copyOf(n)
    }

    /** Linearer Resampler auf 16 kHz mit zwei Tiefpass-Stufen gegen Aliasing. */
    class Resampler(srcRate: Int, private val out: FloatBuf) {
        private val step = srcRate / 16000.0
        private val a = if (srcRate > 16000) (1 - exp(-2 * PI * 7000.0 / srcRate)).toFloat() else 1f
        private var lp1 = 0f; private var lp2 = 0f
        private var pos = 0.0; private var idx = 0L; private var prev = 0f
        fun push(x: Float) {
            lp1 += a * (x - lp1); lp2 += a * (lp1 - lp2)
            val y = lp2
            while (pos <= idx) { val frac = (pos - (idx - 1)).toFloat(); out.add(prev + (y - prev) * frac); pos += step }
            prev = y; idx++
        }
    }
}
