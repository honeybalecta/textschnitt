'use strict';
/* Studio: Zeitleiste wie in CapCut. Spuren: Video · B-Roll/Bild-im-Bild · Zoom/Anpassungen · Titel · Untertitel.
   Zwei Zeiger-Modi: „bewegt“ (Desktop: der Zeiger läuft über die Spur und springt am Rand weiter) und
   „fest“ (Handy: Zeiger in der Mitte, die Spur wird darunter bewegt). */
const TL = {pps: 60, sel: null, expect: -1, drag: null, pinch: null, seekPending: null, mode: FINE ? 'move' : 'center', snap: true, justSelected: false};
try { const m = localStorage.getItem('ts-tl-mode'); if (m === 'move' || m === 'center') TL.mode = m; TL.snap = localStorage.getItem('ts-tl-snap') !== '0'; } catch(_){}
const tlEl = $('#tl'), tlInner = $('#tlInner'), tlBox = $('.tl-box'), playline = $('.playline');
const half = () => tlEl.clientWidth / 2;
const padL = () => TL.mode === 'center' ? half() : 14;
const fps = () => (P && primary().fps) || 30;
const snapF = d => Math.round(d * fps()) / fps();
const fmtD = t => (Math.round(t * 10) / 10).toFixed(1).replace('.', ',');

function outToSrc(o){
  const g = timeline[segAtOut(o)]; if (!g) return 0;
  return g.kind === 'main' ? clamp(g.in + (o - g.o) * (g.speed || 1), g.in, g.out) : snapSrc(g.item.at);
}
function itemOutRange(it){
  if (it.type === 'zoom' || it.type === 'fx'){ const a = srcToOut(snapSrc(it.at)); return [a, Math.max(a + 0.15, srcToOut(snapSrc(it.at + it.dur)))]; }
  if (it.type === 'title'){ const a = srcToOut(snapSrc(it.at)); return [a, a + it.dur]; }
  const ov = overlays.find(o => o.x === it); if (ov) return [ov.at, ov.end];
  const a = srcToOut(snapSrc(it.at)); return [a, a + (it.out - it.in)];
}

// ───────── Zeichnen ─────────
function renderStudio(){ renderTimeline(); }
function renderTimeline(){
  if (!P || !studioOn()) return;
  const pad = padL();
  tlInner.style.width = Math.ceil(total * TL.pps + pad + half() + 40) + 'px';
  $('#tlTotal').textContent = '/ ' + fmtS(total);
  renderRuler(pad); renderMain(pad); renderOvl(pad); renderFx(pad); renderTitles(pad); renderTxt(pad);
  restoreSel(); updateTools(); paintBar();
  if (TL.mode === 'center') syncScroll(outPos, true); else placeHead(outPos);
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
  const end = document.createElement('div'); end.className = 'tl-end'; end.style.left = (pad + total * TL.pps) + 'px'; frag.append(end);
  r.append(frag);
}
function blk(cls, o, d, pad, attrs){
  const b = document.createElement('div'); b.className = 'blk ' + cls;
  b.style.left = (pad + o * TL.pps) + 'px'; b.style.width = Math.max(4, d * TL.pps - 2) + 'px';
  for (const k in attrs) b.dataset[k] = attrs[k];
  b.insertAdjacentHTML('beforeend', '<div class="h l"></div><div class="h r"></div>');
  return b;
}
function thumbs(b, uri, inS, d, aspect, speed = 1){
  const h = 60, tw = Math.max(34, Math.round(h * aspect)), w = d / speed * TL.pps, n = Math.min(400, Math.ceil(w / tw));
  const q = Math.max(0.25, tw / TL.pps / 2);
  const box = document.createElement('div'); box.className = 'thumbs';
  for (let i = 0; i < n; i++){
    const t = Math.round((inS + (i + 0.5) * tw / TL.pps * speed) / q) * q;
    const img = document.createElement('img'); img.loading = 'lazy'; img.decoding = 'async'; img.style.width = tw + 'px'; img.alt = '';
    const u = THUMB(uri, Math.min(t, inS + d), 120); if (u && u.then) u.then(x => { if (x) img.src = x; }); else img.src = u; box.append(img);
  }
  b.prepend(box);
}
// Lautstärkeverlauf unten im Clip – so sieht man, wo wirklich gesprochen wird
function wave(b, src, inS, d, speed = 1){
  const a = envArr(src); if (!a) return;
  const w = Math.max(2, Math.round(d / speed * TL.pps)), h = 16, c = document.createElement('canvas'); c.className = 'wave'; c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const bs = burstsOf(src) || [];
  for (let x = 0; x < w; x++){
    const t0 = inS + x / TL.pps * speed, t1 = inS + (x + 1) / TL.pps * speed; let m = 0;
    for (let i = Math.floor(t0 * 100); i <= Math.floor(t1 * 100) && i < a.length; i++) m = Math.max(m, a[i]);
    const v = Math.max(0, (m / 2.8 - 90 + 60) / 60);
    const sp = bs.some(x => t0 < x[1] && t1 > x[0]);
    ctx.fillStyle = sp ? 'rgba(232,155,12,.95)' : 'rgba(255,255,255,.4)';
    const y = Math.round(v * (h - 2)); ctx.fillRect(x, h - y, 1, y);
  }
  b.append(c);
}
const fxBadges = fx => { if (!fx) return ''; const b = []; if (fx.speed && Math.abs(fx.speed - 1) > 0.001) b.push(`${(+fx.speed).toFixed(2).replace(/\.?0+$/, '').replace('.', ',')}×`);
  if (fx.vol != null && Math.abs(fx.vol - 1) > 0.001) b.push(fx.vol <= 0.001 ? '🔇' : `🔊${Math.round(fx.vol * 100)}%`); if (fx.gray) b.push('S/W'); else if (fx.bright || fx.contrast || fx.sat) b.push('🎨'); return b.join(' '); };
function renderMain(pad){
  const tr = $('#trMain'); tr.innerHTML = '';
  const [w, h] = dispSize(primary()); const asp = w / h, multi = P.sources.length > 1;
  let lastSi = -1;
  timeline.forEach((g, i) => {
    const d = segDur(g);
    const b = blk(g.kind === 'main' ? 'main' + (g.si % 2 ? ' alt' : '') : 'insert', g.o, d, pad, {kind: g.kind, i});
    let lbl = '';
    if (g.kind === 'main'){ const s = P.sources[g.si];
      if (hasVid(s)){ const [sw, sh] = dispSize(s); thumbs(b, s.uri, g.in - s.off, g.out - g.in, sw / sh, g.speed || 1); } else b.classList.add('audio');
      wave(b, s, g.in - s.off, g.out - g.in, g.speed || 1);
      if (multi && g.si !== lastSi) lbl = `${g.si + 1} · `; lastSi = g.si;
      const fb = fxBadges(g.fx); if (fb) b.insertAdjacentHTML('beforeend', `<span class="badge">${fb}</span>`); }
    else { const c = g.item.clip; thumbs(b, c.uri, g.in, g.out - g.in, (c.width && c.height) ? dispSize(c)[0] / dispSize(c)[1] : asp); lbl = 'Einschub · '; }
    b.insertAdjacentHTML('beforeend', `<span class="lbl">${lbl}${fmtD(d)} s</span>`);
    tr.append(b);
  });
}
function renderOvl(pad){
  const tr = $('#trOvl'); tr.querySelectorAll('.blk').forEach(x => x.remove());
  for (const o of overlays){
    const b = blk('ovl' + (o.x.type === 'pip' ? ' pip' : ''), o.at, o.end - o.at, pad, {id: o.x.id});
    b.insertAdjacentHTML('beforeend', `<span class="txt"></span>`); b.querySelector('.txt').textContent = (o.x.type === 'pip' ? '▣ ' : '🎞 ') + o.x.clip.name;
    tr.append(b);
  }
}
function renderFx(pad){
  const tr = $('#trFx'); tr.querySelectorAll('.blk').forEach(x => x.remove());
  for (const z of P.items.filter(x => x.type === 'zoom' || x.type === 'fx')){
    const [a, e] = itemOutRange(z);
    const b = blk(z.type, a, e - a, pad, {id: z.id});
    const txt = z.type === 'zoom' ? `🔍 ${z.kind === 'punch' ? 'Sprung' : z.kind === 'in' ? 'rein' : 'raus'} ${z.strength.toFixed(2).replace('.', ',')}×` : ('⚙ ' + (fxBadges({...FX_DEF, ...z.fx}) || 'Anpassung'));
    b.insertAdjacentHTML('beforeend', `<span class="txt">${esc(txt)}</span>`);
    tr.append(b);
  }
}
function renderTitles(pad){
  const tr = $('#trTitle'); tr.querySelectorAll('.blk').forEach(x => x.remove());
  for (const t of P.items.filter(x => x.type === 'title')){
    const [a, e] = itemOutRange(t);
    const b = blk('title', a, e - a, pad, {id: t.id});
    b.insertAdjacentHTML('beforeend', `<span class="txt"></span>`); b.querySelector('.txt').textContent = 'T ' + (t.text || 'Titel');
    tr.append(b);
  }
}
function renderTxt(pad){
  const tr = $('#trTxt'); tr.innerHTML = '';
  if (!tokens.length || S().enabled === false){ tr.innerHTML = '<span class="track-ph">Untertitel aus</span>'; return; }
  const frag = document.createDocumentFragment();
  for (const c of P.cues){
    const t = cueTimes(c); if (!t) continue;
    const b = blk('cue' + (c.off ? ' off' : '') + (isFree(c) ? ' free' : ''), t.s, Math.max(0.1, t.e - t.s), pad, {cid: c.id});
    const sp = document.createElement('span'); sp.className = 'txt'; sp.textContent = cueText(c); b.append(sp);
    frag.append(b);
  }
  tr.append(frag);
}

// ───────── Zeiger ─────────
function placeHead(o){
  $('#tlTime').textContent = fmtS(o);
  if (TL.mode === 'center'){ playline.style.left = '50%'; return; }
  const x = padL() + o * TL.pps - tlEl.scrollLeft;
  playline.style.left = x + 'px';
  playline.classList.toggle('hidden', x < -2 || x > tlEl.clientWidth + 2);
}
// Beim Abspielen folgen: fester Zeiger → Spur scrollt; bewegter Zeiger → Seitenwechsel am Rand
function followHead(o){
  if (TL.mode === 'center'){ syncScroll(o); return; }
  const x = padL() + o * TL.pps - tlEl.scrollLeft, W = tlEl.clientWidth;
  if (x > W - 24 || x < 0){ TL.expect = -1; tlEl.scrollLeft = Math.max(0, padL() + o * TL.pps - 40); }
  placeHead(o);
}
function syncScroll(o, force){
  if (TL.mode !== 'center'){ placeHead(o); return; }
  const x = Math.round(o * TL.pps);
  if (force || Math.abs(tlEl.scrollLeft - x) >= 1){ TL.expect = x; tlEl.scrollLeft = x; }
  $('#tlTime').textContent = fmtS(o);
}
// Zeiger sichtbar machen (nach Tastatur-Spulen o. ä.)
function revealHead(o){
  if (TL.mode === 'center'){ syncScroll(o, true); return; }
  const x = padL() + o * TL.pps - tlEl.scrollLeft, W = tlEl.clientWidth;
  if (x < 0 || x > W - 10){ TL.expect = -1; tlEl.scrollLeft = Math.max(0, padL() + o * TL.pps - W * 0.3); }
  placeHead(o);
}
tlEl.addEventListener('scroll', () => {
  if (TL.mode !== 'center'){ placeHead(outPos); return; }
  if (Math.abs(tlEl.scrollLeft - TL.expect) < 1.5 || TL.pinch) return;
  TL.expect = -1;
  const o = clamp(tlEl.scrollLeft / TL.pps, 0, total);
  if (playing) pausePlay();
  $('#tlTime').textContent = fmtS(o);
  const first = TL.seekPending == null; TL.seekPending = o;
  if (first) requestAnimationFrame(() => { const v = TL.seekPending; TL.seekPending = null; seekOut(v, false); TL.expect = Math.round(v * TL.pps); });
}, {passive:true});
(function follow(){ if (P && studioOn() && playing && !TL.drag) followHead(outPos); requestAnimationFrame(follow); })();
function setMode(m){ TL.mode = m; try { localStorage.setItem('ts-tl-mode', m); } catch(_){} tlEl.classList.toggle('mode-move', m === 'move'); renderTimeline(); revealHead(outPos); }
tlEl.classList.toggle('mode-move', TL.mode === 'move');
// Zeit unter einem Bildschirm-X
const timeAtX = clientX => clamp((clientX - tlInner.getBoundingClientRect().left - padL()) / TL.pps, 0, total);
// Zeiger greifen und ziehen (bewegter Modus)
playline.addEventListener('pointerdown', e => {
  if (TL.mode !== 'move') return; e.preventDefault(); e.stopPropagation(); playline.setPointerCapture(e.pointerId);
  const was = playing; if (was) pausePlay(); TL.headDrag = true;
  const mv = ev => { seekOut(timeAtX(ev.clientX), false); placeHead(outPos); };
  playline.onpointermove = mv; playline.onpointerup = () => { playline.onpointermove = null; playline.onpointerup = null; TL.headDrag = false; };
});

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
    let i = timeline.findIndex(g => g.kind === s.kind && (s.kind === 'insert' ? g.item.id === s.itemId : (s.src >= g.in - 1e-3 && s.src <= g.out + 1e-3)));
    if (i < 0){ TL.sel = null; return; } s.i = i;
  }
  const b = selBlock(); if (b) b.classList.add('sel'); else TL.sel = null;
}
function select(sel){
  tlInner.querySelectorAll('.blk.sel').forEach(x => x.classList.remove('sel'));
  TL.sel = sel; const b = selBlock(); if (b) b.classList.add('sel'); else TL.sel = null;
  updateTools(); if (P) updateTitles(outPos);
}
function selectBlock(b){
  const tr = b.parentElement.id;
  if (tr === 'trMain'){ const g = timeline[+b.dataset.i]; select(g.kind === 'insert' ? {kind:'insert', i:+b.dataset.i, itemId:g.item.id} : {kind:'main', i:+b.dataset.i, src:(g.in + g.out) / 2}); }
  else if (tr === 'trTxt') select({kind:'cue', id:b.dataset.cid});
  else { const it = P.items.find(x => x.id === b.dataset.id); if (!it) return; select({kind: it.type === 'zoom' ? 'zoom' : it.type === 'fx' ? 'fx' : it.type === 'title' ? 'title' : 'ovl', id: it.id}); }
}
tlInner.addEventListener('click', e => {
  if (TL.drag && TL.drag.moved) return;
  const b = e.target.closest('.blk');
  if (!b){ select(null); if (TL.mode === 'move' && !e.target.closest('.ruler')){ if (playing) pausePlay(); seekOut(timeAtX(e.clientX), false); placeHead(outPos); } return; }
  if (b.classList.contains('sel') && TL.justSelected){ TL.justSelected = false; return; }
  selectBlock(b);
});
// Rechtsklick: Menü mit den Werkzeugen der Auswahl
tlInner.addEventListener('contextmenu', e => {
  const b = e.target.closest('.blk'); e.preventDefault();
  if (b) selectBlock(b); else select(null);
  showMenu(e.clientX, e.clientY, toolList());
});
function showMenu(x, y, list){
  closeMenu();
  const m = document.createElement('div'); m.className = 'ctx'; m.id = 'ctxMenu';
  for (const t of list){ const b = document.createElement('button'); b.innerHTML = `<i>${t.icon}</i>${t.label}`; if (t.cls) b.classList.add(t.cls); b.onclick = () => { closeMenu(); t.fn(); }; m.append(b); }
  document.body.append(m);
  const r = m.getBoundingClientRect(); m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px'; m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', closeMenuOutside, {once:true}), 0);
}
function closeMenuOutside(e){ if (!e.target.closest('#ctxMenu')) closeMenu(); else document.addEventListener('pointerdown', closeMenuOutside, {once:true}); }
function closeMenu(){ const m = $('#ctxMenu'); if (m) m.remove(); }

// Zoomen der Zeitleiste (Zeiger bleibt an Ort und Stelle)
function setPps(p){
  const x = TL.mode === 'move' ? padL() + outPos * TL.pps - tlEl.scrollLeft : null;
  TL.pps = clamp(p, 6, 800); renderTimeline();
  if (x != null){ TL.expect = -1; tlEl.scrollLeft = Math.max(0, padL() + outPos * TL.pps - x); placeHead(outPos); }
  paintBar();
}
$('#tlIn').onclick = () => setPps(TL.pps * 1.6);
$('#tlOut').onclick = () => setPps(TL.pps / 1.6);
$('#tlFit').onclick = () => fitTimeline();
$('#tlZoom').oninput = e => setPps(6 * Math.pow(800 / 6, +e.target.value / 100));
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

// ───────── Ziehen: Griffe (Trimmen) und Verschieben, mit Einrasten ─────────
function snapPoints(exclude){
  const pts = [outPos, 0, total];
  timeline.forEach(g => { pts.push(g.o, g.o + segDur(g)); });
  for (const it of P.items){ if (it === exclude || it.type === 'insert') continue; const [a, e] = itemOutRange(it); pts.push(a, e); }
  for (const o of overlays){ if (o.x === exclude) continue; pts.push(o.at, o.end); }
  return pts;
}
function snapTo(val, pts){ if (!TL.snap) return val; let best = val, bd = 7 / TL.pps; for (const p of pts){ const d = Math.abs(p - val); if (d < bd){ bd = d; best = p; } } return best; }
tlInner.addEventListener('pointerdown', e => {
  if (e.button === 2) return;
  let b = e.target.closest('.blk.sel');
  if (!b && e.pointerType === 'mouse' && e.button === 0){   // mit der Maus: Clip direkt greifen
    const nb = e.target.closest('.blk'); if (!nb) return; selectBlock(nb); TL.justSelected = true; b = selBlock(); if (!b) return; }
  if (!b) return;
  const h = e.target.closest('.h');
  e.preventDefault(); b.setPointerCapture(e.pointerId);
  const s = TL.sel, it = s.kind === 'ovl' || s.kind === 'zoom' || s.kind === 'fx' || s.kind === 'title' ? selItem() : null;
  TL.drag = {b, side: h ? (h.classList.contains('l') ? 'l' : 'r') : 'm', x0: e.clientX, left0: parseFloat(b.style.left), w0: parseFloat(b.style.width), moved: false, d: 0, pts: snapPoints(it)};
  if (playing) pausePlay();
});
tlInner.addEventListener('pointermove', e => {
  const g = TL.drag; if (!g) return;
  const dx = e.clientX - g.x0; if (Math.abs(dx) > 3) g.moved = true; if (!g.moved) return;
  g.ptr = (e.clientX - tlInner.getBoundingClientRect().left - padL()) / TL.pps;   // Zeit unter dem Mauszeiger
  const s = TL.sel, isMain = s.kind === 'main' || s.kind === 'insert';
  let d = dx / TL.pps;
  // Einrasten: die bewegte Kante an Kanten anderer Elemente / den Zeiger
  if (!(isMain && g.side === 'm')){
    const [a0, e0] = isMain ? [timeline[s.i].o, timeline[s.i].o + segDur(timeline[s.i])] : s.kind === 'cue' ? (() => { const t = cueTimes(selCue()); return t ? [t.s, t.e] : [0, 0]; })() : itemOutRange(selItem());
    const edge = g.side === 'l' ? a0 : g.side === 'r' ? e0 : a0;
    const sn = snapTo(edge + d, g.pts); d = sn - edge;
  }
  if (isMain) d = snapF(d);
  d = clampDrag(g.side, d); g.d = d; const px = d * TL.pps;
  if (g.side === 'l'){ g.b.style.left = (g.left0 + px) + 'px'; g.b.style.width = Math.max(4, g.w0 - px) + 'px'; }
  else if (g.side === 'r') g.b.style.width = Math.max(4, g.w0 + px) + 'px';
  else g.b.style.left = (g.left0 + px) + 'px';
  previewDrag(g.side, d);
  $('#tlInfo').textContent = (g.side === 'm' ? 'Verschieben ' : g.side === 'l' ? 'Anfang ' : 'Ende ') + (d >= 0 ? '+' : '−') + fmtD(Math.abs(d)) + ' s' + (isMain ? ` (${Math.round(Math.abs(d) * fps())} Bilder)` : '');
});
function endDrag(){
  const g = TL.drag; if (!g) return;
  setTimeout(() => { TL.drag = null; }, 0);
  if (!g.moved || Math.abs(g.d) < 1e-4){ tlInner.querySelectorAll('.drop-line').forEach(x => x.remove()); updateTools(); return; }
  applyDrag(g.side, g.d);
}
tlInner.addEventListener('pointerup', endDrag);
tlInner.addEventListener('pointercancel', endDrag);

function selItem(){ return TL.sel && P.items.find(x => x.id === TL.sel.id); }
function selCue(){ return TL.sel && P.cues.find(c => c.id === TL.sel.id); }
function clampDrag(side, d){
  const s = TL.sel;
  if ((s.kind === 'main' || s.kind === 'insert') && side === 'm'){ const g = timeline[s.i]; return clamp(d, -g.o, total - g.o - segDur(g)); }
  if (s.kind === 'main'){ const g = timeline[s.i], len = g.out - g.in;
    if (side === 'l') return clamp(d, edgeMin(g, 'l'), len - 0.1); return clamp(d, -(len - 0.1), edgeMax(g, 'r')); }
  if (s.kind === 'insert'){ const it = timeline[s.i].item;
    return side === 'l' ? clamp(d, -it.in, it.out - it.in - 0.1) : clamp(d, -(it.out - it.in - 0.1), it.clip.duration - it.out); }
  if (s.kind === 'ovl'){ const it = selItem(), [a] = itemOutRange(it);
    if (side === 'l') return clamp(d, -it.in, it.out - it.in - 0.1);
    if (side === 'r') return clamp(d, -(it.out - it.in - 0.1), it.clip.duration - it.out);
    return clamp(d, -a, total - a - 0.1); }
  if (s.kind === 'zoom' || s.kind === 'fx' || s.kind === 'title'){ const it = selItem(), [a, e] = itemOutRange(it);
    if (side === 'l') return clamp(d, -a, e - a - 0.15); if (side === 'r') return clamp(d, -(e - a - 0.15), total - e); return clamp(d, -a, total - e); }
  if (s.kind === 'cue'){ const t = cueTimes(selCue()); if (!t) return 0;
    if (side === 'l') return clamp(d, -t.s, t.e - t.s - 0.2); if (side === 'r') return clamp(d, -(t.e - t.s - 0.2), total - t.e); return clamp(d, -t.s, total - t.e); }
  return d;
}
// Wie weit eine Hauptspur-Kante nach außen darf
function edgeMin(g, side){ const L = g.L || {}; if (L.k === 'adj') return -(g.in - P.sources[g.si].off); if (L.k === 'del') return P.dels[L.di] ? -(P.dels[L.di][1] - P.dels[L.di][0]) : 0; return 0; }
function edgeMax(g, side){ const R = g.R || {}; if (R.k === 'adj') return srcEnd(g.si) - g.out; if (R.k === 'del') return P.dels[R.di] ? P.dels[R.di][1] - P.dels[R.di][0] : 0; return 0; }
function previewDrag(side, d){
  const s = TL.sel; if (side === 'm' && (s.kind === 'main' || s.kind === 'insert')){ dropMark(s, d); return; }
  if (s.kind === 'main'){ const g = timeline[s.i], off = P.sources[g.si].off; seekV(g.si, (side === 'l' ? g.in + d : Math.max(g.in, g.out + d - 0.04)) - off, false); V.style.transform = ''; IV.classList.add('hidden'); II.classList.add('hidden'); }
  if (s.kind === 'insert'){ const g = timeline[s.i]; if (isImg(g.item.clip)) return; const url = MEDIA(g.uri); if (IV.dataset.src !== url){ IV.src = url; IV.dataset.src = url; } IV.classList.remove('hidden'); IV.currentTime = side === 'l' ? g.in + d : g.out + d - 0.04; }
}
// Umsortieren: Clip auf der Hauptspur an eine andere Stelle ziehen
function dropTarget(s, d){
  const g = timeline[s.i], center = TL.drag && TL.drag.ptr != null ? TL.drag.ptr : g.o + segDur(g) / 2 + d;
  const k = timeline.findIndex((x, i) => i !== s.i && x.o + segDur(x) / 2 > center);
  return k < 0 ? null : k;
}
function dropMark(s, d){
  tlInner.querySelectorAll('.drop-line').forEach(x => x.remove());
  const k = dropTarget(s, d), x = k == null ? total : timeline[k].o;
  const m = document.createElement('div'); m.className = 'drop-line'; m.style.left = (padL() + x * TL.pps - 1) + 'px'; $('#trMain').append(m);
}
function reorderDrop(s, d){
  const g = timeline[s.i], k = dropTarget(s, d);
  if (k === s.i + 1 || (k == null && s.i === timeline.length - 1)) return false;
  const tg = k == null ? null : timeline[k];
  const to = tg == null ? null : (tg.kind === 'main' ? tg.in : snapSrc(tg.item.at));
  if (s.kind === 'main'){ P.moves.push({a: r3(g.in), b: r3(g.out), to: to == null ? null : r3(to)}); P.splits.push(r3(g.in), r3(g.out)); if (to != null) P.splits.push(r3(to)); s.src = g.in + 0.05; }
  else g.item.at = to == null ? r3(srcTotal) : r3(to);
  return true;
}
function applyDrag(side, d){
  const s = TL.sel;
  tlInner.querySelectorAll('.drop-line').forEach(x => x.remove());
  if (side === 'm' && (s.kind === 'main' || s.kind === 'insert')){
    if (TL.drag && TL.drag.ptr == null) return;
    let moved = false; commit(() => { moved = reorderDrop(s, d); }, true);
    if (moved){ if (tokens.length) renderTranscript(); toast('Clip verschoben – Strg+Z macht es rückgängig'); } else renderTimeline();
    return;
  }
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
    } else if (s.kind === 'zoom' || s.kind === 'fx'){
      const it = selItem(), [a, e] = itemOutRange(it);
      const na = side === 'r' ? a : a + d, ne = side === 'l' ? e : e + d;
      const sa = outToSrc(na), se = outToSrc(ne);
      it.at = +sa.toFixed(3); it.dur = +Math.max(0.15, se - sa).toFixed(3);
    } else if (s.kind === 'title'){
      const it = selItem(), [a] = itemOutRange(it);
      if (side === 'l'){ it.at = +outToSrc(a + d).toFixed(3); it.dur = +Math.max(0.3, it.dur - d).toFixed(2); }
      else if (side === 'r') it.dur = +Math.max(0.3, it.dur + d).toFixed(2);
      else it.at = +outToSrc(a + d).toFixed(3);
    } else if (s.kind === 'cue'){
      const c = selCue(), t = cueTimes(c); if (!t) return;
      if (side === 'l') setCueFree(c, Math.min(t.s + d, t.e - 0.2), t.e); else if (side === 'r') setCueFree(c, t.s, t.e + d);
      else { const len = t.e - t.s, ns = clamp(t.s + d, 0, Math.max(0, total - len)); setCueFree(c, ns, ns + len); }
    }
  }, false);
  tokens.forEach(t => paint(t.i));
}

// ───────── Werkzeuge ─────────
const T = (icon, label, fn, cls = '') => ({icon, label, fn, cls});
function toolList(){
  const s = TL.sel; const g = s && (s.kind === 'main' || s.kind === 'insert') ? timeline[s.i] : null;
  if (!s) return [T('✂', 'Teilen', splitHere), T('⌫', 'Bis hier weg', () => cutTo('l')), T('⌦', 'Ab hier weg', () => cutTo('r')), T('＋', 'Clip', addClip), T('T', 'Titel', addTitle), T('🔍', 'Zoom', addZoom),
    ...(P.moves.length ? [T('↺', 'Reihenfolge zurück', () => { commit(() => P.moves = [], true); if (tokens.length) renderTranscript(); toast('Ursprüngliche Reihenfolge'); })] : [])];
  if (s.kind === 'main') return [T('✂', 'Teilen', splitHere), T('⚙', 'Anpassen', () => openFx(g)), T('🗑', 'Löschen', delSel, 'danger'), T('⇤', 'Anfang −1', () => nudge('l', -1)), T('⇥', 'Anfang +1', () => nudge('l', 1)),
    T('⇤', 'Ende −1', () => nudge('r', -1)), T('⇥', 'Ende +1', () => nudge('r', 1)), T('🔍', 'Zoom', addZoom), T('T', 'Titel', addTitle), T('＋', 'Clip', addClip)];
  if (s.kind === 'insert') return [T('🎞', 'Ausschnitt', () => openItem(g.item.id)), T('🗑', 'Löschen', delSel, 'danger'), T('⇄', 'Als B-Roll', () => convert('broll'))];
  if (s.kind === 'ovl'){ const it = selItem(); return [T('🎞', 'Ausschnitt', () => openItem(it.id)), T('🗑', 'Löschen', delSel, 'danger'),
    T(it.type === 'pip' ? '▣' : '◰', it.type === 'pip' ? 'Vollbild' : 'Bild-im-Bild', () => convert(it.type === 'pip' ? 'broll' : 'pip')),
    ...(it.type === 'pip' ? [T('↗', 'Ecke', cycleCorner), T('⤢', 'Größe', cycleSize)] : []), T('⇄', 'Als Einschub', () => convert('insert'))]; }
  if (s.kind === 'zoom'){ const it = selItem(); return [T('◎', 'Mittelpunkt', () => openItem(it.id)), T('⟳', it.kind === 'punch' ? 'Sprung' : it.kind === 'in' ? 'Fahrt rein' : 'Fahrt raus', cycleZoomKind),
    T('−', 'Schwächer', () => zoomStrength(-0.05)), T('＋', 'Stärker', () => zoomStrength(0.05)), T('🗑', 'Löschen', delSel, 'danger')]; }
  if (s.kind === 'fx'){ const it = selItem(); return [T('⚙', 'Anpassen', () => openFxItem(it)), T('🗑', 'Löschen', delSel, 'danger')]; }
  if (s.kind === 'title'){ const it = selItem(); return [T('✎', 'Text & Stil', () => editTitle(it.id)), T('🗑', 'Löschen', delSel, 'danger')]; }
  if (s.kind === 'cue'){ const c = selCue(); return [T('✎', 'Text', editCue), T('✂', 'Teilen', splitCue), T(c && c.off ? '👁' : '⦸', c && c.off ? 'Einblenden' : 'Ausblenden', () => { commit(() => c.off = !c.off, false); }),
    ...(c && c.x != null ? [T('⌖', 'Position ↺', () => { commit(() => { delete c.x; delete c.y; }, false); placeOverlay(); })] : []),
    ...(c && (isFree(c) || c.ds || c.de) ? [T('↺', 'Zeit ↺', () => { commit(() => { delete c.fa; delete c.fd; c.ds = 0; c.de = 0; }, false); })] : [])]; }
  return [];
}
function updateTools(){
  const box = $('#tools'); box.innerHTML = ''; const s = TL.sel;
  const g = s && (s.kind === 'main' || s.kind === 'insert') ? timeline[s.i] : null;
  for (const t of toolList()){ const b = document.createElement('button'); b.className = 'tool ' + t.cls; b.innerHTML = `<i>${t.icon}</i>${t.label}`; b.onclick = t.fn; box.append(b); }
  $('#selLbl').textContent = !s ? 'Abspiellinie' : s.kind === 'main' ? 'Clip' : s.kind === 'insert' ? 'Einschub' : s.kind === 'cue' ? 'Untertitel' : TYPE_LBL[(selItem() || {}).type] || '';
  const info = $('#tlInfo');
  if (!s) info.textContent = FINE ? 'Klick in die Spur setzt den Zeiger · Clip anklicken oder ziehen · Rechtsklick für Werkzeuge · ⌨ zeigt alle Tastenkürzel' : 'Wische zum Spulen · zwei Finger zoomen · Clip antippen zum Bearbeiten';
  else if (g) info.textContent = `${fmtS(g.o)} – ${fmtS(g.o + segDur(g))} (${fmtD(segDur(g))} s)${g.fx && fxBadges(g.fx) ? ' · ' + fxBadges(g.fx) : ''} · Griffe ziehen zum Trimmen · Clip ziehen zum Umsortieren`;
  else if (s.kind === 'cue'){ const c = selCue(), t = c && cueTimes(c); info.textContent = t ? `${fmtS(t.s)} – ${fmtS(t.e)}${isFree(c) ? ' · Zeit frei gesetzt' : ''} · ziehen verschiebt, Griffe ändern Anfang/Ende – der Schnitt bleibt gleich · im Bild ziehen setzt die Position nur für diesen` : 'Untertitel'; }
  else { const it = selItem(); if (it){ const [a, e] = itemOutRange(it); info.textContent = `${fmtS(a)} – ${fmtS(e)} · ziehen zum Verschieben, Griffe zum Trimmen${it.type === 'title' ? ' · im Bild ziehen zum Platzieren, Doppelklick zum Bearbeiten' : ''}`; } }
}
function paintBar(){
  $('#modeBtn').classList.toggle('on', TL.mode === 'move'); $('#modeBtn').title = TL.mode === 'move' ? 'Zeiger läuft über die Spur (klicken: fester Zeiger in der Mitte)' : 'Fester Zeiger, Spur bewegt sich (klicken: laufender Zeiger)';
  $('#snapBtn').classList.toggle('on', TL.snap);
  $('#tlZoom').value = Math.round(Math.log(TL.pps / 6) / Math.log(800 / 6) * 100);
}
$('#modeBtn').onclick = () => setMode(TL.mode === 'move' ? 'center' : 'move');
$('#snapBtn').onclick = () => { TL.snap = !TL.snap; try { localStorage.setItem('ts-tl-snap', TL.snap ? '1' : '0'); } catch(_){} paintBar(); toast(TL.snap ? 'Einrasten an' : 'Einrasten aus'); };
$('#barSplit').onclick = () => splitHere();
$('#barDel').onclick = () => { if (TL.sel) delSel(); else toast('Erst einen Clip auswählen'); };
$('#barClip').onclick = () => addClip();
$('#barTitle').onclick = () => addTitle();
$('#barZoom').onclick = () => addZoom();
$('#barFx').onclick = () => { const g = curMainSeg(); if (!g) return toast('Abspiellinie auf einen Clip setzen'); openFx(g); };
$('#barUndo').onclick = () => $('#undoBtn').click();
$('#barRedo').onclick = () => $('#redoBtn').click();

function curMainSeg(){ const g = timeline[curSeg]; return g && g.kind === 'main' ? g : null; }
function splitHere(){
  const g = curMainSeg(); if (!g) return toast('Abspiellinie auf einen Clip der Hauptspur setzen');
  const x = vT(); if (x - g.in < 0.05 || g.out - x < 0.05) return toast('Zu nah an einer Kante');
  commit(() => P.splits.push(+x.toFixed(3)), false); select({kind:'main', i: segAtOut(outPos), src: x + 0.05}); toast('Geteilt');
}
function cutTo(side){
  const g = curMainSeg(); if (!g) return;
  const x = vT();
  commit(() => side === 'l' ? addDel(g.in, x) : addDel(x, g.out), false); tokens.forEach(t => paint(t.i));
}
function delSel(){
  const s = TL.sel; if (!s) return;
  if (s.kind === 'main'){ const g = timeline[s.i]; commit(() => addDel(g.in, g.out), false); tokens.forEach(t => paint(t.i)); toast('Clip gelöscht'); }
  else if (s.kind === 'insert'){ const id = timeline[s.i].item.id; commit(() => P.items = P.items.filter(x => x.id !== id), false); }
  else if (s.kind === 'cue'){ const c = selCue(); commit(() => c.off = true, false); }
  else { commit(() => P.items = P.items.filter(x => x.id !== s.id), false); }
  TL.sel = null; renderTimeline(); updateTitles(outPos);
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
  body.innerHTML = `<h3>Clip einfügen an der Abspiellinie</h3><p class="muted small">Videos und Fotos</p><div class="choice">
    <button class="tile" data-t="broll"><b>B-Roll</b><span>Bild drüber, dein Ton läuft weiter</span></button>
    <button class="tile" data-t="insert"><b>Einschub</b><span>Hauptvideo pausiert, Clip läuft mit eigenem Ton</span></button>
    <button class="tile" data-t="pip"><b>Bild-im-Bild</b><span>kleines Fenster in einer Ecke</span></button></div>`;
  openSheet(false);
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
// ── Titel ──
function addTitle(){
  const at = +outToSrc(outPos).toFixed(3);
  let it; commit(() => { it = {id:newId(), type:'title', at, dur:3, text:'Titel', x:0.5, y:0.2, size:'groß', scale:1, color:'#FFFFFF', outline:true, bg:false}; P.items.push(it); }, false);
  select({kind:'title', id: it.id}); updateTitles(outPos); editTitle(it.id);
}
function editTitle(id){
  const it = P.items.find(x => x.id === id); if (!it) return;
  const body = $('#sheetBody');
  body.innerHTML = `<h3>Titel</h3><textarea id="ttText" rows="2" style="width:100%;font:17px/1.3 var(--ui)"></textarea>
    <div class="grid2" style="margin-top:10px">
      <label>Größe <select id="ttSize"><option value="klein">klein</option><option value="mittel">mittel</option><option value="groß">groß</option></select></label>
      <label>Skalierung <input type="range" id="ttScale" min="0.5" max="3" step="0.1"></label>
      <label>Farbe <input type="color" id="ttColor"></label>
      <label>Schrift <select id="ttFont" class="font-sel"></select></label>
      <label>Dauer (s) <input type="number" id="ttDur" min="0.3" max="600" step="0.5"></label>
      <label class="row"><input type="checkbox" id="ttOutline"> Umrandung</label>
      <label class="row"><input type="checkbox" id="ttBg"> dunkler Hintergrund</label>
    </div>
    <p class="muted small">Position: den Titel direkt im Bild ziehen.</p>
    <div class="row" style="margin-top:10px"><button class="btn danger" id="ttDel">Entfernen</button><button class="btn primary" id="ttOk" style="margin-left:auto">Fertig</button></div>`;
  $('#ttText').value = it.text || ''; $('#ttSize').value = it.size || 'groß'; $('#ttScale').value = it.scale || 1; $('#ttColor').value = (it.color || '#FFFFFF').toLowerCase(); $('#ttDur').value = it.dur; $('#ttOutline').checked = it.outline !== false; $('#ttBg').checked = !!it.bg;
  fillFontSelects(); $('#ttFont').value = it.font && fontOf(it.font).key ? it.font : '';
  $('#ttFont').addEventListener('change', async () => { if ($('#ttFont').value !== '__import') return; const f = await importFont(); fillFontSelects(); $('#ttFont').value = f ? f.key : (it.font || ''); upd(); });
  openSheet(true);
  const before = snapshot();
  const upd = () => { it.text = $('#ttText').value; it.size = $('#ttSize').value; it.scale = +$('#ttScale').value; it.color = $('#ttColor').value.toUpperCase(); it.dur = clamp(+$('#ttDur').value || 3, 0.3, 600); it.outline = $('#ttOutline').checked; it.bg = $('#ttBg').checked; if ($('#ttFont').value !== '__import') it.font = $('#ttFont').value; changed(true); updateTitles(outPos); };
  ['ttText', 'ttSize', 'ttScale', 'ttColor', 'ttFont', 'ttDur', 'ttOutline', 'ttBg'].forEach(i => { $('#' + i).addEventListener('input', upd); $('#' + i).addEventListener('change', upd); });
  $('#ttOk').onclick = () => { undo.push(before); redo = []; closeSheet(); };
  $('#ttDel').onclick = () => { closeSheet(); commit(() => P.items = P.items.filter(x => x !== it)); updateTitles(outPos); };
  body.onclick = null; setTimeout(() => { $('#ttText').focus(); $('#ttText').select(); }, 30);
}
// ── Anpassen (Geschwindigkeit, Lautstärke, Farbe) ──
function openFx(g){
  // vorhandene Anpassung, die genau diesen Clip abdeckt, sonst neue anlegen
  let it = P.items.find(x => x.type === 'fx' && x.at <= g.in + 0.01 && x.at + x.dur >= g.out - 0.01);
  if (!it){ it = {id:newId(), type:'fx', at:r3(g.in), dur:r3(g.out - g.in), fx:{...FX_DEF}}; commit(() => P.items.push(it), true); }
  openFxItem(it);
}
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
function openFxItem(it){
  it.fx = {...FX_DEF, ...(it.fx || {})};
  const body = $('#sheetBody');
  body.innerHTML = `<h3>Anpassen</h3>
    <div class="field"><span>Geschwindigkeit <b id="fxSpeedV"></b></span><div class="seg-ctl" id="fxSpeed">${SPEEDS.map(v => `<button data-v="${v}">${String(v).replace('.', ',')}×</button>`).join('')}</div></div>
    <div class="field"><span>Lautstärke <b id="fxVolV"></b></span><input type="range" id="fxVol" min="0" max="2" step="0.05"></div>
    <div class="field"><span>Helligkeit <b id="fxBrightV"></b></span><input type="range" id="fxBright" min="-0.5" max="0.5" step="0.02"></div>
    <div class="field"><span>Kontrast <b id="fxContrastV"></b></span><input type="range" id="fxContrast" min="-0.5" max="0.5" step="0.02"></div>
    <div class="field"><span>Sättigung <b id="fxSatV"></b></span><input type="range" id="fxSat" min="-100" max="100" step="5"></div>
    <label class="row"><input type="checkbox" id="fxGray"> Schwarzweiß</label>
    <p class="muted small">Gilt für den gewählten Bereich (${fmtS(itemOutRange(it)[0])} – ${fmtS(itemOutRange(it)[1])}). Lautstärke über 100 % hört man erst im Export.</p>
    <div class="row" style="margin-top:12px"><button class="btn" id="fxReset">Zurücksetzen</button><button class="btn danger" id="fxDel">Entfernen</button><button class="btn primary" id="fxOk" style="margin-left:auto">Fertig</button></div>`;
  openSheet(true);
  const before = snapshot();
  const paint = () => { const f = it.fx; $$('#fxSpeed button').forEach(b => b.classList.toggle('on', Math.abs(+b.dataset.v - f.speed) < 0.001)); $('#fxSpeedV').textContent = String(f.speed).replace('.', ',') + '×';
    $('#fxVol').value = f.vol; $('#fxVolV').textContent = Math.round(f.vol * 100) + '%'; $('#fxBright').value = f.bright; $('#fxBrightV').textContent = Math.round(f.bright * 100); $('#fxContrast').value = f.contrast; $('#fxContrastV').textContent = Math.round(f.contrast * 100);
    $('#fxSat').value = f.sat; $('#fxSatV').textContent = f.sat; $('#fxGray').checked = !!f.gray; };
  paint();
  const upd = () => { it.fx.vol = +$('#fxVol').value; it.fx.bright = +$('#fxBright').value; it.fx.contrast = +$('#fxContrast').value; it.fx.sat = +$('#fxSat').value; it.fx.gray = $('#fxGray').checked; paint(); changed(true); seekOut(outPos, false); };
  ['fxVol', 'fxBright', 'fxContrast', 'fxSat', 'fxGray'].forEach(i => $('#' + i).addEventListener('input', upd));
  $('#fxSpeed').onclick = e => { const b = e.target.closest('button'); if (!b) return; it.fx.speed = +b.dataset.v; paint(); changed(true); seekOut(outPos, false); };
  $('#fxReset').onclick = () => { it.fx = {...FX_DEF}; paint(); changed(true); seekOut(outPos, false); };
  $('#fxDel').onclick = () => { closeSheet(); commit(() => P.items = P.items.filter(x => x !== it)); };
  $('#fxOk').onclick = () => { const same = JSON.stringify(it.fx) === JSON.stringify(FX_DEF); if (same) P.items = P.items.filter(x => x !== it); undo.push(before); redo = []; closeSheet(); changed(true); };
  body.onclick = null;
}
function editCue(){
  const c = selCue(); if (!c) return;
  const body = $('#sheetBody');
  body.innerHTML = `<h3>Untertitel</h3><textarea id="cueEdit" rows="3" style="width:100%;font:17px/1.4 var(--read)"></textarea>
    <div class="row" style="margin-top:10px"><button class="btn" id="cueAuto">↺ gesprochener Text</button><button class="btn primary" id="cueOk" style="margin-left:auto">Fertig</button></div>`;
  $('#cueEdit').value = cueText(c);
  openSheet(false);
  const before = snapshot();
  $('#cueAuto').onclick = () => { $('#cueEdit').value = autoText(c); };
  $('#cueOk').onclick = () => { const v = $('#cueEdit').value; c.text = v.trim() === autoText(c) ? null : v; undo.push(before); redo = []; closeSheet(); changed(false); };
  body.onclick = null;
}
function splitCue(){
  const c = selCue(); if (!c) return; const ids = cueWords(c); if (ids.length < 2) return toast('Zu wenige Wörter');
  const x = curSrc(); let k = ids.findIndex(i => tokens[i].ws >= x); if (k <= 0) k = Math.ceil(ids.length / 2);
  const idx = P.cues.indexOf(c);
  commit(() => { const c2 = {id:newId(), a: ids[k-1] + 1, b: c.b, text:null, ds:0, de:c.de || 0, off:c.off}; c.b = ids[k-1]; c.text = null; c.de = 0; delete c.fa; delete c.fd; P.cues.splice(idx + 1, 0, c2); }, false);
}

// ───────── Tastatur (wie CapCut) und Maus ─────────
const KEYS = [
  ['Leertaste', 'Abspielen / Pause'], ['K / L', 'Pause / Abspielen'],
  ['← / →', 'ein Bild zurück / vor'], ['Umschalt + ← / →', 'fünf Bilder zurück / vor'],
  ['↑ / ↓', 'zum vorigen / nächsten Schnitt springen'], ['Pos1 / Ende', 'an den Anfang / das Ende'],
  ['Strg + F', 'im Text suchen (Enter: nächster Treffer, dann Entf löscht)'], ['Strg + H', 'suchen und ersetzen'], ['Doppelklick auf ein Wort', 'Wort korrigieren'],
  ['Markierten Text ziehen', 'Abschnitt verschieben'], ['Clip in der Zeitleiste ziehen', 'Clips umsortieren'],
  ['Strg + B', 'an der Abspiellinie teilen'], ['Q / W', 'links / rechts der Abspiellinie löschen'],
  ['Entf / Rücktaste', 'Auswahl löschen'], ['Alt + ← / →', 'Auswahl um ein Bild verschieben'],
  [', / .', 'Anfang / Ende der Auswahl zur Abspiellinie trimmen'],
  ['T', 'Titel an der Abspiellinie'], ['E', 'Clip anpassen (Tempo, Lautstärke, Farbe)'], ['S', 'Einrasten an / aus'],
  ['Strg + Z', 'rückgängig'], ['Strg + Umschalt + Z / Strg + Y', 'wiederholen'],
  ['Strg + + / Strg + −', 'Zeitleiste vergrößern / verkleinern'], ['Strg + 0', 'ganze Zeitleiste zeigen'],
  ['Esc', 'Auswahl aufheben / Fenster schließen'], ['Alt + 1 … 4', 'Text · Untertitel · Studio · Export'],
  ['Mausrad', 'Zeitleiste scrollen (mit Strg: zoomen)'], ['Klick in die Spur', 'Abspiellinie dorthin setzen'], ['Rechtsklick', 'Werkzeuge für den Clip'],
];
$('#keysBtn').onclick = () => {
  const body = $('#sheetBody');
  body.innerHTML = '<h3>Tastenkürzel</h3><div class="keys">' + KEYS.map(([k, v]) => `<kbd>${k}</kbd><span>${v}</span>`).join('') + '</div><div class="row" style="margin-top:12px"><button class="btn primary" id="keysOk" style="margin-left:auto">Schließen</button></div>';
  body.onclick = e => { if (e.target.id === 'keysOk') closeSheet(); };
  openSheet(false);
};

function stepFrames(n){ if (playing) pausePlay(); seekOut(clamp(outPos + n / fps(), 0, total), false); if (studioOn()) revealHead(outPos); }
function editPoints(){
  const pts = new Set([0, total]);
  timeline.forEach(g => { pts.add(+g.o.toFixed(3)); pts.add(+(g.o + segDur(g)).toFixed(3)); });
  overlays.forEach(o => { pts.add(+o.at.toFixed(3)); pts.add(+o.end.toFixed(3)); });
  return [...pts].sort((a, b) => a - b);
}
function jumpEdit(dir){
  const pts = editPoints(), o = outPos;
  const t = dir < 0 ? [...pts].reverse().find(p => p < o - 0.02) : pts.find(p => p > o + 0.02);
  if (t == null) return; if (playing) pausePlay(); seekOut(Math.min(t, Math.max(0, total - 0.01)), false); if (studioOn()) revealHead(outPos);
}
// Kante der Auswahl an die Abspiellinie holen (wie Trimmen in CapCut)
function trimToPlayhead(side){
  const s = TL.sel; if (!s) return toast('Erst einen Clip auswählen');
  let a, e;
  if (s.kind === 'main' || s.kind === 'insert'){ const g = timeline[s.i]; a = g.o; e = g.o + segDur(g); }
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
function fitTimeline(){ if (total > 0){ setPps((tlEl.clientWidth - padL() - 40) / total); TL.expect = -1; tlEl.scrollLeft = 0; placeHead(outPos); } }

document.addEventListener('keydown', e => {
  if (!P || $('#proj').classList.contains('hidden')) return;
  const tag = document.activeElement?.tagName, typing = tag === 'TEXTAREA' || tag === 'SELECT' || (tag === 'INPUT' && !['checkbox', 'radio', 'range'].includes(document.activeElement.type));
  const mod = e.ctrlKey || e.metaKey, k = e.key;
  if (k === 'Escape'){ closeMenu(); if (!$('#sheet').classList.contains('hidden')) closeSheet(); else { select(null); clearSel(); } return; }
  if (typing) return;
  const handled = () => e.preventDefault();
  if (e.altKey && /^[1-4]$/.test(k)){ handled(); const t = ['text', 'subs', 'studio', 'export'][+k - 1]; if (tokens.length || t === 'studio' || t === 'export') setTab(t); return; }
  if (mod && k.toLowerCase() === 'z'){ handled(); (e.shiftKey ? $('#redoBtn') : $('#undoBtn')).click(); return; }
  if (mod && k.toLowerCase() === 'y'){ handled(); $('#redoBtn').click(); return; }
  if (mod && k.toLowerCase() === 'b'){ handled(); splitHere(); return; }
  if (mod && k.toLowerCase() === 'h' && tokens.length){ handled(); if (tab !== 'text') setTab('text'); $('#replRow').classList.remove('hidden'); ($('#findIn').value ? $('#replIn') : $('#findIn')).focus(); return; }
  if (mod && k.toLowerCase() === 'f' && tokens.length){ handled(); if (tab !== 'text') setTab('text'); $('#findIn').focus(); $('#findIn').select(); return; }
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
    case 'Home': handled(); if (playing) pausePlay(); seekOut(0, false); revealHead(0); return;
    case 'End': handled(); if (playing) pausePlay(); seekOut(total, false); revealHead(outPos); return;
    case 'q': case 'Q': handled(); cutTo('l'); return;
    case 'w': case 'W': handled(); cutTo('r'); return;
    case ',': handled(); trimToPlayhead('l'); return;
    case '.': handled(); trimToPlayhead('r'); return;
    case 't': case 'T': if (studioOn()){ handled(); addTitle(); } return;
    case 'e': case 'E': if (studioOn()){ handled(); const g = curMainSeg(); if (g) openFx(g); } return;
    case 's': case 'S': if (studioOn()){ handled(); $('#snapBtn').click(); } return;
    case 'Delete': case 'Backspace':
      handled();
      if (tab === 'text' && selA != null) $('#selDel').click();
      else if (TL.sel) delSel();
      return;
  }
});
// Mausrad: scrollen, mit Strg zoomen
tlEl.addEventListener('wheel', e => {
  if (e.ctrlKey){ e.preventDefault(); setPps(TL.pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15)); return; }
  if (Math.abs(e.deltaY) > Math.abs(e.deltaX)){ e.preventDefault(); if (TL.mode === 'move') TL.expect = -1; tlEl.scrollLeft += e.deltaY; }
}, {passive:false});
// Klick auf die Zeitskala setzt die Abspiellinie
$('#ruler').addEventListener('click', e => {
  const o = timeAtX(e.clientX);
  if (playing) pausePlay(); seekOut(o, false); if (TL.mode === 'center') syncScroll(outPos, true); else placeHead(outPos); e.stopPropagation();
});
// Doppelklick: Untertitel oder Titel bearbeiten, Clip anpassen
tlInner.addEventListener('dblclick', e => {
  const b = e.target.closest('.blk'); if (!b) return;
  if (b.classList.contains('cue')){ select({kind:'cue', id:b.dataset.cid}); editCue(); }
  else if (b.classList.contains('title')){ select({kind:'title', id:b.dataset.id}); editTitle(b.dataset.id); }
  else if (b.classList.contains('fx')){ select({kind:'fx', id:b.dataset.id}); openFxItem(selItem()); }
  else if (b.classList.contains('main')){ selectBlock(b); openFx(timeline[TL.sel.i]); }
});
