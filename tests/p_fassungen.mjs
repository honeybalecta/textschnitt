// Frühere Fassungen und Papierkorb in der Oberfläche (Desktop)
import { launch, sleep, BASE, ids as loadIds, OUT, DATA, WORK } from './drv.mjs';
import fs from 'node:fs';
import zlib from 'node:zlib';
const ids = loadIds();
const D = DATA;
let bad = 0; const check = (name, ok, extra = '') => { if (!ok) bad++; console.log((ok ? 'ok    ' : 'FEHLER') + ' ' + name + (extra ? '  · ' + extra : '')); };
const { browser, ctx, page, logs } = await launch();
// Projekt mit drei gesicherten Fassungen anlegen (Sicherungen direkt in den Datenordner gelegt)
const pid = 'fassui' + Math.random().toString(36).slice(2, 6);
const base = JSON.parse(fs.readFileSync(`${D}/projects/${ids.kurz}.json`, 'utf8'));
const mk = (name, ndel, ago) => { const o = { ...base, id: pid, name, deleted: base.tokens.filter(t => t.type === 'word').slice(0, ndel).map(t => t.i), updated: Date.now() - ago * 60000 }; return JSON.stringify(o); };
fs.mkdirSync(`${D}/sicherungen/${pid}`, { recursive: true });
const stamp = ago => { const d = new Date(Date.now() - ago * 60000), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
for (const [name, ndel, ago] of [['Rede Rohfassung', 0, 180], ['Rede', 12, 90], ['Rede', 25, 40]]) fs.writeFileSync(`${D}/sicherungen/${pid}/${stamp(ago - 1)}.json.gz`, zlib.gzipSync(mk(name, ndel, ago)));
fs.writeFileSync(`${D}/projects/${pid}.json`, mk('Rede', 40, 1));
await page.evaluate(() => showHome()); await sleep(300);
const row = () => page.locator('.proj-item', { hasText: 'Rede' }).first();
// 1) Liste der Fassungen
await row().locator('.ver').click(); await sleep(300);
let items = await page.evaluate(() => [...document.querySelectorAll('#mgSheet .mg-item')].map(e => e.querySelector('b').textContent + ' | ' + e.querySelector('span').textContent));
check('Blatt zeigt drei Fassungen, jüngste zuerst', items.length === 3 && /25 Stellen gelöscht/.test(items[0]) && /12 Stellen/.test(items[1]) && /Rohfassung/.test(items[2]), items.join(' ‖ '));
await page.screenshot({ path: OUT + '/fassungen.png' });
// 2) Als Kopie öffnen
await page.locator('#mgSheet .mg-item').nth(2).locator('[data-a=copy]').click();
await page.waitForFunction(i => typeof P !== 'undefined' && P && P.id !== i && /Fassung vom/.test(P.name), pid, { timeout: 8000 }); await sleep(400);
const cp = await page.evaluate(() => ({ id: P.id, name: P.name, del: deleted.size, sheetClosed: document.querySelector('#mgSheet').classList.contains('hidden') }));
check('„Als Kopie öffnen“ öffnet ein eigenes Projekt mit dem alten Stand', /^Rede Rohfassung \(Fassung vom/.test(cp.name) && cp.del === 0 && cp.sheetClosed, JSON.stringify(cp));
await page.evaluate(() => closeProject()); await sleep(300);
// 3) Zurückholen – mit dem Projekt in einem zweiten Fenster offen
const page2 = await ctx.newPage(); await page2.goto(BASE); await page2.waitForFunction(() => typeof showHome === 'function');
await page2.evaluate(i => openProject(i), pid); await page2.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i, pid); await sleep(1800);
const w2before = await page2.evaluate(() => deleted.size);
await page.locator('.proj-item', { hasText: /^Rede/ }).filter({ hasNotText: 'Fassung vom' }).locator('.ver').click(); await sleep(300);
await page.locator('#mgSheet .mg-item').nth(1).locator('[data-a=back]').click(); await sleep(3800);
const disk = JSON.parse(fs.readFileSync(`${D}/projects/${pid}.json`, 'utf8'));
check('„Zurückholen“ setzt das Projekt auf den gewählten Stand', disk.deleted.length === 12 && disk.id === pid, `${disk.deleted.length} gelöschte Wörter`);
const w2 = await page2.evaluate(() => deleted.size);
check('Das zweite Fenster lädt den zurückgeholten Stand', w2before === 40 && w2 === 12, `${w2before} → ${w2}`);
await page.locator('.proj-item', { hasText: /^Rede/ }).filter({ hasNotText: 'Fassung vom' }).locator('.ver').click(); await sleep(300);
items = await page.evaluate(() => [...document.querySelectorAll('#mgSheet .mg-item span')].map(e => e.textContent));
check('Der Stand vor dem Zurückholen liegt jetzt selbst bei den Fassungen', items.length === 4 && /40 Stellen gelöscht/.test(items[0]), items[0]);
await page.click('#mgClose'); await page2.close();
// 4) Papierkorb
const n0 = await page.evaluate(() => document.querySelectorAll('.proj-item').length);
await page.locator('.proj-item', { hasText: /^Rede/ }).filter({ hasNotText: 'Fassung vom' }).locator('.del:not(.share):not(.ren):not(.ver)').click(); await sleep(300);
const link = await page.evaluate(() => { const b = document.querySelector('.trash-link'); return b ? b.textContent : null; });
check('Nach dem Löschen erscheint der Papierkorb auf der Startseite', /Papierkorb \(1\)/.test(link || '') && await page.evaluate(() => document.querySelectorAll('.proj-item').length) === n0 - 1, link);
await page.click('.trash-link'); await sleep(300);
const tr = await page.evaluate(() => [...document.querySelectorAll('#mgSheet .mg-item')].map(e => e.querySelector('b').textContent + ' | ' + e.querySelector('span').textContent));
check('Papierkorb zeigt das gelöschte Projekt mit Restzeit', tr.length === 1 && /^Rede \| gelöscht am .* noch 30 Tage/.test(tr[0]), tr[0]);
await page.screenshot({ path: OUT + '/papierkorb.png' });
await page.locator('#mgSheet [data-a=back]').click(); await sleep(400);
check('Wiederherstellen bringt das Projekt zurück in die Liste', await page.evaluate(() => [...document.querySelectorAll('.proj-item b')].some(b => b.textContent === 'Rede')) && !(await page.evaluate(() => !!document.querySelector('.trash-link'))));
// endgültig löschen
await page.locator('.proj-item', { hasText: /^Rede/ }).filter({ hasNotText: 'Fassung vom' }).locator('.del:not(.share):not(.ren):not(.ver)').click(); await sleep(300);
await page.click('.trash-link'); await sleep(300); await page.locator('#mgSheet [data-a=kill]').click(); await sleep(400);
check('Endgültig löschen leert den Eintrag', !fs.existsSync(`${D}/sicherungen/${pid}`) && !(await page.evaluate(() => !!document.querySelector('.trash-link'))));
// Kopie aufräumen
await page.evaluate(i => { TS.deleteProject(i); TS.trashPurge(i); showHome(); }, cp.id);
const errs = logs.filter(l => !/404/.test(l)); check('keine Fehler in der Seite', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`ERGEBNIS Frühere Fassungen und Papierkorb: ${bad} Fehler`);
await browser.close();
process.exit(bad ? 1 : 0);
