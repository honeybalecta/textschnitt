package de.honeybalecta.textschnitt;

import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.audio.BaseAudioProcessor;
import androidx.media3.common.util.UnstableApi;
import java.nio.ByteBuffer;
import java.util.HashMap;
import java.util.Map;

/**
 * „Stimme aufbereiten“ für den Ton eines Clips der Hauptspur: reicht 16-Bit-Ton durch {@link VoiceDsp}. Heraus kommen genau so
 * viele Abtastwerte wie hinein, ohne Versatz – der Rest wird nach dem Ende des Datenstroms nachgeliefert.
 *
 * <p>Die Rauschschätzung wandert über {@link Shared} von Clip zu Clip derselben Aufnahme. Beim ersten Clip einer Aufnahme
 * hält der Prozessor bis zu zwei Sekunden zurück, lernt daraus und gibt sie dann aufbereitet aus.
 */
@OptIn(markerClass = UnstableApi.class)
public final class VoiceProcessor extends BaseAudioProcessor {
  /** Rauschschätzung je Aufnahme für einen Export. */
  public static final class Shared {
    final Map<String, double[]> noise = new HashMap<>();
  }

  private final Shared shared;
  private final String key;
  private final double[] lt, lg;
  private final double scale;
  private VoiceDsp dsp;
  private int ch;
  private boolean primed, tail;
  private short[] hold = new short[0];
  private int held;        // zurückgehaltene Abtastwerte (alle Kanäle zusammen)
  private int primeLen;    // so viele Abtastwerte (alle Kanäle) dienen dem Lernen
  private double[][] x = new double[0][];
  private float[][] y = new float[0][];

  /**
   * @param shared Rauschschätzungen dieses Exports
   * @param key Schlüssel der Aufnahme
   * @param lt Zeiten des Pegelverlaufs in Sekunden ab Clipbeginn in der Quelle (oder null)
   * @param lg Faktoren dazu
   * @param scale Tempo des Clips: Der Prozessor sieht den Ton schon im Ausgabetempo, der Pegelverlauf zählt in Quellzeit
   */
  public VoiceProcessor(Shared shared, String key, double[] lt, double[] lg, double scale) {
    this.shared = shared;
    this.key = key;
    this.lt = lt;
    this.lg = lg;
    this.scale = scale;
  }

  @Override
  protected AudioFormat onConfigure(AudioFormat inputAudioFormat) {
    // Anderes als 16-Bit-Ton läuft unbearbeitet durch (der Prozessor bleibt dann inaktiv)
    return inputAudioFormat.encoding == C.ENCODING_PCM_16BIT && inputAudioFormat.sampleRate > 0 && inputAudioFormat.channelCount > 0
        ? inputAudioFormat : AudioFormat.NOT_SET;
  }

  @Override
  protected void onFlush(StreamMetadata streamMetadata) {
    tail = false;
    held = 0;
    if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT || inputAudioFormat.sampleRate <= 0 || inputAudioFormat.channelCount <= 0) {
      dsp = null;
      return;
    }
    ch = inputAudioFormat.channelCount;
    dsp = new VoiceDsp(inputAudioFormat.sampleRate, ch, shared.noise.get(key));
    dsp.setLevel(lt, lg, scale);
    primed = shared.noise.get(key) != null;
    primeLen = (int) Math.floor(VoiceDsp.PRIME * inputAudioFormat.sampleRate) * ch;
  }

  @Override
  protected void onReset() {
    dsp = null;
    tail = false;
    held = 0;
    hold = new short[0];
  }

  @Override
  public void queueInput(ByteBuffer inputBuffer) {
    if (!inputBuffer.hasRemaining()) return;
    if (dsp == null) {   // sollte nicht vorkommen (der Prozessor ist dann inaktiv): unbearbeitet durchreichen
      replaceOutputBuffer(inputBuffer.remaining()).put(inputBuffer).flip();
      return;
    }
    int frames = inputBuffer.remaining() / (2 * ch);
    if (!primed) {   // zurückhalten, bis genug zum Lernen da ist
      int n = frames * ch;
      if (hold.length < held + n) hold = java.util.Arrays.copyOf(hold, Math.max(held + n, Math.max(primeLen, hold.length * 2)));
      for (int i = 0; i < n; i++) hold[held + i] = inputBuffer.getShort();
      held += n;
      if (held >= primeLen) write(release(), 0);
      return;
    }
    need(frames);
    for (int i = 0; i < frames; i++) for (int c = 0; c < ch; c++) x[c][i] = inputBuffer.getShort() / 32768.0;
    write(dsp.feed(x, 0, frames, y, 0), 0);
  }

  /** Aus dem Zurückgehaltenen lernen und es aufbereiten; Rückgabe: Zahl der fertigen Abtastwerte je Kanal in y. */
  private int release() {
    int frames = held / ch;
    need(frames);
    for (int i = 0; i < frames; i++) for (int c = 0; c < ch; c++) x[c][i] = hold[i * ch + c] / 32768.0;
    dsp.prime(x, Math.min(frames, primeLen / ch));
    primed = true;
    held = 0;
    hold = new short[0];
    return dsp.feed(x, 0, frames, y, 0);
  }

  private void need(int frames) {
    if (x.length != ch || x[0].length < frames) x = new double[ch][frames];
    if (y.length != ch || y[0].length < frames + 2 * dsp.N) y = new float[ch][frames + 2 * dsp.N];
  }

  /** Die ersten n Abtastwerte je Kanal aus y (ab Stelle off) als 16-Bit-Ton ausgeben. */
  private void write(int n, int off) {
    if (n <= 0) return;
    ByteBuffer out = replaceOutputBuffer(n * ch * 2);
    for (int i = 0; i < n; i++)
      for (int c = 0; c < ch; c++) {
        int v = Math.round(y[c][off + i] * 32768f);
        out.putShort((short) (v > 32767 ? 32767 : v < -32768 ? -32768 : v));
      }
    out.flip();
  }

  @Override
  protected void onQueueEndOfStream() {
    tail = dsp != null;
  }

  @Override
  public ByteBuffer getOutput() {
    // Der Rest entsteht erst, wenn die vorige Ausgabe abgeholt ist (wie bei den Prozessoren von Media3 mit Nachlauf)
    if (tail && super.isEnded()) {
      tail = false;
      int n = 0;
      if (!primed && held > 0) n = release();
      need(Math.max(1, n));
      if (y[0].length < n + dsp.pending() + 1) {
        float[][] z = new float[ch][n + dsp.pending() + 1];
        for (int c = 0; c < ch; c++) System.arraycopy(y[c], 0, z[c], 0, n);
        y = z;
      }
      n += dsp.finish(y, n);
      double[] nz = dsp.noise();
      if (nz != null) shared.noise.put(key, nz);
      write(n, 0);
    }
    return super.getOutput();
  }

  @Override
  public boolean isEnded() {
    return super.isEnded() && !tail;
  }
}
