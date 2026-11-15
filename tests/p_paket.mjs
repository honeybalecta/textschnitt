// Projekt weitergeben (.honeycut): Paket über die Oberfläche schreiben und wieder einlesen – auch wenn im Projekt ein Bild
// direkt eingebettet ist (Folienbild als „data:…“). Daran scheiterte das Weitergeben unter Windows mit
// „stat: path too long for Windows“. Außerdem: Das Wasserzeichen gehört ins Paket, und eigene Untertitel-Looks reisen auf Wunsch mit.
import fs from 'node:fs';
import path from 'node:path';
import { launch, scratch, dropScratch, setPick, sleep, ids as loadIds, pruefung, MEDIA, OUT, WORK } from './drv.mjs';
const PJ = loadIds();
const { chk, ende } = pruefung('Projekt weitergeben');
const PKG = path.join(OUT, 'paket-test.honeycut'), IMP = path.join(WORK, 'importe');
fs.rmSync(PKG, { force: true }); fs.rmSync(IMP, { recursive: true, force: true });
// Paket lesen: Kennung, Länge des Kopfs (8 Byte), Kopf als JSON, danach die Dateien
const readPkg = f => { const b = fs.readFileSync(f), n = Number(b.readBigUInt64LE(10)); return { magic: b.subarray(0, 10).toString(), header: JSON.parse(b.subarray(18, 18 + n).toString('utf8')), rest: b.length - 18 - n }; };

const { browser, page, logs } = await launch();
const dialogs = []; page.on('dialog', d => dialogs.push(d.message()));
const sid = await scratch(page, PJ.kurz);
// Ein Bild, das direkt im Projekt steht (rund 60 000 Zeichen), einmal als Folienbild und einmal tiefer in der Folie; dazu ein Wasserzeichen
const inline = 'data:image/png;base64,' + 'iVBORw0KGgo/'.repeat(5000);
const name = await page.evaluate(([img, logo]) => {
  P.slides = [{ id: 'tslide', layout: 'bild', title: 'Mit eingebettetem Bild', img, teile: [{ uri: img, art: 'bild' }] }];
  P.watermark = { ...WM_DEF, on: true, clip: { uri: logo, name: 'logo.png', kind: 'image', width: 200, height: 200, duration: 0 } };
  subLooks.push({ id: 'pk1', name: 'Paket-Look', st: { ...lookOf(S()), color: '#CFC6B0' } }); saveLooks();   // ein eigener Untertitel-Look auf diesem Gerät
  saveNow(); return P.name;
}, [inline, MEDIA + 'logo.png']);
await sleep(300);

// ── Was die Oberfläche als Dateien meldet ──
const spec = await page.evaluate(() => { const s = packageSpec(JSON.parse(TS.loadProject(P.id)), true); return { files: s.files.map(f => ({ n: f.n, len: f.uri.length, head: f.uri.slice(0, 12), include: f.include })), names: s.header.files.map(f => f.name),
  img: s.header.project.slides[0].img, inner: s.header.project.slides[0].teile[0].uri, wm: s.header.project.watermark.clip.uri, src: s.header.project.sources[0].uri }; });
chk('eingebettete Bilder werden nicht als Dateien gemeldet', spec.files.every(f => f.len < 2000 && !/^data:/.test(f.head)), spec.files);
chk('sie bleiben unverändert im Projekt stehen', spec.img === inline && spec.inner === inline);
chk('Video und Wasserzeichen stehen als Dateien im Paket', spec.src.startsWith('@hc:') && spec.wm.startsWith('@hc:') && spec.names.includes('kurz.mp4') && spec.names.includes('logo.png') && spec.files.length === 2, spec.names);

// ── Paket schreiben (Export-Reiter → „Projekt exportieren …“) ──
setPick({ save: [PKG] });
await page.evaluate(() => setTab('export')); await sleep(200);
await page.click('#pkgBtn'); await page.waitForSelector('#hcModal #pkgGo');
const lookBox = await page.evaluate(() => { const c = document.querySelector('#pkgLooks'); return c ? [c.checked, c.parentElement.textContent.trim()] : null; });
chk('der Dialog bietet an, die eigenen Untertitel-Looks mitzugeben', !!lookBox && lookBox[0] === true && lookBox[1] === 'Meine Untertitel-Looks mitgeben (1)', lookBox);
await page.click('#pkgGo');
await page.waitForFunction(() => { const m = document.querySelector('#pkgMsg'); return m && /^(Fertig|Fehler|Abgebrochen)/.test(m.textContent); }, null, { timeout: 60000 });
const msg = await page.evaluate(() => document.querySelector('#pkgMsg').textContent);
chk('das Weitergeben läuft durch', msg.startsWith('Fertig') && fs.existsSync(PKG), msg);
const pk = fs.existsSync(PKG) ? readPkg(PKG) : { header: { files: [], project: {} }, rest: 0, magic: '' };
const inc = Object.fromEntries(pk.header.files.map(f => [f.name, [f.included, f.size]]));
const vidSize = fs.statSync(MEDIA + 'kurz.mp4').size, logoSize = fs.statSync(MEDIA + 'logo.png').size;
chk('im Paket stecken Video und Wasserzeichen in voller Länge', pk.magic === 'HONEYCUT1\n' && inc['kurz.mp4'] && inc['kurz.mp4'][0] === true && inc['kurz.mp4'][1] === vidSize && inc['logo.png'] && inc['logo.png'][1] === logoSize && pk.rest === vidSize + logoSize, inc);
chk('das eingebettete Bild steht im Projekt des Pakets', (pk.header.project.slides || [])[0]?.img === inline);
chk('der Untertitel-Look steht im Paket', JSON.stringify((pk.header.looks || []).map(l => [l.id, l.name, l.st.color])) === '[["pk1","Paket-Look","#CFC6B0"]]', pk.header.looks);
await page.screenshot({ path: OUT + '/paket-fertig.png' });
await page.click('#pkgCancel'); await sleep(100);

// ── Paket ohne Videos: nur der Schnitt ──
const PKG2 = path.join(OUT, 'paket-test-klein.honeycut'); fs.rmSync(PKG2, { force: true }); setPick({ save: [PKG2] });
await page.click('#pkgBtn'); await page.waitForSelector('#hcModal #pkgGo');
await page.click('#pkgMedia'); await page.click('#pkgLooks'); await page.click('#pkgGo');
await page.waitForFunction(() => { const m = document.querySelector('#pkgMsg'); return m && /^(Fertig|Fehler|Abgebrochen)/.test(m.textContent); }, null, { timeout: 60000 });
const pk2 = fs.existsSync(PKG2) ? readPkg(PKG2) : { header: { files: [] }, rest: -1 };
chk('ohne mitgeschickte Dateien entsteht ein kleines Paket mit dem Schnitt', pk2.rest === 0 && pk2.header.files.length === 2 && pk2.header.files.every(f => !f.included), [pk2.rest, pk2.header.files.map(f => f.included)]);
chk('ohne den Haken bleiben die Looks draußen', pk2.header.looks === undefined);
await page.click('#pkgCancel'); await sleep(100);

// ── Wieder einlesen: das vorhandene Projekt wird durch die empfangene Fassung ersetzt (Rückfrage wird bestätigt) ──
setPick({ package: [PKG] }); dialogs.length = 0;
await page.evaluate(() => { closeProject(); subLooks.length = 0; saveLooks(); }); await sleep(200);   // als käme das Paket auf einem Gerät ohne diesen Look an
await page.click('#impProj');
await page.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i && !document.querySelector('#hcModal'), sid, { timeout: 60000 });
const impToast = await page.evaluate(() => document.querySelector('#toast').textContent);
await sleep(500);
const back = await page.evaluate(() => ({ looks: subLooks.map(l => [l.id, l.name, l.st.color]), stored: localStorage.getItem('hc-sub-looks') === JSON.stringify(subLooks), name: P.name, src: P.sources[0].uri, wm: P.watermark && P.watermark.clip.uri, img: P.slides[0].img, inner: P.slides[0].teile[0].uri, toks: tokens.length, total,
  wmShown: !document.querySelector('#wm').classList.contains('hidden'), wmOk: document.querySelector('#wm').naturalWidth }));
chk('Rückfrage nennt das vorhandene Projekt', dialogs.length === 1 && dialogs[0].includes(`„${name}“ gibt es auf diesem Gerät schon`), dialogs);
chk('nach dem Einlesen liegen Video und Wasserzeichen im Importordner', back.src.startsWith(IMP) && fs.existsSync(back.src) && back.wm.startsWith(IMP) && fs.existsSync(back.wm), [back.src, back.wm]);
chk('Schnitt, Transkript und das eingebettete Bild sind unverändert da', back.name === name && back.toks > 50 && back.total > 10 && back.img === inline && back.inner === inline, [back.name, back.toks, back.total]);
chk('das Wasserzeichen wird im empfangenen Projekt angezeigt', back.wmShown && back.wmOk === 200, [back.wmShown, back.wmOk]);
chk('der Untertitel-Look aus dem Paket steht auf dem Gerät bereit', JSON.stringify(back.looks) === '[["pk1","Paket-Look","#CFC6B0"]]' && back.stored && /1 Untertitel-Look übernommen/.test(impToast), [back.looks, impToast]);
chk('keine Fehlermeldungen in der Oberfläche', logs.length === 0, logs.slice(0, 5));

await page.evaluate(() => { subLooks.length = 0; saveLooks(); });
await dropScratch(page, sid);
fs.rmSync(IMP, { recursive: true, force: true }); fs.rmSync(PKG, { force: true }); fs.rmSync(PKG2, { force: true });
await ende(browser);
