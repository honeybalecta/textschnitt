// Legt die Testprojekte an (einmal je Arbeitsordner) – über die echte Oberfläche:
//   kurz (3 min, transkribiert) · lang (6 min) · edit (lang, realistisch bearbeitet) · editWord (ein Wort je Untertitel)
//   stress (viele Einblendungen dicht hintereinander) · multi (mehrere Video- und Tonspuren gleichzeitig)
import { launch, newProject, transcribe, openById, setPick, MEDIA, WORK, sleep, fmt } from './drv.mjs';
import fs from 'node:fs';
import path from 'node:path';

const { browser, page, logs } = await launch();
const out = {};
const info = () => page.evaluate(() => ({ total: +total.toFixed(1), abschnitte: timeline.length, elemente: P.items.length, untertitel: P.cues.length, woerter: tokens.filter(t => t.type === 'word').length }));
const copy = name => page.evaluate(n => { saveNow(); const c = JSON.parse(JSON.stringify(P)); c.id = newId(); c.name = n; TS.saveProject(c.id, JSON.stringify(c)); return c.id; }, name);
const pick = async (kind, files) => { setPick({ [kind]: files }); return page.evaluate(k => pickMedia(k), kind); };

for (const name of ['kurz', 'lang']){
  await page.evaluate(() => { if (typeof P !== 'undefined' && P) closeProject(); });
  out[name] = await newProject(page, [MEDIA + name + '.mp4']);
  await transcribe(page);
  await page.evaluate(n => { P.name = n; saveNow(); }, name);
  console.log(name, out[name], fmt(await info()));
}

// edit: Pausen und Füllwörter weg, Wörter und Sätze gelöscht, Folien, Einspieler, Einblendung, Wasserzeichen, Zooms, Titel
out.edit = await copy('lang bearbeitet'); await openById(page, out.edit);
await page.evaluate(() => {
  commit(() => trimPauses(0), false);
  commit(() => bulkDelete(fillerIds(0)), false);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const del = []; for (const t of tokens) if (t.type === 'word' && rnd() < 0.04) del.push(t.i);
  commit(() => bulkDelete(del), false);
  const n = tokens.length;
  for (const f of [0.2, 0.5, 0.8]){ const s = []; for (let i = Math.floor(n * f); i < Math.floor(n * f) + 14; i++) s.push(i); commit(() => bulkDelete(s), false); }   // drei ganze Sätze
  genCues(); changed(true); saveNow();
});
await page.evaluate(() => setTab('studio')); await sleep(300);
for (let k = 1; k <= 8; k++){
  const m = await pick('clip', [MEDIA + `folie${k}.png`]);
  await page.evaluate(([m, f]) => { placeMedia(m, 'broll', total * f, null, true); const it = P.items[P.items.length - 1]; it.out = 6; changed(true); }, [m, 0.02 + k * 0.1]);
}
for (let k = 1; k <= 3; k++){
  const m = await pick('clip', [MEDIA + `broll${k}.mp4`]);
  await page.evaluate(([m, f]) => { placeMedia(m, 'broll', total * f, null, false); }, [m, 0.07 + k * 0.22]);
}
{ const m = await pick('clip', [MEDIA + 'broll1.mp4']); await page.evaluate(m => { placeMedia(m, 'pip', total * 0.45, null, false); }, m); }
{ const m = await pick('clip', [MEDIA + 'logo.png']); await page.evaluate(m => { commit(() => { P.watermark = { ...WM_DEF, clip: clipOfSource(m), on: true }; }, true); }, m); }
await page.evaluate(() => {
  for (const f of [0.04, 0.18, 0.4, 0.72, 0.95]){ seekOut(total * f, false); addZoom(); }
  for (const f of [0.006, 0.6]){ const o = total * f; seekOut(o, false); commit(() => { P.items.push({id:newId(), type:'title', at:r3(outToSrc(o)), dur:4, text:'Titel ' + Math.round(o), x:0.5, y:0.2, size:'groß', scale:1, color:'#FFFFFF', outline:true, bg:false}); }, false); }
  closeSheet(); select(null); changed(true); saveNow();
});
console.log('edit', out.edit, fmt(await info()));
out.editWord = await copy('lang bearbeitet (Wort)'); await openById(page, out.editWord);
await page.evaluate(() => { S().mode = 'word'; syncStyleInputs(); commit(() => genCues()); saveNow(); });
console.log('editWord', out.editWord, fmt(await info()));

// stress: 14 Einspieler alle 6 s, dazu 6 Einblendungen, eine Tonspur, zwei Einschübe
await openById(page, out.kurz);
out.stress = await copy('Belastung'); await openById(page, out.stress);
await page.evaluate(() => { commit(() => trimPauses(0), false); setTab('studio'); });
{ const m = []; for (const k of [1, 2, 3]) m.push(await pick('clip', [MEDIA + `broll${k}.mp4`]));
  const mk = await pick('clip', [MEDIA + 'kurz.mp4']);
  await page.evaluate(([m, mk]) => {
    for (let k = 0; k < 14; k++){ placeMedia(m[k % 3], 'broll', 8 + k * 6, null, false); const it = P.items[P.items.length - 1]; it.out = 5; it.in = (k % 2) * 3; }
    for (let k = 0; k < 6; k++){ placeMedia(m[(k + 1) % 3], 'pip', 10 + k * 13, null, false); const it = P.items[P.items.length - 1]; it.out = 8; it.vol = 0.5; }
    placeMedia(m[0], 'audio', 5, null, false);
    placeMedia(m[2], 'insert', 40, null, false); P.items[P.items.length - 1].out = 4;
    placeMedia(mk, 'broll', 100, null, false); P.items[P.items.length - 1].out = 20;
    closeSheet(); select(null); changed(true); saveNow();
  }, [m, mk]); }
console.log('stress', out.stress, fmt(await info()));

// multi: ab Sekunde 8 drei Videospuren und drei Tonspuren gleichzeitig, 60 s lang
await openById(page, out.kurz);
out.multi = await copy('Viele Spuren'); await openById(page, out.multi);
await page.evaluate(() => setTab('studio'));
{ const b = []; for (const k of [1, 2, 3]) b.push(await pick('clip', [MEDIA + `broll${k}.mp4`]));
  const big = await pick('clip', [MEDIA + 'lang.mp4']), mid = await pick('clip', [MEDIA + 'kurz.mp4']);
  await page.evaluate(([b, big, mid]) => {
    placeMedia(big, 'broll', 8, 1, false); let it = P.items[P.items.length - 1]; it.out = 60; it.in = 100;
    placeMedia(mid, 'pip', 8, 2, false); it = P.items[P.items.length - 1]; it.out = 60; it.in = 20;
    placeMedia(b[0], 'pip', 8, 3, false); it = P.items[P.items.length - 1]; it.out = 11; pipCorner(it, 'ol');
    placeMedia(big, 'audio', 8, null, false); it = P.items[P.items.length - 1]; it.out = 60; it.in = 200; it.vol = 0.3;
    placeMedia(mid, 'audio', 8, null, false); it = P.items[P.items.length - 1]; it.out = 60; it.in = 60; it.vol = 0.3;
    placeMedia(b[1], 'audio', 8, null, false); it = P.items[P.items.length - 1]; it.out = 11; it.vol = 0.3;
    closeSheet(); select(null); changed(true); saveNow();
  }, [b, big, mid]); }
console.log('multi', out.multi, fmt(await info()));

await page.evaluate(() => closeProject());
fs.writeFileSync(path.join(WORK, 'projects.json'), JSON.stringify(out));
if (logs.length){ console.log('Meldungen der Seite:', logs.slice(0, 20)); await browser.close(); process.exit(1); }
await browser.close();
console.log('Testprojekte bereit');
