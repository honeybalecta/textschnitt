'use strict';
/* HoneyRec: Dokumente auf der Medienbühne – PDF (pdf.js), Textdateien und als Ersatz Word/PowerPoint/OpenDocument ohne Office.
   Jedes Dokument besteht aus Seiten. Eine Seite wird in eine Leinwand gezeichnet (Bühne) oder als Bild abgelegt (Einblendung im Projekt).
   Links (PDF-Verweise, Adressen im Text) liefert links(i) als Rechtecke in Anteilen der Seite. */
(() => {
  const EXT = s => (String(s || '').toLowerCase().match(/\.([a-z0-9]+)(?:$|\?)/) || [])[1] || '';
  const TEXT = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'srt', 'vtt', 'html', 'htm', 'xml', 'rtf'];
  const OFFICE = ['docx', 'doc', 'odt', 'rtf', 'pptx', 'ppt', 'odp', 'pps', 'ppsx', 'key', 'pages', 'xlsx', 'xls', 'ods'];
  const SLIDES = ['pptx', 'ppt', 'odp', 'pps', 'ppsx', 'key'];
  function kindOf(m){
    const e = EXT(m.name) || EXT(m.uri), mime = String(m.mime || '');
    if (e === 'pdf' || mime === 'application/pdf') return 'pdf';
    if (e === 'rtf') return 'office';
    if (TEXT.includes(e) || mime.startsWith('text/')) return 'text';
    if (OFFICE.includes(e) || /officedocument|msword|ms-powerpoint|ms-excel|opendocument/.test(mime)) return 'office';
    return null;
  }
  const isSlides = m => SLIDES.includes(EXT(m.name) || EXT(m.uri)) || /presentation|powerpoint/.test(String(m.mime || ''));

  // ── pdf.js (als Modul, mit eigenem Worker) ──
  let pdfLib = null;
  async function pdfjs(){
    if (!pdfLib){ pdfLib = await import(new URL('vendor/pdf.min.mjs', document.baseURI).href);
      pdfLib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.mjs', document.baseURI).href; }
    return pdfLib;
  }
  async function pdfDoc(buf){
    const lib = await pdfjs(), pdf = await lib.getDocument({data: new Uint8Array(buf), isEvalSupported: false, useSystemFonts: true}).promise;
    const doc = {
      type: 'pdf', n: pdf.numPages,
      async size(i){ const v = (await pdf.getPage(i + 1)).getViewport({scale: 1}); return [v.width, v.height]; },
      // Seite i eingepasst in eine Leinwand W×H zeichnen (Hintergrund weiß hinter der Seite); Rückgabe: Rechteck der Seite
      async draw(i, cv, W, H, bg){
        const page = await pdf.getPage(i + 1), v0 = page.getViewport({scale: 1}), s = Math.min(W / v0.width, H / v0.height), v = page.getViewport({scale: s});
        const x = Math.round((W - v.width) / 2), y = Math.round((H - v.height) / 2);
        cv.width = W; cv.height = H; const g = cv.getContext('2d');
        g.fillStyle = bg || '#000'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff'; g.fillRect(x, y, Math.ceil(v.width), Math.ceil(v.height));
        if (cv._task) try { cv._task.cancel(); } catch(_){}
        const task = cv._task = page.render({canvasContext: g, viewport: v, transform: [1, 0, 0, 1, x, y]});
        try { await task.promise; } catch(e){ if (e && e.name === 'RenderingCancelledException') return null; throw e; }
        if (cv._task === task) cv._task = null; return {x, y, w: v.width, h: v.height};
      },
      async links(i){
        const page = await pdf.getPage(i + 1), v = page.getViewport({scale: 1}), out = [];
        for (const a of await page.getAnnotations({intent: 'display'})){
          if (a.subtype !== 'Link' || !a.rect) continue;
          const [ta, tb, tc, td, te, tf] = v.transform, pt = (x, y) => [ta * x + tc * y + te, tb * x + td * y + tf];   // Seitenpunkte → Bildpunkte
          const [x1, y1] = pt(a.rect[0], a.rect[1]), [x2, y2] = pt(a.rect[2], a.rect[3]), r = [Math.min(x1, x2) / v.width, Math.min(y1, y2) / v.height, Math.abs(x2 - x1) / v.width, Math.abs(y2 - y1) / v.height];
          if (a.url || a.unsafeUrl){ out.push({r, url: a.url || a.unsafeUrl}); continue; }
          if (a.dest) try { const d = typeof a.dest === 'string' ? await pdf.getDestination(a.dest) : a.dest; if (d && d[0]) out.push({r, page: typeof d[0] === 'number' ? d[0] : await pdf.getPageIndex(d[0])}); } catch(_){}
        }
        return out;
      },
    };
    return doc;
  }

  // ── Text auf Seiten (1920×1080, Creme, Inter) ──
  const PW = 1920, PH = 1080, MX = 130, MY = 110, FS = 44, LH = 1.42;
  const URLRE = /\bhttps?:\/\/[^\s<>"')\]]+|\bwww\.[^\s<>"')\]]+/i;
  function layout(blocks, title, slides){
    const cv = document.createElement('canvas'), g = cv.getContext('2d'), pages = [];
    const font = (h, sz) => `${h ? 700 : 450} ${sz}px Inter, system-ui, sans-serif`;
    let cur = [], y = MY + 70;
    const push = () => { pages.push(cur); cur = []; y = MY + 70; };
    for (const b of blocks){
      if (b.page && cur.length) push();
      if (b.page) continue;
      const sz = b.h ? Math.round(FS * 1.35) : FS, lh = sz * LH; g.font = font(b.h, sz);
      if (!b.t.trim()){ y += lh * 0.5; continue; }
      const words = b.t.split(/\s+/); let line = '';
      const out = l => { if (y + lh > PH - MY){ push(); } cur.push({t: l, h: b.h, sz, y, url: (l.match(URLRE) || [])[0] || ''}); y += lh; };
      for (const w of words){ const t = line ? line + ' ' + w : w; if (g.measureText(t).width > PW - 2 * MX && line){ out(line); line = w; } else line = t; }
      if (line) out(line);
      if (b.h) y += lh * 0.2;
    }
    if (cur.length || !pages.length) pages.push(cur);
    return {pages, title, slides};
  }
  function textDoc(L, note){
    return {
      type: 'text', n: L.pages.length, note,
      async size(){ return [PW, PH]; },
      async draw(i, cv, W, H, bg){
        const s = Math.min(W / PW, H / PH), x = Math.round((W - PW * s) / 2), y = Math.round((H - PH * s) / 2);
        cv.width = W; cv.height = H; const g = cv.getContext('2d');
        g.fillStyle = bg || '#000'; g.fillRect(0, 0, W, H);
        g.save(); g.translate(x, y); g.scale(s, s);
        g.fillStyle = '#EDE7DA'; g.fillRect(0, 0, PW, PH);
        g.fillStyle = '#5E584D'; g.font = '600 26px Inter, system-ui, sans-serif'; g.textBaseline = 'top';
        g.fillText(`${L.title}${L.pages.length > 1 ? ` · ${L.slides ? 'Folie' : 'Seite'} ${i + 1} von ${L.pages.length}` : ''}`, MX, MY - 30);
        for (const l of L.pages[i] || []){
          g.font = `${l.h ? 700 : 450} ${l.sz}px Inter, system-ui, sans-serif`; g.fillStyle = l.url ? '#B8301D' : '#131312';
          g.fillText(l.t, MX, l.y + 30);
        }
        g.restore(); return {x, y, w: PW * s, h: PH * s};
      },
      async links(i){ return (L.pages[i] || []).filter(l => l.url).map(l => ({r: [MX / PW, (l.y + 30) / PH, (PW - 2 * MX) / PW, l.sz * LH / PH], url: /^www\./i.test(l.url) ? 'https://' + l.url : l.url})); },
    };
  }
  const titleOf = m => String(m.name || 'Dokument').replace(/\.[^.]+$/, '');
  function textBlocks(txt, ext){
    if (ext === 'html' || ext === 'htm'){ const d = new DOMParser().parseFromString(txt, 'text/html'); return [...d.body.querySelectorAll('h1,h2,h3,h4,p,li,pre,td')].map(e => ({t: (e.tagName === 'LI' ? '• ' : '') + e.textContent.replace(/\s+/g, ' ').trim(), h: /^H\d$/.test(e.tagName)})); }
    if (ext === 'rtf') txt = txt.replace(/\\par[d]?/g, '\n').replace(/\{\\\*[^{}]*\}|\\[a-z]+-?\d* ?|[{}]/gi, '');
    return txt.replace(/\r\n?/g, '\n').split('\n').map(l => { const m = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(l); return m ? {t: m[2], h: true} : {t: l.replace(/\t/g, '    '), h: false}; });
  }

  // ── ZIP lesen (Word, PowerPoint, OpenDocument) ohne Bibliothek: Verzeichnis am Ende, Inhalte per DecompressionStream ──
  async function unzip(buf){
    const u8 = new Uint8Array(buf), dv = new DataView(buf); let e = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50){ e = i; break; }
    if (e < 0) throw new Error('Die Datei ist kein lesbares Office-Dokument');
    const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const files = new Map(), td = new TextDecoder();
    for (let k = 0; k < n; k++){
      const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
      files.set(td.decode(u8.subarray(p + 46, p + 46 + nl)), {method, csize, off}); p += 46 + nl + xl + cl;
    }
    const read = async name => {
      const f = files.get(name); if (!f) return null;
      const start = f.off + 30 + dv.getUint16(f.off + 26, true) + dv.getUint16(f.off + 28, true), data = u8.subarray(start, start + f.csize);
      if (f.method === 0) return td.decode(data);
      const s = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(s).text();
    };
    return {names: [...files.keys()], read};
  }
  const xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const byTag = (el, tag) => [...el.getElementsByTagName(tag)];
  async function officeBlocks(buf, m){
    const z = await unzip(buf), names = z.names;
    if (names.includes('word/document.xml')){
      const d = xml(await z.read('word/document.xml'));
      return {blocks: byTag(d, 'w:p').map(p => { const st = (byTag(p, 'w:pStyle')[0] || {getAttribute: () => ''}).getAttribute('w:val') || '';
        return {t: byTag(p, 'w:t').map(t => t.textContent).join(''), h: /heading|berschrift|title|titel/i.test(st)}; })};
    }
    const sl = names.filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
    if (sl.length){
      const blocks = [];
      for (const n of sl){ const d = xml(await z.read(n)); blocks.push({page: true});
        byTag(d, 'a:p').forEach((p, k) => { const t = byTag(p, 'a:t').map(x => x.textContent).join(''); if (t.trim()) blocks.push({t, h: k === 0}); }); }
      return {blocks, slides: true};
    }
    if (names.includes('content.xml')){
      const d = xml(await z.read('content.xml')), pages = byTag(d, 'draw:page');
      if (pages.length){ const blocks = []; for (const pg of pages){ blocks.push({page: true}); byTag(pg, 'text:p').forEach((p, k) => { if (p.textContent.trim()) blocks.push({t: p.textContent, h: k === 0}); }); } return {blocks, slides: true}; }
      return {blocks: [...d.getElementsByTagName('*')].filter(e => e.tagName === 'text:h' || e.tagName === 'text:p').map(e => ({t: e.textContent, h: e.tagName === 'text:h'}))};
    }
    throw new Error('Dieses Format lässt sich hier nur als PDF zeigen');
  }

  // Dokument laden. opt.convert(m) → Promise<Medium als PDF> (Windows: Office oder LibreOffice), sonst vereinfachte Textansicht
  async function load(m, MEDIA, opt = {}){
    const k = kindOf(m);
    const bytes = async u => { const r = await fetch(MEDIA(u)); if (!r.ok) throw new Error('Die Datei ließ sich nicht lesen'); return r.arrayBuffer(); };
    if (k === 'pdf') return pdfDoc(await bytes(m.uri));
    if (k === 'text'){ const ext = EXT(m.name) || EXT(m.uri); return textDoc(layout(textBlocks(new TextDecoder().decode(await bytes(m.uri)), ext), titleOf(m), false)); }
    if (k === 'office'){
      if (opt.convert){ try { const pdf = await opt.convert(m); if (pdf && pdf.uri){ const d = await pdfDoc(await bytes(pdf.uri)); d.pdf = pdf; return d; } } catch(e){ if (opt.onConvertFail) opt.onConvertFail(e); } }
      const buf = await bytes(m.uri);
      if (EXT(m.name) === 'rtf') return textDoc(layout(textBlocks(new TextDecoder().decode(buf), 'rtf'), titleOf(m), false), 'vereinfacht');
      const o = await officeBlocks(buf, m);
      return textDoc(layout(o.blocks, titleOf(m), !!o.slides), 'vereinfacht');
    }
    throw new Error('Dieses Format kennt HoneyRec nicht');
  }
  window.RecDocs = {kindOf, isSlides, load, EXT};
})();
