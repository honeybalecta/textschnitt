'use strict';
/* Person im Bild halten (2.39): aus groben Masken der Person entsteht ein ruhiger Kameraweg.

   Die Plattform liefert zu festen Zeiten eine kleine Maske der Person (Windows: RVM, Android: ML Kit, Browser: MediaPipe):
     {step, w, h, n, data}   step – Abstand der Masken in Sekunden, w × h – Größe einer Maske, n – Anzahl,
                             data – Base64 mit n·w·h Bytes (0 = Hintergrund … 255 = Person), Zeile für Zeile
   Alles Weitere rechnet diese Datei, für jede Plattform gleich:

   Folgen.samples(res)       → {step, x: [], y: []}   Lage der Person je Maske in Tausendsteln der Bildbreite und -höhe
                                                       (Kopf und Schultern), -1 = niemand zu sehen. So steht es im Projekt.
   Folgen.path(track)        → {step, x: Float32Array, y: Float32Array}   Kameraweg (0…1): Lücken gefüllt, Ausreißer entfernt,
                                                       kleine Bewegungen ausgelassen (Totzone), Fahrten weich
   Folgen.at(path, t)        → {x, y} zur Zeit t in Sekunden
   Folgen.keys(path, a, b, tol) → Zeiten zwischen a und b, an denen der Weg Stützpunkte braucht (für Keyframes im Export)

   Bei mehreren Menschen im Bild folgt der Weg der größten Fläche und bleibt bei ihr, solange sie zu sehen ist. */
(function(g){
  const DEAD = 0.02, SIGMA = 0.7, MED = 2;   // Totzone (Anteil der Bildbreite), Glättung in Sekunden, halbe Breite des Medians in Masken

  function bytes(b64){ const bin = atob(b64), a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }

  function samples(res){
    const w = res.w | 0, h = res.h | 0, n = res.n | 0, d = typeof res.data === 'string' ? bytes(res.data) : res.data;
    const xs = new Array(n).fill(-1), ys = new Array(n).fill(-1); let prev = -1;
    const col = new Float32Array(w);
    for (let k = 0; k < n && (k + 1) * w * h <= d.length; k++){
      const o = k * w * h; col.fill(0);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){ const v = d[o + y * w + x]; if (v >= 128) col[x] += 1; }
      // zusammenhängende Spaltenbereiche (eine leere Spalte darf dazwischen liegen)
      const runs = []; let a = -1, gap = 0, mass = 0;
      for (let x = 0; x <= w; x++){ const on = x < w && col[x] > 0;
        if (on){ if (a < 0){ a = x; mass = 0; } mass += col[x]; gap = 0; }
        else if (a >= 0){ if (++gap > 1 || x === w){ const b = x - gap; runs.push({a, b: x === w && gap <= 1 ? Math.min(w - 1, x - gap) : b, mass}); a = -1; } } }
      const least = Math.max(3, 0.012 * w * h), good = runs.filter(r => r.mass >= least);
      if (!good.length) continue;
      let best = good.reduce((p, r) => r.mass > p.mass ? r : p);
      if (prev >= 0 && good.length > 1){ const near = good.reduce((p, r) => Math.abs((r.a + r.b + 1) / 2 / w - prev) < Math.abs((p.a + p.b + 1) / 2 / w - prev) ? r : p); if (near.mass >= 0.5 * best.mass) best = near; }
      // Kopf und Schultern: die oberen 40 % der Fläche; Schwerpunkt nach Deckkraft gewichtet
      let top = -1, bot = -1; for (let y = 0; y < h; y++){ let any = false; for (let x = best.a; x <= best.b; x++) if (d[o + y * w + x] >= 128){ any = true; break; } if (any){ if (top < 0) top = y; bot = y; } }
      const hh = bot - top + 1, band = Math.max(1, Math.ceil(hh * 0.4)); let sx = 0, sw = 0;
      for (let y = top; y < top + band && y < h; y++) for (let x = best.a; x <= best.b; x++){ const v = d[o + y * w + x]; if (v >= 64){ sx += v * (x + 0.5); sw += v; } }
      if (!sw) continue;
      const cx = sx / sw / w, cy = (top + 0.15 * hh) / h;
      xs[k] = Math.round(cx * 1000); ys[k] = Math.round(cy * 1000); prev = cx;
    }
    return {step: +res.step || 0.5, x: xs, y: ys};
  }

  function axis(v, step){
    const n = v.length, a = new Float32Array(n); let first = -1;
    for (let i = 0; i < n; i++){ a[i] = v[i] < 0 ? NaN : v[i] / 1000; if (first < 0 && v[i] >= 0) first = i; }
    if (first < 0) return null;
    // Lücken: am Rand halten, innen gerade verbinden
    for (let i = 0; i < first; i++) a[i] = a[first];
    for (let i = first + 1, last = first; i < n; i++){ if (!isNaN(a[i])){ for (let j = last + 1; j < i; j++) a[j] = a[last] + (a[i] - a[last]) * (j - last) / (i - last); last = i; } else if (i === n - 1) for (let j = last + 1; j < n; j++) a[j] = a[last]; }
    // Ausreißer: Median über fünf Masken
    const m = new Float32Array(n), buf = [];
    for (let i = 0; i < n; i++){ buf.length = 0; for (let j = Math.max(0, i - MED); j <= Math.min(n - 1, i + MED); j++) buf.push(a[j]); buf.sort((p, q) => p - q); m[i] = buf[buf.length >> 1]; }
    // Totzone: Die Kamera bleibt stehen, solange die Person nahe der Bildmitte bleibt, und zieht dann nach
    const c = new Float32Array(n); let cam = m[0];
    for (let i = 0; i < n; i++){ const d = m[i] - cam; if (d > DEAD) cam = m[i] - DEAD; else if (d < -DEAD) cam = m[i] + DEAD; c[i] = cam; }
    // nach einer Fahrt zur Person aufschließen: Die Totzone lässt die Kamera sonst dauerhaft am Rand der Zone hängen
    const lead = new Float32Array(n); for (let i = 0; i < n; i++) lead[i] = c[i];
    { let i = 0; while (i < n){ let j = i; while (j + 1 < n && c[j + 1] === c[i]) j++; if (j > i){ let s = 0; for (let q = i; q <= j; q++) s += m[q]; const mean = s / (j - i + 1), t = Math.max(c[i] - DEAD, Math.min(c[i] + DEAD, mean)); for (let q = i; q <= j; q++) lead[q] = t; } i = j + 1; } }
    // weiche Fahrten: Gauß-Glättung
    const sg = Math.max(0.5, SIGMA / step), r = Math.ceil(sg * 3), kern = []; let ks = 0; for (let i = -r; i <= r; i++){ const w = Math.exp(-0.5 * i * i / (sg * sg)); kern.push(w); ks += w; }
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++){ let s = 0; for (let q = -r; q <= r; q++){ const j = Math.max(0, Math.min(n - 1, i + q)); s += kern[q + r] * lead[j]; } out[i] = s / ks; }
    return out;
  }
  function path(track){
    if (!track || !track.x || !track.x.length) return null;
    const step = +track.step || 0.5, x = axis(track.x, step), y = axis(track.y, step);
    return x && y ? {step, x, y} : null;
  }
  function at(p, t){
    const n = p.x.length, f = Math.max(0, Math.min(n - 1, t / p.step)), i = Math.floor(f), j = Math.min(n - 1, i + 1), u = f - i;
    return {x: p.x[i] + (p.x[j] - p.x[i]) * u, y: p.y[i] + (p.y[j] - p.y[i]) * u};
  }
  // Stützpunkte: so wenige Zeiten, dass die gerade Verbindung höchstens tol vom Weg abweicht (Douglas-Peucker über die Masken)
  function keys(p, a, b, tol){
    tol = tol || 0.004; const i0 = Math.max(0, Math.ceil(a / p.step - 1e-6)), i1 = Math.min(p.x.length - 1, Math.floor(b / p.step + 1e-6));
    const ts = [a]; for (let i = i0; i <= i1; i++){ const t = i * p.step; if (t > a + 1e-3 && t < b - 1e-3) ts.push(t); } ts.push(b);
    const pts = ts.map(t => at(p, t)), keep = new Uint8Array(ts.length); keep[0] = keep[ts.length - 1] = 1;
    const stack = [[0, ts.length - 1]];
    while (stack.length){ const [s, e] = stack.pop(); if (e - s < 2) continue; let worst = 0, wi = -1;
      for (let i = s + 1; i < e; i++){ const u = (ts[i] - ts[s]) / Math.max(1e-9, ts[e] - ts[s]), dx = pts[i].x - (pts[s].x + (pts[e].x - pts[s].x) * u), dy = pts[i].y - (pts[s].y + (pts[e].y - pts[s].y) * u), d = Math.max(Math.abs(dx), Math.abs(dy)); if (d > worst){ worst = d; wi = i; } }
      if (worst > tol){ keep[wi] = 1; stack.push([s, wi], [wi, e]); } }
    return ts.filter((_, i) => keep[i]);
  }
  g.Folgen = {samples, path, at, keys, DEAD};
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis);
