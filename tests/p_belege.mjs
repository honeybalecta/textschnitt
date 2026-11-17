// Belege im Bild (2.35): Formen und Pfeile (E6), Unkenntlich machen (B6), Fortschrittsbalken (E8), Markieren im Screenshot (B5),
// Folien, die sich Schritt für Schritt aufbauen (B4) – in der Oberfläche, im Exportplan und in echten Exporten.
// Grundlage: das Testprojekt „kurz“ (Oberfläche, Folien am gesprochenen Text) und karo.mp4, ein Schachbrett aus 4 Pixel großen
// Feldern (siehe medien.py): Daran lässt sich im fertigen Video ausmessen, wo gemittelt wurde und was scharf darüber liegt.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, ids, scratch, dropScratch, newProject, sleep, pruefung, MEDIA, OUT } from './drv.mjs';
const { chk, ende } = pruefung('Belege im Bild');
const { browser, page, logs } = await launch();
const ev = (f, a) => page.evaluate(f, a);
const shot = (name, pg = page, clip) => pg.screenshot({ path: path.join(OUT, `belege-${name}.png`), ...(clip ? { clip } : {}) });
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const rnd = (v, k = 3) => +(+v).toFixed(k);
const toastTxt = (pg = page) => pg.evaluate(() => document.querySelector('#toast').textContent);
const rect = (sel, pg = page) => pg.evaluate(s => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }, sel);
const drag = async (x0, y0, x1, y1, pg = page, mods = []) => { for (const m of mods) await pg.keyboard.down(m); await pg.mouse.move(x0, y0); await pg.mouse.down(); await pg.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 3 }); await pg.mouse.move(x1, y1, { steps: 3 }); await pg.mouse.up(); for (const m of mods) await pg.keyboard.up(m); await sleep(220); };
const tools = (pg = page) => pg.evaluate(() => [...document.querySelectorAll('#tools .tool:not(.more)')].map(b => b.textContent.trim()));
// seit 2.42: Werkzeuge ohne Auswahl stehen in den Menüs „Einfügen“ und „Bearbeiten“ über den Spuren
const menus = (pg = page) => pg.evaluate(() => ({ insert: barMenu('insert').map(t => t.label), edit: barMenu('edit').map(t => t.label) }));
const menuTool = (name, pg = page) => pg.evaluate(n => { const t = [...barMenu('insert'), ...barMenu('edit')].find(t => t.label === n); if (t) t.fn(); return !!t; }, name);
// Werkzeug des ausgewählten Elements (auch wenn es im Menü „Mehr“ steckt)
const selTool = (name, last = false, pg = page) => pg.evaluate(([n, last]) => { const a = [...document.querySelectorAll('#tools .tool:not(.more)')].filter(b => b.textContent.includes(n)), b = last ? a[a.length - 1] : a[0]; if (b) b.click(); return !!b; }, [name, last]);
const item = (id, pg = page) => pg.evaluate(i => { const it = P.items.find(x => x.id === i); return it ? JSON.parse(JSON.stringify(it)) : null; }, id);
const made = [], trash = new Set();
// Echter Export des offenen Projekts über das Test-Backend (ffmpeg wie in der Windows-App)
const exportNow = async (name, fmt = 'video') => {
  const r = await ev(async ([name, fmt]) => {
    P.settings.level = false; exFmt = fmt; const plan = buildPlan(); plan.name = name;
    const id = TS.exportVideo(JSON.stringify(plan));
    for (;;){ await new Promise(r => setTimeout(r, 200)); const j = JSON.parse(TS.job(id));
      if (j.status === 'done') return { ok: true, file: j.result.playable, files: j.result.files || [], plan };
      if (j.status === 'error') return { ok: false, error: j.error, plan }; } }, [name, fmt]);
  for (const f of [r.file, ...(r.files || [])]) if (f) trash.add(f);
  return r;
};
// Ein Bild des fertigen Videos als Graustufen oder Farbe (640 × 360)
const W = 640, H = 360;
const frame = (file, n, fmt = 'gray') => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-an', '-vf', `select=eq(n\\,${n})`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', fmt, '-'], { maxBuffer: 1 << 24 });
// Rahmen um alles, was im Schachbrett gemittelt wurde (Werte zwischen den beiden Feldfarben); einzelne Ausreißer der Kompression zählen nicht
const box = (g, y0 = 0, y1 = H) => { const cx = new Int32Array(W), cy = new Int32Array(H); let n = 0;
  for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++){ const v = g[y * W + x]; if (v > 70 && v < 180){ cx[x]++; cy[y]++; n++; } }
  const xs = [...cx.keys()].filter(x => cx[x] >= 3), ys = [...cy.keys()].filter(y => cy[y] >= 3);
  return xs.length && ys.length ? [xs[0], ys[0], xs[xs.length - 1], ys[ys.length - 1], n] : null; };
const nearBox = (b, w, tol = 2) => !!b && [0, 1, 2, 3].every(i => Math.abs(b[i] - w[i]) <= tol);
const px = (c, x, y) => [c[(y * W + x) * 3], c[(y * W + x) * 3 + 1], c[(y * W + x) * 3 + 2]];
const leave = (pg = page) => pg.evaluate(() => { if (typeof P !== 'undefined' && P){ pausePlay(); clearTimeout(saveT); saveNow(); closeSheet(); closeProject(); } });

try {
  // ═════════ E6 · Formen und Pfeile ═════════
  const idA = await scratch(page, ids().kurz); made.push(idA);
  await ev(() => { localStorage.removeItem('hc-mark'); setTab('studio'); }); await sleep(600);
  await ev(() => { select(null); seekOut(2, false); }); await sleep(200);
  const t0 = await menus();
  chk('Studio ohne Auswahl: „Form“ steht im Menü „Einfügen“, „Unkenntlich“ und „Fortschritt“ im Menü „Bearbeiten“; die untere Leiste ist leer', t0.insert.includes('Form') && t0.edit.includes('Unkenntlich') && t0.edit.includes('Fortschritt') && (await tools()).length === 0, t0);
  await menuTool('Form'); await sleep(250);
  const tiles = await ev(() => [...document.querySelectorAll('.choice.shapes [data-k]')].map(b => b.dataset.k + ':' + b.textContent.trim()));
  chk('„Form“ bietet Rahmen, Kreis, Pfeil und Textmarker an', tiles.join() === 'rect:Rahmen,ellipse:Kreis,arrow:Pfeil,marker:Textmarker', tiles);
  await page.click('.choice.shapes [data-k="rect"]'); await sleep(350);
  const a0 = await ev(() => { const it = P.items[P.items.length - 1]; window._a = it.id; return { it: JSON.parse(JSON.stringify(it)), sel: TL.sel, sheet: !!document.querySelector('#mkForm') && !document.querySelector('#sheet').classList.contains('hidden'),
    at: ovOf(it).at, toast: document.querySelector('#toast').textContent }; });
  const idS = a0.it.id;
  chk('Rahmen angelegt: an der Abspiellinie, 3 s, rot, mittlerer Strich, in der Bildmitte; ausgewählt, Blatt „Form“ offen',
    a0.it.type === 'shape' && a0.it.kind === 'rect' && a0.it.color === '#E5402A' && a0.it.thick === 2 && a0.it.dur === 3 && a0.it.x === 0.5 && a0.it.y === 0.5 && near(a0.it.w, 0.34 * 360 / 640, 0.002) && a0.it.ar === 1.6
    && near(a0.at, 2, 0.05) && a0.sel && a0.sel.kind === 'mark' && a0.sel.id === idS && a0.sheet && /Rahmen angelegt/.test(a0.toast), a0);
  // Blatt: Farbe, Strich, Art, Füllung, Richtung
  await page.click('#mkCol button[data-c="#FFFFFF"]'); await page.click('#mkThick button[data-v="3"]'); await sleep(120);
  let it = await item(idS);
  chk('Blatt: Farbe und Strichstärke gelten sofort', it.color === '#FFFFFF' && it.thick === 3, [it.color, it.thick]);
  await page.click('#mkKind button[data-v="ellipse"]'); await sleep(100); await page.click('#mkFill'); await sleep(120);
  const s1 = await ev(() => { const it = P.items.find(x => x.id === _a); return [it.kind, it.ar, !!it.fill, document.querySelector('#mkThickF').classList.contains('hidden'), document.querySelector('#mkDirF').classList.contains('hidden')]; });
  chk('Kreis, gefüllt: Seitenverhältnis 1, die Strichstärke entfällt', s1.join() === 'ellipse,1,true,true,true', s1);
  await page.click('#mkKind button[data-v="arrow"]'); await sleep(120);
  const s2 = await ev(() => { const it = P.items.find(x => x.id === _a), [W] = outSize(); return { kind: it.kind, ar: it.ar, fill: !!it.fill, len: it.w * W, dirF: !document.querySelector('#mkDirF').classList.contains('hidden'), fillF: document.querySelector('#mkFillF').classList.contains('hidden') }; });
  await page.click('#mkDir button[data-v="2"]'); await sleep(120);
  const s3 = await ev(() => { const it = P.items.find(x => x.id === _a), [W] = outSize(); return { dir: it.dir, ar: it.ar, len: it.w * W / it.ar, blk: document.querySelector('#trMark .blk .txt').textContent }; });
  chk('Pfeil: keine Füllung, Richtung wählbar; nach unten gedreht behält er seine Länge', s2.kind === 'arrow' && s2.ar === 3.2 && !s2.fill && s2.dirF && s2.fillF && s3.dir === 2 && near(s3.ar, 1 / 3.2, 0.001) && near(s3.len, s2.len, 2) && s3.blk === 'Pfeil ↓', [s2, s3]);
  await page.click('#mkKind button[data-v="marker"]'); await sleep(120);
  const s4 = await ev(() => { const it = P.items.find(x => x.id === _a); return [it.kind, it.color, it.ar, document.querySelector('#mkThickF').classList.contains('hidden'), document.querySelector('#mkFillF').classList.contains('hidden')]; });
  chk('Textmarker: gelb, flach, ohne Strich und Füllung', s4.join() === 'marker,#FFE14D,7,true,true', s4);
  await page.click('#mkKind button[data-v="rect"]'); await sleep(100); await page.click('#mkCol button[data-c="#E5402A"]'); await page.click('#mkThick button[data-v="2"]'); await page.click('#mkOk'); await sleep(250);
  // Bühne und Zeitleiste
  const st = await rect('#stage'), cv = await rect(`#shapeOv canvas[data-mk="${idS}"]`);
  it = await item(idS);
  chk('Bühne: Die Form liegt als Leinwand an ihrer Stelle', cv && near(cv[0] + cv[2] / 2 - st[0], it.x * st[2], 2) && near(cv[1] + cv[3] / 2 - st[1], it.y * st[3], 2) && near(cv[2], it.w * st[2], 2.5) && near(cv[2] / cv[3], it.ar, 0.05), [cv, st]);
  const row = await ev(() => ({ nmk: getComputedStyle(document.querySelector('.tl-body')).getPropertyValue('--nmk').trim(), h: document.querySelector('#trMark').getBoundingClientRect().height, blk: [...document.querySelectorAll('#trMark .blk')].map(b => [b.className, b.textContent.trim()]) }));
  chk('Zeitleiste: eigene Zeile „Formen“ mit dem Element', row.nmk === '1' && row.h > 10 && row.blk.length === 1 && /mark/.test(row.blk[0][0]) && /shape/.test(row.blk[0][0]) && row.blk[0][1] === 'Rahmen', row);
  // im Bild ziehen
  const u0 = await ev(() => undo.length);
  await drag(cv[0] + cv[2] / 2, cv[1] + cv[3] / 2, cv[0] + cv[2] / 2 + 60, cv[1] + cv[3] / 2 + 30);
  let it1 = await item(idS);
  chk('im Bild ziehen: Die Form wandert mit (ein Rückgängig-Schritt)', near(it1.x, it.x + 60 / st[2], 0.01) && near(it1.y, it.y + 30 / st[3], 0.012) && it1.w === it.w && await ev(() => undo.length) === u0 + 1, [it1.x, it1.y]);
  // Ecke: frei, mit Umschalt im Verhältnis
  let pb = await rect('#pipBox');
  await drag(pb[0] + pb[2] - 2, pb[1] + pb[3] - 2, pb[0] + pb[2] + 70, pb[1] + pb[3] + 8);
  let it2 = await item(idS);
  chk('Ecke ziehen: Breite und Höhe ändern sich frei', it2.w > it1.w + 0.03 && it2.ar > it1.ar + 0.2, [it1.w, it1.ar, it2.w, it2.ar]);
  pb = await rect('#pipBox');
  await drag(pb[0] + pb[2] - 2, pb[1] + pb[3] - 2, pb[0] + pb[2] - 50, pb[1] + pb[3] - 20, page, ['Shift']);
  let it3 = await item(idS);
  chk('Ecke mit Umschalt: Das Seitenverhältnis bleibt', it3.w < it2.w - 0.02 && near(it3.ar, it2.ar, 0.01), [it2.w, it2.ar, it3.w, it3.ar]);
  // Keyframes
  await page.keyboard.press('m'); await sleep(200);
  const k1 = await item(idS);
  await ev(() => seekOut(4, false)); await sleep(250);
  const c2 = await rect(`#shapeOv canvas[data-mk="${idS}"]`);
  await drag(c2[0] + c2[2] / 2, c2[1] + c2[3] / 2, c2[0] + c2[2] / 2 - 120, c2[1] + c2[3] / 2 - 40);
  const k2 = await item(idS);
  chk('Keyframe (M) und Ziehen an einer späteren Stelle: zwei Keyframes', (k1.kf || []).length === 1 && (k2.kf || []).length === 2 && near(k2.kf[1].t - k2.kf[0].t, 2, 0.06) && near(k2.kf[1].x, k2.kf[0].x - 120 / st[2], 0.012), k2.kf);
  const mid = await ev(() => { const it = P.items.find(x => x.id === _a), a = ovOf(it), t = a.at + (it.kf[0].t + it.kf[1].t) / 2; seekOut(t, false); const v = elVals(it, t - a.at), c = document.querySelector(`#shapeOv canvas[data-mk="${_a}"]`).getBoundingClientRect(), s = document.querySelector('#stage').getBoundingClientRect();
    return { v, cx: (c.left + c.width / 2 - s.left) / s.width, kfs: document.querySelectorAll('#trMark .blk .kf').length }; });
  chk('dazwischen wandert die Form gleichmäßig (Rechnung und Bühne); die Zeitleiste zeigt beide Keyframes', near(mid.v.x, (k2.kf[0].x + k2.kf[1].x) / 2, 0.003) && near(mid.cx, mid.v.x, 0.006) && mid.kfs === 2, mid);
  // Zeitleiste: verschieben und vorn kürzen
  const pps = await ev(() => { const it = P.items.find(x => x.id === _a), b = document.querySelector('#trMark .blk').getBoundingClientRect(); return b.width / it.dur; });
  let bl = await rect('#trMark .blk');
  await drag(bl[0] + bl[2] / 2, bl[1] + bl[3] / 2, bl[0] + bl[2] / 2 + 150, bl[1] + bl[3] / 2);
  const m1 = await ev(() => { const it = P.items.find(x => x.id === _a); return { r: itemOutRange(it), kf: it.kf.map(k => k.t) }; });
  chk('Zeitleiste: Element verschieben nimmt die Keyframes mit', near(m1.r[0], 2 + 150 / pps, 0.25) && near(m1.kf[0], k2.kf[0].t, 0.001) && near(m1.kf[1], k2.kf[1].t, 0.001), [m1, pps]);
  bl = await rect('#trMark .blk');
  await page.mouse.click(bl[0] + bl[2] / 2, bl[1] + bl[3] / 2); await sleep(150);
  bl = await rect('#trMark .blk');
  await drag(bl[0] + 3, bl[1] + bl[3] / 2, bl[0] + 3 + 45, bl[1] + bl[3] / 2);
  const m2 = await ev(() => { const it = P.items.find(x => x.id === _a); return { r: itemOutRange(it), dur: it.dur, kf: it.kf.map(k => k.t) }; });
  const cutBy = m2.r[0] - m1.r[0];
  chk('vorn kürzen: Die Form beginnt später, ihre Keyframes bleiben an derselben Stelle im Video', cutBy > 0.1 && near(m2.dur, 3 - cutBy, 0.02) && near(m2.kf[1], m1.kf[1] - cutBy, 0.02) && near(m2.r[1], m1.r[1], 0.02), [m1, m2]);
  // Werkzeuge der Auswahl
  const t1 = await tools();
  chk('Werkzeuge der Form: Art & Farbe, Keyframe, Kleiner, Größer, Nach vorn, Nach hinten, Löschen', ['Art & Farbe', 'Keyframe', 'Kleiner', 'Größer', 'Nach vorn', 'Nach hinten', 'Löschen'].every(n => t1.some(t => t.includes(n))), t1);
  // Kopieren, Einfügen, Löschen, Rückgängig
  const cp = await ev(() => { copySel(); seekOut(10, false); pasteClip(); return { n: P.items.filter(isMark).length, sel: TL.sel && TL.sel.kind, at: marks.map(m => rnd3(m.at)) }; function rnd3(v){ return Math.round(v * 1000) / 1000; } });
  chk('Kopieren und Einfügen: zweite Form an der Abspiellinie, ausgewählt', cp.n === 2 && cp.sel === 'mark' && cp.at.some(a => Math.abs(a - 10) < 0.05), cp);
  const ord = await ev(() => { const [a, b] = P.items.filter(isMark); commit(() => { b.at = a.at; b.dur = a.dur; delete b.kf; delete a.kf; }, true); const p0 = buildPlan(true); markOrder(a, 1); const p1 = buildPlan(true);
    return { before: P.items.filter(isMark)[1].id === a.id, lanes: getComputedStyle(document.querySelector('.tl-body')).getPropertyValue('--nmk').trim(), toast: document.querySelector('#toast').textContent, a: a.id, b: b.id }; });
  chk('„Nach vorn“ tauscht die Lage zweier Formen; gleichzeitige Formen bekommen eigene Bahnen', ord.before && ord.lanes === '2' && /nach vorn/.test(ord.toast), ord);
  await page.keyboard.press('Delete'); await sleep(200);
  const del = await ev(() => [P.items.filter(isMark).length, document.querySelectorAll('#trMark .blk').length, document.querySelectorAll('#shapeOv canvas').length]);
  chk('Entf löscht die ausgewählte Form (Zeitleiste und Bühne ziehen nach)', del[0] === 1 && del[1] === 1 && del[2] <= 1, del);
  await ev(() => { for (let k = 0; k < 40 && undo.length; k++) document.querySelector('#undoBtn').click(); }); await sleep(350);
  const back = await ev(() => [P.items.filter(isMark).length, document.querySelectorAll('#trMark .blk').length, getComputedStyle(document.querySelector('.tl-body')).getPropertyValue('--nmk').trim(), document.querySelectorAll('#shapeOv canvas').length, document.querySelector('#trMark').getBoundingClientRect().height]);
  chk('alles rückgängig: keine Form mehr, die Zeile „Formen“ verschwindet', back[0] === 0 && back[1] === 0 && back[2] === '0' && back[3] === 0 && back[4] < 2, back);

  // Bilder der Formen: Rahmen (Strich am Rand, Mitte durchsichtig), Kreis gefüllt, Pfeil, Textmarker (durchscheinend)
  const imgs = await ev(async () => {
    const out = {}, mk = (kind, o = {}) => ({id: newId(), type: 'shape', kind, color: '#E5402A', thick: 2, at: 0, dur: 2, x: 0.5, y: 0.5, w: 0.3, ar: kind === 'ellipse' ? 1 : kind === 'marker' ? 7 : kind === 'arrow' ? 3.2 : 1.6, ...o});
    for (const [name, it] of [['rect', mk('rect')], ['fill', mk('ellipse', {fill: true})], ['arrow', mk('arrow', {dir: 0})], ['left', mk('arrow', {dir: 4})], ['marker', mk('marker', {color: '#FFE14D'})]]){
      const im = shapeImage(shapeSpec(it), 384, 384 / it.ar, 720), c = im.cv.getContext('2d'), d = c.getImageData(0, 0, im.w, im.h).data, at = (x, y) => [...d.slice((y * im.w + x) * 4, (y * im.w + x) * 4 + 4)];
      let n = 0, sx = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128){ n++; sx += (i / 4) % im.w; }
      out[name] = { w: im.w, h: im.h, mid: at(im.w >> 1, im.h >> 1), edge: at(im.w >> 1, 3), left: at(3, im.h >> 1), corner: at(1, 1), share: n / (im.w * im.h), cx: n ? sx / n / im.w : 0 };
    }
    return out; });
  chk('Bild des Rahmens: Strich in der Farbe am Rand, Mitte durchsichtig', imgs.rect.edge.join() === '229,64,42,255' && imgs.rect.left.join() === '229,64,42,255' && imgs.rect.mid[3] === 0 && imgs.rect.share < 0.25, imgs.rect);
  chk('gefüllter Kreis: Mitte deckend, Ecken durchsichtig, Fläche wie eine Ellipse', imgs.fill.mid.join() === '229,64,42,255' && imgs.fill.corner[3] === 0 && near(imgs.fill.share, Math.PI / 4, 0.03), imgs.fill);
  chk('Pfeil: Schaft in der Mitte, Spitze auf der Seite der Richtung (Schwerpunkt wandert mit)', imgs.arrow.mid[3] === 255 && imgs.arrow.cx > 0.52 && imgs.left.cx < 0.48 && near(imgs.arrow.cx + imgs.left.cx, 1, 0.02), [imgs.arrow.cx, imgs.left.cx]);
  chk('Textmarker: durchscheinendes Gelb über die ganze Fläche', imgs.marker.mid[0] > 240 && imgs.marker.mid[1] > 200 && imgs.marker.mid[2] < 120 && imgs.marker.mid[3] > 60 && imgs.marker.mid[3] < 200 && imgs.marker.share < 0.2, imgs.marker);
  // ═════════ B6 · Unkenntlich machen ═════════
  await ev(() => { select(null); seekOut(3, false); }); await sleep(250);
  await menuTool('Unkenntlich'); await sleep(600);
  const b0 = await ev(() => { const it = P.items[P.items.length - 1]; window._b = it.id; const c = document.querySelector(`#blurOv canvas[data-mk="${it.id}"]`), cs = c && getComputedStyle(c);
    const d = c ? c.getContext('2d').getImageData(0, 0, c.width, c.height).data : []; let mx = 0; for (let i = 0; i < d.length; i += 4) mx = Math.max(mx, d[i], d[i + 1], d[i + 2]);
    return { it: JSON.parse(JSON.stringify(it)), sel: TL.sel, cls: c ? c.className : '', rad: cs ? cs.borderTopLeftRadius : '', ren: cs ? cs.imageRendering : '', cw: c ? c.width : 0, ch: c ? c.height : 0, mx,
      toast: document.querySelector('#toast').textContent, blk: [...document.querySelectorAll('#trMark .blk')].map(b => [b.className, b.textContent.trim()]), sheet: !!document.querySelector('#mkForm') && !document.querySelector('#sheet').classList.contains('hidden') }; });
  const idB = b0.it.id;
  chk('Bereich angelegt: verpixelt, Ellipse, stark, 4 s, etwas über der Bildmitte; ausgewählt (ohne Blatt – erst an die Stelle ziehen)',
    b0.it.type === 'blur' && b0.it.kind === 'pixel' && b0.it.form === 'ellipse' && b0.it.str === 1 && b0.it.dur === 4 && b0.it.x === 0.5 && b0.it.y === 0.4 && near(b0.it.w, 0.24 * 360 / 640, 0.002) && b0.it.ar === 0.8
    && b0.sel && b0.sel.kind === 'mark' && b0.sel.id === idB && !b0.sheet && /Bereich angelegt/.test(b0.toast), b0);
  chk('Vorschau: winzige Leinwand mit sechs Feldern über die kürzere Seite, hart gestreckt, rund, mit dem Bild darunter gefüllt',
    /\bfx\b/.test(b0.cls) && b0.cw === 6 && (b0.ch === 7 || b0.ch === 8) && b0.ren === 'pixelated' && b0.rad === '50%' && b0.mx > 20, [b0.cls, b0.cw, b0.ch, b0.ren, b0.rad, b0.mx]);
  chk('Zeitleiste: Der Bereich steht als „Verpixelt“ in der Zeile der Formen', b0.blk.some(b => /blur/.test(b[0]) && /fx/.test(b[0]) && b[1] === 'Verpixelt'), b0.blk);
  const planOf = fmt => ev(fmt => { const keep = exFmt; exFmt = fmt; const p = buildPlan(); exFmt = keep; return { blurs: p.blurs || null, top: p.overlays.filter(o => o.top).map(o => ({ uri: o.uri.split('/').pop(), at: o.at, out: o.out, x: o.x, y: o.y, w: o.w, aspect: o.aspect, track: o.track, kf: o.kf || null, cover: !!o.cover, shape: !!o.shape, progress: !!o.progress, op: o.opacity ?? null })) }; }, fmt);
  let pl = await planOf('video');
  chk('Exportplan (Video): ein Eintrag in blurs mit Zeit, Lage, Form, Art, Feldgröße und Maske',
    pl.blurs && pl.blurs.length === 1 && near(pl.blurs[0].at, 3, 0.05) && pl.blurs[0].d === 4 && pl.blurs[0].x === 0.5 && pl.blurs[0].y === 0.4 && near(pl.blurs[0].w, 0.135, 0.002) && near(pl.blurs[0].wmax, 0.135, 0.002)
    && pl.blurs[0].aspect === 0.8 && pl.blurs[0].form === 'ellipse' && pl.blurs[0].kind === 'pixel' && near(pl.blurs[0].cell, 0.135 / 6, 0.0006) && /maske-ellipse-205x256\.png$/.test(pl.blurs[0].mask || '') && !pl.top.length, pl.blurs);
  // Blatt: Art, Form, Stärke
  await selTool('Art & Stärke'); await sleep(300);
  const w0 = await ev(() => document.querySelector('#mkWarn').textContent);
  await page.click('#mkKind button[data-v="soft"]'); await page.click('#mkStr button[data-v="3"]'); await page.click('#mkShape button[data-v="rect"]'); await sleep(300);
  const b1 = await ev(() => { const c = document.querySelector(`#blurOv canvas[data-mk="${_b}"]`), cs = getComputedStyle(c); return { cw: c.width, ren: cs.imageRendering, rad: cs.borderTopLeftRadius, warn: document.querySelector('#mkWarn').textContent, blk: document.querySelector(`#trMark .blk[data-id="${_b}"] .txt`).textContent }; });
  pl = await planOf('video');
  chk('Weichzeichnen, leicht, Rechteck: 14 Felder, weich gestreckt, eckig; der Hinweis rät zu „stark“ oder „Abdecken“',
    b1.cw === 14 && b1.ren !== 'pixelated' && b1.rad === '0px' && /Leichtes Verpixeln oder Weichzeichnen/.test(b1.warn) && /deckt alles Bildmaterial darunter ab/.test(w0) && b1.blk === 'Weichgezeichnet'
    && pl.blurs[0].kind === 'soft' && pl.blurs[0].form === 'rect' && near(pl.blurs[0].cell, 0.135 / 14, 0.0004), [b1, pl.blurs[0]]);
  await page.click('#mkKind button[data-v="cover"]'); await sleep(250);
  const b2 = await ev(() => { const c = document.querySelector(`#blurOv canvas[data-mk="${_b}"]`); return { cls: c.className, warn: document.querySelector('#mkWarn').textContent, strHidden: document.querySelector('#mkStrF').classList.contains('hidden'), colHidden: document.querySelector('#mkColF').classList.contains('hidden'), color: P.items.find(x => x.id === _b).color || null }; });
  pl = await planOf('video');
  chk('Abdecken: Fläche in einer Farbe; im Plan ein Bild über allem (kein Eintrag in blurs)',
    !/\bfx\b/.test(b2.cls) && /durch nichts zurückholen/.test(b2.warn) && b2.strHidden && !b2.colHidden && pl.blurs === null && pl.top.length === 1 && pl.top[0].cover && pl.top[0].track >= 100 && /^form-.*\.png$/.test(pl.top[0].uri), [b2, pl.top]);
  await page.click('#mkCol button[data-c="#E5402A"]'); await sleep(120);
  chk('Abdecken: Die Farbe ist wählbar', (await item(idB)).color === '#E5402A');
  await page.click('#mkKind button[data-v="pixel"]'); await page.click('#mkStr button[data-v="1"]'); await page.click('#mkShape button[data-v="ellipse"]'); await page.click('#mkOk'); await sleep(250);
  // Keyframes: Der Bereich folgt
  await ev(() => seekOut(3.2, false)); await sleep(250);
  await page.keyboard.press('m'); await sleep(200);
  await ev(() => seekOut(5.7, false)); await sleep(300);
  let bc = await rect(`#blurOv canvas[data-mk="${idB}"]`);
  await drag(bc[0] + bc[2] / 2, bc[1] + bc[3] / 2, bc[0] + bc[2] / 2 + 90, bc[1] + bc[3] / 2 + 40);
  pb = await rect('#pipBox');
  await drag(pb[0] + pb[2] - 2, pb[1] + pb[3] - 2, pb[0] + pb[2] + 30, pb[1] + pb[3] + 37.5, page, ['Shift']);
  const bk = await item(idB); pl = await planOf('video');
  chk('Keyframes: Der Bereich wandert und wächst; der Plan trägt beide Keyframes und die größte Breite',
    (bk.kf || []).length === 2 && bk.kf[1].x > bk.kf[0].x + 0.1 && bk.kf[1].w > bk.kf[0].w + 0.02 && pl.blurs.length === 1 && pl.blurs[0].kf.length === 2 && near(pl.blurs[0].wmax, bk.kf[1].w, 0.0011) && near(pl.blurs[0].w, bk.kf[0].w, 0.0011)
    && near(pl.blurs[0].cell, bk.kf[1].w / 6, 0.0006), [bk.kf, pl.blurs[0]]);
  // Formate: nur das Video macht unkenntlich
  await ev(() => { select(null); seekOut(3, false); addMarkItem('shape', 'rect'); select(null); }); await sleep(250);
  const pa = await planOf('audio'), pc = await planOf('capcut'), pv = await planOf('video');
  chk('Nur Ton: keine Bereiche im Plan; CapCut: Formen als Bilder, keine Bereiche; Video: beides',
    pa.blurs === null && pc.blurs === null && pc.top.length === 1 && pc.top[0].shape && pv.blurs.length === 1 && pv.top.length === 1 && pv.top[0].shape, [pa.blurs, pc.blurs, pc.top.length, pv.top.length]);
  await ev(() => setTab('export')); await sleep(300);
  await page.click('#exFmt button[data-v="video"]'); await sleep(200);
  const xv = await ev(() => ({ sum: document.querySelector('#exSummary').textContent, note: document.querySelector('#exBlurNote').textContent, hidden: document.querySelector('#exBlurNote').classList.contains('hidden') }));
  await page.click('#exFmt button[data-v="capcut"]'); await sleep(250);
  const xc = await ev(() => ({ note: document.querySelector('#exBlurNote').textContent, warn: document.querySelector('#exBlurNote').classList.contains('warn'), hidden: document.querySelector('#exBlurNote').classList.contains('hidden') }));
  chk('Export-Reiter: Die Zusammenfassung nennt Form und Bereich; bei CapCut steht deutlich da, dass der Bereich erkennbar bleibt',
    /1 Form/.test(xv.sum) && /1 Bereich unkenntlich/.test(xv.sum) && xv.hidden && !xc.hidden && xc.warn && /Ein verpixelter oder weichgezeichneter Bereich fehlt/.test(xc.note) && /erkennbar/.test(xc.note), [xv, xc]);
  await page.click('#exBtn'); await sleep(500);
  const ask = await ev(() => { const g = document.querySelector('#xbGo'); let n = g; while (n && !n.querySelector('h3')) n = n.parentElement; return { open: !!g && !!document.querySelector('#xbNo'), txt: n ? n.textContent.replace(/\s+/g, ' ').slice(0, 200) : '' }; });
  if (ask.open) await page.click('#xbNo'); await sleep(300);
  const noJob = await ev(() => ({ job: !!exJob, msg: document.querySelector('#exMsg').textContent, open: !!document.querySelector('#xbGo') }));
  chk('CapCut-Export mit Bereich: Rückfrage „bleibt erkennbar“; Abbrechen startet nichts', ask.open && /Ein Bereich bleibt erkennbar/.test(ask.txt) && !noJob.job && !noJob.open, [ask, noJob]);
  await page.click('#exFmt button[data-v="video"]'); await sleep(150);
  await ev(() => setTab('studio')); await sleep(400);

  // ═════════ E8 · Fortschrittsbalken ═════════
  await ev(() => { select(null); seekOut(0, false); }); await sleep(150);
  await menuTool('Fortschritt'); await sleep(300);
  const g0 = await ev(() => ({ form: !!document.querySelector('#pgForm'), on: document.querySelector('#pgOn') ? document.querySelector('#pgOn').checked : null, set: P.progress || null, cls: document.querySelector('#progOv').className }));
  if (!g0.on) await page.click('#pgOn'); await sleep(200);
  const g1 = await ev(() => { const p = document.querySelector('#progOv'), i = p.querySelector('i'), s = document.querySelector('#stage').getBoundingClientRect(), r = p.getBoundingClientRect(), cs = getComputedStyle(i);
    return { set: P.progress, hidden: p.classList.contains('hidden'), h: r.height, bottom: Math.abs(r.bottom - s.bottom), w: r.width / s.width, col: cs.backgroundColor, tf: i.style.transform, acc: slColors(slProfile(), true).acc }; });
  chk('Blatt „Fortschrittsbalken“: einschalten zeigt den Balken unten im Bild, in der Akzentfarbe des Designs',
    g0.form && g1.set && g1.set.on === true && g1.set.pos === 'u' && g1.set.size === 2 && !g1.hidden && near(g1.bottom, 0, 1.5) && near(g1.w, 1, 0.01) && near(g1.h, 320 * 0.01, 1.6) && /^scaleX\(0(\.0+)?\)$/.test(g1.tf), g1);
  await page.click('#pgPos button[data-v="o"]'); await page.click('#pgSize button[data-v="3"]'); await page.click('#pgCol button[data-c="#FFE14D"]'); await sleep(200);
  const g2 = await ev(() => { const p = document.querySelector('#progOv'), s = document.querySelector('#stage').getBoundingClientRect(), r = p.getBoundingClientRect(); return { set: P.progress, top: Math.abs(r.top - s.top), h: r.height, col: getComputedStyle(p.querySelector('i')).backgroundColor }; });
  chk('oben, kräftig, gelb: Die Vorschau zieht sofort nach', g2.set.pos === 'o' && g2.set.size === 3 && g2.set.color === '#FFE14D' && near(g2.top, 0, 1.5) && g2.h > g1.h + 1 && g2.col === 'rgb(255, 225, 77)', g2);
  await page.click('#pgOk'); await sleep(200);
  const half = await ev(() => { seekOut(total / 2, false); const i = document.querySelector('#progOv i'), p = document.querySelector('#progOv'); return { tf: i.style.transform, w: i.getBoundingClientRect().width / p.getBoundingClientRect().width, total }; });
  chk('in der Mitte des Videos ist der Balken halb gefüllt', near(half.w, 0.5, 0.01), half);
  pl = await planOf('video');
  const pg = pl.top.filter(o => o.progress), th = Math.max(2, Math.round(360 * 0.016 / 2) * 2);
  chk('Exportplan (Video): Grundlinie (durchscheinend) und Balken als Bilder über allem; der Balken fährt über die ganze Länge herein',
    pg.length === 2 && pg[0].track === 150 && pg[1].track === 151 && near(pg[0].op, 0.35, 0.001) && pg[0].x === 0.5 && pg.every(o => o.w === 1 && near(o.aspect, 640 / th, 0.01) && near(o.y, th / 2 / 360, 0.0001) && o.at === 0 && near(o.out, half.total, 0.002))
    && pg[1].kf && pg[1].kf.length === 2 && pg[1].kf[0].x === -0.5 && pg[1].kf[1].x === 0.5 && near(pg[1].kf[1].t, half.total, 0.002) && /^balken-ffe14d-640x\d+\.png$/.test(pg[1].uri) && /^balken-000000-/.test(pg[0].uri), pg);
  const pcap = await planOf('capcut'), paud = await planOf('audio');
  chk('CapCut und Nur Ton: kein Fortschrittsbalken im Plan', !pcap.top.some(o => o.progress) && !paud.top.some(o => o.progress));
  const un = await ev(() => { const before = JSON.stringify(P.progress); document.querySelector('#undoBtn').click(); const mid = JSON.stringify(P.progress); document.querySelector('#redoBtn').click(); return { before, mid, after: JSON.stringify(P.progress) }; });
  chk('Rückgängig und Wiederholen nehmen die Einstellung des Balkens mit', un.before === un.after && un.mid !== un.before, un);
  await ev(() => openProgress()); await sleep(200);
  await page.click('#pgBg'); await sleep(150);
  pl = await planOf('video');
  chk('ohne Grundlinie: nur der Balken im Plan', pl.top.filter(o => o.progress).length === 1 && pl.top.find(o => o.progress).track === 151, pl.top.filter(o => o.progress).map(o => o.track));
  await page.click('#pgDel'); await sleep(250);
  const off = await ev(() => ({ on: progOn(), hidden: document.querySelector('#progOv').classList.contains('hidden'), sheet: !!document.querySelector('#pgForm') && !document.querySelector('#sheet').classList.contains('hidden') }));
  chk('„Entfernen“ schaltet den Balken aus', !off.on && off.hidden && !off.sheet, off);
  const hs = await ev(() => { progEdit(p => { p.on = true; p.color = '#3E8A55'; p.pos = 'o'; }); const st = houseOf(), p2 = {settings: {}}; houseInto(p2, st);
    const alt = {...st}; delete alt.progress; const p3 = {progress: {on: true, pos: 'u'}, settings: {}}; houseInto(p3, alt);   // Vorlage aus einer früheren Fassung
    const p4 = {progress: {on: true, pos: 'u'}, settings: {}}; houseInto(p4, {...st, progress: null});   // Vorlage ohne Balken
    const out = { st: st.progress, into: p2.progress, sum: houseSummary(st), alt: p3.progress, ohne: 'progress' in p4 }; commit(() => { delete P.progress; }, false); viewProgress(); return out; });
  chk('Hausstil: Der Fortschrittsbalken gehört zur Vorlage; eine Vorlage ohne Balken nimmt ihn heraus, eine aus früheren Fassungen lässt ihn stehen',
    hs.st && hs.st.on && hs.st.color === '#3E8A55' && hs.into && hs.into.pos === 'o' && /Fortschrittsbalken/.test(hs.sum) && hs.alt && hs.alt.pos === 'u' && hs.ohne === false, hs);
  // ═════════ B5 · Markieren im Screenshot ═════════
  const idM = await ev(async () => {
    const cv = document.createElement('canvas'); cv.width = 900; cv.height = 1400; const x = cv.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, 900, 1400); x.fillStyle = '#111'; x.font = '700 44px Inter, sans-serif'; x.fillText('Mieten steigen weiter', 50, 90);
    x.font = '400 26px Inter, sans-serif'; for (let k = 0; k < 34; k++) x.fillText('Die Stadt meldet für das dritte Quartal einen Anstieg um vier Prozent. ' + k, 50, 170 + k * 36);
    const m = JSON.parse(TS.saveImage('probe-artikel.png', cv.toDataURL('image/png'), 900, 1400, P.id)); m.name = 'Artikel.png';
    placeMedia(m, 'broll', 20, null, true); const it = P.items[P.items.length - 1]; commit(() => { it.out = 6; }, true); window._m = it.id;
    select({kind: 'ovl', id: it.id}); seekOut(20.2, false); return it.id; });
  await sleep(450);
  const tm = await tools();
  const slideTool = await ev(async () => { const sl = newSlide({layout: 'titel', title: 'Folie'}); commit(() => P.slides.push(sl), false); const m = await slMedia(sl); placeMedia(m, 'broll', 40, null, true); const it = P.items[P.items.length - 1]; it.slide = sl.id; window._sl0 = sl.id;
    select({kind: 'ovl', id: it.id}); await new Promise(r => setTimeout(r, 150)); const t = [...document.querySelectorAll('#tools .tool:not(.more)')].map(b => b.textContent.trim()); select({kind: 'ovl', id: _m}); return { tools: t.filter(x => /Markier/.test(x)), can: canMark(it) }; });
  chk('Bild auf einer Videospur: Werkzeug „Markieren“; bei Folien gibt es das Werkzeug nicht', tm.some(t => t.endsWith('Markieren')) && !slideTool.tools.length && !slideTool.can, [tm.filter(t => /Markier/.test(t)), slideTool]);
  await selTool('Markieren'); await sleep(700);
  const ed = await rect('#mkxImg');
  const dragRect = async (x0, y0, x1, y1) => drag(ed[0] + x0 * ed[2], ed[1] + y0 * ed[3], ed[0] + x1 * ed[2], ed[1] + y1 * ed[3]);
  chk('Editor zum Markieren öffnet bildschirmfüllend mit dem ganzen Bild', !!ed && ed[2] > 100 && near(ed[2] / ed[3], 900 / 1400, 0.01) && ed[1] >= 0 && ed[1] + ed[3] <= 900, ed);
  await dragRect(0.05, 0.215, 0.95, 0.245); await dragRect(0.05, 0.42, 0.6, 0.45);
  const nr = await ev(() => document.querySelectorAll('.mkx-r').length);
  await shot('markieren-editor');
  await page.click('#mkxOk'); await sleep(1000);
  const ma = await ev(async () => { const it = P.items.find(x => x.id === _m), mk = it.mark;
    const im = new Image(); im.src = MEDIA(it.clip.uri); await im.decode(); const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext('2d', {willReadFrequently: true}); x.drawImage(im, 0, 0);
    const at = (fx, fy) => [...x.getImageData(Math.round(fx * c.width), Math.round(fy * c.height), 1, 1).data.slice(0, 3)];
    return { mark: mk && { n: mk.rects.length, color: mk.color, dim: mk.dim, zoom: mk.zoom, orig: mk.orig.name, r0: mk.rects[0] }, name: it.clip.name, file: it.clip.uri.split('/').pop(), size: [c.width, c.height], kf: it.kf || null, w: it.w ?? null,
      inMark: at(0.93, 0.23), outside: at(0.98, 0.6), undoBtn: document.querySelector('#undoBtn').disabled, editorOpen: !!document.querySelector('.mkx') }; });
  chk('zwei Stellen markiert: Das Element zeigt ein neues Bild „… (markiert)“ – Stelle gelb hinterlegt, der Rest abgedunkelt; das Original bleibt gemerkt',
    nr === 2 && ma.mark && ma.mark.n === 2 && ma.mark.color === '#FFE14D' && ma.mark.dim === 0.5 && ma.mark.zoom === true && ma.mark.orig === 'Artikel.png' && ma.name === 'Artikel (markiert).png' && /^markiert-.*\.png$/.test(ma.file)
    && ma.size.join() === '900,1400' && ma.inMark[0] > 245 && ma.inMark[1] > 215 && ma.inMark[2] < 100 && ma.outside.every(v => near(v, 128, 6)) && !ma.editorOpen, ma);
  chk('Heranfahren: zwei Keyframes – erst das ganze Bild, dann langsam auf die markierten Stellen zu', ma.kf && ma.kf.length === 2 && ma.kf[0].t < 0.6 && ma.kf[1].t > 3 && ma.kf[1].w > ma.kf[0].w * 1.05 && ma.kf[1].w <= ma.kf[0].w * 3.01, ma.kf);
  const fahrt = await ev(async () => { const it = P.items.find(x => x.id === _m), a = ovOf(it), out = []; for (const t of [a.at + 0.1, a.end - 0.2]){ seekOut(t, false); await new Promise(r => setTimeout(r, 350)); const el = layers.get(it.id), b = el.getBoundingClientRect(), s = document.querySelector('#stage').getBoundingClientRect(); out.push([b.width / s.width, (b.left + b.width / 2 - s.left) / s.width, (b.top + b.height / 2 - s.top) / s.height]); } return out; });
  chk('Vorschau: Das Bild ist am Ende größer als am Anfang (Fahrt auf die Stelle)', fahrt[1][0] > fahrt[0][0] * 1.05, fahrt.map(f => f.map(v => rnd(v))));
  await shot('markieren-ende', page, { x: 440, y: 95, width: 600, height: 345 });
  const pm = await ev(() => { const p = buildPlan(true), o = p.overlays.find(q => /markiert/.test(q.uri)); return o && { at: o.at, out: o.out, kf: (o.kf || []).length, aspect: o.aspect }; });
  chk('Exportplan: das markierte Bild mit seinen Keyframes', pm && pm.kf === 2 && near(pm.aspect, 900 / 1400, 0.001), pm);
  // wieder öffnen: eine Stelle entfernen, Heranfahren aus
  await ev(() => { select({kind: 'ovl', id: _m}); }); await sleep(200);
  const tm2 = await tools();
  await selTool('Markierung'); await sleep(600);
  const again = await ev(() => document.querySelectorAll('.mkx-r').length);
  const r1 = await rect('.mkx-r');
  await page.mouse.click(r1[0] + r1[2] / 2, r1[1] + r1[3] / 2); await sleep(150);
  await page.click('#mkxZoom'); await page.click('#mkxOk'); await sleep(1000);
  const mb = await ev(() => { const it = P.items.find(x => x.id === _m); return { n: it.mark.rects.length, zoom: it.mark.zoom, kf: it.kf || null, file: it.clip.uri.split('/').pop() }; });
  chk('wieder öffnen zeigt beide Stellen; eine antippen entfernt sie; ohne Heranfahren entfallen die Keyframes', tm2.some(t => t.endsWith('Markierung')) && again === 2 && mb.n === 1 && mb.zoom === false && !mb.kf && mb.file !== ma.file, [again, mb]);
  await selTool('Markierung'); await sleep(500);
  await page.click('#mkxClear'); await sleep(500);
  const mc = await ev(() => { const it = P.items.find(x => x.id === _m); return { mark: it.mark || null, name: it.clip.name, kf: it.kf || null }; });
  chk('„Markierung entfernen“ stellt das Originalbild wieder her', mc.mark === null && mc.name === 'Artikel.png' && !mc.kf, mc);
  await ev(() => document.querySelector('#undoBtn').click()); await sleep(300);
  const md = await ev(() => { const it = P.items.find(x => x.id === _m); return [!!it.mark, it.clip.name]; });
  chk('Rückgängig bringt die Markierung zurück', md[0] && md[1] === 'Artikel (markiert).png', md);

  // ═════════ B4 · Folien, die sich Schritt für Schritt aufbauen (eingebauter Folien-Reiter) ═════════
  const f0 = await ev(async () => {
    commit(() => { P.items = P.items.filter(x => !x.slide); P.slides = []; }, true);
    const tok = (w, n = 0) => tokens.filter(t => t.type === 'word' && t.text.trim() === w)[n].i;
    const sl = newSlide({layout: 'liste', title: 'Was hilft', text: 'Gewerkschaft und Zahlen\nStreik seit Jahren\nSolidarität und Organisierung', a: tok('Gewerkschaft'), b: tok('seit.'), build: true});
    const zw = newSlide({layout: 'zwei', title: 'Zwei Seiten', text: 'Fakten\nRegierung', text2: 'Wissen\nWohnung', a: tok('Aber'), b: tok('der.'), build: true});
    const ti = newSlide({layout: 'titel', title: 'Ohne Aufbau', a: tok('An'), b: tok('Gewerkschaft.'), build: true});
    commit(() => P.slides.push(sl, zw, ti), false); window._sl = sl.id; window._zw = zw.id;
    await slPlaceAll();
    const it = P.items.find(x => x.slide === sl.id), iz = P.items.find(x => x.slide === zw.id), i3 = P.items.find(x => x.slide === ti.id); window._it = it.id;
    const px = async uri => { const im = new Image(); im.src = MEDIA(uri); await im.decode(); const c = document.createElement('canvas'); c.width = 320; c.height = 180; const x = c.getContext('2d'); x.drawImage(im, 0, 0, 320, 180); return x.getImageData(0, 0, 320, 180).data; };
    const diffs = async it => { const full = await px(it.clip.uri), out = []; for (const b of it.build){ const a = await px(b.clip.uri); let d = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - full[i]) + Math.abs(a[i + 1] - full[i + 1]) + Math.abs(a[i + 2] - full[i + 2]) > 24) d++; out.push(d); } return out; };
    return { steps: [slStepsOf(sl), slStepsOf(zw), slStepsOf(ti)], range: itemOutRange(it), build: it.build.map(b => [b.t, b.a || 0, b.clip.uri.split('/').pop()]), names: it.build.map(b => b.clip.name), d: await diffs(it),
      zb: iz.build.map(b => [b.t, b.a || 0]), dz: await diffs(iz), t3: !!i3.build, n: P.items.filter(x => x.slide).length, deck: !!window.HC_DECK_ON }; });
  chk('Stichpunkt-Folie mit Aufbau: ein Element mit drei Schritten, je Schritt ein Bild; „Zwei Seiten“ in zwei Schritten; die Titelfolie bleibt ein Bild',
    !f0.deck && f0.steps.join() === '3,2,1' && f0.n === 3 && f0.build.length === 3 && f0.build[0][0] === 0 && new Set(f0.build.map(b => b[2])).size === 3 && f0.zb.length === 2 && !f0.t3 && /Schritt 1 von 3/.test(f0.names[0]), f0);
  chk('Bilder der Schritte: Mit jedem Schritt kommt etwas dazu, das letzte ist die ganze Folie', f0.d[2] === 0 && f0.d[0] > f0.d[1] && f0.d[1] > 0 && f0.dz[1] === 0 && f0.dz[0] > 0, [f0.d, f0.dz]);
  chk('Zeiten aus dem gesprochenen Text: Jeder Schritt beginnt mit dem Satz, in dem sein Stichpunkt fällt', near(f0.build[1][0], 10.48 - f0.range[0], 0.2) && near(f0.build[2][0], 15.41 - f0.range[0], 0.2) && f0.build.every(b => !b[1]), [f0.range, f0.build.map(b => b[0])]);
  await ev(() => setTab('studio')); await sleep(300);
  const seen = [];
  for (const [t, want] of [[6, 0], [12, 1], [17, 2]]){ await ev(t => seekOut(t, false), t); await sleep(450);
    seen.push(await ev(want => { const it = P.items.find(x => x.id === _it), el = layers.get(it.id); return [decodeURIComponent(el.src).split('/').pop() === it.build[want].clip.uri.split('/').pop(), buildAt(it, outPos - ovOf(it).at)]; }, want)); }
  chk('Vorschau: Zu jeder Zeit steht das Bild des laufenden Schritts auf der Bühne', seen.every((s, j) => s[0] && s[1] === j), seen);
  await ev(() => seekOut(12, false)); await sleep(300); await shot('aufbau-schritt2', page, { x: 440, y: 95, width: 600, height: 345 });
  const fp = await ev(() => { const it = P.items.find(x => x.id === _it), names = it.build.map(b => b.clip.uri.split('/').pop()); return { plan: buildPlan(true).overlays.filter(o => names.includes(o.uri.split('/').pop())).map(o => [o.at, o.out, o.track, o.uri.split('/').pop()]),
    marks: [...document.querySelectorAll(`#trOvlBox .blk[data-id="${it.id}"] .stp`)].length, cls: document.querySelector(`#trOvlBox .blk[data-id="${it.id}"]`).className }; });
  chk('Exportplan: drei Bilder lückenlos nacheinander auf einer Spur; die Zeitleiste zeigt die Schritte als Marken im Element',
    fp.plan.length === 3 && fp.plan.every((p, i) => i === 0 || near(p[0], fp.plan[i - 1][0] + fp.plan[i - 1][1], 0.002)) && new Set(fp.plan.map(p => p[2])).size === 1 && near(fp.plan[0][0], f0.range[0], 0.002)
    && near(fp.plan[2][0] + fp.plan[2][1], f0.range[1], 0.002) && fp.marks === 2 && /build/.test(fp.cls), fp);
  await ev(() => select({kind: 'ovl', id: _it})); await sleep(200);
  const tb = await tools();
  chk('Werkzeuge der Aufbau-Folie: „Schritt hierher“ und „Aufbau“', tb.some(t => t.endsWith('Schritt hierher')) && tb.some(t => t.endsWith('Aufbau')), tb.filter(t => /Schritt|Aufbau/.test(t)));
  const sh = await ev(() => { const it = P.items.find(x => x.id === _it); seekOut(12.5, false); stepHere(it); return { build: it.build.map(b => [b.t, b.a || 0]), at: ovOf(it).at, toast: document.querySelector('#toast').textContent }; });
  chk('„Schritt hierher“ legt den nächstgelegenen Schritt an die Abspiellinie', near(sh.build[1][0], 12.5 - sh.at, 0.02) && !sh.build[1][1] && /Schritt 2/.test(sh.toast), sh);
  await selTool('Aufbau', true); await sleep(300);
  const bd = await ev(() => ({ form: !!document.querySelector('#bdForm'), rows: [...document.querySelectorAll('.bd-list button')].map(b => b.textContent.replace(/\s+/g, ' ').trim()) }));
  await page.click('#bdEven'); await sleep(200);
  const ev1 = await ev(() => { const it = P.items.find(x => x.id === _it); return { build: it.build.map(b => [b.t, b.a || 0]), dur: slDur(it) }; });
  await page.click('#bdText'); await sleep(200);
  const ev2 = await ev(() => { const it = P.items.find(x => x.id === _it); return it.build.map(b => [b.t, b.a || 0]); });
  chk('Blatt „Aufbau“: Liste der Schritte; „Gleichmäßig verteilen“ und „Nach dem gesprochenen Text“',
    bd.form && bd.rows.length === 3 && /^Schritt 1/.test(bd.rows[0]) && near(ev1.build[1][0], ev1.dur / 3, 0.02) && near(ev1.build[2][0], 2 * ev1.dur / 3, 0.02) && ev1.build[1][1] === 1 && near(ev2[1][0], f0.build[1][0], 0.02) && !ev2[1][1], [bd.rows, ev1, ev2]);
  await page.click('#bdOk'); await sleep(200);
  const tr = await ev(() => { const it = P.items.find(x => x.id === _it); stepsAuto(it, true); commit(() => { it.out = r3(it.out - 6); computeOverlays(); slRetime(it); }, true); return { build: it.build.map(b => [b.t, b.a || 0]), dur: slDur(it) }; });
  chk('Kürzen: Verteilte Schritte rücken zusammen und bleiben im Element', tr.build.every(b => b[0] < tr.dur) && near(tr.build[1][0], tr.dur / 3, 0.02), tr);
  const offOn = await ev(async () => { const sl = P.slides.find(s => s.id === _sl); await slBuildSet(sl, false); const it = P.items.find(x => x.slide === sl.id), a = [!!it.build, !!sl.build, P.items.filter(x => x.slide === sl.id).length, document.querySelector('#toast').textContent];
    await slBuildSet(sl, true); const i2 = P.items.find(x => x.slide === sl.id); return { off: a, on: [i2.build && i2.build.length, !!sl.build, document.querySelector('#toast').textContent] }; });
  chk('Aufbau aus: wieder ein Bild; Aufbau an: die Schritte sind zurück', !offOn.off[0] && !offOn.off[1] && offOn.off[2] === 1 && /auf einmal/.test(offOn.off[3]) && offOn.on[0] === 3 && offOn.on[1] && /3 Schritten/.test(offOn.on[2]), offOn);
  // N im Studio: Folie einsetzen, dann mit N Schritt für Schritt weiter
  const nn = await ev(async () => {
    const sl = P.slides.find(s => s.id === _sl); commit(() => { P.items = P.items.filter(x => !x.slide); }, true); const out = [];
    seekOut(30, false); await slNext(); const it = P.items.find(x => x.slide === sl.id); out.push([itemOutRange(it)[0], it.build.map(b => b.t)]);
    seekOut(33, false); await slNext(); out.push(it.build.map(b => [b.t, b.a || 0]), document.querySelector('#toast').textContent);
    seekOut(36, false); await slNext(); out.push(it.build.map(b => [b.t, b.a || 0]), document.querySelector('#toast').textContent);
    seekOut(40, false); slClose(); out.push(itemOutRange(it), P.items.filter(x => x.slide === sl.id).length);
    return out; });
  chk('N im Studio: erst erscheint die Folie, jedes weitere N schaltet einen Schritt weiter, dann endet sie',
    near(nn[0][0], 30, 0.05) && near(nn[1][1][0], 3, 0.05) && !nn[1][1][1] && /Schritt 2/.test(nn[2]) && near(nn[3][2][0], 6, 0.05) && /Schritt 3/.test(nn[4]) && near(nn[5][1], 40, 0.06) && nn[6] === 1, nn);
  // Schalter im eingebauten Folien-Reiter
  await ev(() => setTab('slides')); await sleep(400);
  // beim ersten Öffnen fragt der Reiter nach dem Design der Folien
  const firstAsk = await page.$('.sl-choose [data-p]'); if (firstAsk){ await firstAsk.click(); await sleep(900); }
  const sw = await ev(async () => { const sl = P.slides.find(s => s.id === _sl); slCur = sl; renderSlides(); await new Promise(r => setTimeout(r, 250)); const c = document.querySelector('#slBuild'); return { has: !!c, on: c && c.checked, txt: c ? c.closest('label').textContent.trim() : '' }; });
  chk('Folien-Reiter: Schalter „Schritt für Schritt aufbauen“ bei der Stichpunkt-Folie', sw.has && sw.on && /Schritt für Schritt aufbauen \(3 Schritte/.test(sw.txt), sw);
  if (sw.has){ await page.click('#slBuild'); await sleep(900);
    const s2 = await ev(() => { const sl = P.slides.find(s => s.id === _sl), it = P.items.find(x => x.slide === sl.id); return [!!sl.build, !!(it && it.build)]; });
    chk('Schalter aus: Folie und eingesetztes Element ohne Aufbau', !s2[0] && !s2[1], s2); }
  await ev(() => setTab('studio')); await sleep(300);
  // ═════════ Echte Exporte, am Schachbrett ausgemessen ═════════
  await leave();
  const idK = await newProject(page, [MEDIA + 'karo.mp4']); made.push(idK);
  await ev(() => { commit(() => { P.dels = [[6, 12]]; }, true); setTab('studio'); }); await sleep(600);
  await ev(() => {
    const mk = o => { const it = {id: newId(), at: 0, dur: 6, x: 0.5, y: 0.5, w: 0.2, ar: 1, ...o}; P.items.push(it); return it.id; };
    commit(() => {
      window._px = mk({type: 'blur', kind: 'pixel', form: 'rect', str: 1, at: 0.5, dur: 2, x: 0.25, y: 0.5, w: 0.2, ar: 1});
      window._el = mk({type: 'blur', kind: 'soft', form: 'ellipse', str: 2, at: 0.5, dur: 4, x: 0.7, y: 0.3, w: 0.1, ar: 0.8, kf: [{t: 0, x: 0.7, y: 0.3, w: 0.1}, {t: 4, x: 0.8, y: 0.6, w: 0.2}]});
      window._cv = mk({type: 'blur', kind: 'cover', form: 'rect', color: '#000000', at: 3, dur: 2, x: 0.25, y: 0.5, w: 0.2, ar: 1});
      window._fr = mk({type: 'shape', kind: 'rect', color: '#E5402A', thick: 3, at: 0.5, dur: 2, x: 0.25, y: 0.5, w: 0.25, ar: 1});
      window._pt = mk({type: 'shape', kind: 'ellipse', fill: true, color: '#FFE14D', at: 0, dur: 6, x: 0.2, y: 0.85, w: 0.05, ar: 1, kf: [{t: 0, x: 0.2, y: 0.85, w: 0.05}, {t: 6, x: 0.8, y: 0.85, w: 0.05}]});
      P.progress = {on: true, pos: 'u', size: 3, color: '#3E8A55', bg: true};
    }, true); });
  await sleep(300);
  // Was die Vorschau zur Ausgabezeit t erwartet: Bereiche in Pixeln, Mitte des Punkts, Anteil des Balkens
  const expect = t => ev(t => { const reg = id => { const it = P.items.find(x => x.id === id), a = ovOf(it); if (!a || t < a.at - 1e-6 || t >= a.end) return null; const r = blurBoxes(it, t - a.at, 640, 360).reg; return [r[0], r[1], r[0] + r[2] - 1, r[1] + r[3] - 1].map(v => Math.round(v)); };
    const pt = P.items.find(x => x.id === _pt), ap = ovOf(pt), v = ap && t >= ap.at && t < ap.end ? elVals(pt, t - ap.at) : null;
    return { px: reg(_px), el: reg(_el), cv: reg(_cv), pt: v && [Math.round(v.x * 640), Math.round(v.y * 360)], bar: t / total, total }; }, t);
  // neutrale Mittelwerte (gemitteltes Schachbrett) in einem Ausschnitt des Farbbilds; die Zeilen des Balkens bleiben außen vor
  const mids = (c, x0, x1, y0 = 0, y1 = H - 10) => { const cx = new Int32Array(W), cy = new Int32Array(H); let n = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++){ const [r, g, b] = px(c, x, y); if (r > 70 && r < 180 && Math.abs(r - g) < 14 && Math.abs(g - b) < 14){ cx[x]++; cy[y]++; n++; } }
    const xs = [...cx.keys()].filter(x => cx[x] >= 3), ys = [...cy.keys()].filter(y => cy[y] >= 3);
    return xs.length && ys.length ? [xs[0], ys[0], xs[xs.length - 1], ys[ys.length - 1], n] : null; };
  const isCol = (p, want, tol = 34) => p.every((v, i) => Math.abs(v - want[i]) <= tol);
  const barEdge = c => { let last = -1; for (let x = 0; x < W; x++){ const p = px(c, x, H - 3); if (p[1] > p[0] + 40 && p[1] > p[2] + 25) last = x; } return last; };
  const pv0 = await ev(async () => { seekOut(1, false); await new Promise(r => setTimeout(r, 600)); const f = document.querySelector(`#blurOv canvas[data-mk="${_px}"]`), s = document.querySelector(`#blurOv canvas[data-mk="${_el}"]`), d = f.getContext('2d').getImageData(0, 0, f.width, f.height).data; let lo = 255, hi = 0; for (let i = 0; i < d.length; i += 4){ lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); }
    return { n: [f.width, f.height, s.width], lo, hi, shapes: document.querySelectorAll('#shapeOv canvas').length, prog: document.querySelector('#progOv i').style.transform }; });
  chk('Vorschau am Schachbrett: Der verpixelte Bereich zeigt gemitteltes Grau (sechs mal sechs Felder), Formen und Balken liegen darüber', pv0.n[0] === 6 && pv0.n[1] === 6 && pv0.lo > 90 && pv0.hi < 170 && pv0.shapes === 2 && /scaleX\(0\.16/.test(pv0.prog), pv0);
  await shot('vorschau', page, { x: 440, y: 95, width: 600, height: 345 });
  const x1 = await exportNow('belege_alles');
  chk('Export mit zwei Bereichen, Abdecken, zwei Formen und Fortschrittsbalken läuft durch', x1.ok && x1.plan.blurs.length === 2 && x1.plan.overlays.filter(o => o.top).length === 5, x1.error || [x1.plan.blurs && x1.plan.blurs.length, x1.plan.overlays.length]);
  if (x1.ok){
    const e30 = await expect(1), e105 = await expect(3.5), e150 = await expect(5);
    const c30 = frame(x1.file, 30, 'rgb24'), c76 = frame(x1.file, 78, 'rgb24'), c105 = frame(x1.file, 105, 'rgb24'), c150 = frame(x1.file, 150, 'rgb24');
    const l30 = mids(c30, 0, 320), r30 = mids(c30, 320, W);
    chk('fertiges Video, 1,0 s: Das verpixelte Rechteck sitzt, wo die Vorschau es zeigt – [96, 224) × [116, 244)', nearBox(l30, e30.px, 2) && e30.px.join() === '96,116,223,243' && Math.abs(l30[4] - 128 * 128) < 600, [l30, e30.px]);
    chk('1,0 s: Die weichgezeichnete Ellipse liegt an der Stelle ihres Keyframe-Verlaufs', nearBox(r30, e30.el, 3) && Math.abs(r30[4] / ((e30.el[2] - e30.el[0] + 1) * (e30.el[3] - e30.el[1] + 1)) - Math.PI / 4) < 0.07, [r30, e30.el]);
    chk('1,0 s: Der rote Rahmen liegt scharf um den Bereich, der gelbe Punkt an seiner Stelle', isCol(px(c30, 83, 180), [229, 64, 42]) && isCol(px(c30, 160, 103), [229, 64, 42]) && isCol(px(c30, e30.pt[0], e30.pt[1]), [255, 225, 77]) && !isCol(px(c30, e30.pt[0] + 40, e30.pt[1]), [255, 225, 77]), [px(c30, 83, 180), px(c30, e30.pt[0], e30.pt[1]), e30.pt]);
    chk('1,0 s: Der Fortschrittsbalken ist zu einem Sechstel gefüllt, daneben liegt die Grundlinie', near(barEdge(c30), W * e30.bar, 4) && isCol(px(c30, 40, H - 3), [62, 138, 85], 30) && px(c30, 400, H - 3).every(v => v < 170), [barEdge(c30), px(c30, 40, H - 3), px(c30, 400, H - 3)]);
    chk('2,6 s: Das Rechteck ist vorbei – links steht wieder das Schachbrett, der Rahmen ist weg', mids(c76, 0, 320) === null && !isCol(px(c76, 83, 180), [229, 64, 42]), [mids(c76, 0, 320), px(c76, 83, 180)]);
    let dark = 0, tot = 0; for (let y = e105.cv[1] + 3; y < e105.cv[3] - 2; y++) for (let x = e105.cv[0] + 3; x < e105.cv[2] - 2; x++){ tot++; if (px(c105, x, y).every(v => v < 40)) dark++; }
    chk('3,5 s: Die abgedeckte Fläche ist durchgehend schwarz, die Ellipse ist weitergewandert und gewachsen', dark === tot && tot > 14000 && nearBox(mids(c105, 320, W), e105.el, 3) && e105.el[2] - e105.el[0] > e30.el[2] - e30.el[0] + 20, [dark, tot, mids(c105, 320, W), e105.el]);
    chk('5,0 s: keine Bereiche mehr; Punkt und Balken sind weitergelaufen', mids(c150, 0, W) === null && e150.el === null && isCol(px(c150, e150.pt[0], e150.pt[1]), [255, 225, 77]) && e150.pt[0] > e30.pt[0] + 200 && near(barEdge(c150), W * e150.bar, 4), [mids(c150, 0, W), e150.pt, barEdge(c150)]);
    const nfr = +execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=nb_read_frames', '-of', 'csv=p=0', x1.file]).toString().trim();
    chk('Länge unverändert: 180 Bilder', nfr === 180, nfr);
  }
  // Schnitte und Stückelung: acht Abschnitte (das erste Stück endet nach dem sechsten), alles sitzt weiter an seiner Stelle im Video
  await ev(() => { commit(() => { P.dels = [[0.7, 0.8], [1.4, 1.5], [2.1, 2.2], [2.8, 2.9], [3.5, 3.6], [4.2, 4.3], [4.9, 5.0], [6, 12]]; }, true); }); await sleep(400);
  const cutInfo = await ev(() => ({ segs: timeline.filter(g => g.kind === 'main').length, total, el: (() => { const a = ovOf(P.items.find(x => x.id === _el)); return [a.at, a.end]; })() }));
  const x2 = await exportNow('belege_stuecke');
  chk('Export in Stücken (acht Abschnitte) läuft durch', x2.ok && cutInfo.segs === 8 && near(cutInfo.total, 5.3, 0.01), x2.error || cutInfo);
  if (x2.ok){
    const res = [];
    for (const n of [30, 108, 114, 140]){ const t = n / 30, e = await expect(t), c = frame(x2.file, n, 'rgb24'); res.push({ n, el: [mids(c, 320, W), e.el], ok: (e.el ? nearBox(mids(c, 320, W), e.el, 3) : mids(c, 320, W) === null), bar: [barEdge(c), Math.round(W * e.bar)], pt: e.pt && isCol(px(c, e.pt[0], e.pt[1]), [255, 225, 77]) }); }
    chk('Stückelung: Die Ellipse liegt vor und hinter der Grenze der Stücke (3,7 s) an der Stelle der Vorschau und endet zur rechten Zeit', res.every(r => r.ok) && res[1].el[1] && res[2].el[1] && res[3].el[1] === null, res.map(r => r.el));
    chk('Stückelung: Fortschrittsbalken und wandernder Punkt laufen über die Grenze hinweg weiter', res.every(r => near(r.bar[0], r.bar[1], 4) && r.pt), res.map(r => [r.bar, r.pt]));
  }
  // CapCut: Formen und die abgedeckte Fläche als Bilder auf eigenen Spuren, kein Balken, keine Bereiche
  const x3 = await exportNow('belege_capcut', 'capcut');
  const draft = x3.ok && (x3.files || []).map(f => path.join(f, 'draft_content.json')).find(f => fs.existsSync(f));
  const tracks = draft ? JSON.parse(fs.readFileSync(draft, 'utf8')).tracks.filter(t => t.type === 'video').map(t => [t.name, t.segments.length]) : [];
  const formT = tracks.filter(t => /^Formen /.test(t[0]));
  chk('CapCut-Projekt: Rahmen, abgedeckte Fläche und Punkt als Bilder auf den Spuren „Formen 1“ und „Formen 2“ (was sich zeitlich nicht überschneidet, teilt sich eine); kein Fortschrittsbalken',
    x3.ok && formT.length === 2 && formT.reduce((s, t) => s + t[1], 0) === 3 && !x3.plan.blurs && !x3.plan.overlays.some(o => o.progress), x3.error || tracks);

  // Titelbild: Bereiche und Formen an der Abspiellinie stecken auch im Titelbild
  const cov = await ev(async () => { commit(() => { P.dels = [[6, 12]]; }, true); seekOut(1, false); await new Promise(r => setTimeout(r, 500));
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360; const x = cv.getContext('2d', {willReadFrequently: true}); x.drawImage(document.querySelector('#v'), 0, 0, 640, 360);
    const span = (x0, y0, x1, y1) => { const d = x.getImageData(x0, y0, x1 - x0, y1 - y0).data; let lo = 255, hi = 0; for (let i = 0; i < d.length; i += 4){ lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); } return hi - lo; };
    const before = span(110, 130, 210, 230); coverMarks(cv);
    return { before, after: span(110, 130, 210, 230), outside: span(20, 130, 70, 230), frame: [...x.getImageData(83, 180, 1, 1).data.slice(0, 3)] }; });
  chk('Titelbild: Der Bereich ist auch dort unkenntlich, die Form liegt darüber', cov.before > 150 && cov.after < 40 && cov.outside > 150 && cov.frame[0] > 200 && cov.frame[1] < 110, cov);

  // ═════════ Formen und Bereiche bleiben am Bild (anderes Format, verschobener Ausschnitt, Clip, Export-Paket) ═════════
  await leave();
  await ev(i => openProject(i), idA); await page.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i, idA, { timeout: 30000 }); await sleep(500);
  await ev(() => { setTab('studio'); }); await sleep(500);
  // Stelle des Hauptbilds (Anteile 0 … 1), die unter der Mitte einer Marke liegt – abgelesen an der Vorschau selbst: Das Videoelement
  // trägt Zoom und Versatz als CSS-Transformation, das Bild liegt eingepasst in seiner Mitte
  const under = id => ev(id => { const it = P.items.find(x => x.id === id), s = document.querySelector('#stage').getBoundingClientRect(), e = document.querySelector('#v').getBoundingClientRect(), [wf, hf] = fitFrac();
    const v = { width: e.width * wf, height: e.height * hf, left: e.left + e.width * (1 - wf) / 2, top: e.top + e.height * (1 - hf) / 2 };
    return { u: (s.left + it.x * s.width - v.left) / v.width, v: (s.top + it.y * s.height - v.top) / v.height, wu: it.w * s.width / v.width, x: it.x, y: it.y, w: it.w, fr: it.fr, kf: it.kf ? it.kf.map(k => [k.x, k.y, k.w]) : null, fmt: P.format || null, frame: P.frame || null, ar: it.ar }; }, id);
  const idF = await ev(() => { commit(() => { P.items = P.items.filter(x => !isMark(x) && x.type !== 'zoom'); delete P.format; delete P.frame; }, true); seekOut(50, false); const it = addMarkItem('blur');
    commit(() => { it.x = 0.3; it.y = 0.42; it.w = 0.1; it.kf = [{t: 0, x: 0.3, y: 0.42, w: 0.1}, {t: 3, x: 0.36, y: 0.5, w: 0.14}]; }, true); select(null); seekOut(50, false); window._f = it.id; return it.id; });
  await sleep(350);
  const p0 = await under(idF);
  chk('Ausgangslage (Projektformat 16:9): Der Bereich liegt auf der Stelle (0,30 | 0,42) des Bilds und trägt seinen Bildausschnitt', near(p0.u, 0.3, 0.004) && near(p0.v, 0.42, 0.004) && Array.isArray(p0.fr) && p0.fr.join() === '1,1,0,0', p0);
  await ev(() => { commit(() => { P.format = '9:16'; P.frame = clampFrame({sc: coverSc(), tx: 0, ty: 0}); }, true); frameRestored(true); }); await sleep(600);
  const p1 = await under(idF);
  chk('Format auf 9:16 gestellt: Der Bereich rückt mit und liegt weiter auf derselben Stelle des Bilds, gleich groß im Bild; das Seitenverhältnis bleibt',
    p1.fmt === '9:16' && near(p1.u, p0.u, 0.004) && near(p1.v, p0.v, 0.004) && near(p1.wu, p0.wu, 0.003) && Math.abs(p1.x - p0.x) > 0.05 && p1.w > p0.w * 2 && p1.ar === p0.ar && p1.kf[1][2] > p0.kf[1][2] * 2, [p0, p1]);
  await ev(() => { setFrame({...P.frame, tx: P.frame.tx + 0.25}); }); await sleep(400);
  const p2 = await under(idF);
  chk('Bildausschnitt verschoben: Der Bereich wandert mit dem Bild', near(p2.u, p0.u, 0.004) && near(p2.v, p0.v, 0.004) && near(p2.x - p1.x, p2.frame.tx - p1.frame.tx, 0.002) && Math.abs(p2.frame.tx - p1.frame.tx) > 0.2, [p1.x, p2.x, p1.frame, p2.frame]);
  await ev(() => { commit(() => { P.format = '1:1'; P.frame = clampFrame({sc: 1, tx: 0, ty: 0}); }, true); frameRestored(true); }); await sleep(600);
  const p3 = await under(idF);
  chk('Format 1:1, Bild ganz zu sehen (mit Rändern): gleiche Stelle im Bild', near(p3.u, p0.u, 0.004) && near(p3.v, p0.v, 0.004) && near(p3.wu, p0.wu, 0.003), p3);
  await ev(() => { for (let k = 0; k < 2; k++) document.querySelector('#undoBtn').click(); }); await sleep(600);
  const p4 = await under(idF);
  chk('Rückgängig bis zum Ausgangsformat: Lage und Keyframes stehen wieder genau wie vorher', p4.fmt === null && p4.x === 0.3 && p4.y === 0.42 && p4.w === 0.1 && JSON.stringify(p4.kf) === JSON.stringify(p0.kf) && p4.fr.join() === '1,1,0,0', p4);
  // Export-Paket im Hochformat: Der Plan trägt die nachgeführte Lage, das Projekt bleibt, wie es ist
  const pk = await ev(() => { const it = P.items.find(x => x.id === _f), e = PACK.find(q => q.id === 'hoch'); const before = JSON.stringify([it.x, it.y, it.w, it.kf, it.fr]);
    const r = packWith(e, () => { const L = markFrame(), p = buildPlan(true); return { L, b: p.blurs[0], size: outSize() }; });
    return { r, same: before === JSON.stringify([it.x, it.y, it.w, it.kf, it.fr]), fmt: P.format || null }; });
  chk('Export-Paket 9:16: Im Plan liegt der Bereich auf derselben Stelle des Bilds (umgerechnet auf die hohe Leinwand); danach steht im Projekt alles unverändert',
    pk.same && pk.fmt === null && pk.r.size[0] < pk.r.size[1] && near(pk.r.b.kf[0].x, 0.5 + pk.r.L[2] + (0.3 - 0.5) * pk.r.L[0], 0.002) && near(pk.r.b.kf[0].y, 0.5 + pk.r.L[3] + (0.42 - 0.5) * pk.r.L[1], 0.002)
    && near(pk.r.b.kf[0].w, 0.1 * pk.r.L[0], 0.002) && near(pk.r.b.wmax, 0.14 * pk.r.L[0], 0.002) && pk.r.L[0] > 2, pk);
  // Clip im Hochformat: Der Bereich kommt mit und sitzt auf derselben Stelle des Bilds
  const clipId = await ev(async () => { const c = clipData([[48, 56]], '9:16', 'Belege-Clip'); openClip(c, ''); return c.id; });
  made.push(clipId);
  await page.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i && !!P.frame, clipId, { timeout: 30000 }); await sleep(900);
  const pcl = await ev(async () => { setTab('studio'); await new Promise(r => setTimeout(r, 500)); const it = P.items.find(isMark); if (!it) return null; const a = ovOf(it); seekOut(a.at + 0.05, false); await new Promise(r => setTimeout(r, 400));
    const s = document.querySelector('#stage').getBoundingClientRect(), e = document.querySelector('#v').getBoundingClientRect(), k = it.kf[0], [wf, hf] = fitFrac();
    const v = { width: e.width * wf, height: e.height * hf, left: e.left + e.width * (1 - wf) / 2, top: e.top + e.height * (1 - hf) / 2 };
    return { n: P.items.filter(isMark).length, u: (s.left + k.x * s.width - v.left) / v.width, v: (s.top + k.y * s.height - v.top) / v.height, wu: k.w * s.width / v.width, fmt: P.format, x: k.x, fr: it.fr, cv: !!document.querySelector('#blurOv canvas') }; });
  chk('Clip im Hochformat aus dem Projekt: Der Bereich ist dabei und verdeckt dieselbe Stelle des Bilds', pcl && pcl.n === 1 && pcl.fmt === '9:16' && near(pcl.u, 0.3, 0.005) && near(pcl.v, 0.42, 0.005) && near(pcl.wu, 0.1, 0.003) && pcl.cv, pcl);
  await shot('clip-hochformat', page, { x: 440, y: 95, width: 600, height: 345 });
  await leave();
  await ev(i => openProject(i), idA); await page.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i, idA, { timeout: 30000 }); await sleep(500);
  // Bewegt sich das Bild unter dem Bereich (Zoom), sagt die Oberfläche es deutlich
  const mvW = await ev(async () => { setTab('studio'); await new Promise(r => setTimeout(r, 300)); const it = P.items.find(x => x.id === _f) || P.items.find(isMark); window._f = it.id; const before = markMoves(it);
    commit(() => { P.items.push({id: newId(), type: 'zoom', at: it.at + 0.5, dur: 1.5, kind: 'in', strength: 1.3, cx: 0.5, cy: 0.5}); }, true);
    openMark(it.id); await new Promise(r => setTimeout(r, 250)); const warn = document.querySelector('#mkWarn').textContent; closeSheet();
    exFmt = 'video'; setTab('export'); await new Promise(r => setTimeout(r, 300)); const bn = document.querySelector('#exBlurNote');
    return { before, after: markMoves(it), warn, note: bn.textContent, cls: bn.className }; });
  chk('Zoom über dem Bereich: Das Blatt und der Export-Reiter weisen darauf hin, dass sich das Bild darunter bewegt',
    !mvW.before && mvW.after && /^Achtung: An dieser Stelle bewegt sich das Bild/.test(mvW.warn) && /Ein unkenntlich gemachter Bereich liegt an einer Stelle, an der sich das Bild bewegt/.test(mvW.note) && /warn/.test(mvW.cls) && !/hidden/.test(mvW.cls), mvW);
  await ev(() => { commit(() => { P.items = P.items.filter(x => x.type !== 'zoom'); }, true); setTab('studio'); }); await sleep(300);

  // ═════════ Am Handy (390 × 844) ═════════
  await leave();
  const mob = await launch({ viewport: { width: 390, height: 844 }, dpr: 2 }), hp = mob.page, pe = (f, a) => hp.evaluate(f, a);
  try {
    await hp.evaluate(i => openProject(i), idA); await hp.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i, idA, { timeout: 30000 }); await sleep(500);
    await pe(() => { setTab('studio'); }); await sleep(600);
    await pe(() => { select(null); seekOut(8, false); addShapeMenu(); }); await sleep(350);
    // Blatt passt in die Breite; ist es höher als der Platz, lässt es sich bis zum letzten Knopf rollen
    const fits = () => pe(() => { const b = document.querySelector('#sheetBody'), r = b.getBoundingClientRect(); const over = [...b.querySelectorAll('button, input, .seg-ctl, .swatches, .choice')].filter(el => { const q = el.getBoundingClientRect(); return q.width > 0 && (q.left < -1 || q.right > innerWidth + 1); }).length;
      const btns = [...b.querySelectorAll('button')].filter(el => el.getBoundingClientRect().width > 0), last = btns[btns.length - 1]; let reach = false;
      if (last){ last.scrollIntoView({ block: 'end' }); const q = last.getBoundingClientRect(); reach = q.top >= 0 && q.bottom <= innerHeight + 1; b.scrollTop = 0; if (b.parentElement) b.parentElement.scrollTop = 0; }
      return { open: !document.querySelector('#sheet').classList.contains('hidden'), wide: b.scrollWidth <= b.clientWidth + 1, inside: r.left >= -1 && r.right <= innerWidth + 1 && reach, over }; });
    const m1 = await fits(); await shot('handy-formwahl', hp);
    await hp.click('.choice.shapes [data-k="arrow"]'); await sleep(450);
    const m2 = await fits(); const m2b = await pe(() => ({ form: !!document.querySelector('#mkForm'), dirs: document.querySelectorAll('#mkDir button').length, cv: document.querySelectorAll('#shapeOv canvas').length })); await shot('handy-form', hp);
    chk('Handy: Formwahl und Blatt „Form“ passen in die Breite, alle Schalter sind erreichbar', m1.open && m1.wide && m1.inside && !m1.over && m2.open && m2.wide && m2.inside && !m2.over && m2b.form && m2b.dirs === 8 && m2b.cv === 1, { m1, m2, m2b });
    await hp.click('#mkOk'); await sleep(250);
    // im Bild mit dem Finger verschieben
    const c0 = await rect('#shapeOv canvas', hp), i0 = await pe(() => { const it = P.items[P.items.length - 1]; window._h = it.id; return [it.x, it.y]; });
    await drag(c0[0] + c0[2] / 2, c0[1] + c0[3] / 2, c0[0] + c0[2] / 2 + 40, c0[1] + c0[3] / 2 + 25, hp);
    const i1 = await pe(() => { const it = P.items.find(x => x.id === _h); return [it.x, it.y]; });
    chk('Handy: Die Form lässt sich im Bild verschieben', i1[0] > i0[0] + 0.05 && i1[1] > i0[1] + 0.05, [i0, i1]);
    await pe(() => { select(null); addMarkItem('blur'); const it = P.items[P.items.length - 1]; openMark(it.id); }); await sleep(450);
    const m3 = await fits(); await shot('handy-bereich', hp); await hp.click('#mkOk'); await sleep(200);
    await pe(() => openProgress()); await sleep(350);
    const m4 = await fits(); await shot('handy-fortschritt', hp);
    chk('Handy: Blätter „Unkenntlich machen“ und „Fortschrittsbalken“ passen in die Breite', m3.open && m3.wide && m3.inside && !m3.over && m4.open && m4.wide && m4.inside && !m4.over, { m3, m4 });
    await pe(() => closeSheet()); await sleep(200);
    const row = await pe(() => { const r = document.querySelector('#trMark').getBoundingClientRect(); return { h: r.height, blks: document.querySelectorAll('#trMark .blk').length, nmk: getComputedStyle(document.querySelector('.tl-body')).getPropertyValue('--nmk').trim() }; });
    chk('Handy: Die Zeitleiste zeigt die Zeile der Formen', row.h > 10 && row.blks >= 2 && +row.nmk >= 1, row);
    // Markieren: Editor füllt den Bildschirm, die Knöpfe bleiben erreichbar
    const hm = await pe(async () => { const it = P.items.find(x => x.mark); if (!it) return null; select({kind: 'ovl', id: it.id}); openMarker(it.id); await new Promise(r => setTimeout(r, 700));
      const im = document.querySelector('#mkxImg').getBoundingClientRect(), ok = document.querySelector('#mkxOk').getBoundingClientRect(), box = document.querySelector('.mkx').getBoundingClientRect();
      return { im: [im.left, im.top, im.right, im.bottom].map(Math.round), ok: [ok.left, ok.top, ok.right, ok.bottom].map(Math.round), box: [box.width, box.height].map(Math.round), rects: document.querySelectorAll('.mkx-r').length, vw: innerWidth, vh: innerHeight }; });
    await shot('handy-markieren', hp);
    chk('Handy: Der Editor zum Markieren füllt den Bildschirm; Bild und „Übernehmen“ liegen im sichtbaren Bereich',
      hm && hm.box[0] === hm.vw && hm.box[1] === hm.vh && hm.im[0] >= 0 && hm.im[2] <= hm.vw && hm.im[1] >= 0 && hm.im[3] <= hm.ok[1] + 1 && hm.ok[3] <= hm.vh && hm.ok[2] <= hm.vw && hm.rects >= 1, hm);
    await hp.click('#mkxCancel'); await sleep(250);
    chk('Handy: keine Fehlermeldungen der Seite', mob.logs.length === 0, mob.logs.slice(0, 5));
  } catch (e) {
    chk('Handy-Prüfung läuft ohne Abbruch durch', false, String(e && e.stack || e).slice(0, 600));
  }
  await hp.evaluate(() => { if (typeof P !== 'undefined' && P){ pausePlay(); clearTimeout(saveT); saveNow(); closeSheet(); closeProject(); } }).catch(() => {});
  await mob.browser.close();
/*TEIL*/
} catch (e) {
  chk('Prüfung läuft ohne Abbruch durch', false, String(e && e.stack || e).slice(0, 700));
}
chk('keine Fehlermeldungen der Seite', logs.length === 0, logs.slice(0, 6));
for (const id of made) await dropScratch(page, id).catch(() => {});
for (const f of trash) try { fs.rmSync(f, { recursive: true, force: true }); } catch (_) {}
await ende(browser);
