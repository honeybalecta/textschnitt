// Ende-zu-Ende-Test der Browser-Version in echtem Chrome:
// Video wählen → transkribieren (Whisper im Browser) → schneiden → Video/Audio exportieren → Neuladen.
// Aufruf: node web/test/e2e.mjs <site> <testmedien> <ausgabe>
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const [SITE, MEDIA, OUT] = process.argv.slice(2).map(p => path.resolve(p));
fs.mkdirSync(OUT, {recursive: true});
const R = {steps: [], errors: [], console: []};
const step = (name, ok, info = {}) => { R.steps.push({name, ok, ...info}); console.log(ok ? '✓' : '✗', name, JSON.stringify(info).slice(0, 400)); };

const TYPES = {'.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript', '.css':'text/css', '.json':'application/json',
  '.wasm':'application/wasm', '.png':'image/png', '.svg':'image/svg+xml', '.webmanifest':'application/manifest+json'};
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(SITE, p);
  if (!f.startsWith(SITE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); return res.end(); }
  res.writeHead(200, {'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream'}); fs.createReadStream(f).pipe(res);
}).listen(8123);
const BASE = 'http://localhost:8123/';

let browser;
try { browser = await chromium.launch({channel: 'chrome', args: ['--autoplay-policy=no-user-gesture-required']}); R.browser = 'chrome'; }
catch(e){ browser = await chromium.launch({args: ['--autoplay-policy=no-user-gesture-required']}); R.browser = 'chromium'; }
R.browserVersion = browser.version();
const ctx = await browser.newContext({acceptDownloads: true, viewport: {width: 1400, height: 900}, locale: 'de-DE'});
const page = await ctx.newPage();
page.on('console', m => { const t = `[${m.type()}] ${m.text()}`; R.console.push(t.slice(0, 500)); if (m.type() === 'error') console.log(t.slice(0, 300)); });
page.on('pageerror', e => { R.errors.push(String(e).slice(0, 500)); console.log('PAGEERROR', String(e).slice(0, 300)); });
const shot = name => page.screenshot({path: path.join(OUT, name + '.png')}).catch(() => {});
const ev = (fn, arg) => page.evaluate(fn, arg);
const pickFile = async (sel, file) => { const [fc] = await Promise.all([page.waitForEvent('filechooser', {timeout: 15000}), page.click(sel)]); await fc.setFiles(file); };

try {
  await page.goto(BASE + '?device=wasm&nosw');
  await page.waitForFunction(() => window.TSApp && document.documentElement.classList.contains('web-ready'), null, {timeout: 30000});
  R.info = JSON.parse(await ev(() => TS.info()));
  step('Seite lädt', true, {info: R.info, webcodecs: await ev(() => 'VideoEncoder' in window)});
  await shot('01-start');

  // Klassische Dateiauswahl erzwingen (die moderne lässt sich nicht fernsteuern)
  await ev(() => { window.showOpenFilePicker = undefined; });
  await pickFile('#newProj', path.join(MEDIA, 'test.mp4'));
  await page.waitForFunction(() => typeof P !== 'undefined' && P && P.sources && P.sources.length === 1, null, {timeout: 30000});
  const src = await ev(() => P.sources[0]);
  step('Video gewählt und gelesen', src.duration > 5 && src.width === 1280 && src.height === 720 && src.hasAudio, {src});
  await page.waitForTimeout(1500);
  const vOk = await ev(() => ({ready: document.querySelector('#v').readyState, err: document.querySelector('#v').dataset.err || ''}));
  step('Vorschau spielt die lokale Datei', vOk.ready >= 1 && !vOk.err, vOk);
  await shot('02-projekt');

  // Transkription
  const models = JSON.parse(await ev(() => TS.models()));
  await page.selectOption('#model', 'base');
  const t0 = Date.now();
  await page.click('#transBtn');
  await page.waitForFunction(() => tokens.length > 0 || /Fehler/.test(document.querySelector('#transMsg').textContent), null, {timeout: 900000, polling: 1000});
  const tr = await ev(() => ({msg: document.querySelector('#transMsg').textContent, words: tokens.filter(t => t.type === 'word').map(t => ({w: t.text, s: t.ws, e: t.we})),
    unk: tokens.filter(t => t.type === 'unk').length, env: (P.sources[0].env || '').length, dur: P.sources[0].duration}));
  const mono = tr.words.every((w, i) => w.s <= w.e && w.e <= tr.dur + 0.5 && (!i || w.s >= tr.words[i - 1].s - 0.05));
  const spread = tr.words.length ? new Set(tr.words.map(w => w.s.toFixed(1))).size / tr.words.length : 0;
  step('Transkription im Browser', tr.words.length >= 8 && mono && spread > 0.6 && tr.env > 100,
    {secs: Math.round((Date.now() - t0) / 1000), n: tr.words.length, mono, spread: +spread.toFixed(2), env: tr.env, msg: tr.msg, text: tr.words.map(w => w.w).join('').slice(0, 300),
     first: tr.words.slice(0, 6), models});
  await shot('03-text');

  // Schneiden: zwei Wörter löschen, Titel und Tempo/Schwarzweiß
  await ev(() => {
    const w = tokens.filter(t => t.type === 'word');
    commit(() => { for (const t of w.slice(2, 4)) deleted.add(t.i); });
    P.items.push({id: 'ttl1', type: 'title', at: 0.4, dur: 2.5, text: 'Testtitel', x: 0.5, y: 0.2, size: 'groß', color: '#FFDD00', outline: true});
    P.items.push({id: 'fx1', type: 'fx', at: 4, dur: 2.5, fx: {speed: 1.5, vol: 1, bright: 0.1, contrast: 0, sat: 0, gray: true}});
    changed();
  });
  const cut = await ev(() => ({total, segs: timeline.length, plan: buildPlan()}));
  step('Schnitt berechnet', cut.total > 2 && cut.total < tr.dur, {total: cut.total, segs: cut.segs});
  fs.writeFileSync(path.join(OUT, 'plan.json'), JSON.stringify(cut.plan, null, 1));

  // Studio mit Vorschaubildern
  await ev(() => setTab('studio'));
  const thumbsOk = await page.waitForFunction(() => [...document.querySelectorAll('.thumbs img')].some(i => i.src.startsWith('blob:') && i.naturalWidth > 0), null, {timeout: 30000}).then(() => true, () => false);
  step('Studio-Vorschaubilder', thumbsOk, {n: await ev(() => document.querySelectorAll('.thumbs img').length)});
  await shot('04-studio');

  // Video-Export
  const exportAs = async (fmt, file, audioFmt) => {
    await ev(() => setTab('export'));
    await page.click(`#exFmt button[data-v="${fmt}"]`);
    if (audioFmt) await page.selectOption('#exAudioFmt', audioFmt);
    const t1 = Date.now();
    const dl = page.waitForEvent('download', {timeout: 900000});
    await page.click('#exBtn');
    const d = await Promise.race([dl, page.waitForFunction(() => /Fehler/.test(document.querySelector('#exMsg').textContent), null, {timeout: 900000}).then(() => null)]);
    const msg = await ev(() => document.querySelector('#exMsg').textContent);
    if (!d){ step(`Export ${fmt}${audioFmt ? ' ' + audioFmt : ''}`, false, {msg}); return; }
    await d.saveAs(path.join(OUT, file));
    await page.waitForFunction(() => !document.querySelector('#exBtn').disabled, null, {timeout: 60000}).catch(() => {});
    step(`Export ${fmt}${audioFmt ? ' ' + audioFmt : ''}`, fs.statSync(path.join(OUT, file)).size > 1000,
      {secs: Math.round((Date.now() - t1) / 1000), size: fs.statSync(path.join(OUT, file)).size, name: d.suggestedFilename(), msg: await ev(() => document.querySelector('#exMsg').textContent)});
  };
  await exportAs('video', 'out.mp4');
  await shot('05-export');
  await exportAs('audio', 'out.mp3', 'mp3');
  await exportAs('audio', 'out.wav', 'wav');
  fs.writeFileSync(path.join(OUT, 'expected.json'), JSON.stringify({total: cut.total, title: {at: 0.4, dur: 2.5}}));

  // Neu laden: Projekt bleibt erhalten, Dateizugriff wird neu erteilt
  await page.reload();
  await page.waitForFunction(() => window.TSApp && document.documentElement.classList.contains('web-ready'), null, {timeout: 30000});
  const listed = await ev(() => document.querySelectorAll('#projList .proj-item').length);
  await ev(() => { window.showOpenFilePicker = undefined; });
  await page.click('#projList .proj-item');
  const dlg = await page.waitForSelector('.web-modal', {timeout: 10000}).then(() => true, () => false);
  await shot('06-zugriff');
  if (dlg) await pickFile('.web-modal [data-a="pick"]', path.join(MEDIA, 'test.mp4'));
  const reopened = await page.waitForFunction(() => P && tokens.length > 0 && document.querySelector('#v').src.startsWith('blob:'), null, {timeout: 20000}).then(() => true, () => false);
  step('Nach Neuladen: Projekt da, Zugriff wiederhergestellt', listed === 1 && dlg && reopened, {listed, dlg, reopened});

  // Service Worker & Isolation (schnellere Spracherkennung ohne Grafikkarte)
  const p2 = await ctx.newPage();
  await p2.goto(BASE);
  await p2.waitForTimeout(4000);
  await p2.waitForFunction(() => document.documentElement.classList.contains('web-ready'), null, {timeout: 30000}).catch(() => {});
  const iso = await p2.evaluate(() => ({coi: window.crossOriginIsolated, sw: !!navigator.serviceWorker.controller}));
  step('Service Worker / Isolation', iso.sw, iso);
} catch(e){
  R.errors.push('TEST: ' + (e && e.stack || e));
  console.log('TESTFEHLER', e);
  await shot('99-fehler');
}
await browser.close(); server.close();
fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(R, null, 1));
process.exit(0);
