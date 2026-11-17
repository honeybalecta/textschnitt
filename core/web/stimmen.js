'use strict';
/* Stimmen trennen (2.38): ordnet die Wörter einer Aufnahme den sprechenden Personen zu – ohne Netz und ohne Modell,
   mit derselben Rechnung unter Windows, im Browser und unter Android.

   Ablauf:
     1. Klangmerkmale (MFCC, 19 Werte je 10 ms) aus dem Ton mit 16 kHz, nur dort, wo Wörter liegen.
     2. Die Rede wird an Pausen und Satzenden in kurze Stücke geteilt.
     3. Stücke mit ähnlichem Klang wachsen schrittweise zu Gruppen zusammen (Bayes-Kriterium, BIC) – vorsichtig, lieber einige
        Gruppen zu viel.
     4. Jede Gruppe bekommt ein Klangmodell (Gauß-Mischung). Erklärt das Modell einer größeren Gruppe den Ton einer kleineren
        fast so gut wie deren eigenes, sind beide dieselbe Stimme. So ergibt sich die Zahl der Personen – oder es wird
        zusammengefasst, bis die gewünschte Zahl erreicht ist.
     5. Mit den Modellen wird Wort für Wort neu entschieden; ein Wechsel mitten im Satz braucht mehr Belege als ein Wechsel
        nach einer Pause.

   Abgestimmt und gemessen ist das an Stimmen der Sprachsynthese (flite) in Gesprächen von einer bis dreißig Minuten mit einer
   bis fünf Stimmen. Sehr ähnliche Stimmen in kurzen Aufnahmen fallen beim Schätzen zusammen; dann hilft die feste Anzahl.

   Stimmen.run(sources, words, opts) → Promise<{spk: Int16Array, count, sure: Float32Array}>
     sources – [{pcm: Float32Array | Int16Array}] je Aufnahme (16 kHz, mono)
     words   – [{src, a, b, end}] in Sprechreihenfolge: Aufnahme, Beginn und Ende in Sekunden, end = Satzende
     opts    – {count: 0 (selbst schätzen) | 1…8, max: 6, onProgress(0…1), cancelled(), trace(schritt) zum Messen}
     spk[i]  – Nummer der Stimme je Wort (0 … count-1, in der Reihenfolge des ersten Auftritts), -1 ohne Ton
     sure[i] – 0…1, wie deutlich die Entscheidung für das Wort ausfiel */
(function(g){
  const SR = 16000, WIN = 400, HOP = 160, NFFT = 512, NMEL = 26, D = 19, DC = 13;   // DC: Werte für das Zusammenwachsen
  const tick = () => new Promise(r => setTimeout(r, 0));

  // ── Klangmerkmale ──
  let TAB = null;
  function tables(){
    if (TAB) return TAB;
    const ham = new Float32Array(WIN); for (let i = 0; i < WIN; i++) ham[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (WIN - 1));
    const cos = new Float32Array(NFFT / 2), sin = new Float32Array(NFFT / 2);
    for (let i = 0; i < NFFT / 2; i++){ cos[i] = Math.cos(2 * Math.PI * i / NFFT); sin[i] = Math.sin(2 * Math.PI * i / NFFT); }
    const rev = new Uint16Array(NFFT); for (let i = 0, bits = Math.log2(NFFT); i < NFFT; i++){ let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); rev[i] = r; }
    const mel = f => 2595 * Math.log10(1 + f / 700), imel = m => 700 * (10 ** (m / 2595) - 1);
    const lo = mel(100), hi = mel(7600), pts = []; for (let i = 0; i < NMEL + 2; i++) pts.push(imel(lo + (hi - lo) * i / (NMEL + 1)) * NFFT / SR);
    const fb = []; for (let m = 0; m < NMEL; m++){ const a = pts[m], c = pts[m + 1], b = pts[m + 2], k0 = Math.ceil(a), k1 = Math.floor(b), w = new Float32Array(Math.max(0, k1 - k0 + 1));
      for (let k = k0; k <= k1; k++) w[k - k0] = k <= c ? (k - a) / (c - a) : (b - k) / (b - c); fb.push({k0, w}); }
    const dct = new Float32Array(D * NMEL); for (let c = 0; c < D; c++) for (let m = 0; m < NMEL; m++) dct[c * NMEL + m] = Math.cos(Math.PI * (c + 1) * (m + 0.5) / NMEL);
    return TAB = {ham, cos, sin, rev, fb, dct};
  }
  function fft(re, im, T){
    const n = NFFT; for (let i = 0; i < n; i++){ const j = T.rev[i]; if (j > i){ let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1){ const half = len >> 1, step = n / len;
      for (let i = 0; i < n; i += len) for (let k = 0; k < half; k++){ const c = T.cos[k * step], s = -T.sin[k * step], a = i + k, b = a + half;
        const xr = re[b] * c - im[b] * s, xi = re[b] * s + im[b] * c; re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi; } }
  }
  // Merkmale für die Rahmen f0 … f1-1 einer Aufnahme; schreibt nach out (D Werte je Rahmen) und en (Pegel in dB)
  function frames(pcm, scale, f0, f1, out, en, o){
    const T = tables(), re = new Float32Array(NFFT), im = new Float32Array(NFFT), lm = new Float32Array(NMEL);
    for (let f = f0; f < f1; f++, o++){
      const s0 = f * HOP; let e = 0; re.fill(0); im.fill(0);
      for (let i = 0; i < WIN; i++){ const k = s0 + i, x = k < pcm.length ? pcm[k] * scale : 0, p = k > 0 && k - 1 < pcm.length ? pcm[k - 1] * scale : 0; e += x * x; re[i] = (x - 0.97 * p) * T.ham[i]; }
      en[o] = 10 * Math.log10(e / WIN + 1e-12);
      fft(re, im, T);
      for (let m = 0; m < NMEL; m++){ const {k0, w} = T.fb[m]; let s = 0; for (let k = 0; k < w.length; k++){ const q = k0 + k; s += w[k] * (re[q] * re[q] + im[q] * im[q]); } lm[m] = Math.log(s + 1e-10); }
      for (let c = 0; c < D; c++){ let s = 0; const b = c * NMEL; for (let m = 0; m < NMEL; m++) s += T.dct[b + m] * lm[m]; out[o * D + c] = s; }
    }
  }

  // ── Statistik eines Stücks: Anzahl, Summe, Summe der Produkte (obere Dreiecksmatrix) über die ersten DC Werte ──
  const TRI = DC * (DC + 1) / 2;
  function statOf(X, idx){
    const s = {n: idx.length, m: new Float64Array(DC), q: new Float64Array(TRI), ld: 0};
    for (const f of idx){ const b = f * D; let t = 0; for (let i = 0; i < DC; i++){ const xi = X[b + i]; s.m[i] += xi; for (let j = i; j < DC; j++) s.q[t++] += xi * X[b + j]; } }
    s.ld = logdet(s); return s;
  }
  function statAdd(a, b){ const s = {n: a.n + b.n, m: new Float64Array(DC), q: new Float64Array(TRI), ld: 0}; for (let i = 0; i < DC; i++) s.m[i] = a.m[i] + b.m[i]; for (let i = 0; i < TRI; i++) s.q[i] = a.q[i] + b.q[i]; s.ld = logdet(s); return s; }
  const CH = new Float64Array(DC * DC);
  function logdet(s){   // log der Determinante der Kovarianz (Cholesky), leicht gestützt
    const n = s.n; let t = 0, tr = 0;
    for (let i = 0; i < DC; i++) for (let j = i; j < DC; j++){ const v = s.q[t++] / n - (s.m[i] / n) * (s.m[j] / n); CH[i * DC + j] = v; CH[j * DC + i] = v; if (i === j) tr += v; }
    const eps = 1e-3 * tr / DC + 1e-6; let ld = 0;
    for (let i = 0; i < DC; i++){ for (let j = 0; j <= i; j++){ let v = CH[i * DC + j] + (i === j ? eps : 0); for (let k = 0; k < j; k++) v -= CH[i * DC + k] * CH[j * DC + k];
        if (i === j){ v = Math.sqrt(Math.max(v, 1e-9)); CH[i * DC + i] = v; ld += 2 * Math.log(v); } else CH[i * DC + j] = v / CH[j * DC + j]; } }
    return ld;
  }
  const PEN = 0.5 * (DC + TRI);
  // Bayes-Kriterium: unter 0 spricht der Klang für dieselbe Stimme
  // Ein Abstand bis TOL je Rahmen (gemessen am kleineren der beiden Teile) gilt als gewöhnliche Schwankung einer Stimme: anderer
  // Satz, andere Lautstärke. Ohne diese Duldung wüchse der Abstand mit der Länge der Aufnahme, und lange Gespräche zerfielen
  // in zu viele Stimmen.
  function dbic(a, b, lam, tol){ const n = a.n + b.n, ab = statAdd(a, b); return 0.5 * (n * ab.ld - a.n * a.ld - b.n * b.ld) - tol * 2 * Math.min(a.n, b.n) - lam * PEN * Math.log(n); }

  // ── Gauß-Mischung mit Diagonal-Kovarianz über alle D Werte ──
  function gmmTrain(X, idx, K, rnd){
    const n = idx.length; K = Math.max(1, Math.min(K, Math.floor(n / 60)));
    const mu = new Float64Array(K * D), va = new Float64Array(K * D), w = new Float64Array(K), asg = new Int32Array(n);
    for (let k = 0; k < K; k++){ const f = idx[Math.floor((k + 0.5) * n / K)]; for (let d = 0; d < D; d++) mu[k * D + d] = X[f * D + d]; }
    for (let it = 0; it < 6; it++){   // k-means als Start
      const cnt = new Float64Array(K), sum = new Float64Array(K * D);
      for (let i = 0; i < n; i++){ const b = idx[i] * D; let best = 0, bd = Infinity; for (let k = 0; k < K; k++){ let dd = 0; for (let d = 0; d < D; d++){ const v = X[b + d] - mu[k * D + d]; dd += v * v; } if (dd < bd){ bd = dd; best = k; } }
        asg[i] = best; cnt[best]++; for (let d = 0; d < D; d++) sum[best * D + d] += X[b + d]; }
      for (let k = 0; k < K; k++) if (cnt[k] > 0) for (let d = 0; d < D; d++) mu[k * D + d] = sum[k * D + d] / cnt[k];
    }
    const gv = new Float64Array(D), gm = new Float64Array(D); for (let i = 0; i < n; i++){ const b = idx[i] * D; for (let d = 0; d < D; d++) gm[d] += X[b + d]; }
    for (let d = 0; d < D; d++) gm[d] /= n; for (let i = 0; i < n; i++){ const b = idx[i] * D; for (let d = 0; d < D; d++){ const v = X[b + d] - gm[d]; gv[d] += v * v; } } for (let d = 0; d < D; d++) gv[d] = gv[d] / n + 1e-6;
    const cnt = new Float64Array(K); for (let i = 0; i < n; i++){ const k = asg[i], b = idx[i] * D; cnt[k]++; for (let d = 0; d < D; d++){ const v = X[b + d] - mu[k * D + d]; va[k * D + d] += v * v; } }
    for (let k = 0; k < K; k++){ w[k] = Math.max(cnt[k], 1) / n; for (let d = 0; d < D; d++) va[k * D + d] = Math.max(va[k * D + d] / Math.max(cnt[k], 1), 0.05 * gv[d]); }
    const m = {K, mu, va, w, c: new Float64Array(K)}; gmmConst(m);
    const post = new Float64Array(K);
    for (let it = 0; it < 4; it++){   // EM
      const N = new Float64Array(K), S = new Float64Array(K * D), Q = new Float64Array(K * D);
      for (let i = 0; i < n; i++){ const b = idx[i] * D; gmmPost(m, X, b, post); for (let k = 0; k < K; k++){ const p = post[k]; if (p < 1e-4) continue; N[k] += p; for (let d = 0; d < D; d++){ const x = X[b + d]; S[k * D + d] += p * x; Q[k * D + d] += p * x * x; } } }
      for (let k = 0; k < K; k++){ if (N[k] < 1) continue; w[k] = N[k] / n; for (let d = 0; d < D; d++){ const mm = S[k * D + d] / N[k]; mu[k * D + d] = mm; va[k * D + d] = Math.max(Q[k * D + d] / N[k] - mm * mm, 0.05 * gv[d]); } }
      gmmConst(m);
    }
    return m;
  }
  function gmmConst(m){ for (let k = 0; k < m.K; k++){ let s = Math.log(m.w[k] + 1e-12); for (let d = 0; d < D; d++) s -= 0.5 * Math.log(2 * Math.PI * m.va[k * D + d]); m.c[k] = s; } }
  function gmmPost(m, X, b, post){ let mx = -Infinity; for (let k = 0; k < m.K; k++){ let s = m.c[k]; for (let d = 0; d < D; d++){ const v = X[b + d] - m.mu[k * D + d]; s -= 0.5 * v * v / m.va[k * D + d]; } post[k] = s; if (s > mx) mx = s; }
    let z = 0; for (let k = 0; k < m.K; k++){ post[k] = Math.exp(post[k] - mx); z += post[k]; } for (let k = 0; k < m.K; k++) post[k] /= z; return mx + Math.log(z); }
  const PB = new Float64Array(64);
  const gmmLL = (m, X, b) => gmmPost(m, X, b, PB);

  // ── Ablauf ──
  async function run(sources, words, opts){
    opts = opts || {}; const prog = opts.onProgress || (() => {}), stop = () => !!(opts.cancelled && opts.cancelled());
    const nW = words.length, spk = new Int16Array(nW).fill(-1), sure = new Float32Array(nW);
    if (!nW) return {spk, count: 0, sure};
    // 1. Rahmen je Wort bestimmen und Merkmale nur dort rechnen
    const wf = new Int32Array(nW * 2); let total = 0; const spans = [];
    for (let i = 0; i < nW; i++){ const w = words[i], src = sources[w.src]; if (!src || !src.pcm){ wf[2 * i] = wf[2 * i + 1] = 0; continue; }
      const maxF = Math.max(0, Math.floor((src.pcm.length - WIN) / HOP)), f0 = Math.min(maxF, Math.max(0, Math.round(w.a * 100))), f1 = Math.min(maxF, Math.max(f0, Math.round(w.b * 100)));
      wf[2 * i] = total; total += f1 - f0; wf[2 * i + 1] = total; if (f1 > f0) spans.push({pcm: src.pcm, scale: src.pcm instanceof Int16Array ? 1 / 32768 : 1, f0, f1, o: wf[2 * i]}); }
    if (total < 100) return {spk, count: 0, sure};
    const X = new Float32Array(total * D), en = new Float32Array(total); let last = Date.now();
    for (let k = 0; k < spans.length; k++){ const s = spans[k]; frames(s.pcm, s.scale, s.f0, s.f1, X, en, s.o);
      if (Date.now() - last > 40){ prog(0.5 * s.o / total); await tick(); last = Date.now(); if (stop()) return null; } }
    // leise Rahmen (Verschlusslaute, Atmer, Pausen im Wort) bleiben außen vor
    const sorted = Float32Array.from(en).sort(), top = sorted[Math.floor(sorted.length * 0.95)], floor = Math.max(top - 30, sorted[Math.floor(sorted.length * 0.1)]);
    const ok = new Uint8Array(total); for (let f = 0; f < total; f++) ok[f] = en[f] >= floor ? 1 : 0;
    // Mittelwert und Streuung angleichen, damit alle Werte gleich viel zählen
    { const m = new Float64Array(D), v = new Float64Array(D); let n = 0; for (let f = 0; f < total; f++) if (ok[f]){ n++; for (let d = 0; d < D; d++) m[d] += X[f * D + d]; }
      for (let d = 0; d < D; d++) m[d] /= Math.max(n, 1); for (let f = 0; f < total; f++) if (ok[f]) for (let d = 0; d < D; d++){ const q = X[f * D + d] - m[d]; v[d] += q * q; }
      for (let d = 0; d < D; d++) v[d] = Math.sqrt(v[d] / Math.max(n, 1)) || 1; for (let f = 0; f < total; f++) for (let d = 0; d < D; d++) X[f * D + d] = (X[f * D + d] - m[d]) / v[d]; }
    const wIdx = i => { const a = []; for (let f = wf[2 * i]; f < wf[2 * i + 1]; f++) if (ok[f]) a.push(f); return a; };

    // 2. Stücke: Trennung an Pausen, Satzenden und Aufnahmewechseln; lange Stücke werden geteilt
    const gapOf = i => i === 0 ? 9 : words[i].src !== words[i - 1].src ? 9 : Math.max(0, words[i].a - words[i - 1].b);
    const hours = total / 360000, pieceLen = hours > 0.75 ? 400 : hours > 0.3 ? 300 : 220;   // Rahmen je Stück
    const segs = []; let cur = null;
    for (let i = 0; i < nW; i++){ const n = wf[2 * i + 1] - wf[2 * i], g_ = gapOf(i), brk = !cur || g_ > 0.25 || (i > 0 && words[i - 1].end) || cur.n + n > pieceLen;
      if (brk){ cur = {w0: i, w1: i + 1, n: 0}; segs.push(cur); } cur.w1 = i + 1; cur.n += n; }
    for (const s of segs){ s.idx = []; for (let i = s.w0; i < s.w1; i++) for (const f of wIdx(i)) s.idx.push(f); }
    // 3. Zusammenwachsen: nur Stücke mit genug Ton tragen ein eigenes Klangbild
    const MINF = 90; let cl = segs.filter(s => s.idx.length >= MINF).map(s => ({st: statOf(X, s.idx), segs: [s]}));
    if (!cl.length){ const all = []; for (const s of segs) for (const f of s.idx) all.push(f); if (all.length < 40) return {spk, count: 0, sure}; for (let i = 0; i < nW; i++) if (wf[2 * i + 1] > wf[2 * i]) spk[i] = 0; sure.fill(1); return {spk, count: 1, sure}; }
    const want = Math.max(0, Math.min(8, opts.count | 0)), maxN = Math.max(1, Math.min(8, opts.max || 6)), lam = opts.lambda || LAMBDA, tol = opts.tol != null ? opts.tol : TOL, theta = opts.theta || THETA;
    let n = cl.length; const dm = new Float64Array(n * n).fill(Infinity), alive = new Uint8Array(n).fill(1);
    for (let i = 0; i < n; i++){ for (let j = i + 1; j < n; j++) dm[i * n + j] = dbic(cl[i].st, cl[j].st, lam, tol);
      if (Date.now() - last > 40){ prog(0.5 + 0.2 * i / n); await tick(); last = Date.now(); if (stop()) return null; } }
    let left = n;
    while (left > 1){
      let bi = -1, bj = -1, bd = Infinity; for (let i = 0; i < n; i++){ if (!alive[i]) continue; for (let j = i + 1; j < n; j++) if (alive[j] && dm[i * n + j] < bd){ bd = dm[i * n + j]; bi = i; bj = j; } }
      if (bi < 0) break;
      if ((want && left <= want) || (bd >= 0 && left <= CAP)) break;
      cl[bi] = {st: statAdd(cl[bi].st, cl[bj].st), segs: cl[bi].segs.concat(cl[bj].segs)}; alive[bj] = 0; left--;
      for (let k = 0; k < n; k++){ if (!alive[k] || k === bi) continue; const v = dbic(cl[bi].st, cl[k].st, lam, tol); if (k < bi) dm[k * n + bi] = v; else dm[bi * n + k] = v; }
      if (Date.now() - last > 40){ prog(0.7 + 0.1 * (1 - left / n)); await tick(); last = Date.now(); if (stop()) return null; }
    }
    // Vorläufige Gruppen: lieber einige zu viel. Gruppen mit sehr wenig Ton (Lachen, Husten, ein einzelnes „Ja“) tragen kein
    // eigenes Klangbild; ihre Wörter fallen später der passenden Stimme zu.
    let fidx = cl.filter((_, i) => alive[i]).map(c => { const a = []; for (const s of c.segs) for (const f of s.idx) a.push(f); return a; }).sort((a, b) => b.length - a.length);
    const tiny = []; { const sum = fidx.reduce((a, c) => a + c.length, 0), least = Math.max(300, 0.02 * sum); while (fidx.length > Math.max(1, want) && fidx[fidx.length - 1].length < least) tiny.push(fidx.pop()); }
    // 3b. Zahl der Stimmen: Jede Gruppe bekommt ein Klangmodell. Erklärt das Modell einer größeren Gruppe den Ton einer kleineren
    // fast so gut wie deren eigenes, gehören beide zur selben Stimme. Das Maß zählt je Rahmen und hängt deshalb kaum von der
    // Länge der Aufnahme ab.
    { const sub = a => { if (a.length <= 6000) return a; const o = [], st = a.length / 6000; for (let i = 0; i < 6000; i++) o.push(a[Math.floor(i * st)]); return o; };
      const comps = n => Math.round(Math.min(16, Math.max(2, n / 400)));
      // Kleine Gruppen (wenige Sekunden Ton) müssen deutlicher passen als große: Ihr eigenes Modell ist grob und sagt wenig.
      const limit = n => 1 + (theta - 1) * Math.max(0, Math.min(1, (n - 800) / 2200));
      let subs = fidx.map(sub), models = subs.map(a => gmmTrain(X, a, comps(a.length))); const cache = new Map();
      // die kleinen Gruppen schließen sich der Gruppe an, deren Modell ihren Ton am besten erklärt – so geht kein Ton verloren
      if (tiny.length && fidx.length > 1){ const add = fidx.map(() => []);
        for (const t of tiny){ let bj = 0, bv = -Infinity; for (let j = 0; j < fidx.length; j++){ let s = 0; for (const f of t) s += gmmLL(models[j], X, f * D); if (s > bv){ bv = s; bj = j; } } add[bj].push(t); }
        add.forEach((l, j) => { for (const t of l) fidx[j] = fidx[j].concat(t); }); subs = fidx.map(sub); models = subs.map(a => gmmTrain(X, a, comps(a.length))); }
      const dist = (i, j) => { const key = i + '>' + j; if (cache.has(key)) return cache.get(key); let s = 0; for (const f of subs[i]) s += gmmLL(models[i], X, f * D) - gmmLL(models[j], X, f * D); s /= subs[i].length; cache.set(key, s); return s; };
      while (fidx.length > 1){
        // Liegen manche Gruppen sehr weit auseinander, zählt ein Bruchteil dieses Abstands als Schwankung derselben Stimme
        let bi = -1, bj = -1, bd = Infinity, far = 0; const small = (i, j) => !(i === j || fidx[i].length > fidx[j].length || (fidx[i].length === fidx[j].length && i < j));
        for (let i = 0; i < fidx.length; i++) for (let j = 0; j < fidx.length; j++) if (small(i, j)) far = Math.max(far, dist(i, j));
        for (let i = 0; i < fidx.length; i++) for (let j = 0; j < fidx.length; j++){ if (!small(i, j)) continue; const v = dist(i, j) - Math.max(limit(fidx[i].length), REL * far); if (v < bd){ bd = v; bi = i; bj = j; } }
        if (opts.trace) opts.trace({left: fidx.length, d: bd, a: fidx[bi].length, b: fidx[bj].length});
        if (bi < 0 || (want ? fidx.length <= want : (bd >= 0 && fidx.length <= maxN))) break;
        fidx[bj] = fidx[bj].concat(fidx[bi]); fidx.splice(bi, 1); subs = fidx.map(sub); cache.clear();
        models = subs.map(a => gmmTrain(X, a, comps(a.length)));
        prog(0.8); await tick(); if (stop()) return null;
      }
    }
    let K = fidx.length;
    // 4. Klangmodelle und Entscheidung Wort für Wort
    const wordI = []; for (let i = 0; i < nW; i++) wordI.push(wIdx(i));
    const lab = new Int16Array(nW).fill(-1), conf = new Float32Array(nW);
    for (let round = 0, pass = 0; round < (K > 1 ? 3 : 1) && pass < 12; round++, pass++){
      const models = fidx.map(a => gmmTrain(X, a, Math.round(Math.min(16, Math.max(2, a.length / 400)))));
      prog(0.8 + 0.06 * round); await tick(); if (stop()) return null;
      // Punktzahl je Wort und Stimme; Viterbi über die Wörter mit Wechselkosten
      const sc = new Float64Array(nW * K), cnt = new Int32Array(nW);
      for (let i = 0; i < nW; i++){ const a = wordI[i]; cnt[i] = a.length; for (const f of a) for (let k = 0; k < K; k++) sc[i * K + k] += gmmLL(models[k], X, f * D); }
      const dp = new Float64Array(nW * K), bp = new Int16Array(nW * K);
      for (let k = 0; k < K; k++) dp[k] = sc[k];
      for (let i = 1; i < nW; i++){ const g_ = gapOf(i), cost = (i > 0 && words[i - 1].end) || g_ > 0.6 ? SWITCH * 0.15 : g_ > 0.25 ? SWITCH * 0.4 : SWITCH;
        let bk = 0; for (let k = 1; k < K; k++) if (dp[(i - 1) * K + k] > dp[(i - 1) * K + bk]) bk = k; const bv = dp[(i - 1) * K + bk] - cost;
        for (let k = 0; k < K; k++){ const stay = dp[(i - 1) * K + k]; if (stay >= bv){ dp[i * K + k] = stay + sc[i * K + k]; bp[i * K + k] = k; } else { dp[i * K + k] = bv + sc[i * K + k]; bp[i * K + k] = bk; } } }
      let k = 0; for (let q = 1; q < K; q++) if (dp[(nW - 1) * K + q] > dp[(nW - 1) * K + k]) k = q;
      for (let i = nW - 1; i >= 0; i--){ lab[i] = k; k = bp[i * K + k]; }
      // Sicherheit: Abstand zur zweitbesten Stimme je Rahmen, über den Redeabschnitt gemittelt
      for (let i = 0; i < nW; ){ let j = i, s1 = new Float64Array(K), c = 0; while (j < nW && lab[j] === lab[i]){ for (let q = 0; q < K; q++) s1[q] += sc[j * K + q]; c += cnt[j]; j++; }
        let second = -Infinity; for (let q = 0; q < K; q++) if (q !== lab[i] && s1[q] > second) second = s1[q];
        const v = K < 2 ? 1 : c ? Math.max(0, Math.min(1, (s1[lab[i]] - second) / c / 1.5)) : 0; for (let q = i; q < j; q++) conf[q] = v; i = j; }
      if (K < 2) break;
      // Modelle mit der neuen Zuordnung nachziehen; Stimmen ohne Wörter entfallen
      const nf = Array.from({length: K}, () => []); for (let i = 0; i < nW; i++) for (const f of wordI[i]) nf[lab[i]].push(f);
      const all = nf.reduce((x, a) => x + a.length, 0), least = want ? 150 : Math.max(300, 0.03 * all);
      const live = nf.map((a, q) => a.length >= least ? q : -1).filter(q => q >= 0);
      if (live.length < K){ if (!live.length) break; fidx = live.map(q => nf[q]); K = live.length; round = K > 1 ? Math.min(round, 0) : -1; continue; }
      fidx = nf;
    }
    // Reihenfolge des ersten Auftritts; Wörter ohne Ton erben die Stimme des Abschnitts
    const order = new Map(); for (let i = 0; i < nW; i++){ if (lab[i] < 0) continue; if (!order.has(lab[i])) order.set(lab[i], order.size); spk[i] = order.get(lab[i]); sure[i] = conf[i]; }
    prog(1); return {spk, count: order.size, sure};
  }
  const LAMBDA = 1.5, SWITCH = 40, TOL = 0, THETA = 4.0, REL = 0.2, CAP = 10;
  g.Stimmen = {run, SR};
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis);
