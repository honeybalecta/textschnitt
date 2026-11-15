// Gleichheitsprüfung alt/neu: Export-Plan, Untertitel und Zeitleiste müssen für dieselben Projekte identisch sein.
import { browser as startBrowser, ids as loadIds, BASE, BASIS } from './drv.mjs';
import fs from 'node:fs';
const ids = loadIds();
const URLS = { alt: BASIS, neu: BASE };
if (!BASIS){ console.log('ERGEBNIS Vergleich Exportplan: übersprungen (keine Vergleichsfassung gestartet)'); process.exit(0); }
const browser = await startBrowser();
const grab = async (url, id) => {
  const page = await browser.newPage({ viewport: { width: 1480, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(url); await page.waitForFunction(() => typeof showHome === 'function');
  await page.evaluate(i => openProject(i), id);
  await page.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i, id);
  await new Promise(r => setTimeout(r, 600));
  const out = await page.evaluate(() => {
    const strip = o => JSON.parse(JSON.stringify(o));
    const res = {};
    for (const fmt of ['video', 'capcut']) { exFmt = fmt; const p = buildPlan(); res['plan_' + fmt] = strip(p); }
    exFmt = 'video';
    res.cues = computedCues().map(x => [r3(x.s), r3(x.e), x.text, !!x.kept]);
    res.timeline = timeline.map(g => [g.kind, r3(g.in), r3(g.out), r3(g.o), g.speed]);
    res.ranges = ranges; res.total = r3(total);
    res.overlays = overlays.map(o => [o.x.id, r3(o.at), r3(o.end)]);
    res.transcript = transcriptPlain({ cut: true, spk: true, times: true });
    // einige Umrechnungen an vielen Stellen
    const pts = []; for (let k = 0; k <= 200; k++) { const o = total * k / 200; pts.push([r3(outToSrcT(o)), r3(srcToOut(outToSrcT(o))), segAtOut(o)]); }
    res.maps = pts;
    return res;
  });
  await page.close();
  return { out, errs };
};
let bad = 0;
for (const key of process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(ids)) {
  const a = await grab(URLS.alt, ids[key]), b = await grab(URLS.neu, ids[key]);
  const diffs = [];
  for (const k of Object.keys(a.out)) { const x = JSON.stringify(a.out[k]), y = JSON.stringify(b.out[k]); if (x !== y) { let i = 0; while (i < x.length && x[i] === y[i]) i++; diffs.push(`${k}: ab Zeichen ${i}: alt …${x.slice(Math.max(0, i - 60), i + 80)}… neu …${y.slice(Math.max(0, i - 60), i + 80)}…`); } }
  if (diffs.length || a.errs.length || b.errs.length) bad++;
  console.log((diffs.length ? 'ABWEICHUNG' : 'gleich').padEnd(11), key.padEnd(10), `Plan ${JSON.stringify(a.out.plan_video).length} Zeichen · ${a.out.cues.length} Untertitel · ${a.out.timeline.length} Abschnitte`, a.errs.concat(b.errs).slice(0, 2).join(' | '));
  for (const d of diffs.slice(0, 4)) console.log('   ', d.slice(0, 400));
}
await browser.close();
console.log(`ERGEBNIS Vergleich Exportplan: ${bad ? bad + ' Projekte weichen ab' : 'alle Projekte gleich'}`);
process.exit(bad ? 1 : 0);
