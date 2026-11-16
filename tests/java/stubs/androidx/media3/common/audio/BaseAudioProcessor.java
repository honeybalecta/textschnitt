package androidx.media3.common.audio;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;

/** Nachbau für die Prüfläufe: verhält sich wie BaseAudioProcessor aus Media3 1.11 (dieselben Zustände und Übergänge). */
public abstract class BaseAudioProcessor implements AudioProcessor {
  protected AudioFormat inputAudioFormat;
  protected AudioFormat outputAudioFormat;
  private AudioFormat pendingInputAudioFormat;
  private AudioFormat pendingOutputAudioFormat;
  private ByteBuffer buffer;
  private ByteBuffer outputBuffer;
  private boolean inputEnded;

  public BaseAudioProcessor() {
    buffer = EMPTY_BUFFER;
    outputBuffer = EMPTY_BUFFER;
    pendingInputAudioFormat = AudioFormat.NOT_SET;
    pendingOutputAudioFormat = AudioFormat.NOT_SET;
    inputAudioFormat = AudioFormat.NOT_SET;
    outputAudioFormat = AudioFormat.NOT_SET;
  }

  @Override
  public final AudioFormat configure(AudioFormat inputAudioFormat) throws UnhandledAudioFormatException {
    pendingInputAudioFormat = inputAudioFormat;
    pendingOutputAudioFormat = onConfigure(inputAudioFormat);
    return isActive() ? pendingOutputAudioFormat : AudioFormat.NOT_SET;
  }

  @Override
  public boolean isActive() {
    return pendingOutputAudioFormat != AudioFormat.NOT_SET;
  }

  @Override
  public final void queueEndOfStream() {
    inputEnded = true;
    onQueueEndOfStream();
  }

  @Override
  public ByteBuffer getOutput() {
    ByteBuffer outputBuffer = this.outputBuffer;
    this.outputBuffer = EMPTY_BUFFER;
    return outputBuffer;
  }

  @Override
  public boolean isEnded() {
    return inputEnded && outputBuffer == EMPTY_BUFFER;
  }

  @Override
  public final void flush(StreamMetadata streamMetadata) {
    outputBuffer = EMPTY_BUFFER;
    inputEnded = false;
    inputAudioFormat = pendingInputAudioFormat;
    outputAudioFormat = pendingOutputAudioFormat;
    onFlush(streamMetadata);
  }

  @Override
  public final void reset() {
    outputBuffer = EMPTY_BUFFER;
    inputEnded = false;
    buffer = EMPTY_BUFFER;
    pendingInputAudioFormat = AudioFormat.NOT_SET;
    pendingOutputAudioFormat = AudioFormat.NOT_SET;
    inputAudioFormat = AudioFormat.NOT_SET;
    outputAudioFormat = AudioFormat.NOT_SET;
    onReset();
  }

  protected final ByteBuffer replaceOutputBuffer(int size) {
    if (buffer.capacity() < size) {
      buffer = ByteBuffer.allocateDirect(size).order(ByteOrder.nativeOrder());
    } else {
      buffer.clear();
    }
    outputBuffer = buffer;
    return buffer;
  }

  protected final boolean hasPendingOutput() {
    return outputBuffer.hasRemaining();
  }

  protected AudioFormat onConfigure(AudioFormat inputAudioFormat) throws UnhandledAudioFormatException {
    return AudioFormat.NOT_SET;
  }

  protected void onQueueEndOfStream() {}

  protected void onFlush(StreamMetadata streamMetadata) {}

  protected void onReset() {}
}
