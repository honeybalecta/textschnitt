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
        private val sim: Float
        private val blend: Float
        private val spill: Float
        private val dom: Int
        private val bg: FloatArray

        init {
            val cols = key.optJSONArray("colors")
            if (cols != null) for (i in 0 until minOf(4, cols.length())) hex(cols.optString(i))?.let { keys.add(uv(it)) }
            if (keys.isEmpty()) keys.add(uv(floatArrayOf(0f, 1f, 0f)))
            sim = key.optDouble("tol", 0.22).toFloat().coerceIn(0.01f, 1f)
            blend = key.optDouble("soft", 0.0).toFloat().coerceIn(0f, 1f)
            val first = (cols?.optString(0)?.let { hex(it) }) ?: floatArrayOf(0f, 1f, 0f)
            val mx = maxOf(first[0], first[1], first[2]); val mn = minOf(first[0], first[1], first[2])
            dom = if (mx - mn < 0.15f) -1 else first.indexOfFirst { it == mx }
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
            val u = { n: String -> GLES20.glGetUniformLocation(program.programId(), n) }
            for (i in 0 until 4) { val k = keys[minOf(i, keys.size - 1)]; GLES20.glUniform2f(u("uKey$i"), k[0], k[1]) }
            GLES20.glUniform1i(u("uN"), keys.size)
            GLES20.glUniform1f(u("uSim"), sim); GLES20.glUniform1f(u("uBlend"), blend)
            GLES20.glUniform1f(u("uSpill"), spill); GLES20.glUniform1i(u("uDom"), dom)
            GLES20.glUniform3f(u("uBg"), bg[0], bg[1], bg[2]); GLES20.glUniform1f(u("uOpaque"), if (opaque) 1f else 0f)
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            GlUtil.checkGlError()
        }

        override fun release() { super.release(); program.delete() }

        private fun GlProgram.programId(): Int {
            // GlProgram hält die Kennung privat; über glGetIntegerv nach use() ist sie das aktive Programm
            val a = IntArray(1); GLES20.glGetIntegerv(GLES20.GL_CURRENT_PROGRAM, a, 0); return a[0]
        }

        companion object {
            fun hex(s: String?): FloatArray? {
                val t = (s ?: "").trim().removePrefix("#")
                if (t.length != 6 || !t.all { it.isDigit() || it.lowercaseChar() in 'a'..'f' }) return null
                val n = t.toInt(16)
                return floatArrayOf(((n shr 16) and 255) / 255f, ((n shr 8) and 255) / 255f, (n and 255) / 255f)
            }
            fun uv(c: FloatArray) = floatArrayOf(
                (-0.1146f * c[0] - 0.3854f * c[1] + 0.5f * c[2]) * 0.8784f,
                (0.5f * c[0] - 0.4542f * c[1] - 0.0458f * c[2]) * 0.8784f)

            const val VS = """attribute vec4 aFramePosition;
varying vec2 vTexSamplingCoord;
void main(){ gl_Position = aFramePosition; vTexSamplingCoord = aFramePosition.xy * 0.5 + 0.5; }"""

            const val FS = """precision mediump float;
uniform sampler2D uTexSampler;
uniform vec2 uKey0; uniform vec2 uKey1; uniform vec2 uKey2; uniform vec2 uKey3;
uniform int uN; uniform float uSim; uniform float uBlend; uniform float uSpill; uniform int uDom;
uniform vec3 uBg; uniform float uOpaque;
varying vec2 vTexSamplingCoord;
vec2 uv(vec3 c){ return vec2(-0.1146*c.r-0.3854*c.g+0.5*c.b, 0.5*c.r-0.4542*c.g-0.0458*c.b)*0.8784; }
float al(vec2 p, vec2 k){ float d = distance(p, k)*0.70710678; return uBlend > 0.0001 ? clamp((d-uSim)/uBlend, 0.0, 1.0) : (d > uSim ? 1.0 : 0.0); }
void main(){
  vec4 c = texture2D(uTexSampler, vTexSamplingCoord);
  vec2 p = uv(c.rgb);
  float a = al(p, uKey0);
  if (uN > 1) a = min(a, al(p, uKey1));
  if (uN > 2) a = min(a, al(p, uKey2));
  if (uN > 3) a = min(a, al(p, uKey3));
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
