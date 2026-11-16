// Bedienung im Studio mit echter Maus und Tastatur – dieselben Handgriffe auf altem und neuem Stand, danach muss das
// Projekt in beiden gleich aussehen (Auswahl, Trimmen, Verschieben, Umsortieren, Teilen, Löschen, Rückgängig, Zoom, Scrollen).
import { browser as startBrowser, ids as loadIds, BASE, BASIS } from './drv.mjs';
import fs from 'node:fs';
const ids = loadIds();
const URLS = { alt: BASIS, neu: BASE };
if (!BASIS){ console.log('ERGEBNIS Vergleich Bedienung: übersprungen (keine Vergleichsfassung gestartet)'); process.exit(0); }
const key = process.argv[2] || 'stress';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const browser = await startBrowser();

async function run(label, url){
  const page = await browser.newPage({ viewport: { width: 1480, height: 1150 } });
  const errs = []; page.on('pageerror', e => errs.push(e.message)); page.on('dialog', d => d.accept().catch(() => {}));
  await page.goto(url); await page.waitForFunction(() => typeof showHome === 'function');
  // Wegwerf-Kopie
  const nid = await page.evaluate(i => { const c = JSON.parse(TS.loadProject(i)); c.id = 'tmp' + newId(); c.name = 'Bedienung'; TS.saveProject(c.id, JSON.stringify(c)); return c.id; }, ids[key]);
  await page.evaluate(i => openProject(i), nid); await page.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i, nid); await sleep(500);
  const steps = [];
  const state = async name => {
    await sleep(350);
    const s = await page.evaluate(() => {
      const h = str => { let x = 0; for (let i = 0; i < str.length; i++) x = (x * 31 + str.charCodeAt(i)) | 0; return x; };
      const sn = JSON.parse(snapshot()); delete sn.fm; delete sn.fr; delete sn.sv; delete sn.mk; delete sn.tl; delete sn.rf; delete sn.ss; delete sn.lw; delete sn.ck; delete sn.kw; delete sn.cl; delete sn.pt; delete sn.ps; delete sn.au;   // neue Felder des Stands (Format, Ausschnitt, Lautstärke, Marken, Textzeile, Quellen, Bauchbinden, Prüfliste, Betonungen, Vorgemerktes, Teil einer Reihe) nicht mitvergleichen
      return { snap: h(JSON.stringify(sn)), n: timeline.length, total: r3(total), out: r3(outPos), sel: TL.sel ? JSON.stringify(TL.sel) : null, tl: h(JSON.stringify(timeline.map(g => [g.kind, r3(g.in), r3(g.out), r3(g.o)]))),
        ov: h(JSON.stringify(overlays.map(o => [o.x.id, r3(o.at), r3(o.end)]))), blocks: document.querySelectorAll('#tlInner .blk').length, pps: +TL.pps.toFixed(3) };
    });
    steps.push({ name, ...s });
    // Abspiellinie für den nächsten Schritt in beiden Ständen auf dieselbe Stelle setzen (der neue Stand hält sie beim
    // Bearbeiten auf demselben Bild, der alte auf derselben Zeit – das ist gewollt und wird getrennt geprüft)
    await page.evaluate(k => { seekOut(Math.min(total - 1, 17.37 + k * 1.13), false); if (window.syncScroll) syncScroll(outPos, true); }, steps.length); await sleep(150);
  };
  // Element in den sichtbaren Teil der Zeitleiste holen – nur über das Scrollen der Zeitleiste selbst (wie von Hand)
  const rect = (sel, nth = 0) => page.evaluate(([s, n]) => { const e = document.querySelectorAll(s)[n]; if (!e) return null;
    let r = e.getBoundingClientRect(); const v = tlEl.getBoundingClientRect();
    if (e.closest('#tlInner') && (r.left < v.left + 80 || r.right > v.right - 80)){ tlEl.scrollLeft = Math.max(0, Math.round(tlEl.scrollLeft + (r.left + r.width / 2) - (v.left + v.width / 2))); r = e.getBoundingClientRect(); }
    return { x: r.x, y: r.y, w: r.width, h: r.height }; }, [sel, nth]);
  const drag = async (x, y, dx, dy = 0) => { await sleep(120); await page.mouse.move(x, y); await sleep(30); await page.mouse.down(); for (let k = 1; k <= 8; k++){ await page.mouse.move(x + dx * k / 8, y + dy * k / 8); await sleep(16); } await page.mouse.up(); };

  await page.evaluate(() => { setTab('studio'); const z = document.querySelector('#tlZoom'); z.value = 62; z.dispatchEvent(new Event('input', { bubbles: true })); seekOut(20, false); if (window.syncScroll) syncScroll(20, true); });
  await state('Studio geöffnet, Zoom gesetzt');
  let r = await rect('#trMain .blk', 3); await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2); await state('Clip 4 anklicken');
  r = await rect('#trMain .blk.sel .h.r'); if (r){ await drag(r.x + r.w / 2, r.y + r.h / 2, -30); } await state('rechten Rand von Clip 4 um 30 px kürzen');
  r = await rect('#trMain .blk', 5); await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2); r = await rect('#trMain .blk.sel .h.l'); if (r) await drag(r.x + r.w / 2, r.y + r.h / 2, 25); await state('linken Rand von Clip 6 um 25 px kürzen');
  r = await rect('#trOvlBox .blk', 0); if (r){ await drag(r.x + r.w / 2, r.y + r.h / 2, 60); } await state('erstes Element der Videospur um 60 px schieben');
  r = await rect('#trOvlBox .blk', 0); if (r){ await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2); const h = await rect('#trOvlBox .blk.sel .h.r'); if (h) await drag(h.x + h.w / 2, h.y + h.h / 2, 40); } await state('dasselbe Element rechts um 40 px verlängern');
  r = await rect('#trTxt .blk', 4); if (r){ await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2); const h = await rect('#trTxt .blk.sel .h.r'); if (h) await drag(h.x + h.w / 2, h.y + h.h / 2, 18); } await state('Untertitel 5 rechts um 18 px verlängern');
  r = await page.evaluate(() => { const q = document.querySelector('#ruler').getBoundingClientRect(), v = tlEl.getBoundingClientRect(); return { x: v.left, y: q.y, h: q.height }; }); await page.mouse.click(r.x + 420, r.y + r.h / 2); await state('in die Zeitskala klicken (springen)');
  await drag(r.x + 420, r.y + r.h / 2, 150); await state('Abspiellinie auf der Zeitskala 150 px ziehen');
  await page.mouse.move(r.x + 500, r.y + 120); await page.mouse.wheel(600, 0); await sleep(200); await state('mit dem Mausrad waagerecht scrollen');
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -240); await page.keyboard.up('Control'); await sleep(200); await state('Strg + Mausrad: zoomen');
  await page.keyboard.press('Control+b'); await state('Strg+B: teilen');
  r = await rect('#trMain .blk', 8); await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2); await page.keyboard.press('Delete'); await state('Clip 9 löschen (Entf)');
  await page.keyboard.press('Control+z'); await state('Strg+Z');
  await page.keyboard.press('Control+z'); await state('Strg+Z noch einmal');
  await page.click('#redoBtn'); await state('Wiederholen');
  r = await rect('#trMain .blk', 2); if (r){ await drag(r.x + r.w / 2, r.y + r.h / 2, 320); } await state('Clip 3 um 320 px nach rechts ziehen (umsortieren)');
  await page.evaluate(() => { const z = document.querySelector('#tlZoom'); z.value = 80; z.dispatchEvent(new Event('input', { bubbles: true })); }); await state('weiter hineinzoomen');
  await page.evaluate(() => { tlEl.scrollLeft += 1800; }); await sleep(300);
  r = await page.evaluate(() => { const bs = [...document.querySelectorAll('#trMain .blk')], v = tlEl.getBoundingClientRect(); const b = bs.find(e => { const q = e.getBoundingClientRect(); return q.left > v.left + 200 && q.right < v.right - 50; }); if (!b) return null; const q = b.getBoundingClientRect(); return { x: q.x, y: q.y, w: q.width, h: q.height }; });
  if (r) await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2); await state('nach dem Scrollen einen sichtbaren Clip anklicken');
  await page.keyboard.press('q'); await state('Q: links der Abspiellinie löschen');
  await page.keyboard.press('w'); await state('W: rechts der Abspiellinie löschen');
  await page.keyboard.press('ArrowDown'); await state('Pfeil runter: zum nächsten Schnitt');
  await page.keyboard.press('Control+z'); await state('Strg+Z');
  await page.keyboard.press('Space'); await sleep(1200); await page.keyboard.press('Space'); await sleep(300);
  const played = await page.evaluate(() => outPos);
  await page.evaluate(i => { pausePlay(); clearTimeout(saveT); P = null; busPid = null; showHome(); TS.deleteProject(i); if (TS.trashPurge) try { TS.trashPurge(i); } catch (_) {} }, nid);
  await page.close();
  return { steps, errs, played };
}
const a = await run('alt', URLS.alt), b = await run('neu', URLS.neu);
let bad = 0;
for (let i = 0; i < a.steps.length; i++){
  const x = a.steps[i], y = b.steps[i], same = JSON.stringify({ ...x, out: 0 }) === JSON.stringify({ ...y, out: 0 });
  if (!same) bad++;
  console.log((same ? 'gleich     ' : 'ABWEICHUNG ') + x.name.padEnd(52), `Abschnitte ${x.n} · ${x.total} s · Stelle alt ${x.out} / neu ${y.out} · Auswahl ${x.sel ? x.sel.slice(0, 40) : '–'}`);
  if (!same) console.log('    alt:', JSON.stringify(x), '\n    neu:', JSON.stringify(y));
}
console.log('Fehler in der Seite – alt:', a.errs.length, a.errs.slice(0, 2).join(' | '), '· neu:', b.errs.length, b.errs.slice(0, 2).join(' | '));
console.log(`ERGEBNIS Vergleich Bedienung (${key}): ${bad || b.errs.length ? bad + ' Schritte weichen ab' : 'alle Schritte gleich'}`);
await browser.close();
process.exit(bad || b.errs.length ? 1 : 0);
