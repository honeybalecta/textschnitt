// Gemeinsame Hilfen für die Prüfläufe: Chrome starten, HoneyCut öffnen, Testprojekte kopieren, Ergebnisse zählen.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const WORK = process.env.HC_WORK || path.join(HERE, '.work');
export const PORT = process.env.HC_PORT || '8795';
export const BASE = process.env.HC_URL || `http://127.0.0.1:${PORT}/test/index.html`;
export const API = BASE.replace(/index\.html$/, 'api/');
// Vergleichs-Backend mit einer früheren Fassung (nur gesetzt, wenn lauf.sh es gestartet hat)
export const BASIS = process.env.HC_BASIS_URL || '';
export const DATA = path.join(WORK, 'data');
export const MEDIA = path.join(WORK, 'media') + path.sep;
export const OUT = path.join(WORK, 'out');
fs.mkdirSync(OUT, { recursive: true });
export const ids = () => JSON.parse(fs.readFileSync(path.join(WORK, 'projects.json'), 'utf8'));
export const setPick = o => fs.writeFileSync(path.join(WORK, 'pick.json'), JSON.stringify(o));
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const fmt = o => JSON.stringify(o);
export const api = async (p, body) => (await fetch(API + p, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) })).json();

const ARGS = ['--autoplay-policy=no-user-gesture-required', '--no-sandbox', '--disable-dev-shm-usage', '--mute-audio'];
// Google Chrome (spielt H.264 ab); HC_CHROME nennt bei Bedarf ein anderes Programm
export async function browser(extra = []){
  const args = ARGS.concat(extra);
  if (process.env.HC_CHROME) return chromium.launch({ executablePath: process.env.HC_CHROME, args });
  try { return await chromium.launch({ channel: 'chrome', args }); } catch (_) { return chromium.launch({ args }); }
}
export async function launch(opts = {}){
  const br = await browser(opts.args);
  const ctx = await br.newContext({ viewport: opts.viewport || { width: 1480, height: 900 }, deviceScaleFactor: opts.dpr || 1.25 });
  const page = await ctx.newPage();
  const logs = watch(page);
  await page.goto(opts.url || BASE);
  await page.waitForFunction(() => typeof showHome === 'function');
  return { browser: br, ctx, page, logs };
}
// Meldungen der Seite sammeln. HoneyDeck ist in den Prüfläufen nicht installiert, ScriptGenius nur, wenn lauf.sh es bereitstellen konnte:
// Die Anfrage nach deck/version.txt bzw. sg/version.txt endet dann erwartungsgemäß mit 404.
export function watch(page){
  const logs = [];
  page.on('console', m => { const t = m.text(); if ((m.type() === 'error' || m.type() === 'warning') && !/Failed to load resource/.test(t)) logs.push(`${m.type()}: ${t}`); });
  page.on('pageerror', e => logs.push('PAGEERROR: ' + (e.stack || e.message)));
  page.on('response', r => { if (r.status() >= 400 && !/(deck|sg)\/version\.txt/.test(r.url())) logs.push(`HTTP ${r.status()}: ${r.url().replace(/^.*\/test\//, '')}`); });
  page.on('dialog', d => d.accept().catch(() => {}));
  return logs;
}
// Neues Projekt aus Dateien anlegen (über den echten Weg: Knopf → Dateiauswahl → createProject)
export async function newProject(page, files){
  setPick({ videos: files });
  await page.click('#newProj');
  await page.waitForFunction(() => typeof P !== 'undefined' && P && !document.querySelector('#proj').classList.contains('hidden'), null, { timeout: 30000 });
  return page.evaluate(() => P.id);
}
export async function transcribe(page){
  await page.evaluate(() => { document.querySelector('#autoPauses').checked = false; document.querySelector('#autoFillers').checked = false; document.querySelector('#autoRepeats').checked = false; });
  await page.click('#transBtn');
  await page.waitForFunction(() => tokens.length > 0 && document.querySelector('#transCancel').classList.contains('hidden'), null, { timeout: 180000 });
  await sleep(300);
}
export async function openById(page, id){
  await page.evaluate(i => { if (P) closeProject(); openProject(i); }, id);
  await page.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i, id, { timeout: 30000 });
  await sleep(400);
}
// Wegwerf-Kopie eines Projekts (für Prüfungen, die das Projekt verändern)
export async function scratch(page, id){
  const nid = await page.evaluate(i => { if (typeof P !== 'undefined' && P) { pausePlay(); clearTimeout(saveT); P = null; } const c = JSON.parse(TS.loadProject(i)); c.id = 'tmp' + newId(); c.name = 'Test ' + c.id; TS.saveProject(c.id, JSON.stringify(c)); return c.id; }, id);
  await page.evaluate(i => openProject(i), nid);
  await page.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i, nid, { timeout: 30000 });
  await sleep(300);
  return nid;
}
export async function dropScratch(page, nid){
  await page.evaluate(i => { if (typeof P !== 'undefined' && P && P.id === i){ pausePlay(); clearTimeout(saveT); P = null; busPid = null; showHome(); } TS.deleteProject(i); if (TS.trashPurge) try { TS.trashPurge(i); } catch (_) {} }, nid);
}
// Ergebnisse zählen und am Ende eine Zeile für den Bericht ausgeben
export function pruefung(titel){
  let n = 0, bad = 0, zu = false;
  const chk = (name, ok, extra) => { n++; if (!ok) bad++; console.log((ok ? 'ok     ' : 'FEHLER ') + name + (extra !== undefined && extra !== '' ? ' · ' + (typeof extra === 'string' ? extra : JSON.stringify(extra)) : '')); return ok; };
  const ende = async br => { zu = true; if (br) await br.close().catch(() => {}); console.log(`ERGEBNIS ${titel}: ${n} geprüft, ${bad} Fehler`); process.exit(bad ? 1 : 0); };
  // Bricht eine Prüfung mitten im Lauf ab (eine Wartezeit läuft ab, ein Element fehlt), steht der Grund als Fehlerzeile im Bericht –
  // vorher blieb nur „ohne Ergebnis abgebrochen“, und die Ursache stand irgendwo im Protokoll.
  const abbruch = e => { if (zu) return; zu = true;
    console.log('FEHLER Prüfung abgebrochen · ' + String((e && e.stack) || e).replace(/\s+/g, ' ').slice(0, 600));
    console.log(`ERGEBNIS ${titel}: ${n} geprüft, ${bad + 1} Fehler (nach ${n} Prüfungen abgebrochen)`); process.exit(1); };
  process.on('uncaughtException', abbruch); process.on('unhandledRejection', abbruch);
  return { chk, ende, fehler: () => bad };
}
