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

/**
 * Macht ein Bild bis an den Rand deckend: Durchsichtige Flächen (die Ränder eines eingepassten oder verkleinerten Clips)
 * werden schwarz. Gebraucht für die Bild-Ebene eines Übergangs – sie ersetzt das Bild der Hauptspur ganz, so wie es der
 * andere Clip an dieser Stelle täte.
 */
@UnstableApi
class OpaqueEffect : GlEffect {
    override fun toGlShaderProgram(context: Context, useHdr: Boolean): GlShaderProgram = Program()

    private class Program : BaseGlShaderProgram(false, 1) {
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
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4)
            GlUtil.checkGlError()
        }

        override fun release() { super.release(); program.delete() }

        companion object {
            const val VS = """attribute vec4 aFramePosition;
varying vec2 vTexSamplingCoord;
void main(){ gl_Position = aFramePosition; vTexSamplingCoord = aFramePosition.xy * 0.5 + 0.5; }"""

            const val FS = """precision mediump float;
uniform sampler2D uTexSampler;
varying vec2 vTexSamplingCoord;
void main(){
  vec4 c = texture2D(uTexSampler, vTexSamplingCoord);
  gl_FragColor = vec4(c.rgb * c.a, 1.0);
}"""
        }
    }
}
