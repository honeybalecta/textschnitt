'use strict';
/* HoneyDeck – Folien-Engine. Gemeinsamer Kern für die eigenständige App und für HoneyCut.
   Eine Folie ist ein kleines Datenobjekt (Art, Texte, Bild, Symbole); gezeichnet wird sie für jedes Format
   neu, alle Maße hängen an u = 1 % der kürzeren Bildkante. Texte werden so lange verkleinert, bis sie passen –
   abgeschnitten wird nie. Wird dafür eine Mindestgröße unterschritten, meldet render() das als Warnung.
   Benötigt deck-icons.js (window.HoneyDeckIcons). */
(function(){
  const G = typeof window !== 'undefined' ? window : globalThis;
  const IC = () => G.HoneyDeckIcons;

  // ───────── Folienarten ─────────
  // f = Felder im Editor, lbl = abweichende Beschriftungen, icon = Symbol-Platz ('one' = ein Symbol, 'lines' = eins je Zeile)
  const LAYOUTS = [
    {k:'titel',    n:'Titel',        g:'Text',   f:['kicker', 'title', 'text', 'source'], icon:'one'},
    {k:'liste',    n:'Stichpunkte',  g:'Text',   f:['kicker', 'title', 'text', 'source'], lbl:{text:'Stichpunkte (eine Zeile = ein Punkt)'}, icon:'one'},
    {k:'zitat',    n:'Zitat',        g:'Text',   f:['text', 'title', 'source'], lbl:{text:'Zitat', title:'Wer hat es gesagt?'}, icon:'one'},
    {k:'zahl',     n:'Zahl',         g:'Zahlen', f:['kicker', 'title', 'text', 'source'], lbl:{title:'Zahl (z. B. 42 %)', text:'Was die Zahl bedeutet'}, icon:'one'},
    {k:'begriff',  n:'Begriff',      g:'Text',   f:['kicker', 'title', 'text', 'source'], lbl:{title:'Begriff', text:'Bedeutung'}, icon:'one'},
    {k:'bild',     n:'Bild + Text',  g:'Bild',   f:['kicker', 'title', 'text', 'img', 'source']},
    {k:'vollbild', n:'Vollbild',     g:'Bild',   f:['title', 'text', 'img', 'source'], lbl:{title:'Bildunterschrift', text:'Zusatz (klein)'}},
    {k:'zwei',     n:'Zwei Seiten',  g:'Vergleich', f:['title', 'text', 'text2', 'source'], lbl:{text:'Linke Seite (1. Zeile = Überschrift)', text2:'Rechte Seite (1. Zeile = Überschrift)'}},
    {k:'aussage',  n:'Kernsatz',     g:'Text',   f:['kicker', 'title', 'source'], lbl:{title:'Kernsatz – *so markiert* wird ein Teil rot'}, icon:'one'},
    {k:'frage',    n:'Frage',        g:'Text',   f:['kicker', 'title', 'text', 'source'], lbl:{title:'Frage', text:'Zusatz (klein)'}},
    {k:'icons',    n:'Piktogramme',  g:'Symbole', f:['kicker', 'title', 'text', 'source'], lbl:{text:'Beschriftungen (eine Zeile = ein Symbol)'}, icon:'lines'},
    {k:'prozess',  n:'Ablauf',       g:'Symbole', f:['kicker', 'title', 'text', 'source'], lbl:{text:'Schritte (eine Zeile = ein Schritt)'}, icon:'lines'},
    {k:'zeitstrahl', n:'Zeitstrahl', g:'Symbole', f:['kicker', 'title', 'text', 'source'], lbl:{text:'Ereignisse – je Zeile „Datum: Text“'}},
    {k:'checkliste', n:'Richtig/Falsch', g:'Vergleich', f:['kicker', 'title', 'text', 'source'], lbl:{text:'Zeilen mit + (Haken) oder − (Kreuz) beginnen'}},
    {k:'zahlen',   n:'Kennzahlen',   g:'Zahlen', f:['kicker', 'title', 'text', 'source'], lbl:{text:'Je Zeile „Zahl: Bedeutung“ (2 bis 4)'}},
    {k:'balken',   n:'Balken',       g:'Zahlen', f:['kicker', 'title', 'text', 'source'], lbl:{text:'Je Zeile „Bezeichnung: Wert“ – * vorn hebt hervor'}},
    {k:'anteil',   n:'Anteil',       g:'Zahlen', f:['kicker', 'title', 'text', 'source'], lbl:{title:'Anteil (z. B. 37 %)', text:'Was der Anteil bedeutet'}},
    {k:'menschen', n:'Menschen',     g:'Zahlen', f:['kicker', 'title', 'text', 'source'], lbl:{title:'Verhältnis (z. B. 3 von 10)', text:'Was das Verhältnis bedeutet'}},
  ];
  const LBL = {kicker:'Rubrik (klein, oben)', title:'Titel', text:'Text', text2:'Zweite Spalte', source:'Quelle', img:'Bild'};
  const layout = k => LAYOUTS.find(x => x.k === k) || LAYOUTS[0];

  // ───────── Formate ─────────
  const FORMATS = [
    {k:'16:9', n:'Quer 16:9', W:1920, H:1080},
    {k:'9:16', n:'Hoch 9:16', W:1080, H:1920},
    {k:'1:1',  n:'Quadrat 1:1', W:1080, H:1080},
    {k:'4:5',  n:'Hoch 4:5', W:1080, H:1350},
    {k:'4:3',  n:'Quer 4:3', W:1440, H:1080},
    {k:'a4',   n:'A4 quer (Druck)', W:3508, H:2480},
  ];
  const format = k => FORMATS.find(x => x.k === k) || FORMATS[0];

  // ───────── Designprofile ─────────
  const BUILTIN = [
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
  const FONT_CHOICES = [{v:'Inter', l:'Inter'}, {v:'Lora', l:'Lora (Serifen)'}, {v:'k:montserrat', l:'Montserrat'}, {v:'k:poppins', l:'Poppins'},
    {v:'k:robotocondensed', l:'Roboto Condensed'}, {v:'k:oswald', l:'Oswald'}, {v:'k:bebas', l:'Bebas Neue'}, {v:'k:anton', l:'Anton'},
    {v:'k:archivo', l:'Archivo Black'}, {v:'k:playfair', l:'Playfair Display (Serifen)'}];

  function mix(a, b, f){ const h = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16)); const A = h(a), B = h(b);
    return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * f).toString(16).padStart(2, '0')).join(''); }
  function colors(pr, dark){ const c = pr.colors[dark ? 'dark' : 'light']; return {...c, line: mix(c.bg, c.fg, 0.18), soft: mix(c.bg, c.fg, 0.06)}; }
  function fontFn(spec, w, it, scale){
    const fam = spec === 'Lora' ? 'Lora, Georgia, serif' : spec && spec.startsWith('k:') ? `"TSF-${spec.slice(2)}", Inter, sans-serif` : 'Inter, "Segoe UI", sans-serif';
    const wt = spec && spec.startsWith('k:') ? 400 : w;
    const f = s => `${it ? 'italic ' : ''}${wt} ${s.toFixed(1)}px ${fam}`; f.scale = scale || 1; return f;
  }
  // Hell oder dunkel: fest an der Folie, sonst aus dem Profil (abwechselnd nach Position k)
  const isDark = (sl, k, pr) => { if (sl.dark != null) return !!sl.dark; const t = pr.theme; if (t === 'dunkel') return true; if (t === 'hell') return false; return (k || 0) % 2 === 0; };

  // ───────── Schriften laden ─────────
  let baseFonts = null; const doneFonts = new Set();
  function fonts(pr){
    if (typeof document === 'undefined' || !document.fonts) return Promise.resolve();
    const base = baseFonts ||= Promise.all(['400', '500', '600', '700', '800', '900'].map(w => document.fonts.load(`${w} 40px Inter`))
      .concat([document.fonts.load('600 40px Lora'), document.fonts.load('700 40px Lora'), document.fonts.load('italic 600 40px Lora')])).catch(() => {});
    const extra = Object.values((pr && pr.fonts) || {}).filter(f => f && f.startsWith('k:') && !doneFonts.has(f));
    return Promise.all([base, ...extra.map(f => document.fonts.load(`400 40px "TSF-${f.slice(2)}"`).then(() => doneFonts.add(f)).catch(() => {}))]);
  }

  // ───────── Bilder ─────────
  const imgCache = new Map();
  function loadImg(url){
    if (!url) return Promise.resolve(null);
    if (!imgCache.has(url)){ if (imgCache.size > 80) imgCache.delete(imgCache.keys().next().value);
      imgCache.set(url, new Promise(res => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => res(null); im.src = url; })); }
    return imgCache.get(url);
  }
  const defaultImgUrl = uri => uri && /^(data:|blob:|https?:)/.test(uri) ? uri : null;

  // ───────── Text mit Hervorhebung: *so* = Akzentfarbe ─────────
  function words(text){
    const out = [];
    for (const para of String(text || '').split('\n')){
      const line = []; let acc = false, cur = null;
      const flush = () => { if (cur && cur.s) line.push(cur); cur = null; };
      for (const ch of para){
        if (ch === '*'){ acc = !acc; continue; }
        if (/\s/.test(ch)){ flush(); continue; }
        if (!cur) cur = {s:'', runs:[]};
        cur.s += ch; const r = cur.runs[cur.runs.length - 1];
        if (r && r.acc === acc) r.t += ch; else cur.runs.push({t: ch, acc});
      }
      flush(); out.push(line);
    }
    return out;
  }
  const plain = t => String(t || '').replace(/\*/g, '');
  function wrap(ctx, text, maxW){
    const out = [];
    for (const para of words(text)){
      let cur = [];
      for (const w of para){ const t = cur.concat(w); if (cur.length && ctx.measureText(t.map(x => x.s).join(' ')).width > maxW){ out.push(cur); cur = [w]; } else cur = t; }
      out.push(cur);
    }
    while (out.length && !out[out.length - 1].length) out.pop();
    return out;
  }
  const lineStr = l => l.map(w => w.s).join(' ');
  // Größte Schrift, bei der der Text in die Fläche passt. Unter der Mindestgröße wird weiter verkleinert und gewarnt.
  function makeFit(rep){
    return (ctx, text, font, maxW, maxH, size, min, lh) => {
      size *= font.scale || 1; min *= font.scale || 1;
      const ok = sz => { ctx.font = font(sz); const lines = wrap(ctx, text, maxW);
        return (lines.length * sz * lh <= maxH + 0.5 && lines.every(l => ctx.measureText(lineStr(l)).width <= maxW + 1)) ? lines : null; };
      for (let sz = size; sz > min; sz *= 0.93){ const lines = ok(sz); if (lines) return {lines, size: sz}; }
      if (!plain(text).trim()) { ctx.font = font(min); return {lines: [], size: min}; }
      let lines = ok(min); if (lines) return {lines, size: min};
      for (let sz = min * 0.93; sz > 0.6; sz *= 0.93){ lines = ok(sz); if (lines){ rep.small = true; return {lines, size: sz}; } }
      rep.over = true; ctx.font = font(min); return {lines: wrap(ctx, text, maxW), size: min};
    };
  }
  function drawText(ctx, f, x, y, lh, color, align = 'left', acc){
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    const sp = ctx.measureText(' ').width;
    f.lines.forEach((l, i) => {
      const yy = y + f.size * (0.82 + i * lh), tw = ctx.measureText(lineStr(l)).width;
      let xx = align === 'center' ? x - tw / 2 : align === 'right' ? x - tw : x;
      for (const w of l){ for (const r of w.runs){ ctx.fillStyle = r.acc && acc ? acc : color; ctx.fillText(r.t, xx, yy); xx += ctx.measureText(r.t).width; } xx += sp; }
    });
    return y + f.size * lh * f.lines.length;
  }
  function cover(ctx, im, x, y, w, h, pos){
    const f = Math.max(w / im.width, h / im.height), dw = im.width * f, dh = im.height * f;
    const fx = pos && pos.x != null ? pos.x : 0.5, fy = pos && pos.y != null ? pos.y : 0.5;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.drawImage(im, x + (w - dw) * fx, y + (h - dh) * fy, dw, dh); ctx.restore();
  }
  function contain(ctx, im, x, y, w, h, C){
    ctx.fillStyle = C.soft; ctx.fillRect(x, y, w, h);
    const f = Math.min(w / im.width, h / im.height), dw = im.width * f, dh = im.height * f;
    ctx.drawImage(im, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
  function imgPh(ctx, x, y, w, h, C, u){
    ctx.fillStyle = C.soft; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = C.line; ctx.lineWidth = Math.max(2, u * 0.35); ctx.setLineDash([u * 1.2, u * 0.9]); ctx.strokeRect(x + u, y + u, w - 2 * u, h - 2 * u); ctx.setLineDash([]);
    const cx = x + w / 2, cy = y + h / 2, s = Math.min(w, h) * 0.18;
    ctx.fillStyle = C.line; ctx.beginPath(); ctx.moveTo(cx - s * 1.6, cy + s); ctx.lineTo(cx - s * 0.4, cy - s * 0.4); ctx.lineTo(cx + s * 0.3, cy + s * 0.3); ctx.lineTo(cx + s * 0.8, cy - s * 0.1); ctx.lineTo(cx + s * 1.6, cy + s); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C.acc; ctx.beginPath(); ctx.arc(cx + s * 0.9, cy - s * 0.9, s * 0.35, 0, 7); ctx.fill();
  }
  // Zeilen „Links: Rechts“ zerlegen
  const pairs = t => String(t || '').split('\n').map(x => x.trim()).filter(Boolean).map(x => { const m = x.match(/^(.*?)\s*[:–|]\s+(.*)$/) || x.match(/^(.*?):(.*)$/); return m ? [m[1].trim(), m[2].trim()] : [x, '']; });
  const lines = t => String(t || '').split('\n').map(x => x.trim()).filter(Boolean);
  const num = s => { const m = String(s || '').replace(/\s/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : NaN; };

  // ───────── Zeichnen ─────────
  // opts: k (Position im Deck, für hell/dunkel), profile, safe (0..0.3, freier Streifen unten), imgUrl(uri) → URL, report {}
  async function render(sl, W, H, opts = {}){
    const pr = opts.profile || BUILTIN[0], rep = opts.report || {};
    await fonts(pr);
    const safe = opts.safe || 0;
    const C0 = colors(pr, isDark(sl, opts.k, pr) || sl.layout === 'vollbild');
    if (safe > 0){   // Folie in den oberen Teil setzen, darunter Fläche in Hintergrundfarbe (Platz für Untertitel)
      const ih = Math.round(H * (1 - safe)), inner = await render(sl, W, ih, {...opts, safe: 0, report: rep});
      const out = mkCanvas(W, H), c2 = out.getContext('2d');
      c2.fillStyle = C0.bg; c2.fillRect(0, 0, W, H); c2.drawImage(inner, 0, 0);
      return out;
    }
    const cv = mkCanvas(W, H), ctx = cv.getContext('2d');
    await draw(ctx, sl, W, H, pr, opts, rep);
    return cv;
  }
  function mkCanvas(W, H){ if (typeof document !== 'undefined'){ const c = document.createElement('canvas'); c.width = W; c.height = H; return c; } return new OffscreenCanvas(W, H); }

  async function draw(ctx, sl, W, H, pr, opts, rep){
    const port = H > W, u = Math.min(W, H) / 100, k = opts.k || 0;
    const fit = makeFit(rep);
    const C = colors(pr, isDark(sl, k, pr) || sl.layout === 'vollbild'), CD = colors(pr, true);
    const INTER = w => w >= 700 ? fontFn(pr.fonts.head, w, false, w >= 800 ? pr.titleScale : 1) : fontFn(pr.fonts.body, w, false, pr.textScale);
    const LORA = (w, it) => fontFn(pr.fonts.serif, w, it, pr.titleScale);
    const pf = pr.pad === 'eng' ? 0.75 : pr.pad === 'weit' ? 1.4 : 1;
    let px = Math.max(6 * u, W * (port ? 0.08 : 0.065)) * pf, py = 7 * u * pf, cw = W - 2 * px;
    const L = sl.layout;
    const CEN = pr.align === 'center' && ['titel', 'zahl', 'begriff', 'zitat', 'vollbild', 'aussage', 'frage', 'anteil', 'menschen'].includes(L);
    const icons = (sl.icons || []).filter(Boolean);
    try { ctx.letterSpacing = '0px'; } catch(_){}
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    const imgUrl = opts.imgUrl || defaultImgUrl;
    const im = (L === 'bild' || L === 'vollbild') ? await loadImg(imgUrl(sl.img)) : null;
    const bottom0 = H - py - (sl.source || pr.handle ? 4 * u : 0);

    // Symbol-Platz für Folien mit einem Symbol: quer rechts daneben, hoch/quadratisch oben
    let bx = px, bw = cw, top = py, bottom = bottom0;
    const one = layout(L).icon === 'one' && icons[0] && IC() && IC().LIB.has(icons[0]);
    if (one){
      const side = W / H > 1.2;
      if (side){
        const s = Math.min((bottom0 - py) * 0.62, W * 0.24), ix = W - px - s, iy = py + (bottom0 - py - s) / 2;
        IC().draw(ctx, icons[0], ix, iy, s, C.fg, C.acc);
        bw = cw - s - 6 * u;
      } else {
        const s = Math.min(W * (port ? 0.3 : 0.2), (bottom0 - py) * 0.2), cen = CEN;
        IC().draw(ctx, icons[0], cen ? W / 2 - s / 2 : px, py, s, C.fg, C.acc);
        top = py + s + 4 * u;
      }
    }
    const AX = CEN ? bx + bw / 2 : bx, AL = CEN ? 'center' : 'left';
    const kicker = (x, y, txt, color = C.acc) => {   // Akzentstrich und Rubrik in Versalien
      const cen = CEN && x === bx, mid = bx + bw / 2, b0 = cen ? mid - 3 * u : x;
      if (pr.bar !== false) ctx.fillStyle = C.acc, ctx.fillRect(b0, y, 6 * u, 0.8 * u);
      if (!txt) return y + 3 * u;
      try { ctx.letterSpacing = (0.35 * u).toFixed(1) + 'px'; } catch(_){}
      ctx.font = fontFn(pr.fonts.body, 700)(2.5 * u); ctx.fillStyle = color; ctx.textAlign = cen ? 'center' : 'left';
      let t = plain(txt).toUpperCase(); const mw = (cen ? bw : bw - (x - bx));
      while (t.length > 3 && ctx.measureText(t).width > mw) { t = t.slice(0, -2) + '…'; rep.small = true; }
      ctx.fillText(t, cen ? mid : x, y + 5 * u);
      try { ctx.letterSpacing = '0px'; } catch(_){}
      return y + 9 * u;
    };
    const footer = () => {
      ctx.textBaseline = 'alphabetic';
      if (sl.source){ ctx.font = fontFn(pr.fonts.body, 500)(2.1 * u); ctx.fillStyle = L === 'vollbild' ? CD.mute : C.mute;
        const t = 'Quelle: ' + plain(sl.source), mw = pr.handle && !pr.sourceRight ? cw * 0.7 : cw, f = fit(ctx, t, fontFn(pr.fonts.body, 500), mw, 2.6 * u, 2.1 * u, 1.4 * u, 1.1);
        ctx.font = fontFn(pr.fonts.body, 500)(f.size); ctx.textAlign = pr.sourceRight ? 'right' : CEN ? 'center' : 'left';
        ctx.fillText(f.lines.map(lineStr).join(' '), pr.sourceRight ? W - px : CEN ? W / 2 : px, H - py + u); }
      if (pr.handle && !(sl.source && pr.sourceRight)){ ctx.font = fontFn(pr.fonts.body, 700)(2.1 * u); ctx.fillStyle = L === 'vollbild' ? CD.mute : C.mute; ctx.textAlign = 'right'; ctx.fillText(pr.handle, W - px, H - py + u); }
    };

    if (L === 'titel' || L === 'begriff' || L === 'zahl'){
      let y = kicker(bx, top, L === 'begriff' && !sl.kicker ? 'Begriff' : sl.kicker);
      const maxW = port ? bw : Math.min(bw, W * 0.82), area = bottom - y - 2 * u;
      const tf = L === 'zahl' ? fit(ctx, sl.title || '0', INTER(900), maxW, area * 0.62, 26 * u, 6 * u, 1.0)
        : L === 'begriff' ? fit(ctx, sl.title || 'Begriff', LORA(700), maxW, area * 0.45, 11 * u, 4 * u, 1.1)
        : fit(ctx, sl.title || 'Titel', INTER(800), maxW, area * (sl.text ? 0.62 : 0.95), 9.5 * u, 3.6 * u, 1.08);
      const xf = fit(ctx, sl.text || '', INTER(L === 'zahl' ? 500 : 400), maxW, area - tf.lines.length * tf.size * 1.1 - 4 * u, L === 'zahl' ? 4.6 * u : 3.8 * u, 2.2 * u, 1.35);
      const blockH = tf.lines.length * tf.size * (L === 'zahl' ? 1.0 : 1.08) + (sl.text ? 3.5 * u + xf.lines.length * xf.size * 1.35 : 0);
      let ty = y + Math.max(0, (area - blockH) / 2);
      ctx.font = L === 'zahl' ? INTER(900)(tf.size) : L === 'begriff' ? LORA(700)(tf.size) : INTER(800)(tf.size);
      ty = drawText(ctx, tf, AX, ty, L === 'zahl' ? 1.0 : 1.08, L === 'zahl' ? C.acc : C.fg, AL, C.acc);
      if (L === 'begriff'){ ctx.fillStyle = C.acc; ctx.fillRect(CEN ? AX - 5 * u : bx, ty + 1.2 * u, 10 * u, 0.6 * u); ty += 1.5 * u; }
      if (sl.text){ ctx.font = INTER(L === 'zahl' ? 500 : 400)(xf.size); drawText(ctx, xf, AX, ty + 2.5 * u, 1.35, L === 'zahl' ? C.fg : C.mute, AL, C.acc); }
    } else if (L === 'aussage'){
      let y = kicker(bx, top, sl.kicker);
      const area = bottom - y - 2 * u, maxW = port ? bw : Math.min(bw, W * 0.8);
      const tf = fit(ctx, sl.title || 'Ein Satz, der *hängen bleibt*.', INTER(800), maxW, area, 11 * u, 3.6 * u, 1.1);
      ctx.font = INTER(800)(tf.size); drawText(ctx, tf, AX, y + Math.max(0, (area - tf.lines.length * tf.size * 1.1) / 2), 1.1, C.fg, AL, C.acc);
    } else if (L === 'frage'){
      let y = kicker(bx, top, sl.kicker);
      const area = bottom - y - 2 * u, qs = Math.min(area * (port ? 0.3 : 0.55), W * (port ? 0.3 : 0.2));
      const side = !port && W / H > 1.2, maxW = side ? bw - qs - 5 * u : bw;
      const tf = fit(ctx, sl.title || 'Frage?', INTER(800), maxW, (side ? area : area - qs - 3 * u) * (sl.text ? 0.7 : 1), 9 * u, 3.4 * u, 1.1);
      const xf = fit(ctx, sl.text || '', INTER(400), maxW, (side ? area : area - qs - 3 * u) - tf.lines.length * tf.size * 1.1 - 3 * u, 3.8 * u, 2.2 * u, 1.35);
      const blockH = tf.lines.length * tf.size * 1.1 + (sl.text ? 3 * u + xf.lines.length * xf.size * 1.35 : 0);
      ctx.font = INTER(900)(qs * 1.25); ctx.fillStyle = C.acc; ctx.textBaseline = 'alphabetic';
      let ty;
      if (side){ ctx.textAlign = 'center'; ctx.fillText('?', bx + bw - qs / 2, y + area / 2 + qs * 0.45); ty = y + Math.max(0, (area - blockH) / 2); }
      else { ctx.textAlign = CEN ? 'center' : 'left'; ctx.fillText('?', CEN ? AX : bx - qs * 0.05, y + qs * 0.95); y += qs + 3 * u; ty = y + Math.max(0, (bottom - y - blockH) / 2.5); }
      ctx.font = INTER(800)(tf.size); ty = drawText(ctx, tf, side ? bx : AX, ty, 1.1, C.fg, side ? 'left' : AL, C.acc);
      if (sl.text){ ctx.font = INTER(400)(xf.size); drawText(ctx, xf, side ? bx : AX, ty + 3 * u, 1.35, C.mute, side ? 'left' : AL, C.acc); }
    } else if (L === 'liste'){
      let y = kicker(bx, top, sl.kicker);
      const tf = fit(ctx, sl.title || '', INTER(800), bw, (bottom - y) * 0.3, 7.5 * u, 3 * u, 1.08);
      if (sl.title){ ctx.font = INTER(800)(tf.size); y = drawText(ctx, tf, bx, y, 1.08, C.fg, 'left', C.acc) + 5 * u; }
      const items = lines(sl.text);
      const area = bottom - y, maxW = port ? bw : Math.min(bw, W * 0.8);
      let sz = 5.6 * u * (pr.textScale || 1), rows = [], h = 0;
      const measure = s => { ctx.font = INTER(500)(s); rows = items.map(t => wrap(ctx, t, maxW - 6 * u)); return rows.reduce((n, r) => n + r.length * s * 1.3, 0) + s * 0.7 * Math.max(0, items.length - 1); };
      for (; sz > 2 * u; sz *= 0.93){ h = measure(sz); if (h <= area) break; }
      if (h > area){ for (; sz > 0.8 * u; sz *= 0.93){ h = measure(sz); if (h <= area) break; } if (h > area) rep.over = true; else rep.small = true; }
      h = measure(sz);
      const gap = sz * 0.7; y += Math.max(0, (area - h) / 2.5);
      rows.forEach(r => { ctx.fillStyle = C.acc; ctx.fillRect(bx, y + sz * 0.3, sz * 0.5, sz * 0.5); drawText(ctx, {lines: r, size: sz}, bx + 6 * u, y - sz * 0.1, 1.3, C.fg, 'left', C.acc); y += r.length * sz * 1.3 + gap; });
    } else if (L === 'zitat'){
      ctx.font = LORA(700)(30 * u); ctx.fillStyle = C.acc; ctx.textAlign = AL; ctx.textBaseline = 'alphabetic';
      const qa = ctx.measureText('“').actualBoundingBoxAscent || 21 * u; ctx.fillText('“', CEN ? AX : bx - 1.5 * u, top + 1 * u + qa);
      const t0 = top + 16 * u, area = bottom - t0 - (sl.title ? 8 * u : 0);
      const qf = fit(ctx, sl.text || 'Zitat', LORA(600, true), port ? bw : Math.min(bw, W * 0.8), area, 9.5 * u, 2.8 * u, 1.24);
      ctx.font = LORA(600, true)(qf.size); let y = drawText(ctx, qf, AX, t0 + Math.max(0, (area - qf.lines.length * qf.size * 1.24) / 2.5), 1.24, C.fg, AL, C.acc);
      if (sl.title){ const af = fit(ctx, (CEN ? '— ' : '') + plain(sl.title), fontFn(pr.fonts.body, 700), bw - 6 * u, 4 * u, 2.9 * u, 1.6 * u, 1.1); ctx.font = fontFn(pr.fonts.body, 700)(af.size); ctx.fillStyle = C.fg;
        if (CEN){ ctx.textAlign = 'center'; ctx.fillText(af.lines.map(lineStr).join(' '), AX, y + 4.1 * u); }
        else { ctx.fillStyle = C.acc; ctx.fillRect(bx, y + 3 * u, 4 * u, 0.6 * u); ctx.fillStyle = C.fg; ctx.textAlign = 'left'; ctx.fillText(af.lines.map(lineStr).join(' '), bx + 6 * u, y + 4.1 * u); } }
    } else if (L === 'bild'){
      const ix = port ? 0 : W * 0.52, iy = 0, iw = port ? W : W - ix, ih = port ? H * 0.46 : H;
      if (im) (sl.imgFit === 'contain' ? contain(ctx, im, ix, iy, iw, ih, C) : cover(ctx, im, ix, iy, iw, ih, sl.imgPos)); else imgPh(ctx, ix, iy, iw, ih, C, u);
      const tx = px, tw = port ? cw : ix - 2 * px; let y = port ? ih + 5 * u : py;
      bx = tx; bw = tw;
      y = kicker(tx, y, sl.kicker);
      const area = bottom - y;
      const tf = fit(ctx, sl.title || '', INTER(800), tw, area * (sl.text ? 0.55 : 0.95), 7.5 * u, 3 * u, 1.08);
      const xf = fit(ctx, sl.text || '', INTER(400), tw, area - tf.lines.length * tf.size * 1.08 - 4 * u, 3.6 * u, 2 * u, 1.35);
      const blockH = (sl.title ? tf.lines.length * tf.size * 1.08 : 0) + (sl.text ? 3 * u + xf.lines.length * xf.size * 1.35 : 0);
      let ty = y + Math.max(0, (area - blockH) / 2);
      if (sl.title){ ctx.font = INTER(800)(tf.size); ty = drawText(ctx, tf, tx, ty, 1.08, C.fg, 'left', C.acc); }
      if (sl.text){ ctx.font = INTER(400)(xf.size); drawText(ctx, xf, tx, ty + 3 * u, 1.35, C.mute, 'left', C.acc); }
    } else if (L === 'vollbild'){
      if (im) (sl.imgFit === 'contain' ? contain(ctx, im, 0, 0, W, H, C) : cover(ctx, im, 0, 0, W, H, sl.imgPos)); else imgPh(ctx, 0, 0, W, H, C, u);
      if (sl.title || sl.text || sl.source){ const g = ctx.createLinearGradient(0, H * 0.45, 0, H); g.addColorStop(0, CD.bg + '00'); g.addColorStop(1, CD.bg + 'F5'); ctx.fillStyle = g; ctx.fillRect(0, H * 0.4, W, H * 0.6); }
      const xf = fit(ctx, sl.text || '', INTER(500), cw * 0.9, H * 0.12, 3 * u, 2 * u, 1.3);
      const tf = fit(ctx, sl.title || '', INTER(800), port ? cw : cw * 0.75, H * 0.24, 6 * u, 3 * u, 1.08);
      let y = bottom - (sl.text ? xf.lines.length * xf.size * 1.3 + 2 * u : 0) - (sl.title ? tf.lines.length * tf.size * 1.08 : 0);
      if (sl.title){ if (pr.bar !== false){ ctx.fillStyle = CD.acc; ctx.fillRect(CEN ? W / 2 - 3 * u : px, y - 3 * u, 6 * u, 0.8 * u); } ctx.font = INTER(800)(tf.size); y = drawText(ctx, tf, CEN ? W / 2 : px, y, 1.08, CD.fg, AL, CD.acc) + 2 * u; }
      if (sl.text){ ctx.font = INTER(500)(xf.size); drawText(ctx, xf, CEN ? W / 2 : px, y, 1.3, CD.mute, AL, CD.acc); }
    } else if (L === 'zwei'){
      let y = kicker(px, py, '');
      const tf = fit(ctx, sl.title || '', INTER(800), cw, (bottom - y) * 0.26, 6 * u, 3 * u, 1.08);
      if (sl.title){ ctx.font = INTER(800)(tf.size); y = drawText(ctx, tf, px, y, 1.08, C.fg, 'left', C.acc) + 4 * u; }
      const cols = [sl.text || '', sl.text2 || ''], gap = 5 * u;
      const colW = port ? cw : (cw - gap) / 2, colH = port ? (bottom - y - gap) / 2 : bottom - y;
      cols.forEach((t, i) => {
        const x0 = port ? px : px + i * (colW + gap), y0 = port ? y + i * (colH + gap) : y;
        ctx.fillStyle = C.soft; ctx.fillRect(x0, y0, colW, colH);
        ctx.fillStyle = i === 0 ? C.acc : C.fg; ctx.fillRect(x0, y0, colW, 0.7 * u);
        const [head, ...rest] = String(t).split('\n'), ip = 3 * u;
        const hf = fit(ctx, head || '', INTER(800), colW - 2 * ip, colH * 0.3, 5.6 * u, 2.4 * u, 1.1);
        ctx.font = INTER(800)(hf.size); let yy = drawText(ctx, hf, x0 + ip, y0 + ip + u, 1.1, i === 0 ? C.acc : C.fg) + 2 * u;
        const bf = fit(ctx, rest.join('\n'), INTER(500), colW - 2 * ip, y0 + colH - yy - ip, 4.6 * u, 1.8 * u, 1.35);
        ctx.font = INTER(500)(bf.size); drawText(ctx, bf, x0 + ip, yy, 1.35, C.fg, 'left', C.acc);
      });
    } else if (L === 'icons' || L === 'prozess'){
      let y = kicker(px, py, sl.kicker);
      const tf = fit(ctx, sl.title || '', INTER(800), cw, (bottom - y) * 0.24, 6.5 * u, 3 * u, 1.08);
      if (sl.title){ ctx.font = INTER(800)(tf.size); y = drawText(ctx, tf, px, y, 1.08, C.fg, 'left', C.acc) + 5 * u; }
      const items = lines(sl.text).slice(0, 8), n = Math.max(1, items.length), ic = sl.icons || [];
      const area = bottom - y, proc = L === 'prozess';
      // Raster: die Spaltenzahl, bei der Symbole und Beschriftungen am größten werden (Ablauf: Reihe oder untereinander)
      const tFont = INTER(700);
      const plan = cols => {
        const rowsN = Math.ceil(n / cols), gapX = (proc && cols > 1 ? 7 : 4) * u, gapY = 3.5 * u;
        const cellW = (cw - gapX * (cols - 1)) / cols, cellH = (area - gapY * (rowsN - 1)) / rowsN, vertical = cols === 1;
        const s = vertical ? Math.min(cellH * 0.8, cw * 0.18, 26 * u) : Math.min(cellW * 0.66, cellH * 0.48, 30 * u);
        const r0 = {}, fz = makeFit(r0);
        let tsz = Infinity; items.forEach(t => { const f = vertical ? fz(ctx, t, tFont, cw - s - 5 * u, cellH * 0.95, 5.5 * u, 1.8 * u, 1.2) : fz(ctx, t, tFont, cellW - u, cellH - s - 3 * u, 5 * u, 1.8 * u, 1.2); tsz = Math.min(tsz, f.size); });
        return {cols, rowsN, gapX, gapY, cellW, cellH, vertical, s, tsz, score: Math.min(tsz, 4.5 * u) * 8 + s};
      };
      const cands = proc ? [n, 1] : [...Array(Math.min(n, 6)).keys()].map(i => i + 1);
      const P0 = cands.map(plan).reduce((p, q) => q.score > p.score ? q : p);
      const {cols, gapX, gapY, cellW, cellH, vertical, s, tsz} = P0;
      items.forEach((t, i) => {
        const r = Math.floor(i / cols), c = i % cols, x0 = px + c * (cellW + gapX), y0 = y + r * (cellH + gapY);
        ctx.font = tFont(tsz); const f = vertical ? fit(ctx, t, tFont, cw - s - 5 * u, cellH * 0.95, tsz / (tFont.scale || 1), tsz / (tFont.scale || 1), 1.2) : fit(ctx, t, tFont, cellW - u, cellH - s - 3 * u, tsz / (tFont.scale || 1), tsz / (tFont.scale || 1), 1.2);
        const blockH = vertical ? Math.max(s, f.lines.length * f.size * 1.2) : s + 3 * u + f.lines.length * f.size * 1.2;
        const ix = vertical ? x0 : x0 + cellW / 2 - s / 2, iy = vertical ? y0 + (cellH - s) / 2 : y0 + Math.max(0, (cellH - blockH) / 2);
        const name = ic[i] && IC() && IC().LIB.has(ic[i]) ? ic[i] : null;
        if (name){ ctx.fillStyle = C.soft; ctx.beginPath(); ctx.arc(ix + s / 2, iy + s / 2, s / 2, 0, 7); ctx.fill(); IC().draw(ctx, name, ix + s * 0.2, iy + s * 0.2, s * 0.6, C.fg, C.acc); }
        else { ctx.fillStyle = proc ? C.acc : C.soft; ctx.beginPath(); ctx.arc(ix + s / 2, iy + s / 2, s / 2, 0, 7); ctx.fill();
          ctx.font = INTER(900)(s * 0.45); ctx.fillStyle = proc ? C.bg : C.acc; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(String(i + 1), ix + s / 2, iy + s / 2 + s * 0.03); ctx.textBaseline = 'alphabetic'; }
        ctx.font = tFont(f.size);
        if (vertical) drawText(ctx, f, x0 + s + 5 * u, y0 + (cellH - f.lines.length * f.size * 1.2) / 2, 1.2, C.fg, 'left', C.acc);
        else drawText(ctx, f, x0 + cellW / 2, iy + s + 3 * u, 1.2, C.fg, 'center', C.acc);
        if (proc && i < n - 1){   // Pfeil zum nächsten Schritt
          ctx.fillStyle = C.acc;
          if (vertical){ const ax = ix + s / 2, ay = y0 + cellH - (cellH - s) / 2 + gapY * 0.1, len = (cellH - s) + gapY * 0.8; if (len > 2 * u){ ctx.fillRect(ax - 0.3 * u, ay + 0.6 * u, 0.6 * u, Math.max(0, len - 2.6 * u)); ctx.beginPath(); ctx.moveTo(ax - 1.4 * u, ay + len - 2.2 * u); ctx.lineTo(ax + 1.4 * u, ay + len - 2.2 * u); ctx.lineTo(ax, ay + len - 0.4 * u); ctx.fill(); } }
          else { const ax = x0 + cellW + gapX * 0.15, ay = iy + s / 2, len = gapX * 0.7; ctx.fillRect(ax, ay - 0.3 * u, len - 1.6 * u, 0.6 * u); ctx.beginPath(); ctx.moveTo(ax + len - 2 * u, ay - 1.3 * u); ctx.lineTo(ax + len, ay); ctx.lineTo(ax + len - 2 * u, ay + 1.3 * u); ctx.fill(); }
        }
      });
    } else if (L === 'zeitstrahl'){
      let y = kicker(px, py, sl.kicker);
      const tf = fit(ctx, sl.title || '', INTER(800), cw, (bottom - y) * 0.24, 6.5 * u, 3 * u, 1.08);
      if (sl.title){ ctx.font = INTER(800)(tf.size); y = drawText(ctx, tf, px, y, 1.08, C.fg, 'left', C.acc) + 5 * u; }
      const ev = pairs(sl.text).slice(0, 8), n = Math.max(1, ev.length), area = bottom - y;
      if (port || W / H < 1.2){   // senkrecht
        const lx = px + 1.5 * u, rowH = area / n, dw = cw - 6 * u;
        ctx.fillStyle = C.line; ctx.fillRect(lx - 0.3 * u, y + rowH * 0.15, 0.6 * u, Math.max(0, area - rowH * 0.3));
        let dsz = Infinity, tsz = Infinity;
        const fs = ev.map(([d, t]) => { const a = fit(ctx, d, INTER(800), dw, rowH * 0.4, 5.5 * u, 2 * u, 1.05), b = fit(ctx, t, INTER(400), dw, rowH * 0.5, 4.2 * u, 1.8 * u, 1.25); dsz = Math.min(dsz, a.size); tsz = Math.min(tsz, b.size); return [a, b]; });
        ev.forEach(([d, t], i) => { const y0 = y + i * rowH;
          ctx.fillStyle = C.acc; ctx.beginPath(); ctx.arc(lx, y0 + rowH * 0.22, 1.4 * u, 0, 7); ctx.fill();
          ctx.font = INTER(800)(dsz); const fa = {lines: wrap(ctx, d, dw), size: dsz}; let yy = drawText(ctx, fa, px + 6 * u, y0 + rowH * 0.22 - dsz * 0.6, 1.05, C.acc, 'left');
          ctx.font = INTER(400)(tsz); drawText(ctx, {lines: wrap(ctx, t, dw), size: tsz}, px + 6 * u, yy + 0.8 * u, 1.25, C.fg, 'left', C.acc); void fs; });
      } else {
        const ly = y + area * 0.38, colW = cw / n;
        ctx.fillStyle = C.line; ctx.fillRect(px, ly - 0.3 * u, cw, 0.6 * u);
        let dsz = Infinity, tsz = Infinity;
        ev.forEach(([d, t]) => { dsz = Math.min(dsz, fit(ctx, d, INTER(800), colW - 3 * u, area * 0.3, 7 * u, 2 * u, 1.05).size); tsz = Math.min(tsz, fit(ctx, t, INTER(400), colW - 3 * u, area * 0.55, 4.4 * u, 1.6 * u, 1.25).size); });
        ev.forEach(([d, t], i) => { const x0 = px + i * colW;
          ctx.fillStyle = C.acc; ctx.beginPath(); ctx.arc(x0 + 1.4 * u, ly, 1.4 * u, 0, 7); ctx.fill();
          ctx.font = INTER(800)(dsz); const fa = {lines: wrap(ctx, d, colW - 3 * u), size: dsz}; drawText(ctx, fa, x0, ly - 2.5 * u - fa.lines.length * dsz * 1.05, 1.05, C.acc, 'left');
          ctx.font = INTER(400)(tsz); drawText(ctx, {lines: wrap(ctx, t, colW - 3 * u), size: tsz}, x0, ly + 3 * u, 1.25, C.fg, 'left', C.acc); });
      }
    } else if (L === 'checkliste'){
      let y = kicker(px, py, sl.kicker);
      const tf = fit(ctx, sl.title || '', INTER(800), cw, (bottom - y) * 0.28, 7 * u, 3 * u, 1.08);
      if (sl.title){ ctx.font = INTER(800)(tf.size); y = drawText(ctx, tf, px, y, 1.08, C.fg, 'left', C.acc) + 5 * u; }
      const items = lines(sl.text).map(t => { const m = t.match(/^([+✓✔\-−–✗✘]|x(?=\s))\s*(.*)$/i); const s = m ? m[1] : ''; return {k: /[+✓✔]/.test(s) ? 'ja' : s && /[-−–✗✘x]/i.test(s) ? 'nein' : '', t: m ? m[2] : t}; });
      const area = bottom - y, maxW = port ? cw : Math.min(cw, W * 0.82);
      let sz = 5.4 * u * (pr.textScale || 1), rows = [], h = 0;
      const measure = s => { ctx.font = INTER(600)(s); rows = items.map(it => wrap(ctx, it.t, maxW - s * 1.9)); return rows.reduce((n, r) => n + r.length * s * 1.3, 0) + s * 0.8 * Math.max(0, items.length - 1); };
      for (; sz > 1 * u; sz *= 0.93){ h = measure(sz); if (h <= area) break; }
      if (sz < 2 * u) rep.small = true; if (h > area) rep.over = true;
      y += Math.max(0, (area - h) / 2.5);
      rows.forEach((r, i) => { const it = items[i], s = sz * 1.15, iy = y + sz * 0.05;
        if (it.k && IC()) IC().draw(ctx, it.k === 'ja' ? 'haken' : 'kreuz', px, iy, s, it.k === 'ja' ? C.acc : C.mute, null);
        else { ctx.fillStyle = C.acc; ctx.fillRect(px + s * 0.3, iy + s * 0.35, s * 0.4, s * 0.4); }
        ctx.font = INTER(600)(sz); drawText(ctx, {lines: r, size: sz}, px + sz * 1.9, y - sz * 0.05, 1.3, it.k === 'nein' ? C.mute : C.fg, 'left', C.acc); y += r.length * sz * 1.3 + sz * 0.8; });
    } else if (L === 'zahlen'){
      let y = kicker(px, py, sl.kicker);
      const tf = fit(ctx, sl.title || '', INTER(800), cw, (bottom - y) * 0.24, 6.5 * u, 3 * u, 1.08);
      if (sl.title){ ctx.font = INTER(800)(tf.size); y = drawText(ctx, tf, px, y, 1.08, C.fg, 'left', C.acc) + 5 * u; }
      const ps = pairs(sl.text).slice(0, 4), n = Math.max(1, ps.length), area = bottom - y;
      const cols = port ? 1 : W / H < 1.2 ? Math.min(2, n) : n, rowsN = Math.ceil(n / cols), gap = 4 * u;
      const cwid = (cw - gap * (cols - 1)) / cols, ch = (area - gap * (rowsN - 1)) / rowsN;
      let nsz = Infinity, tsz = Infinity;
      ps.forEach(([a, b]) => { nsz = Math.min(nsz, fit(ctx, a, INTER(900), cwid - 4 * u, ch * 0.5, 16 * u, 3 * u, 1).size); tsz = Math.min(tsz, fit(ctx, b, INTER(500), cwid - 4 * u, ch * 0.4, 3.8 * u, 1.6 * u, 1.3).size); });
      ps.forEach(([a, b], i) => { const x0 = px + (i % cols) * (cwid + gap), y0 = y + Math.floor(i / cols) * (ch + gap);
        ctx.fillStyle = C.soft; ctx.fillRect(x0, y0, cwid, ch); ctx.fillStyle = i === 0 ? C.acc : C.line; ctx.fillRect(x0, y0, 0.8 * u, ch);
        ctx.font = INTER(900)(nsz); const fa = {lines: wrap(ctx, a, cwid - 4 * u), size: nsz}; ctx.font = INTER(500)(tsz); const fb = {lines: wrap(ctx, b, cwid - 4 * u), size: tsz};
        const bh = fa.lines.length * nsz + (b ? 2 * u + fb.lines.length * tsz * 1.3 : 0); let yy = y0 + Math.max(2 * u, (ch - bh) / 2);
        ctx.font = INTER(900)(nsz); yy = drawText(ctx, fa, x0 + 3 * u, yy, 1, i === 0 ? C.acc : C.fg, 'left');
        if (b){ ctx.font = INTER(500)(tsz); drawText(ctx, fb, x0 + 3 * u, yy + 2 * u, 1.3, C.mute, 'left', C.acc); } });
    } else if (L === 'balken'){
      let y = kicker(px, py, sl.kicker);
      const tf = fit(ctx, sl.title || '', INTER(800), cw, (bottom - y) * 0.24, 6.5 * u, 3 * u, 1.08);
      if (sl.title){ ctx.font = INTER(800)(tf.size); y = drawText(ctx, tf, px, y, 1.08, C.fg, 'left', C.acc) + 5 * u; }
      const ps = pairs(sl.text).slice(0, 10).map(([a, b]) => ({hi: /^\*/.test(a), a: a.replace(/^\*\s*/, ''), b, v: num(b)}));
      const n = Math.max(1, ps.length), area = bottom - y, rowH = area / n, max = Math.max(1e-9, ...ps.map(p => isFinite(p.v) ? Math.abs(p.v) : 0));
      const lw = port ? cw : cw * 0.3, bx0 = port ? px : px + lw + 3 * u, bwid = port ? cw - 2 * u : cw - lw - 3 * u;
      let lsz = Infinity;
      ps.forEach(p => { lsz = Math.min(lsz, fit(ctx, p.a, INTER(600), port ? cw : lw, rowH * (port ? 0.38 : 0.7), 4 * u, 1.6 * u, 1.15).size); });
      const vsz = Math.min(lsz * 1.05, rowH * 0.45);
      ps.forEach((p, i) => { const y0 = y + i * rowH, bh = Math.min(rowH * (port ? 0.38 : 0.62), 9 * u), by = port ? y0 + rowH * 0.48 : y0 + (rowH - bh) / 2;
        ctx.font = INTER(600)(lsz); const fa = {lines: wrap(ctx, p.a, port ? cw : lw), size: lsz};
        drawText(ctx, fa, px, port ? y0 + rowH * 0.42 - fa.lines.length * lsz * 1.15 : y0 + (rowH - fa.lines.length * lsz * 1.15) / 2, 1.15, p.hi ? C.acc : C.fg, 'left');
        ctx.font = INTER(800)(vsz); const vw = ctx.measureText(p.b).width;
        const len = isFinite(p.v) ? Math.max(0.6 * u, (bwid - vw - 3 * u) * Math.abs(p.v) / max) : 0;
        ctx.fillStyle = p.hi ? C.acc : C.line; ctx.fillRect(bx0, by, len, bh);
        ctx.fillStyle = p.hi ? C.acc : C.fg; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillText(p.b, bx0 + len + 2 * u, by + bh / 2); ctx.textBaseline = 'alphabetic'; });
    } else if (L === 'anteil' || L === 'menschen'){
      let y = kicker(bx, top, sl.kicker);
      const area = bottom - y - 2 * u, side = W / H > 1.2;
      const gw = side ? Math.min(area, cw * 0.42) : Math.min(cw, area * 0.5), gh = side ? area : gw;
      const tx = side ? px + gw + 6 * u : px, tw = side ? cw - gw - 6 * u : cw;
      const gx = side ? px : CEN ? W / 2 - gw / 2 : px, gy = side ? y : y;
      // Wert lesen
      let part = NaN, whole = 100;
      const t = String(sl.title || '');
      const m = t.match(/(\d+(?:[.,]\d+)?)\s*(?:von|aus|\/|of)\s*(\d+(?:[.,]\d+)?)/i);
      if (m){ part = num(m[1]); whole = num(m[2]); } else if (/%|prozent/i.test(t)){ part = num(t); whole = 100; } else part = num(t);
      if (L === 'anteil'){
        const frac = isFinite(part) && whole > 0 ? Math.max(0, Math.min(1, part / whole)) : 0;
        const r = Math.min(gw, gh) / 2, cx = gx + gw / 2, cy = gy + gh / 2, th = r * 0.28;
        ctx.lineWidth = th; ctx.strokeStyle = C.line; ctx.beginPath(); ctx.arc(cx, cy, r - th / 2, 0, Math.PI * 2); ctx.stroke();
        if (frac > 0){ ctx.strokeStyle = C.acc; ctx.beginPath(); ctx.arc(cx, cy, r - th / 2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke(); }
        const lab = fit(ctx, plain(sl.title) || '0 %', INTER(900), (r - th) * 1.6, (r - th) * 0.9, 12 * u, 2 * u, 1);
        ctx.font = INTER(900)(lab.size); drawText(ctx, lab, cx, cy - lab.lines.length * lab.size / 2 - lab.size * 0.08, 1, C.fg, 'center');
      } else {
        let tot = Math.round(isFinite(whole) ? whole : 10), hit = Math.round(isFinite(part) ? part : 0);
        if (tot > 100){ hit = Math.round(hit / tot * 100); tot = 100; } tot = Math.max(1, tot); hit = Math.max(0, Math.min(tot, hit));
        let cols = Math.ceil(Math.sqrt(tot * gw / gh * 0.8)); cols = Math.max(1, Math.min(tot, cols)); const rowsN = Math.ceil(tot / cols);
        const cs = Math.min(gw / cols, gh / rowsN), s = cs * 0.92, ox = gx + (gw - cols * cs) / 2, oy = gy + (gh - rowsN * cs) / 2;
        for (let i = 0; i < tot; i++){ const x0 = ox + (i % cols) * cs, y0 = oy + Math.floor(i / cols) * cs; IC() && IC().draw(ctx, 'person', x0 + (cs - s) / 2, y0 + (cs - s) / 2, s, i < hit ? C.acc : C.line, null); }
      }
      // Text daneben/darunter
      const ty0 = side ? y : gy + gh + 4 * u, ta = side ? area : bottom - ty0;
      const hf = L === 'menschen' ? fit(ctx, sl.title || '', INTER(900), tw, ta * 0.4, 10 * u, 3 * u, 1.05) : {lines: [], size: 0};
      const xf = fit(ctx, sl.text || '', INTER(500), tw, ta - hf.lines.length * hf.size * 1.05 - 3 * u, 4.6 * u, 2 * u, 1.3);
      const bh = hf.lines.length * hf.size * 1.05 + (sl.text ? 3 * u + xf.lines.length * xf.size * 1.3 : 0);
      let yy = ty0 + Math.max(0, (ta - bh) / 2), al = !side && CEN ? 'center' : 'left', ax = al === 'center' ? W / 2 : tx;
      if (hf.lines.length){ ctx.font = INTER(900)(hf.size); yy = drawText(ctx, hf, ax, yy, 1.05, C.acc, al) + 3 * u; }
      if (sl.text){ ctx.font = INTER(500)(xf.size); drawText(ctx, xf, ax, yy, 1.3, C.fg, al, C.acc); }
    }
    footer();
  }

  // Passt die Folie in alle Formate? Gibt je Format {k, n, over, small} zurück (gezeichnet wird klein, das reicht zum Messen)
  async function check(sl, profile, opts = {}){
    const out = [];
    for (const f of (opts.formats || FORMATS)){
      const rep = {}, sc = 0.25;
      await render(sl, Math.round(f.W * sc), Math.round(f.H * sc), {...opts, profile, report: rep, imgUrl: () => null});
      out.push({k: f.k, n: f.n, over: !!rep.over, small: !!rep.small});
    }
    return out;
  }

  // ───────── Datenmodell ─────────
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  function newSlide(o = {}){ return {id: uid(), layout: 'titel', dark: null, kicker: '', title: '', text: '', text2: '', source: '', img: null, icons: [], a: null, b: null, cue: '', ...o}; }
  function newDeck(o = {}){ return {app: 'honeydeck', v: 1, id: uid(), name: 'Neue Präsentation', created: Date.now(), updated: Date.now(), format: '16:9', profile: JSON.parse(JSON.stringify(BUILTIN[0])), slides: [], source: null, ...o}; }
  // Folie bereinigen (unbekannte Felder bleiben erhalten, fehlende kommen dazu)
  function normSlide(s){ const n = newSlide(); for (const k in s) n[k] = s[k]; if (!LAYOUTS.some(x => x.k === n.layout)) n.layout = 'titel'; if (!Array.isArray(n.icons)) n.icons = []; return n; }
  function normDeck(d){
    if (!d || typeof d !== 'object') throw new Error('Keine HoneyDeck-Datei');
    const n = newDeck(); for (const k in d) n[k] = d[k];
    n.slides = (Array.isArray(d.slides) ? d.slides : []).map(normSlide);
    if (!n.profile || !n.profile.colors) n.profile = JSON.parse(JSON.stringify(BUILTIN.find(b => n.profile && b.id === n.profile.id) || BUILTIN[0]));
    if (!FORMATS.some(f => f.k === n.format)) n.format = '16:9';
    return n;
  }

  // ───────── Text → Folien ─────────
  // Folienart aus einem Textstück erraten (wie im HoneyCut-Reiter „Folien“, erweitert)
  function guess(text){
    const w = text.split(/\s+/).filter(Boolean).length;
    if (/[„“"»«]/.test(text) && w > 4) return 'zitat';
    if (/\b\d+\s*(von|aus)\s*\d+\b/i.test(text) && w <= 14) return 'menschen';
    if (/\d/.test(text) && w <= 10) return 'zahl';
    if (/\?\s*$/.test(text) && w <= 18) return 'frage';
    return 'titel';
  }
  function fromText(text, extra = {}){
    text = String(text || '').replace(/\s+/g, ' ').trim();
    const w = text.split(/\s+/).filter(Boolean), lay = guess(text);
    if (lay === 'zahl'){ const m = text.match(/[\d.,]+\s*(%|Prozent|Mio\.?|Millionen|Milliarden|Mrd\.?|€|Euro)?/); return newSlide({layout: lay, title: m ? m[0].trim().replace('Prozent', '%') : text, text, cue: text, ...extra}); }
    if (lay === 'menschen'){ const m = text.match(/\d+\s*(von|aus)\s*\d+/i); return newSlide({layout: lay, title: m[0], text, cue: text, ...extra}); }
    if (lay === 'zitat') return newSlide({layout: lay, text: text.replace(/[„“"»«]/g, ''), cue: text, ...extra});
    if (lay === 'frage') return newSlide({layout: lay, title: text, cue: text, ...extra});
    return w.length <= 14 ? newSlide({title: text, cue: text, ...extra}) : newSlide({title: w.slice(0, 9).join(' ') + ' …', text, cue: text, ...extra});
  }
  // Sätze zu Gruppen zusammenfassen: je Satz eine Folie, kurze Sätze zusammen (höchstens zwei)
  function sentences(text){
    return String(text || '').replace(/\r/g, '').split(/\n{2,}/).flatMap((para, p) =>
      (para.replace(/\n/g, ' ').match(/[^.!?…]+(?:[.!?…]+["“”»«)]*|$)/g) || []).map(s => ({t: s.trim(), p})).filter(s => s.t));
  }
  function group(sents){
    const groups = [];
    for (const x of sents){ const n = x.t.split(/\s+/).length, g = groups[groups.length - 1];
      if (g && g.p === x.p && (g.n < 6 || n < 5) && g.k < 2 && g.n + n <= 26){ g.t += ' ' + x.t; g.n += n; g.k++; } else groups.push({t: x.t, n, k: 1, p: x.p}); }
    return groups;
  }
  // Ganzer Text (Markdown verstanden) → Folien
  function textToSlides(src, opts = {}){
    const out = [], md = String(src || '').replace(/\r/g, '');
    let section = '', buf = [];
    const flushPara = () => { const t = buf.join('\n').trim(); buf = []; if (!t) return;
      if (opts.mode === 'absatz'){ out.push(fromText(t, {kicker: section})); return; }
      for (const g of group(sentences(t))) out.push(fromText(g.t, {kicker: section})); };
    const blocks = md.split('\n'); let list = null, quote = null;
    const flushList = () => { if (!list) return; const items = list.items; const title = list.title || '';
      const chk = items.every(i => /^[+✓✔−–-]/.test(i.raw));
      out.push(newSlide({layout: chk ? 'checkliste' : 'liste', kicker: section, title, text: items.map(i => chk ? i.raw : i.t).join('\n'), cue: items.map(i => i.t).join(' ')})); list = null; };
    const flushQuote = () => { if (!quote) return; const t = quote.join(' ').trim(); const m = t.match(/^(.*?)\s*[—–-]{1,2}\s*([^—–-]{2,60})$/);
      out.push(newSlide({layout: 'zitat', kicker: section, text: (m ? m[1] : t).replace(/^[„“"»]|[“”"«]$/g, ''), title: m ? m[2] : '', cue: t})); quote = null; };
    for (const raw of blocks){
      const l = raw.trim();
      if (/^#{1,6}\s/.test(l)){ flushPara(); flushList(); flushQuote(); const lvl = l.match(/^#+/)[0].length, t = l.replace(/^#+\s*/, '');
        if (lvl === 1) out.push(newSlide({layout: 'titel', title: t, cue: t}));
        else { section = t; if (opts.sectionSlides !== false) out.push(newSlide({layout: 'titel', kicker: 'Kapitel', title: t, cue: t})); }
        continue; }
      const li = l.match(/^([-*•]|\d+[.)])\s+(.*)$/) || l.match(/^([+✓✔✗−–])\s*(.+)$/);
      if (li){ flushPara(); flushQuote(); if (!list){ const prev = out.length ? null : null; list = {items: [], title: prev}; }
        const sign = li[1]; list.items.push({t: li[2].replace(/\*\*/g, ''), raw: (/^[+✓✔]/.test(sign) ? '+ ' : /^[✗−–]/.test(sign) ? '- ' : '') + li[2]}); continue; }
      if (/^>\s?/.test(l)){ flushPara(); flushList(); (quote ||= []).push(l.replace(/^>\s?/, '')); continue; }
      if (!l){ flushPara(); flushList(); flushQuote(); continue; }
      flushList(); flushQuote();
      // „Begriff: Erklärung“ als eigene Zeile
      const def = l.match(/^\*\*(.+?)\*\*\s*[:–—-]\s*(.+)$/);
      if (def){ flushPara(); out.push(newSlide({layout: 'begriff', kicker: section, title: def[1], text: def[2], cue: l.replace(/\*\*/g, '')})); continue; }
      buf.push(l.replace(/\*\*(.+?)\*\*/g, '*$1*'));
    }
    flushPara(); flushList(); flushQuote();
    // Symbole vorschlagen
    if (opts.autoIcons !== false && IC()) for (const s of out){ if (layout(s.layout).icon === 'one' && !s.icons.length){ const sg = IC().suggest(plain(s.title + ' ' + s.text), 6); if (sg.length && s.layout !== 'zitat') s.icons = [sg[0]]; } }
    return out;
  }
  // Untertitel (.srt/.vtt) → reiner Text mit Absätzen bei längeren Pausen
  function subsToText(src){
    const blocks = String(src || '').replace(/\r/g, '').split(/\n{2,}/); let out = '', last = null;
    const ts = s => { const m = s.match(/(\d+):(\d+):(\d+)[,.](\d+)/) || s.match(/(\d+):(\d+)[,.](\d+)/); if (!m) return null; return m.length === 5 ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : +m[1] * 60 + +m[2] + +m[3] / 1000; };
    for (const b of blocks){ const ls = b.split('\n').filter(x => x.trim() && !/^WEBVTT/.test(x) && !/^\d+$/.test(x.trim()));
      const tl = ls.find(x => x.includes('-->')); if (!tl) continue; const [a, e] = tl.split('-->').map(ts);
      const t = ls.filter(x => x !== tl).join(' ').replace(/<[^>]+>/g, '').trim(); if (!t) continue;
      out += (last != null && a - last > 1.5 ? '\n\n' : out ? ' ' : '') + t; last = e; }
    return out;
  }
  // Text einer Folie (für die Zuordnung zum Transkript)
  const slideText = s => plain(s.cue ? s.cue : [s.title, s.text, s.text2].filter(Boolean).join(' '));

  // Stelle im Transkript finden, die am besten zum Folientext passt.
  // tokens: [{i, w}] (w = Wort), from = frühestes Wort (Reihenfolge der Folien bleibt erhalten). Rückgabe {a, b, score} oder null.
  function matchCue(text, tokens, from = 0){
    const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ß]+/g, '');
    const q = String(text || '').split(/\s+/).map(norm).filter(Boolean).slice(0, 60);
    if (!q.length || !tokens.length) return null;
    const words = tokens.map(t => norm(t.w));
    let best = null;
    for (let s = 0; s < tokens.length; s++){
      if (tokens[s].i < from) continue;
      // Anfang: eines der ersten drei Suchwörter
      const q0 = q.slice(0, 3).indexOf(words[s]); if (q0 < 0) continue;
      let qi = q0 + 1, hit = 1, last = s, j = s + 1, miss = 0;
      while (qi < q.length && j < tokens.length && miss <= 3){
        if (words[j] === q[qi]){ hit++; last = j; qi++; j++; miss = 0; continue; }
        // ein Wort im Transkript zu viel oder eins in der Suche
        if (q[qi + 1] && words[j] === q[qi + 1]){ qi++; continue; }
        if (words[j + 1] === q[qi]){ j++; miss++; continue; }
        qi++; j++; miss++;
      }
      const score = hit / q.length;
      if (!best || score > best.score + 1e-9) best = {a: tokens[s].i, b: tokens[last].i, score};
      if (score >= 0.999) break;
    }
    return best && best.score >= (q.length <= 3 ? 0.99 : 0.55) ? best : null;
  }

  G.HoneyDeck = {version: '1.0.0', LAYOUTS, LBL, layout, FORMATS, format, BUILTIN, FONT_CHOICES, colors, isDark, mix, fonts, render, check,
    newSlide, newDeck, normSlide, normDeck, guess, fromText, textToSlides, sentences, group, subsToText, slideText, matchCue, plain, uid, loadImg};
})();
