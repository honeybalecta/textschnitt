// Diagnose (nur auf dem Testzweig): bedient die Oberfläche der installierten, veröffentlichten Windows-App wie ein Mensch –
// Projekt öffnen, im Reiter „Untertitel“ die Schrift wählen, im Reiter „Export“ auf „Video exportieren“ klicken.
// Aufruf: node tests/diag_ui.mjs <Adresse der App> <Projekt-ID> <Ergebnisdatei>
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const [, , base, pid, outFile] = process.argv;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const res = { steps: [], logs: [] };
const save = () => fs.writeFileSync(outFile, JSON.stringify(res, null, 1));
let br = null;
try {
  const args = ['--autoplay-policy=no-user-gesture-required', '--mute-audio'];
  try { br = await chromium.launch({ channel: 'msedge', args }); res.browser = 'msedge'; }
  catch (e) { res.logs.push('Edge nicht startbar: ' + String(e.message).slice(0, 200)); br = await chromium.launch({ channel: 'chrome', args }); res.browser = 'chrome'; }
  res.browserVersion = br.version();
  const ctx = await br.newContext({ viewport: { width: 1480, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') res.logs.push(m.type() + ': ' + m.text().slice(0, 300)); });
  page.on('pageerror', e => res.logs.push('PAGEERROR: ' + String(e.stack || e.message).slice(0, 500)));
  page.on('dialog', d => { res.logs.push('Dialog: ' + d.message().slice(0, 200)); d.accept().catch(() => {}); });
  await page.goto(base);
  await page.waitForFunction(() => typeof showHome === 'function', null, { timeout: 30000 });
  res.platform = await page.evaluate(() => { try { return JSON.stringify({ platform: CAP.platform, version: CAP.version || null, title: document.title }); } catch (e) { return String(e); } });
  await page.evaluate(id => openProject(id), pid);
  await page.waitForFunction(id => typeof P !== 'undefined' && P && P.id === id, pid, { timeout: 30000 });
  await sleep(1500);
  res.opened = await page.evaluate(() => ({ name: P.name, tokens: tokens.length, cues: P.cues.length, style: P.sub_style, burn: P.settings.burn, fontOptions: [...document.querySelectorAll('#stFont option')].map(o => o.value) }));
  save();
  // Den Plan mitschreiben, den die Oberfläche an das Backend schickt
  await page.evaluate(() => { const o = TS.exportVideo; window.__plans = []; TS.exportVideo = s => { window.__plans.push(s); return o(s); }; });

  async function setFont(key) {
    await page.click('#tabs button[data-tab="subs"]'); await sleep(500);
    await page.selectOption('#stFont', key); await sleep(700);
    const st = await page.evaluate(() => { const ov = document.querySelector('#subOv'); return { font: S().font, select: document.querySelector('#stFont').value, ovFamily: ov ? ov.style.fontFamily : null, loaded: document.fonts ? [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family) : [] }; });
    res.steps.push({ step: 'Schrift wählen: ' + (key || 'Standard'), ...st }); save();
  }
  async function exportAs(name) {
    await page.click('#tabs button[data-tab="export"]'); await sleep(600);
    await page.evaluate(n => { if (typeof exFmt !== 'undefined' && exFmt !== 'video') { exFmt = 'video'; if (typeof paintExportForm === 'function') paintExportForm(); } document.querySelector('#exName').value = n; }, name);
    const info = await page.evaluate(() => ({ fmt: typeof exFmt !== 'undefined' ? exFmt : null, burnBox: document.querySelector('#exSubs').checked, level: document.querySelector('#exLevel') ? document.querySelector('#exLevel').checked : null }));
    const before = await page.evaluate(() => window.__plans.length);
    await page.click('#exBtn');
    await page.waitForFunction(n => window.__plans.length > n || /^Fehler/.test(document.querySelector('#exMsg').textContent), before, { timeout: 120000 });
    await page.waitForFunction(() => !document.querySelector('#exDone').classList.contains('hidden') || /^Fehler|Abgebrochen/.test(document.querySelector('#exMsg').textContent), null, { timeout: 900000 });
    const r = await page.evaluate(() => {
      const raw = window.__plans[window.__plans.length - 1], pl = raw ? JSON.parse(raw) : {};
      return { msg: document.querySelector('#exMsg').textContent, files: (typeof exResult !== 'undefined' && exResult && exResult.files) || [], burn: pl.burn, nSeg: (pl.segments || []).length, total: pl.total,
        style: pl.subs && pl.subs.style, fonts: pl.subs && pl.subs.fonts, nCues: pl.subs ? pl.subs.cues.length : 0, cue0: pl.subs && pl.subs.cues[0],
        cueFonts: pl.subs ? [...new Set(pl.subs.cues.map(c => 'font' in c ? 'font=' + String(c.font) : '(ohne)'))] : [], w: pl.width, h: pl.height,
        mids: (cs => cs.length ? [cs[1] || cs[0], cs[cs.length >> 1], cs[Math.max(0, cs.length - 2)]].map(c => +((c.start + c.end) / 2).toFixed(2)) : [])(pl.subs ? pl.subs.cues.filter(c => !c.title) : []) };
    });
    res.steps.push({ step: 'Export: ' + name, ...info, ...r }); save();
    return r;
  }

  // 1. Ungeschnitten: Standardschrift, dann Poppins, dann Anton
  await setFont(''); await exportAs('ui_standard');
  await setFont('poppins'); await exportAs('ui_poppins');
  await setFont('anton'); await exportAs('ui_anton');
  // 2. Mit vielen Schnitten (mehr als sechs Abschnitte: die App rechnet dann in Stücken)
  await page.click('#tabs button[data-tab="text"]'); await sleep(500);
  const cut = await page.evaluate(() => {
    const w = tokens.filter(t => t.type === 'word').map(t => t.i), ids = [];
    for (let k = 12; k < w.length - 12 && ids.length < 40; k += 14) ids.push(w[k], w[k + 1]);
    commit(() => ids.forEach(i => deleted.add(i)), true);
    return { geloescht: ids.length, abschnitte: timeline.length };
  });
  res.steps.push({ step: 'Schneiden', ...cut }); save(); await sleep(800);
  await setFont(''); await exportAs('ui_schnitt_standard');
  await setFont('poppins'); await exportAs('ui_schnitt_poppins');
  res.ok = true;
} catch (e) {
  res.ok = false; res.error = String(e.stack || e.message).slice(0, 2000);
}
save();
if (br) await br.close().catch(() => {});
process.exit(0);
