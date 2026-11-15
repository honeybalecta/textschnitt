// Projekte umbenennen: in der Projektliste und im offenen Projekt
import { launch, scratch, dropScratch, sleep, BASE, ids as loadIds, OUT, DATA, WORK } from './drv.mjs';
import fs from 'node:fs';
const ids = loadIds();
let bad = 0; const check = (name, ok, extra = '') => { if (!ok) bad++; console.log((ok ? 'ok    ' : 'FEHLER') + ' ' + name + (extra ? '  · ' + extra : '')); };
const { browser, ctx, page, logs } = await launch();
const nid = await scratch(page, ids.kurz);
await page.evaluate(() => { saveNow(); closeProject(); }); await sleep(400);
const before = await page.evaluate(i => { const l = JSON.parse(TS.listProjects()); return { order: l.sort((a, b) => b.updated - a.updated).map(p => p.id), upd: l.find(p => p.id === i).updated }; }, nid);
// 1) In der Projektliste: Stift → Feld → neuer Name → Enter
const row = page.locator('.proj-item', { hasText: 'Test ' + nid });
await row.locator('.ren').click(); await sleep(100);
check('Stift öffnet ein Eingabefeld mit dem bisherigen Namen', await page.locator('.proj-item .name-edit').inputValue() === 'Test ' + nid);
await page.keyboard.press('Control+a'); await page.keyboard.type('  Mietendeckel   Statement  '); await page.keyboard.press('Enter'); await sleep(300);
const afterList = await page.evaluate(i => { const l = JSON.parse(TS.listProjects()); const p = l.find(x => x.id === i); return { name: p.name, upd: p.updated, order: l.sort((a, b) => b.updated - a.updated).map(x => x.id), shown: [...document.querySelectorAll('.proj-item b')].map(b => b.textContent), open: !!P }; }, nid);
check('Name ist gespeichert (Leerzeichen bereinigt)', afterList.name === 'Mietendeckel Statement', afterList.name);
check('Liste zeigt den neuen Namen, Projekt wurde dabei nicht geöffnet', afterList.shown.includes('Mietendeckel Statement') && !afterList.open);
check('Reihenfolge und Änderungsdatum bleiben', JSON.stringify(afterList.order) === JSON.stringify(before.order) && afterList.upd === before.upd);
// Esc bricht ab, leerer Name wird nicht übernommen
await page.locator('.proj-item', { hasText: 'Mietendeckel Statement' }).locator('.ren').click(); await page.keyboard.type('Verworfen'); await page.keyboard.press('Escape'); await sleep(150);
await page.locator('.proj-item', { hasText: 'Mietendeckel Statement' }).locator('.ren').click(); await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace'); await page.keyboard.press('Enter'); await sleep(150);
check('Esc und leerer Name ändern nichts', await page.evaluate(i => JSON.parse(TS.listProjects()).find(x => x.id === i).name, nid) === 'Mietendeckel Statement');
// 2) Im offenen Projekt: Name in der Kopfzeile anklicken
await page.locator('.proj-item', { hasText: 'Mietendeckel Statement' }).locator('.meta').click();
await page.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i, nid); await sleep(500);
const ex0 = await page.evaluate(() => document.querySelector('#exName').value);
await page.click('#projName'); await sleep(100);
const outBefore = await page.evaluate(() => ({ playing, n: timeline.length, del: deleted.size }));
await page.keyboard.press('Control+a'); await page.keyboard.type('Rede q w Bundestag 2026'); await sleep(100);   // q, w und Leertaste sind sonst Kurzbefehle
const mid = await page.evaluate(() => ({ playing, n: timeline.length, del: deleted.size }));
await page.keyboard.press('Enter'); await sleep(400);
const hdr = await page.evaluate(() => ({ title: document.querySelector('#projName').textContent, name: P.name, ex: document.querySelector('#exName').value, disk: JSON.parse(TS.loadProject(P.id)).name, saved: document.querySelector('#saved').textContent }));
check('Kopfzeile: neuer Name angezeigt und gespeichert', hdr.title === 'Rede q w Bundestag 2026' && hdr.name === hdr.title && hdr.disk === hdr.title && hdr.saved === '✓', JSON.stringify(hdr));
check('Export schlägt den neuen Namen vor', ex0 === 'Mietendeckel Statement_geschnitten' && hdr.ex === 'Rede q w Bundestag 2026_geschnitten', hdr.ex);
check('Tippen im Namensfeld löst keine Kurzbefehle aus', JSON.stringify(outBefore) === JSON.stringify(mid), JSON.stringify(mid));
// eigener Exportname bleibt beim Umbenennen stehen
await page.evaluate(() => { document.querySelector('#exName').value = 'mein_export'; }); await page.click('#projName'); await page.keyboard.press('Control+a'); await page.keyboard.type('Dritter Name'); await page.keyboard.press('Enter'); await sleep(300);
check('Ein selbst gewählter Exportname bleibt', await page.evaluate(() => document.querySelector('#exName').value) === 'mein_export');
// 3) Zweites Fenster bekommt den Namen
const page2 = await ctx.newPage(); await page2.goto(BASE); await page2.waitForFunction(() => typeof showHome === 'function');
await page2.evaluate(i => openProject(i), nid); await page2.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i, nid); await sleep(2200);
await page.click('#projName'); await page.keyboard.press('Control+a'); await page.keyboard.type('Name aus Fenster 1'); await page.keyboard.press('Enter'); await sleep(1200);
check('Zweites Fenster zeigt den neuen Namen', await page2.evaluate(() => document.querySelector('#projName').textContent) === 'Name aus Fenster 1');
await page2.close();
await page.screenshot({ path: OUT + '/umbenennen-kopf.png', clip: { x: 0, y: 0, width: 900, height: 60 } });
await page.click('#projName'); await sleep(150); await page.screenshot({ path: OUT + '/umbenennen-feld.png', clip: { x: 0, y: 0, width: 900, height: 60 } }); await page.keyboard.press('Escape');
await page.evaluate(() => closeProject()); await sleep(300);
await page.locator('.proj-item', { hasText: 'Name aus Fenster 1' }).locator('.ren').click(); await sleep(150);
await page.screenshot({ path: OUT + '/umbenennen-liste.png', clip: { x: 300, y: 50, width: 900, height: 260 } }); await page.keyboard.press('Escape');
await dropScratch(page, nid);
const errs = logs.filter(l => !/404/.test(l)); check('keine Fehler in der Seite', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`ERGEBNIS Projekte umbenennen: ${bad} Fehler`);
await browser.close();
process.exit(bad ? 1 : 0);
