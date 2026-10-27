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
  onPause(){ if (P) { pausePlay(); saveNow(); } },
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
const isWide = () => matchMedia('(min-width: 1000px) and (min-height: 600px)').matches;
const studioOn = () => tab === 'studio' && !!P;

// ───────── Quellen (mehrere Videos hintereinander) ─────────
function layoutSources(){ let o = 0; P.sources.forEach((s, k) => { s.off = r3(o); s.k = k; o += s.duration; }); srcTotal = o; }
function srcAt(t){ for (let k = P.sources.length - 1; k > 0; k--) if (t >= P.sources[k].off - 1e-6) return k; return 0; }
const srcEnd = si => P.sources[si].off + P.sources[si].duration;
const hasVid = s => s.kind !== 'audio' && s.hasVideo !== false;
function primary(){ return P.sources.find(hasVid) || {width:1920, height:1080, fps:30, rotation:0}; }
function dispSize(m){ const r = Math.abs(m.rotation || 0) % 180 === 90; const w = m.width || 1920, h = m.height || 1080; return r ? [h, w] : [w, h]; }
// Lautstärke-Hüllkurve (100 Werte/s, als Base64 gespeichert) für präzise Schnitte
function envArr(s){
  if (!s.env) return null;
  if (!s._env){ const b = atob(s.env), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
    Object.defineProperty(s, '_env', {value:a, writable:true, enumerable:false}); }
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
function alignWithAudio(words, bursts){
  if (!bursts || !bursts.length || !words.length) return words;
  words = words.map(w => ({...w}));
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
    el.innerHTML = `<div class="meta"><b></b><span class="muted small"></span></div>${TS.shareProject ? '<button class="del share" title="Projektdatei teilen (z. B. zur Fehlersuche)">⤴</button>' : ''}<button class="del" title="Löschen">🗑</button>`;
    el.querySelector('b').textContent = p.name;
    el.querySelector('span').textContent = `${fmtT(p.duration)}${p.sources > 1 ? ` · ${p.sources} Videos` : ''} · ${p.transcribed ? 'transkribiert' : 'noch nicht transkribiert'} · ${new Date(p.updated).toLocaleDateString('de-DE')}`;
    el.onclick = e => { if (e.target.closest('.del')) return; openProject(p.id); };
    const sh = el.querySelector('.share'); if (sh) sh.onclick = () => TS.shareProject(p.id);
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
  P.adj ||= {}; P.items ||= []; P.dels ||= []; P.splits ||= []; P.edits ||= {}; P.moves ||= []; P.trims ||= {}; P.settings ||= {pad:0.06}; P.cues ||= [];
  if (P.settings.burn == null) P.settings.burn = true;
  P.sub_style = {...DEF_STYLE, ...(P.sub_style || {})}; if (P.sub_style.y == null) P.sub_style.y = POS_Y[P.sub_style.pos] ?? 0.88;
  tokens = P.tokens || []; tokens.forEach(t => { if (t.src == null) t.src = 0; });
  deleted = new Set(P.deleted || []); undo = []; redo = [];
  layoutSources(); vSi = -1; vPending = null;
  $('#home').classList.add('hidden'); $('#proj').classList.remove('hidden');
  $('#projName').textContent = P.name; $('#exName').value = P.name + '_geschnitten';
  const [ow, oh] = dispSize(primary()); $('#exRes').options[0].textContent = `Original (${ow}×${oh})`;
  fitStage(); setTimeout(fitStage, 60);
  fillModels(); syncStyleInputs(); renderExportForm();
  if (tokens.length){ renderTranscript(); if (!P.cues.length) genCues(); }
  recompute();
  setTab(keepTab || (tokens.length ? 'text' : 'trans'));
  seekOut(keepPos, false);
  busStart(); backfillEnv();
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
function closeProject(){ setFull(false); pausePlay(); saveNow(); busPid = null; P = null; V.removeAttribute('src'); V.load(); vSi = -1; hideOverlay(); showHome(); }
$('#backBtn').onclick = closeProject;
const fillsWrap = () => isWide() || matchMedia('(orientation: landscape) and (max-height: 599px)').matches;
// Bühne: ein 16:9-Feld. Hochformat-Videos lassen links und rechts Platz – dort sitzt zusätzliche Steuerung.
function fitStage(){
  if (!P) return;
  const [w, h] = dispSize(primary()), wrap = $('.stage-wrap'), st = $('#stage');
  const full = $('#proj').classList.contains('full');
  const fill = fillsWrap(), availW = full ? innerWidth : wrap.clientWidth || innerWidth;
  let boxH;
  if (full){ wrap.style.height = ''; boxH = innerHeight;
    let W = availW, H = W * h / w; if (H > boxH){ H = boxH; W = H * w / h; }
    st.style.width = Math.floor(W) + 'px'; st.style.height = Math.floor(H) + 'px';
    for (const el of [$('#sideL'), $('#sideR')]) el.classList.add('hidden');
    styleOverlay(); refreshStageOverlays(); return; }
  if (fill){ wrap.style.height = ''; boxH = wrap.clientHeight || innerHeight * 0.6; }
  else { boxH = Math.round(Math.min(availW * 9 / 16, Math.max(150, innerHeight * 0.36))); wrap.style.height = boxH + 'px'; }
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
  const pid = P.id, todo = P.sources.filter(s => s.tr && !s.noAudio && !s.env && s.hasAudio !== false);
  (function next(){
    const s = todo.shift(); if (!s || !P || P.id !== pid) return;
    let id; try { id = TS.envelope(s.uri); } catch(_){ return; }
    watchJob(id, () => {}, j => { if (P && P.id === pid && j.result && j.result.env){ s.env = j.result.env; delete s._env; delete s._bursts; realign(); toast('Transkript am Ton ausgerichtet'); } next(); }, () => next());
  })();
}

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
    a.forEach((t, j) => { if (!b[j]) return; if (oldDel.has(t.i)) deleted.add(b[j].i); if (oldEdits[t.i] != null) P.edits[b[j].i] = oldEdits[t.i]; });
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
function snapshot(){ return JSON.stringify({d:[...deleted], t:P.trims, c:P.cues, i:P.items, a:P.adj, x:P.dels, y:P.splits, s:P.sub_style, e:P.edits, m:P.moves}); }
function restore(s){ const o = JSON.parse(s); deleted = new Set(o.d); P.trims = o.t; P.cues = o.c; P.items = o.i; P.adj = o.a; P.dels = o.x || []; P.splits = o.y || [];
  if (o.s) P.sub_style = o.s; P.edits = o.e || {}; P.moves = o.m || [];
  const reorder = JSON.stringify(P.moves) !== lastOrderKey; syncStyleInputs(); changed(true);
  if (reorder && tokens.length) renderTranscript(); else tokens.forEach(t => paint(t.i)); }
function commit(fn, rerender = true){ undo.push(snapshot()); if (undo.length > 200) undo.shift(); redo = []; fn(); changed(rerender); }
$('#undoBtn').onclick = () => { if (!undo.length || !P) return; redo.push(snapshot()); restore(undo.pop()); };
$('#redoBtn').onclick = () => { if (!redo.length || !P) return; undo.push(snapshot()); restore(redo.pop()); };
function changed(rerender = true){
  recompute();
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
function recompute(){
  computeRanges(); computePieces(); computeOrder(); buildTimeline(); syncLinks(); computeOverlays(); drawScrub();
  if (studioOn() && window.renderTimeline) renderTimeline();
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
  o = clamp(o, 0, Math.max(0, total - 0.01)); curSeg = segAtOut(o); outPos = o;
  const g = timeline[curSeg], local = g.in + (o - g.o) * (g.speed || 1);
  if (g.kind === 'main'){
    IV.pause(); IV.classList.add('hidden'); II.classList.add('hidden');
    seekV(g.si, local - P.sources[g.si].off, keepPlaying);
  } else if (isImg(g.item.clip)){
    V.pause(); IV.pause(); IV.classList.add('hidden');
    const url = MEDIA(g.uri); if (II.dataset.src !== url){ II.src = url; II.dataset.src = url; }
    II.classList.remove('hidden'); imgClock = {local, t0: performance.now()};
  } else {
    V.pause(); II.classList.add('hidden');
    const url = MEDIA(g.uri); if (IV.dataset.src !== url){ IV.src = url; IV.dataset.src = url; }
    IV.classList.remove('hidden'); IV.volume = clamp(g.item.vol ?? 1, 0, 1); IV.muted = !(g.item.vol ?? 1); IV.currentTime = local; if (keepPlaying) IV.play().catch(() => {});
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
  playing = true; setPlayIcons(true); seekOut(outPos, true); TS.keepAwake(true);
}
function pausePlay(){
  const g0 = timeline[curSeg]; if (playing && g0 && g0.kind === 'insert' && isImg(g0.item.clip)) imgClock = {local: segLocal(g0), t0: performance.now()};
  playing = false; stopAt = null; vWantPlay = false; V.pause(); IV.pause(); allLayers(el => { if (el.pause) el.pause(); }); setPlayIcons(false); TS.keepAwake(false);
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
$('#sideSubs').onclick = () => { if (!P) return; const on = S().enabled === false; S().enabled = on; syncStyleInputs(); changed(false); toast(on ? 'Untertitel an' : 'Untertitel aus'); };
$('#sideFont').onclick = () => { if (P) openFontSheet(); };
function loop(){
  if (P && timeline.length && playing){
    const g = timeline[curSeg], el = g.kind === 'main' ? V : (isImg(g.item.clip) ? null : IV);
    if (g.kind === 'main' && vSi !== g.si) seekV(g.si, g.in - P.sources[g.si].off, true);
    if (segLocal(g) >= g.out - 0.012 || (el && el.ended && vPending == null)) advanceSeg();
    if (playing){
      outPos = curOut();
      if (stopAt != null && outPos >= stopAt) pausePlay();
      updateOverlay(outPos); updateZoom(); updateSubs(outPos); updateTitles(outPos); updateHead(outPos); highlightNow();
    }
  }
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
function coverVals(it){ const [W, H] = outSize(), a = clipAspect(it.clip); return {x: 0.5, y: 0.5, w: Math.max(1, H * a / W)}; }
function pipRect(it, W, H){   // ältere Projekte: feste Ecke, Größe als Anteil beider Seiten
  const sz = it.size || 0.33, pw = sz * W, ph = sz * H, m = PIP_M * W, c = it.corner || 'or';
  return {cx: c[1] === 'l' ? m + pw / 2 : W - m - pw / 2, cy: c[0] === 'o' ? m + ph / 2 : H - m - ph / 2, w: pw, h: ph};
}
// Rechteck in Pixeln (Bühne W×H) oder null für Vollbild
function elRect(it, v, W, H){
  if (!v) return null;
  if (v.legacy && it.w == null && !(it.kf && it.kf.length)){ const r = pipRect(it, W, H); return r; }
  const pw = v.w * W; return {cx: v.x * W, cy: v.y * H, w: pw, h: pw / clipAspect(it.clip)};
}
// Element auf freie Lage umstellen (Vollbild/alte Ecke → x/y/w)
function pipFree(it){ if (it.w != null) return; const v = elVals(it, 0) || coverVals(it); it.w = r3(v.w); it.x = r3(v.x); it.y = r3(v.y);
  if (v.legacy){ const [W, H] = outSize(), ph = it.w * W / clipAspect(it.clip), c = it.corner || 'or', m = PIP_M * W; it.y = r3((c[0] === 'o' ? m + ph / 2 : H - m - ph / 2) / H); } }
// Werte setzen: mit Keyframes an der Stelle rel (neu oder vorhandener), sonst fest
function setElVals(it, rel, v){
  v = {x: r3(clamp(v.x, -0.5, 1.5)), y: r3(clamp(v.y, -0.5, 1.5)), w: r3(clamp(v.w, 0.03, 3))};
  if (it.kf && it.kf.length){
    const tol = 0.5 / (primary().fps || 30), k = it.kf.find(k => Math.abs(k.t - rel) <= tol);
    if (k) Object.assign(k, v); else { it.kf.push({t: r3(rel), ...v}); it.kf.sort((a, b) => a.t - b.t); }
  } else { pipFree(it); Object.assign(it, v); }
}
function pipCorner(it, c){
  const v0 = elVals(it, curRel(it)) || coverVals(it); const [W, H] = outSize(), pw = v0.w * W, ph = pw / clipAspect(it.clip), m = PIP_M * W;
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
let curPip = null, pipTarget = null, layerOrder = '';
function selOvlId(){ return window.TL && TL.sel && (TL.sel.kind === 'ovl') ? TL.sel.id : null; }
function updateOverlay(o){
  const st = $('#stage'), W = st.clientWidth, H = st.clientHeight;
  const act = overlays.filter(x => o >= x.at && o < x.end);
  const on = new Set(act.map(a => a.x.id));
  for (const [id, el] of layers){ if (!P.items.some(x => x.id === id)){ el.remove(); layers.delete(id); continue; }
    if (!on.has(id) && !el.classList.contains('hidden')){ if (el.pause) el.pause(); el.classList.add('hidden'); } }
  // Reihenfolge im DOM = Stapel (untere Spur zuerst)
  const order = act.map(a => a.x.id).join(',');
  if (order !== layerOrder){ layerOrder = order; act.forEach(a => $('#stage').insertBefore(layerFor(a.x), $('#pipBox'))); }
  act.forEach((a, k) => {
    const it = a.x, el = layerFor(it), url = MEDIA(it.clip.uri);
    if (el.dataset.src !== url){ el.src = url; el.dataset.src = url; }
    el.classList.remove('hidden');
    const v = PipDrag.on && PipDrag.it === it ? PipDrag : elVals(it, o - a.at), r = elRect(it, v, W, H);
    el.classList.toggle('free', !!r);
    if (r) Object.assign(el.style, {left: (r.cx - r.w / 2) + 'px', top: (r.cy - r.h / 2) + 'px', width: r.w + 'px', height: r.h + 'px'});
    else Object.assign(el.style, {left: '', top: '', width: '', height: ''});
    if (el.tagName !== 'VIDEO') return;
    const vol = it.vol || 0; el.muted = !(vol > 0) || !playing; el.volume = clamp(vol, 0, 1);
    const target = it.in + (o - a.at);
    if (Math.abs(el.currentTime - target) > (playing ? 0.3 : 0.05)) el.currentTime = target;
    if (playing && el.paused) el.play().catch(() => {}); if (!playing && !el.paused) el.pause();
  });
  // Griffe: am ausgewählten Element, sonst am obersten
  const sel = selOvlId(), tgt = act.find(a => a.x.id === sel) || act[act.length - 1] || null;
  curPip = tgt ? tgt.x : null; pipTarget = tgt;
  placeBox(W, H);
}
// Rahmen mit Griffen: Einblendung, sonst (Hauptspur-Clip ausgewählt) das Hauptbild
function placeBox(W, H){
  const box = $('#pipBox');
  if (!W){ const st = $('#stage'); W = st.clientWidth; H = st.clientHeight; }
  let r = null;
  if (curPip){ const it = curPip, v = PipDrag.on && PipDrag.it === it ? PipDrag : elVals(it, outPos - pipTarget.at);
    r = elRect(it, v, W, H); if (!r){ const c = coverVals(it); r = {cx: W / 2, cy: H / 2, w: c.w * W, h: c.w * W / clipAspect(it.clip)}; } }
  else if (mainBoxOn()){ const f = PipDrag.on && PipDrag.main ? PipDrag : mainFx(); r = {cx: (0.5 + f.tx) * W, cy: (0.5 + f.ty) * H, w: f.sc * W, h: f.sc * H}; }
  box.classList.toggle('hidden', !r); box.classList.toggle('main', !curPip && !!r);
  if (r) Object.assign(box.style, {left: (r.cx - r.w / 2) + 'px', top: (r.cy - r.h / 2) + 'px', width: r.w + 'px', height: r.h + 'px'});
}
// Hauptspur: Lage und Größe des ausgewählten Clips (in einer Anpassung gespeichert)
const mainBoxOn = () => !!(window.TL && TL.sel && TL.sel.kind === 'main' && timeline[TL.sel.i] && studioOn());
function mainFx(){ const g = window.TL && TL.sel && timeline[TL.sel.i]; const f = g && g.fx ? g.fx : FX_DEF; return {tx: f.tx || 0, ty: f.ty || 0, sc: f.sc || 1}; }
function mainFxItem(g){
  let it = P.items.find(x => x.type === 'fx' && x.at <= g.in + 0.01 && x.at + x.dur >= g.out - 0.01);
  if (!it){ it = {id:newId(), type:'fx', at:r3(g.in), dur:r3(g.out - g.in), fx:{...FX_DEF}}; P.items.push(it); }
  it.fx = {...FX_DEF, ...(it.fx || {})}; return it;
}
const PipDrag = {on:false};
$('#pipBox').addEventListener('pointerdown', e => {
  if (!curPip && !mainBoxOn()) return; e.preventDefault(); e.stopPropagation(); $('#pipBox').setPointerCapture(e.pointerId);
  if (playing) pausePlay();
  const st = $('#stage').getBoundingClientRect(), W = st.width, H = st.height, mode = e.target.classList.contains('pip-h') ? 'size' : 'move';
  if (!curPip){ const f = mainFx(); Object.assign(PipDrag, {on:true, main:true, it:null, moved:false, mode, x0:e.clientX, y0:e.clientY, stx:f.tx, sty:f.ty, ssc:f.sc, tx:f.tx, ty:f.ty, sc:f.sc}); return; }
  const it = curPip, rel = outPos - pipTarget.at, v = elVals(it, rel) || coverVals(it), r = elRect(it, v, W, H) || {cx: W / 2, cy: H / 2, w: v.w * W, h: v.w * W / clipAspect(it.clip)};
  Object.assign(PipDrag, {on:true, main:false, moved:false, it, rel, mode, x0:e.clientX, y0:e.clientY,
    sx: r.cx / W, sy: r.cy / H, sw: r.w / W, left: r.cx - r.w / 2, top: r.cy - r.h / 2, x: r.cx / W, y: r.cy / H, w: r.w / W, clip: it.clip});
});
$('#pipBox').addEventListener('pointermove', e => {
  const g = PipDrag; if (!g.on) return; const st = $('#stage').getBoundingClientRect(), W = st.width, H = st.height;
  const dx = e.clientX - g.x0, dy = e.clientY - g.y0; if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true;
  if (g.main){
    if (g.mode === 'move'){ let tx = g.stx + dx / W, ty = g.sty + dy / H; if (Math.abs(tx) < 0.015) tx = 0; if (Math.abs(ty) < 0.015) ty = 0; g.tx = tx; g.ty = ty; }
    else { const s0 = g.ssc, f = Math.max((s0 * W / 2 + dx) / (s0 * W / 2), (s0 * H / 2 + dy) / (s0 * H / 2)); g.sc = clamp(s0 * f, 0.1, 4); if (Math.abs(g.sc - 1) < 0.02) g.sc = 1; }
    applyMainTransform(); placeBox(W, H); return;
  }
  if (g.mode === 'move'){ let x = g.sx + dx / W, y = g.sy + dy / H; if (Math.abs(x - 0.5) < 0.02) x = 0.5; if (Math.abs(y - 0.5) < 0.02) y = 0.5; g.x = x; g.y = y; }
  else { const a = clipAspect(g.clip); let pw = Math.max(dx + g.sw * W, W * 0.04, (dy + g.sw * W / a) * a); pw = Math.min(pw, W * 3);
    g.w = pw / W; g.x = (g.left + pw / 2) / W; g.y = (g.top + pw / a / 2) / H; }
  $('#stage').classList.toggle('snap-x', g.mode === 'move' && g.x === 0.5);
  updateOverlay(outPos);
});
function endPipDrag(){
  const g = PipDrag; if (!g.on) return; g.on = false; $('#stage').classList.remove('snap-x');
  if (!g.moved){ if (g.main) applyMainTransform(); else togglePlay(); return; }
  if (g.main){ const sg = timeline[TL.sel.i];
    commit(() => { const it = mainFxItem(sg); it.fx.tx = r3(g.tx); it.fx.ty = r3(g.ty); it.fx.sc = r3(g.sc); }, false);
    seekOut(outPos, false); toast(`Hauptbild: ${Math.round(g.sc * 100)} %`); return; }
  const it = g.it; commit(() => setElVals(it, g.rel, {x: g.x, y: g.y, w: g.w}), false);
  seekOut(outPos, false); if (sheetItem === it) paintItem();
  toast(`Größe ${Math.round(g.w * 100)} % der Bildbreite` + (it.kf && it.kf.length ? ' · Keyframe' : ''));
}
$('#pipBox').addEventListener('pointerup', endPipDrag);
$('#pipBox').addEventListener('pointercancel', endPipDrag);
$('#pipBox').addEventListener('click', e => e.stopPropagation());
$('#pipBox').addEventListener('wheel', e => {
  e.preventDefault(); const f = e.deltaY < 0 ? 1.06 : 1 / 1.06;
  if (!curPip){ if (!mainBoxOn()) return; const sg = timeline[TL.sel.i]; commit(() => { const it = mainFxItem(sg); it.fx.sc = r3(clamp((it.fx.sc || 1) * f, 0.1, 4)); }, false); seekOut(outPos, false); return; }
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
    el.style.background = x.bg ? 'rgba(0,0,0,.55)' : ''; el.classList.toggle('sel', !!(window.TL && TL.sel && TL.sel.id === x.id));
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
  const vol = fx ? clamp(fx.vol, 0, 1) : 1; if (Math.abs(V.volume - vol) > 0.001) V.volume = vol;
}
function updateZoom(){
  const g = timeline[curSeg]; applySegFx(g);
  if (!g || g.kind !== 'main'){ V.style.transform = ''; return; }
  applyMainTransform();
}
// Zoom (innen) und Lage/Größe des Clips (außen), Ursprung in der Mitte
function applyMainTransform(){
  const g = timeline[curSeg]; if (!g || g.kind !== 'main'){ V.style.transform = ''; return; }
  const z = zoomAt(vT()), f = PipDrag.on && PipDrag.main ? PipDrag : (g.fx || FX_DEF);
  const tx = f.tx || 0, ty = f.ty || 0, sc = f.sc || 1, parts = [];
  if (tx || ty) parts.push(`translate(${(tx * 100).toFixed(3)}%, ${(ty * 100).toFixed(3)}%)`);
  if (Math.abs(sc - 1) > 1e-3) parts.push(`scale(${sc.toFixed(4)})`);
  if (z.s > 1.001) parts.push(`translate(${(-(z.cx - 0.5) * (z.s - 1) * 100).toFixed(3)}%, ${(-(z.cy - 0.5) * (z.s - 1) * 100).toFixed(3)}%) scale(${z.s.toFixed(4)})`);
  V.style.transformOrigin = '50% 50%'; V.style.transform = parts.join(' ');
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
$('#transBtn').onclick = () => {
  const todo = P.sources.map((s, k) => k).filter(k => !P.sources[k].tr);
  if (!todo.length) return;
  $('#transBtn').disabled = true; $('#transCancel').classList.remove('hidden'); $('#transProg').classList.remove('hidden'); TS.keepAwake(true);
  transCancelled = false;
  const model = $('#model').value, lang = $('#lang').value, fillers = $('#fillers').checked;
  const startTok = tokens.length, firstTime = !tokens.length, subsOnly = firstTime && studioCut() && $('#subsOnly').checked;
  if (subsOnly) freezeStudioCut();
  let n = 0, words = 0;
  const end = () => { $('#transBtn').disabled = false; $('#transCancel').classList.add('hidden'); TS.keepAwake(false); transJob = null; renderSources(); };
  const finish = () => {
    end(); P.language ||= lang;
    if (firstTime && !subsOnly){ deleted = new Set(); P.trims = {}; P.adj = {}; }
    const cleaned = subsOnly ? [] : autoClean(startTok);
    if (firstTime) genCues(); else genCues(startTok);
    renderTranscript(); changed(); saveNow(); busSend({t:'reload'}); setTab(subsOnly ? 'subs' : 'text');
    if (subsOnly){ toast(`${computedCues().length} Untertitel aus dem Schnitt erzeugt – Text, Zeiten und Position lassen sich jetzt anpassen`); return; }
    const unk = tokens.filter(t => t.i >= startTok && t.type === 'unk' && !deleted.has(t.i)).length;
    toast(`${words} Wörter erkannt` + (cleaned.length ? ` · entfernt: ${cleaned.join(', ')}` : '') + (unk ? ` · ${unk}× 🗣 nicht erkannte Sprache` : ''));
  };
  const next = () => {
    if (n >= todo.length || transCancelled) return n ? finish() : end();
    const k = todo[n], s = P.sources[k];
    if (s.hasAudio === false){ s.tr = true; s.noAudio = true; n++; return next(); }
    const label = todo.length > 1 ? `Video ${n + 1} von ${todo.length}: ` : '';
    try { transJob = TS.transcribe(s.uri, model, lang, fillers); } catch(e){ end(); $('#transMsg').textContent = 'Fehler: ' + e.message; return; }
    watchJob(transJob, j => { $('#transProg i').style.width = ((n + j.progress) / todo.length * 100).toFixed(1) + '%'; $('#transMsg').textContent = label + (j.message || ''); },
      j => { const r = j.result || {}; if (r.env) s.env = r.env; if (r.lang && !P.language) P.language = r.lang;
             s.asr = {v: CAP.version || '', timing: r.timing || '', chunks: r.chunks || 0, model, at: Date.now()};   // zur Fehlersuche: womit transkribiert wurde
             const base = appendSourceTokens(k, r.words || []); words += (r.words || []).length;
             // Stellen ohne erkannte Wörter (🗣) einzeln nachhören: meist Anläufe, die Whisper im Zusammenhang auslässt
             const gaps = TS.transcribeRanges ? tokens.filter(t => t.i >= base && t.src === k && t.type === 'unk' && t.we - t.ws >= 0.25) : [];
             if (!gaps.length || transCancelled){ n++; saveNow(); return next(); }
             let gj; try { gj = TS.transcribeRanges(s.uri, model, lang, JSON.stringify(gaps.map(t => [r3(t.ws - s.off), r3(t.we - s.off)]))); } catch(e){ n++; saveNow(); return next(); }
             transJob = gj;
             watchJob(gj, j2 => { $('#transProg i').style.width = ((n + 0.9 + 0.1 * j2.progress) / todo.length * 100).toFixed(1) + '%'; $('#transMsg').textContent = label + `Nicht erkannte Stellen nachhören (${gaps.length}) …`; },
               j2 => { const got = fillGaps(k, gaps, (j2.result || {}).ranges || []); words += got; n++; saveNow(); next(); },
               () => { n++; saveNow(); next(); });
             return; },
      j => { if (n) { transCancelled = true; finish(); $('#transMsg').textContent = 'Teilweise transkribiert.'; return; }
             end(); $('#transMsg').textContent = j.status === 'cancelled' ? 'Abgebrochen.' : ('Fehler: ' + (j.error || 'unbekannt')); });
  };
  next();
};
$('#transCancel').onclick = () => { transCancelled = true; if (transJob) TS.cancel(transJob); };

// ───────── Text ─────────
let selA = null, selB = null;
function renderTranscript(){
  const root = $('#transcript'); root.innerHTML = ''; spans = new Array(tokens.length);
  if (order.length !== tokens.length) computeOrder();
  let para = -1, pEl = null, fillers = 0, src = -1, prev = -2; const frag = document.createDocumentFragment();
  for (const i of order){
    const t = tokens[i];
    if (t.src !== src && P.sources.length > 1){ src = t.src; const h = document.createElement('div'); h.className = 'src-head'; h.textContent = `🎞 ${src + 1} · ${P.sources[src].name}`; frag.append(h); pEl = null; }
    const jump = prev >= 0 && i !== prev + 1;
    if (t.p !== para || !pEl || jump){ pEl = document.createElement('p'); para = t.p;
      if (jump) pEl.classList.add('moved');
      const ts = document.createElement('span'); ts.className = 'ts'; ts.textContent = (jump ? '↕ ' : '') + fmtT(t.ws ?? t.s); pEl.append(ts); frag.append(pEl); }
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
  if (ids.length){ const allDel = ids.every(i => deleted.has(i) || (tokens[i].type === 'word' && isSrcDeleted((tokens[i].ws + tokens[i].we) / 2))); $('#selDel').textContent = allDel ? 'Wiederherstellen' : 'Löschen';
    $('#selInfo').textContent = ids.length === 1 ? (FINE ? 'Zweites Wort anklicken – oder mit gedrückter Maustaste ziehen' : 'Zweites Wort antippen – oder gedrückt halten und ziehen') : `${ids.filter(i => tokens[i].type === 'word').length} Wörter · ${FINE ? 'Markierung ziehen' : 'gedrückt halten und ziehen'} = verschieben`; }
}
function clearSel(){ selA = selB = null; showSel(); }
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
$('#findIn').addEventListener('input', runFind);
$('#findIn').addEventListener('keydown', e => {
  if (e.key === 'Escape'){ $('#findIn').value = ''; runFind(); $('#findIn').blur(); return; }
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
$('#replToggle').onclick = () => { const r = $('#replRow'); r.classList.toggle('hidden'); if (!r.classList.contains('hidden')) ($('#findIn').value ? $('#replIn') : $('#findIn')).focus(); };
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
function cueWords(c){ const ids = []; for (let i = c.a; i <= c.b && i < tokens.length; i++) if (isTextTok(i) && tokText(tokens[i]) && !deleted.has(i) && !isSrcDeleted((wS(tokens[i]) + wE(tokens[i])) / 2)) ids.push(i); return ids; }
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
        if (nl > maxChars || w.we - cur.t0 > maxDur || endS || comma || w.ws - lastEnd > 0.8 || w.src !== prev.src){ out.push(cur); cur = null; }
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
const cueXY = c => c && c.x != null ? [c.x, c.y] : [S().x ?? 0.5, S().y ?? 0.88];
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
    const t = cueTimes(c), text = cueText(c).trim(); if (!t || !text) continue; list.push({c, s:t.s, e:t.e, text}); }
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
let cueCache = {at:-1, list:[]}, cueEls = new Map(), lastCue = null, shownCue = null;
function updateSubs(o){
  const ov = $('#subOv');
  if (!P || !P.cues.length || S().enabled === false){ ov.textContent = ''; shownCue = null; return; }
  const now = performance.now(); if (now - cueCache.at > 400) cueCache = {at:now, list:computedCues()};
  const cur = cueCache.list.find(x => o >= x.s && o < x.e);
  if (!SubDrag.on){ ov.textContent = cur ? wrapText(cur.text) : ''; shownCue = cur ? cur.c : null; placeOverlay(); }
  const id = cur ? cur.c.id : null;
  if (id !== lastCue && tab === 'subs'){
    if (lastCue && cueEls.get(lastCue)) cueEls.get(lastCue).classList.remove('now');
    if (id && cueEls.get(id)){ cueEls.get(id).classList.add('now'); if (playing && document.activeElement?.tagName !== 'TEXTAREA') cueEls.get(id).scrollIntoView({block:'center', behavior:'smooth'}); }
  }
  lastCue = id;
}
// Schriftgröße wie im Export: Anteil an der kürzeren Bildseite
const SIZE_F = {klein:0.045, mittel:0.058, groß:0.075};
function subPx(w, h){ return (SIZE_F[S().size] || 0.058) * Math.min(w, h) * (h > w ? 1.25 : 1); }
function styleOverlay(){
  if (!P) return;
  const ov = $('#subOv'), st = S(), stage = $('#stage');
  const px = subPx(stage.clientWidth || 1, stage.clientHeight || 1), o = Math.max(1, px / 14);
  ov.style.color = st.color; ov.style.fontSize = px.toFixed(1) + 'px'; ov.style.fontFamily = fontCss(st.font); ov.style.fontWeight = fontWeight(st.font);
  ov.style.textShadow = st.outline ? [[-1,-1],[1,-1],[-1,1],[1,1],[0,-1.4],[0,1.4],[-1.4,0],[1.4,0]].map(([x, y]) => `${(x*o).toFixed(1)}px ${(y*o).toFixed(1)}px 0 #000`).join(',') : `0 ${(px/20).toFixed(1)}px ${(px/10).toFixed(1)}px rgba(0,0,0,.8)`;
  placeOverlay();
}
// Untertitel an seine Position setzen und im Bild halten
function placeOverlay(){
  const ov = $('#subOv'), stage = $('#stage'); if (!P) return;
  const [x, y] = SubDrag.on ? [SubDrag.x, SubDrag.y] : cueXY(shownCue);
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
$('#subsMaster').onchange = e => { S().enabled = e.target.checked; syncStyleInputs(); changed(false); toast(e.target.checked ? 'Untertitel an' : 'Untertitel aus'); };
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
      <button data-a="auto" class="hidden">↺ auto</button><button data-a="pos" class="hidden">↺ Position</button><button data-a="time" class="hidden">↺ Zeit</button><button data-a="s-">Start −</button><button data-a="s+">Start +</button><button data-a="e-">Ende −</button><button data-a="e+">Ende +</button></div>`;
    if (idx === P.cues.length - 1) el.querySelector('[data-a=merge]').disabled = true;
    const ta = el.querySelector('textarea'); ta.value = cueText(c);
    ta.addEventListener('focus', () => ta._b = snapshot());
    ta.addEventListener('input', () => { c.text = c.own ? ta.value : ta.value.trim() === autoText(c) ? null : ta.value; paintCue(c, true); cueCache.at = -1; clearTimeout(saveT); saveT = setTimeout(saveNow, 800); });
    ta.addEventListener('blur', () => { if (ta._b && ta._b !== snapshot()){ undo.push(ta._b); redo = []; } ta._b = null; });
    frag.append(el); cueEls.set(c.id, el);
  });
  box.append(frag); P.cues.forEach(c => paintCue(c)); updateCount();
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
}
function updateSubs2(){ P.cues.forEach(c => paintCue(c)); updateCount(); }
function updateCount(){ $('#subCount').textContent = computedCues().length + ' Untertitel'; }
function updateSubsList(){ if (tab === 'subs') updateSubs2(); }
$('#cueList').addEventListener('click', e => {
  const el = e.target.closest('.cue'); if (!el) return;
  const idx = P.cues.findIndex(c => c.id === el.dataset.id), c = P.cues[idx];
  const btn = e.target.closest('[data-a]');
  if (!btn){ if (e.target.closest('.tm')){ const t = cueTimes(c); if (t) seekOut(t.s + 0.01, false); } return; }
  const a = btn.dataset.a, ta = el.querySelector('textarea');
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
const TYPE_LBL = {broll:'B-Roll', insert:'Einschub', pip:'Einblendung', zoom:'Zoom', fx:'Anpassung', title:'Titel'};
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
      <div class="field pipopt"><span>Größe <b id="cSizeV"></b></span><input type="range" id="cSize" min="5" max="300" step="1"></div>
      <div class="field pipopt"><span>Platzieren</span><div class="seg-ctl" id="cCorner"><button data-v="ol">↖</button><button data-v="or">↗</button><button data-v="mm">Mitte</button><button data-v="ul">↙</button><button data-v="ur">↘</button><button data-v="full">Vollbild</button></div></div>
      <p class="muted small pipopt">Im Bild ziehen verschiebt, die Ecke unten rechts ändert die Größe${FINE ? ' (auch mit dem Mausrad)' : ''}. Mit Keyframes (Taste M) bewegt sich das Element über die Zeit.</p>`);
  }
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
    const b = e.target.closest('button'); if (!b) return;
    const seg = b.closest('.seg-ctl');
    if (seg){ const v = b.dataset.v;
      commit(() => { if (seg.id === 'zKind') it.kind = v; if (seg.id === 'cMode'){ it.type = v; if (v === 'insert') it.out = Math.max(it.out, Math.min(it.clip.duration, it.in + 1)); }
        if (seg.id === 'cMode' && v === 'pip') pipFree(it);
        if (seg.id === 'cCorner'){ if (v === 'full'){ delete it.w; delete it.x; delete it.y; delete it.kf; it.type = 'broll'; } else pipCorner(it, v); } }, false); if (seg.id !== 'zKind') seekOut(outPos, false); h.textContent = TYPE_LBL[it.type]; paintItem(); return; }
    if (b.dataset.z){ commit(() => it.dur = clamp(+(it.dur + +b.dataset.z).toFixed(2), 0.2, 60), false); }
    else if (b.dataset.at){ commit(() => { const p0 = objStart(it); it.at = clamp(r3(it.at + +b.dataset.at), 0, srcTotal); groupShift(it, objStart(it) - p0); }, false); seekOut(srcToOut(snapSrc(it.at)), false); }
    else if (b.dataset.cin){ commit(() => it.in = clamp(r3(it.in + +b.dataset.cin), 0, it.out - 0.1), false); $('#cPrev').currentTime = it.in; }
    else if (b.dataset.cout){ commit(() => it.out = clamp(r3(it.out + +b.dataset.cout), it.in + 0.1, it.clip.duration), false); $('#cPrev').currentTime = it.out; }
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
    $$('.pipopt').forEach(x => x.classList.toggle('hidden', it.type === 'insert'));
    $$('.volopt').forEach(x => x.classList.toggle('hidden', isImg(it.clip) || it.clip.hasAudio === false));
    const vol = it.vol ?? (it.type === 'insert' ? 1 : 0); $('#cVol').value = Math.round(vol * 100); $('#cVolV').textContent = vol ? Math.round(vol * 100) + ' %' : 'stumm';
    if (it.type !== 'insert'){ const v = elVals(it, curRel(it)), w = v ? v.w : coverVals(it).w; $('#cSize').value = Math.round(w * 100); $('#cSizeV').textContent = Math.round(w * 100) + ' %' + (it.kf && it.kf.length ? ` · ${it.kf.length} Keyframes` : ''); } $('#cInHere').classList.toggle('hidden', isImg(it.clip)); $('#cOutHere').classList.toggle('hidden', isImg(it.clip)); }
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
  $('#exQualityRow').dataset.fmt = CAP.platform === 'android' ? 'keins' : 'video';
  $('#exNote').textContent = CAP.platform === 'web' ? 'Das Video wird in deinem Browser berechnet und danach heruntergeladen – nichts verlässt dein Gerät. Lass diesen Tab während des Exports geöffnet. Untertitel kommen zusätzlich als SRT-Datei mit.'
    : CAP.platform === 'android' ? 'Das Video landet direkt in deiner Galerie (Ordner „HoneyCut“). Bitte die App während des Exports geöffnet lassen.'
    : 'Die Dateien landen im Ordner „…_honeycut“ neben deinem ersten Video. Untertitel kommen zusätzlich als SRT-Datei mit.';
  paintExportForm();
}
function paintExportForm(){
  $$('#exFmt button').forEach(b => b.classList.toggle('on', b.dataset.v === exFmt));
  $$('#paneExport [data-fmt]').forEach(el => el.classList.toggle('hidden', !el.dataset.fmt.split(' ').includes(exFmt)));
  $('#exSubs').checked = P ? P.settings.burn !== false : true;
  $('#exBtn').textContent = {video:'Video exportieren', audio:'Audio exportieren', capcut:'CapCut-Projekt erstellen', concat:'Concat-Projekt erstellen'}[exFmt];
  if (P) renderExport();
}
$('#exFmt').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; exFmt = b.dataset.v; paintExportForm(); });
$('#exSubs').onchange = e => { P.settings.burn = e.target.checked; changed(false); };
function outSize(){
  let [w, h] = dispSize(primary()); const lim = +$('#exRes').value;
  if (lim && Math.min(w, h) > lim){ const f = lim / Math.min(w, h); w *= f; h *= f; }
  return [Math.round(w / 2) * 2, Math.round(h / 2) * 2];
}
function buildPlan(){
  const [W, H] = outSize();
  const segs = timeline.map(g => {
    if (g.kind === 'insert') return {kind:'insert', uri:g.uri, in:r3(g.in), out:r3(g.out), image: isImg(g.item.clip), hasAudio: g.item.clip.hasAudio !== false && !isImg(g.item.clip), hasVideo:true, vol:+(g.item.vol ?? 1)};
    const s = P.sources[g.si], off = s.off;
    const zs = P.items.filter(z => z.type === 'zoom' && z.at < g.out && z.at + z.dur > g.in)
      .map(z => ({at:r3(z.at - off), dur:z.dur, kind:z.kind, strength:z.strength, cx:z.cx, cy:z.cy}));
    const fx = g.fx || FX_DEF;
    return {kind:'main', src:g.si, uri:s.uri, in:r3(g.in - off), out:r3(g.out - off), zooms:zs, hasAudio: s.hasAudio !== false, hasVideo: hasVid(s),
      speed:+(fx.speed || 1), vol:+(fx.vol ?? 1), bright:+(fx.bright || 0), contrast:+(fx.contrast || 0), sat:+(fx.sat || 0), gray:!!fx.gray,
      tx:+(fx.tx || 0), ty:+(fx.ty || 0), sc:+(fx.sc || 1)};
  });
  const ovs = overlays.map(o => ({mode:o.x.type, image: isImg(o.x.clip), uri:o.x.clip.uri, in:o.x.in, out:r3(o.x.in + (o.end - o.at)), at:r3(o.at), corner:o.x.corner || 'or', size:o.x.size || 0.33,
    ...(o.x.w != null || (o.x.kf && o.x.kf.length) ? (() => { const v = elVals(o.x, 0); return {x:r3(v.x), y:r3(v.y), w:r3(v.w)}; })() : {}),
    ...(o.x.kf && o.x.kf.length ? {kf: o.x.kf.filter(k => k.t <= o.end - o.at + 0.01).map(k => ({t:k.t, x:k.x, y:k.y, w:k.w}))} : {}),
    aspect:+clipAspect(o.x.clip).toFixed(5), track: elTrack(o.x), vol:+(o.x.vol || 0), hasAudio: o.x.clip.hasAudio !== false && !isImg(o.x.clip),
    width:o.x.clip.width, height:o.x.clip.height, rotation:o.x.clip.rotation || 0}));
  const cues = S().enabled !== false && P.cues.length ? computedCues().map(x => { const [cx, cy] = cueXY(x.c); return {start:r3(x.s), end:r3(x.e), text:wrapText(x.text), x:cx, y:cy}; }) : [];
  for (const t of P.items.filter(x => x.type === 'title' && (x.text || '').trim())){ const a = srcToOut(snapSrc(t.at)); if (a >= total) continue;
    cues.push({start:r3(a), end:r3(Math.min(total, a + t.dur)), text:t.text.trim(), x:t.x, y:t.y, size:+((SIZE_F[t.size] || 0.058) * (t.scale || 1)).toFixed(4), color:t.color || '#FFFFFF', outline:t.outline !== false, bg:!!t.bg, title:true, font:t.font || ''}); }
  const subs = cues.length ? {cues, style:S(), fonts: planFonts([S().font, ...cues.map(c => c.font)])} : null;
  const media = P.sources.map(s => ({uri:s.uri, name:s.name, duration:s.duration, width:s.width, height:s.height, fps:s.fps, hasAudio:s.hasAudio !== false, hasVideo:hasVid(s), kind:s.kind || 'video'}));
  return {format:exFmt, name: ($('#exName').value || P.name).replace(/[\\/:*?"<>|]/g, '_'), width:W, height:H, fps:primary().fps || 30, total:r3(total),
    segments:segs, overlays:ovs, subs, burn: P.settings.burn !== false, quality: $('#exQuality').value, audioFormat: $('#exAudioFmt').value,
    capcutInstall: $('#exCapcutInstall').checked, sources:media, project:P.id};
}
function renderExport(){
  const [W, H] = outSize(), n = P.items.reduce((m, x) => (m[x.type] = (m[x.type] || 0) + 1, m), {});
  $('#exSummary').textContent = `${fmtT(total)}${exFmt === 'audio' ? '' : ` · ${W}×${H}`} · ${timeline.filter(g => g.kind === 'main').length} Abschnitte` + (P.sources.length > 1 ? ` aus ${P.sources.length} Videos` : '') +
    (n.insert ? ` · ${n.insert} Einschub` : '') + (n.broll ? ` · ${n.broll} B-Roll` : '') + (n.pip ? ` · ${n.pip} Einblendung${n.pip > 1 ? 'en' : ''}` : '') + (n.zoom ? ` · ${n.zoom} Zoom` : '') + (n.fx ? ` · ${n.fx} Anpassungen` : '') + (n.title ? ` · ${n.title} Titel` : '') +
    (S().enabled !== false && P.cues.length ? ` · ${computedCues().length} Untertitel` : '');
}
$('#exRes').onchange = renderExport;
let exJob = null, exResult = null;
$('#exBtn').onclick = () => {
  if (!timeline.length) return; saveNow(); pausePlay();
  const plan = buildPlan(); exResult = null; $('#exDone').classList.add('hidden'); $('#exFiles').textContent = '';
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
  tab = t; clearSel();
  $('#proj').dataset.tab = t;
  $('#paneTrans').classList.toggle('hidden', t !== 'trans');
  $('#paneText').classList.toggle('hidden', t !== 'text'); $('#paneSubs').classList.toggle('hidden', t !== 'subs');
  $('#paneStudio').classList.toggle('hidden', t !== 'studio'); $('#paneExport').classList.toggle('hidden', t !== 'export');
  $$('#tabs button[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t || (t === 'trans' && b.dataset.tab === 'text')));
  if (t === 'trans') renderSources();
  if (t === 'subs') renderSubs(); if (studioOn() && window.renderStudio) renderStudio(); if (t === 'export') renderExport();
  setTimeout(fitStage, 0);
}
const TAB_LBL = {text:'Text', trans:'Text', subs:'Untertitel', studio:'Studio', export:'Export'};
$('#detachBtn').onclick = () => {
  if (!P) return; saveNow(); const view = tab === 'trans' ? 'text' : tab;
  let url = ''; try { url = TS.openWindow ? TS.openWindow(P.id, view) : ''; } catch(e){ return toast('Fenster konnte nicht geöffnet werden'); }
  if (url && /^https?:/.test(url)) window.open(url, '_blank', 'width=1280,height=860');
  setTab(view === 'studio' ? 'text' : 'studio'); toast(`${TAB_LBL[view]} läuft jetzt in einem eigenen Fenster`);
};
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || !P) return;
  const t = b.dataset.tab;
  if (!tokens.length && t !== 'studio' && t !== 'export' && !(t === 'subs' && P.cues.length)){
    setTab('trans');
    if (t === 'subs'){ if (studioCut()){ $('#subsOnly').checked = true; renderSources(); toast('Untertitel brauchen ein Transkript – „Nur für Untertitel“ lässt deinen Schnitt unverändert'); } else toast('Für Untertitel zuerst transkribieren'); }
    return; }
  setTab(t); });
matchMedia('(min-width: 1000px) and (min-height: 600px)').addEventListener('change', () => { fitStage(); });

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
  if (p){ document.body.classList.add('solo'); Promise.resolve(openProject(p)).then(() => { if (P && h.get('view')) setTab(h.get('view')); }); } })();
