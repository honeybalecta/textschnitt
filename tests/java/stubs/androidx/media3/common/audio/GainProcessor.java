package androidx.media3.common.audio;

import androidx.media3.common.C;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/**
 * Nachbau für die Prüfläufe. Die Schnittstelle GainProvider entspricht Media3 1.11; process() rechnet so, wie dort
 * GainProcessor.queueInput() mit 16-Bit-Ton vorgeht: Bereiche mit dem Faktor 1 werden am Stück kopiert, alles andere
 * Abtastwert für Abtastwert multipliziert.
 */
public final class GainProcessor {
  public interface GainProvider {
    float getGainFactorAtSamplePosition(long samplePosition, int sampleRate);
    long isUnityUntil(long samplePosition, int sampleRate);
  }

  private final GainProvider gainProvider;
  private long readFrames;

  public GainProcessor(GainProvider gainProvider) { this.gainProvider = gainProvider; }

  public boolean isActive(int sampleRate) { return gainProvider.isUnityUntil(0, sampleRate) != C.TIME_END_OF_SOURCE; }

  public ByteBuffer process(ByteBuffer inputBuffer, int sampleRate, int channelCount) {
    int bytesPerFrame = 2 * channelCount;
    ByteBuffer buffer = ByteBuffer.allocateDirect(inputBuffer.remaining()).order(ByteOrder.nativeOrder());
    while (inputBuffer.hasRemaining()) {
      float gain = gainProvider.getGainFactorAtSamplePosition(readFrames, sampleRate);
      if (gain == 1f) {
        int oldLimit = inputBuffer.limit();
        long regionEnd = gainProvider.isUnityUntil(readFrames, sampleRate);
        if (regionEnd == C.TIME_UNSET) throw new IllegalStateException("Expected a valid end boundary for unity region.");
        if (regionEnd != C.TIME_END_OF_SOURCE) {
          long limitOffsetBytes = (regionEnd - readFrames) * bytesPerFrame;
          inputBuffer.limit((int) Math.min(oldLimit, limitOffsetBytes + inputBuffer.position()));
        }
        readFrames += inputBuffer.remaining() / bytesPerFrame;
        buffer.put(inputBuffer);
        inputBuffer.limit(oldLimit);
      } else {
        for (int i = 0; i < channelCount; i++) buffer.putShort((short) (inputBuffer.getShort() * gain));
        readFrames++;
      }
    }
    buffer.flip();
    return buffer;
  }
}
