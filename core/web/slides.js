'use strict';
/* B-Roll-Generator: Folien im festen HoneyCut-Design (Anthrazit/Creme, Rot als Akzent, Inter + Lora),
   direkt aus dem Transkript. Eine Folie kann mit einer Textstelle verknüpft sein (Token a…b) – dann weiß sie,
   wann sie gezeigt wird. Gerendert wird per Canvas zu einem PNG, das als ganz normales B-Roll-Bild auf einer
   Videospur liegt (Vorschau, alle Exporte, CapCut: jede Folie einzeln auf ihrem Timecode). */

const SL_LAYOUTS = [
  {k:'titel',    n:'Titel',       f:['kicker', 'title', 'text', 'source']},
  {k:'liste',    n:'Stichpunkte', f:['kicker', 'title', 'text', 'source'], lbl:{text:'Stichpunkte (eine Zeile = ein Punkt)'}},
  {k:'zitat',    n:'Zitat',       f:['text', 'title', 'source'], lbl:{text:'Zitat', title:'Wer hat es gesagt?'}},
  {k:'zahl',     n:'Zahl',        f:['kicker', 'title', 'text', 'source'], lbl:{title:'Zahl (z. B. 42 %)', text:'Was die Zahl bedeutet'}},
  {k:'begriff',  n:'Begriff',     f:['kicker', 'title', 'text', 'source'], lbl:{title:'Begriff', text:'Bedeutung'}},
  {k:'bild',     n:'Bild + Text', f:['kicker', 'title', 'text', 'img', 'source']},
  {k:'vollbild', n:'Vollbild',    f:['title', 'text', 'img', 'source'], lbl:{title:'Bildunterschrift', text:'Zusatz (klein)'}},
  {k:'zwei',     n:'Zwei Seiten', f:['title', 'text', 'text2', 'source'], lbl:{text:'Linke Seite (1. Zeile = Überschrift)', text2:'Rechte Seite (1. Zeile = Überschrift)'}},
];
const SL_LBL = {kicker:'Rubrik (klein, oben)', title:'Titel', text:'Text', text2:'Zweite Spalte', source:'Quelle', img:'Bild'};
const SLC = {dark: {bg:'#131312', fg:'#EDE7DA', mute:'#A9A397', acc:'#E5402A', line:'#34332F', soft:'#1E1E1C'},
             light:{bg:'#EDE7DA', fg:'#131312', mute:'#5E584D', acc:'#B8301D', line:'#CFC6B0', soft:'#E2DACA'}};
const slLayout = k => SL_LAYOUTS.find(x => x.k === k) || SL_LAYOUTS[0];
// ───────── Designprofile: Farben, Schriften, Anordnung ─────────
// Mitgelieferte Profile (nicht löschbar) und eigene (im Gerät gespeichert). Das gewählte Profil liegt als Kopie im
// Projekt (P.slideProfile) – so sehen die Folien auch auf einem anderen Gerät gleich aus.
const SL_BUILTIN = [
  {id:'hb', name:'Honey Balecta Standard', builtin:true,
   colors:{dark:{bg:'#131312', fg:'#EDE7DA', mute:'#A9A397', acc:'#E5402A'}, light:{bg:'#EDE7DA', fg:'#131312', mute:'#5E584D', acc:'#B8301D'}},
   fonts:{head:'Inter', body:'Inter', serif:'Lora'}, align:'left', pad:'normal', bar:true, sourceRight:false, theme:'wechselnd', titleScale:1, textScale:1},
  {id:'ruhig', name:'Hell & ruhig', builtin:true,
   colors:{dark:{bg:'#1F2A24', fg:'#F4EFE6', mute:'#B9B3A6', acc:'#7FB38F'}, light:{bg:'#F4EFE6', fg:'#1F2A24', mute:'#6A675F', acc:'#3E8A55'}},
   fonts:{head:'Lora', body:'Inter', serif:'Lora'}, align:'center', pad:'weit', bar:false, sourceRight:false, theme:'hell', titleScale:0.95, textScale:1},
  {id:'kontrast', name:'Kontrast', builtin:true,
   colors:{dark:{bg:'#0A0A0A', fg:'#FFFFFF', mute:'#B5B5B5', acc:'#F5D90A'}, light:{bg:'#F5D90A', fg:'#0A0A0A', mute:'#3A3A3A', acc:'#0A0A0A'}},
   fonts:{head:'k:anton', body:'Inter', serif:'k:anton'}, align:'center', pad:'eng', bar:true, sourceRight:true, theme:'dunkel', titleScale:1.2, textScale:1.05},
];
const SL_PROF_KEY = 'hc-slide-profiles';
function slUserProfiles(){ try { return JSON.parse(localStorage.getItem(SL_PROF_KEY) || '[]').filter(p => p && p.id && p.colors); } catch(_){ return []; } }
function slSaveUserProfiles(list){ try { localStorage.setItem(SL_PROF_KEY, JSON.stringify(list)); } catch(_){} }
function slAllProfiles(){ const own = slUserProfiles(); const pr = P && P.slideProfile;
  const list = SL_BUILTIN.concat(own); if (pr && !list.some(x => x.id === pr.id)) list.push(pr); return list; }
const slClone = o => JSON.parse(JSON.stringify(o));
function slProfile(){ return (P && P.slideProfile) || SL_BUILTIN[0]; }
// Hilfsfarben (Linien, Flächen) aus Hintergrund und Schrift gemischt
function slMix(a, b, f){ const h = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16)); const A = h(a), B = h(b);
  return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * f).toString(16).padStart(2, '0')).join(''); }
function slColors(pr, dark){ const c = pr.colors[dark ? 'dark' : 'light']; return {...c, line: slMix(c.bg, c.fg, 0.18), soft: slMix(c.bg, c.fg, 0.06)}; }
// Schrift einer Rolle: 'Inter'/'Lora' (variabel, alle Stärken) oder 'k:<Schlüssel>' (mitgelieferte/eigene Schrift)
function slFontFn(spec, w, it, scale){
  const fam = spec === 'Lora' ? 'Lora, Georgia, serif' : spec && spec.startsWith('k:') ? `"TSF-${spec.slice(2)}", Inter, sans-serif` : 'Inter, "Segoe UI", sans-serif';
  const wt = spec && spec.startsWith('k:') ? 400 : w;
  const f = s => `${it ? 'italic ' : ''}${wt} ${s.toFixed(1)}px ${fam}`; f.scale = scale || 1; return f;
}
function slFontOptions(){
  return [{v:'Inter', l:'Inter'}, {v:'Lora', l:'Lora (Serifen)'}].concat(FONTS.filter(f => f.key && f.key !== 'inter' && f.key !== 'lora').map(f => ({v:'k:' + f.key, l:f.label})), userFonts.map(f => ({v:'k:' + f.key, l:f.label + ' (eigene)'})));
}
const slIsDark = (sl, k, pr) => { if (sl.dark != null) return !!sl.dark; const t = (pr || slProfile()).theme; if (t === 'dunkel') return true; if (t === 'hell') return false; return (k ?? P.slides.indexOf(sl)) % 2 === 0; };
let slCur = null, slSel = null, slOpen = null;   // ausgewählte Folie, Auswahl im Transkript, laufende Folie im Studio

// ───────── Zeichnen ─────────
const slImgCache = new Map();
function slImg(uri){
  if (!uri) return Promise.resolve(null);
  if (!slImgCache.has(uri)) slImgCache.set(uri, new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = MEDIA(uri); }));
  return slImgCache.get(uri);
}
let slFontsP = null; const slFontsDone = new Set();
const slFonts = (pr = slProfile()) => { const base = slFontsP ||= Promise.all(['400', '500', '700', '800', '900'].map(w => document.fonts.load(`${w} 40px Inter`))
  .concat([document.fonts.load('600 40px Lora'), document.fonts.load('700 40px Lora'), document.fonts.load('italic 600 40px Lora')])).catch(() => {});
  const extra = Object.values(pr.fonts || {}).filter(f => f && f.startsWith('k:') && !slFontsDone.has(f));
  return Promise.all([base, ...extra.map(f => document.fonts.load(`400 40px "TSF-${f.slice(2)}"`).then(() => slFontsDone.add(f)).catch(() => {}))]); };
const INTER = w => s => `${w} ${s.toFixed(1)}px Inter, "Segoe UI", sans-serif`;
const LORA = (w, it) => s => `${it ? 'italic ' : ''}${w} ${s.toFixed(1)}px Lora, Georgia, serif`;
function slWrap(ctx, text, maxW){
  const out = [];
  for (const line of String(text || '').split('\n')){
    const words = line.split(/\s+/).filter(Boolean); let cur = '';
    for (const w of words){ const t = cur ? cur + ' ' + w : w; if (cur && ctx.measureText(t).width > maxW){ out.push(cur); cur = w; } else cur = t; }
    out.push(cur);
  }
  while (out.length && !out[out.length - 1]) out.pop();
  return out;
}
// Größte Schrift, bei der der Text in die Fläche passt
function slFit(ctx, text, font, maxW, maxH, size, min, lh){
  size *= font.scale || 1; min *= font.scale || 1;
  for (let sz = size; sz > min; sz *= 0.93){ ctx.font = font(sz); const lines = slWrap(ctx, text, maxW); if (lines.length * sz * lh <= maxH && lines.every(l => ctx.measureText(l).width <= maxW + 1)) return {lines, size: sz}; }
  ctx.font = font(min); return {lines: slWrap(ctx, text, maxW), size: min};
}
function slText(ctx, f, x, y, lh, color, align = 'left'){
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  f.lines.forEach((l, i) => ctx.fillText(l, x, y + f.size * (0.82 + i * lh)));
  return y + f.size * lh * f.lines.length;
}
function slCover(ctx, im, x, y, w, h){
  const f = Math.max(w / im.width, h / im.height), dw = im.width * f, dh = im.height * f;
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); ctx.restore();
}
// Platzhalter, solange kein Bild gewählt ist: flaches Piktogramm (Berg und Sonne)
function slImgPh(ctx, x, y, w, h, C, u){
  ctx.fillStyle = C.soft; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = C.line; ctx.lineWidth = Math.max(2, u * 0.35); ctx.setLineDash([u * 1.2, u * 0.9]); ctx.strokeRect(x + u, y + u, w - 2 * u, h - 2 * u); ctx.setLineDash([]);
  const cx = x + w / 2, cy = y + h / 2, s = Math.min(w, h) * 0.18;
  ctx.fillStyle = C.line; ctx.beginPath(); ctx.moveTo(cx - s * 1.6, cy + s); ctx.lineTo(cx - s * 0.4, cy - s * 0.4); ctx.lineTo(cx + s * 0.3, cy + s * 0.3); ctx.lineTo(cx + s * 0.8, cy - s * 0.1); ctx.lineTo(cx + s * 1.6, cy + s); ctx.closePath(); ctx.fill();
  ctx.fillStyle = C.acc; ctx.beginPath(); ctx.arc(cx + s * 0.9, cy - s * 0.9, s * 0.35, 0, 7); ctx.fill();
}
async function renderSlide(sl, W, H, k, prof){
  const pr = prof || slProfile(); await slFonts(pr);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'), port = H > W, u = Math.min(W, H) / 100;
  const C = slColors(pr, slIsDark(sl, k, pr) || sl.layout === 'vollbild'), CD = slColors(pr, true);
  // Schriften des Profils: kräftige Schnitte = Überschrift, leichte = Fließtext, Lora-Stellen = Zitat/Begriff
  const INTER = w => w >= 700 ? slFontFn(pr.fonts.head, w, false, w >= 800 ? pr.titleScale : 1) : slFontFn(pr.fonts.body, w, false, pr.textScale);
  const LORA = (w, it) => slFontFn(pr.fonts.serif, w, it, pr.titleScale);
  const pf = pr.pad === 'eng' ? 0.75 : pr.pad === 'weit' ? 1.4 : 1;
  const px = Math.max(6 * u, W * (port ? 0.08 : 0.065)) * pf, py = 7 * u * pf, cw = W - 2 * px;
  const CEN = pr.align === 'center' && ['titel', 'zahl', 'begriff', 'zitat', 'vollbild'].includes(sl.layout), AX = CEN ? W / 2 : px, AL = CEN ? 'center' : 'left';
  try { ctx.letterSpacing = '0px'; } catch(_){}
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  const im = (sl.layout === 'bild' || sl.layout === 'vollbild') ? await slImg(sl.img) : null;
  const kicker = (x, y, txt, color = C.acc) => {   // Akzentstrich und Rubrik in Versalien
    const cen = CEN && x === px, bx = cen ? W / 2 - 3 * u : x;
    if (pr.bar !== false) ctx.fillStyle = C.acc, ctx.fillRect(bx, y, 6 * u, 0.8 * u);
    if (!txt) return y + 3 * u;
    try { ctx.letterSpacing = (0.35 * u).toFixed(1) + 'px'; } catch(_){}
    ctx.font = slFontFn(pr.fonts.body, 700)(2.5 * u); ctx.fillStyle = color; ctx.textAlign = cen ? 'center' : 'left'; ctx.fillText(String(txt).toUpperCase(), cen ? W / 2 : x, y + 5 * u);
    try { ctx.letterSpacing = '0px'; } catch(_){}
    return y + 9 * u;
  };
  const source = (x, y, txt, color = C.mute) => { if (!txt) return; ctx.font = slFontFn(pr.fonts.body, 500)(2.1 * u); ctx.fillStyle = color;
    ctx.textAlign = pr.sourceRight ? 'right' : CEN ? 'center' : 'left'; ctx.fillText('Quelle: ' + txt, pr.sourceRight ? W - px : CEN ? W / 2 : x, y); };
  const bottom = H - py - (sl.source ? 4 * u : 0);
  const L = sl.layout;
  if (L === 'titel' || L === 'begriff' || L === 'zahl'){
    let y = kicker(px, py, L === 'begriff' && !sl.kicker ? 'Begriff' : sl.kicker);
    const maxW = port ? cw : Math.min(cw, W * 0.82), area = bottom - y - 2 * u;
    const tf = L === 'zahl' ? slFit(ctx, sl.title || '0', INTER(900), maxW, area * 0.62, 26 * u, 6 * u, 1.0)
      : L === 'begriff' ? slFit(ctx, sl.title || 'Begriff', LORA(700), maxW, area * 0.45, 11 * u, 4 * u, 1.1)
      : slFit(ctx, sl.title || 'Titel', INTER(800), maxW, area * (sl.text ? 0.62 : 0.95), 9.5 * u, 3.6 * u, 1.08);
    const xf = slFit(ctx, sl.text || '', INTER(L === 'zahl' ? 500 : 400), maxW, area - tf.lines.length * tf.size * 1.1 - 4 * u, L === 'zahl' ? 4.6 * u : 3.8 * u, 2.2 * u, 1.35);
    const blockH = tf.lines.length * tf.size * (L === 'zahl' ? 1.0 : 1.08) + (sl.text ? 3.5 * u + xf.lines.length * xf.size * 1.35 : 0);
    let ty = y + Math.max(0, (area - blockH) / 2);
    ctx.font = L === 'zahl' ? INTER(900)(tf.size) : L === 'begriff' ? LORA(700)(tf.size) : INTER(800)(tf.size);
    ty = slText(ctx, tf, AX, ty, L === 'zahl' ? 1.0 : 1.08, L === 'zahl' ? C.acc : C.fg, AL);
    if (L === 'begriff'){ ctx.fillStyle = C.acc; ctx.fillRect(CEN ? W / 2 - 5 * u : px, ty + 1.2 * u, 10 * u, 0.6 * u); ty += 1.5 * u; }
    if (sl.text){ ctx.font = INTER(L === 'zahl' ? 500 : 400)(xf.size); slText(ctx, xf, AX, ty + 2.5 * u, 1.35, L === 'zahl' ? C.fg : C.mute, AL); }
  } else if (L === 'liste'){
    let y = kicker(px, py, sl.kicker);
    const tf = slFit(ctx, sl.title || '', INTER(800), cw, (bottom - y) * 0.3, 7.5 * u, 3 * u, 1.08);
    if (sl.title){ ctx.font = INTER(800)(tf.size); y = slText(ctx, tf, px, y, 1.08, C.fg) + 5 * u; }
    const items = String(sl.text || '').split('\n').map(x => x.trim()).filter(Boolean);
    const area = bottom - y, maxW = port ? cw : Math.min(cw, W * 0.8);
    let sz = 5.6 * u, rows, h = 0;
    for (; sz > 2 * u; sz *= 0.93){ ctx.font = INTER(500)(sz); rows = items.map(t => slWrap(ctx, t, maxW - 6 * u)); h = rows.reduce((n, r) => n + r.length * sz * 1.3, 0) + sz * 0.7 * Math.max(0, items.length - 1); if (h <= area) break; }
    ctx.font = INTER(500)(sz); rows = items.map(t => slWrap(ctx, t, maxW - 6 * u));
    const gap = sz * 0.7; y += Math.max(0, (area - h) / 2.5);
    rows.forEach(r => { ctx.fillStyle = C.acc; ctx.fillRect(px, y + sz * 0.3, sz * 0.5, sz * 0.5); slText(ctx, {lines: r, size: sz}, px + 6 * u, y - sz * 0.1, 1.3, C.fg); y += r.length * sz * 1.3 + gap; });
  } else if (L === 'zitat'){
    ctx.font = LORA(700)(30 * u); ctx.fillStyle = C.acc; ctx.textAlign = AL; const qa = ctx.measureText('“').actualBoundingBoxAscent || 21 * u; ctx.fillText('“', CEN ? W / 2 : px - 1.5 * u, py + 1 * u + qa);
    const top = py + 16 * u, area = bottom - top - (sl.title ? 8 * u : 0);
    const qf = slFit(ctx, sl.text || 'Zitat', LORA(600, true), port ? cw : Math.min(cw, W * 0.8), area, 9.5 * u, 2.8 * u, 1.24);
    ctx.font = LORA(600, true)(qf.size); let y = slText(ctx, qf, AX, top + Math.max(0, (area - qf.lines.length * qf.size * 1.24) / 2.5), 1.24, C.fg, AL);
    if (sl.title){ ctx.font = slFontFn(pr.fonts.body, 700)(2.9 * u); ctx.fillStyle = C.fg;
      if (CEN){ ctx.textAlign = 'center'; ctx.fillText('— ' + sl.title, W / 2, y + 4.1 * u); }
      else { ctx.fillStyle = C.acc; ctx.fillRect(px, y + 3 * u, 4 * u, 0.6 * u); ctx.fillStyle = C.fg; ctx.textAlign = 'left'; ctx.fillText(sl.title, px + 6 * u, y + 4.1 * u); } }
  } else if (L === 'bild'){
    const ix = port ? 0 : W * 0.52, iy = 0, iw = port ? W : W - ix, ih = port ? H * 0.46 : H;
    if (im) slCover(ctx, im, ix, iy, iw, ih); else slImgPh(ctx, ix, iy, iw, ih, C, u);
    const tx = px, tw = port ? cw : ix - 2 * px; let y = port ? ih + 5 * u : py;
    y = kicker(tx, y, sl.kicker);
    const area = bottom - y;
    const tf = slFit(ctx, sl.title || '', INTER(800), tw, area * (sl.text ? 0.55 : 0.95), 7.5 * u, 3 * u, 1.08);
    const xf = slFit(ctx, sl.text || '', INTER(400), tw, area - tf.lines.length * tf.size * 1.08 - 4 * u, 3.6 * u, 2 * u, 1.35);
    const blockH = (sl.title ? tf.lines.length * tf.size * 1.08 : 0) + (sl.text ? 3 * u + xf.lines.length * xf.size * 1.35 : 0);
    let ty = y + Math.max(0, (area - blockH) / 2);
    if (sl.title){ ctx.font = INTER(800)(tf.size); ty = slText(ctx, tf, tx, ty, 1.08, C.fg); }
    if (sl.text){ ctx.font = INTER(400)(xf.size); slText(ctx, xf, tx, ty + 3 * u, 1.35, C.mute); }
  } else if (L === 'vollbild'){
    if (im) slCover(ctx, im, 0, 0, W, H); else slImgPh(ctx, 0, 0, W, H, C, u);
    const g = ctx.createLinearGradient(0, H * 0.45, 0, H); g.addColorStop(0, CD.bg + '00'); g.addColorStop(1, CD.bg + 'EB'); ctx.fillStyle = g; ctx.fillRect(0, H * 0.4, W, H * 0.6);
    const xf = slFit(ctx, sl.text || '', INTER(500), cw * 0.9, H * 0.12, 3 * u, 2 * u, 1.3);
    const tf = slFit(ctx, sl.title || '', INTER(800), port ? cw : cw * 0.75, H * 0.24, 6 * u, 3 * u, 1.08);
    let y = bottom - (sl.text ? xf.lines.length * xf.size * 1.3 + 2 * u : 0) - (sl.title ? tf.lines.length * tf.size * 1.08 : 0);
    if (sl.title){ if (pr.bar !== false){ ctx.fillStyle = CD.acc; ctx.fillRect(CEN ? W / 2 - 3 * u : px, y - 3 * u, 6 * u, 0.8 * u); } ctx.font = INTER(800)(tf.size); y = slText(ctx, tf, AX, y, 1.08, CD.fg, AL) + 2 * u; }
    if (sl.text){ ctx.font = INTER(500)(xf.size); slText(ctx, xf, AX, y, 1.3, CD.mute, AL); }
  } else if (L === 'zwei'){
    let y = kicker(px, py, '');
    const tf = slFit(ctx, sl.title || '', INTER(800), cw, (bottom - y) * 0.26, 6 * u, 3 * u, 1.08);
    if (sl.title){ ctx.font = INTER(800)(tf.size); y = slText(ctx, tf, px, y, 1.08, C.fg) + 4 * u; }
    const cols = [sl.text || '', sl.text2 || ''], gap = 5 * u;
    const colW = port ? cw : (cw - gap) / 2, colH = port ? (bottom - y - gap) / 2 : bottom - y;
    cols.forEach((t, i) => {
      const x0 = port ? px : px + i * (colW + gap), y0 = port ? y + i * (colH + gap) : y;
      ctx.fillStyle = C.soft; ctx.fillRect(x0, y0, colW, colH);
      ctx.fillStyle = i === 0 ? C.acc : C.fg; ctx.fillRect(x0, y0, colW, 0.7 * u);
      const [head, ...rest] = String(t).split('\n'), ip = 3 * u;
      const hf = slFit(ctx, head || '', INTER(800), colW - 2 * ip, colH * 0.3, 5.6 * u, 2.4 * u, 1.1);
      ctx.font = INTER(800)(hf.size); let yy = slText(ctx, hf, x0 + ip, y0 + ip + u, 1.1, i === 0 ? C.acc : C.fg) + 2 * u;
      const bf = slFit(ctx, rest.join('\n'), INTER(500), colW - 2 * ip, y0 + colH - yy - ip, 4.6 * u, 1.8 * u, 1.35);
      ctx.font = INTER(500)(bf.size); slText(ctx, bf, x0 + ip, yy, 1.35, C.fg);
    });
  }
  source(px, H - py + u, sl.source, L === 'vollbild' ? CD.mute : C.mute);
  return cv;
}

// ───────── Daten ─────────
const slIdx = sl => P.slides.indexOf(sl);
function newSlide(o = {}){ return {id: newId(), layout: 'titel', dark: null, kicker: '', title: '', text: '', text2: '', source: '', img: null, a: null, b: null, ...o}; }
const slWords = (a, b) => range(a, b).filter(i => tokens[i] && isTextTok(i) && tokText(tokens[i])).map(i => tokText(tokens[i])).join(' ').replace(/\s+([.,!?;:])/g, '$1').trim();
// Folienart aus dem markierten Text erraten
function slGuess(text){
  const w = text.split(/\s+/).filter(Boolean).length;
  if (/[„“"»«]/.test(text) && w > 4) return 'zitat';
  if (/\d/.test(text) && w <= 10) return 'zahl';
  return 'titel';
}
function slFromText(a, b){
  const text = slWords(a, b), w = text.split(/\s+/).filter(Boolean), layout = slGuess(text);
  if (layout === 'zahl'){ const m = text.match(/[\d.,]+\s*(%|Prozent|Mio\.?|Millionen|Milliarden|Mrd\.?|€|Euro)?/); return newSlide({layout, title: m ? m[0].trim().replace('Prozent', '%') : text, text, a, b}); }
  if (layout === 'zitat') return newSlide({layout, text: text.replace(/[„“"»«]/g, ''), a, b});
  return w.length <= 14 ? newSlide({title: text, a, b}) : newSlide({title: w.slice(0, 9).join(' ') + ' …', text, a, b});
}
// Wann eine verknüpfte Folie läuft (Zeit im Ergebnis)
function slTimes(sl){
  if (sl.a == null) return null;
  const ids = range(sl.a, Math.min(sl.b, tokens.length - 1)).filter(i => tokens[i] && tokens[i].type !== 'pause' && !isCut(i));
  if (!ids.length) return null;
  const s = srcToOut(snapSrc(wS(tokens[ids[0]]))), e = srcToOut(wE(tokens[ids[ids.length - 1]]));
  return s < total ? {s, e: Math.max(s + 0.5, e)} : null;
}
// Bild der Folie erzeugen und als Medium ablegen (nur neu, wenn sich etwas geändert hat)
async function slMedia(sl){
  const [W, H] = outSize(), k = slIdx(sl);
  const key = JSON.stringify([sl.layout, slIsDark(sl, k), sl.kicker, sl.title, sl.text, sl.text2, sl.source, sl.img, W, H, slProfile()]);
  if (sl.media && sl.mediaKey === key) return sl.media;
  if (!TS.saveImage) throw new Error('Folien als Bild speichern geht in dieser Version noch nicht');
  const cv = await renderSlide(sl, W, H, k);
  sl.rev = (sl.rev || 0) + 1;
  const m = J(TS.saveImage(`folie-${sl.id}-${sl.rev}.png`, cv.toDataURL('image/png'), W, H, P.id));
  if (!m || !m.uri) throw new Error('Folie konnte nicht gespeichert werden');
  m.name = `Folie ${k + 1}${sl.title ? ' – ' + sl.title.slice(0, 30) : ''}.png`;
  sl.media = m; sl.mediaKey = key;
  return m;
}
const slItems = sl => P.items.filter(x => x.slide === sl.id);
// Geänderte Folie: eingesetzte B-Roll-Elemente bekommen das neue Bild
async function slRefresh(sl){
  if (!slItems(sl).length) return;
  try { const m = await slMedia(sl); slItems(sl).forEach(it => { it.clip = clipOfSource(m); }); changed(true); seekOut(outPos, false); } catch(e){ toast(e.message); }
}
// Alle verknüpften Folien an ihrer Stelle einsetzen (vorher eingesetzte Folien werden ersetzt)
async function slPlaceAll(){
  const list = P.slides.map(sl => ({sl, t: slTimes(sl)})).filter(x => x.t).sort((p, q) => p.t.s - q.t.s);
  if (!list.length) return toast('Erst Folien mit dem Text verknüpfen (Text markieren → „Neue Folie“ oder „Nur verknüpfen“)');
  toast('Folien werden erzeugt …');
  const gapless = $('#slGapless').checked, medias = [];
  try { for (const x of list) medias.push(await slMedia(x.sl)); } catch(e){ return toast(e.message); }
  commit(() => {
    P.items = P.items.filter(it => !it.slide || !list.some(x => x.sl.id === it.slide));
    computeOverlays();
    const ranges = list.map((x, k) => { const n = list[k + 1], s = x.t.s; let e = gapless && n ? n.t.s : Math.min(total, x.t.e + 1.2); if (!gapless && n) e = Math.min(e, n.t.s); return [s, Math.max(s + 0.5, Math.min(e, total))]; });
    const track = freeTrack(ranges[0][0], ranges[ranges.length - 1][1]);
    list.forEach((x, k) => { const [s, e] = ranges[k];
      P.items.push({id: newId(), type: 'broll', slide: x.sl.id, at: r3(outToSrc(s)), clip: clipOfSource(medias[k]), in: 0, out: r3(e - s), track}); });
  }, true);
  seekOut(outPos, false); renderSlides();
  toast(`${list.length} Folien als B-Roll eingesetzt – Feinarbeit im Studio`);
}
// Studio: nächste Folie ab der Abspiellinie; die laufende endet hier
async function slNext(){
  if (!P.slides.length) return toast('Noch keine Folien – im Reiter „Folien“ anlegen');
  const t = outPos, open = slOpen && P.items.find(x => x.id === slOpen);
  let k;
  if (open){ k = P.slides.findIndex(s => s.id === open.slide) + 1; }
  else { const placed = P.slides.map((s, i) => slItems(s).length ? i : -1).filter(i => i >= 0); k = placed.length ? Math.max(...placed) + 1 : 0;
    if (k >= P.slides.length) k = P.slides.findIndex(s => !slItems(s).length); }
  if (k < 0 || k >= P.slides.length){ if (open) slClose(); return toast('Alle Folien sind eingesetzt'); }
  const sl = P.slides[k]; let m;
  try { m = await slMedia(sl); } catch(e){ return toast(e.message); }
  let it;
  commit(() => {
    let track = null;
    if (open){ const [a] = itemOutRange(open); if (t > a + 0.1){ open.out = r3(open.in + (t - a)); track = elTrack(open); } else { P.items = P.items.filter(x => x !== open); track = elTrack(open); } }
    computeOverlays();
    const len = Math.max(0.5, total - t);
    if (!track) track = freeTrack(t, t + len);
    it = {id: newId(), type: 'broll', slide: sl.id, at: r3(outToSrc(t)), clip: clipOfSource(m), in: 0, out: r3(len), track};
    P.items.push(it);
  }, true);
  slOpen = it.id; TL.sel = {kind: 'ovl', id: it.id}; renderTimeline(); seekOut(outPos, false);
  toast(`Folie ${k + 1} von ${P.slides.length} läuft – weiterspielen oder springen, dann N für die nächste (Umschalt+N beendet)`);
}
function slClose(){
  const open = slOpen && P.items.find(x => x.id === slOpen); slOpen = null;
  if (!open) return toast('Keine laufende Folie');
  const [a] = itemOutRange(open), t = outPos;
  if (t <= a + 0.1) return toast('Abspiellinie hinter den Anfang der Folie setzen');
  commit(() => { open.out = r3(open.in + (t - a)); }, true); seekOut(outPos, false); toast('Folie endet hier');
}

// ───────── Designprofile: Auswahl und Bearbeitung ─────────
const SL_SAMPLE = {id:'_muster', layout:'titel', dark:true, kicker:'Rubrik', title:'So sieht eine Folie aus', text:'Ein kurzer Satz zur Erklärung.', source:'Beispielquelle', text2:'', img:null};
function slFillProfSel(){
  const sel = $('#slProf'); if (!sel || !P) return; const cur = slProfile();
  sel.innerHTML = slAllProfiles().map(x => `<option value="${esc(x.id)}">${esc(x.name)}${x.builtin ? '' : ' (eigenes)'}</option>`).join('');
  sel.value = cur.id;
}
// Profil fürs Projekt übernehmen: alle Vorschauen und schon eingesetzten Folien werden neu gezeichnet
function slUseProfile(pr){
  P.slideProfile = slClone(pr); changed(true);
  slFillProfSel(); renderSlides(); slSyncAll();
}
// Eingesetzte Folien neu erzeugen, wenn Format oder Profil nicht mehr zum Bild passen (z. B. in einem Clip mit 9:16)
let slSyncing = null;
function slSyncAll(){
  if (!P || !P.slides || !P.slides.length) return Promise.resolve();
  const pid = P.id;
  return slSyncing = (async () => {
    for (const sl of P.slides.slice()){ if (!P || P.id !== pid) return; if (slItems(sl).length) await slRefresh(sl); }
  })();
}
window.slSyncAll = slSyncAll;
async function slProfPreview(pr, cv, sl){
  const [W, H] = outSize(), w = cv.width = 480, h = cv.height = Math.round(w * H / W);
  const r = await renderSlide(sl || {...SL_SAMPLE, dark: null}, w * 2, h * 2, 0, pr); cv.getContext('2d').drawImage(r, 0, 0, w, h);
}
// Beim ersten Öffnen des Reiters: Profil wählen
function slChooseProfile(){
  const list = slAllProfiles();
  const m = hcModal(`<h3>Welches Design sollen die Folien haben?</h3><p class="muted small">Das lässt sich jederzeit oben im Reiter „Folien“ ändern. Eigene Profile legst du dort mit „＋ Neues Profil“ an.</p>
    <div class="sl-choose">${list.map(x => `<button data-p="${esc(x.id)}"><canvas></canvas><b>${esc(x.name)}</b></button>`).join('')}</div>`);
  m.querySelectorAll('[data-p]').forEach(b => { const pr = list.find(x => x.id === b.dataset.p); slProfPreview(pr, b.querySelector('canvas')).catch(() => {});
    b.onclick = () => { closeHcModal(); slUseProfile(pr); toast(`Designprofil „${pr.name}“`); }; });
}
function slEditProfile(base, isNew){
  const pr = slClone(base);
  if (isNew){ pr.id = 'p' + newId(); pr.name = base.name + ' – eigene Variante'; pr.builtin = false; }
  const opts = slFontOptions(), fsel = r => `<select data-font="${r}">${opts.map(o => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join('')}</select>`;
  const col = (t, k, l) => `<label class="sl-col"><input type="color" data-col="${t}.${k}"><span>${l}</span></label>`;
  const seg = (k, vals) => `<div class="seg-ctl small" data-seg="${k}">${vals.map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('')}</div>`;
  const m = hcModal(`<h3>${isNew ? 'Neues Designprofil' : 'Designprofil bearbeiten'}</h3>
    <div class="sl-pe">
      <canvas id="slPeCv"></canvas>
      <div class="seg-ctl small" id="slPeSample"><button data-v="d" class="on">dunkle Folie</button><button data-v="l">helle Folie</button><button data-v="cur">aktuelle Folie</button></div>
      <label class="field"><span>Name</span><input type="text" id="slPeName"></label>
      <div class="field"><span>Farben dunkler Folien</span><div class="row wrap">${col('dark', 'bg', 'Hintergrund')}${col('dark', 'fg', 'Schrift')}${col('dark', 'mute', 'Nebentext')}${col('dark', 'acc', 'Akzent')}</div></div>
      <div class="field"><span>Farben heller Folien</span><div class="row wrap">${col('light', 'bg', 'Hintergrund')}${col('light', 'fg', 'Schrift')}${col('light', 'mute', 'Nebentext')}${col('light', 'acc', 'Akzent')}</div></div>
      <label class="field"><span>Schrift der Überschriften</span>${fsel('head')}</label>
      <label class="field"><span>Schrift des Fließtexts</span>${fsel('body')}</label>
      <label class="field"><span>Schrift für Zitate und Begriffe</span>${fsel('serif')}</label>
      <div class="field"><span>Größe der Überschriften <b id="slPeTsV"></b></span><input type="range" id="slPeTs" min="70" max="140" step="5"></div>
      <div class="field"><span>Größe des Fließtexts <b id="slPeXsV"></b></span><input type="range" id="slPeXs" min="70" max="140" step="5"></div>
      <div class="field"><span>Ausrichtung</span>${seg('align', [['left', 'linksbündig'], ['center', 'mittig']])}</div>
      <div class="field"><span>Rand</span>${seg('pad', [['eng', 'schmal'], ['normal', 'normal'], ['weit', 'breit']])}</div>
      <div class="field"><span>Hintergrund der Folien</span>${seg('theme', [['wechselnd', 'abwechselnd'], ['dunkel', 'dunkel'], ['hell', 'hell']])}</div>
      <label class="row small"><input type="checkbox" id="slPeBar"> Akzentstrich über der Rubrik</label>
      <label class="row small"><input type="checkbox" id="slPeSrc"> Quelle rechts unten</label>
    </div>
    <div class="row wrap" style="margin-top:12px;justify-content:flex-end">${!isNew && !base.builtin ? '<button class="btn small ghost" id="slPeDel">Profil löschen</button>' : ''}<span style="flex:1"></span>
      <button class="btn small" id="slPeCancel">Abbrechen</button><button class="btn small primary" id="slPeSave">${base.builtin && !isNew ? 'Als eigenes Profil speichern' : 'Speichern und verwenden'}</button></div>`);
  m.querySelector('.hc-card').classList.add('wide');
  const q = s => m.querySelector(s);
  let sample = 'd', drawT = 0;
  const draw = () => { clearTimeout(drawT); drawT = setTimeout(() => {
    const sl = sample === 'cur' && slCur ? slCur : {...SL_SAMPLE, dark: sample === 'd'};
    slProfPreview(pr, q('#slPeCv'), sl).catch(() => {}); }, 60); };
  q('#slPeName').value = pr.name;
  m.querySelectorAll('[data-col]').forEach(i => { const [t, k] = i.dataset.col.split('.'); i.value = pr.colors[t][k]; i.oninput = () => { pr.colors[t][k] = i.value; draw(); }; });
  m.querySelectorAll('[data-font]').forEach(s => { const r = s.dataset.font; if (![...s.options].some(o => o.value === pr.fonts[r])) s.append(new Option(pr.fonts[r], pr.fonts[r])); s.value = pr.fonts[r]; s.onchange = () => { pr.fonts[r] = s.value; draw(); }; });
  const segs = () => m.querySelectorAll('[data-seg]').forEach(g => g.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === pr[g.dataset.seg])));
  m.querySelectorAll('[data-seg]').forEach(g => g.onclick = e => { const b = e.target.closest('button'); if (!b) return; pr[g.dataset.seg] = b.dataset.v; segs(); draw(); });
  segs();
  const rng = (id, k) => { const i = q(id), v = q(id + 'V'); i.value = Math.round((pr[k] || 1) * 100); v.textContent = i.value + ' %'; i.oninput = () => { pr[k] = i.value / 100; v.textContent = i.value + ' %'; draw(); }; };
  rng('#slPeTs', 'titleScale'); rng('#slPeXs', 'textScale');
  q('#slPeBar').checked = pr.bar !== false; q('#slPeBar').onchange = e => { pr.bar = e.target.checked; draw(); };
  q('#slPeSrc').checked = !!pr.sourceRight; q('#slPeSrc').onchange = e => { pr.sourceRight = e.target.checked; draw(); };
  q('#slPeSample').onclick = e => { const b = e.target.closest('button'); if (!b) return; sample = b.dataset.v; q('#slPeSample').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); draw(); };
  q('#slPeCancel').onclick = closeHcModal;
  if (q('#slPeDel')) q('#slPeDel').onclick = () => { if (!confirm(`Profil „${base.name}“ löschen? Projekte, die es verwenden, behalten ihre Kopie.`)) return;
    slSaveUserProfiles(slUserProfiles().filter(x => x.id !== base.id)); closeHcModal();
    if (slProfile().id === base.id){ P.slideProfile = slClone(P.slideProfile); P.slideProfile.id = 'p' + newId(); } slFillProfSel(); };
  q('#slPeSave').onclick = () => {
    pr.name = q('#slPeName').value.trim() || 'Eigenes Profil';
    if (pr.builtin){ pr.id = 'p' + newId(); pr.builtin = false; if (pr.name === base.name) pr.name += ' – eigene Variante'; }
    const own = slUserProfiles(), i = own.findIndex(x => x.id === pr.id);
    if (i >= 0) own[i] = pr; else own.push(pr); slSaveUserProfiles(own);
    closeHcModal(); slUseProfile(pr); toast(`Designprofil „${pr.name}“ gespeichert`);
  };
  draw();
}
$('#slProf').onchange = e => { const pr = slAllProfiles().find(x => x.id === e.target.value); if (pr) { slUseProfile(pr); toast(`Designprofil „${pr.name}“`); } };
$('#slProfEdit').onclick = () => slEditProfile(slProfile(), false);
$('#slProfNew').onclick = () => slEditProfile(slProfile(), true);

// ───────── Reiter „Folien“ ─────────
const slThumbs = new Map();
async function slThumb(sl, img){
  const [W, H] = outSize(), tw = 320, th = Math.round(tw * H / W), k = slIdx(sl);
  const key = JSON.stringify([sl.layout, slIsDark(sl, k), sl.kicker, sl.title, sl.text, sl.text2, sl.source, sl.img, tw, th, slProfile()]);
  let c = slThumbs.get(sl.id);
  if (!c || c.key !== key){ const cv = await renderSlide(sl, tw * 2, th * 2, k); c = {key, url: cv.toDataURL('image/jpeg', 0.8)}; slThumbs.set(sl.id, c); }
  if (img) img.src = c.url;
}
function renderSlides(){
  if (!P) return;
  slFillProfSel();
  if (!P.slideProfile && !$('#hcModal') && $('#proj').dataset.tab === 'slides') setTimeout(() => { if (P && !P.slideProfile && !$('#hcModal')) slChooseProfile(); }, 50);
  const list = $('#slList'); list.innerHTML = '';
  if (!slCur || !P.slides.includes(slCur)) slCur = P.slides[0] || null;
  P.slides.forEach((sl, k) => {
    const d = document.createElement('div'); d.className = 'sl-item' + (sl === slCur ? ' on' : ''); d.dataset.id = sl.id;
    const t = slTimes(sl), placed = slItems(sl).length;
    d.innerHTML = `<img alt=""><div class="sl-meta"><b>${k + 1}</b><span>${esc(slLayout(sl.layout).n)}</span><span class="muted">${t ? fmtS(t.s) : 'nicht verknüpft'}${placed ? ' · eingesetzt' : ''}</span></div>
      <div class="sl-acts"><button data-a="up" title="nach vorn">↑</button><button data-a="down" title="nach hinten">↓</button><button data-a="dup" title="duplizieren">⧉</button><button data-a="del" title="löschen">✕</button></div>`;
    slThumb(sl, d.querySelector('img')); list.append(d);
  });
  if (!P.slides.length) list.innerHTML = '<p class="muted small" style="padding:12px">Noch keine Folien. Unten im Transkript Wörter markieren und „→ Neue Folie“ wählen – oder „✨ Grundlage aus dem Text“.</p>';
  renderSlEdit(); renderSlTrans();
}
function renderSlEdit(){
  const box = $('#slEdit'), sl = slCur;
  if (!sl){ box.innerHTML = '<p class="muted small">Keine Folie ausgewählt.</p>'; return; }
  const L = slLayout(sl.layout), lbl = f => (L.lbl && L.lbl[f]) || SL_LBL[f], t = slTimes(sl);
  box.innerHTML = `<div class="sl-prev"><canvas id="slCanvas"></canvas></div>
    <div class="sl-layouts">${SL_LAYOUTS.map(x => `<button data-l="${x.k}" class="${x.k === sl.layout ? 'on' : ''}"><i class="sl-ico sl-ico-${x.k}"></i>${x.n}</button>`).join('')}</div>
    <div class="row wrap"><span class="muted small">Hintergrund</span><div class="seg-ctl small" id="slTheme"><button data-v="auto">abwechselnd</button><button data-v="dark">dunkel</button><button data-v="light">hell</button></div></div>
    <div class="sl-fields">${L.f.map(f => f === 'img'
      ? `<div class="field"><span>${lbl(f)}</span><div class="row wrap"><button class="btn small" id="slImgPick">${sl.img ? 'Anderes Bild …' : 'Bild wählen …'}</button>${sl.img ? '<button class="btn small ghost" id="slImgDel">entfernen</button>' : ''}</div></div>`
      : `<label class="field"><span>${lbl(f)}</span>${f === 'text' || f === 'text2' ? `<textarea data-f="${f}" rows="${sl.layout === 'liste' || f === 'text2' || sl.layout === 'zwei' ? 4 : 3}"></textarea>` : `<input type="text" data-f="${f}">`}</label>`).join('')}</div>
    <div class="sl-link muted small">${t ? `⛓ verknüpft mit „${esc(slWords(sl.a, sl.b).slice(0, 120))}“ · ${fmtS(t.s)} – ${fmtS(t.e)} <button class="btn small ghost" id="slUnlink">lösen</button> <button class="btn small ghost" id="slJump">▶ anhören</button>` : 'nicht mit dem Text verknüpft – im Studio mit N einsetzen oder unten markieren und „⛓ Nur verknüpfen“'}</div>`;
  box.querySelectorAll('[data-f]').forEach(inp => { inp.value = sl[inp.dataset.f] || ''; });
  const th = sl.dark == null ? 'auto' : sl.dark ? 'dark' : 'light'; box.querySelectorAll('#slTheme button').forEach(b => b.classList.toggle('on', b.dataset.v === th));
  slDrawPrev();
}
let slPrevT = 0, slMediaT = 0;
async function slDrawPrev(){
  const sl = slCur, cv = $('#slCanvas'); if (!sl || !cv) return;
  const [W, H] = outSize(), w = 960, h = Math.round(w * H / W), r = await renderSlide(sl, w, h, slIdx(sl));
  cv.width = w; cv.height = h; cv.getContext('2d').drawImage(r, 0, 0);
  const st = $('#slStage'); st.width = w; st.height = h; st.getContext('2d').drawImage(r, 0, 0);   // große Vorschau auf der Bühne
}
function slChanged(sl, full){
  clearTimeout(slPrevT); slPrevT = setTimeout(() => { slDrawPrev(); const it = document.querySelector(`.sl-item[data-id="${sl.id}"] img`); slThumb(sl, it); }, 150);
  clearTimeout(slMediaT); slMediaT = setTimeout(() => slRefresh(sl), 900);
  changed(false); if (full) renderSlides();
}
// Transkript im Folien-Reiter: markieren und übernehmen; verknüpfte Stellen tragen die Foliennummer
function renderSlTrans(){
  const box = $('#slTrans'); if (!box || !P) return;
  if (!tokens.length){ box.innerHTML = '<p class="muted small">Noch kein Transkript.</p>'; return; }
  const mark = new Map(); P.slides.forEach((sl, k) => { if (sl.a == null) return; for (let i = sl.a; i <= sl.b; i++) mark.set(i, k); });
  const frag = document.createDocumentFragment(); let para = -1, p = null;
  for (const t of tokens){
    if (t.type === 'pause') continue;
    if (t.p !== para || !p){ para = t.p; p = document.createElement('p'); frag.append(p); }
    const k = mark.get(t.i);
    if (k != null && (t.i === P.slides[k].a || !mark.has(t.i - 1) || mark.get(t.i - 1) !== k)){ const b = document.createElement('span'); b.className = 'sl-badge' + (P.slides[k] === slCur ? ' on' : ''); b.textContent = k + 1; b.dataset.slide = P.slides[k].id; p.append(b); }
    const sp = document.createElement('span'); sp.className = 'sl-w' + (isCut(t.i) ? ' cut' : '') + (k != null ? ' linked' + (P.slides[k] === slCur ? ' cur' : '') : ''); sp.dataset.i = t.i;
    sp.textContent = t.type === 'unk' ? (P.edits[t.i] || '🗣') : tokText(t); p.append(sp, ' ');
  }
  box.innerHTML = ''; box.append(frag); slPaintSel();
}
function slPaintSel(){
  const [a, b] = slSel ? [Math.min(slSel.a, slSel.b), Math.max(slSel.a, slSel.b)] : [-1, -2];
  $$('#slTrans .sl-w').forEach(sp => { const i = +sp.dataset.i; sp.classList.toggle('sel', i >= a && i <= b); });
  $('#slSelInfo').textContent = slSel ? `„${slWords(a, b).slice(0, 80)}${slWords(a, b).length > 80 ? ' …' : ''}“` : 'Wort anklicken, Umschalt+Klick oder Ziehen markiert einen Bereich';
}
(() => {
  const box = $('#slTrans'); let drag = false;
  box.addEventListener('pointerdown', e => {
    const b = e.target.closest('.sl-badge'); if (b){ slCur = P.slides.find(s => s.id === b.dataset.slide) || slCur; renderSlides(); return; }
    const sp = e.target.closest('.sl-w'); if (!sp) return; const i = +sp.dataset.i;
    if (e.shiftKey && slSel) slSel.b = i; else slSel = {a: i, b: i};
    drag = true; slPaintSel(); e.preventDefault();
  });
  box.addEventListener('pointerover', e => { if (!drag) return; const sp = e.target.closest('.sl-w'); if (!sp) return; slSel.b = +sp.dataset.i; slPaintSel(); });
  window.addEventListener('pointerup', () => { drag = false; });
  box.addEventListener('dblclick', e => { const sp = e.target.closest('.sl-w'); if (!sp) return; const t = tokens[+sp.dataset.i]; if (playing) pausePlay(); seekOut(srcToOut(snapSrc(wS(t))), false); });
})();
$('#paneSlides').addEventListener('click', async e => {
  const to = e.target.closest('[data-to]');
  if (to){
    if (!slSel) return toast('Erst im Transkript Wörter markieren');
    const a = Math.min(slSel.a, slSel.b), b = Math.max(slSel.a, slSel.b), txt = slWords(a, b);
    if (to.dataset.to === 'new'){ const sl = slFromText(a, b); const at = slCur ? slIdx(slCur) + 1 : P.slides.length;
      commit(() => P.slides.splice(at, 0, sl), false); slCur = sl; slSel = null; renderSlides(); toast(`Folie ${slIdx(sl) + 1} erstellt`); return; }
    if (!slCur) return toast('Erst eine Folie auswählen oder anlegen');
    commit(() => {
      if (to.dataset.to === 'title') slCur.title = txt;
      else if (to.dataset.to === 'text') slCur.text = slCur.text ? slCur.text + (slCur.layout === 'liste' ? '\n' : ' ') + txt : txt;
      else if (to.dataset.to === 'bullet'){ if (!['liste', 'zwei'].includes(slCur.layout)) slCur.layout = 'liste'; slCur.text = (slCur.text ? slCur.text + '\n' : '') + txt; }
      if (to.dataset.to === 'link' || slCur.a == null){ slCur.a = a; slCur.b = b; }
      else { slCur.a = Math.min(slCur.a, a); slCur.b = Math.max(slCur.b, b); }
    }, false);
    slSel = null; slChanged(slCur, true); return;
  }
  const it = e.target.closest('.sl-item');
  if (it){ const sl = P.slides.find(s => s.id === it.dataset.id); const act = e.target.closest('[data-a]');
    if (!act){ slCur = sl; renderSlides(); return; }
    const k = slIdx(sl), a = act.dataset.a;
    commit(() => {
      if (a === 'up' && k > 0) P.slides.splice(k - 1, 0, P.slides.splice(k, 1)[0]);
      if (a === 'down' && k < P.slides.length - 1) P.slides.splice(k + 1, 0, P.slides.splice(k, 1)[0]);
      if (a === 'dup'){ const c = {...JSON.parse(JSON.stringify(sl)), id: newId(), a: null, b: null}; delete c.media; delete c.mediaKey; P.slides.splice(k + 1, 0, c); slCur = c; }
      if (a === 'del'){ P.slides.splice(k, 1); P.items = P.items.filter(x => x.slide !== sl.id); if (slCur === sl) slCur = P.slides[Math.min(k, P.slides.length - 1)] || null; }
    }, a === 'del'); renderSlides(); return; }
  const l = e.target.closest('[data-l]'); if (l && slCur){ commit(() => slCur.layout = l.dataset.l, false); slChanged(slCur, true); return; }
  const th = e.target.closest('#slTheme button'); if (th && slCur){ commit(() => slCur.dark = th.dataset.v === 'auto' ? null : th.dataset.v === 'dark', false); slChanged(slCur, true); return; }
  if (e.target.id === 'slImgPick' && slCur){ const m = await pickMedia('clip'); if (!m) return; if (m.kind !== 'image') return toast('Bitte ein Foto oder eine Grafik wählen'); commit(() => slCur.img = m.uri, false); slChanged(slCur, true); return; }
  if (e.target.id === 'slImgDel' && slCur){ commit(() => slCur.img = null, false); slChanged(slCur, true); return; }
  if (e.target.id === 'slUnlink' && slCur){ commit(() => { slCur.a = slCur.b = null; }, false); renderSlides(); return; }
  if (e.target.id === 'slJump' && slCur){ const t = slTimes(slCur); if (t){ seekOut(Math.max(0, t.s - 0.3), false); startPlay(); stopAt = t.e + 0.3; } return; }
});
$('#slEdit').addEventListener('focusin', e => { if (e.target.dataset.f) e.target._b = snapshot(); });
$('#slEdit').addEventListener('input', e => { const f = e.target.dataset.f; if (!f || !slCur) return; slCur[f] = e.target.value; slChanged(slCur); });
$('#slEdit').addEventListener('focusout', e => { if (e.target._b && e.target._b !== snapshot()){ undo.push(e.target._b); redo = []; } e.target._b = null; const it = document.querySelector(`.sl-item[data-id="${slCur && slCur.id}"]`); if (it) slThumb(slCur, it.querySelector('img')); });
$('#slAdd').onclick = () => { const sl = newSlide(); const at = slCur ? slIdx(slCur) + 1 : P.slides.length; commit(() => P.slides.splice(at, 0, sl), false); slCur = sl; renderSlides(); };
// Grundlage: je Satz (kurze Sätze zusammen, höchstens zwei) eine Folie, verknüpft mit genau dieser Stelle
$('#slSuggest').onclick = () => {
  if (!tokens.length) return toast('Erst transkribieren');
  if (P.slides.length && !confirm(`Es gibt schon ${P.slides.length} Folien. Weitere Folien als Grundlage anlegen?`)) return;
  const sents = []; let cur = null;
  for (const t of tokens){
    if (t.type === 'pause' || !isTextTok(t.i) || isCut(t.i)){ if (t.type === 'pause' && cur && t.e - t.s > 1.2){ sents.push(cur); cur = null; } continue; }
    if (!cur) cur = {a: t.i, b: t.i, n: 0, p: t.p}; cur.b = t.i; cur.n++;
    if (/[.?!…]$/.test(tokText(t) || '') || t.p !== cur.p){ sents.push(cur); cur = null; }
  }
  if (cur) sents.push(cur);
  const groups = [];
  for (const x of sents){ const g = groups[groups.length - 1]; if (g && (g.n < 6 || x.n < 5) && g.k < 2 && g.n + x.n <= 26){ g.b = x.b; g.n += x.n; g.k++; } else groups.push({...x, k: 1}); }
  const made = groups.map(g => slFromText(g.a, g.b));
  commit(() => P.slides.push(...made), false); slCur = made[0] || slCur; renderSlides();
  toast(`${made.length} Folien als Grundlage – Text kürzen, Art wählen, Bilder ergänzen`);
};
$('#slPlace').onclick = () => slPlaceAll();
// Aus der Textauswahl im Text-Reiter
$('#selSlide').onclick = () => {
  const ids = selIds().filter(i => tokens[i].type !== 'pause'); if (!ids.length) return;
  const a = Math.min(...ids), b = Math.max(...ids), sl = slFromText(a, b);
  commit(() => P.slides.push(sl), false); slCur = sl; clearSel();
  toast(`Folie ${P.slides.length} erstellt – im Reiter „Folien“ gestalten`);
};
$('#barSlide').onclick = e => { if (e.shiftKey) slClose(); else slNext(); };
// Tastatur: N = nächste Folie, Umschalt+N = laufende Folie beenden (im Studio)
document.addEventListener('keydown', e => {
  if (!P || !studioOn() || e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = document.activeElement?.tagName; if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') return;
  if (e.key === 'n' || e.key === 'N'){ e.preventDefault(); if (e.shiftKey) slClose(); else slNext(); }
});
if (typeof KEYS !== 'undefined') KEYS.push(['N / Umschalt + N', 'nächste Folie ab der Abspiellinie als B-Roll / laufende Folie beenden']);
