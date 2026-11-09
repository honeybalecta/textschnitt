'use strict';
/* HoneyCut-Studio – gemeinsame Oberfläche für Windows, Android und Web.
   Die Plattform stellt window.TS bereit: Android nativ, Desktop über bridge-http.js. */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const J = s => { try { return JSON.parse(s); } catch(e){ return null; } };
const TS = window.TS;
const CAP = Object.assign({platform:'android', exportFormats:['video']}, J(TS.info ? TS.info() : '') || {});
document.documentElement.dataset.platform = CAP.platform;
const FINE = matchMedia('(pointer: fine)').matches;
// Medien-Adressen: Desktop/Android liefern sie über den lokalen Server, der Browser über die Brücke (Datei bleibt auf dem Gerät)
const MEDIA = uri => TS.mediaUrl ? TS.mediaUrl(uri) : 'media?u=' + encodeURIComponent(uri);
const THUMB = (uri, t, h) => TS.thumbUrl ? TS.thumbUrl(uri, +t.toFixed(1), h) : `thumb?u=${encodeURIComponent(uri)}&t=${t.toFixed(1)}&h=${h}`;

const fmtT = t => { t = Math.max(0, t || 0); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = Math.floor(t % 60);
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
const fmtS = t => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + s.toFixed(1).padStart(4, '0').replace('.', ','); };
const norm = w => w.toLowerCase().replace(/[.,!?;:…"„“”‚‘’'()\-–—]/g, '');
const FILLER = /^(ä+h*m*|ä+m+|ö+h*m*|ö+m+|e+h+m*|e+m+|h+m+|mh+m+|m+h*m+|u+h+m*|uu+m+|erm|a+h+m+)$/i;
const WD = {t: 0, v: -1, n: 0};   // Abspiel-Wächter (siehe playWatch)
const newId = () => Math.random().toString(36).slice(2, 10);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const r3 = x => +(+x).toFixed(3);
const sentEnd = w => /[.?!…]$/.test(w || '') && !/^\d+\.$/.test(w || '');   // „am 31.“ ist kein Satzende
const tokText = t => (P && P.edits && P.edits[t.i] != null) ? P.edits[t.i] : t.text;
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2600); }

// ───────── Brücke zur Plattform ─────────
const pending = new Map();
window.TSApp = {
  onPicked(reqId, json){ const cb = pending.get(reqId); pending.delete(reqId); if (cb) cb(json ? J(json) : null); },
  onBack(){ if ($('#proj').classList.contains('full')){ setFull(false); return true; }
            if (!$('#sheet').classList.contains('hidden')) { closeSheet(); return true; }
            if (!$('#modelSheet').classList.contains('hidden')) { $('#modelSheet').classList.add('hidden'); $('#sheetBack').classList.add('hidden'); return true; }
            if (!$('#proj').classList.contains('hidden')) { closeProject(); return true; } return false; },
  onPause(){ if (P) { pausePlay(); saveNow(); rememberOpen(); } },
  onOpenFiles(json){ const list = J(json); if (list && list.length){ if (P) closeProject(); createProject(list); } },
};
function pickMedia(kind){ return new Promise(res => { const id = newId(); pending.set(id, res); TS.pick(id, kind); }); }
function watchJob(id, onTick, onDone, onFail){
  const tick = () => {
    const j = J(TS.job(id)); if (!j) return onFail({error:'Job verloren'});
    onTick(j);
    if (j.status === 'running') return setTimeout(tick, 500);
    if (j.status === 'done') onDone(j); else onFail(j);
  };
  tick();
}
const asList = m => !m ? [] : Array.isArray(m) ? m : [m];

// ───────── Zustand ─────────
let P = null;                    // aktuelles Projekt
let tokens = [], spans = [], deleted = new Set();
let ranges = [], rangeToks = [], pieces = [], timeline = [], total = 0, overlays = [], srcTotal = 0;
let undo = [], redo = [], saveT = null;
let tab = 'text';
const DEF_STYLE = {enabled:true, mode:'lines', chars:32, lines:2, dur:4, size:'mittel', pos:'unten', x:0.5, y:0.88, color:'#FFFFFF', outline:true};
const POS_Y = {oben:0.12, mitte:0.5, unten:0.88};
const isWide = () => matchMedia('(min-width: 760px) and (min-height: 600px)').matches;
const studioOn = () => (tab === 'studio' || tab === 'clip') && !!P;   // im Clip-Reiter läuft die Zeitleiste mit

// ───────── Quellen (mehrere Videos hintereinander) ─────────
function layoutSources(){ let o = 0; P.sources.forEach((s, k) => { s.off = r3(o); s.k = k; o += s.duration; }); srcTotal = o; }
function srcAt(t){ for (let k = P.sources.length - 1; k > 0; k--) if (t >= P.sources[k].off - 1e-6) return k; return 0; }
const srcEnd = si => P.sources[si].off + P.sources[si].duration;
const hasVid = s => s.kind !== 'audio' && s.hasVideo !== false;
// Ausgabeformat (Clips): 9:16, 4:5 … – sonst das Format des Videos
const FORMATS = {'9:16':[9,16], '4:5':[4,5], '1:1':[1,1], '16:9':[16,9], '4:3':[4,3]};
function baseDims(){
  const [w, h] = dispSize(primary()), f = P && P.format && FORMATS[P.format]; if (!f) return [w, h];
  const r = f[0] / f[1], m = Math.min(w, h); return r < 1 ? [m, Math.round(m / r)] : [Math.round(m * r), m];
}
// Bildausschnitt des ganzen Clips (P.frame), darüber Lage/Größe des einzelnen Abschnitts
function frameFx(f){ const F = P && P.frame; if (!F) return f; const s1 = f.sc || 1;
  return {...f, sc: (F.sc || 1) * s1, tx: s1 * (F.tx || 0) + (f.tx || 0), ty: s1 * (F.ty || 0) + (f.ty || 0)}; }
// Anteil des Bildes, den das eingepasste Video einnimmt, und der Zoom, bei dem es das Bild ganz füllt
function fitFrac(){ const [sw, sh] = dispSize(primary()), [W, H] = baseDims(), as = sw / sh, ao = W / H;
  return as > ao ? [1, ao / as] : [as / ao, 1]; }
function fitFracOf(src){ const [sw, sh] = dispSize(src || primary()), [W, H] = baseDims(), as = sw / sh, ao = W / H; return as > ao ? [1, ao / as] : [as / ao, 1]; }
const coverSc = () => { const [wf, hf] = fitFrac(); return Math.max(1 / wf, 1 / hf); };
// Ausschnitt frei: beliebig zoomen und verschieben, ein schmaler Rand des Videos bleibt immer im Bild
function clampFrame(F){ const [wf, hf] = fitFrac(); F.sc = clamp(F.sc || 1, 0.05, 20); const mx = (F.sc * wf + 1) / 2 - 0.04, my = (F.sc * hf + 1) / 2 - 0.04;
  F.tx = r3(clamp(F.tx, -mx, mx)); F.ty = r3(clamp(F.ty, -my, my)); F.sc = r3(F.sc); return F; }
function primary(){ return P.sources.find(hasVid) || {width:1920, height:1080, fps:30, rotation:0}; }
function dispSize(m){ const r = Math.abs(m.rotation || 0) % 180 === 90; const w = m.width || 1920, h = m.height || 1080; return r ? [h, w] : [w, h]; }
// Lautstärke-Hüllkurve (100 Werte/s, als Base64 gespeichert) für präzise Schnitte
function envArr(s){
  if (!s.env) return null;
  if (!s._env){ const b = atob(s.env), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    Object.defineProperty(s, '_env', {value:a, writable:true, enumerable:false, configurable:true}); }
  return s._env;
}
// Sprachabschnitte („Bursts“) aus der Hüllkurve: [[start, ende], …] in Sekunden der Quelle (ohne off).
// Schwelle liegt zwischen Grundrauschen und Sprachpegel; Lücken unter 0,18 s werden geschlossen.
function burstsOf(src){
  const a = envArr(src); if (!a) return null;
  if (src._bursts) return src._bursts;
  const n = a.length, hist = new Uint32Array(256); for (let i = 0; i < n; i++) hist[a[i]]++;
  const pct = q => { let c = 0, lim = q * n; for (let v = 0; v < 256; v++){ c += hist[v]; if (c >= lim) return v / 2.8 - 90; } return 0; };
  const thr = Math.max(pct(0.2) + 10, pct(0.9) - 25);
  const db = i => a[i] / 2.8 - 90, loud = new Uint8Array(n);
  for (let i = 0; i < n; i++){ let m = -90; for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) m = Math.max(m, db(j)); loud[i] = m > thr ? 1 : 0; }
  const raw = []; let st = -1;
  for (let i = 0; i <= n; i++){ const l = i < n && loud[i]; if (l && st < 0) st = i; if (!l && st >= 0){ raw.push([st / 100, i / 100]); st = -1; } }
  const merged = [];
  for (const b of raw){ const l = merged[merged.length-1]; if (l && b[0] - l[1] < 0.18) l[1] = b[1]; else merged.push(b); }
  const res = merged.filter(b => b[1] - b[0] >= 0.12);
  Object.defineProperty(src, '_bursts', {value: res, writable: true, enumerable: false, configurable: true});
  return res;
}
const lcsLen = (A, B) => { const m = A.length, n = B.length, d = Array.from({length: m + 1}, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = A[i-1] === B[j-1] ? d[i-1][j-1] + 1 : Math.max(d[i-1][j], d[i][j-1]); return d[m][n]; };
// Wiederholte Anläufe finden (generisch): items mit text(), Rückgabe Gruppen {att:[[i0,i1],…], fin:[j0,j1]}
function repeatGroups(items, textOf, sameSrc){
  const raw = items.map(textOf), W = raw.map(norm), fill = W.map(w => FILLER.test(w) || !w);
  const same = (a, b) => W[a] === W[b] || (/[-–…]$/.test(raw[a]) && W[a].length >= 2 && W[b].startsWith(W[a]));
  const groups = []; let i = 0, cur = null;
  while (i < items.length){
    let found = null, mm = 0;
    if (!fill[i]) for (let j = i + 1; j < items.length && j <= i + 30; j++){
      if (!sameSrc(i, j)) break;
      if (!same(i, j)) continue;
      let end = j - 1; while (end > i && fill[end]) end--;
      const att = []; for (let k = i; k <= end; k++) if (!fill[k]) att.push(k);
      let m = 0; while (m < att.length && j + m < items.length && same(att[m], j + m)) m++;
      const last = raw[end], n = att.length;
      if (att.slice(0, -1).some(k => sentEnd(raw[k]))) continue;   // über ein Satzende hinweg ist es kein Anlauf
      if (sentEnd(last) && i > 0 && !sentEnd(raw[i-1]) && !fill[i-1]) continue;   // Satzende, das mitten im Satz beginnt = Satzschluss, kein Anlauf
      let ok;
      if (n === 1) ok = m >= 1 && !KEEP_REPEAT.has(W[i]) && !sentEnd(last);
      else if (n <= 3) ok = sentEnd(last) ? m === n : m >= Math.max(2, n - 1);
      else {
        // längere Anläufe: Ähnlichkeit statt exakter Vorsilbe (kleine Abweichungen sind normal)
        const A = att.map(k => W[k]), B = []; for (let k = j; k < items.length && B.length < n + 2; k++) if (!fill[k]) B.push(W[k]);
        const l = lcsLen(A, B); ok = m >= 2 && (sentEnd(last) ? l / n >= 0.85 : l / n >= 0.7);   // die ersten zwei Wörter müssen stimmen
      }
      if (ok){ found = j; mm = m; break; }
    }
    if (found != null){
      if (cur && cur.fin[0] === i) cur.att.push([i, found - 1]); else { cur = {att:[[i, found - 1]], fin:[found, found + mm - 1]}; groups.push(cur); }
      cur.fin = [found, found + Math.max(mm, 1) - 1]; i = found;
    } else { if (cur && cur.fin[0] !== i) cur = null; i++; }
  }
  return groups;
}
// Wörter an den tatsächlichen Ton anpassen:
//  1. Wiederholte Anläufe („ich wollte – ich wollte heute“) bekommen je einen Sprachabschnitt – Whisper verteilt deren Zeiten oft falsch.
//  2. Sprache, zu der Whisper kein Wort geliefert hat (ausgelassene Wiederholungen), wird als eigener Eintrag (🗣) sichtbar.
let srcForAlign = null;
function alignThr(a){ const n = a.length, hist = new Uint32Array(256); for (let i = 0; i < n; i++) hist[a[i]]++;
  const pct = q => { let c = 0, lim = q * n; for (let v = 0; v < 256; v++){ c += hist[v]; if (c >= lim) return v / 2.8 - 90; } return 0; };
  return Math.max(pct(0.2) + 10, pct(0.9) - 25); }
// Wortgrenzen am Ton nachschärfen. Whisper liefert Wortzeiten aus der Aufmerksamkeit des Modells – die liegen oft
// 0,1–0,4 s daneben: Wörter nach einer Pause beginnen zu früh (noch in der Stille), Wörter vor einer Pause enden zu spät.
//  1. Gleichmäßiger Versatz (Ton und Wortzeiten verschoben): Anfänge nach und Enden vor Pausen sind beide in dieselbe
//     Richtung verschoben → alle Wörter um den Mittelwert verschieben.
//  2. Jede Grenze an einer Pause wird auf den tatsächlichen Stimmeinsatz bzw. das Verklingen gesetzt –
//     nur innerhalb des Fensters zwischen Nachbarwörtern, nie über ein anderes Wort hinweg.
function refineTimes(words){
  const a = envArr(srcForAlign); if (!a || !words.length) return words;
  const n = a.length, thr = alignThr(a), soft = thr - 6;
  const dB = i => i < 0 || i >= n ? -90 : a[i] / 2.8 - 90;
  const on = (i, t) => dB(i) >= t;
  const real = words.map((w, k) => k).filter(k => !words[k].unk);
  const prevEnd = j => j > 0 ? words[real[j-1]].end : -1, nextStart = j => j < real.length - 1 ? words[real[j+1]].start : Infinity;
  // Stimmeinsatz in der Nähe von t: erster lauter Frame nach mindestens 0,15 s Stille
  const onsetNear = (t, r) => { const c = Math.round(t * 100); let best = null;
    for (let i = Math.max(1, c - r); i <= Math.min(n - 1, c + r); i++){ if (!on(i, thr) || on(i - 1, soft)) continue;
      let q = true; for (let j = i - 15; j < i; j++) if (j >= 0 && on(j, soft)){ q = false; break; }
      if (q && (best == null || Math.abs(i - c) < Math.abs(best - c))) best = i; }
    return best == null ? null : best / 100; };
  const offsetNear = (t, r) => { const c = Math.round(t * 100); let best = null;
    for (let i = Math.max(0, c - r); i <= Math.min(n - 2, c + r); i++){ if (!on(i, thr) || on(i + 1, soft)) continue;
      let q = true; for (let j = i + 1; j <= i + 15; j++) if (j < n && on(j, soft)){ q = false; break; }
      if (q && (best == null || Math.abs(i - c) < Math.abs(best - c))) best = i; }
    return best == null ? null : (best + 1) / 100; };
  // 1. gleichmäßiger Versatz
  const dS = [], dE = [];
  real.forEach((k, j) => { const w = words[k];
    // nur eindeutige Fälle: Whisper sieht eine Lücke, und der gefundene Einsatz liegt näher an diesem Wort als an den Nachbarn
    if (w.start - prevEnd(j) >= 0.1){ const o = onsetNear(w.start, 50); if (o != null && (j === 0 || Math.abs(o - w.start) < Math.abs(o - words[real[j-1]].start))) dS.push(o - w.start); }
    if (nextStart(j) - w.end >= 0.1){ const o = offsetNear(w.end, 50); if (o != null && (j === real.length - 1 || Math.abs(o - w.end) < Math.abs(o - words[real[j+1]].end))) dE.push(o - w.end); } });
  const med = v => { const x = [...v].sort((p, q) => p - q); return x[x.length >> 1]; };
  if (dS.length >= 6 && dE.length >= 6){
    const ms = med(dS), me = med(dE);
    // Beide in dieselbe Richtung verschoben = Versatz der Wortzeiten insgesamt (Pausen-Fehler heben sich im Mittel auf)
    if (Math.sign(ms) === Math.sign(me) && Math.abs(ms + me) / 2 >= 0.06){
      const sh = clamp((ms + me) / 2, -0.5, 0.5);
      for (const w of words){ w.start = r3(Math.max(0, w.start + sh)); w.end = r3(Math.max(w.start + 0.02, w.end + sh)); }
    }
  }
  // 2. Grenzen an Pausen
  real.forEach((k, j) => {
    const w = words[k], lo = Math.max(0, prevEnd(j)), hi = nextStart(j);
    const si = Math.round(w.start * 100), ei = Math.round(w.end * 100);
    // Anfang liegt in der Stille → zum Stimmeinsatz vor
    let quietS = true; for (let i = si; i < si + 6; i++) if (on(i, soft)){ quietS = false; break; }
    if (quietS){ const lim = Math.min(ei - 3, si + 60); for (let i = si + 1; i <= lim; i++) if (on(i, soft)){ w.start = r3(Math.max(lo, i / 100 - 0.03)); break; } }
    else { // Anfang mitten im Klang: beginnt der Klang erst kurz davor (nach einer Pause, die hinter dem Vorgänger liegt)? → dorthin
      let i = si; while (i > 0 && si - i < 30 && on(i - 1, soft)) i--;
      if (si - i < 30 && i / 100 - 0.03 > lo + 0.05){ let q = true; for (let j2 = i - 12; j2 < i; j2++) if (j2 >= 0 && on(j2, soft)){ q = false; break; } if (q) w.start = r3(i / 100 - 0.03); }
    }
    // Ende liegt in der Stille → auf das Verklingen zurück
    let quietE = true; for (let i = ei - 5; i <= ei; i++) if (on(i, soft)){ quietE = false; break; }
    if (quietE){ const lim = Math.max(Math.round(w.start * 100) + 3, ei - 60); for (let i = ei - 1; i >= lim; i--) if (on(i, soft)){ w.end = r3(Math.min(hi, (i + 1) / 100 + 0.04)); break; } }
    else { // Ende mitten im Klang: klingt das Wort noch kurz weiter und folgt dann eine Pause? → bis dorthin
      let i = ei; while (i < n - 1 && i - ei < 30 && on(i + 1, soft)) i++;
      if (i - ei < 30 && (i + 1) / 100 + 0.03 < hi - 0.05){ let q = true; for (let j2 = i + 1; j2 <= i + 12; j2++) if (j2 < n && on(j2, soft)){ q = false; break; } if (q) w.end = r3((i + 1) / 100 + 0.03); }
    }
    if (w.end < w.start + 0.04) w.end = r3(w.start + 0.04);
  });
  return words;
}
function alignWithAudio(words, bursts){
  if (!bursts || !bursts.length || !words.length) return words;
  words = refineTimes(words.map(w => ({...w})));
  // Grundsatz: Die Textreihenfolge von Whisper ist verlässlich, die Zeiten sind es nicht. Zeiten werden nur
  // innerhalb des Fensters zwischen Vorgänger- und Nachfolgerwort verändert, nie wird umsortiert.
  const len = w => Math.max(1, norm(w.text || '').length);
  const isFill = k => FILLER.test(norm(words[k].text || ''));
  const spread = (idx, t0, t1) => { idx = idx.filter(k => !isFill(k)); if (!idx.length || !(t1 > t0)) return; const tot = idx.reduce((n, k) => n + len(words[k]), 0); let t = t0; const d = t1 - t0;
    idx.forEach(k => { const w = d * len(words[k]) / tot; words[k].start = r3(t); words[k].end = r3(Math.min(t1, t + w)); t += w; }); };
  const plaus = idx => { idx = idx.filter(k => !isFill(k)); if (!idx.length) return true; const d = words[idx[idx.length-1]].end - words[idx[0]].start; return d / idx.length >= 0.1 && d / idx.length <= 1.5; };
  const burstAt = t => bursts.findIndex(b => t >= b[0] - 0.05 && t <= b[1] + 0.05);
  const attBursts = new Set();
  // Unplausibel lange Wörter: Whisper hat davor Sprache verschluckt (meist einen Neuansatz) und dem nächsten
  // erkannten Wort einen viel zu frühen Anfang gegeben. Das Wort behält sein Ende, der Rest wird 🗣.
  const loudIn = (a, b) => bursts.reduce((n, x) => n + Math.max(0, Math.min(b, x[1]) - Math.max(a, x[0])), 0);
  // Einsatz der Stimme vor einem Sprachabschnitt (leise Anlaute wie „Es“ liegen oft knapp unter der Abschnittsschwelle)
  const onsetBefore = (bs, lo) => {
    const a = envArr(srcForAlign); if (!a) return bs;
    const quiet = alignThr(a) - 8; let i = Math.floor(bs * 100); const min = Math.max(Math.ceil(lo * 100), i - 40);
    while (i - 1 > min && a[i-1] / 2.8 - 90 >= quiet) i--;
    return r3(Math.max(lo, i / 100 - 0.02));
  };
  const unk = [];
  for (const w of words){
    const n = norm(w.text || '').length, dur = w.end - w.start;
    if (!n || dur <= Math.max(1.1, 0.1 * n + 0.5)) continue;
    const est = clamp(0.06 * n + 0.12, 0.15, 0.9);
    // letzte Lücke in der Hüllkurve innerhalb des Wortes: dahinter liegt das eigentliche Wort
    let ws = w.end - est;
    const a = envArr(srcForAlign); if (a){
      const thr = alignThr(a); let q = -1;
      for (let i = Math.floor((w.end - est) * 100); i > Math.floor(w.start * 100) + 10; i--){ if (a[i] / 2.8 - 90 < thr){ let j = i; while (j > 0 && a[j-1] / 2.8 - 90 < thr) j--; if (i - j >= 10){ q = i / 100; break; } i = j; } }
      if (q > 0 && w.end - q <= Math.max(1.1, 0.1 * n + 0.5)) ws = Math.max(q, w.start + 0.1);   // Lücke nur nutzen, wenn das Wort danach plausibel kurz ist
    }
    if (loudIn(w.start, ws) >= 0.4) unk.push({start:r3(w.start), end:r3(ws), att:false});
    w.start = r3(ws);
  }
  for (const g of repeatGroups(words, w => w.text || '', (i, j) => words[j].start - words[i].start <= 30)){
    const first = g.att[0][0], m = g.att.length;
    let endW = g.fin[1];
    for (let k = g.fin[1] + 1; k < words.length && k <= g.fin[1] + 25; k++){ if (words[k].start - words[k-1].end > 0.8) break; endW = k; if (sentEnd(words[k].text)) break; }
    const cont = g.fin[1] + 1 <= endW ? g.fin[1] + 1 : null;
    const lo = first > 0 ? words[first-1].end : 0, hi = endW + 1 < words.length ? words[endW+1].start : Infinity;
    const span0 = words[first].start, f0 = words[g.fin[0]].start;
    // Abschnitt, in dem der endgültige Satz beginnt: dort, wo laut Whisper die Fortsetzung liegt
    const ref = cont != null ? words[cont].start : f0;
    let cb = burstAt(ref); if (cb < 0) cb = bursts.findIndex(b => b[0] >= ref - 0.05);
    if (cb < 0) continue;
    // Denkpause im endgültigen Satz: Whisper sieht dessen Anfang im Abschnitt davor
    while (cb > 0 && bursts[cb][0] - bursts[cb-1][1] < 1.0 && f0 >= bursts[cb-1][0] - 0.05 && f0 <= bursts[cb-1][1] + 0.1 && f0 < bursts[cb][0] - 0.3) cb--;
    let fs = bursts[cb][0];
    // Neuansatz ohne Atempause: Der letzte Anlauf liegt im selben Sprachabschnitt wie der endgültige Satz.
    // Dann beginnt der endgültige Satz dort, wo Whisper ihn sieht – nicht am Abschnittsanfang.
    const la = g.att[m-1];
    if (fs < f0 - 0.4 && words[la[0]].start >= fs - 0.4 && words[la[1]].end <= f0 + 0.15) fs = f0;
    if (fs < lo - 0.05 || fs <= span0 + 0.2 || fs > hi) continue;
    // Anläufe: Whisper-Zeiten behalten, wenn sie vor dem endgültigen Satz liegen und plausibel sind, sonst verteilen
    const attIdx = range(first, g.att[m-1][1]), attEnd = words[g.att[m-1][1]].end;
    if (!(attEnd <= fs + 0.1 && g.att.every(([a, b]) => plaus(range(a, b))))) spread(attIdx, Math.max(lo, span0), fs - 0.05);
    bursts.forEach((b, k) => { if (b[1] > Math.max(lo, span0) - 0.1 && b[0] < fs - 0.05) attBursts.add(k); });
    // endgültiger Satz: beginnt am Abschnittsanfang
    const finIdx = range(g.fin[0], endW);
    if (!(Math.abs(f0 - fs) <= 0.4 && plaus(finIdx))){
      const ew = words[endW].end;
      let last = cb; while (last + 1 < bursts.length && bursts[last+1][0] < ew - 0.1 && bursts[last+1][0] < hi) last++;
      spread(finIdx, fs, Math.min(hi, Math.max(bursts[cb][1], Math.min(ew + 0.05, bursts[last][1]))));
    }
  }
  // Sprache ohne Wörter → 🗣 (innerhalb von Anlauf-Bereichen als „Anlauf“ gekennzeichnet)
  const cov = words.map(w => [w.start - 0.12, w.end + 0.12]).concat(unk.map(u => [u.start, u.end])).sort((a, b) => a[0] - b[0]);
  unk.forEach(u => { if ([...attBursts].some(k => bursts[k][0] < u.end && bursts[k][1] > u.start)) u.att = true; });
  bursts.forEach(([bs, be], k) => {
    let t = bs;
    for (const [cs, ce] of cov){ if (ce <= t) continue; if (cs >= be) break; if (cs - t >= 0.4) unk.push({start:r3(t), end:r3(cs), att:attBursts.has(k)}); t = Math.max(t, ce); if (t >= be) break; }
    if (be - t >= 0.4) unk.push({start:r3(t), end:r3(be), att:attBursts.has(k)});
  });
  // 🗣 in die Textreihenfolge einsetzen: vor das erste Wort, das nach dem 🗣 beginnt
  const out = words.slice();
  for (const u of unk){
    let k = out.findIndex(w => !w.unk && w.start >= u.end - 0.05);
    if (k < 0) k = out.length;
    while (k > 0 && out[k-1].unk && out[k-1].start > u.start) k--;
    out.splice(k, 0, {text:'', unk:true, att:!!u.att, start:u.start, end:u.end, prob:0});
  }
  // Neuansätze, die Whisper ganz ausgelassen hat: Wörter W, dann 🗣…, dann die Fortsetzung C direkt am Ende des
  // letzten 🗣 (gleicher Sprachabschnitt). Dann ist der letzte 🗣 der Anfang des endgültigen Satzes: W wandert dorthin.
  for (let guard = 0, k = 0; k < out.length && guard < 500; k++, guard++){
    if (!out[k].unk || out[k].att) continue;
    let a = k; while (a + 1 < out.length && out[a+1].unk) a++;
    const c = a + 1; if (c >= out.length || out[c].unk) continue;
    if (out[c].start - out[a].end > 0.3) continue;
    const w1 = k - 1; if (w1 < 0 || out[w1].unk || sentEnd(out[w1].text)) continue;
    let w0 = w1; while (w0 > 0 && !out[w0-1].unk && !sentEnd(out[w0-1].text) && w1 - w0 < 12 && out[w0].start - out[w0-1].end < 0.8) w0--;
    if (out[c].start - out[w0].start > 40) continue;
    const durW = out[w1].end - out[w0].start, durH = out[c].start - out[a].start;
    if (durH < 0.3 || durW / durH > 2.2 || durH / durW > 2.2) continue;
    const W = out.slice(w0, w1 + 1), oldS = W[0].start, oldE = W[W.length-1].end, cStart = out[c].start;
    // Der Neuansatz beginnt nicht zwingend am Anfang des Kopf-🗣: oft hängt davor noch das Ende des alten Anlaufs
    // („… einfach werden. | Es geht dabei ganz einfach darum“). Dann beginnt W am letzten Sprachabschnitt im Kopf,
    // der für W noch genug Platz lässt; der Teil davor bleibt Anlauf-🗣.
    const headS = out[a].start;
    let head = headS;
    for (let b = bursts.length - 1; b >= 0; b--){
      const bs = bursts[b][0];
      if (bs <= headS + 0.15 || bs >= cStart - 0.2) continue;
      if ((cStart - bs) / durW >= 0.45 && bursts.some(x => x[1] > headS + 0.1 && x[1] <= bs + 0.01)){ head = onsetBefore(bs, headS); break; }
    }
    // W nach vorn hinter die 🗣 setzen, Kopf-🗣 entfernen (bzw. kürzen), alter Platz wird Anlauf-🗣
    if (head > headS + 0.1){ out[a].end = r3(head); out[a].att = true; a++; out.splice(a, 0, {text:'', unk:true, att:false, start:r3(head), end:r3(cStart), prob:0}); }
    out.splice(a, 1);                                   // Kopf
    out.splice(w0, W.length);                           // W herausnehmen (Indizes vor a bleiben gleich)
    for (let j = w0; j < a - W.length; j++) out[j].att = true; // die 🗣 dazwischen
    const ins = a - W.length;                           // Position direkt vor C
    out.splice(ins, 0, ...W);
    out.splice(w0, 0, {text:'', unk:true, att:true, start:r3(oldS), end:r3(oldE), prob:0});
    // Zeiten von W über den Kopf verteilen
    const tot = W.reduce((n, w) => n + len(w), 0); let t = head;
    for (const w of W){ const d = (cStart - head) * len(w) / tot; w.start = r3(t); w.end = r3(Math.min(cStart, t + d)); t += d; }
    k = -1;
  }
  return out;
}
const range = (a, b) => { const r = []; for (let k = a; k <= b; k++) r.push(k); return r; };
function envDb(si, t){ const s = P.sources[si], a = envArr(s); if (!a) return 0; const i = Math.round((t - s.off) * 100); return i < 0 || i >= a.length ? -90 : a[i] / 2.8 - 90; }

// ───────── Projektliste ─────────
function showHome(){
  $('#home').classList.remove('hidden'); $('#proj').classList.add('hidden');
  const list = J(TS.listProjects()) || [];
  const box = $('#projList'); box.innerHTML = '';
  $('#homeEmpty').classList.toggle('hidden', list.length > 0);
  list.sort((a, b) => b.updated - a.updated).forEach(p => {
    const el = document.createElement('div'); el.className = 'proj-item';
    el.innerHTML = `<div class="meta"><b></b><span class="muted small"></span></div>${TS.exportPackage ? '<button class="del share" title="Projekt weitergeben (.honeycut) – auf einem anderen Gerät oder von einer anderen Person weiterbearbeiten">⤴</button>' : ''}<button class="del" title="Löschen">🗑</button>`;
    el.querySelector('b').textContent = p.name;
    el.querySelector('span').textContent = `${fmtT(p.duration)}${p.sources > 1 ? ` · ${p.sources} Videos` : ''} · ${p.transcribed ? 'transkribiert' : 'noch nicht transkribiert'} · ${new Date(p.updated).toLocaleDateString('de-DE')}`;
    el.onclick = e => { if (e.target.closest('.del')) return; openProject(p.id); };
    const sh = el.querySelector('.share'); if (sh) sh.onclick = () => packageDialog(p.id);
    el.querySelector('.del:not(.share)').onclick = () => { if (confirm(`„${p.name}“ löschen? Deine Videos bleiben erhalten.`)) { TS.deleteProject(p.id); showHome(); } };
    box.append(el);
  });
  $('#homeHint').textContent = CAP.platform === 'web' ? 'Wähle ein oder mehrere Videos von deinem Gerät. Sie werden nicht hochgeladen: Transkription, Schnitt und Export laufen komplett in deinem Browser.'
    : CAP.platform === 'desktop' ? 'Wähle ein oder mehrere Videos (Strg/Umschalt für mehrere). Sie werden hintereinandergehängt und gemeinsam transkribiert.'
    : 'Wähle ein oder mehrere Videos aus deiner Galerie. Sie werden hintereinandergehängt und auf dem Gerät transkribiert – du schneidest dann über den Text.';
}
if (CAP.version && CAP.platform !== 'web'){ const v = document.createElement('p'); v.className = 'muted small'; v.style.cssText = 'text-align:center;margin:24px 0 90px'; v.textContent = 'HoneyCut ' + CAP.version; $('#home .home-body').append(v); }
$('#newProj').onclick = async () => { const list = asList(await pickMedia('videos')); if (list.length) createProject(list); };
function createProject(list){
  list = list.filter(Boolean); if (!list.length) return;
  const first = list[0];
  const name = first.name.replace(/\.[^.]+$/, '') + (list.length > 1 ? ` + ${list.length - 1}` : '');
  const p = {id:newId(), name, created:Date.now(), updated:Date.now(), sources:list.map(cleanSrc),
             tokens:[], deleted:[], trims:{}, adj:{}, dels:[], splits:[], settings:{pad:0.06, burn:true}, cues:[], sub_style:{...DEF_STYLE}, items:[]};
  // Altes Desktop-Projekt neben dem Video? Dann Transkript übernehmen.
  const lg = list.length === 1 && first.legacy;
  if (lg && lg.tokens && lg.tokens.length){
    p.tokens = lg.tokens.map(t => ({...t, src:0})); p.deleted = lg.deleted || []; p.trims = lg.trims || {}; p.language = lg.language;
    if (lg.cues) p.cues = lg.cues; if (lg.sub_style) p.sub_style = {...DEF_STYLE, ...lg.sub_style}; p.sources[0].tr = true;
  }
  TS.saveProject(p.id, JSON.stringify(p)); openProject(p.id);
  if (lg && lg.tokens && lg.tokens.length) toast('Vorhandenes Transkript übernommen');
}
function cleanSrc(m){ const s = {...m}; delete s.legacy; s.tr = false; return s; }

// ───────── Projekt öffnen ─────────
function openProject(id, keep){
  // Browser: vorher Zugriff auf die Videodateien sicherstellen (ggf. nach Rückfrage)
  if (TS.prepare && !keep) return TS.prepare(id).then(ok => { if (ok) openProjectNow(id); });
  openProjectNow(id, keep);
}
function openProjectNow(id, keep){
  const keepTab = keep ? tab : null, keepPos = keep ? outPos : 0;
  P = J(TS.loadProject(id)); if (!P) return toast('Projekt konnte nicht geladen werden');
  if (!P.sources){ P.sources = [P.main]; P.sources[0].tr = !!(P.tokens || []).length; delete P.main; }   // altes Format (ein Video)
  P.adj ||= {}; P.speakers ||= []; P.slides ||= []; P.items ||= []; P.dels ||= []; P.splits ||= []; P.edits ||= {}; P.moves ||= []; P.trims ||= {}; P.settings ||= {pad:0.06}; P.cues ||= [];
  if (P.settings.burn == null) P.settings.burn = true;
  P.sub_style = {...DEF_STYLE, ...(P.sub_style || {})}; if (P.sub_style.y == null) P.sub_style.y = POS_Y[P.sub_style.pos] ?? 0.88;
  tokens = P.tokens || []; tokens.forEach(t => { if (t.src == null) t.src = 0; });
  deleted = new Set(P.deleted || []); undo = []; redo = [];
  layoutSources(); vSi = -1; vPending = null;
  $('#home').classList.add('hidden'); $('#proj').classList.remove('hidden');
  $('#projName').textContent = P.name; $('#exName').value = P.name + '_geschnitten';
  const [ow, oh] = baseDims(); $('#exRes').options[0].textContent = `Original (${ow}×${oh})`;
  fitStage(); setTimeout(fitStage, 60);
  fillModels(); syncStyleInputs(); renderExportForm();
  if (tokens.length){ renderTranscript(); if (!P.cues.length) genCues(); }
  recompute();
  $('.clip-tab').classList.toggle('hidden', !P.clipOf && !P.format);
  if (P.regen && tokens.length){ genCues(); delete P.regen; saveNow(); }
  setTab(keepTab || (P.clipOf ? 'clip' : tokens.length ? 'text' : 'trans'));
  seekOut(keepPos, false);
  busStart(); backfillEnv(); resumeTranscribe(); rememberOpen();
  if (window.slSyncAll) setTimeout(() => slSyncAll(), 400);   // Folien an Format und Designprofil anpassen
}
// ── Vollbild-Vorschau: das ganze Projekt bildschirmfüllend ansehen ──
let fullHide = null;
function setFull(on){
  if (!P) return; const pr = $('#proj'); if (on === pr.classList.contains('full')) return;
  pr.classList.toggle('full', on); $('#fullBtn').innerHTML = icon(on ? '✕' : '⤢'); $('#fullBtn').title = on ? 'Vollbild beenden (Esc)' : 'Vollbild (F)';
  // Apps schalten das Fenster selbst um (Android: Systemleisten aus, Windows: Fenster-Vollbild), der Browser per Fullscreen-API
  let native = false; if (TS.immersive) try { native = !!TS.immersive(on); } catch(_){}
  if (!native) try {
    if (on && document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  } catch(_){}
  fullPoke(); setTimeout(fitStage, 0); setTimeout(fitStage, 300);
}
function fullPoke(){
  const pr = $('#proj'); pr.classList.remove('full-idle'); clearTimeout(fullHide);
  if (pr.classList.contains('full')) fullHide = setTimeout(() => { if (playing) pr.classList.add('full-idle'); }, 2500);
}
$('#sideFull').onclick = e => { e.stopPropagation(); setFull(true); };
$('#fullBtn').onclick = e => { e.stopPropagation(); setFull(!$('#proj').classList.contains('full')); };
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && $('#proj').classList.contains('full')) setFull(false); });
$('#proj').addEventListener('pointermove', () => { if ($('#proj').classList.contains('full')) fullPoke(); });
$('#proj').addEventListener('pointerdown', () => { if ($('#proj').classList.contains('full')) fullPoke(); }, true);
// Offenes Projekt merken: Lädt die Oberfläche neu (Android: auf-/zuklappen, Speicher knapp), geht es dort weiter
const OPEN_KEY = 'hc-open';
addEventListener('pagehide', () => rememberOpen()); document.addEventListener('visibilitychange', () => { if (document.hidden) rememberOpen(); });
function rememberOpen(){ if (!P || document.body.classList.contains('solo')) return; try { localStorage.setItem(OPEN_KEY, JSON.stringify({id: P.id, tab, pos: outPos, at: Date.now()})); } catch(_){} }
function closeProject(){ try { localStorage.removeItem(OPEN_KEY); } catch(_){} setFull(false); pausePlay(); saveNow(); allLayers(releaseMedia); for (const el of audLayers.values()) releaseMedia(el); audLayers.clear(); busPid = null; P = null; V.removeAttribute('src'); V.load(); vSi = -1; hideOverlay(); showHome(); }
$('#backBtn').onclick = closeProject;
const fillsWrap = () => isWide() || matchMedia('(orientation: landscape) and (max-height: 599px)').matches;
// Bühne: ein 16:9-Feld. Hochformat-Videos lassen links und rechts Platz – dort sitzt zusätzliche Steuerung.
function fitStage(){
  if (!P) return;
  const [w, h] = baseDims(), wrap = $('.stage-wrap'), st = $('#stage');
  const full = $('#proj').classList.contains('full');
  const fill = fillsWrap(), availW = full ? innerWidth : wrap.clientWidth || innerWidth;
  let boxH;
  if (full){ wrap.style.height = ''; boxH = innerHeight;
    let W = availW, H = W * h / w; if (H > boxH){ H = boxH; W = H * w / h; }
    st.style.width = Math.floor(W) + 'px'; st.style.height = Math.floor(H) + 'px';
    for (const el of [$('#sideL'), $('#sideR')]) el.classList.add('hidden');
    styleOverlay(); refreshStageOverlays(); return; }
  if (fill){ wrap.style.height = ''; boxH = wrap.clientHeight || innerHeight * 0.6; }
  else { boxH = Math.round(h > w ? Math.max(150, innerHeight * 0.38) : Math.min(availW * 9 / 16, Math.max(150, innerHeight * 0.36))); wrap.style.height = boxH + 'px'; }   // Hochformat: mehr Höhe, die Seiten nutzen die Steuerung
  const boxW = fill ? availW : Math.min(availW, boxH * 16 / 9);
  let W = boxW, H = W * h / w; if (H > boxH){ H = boxH; W = H * w / h; }
  st.style.width = Math.floor(W) + 'px'; st.style.height = Math.floor(H) + 'px';
  const side = Math.floor((availW - W) / 2), show = side >= 64;
  for (const el of [$('#sideL'), $('#sideR')]){ el.classList.toggle('hidden', !show); el.style.width = show ? Math.min(side, 170) + 'px' : ''; el.style.height = Math.floor(fill ? H : boxH) + 'px'; }
  styleOverlay(); refreshStageOverlays();
}
// Einblendungen und Titel nach einer Größenänderung der Bühne neu setzen
function refreshStageOverlays(){ if (!P || typeof outPos === 'undefined') return; try { updateOverlay(outPos); updateTitles(outPos); } catch(_){} }
addEventListener('resize', () => { fitStage(); if (P && studioOn() && window.renderTimeline) renderTimeline(); });
addEventListener('orientationchange', () => setTimeout(fitStage, 200));

// Alte Projekte ohne Lautstärke-Hüllkurve: im Hintergrund nachberechnen, damit Schnitte in Pausen landen
function backfillEnv(){
  if (!TS.envelope || !P) return;
  // Windows ab 2.8: Ton wird ab Bildbeginn gelesen. Ältere Transkripte von Videos, deren Ton später beginnt,
  // lagen um diesen Versatz zu früh – sie werden einmalig verschoben.
  const desk = CAP.platform === 'desktop';
  const pid = P.id, todo = P.sources.filter(s => s.tr && !s.noAudio && s.hasAudio !== false && (!s.env || (desk && !s.pad0)));
  (function next(){
    const s = todo.shift(); if (!s || !P || P.id !== pid) return;
    let id; try { id = TS.envelope(s.uri); } catch(_){ return; }
    watchJob(id, () => {}, j => { const r = j.result || {};
      if (P && P.id === pid && r.env){
        const had = !!s.env, sh = r.padded ? +(r.astart || 0) : 0, k = P.sources.indexOf(s);
        s.env = r.env; if (r.padded) s.pad0 = true; if (s._env) s._env = null; delete s._bursts;
        if (sh >= 0.02 && k >= 0) tokens.forEach(t => { if (t.src === k && t.ws != null){ t.ws = r3(Math.min(t.ws + sh, s.off + s.duration)); t.we = r3(Math.min(t.we + sh, s.off + s.duration)); } });
        if (!had || sh >= 0.02){ realign(); toast(sh >= 0.02 ? `Transkript korrigiert: Ton lag ${fmtD2(sh)} s versetzt` : 'Transkript am Ton ausgerichtet'); } else saveNow();
      } next(); }, () => next());
  })();
}


// ───────── Projekte weitergeben (.honeycut) ─────────
// Das Paket enthält das Projekt mit Platzhaltern (@hc:n) statt Dateipfaden und – wenn gewünscht – die Dateien selbst.
// Auf dem anderen Gerät werden die Platzhalter durch die dort abgelegten Dateien ersetzt. Ohne Dateien werden die Videos
// einer früher empfangenen Fassung desselben Projekts genommen (gleicher Name und gleiche Länge) oder erfragt.
function platformCall(fn){ return new Promise(res => { const id = newId(); pending.set(id, res); fn(id); }); }
function hcModal(html){
  closeHcModal(); const m = document.createElement('div'); m.className = 'hc-modal'; m.id = 'hcModal';
  m.innerHTML = `<div class="hc-card">${html}</div>`; document.body.append(m); return m;
}
function closeHcModal(){ const m = $('#hcModal'); if (m) m.remove(); }
function packageSpec(proj, withMedia){
  const p = JSON.parse(JSON.stringify(proj)), files = [], hfiles = [], byUri = new Map();
  const fileFor = (m, kind) => {
    if (byUri.has(m.uri)) return byUri.get(m.uri);
    const n = (kind === 'font' ? 'f' : 'm') + hfiles.length;
    byUri.set(m.uri, n);
    hfiles.push({n, kind, name: m.name || ('Datei' + hfiles.length), duration: m.duration || 0, width: m.width || 0, height: m.height || 0, mediaKind: m.kind || ''});
    files.push({n, uri: m.uri, include: kind === 'font' || withMedia});
    return n;
  };
  const walk = o => { if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object'){ if (typeof o.uri === 'string' && o.uri && !o.uri.startsWith('@hc')) o.uri = '@hc:' + fileFor(o, 'media');
      delete o.proxy; for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]); } };
  walk(p.sources); walk(p.items); walk(p.media || []); walk(p.slides || []);
  for (const sl of p.slides || []) if (sl.img && !String(sl.img).startsWith('@hc')) sl.img = '@hc:' + fileFor({uri: sl.img, name: String(sl.img).split(/[\\/]/).pop() || 'bild.png', kind: 'image'}, 'media');
  // eigene Schriften (Untertitel, Titel)
  const fontKey = key => { const f = key && userFonts.find(x => x.key === key); return f ? '@hcf:' + fileFor({uri: f.uri, name: (f.uri.split(/[\\/]/).pop() || f.label + '.ttf')}, 'font') : key; };
  if (p.sub_style && p.sub_style.font) p.sub_style.font = fontKey(p.sub_style.font);
  for (const it of p.items || []) if (it.font) it.font = fontKey(it.font);
  for (const sp of p.speakers || []) if (sp.st && sp.st.font) sp.st.font = fontKey(sp.st.font);
  const header = {format: 'honeycut-projekt', v: 1, app: CAP.version || '', platform: CAP.platform || '', created: Date.now(), name: p.name, project: p, files: hfiles};
  return {name: p.name || 'Projekt', header, files};
}
function packageDialog(pid){
  if (!TS.exportPackage) return toast('Projekte weitergeben geht in dieser Version noch nicht');
  if (P && P.id === pid) saveNow();
  const proj = J(TS.loadProject(pid)); if (!proj) return toast('Projekt nicht gefunden');
  const m = hcModal(`<h3>Projekt weitergeben</h3>
    <p class="muted small">„${esc(proj.name || 'Projekt')}“ wird als eine Datei (.honeycut) gespeichert. Die Datei z. B. über eine Cloud, per USB oder AirDrop/Quick Share aufs andere Gerät bringen und dort mit „Projekt importieren“ öffnen.</p>
    <label class="row"><input type="checkbox" id="pkgMedia" checked> Videos, Bilder und Schriften mitschicken</label>
    <p class="muted small" id="pkgHint">Ohne: nur der Schnitt (kleine Datei). Das andere Gerät nimmt dann die Videos aus einer früher empfangenen Fassung dieses Projekts oder fragt nach ihnen.</p>
    <div class="progress hidden" id="pkgProg"><i></i></div><div class="small muted" id="pkgMsg"></div>
    <div class="row" style="margin-top:12px"><button class="btn" id="pkgCancel">Abbrechen</button><button class="btn primary" id="pkgGo" style="margin-left:auto">Exportieren</button></div>`);
  let job = null;
  m.querySelector('#pkgCancel').onclick = () => { if (job) TS.cancel(job); closeHcModal(); };
  m.querySelector('#pkgGo').onclick = async () => {
    const spec = packageSpec(proj, m.querySelector('#pkgMedia').checked);
    m.querySelector('#pkgGo').disabled = true;
    const r = await platformCall(id => TS.exportPackage(id, JSON.stringify(spec)));
    if (!r || !r.job){ m.querySelector('#pkgGo').disabled = false; return; }
    job = r.job; m.querySelector('#pkgProg').classList.remove('hidden');
    watchJob(job, j => { m.querySelector('#pkgProg i').style.width = (j.progress * 100).toFixed(1) + '%'; m.querySelector('#pkgMsg').textContent = j.message || 'Projekt wird gepackt …'; },
      j => { const res = j.result || {}; job = null; m.querySelector('#pkgProg i').style.width = '100%';
        m.querySelector('#pkgMsg').textContent = 'Fertig' + (res.path ? ': ' + res.path : '') + (res.bytes ? ` (${fmtMB(res.bytes)})` : '');
        m.querySelector('#pkgGo').classList.add('hidden'); m.querySelector('#pkgCancel').textContent = 'Schließen';
        if (res.path && CAP.platform === 'desktop'){ const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Im Ordner zeigen'; b.onclick = () => TS.share(res.path); m.querySelector('.row').prepend(b); } },
      j => { job = null; m.querySelector('#pkgMsg').textContent = j.status === 'cancelled' ? 'Abgebrochen' : 'Fehler: ' + (j.error || ''); m.querySelector('#pkgGo').disabled = false; });
  };
}
const fmtMB = b => b >= 1e9 ? (b / 1e9).toFixed(1).replace('.', ',') + ' GB' : b >= 1e6 ? Math.round(b / 1e6) + ' MB' : Math.max(1, Math.round(b / 1e3)) + ' KB';
async function importProject(){
  if (!TS.importPackage) return toast('Projekte importieren geht in dieser Version noch nicht');
  const r = await platformCall(id => TS.importPackage(id)); if (!r || !r.job) return;
  const m = hcModal(`<h3>Projekt importieren</h3><div class="progress" id="pkgProg"><i></i></div><div class="small muted" id="pkgMsg">Projekt wird entpackt …</div>
    <div class="row" style="margin-top:12px"><button class="btn" id="pkgCancel" style="margin-left:auto">Abbrechen</button></div>`);
  let job = r.job; m.querySelector('#pkgCancel').onclick = () => { if (job) TS.cancel(job); closeHcModal(); };
  watchJob(job, j => { m.querySelector('#pkgProg i').style.width = (j.progress * 100).toFixed(1) + '%'; if (j.message) m.querySelector('#pkgMsg').textContent = j.message; },
    j => { job = null; finishImport(j.result || {}).catch(e => { console.error(e); m.querySelector('#pkgMsg').textContent = 'Fehler: ' + e.message; }); },
    j => { job = null; m.querySelector('#pkgMsg').textContent = j.status === 'cancelled' ? 'Abgebrochen' : 'Fehler: ' + (j.error || ''); m.querySelector('#pkgCancel').textContent = 'Schließen'; });
}
async function finishImport(res){
  const header = res.header || {}, map = res.map || {}, proj = header.project;
  if (!proj || !proj.id) throw new Error('Im Paket steckt kein Projekt.');
  await loadUserFonts().catch(() => {});
  const hf = header.files || [], info = n => hf.find(f => f.n === n) || {};
  // frühere Fassung desselben Projekts auf diesem Gerät: deren Dateien wiederverwenden
  const old = J(TS.loadProject(proj.id) || 'null');
  const local = [];
  if (old){ const add = x => { if (x && x.uri && !x.uri.startsWith('@hc')) local.push(x); }; (old.sources || []).forEach(add); (old.items || []).forEach(x => add(x.clip)); (old.media || []).forEach(add); }
  const resolved = {}, missing = [];
  const media = n => { if (n in resolved) return resolved[n];
    let u = map[n]; const h = info(n);
    if (!u){ const x = local.find(x => x.name === h.name && Math.abs((+x.duration || 0) - (+h.duration || 0)) < 0.25); if (x) u = x.uri; }
    if (!u){ missing.push(n); u = '@hc:' + n; }
    return resolved[n] = u; };
  const walk = o => { if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === 'object'){ if (typeof o.uri === 'string' && o.uri.startsWith('@hc:')) o.uri = media(o.uri.slice(4)); for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]); } };
  walk(proj);
  for (const sl of proj.slides || []) if (typeof sl.img === 'string' && sl.img.startsWith('@hc:')) sl.img = media(sl.img.slice(4));
  const fk = key => { if (typeof key !== 'string' || !key.startsWith('@hcf:')) return key; const u = map[key.slice(5)]; return u ? 'u' + hashStr(u) : ''; };
  if (proj.sub_style && proj.sub_style.font) proj.sub_style.font = fk(proj.sub_style.font);
  for (const it of proj.items || []) if (it.font) it.font = fk(it.font);
  for (const sp of proj.speakers || []) if (sp.st && sp.st.font) sp.st.font = fk(sp.st.font);
  // fehlende Dateien: auf diesem Gerät auswählen lassen
  if (missing.length) await relinkDialog(proj, missing.map(n => ({n, ...info(n)})));
  if (old){
    const keep = confirm(`„${proj.name}“ gibt es auf diesem Gerät schon (zuletzt bearbeitet ${new Date(old.updated || 0).toLocaleString('de-DE')}).\n\nOK: durch die empfangene Fassung ersetzen\nAbbrechen: als Kopie daneben anlegen`);
    if (!keep){ proj.id = newId(); proj.name += ' (Kopie)'; }
  }
  if (P && P.id === proj.id) closeProject();
  TS.saveProject(proj.id, JSON.stringify(proj));
  closeHcModal(); showHome(); openProject(proj.id);
  toast(`„${proj.name}“ importiert` + (hf.some(f => f.included) ? '' : ' – ohne mitgeschickte Dateien'));
}
// Dateien, die nicht im Paket waren und hier nicht gefunden wurden, selbst auswählen
function relinkDialog(proj, list){
  return new Promise(done => {
    const set = (n, m) => { const walk = o => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === 'object'){ if (o.uri === '@hc:' + n){ o.uri = m.uri; } for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]); } }; walk(proj); };
    const render = () => {
      const open = list.filter(x => !x.done);
      if (!open.length){ done(); return; }
      const m = hcModal(`<h3>Dateien zuordnen</h3><p class="muted small">Diese Dateien waren nicht im Paket und liegen hier noch nicht vor. Wähle sie auf diesem Gerät aus – Name und Länge sollten übereinstimmen.</p>
        <ul class="relink">${open.map(x => `<li><span><b>${esc(x.name)}</b> <span class="muted small">${x.mediaKind === 'image' ? 'Foto' : fmtS(x.duration || 0)}</span></span><button class="btn small" data-n="${x.n}">Auswählen …</button></li>`).join('')}</ul>
        <div class="row" style="margin-top:12px"><button class="btn ghost" id="relSkip" style="margin-left:auto">Ohne diese Dateien öffnen</button></div>`);
      m.querySelector('#relSkip').onclick = () => done();
      m.querySelectorAll('[data-n]').forEach(b => b.onclick = async () => {
        const x = list.find(y => y.n === b.dataset.n), got = await pickMedia('clip'); if (!got) return;
        if (x.duration && got.duration && Math.abs(got.duration - x.duration) > 1 && !confirm(`„${got.name}“ ist ${fmtS(got.duration)} lang, erwartet waren ${fmtS(x.duration)}. Trotzdem nehmen?`)) return;
        set(x.n, got); x.done = true; render();
      });
    };
    render();
  });
}
$('#impProj').onclick = () => importProject();
$('#pkgBtn').onclick = () => { if (P) packageDialog(P.id); };

const fmtD2 = x => x.toFixed(2).replace('.', ',');
function untouched(){
  return !deleted.size && !Object.keys(P.edits || {}).length && !Object.keys(P.trims).length && !Object.keys(P.adj).length && !P.items.length && !P.dels.length && !P.splits.length && !(P.moves || []).length
    && !P.cues.some(c => c.text != null || c.ds || c.de || c.off || c.x != null);
}
// Transkript neu am Ton ausrichten und dabei Wort-Löschungen und Korrekturen übernehmen
function realign(){
  const old = tokens, oldDel = deleted, oldEdits = P.edits || {};
  rebuildTokens();
  deleted = new Set(); P.edits = {}; P.trims = {};
  P.sources.forEach((src, k) => {
    const a = old.filter(t => t.src === k && t.type === 'word'), b = tokens.filter(t => t.src === k && t.type === 'word');
    a.forEach((t, j) => { if (!b[j]) return; if (oldDel.has(t.i)) deleted.add(b[j].i); if (oldEdits[t.i] != null) P.edits[b[j].i] = oldEdits[t.i]; if (t.spk) b[j].spk = t.spk; if (t.ks) b[j].ks = true; });
  });
  if (deleted.size) tidyPauses([...deleted]).forEach(i => deleted.add(i));
  genCues(); renderTranscript(); changed(); saveNow();
}
$('#realignBtn').onclick = () => { if (!tokens.length) return toast('Noch kein Transkript'); realign(); toast('Transkript am Ton ausgerichtet – „Wiederholungen weg“ findet jetzt auch ausgelassene Anläufe'); };
// Tokens aller Quellen aus den Wortzeiten neu aufbauen (nach dem Nachrechnen der Hüllkurve)
function rebuildTokens(){
  const old = tokens; tokens = [];
  P.sources.forEach((src, k) => {
    const words = old.filter(t => t.src === k && t.type === 'word').map(t => ({text:t.text, start:r3(t.ws - src.off), end:r3(t.we - src.off), prob:t.pr}));
    if (!src.tr) return;
    appendSourceTokens(k, words);
  });
  genCues(); renderTranscript();
}

// ───────── Mehrere Fenster: Abgleich über das Desktop-Backend ─────────
const WIN = newId();
let busPid = null, busSeq = -1, busT = null, applyingRemote = false, posSent = {o:-1, at:0};
function busSend(msg){
  if (!CAP.bus || !P) return;
  if (TS.busPost) return TS.busPost(P.id, WIN, JSON.stringify(msg));
  fetch('api/bus?p=' + encodeURIComponent(P.id) + '&from=' + WIN, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(msg)}).catch(() => {});
}
let busGen = 0;
function busStart(){
  if (!CAP.bus || !P || busPid === P.id) return; busPid = P.id; busSeq = -1;
  const pid = P.id, gen = ++busGen;
  if (TS.busListen){ TS.busListen(pid, WIN, m => { if (busPid === pid && gen === busGen) busApply(J(m)); }); return; }
  (async function poll(){
    while (busPid === pid && gen === busGen){
      try {
        const r = await fetch(`api/bus?p=${encodeURIComponent(pid)}&since=${busSeq}&from=${WIN}`); const j = await r.json();
        busSeq = j.seq; for (const m of j.msgs || []) if (busPid === pid) busApply(J(m));
      } catch(_){}
      await new Promise(r => setTimeout(r, 350));
    }
  })();
}
function busApply(m){
  if (!m || !P) return;
  if (m.t === 'state'){ applyingRemote = true; try { restore(m.snap); } finally { applyingRemote = false; } }
  else if (m.t === 'reload'){ openProject(P.id, true); }
  else if (m.t === 'pos'){
    if (m.playing && playing) pausePlay();
    if (!playing && Math.abs(m.o - outPos) > 0.03){ posSent = {o: m.o, at: performance.now()}; seekOut(m.o, false); if (studioOn() && window.syncScroll) syncScroll(m.o, true); }
  }
}
// Abspielposition an die anderen Fenster melden (höchstens alle 200 ms)
(function posLoop(){
  if (CAP.bus && P && Math.abs(outPos - posSent.o) > 0.02 && performance.now() - posSent.at > 200){ posSent = {o: outPos, at: performance.now()}; busSend({t:'pos', o: outPos, playing}); }
  setTimeout(posLoop, 100);
})();

// ───────── Speichern & Rückgängig ─────────
function tokMarks(){ const o = {}; for (const t of tokens) if (t.spk || t.ks) o[t.i] = [t.spk || 0, t.ks ? 1 : 0]; return o; }
function snapshot(){ return JSON.stringify({d:[...deleted], t:P.trims, c:P.cues, i:P.items, a:P.adj, x:P.dels, y:P.splits, s:P.sub_style, e:P.edits, m:P.moves, k:P.speakers, w:tokMarks(), f:P.slides, wm:P.watermark || null, tr:P.trans || null}); }
function restore(s){ const o = JSON.parse(s); deleted = new Set(o.d); P.trims = o.t; P.cues = o.c; P.items = o.i; P.adj = o.a; P.dels = o.x || []; P.splits = o.y || [];
  if (o.s) P.sub_style = o.s; P.edits = o.e || {}; P.moves = o.m || [];
  if (o.f) P.slides = o.f; if (o.k) P.speakers = o.k;
  if ('wm' in o){ if (o.wm) P.watermark = o.wm; else delete P.watermark; } if ('tr' in o){ if (o.tr) P.trans = o.tr; else delete P.trans; } if (o.w){ for (const t of tokens){ const m = o.w[t.i]; if (m){ if (m[0]) t.spk = m[0]; else delete t.spk; if (m[1]) t.ks = true; else delete t.ks; } else { delete t.spk; delete t.ks; } } }
  const reorder = JSON.stringify(P.moves) !== lastOrderKey; syncStyleInputs(); changed(true);
  if (reorder && tokens.length) renderTranscript(); else tokens.forEach(t => paint(t.i)); }
function commit(fn, rerender = true){ undo.push(snapshot()); if (undo.length > 200) undo.shift(); redo = []; fn(); changed(rerender); }
$('#undoBtn').onclick = () => { if (!undo.length || !P) return; redo.push(snapshot()); restore(undo.pop()); };
$('#redoBtn').onclick = () => { if (!redo.length || !P) return; undo.push(snapshot()); restore(redo.pop()); };
function changed(rerender = true){
  recompute(rerender && studioOn() && !!window.renderStudio);   // die Zeitleiste zeichnet renderStudio gleich danach – nicht doppelt
  if (rerender){ if (tab === 'subs') renderSubs(); if (studioOn() && window.renderStudio) renderStudio(); }
  else if (tab === 'subs') updateSubsList();
  cueCache.at = -1; if (!playing) updateSubs(outPos);
  if (tab === 'export') renderExport();
  clearTimeout(saveT); $('#saved').textContent = '…'; saveT = setTimeout(saveNow, 700);
  if (!applyingRemote){ clearTimeout(busT); busT = setTimeout(() => busSend({t:'state', snap: snapshot()}), 120); }
}
function saveNow(){
  if (!P) return; clearTimeout(saveT);
  P.tokens = tokens; P.deleted = [...deleted]; P.updated = Date.now();
  try { TS.saveProject(P.id, JSON.stringify(P)); $('#saved').textContent = '✓'; } catch(e){ $('#saved').textContent = '!'; }
}

// ───────── Wörter → Tokens ─────────
function buildTokens(words, duration, bursts){
  const PAUSE_MIN = 0.45, PARA_GAP = 1.2, PARA_MAX = 55;
  words = alignWithAudio(words, bursts);
  const out = []; let cursor = 0, para = 0, paraWords = 0;
  // Satzzeichen, die als eigenes „Wort“ kommen, an das vorige Wort hängen
  const ws0 = [];
  for (const w of words){
    const text = (w.text || '').trim(); if (!text && !w.unk) continue;
    if (!w.unk && /^[.,!?;:…»«"“”)]+$/.test(text) && ws0.length){ ws0[ws0.length-1].text += text; ws0[ws0.length-1].end = Math.max(ws0[ws0.length-1].end, w.end); continue; }
    ws0.push({...w, text});
  }
  for (const w of ws0){
    let ws = Math.max(w.start, cursor); const we = Math.max(w.end, ws + 0.02); const gap = ws - cursor;
    let newPara = false;
    if (out.length){
      const last = [...out].reverse().find(t => t.type !== 'pause');
      const ends = last && /[.?!…]$/.test(last.text);
      if (gap >= PARA_GAP || (paraWords >= PARA_MAX && ends)) newPara = true;
    }
    let regionStart;
    if (gap >= PAUSE_MIN){ out.push({type:'pause', text:'', s:cursor, e:ws, p:para}); regionStart = ws; }
    else if (out.length){ out[out.length-1].e = ws; regionStart = ws; }
    else regionStart = 0;
    if (newPara){ para++; paraWords = 0; }
    out.push(w.unk ? {type:'unk', text:'', s:regionStart, e:we, ws, we, pr:0, p:para, att: !!w.att} : {type:'word', text:w.text, s:regionStart, e:we, ws, we, pr:+(w.prob ?? 1).toFixed(2), p:para});
    paraWords++; cursor = we;
  }
  if (duration > cursor){
    if (duration - cursor >= PAUSE_MIN || !out.length) out.push({type:'pause', text:'', s:cursor, e:duration, p:para});
    else out[out.length-1].e = duration;
  }
  return out;
}
// Nachgehörte 🗣-Stellen: deren Wörter ersetzen die Stelle (markiert als Anlauf-Text, ug = Gruppe)
function fillGaps(k, gaps, ranges){
  const s = P.sources[k]; let added = 0;
  const list = gaps.map((t, j) => ({t, words: ((ranges[j] || {}).words || []).filter(w => (w.text || '').trim())})).filter(x => x.words.length);
  for (const {t, words} of list.reverse()){
    const dur = t.we - t.ws; if (words.length > dur * 6 + 2) continue;   // zu viele Wörter für die Stelle: vermutlich erfunden
    const ws = words.map(w => clamp(+w.start + s.off, t.ws, t.we)), we = words.map(w => clamp(+w.end + s.off, t.ws, t.we));
    const ug = newId(), news = words.map((w, j) => {
      const a = Math.min(ws[j], we[j] - 0.02), b = Math.max(we[j], a + 0.04);
      const s0 = j ? (we[j-1] + a) / 2 : t.s, e0 = j < words.length - 1 ? (b + ws[j+1]) / 2 : t.e;
      return {type:'word', text: String(w.text).trim(), s: r3(s0), e: r3(Math.max(e0, s0 + 0.02)), ws: r3(a), we: r3(Math.min(b, t.we)), pr: +(w.prob ?? 0.5).toFixed(2), p: t.p, src: t.src, ug, ud: r3(dur), att: !!t.att};
    });
    tokens.splice(t.i, 1, ...news); added += news.length;
    tokens.forEach((x, i) => x.i = i);
  }
  return added;
}
// Transkript einer Quelle an die Tokens anhängen (Zeiten auf der gemeinsamen Zeitachse)
function appendSourceTokens(k, words){
  const s = P.sources[k], base = tokens.length, para0 = tokens.length ? tokens[tokens.length-1].p + 1 : 0;
  srcForAlign = s; const tk = buildTokens(words, s.duration, burstsOf(s));
  tk.forEach((t, j) => { t.s = r3(t.s + s.off); t.e = r3(t.e + s.off); if (t.ws != null){ t.ws = r3(t.ws + s.off); t.we = r3(t.we + s.off); }
    t.p += para0; t.src = k; t.i = base + j; });
  tokens.push(...tk); s.tr = true;
  return base;
}

// ───────── Schnitt & Zeitleiste ─────────
// Schnittkante in die nächste leise Stelle legen. Ist es an der Kante laut, wird die nächste Stelle gesucht,
// die deutlich (20 dB) leiser ist als die Sprache ringsum – bevorzugt in Richtung prefer (−1 links, +1 rechts).
function snapCut(si, t, lo, hi, prefer){
  const db = x => envDb(si, x), lv = x => Math.max(db(x - 0.01), db(x), db(x + 0.01));
  let peak = -90; for (let x = t - 0.5; x <= t + 0.5; x += 0.02) peak = Math.max(peak, db(x));
  const thr = peak - 20, quiet = x => lv(x) <= thr;
  t = clamp(t, lo, hi);
  if (quiet(t)) return t;
  let ql = null, qr = null;
  for (let d = 0.01; d <= 0.25 + 1e-9; d += 0.01){
    if (ql == null && t - d >= lo && quiet(t - d)) ql = t - d;
    if (qr == null && t + d <= hi && quiet(t + d)) qr = t + d;
  }
  const cl = ql == null ? Infinity : (t - ql) * (prefer < 0 ? 0.6 : 1), cr = qr == null ? Infinity : (qr - t) * (prefer > 0 ? 0.6 : 1);
  if (cl === Infinity && cr === Infinity) return t;
  return cl <= cr ? Math.max(lo, ql - 0.01) : Math.min(hi, qr + 0.01);
}
// Anfang: liegt die Kante in einem Sprachabschnitt, der laut Transkript erst nach dem vorigen Wort beginnt,
// wird an den Anfang dieses Abschnitts gegangen (Whisper setzt Wortanfänge oft zu spät).
function snapStart(si, t, lo, hi, prevT){
  const bs = burstsOf(P.sources[si]), off = P.sources[si].off; t = clamp(t, lo, hi);
  const b = bs && bs.find(x => t >= x[0] + off - 0.05 && t < x[1] + off);
  if (b){ const st = b[0] + off - 0.03; if (st >= lo && st >= prevT - 0.08 && t - st < 1.5) return Math.max(lo, st); }
  return snapCut(si, t, lo, hi, -1);
}
function snapEnd(si, t, lo, hi, nextT){
  const bs = burstsOf(P.sources[si]), off = P.sources[si].off; t = clamp(t, lo, hi);
  const b = bs && bs.find(x => t > x[0] + off && t <= x[1] + off + 0.05);
  if (b){ const en = b[1] + off + 0.03; if (en <= hi && en <= nextT + 0.08 && en - t < 1.5) return Math.min(hi, en); }
  return snapCut(si, t, lo, hi, 1);
}
// Auf welcher Seite der Kante liegt laut Transkript Sprache? (−1: Wort beginnt hier → Pause links, +1: Wort endet hier)
function speechSide(key, t, isStart){
  const tk = typeof key === 'number' ? tokens[key] : null; if (!tk) return 0;
  if (tk.type === 'word'){ if (isStart) return -1; return Math.abs(tk.e - tk.we) < 0.002 ? 1 : -1; }
  return isStart ? 1 : -1;
}
function computeRanges(){
  const raw = []; // [s, e, ersterSchlüssel, letzterSchlüssel, quelle]
  const push = (s, e, key, si) => { if (e - s <= 0.0005) return; const l = raw[raw.length-1];
    if (l && l[4] === si && s - l[1] < 0.001){ l[1] = Math.max(l[1], e); l[3] = key; } else raw.push([s, e, key, key, si]); };
  let ti = 0;
  P.sources.forEach((s, k) => {
    const own = [];
    while (ti < tokens.length && tokens[ti].src === k) own.push(tokens[ti++]);
    if (!own.length){ push(s.off, s.off + s.duration, 'u' + k, k); return; }    // noch nicht transkribiert / ohne Ton
    for (const t of own){
      if (deleted.has(t.i)) continue;
      const tr = P.trims[t.i];
      if (t.type === 'pause' && tr != null && tr < t.e - t.s){ const h = tr / 2; push(t.s, t.s + h, t.i, k); push(t.e - h, t.e, t.i, k); }
      else push(t.s, t.e, t.i, k);
    }
  });
  const pad = P.settings.pad || 0, snap = P.settings.snap !== false, out = [], toks = [];
  for (let k = 0; k < raw.length; k++){
    const [rs, re, a, b, si] = raw[k], S0 = P.sources[si].off, S1 = srcEnd(si);
    const prev = out[out.length-1], prevEnd = prev && prev.si === si ? prev.e : S0;
    const nx = raw[k+1], nextStart = nx && nx[4] === si ? nx[0] : S1;
    let s = rs, e = re;
    if (snap && envArr(P.sources[si])){
      const prevT = typeof a === 'number' && a > 0 && tokens[a-1].src === si ? (tokens[a-1].we ?? tokens[a-1].e) : S0;
      const nextT = typeof b === 'number' && b + 1 < tokens.length && tokens[b+1].src === si ? (tokens[b+1].ws ?? tokens[b+1].s) : S1;
      if (rs > S0 + 0.01) s = snapStart(si, rs, prevEnd + 0.01, re - 0.05, prevT);
      if (re < S1 - 0.01) e = snapEnd(si, re, s + 0.05, nextStart - 0.01, nextT);
    } else {
      if (rs > S0) s = rs - Math.min(pad, prev && prev.si === si ? (rs - prevEnd) / 2 : rs - S0);
      if (re < S1) e = re + Math.min(pad, nx && nx[4] === si ? (nextStart - re) / 2 : S1 - re);
    }
    s += P.adj['s' + a] || 0; e += P.adj['e' + b] || 0;    // Feinschnitt
    s = clamp(s, S0, S1); e = clamp(e, S0, S1);
    if (prev && prev.si === si && s - prev.e < 0.02){ prev.e = Math.max(prev.e, e); toks[toks.length-1][1] = b; }
    else if (e - s >= 0.05){ out.push({s, e, si}); toks.push([a, b]); }
  }
  ranges = out.map(r => [r3(r.s), r3(r.e), r.si]); rangeToks = toks;
}
// Freie Schnitte aus dem Studio: gelöschte Bereiche (P.dels) und Teilungspunkte (P.splits)
function normDels(){
  const d = P.dels.filter(x => x[1] - x[0] > 0.005).sort((a, b) => a[0] - b[0]), out = [];
  for (const x of d){ const l = out[out.length-1]; if (l && x[0] <= l[1] + 0.005) l[1] = Math.max(l[1], x[1]); else out.push([x[0], x[1]]); }
  P.dels = out.map(x => [r3(x[0]), r3(x[1])]);
}
const isSrcDeleted = t => P.dels.some(d => t > d[0] + 1e-4 && t < d[1] - 1e-4);
function addDel(a, b){ if (b - a < 0.005) return; P.dels.push([a, b]); normDels(); }
function removeDel(a, b){
  const out = [];
  for (const d of P.dels){ if (b <= d[0] || a >= d[1]){ out.push(d); continue; } if (d[0] < a) out.push([d[0], a]); if (d[1] > b) out.push([b, d[1]]); }
  P.dels = out; normDels();
}
const FX_DEF = {speed:1, vol:1, bright:0, contrast:0, sat:0, gray:false, tx:0, ty:0, sc:1};   // tx/ty/sc: Lage und Größe des Bildes
function fxAt(t){ let r = null; for (const x of P.items){ if (x.type === 'fx' && t >= x.at - 1e-6 && t <= x.at + x.dur + 1e-6) r = x; } return r ? {...FX_DEF, ...r.fx} : {...FX_DEF}; }
const segDur = g => (g.out - g.in) / (g.speed || 1);
function computePieces(){
  normDels();
  const fxCuts = P.items.filter(x => x.type === 'fx').flatMap(x => [x.at, x.at + x.dur]);
  const sp = [...P.splits, ...fxCuts].sort((a, b) => a - b), out = [];
  ranges.forEach(([s, e, si], ri) => {
    let parts = [{s, e, si, L:{k:'adj', key:'s' + rangeToks[ri][0]}, R:{k:'adj', key:'e' + rangeToks[ri][1]}}];
    P.dels.forEach((d, di) => {
      const next = [];
      for (const p of parts){
        if (d[1] <= p.s || d[0] >= p.e){ next.push(p); continue; }
        if (d[0] > p.s) next.push({...p, e:d[0], R:{k:'del', di, side:'start'}});
        if (d[1] < p.e) next.push({...p, s:d[1], L:{k:'del', di, side:'end'}});
      }
      parts = next;
    });
    for (const p of parts){
      let cur = p;
      for (const x of sp){ if (x > cur.s + 0.05 && x < cur.e - 0.05){ const fx = P.splits.includes(x) ? {k:'split', x} : {k:'fx', x}; out.push({...cur, e:x, R:fx}); cur = {...cur, s:x, L:fx}; } }
      if (cur.e - cur.s > 0.03) out.push(cur);
    }
  });
  pieces = out;
}
// ───────── Reihenfolge: verschobene Abschnitte ─────────
// Jede Verschiebung {a, b, to}: alles, dessen Mitte in [a, b) liegt, wandert vor die Stelle „to“ (Quellzeit; null = ans Ende).
function arrange(list, S, E){
  let arr = list.slice();
  for (const mv of P.moves || []){
    const mid = x => (S(x) + E(x)) / 2, inB = x => mid(x) >= mv.a && mid(x) < mv.b;
    const blk = arr.filter(inB); if (!blk.length) continue;
    const rest = arr.filter(x => !inB(x));
    let k = rest.length;
    if (mv.to != null){
      const c = rest.findIndex(x => S(x) <= mv.to + 1e-6 && mv.to < E(x) - 1e-6);
      if (c >= 0) k = mid(rest[c]) < mv.to ? c + 1 : c;
      else { let best = -1; rest.forEach((x, i) => { if (S(x) >= mv.to - 1e-6 && (best < 0 || S(x) < S(rest[best]))) best = i; }); if (best >= 0) k = best; }
    }
    arr = rest.slice(0, k).concat(blk, rest.slice(k));
  }
  return arr;
}
let order = [], pos = [], lastOrderKey = '[]';
function computeOrder(){
  order = (P.moves && P.moves.length ? arrange(tokens, t => t.s, t => t.e) : tokens).map(t => t.i);
  pos = new Array(tokens.length); order.forEach((i, k) => pos[i] = k);
  lastOrderKey = JSON.stringify(P.moves || []);
}

// Anker (Quellzeit) auf die nächste behaltene Stelle schieben
function snapSrc(t){
  for (const p of pieces){ if (t < p.s) return p.s; if (t <= p.e) return t; }
  return pieces.length ? pieces[pieces.length-1].e : 0;
}
function buildTimeline(){
  const ordered = P.moves && P.moves.length ? arrange(pieces, p => p.s, p => p.e) : pieces;
  // Einschübe gehören zu dem Stück (in Quellreihenfolge), in dem ihr Anker liegt
  const ins = P.items.filter(x => x.type === 'insert').map(x => ({x, a: snapSrc(x.at), pc: null})).sort((p, q) => p.a - q.a);
  for (const it of ins) it.pc = pieces.find(p => it.a <= p.e + 1e-6) || null;
  const segs = []; let o = 0;
  const pushIns = it => { const d = Math.max(0.1, it.x.out - it.x.in); segs.push({kind:'insert', item:it.x, uri:it.x.clip.uri, in:it.x.in, out:it.x.in + d, o, speed:1, fx:{...FX_DEF, vol: it.x.vol ?? 1}}); o += d; it.done = true; };
  const pushMain = (si, a, b, L, R) => { const fx = fxAt((a + b) / 2); const g = {kind:'main', si, in:a, out:b, o, L, R, speed:fx.speed || 1, fx}; segs.push(g); o += segDur(g); };
  for (const pc of ordered){
    let s = pc.s; const e = pc.e; let L = pc.L;
    const own = ins.filter(it => it.pc === pc);
    const after = own.filter(it => it.a >= e - 0.001), before = own.filter(it => it.a < e - 0.001);
    for (const it of before){
      if (it.a - s > 0.02){ pushMain(pc.si, s, it.a, L, {k:'ins'}); s = it.a; L = {k:'ins'}; }
      pushIns(it);
    }
    if (e - s > 0.001) pushMain(pc.si, s, e, L, pc.R);
    after.forEach(pushIns);
  }
  ins.filter(it => !it.done).forEach(pushIns);
  timeline = segs; total = o;
}
// Quellzeit → Ausgabezeit (gelöschte Stellen: nächste behaltene Stelle in Quellreihenfolge)
function srcToOut(t){
  let best = null;
  for (const g of timeline){
    if (g.kind !== 'main') continue;
    if (t >= g.in - 1e-6 && t <= g.out + 1e-6) return g.o + clamp(t - g.in, 0, g.out - g.in) / (g.speed || 1);
    if (g.in > t && (!best || g.in < best.in)) best = g;
  }
  return best ? best.o : total;
}
function segAtOut(o){
  let lo = 0, hi = timeline.length - 1;
  while (lo <= hi){ const m = (lo + hi) >> 1, g = timeline[m]; const d = segDur(g);
    if (o < g.o) hi = m - 1; else if (o >= g.o + d) lo = m + 1; else return m; }
  return o >= total ? timeline.length - 1 : 0;
}
// Tonspuren: Musik, Geräusche, Sprachaufnahmen (Elemente vom Typ audio, Spur track)
let audios = [];
function computeAudios(){
  audios = P.items.filter(x => x.type === 'audio').map(x => { const at = srcToOut(snapSrc(x.at)); return {x, at, end: Math.min(total, at + Math.max(0.1, x.out - x.in))}; })
    .filter(o => o.end - o.at > 0.05).sort((a, b) => (a.x.track || 1) - (b.x.track || 1) || a.at - b.at);
}
const audLayers = new Map();
function updateAudio(o){
  for (const [id, el] of audLayers) if (!P.items.some(x => x.id === id)){ releaseMedia(el); audLayers.delete(id); }
  for (const a of audios){
    let el = audLayers.get(a.x.id); const on = o >= a.at && o < a.end, soon = playing && a.at > o && a.at - o < PRELOAD_S;
    if (!on && !soon){ if (el) releaseMedia(el); continue; }
    if (!el){ el = new Audio(); el.preload = 'auto'; audLayers.set(a.x.id, el); }
    const url = MEDIA(a.x.clip.uri); if (el.dataset.src !== url){ el.src = url; el.dataset.src = url; if (soon) try { el.currentTime = a.x.in || 0; } catch(_){} }
    if (!on || !playing){ if (!el.paused) el.pause(); if (!on) continue; }
    setVol(el, a.x.vol ?? 1);
    const target = a.x.in + (o - a.at);
    syncMedia(el, target);
    if (playing && el.paused) el.play().catch(() => {});
  }
}
function computeOverlays(){
  overlays = P.items.filter(x => x.type === 'broll' || x.type === 'pip').map(x => {
    const at = srcToOut(snapSrc(x.at)), d = Math.max(0.1, x.out - x.in);
    return {x, at, end: Math.min(total, at + d)};
  }).filter(o => o.end - o.at > 0.05).sort((a, b) => elTrack(a.x) - elTrack(b.x) || a.at - b.at);
}
function zoomAt(src){
  let s = 1, cx = .5, cy = .5;
  for (const z of P.items){
    if (z.type !== 'zoom' || src < z.at || src > z.at + z.dur) continue;
    const p = clamp((src - z.at) / z.dur, 0, 1), e = p * p * (3 - 2 * p);
    if (z.kind === 'punch') s = z.strength;
    else if (z.kind === 'out') s = z.strength + (1 - z.strength) * e;
    else s = 1 + (z.strength - 1) * e;
    cx = z.cx; cy = z.cy;
  }
  return {s, cx, cy};
}
function recompute(noTL){
  computeRanges(); computePieces(); computeOrder(); buildTimeline(); syncLinks(); computeOverlays(); computeAudios(); drawScrub();
  if (!noTL && studioOn() && window.renderTimeline) renderTimeline();
  $('#tTot').textContent = fmtT(total); $('#sideTot').textContent = fmtT(total);
}
// ───────── Verbundene Objekte ─────────
// Einblendungen, Titel, Zooms, Anpassungen und Untertitel lassen sich verbinden (lk = Gruppe). Ein Mitglied führt (lead),
// die anderen halten ihren Abstand lo (Sekunden im Ergebnis) dazu – egal, was davor geschnitten oder verschoben wird.
const isCueObj = o => !o.type;
function objStart(o){ if (!isCueObj(o)) return srcToOut(snapSrc(o.at)); const t = cueTimes(o); return t ? t.s : null; }
function objSetStart(o, s){
  s = Math.max(0, s);
  if (!isCueObj(o)){ o.at = r3(outToSrcT(s)); return; }
  const t = cueTimes(o); if (t) setCueFree(o, s, s + (t.e - t.s));
}
function groupOf(o){ return !o || !o.lk ? [] : [...P.items.filter(x => x.lk === o.lk), ...P.cues.filter(c => c.lk === o.lk)]; }
function refreshLo(o){
  const ms = groupOf(o); if (ms.length < 2) return; const lead = ms.find(x => x.lead) || ms[0], L = objStart(lead); if (L == null) return;
  ms.forEach(x => { if (x === lead){ x.lead = true; delete x.lo; } else { delete x.lead; const p = objStart(x); if (p != null) x.lo = +(p - L).toFixed(3); } });
}
function relinkGroup(ms){
  const pos = ms.map(objStart); let k = -1; pos.forEach((p, i) => { if (p != null && (k < 0 || p < pos[k])) k = i; }); if (k < 0) return;
  ms.forEach((x, i) => { if (i === k){ x.lead = true; delete x.lo; } else { delete x.lead; if (pos[i] != null) x.lo = +(pos[i] - pos[k]).toFixed(3); } });
}
function groupShift(o, d){ if (!o || !o.lk || Math.abs(d) < 1e-6) return; for (const x of groupOf(o)) if (x !== o){ const p = objStart(x); if (p != null) objSetStart(x, p + d); } }
function syncLinks(){
  const groups = new Map();
  for (const o of [...P.items, ...P.cues]) if (o.lk){ if (!groups.has(o.lk)) groups.set(o.lk, []); groups.get(o.lk).push(o); }
  for (const ms of groups.values()){
    if (ms.length < 2){ ms.forEach(x => { delete x.lk; delete x.lo; delete x.lead; }); continue; }
    const lead = ms.find(x => x.lead); if (!lead){ relinkGroup(ms); continue; }
    const L = objStart(lead); if (L == null) continue;
    for (const x of ms) if (x !== lead && x.lo != null){ const cur = objStart(x), want = L + x.lo; if (cur == null || Math.abs(cur - want) > 0.004) objSetStart(x, want); }
  }
}
function linkObjects(list){
  const all = new Set(); list.forEach(o => { all.add(o); groupOf(o).forEach(x => all.add(x)); });
  const ms = [...all], gid = newId();
  for (const o of ms){ if (isCueObj(o) && !isFree(o)){ const t = cueTimes(o); if (t) setCueFree(o, t.s, t.e); } o.lk = gid; delete o.lead; delete o.lo; }
  relinkGroup(ms); return ms.length;
}
function unlinkObject(o){ const ms = groupOf(o); delete o.lk; delete o.lo; delete o.lead; const rest = ms.filter(x => x !== o); if (rest.length >= 2 && !rest.some(x => x.lead)) relinkGroup(rest); }
function drawScrub(){
  const box = $('#segs'); box.innerHTML = ''; if (!total) return;
  const pct = x => (x / total * 100) + '%';
  for (const g of timeline){ const d = document.createElement('div'); d.className = 's ' + g.kind + (g.kind === 'main' && g.si % 2 ? ' alt' : ''); d.style.left = pct(g.o); d.style.width = `calc(${pct(segDur(g))} - 1px)`; box.append(d); }
  for (const o of overlays){ const d = document.createElement('div'); d.className = 'ovl'; d.style.left = pct(o.at); d.style.width = pct(o.end - o.at); box.append(d); }
  for (const z of P.items.filter(x => x.type === 'zoom')){ const a = srcToOut(snapSrc(z.at)), b = srcToOut(snapSrc(z.at + z.dur)); const d = document.createElement('div'); d.className = 'zm'; d.style.left = pct(a); d.style.width = pct(Math.max(0.2, b - a)); box.append(d); }
}

// ───────── Wiedergabe ─────────
const V = $('#v'), OV = $('#ov'), IV = $('#iv'), OI = $('#oi'), II = $('#ii');
const isImg = c => c && c.kind === 'image';
let imgClock = {local:0, t0:0};
let playing = false, curSeg = 0, outPos = 0, stopAt = null;
// Hauptvideo: welche Quelle gerade geladen ist; solange sie lädt, merkt sich vPending die Zielzeit
let vSi = -1, vPending = null, vWantPlay = false;
// Genauere Zeit als V.currentTime (das nur grob aktualisiert wird): zuletzt gesehene Zeit + verstrichene Zeit
let vClock = {ct:-1, at:0};
function vLocal(){
  if (vPending != null) return vPending;
  const ct = V.currentTime, now = performance.now();
  if (ct !== vClock.ct){ vClock = {ct, at: now}; return ct; }
  return playing && !V.paused && !V.seeking && V.readyState > 2 ? ct + Math.min(0.25, (now - vClock.at) / 1000) * (V.playbackRate || 1) : ct;
}
function vT(){ return vSi < 0 ? 0 : P.sources[vSi].off + vLocal(); }
function setVSrc(si){
  if (vSi === si) return; vSi = si; const s = P.sources[si];
  V.dataset.err = ''; $('#proxyBar').classList.add('hidden');
  V.src = s.proxy ? (TS.mediaUrl ? MEDIA(s.proxy) : 'media?f=' + encodeURIComponent(s.proxy)) : MEDIA(s.uri);
  $('#stage').classList.toggle('audio-only', !hasVid(s));
}
function seekV(si, local, play){
  WD.v = -1; WD.t = performance.now(); WD.n = 0;
  if (vSi !== si){ setVSrc(si); vPending = local; vWantPlay = play; return; }
  if (vPending != null){ vPending = local; vWantPlay = play; return; }
  V.currentTime = local; vClock = {ct:-1, at:0}; if (play) V.play().catch(() => {}); else if (!V.paused) V.pause();
}
V.addEventListener('loadedmetadata', () => {
  if (vPending == null) return; const t = vPending; vPending = null;
  V.currentTime = t; if (vWantPlay && playing) V.play().catch(() => {}); updateZoom();
});
function segLocal(g){
  if (g.kind === 'main') return vT();
  if (isImg(g.item.clip)) return imgClock.local + (playing ? (performance.now() - imgClock.t0) / 1000 : 0);
  return IV.currentTime;
}
function curOut(){ const g = timeline[curSeg]; if (!g) return 0; return g.o + clamp(segLocal(g) - g.in, 0, g.out - g.in) / (g.speed || 1); }
function curSrc(){ const g = timeline[curSeg]; return g && g.kind === 'main' ? vT() : (g ? snapSrc(g.item.at) : 0); }
function seekOut(o, keepPlaying = playing){
  if (!timeline.length) return;
  // Während der Wiedergabe hält niemand außer pausePlay() das Video an: Viele Bearbeitungen frischen die Anzeige mit
  // seekOut(…, false) auf – früher blieb das Video dabei stehen, obwohl die Wiedergabe weiterlief.
  if (playing) keepPlaying = true;
  o = clamp(o, 0, Math.max(0, total - 0.01)); curSeg = segAtOut(o); outPos = o;
  const g = timeline[curSeg], local = g.in + (o - g.o) * (g.speed || 1);
  if (g.kind === 'main'){
    IV.pause(); IV.classList.add('hidden'); II.classList.add('hidden');
    const lv = local - P.sources[g.si].off;
    // läuft schon an dieser Stelle: nicht neu springen (jeder Sprung kostet den Decoder einen Neuaufbau)
    if (!(playing && vSi === g.si && vPending == null && !V.paused && !V.seeking && Math.abs(vLocal() - lv) < 0.2)) seekV(g.si, lv, keepPlaying);
  } else if (isImg(g.item.clip)){
    V.pause(); IV.pause(); IV.classList.add('hidden');
    const url = MEDIA(g.uri); if (II.dataset.src !== url){ II.src = url; II.dataset.src = url; }
    II.classList.remove('hidden'); imgClock = {local, t0: performance.now()};
  } else {
    V.pause(); II.classList.add('hidden');
    const url = MEDIA(g.uri); if (IV.dataset.src !== url){ IV.src = url; IV.dataset.src = url; }
    IV.classList.remove('hidden'); setVol(IV, g.item.vol ?? 1); IV.muted = !(g.item.vol ?? 1);
    if (!(playing && !IV.paused && Math.abs(IV.currentTime - local) < 0.2)) IV.currentTime = local; if (keepPlaying) IV.play().catch(() => {});
  }
  updateOverlay(o); updateZoom(); updateSubs(o); updateTitles(o); updateHead(o);
}
// Nahtloser Übergang: folgt das nächste Stück direkt in derselben Quelle, wird nicht gesprungen
function advanceSeg(){
  const g = timeline[curSeg], n = timeline[curSeg + 1];
  if (!n){ pausePlay(); outPos = total; return; }
  if (g.kind === 'main' && n.kind === 'main' && n.si === g.si && Math.abs(n.in - g.out) < 0.02){ curSeg++; return; }
  seekOut(n.o, true);
}
function setPlayIcons(on){ if (typeof fullPoke === 'function') fullPoke(); for (const b of [$('#playBtn'), $('#sidePlay')]) if (b) b.innerHTML = icon(on ? '❚❚' : '▶'); }
function togglePlay(){ if (V.dataset.err){ toast('Vorschau nicht abspielbar – siehe Hinweis im Bild'); return; } playing ? pausePlay() : startPlay(); }
function startPlay(){
  if (!timeline.length) return; if (outPos >= total - 0.05) seekOut(0, false);
  WD.v = -1; WD.t = performance.now(); WD.n = 0;
  playing = true; if (actx && actx.state === "suspended") actx.resume().catch(() => {}); setPlayIcons(true); seekOut(outPos, true); TS.keepAwake(true);
}
function pausePlay(){
  const g0 = timeline[curSeg]; if (playing && g0 && g0.kind === 'insert' && isImg(g0.item.clip)) imgClock = {local: segLocal(g0), t0: performance.now()};
  playing = false; stopAt = null; vWantPlay = false; V.pause(); IV.pause(); allLayers(el => { if (el.pause) el.pause(); }); for (const el of audLayers.values()) el.pause(); setPlayIcons(false); TS.keepAwake(false);
}
$('#playBtn').onclick = togglePlay;
// Seitensteuerung neben der Bühne
$('#sidePlay').onclick = togglePlay;
$('#sideBack').onclick = () => window.stepFrames && stepFrames(-1);
$('#sideFwd').onclick = () => window.stepFrames && stepFrames(1);
const cutEdges = () => [...new Set(timeline.map(g => r3(g.o)).concat([0, r3(total)]))].sort((a, b) => a - b);
$('#sidePrevCut').onclick = () => { if (playing) pausePlay(); const e = cutEdges().filter(x => x < outPos - 0.05); seekOut(e.length ? e[e.length-1] : 0, false); if (window.syncScroll) syncScroll(outPos, true); };
$('#sideNextCut').onclick = () => { if (playing) pausePlay(); const e = cutEdges().find(x => x > outPos + 0.05); seekOut(e != null ? e : total, false); if (window.syncScroll) syncScroll(outPos, true); };
$('#sideUndo').onclick = () => $('#undoBtn').click();
$('#sideRedo').onclick = () => $('#redoBtn').click();
$('#sideSplit').onclick = () => { if (window.splitHere) splitHere(); };
$('#sideCutPlay').onclick = () => $('#cutPlayBtn').click();
$('#sideSubs').onclick = () => { if (!P) return; const on = S().enabled === false; S().enabled = on; syncStyleInputs(); changed(false); toast(on ? 'Untertitel an' : 'Untertitel aus'); window.slSyncAll && slSyncAll(); };
$('#sideFont').onclick = () => { if (P) openFontSheet(); };
// Wächter beim Abspielen: Steht das Bild trotz „Abspielen“ still (abgebrochenes play(), hängender Ladevorgang),
// erst erneut starten, dann die Quelle an derselben Stelle neu laden – ohne dass das Programm neu gestartet werden muss.
// Hilft ein erneutes play() nicht, wird an derselben Stelle neu gesprungen – genau das, was „Pause und wieder Abspielen“
// von Hand bewirkt (der Decoder wird neu aufgesetzt). Erst wenn auch das dreimal nicht hilft, wird die Quelle neu geladen.
function playWatch(){
  const now = performance.now(), ct = V.currentTime;
  if (Math.abs(ct - WD.v) > 0.02){ WD.v = ct; WD.t = now; WD.n = 0; return; }   // kleine Sprünge stammen vom Wächter selbst
  if (V.seeking && now - WD.t < 5000) return;   // Sprung läuft noch (bei langen GOPs dauert das)
  if (V.paused && now - WD.t > 250 && WD.n === 0){ WD.n = 1; WD.t = now; V.play().catch(() => {}); return; }
  if (now - WD.t < 800) return;
  WD.t = now; WD.n++;
  if (WD.n === 1){ V.play().catch(() => {}); return; }
  if (WD.n <= 3){ try { V.currentTime = ct + 0.001; } catch(_){} vClock = {ct:-1, at:0}; V.play().catch(() => {}); return; }
  const si = vSi; if (si < 0) return; WD.n = 0; vSi = -1; seekV(si, ct, true);
}
function loop(){
  if (P && timeline.length && playing){
    const g = timeline[curSeg], el = g.kind === 'main' ? V : (isImg(g.item.clip) ? null : IV);
    if (g.kind === 'main' && vSi !== g.si) seekV(g.si, g.in - P.sources[g.si].off, true);
    if (segLocal(g) >= g.out - 0.012 || (el && el.ended && vPending == null)) advanceSeg();
    if (g.kind === 'main' && vPending == null) playWatch();
    else if (el === IV && IV.paused && !IV.ended) IV.play().catch(() => {});
    if (playing){
      outPos = curOut();
      if (stopAt != null && outPos >= stopAt) pausePlay();
      updateOverlay(outPos); updateZoom(); updateSubs(outPos); updateTitles(outPos); updateHead(outPos); highlightNow();
    }
  }
  if (keyLayers.size || vKey || (P && timeline.length && mainKeyOf(timeline[curSeg]))) drawKeyFrames();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
function updateHead(o){ $('#head').style.left = (total ? o / total * 100 : 0) + '%'; $('#tNow').textContent = fmtT(o); $('#sideNow').textContent = fmtS(o); }
// ───────── Elemente auf den Videospuren (Spur 1, 2, …; die Hauptspur ist 0) ─────────
// Jedes Element kann frei liegen: Mittelpunkt x/y und Breite w (Anteil des Bildes), Seitenverhältnis des Clips.
// Keyframes kf = [{t, x, y, w}] (t in Sekunden ab Beginn des Elements) bewegen es über die Zeit.
const elTrack = it => it.track || 1;
const clipAspect = c => { const r = (c.rotation || 0) % 180 !== 0, w = r ? c.height : c.width, h = r ? c.width : c.height; return w > 0 && h > 0 ? w / h : 16 / 9; };
const PIP_M = 0.03;
// Zuschnitt eines Elements: crop = {l, t, r, b} (Anteile, die links/oben/rechts/unten wegfallen)
const cropOf = it => { const c = it && it.crop; return c ? {l: c.l || 0, t: c.t || 0, r: c.r || 0, b: c.b || 0} : {l: 0, t: 0, r: 0, b: 0}; };
const hasCrop = it => { const c = cropOf(it); return c.l + c.t + c.r + c.b > 0.0005; };
const elAspect = it => { const c = cropOf(it); return clipAspect(it.clip) * Math.max(0.02, 1 - c.l - c.r) / Math.max(0.02, 1 - c.t - c.b); };
const lerp = (a, b, f) => a + (b - a) * f;
function kfAt(kf, rel){
  const n = kf.length; if (rel <= kf[0].t) return kf[0]; if (rel >= kf[n-1].t) return kf[n-1];
  for (let i = 0; i < n - 1; i++){ const a = kf[i], b = kf[i+1]; if (rel < b.t){ const f = (rel - a.t) / Math.max(1e-6, b.t - a.t); return {x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), w: lerp(a.w, b.w, f)}; } }
  return kf[n-1];
}
// Werte zum Zeitpunkt rel; null = Vollbild (B-Roll füllt das Bild)
function elVals(it, rel){
  if (it.kf && it.kf.length) return kfAt(it.kf, rel);
  if (it.w != null) return {x: it.x, y: it.y, w: it.w};
  if (it.type === 'pip'){ const [W, H] = outSize(), r = pipRect(it, W, H); return {x: r.cx / W, y: r.cy / H, w: r.w / W, legacy: r}; }
  return null;
}
function coverVals(it){ const [W, H] = outSize(), a = elAspect(it); return {x: 0.5, y: 0.5, w: Math.max(1, H * a / W)}; }
function pipRect(it, W, H){   // ältere Projekte: feste Ecke, Größe als Anteil beider Seiten
  const sz = it.size || 0.33, pw = sz * W, ph = sz * H, m = PIP_M * W, c = it.corner || 'or';
  return {cx: c[1] === 'l' ? m + pw / 2 : W - m - pw / 2, cy: c[0] === 'o' ? m + ph / 2 : H - m - ph / 2, w: pw, h: ph};
}
// Rechteck in Pixeln (Bühne W×H) oder null für Vollbild
function elRect(it, v, W, H){
  if (!v) return null;
  if (v.legacy && it.w == null && !(it.kf && it.kf.length)){ const r = pipRect(it, W, H); return r; }
  const pw = v.w * W; return {cx: v.x * W, cy: v.y * H, w: pw, h: pw / elAspect(it)};
}
// Element auf freie Lage umstellen (Vollbild/alte Ecke → x/y/w)
function pipFree(it){ if (it.w != null) return; const v = elVals(it, 0) || coverVals(it); it.w = r3(v.w); it.x = r3(v.x); it.y = r3(v.y);
  if (v.legacy){ const [W, H] = outSize(), ph = it.w * W / elAspect(it), c = it.corner || 'or', m = PIP_M * W; it.y = r3((c[0] === 'o' ? m + ph / 2 : H - m - ph / 2) / H); } }
// Werte setzen: mit Keyframes an der Stelle rel (neu oder vorhandener), sonst fest
function setElVals(it, rel, v){
  // Grenzen nach Größe: Ein Element darf so weit aus dem Bild ragen, dass nur noch ein schmaler Rand sichtbar ist –
  // auch sehr hohe Bilder (Screenshots, Grafiken) lassen sich so weit schieben, dass nur ihr oberer oder unterer Teil zu sehen ist.
  const [W, H] = outSize(), w = clamp(v.w, 0.03, 20), hh = w * W / elAspect(it) / H, m = 0.04;
  v = {x: r3(clamp(v.x, m - w / 2, 1 - m + w / 2)), y: r3(clamp(v.y, m - hh / 2, 1 - m + hh / 2)), w: r3(w)};
  if (it.kf && it.kf.length){
    const tol = 0.5 / (primary().fps || 30), k = it.kf.find(k => Math.abs(k.t - rel) <= tol);
    if (k) Object.assign(k, v); else { it.kf.push({t: r3(rel), ...v}); it.kf.sort((a, b) => a.t - b.t); }
  } else { pipFree(it); Object.assign(it, v); }
}
function pipCorner(it, c){
  const v0 = elVals(it, curRel(it)) || coverVals(it); const [W, H] = outSize(), pw = v0.w * W, ph = pw / elAspect(it), m = PIP_M * W;
  const v = {w: v0.w, x: c === 'mm' ? 0.5 : (c[1] === 'l' ? m + pw / 2 : W - m - pw / 2) / W, y: c === 'mm' ? 0.5 : (c[0] === 'o' ? m + ph / 2 : H - m - ph / 2) / H};
  setElVals(it, curRel(it), v); if (c !== 'mm') it.corner = c;
}
const ovOf = it => overlays.find(o => o.x === it);
function curRel(it){ const a = ovOf(it); return a ? clamp(outPos - a.at, 0, a.end - a.at) : 0; }
// Keyframe an der Abspiellinie setzen bzw. entfernen
function toggleKeyframe(it){
  const a = ovOf(it); if (!a) return toast('Das Element liegt nicht an der Abspiellinie');
  const rel = outPos - a.at; if (rel < -0.01 || rel > a.end - a.at + 0.01) return toast('Abspiellinie auf das Element setzen');
  const tol = 0.5 / (primary().fps || 30); let added = false;
  commit(() => {
    const kf = it.kf || [], k = kf.find(k => Math.abs(k.t - rel) <= tol);
    if (k){ it.kf = kf.filter(x => x !== k); if (!it.kf.length) delete it.kf; return; }
    const v = elVals(it, rel) || coverVals(it); pipFree(it);
    it.kf = [...kf, {t: r3(clamp(rel, 0, a.end - a.at)), x: r3(v.x), y: r3(v.y), w: r3(v.w)}].sort((p, q) => p.t - q.t); added = true;
  }, false);
  toast(added ? `Keyframe gesetzt (${(it.kf || []).length}) – Element jetzt an einer anderen Stelle verschieben oder skalieren` : 'Keyframe entfernt');
  if (window.renderTimeline) renderTimeline(); seekOut(outPos, false);
}
// Vorschau: eine Ebene (video/img) je Element, übereinander nach Spur
const layers = new Map();
function layerFor(it){
  const img = isImg(it.clip); let el = layers.get(it.id);
  if (el && (el.tagName === 'IMG') !== img){ el.remove(); el = null; }
  if (!el){ el = document.createElement(img ? 'img' : 'video'); el.className = 'ovl-layer hidden'; el.alt = '';
    if (!img){ el.playsInline = true; el.preload = 'auto'; el.muted = true; }
    $('#stage').insertBefore(el, $('#subOv')); layers.set(it.id, el); }
  return el;
}
function allLayers(fn){ for (const el of layers.values()) fn(el); }
// ── Freistellen (Farbschlüssel) in der Vorschau: eine WebGL-Leinwand je freigestelltem Element, das Medienelement selbst wird unsichtbar ──
const keyOn = k => !!(k && k.on !== false && k.colors && k.colors.length);
const keyLayers = new Map();   // Element-ID → ChromaGL
function syncKeyLayer(el, it){
  let kl = keyLayers.get(it.id);
  if (!keyOn(it.key) || !window.ChromaGL){ if (kl){ kl.canvas.remove(); kl.destroy(); keyLayers.delete(it.id); el.style.opacity = ''; } return; }
  if (!kl){ try { kl = ChromaGL.create(2, 2); } catch(_){ kl = null; } if (!kl) return; keyLayers.set(it.id, kl); }
  if (kl.canvas.previousSibling !== el) el.after(kl.canvas);
  kl.canvas.className = el.className + ' key'; kl.canvas.style.cssText = el.style.cssText; kl.canvas.style.opacity = '';
  drawKeyLayer(el, it, kl);
}
function drawKeyLayer(el, it, kl){
  const w = el.videoWidth || el.naturalWidth, h = el.videoHeight || el.naturalHeight;
  let ok = false;
  if (w && h && !(el.complete === false)){ const s = Math.min(1, 960 / Math.max(w, h)); ok = kl.draw(el, it.key, Math.round(w * s), Math.round(h * s)) !== false && !kl.gl.isContextLost(); }
  // Nur ausblenden, wenn das freigestellte Bild wirklich gezeichnet wurde – sonst bleibt das Original sichtbar
  el.style.opacity = ok ? '0' : ''; kl.canvas.style.visibility = ok ? '' : 'hidden';
}
function hideKeyLayer(id){ const kl = keyLayers.get(id); if (kl) kl.canvas.classList.add('hidden'); }
function dropKeyLayer(id){ const kl = keyLayers.get(id); if (kl){ kl.canvas.remove(); kl.destroy(); keyLayers.delete(id); } }
// Hauptbild: Leinwand über dem Video mit derselben Lage (Transformation wird je Bild übernommen)
let vKey = null;
function mainKeyOf(g){ const it = g && g.kind === 'main' ? fxItemOf(g) : null; const k = it && it.fx && it.fx.key; return keyOn(k) ? k : null; }
function syncMainKey(){
  const g = timeline[curSeg], k = mainKeyOf(g);
  if (!k || !window.ChromaGL){ if (vKey){ vKey.canvas.remove(); vKey.destroy(); vKey = null; V.style.opacity = ''; } return; }
  if (!vKey){ try { vKey = ChromaGL.create(2, 2); } catch(_){ vKey = null; } if (!vKey) return; vKey.canvas.className = 'vkey'; V.after(vKey.canvas); }
  vKey.canvas.style.transform = V.style.transform; vKey.canvas.style.transformOrigin = '50% 50%'; vKey.canvas.style.filter = V.style.filter;
  const w = V.videoWidth, h = V.videoHeight; let ok = false;
  if (w && h){ const s = Math.min(1, 1280 / Math.max(w, h)); ok = vKey.draw(V, k, Math.round(w * s), Math.round(h * s)) !== false && !vKey.gl.isContextLost(); }
  V.style.opacity = ok ? '0' : ''; vKey.canvas.style.visibility = ok ? '' : 'hidden';
}
function drawKeyFrames(){
  for (const [id, kl] of keyLayers){ const el = layers.get(id), it = P && P.items.find(x => x.id === id); if (!el || !it || el.classList.contains('hidden')) continue; if (!keyOn(it.key)){ dropKeyLayer(id); el.style.opacity = ''; continue; } drawKeyLayer(el, it, kl); }
  if (vKey || (P && timeline.length && mainKeyOf(timeline[curSeg]))) syncMainKey();
}
// Schlüsselfarbe im Bild wählen: nächstes Tippen auf die Bühne liest die Farbe dort
let keyPick = null;
function startKeyPick(fn){ keyPick = fn; $('#stageHint').textContent = 'Ins Bild tippen oder klicken: Die Farbe an dieser Stelle wird entfernt'; $('#stageHint').classList.remove('hidden'); }
function endKeyPick(){ keyPick = null; $('#stageHint').classList.add('hidden'); }
// Punkt auf der Bühne → Anteil im Medienelement (Vollbild/eingepasst, frei platziert oder das Hauptbild samt Transformation)
function stageFrac(el, px, py, cover){
  const st = $('#stage'), R = st.getBoundingClientRect(), W = R.width, H = R.height;
  const vw = el.videoWidth || el.naturalWidth || 16, vh = el.videoHeight || el.naturalHeight || 9;
  if (el === V){ let q = {x: px - R.left, y: py - R.top};
    try { const m = new DOMMatrix(getComputedStyle(V).transform).inverse(); const d = m.transformPoint(new DOMPoint(q.x - W / 2, q.y - H / 2)); q = {x: d.x + W / 2, y: d.y + H / 2}; } catch(_){}
    const sc = Math.min(W / vw, H / vh), fw = vw * sc, fh = vh * sc; return [(q.x - (W - fw) / 2) / fw, (q.y - (H - fh) / 2) / fh]; }
  const r = el.getBoundingClientRect();
  if (!cover) return [(px - r.left) / r.width, (py - r.top) / r.height];
  const sc = Math.max(r.width / vw, r.height / vh), fw = vw * sc, fh = vh * sc; return [(px - r.left - (r.width - fw) / 2) / fw, (py - r.top - (r.height - fh) / 2) / fh];
}
let keyPickAte = false;
$('#stage').addEventListener('pointerdown', e => {
  if (!keyPick) return; e.preventDefault(); e.stopPropagation(); keyPickAte = true;
  const fn = keyPick; endKeyPick();
  const it = fn.it, el = it ? layers.get(it.id) : V; if (!el) return;
  const [fx, fy] = stageFrac(el, e.clientX, e.clientY, it ? !el.classList.contains('free') : false);
  const col = ChromaGL.sample(el, clamp(fx, 0, 1), clamp(fy, 0, 1)); if (col) fn(col); else toast('Hier ließ sich keine Farbe lesen');
}, true);
$('#stage').addEventListener('click', e => { if (keyPickAte){ keyPickAte = false; e.stopImmediatePropagation(); e.preventDefault(); } }, true);
// ── Großansicht zum Farbwählen: aktuelles Bild bildschirmfüllend, mit Lupe, Zoom (zwei Finger / Mausrad) und Vorschau ──
function openKeyPicker(src, api){
  const iw = src.videoWidth || src.naturalWidth, ih = src.videoHeight || src.naturalHeight;
  if (!iw || !ih) return toast('Das Bild ist noch nicht geladen – kurz warten und nochmal');
  if (playing) pausePlay(); if (src.pause) try { src.pause(); } catch(_){}
  const f = Math.min(1, 2048 / Math.max(iw, ih)), W = Math.max(2, Math.round(iw * f)), H = Math.max(2, Math.round(ih * f));
  const base = document.createElement('canvas'); base.width = W; base.height = H; base.className = 'kp-img';
  const bx = base.getContext('2d', {willReadFrequently: true});
  try { bx.drawImage(src, 0, 0, W, H); bx.getImageData(0, 0, 1, 1); } catch(_){ return toast('Dieses Bild lässt sich nicht auslesen'); }
  const m = document.createElement('div'); m.className = 'kp'; m.innerHTML = `
    <div class="kp-top"><b>Farbe wählen</b><span class="muted small kp-hint">${FINE ? 'Klicken wählt die Farbe · Mausrad zoomt' : 'Tippen und halten zeigt die Lupe, loslassen wählt · zwei Finger zoomen'}</span>
      <label class="kp-prev"><input type="checkbox"> Ergebnis zeigen</label><button class="btn primary kp-ok" type="button">Fertig</button></div>
    <div class="kp-view"><div class="kp-stage"></div><div class="kp-loupe hidden"><canvas width="132" height="132"></canvas><span></span></div></div>
    <div class="kp-bot"><div class="keycols kp-cols"></div>
      <div class="kp-sl"><label>Toleranz <b class="kp-tolv"></b><input type="range" class="kp-tol" min="0.02" max="0.8" step="0.01"></label>
      <label>Weicher Rand <b class="kp-softv"></b><input type="range" class="kp-soft" min="0" max="0.5" step="0.01"></label></div></div>`;
  document.body.append(m);
  const q = x => m.querySelector(x), stage = q('.kp-stage'), view = q('.kp-view'), loupe = q('.kp-loupe'), lc = loupe.querySelector('canvas'), lx = lc.getContext('2d');
  stage.append(base);
  let kgl = null; try { kgl = ChromaGL.create(W, H); } catch(_){} if (kgl){ kgl.canvas.className = 'kp-key hidden'; stage.append(kgl.canvas); }
  // Zoom/Verschiebung der Ansicht
  const Z = {s: 1, x: 0, y: 0};
  const fit = () => { const r = view.getBoundingClientRect(), k = Math.min(r.width / W, r.height / H); stage.style.width = W * k + 'px'; stage.style.height = H * k + 'px'; apply(); };
  const apply = () => { stage.style.transform = `translate(${Z.x}px, ${Z.y}px) scale(${Z.s})`; };
  const preview = () => q('.kp-prev input').checked;
  const redraw = () => { const k = api.get(); const on = preview() && kgl && k && k.colors && k.colors.length;
    if (on) kgl.draw(base, {...k, bg: null}, W, H);
    base.classList.toggle('hidden', !!on); if (kgl) kgl.canvas.classList.toggle('hidden', !on);
    const ks = k || {colors: [], tol: KEY_DEF.tol, soft: KEY_DEF.soft};
    q('.kp-cols').innerHTML = (ks.colors || []).map((c, i) => `<span class="keychip" style="background:${c}" title="${c}"><button type="button" data-i="${i}" title="Farbe entfernen">×</button></span>`).join('') || '<span class="muted small">Noch keine Farbe gewählt</span>';
    q('.kp-tol').value = ks.tol; q('.kp-tolv').textContent = Math.round(ks.tol * 100) + ' %'; q('.kp-soft').value = ks.soft; q('.kp-softv').textContent = Math.round(ks.soft * 100) + ' %'; };
  // Bildpunkt unter dem Finger/Mauszeiger
  const at = (cx, cy) => { const r = base.classList.contains('hidden') && kgl ? kgl.canvas.getBoundingClientRect() : base.getBoundingClientRect();
    return {x: clamp((cx - r.left) / r.width * W, 0, W - 1), y: clamp((cy - r.top) / r.height * H, 0, H - 1)}; };
  const colorAt = p => { const x0 = Math.max(0, Math.round(p.x) - 1), y0 = Math.max(0, Math.round(p.y) - 1), d = bx.getImageData(x0, y0, Math.min(3, W - x0), Math.min(3, H - y0)).data;
    let r = 0, g = 0, b = 0; const n = d.length / 4; for (let i = 0; i < d.length; i += 4){ r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    return '#' + [r / n, g / n, b / n].map(v => Math.round(v).toString(16).padStart(2, '0')).join(''); };
  const showLoupe = (cx, cy) => { const p = at(cx, cy), vr = view.getBoundingClientRect(), z = 9, half = 66 / z;
    lx.imageSmoothingEnabled = false; lx.clearRect(0, 0, 132, 132); lx.drawImage(base, p.x - half, p.y - half, half * 2, half * 2, 0, 0, 132, 132);
    lx.strokeStyle = '#fff'; lx.lineWidth = 2; lx.strokeRect(66 - z / 2 - 1, 66 - z / 2 - 1, z + 2, z + 2); lx.strokeStyle = '#000'; lx.lineWidth = 1; lx.strokeRect(66 - z / 2 - 2.5, 66 - z / 2 - 2.5, z + 5, z + 5);
    const col = colorAt(p); loupe.querySelector('span').style.background = col; loupe.querySelector('span').textContent = col;
    const lyTop = cy - vr.top - 170; loupe.style.left = clamp(cx - vr.left - 70, 4, vr.width - 144) + 'px'; loupe.style.top = (lyTop < 4 ? cy - vr.top + 40 : lyTop) + 'px';
    loupe.classList.remove('hidden'); return col; };
  const pick = col => { api.addColor(col); redraw(); toast('Farbe ' + col + ' wird entfernt'); };
  // Bedienung: Maus – Klick wählt, Bewegen zeigt die Lupe; Touch – halten/ziehen zeigt die Lupe, loslassen wählt; zwei Finger zoomen
  let T = null;
  view.addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && !T) showLoupe(e.clientX, e.clientY); });
  view.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') loupe.classList.add('hidden'); });
  view.addEventListener('click', e => { if (e.pointerType === 'mouse' || (e.detail && FINE)) pick(colorAt(at(e.clientX, e.clientY))); });
  view.addEventListener('wheel', e => { e.preventDefault(); const r = view.getBoundingClientRect(), mx = e.clientX - r.left - r.width / 2, my = e.clientY - r.top - r.height / 2, f2 = e.deltaY < 0 ? 1.15 : 1 / 1.15, s2 = clamp(Z.s * f2, 1, 12);
    Z.x = mx - (mx - Z.x) * s2 / Z.s; Z.y = my - (my - Z.y) * s2 / Z.s; Z.s = s2; if (Z.s === 1){ Z.x = 0; Z.y = 0; } apply(); }, {passive: false});
  const tp = e => { const a = e.touches[0], b = e.touches[1]; return b ? {d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2} : {x: a.clientX, y: a.clientY}; };
  view.addEventListener('touchstart', e => { e.preventDefault(); const p = tp(e);
    if (e.touches.length >= 2){ loupe.classList.add('hidden'); const r = view.getBoundingClientRect(); T = {pinch: true, d0: Math.max(10, p.d), s0: Z.s, x0: Z.x, y0: Z.y, cx: p.x - r.left - r.width / 2, cy: p.y - r.top - r.height / 2, mx: p.x, my: p.y}; }
    else { T = {pinch: false, x: p.x, y: p.y}; showLoupe(p.x, p.y); } }, {passive: false});
  view.addEventListener('touchmove', e => { e.preventDefault(); if (!T) return; const p = tp(e);
    if (T.pinch && e.touches.length >= 2){ const s2 = clamp(T.s0 * p.d / T.d0, 1, 12); Z.s = s2; Z.x = T.cx - (T.cx - T.x0) * s2 / T.s0 + (p.x - T.mx); Z.y = T.cy - (T.cy - T.y0) * s2 / T.s0 + (p.y - T.my); if (s2 === 1){ Z.x = 0; Z.y = 0; } apply(); }
    else if (!T.pinch){ T.x = p.x; T.y = p.y; showLoupe(p.x, p.y); } }, {passive: false});
  view.addEventListener('touchend', e => { e.preventDefault(); if (!T) return;
    if (!T.pinch){ loupe.classList.add('hidden'); pick(colorAt(at(T.x, T.y))); T = null; }
    else if (!e.touches.length) T = null; }, {passive: false});
  q('.kp-cols').onclick = e => { const b = e.target.closest('button'); if (!b) return; api.removeColor(+b.dataset.i); redraw(); };
  q('.kp-prev input').onchange = redraw;
  for (const [cls, prop] of [['.kp-tol', 'tol'], ['.kp-soft', 'soft']]){ const r = q(cls);
    r.onpointerdown = () => api.liveStart(); r.oninput = () => { api.live(prop, +r.value); if (!q('.kp-prev input').checked){ q('.kp-prev input').checked = true; } redraw(); }; r.onchange = () => api.liveEnd(); }
  const close = () => { removeEventListener('resize', fit); if (kgl) kgl.destroy(); m.remove(); api.done(); };
  q('.kp-ok').onclick = close;
  addEventListener('resize', fit); requestAnimationFrame(fit); redraw();
}
// Bedienblock „Freistellen“ – für Einblendungen (it) und das Hauptbild (main, mit Hintergrundfarbe)
const KEY_DEF = {on: true, colors: [], tol: 0.22, soft: 0.08, spill: true};
function keyBlock(host, o){
  const main = !!o.main;
  host.insertAdjacentHTML('beforeend', `<div class="field keyblk">
    <label class="row"><input type="checkbox" class="keyOn"> Freistellen (Greenscreen)</label>
    <div class="keybody hidden">
      <div class="keycols"></div>
      <div class="row wrap"><button class="btn keyPick" type="button">◎ Farbe im Bild wählen (groß)</button><label class="btn keyAddL">+ Farbe<input type="color" class="keyAdd" value="#00ff00"></label></div>
      <div class="field"><span>Toleranz <b class="keyTolV"></b></span><input type="range" class="keyTol" min="0.02" max="0.8" step="0.01"></div>
      <div class="field"><span>Weicher Rand <b class="keySoftV"></b></span><input type="range" class="keySoft" min="0" max="0.5" step="0.01"></div>
      <label class="row"><input type="checkbox" class="keySpill"> Farbsaum zurücknehmen</label>
      ${main ? `<div class="field"><span>Hintergrundfarbe</span><input type="color" class="keyBg" value="#000000"></div><p class="muted small">Bild oder Video als Hintergrund: das Foto auf Spur 1 legen, das Video darüber als Vollbild-Einblendung und dort freistellen.</p>` : ''}
    </div>
    ${CAP.matte && o.uri ? `<div class="keyauto"><div class="row wrap"><button class="btn keyAuto" type="button">✦ Hintergrund automatisch erkennen</button><button class="btn keyOrig hidden" type="button">Original zurück</button><button class="btn keyStop hidden" type="button">Abbrechen</button></div>
      <p class="muted small keyAutoHint">Ohne Greenscreen: Die Person wird erkannt, alles andere ersetzt. Erzeugt einmalig eine Kopie des Videos – das dauert je nach Länge einige Minuten.</p>
      <div class="keyProg hidden"><div class="prog"><i></i></div><span class="muted small"></span></div></div>` : ''}
    </div>`);
  const blk = host.lastElementChild, q = s => blk.querySelector(s);
  const cur = () => o.get();
  const paint = () => { const k = cur(), on = !!(k && k.on !== false); q('.keyOn').checked = on; q('.keybody').classList.toggle('hidden', !on); if (!k) return;
    q('.keycols').innerHTML = k.colors.map((c, i) => `<span class="keychip" style="background:${c}" title="${c}"><button type="button" data-i="${i}" title="Farbe entfernen">×</button></span>`).join('') || '<span class="muted small">Noch keine Farbe – im Bild wählen</span>';
    q('.keyTol').value = k.tol; q('.keyTolV').textContent = Math.round(k.tol * 100) + ' %'; q('.keySoft').value = k.soft; q('.keySoftV').textContent = Math.round(k.soft * 100) + ' %'; q('.keySpill').checked = !!k.spill; if (main) q('.keyBg').value = k.bg || '#000000'; };
  const refresh = () => { seekOut(outPos, false); drawKeyFrames(); };
  const change = (fn, live) => { let k = cur(); if (!k){ k = {...KEY_DEF, colors: []}; if (main) k.bg = '#000000'; } fn(k); o.set(k); paint(); if (!live) changed(false); refresh(); };
  const edit = fn => { const b = snapshot(); change(fn); undo.push(b); if (undo.length > 200) undo.shift(); redo = []; };
  const addColor = col => edit(k => { if (!k.colors.includes(col)) k.colors = [...k.colors, col].slice(-4); k.on = true; });
  const picker = () => { const el = o.el(); if (!el) return toast('Das Element ist gerade nicht im Bild – Abspiellinie darauf setzen');
    let lb = null;
    openKeyPicker(el, {get: cur, addColor, removeColor: i => edit(k => { k.colors.splice(i, 1); }),
      liveStart: () => { lb = snapshot(); }, live: (prop, v) => change(k => { k[prop] = v; }, true),
      liveEnd: () => { if (lb){ undo.push(lb); redo = []; lb = null; } changed(false); }, done: () => { paint(); refresh(); }}); };
  q('.keyOn').onchange = () => { const on = q('.keyOn').checked; edit(k => { k.on = on; }); if (on && !(cur().colors || []).length) picker(); };
  q('.keycols').onclick = e => { const b = e.target.closest('button'); if (!b) return; e.stopPropagation(); edit(k => { k.colors.splice(+b.dataset.i, 1); if (!k.colors.length) k.on = false; }); };
  q('.keyPick').onclick = e => { e.stopPropagation(); picker(); };
  q('.keyAdd').onchange = e => { e.stopPropagation(); const col = q('.keyAdd').value; edit(k => { if (!k.colors.includes(col)) k.colors = [...k.colors, col].slice(-4); k.on = true; }); };
  for (const [cls, prop] of [['.keyTol', 'tol'], ['.keySoft', 'soft']]){ const r = q(cls);
    r.onpointerdown = () => { r._b = snapshot(); }; r.oninput = () => change(k => { k[prop] = +r.value; }, true);
    r.onchange = () => { if (r._b){ undo.push(r._b); redo = []; r._b = null; } changed(false); }; }
  q('.keySpill').onchange = () => edit(k => { k.spill = q('.keySpill').checked; });
  if (main){ const bg = q('.keyBg'); bg.oninput = () => change(k => { k.bg = bg.value; }, true); bg.onchange = () => edit(k => { k.bg = bg.value; }); }
  // Automatisch: Person erkennen, Kopie mit grünem Hintergrund erzeugen, dann wie Greenscreen freistellen
  const auto = q('.keyAuto');
  if (auto){
    const paintAuto = () => { const has = !!o.hasOrig(); q('.keyOrig').classList.toggle('hidden', !has); auto.textContent = has ? '✦ Erneut erkennen' : '✦ Hintergrund automatisch erkennen'; };
    auto.onclick = e => { e.stopPropagation(); const uri = o.uri(); if (!uri) return;
      auto.disabled = true; q('.keyStop').classList.remove('hidden'); q('.keyProg').classList.remove('hidden'); q('.keyProg span').textContent = 'Wird vorbereitet …';
      let jid; try { jid = TS.autoMatte(uri); } catch(err){ toast('Freistellen nicht möglich: ' + err.message); auto.disabled = false; return; }
      q('.keyStop').onclick = ev => { ev.stopPropagation(); TS.cancel(jid); };
      const end = () => { auto.disabled = false; q('.keyStop').classList.add('hidden'); q('.keyProg').classList.add('hidden'); };
      watchJob(jid, j => { q('.keyProg i').style.width = Math.round((j.progress || 0) * 100) + '%'; q('.keyProg span').textContent = j.message || ''; },
        j => { end(); const m = j.result; if (!m || !m.uri){ toast('Freistellen hat nichts ergeben'); return; }
          o.applyMatte(m); change(k => { k.on = true; k.colors = [MATTE_KEY]; k.tol = 0.3; k.soft = 0.05; k.spill = true; }); paintAuto(); toast('Hintergrund erkannt – Feinheiten über Toleranz und weichen Rand'); },
        j => { end(); if (j.status !== 'cancelled') toast('Freistellen fehlgeschlagen: ' + (j.error || '')); }); };
    q('.keyOrig').onclick = e => { e.stopPropagation(); o.restoreOrig(); change(k => { k.on = false; }); paintAuto(); };
    paintAuto();
  }
  blk.addEventListener('click', e => { if (e.target.closest('button')) e.stopPropagation(); });
  paint(); return {paint};
}
const MATTE_KEY = '#00ff00';   // Schlüsselfarbe der automatisch freigestellten Kopien (alle Plattformen)
// Quelle der Hauptspur gegen die freigestellte Kopie tauschen (Transkript, Schnitt und Lautstärkeverlauf bleiben)
function swapSource(si, m){
  const s = P.sources[si]; if (!s) return;
  if (!s.orig) s.orig = s.uri; s.uri = m.uri; delete s.proxy; s.matte = true;
  if (vSi === si) vSi = -1;
  changed(true); seekOut(outPos, false); if (window.renderTimeline) renderTimeline();
}
function restoreSource(si){ const s = P.sources[si]; if (!s || !s.orig) return; s.uri = s.orig; delete s.orig; delete s.proxy; delete s.matte; if (vSi === si) vSi = -1; changed(true); seekOut(outPos, false); if (window.renderTimeline) renderTimeline(); }
// Einblendung: Clip gegen die freigestellte Kopie tauschen und die Kopie in die Ablage legen
function swapClip(it, m){
  const old = it.clip; P.media ||= [];
  const clip = {...old, uri: m.uri, name: m.name || old.name, kind: 'video', duration: m.duration || old.duration, width: m.width || old.width, height: m.height || old.height, fps: m.fps || old.fps, hasAudio: m.hasAudio != null ? m.hasAudio : old.hasAudio, hasVideo: true, rotation: 0, orig: old.orig || old.uri};
  delete clip.proxy;
  it.clip = clip; if (!P.media.some(x => x.uri === clip.uri)) P.media.push(clone(clip));
  const el = layers.get(it.id); if (el) releaseMedia(el);
  changed(true); seekOut(outPos, false); if (window.renderBin) renderBin();
}
function restoreClip(it){ const c = it.clip; if (!c || !c.orig) return; const m = mediaList().find(x => x.m.uri === c.orig); it.clip = m ? clone(m.m) : {...c, uri: c.orig}; delete it.clip.orig; const el = layers.get(it.id); if (el) releaseMedia(el); changed(true); seekOut(outPos, false); }
// Medienelement freigeben: Ohne das hält der Browser Decoder und Verbindung offen – bei vielen Einblendungen
// reichen dann die Verbindungen nicht mehr und das Abspielen hängt nach dem Springen.
function releaseMedia(el){ if (!el || !el.dataset.src) return; try { el.pause(); } catch(_){} el.removeAttribute('src'); delete el.dataset.src; if (el.load) try { el.load(); } catch(_){} }
const PRELOAD_S = 2.5;   // so viele Sekunden vorher wird eine Einblendung geladen
let curPip = null, pipTarget = null, layerOrder = '';
function selOvlId(){ return typeof TL !== 'undefined' && TL.sel && (TL.sel.kind === 'ovl') ? TL.sel.id : null; }
// ── Wasserzeichen: ein Bild, das über die ganze Länge im Bild liegt (P.watermark), ohne eigene Spur ──
// pos: o/m/u (oben/mitte/unten) + l/m/r; size und margin als Anteil der kürzeren Bildseite, op = Deckkraft
const WM_DEF = {pos: 'or', size: 0.16, margin: 0.035, op: 0.85, on: true};
const wmOn = () => !!(P && P.watermark && P.watermark.on !== false && P.watermark.clip);
function wmRect(W, H){
  const w = {...WM_DEF, ...P.watermark}, mn = Math.min(W, H), a = clipAspect(w.clip), lw = w.size * mn, lh = lw / a, m = w.margin * mn, p = w.pos || 'or';
  const cx = p[1] === 'l' ? m + lw / 2 : p[1] === 'r' ? W - m - lw / 2 : W / 2, cy = p[0] === 'o' ? m + lh / 2 : p[0] === 'u' ? H - m - lh / 2 : H / 2;
  return {cx, cy, w: lw, h: lh};
}
function placeWatermark(W, H){
  const el = $('#wm'); if (!wmOn()){ if (!el.classList.contains('hidden')) el.classList.add('hidden'); return; }
  const url = MEDIA(P.watermark.clip.uri); if (el.dataset.src !== url){ el.src = url; el.dataset.src = url; }
  const r = wmRect(W, H);
  Object.assign(el.style, {left: (r.cx - r.w / 2) + 'px', top: (r.cy - r.h / 2) + 'px', width: r.w + 'px', height: r.h + 'px', opacity: String(P.watermark.op ?? WM_DEF.op)});
  el.classList.remove('hidden');
}
function wmPlan(W, H){
  if (!wmOn() || !(total > 0)) return [];
  const w = P.watermark, r = wmRect(W, H);
  return [{mode: 'pip', image: true, uri: w.clip.uri, in: 0, out: r3(total), at: 0, x: r3(r.cx / W), y: r3(r.cy / H), w: +(r.w / W).toFixed(4), aspect: +clipAspect(w.clip).toFixed(5),
    track: 99, vol: 0, hasAudio: false, width: w.clip.width, height: w.clip.height, rotation: 0, opacity: +(+(w.op ?? WM_DEF.op)).toFixed(3), watermark: true}];
}
// Einblendung/Ton an die Zeitleiste angleichen. Beim Abspielen wird nur selten gesprungen (höchstens alle 1,5 s und nie,
// solange der letzte Sprung noch läuft); kleine Abweichungen holt die Abspielgeschwindigkeit sanft auf. Früher wurde bei
// jeder Abweichung über 0,3 s sofort neu gesprungen – lag ein Clip etwas zurück, sprang er Bild für Bild neu, kam nie
// ins Laufen und band dabei den Decoder so stark, dass auch das Hauptvideo stehen blieb.
function syncMedia(el, target){
  const d = el.currentTime - target, now = performance.now();
  if (!playing){ if (Math.abs(d) > 0.05 && !el.seeking) try { el.currentTime = target; } catch(_){} if (el.playbackRate !== 1) el.playbackRate = 1; return; }
  if (el.seeking) return;
  if (Math.abs(d) > 0.5){ if (now - (el._seekAt || 0) > 1500){ el._seekAt = now; try { el.currentTime = target + 0.08; } catch(_){} el.playbackRate = 1; } return; }
  const r = Math.abs(d) > 0.05 ? clamp(1 - d * 0.6, 0.85, 1.15) : 1;
  if (Math.abs(el.playbackRate - r) > 0.02) el.playbackRate = r;
}
function updateOverlay(o){
  const st = $('#stage'), W = st.clientWidth, H = st.clientHeight;
  const act = overlays.filter(x => o >= x.at && o < x.end);
  const on = new Set(act.map(a => a.x.id));
  const soon = new Set(playing ? overlays.filter(x => x.at > o && x.at - o < PRELOAD_S).map(x => x.x.id) : []);
  for (const [id, el] of layers){ if (!P.items.some(x => x.id === id)){ releaseMedia(el); el.remove(); layers.delete(id); dropKeyLayer(id); continue; }
    if (!on.has(id) && !el.classList.contains('hidden')){ if (el.pause) el.pause(); el.classList.add('hidden'); hideKeyLayer(id); }
    if (!on.has(id) && !soon.has(id) && el.tagName === 'VIDEO') releaseMedia(el); }
  for (const id of soon) if (!on.has(id)){ const x = overlays.find(q => q.x.id === id).x; if (isImg(x.clip)) continue;   // gleich dran: schon laden
    const el = layerFor(x), url = MEDIA(x.clip.uri); if (el.dataset.src !== url){ el.src = url; el.dataset.src = url; try { el.currentTime = x.in || 0; } catch(_){} } }
  // Reihenfolge im DOM = Stapel (untere Spur zuerst)
  const order = act.map(a => a.x.id).join(',');
  if (order !== layerOrder){ layerOrder = order; act.forEach(a => $('#stage').insertBefore(layerFor(a.x), $('#pipBox'))); }
  act.forEach((a, k) => {
    const it = a.x, el = layerFor(it), url = MEDIA(it.clip.uri);
    if (el.dataset.src !== url){ el.src = url; el.dataset.src = url; }
    el.classList.remove('hidden');
    const v = PipDrag.on && PipDrag.it === it ? PipDrag : elVals(it, o - a.at), r = elRect(it, v, W, H) || (hasCrop(it) || Crop.it === it ? elRect(it, coverVals(it), W, H) : null);
    placeLayer(el, it, r); syncKeyLayer(el, it);
    if (el.tagName !== 'VIDEO') return;
    const vol = it.vol || 0; el.muted = !(vol > 0) || !playing; setVol(el, vol);
    syncMedia(el, it.in + (o - a.at));
    if (playing && el.paused) el.play().catch(() => {}); if (!playing && !el.paused) el.pause();
  });
  updateAudio(o); placeWatermark(W, H);
  // Griffe: am ausgewählten Element, sonst am obersten
  const sel = selOvlId(), mainSel = typeof TL !== 'undefined' && TL.sel && TL.sel.kind === 'main', tgt = act.find(a => a.x.id === sel) || (mainSel ? null : act[act.length - 1]) || null;   // Hauptclip ausgewählt: Rahmen am Hauptbild
  curPip = tgt ? tgt.x : null; pipTarget = tgt;
  placeBox(W, H);
}
// Ebene setzen: r = sichtbares (zugeschnittenes) Rechteck; die Datei selbst liegt größer dahinter und wird per clip-path beschnitten
function placeLayer(el, it, r){
  el.classList.toggle('free', !!r);
  if (!r){ Object.assign(el.style, {left: '', top: '', width: '', height: '', clipPath: ''}); return; }
  const c = cropOf(it), fw = r.w / Math.max(0.02, 1 - c.l - c.r), fh = r.h / Math.max(0.02, 1 - c.t - c.b);
  const cut = Crop.it === it ? null : c;   // beim Zuschneiden ganze Datei zeigen
  Object.assign(el.style, {left: (r.cx - r.w / 2 - c.l * fw) + 'px', top: (r.cy - r.h / 2 - c.t * fh) + 'px', width: fw + 'px', height: fh + 'px',
    clipPath: cut && hasCrop(it) ? `inset(${(cut.t * 100).toFixed(3)}% ${(cut.r * 100).toFixed(3)}% ${(cut.b * 100).toFixed(3)}% ${(cut.l * 100).toFixed(3)}%)` : ''});
}
// Rahmen mit Griffen: Einblendung, sonst (Hauptspur-Clip ausgewählt) das Hauptbild
function placeBox(W, H){
  const box = $('#pipBox');
  if (!W){ const st = $('#stage'); W = st.clientWidth; H = st.clientHeight; }
  let r = null;
  if (curPip){ const it = curPip, v = PipDrag.on && PipDrag.it === it ? PipDrag : elVals(it, outPos - pipTarget.at);
    r = elRect(it, v, W, H); if (!r){ const c = coverVals(it); r = {cx: W / 2, cy: H / 2, w: c.w * W, h: c.w * W / elAspect(it)}; } }
  else if (mainBoxOn()){ const f = frameFx(PipDrag.on && PipDrag.main ? {tx: PipDrag.tx, ty: PipDrag.ty, sc: PipDrag.sc} : mainFx()), [wf, hf] = mainFit();
    r = {cx: (0.5 + f.tx) * W, cy: (0.5 + f.ty) * H, w: f.sc * W * wf, h: f.sc * H * hf}; }
  if (Crop.it) r = null;
  box.classList.toggle('hidden', !r); box.classList.toggle('main', !curPip && !!r);
  box.classList.toggle('sel', !!r && (curPip ? selOvlId() === curPip.id : true)); box.classList.toggle('playing', !!playing);
  if (Crop.it) placeCrop(W, H);
  if (r) Object.assign(box.style, {left: (r.cx - r.w / 2) + 'px', top: (r.cy - r.h / 2) + 'px', width: r.w + 'px', height: r.h + 'px'});
}
// Hauptspur: Lage und Größe des ausgewählten Clips (in einer Anpassung gespeichert)
const mainBoxOn = () => !!(typeof TL !== 'undefined' && TL.sel && TL.sel.kind === 'main' && timeline[TL.sel.i] && studioOn());
const mainFit = () => { const g = typeof TL !== 'undefined' && TL.sel && timeline[TL.sel.i]; return fitFracOf(g && g.kind === 'main' ? P.sources[g.si] : null); };
// ── Keyframes auf der Hauptspur: Lage und Größe des Hauptbilds über die Zeit ──
// fx.kf = [{t, tx, ty, sc}], t in Sekunden der Quelle ab Beginn der Anpassung (it.at). Ohne Keyframes gelten fx.tx/ty/sc fest.
const fxItemOf = g => g ? (P.items.find(x => x.type === 'fx' && x.at <= g.in + 0.01 && x.at + x.dur >= g.out - 0.01) || null) : null;
function mkfAt(kf, rel){
  const n = kf.length, V = k => ({tx: k.tx || 0, ty: k.ty || 0, sc: k.sc || 1});
  if (rel <= kf[0].t) return V(kf[0]); if (rel >= kf[n-1].t) return V(kf[n-1]);
  for (let i = 0; i < n - 1; i++){ const a = kf[i], b = kf[i+1]; if (rel < b.t){ const f = (rel - a.t) / Math.max(1e-6, b.t - a.t), A = V(a), B = V(b); return {tx: lerp(A.tx, B.tx, f), ty: lerp(A.ty, B.ty, f), sc: lerp(A.sc, B.sc, f)}; } }
  return V(kf[n-1]);
}
const mainKf = g => { const it = fxItemOf(g); return it && it.fx && it.fx.kf && it.fx.kf.length ? it.fx.kf : null; };
function mainFxAt(g, srcT){
  const kf = mainKf(g); if (kf) return mkfAt(kf, srcT - fxItemOf(g).at);
  const f = (g && g.fx) || FX_DEF; return {tx: f.tx || 0, ty: f.ty || 0, sc: f.sc || 1};
}
function mainFx(){ const g = typeof TL !== 'undefined' && TL.sel && timeline[TL.sel.i]; return g && g.kind === 'main' ? mainFxAt(g, outToSrcT(outPos)) : {tx: 0, ty: 0, sc: 1}; }
// Werte setzen: mit Keyframes an der Abspiellinie (neu oder vorhandener), sonst fest
// Anpassung so erweitern, dass sie die Quellzeit src einschließt (Keyframes dürfen über mehrere Abschnitte reichen)
function fxCover(it, src){ const end = it.at + it.dur; if (src < it.at){ const d = it.at - src; it.at = r3(src); it.dur = r3(it.dur + d); if (it.fx.kf) it.fx.kf.forEach(k => k.t = r3(k.t + d)); } if (src > end) it.dur = r3(src - it.at); }
function setMainVals(g, v){
  const it = mainFxItem(g); v = {tx: r3(v.tx || 0), ty: r3(v.ty || 0), sc: r3(clamp(v.sc || 1, 0.05, 20))};
  const kf = it.fx.kf;
  if (kf && kf.length){ const src = outToSrcT(outPos); fxCover(it, src); const rel = r3(src - it.at), tol = 0.5 / (primary().fps || 30), k = kf.find(k => Math.abs(k.t - rel) <= tol);
    if (k) Object.assign(k, v); else { kf.push({t: rel, ...v}); kf.sort((a, b) => a.t - b.t); } }
  else Object.assign(it.fx, v);
}
const hasMainKfHere = g => { const kf = mainKf(g); if (!kf) return false; const rel = outToSrcT(outPos) - fxItemOf(g).at, tol = 0.5 / (primary().fps || 30); return kf.some(k => Math.abs(k.t - rel) <= tol); };
function toggleMainKeyframe(g){
  if (!g || g.kind !== 'main') return toast('Erst einen Clip der Hauptspur auswählen');
  const gp = timeline[segAtOut(outPos)];   // Abschnitt unter der Abspiellinie – Keyframes dürfen über die Abschnitte einer Anpassung reichen
  if (!gp || gp.kind !== 'main' || gp.si !== g.si) return toast('Abspiellinie auf einen Clip dieses Videos setzen');
  const src = outToSrcT(outPos);
  let added = false, n = 0;
  commit(() => {
    const it = fxItemOf(g) || mainFxItem(gp); it.fx = {...FX_DEF, ...(it.fx || {})}; fxCover(it, gp.in); fxCover(it, gp.out); fxCover(it, src);
    const rel = r3(src - it.at), tol = 0.5 / (primary().fps || 30), kf = it.fx.kf || [], k = kf.find(k => Math.abs(k.t - rel) <= tol);
    if (k){ it.fx.kf = kf.filter(x => x !== k); if (!it.fx.kf.length) delete it.fx.kf; n = (it.fx.kf || []).length; return; }
    const v = mainFxAt(g, src); it.fx.kf = [...kf, {t: rel, tx: r3(v.tx), ty: r3(v.ty), sc: r3(v.sc)}].sort((a, b) => a.t - b.t); added = true; n = it.fx.kf.length;
  }, false);
  toast(added ? `Keyframe gesetzt (${n}) – Abspiellinie weiterschieben und das Hauptbild dort anders setzen` : 'Keyframe entfernt');
  if (window.renderTimeline) renderTimeline(); seekOut(outPos, false);
}
function mainFxItem(g){
  let it = P.items.find(x => x.type === 'fx' && x.at <= g.in + 0.01 && x.at + x.dur >= g.out - 0.01);
  if (!it){ it = {id:newId(), type:'fx', at:r3(g.in), dur:r3(g.out - g.in), fx:{...FX_DEF}}; P.items.push(it); }
  it.fx = {...FX_DEF, ...(it.fx || {})}; return it;
}
// ───────── Zuschneiden (wie in CapCut): ganze Datei zeigen, Ausschnitt mit Griffen wählen ─────────
// Während des Zuschneidens bleibt das Element, wie es ist; erst „Fertig“ übernimmt den Ausschnitt.
// Der gewählte Ausschnitt bleibt dabei genau an seiner Stelle im Bild – das Element wird entsprechend verkleinert/verschoben.
const Crop = {it:null, cur:null, ratio:null};
function fullRect(it, W, H){   // ganze Datei (ohne Zuschnitt) in Pixeln der Bühne
  const a = ovOf(it), v = (a ? elVals(it, clamp(outPos - a.at, 0, a.end - a.at)) : null) || coverVals(it), r = elRect(it, v, W, H) || elRect(it, coverVals(it), W, H), c = cropOf(it);
  const fw = r.w / Math.max(0.02, 1 - c.l - c.r), fh = r.h / Math.max(0.02, 1 - c.t - c.b);
  return {x: r.cx - r.w / 2 - c.l * fw, y: r.cy - r.h / 2 - c.t * fh, w: fw, h: fh};
}
function startCrop(it){
  if (!it || !(it.type === 'broll' || it.type === 'pip')) return toast('Zuschneiden geht bei Bildern und Videos auf den Videospuren');
  const a = ovOf(it); if (!a) return;
  if (playing) pausePlay();
  if (outPos < a.at || outPos >= a.end) seekOut(a.at + Math.min(0.05, (a.end - a.at) / 2), false);
  Crop.it = it; Crop.cur = cropOf(it); Crop.ratio = null; Crop.before = snapshot();
  $('#cropBox').classList.remove('hidden'); updateOverlay(outPos);
  if (window.updateTools) updateTools();
  toast('Ausschnitt mit den Griffen wählen, innen ziehen verschiebt ihn – dann „Fertig“');
}
function placeCrop(W, H){
  if (!W){ const st = $('#stage'); W = st.clientWidth; H = st.clientHeight; }
  const it = Crop.it, box = $('#cropBox'); if (!it || !ovOf(it)){ box.classList.add('hidden'); return; }
  const F = fullRect(it, W, H), c = Crop.cur; Crop.F = F;
  Object.assign(box.style, {left: F.x + 'px', top: F.y + 'px', width: F.w + 'px', height: F.h + 'px'});
  Object.assign($('#cropWin').style, {left: c.l * 100 + '%', top: c.t * 100 + '%', width: (1 - c.l - c.r) * 100 + '%', height: (1 - c.t - c.b) * 100 + '%'});
  box.classList.toggle('locked', !!Crop.ratio);
}
// Ausschnitt mit festem Seitenverhältnis (Bildschirm-Verhältnis) um die Mitte des aktuellen Ausschnitts
function cropRatio(ratio){
  Crop.ratio = ratio; const it = Crop.it; if (!it) return;
  if (ratio == null){ placeCrop(); return; }
  const c = Crop.cur, fa = clipAspect(it.clip), cx = (c.l + 1 - c.r) / 2, cy = (c.t + 1 - c.b) / 2;
  // Breite/Höhe als Anteil der Datei: (cw * fa) / ch = ratio
  let cw = 1 - c.l - c.r, ch = cw * fa / ratio; if (ch > 1){ ch = 1; cw = ratio / fa; } if (cw > 1){ cw = 1; ch = fa / ratio; }
  const l = clamp(cx - cw / 2, 0, 1 - cw), t = clamp(cy - ch / 2, 0, 1 - ch);
  Crop.cur = {l, t, r: 1 - l - cw, b: 1 - t - ch}; placeCrop();
}
function endCrop(apply){
  const it = Crop.it; if (!it) return; const n = Crop.cur;
  Crop.it = null; $('#cropBox').classList.add('hidden');
  if (apply){
    const o = cropOf(it), same = ['l', 't', 'r', 'b'].every(k => Math.abs(o[k] - n[k]) < 0.0005);
    if (!same){
      undo.push(Crop.before); if (undo.length > 200) undo.shift(); redo = [];
      pipFree(it);
      const [W, H] = outSize(), fa = clipAspect(it.clip);
      const conv = v => {   // Werte mit altem Zuschnitt → Werte mit neuem, ganze Datei bleibt an ihrem Platz
        const fw = v.w / Math.max(0.02, 1 - o.l - o.r), fhn = fw * W / fa / H;   // Datei-Breite/-Höhe als Anteil von W/H
        const h0 = v.w * W / elAspect(it) / H, fx = v.x - v.w / 2 - o.l * fw, fy = v.y - h0 / 2 - o.t * fhn;
        const cw = Math.max(0.02, 1 - n.l - n.r), ch = Math.max(0.02, 1 - n.t - n.b);
        return {x: r3(fx + (n.l + cw / 2) * fw), y: r3(fy + (n.t + ch / 2) * fhn), w: r3(fw * cw)};
      };
      const nv = conv({x: it.x, y: it.y, w: it.w}), nk = (it.kf || []).map(k => ({...k, ...conv(k)}));
      Object.assign(it, nv); if (it.kf) it.kf = nk;
      if (n.l + n.t + n.r + n.b > 0.0005) it.crop = {l: r3(n.l), t: r3(n.t), r: r3(n.r), b: r3(n.b)}; else delete it.crop;
      changed(true); toast('Zugeschnitten');
    }
  }
  seekOut(outPos, false); if (window.updateTools) updateTools();
}
function resetCrop(){ if (Crop.it){ Crop.cur = {l:0, t:0, r:0, b:0}; Crop.ratio = null; placeCrop(); } }
(() => {
  const box = $('#cropBox'); let g = null;
  box.addEventListener('pointerdown', e => {
    if (!Crop.it) return; e.preventDefault(); e.stopPropagation(); box.setPointerCapture(e.pointerId);
    const h = e.target.dataset && e.target.dataset.h; g = {h: h || (e.target.closest('#cropWin') ? 'move' : null), x0: e.clientX, y0: e.clientY, c0: {...Crop.cur}};
    if (!g.h) g = null;
  });
  box.addEventListener('pointermove', e => {
    if (!g || !Crop.F) return; const F = Crop.F, dx = (e.clientX - g.x0) / F.w, dy = (e.clientY - g.y0) / F.h, c0 = g.c0, m = 0.02;
    let {l, t, r, b} = c0;
    if (g.h === 'move'){ const w = 1 - l - r, hh = 1 - t - b; l = clamp(c0.l + dx, 0, 1 - w); t = clamp(c0.t + dy, 0, 1 - hh); r = 1 - l - w; b = 1 - t - hh; }
    else if (Crop.ratio){   // Ecke mit festem Verhältnis: gegenüberliegende Ecke bleibt
      const fa = clipAspect(Crop.it.clip), west = g.h.includes('w'), north = g.h.includes('n');
      let cw = clamp((1 - c0.l - c0.r) + (west ? -dx : dx), 0.05, 1), ch = cw * fa / Crop.ratio;
      const maxW = west ? 1 - c0.r : 1 - c0.l, maxH = north ? 1 - c0.b : 1 - c0.t;
      if (cw > maxW){ cw = maxW; ch = cw * fa / Crop.ratio; } if (ch > maxH){ ch = maxH; cw = ch * Crop.ratio / fa; }
      if (west) l = 1 - c0.r - cw; else r = 1 - c0.l - cw;
      if (north) t = 1 - c0.b - ch; else b = 1 - c0.t - ch;
    } else {
      if (g.h.includes('w')) l = clamp(c0.l + dx, 0, 1 - c0.r - m);
      if (g.h.includes('e')) r = clamp(c0.r - dx, 0, 1 - c0.l - m);
      if (g.h.includes('n')) t = clamp(c0.t + dy, 0, 1 - c0.b - m);
      if (g.h.includes('s')) b = clamp(c0.b - dy, 0, 1 - c0.t - m);
    }
    Crop.cur = {l, t, r, b}; placeCrop();
  });
  const up = () => { g = null; }; box.addEventListener('pointerup', up); box.addEventListener('pointercancel', up);
  box.addEventListener('click', e => e.stopPropagation());
  box.addEventListener('dblclick', e => { e.stopPropagation(); endCrop(true); });
})();
const PipDrag = {on:false};
$('#pipBox').addEventListener('pointerdown', e => {
  if (!curPip && !mainBoxOn()) return; e.preventDefault(); e.stopPropagation(); $('#pipBox').setPointerCapture(e.pointerId);
  if (playing) pausePlay(); if (PipDrag.pinchT) return;
  const st = $('#stage').getBoundingClientRect(), W = st.width, H = st.height, mode = e.target.classList.contains('pip-h') ? 'size' : 'move';
  if (!curPip){ const f = mainFx(); Object.assign(PipDrag, {on:true, main:true, it:null, moved:false, mode, x0:e.clientX, y0:e.clientY, stx:f.tx, sty:f.ty, ssc:f.sc, tx:f.tx, ty:f.ty, sc:f.sc}); return; }
  const it = curPip, rel = outPos - pipTarget.at, v = elVals(it, rel) || coverVals(it), r = elRect(it, v, W, H) || {cx: W / 2, cy: H / 2, w: v.w * W, h: v.w * W / elAspect(it)};
  Object.assign(PipDrag, {on:true, main:false, moved:false, it, rel, mode, x0:e.clientX, y0:e.clientY,
    sx: r.cx / W, sy: r.cy / H, sw: r.w / W, left: r.cx - r.w / 2, top: r.cy - r.h / 2, x: r.cx / W, y: r.cy / H, w: r.w / W, clip: it.clip});
});
$('#pipBox').addEventListener('pointermove', e => {
  const g = PipDrag; if (!g.on || g.pinchT) return; const st = $('#stage').getBoundingClientRect(), W = st.width, H = st.height;
  const dx = e.clientX - g.x0, dy = e.clientY - g.y0; if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true;
  if (g.main){
    if (g.mode === 'move'){ let tx = g.stx + dx / W, ty = g.sty + dy / H; if (Math.abs(tx) < 0.015) tx = 0; if (Math.abs(ty) < 0.015) ty = 0; g.tx = tx; g.ty = ty; }
    else { const s0 = g.ssc, [wf, hf] = mainFit(), F0 = (P.frame && P.frame.sc) || 1, bw = s0 * F0 * W * wf / 2, bh = s0 * F0 * H * hf / 2;
      const f = Math.max((bw + dx) / bw, (bh + dy) / bh); g.sc = clamp(s0 * f, 0.05, 20); if (Math.abs(g.sc - 1) < 0.02) g.sc = 1; }
    applyMainTransform(); placeBox(W, H); return;
  }
  if (g.mode === 'move'){ let x = g.sx + dx / W, y = g.sy + dy / H; const hw = g.w / 2, hh = g.w * W / elAspect(g.it) / H / 2;
    if (Math.abs(x - 0.5) < 0.02) x = 0.5; if (Math.abs(y - 0.5) < 0.02) y = 0.5;
    // Kanten rasten am Bildrand ein (z. B. Oberkante eines hohen Bildes genau oben)
    for (const e of [0, 1]){ if (Math.abs(x - hw - e) < 0.015) x = e + hw; else if (Math.abs(x + hw - e) < 0.015) x = e - hw; if (Math.abs(y - hh - e) < 0.015) y = e + hh; else if (Math.abs(y + hh - e) < 0.015) y = e - hh; }
    x = clamp(x, 0.04 - hw, 0.96 + hw); y = clamp(y, 0.04 - hh, 0.96 + hh); g.x = x; g.y = y; }
  else { const a = elAspect(g.it); let pw = Math.max(dx + g.sw * W, W * 0.03, (dy + g.sw * W / a) * a); pw = Math.min(pw, W * 20);
    g.w = pw / W; g.x = (g.left + pw / 2) / W; g.y = (g.top + pw / a / 2) / H; }
  $('#stage').classList.toggle('snap-x', g.mode === 'move' && g.x === 0.5);
  updateOverlay(outPos);
});
function endPipDrag(){
  const g = PipDrag; if (!g.on || g.pinchT) return; g.on = false; $('#stage').classList.remove('snap-x');
  if (!g.moved){ if (g.main) applyMainTransform(); else togglePlay(); return; }
  if (g.main){ const sg = timeline[TL.sel.i];
    commit(() => setMainVals(sg, {tx: g.tx, ty: g.ty, sc: g.sc}), false);
    seekOut(outPos, false); if (window.renderTimeline && mainKf(sg)) renderTimeline(); toast(`Hauptbild: ${Math.round(g.sc * 100)} %` + (mainKf(sg) ? ' · Keyframe' : '')); return; }
  const it = g.it; commit(() => setElVals(it, g.rel, {x: g.x, y: g.y, w: g.w}), false);
  seekOut(outPos, false); if (sheetItem === it) paintItem();
  toast(`Größe ${Math.round(g.w * 100)} % der Bildbreite` + (it.kf && it.kf.length ? ' · Keyframe' : ''));
}
// Zwei Finger auf dem Bild: ausgewähltes Element (oder das Hauptbild) zoomen und verschieben.
// Läuft über Touch-Ereignisse (nicht Pointer), damit die beiden Finger überall auf der Bühne liegen dürfen und
// der Browser keine eigene Geste (Wischen, Seitenzoom) daraus macht.
let Pinch = null;
(() => { const st = $('#stage');
  const pt = e => { const a = e.touches[0], b = e.touches[1]; return {d: Math.max(10, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)), x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2}; };
  st.addEventListener('touchstart', e => {
    if (e.touches.length !== 2 || keyPick || Crop.it || pinMode) return;
    const main = !curPip; if (main && !mainBoxOn()) return;
    e.preventDefault(); if (playing) pausePlay();
    const g = PipDrag, R = st.getBoundingClientRect(), W = R.width, H = R.height, p = pt(e);
    if (main){ const f = g.on && g.main ? {tx: g.tx, ty: g.ty, sc: g.sc} : mainFx();
      Object.assign(g, {on:true, main:true, it:null, moved:true, mode:'pinch', pinchT:true, tx:f.tx, ty:f.ty, sc:f.sc});
      Pinch = {main:true, d0:p.d, x0:p.x, y0:p.y, W, H, base:{...f}}; }
    else { const it = curPip, rel = outPos - pipTarget.at, v = g.on && g.it === it ? {x:g.x, y:g.y, w:g.w} : (elVals(it, rel) || coverVals(it));
      Object.assign(g, {on:true, main:false, it, rel, moved:true, mode:'pinch', pinchT:true, x:v.x, y:v.y, w:v.w, clip:it.clip});
      Pinch = {main:false, d0:p.d, x0:p.x, y0:p.y, W, H, base:{...v}}; }
  }, {passive:false});
  st.addEventListener('touchmove', e => {
    if (!Pinch || e.touches.length < 2) return; e.preventDefault();
    const g = PipDrag, q = Pinch, p = pt(e), r = p.d / q.d0, dx = (p.x - q.x0) / q.W, dy = (p.y - q.y0) / q.H;
    if (q.main){ g.sc = clamp(q.base.sc * r, 0.05, 20); g.tx = q.base.tx + dx; g.ty = q.base.ty + dy; if (Math.abs(g.sc - 1) < 0.02) g.sc = 1; applyMainTransform(); placeBox(); }
    else { g.w = clamp(q.base.w * r, 0.03, 20); g.x = q.base.x + dx; g.y = q.base.y + dy; updateOverlay(outPos); }
  }, {passive:false});
  const end = e => { if (!Pinch || e.touches.length >= 2) return; Pinch = null; PipDrag.pinchT = false; endPipDrag(); };
  st.addEventListener('touchend', end); st.addEventListener('touchcancel', end);
})();
$('#pipBox').addEventListener('pointerup', endPipDrag);
$('#pipBox').addEventListener('pointercancel', endPipDrag);
$('#pipBox').addEventListener('click', e => e.stopPropagation());
$('#pipBox').addEventListener('wheel', e => {
  e.preventDefault(); if (curPip || mainBoxOn()) e.stopPropagation(); const f = e.deltaY < 0 ? 1.06 : 1 / 1.06;
  if (!curPip){ if (!mainBoxOn()) return; const sg = timeline[TL.sel.i], v = mainFx(); commit(() => setMainVals(sg, {...v, sc: clamp(v.sc * f, 0.05, 20)}), false); seekOut(outPos, false); if (window.renderTimeline && mainKf(sg)) renderTimeline(); return; }
  const it = curPip, rel = outPos - pipTarget.at, v = elVals(it, rel) || coverVals(it);
  commit(() => setElVals(it, rel, {x: v.x, y: v.y, w: v.w * f}), false); seekOut(outPos, false); if (sheetItem === it) paintItem();
}, {passive:false});

// Titel (freie Texte) in der Vorschau
const titleEls = new Map();
function updateTitles(o){
  const box = $('#titleOv'); if (!box) return;
  const act = P.items.filter(x => x.type === 'title').map(x => ({x, a: srcToOut(snapSrc(x.at))})).filter(t => o >= t.a && o < t.a + t.x.dur);
  for (const [id, el] of titleEls) if (!act.some(t => t.x.id === id)){ el.remove(); titleEls.delete(id); }
  const st = $('#stage'), W = st.clientWidth, H = st.clientHeight;
  for (const {x} of act){
    let el = titleEls.get(x.id);
    if (!el){ el = document.createElement('div'); el.className = 'titlebox'; el.dataset.id = x.id; box.append(el); titleEls.set(x.id, el); }
    if (!(TitleDrag.on && TitleDrag.id === x.id)){ el.textContent = x.text || 'Titel'; el.style.left = (x.x * W) + 'px'; el.style.top = (x.y * H) + 'px'; }
    const px = (SIZE_F[x.size] || 0.058) * Math.min(W, H) * (H > W ? 1.25 : 1) * (x.scale || 1), ol = Math.max(1, px / 14);
    el.style.fontSize = px.toFixed(1) + 'px'; el.style.color = x.color || '#FFFFFF'; el.style.fontFamily = fontCss(x.font); el.style.fontWeight = fontWeight(x.font, 800);
    el.style.textShadow = x.outline !== false ? [[-1,-1],[1,-1],[-1,1],[1,1],[0,-1.4],[0,1.4],[-1.4,0],[1.4,0]].map(([a, b]) => `${(a*ol).toFixed(1)}px ${(b*ol).toFixed(1)}px 0 #000`).join(',') : 'none';
    el.style.background = x.bg ? 'rgba(0,0,0,.55)' : ''; el.classList.toggle('sel', !!(typeof TL !== 'undefined' && TL.sel && TL.sel.id === x.id));
  }
}
const TitleDrag = {on:false};
$('#titleOv').addEventListener('pointerdown', e => {
  const el = e.target.closest('.titlebox'); if (!el) return; e.preventDefault(); e.stopPropagation(); el.setPointerCapture(e.pointerId);
  const it = P.items.find(x => x.id === el.dataset.id); if (!it) return;
  Object.assign(TitleDrag, {on:true, id:it.id, it, x0:e.clientX, y0:e.clientY, sx:it.x, sy:it.y, nx:it.x, ny:it.y, moved:false, el});
  if (playing) pausePlay(); if (window.select) select({kind:'title', id:it.id});
});
$('#titleOv').addEventListener('pointermove', e => {
  if (!TitleDrag.on) return; const st = $('#stage').getBoundingClientRect();
  const x = clamp(TitleDrag.sx + (e.clientX - TitleDrag.x0) / st.width, 0.02, 0.98), y = clamp(TitleDrag.sy + (e.clientY - TitleDrag.y0) / st.height, 0.02, 0.98);
  if (Math.abs(e.clientX - TitleDrag.x0) + Math.abs(e.clientY - TitleDrag.y0) > 3) TitleDrag.moved = true;
  TitleDrag.el.style.left = (x * st.width) + 'px'; TitleDrag.el.style.top = (y * st.height) + 'px'; TitleDrag.nx = x; TitleDrag.ny = y;
});
const endTitleDrag = () => { if (!TitleDrag.on) return; TitleDrag.on = false; if (TitleDrag.moved){ const it = TitleDrag.it; commit(() => { it.x = r3(TitleDrag.nx); it.y = r3(TitleDrag.ny); }, false); } };
$('#titleOv').addEventListener('pointerup', endTitleDrag);
$('#titleOv').addEventListener('pointercancel', endTitleDrag);
$('#titleOv').addEventListener('click', e => e.stopPropagation());
$('#titleOv').addEventListener('dblclick', e => { const el = e.target.closest('.titlebox'); if (el && window.editTitle) editTitle(el.dataset.id); });
function hideOverlay(){ curPip = null; pipTarget = null; allLayers(el => { if (el.pause) el.pause(); el.classList.add('hidden'); }); placeBox(); }
const cssFilter = fx => !fx ? '' : [fx.bright ? `brightness(${(1 + fx.bright).toFixed(3)})` : '', fx.contrast ? `contrast(${(1 + fx.contrast).toFixed(3)})` : '', fx.sat ? `saturate(${(1 + fx.sat / 100).toFixed(3)})` : '', fx.gray ? 'grayscale(1)' : ''].filter(Boolean).join(' ');
function applySegFx(g){
  const fx = g && g.kind === 'main' ? g.fx : null;
  V.style.filter = cssFilter(fx); const rate = g && g.kind === 'main' ? (g.speed || 1) : 1; if (Math.abs(V.playbackRate - rate) > 0.001) V.playbackRate = clamp(rate, 0.25, 4);
  setVol(V, (fx ? fx.vol ?? 1 : 1) * (g && g.kind === 'main' ? srcVol(g.si) : 1));
}
// Lautstärke je Video der Hauptspur (P.sources[k].vol) – wird mit der Anpassung des Abschnitts multipliziert
const srcVol = si => { const s = P && P.sources[si]; return s && s.vol != null ? +s.vol : 1; };
// Lautstärke in der Vorschau, auch über 100 % (dann über die Web-Audio-Schnittstelle verstärkt)
let actx = null;
function setVol(el, v){
  v = Math.max(0, +v || 0);
  if (!el._g && v <= 1){ if (Math.abs(el.volume - v) > 0.001) el.volume = v; return; }
  try {
    if (!el._g){ actx ||= new (window.AudioContext || window.webkitAudioContext)(); const src = actx.createMediaElementSource(el), gn = actx.createGain(); src.connect(gn).connect(actx.destination); el._g = gn; }
    if (el.volume !== 1) el.volume = 1; el._g.gain.value = Math.min(v, 4); if (actx.state === 'suspended') actx.resume().catch(() => {});
  } catch(_){ el.volume = Math.min(1, v); }
}
function updateZoom(){
  const g = timeline[curSeg]; applySegFx(g);
  if (!g || g.kind !== 'main'){ V.style.transform = ''; return; }
  applyMainTransform();
}
// Zoom (innen) und Lage/Größe des Clips (außen), Ursprung in der Mitte
function applyMainTransform(){
  const g = timeline[curSeg]; if (!g || g.kind !== 'main'){ V.style.transform = ''; return; }
  const z = zoomAt(vT()), f = frameFx(PipDrag.on && PipDrag.main ? {tx: PipDrag.tx, ty: PipDrag.ty, sc: PipDrag.sc} : mainFxAt(g, vT()));
  const tx = f.tx || 0, ty = f.ty || 0, sc = f.sc || 1, parts = [];
  if (tx || ty) parts.push(`translate(${(tx * 100).toFixed(3)}%, ${(ty * 100).toFixed(3)}%)`);
  if (Math.abs(sc - 1) > 1e-3) parts.push(`scale(${sc.toFixed(4)})`);
  if (z.s > 1.001) parts.push(`translate(${(-(z.cx - 0.5) * (z.s - 1) * 100).toFixed(3)}%, ${(-(z.cy - 0.5) * (z.s - 1) * 100).toFixed(3)}%) scale(${z.s.toFixed(4)})`);
  V.style.transformOrigin = '50% 50%'; V.style.transform = parts.join(' ');
  if (vKey) vKey.canvas.style.transform = V.style.transform;
}
// Scrubben
(() => { const sc = $('#scrub');
  const at = e => { const b = sc.getBoundingClientRect(); return clamp((e.clientX - b.left) / b.width, 0, 1) * total; };
  sc.addEventListener('pointerdown', e => { sc.setPointerCapture(e.pointerId); const was = playing; if (was) pausePlay(); seekOut(at(e), false); if (window.syncScroll) syncScroll(outPos, true);
    sc.onpointermove = ev => { seekOut(at(ev), false); if (window.syncScroll) syncScroll(outPos, true); }; sc.onpointerup = () => { sc.onpointermove = null; if (was) startPlay(); }; });
})();
V.addEventListener('error', () => { if (!P || vSi < 0) return; V.dataset.err = '1'; $('#proxyBar').classList.remove('hidden');
  const s = P.sources[vSi];
  $('#proxyMsg').textContent = s.proxy ? 'Auch die Vorschau-Datei lässt sich nicht abspielen.' : `„${s.name}“ lässt sich in der Vorschau nicht abspielen. Schneiden und Export funktionieren trotzdem.`; });
$('#proxyBtn').onclick = () => {
  const s = P.sources[vSi]; if (!s) return;
  $('#proxyBtn').disabled = true; $('#proxyProg').classList.remove('hidden'); TS.keepAwake(true);
  watchJob(TS.makeProxy(s.uri), j => { $('#proxyProg i').style.width = (j.progress * 100) + '%'; $('#proxyMsg').textContent = j.message || ''; },
    j => { TS.keepAwake(false); $('#proxyBtn').disabled = false; $('#proxyProg').classList.add('hidden'); s.proxy = j.result.path; saveNow(); const si = vSi; vSi = -1; seekOut(outPos, false); toast('Vorschau bereit'); },
    j => { TS.keepAwake(false); $('#proxyBtn').disabled = false; $('#proxyMsg').textContent = 'Fehler: ' + (j.error || ''); });
};

// ───────── Quellen & Transkription ─────────
function fillModels(){
  const ms = J(TS.models()) || [];
  const sel = $('#model'), keep = sel.value; sel.innerHTML = '';
  ms.forEach(m => { const o = document.createElement('option'); o.value = m.name; o.textContent = m.label + (m.installed ? ' · bereit' : ` · ${m.sizeMb} MB laden`); sel.append(o); });
  const ready = ms.find(m => m.name === keep) || ms.find(m => m.installed && m.recommended) || ms.find(m => m.installed) || ms[0]; if (ready) sel.value = ready.name;
}
function renderSources(){
  const box = $('#srcList'); if (!box || !P) return; box.innerHTML = '';
  P.sources.forEach((s, k) => {
    const el = document.createElement('div'); el.className = 'src-item';
    const st = s.tr ? (s.noAudio ? 'ohne Ton' : 'transkribiert') : (s.hasAudio === false ? 'ohne Ton' : 'noch nicht transkribiert');
    el.innerHTML = `<span class="n">${k + 1}</span><div class="meta"><b></b><span class="muted small">${fmtT(s.duration)} · ${st}</span></div>`;
    el.querySelector('b').textContent = s.name;
    const movable = !s.tr && !P.sources.slice(k).some(x => x.tr);
    if (movable){
      const up = k > 0 && !P.sources[k-1].tr, down = k < P.sources.length - 1;
      el.insertAdjacentHTML('beforeend', `<button class="mini" data-a="up" ${up ? '' : 'disabled'}>↑</button><button class="mini" data-a="down" ${down ? '' : 'disabled'}>↓</button>${P.sources.length > 1 ? '<button class="mini" data-a="rm">✕</button>' : ''}`);
    }
    el.onclick = e => { const b = e.target.closest('button'); if (!b) return; const a = b.dataset.a;
      if (a === 'up') [P.sources[k-1], P.sources[k]] = [P.sources[k], P.sources[k-1]];
      else if (a === 'down') [P.sources[k+1], P.sources[k]] = [P.sources[k], P.sources[k+1]];
      else if (a === 'rm') P.sources.splice(k, 1);
      layoutSources(); vSi = -1; changed(); saveNow(); renderSources(); seekOut(0, false); };
    box.append(el);
  });
  const todo = P.sources.filter(s => !s.tr).length;
  const sub = !tokens.length && studioCut(); $('#subsOnlyBox').classList.toggle('hidden', !sub);
  if (!sub) $('#subsOnly').checked = false; $('#transBtn').closest('.card').querySelector('.auto-opts').classList.toggle('hidden', sub && $('#subsOnly').checked);
  $('#transBtn').textContent = sub && $('#subsOnly').checked ? 'Untertitel erzeugen' : todo > 1 ? `${todo} Videos transkribieren` : 'Transkription starten';
  $('#transBtn').disabled = !todo;
}
async function addSources(){
  const list = asList(await pickMedia('videos')); if (!list.length) return;
  P.sources.push(...list.map(cleanSrc)); layoutSources(); changed(); saveNow(); renderSources();
  toast(list.length > 1 ? `${list.length} Videos angehängt` : 'Video angehängt');
  if (tokens.length) setTab('trans');
}
$('#addSrcBtn').onclick = addSources;
// Wurde schon im Studio geschnitten (ohne Transkript)?
const studioCut = () => !!(P.dels.length || P.splits.length || P.moves.length || P.items.length || Object.keys(P.adj).length);
$('#subsOnly').addEventListener('change', renderSources);
// Kanten-Feinschnitt ohne Transkript (Schlüssel su/eu) in feste Schnitte umwandeln, damit er das Transkript übersteht
function freezeStudioCut(){
  P.sources.forEach((s, k) => {
    const a = P.adj['su' + k] || 0, b = P.adj['eu' + k] || 0;
    if (a > 0) addDel(s.off, s.off + a); if (b < 0) addDel(s.off + s.duration + b, s.off + s.duration);
    delete P.adj['su' + k]; delete P.adj['eu' + k];
  });
}
let transJob = null, transCancelled = false;
// Laufende Transkription im Gerät merken: Wird die Oberfläche neu geladen (Android: Handy auf-/zugeklappt, App im Hintergrund
// beendet), läuft der Vorgang weiter – beim nächsten Öffnen des Projekts holt HoneyCut das Ergebnis ab und macht weiter.
const TJ_KEY = id => 'hc-tjob-' + id;
const tjGet = id => { try { return J(localStorage.getItem(TJ_KEY(id))); } catch(_){ return null; } };
const tjSet = (id, v) => { try { v ? localStorage.setItem(TJ_KEY(id), JSON.stringify(v)) : localStorage.removeItem(TJ_KEY(id)); } catch(_){} };
$('#transBtn').onclick = () => runTranscribe(null);
function runTranscribe(resume){
  const todo = P.sources.map((s, k) => k).filter(k => !P.sources[k].tr);
  const o = resume ? resume.opts : {model: $('#model').value, lang: $('#lang').value, fillers: $('#fillers').checked, startTok: tokens.length, firstTime: !tokens.length};
  if (!resume) o.subsOnly = o.firstTime && studioCut() && $('#subsOnly').checked;
  if (!todo.length && !resume) return;
  const pid = P.id, P0 = P;
  $('#transBtn').disabled = true; $('#transCancel').classList.remove('hidden'); $('#transProg').classList.remove('hidden'); TS.keepAwake(true);
  transCancelled = false;
  const {model, lang, fillers, startTok, firstTime, subsOnly} = o;
  if (subsOnly && !resume) freezeStudioCut();
  let n = 0, words = resume ? (resume.words || 0) : 0;
  const alive = () => P === P0;   // Projekt inzwischen geschlossen/neu geöffnet: diese Runde endet, die neue übernimmt
  const end = () => { if (!alive()) return; tjSet(pid, null); $('#transBtn').disabled = false; $('#transCancel').classList.add('hidden'); $('#transProg').classList.add('hidden'); TS.keepAwake(false); transJob = null; renderSources(); };
  const finish = () => {
    end(); if (!alive()) return; P.language ||= lang;
    if (firstTime && !subsOnly){ deleted = new Set(); P.trims = {}; P.adj = {}; }
    const cleaned = subsOnly ? [] : autoClean(startTok);
    if (firstTime) genCues(); else genCues(startTok);
    renderTranscript(); changed(); saveNow(); busSend({t:'reload'}); setTab(subsOnly ? 'subs' : 'text');
    if (subsOnly){ toast(`${computedCues().length} Untertitel aus dem Schnitt erzeugt – Text, Zeiten und Position lassen sich jetzt anpassen`); return; }
    const unk = tokens.filter(t => t.i >= startTok && t.type === 'unk' && !deleted.has(t.i)).length;
    toast(`${words} Wörter erkannt` + (cleaned.length ? ` · entfernt: ${cleaned.join(', ')}` : '') + (unk ? ` · ${unk}× 🗣 nicht erkannte Sprache` : ''));
  };
  const next = () => {
    if (!alive()) return;
    if (n >= todo.length || transCancelled) return (n || resume) ? finish() : end();
    const k = todo[n], s = P.sources[k];
    if (s.hasAudio === false){ s.tr = true; s.noAudio = true; n++; return next(); }
    const label = todo.length > 1 ? `Video ${n + 1} von ${todo.length}: ` : '';
    let jid = null;
    if (resume && resume.k === k && resume.id){ jid = resume.id; resume.id = null; }
    else try { jid = TS.transcribe(s.uri, model, lang, fillers); } catch(e){ end(); $('#transMsg').textContent = 'Fehler: ' + e.message; return; }
    transJob = jid; tjSet(pid, {id: jid, k, opts: o, words, at: Date.now()});
    watchJob(jid, j => { if (!alive()) return; $('#transProg i').style.width = ((n + j.progress) / todo.length * 100).toFixed(1) + '%'; $('#transMsg').textContent = label + (j.message || ''); },
      j => { if (!alive()) return; const r = j.result || {}; if (r.env){ s.env = r.env; if (s._env) s._env = null; delete s._bursts; } if (r.padded) s.pad0 = true; if (r.lang && !P.language) P.language = r.lang;
             s.asr = {v: CAP.version || '', timing: r.timing || '', chunks: r.chunks || 0, model, at: Date.now()};   // zur Fehlersuche: womit transkribiert wurde
             const base = appendSourceTokens(k, r.words || []); words += (r.words || []).length;
             P.tokens = tokens; saveNow(); tjSet(pid, {id: null, k: -1, opts: o, words, at: Date.now()});   // Ergebnis sofort sichern
             // Stellen ohne erkannte Wörter (🗣) einzeln nachhören: meist Anläufe, die Whisper im Zusammenhang auslässt
             const gaps = TS.transcribeRanges ? tokens.filter(t => t.i >= base && t.src === k && t.type === 'unk' && t.we - t.ws >= 0.25) : [];
             if (!gaps.length || transCancelled){ n++; saveNow(); return next(); }
             let gj; try { gj = TS.transcribeRanges(s.uri, model, lang, JSON.stringify(gaps.map(t => [r3(t.ws - s.off), r3(t.we - s.off)]))); } catch(e){ n++; saveNow(); return next(); }
             transJob = gj;
             watchJob(gj, j2 => { if (!alive()) return; $('#transProg i').style.width = ((n + 0.9 + 0.1 * j2.progress) / todo.length * 100).toFixed(1) + '%'; $('#transMsg').textContent = label + `Nicht erkannte Stellen nachhören (${gaps.length}) …`; },
               j2 => { if (!alive()) return; const got = fillGaps(k, gaps, (j2.result || {}).ranges || []); words += got; n++; saveNow(); next(); },
               () => { if (!alive()) return; n++; saveNow(); next(); });
             return; },
      j => { if (!alive()) return; if (n || (resume && resume.words)) { transCancelled = true; finish(); $('#transMsg').textContent = 'Teilweise transkribiert.'; return; }
             end(); $('#transMsg').textContent = j.status === 'cancelled' ? 'Abgebrochen.' : j.error === 'Job verloren' ? 'Die Transkription wurde unterbrochen (App beendet). Bitte noch einmal starten.' : ('Fehler: ' + (j.error || 'unbekannt')); });
  };
  next();
}
// Beim Öffnen: unterbrochene Transkription fortsetzen bzw. ihr Ergebnis übernehmen
function resumeTranscribe(){
  const r = tjGet(P.id); if (!r) return;
  if (r.id){ const j = J(TS.job(r.id)); if (!j){ tjSet(P.id, null); setTab('trans'); $('#transMsg').textContent = 'Die Transkription wurde unterbrochen, weil die App beendet wurde. Bitte noch einmal starten.'; return; } }
  setTab('trans'); $('#transMsg').textContent = 'Transkription läuft weiter …'; runTranscribe(r);
}
$('#transCancel').onclick = () => { transCancelled = true; if (transJob) TS.cancel(transJob); };

// ───────── Text ─────────
let selA = null, selB = null;
function renderTranscript(){
  const root = $('#transcript'); root.innerHTML = ''; spans = new Array(tokens.length);
  if (order.length !== tokens.length) computeOrder();
  let para = -1, pEl = null, fillers = 0, src = -1, prev = -2, lastSpk = ''; const frag = document.createDocumentFragment();
  for (const i of order){
    const t = tokens[i];
    if (t.src !== src && P.sources.length > 1){ src = t.src; const h = document.createElement('div'); h.className = 'src-head'; h.textContent = `🎞 ${src + 1} · ${P.sources[src].name}`; frag.append(h); pEl = null; }
    const jump = prev >= 0 && i !== prev + 1;
    if (t.p !== para || !pEl || jump){ pEl = document.createElement('p'); para = t.p;
      if (jump) pEl.classList.add('moved');
      const ts = document.createElement('span'); ts.className = 'ts'; ts.textContent = (jump ? '↕ ' : '') + fmtT(t.ws ?? t.s); pEl.append(ts); frag.append(pEl); }
    if (t.type !== 'pause' && (t.spk || '') !== lastSpk){ lastSpk = t.spk || '';
      const who = spkOf(lastSpk); if (who || P.speakers.length){ const l = document.createElement('span'); l.className = 'spk-lbl' + (who ? '' : ' none'); l.textContent = who ? who.name : 'ohne Person'; if (who) l.style.setProperty('--sc', spkCol(who)); pEl.append(l, ' '); } }
    const sp = document.createElement('span'); sp.dataset.i = t.i;
    if (t.type === 'word'){ sp.className = 'tk word' + (t.pr < 0.5 ? ' low' : '') + (t.ug ? ' rep' : ''); if (t.ug) sp.title = 'Nachgehört: Whisper hatte diese Stelle zunächst ausgelassen – meist ein Anlauf'; if (FILLER.test(norm(tokText(t)))){ sp.classList.add('filler'); fillers++; } }
    else if (t.type === 'unk'){ sp.className = 'tk unk'; sp.title = 'Hier wurde gesprochen, aber Whisper hat kein Wort erkannt – meist ein ausgelassener Anlauf. „Wiederholungen weg“ löscht solche Stellen; antippen spielt sie ab.'; if (t.att) sp.classList.add('att'); }
    else sp.className = 'tk pause';
    spans[t.i] = sp; pEl.append(sp, ' ');
    prev = i;
  }
  root.append(frag); tokens.forEach(t => paint(t.i));
  $('#fillerBtn').textContent = `Füllwörter weg (${fillers})`;
  const todo = P.sources.filter(s => !s.tr).length;
  $('#textTodo').classList.toggle('hidden', !todo); $('#textTodo b').textContent = todo === 1 ? '1 Video ist' : `${todo} Videos sind`;
  if ($('#findIn').value) runFind();
}
$('#textTodoBtn').onclick = () => setTab('trans');
function paint(i){
  const t = tokens[i], sp = spans[i]; if (!sp) return;
  if (t.type === 'word'){ const tx = tokText(t); if (sp.textContent !== tx) sp.textContent = tx; sp.classList.toggle('empty', !tx); sp.classList.toggle('edited', P.edits[t.i] != null); }
  sp.classList.toggle('del', deleted.has(i) || (t.type === 'word' && isSrcDeleted((t.ws + t.we) / 2)));
  sp.classList.toggle('ks', !!t.ks && sp.classList.contains('del'));
  const added = t.type !== 'word' && P.edits[i];
  sp.classList.toggle('added', !!added);
  if (added){ sp.textContent = P.edits[i]; return; }
  if (t.type === 'unk') sp.innerHTML = `${icon('🗣')}${t.att ? 'Anlauf ' : ''}${(t.we - t.ws).toFixed(1).replace('.', ',')} s`;
  if (t.type === 'pause'){ const d = (t.e - t.s).toFixed(1).replace('.', ','), tr = P.trims[i];
    sp.classList.toggle('trim', tr != null && !deleted.has(i)); sp.innerHTML = icon('⏸') + (tr != null ? `${d}→${String(tr).replace('.', ',')}` : d); }
}
// Antippen/Klicken: erstes Wort, zweites Wort = Bereich; Umschalt+Klick erweitert.
// Ziehen: Maus mit gedrückter Taste, Finger nach kurzem Gedrückthalten.
let dragSuppressClick = false;
$('#transcript').addEventListener('click', e => {
  if (dragSuppressClick){ dragSuppressClick = false; return; }
  const sp = e.target.closest('.tk'); if (!sp) return;
  const i = +sp.dataset.i;
  if (e.shiftKey && selA != null){ selB = i; }
  else if (selA == null){ selA = selB = i; }
  else if (selA !== selB && selIds().includes(i)){ selA = selB = i; }
  else if (selA === selB && i === selA){ clearSel(); return; }
  else selB = i;
  showSel();
  if (!playing){ const t = tokens[i]; seekOut(srcToOut(snapSrc(t.ws ?? t.s)), false); if (window.syncScroll) syncScroll(outPos, true); }
});
const TDrag = { on:false, anchor:null, moved:false, timer:0, x:0, y:0, scroller:null, auto:0, lastX:0, lastY:0 };
function tokAt(x, y){
  let el = document.elementFromPoint(x, y); let sp = el && el.closest && el.closest('#transcript .tk');
  if (sp) return +sp.dataset.i;
  for (const dx of [-12, 12, -28, 28, -60, 60]){ el = document.elementFromPoint(x + dx, y); sp = el && el.closest && el.closest('#transcript .tk'); if (sp) return +sp.dataset.i; }
  return null;
}
function scrollParent(el){ for (let n = el.parentElement; n; n = n.parentElement){ const o = getComputedStyle(n).overflowY; if ((o === 'auto' || o === 'scroll') && n.scrollHeight > n.clientHeight) return n; } return document.scrollingElement; }
// Ziehen einer bestehenden Auswahl verschiebt den Abschnitt (vor das Wort, über dem losgelassen wird)
function quietNear(si, t){ const S0 = P.sources[si].off, S1 = srcEnd(si); return envArr(P.sources[si]) ? snapCut(si, t, Math.max(S0, t - 0.25), Math.min(S1, t + 0.1), -1) : t; }
function moveSelection(target){
  const ids = selIds(); if (!ids.length || target == null || ids.includes(target)) return false;
  const atEnd = target === 'end';
  const src = [...ids].sort((a, b) => a - b);
  if (src[src.length-1] - src[0] + 1 !== src.length) { toast('Bitte einen zusammenhängenden Abschnitt verschieben'); return false; }
  const A = tokens[src[0]], B = tokens[src[src.length-1]], T = atEnd ? null : tokens[target];
  const a = r3(quietNear(A.src, A.s)), b = r3(quietNear(B.src, B.e)), to = T ? r3(quietNear(T.src, T.s)) : null;
  commit(() => { P.moves.push({a, b, to}); P.splits.push(a, b); if (to != null) P.splits.push(to); }, true);
  renderTranscript(); clearSel(); toast('Abschnitt verschoben – Strg+Z macht es rückgängig');
  return true;
}
function setDropMark(i, after){ $$('#transcript .drop, #transcript .drop-after').forEach(x => x.classList.remove('drop', 'drop-after')); if (i != null && spans[i]) spans[i].classList.add(after ? 'drop-after' : 'drop'); }
function dragBegin(i, x, y, mode = 'select'){
  TDrag.on = true; TDrag.mode = mode; TDrag.anchor = i; TDrag.moved = false; TDrag.lastX = x; TDrag.lastY = y; TDrag.target = null;
  TDrag.scroller = scrollParent($('#transcript'));
  if (mode === 'select'){ selA = selB = i; showSel(); }
  $('#transcript').classList.add(mode === 'move' ? 'moving' : 'dragging');
  autoScroll();
}
function dragMove(x, y){
  if (!TDrag.on) return; TDrag.lastX = x; TDrag.lastY = y;
  const i = tokAt(x, y); if (i == null) return;
  if (TDrag.mode === 'move'){
    TDrag.moved = true; const r = spans[i].getBoundingClientRect(), after = x > r.left + r.width / 2;
    const k = pos[i] + (after ? 1 : 0), t = k < order.length ? order[k] : null;
    const ok = !selIds().includes(i) && (t == null || !selIds().includes(t));
    TDrag.target = ok ? (t == null ? 'end' : t) : null; setDropMark(ok ? i : null, after); return; }
  if (i === selB) return;
  TDrag.moved = true; selA = TDrag.anchor; selB = i; showSel();
}
function dragEnd(){
  if (!TDrag.on) return; TDrag.on = false; cancelAnimationFrame(TDrag.auto); $('#transcript').classList.remove('dragging', 'moving'); setDropMark(null);
  if (TDrag.moved){ dragSuppressClick = true; setTimeout(() => dragSuppressClick = false, 400); }
  if (TDrag.mode === 'move'){ if (TDrag.moved) moveSelection(TDrag.target); return; }
  if (!playing && selA != null){ const t = tokens[Math.min(selA, selB)]; seekOut(srcToOut(snapSrc(t.ws ?? t.s)), false); }
}
function autoScroll(){
  if (!TDrag.on) return;
  const sc = TDrag.scroller, r = sc === document.scrollingElement ? {top:0, bottom:innerHeight} : sc.getBoundingClientRect();
  const edge = 56, y = TDrag.lastY; let dy = 0;
  if (y < r.top + edge) dy = -Math.ceil((r.top + edge - y) / 5); else if (y > r.bottom - edge) dy = Math.ceil((y - (r.bottom - edge)) / 5);
  if (dy){ sc.scrollTop += dy; dragMove(TDrag.lastX, TDrag.lastY); }
  TDrag.auto = requestAnimationFrame(autoScroll);
}
$('#transcript').addEventListener('pointerdown', e => {
  if (e.pointerType === 'touch' || e.button !== 0) return;
  const sp = e.target.closest('.tk'); if (!sp) return;
  TDrag.x = e.clientX; TDrag.y = e.clientY; TDrag.pending = +sp.dataset.i; TDrag.shift = e.shiftKey;
  TDrag.pendMove = selA != null && selA !== selB && selIds().includes(+sp.dataset.i) && !e.shiftKey;
});
window.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') return;
  if (TDrag.pending != null && !TDrag.on && (e.buttons & 1) && Math.hypot(e.clientX - TDrag.x, e.clientY - TDrag.y) > 4){
    const a = TDrag.shift && selA != null ? selA : TDrag.pending; TDrag.pending = null; dragBegin(a, e.clientX, e.clientY, TDrag.pendMove ? 'move' : 'select');
  }
  if (TDrag.on){ e.preventDefault(); dragMove(e.clientX, e.clientY); }
});
window.addEventListener('pointerup', e => { if (e.pointerType === 'touch') return; TDrag.pending = null; dragEnd(); });
$('#transcript').addEventListener('touchstart', e => {
  if (e.touches.length !== 1) { clearTimeout(TDrag.timer); return; }
  const sp = e.target.closest('.tk'); if (!sp) return;
  const t = e.touches[0]; TDrag.x = t.clientX; TDrag.y = t.clientY; const i = +sp.dataset.i;
  clearTimeout(TDrag.timer);
  const mv = selA != null && selA !== selB && selIds().includes(i);
  TDrag.timer = setTimeout(() => { dragBegin(i, TDrag.x, TDrag.y, mv ? 'move' : 'select'); if (mv) toast('Zum Verschieben an die neue Stelle ziehen'); try { navigator.vibrate && navigator.vibrate(15); } catch(_){} }, 300);
}, {passive:true});
$('#transcript').addEventListener('touchmove', e => {
  const t = e.touches[0];
  if (TDrag.on){ e.preventDefault(); dragMove(t.clientX, t.clientY); return; }
  if (Math.hypot(t.clientX - TDrag.x, t.clientY - TDrag.y) > 8) clearTimeout(TDrag.timer);
}, {passive:false});
$('#transcript').addEventListener('touchend', e => {
  clearTimeout(TDrag.timer);
  if (TDrag.on){ e.preventDefault(); dragSuppressClick = true; setTimeout(() => dragSuppressClick = false, 400); dragEnd(); }
});
$('#transcript').addEventListener('touchcancel', () => { clearTimeout(TDrag.timer); dragEnd(); });
$('#transcript').addEventListener('contextmenu', e => e.preventDefault());
function selIds(){ if (selA == null) return []; const pa = pos[selA] ?? selA, pb = pos[selB] ?? selB; return order.slice(Math.min(pa, pb), Math.max(pa, pb) + 1); }
function showSel(){
  spans.forEach(s => s && s.classList.remove('sel'));
  const ids = selIds(); ids.forEach(i => spans[i] && spans[i].classList.add('sel'));
  $('#selbar').classList.toggle('hidden', !ids.length);
  const cutText = ids.filter(i => isTextTok(i) && isCut(i));
  $('#selKeep').classList.toggle('hidden', !cutText.length);
  if (cutText.length){ const on = cutText.every(i => tokens[i].ks); $('#selKeep span').textContent = on ? 'Untertitel weg' : 'Untertitel'; $('#selKeep').title = on ? 'Untertitel der weggeschnittenen Wörter wieder ausblenden' : 'Nur den Untertitel der weggeschnittenen Wörter zeigen – der Schnitt bleibt'; }
  if (ids.length){ const allDel = ids.every(i => deleted.has(i) || (tokens[i].type === 'word' && isSrcDeleted((tokens[i].ws + tokens[i].we) / 2)));
    $('#selDel span').textContent = allDel ? 'Zurück' : 'Löschen'; $('#selDel').title = allDel ? 'Gelöschte Wörter wiederherstellen (Entf)' : 'Markierte Wörter löschen (Entf)'; $('#selDel').classList.toggle('restore', allDel);
    const n = ids.filter(i => tokens[i].type === 'word').length;
    $('#selCount').textContent = ids.length === 1 ? '1 Wort' : `${n} Wörter`;
    $('#selInfo').textContent = ids.length === 1 ? (FINE ? 'Zweites Wort anklicken oder ziehen' : 'Zweites Wort antippen') : (FINE ? 'Markierung ziehen = verschieben' : 'Halten + ziehen = verschieben'); }
}
function clearSel(){ selA = selB = null; showSel(); }
// ── Untertitel weggeschnittener Wörter behalten: der Schnitt bleibt, nur der Text erscheint kurz am Schnitt ──
function keepSubs(ids, on){
  ids = ids.filter(i => isTextTok(i)); if (!ids.length) return;
  for (const i of ids){ if (on) tokens[i].ks = true; else delete tokens[i].ks; }
  if (on && S().mode === 'word'){   // 1 Wort pro Untertitel: das behaltene Wort bekommt einen eigenen Untertitel
    for (const i of ids){
      const k = P.cues.findIndex(c => !c.own && i >= c.a && i <= c.b); if (k < 0) continue; const c = P.cues[k];
      const rest = cueWords({a: i + 1, b: c.b}); if (!rest.length || i === c.b) continue;
      const c2 = {...c, id:newId(), a:i + 1, b:c.b}; c.b = i; c.text = null; P.cues.splice(k + 1, 0, c2);
    }
  }
}
$('#selKeep').onclick = () => {
  const ids = selIds().filter(i => isTextTok(i) && isCut(i)); if (!ids.length) return;
  const on = !ids.every(i => tokens[i].ks);
  commit(() => keepSubs(ids, on), false); tokens.forEach(t => paint(t.i)); showSel();
  toast(on ? 'Untertitel bleibt – erscheint kurz am Schnitt' : 'Untertitel wieder weg');
};
// ── Sprecher:innen zuordnen ──
function askName(title, val){
  return new Promise(res => {
    const m = hcModal(`<h3>${esc(title)}</h3><input type="text" id="nmIn" style="width:100%;font-size:16px" placeholder="Name"><div class="row" style="margin-top:12px"><button class="btn" id="nmNo">Abbrechen</button><button class="btn primary" id="nmOk" style="margin-left:auto">OK</button></div>`);
    const inp = m.querySelector('#nmIn'); inp.value = val || ''; setTimeout(() => { inp.focus(); inp.select(); }, 30);
    const done = v => { closeHcModal(); res(v); };
    m.querySelector('#nmNo').onclick = () => done(null); m.querySelector('#nmOk').onclick = () => done(inp.value.trim() || null);
    inp.onkeydown = e => { if (e.key === 'Enter') done(inp.value.trim() || null); if (e.key === 'Escape') done(null); };
  });
}
async function newSpeaker(){ const name = await askName('Neue Person', `Person ${P.speakers.length + 1}`); if (!name) return null; const sp = {id:newId(), name, st:{}}; P.speakers.push(sp); return sp; }
function assignSpeaker(ids, sp){
  commit(() => { for (const i of ids){ const t = tokens[i]; if (t.type === 'pause') continue; if (sp) t.spk = sp.id; else delete t.spk; } splitCuesBySpeaker(); }, false);
  renderTranscript(); clearSel(); if (tab === 'subs') renderSubs();
  toast(sp ? `${ids.filter(i => tokens[i].type === 'word').length} Wörter: ${sp.name}` : 'Zuordnung entfernt');
}
$('#selSpk').onclick = e => {
  const ids = selIds(); if (!ids.length) return;
  const b = e.currentTarget.getBoundingClientRect();
  const list = P.speakers.map(sp => ({icon: `<b class="dot" style="background:${spkCol(sp)}"></b>`, label: esc(sp.name), fn: () => assignSpeaker(ids, sp)}));
  list.push({icon: icon('＋'), label: 'Neue Person …', fn: async () => { const sp = await newSpeaker(); if (sp){ assignSpeaker(ids, sp); renderSpeakers(); } }});
  if (P.speakers.length) list.push({icon: icon('✕'), label: 'Keine Person', fn: () => assignSpeaker(ids, null)});
  if (window.showMenu) showMenu(b.left, b.top, list);
};
// Gestaltung je Person: nur abweichende Werte werden gespeichert, alles andere folgt der Grundeinstellung
function renderSpeakers(){
  const box = $('#spkList'); if (!box || !P) return; box.innerHTML = '';
  $('#spkSame').classList.toggle('hidden', !P.speakers.some(sp => sp.st && Object.keys(sp.st).length));
  if (!P.speakers.length){ box.innerHTML = '<p class="muted small">Noch keine Personen.</p>'; return; }
  const fontOpts = () => '<option value="__">wie alle</option>' + FONTS.concat(userFonts).map(f => `<option value="${esc(f.key)}">${esc(f.label)}</option>`).join('');
  for (const sp of P.speakers){
    sp.st ||= {}; const st = sp.st, n = tokens.filter(t => t.spk === sp.id && t.type === 'word').length;
    const row = document.createElement('div'); row.className = 'spk-row';
    row.innerHTML = `<div class="spk-head"><b class="dot" style="background:${spkCol(sp)}"></b><input type="text" class="spk-name"><span class="muted small">${n} Wörter</span><button class="mini spk-del" title="Person entfernen">✕</button></div>
      <div class="grid2">
        <label>Farbe <span class="row"><select class="sp-colmode"><option value="">wie alle</option><option value="own">eigene</option></select><input type="color" class="sp-color"></span></label>
        <label>Schrift <select class="sp-font">${fontOpts()}</select></label>
        <label>Größe <select class="sp-size"><option value="">wie alle</option><option>klein</option><option>mittel</option><option>groß</option></select></label>
        <label>Umrandung <select class="sp-outline"><option value="">wie alle</option><option value="1">an</option><option value="0">aus</option></select></label>
        <label>Position <select class="sp-pos"><option value="">wie alle</option><option value="unten">unten</option><option value="mitte">mitte</option><option value="oben">oben</option>${st.y != null && !Object.values(POS_Y).includes(st.y) ? '<option value="frei">frei</option>' : ''}</select></label>
      </div>`;
    const q = c => row.querySelector(c);
    q('.spk-name').value = sp.name; q('.sp-colmode').value = st.color ? 'own' : ''; q('.sp-color').value = (st.color || S().color || '#FFFFFF').toLowerCase(); q('.sp-color').disabled = !st.color;
    q('.sp-font').value = st.font != null ? st.font : '__'; q('.sp-size').value = st.size || ''; q('.sp-outline').value = st.outline == null ? '' : st.outline ? '1' : '0';
    q('.sp-pos').value = st.y == null ? '' : (Object.keys(POS_Y).find(k => POS_Y[k] === st.y) || 'frei');
    const upd = fn => { commit(fn, false); styleOverlay(); renderSpeakers(); if (tab === 'text') renderTranscript(); };
    q('.spk-name').onchange = e => upd(() => sp.name = e.target.value.trim() || sp.name);
    q('.sp-colmode').onchange = e => upd(() => { if (e.target.value) st.color = (q('.sp-color').value || '#ffffff').toUpperCase(); else delete st.color; });
    q('.sp-color').onchange = e => upd(() => st.color = e.target.value.toUpperCase());
    q('.sp-font').onchange = e => upd(() => { if (e.target.value === '__') delete st.font; else st.font = e.target.value; });
    q('.sp-size').onchange = e => upd(() => { if (e.target.value) st.size = e.target.value; else delete st.size; });
    q('.sp-outline').onchange = e => upd(() => { if (e.target.value === '') delete st.outline; else st.outline = e.target.value === '1'; });
    q('.sp-pos').onchange = e => upd(() => { const v = e.target.value; if (!v){ delete st.y; delete st.x; } else if (POS_Y[v] != null){ st.y = POS_Y[v]; st.x = 0.5; } });
    q('.spk-del').onclick = () => { if (!confirm(`„${sp.name}“ entfernen? Die Wörter bleiben, nur die Zuordnung fällt weg.`)) return;
      upd(() => { P.speakers = P.speakers.filter(x => x !== sp); tokens.forEach(t => { if (t.spk === sp.id) delete t.spk; }); P.cues.forEach(c => { if (c.spk === sp.id) delete c.spk; }); }); };
    box.append(row);
  }
}
$('#spkAdd').onclick = async () => { const sp = await newSpeaker(); if (sp){ changed(false); renderSpeakers(); toast('Jetzt im Text Wörter markieren und mit „👤 Person“ zuordnen'); } };
$('#spkSame').onclick = () => { commit(() => P.speakers.forEach(sp => sp.st = {}), false); styleOverlay(); renderSpeakers(); toast('Alle Personen sehen wieder gleich aus'); };

// ── Text eines Bereichs korrigieren ──
// Der neue Text wird auf die Zeit der markierten Stellen verteilt: gleiche Wortzahl → Wort für Wort,
// sonst nach Länge auf Wörter und nicht erkannte Stellen (🗣); fehlende Wörter lassen sich so ergänzen.
function rangeSlots(ids){
  let slots = ids.filter(i => tokens[i].type === 'word' || tokens[i].type === 'unk' || P.edits[i]);
  if (!slots.length) slots = ids.filter(i => tokens[i].type === 'pause');
  return slots;
}
function rangeText(ids){ return rangeSlots(ids).map(i => tokText(tokens[i])).filter(Boolean).join(' '); }
function applyRangeText(ids, text){
  const slots = rangeSlots(ids); if (!slots.length) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean);
  const wordSlots = slots.filter(i => tokens[i].type === 'word');
  const set = (i, v) => { if (tokens[i].type === 'word' && v === tokens[i].text) delete P.edits[i]; else if (tokens[i].type !== 'word' && !v) delete P.edits[i]; else P.edits[i] = v; };
  if (words.length === wordSlots.length && wordSlots.length){
    wordSlots.forEach((i, k) => set(i, words[k])); slots.filter(i => tokens[i].type !== 'word').forEach(i => set(i, ''));
    return words.length; }
  // Verteilung nach Zeit: jedes Wort an die Stelle, in deren Zeitanteil seine Mitte (nach Zeichen) fällt
  const dur = slots.map(i => Math.max(0.05, wE(tokens[i]) - wS(tokens[i]))), T = dur.reduce((a, b) => a + b, 0);
  const total = words.reduce((n, w) => n + w.length + 1, 0), groups = slots.map(() => []);
  let pos = 0;
  for (const w of words){
    const mid = (pos + (w.length + 1) / 2) / total * T; pos += w.length + 1;
    let acc = 0, k = 0; while (k < slots.length - 1 && acc + dur[k] < mid){ acc += dur[k]; k++; }
    groups[k].push(w);
  }
  slots.forEach((i, k) => set(i, groups[k].join(' ')));
  return words.length;
}
function openRangeEdit(ids){
  ids = ids.filter(i => !deleted.has(i)); if (!ids.length) return toast('Nur gelöschte Wörter markiert');
  const body = $('#sheetBody'), cur = rangeText(ids);
  body.innerHTML = `<h3>Text korrigieren</h3><textarea id="rangeEdit" rows="3" style="width:100%;font:18px/1.4 var(--read)"></textarea>
    <p class="muted small">Am Schnitt ändert sich nichts. Gleiche Wortzahl: Wort für Wort ersetzt. Sonst wird der Text auf die Zeit der markierten Stellen verteilt –
    so lassen sich Wörter zusammenschreiben oder fehlende Wörter ergänzen (am besten die 🗣-Stelle mit markieren). Erscheint so auch in den Untertiteln.</p>
    <div class="row"><button class="btn" id="rangeReset">↺ Original</button><button class="btn primary" id="rangeOk" style="margin-left:auto">Fertig</button></div>`;
  $('#rangeEdit').value = cur; openSheet(false); setTimeout(() => { $('#rangeEdit').focus(); $('#rangeEdit').select(); }, 30);
  const done = reset => { const v = $('#rangeEdit').value; closeSheet();
    commit(() => { if (reset) ids.forEach(i => delete P.edits[i]); else applyRangeText(ids, v); regenCuesFor(ids); }, false);
    afterTextEdit(reset ? 'Originaltext' : 'Text übernommen'); clearSel(); };
  $('#rangeOk').onclick = () => done(false); $('#rangeReset').onclick = () => done(true);
  $('#rangeEdit').onkeydown = ev => { if (ev.key === 'Enter' && !ev.shiftKey){ ev.preventDefault(); done(false); } };
  body.onclick = null;
}
// Stellen, die vorher keinen Untertitel hatten (🗣/⏸ mit neuem Text), dem passenden Untertitel zuordnen
function regenCuesFor(ids){
  for (const i of ids){ if (!isTextTok(i) || P.cues.some(c => !c.own && i >= c.a && i <= c.b)) continue;
    const c = P.cues.filter(c => !c.own && c.b < i).pop(); if (c) c.b = i; }
}
$('#selEdit').onclick = () => openRangeEdit(selIds());
$('#selClose').onclick = clearSel;
$('#selDel').onclick = () => {
  const ids = selIds(); if (!ids.length) return;
  const gone = i => deleted.has(i) || (tokens[i].type === 'word' && isSrcDeleted((tokens[i].ws + tokens[i].we) / 2));
  const restoreIt = ids.every(gone);
  commit(() => { ids.forEach(i => { if (restoreIt){ deleted.delete(i); removeDel(tokens[i].s, tokens[i].e); } else deleted.add(i); });
    if (!restoreIt) tidyPauses(ids).forEach(i => deleted.add(i)); }, false);
  tokens.forEach(t => paint(t.i));
  const at = tokens[ids[0]]; clearSel();
  let nxt = Math.max(...ids) + 1; while (nxt < tokens.length && tokens[nxt].type === 'pause') nxt++;
  toast(restoreIt ? 'Wiederhergestellt' : (!restoreIt && tokens[nxt] && tokens[nxt].type === 'unk' && !deleted.has(nxt) ? 'Gelöscht – danach folgt nicht erkannte Sprache (🗣), ggf. mitlöschen' : 'Gelöscht'));
  lastCut = srcToOut(snapSrc(at.s));
};
// Nach dem Löschen: Pausen, die nun leer im Raum stehen, mitlöschen.
// – Am Anfang einer Quelle (davor kein behaltenes Wort): alle Pausen bis zum nächsten behaltenen Wort.
// – Am Ende einer Quelle entsprechend.  – Mittendrin: aus zwei aufeinanderfolgenden Pausen wird eine.
function tidyPauses(ids){
  const del = new Set(ids), extra = new Set(), gone = i => deleted.has(i) || del.has(i) || extra.has(i);
  const sorted = [...del].sort((a, b) => a - b), groups = [];
  for (const i of sorted){ const g = groups[groups.length-1]; if (g && i <= g[1] + 1) g[1] = i; else groups.push([i, i]); }
  for (const [a, b] of groups){
    const si = tokens[a].src, inSrc = i => i >= 0 && i < tokens.length && tokens[i].src === si;
    const keptWord = i => !gone(i) && tokens[i].type !== 'pause';
    let before = false; for (let i = a - 1; inSrc(i); i--) if (keptWord(i)){ before = true; break; }
    let after = false; for (let i = b + 1; inSrc(i); i++) if (keptWord(i)){ after = true; break; }
    if (!before){
      for (let i = a - 1; inSrc(i); i--) if (tokens[i].type === 'pause' && !gone(i)) extra.add(i);
      for (let i = b + 1; inSrc(i) && !keptWord(i); i++) if (tokens[i].type === 'pause' && !gone(i)) extra.add(i);
    } else if (!after){
      for (let i = b + 1; inSrc(i); i++) if (tokens[i].type === 'pause' && !gone(i)) extra.add(i);
      for (let i = a - 1; inSrc(i) && !keptWord(i); i--) if (tokens[i].type === 'pause' && !gone(i)) extra.add(i);
    } else {
      let L = a - 1; while (inSrc(L) && gone(L)) L--;
      let Rr = b + 1; while (inSrc(Rr) && gone(Rr)) Rr++;
      if (inSrc(L) && inSrc(Rr) && tokens[L].type === 'pause' && tokens[Rr].type === 'pause') extra.add(Rr);
    }
  }
  return [...extra];
}
// Den letzten Schnitt anhören: 2 s davor bis 2 s danach
let lastCut = null;
$('#selPlay').onclick = () => { const ids = selIds(); if (!ids.length) return; const t = tokens[ids[0]]; const a = srcToOut(snapSrc(t.ws ?? t.s)); seekOut(Math.max(0, a - 0.5), false); startPlay(); };
$('#cutPlayBtn').onclick = () => { if (lastCut == null) return toast('Noch kein Schnitt'); seekOut(Math.max(0, lastCut - 2), false); startPlay(); stopAt = lastCut + 2; };
const fillerIds = (minTok = 0) => tokens.filter(t => t.i >= minTok && t.type === 'word' && !deleted.has(t.i) && FILLER.test(norm(tokText(t)))).map(t => t.i);
function bulkDelete(ids){ ids.forEach(i => deleted.add(i)); tidyPauses(ids).forEach(i => deleted.add(i)); }
$('#fillerBtn').onclick = () => {
  const ids = fillerIds(0);
  if (!ids.length) return toast('Keine Füllwörter übrig');
  commit(() => bulkDelete(ids), false); tokens.forEach(t => paint(t.i)); toast(`${ids.length} Füllwörter entfernt`);
};
// Pausen kürzen (0 = ganz löschen)
function trimPauses(len, minTok = 0){
  const ids = tokens.filter(t => t.i >= minTok && t.type === 'pause' && !deleted.has(t.i) && t.e - t.s > len + 0.05 && (P.trims[t.i] == null || P.trims[t.i] > len)).map(t => t.i);
  ids.forEach(i => { if (len <= 0) deleted.add(i); else P.trims[i] = len; });
  return ids.length;
}
$('#pauseBtn').onclick = () => {
  const len = +$('#pauseLen').value; let n = 0;
  commit(() => n = trimPauses(len), false); tokens.forEach(t => paint(t.i));
  toast(n ? (len ? `${n} Pausen auf ${String(len).replace('.', ',')} s gekürzt` : `${n} Pausen gelöscht`) : 'Keine Pausen zu kürzen');
};
// Wiederholte Anläufe finden: „Ich wollte – ich wollte heute …“ → der frühere Anlauf wird gelöscht, der letzte bleibt.
const KEEP_REPEAT = new Set(['sehr','ganz','so','ja','nein','nee','immer','mehr','viel','gut','nie','wieder','nochmal','hallo','hey','bitte','danke','okay','ok',
  'der','die','das','den','dem','des','was','wer','sie','es','wir','ihr','er','man','dass','da','hier','jetzt','gerade','auch','noch','schon','mal']);
function findRepeats(minTok = 0){
  const ws = tokens.filter(t => t.i >= minTok && t.type === 'word' && !deleted.has(t.i) && tokText(t) && !isSrcDeleted((t.ws + t.we) / 2));
  const out = new Set();
  for (const g of repeatGroups(ws, t => tokText(t), (i, j) => ws[i].src === ws[j].src && ws[j].ws - ws[i].ws <= 30)){
    const from = ws[g.att[0][0]].i, to = ws[g.fin[0]].i;
    for (let i = from; i < to; i++) if (tokens[i].type !== 'pause' && !deleted.has(i)) out.add(i);
  }
  // Ganze Sätze, die gleich noch einmal (leicht anders) gesagt wurden: der frühere ist ein Anlauf
  const sents = []; let cur = [];
  for (const t of ws){ if (out.has(t.i)) continue; cur.push(t); if (sentEnd(tokText(t))){ sents.push(cur); cur = []; } }
  if (cur.length) sents.push(cur);
  const lcs = lcsLen;
  for (let k = 0; k < sents.length; k++){
    const A = sents[k]; if (A.length < 3) continue;
    const a = A.map(t => norm(tokText(t))).filter(Boolean);
    for (let j = k + 1; j < sents.length && j <= k + 4; j++){
      const B = sents[j];
      if (B[0].src !== A[0].src || B[0].ws - A[0].ws > 45) break;
      const b = B.map(t => norm(tokText(t))).filter(Boolean);
      if (b.length < 3 || a[0] !== b[0] || (a.length > 3 && a[1] !== b[1])) continue;
      const l = lcs(a, b.slice(0, a.length + 2));
      if (l / a.length >= 0.55){
        for (let i = A[0].i; i < B[0].i; i++) if (tokens[i].type !== 'pause' && !deleted.has(i)) out.add(i);
        k = j - 1; break;
      }
    }
  }
  // Nachgehörte Stellen (früher 🗣): als Ganzes ein Anlauf, wenn danach weitergesprochen wird
  for (let i = minTok; i < tokens.length; i++){
    const t = tokens[i]; if (!t.ug || deleted.has(i)) continue;
    let j = i; while (j + 1 < tokens.length && tokens[j+1].ug === t.ug) j++;
    let n = j + 1; while (n < tokens.length && tokens[n].type === 'pause') n++;
    if (n < tokens.length && tokens[n].src === t.src && tokens[n].type !== 'pause' && (t.att || t.ud >= 1.0)) for (let q = i; q <= j; q++) if (!deleted.has(q)) out.add(q);
    i = j;
  }
  // Nicht erkannte Sprache (🗣), auf die weitere Sprache folgt, ist fast immer ein ausgelassener Anlauf
  for (const t of tokens){
    if (t.i < minTok || t.type !== 'unk' || deleted.has(t.i)) continue;
    let j = t.i + 1; while (j < tokens.length && tokens[j].type === 'pause') j++;
    if (j < tokens.length && tokens[j].src === t.src && tokens[j].type !== 'pause' && (t.att || t.we - t.ws >= 1.0)) out.add(t.i);
  }
  return [...out];
}
$('#repeatBtn').onclick = () => {
  const ids = findRepeats(0); if (!ids.length) return toast('Keine Wiederholungen gefunden');
  commit(() => bulkDelete(ids), false); tokens.forEach(t => paint(t.i));
  const nu = ids.filter(i => tokens[i].type === 'unk').length;
  toast(`${ids.filter(isWord).length} Wörter${nu ? ` und ${nu} nicht erkannte Stellen (🗣)` : ''} aus wiederholten Anläufen gelöscht – Strg+Z macht es rückgängig`);
};
// Einstellungen „direkt nach der Transkription“ merken (nur für diesen Browser)
const AUTO_KEYS = ['autoFillers', 'autoRepeats', 'autoPauses', 'autoPauseLen'];
try { const a = J(localStorage.getItem('ts-auto2')); if (a) AUTO_KEYS.forEach(k => { const el = $('#' + k); if (el && a[k] != null){ if (el.type === 'checkbox') el.checked = a[k]; else el.value = a[k]; } }); } catch(_){}
AUTO_KEYS.forEach(k => $('#' + k).addEventListener('change', () => { try { localStorage.setItem('ts-auto2', JSON.stringify(Object.fromEntries(AUTO_KEYS.map(x => [x, $('#' + x).type === 'checkbox' ? $('#' + x).checked : $('#' + x).value])))); } catch(_){} }));
function autoClean(minTok){
  const msg = [];
  if ($('#autoFillers').checked){ const ids = fillerIds(minTok); bulkDelete(ids); if (ids.length) msg.push(`${ids.length} Füllwörter`); }
  if ($('#autoRepeats').checked){ const ids = findRepeats(minTok); bulkDelete(ids); if (ids.length) msg.push(`${ids.filter(isWord).length} Wörter aus Wiederholungen`); }
  if ($('#autoPauses').checked){ const n = trimPauses(+$('#autoPauseLen').value, minTok); if (n) msg.push(`${n} Pausen`); }
  return msg;
}
$('#hideDel').onchange = e => $('#transcript').classList.toggle('hide-del', e.target.checked);
let nowTok = -1;
function highlightNow(){
  if (tab !== 'text' || !tokens.length) return;
  const g = timeline[curSeg]; if (!g || g.kind !== 'main') return;
  const t = vT(); let lo = 0, hi = tokens.length - 1, k = -1;
  while (lo <= hi){ const m = (lo + hi) >> 1; if (tokens[m].s <= t){ k = m; lo = m + 1; } else hi = m - 1; }
  if (k === nowTok) return; if (nowTok >= 0 && spans[nowTok]) spans[nowTok].classList.remove('now'); nowTok = k;
  if (k >= 0 && spans[k]){ spans[k].classList.add('now'); const pane = scrollParent(spans[k]), b = spans[k].getBoundingClientRect(), pb = pane.getBoundingClientRect ? pane.getBoundingClientRect() : {top:0, bottom:innerHeight};
    if (b.top < pb.top + 20 || b.bottom > pb.bottom - 120) spans[k].scrollIntoView({block:'center', behavior:'smooth'}); }
}

// ───────── Suche im Text ─────────
let finds = [], findPos = -1;
function runFind(){
  spans.forEach(sp => sp && sp.classList.remove('hit'));
  const q = $('#findIn').value.trim().split(/\s+/).map(norm).filter(Boolean); finds = []; findPos = -1;
  if (!q.length){ $('#findInfo').textContent = ''; return; }
  const ws = tokens.filter(t => t.type === 'word');
  for (let i = 0; i + q.length <= ws.length; i++){
    let ok = true;
    for (let k = 0; k < q.length; k++){ const w = norm(tokText(ws[i + k])); if (k === q.length - 1 ? !w.startsWith(q[k]) : w !== q[k]){ ok = false; break; } }
    if (ok) finds.push([ws[i].i, ws[i + q.length - 1].i]);
  }
  finds.forEach(([a, b]) => { for (let i = a; i <= b; i++) spans[i] && spans[i].classList.add('hit'); });
  $('#findInfo').textContent = finds.length ? `${finds.length} Treffer` : 'nichts gefunden';
}
// Suchzeile ein-/ausklappen (Lupe, Strg+F)
function showFind(on){
  const r = $('#findRow'); if (on == null) on = r.classList.contains('hidden'); r.classList.toggle('hidden', !on); $('#findBtn').classList.toggle('on', on);
  if (!on){ $('#replRow').classList.add('hidden'); if ($('#findIn').value){ $('#findIn').value = ''; runFind(); } }
  else { $('#findIn').focus(); }
}
$('#findBtn').onclick = () => showFind();
// Seitlich scrollbare Leisten: am Ende verschwindet der Verlauf am rechten Rand
for (const el of $$('.toolbar,.sel-acts')){ const f = () => el.classList.toggle('end', el.scrollLeft + el.clientWidth >= el.scrollWidth - 2); el.addEventListener('scroll', f, {passive:true}); new ResizeObserver(f).observe(el); }
$('#textMore').onclick = e => {
  const r = e.currentTarget.getBoundingClientRect();
  showMenu(Math.min(r.left, innerWidth - 230), r.bottom + 4, [
    {icon: icon('🔊'), label: 'Lautstärke der Clips', fn: () => $('#volBtn').click()},
    {icon: icon('📋'), label: 'Text kopieren / Word', fn: () => $('#txChip').click()},
    {icon: icon('＋'), label: 'Video anhängen', fn: () => addSources()},
    {icon: icon('↻'), label: 'Am Ton ausrichten', fn: () => $('#realignBtn').click()},
  ]);
};
$('#findIn').addEventListener('input', runFind);
$('#findIn').addEventListener('keydown', e => {
  if (e.key === 'Escape'){ showFind(false); $('#findIn').blur(); return; }
  if (e.key !== 'Enter' || !finds.length) return;
  e.preventDefault(); findPos = (findPos + (e.shiftKey ? -1 : 1) + finds.length) % finds.length;
  const [a, b] = finds[findPos]; selA = a; selB = b; showSel(); spans[a].scrollIntoView({block:'center', behavior:'smooth'});
  if (!playing){ const t = tokens[a]; seekOut(srcToOut(snapSrc(t.ws ?? t.s)), false); }
  $('#findInfo').textContent = `${findPos + 1} von ${finds.length} · Entf löscht`;
  $('#findIn').blur();
});

// Ersetzen: korrigiert die Wörter (Zeiten bleiben), Satzzeichen am Ende bleiben erhalten
function replaceMatch([a, b], rep){
  const ids = []; for (let i = a; i <= b; i++) if (isWord(i) && tokText(tokens[i])) ids.push(i);
  if (!ids.length) return;
  const words = rep.trim().split(/\s+/).filter(Boolean);
  if (!words.length){ bulkDelete(ids); return; }
  const punct = (tokText(tokens[ids[ids.length-1]]).match(/[.,!?;:…]+$/) || [''])[0];
  if (punct && !/[.,!?;:…]$/.test(words[words.length-1])) words[words.length-1] += punct;
  ids.forEach((i, k) => { const v = words.length === ids.length ? words[k] : (k === 0 ? words.join(' ') : ''); if (v === tokens[i].text) delete P.edits[i]; else P.edits[i] = v; });
}
function afterTextEdit(msg){ tokens.forEach(t => paint(t.i)); runFind(); cueCache.at = -1; if (tab === 'subs') renderSubs(); if (msg) toast(msg); }
$('#replToggle').onclick = () => { const r = $('#replRow'); r.classList.toggle('hidden'); $('#replToggle').classList.toggle('on', !r.classList.contains('hidden')); if (!r.classList.contains('hidden')) ($('#findIn').value ? $('#replIn') : $('#findIn')).focus(); };
$('#replOne').onclick = () => {
  if (!finds.length) return toast('Kein Treffer');
  if (findPos < 0) findPos = 0;
  const m = finds[findPos]; commit(() => replaceMatch(m, $('#replIn').value), false); afterTextEdit('Ersetzt');
  if (finds.length){ findPos = Math.min(findPos, finds.length - 1); const [a, b] = finds[findPos]; selA = a; selB = b; showSel(); spans[a]?.scrollIntoView({block:'center', behavior:'smooth'}); }
};
$('#replAll').onclick = () => {
  if (!finds.length) return toast('Kein Treffer'); const n = finds.length, list = [...finds].reverse();
  commit(() => list.forEach(m => replaceMatch(m, $('#replIn').value)), false); afterTextEdit(`${n}× ersetzt`);
};
$('#findDelAll').onclick = () => {
  if (!finds.length) return toast('Kein Treffer'); const ids = []; finds.forEach(([a, b]) => { for (let i = a; i <= b; i++) ids.push(i); });
  const n = finds.length; commit(() => bulkDelete(ids), false); afterTextEdit(`${n} Treffer gelöscht`); clearSel();
};
$('#replIn').addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); (e.ctrlKey || e.metaKey ? $('#replAll') : $('#replOne')).click(); } if (e.key === 'Escape') $('#replIn').blur(); });
// Einzelnes Wort korrigieren: Doppelklick (bzw. Doppeltippen)
$('#transcript').addEventListener('dblclick', e => {
  const any = e.target.closest('.tk'); if (any && !any.classList.contains('word')){ const i = +any.dataset.i; selA = selB = i; showSel(); openRangeEdit([i]); return; }
  const sp = e.target.closest('.tk.word'); if (!sp) return; const i = +sp.dataset.i;
  const body = $('#sheetBody');
  body.innerHTML = `<h3>Wort korrigieren</h3><input type="text" id="wordEdit" style="width:100%;font:18px var(--read)"><p class="muted small">Die Zeit im Video bleibt gleich – nur der Text (auch in den Untertiteln) ändert sich. Leer lassen löscht das Wort.</p>
    <div class="row"><button class="btn" id="wordReset">↺ Original: </button><button class="btn primary" id="wordOk" style="margin-left:auto">Fertig</button></div>`;
  $('#wordEdit').value = tokText(tokens[i]); $('#wordReset').textContent += tokens[i].text;
  openSheet(false); setTimeout(() => { $('#wordEdit').focus(); $('#wordEdit').select(); }, 30);
  const done = v => { closeSheet(); commit(() => { if (v === null) delete P.edits[i]; else if (!v.trim()) bulkDelete([i]); else if (v.trim() === tokens[i].text) delete P.edits[i]; else P.edits[i] = v.trim(); }, false); afterTextEdit(); clearSel(); };
  $('#wordOk').onclick = () => done($('#wordEdit').value);
  $('#wordReset').onclick = () => done(null);
  $('#wordEdit').onkeydown = ev => { if (ev.key === 'Enter') done($('#wordEdit').value); };
  body.onclick = null;
});

// ───────── Schriften ─────────
// Mitgelieferte Untertitel-Schriften (feste fette Schnitte, core/web/fonts) und eigene, importierte Schriften
const FONTS = [
  {key:'', label:'Standard (Systemschrift)'},
  {key:'inter', label:'Inter', file:'Inter-Bold.ttf', family:'TS Inter'},
  {key:'montserrat', label:'Montserrat', file:'Montserrat-ExtraBold.ttf', family:'TS Montserrat'},
  {key:'poppins', label:'Poppins', file:'Poppins-Bold.ttf', family:'TS Poppins'},
  {key:'robotocondensed', label:'Roboto Condensed', file:'RobotoCondensed-Bold.ttf', family:'TS Roboto Condensed'},
  {key:'oswald', label:'Oswald', file:'Oswald-SemiBold.ttf', family:'TS Oswald'},
  {key:'bebas', label:'Bebas Neue', file:'BebasNeue-Regular.ttf', family:'TS Bebas Neue'},
  {key:'anton', label:'Anton', file:'Anton-Regular.ttf', family:'TS Anton'},
  {key:'archivo', label:'Archivo Black', file:'ArchivoBlack-Regular.ttf', family:'TS Archivo Black'},
  {key:'lora', label:'Lora (Serifen)', file:'Lora-Bold.ttf', family:'TS Lora'},
  {key:'playfair', label:'Playfair Display (Serifen)', file:'PlayfairDisplay-ExtraBold.ttf', family:'TS Playfair'},
];
let userFonts = [];   // {key, label, family, uri, user:true}
const fontOf = key => (key && (FONTS.find(f => f.key === key) || userFonts.find(f => f.key === key))) || FONTS[0];
const fontCss = key => fontOf(key).key ? `"TSF-${fontOf(key).key}", var(--ui)` : 'var(--ui)';
const fontWeight = (key, def = 700) => fontOf(key).key ? 400 : def;
const fontUrl = uri => TS.mediaUrl ? MEDIA(uri) : 'media?f=' + encodeURIComponent(uri);
const hashStr = s => { let h = 2166136261; for (let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
// Familienname (name-Tabelle) und Strichstärke (OS/2) einer TTF/OTF-Datei
function ttfTable(v, tag){ const n = v.getUint16(4);
  for (let i = 0; i < n; i++){ const r = 12 + i * 16; if (String.fromCharCode(v.getUint8(r), v.getUint8(r+1), v.getUint8(r+2), v.getUint8(r+3)) === tag) return v.getUint32(r + 8); }
  return -1; }
function ttfWeight(buf){ try { const v = new DataView(buf), o = ttfTable(v, 'OS/2'); return o < 0 ? 400 : v.getUint16(o + 4); } catch(_){ return 400; } }
function ttfFamily(buf){
  try {
    const v = new DataView(buf), off = ttfTable(v, 'name');
    if (off < 0) return '';
    const cnt = v.getUint16(off + 2), str = off + v.getUint16(off + 4); const found = {};
    for (let i = 0; i < cnt; i++){
      const r = off + 6 + i * 12, pid = v.getUint16(r), id = v.getUint16(r + 6), len = v.getUint16(r + 8), o = str + v.getUint16(r + 10);
      if (id !== 1 && id !== 16) continue;
      let t = '';
      if (pid === 3 || pid === 0){ for (let k = 0; k < len; k += 2) t += String.fromCharCode(v.getUint16(o + k)); }
      else if (pid === 1){ for (let k = 0; k < len; k++) t += String.fromCharCode(v.getUint8(o + k)); }
      if (t && (!found[id] || pid === 3)) found[id] = t;
    }
    return found[1] || found[16] || '';
  } catch(_){ return ''; }
}
let fontsLoading = null;
function loadUserFonts(){
  if (!TS.fonts) return Promise.resolve();
  return fontsLoading = (async () => {
    const list = J(TS.fonts()) || [];
    userFonts = userFonts.filter(f => list.some(x => x.uri === f.uri));
    for (const f of list){
      const key = 'u' + hashStr(f.uri); if (userFonts.some(x => x.key === key)) continue;
      try {
        const buf = await (await fetch(fontUrl(f.uri))).arrayBuffer();
        const family = ttfFamily(buf) || f.name.replace(/\.[^.]+$/, '');
        const ff = new FontFace('TSF-' + key, buf); await ff.load(); document.fonts.add(ff);
        userFonts.push({key, label: family, family, uri: f.uri, user: true, bold: ttfWeight(buf) >= 600});
      } catch(e){ console.warn('Schrift nicht lesbar', f.name, e); }
    }
    fillFontSelects(); if (P) styleOverlay();
  })();
}
function fillFontSelects(){
  for (const sel of $$('select.font-sel, #stFont')){
    const keep = sel.value; sel.innerHTML = '';
    for (const f of FONTS.concat(userFonts)){ const o = document.createElement('option'); o.value = f.key; o.textContent = f.label + (f.user ? ' (eigene)' : ''); sel.append(o); }
    const o = document.createElement('option'); o.value = '__import'; o.textContent = '＋ Eigene Schrift importieren …'; sel.append(o);
    sel.value = keep && [...sel.options].some(x => x.value === keep) ? keep : '';
  }
  if (P) $('#stFont').value = S().font && fontOf(S().font).key ? S().font : '';
}
async function importFont(){
  if (!TS.fonts) return toast('Eigene Schriften gibt es in dieser Version noch nicht'), null;
  const r = await pickMedia('font'); if (!r) return null;
  await loadUserFonts();
  const f = userFonts.find(x => x.uri === r.uri);
  if (!f){ toast('Diese Datei konnte nicht als Schrift gelesen werden'); return null; }
  toast(`Schrift „${f.label}“ importiert`); return f;
}
function setSubFont(key){ commit(() => { S().font = key; }, false); styleOverlay(); fillFontSelects(); }
$('#stFont').addEventListener('change', async e => {
  if (e.target.value === '__import'){ const f = await importFont(); if (f) setSubFont(f.key); else fillFontSelects(); return; }
  setSubFont(e.target.value);
});
// Übersicht mit Vorschau: antippen wählt die Schrift für die Untertitel
function openFontSheet(){
  const body = $('#sheetBody'); body.innerHTML = '<h3>Schrift der Untertitel</h3><div class="font-list"></div><div class="row" style="margin-top:12px"><button class="btn" id="fontImp">＋ Eigene Schrift importieren …</button><span class="muted small">TTF oder OTF, bleibt für alle Projekte verfügbar</span></div>';
  const list = body.querySelector('.font-list'), cur = S().font || '';
  for (const f of FONTS.concat(userFonts)){
    const row = document.createElement('div'); row.className = 'font-row' + (f.key === cur ? ' on' : '');
    row.innerHTML = `<span class="fprev"></span><span class="fname"></span>${f.user ? '<button class="mini fdel" title="Schrift entfernen">✕</button>' : ''}`;
    row.querySelector('.fprev').textContent = 'Untertitel 123 – Äöü'; row.querySelector('.fprev').style.fontFamily = fontCss(f.key); row.querySelector('.fprev').style.fontWeight = fontWeight(f.key);
    row.querySelector('.fname').textContent = f.label;
    row.onclick = e => {
      if (e.target.closest('.fdel')){ if (!confirm(`Schrift „${f.label}“ entfernen?`)) return; TS.deleteFont && TS.deleteFont(f.uri); userFonts = userFonts.filter(x => x !== f); if (S().font === f.key) setSubFont(''); fillFontSelects(); openFontSheet(); return; }
      setSubFont(f.key); openFontSheet();
    };
    list.append(row);
  }
  $('#fontImp').onclick = async () => { const f = await importFont(); if (f){ setSubFont(f.key); openFontSheet(); } };
  sheetItem = null; openSheet();
}
$('#fontBtn').onclick = () => openFontSheet();
// Für den Export: welche Schriften gebraucht werden und wo die Dateien liegen
function planFonts(keys){
  const out = {};
  for (const k of new Set(keys.filter(Boolean))){ const f = fontOf(k); if (!f.key) continue;
    out[k] = f.user ? {family: f.family, uri: f.uri, bold: !!f.bold} : {family: f.family, file: f.file}; }
  return out;
}

// ───────── Untertitel ─────────
const S = () => P.sub_style;
const isWord = i => tokens[i] && tokens[i].type === 'word';
// Wort für die Untertitel: erkannte Wörter und Stellen (🗣/⏸), in die von Hand Text eingetragen wurde
const isTextTok = i => tokens[i] && (tokens[i].type === 'word' || !!(P.edits && P.edits[i]));
const wS = t => t.ws ?? t.s, wE = t => t.we ?? t.e;
// Weggeschnitten: im Text gelöscht oder in der Zeitleiste herausgeschnitten
const isCut = i => deleted.has(i) || isSrcDeleted((wS(tokens[i]) + wE(tokens[i])) / 2);
// Wörter eines Untertitels; weggeschnittene mit „Untertitel behalten“ (ks) bleiben im Untertitel
function cueWords(c){ const ids = []; for (let i = c.a; i <= c.b && i < tokens.length; i++) if (isTextTok(i) && tokText(tokens[i]) && (!isCut(i) || tokens[i].ks)) ids.push(i); return ids; }
// ── Sprecher:innen ──
const SPK_COL = ['#E5402A', '#3E8A55', '#CFC6B0', '#6F9BE8', '#C58BE8', '#E8B43D', '#5EC4C4'];
const spkOf = id => id ? (P.speakers || []).find(x => x.id === id) || null : null;
const spkCol = sp => SPK_COL[Math.max(0, (P.speakers || []).indexOf(sp)) % SPK_COL.length];
function cueSpk(c){
  if (!c) return null; if (c.spk) return spkOf(c.spk); if (c.own) return null;
  for (let i = c.a; i <= c.b && i < tokens.length; i++) if (isTextTok(i) && tokText(tokens[i])) return spkOf(tokens[i].spk);
  return null;
}
// Stil eines Untertitels: Grundeinstellung, darüber die Abweichungen der Person
function cueStyle(c){ const sp = cueSpk(c); return sp && sp.st ? {...S(), ...sp.st} : S(); }
// Untertitel mit automatischem Text an Personenwechseln teilen
function splitCuesBySpeaker(){
  for (let k = 0; k < P.cues.length; k++){
    const c = P.cues[k]; if (c.own || c.text != null || isFree(c)) continue;
    let prev = null;
    for (let i = c.a; i <= c.b && i < tokens.length; i++){
      if (!isTextTok(i) || !tokText(tokens[i])) continue;
      const sp = tokens[i].spk || '';
      if (prev != null && sp !== prev){ const c2 = {...c, id:newId(), a:i, b:c.b}; delete c2.x; delete c2.y; c.b = i - 1; P.cues.splice(k + 1, 0, c2); break; }
      prev = sp;
    }
  }
}
function autoText(c){ return cueWords(c).map(i => tokText(tokens[i])).join(' '); }
function cueText(c){ return c.own ? (c.text || '') : c.text != null ? c.text : autoText(c); }
// Untertitel erzeugen – ab Token startTok (beim Anhängen weiterer Videos), sonst alle neu
function genCues(startTok = 0){
  const st = S(), keep = startTok ? P.cues.filter(c => !c.own && c.a < startTok) : [], own = P.cues.filter(c => c.own);
  const ws = tokens.filter(t => t.i >= startTok && isTextTok(t.i) && tokText(t) && !deleted.has(t.i)).map(t => t.type === 'word' ? t : {...t, ws: wS(t), we: wE(t)});
  let out = [];
  if (st.mode === 'word'){
    out = ws.map((w, k) => ({id:newId(), a: k ? ws[k-1].i + 1 : startTok, b: k === ws.length - 1 ? tokens.length - 1 : w.i, text:null, ds:0, de:0, off:false}));
  } else {
    const maxChars = (+st.chars || 32) * (+st.lines || 2), maxDur = +st.dur || 4;
    let cur = null, len = 0, lastEnd = 0;
    for (const w of ws){
      if (cur){
        const prev = tokens[cur.b], nl = len + 1 + tokText(w).length;
        const endS = /[.?!…]$/.test(tokText(prev)) && len > maxChars * 0.35, comma = /[,;:]$/.test(tokText(prev)) && len > maxChars * 0.7;
        if (nl > maxChars || w.we - cur.t0 > maxDur || endS || comma || w.ws - lastEnd > 0.8 || w.src !== prev.src || (w.spk || '') !== (prev.spk || '')){ out.push(cur); cur = null; }
      }
      if (!cur){ cur = {id:newId(), a: out.length ? out[out.length-1].b + 1 : startTok, b:w.i, text:null, ds:0, de:0, off:false, t0:w.ws}; len = tokText(w).length; }
      else { cur.b = w.i; len += 1 + tokText(w).length; }
      lastEnd = w.we;
    }
    if (cur) out.push(cur);
    const lenOf = ids => ids.reduce((n, i) => n + tokText(tokens[i]).length + 1, 0);
    for (let k = 1; k < out.length; k++){
      const prev = out[k-1], c = out[k]; const pw = cueWords(prev), cw = cueWords(c);
      if (/[.?!…]$/.test(tokens[prev.b] ? tokText(tokens[prev.b]) : '') || lenOf(cw) > maxChars * 0.3) continue;
      while (pw.length > 2 && lenOf(cw) + tokText(tokens[pw[pw.length-1]]).length < lenOf(pw) - tokText(tokens[pw[pw.length-1]]).length){
        const w = pw.pop(); cw.unshift(w); prev.b = pw[pw.length-1]; c.a = prev.b + 1; }
    }
    if (out.length) out[out.length-1].b = tokens.length - 1;
    out.forEach(c => delete c.t0);
  }
  if (keep.length && out.length){ const last = keep[keep.length-1]; if (last.b >= startTok) last.b = startTok - 1; }
  P.cues = keep.concat(out, own);
}
// ── Übersetzung der Untertitel: P.trans = {lang, mode: both|only|off, map: {Originaltext: Übersetzung}} ──
const trKey = t => String(t || '').replace(/\s+/g, ' ').trim();
function trOf(text){ const t = P && P.trans; if (!t || !t.map || t.mode === 'off') return null; const v = t.map[trKey(text)]; return v == null || !v.trim() ? null : v; }
// Text, wie er im Bild steht (Vorschau und Export)
function subDisplay(text){
  const tr = trOf(text); if (tr == null) return wrapText(text);
  if (P.trans.mode === 'only') return wrapText(tr);
  const st = S(), max = Math.max(+st.chars || 32, 24);
  return wrapText(text) + '\n' + (tr.length > max * 1.15 ? (() => { const mid = tr.length / 2; let b = -1; for (let i = 0; i < tr.length; i++) if (tr[i] === ' ' && (b < 0 || Math.abs(i - mid) < Math.abs(b - mid))) b = i; return b < 0 ? tr : tr.slice(0, b) + '\n' + tr.slice(b + 1); })() : tr);
}
// Untertitel zu Sätzen bündeln, Satz für Satz übersetzen und die Übersetzung wieder auf die einzelnen Untertitel verteilen
// (nach Textlänge, an Wortgrenzen) – Bruchstücke einzeln zu übersetzen ergäbe schiefe Sätze.
function trGroups(list){
  const out = []; let cur = [];
  list.forEach((x, k) => { cur.push(x); const n = list[k + 1], txt = trKey(x.text);
    if (!n || /[.!?…:;]["»«”“')\]]*$/.test(txt) || n.s - x.e > 1.2 || cur.length >= 6){ out.push(cur); cur = []; } });
  return out;
}
function trSpread(group, tr){
  const words = tr.split(/\s+/).filter(Boolean), n = group.length; if (n === 1 || !words.length) return [tr];
  const lens = group.map(x => trKey(x.text).length || 1), tot = lens.reduce((a, b) => a + b, 0), W = words.reduce((a, w) => a + w.length + 1, 0);
  const out = Array.from({length: n}, () => []); let acc = 0, g = 0, cum = lens[0] / tot * W;
  words.forEach((w, i) => {
    const mid = acc + (w.length + 1) / 2, left = words.length - i;
    while (g < n - 1 && out[g].length && (mid > cum || n - 1 - g >= left)) { g++; cum += lens[g] / tot * W; }
    out[g].push(w); acc += w.length + 1;
  });
  return out.map(p => p.join(' '));
}
function runTranslate(){
  if (!P) return; const list = computedCues(); if (!list.length) return toast('Noch keine Untertitel');
  const lang = $('#trLang').value || 'en', src = (P.language || 'de').slice(0, 2);
  if (src === lang) return toast('Die Untertitel sind schon in dieser Sprache');
  const groups = trGroups(list), texts = groups.map(g => g.map(x => trKey(x.text)).join(' '));
  let jid; try { jid = TS.translate(JSON.stringify(texts), src, lang); } catch(e){ return toast('Übersetzen nicht möglich: ' + (e.message || e)); }
  $('#trBtn').disabled = true; $('#trStop').classList.remove('hidden'); $('#trProg').classList.remove('hidden'); $('#trMsg').textContent = 'Wird vorbereitet …';
  $('#trStop').onclick = () => TS.cancel(jid);
  const end = () => { $('#trBtn').disabled = false; $('#trStop').classList.add('hidden'); $('#trProg').classList.add('hidden'); };
  watchJob(jid, j => { $('#trProg i').style.width = Math.round((j.progress || 0) * 100) + '%'; $('#trMsg').textContent = j.message || ''; },
    j => { end(); const res = (j.result && j.result.texts) || [];
      commit(() => { const map = {}; groups.forEach((g, k) => { const parts = trSpread(g, String(res[k] || '').trim()); g.forEach((x, i) => { if (parts[i]) map[trKey(x.text)] = parts[i]; }); });
        P.trans = {lang, mode: (P.trans && P.trans.mode !== 'off' && P.trans.mode) || 'both', map}; }, false);
      paintTrans(); cueCache.at = -1; seekOut(outPos, false); if (tab === 'subs') renderSubs();
      $('#trMsg').textContent = `${Object.keys(P.trans.map).length} Untertitel übersetzt`; toast('Übersetzung fertig – unten bei jedem Untertitel nachbessern'); },
    j => { end(); $('#trMsg').textContent = j.status === 'cancelled' ? 'Abgebrochen' : 'Fehlgeschlagen: ' + (j.error || ''); });
}
function paintTrans(){
  if (!P) return; const t = P.trans, n = t && t.map ? Object.keys(t.map).length : 0;
  $('#trMode').value = t ? t.mode || 'both' : 'both'; $('#trMode').disabled = !n;
  if (t && t.lang) $('#trLang').value = t.lang;
  $('#trBtn').textContent = n ? 'Neu übersetzen' : 'Übersetzung erzeugen';
  if (!$('#trProg').classList.contains('hidden')) return;
  const missing = n ? computedCues().filter(x => trOf(x.text) == null).length : 0;
  $('#trMsg').textContent = !n ? '' : missing ? `${missing} Untertitel noch ohne Übersetzung (geändert?) – „Neu übersetzen“ oder unten ergänzen` : `${n} Untertitel übersetzt`;
}
$('#trBtn').onclick = () => { if (P && P.trans && P.trans.map && Object.keys(P.trans.map).length && !confirm('Die Übersetzung neu erzeugen? Eigene Verbesserungen gehen dabei verloren.')) return; runTranslate(); };
$('#trMode').onchange = () => { if (!P || !P.trans) return; commit(() => { P.trans.mode = $('#trMode').value; }, false); cueCache.at = -1; seekOut(outPos, false); paintTrans(); if (tab === 'subs') renderSubs(); };
function wrapText(text){
  const st = S(), max = +st.chars || 32, lines = +st.lines || 2;
  text = text.replace(/[ \t]+/g, ' ').trim();
  if (text.includes('\n') || st.mode === 'word' || lines < 2 || text.length <= max) return text;
  const mid = text.length / 2; let best = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? text : text.slice(0, best) + '\n' + text.slice(best + 1);
}
// Frei gesetzte Zeit (fa = Anker in der Quelle, fd = Dauer im Ergebnis): unabhängig von den Wortzeiten, ändert nichts am Schnitt
const isFree = c => c && c.fa != null;
// Eigene Untertitel (own): im Studio angelegt oder vom Text gelöst – eigener Text, eigene Zeit, unabhängig vom Transkript
// in zeitlicher Reihenfolge einsortieren (für die Liste im Untertitel-Reiter)
function insertCue(c){ const t = cueTimes(c), k = t ? P.cues.findIndex(x => { const u = cueTimes(x); return u && u.s > t.s; }) : -1; if (k < 0) P.cues.push(c); else P.cues.splice(k, 0, c); }
function newOwnCue(s, e, text){ const c = {id:newId(), own:true, text: text || '', ds:0, de:0, off:false}; setCueFree(c, s, e); return c; }
function detachCue(c){ if (c.own) return true; const t = cueTimes(c); if (!t) return false; c.text = cueText(c); setCueFree(c, t.s, t.e); c.own = true; delete c.a; delete c.b; return true; }
// Eigenen Untertitel am Textanteil pos (0…1) in zwei teilen
function splitOwnCue(c, left, right){
  const t = cueTimes(c); if (!t || !left || !right) return null;
  const m = t.s + (t.e - t.s) * clamp(left.length / (left.length + right.length), 0.15, 0.85);
  const c2 = newOwnCue(m, t.e, right); if (c.x != null){ c2.x = c.x; c2.y = c.y; } c.text = left; setCueFree(c, t.s, m); return c2;
}
function cueTimes(c){
  if (c.own){ if (c.fa == null) return null; const s = srcToOut(snapSrc(c.fa)); if (s >= total) return null;
    return {s, e: Math.min(total, s + Math.max(0.2, c.fd || 1)), src: c.fa, free:true}; }
  const ids = cueWords(c); if (!ids.length) return null;
  if (isFree(c)){ const s = srcToOut(snapSrc(c.fa)); return {s, e: Math.min(total, s + Math.max(0.2, c.fd || 1)), src: c.fa, free:true}; }
  const w0 = tokens[ids[0]], w1 = tokens[ids[ids.length-1]];
  let s = srcToOut(wS(w0)) + (c.ds || 0), e = srcToOut(wE(w1)) + (c.de || 0);
  if (e < s || e - s > (wE(w1) - wS(w0)) + 0.5){ const g = timeline[segAtOut(s - (c.ds || 0))]; e = (g ? g.o + segDur(g) : s + 1) + (c.de || 0); }
  for (const g of timeline) if (g.kind === 'insert' && s < g.o && e > g.o) e = g.o;   // nicht in einen Einschub hineinlaufen
  return {s: Math.max(0, s), e: Math.max(s + 0.2, e), src: wS(tokens[ids[0]])};
}
// Untertitel auf feste Zeiten stellen (Ausgabezeit s … e)
function setCueFree(c, s, e){
  s = clamp(s, 0, Math.max(0, total - 0.2)); e = clamp(e, s + 0.2, total);
  c.fa = r3(outToSrcT(s)); c.fd = +(e - s).toFixed(2); c.ds = 0; c.de = 0;
}
function outToSrcT(o){
  const g = timeline[segAtOut(o)];
  if (!g || g.kind !== 'main'){ for (let k = segAtOut(o); k < timeline.length; k++) if (timeline[k].kind === 'main') return timeline[k].in; return srcTotal; }
  return g.in + clamp(o - g.o, 0, segDur(g)) * (g.speed || 1);
}
const cueXY = c => { if (c && c.x != null) return [c.x, c.y]; const sp = cueSpk(c); if (sp && sp.st && sp.st.y != null) return [sp.st.x ?? 0.5, sp.st.y]; return [S().x ?? 0.5, S().y ?? 0.88]; };
function computedCues(){
  const list = [];
  for (const c of P.cues){
    if (c.off) continue;
    // Automatischer Text: an Stellen teilen, an denen die Wörter im Ergebnis nicht mehr aufeinanderfolgen (verschobene Abschnitte)
    if (c.text == null && P.moves.length && !isFree(c)){
      const ids = cueWords(c); let run = [];
      const flush = () => { if (!run.length) return; const w0 = tokens[run[0]], w1 = tokens[run[run.length-1]];
        const s = srcToOut(wS(w0)) + (c.ds || 0), e = Math.max(s + 0.2, srcToOut(wE(w1)) + (c.de || 0));
        list.push({c, s: Math.max(0, s), e, text: run.map(i => tokText(tokens[i])).join(' ')}); run = []; };
      ids.forEach((i, k) => { if (k){ const p = tokens[ids[k-1]], w = tokens[i];
        if (Math.abs((srcToOut(wS(w)) - srcToOut(wE(p))) - (wS(w) - wE(p))) > 0.3) flush(); } run.push(i); });
      flush(); continue;
    }
    const t = cueTimes(c), text = cueText(c).trim(); if (!t || !text) continue;
    const kept = !c.own && c.text == null && !isFree(c) && cueWords(c).every(i => isCut(i));
    list.push({c, s:t.s, e:t.e, text, kept}); }
  list.sort((x, y) => x.s - y.s || (y.kept ? 1 : 0) - (x.kept ? 1 : 0));
  // Untertitel weggeschnittener Wörter („behalten“): kurz am Schnitt einblenden, der folgende beginnt etwas später
  let kEnd = -1;
  for (let k = 0; k < list.length; k++){ const x = list[k]; if (!x.kept) continue;
    if (x.s < kEnd) x.s = kEnd;
    const n = list.slice(k + 1).find(y => !y.kept && y.e > x.s);
    const D = n && n.s < x.s + 0.6 ? clamp((n.e - x.s) * 0.4, 0.12, 0.45) : 0.45;
    x.e = x.s + D; kEnd = x.e;
    if (n && n.s < x.e) n.s = x.e;
  }
  list.sort((x, y) => x.s - y.s);
  // Frei gesetzte Untertitel behalten ihre Zeit; ein folgender automatischer beginnt erst danach
  for (let k = 0; k < list.length - 1; k++){ const x = list[k];
    if (!isFree(x.c)) continue;
    for (let j = k + 1; j < list.length && list[j].s < x.e + 0.02; j++){ const n = list[j]; if (isFree(n.c)) continue;
      n.s = x.e + 0.02; if (n.e - n.s < 0.2) n.drop = true; }
  }
  for (let k = list.length - 1; k >= 0; k--) if (list[k].drop) list.splice(k, 1);
  list.sort((x, y) => x.s - y.s);
  for (let k = 0; k < list.length; k++){ const n = list[k+1];
    if (n && isFree(list[k].c) && !isFree(n.c)){ list[k].e = Math.min(list[k].e, total); continue; }
    if (n){ if (list[k].e > n.s - 0.02) list[k].e = Math.max(list[k].s + 0.2, n.s - 0.02); else if (n.s - list[k].e < 0.3) list[k].e = n.s - 0.02; }
    list[k].e = Math.min(list[k].e, total); }
  return list.filter(x => x.e - x.s > 0.05);
}
let cueCache = {at:-1, list:[]}, cueEls = new Map(), lastCue = null, shownCue = null, shownRange = null;
function updateSubs(o){
  const ov = $('#subOv');
  if (!P || !P.cues.length || S().enabled === false){ ov.textContent = ''; shownCue = null; return; }
  const now = performance.now(); if (now - cueCache.at > 400) cueCache = {at:now, list:computedCues()};
  const cur = cueCache.list.find(x => o >= x.s && o < x.e);
  if (!SubDrag.on){ ov.textContent = cur ? subDisplay(cur.text) : ''; const prevSp = cueSpk(shownCue); shownCue = cur ? cur.c : null; shownRange = cur ? [cur.s, cur.e] : null;
    if (cueSpk(shownCue) !== prevSp) styleOverlay(); else placeOverlay(); }
  const id = cur ? cur.c.id : null;
  if (id !== lastCue && tab === 'subs'){
    if (lastCue && cueEls.get(lastCue)) cueEls.get(lastCue).classList.remove('now');
    if (id && cueEls.get(id)){ cueEls.get(id).classList.add('now'); if (playing && document.activeElement?.tagName !== 'TEXTAREA') cueEls.get(id).scrollIntoView({block:'center', behavior:'smooth'}); }
  }
  lastCue = id;
}
// Schriftgröße wie im Export: Anteil an der kürzeren Bildseite
const SIZE_F = {klein:0.045, mittel:0.058, groß:0.075};
function subPx(w, h, st = S()){ return (SIZE_F[st.size] || 0.058) * Math.min(w, h) * (h > w ? 1.25 : 1); }
function styleOverlay(){
  if (!P) return;
  const ov = $('#subOv'), st = shownCue ? cueStyle(shownCue) : S(), stage = $('#stage');
  const px = subPx(stage.clientWidth || 1, stage.clientHeight || 1, st), o = Math.max(1, px / 14);
  ov.style.background = st.bg ? 'rgba(0,0,0,.6)' : ''; ov.style.borderRadius = st.bg ? (px * 0.18).toFixed(1) + 'px' : ''; ov.style.padding = st.bg ? `${(px * 0.1).toFixed(1)}px ${(px * 0.3).toFixed(1)}px` : '';
  ov.style.color = st.color; ov.style.fontSize = px.toFixed(1) + 'px'; ov.style.fontFamily = fontCss(st.font); ov.style.fontWeight = fontWeight(st.font);
  ov.style.textShadow = st.outline ? [[-1,-1],[1,-1],[-1,1],[1,1],[0,-1.4],[0,1.4],[-1.4,0],[1.4,0]].map(([x, y]) => `${(x*o).toFixed(1)}px ${(y*o).toFixed(1)}px 0 #000`).join(',') : `0 ${(px/20).toFixed(1)}px ${(px/10).toFixed(1)}px rgba(0,0,0,.8)`;
  placeOverlay();
}
// Untertitel an seine Position setzen und im Bild halten
function placeOverlay(){
  const ov = $('#subOv'), stage = $('#stage'); if (!P) return;
  let [x, y] = SubDrag.on ? [SubDrag.x, SubDrag.y] : cueXY(shownCue);
  if (!SubDrag.on && shownCue && shownCue.x == null && shownRange && window.subSlideY){ const sy = subSlideY(shownRange[0], shownRange[1]); if (sy != null) y = sy; }
  const W = stage.clientWidth, H = stage.clientHeight, bw = ov.offsetWidth, bh = ov.offsetHeight, m = 0.02;
  const cx = clamp(x * W, bw / 2 + m * W, W - bw / 2 - m * W), cy = clamp(y * H, bh / 2 + m * H, H - bh / 2 - m * H);
  ov.style.left = (bw > W * (1 - 2 * m) ? W / 2 : cx) + 'px'; ov.style.top = cy + 'px';
  ov.classList.toggle('grab', !!ov.textContent);
}
// Ziehen im Bild verschiebt die Untertitel – alle, oder den im Studio ausgewählten
const SubDrag = {on:false};
$('#subOv').addEventListener('pointerdown', e => {
  if (!$('#subOv').textContent) return;
  e.preventDefault(); e.stopPropagation(); $('#subOv').setPointerCapture(e.pointerId);
  const cue = (typeof TL !== 'undefined' && TL.sel && TL.sel.kind === 'cue') ? P.cues.find(c => c.id === TL.sel.id) : null;
  const [x, y] = cueXY(cue || shownCue);
  Object.assign(SubDrag, {on:true, moved:false, cue, x, y, x0:e.clientX, y0:e.clientY, sx:x, sy:y});
  if (playing) pausePlay();
});
$('#subOv').addEventListener('pointermove', e => {
  if (!SubDrag.on) return; const st = $('#stage').getBoundingClientRect();
  let x = SubDrag.sx + (e.clientX - SubDrag.x0) / st.width, y = SubDrag.sy + (e.clientY - SubDrag.y0) / st.height;
  if (Math.abs(e.clientX - SubDrag.x0) + Math.abs(e.clientY - SubDrag.y0) > 3) SubDrag.moved = true;
  if (Math.abs(x - 0.5) < 0.025) x = 0.5;                                          // mittig einrasten
  for (const v of Object.values(POS_Y)) if (Math.abs(y - v) < 0.015) y = v;
  SubDrag.x = clamp(x, 0, 1); SubDrag.y = clamp(y, 0, 1);
  $('#stage').classList.toggle('snap-x', SubDrag.x === 0.5); placeOverlay();
});
function endSubDrag(){
  if (!SubDrag.on) return; SubDrag.on = false; $('#stage').classList.remove('snap-x');
  if (!SubDrag.moved) return;
  const x = r3(SubDrag.x), y = r3(SubDrag.y), cue = SubDrag.cue;
  commit(() => { if (cue){ cue.x = x; cue.y = y; } else { S().x = x; S().y = y; S().pos = Object.keys(POS_Y).find(k => POS_Y[k] === y && x === 0.5) || 'frei'; } }, false);
  syncStyleInputs(); placeOverlay();
  toast(cue ? 'Position nur für diesen Untertitel' : 'Position für alle Untertitel' + (studioOn() ? ' – einzelne: Untertitel in der Zeitleiste auswählen, dann ziehen' : ''));
}
$('#subOv').addEventListener('pointerup', endSubDrag);
$('#subOv').addEventListener('pointercancel', endSubDrag);
$('#subOv').addEventListener('click', e => e.stopPropagation());
function syncStyleInputs(){
  const st = S(); $('#stChars').value = st.chars; $('#stLines').value = String(st.lines); $('#stDur').value = st.dur; $('#stSize').value = st.size;
  $('#stPos').value = POS_Y[st.pos] != null && st.x === 0.5 && st.y === POS_Y[st.pos] ? st.pos : 'frei';
  $('#stColor').value = st.color.toLowerCase(); $('#stOutline').checked = !!st.outline; $('#stMode').value = st.mode;
  $('#sideSubs').classList.toggle('on', st.enabled !== false); fillFontSelects();
  $('#subsMaster').checked = st.enabled !== false; $('#subsMasterLbl').textContent = st.enabled !== false ? 'Untertitel an' : 'Untertitel aus';
  $('#paneSubs').classList.toggle('subs-off', st.enabled === false); $('#paneSubs').classList.toggle('word-mode', st.mode === 'word');
  styleOverlay();
}
[['#stChars','chars',Number],['#stLines','lines',Number],['#stDur','dur',Number],['#stSize','size',String],['#stColor','color',v => v.toUpperCase()]]
  .forEach(([sel, key, conv]) => $(sel).addEventListener('change', e => { S()[key] = conv(e.target.value); styleOverlay(); changed(false); }));
$('#stPos').addEventListener('change', e => { const v = e.target.value; if (POS_Y[v] == null) return;
  const n = P.cues.filter(c => c.x != null).length;
  commit(() => { S().pos = v; S().x = 0.5; S().y = POS_Y[v]; if (n && confirm(`${n} Untertitel haben eine eigene Position. Auch diese zurücksetzen?`)) P.cues.forEach(c => { delete c.x; delete c.y; }); }, false); styleOverlay(); });
$('#stOutline').onchange = e => { S().outline = e.target.checked; styleOverlay(); changed(false); };
$('#subsMaster').onchange = e => { S().enabled = e.target.checked; syncStyleInputs(); changed(false); toast(e.target.checked ? 'Untertitel an' : 'Untertitel aus'); window.slSyncAll && slSyncAll(); };
function manualCount(){ return P.cues.filter(c => !c.own && ( c.text != null || c.ds || c.de || c.off || c.x != null || isFree(c))).length; }
$('#stMode').onchange = e => {
  const n = manualCount(); if (n && !confirm(`${n} Untertitel wurden von Hand bearbeitet. Beim Umstellen gehen diese Änderungen verloren. Fortfahren?`)){ e.target.value = S().mode; return; }
  S().mode = e.target.value; syncStyleInputs(); commit(() => genCues()); toast(P.cues.length + ' Untertitel');
};
$('#regenBtn').onclick = () => { const n = manualCount(); if (n && !confirm(`${n} Untertitel wurden von Hand bearbeitet. Neu aufteilen?`)) return; commit(() => genCues()); toast(P.cues.length + ' Untertitel'); };
function renderSubs(){
  const box = $('#cueList'); box.innerHTML = ''; cueEls = new Map(); lastCue = null;
  const frag = document.createDocumentFragment();
  P.cues.forEach((c, idx) => {
    const el = document.createElement('div'); el.className = 'cue'; el.dataset.id = c.id;
    el.innerHTML = `<div class="tm"><span class="t"></span><span class="w"></span></div><textarea rows="2"></textarea>
      <div class="acts"><button data-a="split">✂ teilen</button><button data-a="merge">⤓ zusammen</button><button data-a="off"></button>
      <button data-a="keep" class="hidden"></button><select class="cue-spk hidden" title="Person dieses Untertitels"></select>
      <button data-a="auto" class="hidden">↺ auto</button><button data-a="pos" class="hidden">↺ Position</button><button data-a="time" class="hidden">↺ Zeit</button><button data-a="s-">Start −</button><button data-a="s+">Start +</button><button data-a="e-">Ende −</button><button data-a="e+">Ende +</button></div>`;
    if (idx === P.cues.length - 1) el.querySelector('[data-a=merge]').disabled = true;
    if (P.trans && P.trans.map && P.trans.mode !== 'off'){ el.querySelector('textarea').insertAdjacentHTML('afterend', `<textarea rows="1" class="cue-tr" placeholder="${(P.trans.lang || 'en').toUpperCase()} – Übersetzung"></textarea>`);
      const tt = el.querySelector('.cue-tr'); tt.value = P.trans.map[trKey(cueText(c))] || '';
      tt.addEventListener('focus', () => tt._b = snapshot());
      tt.addEventListener('input', () => { const k = trKey(cueText(c)); if (tt.value.trim()) P.trans.map[k] = tt.value.trim(); else delete P.trans.map[k]; cueCache.at = -1; clearTimeout(saveT); saveT = setTimeout(saveNow, 800); });
      tt.addEventListener('blur', () => { if (tt._b && tt._b !== snapshot()){ undo.push(tt._b); redo = []; } tt._b = null; paintTrans(); }); }
    const ta = el.querySelector('textarea'); ta.value = cueText(c);
    ta.addEventListener('focus', () => ta._b = snapshot());
    ta.addEventListener('input', () => { const k0 = trKey(cueText(c)); c.text = c.own ? ta.value : ta.value.trim() === autoText(c) ? null : ta.value;
      if (P.trans && P.trans.map && P.trans.map[k0] != null){ const k1 = trKey(cueText(c)); if (k1 !== k0){ P.trans.map[k1] = P.trans.map[k0]; delete P.trans.map[k0]; } }
      paintCue(c, true); cueCache.at = -1; clearTimeout(saveT); saveT = setTimeout(saveNow, 800); });
    ta.addEventListener('blur', () => { if (ta._b && ta._b !== snapshot()){ undo.push(ta._b); redo = []; } ta._b = null; });
    frag.append(el); cueEls.set(c.id, el);
  });
  box.append(frag); P.cues.forEach(c => paintCue(c)); updateCount(); renderSpeakers(); paintTrans();
}
function paintCue(c, keepText){
  const el = cueEls.get(c.id); if (!el) return; const t = cueTimes(c), ta = el.querySelector('textarea');
  if (!keepText && document.activeElement !== ta) ta.value = cueText(c);
  el.classList.toggle('manual', c.text != null); el.classList.toggle('off', !!c.off); el.classList.toggle('empty', !t);
  el.querySelector('.t').textContent = t ? `${fmtS(t.s)} – ${fmtS(t.e)}` : 'Wörter gelöscht';
  el.querySelector('.w').textContent = [c.own ? 'eigener Untertitel' : isFree(c) ? 'Zeit frei gesetzt' : '', (c.ds || c.de) ? `Start ${c.ds >= 0 ? '+' : ''}${(c.ds||0).toFixed(1)} · Ende ${c.de >= 0 ? '+' : ''}${(c.de||0).toFixed(1)}` : '', c.x != null ? 'eigene Position' : ''].filter(Boolean).join(' · ');
  el.querySelector('[data-a=off]').textContent = c.off ? 'einblenden' : 'ausblenden';
  el.querySelector('[data-a=auto]').classList.toggle('hidden', c.text == null || !!c.own);
  el.querySelector('[data-a=pos]').classList.toggle('hidden', c.x == null);
  el.querySelector('[data-a=time]').classList.toggle('hidden', !!c.own || (!isFree(c) && !c.ds && !c.de));
  // weggeschnittene Wörter: Untertitel behalten
  const cut = c.own ? [] : range(c.a, Math.min(c.b, tokens.length - 1)).filter(i => isTextTok(i) && tokText(tokens[i]) && isCut(i)), kb = el.querySelector('[data-a=keep]');
  kb.classList.toggle('hidden', !cut.length); if (cut.length) kb.textContent = cut.every(i => tokens[i].ks) ? '💬 Untertitel wieder weg' : '💬 Untertitel behalten';
  el.classList.toggle('kept', !!cut.length && cut.every(i => tokens[i].ks));
  // Person
  const ss = el.querySelector('.cue-spk'); ss.classList.toggle('hidden', !P.speakers.length);
  if (P.speakers.length){ const auto = c.own ? null : (() => { const x = {...c}; delete x.spk; return cueSpk(x); })();
    ss.innerHTML = `<option value="">${auto ? '👤 ' + esc(auto.name) + ' (Text)' : c.own ? '👤 keine Person' : '👤 ohne Person'}</option>` + P.speakers.map(sp => `<option value="${sp.id}">👤 ${esc(sp.name)}</option>`).join('');
    ss.value = c.spk || ''; const sp = cueSpk(c); el.style.setProperty('--sc', sp ? spkCol(sp) : 'transparent'); }
}
function updateSubs2(){ P.cues.forEach(c => paintCue(c)); updateCount(); }
function updateCount(){ $('#subCount').textContent = computedCues().length + ' Untertitel'; }
function updateSubsList(){ if (tab === 'subs') updateSubs2(); }
$('#cueList').addEventListener('change', e => {
  const ss = e.target.closest('.cue-spk'); if (!ss) return; const c = P.cues.find(x => x.id === ss.closest('.cue').dataset.id); if (!c) return;
  commit(() => { if (ss.value) c.spk = ss.value; else delete c.spk; }, false); paintCue(c); styleOverlay();
});
$('#cueList').addEventListener('click', e => {
  const el = e.target.closest('.cue'); if (!el) return;
  const idx = P.cues.findIndex(c => c.id === el.dataset.id), c = P.cues[idx];
  const btn = e.target.closest('[data-a]');
  if (!btn){ if (e.target.closest('.tm')){ const t = cueTimes(c); if (t) seekOut(t.s + 0.01, false); } return; }
  const a = btn.dataset.a, ta = el.querySelector('textarea');
  if (a === 'keep'){ const cut = range(c.a, Math.min(c.b, tokens.length - 1)).filter(i => isTextTok(i) && tokText(tokens[i]) && isCut(i)); const on = !cut.every(i => tokens[i].ks);
    commit(() => keepSubs(cut, on), false); renderSubs(); if (spans.length) tokens.forEach(t => paint(t.i)); toast(on ? 'Untertitel bleibt – erscheint kurz am Schnitt' : 'Untertitel wieder weg'); return; }
  if (c.own && a === 'split'){
    const text = ta.value, pos = ta.selectionStart ?? 0, left = text.slice(0, pos).trim(), right = text.slice(pos).trim();
    if (!left || !right) return toast('Erst den Cursor an die Teilungsstelle setzen');
    commit(() => { const c2 = splitOwnCue(c, left, right); if (c2) P.cues.splice(idx + 1, 0, c2); });
  } else if (a === 'merge' && (c.own || (P.cues[idx+1] || {}).own)){
    const n = P.cues[idx+1]; if (!n) return; const t1 = cueTimes(c), t2 = cueTimes(n); if (!t1 || !t2) return;
    commit(() => { const txt = (cueText(c) + ' ' + cueText(n)).trim(); detachCue(c); c.text = txt; setCueFree(c, Math.min(t1.s, t2.s), Math.max(t1.e, t2.e)); P.cues.splice(idx + 1, 1); });
  } else if (a === 'split'){
    const ids = cueWords(c); if (ids.length < 2) return toast('Zu wenige Wörter');
    const text = ta.value, pos = ta.selectionStart ?? 0, left = text.slice(0, pos).trim(), right = text.slice(pos).trim();
    if (!left || !right) return toast('Erst den Cursor an die Teilungsstelle setzen');
    const k = Math.min(ids.length - 1, Math.max(1, left.split(/\s+/).length)), manual = c.text != null;
    commit(() => { const c2 = {id:newId(), a:ids[k-1] + 1, b:c.b, text: manual ? right : null, ds:0, de:isFree(c) ? 0 : c.de || 0, off:c.off, ...(c.x != null ? {x:c.x, y:c.y} : {})};
      c.b = ids[k-1]; c.text = manual ? left : null; c.de = 0; delete c.fa; delete c.fd; P.cues.splice(idx + 1, 0, c2); });
  } else if (a === 'merge'){
    const n = P.cues[idx+1]; if (!n) return;
    commit(() => { const manual = c.text != null || n.text != null; c.text = manual ? (cueText(c) + ' ' + cueText(n)).trim() : null; c.b = n.b; c.de = n.de || 0; c.off = c.off && n.off; delete c.fa; delete c.fd; P.cues.splice(idx + 1, 1); });
  } else if (a === 'off'){ commit(() => c.off = !c.off, false); paintCue(c); }
  else if (a === 'auto'){ commit(() => c.text = null, false); paintCue(c); }
  else if (a === 'pos'){ commit(() => { delete c.x; delete c.y; }, false); paintCue(c); placeOverlay(); }
  else if (a === 'time' && !c.own){ commit(() => { delete c.fa; delete c.fd; c.ds = 0; c.de = 0; }, false); cueCache.at = -1; updateSubs2(); }
  else { const t = cueTimes(c); if (!t) return; const d = a[1] === '+' ? 0.1 : -0.1;
    commit(() => { if (a[0] === 's') setCueFree(c, t.s + d, t.e); else setCueFree(c, t.s, t.e + d); if (c.lk) refreshLo(c); }, false); cueCache.at = -1; updateSubs2(); }
  cueCache.at = -1;
});

// ───────── Elemente (Clips, Zoom) ─────────
const TYPE_LBL = {broll:'B-Roll', insert:'Einschub', pip:'Einblendung', zoom:'Zoom', fx:'Anpassung', title:'Titel', audio:'Ton'};
let sheetItem = null, pinMode = false;
function openSheet(passive){ $('#sheet').classList.remove('hidden'); $('#sheet').classList.toggle('passive', !!passive); $('#sheetBack').classList.toggle('hidden', !!passive); }
function openItem(id){
  const it = P.items.find(x => x.id === id); if (!it) return; sheetItem = it;
  pausePlay(); seekOut(srcToOut(snapSrc(it.at)), false);
  const body = $('#sheetBody'); body.innerHTML = '';
  const h = document.createElement('h3'); h.textContent = TYPE_LBL[it.type]; body.append(h);
  if (it.type === 'zoom'){
    body.insertAdjacentHTML('beforeend', `
      <div class="field"><span>Art</span><div class="seg-ctl" id="zKind"><button data-v="punch">Sprung</button><button data-v="in">Fahrt rein</button><button data-v="out">Fahrt raus</button></div></div>
      <div class="field"><span>Stärke <b id="zStrV"></b></span><input type="range" id="zStr" min="1.05" max="1.8" step="0.05"></div>
      <div class="field"><span>Dauer</span><div class="nudge"><button data-z="-0.5">−0,5</button><button data-z="-0.1">−0,1</button><span class="val" id="zDur"></span><button data-z="0.1">+0,1</button><button data-z="0.5">+0,5</button></div></div>
      <div class="field"><span>Beginn</span><div class="nudge"><button data-at="-0.5">−0,5</button><button data-at="-0.1">−0,1</button><span class="val" id="zAt"></span><button data-at="0.1">+0,1</button><button data-at="0.5">+0,5</button></div></div>
      <p class="muted small">Mittelpunkt: ${FINE ? 'einfach ins Bild klicken' : 'einfach oben ins Bild tippen'}.</p>`);
  } else {
    body.insertAdjacentHTML('beforeend', `
      <div class="field"><span>Art</span><div class="seg-ctl" id="cMode"><button data-v="broll">B-Roll</button><button data-v="insert">Einschub</button><button data-v="pip">Einblendung</button></div></div>
      <div class="muted small" id="cName"></div>
      <video id="cPrev" playsinline controls preload="auto"></video>
      <div class="field"><span>Ausschnitt aus dem Clip</span>
        <div class="nudge"><span style="min-width:56px">Anfang</span><button data-cin="-0.5">−0,5</button><button data-cin="-0.04">−F</button><span class="val" id="cIn"></span><button data-cin="0.04">+F</button><button data-cin="0.5">+0,5</button><button class="btn" id="cInHere">= hier</button></div>
        <div class="nudge"><span style="min-width:56px">Ende</span><button data-cout="-0.5">−0,5</button><button data-cout="-0.04">−F</button><span class="val" id="cOut"></span><button data-cout="0.04">+F</button><button data-cout="0.5">+0,5</button><button class="btn" id="cOutHere">= hier</button></div>
      </div>
      <div class="field"><span>Position im Video</span><div class="nudge"><button data-at="-0.5">−0,5</button><button data-at="-0.1">−0,1</button><span class="val" id="cAt"></span><button data-at="0.1">+0,1</button><button data-at="0.5">+0,5</button></div></div>
      <div class="field volopt"><span>Lautstärke <b id="cVolV"></b></span><input type="range" id="cVol" min="0" max="200" step="5"></div>
      <div class="field pipopt"><span>Größe <b id="cSizeV"></b></span><input type="range" id="cSize" min="5" max="500" step="1"></div>
      <div class="field pipopt"><span>Platzieren</span><div class="seg-ctl" id="cCorner"><button data-v="ol">↖</button><button data-v="or">↗</button><button data-v="mm">Mitte</button><button data-v="ul">↙</button><button data-v="ur">↘</button><button data-v="full">Vollbild</button></div></div>
      <p class="muted small pipopt">Im Bild ziehen verschiebt, die Ecke unten rechts ändert die Größe${FINE ? ' (auch mit dem Mausrad)' : ''}. Mit Keyframes (Taste M) bewegt sich das Element über die Zeit.</p>`);
  }
  if (it.type !== 'zoom' && it.type !== 'audio') keyBlock(body, {it, get: () => it.key || null, set: k => { it.key = k; }, el: () => layers.get(it.id) || $('#cPrev'),
    uri: () => isImg(it.clip) ? null : it.clip.uri, hasOrig: () => !!it.clip.orig, applyMatte: m => { commit(() => swapClip(it, m), true); paintItem(); }, restoreOrig: () => { commit(() => restoreClip(it), true); paintItem(); }});
  body.insertAdjacentHTML('beforeend', `<div class="row" style="margin-top:12px"><button class="btn" id="itPlay">▶ Ansehen</button><button class="btn danger" id="itDel">Entfernen</button><button class="btn primary" id="itOk" style="margin-left:auto">Fertig</button></div>`);
  pinMode = it.type === 'zoom'; $('#stageHint').classList.toggle('hidden', !pinMode);
  openSheet(pinMode || it.type === 'pip' || it.type === 'broll');
  const cs = $('#cSize');
  if (cs){ cs.onpointerdown = () => { cs._b = snapshot(); };
    cs.oninput = () => { const rel = curRel(it), v = elVals(it, rel) || coverVals(it); setElVals(it, rel, {x: v.x, y: v.y, w: +cs.value / 100}); seekOut(outPos, false); paintItem(); };
    cs.onchange = () => { if (cs._b){ undo.push(cs._b); redo = []; cs._b = null; } changed(false); }; }
  const cv = $('#cVol');
  if (cv){ cv.onpointerdown = () => { cv._b = snapshot(); };
    cv.oninput = () => { it.vol = +cv.value / 100; paintItem(); };
    cv.onchange = () => { if (cv._b){ undo.push(cv._b); redo = []; cv._b = null; } changed(true); }; }
  if (it.type !== 'zoom'){ const pv = $('#cPrev'); if (isImg(it.clip)){ pv.outerHTML = `<img id="cPrev" src="${MEDIA(it.clip.uri)}" style="width:100%;max-height:22vh;object-fit:contain;background:#000;border-radius:8px">`; } else { pv.src = MEDIA(it.clip.uri); pv.addEventListener('loadedmetadata', () => pv.currentTime = it.in, {once:true}); } }
  paintItem();
  body.onclick = e => {
    const b = e.target.closest('button'); if (!b || b.closest('.keyblk')) return;
    const seg = b.closest('.seg-ctl');
    if (seg){ const v = b.dataset.v;
      commit(() => { if (seg.id === 'zKind') it.kind = v; if (seg.id === 'cMode'){ it.type = v; if (v === 'insert') it.out = Math.max(it.out, Math.min(it.clip.duration, it.in + 1)); }
        if (seg.id === 'cMode' && v === 'pip') pipFree(it);
        if (seg.id === 'cCorner'){ if (v === 'full'){ delete it.w; delete it.x; delete it.y; delete it.kf; it.type = 'broll'; } else pipCorner(it, v); } }, false); if (seg.id !== 'zKind') seekOut(outPos, false); h.textContent = TYPE_LBL[it.type]; paintItem(); return; }
    if (b.dataset.z){ commit(() => it.dur = clamp(+(it.dur + +b.dataset.z).toFixed(2), 0.2, 60), false); }
    else if (b.dataset.at){ commit(() => { const p0 = objStart(it); it.at = clamp(r3(it.at + +b.dataset.at), 0, srcTotal); groupShift(it, objStart(it) - p0); }, false); seekOut(srcToOut(snapSrc(it.at)), false); }
    else if (b.dataset.cin){ commit(() => it.in = clamp(r3(it.in + +b.dataset.cin), 0, it.out - 0.1), false); $('#cPrev').currentTime = it.in; }
    else if (b.dataset.cout){ commit(() => it.out = clamp(r3(it.out + +b.dataset.cout), it.in + 0.1, isImg(it.clip) ? 1e6 : it.clip.duration), false); if (!isImg(it.clip)) $('#cPrev').currentTime = it.out; }
    else if (b.id === 'cInHere'){ const t = $('#cPrev').currentTime; commit(() => it.in = clamp(t, 0, it.out - 0.1), false); }
    else if (b.id === 'cOutHere'){ const t = $('#cPrev').currentTime; commit(() => it.out = clamp(t, it.in + 0.1, it.clip.duration), false); }
    else if (b.id === 'itPlay'){ const o = srcToOut(snapSrc(it.at)), d = it.type === 'zoom' ? it.dur : it.out - it.in; seekOut(Math.max(0, o - 1), false); startPlay(); stopAt = o + d + 1; return; }
    else if (b.id === 'itDel'){ commit(() => P.items = P.items.filter(x => x !== it)); closeSheet(); return; }
    else if (b.id === 'itOk'){ closeSheet(); return; }
    paintItem();
  };
  const zs = $('#zStr');
  if (zs){ zs.oninput = () => { it.strength = +zs.value; paintItem(); };
           zs.onpointerdown = () => { zs._b = snapshot(); };
           zs.onchange = () => { if (zs._b){ undo.push(zs._b); redo = []; zs._b = null; } changed(false); }; }
}
function paintItem(){
  const it = sheetItem; if (!it) return;
  $$('#sheet .seg-ctl button').forEach(b => { const id = b.parentElement.id; const v = b.dataset.v;
    b.classList.toggle('on', (id === 'zKind' && it.kind === v) || (id === 'cMode' && it.type === v) || (id === 'cCorner' && it.w == null && it.corner === v)); });
  if (it.type === 'zoom'){ $('#zStr').value = it.strength; $('#zStrV').textContent = it.strength.toFixed(2).replace('.', ',') + '×'; $('#zDur').textContent = it.dur.toFixed(1).replace('.', ',') + ' s'; $('#zAt').textContent = fmtS(srcToOut(snapSrc(it.at)));
    const pin = $('#pin'); pin.classList.remove('hidden'); pin.style.left = it.cx * 100 + '%'; pin.style.top = it.cy * 100 + '%'; }
  else { $('#cName').textContent = isImg(it.clip) ? `${it.clip.name} · Foto, Länge frei wählbar` : `${it.clip.name} · ${fmtS(it.clip.duration)}`; $('#cIn').textContent = fmtS(it.in); $('#cOut').textContent = fmtS(it.out); $('#cAt').textContent = fmtS(srcToOut(snapSrc(it.at)));
    $$('.pipopt').forEach(x => x.classList.toggle('hidden', it.type === 'insert' || it.type === 'audio'));
    const cm = $('#cMode'); if (cm) cm.parentElement.classList.toggle('hidden', it.type === 'audio');
    $$('.volopt').forEach(x => x.classList.toggle('hidden', isImg(it.clip) || it.clip.hasAudio === false));
    const vol = it.vol ?? (it.type === 'insert' || it.type === 'audio' ? 1 : 0); $('#cVol').value = Math.round(vol * 100); $('#cVolV').textContent = vol ? Math.round(vol * 100) + ' %' : 'stumm';
    if (it.type !== 'insert' && it.type !== 'audio'){ const v = elVals(it, curRel(it)), w = v ? v.w : coverVals(it).w; $('#cSize').value = Math.round(w * 100); $('#cSizeV').textContent = Math.round(w * 100) + ' %' + (it.kf && it.kf.length ? ` · ${it.kf.length} Keyframes` : ''); } $('#cInHere').classList.toggle('hidden', isImg(it.clip)); $('#cOutHere').classList.toggle('hidden', isImg(it.clip)); }
  updateZoomPreview();
}
function updateZoomPreview(){ if (sheetItem && sheetItem.type === 'zoom' && !playing){ const z = sheetItem, s = z.kind === 'in' ? 1 : z.strength; V.style.transformOrigin = '50% 50%'; V.style.transform = `translate(${(-(z.cx - 0.5) * (s - 1) * 100).toFixed(3)}%, ${(-(z.cy - 0.5) * (s - 1) * 100).toFixed(3)}%) scale(${s})`; } }
function closeSheet(){ $('#sheet').classList.add('hidden'); $('#sheetBack').classList.add('hidden'); $('#pin').classList.add('hidden'); $('#stageHint').classList.add('hidden');
  const pv = $('#cPrev'); if (pv && pv.pause){ pv.pause(); pv.removeAttribute('src'); } sheetItem = null; pinMode = false; updateZoom(); if (window.renderStudio) renderStudio(); }
$('#sheetBack').onclick = closeSheet;
$('#stage').addEventListener('click', e => {
  if (!pinMode || !sheetItem) { if (!sheetItem) togglePlay(); return; }
  const b = $('#stage').getBoundingClientRect();
  const it = sheetItem; commit(() => { it.cx = +clamp((e.clientX - b.left) / b.width, 0.05, 0.95).toFixed(3); it.cy = +clamp((e.clientY - b.top) / b.height, 0.05, 0.95).toFixed(3); }, false); paintItem();
});

// ───────── Export ─────────
const FMT_LBL = {video:'Video', audio:'Audio', capcut:'CapCut', concat:'Concat'};
let exFmt = 'video';
function renderExportForm(){
  const box = $('#exFmt'), fmts = CAP.exportFormats || ['video'];
  box.innerHTML = fmts.map(f => `<button data-v="${f}">${FMT_LBL[f] || f}</button>`).join('');
  box.classList.toggle('hidden', fmts.length < 2);
  if (!fmts.includes(exFmt)) exFmt = fmts[0];
  $('#exCapcutDir').textContent = CAP.capcutDir ? `CapCut-Entwürfe: ${CAP.capcutDir}` : 'CapCut wurde auf diesem Computer nicht gefunden – das Projekt wird als Ordner und ZIP gespeichert.';
  $('#exCapcutInstall').disabled = !CAP.capcutDir; if (!CAP.capcutDir) $('#exCapcutInstall').checked = false;
  $('#exConcatDir').textContent = CAP.concatDir ? `Wird gespeichert in: ${CAP.concatDir}` : '';
  $('#exLevel').checked = P.settings.level !== false;
  $('#exQualityRow').dataset.fmt = 'video';   // Qualität gibt es auf allen Plattformen (Android: Bitrate des Encoders)
  $('#exNote').textContent = CAP.platform === 'web' ? 'Das Video wird in deinem Browser berechnet und danach heruntergeladen – nichts verlässt dein Gerät. Lass diesen Tab während des Exports geöffnet. Untertitel kommen zusätzlich als SRT-Datei mit.'
    : CAP.platform === 'android' ? 'Das Video landet direkt in deiner Galerie (Ordner „HoneyCut“). Bitte die App während des Exports geöffnet lassen.'
    : 'Die Dateien landen im Ordner „…_honeycut“ neben deinem ersten Video. Untertitel kommen zusätzlich als SRT-Datei mit.';
  paintExportForm();
}
function paintExportForm(){
  $$('#exFmt button').forEach(b => b.classList.toggle('on', b.dataset.v === exFmt));
  $$('#paneExport [data-fmt]').forEach(el => el.classList.toggle('hidden', !el.dataset.fmt.split(' ').includes(exFmt)));
  $('#exSubs').checked = P ? P.settings.burn !== false : true;
  if (CAP.audioFormats){ $$('#exAudioFmt option').forEach(op => op.hidden = op.disabled = !CAP.audioFormats.includes(op.value)); if (!CAP.audioFormats.includes($('#exAudioFmt').value)) $('#exAudioFmt').value = CAP.audioFormats[0]; }
  if (CAP.platform === 'android') $('#exNote').textContent = exFmt === 'audio' ? 'Die Tonspur (M4A) landet im Ordner „Musik/HoneyCut“. Bitte die App während des Exports geöffnet lassen.'
    : 'Das Video landet direkt in deiner Galerie (Ordner „HoneyCut“). Bitte die App während des Exports geöffnet lassen.';
  $('#exBtn').textContent = {video:'Video exportieren', audio:'Audio exportieren', capcut:'CapCut-Projekt erstellen', concat:'Concat-Projekt erstellen'}[exFmt];
  if (P) renderExport();
}
$('#exFmt').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; exFmt = b.dataset.v; paintExportForm(); });
$('#exSubs').onchange = e => { P.settings.burn = e.target.checked; changed(false); };
function outSize(){
  let [w, h] = baseDims(); const lim = +$('#exRes').value;
  if (lim && Math.min(w, h) > lim){ const f = lim / Math.min(w, h); w *= f; h *= f; }
  return [Math.round(w / 2) * 2, Math.round(h / 2) * 2];
}
// Titel für den Export umbrechen wie in der Vorschau (höchstens 90 % der Bildbreite)
let wrapCtx = null;
function wrapTitle(text, size, font, W, H){
  const px = size * Math.min(W, H) * (H > W ? 1.25 : 1); wrapCtx ||= document.createElement('canvas').getContext('2d');
  wrapCtx.font = `${fontWeight(font, 800)} ${px.toFixed(1)}px ${fontCss(font).replace('var(--ui)', getComputedStyle(document.body).fontFamily || 'sans-serif')}`;
  const max = W * 0.9 - px * 0.6, out = [];
  for (const line of text.split('\n')){ let cur = '';
    for (const w of line.split(/\s+/).filter(Boolean)){ const t = cur ? cur + ' ' + w : w; if (cur && wrapCtx.measureText(t).width > max){ out.push(cur); cur = w; } else cur = t; }
    out.push(cur); }
  return out.join('\n');
}
// Freistellen im Plan: Farben als #rrggbb, Toleranz/weicher Rand wie ffmpeg „chromakey“ (similarity/blend), Hauptbild mit Hintergrundfarbe
function planKey(k, main){ const n = ChromaGL.norm(k); const o = {colors: n.colors.map(c => c.toLowerCase()), tol: +n.tol.toFixed(3), soft: +n.soft.toFixed(3), spill: !!n.spill}; if (main) o.bg = (k.bg || '#000000').toLowerCase(); return o; }
function buildPlan(){
  const [W, H] = outSize();
  const segs = timeline.map(g => {
    if (g.kind === 'insert') return {kind:'insert', uri:g.uri, in:r3(g.in), out:r3(g.out), image: isImg(g.item.clip), hasAudio: g.item.clip.hasAudio !== false && !isImg(g.item.clip), hasVideo:true, vol:+(g.item.vol ?? 1)};
    const s = P.sources[g.si], off = s.off;
    const zs = P.items.filter(z => z.type === 'zoom' && z.at < g.out && z.at + z.dur > g.in)
      .map(z => ({at:r3(z.at - off), dur:z.dur, kind:z.kind, strength:z.strength, cx:z.cx, cy:z.cy}));
    const fx = g.fx || FX_DEF;
    return {kind:'main', src:g.si, uri:s.uri, in:r3(g.in - off), out:r3(g.out - off), zooms:zs, hasAudio: s.hasAudio !== false, hasVideo: hasVid(s),
      speed:+(fx.speed || 1), vol:+((fx.vol ?? 1) * srcVol(g.si)).toFixed(3), bright:+(fx.bright || 0), contrast:+(fx.contrast || 0), sat:+(fx.sat || 0), gray:!!fx.gray,
      ...(f2 => ({tx:r3(f2.tx || 0), ty:r3(f2.ty || 0), sc:+(f2.sc || 1).toFixed(4)}))(frameFx({tx:+(fx.tx || 0), ty:+(fx.ty || 0), sc:+(fx.sc || 1)})),
      ...(kf => kf ? {kf: kf.map(k => { const f2 = frameFx({tx:+(k.tx || 0), ty:+(k.ty || 0), sc:+(k.sc || 1)}); return {t:r3(fxItemOf(g).at + k.t - g.in), tx:r3(f2.tx || 0), ty:r3(f2.ty || 0), sc:+(f2.sc || 1).toFixed(4)}; })} : {})(mainKf(g)),
      ...(k => k ? {key: planKey(k, true)} : {})(mainKeyOf(g))};
  });
  const ovs = overlays.map(o => ({mode:o.x.type, image: isImg(o.x.clip), uri:o.x.clip.uri, in:o.x.in, out:r3(o.x.in + (o.end - o.at)), at:r3(o.at), corner:o.x.corner || 'or', size:o.x.size || 0.33,
    ...(o.x.w != null || (o.x.kf && o.x.kf.length) || hasCrop(o.x) ? (() => { const v = elVals(o.x, 0) || coverVals(o.x); return {x:r3(v.x), y:r3(v.y), w:r3(v.w)}; })() : {}),
    ...(o.x.kf && o.x.kf.length ? {kf: o.x.kf.filter(k => k.t <= o.end - o.at + 0.01).map(k => ({t:k.t, x:k.x, y:k.y, w:k.w}))} : {}),
    ...(hasCrop(o.x) ? {crop: (c => ({l:r3(c.l), t:r3(c.t), r:r3(c.r), b:r3(c.b)}))(cropOf(o.x))} : {}),
    ...(keyOn(o.x.key) ? {key: planKey(o.x.key, false)} : {}),
    aspect:+elAspect(o.x).toFixed(5), track: elTrack(o.x), vol:+(o.x.vol || 0), hasAudio: o.x.clip.hasAudio !== false && !isImg(o.x.clip),
    width:o.x.clip.width, height:o.x.clip.height, rotation:o.x.clip.rotation || 0}))
    .concat(wmPlan(W, H))
    .concat(audios.map(a => ({mode:'audio', image:false, uri:a.x.clip.uri, in:r3(a.x.in), out:r3(a.x.in + (a.end - a.at)), at:r3(a.at), track:a.x.track || 1, vol:+(a.x.vol ?? 1), hasAudio:true})));
  const cues = S().enabled !== false && P.cues.length ? computedCues().map(x => { const [cx, cy0] = cueXY(x.c), sy = x.c.x == null && window.subSlideY ? subSlideY(x.s, x.e) : null, cy = sy ?? cy0, o = {start:r3(x.s), end:r3(x.e), text:subDisplay(x.text), x:cx, y:cy};
    if (S().bg) o.bg = true;   // Untertitel mit Kasten (Clip-Look)
    const sp = cueSpk(x.c), st = sp && sp.st;   // Abweichungen der Person
    if (st){ if (st.color) o.color = st.color; if (st.size) o.size = SIZE_F[st.size] || 0.058; if (st.font != null) o.font = st.font; if (st.outline != null) o.outline = !!st.outline; if (sp.name) o.speaker = sp.name; }
    return o; }) : [];
  for (const t of P.items.filter(x => x.type === 'title' && (x.text || '').trim())){ const a = srcToOut(snapSrc(t.at)); if (a >= total) continue;
    cues.push({start:r3(a), end:r3(Math.min(total, a + t.dur)), text:wrapTitle(t.text.trim(), (SIZE_F[t.size] || 0.058) * (t.scale || 1), t.font, W, H), x:t.x, y:t.y, size:+((SIZE_F[t.size] || 0.058) * (t.scale || 1)).toFixed(4), color:t.color || '#FFFFFF', outline:t.outline !== false, bg:!!t.bg, title:true, font:t.font || ''}); }
  const subs = cues.length ? {cues, style:S(), fonts: planFonts([S().font, ...cues.map(c => c.font)])} : null;
  const media = P.sources.map(s => ({uri:s.uri, name:s.name, duration:s.duration, width:dispSize(s)[0], height:dispSize(s)[1], fps:s.fps, hasAudio:s.hasAudio !== false, hasVideo:hasVid(s), kind:s.kind || 'video'}));
  return {format:exFmt, name: ($('#exName').value || P.name).replace(/[\\/:*?"<>|]/g, '_'), width:W, height:H, fps:primary().fps || 30, total:r3(total),
    segments:segs, overlays:ovs, subs, burn: P.settings.burn !== false, quality: $('#exQuality').value, audioFormat: $('#exAudioFmt').value,
    capcutInstall: $('#exCapcutInstall').checked, sources:media, project:P.id};
}
// ───────── Transkript als Text oder Word-Datei ─────────
function transcriptParas(o = {}){
  const cut = o.cut !== false, out = []; let cur = null, para = -1, src = -1, lastSpk = null;
  if (order.length !== tokens.length) computeOrder();
  for (const i of order){
    const t = tokens[i], added = t.type !== 'word' && P.edits[i]; if (t.type !== 'word' && !added) continue;   // auch ergänzte Wörter
    if (cut && (deleted.has(i) || (!added && isSrcDeleted((t.ws + t.we) / 2)))) continue;
    const w = String(added || tokText(t)).trim(); if (!w) continue;
    const spk = t.spk || '', newSrc = t.src !== src && P.sources.length > 1;
    if (!cur || t.p !== para || newSrc || (o.spk && spk !== lastSpk)){
      cur = {ts: t.ws ?? t.s, spk: o.spk ? (spkOf(spk) || {}).name || '' : '', src: newSrc ? P.sources[t.src].name : '', words: []}; out.push(cur);
      para = t.p; src = t.src; lastSpk = spk;
    }
    cur.words.push(w);
  }
  for (const p of out) p.text = p.words.join(' ').replace(/\s+([,.;:!?…»“)])/g, '$1').replace(/([„«(])\s+/g, '$1');
  return out;
}
function txOpts(){ return {cut: $('#txCut').checked, spk: $('#txSpk').checked, times: $('#txTimes').checked}; }
function transcriptPlain(o){
  return transcriptParas(o).map(p => (p.src ? `— ${p.src} —\n` : '') + (o.times ? `[${fmtT(p.ts)}] ` : '') + (p.spk ? p.spk + ': ' : '') + p.text).join('\n\n');
}
async function copyText(txt){
  if (TS.copyText){ try { if (TS.copyText(txt)) return true; } catch(_){} }
  try { await navigator.clipboard.writeText(txt); return true; } catch(_){}
  const ta = document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'position:fixed;left:-9999px;top:0'; document.body.append(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch(_){} ta.remove(); return ok;
}
// Kleines ZIP (ohne Kompression) und eine schlichte Word-Datei daraus
const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC_T[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zipStore(files){
  const enc = new TextEncoder(), parts = [], cen = []; let off = 0;
  for (const [name, txt] of files){
    const nb = enc.encode(name), db = enc.encode(txt), crc = crc32(db);
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
    h.setUint32(14, crc, true); h.setUint32(18, db.length, true); h.setUint32(22, db.length, true); h.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(h.buffer), nb, db);
    const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
    c.setUint32(16, crc, true); c.setUint32(20, db.length, true); c.setUint32(24, db.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
    cen.push(new Uint8Array(c.buffer), nb); off += 30 + nb.length + db.length;
  }
  const clen = cen.reduce((a, b) => a + b.length, 0), e = new DataView(new ArrayBuffer(22));
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, clen, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...cen, new Uint8Array(e.buffer)], {type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}
function transcriptDocx(o){
  const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const run = (t, pr = '') => `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${x(t)}</w:t></w:r>`;
  const par = (runs, ppr = '') => `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${runs}</w:p>`;
  let body = par(run(P.name || 'Transkript'), '<w:pStyle w:val="Title"/>');
  body += par(run(`Transkript · ${fmtT(total)}` + (o.cut ? ' · geschnittene Fassung' : ' · vollständig'), '<w:color w:val="5E584D"/><w:sz w:val="20"/>'));
  for (const p of transcriptParas(o)){
    if (p.src) body += par(run(p.src, '<w:b/>'), '<w:pStyle w:val="Heading2"/>');
    body += par((o.times ? run(`[${fmtT(p.ts)}] `, '<w:color w:val="5E584D"/>') : '') + (p.spk ? run(p.spk + ': ', '<w:b/>') : '') + run(p.text));
  }
  const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1134" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${W}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="23"/><w:lang w:val="de-DE"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style></w:styles>`;
  return zipStore([
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'],
    ['word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
    ['word/document.xml', doc], ['word/styles.xml', styles]]);
}
async function saveBlob(name, blob){
  if (TS.saveFile){
    const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
    const m = TS.saveFile(name, blob.type, b64, 'HoneyCut'); return typeof m === 'string' ? m : 'Gespeichert';
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'Heruntergeladen: ' + name;
}
$('#txCopy').onclick = async () => {
  const o = txOpts(), txt = transcriptPlain(o); if (!txt){ $('#txMsg').textContent = 'Noch kein Text vorhanden.'; return; }
  const ok = await copyText(txt), n = txt.split(/\s+/).length;
  $('#txMsg').textContent = ok ? `${n} Wörter in der Zwischenablage.` : 'Kopieren hat nicht geklappt – bitte als Word-Datei speichern.'; toast(ok ? 'Transkript kopiert' : 'Kopieren fehlgeschlagen');
};
$('#txDocx').onclick = async () => {
  const o = txOpts(); if (!transcriptParas(o).length){ $('#txMsg').textContent = 'Noch kein Text vorhanden.'; return; }
  const name = (P.name || 'Transkript').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) + ' – Transkript.docx';
  try { const m = await saveBlob(name, transcriptDocx(o)); if (m){ $('#txMsg').textContent = m; toast(m.split(':')[0]); } } catch(e){ $('#txMsg').textContent = 'Fehler: ' + e.message; }
};
$('#txChip').onclick = () => { setTab('export'); setTimeout(() => $('#txCard').scrollIntoView({block: 'center', behavior: 'smooth'}), 60); };
function renderExport(){
  const [W, H] = outSize(), n = P.items.reduce((m, x) => (m[x.type] = (m[x.type] || 0) + 1, m), {});
  $('#exSummary').textContent = `${fmtT(total)}${exFmt === 'audio' ? '' : ` · ${W}×${H}`} · ${timeline.filter(g => g.kind === 'main').length} Abschnitte` + (P.sources.length > 1 ? ` aus ${P.sources.length} Videos` : '') +
    (n.insert ? ` · ${n.insert} Einschub` : '') + (n.broll ? ` · ${n.broll} B-Roll` : '') + (n.pip ? ` · ${n.pip} Einblendung${n.pip > 1 ? 'en' : ''}` : '') + (n.zoom ? ` · ${n.zoom} Zoom` : '') + (n.fx ? ` · ${n.fx} Anpassungen` : '') + (n.title ? ` · ${n.title} Titel` : '') +
    (S().enabled !== false && P.cues.length ? ` · ${computedCues().length} Untertitel` : '');
}
$('#exRes').onchange = renderExport;
let exJob = null, exResult = null;
// ── Lautstärke vereinheitlichen (Export): Sprache (Hauptspur und Einschübe) je Datei auf dieselbe Lautheit, danach das
// Ganze auf etwa −14 LUFS. Musik und Ton auf den anderen Spuren behalten ihr Verhältnis und bekommen nur die Gesamtverstärkung.
// Gemessen wird mit den Lautstärkeverläufen (dieselben wie im Studio unter „Lautstärke → Alle angleichen“).
const LEVEL_TARGET = -14;
async function levelPlan(plan){
  const parts = plan.segments.filter(s => s.hasAudio !== false && (s.vol ?? 1) > 0);
  const byUri = new Map(); for (const s of parts){ const k = s.uri; if (!byUri.has(k)) byUri.set(k, []); byUri.get(k).push(s); }
  const gain = new Map(); let peak = -99, speech = [];
  for (const [uri, list] of byUri){
    const a = await envOfUri(uri); if (!a) continue;
    // gemessen über die tatsächlich verwendeten Stücke
    let sum = 0, n = 0, pk = -99;
    for (const s of list){ const L = loudness(a, s.in, s.out), d = s.out - s.in; if (L != null){ sum += Math.pow(10, L / 10) * d; n += d; }
      for (let i = Math.max(0, Math.floor(s.in * 100)); i < Math.min(a.length, Math.ceil(s.out * 100)); i++) pk = Math.max(pk, a[i] / 2.8 - 90 + 20 * Math.log10(s.vol ?? 1)); }
    if (n > 0){ const L = 10 * Math.log10(sum / n); speech.push({uri, L, d: n, pk}); }
  }
  if (!speech.length) return {master: 1, note: ''};
  // gemeinsames Sprachniveau: Mittel nach Dauer, der leiseste Clip höchstens +12 dB
  const tot = speech.reduce((x, y) => x + y.d, 0), mean = 10 * Math.log10(speech.reduce((x, y) => x + Math.pow(10, y.L / 10) * y.d, 0) / tot), minL = Math.min(...speech.map(x => x.L));
  const T = Math.min(mean, minL + 12);
  for (const x of speech){ const g = clamp(T - x.L, -12, 12); gain.set(x.uri, g); peak = Math.max(peak, x.pk + g); }
  // Gesamtverstärkung auf −14 LUFS, aber die lautesten Stellen bleiben unter −2 dB (Verlauf in 10-ms-Schritten)
  const master = clamp(Math.min(LEVEL_TARGET - T, -2 - peak), -20, 18);
  const f = d => Math.pow(10, d / 20);
  for (const s of parts){ const g = gain.get(s.uri) || 0; s.vol = +((s.vol ?? 1) * f(g + master)).toFixed(4); }
  for (const o of plan.overlays || []) if (o.vol) o.vol = +(o.vol * f(master)).toFixed(4);
  plan.level = {target: LEVEL_TARGET, master: +master.toFixed(2)};
  return {master};
}
$('#exLevel').onchange = () => { if (P){ P.settings.level = $('#exLevel').checked; changed(false); } };
$('#exBtn').onclick = async () => {
  if (!timeline.length) return; saveNow(); pausePlay();
  const plan = buildPlan(); exResult = null; $('#exDone').classList.add('hidden'); $('#exFiles').textContent = '';
  if ($('#exLevel').checked && exFmt !== 'concat'){
    $('#exBtn').disabled = true; $('#exMsg').textContent = 'Lautstärke wird gemessen …';
    try { await levelPlan(plan); } catch(e){ console.warn(e); }
    $('#exBtn').disabled = false;
  }
  try { exJob = TS.exportVideo(JSON.stringify(plan)); } catch(e){ $('#exMsg').textContent = 'Fehler: ' + e.message; return; }
  $('#exBtn').disabled = true; $('#exCancel').classList.remove('hidden'); $('#exProg').classList.remove('hidden'); TS.keepAwake(true);
  const end = () => { $('#exBtn').disabled = false; $('#exCancel').classList.add('hidden'); TS.keepAwake(false); };
  watchJob(exJob, j => { $('#exProg i').style.width = (j.progress * 100).toFixed(1) + '%'; $('#exMsg').textContent = j.message || ''; },
    j => { end(); exResult = j.result || {}; $('#exDone').classList.remove('hidden');
      if (CAP.platform === 'android'){ $('#exMsg').textContent = 'Fertig – das Video ist in deiner Galerie (Ordner „HoneyCut“).'; }
      else { $('#exMsg').textContent = exResult.note || 'Fertig.'; $('#exFiles').textContent = (exResult.files || []).join('\n'); }
      $('#exOpen').classList.toggle('hidden', CAP.platform !== 'android' && !exResult.playable); },
    j => { end(); $('#exMsg').textContent = j.status === 'cancelled' ? 'Abgebrochen.' : ('Fehler: ' + (j.error || 'unbekannt')); });
};
$('#exCancel').onclick = () => exJob && TS.cancel(exJob);
$('#exShare').onclick = () => exResult && TS.share(exResult.uri || exResult.folder || (exResult.files || [])[0]);
$('#exOpen').onclick = () => exResult && TS.view(exResult.uri || exResult.playable);
if (CAP.platform === 'web'){ $('#exShare').textContent = 'Nochmal speichern'; $('#exOpen').textContent = 'Abspielen'; }
else if (CAP.platform !== 'android'){ $('#exShare').textContent = 'Im Ordner zeigen'; $('#exOpen').textContent = 'Abspielen'; }

// ───────── Reiter ─────────
function setTab(t){
  tab = t; clearSel(); if (P) rememberOpen();
  $('#proj').dataset.tab = t;
  $('#paneTrans').classList.toggle('hidden', t !== 'trans');
  $('#paneText').classList.toggle('hidden', t !== 'text'); $('#paneSubs').classList.toggle('hidden', t !== 'subs');
  $('#paneStudio').classList.toggle('hidden', t !== 'studio' && t !== 'clip'); $('#paneExport').classList.toggle('hidden', t !== 'export');
  $('#paneClip').classList.toggle('hidden', t !== 'clip'); if (t === 'clip' && window.renderClip) renderClip();
  $('#paneSlides').classList.toggle('hidden', t !== 'slides'); if (t === 'slides' && window.renderSlides) renderSlides();
  $$('#tabs button[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t || (t === 'trans' && b.dataset.tab === 'text')));
  if (t === 'trans') renderSources();
  if (t === 'subs') renderSubs(); if (studioOn() && window.renderStudio) renderStudio(); if (t === 'export') renderExport();
  setTimeout(fitStage, 0);
}
const TAB_LBL = {text:'Text', trans:'Text', subs:'Untertitel', studio:'Studio', export:'Export', clip:'Clip', slides:'Folien'};
$('#detachBtn').onclick = () => {
  if (!P) return; saveNow(); const view = tab === 'trans' ? 'text' : tab;
  let url = ''; try { url = TS.openWindow ? TS.openWindow(P.id, view) : ''; } catch(e){ return toast('Fenster konnte nicht geöffnet werden'); }
  if (url && /^https?:/.test(url)) window.open(url, '_blank', 'width=1280,height=860');
  setTab(view === 'studio' ? 'text' : 'studio'); toast(`${TAB_LBL[view]} läuft jetzt in einem eigenen Fenster`);
};
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || !P) return;
  const t = b.dataset.tab;
  if (!tokens.length && t !== 'studio' && t !== 'export' && t !== 'clip' && !(t === 'subs' && P.cues.length)){
    setTab('trans');
    if (t === 'subs'){ if (studioCut()){ $('#subsOnly').checked = true; renderSources(); toast('Untertitel brauchen ein Transkript – „Nur für Untertitel“ lässt deinen Schnitt unverändert'); } else toast('Für Untertitel zuerst transkribieren'); }
    return; }
  setTab(t); });
matchMedia('(min-width: 760px) and (min-height: 600px)').addEventListener('change', () => { fitStage(); });

// ───────── Modelle ─────────
$('#modelsBtn').onclick = () => { renderModels(); $('#modelSheet').classList.remove('hidden'); $('#sheetBack').classList.remove('hidden'); };
$('#modelClose').onclick = () => { $('#modelSheet').classList.add('hidden'); $('#sheetBack').classList.add('hidden'); };
function renderModels(){
  const box = $('#modelList'); box.innerHTML = '';
  for (const m of J(TS.models()) || []){
    const el = document.createElement('div'); el.className = 'model';
    el.innerHTML = `<div class="meta"><b></b><div class="muted small"></div><div class="progress hidden"><i></i></div></div>`;
    el.querySelector('b').textContent = m.label; el.querySelector('.muted').textContent = m.installed ? (m.bundled ? 'eingebaut' : 'geladen') : `${m.sizeMb} MB`;
    if (!m.installed){ const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Laden'; el.append(b);
      b.onclick = () => { b.disabled = true; const pr = el.querySelector('.progress'); pr.classList.remove('hidden'); TS.keepAwake(true);
        watchJob(TS.downloadModel(m.name), j => pr.firstElementChild.style.width = (j.progress * 100) + '%',
          () => { TS.keepAwake(false); renderModels(); fillModels(); toast('Modell geladen'); },
          j => { TS.keepAwake(false); b.disabled = false; toast('Download fehlgeschlagen: ' + (j.error || '')); }); }; }
    box.append(el);
  }
}

fillFontSelects(); loadUserFonts();
showHome();
(() => { const h = new URLSearchParams(location.hash.slice(1)); const p = h.get('p');
  if (p){ document.body.classList.add('solo'); Promise.resolve(openProject(p)).then(() => { if (P && h.get('view')) setTab(h.get('view')); }); return; }
  // Nach einem Neuladen (nicht nach dem Schließen) ins zuletzt offene Projekt zurück
  if (CAP.platform === 'web') return;
  let o = null; try { o = J(localStorage.getItem(OPEN_KEY)); } catch(_){}
  if (!o || !o.id || Date.now() - (o.at || 0) > 12 * 3600e3) return;
  try { if (!J(TS.loadProject(o.id))) return; } catch(_){ return; }
  openProjectNow(o.id);
  if (P && P.id === o.id){ if (o.tab && o.tab !== tab && !tjGet(o.id)) setTab(o.tab); if (o.pos) seekOut(o.pos, false); }
})();
