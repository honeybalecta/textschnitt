'use strict';
/* Textschnitt-Studio – gemeinsame Oberfläche für Windows, Android und Web.
   Die Plattform stellt window.TS bereit: Android nativ, Desktop über bridge-http.js. */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const J = s => { try { return JSON.parse(s); } catch(e){ return null; } };
const TS = window.TS;
const CAP = Object.assign({platform:'android', exportFormats:['video']}, J(TS.info ? TS.info() : '') || {});
document.documentElement.dataset.platform = CAP.platform;
const FINE = matchMedia('(pointer: fine)').matches;
const MEDIA = uri => 'media?u=' + encodeURIComponent(uri);
const THUMB = (uri, t, h) => `thumb?u=${encodeURIComponent(uri)}&t=${t.toFixed(1)}&h=${h}`;

const fmtT = t => { t = Math.max(0, t || 0); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = Math.floor(t % 60);
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
const fmtS = t => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + s.toFixed(1).padStart(4, '0').replace('.', ','); };
const norm = w => w.toLowerCase().replace(/[.,!?;:…"„“”‚‘’'()\-–—]/g, '');
const FILLER = /^(ä+h*m*|ä+m+|ö+h*m*|ö+m+|e+h+m*|e+m+|h+m+|mh+m+|m+h*m+|u+h+m*|uu+m+|erm|a+h+m+)$/i;
const newId = () => Math.random().toString(36).slice(2, 10);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const r3 = x => +(+x).toFixed(3);
const tokText = t => (P && P.edits && P.edits[t.i] != null) ? P.edits[t.i] : t.text;
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2600); }

// ───────── Brücke zur Plattform ─────────
const pending = new Map();
window.TSApp = {
  onPicked(reqId, json){ const cb = pending.get(reqId); pending.delete(reqId); if (cb) cb(json ? J(json) : null); },
  onBack(){ if (!$('#sheet').classList.contains('hidden')) { closeSheet(); return true; }
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
function envDb(si, t){ const s = P.sources[si], a = envArr(s); if (!a) return 0; const i = Math.round((t - s.off) * 100); return i < 0 || i >= a.length ? -90 : a[i] / 2.8 - 90; }

// ───────── Projektliste ─────────
function showHome(){
  $('#home').classList.remove('hidden'); $('#proj').classList.add('hidden');
  const list = J(TS.listProjects()) || [];
  const box = $('#projList'); box.innerHTML = '';
  $('#homeEmpty').classList.toggle('hidden', list.length > 0);
  list.sort((a, b) => b.updated - a.updated).forEach(p => {
    const el = document.createElement('div'); el.className = 'proj-item';
    el.innerHTML = `<div class="meta"><b></b><span class="muted small"></span></div><button class="del" title="Löschen">🗑</button>`;
    el.querySelector('b').textContent = p.name;
    el.querySelector('span').textContent = `${fmtT(p.duration)}${p.sources > 1 ? ` · ${p.sources} Videos` : ''} · ${p.transcribed ? 'transkribiert' : 'noch nicht transkribiert'} · ${new Date(p.updated).toLocaleDateString('de-DE')}`;
    el.onclick = e => { if (e.target.closest('.del')) return; openProject(p.id); };
    el.querySelector('.del').onclick = () => { if (confirm(`„${p.name}“ löschen? Deine Videos bleiben erhalten.`)) { TS.deleteProject(p.id); showHome(); } };
    box.append(el);
  });
  $('#homeHint').textContent = CAP.platform === 'desktop' ? 'Wähle ein oder mehrere Videos (Strg/Umschalt für mehrere). Sie werden hintereinandergehängt und gemeinsam transkribiert.'
    : 'Wähle ein oder mehrere Videos aus deiner Galerie. Sie werden hintereinandergehängt und auf dem Gerät transkribiert – du schneidest dann über den Text.';
}
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
function closeProject(){ pausePlay(); saveNow(); busPid = null; P = null; V.removeAttribute('src'); V.load(); vSi = -1; hideOverlay(); showHome(); }
$('#backBtn').onclick = closeProject;
const fillsWrap = () => isWide() || matchMedia('(orientation: landscape) and (max-height: 599px)').matches;
function fitStage(){
  if (!P) return;
  const [w, h] = dispSize(primary()), wrap = $('.stage-wrap'), st = $('#stage');
  const maxW = wrap.clientWidth || innerWidth;
  const maxH = fillsWrap() ? (wrap.clientHeight || innerHeight * 0.6) : Math.max(160, Math.min(innerHeight * 0.42, innerHeight - 420));
  let W = maxW, H = W * h / w; if (H > maxH){ H = maxH; W = H * w / h; }
  st.style.width = Math.floor(W) + 'px'; st.style.height = Math.floor(H) + 'px';
  styleOverlay();
}
addEventListener('resize', () => { fitStage(); if (P && studioOn() && window.renderTimeline) renderTimeline(); });
addEventListener('orientationchange', () => setTimeout(fitStage, 200));

// Alte Projekte ohne Lautstärke-Hüllkurve: im Hintergrund nachberechnen, damit Schnitte in Pausen landen
function backfillEnv(){
  if (!TS.envelope || !P) return;
  const pid = P.id, todo = P.sources.filter(s => s.tr && !s.noAudio && !s.env && s.hasAudio !== false);
  (function next(){
    const s = todo.shift(); if (!s || !P || P.id !== pid) return;
    let id; try { id = TS.envelope(s.uri); } catch(_){ return; }
    watchJob(id, () => {}, j => { if (P && P.id === pid && j.result && j.result.env){ s.env = j.result.env; changed(false); toast('Schnittkanten an Sprechpausen ausgerichtet'); } next(); }, () => next());
  })();
}

// ───────── Mehrere Fenster: Abgleich über das Desktop-Backend ─────────
const WIN = newId();
let busPid = null, busSeq = -1, busT = null, applyingRemote = false, posSent = {o:-1, at:0};
function busSend(msg){
  if (!CAP.bus || !P) return;
  fetch('api/bus?p=' + encodeURIComponent(P.id) + '&from=' + WIN, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(msg)}).catch(() => {});
}
let busGen = 0;
function busStart(){
  if (!CAP.bus || !P || busPid === P.id) return; busPid = P.id; busSeq = -1;
  const pid = P.id, gen = ++busGen;
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
function buildTokens(words, duration){
  const PAUSE_MIN = 0.45, PARA_GAP = 1.2, PARA_MAX = 55;
  const out = []; let cursor = 0, para = 0, paraWords = 0;
  // Satzzeichen, die als eigenes „Wort“ kommen, an das vorige Wort hängen
  const ws0 = [];
  for (const w of words){
    const text = (w.text || '').trim(); if (!text) continue;
    if (/^[.,!?;:…»«"“”)]+$/.test(text) && ws0.length){ ws0[ws0.length-1].text += text; ws0[ws0.length-1].end = Math.max(ws0[ws0.length-1].end, w.end); continue; }
    ws0.push({...w, text});
  }
  for (const w of ws0){
    let ws = Math.max(w.start, cursor); const we = Math.max(w.end, ws + 0.02); const gap = ws - cursor;
    let newPara = false;
    if (out.length){
      const last = [...out].reverse().find(t => t.type === 'word');
      const ends = last && /[.?!…]$/.test(last.text);
      if (gap >= PARA_GAP || (paraWords >= PARA_MAX && ends)) newPara = true;
    }
    let regionStart;
    if (gap >= PAUSE_MIN){ out.push({type:'pause', text:'', s:cursor, e:ws, p:para}); regionStart = ws; }
    else if (out.length){ out[out.length-1].e = ws; regionStart = ws; }
    else regionStart = 0;
    if (newPara){ para++; paraWords = 0; }
    out.push({type:'word', text:w.text, s:regionStart, e:we, ws, we, pr:+(w.prob ?? 1).toFixed(2), p:para});
    paraWords++; cursor = we;
  }
  if (duration > cursor){
    if (duration - cursor >= PAUSE_MIN || !out.length) out.push({type:'pause', text:'', s:cursor, e:duration, p:para});
    else out[out.length-1].e = duration;
  }
  return out;
}
// Transkript einer Quelle an die Tokens anhängen (Zeiten auf der gemeinsamen Zeitachse)
function appendSourceTokens(k, words){
  const s = P.sources[k], base = tokens.length, para0 = tokens.length ? tokens[tokens.length-1].p + 1 : 0;
  const tk = buildTokens(words, s.duration);
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
      if (rs > S0 + 0.01) s = snapCut(si, rs, prevEnd + 0.01, re - 0.05, speechSide(a, rs, true));
      if (re < S1 - 0.01) e = snapCut(si, re, s + 0.05, nextStart - 0.01, speechSide(b, re, false));
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
function computePieces(){
  normDels();
  const sp = [...P.splits].sort((a, b) => a - b), out = [];
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
      for (const x of sp){ if (x > cur.s + 0.05 && x < cur.e - 0.05){ out.push({...cur, e:x, R:{k:'split', x}}); cur = {...cur, s:x, L:{k:'split', x}}; } }
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
  const pushIns = it => { const d = Math.max(0.1, it.x.out - it.x.in); segs.push({kind:'insert', item:it.x, uri:it.x.clip.uri, in:it.x.in, out:it.x.in + d, o}); o += d; it.done = true; };
  for (const pc of ordered){
    let s = pc.s; const e = pc.e; let L = pc.L;
    const own = ins.filter(it => it.pc === pc);
    const after = own.filter(it => it.a >= e - 0.001), before = own.filter(it => it.a < e - 0.001);
    for (const it of before){
      if (it.a - s > 0.02){ segs.push({kind:'main', si:pc.si, in:s, out:it.a, o, L, R:{k:'ins'}}); o += it.a - s; s = it.a; L = {k:'ins'}; }
      pushIns(it);
    }
    if (e - s > 0.001){ segs.push({kind:'main', si:pc.si, in:s, out:e, o, L, R:pc.R}); o += e - s; }
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
    if (t >= g.in - 1e-6 && t <= g.out + 1e-6) return g.o + clamp(t - g.in, 0, g.out - g.in);
    if (g.in > t && (!best || g.in < best.in)) best = g;
  }
  return best ? best.o : total;
}
function segAtOut(o){
  let lo = 0, hi = timeline.length - 1;
  while (lo <= hi){ const m = (lo + hi) >> 1, g = timeline[m]; const d = g.out - g.in;
    if (o < g.o) hi = m - 1; else if (o >= g.o + d) lo = m + 1; else return m; }
  return o >= total ? timeline.length - 1 : 0;
}
function computeOverlays(){
  overlays = P.items.filter(x => x.type === 'broll' || x.type === 'pip').map(x => {
    const at = srcToOut(snapSrc(x.at)), d = Math.max(0.1, x.out - x.in);
    return {x, at, end: Math.min(total, at + d)};
  }).filter(o => o.end - o.at > 0.05).sort((a, b) => a.at - b.at);
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
  computeRanges(); computePieces(); computeOrder(); buildTimeline(); computeOverlays(); drawScrub();
  if (studioOn() && window.renderTimeline) renderTimeline();
  $('#tTot').textContent = fmtT(total);
}
function drawScrub(){
  const box = $('#segs'); box.innerHTML = ''; if (!total) return;
  const pct = x => (x / total * 100) + '%';
  for (const g of timeline){ const d = document.createElement('div'); d.className = 's ' + g.kind + (g.kind === 'main' && g.si % 2 ? ' alt' : ''); d.style.left = pct(g.o); d.style.width = `calc(${pct(g.out - g.in)} - 1px)`; box.append(d); }
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
  V.src = s.proxy ? 'media?f=' + encodeURIComponent(s.proxy) : MEDIA(s.uri);
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
function curOut(){ const g = timeline[curSeg]; if (!g) return 0; return g.o + clamp(segLocal(g) - g.in, 0, g.out - g.in); }
function curSrc(){ const g = timeline[curSeg]; return g && g.kind === 'main' ? vT() : (g ? snapSrc(g.item.at) : 0); }
function seekOut(o, keepPlaying = playing){
  if (!timeline.length) return;
  o = clamp(o, 0, Math.max(0, total - 0.01)); curSeg = segAtOut(o); outPos = o;
  const g = timeline[curSeg], local = g.in + (o - g.o);
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
    IV.classList.remove('hidden'); IV.currentTime = local; if (keepPlaying) IV.play().catch(() => {});
  }
  updateOverlay(o); updateZoom(); updateSubs(o); updateHead(o);
}
// Nahtloser Übergang: folgt das nächste Stück direkt in derselben Quelle, wird nicht gesprungen
function advanceSeg(){
  const g = timeline[curSeg], n = timeline[curSeg + 1];
  if (!n){ pausePlay(); outPos = total; return; }
  if (g.kind === 'main' && n.kind === 'main' && n.si === g.si && Math.abs(n.in - g.out) < 0.02){ curSeg++; return; }
  seekOut(n.o, true);
}
function togglePlay(){ if (V.dataset.err){ toast('Vorschau nicht abspielbar – siehe Hinweis im Bild'); return; } playing ? pausePlay() : startPlay(); }
function startPlay(){
  if (!timeline.length) return; if (outPos >= total - 0.05) seekOut(0, false);
  playing = true; $('#playBtn').textContent = '❚❚'; seekOut(outPos, true); TS.keepAwake(true);
}
function pausePlay(){
  const g0 = timeline[curSeg]; if (playing && g0 && g0.kind === 'insert' && isImg(g0.item.clip)) imgClock = {local: segLocal(g0), t0: performance.now()};
  playing = false; stopAt = null; vWantPlay = false; V.pause(); IV.pause(); OV.pause(); $('#playBtn').textContent = '▶'; TS.keepAwake(false);
}
$('#playBtn').onclick = togglePlay;
function loop(){
  if (P && timeline.length && playing){
    const g = timeline[curSeg], el = g.kind === 'main' ? V : (isImg(g.item.clip) ? null : IV);
    if (g.kind === 'main' && vSi !== g.si) seekV(g.si, g.in - P.sources[g.si].off, true);
    if (segLocal(g) >= g.out - 0.012 || (el && el.ended && vPending == null)) advanceSeg();
    if (playing){
      outPos = curOut();
      if (stopAt != null && outPos >= stopAt) pausePlay();
      updateOverlay(outPos); updateZoom(); updateSubs(outPos); updateHead(outPos); highlightNow();
    }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
function updateHead(o){ $('#head').style.left = (total ? o / total * 100 : 0) + '%'; $('#tNow').textContent = fmtT(o); }
function updateOverlay(o){
  const a = overlays.find(x => o >= x.at && o < x.end);
  if (!a){ hideOverlay(); return; }
  const img = isImg(a.x.clip), el = img ? OI : OV, other = img ? OV : OI;
  if (!other.classList.contains('hidden')){ if (other === OV) OV.pause(); other.classList.add('hidden'); }
  const url = MEDIA(a.x.clip.uri); if (el.dataset.src !== url){ el.src = url; el.dataset.src = url; }
  el.classList.remove('hidden');
  const pip = a.x.type === 'pip'; el.classList.toggle('pip', pip);
  if (pip){ const sz = (a.x.size || 0.33) * 100, st = $('#stage'), mx = 3, my = 3 * st.clientWidth / Math.max(1, st.clientHeight); const c = a.x.corner || 'or';
    Object.assign(el.style, {width: sz + '%', height: sz + '%', left: c[1] === 'l' ? mx + '%' : '', right: c[1] === 'r' ? mx + '%' : '', top: c[0] === 'o' ? my + '%' : '', bottom: c[0] === 'u' ? my + '%' : ''}); }
  else Object.assign(el.style, {width:'', height:'', left:'', right:'', top:'', bottom:''});
  if (img) return;
  const target = a.x.in + (o - a.at);
  if (Math.abs(OV.currentTime - target) > (playing ? 0.3 : 0.05)) OV.currentTime = target;
  if (playing && OV.paused) OV.play().catch(() => {}); if (!playing && !OV.paused) OV.pause();
}
function hideOverlay(){ if (!OV.classList.contains('hidden')){ OV.pause(); OV.classList.add('hidden'); } OI.classList.add('hidden'); }
function updateZoom(){
  const g = timeline[curSeg];
  if (!g || g.kind !== 'main'){ V.style.transform = ''; return; }
  const z = zoomAt(vT());
  V.style.transformOrigin = `${z.cx * 100}% ${z.cy * 100}%`; V.style.transform = z.s > 1.001 ? `scale(${z.s})` : '';
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
  $('#transBtn').textContent = todo > 1 ? `${todo} Videos transkribieren` : 'Transkription starten';
  $('#transBtn').disabled = !todo;
}
async function addSources(){
  const list = asList(await pickMedia('videos')); if (!list.length) return;
  P.sources.push(...list.map(cleanSrc)); layoutSources(); changed(); saveNow(); renderSources();
  toast(list.length > 1 ? `${list.length} Videos angehängt` : 'Video angehängt');
  if (tokens.length) setTab('trans');
}
$('#addSrcBtn').onclick = addSources;
let transJob = null, transCancelled = false;
$('#transBtn').onclick = () => {
  const todo = P.sources.map((s, k) => k).filter(k => !P.sources[k].tr);
  if (!todo.length) return;
  $('#transBtn').disabled = true; $('#transCancel').classList.remove('hidden'); $('#transProg').classList.remove('hidden'); TS.keepAwake(true);
  transCancelled = false;
  const model = $('#model').value, lang = $('#lang').value, fillers = $('#fillers').checked;
  const startTok = tokens.length, firstTime = !tokens.length;
  let n = 0, words = 0;
  const end = () => { $('#transBtn').disabled = false; $('#transCancel').classList.add('hidden'); TS.keepAwake(false); transJob = null; renderSources(); };
  const finish = () => {
    end(); P.language ||= lang;
    if (firstTime){ deleted = new Set(); P.trims = {}; P.adj = {}; }
    const cleaned = autoClean(startTok);
    if (firstTime) genCues(); else genCues(startTok);
    renderTranscript(); changed(); saveNow(); busSend({t:'reload'}); setTab('text'); toast(`${words} Wörter erkannt` + (cleaned.length ? ` · entfernt: ${cleaned.join(', ')}` : ''));
  };
  const next = () => {
    if (n >= todo.length || transCancelled) return n ? finish() : end();
    const k = todo[n], s = P.sources[k];
    if (s.hasAudio === false){ s.tr = true; s.noAudio = true; n++; return next(); }
    const label = todo.length > 1 ? `Video ${n + 1} von ${todo.length}: ` : '';
    try { transJob = TS.transcribe(s.uri, model, lang, fillers); } catch(e){ end(); $('#transMsg').textContent = 'Fehler: ' + e.message; return; }
    watchJob(transJob, j => { $('#transProg i').style.width = ((n + j.progress) / todo.length * 100).toFixed(1) + '%'; $('#transMsg').textContent = label + (j.message || ''); },
      j => { const r = j.result || {}; if (r.env) s.env = r.env; if (r.lang && !P.language) P.language = r.lang;
             appendSourceTokens(k, r.words || []); words += (r.words || []).length; n++; saveNow(); next(); },
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
  if (!order.length && tokens.length) computeOrder();
  let para = -1, pEl = null, fillers = 0, src = -1, prev = -2; const frag = document.createDocumentFragment();
  for (const i of order){
    const t = tokens[i];
    if (t.src !== src && P.sources.length > 1){ src = t.src; const h = document.createElement('div'); h.className = 'src-head'; h.textContent = `🎞 ${src + 1} · ${P.sources[src].name}`; frag.append(h); pEl = null; }
    const jump = prev >= 0 && i !== prev + 1;
    if (t.p !== para || !pEl || jump){ pEl = document.createElement('p'); para = t.p;
      if (jump) pEl.classList.add('moved');
      const ts = document.createElement('span'); ts.className = 'ts'; ts.textContent = (jump ? '↕ ' : '') + fmtT(t.ws ?? t.s); pEl.append(ts); frag.append(pEl); }
    const sp = document.createElement('span'); sp.dataset.i = t.i;
    if (t.type === 'word'){ sp.className = 'tk word' + (t.pr < 0.5 ? ' low' : ''); if (FILLER.test(norm(tokText(t)))){ sp.classList.add('filler'); fillers++; } }
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
  if (t.type === 'pause'){ const d = (t.e - t.s).toFixed(1).replace('.', ','), tr = P.trims[i];
    sp.classList.toggle('trim', tr != null && !deleted.has(i)); sp.textContent = tr != null ? `⏸ ${d}→${String(tr).replace('.', ',')}` : `⏸ ${d}`; }
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
$('#selClose').onclick = clearSel;
$('#selDel').onclick = () => {
  const ids = selIds(); if (!ids.length) return;
  const gone = i => deleted.has(i) || (tokens[i].type === 'word' && isSrcDeleted((tokens[i].ws + tokens[i].we) / 2));
  const restoreIt = ids.every(gone);
  commit(() => { ids.forEach(i => { if (restoreIt){ deleted.delete(i); removeDel(tokens[i].s, tokens[i].e); } else deleted.add(i); });
    if (!restoreIt) tidyPauses(ids).forEach(i => deleted.add(i)); }, false);
  tokens.forEach(t => paint(t.i));
  const at = tokens[ids[0]]; clearSel(); toast(restoreIt ? 'Wiederhergestellt' : 'Gelöscht');
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
    const keptWord = i => !gone(i) && tokens[i].type === 'word';
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
  const raw = ws.map(t => tokText(t)), W = raw.map(norm), fill = W.map(w => FILLER.test(w) || !w);
  const same = (a, b) => W[a] === W[b] || (/[-–…]$/.test(raw[a]) && W[a].length >= 2 && W[b].startsWith(W[a]));
  const out = []; let i = 0;
  while (i < ws.length){
    let found = null;
    if (!fill[i]) for (let j = i + 1; j < ws.length && j <= i + 30; j++){
      if (ws[j].src !== ws[i].src || ws[j].ws - ws[i].ws > 12) break;
      if (!same(i, j)) continue;
      let end = j - 1; while (end > i && fill[end]) end--;
      const att = []; for (let k = i; k <= end; k++) if (!fill[k]) att.push(k);
      let m = 0; while (m < att.length && j + m < ws.length && same(att[m], j + m)) m++;
      const last = raw[end], n = att.length;
      let ok;
      if (n === 1) ok = m >= 1 && !KEEP_REPEAT.has(W[i]) && !/[.?!…]$/.test(last);
      else if (/[.?!…,;:]$/.test(last)) ok = m === n;
      else ok = m >= Math.max(2, n - 1);
      if (ok){ found = j; break; }
    }
    if (found != null){ for (let k = i; k < found; k++) out.push(ws[k].i); i = found; } else i++;
  }
  return out;
}
$('#repeatBtn').onclick = () => {
  const ids = findRepeats(0); if (!ids.length) return toast('Keine Wiederholungen gefunden');
  commit(() => bulkDelete(ids), false); tokens.forEach(t => paint(t.i));
  toast(`${ids.filter(isWord).length} Wörter aus wiederholten Anläufen gelöscht – Strg+Z macht es rückgängig`);
};
// Einstellungen „direkt nach der Transkription“ merken (nur für diesen Browser)
const AUTO_KEYS = ['autoFillers', 'autoRepeats', 'autoPauses', 'autoPauseLen'];
try { const a = J(localStorage.getItem('ts-auto')); if (a) AUTO_KEYS.forEach(k => { const el = $('#' + k); if (el && a[k] != null){ if (el.type === 'checkbox') el.checked = a[k]; else el.value = a[k]; } }); } catch(_){}
AUTO_KEYS.forEach(k => $('#' + k).addEventListener('change', () => { try { localStorage.setItem('ts-auto', JSON.stringify(Object.fromEntries(AUTO_KEYS.map(x => [x, $('#' + x).type === 'checkbox' ? $('#' + x).checked : $('#' + x).value])))); } catch(_){} }));
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

// ───────── Untertitel ─────────
const S = () => P.sub_style;
const isWord = i => tokens[i] && tokens[i].type === 'word';
function cueWords(c){ const ids = []; for (let i = c.a; i <= c.b && i < tokens.length; i++) if (isWord(i) && tokText(tokens[i]) && !deleted.has(i) && !isSrcDeleted((tokens[i].ws + tokens[i].we) / 2)) ids.push(i); return ids; }
function autoText(c){ return cueWords(c).map(i => tokText(tokens[i])).join(' '); }
function cueText(c){ return c.text != null ? c.text : autoText(c); }
// Untertitel erzeugen – ab Token startTok (beim Anhängen weiterer Videos), sonst alle neu
function genCues(startTok = 0){
  const st = S(), keep = startTok ? P.cues.filter(c => c.a < startTok) : [];
  const ws = tokens.filter(t => t.i >= startTok && t.type === 'word' && !deleted.has(t.i));
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
  P.cues = keep.concat(out);
}
function wrapText(text){
  const st = S(), max = +st.chars || 32, lines = +st.lines || 2;
  text = text.replace(/[ \t]+/g, ' ').trim();
  if (text.includes('\n') || st.mode === 'word' || lines < 2 || text.length <= max) return text;
  const mid = text.length / 2; let best = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? text : text.slice(0, best) + '\n' + text.slice(best + 1);
}
function cueTimes(c){
  const ids = cueWords(c); if (!ids.length) return null;
  const w0 = tokens[ids[0]], w1 = tokens[ids[ids.length-1]];
  let s = srcToOut(w0.ws) + (c.ds || 0), e = srcToOut(w1.we) + (c.de || 0);
  if (e < s || e - s > (w1.we - w0.ws) + 0.5){ const g = timeline[segAtOut(s - (c.ds || 0))]; e = (g ? g.o + g.out - g.in : s + 1) + (c.de || 0); }
  for (const g of timeline) if (g.kind === 'insert' && s < g.o && e > g.o) e = g.o;   // nicht in einen Einschub hineinlaufen
  return {s: Math.max(0, s), e: Math.max(s + 0.2, e), src: tokens[ids[0]].ws};
}
const cueXY = c => c && c.x != null ? [c.x, c.y] : [S().x ?? 0.5, S().y ?? 0.88];
function computedCues(){
  const list = [];
  for (const c of P.cues){
    if (c.off) continue;
    // Automatischer Text: an Stellen teilen, an denen die Wörter im Ergebnis nicht mehr aufeinanderfolgen (verschobene Abschnitte)
    if (c.text == null && P.moves.length){
      const ids = cueWords(c); let run = [];
      const flush = () => { if (!run.length) return; const w0 = tokens[run[0]], w1 = tokens[run[run.length-1]];
        const s = srcToOut(w0.ws) + (c.ds || 0), e = Math.max(s + 0.2, srcToOut(w1.we) + (c.de || 0));
        list.push({c, s: Math.max(0, s), e, text: run.map(i => tokText(tokens[i])).join(' ')}); run = []; };
      ids.forEach((i, k) => { if (k){ const p = tokens[ids[k-1]], w = tokens[i];
        if (Math.abs((srcToOut(w.ws) - srcToOut(p.we)) - (w.ws - p.we)) > 0.3) flush(); } run.push(i); });
      flush(); continue;
    }
    const t = cueTimes(c), text = cueText(c).trim(); if (!t || !text) continue; list.push({c, s:t.s, e:t.e, text}); }
  list.sort((x, y) => x.s - y.s);
  for (let k = 0; k < list.length; k++){ const n = list[k+1];
    if (n){ if (list[k].e > n.s - 0.02) list[k].e = Math.max(list[k].s + 0.2, n.s - 0.02); else if (n.s - list[k].e < 0.3) list[k].e = n.s - 0.02; }
    list[k].e = Math.min(list[k].e, total); }
  return list;
}
let cueCache = {at:-1, list:[]}, cueEls = new Map(), lastCue = null, shownCue = null;
function updateSubs(o){
  const ov = $('#subOv');
  if (!P || !tokens.length || S().enabled === false){ ov.textContent = ''; shownCue = null; return; }
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
  ov.style.color = st.color; ov.style.fontSize = px.toFixed(1) + 'px';
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
function manualCount(){ return P.cues.filter(c => c.text != null || c.ds || c.de || c.off || c.x != null).length; }
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
      <button data-a="auto" class="hidden">↺ auto</button><button data-a="pos" class="hidden">↺ Position</button><button data-a="s-">Start −</button><button data-a="s+">Start +</button><button data-a="e-">Ende −</button><button data-a="e+">Ende +</button></div>`;
    if (idx === P.cues.length - 1) el.querySelector('[data-a=merge]').disabled = true;
    const ta = el.querySelector('textarea'); ta.value = cueText(c);
    ta.addEventListener('focus', () => ta._b = snapshot());
    ta.addEventListener('input', () => { c.text = ta.value.trim() === autoText(c) ? null : ta.value; paintCue(c, true); cueCache.at = -1; clearTimeout(saveT); saveT = setTimeout(saveNow, 800); });
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
  el.querySelector('.w').textContent = [(c.ds || c.de) ? `Start ${c.ds >= 0 ? '+' : ''}${(c.ds||0).toFixed(1)} · Ende ${c.de >= 0 ? '+' : ''}${(c.de||0).toFixed(1)}` : '', c.x != null ? 'eigene Position' : ''].filter(Boolean).join(' · ');
  el.querySelector('[data-a=off]').textContent = c.off ? 'einblenden' : 'ausblenden';
  el.querySelector('[data-a=auto]').classList.toggle('hidden', c.text == null);
  el.querySelector('[data-a=pos]').classList.toggle('hidden', c.x == null);
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
  if (a === 'split'){
    const ids = cueWords(c); if (ids.length < 2) return toast('Zu wenige Wörter');
    const text = ta.value, pos = ta.selectionStart ?? 0, left = text.slice(0, pos).trim(), right = text.slice(pos).trim();
    if (!left || !right) return toast('Erst den Cursor an die Teilungsstelle setzen');
    const k = Math.min(ids.length - 1, Math.max(1, left.split(/\s+/).length)), manual = c.text != null;
    commit(() => { const c2 = {id:newId(), a:ids[k-1] + 1, b:c.b, text: manual ? right : null, ds:0, de:c.de || 0, off:c.off, ...(c.x != null ? {x:c.x, y:c.y} : {})};
      c.b = ids[k-1]; c.text = manual ? left : null; c.de = 0; P.cues.splice(idx + 1, 0, c2); });
  } else if (a === 'merge'){
    const n = P.cues[idx+1]; if (!n) return;
    commit(() => { const manual = c.text != null || n.text != null; c.text = manual ? (cueText(c) + ' ' + cueText(n)).trim() : null; c.b = n.b; c.de = n.de || 0; c.off = c.off && n.off; P.cues.splice(idx + 1, 1); });
  } else if (a === 'off'){ commit(() => c.off = !c.off, false); paintCue(c); }
  else if (a === 'auto'){ commit(() => c.text = null, false); paintCue(c); }
  else if (a === 'pos'){ commit(() => { delete c.x; delete c.y; }, false); paintCue(c); placeOverlay(); }
  else { const key = a[0] === 's' ? 'ds' : 'de', d = a[1] === '+' ? 0.1 : -0.1; commit(() => c[key] = Math.round(((c[key] || 0) + d) * 10) / 10, false); paintCue(c); }
  cueCache.at = -1;
});

// ───────── Elemente (Clips, Zoom) ─────────
const TYPE_LBL = {broll:'B-Roll', insert:'Einschub', pip:'Bild-im-Bild', zoom:'Zoom'};
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
      <div class="field"><span>Art</span><div class="seg-ctl" id="cMode"><button data-v="broll">B-Roll</button><button data-v="insert">Einschub</button><button data-v="pip">Bild-im-Bild</button></div></div>
      <div class="muted small" id="cName"></div>
      <video id="cPrev" playsinline controls preload="auto"></video>
      <div class="field"><span>Ausschnitt aus dem Clip</span>
        <div class="nudge"><span style="min-width:56px">Anfang</span><button data-cin="-0.5">−0,5</button><button data-cin="-0.04">−F</button><span class="val" id="cIn"></span><button data-cin="0.04">+F</button><button data-cin="0.5">+0,5</button><button class="btn" id="cInHere">= hier</button></div>
        <div class="nudge"><span style="min-width:56px">Ende</span><button data-cout="-0.5">−0,5</button><button data-cout="-0.04">−F</button><span class="val" id="cOut"></span><button data-cout="0.04">+F</button><button data-cout="0.5">+0,5</button><button class="btn" id="cOutHere">= hier</button></div>
      </div>
      <div class="field"><span>Position im Video</span><div class="nudge"><button data-at="-0.5">−0,5</button><button data-at="-0.1">−0,1</button><span class="val" id="cAt"></span><button data-at="0.1">+0,1</button><button data-at="0.5">+0,5</button></div></div>
      <div class="field pipopt"><span>Ecke</span><div class="seg-ctl" id="cCorner"><button data-v="ol">↖</button><button data-v="or">↗</button><button data-v="ul">↙</button><button data-v="ur">↘</button></div></div>
      <div class="field pipopt"><span>Größe</span><div class="seg-ctl" id="cSize"><button data-v="0.25">klein</button><button data-v="0.33">mittel</button><button data-v="0.45">groß</button></div></div>`);
  }
  body.insertAdjacentHTML('beforeend', `<div class="row" style="margin-top:12px"><button class="btn" id="itPlay">▶ Ansehen</button><button class="btn danger" id="itDel">Entfernen</button><button class="btn primary" id="itOk" style="margin-left:auto">Fertig</button></div>`);
  pinMode = it.type === 'zoom'; $('#stageHint').classList.toggle('hidden', !pinMode);
  openSheet(pinMode);
  if (it.type !== 'zoom'){ const pv = $('#cPrev'); if (isImg(it.clip)){ pv.outerHTML = `<img id="cPrev" src="${MEDIA(it.clip.uri)}" style="width:100%;max-height:22vh;object-fit:contain;background:#000;border-radius:8px">`; } else { pv.src = MEDIA(it.clip.uri); pv.addEventListener('loadedmetadata', () => pv.currentTime = it.in, {once:true}); } }
  paintItem();
  body.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const seg = b.closest('.seg-ctl');
    if (seg){ const v = b.dataset.v;
      commit(() => { if (seg.id === 'zKind') it.kind = v; if (seg.id === 'cMode'){ it.type = v; if (v === 'insert') it.out = Math.max(it.out, Math.min(it.clip.duration, it.in + 1)); }
        if (seg.id === 'cCorner') it.corner = v; if (seg.id === 'cSize') it.size = +v; }, false); h.textContent = TYPE_LBL[it.type]; paintItem(); return; }
    if (b.dataset.z){ commit(() => it.dur = clamp(+(it.dur + +b.dataset.z).toFixed(2), 0.2, 60), false); }
    else if (b.dataset.at){ commit(() => it.at = clamp(r3(it.at + +b.dataset.at), 0, srcTotal), false); seekOut(srcToOut(snapSrc(it.at)), false); }
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
    b.classList.toggle('on', (id === 'zKind' && it.kind === v) || (id === 'cMode' && it.type === v) || (id === 'cCorner' && it.corner === v) || (id === 'cSize' && Math.abs(it.size - v) < 0.001)); });
  if (it.type === 'zoom'){ $('#zStr').value = it.strength; $('#zStrV').textContent = it.strength.toFixed(2).replace('.', ',') + '×'; $('#zDur').textContent = it.dur.toFixed(1).replace('.', ',') + ' s'; $('#zAt').textContent = fmtS(srcToOut(snapSrc(it.at)));
    const pin = $('#pin'); pin.classList.remove('hidden'); pin.style.left = it.cx * 100 + '%'; pin.style.top = it.cy * 100 + '%'; }
  else { $('#cName').textContent = isImg(it.clip) ? `${it.clip.name} · Foto, Länge frei wählbar` : `${it.clip.name} · ${fmtS(it.clip.duration)}`; $('#cIn').textContent = fmtS(it.in); $('#cOut').textContent = fmtS(it.out); $('#cAt').textContent = fmtS(srcToOut(snapSrc(it.at)));
    $$('.pipopt').forEach(x => x.classList.toggle('hidden', it.type !== 'pip')); $('#cInHere').classList.toggle('hidden', isImg(it.clip)); $('#cOutHere').classList.toggle('hidden', isImg(it.clip)); }
  updateZoomPreview();
}
function updateZoomPreview(){ if (sheetItem && sheetItem.type === 'zoom' && !playing){ const z = sheetItem; V.style.transformOrigin = `${z.cx * 100}% ${z.cy * 100}%`; V.style.transform = `scale(${z.kind === 'in' ? 1 : z.strength})`; } }
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
  $('#exNote').textContent = CAP.platform === 'android' ? 'Das Video landet direkt in deiner Galerie (Ordner „Textschnitt“). Bitte die App während des Exports geöffnet lassen.'
    : 'Die Dateien landen im Ordner „…_textschnitt“ neben deinem ersten Video. Untertitel kommen zusätzlich als SRT-Datei mit.';
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
    if (g.kind === 'insert') return {kind:'insert', uri:g.uri, in:r3(g.in), out:r3(g.out), image: isImg(g.item.clip), hasAudio: g.item.clip.hasAudio !== false && !isImg(g.item.clip), hasVideo:true};
    const s = P.sources[g.si], off = s.off;
    const zs = P.items.filter(z => z.type === 'zoom' && z.at < g.out && z.at + z.dur > g.in)
      .map(z => ({at:r3(z.at - off), dur:z.dur, kind:z.kind, strength:z.strength, cx:z.cx, cy:z.cy}));
    return {kind:'main', src:g.si, uri:s.uri, in:r3(g.in - off), out:r3(g.out - off), zooms:zs, hasAudio: s.hasAudio !== false, hasVideo: hasVid(s)};
  });
  const ovs = overlays.map(o => ({mode:o.x.type, image: isImg(o.x.clip), uri:o.x.clip.uri, in:o.x.in, out:r3(o.x.in + (o.end - o.at)), at:r3(o.at), corner:o.x.corner || 'or', size:o.x.size || 0.33,
    width:o.x.clip.width, height:o.x.clip.height, rotation:o.x.clip.rotation || 0}));
  const subs = S().enabled !== false && tokens.length ? {cues: computedCues().map(x => { const [cx, cy] = cueXY(x.c); return {start:r3(x.s), end:r3(x.e), text:wrapText(x.text), x:cx, y:cy}; }), style:S()} : null;
  const media = P.sources.map(s => ({uri:s.uri, name:s.name, duration:s.duration, width:s.width, height:s.height, fps:s.fps, hasAudio:s.hasAudio !== false, hasVideo:hasVid(s), kind:s.kind || 'video'}));
  return {format:exFmt, name: ($('#exName').value || P.name).replace(/[\\/:*?"<>|]/g, '_'), width:W, height:H, fps:primary().fps || 30, total:r3(total),
    segments:segs, overlays:ovs, subs, burn: P.settings.burn !== false, quality: $('#exQuality').value, audioFormat: $('#exAudioFmt').value,
    capcutInstall: $('#exCapcutInstall').checked, sources:media, project:P.id};
}
function renderExport(){
  const [W, H] = outSize(), n = P.items.reduce((m, x) => (m[x.type] = (m[x.type] || 0) + 1, m), {});
  $('#exSummary').textContent = `${fmtT(total)}${exFmt === 'audio' ? '' : ` · ${W}×${H}`} · ${timeline.filter(g => g.kind === 'main').length} Abschnitte` + (P.sources.length > 1 ? ` aus ${P.sources.length} Videos` : '') +
    (n.insert ? ` · ${n.insert} Einschub` : '') + (n.broll ? ` · ${n.broll} B-Roll` : '') + (n.pip ? ` · ${n.pip} Bild-im-Bild` : '') + (n.zoom ? ` · ${n.zoom} Zoom` : '') +
    (S().enabled !== false && tokens.length ? ` · ${computedCues().length} Untertitel` : '');
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
      if (CAP.platform === 'android'){ $('#exMsg').textContent = 'Fertig – das Video ist in deiner Galerie (Ordner „Textschnitt“).'; }
      else { $('#exMsg').textContent = exResult.note || 'Fertig.'; $('#exFiles').textContent = (exResult.files || []).join('\n'); }
      $('#exOpen').classList.toggle('hidden', CAP.platform !== 'android' && !exResult.playable); },
    j => { end(); $('#exMsg').textContent = j.status === 'cancelled' ? 'Abgebrochen.' : ('Fehler: ' + (j.error || 'unbekannt')); });
};
$('#exCancel').onclick = () => exJob && TS.cancel(exJob);
$('#exShare').onclick = () => exResult && TS.share(exResult.uri || exResult.folder || (exResult.files || [])[0]);
$('#exOpen').onclick = () => exResult && TS.view(exResult.uri || exResult.playable);
if (CAP.platform !== 'android'){ $('#exShare').textContent = 'Im Ordner zeigen'; $('#exOpen').textContent = 'Abspielen'; }

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
  const t = b.dataset.tab; if (!tokens.length && t !== 'studio' && t !== 'export') return setTab('trans'); setTab(t); });
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

showHome();
(() => { const h = new URLSearchParams(location.hash.slice(1)); const p = h.get('p');
  if (p){ openProject(p); if (P && h.get('view')) setTab(h.get('view')); document.body.classList.add('solo'); } })();
