// Titelbild auf dem ersten Bild über den echten Export-Knopf (2.55): importiertes Bild, mit und ohne Lautheit-Angleichen, Untertitel eingebrannt.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { launch, newProject, transcribe, dropScratch, sleep, pruefung, MEDIA } from './drv.mjs';
const { chk, ende } = pruefung('Titelbild im Export über den Knopf');
const { browser, page, logs } = await launch();
const ev = (f, a) => page.evaluate(f, a);
const made = [];
try {
  const id = await newProject(page, [MEDIA + 'serie.mp4']); made.push(id);
  await transcribe(page); await sleep(500);
  await ev(() => setTab('export')); await sleep(400);
  const png = Buffer.from((await ev(() => { const [w, h] = outSize(), c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#e61ec8'; x.fillRect(0, 0, w, h); return c.toDataURL('image/png'); })).split(',')[1], 'base64');
  await page.setInputFiles('#coverImportFile', { name: 'Titel.png', mimeType: 'image/png', buffer: png });
  await page.waitForFunction(() => P.settings.coverFirst && P.settings.coverFirst.on, null, { timeout: 15000 }); await sleep(500);
  for (const [lbl, level, burn] of [['Lautheit an, Untertitel an', true, true], ['Lautheit aus', false, true]]){
    await ev(([level, burn]) => { P.settings.level = level; document.querySelector('#exLevel').checked = level; P.settings.burn = burn; exFmt = 'video'; exResult = null; }, [level, burn]);
    const plan = await ev(() => buildPlan().overlays.filter(o => o.first).length);
    await page.click('#exBtn');
    await page.waitForFunction(() => exResult && (exResult.playable || exResult.file || exResult.files), null, { timeout: 600000 });
    const r = await ev(() => exResult);
    const file = r.playable || r.file || (r.files || [])[0];
    const b = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-an', '-frames:v', '2', '-vf', 'scale=64:36', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 22 });
    const px = k => [...b.subarray(k * 64 * 36 * 3 + (18 * 64 + 32) * 3, k * 64 * 36 * 3 + (18 * 64 + 32) * 3 + 3)];
    chk(lbl + ': erstes Bild ist das Titelbild', px(0)[0] > 170 && px(0)[1] < 90, { plan, f0: px(0), f1: px(1), file });
  }
} catch (e){ chk('abgebrochen', false, String(e.stack || e).slice(0, 500)); }
for (const id of made) await dropScratch(page, id).catch(() => {});
await ende(browser);
