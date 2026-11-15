// Diagnose (nur Testzweig): Vorschau und Export derselben Stelle in der gebauten Windows-App nebeneinander –
// je Fall ein frisches Projekt, Schrift und Gestaltung über die Funktionen der Oberfläche gesetzt.
// Aufruf: node tests/diag_wys.mjs <Adresse der App> <Projekt-ID> <Ausgabeordner> <Datei mit den Fällen>
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const [, , base, pid, OUTD, cfgFile] = process.argv;
const FF = process.env.DIAG_FFMPEG || 'ffmpeg';
const CFG = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
const LEN = 12;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const res = { cfg: [], logs: [] };
const save = () => fs.writeFileSync(path.join(OUTD, 'res.json'), JSON.stringify(res, null, 1));
const frame = (video, t, out) => execFileSync(FF, ['-v', 'error', '-y', '-ss', String(t), '-i', video, '-frames:v', '1', out]);
let br = null;
try {
  const args = ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-sandbox'];
  try { br = await chromium.launch({ channel: 'msedge', args }); res.browser = 'msedge'; }
  catch (e) { br = await chromium.launch({ channel: 'chrome', args }); res.browser = 'chrome'; }
  res.browserVersion = br.version();
  const ctx = await br.newContext({ viewport: { width: 1480, height: 1000 }, deviceScaleFactor: 1.25 });
  const page = await ctx.newPage();
  page.on('pageerror', e => res.logs.push('PAGEERROR: ' + String(e.stack || e.message).slice(0, 400)));
  page.on('dialog', d => d.accept().catch(() => {}));
  await page.goto(base);
  await page.waitForFunction(() => typeof showHome === 'function', null, { timeout: 30000 });
  const ev = (f, a) => page.evaluate(f, a);
  res.app = await ev(() => { try { return { platform: CAP.platform, version: CAP.version || null }; } catch (e) { return String(e); } });
  for (const c of CFG) {
    const r = { name: c.name, shots: [] };
    try {
      const nid = await ev(i => { if (typeof P !== 'undefined' && P) { pausePlay(); clearTimeout(saveT); P = null; } const c = JSON.parse(TS.loadProject(i)); c.id = 'tmp' + newId(); c.name = 'Test ' + c.id; TS.saveProject(c.id, JSON.stringify(c)); return c.id; }, pid);
      await ev(i => openProject(i), nid);
      await page.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i, nid, { timeout: 30000 });
      await sleep(400);
      await ev(() => setTab('subs')); await sleep(400);
      await ev(code => { commit(() => { new Function(code)(); }, true); styleOverlay(); syncStyleInputs(); cueCache.at = -1; if (typeof viewTextline === 'function') viewTextline(); }, c.js || '');
      await ev(() => { fitStage(); if (typeof renderExportForm === 'function') renderExportForm(); seekOut(outPos, false); }); await sleep(300); await ev(() => { fitStage(); styleOverlay(); });
      await sleep(600); await ev(() => document.fonts.ready); await sleep(300);
      const exportPlan = async mod => {
        const job = await ev(([mod, LEN]) => { const pl = buildPlan(); pl.segments = [{ ...pl.segments[0], out: pl.segments[0].in + LEN }]; pl.total = LEN; pl.overlays = [];
          if (pl.subs) pl.subs.cues = pl.subs.cues.filter(c => c.start < LEN).map(c => ({ ...c, end: Math.min(c.end, LEN) })); if (mod.noSubs) pl.subs = null; delete mod.noSubs; Object.assign(pl, mod); window.__pl = pl; return TS.exportVideo(JSON.stringify(pl)); }, [mod, LEN]);
        for (;;) { const j = await ev(id => JSON.parse(TS.job(id)), job); if (j && j.status !== 'running') { if (j.status !== 'done') throw new Error('Export: ' + j.error); return j.result; } await sleep(300); }
      };
      const ohne = (await exportPlan({ name: 'wys_ohne_' + c.name, noSubs: true })).playable;
      const mit = await exportPlan({ name: 'wys_' + c.name });
      r.warn = mit.warn || null; r.files = (mit.files || []).map(f => path.basename(f));
      r.size = await ev(() => [window.__pl.width, window.__pl.height]);
      r.times = c.times || await ev(LEN => { const cs = computedCues().filter(x => x.e < LEN); const one = cs.find(x => !wrapText(x.text).includes('\n')), two = cs.find(x => wrapText(x.text).includes('\n')); return [one, two].filter(Boolean).map(x => +((x.s + x.e) / 2).toFixed(2)); }, LEN);
      const hide = v => ev(v => { for (const s of ['#subOv', '#titleOv', '#tline', '#srcLine', '#lowerOv']) { const e = document.querySelector(s); if (e) e.style.visibility = v; } }, v);
      for (let k = 0; k < r.times.length; k++) {
        frame(ohne, r.times[k], path.join(OUTD, `ex_${c.name}_${k}_ohne.png`)); frame(mit.playable, r.times[k], path.join(OUTD, `ex_${c.name}_${k}.png`));
        await ev(o => { pausePlay(); seekOut(o, false); }, r.times[k]); await sleep(900);
        const st = await page.$('#stage');
        await st.screenshot({ path: path.join(OUTD, `pv_${c.name}_${k}.png`) });
        await hide('hidden'); await sleep(150);
        await st.screenshot({ path: path.join(OUTD, `pv_${c.name}_${k}_ohne.png`) });
        await hide('');
        r.shots.push(await ev(() => { const ov = document.querySelector('#subOv'), s = document.querySelector('#stage').getBoundingClientRect(); return { text: ov.textContent, stage: [s.width, s.height], fam: getComputedStyle(ov).fontFamily, px: parseFloat(getComputedStyle(ov).fontSize) }; }));
      }
      await ev(i => { if (typeof P !== 'undefined' && P && P.id === i){ pausePlay(); clearTimeout(saveT); P = null; busPid = null; showHome(); } TS.deleteProject(i); if (TS.trashPurge) try { TS.trashPurge(i); } catch (_) {} }, nid);
    } catch (e) { r.error = String(e.stack || e.message).slice(0, 800); }
    res.cfg.push(r); save();
  }
  res.ok = true;
} catch (e) { res.ok = false; res.error = String(e.stack || e.message).slice(0, 2000); }
save();
if (br) await br.close().catch(() => {});
process.exit(0);
