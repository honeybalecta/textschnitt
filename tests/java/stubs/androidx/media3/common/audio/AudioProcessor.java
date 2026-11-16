package androidx.media3.common.audio;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/** Nachbau für die Prüfläufe: die Teile der Schnittstelle von Media3 1.11, die HoneyCuts Tonklassen benutzen. */
public interface AudioProcessor {
  final class AudioFormat {
    public static final AudioFormat NOT_SET = new AudioFormat(-1, -1, -1);
    public final int sampleRate;
    public final int channelCount;
    public final int encoding;
    public final int bytesPerFrame;

    public AudioFormat(int sampleRate, int channelCount, int encoding) {
      this.sampleRate = sampleRate;
      this.channelCount = channelCount;
      this.encoding = encoding;
      this.bytesPerFrame = encoding == 2 ? 2 * channelCount : encoding == 4 ? 4 * channelCount : -1;
    }
  }

  final class UnhandledAudioFormatException extends Exception {
    public final AudioFormat inputAudioFormat;

    public UnhandledAudioFormatException(AudioFormat inputAudioFormat) {
      this("Unhandled input format:", inputAudioFormat);
    }

    public UnhandledAudioFormatException(String message, AudioFormat audioFormat) {
      super(message + " " + audioFormat);
      this.inputAudioFormat = audioFormat;
    }
  }

  final class StreamMetadata {
    public static final StreamMetadata DEFAULT = new StreamMetadata(0);
    public final long positionOffsetUs;

    public StreamMetadata(long positionOffsetUs) {
      this.positionOffsetUs = positionOffsetUs;
    }
  }

  ByteBuffer EMPTY_BUFFER = ByteBuffer.allocateDirect(0).order(ByteOrder.nativeOrder());

  AudioFormat configure(AudioFormat inputAudioFormat) throws UnhandledAudioFormatException;

  boolean isActive();

  void queueInput(ByteBuffer inputBuffer);

  void queueEndOfStream();

  ByteBuffer getOutput();

  boolean isEnded();

  void flush(StreamMetadata streamMetadata);

  void reset();
}
