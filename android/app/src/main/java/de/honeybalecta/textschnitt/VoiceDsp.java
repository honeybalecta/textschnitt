package de.honeybalecta.textschnitt;

/**
 * Stimme aufbereiten: Rechenkern. Ein Durchgang in überlappenden Rahmen (rund 21 ms, 75 % Überlappung) mit Hochpass gegen
 * Trittschall und Brummen, Rauschminderung (die Rauschschätzung folgt je Frequenzband dem leisesten Pegel der letzten Zeit)
 * und einer Dämpfung des späten Nachhalls; danach der Pegelverlauf (leise Stellen anheben) und eine weiche Begrenzung.
 *
 * <p>Dieselbe Rechnung steht in core/web/app.js (Vorschau, Browser) und textschnitt.py (Windows) – Zeile für Zeile gleich
 * aufgebaut, damit alle drei dasselbe Ergebnis liefern. Reines Java ohne weitere Abhängigkeiten: Die Klasse wird in den
 * Prüfläufen außerhalb von Android übersetzt und mit den anderen Fassungen verglichen.
 */
public final class VoiceDsp {
  static final double HP = 85, TAU_S = 0.04, RISE = 2, BETA = 2.5, FLOOR_N = -12, FLOOR_R = -9, RT60 = 0.6, TD = 0.05, TAU_G = 0.05,
      DD = 0.96, MAKEUP = 1.5, KNEE = 0.8;
  /** So viele Sekunden vom Anfang einer Aufnahme dienen dem Lernen der Rauschschätzung. */
  public static final double PRIME = 2;

  public final int sr, ch, N, H, K;
  private final double[] win, hp, cos, sin, re, im, S, P, G, Gf, Gs, Gp, gam, ring;
  private final int[] rev;
  private final double[][] Xr, Xi, inb, ola, pend, tmp;
  private final double aS, up, rel, rho, gn, gr, makeup;
  private final int W, D;
  private double[] noise;
  private int m, ri, part, lk;
  private long hops, fed, done;
  private double[] lt, lg;
  private double lscale = 1, psum;

  /** @param noise Rauschschätzung aus einem früheren Abschnitt derselben Aufnahme oder null */
  public VoiceDsp(int sr, int ch, double[] noise) {
    this.sr = sr;
    this.ch = ch;
    N = sr >= 64000 ? 2048 : sr >= 32000 ? 1024 : sr >= 16000 ? 512 : 256;
    H = N >> 2;
    K = (N >> 1) + 1;
    win = new double[N];
    for (int i = 0; i < N; i++) win[i] = StrictMath.sin(Math.PI * i / N);
    hp = new double[K];
    for (int k = 1; k < K; k++) {
      double q = HP / (k * (double) sr / N);
      hp[k] = 1 / Math.sqrt(1 + q * q * q * q);
    }
    aS = StrictMath.exp(-H / (sr * TAU_S));
    W = (int) Math.max(2, Math.round(2 * TAU_S * sr / H));
    up = StrictMath.pow(10, RISE * H / sr / 10);
    rel = StrictMath.exp(-H / (sr * TAU_G));
    D = (int) Math.max(1, Math.round(TD * sr / H));
    rho = StrictMath.pow(10, -6 * (D * (double) H / sr) / RT60);
    gn = StrictMath.pow(10, FLOOR_N / 20);
    gr = StrictMath.pow(10, FLOOR_R / 20);
    makeup = StrictMath.pow(10, MAKEUP / 20);
    this.noise = noise != null && noise.length == K ? noise.clone() : null;
    int bits = 0;
    while ((1 << bits) < N) bits++;
    rev = new int[N];
    for (int i = 0; i < N; i++) {
      int r = 0;
      for (int b = 0; b < bits; b++) if ((i & (1 << b)) != 0) r |= 1 << (bits - 1 - b);
      rev[i] = r;
    }
    cos = new double[N >> 1];
    sin = new double[N >> 1];
    for (int i = 0; i < N >> 1; i++) {
      cos[i] = StrictMath.cos(2 * Math.PI * i / N);
      sin[i] = StrictMath.sin(2 * Math.PI * i / N);
    }
    re = new double[N];
    im = new double[N];
    Xr = new double[ch][K];
    Xi = new double[ch][K];
    inb = new double[ch][N];
    ola = new double[ch][N];
    pend = new double[ch][H];
    tmp = new double[ch][H];
    S = new double[K];
    P = new double[K];
    G = new double[K];
    Gf = new double[K];
    Gs = new double[K];
    Gp = new double[K];
    gam = new double[K];
    ring = new double[D * K];
    reset();
  }

  /** Die Rauschschätzung (zum Weitergeben an den nächsten Abschnitt derselben Aufnahme) oder null. */
  public double[] noise() {
    return noise == null ? null : noise.clone();
  }

  /** Neuer Abschnitt: alles auf Anfang, die Rauschschätzung bleibt. */
  public void reset() {
    m = 0;
    ri = 0;
    java.util.Arrays.fill(ring, 0);
    java.util.Arrays.fill(Gs, gn);
    java.util.Arrays.fill(Gp, gn);
    java.util.Arrays.fill(gam, 1);
    for (int c = 0; c < ch; c++) {
      java.util.Arrays.fill(inb[c], 0);
      java.util.Arrays.fill(ola[c], 0);
    }
    hops = 0;
    fed = 0;
    done = 0;
    part = 0;
    lk = 0;
  }

  private void fft(boolean inv) {
    for (int i = 0; i < N; i++) {
      int j = rev[i];
      if (j > i) {
        double t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (int size = 2; size <= N; size <<= 1) {
      int half = size >> 1, step = N / size;
      for (int a = 0; a < N; a += size)
        for (int k = 0; k < half; k++) {
          double wr = cos[k * step], wi = inv ? sin[k * step] : -sin[k * step];
          int p = a + k, q = p + half;
          double tr = re[q] * wr - im[q] * wi, ti = re[q] * wi + im[q] * wr;
          re[q] = re[p] - tr; im[q] = im[p] - ti;
          re[p] += tr; im[p] += ti;
        }
    }
  }

  /** Geglättete Leistung und Rauschschätzung aus einem vollständigen Rahmen. */
  private void track() {
    m++;
    if (m == 1) System.arraycopy(P, 0, S, 0, K);
    else if (m <= W) for (int k = 0; k < K; k++) S[k] = S[k] + (P[k] - S[k]) / m;
    else for (int k = 0; k < K; k++) S[k] = aS * S[k] + (1 - aS) * P[k];
    if (noise == null) {
      if (m == W) noise = S.clone();
    } else if (m > W) {
      for (int k = 0; k < K; k++) noise[k] = S[k] < noise[k] ? S[k] : Math.min(S[k], noise[k] * up);
    }
  }

  /** Gewinn je Frequenzband für den Rahmen mit der Leistung P; full: der Rahmen besteht ganz aus Ton (keine Auffüllung). */
  private void gain(boolean full) {
    if (full && psum > 1e-9) track();   // völlige Stille (stumm geschaltete Stellen) lehrt nichts über das Rauschen
    double[] Sx = m > 0 ? S : P;
    int r0 = ri * K;
    for (int k = 0; k < K; k++) {
      double g = 1, ga = 1;
      if (noise != null) {
        ga = P[k] / (BETA * noise[k] + 1e-12);
        double xi = DD * Gp[k] * Gp[k] * gam[k] + (1 - DD) * Math.max(ga - 1, 0);
        g = Math.max(gn, xi / (1 + xi));
      }
      Gp[k] = g;
      gam[k] = ga;
      double r = Math.max(gr, 1 - rho * ring[r0 + k] / (Sx[k] + 1e-12));
      G[k] = Math.max(gn, g * r);
    }
    if (full && m > 0) {
      System.arraycopy(S, 0, ring, r0, K);
      ri = (ri + 1) % D;
    }
    Gf[0] = G[0];
    Gf[K - 1] = G[K - 1];
    for (int k = 1; k < K - 1; k++) Gf[k] = 0.25 * G[k - 1] + 0.5 * G[k] + 0.25 * G[k + 1];
    for (int k = 0; k < K; k++) Gs[k] = Gf[k] > Gs[k] ? Gf[k] : rel * Gs[k] + (1 - rel) * Gf[k];
  }

  /** Die Rahmen aller Kanäle transformieren und die mittlere Leistung je Band bilden (inb ist gefüllt). */
  private void analyse() {
    java.util.Arrays.fill(P, 0);
    for (int c = 0; c < ch; c++) {
      double[] b = inb[c];
      for (int i = 0; i < N; i++) { re[i] = b[i] * win[i]; im[i] = 0; }
      fft(false);
      double[] xr = Xr[c], xi = Xi[c];
      for (int k = 0; k < K; k++) { xr[k] = re[k]; xi[k] = im[k]; P[k] += re[k] * re[k] + im[k] * im[k]; }
    }
    double s = 0;
    for (int k = 0; k < K; k++) { P[k] /= ch; s += P[k]; }
    psum = s;
  }

  /** Ein Schritt: x[c] sind H neue Abtastwerte je Kanal, y[c] nimmt H fertige auf – um N − H verzögert. */
  private void hop(double[][] x, double[][] y, boolean full) {
    for (int c = 0; c < ch; c++) {
      double[] b = inb[c];
      System.arraycopy(b, H, b, 0, N - H);
      System.arraycopy(x[c], 0, b, N - H, H);
    }
    analyse();
    gain(full);
    for (int c = 0; c < ch; c++) {
      double[] xr = Xr[c], xi = Xi[c], o = ola[c];
      for (int k = 0; k < K; k++) { double g = Gs[k] * hp[k]; re[k] = xr[k] * g; im[k] = xi[k] * g; }
      for (int k = 1; k < K - 1; k++) { re[N - k] = re[k]; im[N - k] = -im[k]; }
      fft(true);
      for (int i = 0; i < N; i++) o[i] += re[i] / N * win[i] * 0.5;
      System.arraycopy(o, 0, y[c], 0, H);
      System.arraycopy(o, H, o, 0, N - H);
      java.util.Arrays.fill(o, N - H, N, 0);
    }
    hops++;
  }

  /** Rauschschätzung aus dem Anfang einer Aufnahme lernen (nur vollständige Rahmen, ohne Ausgabe). */
  public void prime(double[][] x, int n) {
    reset();
    for (int a = 0; a + N <= n; a += H) {
      for (int c = 0; c < ch; c++) System.arraycopy(x[c], a, inb[c], 0, N);
      analyse();
      if (psum > 1e-9) track();
    }
    if (noise == null && m >= 2) noise = S.clone();
    reset();
  }

  /** Pegelverlauf in Sekunden ab Beginn des Abschnitts (stückweise linear, Faktoren); scale: Zeitmaß (Tempo des Clips). */
  public void setLevel(double[] t, double[] g, double scale) {
    int n = Math.min(t == null ? 0 : t.length, g == null ? 0 : g.length);
    lt = n > 0 ? java.util.Arrays.copyOf(t, n) : null;
    lg = n > 0 ? java.util.Arrays.copyOf(g, n) : null;
    lscale = scale > 0 ? scale : 1;
    lk = 0;
  }

  private double levelAt(long i) {
    if (lt == null) return 1;
    double t = i / (double) sr * lscale;
    int n = lt.length;
    if (t <= lt[0]) return lg[0];
    if (t >= lt[n - 1]) return lg[n - 1];
    if (t < lt[lk]) lk = 0;
    while (lk < n - 2 && t >= lt[lk + 1]) lk++;
    double w = lt[lk + 1] - lt[lk];
    return w > 1e-9 ? lg[lk] + (lg[lk + 1] - lg[lk]) * (t - lt[lk]) / w : lg[lk + 1];
  }

  /** Abtastwert i des Abschnitts fertig machen: Ausgleich, Pegelverlauf, weiche Begrenzung. */
  private float shape(double v, long i) {
    v *= makeup * levelAt(i);
    double a = Math.abs(v);
    return (float) (a <= KNEE ? v : (v < 0 ? -1 : 1) * (KNEE + (1 - KNEE) * StrictMath.tanh((a - KNEE) / (1 - KNEE))));
  }

  /**
   * Abschnitt als Datenstrom: nimmt n Abtastwerte je Kanal aus x (ab Stelle xo) an und schreibt, was fertig ist, nach out
   * (ab Stelle oo). out braucht Platz für n + H Werte je Kanal. Zusammen mit finish() kommen genau so viele Abtastwerte
   * heraus, wie hineingegangen sind – ohne Versatz.
   *
   * @return Zahl der geschriebenen Abtastwerte je Kanal
   */
  public int feed(double[][] x, int xo, int n, float[][] out, int oo) {
    int lat = N - H, w = 0, i = 0;
    while (i < n) {
      int k = Math.min(H - part, n - i);
      for (int c = 0; c < ch; c++) System.arraycopy(x[c], xo + i, pend[c], part, k);
      part += k;
      i += k;
      fed += k;
      if (part == H) {
        hop(pend, tmp, hops * H + H >= N);
        part = 0;
        for (int q = 0; q < H; q++) {
          long pos = (hops - 1) * H + q - lat;
          if (pos < 0) continue;
          for (int c = 0; c < ch; c++) out[c][oo + w] = shape(tmp[c][q], pos);
          w++;
          done++;
        }
      }
    }
    return w;
  }

  /** Wie viele Abtastwerte finish() noch liefert. */
  public int pending() {
    return (int) (fed - done);
  }

  /** Der Rest des Abschnitts; out braucht Platz für pending() Werte je Kanal ab Stelle oo. */
  public int finish(float[][] out, int oo) {
    int rest = pending(), w = 0;
    while (w < rest) {
      for (int c = 0; c < ch; c++) java.util.Arrays.fill(pend[c], part, H, 0);
      part = 0;
      hop(pend, tmp, false);
      for (int q = 0; q < H && w < rest; q++) {
        long pos = (hops - 1) * H + q - (N - H);
        if (pos < 0) continue;
        for (int c = 0; c < ch; c++) out[c][oo + w] = shape(tmp[c][q], pos);
        w++;
        done++;
      }
    }
    return w;
  }
}
