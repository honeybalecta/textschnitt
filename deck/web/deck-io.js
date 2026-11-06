'use strict';
/* HoneyDeck – Ein- und Ausgabe ohne fremde Bibliotheken:
   ZIP lesen/schreiben, PDF schreiben, Bilder verkleinern,
   Importe: .honeydeck, Text/Markdown, Untertitel, Word (.docx), PowerPoint (.pptx), HTML-Folien, Bilder. */
(function(){
  const G = window, D = () => G.HoneyDeck;

  // ───────── CRC32 / ZIP ─────────
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const enc = new TextEncoder(), dec = new TextDecoder();
  // Dateien gespeichert (ohne Kompression – PNG/JPEG sind schon komprimiert)
  function zip(files){   // files: [{name, data: Uint8Array}]
    const parts = [], cen = []; let off = 0;
    const d = new Date(), dt = ((d.getFullYear() - 1980) << 25) | ((d.getMonth() + 1) << 21) | (d.getDate() << 16) | (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    for (const f of files){
      const nm = enc.encode(f.name), data = f.data, crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint32(10, dt, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nm.length, true);
      parts.push(new Uint8Array(h.buffer), nm, data);
      const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true);
      c.setUint32(12, dt, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true); c.setUint16(28, nm.length, true); c.setUint32(42, off, true);
      cen.push(new Uint8Array(c.buffer), nm);
      off += 30 + nm.length + data.length;
    }
    const csz = cen.reduce((n, p) => n + p.length, 0);
    const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csz, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...cen, new Uint8Array(e.buffer)], {type: 'application/zip'});
  }
  async function inflate(data){
    const ds = new DecompressionStream('deflate-raw'); const s = new Blob([data]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  // ZIP lesen → Map(name → async () => Uint8Array)
  function unzip(buf){
    const b = new Uint8Array(buf), v = new DataView(b.buffer, b.byteOffset, b.byteLength), out = new Map();
    let e = b.length - 22; while (e >= 0 && v.getUint32(e, true) !== 0x06054b50) e--;
    if (e < 0) throw new Error('Keine gültige ZIP-Datei');
    const n = v.getUint16(e + 10, true); let p = v.getUint32(e + 16, true);
    for (let i = 0; i < n; i++){
      if (v.getUint32(p, true) !== 0x02014b50) break;
      const meth = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true), nl = v.getUint16(p + 28, true), xl = v.getUint16(p + 30, true), cl = v.getUint16(p + 32, true), lo = v.getUint32(p + 42, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nl));
      const start = lo + 30 + v.getUint16(lo + 26, true) + v.getUint16(lo + 28, true), raw = b.subarray(start, start + csize);
      out.set(name, async () => meth === 0 ? raw : meth === 8 ? inflate(raw) : Promise.reject(new Error('Kompression nicht unterstützt')));
      p += 46 + nl + xl + cl;
    }
    return out;
  }
  const zipText = async (z, name) => { const f = z.get(name); return f ? dec.decode(await f()) : null; };

  // ───────── PDF (eine Seite je Folie, Bild als JPEG) ─────────
  function pdf(pages, wPt, hPt){   // pages: [{jpeg: Uint8Array, w, h}]
    const objs = []; const add = s => { objs.push(s); return objs.length; };
    const catalog = add(null), pagesObj = add(null), kids = [];
    for (const pg of pages){
      const img = add({head: `<< /Type /XObject /Subtype /Image /Width ${pg.w} /Height ${pg.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${pg.jpeg.length} >>`, stream: pg.jpeg});
      const cs = enc.encode(`q ${wPt} 0 0 ${hPt} 0 0 cm /Im0 Do Q`);
      const content = add({head: `<< /Length ${cs.length} >>`, stream: cs});
      kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${wPt} ${hPt}] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${content} 0 R >>`));
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`;
    const chunks = [enc.encode('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')]; let len = chunks[0].length; const xref = [];
    objs.forEach((o, i) => {
      xref.push(len);
      const parts = typeof o === 'string' ? [enc.encode(`${i + 1} 0 obj\n${o}\nendobj\n`)] : [enc.encode(`${i + 1} 0 obj\n${o.head}\nstream\n`), o.stream, enc.encode('\nendstream\nendobj\n')];
      for (const p of parts){ chunks.push(p); len += p.length; }
    });
    const x = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + xref.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('') + `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${len}\n%%EOF`;
    chunks.push(enc.encode(x));
    return new Blob(chunks, {type: 'application/pdf'});
  }
  const canvasBytes = (cv, type = 'image/png', q = 0.92) => new Promise(res => cv.toBlob(b => b.arrayBuffer().then(a => res(new Uint8Array(a))), type, q));

  // ───────── Bilder ─────────
  const readAs = (file, how) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r[how](file); });
  const bytesToDataUrl = (bytes, mime) => readAs(new Blob([bytes], {type: mime}), 'readAsDataURL');
  // Großes Bild verkleinern (längste Kante max), Ergebnis als data-URL
  async function shrinkImage(src, max = 2400){
    const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Bild konnte nicht gelesen werden')); i.src = src; });
    const f = Math.min(1, max / Math.max(im.width, im.height));
    if (f >= 1 && src.length < 3e6) return src;
    const c = document.createElement('canvas'); c.width = Math.round(im.width * f); c.height = Math.round(im.height * f);
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
    return c.toDataURL(/png/.test(src.slice(0, 30)) ? 'image/png' : 'image/jpeg', 0.88);
  }
  const mimeOf = n => ({png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml'})[String(n).split('.').pop().toLowerCase()] || 'application/octet-stream';

  // ───────── XML-Hilfen ─────────
  const xml = s => new DOMParser().parseFromString(s, 'application/xml');
  const byTag = (n, tag) => [...n.getElementsByTagName(tag)];

  // ───────── Word (.docx) → Markdown-Text ─────────
  async function docxToText(buf){
    const z = unzip(buf), s = await zipText(z, 'word/document.xml'); if (!s) throw new Error('Kein Word-Dokument');
    const doc = xml(s), out = [];
    for (const p of byTag(doc, 'w:p')){
      const style = (byTag(p, 'w:pStyle')[0] || null), sv = style ? style.getAttribute('w:val') || '' : '';
      let t = ''; for (const n of p.getElementsByTagName('*')){ if (n.tagName === 'w:t') t += n.textContent; else if (n.tagName === 'w:tab') t += ' '; else if (n.tagName === 'w:br') t += '\n'; }
      t = t.trim();
      if (!t){ out.push(''); continue; }
      const h = sv.match(/(?:heading|berschrift|title|titel)\s*(\d)?/i);
      if (h) out.push('', '#'.repeat(/title|titel/i.test(sv) ? 1 : Math.min(3, +(h[1] || 1) + 1)) + ' ' + t, '');
      else if (byTag(p, 'w:numPr').length || /list/i.test(sv)) out.push('- ' + t);
      else out.push(t, '');
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // ───────── PowerPoint (.pptx) → Folien ─────────
  async function pptxToSlides(buf){
    const z = unzip(buf), H = D();
    const pres = xml(await zipText(z, 'ppt/presentation.xml') || '<x/>'), prels = xml(await zipText(z, 'ppt/_rels/presentation.xml.rels') || '<x/>');
    const rel = {}; byTag(prels, 'Relationship').forEach(r => rel[r.getAttribute('Id')] = r.getAttribute('Target'));
    let order = byTag(pres, 'p:sldId').map(s => rel[s.getAttribute('r:id')]).filter(Boolean).map(t => 'ppt/' + t.replace(/^\/?ppt\//, '').replace(/^\.\.\//, ''));
    if (!order.length) order = [...z.keys()].filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => +a.match(/\d+/)[0] - +b.match(/\d+/)[0]);
    const sz = byTag(pres, 'p:sldSz')[0], ratio = sz ? +sz.getAttribute('cx') / +sz.getAttribute('cy') : 16 / 9;
    const slides = [];
    for (const path of order){
      const s = await zipText(z, path); if (!s) continue;
      const doc = xml(s), dir = path.replace(/[^/]+$/, ''), relp = dir + '_rels/' + path.split('/').pop() + '.rels';
      const srel = {}; const rx = await zipText(z, relp); if (rx) byTag(xml(rx), 'Relationship').forEach(r => srel[r.getAttribute('Id')] = r.getAttribute('Target'));
      const boxes = [], pics = [];
      for (const sp of byTag(doc, 'p:sp')){
        const ph = byTag(sp, 'p:ph')[0], type = ph ? ph.getAttribute('type') || 'body' : '';
        const off = byTag(sp, 'a:off')[0], y = off ? +off.getAttribute('y') : 0, x = off ? +off.getAttribute('x') : 0;
        const paras = byTag(sp, 'a:p').map(p => { const lvl = +((byTag(p, 'a:pPr')[0] || {getAttribute: () => 0}).getAttribute('lvl') || 0);
          const runs = byTag(p, 'a:r'); const t = runs.map(r => (byTag(r, 'a:t')[0] || {}).textContent || '').join('').trim();
          const szs = byTag(p, 'a:rPr').map(r => +(r.getAttribute('sz') || 0)).filter(Boolean); const bu = byTag(p, 'a:buChar').length + byTag(p, 'a:buAutoNum').length;
          return {t, lvl, sz: szs.length ? Math.max(...szs) : 0, bu}; }).filter(p => p.t);
        if (paras.length) boxes.push({type, y, x, paras, sz: Math.max(...paras.map(p => p.sz)), text: paras.map(p => p.t).join('\n')});
      }
      for (const pic of byTag(doc, 'p:pic')){
        const bl = byTag(pic, 'a:blip')[0], id = bl && (bl.getAttribute('r:embed')); const t = id && srel[id]; if (!t) continue;
        const ext = byTag(pic, 'a:ext')[0], area = ext ? +ext.getAttribute('cx') * +ext.getAttribute('cy') : 0;
        const p = (dir + t).split('/'), st = []; for (const seg of p){ if (seg === '..') st.pop(); else if (seg !== '.') st.push(seg); }
        const name = st.join('/'), f = z.get(name); if (!f || /\.(emf|wmf)$/i.test(name)) continue;
        pics.push({area, url: await shrinkImage(await bytesToDataUrl(await f(), mimeOf(name)))});
      }
      boxes.sort((a, b) => a.y - b.y || a.x - b.x);
      const sl = mapBoxes(boxes, pics, H);
      if (sl) slides.push(sl);
    }
    return {slides, format: ratio < 0.9 ? '9:16' : ratio < 1.1 ? '1:1' : ratio < 1.5 ? '4:3' : '16:9'};
  }
  // Textkästen einer Folie (oben → unten) einer Folienart zuordnen
  function mapBoxes(boxes, pics, H){
    const big = pics.sort((a, b) => b.area - a.area)[0];
    const src = boxes.find(b => /^\s*(quelle|source)\s*:/i.test(b.text)); const rest = boxes.filter(b => b !== src);
    const source = src ? src.text.replace(/^\s*(quelle|source)\s*:\s*/i, '').replace(/\n/g, ' ') : '';
    const titleBox = rest.find(b => /title/i.test(b.type)) || rest.slice().sort((a, b) => b.sz - a.sz || a.y - b.y)[0];
    const kickerBox = rest.find(b => b !== titleBox && b.y <= (titleBox ? titleBox.y : 0) && b.text.length <= 40 && !b.text.includes('\n') && (b.text === b.text.toUpperCase() || b.sz && titleBox && b.sz < titleBox.sz * 0.6));
    const body = rest.filter(b => b !== titleBox && b !== kickerBox);
    const title = titleBox ? titleBox.text.replace(/\n/g, ' ') : '', paras = body.flatMap(b => b.paras);
    const kicker = kickerBox ? kickerBox.text : '';
    if (!title && !paras.length) return big ? H.newSlide({layout: 'vollbild', img: big.url, source}) : null;
    if (big && big.area > 0) return H.newSlide({layout: title || paras.length ? 'bild' : 'vollbild', kicker, title, text: paras.map(p => p.t).join(' '), img: big.url, source, cue: title});
    if (/^[„“"»]/.test(title) || (!title && paras.length === 1 && /^[„“"»]/.test(paras[0].t))){
      const q = (title || paras[0].t).replace(/^[„“"»]|[“”"«]$/g, ''); return H.newSlide({layout: 'zitat', text: q, title: title ? paras.map(p => p.t).join(' ').replace(/^[—–-]\s*/, '') : '', source, cue: q}); }
    if (/^[-+]?[\d.,]+\s*(%|prozent|mio\.?|mrd\.?|€)?$/i.test(title.trim())) return H.newSlide({layout: 'zahl', kicker, title, text: paras.map(p => p.t).join(' '), source, cue: paras.map(p => p.t).join(' ')});
    if (paras.length >= 2 && (paras.some(p => p.bu) || paras.every(p => p.t.length < 120))) return H.newSlide({layout: 'liste', kicker, title, text: paras.map(p => p.t).join('\n'), source, cue: title});
    return H.newSlide({layout: 'titel', kicker, title: title || paras.map(p => p.t).join(' '), text: title ? paras.map(p => p.t).join(' ') : '', source, cue: title});
  }

  // ───────── HTML-Folien → Folien ─────────
  async function htmlToSlides(text){
    const H = D(), doc = new DOMParser().parseFromString(text, 'text/html');
    doc.querySelectorAll('script,style,noscript,template').forEach(n => n.remove());
    let secs = [...doc.querySelectorAll('section, .slide, [data-slide], article')].filter(n => !n.parentElement.closest('section, .slide, [data-slide], article'));
    if (secs.length < 2) return null;
    const out = [];
    for (const s of secs){
      const t = q => s.querySelector(q), txt = n => n ? n.textContent.replace(/\s+/g, ' ').trim() : '';
      const kickerEl = t('[class*=kicker],[class*=eyebrow],[class*=rubrik],[class*=label],[class*=overline],[class*=tag]');
      const h = t('h1') || t('h2') || t('h3'), srcEl = [...s.querySelectorAll('p,small,footer,div,span')].find(n => /^\s*(quelle|source)\s*:/i.test(n.textContent) && n.textContent.length < 300);
      const source = srcEl ? txt(srcEl).replace(/^(quelle|source)\s*:\s*/i, '') : '';
      const lis = [...s.querySelectorAll('li')].map(txt).filter(Boolean), bq = t('blockquote'), im = t('img'), num = t('[class*=num],[class*=stat],[class*=big],[class*=zahl]');
      const paras = [...s.querySelectorAll('p')].filter(p => p !== srcEl && !p.closest('blockquote,li') && p !== kickerEl).map(txt).filter(Boolean);
      const kicker = kickerEl && kickerEl !== h ? txt(kickerEl) : '';
      let img = null; if (im && /^data:/.test(im.getAttribute('src') || '')) img = await shrinkImage(im.getAttribute('src'));
      let sl;
      if (bq){ const cite = t('cite, figcaption'); sl = H.newSlide({layout: 'zitat', text: txt(bq).replace(/^[„“"»]|[“”"«]$/g, ''), title: cite ? txt(cite).replace(/^[—–-]\s*/, '') : '', source}); }
      else if (num && /\d/.test(txt(num)) && txt(num).length < 16) sl = H.newSlide({layout: 'zahl', kicker, title: txt(num), text: paras.join(' ') || (h ? txt(h) : ''), source});
      else if (img) sl = H.newSlide({layout: h || paras.length ? 'bild' : 'vollbild', kicker, title: txt(h), text: paras.join(' '), img, source});
      else if (lis.length) sl = H.newSlide({layout: 'liste', kicker, title: txt(h), text: lis.join('\n'), source});
      else sl = H.newSlide({layout: 'titel', kicker, title: txt(h) || paras.shift() || '', text: paras.join(' '), source});
      sl.cue = H.plain(sl.title || sl.text); out.push(sl);
    }
    return out;
  }
  // HTML ohne Folienstruktur → Text mit Überschriften
  function htmlToText(text){
    const doc = new DOMParser().parseFromString(text, 'text/html'); doc.querySelectorAll('script,style,noscript,nav,header,footer').forEach(n => n.remove());
    const out = [];
    doc.body && doc.body.querySelectorAll('h1,h2,h3,p,li,blockquote').forEach(n => { const t = n.textContent.replace(/\s+/g, ' ').trim(); if (!t) return;
      out.push(n.tagName === 'H1' ? '# ' + t : /H[23]/.test(n.tagName) ? '## ' + t : n.tagName === 'LI' ? '- ' + t : n.tagName === 'BLOCKQUOTE' ? '> ' + t : t, n.tagName === 'LI' ? '' : ''); });
    return out.join('\n').replace(/\n{3,}/g, '\n\n');
  }

  // ───────── Datei → Importergebnis ─────────
  // Rückgabe: {kind:'deck', deck} | {kind:'slides', slides, format?} | {kind:'text', text, name, transcript?:bool}
  async function importFile(file){
    const name = file.name || 'Datei', ext = name.split('.').pop().toLowerCase(), H = D();
    if (ext === 'honeydeck' || ext === 'json'){
      const j = JSON.parse(await readAs(file, 'readAsText'));
      if (j.app === 'honeydeck') return {kind: 'deck', deck: H.normDeck(j)};
      if (Array.isArray(j.slides) && (j.words || j.tokens || j.media || j.items)){   // HoneyCut-Projekt
        const words = (j.words || j.tokens || []).filter(w => w && (w.w || w.text || w.word)).map(w => (w.w || w.text || w.word).trim());
        return {kind: 'slides', slides: j.slides.map(H.normSlide), text: words.join(' '), name};
      }
      if (Array.isArray(j)) return {kind: 'slides', slides: j.map(H.normSlide)};
      throw new Error('Unbekanntes Dateiformat');
    }
    if (ext === 'txt' || ext === 'md' || ext === 'markdown') return {kind: 'text', text: await readAs(file, 'readAsText'), name};
    if (ext === 'srt' || ext === 'vtt') return {kind: 'text', text: H.subsToText(await readAs(file, 'readAsText')), name, transcript: true};
    if (ext === 'docx') return {kind: 'text', text: await docxToText(await readAs(file, 'readAsArrayBuffer')), name};
    if (ext === 'pptx'){ const r = await pptxToSlides(await readAs(file, 'readAsArrayBuffer')); return {kind: 'slides', slides: r.slides, format: r.format, name}; }
    if (ext === 'html' || ext === 'htm'){ const t = await readAs(file, 'readAsText'); const sl = await htmlToSlides(t); return sl ? {kind: 'slides', slides: sl, name} : {kind: 'text', text: htmlToText(t), name}; }
    if (/^(png|jpe?g|webp|gif|bmp|svg)$/.test(ext)) return {kind: 'slides', slides: [H.newSlide({layout: 'vollbild', img: await shrinkImage(await readAs(file, 'readAsDataURL'))})], name};
    if (ext === 'zip'){   // ZIP mit Bildern oder einer .honeydeck-Datei
      const z = unzip(await readAs(file, 'readAsArrayBuffer')), names = [...z.keys()].filter(n => !n.endsWith('/') && !/__MACOSX/.test(n)).sort();
      const hd = names.find(n => /\.honeydeck$/i.test(n)); if (hd) return {kind: 'deck', deck: H.normDeck(JSON.parse(dec.decode(await z.get(hd)())))};
      const slides = []; for (const n of names.filter(n => /\.(png|jpe?g|webp)$/i.test(n))) slides.push(H.newSlide({layout: 'vollbild', img: await shrinkImage(await bytesToDataUrl(await z.get(n)(), mimeOf(n)))}));
      if (!slides.length) throw new Error('In der ZIP-Datei sind keine Folien oder Bilder');
      return {kind: 'slides', slides, name};
    }
    if (ext === 'pdf') throw new Error('PDF lässt sich nicht bearbeitbar einlesen. Exportiere die Folien als PowerPoint, Bilder oder .honeydeck – oder kopiere den Text hinein.');
    if (ext === 'doc' || ext === 'ppt') throw new Error('Bitte im neueren Format speichern (.docx bzw. .pptx)');
    throw new Error(`Dateityp .${ext} wird nicht unterstützt`);
  }

  G.HoneyDeckIO = {zip, unzip, inflate, pdf, canvasBytes, shrinkImage, readAs, docxToText, pptxToSlides, htmlToSlides, htmlToText, importFile, enc, dec};
})();
