// Titelbild mit Vorlage (2.43, 2.44: Markenunterlagen aus HoneyThumb, Pinselbalken, Titelbild als erstes Bild des Videos): die abgespeckte Fassung von HoneyThumb im Export-Reiter. Bild an der Abspiellinie holen, Person
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
  chk('Im Export-Reiter steht neben „Titelbild“ der Knopf „Titelbild mit Vorlage“', await ev(() => { const b = document.querySelector('#coverTplBtn'); return !!b && b.offsetParent !== null && /Vorlage/.test(b.textContent) && !!window.HoneyThumb && HoneyThumb.TEMPLATES.length === 14; }));
  await page.click('#coverTplBtn'); await page.waitForFunction(() => document.querySelectorAll('#ctTpls canvas').length === 14 && HCTitelbild.state && HCTitelbild.state.cut, null, { timeout: 20000 });
  const a = await ev(() => { const pv = document.querySelector('#ctPrev'), s = HCTitelbild.state, x = pv.getContext('2d').getImageData(0, 0, pv.width, pv.height).data; let lit = 0; for (let i = 0; i < x.length; i += 400) if (x[i] + x[i + 1] + x[i + 2] > 60) lit++;
    return { ratio: pv.width / pv.height, lit, frame: s.frame.slice(0, 22), cut: !!s.cut.img && !!s.cut.mask, seg: window.__seg, on: document.querySelector('#ctTpls .on')?.dataset.t, fmt: document.querySelector('#ctFmt').value, out: [...document.querySelector('#ctOut').options].map(o => o.textContent), cutBox: document.querySelector('#ctCut').checked }; });
  chk('Das Blatt holt das Bild an der Abspiellinie, stellt die Person frei und zeigt Vorschau und vierzehn Vorlagen', Math.abs(a.ratio - 16 / 9) < 0.02 && a.lit > 100 && a.frame === 'data:image/jpeg;base64' && a.cut && a.seg === 1 && a.on === 'rechts' && a.cutBox, a);
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

  // ═════════ Markenunterlagen aus HoneyThumb (2.44) ═════════
  const marke = await ev(() => { const mk = (w, h, f) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#14c850'; x.fillRect(0, h * (1 - f), w, h * f); return c.toDataURL('image/png'); };
    return JSON.stringify({ app: 'honeythumb-marke', v: 1, brand: { id: 'b1', name: 'Testmarke', accentKey: 'gruen', fonts: { title: null, small: null } }, items: [
      { id: 'o1', kind: 'overlay', name: 'Banner quer', img: mk(1280, 720, 0.25), formats: ['16:9'], auto: true }, { id: 'o2', kind: 'overlay', name: 'Banner hoch', img: mk(720, 1280, 0.2), formats: ['9:16'], auto: true },
      { id: 'x1', kind: 'overlay', name: 'Fremd', img: 'https://example.org/a.png', formats: ['16:9'], auto: true }, { id: 'p1', kind: 'person', name: 'Wer', pics: [] }] }); });
  await page.setInputFiles('#ctBrandFile', { name: 'Markenunterlagen-Testmarke.json', mimeType: 'application/json', buffer: Buffer.from(marke) });
  await page.waitForFunction(() => /Testmarke.*geladen/.test(document.querySelector('#ctMsg').textContent), null, { timeout: 15000 }); await sleep(300);
  const b1 = await ev(() => { const d = HCTitelbild.build(HCTitelbild.opts()), F = HoneyThumb.format(d.format), l = d.layers.at(-1), t = d.layers.find(x => x.slot === 'title'); return { n: HCTitelbild.brand.overlays.length, txt: document.querySelector('#ctBrand').textContent, top: !!l.top, name: l.name, lock: !!l.lock, asset: /^data:image\/png/.test(d.assets[l.img] || ''), titleEnd: (t.y + t.h) / F.h, acc: document.querySelector('#ctAcc').value, ov: document.querySelector('#ctOv').checked && getComputedStyle(document.querySelector('#ctOvL')).display !== 'none' }; });
  chk('„Markenunterlagen laden“ nimmt die Auflagen der Marke (keine fremden Adressen): Die Auflage fürs Querformat liegt obenauf, der Titel endet darüber, die Akzentfarbe der Marke ist gewählt', b1.n === 2 && /Testmarke/.test(b1.txt) && /Banner quer/.test(b1.txt) && b1.top && b1.name === 'Banner quer' && b1.lock && b1.asset && b1.titleEnd < 0.76 && b1.acc === 'gruen' && b1.ov, b1);
  const b2 = await ev(async () => { const d = HCTitelbild.build(HCTitelbild.opts()); await HoneyThumb.load(d); const c = HoneyThumb.render(d, 640), all = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data, px = (fx, fy) => { const i = (Math.round(fy * c.height) * c.width + Math.round(fx * c.width)) * 4; return [all[i], all[i + 1], all[i + 2]]; }; return { unten: px(0.5, 0.95), oben: px(0.02, 0.05) }; });
  chk('Im Bild steht das Banner unten über allem', b2.unten[1] > 170 && b2.unten[0] < 60 && !(b2.oben[1] > 170 && b2.oben[0] < 60), b2);
  await page.selectOption('#ctFmt', '9:16'); await sleep(400);
  const b3 = await ev(() => { const d = HCTitelbild.build(HCTitelbild.opts()); return { name: d.layers.at(-1).name, txt: document.querySelector('#ctBrand').textContent }; });
  await page.selectOption('#ctFmt', '1:1'); await sleep(400);
  const b4 = await ev(() => { const d = HCTitelbild.build(HCTitelbild.opts()); return { top: d.layers.some(l => l.top), txt: document.querySelector('#ctBrand').textContent, ovL: getComputedStyle(document.querySelector('#ctOvL')).display }; });
  chk('Je Format gilt die passende Auflage; ohne passende bleibt das Titelbild frei', b3.name === 'Banner hoch' && /Banner hoch/.test(b3.txt) && !b4.top && /keine Auflage/.test(b4.txt) && b4.ovL === 'none', { b3, b4 });
  await page.selectOption('#ctFmt', '16:9'); await sleep(300); await page.click('#ctOv'); await sleep(300);
  const b5 = await ev(() => HCTitelbild.build(HCTitelbild.opts()).layers.some(l => l.top)); await page.click('#ctOv'); await sleep(300);
  chk('Der Haken „Auflage der Marke“ nimmt sie heraus und setzt sie wieder ein', b5 === false && await ev(() => HCTitelbild.build(HCTitelbild.opts()).layers.some(l => l.top)));
  await page.click('#ctTpls [data-t="pinsel"]'); await sleep(400);
  const b6 = await ev(() => { const d = HCTitelbild.build(HCTitelbild.opts()), g = s => d.layers.find(l => l.slot === s); return { t: g('title').box.style, k: g('kicker').font, s: g('sub').box.style, c: g('title').box.c.toLowerCase(), top: !!d.layers.at(-1).top }; });
  chk('Vorlage „Pinselbalken unten“: Pinselstrich in der Akzentfarbe, Schreibmaschine auf Papier, schwarzer Balken – unter der Auflage', b6.t === 'brush' && b6.k === 'typewriter' && b6.s === 'torn' && b6.c === '#5db37a' && b6.top, b6);

  // ═════════ Titelbild als erstes Bild des Videos (2.44) ═════════
  await page.click('#ctFirst'); await page.waitForFunction(() => /ersten Bild des Videos/.test(document.querySelector('#ctMsg').textContent), null, { timeout: 20000 });
  const c1 = await ev(() => { exFmt = 'video'; const c = P.settings.coverFirst, [W, H] = outSize(), plan = buildPlan(), o = plan.overlays ? plan.overlays.filter(x => x.first) : (plan.ovs || []).filter(x => x.first), dry = buildPlan(true), all = dry.overlays || dry.ovs || []; exFmt = 'capcut'; const cc = buildPlan(); exFmt = 'video';
    return { on: c.on, uri: !!c.uri, ar: c.w / c.h, out: [W, H], o: o[0] || null, n: o.length, dry: all.some(x => x.first), cc: (cc.overlays || cc.ovs || []).some(x => x.first), fps: plan.fps }; });
  chk('Der Haken legt das Titelbild in der Größe des Videos beim Projekt ab; der Exportplan trägt es als Bild über allem, vom Anfang an weniger als ein Bild lang', c1.on && c1.uri && Math.abs(c1.ar - c1.out[0] / c1.out[1]) < 0.01 && c1.n === 1 && c1.o.at === 0 && c1.o.in === 0 && c1.o.out > 0.001 && c1.o.out < 1 / c1.fps && c1.o.top === true && c1.o.image === true && c1.o.w === 1 && c1.o.x === 0.5 && c1.o.track === 199 && !c1.dry && !c1.cc, c1);
  await page.click('#ctNo'); await sleep(400);
  const ex = await ev(async () => { P.settings.level = false; exFmt = 'video'; const plan = buildPlan(); plan.name = 'titelbild-erstes-bild'; const id = TS.exportVideo(JSON.stringify(plan));
    for (;;){ await new Promise(r => setTimeout(r, 200)); const j = JSON.parse(TS.job(id)); if (j.status === 'done') return { ok: true, file: j.result.playable, total: plan.total, fps: plan.fps }; if (j.status === 'error') return { ok: false, error: j.error }; } });
  if (ex.ok){ const { execFileSync } = await import('node:child_process');
    const px = n => { const b = execFileSync('ffmpeg', ['-v', 'error', '-i', ex.file, '-an', '-vf', `select=eq(n\\,${n}),scale=64:36`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 22 }), at = (x, y) => [...b.subarray((y * 64 + x) * 3, (y * 64 + x) * 3 + 3)]; return at(32, 33); };
    const gruen = p => p[1] > 150 && p[0] < 90 && p[2] < 140, f0 = px(0), f1 = px(1), f5 = px(5);
    const pr = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,start_time,duration,nb_frames', '-of', 'json', ex.file]).toString()).streams, v = pr.find(x => x.codec_type === 'video'), au = pr.find(x => x.codec_type === 'audio');
    chk('Im fertigen Video zeigt genau das erste Bild das Titelbild (Banner unten), ab dem zweiten läuft das Video', gruen(f0) && !gruen(f1) && !gruen(f5), { f0, f1, f5 });
    chk('Länge und Ton bleiben, wie sie sind: Der Ton beginnt am Anfang und ist so lang wie das Video', !!au && Math.abs(+au.start_time) < 0.05 && Math.abs(+v.start_time) < 0.05 && Math.abs(+au.duration - +v.duration) < 0.1 && +v.duration >= ex.total - 0.1, { v, au, total: ex.total });
    fs.rmSync(ex.file, { force: true }); }
  else chk('Der Export mit Titelbild läuft durch', false, ex);
  await ev(() => setTab('export')); await sleep(300); await page.click('#coverTplBtn'); await page.waitForSelector('#ctTpls canvas'); await sleep(700);
  const c2 = await ev(() => ({ first: document.querySelector('#ctFirst').checked, brand: document.querySelector('#ctBrand').textContent }));
  await page.click('#ctFirst'); await sleep(400);
  const c3 = await ev(() => { exFmt = 'video'; const p = buildPlan(); return { on: !!P.settings.coverFirst.on, plan: (p.overlays || p.ovs || []).some(x => x.first) }; });
  chk('Beim Wiederöffnen sind Haken und Markenunterlagen noch da; ohne Haken trägt der Plan kein Titelbild mehr', c2.first && /Testmarke/.test(c2.brand) && !c3.on && !c3.plan, { c2, c3 });
  // ═════════ Fertiges Titelbild importieren (2.45) ═════════
  const bild = async (w, h, col) => Buffer.from((await ev(([w, h, col]) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = col; x.fillRect(0, 0, w, h); return c.toDataURL('image/png'); }, [w, h, col])).split(',')[1], 'base64');
  await page.setInputFiles('#ctOwnFile', { name: 'Mein Titelbild.png', mimeType: 'image/png', buffer: await bild(1280, 720, '#e61ec8') });
  await page.waitForFunction(() => /Mein Titelbild.*ersten Bild/.test(document.querySelector('#ctMsg').textContent), null, { timeout: 15000 });
  const o1 = await ev(() => { exFmt = 'video'; const c = P.settings.coverFirst, [W, H] = outSize(), p = buildPlan(), f = p.overlays.filter(x => x.first); return { own: c.own, on: c.on, name: c.name, dims: [c.w, c.h], out: [W, H], n: f.length, w: f[0] && f[0].w, box: document.querySelector('#ctFirst').checked, info: document.querySelector('#ctOwn').textContent, msg: document.querySelector('#ctMsg').textContent }; });
  chk('„Fertiges Titelbild importieren“ legt das Bild in der Größe des Videos ab und trägt es als erstes Bild in den Plan; das Blatt nennt es', o1.own && o1.on && o1.name === 'Mein Titelbild.png' && o1.dims.join() === o1.out.join() && o1.n === 1 && o1.w === 1 && !o1.box && /Mein Titelbild/.test(o1.info) && !/Rand/.test(o1.msg), o1);
  await page.click('#ctNo'); await sleep(400);
  chk('Schließen des Blatts ersetzt das importierte Bild nicht durch das Titelbild aus der Vorlage', await ev(() => P.settings.coverFirst.own === true && /titelbild-eigen-/.test(P.settings.coverFirst.uri)));
  const ex2 = await ev(async () => { P.settings.level = false; exFmt = 'video'; const plan = buildPlan(); plan.name = 'titelbild-importiert'; const id = TS.exportVideo(JSON.stringify(plan));
    for (;;){ await new Promise(r => setTimeout(r, 200)); const j = JSON.parse(TS.job(id)); if (j.status === 'done') return { ok: true, file: j.result.playable }; if (j.status === 'error') return { ok: false, error: j.error }; } });
  if (ex2.ok){ const { execFileSync } = await import('node:child_process');
    const px = n => { const b = execFileSync('ffmpeg', ['-v', 'error', '-i', ex2.file, '-an', '-vf', `select=eq(n\\,${n}),scale=64:36`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 22 }), at = (x, y) => [...b.subarray((y * 64 + x) * 3, (y * 64 + x) * 3 + 3)]; return [at(3, 3), at(32, 18), at(60, 33)]; };
    const mag = p => p[0] > 170 && p[1] < 90 && p[2] > 140, f0 = px(0), f1 = px(1);
    chk('Im fertigen Video füllt das importierte Bild das erste Bild ganz aus; das zweite Bild ist wieder das Video', f0.every(mag) && !f1.every(mag), { f0, f1 }); fs.rmSync(ex2.file, { force: true }); }
  else chk('Der Export mit importiertem Titelbild läuft durch', false, ex2);
  // Anderes Format: im Ganzen mit schwarzem Rand; über den Export-Reiter
  await ev(() => setTab('export')); await sleep(300);
  await page.setInputFiles('#coverImportFile', { name: 'Quadrat.png', mimeType: 'image/png', buffer: await bild(600, 600, '#e61ec8') }); await page.waitForFunction(() => P.settings.coverFirst && P.settings.coverFirst.name === 'Quadrat.png', null, { timeout: 15000 }); await sleep(200);
  const o2 = await ev(() => { const c = P.settings.coverFirst, [W, H] = outSize(); return { dims: [c.w, c.h], out: [W, H], own: c.own, uri: c.uri, toastText: (document.querySelector('#toast') || {}).textContent || '' }; });
  { const { execFileSync } = await import('node:child_process'); const file = decodeURIComponent(String(o2.uri).replace(/^file:\/\//, ''));
    const b = fs.existsSync(file) ? execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'scale=64:36', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 22 }) : null, at = (x, y) => b ? [...b.subarray((y * 64 + x) * 3, (y * 64 + x) * 3 + 3)] : null;
    o2.rand = at(2, 18); o2.mitte = at(32, 18); }
  chk('Über „Titelbild importieren“ im Export-Reiter: Ein Bild in anderem Format steht im Ganzen in der Größe des Videos, mit schwarzem Rand', o2.own && o2.dims.join() === o2.out.join() && !!o2.rand && o2.rand.every(v => v < 25) && o2.mitte[0] > 170 && o2.mitte[1] < 90 && /Rand/.test(o2.toastText), o2);
  await page.click('#coverTplBtn'); await page.waitForSelector('#ctTpls canvas'); await sleep(700);
  await page.click('#ctOwnOff'); await sleep(300);
  chk('„Entfernen“ nimmt das importierte Titelbild wieder vom ersten Bild', await ev(() => { exFmt = 'video'; return !P.settings.coverFirst.on && !buildPlan().overlays.some(x => x.first) && document.querySelector('#ctOwn').textContent === ''; }));
  await page.click('#ctBrandOff'); await sleep(400);
  chk('„Entfernen“ nimmt die Markenunterlagen wieder heraus', await ev(() => !HCTitelbild.brand && !HCTitelbild.build(HCTitelbild.opts()).layers.some(l => l.top) && /keine geladen/.test(document.querySelector('#ctBrand').textContent)));
  await page.click('#ctNo');
} catch (e) { chk('Ablauf ohne Abbruch', false, String(e && e.stack || e).slice(0, 700)); }
finally { if (nid) await dropScratch(page, nid).catch(() => {}); }
const rest = logs.filter(l => !/Titelbild, Freistellen: Auf diesem Bild ist keine Person/.test(l));   // der Hinweis aus der letzten Prüfung ist gewollt
chk('keine weiteren Meldungen der Seite', rest.length === 0, rest.slice(0, 6));
await ende(browser);
