import androidx.media3.common.C;
import androidx.media3.common.audio.GainProcessor;
import de.honeybalecta.textschnitt.GainCurve;
import de.honeybalecta.textschnitt.VoiceDsp;
import de.honeybalecta.textschnitt.VoiceProcessor;
import androidx.media3.common.audio.AudioProcessor;
import java.io.File;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.List;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.util.Random;

/** Prüft die Tonklassen der Android-App außerhalb von Android (mit Nachbauten der Media3-Schnittstellen). */
public final class TonTest {
  static int n = 0, bad = 0;
  static void chk(String name, boolean ok, String extra) { n++; if (!ok) bad++; System.out.println((ok ? "ok     " : "FEHLER ") + name + (extra == null || extra.isEmpty() ? "" : " · " + extra)); }
  static void chk(String name, boolean ok) { chk(name, ok, ""); }

  // Bezugsrechnung: Verlauf ohne Gedächtnis
  static float ref(double[] t, float[] g, double c) {
    int m = t.length; if (m == 0) return 1f; if (c <= t[0]) return g[0]; if (c >= t[m - 1]) return g[m - 1];
    for (int i = 0; i < m - 1; i++) if (c < t[i + 1]) { double w = t[i + 1] - t[i]; return w > 1e-9 ? (float) (g[i] + (g[i + 1] - g[i]) * (c - t[i]) / w) : g[i + 1]; }
    return g[m - 1];
  }

  static void gainCurve() {
    double[] t = {4.75, 5, 9, 9.8, 30, 30.25, 41, 41.8};
    float[] g = {1f, 0.2f, 0.2f, 1f, 1f, 0.2f, 0.2f, 1f};
    GainCurve c = new GainCurve(t, g, 0, 0, 0);
    float[] want = {1f, 0.6f, 0.2f, 0.2f, 0.6f, 1f, 1f, 0.2f, 1f};
    double[] at = {0, 4.875, 5, 7, 9.4, 12, 29.99, 35, 60};
    boolean ok = true; StringBuilder sb = new StringBuilder();
    for (int i = 0; i < at.length; i++) { float v = c.at(at[i]); if (Math.abs(v - want[i]) > 1e-6) { ok = false; sb.append(at[i]).append("→").append(v).append(' '); } }
    chk("Verlauf: Werte an Stützstellen, dazwischen und außerhalb", ok, sb.toString());

    // rückwärts und kreuz und quer abgefragt: dasselbe Ergebnis wie ohne Gedächtnis
    Random r = new Random(7); ok = true;
    for (int i = 0; i < 20000 && ok; i++) { double x = r.nextDouble() * 50 - 2; if (c.at(x) != ref(t, g, x)) ok = false; }
    chk("Verlauf: Abfragen in beliebiger Reihenfolge stimmen mit der Bezugsrechnung überein", ok);

    // Versatz: der Clip beginnt bei 8 s des Verlaufs
    GainCurve c8 = new GainCurve(t, g, 8, 0, 0);
    chk("Verlauf mit Versatz: Zeit 0 des Clips ist Zeit 8 des Verlaufs", c8.at(0) == 0.2f && Math.abs(c8.at(1.4) - 0.6f) < 1e-6 && c8.at(3) == 1f);

    // Bereiche mit dem Faktor 1: jede gemeldete Grenze stimmt, und sie reicht weit (nicht nur eine Abtastung)
    int rate = 48000; ok = true; long longest = 0; String why = "";
    for (int i = 0; i < 4000 && ok; i++) {
      long pos = (long) (r.nextDouble() * 45 * rate);
      long end = c.isUnityUntil(pos, rate); float v = c.getGainFactorAtSamplePosition(pos, rate);
      if (v != 1f) { if (end != C.TIME_UNSET) { ok = false; why = "Grenze trotz Faktor " + v + " bei " + pos; } continue; }
      if (end == C.TIME_UNSET) { ok = false; why = "keine Grenze bei Faktor 1, Stelle " + pos; continue; }
      if (end == C.TIME_END_OF_SOURCE) { for (long p = pos; p < pos + 500000; p += 997) if (c.getGainFactorAtSamplePosition(p, rate) != 1f) { ok = false; why = "bis zum Ende gemeldet, aber " + p + " weicht ab"; } continue; }
      if (end <= pos) { ok = false; why = "Grenze nicht hinter der Stelle: " + pos + " → " + end; continue; }
      longest = Math.max(longest, end - pos);
      for (long p = pos; p < end; p += Math.max(1, (end - pos) / 300)) if (c.getGainFactorAtSamplePosition(p, rate) != 1f) { ok = false; why = "im Bereich " + pos + "…" + end + " weicht " + p + " ab"; }
      if (c.getGainFactorAtSamplePosition(end - 1, rate) != 1f) { ok = false; why = "letzte Stelle des Bereichs weicht ab: " + (end - 1); }
    }
    chk("Bereiche mit dem Faktor 1 sind richtig begrenzt", ok, why);
    chk("solche Bereiche werden am Stück gemeldet (über 10 s lang)", longest > 10L * rate, "längster " + longest);
    chk("vor dem ersten Abfall endet der Bereich bei 4,75 s", c.isUnityUntil(0, rate) > 4.7 * rate && c.isUnityUntil(0, rate) <= (long) (4.75 * rate));
    chk("nach dem letzten Anstieg reicht er bis zum Ende", c.isUnityUntil((long) (42 * rate), rate) == C.TIME_END_OF_SOURCE);

    // Blenden an den Schnittkanten (ohne Verlauf)
    GainCurve f = new GainCurve(new double[0], new float[0], 0, 0.008, 2.0);
    chk("Blende: beginnt bei 0, ist nach 8 ms bei 1", f.at(0) == 0f && Math.abs(f.at(0.004) - 0.5f) < 1e-6 && f.at(0.008) == 1f && f.at(1) == 1f);
    chk("Blende: endet bei 0", Math.abs(f.at(1.996) - 0.5f) < 1e-5 && f.at(2.0) == 0f && f.at(2.1) == 0f);
    long e = f.isUnityUntil(384, rate);
    chk("Blende: der Bereich dazwischen wird am Stück gemeldet", f.isUnityUntil(0, rate) == C.TIME_UNSET && e > 1.9 * rate && e <= (long) (1.992 * rate) && f.getGainFactorAtSamplePosition(e - 1, rate) == 1f, "bis " + e);
    GainCurve none = new GainCurve(new double[0], new float[0], 0, 0, 0);
    chk("ohne Verlauf und ohne Blende bleibt der Ton unberührt (Prozessor inaktiv)", none.isUnityUntil(0, rate) == C.TIME_END_OF_SOURCE && !new GainProcessor(none).isActive(rate));
    GainCurve open = new GainCurve(new double[0], new float[0], 0, 0.008, 0);
    chk("unbekannte Länge: nur die Blende am Anfang", open.at(0) == 0f && open.at(100) == 1f && open.isUnityUntil(400, rate) == C.TIME_END_OF_SOURCE);

    // Durch den Prozessor geschickt (in Blöcken unterschiedlicher Größe) = Abtastwert mal Faktor
    GainCurve both = new GainCurve(t, g, 3.5, 0.008, 4.0);
    GainProcessor p = new GainProcessor(both);
    int frames = 4 * rate, ch = 2; short[] in = new short[frames * ch]; for (int i = 0; i < in.length; i++) in[i] = (short) (r.nextInt(60000) - 30000);
    short[] out = new short[in.length]; int done = 0; ok = true;
    while (done < frames) {
      int blk = Math.min(frames - done, 1 + r.nextInt(5000));
      ByteBuffer b = ByteBuffer.allocateDirect(blk * ch * 2).order(ByteOrder.nativeOrder());
      for (int i = 0; i < blk * ch; i++) b.putShort(in[done * ch + i]); b.flip();
      ByteBuffer o = p.process(b, rate, ch);
      if (o.remaining() != blk * ch * 2) { ok = false; break; }
      for (int i = 0; i < blk * ch; i++) out[done * ch + i] = o.getShort();
      done += blk;
    }
    int diff = 0; for (int i = 0; i < frames && ok; i++) { float v = both.at(i / (double) rate); for (int q = 0; q < ch; q++) if (out[i * ch + q] != (short) (in[i * ch + q] * v)) diff++; }
    chk("Prozessor: Ausgabe = Eingabe mal Verlauf mal Blende, unabhängig von der Blockgröße", ok && diff == 0, diff + " Abweichungen");
    float lo = 1f; for (int i = 0; i < frames; i++) lo = Math.min(lo, both.at(i / (double) rate));
    chk("Prozessor: Der Verlauf wirkt (Absenkung auf 0,2 in der Mitte des Clips)", Math.abs(both.at(2.0) - 0.2f) < 1e-6 && lo == 0f);
  }

  static float[] readF32(String f) throws Exception {
    byte[] b = Files.readAllBytes(Paths.get(f));
    float[] v = new float[b.length / 4];
    ByteBuffer.wrap(b).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer().get(v);
    return v;
  }
  static void writeF32(String f, float[] v, int n) throws Exception {
    ByteBuffer b = ByteBuffer.allocate(n * 4).order(ByteOrder.LITTLE_ENDIAN);
    for (int i = 0; i < n; i++) b.putFloat(v[i]);
    Files.write(Paths.get(f), b.array());
  }

  /**
   * Rechnet die Prüffälle zur Stimm-Aufbereitung (cases.txt und <name>.in.f32 im Ordner dir) mit VoiceDsp, schreibt
   * <name>.java.f32 und vergleicht mit den Ergebnissen der anderen Fassungen (<name>.js.f32, <name>.py.f32), soweit vorhanden.
   */
  static void voiceCases(String dir) throws Exception {
    List<String> lines = Files.readAllLines(Paths.get(dir, "cases.txt"));
    int li = 0;
    Random r = new Random(3);
    while (li < lines.size()) {
      String[] h = lines.get(li++).trim().split(" ");
      if (h.length < 6) continue;
      String name = h[0]; int sr = Integer.parseInt(h[1]), ch = Integer.parseInt(h[2]), n = Integer.parseInt(h[3]), ns = Integer.parseInt(h[5]);
      double prime = Double.parseDouble(h[4]);
      float[] in = readF32(dir + "/" + name + ".in.f32");
      float[] out = new float[in.length]; int w = 0;
      VoiceDsp dsp = new VoiceDsp(sr, ch, null);
      for (int s = 0; s < ns; s++) {
        String[] q = lines.get(li++).trim().split(" ");
        int i0 = (int) Math.round(Double.parseDouble(q[0]) * sr), i1 = (int) Math.round(Double.parseDouble(q[1]) * sr), len = i1 - i0, np = Integer.parseInt(q[2]);
        double[] lt = new double[np], lg = new double[np];
        for (int k = 0; k < np; k++) { lt[k] = Double.parseDouble(q[3 + 2 * k]); lg[k] = Double.parseDouble(q[4 + 2 * k]); }
        double[][] x = new double[ch][len];
        for (int i = 0; i < len; i++) for (int c = 0; c < ch; c++) x[c][i] = in[(i0 + i) * ch + c];
        if (s == 0) dsp.prime(x, Math.min((int) Math.floor(prime * sr), len));
        dsp.reset(); dsp.setLevel(np > 0 ? lt : null, np > 0 ? lg : null, 1);
        float[][] o = new float[ch][len + dsp.H];
        int p = 0, got = 0;
        while (p < len) { int mLen = Math.min(len - p, 1 + r.nextInt(3000)); got += dsp.feed(x, p, mLen, o, got); p += mLen; }
        got += dsp.finish(o, got);
        if (got != len) { chk("Stimme " + name + ": Abschnitt " + s + " behält seine Länge", false, got + " Abtastwerte, erwartet " + len); return; }
        for (int i = 0; i < len; i++) for (int c = 0; c < ch; c++) out[(w + i) * ch + c] = o[c][i];
        w += len;
      }
      writeF32(dir + "/" + name + ".java.f32", out, w * ch);
      for (String other : new String[] {"js", "py"}) {
        File f = new File(dir + "/" + name + "." + other + ".f32");
        if (!f.exists()) continue;
        float[] ref = readF32(f.getPath());
        double mx = ref.length == w * ch ? 0 : -1;
        for (int i = 0; mx >= 0 && i < ref.length; i++) mx = Math.max(mx, Math.abs(ref[i] - out[i]));
        chk("Stimme " + name + ": Java-Fassung rechnet wie " + (other.equals("js") ? "die JS-Fassung" : "die Python-Fassung"), mx >= 0 && mx < 2e-5, String.format(java.util.Locale.ROOT, "größte Abweichung %.2e bei %d Werten", mx, w * ch));
      }
    }
  }

  static short toShort(float v) { int q = Math.round(v * 32768f); return (short) (q > 32767 ? 32767 : q < -32768 ? -32768 : q); }

  /** Schickt 16-Bit-Ton so durch einen Prozessor, wie es die Kette von Media3 tut: Eingabe erst, wenn die vorige Ausgabe abgeholt ist. */
  static short[] drive(AudioProcessor p, short[] in, int ch, Random r) {
    java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
    int frames = in.length / ch, done = 0;
    java.util.function.Consumer<ByteBuffer> take = o -> { while (o.hasRemaining()) { short s = o.getShort(); bo.write(s & 255); bo.write((s >> 8) & 255); } };
    while (done < frames) {
      int blk = Math.min(frames - done, 1 + r.nextInt(6000));
      ByteBuffer b = ByteBuffer.allocateDirect(blk * ch * 2).order(ByteOrder.nativeOrder());
      for (int i = 0; i < blk * ch; i++) b.putShort(in[done * ch + i]);
      b.flip();
      p.queueInput(b);
      if (b.hasRemaining()) throw new IllegalStateException("Eingabe nicht vollständig angenommen");
      take.accept(p.getOutput());
      done += blk;
    }
    p.queueEndOfStream();
    for (int guard = 0; !p.isEnded() && guard < 100; guard++) { p.queueInput(AudioProcessor.EMPTY_BUFFER); take.accept(p.getOutput()); }
    byte[] raw = bo.toByteArray(); short[] out = new short[raw.length / 2];
    for (int i = 0; i < out.length; i++) out[i] = (short) ((raw[2 * i] & 255) | (raw[2 * i + 1] << 8));
    return out;
  }

  /** Bezugsrechnung für einen Clip: Rechenkern direkt, mit denselben Schritten wie der Prozessor. */
  static short[] direct(short[] in, int sr, int ch, double[][] noiseBox, double[] lt, double[] lg, double scale) {
    int frames = in.length / ch;
    double[][] x = new double[ch][frames];
    for (int i = 0; i < frames; i++) for (int c = 0; c < ch; c++) x[c][i] = in[i * ch + c] / 32768.0;
    VoiceDsp d = new VoiceDsp(sr, ch, noiseBox[0]);
    d.setLevel(lt, lg, scale);
    if (noiseBox[0] == null) d.prime(x, Math.min(frames, (int) Math.floor(VoiceDsp.PRIME * sr)));
    float[][] y = new float[ch][frames + 2 * d.N];
    int n = d.feed(x, 0, frames, y, 0); n += d.finish(y, n);
    noiseBox[0] = d.noise();
    short[] out = new short[n * ch];
    for (int i = 0; i < n; i++) for (int c = 0; c < ch; c++) out[i * ch + c] = toShort(y[c][i]);
    return out;
  }

  static void voiceProcessor() throws Exception {
    Random r = new Random(11);
    for (int[] cfg : new int[][] {{48000, 2, 0}, {44100, 1, 0}, {48000, 1, 1}}) {
      int sr = cfg[0], ch = cfg[1];
      // drei Clips derselben Aufnahme: lang (lernt), sehr kurz, mittel mit Pegelverlauf und Tempo 1,25 –
      // in der dritten Runde ist schon der erste Clip kürzer als die Lernzeit (der Datenstrom endet, bevor genug beisammen ist)
      int[] lens = cfg[2] == 0 ? new int[] {(int) (3.3 * sr), (int) (0.05 * sr), (int) (1.7 * sr)} : new int[] {(int) (0.8 * sr), (int) (0.05 * sr), (int) (1.7 * sr)};
      VoiceProcessor.Shared shared = new VoiceProcessor.Shared();
      double[][] box = {null};
      boolean same = true, len = true, first = true; String why = "";
      for (int k = 0; k < lens.length; k++) {
        short[] in = new short[lens[k] * ch];
        for (int i = 0; i < lens[k]; i++) {
          double t = i / (double) sr, v = 0.02 * r.nextGaussian() + (Math.sin(2 * Math.PI * 1.7 * t) > 0.3 ? 0.25 * Math.sin(2 * Math.PI * 220 * t) + 0.1 * Math.sin(2 * Math.PI * 1300 * t) : 0);
          for (int c = 0; c < ch; c++) in[i * ch + c] = toShort((float) (v * (c == 0 ? 1 : 0.8)));
        }
        double[] lt = k == 2 ? new double[] {0, 1, 2} : null, lg = k == 2 ? new double[] {1, 2.5, 0.6} : null; double scale = k == 2 ? 1.25 : 1;
        VoiceProcessor p = new VoiceProcessor(shared, "s0", lt, lg, scale);
        AudioProcessor.AudioFormat f = p.configure(new AudioProcessor.AudioFormat(sr, ch, C.ENCODING_PCM_16BIT));
        if (f == AudioProcessor.AudioFormat.NOT_SET || !p.isActive()) { same = false; why = "Prozessor inaktiv"; break; }
        p.flush(AudioProcessor.StreamMetadata.DEFAULT);
        p.flush(AudioProcessor.StreamMetadata.DEFAULT);   // Media3 leert vor dem ersten Clip zweimal
        short[] got = drive(p, in, ch, r), want = direct(in, sr, ch, box, lt, lg, scale);
        if (got.length != in.length) { len = false; why = "Clip " + k + ": " + got.length + " Abtastwerte, erwartet " + in.length; }
        int diff = 0; for (int i = 0; i < Math.min(got.length, want.length); i++) if (got[i] != want[i]) diff++;
        if (diff > 0 || got.length != want.length) { same = false; why = "Clip " + k + ": " + diff + " Abweichungen"; }
        if (k == 0) { double e0 = 0, e1 = 0; for (int i = 0; i < in.length; i++) { e0 += (double) in[i] * in[i]; e1 += (double) got[i] * got[i]; } first = e1 > 0.05 * e0 && e1 < 1.2 * e0; }
      }
      String tag = "Stimme, Prozessor " + sr + " Hz/" + ch + " Kanal" + (cfg[2] == 1 ? ", kurzer erster Clip" : "");
      chk(tag + ": jeder Clip behält seine Länge", len, why);
      chk(tag + ": Ausgabe wie der Rechenkern direkt, die Rauschschätzung wandert von Clip zu Clip", same, why);
      chk(tag + ": Der Ton kommt hörbar durch", first);
    }
    VoiceProcessor q = new VoiceProcessor(new VoiceProcessor.Shared(), "x", null, null, 1);
    chk("Stimme, Prozessor: anderes als 16-Bit-Ton läuft unbearbeitet durch (inaktiv)", q.configure(new AudioProcessor.AudioFormat(48000, 2, C.ENCODING_PCM_FLOAT)) == AudioProcessor.AudioFormat.NOT_SET && !q.isActive());
    q.configure(new AudioProcessor.AudioFormat(48000, 2, C.ENCODING_PCM_16BIT)); q.flush(AudioProcessor.StreamMetadata.DEFAULT);
    chk("Stimme, Prozessor: ein leerer Clip endet ohne Ausgabe", drive(q, new short[0], 2, r).length == 0 && q.isEnded());
  }

  public static void main(String[] a) throws Exception {
    gainCurve();
    voiceProcessor();
    if (a.length > 0) voiceCases(a[0]);
    System.out.println("ERGEBNIS Android-Tonklassen: " + n + " geprüft, " + bad + " Fehler");
    System.exit(bad > 0 ? 1 : 0);
  }
}
