'use strict';
/* Studio: Zeitleiste wie in CapCut – feste Abspiellinie in der Mitte, Spuren, Griffe zum Trimmen. */
const TL = {pps: 60, sel: null, expect: -1, drag: null, pinch: null, seekPending: null};
const tlEl = $('#tl'), tlInner = $('#tlInner');
const half = () => tlEl.clientWidth / 2;
const fps = () => (P && P.main.fps) || 30;
const snapF = d => Math.round(d * fps()) / fps();
const fmtD = t => (Math.round(t * 10) / 10).toFixed(1).replace('.', ',');

function outToSrc(o){
  const g = timeline[segAtOut(o)]; if (!g) return 0;
  return g.kind === 'main' ? clamp(g.in + (o - g.o), g.in, g.out) : snapSrc(g.item.at);
}
function itemOutRange(it){
  if (it.type === 'zoom'){ const a = srcToOut(snapSrc(it.at)); return [a, Math.max(a + 0.15, srcToOut(snapSrc(it.at + it.dur)))]; }
  const ov = overlays.find(o => o.x === it); if (ov) return [ov.at, ov.end];
  const a = srcToOut(snapSrc(it.at)); return [a, a + (it.out - it.in)];
}

// ───────── Zeichnen ─────────
function renderStudio(){ renderTimeline(); }
function renderTimeline(){
  if (!P || tab !== 'studio') return;
  const pad = half();
  tlInner.style.width = Math.ceil(total * TL.pps + 2 * pad) + 'px';
  $('#tlTotal').textContent = '/ ' + fmtS(total);
  renderRuler(pad); renderMain(pad); renderOvl(pad); renderFx(pad); renderTxt(pad);
  restoreSel(); updateTools(); syncScroll(outPos, true);
}
function renderRuler(pad){
  const r = $('#ruler'); r.innerHTML = '';
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const step = steps.find(s => s * TL.pps >= 64) || 600, minor = step / 5;
  const frag = document.createDocumentFragment();
  for (let t = 0; t <= total + 1e-6; t += step){
    const d = document.createElement('div'); d.className = 'tk'; d.style.left = (pad + t * TL.pps) + 'px';
    d.textContent = step < 1 ? fmtS(t) : fmtT(t); frag.append(d);
    if (minor * TL.pps >= 8) for (let k = 1; k < 5 && t + k * minor < total; k++){
      const m = document.createElement('div'); m.className = 'tk m'; m.style.left = (pad + (t + k * minor) * TL.pps) + 'px'; frag.append(m); }
  }
  r.append(frag);
}
function blk(cls, o, d, pad, attrs){
  const b = document.createElement('div'); b.className = 'blk ' + cls;
  b.style.left = (pad + o * TL.pps) + 'px'; b.style.width = Math.max(4, d * TL.pps - 2) + 'px';
  for (const k in attrs) b.dataset[k] = attrs[k];
  b.insertAdjacentHTML('beforeend', '<div class="h l"></div><div class="h r"></div>');
  return b;
}
function thumbs(b, uri, inS, d, aspect){
  const h = 60, tw = Math.max(34, Math.round(h * aspect)), w = d * TL.pps, n = Math.min(400, Math.ceil(w / tw));
  const q = Math.max(0.25, tw / TL.pps / 2);
  const box = document.createElement('div'); box.className = 'thumbs';
  for (let i = 0; i < n; i++){
    const t = Math.round((inS + (i + 0.5) * tw / TL.pps) / q) * q;
    const img = document.createElement('img'); img.loading = 'lazy'; img.decoding = 'async'; img.style.width = tw + 'px'; img.alt = '';
    img.src = THUMB(uri, Math.min(t, inS + d), 120); box.append(img);
  }
  b.prepend(box);
}
function renderMain(pad){
  const tr = $('#trMain'); tr.innerHTML = '';
  const [w, h] = dispSize(P.main); const asp = w / h;
  timeline.forEach((g, i) => {
    const d = g.out - g.in;
    const b = blk(g.kind === 'main' ? 'main' : 'insert', g.o, d, pad, {kind: g.kind, i});
    if (g.kind === 'main') thumbs(b, P.main.uri, g.in, d, asp);
    else { const c = g.item.clip; thumbs(b, c.uri, g.in, d, (c.width && c.height) ? dispSize(c)[0] / dispSize(c)[1] : asp); }
    b.insertAdjacentHTML('beforeend', `<span class="lbl">${g.kind === 'insert' ? 'Einschub · ' : ''}${fmtD(d)} s</span>`);
    tr.append(b);
  });
}
function renderOvl(pad){
  const tr = $('#trOvl'); tr.querySelectorAll('.blk').forEach(x => x.remove());
  for (const o of overlays){
    const b = blk('ovl' + (o.x.type === 'pip' ? ' pip' : ''), o.at, o.end - o.at, pad, {id: o.x.id});
    b.insertAdjacentHTML('beforeend', `<span class="txt"></span>`); b.querySelector('.txt').textContent = (o.x.type === 'pip' ? 'Bild-im-Bild · ' : 'B-Roll · ') + o.x.clip.name;
    tr.append(b);
  }
}
function renderFx(pad){
  const tr = $('#trFx'); tr.querySelectorAll('.blk').forEach(x => x.remove());
  for (const z of P.items.filter(x => x.type === 'zoom')){
    const [a, e] = itemOutRange(z);
    const b = blk('zoom', a, e - a, pad, {id: z.id});
    b.insertAdjacentHTML('beforeend', `<span class="txt">🔍 ${z.kind === 'punch' ? 'Sprung' : z.kind === 'in' ? 'rein' : 'raus'} ${z.strength.toFixed(2).replace('.', ',')}×</span>`);
    tr.append(b);
  }
}
function renderTxt(pad){
  const tr = $('#trTxt'); tr.innerHTML = '';
  if (!tokens.length || S().enabled === false){ tr.innerHTML = '<span class="track-ph">Untertitel aus</span>'; return; }
  const frag = document.createDocumentFragment();
  for (const c of P.cues){
    const t = cueTimes(c); if (!t) continue;
    const b = blk('cue' + (c.off ? ' off' : ''), t.s, Math.max(0.1, t.e - t.s), pad, {cid: c.id});
    const sp = document.createElement('span'); sp.className = 'txt'; sp.style.color = 'var(--tinte)'; sp.textContent = cueText(c); b.append(sp);
    frag.append(b);
  }
  tr.append(frag);
}

// ───────── Auswahl ─────────
function selBlock(){
  const s = TL.sel; if (!s) return null;
  if (s.kind === 'main' || s.kind === 'insert') return tlInner.querySelector(`#trMain .blk[data-i="${s.i}"]`);
  if (s.kind === 'cue') return tlInner.querySelector(`.blk[data-cid="${s.id}"]`);
  return tlInner.querySelector(`.blk[data-id="${s.id}"]`);
}
function restoreSel(){
  const s = TL.sel; if (!s) return;
  if (s.kind === 'main' || s.kind === 'insert'){
    // Hauptspur-Clips über ihre Quellzeit wiederfinden
    let i = timeline.findIndex(g => g.kind === s.kind && (s.kind === 'insert' ? g.item.id === s.itemId : (s.src >= g.in - 1e-3 && s.src <= g.out + 1e-3)));
    if (i < 0){ TL.sel = null; return; } s.i = i;
  }
  const b = selBlock(); if (b) b.classList.add('sel'); else TL.sel = null;
}
function select(sel){
  tlInner.querySelectorAll('.blk.sel').forEach(x => x.classList.remove('sel'));
  TL.sel = sel; const b = selBlock(); if (b) b.classList.add('sel'); else TL.sel = null;
  updateTools();
}
tlInner.addEventListener('click', e => {
  if (TL.drag && TL.drag.moved) return;
  const b = e.target.closest('.blk');
  if (!b){ select(null); return; }
  const tr = b.parentElement.id;
  if (tr === 'trMain'){ const g = timeline[+b.dataset.i]; select(g.kind === 'insert' ? {kind:'insert', i:+b.dataset.i, itemId:g.item.id} : {kind:'main', i:+b.dataset.i, src:(g.in + g.out) / 2}); }
  else if (tr === 'trTxt') select({kind:'cue', id:b.dataset.cid});
  else { const it = P.items.find(x => x.id === b.dataset.id); select({kind: it.type === 'zoom' ? 'zoom' : 'ovl', id: it.id}); }
});

// ───────── Spulen über die Zeitleiste ─────────
function syncScroll(o, force){
  const x = Math.round(o * TL.pps);
  if (force || Math.abs(tlEl.scrollLeft - x) >= 1){ TL.expect = x; tlEl.scrollLeft = x; }
  $('#tlTime').textContent = fmtS(o);
}
tlEl.addEventListener('scroll', () => {
  if (Math.abs(tlEl.scrollLeft - TL.expect) < 1.5 || TL.pinch) return;
  TL.expect = -1;
  const o = clamp(tlEl.scrollLeft / TL.pps, 0, total);
  if (playing) pausePlay();
  $('#tlTime').textContent = fmtS(o);
  const first = TL.seekPending == null; TL.seekPending = o;
  if (first) requestAnimationFrame(() => { const v = TL.seekPending; TL.seekPending = null; seekOut(v, false); TL.expect = Math.round(v * TL.pps); });
}, {passive:true});
(function follow(){ if (P && tab === 'studio' && playing && !TL.drag) syncScroll(outPos); requestAnimationFrame(follow); })();

// Zoomen der Zeitleiste
function setPps(p){ TL.pps = clamp(p, 6, 800); renderTimeline(); }
$('#tlIn').onclick = () => setPps(TL.pps * 1.6);
$('#tlOut').onclick = () => setPps(TL.pps / 1.6);
tlEl.addEventListener('touchstart', e => {
  if (e.touches.length === 2){ const d = Math.abs(e.touches[0].clientX - e.touches[1].clientX); TL.pinch = {d0: Math.max(20, d), p0: TL.pps, o: outPos}; }
}, {passive:true});
tlEl.addEventListener('touchmove', e => {
  if (!TL.pinch || e.touches.length !== 2) return; e.preventDefault();
  const d = Math.abs(e.touches[0].clientX - e.touches[1].clientX);
  const p = clamp(TL.pinch.p0 * Math.max(20, d) / TL.pinch.d0, 6, 800);
  if (Math.abs(p - TL.pps) / TL.pps > 0.04){ TL.pps = p; renderTimeline(); syncScroll(TL.pinch.o, true); }
}, {passive:false});
tlEl.addEventListener('touchend', e => { if (e.touches.length < 2 && TL.pinch){ const o = TL.pinch.o; TL.pinch = null; syncScroll(o, true); } });

// ───────── Ziehen: Griffe (Trimmen) und Verschieben ─────────
tlInner.addEventListener('pointerdown', e => {
  const b = e.target.closest('.blk.sel'); if (!b) return;
  const h = e.target.closest('.h');
  if (!h && (TL.sel.kind === 'main')) return;              // Hauptspur-Clips werden nur getrimmt
  e.preventDefault(); b.setPointerCapture(e.pointerId);
  TL.drag = {b, side: h ? (h.classList.contains('l') ? 'l' : 'r') : 'm', x0: e.clientX, left0: parseFloat(b.style.left), w0: parseFloat(b.style.width), moved: false, d: 0};
  if (playing) pausePlay();
});
tlInner.addEventListener('pointermove', e => {
  const g = TL.drag; if (!g) return;
  const dx = e.clientX - g.x0; if (Math.abs(dx) > 3) g.moved = true; if (!g.moved) return;
  let d = dx / TL.pps; if (TL.sel.kind === 'main' || TL.sel.kind === 'insert') d = snapF(d);
  d = clampDrag(g.side, d); g.d = d; const px = d * TL.pps;
  if (g.side === 'l'){ g.b.style.left = (g.left0 + px) + 'px'; g.b.style.width = Math.max(4, g.w0 - px) + 'px'; }
  else if (g.side === 'r') g.b.style.width = Math.max(4, g.w0 + px) + 'px';
  else g.b.style.left = (g.left0 + px) + 'px';
  previewDrag(g.side, d);
  $('#tlInfo').textContent = (g.side === 'm' ? 'Verschieben ' : g.side === 'l' ? 'Anfang ' : 'Ende ') + (d >= 0 ? '+' : '−') + fmtD(Math.abs(d)) + ' s' + ((TL.sel.kind === 'main' || TL.sel.kind === 'insert') ? ` (${Math.round(Math.abs(d) * fps())} Bilder)` : '');
});
function endDrag(){
  const g = TL.drag; if (!g) return;
  setTimeout(() => { TL.drag = null; }, 0);
  if (!g.moved || Math.abs(g.d) < 1e-4){ updateTools(); return; }
  applyDrag(g.side, g.d);
}
tlInner.addEventListener('pointerup', endDrag);
tlInner.addEventListener('pointercancel', endDrag);

function selItem(){ return TL.sel && P.items.find(x => x.id === TL.sel.id); }
function selCue(){ return TL.sel && P.cues.find(c => c.id === TL.sel.id); }
function clampDrag(side, d){
  const s = TL.sel;
  if (s.kind === 'main'){ const g = timeline[s.i], len = g.out - g.in;
    if (side === 'l') return clamp(d, edgeMin(g, 'l'), len - 0.1); return clamp(d, -(len - 0.1), edgeMax(g, 'r')); }
  if (s.kind === 'insert'){ const it = timeline[s.i].item;
    return side === 'l' ? clamp(d, -it.in, it.out - it.in - 0.1) : clamp(d, -(it.out - it.in - 0.1), it.clip.duration - it.out); }
  if (s.kind === 'ovl'){ const it = selItem(), [a] = itemOutRange(it);
    if (side === 'l') return clamp(d, -it.in, it.out - it.in - 0.1);
    if (side === 'r') return clamp(d, -(it.out - it.in - 0.1), it.clip.duration - it.out);
    return clamp(d, -a, total - a - 0.1); }
  if (s.kind === 'zoom'){ const it = selItem(), [a, e] = itemOutRange(it);
    if (side === 'l') return clamp(d, -a, e - a - 0.15); if (side === 'r') return clamp(d, -(e - a - 0.15), total - e); return clamp(d, -a, total - e); }
  return d;
}
// Wie weit eine Hauptspur-Kante nach außen darf
function edgeMin(g, side){ const L = g.L || {}; if (L.k === 'adj') return -g.in; if (L.k === 'del') return P.dels[L.di] ? -(P.dels[L.di][1] - P.dels[L.di][0]) : 0; return 0; }
function edgeMax(g, side){ const R = g.R || {}; const dur = P.main.duration; if (R.k === 'adj') return dur - g.out; if (R.k === 'del') return P.dels[R.di] ? P.dels[R.di][1] - P.dels[R.di][0] : 0; return 0; }
function previewDrag(side, d){
  const s = TL.sel;
  if (s.kind === 'main'){ const g = timeline[s.i]; V.currentTime = side === 'l' ? g.in + d : Math.max(g.in, g.out + d - 0.04); V.style.transform = ''; IV.classList.add('hidden'); }
  if (s.kind === 'insert'){ const g = timeline[s.i]; if (isImg(g.item.clip)) return; const url = MEDIA(g.uri); if (IV.dataset.src !== url){ IV.src = url; IV.dataset.src = url; } IV.classList.remove('hidden'); IV.currentTime = side === 'l' ? g.in + d : g.out + d - 0.04; }
}
function applyDrag(side, d){
  const s = TL.sel;
  commit(() => {
    if (s.kind === 'main'){
      const g = timeline[s.i];
      if (side === 'l'){
        const L = g.L || {};
        if (L.k === 'adj') P.adj[L.key] = +((P.adj[L.key] || 0) + d).toFixed(4);
        else if (L.k === 'del' && P.dels[L.di]) P.dels[L.di][1] = +(P.dels[L.di][1] + d).toFixed(4);
        else if (d > 0) addDel(g.in, g.in + d);
        s.src = g.in + d + 0.05;
      } else {
        const R = g.R || {};
        if (R.k === 'adj') P.adj[R.key] = +((P.adj[R.key] || 0) + d).toFixed(4);
        else if (R.k === 'del' && P.dels[R.di]) P.dels[R.di][0] = +(P.dels[R.di][0] + d).toFixed(4);
        else if (d < 0) addDel(g.out + d, g.out);
        s.src = g.out + d - 0.05;
      }
      normDels();
    } else if (s.kind === 'insert'){
      const it = timeline[s.i].item; if (side === 'l') it.in = +(it.in + d).toFixed(3); else it.out = +(it.out + d).toFixed(3);
    } else if (s.kind === 'ovl'){
      const it = selItem(), [a] = itemOutRange(it);
      if (side === 'l'){ it.in = +(it.in + d).toFixed(3); it.at = +outToSrc(a + d).toFixed(3); }
      else if (side === 'r') it.out = +(it.out + d).toFixed(3);
      else it.at = +outToSrc(a + d).toFixed(3);
    } else if (s.kind === 'zoom'){
      const it = selItem(), [a, e] = itemOutRange(it);
      const na = side === 'r' ? a : a + d, ne = side === 'l' ? e : e + d;
      const sa = outToSrc(na), se = outToSrc(ne);
      it.at = +sa.toFixed(3); it.dur = +Math.max(0.15, se - sa).toFixed(3);
    } else if (s.kind === 'cue'){
      const c = selCue(); if (side === 'l') c.ds = +((c.ds || 0) + d).toFixed(2); else if (side === 'r') c.de = +((c.de || 0) + d).toFixed(2);
      else { c.ds = +((c.ds || 0) + d).toFixed(2); c.de = +((c.de || 0) + d).toFixed(2); }
    }
  }, false);
  tokens.forEach(t => paint(t.i));
}

// ───────── Werkzeugleiste ─────────
const T = (icon, label, fn, cls = '') => ({icon, label, fn, cls});
function updateTools(){
  const box = $('#tools'); box.innerHTML = ''; const s = TL.sel; let list = [];
  const g = s && (s.kind === 'main' || s.kind === 'insert') ? timeline[s.i] : null;
  if (!s) list = [T('✂', 'Teilen', splitHere), T('＋', 'Clip', addClip), T('🔍', 'Zoom', addZoom), T('⌫', 'Bis hier weg', () => cutTo('l')), T('⌦', 'Ab hier weg', () => cutTo('r'))];
  else if (s.kind === 'main') list = [T('✂', 'Teilen', splitHere), T('🗑', 'Löschen', delSel, 'danger'), T('⇤', 'Anfang −1', () => nudge('l', -1)), T('⇥', 'Anfang +1', () => nudge('l', 1)),
    T('⇤', 'Ende −1', () => nudge('r', -1)), T('⇥', 'Ende +1', () => nudge('r', 1)), T('🔍', 'Zoom', addZoom), T('＋', 'Clip', addClip)];
  else if (s.kind === 'insert') list = [T('🎞', 'Ausschnitt', () => openItem(g.item.id)), T('🗑', 'Löschen', delSel, 'danger'), T('⇄', 'Als B-Roll', () => convert('broll'))];
  else if (s.kind === 'ovl'){ const it = selItem(); list = [T('🎞', 'Ausschnitt', () => openItem(it.id)), T('🗑', 'Löschen', delSel, 'danger'),
    T(it.type === 'pip' ? '▣' : '◰', it.type === 'pip' ? 'Vollbild' : 'Bild-im-Bild', () => convert(it.type === 'pip' ? 'broll' : 'pip')),
    ...(it.type === 'pip' ? [T('↗', 'Ecke', cycleCorner), T('⤢', 'Größe', cycleSize)] : []), T('⇄', 'Als Einschub', () => convert('insert'))]; }
  else if (s.kind === 'zoom'){ const it = selItem(); list = [T('◎', 'Mittelpunkt', () => openItem(it.id)), T('⟳', it.kind === 'punch' ? 'Sprung' : it.kind === 'in' ? 'Fahrt rein' : 'Fahrt raus', cycleZoomKind),
    T('−', 'Schwächer', () => zoomStrength(-0.05)), T('＋', 'Stärker', () => zoomStrength(0.05)), T('🗑', 'Löschen', delSel, 'danger')]; }
  else if (s.kind === 'cue'){ const c = selCue(); list = [T('✎', 'Text', editCue), T('✂', 'Teilen', splitCue), T(c && c.off ? '👁' : '⦸', c && c.off ? 'Einblenden' : 'Ausblenden', () => { commit(() => c.off = !c.off, false); })]; }
  for (const t of list){ const b = document.createElement('button'); b.className = 'tool ' + t.cls; b.innerHTML = `<i>${t.icon}</i>${t.label}`; b.onclick = t.fn; box.append(b); }
  // Info
  const info = $('#tlInfo');
  if (!s) info.textContent = 'Wische zum Spulen · zwei Finger zoomen · Clip antippen zum Bearbeiten';
  else if (g) info.textContent = `${s.kind === 'insert' ? 'Einschub' : 'Clip'} · ${fmtS(g.o)} – ${fmtS(g.o + g.out - g.in)} (${fmtD(g.out - g.in)} s) · Griffe ziehen zum Trimmen`;
  else if (s.kind === 'cue'){ const c = selCue(), t = c && cueTimes(c); info.textContent = t ? `Untertitel · ${fmtS(t.s)} – ${fmtS(t.e)} · Griffe ziehen verschiebt Anfang/Ende` : 'Untertitel'; }
  else { const it = selItem(); if (it){ const [a, e] = itemOutRange(it); info.textContent = `${TYPE_LBL[it.type]} · ${fmtS(a)} – ${fmtS(e)} · ziehen zum Verschieben, Griffe zum Trimmen`; } }
}
function curMainSeg(){ const g = timeline[curSeg]; return g && g.kind === 'main' ? g : null; }
function splitHere(){
  const g = curMainSeg(); if (!g) return toast('Abspiellinie auf einen Clip der Hauptspur setzen');
  const x = V.currentTime; if (x - g.in < 0.05 || g.out - x < 0.05) return toast('Zu nah an einer Kante');
  commit(() => P.splits.push(+x.toFixed(3)), false); select({kind:'main', i: segAtOut(outPos), src: x + 0.05}); toast('Geteilt');
}
function cutTo(side){
  const g = curMainSeg(); if (!g) return;
  const x = V.currentTime;
  commit(() => side === 'l' ? addDel(g.in, x) : addDel(x, g.out), false); tokens.forEach(t => paint(t.i));
}
function delSel(){
  const s = TL.sel; if (!s) return;
  if (s.kind === 'main'){ const g = timeline[s.i]; commit(() => addDel(g.in, g.out), false); tokens.forEach(t => paint(t.i)); toast('Clip gelöscht'); }
  else if (s.kind === 'insert'){ const id = timeline[s.i].item.id; commit(() => P.items = P.items.filter(x => x.id !== id), false); }
  else if (s.kind === 'ovl' || s.kind === 'zoom'){ commit(() => P.items = P.items.filter(x => x.id !== s.id), false); }
  TL.sel = null; renderTimeline();
}
function nudge(side, frames){
  const s = TL.sel; if (!s || s.kind !== 'main') return;
  const d = clampDrag(side, frames / fps()); if (Math.abs(d) < 1e-6) return toast('Geht hier nicht weiter');
  applyDrag(side, d); previewDrag(side, 0);
}
function convert(type){
  const s = TL.sel; const it = s.kind === 'insert' ? timeline[s.i].item : selItem(); if (!it) return;
  commit(() => { it.type = type; if (type !== 'insert') it.out = Math.min(it.out, it.in + Math.max(1, Math.min(it.out - it.in, 8))); }, false);
  TL.sel = type === 'insert' ? {kind:'insert', itemId: it.id, i:0} : {kind:'ovl', id: it.id}; renderTimeline();
}
function cycleCorner(){ const it = selItem(), order = ['or', 'ur', 'ul', 'ol']; commit(() => it.corner = order[(order.indexOf(it.corner || 'or') + 1) % 4], false); seekOut(outPos, false); }
function cycleSize(){ const it = selItem(), order = [0.25, 0.33, 0.45]; const i = order.findIndex(v => Math.abs(v - (it.size || 0.33)) < 0.01); commit(() => it.size = order[(i + 1) % 3], false); seekOut(outPos, false); }
function cycleZoomKind(){ const it = selItem(), order = ['punch', 'in', 'out']; commit(() => it.kind = order[(order.indexOf(it.kind) + 1) % 3], false); }
function zoomStrength(d){ const it = selItem(); commit(() => it.strength = +clamp(it.strength + d, 1.05, 2).toFixed(2), false); toast(it.strength.toFixed(2).replace('.', ',') + '×'); seekOut(outPos, false); }
function addZoom(){
  const at = +outToSrc(outPos).toFixed(3);
  let it; commit(() => { it = {id:newId(), type:'zoom', at, dur:2, kind:'punch', strength:1.25, cx:.5, cy:.42}; P.items.push(it); }, false);
  select({kind:'zoom', id: it.id}); toast('Zoom eingefügt – Mittelpunkt über „Mittelpunkt“ setzen');
}
function addClip(){
  const body = $('#sheetBody');
  body.innerHTML = `<h3>Clip einfügen an der Abspiellinie</h3><p class="muted small">Videos und Fotos aus der Galerie</p><div class="choice">
    <button class="tile" data-t="broll"><b>B-Roll</b><span>Bild drüber, dein Ton läuft weiter</span></button>
    <button class="tile" data-t="insert"><b>Einschub</b><span>Hauptvideo pausiert, Clip läuft mit eigenem Ton</span></button>
    <button class="tile" data-t="pip"><b>Bild-im-Bild</b><span>kleines Fenster in einer Ecke</span></button></div>`;
  $('#sheet').classList.remove('hidden', 'passive'); $('#sheetBack').classList.remove('hidden');
  body.onclick = async e => {
    const b = e.target.closest('[data-t]'); if (!b) return; const type = b.dataset.t;
    $('#sheet').classList.add('hidden'); $('#sheetBack').classList.add('hidden');
    const at = +outToSrc(outPos).toFixed(3);
    const clip = await pickMedia('clip'); if (!clip) return;
    const img = clip.kind === 'image';
    let it; commit(() => { it = {id:newId(), type, at, clip, in:0, out: img ? 4 : (type === 'insert' ? clip.duration : Math.min(clip.duration, 4)), corner:'or', size:0.33}; P.items.push(it); }, false);
    TL.sel = type === 'insert' ? {kind:'insert', itemId: it.id, i:0} : {kind:'ovl', id: it.id}; renderTimeline();
    toast(`${TYPE_LBL[type]} eingefügt – Griffe ziehen zum Kürzen`);
  };
}
function editCue(){
  const c = selCue(); if (!c) return;
  const body = $('#sheetBody');
  body.innerHTML = `<h3>Untertitel</h3><textarea id="cueEdit" rows="3" style="width:100%;font:17px/1.4 var(--read)"></textarea>
    <div class="row" style="margin-top:10px"><button class="btn" id="cueAuto">↺ gesprochener Text</button><button class="btn primary" id="cueOk" style="margin-left:auto">Fertig</button></div>`;
  $('#cueEdit').value = cueText(c);
  $('#sheet').classList.remove('hidden', 'passive'); $('#sheetBack').classList.remove('hidden');
  const before = snapshot();
  $('#cueAuto').onclick = () => { $('#cueEdit').value = autoText(c); };
  $('#cueOk').onclick = () => { const v = $('#cueEdit').value; c.text = v.trim() === autoText(c) ? null : v; undo.push(before); redo = []; closeSheet(); changed(false); };
  body.onclick = null;
}
function splitCue(){
  const c = selCue(); if (!c) return; const ids = cueWords(c); if (ids.length < 2) return toast('Zu wenige Wörter');
  const x = curSrc(); let k = ids.findIndex(i => tokens[i].ws >= x); if (k <= 0) k = Math.ceil(ids.length / 2);
  const idx = P.cues.indexOf(c);
  commit(() => { const c2 = {id:newId(), a: ids[k-1] + 1, b: c.b, text:null, ds:0, de:c.de || 0, off:c.off}; c.b = ids[k-1]; c.text = null; c.de = 0; P.cues.splice(idx + 1, 0, c2); }, false);
}
window.addEventListener('resize', () => { if (tab === 'studio') renderTimeline(); });

// ───────── Tastatur (wie CapCut) und Maus ─────────
const KEYS = [
  ['Leertaste', 'Abspielen / Pause'], ['K / L', 'Pause / Abspielen'],
  ['← / →', 'ein Bild zurück / vor'], ['Umschalt + ← / →', 'fünf Bilder zurück / vor'],
  ['↑ / ↓', 'zum vorigen / nächsten Schnitt springen'], ['Pos1 / Ende', 'an den Anfang / das Ende'],
  ['Strg + B', 'an der Abspiellinie teilen'], ['Q / W', 'links / rechts der Abspiellinie löschen'],
  ['Entf / Rücktaste', 'Auswahl löschen'], ['Alt + ← / →', 'Auswahl um ein Bild verschieben'],
  [', / .', 'Anfang / Ende der Auswahl zur Abspiellinie trimmen'],
  ['Strg + Z', 'rückgängig'], ['Strg + Umschalt + Z / Strg + Y', 'wiederholen'],
  ['Strg + + / Strg + −', 'Zeitleiste vergrößern / verkleinern'], ['Strg + 0', 'ganze Zeitleiste zeigen'],
  ['Esc', 'Auswahl aufheben / Fenster schließen'], ['Alt + 1 … 4', 'Text · Untertitel · Studio · Export'],
  ['Mausrad', 'Zeitleiste scrollen (mit Strg: zoomen)'], ['Klick auf die Zeitskala', 'Abspiellinie dorthin setzen'],
];
$('#keysBtn').onclick = () => {
  const body = $('#sheetBody');
  body.innerHTML = '<h3>Tastenkürzel</h3><div class="keys">' + KEYS.map(([k, v]) => `<kbd>${k}</kbd><span>${v}</span>`).join('') + '</div><div class="row" style="margin-top:12px"><button class="btn primary" id="keysOk" style="margin-left:auto">Schließen</button></div>';
  body.onclick = e => { if (e.target.id === 'keysOk') closeSheet(); };
  $('#sheet').classList.remove('hidden', 'passive'); $('#sheetBack').classList.remove('hidden');
};

function stepFrames(n){ if (playing) pausePlay(); seekOut(clamp(outPos + n / fps(), 0, total), false); if (tab === 'studio') syncScroll(outPos); }
function editPoints(){
  const pts = new Set([0, total]);
  timeline.forEach(g => { pts.add(+g.o.toFixed(3)); pts.add(+(g.o + g.out - g.in).toFixed(3)); });
  overlays.forEach(o => { pts.add(+o.at.toFixed(3)); pts.add(+o.end.toFixed(3)); });
  return [...pts].sort((a, b) => a - b);
}
function jumpEdit(dir){
  const pts = editPoints(), o = outPos;
  const t = dir < 0 ? [...pts].reverse().find(p => p < o - 0.02) : pts.find(p => p > o + 0.02);
  if (t == null) return; if (playing) pausePlay(); seekOut(Math.min(t, Math.max(0, total - 0.01)), false); if (tab === 'studio') syncScroll(outPos);
}
// Kante der Auswahl an die Abspiellinie holen (wie Trimmen in CapCut)
function trimToPlayhead(side){
  const s = TL.sel; if (!s) return toast('Erst einen Clip auswählen');
  let a, e;
  if (s.kind === 'main' || s.kind === 'insert'){ const g = timeline[s.i]; a = g.o; e = g.o + g.out - g.in; }
  else if (s.kind === 'cue'){ const t = cueTimes(selCue()); if (!t) return; a = t.s; e = t.e; }
  else { [a, e] = itemOutRange(selItem()); }
  let d = side === 'l' ? outPos - a : outPos - e;
  if (s.kind === 'main' || s.kind === 'insert') d = snapF(d);
  d = clampDrag(side, d); if (Math.abs(d) < 1e-4) return;
  applyDrag(side, d);
}
function moveSel(frames){
  const s = TL.sel; if (!s || s.kind === 'main' || s.kind === 'insert') return;
  const d = clampDrag('m', frames / fps()); if (Math.abs(d) > 1e-6) applyDrag('m', d);
}
function fitTimeline(){ if (total > 0) setPps((tlEl.clientWidth - 40) / total); }

document.addEventListener('keydown', e => {
  if (!P || $('#proj').classList.contains('hidden')) return;
  const tag = document.activeElement?.tagName, typing = tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !['checkbox', 'radio', 'range'].includes(document.activeElement.type));
  const mod = e.ctrlKey || e.metaKey, k = e.key;
  if (k === 'Escape'){ if (!$('#sheet').classList.contains('hidden')) closeSheet(); else { select(null); clearSel(); } return; }
  if (typing) return;
  const handled = () => e.preventDefault();
  if (e.altKey && /^[1-4]$/.test(k)){ handled(); const t = ['text', 'subs', 'studio', 'export'][+k - 1]; if (tokens.length || t === 'studio' || t === 'export') setTab(t); return; }
  if (mod && k.toLowerCase() === 'z'){ handled(); (e.shiftKey ? $('#redoBtn') : $('#undoBtn')).click(); return; }
  if (mod && k.toLowerCase() === 'y'){ handled(); $('#redoBtn').click(); return; }
  if (mod && k.toLowerCase() === 'b'){ handled(); splitHere(); return; }
  if (mod && (k === '+' || k === '=')){ handled(); setPps(TL.pps * 1.4); return; }
  if (mod && k === '-'){ handled(); setPps(TL.pps / 1.4); return; }
  if (mod && k === '0'){ handled(); fitTimeline(); return; }
  if (mod) return;
  switch (k){
    case ' ': handled(); togglePlay(); return;
    case 'k': case 'K': handled(); pausePlay(); return;
    case 'l': case 'L': handled(); if (!playing) startPlay(); return;
    case 'ArrowLeft': handled(); if (e.altKey) moveSel(-1); else stepFrames(e.shiftKey ? -5 : -1); return;
    case 'ArrowRight': handled(); if (e.altKey) moveSel(1); else stepFrames(e.shiftKey ? 5 : 1); return;
    case 'ArrowUp': handled(); jumpEdit(-1); return;
    case 'ArrowDown': handled(); jumpEdit(1); return;
    case 'Home': handled(); if (playing) pausePlay(); seekOut(0, false); syncScroll(0); return;
    case 'End': handled(); if (playing) pausePlay(); seekOut(total, false); syncScroll(outPos); return;
    case 'q': case 'Q': handled(); cutTo('l'); return;
    case 'w': case 'W': handled(); cutTo('r'); return;
    case ',': handled(); trimToPlayhead('l'); return;
    case '.': handled(); trimToPlayhead('r'); return;
    case 'Delete': case 'Backspace':
      handled();
      if (tab === 'text' && selA != null) $('#selDel').click();
      else if (TL.sel) delSel();
      return;
  }
});
// Mausrad: scrollen, mit Strg zoomen
tlEl.addEventListener('wheel', e => {
  if (e.ctrlKey){ e.preventDefault(); const o = outPos; setPps(TL.pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); syncScroll(o, true); return; }
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)){ e.preventDefault(); tlEl.scrollLeft += e.deltaY; }
}, {passive:false});
// Klick auf die Zeitskala setzt die Abspiellinie
$('#ruler').addEventListener('click', e => {
  const r = tlInner.getBoundingClientRect(); const o = clamp((e.clientX - r.left - half()) / TL.pps, 0, total);
  if (playing) pausePlay(); seekOut(o, false); syncScroll(outPos, true); e.stopPropagation();
});
// Doppelklick auf einen Untertitel öffnet den Text
tlInner.addEventListener('dblclick', e => { const b = e.target.closest('.blk.cue'); if (b){ select({kind:'cue', id:b.dataset.cid}); editCue(); } });
