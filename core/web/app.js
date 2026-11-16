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
const fmtS = t => { t = Math.round(Math.max(0, t || 0) * 10) / 10; const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + s.toFixed(1).padStart(4, '0').replace('.', ','); };
const norm = w => w.toLowerCase().replace(/[.,!?;:…"„“”‚‘’'()\-–—]/g, '');
const FILLER = /^(ä+h*m*|ä+m+|ö+h*m*|ö+m+|e+h+m*|e+m+|h+m+|mh+m+|m+h*m+|u+h+m*|uu+m+|erm|a+h+m+)$/i;
const WD = {t: 0, v: -1, n: 0};   // Abspiel-Wächter (siehe playWatch)
const newId = () => Math.random().toString(36).slice(2, 10);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const r3 = x => +(+x).toFixed(3);
const SENT_END = /[.?!…؟۔]$/;   // „؟“ und „۔“: Fragezeichen und Punkt in arabischer Schrift
const sentEnd = w => SENT_END.test(w || '') && !/^\d+\.$/.test(w || '');   // „am 31.“ ist kein Satzende
const tokText = t => (P && P.edits && P.edits[t.i] != null) ? P.edits[t.i] : t.text;
// Unsichere Wörter (C2): Whisper nennt zu jedem Wort, wie sicher es sich war. Unter 50 % gilt ein Wort als unsicher, bis es
// bestätigt (t.ok) oder korrigiert ist.
const LOW_PR = 0.5;
const isLowTok = t => t.type === 'word' && t.pr < LOW_PR && !t.ok && !(P && P.edits && P.edits[t.i] != null);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2600); }
// Text nur dann ins Dokument schreiben, wenn er sich geändert hat – und dann in den vorhandenen Textknoten.
// „el.textContent = …“ ersetzt den Textknoten jedes Mal, auch bei gleichem Text. In der Abspielschleife hieß das:
// bei jedem Bild neue Knoten, neue Stil- und Layoutberechnung, neues Zeichnen – für Anzeigen, die sich gar nicht ändern.
function setText(el, s){
  s = String(s); const n = el.firstChild;
  if (n && n.nodeType === 3 && !n.nextSibling){ if (n.data !== s) n.data = s; }
  else if (s || n) el.textContent = s;
}

// ───────── Protokoll für die Fehlersuche ─────────
// Unerwartete Fehler und Auffälligkeiten beim Abspielen landen in der Konsole und – wo die Plattform es anbietet (Windows:
// textschnitt.log) – im Protokoll. Jede Meldung höchstens einmal, insgesamt höchstens 40 je Sitzung.
const hcLogged = new Set();
function hcLog(msg){
  msg = String(msg).slice(0, 600); if (hcLogged.has(msg) || hcLogged.size >= 40) return; hcLogged.add(msg);
  try { console.warn('[hc] ' + msg); } catch(_){}
  try { if (TS.log) TS.log(msg); } catch(_){}
}
addEventListener('error', e => { if (e && e.message) hcLog(`Fehler: ${e.message} (${String(e.filename || '').split('/').pop()}:${e.lineno || 0})`); });
addEventListener('unhandledrejection', e => { const r = e && e.reason; hcLog('Fehler (Promise): ' + (r && (r.stack || r.message) || r)); });

// ───────── Brücke zur Plattform ─────────
const pending = new Map();
window.TSApp = {
  onPicked(reqId, json){ const cb = pending.get(reqId); pending.delete(reqId); if (cb) cb(json ? J(json) : null); },
  onBack(){ if (exBatch) return true;   // während die Clips einer Reihe eingereiht werden, bleibt das Projekt offen
            if ($('#proj').classList.contains('full')){ setFull(false); return true; }
            if (!$('#sheet').classList.contains('hidden')) { closeSheet(); return true; }
            if (!$('#mgSheet').classList.contains('hidden')) { closeMg(); return true; }
            if (!$('#modelSheet').classList.contains('hidden')) { closeSettings(); return true; }
            if (!$('#proj').classList.contains('hidden')) { closeProject(); return true; } return false; },
  onPause(){ if (P) { pausePlay(); saveNow(); rememberOpen(); } },
  onOpenFiles(json){ const list = J(json); if (list && list.length){ if (P) closeProject(); createProject(list); } },
};
function pickMedia(kind){ return new Promise(res => { const id = newId(); pending.set(id, res); TS.pick(id, kind); }); }
function watchJob(id, onTick, onDone, onFail){
  let miss = 0;
  const tick = () => {
    // Schlägt eine einzelne Abfrage fehl (Backend kurz beschäftigt), wird weitergefragt – früher blieb die Anzeige dann für immer stehen
    let j; try { j = J(TS.job(id)); } catch(e){ if (++miss <= 6) return setTimeout(tick, 700); hcLog('Auftrag nicht abfragbar: ' + (e && e.message)); return onFail({error:'Der Auftrag ließ sich nicht mehr abfragen'}); }
    miss = 0;
    if (!j) return onFail({error:'Job verloren'});
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
// Schnitt-Zeitleiste im Text-Reiter: dieselbe Zeitleiste, aber nur mit der Hauptspur und nur für Schnitte (teilen, Kanten ziehen, löschen).
const tlLite = () => tab === 'text';
const tlOn = () => studioOn() || (tab === 'text' && !!P && !$('#proj').classList.contains('tl-min'));
// Nach einem Sprung (Wort angeklickt, Marke, Quelle, nächster Schnitt): Die Zeitleiste rückt die Abspiellinie ins Bild, wenn sie zu sehen ist
const tlReveal = () => { if (!tlOn()) return; if (window.revealHead) revealHead(outPos); else if (window.syncScroll) syncScroll(outPos, true); };

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
// Suche, Reihenfolge, Vorschaubild und „Duplizieren“ (A9). Das Vorschaubild ist das zuletzt gesehene Bild des Projekts, klein im Gerät
// abgelegt (localStorage); wo das Backend Bilder aus dem Video liefert (Windows), springt es für noch nie geöffnete Projekte ein.
let homeList = [];
const THUMB_KEY = id => 'hc-thumb-' + id;
const HOME_SORT = {new: (a, b) => b.updated - a.updated, old: (a, b) => a.updated - b.updated, len: (a, b) => b.duration - a.duration || b.updated - a.updated,
  name: (a, b) => String(a.name).localeCompare(String(b.name), 'de', {numeric: true, sensitivity: 'base'}) || b.updated - a.updated};
try { const v = localStorage.getItem('hc-home-sort'); if (HOME_SORT[v]) $('#projSort').value = v; } catch(_){}
function projThumb(p){ try { const d = localStorage.getItem(THUMB_KEY(p.id)); if (d) return d; } catch(_){} return p.thumb ? THUMB(p.thumb, Math.min(1, (p.duration || 2) / 2), 96) : ''; }
// Bild an der Abspiellinie als kleines Vorschaubild merken (beim Schließen und beim Verlassen der Seite)
function saveThumb(){
  if (!P || !timeline.length) return;
  try {
    const g = timeline[curSeg], el = g && g.kind === 'insert' ? (isImg(g.item.clip) ? II : IV) : V, w = el.videoWidth || el.naturalWidth, h = el.videoHeight || el.naturalHeight;
    if (!w || !h || (el.readyState != null && el.readyState < 2)) return;
    const H = 120, W = Math.max(40, Math.round(H * w / h)), c = document.createElement('canvas'); c.width = W; c.height = H;
    c.getContext('2d').drawImage(el, 0, 0, W, H);
    const d = c.toDataURL('image/jpeg', 0.7); if (d.length > 400 && d.length < 80000) localStorage.setItem(THUMB_KEY(P.id), d);
  } catch(_){}
}
function duplicateProject(id){
  let p = null; try { p = J(TS.loadProject(id)); } catch(_){}
  if (!p || typeof p !== 'object') return toast('Projekt konnte nicht geladen werden');
  const names = new Set(homeList.map(x => x.name)), base = String(p.name || 'Projekt').replace(/ \(Kopie(?: \d+)?\)$/, ''); let name = base + ' (Kopie)', k = 2;
  while (names.has(name)) name = `${base} (Kopie ${k++})`;
  p.id = newId(); p.name = name; p.created = p.updated = Date.now();
  try { TS.saveProject(p.id, JSON.stringify(p)); } catch(e){ return toast('Duplizieren fehlgeschlagen: ' + ((e && e.message) || e)); }
  try { const d = localStorage.getItem(THUMB_KEY(id)); if (d) localStorage.setItem(THUMB_KEY(p.id), d); } catch(_){}
  showHome(); toast(`„${name}“ angelegt – als Ausgangspunkt für eine Variante`);
}
function showHome(){
  $('#home').classList.remove('hidden'); $('#proj').classList.add('hidden');
  homeList = J(TS.listProjects()) || [];
  // Vorschaubilder aufräumen: gelöschte Projekte, und bei sehr vielen Projekten bleiben nur die der 120 zuletzt bearbeiteten im Gerät
  // (der Platz dort ist begrenzt und wird auch für Looks, Füllwörter und Designprofile gebraucht)
  try { const ids = new Set([...homeList].sort(HOME_SORT.new).slice(0, 120).map(p => p.id)); for (let k = localStorage.length - 1; k >= 0; k--){ const key = localStorage.key(k); if (key && key.startsWith('hc-thumb-') && !ids.has(key.slice(9))) localStorage.removeItem(key); } } catch(_){}
  renderHome();
  renderUpdateBanner();
  $('#homeHint').textContent = CAP.platform === 'web' ? 'Wähle ein oder mehrere Videos von deinem Gerät. Sie werden nicht hochgeladen: Transkription, Schnitt und Export laufen komplett in deinem Browser.'
    : CAP.platform === 'desktop' ? 'Wähle ein oder mehrere Videos (Strg/Umschalt für mehrere). Sie werden hintereinandergehängt und gemeinsam transkribiert.'
    : 'Wähle ein oder mehrere Videos aus deiner Galerie. Sie werden hintereinandergehängt und auf dem Gerät transkribiert – du schneidest dann über den Text.';
}
function renderHome(){
  const box = $('#projList'); box.innerHTML = '';
  const words = $('#projFind').value.toLowerCase().split(/\s+/).filter(Boolean), all = homeList;
  $('#homeEmpty').classList.toggle('hidden', all.length > 0);
  $('#homeFind').classList.toggle('hidden', all.length < 2 && !words.length);   // ab zwei Projekten: die Suche findet auch, was in den Videos gesagt wird
  const list = all.filter(p => { const n = String(p.name || '').toLowerCase(); return words.every(w => n.includes(w)); }).sort(HOME_SORT[$('#projSort').value] || HOME_SORT.new);
  if (!list.length && all.length){ const e = document.createElement('p'); e.className = 'muted home-none'; e.textContent = `Kein Projekt passt zu „${$('#projFind').value.trim()}“.`; box.append(e); }
  for (const p of list){
    const el = document.createElement('div'); el.className = 'proj-item'; el.dataset.id = p.id;
    el.innerHTML = `<span class="pthumb"></span><div class="meta"><b></b><span class="muted small"></span></div><div class="pacts"><button class="del ren" title="Umbenennen">✎</button><button class="del dup" title="Duplizieren – als Ausgangspunkt für eine Variante">⧉</button>${TS.versions ? '<button class="del ver" title="Frühere Fassungen dieses Projekts">🕘</button>' : ''}${TS.exportPackage ? '<button class="del share" title="Projekt weitergeben (.honeycut) – auf einem anderen Gerät oder von einer anderen Person weiterbearbeiten">⤴</button>' : ''}<button class="del kill" title="Löschen">🗑</button></div><button class="del more" title="Umbenennen, Duplizieren, Weitergeben, Löschen">⋯</button>`;
    el.querySelector('b').textContent = p.name;
    el.querySelector('.meta span').textContent = `${fmtT(p.duration)}${p.sources > 1 ? ` · ${p.sources} Videos` : ''} · ${p.transcribed ? 'transkribiert' : 'noch nicht transkribiert'} · ${new Date(p.updated).toLocaleDateString('de-DE')}`;
    const src = projThumb(p), th = el.querySelector('.pthumb');
    if (src){ const im = document.createElement('img'); im.alt = ''; im.loading = 'lazy'; im.onerror = () => { im.remove(); th.innerHTML = icon('🎞'); }; im.src = src; th.append(im); } else th.innerHTML = icon('🎞');
    const acts = {
      ren: () => { const b = el.querySelector('b'); if (b) editNameInline(b, p.name, v => { if (renameProject(p.id, v)){ p.name = v; b.textContent = v; toast('Umbenannt'); } }); },
      dup: () => duplicateProject(p.id),
      ver: () => openVersions(p),
      share: () => packageDialog(p.id),
      kill: () => { if (confirm(`„${p.name}“ löschen? Deine Videos bleiben erhalten.` + (TS.trash ? '\n\nDas Projekt liegt danach noch 30 Tage im Papierkorb.' : ''))) { TS.deleteProject(p.id); showHome(); } },
    };
    el.onclick = e => {
      if (e.target.closest('.name-edit')) return;
      const b = e.target.closest('.del'); if (!b) return openProject(p.id);
      if (b.classList.contains('more')){ const r = b.getBoundingClientRect();   // schmale Bildschirme: alle Handgriffe in einem Menü
        return showMenu(Math.min(r.left, innerWidth - 240), r.bottom + 4, [{icon: icon('✎'), label: 'Umbenennen', fn: acts.ren}, {icon: icon('⧉'), label: 'Duplizieren', fn: acts.dup},
          ...(TS.versions ? [{icon: icon('🕘'), label: 'Frühere Fassungen', fn: acts.ver}] : []), ...(TS.exportPackage ? [{icon: icon('⤴'), label: 'Weitergeben', fn: acts.share}] : []), {icon: icon('🗑'), label: 'Löschen', fn: acts.kill, cls: 'danger'}]); }
      for (const k in acts) if (b.classList.contains(k)) return acts[k]();
    };
    box.append(el);
  }
  // Papierkorb (Desktop): gelöschte Projekte lassen sich 30 Tage lang zurückholen
  const nTrash = TS.trashCount ? TS.trashCount() : 0;
  if (nTrash){ const t = document.createElement('button'); t.className = 'btn small trash-link'; t.textContent = `🗑 Papierkorb (${nTrash})`; t.onclick = openTrash; box.append(t); }
  findLater();   // Treffer aus den Transkripten (C9)
}
$('#projFind').addEventListener('input', renderHome);
$('#projFind').addEventListener('keydown', e => { if (e.key === 'Escape' && $('#projFind').value){ $('#projFind').value = ''; renderHome(); } });
$('#projSort').addEventListener('change', () => { try { localStorage.setItem('hc-home-sort', $('#projSort').value); } catch(_){} renderHome(); });
if (CAP.version && CAP.platform !== 'web'){ const v = document.createElement('p'); v.className = 'muted small'; v.style.cssText = 'text-align:center;margin:24px 0 90px'; v.textContent = 'HoneyCut ' + CAP.version; $('#home .home-body').append(v); }
$('#newProj').onclick = async () => { const list = asList(await pickMedia('videos')); if (list.length) createProject(list); };
function createProject(list){
  list = list.filter(Boolean); if (!list.length) return;
  const first = list[0];
  const name = first.name.replace(/\.[^.]+$/, '') + (list.length > 1 ? ` + ${list.length - 1}` : '');
  const p = {id:newId(), name, created:Date.now(), updated:Date.now(), sources:list.map(cleanSrc),
             tokens:[], deleted:[], trims:{}, adj:{}, dels:[], splits:[], settings:{pad:0.06, burn:true}, cues:[], sub_style:{...DEF_STYLE}, items:[]};
  // Hausstil für neue Projekte (A3)
  const hd = houseList.find(h => h.id === houseDef); if (hd){ houseInto(p, hd.st); p.house = hd.id; autoSet(hd.st.auto); }
  // Altes Desktop-Projekt neben dem Video? Dann Transkript übernehmen.
  const lg = list.length === 1 && first.legacy;
  if (lg && lg.tokens && lg.tokens.length){
    p.tokens = lg.tokens.map(t => ({...t, src:0})); p.deleted = lg.deleted || []; p.trims = lg.trims || {}; p.language = lg.language;
    if (lg.cues) p.cues = lg.cues; if (lg.sub_style) p.sub_style = {...DEF_STYLE, ...lg.sub_style}; p.sources[0].tr = true;
  }
  TS.saveProject(p.id, JSON.stringify(p)); openProject(p.id);
  if (lg && lg.tokens && lg.tokens.length) toast('Vorhandenes Transkript übernommen'); else if (hd) toast(`Hausstil „${hd.name}“ übernommen`);
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
  let np = null; try { np = J(TS.loadProject(id)); } catch(e){ hcLog('Projekt laden: ' + (e && e.message)); }
  if (!np || typeof np !== 'object') return toast('Projekt konnte nicht geladen werden');   // das offene Projekt bleibt dabei unberührt
  P = np; clearTimeout(saveRetryT); saveFails = 0; $('#saved').classList.remove('err'); $('#saved').textContent = '';
  if (!P.sources){ P.sources = [P.main]; P.sources[0].tr = !!(P.tokens || []).length; delete P.main; }   // altes Format (ein Video)
  P.adj ||= {}; P.speakers ||= []; P.slides ||= []; P.items ||= []; P.marks ||= []; if (!Array.isArray(P.refs)) P.refs = []; if (!Array.isArray(P.checks)) P.checks = []; P.dels ||= []; P.splits ||= []; P.edits ||= {}; P.moves ||= []; P.trims ||= {}; P.settings ||= {pad:0.06}; P.cues ||= [];
  if (P.settings.burn == null) P.settings.burn = true;
  P.sub_style = {...DEF_STYLE, ...(P.sub_style || {})}; if (P.sub_style.y == null) P.sub_style.y = POS_Y[P.sub_style.pos] ?? 0.88;
  tokens = P.tokens || []; tokens.forEach(t => { if (t.src == null) t.src = 0; });
  P.checks = P.checks.filter(c => c && Array.isArray(c.ids) && (c.ids.length || (c.tr || []).length || (c.v || []).length) && chkSpan(c)[1] < tokens.length);
  deleted = new Set(P.deleted || []); undo = []; redo = [];
  layoutSources(); vSi = -1; vPending = null; cueCache.at = -1; subShown = null;
  if (P.frameNew){ delete P.frameNew; if (P.format && !P.frame) P.frame = clampFrame({sc: coverSc(), tx: 0, ty: 0}); }   // neues Projekt mit Hausstil: Format füllt die Leinwand
  $('#home').classList.add('hidden'); $('#proj').classList.remove('hidden');
  projNameEl.textContent = P.name; $('#exName').value = P.name + '_geschnitten';
  if (!exDirect){ exResult = null; $('#exDone').classList.add('hidden'); $('#exProg').classList.add('hidden'); $('#exWarn').classList.add('hidden'); $('#exMsg').textContent = ''; $('#exFiles').textContent = ''; }   // Ergebnis eines früheren Exports gehört zum Projekt davor
  const [ow, oh] = baseDims(); $('#exRes').options[0].textContent = `Original (${ow}×${oh})`;
  fitStage(); setTimeout(fitStage, 60);
  fillModels(); syncLang(); syncSafe(); syncStyleInputs(); renderExportForm();
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
function rememberOpen(){ if (!P || document.body.classList.contains('solo')) return; if (document.hidden) saveThumb(); try { localStorage.setItem(OPEN_KEY, JSON.stringify({id: P.id, tab, pos: outPos, at: Date.now()})); } catch(_){} }
// ───────── Verwaltung (Desktop): frühere Fassungen und Papierkorb ─────────
const fmtWhen = ms => new Date(ms).toLocaleString('de-DE', {weekday:'short', day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit'});
const fmtBytes = b => b >= 1e9 ? (b / 1e9).toFixed(1).replace('.', ',') + ' GB' : b >= 1e6 ? Math.round(b / 1e6) + ' MB' : b >= 1e3 ? Math.round(b / 1e3) + ' KB' : (b || 0) + ' B';
function openMg(html){ const b = $('#mgBody'); b.innerHTML = html; $('#modelSheet').classList.add('hidden'); $('#mgSheet').classList.remove('hidden'); $('#sheetBack').classList.remove('hidden');
  const c = b.querySelector('#mgClose'); if (c) c.onclick = closeMg; return b; }
function closeMg(){ $('#mgSheet').classList.add('hidden'); if ($('#sheet').classList.contains('hidden') && $('#modelSheet').classList.contains('hidden')) $('#sheetBack').classList.add('hidden'); }
function closeSettings(){ $('#modelSheet').classList.add('hidden'); if ($('#sheet').classList.contains('hidden') && $('#mgSheet').classList.contains('hidden')) $('#sheetBack').classList.add('hidden'); }
$('#sheetBack').addEventListener('click', () => { closeMg(); closeSettings(); });
const verLine = v => [fmtT(v.duration), `${v.cut} Stellen gelöscht`, v.items ? `${v.items} Elemente` : '', v.cues ? `${v.cues} Untertitel` : ''].filter(Boolean).join(' · ');
// Anderen Fenstern, die dieses Projekt offen haben, etwas mitteilen (auch wenn es hier gerade nicht offen ist)
function busNotify(pid, msg){
  if (!CAP.bus) return;
  if (TS.busPost) return TS.busPost(pid, WIN, JSON.stringify(msg));
  fetch('api/bus?p=' + encodeURIComponent(pid) + '&from=' + WIN + '&k=' + msg.t, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(msg)}).catch(() => {});
}
function openVersions(p){
  let list; try { list = J(TS.versions(p.id)) || []; } catch(e){ return toast('Die Fassungen ließen sich nicht lesen'); }
  const body = openMg(`<h3>Frühere Fassungen</h3><p class="muted small"></p><div class="mg-list"></div><div class="row"><button class="btn" id="mgClose">Schließen</button></div>`);
  body.querySelector('p').textContent = list.length
    ? `„${p.name}“: Beim Arbeiten legt HoneyCut höchstens alle 15 Minuten den vorigen Stand zurück und behält die letzten sechs.`
    : `Für „${p.name}“ gibt es noch keine früheren Fassungen. Beim Arbeiten legt HoneyCut höchstens alle 15 Minuten den vorigen Stand zurück.`;
  const box = body.querySelector('.mg-list');
  for (const v of list){
    const el = document.createElement('div'); el.className = 'mg-item';
    el.innerHTML = `<div class="meta"><b></b><span class="muted small"></span></div><button class="btn small" data-a="copy">Als Kopie öffnen</button><button class="btn small" data-a="back">Zurückholen</button>`;
    el.querySelector('b').textContent = fmtWhen(v.at) + (v.deleted ? ' · vor dem Löschen' : '');
    el.querySelector('span').textContent = (v.name && v.name !== p.name ? `„${v.name}“ · ` : '') + verLine(v);
    el.querySelector('[data-a=copy]').onclick = () => {
      try { const r = J(TS.restoreVersion(p.id, v.file, true)); closeMg(); toast('Fassung als eigenes Projekt geöffnet'); openProject(r.id); }
      catch(e){ toast('Das ging nicht: ' + ((e && e.message) || e)); } };
    el.querySelector('[data-a=back]').onclick = () => {
      if (!confirm(`Den Stand von ${fmtWhen(v.at)} zurückholen?\n\nDer jetzige Stand von „${p.name}“ wird dabei selbst als Fassung zurückgelegt.`)) return;
      try { TS.restoreVersion(p.id, v.file, false); } catch(e){ return toast('Das ging nicht: ' + ((e && e.message) || e)); }
      busNotify(p.id, {t:'reload'}); closeMg(); toast('Fassung zurückgeholt');
      if (P && P.id === p.id) openProject(p.id, true); else showHome(); };
    box.append(el);
  }
}
function openTrash(){
  let list; try { list = J(TS.trash()) || []; } catch(e){ return toast('Der Papierkorb ließ sich nicht lesen'); }
  if (!list.length){ closeMg(); showHome(); return toast('Der Papierkorb ist leer'); }
  const body = openMg(`<h3>Papierkorb</h3><p class="muted small">Gelöschte Projekte bleiben 30 Tage hier. Deine Videos sind davon nicht betroffen.</p><div class="mg-list"></div>
    <div class="row"><button class="btn danger" id="mgEmpty">Papierkorb leeren</button><button class="btn" id="mgClose" style="margin-left:auto">Schließen</button></div>`);
  const box = body.querySelector('.mg-list');
  for (const t of list){
    const el = document.createElement('div'); el.className = 'mg-item';
    el.innerHTML = `<div class="meta"><b></b><span class="muted small"></span></div><button class="btn small" data-a="back">Wiederherstellen</button><button class="btn small danger" data-a="kill">Endgültig löschen</button>`;
    el.querySelector('b').textContent = t.name || 'Projekt';
    el.querySelector('span').textContent = `gelöscht am ${new Date(t.gone).toLocaleDateString('de-DE')} · noch ${t.left} ${t.left === 1 ? 'Tag' : 'Tage'} · ${verLine(t)}`;
    el.querySelector('[data-a=back]').onclick = () => {
      try { TS.trashRestore(t.id); } catch(e){ return toast('Das ging nicht: ' + ((e && e.message) || e)); }
      toast(`„${t.name}“ ist wieder da`); showHome(); openTrash(); };
    el.querySelector('[data-a=kill]').onclick = () => {
      if (!confirm(`„${t.name}“ endgültig löschen? Das lässt sich nicht rückgängig machen.`)) return;
      try { TS.trashPurge(t.id); } catch(e){ return toast('Das ging nicht: ' + ((e && e.message) || e)); }
      showHome(); openTrash(); };
    box.append(el);
  }
  body.querySelector('#mgEmpty').onclick = () => {
    if (!confirm(`Alle ${list.length} Projekte im Papierkorb endgültig löschen? Das lässt sich nicht rückgängig machen.`)) return;
    try { TS.trashPurge(''); } catch(e){ return toast('Das ging nicht: ' + ((e && e.message) || e)); }
    closeMg(); showHome(); toast('Papierkorb geleert'); };
}
// ── Speicher verwalten (Desktop): was belegt wie viel, und was lässt sich gefahrlos freigeben ──
// Als „verwendet“ zählt alles, was in einem Projekt, einer früheren Fassung oder im Papierkorb steht – das rechnet das Backend
// bei jedem Löschen neu. Exportierte CapCut- und Concat-Projekte kennt HoneyCut nicht; deshalb die Rückfrage.
const ST_WARN = 'Kein Projekt verwendet sie mehr. Ein früher exportiertes CapCut- oder Concat-Projekt kann aber noch darauf zugreifen; dort würde die Datei dann fehlen.';
function openStorage(){
  const body = openMg(`<h3>Speicher</h3><p class="muted small" id="stSum">Wird zusammengezählt …</p><div class="mg-list" id="stList"></div>
    <div class="row"><button class="btn" id="stFolder">Datenordner öffnen</button><button class="btn" id="mgClose" style="margin-left:auto">Schließen</button></div>`);
  body.querySelector('#stFolder').onclick = () => { try { TS.storageOpen(); } catch(e){ toast('Der Ordner ließ sich nicht öffnen'); } };
  const load = () => TS.storage().then(info => { if (body.querySelector('#stList')) renderStorage(body, info, load); })
    .catch(e => { const el = body.querySelector('#stSum'); if (el) el.textContent = 'Die Übersicht ließ sich nicht erstellen: ' + ((e && e.message) || e); });
  load();
}
function renderStorage(body, info, reload){
  body.querySelector('#stSum').textContent = `HoneyCut belegt ${fmtBytes(info.total)} für Projekte, Vorschau, Sicherungen und Modelle; auf dem Laufwerk sind noch ${fmtBytes(info.free)} frei. Deine Videos und Exporte zählen hier nicht mit.` + (info.problem ? ' ' + info.problem : '');
  const box = body.querySelector('#stList'); box.innerHTML = '';
  const clear = (what, name, ask) => {
    if (ask && !confirm(ask)) return; let r;
    try { r = J(TS.storageClear(what, name)); } catch(e){ return toast('Das ging nicht: ' + ((e && e.message) || e)); }
    toast(r.count ? `${fmtBytes(r.freed)} freigegeben` : 'Hier gab es nichts zu löschen'); if (what === 'model') fillModels(); reload(); };
  const btn = (el, label, fn, danger) => { const b = document.createElement('button'); b.className = 'btn small' + (danger ? ' danger' : ''); b.textContent = label; b.onclick = fn; el.append(b); return b; };
  const sub = (el, title, note, label, fn) => { let s = el.querySelector('.st-sub'); if (!s){ s = document.createElement('div'); s.className = 'st-sub'; el.append(s); }
    const r = document.createElement('div'); r.className = 'st-row'; r.innerHTML = '<div class="meta"><span></span><span class="muted small"></span></div>';
    r.querySelector('span').textContent = title; r.querySelector('.muted').textContent = note; if (fn) btn(r, label, fn, true); s.append(r); };
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  for (const g of info.groups){
    const el = document.createElement('div'); el.className = 'mg-item st'; el.dataset.key = g.key;
    el.innerHTML = '<div class="meta"><b></b><span class="muted small"></span></div>';
    el.querySelector('b').textContent = `${g.label} · ${g.bytes ? fmtBytes(g.bytes) : 'leer'}`;
    let hint = g.hint || '';
    if (g.key === 'thumbs'){ if (g.bytes) btn(el, 'Leeren', () => clear('thumbs', '')); }
    else if (g.key === 'proxies'){
      if (g.nfree) btn(el, `Unbenutzte löschen · ${fmtBytes(g.freeable)}`, () => clear('proxies', ''));
      else if (g.count) hint += ' Alle werden von Projekten verwendet.'; }
    else if (g.key === 'matte'){
      if (g.nfree) btn(el, `Unbenutzte löschen · ${fmtBytes(g.freeable)}`, () => clear('matte', '', `${n(g.nfree, 'freigestellte Kopie', 'freigestellte Kopien')} löschen (${fmtBytes(g.freeable)})?\n\n${ST_WARN}`));
      for (const i of g.items || []){ const free = !i.used.length, unknown = i.used[0] === '?';
        sub(el, `Kopie vom ${new Date(i.at).toLocaleDateString('de-DE')} · ${fmtBytes(i.bytes)}`,
          unknown ? 'Verwendung unklar' : free ? 'von keinem Projekt verwendet' : 'verwendet von ' + i.used.join(', '),
          'Löschen', free ? () => clear('matte', i.name, `Diese freigestellte Kopie löschen (${fmtBytes(i.bytes)})?\n\n${ST_WARN}`) : null); } }
    else if (g.key === 'slides'){
      if (g.nfree) btn(el, `Frühere Bilder löschen · ${fmtBytes(g.freeable)}`, () => clear('slides', '', `${n(g.nfree, 'früheres Folienbild', 'frühere Folienbilder')} löschen (${fmtBytes(g.freeable)})?\n\n${ST_WARN}`));
      else if (g.count) hint += ' Alle vorhandenen Bilder werden von Projekten verwendet.'; }
    else if (g.key === 'models'){
      for (const m of g.items || []) sub(el, m.label, fmtBytes(m.bytes), 'Löschen', () => clear('model', m.name, `Das Modell „${m.label}“ löschen (${fmtBytes(m.bytes)})?\n\nDu kannst es in den Einstellungen jederzeit wieder laden.`));
      if (!g.count) hint = 'Keine nachgeladen. Eingebaute Modelle gehören zum Programm.'; }
    else if (g.key === 'backups'){ if (g.trash) btn(el, `Papierkorb (${g.trash})`, openTrash); }
    el.querySelector('.muted').textContent = hint;
    box.append(el);
  }
}

// ── Einstellungen (Desktop): Verwaltung unter den Whisper-Modellen ──
function renderSettingsMore(){
  const box = $('#setMore'); if (!box) return; box.innerHTML = '';
  const sec = title => { const h = document.createElement('h4'); h.textContent = title; const l = document.createElement('div'); l.className = 'mg-list'; box.append(h, l); return l; };
  const row = (list, title, note, label, fn) => { const el = document.createElement('div'); el.className = 'mg-item';
    el.innerHTML = '<div class="meta"><b></b><span class="muted small"></span></div>'; el.querySelector('b').textContent = title; el.querySelector('span').textContent = note;
    if (label){ const b = document.createElement('button'); b.className = 'btn small'; b.textContent = label; b.onclick = fn; el.append(b); } list.append(el); return el; };
  if (TS.storage || TS.trash || TS.backupAll){
    const l = sec('Projekte und Speicher');
    if (TS.storage) row(l, 'Speicher', 'Was HoneyCut auf der Festplatte belegt und was sich freigeben lässt.', 'Öffnen', openStorage).dataset.k = 'storage';
    if (TS.trash) row(l, 'Papierkorb', 'Gelöschte Projekte bleiben 30 Tage erhalten.', 'Öffnen', openTrash).dataset.k = 'trash';
    if (TS.backupAll) row(l, 'Alle Projekte sichern', 'Eine Datei mit allen Projekten, ihren Folienbildern und Schriften, ohne die Videos. Für die externe Festplatte oder die Cloud.', 'Sichern …', backupAll).dataset.k = 'backup';
    if (TS.backupRestore) row(l, 'Sicherung einspielen', 'Projekte aus einer solchen Datei zurückholen. Was hier schon liegt, bleibt erhalten.', 'Einspielen …', backupRestore).dataset.k = 'restore';
  }
  let u = null; try { u = TS.updateInfo ? J(TS.updateInfo()) : null; } catch(_){}
  if (TS.saveReport || (u && u.supported)){
    const l = sec('Hilfe');
    if (TS.saveReport) row(l, 'Fehlerbericht', 'Protokoll und Systemangaben als eine Datei, zum Beispiel für die Fehlersuche mit Claude. Enthält Datei- und Projektnamen, aber keine Videos oder Texte.', 'Speichern …', saveReport).dataset.k = 'report';
    if (u && u.supported){
      const el = row(l, 'Neue Versionen', '', 'Jetzt prüfen', async e => {
        const b = e.currentTarget; b.disabled = true; b.textContent = 'Prüfe …';
        try { const r = await TS.updateCheck(); renderSettingsMore(); renderUpdateBanner(); if (r.latest) openUpdate(r); else toast('HoneyCut ist aktuell'); }
        catch(err){ b.disabled = false; b.textContent = 'Jetzt prüfen'; toast('GitHub war nicht erreichbar'); } });
      el.dataset.k = 'update';
      const lab = document.createElement('label'); lab.className = 'row small'; lab.innerHTML = '<input type="checkbox" id="updOn"> Einmal am Tag bei GitHub nachsehen';
      lab.querySelector('input').checked = u.enabled; lab.querySelector('input').onchange = e => { try { TS.updateSet({enabled: e.target.checked}); } catch(_){} };
      el.querySelector('.meta').append(lab);
      el.querySelector('span').textContent = (u.latest ? `HoneyCut ${u.latest.version} steht bereit.` : u.checked ? `Zuletzt geprüft: ${fmtWhen(u.checked)}. HoneyCut ${u.current} ist aktuell.` : 'Noch nicht geprüft.')
        + ' Abgerufen wird nur die Liste der Veröffentlichungen; von dir wird nichts gesendet.';
      if (u.latest){ const b = document.createElement('button'); b.className = 'btn small primary'; b.textContent = 'Ansehen'; b.onclick = () => openUpdate(u); el.append(b); }
    }
  }
}
// ── Hinweis auf eine neue Version (Windows-App) ──
function renderUpdateBanner(){
  const el = $('#updBanner'); if (!el) return;
  let u = null; try { u = TS.updateInfo ? J(TS.updateInfo()) : null; } catch(_){}
  const L = u && u.supported && u.enabled && u.latest;
  if (!L || u.skip === L.version){ el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  el.innerHTML = '<div class="meta"><b></b><span class="muted small"></span></div><button class="btn small primary" data-a="show">Was ist neu?</button><button class="btn small ghost" data-a="skip" title="Diese Version hier nicht mehr melden">Überspringen</button>';
  el.querySelector('b').textContent = `HoneyCut ${L.version} ist da`;
  el.querySelector('span').textContent = `Du verwendest ${u.current}.`;
  el.querySelector('[data-a=show]').onclick = () => openUpdate(u);
  el.querySelector('[data-a=skip]').onclick = () => { try { TS.updateSet({skip: L.version}); } catch(_){} el.classList.add('hidden'); toast(`${L.version} wird hier nicht mehr gemeldet. In den Einstellungen bleibt sie zu finden.`); };
}
function openUpdate(u){
  const L = u.latest; if (!L) return;
  const body = openMg(`<h3></h3><p class="muted small"></p><div id="updNotes"></div>
    <div class="row wrap"><button class="btn primary" id="updGet">Installer herunterladen</button><button class="btn" id="updPage">Bei GitHub ansehen</button><button class="btn" id="mgClose" style="margin-left:auto">Schließen</button></div>`);
  body.querySelector('h3').textContent = `HoneyCut ${L.version}`;
  body.querySelector('p').textContent = `Du verwendest ${u.current}. Der Installer${L.size ? ` (${fmtBytes(L.size)})` : ''} wird über deinen Browser heruntergeladen. Zum Installieren HoneyCut schließen und die Datei starten; deine Projekte bleiben erhalten.`;
  const box = body.querySelector('#updNotes');
  for (const n of L.notes || []){
    const h = document.createElement('h4'); h.textContent = n.version + (n.title ? ' · ' + n.title : ''); const ul = document.createElement('ul'); ul.className = 'upd-notes';
    for (const p of n.points || []){ const li = document.createElement('li'); li.textContent = p; ul.append(li); } box.append(h, ul); }
  if (!(L.notes || []).length){ const p = document.createElement('p'); p.className = 'small'; p.textContent = 'Die Änderungen stehen auf der Seite bei GitHub.'; box.append(p); }
  const open = what => { try { TS.updateOpen(what); toast(what === 'installer' ? 'Der Download startet in deinem Browser' : 'Die Seite öffnet sich in deinem Browser'); } catch(e){ toast('Das ging nicht: ' + ((e && e.message) || e)); } };
  body.querySelector('#updGet').onclick = () => open('installer'); body.querySelector('#updPage').onclick = () => open('page');
}
setTimeout(() => { if (!$('#home').classList.contains('hidden')) renderUpdateBanner(); }, 50000);   // die Prüfung läuft eine halbe Minute nach dem Start

// ── Alle Projekte sichern, Sicherung einspielen (Desktop) ──
// Gesichert werden die Projekte samt Folienbildern und Schriften, dazu die eigenen Designprofile, Farbfavoriten, Füllwörter und
// Untertitel-Looks, dazu das eigene Wörterbuch – ohne die Videos.
const PREF_KEYS = ['hc-slide-profiles', 'hc-colfav', 'hc-fillers', 'hc-sub-looks', 'hc-dict', 'hc-house', 'hc-blocks', 'hc-emoji', 'hc-clipwords'];
function uiPrefs(){ const o = {}; for (const k of PREF_KEYS){ try { const v = JSON.parse(localStorage.getItem(k)); if (Array.isArray(v) && v.length) o[k] = v; } catch(_){} } return o; }
function mergePrefs(pr){
  let n = 0; if (!pr || typeof pr !== 'object') return 0;
  try { if (window.slUserProfiles){ const have = slUserProfiles(), add = (pr['hc-slide-profiles'] || []).filter(p => p && p.id && p.colors && !have.some(h => h.id === p.id)); if (add.length){ slSaveUserProfiles(have.concat(add)); n += add.length; } } } catch(_){}
  try { const add = (pr['hc-colfav'] || []).filter(c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)).map(c => c.toUpperCase()).filter(c => !favCols.includes(c));
    if (add.length){ favCols = favCols.concat(add).slice(0, 16); saveFavs(); n += add.length; } } catch(_){}
  try { const add = (pr['hc-fillers'] || []).filter(x => typeof x === 'string' && fillKey(x) && !ownFill.some(y => fillKey(y) === fillKey(x)));
    if (add.length){ ownFill = ownFill.concat(add).slice(0, 200); saveOwnFill(); n += add.length; } } catch(_){}
  try { n += mergeLooks(pr['hc-sub-looks']); } catch(_){}
  try { n += mergeDict(pr['hc-dict']); } catch(_){}
  try { n += mergeHouse(pr['hc-house']); } catch(_){}
  try { n += mergeBlocks(pr['hc-blocks']); } catch(_){}
  try { n += mergeEmoji(pr['hc-emoji']); } catch(_){}
  try { n += mergeClipWords(pr['hc-clipwords']); } catch(_){}
  return n;
}
const plural = (k, one, many) => `${k} ${k === 1 ? one : many}`;
function jobModal(title, first){
  const m = hcModal(`<h3></h3><div class="progress" id="pkgProg"><i></i></div><div class="small muted" id="pkgMsg"></div><div class="row" style="margin-top:12px"><button class="btn" id="pkgCancel" style="margin-left:auto">Abbrechen</button></div>`);
  m.querySelector('h3').textContent = title; m.querySelector('#pkgMsg').textContent = first; return m;
}
async function backupAll(){
  if (P) saveNow();
  const r = await platformCall(id => TS.backupAll(id, uiPrefs())); if (!r) return;
  if (!r.job) return toast(r.error ? 'Das ging nicht: ' + r.error : 'Die Sicherung ließ sich nicht starten');
  const m = jobModal('Alle Projekte sichern', 'Projekte werden gepackt …'); let job = r.job;
  m.querySelector('#pkgCancel').onclick = () => { if (job) TS.cancel(job); closeHcModal(); };
  watchJob(job, j => { m.querySelector('#pkgProg i').style.width = (j.progress * 100).toFixed(1) + '%'; if (j.message) m.querySelector('#pkgMsg').textContent = j.message; },
    j => { const res = j.result || {}; job = null; m.querySelector('#pkgProg i').style.width = '100%';
      m.querySelector('#pkgMsg').textContent = `${plural(res.projects || 0, 'Projekt', 'Projekte')} gesichert (${fmtBytes(res.bytes || 0)}): ${res.path || ''}`
        + ((res.skipped || []).length ? ` · ${plural(res.skipped.length, 'Projekt ließ', 'Projekte ließen')} sich nicht lesen und ${res.skipped.length === 1 ? 'fehlt' : 'fehlen'} in der Sicherung.` : '') + ' Die Videos sind nicht enthalten.';
      m.querySelector('#pkgCancel').textContent = 'Schließen';
      if (res.path){ const b = document.createElement('button'); b.className = 'btn'; b.textContent = 'Im Ordner zeigen'; b.onclick = () => TS.share(res.path); m.querySelector('.row').prepend(b); } },
    j => { job = null; m.querySelector('#pkgMsg').textContent = j.status === 'cancelled' ? 'Abgebrochen' : 'Fehler: ' + (j.error || ''); m.querySelector('#pkgCancel').textContent = 'Schließen'; });
}
async function backupRestore(){
  if (P) saveNow();
  const r = await platformCall(id => TS.backupRestore(id)); if (!r) return;
  if (!r.job) return toast(r.error ? 'Das ging nicht: ' + r.error : 'Die Sicherung ließ sich nicht öffnen');
  const m = jobModal('Sicherung einspielen', 'Sicherung wird gelesen …'); let job = r.job;
  m.querySelector('#pkgCancel').onclick = () => { if (job) TS.cancel(job); closeHcModal(); };
  watchJob(job, j => { m.querySelector('#pkgProg i').style.width = (j.progress * 100).toFixed(1) + '%'; if (j.message) m.querySelector('#pkgMsg').textContent = j.message; },
    j => { const res = j.result || {}; job = null; m.querySelector('#pkgProg i').style.width = '100%';
      const nPref = mergePrefs(res.prefs), parts = [], len = k => (res[k] || []).length;
      if (len('added')) parts.push(`${plural(len('added'), 'Projekt ist', 'Projekte sind')} dazugekommen`);
      if (len('updated')) parts.push(`${plural(len('updated'), 'Projekt hat', 'Projekte haben')} den gesicherten, neueren Stand bekommen`);
      if (len('kept')) parts.push(`${plural(len('kept'), 'Projekt ist', 'Projekte sind')} hier neuer und ${len('kept') === 1 ? 'bleibt' : 'bleiben'} so`);
      if (res.same) parts.push(`${plural(res.same, 'Projekt war', 'Projekte waren')} schon auf diesem Stand`);
      if (len('failed')) parts.push(`${plural(len('failed'), 'Projekt ließ', 'Projekte ließen')} sich nicht lesen`);
      const extra = [res.fonts ? plural(res.fonts, 'Schrift', 'Schriften') : '', res.slides ? plural(res.slides, 'Bild', 'Bilder') : '', nPref ? plural(nPref, 'eigene Einstellung', 'eigene Einstellungen') + ' (Designprofile, Farbfavoriten, Füllwörter, Looks)' : ''].filter(Boolean);
      m.querySelector('#pkgMsg').textContent = (res.created ? `Sicherung vom ${new Date(res.created).toLocaleDateString('de-DE')}: ` : '') + (parts.length ? parts.join(', ') + '.' : 'Die Sicherung enthält keine Projekte.')
        + (extra.length ? ` Dazu ${extra.join(', ')}.` : '') + (len('updated') || len('kept') ? ' Der jeweils andere Stand liegt bei den früheren Fassungen des Projekts.' : '');
      m.querySelector('#pkgCancel').textContent = 'Schließen';
      for (const id of res.updatedIds || []) busNotify(id, {t:'reload'});
      loadUserFonts().catch(() => {});
      if (P && (res.updatedIds || []).includes(P.id)) openProject(P.id, true); else if (!P) showHome(); },
    j => { job = null; m.querySelector('#pkgMsg').textContent = j.status === 'cancelled' ? 'Abgebrochen' : 'Fehler: ' + (j.error || ''); m.querySelector('#pkgCancel').textContent = 'Schließen'; });
}
// ── Fehlerbericht ──
async function saveReport(){
  const ui = {'Fenster': `${innerWidth}×${innerHeight}, Bildpunkte je Punkt ${devicePixelRatio}`, 'Bildschirm': `${screen.width}×${screen.height}`, 'Browser-Kennung': navigator.userAgent,
    'Sprache': navigator.language, 'Offenes Projekt': P ? `${P.sources.length} Videos, ${tokens.length} Wörter, ${(P.items || []).length} Elemente, Reiter ${tab}` : 'keines'};
  const r = await platformCall(id => TS.saveReport(id, ui)); if (!r) return toast('Der Bericht ließ sich nicht speichern');
  if (r.error) return toast('Das ging nicht: ' + r.error);
  if (r.ok) toast('Fehlerbericht gespeichert: ' + r.path);
}

// ───────── Projekt umbenennen ─────────
// In der Projektliste (Stift) und im offenen Projekt (Name in der Kopfzeile anklicken). Der Name steht nur im Projekt selbst;
// Videos, Exporte und Sicherungen bleiben, wie sie sind.
const cleanName = s => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 120);
function renameProject(id, name){
  name = cleanName(name); if (!name) return false;
  if (P && P.id === id){
    const old = P.name; if (name === old) return true;
    P.name = name; projNameEl.textContent = name;
    if ($('#exName').value === old + '_geschnitten') $('#exName').value = name + '_geschnitten';   // nur der unveränderte Vorschlag
    if (!saveNow()){ return false; }
    busSend({t:'name', name}); rememberOpen(); return true;
  }
  let p = null; try { p = J(TS.loadProject(id)); } catch(_){}
  if (!p || typeof p !== 'object'){ toast('Projekt konnte nicht geladen werden'); return false; }
  if (p.name === name) return true;
  p.name = name;
  try { TS.saveProject(id, JSON.stringify(p)); } catch(e){ toast('Umbenennen fehlgeschlagen: ' + ((e && e.message) || e)); return false; }
  return true;
}
// Namen an Ort und Stelle bearbeiten: Eingabetaste oder Verlassen des Felds übernimmt, Esc bricht ab
function editNameInline(el, current, onDone){
  const inp = document.createElement('input'); inp.type = 'text'; inp.className = 'name-edit'; inp.value = current || ''; inp.maxLength = 120;
  inp.setAttribute('aria-label', 'Projektname'); inp.enterKeyHint = 'done';
  let done = false;
  const finish = ok => { if (done) return; done = true; const v = cleanName(inp.value); inp.replaceWith(el); if (ok && v && v !== current) onDone(v); };
  inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter'){ e.preventDefault(); finish(true); } else if (e.key === 'Escape'){ e.preventDefault(); finish(false); } };
  inp.onkeyup = inp.onkeypress = e => e.stopPropagation();
  inp.onblur = () => finish(true); inp.onclick = inp.onpointerdown = e => e.stopPropagation();
  el.replaceWith(inp); inp.focus(); inp.select();
}
const projNameEl = $('#projName');   // fest gemerkt: Während des Umbenennens steht an seiner Stelle kurz das Eingabefeld
projNameEl.title = 'Anklicken zum Umbenennen';
projNameEl.onclick = () => { if (P) editNameInline(projNameEl, P.name, v => { if (renameProject(P.id, v)) toast('Umbenannt'); }); };
function closeProject(){
  pausePlay(); lowEnd(); audStop(); saveThumb(); partSyncFlush();
  if (!saveNow() && !confirm('Der letzte Stand ließ sich nicht speichern (' + ($('#saved').title || 'Grund unbekannt') + ').\n\nOK: trotzdem schließen – die letzten Änderungen gehen verloren.\nAbbrechen: im Projekt bleiben.')) return;
  clearTimeout(saveRetryT); saveFails = 0; busBye();
  try { localStorage.removeItem(OPEN_KEY); } catch(_){} setFull(false); allLayers(releaseMedia); for (const el of audLayers.values()) releaseMedia(el); audLayers.clear(); busPid = null; P = null; V.removeAttribute('src'); V.load(); vSi = -1; hideOverlay(); showHome(); }
$('#backBtn').onclick = closeProject;
const fillsWrap = () => isWide() || matchMedia('(orientation: landscape) and (max-height: 599px)').matches;
// Bühne: ein 16:9-Feld. Hochformat-Videos lassen links und rechts Platz – dort sitzt zusätzliche Steuerung.
function fitStage(){
  if (!P) return;
  const [w, h] = CanvasEdit ? dispSize(primary()) : baseDims(), wrap = $('.stage-wrap'), st = $('#stage');
  const full = $('#proj').classList.contains('full');
  const fill = fillsWrap(), availW = full ? innerWidth : wrap.clientWidth || innerWidth;
  let boxH;
  if (full){ wrap.style.height = ''; boxH = innerHeight;
    let W = availW, H = W * h / w; if (H > boxH){ H = boxH; W = H * w / h; }
    st.style.width = Math.floor(W) + 'px'; st.style.height = Math.floor(H) + 'px';
    for (const el of [$('#sideL'), $('#sideR')]) el.classList.add('hidden');
    styleOverlay(); refreshStageOverlays(); placeSafe(); return; }
  if (fill){ wrap.style.height = ''; boxH = wrap.clientHeight || innerHeight * 0.6; }
  else { boxH = Math.round(h > w ? Math.max(150, innerHeight * 0.38) : Math.min(availW * 9 / 16, Math.max(150, innerHeight * 0.36))); wrap.style.height = boxH + 'px'; }   // Hochformat: mehr Höhe, die Seiten nutzen die Steuerung
  const boxW = fill ? availW : Math.min(availW, boxH * 16 / 9);
  let W = boxW, H = W * h / w; if (H > boxH){ H = boxH; W = H * w / h; }
  if (CanvasEdit){ W *= 0.8; H *= 0.8; }   // Rand lassen, damit der Leinwand-Rahmen auch über das Bild hinausragen kann
  st.style.width = Math.floor(W) + 'px'; st.style.height = Math.floor(H) + 'px';
  const side = Math.floor((availW - W) / 2), show = side >= 64;
  for (const el of [$('#sideL'), $('#sideR')]){ el.classList.toggle('hidden', !show); el.style.width = show ? Math.min(side, 170) + 'px' : ''; el.style.height = Math.floor(fill ? H : boxH) + 'px'; }
  styleOverlay(); refreshStageOverlays(); placeSafe();
}
// Einblendungen und Titel nach einer Größenänderung der Bühne neu setzen
function refreshStageOverlays(){ if (!P || typeof outPos === 'undefined') return; try { updateOverlay(outPos); updateTitles(outPos); } catch(_){} }
addEventListener('resize', () => { fitStage(); if (P && tlOn() && window.renderTimeline) renderTimeline(); });
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
// Kein Dateipfad, sondern Inhalt, der direkt im Projekt steht (z. B. ein Folienbild als „data:…“) oder eine Adresse: bleibt im
// Projekt, wie er ist. Früher wurde er wie eine Datei behandelt – unter Windows brach das Weitergeben daran ab
// („stat: path too long for Windows“).
const inlineUri = u => /^(data:|blob:|https?:)/i.test(u) || u.length > 2000;
function packageSpec(proj, withMedia, withLooks){
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
    else if (o && typeof o === 'object'){ if (typeof o.uri === 'string' && o.uri && !o.uri.startsWith('@hc') && !inlineUri(o.uri)) o.uri = '@hc:' + fileFor(o, 'media');
      delete o.proxy; for (const k in o) if (o[k] && typeof o[k] === 'object') walk(o[k]); } };
  walk(p.sources); walk(p.items); walk(p.media || []); walk(p.slides || []);
  if (p.watermark) walk(p.watermark);   // das Wasserzeichen fehlte bisher im Paket
  for (const sl of p.slides || []) if (typeof sl.img === 'string' && sl.img && !sl.img.startsWith('@hc') && !inlineUri(sl.img)) sl.img = '@hc:' + fileFor({uri: sl.img, name: sl.img.split(/[\\/]/).pop() || 'bild.png', kind: 'image'}, 'media');
  // eigene Schriften (Untertitel, Titel)
  const fontKey = key => { const f = key && userFonts.find(x => x.key === key); return f ? '@hcf:' + fileFor({uri: f.uri, name: (f.uri.split(/[\\/]/).pop() || f.label + '.ttf')}, 'font') : key; };
  if (p.sub_style && p.sub_style.font) p.sub_style.font = fontKey(p.sub_style.font);
  for (const it of p.items || []) if (it.font) it.font = fontKey(it.font);
  for (const sp of p.speakers || []) if (sp.st && sp.st.font) sp.st.font = fontKey(sp.st.font);
  if (p.textline && p.textline.font) p.textline.font = fontKey(p.textline.font);
  // eigene Untertitel-Looks mitgeben (samt ihrer Schriften), damit das andere Gerät sie übernehmen kann
  const looks = withLooks ? subLooks.map(l => { const st = {...l.st}; if (st.font) st.font = fontKey(st.font); return {id: l.id, name: l.name, st}; }) : [];
  const header = {format: 'honeycut-projekt', v: 1, app: CAP.version || '', platform: CAP.platform || '', created: Date.now(), name: p.name, project: p, files: hfiles, ...(looks.length ? {looks} : {})};
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
    ${subLooks.length ? `<label class="row"><input type="checkbox" id="pkgLooks" checked> Meine Untertitel-Looks mitgeben (${subLooks.length})</label>` : ''}
    <div class="progress hidden" id="pkgProg"><i></i></div><div class="small muted" id="pkgMsg"></div>
    <div class="row" style="margin-top:12px"><button class="btn" id="pkgCancel">Abbrechen</button><button class="btn primary" id="pkgGo" style="margin-left:auto">Exportieren</button></div>`);
  let job = null;
  m.querySelector('#pkgCancel').onclick = () => { if (job) TS.cancel(job); closeHcModal(); };
  m.querySelector('#pkgGo').onclick = async () => {
    const spec = packageSpec(proj, m.querySelector('#pkgMedia').checked, !!(m.querySelector('#pkgLooks') && m.querySelector('#pkgLooks').checked));
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
  if (old){ const add = x => { if (x && x.uri && !x.uri.startsWith('@hc')) local.push(x); }; (old.sources || []).forEach(add); (old.items || []).forEach(x => add(x.clip)); (old.media || []).forEach(add); if (old.watermark) add(old.watermark.clip); }
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
  if (proj.textline && proj.textline.font) proj.textline.font = fk(proj.textline.font);
  let nLooks = 0; try { nLooks = mergeLooks((header.looks || []).map(l => ({...l, st: {...(l && l.st), font: fk(l && l.st && l.st.font)}}))); } catch(_){}
  // fehlende Dateien: auf diesem Gerät auswählen lassen
  if (missing.length) await relinkDialog(proj, missing.map(n => ({n, ...info(n)})));
  if (old){
    const keep = confirm(`„${proj.name}“ gibt es auf diesem Gerät schon (zuletzt bearbeitet ${new Date(old.updated || 0).toLocaleString('de-DE')}).\n\nOK: durch die empfangene Fassung ersetzen\nAbbrechen: als Kopie daneben anlegen`);
    if (!keep){ proj.id = newId(); proj.name += ' (Kopie)'; }
  }
  if (P && P.id === proj.id) closeProject();
  TS.saveProject(proj.id, JSON.stringify(proj));
  closeHcModal(); showHome(); openProject(proj.id);
  toast(`„${proj.name}“ importiert` + (hf.some(f => f.included) ? '' : ' – ohne mitgeschickte Dateien') + (nLooks ? ` · ${nLooks} ${nLooks === 1 ? 'Untertitel-Look' : 'Untertitel-Looks'} übernommen` : ''));
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
  const old = tokens, oldDel = deleted, oldEdits = P.edits || {}, oldKw = new Set(P.kw || []), kw = [];
  rebuildTokens();
  deleted = new Set(); P.edits = {}; P.trims = {}; P.checks = [];   // die Prüfliste hängt an den Wortnummern
  P.sources.forEach((src, k) => {
    const a = old.filter(t => t.src === k && t.type === 'word'), b = tokens.filter(t => t.src === k && t.type === 'word');
    a.forEach((t, j) => { if (!b[j]) return; if (oldDel.has(t.i)) deleted.add(b[j].i); if (oldEdits[t.i] != null) P.edits[b[j].i] = oldEdits[t.i]; if (t.spk) b[j].spk = t.spk; if (t.ks) b[j].ks = true; if (t.ok) b[j].ok = 1;
      if (oldKw.has(t.i)) kw.push(b[j].i); });   // betonte Wörter ziehen mit: Die Nummern der Wörter verschieben sich, wenn Pausen hinzukommen oder wegfallen
  });
  if (oldKw.size) P.kw = kw.sort((x, y) => x - y);
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
// Solange kein zweites Fenster dasselbe Projekt offen hat, wird nichts gemeldet und nur selten nachgefragt. Vorher ging
// nach jeder Änderung der komplette Bearbeitungsstand ans Backend und beim Abspielen fünfmal je Sekunde die Position –
// auch wenn niemand zuhörte.
const WIN = newId();
let busPid = null, busSeq = -1, busT = null, applyingRemote = false, posSent = {o:-1, at:0};
let busPeers = 0, busJoins = -1;   // andere Fenster mit demselben Projekt (Desktop; im Browser meldet der Kanal selbst nur an offene Fenster)
const busOn = () => !!(CAP.bus && P && (TS.busPost || busPeers > 0));
function busSend(msg){
  if (!busOn()) return;
  if (TS.busPost) return TS.busPost(P.id, WIN, JSON.stringify(msg));
  fetch('api/bus?p=' + encodeURIComponent(P.id) + '&from=' + WIN + '&k=' + msg.t, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(msg)}).catch(() => {});
}
// Abmelden, wenn das Projekt oder das Fenster geschlossen wird – die anderen Fenster hören dann sofort auf zu melden
function busBye(){
  if (!busPid || TS.busPost || !CAP.bus) return;
  try { navigator.sendBeacon('api/bus?p=' + encodeURIComponent(busPid) + '&from=' + WIN + '&bye=1', ''); } catch(_){}
}
addEventListener('pagehide', busBye);
let busGen = 0;
function busStart(){
  if (!CAP.bus || !P || busPid === P.id) return; busBye(); busPid = P.id; busSeq = -1; busPeers = 0; busJoins = -1;
  const pid = P.id, gen = ++busGen;
  if (TS.busListen){ TS.busListen(pid, WIN, m => { if (busPid === pid && gen === busGen) busApply(J(m)); }); return; }
  (async function poll(){
    while (busPid === pid && gen === busGen){
      try {
        const r = await fetch(`api/bus?p=${encodeURIComponent(pid)}&since=${busSeq}&from=${WIN}`); const j = await r.json();
        if (busPid !== pid || gen !== busGen) break;
        // Ist ein weiteres Fenster dazugekommen? Dann hat es den zuletzt gespeicherten Stand geladen – ihm den aktuellen geben.
        // Das neue Fenster selbst (j.new) schickt nichts: Sein Stand ist der ältere.
        const came = !j.new && j.joins != null && busJoins >= 0 && j.joins > busJoins;
        busSeq = j.seq; busPeers = j.peers == null ? 1 : j.peers; if (j.joins != null) busJoins = j.joins;
        // Selbst gerade dazugekommen: nicht die eigene Anfangsposition verkünden (früher sprang dadurch das erste Fenster
        // an den Anfang, sobald ein zweites aufging) – das neue Fenster übernimmt die Stelle der vorhandenen.
        if (j.new && busPeers > 0) posSent = {o: outPos, at: performance.now()};
        for (const m of j.msgs || []) if (busPid === pid) busApply(J(m));
        if (came && busPeers > 0 && P && P.id === pid){ busSend({t:'state', snap: snapshot()}); if (!playing) busSend({t:'pos', o: outPos, playing: false}); posSent = {o: outPos, at: performance.now()}; }
      } catch(_){}
      await new Promise(r => setTimeout(r, busPeers ? 350 : 1500));
    }
  })();
}
function busApply(m){
  if (!m || !P) return;
  if (m.t === 'state'){ applyingRemote = true; try { restore(m.snap); } finally { applyingRemote = false; } }
  else if (m.t === 'reload'){ openProject(P.id, true); }
  else if (m.t === 'name' && m.name){ const old = P.name; P.name = m.name; projNameEl.textContent = m.name; if ($('#exName').value === old + '_geschnitten') $('#exName').value = m.name + '_geschnitten'; }
  else if (m.t === 'pos'){
    if (m.playing && playing) pausePlay();
    if (!playing && Math.abs(m.o - outPos) > 0.03){ posSent = {o: m.o, at: performance.now()}; seekOut(m.o, false); if (tlOn() && window.syncScroll) syncScroll(m.o, true); }
  }
}
// Abspielposition an die anderen Fenster melden (höchstens alle 200 ms)
(function posLoop(){
  if (busOn() && Math.abs(outPos - posSent.o) > 0.02 && performance.now() - posSent.at > 200){ posSent = {o: outPos, at: performance.now()}; busSend({t:'pos', o: outPos, playing}); }
  setTimeout(posLoop, 100);
})();

// ───────── Speichern & Rückgängig ─────────
function tokMarks(){ const o = {}; for (const t of tokens) if (t.spk || t.ks || t.ok) o[t.i] = t.ok ? [t.spk || 0, t.ks ? 1 : 0, 1] : [t.spk || 0, t.ks ? 1 : 0]; return o; }
// Zum Stand gehören auch Format, Bildausschnitt und die Lautstärke der Hauptvideos (fm, fr, sv). Sie fehlten: „Rückgängig“
// nach einem Formatwechsel, nach dem Verschieben des Ausschnitts oder nach „Alle angleichen“ tat nichts bzw. nur die Hälfte.
function snapshot(){ return JSON.stringify({d:[...deleted], t:P.trims, c:P.cues, i:P.items, a:P.adj, x:P.dels, y:P.splits, s:P.sub_style, e:P.edits, m:P.moves, k:P.speakers, w:tokMarks(), f:P.slides, wm:P.watermark || null, tr:P.trans || null,
  fm:P.format || null, fr:P.frame || null, sv:P.sources.map(x => x.vol == null ? null : x.vol), mk:P.marks || [], tl:P.textline || null, rf:P.refs || [], ss:P.srcStyle || null, lw:P.lower || null, cl:P.clipList || [], pt:P.part || null, ps:P.partStyle || null, au:P.audio || null, ck:P.checks || [], kw:P.kw || []}); }
function restore(s){ const o = JSON.parse(s); deleted = new Set(o.d); P.trims = o.t; P.cues = o.c; P.items = o.i; P.adj = o.a; P.dels = o.x || []; P.splits = o.y || [];
  if (o.s) P.sub_style = o.s; P.edits = o.e || {}; P.moves = o.m || [];
  const fmCh = 'fm' in o && (P.format || null) !== (o.fm || null), frCh = 'fr' in o && JSON.stringify(P.frame || null) !== JSON.stringify(o.fr || null);
  if ('fm' in o) P.format = o.fm || null; if ('fr' in o) P.frame = o.fr || null;
  if (o.sv) o.sv.forEach((v, k) => { const x = P.sources[k]; if (!x) return; if (v == null) delete x.vol; else x.vol = v; });
  const mkCh = 'mk' in o && JSON.stringify(P.marks || []) !== JSON.stringify(o.mk || []);
  if ('mk' in o) P.marks = o.mk || [];
  if ('tl' in o){ if (o.tl) P.textline = o.tl; else delete P.textline; viewTextline(); }
  const rfCh = 'rf' in o && JSON.stringify(P.refs || []) !== JSON.stringify(o.rf || []);
  if ('rf' in o) P.refs = o.rf || [];
  if ('ss' in o){ if (o.ss) P.srcStyle = o.ss; else delete P.srcStyle; }
  if ('lw' in o){ if (o.lw) P.lower = o.lw; else delete P.lower; }
  const clCh = 'cl' in o && JSON.stringify(P.clipList || []) !== JSON.stringify(o.cl || []);
  if ('cl' in o) P.clipList = o.cl || [];
  const psCh = 'ps' in o && JSON.stringify(P.partStyle || null) !== JSON.stringify(o.ps || null);
  if ('pt' in o){ if (o.pt) P.part = o.pt; else delete P.part; } if ('ps' in o){ if (o.ps) P.partStyle = o.ps; else delete P.partStyle; }
  if ('au' in o){ if (o.au) P.audio = o.au; else delete P.audio; }
  if ('ck' in o) P.checks = o.ck || [];
  if ('kw' in o) P.kw = o.kw || [];
  if (o.f) P.slides = o.f; if (o.k) P.speakers = o.k;
  if ('wm' in o){ if (o.wm) P.watermark = o.wm; else delete P.watermark; } if ('tr' in o){ if (o.tr) P.trans = o.tr; else delete P.trans; trMemo.list = null; } if (o.w){ for (const t of tokens){ const m = o.w[t.i]; if (m){ if (m[0]) t.spk = m[0]; else delete t.spk; if (m[1]) t.ks = true; else delete t.ks; if (m[2]) t.ok = 1; else delete t.ok; } else { delete t.spk; delete t.ks; delete t.ok; } } }
  const reorder = JSON.stringify(P.moves) !== lastOrderKey; syncStyleInputs(); changed(true);
  if ((reorder || mkCh || rfCh) && tokens.length) renderTranscript(); else tokens.forEach(t => paint(t.i));
  if (rfCh) paintRefsBtn(); if (refsSheetOpen()) renderRefsSheet();
  if (lowerSheetOpen()) paintLowerSheet(); if (tab === 'subs') renderSpeakers();
  if (mkCh){ paintMarksBtn(); if (marksSheetOpen()) renderMarksSheet(); }
  if (clCh){ paintClipsBtn(); if (clipsSheetOpen()) renderClipsSheet(); }
  if (joinSheetOpen()) paintJoinSheet();
  partChanged(true); if (psCh) partSyncLater();
  chkChanged();
  if (fmCh || frCh) frameRestored(fmCh); }
// Format oder Bildausschnitt kamen mit einem früheren Stand zurück: Bühne, Export-Angaben, Clip-Reiter und Folien nachziehen
function frameRestored(fmCh){
  if (fmCh){ fitStage(); setTimeout(fitStage, 50); renderExportForm(); if (window.slSyncAll) slSyncAll();
    if (!P.format && window.setCanvasEdit) setCanvasEdit(false); }
  applyMainTransform(); placeBox(); if (window.placeCanvasBox) placeCanvasBox();
  if (tab === 'clip' && window.renderClip) renderClip();
  if (!playing) seekOut(outPos, false);
}
function commit(fn, rerender = true){ undo.push(snapshot()); if (undo.length > 200) undo.shift(); redo = []; fn(); changed(rerender); }
$('#undoBtn').onclick = () => { if (!undo.length || !P) return; redo.push(snapshot()); restore(undo.pop()); };
$('#redoBtn').onclick = () => { if (!redo.length || !P) return; undo.push(snapshot()); restore(redo.pop()); };
// Wiedergabe, Abspiellinie und Schnitt beieinander halten. Nach einer Änderung stimmt die Nummer des laufenden Abschnitts
// (curSeg) nicht mehr unbedingt – Abschnitte kommen hinzu oder fallen weg –, und dieselbe Ausgabezeit zeigt auf andere Bilder,
// sobald davor etwas geschnitten wurde. Früher blieb beides einfach stehen: Die laufende Wiedergabe sprang an falsche Stellen,
// spielte gerade Gelöschtes noch ab (während die Zeitanzeige stand) oder blieb ganz hängen; im Stand zeigte das Bild weiter
// die alte Stelle, während die Abspiellinie in der Zeitleiste schon über etwas anderem lag – „Teilen“ oder „Bis hier weg“
// griffen dann daneben.
// Jetzt gilt in beiden Fällen: Die Abspiellinie bleibt auf demselben Bild der Quelle. Was davor geschnitten wird, verschiebt nur
// die Zeitanzeige; ist die Stelle selbst weggefallen, geht es an der nächsten behaltenen Stelle weiter.
function liveAnchor(){
  if (!timeline.length) return null;
  if (playing){ const g = timeline[curSeg]; if (!g) return null;
    return g.kind === 'main' ? {main: true, src: vT()} : {main: false, id: g.item.id, local: segLocal(g)}; }
  // Im Stand aus der Ausgabezeit gerechnet (das Videoelement kann noch im Sprung sein); einen Hauch im Inneren des Abschnitts,
  // damit eine Stelle genau auf einem Schnitt beim richtigen der beiden Nachbarn bleibt
  const g = timeline[segAtOut(outPos)]; if (!g) return null;
  const d = segDur(g), local = g.in + clamp(outPos - g.o, Math.min(1e-4, d / 2), Math.max(d / 2, d - 1e-4)) * (g.speed || 1);
  return g.kind === 'main' ? {main: true, src: local} : {main: false, id: g.item.id, local};
}
function resyncPlay(a){
  if (!timeline.length){ curSeg = 0; outPos = 0; updateHead(0); return; }   // alles weggeschnitten
  let o = outPos;
  if (a){
    if (a.main) o = srcToOut(snapSrc(a.src));
    else { const g = timeline.find(x => x.kind === 'insert' && x.item.id === a.id); o = g ? g.o + clamp(a.local - g.in, 0, g.out - g.in) : Math.min(outPos, total); }
  }
  if (playing && a){
    if (o >= total - 0.02){ pausePlay(); seekOut(Math.max(0, total - 0.01), false); return; }   // dahinter kommt nichts mehr
    seekOut(o, true); return;
  }
  // Im Stand: Kleinste Verschiebungen (unter einem Bild) lassen die Abspiellinie, wo sie ist. Zeigt das Bild schon die richtige
  // Stelle, wird nicht neu gesprungen – nur die Anzeigen ziehen nach.
  o = clamp(o, 0, Math.max(0, total - 0.01)); if (Math.abs(o - outPos) < 0.012) o = clamp(outPos, 0, Math.max(0, total - 0.01));
  const k = segAtOut(o), g = timeline[k], want = g.in + (o - g.o) * (g.speed || 1);
  const hid = el => el.classList.contains('hidden');
  const shown = g.kind === 'main' ? vSi === g.si && hid(IV) && hid(II) && Math.abs(vT() - want) < 0.05
    : o === outPos && (isImg(g.item.clip) ? !hid(II) && II.dataset.src === MEDIA(g.uri) : !hid(IV) && IV.dataset.src === MEDIA(g.uri) && Math.abs(IV.currentTime - want) < 0.05);
  // Die neue Stelle wird den anderen Fenstern nicht eigens gemeldet: Sie bekommen die Änderung selbst und rücken dabei
  // genauso nach. (Eine Positionsmeldung, die vor der Änderung ankäme, würde dort noch auf den alten Schnitt angewendet.)
  if (!shown){ seekOut(o, false); posSent = {o: outPos, at: performance.now()}; if (tlOn() && window.syncScroll) syncScroll(outPos, true); return; }
  curSeg = k;
  if (o !== outPos){ outPos = o; posSent = {o, at: performance.now()}; updateOverlay(o); updateZoom(); updateSubs(o); updateTitles(o); updateHead(o); if (tlOn() && window.syncScroll) syncScroll(o, true); }
}
// Regler und Textfelder in den Dialogen (Anpassung, Titel, Lautstärke): Während des Ziehens bzw. Tippens folgen Bild und Ton
// sofort; die Zeitleiste wird erst nach einer kurzen Pause neu gezeichnet. Vorher wurde sie bei jedem Reglerschritt und
// jedem Tastendruck komplett neu aufgebaut – bei langen Projekten hing der Regler dadurch spürbar nach.
let tlHold = false, tlLateT = 0;
function changedLive(){
  tlHold = true; try { changed(false); } finally { tlHold = false; }
  clearTimeout(tlLateT); tlLateT = setTimeout(() => { if (P && tlOn() && window.renderStudio) renderStudio(); }, 220);
}
function changed(rerender = true){
  if (!tlHold) clearTimeout(tlLateT);
  if (P.format && P.frame) (P.frameBy ||= {})[P.format] = {sc: P.frame.sc, tx: P.frame.tx, ty: P.frame.ty};   // Bildausschnitt je Format merken (Export-Pakete)
  const anchor = liveAnchor();
  recompute(rerender && tlOn() && !!window.renderStudio);   // die Zeitleiste zeichnet renderStudio gleich danach – nicht doppelt
  resyncPlay(anchor);
  if (rerender){ if (tab === 'subs') renderSubs(); if (tlOn() && window.renderStudio) renderStudio(); }
  else if (tab === 'subs') updateSubsList();
  cueCache.at = -1; if (!playing){ updateSubs(outPos); viewSrcLine(); viewLower(); viewPart(); }   // Quellenzeile, Bauchbinde und Kennzeichnung der Reihe folgen dem Schnitt
  if (tab === 'export') renderExport(); else if (tab === 'clip') renderLenLights(); else if (tab === 'subs') a11yLater();
  textLater(); if (refsAll().length || lowerSheetOpen()) refsLater(); if (clipsSheetOpen()) clipsLater();
  clearTimeout(saveT); $('#saved').textContent = '…'; saveT = setTimeout(saveNow, 700);
  if (!applyingRemote && busOn()){ clearTimeout(busT); busT = setTimeout(() => { if (busOn()) busSend({t:'state', snap: snapshot()}); }, 120); }
}
// Speichern. Schlägt es fehl (Datenträger voll, Ordner gesperrt, Backend nicht erreichbar), stand früher nur ein „!“ in der
// Kopfzeile und es blieb dabei, bis zufällig die nächste Änderung kam. Jetzt: deutlicher Hinweis mit dem Grund, und es wird
// von selbst weiter versucht, bis es klappt. Rückgabe: ob gespeichert wurde.
let saveFails = 0, saveRetryT = 0;
function saveNow(){
  if (!P) return true; clearTimeout(saveT); clearTimeout(saveRetryT);
  P.tokens = tokens; P.deleted = [...deleted]; P.updated = Date.now();
  const el = $('#saved');
  try {
    TS.saveProject(P.id, JSON.stringify(P)); el.textContent = '✓'; el.classList.remove('err'); el.title = 'Gespeichert';
    if (saveFails){ saveFails = 0; toast('Wieder gespeichert'); }
    return true;
  } catch(e){
    const why = (e && e.message) || String(e), pid = P.id;
    saveFails++; el.textContent = '!'; el.classList.add('err'); el.title = 'Nicht gespeichert: ' + why;
    hcLog('Speichern fehlgeschlagen: ' + why);
    if (saveFails === 1 || saveFails % 8 === 0) toast('Nicht gespeichert: ' + why.slice(0, 120) + ' – es wird weiter versucht');
    saveRetryT = setTimeout(() => { if (P && P.id === pid) saveNow(); }, Math.min(20000, 1500 * saveFails));
    return false;
  }
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
      const ends = last && SENT_END.test(last.text);
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
    setVol(el, (a.x.vol ?? 1) * (ducks(a.x) ? duckAt(o) : 1));
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
  computeRanges(); computePieces(); computeOrder(); buildTimeline(); syncLinks(); computeOverlays(); computeAudios(); computeJoins(); drawScrub();
  refMemo = null; lowerMemo = null; lowerRects.clear(); clipTokMemo = null; audioDirty();   // Quellenzeilen, Bauchbinden und vorgemerkte Abschnitte folgen dem Schnitt
  if (!noTL && !tlHold && tlOn() && window.renderTimeline) renderTimeline();
  setText($('#tTot'), fmtT(total)); setText($('#sideTot'), fmtT(total));
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
  for (const m of P.marks || []){ if (m.k === 'note' && m.done) continue; const o = markOut(m); if (markGone(o)) continue; const d = document.createElement('div'); d.className = 'mk ' + m.k; d.style.left = pct(o); box.append(d); }
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
  if (!timeline.length) return; if (AUD.k >= 0) audStop(); if (outPos >= total - 0.05) seekOut(0, false);
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
$('#sidePrevCut').onclick = () => { if (playing) pausePlay(); const e = cutEdges().filter(x => x < outPos - 0.05); seekOut(e.length ? e[e.length-1] : 0, false); tlReveal(); };
$('#sideNextCut').onclick = () => { if (playing) pausePlay(); const e = cutEdges().find(x => x > outPos + 0.05); seekOut(e != null ? e : total, false); tlReveal(); };
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
function vState(){
  let b = ''; try { for (let i = 0; i < V.buffered.length; i++) b += V.buffered.start(i).toFixed(1) + '–' + V.buffered.end(i).toFixed(1) + ' '; } catch(_){}
  return `Stelle ${V.currentTime.toFixed(2)} s, readyState ${V.readyState}, networkState ${V.networkState}, paused ${V.paused}, seeking ${V.seeking}, ended ${V.ended}${V.error ? ', Fehler ' + V.error.code : ''}, geladen [${b.trim()}]`;
}
function playWatch(){
  const now = performance.now(), ct = V.currentTime;
  if (Math.abs(ct - WD.v) > 0.02){ WD.v = ct; WD.t = now; WD.n = 0; return; }   // kleine Sprünge stammen vom Wächter selbst
  if (V.seeking && now - WD.t < 5000) return;   // Sprung läuft noch (bei langen GOPs dauert das)
  if (V.paused && now - WD.t > 250 && WD.n === 0){ WD.n = 1; WD.t = now; V.play().catch(() => {}); return; }
  if (now - WD.t < 800) return;
  WD.t = now; WD.n++;
  if (WD.n === 1){ V.play().catch(() => {}); return; }
  if (WD.n <= 3){ if (WD.n === 2) hcLog('Wiedergabe steht – wird neu angesprungen. ' + vState());
    try { V.currentTime = ct + 0.001; } catch(_){} vClock = {ct:-1, at:0}; V.play().catch(() => {}); return; }
  const si = vSi; if (si < 0) return; hcLog('Wiedergabe steht weiter – die Quelle wird neu geladen. ' + vState()); WD.n = 0; vSi = -1; seekV(si, ct, true);
}
function loopStep(){
  if (P && timeline.length && playing){
    let g = timeline[curSeg];
    if (!g){ curSeg = segAtOut(outPos); g = timeline[curSeg]; if (!g) return; }   // Abschnitt gibt es nicht mehr: neu bestimmen
    const el = g.kind === 'main' ? V : (isImg(g.item.clip) ? null : IV);
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
}
// Die Schleife darf nie abreißen: Ein Fehler in einem einzelnen Durchlauf wurde früher nicht abgefangen – danach lief zwar
// das Video weiter, aber Zeitanzeige, Schnitte und Einblendungen standen still, bis das Programm neu gestartet wurde.
function loop(){
  try { loopStep(); }
  catch(e){ hcLog('Abspielschleife: ' + (e && (e.stack || e.message) || e)); try { if (P && timeline.length) curSeg = segAtOut(clamp(outPos, 0, Math.max(0, total - 0.01))); } catch(_){} }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
// Abspielmarke im Balken und die Zeitanzeigen. Die Marke wird in Schritten von einem Zwanzigstel Prozent gesetzt
// (bei 1000 px Breite ein halber Bildpunkt) – so ändert sich ihre Lage nur, wenn man es auch sieht.
const headEl = $('#head'), tNowEl = $('#tNow'), sideNowEl = $('#sideNow');
let headPct = '';
function updateHead(o){
  const p = (total ? Math.round(o / total * 2000) / 20 : 0) + '%';
  if (p !== headPct){ headPct = p; headEl.style.left = p; }
  setText(tNowEl, fmtT(o)); setText(sideNowEl, fmtS(o));
}
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
  if (el.classList.contains('hidden')) el.classList.remove('hidden');
}
function wmPlan(W, H){
  if (!wmOn() || !(total > 0)) return [];
  const w = P.watermark, r = wmRect(W, H);
  return [{mode: 'pip', image: true, uri: w.clip.uri, in: 0, out: r3(total), at: 0, x: r3(r.cx / W), y: r3(r.cy / H), w: +(r.w / W).toFixed(4), aspect: +clipAspect(w.clip).toFixed(5),
    track: 99, vol: 0, hasAudio: false, width: w.clip.width, height: w.clip.height, rotation: 0, opacity: +(+(w.op ?? WM_DEF.op)).toFixed(3), watermark: true}];
}
// ── Dauerhafte Textzeile (B9): eine kleine Zeile über die ganze Länge – Kanalname, Kennzeichnung, „V. i. S. d. P.“ ──
// P.textline = {text, pos: o/u + l/m/r, size und margin als Anteil der kürzeren Bildseite, color, outline, bg, font, on, safe}.
// safe (Vorgabe: an): Sind Schutzzonen eingeschaltet, rückt die Zeile in die freie Fläche; am Bildrand läge sie unter den Bedienelementen der Apps.
// Im Export ist sie ein Titel von 0 bis zum Ende (mit „line“ gekennzeichnet), damit alle Plattformen sie ohne Sonderweg zeichnen.
const TLINE_DEF = {text: '', pos: 'ul', size: 0.028, margin: 0.035, color: '#FFFFFF', outline: true, bg: false, font: '', on: true, safe: true};
const tlineOn = () => !!(P && P.textline && P.textline.on !== false && String(P.textline.text || '').trim());
const tlineText = () => String(P.textline.text || '').replace(/\s+/g, ' ').trim();
const tlinePx = (t, W, H) => t.size * Math.min(W, H) * (H > W ? 1.25 : 1);
// Maße im Bild W × H: Randabstände je Seite (mit Schutzzonen mindestens bis zur freien Fläche), Schriftgröße (so weit verkleinert,
// dass die Zeile zwischen die Ränder passt) und Textbreite. Vorschau und Export rechnen damit gleich.
// minV: Mindestabstand zum oberen bzw. unteren Rand – damit rückt eine zweite Zeile in derselben Ecke unter bzw. über die erste.
function lineLayout(t, text, W, H, minV = 0){
  const m = t.margin * Math.min(W, H), p = t.pos || 'ul', z = t.safe !== false ? safeZone() : null;
  const mT = Math.max(m, z ? z.t * H : 0, p[0] === 'o' ? minV : 0), mB = Math.max(m, z ? z.b * H : 0, p[0] === 'u' ? minV : 0), mL = Math.max(m, z ? z.l * W : 0);
  const mR = Math.max(m, z ? (p[0] === 'u' ? Math.max(z.r, z.cw) : z.r) * W : 0);   // unten reicht die Knopfspalte bis an die freie Fläche heran
  wrapCtx ||= document.createElement('canvas').getContext('2d');
  const fam = fontCss(t.font).replace('var(--ui)', getComputedStyle(document.body).fontFamily || 'sans-serif'), wt = fontWeight(t.font, 800);
  const measure = s => { wrapCtx.font = `${wt} ${s.toFixed(2)}px ${fam}`; return wrapCtx.measureText(text).width; };
  let px = tlinePx(t, W, H), tw = measure(px);
  // höchstens 86 % der Breite: Die Android-Ausgabe bricht Text bei 88 % um, die Zeile soll überall einzeilig bleiben
  const avail = Math.max(10, Math.min(W * 0.86, p[1] === 'm' ? W - 2 * Math.max(mL, mR) : W - mL - mR) - (t.bg ? px * 0.6 : 0)), fit = tw > avail ? Math.max(0.2, avail / tw) : 1;
  if (fit < 1){ px *= fit; tw = measure(px); }
  return {t, text, p, px, tw, fit, mT, mB, mL, mR, padX: t.bg ? px * 0.3 : 0, padY: t.bg ? px * 0.1 : 0};
}
const tlineLayout = (W, H) => lineLayout({...TLINE_DEF, ...P.textline}, tlineText(), W, H);
const viewTextline = () => { const st = $('#stage'); placeTextline(st.clientWidth, st.clientHeight); };   // Textzeile auf der Bühne nachziehen
function placeTextline(W, H){
  const el = $('#tline'); if (!tlineOn()){ if (!el.classList.contains('hidden')) el.classList.add('hidden'); return; }
  const key = W + '×' + H + JSON.stringify(P.textline) + (P.settings.safe || '') + (document.fonts ? document.fonts.status : ''); if (el.dataset.k === key && !el.classList.contains('hidden')) return; el.dataset.k = key;   // beim Abspielen: nur bei Änderungen neu setzen
  paintLine(el, tlineLayout(W, H));
}
function paintLine(el, L){
  const {t, p, px} = L, ol = Math.max(1, px / 14), cs = v => v.toFixed(1) + 'px';
  setText(el, L.text); el.classList.toggle('bg', !!t.bg);
  Object.assign(el.style, {fontSize: px.toFixed(2) + 'px', color: t.color || '#FFFFFF', fontFamily: fontCss(t.font), fontWeight: fontWeight(t.font, 800),
    left: p[1] === 'l' ? cs(L.mL) : p[1] === 'm' ? '50%' : '', right: p[1] === 'r' ? cs(L.mR) : '', top: p[0] === 'o' ? cs(L.mT) : '', bottom: p[0] === 'u' ? cs(L.mB) : '',
    transform: p[1] === 'm' ? 'translateX(-50%)' : '',
    textShadow: t.bg || t.outline === false ? 'none' : [[-1,-1],[1,-1],[-1,1],[1,1],[0,-1.4],[0,1.4],[-1.4,0],[1.4,0]].map(([a, b]) => `${(a*ol).toFixed(1)}px ${(b*ol).toFixed(1)}px 0 #000`).join(',')});
  if (el.classList.contains('hidden')) el.classList.remove('hidden');
}
// Für den Export: Mittelpunkt wie bei jedem Titel, dazu Ecke und Randabstand (anchor, mx, my) für Ausgaben, die an der Ecke ausrichten können
function tlineCue(W, H){ return tlineOn() && total > 0 ? lineCue(tlineLayout(W, H), W, H, 0, total) : null; }
function lineCue(L, W, H, s, e){
  const {t, p, px, tw, padX, padY} = L, th = px * 1.12;
  const cx = p[1] === 'l' ? L.mL + padX + tw / 2 : p[1] === 'r' ? W - L.mR - padX - tw / 2 : W / 2, cy = p[0] === 'o' ? L.mT + padY + th / 2 : H - L.mB - padY - th / 2;
  return {start: r3(s), end: r3(e), text: L.text, x: +(cx / W).toFixed(4), y: +(cy / H).toFixed(4), size: +(t.size * L.fit).toFixed(4), color: t.color || '#FFFFFF', outline: !t.bg && t.outline !== false, bg: !!t.bg,
    title: true, line: true, font: t.font || '', anchor: p, mx: +((p[1] === 'r' ? L.mR : L.mL) / W).toFixed(4), my: +((p[0] === 'o' ? L.mT : L.mB) / H).toFixed(4)};
}
function openTextline(){
  if (!P) return;
  const body = $('#sheetBody'), POS = [['ol','↖'],['om','↑'],['or','↗'],['ul','↙'],['um','↓'],['ur','↘']], had = tlineOn(); let before = null;
  body.innerHTML = `<h3>Textzeile</h3>
    <input type="text" id="tlText" maxlength="80" dir="auto" placeholder="z. B. @deinkanal · V. i. S. d. P.: Vorname Nachname" style="width:100%;font-size:16px">
    <div class="grid2" style="margin-top:10px">
      <div class="field"><span>Lage</span><div class="wm-pos" id="tlPos">${POS.map(([k, a]) => `<button type="button" data-p="${k}">${a}</button>`).join('')}</div></div>
      <label>Schrift <select id="tlFont" class="font-sel"></select></label>
      <label>Farbe <input type="color" id="tlColor"></label>
      <label class="row"><input type="checkbox" id="tlOn"> Anzeigen</label>
      <label class="row"><input type="checkbox" id="tlOutline"> Umrandung</label>
      <label class="row"><input type="checkbox" id="tlBg"> dunkler Kasten</label>
    </div>
    <label class="row" id="tlSafeRow"><input type="checkbox" id="tlSafe"> In der freien Fläche der Schutzzonen halten</label>
    <div class="field"><span>Größe <b id="tlSizeV"></b></span><input type="range" id="tlSize" min="0.016" max="0.06" step="0.002"></div>
    <div class="field"><span>Abstand zum Rand <b id="tlMarV"></b></span><input type="range" id="tlMar" min="0" max="0.15" step="0.005"></div>
    <p class="muted small">Steht über die ganze Länge im Bild: über allen Clips, in jedem Export und in den Clips aus diesem Projekt. In CapCut und Concat liegt sie auf einer eigenen Textspur.</p>
    <div class="row" style="margin-top:12px"><button class="btn danger" id="tlDel">Entfernen</button><button class="btn primary" id="tlOk" style="margin-left:auto">Fertig</button></div>`;
  const cur = () => ({...TLINE_DEF, ...(P.textline || {})}), view = viewTextline;
  // Alles, was in diesem Blatt geändert wird, ist zusammen ein Rückgängig-Schritt. Der Stand davor wird schon bei der ersten
  // Änderung zurückgelegt: Das Blatt bleibt offen, während man im Projekt weiterarbeitet, und wird womöglich nie eigens geschlossen.
  let dirty = false;
  const set = patch => { if (!dirty){ dirty = true; before = snapshot(); undo.push(before); if (undo.length > 200) undo.shift(); redo = []; }
    P.textline = {...cur(), ...patch}; paint(); view(); changedLive(); };
  fillFontSelects();
  const paint = () => { const x = cur(); if ($('#tlText').value !== (x.text || '')) $('#tlText').value = x.text || '';
    $('#tlOn').checked = x.on !== false; $('#tlOutline').checked = x.outline !== false; $('#tlOutline').disabled = !!x.bg; $('#tlBg').checked = !!x.bg;
    $('#tlColor').value = (x.color || '#FFFFFF').toLowerCase(); $('#tlFont').value = x.font && fontOf(x.font).key ? x.font : '';
    $('#tlSafe').checked = x.safe !== false; $('#tlSafeRow').classList.toggle('hidden', !safeZone());
    $('#tlPos').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.p === x.pos));
    $('#tlSize').value = x.size; $('#tlSizeV').textContent = (x.size * 100).toFixed(1).replace('.', ',') + ' %'; $('#tlMar').value = x.margin; $('#tlMarV').textContent = (x.margin * 100).toFixed(1).replace('.', ',') + ' %'; };
  const upd = () => set({text: $('#tlText').value, on: $('#tlOn').checked, outline: $('#tlOutline').checked, bg: $('#tlBg').checked, safe: $('#tlSafe').checked, color: $('#tlColor').value.toUpperCase(),
    ...($('#tlFont').value !== '__import' ? {font: $('#tlFont').value} : {}), size: +$('#tlSize').value, margin: +$('#tlMar').value});
  for (const id of ['tlText', 'tlOn', 'tlOutline', 'tlBg', 'tlSafe', 'tlColor', 'tlFont', 'tlSize', 'tlMar']){ $('#' + id).addEventListener('input', upd); $('#' + id).addEventListener('change', upd); }
  $('#tlText').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') $('#tlOk').click(); });
  $('#tlFont').addEventListener('change', async () => { if ($('#tlFont').value !== '__import') return; const f = await importFont(); fillFontSelects(); if (f) set({font: f.key}); else paint(); });
  $('#tlPos').onclick = e => { const b = e.target.closest('button'); if (b) set({pos: b.dataset.p}); };
  // Beim Schließen: Text glätten; eine Zeile ohne Text gibt es nicht. Hat sich unterm Strich nichts geändert, entfällt der Rückgängig-Schritt.
  let closed = false;
  const finish = del => { if (closed) return; closed = true;
    if (P.textline){ if (del || !String(P.textline.text || '').trim()) delete P.textline; else P.textline.text = tlineText(); }
    if (dirty && undo[undo.length - 1] === before && snapshot() === before) undo.pop();
    changed(false); view(); if (del && had) toast('Textzeile entfernt'); };
  sheetOnClose = () => finish(false);
  $('#tlDel').onclick = () => { if (P.textline) set({}); finish(true); closeSheet(); };
  $('#tlOk').onclick = closeSheet;
  body.onclick = null; sheetItem = null; paint(); view(); openSheet(true);
  if (!had) setTimeout(() => { const el = $('#tlText'); if (el) el.focus(); }, 30);
}

// ───────── Schutzzonen der Plattformen (B7) ─────────
// Wo TikTok, Instagram und YouTube ihre Bedienelemente über ein Hochformat-Video legen. Anteile an Höhe bzw. Breite, bezogen auf
// 1080 × 1920: t/b/l/r = Rand oben/unten/links/rechts, cw/cy = Knopfspalte rechts (Breite, ab welcher Höhe).
// „ad“ sind die Vorgaben, die die Plattformen selbst für Anzeigen veröffentlichen (TikTok: In-Feed-Vorlage, Meta: 14 % / 35 % / 6 %,
// Google: 288 / 672 / 48 / 192 px). Für normale Beiträge nennen sie keine Zahlen; „post“ sind gemessene Richtwerte – was die App
// tatsächlich verdeckt, hängt vom Gerät und von der Länge der Beschreibung ab.
const SAFE = {
  post: {tiktok: {t: 0.08, b: 0.21, l: 0.06, r: 0.06, cw: 0.16, cy: 0.41}, reels: {t: 0.115, b: 0.2, l: 0.06, r: 0.06, cw: 0.11, cy: 0.55}, shorts: {t: 0.095, b: 0.21, l: 0.045, r: 0.045, cw: 0.12, cy: 0.4}},
  ad:   {tiktok: {t: 0.125, b: 0.344, l: 0.111, r: 0.111, cw: 0.278, cy: 0.4375}, reels: {t: 0.14, b: 0.35, l: 0.06, r: 0.06, cw: 0.21, cy: 0.6}, shorts: {t: 0.15, b: 0.35, l: 0.044, r: 0.178, cw: 0, cy: 1}},
};
const SAFE_NAME = {tiktok: 'TikTok', reels: 'Instagram Reels', shorts: 'YouTube Shorts', all: 'alle drei'};
const safeFits = () => { const [W, H] = baseDims(); return H / W >= 1.5; };   // Hochformat ab etwa 2:3 – darunter liegen die Bedienelemente neben dem Bild
function safeZone(){   // die gewählte Zone (bei „alle drei“ die jeweils größte), sonst null
  const v = P && P.settings.safe; if (!v || !safeFits()) return null;
  const [key, kind] = String(v).split(':'), set = SAFE[kind === 'ad' ? 'ad' : 'post'], list = key === 'all' ? Object.values(set) : set[key] ? [set[key]] : [];
  if (!list.length) return null;
  const z = {t: 0, b: 0, l: 0, r: 0, cw: 0, cy: 1};
  for (const x of list){ z.t = Math.max(z.t, x.t); z.b = Math.max(z.b, x.b); z.l = Math.max(z.l, x.l); z.r = Math.max(z.r, x.r); if (x.cw){ z.cw = Math.max(z.cw, x.cw); z.cy = Math.min(z.cy, x.cy); } }
  return z;
}
const safeLabel = () => { const [key, kind] = String((P && P.settings.safe) || '').split(':'); return key ? `${SAFE_NAME[key] || key}${kind === 'ad' ? ' · Anzeige' : ''}` : ''; };
function placeSafe(){
  const ov = $('#safeOv'), z = P && !CanvasEdit ? safeZone() : null;
  ov.classList.toggle('hidden', !z); $('#sideSafe').classList.toggle('on', !!(P && P.settings.safe));
  if (!z) return;
  const pc = v => (v * 100).toFixed(2) + '%', key = JSON.stringify(z) + safeLabel(); if (ov.dataset.k === key) return; ov.dataset.k = key;
  ov.innerHTML = `<i style="left:0;right:0;top:0;height:${pc(z.t)}"></i><i style="left:0;right:0;bottom:0;height:${pc(z.b)}"></i>
    <i style="left:0;width:${pc(z.l)};top:${pc(z.t)};bottom:${pc(z.b)}"></i><i style="right:0;width:${pc(z.r)};top:${pc(z.t)};bottom:${pc(z.b)}"></i>
    ${z.cw > z.r ? `<i style="right:${pc(z.r)};width:${pc(z.cw - z.r)};top:${pc(Math.max(z.t, z.cy))};bottom:${pc(z.b)}"></i>` : ''}<b style="bottom:${pc(1 - z.t)};left:${pc(z.l)}"></b>`;
  ov.querySelector('b').textContent = 'Bedienelemente · ' + safeLabel();   // steht im oberen Streifen, damit es nichts in der freien Fläche verdeckt
}
// Kasten (Mittelpunkt x/y, Breite w, Höhe h, alles als Anteil des Bildes) in die freie Fläche schieben
function safeClamp(x, y, w, h){
  const z = safeZone(); if (!z) return [x, y];
  const L = z.l, R = 1 - z.r, T = z.t, B = 1 - z.b;
  x = w >= R - L ? (L + R) / 2 : clamp(x, L + w / 2, R - w / 2);
  y = h >= B - T ? (T + B) / 2 : clamp(y, T + h / 2, B - h / 2);
  // Knopfspalte rechts: Ein Kasten, der daneben Platz hat, weicht ihr aus – nach links oder nach oben, je nachdem, was näher liegt.
  // Breite Kästen (zweizeilige Untertitel über fast die ganze Breite) passen ohnehin nicht daneben und bleiben, wo sie sind;
  // sonst würden sie bis über die Spalte hinaus nach oben springen.
  const cx0 = 1 - z.cw, cy0 = Math.max(T, z.cy);
  if (z.cw > z.r && w <= cx0 - L + 1e-6 && x + w / 2 > cx0 + 1e-6 && y + h / 2 > cy0 + 1e-6){
    const up = cy0 - h / 2, left = cx0 - w / 2;
    if (up - h / 2 >= T - 1e-6 && y - up <= x - left) y = up; else x = left;
  }
  return [x, y];
}
const inSafe = (x, y, w, h) => { const [nx, ny] = safeClamp(x, y, w, h); return Math.abs(nx - x) < 0.004 && Math.abs(ny - y) < 0.004; };
function setSafe(v){
  if (!P) return; P.settings.safe = v || ''; if (v) try { localStorage.setItem('hc-safe', v); } catch(_){}
  changed(false); syncSafe(); placeSafe(); placeOverlay(); updateTitles(outPos); viewTextline(); viewSrcLine(); viewLower(); viewPart();
  toast(!v ? 'Schutzzonen aus' : !safeFits() ? 'Schutzzonen gibt es nur im Hochformat (9:16) – dieses Projekt ist breiter. Ein Clip daraus übernimmt die Einstellung.' : `Schutzzonen: ${safeLabel()} – Untertitel und Titel rasten beim Ziehen in der freien Fläche ein`);
}
function syncSafe(){ const v = (P && P.settings.safe) || ''; for (const sel of $$('select.safe-sel')) sel.value = v; }
(() => { const keys = ['tiktok', 'reels', 'shorts', 'all'], opt = (k, ad) => `<option value="${k}${ad ? ':ad' : ''}">${SAFE_NAME[k]}</option>`;
  for (const sel of $$('select.safe-sel')){ sel.innerHTML = `<option value="">aus</option><optgroup label="Beiträge (Richtwerte)">${keys.map(k => opt(k)).join('')}</optgroup><optgroup label="Anzeigen (Vorgaben der Plattformen)">${keys.map(k => opt(k, true)).join('')}</optgroup>`;
    sel.addEventListener('change', () => setSafe(sel.value)); } })();
$('#sideSafe').onclick = e => { e.stopPropagation(); if (!P) return; let last = 'all'; try { last = localStorage.getItem('hc-safe') || 'all'; } catch(_){} setSafe(P.settings.safe ? '' : last); };

// ───────── Längen-Ampel (F6): passt der Clip in die Grenzen der Plattformen? ─────────
// hard = längstens möglich, soft = Grenze, ab der es Einschränkungen gibt. Stand November 2026: YouTube Shorts bis 3:00;
// Instagram Reels bis 20:00, über 3:00 ohne Empfehlung an neue Zuschauer:innen; TikTok bis 10:00 in der App aufgenommen, bis 60:00 als hochgeladene Datei.
const LEN_LIMITS = [
  {k: 'shorts', name: 'YouTube Shorts', hard: 180, over: 'ab 3:00 wird daraus ein normales YouTube-Video'},
  {k: 'reels', name: 'Instagram Reels', soft: 180, hard: 1200, softNote: 'so lange Reels empfiehlt Instagram neuen Zuschauer:innen nicht mehr', over: 'mehr als 20:00 nimmt Instagram als Reel nicht an'},
  {k: 'tiktok', name: 'TikTok', soft: 600, hard: 3600, softNote: 'so lange Videos nimmt TikTok nur als hochgeladene Datei', over: 'mehr als 60:00 nimmt TikTok nicht an'},
];
const lenRelevant = () => { const [W, H] = baseDims(); return !!(P && total > 0 && (H > W || P.format || P.clipOf || total <= 180)); };
function lenLights(){
  return LEN_LIMITS.map(L => { const lim = L.soft || L.hard, st = total > L.hard + 0.05 ? 'over' : total > lim + 0.05 ? 'warn' : 'ok';
    const txt = st === 'over' ? `${fmtT(Math.ceil(total - L.hard))} zu lang – ${L.over}`
      : st === 'warn' ? `${fmtT(Math.ceil(total - lim))} über ${fmtT(lim)} – ${L.softNote}`
      : `passt, noch ${fmtT(Math.floor(lim - total))} Platz bis ${fmtT(lim)}`;
    return {...L, st, txt}; });
}
function renderLenLights(){
  const on = lenRelevant(), html = on ? lenLights().map(L => `<span class="len-chip ${L.st}" data-k="${L.k}" title="${esc(L.name)}: ${esc(L.txt)}"><i></i><b>${esc(L.name)}</b> ${esc(L.txt)}</span>`).join('') : '';
  for (const id of ['#exLen', '#clipLen']){ const el = $(id); el.classList.toggle('hidden', !on); if (el.dataset.h !== html){ el.dataset.h = html; el.innerHTML = html; } }
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
    if (el.classList.contains('hidden')) el.classList.remove('hidden');
    const v = PipDrag.on && PipDrag.it === it ? PipDrag : elVals(it, o - a.at), r = elRect(it, v, W, H) || (hasCrop(it) || Crop.it === it ? elRect(it, coverVals(it), W, H) : null);
    placeLayer(el, it, r); syncKeyLayer(el, it);
    if (el.tagName !== 'VIDEO') return;
    const vol = it.vol || 0; el.muted = !(vol > 0) || !playing; setVol(el, vol);
    syncMedia(el, it.in + (o - a.at));
    if (playing && el.paused) el.play().catch(() => {}); if (!playing && !el.paused) el.pause();
  });
  updateAudio(o); updateJoin(o); placeDeco(act, o, W, H); placeWatermark(W, H); placeTextline(W, H); placeSrcLine(W, H, o); placeLower(W, H, o); placePart(W, H, o);
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
  const act = P.items.filter(x => x.type === 'title' && !x.lt).map(x => ({x, a: srcToOut(snapSrc(x.at))})).filter(t => o >= t.a && o < t.a + t.x.dur);
  for (const [id, el] of titleEls) if (!act.some(t => t.x.id === id)){ el.remove(); titleEls.delete(id); }
  const st = $('#stage'), W = st.clientWidth, H = st.clientHeight, zone = !playing && act.length ? safeZone() : null;
  for (const {x} of act){
    let el = titleEls.get(x.id);
    if (!el){ el = document.createElement('div'); el.className = 'titlebox'; el.dir = 'auto'; el.dataset.id = x.id; box.append(el); titleEls.set(x.id, el); }
    if (!(TitleDrag.on && TitleDrag.id === x.id)){ setText(el, x.text || 'Titel'); el.style.left = (x.x * W) + 'px'; el.style.top = (x.y * H) + 'px'; }
    const px = (SIZE_F[x.size] || 0.058) * Math.min(W, H) * (H > W ? 1.25 : 1) * (x.scale || 1), ol = Math.max(1, px / 14);
    el.style.fontSize = px.toFixed(1) + 'px'; el.style.color = x.color || '#FFFFFF'; el.style.fontFamily = fontCss(x.font); el.style.fontWeight = fontWeight(x.font, 800);
    el.style.textShadow = x.outline !== false ? [[-1,-1],[1,-1],[-1,1],[1,1],[0,-1.4],[0,1.4],[-1.4,0],[1.4,0]].map(([a, b]) => `${(a*ol).toFixed(1)}px ${(b*ol).toFixed(1)}px 0 #000`).join(',') : 'none';
    el.style.background = x.bg ? 'rgba(0,0,0,.55)' : ''; el.classList.toggle('sel', !!(typeof TL !== 'undefined' && TL.sel && TL.sel.id === x.id));
    if (!playing) el.classList.toggle('unsafe', !!zone && !(TitleDrag.on && TitleDrag.id === x.id) && !inSafe(x.x, x.y, el.offsetWidth / W, el.offsetHeight / H));
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
  let x = clamp(TitleDrag.sx + (e.clientX - TitleDrag.x0) / st.width, 0.02, 0.98), y = clamp(TitleDrag.sy + (e.clientY - TitleDrag.y0) / st.height, 0.02, 0.98);
  if (safeZone()) [x, y] = safeClamp(x, y, TitleDrag.el.offsetWidth / st.width, TitleDrag.el.offsetHeight / st.height);
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
  voiceWire();
  setVol(V, (fx ? fx.vol ?? 1 : 1) * (g && g.kind === 'main' ? srcVol(g.si) * voiceGainNow(g) : 1));
}
// Lautstärke je Video der Hauptspur (P.sources[k].vol) – wird mit der Anpassung des Abschnitts multipliziert
const srcVol = si => { const s = P && P.sources[si]; return s && s.vol != null ? +s.vol : 1; };
// Lautstärke in der Vorschau, auch über 100 % (dann über die Web-Audio-Schnittstelle verstärkt)
let actx = null;
function setVol(el, v, force){   // force: die Verstärker-Kette auch unter 100 % anlegen (Vorschau von „Stimme aufbereiten“)
  v = Math.max(0, +v || 0);
  if (!el._g && v <= 1 && !force){ if (Math.abs(el.volume - v) > 0.001) el.volume = v; return; }
  try {
    if (!el._g){ actx ||= new (window.AudioContext || window.webkitAudioContext)(); const src = actx.createMediaElementSource(el), gn = actx.createGain(); src.connect(gn).connect(actx.destination); el._g = gn; el._s = src; }
    if (el.volume !== 1) el.volume = 1; el._g.gain.value = Math.min(v, 4); if (actx.state === 'suspended') actx.resume().catch(() => {});
  } catch(_){ el.volume = Math.min(1, v); }
}
function updateZoom(){
  const g = timeline[curSeg]; applySegFx(g);
  if (!g || g.kind !== 'main'){ V.style.transform = ''; return; }
  applyMainTransform();
}
// Zoom (innen) und Lage/Größe des Clips (außen), Ursprung in der Mitte
// Leinwand bearbeiten: Die Bühne zeigt das ganze Ausgangsbild, die Leinwand liegt als verschiebbarer Rahmen darüber
let CanvasEdit = false;
function applyMainTransform(){
  const g = timeline[curSeg]; if (!g || g.kind !== 'main' || CanvasEdit){ V.style.transform = ''; if (vKey) vKey.canvas.style.transform = ''; return; }
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
  sc.addEventListener('pointerdown', e => { sc.setPointerCapture(e.pointerId); const was = playing; if (was) pausePlay(); seekOut(at(e), false); tlReveal();
    sc.onpointermove = ev => { seekOut(at(ev), false); tlReveal(); }; sc.onpointerup = () => { sc.onpointermove = null; if (was) startPlay(); }; });
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
// Sprachen der Transkription (C8). Whisper kennt rund hundert Sprachen; angeboten werden die, die Wörter mit Leerzeichen trennen –
// der Schnitt über den Text arbeitet Wort für Wort. Deutsch, Englisch und „automatisch“ stehen fest in index.html.
const LANGS_TOP = [['tr', 'Türkisch'], ['ar', 'Arabisch'], ['ru', 'Russisch'], ['pl', 'Polnisch'], ['uk', 'Ukrainisch']];
const LANGS_MORE = [['sq', 'Albanisch'], ['hy', 'Armenisch'], ['az', 'Aserbaidschanisch'], ['bs', 'Bosnisch'], ['bg', 'Bulgarisch'], ['da', 'Dänisch'], ['et', 'Estnisch'], ['fi', 'Finnisch'],
  ['fr', 'Französisch'], ['ka', 'Georgisch'], ['el', 'Griechisch'], ['he', 'Hebräisch'], ['hi', 'Hindi'], ['id', 'Indonesisch'], ['it', 'Italienisch'], ['ca', 'Katalanisch'], ['hr', 'Kroatisch'],
  ['lv', 'Lettisch'], ['lt', 'Litauisch'], ['mk', 'Mazedonisch'], ['nl', 'Niederländisch'], ['no', 'Norwegisch'], ['ps', 'Paschtu'], ['fa', 'Persisch'], ['pt', 'Portugiesisch'], ['ro', 'Rumänisch'],
  ['sv', 'Schwedisch'], ['sr', 'Serbisch'], ['sk', 'Slowakisch'], ['sl', 'Slowenisch'], ['es', 'Spanisch'], ['sw', 'Suaheli'], ['cs', 'Tschechisch'], ['hu', 'Ungarisch'], ['ur', 'Urdu'], ['vi', 'Vietnamesisch']];
(() => { const sel = $('#lang');
  for (const [label, list] of [['Häufig gebraucht', LANGS_TOP], ['Weitere Sprachen', LANGS_MORE]]){ const g = document.createElement('optgroup'); g.label = label;
    for (const [v, n] of list){ const o = document.createElement('option'); o.value = v; o.textContent = n; g.append(o); } sel.append(g); } })();
// Die Sprache gehört zum Projekt: Wer ein weiteres Video anhängt, bekommt die Sprache des Projekts vorgeschlagen; ein neues Projekt beginnt mit Deutsch
function syncLang(){ const sel = $('#lang'), v = (P && P.language) || 'de'; sel.value = [...sel.options].some(o => o.value === v) ? v : 'de'; }
// Schrift von rechts nach links (Arabisch, Hebräisch, Persisch, Urdu …): Absätze im Text richten sich nach ihrem ersten Wort
const RTL_CH = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
function fillModels(){
  const ms = J(TS.models()) || [];
  const sel = $('#model'), keep = sel.value; sel.innerHTML = '';
  ms.forEach(m => { const o = document.createElement('option'); o.value = m.name; o.textContent = m.label + (m.installed ? ' · bereit' : ` · ${m.sizeMb} MB laden`); sel.append(o); });
  const ready = ms.find(m => m.name === keep) || ms.find(m => m.installed && m.recommended) || ms.find(m => m.installed) || ms[0]; if (ready) sel.value = ready.name;
}
function renderSources(){
  const box = $('#srcList'); if (!box || !P) return; box.innerHTML = ''; paintDictInfo();
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
  const o = resume ? resume.opts : {model: $('#model').value, lang: $('#lang').value, fillers: $('#fillers').checked, startTok: tokens.length, firstTime: !tokens.length, hint: dictHint()};
  if (!resume) o.subsOnly = o.firstTime && studioCut() && $('#subsOnly').checked;
  if (!todo.length && !resume) return;
  const pid = P.id, P0 = P;
  $('#transBtn').disabled = true; $('#transCancel').classList.remove('hidden'); $('#transProg').classList.remove('hidden'); TS.keepAwake(true);
  transCancelled = false;
  const {model, lang, fillers, startTok, firstTime, subsOnly} = o;
  // Begriffe aus dem Wörterbuch als Hinweis für Whisper. Beim Nachhören einzelner unklarer Stellen bleibt der Hinweis weg:
  // In wenigen Sekunden undeutlicher Sprache würde Whisper die Begriffe sonst leicht hineinhören.
  const setHint = on => { if (TS.setAsrHint) try { TS.setAsrHint(on ? o.hint || '' : ''); } catch(_){} };
  if (subsOnly && !resume) freezeStudioCut();
  let n = 0, words = resume ? (resume.words || 0) : 0;
  const alive = () => P === P0;   // Projekt inzwischen geschlossen/neu geöffnet: diese Runde endet, die neue übernimmt
  const end = () => { if (!alive()) return; tjSet(pid, null); $('#transBtn').disabled = false; $('#transCancel').classList.add('hidden'); $('#transProg').classList.add('hidden'); TS.keepAwake(false); transJob = null; renderSources(); };
  const finish = () => {
    end(); if (!alive()) return; P.language ||= lang;
    if (firstTime && !subsOnly){ deleted = new Set(); P.trims = {}; P.adj = {}; P.checks = []; }
    const fixed = dictApply(startTok);   // hinterlegte Fehlschreibungen ersetzen, ehe aufgeräumt wird und die Untertitel entstehen
    const cleaned = subsOnly ? [] : autoClean(startTok);
    if (firstTime) genCues(); else genCues(startTok);
    renderTranscript(); changed(); saveNow(); busSend({t:'reload'}); setTab(subsOnly ? 'subs' : 'text');
    if (subsOnly){ toast(`${computedCues().length} Untertitel aus dem Schnitt erzeugt – Text, Zeiten und Position lassen sich jetzt anpassen`); return; }
    const unk = tokens.filter(t => t.i >= startTok && t.type === 'unk' && !deleted.has(t.i)).length;
    toast(`${words} Wörter erkannt` + (fixed ? ` · ${fixed === 1 ? '1 Stelle' : fixed + ' Stellen'} nach dem Wörterbuch korrigiert` : '') + (cleaned.length ? ` · entfernt: ${cleaned.join(', ')}` : '') + (unk ? ` · ${unk}× 🗣 nicht erkannte Sprache` : ''));
  };
  const next = () => {
    if (!alive()) return;
    if (n >= todo.length || transCancelled) return (n || resume) ? finish() : end();
    const k = todo[n], s = P.sources[k];
    if (s.hasAudio === false){ s.tr = true; s.noAudio = true; n++; return next(); }
    const label = todo.length > 1 ? `Video ${n + 1} von ${todo.length}: ` : '';
    let jid = null;
    if (resume && resume.k === k && resume.id){ jid = resume.id; resume.id = null; }
    else try { setHint(true); jid = TS.transcribe(s.uri, model, lang, fillers); } catch(e){ end(); $('#transMsg').textContent = 'Fehler: ' + e.message; return; }
    transJob = jid; tjSet(pid, {id: jid, k, opts: o, words, at: Date.now()});
    watchJob(jid, j => { if (!alive()) return; $('#transProg i').style.width = ((n + j.progress) / todo.length * 100).toFixed(1) + '%'; $('#transMsg').textContent = label + (j.message || ''); },
      j => { if (!alive()) return; const r = j.result || {}; if (r.env){ s.env = r.env; if (s._env) s._env = null; delete s._bursts; } if (r.padded) s.pad0 = true; if (r.lang && !P.language) P.language = r.lang;
             s.asr = {v: CAP.version || '', timing: r.timing || '', chunks: r.chunks || 0, model, at: Date.now()};   // zur Fehlersuche: womit transkribiert wurde
             const base = appendSourceTokens(k, r.words || []); words += (r.words || []).length;
             P.tokens = tokens; saveNow(); tjSet(pid, {id: null, k: -1, opts: o, words, at: Date.now()});   // Ergebnis sofort sichern
             // Stellen ohne erkannte Wörter (🗣) einzeln nachhören: meist Anläufe, die Whisper im Zusammenhang auslässt
             const gaps = TS.transcribeRanges ? tokens.filter(t => t.i >= base && t.src === k && t.type === 'unk' && t.we - t.ws >= 0.25) : [];
             if (!gaps.length || transCancelled){ n++; saveNow(); return next(); }
             let gj; try { setHint(false); gj = TS.transcribeRanges(s.uri, model, lang, JSON.stringify(gaps.map(t => [r3(t.ws - s.off), r3(t.we - s.off)]))); } catch(e){ n++; saveNow(); return next(); }
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
  const root = $('#transcript'); root.innerHTML = ''; spans = new Array(tokens.length); clipTokMemo = null;
  if (order.length !== tokens.length) computeOrder();
  let para = -1, pEl = null, src = -1, prev = -2, lastSpk = ''; const frag = document.createDocumentFragment(), fset = fillerSet();
  const markAt = new Map(); for (const m of P.marks || []){ const k = tokAtSrc(m.at); if (k < 0) continue; if (!markAt.has(k)) markAt.set(k, []); markAt.get(k).push(m); }
  // Stellen mit Quelle (rf), offenem Beleg (need) oder Prüfvermerk (okd): unterstrichen, mit einem Zettel vor dem ersten Wort
  const refCls = new Map(), refPin = new Map();
  for (const r of refsAll()){ const ids = refToks(r).filter(i => isTextTok(i)); if (!ids.length) continue; const cls = refOpen(r) ? 'need' : refHas(r) ? '' : 'okd';
    for (const i of ids) if (refCls.get(i) !== 'need') refCls.set(i, cls);
    if (!refPin.has(ids[0])) refPin.set(ids[0], []); refPin.get(ids[0]).push(r); }
  for (const i of order){
    const t = tokens[i], mk = markAt.get(i), chap = mk && mk.find(m => m.k === 'chap');
    if (t.src !== src && P.sources.length > 1){ src = t.src; const h = document.createElement('div'); h.className = 'src-head'; h.textContent = `🎞 ${src + 1} · ${P.sources[src].name}`; frag.append(h); pEl = null; }
    const jump = prev >= 0 && i !== prev + 1;
    if (chap){ const h = document.createElement('div'); h.className = 'chap-head'; h.dataset.mk = chap.id; h.title = 'Kapitel – anklicken zum Umbenennen oder Entfernen';
      h.innerHTML = `${icon('🚩')}<b dir="auto"></b><span class="t"></span>`; h.querySelector('b').textContent = chap.text || 'Kapitel'; frag.append(h); }
    if (t.p !== para || !pEl || jump || chap){ pEl = document.createElement('p'); para = t.p;
      if (jump) pEl.classList.add('moved');
      const ts = document.createElement('span'); ts.className = 'ts'; ts.textContent = (jump ? '↕ ' : '') + fmtT(t.ws ?? t.s); pEl.append(ts); frag.append(pEl); }
    if (t.type !== 'pause' && (t.spk || '') !== lastSpk){ lastSpk = t.spk || '';
      const who = spkOf(lastSpk); if (who || P.speakers.length){ const l = document.createElement('span'); l.className = 'spk-lbl' + (who ? '' : ' none'); l.textContent = who ? who.name : 'ohne Person'; if (who) l.style.setProperty('--sc', spkCol(who)); pEl.append(l, ' '); } }
    const sp = document.createElement('span'); sp.dataset.i = t.i;
    if (t.type === 'word'){ sp.className = 'tk word' + (isLowTok(t) ? ' low' : '') + (t.ug ? ' rep' : ''); if (t.ug) sp.title = 'Nachgehört: Whisper hatte diese Stelle zunächst ausgelassen – meist ein Anlauf'; if (fset.has(t.i)) sp.classList.add('filler'); }
    else if (t.type === 'unk'){ sp.className = 'tk unk'; sp.title = 'Hier wurde gesprochen, aber Whisper hat kein Wort erkannt – meist ein ausgelassener Anlauf. „Wiederholungen weg“ löscht solche Stellen; antippen spielt sie ab.'; if (t.att) sp.classList.add('att'); }
    else sp.className = 'tk pause';
    if (t.type === 'word' && !pEl._dir){ pEl._dir = 1; if (RTL_CH.test(tokText(t))) pEl.dir = 'rtl'; }
    if (mk) for (const m of mk) if (m.k === 'note'){ const pin = document.createElement('span'); pin.className = 'note-pin' + (m.done ? ' done' : ''); pin.dataset.mk = m.id; pin.title = 'Notiz: ' + m.text; pin.innerHTML = icon('📝'); pEl.append(pin, ' '); }
    const rp = refPin.get(i); if (rp) for (const r of rp){ const pin = document.createElement('span'), open = refOpen(r), has = refHas(r); pin.className = 'ref-pin' + (open ? ' need' : has ? '' : ' okd'); pin.dataset.rf = r.id;
      pin.title = open ? 'Beleg nötig – anklicken und die Quelle eintragen' : has ? 'Quelle: ' + refLine(r) : 'Geprüft, ohne Quelle'; pin.innerHTML = icon(open ? '❓' : has ? '❝' : '✓'); pEl.append(pin, ' '); }
    if (refCls.has(i)){ sp.classList.add('rf'); if (refCls.get(i)) sp.classList.add(refCls.get(i)); }
    spans[t.i] = sp; pEl.append(sp, ' ');
    prev = i;
  }
  root.append(frag); tokens.forEach(t => paint(t.i));
  paintFillerCount(fset); paintMarkTimes(); paintMarksBtn(); paintRefsBtn(); paintClipsBtn(); paintLowBtn(); paintChkBtn(); lowMark();
  const todo = P.sources.filter(s => !s.tr).length;
  $('#textTodo').classList.toggle('hidden', !todo); $('#textTodo b').textContent = todo === 1 ? '1 Video ist' : `${todo} Videos sind`;
  if ($('#findIn').value) runFind();
}
$('#textTodoBtn').onclick = () => setTab('trans');
function paint(i){
  const t = tokens[i], sp = spans[i]; if (!sp) return;
  if (t.type === 'word'){ const tx = tokText(t); if (sp.textContent !== tx) sp.textContent = tx; sp.classList.toggle('empty', !tx); sp.classList.toggle('edited', P.edits[t.i] != null); sp.classList.toggle('low', isLowTok(t)); }
  sp.classList.toggle('del', deleted.has(i) || (t.type === 'word' && isSrcDeleted((t.ws + t.we) / 2)));
  sp.classList.toggle('ks', !!t.ks && sp.classList.contains('del'));
  const kwOn = !!(P.kw && P.kw.length && P.kw.includes(i)); if (kwOn !== sp.classList.contains('kw')){ sp.classList.toggle('kw', kwOn); } sp.style.setProperty('--kw', kwOn ? (S().kwColor || KW_DEF) : '');
  const clOn = clipToks().has(i); if (clOn !== sp.classList.contains('cl')) sp.classList.toggle('cl', clOn);
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
  if (!playing){ const t = tokens[i]; seekOut(srcToOut(snapSrc(t.ws ?? t.s)), false); tlReveal(); }
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
    $('#selInfo').textContent = ids.length === 1 ? (FINE ? 'Zweites Wort anklicken oder ziehen' : 'Zweites Wort antippen') : (FINE ? 'Markierung ziehen = verschieben' : 'Halten + ziehen = verschieben');
    const g = spans.length ? growStep() : null; $('#selSent span').textContent = !g || g.what === 'para' ? 'Absatz' : 'Satz'; $('#selSent').disabled = !g;
    const cs = clipListAll().length ? secOf(ids) : null; $('#selList span').textContent = cs && clipListAll().some(q => secSame(q, cs)) ? 'Vormerkung weg' : 'Vormerken'; }
}
function clearSel(){ selA = selB = null; showSel(); }
// Anzeigen im Text-Reiter, die dem Schnitt folgen (Zähler der Füllwörter, Zeiten an den Kapiteln): kurz nach einer Änderung auffrischen
let textLateT = 0;
function textLater(){ if (tab !== 'text' || !tokens.length) return; clearTimeout(textLateT); textLateT = setTimeout(() => { if (P && tab === 'text' && spans.length){ paintFillerCount(); paintMarkTimes(); paintLowBtn(); } }, 250); }
// ── Satz und Absatz auswählen, „Nur das behalten“ (C4) ──
// Gerechnet wird in der Reihenfolge, in der der Text dasteht (order/pos). Ein Satz reicht vom Wort nach dem vorigen Satzende bis zum
// nächsten Wort mit Satzende; Pausen und nicht erkannte Stellen dazwischen gehören dazu, ein Wechsel des Videos beendet ihn.
function sentBounds(ka, kb){
  const tk = k => tokens[order[k]], isW = k => tk(k).type === 'word' && !!tokText(tk(k)), ends = k => sentEnd(tokText(tk(k)));
  let a = ka, b = kb, last = null;
  for (let k = ka - 1; k >= 0 && tk(k).src === tk(ka).src; k--){ if (!isW(k)) continue; if (ends(k)) break; a = k; }
  for (let k = kb; k >= ka; k--) if (isW(k)){ last = k; break; }
  if (last != null && ends(last)) b = last;
  else for (let k = kb + 1; k < order.length && tk(k).src === tk(kb).src; k++){ if (!isW(k)) continue; b = k; if (ends(k)) break; }
  while (a < b && !isW(a)) a++;
  while (b > a && !isW(b)) b--;
  return [a, b];
}
function paraBounds(ka, kb){
  const par = k => spans[order[k]] && spans[order[k]].parentElement; let a = ka, b = kb;
  while (a > 0 && par(a - 1) === par(ka)) a--;
  while (b < order.length - 1 && par(b + 1) === par(kb)) b++;
  return [a, b];
}
// Wort an der Abspiellinie (für A, C und B ohne Markierung)
function tokAtOut(o){
  const g = timeline[segAtOut(o)]; if (!g || g.kind !== 'main' || !tokens.length) return null;
  const t = outToSrcT(o); let lo = 0, hi = tokens.length - 1, k = -1;
  while (lo <= hi){ const m = (lo + hi) >> 1; if (tokens[m].s <= t + 1e-3){ k = m; lo = m + 1; } else hi = m - 1; }
  return k < 0 ? null : k;
}
// Welche Stufe „Satz“ als Nächstes auswählt: 'sent', 'para' oder null (mehr geht nicht)
function growStep(){
  if (selA == null || pos[selA] == null) return null;
  const ka = Math.min(pos[selA], pos[selB]), kb = Math.max(pos[selA], pos[selB]);
  const grow = r => r[0] < ka || r[1] > kb ? [Math.min(r[0], ka), Math.max(r[1], kb)] : null;   // nur, was die Markierung größer macht
  let r = grow(sentBounds(ka, kb)); if (r) return {what: 'sent', r};
  r = grow(paraBounds(ka, kb)); return r ? {what: 'para', r} : null;
}
function growSel(){
  if (!P || !tokens.length || !spans.length) return;
  if (selA == null){ const k = tokAtOut(outPos); if (k == null) return toast('Erst ein Wort markieren'); selA = selB = k; }
  const g = growStep(); if (!g) return toast('Der ganze Absatz ist schon markiert');
  selA = order[g.r[0]]; selB = order[g.r[1]]; showSel();
  if (spans[selA]) spans[selA].scrollIntoView({block: 'nearest', behavior: 'smooth'});
  if (!playing){ const t = tokens[selA]; seekOut(srcToOut(snapSrc(t.ws ?? t.s)), false); tlReveal(); }
}
$('#selSent').onclick = growSel;
function keepOnlySel(){
  const ids = new Set(selIds()); if (!ids.size) return;
  const rest = tokens.filter(t => !ids.has(t.i) && !deleted.has(t.i)).map(t => t.i);
  const bare = P.sources.map((x, k) => k).filter(k => !tokens.some(t => t.src === k) && !P.dels.some(d => d[0] <= P.sources[k].off + 0.01 && d[1] >= srcEnd(k) - 0.01));   // Videos ohne Transkript
  if (!rest.length && !bare.length) return toast('Außer der Markierung ist nichts mehr übrig');
  const nw = rest.filter(i => tokens[i].type === 'word').length, first = tokens[selIds()[0]];
  commit(() => { rest.forEach(i => deleted.add(i)); for (const k of bare) addDel(P.sources[k].off, srcEnd(k)); }, false);
  tokens.forEach(t => paint(t.i)); showSel(); paintFillerCount();
  if (playing) pausePlay(); seekOut(srcToOut(snapSrc(first.ws ?? first.s)), false); tlReveal();
  lastCut = outPos;
  toast(`Nur die Markierung bleibt (${fmtT(total)}) – ${nw} ${nw === 1 ? 'Wort' : 'Wörter'} gelöscht, Strg+Z macht es rückgängig`);
}
$('#selOnly').onclick = keepOnlySel;
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
async function newSpeaker(){ const v = await askPerson('Neue Person', {name: `Person ${P.speakers.length + 1}`}); if (!v) return null; const sp = {id:newId(), name: v.name, st:{}}; if (v.role) sp.role = v.role; if (v.lt) sp.lt = true; P.speakers.push(sp); return sp; }
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
      <div class="grid2 spk-lt">
        <label>Funktion <input type="text" class="sp-role" maxlength="80" dir="auto" placeholder="z. B. Sprecherin, Bündnis XY"></label>
        <label class="row" title="Name und Funktion erscheinen als Einblendung, sobald die Person im geschnittenen Video zum ersten Mal spricht"><input type="checkbox" class="sp-lt"> Bauchbinde beim ersten Auftritt</label>
      </div>
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
    q('.sp-role').value = sp.role || ''; q('.sp-lt').checked = !!sp.lt;
    const upd = fn => { commit(fn, false); styleOverlay(); renderSpeakers(); if (tab === 'text') renderTranscript(); lowerChanged(); };
    q('.sp-role').onchange = e => upd(() => { const v = e.target.value.replace(/\s+/g, ' ').trim(); if (v){ sp.role = v; if (sp.lt == null) sp.lt = true; } else delete sp.role; });
    q('.sp-lt').onchange = e => upd(() => { sp.lt = e.target.checked; });
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
  body.innerHTML = `<h3>Text korrigieren</h3><textarea id="rangeEdit" rows="3" dir="auto" style="width:100%;font:18px/1.4 var(--read)"></textarea>
    <p class="muted small">Am Schnitt ändert sich nichts. Gleiche Wortzahl: Wort für Wort ersetzt. Sonst wird der Text auf die Zeit der markierten Stellen verteilt –
    so lassen sich Wörter zusammenschreiben oder fehlende Wörter ergänzen (am besten die 🗣-Stelle mit markieren). Erscheint so auch in den Untertiteln.</p>
    <label class="row small${ids.filter(isWord).length >= 1 && ids.filter(isWord).length <= 4 ? '' : ' hidden'}"><input type="checkbox" id="rangeDict"> Künftig immer so schreiben (ins Wörterbuch)</label>
    <div class="row"><button class="btn" id="rangeReset">↺ Original</button><button class="btn primary" id="rangeOk" style="margin-left:auto">Fertig</button></div>`;
  $('#rangeEdit').value = cur; openSheet(false); setTimeout(() => { $('#rangeEdit').focus(); $('#rangeEdit').select(); }, 30);
  const done = reset => { const v = $('#rangeEdit').value, learn = !reset && $('#rangeDict').checked, orig = ids.filter(isWord).map(i => tokens[i].text).join(' '); let more = -1; closeSheet();
    commit(() => { if (reset) ids.forEach(i => delete P.edits[i]); else applyRangeText(ids, v); regenCuesFor(ids); if (learn) more = dictLearn(orig, v); }, false);
    afterTextEdit(reset ? 'Originaltext' : (learn && dictLearnMsg(more)) || 'Text übernommen'); clearSel(); };
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
// ── Füllwörter: Verzögerungslaute (äh, ähm …) und die eigene Liste (C3) ──
// Die eigene Liste gilt auf diesem Gerät für alle Projekte und lässt sich je Projekt abschalten (P.settings.ownFillers === false).
// Einträge können aus mehreren Wörtern bestehen („ich sag mal“); sie gelten über aufeinanderfolgende Wörter, Pausen dazwischen zählen nicht.
const OWN_FILL_KEY = 'hc-fillers';
const FILL_SUGGEST = ['halt', 'sozusagen', 'genau', 'quasi', 'irgendwie', 'eigentlich', 'gewissermaßen', 'ich sag mal', 'im Endeffekt', 'oder so'];
let ownFill = (() => { try { const v = JSON.parse(localStorage.getItem(OWN_FILL_KEY)); return Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()) : []; } catch(_){ return []; } })();
const fillKey = f => String(f).trim().split(/\s+/).map(norm).filter(Boolean).join(' ');
const ownFillOn = () => !!(P && P.settings.ownFillers !== false && ownFill.length);
function saveOwnFill(){ try { localStorage.setItem(OWN_FILL_KEY, JSON.stringify(ownFill)); } catch(_){} }
function fillerSet(){   // Nummern aller Wörter, die als Füllwort gelten
  const out = new Set(), ws = tokens.filter(t => t.type === 'word'), nw = ws.map(t => norm(tokText(t)));
  ws.forEach((t, k) => { if (FILLER.test(nw[k])) out.add(t.i); });
  if (!ownFillOn()) return out;
  const one = new Set(), many = [];
  for (const f of ownFill){ const key = fillKey(f), parts = key.split(' '); if (!key) continue; one.add(key); if (parts.length > 1) many.push(parts); }
  ws.forEach((t, k) => { if (nw[k] && one.has(nw[k])) out.add(t.i); });
  for (const parts of many) for (let k = 0; k + parts.length <= ws.length; k++){
    if (nw[k] !== parts[0]) continue; let ok = true;
    for (let j = 1; j < parts.length; j++) if (nw[k + j] !== parts[j] || ws[k + j].src !== ws[k].src){ ok = false; break; }
    if (ok) for (let j = 0; j < parts.length; j++) out.add(ws[k + j].i);
  }
  return out;
}
const fillerIds = (minTok = 0) => { const fs = fillerSet(); return tokens.filter(t => t.i >= minTok && t.type === 'word' && !deleted.has(t.i) && fs.has(t.i)).map(t => t.i); };
// Zähler am Knopf: Füllwörter, die noch im Schnitt stehen
function paintFillerCount(fs){ fs ||= fillerSet(); let n = 0; for (const i of fs) if (!deleted.has(i)) n++; $('#fillerBtn').textContent = `Füllwörter weg (${n})`; return n; }
// Markierung im Text nach einer Änderung der Liste
function paintFillers(){ const fs = fillerSet(); for (const t of tokens){ const sp = t.type === 'word' && spans[t.i]; if (sp) sp.classList.toggle('filler', fs.has(t.i)); } return paintFillerCount(fs); }
function openFillers(){
  const body = $('#sheetBody');
  body.innerHTML = `<h3>Eigene Füllwörter</h3>
    <p class="muted small">„Füllwörter weg“ entfernt immer Verzögerungslaute wie „äh“ und „ähm“. Hier ergänzt du Wörter und Wendungen, die zusätzlich verschwinden sollen. Die Liste gilt auf diesem Gerät für alle Projekte.</p>
    <div class="fw-list" id="fwList"></div>
    <div class="row"><input type="text" id="fwIn" maxlength="60" placeholder="Wort oder Wendung, z. B. sozusagen" autocomplete="off" style="flex:1;min-width:0"><button class="btn" id="fwAdd">Hinzufügen</button></div>
    <div class="fw-sugg" id="fwSugg"></div>
    <label class="row"><input type="checkbox" id="fwOn"> In diesem Projekt anwenden</label>
    <p class="muted small" id="fwInfo"></p>
    <div class="row" style="margin-top:12px"><button class="btn primary" id="fwOk" style="margin-left:auto">Fertig</button></div>`;
  const paintList = () => {
    $('#fwList').innerHTML = ownFill.length ? ownFill.map((f, k) => `<span class="fw-chip">${esc(f)}<button type="button" data-del="${k}" title="Entfernen">×</button></span>`).join('') : '<span class="muted small">Noch keine eigenen Füllwörter.</span>';
    const have = new Set(ownFill.map(fillKey)), sug = FILL_SUGGEST.filter(x => !have.has(fillKey(x)));
    $('#fwSugg').innerHTML = sug.length ? '<span class="muted small">Vorschläge</span>' + sug.map(x => `<button type="button" class="chip" data-add="${esc(x)}">＋ ${esc(x)}</button>`).join('') : '';
    $('#fwOn').checked = P.settings.ownFillers !== false; $('#fwOn').disabled = !ownFill.length;
    const n = spans.length ? paintFillers() : paintFillerCount();
    $('#fwInfo').textContent = !tokens.length ? '' : n ? `Im Text ${n === 1 ? 'steht noch 1 Füllwort' : `stehen noch ${n} Füllwörter`} – „Füllwörter weg“ entfernt ${n === 1 ? 'es' : 'sie'}.` : 'Im Text steht gerade kein Füllwort mehr.';
  };
  const add = v => { const key = fillKey(v); if (!key) return; if (ownFill.some(x => fillKey(x) === key)) return toast('Steht schon in der Liste'); if (FILLER.test(key)) return toast('Das wird ohnehin entfernt');
    ownFill.push(String(v).trim().replace(/\s+/g, ' ').slice(0, 60)); saveOwnFill(); paintList(); };
  $('#fwAdd').onclick = () => { add($('#fwIn').value); $('#fwIn').value = ''; $('#fwIn').focus(); };
  $('#fwIn').onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter'){ e.preventDefault(); $('#fwAdd').click(); } };
  $('#fwOn').onchange = e => { P.settings.ownFillers = e.target.checked; changed(false); paintList(); };
  $('#fwOk').onclick = closeSheet;
  body.onclick = e => { const d = e.target.closest('[data-del]'), a = e.target.closest('[data-add]');
    if (d){ ownFill.splice(+d.dataset.del, 1); saveOwnFill(); paintList(); } else if (a) add(a.dataset.add); };
  sheetItem = null; paintList(); openSheet(false);
}
$('#fillerCfg').onclick = () => { if (P) openFillers(); };
function bulkDelete(ids){ ids.forEach(i => deleted.add(i)); tidyPauses(ids).forEach(i => deleted.add(i)); }
$('#fillerBtn').onclick = () => {
  const ids = fillerIds(0);
  if (!ids.length) return toast('Keine Füllwörter übrig');
  commit(() => cleanRun('f', () => bulkDelete(ids)), false); tokens.forEach(t => paint(t.i)); paintFillerCount(); chkChanged();
  toast(`${ids.length} Füllwörter entfernt · die Prüfliste zeigt jeden Schnitt`);
};
// Pausen kürzen (0 = ganz löschen)
function trimPauses(len, minTok = 0){
  const ids = tokens.filter(t => t.i >= minTok && t.type === 'pause' && !deleted.has(t.i) && t.e - t.s > len + 0.05 && (P.trims[t.i] == null || P.trims[t.i] > len)).map(t => t.i);
  ids.forEach(i => { if (len <= 0) deleted.add(i); else P.trims[i] = len; });
  return ids.length;
}
$('#pauseBtn').onclick = () => {
  const len = +$('#pauseLen').value; let n = 0;
  commit(() => n = cleanRun('p', () => trimPauses(len)), false); tokens.forEach(t => paint(t.i)); chkChanged();
  toast(n ? (len ? `${n} Pausen auf ${String(len).replace('.', ',')} s gekürzt` : `${n} Pausen gelöscht`) + ' · die Prüfliste zeigt jeden Schnitt' : 'Keine Pausen zu kürzen');
};
// Wiederholte Anläufe finden: „Ich wollte – ich wollte heute …“ → der frühere Anlauf wird gelöscht, der letzte bleibt.
const KEEP_REPEAT = new Set(['sehr','ganz','so','ja','nein','nee','immer','mehr','viel','gut','nie','wieder','nochmal','hallo','hey','bitte','danke','okay','ok',
  'der','die','das','den','dem','des','was','wer','sie','es','wir','ihr','er','man','dass','da','hier','jetzt','gerade','auch','noch','schon','mal']);
// Rückgabe: {ids: alles, was als Anlauf wegfällt, groups: [{v: [[a, b], …], s}]}. v nennt die Fassungen einer Wiederholung als
// Bereiche von Wortnummern, die letzte ist die, die stehen bleibt; s kennzeichnet ganze Sätze (C5: Fassungen vergleichen).
function repeatFinds(minTok = 0){
  const ws = tokens.filter(t => t.i >= minTok && t.type === 'word' && !deleted.has(t.i) && tokText(t) && !isSrcDeleted((t.ws + t.we) / 2));
  const out = new Set(), groups = [];
  for (const g of repeatGroups(ws, t => tokText(t), (i, j) => ws[i].src === ws[j].src && ws[j].ws - ws[i].ws <= 30)){
    const from = ws[g.att[0][0]].i, to = ws[g.fin[0]].i;
    for (let i = from; i < to; i++) if (tokens[i].type !== 'pause' && !deleted.has(i)) out.add(i);
    // Die letzte Fassung: bei einem abgebrochenen Anlauf die wiederholten Wörter; war der Anlauf ein ganzer Satz, dann der ganze Satz
    let fe = Math.min(g.fin[1], ws.length - 1), la = g.att[g.att.length - 1][1]; while (la > g.att[g.att.length - 1][0] && FILLER.test(norm(tokText(ws[la])))) la--;
    const full = sentEnd(tokText(ws[la]));
    if (full) for (let q = g.fin[0]; q < ws.length && ws[q].src === ws[g.fin[0]].src && ws[q].ws - ws[g.fin[0]].ws <= 25; q++){ fe = q; if (sentEnd(tokText(ws[q]))) break; }
    groups.push({v: g.att.map(([x], k) => [ws[x].i, (k + 1 < g.att.length ? ws[g.att[k + 1][0]].i : to) - 1]).concat([[to, ws[fe].i]]), ...(full ? {s: 1} : {})});
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
        const last = groups[groups.length - 1], vb = [B[0].i, B[B.length - 1].i];
        if (last && last.s && last.v[last.v.length - 1][0] === A[0].i){ last.v[last.v.length - 1][1] = B[0].i - 1; last.v.push(vb); }   // dritter Anlauf desselben Satzes
        else groups.push({s: 1, v: [[A[0].i, B[0].i - 1], vb]});
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
  return {ids: [...out], groups};
}
const findRepeats = (minTok = 0) => repeatFinds(minTok).ids;
$('#repeatBtn').onclick = () => {
  const f = repeatFinds(0), ids = f.ids; if (!ids.length) return toast('Keine Wiederholungen gefunden');
  commit(() => cleanRun('r', () => { bulkDelete(ids); return f; }), false); tokens.forEach(t => paint(t.i)); chkChanged();
  const nu = ids.filter(i => tokens[i].type === 'unk').length;
  toast(`${ids.filter(isWord).length} Wörter${nu ? ` und ${nu} nicht erkannte Stellen (🗣)` : ''} aus wiederholten Anläufen gelöscht · in der Prüfliste lässt sich je Stelle die beste Fassung wählen`);
};
// ───────── Hörprobe ─────────
// Eine Stelle der Aufnahme anhören, wie sie aufgenommen wurde – auch wenn sie weggeschnitten ist. Das läuft über ein eigenes
// Tonelement neben der Vorschau: Schnitt und Abspiellinie bleiben, wo sie sind.
const AUD = {el: null, list: [], k: -1, run: 0, t: 0, on: null, url: ''};
const srcPlayUrl = s => s.proxy ? (TS.mediaUrl ? MEDIA(s.proxy) : 'media?f=' + encodeURIComponent(s.proxy)) : MEDIA(s.uri);
const sec1 = x => (Math.round(x * 10) / 10).toFixed(1).replace('.', ',');
function audStop(){
  clearTimeout(AUD.t); AUD.run++; if (AUD.el) AUD.el.pause();
  const on = AUD.on, was = AUD.k; AUD.list = []; AUD.k = -1; AUD.on = null; if (on && was >= 0) on(-1);
}
function audPlay(list, on){   // list: [[a, b], …] in Quellzeit, nacheinander mit kurzer Pause; on(k) nennt die laufende Stelle, on(-1) das Ende
  audStop(); if (playing) pausePlay(); if (!P || !list.length) return;
  if (!AUD.el){ AUD.el = document.createElement('audio'); AUD.el.preload = 'auto'; }
  AUD.list = list; AUD.on = on || null; audStep(0, AUD.run);
}
function audStep(k, run){
  if (run !== AUD.run) return; if (k >= AUD.list.length) return audStop();
  const el = AUD.el, [a, b] = AUD.list[k], s = P.sources[srcAt(a + 1e-3)], url = srcPlayUrl(s);
  const la = clamp(a - s.off, 0, s.duration), lb = clamp(b - s.off, la + 0.05, s.duration);
  AUD.k = k; if (AUD.on) AUD.on(k);
  const watch = () => { if (run !== AUD.run) return;
    if (el.currentTime >= lb - 0.01 || el.ended || el.error){ el.pause(); AUD.t = setTimeout(() => audStep(k + 1, run), 350); return; }
    AUD.t = setTimeout(watch, 30); };
  const go = () => { if (run !== AUD.run) return; try { el.currentTime = la; } catch(_){} el.volume = clamp(s.vol ?? 1, 0, 1);
    el.play().then(watch, () => { if (run === AUD.run){ audStop(); toast('Diese Stelle ließ sich aus der Aufnahme nicht abspielen'); } }); };
  if (AUD.url !== url){ AUD.url = url; el.src = url; el.addEventListener('loadedmetadata', go, {once: true}); el.load(); } else go();
}

// ───────── Prüfliste nach dem Aufräumen (A5) und Fassungen vergleichen (C5) ─────────
// Jeder Schnitt, den „Füllwörter weg“, „Wiederholungen weg“ und „Pausen kürzen“ setzen, steht in P.checks:
//   {id, k: 'f' | 'r' | 'p', ids: [Nummern der Wörter und Pausen, die der Schnitt entfernt hat], tr: [[Pause, Länge vorher, Länge danach]],
//    v: [[a, b], …] die Fassungen einer Wiederholung als Bereiche von Wortnummern, s: ganze Sätze}
// Ob ein Eintrag gerade geschnitten ist, ergibt sich aus dem Schnitt selbst (deleted, P.trims). So stimmt die Liste auch nach
// „Rückgängig“ und nach Änderungen von Hand.
const chkAll = () => (P && P.checks) || [];
const CHK_NAME = {f: 'Füllwörter', r: 'Wiederholungen', p: 'Pausen'};
const chkSpan = c => { let a = Infinity, b = -1; const see = i => { if (i < a) a = i; if (i > b) b = i; };
  c.ids.forEach(see); (c.tr || []).forEach(x => see(x[0])); (c.v || []).forEach(r => { see(r[0]); see(r[1]); }); return [a, b]; };
// Neu Gelöschtes als zusammenhängende Schnitte: Zwischen zwei Nummern eines Schnitts liegt nur, was schon vorher gelöscht war
function cutRuns(before){
  const add = [...deleted].filter(i => !before.has(i)).sort((a, b) => a - b), runs = [];
  for (const i of add){ const r = runs[runs.length - 1]; let join = !!r;
    if (r) for (let j = r[r.length - 1] + 1; j < i; j++) if (!before.has(j)){ join = false; break; }
    if (join) r.push(i); else runs.push([i]); }
  return runs;
}
function chkNote(k, before, tr0, groups){
  const add = [], runs = cutRuns(before), mk = o => ({id: newId(), k, ...o});
  if (k === 'r' && groups && groups.length){
    const sp = groups.map(g => [g.v[0][0], g.v[g.v.length - 1][1]]), got = groups.map(() => []), single = [];
    for (const run of runs){ const loose = [];
      for (const i of run){ const q = sp.findIndex(([a, b]) => i >= a && i <= b); if (q < 0) loose.push(i); else got[q].push(i); }
      if (!loose.length) continue;
      // Pausen am Rand einer Wiederholung gehören zu ihr; alles andere ist ein eigener Schnitt (nicht erkannte Stellen)
      const q = sp.findIndex(([a, b]) => run.some(i => i >= a && i <= b));
      if (q >= 0 && loose.every(i => tokens[i].type === 'pause')) got[q].push(...loose); else single.push(loose);
    }
    groups.forEach((g, q) => { if (got[q].length) add.push(mk({ids: got[q].sort((x, y) => x - y), v: g.v, ...(g.s ? {s: 1} : {})})); });
    single.forEach(ids => add.push(mk({ids})));
  } else runs.forEach(ids => add.push(mk({ids})));
  for (const i of Object.keys(P.trims)) if (P.trims[i] !== tr0[i] && !deleted.has(+i)) add.push(mk({ids: [], tr: [[+i, tr0[i] ?? null, P.trims[i]]]}));
  if (add.length) chkMerge(add);
  return add.length;
}
// Neue Einträge aufnehmen; ältere Einträge derselben Art an derselben Stelle fallen weg
function chkMerge(add){
  const hit = new Set(add.flatMap(c => c.ids.concat((c.tr || []).map(x => x[0])))), sp = add.map(c => [c.k, ...chkSpan(c)]);
  P.checks = chkAll().filter(c => { if (c.ids.some(i => hit.has(i)) || (c.tr || []).some(x => hit.has(x[0]))) return false;
    const [a, b] = chkSpan(c); return !sp.some(([k, x, y]) => k === c.k && a <= y && b >= x); }).concat(add);
  if (P.checks.length > 3000) P.checks = P.checks.slice(-3000);
}
// Aufräumen ausführen und jeden Schnitt in die Prüfliste schreiben. fn liefert bei Wiederholungen die gefundenen Fassungen mit.
function cleanRun(k, fn){ const before = new Set(deleted), tr0 = {...P.trims}, res = fn(); chkNote(k, before, tr0, res && res.groups); return res; }

const varToks = r => { const o = []; for (let i = r[0]; i <= r[1] && i < tokens.length; i++) if (tokens[i].type !== 'pause') o.push(i); return o; };
const chkKept = c => (c.v || []).map((r, j) => varToks(r).some(i => !isCut(i)) ? j : -1).filter(j => j >= 0);
function chkState(c){   // 'cut' geschnitten · 'back' steht wieder ganz im Schnitt · 'part' teils · 'gone' keine Fassung steht mehr
  if (c.v){ const n = chkKept(c).length; return n === c.v.length ? 'back' : n === 1 ? 'cut' : n ? 'part' : 'gone'; }
  let n = 0, m = 0; for (const i of c.ids){ m++; if (deleted.has(i)) n++; }
  for (const [i, , len] of c.tr || []){ m++; if (!deleted.has(i) && P.trims[i] === len) n++; }
  return n === m ? 'cut' : n ? 'part' : 'back';
}
const chkAt = c => { const [a] = chkSpan(c); return tokens[a] ? wS(tokens[a]) : 0; };
const chkEnd = c => { const [, b] = chkSpan(c); return tokens[b] ? wE(tokens[b]) : 0; };
const chkDur = c => c.tr && c.tr.length ? c.tr.reduce((n, [i, old, len]) => n + ((old ?? (tokens[i].e - tokens[i].s)) - len), 0)
  : c.ids.reduce((n, i) => n + (tokens[i].type === 'pause' ? tokens[i].e - tokens[i].s : wE(tokens[i]) - wS(tokens[i])), 0);
const idsText = ids => ids.filter(i => isTextTok(i)).map(i => tokText(tokens[i])).filter(Boolean).join(' ');
// Bis zu n Wörter vor (dir −1) oder nach (dir 1) der Nummer i, so wie sie im Schnitt stehen
function ctxText(i, dir, n){
  const out = [], si = tokens[i] ? tokens[i].src : -1;
  for (let j = i + dir; j >= 0 && j < tokens.length && tokens[j].src === si && out.length < n; j += dir){ if (!isTextTok(j) || isCut(j)) continue; const tx = tokText(tokens[j]); if (tx) out.push(tx); }
  return (dir < 0 ? out.reverse() : out).join(' ');
}
function chkLabel(c){
  if (c.tr && c.tr.length){ const [i, old, len] = c.tr[0], t = tokens[i]; return `Pause ${sec1(old ?? (t.e - t.s))} s → ${sec1(len)} s`; }
  const tx = idsText(c.ids); if (tx) return tx;
  const unk = c.ids.filter(i => tokens[i].type === 'unk');
  return unk.length ? `nicht erkannte Stelle (${sec1(unk.reduce((n, i) => n + wE(tokens[i]) - wS(tokens[i]), 0))} s)` : `Pause ${sec1(chkDur(c))} s`;
}
// Bei einem angefangenen Satz geht die letzte Fassung nach den wiederholten Wörtern weiter: der Rest des Satzes zum Mitlesen und Mithören
function varTail(c){
  if (c.s) return []; const b = c.v[c.v.length - 1][1], out = [], si = tokens[b].src; if (sentEnd(tokText(tokens[b]))) return out;
  for (let i = b + 1; i < tokens.length && tokens[i].src === si && wE(tokens[i]) - wE(tokens[b]) < 8; i++){
    if (!isTextTok(i) || isCut(i)) continue; out.push(i); if (sentEnd(tokText(tokens[i]))) break; }
  return out;
}
function varRange(c, j){   // Quellzeit einer Fassung zum Anhören
  const ids = varToks(c.v[j]).filter(i => tokText(tokens[i]) || tokens[i].type === 'unk'); if (!ids.length) return null;
  const end = j === c.v.length - 1 ? varTail(c) : [], last = end.length ? end[end.length - 1] : ids[ids.length - 1], s = P.sources[tokens[ids[0]].src];
  return [Math.max(s.off, wS(tokens[ids[0]]) - 0.12), Math.min(s.off + s.duration, wE(tokens[last]) + 0.2)];
}
function chkUndo(c){   // Schnitt zurücknehmen: Was dieser Eintrag entfernt hat, steht wieder im Schnitt
  commit(() => { for (const i of c.ids) if (deleted.has(i)){ deleted.delete(i); removeDel(tokens[i].s, tokens[i].e); }
    for (const [i, old] of c.tr || []){ if (old == null) delete P.trims[i]; else P.trims[i] = old; } }, false);
  chkAfter();
}
function chkRedo(c){
  if (c.v) return chkPick(c, c.v.length - 1);
  commit(() => { c.ids.forEach(i => deleted.add(i)); for (const [i, , len] of c.tr || []) P.trims[i] = len; }, false);
  chkAfter();
}
function chkPick(c, k){   // Fassung k bleibt stehen, die anderen fallen weg
  commit(() => {
    const own = new Set(c.ids), add = [];
    c.v.forEach((r, j) => { for (const i of varToks(r)){
      if (j === k){ if (own.has(i) && deleted.has(i)){ deleted.delete(i); removeDel(tokens[i].s, tokens[i].e); } }
      else if (!deleted.has(i)){ deleted.add(i); add.push(i); } } });
    for (let i = c.v[k][0]; i <= c.v[k][1]; i++) if (tokens[i].type === 'pause' && own.has(i)) deleted.delete(i);   // Pausen in der Fassung, die bleibt
    const gone = [...new Set(c.ids.concat(add))].filter(i => deleted.has(i)), extra = tidyPauses(gone);
    extra.forEach(i => deleted.add(i));
    c.ids = [...new Set(c.ids.concat(add, extra))].sort((x, y) => x - y);
  }, false);
  chkAfter();
}
function chkAfter(){ audStop(); if (spans.length){ tokens.forEach(t => paint(t.i)); paintFillerCount(); } chkChanged(); }
function paintChkBtn(){ const n = chkAll().length, b = $('#checkBtn'); if (!b) return; b.classList.toggle('hidden', !n); b.textContent = `Prüfliste (${n})`; }
function chkChanged(){ paintChkBtn(); if (chkSheetOpen()) renderChecks(); }

// ── Die Liste: bleibt offen, während man anhört und entscheidet ──
const chkSheetOpen = () => !$('#sheet').classList.contains('hidden') && !!$('#ckSheet');
let chkTab = 'f', chkMax = 60; const chkHeard = new Set();
function chkJump(c){
  const [a] = chkSpan(c); audStop(); if (playing) pausePlay();
  seekOut(Math.min(srcToOut(snapSrc(chkAt(c))), Math.max(0, total - 0.01)), false); tlReveal();
  if (tab === 'text' && spans[a]) spans[a].scrollIntoView({block: 'center', behavior: 'smooth'});
}
function chkPlayCut(c){   // so klingt die Stelle im Schnitt
  audStop(); if (playing) pausePlay();
  const a = srcToOut(snapSrc(chkAt(c))), b = srcToOut(snapSrc(chkEnd(c)));
  seekOut(Math.max(0, a - 1.5), false); startPlay(); stopAt = Math.min(total, Math.max(a, b) + 1.5); tlReveal();
}
function chkPlayOrig(c, rowEl){   // so wurde die Stelle aufgenommen
  const [a] = chkSpan(c), s = P.sources[tokens[a].src];
  audPlay([[Math.max(s.off, chkAt(c) - 1.2), Math.min(s.off + s.duration, chkEnd(c) + 1.2)]], k => rowEl.classList.toggle('playing', k >= 0));
}
function chkPlayVars(c, js, rowEl){
  const list = js.map(j => ({j, r: varRange(c, j)})).filter(x => x.r);
  audPlay(list.map(x => x.r), k => { for (const el of rowEl.querySelectorAll('.ck-var')) el.classList.toggle('playing', k >= 0 && +el.dataset.j === list[k].j); });
}
function chkRow({c, at, st}){
  const t = `<span class="mono">${fmtT(srcToOut(snapSrc(at)))}</span>`, heard = chkHeard.has(c.id) ? ' heard' : '';
  if (c.v){
    const kp = chkKept(c), one = kp.length === 1 ? kp[0] : -1, tail = idsText(varTail(c));
    const vars = c.v.map((r, j) => `<div class="ck-var${j === one ? ' kept' : ''}" data-j="${j}"><label><input type="radio" name="ck-${c.id}" value="${j}"${j === one ? ' checked' : ''}><span class="ck-n">${j + 1}</span><span class="ck-vt" dir="auto">${esc(idsText(varToks(r))) || 'ohne erkannten Text'}${j === c.v.length - 1 && tail ? ` <em>${esc(tail)}</em>` : ''}</span></label><button type="button" class="mini" data-a="var" title="Diese Fassung anhören">▶</button></div>`).join('');
    const note = st === 'back' ? 'Alle Fassungen stehen im Schnitt. Wähle die beste aus.' : st === 'gone' ? 'Keine Fassung steht mehr im Schnitt.' : st === 'part' ? 'Mehrere Fassungen stehen im Schnitt.' : '';
    return `<div class="ck-row var${heard}" data-id="${c.id}"><button type="button" class="ck-go" title="Zur Stelle springen">${t}<span class="ck-t">${c.s ? 'Satz' : 'Anlauf'} in ${c.v.length} Fassungen</span></button>
      <div class="ck-vars">${vars}</div>${note ? `<p class="muted small ck-note">${note}</p>` : ''}
      <div class="ck-acts"><button type="button" class="btn small" data-a="seq">▶ Nacheinander anhören</button>${st !== 'back' ? '<button type="button" class="btn small ghost" data-a="tog">Alle behalten</button>' : ''}</div></div>`;
  }
  const [a, b] = chkSpan(c), back = st === 'back', tag = back ? 'b' : 's';
  return `<div class="ck-row${back ? ' back' : ''}${heard}" data-id="${c.id}"><button type="button" class="ck-go" title="Zur Stelle springen">${t}<span class="ck-t" dir="auto">${esc(ctxText(a, -1, 3))} <${tag}>${esc(chkLabel(c))}</${tag}> ${esc(ctxText(b, 1, 3))}</span></button>
    <div class="ck-acts"><button type="button" class="btn small" data-a="cut" title="So klingt die Stelle jetzt">▶ ${back ? 'Stelle' : 'Schnitt'}</button>${back ? '' : '<button type="button" class="btn small" data-a="orig" title="So wurde die Stelle aufgenommen">▶ Original</button>'}<button type="button" class="btn small ghost" data-a="tog">${back ? 'Wieder schneiden' : 'Zurücknehmen'}</button></div></div>`;
}
function renderChecks(){
  const box = $('#ckSheet'); if (!box) return;
  const by = {f: [], r: [], p: []}; for (const c of chkAll()) (by[c.k] || by.f).push(c);
  if (!by[chkTab].length) chkTab = ['f', 'r', 'p'].find(k => by[k].length) || chkTab;
  const list = by[chkTab].map(c => ({c, at: chkAt(c), st: chkState(c)}));
  if (chkTab === 'p') list.sort((x, y) => chkDur(y.c) - chkDur(x.c) || x.at - y.at); else list.sort((x, y) => x.at - y.at);
  const shown = list.slice(0, chkMax), top = $('#sheet').scrollTop;
  box.innerHTML = `<h3>Prüfliste nach dem Aufräumen</h3>
    <p class="muted small">Jeder automatische Schnitt zum Anhören. „Schnitt“ spielt die Stelle, wie sie jetzt klingt, „Original“ spielt die Aufnahme. Bei Wiederholungen wählst du, welche Fassung bleibt.</p>
    <div class="seg-ctl small ck-tabs">${['f', 'r', 'p'].map(k => `<button type="button" data-tab="${k}"${k === chkTab ? ' class="on"' : ''}>${CHK_NAME[k]} (${by[k].length})</button>`).join('')}</div>
    ${chkTab === 'p' && list.length > 1 ? '<p class="muted small">Die längsten Pausen stehen oben.</p>' : ''}
    <div class="ck-list">${shown.map(chkRow).join('') || `<p class="muted small">Keine Einträge. Sie entstehen, sobald „${chkTab === 'f' ? 'Füllwörter weg' : chkTab === 'r' ? 'Wiederholungen weg' : 'Pausen kürzen'}“ etwas schneidet.</p>`}</div>
    ${list.length > shown.length ? `<div class="row"><button type="button" class="btn small" data-a="more">Weitere ${Math.min(60, list.length - shown.length)} anzeigen</button></div>` : ''}
    <div class="row wrap" style="margin-top:12px">${list.some(x => x.st !== 'back') ? '<button type="button" class="btn small" data-a="undoall" title="Alle Schnitte dieser Art zurücknehmen">Alle zurücknehmen</button>' : ''}${list.length ? '<button type="button" class="btn small ghost" data-a="clear" title="Die Einträge dieser Art aus der Liste nehmen; die Schnitte bleiben, wie sie sind">Liste leeren</button>' : ''}<button type="button" class="btn primary" data-a="ok" style="margin-left:auto">Fertig</button></div>`;
  $('#sheet').scrollTop = top;
}
function openChecks(k){
  if (!P) return; sheetItem = null; if (k) chkTab = k; chkMax = 60;
  const body = $('#sheetBody'); body.innerHTML = '<div id="ckSheet"></div>';
  body.onclick = e => {
    const tb = e.target.closest('[data-tab]'); if (tb){ chkTab = tb.dataset.tab; chkMax = 60; audStop(); return renderChecks(); }
    const a = e.target.closest('[data-a]'), act = a ? a.dataset.a : '', rowEl = e.target.closest('.ck-row'), c = rowEl && chkAll().find(x => x.id === rowEl.dataset.id);
    if (act === 'ok') return closeSheet();
    if (act === 'more'){ chkMax += 60; return renderChecks(); }
    if (act === 'clear'){ audStop(); P.checks = chkAll().filter(x => x.k !== chkTab); changed(false); return chkChanged(); }
    if (act === 'undoall'){ const list = chkAll().filter(x => x.k === chkTab);
      commit(() => { for (const x of list){ for (const i of x.ids) if (deleted.has(i)){ deleted.delete(i); removeDel(tokens[i].s, tokens[i].e); }
        for (const [i, old] of x.tr || []){ if (old == null) delete P.trims[i]; else P.trims[i] = old; } } }, false);
      toast(`${CHK_NAME[chkTab]}: alle Schnitte zurückgenommen`); return chkAfter(); }
    if (!c) return;
    const heard = () => { chkHeard.add(c.id); rowEl.classList.add('heard'); };
    if (e.target.closest('.ck-go')) return chkJump(c);
    if (act === 'cut'){ heard(); return chkPlayCut(c); }
    if (act === 'orig'){ heard(); return chkPlayOrig(c, rowEl); }
    if (act === 'var'){ heard(); return chkPlayVars(c, [+e.target.closest('.ck-var').dataset.j], rowEl); }
    if (act === 'seq'){ heard(); return chkPlayVars(c, c.v.map((_, j) => j), rowEl); }
    if (act === 'tog') return c.v || chkState(c) !== 'back' ? chkUndo(c) : chkRedo(c);
  };
  body.onchange = e => { const r = e.target.closest('.ck-var input[type=radio]'), rowEl = r && r.closest('.ck-row'), c = rowEl && chkAll().find(x => x.id === rowEl.dataset.id); if (c) chkPick(c, +r.value); };
  sheetOnClose = () => { audStop(); body.onchange = null; };
  renderChecks(); openSheet(true);
}
$('#checkBtn').onclick = () => openChecks();
// Fassungen vergleichen, ehe etwas geschnitten ist: Die gefundenen Wiederholungen kommen ungeschnitten in die Liste
$('#repeatCmp').onclick = () => {
  if (!P || !tokens.length) return toast('Noch kein Transkript');
  const have = chkAll().filter(c => c.k === 'r' && c.v);
  const add = repeatFinds(0).groups.filter(g => !have.some(c => c.v[0][0] === g.v[0][0])).map(g => ({id: newId(), k: 'r', ids: [], v: g.v, ...(g.s ? {s: 1} : {})}));
  if (!add.length && !have.length) return toast('Keine wiederholten Anläufe gefunden');
  if (add.length){ P.checks = chkAll().concat(add); changed(false); }
  paintChkBtn(); openChecks('r');
};

// ───────── Eigenes Wörterbuch (C1) ─────────
// Namen und Fachbegriffe, die Whisper oft falsch schreibt: [{t: 'Hermeier', w: ['Hermeyer', 'Her Meier']}]. Die Liste gilt auf diesem
// Gerät für alle Projekte (wie die eigenen Füllwörter) und lässt sich je Projekt abschalten (P.settings.dict === false).
// Sie wirkt zweifach: Die Begriffe gehen als Hinweis an Whisper (wo die Plattform das anbietet, TS.setAsrHint), und nach jeder
// Transkription ersetzt HoneyCut die hinterlegten Fehlschreibungen. Jede Ersetzung ist eine Korrektur (P.edits): im Text sichtbar
// und über „Original“ zurückzuholen.
const DICT_KEY = 'hc-dict', DICT_HINT_MAX = 400, DICT_EDGE = /^[„“"'‚‘(«»]+|[.,!?;:…"“”’')»«]+$/g;
const dictClean = s => String(s).replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
const dictKey = s => String(s).trim().split(/\s+/).map(norm).filter(Boolean).join(' ');
let dict = (() => { try { const v = JSON.parse(localStorage.getItem(DICT_KEY));
  return Array.isArray(v) ? v.filter(x => x && typeof x.t === 'string' && dictKey(x.t)).map(x => ({t: dictClean(x.t), w: (Array.isArray(x.w) ? x.w : []).filter(y => typeof y === 'string' && dictKey(y)).map(dictClean)})) : []; } catch(_){ return []; } })();
function saveDict(){ try { localStorage.setItem(DICT_KEY, JSON.stringify(dict)); } catch(_){} }
const dictOn = () => !!(P && P.settings.dict !== false && dict.length);
const dictHas = t => dict.find(x => dictKey(x.t) === dictKey(t));
function dictAdd(term, wrong){   // Eintrag anlegen oder um Fehlschreibungen ergänzen; Rückgabe: ob sich etwas geändert hat
  term = dictClean(term); if (!dictKey(term)) return false;
  let e = dictHas(term), ch = false;
  if (!e){ if (dict.length >= 300) return false; e = {t: term, w: []}; dict.push(e); ch = true; }
  for (let w of wrong || []){ w = dictClean(w); if (!dictKey(w) || w === e.t || e.w.length >= 12 || e.w.some(y => dictKey(y) === dictKey(w))) continue; e.w.push(w); ch = true; }
  if (ch) saveDict(); return ch;
}
function mergeDict(list){ let n = 0; for (const x of Array.isArray(list) ? list : []) if (x && typeof x.t === 'string' && dictAdd(x.t, Array.isArray(x.w) ? x.w.filter(y => typeof y === 'string') : [])) n++; return n; }
// Begriffe als Hinweis für Whisper. Der Platz ist knapp (Whisper liest höchstens rund 220 Wortteile mit), deshalb höchstens
// DICT_HINT_MAX Zeichen: die Begriffe in der Reihenfolge der Liste.
function dictHintList(){ const out = []; let n = 0; if (!dictOn()) return out; for (const e of dict){ if (n + e.t.length + 2 > DICT_HINT_MAX) break; out.push(e.t); n += e.t.length + 2; } return out; }
const dictHint = () => dictHintList().join(', ');
// Schreibweisen, die ersetzt werden: jede hinterlegte Fehlschreibung, dazu der Begriff selbst, wenn er Großbuchstaben im Wort
// trägt („AFD“ → „AfD“). Bei gewöhnlich geschriebenen Begriffen bleibt die Groß- und Kleinschreibung im Text, wie sie ist:
// „die linke Hand“ soll kein Parteiname werden.
function dictPats(list){
  const pats = [];
  for (const e of list){ const tk = dictKey(e.t); if (!tk) continue;
    if (/\p{Ll}\p{Lu}|\p{Lu}{2}/u.test(e.t)) pats.push([tk.split(' '), e.t]);
    for (const w of e.w){ const k = dictKey(w); if (k) pats.push([k.split(' '), e.t]); } }
  return pats.sort((a, b) => b[0].length - a[0].length);
}
// Fehlschreibungen im Text ersetzen. only: nur diese Einträge · dry: nur zählen. Rückgabe: Zahl der Stellen
function dictApply(minTok = 0, only, dry){
  if (!P || !tokens.length || (!only && !dictOn())) return 0;
  const ws = tokens.filter(t => t.i >= minTok && t.type === 'word'), nw = ws.map(t => norm(tokText(t))), used = new Set(); let n = 0;
  for (const [parts, term] of dictPats(only || dict)) for (let k = 0; k + parts.length <= ws.length; k++){
    let ok = true, gen = false;
    for (let j = 0; j < parts.length && ok; j++){ const x = nw[k + j];
      if (used.has(k + j) || ws[k + j].src !== ws[k].src) ok = false;
      else if (x === parts[j]) continue;
      else if (j === parts.length - 1 && x === parts[j] + 's') gen = true;   // Genitiv: „Hermeyers“ wird „Hermeiers“
      else ok = false; }
    if (!ok) continue;
    const idx = ws.slice(k, k + parts.length).map(t => t.i), cur = idx.map(i => tokText(tokens[i])).join(' ');
    const lead = (cur.match(/^[„“"'‚‘(«»]+/) || [''])[0], tail = (cur.match(/[.,!?;:…"“”’')»«]+$/) || [''])[0], want = lead + term + (gen ? 's' : '') + tail;
    for (let j = 0; j < parts.length; j++) used.add(k + j);
    if (cur === want) continue;
    n++; if (dry) continue;
    const words = want.split(' ');   // gleiche Wortzahl: Wort für Wort; sonst steht der Begriff am ersten Wort
    idx.forEach((i, q) => { const v = words.length === idx.length ? words[q] : (q === 0 ? want : ''); if (v === tokens[i].text) delete P.edits[i]; else P.edits[i] = v; });
  }
  return n;
}
// Eine Korrektur merken: Aus „Hermeyer“ → „Hermeier“ wird ein Eintrag, der gleich im ganzen Text gilt. Rückgabe: weitere Stellen
function dictLearn(oldText, newText){
  const strip = s => String(s).replace(/\s+/g, ' ').trim().replace(DICT_EDGE, ''), t = strip(newText), w = strip(oldText);
  if (!dictKey(t) || !dictKey(w) || t === w) return -1;
  dictAdd(t, [w]); const e = dictHas(t); paintDictInfo(); return e ? dictApply(0, [e]) : 0;
}
const dictLearnMsg = n => n < 0 ? '' : n ? `Im Wörterbuch gemerkt · ${n === 1 ? 'eine weitere Stelle' : n + ' weitere Stellen'} korrigiert` : 'Im Wörterbuch gemerkt';
function paintDictInfo(){ const el = $('#dictInfo'); if (el) el.textContent = dict.length ? (dict.length === 1 ? '1 Begriff' : `${dict.length} Begriffe`) + (P && P.settings.dict === false ? ' · in diesem Projekt aus' : '') : 'noch leer'; }
function openDict(){
  if (!P) return; const body = $('#sheetBody'), hint = !!TS.setAsrHint;
  body.innerHTML = `<h3>Eigenes Wörterbuch</h3>
    <p class="muted small">Namen und Fachbegriffe, die Whisper oft falsch schreibt. ${hint ? 'Die Begriffe gehen bei der Transkription als Hinweis an Whisper, und hinterlegte Fehlschreibungen ersetzt HoneyCut danach von selbst.' : 'Hinterlegte Fehlschreibungen ersetzt HoneyCut nach jeder Transkription von selbst.'} Die Liste gilt auf diesem Gerät für alle Projekte.</p>
    <div class="dc-list" id="dcList"></div>
    <div class="dc-add"><input type="text" id="dcTerm" maxlength="60" placeholder="Richtig, z. B. Hermeier" autocomplete="off" autocapitalize="off" spellcheck="false" dir="auto"><input type="text" id="dcWrong" maxlength="240" placeholder="Falsch gehört als, z. B. Hermeyer, Her Meier" autocomplete="off" autocapitalize="off" spellcheck="false" dir="auto"><button class="btn" id="dcAdd">Hinzufügen</button></div>
    <label class="row"><input type="checkbox" id="dcOn"> In diesem Projekt anwenden</label>
    <p class="muted small" id="dcInfo"></p>
    <div class="row" style="margin-top:12px"><button class="btn" id="dcRun">Jetzt im Text ersetzen</button><button class="btn primary" id="dcOk" style="margin-left:auto">Fertig</button></div>`;
  const paintList = () => {
    $('#dcList').innerHTML = dict.length ? dict.map((e, k) => `<div class="dc-row"><button type="button" class="dc-t" data-ed="${k}" title="Bearbeiten"><b dir="auto">${esc(e.t)}</b><span class="muted small" dir="auto">${e.w.length ? 'ersetzt ' + esc(e.w.join(', ')) : hint ? 'nur als Hinweis' : 'noch ohne Fehlschreibung'}</span></button><button type="button" class="mini" data-del="${k}" title="Entfernen">×</button></div>`).join('') : '<p class="muted small">Noch keine Begriffe.</p>';
    $('#dcOn').checked = P.settings.dict !== false; $('#dcOn').disabled = !dict.length;
    const n = dictApply(0, null, true), sent = dictHintList().length, info = [];
    if (tokens.length) info.push(n ? `Im Text ${n === 1 ? 'steht 1 Stelle' : `stehen ${n} Stellen`} mit hinterlegter Fehlschreibung.` : dictOn() ? 'Im Text steht gerade keine hinterlegte Fehlschreibung.' : '');
    if (hint && dictOn() && sent < dict.length) info.push(`Als Hinweis an Whisper gehen die ersten ${sent} von ${dict.length} Begriffen; ersetzt wird mit allen.`);
    $('#dcInfo').textContent = info.filter(Boolean).join(' '); $('#dcRun').disabled = !n; $('#dcAdd').textContent = dictHas($('#dcTerm').value) ? 'Speichern' : 'Hinzufügen';
    paintDictInfo();
  };
  const add = () => { const t = dictClean($('#dcTerm').value), w = $('#dcWrong').value.split(/[,;\n]/).map(dictClean).filter(x => dictKey(x));
    if (!dictKey(t)) return toast('Erst den richtigen Begriff eintragen');
    const e = dictHas(t); if (e){ e.t = t; e.w = []; }   // vorhandener Eintrag: Schreibweise und Liste neu setzen
    else if (dict.length >= 300) return toast('Das Wörterbuch ist voll (300 Begriffe)');
    dictAdd(t, w); saveDict(); $('#dcTerm').value = ''; $('#dcWrong').value = ''; paintList(); $('#dcTerm').focus(); };
  $('#dcAdd').onclick = add;
  for (const id of ['dcTerm', 'dcWrong']) $('#' + id).onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter'){ e.preventDefault(); add(); } };
  $('#dcTerm').oninput = () => { $('#dcAdd').textContent = dictHas($('#dcTerm').value) ? 'Speichern' : 'Hinzufügen'; };
  $('#dcOn').onchange = e => { P.settings.dict = e.target.checked; changed(false); paintList(); };
  $('#dcRun').onclick = () => { let n = 0; commit(() => { n = dictApply(0); }, false); afterTextEdit(n ? `${n === 1 ? 'Eine Stelle' : n + ' Stellen'} ersetzt` : 'Nichts zu ersetzen'); paintList(); };
  $('#dcOk').onclick = closeSheet;
  body.onclick = e => { const d = e.target.closest('[data-del]'), ed = e.target.closest('[data-ed]');
    if (d){ dict.splice(+d.dataset.del, 1); saveDict(); paintList(); }
    else if (ed){ const x = dict[+ed.dataset.ed]; if (x){ $('#dcTerm').value = x.t; $('#dcWrong').value = x.w.join(', '); $('#dcAdd').textContent = 'Speichern'; $('#dcWrong').focus(); } } };
  sheetItem = null; paintList(); openSheet(false);
}
$('#dictBtn').onclick = openDict; $('#dictChip').onclick = openDict;

// ───────── Unsichere Wörter der Reihe nach prüfen (C2) ─────────
// Der Prüfmodus springt von unsicherer Stelle zu unsicherer Stelle (direkt aufeinanderfolgende unsichere Wörter gelten als eine),
// spielt sie ab und nimmt die Entscheidung per Tastatur: Enter bestätigt oder übernimmt die Korrektur, Tab überspringt,
// Umschalt+Tab geht zurück, Pfeil nach unten spielt noch einmal, Strg+Entf löscht die Wörter, Esc beendet.
const LQ = {on: false, stops: [], k: -1, cur: null};
function lowStops(){
  const out = []; if (!P || !tokens.length) return out; if (order.length !== tokens.length) computeOrder();
  let cur = null;
  for (const i of order){ const t = tokens[i];
    if (isLowTok(t) && tokText(t) && !isCut(i)){ if (cur && cur.length < 4) cur.push(i); else { cur = [i]; out.push(cur); } }
    else cur = null; }
  return out;
}
function paintLowBtn(){
  const b = $('#lowBtn'); if (!b) return; const n = lowStops().reduce((a, s) => a + s.length, 0);
  b.classList.toggle('hidden', !n && !LQ.on); b.classList.toggle('on', LQ.on); b.textContent = n ? `Unsichere prüfen (${n})` : 'Unsichere prüfen';
}
function lowMark(){ for (const sp of $$('#transcript .tk.chk')) sp.classList.remove('chk'); if (LQ.on && LQ.cur) LQ.cur.forEach(i => spans[i] && spans[i].classList.add('chk')); }
function lowPlay(){
  const ids = LQ.cur; if (!ids) return;
  const a = srcToOut(snapSrc(wS(tokens[ids[0]]))), b = srcToOut(snapSrc(wE(tokens[ids[ids.length - 1]])));
  audStop(); if (playing) pausePlay(); seekOut(Math.max(0, a - 1), false); startPlay(); stopAt = Math.min(total, Math.max(a, b) + 0.6); tlReveal();
}
function lowShow(k){
  const stops = LQ.stops = lowStops();
  if (!stops.length){ lowEnd(); return toast('Alle unsicheren Wörter sind geprüft'); }
  LQ.k = k = clamp(k, 0, stops.length - 1); const ids = LQ.cur = stops[k];
  lowMark(); if (spans[ids[0]]) spans[ids[0]].scrollIntoView({block: 'center', behavior: 'smooth'});
  $('#lowIn').value = ids.map(i => tokText(tokens[i])).join(' ');
  $('#lowPos').textContent = `Unsichere Stelle ${k + 1} von ${stops.length}`;
  $('#lowHint').textContent = `Whisper war sich zu ${Math.round(Math.min(...ids.map(i => tokens[i].pr)) * 100)} % sicher`;
  $('#lowDict').checked = false; paintLowBtn(); lowPlay();
  if (FINE){ $('#lowIn').focus(); $('#lowIn').select(); }
}
function lowStart(){
  if (!P || !tokens.length) return; if (tab !== 'text') setTab('text');
  if (!lowStops().length) return toast('Kein unsicheres Wort übrig');
  LQ.on = true; clearSel(); $('#lowBar').classList.remove('hidden'); lowShow(0);
}
function lowEnd(){
  if (!LQ.on) return; LQ.on = false; LQ.cur = null; LQ.k = -1; $('#lowBar').classList.add('hidden'); lowMark(); paintLowBtn();
  if (document.activeElement === $('#lowIn')) $('#lowIn').blur();
}
function lowConfirm(){   // Enter: Der Text im Feld gilt. Unverändert heißt bestätigt, verändert heißt korrigiert.
  const ids = LQ.cur; if (!ids) return;
  const v = $('#lowIn').value.replace(/\s+/g, ' ').trim(), old = ids.map(i => tokText(tokens[i])).join(' ');
  if (!v) return lowDelete();
  const fix = v !== old, learn = fix && $('#lowDict').checked; let more = -1;
  commit(() => { if (fix){ applyRangeText(ids, v); regenCuesFor(ids); } ids.forEach(i => tokens[i].ok = 1); if (learn) more = dictLearn(old, v); }, false);
  afterTextEdit(learn ? dictLearnMsg(more) : ''); lowShow(LQ.k);
}
function lowDelete(){ const ids = LQ.cur; if (!ids) return; commit(() => bulkDelete(ids), false); afterTextEdit('Gelöscht'); lowShow(LQ.k); }
function lowStep(d){
  const n = LQ.stops.length, k = LQ.k + d;
  if (k < 0 || k >= n) return toast(k < 0 ? 'Das ist die erste Stelle' : 'Das war die letzte Stelle – Esc beendet das Prüfen');
  lowShow(k);
}
// Tasten im Prüfmodus. Rückgabe true: Die Taste ist verbraucht.
function lowKey(e){
  const sheet = $('#sheet'), open = !sheet.classList.contains('hidden');
  if (!LQ.on || (open && !sheet.classList.contains('passive'))) return false;   // ein Dialog im Vordergrund hat Vorrang
  const k = e.key, mod = e.ctrlKey || e.metaKey, done = () => { e.preventDefault(); e.stopPropagation(); return true; };
  if (k === 'Escape'){ if (open) return false; lowEnd(); return done(); }   // eine offene Liste (Marken, Quellen, Prüfliste) schließt zuerst
  if (k === 'Enter' && !mod){ lowConfirm(); return done(); }
  if (k === 'Tab' && !mod){ lowStep(e.shiftKey ? -1 : 1); return done(); }
  if (k === 'ArrowDown' && !mod){ lowPlay(); return done(); }
  if (k === 'Delete' && mod){ lowDelete(); return done(); }
  return false;
}
$('#lowBar').addEventListener('keydown', e => { if (!lowKey(e) && e.key !== 'Escape') e.stopPropagation(); });
$('#lowBtn').onclick = () => LQ.on ? lowEnd() : lowStart();
$('#lowOk').onclick = lowConfirm; $('#lowPlay').onclick = lowPlay; $('#lowDel').onclick = lowDelete; $('#lowEnd').onclick = lowEnd;
$('#lowPrev').onclick = () => lowStep(-1); $('#lowNext').onclick = () => lowStep(1);

// Einstellungen „direkt nach der Transkription“ merken (nur für diesen Browser)
const AUTO_KEYS = ['autoFillers', 'autoRepeats', 'autoPauses', 'autoPauseLen'];
try { const a = J(localStorage.getItem('ts-auto2')); if (a) AUTO_KEYS.forEach(k => { const el = $('#' + k); if (el && a[k] != null){ if (el.type === 'checkbox') el.checked = a[k]; else el.value = a[k]; } }); } catch(_){}
AUTO_KEYS.forEach(k => $('#' + k).addEventListener('change', () => { try { localStorage.setItem('ts-auto2', JSON.stringify(Object.fromEntries(AUTO_KEYS.map(x => [x, $('#' + x).type === 'checkbox' ? $('#' + x).checked : $('#' + x).value])))); } catch(_){} }));
function autoClean(minTok){
  const msg = [];
  if ($('#autoFillers').checked){ const ids = fillerIds(minTok); cleanRun('f', () => bulkDelete(ids)); if (ids.length) msg.push(`${ids.length} Füllwörter`); }
  if ($('#autoRepeats').checked){ const f = repeatFinds(minTok), ids = f.ids; cleanRun('r', () => { bulkDelete(ids); return f; }); if (ids.length) msg.push(`${ids.filter(isWord).length} Wörter aus Wiederholungen`); }
  if ($('#autoPauses').checked){ const n = cleanRun('p', () => trimPauses(+$('#autoPauseLen').value, minTok)); if (n) msg.push(`${n} Pausen`); }
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

// ───────── Marken: Kapitel (A7) und Notizen (A8) ─────────
// Eine Marke hängt an einer Stelle der Quelle (at, wie alle Elemente) und wandert mit dem Schnitt. Kapitel ergeben die Zeitstempel für
// die YouTube-Beschreibung, Notizen die Aufgabenliste des Projekts. P.marks = [{id, k: 'chap' | 'note', at, text, done}]
const marksOf = k => ((P && P.marks) || []).filter(m => m.k === k);
const markOut = m => srcToOut(snapSrc(m.at));
const markGone = o => o >= total - 0.05;   // die Stelle liegt hinter dem Ende des geschnittenen Videos
const marksSorted = k => marksOf(k).map(m => ({m, o: markOut(m)})).sort((a, b) => a.o - b.o || a.m.at - b.m.at);
function tokAtSrc(t){ let lo = 0, hi = tokens.length - 1, k = -1; while (lo <= hi){ const m = (lo + hi) >> 1; if (tokens[m].s <= t + 1e-3){ k = m; lo = m + 1; } else hi = m - 1; } return k; }
// Stelle für eine neue Marke: das erste markierte Wort, sonst die Abspiellinie (im Text-Reiter der Anfang des Wortes dort)
function markAnchor(){
  if (tab === 'text' && selA != null){ const ids = selIds(), i = ids.find(i => tokens[i].type !== 'pause') ?? ids[0]; return r3(wS(tokens[i])); }
  const t = outToSrcT(outPos), k = tab === 'text' ? tokAtSrc(t) : -1;
  return r3(k >= 0 && tokens[k].type === 'word' ? wS(tokens[k]) : t);
}
// Vorschlag für den Titel eines Kapitels: die ersten Wörter ab der Stelle
function chapSuggest(at){
  const out = [];
  for (let i = Math.max(0, tokAtSrc(at)); i < tokens.length && out.length < 6; i++){ const t = tokens[i]; if (t.type !== 'word' || deleted.has(i) || !tokText(t)) continue; out.push(tokText(t)); if (sentEnd(tokText(t))) break; }
  return out.join(' ').replace(/[.,;:!?…]+$/, '');
}
function markDialog(m, fresh){   // → null (abgebrochen), {del: true} oder {text, done}
  return new Promise(res => {
    const chap = m.k === 'chap', o = markOut(m);
    const box = hcModal(`<h3>${chap ? 'Kapitel' : 'Notiz'}</h3>
      ${chap ? '<input type="text" id="mkIn" maxlength="100" dir="auto" placeholder="Titel des Kapitels" style="width:100%;font-size:16px">'
             : '<textarea id="mkIn" rows="3" maxlength="500" dir="auto" placeholder="z. B. Quelle fehlt · B-Roll einsetzen" style="width:100%;font-size:16px"></textarea>'}
      <p class="muted small" id="mkAt"></p>
      ${chap || fresh ? '' : '<label class="row"><input type="checkbox" id="mkDone"> Erledigt</label>'}
      <div class="row" style="margin-top:12px">${fresh ? '' : '<button class="btn danger" id="mkDel">Entfernen</button>'}<button class="btn" id="mkNo" style="margin-left:auto">Abbrechen</button><button class="btn primary" id="mkOk">OK</button></div>`);
    const inp = box.querySelector('#mkIn'), dn = box.querySelector('#mkDone'), del = box.querySelector('#mkDel');
    inp.value = m.text || ''; if (dn) dn.checked = !!m.done; setTimeout(() => { inp.focus(); inp.select(); }, 30);
    box.querySelector('#mkAt').textContent = markGone(o) ? 'Die Stelle ist weggeschnitten.' : `${chap ? 'Beginnt' : 'Steht'} bei ${fmtT(o)} im geschnittenen Video.`;
    const done = v => { closeHcModal(); res(v); };
    box.querySelector('#mkNo').onclick = () => done(null);
    box.querySelector('#mkOk').onclick = () => done({text: inp.value.trim(), done: dn ? dn.checked : !!m.done});
    if (del) del.onclick = () => done({del: true});
    inp.onkeydown = e => { e.stopPropagation(); if (e.key === 'Escape') done(null); else if (e.key === 'Enter' && (chap || e.ctrlKey || e.metaKey)){ e.preventDefault(); box.querySelector('#mkOk').click(); } };
  });
}
async function addMark(k, at){
  if (!P || !timeline.length || $('#hcModal')) return;
  if (at == null) at = markAnchor();
  const near = (P.marks || []).find(m => m.k === k && Math.abs(m.at - at) < 0.05);   // hier gibt es schon eine: bearbeiten
  if (near) return editMark(near.id);
  const m = {id: newId(), k, at, text: k === 'chap' ? chapSuggest(at) : ''}, P0 = P;
  const r = await markDialog(m, true); if (!r || P !== P0) return;
  if (k === 'note' && !r.text) return toast('Ohne Text wird keine Notiz angeheftet');
  m.text = r.text || 'Kapitel';
  commit(() => { P.marks ||= []; P.marks.push(m); }, false);
  marksChanged(); toast(k === 'chap' ? `Kapitel „${m.text}“ beginnt bei ${fmtT(markOut(m))}` : 'Notiz angeheftet');
}
async function editMark(id){
  const m = (P.marks || []).find(x => x.id === id), P0 = P; if (!m || $('#hcModal')) return;
  const r = await markDialog(m, false); if (!r || P !== P0 || !(P.marks || []).includes(m)) return;
  if (r.del) commit(() => { P.marks = P.marks.filter(x => x !== m); }, false);
  else if (r.text !== (m.text || '') || !!r.done !== !!m.done) commit(() => { if (r.text || m.k === 'chap') m.text = r.text || 'Kapitel'; if (r.done) m.done = true; else delete m.done; }, false);
  else return;
  marksChanged();
}
// Nach einer Änderung an den Marken: Text, Abspielbalken, Zeitskala, Liste und Export-Reiter nachziehen
function marksChanged(){
  if (tokens.length && spans.length){ renderTranscript(); showSel(); }
  drawScrub(); if (tlOn() && window.renderTimeline) renderTimeline();
  paintMarksBtn(); if (marksSheetOpen()) renderMarksSheet(); if (tab === 'export') renderExport();
}
function paintMarksBtn(){ const n = marksOf('chap').length + marksOf('note').filter(m => !m.done).length; $('#marksBtn').textContent = 'Marken' + (n ? ` (${n})` : ''); }
// Zeiten an den Kapitel-Überschriften im Text: Sie folgen dem Schnitt
function paintMarkTimes(){
  for (const h of $$('#transcript .chap-head')){ const m = (P.marks || []).find(x => x.id === h.dataset.mk); if (!m) continue;
    const o = markOut(m); setText(h.querySelector('.t'), markGone(o) ? 'weggeschnitten' : fmtT(o)); h.classList.toggle('cut', markGone(o)); }
}
$('#transcript').addEventListener('click', e => { const el = e.target.closest('[data-mk]'); if (el && P) editMark(el.dataset.mk); });
$('#selChap').onclick = () => addMark('chap');
$('#selNote').onclick = () => addMark('note');
// ── Liste der Kapitel und Notizen: bleibt offen, während man zu den Stellen springt ──
const marksSheetOpen = () => !$('#sheet').classList.contains('hidden') && !!$('#mkSheet');
function jumpToMark(m){
  const o = markOut(m); if (playing) pausePlay();
  seekOut(Math.min(o, Math.max(0, total - 0.01)), false); tlReveal();
  if (tab === 'text'){ const k = tokAtSrc(m.at); if (k >= 0 && spans[k]) spans[k].scrollIntoView({block: 'center', behavior: 'smooth'}); }
}
function openMarks(){
  if (!P) return; sheetItem = null;
  const body = $('#sheetBody'); body.innerHTML = '<div id="mkSheet"></div>';
  body.onclick = e => {
    const rowEl = e.target.closest('.mk-row'), a = e.target.closest('[data-a]'), act = a ? a.dataset.a : '', m = rowEl && (P.marks || []).find(x => x.id === rowEl.dataset.id);
    if (m && e.target.matches('input[type=checkbox]')){ const on = e.target.checked; commit(() => { if (on) m.done = true; else delete m.done; }, false); return marksChanged(); }
    if (m && act === 'edit') return editMark(m.id);
    if (m && e.target.closest('.mk-go')) return jumpToMark(m);
    if (act === 'chap' || act === 'note') return addMark(act, r3(outToSrcT(outPos)));
    if (act === 'copy') return copyChapters();
    if (act === 'clear'){ commit(() => { P.marks = P.marks.filter(x => !(x.k === 'note' && x.done)); }, false); return marksChanged(); }
    if (act === 'ok') closeSheet();
  };
  renderMarksSheet(); openSheet(true);
}
function renderMarksSheet(){
  const box = $('#mkSheet'); if (!box) return;
  const ch = marksSorted('chap'), no = marksSorted('note'), open = no.filter(x => !x.m.done).length;
  const row = x => `<div class="mk-row${x.m.done ? ' done' : ''}${markGone(x.o) ? ' cut' : ''}" data-id="${x.m.id}">${x.m.k === 'note' ? `<input type="checkbox"${x.m.done ? ' checked' : ''} title="Erledigt">` : ''}<button type="button" class="mk-go" title="Zur Stelle springen"><span class="mono">${markGone(x.o) ? '–' : fmtT(x.o)}</span><span class="mk-t" dir="auto">${esc(x.m.text || 'Kapitel')}</span></button><button type="button" class="mini" data-a="edit" title="Bearbeiten">✎</button></div>`;
  box.innerHTML = `<h3>Kapitel und Notizen</h3>
    <h4>Kapitel</h4>${ch.length ? ch.map(row).join('') : '<p class="muted small">Noch keine Kapitel. Im Text ein Wort markieren und „Kapitel“ wählen, oder die Abspiellinie an die Stelle setzen.</p>'}
    <div class="row wrap"><button class="btn small" data-a="chap">＋ Kapitel an der Abspiellinie</button>${ch.length ? '<button class="btn small" data-a="copy">📋 Zeitstempel kopieren</button>' : ''}</div>
    <h4>Notizen${no.length ? ` · ${open} offen` : ''}</h4>${no.length ? no.map(row).join('') : '<p class="muted small">Noch keine Notizen. Sie halten fest, was an einer Stelle noch zu tun ist.</p>'}
    <div class="row wrap"><button class="btn small" data-a="note">＋ Notiz an der Abspiellinie</button>${no.some(x => x.m.done) ? '<button class="btn small ghost" data-a="clear">Erledigte entfernen</button>' : ''}</div>
    <div class="row" style="margin-top:12px"><button class="btn primary" data-a="ok" style="margin-left:auto">Fertig</button></div>`;
}
$('#marksBtn').onclick = openMarks;
// ── Zeitstempel für die YouTube-Beschreibung ──
// YouTube zeigt Kapitel nur, wenn der erste Zeitstempel 0:00 ist, mindestens drei aufsteigend dastehen und jedes Kapitel mindestens
// zehn Sekunden dauert. Beginnt das erste Kapitel später, steht deshalb „0:00 Einstieg“ davor.
function chapterRows(){
  const list = marksSorted('chap').filter(x => !markGone(x.o)); if (!list.length) return [];
  const rows = list.map(x => [x.o, (x.m.text || 'Kapitel').trim()]);
  if (rows[0][0] > 0.5) rows.unshift([0, 'Einstieg']); else rows[0][0] = 0;
  return rows;
}
const chapterText = () => chapterRows().map(([o, t]) => `${fmtT(o)} ${t}`).join('\n');
function chapterIssues(){
  const rows = chapterRows(), out = []; if (!rows.length) return out;
  const shown = marksSorted('chap').filter(x => !markGone(x.o)), gone = marksOf('chap').length - shown.length;
  if (shown[0].o > 0.5) out.push('Die Liste beginnt mit „0:00 Einstieg“, weil YouTube Kapitel nur anzeigt, wenn das erste bei 0:00 beginnt.');
  if (rows.length < 3) out.push(`YouTube zeigt Kapitel erst ab drei Einträgen, bisher ${rows.length === 1 ? 'ist es einer' : 'sind es zwei'}.`);
  const short = rows.filter((r, k) => (k + 1 < rows.length ? rows[k + 1][0] : total) - r[0] < 10).map(r => `„${r[1]}“`);
  if (short.length) out.push(`${short.length === 1 ? 'Das Kapitel' : 'Die Kapitel'} ${short.join(', ')} ${short.length === 1 ? 'ist' : 'sind'} kürzer als zehn Sekunden; YouTube verlangt mindestens zehn.`);
  if (gone) out.push(`${gone === 1 ? 'Ein Kapitel liegt' : gone + ' Kapitel liegen'} an einer weggeschnittenen Stelle am Ende und ${gone === 1 ? 'fehlt' : 'fehlen'} in der Liste.`);
  return out;
}
async function copyChapters(){
  const txt = chapterText(); if (!txt) return toast('Noch keine Kapitel');
  const ok = await copyText(txt); toast(ok ? 'Zeitstempel in der Zwischenablage' : 'Kopieren hat nicht geklappt');
  const m = $('#chapMsg'); if (m) m.textContent = ok ? 'In der Zwischenablage – in die Beschreibung des Videos einfügen.' : 'Kopieren hat nicht geklappt. Der Text oben lässt sich markieren.';
}
function renderChapters(){
  const txt = chapterText(), iss = chapterIssues(), open = marksOf('note').filter(m => !m.done).length;
  $('#chapText').classList.toggle('hidden', !txt); $('#chapText').textContent = txt;
  $('#chapWarn').classList.toggle('hidden', !iss.length); $('#chapWarn').textContent = iss.join(' ');
  $('#chapCopy').classList.toggle('hidden', !txt);
  $('#exNotes').classList.toggle('hidden', !open); $('#exNotes span').textContent = open === 1 ? 'Noch 1 offene Notiz in diesem Projekt.' : `Noch ${open} offene Notizen in diesem Projekt.`;
}
$('#chapCopy').onclick = copyChapters;
$('#chapOpen').onclick = openMarks; $('#exNotesBtn').onclick = openMarks;

// ───────── Quellen und Belege (B1, B2) ─────────
// P.refs = [{id, at, end, medium, title, date, url, text, show, done}] – at/end in Quellzeit: vom Anfang des ersten bis zum Ende des
// letzten Worts der Stelle. Mit Angaben (Medium, Titel oder Link) ist der Eintrag eine Quelle. Ohne Angaben heißt er „Beleg nötig“
// und bleibt offen, bis eine Quelle eingetragen oder er als geprüft abgehakt ist. Der Export weist auf offene Einträge hin.
const refsAll = () => (P && P.refs) || [];
const refStr = (r, k) => String(r[k] || '').replace(/\s+/g, ' ').trim();
const refHas = r => !!(refStr(r, 'medium') || refStr(r, 'title') || refStr(r, 'url'));
const refOpen = r => !refHas(r) && !r.done;
const refOut = r => srcToOut(snapSrc(r.at));
function refToks(r){ const out = []; for (let i = Math.max(0, tokAtSrc(r.at + 0.002)); i < tokens.length && tokens[i].s < r.end - 0.002; i++) out.push(i); return out; }
const refKept = r => refToks(r).filter(i => isTextTok(i) && tokText(tokens[i]) && !isCut(i));   // Wörter der Stelle, die im Video bleiben
const refGone = r => !refKept(r).length;
const refsOpen = () => refsAll().filter(r => refOpen(r) && !refGone(r));   // offen und noch im Video
function refQuote(r, n = 10){ const w = refToks(r).filter(i => isTextTok(i) && tokText(tokens[i])).map(i => tokText(tokens[i])); return w.length > n ? w.slice(0, n).join(' ') + ' …' : w.join(' '); }
const refHost = u => { try { return u ? new URL(/^[a-z][a-z0-9+.-]*:/i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '') : ''; } catch(_){ return ''; } };
// Text der Zeile im Bild: eigener Text, sonst Medium (ersatzweise Titel oder die Adresse der Seite) mit Datum
function refLabel(r){
  const own = refStr(r, 'text'); if (own) return own;
  const main = refStr(r, 'medium') || refStr(r, 'title') || refHost(refStr(r, 'url')), d = refStr(r, 'date');
  return main ? main + (d ? ', ' + d : '') : '';
}
// Eintrag der Quellenliste: „Medium: Titel (Datum) – Link“
function refLine(r){
  const m = refStr(r, 'medium'), t = refStr(r, 'title'), d = refStr(r, 'date'), u = refStr(r, 'url');
  let s = m && t ? `${m}: ${t}` : m || t; if (d) s += s ? ` (${d})` : d; if (u) s += s ? ` – ${u}` : u; return s;
}
// Quellen in der Reihenfolge, in der sie im geschnittenen Video vorkommen. Gleiche Angaben stehen einmal in der Liste und teilen sich die Nummer.
function refList(){
  const rows = [], byKey = new Map(), byId = new Map();
  for (const r of refsAll().filter(r => refHas(r) && !refGone(r)).sort((a, b) => refOut(a) - refOut(b) || a.at - b.at)){
    const line = refLine(r), key = line.toLowerCase(); if (!byKey.has(key)){ rows.push(line); byKey.set(key, rows.length); } byId.set(r.id, byKey.get(key)); }
  return {rows, byId};
}
const refListText = () => { const {rows} = refList(); return rows.length ? 'Quellen:\n' + rows.map((l, k) => `[${k + 1}] ${l}`).join('\n') : ''; };
// Zeit im geschnittenen Video, in der die Quelle im Bild steht: der Satz (oder die Sätze) um die Stelle, mindestens REF_MIN Sekunden
const REF_MIN = 2.5;
function refSpan(r){
  const ks = refKept(r).map(i => pos[i]).filter(k => k != null); if (!ks.length) return null;
  const [a, b] = sentBounds(Math.min(...ks), Math.max(...ks)); let s = Infinity, e = -Infinity;
  for (let k = a; k <= b; k++){ const i = order[k]; if (!isTextTok(i) || isCut(i)) continue; const t = tokens[i]; s = Math.min(s, srcToOut(wS(t))); e = Math.max(e, srcToOut(wE(t))); }
  if (!(e > s)) return null;
  e = Math.min(total, Math.max(e, s + REF_MIN)); return e - s > 0.2 ? [s, e] : null;
}
// Stil der Zeile im Bild (P.srcStyle): Lage o/u + l/m/r, Größe und Randabstand als Anteil der kürzeren Bildseite, pre = vorangestelltes Wort
const SRC_DEF = {pos: 'ol', size: 0.024, margin: 0.035, color: '#FFFFFF', outline: true, bg: false, font: '', safe: true, on: true, pre: 'Quelle:'};
const srcStyle = () => ({...SRC_DEF, ...((P && P.srcStyle) || {})});
// Zeilen im Bild: je Quelle die Dauer ihres Satzes. Was sich zeitlich überschneidet, steht gemeinsam in einer Zeile.
let refMemo = null;
function refCues(){
  if (refMemo) return refMemo;
  const st = srcStyle(), out = []; if (st.on === false || !refsAll().length || !tokens.length) return refMemo = out;
  if (order.length !== tokens.length) computeOrder();
  const list = refsAll().filter(r => refHas(r) && r.show !== false).map(r => ({sp: refSpan(r), lbl: refLabel(r)})).filter(x => x.sp && x.lbl).sort((a, b) => a.sp[0] - b.sp[0]);
  for (const x of list){ const last = out[out.length - 1];
    if (last && x.sp[0] < last.e - 0.05){ last.e = Math.max(last.e, x.sp[1]); if (!last.lbls.includes(x.lbl)) last.lbls.push(x.lbl); }
    else out.push({s: x.sp[0], e: x.sp[1], lbls: [x.lbl]}); }
  const pre = String(st.pre ?? '').trim();
  for (const g of out) g.text = (pre ? (pre === 'Quelle:' && g.lbls.length > 1 ? 'Quellen:' : pre) + ' ' : '') + g.lbls.join(' · ');
  return refMemo = out;
}
// Steht die dauerhafte Textzeile in derselben Ecke, rückt die Quellenzeile daneben: oben unter sie, unten über sie
function srcMinV(W, H){
  const p = srcStyle().pos; if (!tlineOn() || ({...TLINE_DEF, ...P.textline}).pos !== p) return 0;
  const L = tlineLayout(W, H); return (p[0] === 'o' ? L.mT : L.mB) + L.px * 1.12 + 2 * L.padY + L.px * 0.3;
}
const srcLayout = (text, W, H) => lineLayout(srcStyle(), text, W, H, srcMinV(W, H));
function placeSrcLine(W, H, o){
  const el = $('#srcLine'), cur = P && refsAll().length ? refCues().find(c => o >= c.s - 1e-3 && o < c.e) : null;
  if (!cur){ if (!el.classList.contains('hidden')) el.classList.add('hidden'); return; }
  const key = [W, H, cur.text, JSON.stringify(P.srcStyle || 0), tlineOn() ? JSON.stringify(P.textline) : '', P.settings.safe || '', document.fonts ? document.fonts.status : ''].join('|');
  if (el.dataset.k === key && !el.classList.contains('hidden')) return; el.dataset.k = key;
  paintLine(el, srcLayout(cur.text, W, H));
}
const viewSrcLine = () => { const st = $('#stage'); placeSrcLine(st.clientWidth, st.clientHeight, outPos); };
// Mehrere schnelle Änderungen (Regler, Tippen) sind zusammen ein Rückgängig-Schritt. Der Stand davor wird zu Beginn der Folge zurückgelegt;
// kam inzwischen ein anderer Schritt dazu oder liegt die letzte Änderung länger zurück, beginnt eine neue Folge.
let burstKey = '', burstLen = -1, burstT = 0;
function commitBurst(key, fn){
  const now = Date.now();
  if (burstKey !== key || undo.length !== burstLen || now - burstT > 4000){ undo.push(snapshot()); if (undo.length > 200) undo.shift(); redo = []; burstKey = key; burstLen = undo.length; }
  burstT = now; fn(); changedLive();
}
function refDialog(r, fresh){   // → null (abgebrochen), {del: true} oder die Angaben
  return new Promise(res => {
    const gone = refGone(r), sp = gone ? null : refSpan(r), F = ['medium', 'title', 'date', 'url', 'text'];
    const box = hcModal(`<h3>Quelle</h3>
      <p class="ref-q" dir="auto"></p>
      <div class="grid2">
        <label>Medium oder Herausgeber:in <input type="text" id="rfMedium" maxlength="120" dir="auto" placeholder="z. B. Statistisches Bundesamt"></label>
        <label>Datum <input type="text" id="rfDate" maxlength="40" placeholder="z. B. 12.03.2025"></label>
      </div>
      <label class="col">Titel <input type="text" id="rfTitle" maxlength="240" dir="auto" placeholder="Titel des Artikels, der Studie oder der Sendung"></label>
      <label class="col">Link <input type="text" id="rfUrl" maxlength="600" inputmode="url" autocapitalize="off" spellcheck="false" placeholder="https://…"></label>
      <label class="row"><input type="checkbox" id="rfShow"> Als Zeile im Bild zeigen, solange der Satz läuft</label>
      <label class="col" id="rfTextRow">Text im Bild <input type="text" id="rfText" maxlength="90" dir="auto"></label>
      <label class="row" id="rfDoneRow"><input type="checkbox" id="rfDone"> Geprüft, die Stelle braucht keine Quelle</label>
      <p class="muted small" id="rfAt"></p>
      <div class="row wrap" style="margin-top:12px">${fresh ? '' : '<button class="btn danger" id="rfDel">Entfernen</button>'}<button class="btn" id="rfNo" style="margin-left:auto">Abbrechen</button><button class="btn primary" id="rfOk">OK</button></div>`);
    const q = id => box.querySelector('#' + id), inp = {medium: q('rfMedium'), title: q('rfTitle'), date: q('rfDate'), url: q('rfUrl'), text: q('rfText')};
    box.querySelector('.ref-q').textContent = '„' + refQuote(r, 26) + '“';
    for (const k of F) inp[k].value = r[k] || '';
    q('rfShow').checked = r.show !== false; q('rfDone').checked = !!r.done;
    const read = () => { const v = {}; for (const k of F) v[k] = inp[k].value.replace(/\s+/g, ' ').trim(); v.show = q('rfShow').checked; v.done = q('rfDone').checked; return v; };
    const where = gone ? 'Die Stelle ist weggeschnitten; sie fehlt im Bild und in der Quellenliste.' : `Die Stelle beginnt bei ${fmtT(refOut(r))} im geschnittenen Video.`;
    const paint = () => { const v = read(), has = refHas(v);
      q('rfTextRow').classList.toggle('hidden', !v.show || !has); inp.text.placeholder = refLabel({...v, text: ''}) || 'Medium, Datum';
      q('rfDoneRow').classList.toggle('hidden', has); q('rfOk').textContent = has || v.done ? 'Speichern' : 'Als „Beleg nötig“ markieren';
      q('rfAt').textContent = where + (has ? (v.show && sp ? ` Die Zeile steht ${(sp[1] - sp[0]).toFixed(1).replace('.', ',')} s im Bild.` : '') : v.done ? '' : ' Ohne Angaben bleibt sie als „Beleg nötig“ offen, und der Export weist darauf hin.'); };
    const done = v => { closeHcModal(); res(v); };
    q('rfNo').onclick = () => done(null); q('rfOk').onclick = () => done(read()); if (q('rfDel')) q('rfDel').onclick = () => done({del: true});
    box.addEventListener('input', paint); box.addEventListener('change', paint);
    box.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') done(null); else if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox'){ e.preventDefault(); q('rfOk').click(); } });
    paint(); setTimeout(() => { if (inp.medium.isConnected) inp.medium.focus(); }, 30);
  });
}
// Stelle für einen neuen Eintrag: die Markierung im Text, sonst der Satz an der Abspiellinie
function refRange(){
  if (!tokens.length) return null; if (order.length !== tokens.length) computeOrder();
  let ids;
  if (tab === 'text' && selA != null) ids = selIds();
  else { const k = tokAtOut(outPos); if (k == null || pos[k] == null) return null; const [a, b] = sentBounds(pos[k], pos[k]); ids = order.slice(a, b + 1); }
  ids = ids.filter(i => isTextTok(i) && tokText(tokens[i])); if (!ids.length) return null;
  return {at: r3(Math.min(...ids.map(i => wS(tokens[i])))), end: r3(Math.max(...ids.map(i => wE(tokens[i]))))};
}
function refApply(r, v){
  for (const k of ['medium', 'title', 'date', 'url', 'text']){ if (v[k]) r[k] = v[k]; else delete r[k]; }
  if (v.show === false) r.show = false; else delete r.show; if (v.done && !refHas(r)) r.done = true; else delete r.done;
}
async function addRef(quick){   // quick: ohne Dialog als „Beleg nötig“ markieren
  if (!P || !timeline.length || $('#hcModal')) return;
  const rg = refRange(); if (!rg) return toast('Erst im Text die Stelle markieren, zu der die Quelle gehört');
  const same = refsAll().find(r => Math.abs(r.at - rg.at) < 0.05 && Math.abs(r.end - rg.end) < 0.05);   // die Stelle hat schon einen Eintrag
  if (same) return quick ? toast(refOpen(same) ? 'Die Stelle ist schon als „Beleg nötig“ markiert' : 'Die Stelle hat schon einen Eintrag') : editRef(same.id);
  const r = {id: newId(), ...rg}, P0 = P;
  if (!quick){ const v = await refDialog(r, true); if (!v || P !== P0) return; refApply(r, v); }
  commit(() => { P.refs ||= []; P.refs.push(r); }, false);
  refsChanged(); toast(refHas(r) ? 'Quelle hinterlegt' : r.done ? 'Als geprüft vermerkt' : 'Als „Beleg nötig“ markiert');
}
async function editRef(id){
  const r = refsAll().find(x => x.id === id), P0 = P; if (!r || $('#hcModal')) return;
  const v = await refDialog(r, false); if (!v || P !== P0 || !refsAll().includes(r)) return;
  if (v.del) commit(() => { P.refs = P.refs.filter(x => x !== r); }, false);
  else { const nx = {...r}; refApply(nx, v); if (JSON.stringify(nx) === JSON.stringify(r)) return; commit(() => refApply(r, v), false); }
  refsChanged();
}
// Nach einer Änderung an den Quellen: Text, Bild, Liste und Export-Reiter nachziehen
function refsChanged(){
  if (tokens.length && spans.length){ renderTranscript(); showSel(); }
  viewSrcLine(); paintRefsBtn(); if (refsSheetOpen()) renderRefsSheet(); if (tab === 'export') renderExport();
}
function paintRefsBtn(){ const b = $('#refsBtn'), n = refsOpen().length, all = refsAll().length; b.textContent = 'Quellen' + (n ? ` (${n} offen)` : all ? ` (${all})` : ''); b.classList.toggle('warn', n > 0); }
$('#transcript').addEventListener('click', e => { const el = e.target.closest('[data-rf]'); if (el && P) editRef(el.dataset.rf); });
$('#selRef').onclick = () => addRef(false);
// Sätze, die nach einem Beleg verlangen: Zahlen und Mengen, Studien, Umfragen, Zitate. Namen lassen sich so nicht erkennen.
const REF_WORDS = /^(prozent|percent|million|milliard|billion|tausend|drittel|viertel|hälfte|studie|study|umfrage|survey|statisti|zufolge|zitat)|^(laut|according)$/;
const refHint = w => /\d|[„“”"«»]/.test(w) || REF_WORDS.test(w.toLowerCase().replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, ''));
function refSuggest(){
  if (!tokens.length) return toast('Noch kein Text vorhanden'); if (order.length !== tokens.length) computeOrder();
  const word = i => isTextTok(i) && !!tokText(tokens[i]), taken = i => refsAll().some(r => wS(tokens[i]) < r.end - 0.002 && wE(tokens[i]) > r.at + 0.002), add = [];
  for (let k = 0; k < order.length; k++){
    if (!word(order[k])) continue;
    const [a, b] = sentBounds(k, k), ids = order.slice(a, b + 1).filter(i => word(i) && !isCut(i)); k = Math.max(k, b);
    if (ids.length < 3 || ids.some(taken) || !ids.some(i => refHint(tokText(tokens[i])))) continue;
    add.push({id: newId(), at: r3(Math.min(...ids.map(i => wS(tokens[i])))), end: r3(Math.max(...ids.map(i => wE(tokens[i]))))});
  }
  if (!add.length) return toast('Keine weiteren Sätze mit Zahlen, Studien oder Zitaten gefunden');
  commit(() => { P.refs ||= []; P.refs.push(...add); }, false); refsChanged();
  toast(`${add.length === 1 ? '1 Satz' : add.length + ' Sätze'} als „Beleg nötig“ markiert – Strg+Z macht es rückgängig`);
}
async function copyRefs(){
  const txt = refListText(); if (!txt) return toast('Noch keine Quellen hinterlegt');
  const ok = await copyText(txt); toast(ok ? 'Quellenliste in der Zwischenablage' : 'Kopieren hat nicht geklappt');
  const m = $('#refMsg'); if (m) m.textContent = ok ? 'In der Zwischenablage – in die Beschreibung des Videos einfügen.' : 'Kopieren hat nicht geklappt. Der Text oben lässt sich markieren.';
}
// ── Liste der Quellen und Belege: bleibt offen, während man zu den Stellen springt ──
const refsSheetOpen = () => !$('#sheet').classList.contains('hidden') && !!$('#rfSheet');
let rfStyleOpen = false;
function jumpToRef(r){
  const o = refOut(r); if (playing) pausePlay();
  seekOut(Math.min(o, Math.max(0, total - 0.01)), false); tlReveal();
  if (tab === 'text'){ const k = refToks(r)[0]; if (k != null && spans[k]) spans[k].scrollIntoView({block: 'center', behavior: 'smooth'}); }
}
function openRefs(){
  if (!P) return; sheetItem = null;
  const body = $('#sheetBody'); body.innerHTML = '<div id="rfSheet"></div>'; body.onclick = null;
  const box = $('#rfSheet'), setStyle = patch => { commitBurst('src', () => { P.srcStyle = {...srcStyle(), ...patch}; }); viewSrcLine(); paintSrcStyle(); };
  box.addEventListener('click', e => {
    const rowEl = e.target.closest('.mk-row'), a = e.target.closest('[data-a]'), act = a ? a.dataset.a : '', r = rowEl && refsAll().find(x => x.id === rowEl.dataset.id);
    if (r && e.target.matches('input[type=checkbox]')){ const on = e.target.checked; commit(() => { if (on) r.done = true; else delete r.done; }, false); return refsChanged(); }
    if (r && act === 'edit') return editRef(r.id);
    if (r && e.target.closest('.mk-go')) return jumpToRef(r);
    if (act === 'add') return addRef(false);
    if (act === 'find') return refSuggest();
    if (act === 'copy') return copyRefs();
    if (act === 'ok') return closeSheet();
    const p = e.target.closest('#rsPos [data-p]'); if (p) setStyle({pos: p.dataset.p});
  });
  const onStyle = e => { const id = e.target.id;
    if (id === 'rsOn') setStyle({on: e.target.checked}); else if (id === 'rsBg') setStyle({bg: e.target.checked}); else if (id === 'rsColor') setStyle({color: e.target.value.toUpperCase()});
    else if (id === 'rsPre') setStyle({pre: e.target.value.trim()}); else if (id === 'rsSize') setStyle({size: +e.target.value}); };
  box.addEventListener('input', onStyle); box.addEventListener('change', onStyle);
  box.addEventListener('toggle', e => { if (e.target.id === 'rfStyle') rfStyleOpen = e.target.open; }, true);
  box.addEventListener('keydown', e => { if (e.target.id === 'rsPre') e.stopPropagation(); });
  const POS = [['ol','↖'],['om','↑'],['or','↗'],['ul','↙'],['um','↓'],['ur','↘']];
  box.innerHTML = `<h3>Quellen und Belege</h3><div id="rfRows"></div>
    <details class="tr-style" id="rfStyle"${rfStyleOpen ? ' open' : ''}><summary>Zeile im Bild</summary>
      <label class="row"><input type="checkbox" id="rsOn"> Quellen als Zeile im Bild zeigen</label>
      <div class="grid2">
        <div class="field"><span>Lage</span><div class="wm-pos" id="rsPos">${POS.map(([k, a]) => `<button type="button" data-p="${k}">${a}</button>`).join('')}</div></div>
        <label>Davor steht <input type="text" id="rsPre" maxlength="20" placeholder="nichts"></label>
        <label>Farbe <input type="color" id="rsColor"></label>
        <label class="row"><input type="checkbox" id="rsBg"> dunkler Kasten</label>
      </div>
      <div class="field"><span>Größe <b id="rsSizeV"></b></span><input type="range" id="rsSize" min="0.016" max="0.05" step="0.002"></div>
      <p class="muted small">Die Zeile steht im Bild, solange der Satz mit der Aussage läuft, mindestens ${String(REF_MIN).replace('.', ',')} Sekunden. In CapCut und Concat liegt sie auf einer eigenen Textspur.</p>
    </details>
    <div class="row" style="margin-top:12px"><button class="btn primary" data-a="ok" style="margin-left:auto">Fertig</button></div>`;
  renderRefsSheet(); openSheet(true);
}
function paintSrcStyle(){
  const st = srcStyle(), on = $('#rsOn'); if (!on) return;
  on.checked = st.on !== false; $('#rsBg').checked = !!st.bg; $('#rsColor').value = (st.color || '#FFFFFF').toLowerCase(); if (document.activeElement !== $('#rsPre')) $('#rsPre').value = st.pre ?? '';
  $('#rsSize').value = st.size; $('#rsSizeV').textContent = (st.size * 100).toFixed(1).replace('.', ',') + ' %';
  $('#rsPos').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.p === st.pos));
}
function renderRefsSheet(){
  const box = $('#rfRows'); if (!box) return;
  const all = refsAll().map(r => ({r, o: refOut(r), gone: refGone(r)})).sort((a, b) => a.o - b.o || a.r.at - b.r.at), {byId} = refList();
  const open = all.filter(x => refOpen(x.r)), src = all.filter(x => refHas(x.r)), okd = all.filter(x => !refHas(x.r) && x.r.done), nOpen = open.filter(x => !x.gone).length;
  const row = x => { const r = x.r, has = refHas(r), n = byId.get(r.id);
    return `<div class="mk-row rf-row${x.gone ? ' cut' : ''}${!has && r.done ? ' done' : ''}" data-id="${r.id}">${has ? '' : `<input type="checkbox"${r.done ? ' checked' : ''} title="Geprüft, die Stelle braucht keine Quelle">`}<button type="button" class="mk-go" title="Zur Stelle springen"><span class="mono">${x.gone ? '–' : fmtT(x.o)}</span><span class="mk-t" dir="auto">${has ? `<b>${n ? `[${n}] ` : ''}${esc(refLabel(r) || refLine(r))}</b>` : ''}<i>${esc(refQuote(r))}</i></span></button><button type="button" class="mini" data-a="edit" title="Bearbeiten">✎</button></div>`; };
  box.innerHTML = `<h4>Beleg nötig${open.length ? ` · ${nOpen} offen` : ''}</h4>${open.length ? open.map(row).join('') : '<p class="muted small">Keine offenen Stellen. Was noch einen Beleg braucht, im Text markieren und „Quelle“ wählen – ohne Angaben bleibt die Stelle offen.</p>'}
    <div class="row wrap"><button class="btn small" data-a="find" title="Markiert Sätze mit Zahlen und Mengen, Studien, Umfragen und Zitaten">🔍 Stellen vorschlagen</button></div>
    <h4>Quellen${src.length ? ` · ${src.length}` : ''}</h4>${src.length ? src.map(row).join('') : '<p class="muted small">Noch keine Quellen. Im Text die Aussage markieren und „Quelle“ wählen (Taste R).</p>'}
    <div class="row wrap"><button class="btn small" data-a="add" title="Zur Markierung im Text, sonst zum Satz an der Abspiellinie">＋ Quelle …</button>${src.length ? '<button class="btn small" data-a="copy">📋 Quellenliste kopieren</button>' : ''}</div>
    ${okd.length ? `<h4>Geprüft, ohne Quelle</h4>${okd.map(row).join('')}` : ''}`;
  paintSrcStyle();
}
// Zähler und Liste folgen dem Schnitt (eine weggeschnittene Stelle zählt nicht mehr): kurz nach jeder Änderung auffrischen
let refsLateT = 0;
function refsLater(){ clearTimeout(refsLateT); refsLateT = setTimeout(() => { if (!P) return; paintRefsBtn(); if (refsSheetOpen()) renderRefsSheet(); if (lowerSheetOpen()) paintLowerSheet(); }, 250); }
$('#refsBtn').onclick = openRefs;
// Export-Reiter: Quellenliste für die Beschreibung und der Hinweis auf offene Belege
function renderRefsCard(){
  const txt = refListText(), open = refsOpen().length, gone = refsAll().filter(r => refHas(r) && refGone(r)).length;
  $('#refText').classList.toggle('hidden', !txt); $('#refText').textContent = txt; $('#refCopy').classList.toggle('hidden', !txt);
  $('#refWarn').classList.toggle('hidden', !gone); $('#refWarn').textContent = gone ? `${gone === 1 ? 'Eine Quelle gehört' : gone + ' Quellen gehören'} zu einer weggeschnittenen Stelle und ${gone === 1 ? 'fehlt' : 'fehlen'} in der Liste.` : '';
  $('#exRefs').classList.toggle('hidden', !open); $('#exRefs span').textContent = open === 1 ? 'Noch 1 Beleg offen: Eine Stelle ist als „Beleg nötig“ markiert.' : `Noch ${open} Belege offen: So viele Stellen sind als „Beleg nötig“ markiert.`;
}
$('#refCopy').onclick = copyRefs;
$('#refOpen').onclick = openRefs; $('#exRefsBtn').onclick = () => { setTab('text'); openRefs(); };
// Vor dem Export: Sind noch Belege offen, nachfragen. → true: exportieren, false: erst ansehen
function askOpenRefs(){
  const n = refsOpen().length; if (!n) return Promise.resolve(true);
  return new Promise(res => {
    const box = hcModal(`<h3>${n === 1 ? 'Ein Beleg ist' : n + ' Belege sind'} noch offen</h3>
      <p>${n === 1 ? 'Eine Stelle ist' : n + ' Stellen sind'} als „Beleg nötig“ markiert und hat noch keine Quelle.</p>
      <div class="row wrap" style="margin-top:12px"><button class="btn" id="xrSee">Belege ansehen</button><button class="btn primary" id="xrGo" style="margin-left:auto">Trotzdem exportieren</button></div>`);
    const done = v => { closeHcModal(); res(v); };
    box.querySelector('#xrSee').onclick = () => done(false); box.querySelector('#xrGo').onclick = () => done(true);
    box.addEventListener('keydown', e => { if (e.key === 'Escape') done(false); });
  });
}

// ───────── Barrierefreiheit (B10) ─────────
// Geprüft wird, was sich an den Einstellungen ablesen lässt: Untertitel vorhanden, groß genug, mit genug Kontrast zwischen Schrift und
// Umrandung bzw. Kasten, im Lesetempo. Kontrast nach WCAG 2: Verhältnis der relativen Leuchtdichten, von 1 : 1 (gleiche Farbe) bis
// 21 : 1 (Schwarz auf Weiß); für Text gelten 4,5 : 1 als Mindestwert.
const hexRgb = h => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim()); return m ? [0, 2, 4].map(k => parseInt(m[1].slice(k, k + 2), 16)) : [255, 255, 255]; };
const relLum = h => { const [r, g, b] = hexRgb(h).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const x = relLum(a), y = relLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
// size: Schrifthöhe als Anteil der kürzeren Bildseite; box: der dunkle Kasten vor hellem Bild (der ungünstigste Fall)
const A11Y = {contrast: 4.5, size: 0.055, box: '#666666'};
const fmtRatio = c => (Math.floor(c * 10) / 10).toFixed(1).replace('.', ',') + ' : 1';
const bestOutline = col => contrast(col, '#000000') >= contrast(col, '#FFFFFF') ? '#000000' : '#FFFFFF';
// Hinweise: [{k, text, fix (Beschriftung), run}]. styleOnly: nur, was am Stil der Untertitel liegt (für den Untertitel-Reiter).
function a11yIssues(styleOnly){
  const out = [], st = S(), [W, H] = outSize(), tall = H > W, on = st.enabled !== false && P.cues.length > 0;
  const apply = fn => () => { commit(fn, false); syncStyleInputs(); if (tab === 'subs') renderSpeakers(); };
  if (!on){
    if (!styleOnly && exFmt !== 'audio' && tokens.some(t => t.type === 'word')) out.push({k: 'nosubs', text: (st.enabled === false ? 'Die Untertitel sind ausgeschaltet.' : 'Das Video hat noch keine Untertitel.') + ' Wer ohne Ton schaut oder schlecht hört, bekommt den Inhalt dann nicht mit.', fix: 'Zu den Untertiteln', run: () => setTab('subs')});
    return out;
  }
  if (!styleOnly && exFmt === 'audio') return out;
  const used = new Set(); for (const t of tokens) if (t.spk && t.type === 'word') used.add(t.spk);
  const styles = [{sp: null, x: st}].concat(P.speakers.filter(sp => used.has(sp.id) && sp.st && Object.keys(sp.st).length).map(sp => ({sp, x: {...st, ...sp.st}})));
  for (const {sp, x} of styles){
    const who = sp ? ` von ${sp.name}` : '', own = k => !sp || sp.st[k] != null;
    if ((SIZE_F[x.size] || 0.058) * (tall ? 1.25 : 1) < A11Y.size && own('size')) out.push({k: 'size', text: `Die Untertitel${who} sind klein. Im ${tall ? 'Hochformat' : W === H ? 'quadratischen Format' : 'Querformat'} sind sie auf dem Handy schwer zu lesen.`,
      fix: sp ? 'Größe wie alle' : 'Auf „mittel“ stellen', run: apply(() => { if (sp) delete sp.st.size; else st.size = 'mittel'; })});
    const col = x.color || '#FFFFFF';
    if (x.bg){ const c = contrast(col, A11Y.box);
      if (c < A11Y.contrast && own('color')) out.push({k: 'contrast', text: `Die Schrift${who} hebt sich vor hellem Bild kaum vom Kasten ab (Kontrast ${fmtRatio(c)}, empfohlen sind mindestens 4,5 : 1).`,
        fix: sp ? 'Farbe wie alle' : 'Schrift weiß', run: apply(() => { if (sp) delete sp.st.color; else st.color = '#FFFFFF'; })}); }
    else if (x.outline !== false){ const oc = x.outlineColor || '#000000', c = contrast(col, oc);
      if (c < A11Y.contrast && (own('color') || own('outline'))) out.push({k: 'contrast', text: `Schrift und Umrandung${who} heben sich kaum voneinander ab (Kontrast ${fmtRatio(c)}, empfohlen sind mindestens 4,5 : 1).`,
        fix: sp ? 'Farbe wie alle' : `Umrandung ${bestOutline(col) === '#000000' ? 'schwarz' : 'weiß'}`, run: apply(() => { if (sp) delete sp.st.color; else st.outlineColor = bestOutline(col); })}); }
    else if (own('outline')) out.push({k: 'bare', text: `Die Untertitel${who} haben weder Umrandung noch Kasten. Vor hellem oder unruhigem Bild sind sie kaum zu lesen.`,
      fix: sp ? 'Umrandung wie alle' : 'Umrandung an', run: apply(() => { if (sp) delete sp.st.outline; else { st.outline = true; if (contrast(col, st.outlineColor || '#000000') < A11Y.contrast) st.outlineColor = bestOutline(col); } })});
  }
  if (trHas() && P.trans.mode !== 'off' && st.mode !== 'word'){ const ts = trStyle(), c = ts.outline !== false && !st.bg ? contrast(ts.color || '#FFFFFF', ts.outlineColor || '#000000') : 99;
    if (c < A11Y.contrast) out.push({k: 'contrast', text: `Übersetzung und Umrandung heben sich kaum voneinander ab (Kontrast ${fmtRatio(c)}, empfohlen sind mindestens 4,5 : 1).`}); }
  if (styleOnly) return out;
  const hard = new Set(); readIssues(computedCues()).forEach((q, k, a) => { if (q && (q.fast || q.short)) hard.add(k); });
  if (hard.size) out.push({k: 'read', text: `${hard.size === 1 ? 'Ein Untertitel steht' : hard.size + ' Untertitel stehen'} zu kurz im Bild, um mitzulesen.`, fix: 'Neu umbrechen', run: () => { readFix(); renderA11y(); }});
  if (exFmt === 'video' && P.settings.burn === false) out.push({k: 'burn', text: 'Die Untertitel werden nicht ins Video eingebrannt. Lade die SRT-Datei auf der Plattform mit hoch, damit sie dort zuschaltbar sind.'});
  return out;
}
let a11yRun = [];
function renderA11y(){
  if (!P) return;
  const paint = (box, list, okText) => { if (!box) return;
    box.innerHTML = list.length ? list.map((x, k) => `<div class="a11y-row"><span>${esc(x.text)}</span>${x.fix ? `<button type="button" class="btn small" data-k="${a11yRun.push(x.run) - 1}">${esc(x.fix)}</button>` : ''}</div>`).join('') : okText ? `<p class="a11y-ok small">${icon('✓')}<span>${okText}</span></p>` : '';
    box.classList.toggle('hidden', !list.length && !okText); };
  a11yRun = [];
  if (tab === 'export'){ const all = a11yIssues(false), warn = all.filter(x => x.k !== 'burn').length;
    paint($('#a11yList'), all, exFmt === 'audio' ? '' : 'Untertitel sind an, groß genug und heben sich gut ab.');
    $('#exA11y').classList.toggle('hidden', !warn); $('#exA11y span').textContent = warn === 1 ? 'Barrierefreiheit: 1 Hinweis zu den Untertiteln.' : `Barrierefreiheit: ${warn} Hinweise zu den Untertiteln.`; }
  else if (tab === 'subs') paint($('#a11ySub'), a11yIssues(true), '');
}
for (const id of ['a11yList', 'a11ySub']) $('#' + id).addEventListener('click', e => { const b = e.target.closest('[data-k]'), f = b && a11yRun[+b.dataset.k]; if (f){ f(); renderA11y(); } });
let a11yT = 0;
const a11yLater = () => { clearTimeout(a11yT); a11yT = setTimeout(() => { if (P && tab === 'subs') renderA11y(); }, 150); };
$('#exA11yBtn').onclick = () => $('#a11yCard').scrollIntoView({block: 'center', behavior: 'smooth'});
// ── Textfassung: der gesprochene Text mit Kapiteln, Sprecher:innen und Quellen, für alle, die das Video nicht hören oder nicht sehen ──
function textVersion(){
  if (order.length !== tokens.length) computeOrder();
  const {rows, byId} = refList(), foot = new Map(), chapAt = new Map(), out = [];
  for (const r of refsAll()){ const n = byId.get(r.id), ids = n ? refKept(r) : []; if (!ids.length) continue;   // Fußnote hinter dem letzten Wort der Stelle
    const last = ids.reduce((a, b) => pos[b] > pos[a] ? b : a); if (!foot.has(last)) foot.set(last, []); if (!foot.get(last).includes(n)) foot.get(last).push(n); }
  for (const m of marksOf('chap')){ const k = tokAtSrc(m.at); if (k >= 0 && !markGone(markOut(m))) chapAt.set(k, (m.text || 'Kapitel').trim()); }
  let cur = null, para = -1, src = -1, lastSpk = null, chap = null; const named = new Set();
  for (const i of order){
    const t = tokens[i]; if (chapAt.has(i)) chap = chapAt.get(i);   // die Überschrift steht vor dem nächsten Wort, das im Video bleibt
    if (!isTextTok(i) || isCut(i)) continue; const w = String(tokText(t) || '').trim(); if (!w) continue;
    const spk = t.spk || '', newSrc = t.src !== src && P.sources.length > 1;
    if (chap != null){ out.push({head: chap}); chap = null; cur = null; }
    if (!cur || t.p !== para || newSrc || spk !== lastSpk){
      const sp = spkOf(spk); let who = sp ? sp.name : '';
      if (sp && !named.has(sp.id)){ named.add(sp.id); const role = String(sp.role || '').trim(); if (role) who += ` (${role})`; }
      cur = {who, words: []}; out.push(cur); para = t.p; src = t.src; lastSpk = spk;
    }
    cur.words.push(w + (foot.has(i) ? ' ' + foot.get(i).sort((a, b) => a - b).map(n => `[${n}]`).join('') : ''));
  }
  const body = out.map(p => p.head != null ? `## ${p.head}` : (p.who ? p.who + ': ' : '') + p.words.join(' ').replace(/\s+([,.;:!?…»“)])/g, '$1').replace(/([„«(])\s+/g, '$1')).join('\n\n');
  if (!body) return '';
  return `${P.name || 'Video'}\nTextfassung des Videos · ${fmtT(total)}\n\n${body}` + (rows.length ? '\n\nQuellen\n' + rows.map((l, k) => `[${k + 1}] ${l}`).join('\n') : '') + '\n';
}
const textVersionName = () => (($('#exName').value || P.name || 'Video').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80)) + ' – Textfassung.txt';
const textvOn = () => { if (P && P.settings.textv != null) return !!P.settings.textv; try { return localStorage.getItem('hc-textv') === '1'; } catch(_){ return false; } };
$('#exTextv').onchange = e => { P.settings.textv = e.target.checked; try { localStorage.setItem('hc-textv', e.target.checked ? '1' : '0'); } catch(_){} changed(false); };
$('#tvSave').onclick = async () => {
  const txt = textVersion(); if (!txt){ $('#tvMsg').textContent = 'Noch kein Text vorhanden.'; return; }
  try { const m = await saveBlob(textVersionName(), new Blob([txt], {type: 'text/plain'})); if (m){ $('#tvMsg').textContent = m; toast(m.split(':')[0]); } } catch(e){ $('#tvMsg').textContent = 'Fehler: ' + e.message; }
};
$('#tvCopy').onclick = async () => {
  const txt = textVersion(); if (!txt){ $('#tvMsg').textContent = 'Noch kein Text vorhanden.'; return; }
  const ok = await copyText(txt); $('#tvMsg').textContent = ok ? 'Textfassung in der Zwischenablage.' : 'Kopieren hat nicht geklappt – bitte als Datei speichern.'; toast(ok ? 'Textfassung kopiert' : 'Kopieren fehlgeschlagen');
};

// ───────── Bauchbinden (B3) ─────────
// Name und Funktion einer Person als Einblendung im Design der Folien (Designprofil: Farben, Schriften, Akzentbalken).
// Automatisch: Jede Person, bei der die Bauchbinde eingeschaltet ist (lt), bekommt sie bei ihrem ersten Wort im geschnittenen Video;
// sie folgt dem Schnitt. Von Hand: ein Titel-Element mit lt (name, role) an beliebiger Stelle.
// P.lower = {pos: a/u/o (über den Untertiteln / unterer / oberer Rand) + l/m/r, size, dur} gilt für alle.
// Gezeichnet wird auf einer Leinwand in Ausgabegröße. Dasselbe Bild steht in der Vorschau und geht als Bild-Einblendung in jeden Export.
const LOWER_DEF = {pos: 'al', size: 1, dur: 4};
const lowerStyle = () => ({...LOWER_DEF, ...((P && P.lower) || {})});
let lowerMemo = null; const lowerRects = new Map();
function lowerList(){   // [{id, spk | item, name, role, a, e}] in Ausgabezeit, ohne Überschneidungen
  if (lowerMemo) return lowerMemo;
  const out = [], st = lowerStyle(); if (!P || !(total > 0)) return lowerMemo = out;
  const need = new Map(); for (const sp of P.speakers || []) if (sp.lt && String(sp.name || '').trim()) need.set(sp.id, sp);
  if (need.size && tokens.length){ if (order.length !== tokens.length) computeOrder();
    for (const i of order){ const t = tokens[i], sp = t.spk && need.get(t.spk); if (!sp || t.type !== 'word' || isCut(i)) continue;
      need.delete(t.spk); out.push({id: 'spk-' + sp.id, spk: sp.id, name: sp.name.trim(), role: String(sp.role || '').trim(), a: srcToOut(wS(t)), d: +st.dur || 4}); if (!need.size) break; } }
  for (const it of P.items) if (it.type === 'title' && it.lt && String(it.name || '').trim()) out.push({id: it.id, item: it, name: it.name.trim(), role: String(it.role || '').trim(), a: srcToOut(snapSrc(it.at)), d: it.dur});
  out.sort((x, y) => x.a - y.a);
  out.forEach((x, k) => { const nx = out[k + 1]; x.e = Math.min(total, x.a + Math.max(0.3, x.d), nx ? nx.a : Infinity); });   // die nächste löst die laufende ab
  return lowerMemo = out.filter(x => x.e - x.a > 0.1);
}
const lowerImgs = new Map(), lowerFontsOk = new Set();
const lowerFontKey = () => JSON.stringify(slProfile().fonts || {});
function lowerFonts(){   // Schriften des Designprofils laden; sind sie da, wird neu gezeichnet
  const k = lowerFontKey(); if (lowerFontsOk.has(k)) return Promise.resolve();
  return slFonts(slProfile()).then(() => { lowerFontsOk.add(k); lowerImgs.clear(); partImgs.clear(); if (P){ viewLower(); viewPart(); } }).catch(() => {});
}
const lowerReady = () => P && lowerList().length ? lowerFonts() : Promise.resolve();
function lowerImage(name, role, W, H){
  const pr = slProfile(), C = slColors(pr, pr.theme !== 'hell'), size = +lowerStyle().size || 1;
  const key = JSON.stringify([name, role, W, H, size, C.bg, C.fg, C.mute, C.acc, pr.fonts, pr.bar !== false, lowerFontsOk.has(lowerFontKey())]);
  let im = lowerImgs.get(key); if (im) return im;
  if (lowerImgs.size > 60) lowerImgs.clear();
  const u = Math.min(W, H) * (H > W ? 1.25 : 1) * size, nameF = slFontFn(pr.fonts.head, 800), roleF = slFontFn(pr.fonts.body, 500);
  const cv = document.createElement('canvas'), ctx = cv.getContext('2d');
  let ns = u * 0.042, rs = u * 0.027;
  const width = () => { ctx.font = nameF(ns); const a = ctx.measureText(name).width; ctx.font = roleF(rs); return Math.max(a, role ? ctx.measureText(role).width : 0); };
  const bar = pr.bar !== false ? Math.round(ns * 0.2) : 0;
  let tw = width(), padX = ns * 0.6; const fit = (W * 0.84 - bar - 2 * padX) / tw;
  if (fit < 1){ const g = Math.max(0.45, fit); ns *= g; rs *= g; padX = ns * 0.6; tw = width(); }   // lange Namen: Schrift verkleinern, bis die Bauchbinde ins Bild passt
  const padY = ns * 0.42, gap = role ? ns * 0.16 : 0, w = Math.ceil(bar + 2 * padX + tw), h = Math.ceil(2 * padY + ns * 1.08 + (role ? gap + rs * 1.15 : 0));
  cv.width = w; cv.height = h;
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h); if (bar){ ctx.fillStyle = C.acc; ctx.fillRect(0, 0, bar, h); }
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
  ctx.fillStyle = C.fg; ctx.font = nameF(ns); ctx.fillText(name, bar + padX, padY + ns * 0.56);
  if (role){ ctx.fillStyle = C.mute; ctx.font = roleF(rs); ctx.fillText(role, bar + padX, padY + ns * 1.08 + gap + rs * 0.58); }
  im = {key, cv, url: cv.toDataURL('image/png'), w, h}; lowerImgs.set(key, im); return im;
}
// Streifen, in dem die Untertitel stehen (Grundeinstellung): [oben, unten] in Pixeln, null ohne Untertitel
function subBand(W, H){
  const st = S(); if (!P.cues.length || st.enabled === false) return null;
  const rows = (st.mode === 'word' ? 1 : Math.max(1, +st.lines || 2)) * (trHas() && P.trans.mode === 'both' && st.mode !== 'word' ? 2 : 1);
  const px = subPx(W, H, st), bh = px * 1.15 * rows + (st.bg ? px * 0.2 : 0), cy = (st.y ?? 0.88) * H;
  return [cy - bh / 2, cy + bh / 2];
}
// So weit reichen Textzeile und Quellenzeile vom oberen bzw. unteren Rand ins Bild (0: dort steht keine)
function linesReach(W, H, side){
  let v = 0;
  if (tlineOn() && (({...TLINE_DEF, ...P.textline}).pos || 'ul')[0] === side){ const L = tlineLayout(W, H); v = (side === 'o' ? L.mT : L.mB) + L.px * 1.12 + 2 * L.padY; }
  if (srcStyle().pos[0] === side && refCues().length){ const L = srcLayout('Quelle', W, H); v = Math.max(v, (side === 'o' ? L.mT : L.mB) + L.px * 1.12 + 2 * L.padY); }
  return v;
}
// Linke obere Ecke der Bauchbinde in Ausgabe-Pixeln: am Rand der freien Fläche, neben Textzeile und Quellenzeile, auf Wunsch über den Untertiteln
function lowerRect(im, W, H){
  const rk = im.key + '|' + W + '|' + H; if (lowerRects.has(rk)) return lowerRects.get(rk);
  const p = lowerStyle().pos || 'al', z = safeZone(), mn = Math.min(W, H), m = 0.04 * mn, gap = 0.014 * mn, top = p[0] === 'o';
  const mL = Math.max(m, z ? z.l * W : 0), mR = Math.max(m, z ? (top ? z.r : Math.max(z.r, z.cw)) * W : 0);
  const rT = linesReach(W, H, 'o'), rB = linesReach(W, H, 'u'), mT = Math.max(m, z ? z.t * H : 0, rT ? rT + gap : 0), mB = Math.max(m, z ? z.b * H : 0, rB ? rB + gap : 0);
  const x = p[1] === 'l' ? mL : p[1] === 'r' ? W - mR - im.w : (W - im.w) / 2;
  let y = top ? mT : H - mB - im.h;
  if (p[0] === 'a'){ const b = subBand(W, H); if (b && b[0] < y + im.h + gap && b[1] > y - gap){ const up = b[0] - gap - im.h; if (up >= mT) y = up; } }
  const pb = partBox(W, H);   // „Teil 1/3“ in derselben Ecke: die Bauchbinde rückt darunter bzw. darüber
  if (pb && x < pb.x + pb.w + gap && x + im.w > pb.x - gap && y < pb.y + pb.h + gap && y + im.h > pb.y - gap) y = top ? pb.y + pb.h + gap : pb.y - gap - im.h;
  const r = {x, y}; lowerRects.set(rk, r); return r;
}
function placeLower(W, H, o){
  const box = $('#lowerOv'), x = P ? lowerList().find(q => o >= q.a - 1e-3 && o < q.e) : null;
  if (!x){ if (box.firstChild) box.textContent = ''; return; }
  if (!lowerFontsOk.has(lowerFontKey())) lowerFonts();
  const [OW, OH] = outSize(), k = W / OW, im = lowerImage(x.name, x.role, OW, OH), r = lowerRect(im, OW, OH);
  let el = box.firstChild; if (!el){ el = document.createElement('img'); el.alt = ''; box.append(el); }
  const key = [im.key, W, r.x.toFixed(1), r.y.toFixed(1)].join('|'); if (el.dataset.k === key) return; el.dataset.k = key;
  if (el.dataset.src !== im.key){ el.src = im.url; el.dataset.src = im.key; }
  Object.assign(el.style, {left: (r.x * k).toFixed(1) + 'px', top: (r.y * k).toFixed(1) + 'px', width: (im.w * k).toFixed(1) + 'px', height: (im.h * k).toFixed(1) + 'px'});
}
const viewLower = () => { const st = $('#stage'); placeLower(st.clientWidth, st.clientHeight, outPos); };
// Für den Export: jede Bauchbinde als Bild-Einblendung über allen Clips (Spur 98, unter dem Wasserzeichen)
function lowerPlan(W, H){
  const out = []; if (!TS.saveImage) return out;
  for (const x of lowerList()){
    const im = lowerImage(x.name, x.role, W, H), m = J(TS.saveImage(`bauchbinde-${hashStr(im.key)}.png`, im.url, im.w, im.h, P.id)); if (!m || !m.uri) continue;
    const r = lowerRect(im, W, H);
    out.push({mode: 'pip', image: true, uri: m.uri, in: 0, out: r3(x.e - x.a), at: r3(x.a), x: +((r.x + im.w / 2) / W).toFixed(4), y: +((r.y + im.h / 2) / H).toFixed(4), w: +(im.w / W).toFixed(4), aspect: +(im.w / im.h).toFixed(5),
      track: 98, vol: 0, hasAudio: false, width: im.w, height: im.h, rotation: 0, lower: true});
  }
  return out;
}
// Neue Person oder Bauchbinde von Hand: Name, Funktion und ob die Bauchbinde beim ersten Auftritt erscheint
function askPerson(title, v0 = {}, opt = {}){   // → null, {del: true} oder {name, role, lt, dur}
  return new Promise(res => {
    const m = hcModal(`<h3>${esc(title)}</h3>
      <label class="col">Name <input type="text" id="apName" maxlength="60" dir="auto" style="font-size:16px"${opt.names ? ' list="apNames"' : ''}></label>${opt.names ? `<datalist id="apNames">${opt.names.map(n => `<option value="${esc(n)}">`).join('')}</datalist>` : ''}
      <label class="col">Funktion <input type="text" id="apRole" maxlength="80" dir="auto" placeholder="z. B. Sprecherin, Bündnis XY"></label>
      ${opt.dur ? '<label class="row">Dauer (s) <input type="number" id="apDur" min="0.5" max="60" step="0.5" style="width:90px"></label>' : '<label class="row"><input type="checkbox" id="apLt"> Bauchbinde beim ersten Auftritt zeigen</label>'}
      <p class="muted small">${opt.dur ? 'Die Bauchbinde erscheint an der Abspiellinie. Sie lässt sich in der Zeitleiste verschieben und kürzen.' : 'Die Funktion steht in der Bauchbinde unter dem Namen und in der Textfassung.'}</p>
      <div class="row" style="margin-top:12px">${opt.del ? '<button class="btn danger" id="apDel">Entfernen</button>' : ''}<button class="btn" id="apNo" style="margin-left:auto">Abbrechen</button><button class="btn primary" id="apOk">OK</button></div>`);
    const q = id => m.querySelector('#' + id); let touched = false;
    q('apName').value = v0.name || ''; q('apRole').value = v0.role || ''; if (q('apLt')) q('apLt').checked = !!v0.lt; if (q('apDur')) q('apDur').value = v0.dur || LOWER_DEF.dur;
    if (q('apLt')){ q('apLt').onchange = () => touched = true; q('apRole').oninput = () => { if (!touched) q('apLt').checked = !!q('apRole').value.trim(); }; }
    if (opt.roles) q('apName').addEventListener('input', () => { const r = opt.roles[q('apName').value.trim()]; if (r != null && !q('apRole').value.trim()) q('apRole').value = r; });   // bekannte Person gewählt: Funktion übernehmen
    const done = v => { closeHcModal(); res(v); };
    const ok = () => { const name = q('apName').value.replace(/\s+/g, ' ').trim(); if (!name){ q('apName').focus(); return; }
      done({name, role: q('apRole').value.replace(/\s+/g, ' ').trim(), lt: q('apLt') ? q('apLt').checked : true, dur: q('apDur') ? clamp(+q('apDur').value || LOWER_DEF.dur, 0.5, 60) : 0}); };
    q('apNo').onclick = () => done(null); q('apOk').onclick = ok; if (q('apDel')) q('apDel').onclick = () => done({del: true});
    m.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target.type !== 'checkbox'){ e.preventDefault(); ok(); } else if (e.key === 'Escape') done(null); });
    setTimeout(() => { if (q('apName').isConnected){ q('apName').focus(); q('apName').select(); } }, 30);
  });
}
const lowerText = (name, role) => name + (role ? ' · ' + role : '');
function lowerChanged(){ viewLower(); if (tlOn() && window.renderTimeline) renderTimeline(); if (lowerSheetOpen()) paintLowerSheet(); if (tab === 'export') renderExport(); }
async function addLower(){
  if (!P || !timeline.length || $('#hcModal')) return;
  const P0 = P, at = r3(outToSrcT(outPos)), roles = Object.fromEntries((P.speakers || []).map(sp => [sp.name, sp.role || '']));
  const v = await askPerson('Bauchbinde', {dur: lowerStyle().dur}, {dur: true, names: Object.keys(roles), roles}); if (!v || P !== P0) return;
  let it; commit(() => { it = {id: newId(), type: 'title', lt: true, at, dur: v.dur, name: v.name, role: v.role, text: lowerText(v.name, v.role), x: 0.5, y: 0.8, size: 'mittel', scale: 1, color: '#FFFFFF', outline: true, bg: true}; P.items.push(it); }, tlOn());
  lowerChanged(); toast(`Bauchbinde „${v.name}“ bei ${fmtT(srcToOut(snapSrc(at)))}`);
}
async function editLower(id){
  const it = P.items.find(x => x.id === id), P0 = P; if (!it || !it.lt || $('#hcModal')) return;
  const v = await askPerson('Bauchbinde', {name: it.name, role: it.role, dur: it.dur}, {dur: true, del: true}); if (!v || P !== P0 || !P.items.includes(it)) return;
  if (v.del) commit(() => { P.items = P.items.filter(x => x !== it); }, tlOn());
  else if (v.name !== it.name || v.role !== (it.role || '') || v.dur !== it.dur) commit(() => { it.name = v.name; it.role = v.role; it.dur = v.dur; it.text = lowerText(v.name, v.role); }, tlOn());
  else return;
  lowerChanged();
}
// ── Blatt „Bauchbinden“: Übersicht, neue Bauchbinde, Lage und Größe für alle ──
const lowerSheetOpen = () => !$('#sheet').classList.contains('hidden') && !!$('#lwSheet');
function openLower(){
  if (!P) return; sheetItem = null;
  const body = $('#sheetBody'); body.innerHTML = '<div id="lwSheet"></div>'; body.onclick = null;
  const box = $('#lwSheet'), set = patch => { commitBurst('lower', () => { P.lower = {...lowerStyle(), ...patch}; }); lowerChanged(); };
  box.addEventListener('click', e => {
    const rowEl = e.target.closest('.mk-row'), a = e.target.closest('[data-a]'), act = a ? a.dataset.a : '', x = rowEl && lowerList().find(q => q.id === rowEl.dataset.id);
    if (x && act === 'edit') return x.item ? editLower(x.item.id) : (closeSheet(), setTab('subs'), setTimeout(() => $('#spkCard').scrollIntoView({block: 'center', behavior: 'smooth'}), 80));
    if (x && e.target.closest('.mk-go')){ if (playing) pausePlay(); seekOut(Math.min(x.a + 0.02, Math.max(0, total - 0.01)), false); tlReveal(); return; }
    if (act === 'add') return addLower();
    if (act === 'ok') return closeSheet();
  });
  const onIn = e => { const id = e.target.id;
    if (id === 'lwV' || id === 'lwH') set({pos: $('#lwV').value + $('#lwH').value}); else if (id === 'lwSize') set({size: +e.target.value}); else if (id === 'lwDur' && e.type === 'change') set({dur: clamp(+e.target.value || LOWER_DEF.dur, 1, 30)}); };
  box.addEventListener('input', onIn); box.addEventListener('change', onIn);
  box.addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') e.stopPropagation(); });
  box.innerHTML = `<h3>Bauchbinden</h3><div id="lwRows"></div>
    <div class="row wrap"><button class="btn small" data-a="add">＋ Bauchbinde an der Abspiellinie</button></div>
    <div class="grid2" style="margin-top:10px">
      <label>Höhe <select id="lwV"><option value="a">über den Untertiteln</option><option value="u">unterer Rand</option><option value="o">oberer Rand</option></select></label>
      <label>Seite <select id="lwH"><option value="l">links</option><option value="m">Mitte</option><option value="r">rechts</option></select></label>
      <label>Dauer beim ersten Auftritt (s) <input type="number" id="lwDur" min="1" max="30" step="0.5"></label>
    </div>
    <div class="field"><span>Größe <b id="lwSizeV"></b></span><input type="range" id="lwSize" min="0.7" max="1.6" step="0.05"></div>
    <p class="muted small">Farben, Schriften und der Balken kommen aus dem Designprofil deiner Folien. Schutzzonen, Textzeile und Quellenzeile bleiben frei. Im Export liegt jede Bauchbinde als Bild über allen Clips.</p>
    <div class="row" style="margin-top:12px"><button class="btn primary" data-a="ok" style="margin-left:auto">Fertig</button></div>`;
  paintLowerSheet(); openSheet(true);
}
function paintLowerSheet(){
  const rows = $('#lwRows'); if (!rows) return; const st = lowerStyle(), list = lowerList();
  const off = (P.speakers || []).filter(sp => sp.lt && !list.some(x => x.spk === sp.id)).map(sp => sp.name);
  rows.innerHTML = (list.length ? list.map(x => `<div class="mk-row rf-row" data-id="${x.id}"><button type="button" class="mk-go" title="Zur Stelle springen"><span class="mono">${fmtT(x.a)}</span><span class="mk-t" dir="auto"><b>${esc(x.name)}</b><i>${esc(x.role || (x.spk ? 'erster Auftritt' : ''))}${x.spk && x.role ? ' · erster Auftritt' : ''}</i></span></button><button type="button" class="mini" data-a="edit" title="${x.spk ? 'Bei den Sprecher:innen einstellen' : 'Bearbeiten'}">✎</button></div>`).join('')
      : '<p class="muted small">Noch keine Bauchbinden. Bei den Sprecher:innen (Reiter „Untertitel“) eine Funktion eintragen: Dann erscheint die Bauchbinde von selbst beim ersten Auftritt der Person.</p>')
    + (off.length ? `<p class="muted small">${esc(off.join(', '))}: noch ohne Auftritt im geschnittenen Video.</p>` : '');
  if (document.activeElement !== $('#lwV')) $('#lwV').value = (st.pos || 'al')[0]; if (document.activeElement !== $('#lwH')) $('#lwH').value = (st.pos || 'al')[1];
  if (document.activeElement !== $('#lwDur')) $('#lwDur').value = st.dur; $('#lwSize').value = st.size; $('#lwSizeV').textContent = Math.round(st.size * 100) + ' %';
}
$('#lowerBtn').onclick = openLower;

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
    {icon: icon('✎'), label: 'Eigenes Wörterbuch', fn: () => openDict()},
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
  body.innerHTML = `<h3>Wort korrigieren</h3><input type="text" id="wordEdit" dir="auto" style="width:100%;font:18px var(--read)"><p class="muted small">Die Zeit im Video bleibt gleich – nur der Text (auch in den Untertiteln) ändert sich. Leer lassen löscht das Wort.</p>
    <label class="row small"><input type="checkbox" id="wordDict"> Künftig immer so schreiben (ins Wörterbuch)</label>
    <div class="row"><button class="btn" id="wordReset">↺ Original: </button><button class="btn primary" id="wordOk" style="margin-left:auto">Fertig</button></div>`;
  $('#wordEdit').value = tokText(tokens[i]); $('#wordReset').textContent += tokens[i].text;
  openSheet(false); setTimeout(() => { $('#wordEdit').focus(); $('#wordEdit').select(); }, 30);
  const done = v => { const learn = v !== null && !!v.trim() && $('#wordDict').checked; let more = -1; closeSheet();
    commit(() => { if (v === null) delete P.edits[i]; else if (!v.trim()) bulkDelete([i]); else if (v.trim() === tokens[i].text) delete P.edits[i]; else P.edits[i] = v.trim();
      if (learn) more = dictLearn(tokens[i].text, v.trim()); }, false);
    afterTextEdit(learn ? dictLearnMsg(more) : ''); clearSel(); };
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
        const endS = SENT_END.test(tokText(prev)) && len > maxChars * 0.35, comma = /[,;:،؛]$/.test(tokText(prev)) && len > maxChars * 0.7;
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
      if (SENT_END.test(tokens[prev.b] ? tokText(tokens[prev.b]) : '') || lenOf(cw) > maxChars * 0.3) continue;
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
// Übersetzung je Untertitel: satzweise gespeichert (P.trans.sent: Satz des Originals → übersetzter Satz) und erst beim
// Anzeigen auf die Untertitel des Satzes verteilt. Bei „1 Wort pro Untertitel“ gleichmäßig nach Anzahl: Hat die Übersetzung
// weniger Wörter, bleibt ein Wort stehen; hat sie mehr, erscheinen zwei Wörter zugleich. Einzelne Verbesserungen je Untertitel
// (Zeilen-Modus) liegen in P.trans.map und gehen vor.
const trMemo = {list: null, out: null};
function trTexts(list){
  if (trMemo.list === list) return trMemo.out;
  const t = P && P.trans, out = new Array(list.length).fill(null);
  if (t && t.mode !== 'off'){
    const word = S().mode === 'word', idx = new Map(list.map((x, i) => [x, i]));
    for (const g of trGroups(list)){
      const sent = trSent(t.sent, trGroupKey(g)), parts = sent ? (word ? trEven(g.length, sent) : trSpread(g, sent)) : null;
      g.forEach((x, i) => { const ov = t.map && t.map[trKey(x.text)], v = word ? (parts ? parts[i] : ov) : (ov ?? (parts ? parts[i] : null)); out[idx.get(x)] = v && String(v).trim() ? v : null; });
    }
  }
  trMemo.list = list; trMemo.out = out; return out;
}
const trGroupKey = g => trKey(g.map(x => x.text).join(' '));
// Satz suchen – auch wenn die Untertitel inzwischen anders gebündelt sind (z. B. nach dem Wechsel zu „1 Wort pro Untertitel“)
const trSplitS = t => (t.match(/[^.!?…]+(?:[.!?…]+["»«”“')\]]*|$)/g) || []).map(x => x.trim()).filter(Boolean);
function trSent(sent, gk){
  if (!sent) return null; if (sent[gk]) return sent[gk];
  const keys = Object.keys(sent);
  for (const k of keys) if (k.includes(gk)){ const a = trSplitS(k), b = trSplitS(sent[k]), i = a.findIndex(x => trKey(x) === gk);
    if (i >= 0 && a.length === b.length) return b[i];
    { const pos = k.indexOf(gk) / k.length, end = (k.indexOf(gk) + gk.length) / k.length, w = sent[k].split(/\s+/); return w.slice(Math.round(pos * w.length), Math.max(Math.round(pos * w.length) + 1, Math.round(end * w.length))).join(' '); } }
  const inner = keys.filter(k => gk.includes(k)).sort((x, y) => gk.indexOf(x) - gk.indexOf(y));
  return inner.length && inner.reduce((n, k) => n + k.length, 0) > gk.length * 0.6 ? inner.map(k => sent[k]).join(' ') : null;
}
function trEven(n, tr){ const w = tr.split(/\s+/).filter(Boolean), m = w.length; if (!m) return new Array(n).fill(null);
  return Array.from({length: n}, (_, i) => { const a = Math.floor(i * m / n), b = Math.floor((i + 1) * m / n); return b > a ? w.slice(a, b).join(' ') : w[Math.min(a, m - 1)]; }); }
const trHas = () => !!(P && P.trans && ((P.trans.sent && Object.keys(P.trans.sent).length) || (P.trans.map && Object.keys(P.trans.map).length)));
// Eigener Stil der Übersetzung (P.trans.style): Schrift, Farbe, Größe, Umrandung, Kasten, Lage unter/über dem Original
const TR_STYLE = {font: null, color: '#CFC6B0', size: 'klein', outline: true, bg: false, pos: 'unter', outlineColor: null};
function trStyle(){ const st = S(), t = (P.trans && P.trans.style) || {}; const r = {...TR_STYLE, font: st.font || '', outline: st.outline !== false, ...t}; r.outlineColor ||= st.outlineColor || '#000000'; return r; }
const escH = t => String(t).replace(/[&<>]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;'}[c]));
// Vorschau: Original und Übersetzung als zwei Blöcke im selben Untertitel – die Übersetzung mit eigenem Stil
function subHtml(text, tr, base, fx){
  if (tr == null) return null;
  const ts = trStyle(), rel = (SIZE_F[ts.size] || 0.045) / (SIZE_F[base.size] || 0.058), stage = $('#stage'), px = subPx(stage.clientWidth || 1, stage.clientHeight || 1, base) * rel, o = Math.max(1, px / 14);
  const sh = ts.outline ? [[-1,-1],[1,-1],[-1,1],[1,1],[0,-1.4],[0,1.4],[-1.4,0],[1.4,0]].map(([x, y]) => `${(x*o).toFixed(1)}px ${(y*o).toFixed(1)}px 0 ${ts.outlineColor}`).join(',') : `0 ${(px/20).toFixed(1)}px ${(px/10).toFixed(1)}px rgba(0,0,0,.8)`;
  const trCss = `display:block;color:${ts.color};font-size:${rel.toFixed(3)}em;font-family:${fontCss(ts.font).replace(/"/g, "'")};font-weight:${fontWeight(ts.font)};text-shadow:${sh}` + (ts.bg ? `;background:rgba(0,0,0,.6);border-radius:${(px*0.18).toFixed(1)}px;padding:${(px*0.1).toFixed(1)}px ${(px*0.3).toFixed(1)}px;width:fit-content;margin:auto` : '');
  const tb = `<span style="${trCss}">${escH(trWrap(tr))}</span>`;
  if (P.trans.mode === 'only') return tb;
  const ob = `<span style="display:block">${fx ? subWordsHtml(wrapText(text)) : escH(wrapText(text))}</span>`;
  return ts.pos === 'über' ? tb + ob : ob + tb;
}
function trWrap(tr){
  // Zeilenlänge wie beim Original, umgerechnet auf die Schriftgröße der Übersetzung; Zeilen möglichst gleich lang
  const ts = trStyle(), max = Math.max(12, Math.round((+S().chars || 32) * (SIZE_F[S().size] || 0.058) / (SIZE_F[ts.size] || 0.045)));
  if (tr.length <= max) return tr;
  const words = tr.split(/\s+/).filter(Boolean), n = Math.ceil(tr.length / max), per = tr.length / n, out = []; let cur = '';
  for (const w of words){ const t = cur ? cur + ' ' + w : w; if (cur && (t.length > max || (cur.length >= per && out.length < n - 1))){ out.push(cur); cur = w; } else cur = t; }
  if (cur) out.push(cur); return out.join('\n');
}
// Export: Original und Übersetzung als zwei Untertitel, als Block um die Untertitel-Position gesetzt und im Bild gehalten
function trCues(o, tr, W, H, base){
  if (tr == null) return [o];
  const ts = trStyle(), port = H > W ? 1.25 : 1, fT = SIZE_F[ts.size] || 0.045, tx = trWrap(tr);
  const t = {...o, text: tx, color: ts.color, size: fT, outline: !!ts.outline, font: ts.font || '', outlineColor: ts.outlineColor}; if (ts.bg) t.bg = true; else delete t.bg;
  for (const k of ['words', 'hl', 'build', 'spans']) delete t[k];   // Wort-Effekte gehören zum Original, die Übersetzung hat andere Wörter
  if (P.trans.mode === 'only') return [t];
  const fO = o.size || SIZE_F[base.size] || 0.058, hO = o.text.split('\n').length * fO * Math.min(W, H) * port * 1.15 / H, hT = tx.split('\n').length * fT * Math.min(W, H) * port * 1.15 / H;
  const gap = fO * Math.min(W, H) * port * 0.2 / H, tot = hO + gap + hT, m = 0.02, top = clamp(o.y - tot / 2, m, Math.max(m, 1 - m - tot));
  const up = ts.pos === 'über';
  o = {...o, y: +(up ? top + hT + gap + hO / 2 : top + hO / 2).toFixed(4)}; t.y = +(up ? top + hT / 2 : top + hO + gap + hT / 2).toFixed(4);
  return up ? [t, o] : [o, t];
}
function paintTrStyle(){ if (!P) return; const ts = trStyle(); fillFontSelects(); $('#trFont').value = ts.font || ''; $('#trColor').value = ts.color.toLowerCase(); $('#trSize').value = ts.size;
  $('#trPos').value = ts.pos; $('#trOutline').checked = !!ts.outline; $('#trBg').checked = !!ts.bg; $('#trOutlineColor').value = ts.outlineColor.toLowerCase(); $('#trOutlineColor').disabled = !ts.outline; }
function setTrStyle(k, v){ if (!P) return; commit(() => { P.trans ||= {lang: 'en', mode: 'both', map: {}, sent: {}}; P.trans.style = {...(P.trans.style || {}), [k]: v}; }, false); cueCache.at = -1; shownCue = null; updateSubs(outPos); }
$('#trFont').onchange = async () => { if ($('#trFont').value === '__import'){ const f = await importFont(); fillFontSelects(); if (f) setTrStyle('font', f.key); paintTrStyle(); return; } setTrStyle('font', $('#trFont').value); };
$('#trColor').oninput = () => setTrStyle('color', $('#trColor').value.toUpperCase());
$('#trSize').onchange = () => setTrStyle('size', $('#trSize').value);
$('#trPos').onchange = () => setTrStyle('pos', $('#trPos').value);
$('#trOutline').onchange = () => setTrStyle('outline', $('#trOutline').checked);
$('#trBg').onchange = () => setTrStyle('bg', $('#trBg').checked);
$('#trOutlineColor').oninput = () => setTrStyle('outlineColor', $('#trOutlineColor').value.toUpperCase());
$('#trStyleSame').onclick = () => { const st = S(); commit(() => { P.trans ||= {lang: 'en', mode: 'both', map: {}}; P.trans.style = {font: st.font || '', color: st.color, size: st.size, outline: st.outline !== false, bg: !!st.bg, pos: trStyle().pos, outlineColor: st.outlineColor || '#000000'}; }, false); paintTrStyle(); cueCache.at = -1; shownCue = null; updateSubs(outPos); };
// Text, wie er im Bild steht (Vorschau und Export)
function subDisplay(text, tr){
  if (tr == null) return wrapText(text);
  if (P.trans.mode === 'only') return wrapText(tr);
  const st = S(), max = Math.max(+st.chars || 32, 24);
  return wrapText(text) + '\n' + (tr.length > max * 1.15 ? (() => { const mid = tr.length / 2; let b = -1; for (let i = 0; i < tr.length; i++) if (tr[i] === ' ' && (b < 0 || Math.abs(i - mid) < Math.abs(b - mid))) b = i; return b < 0 ? tr : tr.slice(0, b) + '\n' + tr.slice(b + 1); })() : tr);
}
// Untertitel zu Sätzen bündeln, Satz für Satz übersetzen und die Übersetzung wieder auf die einzelnen Untertitel verteilen
// (nach Textlänge, an Wortgrenzen) – Bruchstücke einzeln zu übersetzen ergäbe schiefe Sätze.
function trGroups(list){
  const out = []; let cur = [];
  list.forEach((x, k) => { cur.push(x); const n = list[k + 1], txt = trKey(x.text);
    if (!n || /[.!?…:;]["»«”“')\]]*$/.test(txt) || n.s - x.e > 1.2 || cur.length >= (S().mode === 'word' ? 40 : 6)){ out.push(cur); cur = []; } });
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
      setTranslation(groups, groups.map((g, k) => String(res[k] || '').trim()), lang);
      toast('Übersetzung fertig – unten bei jedem Untertitel nachbessern'); },
    j => { end(); $('#trMsg').textContent = j.status === 'cancelled' ? 'Abgebrochen' : 'Fehlgeschlagen: ' + (j.error || ''); });
}
// Übersetzung satzweise übernehmen (aus der eingebauten Übersetzung oder von außen eingefügt)
function setTranslation(groups, texts, lang){
  commit(() => { const sent = {}; groups.forEach((g, k) => { if (texts[k]) sent[trGroupKey(g)] = texts[k]; });
    P.trans = {lang, mode: (P.trans && P.trans.mode !== 'off' && P.trans.mode) || 'both', style: P.trans && P.trans.style, sent, map: {}}; if (!P.trans.style) delete P.trans.style; }, false);
  cueCache.at = -1; trMemo.list = null; shownCue = null; paintTrans(); seekOut(outPos, false); if (tab === 'subs') renderSubs();
}
function paintTrans(){
  if (!P) return; paintTrStyle(); const t = P.trans, n = trHas() ? 1 : 0;
  $('#trMode').value = t ? t.mode || 'both' : 'both'; $('#trMode').disabled = !n;
  if (t && t.lang) $('#trLang').value = t.lang;
  $('#trBtn').textContent = n ? 'Neu übersetzen' : 'Übersetzung erzeugen';
  if (!$('#trProg').classList.contains('hidden')) return;
  const list = n ? computedCues() : [], trs = n ? trTexts(list) : [], missing = trs.filter(v => v == null).length;
  $('#trMsg').textContent = !n ? '' : missing ? `${missing} von ${list.length} Untertiteln ohne Übersetzung (geändert?) – „Neu übersetzen“, neu einfügen oder unten ergänzen` : `Alle ${list.length} Untertitel übersetzt`;
}
$('#trBtn').onclick = () => { if (trHas() && !confirm('Die Übersetzung neu erzeugen? Eigene Verbesserungen gehen dabei verloren.')) return; runTranslate(); };
// Text für eine Übersetzung außerhalb: ein Satz pro Zeile (genau so wieder einfügen = sichere Zuordnung)
$('#trExport').onclick = async () => {
  if (!P) return; const g = trGroups(computedCues()); if (!g.length) return toast('Noch keine Untertitel');
  const txt = g.map(x => x.map(y => trKey(y.text)).join(' ')).join('\n') + '\n';
  try { await copyText(txt); } catch(_){}
  saveBlob((P.name || 'Untertitel').replace(/[\\/:*?"<>|]/g, '_') + ' – zum Übersetzen.txt', new Blob([txt], {type: 'text/plain;charset=utf-8'}));
  toast(`${g.length} Sätze kopiert und als Textdatei gespeichert – ein Satz pro Zeile`);
};
// Übersetzung von außen einfügen: Zeile für Zeile, sonst Satz für Satz, sonst nach Länge verteilt; SRT wird erkannt
function trAlign(raw, groups){
  let text = String(raw || '').replace(/\r/g, '');
  if (/-->/.test(text)) text = text.split(/\n\s*\n/).map(b => b.split('\n').filter(l => l.trim() && !/^\d+$/.test(l.trim()) && !/-->/.test(l)).join(' ')).filter(Boolean).join('\n');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === groups.length) return {texts: lines, how: 'Zeile für Zeile'};
  const flat = text.replace(/\s+/g, ' ').trim(), sents = (flat.match(/[^.!?…]+(?:[.!?…]+["»«”“')\]]*|$)/g) || []).map(x => x.trim()).filter(Boolean);
  if (sents.length === groups.length) return {texts: sents, how: 'Satz für Satz'};
  return {texts: trSpread(groups.map(g => ({text: g.map(x => x.text).join(' ')})), flat), how: 'nach Länge verteilt – bitte prüfen', loose: true};
}
$('#trImport').onclick = () => {
  if (!P) return; const groups = trGroups(computedCues()); if (!groups.length) return toast('Noch keine Untertitel');
  const body = $('#sheetBody');
  body.innerHTML = `<h3>Übersetzung einfügen</h3>
    <p class="muted small">Am sichersten: mit „Text exportieren“ einen Satz pro Zeile ausgeben, übersetzen lassen und die Übersetzung wieder Zeile für Zeile hier einfügen (${groups.length} Zeilen). Anderer Text wird Satz für Satz oder nach Länge zugeordnet; SRT-Dateien gehen auch. Bei „1 Wort pro Untertitel“ springt die Übersetzung mit jedem Wort des Originals mit – bei weniger Wörtern bleibt ein Wort stehen, bei mehr erscheinen zwei.</p>
    <label class="field"><span>Sprache</span><select id="tiLang"><option value="en">Englisch</option><option value="fr">Französisch</option><option value="es">Spanisch</option><option value="it">Italienisch</option><option value="tr">Türkisch</option><option value="ar">Arabisch</option><option value="uk">Ukrainisch</option><option value="pl">Polnisch</option><option value="xx">andere</option></select></label>
    <textarea id="tiText" rows="10" placeholder="Übersetzung hier einfügen …" style="width:100%"></textarea>
    <div class="row wrap"><label class="btn">Textdatei laden (.txt, .srt)<input type="file" id="tiFile" accept=".txt,.srt,text/plain" hidden></label><span class="muted small" id="tiInfo"></span></div>
    <div class="row" style="margin-top:12px"><button class="btn" id="tiCancel">Abbrechen</button><button class="btn primary" id="tiOk" style="margin-left:auto">Einsetzen</button></div>`;
  openSheet(false);
  $('#tiLang').value = (P.trans && P.trans.lang) || 'en';
  const info = () => { const v = $('#tiText').value; if (!v.trim()){ $('#tiInfo').textContent = ''; return; } const a = trAlign(v, groups); $('#tiInfo').textContent = `Zuordnung: ${a.how}`; };
  $('#tiText').oninput = info;
  $('#tiFile').onchange = async () => { const f = $('#tiFile').files[0]; if (!f) return; $('#tiText').value = await f.text(); info(); };
  $('#tiCancel').onclick = closeSheet;
  $('#tiOk').onclick = () => { const v = $('#tiText').value; if (!v.trim()) return toast('Erst die Übersetzung einfügen');
    const a = trAlign(v, groups), lang = $('#tiLang').value;
    if (![...$('#trLang').options].some(o => o.value === lang)) $('#trLang').insertAdjacentHTML('beforeend', `<option value="${lang}">${$('#tiLang').selectedOptions[0].textContent}</option>`);
    closeSheet(); setTranslation(groups, a.texts, lang); toast(`Übersetzung eingesetzt – ${a.how}`); };
};
$('#trMode').onchange = () => { if (!P || !P.trans) return; commit(() => { P.trans.mode = $('#trMode').value; }, false); cueCache.at = -1; trMemo.list = null; seekOut(outPos, false); paintTrans(); if (tab === 'subs') renderSubs(); };
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
// Was gerade im Bild steht (Eintrag der berechneten Liste, oder false = nichts). Solange derselbe Untertitel läuft,
// bleibt das Dokument unberührt – früher wurden Text und Lage bei jedem Bild neu gesetzt.
let subShown = null;
function updateSubs(o){
  const ov = $('#subOv');
  if (!P || !P.cues.length || S().enabled === false){ if (subShown !== false){ ov.textContent = ''; subShown = false; } shownCue = null; return; }
  // Liste der Untertitel: nach jeder Änderung neu (dann steht at auf −1). Im Stand zusätzlich alle 0,4 s, beim Abspielen
  // nur alle 3 s – die Neuberechnung mitten im Abspielen kostete bei langen Projekten regelmäßig Bilder.
  const now = performance.now(); if (cueCache.at < 0 || now - cueCache.at > (playing ? 3000 : 400)) cueCache = {at:now, list:computedCues()};
  const list = cueCache.list, cur = list.find(x => o >= x.s && o < x.e) || null;
  if (!SubDrag.on && !(subShown && subShown.cur === cur && subShown.list === list)){
    const tr = cur ? trTexts(list)[list.indexOf(cur)] : null, fx = cur ? cueFx(cur, wrapText(cur.text)) : null, em = cur && cur.c.emoji ? `<span class="se">${escH(cur.c.emoji)}</span>` : '';
    const html = cur ? subHtml(cur.text, tr, cueStyle(cur.c), !!fx) : null;
    if (html != null) ov.innerHTML = html + em; else if (cur && (fx || em)) ov.innerHTML = (tr == null ? subWordsHtml(wrapText(cur.text)) : escH(subDisplay(cur.text, tr))) + em; else ov.textContent = cur ? subDisplay(cur.text, tr) : '';
    fxShown = fx && (tr == null || P.trans.mode !== 'only') ? {fx, start: cur.s, key: null} : null; fxAnimate(fx);
    const prevSp = cueSpk(shownCue); shownCue = cur ? cur.c : null; shownRange = cur ? [cur.s, cur.e] : null;
    if (cueSpk(shownCue) !== prevSp) styleOverlay(); else placeOverlay();
    subShown = {cur, list}; }
  if (fxShown) fxPaint(o);
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
  ov.style.textShadow = st.outline ? [[-1,-1],[1,-1],[-1,1],[1,1],[0,-1.4],[0,1.4],[-1.4,0],[1.4,0]].map(([x, y]) => `${(x*o).toFixed(1)}px ${(y*o).toFixed(1)}px 0 ${st.outlineColor || '#000'}`).join(',') : `0 ${(px/20).toFixed(1)}px ${(px/10).toFixed(1)}px rgba(0,0,0,.8)`;
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
  ov.classList.toggle('unsafe', !!ov.textContent && !!safeZone() && !inSafe(cx / W, cy / H, bw / W, bh / H));
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
  if (safeZone()){ const ov = $('#subOv'); [x, y] = safeClamp(x, y, ov.offsetWidth / st.width, ov.offsetHeight / st.height); }   // Schutzzonen an: außerhalb einrasten
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
  $('#stOutlineColor').value = (st.outlineColor || '#000000').toLowerCase(); $('#stOutlineColor').disabled = !st.outline;
  $('#sideSubs').classList.toggle('on', st.enabled !== false); fillFontSelects();
  $('#subsMaster').checked = st.enabled !== false; $('#subsMasterLbl').textContent = st.enabled !== false ? 'Untertitel an' : 'Untertitel aus';
  $('#paneSubs').classList.toggle('subs-off', st.enabled === false); $('#paneSubs').classList.toggle('word-mode', st.mode === 'word');
  styleOverlay(); renderLooks(); syncFxInputs();
}
[['#stChars','chars',Number],['#stLines','lines',Number],['#stDur','dur',Number],['#stSize','size',String],['#stColor','color',v => v.toUpperCase()]]
  .forEach(([sel, key, conv]) => $(sel).addEventListener('change', e => { S()[key] = conv(e.target.value); styleOverlay(); changed(false); }));
$('#stPos').addEventListener('change', e => { const v = e.target.value; if (POS_Y[v] == null) return;
  const n = P.cues.filter(c => c.x != null).length;
  commit(() => { S().pos = v; S().x = 0.5; S().y = POS_Y[v]; if (n && confirm(`${n} Untertitel haben eine eigene Position. Auch diese zurücksetzen?`)) P.cues.forEach(c => { delete c.x; delete c.y; }); }, false); styleOverlay(); });
$('#stOutline').onchange = e => { S().outline = e.target.checked; $('#stOutlineColor').disabled = !S().outline; styleOverlay(); changed(false); };
$('#stOutlineColor').addEventListener('input', e => { S().outlineColor = e.target.value.toUpperCase(); styleOverlay(); });
$('#stOutlineColor').addEventListener('change', () => changed(false));
// ── Farbfavoriten: gelten in allen Projekten; antippen setzt die Farbe im zuletzt benutzten Farbfeld,
// ★ speichert dessen Farbe, × entfernt sie. Zusätzlich als Vorschläge im Farbwähler (datalist). ──
const FAV_KEY = 'hc-colfav';
let favCols = (() => { try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch(_){ return []; } })();
let favTarget = null;
document.addEventListener('focusin', e => { if (e.target.matches && e.target.matches('input[type=color]')) favTarget = e.target; });
document.addEventListener('pointerdown', e => { if (e.target.matches && e.target.matches('input[type=color]')) favTarget = e.target; }, true);
function saveFavs(){ try { localStorage.setItem(FAV_KEY, JSON.stringify(favCols)); } catch(_){} if (TS.setPref) try { TS.setPref(FAV_KEY, JSON.stringify(favCols)); } catch(_){} renderFavs(); }
function renderFavs(){
  let dl = $('#colFavList'); if (!dl){ dl = document.createElement('datalist'); dl.id = 'colFavList'; document.body.append(dl); }
  dl.innerHTML = favCols.map(c => `<option value="${c.toLowerCase()}"></option>`).join('');
  document.querySelectorAll('input[type=color]').forEach(i => i.setAttribute('list', 'colFavList'));
  document.querySelectorAll('.colfav').forEach(box => {
    box.innerHTML = `<span class="muted small">Favoriten</span>` + favCols.map((c, i) => `<span class="fav-chip" style="background:${c}" data-c="${c}" title="${c} – antippen: übernehmen"><button type="button" data-del="${i}" title="Aus den Favoriten entfernen">×</button></span>`).join('')
      + `<button type="button" class="btn small fav-add" title="Farbe des zuletzt gewählten Farbfelds als Favorit speichern">★ Farbe merken</button>`;
  });
}
document.addEventListener('click', e => {
  const box = e.target.closest && e.target.closest('.colfav'); if (!box) return;
  const del = e.target.closest('[data-del]'); if (del){ e.stopPropagation(); favCols.splice(+del.dataset.del, 1); saveFavs(); return; }
  const card = box.closest('.card, details, .sheet') || document;
  const target = favTarget && document.contains(favTarget) && !favTarget.disabled ? favTarget : card.querySelector('input[type=color]:not(:disabled)');
  if (e.target.closest('.fav-add')){ if (!target) return toast('Erst ein Farbfeld antippen'); const c = target.value.toUpperCase(); if (!favCols.includes(c)){ favCols = [c, ...favCols].slice(0, 16); saveFavs(); toast('Farbe gemerkt'); } return; }
  const chip = e.target.closest('.fav-chip'); if (!chip) return;
  if (!target) return toast('Erst ein Farbfeld antippen');
  target.value = chip.dataset.c.toLowerCase(); target.dispatchEvent(new Event('input', {bubbles: true})); target.dispatchEvent(new Event('change', {bubbles: true}));
});
renderFavs();
if (TS.getPref) try { const v = TS.getPref(FAV_KEY); if (v){ favCols = JSON.parse(v) || favCols; renderFavs(); } } catch(_){}
new MutationObserver(() => { document.querySelectorAll('input[type=color]:not([list])').forEach(i => i.setAttribute('list', 'colFavList')); }).observe(document.body, {childList: true, subtree: true});
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
    el.innerHTML = `<div class="tm"><span class="t"></span><span class="w"></span></div><textarea rows="2" dir="auto"></textarea>
      <div class="acts"><button data-a="split">✂ teilen</button><button data-a="merge">⤓ zusammen</button><button data-a="off"></button>
      <button data-a="emoji" title="Emoji oder Symbol über diesem Untertitel"><span></span></button><button data-a="keep" class="hidden"></button><select class="cue-spk hidden" title="Person dieses Untertitels"></select>
      <button data-a="auto" class="hidden">↺ auto</button><button data-a="pos" class="hidden">↺ Position</button><button data-a="time" class="hidden">↺ Zeit</button><button data-a="s-">Start −</button><button data-a="s+">Start +</button><button data-a="e-">Ende −</button><button data-a="e+">Ende +</button></div>`;
    if (idx === P.cues.length - 1) el.querySelector('[data-a=merge]').disabled = true;
    if (trHas() && P.trans.mode !== 'off' && S().mode !== 'word'){ el.querySelector('textarea').insertAdjacentHTML('afterend', `<textarea rows="1" class="cue-tr" dir="auto" placeholder="${(P.trans.lang || 'en').toUpperCase()} – Übersetzung"></textarea>`);
      const tt = el.querySelector('.cue-tr'), cl = computedCues(), k0 = cl.findIndex(x => x.c === c); tt.value = k0 >= 0 ? trTexts(cl)[k0] || '' : '';
      tt.addEventListener('focus', () => tt._b = snapshot());
      tt.addEventListener('input', () => { P.trans.map ||= {}; const k = trKey(cueText(c)); if (tt.value.trim()) P.trans.map[k] = tt.value.trim(); else delete P.trans.map[k]; cueCache.at = -1; trMemo.list = null; clearTimeout(saveT); saveT = setTimeout(saveNow, 800); });
      tt.addEventListener('blur', () => { if (tt._b && tt._b !== snapshot()){ undo.push(tt._b); redo = []; } tt._b = null; paintTrans(); }); }
    const ta = el.querySelector('textarea'); ta.value = cueText(c);
    ta.addEventListener('focus', () => ta._b = snapshot());
    ta.addEventListener('input', () => { const k0 = trKey(cueText(c)); c.text = c.own ? ta.value : ta.value.trim() === autoText(c) ? null : ta.value;
      if (P.trans && P.trans.map && P.trans.map[k0] != null){ trMemo.list = null; const k1 = trKey(cueText(c)); if (k1 !== k0){ P.trans.map[k1] = P.trans.map[k0]; delete P.trans.map[k0]; } }
      paintCue(c, true); cueCache.at = -1; clearTimeout(saveT); saveT = setTimeout(saveNow, 800); paintReadLater(); });
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
  el.querySelector('[data-a=emoji] span').textContent = c.emoji ? c.emoji + ' Symbol' : '+ Symbol';
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
function updateCount(){ paintRead(); }
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
  if (a === 'emoji') return openEmoji(c);
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

// ───────── Eigene Looks (D5): ein fertiger Untertitel-Stil unter einem Namen ─────────
// Gilt auf diesem Gerät für alle Projekte (localStorage), reist mit der Sicherung und – auf Wunsch – im Projektpaket mit.
const LOOK_KEY = 'hc-sub-looks';
const LOOK_FIELDS = ['mode', 'chars', 'lines', 'dur', 'size', 'pos', 'x', 'y', 'color', 'outline', 'outlineColor', 'font', 'bg', 'hl', 'anim', 'kwColor', 'kwDict'];
const LOOK_SPLIT = ['mode', 'chars', 'lines', 'dur'];   // diese Angaben bestimmen die Aufteilung: Ändern sie sich, werden die Untertitel neu aufgeteilt
let subLooks = (() => { try { const v = JSON.parse(localStorage.getItem(LOOK_KEY)); return Array.isArray(v) ? v.filter(l => l && l.id && l.name && l.st) : []; } catch(_){ return []; } })();
const lookOf = st => { const o = {}; for (const k of LOOK_FIELDS) if (st[k] != null && st[k] !== '' && st[k] !== false) o[k] = st[k]; if (st.outline === false) o.outline = false; return o; };
const lookSame = (a, b) => JSON.stringify(lookOf(a)) === JSON.stringify(lookOf(b));
const lookActive = l => !!P && S().look === 'own:' + l.id && lookSame(S(), l.st);
function saveLooks(){ try { localStorage.setItem(LOOK_KEY, JSON.stringify(subLooks)); } catch(_){} renderLooks(); }
function renderLooks(){
  const box = $('#lookList'); if (!box) return;
  box.innerHTML = subLooks.length ? subLooks.map(l => `<span class="look-chip${lookActive(l) ? ' on' : ''}" data-look="${esc(l.id)}" title="Look „${esc(l.name)}“ übernehmen"><b>${esc(l.name)}</b><button type="button" data-del="${esc(l.id)}" title="Look löschen">×</button></span>`).join('') : '<span class="muted small">noch keine eigenen</span>';
  // Clip-Studio: eigene Looks hinter den vier mitgelieferten
  const cl = $('#clipLooks'); if (cl){ cl.querySelectorAll('[data-own]').forEach(b => b.remove());
    for (const l of subLooks){ const b = document.createElement('button'); b.dataset.own = l.id; b.innerHTML = '<b></b><span>eigener Look</span>'; b.querySelector('b').textContent = l.name; b.classList.toggle('on', lookActive(l)); cl.append(b); } }
}
function applyLook(l){
  if (!P) return; const st = S(), regen = LOOK_SPLIT.some(k => l.st[k] != null && l.st[k] !== st[k]) && tokens.length > 0, n = regen ? manualCount() : 0;
  if (n && !confirm(`${n} Untertitel wurden von Hand bearbeitet. Dieser Look teilt die Untertitel neu auf; dabei gehen diese Änderungen verloren. Fortfahren?`)) return;
  commit(() => { for (const k of LOOK_FIELDS){ if (l.st[k] != null) st[k] = l.st[k]; else if (k in DEF_STYLE) st[k] = DEF_STYLE[k]; else delete st[k]; } st.look = 'own:' + l.id; if (regen) genCues(); }, true);
  syncStyleInputs(); styleOverlay(); renderLooks(); if (tab === 'clip' && window.renderClip) renderClip(); cueCache.at = -1; updateSubs(outPos);
  toast(`Look „${l.name}“ übernommen` + (regen ? ` – ${P.cues.length} Untertitel neu aufgeteilt` : ''));
}
async function saveLook(){
  if (!P) return; const cur = subLooks.find(l => S().look === 'own:' + l.id);
  const name = await askName('Look speichern', cur ? cur.name : ''); if (!name || !P) return;
  const ex = subLooks.find(l => l.name.toLowerCase() === name.toLowerCase());
  if (ex && !lookSame(ex.st, S()) && !confirm(`Den Look „${ex.name}“ mit dem jetzigen Stil überschreiben?`)) return;
  const l = ex || {id: newId(), name: name.slice(0, 40)}; l.st = lookOf(S()); if (!ex) subLooks.push(l);
  S().look = 'own:' + l.id; saveLooks(); changed(false);
  toast(`Look „${l.name}“ gespeichert – er steht jetzt in jedem Projekt bereit`);
}
$('#lookSave').onclick = saveLook;
$('#lookList').onclick = e => {
  const d = e.target.closest('[data-del]'), c = e.target.closest('[data-look]');
  if (d){ const l = subLooks.find(x => x.id === d.dataset.del); if (l && confirm(`Look „${l.name}“ löschen? Projekte, die ihn verwenden, behalten ihren Stil.`)){ subLooks = subLooks.filter(x => x !== l); saveLooks(); } return; }
  if (c){ const l = subLooks.find(x => x.id === c.dataset.look); if (l) applyLook(l); }
};
$('#clipLooks').addEventListener('click', e => { const b = e.target.closest('[data-own]'); if (!b) return; e.stopPropagation(); const l = subLooks.find(x => x.id === b.dataset.own); if (l) applyLook(l); });
// Looks aus einer Sicherung oder einem Projektpaket dazunehmen (vorhandene bleiben); Rückgabe: wie viele neu sind
function mergeLooks(list){
  let n = 0;
  for (const l of Array.isArray(list) ? list : []){
    if (!l || typeof l.name !== 'string' || !l.name.trim() || !l.st || typeof l.st !== 'object') continue;
    if (subLooks.some(x => x.id === l.id || (x.name.toLowerCase() === l.name.trim().toLowerCase() && lookSame(x.st, l.st)))) continue;
    subLooks.push({id: l.id && !subLooks.some(x => x.id === l.id) ? String(l.id) : newId(), name: l.name.trim().slice(0, 40), st: lookOf(l.st)}); n++;
  }
  if (n) saveLooks(); return n;
}

// ───────── Lesbarkeit der Untertitel (D7) ─────────
// Geprüft wird, was gleich im Bild steht: zu viele Zeichen je Sekunde, zu lange Zeilen, zu kurze Standzeit. „Neu umbrechen“ teilt
// zu lange Untertitel am Wort in der Mitte, lässt zu schnelle oder zu kurze länger stehen, soweit bis zum nächsten Platz ist,
// und legt zu kurze sonst mit dem Nachbarn zusammen.
const READ = {cps: 20, minDur: 0.7};
const cueChars = x => x.text.replace(/\s+/g, ' ').trim().length;
function readIssues(list){   // je Eintrag der berechneten Liste: null oder {long, fast, short, why: […]}
  const st = S(); if (st.mode === 'word') return list.map(() => null);
  const maxC = +st.chars || 32, maxL = +st.lines || 2;
  return list.map(x => {
    const n = cueChars(x), d = x.e - x.s, rows = wrapText(x.text).split('\n'), longest = Math.max(...rows.map(r => r.length)), o = {why: []};
    if (rows.length > maxL){ o.long = true; o.why.push(`${rows.length} Zeilen`); }
    else if (longest > maxC * 1.15 + 1){ o.long = true; o.why.push(`${longest} Zeichen in einer Zeile`); }
    const cps = Math.round(n / Math.max(0.05, d)), d1 = Math.round(d * 10) / 10;   // gerundet wie angezeigt, damit Grenze und Meldung zusammenpassen
    if (n > 8 && cps > READ.cps){ o.fast = true; o.why.push(`${cps} Zeichen je Sekunde`); }
    else if (d1 < READ.minDur && !x.kept){ o.short = true; o.why.push(`steht nur ${d1.toFixed(1).replace('.', ',')} s`); }
    return o.why.length ? o : null;
  });
}
// Untertitel am Wort teilen, das der Mitte (nach Zeichen) am nächsten liegt
function splitCueMid(c){
  const idx = P.cues.indexOf(c); if (idx < 0) return false;
  const words = cueText(c).trim().split(/\s+/).filter(Boolean); if (words.length < 2) return false;
  const tot = words.join(' ').length; let k = 1, best = Infinity, acc = 0;
  for (let j = 0; j < words.length - 1; j++){ acc += words[j].length + (j ? 1 : 0); const d = Math.abs(acc - tot / 2) - (/[,;:.!?…]$/.test(words[j]) ? 3 : 0); if (d < best){ best = d; k = j + 1; } }
  const left = words.slice(0, k).join(' '), right = words.slice(k).join(' ');
  if (c.own){ const c2 = splitOwnCue(c, left, right); if (!c2) return false; P.cues.splice(idx + 1, 0, c2); return true; }
  const ids = cueWords(c); if (ids.length < 2) return false;
  const manual = c.text != null, kt = clamp(manual ? Math.round(ids.length * left.length / Math.max(1, tot)) : k, 1, ids.length - 1);   // eigener Text: die Wörter darunter im selben Verhältnis teilen
  const c2 = {id: newId(), a: ids[kt - 1] + 1, b: c.b, text: manual ? right : null, ds: 0, de: isFree(c) ? 0 : c.de || 0, off: c.off, ...(c.x != null ? {x: c.x, y: c.y} : {}), ...(c.spk ? {spk: c.spk} : {})};
  c.b = ids[kt - 1]; c.text = manual ? left : null; c.de = 0; delete c.fa; delete c.fd; P.cues.splice(idx + 1, 0, c2); return true;
}
function readFix(){
  if (!P) return; let split = 0, longer = 0, merged = 0;
  commit(() => {
    // 1) zu schnell oder zu kurz: in die Lücke bis zum nächsten Untertitel hinein länger stehen lassen
    const list = computedCues(), iss = readIssues(list);
    list.forEach((x, k) => { const q = iss[k]; if (!q || !(q.fast || q.short) || list.filter(y => y.c === x.c).length > 1) return;
      const n = list[k + 1], room = (n ? n.s - 0.04 : total) - x.e, add = Math.min(room, Math.max(READ.minDur, cueChars(x) / READ.cps) - (x.e - x.s)); if (add < 0.05) return;
      setCueFree(x.c, x.s, x.e + add); if (x.c.lk) refreshLo(x.c); longer++; });   // wie „Ende +“: Der Untertitel bekommt eine feste Zeit
    cueCache.at = -1;
    // 2) immer noch zu kurz, weil gleich der nächste folgt: mit dem Nachbarn zusammenlegen, wenn beide zusammen in einen Untertitel passen.
    //    Nur Untertitel mit automatischem Text und ohne eigene Zeit oder Lage; endet der kurze einen Satz, kommt er zum vorigen.
    const maxAll = (+S().chars || 32) * (+S().lines || 2);
    const plain = c => !c.own && c.text == null && !isFree(c) && !c.ds && !c.de && c.x == null && !c.lk && !c.off;
    for (let round = 0; round < 3 && !P.moves.length; round++){
      const l = computedCues(), q = readIssues(l), used = new Set(); let n = 0;
      l.forEach((x, k) => {
        if (!q[k] || !q[k].short || used.has(x.c) || !plain(x.c)) return;
        const src = c => { const ids = cueWords(c); return ids.length ? tokens[ids[0]].src : -1; };
        const fits = y => !!y && !used.has(y.c) && plain(y.c) && src(y.c) === src(x.c) && cueSpk(y.c) === cueSpk(x.c) && cueChars(x) + 1 + cueChars(y) <= maxAll;
        const prev = l[k - 1], next = l[k + 1];
        const okNext = fits(next) && next.c.a === x.c.b + 1 && next.s - x.e < 0.8, okPrev = fits(prev) && prev.c.b + 1 === x.c.a && x.s - prev.e < 0.8;
        if (okPrev && (!okNext || sentEnd(x.text))){ prev.c.b = x.c.b; P.cues.splice(P.cues.indexOf(x.c), 1); used.add(x.c); used.add(prev.c); n++; merged++; }
        else if (okNext){ x.c.b = next.c.b; P.cues.splice(P.cues.indexOf(next.c), 1); used.add(x.c); used.add(next.c); n++; merged++; }
      });
      if (!n) break; cueCache.at = -1;
    }
    // 3) zu lange Zeilen: teilen, bei sehr langen Untertiteln bis zu drei Mal
    for (let round = 0; round < 3; round++){
      const l2 = computedCues(), i2 = readIssues(l2), seen = new Set(); let n = 0;
      l2.forEach((x, k) => { if (!i2[k] || !i2[k].long || seen.has(x.c)) return; seen.add(x.c); if (splitCueMid(x.c)){ n++; split++; } });
      if (!n) break; cueCache.at = -1;
    }
  }, true);
  cueCache.at = -1; if (tab === 'subs') renderSubs(); updateSubs(outPos);
  const left = paintRead(), did = [split ? `${split} geteilt` : '', longer ? `${longer} länger eingeblendet` : '', merged ? `${merged} zusammengelegt` : ''].filter(Boolean).join(', ');
  toast(!did ? 'Hier ließ sich nichts verbessern – bis zum nächsten Untertitel ist kein Platz' : did + (left ? ` · ${left} ${left === 1 ? 'bleibt' : 'bleiben'} markiert` : ' · alles gut lesbar'));
}
$('#readFix').onclick = readFix;
// Markierung in der Liste und Zähler; Rückgabe: Anzahl schwer lesbarer Untertitel
function paintRead(){
  if (!P) return 0;
  const list = computedCues(), iss = readIssues(list), by = new Map();
  iss.forEach((q, k) => { if (!q) return; const id = list[k].c.id; by.set(id, [...new Set((by.get(id) || []).concat(q.why))]); });
  for (const [id, el] of cueEls){ const w = by.get(id); el.classList.toggle('hard', !!w); let b = el.querySelector('.rd');
    if (w){ if (!b){ b = document.createElement('div'); b.className = 'rd'; el.querySelector('.tm').after(b); } setText(b, 'Schwer lesbar: ' + w.join(', ')); } else if (b) b.remove(); }
  const n = by.size;
  $('#subCount').textContent = `${list.length} Untertitel` + (n ? ` · ${n} schwer lesbar` : ''); $('#subCount').classList.toggle('warn', n > 0);
  $('#readFix').classList.toggle('hidden', !n); $('#readFix').textContent = `Neu umbrechen (${n})`;
  $('#readInfo').classList.toggle('hidden', !n);
  if (n) $('#readInfo').textContent = `Als schwer lesbar gilt: mehr als ${READ.cps} Zeichen je Sekunde, Zeilen über der eingestellten Länge oder weniger als ${String(READ.minDur).replace('.', ',')} s im Bild.`;
  return n;
}
let readLateT = 0;
const paintReadLater = () => { clearTimeout(readLateT); readLateT = setTimeout(() => { if (P && tab === 'subs') paintRead(); }, 500); };
$('#subCount').onclick = () => { const el = $('#cueList .cue.hard'); if (el) el.scrollIntoView({block: 'center', behavior: 'smooth'}); };

// ───────── Titelbild (A6): das Bild an der Abspiellinie als PNG oder JPG ─────────
// Gezeichnet wird, was die Bühne gerade zeigt – Hauptbild samt Lage, Zoom und Farbanpassung, Einblendungen (auch freigestellte und
// zugeschnittene), Wasserzeichen –, auf Wunsch mit Titeln, Textzeile und Untertiteln, dazu eine Titelzeile im Design der Folien.
function coverDraw(cv, o){
  const st = $('#stage'), R = st.getBoundingClientRect(), W = cv.width, H = cv.height, k = W / R.width, ctx = cv.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  const box = el => { const r = el.getBoundingClientRect(); return {x: (r.left - R.left) * k, y: (r.top - R.top) * k, w: r.width * k, h: r.height * k}; };
  const shown = el => !el.classList.contains('hidden');
  // Medium in seinen Kasten zeichnen: eingepasst (contain), füllend (cover) oder gestreckt (fill); clip = Zuschnitt als Anteile des Kastens
  const draw = (el, b, fit, clip) => {
    const vw = el.videoWidth || el.naturalWidth || el.width || 0, vh = el.videoHeight || el.naturalHeight || el.height || 0; if (!vw || !vh || b.w <= 0 || b.h <= 0) return;
    let dw = b.w, dh = b.h; if (fit !== 'fill'){ const f = (fit === 'cover' ? Math.max : Math.min)(b.w / vw, b.h / vh); dw = vw * f; dh = vh * f; }
    const c = clip || {l: 0, t: 0, r: 0, b: 0};
    ctx.save(); ctx.beginPath(); ctx.rect(b.x + c.l * b.w, b.y + c.t * b.h, b.w * (1 - c.l - c.r), b.h * (1 - c.t - c.b)); ctx.clip();
    ctx.drawImage(el, b.x + (b.w - dw) / 2, b.y + (b.h - dh) / 2, dw, dh); ctx.restore();
  };
  // Hauptbild: ein laufender Einschub liegt darüber und füllt die Bühne
  if (shown(II)) draw(II, box(II), 'contain'); else if (shown(IV)) draw(IV, box(IV), 'contain');
  else if (!st.classList.contains('audio-only')){
    const g = timeline[curSeg], key = mainKeyOf(g), keyed = !!(vKey && key && V.style.opacity === '0'), b = box(V);
    if (keyed){ ctx.fillStyle = key.bg || '#000'; ctx.fillRect(0, 0, W, H); }
    ctx.filter = V.style.filter || 'none'; draw(keyed ? vKey.canvas : V, b, 'contain'); ctx.filter = 'none';
  }
  // Einblendungen in der Reihenfolge der Spuren
  for (const el of st.querySelectorAll('.ovl-layer')){
    if (el.tagName === 'CANVAS' || !shown(el)) continue;
    const ent = [...layers].find(x => x[1] === el), kl = ent ? keyLayers.get(ent[0]) : null, m = /inset\(([\d.]+)% ([\d.]+)% ([\d.]+)% ([\d.]+)%/.exec(el.style.clipPath || '');
    draw(kl && el.style.opacity === '0' ? kl.canvas : el, box(el), el.classList.contains('free') ? 'fill' : 'cover', m ? {t: +m[1] / 100, r: +m[2] / 100, b: +m[3] / 100, l: +m[4] / 100} : null);
  }
  const lw = $('#lowerOv img'); if (lw && lw.complete && lw.naturalWidth) draw(lw, box(lw), 'fill');
  const pv = $('#partOv img'); if (pv && pv.complete && pv.naturalWidth) draw(pv, box(pv), 'fill');
  const wm = $('#wm'); if (shown(wm)){ ctx.globalAlpha = clamp(+wm.style.opacity || 1, 0, 1); draw(wm, box(wm), 'fill'); ctx.globalAlpha = 1; }
  // Schrift aus dem Video: Titel, Textzeile, Untertitel – dieselben Angaben wie im Export
  if (o.titles || o.subs){
    const plan = buildPlan(true), sub = plan.subs, sty = (sub && sub.style) || {};
    for (const c of (sub && sub.cues) || []){
      if (!(outPos >= c.start - 1e-3 && outPos < c.end) || !(c.title ? o.titles : o.subs)) continue;
      coverCue(ctx, c.title ? c : {...c, size: c.size || SIZE_F[sty.size] || 0.058, color: c.color || sty.color, outline: c.outline != null ? c.outline : sty.outline !== false, font: c.font != null ? c.font : sty.font, outlineColor: c.outlineColor || sty.outlineColor, bg: c.bg || !!sty.bg}, W, H);
    }
  }
  if (String(o.text || '').trim()) coverTitle(ctx, o.text.trim(), o.pos, W, H);
}
function coverCue(ctx, c, W, H){
  const size = c.size * Math.min(W, H) * (H > W ? 1.25 : 1);
  ctx.font = `${fontWeight(c.font, c.title ? 800 : 700)} ${size.toFixed(1)}px ${fontCss(c.font).replace('var(--ui)', getComputedStyle(document.body).fontFamily || 'sans-serif')}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const rows = String(c.text).split('\n'), lh = size * 1.12, bw = Math.max(...rows.map(r => ctx.measureText(r).width)), bh = rows.length * lh, cx = c.x * W, cy = c.y * H;
  if (c.bg){ const px = size * 0.3, py = size * 0.1; ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(cx - bw / 2 - px, cy - bh / 2 - py, bw + 2 * px, bh + 2 * py); }
  rows.forEach((row, n) => { const y = cy - bh / 2 + lh * (n + 0.5);
    if (c.outline && !c.bg){ ctx.lineJoin = 'round'; ctx.miterLimit = 2; ctx.lineWidth = 2 * Math.max(1, size / 14); ctx.strokeStyle = c.outlineColor || '#000'; ctx.strokeText(row, cx, y); }
    ctx.fillStyle = c.color || '#FFFFFF'; ctx.fillText(row, cx, y); });
}
// Titelzeile im Design der Folien: Kasten in der Hintergrundfarbe des Designprofils, Balken in der Akzentfarbe, Überschriften-Schrift.
// *so* färbt Wörter in der Akzentfarbe (wie in den Folien).
function coverRich(text){   // Zeilen → Wörter → Läufe [Text, hervorgehoben]
  let hl = false;
  return String(text).split('\n').map(line => line.split(/\s+/).filter(Boolean).map(raw => { const runs = []; let w = '';
    for (const ch of raw){ if (ch === '*'){ if (w){ runs.push([w, hl]); w = ''; } hl = !hl; } else w += ch; }
    if (w) runs.push([w, hl]); return runs; }).filter(r => r.length)).filter(l => l.length);
}
function coverWrap(ctx, lines, maxW){   // → [{runs, w}] je Zeile
  const sp = ctx.measureText(' ').width, out = [];
  for (const words of lines){ let cur = {runs: [], w: 0};
    for (const runs of words){ const ww = runs.reduce((n, r) => n + ctx.measureText(r[0]).width, 0);
      if (cur.runs.length && cur.w + sp + ww > maxW){ out.push(cur); cur = {runs: [], w: 0}; }
      if (cur.runs.length){ cur.runs.push([' ', false]); cur.w += sp; }
      cur.runs.push(...runs); cur.w += ww; }
    if (cur.runs.length) out.push(cur); }
  return out;
}
function coverTitle(ctx, text, pos, W, H){
  const pr = window.slProfile ? slProfile() : null, C = pr ? slColors(pr, true) : {bg: '#131312', fg: '#EDE7DA', acc: '#E5402A'};
  const font = pr && window.slFontFn ? slFontFn(pr.fonts && pr.fonts.head, 800) : (s => `800 ${s.toFixed(1)}px Inter, "Segoe UI", sans-serif`);
  const port = H > W, u = Math.min(W, H) / 100, padX = 5 * u, bar = pr && pr.bar === false ? 0 : 1.3 * u, inX = 3.4 * u, inY = 2.8 * u, maxW = W - 2 * padX - bar - 2 * inX, lines = coverRich(text);
  if (!lines.length) return;
  let size = Math.min(W, H) * (port ? 0.095 : 0.12), rows = [];
  for (let n = 0; n < 14; n++){ ctx.font = font(size); rows = coverWrap(ctx, lines, maxW); if (rows.length <= (port ? 4 : 3) && rows.every(r => r.w <= maxW + 1)) break; size *= 0.92; }
  const lh = size * 1.16, bh = rows.length * lh + 2 * inY, bw = Math.max(...rows.map(r => r.w)) + 2 * inX + bar;
  const y0 = pos === 'oben' ? (port ? 16 : 7) * u : pos === 'mitte' ? (H - bh) / 2 : H - bh - (port ? 24 : 8) * u, x0 = padX;
  ctx.globalAlpha = 0.92; ctx.fillStyle = C.bg; ctx.fillRect(x0, y0, bw, bh); ctx.globalAlpha = 1;
  if (bar){ ctx.fillStyle = C.acc; ctx.fillRect(x0, y0, bar, bh); }
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  rows.forEach((r, i) => { let x = x0 + bar + inX; const y = y0 + inY + size * 0.86 + i * lh;
    for (const [t, hl] of r.runs){ ctx.fillStyle = hl ? C.acc : C.fg; ctx.fillText(t, x, y); x += ctx.measureText(t).width; } });
}
async function coverRender(cv, o){
  if (window.slFonts) try { await slFonts(slProfile()); } catch(_){}
  if (V.seeking) await new Promise(res => { const t = setTimeout(res, 1500); V.addEventListener('seeked', () => { clearTimeout(t); res(); }, {once: true}); });
  drawKeyFrames(); coverDraw(cv, o);
}
function openCover(){
  if (!P || !timeline.length) return; if (playing) pausePlay();
  const [bw, bh] = baseDims(), W = Math.round(bw / 2) * 2, H = Math.round(bh / 2) * 2, port = H > W, small = Math.min(W, H) > 720 ? 720 / Math.min(W, H) : 0;
  let pref = {}; try { pref = JSON.parse(localStorage.getItem('hc-cover')) || {}; } catch(_){}
  const cs = P.settings.cover || {}, body = $('#sheetBody');
  body.innerHTML = `<h3>Titelbild</h3>
    <canvas id="cvPrev" class="cover-prev"></canvas>
    <label class="field"><span>Titelzeile (auf Wunsch) – *so* färbt Wörter in der Akzentfarbe</span><textarea id="cvText" rows="2" dir="auto" maxlength="160" placeholder="z. B. Wer hat das *wirklich* gesagt?"></textarea></label>
    <div class="grid2">
      <label>Lage der Titelzeile <select id="cvPos"><option value="oben">oben</option><option value="mitte">Mitte</option><option value="unten">unten</option></select></label>
      <label>Format <select id="cvFmt"><option value="png">PNG (verlustfrei)</option><option value="jpg">JPG (kleine Datei)</option></select></label>
      <label>Größe <select id="cvSize"><option value="0">wie das Video (${W} × ${H})</option>${small ? `<option value="${small}">${Math.round(W * small / 2) * 2} × ${Math.round(H * small / 2) * 2}</option>` : ''}</select></label>
    </div>
    <label class="row" style="margin-top:10px"><input type="checkbox" id="cvTitles"> Titel und Textzeile aus dem Video zeigen</label>
    <label class="row"><input type="checkbox" id="cvSubs"> Untertitel zeigen</label>
    <p class="muted small">Gezeigt wird das Bild an der Abspiellinie samt Einblendungen und Wasserzeichen. Für ein anderes Bild die Abspiellinie verschieben, die Vorschau zieht nach. Die Titelzeile übernimmt Farben und Schrift vom Designprofil der Folien.</p>
    <div class="row" style="margin-top:12px"><span class="muted small" id="cvMsg" style="flex:1;min-width:0"></span><button class="btn" id="cvNo">Schließen</button><button class="btn primary" id="cvSave">Speichern …</button></div>`;
  $('#cvText').value = cs.text || ''; $('#cvPos').value = cs.pos || (port ? 'mitte' : 'unten'); $('#cvTitles').checked = cs.titles !== false; $('#cvSubs').checked = !!cs.subs;
  $('#cvFmt').value = pref.fmt === 'jpg' ? 'jpg' : 'png'; if (pref.small && small) $('#cvSize').value = String(small);
  const opts = () => ({text: $('#cvText').value, pos: $('#cvPos').value, titles: $('#cvTitles').checked, subs: $('#cvSubs').checked});
  const prev = $('#cvPrev'); prev.width = Math.round(Math.min(W, 640 * (port ? 0.6 : 1))); prev.height = Math.round(prev.width * H / W);
  let last = '', busy = false;
  const paint = async force => { const key = outPos.toFixed(3) + JSON.stringify(opts()) + (V.seeking ? 's' : ''); if (busy || (!force && key === last)) return; busy = true; last = key;
    try { await coverRender(prev, opts()); } catch(e){ $('#cvMsg').textContent = 'Dieses Bild lässt sich hier nicht zeigen: ' + ((e && e.message) || e); } busy = false; };
  const tick = setInterval(() => { if (!$('#cvPrev')) return clearInterval(tick); paint(false); }, 350);
  const keep = () => { P.settings.cover = opts(); try { localStorage.setItem('hc-cover', JSON.stringify({fmt: $('#cvFmt').value, small: +$('#cvSize').value > 0})); } catch(_){} clearTimeout(saveT); saveT = setTimeout(saveNow, 700); };
  for (const id of ['cvText', 'cvPos', 'cvTitles', 'cvSubs', 'cvFmt', 'cvSize']){ $('#' + id).addEventListener('input', () => { keep(); paint(true); }); $('#' + id).addEventListener('change', () => { keep(); paint(true); }); }
  $('#cvText').addEventListener('keydown', e => e.stopPropagation());
  $('#cvNo').onclick = closeSheet;
  $('#cvSave').onclick = async () => {
    const f = +$('#cvSize').value || 1, cv = document.createElement('canvas'), jpg = $('#cvFmt').value === 'jpg'; cv.width = Math.round(W * f / 2) * 2; cv.height = Math.round(H * f / 2) * 2;
    $('#cvSave').disabled = true; $('#cvMsg').textContent = 'Bild wird erzeugt …';
    try {
      await coverRender(cv, opts());
      const blob = await new Promise(res => cv.toBlob(res, jpg ? 'image/jpeg' : 'image/png', 0.92)); if (!blob) throw new Error('kein Bild erzeugt');
      const msg = await saveBlob((P.name || 'Video').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) + ' – Titelbild.' + (jpg ? 'jpg' : 'png'), blob);
      $('#cvMsg').textContent = msg ? `${msg} · ${cv.width} × ${cv.height}, ${fmtBytes(blob.size)}` : 'Nicht gespeichert.';
    } catch(e){ $('#cvMsg').textContent = 'Das Bild ließ sich nicht speichern: ' + ((e && e.message) || e); hcLog('Titelbild: ' + ((e && e.message) || e)); }
    $('#cvSave').disabled = false;
  };
  sheetOnClose = () => clearInterval(tick);
  body.onclick = null; sheetItem = null; openSheet(true); paint(true);
}
$('#coverBtn').onclick = openCover; $('#clipCover').onclick = openCover;

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
      <div class="field audopt"><span>Wenn gesprochen wird</span><div class="seg-ctl" id="cDuck"><button data-v="duck">wird leiser</button><button data-v="voice">ist selbst Sprache</button><button data-v="keep">bleibt gleich</button></div></div>
      <p class="muted small audopt" id="cDuckNote"></p>
      <div class="field pipopt"><span>Größe <b id="cSizeV"></b></span><input type="range" id="cSize" min="5" max="500" step="1"></div>
      <div class="field pipopt"><span>Platzieren</span><div class="seg-ctl" id="cCorner"><button data-v="ol">↖</button><button data-v="or">↗</button><button data-v="mm">Mitte</button><button data-v="ul">↙</button><button data-v="ur">↘</button><button data-v="full">Vollbild</button></div></div>
      <div class="field pipopt"><span>Splitscreen: Einblendung in die Hälfte</span><div class="seg-ctl" id="cSplit"><button data-v="o">Oben</button><button data-v="u">Unten</button><button data-v="l">Links</button><button data-v="r">Rechts</button><button data-v="">Aus</button></div></div>
      <div class="field pipopt"><span>Bild-im-Bild</span><div class="deco-row"><label class="row"><input type="checkbox" id="cFrame"> Rahmen</label><input type="text" id="cTag" maxlength="40" placeholder="Namensschild, z. B. @kanal" autocomplete="off" autocapitalize="off" spellcheck="false" dir="auto"></div></div>
      <p class="muted small pipopt">Splitscreen gilt für das ganze Video: Das Hauptvideo rückt in die andere Hälfte. Rahmen und Namensschild folgen dem Designprofil der Folien und erscheinen bei Einblendungen ohne Keyframes.</p>
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
        if (seg.id === 'cDuck'){ if (v === 'duck') delete it.duck; else it.duck = v === 'voice' ? 'voice' : false; }
        if (seg.id === 'cSplit'){ if (v) splitApply(it, v); else splitEnd(it); }
        if (seg.id === 'cCorner'){ if (v === 'full'){ delete it.w; delete it.x; delete it.y; delete it.kf; it.type = 'broll'; } else pipCorner(it, v); } }, false); if (seg.id === 'cSplit'){ applyMainTransform(); if (tab === 'clip' && window.renderClip) renderClip(); }
      if (seg.id !== 'zKind') seekOut(outPos, false); h.textContent = TYPE_LBL[it.type]; paintItem(); return; }
    if (b.dataset.z){ commit(() => it.dur = clamp(+(it.dur + +b.dataset.z).toFixed(2), 0.2, 60), false); }
    else if (b.dataset.at){ commit(() => { const p0 = objStart(it); it.at = clamp(r3(it.at + +b.dataset.at), 0, srcTotal); groupShift(it, objStart(it) - p0); }, false); seekOut(srcToOut(snapSrc(it.at)), false); }
    else if (b.dataset.cin){ commit(() => it.in = clamp(r3(it.in + +b.dataset.cin), 0, it.out - 0.1), false); $('#cPrev').currentTime = it.in; }
    else if (b.dataset.cout){ commit(() => it.out = clamp(r3(it.out + +b.dataset.cout), it.in + 0.1, isImg(it.clip) ? 1e6 : it.clip.duration), false); if (!isImg(it.clip)) $('#cPrev').currentTime = it.out; }
    else if (b.id === 'cInHere'){ const t = $('#cPrev').currentTime; commit(() => it.in = clamp(t, 0, it.out - 0.1), false); }
    else if (b.id === 'cOutHere'){ const t = $('#cPrev').currentTime; commit(() => it.out = clamp(t, it.in + 0.1, it.clip.duration), false); }
    else if (b.id === 'itPlay'){ const o = srcToOut(snapSrc(it.at)), d = it.type === 'zoom' ? it.dur : it.out - it.in; seekOut(Math.max(0, o - 1), false); startPlay(); stopAt = o + d + 1; return; }
    else if (b.id === 'itDel'){ commit(() => P.items = P.items.filter(x => x !== it)); closeSheet(); return; }
    else if (b.id === 'itOk'){ closeSheet(); return; }
    else if (b.id === 'cDuckOn'){ audioEdit(a => { a.duck = {...(a.duck || {}), on: true}; }); }
    paintItem();
  };
  const cf = $('#cFrame'), ct = $('#cTag');
  if (cf){ const setDeco = fn => { const d = {...(it.deco || {})}; fn(d); if (d.frame || String(d.name || '').trim()) it.deco = d; else delete it.deco; };
    cf.checked = !!(it.deco && it.deco.frame); ct.value = (it.deco && it.deco.name) || '';
    cf.onchange = () => { commit(() => setDeco(d => { d.frame = cf.checked; }), false); seekOut(outPos, false); };
    ct.oninput = () => { commitBurst('deco' + it.id, () => setDeco(d => { d.name = ct.value.slice(0, 40); })); updateOverlay(outPos); }; }
  const zs = $('#zStr');
  if (zs){ zs.oninput = () => { it.strength = +zs.value; paintItem(); };
           zs.onpointerdown = () => { zs._b = snapshot(); };
           zs.onchange = () => { if (zs._b){ undo.push(zs._b); redo = []; zs._b = null; } changed(false); }; }
}
function paintItem(){
  const it = sheetItem; if (!it) return;
  $$('#sheet .seg-ctl button').forEach(b => { const id = b.parentElement.id; const v = b.dataset.v;
    b.classList.toggle('on', (id === 'zKind' && it.kind === v) || (id === 'cMode' && it.type === v) || (id === 'cCorner' && it.w == null && it.corner === v) || (id === 'cSplit' && splitOf(it) === v) || (id === 'cDuck' && duckRole(it) === v)); });
  if (it.type === 'zoom'){ $('#zStr').value = it.strength; $('#zStrV').textContent = it.strength.toFixed(2).replace('.', ',') + '×'; $('#zDur').textContent = it.dur.toFixed(1).replace('.', ',') + ' s'; $('#zAt').textContent = fmtS(srcToOut(snapSrc(it.at)));
    const pin = $('#pin'); pin.classList.remove('hidden'); pin.style.left = it.cx * 100 + '%'; pin.style.top = it.cy * 100 + '%'; }
  else { $('#cName').textContent = isImg(it.clip) ? `${it.clip.name} · Foto, Länge frei wählbar` : `${it.clip.name} · ${fmtS(it.clip.duration)}`; $('#cIn').textContent = fmtS(it.in); $('#cOut').textContent = fmtS(it.out); $('#cAt').textContent = fmtS(srcToOut(snapSrc(it.at)));
    $$('.pipopt').forEach(x => x.classList.toggle('hidden', it.type === 'insert' || it.type === 'audio'));
    const cm = $('#cMode'); if (cm) cm.parentElement.classList.toggle('hidden', it.type === 'audio');
    $$('.audopt').forEach(x => x.classList.toggle('hidden', it.type !== 'audio'));
    const dn = $('#cDuckNote'); if (dn && it.type === 'audio'){ const h = duckNote(it); if (dn.dataset.h !== h){ dn.dataset.h = h; dn.innerHTML = h; } }
    $$('.volopt').forEach(x => x.classList.toggle('hidden', isImg(it.clip) || it.clip.hasAudio === false));
    const vol = it.vol ?? (it.type === 'insert' || it.type === 'audio' ? 1 : 0); $('#cVol').value = Math.round(vol * 100); $('#cVolV').textContent = vol ? Math.round(vol * 100) + ' %' : 'stumm';
    if (it.type !== 'insert' && it.type !== 'audio'){ const v = elVals(it, curRel(it)), w = v ? v.w : coverVals(it).w; $('#cSize').value = Math.round(w * 100); $('#cSizeV').textContent = Math.round(w * 100) + ' %' + (it.kf && it.kf.length ? ` · ${it.kf.length} Keyframes` : ''); } $('#cInHere').classList.toggle('hidden', isImg(it.clip)); $('#cOutHere').classList.toggle('hidden', isImg(it.clip)); }
  updateZoomPreview();
}
function updateZoomPreview(){ if (sheetItem && sheetItem.type === 'zoom' && !playing){ const z = sheetItem, s = z.kind === 'in' ? 1 : z.strength; V.style.transformOrigin = '50% 50%'; V.style.transform = `translate(${(-(z.cx - 0.5) * (s - 1) * 100).toFixed(3)}%, ${(-(z.cy - 0.5) * (s - 1) * 100).toFixed(3)}%) scale(${s})`; } }
let sheetOnClose = null;   // einmaliger Rückruf, wenn das Blatt schließt (z. B. Leinwand-Modus beenden)
function closeSheet(){ if (sheetOnClose){ const f = sheetOnClose; sheetOnClose = null; try { f(); } catch(_){} } $('#sheet').classList.add('hidden'); $('#sheetBack').classList.add('hidden'); $('#pin').classList.add('hidden'); $('#stageHint').classList.add('hidden');
  const pv = $('#cPrev'); if (pv && pv.pause){ pv.pause(); pv.removeAttribute('src'); } sheetItem = null; pinMode = false; if (!P) return; updateZoom(); if (window.renderStudio) renderStudio(); }
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
  $('#exSubs').checked = P ? P.settings.burn !== false : true; $('#exTextv').checked = textvOn();
  if (CAP.audioFormats){ $$('#exAudioFmt option').forEach(op => op.hidden = op.disabled = !CAP.audioFormats.includes(op.value)); if (!CAP.audioFormats.includes($('#exAudioFmt').value)) $('#exAudioFmt').value = CAP.audioFormats[0]; }
  if (CAP.platform === 'android') $('#exNote').textContent = exFmt === 'audio' ? 'Die Tonspur (M4A) landet im Ordner „Musik/HoneyCut“. Bitte die App während des Exports geöffnet lassen.'
    : 'Das Video landet direkt in deiner Galerie (Ordner „HoneyCut“). Bitte die App während des Exports geöffnet lassen.';
  paintExBtns(); gpuCheck();
  if (P) renderExport();
}
$('#exFmt').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; exFmt = b.dataset.v; paintExportForm(); });
$('#exSubs').onchange = e => { P.settings.burn = e.target.checked; changed(false); };
let outLim = null;   // Auflösungsgrenze für abgeleitete Pläne der Export-Pakete (sonst gilt die Auswahl im Export-Reiter)
function outSize(){
  let [w, h] = baseDims(); const lim = outLim != null ? outLim : +$('#exRes').value;
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
// Ein Abschnitt der Hauptspur für den Plan. a, b: Quellzeit (bei Einschüben die Zeit im Clip) – für den Abschnitt selbst g.in und
// g.out, für Übergänge das Material davor oder dahinter. vo: „Stimme aufbereiten“ gilt für diesen Export.
function planSeg(g, a, b, vo){
  if (g.kind === 'insert') return {kind:'insert', uri:g.uri, in:r3(a), out:r3(b), image: isImg(g.item.clip), hasAudio: g.item.clip.hasAudio !== false && !isImg(g.item.clip), hasVideo:true, vol:+(g.item.vol ?? 1)};
  const s = P.sources[g.si], off = s.off;
  const zs = P.items.filter(z => z.type === 'zoom' && z.at < b && z.at + z.dur > a)
    .map(z => ({at:r3(z.at - off), dur:z.dur, kind:z.kind, strength:z.strength, cx:z.cx, cy:z.cy}));
  const fx = g.fx || FX_DEF;
  return {kind:'main', src:g.si, uri:s.uri, in:r3(a - off), out:r3(b - off), zooms:zs, hasAudio: s.hasAudio !== false, hasVideo: hasVid(s),
    speed:+(fx.speed || 1), vol:+((fx.vol ?? 1) * srcVol(g.si)).toFixed(3), bright:+(fx.bright || 0), contrast:+(fx.contrast || 0), sat:+(fx.sat || 0), gray:!!fx.gray,
    ...(f2 => ({tx:r3(f2.tx || 0), ty:r3(f2.ty || 0), sc:+(f2.sc || 1).toFixed(4)}))(frameFx({tx:+(fx.tx || 0), ty:+(fx.ty || 0), sc:+(fx.sc || 1)})),
    ...(kf => kf ? {kf: kf.map(k => { const f2 = frameFx({tx:+(k.tx || 0), ty:+(k.ty || 0), sc:+(k.sc || 1)}); return {t:r3(fxItemOf(g).at + k.t - a), tx:r3(f2.tx || 0), ty:r3(f2.ty || 0), sc:+(f2.sc || 1).toFixed(4)}; })} : {})(mainKf(g)),
    ...(k => k ? {key: planKey(k, true)} : {})(mainKeyOf(g)),
    ...(vo && s.hasAudio !== false && !s.noAudio ? {voice: voicePlan(g)} : {})};
}
function buildPlan(dry){   // dry: nur nachsehen (z. B. für das Titelbild) – es werden keine Bilder abgelegt
  const [W, H] = outSize(), dk = dry ? null : duckPlan(), vo = !dry && voiceExport(), jn = dry ? null : joinPlan();
  const segs = timeline.map(g => planSeg(g, g.in, g.out, vo));
  const ovs = overlays.map(o => ({mode:o.x.type, image: isImg(o.x.clip), uri:o.x.clip.uri, in:o.x.in, out:r3(o.x.in + (o.end - o.at)), at:r3(o.at), corner:o.x.corner || 'or', size:o.x.size || 0.33,
    ...(o.x.w != null || (o.x.kf && o.x.kf.length) || hasCrop(o.x) ? (() => { const v = elVals(o.x, 0) || coverVals(o.x); return {x:r3(v.x), y:r3(v.y), w:r3(v.w)}; })() : {}),
    ...(o.x.kf && o.x.kf.length ? {kf: o.x.kf.filter(k => k.t <= o.end - o.at + 0.01).map(k => ({t:k.t, x:k.x, y:k.y, w:k.w}))} : {}),
    ...(hasCrop(o.x) ? {crop: (c => ({l:r3(c.l), t:r3(c.t), r:r3(c.r), b:r3(c.b)}))(cropOf(o.x))} : {}),
    ...(keyOn(o.x.key) ? {key: planKey(o.x.key, false)} : {}),
    aspect:+elAspect(o.x).toFixed(5), track: elTrack(o.x), vol:+(o.x.vol || 0), hasAudio: o.x.clip.hasAudio !== false && !isImg(o.x.clip),
    width:o.x.clip.width, height:o.x.clip.height, rotation:o.x.clip.rotation || 0}))
    .concat(dry ? [] : decoPlan(W, H)).concat(dry ? [] : lowerPlan(W, H)).concat(dry ? [] : partPlan(W, H)).concat(wmPlan(W, H))
    .concat(audios.map(a => ({mode:'audio', image:false, uri:a.x.clip.uri, in:r3(a.x.in), out:r3(a.x.in + (a.end - a.at)), at:r3(a.at), track:a.x.track || 1, vol:+(a.x.vol ?? 1), hasAudio:true, ...(dk && ducks(a.x) ? {duck: true} : {})})));
  const cl = S().enabled !== false && P.cues.length ? computedCues() : [], ctr = trTexts(cl), emo = [];
  const cues = cl.length ? cl.map((x, k) => { const [cx, cy0] = cueXY(x.c), sy = x.c.x == null && window.subSlideY ? subSlideY(x.s, x.e) : null, cy = sy ?? cy0, o = {start:r3(x.s), end:r3(x.e), text:wrapText(x.text), x:cx, y:cy};
    if (S().bg) o.bg = true;   // Untertitel mit Kasten (Clip-Look)
    const sp = cueSpk(x.c), st = sp && sp.st;   // Abweichungen der Person
    if (st){ if (st.color) o.color = st.color; if (st.size) o.size = SIZE_F[st.size] || 0.058; if (st.font != null) o.font = st.font; if (st.outline != null) o.outline = !!st.outline; if (sp.name) o.speaker = sp.name; }
    const fx = exFmt === 'video' ? cueFx(x, o.text) : null; if (fx) Object.assign(o, fx);
    if (x.c.emoji && exFmt === 'video' && !dry) emo.push({x, text: o.text, cx, cy});
    if (ctr[k] != null) return trCues(o, ctr[k], W, H, cueStyle(x.c));
    return [o]; }).flat() : [];
  if (emo.length) ovs.splice(ovs.findIndex(q => q.mode === 'audio') < 0 ? ovs.length : ovs.findIndex(q => q.mode === 'audio'), 0, ...emojiPlan(emo, W, H));
  for (const t of P.items.filter(x => x.type === 'title' && !x.lt && (x.text || '').trim())){ const a = srcToOut(snapSrc(t.at)); if (a >= total) continue;
    cues.push({start:r3(a), end:r3(Math.min(total, a + t.dur)), text:wrapTitle(t.text.trim(), (SIZE_F[t.size] || 0.058) * (t.scale || 1), t.font, W, H), x:t.x, y:t.y, size:+((SIZE_F[t.size] || 0.058) * (t.scale || 1)).toFixed(4), color:t.color || '#FFFFFF', outline:t.outline !== false, bg:!!t.bg, title:true, font:t.font || ''}); }
  const tl = tlineCue(W, H); if (tl) cues.push(tl);
  for (const c of refCues()) cues.push({...lineCue(srcLayout(c.text, W, H), W, H, c.s, c.e), src: true});
  const subs = cues.length ? {cues, style:S(), fonts: planFonts([S().font, ...cues.map(c => c.font)])} : null;
  const media = P.sources.map(s => ({uri:s.uri, name:s.name, duration:s.duration, width:dispSize(s)[0], height:dispSize(s)[1], fps:s.fps, hasAudio:s.hasAudio !== false, hasVideo:hasVid(s), kind:s.kind || 'video'}));
  return {format:exFmt, name: ($('#exName').value || P.name).replace(/[\\/:*?"<>|]/g, '_'), width:W, height:H, fps:primary().fps || 30, total:r3(total),
    segments:segs, overlays:ovs, subs, burn: P.settings.burn !== false, quality: $('#exQuality').value, audioFormat: $('#exAudioFmt').value,
    capcutInstall: $('#exCapcutInstall').checked, sources:media, project:P.id, ...(exFmt === 'video' && gpuUse() ? {gpu: true} : {}), ...(dk ? {duck: dk} : {}), ...(jn ? {trans: jn} : {})};
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
  const nLower = exFmt === 'audio' ? 0 : lowerList().length, nTitle = P.items.filter(x => x.type === 'title' && !x.lt).length, nSrc = exFmt === 'audio' ? 0 : refCues().length;
  $('#exSummary').textContent = `${fmtT(total)}${exFmt === 'audio' ? '' : ` · ${W}×${H}`} · ${timeline.filter(g => g.kind === 'main').length} Abschnitte` + (P.sources.length > 1 ? ` aus ${P.sources.length} Videos` : '') +
    (n.insert ? ` · ${n.insert} Einschub` : '') + (n.broll ? ` · ${n.broll} B-Roll` : '') + (n.pip ? ` · ${n.pip} Einblendung${n.pip > 1 ? 'en' : ''}` : '') + (n.zoom ? ` · ${n.zoom} Zoom` : '') + (n.fx ? ` · ${n.fx} Anpassungen` : '') + (nTitle ? ` · ${nTitle} Titel` : '') + (nLower ? ` · ${nLower} Bauchbinde${nLower > 1 ? 'n' : ''}` : '') + (tlineOn() ? ' · Textzeile' : '') + (nSrc ? ` · ${nSrc} Quellenzeile${nSrc > 1 ? 'n' : ''}` : '') +
    (S().enabled !== false && P.cues.length ? ` · ${computedCues().length} Untertitel` : '') + (exFmt !== 'audio' && partOn() ? ` · „${partText()}“` : '') + (exFmt === 'video' && hookVars().length ? ` · ${hookVars().length} Hook-Varianten` : '') +
    (nJoin => exFmt === 'video' && nJoin ? ` · ${nJoin} ${nJoin > 1 ? 'Übergänge' : 'Übergang'}` : '')(new Set(joinParts.map(p => p.x)).size) +
    (voiceExport() ? ' · Stimme aufbereitet' : '') + (duckPlan() ? ' · Musik weicht der Sprache' : '');
  // Projektformate (CapCut, Schnittprojekt) übernehmen Schnitte und Spuren, aber weder Übergänge noch die Bearbeitung des Tons
  const lost = exFmt === 'video' || exFmt === 'audio' ? [] : [joinParts.length ? 'Übergänge' : '', voiceOn() ? '„Stimme aufbereiten“' : '', duckOn() && audios.some(a => ducks(a.x) && (a.x.vol ?? 1) > 0) ? '„Musik weicht der Sprache“' : ''].filter(Boolean);
  $('#exToneNote').textContent = lost.length ? `${lost.length > 1 ? lost.slice(0, -1).join(', ') + ' und ' + lost[lost.length - 1] : lost[0]} ${lost.length > 1 || lost[0] === 'Übergänge' ? 'stecken' : 'steckt'} nur in den Exporten „${FMT_LBL.video || 'Video'}“ und „${FMT_LBL.audio || 'Ton'}“. In diesem Format bleiben die Schnitte hart und der Ton, wie er aufgenommen ist.` : '';
  $('#exToneNote').classList.toggle('hidden', !lost.length);
  paintExBtns(); renderLenLights(); renderChapters(); renderRefsCard(); renderA11y();
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
    for (const s of list){ const L0 = loudness(a, s.in, s.out), d = s.out - s.in, lv = voiceLvlDb(s), L = L0 == null ? null : L0 + lv; if (L != null){ sum += Math.pow(10, L / 10) * d; n += d; }
      for (let i = Math.max(0, Math.floor(s.in * 100)); i < Math.min(a.length, Math.ceil(s.out * 100)); i++) pk = Math.max(pk, a[i] / 2.8 - 90 + lv + 20 * Math.log10(s.vol ?? 1)); }
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
  if (!timeline.length || $('#exBtn').disabled) return;
  if (exqRunning() || (exFmt === 'video' && hookVars().length)) return void exEnqueue();   // die Warteschlange rechnet gerade, oder es gibt Hook-Varianten (je Variante eine Datei): dieser Export reiht sich ein
  saveNow(); pausePlay();
  const plan = await exPrepare(() => buildPlan()); if (!plan) return; exResult = null;
  // Textfassung: Unter Windows legt das Backend sie neben das Video, sonst speichert die App sie nach dem Export
  const {tv, tvName} = exTextFile(plan, exFmt); $('#exDone').classList.add('hidden'); $('#exFiles').textContent = ''; $('#exWarn').classList.add('hidden');
  if ($('#exLevel').checked && exFmt !== 'concat'){
    $('#exBtn').disabled = true; $('#exMsg').textContent = 'Lautstärke wird gemessen …';
    try { await levelPlan(plan); } catch(e){ console.warn(e); }
    $('#exBtn').disabled = false;
  }
  try { exJob = TS.exportVideo(JSON.stringify(plan)); } catch(e){ $('#exMsg').textContent = 'Fehler: ' + e.message; return; }
  $('#exBtn').disabled = true; $('#exCancel').classList.remove('hidden'); $('#exProg').classList.remove('hidden'); TS.keepAwake(true); exDirect = true;
  const end = () => { $('#exBtn').disabled = false; $('#exCancel').classList.add('hidden'); exDirect = false; if (!exqActive()) TS.keepAwake(false); exqPump(); };
  watchJob(exJob, j => { $('#exProg i').style.width = (j.progress * 100).toFixed(1) + '%'; $('#exMsg').textContent = j.message || ''; },
    j => { end(); exResult = j.result || {}; $('#exDone').classList.remove('hidden');
      if (CAP.platform === 'android'){ $('#exMsg').textContent = 'Fertig – das Video ist in deiner Galerie (Ordner „HoneyCut“).'; }
      else { $('#exMsg').textContent = exResult.note || 'Fertig.'; $('#exFiles').textContent = (exResult.files || []).join('\n'); }
      // Hinweis des Exports, z. B. wenn eine gewählte Schrift nicht geladen werden konnte und die Standardschrift im Video steht
      if (exResult.warn){ $('#exWarn span').textContent = exResult.warn; $('#exWarn').classList.remove('hidden'); toast(exResult.warn); }
      $('#exOpen').classList.toggle('hidden', CAP.platform !== 'android' && !exResult.playable);
      if (tv && CAP.platform !== 'desktop') saveBlob(tvName, new Blob([tv], {type: 'text/plain'})).then(m => { $('#exMsg').textContent += ' Textfassung: ' + (m || 'gespeichert') + '.'; }).catch(e => { $('#exMsg').textContent += ' Die Textfassung ließ sich nicht speichern: ' + e.message; }); },
    j => { end(); $('#exMsg').textContent = j.status === 'cancelled' ? 'Abgebrochen.' : ('Fehler: ' + (j.error || 'unbekannt')); });
};
$('#exCancel').onclick = () => exJob && TS.cancel(exJob);
$('#exShare').onclick = () => exResult && TS.share(exResult.uri || exResult.folder || (exResult.files || [])[0]);
$('#exOpen').onclick = () => exResult && TS.view(exResult.uri || exResult.playable);
if (CAP.platform === 'web'){ $('#exShare').textContent = 'Nochmal speichern'; $('#exOpen').textContent = 'Abspielen'; }
else if (CAP.platform !== 'android'){ $('#exShare').textContent = 'Im Ordner zeigen'; $('#exOpen').textContent = 'Abspielen'; }

// ───────── Reiter ─────────
function setTab(t){
  if (t !== 'text') lowEnd(); audStop();
  tab = t; clearSel(); if (P) rememberOpen();
  $('#proj').dataset.tab = t;
  $('#paneTrans').classList.toggle('hidden', t !== 'trans');
  $('#paneText').classList.toggle('hidden', t !== 'text'); $('#paneSubs').classList.toggle('hidden', t !== 'subs');
  $('#paneStudio').classList.toggle('hidden', t !== 'studio' && t !== 'clip' && t !== 'text'); $('#paneExport').classList.toggle('hidden', t !== 'export');
  if (window.applyTlFold) applyTlFold();   // Zeitleiste im Text- und im Clip-Reiter: je eigener Stand (ein- oder ausgeklappt)
  $('#paneClip').classList.toggle('hidden', t !== 'clip'); if (t === 'clip' && window.renderClip) renderClip();
  $('#paneSlides').classList.toggle('hidden', t !== 'slides'); if (t === 'slides' && window.renderSlides) renderSlides();
  $$('#tabs button[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t || (t === 'trans' && b.dataset.tab === 'text')));
  if (t === 'trans') renderSources();
  if (t === 'text' && P && spans.length){ paintLowBtn(); paintChkBtn(); }   // Zähler können sich in einem anderen Reiter geändert haben
  if (t === 'subs'){ renderSubs(); renderA11y(); } if (tlOn() && window.renderStudio) renderStudio(); if (t === 'export') renderExport();
  // Die Zeitleiste ist je nach Reiter verschieden breit: nach dem Wechsel steht die Abspiellinie wieder im sichtbaren Teil
  setTimeout(() => { fitStage(); if (P && tlOn()) tlReveal(); }, 0);
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
$('#modelsBtn').onclick = () => { renderModels(); renderSettingsMore(); $('#mgSheet').classList.add('hidden'); $('#modelSheet').classList.remove('hidden'); $('#sheetBack').classList.remove('hidden'); };
$('#modelClose').onclick = closeSettings;
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

// ───────── Untertitel-Effekte (2.32): Wort-Hervorhebung (D1), Schlagwörter (D2), Animationen (D3), Emojis (D4) ─────────
// Stil: S().hl = Farbe des gerade gesprochenen Worts ('' = aus), S().anim = '' | fade | pop | build, S().kwColor = Farbe betonter
// Wörter, S().kwDict = Begriffe aus dem Wörterbuch betonen. P.kw = Nummern einzeln betonter Wörter. c.emoji = Symbol am Untertitel.
// Im Exportplan stehen die Effekte je Untertitel, bezogen auf die Wörter seines Textes in ihrer Reihenfolge:
// words = [[Beginn, Ende], …], hl, build, spans = [[Wortnummer, Farbe], …], anim = fade | pop. Alle drei Export-Wege lesen dasselbe.
const SUB_ANIMS = {fade: 'Einblenden', pop: 'Aufpoppen', build: 'Wort für Wort'};
const HL_DEF = '#F5D90A', KW_DEF = '#E5402A', FX_ANIM_S = 0.16;
const kwNorm = s => String(s).toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
let kwDictMemo = {key: '', set: new Set()};
function kwDictSet(){ const key = JSON.stringify(dict.map(e => e.t)); if (kwDictMemo.key !== key) kwDictMemo = {key, set: new Set(dict.flatMap(e => String(e.t).split(/\s+/).map(kwNorm)).filter(w => w.length > 2))}; return kwDictMemo.set; }
const fxOn = () => { const st = S(); return !!(st.hl || st.anim || st.kwDict || (P.kw && P.kw.length)); };
// Wörter eines berechneten Untertitels mit ihren Zeiten im fertigen Video. Automatischer Text nimmt die Zeiten der Wörter aus dem
// Transkript; von Hand geänderter Text und frei gesetzte Untertitel verteilen die Dauer nach der Länge der Wörter.
function cueWordList(x, text){
  const words = String(text ?? wrapText(x.text)).split(/\s+/).filter(Boolean), n = words.length, c = x.c; if (!n) return [];
  let ids = !c.own && c.text == null && !isFree(c) ? cueWords(c) : null;
  if (ids && (ids.length !== n || ids.some(i => /\s/.test(tokText(tokens[i]).trim())))) ids = null;
  let st;
  if (ids) st = ids.map(i => srcToOut(wS(tokens[i])));
  else { const len = words.map(w => w.length + 1), sum = len.reduce((a, b) => a + b, 0); let acc = 0; st = len.map(l => { const t = x.s + (x.e - x.s) * acc / sum; acc += l; return t; }); }
  for (let k = 0; k < n; k++){ st[k] = clamp(st[k], x.s, Math.max(x.s, x.e - 0.03)); if (k && st[k] < st[k - 1]) st[k] = st[k - 1]; }
  st[0] = x.s;
  return words.map((w, k) => ({w, s: st[k], e: k + 1 < n ? st[k + 1] : x.e, i: ids ? ids[k] : null}));
}
function cueFx(x, text){   // → null oder {words, hl, build, spans, anim}
  if (!fxOn()) return null;
  const st = S(), list = cueWordList(x, text), o = {};
  if (st.mode !== 'word' && (st.hl || st.anim === 'build') && list.length){ o.words = list.map(q => [r3(q.s), r3(q.e)]); if (st.hl) o.hl = st.hl; if (st.anim === 'build') o.build = true; }
  const kw = P.kw && P.kw.length ? new Set(P.kw) : null, ds = st.kwDict ? kwDictSet() : null, col = st.kwColor || KW_DEF, spans = [];
  list.forEach((q, k) => { if ((kw && q.i != null && kw.has(q.i)) || (ds && ds.has(kwNorm(q.w)))) spans.push([k, col]); });
  if (spans.length) o.spans = spans;
  if (st.anim === 'fade' || st.anim === 'pop') o.anim = st.anim;
  return Object.keys(o).length ? o : null;
}
// Was jedes Wort zum Zeitpunkt t zeigt: null = Grundfarbe, '' = noch verborgen, sonst die Farbe
function fxState(fx, t, n, start){
  const ws = fx.words || [], sp = new Map(fx.spans || []), tt = fx.anim && t < start + FX_ANIM_S ? start : t, out = [];
  for (let k = 0; k < n; k++){ let v = sp.get(k) ?? null;
    if (k < ws.length){ if (fx.build && tt < ws[k][0] - 1e-6) v = ''; else if (fx.hl && tt >= ws[k][0] - 1e-6 && tt < ws[k][1] - 1e-6) v = fx.hl; }
    out.push(v); }
  return out;
}
// ── Vorschau: Wörter als einzelne Elemente; Farbe und Sichtbarkeit folgen der Abspiellinie ──
const subWordsHtml = text => escH(text).replace(/[^\s]+/g, w => `<span class="sw">${w}</span>`);
let fxShown = null;   // {fx, start, key}: Stand der Wörter des gerade gezeigten Untertitels
function fxPaint(o){
  if (!fxShown) return; const els = $$('#subOv .sw'), st = fxState(fxShown.fx, o, els.length, fxShown.start), key = st.join('|'); if (key === fxShown.key) return; fxShown.key = key;
  els.forEach((el, k) => { const v = st[k]; el.style.color = v || ''; el.style.visibility = v === '' ? 'hidden' : ''; });
}
function fxAnimate(fx){
  const ov = $('#subOv'); ov.classList.remove('a-fade', 'a-pop'); if (!fx || !fx.anim || !playing) return;
  void ov.offsetWidth; ov.classList.add(fx.anim === 'fade' ? 'a-fade' : 'a-pop');
}
// ── Betonen: einzelne Wörter im Text ──
function kwToggle(ids){
  ids = ids.filter(i => tokens[i] && isTextTok(i) && tokText(tokens[i])); if (!ids.length) return;
  const have = new Set(P.kw || []), all = ids.every(i => have.has(i));
  commit(() => { for (const i of ids){ if (all) have.delete(i); else have.add(i); } P.kw = [...have].sort((a, b) => a - b); }, false);
  ids.forEach(paint); cueCache.at = -1; subShown = null; updateSubs(outPos); syncFxInputs();
  toast(all ? 'Betonung entfernt' : `${ids.length} ${ids.length === 1 ? 'Wort' : 'Wörter'} betont – farbig in den Untertiteln`);
}
$('#selKw').onclick = () => { const ids = selIds(); if (ids.length){ kwToggle(ids); clearSel(); } };
// ── Emojis und Symbole am Untertitel ──
const EMOJI_KEY = 'hc-emoji', EMOJI_BASE = ['🔥', '💸', '📈', '📉', '⚠️', '❗', '❓', '✊', '🗳️', '🏠', '⚖️', '💡', '👉', '✅', '❌', '🤝', '📢', '🕊️', '🌍', '⏰'];
let emojiMap = (() => { try { const v = JSON.parse(localStorage.getItem(EMOJI_KEY)); return Array.isArray(v) ? v.filter(e => e && typeof e.w === 'string' && typeof e.e === 'string' && kwNorm(e.w) && e.e.trim()) : []; } catch(_){ return []; } })();
function saveEmojiMap(){ try { localStorage.setItem(EMOJI_KEY, JSON.stringify(emojiMap)); } catch(_){ toast('Speichern im Gerät fehlgeschlagen'); } }
function mergeEmoji(list){ let n = 0; if (!Array.isArray(list)) return 0;
  for (const e of list){ if (!e || typeof e.w !== 'string' || typeof e.e !== 'string' || !kwNorm(e.w) || !e.e.trim() || emojiMap.some(x => kwNorm(x.w) === kwNorm(e.w))) continue; emojiMap.push({w: e.w.trim().slice(0, 40), e: e.e.trim().slice(0, 8)}); n++; }
  if (n) saveEmojiMap(); return n; }
function emojiSuggest(c){ const ws = new Set(cueText(c).split(/\s+/).map(kwNorm)), out = []; for (const e of emojiMap) if (ws.has(kwNorm(e.w)) && !out.includes(e.e)) out.push(e.e); return out; }
function emojiSet(c, e){ commit(() => { if (e) c.emoji = e; else delete c.emoji; }, false); paintCue(c); cueCache.at = -1; subShown = null; updateSubs(outPos); }
function openEmoji(c){
  const body = $('#sheetBody'); sheetItem = null;
  const paint = () => {
    const sug = emojiSuggest(c), words = [...new Set(cueText(c).split(/\s+/).map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(w => w.length > 2))].slice(0, 12);
    body.innerHTML = `<h3>Symbol am Untertitel</h3><p class="muted small" dir="auto">„${esc(cueText(c).replace(/\s+/g, ' ').slice(0, 90))}“</p>
      ${sug.length ? `<div class="field"><span>Vorschläge aus deiner Zuordnung</span><div class="em-grid">${sug.map(e => `<button type="button" class="em${c.emoji === e ? ' on' : ''}" data-e="${esc(e)}"><span>${esc(e)}</span></button>`).join('')}</div></div>` : ''}
      <div class="field"><span>Auswahl</span><div class="em-grid">${EMOJI_BASE.map(e => `<button type="button" class="em${c.emoji === e ? ' on' : ''}" data-e="${esc(e)}"><span>${esc(e)}</span></button>`).join('')}</div></div>
      <label class="field"><span>Eigenes Symbol${CAP.platform === 'desktop' ? ' (Emoji-Tastatur: Windows-Taste + Punkt)' : ''}</span><input type="text" id="emOwn" maxlength="8" autocomplete="off" value="${esc(c.emoji && !EMOJI_BASE.includes(c.emoji) && !sug.includes(c.emoji) ? c.emoji : '')}"></label>
      <div class="field"><span>Zuordnung von Wort zu Symbol – gilt auf diesem Gerät als Vorschlag für alle Projekte</span>
        <div class="em-map">${emojiMap.length ? emojiMap.map((e, k) => `<span class="look-chip"><b>${esc(e.w)} ${esc(e.e)}</b><button type="button" data-mdel="${k}" title="Zuordnung entfernen">×</button></span>`).join('') : '<span class="muted small">Noch keine Zuordnung.</span>'}</div>
        <div class="em-add"><select id="emWord">${words.map(w => `<option>${esc(w)}</option>`).join('')}</select><span class="muted small">bekommt das gewählte Symbol</span><button type="button" class="btn small" id="emLearn"${c.emoji ? '' : ' disabled'}>Merken</button></div></div>
      <div class="row" style="margin-top:12px"><button class="btn" id="emOff"${c.emoji ? '' : ' disabled'}>Ohne Symbol</button><button class="btn" id="emAll" title="Jedem Untertitel ohne Symbol das erste passende aus deiner Zuordnung geben"${emojiMap.length ? '' : ' disabled'}>Vorschläge überall übernehmen</button><button class="btn primary" id="emOk" style="margin-left:auto">Fertig</button></div>`;
  };
  body.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.e){ emojiSet(c, c.emoji === b.dataset.e ? '' : b.dataset.e); return paint(); }
    if (b.dataset.mdel != null){ emojiMap.splice(+b.dataset.mdel, 1); saveEmojiMap(); return paint(); }
    if (b.id === 'emOff'){ emojiSet(c, ''); return paint(); }
    if (b.id === 'emLearn'){ const w = $('#emWord').value; if (!w || !c.emoji) return; emojiMap = emojiMap.filter(x => kwNorm(x.w) !== kwNorm(w)); emojiMap.push({w, e: c.emoji}); saveEmojiMap(); toast(`„${w}“ schlägt künftig ${c.emoji} vor`); return paint(); }
    if (b.id === 'emAll'){ let n = 0; commit(() => { for (const q of P.cues){ if (q.emoji || q.off) continue; const s = emojiSuggest(q)[0]; if (s){ q.emoji = s; n++; } } }, false); if (tab === 'subs') P.cues.forEach(q => paintCue(q)); cueCache.at = -1; subShown = null; updateSubs(outPos); toast(n ? `${n} Untertitel haben ein Symbol bekommen` : 'Kein weiterer Untertitel passt zu deiner Zuordnung'); return paint(); }
    if (b.id === 'emOk') closeSheet();
  };
  body.onchange = e => { if (e.target.id === 'emOwn'){ const v = e.target.value.trim(); if (v){ emojiSet(c, v); paint(); } } };
  paint(); openSheet(false);
}
// Lage des Symbols über dem Untertitel (Anteile des Bildes): Der Textblock wird wie im Export gesetzt (Umbruch bei 88 % der Breite)
function emojiRect(text, x, y, W, H, st){
  const px = subPx(W, H, st), E = px * 1.5; wrapCtx ||= document.createElement('canvas').getContext('2d');
  wrapCtx.font = `${fontWeight(st.font)} ${px.toFixed(1)}px ${fontCss(st.font).replace('var(--ui)', getComputedStyle(document.body).fontFamily || 'sans-serif')}`;
  let rows = 0; for (const line of String(text).split('\n')){ let cur = ''; rows++; for (const w of line.split(/\s+/).filter(Boolean)){ const t = cur ? cur + ' ' + w : w; if (cur && wrapCtx.measureText(t).width > W * 0.88){ rows++; cur = w; } else cur = t; } }
  const bh = rows * px * 1.12 + (st.bg ? px * 0.2 : 0), m = 0.02, cy = clamp(y * H, bh / 2 + m * H, H - bh / 2 - m * H);
  let ey = cy - bh / 2 - px * 0.12 - E / 2; if (ey - E / 2 < 0.01 * H) ey = cy + bh / 2 + px * 0.12 + E / 2;   // oben kein Platz: unter den Untertitel
  return {x: clamp(x * W, E / 2, W - E / 2) / W, y: ey / H, size: E};
}
const emojiImgs = new Map();
function emojiImage(e, size){
  const key = e + '|' + Math.round(size); let im = emojiImgs.get(key); if (im) return im; if (emojiImgs.size > 80) emojiImgs.clear();
  const s = Math.max(8, Math.round(size * 1.3 / 2) * 2), cv = document.createElement('canvas'), ctx = cv.getContext('2d'); cv.width = cv.height = s;
  ctx.font = `${Math.round(size)}px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji","Segoe UI Symbol",sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(e, s / 2, s / 2 + size * 0.04);
  im = {key, url: cv.toDataURL('image/png'), s}; emojiImgs.set(key, im); return im;
}
// Für den Export: jedes Symbol als Bild über dem Untertitel (Spur 96). list = berechnete Untertitel mit ihrer Lage im Plan
function emojiPlan(list, W, H){
  const out = []; if (!TS.saveImage) return out;
  for (const q of list){ const e = q.x.c.emoji; if (!e) continue;
    const r = emojiRect(q.text, q.cx, q.cy, W, H, cueStyle(q.x.c)), im = emojiImage(e, r.size), m = J(TS.saveImage(`symbol-${hashStr(im.key)}.png`, im.url, im.s, im.s, P.id)); if (!m || !m.uri) continue;
    out.push({mode: 'pip', image: true, uri: m.uri, in: 0, out: r3(q.x.e - q.x.s), at: r3(q.x.s), x: +r.x.toFixed(4), y: +r.y.toFixed(4), w: +(im.s / W).toFixed(4), aspect: 1, track: 96, vol: 0, hasAudio: false, width: im.s, height: im.s, rotation: 0, emoji: true}); }
  return out;
}
// ── Einstellungen im Untertitel-Reiter ──
function syncFxInputs(){
  const st = S(); $('#stHl').checked = !!st.hl; $('#stHlColor').value = (st.hl || st.hlLast || HL_DEF).toLowerCase(); $('#stHlColor').disabled = !st.hl;
  $('#stAnim').value = SUB_ANIMS[st.anim] ? st.anim : ''; $('#stKwColor').value = (st.kwColor || KW_DEF).toLowerCase(); $('#stKwDict').checked = !!st.kwDict;
  const n = (P.kw || []).length; $('#stKwInfo').textContent = n ? `${n} ${n === 1 ? 'Wort' : 'Wörter'} im Text betont` : 'Im Text Wörter markieren und „Betonen“ wählen';
  $('#stKwClear').classList.toggle('hidden', !n);
  $('#fxNote').textContent = st.mode === 'word' && (st.hl || st.anim === 'build') ? 'Bei „1 Wort pro Untertitel“ steht immer nur das gesprochene Wort im Bild; Hervorhebung und „Wort für Wort“ wirken bei der Aufteilung in Zeilen.' : '';
}
const fxChanged = () => { cueCache.at = -1; subShown = null; updateSubs(outPos); syncFxInputs(); renderLooks(); };
$('#stHl').onchange = e => { commit(() => { const st = S(); if (e.target.checked) st.hl = st.hlLast || HL_DEF; else { st.hlLast = st.hl || st.hlLast; delete st.hl; } }, false); fxChanged(); };
$('#stHlColor').addEventListener('input', e => { S().hl = e.target.value.toUpperCase(); S().hlLast = S().hl; cueCache.at = -1; subShown = null; updateSubs(outPos); });
$('#stHlColor').addEventListener('change', () => changed(false));
$('#stAnim').onchange = e => { commit(() => { if (e.target.value) S().anim = e.target.value; else delete S().anim; }, false); fxChanged(); };
$('#stKwColor').addEventListener('input', e => { S().kwColor = e.target.value.toUpperCase(); cueCache.at = -1; subShown = null; updateSubs(outPos); if (spans.length) (P.kw || []).forEach(paint); });
$('#stKwColor').addEventListener('change', () => changed(false));
$('#stKwDict').onchange = e => { commit(() => { if (e.target.checked) S().kwDict = true; else delete S().kwDict; }, false); fxChanged(); };
$('#stKwClear').onclick = () => { const ids = P.kw || []; if (!ids.length || !confirm(`Betonung von ${ids.length} ${ids.length === 1 ? 'Wort' : 'Wörtern'} entfernen?`)) return; commit(() => { P.kw = []; }, false); if (spans.length) ids.forEach(paint); fxChanged(); };

// ───────── Export-Warteschlange (A2), Export-Pakete (A1), Grafikkarte (H1) – 2.31 ─────────
// Warteschlange: fertige Exportpläne warten im Arbeitsspeicher und laufen nacheinander – auch, wenn inzwischen ein anderes Projekt
// offen ist. Ein Plan trägt alles, was der Export braucht; das Projekt muss dafür nicht offen bleiben.
// EXQ-Eintrag: {id, name, proj, info, plan, tv, tvName, status: wait|run|done|error|cancelled, job, progress, message, result, error}.
const EXQ = [];
let exDirect = false;   // ein Export läuft über „Exportieren“ direkt im Reiter
const exqActive = () => EXQ.filter(q => q.status === 'wait' || q.status === 'run').length;
const exqRunning = () => EXQ.find(q => q.status === 'run') || null;
function exqAdd(o){
  const q = {id: newId(), status: 'wait', progress: 0, message: '', result: null, error: '', job: null, ...o};
  EXQ.push(q); paintQueue(); exqPump(); return q;
}
function exqPump(){
  if (exDirect || exqRunning()) return;
  const q = EXQ.find(x => x.status === 'wait'); if (!q){ if (!exqActive()) TS.keepAwake(false); return; }
  try { q.job = TS.exportVideo(JSON.stringify(q.plan)); } catch(e){ q.status = 'error'; q.error = (e && e.message) || String(e); paintQueue(); return setTimeout(exqPump, 0); }
  q.status = 'run'; q.message = 'Startet …'; TS.keepAwake(true); paintQueue();
  watchJob(q.job, j => { q.progress = j.progress || 0; q.message = j.message || ''; paintQueueLive(q); },
    j => { q.status = 'done'; q.progress = 1; q.result = j.result || {}; q.message = CAP.platform === 'android' ? 'Fertig – in deiner Galerie (Ordner „HoneyCut“)' : (q.result.note || 'Fertig.');
      q.plan = null;   // der Plan wird nicht mehr gebraucht
      if (q.tv && CAP.platform !== 'desktop') saveBlob(q.tvName, new Blob([q.tv], {type: 'text/plain'})).catch(() => {});
      toast(`Export fertig: ${q.name}` + (q.result.warn ? ' – mit Hinweis' : '')); paintQueue(); exqPump(); },
    j => { q.status = j.status === 'cancelled' ? 'cancelled' : 'error'; q.error = j.status === 'cancelled' ? '' : (j.error || 'unbekannter Fehler'); if (q.status === 'error') toast(`Export fehlgeschlagen: ${q.name}`); paintQueue(); exqPump(); });
}
function exqCancel(q){ if (q.status === 'run' && q.job) TS.cancel(q.job); else if (q.status === 'wait'){ EXQ.splice(EXQ.indexOf(q), 1); paintQueue(); } }
function exqRetry(q){ if (!q.plan || (q.status !== 'error' && q.status !== 'cancelled')) return; q.status = 'wait'; q.progress = 0; q.error = ''; q.message = ''; paintQueue(); exqPump(); }
const EXQ_STATE = {wait: 'wartet', run: 'läuft', done: 'fertig', error: 'fehlgeschlagen', cancelled: 'abgebrochen'};
function exqRow(q){
  const pct = Math.round((q.progress || 0) * 100), r = q.result || {};
  const sub = q.status === 'run' ? (q.message || `${pct} %`) : q.status === 'done' ? q.message : q.status === 'error' ? 'Fehler: ' + q.error : q.status === 'wait' ? `wartet · Platz ${EXQ.filter(x => x.status === 'wait').indexOf(q) + 1}` : 'abgebrochen';
  const open = q.status === 'done' && (CAP.platform === 'android' || r.playable || r.uri), show = q.status === 'done' && (r.uri || r.folder || (r.files || []).length);
  return `<div class="q-row ${q.status}" data-q="${esc(q.id)}"><div class="q-n"><b dir="auto">${esc(q.name)}</b><span class="muted small">${esc(q.info || '')}</span><span class="small q-msg">${esc(sub)}</span>${q.status === 'done' && r.warn ? `<span class="small q-warn">${esc(r.warn)}</span>` : ''}
      ${q.status === 'run' ? `<div class="progress"><i style="width:${pct}%"></i></div>` : ''}</div>
    ${open ? `<button type="button" class="btn small" data-a="open">${CAP.platform === 'android' ? 'Ansehen' : 'Abspielen'}</button>` : ''}${show ? `<button type="button" class="btn small" data-a="show">${CAP.platform === 'web' ? 'Nochmal speichern' : CAP.platform === 'android' ? 'Teilen' : 'Im Ordner zeigen'}</button>` : ''}
    ${(q.status === 'error' || q.status === 'cancelled') && q.plan ? '<button type="button" class="btn small" data-a="retry">Erneut</button>' : ''}
    <button type="button" class="mini" data-a="${q.status === 'run' ? 'cancel' : 'drop'}" title="${q.status === 'run' ? 'Abbrechen' : q.status === 'wait' ? 'Aus der Warteschlange nehmen' : 'Aus der Liste nehmen'}">×</button></div>`;
}
function exqHtml(){
  if (!EXQ.length) return '<p class="muted small">Die Warteschlange ist leer. „In die Warteschlange“ im Export-Reiter reiht ein Video ein; du kannst danach gleich am nächsten weiterschneiden.</p>';
  const done = EXQ.filter(q => q.status === 'done' || q.status === 'cancelled' || q.status === 'error').length;
  return EXQ.map(exqRow).join('') + (done ? '<div class="row"><button type="button" class="btn small" data-a="clear">Erledigte aus der Liste nehmen</button></div>' : '');
}
function exqSummary(){
  const run = exqRunning(), wait = EXQ.filter(q => q.status === 'wait').length, done = EXQ.filter(q => q.status === 'done').length, bad = EXQ.filter(q => q.status === 'error').length;
  return [run ? `1 läuft (${Math.round((run.progress || 0) * 100)} %)` : '', wait ? `${wait} ${wait === 1 ? 'wartet' : 'warten'}` : '', done ? `${done} fertig` : '', bad ? `${bad} fehlgeschlagen` : ''].filter(Boolean).join(' · ');
}
function paintQueue(){
  const n = exqActive(), bad = EXQ.some(q => q.status === 'error');
  for (const id of ['queueBtn', 'queueHome']){ const b = $('#' + id); b.classList.toggle('hidden', !EXQ.length); if (n) b.dataset.n = String(n); else delete b.dataset.n; b.classList.toggle('busy', !!exqRunning()); b.classList.toggle('bad', bad && !n);
    b.title = 'Export-Warteschlange' + (EXQ.length ? ': ' + exqSummary() : ''); }
  const card = $('#queueCard'); card.classList.toggle('hidden', !EXQ.length); if (EXQ.length){ $('#queueList').innerHTML = exqHtml(); $('#queueSum').textContent = exqSummary(); }
  if ($('#queueSheetList')){ $('#queueSheetList').innerHTML = exqHtml(); $('#queueSheetSum').textContent = exqSummary() || 'leer'; }
  paintExBtns();
}
// Fortschritt des laufenden Eintrags, ohne die Liste neu aufzubauen (Knöpfe bleiben bedienbar)
function paintQueueLive(q){
  const pct = Math.round((q.progress || 0) * 100);
  for (const row of $$(`.q-row[data-q="${q.id}"]`)){ const i = row.querySelector('.progress i'), m = row.querySelector('.q-msg'); if (!i) return paintQueue(); i.style.width = pct + '%'; m.textContent = q.message || `${pct} %`; }
  const s = exqSummary(); if (!$('#queueCard').classList.contains('hidden')) $('#queueSum').textContent = s; if ($('#queueSheetSum')) $('#queueSheetSum').textContent = s;
  for (const id of ['queueBtn', 'queueHome']) $('#' + id).title = 'Export-Warteschlange: ' + s;
}
function exqClick(e){
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.a === 'clear'){ for (let k = EXQ.length - 1; k >= 0; k--) if (EXQ[k].status !== 'wait' && EXQ[k].status !== 'run') EXQ.splice(k, 1); return paintQueue(); }
  const row = b.closest('[data-q]'), q = row && EXQ.find(x => x.id === row.dataset.q); if (!q) return; const r = q.result || {};
  if (b.dataset.a === 'cancel') exqCancel(q);
  else if (b.dataset.a === 'drop'){ if (q.status === 'wait') exqCancel(q); else { EXQ.splice(EXQ.indexOf(q), 1); paintQueue(); } }
  else if (b.dataset.a === 'retry') exqRetry(q);
  else if (b.dataset.a === 'open') TS.view(r.uri || r.playable);
  else if (b.dataset.a === 'show') TS.share(r.uri || r.folder || (r.files || [])[0]);
}
function openQueue(){
  const body = $('#sheetBody'); sheetItem = null;
  body.innerHTML = `<h3>Export-Warteschlange</h3><p class="muted small" id="queueSheetSum"></p><div class="q-list" id="queueSheetList"></div>
    <p class="muted small">Die Exporte laufen nacheinander im Hintergrund, solange HoneyCut geöffnet ist${CAP.platform === 'web' ? ' und dieser Tab offen bleibt' : ''}. Wartende Einträge gehen beim Schließen verloren.</p>
    <div class="row" style="margin-top:12px"><button class="btn primary" id="queueOk" style="margin-left:auto">Fertig</button></div>`;
  body.onclick = e => { if (e.target.closest('#queueOk')) return closeSheet(); exqClick(e); };
  paintQueue(); openSheet(false);
}
$('#queueBtn').onclick = openQueue; $('#queueHome').onclick = openQueue;
$('#queueList').addEventListener('click', exqClick);
window.addEventListener('beforeunload', e => { if (exqActive()){ e.preventDefault(); e.returnValue = ''; } });

// ── Plan für den Export vorbereiten: Rückfrage zu offenen Belegen, Schriften, Textfassung, Lautstärke ──
async function exPrepare(make){
  const P0 = P; if (!(await askOpenRefs())){ if (P === P0){ setTab('text'); openRefs(); } return null; }
  if (P !== P0) return null;
  await lowerReady(); await decoReady(); await partReady(); if (P !== P0) return null;
  return make();
}
function exTextFile(plan, fmt){
  const tv = (fmt === 'video' || fmt === 'audio') && textvOn() ? textVersion() : '', tvName = textVersionName();
  if (tv && CAP.platform === 'desktop') plan.textfile = {name: tvName, text: tv};
  return {tv, tvName};
}
const planInfo = plan => `${P.name} · ${FMT_LBL[plan.format] || plan.format}${plan.format === 'video' ? ` · ${plan.width}×${plan.height}` : ''} · ${fmtT(plan.total)}`;
// Aktuellen Export einreihen
async function exEnqueue(){
  if (!P || !timeline.length) return; saveNow(); pausePlay();
  const fmt = exFmt, P0 = P, plans = await exPrepare(() => videoPlans()); if (!plans) return;
  const level = $('#exLevel').checked && fmt !== 'concat', busy = !!exqRunning() || exDirect;
  for (const plan of plans){
    const info = planInfo(plan), t = plan === plans[0] ? exTextFile(plan, fmt) : {};   // die Textfassung gehört zum Video, nicht zu jeder Variante
    if (level){ try { await levelPlan(plan); } catch(e){ console.warn(e); } }
    exqAdd({name: plan.name, proj: P0.id, info, plan, ...t});
  }
  const plan = plans[0];
  toast(plans.length > 1 ? `${plans.length} Hook-Varianten eingereiht – je Variante entsteht eine Datei` : busy ? `„${plan.name}“ ist eingereiht` : `„${plan.name}“ wird exportiert – du kannst weiterschneiden`);
}
$('#exQueueBtn').onclick = () => { exEnqueue(); };
function paintExBtns(){
  const busy = !!exqRunning(), nv = P && exFmt === 'video' ? hookVars().length : 0;
  $('#exPackBtn').classList.toggle('hidden', exFmt !== 'video');
  $('#exBtn').textContent = nv ? `${nv} Hook-Varianten exportieren` : {video:'Video exportieren', audio:'Audio exportieren', capcut:'CapCut-Projekt erstellen', concat:'Concat-Projekt erstellen'}[exFmt];
  $('#exBtn').title = nv ? 'Je Hook-Variante entsteht eine Datei (Hook-A, Hook-B, Hook-C) – sie laufen über die Warteschlange' : busy ? 'Ein Export aus der Warteschlange läuft – dieser wird eingereiht' : '';
}

// ── Grafikkarte (nur Windows): Das Backend nennt die nutzbare Videoeinheit; der Schalter gilt für dieses Gerät ──
let gpuState = null, gpuTries = 0;
const gpuOn = () => { try { return localStorage.getItem('hc-gpu') !== '0'; } catch(_){ return true; } };
const gpuUse = () => !!(gpuState && gpuState.name && gpuOn());
function gpuCheck(){
  if (!TS.gpu) return;
  if (!gpuState || gpuState.state !== 'ready'){ try { gpuState = J(TS.gpu()); } catch(_){ gpuState = null; }
    if ((!gpuState || gpuState.state !== 'ready') && gpuTries++ < 30) setTimeout(gpuCheck, 1500); }
  const row = $('#exGpuRow'), ok = !!(gpuState && gpuState.state === 'ready' && gpuState.name);
  row.classList.toggle('nogpu', !ok);
  if (ok){ $('#exGpuName').textContent = gpuState.label; $('#exGpu').checked = gpuOn(); }
}
$('#exGpu').onchange = () => { try { localStorage.setItem('hc-gpu', $('#exGpu').checked ? '1' : '0'); } catch(_){} };

// ── Export-Pakete: mehrere Fassungen mit einem Klick ──
// Die Fassung im Format des Projekts wird so exportiert, wie sie ist. Abgeleitete Fassungen wechseln für den Plan das Format der
// Leinwand; das Hauptvideo füllt sie (oder nimmt den Bildausschnitt, den dieses Format im Projekt zuletzt hatte: P.frameBy).
const PACK = [
  {id: 'hoch', k: '9:16', label: 'Hochformat 9:16', use: 'TikTok, Reels, Shorts', lim: 1080},
  {id: 'quer', k: '16:9', label: 'Querformat 16:9', use: 'YouTube', lim: 2160},
  {id: 'feed', k: '4:5', label: 'Feed 4:5', use: 'Instagram-Feed', lim: 1080}];
const packNative = e => P.format ? P.format === e.k : (([w, h]) => Math.abs(w / h - FORMATS[e.k][0] / FORMATS[e.k][1]) < 0.012)(baseDims());
function packWith(e, fn){
  const had = 'frame' in P, keep = {format: P.format, frame: P.frame, lim: outLim, fmt: exFmt};
  try {
    if (!packNative(e)){ P.format = e.k; const f = P.frameBy && P.frameBy[e.k]; P.frame = clampFrame(f ? {...f} : {sc: coverSc(), tx: 0, ty: 0}); }
    outLim = e.lim; exFmt = 'video'; return fn();
  } finally { if (keep.format) P.format = keep.format; else delete P.format; if (had) P.frame = keep.frame; else delete P.frame; outLim = keep.lim; exFmt = keep.fmt; }
}
const packSize = e => packWith(e, () => outSize());
const packName = e => `${(P.name || 'Video').replace(/[\\/:*?"<>|]/g, '_').slice(0, 70)}_${e.id}_${e.k.replace(':', 'x')}`;
function packPrefs(){ let o = null; try { o = JSON.parse(localStorage.getItem('hc-pack')); } catch(_){} return {hoch: true, quer: true, feed: false, cover: true, ...(o && typeof o === 'object' ? o : {})}; }
async function packCover(){   // Titelbild an der Abspiellinie, mit den Angaben aus „Titelbild“
  const [bw, bh] = baseDims(), cv = document.createElement('canvas'); cv.width = Math.round(bw / 2) * 2; cv.height = Math.round(bh / 2) * 2;
  const cs = P.settings.cover || {}; await coverRender(cv, {text: cs.text || '', pos: cs.pos || (cv.height > cv.width ? 'mitte' : 'unten'), titles: cs.titles !== false, subs: !!cs.subs});
  const blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', 0.92)); if (!blob) throw new Error('kein Bild erzeugt');
  return {blob, name: (P.name || 'Video').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) + ' – Titelbild.jpg', w: cv.width, h: cv.height};
}
const blobB64 = blob => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
async function packRun(sel, cover){
  if (!P || !timeline.length) return 0; saveNow(); pausePlay();
  const P0 = P, list = PACK.filter(e => sel[e.id]); if (!list.length && !cover) return 0;
  const plans = await exPrepare(() => list.map(e => { const plan = packWith(e, () => buildPlan()); plan.name = packName(e); plan.pack = e.id; return plan; })); if (!plans || P !== P0) return 0;
  let cv = null; if (cover){ try { cv = await packCover(); } catch(e){ hcLog('Titelbild im Paket: ' + ((e && e.message) || e)); toast('Das Titelbild ließ sich nicht erzeugen'); } }
  let saved = '';
  if (cv && (CAP.platform !== 'desktop' || !plans.length)){ try { saved = (await saveBlob(cv.name, cv.blob)) || ''; } catch(_){} cv = null; }
  for (let k = 0; k < plans.length; k++){
    const plan = plans[k], t = k === 0 ? exTextFile(plan, 'video') : {tv: '', tvName: ''};
    if (k === 0 && cv) plan.extras = [{name: cv.name, data: await blobB64(cv.blob)}];
    try { await levelPlan(plan); } catch(e){ console.warn(e); }
    exqAdd({name: plan.name, proj: P0.id, info: `${P0.name} · ${list[k].label} · ${plan.width}×${plan.height} · ${fmtT(plan.total)}`, plan, ...t});
  }
  if (!plans.length && saved) toast('Titelbild: ' + saved.split(':')[0]);
  return plans.length;
}
function openPack(){
  if (!P || !timeline.length) return; const body = $('#sheetBody'), pr = packPrefs(); sheetItem = null;
  const derived = PACK.some(e => !packNative(e)), special = P.items.some(x => x.slide || x.endcard || splitOf(x));
  body.innerHTML = `<h3>Export-Paket</h3>
    <p class="muted small">Ein Klick reiht alle gewählten Fassungen in die Warteschlange ein. Jede bekommt ihre Auflösung, die einheitliche Lautstärke (−14 LUFS) und einen eigenen Dateinamen; die Untertitel kommen als SRT-Datei mit.</p>
    <div class="pk-list">${PACK.map(e => { const [w, h] = packSize(e), nat = packNative(e);
      return `<label class="pk-row"><input type="checkbox" data-pk="${e.id}"${pr[e.id] ? ' checked' : ''}><span class="pk-n"><b>${e.label}</b><span class="muted small">${e.use} · ${w} × ${h} · ${nat ? 'Format des Projekts' : (P.frameBy && P.frameBy[e.k] ? 'dein Bildausschnitt für dieses Format' : 'das Video füllt das Bild')}</span><span class="muted small pk-file">${esc(packName(e))}.mp4</span></span></label>`; }).join('')}
      <label class="pk-row"><input type="checkbox" id="pkCover"${pr.cover ? ' checked' : ''}><span class="pk-n"><b>Titelbild</b><span class="muted small">das Bild an der Abspiellinie als JPG, mit den Angaben aus „Titelbild“</span></span></label></div>
    ${derived && special ? '<p class="small pk-warn">Folien, Endkarte und Splitscreen sind für das Format des Projekts angelegt. In den anderen Fassungen erscheinen sie eingepasst oder beschnitten.</p>' : ''}
    ${hookVars().length ? '<p class="muted small">Hook-Varianten: Das Paket nimmt Variante A. Je Variante eine Datei erzeugen „Video exportieren“ und „In die Warteschlange“.</p>' : ''}
    ${derived ? '<p class="muted small">Untertitel, Titel und Einblendungen behalten in jeder Fassung ihre Lage im Bild. Für eine andere Fassung mit eigenem Bildausschnitt das Format im Clip-Reiter einmal wählen und den Ausschnitt setzen; das Paket merkt ihn sich.</p>' : ''}
    <div class="row" style="margin-top:12px"><span class="muted small" id="pkMsg" style="flex:1;min-width:0"></span><button class="btn" id="pkNo">Schließen</button><button class="btn primary" id="pkGo"></button></div>`;
  const sel = () => Object.fromEntries(PACK.map(e => [e.id, body.querySelector(`[data-pk="${e.id}"]`).checked]));
  const paint = () => { const n = Object.values(sel()).filter(Boolean).length, c = $('#pkCover').checked; $('#pkGo').textContent = n ? `${n} ${n === 1 ? 'Fassung' : 'Fassungen'} einreihen` : c ? 'Titelbild speichern' : 'Nichts gewählt'; $('#pkGo').disabled = !n && !c; };
  body.onchange = () => { try { localStorage.setItem('hc-pack', JSON.stringify({...sel(), cover: $('#pkCover').checked})); } catch(_){} paint(); };
  body.onclick = null; $('#pkNo').onclick = closeSheet;
  $('#pkGo').onclick = async () => { $('#pkGo').disabled = true; $('#pkMsg').textContent = 'Fassungen werden vorbereitet …';
    let n = 0; try { n = await packRun(sel(), $('#pkCover').checked); } catch(e){ $('#pkMsg').textContent = 'Fehler: ' + ((e && e.message) || e); $('#pkGo').disabled = false; return; }
    if ($('#pkGo')){ closeSheet(); } if (n) toast(`${n} ${n === 1 ? 'Fassung ist' : 'Fassungen sind'} eingereiht – du kannst weiterschneiden`); };
  paint(); openSheet(false);
}
$('#exPackBtn').onclick = openPack;

// ───────── Hausstil und Bausteine (2.30) ─────────
// Hausstil (A3): Vorlagen im Gerät – [{id, name, st}] unter hc-house; st hält Untertitel-Stil, Wasserzeichen, Format der Leinwand,
// Schutzzonen, Lautstärke-Angleichung, Textzeile, Quellenzeile, Bauchbinden-Stil, Designprofil der Folien und die Aufräum-Optionen.
// hc-house-def nennt die Vorlage, mit der neue Projekte starten.
// Bausteine (A4): wiederkehrende Clips und Bilder – [{id, name, clip}] unter hc-blocks; angefügt werden sie als Einschub vor dem ersten
// bzw. hinter dem letzten Stück. Endkarte (F7): ein gezeichnetes Schlussbild im Designprofil der Folien, als Bild-Einschub am Ende.
const HOUSE_KEY = 'hc-house', HOUSE_DEF_KEY = 'hc-house-def', BLOCK_KEY = 'hc-blocks', ENDCARD_KEY = 'hc-endcard';
const lsList = k => { try { const v = JSON.parse(localStorage.getItem(k)); return Array.isArray(v) ? v : []; } catch(_){ return []; } };
const jc = o => o == null ? null : JSON.parse(JSON.stringify(o));
const validHouse = h => !!(h && h.id && typeof h.name === 'string' && h.name.trim() && h.st && typeof h.st === 'object');
const validBlock = b => !!(b && b.id && typeof b.name === 'string' && b.name.trim() && b.clip && b.clip.uri);
let houseList = lsList(HOUSE_KEY).filter(validHouse), blockList = lsList(BLOCK_KEY).filter(validBlock);
let houseDef = (() => { try { return localStorage.getItem(HOUSE_DEF_KEY) || ''; } catch(_){ return ''; } })();
function saveHouse(){ try { localStorage.setItem(HOUSE_KEY, JSON.stringify(houseList)); if (houseDef && houseList.some(h => h.id === houseDef)) localStorage.setItem(HOUSE_DEF_KEY, houseDef); else { houseDef = ''; localStorage.removeItem(HOUSE_DEF_KEY); } } catch(_){ toast('Speichern im Gerät fehlgeschlagen'); } }
function saveBlocks(){ try { localStorage.setItem(BLOCK_KEY, JSON.stringify(blockList)); } catch(_){ toast('Speichern im Gerät fehlgeschlagen'); } }
const autoVals = () => Object.fromEntries(AUTO_KEYS.map(k => [k, $('#' + k).type === 'checkbox' ? $('#' + k).checked : $('#' + k).value]));
function autoSet(a){
  if (!a) return; AUTO_KEYS.forEach(k => { const el = $('#' + k); if (!el || a[k] == null) return; if (el.type === 'checkbox') el.checked = !!a[k]; else el.value = a[k]; });
  try { localStorage.setItem('ts-auto2', JSON.stringify(autoVals())); } catch(_){}
}
// Stil des offenen Projekts als Vorlage
function houseOf(){
  return {sub: jc(P.sub_style), wm: jc(P.watermark), format: P.format || null, safe: P.settings.safe || '', burn: P.settings.burn !== false, level: P.settings.level !== false,
    textline: jc(P.textline), srcStyle: jc(P.srcStyle), lower: jc(P.lower), part: jc(P.partStyle), audio: jc(P.audio), slideProfile: jc(P.slideProfile), auto: autoVals()};
}
// Vorlage in ein Projekt schreiben (auch in ein gerade angelegtes, noch ungeöffnetes). Alles, was die Vorlage abdeckt, wird ersetzt.
function houseInto(p, st){
  const set = (k, v) => { if (v) p[k] = jc(v); else delete p[k]; };
  if (st.sub) p.sub_style = {...DEF_STYLE, ...jc(st.sub)};
  set('watermark', st.wm); set('textline', st.textline); set('srcStyle', st.srcStyle); set('lower', st.lower); set('slideProfile', st.slideProfile);
  if ('part' in st) set('partStyle', st.part);   // Vorlagen aus früheren Fassungen kennen die Kennzeichnung der Reihe noch nicht und lassen sie, wie sie ist
  if ('audio' in st) set('audio', st.audio);   // ebenso die Einstellungen zum Ton (ab 2.34)
  if ((p.format || null) !== (st.format || null)){ if (st.format && FORMATS[st.format]) p.format = st.format; else delete p.format; delete p.frame; p.frameNew = true; }
  p.settings ||= {pad: 0.06}; p.settings.safe = st.safe || ''; p.settings.burn = st.burn !== false; p.settings.level = st.level !== false;
}
function houseSummary(st){
  const a = []; a.push(st.format || 'Originalformat');
  if (st.sub && st.sub.enabled === false) a.push('ohne Untertitel'); else if (st.sub) a.push('Untertitel');
  if (st.wm && st.wm.clip && st.wm.on !== false) a.push('Wasserzeichen');
  if (st.textline && st.textline.on !== false && String(st.textline.text || '').trim()) a.push('Textzeile');
  if (st.safe) a.push('Schutzzonen');
  if (st.slideProfile && st.slideProfile.name) a.push('Folien „' + st.slideProfile.name + '“');
  if (st.audio && st.audio.duck && st.audio.duck.on) a.push('Musik weicht der Sprache');
  if (st.audio && st.audio.voice && st.audio.voice.on) a.push('Stimme aufbereiten');
  return a.join(' · ');
}
// Vorlage auf das offene Projekt anwenden
function houseApply(h){
  if (!P || !h) return;
  const fm0 = P.format || null, regen = !!h.st.sub && tokens.length > 0 && LOOK_SPLIT.some(k => ({...DEF_STYLE, ...h.st.sub})[k] !== S()[k]), n = regen ? manualCount() : 0;
  if (n && !confirm(`${n} Untertitel wurden von Hand bearbeitet. Diese Vorlage teilt die Untertitel neu auf; dabei gehen diese Änderungen verloren. Fortfahren?`)) return false;
  commit(() => { houseInto(P, h.st); P.house = h.id; if (P.frameNew){ delete P.frameNew; P.frame = P.format ? clampFrame({sc: coverSc(), tx: 0, ty: 0}) : null; } if (regen) genCues(); }, true);
  autoSet(h.st.auto); partChanged(); if (P.part && 'part' in h.st) partSyncLater();   // die Kennzeichnung gilt für die ganze Reihe
  syncStyleInputs(); styleOverlay(); syncSafe(); renderExportForm(); viewTextline(); renderLooks();
  $('.clip-tab').classList.toggle('hidden', !P.clipOf && !P.format);
  frameRestored(fm0 !== (P.format || null));
  if (window.slSyncAll) slSyncAll(); if (window.renderClip && tab === 'clip') renderClip();
  cueCache.at = -1; seekOut(outPos, false); toast(`Hausstil „${h.name}“ angewendet`); return true;
}
async function houseSave(){
  if (!P) return;
  const cur = houseList.find(h => h.id === P.house), name = await askName('Hausstil als Vorlage speichern', cur ? cur.name : ''); if (!name) return;
  const ex = houseList.find(h => h.name.toLowerCase() === name.toLowerCase());
  if (ex && !confirm(`Vorlage „${ex.name}“ mit dem Stil dieses Projekts überschreiben?`)) return;
  const h = ex || {id: newId(), name: name.slice(0, 40)}; h.st = houseOf(); if (!ex) houseList.push(h);
  saveHouse(); paintHouse(); toast(`Vorlage „${h.name}“ gespeichert`);
}
function mergeHouse(list){
  let n = 0; if (!Array.isArray(list)) return 0;
  for (const h of list){ if (!validHouse(h) || houseList.some(x => x.id === h.id || (x.name.toLowerCase() === h.name.trim().toLowerCase() && JSON.stringify(x.st) === JSON.stringify(h.st)))) continue;
    houseList.push({id: String(h.id), name: h.name.trim().slice(0, 40), st: jc(h.st)}); n++; }
  if (n) saveHouse(); return n;
}
function mergeBlocks(list){
  let n = 0; if (!Array.isArray(list)) return 0;
  for (const b of list){ if (!validBlock(b) || blockList.some(x => x.id === b.id || x.clip.uri === b.clip.uri)) continue; blockList.push({id: String(b.id), name: b.name.trim().slice(0, 40), clip: jc(b.clip)}); n++; }
  if (n) saveBlocks(); return n;
}

// ── Bausteine ──
const blockDur = c => c.kind === 'image' ? 'Bild' : fmtS(c.duration || 0);
async function blockNew(){
  const m = await pickMedia('clip'); if (!m) return;
  if (m.kind === 'audio' || m.hasVideo === false) return toast('Bausteine sind Videos oder Bilder');
  if (blockList.some(b => b.clip.uri === m.uri)) return toast('Diese Datei liegt schon bei den Bausteinen');
  const name = await askName('Name des Bausteins', String(m.name || 'Baustein').replace(/\.[^.]+$/, '').slice(0, 40)); if (!name) return;
  const clip = {...m}; delete clip.legacy; delete clip.tr; delete clip.env; delete clip._env;
  blockList.push({id: newId(), name: name.slice(0, 40), clip}); saveBlocks(); paintHouse();
}
// Clip oder Bild als Einschub ganz vorn bzw. ganz hinten anfügen; extra kommt mit ans Element (z. B. die Angaben der Endkarte)
function blockAdd(clip, where, label, dur, extra){
  if (!P) return null;
  const mains = timeline.filter(g => g.kind === 'main'); if (!mains.length){ toast('Das Projekt hat noch kein Video'); return null; }
  const front = where === 'front', img = clip.kind === 'image';
  const at = front ? Math.ceil(mains[0].in * 1000) / 1000 + 0.001 : Math.floor(mains[mains.length - 1].out * 1000) / 1000;
  const c = jc(clip); if (!img && !(c.duration > 0)) c.duration = 4;
  const it = {id: newId(), type: 'insert', at: r3(at), clip: c, in: 0, out: r3(img ? clamp(+dur || 4, 0.5, 60) : c.duration), corner: 'or', size: 0.4, block: label, ...(extra || {})};
  commit(() => { if (front) P.items.unshift(it); else P.items.push(it); }, true);
  if (window.TL){ TL.sel = {kind: 'insert', itemId: it.id, i: 0}; if (window.renderTimeline) renderTimeline(); }
  if (window.renderBin) renderBin();
  const seg = timeline.find(g => g.kind === 'insert' && g.item === it); seekOut(seg ? seg.o : 0, false);
  if (TS.prepare){ saveNow(); Promise.resolve(TS.prepare(P.id)).then(() => { if (P) seekOut(outPos, false); }); }   // Browser: Zugriff auf die Datei des Bausteins sicherstellen
  return it;
}
function blockUse(b, where){ if (blockAdd(b.clip, where, b.name)) toast(`Baustein „${b.name}“ ${where === 'front' ? 'vorn' : 'hinten'} angefügt`); }

// ── Endkarte ──
const houseStyleKey = () => { const pr = slProfile(); return JSON.stringify([pr.colors, pr.fonts, pr.theme, pr.bar]); };
const ENDCARD_DEF = {call: 'Folge für mehr', name: '', dur: 4};
function endcardVals(){ let o = null; try { o = JSON.parse(localStorage.getItem(ENDCARD_KEY)); } catch(_){} return {...ENDCARD_DEF, ...(o && typeof o === 'object' ? o : {})}; }
const endcardItem = () => P ? P.items.find(x => x.type === 'insert' && x.endcard) : null;
function wrapLines(ctx, text, maxW){
  const out = [];
  for (const para of String(text).split('\n')){ let line = '';
    for (const w of para.split(/\s+/).filter(Boolean)){ const t = line ? line + ' ' + w : w; if (line && ctx.measureText(t).width > maxW){ out.push(line); line = w; } else line = t; }
    if (line) out.push(line); }
  return out;
}
// Schlussbild zeichnen: Aufruf groß, darunter der Kanalname, darüber ein Balken in der Akzentfarbe
function endcardDraw(cv, o, W, H){
  const pr = slProfile(), C = slColors(pr, pr.theme !== 'hell'), u = Math.min(W, H), ctx = cv.getContext('2d');
  cv.width = W; cv.height = H; ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  const headF = slFontFn(pr.fonts.head, 800), bodyF = slFontFn(pr.fonts.body, 600), maxW = W * 0.8, call = String(o.call || '').trim(), name = String(o.name || '').trim();
  let hs = u * 0.1, lines = [];
  for (let k = 0; k < 12; k++){ ctx.font = headF(hs); lines = wrapLines(ctx, call, maxW); if (lines.length <= 4 && lines.every(l => ctx.measureText(l).width <= maxW)) break; hs *= 0.9; }
  let ns = u * 0.05; ctx.font = bodyF(ns); if (name && ctx.measureText(name).width > maxW){ ns *= Math.max(0.4, maxW / ctx.measureText(name).width); }
  const lh = hs * 1.16, barW = u * 0.14, barH = Math.max(3, Math.round(u * 0.012)), gapBar = lines.length ? hs * 0.55 : 0, gapName = name && lines.length ? hs * 0.6 : 0;
  const blockH = barH + gapBar + lines.length * lh + (name ? gapName + ns * 1.2 : 0); let y = (H - blockH) / 2;
  ctx.fillStyle = C.acc; ctx.fillRect((W - barW) / 2, y, barW, barH); y += barH + gapBar;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = C.fg; ctx.font = headF(hs);
  for (const l of lines){ ctx.fillText(l, W / 2, y + lh / 2); y += lh; }
  if (name){ y += gapName; ctx.fillStyle = C.acc; ctx.font = bodyF(ns); ctx.fillText(name, W / 2, y + ns * 0.6); }
}
async function endcardMake(o){
  if (!P || !TS.saveImage) return;
  if (!String(o.call || '').trim() && !String(o.name || '').trim()) return toast('Bitte einen Aufruf oder den Kanalnamen eintragen');
  try { await slFonts(slProfile()); } catch(_){}
  const [W, H] = outSize(), cv = document.createElement('canvas'); endcardDraw(cv, o, W, H);
  const url = cv.toDataURL('image/png'), m = J(TS.saveImage(`endkarte-${hashStr(JSON.stringify([o.call, o.name, W, H, houseStyleKey()]))}.png`, url, W, H, P.id)); if (!m || !m.uri) return toast('Die Endkarte konnte nicht gespeichert werden');
  const dur = clamp(+o.dur || 4, 1, 30), ec = {call: String(o.call || '').trim(), name: String(o.name || '').trim()};
  try { localStorage.setItem(ENDCARD_KEY, JSON.stringify({...ec, dur})); } catch(_){}
  const old = endcardItem();
  if (old){ commit(() => { old.clip = jc(m); old.out = r3(old.in + dur); old.endcard = ec; }, true); seekOut(outPos, false); toast('Endkarte aktualisiert'); }
  else if (blockAdd(m, 'back', 'Endkarte', dur, {endcard: ec})) toast('Endkarte hinten angefügt');
  paintHouse();
}

// ── Blatt „Hausstil und Bausteine“ (im Projekt und auf der Startseite) ──
const houseSheetOpen = () => !$('#sheet').classList.contains('hidden') && !!$('#hsList');
function openHouse(){
  const body = $('#sheetBody'), inP = !!P && !$('#proj').classList.contains('hidden'), ec = endcardVals(), old = inP ? endcardItem() : null;
  if (old && old.endcard){ ec.call = old.endcard.call; ec.name = old.endcard.name; ec.dur = r3(old.out - old.in); }
  sheetItem = null;
  body.innerHTML = `<h3>Hausstil und Bausteine</h3>
    <div class="hs-sec"><h4>Hausstil</h4>
      <p class="muted small">Eine Vorlage merkt sich Untertitel-Stil, Wasserzeichen, Format der Leinwand, Schutzzonen, Lautstärke-Angleichung, die Einstellungen zum Ton (Musik weicht der Sprache, Stimme aufbereiten), Textzeile, Quellenzeile, Bauchbinden, die Kennzeichnung von Clip-Reihen („Teil 1/3“), das Designprofil der Folien und die Aufräum-Optionen. Mit dem Stern starten neue Projekte in diesem Stil.</p>
      <div class="hs-list" id="hsList"></div>
      ${inP ? '<div class="row"><button class="btn" id="hsSave">＋ Stil dieses Projekts als Vorlage speichern</button></div>' : '<p class="muted small">Neue Vorlagen speicherst du in einem geöffneten Projekt über dasselbe Symbol.</p>'}
    </div>
    <div class="hs-sec"><h4>Bausteine</h4>
      <p class="muted small">Intro, „Folgen“-Aufruf, Spendenhinweis: einmal ablegen${inP ? ', mit einem Klick vorn oder hinten anfügen' : ', im Projekt mit einem Klick vorn oder hinten anfügen'}. Die Dateien bleiben an ihrem Ort auf diesem Gerät.</p>
      <div class="hs-list" id="bkList"></div>
      <div class="row"><button class="btn" id="bkAdd">＋ Clip oder Bild ablegen</button></div>
    </div>
    ${inP && TS.saveImage ? `<div class="hs-sec"><h4>Endkarte</h4>
      <p class="muted small">Schlussbild mit Aufruf und Kanalnamen im Designprofil deiner Folien. Es entsteht im aktuellen Format und hängt sich hinten an.</p>
      <div class="ec-grid"><canvas id="ecPrev" class="ec-prev"></canvas>
        <div class="ec-form"><label class="field"><span>Aufruf</span><textarea id="ecCall" rows="2" maxlength="120" dir="auto"></textarea></label>
          <label class="field"><span>Kanalname</span><input type="text" id="ecName" maxlength="60" placeholder="@deinkanal" autocomplete="off" autocapitalize="off" spellcheck="false" dir="auto"></label>
          <label class="field"><span>Dauer <b id="ecDurV"></b></span><input type="range" id="ecDur" min="1" max="10" step="0.5"></label></div></div>
      <div class="row"><button class="btn" id="ecAdd"></button></div>
    </div>` : ''}
    <div class="row" style="margin-top:12px"><button class="btn primary" id="hsOk" style="margin-left:auto">Fertig</button></div>`;
  if ($('#ecCall')){ $('#ecCall').value = ec.call; $('#ecName').value = ec.name; $('#ecDur').value = clamp(+ec.dur || 4, 1, 10);
    const paintEc = () => { const [W, H] = outSize(), k = 220 / Math.max(W, H), o = {call: $('#ecCall').value, name: $('#ecName').value};
      endcardDraw($('#ecPrev'), o, Math.round(W * k * 2), Math.round(H * k * 2)); $('#ecPrev').style.aspectRatio = `${W} / ${H}`;
      $('#ecDurV').textContent = (+$('#ecDur').value).toFixed(1).replace('.', ',') + ' s'; };
    ['ecCall', 'ecName', 'ecDur'].forEach(id => $('#' + id).addEventListener('input', paintEc)); paintEc();
    slFonts(slProfile()).then(() => { if ($('#ecPrev')) paintEc(); }).catch(() => {}); }
  body.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const hid = b.closest('[data-h]') && b.closest('[data-h]').dataset.h, bid = b.closest('[data-b]') && b.closest('[data-b]').dataset.b;
    const h = hid && houseList.find(x => x.id === hid), bk = bid && blockList.find(x => x.id === bid);
    if (b.id === 'hsOk') return closeSheet();
    if (b.id === 'hsSave') return void houseSave();
    if (b.id === 'bkAdd') return void blockNew();
    if (b.id === 'ecAdd') return void endcardMake({call: $('#ecCall').value, name: $('#ecName').value, dur: +$('#ecDur').value});
    if (h){
      if (b.dataset.a === 'use'){ if (confirm(`Hausstil „${h.name}“ auf dieses Projekt anwenden? Untertitel-Stil, Wasserzeichen, Format und die weiteren Angaben der Vorlage ersetzen die bisherigen.`)){ houseApply(h); paintHouse(); } }
      else if (b.dataset.a === 'def'){ houseDef = houseDef === h.id ? '' : h.id; saveHouse(); paintHouse(); toast(houseDef ? `Neue Projekte starten mit „${h.name}“` : 'Neue Projekte starten ohne Vorlage'); }
      else if (b.dataset.a === 'ren'){ askName('Vorlage umbenennen', h.name).then(n => { if (n){ h.name = n.slice(0, 40); saveHouse(); paintHouse(); } }); }
      else if (b.dataset.a === 'del'){ if (confirm(`Vorlage „${h.name}“ löschen? Projekte behalten ihren Stil.`)){ houseList = houseList.filter(x => x !== h); saveHouse(); paintHouse(); } }
    } else if (bk){
      if (b.dataset.a === 'front' || b.dataset.a === 'back'){ blockUse(bk, b.dataset.a); paintHouse(); }
      else if (b.dataset.a === 'ren'){ askName('Baustein umbenennen', bk.name).then(n => { if (n){ bk.name = n.slice(0, 40); saveBlocks(); paintHouse(); } }); }
      else if (b.dataset.a === 'del'){ if (confirm(`Baustein „${bk.name}“ entfernen? Die Datei und Projekte, die ihn verwenden, bleiben unberührt.`)){ blockList = blockList.filter(x => x !== bk); saveBlocks(); paintHouse(); } }
    }
  };
  paintHouse(); openSheet(false);
}
function paintHouse(){
  if (!$('#hsList')) return; const inP = !!P && !$('#proj').classList.contains('hidden');
  $('#hsList').innerHTML = houseList.length ? houseList.map(h => `<div class="hs-row" data-h="${esc(h.id)}"><div class="hs-n"><b dir="auto">${esc(h.name)}</b><span class="muted small">${esc(houseSummary(h.st))}${houseDef === h.id ? ' · für neue Projekte' : ''}</span></div>
      ${inP ? '<button type="button" class="btn small" data-a="use">Anwenden</button>' : ''}<button type="button" class="mini${houseDef === h.id ? ' on' : ''}" data-a="def" title="${houseDef === h.id ? 'Neue Projekte starten mit dieser Vorlage – antippen zum Abwählen' : 'Neue Projekte mit dieser Vorlage starten'}" aria-pressed="${houseDef === h.id}">★</button><button type="button" class="mini" data-a="ren" title="Umbenennen">✎</button><button type="button" class="mini" data-a="del" title="Löschen">×</button></div>`).join('')
    : '<p class="muted small">Noch keine Vorlage.</p>';
  $('#bkList').innerHTML = blockList.length ? blockList.map(b => `<div class="hs-row" data-b="${esc(b.id)}"><div class="hs-n"><b dir="auto">${esc(b.name)}</b><span class="muted small">${esc(blockDur(b.clip))}</span></div>
      ${inP ? '<button type="button" class="btn small" data-a="front" title="Vor dem Video anfügen">Vorn</button><button type="button" class="btn small" data-a="back" title="Hinter dem Video anfügen">Hinten</button>' : ''}<button type="button" class="mini" data-a="ren" title="Umbenennen">✎</button><button type="button" class="mini" data-a="del" title="Entfernen">×</button></div>`).join('')
    : '<p class="muted small">Noch keine Bausteine.</p>';
  if ($('#ecAdd')) $('#ecAdd').textContent = endcardItem() ? 'Endkarte aktualisieren' : '＋ Endkarte anfügen';
}
$('#houseBtn').onclick = () => { if (P) openHouse(); };
$('#houseHome').onclick = () => openHouse();


// ── Layout-Vorlagen für Reaktionen (B8) ──
// Splitscreen: Die Einblendung füllt eine Bildhälfte (Zuschnitt auf deren Seitenverhältnis); das Hauptvideo rückt über den Bildausschnitt
// des ganzen Videos (P.frame) in die andere Hälfte. Das gilt für die ganze Länge.
const SPLIT = {o: [0.5, 0.25, 1, 0.5], u: [0.5, 0.75, 1, 0.5], l: [0.25, 0.5, 0.5, 1], r: [0.75, 0.5, 0.5, 1]};   // Mitte x, Mitte y, Breite, Höhe
const SPLIT_OPP = {o: 'u', u: 'o', l: 'r', r: 'l'};
function splitOf(it){
  if (!it || it.type !== 'pip' || it.w == null || (it.kf && it.kf.length)) return '';
  const [W, H] = outSize(), hh = it.w * W / elAspect(it) / H;
  for (const k in SPLIT){ const [x, y, w, h] = SPLIT[k]; if (Math.abs(it.x - x) < 0.004 && Math.abs(it.y - y) < 0.004 && Math.abs(it.w - w) < 0.004 && Math.abs(hh - h) < 0.01) return k; }
  return '';
}
function splitApply(it, k){
  const [W, H] = outSize(), [x, y, w, h] = SPLIT[k], ar = (w * W) / (h * H), a0 = clipAspect(it.clip);
  const cut = +((1 - (a0 > ar ? ar / a0 : a0 / ar)) / 2).toFixed(5);
  if (!splitOf(it)) it.splitBack = {type: it.type, x: it.x ?? null, y: it.y ?? null, w: it.w ?? null, crop: jc(it.crop), frame: jc(P.frame)};   // Stand vor dem Splitscreen, für „Aus“
  it.type = 'pip'; delete it.kf; it.crop = a0 > ar ? {l: cut, t: 0, r: cut, b: 0} : {l: 0, t: cut, r: 0, b: cut};
  it.x = x; it.y = y; it.w = w;
  const [mx, my, mw, mh] = SPLIT[SPLIT_OPP[k]], [wf, hf] = fitFrac();
  P.frame = clampFrame({sc: Math.max(mw / wf, mh / hf), tx: mx - 0.5, ty: my - 0.5});
}
function splitEnd(it){
  if (!splitOf(it)) return;
  const [W, H] = outSize(), b = it.splitBack; delete it.splitBack; delete it.crop;
  if (b && b.type === 'broll' && b.w == null){ it.type = 'broll'; delete it.w; delete it.x; delete it.y; if (b.crop) it.crop = b.crop; }
  else if (b && b.w != null){ it.x = b.x; it.y = b.y; it.w = b.w; if (b.crop) it.crop = b.crop; }
  else { it.size = +Math.min(0.4, 0.45 * H * clipAspect(it.clip) / W).toFixed(3); it.w = it.size; pipCorner(it, 'or'); }
  P.frame = b ? (b.frame ? clampFrame(b.frame) : null) : P.format ? clampFrame({sc: coverSc(), tx: 0, ty: 0}) : null;
}
// Rahmen und Namensschild einer Einblendung: it.deco = {frame, name}. Vorschau und Export zeichnen mit derselben Funktion;
// im Export liegt das Ergebnis als Bild über dem Element (Spur 60 + Spur des Elements). Bewegte Elemente (Keyframes) bleiben ohne.
const decoOn = it => !!(it && it.deco && (it.deco.frame || String(it.deco.name || '').trim()) && it.type === 'pip' && !(it.kf && it.kf.length));
function decoDraw(cv, w, h, u, deco){   // w × h: Größe des Elements in Pixeln, u: kürzere Bildseite; liefert die Rahmenstärke
  const pr = slProfile(), C = slColors(pr, pr.theme !== 'hell'), b = deco.frame ? Math.max(2, Math.round(u * 0.006)) : 0, name = String(deco.name || '').trim();
  cv.width = Math.max(2, Math.round(w + 2 * b)); cv.height = Math.max(2, Math.round(h + 2 * b)); const ctx = cv.getContext('2d');
  if (b){ ctx.strokeStyle = C.acc; ctx.lineWidth = b; ctx.strokeRect(b / 2, b / 2, cv.width - b, cv.height - b); }
  if (name){
    const f = slFontFn(pr.fonts.head, 700); let fs = clamp(h * 0.1, u * 0.02, u * 0.036); ctx.font = f(fs); let tw = ctx.measureText(name).width;
    const room = w * 0.92 - fs * 1.3; if (tw > room){ fs *= Math.max(0.45, room / tw); ctx.font = f(fs); tw = ctx.measureText(name).width; }
    const px = fs * 0.55, th = fs * 1.7, bar = pr.bar !== false ? Math.round(fs * 0.2) : 0, tx = b, ty = cv.height - b - th;
    ctx.fillStyle = C.bg; ctx.fillRect(tx, ty, bar + 2 * px + tw, th); if (bar){ ctx.fillStyle = C.acc; ctx.fillRect(tx, ty, bar, th); }
    ctx.fillStyle = C.fg; ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillText(name, tx + bar + px, ty + th * 0.53);
  }
  return b;
}
let decoFontTry = '';
function placeDeco(act, o, W, H){
  const box = $('#decoOv'), want = new Map();
  for (const a of act){ const it = a.x; if (!decoOn(it)) continue; const v = PipDrag.on && PipDrag.it === it ? PipDrag : elVals(it, o - a.at), r = elRect(it, v, W, H); if (r) want.set(it.id, {it, r}); }
  for (const el of [...box.children]) if (!want.has(el.dataset.id)) el.remove();
  if (!want.size) return;
  const fk = lowerFontKey(), ok = lowerFontsOk.has(fk);
  if (!ok && decoFontTry !== fk){ decoFontTry = fk; lowerFonts().then(() => { if (P && !playing) updateOverlay(outPos); }); }
  const d = Math.min(2, window.devicePixelRatio || 1), u = Math.min(W, H), sk = houseStyleKey() + (ok ? 1 : 0);
  for (const [id, {it, r}] of want){
    let cv = [...box.children].find(el => el.dataset.id === id); if (!cv){ cv = document.createElement('canvas'); cv.dataset.id = id; box.append(cv); }
    const key = [r.w.toFixed(1), r.h.toFixed(1), u, d, it.deco.frame ? 1 : 0, it.deco.name || '', sk].join('|');
    if (cv.dataset.k !== key){ cv.dataset.b = decoDraw(cv, r.w * d, r.h * d, u * d, it.deco) / d; cv.dataset.k = key; }
    const b = +cv.dataset.b || 0;
    Object.assign(cv.style, {left: (r.cx - r.w / 2 - b).toFixed(1) + 'px', top: (r.cy - r.h / 2 - b).toFixed(1) + 'px', width: (r.w + 2 * b).toFixed(1) + 'px', height: (r.h + 2 * b).toFixed(1) + 'px'});
  }
}
const decoReady = () => P && P.items.some(decoOn) ? lowerFonts() : Promise.resolve();
function decoPlan(W, H){
  const out = []; if (!TS.saveImage) return out;
  for (const o of overlays){ const it = o.x; if (!decoOn(it)) continue; const r = elRect(it, elVals(it, 0), W, H); if (!r) continue;
    const cv = document.createElement('canvas'); decoDraw(cv, r.w, r.h, Math.min(W, H), it.deco);
    const m = J(TS.saveImage(`rahmen-${hashStr(JSON.stringify([cv.width, cv.height, W, H, it.deco.frame ? 1 : 0, it.deco.name || '', houseStyleKey()]))}.png`, cv.toDataURL('image/png'), cv.width, cv.height, P.id)); if (!m || !m.uri) continue;
    out.push({mode: 'pip', image: true, uri: m.uri, in: 0, out: r3(o.end - o.at), at: r3(o.at), x: r3(r.cx / W), y: r3(r.cy / H), w: +(cv.width / W).toFixed(4), aspect: +(cv.width / cv.height).toFixed(5),
      track: 60 + elTrack(it), vol: 0, hasAudio: false, width: cv.width, height: cv.height, rotation: 0, deco: true});
  }
  return out;
}

// ───────── Ton (2.34): Musik weicht der Sprache (E1), Stimme aufbereiten (E2), Übergänge (E3) ─────────
// P.audio = {duck: {on, db}, voice: {on}} – Einstellungen zum Ton des Projekts; Teil des Rückgängig-Stands (au) und des Hausstils.
// Tonspur-Elemente tragen ihre Rolle in duck: (fehlt) weicht der Sprache · 'voice' ist selbst Sprache · false bleibt, wie sie ist.
const DUCK_STEPS = [[8, 'leicht'], [14, 'mittel'], [20, 'stark']], DUCK_DEF = 14;
const DUCK_DOWN = 0.25, DUCK_HOLD = 0.4, DUCK_UP = 0.8, DUCK_GAP = 2;   // Sekunden: absenken, halten, zurückkommen; kürzere Pausen bleiben abgesenkt
const audioSet = () => (P && P.audio) || {};
const duckOn = () => !!(audioSet().duck && audioSet().duck.on);
const duckDb = () => { const d = +(audioSet().duck || {}).db; return d >= 3 && d <= 30 ? d : DUCK_DEF; };
const duckRole = x => !x || x.type !== 'audio' ? '' : x.duck === false ? 'keep' : x.duck === 'voice' ? 'voice' : 'duck';
const ducks = x => duckRole(x) === 'duck';
function audioEdit(fn){ commit(() => { P.audio = jc(P.audio) || {}; fn(P.audio); }, false); }
// Sprachabschnitte aus einem Lautstärkeverlauf, der nicht zu einem Video der Hauptspur gehört (Sprachaufnahme auf einer Tonspur)
function burstsOfUri(uri){
  const src = P.sources.find(x => x.uri === uri); if (src && envArr(src)) return burstsOf(src);
  const a = envDone.get(uri);
  if (!a){ if (!burstsOfUri.asked.has(uri) && window.envOfUri){ burstsOfUri.asked.add(uri); envOfUri(uri).then(e => { if (e){ if (!envDone.has(uri)) envDone.set(uri, e); audioDirty(); } }); } return null; }
  let h = burstsOfUri.memo.get(uri); if (!h){ h = {env: 1}; Object.defineProperty(h, '_env', {value: a, writable: true}); burstsOfUri.memo.set(uri, h); }
  return burstsOf(h);
}
burstsOfUri.memo = new Map(); burstsOfUri.asked = new Set();
let speechMemo = null, duckMemo = null;
function audioDirty(){ speechMemo = null; duckMemo = null; }
// Wo gesprochen wird, in Ausgabezeit: Sprachabschnitte der Hauptspur (aus dem Lautstärkeverlauf), Einschübe mit Ton und
// Tonspur-Elemente, die als Sprache gelten. Abschnitte, zwischen denen weniger als DUCK_GAP liegt, zählen als einer.
function speechOut(){
  if (speechMemo) return speechMemo;
  const out = [];
  for (const g of timeline){
    const d = segDur(g); if (!(d > 0)) continue;
    if (g.kind === 'insert'){ const c = g.item.clip; if (c && !isImg(c) && c.hasAudio !== false && (g.item.vol ?? 1) > 0) out.push([g.o, g.o + d]); continue; }
    const s = P.sources[g.si]; if (!s || s.hasAudio === false || s.noAudio || !(((g.fx || FX_DEF).vol ?? 1) * srcVol(g.si) > 0)) continue;
    const bs = burstsOf(s), sp = g.speed || 1, a0 = g.in - s.off, b0 = g.out - s.off;
    if (!bs && !tokens.length){ out.push([g.o, g.o + d]); continue; }   // ohne Lautstärkeverlauf und ohne Transkript gilt der ganze Abschnitt als Sprache
    for (const [x, y] of bs || []){ if (y <= a0) continue; if (x >= b0) break; out.push([g.o + (Math.max(x, a0) - a0) / sp, g.o + (Math.min(y, b0) - a0) / sp]); }
    // Die Wörter des Transkripts zählen auch dort, wo leise gesprochen wird und der Lautstärkeverlauf unter seiner Schwelle bleibt
    let lo = 0, hi = tokens.length; while (lo < hi){ const m = (lo + hi) >> 1; if (tokens[m].e <= g.in) lo = m + 1; else hi = m; }
    for (let i = lo; i < tokens.length && tokens[i].s < g.out; i++){ const t = tokens[i]; if (t.type !== 'word' || deleted.has(i)) continue;
      const x = Math.max(wS(t), g.in), y = Math.min(wE(t), g.out); if (y > x) out.push([g.o + (x - g.in) / sp, g.o + (y - g.in) / sp]); }
  }
  for (const a of audios){
    if (duckRole(a.x) !== 'voice' || !((a.x.vol ?? 1) > 0)) continue;
    const bs = burstsOfUri(a.x.clip.uri), i0 = a.x.in || 0, i1 = i0 + (a.end - a.at);
    if (!bs || !bs.length){ out.push([a.at, a.end]); continue; }   // (noch) kein Lautstärkeverlauf oder keine Abschnitte darin: die ganze Aufnahme zählt
    for (const [x, y] of bs){ if (y <= i0) continue; if (x >= i1) break; out.push([a.at + Math.max(x, i0) - i0, a.at + Math.min(y, i1) - i0]); }
  }
  out.sort((p, q) => p[0] - q[0]);
  const m = [];
  for (const iv of out){ const l = m[m.length - 1]; if (l && iv[0] - l[1] < DUCK_GAP) l[1] = Math.max(l[1], iv[1]); else m.push([iv[0], iv[1]]); }
  return speechMemo = m;
}
// Wert eines stückweise linearen Verlaufs [[t, g], …] an der Stelle t (vor dem ersten und nach dem letzten Punkt gilt deren Wert)
function curveAt(pts, t){
  const n = pts.length; if (!n) return 1; if (t <= pts[0][0]) return pts[0][1]; if (t >= pts[n - 1][0]) return pts[n - 1][1];
  let lo = 0, hi = n - 1; while (hi - lo > 1){ const m = (lo + hi) >> 1; if (pts[m][0] <= t) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi], w = b[0] - a[0]; return w > 1e-9 ? a[1] + (b[1] - a[1]) * (t - a[0]) / w : b[1];
}
// Verlauf der Absenkung in Ausgabezeit: vor der Sprache geht die Musik in DUCK_DOWN herunter, bleibt nach ihrem Ende DUCK_HOLD
// unten und kommt in DUCK_UP zurück. Leer, wenn nichts abzusenken ist.
function duckPts(){
  if (duckMemo) return duckMemo;
  const k = Math.pow(10, -duckDb() / 20), raw = [];
  for (const [a, b] of speechOut()) raw.push([a - DUCK_DOWN, 1], [a, k], [b + DUCK_HOLD, k], [b + DUCK_HOLD + DUCK_UP, 1]);
  const pts = [];
  if (raw.length){   // auf die Länge des Videos beschneiden
    const g0 = curveAt(raw, 0), g1 = curveAt(raw, total);
    if (raw[0][0] < 0) pts.push([0, g0]);
    for (const p of raw) if (p[0] >= 0 && p[0] <= total) pts.push(p);
    if (raw[raw.length - 1][0] > total) pts.push([total, g1]);
  }
  return duckMemo = pts;
}
const duckAt = o => duckOn() ? curveAt(duckPts(), o) : 1;
// Für den Export: Verlauf nur, wenn es etwas abzusenken gibt
function duckPlan(){
  if (!duckOn() || !(exFmt === 'video' || exFmt === 'audio') || !audios.some(a => ducks(a.x) && (a.x.vol ?? 1) > 0)) return null;
  const pts = duckPts(); return pts.length ? pts.map(([t, g]) => [r3(t), +g.toFixed(4)]) : null;
}
// Hinweis unter der Rolle eines Tonspur-Elements („Lautstärke & Ausschnitt“)
function duckNote(it){
  if (!duckOn()) return '„Musik weicht der Sprache“ ist für dieses Projekt aus. <button type="button" class="btn small" id="cDuckOn">Einschalten</button>';
  const r = duckRole(it);
  return r === 'duck' ? `Geht um ${duckDb()} dB zurück, sobald gesprochen wird, und kommt in Pausen ab ${DUCK_GAP} Sekunden wieder. Die Stärke steht unter „Lautstärke“.`
    : r === 'voice' ? 'Gilt selbst als Sprache: Musik auf den anderen Tonspuren weicht auch dieser Aufnahme.' : 'Behält durchgehend die eingestellte Lautstärke.';
}
// Schalter zum Ton des Projekts im Blatt „Lautstärke“
const DUCK_ROLE = {duck: 'weicht der Sprache', voice: 'gilt als Sprache', keep: 'bleibt gleich'};
function toneBoxHtml(){
  const on = duckOn(), db = duckDb(), n = P.items.filter(x => x.type === 'audio').length;
  return `<label class="row"><input type="checkbox" id="duckOn"${on ? ' checked' : ''}><span><b>Musik weicht der Sprache</b></span></label>
    <p class="muted small">Tonspuren werden leiser, sobald gesprochen wird, und kommen in Pausen ab ${DUCK_GAP} Sekunden zurück.${n ? '' : ' Noch liegt nichts auf einer Tonspur.'} Einzelne Elemente lassen sich unter „Lautstärke & Ausschnitt“ ausnehmen oder selbst als Sprache einstellen.</p>
    <div class="field${on ? '' : ' hidden'}" id="duckDbRow"><span>Absenkung <b>${db} dB</b></span><div class="seg-ctl" id="duckDb">${DUCK_STEPS.map(([v, l]) => `<button type="button" data-db="${v}"${v === db ? ' class="on"' : ''}>${l}</button>`).join('')}</div></div>
    <div class="tone-sep"></div>
    <label class="row"><input type="checkbox" id="voiceOn"${voiceOn() ? ' checked' : ''}><span><b>Stimme aufbereiten</b></span></label>
    <p class="muted small">Nimmt Brummen und Rauschen zurück, dämpft den Nachhall zwischen den Silben und gleicht leise und laute Stellen an. Gilt für die Videos der Hauptspur, in der Vorschau und im Export, und läuft auf diesem Gerät ohne Online-Dienst.</p>`;
}
function toneBoxBind(){
  const box = $('#toneBox'); if (!box) return;
  const again = () => { box.innerHTML = toneBoxHtml(); toneBoxBind(); seekOut(outPos, false); if (window.renderTimeline && tlOn()) renderTimeline(); };
  $('#duckOn').onchange = e => { const on = e.target.checked; audioEdit(a => { a.duck = {...(a.duck || {}), on}; }); again(); toast(on ? 'Musik weicht jetzt der Sprache' : 'Musik bleibt durchgehend gleich laut'); };
  $('#duckDb').onclick = e => { const b = e.target.closest('button'); if (!b) return; audioEdit(a => { a.duck = {...(a.duck || {}), on: true, db: +b.dataset.db}; }); again(); };
  $('#voiceOn').onchange = e => { const on = e.target.checked; audioEdit(a => { a.voice = {...(a.voice || {}), on}; }); again(); toast(on ? 'Die Stimme wird aufbereitet – in der Vorschau zu hören' : 'Der Ton der Hauptspur bleibt, wie er aufgenommen ist'); };
}
// ── Stimme aufbereiten (E2): Rechenkern ──
// Ein Durchgang in überlappenden Rahmen (rund 21 ms, 75 % Überlappung): Hochpass gegen Trittschall und Brummen,
// Rauschminderung (die Rauschschätzung folgt je Frequenzband dem leisesten Pegel der letzten Zeit) und eine Dämpfung des späten
// Nachhalls; danach der Pegelverlauf (leise Stellen anheben) und eine weiche Begrenzung. Dieselbe Rechnung steht in
// textschnitt.py (Windows) und VoiceDsp.java (Android). Die Funktion ist in sich geschlossen: Ihr Quelltext läuft auch im
// AudioWorklet der Vorschau, deshalb greift sie auf nichts außerhalb zu.
function voiceDspLib(){
  const V = {hp: 85, tauS: 0.04, rise: 2, beta: 2.5, floorN: -12, floorR: -9, rt60: 0.6, td: 0.05, tauG: 0.05, dd: 0.96, makeup: 1.5, knee: 0.8, prime: 2};
  class VoiceDsp {
    // sr: Abtastrate, ch: Kanäle; noise: Rauschschätzung aus einem früheren Abschnitt derselben Aufnahme (Float64Array) oder null
    constructor(sr, ch, noise){
      this.sr = sr; this.ch = ch;
      const N = this.N = sr >= 64000 ? 2048 : sr >= 32000 ? 1024 : sr >= 16000 ? 512 : 256, H = this.H = N >> 2, K = this.K = (N >> 1) + 1;
      this.win = new Float64Array(N); for (let i = 0; i < N; i++) this.win[i] = Math.sin(Math.PI * i / N);
      this.hp = new Float64Array(K); for (let k = 1; k < K; k++){ const q = V.hp / (k * sr / N); this.hp[k] = 1 / Math.sqrt(1 + q * q * q * q); }
      this.aS = Math.exp(-H / (sr * V.tauS)); this.W = Math.max(2, Math.round(2 * V.tauS * sr / H));
      this.up = Math.pow(10, V.rise * H / sr / 10); this.rel = Math.exp(-H / (sr * V.tauG));
      this.D = Math.max(1, Math.round(V.td * sr / H)); this.rho = Math.pow(10, -6 * (this.D * H / sr) / V.rt60);
      this.gn = Math.pow(10, V.floorN / 20); this.gr = Math.pow(10, V.floorR / 20); this.makeup = Math.pow(10, V.makeup / 20);
      this.noise = noise && noise.length === K ? Float64Array.from(noise) : null;
      // Tabellen der schnellen Fourier-Transformation
      let bits = 0; while ((1 << bits) < N) bits++;
      this.rev = new Uint32Array(N); for (let i = 0; i < N; i++){ let r = 0; for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b); this.rev[i] = r; }
      this.cos = new Float64Array(N >> 1); this.sin = new Float64Array(N >> 1); for (let i = 0; i < N >> 1; i++){ this.cos[i] = Math.cos(2 * Math.PI * i / N); this.sin[i] = Math.sin(2 * Math.PI * i / N); }
      this.re = new Float64Array(N); this.im = new Float64Array(N);
      this.Xr = []; this.Xi = []; this.inb = []; this.ola = [];
      for (let c = 0; c < ch; c++){ this.Xr.push(new Float64Array(K)); this.Xi.push(new Float64Array(K)); this.inb.push(new Float64Array(N)); this.ola.push(new Float64Array(N)); }
      this.S = new Float64Array(K); this.P = new Float64Array(K); this.G = new Float64Array(K); this.Gf = new Float64Array(K);
      this.Gs = new Float64Array(K); this.Gp = new Float64Array(K); this.gam = new Float64Array(K); this.ring = new Float64Array(this.D * K);
      this.lvl = null; this.reset();
    }
    // Neuer Abschnitt: alles auf Anfang, die Rauschschätzung bleibt
    reset(){
      this.m = 0; this.ri = 0; this.ring.fill(0); this.Gs.fill(this.gn); this.Gp.fill(this.gn); this.gam.fill(1);
      for (let c = 0; c < this.ch; c++){ this.inb[c].fill(0); this.ola[c].fill(0); }
      this.hops = 0; this.fed = 0; this.done = 0; this.part = 0; this.lk = 0;
    }
    // inv: Rücktransformation (ohne Teilung durch N)
    fft(inv){
      const N = this.N, re = this.re, im = this.im, rev = this.rev, cs = this.cos, sn = this.sin;
      for (let i = 0; i < N; i++){ const j = rev[i]; if (j > i){ let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
      for (let size = 2; size <= N; size <<= 1){
        const half = size >> 1, step = N / size;
        for (let a = 0; a < N; a += size) for (let k = 0; k < half; k++){
          const wr = cs[k * step], wi = inv ? sn[k * step] : -sn[k * step], p = a + k, q = p + half;
          const tr = re[q] * wr - im[q] * wi, ti = re[q] * wi + im[q] * wr;
          re[q] = re[p] - tr; im[q] = im[p] - ti; re[p] += tr; im[p] += ti;
        }
      }
    }
    // Geglättete Leistung und Rauschschätzung aus einem vollständigen Rahmen
    track(){
      const K = this.K, S = this.S, P = this.P; this.m++;
      if (this.m === 1) for (let k = 0; k < K; k++) S[k] = P[k];
      else if (this.m <= this.W) for (let k = 0; k < K; k++) S[k] = S[k] + (P[k] - S[k]) / this.m;
      else { const a = this.aS; for (let k = 0; k < K; k++) S[k] = a * S[k] + (1 - a) * P[k]; }
      if (!this.noise){ if (this.m === this.W) this.noise = Float64Array.from(S); }
      else if (this.m > this.W){ const nz = this.noise, up = this.up; for (let k = 0; k < K; k++) nz[k] = S[k] < nz[k] ? S[k] : Math.min(S[k], nz[k] * up); }
    }
    // Gewinn je Frequenzband für den Rahmen mit der Leistung this.P; full: der Rahmen besteht ganz aus Ton (keine Auffüllung)
    gain(full){
      const K = this.K, P = this.P, G = this.G, Gf = this.Gf, Gs = this.Gs, Gp = this.Gp, gam = this.gam, gn = this.gn, gr = this.gr;
      if (full && this.psum > 1e-9) this.track();   // völlige Stille (stumm geschaltete Stellen) lehrt nichts über das Rauschen
      const Sx = this.m > 0 ? this.S : P, nz = this.noise, ring = this.ring, r0 = this.ri * K;
      for (let k = 0; k < K; k++){
        let g = 1, ga = 1;
        if (nz){ ga = P[k] / (V.beta * nz[k] + 1e-12); const xi = V.dd * Gp[k] * Gp[k] * gam[k] + (1 - V.dd) * Math.max(ga - 1, 0); g = Math.max(gn, xi / (1 + xi)); }
        Gp[k] = g; gam[k] = ga;
        const r = Math.max(gr, 1 - this.rho * ring[r0 + k] / (Sx[k] + 1e-12));
        G[k] = Math.max(gn, g * r);
      }
      if (full && this.m > 0){ for (let k = 0; k < K; k++) ring[r0 + k] = this.S[k]; this.ri = (this.ri + 1) % this.D; }
      Gf[0] = G[0]; Gf[K - 1] = G[K - 1]; for (let k = 1; k < K - 1; k++) Gf[k] = 0.25 * G[k - 1] + 0.5 * G[k] + 0.25 * G[k + 1];
      const rel = this.rel; for (let k = 0; k < K; k++) Gs[k] = Gf[k] > Gs[k] ? Gf[k] : rel * Gs[k] + (1 - rel) * Gf[k];
    }
    // Die Rahmen aller Kanäle transformieren und die mittlere Leistung je Band bilden (this.inb ist gefüllt)
    analyse(){
      const N = this.N, K = this.K, P = this.P, re = this.re, im = this.im, win = this.win; P.fill(0);
      for (let c = 0; c < this.ch; c++){
        const b = this.inb[c]; for (let i = 0; i < N; i++){ re[i] = b[i] * win[i]; im[i] = 0; }
        this.fft(false);
        const xr = this.Xr[c], xi = this.Xi[c]; for (let k = 0; k < K; k++){ xr[k] = re[k]; xi[k] = im[k]; P[k] += re[k] * re[k] + im[k] * im[k]; }
      }
      let s = 0; for (let k = 0; k < K; k++){ P[k] /= this.ch; s += P[k]; } this.psum = s;
    }
    // Ein Schritt: x[c] sind H neue Abtastwerte je Kanal (ab Stelle xo), y[c] nimmt H fertige auf (ab Stelle yo) – um N − H verzögert
    hop(x, xo, y, yo, full){
      const N = this.N, H = this.H, K = this.K, re = this.re, im = this.im, win = this.win, hp = this.hp, Gs = this.Gs;
      for (let c = 0; c < this.ch; c++){ const b = this.inb[c]; b.copyWithin(0, H); for (let i = 0; i < H; i++) b[N - H + i] = x[c][xo + i]; }
      this.analyse(); this.gain(full);
      for (let c = 0; c < this.ch; c++){
        const xr = this.Xr[c], xi = this.Xi[c], o = this.ola[c];
        for (let k = 0; k < K; k++){ const g = Gs[k] * hp[k]; re[k] = xr[k] * g; im[k] = xi[k] * g; }
        for (let k = 1; k < K - 1; k++){ re[N - k] = re[k]; im[N - k] = -im[k]; }
        this.fft(true);
        for (let i = 0; i < N; i++) o[i] += re[i] / N * win[i] * 0.5;
        for (let i = 0; i < H; i++) y[c][yo + i] = o[i];
        o.copyWithin(0, H); o.fill(0, N - H);
      }
      this.hops++;
    }
    // Rauschschätzung aus dem Anfang einer Aufnahme lernen (x[c]: Float-Felder; nur vollständige Rahmen, ohne Ausgabe)
    prime(x, n){
      const N = this.N, H = this.H; this.reset();
      for (let a = 0; a + N <= n; a += H){ for (let c = 0; c < this.ch; c++){ const b = this.inb[c]; for (let i = 0; i < N; i++) b[i] = x[c][a + i]; } this.analyse(); if (this.psum > 1e-9) this.track(); }
      if (!this.noise && this.m >= 2) this.noise = Float64Array.from(this.S);
      this.reset();
    }
    // Pegelverlauf [[t, g], …] in Sekunden ab Beginn des Abschnitts (stückweise linear); scale: Zeitmaß (Tempo des Clips)
    setLevel(lvl, scale){ this.lvl = lvl && lvl.length ? lvl : null; this.lscale = scale || 1; this.lk = 0; }
    levelAt(i){
      const p = this.lvl; if (!p) return 1; const t = i / this.sr * this.lscale, n = p.length;
      if (t <= p[0][0]) return p[0][1]; if (t >= p[n - 1][0]) return p[n - 1][1];
      if (t < p[this.lk][0]) this.lk = 0; while (this.lk < n - 2 && t >= p[this.lk + 1][0]) this.lk++;
      const a = p[this.lk], b = p[this.lk + 1], w = b[0] - a[0]; return w > 1e-9 ? a[1] + (b[1] - a[1]) * (t - a[0]) / w : b[1];
    }
    // Abtastwert i des Abschnitts fertig machen: Ausgleich, Pegelverlauf, weiche Begrenzung
    shape(v, i){
      v *= this.makeup * this.levelAt(i); const k = V.knee, a = Math.abs(v);
      return a <= k ? v : (v < 0 ? -1 : 1) * (k + (1 - k) * Math.tanh((a - k) / (1 - k)));
    }
    // Abschnitt als Datenstrom: feed() nimmt beliebig lange Stücke an und gibt zurück, was fertig ist; finish() liefert den Rest.
    // Zusammen kommen genau so viele Abtastwerte heraus, wie hineingegangen sind – ohne Versatz.
    feed(x, n){
      const H = this.H, lat = this.N - H, ch = this.ch;
      if (!this.pend){ this.pend = []; this.tmp = []; for (let c = 0; c < ch; c++){ this.pend.push(new Float64Array(H)); this.tmp.push(new Float64Array(H)); } }
      const out = []; for (let c = 0; c < ch; c++) out.push(new Float32Array(Math.max(0, Math.floor((this.part + n) / H) * H)));
      let w = 0, i = 0;
      while (i < n){
        const k = Math.min(H - this.part, n - i); for (let c = 0; c < ch; c++) for (let q = 0; q < k; q++) this.pend[c][this.part + q] = x[c][i + q];
        this.part += k; i += k; this.fed += k;
        if (this.part === H){ this.hop(this.pend, 0, this.tmp, 0, this.hops * H + H >= this.N); this.part = 0;
          for (let q = 0; q < H; q++){ const pos = (this.hops - 1) * H + q - lat; if (pos < 0) continue; for (let c = 0; c < ch; c++) out[c][w] = this.shape(this.tmp[c][q], pos); w++; this.done++; } }
      }
      return out.map(o => o.subarray(0, w));
    }
    finish(){
      const H = this.H, ch = this.ch, rest = this.fed - this.done, out = []; for (let c = 0; c < ch; c++) out.push(new Float32Array(rest));
      if (!this.pend) return out;
      let w = 0;
      while (w < rest){
        for (let c = 0; c < ch; c++) this.pend[c].fill(0, this.part); this.part = 0;
        this.hop(this.pend, 0, this.tmp, 0, false);
        for (let q = 0; q < H && w < rest; q++){ const pos = (this.hops - 1) * H + q - (this.N - H); if (pos < 0) continue; for (let c = 0; c < ch; c++) out[c][w] = this.shape(this.tmp[c][q], pos); w++; this.done++; }
      }
      return out;
    }
    // Ein ganzer Abschnitt am Stück (x[c]: Float-Felder der Länge n)
    run(x, n, lvl){ this.reset(); this.setLevel(lvl, 1); const a = this.feed(x, n), b = this.finish(), out = [];
      for (let c = 0; c < this.ch; c++){ const o = new Float32Array(n); o.set(a[c]); o.set(b[c], a[c].length); out.push(o); } return out; }
  }
  return {VoiceDsp, V};
}
// ── Stimme aufbereiten: Schalter, Pegelverlauf, Vorschau ──
const voiceOn = () => !!(audioSet().voice && audioSet().voice.on);
// Pegelverlauf einer Aufnahme (Sekunden in der Aufnahme → Faktor): Wo leiser gesprochen wird als im Mittel, hebt er an, wo
// lauter, nimmt er zurück – zu 70 %, höchstens +9 und −6 dB, über drei Sekunden gemittelt. Gemessen wird am Lautstärkeverlauf,
// und zwar dort, wo gesprochen wird (Sprachabschnitte und Wörter des Transkripts); Pausen übernehmen den Wert ihrer Nachbarn.
const LVL_STEP = 0.25, LVL_WIN = 1.5, LVL_K = 0.7, LVL_MIN = -6, LVL_MAX = 9;
const lvlMemo = new Map();
function voiceLevel(si){
  const src = P.sources[si], a = src && envArr(src); if (!a) return [];
  const key = src.uri + ':' + a.length + ':' + tokens.length, hit = lvlMemo.get(key); if (hit) return hit;
  const n = a.length, act = new Uint8Array(n), ix = t => clamp(Math.round(t * 100), 0, n);
  for (const [x, y] of burstsOf(src) || []) act.fill(1, ix(x), ix(y));
  for (const t of tokens) if (t.src === si && t.type === 'word') act.fill(1, ix(wS(t) - src.off), ix(wE(t) - src.off));
  const cp = new Float64Array(n + 1), cn = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++){ cp[i + 1] = cp[i] + (act[i] ? Math.pow(10, (a[i] / 2.8 - 90) / 10) : 0); cn[i + 1] = cn[i] + act[i]; }
  const pts = [];
  if (cn[n] >= 30){
    const ref = 10 * Math.log10(cp[n] / cn[n]), m = Math.ceil(n / 100 / LVL_STEP) + 1, g = new Float64Array(m).fill(NaN);
    for (let j = 0; j < m; j++){ const t = j * LVL_STEP, i0 = ix(t - LVL_WIN), i1 = ix(t + LVL_WIN), c = cn[i1] - cn[i0];
      if (c >= 30) g[j] = clamp(LVL_K * (ref - 10 * Math.log10((cp[i1] - cp[i0]) / c)), LVL_MIN, LVL_MAX); }
    let last = -1;   // Lücken füllen: zwischen zwei Messwerten gerade verbinden, am Rand den nächsten übernehmen
    for (let j = 0; j < m; j++){ if (g[j] !== g[j]) continue;
      if (last < 0) g.fill(g[j], 0, j); else for (let q = last + 1; q < j; q++) g[q] = g[last] + (g[j] - g[last]) * (q - last) / (j - last);
      last = j; }
    if (last >= 0){ g.fill(g[last], last + 1);
      const s = Float64Array.from(g, (v, j) => (g[Math.max(0, j - 1)] + v + g[Math.min(m - 1, j + 1)]) / 3);
      let kept = NaN;
      for (let j = 0; j < m; j++) if (j === 0 || j === m - 1 || Math.abs(s[j] - kept) >= 0.2){ kept = s[j]; pts.push([+(j * LVL_STEP).toFixed(2), +Math.pow(10, s[j] / 20).toFixed(3)]); }
    }
  }
  if (lvlMemo.size > 60) lvlMemo.clear();
  lvlMemo.set(key, pts); return pts;
}
// Faktor des Pegelverlaufs an der Stelle, die das Hauptvideo gerade zeigt (für die Vorschau)
function voiceGainNow(g){
  if (!g || g.kind !== 'main' || !voiceOn()) return 1;
  const s = P.sources[g.si]; return s ? curveAt(voiceLevel(g.si), vT() - s.off) : 1;
}
// Für den Export: Schlüssel der Aufnahme und Pegelverlauf des Abschnitts (Sekunden ab Abschnittsbeginn in der Quelle)
function voicePlan(g){
  const s = P.sources[g.si], pts = voiceLevel(g.si), a = g.in - s.off, b = g.out - s.off, lvl = [];
  if (pts.length){ lvl.push([0, curveAt(pts, a)]); for (const [t, v] of pts) if (t > a + 1e-3 && t < b - 1e-3) lvl.push([t - a, v]); lvl.push([b - a, curveAt(pts, b)]); }
  return {k: 's' + g.si, ...(lvl.every(p => Math.abs(p[1] - 1) < 0.006) ? {} : {lvl: lvl.map(([t, v]) => [r3(t), +v.toFixed(3)])})};
}
const voiceExport = () => voiceOn() && (exFmt === 'video' || exFmt === 'audio');
// Mittlere Wirkung des Pegelverlaufs auf einen Abschnitt in dB (für „Lautstärke vereinheitlichen“)
function voiceLvlDb(s){
  const p = s.voice && s.voice.lvl; if (!p || p.length < 2) return 0;
  let sum = 0; for (let i = 1; i < p.length; i++) sum += (p[i][0] - p[i - 1][0]) * 10 * Math.log10(Math.max(1e-3, p[i][1] * p[i - 1][1]));
  const d = p[p.length - 1][0] - p[0][0]; return d > 0 ? sum / d : 20 * Math.log10(Math.max(1e-3, p[0][1]));
}
// Vorschau: Der Ton des Hauptvideos läuft durch denselben Rechenkern (AudioWorklet); den Pegelverlauf stellt die Lautstärke
// des Videos nach (applySegFx). Kann der Browser das nicht, bleibt die Vorschau unbearbeitet – der Export bereitet trotzdem auf.
let voiceMod = null, voiceFail = false, voiceBusy = false;
function voiceWorkletSrc(){
  return voiceDspLib.toString() + `
const VoiceDsp = voiceDspLib().VoiceDsp;
class HcVoice extends AudioWorkletProcessor {
  constructor(){
    super(); this.dsp = new VoiceDsp(sampleRate, 2, null); const H = this.dsp.H;
    this.pend = [new Float64Array(H), new Float64Array(H)]; this.tmp = [new Float64Array(H), new Float64Array(H)]; this.part = 0;
    this.q = [new Float32Array(8192), new Float32Array(8192)]; this.r = 0; this.w = 0; this.go = false;
    this.port.onmessage = e => { if (e.data === 'reset'){ this.dsp.reset(); this.part = 0; } };
  }
  process(inputs, outputs){
    const inp = inputs[0], out = outputs[0], n = out[0].length, d = this.dsp, H = d.H, M = 8191;
    if (!inp || !inp.length){ for (const c of out) c.fill(0); return true; }
    const a = inp[0], b = inp[1] || inp[0];
    for (let i = 0; i < n; i++){
      this.pend[0][this.part] = a[i]; this.pend[1][this.part] = b[i];
      if (++this.part === H){ this.part = 0; d.hop(this.pend, 0, this.tmp, 0, d.hops * H + H >= d.N);
        for (let k = 0; k < H; k++){ this.q[0][this.w & M] = d.shape(this.tmp[0][k], 0); this.q[1][this.w & M] = d.shape(this.tmp[1][k], 0); this.w++; } }
    }
    if (!this.go && this.w - this.r >= n) this.go = true;
    for (let i = 0; i < n; i++){ const ok = this.go && this.r < this.w; for (let c = 0; c < out.length; c++) out[c][i] = ok ? this.q[c > 0 ? 1 : 0][this.r & M] : 0; if (ok) this.r++; }
    return true;
  }
}
registerProcessor('hc-voice', HcVoice);`;
}
// Hängt das Hauptvideo an die Aufbereitung oder löst es davon – je nach Schalter. Läuft bei jedem Bild mit und tut meist nichts.
function voiceWire(){
  const want = !!P && voiceOn() && !voiceFail;
  if (want === !!V._von) return;
  try {
    if (!want){ V._s.disconnect(); V._vn.disconnect(); V._s.connect(V._g); V._von = false; return; }
    if (!V._g) setVol(V, V.volume, true);   // Verstärker-Kette des Videos anlegen
    if (!V._g || !V._s || !actx.audioWorklet) throw new Error('kein AudioWorklet');
    if (!V._vn){
      if (voiceBusy) return; voiceBusy = true;
      voiceMod ||= actx.audioWorklet.addModule(URL.createObjectURL(new Blob([voiceWorkletSrc()], {type: 'text/javascript'})));
      voiceMod.then(() => { V._vn = new AudioWorkletNode(actx, 'hc-voice', {numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2]}); voiceBusy = false; },
        e => { voiceBusy = false; voiceFail = true; console.warn('Stimme aufbereiten: Vorschau ohne Aufbereitung', e); });
      return;
    }
    V._s.disconnect(); V._s.connect(V._vn); V._vn.connect(V._g); V._von = true; V._vn.port.postMessage('reset');
  } catch(e){ voiceFail = true; console.warn('Stimme aufbereiten: Vorschau ohne Aufbereitung', e); try { if (V._s && V._g){ V._s.disconnect(); V._s.connect(V._g); } } catch(_){} V._von = false; }
}
V.addEventListener('seeked', () => { if (V._von && V._vn) V._vn.port.postMessage('reset'); });
// ── Übergänge (E3): weiche Blende und versetzter Bildwechsel (J- und L-Schnitt) ──
// Je Schnitt der Hauptspur ein Element in P.items: {id, type: 'join', at | ins, pa | pins, kind: 'fade' | 'early' | 'late', d}.
//   at:  Quellzeit, an der der Abschnitt nach dem Schnitt beginnt – ins: der Einschub, der nach dem Schnitt beginnt
//   pa:  Quellzeit, an der der Abschnitt vor dem Schnitt endet – pins: der Einschub, der vor dem Schnitt endet
//   Der Übergang bleibt an seinem Schnitt, solange eine der beiden Seiten noch passt (z. B. wenn ein Wort mehr gestrichen wird).
//   fade: Blende über d Sekunden · early: das Bild wechselt d Sekunden vor dem Ton (L-Schnitt) · late: d Sekunden danach (J-Schnitt)
// Der Ton wechselt immer am Schnitt. Das Bild des Übergangs kommt aus dem Material unmittelbar vor bzw. nach dem Schnitt
// (auch aus Herausgeschnittenem) und liegt als Ebene direkt über der Hauptspur – in der Vorschau wie im Export (plan.trans).
// Jeder Übergang ist genau eine Ebene auf einer Seite des Schnitts: „davor“ zeigt den nächsten Clip über dem Ende des vorigen
// (die Blende ist am Schnitt fertig), „dahinter“ den vorigen Clip über dem Anfang des nächsten. An der Schnittseite ist die Ebene
// deckend und läuft dort ein Stück bildgleich mit der Hauptspur weiter (lead/tail) – so bleibt der Export auch dann sauber, wenn
// ein Programm Ebene und Hauptspur um ein Bild versetzt zusammenführt (Android).
const JOIN_KINDS = [['', 'Hart'], ['fade', 'Blende'], ['early', 'Bild früher'], ['late', 'Bild später']];
const JOIN_D = {fade: [0.2, 0.4, 0.8], early: [0.3, 0.6, 1], late: [0.3, 0.6, 1]}, JOIN_DEF = {fade: 0.4, early: 0.6, late: 0.6}, JOIN_MIN = 0.08, JOIN_PAD = 0.1;
// aufgelöst: [{x, k, over, at, d, a0, a1, lead, tail, g, from}] – Ebene über [at, at + d) mit Deckkraft a0 → a1, Material von g ab from;
// over: der Abschnitt, über dem sie liegt · lead/tail: bildgleicher Vor- bzw. Nachlauf in Sekunden (nur für den Export)
let joinParts = [], joinMap = new Map();   // joinMap: Nummer des Abschnitts nach dem Schnitt → Übergang, der dort gilt
const joinItems = () => P.items.filter(x => x.type === 'join');
// Ein echter Schnitt? Zwei Abschnitte derselben Aufnahme, die nahtlos aneinanderschließen, sind keiner.
const isCutAt = k => { const A = timeline[k - 1], B = timeline[k]; return !!(A && B) && !(A.kind === 'main' && B.kind === 'main' && A.si === B.si && Math.abs(B.in - A.out) < 0.02); };
// Wo sitzt der Übergang? [Nummer des Abschnitts nach dem Schnitt, Güte] – Güte 0: der Abschnitt danach beginnt genau dort ·
// 1: sein Anfang ist inzwischen gestrichen, der Schnitt liegt am nächsten behaltenen Abschnitt · 2: nur der Abschnitt davor passt noch.
// [−1] heißt: Den Schnitt gibt es nicht mehr.
function joinSeat(x){
  const cut = k => k > 0 && isCutAt(k);
  let k = -1;
  if (x.ins) k = timeline.findIndex(g => g.kind === 'insert' && g.item.id === x.ins);
  else if (x.at != null) k = timeline.findIndex(g => g.kind === 'main' && Math.abs(g.in - x.at) < 0.03);
  if (cut(k)) return [k, 0];
  if (!x.ins && x.at != null){ const a = snapSrc(x.at); k = timeline.findIndex(g => g.kind === 'main' && Math.abs(g.in - a) < 0.03); if (cut(k)) return [k, 1]; }
  if (x.pins) k = timeline.findIndex(g => g.kind === 'insert' && g.item.id === x.pins) + 1;
  else if (x.pa != null) k = timeline.findIndex(g => g.kind === 'main' && Math.abs(g.out - x.pa) < 0.03) + 1;
  else k = -1;
  return k > 0 && k < timeline.length && cut(k) ? [k, 2] : [-1];
}
const joinIndex = x => joinSeat(x)[0];
const joinAt = k => joinMap.get(k) || null;
// Wie viel Bildmaterial es hinter dem Ende bzw. vor dem Anfang eines Abschnitts gibt (Sekunden in Ausgabezeit, höchstens d)
function handleAfter(g, d){
  if (g.kind === 'insert'){ const c = g.item.clip; return isImg(c) ? d : Math.min(d, Math.max(0, (c.duration || 0) - g.out)); }
  const s = P.sources[g.si]; return hasVid(s) ? Math.min(d, Math.max(0, (s.off + s.duration - g.out) / (g.speed || 1))) : 0;
}
function handleBefore(g, d){
  if (g.kind === 'insert'){ const c = g.item.clip; return isImg(c) ? d : Math.min(d, Math.max(0, g.in)); }
  const s = P.sources[g.si]; return hasVid(s) ? Math.min(d, Math.max(0, (g.in - s.off) / (g.speed || 1))) : 0;
}
function joinResolve(x, k){
  const A = timeline[k - 1], B = timeline[k], T = B.o, sb = B.speed || 1, la = segDur(A) / 2, lb = segDur(B) / 2, d = Math.max(JOIN_MIN, +x.d || 0);
  const nb = Math.min(handleBefore(B, d), la), na = Math.min(handleAfter(A, d), lb);   // so viel Bild gibt es vor B und hinter A
  const pre = (a0, a1) => ({x, k, over: k - 1, at: T - nb, d: nb, a0, a1, lead: 0, tail: Math.min(JOIN_PAD, lb), g: B, from: B.in - nb * sb});
  const post = (a0, a1) => ({x, k, over: k, at: T, d: na, a0, a1, lead: Math.min(JOIN_PAD, la), tail: 0, g: A, from: A.out});
  if (x.kind === 'early') return nb >= JOIN_MIN ? [pre(1, 1)] : [];
  if (x.kind === 'late') return na >= JOIN_MIN ? [post(1, 1)] : [];
  if (x.kind !== 'fade') return [];
  // Blende: am liebsten vor dem Schnitt (der nächste Clip steht ganz im Bild, wenn sein Ton beginnt); dahinter, wenn dort mehr Material liegt
  if (nb >= JOIN_MIN && (nb >= d - 1e-6 || nb >= na)) return [pre(0, 1)];
  return na >= JOIN_MIN ? [post(1, 0)] : [];
}
function computeJoins(){
  joinParts = []; joinMap = new Map();
  const best = new Map();   // je Schnitt gilt ein Übergang: der am genauesten passende, bei Gleichstand der zuletzt gesetzte
  for (const x of P.items){ if (x.type !== 'join') continue; const [k, q] = joinSeat(x); if (k > 0 && (!best.has(k) || q <= best.get(k)[1])) best.set(k, [x, q]); }
  for (const [k, [x]] of best){ joinMap.set(k, x); joinParts.push(...joinResolve(x, k)); }
  joinParts.sort((a, b) => a.at - b.at);
}
// Für den Export: Ebenen direkt über der Hauptspur, je mit einem Abschnitt im Aufbau der Hauptspur (gleiche Lage, Zoom, Farben)
function joinPlan(){
  if (exFmt !== 'video') return null;
  const list = joinParts.map(p => { const sp = p.g.speed || 1, seg = planSeg(p.g, p.from - p.lead * sp, p.from + (p.d + p.tail) * sp, false);
    seg.hasAudio = false; seg.vol = 0; if (seg.image){ seg.out = r3(seg.out - seg.in); seg.in = 0; }
    return {at: r3(p.at), d: r3(p.d), a0: p.a0, a1: p.a1, lead: r3(p.lead), tail: r3(p.tail), over: p.over, seg}; }).filter(t => t.d >= 0.04);
  return list.length ? list : null;
}
// ── Vorschau: eine Ebene über dem Hauptbild zeigt das Material des anderen Clips ──
const TO = $('#transOv'), TV = $('#tv'), TI = $('#ti');
function joinCss(g, t){   // Lage, Zoom und Farben, wie sie das Hauptbild für Abschnitt g zur Quellzeit t hätte
  if (g.kind !== 'main') return {transform: '', filter: ''};
  const z = zoomAt(t), f = frameFx(mainFxAt(g, t)), tx = f.tx || 0, ty = f.ty || 0, sc = f.sc || 1, parts = [];
  if (tx || ty) parts.push(`translate(${(tx * 100).toFixed(3)}%, ${(ty * 100).toFixed(3)}%)`);
  if (Math.abs(sc - 1) > 1e-3) parts.push(`scale(${sc.toFixed(4)})`);
  if (z.s > 1.001) parts.push(`translate(${(-(z.cx - 0.5) * (z.s - 1) * 100).toFixed(3)}%, ${(-(z.cy - 0.5) * (z.s - 1) * 100).toFixed(3)}%) scale(${z.s.toFixed(4)})`);
  return {transform: parts.join(' '), filter: cssFilter(g.fx)};
}
const joinUrl = g => g.kind === 'main' ? srcPlayUrl(P.sources[g.si]) : MEDIA(g.uri);
function updateJoin(o){
  if (!joinParts.length && TO.classList.contains('hidden') && !TV.dataset.src) return;
  const act = joinParts.find(p => o >= p.at && o < p.at + p.d), soon = !act && playing ? joinParts.find(p => p.at > o && p.at - o < PRELOAD_S) : null, p = act || soon;
  if (!p){ if (!TO.classList.contains('hidden')) TO.classList.add('hidden'); if (!TV.paused) TV.pause(); if (TV.dataset.src && !playing) releaseMedia(TV); return; }
  const g = p.g, img = g.kind === 'insert' && isImg(g.item.clip), url = joinUrl(g), sp = g.speed || 1;
  const t = p.from + clamp(o - p.at, 0, p.d) * sp, local = g.kind === 'main' ? t - P.sources[g.si].off : t;   // Zeit im Material
  if (img){ if (TI.dataset.src !== url){ TI.src = url; TI.dataset.src = url; } }
  else if (TV.dataset.src !== url){ TV.src = url; TV.dataset.src = url; try { TV.currentTime = Math.max(0, local); } catch(_){} }
  TI.classList.toggle('hidden', !img); TV.classList.toggle('hidden', img);
  if (!act){ if (!TO.classList.contains('hidden')) TO.classList.add('hidden'); if (!img && !TV.paused) TV.pause(); if (!img && !TV.seeking && Math.abs(TV.currentTime - local) > 0.05) try { TV.currentTime = Math.max(0, local); } catch(_){} return; }
  const css = joinCss(g, t), el = img ? TI : TV;
  if (el.style.transform !== css.transform) el.style.transform = css.transform; if (el.style.filter !== css.filter) el.style.filter = css.filter;
  TO.style.opacity = (p.a0 + (p.a1 - p.a0) * clamp((o - p.at) / p.d, 0, 1)).toFixed(3);
  if (TO.classList.contains('hidden')) TO.classList.remove('hidden');
  if (img) return;
  if (Math.abs(sp - 1) < 1e-3) syncMedia(TV, local);
  else { if (Math.abs(TV.playbackRate - sp) > 0.01) TV.playbackRate = clamp(sp, 0.25, 4); if (!TV.seeking && Math.abs(TV.currentTime - local) > (playing ? 0.4 : 0.05)) try { TV.currentTime = local; } catch(_){} }
  if (playing && TV.paused) TV.play().catch(() => {}); if (!playing && !TV.paused) TV.pause();
}
// ── Bedienung: Blatt „Übergang“ am Schnitt, Marken in der Zeitleiste ──
const cutList = () => timeline.map((g, k) => k).filter(k => k > 0 && isCutAt(k));
function cutNear(o){ let best = -1, bd = Infinity; for (const k of cutList()){ const d = Math.abs(timeline[k].o - o); if (d < bd){ bd = d; best = k; } } return best; }
function joinSet(k, kind, d){   // Übergang am Schnitt vor Abschnitt k setzen, ändern oder entfernen (kind leer)
  const A = timeline[k - 1], B = timeline[k], old = joinItems().filter(x => joinIndex(x) === k);
  commit(() => {
    if (old.length) P.items = P.items.filter(x => !old.includes(x));
    if (kind) P.items.push({id: newId(), type: 'join', ...(B.kind === 'insert' ? {ins: B.item.id} : {at: r3(B.in)}), ...(A.kind === 'insert' ? {pins: A.item.id} : {pa: r3(A.out)}), kind, d: +d || JOIN_DEF[kind]});
  }, true);
}
function joinNote(k){
  const x = joinAt(k); if (!x) return 'Bild und Ton wechseln im selben Augenblick.';
  const ps = joinParts.filter(p => p.x === x), got = ps.reduce((s, p) => s + p.d, 0), sec = v => v.toFixed(1).replace('.', ',') + ' s';
  const side = ps.length && x.kind === 'fade' ? (ps[0].over < k ? ' Die Blende ist am Schnitt fertig.' : ' Die Blende beginnt am Schnitt.') : '';
  const what = x.kind === 'fade' ? `Das Bild blendet in ${sec(x.d)} weich über.${side}` : x.kind === 'early' ? `Das Bild wechselt ${sec(x.d)} vor dem Ton: Der nächste Clip ist schon zu sehen, der vorige noch zu Ende zu hören (L-Schnitt).`
    : `Das Bild wechselt ${sec(x.d)} nach dem Ton: Der nächste Clip ist schon zu hören, der vorige noch zu sehen (J-Schnitt).`;
  const fit = !ps.length ? ' An diesem Schnitt fehlt dafür das Bildmaterial vor oder hinter dem Clip – es bleibt beim harten Schnitt.' : got < x.d - 0.02 ? ` Das Material reicht hier für ${sec(got)}.` : '';
  return what + fit + ' Der Ton wechselt am Schnitt. Das Bild dazu kommt aus dem Material unmittelbar vor oder hinter dem Schnitt, auch aus Herausgeschnittenem.';
}
let joinK = -1;
const joinSheetOpen = () => !$('#sheet').classList.contains('hidden') && !!$('#jnSheet');
function openJoin(k){
  if (k == null || k < 0) k = cutNear(outPos);
  if (k < 0) return toast('In der Hauptspur gibt es noch keinen Schnitt');
  joinK = k; sheetItem = null; pausePlay(); seekOut(Math.min(timeline[k].o, Math.max(0, total - 0.01)), false); if (window.revealHead && tlOn()) revealHead(outPos);
  const body = $('#sheetBody'); body.innerHTML = '<div id="jnSheet"></div>'; body.onclick = null; paintJoinSheet(); openSheet(true);
}
function paintJoinSheet(){
  const box = $('#jnSheet'); if (!box || !P) return;
  if (!(joinK > 0 && joinK < timeline.length && isCutAt(joinK))){ joinK = cutNear(outPos); if (joinK < 0) return closeSheet(); }
  const k = joinK, x = joinAt(k), kind = x ? x.kind : '', cuts = cutList(), n = cuts.indexOf(k), name = g => g.kind === 'insert' ? 'Einschub' : P.sources.length > 1 ? `Video ${g.si + 1}` : 'Clip';
  box.innerHTML = `<h3>Übergang</h3>
    <p class="muted small">Schnitt ${n + 1} von ${cuts.length} bei ${fmtS(timeline[k].o)} · ${esc(name(timeline[k - 1]))} → ${esc(name(timeline[k]))}</p>
    <div class="field"><span>Art</span><div class="seg-ctl" id="jnKind">${JOIN_KINDS.map(([v, l]) => `<button type="button" data-v="${v}"${v === kind ? ' class="on"' : ''}>${l}</button>`).join('')}</div></div>
    <div class="field${kind ? '' : ' hidden'}"><span>Dauer</span><div class="seg-ctl" id="jnDur">${(JOIN_D[kind] || []).map(v => `<button type="button" data-d="${v}"${x && Math.abs(x.d - v) < 1e-3 ? ' class="on"' : ''}>${String(v).replace('.', ',')} s</button>`).join('')}</div></div>
    <p class="muted small" id="jnNote">${esc(joinNote(k))}</p>
    <div class="row wrap" style="margin-top:12px"><button class="btn" data-a="prev"${n > 0 ? '' : ' disabled'}>‹ Schnitt davor</button><button class="btn" data-a="next"${n < cuts.length - 1 ? '' : ' disabled'}>Schnitt danach ›</button>
      <button class="btn" data-a="play">▶ Ansehen</button><button class="btn primary" data-a="ok" style="margin-left:auto">Fertig</button></div>`;
  if (window.iconize) iconize(box);
  box.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.v != null && b.closest('#jnKind')){ joinSet(k, b.dataset.v, x && x.kind === b.dataset.v ? x.d : 0); return paintJoinSheet(); }
    if (b.dataset.d){ joinSet(k, kind, +b.dataset.d); return paintJoinSheet(); }
    const a = b.dataset.a, cs = cutList(), i = cs.indexOf(joinK);
    if (a === 'ok') return closeSheet();
    if (a === 'prev' && i > 0) return openJoin(cs[i - 1]);
    if (a === 'next' && i >= 0 && i < cs.length - 1) return openJoin(cs[i + 1]);
    if (a === 'play'){ const T = timeline[joinK].o; seekOut(Math.max(0, T - 2), false); startPlay(); stopAt = Math.min(total, T + 2); }
  };
}

// ───────── Clips in Serie (2.33): Vormerken und Clip-Reihe (F2), Zusammenschnitt (F3), Vorschläge (F1), Hook-Varianten (F4), „Teil 1/3“ (F5), Suche über alle Projekte (C9) ─────────
// P.clipList = [{id, at, end}] – vorgemerkte Abschnitte in Quellzeit: vom Anfang des ersten bis zum Ende des letzten Worts (wie bei den
// Quellen). Sie folgen dem Schnitt: Was nicht mehr zum Video zählt, zählt auch im Abschnitt nicht mit.
// P.clipSeries = [{id, name, fmt, made, clips: [{id, d, q}]}] – angelegte Clip-Reihen; sie stehen im Projekt, aus dem sie stammen.
// Im Clip: P.part = {series, k, n, on, ids} – Teil k von n. P.partStyle = {pos, size, dur, word} – Aussehen der Kennzeichnung (Teil des Hausstils).
const waitMs = ms => new Promise(r => setTimeout(r, ms));
const clipListAll = () => (P && P.clipList) || [];
const seriesAll = () => (P && P.clipSeries) || [];
const isSaid = i => tokens[i].type !== 'pause' || !!(P.edits && P.edits[i]);
function secSpan(x){   // Abschnitt als Positionen in der Reihenfolge des Textes: [von, bis]
  if (!tokens.length) return null; if (order.length !== tokens.length) computeOrder();
  const a = tokAtSrc(x.at + 0.002), b = tokAtSrc(x.end - 0.002); if (a < 0 || b < 0) return null;
  return [Math.min(pos[a], pos[b]), Math.max(pos[a], pos[b])];
}
const secIds = x => { const r = secSpan(x); return r ? order.slice(r[0], r[1] + 1) : []; };
const secOut = x => { const r = outRangeOf(secIds(x)); return r && r[1] - r[0] > 0.3 ? r : null; };   // Bereich im geschnittenen Video
function secQuote(x, n = 9){ const w = secIds(x).filter(i => isSaid(i) && !isCut(i) && tokText(tokens[i])).map(i => tokText(tokens[i])); return w.length > n ? w.slice(0, n).join(' ') + ' …' : w.join(' '); }
let clipTokMemo = null;
function clipToks(){ if (clipTokMemo) return clipTokMemo; const s = new Set(); for (const x of clipListAll()) for (const i of secIds(x)) s.add(i); return clipTokMemo = s; }
function paintClipToks(){
  clipTokMemo = null; const nw = clipToks(); if (!spans.length) return;
  for (const sp of $$('#transcript .tk.cl')) if (!nw.has(+sp.dataset.i)) sp.classList.remove('cl');
  for (const i of nw) if (spans[i]) spans[i].classList.add('cl');
}
function paintClipsBtn(){ const n = clipListAll().length, b = $('#clipsBtn'); b.textContent = 'Clips' + (n ? ` (${n})` : ''); b.classList.toggle('on', n > 0); }
function clipListChanged(){ paintClipToks(); paintClipsBtn(); if (clipsSheetOpen()) renderClipsSheet(); if (spans.length && selA != null) showSel(); }
// Das offene Blatt folgt dem Schnitt: Längen der Abschnitte und die Vorschläge kurz nach einer Änderung auffrischen (nicht, während im Feld der Schlagwörter getippt wird)
let clipsLateT = 0;
function clipsLater(){ clearTimeout(clipsLateT); clipsLateT = setTimeout(() => { if (P && clipsSheetOpen() && clipsView !== 'series' && document.activeElement !== $('#clWords')) renderClipsSheet(); }, 250); }
function clipListSort(){ const k = x => (secSpan(x) || [1e9])[0]; P.clipList.sort((p, q) => k(p) - k(q)); }
// Anker eines Abschnitts aus markierten Wörtern (in der Reihenfolge des Textes) – null, wenn nichts Gesprochenes dabei ist
function secOf(ids){ const said = ids.filter(isSaid); return said.length ? {at: r3(wS(tokens[said[0]])), end: r3(wE(tokens[said[said.length - 1]]))} : null; }
const secSame = (p, q) => Math.abs(p.at - q.at) < 0.01 && Math.abs(p.end - q.end) < 0.01;
function clipListAdd(ids, quiet){   // → true, wenn der Abschnitt jetzt vorgemerkt ist
  const s = secOf(ids); if (!s){ if (!quiet) toast('Erst Wörter markieren'); return false; }
  if (clipListAll().some(q => secSame(q, s))) return true;
  if (!outRangeOf(ids.filter(isSaid))){ if (!quiet) toast('Nur weggeschnittene Wörter markiert'); return false; }
  commit(() => { (P.clipList ||= []).push({id: newId(), ...s}); clipListSort(); }, false);
  clipListChanged(); return true;
}
function clipListDrop(x){ commit(() => { P.clipList = P.clipList.filter(q => q !== x); }, false); clipListChanged(); }
// „Vormerken“: der markierte Abschnitt, ohne Markierung der Satz an der Abspiellinie. Noch einmal auf demselben Abschnitt nimmt ihn wieder heraus.
function clipListToggle(){
  if (!P || !tokens.length || !spans.length) return;
  let ids = selIds();
  if (!ids.length){ const k = tokAtOut(outPos); if (k == null || pos[k] == null) return toast('Erst einen Abschnitt im Text markieren'); const r = sentBounds(pos[k], pos[k]); ids = order.slice(r[0], r[1] + 1); }
  const s = secOf(ids); if (!s) return toast('Erst Wörter markieren');
  const dup = clipListAll().find(q => secSame(q, s));
  if (dup){ clipListDrop(dup); return toast('Vormerkung entfernt'); }
  if (clipListAdd(ids)) clipListNoted();
}
function clipListNoted(){ clearSel(); const n = clipListAll().length; toast(n === 1 ? 'Vorgemerkt – weitere Abschnitte markieren, dann „Clips“ öffnen' : `${n} Abschnitte vorgemerkt – „Clips“ macht daraus eine Reihe oder einen Zusammenschnitt`); }
$('#selList').onclick = clipListToggle;
function secShow(x){   // Abschnitt im Text markieren und zeigen
  const r = secSpan(x); if (!r || !spans.length) return;
  if (tab !== 'text') setTab('text');
  selA = order[r[0]]; selB = order[r[1]]; showSel();
  if (spans[selA]) spans[selA].scrollIntoView({block: 'center', behavior: 'smooth'});
  const o = secOut(x); if (o){ if (playing) pausePlay(); seekOut(Math.min(o[0] + 0.08, Math.max(0, total - 0.01)), false); tlReveal(); }
}
function rangePlay(r){   // Bereich des geschnittenen Videos anhören; noch einmal hält an
  audStop(); if (playing && stopAt != null && Math.abs(stopAt - r[1]) < 0.01 && outPos >= r[0] - 0.05) return pausePlay();
  if (playing) pausePlay(); seekOut(r[0], false); startPlay(); stopAt = r[1]; tlReveal();
}
// ── Blatt „Clips aus diesem Video“: Vorgemerkt · Vorschläge · Reihen ──
let clipsView = 'list';
const CL_FMTS = [['9:16', '9:16'], ['4:5', '4:5'], ['1:1', '1:1'], ['16:9', '16:9'], ['', 'Original']];
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch(_){ return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch(_){} };
const clipFmtGet = () => { const v = lsGet('hc-clipfmt', '9:16'); return v === '' || FORMATS[v] ? v : '9:16'; };
const clipsSheetOpen = () => !$('#sheet').classList.contains('hidden') && !!$('#clSheet');
function projMap(){ const m = new Map(); for (const p of J(TS.listProjects() || '[]') || []) m.set(p.id, p); return m; }
function clRow(q){
  const {x, r} = q;
  return `<div class="cl-row${r ? '' : ' cut'}" data-id="${x.id}"><button type="button" class="mini" data-a="play" title="Anhören"${r ? '' : ' disabled'}>▶</button>
    <button type="button" class="mk-go" title="Im Text zeigen"><span class="mono">${r ? fmtT(r[0]) : '–'}</span><span class="mk-t"><b dir="auto">${esc(secQuote(x) || 'ohne Worte')}</b><i>${r ? fmtD(r[1] - r[0]) + ' s' : 'weggeschnitten – zählt nicht mit'}</i></span></button>
    <button type="button" class="mini" data-a="drop" title="Vormerkung entfernen">×</button></div>`;
}
function clipsListHtml(){
  const list = clipListAll().map(x => ({x, r: secOut(x)})), ok = list.filter(q => q.r), tot = ok.reduce((s, q) => s + q.r[1] - q.r[0], 0), fmt = clipFmtGet();
  if (!list.length) return `<p class="muted small">Noch nichts vorgemerkt. ${getComputedStyle($('#selList')).display === 'none' ? 'Im Text einen Abschnitt markieren, „Clip“ wählen und dort „Vormerken“.' : 'Im Text einen Abschnitt markieren und „Vormerken“ wählen (Taste V); ohne Markierung merkt V den Satz an der Abspiellinie vor.'} Aus mehreren Abschnitten wird eine Clip-Reihe (je Abschnitt ein Clip) oder ein Zusammenschnitt (alle in einem Clip). Unter „Vorschläge“ stehen Abschnitte, die sich als Clip eignen könnten.</p>`;
  return `<p class="muted small">${!ok.length ? 'Die vorgemerkten Abschnitte sind inzwischen weggeschnitten.' : (ok.length === 1 ? 'Ein Abschnitt' : ok.length + ' Abschnitte') + ', zusammen ' + fmtT(tot) + '.'} Antippen zeigt den Abschnitt im Text.</p>
    <div class="cl-list">${list.map(clRow).join('')}</div>
    ${ok.length ? `<div class="field"><span>Format der Clips</span><div class="seg-ctl" id="clFmt">${CL_FMTS.map(([v, l]) => `<button type="button" data-fmt="${v}"${v === fmt ? ' class="on"' : ''}>${l}</button>`).join('')}</div></div>` : ''}
    ${ok.length > 1 ? `<label class="row"><input type="checkbox" id="clPart"${lsGet('hc-clippart', '1') !== '0' ? ' checked' : ''}> „Teil 1/${ok.length}“ in jedem Clip der Reihe einblenden</label>` : ''}
    <div class="row wrap">${ok.length > 1 ? `<button type="button" class="btn primary" data-a="series" title="Jeder Abschnitt wird ein eigener Clip">Clip-Reihe anlegen (${ok.length} Clips)</button><button type="button" class="btn" data-a="best" title="Alle vorgemerkten Abschnitte in einem Clip, in der Reihenfolge des Videos">Zusammenschnitt (${fmtT(tot)})</button>` : ok.length ? '<button type="button" class="btn primary" data-a="one">Als Clip öffnen</button>' : ''}
      <button type="button" class="btn small ghost" data-a="clear">Liste leeren</button></div>`;
}
function clipsSeriesHtml(){
  const ser = seriesAll();
  if (!ser.length) return '<p class="muted small">Noch keine Clip-Reihe. Abschnitte vormerken und „Clip-Reihe anlegen“ wählen: Jeder Abschnitt wird ein eigener Clip, auf Wunsch mit „Teil 1/3“ im Bild. Die Reihe lässt sich hier gemeinsam exportieren.</p>';
  const pm = projMap();
  return ser.map(s => { const have = s.clips.filter(c => pm.has(c.id));
    return `<div class="cl-ser" data-s="${s.id}"><div class="cl-ser-h"><span class="cl-ser-n"><b dir="auto">${esc(s.name)}</b><span class="muted small">${have.length === 1 ? '1 Clip' : have.length + ' Clips'} · ${s.fmt || 'Originalformat'} · ${new Date(s.made).toLocaleDateString('de-DE')}</span></span><button type="button" class="mini" data-a="smenu" title="Umbenennen, neu nummerieren, auflösen, löschen">⋯</button></div>
      ${have.map(c => `<div class="cl-row" data-c="${c.id}"><button type="button" class="mk-go" data-a="copen" title="Clip öffnen"><span class="mono">${s.clips.indexOf(c) + 1}/${s.clips.length}</span><span class="mk-t"><b dir="auto">${esc(pm.get(c.id).name)}</b><i>${fmtT(c.d)}${c.q ? ' · ' + esc(c.q) : ''}</i></span></button></div>`).join('') || '<p class="muted small">Die Clips dieser Reihe gibt es nicht mehr.</p>'}
      ${have.length ? '<div class="row wrap"><button type="button" class="btn small primary" data-a="sexp" title="Alle Clips dieser Reihe nacheinander exportieren">Alle exportieren</button></div>' : ''}</div>`; }).join('');
}
function renderClipsSheet(){
  const box = $('#clSheet'); if (!box) return; const top = $('#sheet').scrollTop;
  const tabs = [['list', `Vorgemerkt (${clipListAll().length})`], ['sug', 'Vorschläge'], ['series', `Reihen (${seriesAll().length})`]];
  box.innerHTML = `<h3>Clips aus diesem Video</h3><div class="seg-ctl small ck-tabs">${tabs.map(([k, l]) => `<button type="button" data-view="${k}"${k === clipsView ? ' class="on"' : ''}>${l}</button>`).join('')}</div>
    ${clipsView === 'list' ? clipsListHtml() : clipsView === 'sug' ? clipsSugHtml() : clipsSeriesHtml()}
    <div class="row" style="margin-top:12px"><button type="button" class="btn" data-a="ok" style="margin-left:auto">Fertig</button></div>`;
  const w = $('#clWords'); if (w) w.value = clipWords.join(', ');
  $('#sheet').scrollTop = top;
}
function openClips(view){
  if (!P) return; sheetItem = null; if (view) clipsView = view;
  if (!tokens.length && clipsView !== 'series') clipsView = seriesAll().length ? 'series' : 'list';
  const body = $('#sheetBody'); body.innerHTML = '<div id="clSheet"></div>';
  body.onclick = clipsClick; body.onchange = clipsChange;
  sheetOnClose = () => { body.onchange = null; };
  renderClipsSheet(); openSheet(true);
}
$('#clipsBtn').onclick = () => openClips();
function clipsChange(e){
  if (e.target.id === 'clPart') lsSet('hc-clippart', e.target.checked ? '1' : '0');
  if (e.target.id === 'clWords'){ clipWordsSet(e.target.value); sugMemo = null; renderClipsSheet(); }
}
function clipsClick(e){
  const v = e.target.closest('[data-view]'); if (v){ clipsView = v.dataset.view; $('#sheet').scrollTop = 0; return renderClipsSheet(); }
  const f = e.target.closest('[data-fmt]'); if (f){ lsSet('hc-clipfmt', f.dataset.fmt); return renderClipsSheet(); }
  const a = e.target.closest('[data-a]'), act = a ? a.dataset.a : '', row = e.target.closest('.cl-row');
  if (act === 'ok') return closeSheet();
  const x = row && row.dataset.id ? clipListAll().find(q => q.id === row.dataset.id) : null;
  if (x){ if (act === 'play'){ const r = secOut(x); return r ? rangePlay(r) : null; } if (act === 'drop') return clipListDrop(x); if (e.target.closest('.mk-go')) return secShow(x); return; }
  const sg = row && row.dataset.k != null ? clipSuggest()[+row.dataset.k] : null;
  if (sg){ if (act === 'play') return rangePlay([sg.o1, sg.o2]); if (act === 'take'){ if (clipListAdd(sg.ids, true)) toast('Vorgemerkt'); return; } if (e.target.closest('.mk-go')) return secShow(secOf(sg.ids)); return; }
  if (act === 'takeall'){ let n = 0; for (const q of clipSuggest()) if (!clipListAll().some(p => secSame(p, secOf(q.ids))) && clipListAdd(q.ids, true)) n++; if (n){ clipsView = 'list'; renderClipsSheet(); } return toast(n ? `${n} ${n === 1 ? 'Vorschlag' : 'Vorschläge'} vorgemerkt` : 'Alle Vorschläge sind schon vorgemerkt'); }
  if (act === 'clear'){ if (!clipListAll().length) return; commit(() => { P.clipList = []; }, false); clipListChanged(); return toast('Liste geleert – „Rückgängig“ holt sie zurück'); }
  if (act === 'one'){ const q = clipListAll().map(secOut).find(Boolean); if (!q) return; closeSheet(); return clipDialog(q[0], q[1]); }
  if (act === 'series') return seriesCreate(clipFmtGet(), !$('#clPart') || $('#clPart').checked);
  if (act === 'best') return bestCreate(clipFmtGet());
  const sEl = e.target.closest('.cl-ser'), s = sEl && seriesAll().find(q => q.id === sEl.dataset.s);
  if (!s) return;
  if (act === 'copen'){ const id = row.dataset.c; closeSheet(); closeProject(); if (!P) openProject(id); return; }
  if (act === 'sexp') return exportProjects(s.clips.map(c => c.id), `„${s.name}“ exportieren`);
  if (act === 'smenu'){ const r = a.getBoundingClientRect(); return showMenu(Math.min(r.left, innerWidth - 260), r.bottom + 4, seriesMenu(s)); }
}
// ── Clip-Reihe: je vorgemerktem Abschnitt ein Clip-Projekt. Die Clips werden angelegt, ohne sie zu öffnen; Untertitel und
// Bildausschnitt entstehen beim ersten Öffnen (regen, frameNew). ──
function uniqueName(base, names){ let name = base, k = 2; while (names.has(name)) name = `${base} (${k++})`; names.add(name); return name; }
function seriesCreate(fmt, withPart){
  const secs = clipListAll().map(x => ({x, r: secOut(x)})).filter(q => q.r), n = secs.length; if (n < 2) return toast('Für eine Reihe braucht es mindestens zwei vorgemerkte Abschnitte');
  if (playing) pausePlay(); if (!saveNow()) return toast('Das Projekt ließ sich nicht speichern – die Reihe wurde nicht angelegt');
  const names = new Set([...projMap().values()].map(p => p.name)), nr = seriesAll().length + 1, sid = newId(), ids = secs.map(() => newId());
  const lead = nr > 1 || names.has(`${P.name} – Teil 1`) ? `Reihe ${nr}, ` : '', thumb = lsGet(THUMB_KEY(P.id), ''), clips = [];
  try {
    secs.forEach((q, k) => {
      const c = clipData([q.r], fmt, uniqueName(`${P.name} – ${lead}Teil ${k + 1}`, names));
      c.id = ids[k]; c.part = {series: sid, k: k + 1, n, on: !!withPart, ids}; if (c.format && !c.frame) c.frameNew = true;
      TS.saveProject(c.id, JSON.stringify(c)); if (thumb) lsSet(THUMB_KEY(c.id), thumb);
      clips.push({id: c.id, d: r3(q.r[1] - q.r[0]), q: secQuote(q.x, 7)});
    });
  } catch(e){ hcLog('Clip-Reihe anlegen: ' + ((e && e.message) || e)); if (!clips.length) return toast('Die Clips ließen sich nicht anlegen: ' + ((e && e.message) || e)); }
  (P.clipSeries ||= []).push({id: sid, name: `Reihe ${nr}`, fmt: fmt || '', made: Date.now(), clips}); saveNow();
  clipsView = 'series'; if (clipsSheetOpen()) renderClipsSheet(); else openClips('series');
  toast(clips.length < n ? `${clips.length} von ${n} Clips angelegt – der Speicher reichte für die übrigen nicht` : `${n} Clips angelegt – gemeinsam exportieren oder einzeln öffnen und anpassen`);
}
// ── Zusammenschnitt: alle vorgemerkten Abschnitte in einem Clip, in der Reihenfolge des Videos ──
function bestCreate(fmt){
  const rs = clipListAll().map(secOut).filter(Boolean); if (rs.length < 2) return toast('Für einen Zusammenschnitt braucht es mindestens zwei vorgemerkte Abschnitte');
  if (playing) pausePlay(); saveNow(); closeSheet();
  const name = uniqueName(`${P.name} – Best of`, new Set([...projMap().values()].map(p => p.name)));
  openClip(clipData(rs, fmt, name), 'Zusammenschnitt erstellt – hier Format, Ausschnitt, Untertitel und Hook einstellen');
}
// ── Reihe verwalten ──
function seriesSave(){ saveNow(); if (clipsSheetOpen()) renderClipsSheet(); }
function projEdit(id, fn){   // ein nicht geöffnetes Projekt ändern; → ob es geklappt hat
  let p = null; try { p = J(TS.loadProject(id)); } catch(_){}
  if (!p || typeof p !== 'object') return false;
  try { fn(p); p.updated = Date.now(); TS.saveProject(id, JSON.stringify(p)); return true; } catch(e){ hcLog('Projekt ändern: ' + ((e && e.message) || e)); return false; }
}
function seriesMenu(s){
  const pm = projMap(), have = s.clips.filter(c => pm.has(c.id));
  return [{icon: icon('✎'), label: 'Reihe umbenennen', fn: async () => { const name = await askName('Name der Reihe', s.name); if (!name) return; s.name = name.slice(0, 60); seriesSave(); }},
    ...(have.length > 1 && have.length < s.clips.length ? [{icon: icon('↻'), label: `Neu nummerieren (1 bis ${have.length})`, fn: () => {
      const ids = have.map(c => c.id), names = new Set([...pm.values()].map(p => p.name)); let n = 0;
      have.forEach((c, k) => { if (projEdit(c.id, p => { const old = p.part && p.part.k; p.part = {...(p.part || {on: true}), series: s.id, k: k + 1, n: have.length, ids};
        const nn = old && old !== k + 1 ? String(p.name || '').replace(new RegExp(`Teil ${old}$`), `Teil ${k + 1}`) : p.name; if (nn !== p.name && !names.has(nn)){ names.delete(p.name); names.add(nn); p.name = nn; } })) n++; });   // „… – Teil 3“ heißt danach „… – Teil 2“
      s.clips = have; seriesSave(); toast(`${n} Clips neu nummeriert`); }}] : []),
    {icon: icon('⛓'), label: 'Reihe auflösen (Clips bleiben)', fn: () => { if (!confirm(`Reihe „${s.name}“ auflösen?\n\nDie Clips bleiben als eigene Projekte erhalten.`)) return; P.clipSeries = P.clipSeries.filter(q => q !== s); seriesSave(); }},
    ...(have.length ? [{icon: icon('🗑'), label: 'Reihe mit ihren Clips löschen', cls: 'danger', fn: () => {
      if (!confirm(`Reihe „${s.name}“ mit ${have.length === 1 ? 'ihrem Clip' : 'ihren ' + have.length + ' Clips'} löschen?` + (TS.trash ? '\n\nDie Clips liegen danach noch 30 Tage im Papierkorb.' : '\n\nDeine Videos bleiben erhalten.'))) return;
      for (const c of have) try { TS.deleteProject(c.id); } catch(_){}
      P.clipSeries = P.clipSeries.filter(q => q !== s); seriesSave(); toast('Reihe gelöscht'); }}] : [])];
}
// ── Gemeinsam exportieren: Die Clips werden nacheinander geöffnet, ihre Exportpläne gebaut und in die Warteschlange gestellt.
// Ein Plan trägt alles, was der Export braucht – danach geht es im Ausgangsprojekt weiter, während die Warteschlange rechnet. ──
let exBatch = false;
function openProjectWait(id){ return new Promise(res => { Promise.resolve().then(() => openProject(id)).then(() => res(!!(P && P.id === id)), () => res(false)); }); }
async function exportProjects(ids, title){
  if (!P || exBatch) return;
  if (transJob) return toast('Die Transkription läuft noch – danach lässt sich die Reihe exportieren');
  const pm = projMap(); ids = ids.filter(id => pm.has(id)); if (!ids.length) return toast('Diese Clips gibt es nicht mehr');
  const P0 = P; if (!(await askOpenRefs())){ if (P === P0){ setTab('text'); openRefs(); } return; }
  if (P !== P0) return;
  const back = {id: P.id, tab, pos: outPos, undo, redo}; pausePlay(); closeSheet();
  if (!saveNow()) return toast('Das Projekt ließ sich nicht speichern – der Export wurde nicht gestartet');
  const m = hcModal(`<h3>${esc(title)}</h3><p id="bxMsg">Wird vorbereitet …</p><div class="progress"><i id="bxBar"></i></div><p class="muted small">Jeder Clip wird kurz geöffnet und in die Warteschlange gestellt. Danach geht es hier im Projekt weiter.</p><div class="row" style="margin-top:12px"><button class="btn" id="bxStop" style="margin-left:auto">Abbrechen</button></div>`);
  let stop = false, files = 0, done = 0; const bad = []; m.querySelector('#bxStop').onclick = () => { stop = true; m.querySelector('#bxMsg').textContent = 'Wird abgebrochen …'; };
  exBatch = true;
  try {
    for (let k = 0; k < ids.length && !stop; k++){
      const id = ids[k], nm = pm.get(id).name;
      if ($('#bxMsg')) $('#bxMsg').textContent = `Clip ${k + 1} von ${ids.length}: ${nm}`; if ($('#bxBar')) $('#bxBar').style.width = (k / ids.length * 100).toFixed(0) + '%';
      await waitMs(20);
      if (!P || P.id !== id){ if (P) closeProject(); if (P) break;   // Schließen abgelehnt: der letzte Stand ließ sich nicht speichern
        if (!(await openProjectWait(id))){ bad.push(nm); continue; } }
      if (!timeline.length || !(total > 0)){ bad.push(nm); continue; }
      try {
        if (window.slSyncAll) await slSyncAll();
        await lowerReady(); await decoReady(); await partReady();
        if (!P || P.id !== id){ bad.push(nm); continue; }
        saveNow();
        const base = cleanFile(P.name), plans = asVideo(() => videoPlans(base));
        for (const plan of plans){
          const info = planInfo(plan), t = plan === plans[0] ? exTextFile(plan, 'video') : {};
          if ($('#exLevel').checked){ try { await levelPlan(plan); } catch(e){ console.warn(e); } }
          exqAdd({name: plan.name, proj: id, info, plan, ...t}); files++;
        }
        done++;
      } catch(e){ hcLog('Reihe exportieren: ' + ((e && e.message) || e)); bad.push(nm); }
    }
  } finally {
    exBatch = false;
    if (!P || P.id !== back.id){ if (P) closeProject(); if (!P) await openProjectWait(back.id); }
    if (P && P.id === back.id){ undo = back.undo; redo = back.redo; if (tab !== back.tab) setTab(back.tab); seekOut(Math.min(back.pos, Math.max(0, total - 0.01)), false); }
    closeHcModal();
  }
  if (files) openQueue();
  toast(stop ? `Abgebrochen – ${files} ${files === 1 ? 'Export ist' : 'Exporte sind'} eingereiht` : bad.length ? `${done} von ${ids.length} Clips eingereiht – nicht geklappt: ${bad.join(', ')}` : `${files} ${files === 1 ? 'Export' : 'Exporte'} eingereiht – die Warteschlange rechnet sie nacheinander`);
}
const cleanFile = s => String(s || 'Video').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
function asVideo(fn){ const keep = exFmt; exFmt = 'video'; try { return fn(); } finally { exFmt = keep; } }

// ── Hook-Varianten (F4): Der Hook-Titel trägt bis zu zwei weitere Texte (alts: B und C). Für den Export wird der Text des Titels
// kurz getauscht – Lage, Größe und Dauer gelten für alle Varianten. ──
const hookItem = () => P ? P.items.find(x => x.type === 'title' && x.hook) || null : null;
function hookVars(){   // [{tag, text}] – leer, solange es nur den einen Hook gibt
  const h = hookItem(); if (!h || !String(h.text || '').trim()) return [];
  const out = [{tag: 'A', text: h.text.trim()}];
  (h.alts || []).slice(0, 2).forEach((t, k) => { t = String(t || '').trim(); if (t) out.push({tag: 'BC'[k], text: t}); });
  return out.length > 1 ? out : [];
}
function withHook(text, fn){ const h = hookItem(); if (!h) return fn(); const keep = h.text; h.text = text; try { return fn(); } finally { h.text = keep; } }
// Pläne für den Video-Export: einer je Hook-Variante, sonst genau einer. base: Dateiname ohne Zusatz (sonst der aus dem Export-Reiter).
function videoPlans(base){
  const vars = exFmt === 'video' ? hookVars() : [], mk = () => { const p = buildPlan(); if (base) p.name = base; return p; };
  if (!vars.length) return [mk()];
  return vars.map(v => withHook(v.text, () => { const p = mk(); p.name = `${p.name}_Hook-${v.tag}`; p.hook = v.tag; return p; }));
}

// ── „Teil 1/3“ (F5): Kennzeichnung der Clips einer Reihe, gezeichnet im Designprofil der Folien (wie die Bauchbinde). Dasselbe Bild
// steht in der Vorschau und liegt im Export als Bild über allen Clips (Spur 97). ──
const PART_DEF = {pos: 'ol', size: 1, dur: 0, word: 'Teil'};
const partStyle = () => ({...PART_DEF, ...((P && P.partStyle) || {})});
function partText(){ const p = P && P.part; if (!p || !(p.n > 1) || !(p.k >= 1)) return ''; const w = String(partStyle().word ?? '').replace(/\s+/g, ' ').trim().slice(0, 24); return `${w ? w + ' ' : ''}${p.k}/${p.n}`; }
const partOn = () => !!(P && P.part && P.part.on !== false && partText());
const partReady = () => partOn() ? lowerFonts() : Promise.resolve();
const partImgs = new Map();
function partImage(text, W, H){
  const pr = slProfile(), C = slColors(pr, pr.theme !== 'hell'), size = +partStyle().size || 1;
  const key = JSON.stringify(['teil', text, W, H, size, C.bg, C.fg, C.acc, pr.fonts, pr.bar !== false, lowerFontsOk.has(lowerFontKey())]);
  let im = partImgs.get(key); if (im) return im;
  if (partImgs.size > 30) partImgs.clear();
  const u = Math.min(W, H) * (H > W ? 1.25 : 1) * size, F = slFontFn(pr.fonts.head, 800), cv = document.createElement('canvas'), ctx = cv.getContext('2d');
  let fs = u * 0.034; ctx.font = F(fs); let tw = ctx.measureText(text).width;
  const fit = W * 0.6 / (tw + fs * 1.5); if (fit < 1){ fs *= Math.max(0.5, fit); ctx.font = F(fs); tw = ctx.measureText(text).width; }
  const bar = pr.bar !== false ? Math.round(fs * 0.22) : 0, padX = fs * 0.6, padY = fs * 0.38, w = Math.ceil(bar + 2 * padX + tw), h = Math.ceil(2 * padY + fs * 1.08);
  cv.width = w; cv.height = h;
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, w, h); if (bar){ ctx.fillStyle = C.acc; ctx.fillRect(0, 0, bar, h); }
  ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = C.fg; ctx.font = F(fs); ctx.fillText(text, bar + padX, padY + fs * 0.56);
  im = {key, cv, url: cv.toDataURL('image/png'), w, h}; partImgs.set(key, im); return im;
}
// Linke obere Ecke in Ausgabe-Pixeln: in der gewählten Ecke der freien Fläche, neben Textzeile und Quellenzeile; ein Wasserzeichen in derselben Ecke bleibt frei
function partRect(im, W, H){
  const p = partStyle().pos || 'ol', z = safeZone(), mn = Math.min(W, H), m = 0.04 * mn, gap = 0.014 * mn, top = p[0] === 'o';
  const mL = Math.max(m, z ? z.l * W : 0), mR = Math.max(m, z ? (top ? z.r : Math.max(z.r, z.cw)) * W : 0);
  const rT = linesReach(W, H, 'o'), rB = linesReach(W, H, 'u'), mT = Math.max(m, z ? z.t * H : 0, rT ? rT + gap : 0), mB = Math.max(m, z ? z.b * H : 0, rB ? rB + gap : 0);
  const x = p[1] === 'l' ? mL : p[1] === 'r' ? W - mR - im.w : (W - im.w) / 2; let y = top ? mT : H - mB - im.h;
  if (wmOn()){ const r = wmRect(W, H), wx = r.cx - r.w / 2, wy = r.cy - r.h / 2;
    if (x < wx + r.w + gap && x + im.w > wx - gap && y < wy + r.h + gap && y + im.h > wy - gap) y = top ? wy + r.h + gap : wy - gap - im.h; }
  return {x, y};
}
// Fläche der Kennzeichnung (für die Bauchbinde, die ihr ausweicht) – null, wenn keine im Bild steht
function partBox(W, H){ if (!partOn()) return null; const im = partImage(partText(), W, H), r = partRect(im, W, H); return {x: r.x, y: r.y, w: im.w, h: im.h}; }
function placePart(W, H, o){
  const box = $('#partOv'), d = +partStyle().dur || 0, on = partOn() && total > 0 && (!(d > 0) || o < d);
  if (!on){ if (box.firstChild) box.textContent = ''; return; }
  if (!lowerFontsOk.has(lowerFontKey())) lowerFonts();
  const [OW, OH] = outSize(), k = W / OW, im = partImage(partText(), OW, OH), r = partRect(im, OW, OH);
  let el = box.firstChild; if (!el){ el = document.createElement('img'); el.alt = ''; box.append(el); }
  const key = [im.key, W, r.x.toFixed(1), r.y.toFixed(1)].join('|'); if (el.dataset.k === key) return; el.dataset.k = key;
  if (el.dataset.src !== im.key){ el.src = im.url; el.dataset.src = im.key; }
  Object.assign(el.style, {left: (r.x * k).toFixed(1) + 'px', top: (r.y * k).toFixed(1) + 'px', width: (im.w * k).toFixed(1) + 'px', height: (im.h * k).toFixed(1) + 'px'});
}
const viewPart = () => { const st = $('#stage'); placePart(st.clientWidth, st.clientHeight, outPos); };
function partPlan(W, H){
  if (!partOn() || !(total > 0) || !TS.saveImage) return [];
  const im = partImage(partText(), W, H), m = J(TS.saveImage(`teil-${hashStr(im.key)}.png`, im.url, im.w, im.h, P.id)); if (!m || !m.uri) return [];
  const r = partRect(im, W, H), d = +partStyle().dur || 0;
  return [{mode: 'pip', image: true, uri: m.uri, in: 0, out: r3(d > 0 ? Math.min(total, d) : total), at: 0, x: +((r.x + im.w / 2) / W).toFixed(4), y: +((r.y + im.h / 2) / H).toFixed(4), w: +(im.w / W).toFixed(4), aspect: +(im.w / im.h).toFixed(5),
    track: 97, vol: 0, hasAudio: false, width: im.w, height: im.h, rotation: 0, part: true}];
}
const partSheetOpen = () => !$('#sheet').classList.contains('hidden') && !!$('#ptSheet');
// Ecke, Bezeichnung, Dauer und Größe gelten für die ganze Reihe: Die anderen Clips (nicht geöffnet) bekommen sie kurz nach der Änderung.
let partSyncT = 0, partSyncJob = null, partSyncN = 0;
function partSyncLater(){ if (!P || !P.part) return; partSyncJob = {ids: (P.part.ids || []).filter(id => id !== P.id), st: jc(P.partStyle)}; clearTimeout(partSyncT); partSyncT = setTimeout(partSyncFlush, 900); }
function partSyncFlush(){
  clearTimeout(partSyncT); const j = partSyncJob; partSyncJob = null; if (!j) return;
  let n = 0; for (const id of j.ids){ if (P && P.id === id) continue; if (projEdit(id, p => { if (j.st) p.partStyle = j.st; else delete p.partStyle; })) n++; }
  partSyncN = Math.max(partSyncN, n);
}
function partChanged(quiet){
  lowerRects.clear(); viewPart(); viewLower();
  if (tab === 'clip' && window.renderClip) renderClip(); if (tab === 'export' && !quiet) renderExport();
  if (partSheetOpen()) paintPartSheet();
}
// Einstellungen der Kennzeichnung. Ecke, Größe, Dauer und Bezeichnung gelten für die ganze Reihe: Beim Schließen übernehmen die anderen Clips sie.
function openPart(){
  if (!P || !P.part) return; sheetItem = null;
  const body = $('#sheetBody'); body.innerHTML = '<div id="ptSheet"></div>'; body.onclick = null;
  const box = $('#ptSheet'), POS = [['ol','↖'],['om','↑'],['or','↗'],['ul','↙'],['um','↓'],['ur','↘']]; partSyncN = 0;
  const setSt = patch => { commitBurst('part', () => { P.partStyle = {...partStyle(), ...patch}; }); partSyncLater(); partChanged(); };
  box.innerHTML = `<h3>Kennzeichnung der Reihe</h3>
    <label class="row"><input type="checkbox" id="ptOn"><span>„<b id="ptPrev"></b>“ in diesem Clip einblenden</span></label>
    <div class="grid2" style="margin-top:10px">
      <div class="field"><span>Ecke</span><div class="wm-pos" id="ptPos">${POS.map(([k, a]) => `<button type="button" data-p="${k}">${a}</button>`).join('')}</div></div>
      <label>Bezeichnung <input type="text" id="ptWord" maxlength="24" dir="auto" placeholder="Teil"></label>
      <label>Dauer <select id="ptDur"><option value="0">ganzer Clip</option><option value="3">erste 3 s</option><option value="5">erste 5 s</option><option value="10">erste 10 s</option></select></label>
    </div>
    <div class="field"><span>Größe <b id="ptSizeV"></b></span><input type="range" id="ptSize" min="0.7" max="1.8" step="0.05"></div>
    <p class="muted small">Farben, Schrift und der Balken kommen aus dem Designprofil deiner Folien. Ecke, Bezeichnung, Dauer und Größe gelten für alle Clips der Reihe und gehören zum Hausstil. Schutzzonen, Textzeile, Quellenzeile und Wasserzeichen bleiben frei.</p>
    <div class="row" style="margin-top:12px"><button class="btn primary" data-a="ok" style="margin-left:auto">Fertig</button></div>`;
  box.addEventListener('click', e => { const b = e.target.closest('#ptPos button'); if (b) return setSt({pos: b.dataset.p}); if (e.target.closest('[data-a="ok"]')) closeSheet(); });
  const onIn = e => { const id = e.target.id;
    if (id === 'ptOn'){ commitBurst('part', () => { P.part = {...P.part, on: e.target.checked}; }); partChanged(); }
    else if (id === 'ptSize') setSt({size: +e.target.value});
    else if (id === 'ptDur' && e.type === 'change') setSt({dur: +e.target.value || 0});
    else if (id === 'ptWord') setSt({word: e.target.value.replace(/\s+/g, ' ').slice(0, 24)}); };
  box.addEventListener('input', onIn); box.addEventListener('change', onIn);
  box.addEventListener('keydown', e => { if (e.target.tagName === 'INPUT') e.stopPropagation(); });
  sheetOnClose = () => { partSyncFlush(); const n = partSyncN; partSyncN = 0; if (n) toast(`Kennzeichnung für ${n === 1 ? 'den anderen Clip' : 'die ' + n + ' anderen Clips'} der Reihe übernommen`); };
  paintPartSheet(); openSheet(true);
}
function paintPartSheet(){
  if (!$('#ptSheet') || !P || !P.part) return; const st = partStyle();
  $('#ptOn').checked = P.part.on !== false; $('#ptPrev').textContent = partText() || `${P.part.k}/${P.part.n}`;
  $$('#ptPos button').forEach(b => b.classList.toggle('on', b.dataset.p === st.pos));
  if (document.activeElement !== $('#ptWord')) $('#ptWord').value = st.word ?? '';
  $('#ptDur').value = String([0, 3, 5, 10].includes(+st.dur) ? +st.dur : 0); $('#ptSize').value = st.size; $('#ptSizeV').textContent = Math.round(st.size * 100) + ' %';
}

// ── Clip-Vorschläge (F1): Vorauswahl nach festen Regeln, ohne Online-Dienst. Gesucht werden in sich geschlossene Abschnitte von 20 bis
// 90 Sekunden aus ganzen Sätzen. Es zählen: Absatzgrenzen am Anfang und Ende (eine Sprechpause ab 1,2 s, ein Kapitel oder ein neues Video
// wiegen voll, ein Absatz, den nur die Länge des Textes erzeugt hat, halb; am meisten zählt, wenn beide Enden geschlossen sind), eine Frage
// zum Einstieg, Zahlen, Schlagwörter (eigene Liste, Wörterbuch, betonte Wörter). Dagegen zählen: Absatzgrenzen mitten im Abschnitt und ein
// Einstieg, der an den Satz davor anknüpft („Und …“, „Deshalb …“). ──
const SUG_MIN = 20, SUG_MAX = 90;
const SUG_NUM = /\d|^(prozent|prozentpunkte?n?|euro|cent|millionen?|milliarden?|billionen?|tausende?|hunderte?|drittel|viertel|hälfte|doppelt)$/;   // geprüft am Wort ohne Satzzeichen, klein geschrieben
const SUG_BACK = new Set(['und', 'aber', 'denn', 'doch', 'oder', 'also', 'deshalb', 'deswegen', 'darum', 'daher', 'dadurch', 'dabei', 'dazu', 'dafür', 'dagegen', 'damit', 'danach', 'dann', 'außerdem', 'trotzdem', 'stattdessen', 'sondern', 'weil', 'obwohl', 'nämlich', 'genau', 'ja', 'nein']);
let clipWords = (() => { try { const v = JSON.parse(localStorage.getItem('hc-clipwords')); return Array.isArray(v) ? v.filter(x => typeof x === 'string' && x.trim()).slice(0, 60) : []; } catch(_){ return []; } })();
function clipWordsSet(text){ clipWords = [...new Set(String(text || '').split(/[,;\n]+/).map(s => s.replace(/\s+/g, ' ').trim().slice(0, 60)).filter(Boolean))].slice(0, 60); try { localStorage.setItem('hc-clipwords', JSON.stringify(clipWords)); } catch(_){} }
function mergeClipWords(list){ let n = 0; const have = new Set(clipWords.map(w => w.toLowerCase())); for (const w of Array.isArray(list) ? list : []){ if (typeof w !== 'string' || !w.trim() || have.has(w.trim().toLowerCase()) || clipWords.length >= 60) continue; clipWords.push(w.trim().slice(0, 60)); have.add(w.trim().toLowerCase()); n++; }
  if (n) try { localStorage.setItem('hc-clipwords', JSON.stringify(clipWords)); } catch(_){} return n; }
let sugMemo = null;
function clipSuggest(){
  if (!P || !tokens.length) return [];
  const key = JSON.stringify([P.id, total.toFixed(2), tokens.length, deleted.size, P.dels.length, (P.moves || []).length, Object.keys(P.edits || {}).length, clipWords, P.kw || [], dict.length, (P.marks || []).filter(m => m.k === 'chap').map(m => m.at)]);
  if (sugMemo && sugMemo.key === key) return sugMemo.list;
  if (order.length !== tokens.length) computeOrder();
  // 1. Wörter, die im Video bleiben, in der Reihenfolge des Textes
  const W = [], kwTok = new Set(P.kw || []);
  for (let k = 0; k < order.length; k++){ const i = order[k], t = tokens[i]; if (!isSaid(i) || isCut(i)) continue; const txt = String(tokText(t) || '').trim(); if (!txt) continue;
    const pv = k > 0 ? tokens[order[k - 1]] : null;   // Sprechpause unmittelbar davor (auch eine gekürzte oder herausgeschnittene zählt als Einschnitt)
    W.push({k, i, txt, n: kwNorm(txt), a: srcToOut(snapSrc(wS(t))), e: srcToOut(wE(t)), p: t.p, src: t.src, gap: pv && pv.type === 'pause' && !P.edits[pv.i] ? pv.e - pv.s : 0}); }
  // 2. Sätze: bis zum Satzzeichen; ohne Satzzeichen endet ein Satz an einer Pause oder nach 40 Wörtern
  const S0 = []; let cur = null;
  W.forEach((w, x) => {
    if (cur && (w.src !== W[cur.b].src || (cur.b - cur.a >= 39) || (w.gap >= 0.45 && cur.b - cur.a >= 11))){ S0.push(cur); cur = null; }
    if (!cur) cur = {a: x, b: x}; else cur.b = x;
    if (sentEnd(w.txt)){ S0.push(cur); cur = null; }
  });
  if (cur) S0.push(cur);
  const own = clipWords.map(w => ({w, n: w.split(/\s+/).map(kwNorm).filter(Boolean).join(' ')})).filter(q => q.n.length > 1), dset = kwDictSet();
  for (const s of S0){
    const ws = W.slice(s.a, s.b + 1), text = ' ' + ws.map(w => w.n).join(' ') + ' ';
    s.o1 = ws[0].a; s.o2 = ws[ws.length - 1].e; s.q = /[?؟]$/.test(ws[ws.length - 1].txt); s.num = ws.some(w => SUG_NUM.test(w.n)); s.first = ws[0].n; s.gap = ws[0].gap;
    s.kw = new Set(); for (const q of own) if (text.includes(' ' + q.n)) s.kw.add(q.w);
    for (const w of ws){ if (dset.has(w.n)) s.kw.add(w.txt.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')); if (kwTok.has(w.i)) s.kw.add(w.txt.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')); }
  }
  // Absatzgrenzen vor jedem Satz: 2 = Sprechpause ab 1,2 s, Kapitelanfang, neues Video oder der Anfang; 1 = Absatz, den nur die Länge erzeugt hat; 0 = keine
  const chapTok = new Set((P.marks || []).filter(m => m.k === 'chap').map(m => tokAtSrc(m.at)).filter(k => k >= 0).map(k => pos[k]));
  S0.forEach((s, x) => { const pv = S0[x - 1], f = W[s.a];
    s.ps = !pv || W[pv.b].src !== f.src || f.gap >= 1.2 || [...chapTok].some(k => k > W[pv.b].k && k <= f.k) ? 2 : W[pv.b].p !== f.p ? 1 : 0; });
  S0.forEach((s, x) => { s.pe = S0[x + 1] ? S0[x + 1].ps : 2; });
  // 3. Fenster aus ganzen Sätzen, bewertet
  const cand = [];
  for (let x = 0; x < S0.length; x++){
    const kws = new Set(); let nums = 0, qs = 0, in2 = 0, in1 = 0;   // in2, in1: volle und halbe Absatzgrenzen im Inneren
    for (let y = x; y < S0.length; y++){
      const a = S0[x], b = S0[y]; if (W[b.a].src !== W[a.a].src || b.o2 < a.o1) break;
      const d = b.o2 - a.o1 + 0.23; if (d > SUG_MAX) break;
      for (const q of b.kw) kws.add(q); if (b.num) nums++; if (b.q && y > x) qs++; if (y > x){ if (b.ps === 2) in2++; else if (b.ps === 1) in1++; }
      if (d < SUG_MIN) continue;
      let sc = 0; const why = [];
      sc += a.ps === 2 ? 2.5 : a.ps === 1 ? 1.2 : a.gap >= 0.45 ? 0.4 : 0; sc += b.pe === 2 ? 2.5 : b.pe === 1 ? 1.2 : 0; sc -= 2 * in2 + 0.5 * in1;
      if (a.ps === 2 && b.pe === 2){ sc += in2 ? 3 : 3.5; why.push(in2 ? `${in2 + 1} Absätze` : 'ganzer Absatz'); }   // an beiden Enden geschlossen: das wiegt am meisten
      else { if (a.ps === 2) why.push('beginnt mit einem Absatz'); if (b.pe === 2) why.push('endet mit einem Absatz'); }
      if (a.q){ sc += 2; why.push('Frage zum Einstieg'); }
      if (qs && !b.q) sc += 0.5; if (b.q && y > x) sc -= 1;
      if (nums){ sc += Math.min(2, nums); why.push('Zahlen'); }
      if (kws.size){ sc += Math.min(4.5, kws.size * 1.5); why.push((kws.size === 1 ? 'Schlagwort: ' : 'Schlagwörter: ') + [...kws].slice(0, 3).join(', ') + (kws.size > 3 ? ' …' : '')); }
      if (SUG_BACK.has(a.first)) sc -= 2;
      if (d >= 25 && d <= 60) sc += 0.5; else if (d > 75) sc -= 0.5;
      if (sc > 0) cand.push({x, y, sc, d, why});
    }
  }
  // 4. Auswahl ohne Überschneidung, bei der die Summe der Wertungen am größten ist: Zwei geschlossene Absätze nebeneinander zählen
  // dadurch mehr als ein Fenster über beide. Sind es mehr als das Video an Vorschlägen verträgt, bleiben die bestbewerteten.
  const byEnd = new Map(); for (const c of cand){ if (!byEnd.has(c.y)) byEnd.set(c.y, []); byEnd.get(c.y).push(c); }
  const best = new Float64Array(S0.length + 1), take = new Array(S0.length + 1).fill(null);
  for (let y = 0; y < S0.length; y++){ best[y + 1] = best[y];
    for (const c of byEnd.get(y) || []) if (best[c.x] + c.sc > best[y + 1] + 1e-9){ best[y + 1] = best[c.x] + c.sc; take[y + 1] = c; } }
  let pick = []; for (let y = S0.length; y > 0;){ const c = take[y]; if (c){ pick.push(c); y = c.x; } else y--; }
  const max = clamp(Math.round(total / 30), 3, 15);
  if (pick.length > max) pick = pick.sort((p, q) => q.sc - p.sc || Math.abs(p.d - 45) - Math.abs(q.d - 45)).slice(0, max);
  pick.sort((p, q) => p.x - q.x);
  const list = pick.map(c => { const a = S0[c.x], b = S0[c.y], ws = W.slice(a.a, b.b + 1), ids = order.slice(W[a.a].k, W[b.b].k + 1), r = outRangeOf(ids) || [a.o1, b.o2];
    return {ids, o1: r[0], o2: r[1], sc: c.sc, why: c.why, text: ws.slice(0, 12).map(w => w.txt).join(' ') + (ws.length > 12 ? ' …' : '')}; });
  sugMemo = {key, list}; return list;
}
function clipsSugHtml(){
  if (!tokens.length) return '<p class="muted small">Vorschläge gibt es, sobald das Video transkribiert ist.</p>';
  const list = clipSuggest(), have = clipListAll();
  const head = `<p class="muted small">Vorauswahl nach festen Regeln, ohne Online-Dienst: in sich geschlossene Abschnitte von ${SUG_MIN} bis ${SUG_MAX} Sekunden – nach Absätzen, Fragen, Zahlen und Schlagwörtern. Anhören und übernehmen, was trägt.</p>
    <label class="field"><span>Eigene Schlagwörter (durch Komma getrennt)</span><input type="text" id="clWords" placeholder="z. B. Mietendeckel, Streik, Vergesellschaftung" autocomplete="off" dir="auto"></label>`;
  if (!list.length) return head + '<p class="muted small">Kein Abschnitt passt in dieses Raster. Das Video ist dafür zu kurz, oder dem Text fehlen Satzzeichen und Absätze.</p>';
  return head + `<div class="cl-list">${list.map((q, k) => { const on = have.some(p => secSame(p, secOf(q.ids)));
    return `<div class="cl-row sug" data-k="${k}"><button type="button" class="mini" data-a="play" title="Anhören">▶</button>
      <button type="button" class="mk-go" title="Im Text zeigen"><span class="mono">${fmtT(q.o1)}</span><span class="mk-t"><b dir="auto">${esc(q.text)}</b><i>${fmtD(q.o2 - q.o1)} s${q.why.length ? ' · ' + esc(q.why.join(' · ')) : ''}</i></span></button>
      ${on ? '<span class="cl-on" title="Schon vorgemerkt">✓ vorgemerkt</span>' : '<button type="button" class="btn small" data-a="take" title="In die Liste „Vorgemerkt“ übernehmen">Übernehmen</button>'}</div>`; }).join('')}</div>
    <div class="row wrap"><button type="button" class="btn small" data-a="takeall">Alle übernehmen</button></div>`;
}

// ── Suche über alle Projekte (C9): Die Suchzeile der Projektliste findet auch, was in den Videos gesagt wird. Je Projekt entsteht im
// Arbeitsspeicher ein kleiner Index aus den Wörtern, die im Video bleiben (ein Text, dazu die Wortnummern); er wird neu gebaut, sobald
// das Projekt geändert wurde. Clips, deren Hauptprojekt es noch gibt, bleiben außen vor – ihre Treffer stehen schon dort.
// Gesucht wird wie im Text-Reiter: die Wörter am Stück, das letzte darf weitergehen. Ein einzelnes Wort ab vier Buchstaben findet
// auch Zusammensetzungen („Deckel“ in „Mietendeckel“). ──
const FIND_MIN = 3, FIND_SHOW = 4;
const findIdx = new Map();   // Projekt-ID → {updated, n, text, off, raw, roff, tok, at} oder {updated, skip}
let findRun = 0, findT = 0, findRes = null, findLastQ = '', findDoneQ = null, findOpenAll = new Set();
const findNorm = s => String(s || '').toLowerCase().normalize('NFC').split(/\s+/).map(w => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean).join(' ');
function findBuild(p, ids){
  const toks = p.tokens || []; if (!toks.length || (p.clipOf && ids.has(p.clipOf))) return {skip: true};
  const del = new Set(p.deleted || []), dels = (p.dels || []).slice().sort((a, b) => a[0] - b[0]), ed = p.edits || {}, tr = p.trims || {};
  const N = [], R = [], tok = [], at = []; let acc = 0, di = 0;
  for (let i = 0; i < toks.length; i++){
    const t = toks[i], mid = ((t.ws ?? t.s) + (t.we ?? t.e)) / 2;
    while (di < dels.length && dels[di][1] <= mid) di++;
    if (del.has(i) || (di < dels.length && mid > dels[di][0] + 1e-4 && mid < dels[di][1] - 1e-4)) continue;
    const raw = String((ed[i] != null ? ed[i] : t.type === 'word' ? t.text : '') || '').replace(/\s+/g, ' ').trim(), n = raw && findNorm(raw);
    if (n){ N.push(n); R.push(raw); tok.push(i); at.push(acc); }
    acc += t.type === 'pause' && tr[i] != null ? Math.max(0, +tr[i] || 0) : Math.max(0, (t.e || 0) - (t.s || 0));
  }
  if (!N.length) return {skip: true};
  const off = new Int32Array(N.length), roff = new Int32Array(N.length + 1); let a = 1, b = 0;
  N.forEach((w, k) => { off[k] = a; a += w.length + 1; }); R.forEach((w, k) => { roff[k] = b; b += w.length + 1; }); roff[N.length] = b;
  return {n: N.length, text: ' ' + N.join(' ') + ' ', off, raw: R.join(' ') + ' ', roff, tok: Int32Array.from(tok), at: Float32Array.from(at)};
}
function findWordAt(ix, p){ let lo = 0, hi = ix.n - 1, k = 0; while (lo <= hi){ const m = (lo + hi) >> 1; if (ix.off[m] <= p){ k = m; lo = m + 1; } else hi = m - 1; } return k; }
function findIn(ix, qs){   // → [[erstes Wort, letztes Wort], …] als Nummern im Index
  const hits = [], one = qs.length === 1, needle = (one && qs[0].length >= 4 ? '' : ' ') + qs.join(' '); let p = -1, last = -1;
  while ((p = ix.text.indexOf(needle, p + 1)) >= 0){
    const k1 = findWordAt(ix, needle[0] === ' ' ? p + 1 : p), k2 = findWordAt(ix, p + needle.length - 1);
    if (k1 > last){ hits.push([k1, k2]); last = k2; }
  }
  return hits;
}
const findRaw = (ix, a, b) => a >= b ? '' : ix.raw.slice(ix.roff[a], ix.roff[b]).trim();   // Wörter a bis b − 1, wie sie im Text stehen
function findHit(ix, p, h){
  const [k1, k2] = h, a = Math.max(0, k1 - 7), b = Math.min(ix.n, k2 + 12);
  return {pid: p.id, tokA: ix.tok[k1], tokB: ix.tok[k2], at: ix.at[k1], pre: (a > 0 ? '… ' : '') + findRaw(ix, a, k1), hit: findRaw(ix, k1, k2 + 1), post: findRaw(ix, k2 + 1, b) + (b < ix.n ? ' …' : '')};
}
function findLater(){ clearTimeout(findT); if (findNorm($('#projFind').value).length < FIND_MIN) return findStart(); findT = setTimeout(findStart, 220); }
async function findStart(){
  const run = ++findRun, box = $('#findHits'), query = $('#projFind').value.trim(), qs = findNorm(query).split(' ').filter(Boolean);
  if (qs.join(' ').length < FIND_MIN || !homeList.length){ findRes = null; findDoneQ = query; box.classList.add('hidden'); box.textContent = ''; return; }
  if ($('#home').classList.contains('hidden')) return;   // ein Projekt ist offen: gesucht wird wieder, sobald die Liste zu sehen ist
  if (query !== findLastQ){ findLastQ = query; findOpenAll.clear(); }
  const list = [...homeList].sort(HOME_SORT.new), ids = new Set(list.map(p => p.id)), res = []; let seen = 0, t0 = performance.now();
  for (const k of [...findIdx.keys()]) if (!ids.has(k)) findIdx.delete(k);   // gelöschte Projekte
  for (const p of list){
    let ix = findIdx.get(p.id);
    if (!ix || ix.updated !== p.updated){
      let full = null; try { full = J(TS.loadProject(p.id)); } catch(_){}
      ix = full && typeof full === 'object' ? findBuild(full, ids) : {skip: true}; ix.updated = p.updated; findIdx.set(p.id, ix);
      if (performance.now() - t0 > 40){ findPaint(query, res, `Texte werden durchsucht … ${seen + 1} von ${list.length} Projekten`); await waitMs(0); t0 = performance.now(); if (run !== findRun) return; }
    }
    seen++; if (ix.skip) continue;
    const hits = findIn(ix, qs); if (hits.length) res.push({p, n: hits.length, hits: hits.slice(0, 40).map(h => findHit(ix, p, h))});
  }
  if (run !== findRun) return;
  findRes = res; findPaint(query, res, ''); findDoneQ = query;
}
function findPaint(query, res, busy){
  const box = $('#findHits'); if ($('#home').classList.contains('hidden')) return;
  const n = res.reduce((s, r) => s + r.n, 0), none = $('#projList .home-none');
  if (none && n) none.remove();   // kein Projektname passt, der Text hat Treffer: Dann stehen nur sie da
  box.classList.toggle('hidden', !n && !busy);
  box.innerHTML = (n || busy ? `<h3 class="fh-h">Im gesprochenen Text${n ? ` · ${n === 1 ? '1 Treffer' : n + ' Treffer'}${res.length > 1 ? ' in ' + res.length + ' Projekten' : ''}` : ''}</h3>` : '') + (busy ? `<p class="muted small fh-busy">${esc(busy)}</p>` : '') +
    res.map(r => { const all = findOpenAll.has(r.p.id), shown = all ? r.hits : r.hits.slice(0, FIND_SHOW);
      return `<div class="fh-proj" data-id="${esc(r.p.id)}"><div class="fh-name"><b dir="auto">${esc(r.p.name)}</b><span class="muted small">${r.n === 1 ? '1 Treffer' : r.n + ' Treffer'}</span></div>
        ${shown.map((h, k) => `<div class="fh-row" data-k="${k}"><button type="button" class="fh-go" title="Projekt an dieser Stelle öffnen"><span class="mono">${fmtT(h.at)}</span><span class="fh-t" dir="auto">${esc(h.pre)} <mark>${esc(h.hit)}</mark> ${esc(h.post)}</span></button><button type="button" class="btn small" data-a="clip" title="Projekt öffnen und den Satz um die Stelle als Clip übernehmen">Als Clip</button></div>`).join('')}
        ${r.hits.length > shown.length ? `<button type="button" class="btn small ghost" data-a="more">${r.n > r.hits.length ? `Weitere ${r.hits.length - shown.length} zeigen (von ${r.n})` : `Weitere ${r.hits.length - shown.length} zeigen`}</button>` : ''}</div>`; }).join('');
}
$('#findHits').addEventListener('click', e => {
  const pj = e.target.closest('.fh-proj'), r = pj && findRes && findRes.find(x => x.p.id === pj.dataset.id); if (!r) return;
  if (e.target.closest('[data-a="more"]')){ findOpenAll.add(r.p.id); return findPaint($('#projFind').value.trim(), findRes, ''); }
  const row = e.target.closest('.fh-row'), h = row && r.hits[+row.dataset.k]; if (!h) return;
  findOpen(h, !!e.target.closest('[data-a="clip"]'));
});
// Treffer öffnen: Projekt laden, die Stelle im Text markieren und zeigen; „Als Clip“ markiert den ganzen Satz und öffnet den Clip-Dialog
async function findOpen(h, asClip){
  if (!(await openProjectWait(h.pid)) || !tokens.length) return;
  if (tab !== 'text') setTab('text');
  for (let k = 0; k < 40 && !spans.length; k++) await waitMs(25);
  if (!P || P.id !== h.pid || !tokens[h.tokA] || !tokens[h.tokB] || !spans.length) return;
  if (order.length !== tokens.length) computeOrder();
  let a = h.tokA, b = h.tokB;
  if (asClip){ const r = sentBounds(Math.min(pos[a], pos[b]), Math.max(pos[a], pos[b])); a = order[r[0]]; b = order[r[1]]; }
  selA = a; selB = b; showSel();
  if (spans[a]) spans[a].scrollIntoView({block: 'center'});
  const t = tokens[a]; seekOut(Math.min(srcToOut(snapSrc(t.ws ?? t.s)), Math.max(0, total - 0.01)), false); tlReveal();
  if (asClip) $('#selClip').click();
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
  if (P && P.id === o.id){ if (o.tab && o.tab !== tab && !tjGet(o.id)) setTab(o.tab); if (o.pos) seekOut(o.pos, false);
    // Zeitleiste, Clip- und Folien-Reiter stehen in Skripten, die erst nach diesem geladen werden. Ohne den zweiten Aufbau blieb die
    // Zeitleiste nach dem Neuladen leer, bis man den Reiter wechselte.
    const late = () => { if (P && P.id === o.id){ setTab(tab); seekOut(outPos, false); } };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', late, {once: true}); else setTimeout(late, 0); }
})();
