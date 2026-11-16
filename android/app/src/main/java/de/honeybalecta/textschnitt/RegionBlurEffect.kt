package de.honeybalecta.textschnitt

import android.content.Context
import android.opengl.GLES20
import androidx.media3.common.util.GlProgram
import androidx.media3.common.util.GlUtil
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BaseGlShaderProgram
import androidx.media3.effect.GlEffect
import androidx.media3.effect.GlShaderProgram
import org.json.JSONArray

/**
 * Unkenntlich machen im Android-Export (plan.blurs): Bereiche des fertig zusammengesetzten Bilds werden verpixelt oder
 * weichgezeichnet. Dieselben Maße wie im Windows- und im Browser-Export (OvGeom.blurBox): ein Fenster in der größten Größe des
 * Bereichs, das seiner Mitte folgt; darin ein Raster von Feldern. Verpixelt = jedes Feld in seiner mittleren Farbe; weich =
 * zwischen den mittleren Farben der Felder wird fließend gemischt. Bis zu vier Bereiche zugleich je Durchgang.
 *
 * Ein Bereich: {at, d, x, y, w, aspect, kf?: [{t, x, y, w}], form: rect|ellipse, kind: pixel|soft, cell, wmax?}
 */
@UnstableApi
class RegionBlurEffect(private val regions: List<Region>, private val w: Int, private val h: Int) : GlEffect {
    class Region(val at: Double, val d: Double, val x: Float, val y: Float, val w: Float, val aspect: Float, val wmax: Float, val cell: Float,
                 val soft: Boolean, val ellipse: Boolean, val kf: Array<FloatArray>)

    override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram = Program(regions, w, h)

    companion object {
        /** Bereiche aus dem Plan lesen; Unlesbares fällt weg. */
        fun parse(a: JSONArray?, w: Int): List<Region> {
            if (a == null) return emptyList()
            val out = ArrayList<Region>()
            for (i in 0 until a.length()) {
                val o = a.optJSONObject(i) ?: continue
                val d = o.optDouble("d", 0.0); val bw = o.optDouble("w", 0.0)
                if (d < 0.02 || bw <= 0.0) continue
                val kfA = o.optJSONArray("kf")
                val kf: List<FloatArray> = if (kfA == null || kfA.length() < 2) emptyList() else (0 until kfA.length()).mapNotNull { kfA.optJSONObject(it) }
                    .map { floatArrayOf(it.optDouble("t", 0.0).toFloat(), it.optDouble("x", 0.5).toFloat(), it.optDouble("y", 0.5).toFloat(), it.optDouble("w", bw).toFloat()) }.sortedBy { it[0] }
                val wmax = maxOf(o.optDouble("wmax", 0.0), bw, kf.maxOfOrNull { it[3].toDouble() } ?: 0.0)
                out.add(Region(o.optDouble("at", 0.0), d, o.optDouble("x", 0.5).toFloat(), o.optDouble("y", 0.5).toFloat(), bw.toFloat(),
                    maxOf(0.02, o.optDouble("aspect", 1.0)).toFloat(), wmax.toFloat(), maxOf(2.0, o.optDouble("cell", 0.02) * w).toFloat(),
                    o.optString("kind") == "soft", o.optString("form") == "ellipse", kf.toTypedArray()))
            }
            return out
        }
    }

    private class Program(private val regions: List<Region>, private val w: Int, private val h: Int) : BaseGlShaderProgram(false, 1) {
        private val program: GlProgram

        init {
            program = GlProgram(VS, FS)
            program.setBufferAttribute("aFramePosition", GlUtil.getNormalizedCoordinateBounds(), GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE)
        }

        override fun configure(inputWidth: Int, inputHeight: Int): Size = Size(inputWidth, inputHeight)

        override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
            program.use()
            program.setSamplerTexIdUniform("uTexSampler", inputTexId, 0)
            program.bindAttributesAndUniforms()
            val u = { n: String -> program.getUniformLocation(n) }
            GLES20.glUniform2f(u("uSize"), w.toFloat(), h.toFloat())
            val t = presentationTimeUs / 1e6
            val act = regions.filter { t >= it.at - 1e-4 && t < it.at + it.d }
            for (i in 0 until SLOTS) {
                val r = act.getOrNull(i)
                if (r == null) { GLES20.glUniform4f(u("uMd$i"), 0f, 0f, 0f, 0f); continue }
                val v = OvGeom.at(r.kf, (t - r.at).toFloat(), r.x, r.y, r.w)
                val b = OvGeom.blurBox(v[0], v[1], v[2], r.aspect, r.wmax, r.cell, w, h)
                GLES20.glUniform4f(u("uReg$i"), b[4], b[5], b[6], b[7])
                GLES20.glUniform4f(u("uWin$i"), b[0], b[1], b[2] / b[8], b[3] / b[9])
                GLES20.glUniform4f(u("uMd$i"), 1f, if (r.soft) 1f else 0f, if (r.ellipse) 1f else 0f, 0f)
                GLES20.glUniform2f(u("uGr$i"), b[8], b[9])
            }
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            GlUtil.checkGlError()
        }

        override fun release() { super.release(); program.delete() }

        companion object {
            const val VS = """attribute vec4 aFramePosition;
varying vec2 vTexSamplingCoord;
void main(){ gl_Position = aFramePosition; vTexSamplingCoord = aFramePosition.xy * 0.5 + 0.5; }"""

            // uSize: Bildgröße in Pixeln · je Bereich uReg: Mitte und halbe Ausdehnung, uWin: Ecke des Fensters und Feldgröße (alles in
            // Pixeln, y von oben), uGr: Zahl der Felder, uMd: aktiv, weich, Ellipse
            const val FS = """#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uTexSampler;
uniform vec2 uSize;
uniform vec4 uReg0; uniform vec4 uReg1; uniform vec4 uReg2; uniform vec4 uReg3;
uniform vec4 uWin0; uniform vec4 uWin1; uniform vec4 uWin2; uniform vec4 uWin3;
uniform vec4 uMd0; uniform vec4 uMd1; uniform vec4 uMd2; uniform vec4 uMd3;
uniform vec2 uGr0; uniform vec2 uGr1; uniform vec2 uGr2; uniform vec2 uGr3;
varying vec2 vTexSamplingCoord;
vec3 cellColor(vec2 idx, vec4 win, vec2 gr){
  idx = clamp(idx, vec2(0.0), gr - 1.0);
  vec2 p0 = win.xy + idx * win.zw;
  vec3 s = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    for (int j = 0; j < 4; j++) {
      vec2 p = p0 + (vec2(float(i), float(j)) + 0.5) * win.zw * 0.25;
      s += texture2D(uTexSampler, vec2(p.x / uSize.x, 1.0 - p.y / uSize.y)).rgb;
    }
  }
  return s / 16.0;
}
vec3 region(vec3 col, vec2 px, vec4 reg, vec4 win, vec4 md, vec2 gr){
  if (md.x < 0.5) return col;
  vec2 d = (px - reg.xy) / max(reg.zw, vec2(0.5));
  if (md.z > 0.5) { if (dot(d, d) > 1.0) return col; }
  else if (abs(d.x) > 1.0 || abs(d.y) > 1.0) return col;
  vec2 q = (px - win.xy) / max(win.zw, vec2(1.0));
  if (md.y < 0.5) return cellColor(floor(q), win, gr);
  vec2 f = q - 0.5, i0 = floor(f), t = f - i0;
  vec3 a = mix(cellColor(i0, win, gr), cellColor(i0 + vec2(1.0, 0.0), win, gr), t.x);
  vec3 b = mix(cellColor(i0 + vec2(0.0, 1.0), win, gr), cellColor(i0 + vec2(1.0, 1.0), win, gr), t.x);
  return mix(a, b, t.y);
}
void main(){
  vec4 c = texture2D(uTexSampler, vTexSamplingCoord);
  vec2 px = vec2(vTexSamplingCoord.x * uSize.x, (1.0 - vTexSamplingCoord.y) * uSize.y);
  vec3 col = c.rgb;
  col = region(col, px, uReg0, uWin0, uMd0, uGr0);
  col = region(col, px, uReg1, uWin1, uMd1, uGr1);
  col = region(col, px, uReg2, uWin2, uMd2, uGr2);
  col = region(col, px, uReg3, uWin3, uMd3, uGr3);
  gl_FragColor = vec4(col, c.a);
}"""
            const val SLOTS = 4
        }
    }
}
