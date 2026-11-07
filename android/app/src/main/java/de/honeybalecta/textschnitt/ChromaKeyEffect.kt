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
import org.json.JSONObject

/**
 * Freistellen per Farbschlüssel (Greenscreen) im Android-Export.
 *
 * Dieselbe Rechnung wie in der Vorschau (chroma.js) und beim Windows-Export (ffmpeg „chromakey“ + „despill“):
 * Abstand zur Schlüsselfarbe in der Farbebene U/V (BT.709), Toleranz (similarity) und weicher Rand (blend);
 * danach bei Grün oder Blau den Farbsaum zurücknehmen. Einblendungen werden durchsichtig (Alpha), das Hauptbild
 * wird gleich über die Hintergrundfarbe gelegt (deckend).
 *
 * key = {colors: ["#00ff00", …], tol, soft, spill, bg?}
 */
@UnstableApi
class ChromaKeyEffect(private val key: JSONObject, private val opaque: Boolean) : GlEffect {
    override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram = Program(key, opaque)

    private class Program(key: JSONObject, private val opaque: Boolean) : BaseGlShaderProgram(false, 1) {
        private val program: GlProgram
        private val keys = ArrayList<FloatArray>()
        private val rgbs = ArrayList<FloatArray>()
        private val sim: Float
        private val blend: Float
        private val spill: Float
        private val dom: Int
        private val bg: FloatArray

        init {
            val cols = key.optJSONArray("colors")
            if (cols != null) for (i in 0 until minOf(4, cols.length())) hex(cols.optString(i))?.let { keys.add(uv(it)); rgbs.add(it) }
            if (keys.isEmpty()) { keys.add(uv(floatArrayOf(0f, 1f, 0f))); rgbs.add(floatArrayOf(0f, 1f, 0f)) }
            sim = key.optDouble("tol", 0.22).toFloat().coerceIn(0.01f, 1f)
            blend = key.optDouble("soft", 0.0).toFloat().coerceIn(0f, 1f)
            // Farbsaum: erste bunte Schlüsselfarbe
            val first = rgbs.firstOrNull { isChroma(it) }
            dom = if (first == null) -1 else { val mx = maxOf(first[0], first[1], first[2]); first.indexOfFirst { it == mx } }
            spill = if (key.optBoolean("spill") && (dom == 1 || dom == 2)) 1f else 0f
            bg = hex(key.optString("bg", "#000000")) ?: floatArrayOf(0f, 0f, 0f)
            program = GlProgram(VS, FS)
            program.setBufferAttribute("aFramePosition", GlUtil.getNormalizedCoordinateBounds(), GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE)
        }

        override fun configure(inputWidth: Int, inputHeight: Int): Size = Size(inputWidth, inputHeight)

        override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
            program.use()
            program.setSamplerTexIdUniform("uTexSampler", inputTexId, 0)
            program.bindAttributesAndUniforms()
            val u = { n: String -> program.getUniformLocation(n) }
            for (i in 0 until 4) { val j = minOf(i, keys.size - 1); val k = keys[j]; val c = rgbs[j]
                GLES20.glUniform2f(u("uKey$i"), k[0], k[1]); GLES20.glUniform3f(u("uRgb$i"), c[0], c[1], c[2]); GLES20.glUniform1f(u("uM$i"), if (isChroma(c)) 0f else 1f) }
            GLES20.glUniform1i(u("uN"), keys.size)
            GLES20.glUniform1f(u("uSim"), sim); GLES20.glUniform1f(u("uBlend"), blend)
            GLES20.glUniform1f(u("uSpill"), spill); GLES20.glUniform1i(u("uDom"), dom)
            GLES20.glUniform3f(u("uBg"), bg[0], bg[1], bg[2]); GLES20.glUniform1f(u("uOpaque"), if (opaque) 1f else 0f)
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            GlUtil.checkGlError()
        }

        override fun release() { super.release(); program.delete() }

        companion object {
            fun hex(s: String?): FloatArray? {
                val t = (s ?: "").trim().removePrefix("#")
                if (t.length != 6 || !t.all { it.isDigit() || it.lowercaseChar() in 'a'..'f' }) return null
                val n = t.toInt(16)
                return floatArrayOf(((n shr 16) and 255) / 255f, ((n shr 8) and 255) / 255f, (n and 255) / 255f)
            }
            /** Bunt (Grün, Blau …) → Abstand im Farbton; unbunt (Weiß, Grau, Schwarz) → Abstand im RGB-Raum. */
            fun isChroma(c: FloatArray) = maxOf(c[0], c[1], c[2]) - minOf(c[0], c[1], c[2]) >= 0.25f
            fun uv(c: FloatArray) = floatArrayOf(
                (-0.1146f * c[0] - 0.3854f * c[1] + 0.5f * c[2]) * 0.8784f,
                (0.5f * c[0] - 0.4542f * c[1] - 0.0458f * c[2]) * 0.8784f)

            const val VS = """attribute vec4 aFramePosition;
varying vec2 vTexSamplingCoord;
void main(){ gl_Position = aFramePosition; vTexSamplingCoord = aFramePosition.xy * 0.5 + 0.5; }"""

            const val FS = """precision mediump float;
uniform sampler2D uTexSampler;
uniform vec2 uKey0; uniform vec2 uKey1; uniform vec2 uKey2; uniform vec2 uKey3;
uniform vec3 uRgb0; uniform vec3 uRgb1; uniform vec3 uRgb2; uniform vec3 uRgb3;
uniform float uM0; uniform float uM1; uniform float uM2; uniform float uM3;
uniform int uN; uniform float uSim; uniform float uBlend; uniform float uSpill; uniform int uDom;
uniform vec3 uBg; uniform float uOpaque;
varying vec2 vTexSamplingCoord;
vec2 uv(vec3 c){ return vec2(-0.1146*c.r-0.3854*c.g+0.5*c.b, 0.5*c.r-0.4542*c.g-0.0458*c.b)*0.8784; }
float al(vec3 c, vec2 p, vec2 k, vec3 kr, float m){ float d = m > 0.5 ? distance(c, kr)*0.57735027 : distance(p, k)*0.70710678; return uBlend > 0.0001 ? clamp((d-uSim)/uBlend, 0.0, 1.0) : (d > uSim ? 1.0 : 0.0); }
void main(){
  vec4 c = texture2D(uTexSampler, vTexSamplingCoord);
  vec2 p = uv(c.rgb);
  float a = al(c.rgb, p, uKey0, uRgb0, uM0);
  if (uN > 1) a = min(a, al(c.rgb, p, uKey1, uRgb1, uM1));
  if (uN > 2) a = min(a, al(c.rgb, p, uKey2, uRgb2, uM2));
  if (uN > 3) a = min(a, al(c.rgb, p, uKey3, uRgb3, uM3));
  vec3 rgb = c.rgb;
  if (uSpill > 0.0) {
    if (uDom == 1) rgb.g -= max(rgb.g - (rgb.r + rgb.b) * 0.5, 0.0) * uSpill;
    else if (uDom == 2) rgb.b -= max(rgb.b - (rgb.r + rgb.g) * 0.5, 0.0) * uSpill;
  }
  a *= c.a;
  if (uOpaque > 0.5) gl_FragColor = vec4(mix(uBg, rgb, a), 1.0);
  else gl_FragColor = vec4(rgb, a);
}"""
        }
    }
}
