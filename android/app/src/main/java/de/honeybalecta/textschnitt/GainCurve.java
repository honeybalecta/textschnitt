package de.honeybalecta.textschnitt;

import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.audio.GainProcessor;
import androidx.media3.common.util.UnstableApi;

/**
 * Lautstärke-Verlauf für den Ton eines Clips: stückweise linear über der Zeit (Werte 0…1), dazu eine kurze Blende an Anfang
 * und Ende des Clips. Die Zeit des Verlaufs ist „offset + Sekunden seit Clipbeginn“ – so gilt ein Verlauf in Ausgabezeit
 * (z. B. „Musik weicht der Sprache“) für jeden Clip an seiner Stelle. Vor dem ersten und nach dem letzten Punkt gilt deren Wert.
 *
 * <p>Die Klasse ist bewusst reines Java ohne weitere Abhängigkeiten: Sie wird in den Prüfläufen außerhalb von Android
 * übersetzt und durchgerechnet.
 */
@OptIn(markerClass = UnstableApi.class)
public final class GainCurve implements GainProcessor.GainProvider {
  private final double[] t;
  private final float[] g;
  private final double offset;
  private final double fade;
  private final double dur;
  private int k;   // zuletzt benutztes Stück des Verlaufs – die Abfragen laufen fast immer vorwärts

  /**
   * @param t Zeiten des Verlaufs in Sekunden, aufsteigend (leer: kein Verlauf)
   * @param g Werte dazu
   * @param offset Zeit des Verlaufs am Beginn des Clips
   * @param fade Länge der Blende an Anfang und Ende des Clips in Sekunden (0: keine)
   * @param dur Länge des Clips in Sekunden, für die Blende am Ende (0: unbekannt, dann nur am Anfang)
   */
  public GainCurve(double[] t, float[] g, double offset, double fade, double dur) {
    int n = Math.min(t == null ? 0 : t.length, g == null ? 0 : g.length);
    this.t = new double[n];
    this.g = new float[n];
    for (int i = 0; i < n; i++) {
      this.t[i] = t[i];
      this.g[i] = Math.max(0f, Math.min(1f, g[i]));
    }
    this.offset = offset;
    this.fade = Math.max(0, fade);
    this.dur = Math.max(0, dur);
  }

  /** Faktor zur Zeit x (Sekunden seit Clipbeginn). */
  public float at(double x) {
    float v = curve(offset + x);
    if (fade > 0) {
      if (x < fade) v *= (float) Math.max(0, x / fade);
      else if (dur > 0 && x > dur - fade) v *= (float) Math.max(0, (dur - x) / fade);
    }
    return v;
  }

  private float curve(double c) {
    int n = t.length;
    if (n == 0) return 1f;
    if (c <= t[0]) return g[0];
    if (c >= t[n - 1]) return g[n - 1];
    if (c < t[k]) k = 0;
    while (k < n - 2 && c >= t[k + 1]) k++;
    double w = t[k + 1] - t[k];
    return w > 1e-9 ? (float) (g[k] + (g[k + 1] - g[k]) * (c - t[k]) / w) : g[k + 1];
  }

  /** Bis zu welcher Zeit des Verlaufs der Wert ab c ununterbrochen 1 bleibt (c selbst hat den Wert 1). */
  private double curveUnityEnd(double c) {
    int n = t.length;
    if (n == 0) return Double.POSITIVE_INFINITY;
    int i;   // erster Punkt, ab dem geprüft wird
    if (c <= t[0]) i = 0;
    else if (c >= t[n - 1]) return Double.POSITIVE_INFINITY;
    else {
      int j = 0;
      while (j < n - 2 && c >= t[j + 1]) j++;
      if (g[j] != 1f || g[j + 1] != 1f) return c;   // genau auf einem Punkt mit dem Wert 1, daneben schon nicht mehr
      i = j + 1;
    }
    while (i < n && g[i] == 1f) i++;
    return i >= n ? Double.POSITIVE_INFINITY : t[Math.max(0, i - 1)];
  }

  @Override
  public float getGainFactorAtSamplePosition(long samplePosition, int sampleRate) {
    return at(samplePosition / (double) sampleRate);
  }

  @Override
  public long isUnityUntil(long samplePosition, int sampleRate) {
    double x = samplePosition / (double) sampleRate;
    if (at(x) != 1f) return C.TIME_UNSET;
    double end = curveUnityEnd(offset + x) - offset;                 // in Sekunden seit Clipbeginn
    if (fade > 0 && dur > 0) end = Math.min(end, dur - fade);         // danach beginnt die Blende am Ende
    if (end == Double.POSITIVE_INFINITY) return C.TIME_END_OF_SOURCE;
    // eine Abtastung Abstand zum Ende: Rundung darf keinen Wert unter 1 in den Bereich holen
    return Math.max(samplePosition + 1, (long) Math.floor(end * sampleRate));
  }
}
