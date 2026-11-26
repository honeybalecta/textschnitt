/* HoneyCut – Spuren per Ton synchronisieren (2.53): Rechenkern, läuft auf allen Plattformen.

   Verglichen werden die Lautstärkeverläufe zweier Aufnahmen (dB je 10 ms, wie sie HoneyCut für jede Datei mit Ton ohnehin
   berechnet). Das verträgt verschiedene Mikrofone, Pegel und Hall: Es zählen die Silben, nicht der Pegel.

   TonSync.measure(a, b) → {offset, score, ratio, overlap} oder null
     a, b     Lautstärkeverläufe (Uint8Array, 0…255 = −90…0 dB, 100 Werte je Sekunde, ab Beginn der Datei)
     offset   die Zeit 0 von b liegt bei dieser Zeit von a (Sekunden; negativ: b lief schon vorher)
     score    wie weit die beste Stelle aus allen anderen heraussticht (Standardabweichungen)
     ratio    beste Stelle im Verhältnis zur zweitbesten (mehr als eine halbe Sekunde entfernt)
     overlap  gemeinsamer Bereich in Sekunden
   TonSync.ok(m) → passt die Stelle eindeutig? (dieselbe Regel wie beim Angleichen der zweiten Tonquelle, 2.41) */
(function(g){
  const HZ = 100;
  // Verlauf vorbereiten: dB, langsamen Verlauf (2 s) abziehen, auf Mittel 0 und Streuung 1 bringen, Ausreißer kappen
  function prep(u8){
    const n = u8.length, e = new Float64Array(n), k = 200, cs = new Float64Array(n + k + 1);
    for (let i = 0; i < n; i++) e[i] = u8[i] / 2.8 - 90;
    const h = k >> 1; for (let i = 0; i < n + k; i++){ const q = Math.min(n - 1, Math.max(0, i - h)); cs[i + 1] = cs[i] + e[q]; }
    let m = 0; for (let i = 0; i < n; i++){ e[i] -= (cs[i + k] - cs[i]) / k; m += e[i]; } m /= n || 1;
    let v = 0; for (let i = 0; i < n; i++){ e[i] -= m; v += e[i] * e[i]; } const sd = Math.sqrt(v / (n || 1)) + 1e-9;
    for (let i = 0; i < n; i++) e[i] = Math.max(-3, Math.min(3, e[i] / sd));
    return e;
  }
  // FFT (Radix 2, an Ort und Stelle); inv: Rücktransformation ohne Teilen durch n
  function fft(re, im, inv){
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++){ let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j){ let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1){
      const ang = 2 * Math.PI / len * (inv ? 1 : -1), wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
      for (let i = 0; i < n; i += len){ let cr = 1, ci = 0;
        for (let k = 0; k < half; k++){ const a = i + k, b = a + half, xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
    }
  }
  function measure(a, b){
    if (!a || !b || a.length < HZ || b.length < HZ) return null;   // mindestens eine Sekunde Ton in beiden
    const ea = prep(a), eb = prep(b), la = ea.length, lb = eb.length;
    let n = 1; while (n < la + lb) n <<= 1;
    const ar = new Float64Array(n), ai = new Float64Array(n), br = new Float64Array(n), bi = new Float64Array(n);
    ar.set(ea); br.set(eb); fft(ar, ai, false); fft(br, bi, false);
    for (let i = 0; i < n; i++){ const xr = ar[i] * br[i] + ai[i] * bi[i], xi = ai[i] * br[i] - ar[i] * bi[i]; ar[i] = xr; ai[i] = xi; }   // A · konj(B)
    fft(ar, ai, true);
    const need = Math.max(HZ, 0.1 * Math.min(la, lb));   // mindestens eine Sekunde und ein Zehntel der kürzeren Aufnahme gemeinsam
    const val = lag => { const over = lag >= 0 ? Math.min(la - lag, lb) : Math.min(lb + lag, la); if (over < need) return null; return ar[lag >= 0 ? lag : n + lag] / n / Math.sqrt(over); };
    let best = -Infinity, lag0 = 0, sum = 0, sq = 0, cnt = 0;
    for (let lag = -lb + 1; lag < la; lag++){ const v = val(lag); if (v == null) continue; sum += v; sq += v * v; cnt++; if (v > best){ best = v; lag0 = lag; } }
    if (!cnt) return null;
    const mean = sum / cnt, sd = Math.sqrt(Math.max(0, sq / cnt - mean * mean)) + 1e-9;
    let second = -Infinity; for (let lag = -lb + 1; lag < la; lag++){ if (Math.abs(lag - lag0) <= 50) continue; const v = val(lag); if (v != null && v > second) second = v; }
    // Scheitel zwischen den 10-ms-Schritten
    let frac = 0; const y0 = val(lag0 - 1), y2 = val(lag0 + 1);
    if (y0 != null && y2 != null){ const den = y0 - 2 * best + y2; if (Math.abs(den) > 1e-12) frac = Math.max(-0.5, Math.min(0.5, 0.5 * (y0 - y2) / den)); }
    const over = lag0 >= 0 ? Math.min(la - lag0, lb) : Math.min(lb + lag0, la);
    return {offset: Math.round((lag0 + frac) * 10) / 1000, score: Math.round((best - mean) / sd * 100) / 100,
      ratio: second > 0 ? Math.round(best / second * 1000) / 1000 : 99, overlap: Math.round(over) / HZ};
  }
  const ok = m => !!m && (m.score >= 8 || (m.score >= 5 && m.ratio >= 1.5));
  g.TonSync = {measure, ok};
})(typeof window !== 'undefined' ? window : globalThis);
