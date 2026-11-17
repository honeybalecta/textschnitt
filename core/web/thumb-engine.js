'use strict';
/* HoneyThumb – Rechenkern: Datenmodell, Zeichnen auf eine Leinwand, Vorlagen.
   Ein Titelbild besteht aus Ebenen (von hinten nach vorn): Hintergrund, Bilder (auch freigestellte Personen), Texte, Formen, Piktogramme.
   Alle Maße stehen in Entwurfspixeln des Formats (16:9 = 1600 × 900); gezeichnet wird in jeder Größe.
   Dieselbe Datei läuft in HoneyThumb und – als Kopie – im Bereich „Titelbild“ von HoneyCut. */
(function(){
  const G = typeof window !== 'undefined' ? window : globalThis;
  const IC = () => G.HoneyThumbIcons || null;
  const VERSION = '1.0.0';
  const PAL = {ink: '#131312', ink2: '#232321', cream: '#EDE7DA', sand: '#CFC6B0', gray: '#A9A397', grayL: '#5E584D', white: '#FFFFFF', green: '#3E8A55'};
  const ACCENTS = [
    {k: 'rot',     n: 'Rot',     dark: '#E5402A', light: '#B8301D'},
    {k: 'gruen',   n: 'Grün',    dark: '#5DB37A', light: '#3E8A55'},
    {k: 'petrol',  n: 'Petrol',  dark: '#3FAAA2', light: '#1E736E'},
    {k: 'blau',    n: 'Blau',    dark: '#6F9BEA', light: '#2E5CA6'},
    {k: 'violett', n: 'Violett', dark: '#AE8DE6', light: '#6A48A6'},
    {k: 'magenta', n: 'Magenta', dark: '#E86BA7', light: '#A3346C'},
    {k: 'orange',  n: 'Orange',  dark: '#F08A3E', light: '#B0531A'},
    {k: 'ocker',   n: 'Ocker',   dark: '#DDAA3E', light: '#8E640F'},
  ];
  const accent = k => ACCENTS.find(a => a.k === k) || ACCENTS[0];
  const FORMATS = [
    {k: '16:9', n: 'Quer 16:9', hint: 'YouTube', w: 1600, h: 900, out: [[1280, 720], [1920, 1080]]},
    {k: '9:16', n: 'Hoch 9:16', hint: 'Reels, TikTok, Shorts', w: 900, h: 1600, out: [[1080, 1920]]},
    {k: '1:1', n: 'Quadrat 1:1', hint: 'Beitrag', w: 1200, h: 1200, out: [[1080, 1080]]},
    {k: '4:5', n: 'Hoch 4:5', hint: 'Instagram-Beitrag', w: 1080, h: 1350, out: [[1080, 1350]]},
  ];
  const format = k => FORMATS.find(f => f.k === k) || FORMATS[0];
  const FONTS = [
    {k: 'anton', n: 'Anton', f: 'TSF-anton'}, {k: 'bebas', n: 'Bebas Neue', f: 'TSF-bebas'}, {k: 'archivo', n: 'Archivo Black', f: 'TSF-archivo'},
    {k: 'oswald', n: 'Oswald', f: 'TSF-oswald'}, {k: 'robotocondensed', n: 'Roboto Condensed', f: 'TSF-robotocondensed'},
    {k: 'inter', n: 'Inter', f: 'TSF-inter'}, {k: 'montserrat', n: 'Montserrat', f: 'TSF-montserrat'}, {k: 'poppins', n: 'Poppins', f: 'TSF-poppins'},
    {k: 'lora', n: 'Lora', f: 'TSF-lora'}, {k: 'playfair', n: 'Playfair Display', f: 'TSF-playfair'},
  ];
  const fam = k => (FONTS.find(f => f.k === k) || FONTS[0]).f;
  const uid = () => Math.random().toString(36).slice(2, 10);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const clone = o => JSON.parse(JSON.stringify(o));
  const hex = c => { const m = /^#?([0-9a-f]{6})$/i.exec(c || ''); const n = m ? parseInt(m[1], 16) : 0; return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const mix = (a, b, t) => { const p = hex(a), q = hex(b); return '#' + p.map((v, i) => Math.round(v + (q[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
  const rgba = (c, o) => { const p = hex(c); return `rgba(${p[0]},${p[1]},${p[2]},${o})`; };
  const lum = c => { const p = hex(c); return (0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2]) / 255; };

  // ───────── Bilder: als data-URL im Dokument (doc.assets), dekodiert im Zwischenspeicher ─────────
  const cache = new Map();   // data-URL → Bild
  const mkCanvas = (w, h) => { const c = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(1, 1); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
  function decode(url){
    if (cache.has(url)) return Promise.resolve(cache.get(url));
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => { cache.set(url, im); res(im); }; im.onerror = () => rej(new Error('Das Bild lässt sich nicht lesen.')); im.src = url; });
  }
  async function load(doc){ await Promise.all(Object.values(doc.assets || {}).map(u => decode(u).catch(() => null))); await fonts(); return doc; }
  const imgOf = (doc, id) => (id && doc.assets && cache.get(doc.assets[id])) || null;
  function addAsset(doc, url){ doc.assets = doc.assets || {}; for (const [k, v] of Object.entries(doc.assets)) if (v === url) return k; const id = 'a' + uid(); doc.assets[id] = url; return id; }
  // Bilder, die keine Ebene mehr nutzt, aus dem Dokument nehmen
  function prune(doc){ const used = new Set(); for (const L of doc.layers){ if (L.img) used.add(L.img); if (L.mask) used.add(L.mask); if (L.src) used.add(L.src); if (L.fill && L.fill.img) used.add(L.fill.img); }
    const k = doc.keep || {}; if (k.photo) used.add(k.photo); if (k.person) for (const v of [k.person.img, k.person.mask, k.person.src]) if (v) used.add(v); for (const k of Object.keys(doc.assets || {})) if (!used.has(k)) delete doc.assets[k]; return doc; }
  let fontP = null;
  function fonts(){ if (fontP) return fontP; if (typeof document === 'undefined' || !document.fonts) return (fontP = Promise.resolve()); return (fontP = Promise.all(FONTS.map(f => document.fonts.load(`20px "${f.f}"`).catch(() => null))).then(() => null)); }

  // Freigestelltes Bild: Original und Maske (Deckkraft der Maske = sichtbar) zusammensetzen; je Paar einmal
  const cuts = new WeakMap();
  function cutout(src, mask){
    if (!mask) return src;
    let m = cuts.get(src); if (!m) cuts.set(src, m = new WeakMap());
    let c = m.get(mask); if (c) return c;
    c = mkCanvas(src.naturalWidth || src.width, src.naturalHeight || src.height); const x = c.getContext('2d');
    x.drawImage(src, 0, 0, c.width, c.height); x.globalCompositeOperation = 'destination-in'; x.drawImage(mask, 0, 0, c.width, c.height);
    m.set(mask, c); return c;
  }

  // ───────── Formen ─────────
  function rr(ctx, x, y, w, h, r){ r = Math.max(0, Math.min(r || 0, w / 2, h / 2)); ctx.beginPath(); if (!r){ ctx.rect(x, y, w, h); return; }
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  const SHAPES = [
    {k: 'rect', n: 'Rechteck'}, {k: 'ellipse', n: 'Kreis'}, {k: 'tri', n: 'Dreieck'}, {k: 'star', n: 'Stern'}, {k: 'burst', n: 'Zacken'},
    {k: 'arrow', n: 'Pfeil'}, {k: 'bubble', n: 'Sprechblase'}, {k: 'ring', n: 'Ring'}, {k: 'line', n: 'Linie'},
  ];
  function shapePath(ctx, L, w, h){
    const x = -w / 2, y = -h / 2;
    switch (L.shape){
      case 'ellipse': ctx.beginPath(); ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); break;
      case 'ring': { const t = clamp(L.thick == null ? 0.18 : L.thick, 0.02, 0.9); ctx.beginPath(); ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.ellipse(0, 0, w / 2 * (1 - t), h / 2 * (1 - t), 0, 0, Math.PI * 2, true); break; }
      case 'tri': ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h); ctx.closePath(); break;
      case 'star': case 'burst': { const n = L.shape === 'star' ? 5 : (L.n || 16), inner = L.shape === 'star' ? 0.45 : 0.78; ctx.beginPath();
        for (let i = 0; i < n * 2; i++){ const r = i % 2 ? inner : 1, a = -Math.PI / 2 + i * Math.PI / n; ctx[i ? 'lineTo' : 'moveTo'](Math.cos(a) * w / 2 * r, Math.sin(a) * h / 2 * r); } ctx.closePath(); break; }
      case 'arrow': { const hh = Math.min(w * 0.45, h), t = h * 0.36; ctx.beginPath(); ctx.moveTo(x, -t / 2); ctx.lineTo(x + w - hh, -t / 2); ctx.lineTo(x + w - hh, y); ctx.lineTo(x + w, 0); ctx.lineTo(x + w - hh, y + h); ctx.lineTo(x + w - hh, t / 2); ctx.lineTo(x, t / 2); ctx.closePath(); break; }
      case 'bubble': { const bh = h * 0.78, r = Math.min(bh * 0.3, w * 0.2); rr(ctx, x, y, w, bh, r); ctx.moveTo(x + w * 0.2, y + bh - 1); ctx.lineTo(x + w * 0.16, y + h); ctx.lineTo(x + w * 0.42, y + bh - 1); ctx.closePath(); break; }
      case 'line': rr(ctx, x, y, w, h, h / 2); break;
      default: rr(ctx, x, y, w, h, L.round || 0);
    }
  }

  // ───────── Text: Umbruch, Hervorhebung mit *Sternchen*, Schrift verkleinern statt abschneiden ─────────
  // Ein Wort besteht aus Teilen mit oder ohne Hervorhebung (*GESAGT*? → „GESAGT“ hervorgehoben, „?“ normal, ohne Lücke)
  function runs(line){ const out = []; let a = false; for (const word of String(line).split(/\s+/)){ if (!word) continue; const p = []; word.split('*').forEach((s, i) => { if (i) a = !a; if (s) p.push({s, a}); }); if (p.length) out.push({p}); } return out; }
  function textLayout(ctx, L, s){
    const raw = L.upper ? String(L.text || '').toUpperCase() : String(L.text || ''), paras = raw.split('\n').map(runs), f = fam(L.font);
    const pad = L.box ? (L.box.pad == null ? 0.2 : L.box.pad) : 0, lh = L.lh || 1.05;
    let size = Math.max(6, L.size || 80), lines, widest, maxW, total;
    for (let guard = 0; guard < 80; guard++){
      ctx.font = `${size * s}px "${f}"`; const sp = ctx.measureText(' ').width; maxW = Math.max(10, L.w * s - 2 * pad * size * s); lines = []; widest = 0;
      for (const p of paras){ let cur = [], cw = 0;
        for (const t of p){ const parts = t.p.map(q => ({...q, pw: ctx.measureText(q.s).width})), tw = parts.reduce((n, q) => n + q.pw, 0); if (cur.length && cw + sp + tw > maxW){ lines.push({t: cur, w: cw}); cur = []; cw = 0; } cw += (cur.length ? sp : 0) + tw; cur.push({p: parts, tw}); }
        lines.push({t: cur, w: cw}); }
      widest = Math.max(0, ...lines.map(l => l.w)); total = lines.length * size * s * lh;
      if (L.fit === false || size <= 10 || (total <= L.h * s + 0.5 && widest <= maxW + 0.5)) break;
      size = Math.max(10, size * 0.95);
    }
    return {size, lines, widest, total, lhPx: size * s * lh, padPx: pad * size * s, sp: ctx.measureText(' ').width, shrunk: size < (L.size || 80) - 0.01};
  }
  function drawText(ctx, L, s, acc){
    const w = L.w * s, h = L.h * s, T = textLayout(ctx, L, s), f = fam(L.font), m = ctx.measureText('Hg');
    const asc = m.fontBoundingBoxAscent || T.size * s * 0.8, desc = m.fontBoundingBoxDescent || T.size * s * 0.2;
    const top = -h / 2 + (L.valign === 't' ? 0 : L.valign === 'b' ? h - T.total : (h - T.total) / 2);
    const lx = l => L.align === 'c' ? -l.w / 2 : L.align === 'r' ? w / 2 - T.padPx - l.w : -w / 2 + T.padPx;
    ctx.font = `${T.size * s}px "${f}"`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.lineJoin = 'round';
    if (L.box && L.box.c){ ctx.fillStyle = L.box.c; const gap = T.size * s * 0.06, r = (L.box.round || 0) * s;
      if (L.box.mode === 'block'){ const x0 = Math.min(...T.lines.map(lx)) - T.padPx; rr(ctx, x0, top - T.padPx * 0.5, T.widest + 2 * T.padPx, T.total + T.padPx, r); ctx.fill(); }
      else T.lines.forEach((l, i) => { if (!l.t.length) return; rr(ctx, lx(l) - T.padPx, top + i * T.lhPx + gap, l.w + 2 * T.padPx, T.lhPx - 2 * gap, r); ctx.fill(); }); }
    const pass = fn => T.lines.forEach((l, i) => { let x = lx(l); const y = top + i * T.lhPx + (T.lhPx - (asc + desc)) / 2 + asc; for (const t of l.t){ let px = x; for (const q of t.p){ fn(q, px, y); px += q.pw; } x += t.tw + T.sp; } });
    if (L.shadow && L.shadow.b >= 0 && L.shadow.c){ ctx.save(); ctx.shadowColor = L.shadow.c; ctx.shadowBlur = (L.shadow.b || 0) * s; ctx.shadowOffsetX = (L.shadow.x || 0) * s; ctx.shadowOffsetY = (L.shadow.y || 0) * s;
      ctx.fillStyle = L.color || PAL.cream; pass((t, x, y) => ctx.fillText(t.s, x, y)); ctx.restore(); }
    if (L.stroke && L.stroke.w > 0){ ctx.strokeStyle = L.stroke.c || PAL.ink; ctx.lineWidth = L.stroke.w * 2 * s; pass((t, x, y) => ctx.strokeText(t.s, x, y)); }
    pass((t, x, y) => { ctx.fillStyle = t.a ? (L.accent || acc) : (L.color || PAL.cream); ctx.fillText(t.s, x, y); });
    return T;
  }

  // ───────── Bild in einen Kasten setzen (füllen oder ganz zeigen), dazu Umriss und Schatten ─────────
  function fitRect(iw, ih, w, h, L){
    const cover = L.fit !== 'contain', z = Math.max(1, L.zoom || 1), k = (cover ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih)) * z, dw = iw * k, dh = ih * k;
    const px = L.pos && L.pos.x != null ? L.pos.x : 0.5, py = L.pos && L.pos.y != null ? L.pos.y : 0.5;
    return {x: -w / 2 + (w - dw) * px, y: -h / 2 + (h - dh) * py, w: dw, h: dh};
  }
  function drawImage(ctx, doc, L, s, o){
    const w = L.w * s, h = L.h * s, im = imgOf(doc, L.img);
    if (!im){ if (o.edit) placeholder(ctx, L, w, h, s); return; }
    const src = cutout(im, imgOf(doc, L.mask)), iw = src.naturalWidth || src.width, ih = src.naturalHeight || src.height;
    const ow = L.outline && L.outline.w > 0 ? L.outline.w * s : 0, padX = Math.ceil(ow) + 2, sprite = mkCanvas(w + 2 * padX, h + 2 * padX), x = sprite.getContext('2d');
    x.translate(sprite.width / 2, sprite.height / 2);
    const body = mkCanvas(w, h), b = body.getContext('2d'); b.translate(w / 2, h / 2);
    if (L.round){ rr(b, -w / 2, -h / 2, w, h, L.round * s); b.clip(); }
    if (L.flip) b.scale(-1, 1);
    if (L.gray) try { b.filter = 'grayscale(1) contrast(1.08)'; } catch(_){}
    const r = fitRect(iw, ih, w, h, L); b.drawImage(src, r.x, r.y, r.w, r.h);
    if (ow){ const n = Math.max(16, Math.round(ow * 1.6)); for (let i = 0; i < n; i++){ const a = i / n * Math.PI * 2; x.drawImage(body, -w / 2 + Math.cos(a) * ow, -h / 2 + Math.sin(a) * ow); }
      x.globalCompositeOperation = 'source-in'; x.fillStyle = L.outline.c || PAL.cream; x.fillRect(-sprite.width / 2, -sprite.height / 2, sprite.width, sprite.height); x.globalCompositeOperation = 'source-over'; }
    x.drawImage(body, -w / 2, -h / 2);
    if (L.frame && L.frame.w > 0){ x.strokeStyle = L.frame.c || PAL.cream; x.lineWidth = L.frame.w * s; rr(x, -w / 2 + L.frame.w * s / 2, -h / 2 + L.frame.w * s / 2, w - L.frame.w * s, h - L.frame.w * s, Math.max(0, (L.round || 0) - L.frame.w / 2) * s); x.stroke(); }
    ctx.save();
    if (L.shadow && L.shadow.c){ ctx.shadowColor = L.shadow.c; ctx.shadowBlur = (L.shadow.b || 0) * s; ctx.shadowOffsetX = (L.shadow.x || 0) * s; ctx.shadowOffsetY = (L.shadow.y || 0) * s; }
    ctx.drawImage(sprite, -sprite.width / 2, -sprite.height / 2); ctx.restore();
  }
  function placeholder(ctx, L, w, h, s){
    ctx.save(); ctx.setLineDash([14 * s, 10 * s]); ctx.lineWidth = 3 * s; ctx.strokeStyle = rgba(PAL.gray, 0.9); ctx.fillStyle = rgba(PAL.gray, 0.14); rr(ctx, -w / 2, -h / 2, w, h, 18 * s); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    const u = Math.min(w, h) * 0.2; ctx.fillStyle = rgba(PAL.gray, 0.75);
    if (L.slot === 'person'){ ctx.beginPath(); ctx.arc(0, -u * 0.9, u * 0.62, 0, Math.PI * 2); ctx.fill(); ctx.beginPath(); ctx.ellipse(0, u * 1.1, u * 1.25, u * 1.15, 0, Math.PI, 0); ctx.fill(); }
    else { rr(ctx, -u * 1.2, -u * 0.9, u * 2.4, u * 1.8, u * 0.2); ctx.fill(); }
    ctx.font = `${Math.max(12, Math.min(34 * s, w * 0.09))}px "TSF-inter"`; ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = rgba(PAL.gray, 1);
    ctx.fillText(L.slot === 'person' ? 'Person einsetzen' : 'Bild einsetzen', 0, u * 1.5); ctx.restore();
  }

  // ───────── Hintergrund ─────────
  const BG_KINDS = [{k: 'color', n: 'Farbe'}, {k: 'grad', n: 'Verlauf'}, {k: 'img', n: 'Bild'}, {k: 'rays', n: 'Strahlen'}, {k: 'dots', n: 'Punkte'}, {k: 'diag', n: 'Schräg geteilt'}, {k: 'grid', n: 'Raster'}];
  function drawBg(ctx, doc, L, W, H, s, o){
    const f = L.fill || {kind: 'color', c: PAL.ink}, a = f.a || f.c || PAL.ink, b = f.b || PAL.ink2;
    ctx.fillStyle = a; ctx.fillRect(0, 0, W, H);
    if (f.kind === 'grad'){ const ang = (f.ang == null ? 90 : f.ang) * Math.PI / 180, dx = Math.cos(ang), dy = Math.sin(ang), r = Math.abs(dx) * W / 2 + Math.abs(dy) * H / 2;
      const g = ctx.createLinearGradient(W / 2 - dx * r, H / 2 - dy * r, W / 2 + dx * r, H / 2 + dy * r); g.addColorStop(0, a); g.addColorStop(1, b); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
    else if (f.kind === 'img'){ const im = imgOf(doc, f.img);
      if (im){ const bl = (f.blur || 0) * s, m = bl * 2.5, r = fitRect(im.naturalWidth || im.width, im.naturalHeight || im.height, W + 2 * m, H + 2 * m, {fit: 'cover', pos: f.pos, zoom: f.zoom});
        ctx.save(); let flt = ''; if (bl > 0.2) flt += `blur(${bl}px) `; if (f.gray) flt += 'grayscale(1) '; if (flt) try { ctx.filter = flt.trim(); } catch(_){}
        ctx.drawImage(im, W / 2 + r.x, H / 2 + r.y, r.w, r.h); ctx.restore();
        if (f.dim > 0){ ctx.fillStyle = rgba(f.dimc || PAL.ink, clamp(f.dim, 0, 1)); ctx.fillRect(0, 0, W, H); } }
      else if (o.edit){ ctx.save(); ctx.translate(W / 2, H / 2); placeholder(ctx, {slot: 'photo'}, W * 0.5, H * 0.5, s); ctx.restore(); } }
    else if (f.kind === 'rays'){ const cx = (f.cx == null ? 0.5 : f.cx) * W, cy = (f.cy == null ? 0.5 : f.cy) * H, n = f.n || 14, R = Math.hypot(W, H); ctx.fillStyle = b;
      for (let i = 0; i < n; i++){ const a0 = (i * 2) * Math.PI / n + (f.rot || 0), a1 = a0 + Math.PI / n; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R); ctx.lineTo(cx + Math.cos(a1) * R, cy + Math.sin(a1) * R); ctx.closePath(); ctx.fill(); } }
    else if (f.kind === 'dots'){ const st = (f.step || 46) * s; ctx.fillStyle = b; for (let y = 0, j = 0; y < H + st; y += st * 0.87, j++) for (let x = (j % 2) * st / 2; x < W + st; x += st){ const k = 0.12 + 0.3 * (y / H); ctx.beginPath(); ctx.arc(x, y, st * k, 0, Math.PI * 2); ctx.fill(); } }
    else if (f.kind === 'diag'){ const sp = (f.split == null ? 0.5 : f.split) * W, sl = (f.slant == null ? 0.16 : f.slant) * W; ctx.fillStyle = b; ctx.beginPath(); ctx.moveTo(sp + sl, 0); ctx.lineTo(W, 0); ctx.lineTo(W, H); ctx.lineTo(sp - sl, H); ctx.closePath(); ctx.fill(); }
    else if (f.kind === 'grid'){ const st = (f.step || 80) * s; ctx.strokeStyle = b; ctx.lineWidth = Math.max(1, 2 * s); ctx.beginPath(); for (let x = st; x < W; x += st){ ctx.moveTo(x, 0); ctx.lineTo(x, H); } for (let y = st; y < H; y += st){ ctx.moveTo(0, y); ctx.lineTo(W, y); } ctx.stroke(); }
    if (f.vig > 0){ const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62); g.addColorStop(0, rgba(PAL.ink, 0)); g.addColorStop(1, rgba(PAL.ink, clamp(f.vig, 0, 1))); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
  }

  // ───────── Ein Titelbild zeichnen ─────────
  // o.edit: Platzhalter für leere Bildfelder zeigen; o.only: nur diese Ebene (für Vorschauen); o.canvas: vorhandene Leinwand nutzen
  function render(doc, W, o = {}){
    const F = format(doc.format), s = W / F.w, H = Math.round(F.h * s), c = o.canvas || mkCanvas(W, H); c.width = W; c.height = H;
    const ctx = c.getContext('2d'), acc = doc.accent || ACCENTS[0].dark, info = {shrunk: []};
    for (const L of doc.layers){
      if (L.hide || (o.only && o.only !== L.id)) continue;
      ctx.save(); ctx.globalAlpha = L.op == null ? 1 : clamp(L.op, 0, 1);
      if (L.type === 'bg'){ drawBg(ctx, doc, L, W, H, s, o); ctx.restore(); continue; }
      ctx.translate((L.x + L.w / 2) * s, (L.y + L.h / 2) * s); if (L.rot) ctx.rotate(L.rot * Math.PI / 180);
      if (L.type === 'img') drawImage(ctx, doc, L, s, o);
      else if (L.type === 'text'){ const T = drawText(ctx, L, s, acc); if (T.shrunk && T.size < 0.6 * (L.size || 80)) info.shrunk.push(L.id); }
      else if (L.type === 'shape'){ shapePath(ctx, L, L.w * s, L.h * s);
        if (L.shadow && L.shadow.c){ ctx.shadowColor = L.shadow.c; ctx.shadowBlur = (L.shadow.b || 0) * s; ctx.shadowOffsetX = (L.shadow.x || 0) * s; ctx.shadowOffsetY = (L.shadow.y || 0) * s; }
        if (L.fill !== 'none'){ ctx.fillStyle = L.fill || acc; ctx.fill(L.shape === 'ring' ? 'evenodd' : 'nonzero'); }
        if (L.stroke && L.stroke.w > 0){ ctx.shadowColor = 'transparent'; ctx.strokeStyle = L.stroke.c || PAL.ink; ctx.lineWidth = L.stroke.w * s; ctx.lineJoin = 'round'; ctx.stroke(); } }
      else if (L.type === 'icon' && IC()){ const d = Math.min(L.w, L.h) * s; IC().draw(ctx, L.icon, -d / 2, -d / 2, d, L.color || PAL.cream, L.accent || acc); }
      ctx.restore();
    }
    c._info = info; return c;
  }
  // Oberste Ebene an einer Stelle (Entwurfspixel); gedrehte Kästen werden mitgedreht
  function inside(L, x, y, pad = 0){ const cx = L.x + L.w / 2, cy = L.y + L.h / 2, a = -(L.rot || 0) * Math.PI / 180, dx = x - cx, dy = y - cy, lx = dx * Math.cos(a) - dy * Math.sin(a), ly = dx * Math.sin(a) + dy * Math.cos(a); return Math.abs(lx) <= L.w / 2 + pad && Math.abs(ly) <= L.h / 2 + pad; }
  function hit(doc, x, y){ for (let i = doc.layers.length - 1; i >= 0; i--){ const L = doc.layers[i]; if (L.type === 'bg' || L.hide || L.lock) continue; if (inside(L, x, y, 6)) return L; } return null; }

  // ───────── Vorlagen ─────────
  // Jede Vorlage baut ihre Ebenen für ein Format. Felder (slot): person, photo, title, kicker, sub – ihr Inhalt bleibt beim Wechsel der Vorlage erhalten.
  const TXT = {title: 'DEIN TITEL', kicker: 'RUBRIK', sub: 'Unterzeile'};
  function TEMPLATES_BUILD(){
    const t = (slot, x, y, w, h, o) => ({type: 'text', slot, text: TXT[slot] || '', x, y, w, h, font: 'anton', size: 150, color: PAL.cream, align: 'l', valign: 'm', lh: 1.04, upper: true, fit: true, ...o});
    const im = (slot, x, y, w, h, o) => ({type: 'img', slot, x, y, w, h, fit: slot === 'person' ? 'contain' : 'cover', pos: {x: 0.5, y: slot === 'person' ? 1 : 0.5}, ...o});
    const sh = (shape, x, y, w, h, o) => ({type: 'shape', shape, x, y, w, h, ...o});
    const bg = fill => ({type: 'bg', fill});
    const shadow = {b: 40, x: 0, y: 14, c: 'rgba(0,0,0,0.45)'};
    return [
      {id: 'rechts', n: 'Person rechts', dark: true, needs: ['person'], build: (F, C) => F.wide ? [
        bg({kind: 'grad', a: PAL.ink, b: PAL.ink2, ang: 0, vig: 0.35}),
        im('person', F.w * 0.50, F.h * 0.05, F.w * 0.52, F.h * 1.02, {outline: {w: 9, c: PAL.cream}, shadow}),
        t('kicker', F.w * 0.06, F.h * 0.14, F.w * 0.42, F.h * 0.085, {font: 'inter', size: 46, color: C.acc, valign: 'b'}),
        t('title', F.w * 0.06, F.h * 0.25, F.w * 0.46, F.h * 0.5, {size: 170, valign: 't'}),
        sh('line', F.w * 0.06, F.h * 0.82, F.w * 0.13, F.h * 0.02, {fill: C.acc}),
      ] : [
        bg({kind: 'grad', a: PAL.ink, b: PAL.ink2, ang: 90, vig: 0.35}),
        im('person', -F.w * 0.04, F.h * 0.42, F.w * 1.08, F.h * 0.63, {outline: {w: 9, c: PAL.cream}, shadow}),
        t('kicker', F.w * 0.07, F.h * 0.06, F.w * 0.86, F.h * 0.05, {font: 'inter', size: 46, color: C.acc, valign: 'b'}),
        t('title', F.w * 0.07, F.h * 0.125, F.w * 0.86, F.h * 0.28, {size: 160, valign: 't'}),
      ]},
      {id: 'links', n: 'Person links, hell', dark: false, needs: ['person'], build: (F, C) => F.wide ? [
        bg({kind: 'color', c: PAL.cream}),
        sh('rect', 0, 0, F.w * 0.4, F.h, {fill: PAL.sand}),
        im('person', -F.w * 0.03, F.h * 0.05, F.w * 0.52, F.h * 1.02, {outline: {w: 9, c: PAL.ink}}),
        t('kicker', F.w * 0.5, F.h * 0.14, F.w * 0.44, F.h * 0.085, {font: 'inter', size: 46, color: C.accL, valign: 'b'}),
        t('title', F.w * 0.5, F.h * 0.25, F.w * 0.45, F.h * 0.5, {size: 170, color: PAL.ink, valign: 't', accent: C.accL}),
        sh('line', F.w * 0.5, F.h * 0.82, F.w * 0.13, F.h * 0.02, {fill: C.accL}),
      ] : [
        bg({kind: 'color', c: PAL.cream}),
        sh('rect', 0, F.h * 0.62, F.w, F.h * 0.38, {fill: PAL.sand}),
        im('person', -F.w * 0.04, F.h * 0.42, F.w * 1.08, F.h * 0.63, {outline: {w: 9, c: PAL.ink}}),
        t('kicker', F.w * 0.07, F.h * 0.06, F.w * 0.86, F.h * 0.05, {font: 'inter', size: 46, color: C.accL, valign: 'b'}),
        t('title', F.w * 0.07, F.h * 0.125, F.w * 0.86, F.h * 0.28, {size: 160, color: PAL.ink, valign: 't', accent: C.accL}),
      ]},
      {id: 'balken', n: 'Bild mit Balken', dark: true, needs: ['photo'], build: (F, C) => [
        bg({kind: 'img', slot: 'photo', dim: 0.28, vig: 0.4}),
        t('kicker', F.w * 0.05, F.h * (F.wide ? 0.5 : 0.56), F.w * 0.7, F.h * (F.wide ? 0.085 : 0.05), {font: 'inter', size: 42, color: PAL.cream, box: {c: PAL.ink, pad: 0.35}, valign: 'b', lh: 1.5}),
        t('title', F.w * 0.05, F.h * (F.wide ? 0.6 : 0.62), F.w * (F.wide ? 0.78 : 0.9), F.h * (F.wide ? 0.33 : 0.3), {size: 130, color: PAL.white, accent: PAL.ink, box: {c: C.accL, pad: 0.16}, valign: 't', lh: 1.22}),
      ]},
      {id: 'kreis', n: 'Kreis', dark: true, needs: ['person'], build: (F, C) => { const d = F.wide ? F.h * 0.9 : F.w * 0.92; return F.wide ? [
        bg({kind: 'color', c: PAL.ink}),
        sh('ellipse', F.w * 0.75 - d / 2, F.h * 0.56 - d / 2, d, d, {fill: C.acc}),
        im('person', F.w * 0.5, F.h * 0.05, F.w * 0.5, F.h * 1.02, {shadow}),
        t('kicker', F.w * 0.06, F.h * 0.14, F.w * 0.42, F.h * 0.085, {font: 'inter', size: 46, color: PAL.sand, valign: 'b'}),
        t('title', F.w * 0.06, F.h * 0.25, F.w * 0.45, F.h * 0.55, {size: 170, valign: 't'}),
      ] : [
        bg({kind: 'color', c: PAL.ink}),
        sh('ellipse', F.w / 2 - d / 2, F.h * 0.72 - d / 2, d, d, {fill: C.acc}),
        im('person', -F.w * 0.02, F.h * 0.42, F.w * 1.04, F.h * 0.63, {shadow}),
        t('kicker', F.w * 0.07, F.h * 0.06, F.w * 0.86, F.h * 0.05, {font: 'inter', size: 46, color: PAL.sand, valign: 'b'}),
        t('title', F.w * 0.07, F.h * 0.125, F.w * 0.86, F.h * 0.28, {size: 160, valign: 't'}),
      ]; }},
      {id: 'strahlen', n: 'Strahlen', dark: true, needs: ['person'], build: (F, C) => F.wide ? [
        bg({kind: 'rays', a: C.accL, b: mix(C.accL, PAL.ink, 0.28), cx: 0.74, cy: 0.62, n: 14, vig: 0.3}),
        im('person', F.w * 0.48, F.h * 0.05, F.w * 0.54, F.h * 1.02, {outline: {w: 10, c: PAL.white}, shadow}),
        t('title', F.w * 0.05, F.h * 0.16, F.w * 0.47, F.h * 0.6, {size: 180, color: PAL.white, stroke: {w: 7, c: PAL.ink}, accent: PAL.sand}),
        t('kicker', F.w * 0.05, F.h * 0.79, F.w * 0.47, F.h * 0.09, {font: 'inter', size: 44, color: PAL.cream, box: {c: PAL.ink, pad: 0.4}, lh: 1.5, valign: 't'}),
      ] : [
        bg({kind: 'rays', a: C.accL, b: mix(C.accL, PAL.ink, 0.28), cx: 0.5, cy: 0.72, n: 14, vig: 0.3}),
        im('person', -F.w * 0.04, F.h * 0.42, F.w * 1.08, F.h * 0.63, {outline: {w: 10, c: PAL.white}, shadow}),
        t('title', F.w * 0.07, F.h * 0.1, F.w * 0.86, F.h * 0.3, {size: 170, color: PAL.white, stroke: {w: 7, c: PAL.ink}, accent: PAL.sand, align: 'c'}),
        t('kicker', F.w * 0.07, F.h * 0.045, F.w * 0.86, F.h * 0.05, {font: 'inter', size: 44, color: PAL.cream, box: {c: PAL.ink, pad: 0.4}, lh: 1.5, align: 'c'}),
      ]},
      {id: 'zitat', n: 'Zitat', dark: false, needs: ['person'], build: (F, C) => F.wide ? [
        bg({kind: 'color', c: PAL.cream}),
        im('person', -F.w * 0.02, F.h * 0.08, F.w * 0.46, F.h * 0.99, {gray: true}),
        t('', F.w * 0.46, -F.h * 0.1, F.w * 0.2, F.h * 0.42, {text: '„', font: 'playfair', size: 330, color: C.accL, upper: false, fit: false, valign: 'b'}),
        t('title', F.w * 0.47, F.h * 0.34, F.w * 0.47, F.h * 0.4, {text: 'Hier steht das Zitat.', font: 'lora', size: 96, color: PAL.ink, upper: false, valign: 't', lh: 1.16, accent: C.accL}),
        t('sub', F.w * 0.47, F.h * 0.76, F.w * 0.47, F.h * 0.08, {text: 'Name, Funktion', font: 'inter', size: 40, color: PAL.grayL, upper: false, valign: 't'}),
      ] : [
        bg({kind: 'color', c: PAL.cream}),
        im('person', F.w * 0.02, F.h * 0.5, F.w * 0.96, F.h * 0.55, {gray: true}),
        t('', F.w * 0.07, -F.h * 0.06, F.w * 0.4, F.h * 0.235, {text: '„', font: 'playfair', size: 300, color: C.accL, upper: false, fit: false, valign: 'b'}),
        t('title', F.w * 0.08, F.h * 0.185, F.w * 0.84, F.h * 0.24, {text: 'Hier steht das Zitat.', font: 'lora', size: 92, color: PAL.ink, upper: false, valign: 't', lh: 1.16, accent: C.accL}),
        t('sub', F.w * 0.08, F.h * 0.43, F.w * 0.84, F.h * 0.05, {text: 'Name, Funktion', font: 'inter', size: 40, color: PAL.grayL, upper: false, valign: 't'}),
      ]},
      {id: 'schlagzeile', n: 'Schlagzeile', dark: true, needs: [], build: (F, C) => [
        bg({kind: 'dots', a: PAL.ink, b: PAL.ink2, vig: 0.3}),
        t('kicker', F.w * 0.07, F.h * 0.1, F.w * 0.86, F.h * 0.08, {font: 'inter', size: 48, color: C.acc, valign: 'b'}),
        t('title', F.w * 0.07, F.h * 0.2, F.w * 0.86, F.h * 0.56, {size: 230, valign: 't'}),
        sh('line', F.w * 0.07, F.h * 0.84, F.w * 0.18, F.h * (F.wide ? 0.024 : 0.012), {fill: C.acc}),
      ]},
      {id: 'frage', n: 'Frage', dark: true, needs: ['person'], build: (F, C) => F.wide ? [
        bg({kind: 'color', c: C.accL}),
        t('', F.w * 0.48, -F.h * 0.12, F.w * 0.5, F.h * 1.25, {text: '?', font: 'archivo', size: 1050, color: mix(C.accL, PAL.ink, 0.3), fit: false, align: 'c'}),
        im('person', F.w * 0.5, F.h * 0.05, F.w * 0.52, F.h * 1.02, {outline: {w: 9, c: PAL.cream}, shadow}),
        t('title', F.w * 0.05, F.h * 0.14, F.w * 0.47, F.h * 0.62, {size: 170, color: PAL.cream, accent: PAL.ink}),
        t('kicker', F.w * 0.05, F.h * 0.79, F.w * 0.47, F.h * 0.09, {font: 'inter', size: 44, color: PAL.cream, box: {c: PAL.ink, pad: 0.4}, lh: 1.5, valign: 't'}),
      ] : [
        bg({kind: 'color', c: C.accL}),
        t('', F.w * 0.1, F.h * 0.3, F.w * 0.8, F.h * 0.7, {text: '?', font: 'archivo', size: 1100, color: mix(C.accL, PAL.ink, 0.3), fit: false, align: 'c'}),
        im('person', -F.w * 0.04, F.h * 0.42, F.w * 1.08, F.h * 0.63, {outline: {w: 9, c: PAL.cream}, shadow}),
        t('kicker', F.w * 0.07, F.h * 0.045, F.w * 0.86, F.h * 0.05, {font: 'inter', size: 44, color: PAL.cream, box: {c: PAL.ink, pad: 0.4}, lh: 1.5}),
        t('title', F.w * 0.07, F.h * 0.11, F.w * 0.86, F.h * 0.3, {size: 165, color: PAL.cream, accent: PAL.ink, valign: 't'}),
      ]},
      {id: 'beleg', n: 'Ausschnitt', dark: true, needs: ['photo'], build: (F, C) => F.wide ? [
        bg({kind: 'grid', a: PAL.ink, b: PAL.ink2, vig: 0.4}),
        im('photo', F.w * 0.5, F.h * 0.14, F.w * 0.44, F.h * 0.72, {rot: 3, round: 18, frame: {w: 10, c: PAL.cream}, shadow}),
        t('kicker', F.w * 0.06, F.h * 0.14, F.w * 0.4, F.h * 0.085, {font: 'inter', size: 46, color: C.acc, valign: 'b'}),
        t('title', F.w * 0.06, F.h * 0.25, F.w * 0.4, F.h * 0.5, {size: 160, valign: 't'}),
        sh('arrow', F.w * 0.36, F.h * 0.74, F.w * 0.12, F.h * 0.11, {fill: C.acc, rot: -12}),
      ] : [
        bg({kind: 'grid', a: PAL.ink, b: PAL.ink2, vig: 0.4}),
        im('photo', F.w * 0.08, F.h * 0.46, F.w * 0.84, F.h * 0.44, {rot: -2, round: 18, frame: {w: 10, c: PAL.cream}, shadow}),
        t('kicker', F.w * 0.07, F.h * 0.06, F.w * 0.86, F.h * 0.05, {font: 'inter', size: 46, color: C.acc, valign: 'b'}),
        t('title', F.w * 0.07, F.h * 0.125, F.w * 0.86, F.h * 0.28, {size: 160, valign: 't'}),
      ]},
      {id: 'geteilt', n: 'Geteilt', dark: true, needs: ['person'], build: (F, C) => F.wide ? [
        bg({kind: 'diag', a: PAL.ink, b: C.accL, split: 0.5, slant: 0.1}),
        im('person', F.w * 0.25, F.h * 0.05, F.w * 0.5, F.h * 1.02, {outline: {w: 9, c: PAL.cream}, shadow}),
        t('title', F.w * 0.04, F.h * 0.1, F.w * 0.3, F.h * 0.5, {size: 150, valign: 't'}),
        t('sub', F.w * 0.68, F.h * 0.42, F.w * 0.28, F.h * 0.46, {text: 'ODER?', size: 150, color: PAL.cream, align: 'r', valign: 'b', accent: PAL.ink}),
      ] : [
        bg({kind: 'diag', a: PAL.ink, b: C.accL, split: 0.5, slant: 0.3}),
        im('person', -F.w * 0.04, F.h * 0.4, F.w * 1.08, F.h * 0.65, {outline: {w: 9, c: PAL.cream}, shadow}),
        t('title', F.w * 0.07, F.h * 0.06, F.w * 0.86, F.h * 0.2, {size: 150, valign: 't'}),
        t('sub', F.w * 0.07, F.h * 0.27, F.w * 0.86, F.h * 0.12, {text: 'ODER?', size: 150, color: PAL.cream, align: 'r', valign: 't', accent: PAL.ink}),
      ]},
    ];
  }
  const TEMPLATES = TEMPLATES_BUILD();
  const template = id => TEMPLATES.find(t => t.id === id) || null;
  // Inhalt der Felder: {title, kicker, sub, person: {img, mask, src}, photo: Bild-ID}; die Bilder liegen in assets (ID → data-URL).
  // Fehlt das Foto, dient das Bild der Person (unbeschnitten: src) als Foto – und umgekehrt. Solche geliehenen Bilder tragen auto: true
  // und zählen beim nächsten Wechsel der Vorlage nicht als eigene Wahl.
  function derive(c){ const o = {...c}, auto = {}; if (!o.photo && o.person && o.person.img){ o.photo = o.person.src || o.person.img; auto.photo = true; } if (!(o.person && o.person.img) && o.photo){ o.person = {img: o.photo, mask: null}; auto.person = true; } return [o, auto]; }
  function fromTemplate(id, fmt, content0 = {}, base = {}){
    const [content, auto] = derive(content0);
    const T = template(id) || TEMPLATES[0], F0 = format(fmt), F = {...F0, wide: F0.w / F0.h > 1.3}, a = accent(base.accentKey || 'rot'), C = {acc: a.dark, accL: a.light};
    const doc = {app: 'honeythumb', v: 1, id: base.id || uid(), name: base.name || 'Titelbild', format: F0.k, tpl: T.id, accentKey: a.k, accent: T.dark ? a.dark : a.light, assets: {...(base.assets || {})}, keep: {}, layers: [], updated: Date.now()};
    if (content.person && content.person.img && !auto.person) doc.keep.person = content.person; if (content.photo && !auto.photo) doc.keep.photo = content.photo;
    for (const k of ['title', 'kicker', 'sub']) if (content[k] != null) doc.keep[k] = content[k];   // Texte merken, auch wenn die Vorlage das Feld nicht hat
    for (const L of T.build(F, C)){
      L.id = uid();
      if (L.type === 'bg' && L.fill.slot){ L.slot = L.fill.slot; delete L.fill.slot; if (content[L.slot]){ L.fill.img = content[L.slot]; if (auto[L.slot]) L.auto = true; } }
      else if (L.type === 'img'){ const c = content[L.slot]; if (L.slot === 'person' && c && c.img){ L.img = c.img; if (c.mask) L.mask = c.mask; if (c.src) L.src = c.src; } else if (c && L.slot !== 'person') L.img = c; if (L.img && auto[L.slot]) L.auto = true; }
      else if (L.type === 'text' && L.slot && content[L.slot] != null) L.text = content[L.slot];
      if (!L.slot) delete L.slot;
      doc.layers.push(L);
    }
    for (const L of base.extra || []) doc.layers.push(L);
    return doc;
  }
  // Was in den Feldern steht – zum Wechsel der Vorlage oder des Formats
  function contentOf(doc){
    const c = {...(doc.keep || {})};
    for (const L of doc.layers){ if (!L.slot) continue;
      if (L.type === 'text') c[L.slot] = L.text; else if (L.auto) continue; else if (L.type === 'bg'){ if (L.fill && L.fill.img) c[L.slot] = L.fill.img; }
      else if (L.type === 'img' && L.img) c[L.slot] = L.slot === 'person' ? {img: L.img, mask: L.mask || null, src: L.src || null} : L.img; }
    return c;
  }
  function scaled(L, k, dx, dy){ const o = clone(L); o.x = L.x * k + dx; o.y = L.y * k + dy; o.w = L.w * k; o.h = L.h * k; if (o.size) o.size *= k; for (const p of ['outline', 'stroke', 'frame']) if (o[p] && o[p].w) o[p].w *= k; if (o.round) o.round *= k; return o; }
  // Andere Vorlage und/oder anderes Format; eigene Ebenen (ohne Feld) wandern maßstäblich mit
  function retemplate(doc, id, fmt){
    const F1 = format(doc.format), F2 = format(fmt || doc.format), k = Math.min(F2.w / F1.w, F2.h / F1.h), dx = (F2.w - F1.w * k) / 2, dy = (F2.h - F1.h * k) / 2;
    if (!id && !doc.tpl){ const d = clone(doc); d.format = F2.k; d.layers = doc.layers.map(L => L.type === 'bg' ? clone(L) : scaled(L, k, dx, dy)); d.updated = Date.now(); return d; }
    const extra = doc.layers.filter(L => !L.slot && L.type !== 'bg' && L.user).map(L => scaled(L, k, dx, dy));
    const d = fromTemplate(id || doc.tpl, F2.k, contentOf(doc), {id: doc.id, name: doc.name, accentKey: doc.accentKey, assets: doc.assets, extra});
    return prune(d);
  }
  // Akzentfarbe tauschen: alle Stellen, die die bisherige Farbe (hell oder dunkel) tragen
  function recolor(doc, key){
    const o = accent(doc.accentKey), n = accent(key), map = {[o.dark.toLowerCase()]: n.dark, [o.light.toLowerCase()]: n.light}, T = template(doc.tpl);
    const sw = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? (map[v.toLowerCase()] || (v.toLowerCase() === mix(o.light, PAL.ink, 0.28) ? mix(n.light, PAL.ink, 0.28) : v.toLowerCase() === mix(o.light, PAL.ink, 0.3) ? mix(n.light, PAL.ink, 0.3) : v)) : v;
    const walk = x => { for (const k of Object.keys(x)){ if (k === 'text' || k === 'img' || k === 'mask' || k === 'id') continue; if (x[k] && typeof x[k] === 'object') walk(x[k]); else x[k] = sw(x[k]); } };
    const d = clone(doc); d.layers.forEach(walk); d.accentKey = n.k; d.accent = (T ? T.dark : lum(bgColor(d)) < 0.5) ? n.dark : n.light; return d;
  }
  const bgColor = doc => { const b = doc.layers.find(L => L.type === 'bg'); return (b && b.fill && (b.fill.a || b.fill.c)) || PAL.ink; };
  // Neue Ebenen mit sinnvollen Startwerten
  function newLayer(doc, type, o = {}){
    const F = format(doc.format), u = Math.min(F.w, F.h), dark = lum(bgColor(doc)) < 0.5, base = {id: uid(), type, user: true};
    if (type === 'text') return {...base, text: 'TEXT', x: F.w * 0.1, y: F.h * 0.38, w: F.w * 0.8, h: F.h * 0.24, font: 'anton', size: u * 0.2, color: dark ? PAL.cream : PAL.ink, align: 'c', valign: 'm', lh: 1.04, upper: true, fit: true, ...o};
    if (type === 'shape') return {...base, shape: 'rect', x: F.w / 2 - u * 0.15, y: F.h / 2 - u * 0.15, w: u * 0.3, h: o.shape === 'line' ? u * 0.03 : o.shape === 'arrow' ? u * 0.18 : u * 0.3, fill: doc.accent || ACCENTS[0].dark, ...o};
    if (type === 'icon') return {...base, icon: 'megafon', x: F.w / 2 - u * 0.15, y: F.h / 2 - u * 0.15, w: u * 0.3, h: u * 0.3, color: dark ? PAL.cream : PAL.ink, ...o};
    if (type === 'img'){ const r = o.ratio || 1, h = u * 0.7, w = Math.min(F.w * 0.9, h * r); delete o.ratio; return {...base, x: F.w / 2 - w / 2, y: F.h / 2 - w / r / 2, w, h: w / r, fit: 'contain', pos: {x: 0.5, y: 0.5}, ...o}; }
    return base;
  }
  function blank(fmt, name){ return {app: 'honeythumb', v: 1, id: uid(), name: name || 'Titelbild', format: format(fmt).k, tpl: null, accentKey: 'rot', accent: ACCENTS[0].dark, assets: {}, layers: [{id: uid(), type: 'bg', fill: {kind: 'color', c: PAL.ink}}], updated: Date.now()}; }
  // Datei .honeythumb lesen: nur bekannte Ebenenarten, Zahlen begrenzt
  function parse(text){
    const d = typeof text === 'string' ? JSON.parse(text) : text; if (!d || d.app !== 'honeythumb' || !Array.isArray(d.layers)) throw new Error('Das ist keine HoneyThumb-Datei.');
    const F = format(d.format), num = (v, def, a, b) => clamp(Number.isFinite(+v) ? +v : def, a, b), out = {app: 'honeythumb', v: 1, id: uid(), name: String(d.name || 'Titelbild').slice(0, 120), format: F.k, tpl: template(d.tpl) ? d.tpl : null, accentKey: accent(d.accentKey).k, accent: /^#[0-9a-f]{6}$/i.test(d.accent || '') ? d.accent : ACCENTS[0].dark, assets: {}, layers: [], updated: Date.now()};
    for (const [k, v] of Object.entries(d.assets || {})) if (typeof v === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/.test(v)) out.assets[k] = v;
    for (const L of d.layers.slice(0, 200)){ if (!L || !['bg', 'img', 'text', 'shape', 'icon'].includes(L.type)) continue; const o = clone(L); o.id = uid(); delete o.auto;
      if (o.type !== 'bg'){ o.x = num(o.x, 0, -20000, 20000); o.y = num(o.y, 0, -20000, 20000); o.w = num(o.w, 100, 1, 20000); o.h = num(o.h, 100, 1, 20000); o.rot = num(o.rot, 0, -360, 360); }
      if (o.type === 'text'){ o.text = String(o.text || '').slice(0, 2000); o.size = num(o.size, 80, 6, 4000); }
      out.layers.push(o); }
    if (!out.layers.some(L => L.type === 'bg')) out.layers.unshift({id: uid(), type: 'bg', fill: {kind: 'color', c: PAL.ink}});
    return prune(out);
  }

  G.HoneyThumb = {version: VERSION, PAL, ACCENTS, accent, FORMATS, format, FONTS, SHAPES, BG_KINDS, TEMPLATES, template, uid, clone, clamp, mix, rgba, lum,
    decode, load, imgOf, addAsset, prune, fonts, cutout, render, hit, inside, textLayout, fromTemplate, contentOf, retemplate, recolor, newLayer, blank, parse, bgColor, mkCanvas};
})();
