// Echter Export über altes und neues Backend: gleiche Projekte, gleicher Plan → die Ergebnisse müssen übereinstimmen.
import { browser as startBrowser, ids as loadIds, BASE, BASIS } from './drv.mjs';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const ids = loadIds();
const URLS = { alt: BASIS, neu: BASE };
if (!BASIS){ console.log('ERGEBNIS Vergleich Exporte: übersprungen (keine Vergleichsfassung gestartet)'); process.exit(0); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await startBrowser();
const jobs = process.argv.slice(2).length ? process.argv.slice(2) : ['stress:video', 'stress:audio', 'kurz:capcut'];
const run = async (label, url, key, fmt) => {
  const page = await browser.newPage({ viewport: { width: 1480, height: 900 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  await page.goto(url); await page.waitForFunction(() => typeof showHome === 'function');
  await page.evaluate(i => openProject(i), ids[key]); await page.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i, ids[key]); await sleep(600);
  const t0 = Date.now();
  const res = await page.evaluate(async ([fmt, label]) => {
    exFmt = fmt; const plan = buildPlan(); plan.name = `vergleich_${label}_${fmt}`;
    if (fmt === 'video'){ plan.width = 640; plan.height = 360; }   // klein halten: es geht um Gleichheit, nicht um Größe
    const id = TS.exportVideo(JSON.stringify(plan));
    for (;;){ await new Promise(r => setTimeout(r, 500)); const j = JSON.parse(TS.job(id)); if (j.status === 'done') return { ok: true, result: j.result }; if (j.status === 'error') return { ok: false, error: j.error }; }
  }, [fmt, label]);
  await page.close();
  return { res, errs, secs: (Date.now() - t0) / 1000 };
};
const probe = f => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,codec_type,width,height,nb_frames,r_frame_rate,sample_rate,channels', '-of', 'json', f]).toString());
const md5 = (f, args) => execFileSync('ffmpeg', ['-v', 'error', '-i', f, ...args, '-f', 'md5', '-'], { maxBuffer: 1 << 26 }).toString().trim();
let bad = 0;
for (const j of jobs){
  const [key, fmt] = j.split(':');
  const a = await run('alt', URLS.alt, key, fmt), b = await run('neu', URLS.neu, key, fmt);
  if (!a.res.ok || !b.res.ok){ bad++; console.log('FEHLER', j, 'alt:', JSON.stringify(a.res).slice(0, 300), 'neu:', JSON.stringify(b.res).slice(0, 300)); continue; }
  if (process.env.SHOWRES) console.log(JSON.stringify(a.res.result).slice(0, 400));
  const pa = a.res.result.playable || a.res.result.files[0], pb = b.res.result.playable || b.res.result.files[0];
  let same = false, info = '';
  if (fs.statSync(pa).isDirectory()){
    const list = d => fs.readdirSync(d, { recursive: true }).filter(x => fs.statSync(d + '/' + x).isFile()).sort();
    const la = list(pa), lb = list(pb);
    const sizes = (d, l) => l.map(x => x.replace(/vergleich_(alt|neu)_/g, 'vergleich_X_') + ':' + fs.statSync(d + '/' + x).size).join('|');
    same = sizes(pa, la) === sizes(pb, lb); info = `${la.length} Dateien (${la.slice(0, 4).join(', ')}${la.length > 4 ? ', …' : ''})`;
  } else {
    const fa = probe(pa), fb = probe(pb); const strip = o => JSON.stringify(o.streams) + '|' + (+o.format.duration).toFixed(3);
    const va = fa.streams.some(s => s.codec_type === 'video') ? md5(pa, ['-map', '0:v:0']) : '', vb = fb.streams.some(s => s.codec_type === 'video') ? md5(pb, ['-map', '0:v:0']) : '';
    const aa = fa.streams.some(s => s.codec_type === 'audio') ? md5(pa, ['-map', '0:a:0', '-c:a', 'pcm_s16le']) : '', ab = fb.streams.some(s => s.codec_type === 'audio') ? md5(pb, ['-map', '0:a:0', '-c:a', 'pcm_s16le']) : '';
    same = strip(fa) === strip(fb) && va === vb && aa === ab;
    info = `${(+fa.format.duration).toFixed(2)} s · ${fa.streams.map(s => s.codec_name + (s.width ? ' ' + s.width + '×' + s.height : '')).join(' + ')} · Bild ${va === vb ? 'gleich' : 'VERSCHIEDEN'} · Ton ${aa === ab ? 'gleich' : 'VERSCHIEDEN'} · ${(fs.statSync(pa).size / 1e6).toFixed(1)} / ${(fs.statSync(pb).size / 1e6).toFixed(1)} MB`;
  }
  if (!same || a.errs.length || b.errs.length) bad++;
  console.log((same ? 'gleich     ' : 'ABWEICHUNG ') + j.padEnd(16), info, `· Dauer alt ${a.secs.toFixed(0)} s / neu ${b.secs.toFixed(0)} s`, a.errs.concat(b.errs).slice(0, 2).join(' | '));
}
console.log(`ERGEBNIS Vergleich Exporte: ${bad ? bad + ' Exporte weichen ab' : 'alle Exporte gleich'}`);
await browser.close();
process.exit(bad ? 1 : 0);
