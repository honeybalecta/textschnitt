'use strict';
/* Textschnitt für Android – Oberfläche. Die native Seite ist über window.TS erreichbar. */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const TS = window.TS;
const MEDIA = uri => 'https://ts.app/media?u=' + encodeURIComponent(uri);

const fmtT = t => { t = Math.max(0, t || 0); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = Math.floor(t % 60);
  return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); };
const fmtS = t => { t = Math.max(0, t || 0); const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + s.toFixed(1).padStart(4, '0').replace('.', ','); };
const norm = w => w.toLowerCase().replace(/[.,!?;:…"„“”‚‘’'()\-–—]/g, '');
const FILLER = /^(ä+h*m*|ä+m+|ö+h*m*|ö+m+|e+h+m*|e+m+|h+m+|mh+m+|m+h*m+|u+h+m*|uu+m+|erm|a+h+m+)$/i;
const newId = () => Math.random().toString(36).slice(2, 10);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 2400); }
const J = s => { try { return JSON.parse(s); } catch(e){ return null; } };

// ───────── Brücke zur App ─────────
const pending = new Map();
window.TSApp = {
  onPicked(reqId, json){ const cb = pending.get(reqId); pending.delete(reqId); if (cb) cb(json ? J(json) : null); },
  onBack(){ if (!$('#sheet').classList.contains('hidden')) { closeSheet(); return true; }
            if (!$('#modelSheet').classList.contains('hidden')) { $('#modelSheet').classList.add('hidden'); $('#sheetBack').classList.add('hidden'); return true; }
            if (!$('#proj').classList.contains('hidden')) { closeProject(); return true; } return false; },
  onPause(){ if (P) { pausePlay(); saveNow(); } }
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

// ───────── Zustand ─────────
let P = null;                    // aktuelles Projekt
let tokens = [], spans = [], deleted = new Set();
let ranges = [], rangeToks = [], timeline = [], total = 0, overlays = [];
let undo = [], redo = [], saveT = null;
let tab = 'text';
const DEF_STYLE = {enabled:true, mode:'lines', chars:32, lines:2, dur:4, size:'mittel', pos:'unten', color:'#FFFFFF', outline:true};

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
    el.querySelector('span').textContent = `${fmtT(p.duration)} · ${p.transcribed ? 'transkribiert' : 'noch nicht transkribiert'} · ${new Date(p.updated).toLocaleDateString('de-DE')}`;
    el.onclick = e => { if (e.target.closest('.del')) return; openProject(p.id); };
    el.querySelector('.del').onclick = () => { if (confirm(`„${p.name}“ löschen? Dein Video bleibt in der Galerie.`)) { TS.deleteProject(p.id); showHome(); } };
    box.append(el);
  });
}
$('#newProj').onclick = async () => {
  const m = await pickMedia('video'); if (!m) return;
  if (!m.hasAudio) return toast('Dieses Video hat keine Tonspur.');
  const p = {id:newId(), name:m.name.replace(/\.[^.]+$/, ''), created:Date.now(), updated:Date.now(), main:m,
             tokens:[], deleted:[], trims:{}, adj:{}, settings:{pad:0.06}, cues:[], sub_style:{...DEF_STYLE}, items:[]};
  TS.saveProject(p.id, JSON.stringify(p)); openProject(p.id);
};

// ───────── Projekt öffnen ─────────
function openProject(id){
  P = J(TS.loadProject(id)); if (!P) return toast('Projekt konnte nicht geladen werden');
  P.adj ||= {}; P.items ||= []; P.trims ||= {}; P.settings ||= {pad:0.06}; P.cues ||= []; P.sub_style = {...DEF_STYLE, ...(P.sub_style || {})};
  tokens = P.tokens || []; deleted = new Set(P.deleted || []); undo = []; redo = [];
  $('#home').classList.add('hidden'); $('#proj').classList.remove('hidden');
  $('#projName').textContent = P.name; $('#exName').value = P.name + '_geschnitten';
  const [w, h] = dispSize(P.main); $('#stage').style.aspectRatio = `${w} / ${h}`;
  $('#v').src = MEDIA(P.main.uri);
  fillModels();
  syncStyleInputs();
  if (tokens.length){ renderTranscript(); if (!P.cues.length) genCues(); }
  recompute();
  setTab(tokens.length ? 'text' : 'trans');
}
function closeProject(){ pausePlay(); saveNow(); P = null; $('#v').removeAttribute('src'); $('#v').load(); hideOverlay(); showHome(); }
$('#backBtn').onclick = closeProject;
function dispSize(m){ const r = Math.abs(m.rotation || 0) % 180 === 90; return r ? [m.height, m.width] : [m.width, m.height]; }

// ───────── Speichern & Rückgängig ─────────
function snapshot(){ return JSON.stringify({d:[...deleted], t:P.trims, c:P.cues, i:P.items, a:P.adj}); }
function restore(s){ const o = JSON.parse(s); deleted = new Set(o.d); P.trims = o.t; P.cues = o.c; P.items = o.i; P.adj = o.a; tokens.forEach(t => paint(t.i)); changed(true); }
function commit(fn, rerender = true){ undo.push(snapshot()); if (undo.length > 200) undo.shift(); redo = []; fn(); changed(rerender); }
$('#undoBtn').onclick = () => { if (!undo.length || !P) return; redo.push(snapshot()); restore(undo.pop()); };
$('#redoBtn').onclick = () => { if (!redo.length || !P) return; undo.push(snapshot()); restore(redo.pop()); };
function changed(rerender = true){
  recompute();
  if (rerender){ if (tab === 'subs') renderSubs(); if (tab === 'studio') renderStudio(); }
  else if (tab === 'subs') updateSubsList();
  cueCache.at = -1;
  if (tab === 'export') renderExport();
  clearTimeout(saveT); $('#saved').textContent = '…'; saveT = setTimeout(saveNow, 700);
}
function saveNow(){
  if (!P) return; clearTimeout(saveT);
  P.tokens = tokens; P.deleted = [...deleted]; P.updated = Date.now();
  try { TS.saveProject(P.id, JSON.stringify(P)); $('#saved').textContent = '✓'; } catch(e){ $('#saved').textContent = '!'; }
}

// ───────── Wörter → Tokens (wie Desktop) ─────────
function buildTokens(words, duration){
  const PAUSE_MIN = 0.45, PARA_GAP = 1.2, PARA_MAX = 55;
  const out = []; let cursor = 0, para = 0, paraWords = 0;
  // Satzzeichen, die whisper.cpp als eigenes „Wort“ liefert, an das vorige Wort hängen
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
    if (gap >= PAUSE_MIN){ out.push({type:'pause', text:'', s:+cursor.toFixed(3), e:+ws.toFixed(3), p:para}); regionStart = ws; }
    else if (out.length){ out[out.length-1].e = +ws.toFixed(3); regionStart = ws; }
    else regionStart = 0;
    if (newPara){ para++; paraWords = 0; }
    out.push({type:'word', text:w.text, s:+regionStart.toFixed(3), e:+we.toFixed(3), ws:+ws.toFixed(3), we:+we.toFixed(3), pr:+(w.prob ?? 1).toFixed(2), p:para});
    paraWords++; cursor = we;
  }
  if (duration > cursor){
    if (duration - cursor >= PAUSE_MIN || !out.length) out.push({type:'pause', text:'', s:+cursor.toFixed(3), e:+duration.toFixed(3), p:para});
    else out[out.length-1].e = +duration.toFixed(3);
  }
  out.forEach((t, i) => t.i = i);
  return out;
}

// ───────── Schnitt & Zeitleiste ─────────
function computeRanges(){
  const dur = P.main.duration;
  const raw = []; // [s, e, firstTok, lastTok]
  const push = (s, e, i) => { if (e - s <= 0.0005) return; const l = raw[raw.length-1];
    if (l && s - l[1] < 0.001){ l[1] = Math.max(l[1], e); l[3] = i; } else raw.push([s, e, i, i]); };
  for (const t of tokens){
    if (deleted.has(t.i)) continue;
    const tr = P.trims[t.i];
    if (t.type === 'pause' && tr != null && tr < t.e - t.s){ const h = tr / 2; push(t.s, t.s + h, t.i); push(t.e - h, t.e, t.i); }
    else push(t.s, t.e, t.i);
  }
  if (!tokens.length) raw.push([0, dur, -1, -1]);
  const pad = P.settings.pad || 0, out = [], toks = [];
  for (let k = 0; k < raw.length; k++){
    const prevEnd = k ? raw[k-1][1] : 0, nextStart = k < raw.length - 1 ? raw[k+1][0] : dur;
    let s = raw[k][0] - Math.min(pad, k ? (raw[k][0] - prevEnd) / 2 : raw[k][0]);
    let e = raw[k][1] + Math.min(pad, k < raw.length - 1 ? (nextStart - raw[k][1]) / 2 : Math.max(0, nextStart - raw[k][1]));
    s += P.adj['s' + raw[k][2]] || 0; e += P.adj['e' + raw[k][3]] || 0;    // Feinschnitt
    s = clamp(s, 0, dur); e = clamp(e, 0, dur);
    const l = out[out.length-1];
    if (l && s - l[1] < 0.02){ l[1] = Math.max(l[1], e); toks[toks.length-1][1] = raw[k][3]; }
    else if (e - s >= 0.05){ out.push([s, e]); toks.push([raw[k][2], raw[k][3]]); }
  }
  ranges = out.map(r => [+r[0].toFixed(3), +r[1].toFixed(3)]); rangeToks = toks;
}
// Anker (Quellzeit) auf die nächste behaltene Stelle schieben
function snapSrc(t){
  for (const [s, e] of ranges){ if (t < s) return s; if (t <= e) return t; }
  return ranges.length ? ranges[ranges.length-1][1] : 0;
}
function buildTimeline(){
  const ins = P.items.filter(x => x.type === 'insert').map(x => ({x, a: snapSrc(x.at)})).sort((p, q) => p.a - q.a);
  const segs = []; let o = 0, k = 0;
  const pushIns = it => { const d = Math.max(0.1, it.x.out - it.x.in); segs.push({kind:'insert', item:it.x, uri:it.x.clip.uri, in:it.x.in, out:it.x.in + d, o}); o += d; };
  for (let ri = 0; ri < ranges.length; ri++){
    let [s, e] = ranges[ri];
    while (k < ins.length && ins[k].a <= s + 1e-6){ pushIns(ins[k]); k++; }
    while (k < ins.length && ins[k].a < e - 1e-6){
      if (ins[k].a - s > 0.02){ segs.push({kind:'main', in:s, out:ins[k].a, o}); o += ins[k].a - s; s = ins[k].a; }
      pushIns(ins[k]); k++;
    }
    if (e - s > 0.001){ segs.push({kind:'main', in:s, out:e, o}); o += e - s; }
  }
  while (k < ins.length){ pushIns(ins[k]); k++; }
  timeline = segs; total = o;
}
function srcToOut(t){
  for (const g of timeline){ if (g.kind !== 'main') continue; if (t < g.in - 1e-6) return g.o; if (t <= g.out + 1e-6) return g.o + (t - g.in); }
  return total;
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
  computeRanges(); buildTimeline(); computeOverlays(); drawScrub();
  $('#tTot').textContent = fmtT(total);
}
function drawScrub(){
  const box = $('#segs'); box.innerHTML = ''; if (!total) return;
  const pct = x => (x / total * 100) + '%';
  for (const g of timeline){ const d = document.createElement('div'); d.className = 's ' + g.kind; d.style.left = pct(g.o); d.style.width = `calc(${pct(g.out - g.in)} - 1px)`; box.append(d); }
  for (const o of overlays){ const d = document.createElement('div'); d.className = 'ovl'; d.style.left = pct(o.at); d.style.width = pct(o.end - o.at); box.append(d); }
  for (const z of P.items.filter(x => x.type === 'zoom')){ const a = srcToOut(snapSrc(z.at)), b = srcToOut(snapSrc(z.at + z.dur)); const d = document.createElement('div'); d.className = 'zm'; d.style.left = pct(a); d.style.width = pct(Math.max(0.2, b - a)); box.append(d); }
}

// ───────── Wiedergabe ─────────
const V = $('#v'), OV = $('#ov'), IV = $('#iv');
let playing = false, curSeg = 0, outPos = 0, stopAt = null;
function curOut(){
  const g = timeline[curSeg]; if (!g) return 0;
  const el = g.kind === 'main' ? V : IV;
  return g.o + clamp(el.currentTime - g.in, 0, g.out - g.in);
}
function curSrc(){ const g = timeline[curSeg]; return g && g.kind === 'main' ? V.currentTime : (g ? snapSrc(g.item.at) : 0); }
function seekOut(o, keepPlaying = playing){
  if (!timeline.length) return;
  o = clamp(o, 0, Math.max(0, total - 0.01)); curSeg = segAtOut(o); outPos = o;
  const g = timeline[curSeg], local = g.in + (o - g.o);
  if (g.kind === 'main'){
    IV.pause(); IV.classList.add('hidden');
    V.currentTime = local; if (keepPlaying) V.play().catch(() => {});
  } else {
    V.pause();
    const url = MEDIA(g.uri); if (IV.dataset.src !== url){ IV.src = url; IV.dataset.src = url; }
    IV.classList.remove('hidden'); IV.currentTime = local; if (keepPlaying) IV.play().catch(() => {});
  }
  updateOverlay(o); updateZoom(); updateSubs(o); updateHead(o);
}
function togglePlay(){ playing ? pausePlay() : startPlay(); }
function startPlay(){
  if (!timeline.length) return; if (outPos >= total - 0.05) seekOut(0, false);
  playing = true; $('#playBtn').textContent = '❚❚'; seekOut(outPos, true); TS.keepAwake(true);
}
function pausePlay(){ playing = false; stopAt = null; V.pause(); IV.pause(); OV.pause(); $('#playBtn').textContent = '▶'; TS.keepAwake(false); }
$('#playBtn').onclick = togglePlay;
function loop(){
  if (P && timeline.length){
    if (playing){
      const g = timeline[curSeg], el = g.kind === 'main' ? V : IV;
      if (el.currentTime >= g.out - 0.03 || el.ended){
        if (curSeg + 1 < timeline.length) seekOut(timeline[curSeg + 1].o, true); else { pausePlay(); outPos = total; }
      }
      outPos = curOut();
      if (stopAt != null && outPos >= stopAt) pausePlay();
      updateOverlay(outPos); updateZoom(); updateSubs(outPos); updateHead(outPos); highlightNow();
    }
  }
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
function updateHead(o){ $('#head').style.left = (total ? o / total * 100 : 0) + '%'; $('#tNow').textContent = fmtT(o); $('#atLbl').textContent = '@ ' + fmtS(o); }
function updateOverlay(o){
  const a = overlays.find(x => o >= x.at && o < x.end);
  if (!a){ hideOverlay(); return; }
  const url = MEDIA(a.x.clip.uri); if (OV.dataset.src !== url){ OV.src = url; OV.dataset.src = url; }
  OV.classList.remove('hidden');
  const pip = a.x.type === 'pip'; OV.classList.toggle('pip', pip);
  if (pip){ const sz = (a.x.size || 0.33) * 100, m = 3; const c = a.x.corner || 'or';
    Object.assign(OV.style, {width: sz + '%', height: sz + '%', left: c[1] === 'l' ? m + '%' : '', right: c[1] === 'r' ? m + '%' : '', top: c[0] === 'o' ? m + '%' : '', bottom: c[0] === 'u' ? m + '%' : ''}); }
  else Object.assign(OV.style, {width:'', height:'', left:'', right:'', top:'', bottom:''});
  const target = a.x.in + (o - a.at);
  if (Math.abs(OV.currentTime - target) > (playing ? 0.3 : 0.05)) OV.currentTime = target;
  if (playing && OV.paused) OV.play().catch(() => {}); if (!playing && !OV.paused) OV.pause();
}
function hideOverlay(){ if (!OV.classList.contains('hidden')){ OV.pause(); OV.classList.add('hidden'); } }
function updateZoom(){
  const g = timeline[curSeg];
  if (!g || g.kind !== 'main'){ V.style.transform = ''; return; }
  const z = zoomAt(V.currentTime);
  V.style.transformOrigin = `${z.cx * 100}% ${z.cy * 100}%`; V.style.transform = z.s > 1.001 ? `scale(${z.s})` : '';
}
// Scrubben
(() => { const sc = $('#scrub');
  const at = e => { const b = sc.getBoundingClientRect(); return clamp((e.clientX - b.left) / b.width, 0, 1) * total; };
  sc.addEventListener('pointerdown', e => { sc.setPointerCapture(e.pointerId); const was = playing; if (was) pausePlay(); seekOut(at(e), false);
    sc.onpointermove = ev => seekOut(at(ev), false); sc.onpointerup = () => { sc.onpointermove = null; if (was) startPlay(); }; });
})();
V.addEventListener('loadedmetadata', () => { if (!timeline.length) return; seekOut(outPos, false); });

// ───────── Transkription ─────────
function fillModels(){
  const ms = J(TS.models()) || [];
  const sel = $('#model'); sel.innerHTML = '';
  ms.forEach(m => { const o = document.createElement('option'); o.value = m.name; o.textContent = m.label + (m.installed ? ' · bereit' : ` · ${m.sizeMb} MB laden`); sel.append(o); });
  const ready = ms.find(m => m.installed && m.recommended) || ms.find(m => m.installed); if (ready) sel.value = ready.name;
}
let transJob = null;
$('#transBtn').onclick = () => {
  const id = TS.transcribe(P.main.uri, $('#model').value, $('#lang').value, $('#fillers').checked);
  transJob = id; $('#transBtn').disabled = true; $('#transCancel').classList.remove('hidden'); $('#transProg').classList.remove('hidden'); TS.keepAwake(true);
  const end = () => { $('#transBtn').disabled = false; $('#transCancel').classList.add('hidden'); TS.keepAwake(false); };
  watchJob(id, j => { $('#transProg i').style.width = (j.progress * 100).toFixed(1) + '%'; $('#transMsg').textContent = j.message || ''; },
    j => { end(); const r = j.result; tokens = buildTokens(r.words, P.main.duration); P.language = r.lang; deleted = new Set(); P.trims = {}; P.adj = {};
           genCues(); renderTranscript(); changed(); saveNow(); setTab('text'); toast(`${r.words.length} Wörter erkannt`); },
    j => { end(); $('#transMsg').textContent = j.status === 'cancelled' ? 'Abgebrochen.' : ('Fehler: ' + (j.error || 'unbekannt')); });
};
$('#transCancel').onclick = () => transJob && TS.cancel(transJob);

// ───────── Text ─────────
let selA = null, selB = null;
function renderTranscript(){
  const root = $('#transcript'); root.innerHTML = ''; spans = new Array(tokens.length);
  let para = -1, pEl = null, fillers = 0; const frag = document.createDocumentFragment();
  for (const t of tokens){
    if (t.p !== para || !pEl){ pEl = document.createElement('p'); para = t.p;
      const ts = document.createElement('span'); ts.className = 'ts'; ts.textContent = fmtT(t.ws ?? t.s); pEl.append(ts); frag.append(pEl); }
    const sp = document.createElement('span'); sp.dataset.i = t.i;
    if (t.type === 'word'){ sp.className = 'tk word' + (t.pr < 0.5 ? ' low' : ''); sp.textContent = t.text; if (FILLER.test(norm(t.text))){ sp.classList.add('filler'); fillers++; } }
    else sp.className = 'tk pause';
    spans[t.i] = sp; pEl.append(sp, ' ');
  }
  root.append(frag); tokens.forEach(t => paint(t.i));
  $('#fillerBtn').textContent = `Füllwörter weg (${fillers})`;
}
function paint(i){
  const t = tokens[i], sp = spans[i]; if (!sp) return;
  sp.classList.toggle('del', deleted.has(i));
  if (t.type === 'pause'){ const d = (t.e - t.s).toFixed(1).replace('.', ','), tr = P.trims[i];
    sp.classList.toggle('trim', tr != null && !deleted.has(i)); sp.textContent = tr != null ? `⏸ ${d}→${String(tr).replace('.', ',')}` : `⏸ ${d}`; }
}
$('#transcript').addEventListener('click', e => {
  const sp = e.target.closest('.tk'); if (!sp) return;
  const i = +sp.dataset.i;
  if (selA == null){ selA = selB = i; }
  else if (i >= Math.min(selA, selB) && i <= Math.max(selA, selB) && selA !== selB){ selA = selB = i; }
  else if (selA === selB && i === selA){ clearSel(); return; }
  else selB = i;
  showSel();
  if (!playing){ const t = tokens[i]; seekOut(srcToOut(snapSrc(t.ws ?? t.s)), false); }
});
function selIds(){ if (selA == null) return []; const a = Math.min(selA, selB), b = Math.max(selA, selB); const r = []; for (let i = a; i <= b; i++) r.push(i); return r; }
function showSel(){
  spans.forEach(s => s && s.classList.remove('sel'));
  const ids = selIds(); ids.forEach(i => spans[i] && spans[i].classList.add('sel'));
  $('#selbar').classList.toggle('hidden', !ids.length);
  if (ids.length){ const allDel = ids.every(i => deleted.has(i)); $('#selDel').textContent = allDel ? 'Wiederherstellen' : 'Löschen';
    $('#selInfo').textContent = ids.length === 1 ? 'Tippe ein zweites Wort für einen Bereich' : `${ids.filter(i => tokens[i].type === 'word').length} Wörter`; }
}
function clearSel(){ selA = selB = null; showSel(); }
$('#selClose').onclick = clearSel;
$('#selDel').onclick = () => {
  const ids = selIds(); if (!ids.length) return; const restoreIt = ids.every(i => deleted.has(i));
  commit(() => ids.forEach(i => { restoreIt ? deleted.delete(i) : deleted.add(i); paint(i); }), false);
  clearSel(); toast(restoreIt ? 'Wiederhergestellt' : 'Gelöscht');
};
$('#selPlay').onclick = () => { const ids = selIds(); if (!ids.length) return; const t = tokens[ids[0]]; const a = srcToOut(snapSrc(t.ws ?? t.s)); seekOut(Math.max(0, a - 0.5), false); startPlay(); };
$('#fillerBtn').onclick = () => {
  const ids = tokens.filter(t => t.type === 'word' && !deleted.has(t.i) && FILLER.test(norm(t.text))).map(t => t.i);
  if (!ids.length) return toast('Keine Füllwörter übrig');
  commit(() => ids.forEach(i => { deleted.add(i); paint(i); }), false); toast(`${ids.length} Füllwörter entfernt`);
};
$('#pauseBtn').onclick = () => {
  const ids = tokens.filter(t => t.type === 'pause' && t.e - t.s > 0.7).map(t => t.i);
  if (!ids.length) return toast('Keine langen Pausen');
  commit(() => ids.forEach(i => { P.trims[i] = 0.3; paint(i); }), false); toast(`${ids.length} Pausen auf 0,3 s gekürzt`);
};
$('#hideDel').onchange = e => $('#transcript').classList.toggle('hide-del', e.target.checked);
let nowTok = -1;
function highlightNow(){
  if (tab !== 'text' || !tokens.length) return;
  const g = timeline[curSeg]; if (!g || g.kind !== 'main') return;
  const t = V.currentTime; let lo = 0, hi = tokens.length - 1, k = -1;
  while (lo <= hi){ const m = (lo + hi) >> 1; if (tokens[m].s <= t){ k = m; lo = m + 1; } else hi = m - 1; }
  if (k === nowTok) return; if (nowTok >= 0 && spans[nowTok]) spans[nowTok].classList.remove('now'); nowTok = k;
  if (k >= 0 && spans[k]){ spans[k].classList.add('now'); const b = spans[k].getBoundingClientRect(), pb = $('.panes').getBoundingClientRect();
    if (b.top < pb.top + 20 || b.bottom > pb.bottom - 120) spans[k].scrollIntoView({block:'center', behavior:'smooth'}); }
}

// ───────── Untertitel (wie Desktop) ─────────
const S = () => P.sub_style;
const isWord = i => tokens[i] && tokens[i].type === 'word';
function cueWords(c){ const ids = []; for (let i = c.a; i <= c.b && i < tokens.length; i++) if (isWord(i) && !deleted.has(i)) ids.push(i); return ids; }
function autoText(c){ return cueWords(c).map(i => tokens[i].text).join(' '); }
function cueText(c){ return c.text != null ? c.text : autoText(c); }
function genCues(){
  const st = S();
  if (st.mode === 'word'){
    const ws = tokens.filter(t => t.type === 'word' && !deleted.has(t.i));
    P.cues = ws.map((w, k) => ({id:newId(), a: k ? ws[k-1].i + 1 : 0, b: k === ws.length - 1 ? tokens.length - 1 : w.i, text:null, ds:0, de:0, off:false}));
    return;
  }
  const maxChars = (+st.chars || 32) * (+st.lines || 2), maxDur = +st.dur || 4;
  const out = []; let cur = null, len = 0, lastEnd = 0;
  for (const w of tokens.filter(t => t.type === 'word' && !deleted.has(t.i))){
    if (cur){
      const prev = tokens[cur.b], nl = len + 1 + w.text.length;
      const endS = /[.?!…]$/.test(prev.text) && len > maxChars * 0.35, comma = /[,;:]$/.test(prev.text) && len > maxChars * 0.7;
      if (nl > maxChars || w.we - cur.t0 > maxDur || endS || comma || w.ws - lastEnd > 0.8){ out.push(cur); cur = null; }
    }
    if (!cur){ cur = {id:newId(), a: out.length ? out[out.length-1].b + 1 : 0, b:w.i, text:null, ds:0, de:0, off:false, t0:w.ws}; len = w.text.length; }
    else { cur.b = w.i; len += 1 + w.text.length; }
    lastEnd = w.we;
  }
  if (cur) out.push(cur);
  const lenOf = ids => ids.reduce((n, i) => n + tokens[i].text.length + 1, 0);
  for (let k = 1; k < out.length; k++){
    const prev = out[k-1], c = out[k]; const pw = cueWords(prev), cw = cueWords(c);
    if (/[.?!…]$/.test(tokens[prev.b]?.text || '') || lenOf(cw) > maxChars * 0.3) continue;
    while (pw.length > 2 && lenOf(cw) + tokens[pw[pw.length-1]].text.length < lenOf(pw) - tokens[pw[pw.length-1]].text.length){
      const w = pw.pop(); cw.unshift(w); prev.b = pw[pw.length-1]; c.a = prev.b + 1; }
  }
  if (out.length) out[out.length-1].b = tokens.length - 1;
  out.forEach(c => delete c.t0); P.cues = out;
}
function wrapText(text){
  const st = S(), max = +st.chars || 32, lines = +st.lines || 2;
  text = text.replace(/\s+/g, ' ').trim();
  if (st.mode === 'word' || lines < 2 || text.length <= max) return text;
  const mid = text.length / 2; let best = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? text : text.slice(0, best) + '\n' + text.slice(best + 1);
}
function cueTimes(c){
  const ids = cueWords(c); if (!ids.length) return null;
  let s = srcToOut(tokens[ids[0]].ws) + (c.ds || 0), e = srcToOut(tokens[ids[ids.length-1]].we) + (c.de || 0);
  for (const g of timeline) if (g.kind === 'insert' && s < g.o && e > g.o) e = g.o;   // nicht in einen Einschub hineinlaufen
  return {s: Math.max(0, s), e: Math.max(s + 0.2, e), src: tokens[ids[0]].ws};
}
function computedCues(){
  const list = [];
  for (const c of P.cues){ if (c.off) continue; const t = cueTimes(c), text = cueText(c).trim(); if (!t || !text) continue; list.push({c, s:t.s, e:t.e, text}); }
  list.sort((x, y) => x.s - y.s);
  for (let k = 0; k < list.length; k++){ const n = list[k+1];
    if (n){ if (list[k].e > n.s - 0.02) list[k].e = Math.max(list[k].s + 0.2, n.s - 0.02); else if (n.s - list[k].e < 0.3) list[k].e = n.s - 0.02; }
    list[k].e = Math.min(list[k].e, total); }
  return list;
}
let cueCache = {at:-1, list:[]}, cueEls = new Map(), lastCue = null;
function updateSubs(o){
  if (!P || !tokens.length || S().enabled === false){ $('#subOv').textContent = ''; return; }
  const now = performance.now(); if (now - cueCache.at > 400) cueCache = {at:now, list:computedCues()};
  const cur = cueCache.list.find(x => o >= x.s && o < x.e);
  $('#subOv').textContent = cur ? wrapText(cur.text) : '';
  const id = cur ? cur.c.id : null;
  if (id !== lastCue && tab === 'subs'){
    if (lastCue && cueEls.get(lastCue)) cueEls.get(lastCue).classList.remove('now');
    if (id && cueEls.get(id)){ cueEls.get(id).classList.add('now'); if (playing && document.activeElement?.tagName !== 'TEXTAREA') cueEls.get(id).scrollIntoView({block:'center', behavior:'smooth'}); }
  }
  lastCue = id;
}
function styleOverlay(){
  const ov = $('#subOv'), st = S(); ov.className = 'subov ' + st.pos; ov.style.color = st.color;
  ov.style.fontSize = {klein:'clamp(10px,3.4vw,18px)', mittel:'', groß:'clamp(15px,5.4vw,28px)'}[st.size] || '';
  ov.style.textShadow = st.outline ? '' : 'none';
}
function syncStyleInputs(){
  const st = S(); $('#stChars').value = st.chars; $('#stLines').value = String(st.lines); $('#stDur').value = st.dur; $('#stSize').value = st.size;
  $('#stPos').value = st.pos; $('#stColor').value = st.color.toLowerCase(); $('#stOutline').checked = !!st.outline; $('#stMode').value = st.mode;
  $('#subsMaster').checked = st.enabled !== false; $('#subsMasterLbl').textContent = st.enabled !== false ? 'Untertitel an' : 'Untertitel aus';
  $('#paneSubs').classList.toggle('subs-off', st.enabled === false); $('#paneSubs').classList.toggle('word-mode', st.mode === 'word');
  $('#exSubs').checked = st.enabled !== false; styleOverlay();
}
[['#stChars','chars',Number],['#stLines','lines',Number],['#stDur','dur',Number],['#stSize','size',String],['#stPos','pos',String],['#stColor','color',v => v.toUpperCase()]]
  .forEach(([sel, key, conv]) => $(sel).addEventListener('change', e => { S()[key] = conv(e.target.value); styleOverlay(); changed(false); }));
$('#stOutline').onchange = e => { S().outline = e.target.checked; styleOverlay(); changed(false); };
$('#subsMaster').onchange = e => { S().enabled = e.target.checked; syncStyleInputs(); changed(false); toast(e.target.checked ? 'Untertitel an' : 'Untertitel aus'); };
$('#exSubs').onchange = e => { S().enabled = e.target.checked; syncStyleInputs(); changed(false); };
function manualCount(){ return P.cues.filter(c => c.text != null || c.ds || c.de || c.off).length; }
$('#stMode').onchange = e => {
  const n = manualCount(); if (n && !confirm(`${n} Untertitel wurden von Hand bearbeitet. Beim Umstellen gehen diese Änderungen verloren. Fortfahren?`)){ e.target.value = S().mode; return; }
  S().mode = e.target.value; syncStyleInputs(); commit(genCues); toast(P.cues.length + ' Untertitel');
};
$('#regenBtn').onclick = () => { const n = manualCount(); if (n && !confirm(`${n} Untertitel wurden von Hand bearbeitet. Neu aufteilen?`)) return; commit(genCues); toast(P.cues.length + ' Untertitel'); };
function renderSubs(){
  const box = $('#cueList'); box.innerHTML = ''; cueEls = new Map(); lastCue = null;
  const frag = document.createDocumentFragment();
  P.cues.forEach((c, idx) => {
    const el = document.createElement('div'); el.className = 'cue'; el.dataset.id = c.id;
    el.innerHTML = `<div class="tm"><span class="t"></span><span class="w"></span></div><textarea rows="2"></textarea>
      <div class="acts"><button data-a="split">✂ teilen</button><button data-a="merge">⤓ zusammen</button><button data-a="off"></button>
      <button data-a="auto" class="hidden">↺ auto</button><button data-a="s-">Start −</button><button data-a="s+">Start +</button><button data-a="e-">Ende −</button><button data-a="e+">Ende +</button></div>`;
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
  el.querySelector('.w').textContent = (c.ds || c.de) ? `Start ${c.ds >= 0 ? '+' : ''}${(c.ds||0).toFixed(1)} · Ende ${c.de >= 0 ? '+' : ''}${(c.de||0).toFixed(1)}` : '';
  el.querySelector('[data-a=off]').textContent = c.off ? 'einblenden' : 'ausblenden';
  el.querySelector('[data-a=auto]').classList.toggle('hidden', c.text == null);
}
function updateSubs2(){ P.cues.forEach(c => paintCue(c)); updateCount(); }
function updateCount(){ $('#subCount').textContent = computedCues().length + ' Untertitel'; }
function updateSubsList(){ if (tab === 'subs') updateSubs2(); }
$('#cueList').addEventListener('click', e => {
  const el = e.target.closest('.cue'); if (!el) return;
  const idx = P.cues.findIndex(c => c.id === el.dataset.id), c = P.cues[idx];
  const btn = e.target.closest('[data-a]');
  if (!btn){ if (e.target.closest('.tm')){ const t = cueTimes(c); if (t) seekOut(t.s, false); } return; }
  const a = btn.dataset.a, ta = el.querySelector('textarea');
  if (a === 'split'){
    const ids = cueWords(c); if (ids.length < 2) return toast('Zu wenige Wörter');
    const text = ta.value, pos = ta.selectionStart ?? 0, left = text.slice(0, pos).trim(), right = text.slice(pos).trim();
    if (!left || !right) return toast('Erst den Cursor an die Teilungsstelle setzen');
    const k = Math.min(ids.length - 1, Math.max(1, left.split(/\s+/).length)), manual = c.text != null;
    commit(() => { const c2 = {id:newId(), a:ids[k-1] + 1, b:c.b, text: manual ? right : null, ds:0, de:c.de || 0, off:c.off};
      c.b = ids[k-1]; c.text = manual ? left : null; c.de = 0; P.cues.splice(idx + 1, 0, c2); });
  } else if (a === 'merge'){
    const n = P.cues[idx+1]; if (!n) return;
    commit(() => { const manual = c.text != null || n.text != null; c.text = manual ? (cueText(c) + ' ' + cueText(n)).trim() : null; c.b = n.b; c.de = n.de || 0; c.off = c.off && n.off; P.cues.splice(idx + 1, 1); });
  } else if (a === 'off'){ commit(() => c.off = !c.off, false); paintCue(c); }
  else if (a === 'auto'){ commit(() => c.text = null, false); paintCue(c); }
  else { const key = a[0] === 's' ? 'ds' : 'de', d = a[1] === '+' ? 0.1 : -0.1; commit(() => c[key] = Math.round(((c[key] || 0) + d) * 10) / 10, false); paintCue(c); }
  cueCache.at = -1;
});

// ───────── Studio ─────────
const TYPE_LBL = {broll:'B-Roll', insert:'Einschub', pip:'Bild-im-Bild', zoom:'Zoom'};
$$('[data-add]').forEach(b => b.onclick = async () => {
  if (!tokens.length && !P.main) return;
  const type = b.dataset.add, at = +curSrc().toFixed(3);
  if (type === 'zoom'){
    let it; commit(() => { it = {id:newId(), type, at, dur:2, kind:'punch', strength:1.25, cx:.5, cy:.4}; P.items.push(it); });
    return openItem(it.id);
  }
  const clip = await pickMedia('video'); if (!clip) return;
  let it; commit(() => { it = {id:newId(), type, at, clip, in:0, out: type === 'insert' ? clip.duration : Math.min(clip.duration, 4), corner:'or', size:0.33}; P.items.push(it); });
  openItem(it.id);
});
function renderStudio(){
  const box = $('#itemList'); box.innerHTML = '';
  const items = [...P.items].sort((a, b) => srcToOut(snapSrc(a.at)) - srcToOut(snapSrc(b.at)));
  $('#itemsEmpty').classList.toggle('hidden', items.length > 0);
  for (const it of items){
    const el = document.createElement('div'); el.className = 'item';
    const o = srcToOut(snapSrc(it.at));
    const desc = it.type === 'zoom' ? `${it.kind === 'punch' ? 'Sprung' : it.kind === 'in' ? 'Zoomfahrt rein' : 'Zoomfahrt raus'} · ${it.strength.toFixed(2).replace('.', ',')}× · ${it.dur.toFixed(1).replace('.', ',')} s`
      : `${it.clip.name} · ${fmtS(it.out - it.in)}`;
    el.innerHTML = `<span class="badge ${it.type}">${TYPE_LBL[it.type]}</span><div class="meta"><b></b><span class="muted mono small">${fmtS(o)}</span></div><button class="btn">Bearbeiten</button>`;
    el.querySelector('b').textContent = desc;
    el.onclick = () => openItem(it.id); box.append(el);
  }
  renderCuts();
}
function renderCuts(){
  const box = $('#cutList'); box.innerHTML = '';
  if (!tokens.length){ box.innerHTML = '<p class="muted small">Erst transkribieren und im Text schneiden.</p>'; return; }
  const fps = P.main.fps || 30, fr = 1 / fps;
  const edges = [];
  for (let k = 0; k <= ranges.length; k++){
    const before = k > 0 ? rangeToks[k-1][1] : null, after = k < ranges.length ? rangeToks[k][0] : null;
    if (before == null && (after == null || ranges[0][0] < 0.05)) continue;
    if (after == null && ranges[k-1][1] > P.main.duration - 0.05) continue;
    edges.push({k, before, after});
  }
  if (!edges.length){ box.innerHTML = '<p class="muted small">Noch keine Schnitte.</p>'; return; }
  const word = (i, dir) => { if (i == null || i < 0) return '';
    let j = i; while (j >= 0 && j < tokens.length && tokens[j].type !== 'word') j += dir; return j >= 0 && j < tokens.length ? tokens[j].text : ''; };
  for (const ed of edges){
    const el = document.createElement('div'); el.className = 'cut';
    const o = ed.k > 0 ? srcToOut(ranges[ed.k-1][1]) : 0;
    const ctl = (key, label) => key == null ? '' : `<div class="nudge"><span style="min-width:96px">${label}</span>
      <button data-k="${key}" data-d="${-fr}">−1 F</button><span class="val" data-v="${key}"></span><button data-k="${key}" data-d="${fr}">+1 F</button>
      <button data-k="${key}" data-d="-0.1">−0,1</button><button data-k="${key}" data-d="0.1">+0,1</button></div>`;
    el.innerHTML = `<div class="ctx"><i>…</i> <b class="w1"></b> ✂ <b class="w2"></b> <i>…</i> <span class="muted mono small">${fmtS(o)}</span>
        <button class="btn" data-play="${o}" style="float:right;min-height:32px;padding:4px 12px">▶</button></div>
      ${ctl(ed.before != null ? 'e' + ed.before : null, 'Ende davor')}${ctl(ed.after != null ? 's' + ed.after : null, 'Anfang danach')}`;
    el.querySelector('.w1').textContent = word(ed.before, -1); el.querySelector('.w2').textContent = word(ed.after, 1);
    box.append(el);
  }
  paintCutVals();
}
function paintCutVals(){ $$('#cutList [data-v]').forEach(s => { const v = P.adj[s.dataset.v] || 0; s.textContent = (v >= 0 ? '+' : '') + Math.round(v * 1000) + ' ms'; }); }
$('#cutList').addEventListener('click', e => {
  const pb = e.target.closest('[data-play]'); if (pb){ const o = +pb.dataset.play; seekOut(Math.max(0, o - 2), false); stopAt = o + 2; startPlay(); stopAt = o + 2; return; }
  const b = e.target.closest('[data-k]'); if (!b) return;
  const key = b.dataset.k, d = +b.dataset.d;
  commit(() => { P.adj[key] = Math.round(((P.adj[key] || 0) + d) * 1000) / 1000; if (Math.abs(P.adj[key]) < 0.0005) delete P.adj[key]; }, false);
  paintCutVals();
});

// Bearbeitungsblatt für ein Element
let sheetItem = null, pinMode = false;
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
      <p class="muted small">Mittelpunkt: einfach oben ins Bild tippen.</p>`);
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
  $('#sheet').classList.remove('hidden'); $('#sheetBack').classList.remove('hidden');
  pinMode = it.type === 'zoom'; $('#stageHint').classList.toggle('hidden', !pinMode);
  // zoom sheet is passive so the stage stays tappable
  $('#sheet').classList.toggle('passive', pinMode); $('#sheetBack').classList.toggle('hidden', pinMode);
  if (it.type !== 'zoom'){ const pv = $('#cPrev'); pv.src = MEDIA(it.clip.uri); pv.addEventListener('loadedmetadata', () => pv.currentTime = it.in, {once:true}); }
  paintItem();
  body.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const seg = b.closest('.seg-ctl');
    if (seg){ const v = b.dataset.v;
      commit(() => { if (seg.id === 'zKind') it.kind = v; if (seg.id === 'cMode'){ it.type = v; if (v === 'insert') it.out = Math.max(it.out, Math.min(it.clip.duration, it.in + 1)); }
        if (seg.id === 'cCorner') it.corner = v; if (seg.id === 'cSize') it.size = +v; }, false); h.textContent = TYPE_LBL[it.type]; paintItem(); return; }
    if (b.dataset.z){ commit(() => it.dur = clamp(+(it.dur + +b.dataset.z).toFixed(2), 0.2, 60), false); }
    else if (b.dataset.at){ commit(() => it.at = clamp(+(it.at + +b.dataset.at).toFixed(3), 0, P.main.duration), false); seekOut(srcToOut(snapSrc(it.at)), false); }
    else if (b.dataset.cin){ commit(() => it.in = clamp(+(it.in + +b.dataset.cin).toFixed(3), 0, it.out - 0.1), false); $('#cPrev').currentTime = it.in; }
    else if (b.dataset.cout){ commit(() => it.out = clamp(+(it.out + +b.dataset.cout).toFixed(3), it.in + 0.1, it.clip.duration), false); $('#cPrev').currentTime = it.out; }
    else if (b.id === 'cInHere'){ const t = $('#cPrev').currentTime; commit(() => it.in = clamp(t, 0, it.out - 0.1), false); }
    else if (b.id === 'cOutHere'){ const t = $('#cPrev').currentTime; commit(() => it.out = clamp(t, it.in + 0.1, it.clip.duration), false); }
    else if (b.id === 'itPlay'){ const o = srcToOut(snapSrc(it.at)); seekOut(Math.max(0, o - 1), false); stopAt = o + (it.type === 'zoom' ? it.dur : it.out - it.in) + 1; startPlay(); stopAt = o + (it.type === 'zoom' ? it.dur : it.out - it.in) + 1; return; }
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
  else { $('#cName').textContent = `${it.clip.name} · ${fmtS(it.clip.duration)}`; $('#cIn').textContent = fmtS(it.in); $('#cOut').textContent = fmtS(it.out); $('#cAt').textContent = fmtS(srcToOut(snapSrc(it.at)));
    $$('.pipopt').forEach(x => x.classList.toggle('hidden', it.type !== 'pip')); }
  updateZoomPreview();
}
function updateZoomPreview(){ if (sheetItem && sheetItem.type === 'zoom' && !playing){ const z = sheetItem; V.style.transformOrigin = `${z.cx * 100}% ${z.cy * 100}%`; V.style.transform = `scale(${z.kind === 'in' ? 1 : z.strength})`; } }
function closeSheet(){ $('#sheet').classList.add('hidden'); $('#sheetBack').classList.add('hidden'); $('#pin').classList.add('hidden'); $('#stageHint').classList.add('hidden');
  const pv = $('#cPrev'); if (pv){ pv.pause(); pv.removeAttribute('src'); } sheetItem = null; pinMode = false; updateZoom(); renderStudio(); }
$('#sheetBack').onclick = closeSheet;
$('#stage').addEventListener('click', e => {
  if (!pinMode || !sheetItem) { if (!sheetItem) togglePlay(); return; }
  const b = $('#stage').getBoundingClientRect();
  const it = sheetItem; commit(() => { it.cx = +clamp((e.clientX - b.left) / b.width, 0.05, 0.95).toFixed(3); it.cy = +clamp((e.clientY - b.top) / b.height, 0.05, 0.95).toFixed(3); }, false); paintItem();
});

// ───────── Export ─────────
function outSize(){
  let [w, h] = dispSize(P.main); const lim = +$('#exRes').value;
  if (lim && Math.min(w, h) > lim){ const f = lim / Math.min(w, h); w *= f; h *= f; }
  return [Math.round(w / 2) * 2, Math.round(h / 2) * 2];
}
function buildPlan(){
  const [W, H] = outSize();
  const segs = timeline.map(g => {
    if (g.kind === 'insert') return {kind:'insert', uri:g.uri, in:+g.in.toFixed(3), out:+g.out.toFixed(3)};
    const zs = P.items.filter(z => z.type === 'zoom' && z.at < g.out && z.at + z.dur > g.in)
      .map(z => ({at:z.at, dur:z.dur, kind:z.kind, strength:z.strength, cx:z.cx, cy:z.cy}));
    return {kind:'main', uri:P.main.uri, in:+g.in.toFixed(3), out:+g.out.toFixed(3), zooms:zs};
  });
  const ovs = overlays.map(o => ({mode:o.x.type, uri:o.x.clip.uri, in:o.x.in, out:o.x.in + (o.end - o.at), at:+o.at.toFixed(3), corner:o.x.corner || 'or', size:o.x.size || 0.33}));
  const subs = S().enabled !== false && tokens.length ? {cues: computedCues().map(x => ({start:+x.s.toFixed(3), end:+x.e.toFixed(3), text:wrapText(x.text)})), style:S()} : null;
  return {name: ($('#exName').value || P.name).replace(/[\\/:*?"<>|]/g, '_'), width:W, height:H, fps:P.main.fps || 30, total, segments:segs, overlays:ovs, subs};
}
function renderExport(){
  const [W, H] = outSize(), n = P.items.reduce((m, x) => (m[x.type] = (m[x.type] || 0) + 1, m), {});
  $('#exSummary').textContent = `${fmtT(total)} · ${W}×${H} · ${timeline.filter(g => g.kind === 'main').length} Abschnitte` +
    (n.insert ? ` · ${n.insert} Einschub` : '') + (n.broll ? ` · ${n.broll} B-Roll` : '') + (n.pip ? ` · ${n.pip} Bild-im-Bild` : '') + (n.zoom ? ` · ${n.zoom} Zoom` : '') +
    (S().enabled !== false && tokens.length ? ` · ${computedCues().length} Untertitel` : '');
}
$('#exRes').onchange = renderExport;
let exJob = null, exResult = null;
$('#exBtn').onclick = () => {
  if (!timeline.length) return; saveNow(); pausePlay();
  const plan = buildPlan(); exResult = null; $('#exDone').classList.add('hidden');
  exJob = TS.exportVideo(JSON.stringify(plan)); $('#exBtn').disabled = true; $('#exCancel').classList.remove('hidden'); $('#exProg').classList.remove('hidden');
  const end = () => { $('#exBtn').disabled = false; $('#exCancel').classList.add('hidden'); };
  watchJob(exJob, j => { $('#exProg i').style.width = (j.progress * 100).toFixed(1) + '%'; $('#exMsg').textContent = j.message || ''; },
    j => { end(); exResult = j.result; $('#exMsg').textContent = 'Fertig – in der Galerie unter Movies/Textschnitt.'; $('#exDone').classList.remove('hidden'); },
    j => { end(); $('#exMsg').textContent = j.status === 'cancelled' ? 'Abgebrochen.' : ('Fehler: ' + (j.error || 'unbekannt')); });
};
$('#exCancel').onclick = () => exJob && TS.cancel(exJob);
$('#exShare').onclick = () => exResult && TS.share(exResult.uri);
$('#exOpen').onclick = () => exResult && TS.view(exResult.uri);

// ───────── Reiter ─────────
function setTab(t){
  tab = t; clearSel();
  $('#paneTrans').classList.toggle('hidden', t !== 'trans');
  $('#paneText').classList.toggle('hidden', t !== 'text'); $('#paneSubs').classList.toggle('hidden', t !== 'subs');
  $('#paneStudio').classList.toggle('hidden', t !== 'studio'); $('#paneExport').classList.toggle('hidden', t !== 'export');
  $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t || (t === 'trans' && b.dataset.tab === 'text')));
  if (t === 'subs') renderSubs(); if (t === 'studio') renderStudio(); if (t === 'export') renderExport();
}
$('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || !P) return;
  const t = b.dataset.tab; if (!tokens.length && t !== 'studio' && t !== 'export') return setTab('trans'); setTab(t); });

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
