// Titelbild mit Vorlage (2.43): die abgespeckte Fassung von HoneyThumb im Export-Reiter. Bild an der Abspiellinie holen, Person
// freistellen (im Prüflauf mit einer eigenen Erkennung), Vorlage, Format, Texte, Hintergrund, Speichern als Bild und für HoneyThumb.
import fs from 'node:fs';
import path from 'node:path';
import { launch, scratch, dropScratch, ids, sleep, pruefung, setPick, OUT } from './drv.mjs';
const { chk, ende } = pruefung('Titelbild mit Vorlage');
const { browser, page, logs } = await launch({ viewport: { width: 1366, height: 768 }, dpr: 1 });
const ev = (f, a) => page.evaluate(f, a);
// Speichern läuft im Prüflauf über die Brücke: das Programm legt die Datei an den vorgegebenen Ort
const dl = async (btn, name) => { const file = path.join(OUT, name); fs.rmSync(file, { force: true }); setPick({ save_any: file }); await ev(() => { document.querySelector('#ctMsg').textContent = ''; }); await page.click(btn);
  await page.waitForFunction(() => /^(Gespeichert|Nicht gespeichert|Das Bild ließ|Die Datei ließ)/.test(document.querySelector('#ctMsg').textContent), null, { timeout: 20000 }); return { name, msg: await ev(() => document.querySelector('#ctMsg').textContent), buf: fs.existsSync(file) ? fs.readFileSync(file) : Buffer.alloc(0) }; };
let nid = null;
try {
  nid = await scratch(page, ids().edit);
  // Eigene Erkennung: eine Ellipse in der Bildmitte gilt als Person
  await ev(() => { window.__seg = 0; HoneyThumbCut.setSegmenter(cv => { window.__seg++; const w = 64, h = Math.round(64 * cv.height / cv.width), a = new Float32Array(w * h); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++){ const dx = (x - w / 2) / (w * 0.22), dy = (y - h * 0.55) / (h * 0.42); a[y * w + x] = dx * dx + dy * dy < 1 ? 1 : 0; } return {data: a, w, h}; }); });
  await ev(() => setTab('export')); await sleep(500);
  chk('Im Export-Reiter steht neben „Titelbild“ der Knopf „Titelbild mit Vorlage“', await ev(() => { const b = document.querySelector('#coverTplBtn'); return !!b && b.offsetParent !== null && /Vorlage/.test(b.textContent) && !!window.HoneyThumb && HoneyThumb.TEMPLATES.length === 10; }));
  await page.click('#coverTplBtn'); await page.waitForFunction(() => document.querySelectorAll('#ctTpls canvas').length === 10 && HCTitelbild.state && HCTitelbild.state.cut, null, { timeout: 20000 });
  const a = await ev(() => { const pv = document.querySelector('#ctPrev'), s = HCTitelbild.state, x = pv.getContext('2d').getImageData(0, 0, pv.width, pv.height).data; let lit = 0; for (let i = 0; i < x.length; i += 400) if (x[i] + x[i + 1] + x[i + 2] > 60) lit++;
    return { ratio: pv.width / pv.height, lit, frame: s.frame.slice(0, 22), cut: !!s.cut.img && !!s.cut.mask, seg: window.__seg, on: document.querySelector('#ctTpls .on')?.dataset.t, fmt: document.querySelector('#ctFmt').value, out: [...document.querySelector('#ctOut').options].map(o => o.textContent), cutBox: document.querySelector('#ctCut').checked }; });
  chk('Das Blatt holt das Bild an der Abspiellinie, stellt die Person frei und zeigt Vorschau und zehn Vorlagen', Math.abs(a.ratio - 16 / 9) < 0.02 && a.lit > 100 && a.frame === 'data:image/jpeg;base64' && a.cut && a.seg === 1 && a.on === 'rechts' && a.cutBox, a);
  chk('Querformat-Video: Format 16:9 mit 1280 × 720 und 1920 × 1080', a.fmt === '16:9' && a.out.join('|') === '1280 × 720|1920 × 1080', a);
  await page.fill('#ctTitle', 'Wer hat das *gesagt*?'); await page.fill('#ctKicker', 'Analyse'); await sleep(300);
  const d1 = await ev(() => { const d = HCTitelbild.build(HCTitelbild.opts()), p = d.layers.find(l => l.slot === 'person'); return { title: d.layers.find(l => l.slot === 'title').text, kicker: d.layers.find(l => l.slot === 'kicker').text, mask: !!p.mask, src: p.src, keep: P.settings.coverTpl.title }; });
  chk('Titel und Rubrik stehen in der Vorlage; die Person trägt ihre Maske; die Angaben liegen im Projekt', d1.title === 'Wer hat das *gesagt*?' && d1.kicker === 'Analyse' && d1.mask && d1.src === 'f1' && d1.keep === 'Wer hat das *gesagt*?', d1);
  await page.click('#ctTpls [data-t="balken"]'); await sleep(400);
  const d2 = await ev(() => { const d = HCTitelbild.build(HCTitelbild.opts()); return { tpl: d.tpl, bg: d.layers[0].fill, row: getComputedStyle(document.querySelector('#ctPersonRow')).display, seg: window.__seg }; });
  chk('„Bild mit Balken“ nimmt das ganze Videobild als Hintergrund; die Regler für die Person verschwinden; freigestellt wird kein zweites Mal', d2.tpl === 'balken' && d2.bg.kind === 'img' && d2.bg.img === 'f1' && d2.row === 'none' && d2.seg === 1, d2);
  await page.click('#ctTpls [data-t="kreis"]'); await sleep(300);
  await page.selectOption('#ctBg', 'blur'); await sleep(300);
  const d3 = await ev(() => HCTitelbild.build(HCTitelbild.opts()).layers[0].fill);
  await page.selectOption('#ctBg', 'color'); await ev(() => { const c = document.querySelector('#ctBgc'); c.value = '#2e5ca6'; c.dispatchEvent(new Event('input', { bubbles: true })); }); await sleep(300);
  const d4 = await ev(() => ({ fill: HCTitelbild.build(HCTitelbild.opts()).layers[0].fill, vis: getComputedStyle(document.querySelector('#ctBgcL')).display }));
  chk('Hintergrund: weichgezeichnetes Videobild oder eine eigene Farbe', d3.kind === 'img' && d3.blur > 0 && d3.img === 'f1' && d4.fill.kind === 'color' && d4.fill.a === '#2e5ca6' && d4.vis !== 'none', { d3, d4 });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYGJAQoAHxcCAh6bH8QAAAAASUVORK5CYII=', 'base64');
  await page.selectOption('#ctBg', 'img'); await page.setInputFiles('#ctBgFile', { name: 'hg.png', mimeType: 'image/png', buffer: png }); await sleep(500);
  const d5 = await ev(() => { const d = HCTitelbild.build(HCTitelbild.opts()); return { fill: d.layers[0].fill, has: /^data:image\/jpeg/.test(d.assets.b1 || '') }; });
  chk('Hintergrund: ein eigenes Bild', d5.fill.kind === 'img' && d5.fill.img === 'b1' && d5.has, d5);
  await ev(() => { for (const [id, v] of [['ctSize', 1.2], ['ctShift', -0.1]]){ const r = document.querySelector('#' + id); r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); } }); await sleep(200);
  const d6 = await ev(() => { const o = HCTitelbild.opts(), p = HCTitelbild.build(o).layers.find(l => l.slot === 'person'), q = HCTitelbild.build({ ...o, size: 1, shift: 0 }).layers.find(l => l.slot === 'person'); return { k: p.w / q.w, dx: (p.x + p.w / 2) - (q.x + q.w / 2), foot: Math.abs((p.y + p.h) - (q.y + q.h)) }; });
  chk('Die Regler vergrößern und verschieben die Person; ihre Unterkante bleibt stehen', Math.abs(d6.k - 1.2) < 0.01 && Math.abs(d6.dx + 160) < 1 && d6.foot < 0.01, d6);
  await page.selectOption('#ctFmt', '9:16'); await sleep(500);
  const f1 = await ev(() => { const pv = document.querySelector('#ctPrev'); return { ratio: pv.width / pv.height, out: [...document.querySelector('#ctOut').options].map(o => o.textContent), n: document.querySelectorAll('#ctTpls canvas').length }; });
  chk('Hochformat 9:16: Vorschau hochkant, Größe 1080 × 1920', Math.abs(f1.ratio - 9 / 16) < 0.02 && f1.out.join() === '1080 × 1920', f1);
  await page.selectOption('#ctFmt', '16:9'); await page.selectOption('#ctAcc', 'blau'); await sleep(400);
  chk('Akzentfarbe Blau färbt den Kreis', await ev(() => HCTitelbild.build(HCTitelbild.opts()).layers.find(l => l.type === 'shape').fill === '#6F9BEA'));

  // ═════════ Speichern ═════════
  const jpg = await dl('#ctSave', 'titelbild-vorlage.jpg');
  chk('„Speichern“ legt ein JPG in 1280 × 720 unter 2 MB ab', jpg.buf[0] === 0xFF && jpg.buf[1] === 0xD8 && jpg.buf.length > 15000 && jpg.buf.length < 2e6 && /1280 × 720/.test(jpg.msg), { msg: jpg.msg, len: jpg.buf.length });
  await page.selectOption('#ctType', 'png'); await page.selectOption('#ctOut', '1920');
  const pn = await dl('#ctSave', 'titelbild-vorlage.png');
  chk('PNG in 1920 × 1080', pn.buf.length > 24 && pn.buf.readUInt32BE(16) === 1920 && pn.buf.readUInt32BE(20) === 1080, { msg: pn.msg });
  const hf = await dl('#ctFile', 'titelbild-vorlage.honeythumb');
  const back = await ev(t => { const d = HoneyThumb.parse(t), p = d.layers.find(l => l.slot === 'person'); return { n: d.layers.length, tpl: d.tpl, mask: !!d.assets[p.mask], src: !!d.assets[p.src], bg: !!d.assets[d.layers[0].fill.img], title: d.layers.find(l => l.slot === 'title').text, assets: Object.keys(d.assets).length }; }, hf.buf.toString('utf8'));
  chk('„Für HoneyThumb sichern“ legt eine .honeythumb-Datei ab, die HoneyThumb lesen kann – mit Maske, Original und Hintergrund', /HoneyThumb/.test(hf.msg) && back.tpl === 'kreis' && back.mask && back.src && back.bg && back.title === 'Wer hat das *gesagt*?' && back.assets === 4, back);

  // ═════════ Neues Bild, Schließen, Wiederkommen ═════════
  await ev(() => seekOut(outPos + 2.5, false)); await sleep(500);
  await page.click('#ctGrab'); await page.waitForFunction(() => window.__seg === 2 && HCTitelbild.state.cut, null, { timeout: 20000 });
  chk('„Bild neu holen“ nimmt das Bild an der neuen Stelle und stellt es frei', await ev(() => Math.abs(HCTitelbild.state.pos - outPos) < 0.02));
  await page.click('#ctNo'); await sleep(300);
  await page.click('#coverBtn'); await sleep(400); await page.click('#cvTpl'); await page.waitForSelector('#ctTpls canvas'); await sleep(600);
  const r1 = await ev(() => ({ title: document.querySelector('#ctTitle').value, on: document.querySelector('#ctTpls .on')?.dataset.t, acc: document.querySelector('#ctAcc').value, seg: window.__seg, bg: document.querySelector('#ctBg').value }));
  chk('Über „Titelbild“ → „Mit Vorlage“ kommt das Blatt mit den gemerkten Angaben wieder; das Bild wird an derselben Stelle weiterverwendet', r1.title === 'Wer hat das *gesagt*?' && r1.on === 'kreis' && r1.acc === 'blau' && r1.seg === 2 && r1.bg === 'img', r1);
  await ev(() => { HoneyThumbCut.setSegmenter(() => { throw new Error('Auf diesem Bild ist keine Person zu erkennen.'); }); seekOut(outPos + 1.2, false); }); await sleep(400);
  await page.click('#ctGrab'); await page.waitForFunction(() => /ohne Freistellung/.test(document.querySelector('#ctMsg').textContent), null, { timeout: 20000 });
  const e1 = await ev(() => { const p = HCTitelbild.build(HCTitelbild.opts()).layers.find(l => l.slot === 'person'); return { img: p.img, mask: p.mask || null, lit: document.querySelector('#ctPrev').width > 0 }; });
  chk('Findet die Erkennung keine Person, steht das Bild ohne Freistellung in der Vorlage, mit Hinweis', e1.img === 'f1' && e1.mask === null && e1.lit, e1);
  await page.click('#ctNo');
} catch (e) { chk('Ablauf ohne Abbruch', false, String(e && e.stack || e).slice(0, 700)); }
finally { if (nid) await dropScratch(page, nid).catch(() => {}); }
const rest = logs.filter(l => !/Titelbild, Freistellen: Auf diesem Bild ist keine Person/.test(l));   // der Hinweis aus der letzten Prüfung ist gewollt
chk('keine weiteren Meldungen der Seite', rest.length === 0, rest.slice(0, 6));
await ende(browser);
