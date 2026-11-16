package de.honeybalecta.textschnitt

import android.content.Context
import android.graphics.Bitmap
import android.opengl.GLES20
import androidx.media3.common.util.GlProgram
import androidx.media3.common.util.GlUtil
import androidx.media3.common.util.Size
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.BaseGlShaderProgram
import androidx.media3.effect.GlEffect
import androidx.media3.effect.GlShaderProgram

/**
 * Legt ein Bild hinter das freigestellte Hauptbild (Hintergrund-Vorlagen: Verlauf, eigenes Bild, weichgezeichnetes Standbild).
 *
 * Steht am Ende der Effekte eines Abschnitts: Das Hauptbild kommt durchsichtig an (Freistellen ohne Hintergrundfarbe, danach
 * Lage, Größe und Farbe), der Hintergrund füllt die ganze Fläche – auch dort, wo ein verkleinertes Hauptbild Rand lässt.
 * Das Bild wird füllend eingepasst (Mitte bleibt, Überstand fällt weg), wie in der Vorschau und im Windows-Export.
 */
@UnstableApi
class BackdropEffect(private val bitmap: Bitmap) : GlEffect {
    override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram = Program(bitmap)

    private class Program(private val bitmap: Bitmap) : BaseGlShaderProgram(false, 1) {
        private val program: GlProgram = GlProgram(VS, FS)
        private var bgTex = -1
        private var sx = 1f
        private var sy = 1f

        init {
            program.setBufferAttribute("aFramePosition", GlUtil.getNormalizedCoordinateBounds(), GlUtil.HOMOGENEOUS_COORDINATE_VECTOR_SIZE)
        }

        override fun configure(inputWidth: Int, inputHeight: Int): Size {
            // füllend: Der Ausschnitt des Bilds hat das Seitenverhältnis der Fläche
            val fa = inputWidth.toFloat() / inputHeight.toFloat()
            val ba = bitmap.width.toFloat() / bitmap.height.toFloat()
            if (ba > fa) { sx = fa / ba; sy = 1f } else { sx = 1f; sy = ba / fa }
            return Size(inputWidth, inputHeight)
        }

        override fun drawFrame(inputTexId: Int, presentationTimeUs: Long) {
            if (bgTex == -1) bgTex = GlUtil.createTexture(bitmap)
            program.use()
            program.setSamplerTexIdUniform("uTexSampler", inputTexId, 0)
            program.setSamplerTexIdUniform("uBgSampler", bgTex, 1)
            program.bindAttributesAndUniforms()
            GLES20.glUniform2f(program.getUniformLocation("uBgScale"), sx, sy)
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            GlUtil.checkGlError()
        }

        override fun release() {
            super.release()
            program.delete()
            if (bgTex != -1) { runCatching { GlUtil.deleteTexture(bgTex) }; bgTex = -1 }
        }

        companion object {
            const val VS = """attribute vec4 aFramePosition;
varying vec2 vTexSamplingCoord;
void main(){ gl_Position = aFramePosition; vTexSamplingCoord = aFramePosition.xy * 0.5 + 0.5; }"""

            // Die Zeilen eines Bitmaps stehen in der Textur von oben nach unten – deshalb 1 − y beim Hintergrund.
            const val FS = """precision mediump float;
uniform sampler2D uTexSampler;
uniform sampler2D uBgSampler;
uniform vec2 uBgScale;
varying vec2 vTexSamplingCoord;
void main(){
  vec4 c = texture2D(uTexSampler, vTexSamplingCoord);
  vec2 b = (vTexSamplingCoord - 0.5) * uBgScale + 0.5;
  vec3 bg = texture2D(uBgSampler, vec2(b.x, 1.0 - b.y)).rgb;
  gl_FragColor = vec4(mix(bg, c.rgb, c.a), 1.0);
}"""
        }
    }
}
