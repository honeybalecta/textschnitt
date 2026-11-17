'use strict';
/* Skript abgleichen (2.40): richtet die Wörter des Transkripts an einem Manuskript aus – ohne Netz, für jede Plattform gleich.

   Skript.words(text)            → [{w, k}]  Wörter des Manuskripts: w wie geschrieben (mit Satzzeichen), k zum Vergleichen
                                   (klein, ohne Zeichen, ß → ss). Regieanweisungen in eckigen Klammern und Überschriften
                                   (Zeilen mit #) bleiben außen vor.
   Skript.key(wort)              → Vergleichsform eines Worts
   Skript.align(a, b)            → Schritte, die die Folge a (Transkript) in die Folge b (Manuskript) überführen:
                                   {op: 'eq' | 'fz' | 'sub' | 'm21' | 'm12' | 'del' | 'ins', i, j}
                                   eq gleich · fz fast gleich (Schreibweise) · sub anderes Wort an derselben Stelle ·
                                   m21 zwei gesprochene Wörter = ein geschriebenes · m12 umgekehrt ·
                                   del nur gesprochen (i) · ins nur im Manuskript (j)
   Skript.compare(spoken, text)  → {pairs, free, miss, stats}
       spoken – [{i, text}] die Wörter des Transkripts in Sprechreihenfolge (i = Kennung des Worts)
       pairs  – [{ids: [i …], text}] Stellen, an denen das Manuskript anders schreibt (Schreibweise, Großschreibung, Satzzeichen)
       free   – [{a, b, n}] frei gesprochene Stellen (erstes und letztes Wort, Zahl der Wörter), ab drei Wörtern
       miss   – [{after, text, n}] Stellen des Manuskripts, die nicht gesprochen wurden (nach welchem Wort), ab drei Wörtern
       stats  – {spoken, script, same, share} */
(function(g){
  const key = w => String(w || '').toLowerCase().replace(/ß/g, 'ss').normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '');
  function words(text){
    const out = [];
    const clean = String(text || '').replace(/\r/g, '').split('\n').filter(l => !/^\s*#/.test(l)).join('\n').replace(/\[[^\]\n]{0,300}\]/g, ' ');
    for (const raw of clean.split(/\s+/)){ if (!raw) continue; const k = key(raw);
      if (k) out.push({w: raw, k}); else if (out.length && /^[–—\-…!?.,;:"“”„»«)]+$/.test(raw)) out[out.length - 1].w += (/^[–—\-]/.test(raw) ? ' ' : '') + raw; }
    return out;
  }
  // Zahlwörter bis 99, damit „zwanzig“ und „20“ als dasselbe gelten
  const UNITS = {null: 0, eins: 1, ein: 1, eine: 1, zwei: 2, drei: 3, vier: 4, fuenf: 5, fünf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, elf: 11, zwoelf: 12, zwölf: 12, dreizehn: 13, vierzehn: 14, fuenfzehn: 15, fünfzehn: 15, sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19};
  const TENS = {zwanzig: 20, dreissig: 30, vierzig: 40, fuenfzig: 50, fünfzig: 50, sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90};
  function num(k){
    if (/^\d+$/.test(k)) return +k; if (k in UNITS && k !== 'ein' && k !== 'eine') return UNITS[k]; if (k in TENS) return TENS[k];
    const m = /^(.+)und(.+)$/.exec(k); if (m && m[1] in UNITS && m[2] in TENS && UNITS[m[1]] < 10) return TENS[m[2]] + UNITS[m[1]];
    if (k === 'hundert' || k === 'einhundert') return 100; if (k === 'tausend' || k === 'eintausend') return 1000; return null;
  }
  function lev(a, b, max){
    const n = a.length, m = b.length; if (Math.abs(n - m) > max) return max + 1; let prev = new Array(m + 1), cur = new Array(m + 1);
    for (let j = 0; j <= m; j++) prev[j] = j;
    for (let i = 1; i <= n; i++){ cur[0] = i; let best = cur[0]; for (let j = 1; j <= m; j++){ cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); if (cur[j] < best) best = cur[j]; } if (best > max) return max + 1; [prev, cur] = [cur, prev]; }
    return prev[m];
  }
  // 2 = gleich, 1 = fast gleich (Schreibweise, Zahlwort), 0 = verschieden
  function like(a, b){
    if (a === b) return 2; const L = Math.max(a.length, b.length);
    const na = num(a), nb = num(b); if (na != null && nb != null) return na === nb ? 1 : 0;
    if (L < 5) return 0; const max = L >= 9 ? 2 : 1; return lev(a, b, max) <= max ? 1 : 0;
  }
  const S_EQ = 3, S_FZ = 2, S_M = 2.4, S_SUB = -1, S_GAP = -1;
  // Abschnitt a[a0..a1) gegen b[b0..b1) mit dynamischer Programmierung
  function block(a, b, a0, a1, b0, b1, out){
    const n = a1 - a0, m = b1 - b0;
    if (!n){ for (let j = b0; j < b1; j++) out.push({op: 'ins', j}); return; }
    if (!m){ for (let i = a0; i < a1; i++) out.push({op: 'del', i}); return; }
    const W = m + 1, sc = new Float32Array((n + 1) * W), mv = new Uint8Array((n + 1) * W);   // 1 gleich/fast/sub, 2 del, 3 ins, 4 m21, 5 m12
    for (let i = 1; i <= n; i++){ sc[i * W] = i * S_GAP; mv[i * W] = 2; } for (let j = 1; j <= m; j++){ sc[j] = j * S_GAP; mv[j] = 3; }
    for (let i = 1; i <= n; i++){ const x = a[a0 + i - 1];
      for (let j = 1; j <= m; j++){ const y = b[b0 + j - 1], l = like(x, y);
        let best = sc[(i - 1) * W + j - 1] + (l === 2 ? S_EQ : l === 1 ? S_FZ : S_SUB), bm = 1;
        let v = sc[(i - 1) * W + j] + S_GAP; if (v > best){ best = v; bm = 2; }
        v = sc[i * W + j - 1] + S_GAP; if (v > best){ best = v; bm = 3; }
        if (l !== 2 && i >= 2){ const xx = a[a0 + i - 2] + x; if (xx.length >= 5 && like(xx, y) === 2){ v = sc[(i - 2) * W + j - 1] + S_M; if (v > best){ best = v; bm = 4; } } }
        if (l !== 2 && j >= 2){ const yy = b[b0 + j - 2] + y; if (yy.length >= 5 && like(x, yy) === 2){ v = sc[(i - 1) * W + j - 2] + S_M; if (v > best){ best = v; bm = 5; } } }
        sc[i * W + j] = best; mv[i * W + j] = bm; } }
    const rev = []; let i = n, j = m;
    while (i > 0 || j > 0){ const t = mv[i * W + j];
      if (t === 1){ const l = like(a[a0 + i - 1], b[b0 + j - 1]); rev.push({op: l === 2 ? 'eq' : l === 1 ? 'fz' : 'sub', i: a0 + i - 1, j: b0 + j - 1}); i--; j--; }
      else if (t === 2){ rev.push({op: 'del', i: a0 + i - 1}); i--; }
      else if (t === 3){ rev.push({op: 'ins', j: b0 + j - 1}); j--; }
      else if (t === 4){ rev.push({op: 'm21', i: a0 + i - 2, j: b0 + j - 1}); i -= 2; j--; }
      else { rev.push({op: 'm12', i: a0 + i - 1, j: b0 + j - 2}); i--; j -= 2; } }
    for (let q = rev.length - 1; q >= 0; q--) out.push(rev[q]);
  }
  // Anker: Wörter, die in beiden Abschnitten genau einmal vorkommen, in gleicher Reihenfolge (längste aufsteigende Folge)
  function anchors(a, b, a0, a1, b0, b1){
    const ca = new Map(), cb = new Map();
    for (let i = a0; i < a1; i++){ const e = ca.get(a[i]); ca.set(a[i], e === undefined ? i : -1); }
    for (let j = b0; j < b1; j++){ const e = cb.get(b[j]); cb.set(b[j], e === undefined ? j : -1); }
    const pairs = []; for (let i = a0; i < a1; i++){ if (ca.get(a[i]) !== i) continue; const j = cb.get(a[i]); if (j !== undefined && j >= 0 && a[i].length >= 3) pairs.push([i, j]); }
    // längste aufsteigende Folge nach j
    const tails = [], prev = new Array(pairs.length).fill(-1), idx = [];
    for (let p = 0; p < pairs.length; p++){ let lo = 0, hi = tails.length; while (lo < hi){ const mid = (lo + hi) >> 1; if (pairs[idx[mid]][1] < pairs[p][1]) lo = mid + 1; else hi = mid; }
      if (lo > 0) prev[p] = idx[lo - 1]; idx[lo] = p; tails[lo] = pairs[p][1]; if (lo === tails.length - 1 && lo >= idx.length) idx.length = lo + 1; }
    const res = []; let p = idx.length ? idx[tails.length - 1] : -1; while (p >= 0){ res.push(pairs[p]); p = prev[p]; } return res.reverse();
  }
  const CELLS = 1.5e6;
  function span(a, b, a0, a1, b0, b1, out, depth){
    const n = a1 - a0, m = b1 - b0;
    if (n * m <= CELLS || depth > 40){ if (n * m <= CELLS * 4) return block(a, b, a0, a1, b0, b1, out);
      // sehr großer Abschnitt ohne gemeinsame Anker: in der Mitte teilen
      const ha = a0 + (n >> 1), hb = b0 + (m >> 1); span(a, b, a0, ha, b0, hb, out, depth + 1); span(a, b, ha, a1, hb, b1, out, depth + 1); return; }
    const an = anchors(a, b, a0, a1, b0, b1);
    if (!an.length){ const ha = a0 + (n >> 1), hb = b0 + (m >> 1); span(a, b, a0, ha, b0, hb, out, depth + 1); span(a, b, ha, a1, hb, b1, out, depth + 1); return; }
    // nur ein ausgedünnter Teil der Anker teilt auf: Die Abschnitte dazwischen rechnet block genau
    const step = Math.max(1, Math.floor(an.length / Math.max(1, Math.ceil(n * m / CELLS) * 2))); let pa = a0, pb = b0;
    for (let q = step - 1; q < an.length; q += step){ const [i, j] = an[q]; span(a, b, pa, i, pb, j, out, depth + 1); out.push({op: 'eq', i, j}); pa = i + 1; pb = j + 1; }
    span(a, b, pa, a1, pb, b1, out, depth + 1);
  }
  function align(a, b){ const out = []; span(a, b, 0, a.length, 0, b.length, out, 0); return out; }

  const FILL = new Set(['äh', 'ähm', 'hm', 'hmm', 'mhm', 'ah', 'eh', 'öhm', 'öh', 'em']);
  function compare(spoken, text){
    const sw = words(text), a = spoken.map(s => key(s.text)), b = sw.map(x => x.k);
    // Wörter ohne Vergleichsform (nur Zeichen) laufen nicht mit
    const ai = [], ak = []; a.forEach((k, q) => { if (k){ ai.push(q); ak.push(k); } });
    const ops = align(ak, b), pairs = [], free = [], miss = []; let same = 0;
    const strip = s => String(s || '').trim();
    let run = [], gap = [], last = -1;   // laufende Folge nur gesprochener Wörter, nur geschriebener Wörter, letztes zugeordnetes Wort
    const flush = () => {
      const r = run.filter(q => !FILL.has(ak[q]));
      if (r.length >= 3) free.push({a: spoken[ai[run[0]]].i, b: spoken[ai[run[run.length - 1]]].i, n: r.length});
      if (gap.length >= 3) miss.push({after: last >= 0 ? spoken[ai[last]].i : -1, text: gap.map(j => sw[j].w).join(' '), n: gap.length});
      run = []; gap = []; };
    for (const o of ops){
      if (o.op === 'del'){ run.push(o.i); continue; }
      if (o.op === 'ins'){ gap.push(o.j); continue; }
      if (o.op === 'sub'){ run.push(o.i); gap.push(o.j); continue; }
      flush();
      if (o.op === 'eq' || o.op === 'fz'){ same++; const s = spoken[ai[o.i]]; if (strip(s.text) !== sw[o.j].w) pairs.push({ids: [s.i], text: sw[o.j].w}); last = o.i; }
      else if (o.op === 'm21'){ same += 2; pairs.push({ids: [spoken[ai[o.i]].i, spoken[ai[o.i + 1]].i], text: sw[o.j].w}); last = o.i + 1; }
      else if (o.op === 'm12'){ same++; const s = spoken[ai[o.i]], t = sw[o.j].w + ' ' + sw[o.j + 1].w; if (strip(s.text) !== t) pairs.push({ids: [s.i], text: t}); last = o.i; }
    }
    flush();
    return {pairs, free, miss, stats: {spoken: ak.length, script: b.length, same, share: ak.length ? same / ak.length : 0}};
  }
  g.Skript = {words, key, align, compare, like};
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis);
