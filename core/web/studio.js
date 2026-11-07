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
function renderStudio(){ renderTimeline(); renderBin(); }
function renderTimeline(){
  if (!P || !studioOn()) return;
  const pad = padL();
  tlInner.style.width = Math.ceil(total * TL.pps + pad + half() + 40) + 'px';
  $('#tlTotal').textContent = '/ ' + fmtS(total);
  renderRuler(pad); renderMain(pad); renderOvl(pad); renderAud(pad); renderFx(pad); renderTitles(pad); renderTxt(pad);
  paintLinks(); restoreSel(); updateTools(); paintBar();
  if (TL.mode === 'center') syncScroll(outPos, true); else placeHead(outPos);
}
function renderRuler(pad){
  const r = $('#ruler'); r.innerHTML = '';
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const step = steps.find(s => s * TL.pps >= 64) || 7200, minor = step / 5;
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
// Vorschaubilder nur laden, wenn sie sichtbar werden, und höchstens drei gleichzeitig – sonst belegen sie alle
// Verbindungen und das Video wartet nach dem Springen auf seine Daten.
const THQ = {q: [], act: 0, max: 3};
const thIO = 'IntersectionObserver' in window ? new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting){ thIO.unobserve(e.target); THQ.q.push(e.target); } thPump(); }, {rootMargin: '0px 600px'}) : null;
function thPump(){
  while (THQ.act < THQ.max && THQ.q.length){
    const img = THQ.q.shift(); if (!img.isConnected || !img.dataset.u || img.src) continue;
    THQ.act++; let done = false; const fin = () => { if (done) return; done = true; THQ.act--; thPump(); };
    img.onload = img.onerror = fin; setTimeout(fin, 8000); img.src = img.dataset.u;
  }
}
function thSet(img, u){ if (!thIO || !/^(https?:|[a-z]+\?|thumb)/.test(u) || u.startsWith('data:') || u.startsWith('blob:')) { img.src = u; return; } img.dataset.u = u; thIO.observe(img); }
function thumbs(b, uri, inS, d, aspect, speed = 1){
  const h = 60, tw = Math.max(34, Math.round(h * aspect)), w = d / speed * TL.pps, n = Math.min(400, Math.ceil(w / tw));
  const q = Math.max(0.25, tw / TL.pps / 2);
  const box = document.createElement('div'); box.className = 'thumbs';
  for (let i = 0; i < n; i++){
    const t = Math.round((inS + (i + 0.5) * tw / TL.pps * speed) / q) * q;
    const img = document.createElement('img'); img.loading = 'lazy'; img.decoding = 'async'; img.style.width = tw + 'px'; img.alt = '';
    const u = THUMB(uri, Math.min(t, inS + d), 120); if (u && u.then) u.then(x => { if (x) img.src = x; }); else thSet(img, u); box.append(img);
  }
  b.prepend(box);
}
// Lautstärkeverlauf unten im Clip – so sieht man, wo wirklich gesprochen wird
function wave(b, src, inS, d, speed = 1){
  if (src && !src.env && src.uri){ const ps = P.sources.find(x => x.uri === src.uri && x.env); if (ps) src = ps; }
  const a = src && src.env ? envArr(src) : src && envDone.get(src.uri); if (!a) return;
  // Höhe nach Block: Tonspur ganz, Hauptspur gut ein Drittel, Videospuren knapp die Hälfte; gezeichnet in Gerätepixeln (scharf am Handy)
  const full = b.classList.contains('aud'), ovl = b.classList.contains('ovl'), cs = getComputedStyle(tlInner);
  const bh = parseFloat(cs.getPropertyValue(full ? '--ah' : ovl ? '--oh' : '--mh')) || 60, h = full ? Math.max(14, bh - 6) : Math.max(16, Math.round(bh * (ovl ? 0.45 : 0.36)));
  const w = Math.max(2, Math.round(d / speed * TL.pps)), dpr = Math.min(3, devicePixelRatio || 1), c = document.createElement('canvas'); c.className = 'wave';
  c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.width = w + 'px'; c.style.height = h + 'px';
  const ctx = c.getContext('2d'); ctx.scale(dpr, dpr);
  const bs = (src && src.env && burstsOf(src)) || [];
  // Leicht abgedunkelter Streifen als Hintergrund, Ton als Säulen: Sprache in Orange, Übriges in Creme
  ctx.fillStyle = full ? 'rgba(0,0,0,0)' : 'rgba(0,0,0,.42)'; ctx.fillRect(0, 0, w, h);
  const step = 1 / dpr;
  for (let x = 0; x < w; x += step){
    const t0 = inS + x / TL.pps * speed, t1 = inS + (x + step) / TL.pps * speed; let m = 0;
    for (let i = Math.floor(t0 * 100); i <= Math.floor(t1 * 100) && i < a.length; i++) m = Math.max(m, a[i]);
    const v = Math.max(0, (m / 2.8 - 90 + 60) / 60);
    const sp = bs.some(x => t0 < x[1] && t1 > x[0]);
    ctx.fillStyle = sp ? 'rgba(240,160,30,.95)' : 'rgba(237,231,218,.62)';
    const y = Math.max(v > 0.02 ? 1 : 0, v * (h - 2)); ctx.fillRect(x, h - y, step, y);
  }
  b.append(c);
}
// Vorschaubilder und Tonverlauf eines Clips; dl/dr verschieben Anfang/Ende (beim Ziehen an den Griffen)
const envDone = new Map();   // fertig berechnete Lautstärkeverläufe von Medien, die keine Quelle sind
function paintMedia(b, m, dl = 0, dr = 0){
  if (!m) return; b.querySelectorAll(':scope > .thumbs, :scope > .wave').forEach(x => x.remove());
  const inS = Math.max(0, m.inS + dl), d = Math.max(0.01, m.d - dl + dr);
  if (m.img){ b.style.backgroundImage = `url("${MEDIA(m.img)}")`; b.classList.add('imgblk'); }
  else if (m.uri) thumbs(b, m.uri, inS, d, m.aspect || 16 / 9, m.speed || 1);
  if (m.src) wave(b, m.src, inS, d, m.speed || 1);
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
      const [sw, sh] = dispSize(s); b._m = {uri: hasVid(s) ? s.uri : null, src: s, inS: g.in - s.off, d: g.out - g.in, aspect: sw / sh, speed: g.speed || 1};
      if (!hasVid(s)) b.classList.add('audio'); paintMedia(b, b._m);
      if (multi && g.si !== lastSi) lbl = `${g.si + 1} · `; lastSi = g.si;
      const fb = fxBadges(g.fx); if (fb) b.insertAdjacentHTML('beforeend', `<span class="badge">${fb}</span>`);
      const fi = fxItemOf(g); for (const k of (fi && fi.fx && fi.fx.kf) || []){ const st = fi.at + k.t; if (st < g.in - 0.01 || st > g.out + 0.01) continue;
        const d = document.createElement('i'); d.className = 'kf'; d.dataset.o = r3(g.o + (st - g.in) / (g.speed || 1)); d.style.left = ((st - g.in) / (g.speed || 1) * TL.pps) + 'px'; d.title = 'Keyframe – antippen springt hierher'; b.append(d); } }
    else { const c = g.item.clip; b._m = isImg(c) ? {img: c.uri, inS: 0, d: g.out - g.in} : {uri: c.uri, inS: g.in, d: g.out - g.in, aspect: (c.width && c.height) ? dispSize(c)[0] / dispSize(c)[1] : asp, src: {uri: c.uri}}; paintMedia(b, b._m); lbl = 'Einschub · '; }
    b.insertAdjacentHTML('beforeend', `<span class="lbl">${lbl}${fmtD(d)} s</span>`);
    tr.append(b);
  });
}
// Videospuren über der Hauptspur: so viele wie belegt, plus eine freie oben
const ovlTracks = () => Math.max(1, ...P.items.filter(x => x.type === 'broll' || x.type === 'pip').map(elTrack)) ;
function renderOvl(pad){
  const used = P.items.some(x => x.type === 'broll' || x.type === 'pip'), n = used ? ovlTracks() + 1 : 1;
  $('.tl-body').style.setProperty('--nov', n);
  const box = $('#trOvlBox'), g = $('#gOvl'); box.innerHTML = ''; g.innerHTML = '';
  for (let row = 0; row < n; row++){
    const k = n - row, empty = !overlays.some(o => elTrack(o.x) === k);
    const tr = document.createElement('div'); tr.className = 'track t-ovl' + (empty ? ' empty' : ''); tr.id = 'trOvl' + k; tr.dataset.track = k;
    tr.style.top = `calc(var(--rh) + 6px + ${row} * (var(--oh) + 6px))`;
    if (empty) tr.innerHTML = `<span class="track-ph">${used && k === n ? 'Neue Videospur – Element hierher ziehen' : 'Videospur – ＋ Clip fügt Bilder und Videos ein'}</span>`;
    box.append(tr);
    const gr = document.createElement('div'); gr.className = 'g-row g-ovl' + (empty ? ' empty' : ''); gr.innerHTML = `<i>${icon('🎞')}</i><span>Video ${k + 1}</span>`; g.append(gr);
  }
  for (const o of overlays){
    const tr = $('#trOvl' + elTrack(o.x)); if (!tr) continue;
    const b = blk('ovl' + (o.x.type === 'pip' || o.x.w != null ? ' pip' : ''), o.at, o.end - o.at, pad, {id: o.x.id});
    const vol = o.x.vol > 0 ? ' ♪' : '';
    b.insertAdjacentHTML('beforeend', `<span class="txt"></span>`); b.querySelector('.txt').textContent = (o.x.w != null || o.x.type === 'pip' ? '▣ ' : '🎞 ') + o.x.clip.name + vol;
    { const c = o.x.clip, it = o.x, span = Math.max(0.01, (it.out ?? (o.end - o.at)) - (it.in || 0)), spd = span / Math.max(0.01, o.end - o.at);
      b._m = isImg(c) ? {img: c.uri, inS: 0, d: span} : {uri: c.uri, inS: it.in || 0, d: span, aspect: (c.width && c.height) ? dispSize(c)[0] / dispSize(c)[1] : 16 / 9, speed: spd || 1, src: {uri: c.uri}};
      paintMedia(b, b._m); }
    for (const k of o.x.kf || []){ if (k.t > o.end - o.at + 0.01) continue; const d = document.createElement('i'); d.className = 'kf'; d.dataset.t = k.t; d.style.left = (k.t * TL.pps) + 'px'; d.title = 'Keyframe – antippen springt hierher'; b.append(d); }
    tr.append(b);
  }
}
// Tonspuren: so viele wie belegt, plus eine freie
function renderAud(pad){
  const used = P.items.some(x => x.type === 'audio'), n = used ? Math.max(1, ...P.items.filter(x => x.type === 'audio').map(x => x.track || 1)) + 1 : 1;
  $('.tl-body').style.setProperty('--nau', n);
  const box = $('#trAudBox'), g = $('#gAud'); box.innerHTML = ''; g.innerHTML = '';
  for (let k = 1; k <= n; k++){
    const empty = !audios.some(a => (a.x.track || 1) === k);
    const tr = document.createElement('div'); tr.className = 'track t-aud' + (empty ? ' empty' : ''); tr.id = 'trAud' + k; tr.dataset.atrack = k;
    tr.style.top = `calc(var(--rh) + var(--mh) + 12px + var(--nov) * (var(--oh) + 6px) + ${k - 1} * (var(--ah) + 6px))`;
    if (empty) tr.innerHTML = `<span class="track-ph">${used ? 'Neue Tonspur' : 'Tonspur – Musik oder Ton aus der Medienablage hierher ziehen'}</span>`;
    box.append(tr);
    const gr = document.createElement('div'); gr.className = 'g-row g-aud' + (empty ? ' empty' : ''); gr.innerHTML = `<i>${icon('♪')}</i><span>Ton ${k}</span>`; g.append(gr);
  }
  for (const a of audios){
    const tr = $('#trAud' + (a.x.track || 1)); if (!tr) continue;
    const b = blk('aud', a.at, a.end - a.at, pad, {id: a.x.id});
    { const it = a.x, span = Math.max(0.01, (it.out ?? (a.end - a.at)) - (it.in || 0)); b._m = {inS: it.in || 0, d: span, speed: span / Math.max(0.01, a.end - a.at), src: {uri: it.clip.uri}};
      if (!envDone.has(it.clip.uri) && window.envOfUri && !P.sources.some(x => x.uri === it.clip.uri)) envOfUri(it.clip.uri).then(e => { if (e && !envDone.has(it.clip.uri)){ envDone.set(it.clip.uri, e); if (studioOn()) renderTimeline(); } });
      paintMedia(b, b._m); }
    b.insertAdjacentHTML('beforeend', `<span class="txt"></span>`); b.querySelector('.txt').textContent = '♪ ' + a.x.clip.name + ((a.x.vol ?? 1) !== 1 ? ` · ${Math.round((a.x.vol ?? 1) * 100)} %` : '');
    tr.append(b);
  }
}
const freeATrack = (a, e, skip) => { for (let k = 1; ; k++) if (!audios.some(o => o.x !== skip && (o.x.track || 1) === k && o.at < e - 0.01 && o.end > a + 0.01)) return k; };
// freie Spur für ein neues Element im Zeitraum [a, e]
function freeTrack(a, e, skip){
  for (let k = 1; ; k++) if (!overlays.some(o => o.x !== skip && elTrack(o.x) === k && o.at < e - 0.01 && o.end > a + 0.01)) return k;
}
function moveATrack(it, k){ k = Math.max(1, k); if (k === (it.track || 1)) return; commit(() => { it.track = k; }, true); toast(`Auf Tonspur ${k}`); }
function moveTrack(it, k){
  k = Math.max(1, k); if (k === elTrack(it)) return;
  commit(() => { it.track = k; }, true); toast(`Auf Videospur ${k + 1}`);
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
  if (S().enabled === false){ tr.innerHTML = '<span class="track-ph">Untertitel aus</span>'; return; }
  if (!P.cues.length){ tr.innerHTML = '<span class="track-ph">Untertitel: ＋ Untertitel legt einen an der Abspiellinie an</span>'; return; }
  const frag = document.createDocumentFragment();
  for (const c of P.cues){
    const t = cueTimes(c); if (!t) continue;
    const b = blk('cue' + (c.off ? ' off' : '') + (isFree(c) ? ' free' : '') + (c.own ? ' own' : ''), t.s, Math.max(0.1, t.e - t.s), pad, {cid: c.id});
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
  if (Crop.it && !(sel && sel.id === Crop.it.id)) endCrop(true);
  tlInner.querySelectorAll('.blk.sel').forEach(x => x.classList.remove('sel'));
  TL.sel = sel; const b = selBlock(); if (b) b.classList.add('sel'); else TL.sel = null;
  paintLinks(); updateTools(); if (P) updateTitles(outPos);
}
function selectBlock(b){
  const tr = b.parentElement.id;
  if (tr === 'trMain'){ const g = timeline[+b.dataset.i]; select(g.kind === 'insert' ? {kind:'insert', i:+b.dataset.i, itemId:g.item.id} : {kind:'main', i:+b.dataset.i, src:(g.in + g.out) / 2}); }
  else if (tr === 'trTxt') select({kind:'cue', id:b.dataset.cid});
  else { const it = P.items.find(x => x.id === b.dataset.id); if (!it) return; select({kind: it.type === 'zoom' ? 'zoom' : it.type === 'fx' ? 'fx' : it.type === 'title' ? 'title' : it.type === 'audio' ? 'aud' : 'ovl', id: it.id}); }
}
// ── Verbinden: mehrere Objekte auswählen (Strg/Umschalt+Klick oder „Verbinden …“), dann zu einer Gruppe machen ──
const blkKey = b => b.dataset.cid ? 'c:' + b.dataset.cid : b.dataset.id ? 'i:' + b.dataset.id : null;
const objOfKey = k => k[0] === 'c' ? P.cues.find(c => c.id === k.slice(2)) : P.items.find(x => x.id === k.slice(2));
const selKey = () => { const s = TL.sel; if (!s || s.kind === 'main' || s.kind === 'insert') return null; return (s.kind === 'cue' ? 'c:' : 'i:') + s.id; };
function paintLinks(){
  tlInner.querySelectorAll('.blk').forEach(b => { const k = blkKey(b), o = k && objOfKey(k);
    b.classList.toggle('linked', !!(o && o.lk)); b.classList.toggle('pick', !!(TL.pick && k && TL.pick.has(k)));
    const sel = TL.sel && selKey() && objOfKey(selKey()); b.classList.toggle('grp', !!(o && o.lk && sel && sel !== o && sel.lk === o.lk));
    if (o && o.lk && !b.querySelector('.lnk')) b.insertAdjacentHTML('afterbegin', `<i class="lnk">${icon('🔗')}</i>`); });
}
function startPick(extra){
  const k = selKey(); if (!k) return toast('Erst ein Objekt auswählen');
  TL.pick = new Set([k]); if (extra) TL.pick.add(extra); paintLinks(); updateTools();
  toast(FINE ? 'Weitere Objekte anklicken, dann „Verbinden“' : 'Weitere Objekte antippen, dann „Verbinden“');
}
function endPick(){ TL.pick = null; paintLinks(); updateTools(); }
function doLink(){
  const objs = [...(TL.pick || [])].map(objOfKey).filter(Boolean);
  if (objs.length < 2) return toast('Mindestens zwei Objekte auswählen');
  let n = 0; commit(() => { n = linkObjects(objs); }, false); TL.pick = null; renderTimeline();
  toast(`${n} Objekte verbunden – sie bleiben jetzt beieinander`);
}
function doUnlink(){ const k = selKey(), o = k && objOfKey(k); if (!o || !o.lk) return; commit(() => unlinkObject(o), false); renderTimeline(); toast('Verbindung gelöst'); }
tlInner.addEventListener('click', e => {
  if (TL.drag && TL.drag.moved) return;
  const b = e.target.closest('.blk');
  const k = b && blkKey(b);
  if (e.target.classList.contains('kf')){
    const go = o => { if (playing) pausePlay(); seekOut(o, false); if (TL.mode === 'center') syncScroll(outPos, true); else placeHead(outPos); selectBlock(b); };
    if (e.target.dataset.o != null){ go(+e.target.dataset.o); return; }
    const it = P.items.find(x => x.id === b.dataset.id), a = it && ovOf(it); if (a) go(a.at + +e.target.dataset.t); return; }
  if (TL.pick){ if (k){ if (TL.pick.has(k)) TL.pick.delete(k); else TL.pick.add(k); paintLinks(); updateTools(); } return; }
  if (k && (e.ctrlKey || e.metaKey || e.shiftKey) && selKey() && selKey() !== k){ startPick(k); return; }
  if (!b){ select(null); if (TL.mode === 'move' && !e.target.closest('.ruler')){ if (playing) pausePlay(); seekOut(timeAtX(e.clientX), false); placeHead(outPos); } return; }
  if (b.classList.contains('sel') && TL.justSelected){ TL.justSelected = false; return; }
  selectBlock(b);
});
// Rechtsklick: Menü mit den Werkzeugen der Auswahl
tlInner.addEventListener('contextmenu', e => {
  const b = e.target.closest('.blk'); e.preventDefault();
  if (TL.touchDrag || TL.drag) return;
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
  TL.pps = clamp(p, minPps(), 800); renderTimeline();
  if (x != null){ TL.expect = -1; tlEl.scrollLeft = Math.max(0, padL() + outPos * TL.pps - x); placeHead(outPos); }
  paintBar();
}
$('#tlIn').onclick = () => setPps(TL.pps * 1.6);
$('#tlOut').onclick = () => setPps(TL.pps / 1.6);
$('#tlFit').onclick = () => fitTimeline();
// Kleinste Stufe: ganzes Projekt passt in die sichtbare Spur (auch bei langen Videos)
function minPps(){ const w = Math.max(200, tlEl.clientWidth - (TL.mode === 'center' ? 40 : padL() + 40)); return Math.max(0.005, Math.min(6, total > 0 ? w / total : 6)); }
$('#tlZoom').oninput = e => setPps(minPps() * Math.pow(800 / minPps(), +e.target.value / 100));
tlEl.addEventListener('touchstart', e => {
  if (e.touches.length === 2){ const d = Math.abs(e.touches[0].clientX - e.touches[1].clientX); TL.pinch = {d0: Math.max(20, d), p0: TL.pps, o: outPos}; }
}, {passive:true});
tlEl.addEventListener('touchmove', e => {
  if (!TL.pinch || e.touches.length !== 2) return; e.preventDefault();
  const d = Math.abs(e.touches[0].clientX - e.touches[1].clientX);
  const p = clamp(TL.pinch.p0 * Math.max(20, d) / TL.pinch.d0, minPps(), 800);
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
  if (TL.pick || ((e.ctrlKey || e.metaKey || e.shiftKey) && e.pointerType === 'mouse')) return;   // Verbinden: nur auswählen, nicht ziehen
  let b = e.target.closest('.blk.sel');
  if (!b && e.pointerType === 'mouse' && e.button === 0){   // mit der Maus: Clip direkt greifen
    const nb = e.target.closest('.blk'); if (!nb) return; selectBlock(nb); TL.justSelected = true; b = selBlock(); if (!b) return; }
  if (!b) return;
  const h = e.target.closest('.h');
  const s = TL.sel, it = s.kind === 'ovl' || s.kind === 'aud' || s.kind === 'zoom' || s.kind === 'fx' || s.kind === 'title' ? selItem() : null;
  const start = () => {
    TL.drag = {b, side: h ? (h.classList.contains('l') ? 'l' : 'r') : 'm', x0: e.clientX, sl0: tlEl.scrollLeft, left0: parseFloat(b.style.left), w0: parseFloat(b.style.width), moved: false, d: 0, pts: snapPoints(it)};
    if (playing) pausePlay();
    dragEdgeScroll();
  };
  if (e.pointerType === 'touch' && !h){
    // Am Handy: der Clip-Körper wird erst nach kurzem Halten gegriffen – ein Wischen scrollt die Spur wie gewohnt
    clearTimeout(TL.holdT); TL.hold = {b, x: e.clientX, y: e.clientY, pid: e.pointerId};
    TL.holdT = setTimeout(() => { if (!TL.hold || TL.hold.b !== b) return; TL.hold = null; TL.touchDrag = true;
      try { b.setPointerCapture(e.pointerId); } catch(_){} if (navigator.vibrate) navigator.vibrate(12); b.classList.add('lift'); start(); }, 360);
    return;
  }
  e.preventDefault(); b.setPointerCapture(e.pointerId);
  start();
});
// Halten abbrechen, sobald der Finger wischt (dann scrollt der Browser); während des Ziehens kein Scrollen
tlInner.addEventListener('pointermove', e => { const h = TL.hold; if (h && e.pointerId === h.pid && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 8){ TL.hold = null; clearTimeout(TL.holdT); } });
tlInner.addEventListener('touchmove', e => { if (TL.touchDrag) e.preventDefault(); }, {passive:false});
tlInner.addEventListener('contextmenu', e => { if (TL.touchDrag || TL.hold) e.preventDefault(); }, true);
// Am Rand der sichtbaren Spur weiterscrollen, solange gezogen wird
function dragEdgeScroll(){
  const g = TL.drag; if (!g) return;
  if (g.moved && g.last){
    const r = tlEl.getBoundingClientRect(), x = g.last.clientX, edge = 48; let v = 0;
    if (x > r.right - edge) v = Math.ceil((x - (r.right - edge)) / 3) + 2; else if (x < r.left + edge) v = -Math.ceil(((r.left + edge) - x) / 3) - 2;
    if (v){ const before = tlEl.scrollLeft, max = tlEl.scrollWidth - tlEl.clientWidth;
      // Am Ende des Projekts mehr Platz schaffen, damit Elemente über das Ende hinaus gezogen werden können
      if (v > 0 && before >= max - 2) tlInner.style.width = (tlInner.scrollWidth + 200) + 'px';
      TL.expect = before + v; tlEl.scrollLeft = before + v;
      if (tlEl.scrollLeft !== before){ TL.expect = tlEl.scrollLeft; dragMoveAt(g.last); } }
  }
  g.raf = requestAnimationFrame(dragEdgeScroll);
}
tlInner.addEventListener('pointermove', e => { const g = TL.drag; if (!g) return; g.last = {clientX: e.clientX, clientY: e.clientY, target: e.target}; dragMoveAt(g.last); });
function dragMoveAt(e){
  const g = TL.drag; if (!g) return;
  const dx = e.clientX - g.x0 + (tlEl.scrollLeft - g.sl0); if (Math.abs(dx) > 3) g.moved = true; if (!g.moved) return;
  g.ptr = (e.clientX - tlInner.getBoundingClientRect().left - padL()) / TL.pps;   // Zeit unter dem Mauszeiger
  if (TL.sel && TL.sel.kind === 'ovl' && g.side === 'm'){   // Element senkrecht auf eine andere Videospur ziehen
    const row = e.target.ownerDocument.elementsFromPoint(e.clientX, e.clientY).find(x => x.classList && x.classList.contains('t-ovl'));
    tlInner.querySelectorAll('.t-ovl.drop').forEach(x => x.classList.remove('drop'));
    g.trk = row ? +row.dataset.track : null; if (row && g.trk !== elTrack(selItem())) row.classList.add('drop');
  }
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
  if (g.side !== 'm' && g.b._m){ const m = g.b._m, sd = d * (m.speed || 1); cancelAnimationFrame(g.mr);   // aufgedeckte Bilder und Ton gleich zeigen
    g.mr = requestAnimationFrame(() => paintMedia(g.b, m, g.side === 'l' ? sd : 0, g.side === 'r' ? sd : 0)); }
  previewDrag(g.side, d);
  $('#tlInfo').textContent = (g.side === 'm' ? 'Verschieben ' : g.side === 'l' ? 'Anfang ' : 'Ende ') + (d >= 0 ? '+' : '−') + fmtD(Math.abs(d)) + ' s' + (isMain ? ` (${Math.round(Math.abs(d) * fps())} Bilder)` : '');
}
function endDrag(){
  TL.hold = null; clearTimeout(TL.holdT);
  if (TL.touchDrag){ TL.touchDrag = false; tlInner.querySelectorAll('.blk.lift').forEach(x => x.classList.remove('lift')); }
  const g = TL.drag; if (!g) return; cancelAnimationFrame(g.raf);
  setTimeout(() => { TL.drag = null; }, 0);
  tlInner.querySelectorAll('.t-ovl.drop').forEach(x => x.classList.remove('drop'));
  if (g.trk && TL.sel && TL.sel.kind === 'ovl'){ const it = selItem(); if (it && g.trk !== elTrack(it)){
    const d = g.moved ? g.d : 0; commit(() => { it.track = g.trk; if (Math.abs(d) > 1e-4){ const [a] = itemOutRange(it); it.at = +outToSrc(a + d).toFixed(3); } }, true); return; } }
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
  // Fotos haben keine feste Länge: beliebig lang ziehen, auch nach vorn
  if (s.kind === 'insert'){ const it = timeline[s.i].item, img = isImg(it.clip);
    return side === 'l' ? clamp(d, img ? -1e6 : -it.in, it.out - it.in - 0.1) : clamp(d, -(it.out - it.in - 0.1), img ? 1e6 : it.clip.duration - it.out); }
  if (s.kind === 'ovl' || s.kind === 'aud'){ const it = selItem(), [a] = itemOutRange(it), img = isImg(it.clip);
    if (side === 'l') return clamp(d, img ? -a : -it.in, it.out - it.in - 0.1);
    if (side === 'r') return clamp(d, -(it.out - it.in - 0.1), img ? Math.max(0, total - (a + it.out - it.in)) : it.clip.duration - it.out);
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
  const lnk = s.kind === 'cue' ? selCue() : (s.kind === 'main' || s.kind === 'insert') ? null : selItem();
  commit(() => {
    const p0 = lnk && lnk.lk ? objStart(lnk) : null;
    linkedDrag(side, d);
    if (p0 != null){ if (side === 'm') groupShift(lnk, objStart(lnk) - p0); else refreshLo(lnk); }
  }, false);
  tokens.forEach(t => paint(t.i));
}
function linkedDrag(side, d){
  const s = TL.sel;
  {
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
      const it = timeline[s.i].item;
      if (side === 'l' && isImg(it.clip)){ const len = it.out - it.in - d; it.in = 0; it.out = r3(len); }
      else if (side === 'l') it.in = +(it.in + d).toFixed(3); else it.out = +(it.out + d).toFixed(3);
    } else if (s.kind === 'ovl' || s.kind === 'aud'){
      const it = selItem(), [a] = itemOutRange(it);
      if (side === 'l'){ if (isImg(it.clip)){ const len = it.out - it.in - d; it.in = 0; it.out = r3(len); } else it.in = +(it.in + d).toFixed(3);
        it.at = +outToSrc(a + d).toFixed(3); if (it.kf) it.kf.forEach(k => k.t = r3(k.t - d)); }
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
  }
}

// ───────── Werkzeuge ─────────
const T = (icon, label, fn, cls = '') => ({icon, label, fn, cls});
function toolList(){
  if (TL.pick) return [T('🔗', `Verbinden (${TL.pick.size})`, doLink), T('✕', 'Abbrechen', endPick)];
  if (Crop.it){ const fa = clipAspect(Crop.it.clip), R = (lbl, v) => T(Crop.ratio != null && v != null && Math.abs(Crop.ratio - v) < 1e-3 ? '◆' : '◰', lbl, () => { cropRatio(v); updateTools(); });
    return [T('✓', 'Fertig', () => endCrop(true), 'primary'), R('Frei', null), R('Original', fa), R('1:1', 1), R('9:16', 9 / 16), R('16:9', 16 / 9), R('4:5', 0.8),
      T('↺', 'Ganzes Bild', () => { resetCrop(); updateTools(); }), T('✕', 'Abbrechen', () => endCrop(false))]; }
  const lt = linkTools(), cp = TL.sel ? [T('⧉', 'Kopieren', copySel), T('⧉', 'Duplizieren', duplicateSel)] : [];
  return [...toolListBase(), ...cp, ...(CLIP ? [T('📋', 'Einfügen', () => pasteClip())] : []), ...lt];
}
function linkTools(){
  const k = selKey(), o = k && objOfKey(k); if (!o) return [];
  return o.lk ? [T('⛓', 'Verbindung lösen', doUnlink)] : [T('🔗', 'Verbinden …', () => startPick())];
}
function toolListBase(){
  const s = TL.sel; const g = s && (s.kind === 'main' || s.kind === 'insert') ? timeline[s.i] : null;
  if (!s) return [T('📱', 'Clip ab hier …', () => clipDialog(outPos, Math.min(total, outPos + 30))), T('✂', 'Teilen', splitHere), T('⌫', 'Bis hier weg', () => cutTo('l')), T('⌦', 'Ab hier weg', () => cutTo('r')), T('＋', 'Clip', addClip), T('T', 'Titel', addTitle), T('💬', 'Untertitel', addOwnCue), T('🔍', 'Zoom', addZoom),
    ...(P.moves.length ? [T('↺', 'Reihenfolge zurück', () => { commit(() => P.moves = [], true); if (tokens.length) renderTranscript(); toast('Ursprüngliche Reihenfolge'); })] : [])];
  if (s.kind === 'main') return [T('📱', 'Als Clip …', () => clipDialog(g.o, g.o + segDur(g))), T('✂', 'Teilen', splitHere), T('⚙', 'Anpassen', () => openFx(g)),
    T('◆', hasMainKfHere(g) ? 'Keyframe weg (M)' : 'Keyframe (M)', () => toggleMainKeyframe(g)), T('🗑', 'Löschen', delSel, 'danger'), T('⇤', 'Anfang −1', () => nudge('l', -1)), T('⇥', 'Anfang +1', () => nudge('l', 1)),
    T('⇤', 'Ende −1', () => nudge('r', -1)), T('⇥', 'Ende +1', () => nudge('r', 1)), T('🔍', 'Zoom', addZoom), T('T', 'Titel', addTitle), T('＋', 'Clip', addClip)];
  const cuts = [T('⌫', 'Bis hier weg', () => cutSel('l')), T('⌦', 'Ab hier weg', () => cutSel('r'))];
  if (s.kind === 'insert') return [T('🎞', 'Ausschnitt', () => openItem(g.item.id)), T('🗑', 'Löschen', delSel, 'danger'), ...cuts, T('⇄', 'Als B-Roll', () => convert('broll'))];
  if (s.kind === 'ovl'){ const it = selItem(); return [T('🎞', 'Ausschnitt', () => openItem(it.id)), T('🗑', 'Löschen', delSel, 'danger'), ...cuts, T('◰', 'Zuschneiden', () => startCrop(it)),
    T('◆', hasKfHere(it) ? 'Keyframe weg (M)' : 'Keyframe (M)', () => toggleKeyframe(it)),
    T('−', 'Kleiner', () => pipScale(1 / 1.15)), T('＋', 'Größer', () => pipScale(1.15)), T('↗', 'Ecke', cycleCorner),
    ...(it.w != null || it.type === 'pip' ? [T('▣', 'Vollbild', () => convert('broll'))] : []),
    T('⚙', 'Größe, Lage, Ton', () => openItem(it.id)), T('↑', 'Spur hoch', () => moveTrack(it, elTrack(it) + 1)), ...(elTrack(it) > 1 ? [T('↓', 'Spur runter', () => moveTrack(it, elTrack(it) - 1))] : []),
    T('⇄', 'Als Einschub', () => convert('insert'))]; }
  if (s.kind === 'aud'){ const it = selItem(); return [T('🔊', 'Lautstärke & Ausschnitt', () => openItem(it.id)), T('🗑', 'Löschen', delSel, 'danger'), ...cuts,
    T('↑', 'Spur hoch', () => moveATrack(it, (it.track || 1) - 1)), T('↓', 'Spur runter', () => moveATrack(it, (it.track || 1) + 1))]; }
  if (s.kind === 'zoom'){ const it = selItem(); return [T('◎', 'Mittelpunkt', () => openItem(it.id)), T('⟳', it.kind === 'punch' ? 'Sprung' : it.kind === 'in' ? 'Fahrt rein' : 'Fahrt raus', cycleZoomKind),
    T('−', 'Schwächer', () => zoomStrength(-0.05)), T('＋', 'Stärker', () => zoomStrength(0.05)), T('🗑', 'Löschen', delSel, 'danger'), ...cuts]; }
  if (s.kind === 'fx'){ const it = selItem(); return [T('⚙', 'Anpassen', () => openFxItem(it)), T('🗑', 'Löschen', delSel, 'danger'), ...cuts]; }
  if (s.kind === 'title'){ const it = selItem(); return [T('✎', 'Text & Stil', () => editTitle(it.id)), T('🗑', 'Löschen', delSel, 'danger'), ...cuts]; }
  if (s.kind === 'cue'){ const c = selCue(); return [T('✎', 'Text', editCue), T('✂', 'Teilen', splitCue), ...cuts, T(c && c.off ? '👁' : '⦸', c && c.off ? 'Einblenden' : 'Ausblenden', () => { commit(() => c.off = !c.off, false); }),
    ...(c && c.own ? [T('🗑', 'Löschen', delSel, 'danger')] : [T('⇄', 'Vom Text lösen', () => { commit(() => detachCue(c), false); toast('Eigener Untertitel – Text und Zeit hängen nicht mehr am Transkript'); })]),
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
  else if (g) info.textContent = `${fmtS(g.o)} – ${fmtS(g.o + segDur(g))} (${fmtD(segDur(g))} s)${g.fx && fxBadges(g.fx) ? ' · ' + fxBadges(g.fx) : ''} · Griffe ziehen zum Trimmen · Clip ${FINE ? 'ziehen' : 'halten und ziehen'} zum Umsortieren`;
  else if (s.kind === 'cue'){ const c = selCue(), t = c && cueTimes(c); info.textContent = t ? `${fmtS(t.s)} – ${fmtS(t.e)}${isFree(c) ? ' · Zeit frei gesetzt' : ''} · ziehen verschiebt, Griffe ändern Anfang/Ende – der Schnitt bleibt gleich · im Bild ziehen setzt die Position nur für diesen` : 'Untertitel'; }
  else { const it = selItem(); if (it){ const [a, e] = itemOutRange(it); info.textContent = `${fmtS(a)} – ${fmtS(e)} · ${FINE ? 'ziehen' : 'halten und ziehen'} zum Verschieben, Griffe zum Trimmen${it.type === 'title' ? ' · im Bild ziehen zum Platzieren, Doppelklick zum Bearbeiten' : ''}`; } }
}
function paintBar(){
  $('#modeBtn').classList.toggle('on', TL.mode === 'move'); $('#modeBtn').title = TL.mode === 'move' ? 'Zeiger läuft über die Spur (klicken: fester Zeiger in der Mitte)' : 'Fester Zeiger, Spur bewegt sich (klicken: laufender Zeiger)';
  $('#snapBtn').classList.toggle('on', TL.snap);
  $('#tlZoom').value = Math.round(Math.log(TL.pps / minPps()) / Math.log(800 / minPps()) * 100);
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
  // Element auf einer anderen Ebene ausgewählt (Videospur, Titel, Zoom, Anpassung, Untertitel, Einschub):
  // dessen Teil vor bzw. nach der Abspiellinie entfernen
  const s = TL.sel; if (s && s.kind !== 'main') return cutSel(side);
  const g = curMainSeg(); if (!g) return;
  const x = vT();
  commit(() => side === 'l' ? addDel(g.in, x) : addDel(x, g.out), false); tokens.forEach(t => paint(t.i));
  // Abspiellinie genau auf den neuen Schnitt
  if (playing) pausePlay(); const o = srcToOut(x); seekOut(o, false); revealHead(o);
}
function selRange(){
  const s = TL.sel; if (!s) return null;
  if (s.kind === 'main' || s.kind === 'insert'){ const g = timeline[s.i]; return g ? [g.o, g.o + segDur(g)] : null; }
  if (s.kind === 'cue'){ const t = cueTimes(selCue()); return t ? [t.s, t.e] : null; }
  const it = selItem(); return it ? itemOutRange(it) : null;
}
function cutSel(side){
  const r = selRange(); if (!r) return;
  const [a, e] = r, o = outPos;
  if (o <= a + 0.02 || o >= e - 0.02) return toast('Abspiellinie in das ausgewählte Element setzen');
  if (playing) pausePlay();
  let d = side === 'l' ? o - a : o - e;
  if (TL.sel.kind === 'insert') d = snapF(d);
  d = clampDrag(side, d); if (Math.abs(d) < 1e-4) return toast('Geht hier nicht weiter');
  applyDrag(side, d);
  toast(side === 'l' ? 'Anfang bis zur Abspiellinie entfernt' : 'Ende ab der Abspiellinie entfernt');
  if (TL.sel && TL.sel.kind === 'insert'){ const g = timeline[TL.sel.i]; if (g){ const no = side === 'l' ? g.o : g.o + segDur(g); seekOut(Math.min(no, Math.max(0, total - 0.01)), false); } }
  revealHead(outPos);
}
function delSel(){
  const s = TL.sel; if (!s) return;
  if (s.kind === 'main'){ const g = timeline[s.i]; commit(() => addDel(g.in, g.out), false); tokens.forEach(t => paint(t.i)); toast('Clip gelöscht'); }
  else if (s.kind === 'insert'){ const id = timeline[s.i].item.id; commit(() => P.items = P.items.filter(x => x.id !== id), false); }
  else if (s.kind === 'cue'){ const c = selCue(); if (c.own) commit(() => P.cues = P.cues.filter(x => x !== c), false); else commit(() => c.off = true, false); }
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
  commit(() => { it.type = type; if (type === 'pip') pipFree(it); if (type === 'broll'){ delete it.w; delete it.x; delete it.y; delete it.kf; } if (type !== 'insert') it.out = Math.min(it.out, it.in + Math.max(1, Math.min(it.out - it.in, 8))); }, false);
  TL.sel = type === 'insert' ? {kind:'insert', itemId: it.id, i:0} : {kind:'ovl', id: it.id}; renderTimeline();
}
function hasKfHere(it){ const a = ovOf(it); if (!a || !it.kf) return false; const rel = outPos - a.at, tol = 0.5 / fps(); return it.kf.some(k => Math.abs(k.t - rel) <= tol); }
function cycleCorner(){ const it = selItem(), order = ['or', 'ur', 'ul', 'ol']; commit(() => pipCorner(it, order[(order.indexOf(it.corner || 'or') + 1) % 4]), false); seekOut(outPos, false); }
function pipScale(f){ const it = selItem(), rel = curRel(it), v = elVals(it, rel) || coverVals(it); commit(() => setElVals(it, rel, {x: v.x, y: v.y, w: v.w * f}), false); seekOut(outPos, false); toast(`Größe ${Math.round(v.w * f * 100)} %`); }
function cycleZoomKind(){ const it = selItem(), order = ['punch', 'in', 'out']; commit(() => it.kind = order[(order.indexOf(it.kind) + 1) % 3], false); }
function zoomStrength(d){ const it = selItem(); commit(() => it.strength = +clamp(it.strength + d, 1.05, 2).toFixed(2), false); toast(it.strength.toFixed(2).replace('.', ',') + '×'); seekOut(outPos, false); }
function addZoom(){
  const at = +outToSrc(outPos).toFixed(3);
  let it; commit(() => { it = {id:newId(), type:'zoom', at, dur:2, kind:'punch', strength:1.25, cx:.5, cy:.42}; P.items.push(it); }, false);
  select({kind:'zoom', id: it.id}); toast('Zoom eingefügt – Mittelpunkt über „Mittelpunkt“ setzen');
}
function addClip(){
  const body = $('#sheetBody');
  body.innerHTML = `<h3>Clip einfügen an der Abspiellinie</h3><p class="muted small">Videos und Fotos – alle eingefügten Dateien liegen danach auch in der Medienablage</p><div class="choice">
    <button class="tile" data-t="broll"><b>B-Roll</b><span>Bild drüber, dein Ton läuft weiter</span></button>
    <button class="tile" data-t="insert"><b>Einschub</b><span>Hauptvideo pausiert, Clip läuft mit eigenem Ton</span></button>
    <button class="tile" data-t="pip"><b>Einblendung</b><span>Bild oder Video frei im Bild – Größe und Lage frei wählbar</span></button>
    <button class="tile" data-t="audio"><b>Nur Ton</b><span>Nur die Tonspur der Datei, auf einer Tonspur – das Bild bleibt weg</span></button></div>`;
  openSheet(false);
  body.onclick = async e => {
    const b = e.target.closest('[data-t]'); if (!b) return; const type = b.dataset.t;
    $('#sheet').classList.add('hidden'); $('#sheetBack').classList.add('hidden');
    const o = outPos, clip = await pickMedia('clip'); if (!clip) return;
    placeMedia(clip, type, o, null, true);
  };
}
// Datei als Element einfügen: type broll | insert | pip, an Zeit o (Ergebnis), auf Spur track (oder frei)
function placeMedia(m, type, o, track, short){
  if (!m) return;
  if (m.kind === 'audio' || m.hasVideo === false) type = 'audio';   // Tondateien kommen immer auf eine Tonspur; Videos auf Wunsch auch (nur Ton)
  const clip = clipOfSource(m), img = clip.kind === 'image';
  if (o == null) o = outPos; o = clamp(o, 0, Math.max(0, total - 0.1));
  const at = r3(outToSrc(o));
  if (type === 'audio'){
    if (m.hasAudio === false) return toast('Diese Datei hat keinen Ton');
    const len = Math.min(clip.duration || 1, Math.max(0.5, total - o)); let it;
    commit(() => { computeAudios(); const busy = k => audios.some(x => (x.x.track || 1) === k && x.at < o + len - 0.01 && x.end > o + 0.01);
      it = {id:newId(), type:'audio', at, clip, in:0, out:r3(len), vol:1, track: track && !busy(track) ? track : freeATrack(o, o + len)}; P.items.push(it); }, false);
    TL.sel = {kind:'aud', id: it.id}; renderTimeline(); seekOut(outPos, false); renderBin();
    toast(clip.kind === 'video' ? 'Nur der Ton des Videos eingefügt – Lautstärke über „Lautstärke & Ausschnitt“' : 'Ton eingefügt – Lautstärke über „Lautstärke & Ausschnitt“'); return;
  }
  const len = img ? 4 : type === 'insert' ? clip.duration : short ? Math.min(clip.duration, 4) : Math.min(clip.duration, Math.max(0.5, total - o));
  let it; commit(() => {
    it = {id:newId(), type, at, clip, in:0, out: r3(len), corner:'or', size:0.4};
    if (type !== 'insert'){ computeOverlays(); const busy = k => overlays.some(x => elTrack(x.x) === k && x.at < o + len - 0.01 && x.end > o + 0.01);
      it.track = track && !busy(track) ? track : freeTrack(o, o + len); }
    if (type === 'pip'){ const [W, H] = outSize(); it.size = +Math.min(0.4, 0.45 * H * clipAspect(clip) / W).toFixed(3); P.items.push(it); computeOverlays(); pipCorner(it, 'or'); }
    else P.items.push(it);
  }, false);
  if (type === 'insert' && tokens.length) renderTranscript();
  TL.sel = type === 'insert' ? {kind:'insert', itemId: it.id, i:0} : {kind:'ovl', id: it.id}; renderTimeline(); seekOut(outPos, false); renderBin();
  toast(`${TYPE_LBL[type]} eingefügt – Griffe ziehen zum Kürzen`);
}

// ───────── Medienablage: alle Dateien des Projekts, zum Ziehen auf die Spuren ─────────
function mediaList(){
  const seen = new Map(), add = (m, from) => { if (!m || !m.uri) return; const e = seen.get(m.uri); if (e){ e.uses += from === 'used' ? 1 : 0; return; } seen.set(m.uri, {m, main: from === 'main', uses: from === 'used' ? 1 : 0}); };
  P.sources.forEach(x => add(x, 'main')); P.items.forEach(x => x.clip && add(x.clip, 'used')); (P.media || []).forEach(x => add(x, 'bin'));
  return [...seen.values()];
}
const binOpen = () => !$('#mediaBin').classList.contains('hidden');
function toggleBin(on){
  if (on == null) on = !binOpen();
  $('#mediaBin').classList.toggle('hidden', !on); $('#barMedia').classList.toggle('on', on);
  try { localStorage.setItem('ts-bin', on ? '1' : '0'); } catch(_){}
  if (on) renderBin();
}
function renderBin(){
  if (!P || !binOpen()) return;
  const grid = $('#binGrid'); grid.innerHTML = '';
  const list = mediaList();
  $('#binEmpty').classList.toggle('hidden', list.length > 0);
  for (const {m, main, uses} of list){
    const d = document.createElement('div'); d.className = 'bin-item'; d.dataset.uri = m.uri; d.title = `${m.name} – ziehen auf eine Spur, antippen zum Einfügen`;
    const img = document.createElement('img'); img.alt = ''; img.draggable = false;
    if (m.kind === 'audio'){ d.classList.add('audio'); d.insertAdjacentHTML('afterbegin', `<span class="aud-ph">${icon('♪')}</span>`); }
    if (m.kind === 'image') img.src = MEDIA(m.uri);
    else if (m.kind !== 'audio'){ const u = THUMB(m.uri, Math.min(1, (m.duration || 2) / 2), 120); if (u && u.then) u.then(x => { if (x) img.src = x; }); else img.src = u; }
    d.append(img);
    const cap = document.createElement('span'); cap.className = 'cap';
    cap.textContent = m.kind === 'image' ? 'Foto' : m.kind === 'audio' ? '♪ ' + fmtS(m.duration || 0) : fmtS(m.duration || 0);
    d.append(cap);
    const nm = document.createElement('b'); nm.textContent = m.name; d.append(nm);
    const tag = document.createElement('i'); tag.className = 'tag' + (main ? ' main' : uses ? ' used' : '');
    tag.textContent = main ? 'Hauptvideo' : uses ? `${uses}× im Projekt` : 'noch nicht verwendet'; d.append(tag);
    if (!main && !uses){ const x = document.createElement('button'); x.className = 'rm'; x.title = 'Aus der Ablage nehmen'; x.textContent = '✕';
      x.onclick = e => { e.stopPropagation(); P.media = (P.media || []).filter(y => y.uri !== m.uri); changed(false); renderBin(); }; d.append(x); }
    grid.append(d);
  }
}
async function binAdd(){
  const got = asList(await pickMedia('clips')); if (!got.length) return;
  P.media ||= []; let n = 0;
  for (const m of got) if (!mediaList().some(x => x.m.uri === m.uri)){ P.media.push(clipOfSource(m)); n++; }
  changed(false); renderBin(); toast(n ? `${n} Datei${n > 1 ? 'en' : ''} in der Ablage – auf eine Spur ziehen` : 'Schon in der Ablage');
}
function binMenu(m, x, y){
  const o = outPos;
  if (m.kind === 'audio' || m.hasVideo === false) return showMenu(x, y, [T('♪', 'Auf eine Tonspur an der Abspiellinie', () => placeMedia(m, 'audio', o))]);
  showMenu(x, y, [T('🎞', 'B-Roll an der Abspiellinie', () => placeMedia(m, 'broll', o)), T('▣', 'Einblendung an der Abspiellinie', () => placeMedia(m, 'pip', o)),
    T('⇄', 'Einschub an der Abspiellinie', () => placeMedia(m, 'insert', o)),
    ...(m.hasAudio === false ? [] : [T('♪', 'Nur den Ton auf eine Tonspur', () => placeMedia(m, 'audio', o))])]);
}
const s0kind = (m, t) => m.kind === 'audio' || m.hasVideo === false || t.kind === 'audio' ? 'Ton' : t.kind === 'insert' ? 'Einschub' : 'B-Roll';
// Ziehen aus der Ablage auf die Zeitleiste (Maus und Touch)
(() => {
  const grid = $('#binGrid'); let g = null;
  const target = (x, y) => {
    const els = document.elementsFromPoint(x, y);
    const ov = els.find(e => e.classList && e.classList.contains('t-ovl')); if (ov) return {kind:'ovl', track: +ov.dataset.track, el: ov};
    const au = els.find(e => e.classList && e.classList.contains('t-aud')); if (au) return {kind:'audio', track: +au.dataset.atrack, el: au};
    const mn = els.find(e => e.id === 'trMain'); if (mn) return {kind:'insert', el: mn};
    const tl = els.find(e => e.id === 'tlInner'); if (tl) return {kind:'ovl', track: null, el: null};
    return null;
  };
  grid.addEventListener('pointerdown', e => {
    const d = e.target.closest('.bin-item'); if (!d || e.target.closest('.rm') || e.button === 2) return;
    const it = mediaList().find(x => x.m.uri === d.dataset.uri); if (!it) return;
    e.preventDefault(); grid.setPointerCapture(e.pointerId);
    g = {m: it.m, x0: e.clientX, y0: e.clientY, moved: false, ghost: null, d};
  });
  grid.addEventListener('pointermove', e => {
    if (!g) return;
    if (!g.moved && Math.hypot(e.clientX - g.x0, e.clientY - g.y0) < 6) return;
    if (!g.moved){ g.moved = true; g.ghost = g.d.cloneNode(true); g.ghost.classList.add('bin-ghost'); document.body.append(g.ghost); if (playing) pausePlay(); }
    Object.assign(g.ghost.style, {left: e.clientX + 'px', top: e.clientY + 'px'});
    tlInner.querySelectorAll('.drop').forEach(x => x.classList.remove('drop'));
    const t = target(e.clientX, e.clientY); g.t = t;
    if (t && t.el) t.el.classList.add('drop');
    if (t){ const o = timeAtX(e.clientX); $('#tlInfo').textContent = `${t.kind === 'insert' ? 'Einschub' : t.kind === 'audio' ? 'Nur Ton' : 'B-Roll'} bei ${fmtS(o)} – loslassen zum Einfügen`;
      if (TL.mode === 'move') { seekOut(o, false); placeHead(o); } }
  });
  const end = e => {
    if (!g) return; const s = g; g = null;
    tlInner.querySelectorAll('.drop').forEach(x => x.classList.remove('drop'));
    if (s.ghost) s.ghost.remove();
    if (!s.moved){ binMenu(s.m, e.clientX, e.clientY); return; }
    const t = s.t; if (!t){ updateTools(); return; }
    const o = timeAtX(e.clientX);
    const isAud = s.m.kind === 'audio' || s.m.hasVideo === false || t.kind === 'audio';   // Video auf eine Tonspur gezogen: nur sein Ton
    placeMedia(s.m, isAud ? 'audio' : t.kind === 'insert' ? 'insert' : 'broll', o, isAud === (t.kind === 'audio') ? t.track : null);
  };
  grid.addEventListener('pointerup', end); grid.addEventListener('pointercancel', () => { if (g && g.ghost) g.ghost.remove(); g = null; });
})();
$('#barMedia').onclick = () => toggleBin();
try { if (localStorage.getItem('ts-bin') === '1'){ $('#mediaBin').classList.remove('hidden'); $('#barMedia').classList.add('on'); } } catch(_){}
$('#binAdd').onclick = () => binAdd();
$('#binClose').onclick = () => toggleBin(false);
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
    <div id="fxKeyHost"></div>
    <div class="row" style="margin-top:12px"><button class="btn" id="fxReset">Zurücksetzen</button><button class="btn danger" id="fxDel">Entfernen</button><button class="btn primary" id="fxOk" style="margin-left:auto">Fertig</button></div>`;
  const keySrc = () => { const g = timeline[segAtOut(Math.max(itemOutRange(it)[0], Math.min(outPos, itemOutRange(it)[1] - 0.01)))]; return g && g.kind === 'main' ? g.si : (timeline.find(x => x.kind === 'main') || {}).si; };
  const keyUi = keyBlock($('#fxKeyHost'), {main: true, get: () => it.fx.key || null, set: k => { it.fx.key = k; }, el: () => V,
    uri: () => { const si = keySrc(); const s = si != null && P.sources[si]; return s && hasVid(s) ? s.uri : null; }, hasOrig: () => { const si = keySrc(); return !!(si != null && P.sources[si] && P.sources[si].orig); },
    applyMatte: m => swapSource(keySrc(), m), restoreOrig: () => restoreSource(keySrc())});
  openSheet(true);
  const before = snapshot();
  const paint = () => { const f = it.fx; $$('#fxSpeed button').forEach(b => b.classList.toggle('on', Math.abs(+b.dataset.v - f.speed) < 0.001)); $('#fxSpeedV').textContent = String(f.speed).replace('.', ',') + '×';
    $('#fxVol').value = f.vol; $('#fxVolV').textContent = Math.round(f.vol * 100) + '%'; $('#fxBright').value = f.bright; $('#fxBrightV').textContent = Math.round(f.bright * 100); $('#fxContrast').value = f.contrast; $('#fxContrastV').textContent = Math.round(f.contrast * 100);
    $('#fxSat').value = f.sat; $('#fxSatV').textContent = f.sat; $('#fxGray').checked = !!f.gray; };
  paint();
  const upd = () => { it.fx.vol = +$('#fxVol').value; it.fx.bright = +$('#fxBright').value; it.fx.contrast = +$('#fxContrast').value; it.fx.sat = +$('#fxSat').value; it.fx.gray = $('#fxGray').checked; paint(); changed(true); seekOut(outPos, false); };
  ['fxVol', 'fxBright', 'fxContrast', 'fxSat', 'fxGray'].forEach(i => $('#' + i).addEventListener('input', upd));
  $('#fxSpeed').onclick = e => { const b = e.target.closest('button'); if (!b) return; it.fx.speed = +b.dataset.v; paint(); changed(true); seekOut(outPos, false); };
  $('#fxReset').onclick = () => { it.fx = {...FX_DEF}; paint(); keyUi.paint(); changed(true); seekOut(outPos, false); drawKeyFrames(); if (window.renderTimeline) renderTimeline(); };
  $('#fxDel').onclick = () => { closeSheet(); commit(() => P.items = P.items.filter(x => x !== it)); };
  $('#fxOk').onclick = () => { const same = JSON.stringify(it.fx) === JSON.stringify(FX_DEF); if (same) P.items = P.items.filter(x => x !== it); undo.push(before); redo = []; closeSheet(); changed(true); };
  body.onclick = null;
}
// Neuer eigener Untertitel an der Abspiellinie (bis zum nächsten Untertitel, höchstens 2,5 s)
function addOwnCue(){
  if (S().enabled === false){ S().enabled = true; syncStyleInputs(); }
  const s0 = outPos, nx = computedCues().map(x => x.s).filter(x => x > s0 + 0.3).sort((a, b) => a - b)[0];
  const e0 = Math.min(total, s0 + 2.5, nx != null ? nx - 0.02 : Infinity);
  if (e0 - s0 < 0.2) return toast('Hier ist kein Platz – Abspiellinie verschieben');
  let c; commit(() => { c = newOwnCue(s0, e0, ''); insertCue(c); }, false);
  select({kind:'cue', id:c.id}); editCue(true);
}
function editCue(fresh){
  const c = selCue(); if (!c) return;
  const body = $('#sheetBody');
  body.innerHTML = `<h3>Untertitel</h3><textarea id="cueEdit" rows="3" style="width:100%;font:17px/1.4 var(--read)"></textarea>
    <div class="row" style="margin-top:10px"><button class="btn" id="cueAuto">↺ gesprochener Text</button><button class="btn primary" id="cueOk" style="margin-left:auto">Fertig</button></div>`;
  $('#cueEdit').value = cueText(c); $('#cueAuto').classList.toggle('hidden', !!c.own);
  openSheet(false); setTimeout(() => $('#cueEdit').focus(), 30);
  const before = snapshot();
  $('#cueAuto').onclick = () => { $('#cueEdit').value = autoText(c); };
  $('#cueOk').onclick = () => { const v = $('#cueEdit').value;
    if (c.own){ if (!v.trim() && fresh === true){ P.cues = P.cues.filter(x => x !== c); select(null); } else c.text = v; }
    else c.text = v.trim() === autoText(c) ? null : v;
    if (fresh !== true) { undo.push(before); redo = []; } closeSheet(); changed(false); };
  $('#cueEdit').onkeydown = ev => { if (ev.key === 'Enter' && !ev.shiftKey){ ev.preventDefault(); $('#cueOk').click(); } };
  body.onclick = null;
}
function splitCue(){
  const c = selCue(); if (!c) return;
  if (c.own){ const w = (c.text || '').trim().split(/\s+/); if (w.length < 2) return toast('Zu wenige Wörter');
    const t = cueTimes(c); if (!t) return; const k = clamp(Math.round(w.length * (outPos - t.s) / (t.e - t.s)), 1, w.length - 1);
    commit(() => { const c2 = splitOwnCue(c, w.slice(0, k).join(' '), w.slice(k).join(' ')); if (c2) P.cues.splice(P.cues.indexOf(c) + 1, 0, c2); }, false); return; }
  const ids = cueWords(c); if (ids.length < 2) return toast('Zu wenige Wörter');
  const x = curSrc(); let k = ids.findIndex(i => tokens[i].ws >= x); if (k <= 0) k = Math.ceil(ids.length / 2);
  const idx = P.cues.indexOf(c);
  commit(() => { const c2 = {id:newId(), a: ids[k-1] + 1, b: c.b, text:null, ds:0, de:c.de || 0, off:c.off}; c.b = ids[k-1]; c.text = null; c.de = 0; delete c.fa; delete c.fd; P.cues.splice(idx + 1, 0, c2); }, false);
}


// ───────── Kopieren und Einfügen ─────────
// Zwischenablage innerhalb von HoneyCut: Elemente (auch verbundene Gruppen) werden an der Abspiellinie eingefügt,
// mit gleichem Abstand untereinander. Ein Clip der Hauptspur wird als Einschub (Hauptvideo pausiert) eingefügt.
let CLIP = null;
const clone = o => JSON.parse(JSON.stringify(o));
function clipOfSource(src){ const c = clone(src); for (const k of ['env', 'tr', 'off', 'k', 'noAudio', 'legacy']) delete c[k]; return c; }
function copySel(quiet){
  const s = TL.sel; if (!s) return toast('Erst ein Element auswählen');
  if (s.kind === 'main'){
    const g = timeline[s.i], src = P.sources[g.si]; if (!hasVid(src)) return toast('Reine Tonspur – lässt sich nicht als Clip einfügen');
    CLIP = {objs: [{kind:'insert', clip: clipOfSource(src), in: r3(g.in - src.off), out: r3(g.out - src.off), rel: 0, dur: segDur(g)}]};
  } else if (s.kind === 'insert'){
    const it = timeline[s.i].item; CLIP = {objs: [{kind:'item', data: clone(it), rel: 0, dur: segDur(timeline[s.i])}]};
  } else {
    const o = s.kind === 'cue' ? selCue() : selItem(); if (!o) return;
    const ms = o.lk ? groupOf(o) : [o];
    const span = x => { if (isCueObj(x)){ const t = cueTimes(x); return t ? [t.s, t.e] : null; } return itemOutRange(x); };
    const list = ms.map(x => ({x, r: span(x)})).filter(y => y.r); if (!list.length) return;
    const a0 = Math.min(...list.map(y => y.r[0]));
    CLIP = {a0, objs: list.map(({x, r}) => isCueObj(x) ? {kind:'cue', data: clone(x), text: cueText(x), rel: r[0] - a0, dur: r[1] - r[0]}
                                                   : {kind:'item', data: clone(x), rel: r[0] - a0, dur: r[1] - r[0], track: elTrack(x)})};
  }
  const s0 = TL.sel.kind === 'main' || TL.sel.kind === 'insert' ? timeline[TL.sel.i].o : null;
  CLIP.a0 = s0 != null ? s0 : CLIP.a0; CLIP.span = Math.max(...CLIP.objs.map(c => c.rel + c.dur));
  if (quiet === true) return;
  const n = CLIP.objs.length; toast(n > 1 ? `${n} verbundene Elemente kopiert – Strg+V fügt sie an der Abspiellinie ein` : 'Kopiert – Strg+V fügt an der Abspiellinie ein');
  updateTools();
}
function cutSelToClip(){ if (!TL.sel) return toast('Erst ein Element auswählen'); copySel(); if (CLIP) delSel(); }
function pasteClip(at){
  if (!CLIP) return toast('Nichts kopiert – erst ein Element auswählen und kopieren (Strg+C)');
  if (playing) pausePlay();
  const base = at != null ? at : outPos, made = [];
  let sel = null;
  commit(() => {
    for (const c of CLIP.objs){
      const start = clamp(base + c.rel, 0, Math.max(0, total - 0.1));
      if (c.kind === 'insert' || (c.kind === 'item' && c.data.type === 'insert')){
        const it = c.kind === 'insert' ? {id:newId(), type:'insert', clip: clone(c.clip), in: c.in, out: c.out, vol: 1, corner:'or', size:0.4} : {...clone(c.data), id:newId()};
        delete it.lk; delete it.lo; delete it.lead;
        // Einschübe sitzen an einer Stelle der Hauptspur: an der Abspiellinie (im laufenden Clip)
        it.at = r3(outToSrcT(start)); P.items.push(it); made.push(it); sel = {kind:'insert', itemId: it.id, i:0}; continue;
      }
      if (c.kind === 'cue'){
        const cue = clone(c.data); cue.id = newId(); cue.own = true; cue.text = c.text; delete cue.a; delete cue.b; delete cue.lk; delete cue.lo; delete cue.lead; cue.off = false;
        setCueFree(cue, start, start + c.dur); insertCue(cue); made.push(cue); if (!sel) sel = {kind:'cue', id: cue.id}; continue;
      }
      const it = {...clone(c.data), id: newId()}; delete it.lk; delete it.lo; delete it.lead;
      it.at = r3(outToSrcT(start));
      if (it.type === 'broll' || it.type === 'pip'){
        computeOverlays();
        const busy = k => overlays.some(o => elTrack(o.x) === k && o.at < start + c.dur - 0.01 && o.end > start + 0.01);
        it.track = !busy(c.track || 1) ? (c.track || 1) : freeTrack(start, start + c.dur);
      }
      P.items.push(it); made.push(it); computeOverlays();
      if (!sel || sel.kind === 'cue') sel = {kind: it.type === 'broll' || it.type === 'pip' ? 'ovl' : it.type === 'audio' ? 'aud' : it.type, id: it.id};
    }
    if (made.length > 1){ const gid = newId(); made.forEach(x => { if (x.type !== 'insert') x.lk = gid; }); const ms = made.filter(x => x.lk); if (ms.length > 1) relinkGroup(ms); else ms.forEach(x => delete x.lk); }
  }, false);
  if (made.some(x => x.type === 'insert') && tokens.length) renderTranscript();
  TL.sel = sel; renderTimeline(); seekOut(outPos, false); updateTitles(outPos);
  toast(made.length > 1 ? `${made.length} Elemente eingefügt` : 'Eingefügt');
}
// Duplizieren: Kopie direkt hinter dem Element (bei verbundenen Elementen hinter der ganzen Gruppe)
function duplicateSel(){
  if (!TL.sel) return toast('Erst ein Element auswählen');
  const keep = CLIP; copySel(true); if (CLIP === keep) return;
  try { pasteClip(CLIP.a0 + CLIP.span); } finally { CLIP = keep; updateTools(); }
}


// ───────── Clips: Ausschnitte als eigene Kurzvideos (eigenes Projekt, eigenes Format) ─────────
// Ein Clip ist eine Kopie des Projekts, in der alles außerhalb des Ausschnitts herausgeschnitten ist.
// Er bekommt ein eigenes Format (Standard 9:16), einen Bildausschnitt (P.frame) und einen Untertitel-Look für Kurzvideos.
const CLIP_LOOKS = {
  word:    {mode:'word', size:'groß', lines:1, chars:14, outline:true, bg:false},
  punch:   {mode:'lines', size:'groß', lines:2, chars:14, dur:2, outline:true, bg:false},
  box:     {mode:'lines', size:'mittel', lines:2, chars:20, dur:3, outline:false, bg:true},
  classic: {mode:'lines', size:'mittel', lines:2, chars:32, dur:4, outline:true, bg:false},
};
function clipDialog(o1, o2){
  if (!(o2 - o1 > 0.3)) return toast('Der Ausschnitt ist zu kurz');
  const n = J(TS.listProjects() || '[]').filter(p => (p.name || '').startsWith(P.name + ' – Clip')).length + 1;
  const m = hcModal(`<h3>Clip erstellen</h3><p class="muted small">${fmtS(o1)} – ${fmtS(o2)} (${fmtD(o2 - o1)} s) wird ein eigenes Kurzvideo. Das Hauptprojekt bleibt unverändert.</p>
    <label class="field"><span>Name</span><input type="text" id="clipName"></label>
    <div class="field"><span>Format</span><div class="seg-ctl" id="clipNewFmt"><button data-v="9:16" class="on">9:16</button><button data-v="4:5">4:5</button><button data-v="1:1">1:1</button><button data-v="16:9">16:9</button><button data-v="">Original</button></div></div>
    <div class="row" style="margin-top:12px"><button class="btn" id="clipNo">Abbrechen</button><button class="btn primary" id="clipGo" style="margin-left:auto">Clip öffnen</button></div>`);
  let fmt = '9:16'; m.querySelector('#clipName').value = `${P.name} – Clip ${n}`;
  m.querySelector('#clipNewFmt').onclick = e => { const b = e.target.closest('button'); if (!b) return; fmt = b.dataset.v; m.querySelectorAll('#clipNewFmt button').forEach(x => x.classList.toggle('on', x === b)); };
  m.querySelector('#clipNo').onclick = closeHcModal;
  m.querySelector('#clipGo').onclick = () => { const name = m.querySelector('#clipName').value.trim() || `${P.name} – Clip ${n}`; closeHcModal(); makeClip(o1, o2, fmt, name); };
}
function makeClip(o1, o2, fmt, name){
  if (playing) pausePlay(); saveNow();
  const c = JSON.parse(JSON.stringify(P));
  c.id = newId(); c.name = name; c.created = c.updated = Date.now(); c.clipOf = P.id; c.clipRange = [r3(o1), r3(o2)];
  // alles außerhalb des Ausschnitts herausschneiden (in Quellzeit)
  const cut = [];
  for (const g of timeline){
    const d = segDur(g), a = g.o, e = g.o + d;
    if (g.kind === 'insert'){ if (e <= o1 + 0.01 || a >= o2 - 0.01) c.items = c.items.filter(x => x.id !== g.item.id); continue; }
    const sp = g.speed || 1, ka = Math.max(a, o1), kb = Math.min(e, o2);
    if (kb <= ka + 0.01){ cut.push([g.in, g.out]); continue; }
    if (ka > a + 0.001) cut.push([g.in, g.in + (ka - a) * sp]);
    if (kb < e - 0.001) cut.push([g.in + (kb - a) * sp, g.out]);
  }
  c.dels = (c.dels || []).concat(cut.map(([x, y]) => [r3(x), r3(y)])).sort((p, q) => p[0] - q[0])
    .reduce((acc, r) => { const l = acc[acc.length - 1]; if (l && r[0] <= l[1] + 1e-3) l[1] = Math.max(l[1], r[1]); else acc.push([...r]); return acc; }, []);
  // Elemente außerhalb des Ausschnitts entfernen
  c.items = c.items.filter(x => { if (x.type === 'insert') return true; const [a, e] = window.itemOutRange ? itemOutRange(x) : [0, 1e9]; return e > o1 + 0.05 && a < o2 - 0.05; });
  c.cues = c.cues.filter(x => { if (!x.own) return true; const t = cueTimes(x); return t && t.e > o1 && t.s < o2; });
  c.format = fmt || null;
  c.sub_style = {...c.sub_style, ...CLIP_LOOKS[fmt ? 'punch' : 'classic'], y: fmt === '9:16' || fmt === '4:5' ? 0.7 : 0.86, x: 0.5, pos: 'frei', look: fmt ? 'punch' : 'classic'};
  c.regen = true;
  TS.saveProject(c.id, JSON.stringify(c));
  // Bildausschnitt: füllt das neue Format (wird nach dem Öffnen berechnet, weil er vom Format abhängt)
  const pid = c.id; closeProject(); openProject(pid);
  const fill = () => { if (!P || P.id !== pid) return; if (P.format && !P.frame){ P.frame = clampFrame({sc: coverSc(), tx: 0, ty: 0}); changed(true); saveNow(); } if (window.slSyncAll) slSyncAll(); setTab('clip'); seekOut(0, false); };
  let tries = 0; (function wait(){ if (P && P.id === pid) return fill(); if (++tries < 60) setTimeout(wait, 100); })();
  toast('Clip erstellt – hier Format, Ausschnitt, Untertitel und Hook einstellen');
}
// Ausschnitt aus der Textauswahl
$('#selClip').onclick = () => {
  const ids = selIds().filter(i => tokens[i].type !== 'pause'); if (!ids.length) return;
  const outs = ids.filter(i => !isCut(i)).map(i => [srcToOut(snapSrc(wS(tokens[i]))), srcToOut(wE(tokens[i]))]);
  if (!outs.length) return toast('Nur weggeschnittene Wörter markiert');
  const o1 = Math.max(0, Math.min(...outs.map(x => x[0])) - 0.08), o2 = Math.min(total, Math.max(...outs.map(x => x[1])) + 0.15);
  clipDialog(o1, o2);
};
// ── Clip-Studio ──
function renderClip(){
  if (!P) return;
  const par = P.clipOf && J(TS.loadProject(P.clipOf) || 'null');
  $('#clipParent').classList.toggle('hidden', !par);
  $('#clipInfo').textContent = `${fmtS(total)} lang · ${P.format || 'Originalformat'}${par ? ' · aus „' + par.name + '“' : ''}`;
  $$('#clipFmt button').forEach(b => b.classList.toggle('on', (b.dataset.v || null) === (P.format || null)));
  const F = P.frame || {sc:1, tx:0, ty:0}, mx = Math.max(coverSc() * 2.5, 3);
  $('#clipZoom').value = Math.round(zoomToSl(F.sc || 1)); $('#clipZoomV').textContent = Math.round((F.sc || 1) * 100) + ' %';
  $$('#clipLooks button').forEach(b => b.classList.toggle('on', b.dataset.look === S().look));
  $$('#clipColors button').forEach(b => b.classList.toggle('on', (b.dataset.c || '').toLowerCase() === (S().color || '').toLowerCase()));
  const hook = P.items.find(x => x.type === 'title' && x.hook); if (document.activeElement !== $('#clipHook')) $('#clipHook').value = hook ? hook.text : '';
}
function setFrame(F, quiet){ P.frame = clampFrame(F); applyMainTransform(); placeBox(); if (!quiet){ changed(false); renderClip(); } }
$('#clipFmt').onclick = e => { const b = e.target.closest('button'); if (!b) return;
  commit(() => { P.format = b.dataset.v || null; P.frame = P.format ? clampFrame({sc: coverSc(), tx: 0, ty: 0}) : null; }, true);
  fitStage(); setTimeout(fitStage, 50); renderExportForm(); renderClip(); seekOut(outPos, false); toast(P.format ? `Format ${P.format}` : 'Originalformat');
  if (window.slSyncAll) slSyncAll(); };
$('#paneClip').addEventListener('click', e => {
  const b = e.target.closest('[data-fr],[data-look],[data-c],[data-y]'); if (!b || !P) return;
  if (b.dataset.fr){ const F = {...(P.frame || {sc:1, tx:0, ty:0})}, [wf] = fitFrac(), mx = Math.max(0, (F.sc * wf - 1) / 2);
    if (b.dataset.fr === 'fit') Object.assign(F, {sc:1, tx:0, ty:0}); else if (b.dataset.fr === 'fill') Object.assign(F, {sc: coverSc(), tx:0, ty:0});
    else F.tx = b.dataset.fr === 'l' ? mx : b.dataset.fr === 'r' ? -mx : 0;
    commit(() => setFrame(F, true), false); renderClip(); return; }
  if (b.dataset.look){ const L = CLIP_LOOKS[b.dataset.look]; commit(() => { Object.assign(S(), L, {look: b.dataset.look}); if (L.bg) S().bg = true; else delete S().bg; genCues(); }, false);
    syncStyleInputs(); styleOverlay(); renderClip(); toast('Untertitel-Look geändert'); return; }
  if (b.dataset.c){ commit(() => S().color = b.dataset.c, false); syncStyleInputs(); styleOverlay(); renderClip(); return; }
  if (b.dataset.y){ commit(() => { S().y = +b.dataset.y; S().x = 0.5; S().pos = 'frei'; }, false); syncStyleInputs(); styleOverlay(); placeOverlay(); return; }
});
// Zoomregler: links 20 % (weit herausgezoomt), Mitte = ganzes Bild … rechts stark vergrößert (logarithmisch)
const ZMIN = 0.2, zmax = () => Math.max(coverSc() * 4, 6);
const zoomToSl = sc => sc <= 1 ? 30 * Math.log(sc / ZMIN) / Math.log(1 / ZMIN) : 30 + 70 * Math.log(sc) / Math.log(zmax());
const slToZoom = v => v <= 30 ? ZMIN * Math.pow(1 / ZMIN, v / 30) : Math.pow(zmax(), (v - 30) / 70);
$('#clipZoom').oninput = e => { const F = {...(P.frame || {sc:1, tx:0, ty:0})}; let sc = slToZoom(+e.target.value); if (Math.abs(sc - 1) < 0.03) sc = 1; if (Math.abs(sc - coverSc()) < 0.04 * coverSc()) sc = coverSc();
  F.sc = sc; setFrame(F, true); $('#clipZoomV').textContent = Math.round(F.sc * 100) + ' %'; };
$('#clipZoom').onpointerdown = () => { $('#clipZoom')._b = snapshot(); };
$('#clipZoom').onchange = () => { if ($('#clipZoom')._b){ undo.push($('#clipZoom')._b); redo = []; $('#clipZoom')._b = null; } changed(false); renderClip(); };
// Im Bild ziehen verschiebt den Ausschnitt (nur im Clip-Reiter, sonst gilt das normale Verhalten)
(() => {
  const st = $('#stage'); let g = null;
  const pts = new Map();   // zwei Finger: zoomen
  st.addEventListener('pointerdown', e => {
    if (!P || tab !== 'clip' || !P.format || e.target.closest('#subOv,.titlebox,#pipBox,#cropBox')) return;
    pts.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (pts.size === 2 && g){ const [a, b] = [...pts.values()]; g.pinch = {d0: Math.hypot(a.x - b.x, a.y - b.y), F: {...(P.frame || {sc:1, tx:0, ty:0})}}; g.moved = true; st.setPointerCapture(e.pointerId); return; }
    g = {x0: e.clientX, y0: e.clientY, F: {...(P.frame || {sc:1, tx:0, ty:0})}, moved: false, b: snapshot()}; st.setPointerCapture(e.pointerId);
  });
  st.addEventListener('pointermove', e => {
    if (!g) return; if (pts.has(e.pointerId)) pts.set(e.pointerId, {x: e.clientX, y: e.clientY});
    if (g.pinch && pts.size >= 2){ const [a, b] = [...pts.values()], d = Math.hypot(a.x - b.x, a.y - b.y); if (playing) pausePlay();
      setFrame({...g.pinch.F, sc: g.pinch.F.sc * d / Math.max(10, g.pinch.d0)}, true); return; }
    if (g.pinch) return;
    const r = st.getBoundingClientRect(), dx = (e.clientX - g.x0) / r.width, dy = (e.clientY - g.y0) / r.height;
    if (Math.abs(dx) + Math.abs(dy) > 0.006) g.moved = true; if (!g.moved) return;
    if (playing) pausePlay(); setFrame({...g.F, tx: g.F.tx + dx, ty: g.F.ty + dy}, true);
  });
  const end = e => { if (e) pts.delete(e.pointerId); if (!g || pts.size) return; const x = g; g = null; if (x.moved){ undo.push(x.b); redo = []; changed(false); renderClip(); st.dataset.noclick = '1'; setTimeout(() => delete st.dataset.noclick, 50); } };
  st.addEventListener('pointerup', end); st.addEventListener('pointercancel', end);
  st.addEventListener('click', e => { if (st.dataset.noclick){ e.stopImmediatePropagation(); } }, true);
  st.addEventListener('wheel', e => { if (!P || tab !== 'clip' || !P.format) return; e.preventDefault(); const F = {...(P.frame || {sc:1, tx:0, ty:0})}; F.sc = F.sc * (e.deltaY < 0 ? 1.05 : 1 / 1.05); setFrame(F); }, {passive:false});
})();
// Hook: Titel am Anfang
$('#clipHookSet').onclick = () => {
  const text = $('#clipHook').value.trim(); if (!text) return toast('Erst einen Text eingeben');
  const d = +$('#clipHookDur').value || Math.max(1, total - 0.05);
  commit(() => { let it = P.items.find(x => x.type === 'title' && x.hook);
    if (!it){ it = {id:newId(), type:'title', hook:true, x:0.5, y:0.16, size:'groß', scale:1.1, color:'#FFFFFF', outline:false, bg:true}; P.items.push(it); }
    it.text = text; it.at = r3(outToSrc(0)); it.dur = Math.min(d, Math.max(0.5, total - 0.05)); }, false);
  updateTitles(outPos); seekOut(0, false); renderClip(); toast('Hook eingeblendet – im Bild ziehen verschiebt ihn');
};
$('#clipHookDel').onclick = () => { commit(() => P.items = P.items.filter(x => !(x.type === 'title' && x.hook)), false); updateTitles(outPos); $('#clipHook').value = ''; renderClip(); };
// Tempo
$('#clipPauses').onclick = () => { let n = 0; commit(() => n = trimPauses(0), false); if (spans.length) tokens.forEach(t => paint(t.i)); toast(n ? `${n} Pausen herausgeschnitten` : 'Keine Pausen mehr'); renderClip(); };
$('#clipFillers').onclick = () => { $('#fillerBtn').click(); renderClip(); };
$('#clipRepeats').onclick = () => { $('#repeatBtn').click(); renderClip(); };
// Auto-Zoom: an Satzanfängen abwechselnd ran (Sprung) und wieder normal – höchstens alle 2 s
$('#clipAutoZoom').onclick = () => {
  const starts = []; let prev = null, last = -9;
  for (const t of tokens){ if (t.type !== 'word' || isCut(t.i)) { if (t.type === 'pause' && t.e - t.s > 0.35) prev = null; continue; }
    const o = srcToOut(snapSrc(t.ws)); if (o >= total) continue;
    const newSent = !prev || /[.?!…:]$/.test(tokText(prev)); if (newSent && o - last >= 2){ starts.push({t, o}); last = o; } prev = t; }
  if (starts.length < 2) for (let o = 0; o < total; o += 3) starts.push({o});
  let n = 0;
  commit(() => { P.items = P.items.filter(x => !(x.type === 'zoom' && x.auto));
    starts.forEach((s0, k) => { if (k % 2 === 0) return; const next = starts[k + 1], e = next ? next.o : total;
      const a = outToSrc(s0.o), b = outToSrc(Math.max(s0.o + 0.4, e - 0.02));
      P.items.push({id:newId(), type:'zoom', auto:true, at:r3(a), dur:r3(Math.max(0.4, b - a)), kind:'punch', strength:1.18, cx:0.5, cy:0.42}); n++; }); }, false);
  seekOut(outPos, false); toast(n ? `${n} Zoom-Sprünge gesetzt – Feinschnitt im Studio` : 'Zu wenig Sätze für Auto-Zoom');
};
$('#clipZoomHere').onclick = () => { commit(() => P.items.push({id:newId(), type:'zoom', at:r3(outToSrc(outPos)), dur:2, kind:'punch', strength:1.2, cx:0.5, cy:0.42}), false); seekOut(outPos, false); toast('Zoom an der Abspiellinie (2 s)'); };
$('#clipZoomOff').onclick = () => { let n = P.items.filter(x => x.type === 'zoom').length; commit(() => P.items = P.items.filter(x => x.type !== 'zoom'), false); seekOut(outPos, false); toast(n ? `${n} Zooms entfernt` : 'Keine Zooms'); };
$('#clipExport').onclick = () => setTab('export');
$('#clipStudio').onclick = () => setTab('studio');
$('#clipParent').onclick = () => { const id = P.clipOf; closeProject(); openProject(id); };


// ───────── Lautstärke: jeder Clip einzeln, und alle mit einem Klick angleichen ─────────
// Clips = Videos der Hauptspur, Einschübe, Videos auf den Videospuren mit Ton, Tonspuren.
const envCache = new Map();   // Datei → Lautstärkeverlauf (dB je 10 ms)
function volClips(){
  const out = [];
  P.sources.forEach((src, k) => { if (src.hasAudio === false || src.noAudio) return; out.push({key:'s' + k, name: src.name, kind: P.sources.length > 1 ? `Video ${k + 1} (Hauptspur)` : 'Hauptvideo', uri: src.uri, a: 0, b: src.duration,
    get: () => srcVol(k), set: v => { src.vol = r3(v); }}); });
  for (const it of P.items){
    if (!it.clip || isImg(it.clip) || it.clip.hasAudio === false) continue;
    if (!['insert', 'audio', 'broll', 'pip'].includes(it.type)) continue;
    const def = it.type === 'insert' || it.type === 'audio' ? 1 : 0;
    out.push({key:'i' + it.id, name: it.clip.name, kind: it.type === 'audio' ? 'Tonspur' : it.type === 'insert' ? 'Einschub' : 'Videospur', uri: it.clip.uri, a: it.in, b: it.out, muted: (it.vol ?? def) <= 0,
      get: () => it.vol ?? def, set: v => { it.vol = r3(v); }});
  }
  return out;
}
function envOfUri(uri){
  const src = P.sources.find(x => x.uri === uri); if (src && envArr(src)) return Promise.resolve(envArr(src));
  if (envCache.has(uri)) return envCache.get(uri);
  const p = new Promise(res => {
    if (!TS.envelope) return res(null);
    let id; try { id = TS.envelope(uri); } catch(_){ return res(null); }
    watchJob(id, () => {}, j => { const e = j.result && j.result.env; if (!e) return res(null); const b = atob(e), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); envDone.set(uri, a); res(a); }, () => res(null));
  });
  envCache.set(uri, p); return p;
}
// Lautheit eines Bereichs (gated, ähnlich LUFS): Mittel der Leistung über laute Stellen, Stille zählt nicht
function loudness(a, from, to){
  if (!a) return null;
  const i0 = Math.max(0, Math.floor(from * 100)), i1 = Math.min(a.length, Math.ceil(to * 100)); let n = 0, sum = 0;
  const pw = i => Math.pow(10, (a[i] / 2.8 - 90) / 10);
  for (let i = i0; i < i1; i++){ if (a[i] / 2.8 - 90 > -60){ sum += pw(i); n++; } } if (!n) return null;
  const g = 10 * Math.log10(sum / n) - 10; n = 0; sum = 0;
  for (let i = i0; i < i1; i++){ if (a[i] / 2.8 - 90 > g){ sum += pw(i); n++; } }
  return n ? 10 * Math.log10(sum / n) : null;
}
const pct = v => Math.round(v * 100) + ' %';
function openVolumes(){
  if (!P) return; const body = $('#sheetBody'), list = volClips();
  body.innerHTML = `<h3>Lautstärke</h3>
    <p class="muted small">Jeder Clip einzeln, oder alle mit einem Klick auf dieselbe Lautheit bringen. Stumm geschaltete B-Roll bleibt stumm. Über 100 % wird verstärkt.</p>
    <div class="row"><button class="btn primary" id="volLevel">🔊 Alle angleichen</button><button class="btn" id="volReset">Alle auf 100 %</button><span class="muted small" id="volMsg"></span></div>
    <div class="vol-list">${list.length ? '' : '<p class="muted small">Keine Clips mit Ton.</p>'}</div>
    <div class="row" style="margin-top:12px"><button class="btn primary" id="volOk" style="margin-left:auto">Fertig</button></div>`;
  const box = body.querySelector('.vol-list');
  for (const c of list){
    const row = document.createElement('div'); row.className = 'vol-row';
    row.innerHTML = `<div class="vol-name"><b></b><span class="muted small"></span></div><input type="range" min="0" max="400" step="5"><span class="vol-v mono"></span><span class="vol-l muted small mono"></span>`;
    row.querySelector('b').textContent = c.name; row.querySelector('.muted').textContent = c.kind + (c.muted ? ' · stumm' : '');
    const r = row.querySelector('input'), v = row.querySelector('.vol-v'); r.value = Math.round(c.get() * 100); v.textContent = pct(c.get());
    r.onpointerdown = () => { r._b = snapshot(); };
    r.oninput = () => { c.set(+r.value / 100); v.textContent = pct(+r.value / 100); changed(false); seekOut(outPos, false); };
    r.onchange = () => { if (r._b){ undo.push(r._b); redo = []; r._b = null; } renderTimeline(); };
    row.dataset.key = c.key; box.append(row);
  }
  openSheet(false);
  $('#volOk').onclick = closeSheet;
  $('#volReset').onclick = () => { commit(() => list.forEach(c => { if (!c.muted) c.set(1); }), false); seekOut(outPos, false); openVolumes(); toast('Alle hörbaren Clips auf 100 %'); };
  $('#volLevel').onclick = () => levelAll();
  body.onclick = null;
}
// Alle hörbaren Clips auf dieselbe Lautheit: Verstärkung je Clip = Ziel − gemessene Lautheit
async function levelAll(){
  const list = volClips().filter(c => !c.muted); if (list.length < 2) return toast('Es braucht mindestens zwei Clips mit Ton');
  const msg = t => { const m = $('#volMsg'); if (m) m.textContent = t; };
  msg('Lautstärke wird gemessen …'); toast('Lautstärke wird gemessen …');
  const meas = [];
  for (const c of list){ const a = await envOfUri(c.uri); const L = loudness(a, c.a, c.b); if (L != null) meas.push({c, L}); }
  if (meas.length < 2){ msg(''); return toast('Lautstärke ließ sich nicht messen'); }
  // Ziel: die lautere Mitte – aber so, dass auch der leiseste Clip es mit höchstens +12 dB erreicht
  const sorted = meas.map(m => m.L).sort((x, y) => x - y), target = Math.min(sorted[Math.floor(sorted.length / 2)], sorted[0] + 12);
  commit(() => { for (const m of meas) m.c.set(clamp(Math.pow(10, (target - m.L) / 20), 0.1, 4)); }, false);
  seekOut(outPos, false); renderTimeline();
  if ($('#sheet').classList.contains('hidden')) toast(`${meas.length} Clips angeglichen`); else { openVolumes(); msg(`${meas.length} Clips angeglichen`); }
  for (const m of meas){ const row = document.querySelector(`.vol-row[data-key="${m.c.key}"] .vol-l`); if (row) row.textContent = `vorher ${m.L.toFixed(0)} dB`; }
}
$('#barVol').onclick = () => openVolumes();
$('#volBtn').onclick = () => openVolumes();
$('#clipLevel').onclick = () => levelAll();

// ───────── Tastatur (wie CapCut) und Maus ─────────
const KEYS = [
  ['Leertaste', 'Abspielen / Pause'], ['K / L', 'Pause / Abspielen'],
  ['← / →', 'ein Bild zurück / vor'], ['Umschalt + ← / →', 'fünf Bilder zurück / vor'],
  ['↑ / ↓', 'zum vorigen / nächsten Schnitt springen'], ['Pos1 / Ende', 'an den Anfang / das Ende'],
  ['Strg + F', 'im Text suchen (Enter: nächster Treffer, dann Entf löscht)'], ['Strg + H', 'suchen und ersetzen'], ['Doppelklick auf ein Wort', 'Wort korrigieren'],
  ['Markierten Text ziehen', 'Abschnitt verschieben'], ['Clip in der Zeitleiste ziehen', 'Clips umsortieren'],
  ['Strg + B', 'an der Abspiellinie teilen'], ['Strg + C / X / V', 'Element kopieren / ausschneiden / an der Abspiellinie einfügen'], ['Strg + D', 'Element duplizieren (direkt dahinter)'], ['Q / W', 'links / rechts der Abspiellinie löschen (mit ausgewähltem Element: nur dessen Teil)'],
  ['Entf / Rücktaste', 'Auswahl löschen'], ['Alt + ← / →', 'Auswahl um ein Bild verschieben'],
  [', / .', 'Anfang / Ende der Auswahl zur Abspiellinie trimmen'],
  ['M', 'Keyframe an der Abspiellinie setzen / entfernen (ausgewählter Clip oder Einblendung)'], ['U', 'Untertitel weggeschnittener Wörter behalten / wieder weg (markierte Wörter oder ausgewählter Untertitel)'], ['F', 'Vollbild-Vorschau'],
  ['Strg / Umschalt + Klick', 'Objekte zum Verbinden auswählen'], ['Umschalt + Mausrad', 'Spuren senkrecht scrollen'],
  ['Element senkrecht ziehen', 'auf eine andere Videospur legen'],
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
  if (k === 'Escape' && $('#proj').classList.contains('full')){ setFull(false); return; }
  if (!typing && !mod && (k === 'f' || k === 'F')){ e.preventDefault(); setFull(!$('#proj').classList.contains('full')); return; }
  if (k === 'Escape' && TL.pick){ endPick(); return; }
  if (Crop.it && (k === 'Escape' || k === 'Enter') && !typing){ e.preventDefault(); endCrop(k === 'Enter'); return; }
  if (k === 'Escape'){ closeMenu(); if (!$('#sheet').classList.contains('hidden')) closeSheet(); else { select(null); clearSel(); } return; }
  if (typing) return;
  const handled = () => e.preventDefault();
  if (e.altKey && /^[1-4]$/.test(k)){ handled(); const t = ['text', 'subs', 'studio', 'export'][+k - 1]; if (tokens.length || t === 'studio' || t === 'export') setTab(t); return; }
  if (mod && k.toLowerCase() === 'z'){ handled(); (e.shiftKey ? $('#redoBtn') : $('#undoBtn')).click(); return; }
  if (mod && k.toLowerCase() === 'y'){ handled(); $('#redoBtn').click(); return; }
  if (mod && k.toLowerCase() === 'b'){ handled(); splitHere(); return; }
  if (mod && studioOn() && !e.altKey){ const lk = k.toLowerCase(), txtSel = String(window.getSelection && getSelection() || '').trim();
    if (lk === 'c' && TL.sel && !txtSel){ handled(); copySel(); return; }
    if (lk === 'x' && TL.sel && !txtSel){ handled(); cutSelToClip(); return; }
    if (lk === 'v' && CLIP){ handled(); pasteClip(); return; }
    if (lk === 'd' && TL.sel){ handled(); duplicateSel(); return; } }
  if (mod && k.toLowerCase() === 'h' && tokens.length){ handled(); if (tab !== 'text') setTab('text'); showFind(true); $('#replRow').classList.remove('hidden'); $('#replToggle').classList.add('on'); ($('#findIn').value ? $('#replIn') : $('#findIn')).focus(); return; }
  if (mod && k.toLowerCase() === 'f' && tokens.length){ handled(); if (tab !== 'text') setTab('text'); showFind(true); $('#findIn').select(); return; }
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
    case 'u': case 'U': {   // Untertitel weggeschnittener Wörter behalten / wieder weg
      if (tab === 'text' && selA != null && !$('#selKeep').classList.contains('hidden')){ handled(); $('#selKeep').click(); return; }
      const c = TL.sel && TL.sel.kind === 'cue' ? selCue() : null;
      if (c && !c.own){ const cut = range(c.a, Math.min(c.b, tokens.length - 1)).filter(i => isTextTok(i) && tokText(tokens[i]) && isCut(i)); if (cut.length){ handled(); const on = !cut.every(i => tokens[i].ks);
        commit(() => keepSubs(cut, on), false); toast(on ? 'Untertitel bleibt – erscheint kurz am Schnitt' : 'Untertitel wieder weg'); } }
      return; }
    case 't': case 'T': if (studioOn()){ handled(); addTitle(); } return;
    case 'm': case 'M': if (studioOn()){ handled(); const it = TL.sel && TL.sel.kind === 'ovl' ? selItem() : (curPip || null);
      if (!it && TL.sel && TL.sel.kind === 'main'){ toggleMainKeyframe(timeline[TL.sel.i]); return; }
      if (!it) toast('Erst einen Clip oder eine Einblendung auswählen – M setzt dann an der Abspiellinie einen Keyframe'); else { if (!TL.sel || TL.sel.id !== it.id) select({kind:'ovl', id:it.id}); toggleKeyframe(it); } } return;
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
  const body = $('.tl-body');
  if (e.shiftKey && body.scrollHeight > body.clientHeight + 1){ e.preventDefault(); body.scrollTop += e.deltaY || e.deltaX; return; }   // Umschalt+Mausrad: Spuren senkrecht
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

// Zeitleiste im Clip-Reiter ein-/ausklappen (gemerkt pro Gerät)
function setTlFold(min){ $('#proj').classList.toggle('tl-min', !!min); try { localStorage.setItem('hc-clip-tl', min ? '1' : '0'); } catch(_){}
  $('#tlFold em').textContent = min ? 'antippen zum Ausklappen' : 'antippen zum Einklappen'; setTimeout(fitStage, 0); if (!min && P && studioOn()) setTimeout(renderTimeline, 30); }
$('#tlFold').onclick = () => setTlFold(!$('#proj').classList.contains('tl-min'));
try { setTlFold(localStorage.getItem('hc-clip-tl') === '1'); } catch(_){ setTlFold(false); }
