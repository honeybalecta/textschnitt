// Bearbeiten während der Wiedergabe: läuft danach alles weiter? (Fehler in der Seite, Abspielschleife, Position)
import { launch, scratch, dropScratch, sleep, fmt, ids as loadIds, OUT, DATA, WORK } from './drv.mjs';
import fs from 'node:fs';
const ids = loadIds();
const key = process.argv[2] || 'edit';
const S = {
  'Text: Wort vor der Abspielstelle löschen': { tab: 'text', at: 60, op: () => { const g = timeline[curSeg], t = vT(); const w = tokens.filter(x => x.type === 'word' && !deleted.has(x.i) && x.we < t - 3).pop(); selA = selB = w.i; showSel(); document.querySelector('#selDel').click(); } },
  'Text: laufendes Wort löschen': { tab: 'text', at: 60, op: () => { const t = vT(); const w = tokens.find(x => x.type === 'word' && !deleted.has(x.i) && x.e > t + 0.05); selA = selB = w.i; showSel(); document.querySelector('#selDel').click(); } },
  'Text: 40 Wörter ab hier löschen': { tab: 'text', at: 60, op: () => { const t = vT(); const ws = tokens.filter(x => x.type === 'word' && !deleted.has(x.i) && x.e > t).slice(0, 40); selA = ws[0].i; selB = ws[39].i; showSel(); document.querySelector('#selDel').click(); } },
  'Text: alles nach der Abspielstelle löschen': { tab: 'text', at: 800, op: () => { const t = vT(); const ws = tokens.filter(x => !deleted.has(x.i) && x.s > t + 1); selA = ws[0].i; selB = ws[ws.length - 1].i; showSel(); document.querySelector('#selDel').click(); } },
  'Text: Rückgängig (viele Abschnitte kommen zurück)': { tab: 'text', at: 60, pre: () => { const t = vT(); const ws = tokens.filter(x => x.type === 'word' && !deleted.has(x.i) && x.e > t + 30).slice(0, 300); commit(() => bulkDelete(ws.map(x => x.i)), false); }, op: () => document.querySelector('#undoBtn').click() },
  'Text: Wiederholungen weg': { tab: 'text', at: 60, op: () => document.querySelector('#repeatBtn').click() },
  'Text: Abschnitt verschieben': { tab: 'text', at: 60, op: () => { const t = vT(); const ws = tokens.filter(x => x.type === 'word' && !deleted.has(x.i) && x.s > t + 5); selA = ws[0].i; selB = ws[12].i; showSel(); moveSelection(ws[60].i); } },
  'Studio: teilen': { tab: 'studio', at: 120, op: () => splitHere() },
  'Studio: laufenden Clip löschen': { tab: 'studio', at: 120, op: () => { select({kind:'main', i: curSeg, src: (timeline[curSeg].in + timeline[curSeg].out) / 2}); delSel(); } },
  'Studio: letzten Clip löschen (am Ende)': { tab: 'studio', at: 847, op: () => { const i = timeline.length - 1; select({kind:'main', i, src: (timeline[i].in + timeline[i].out) / 2}); delSel(); } },
  'Studio: bis hier weg (Q)': { tab: 'studio', at: 120, op: () => cutTo('l') },
  'Studio: ab hier weg (W)': { tab: 'studio', at: 120, op: () => cutTo('r') },
  'Studio: Zoom einfügen': { tab: 'studio', at: 120, op: () => { addZoom(); closeSheet(); } },
  'Studio: Tempo 2× für laufenden Clip': { tab: 'studio', at: 120, op: () => { const g = timeline[curSeg]; const it = {id:newId(), type:'fx', at:r3(g.in), dur:r3(g.out - g.in), fx:{...FX_DEF, speed: 2}}; commit(() => P.items.push(it), true); } },
  'Studio: Rückgängig nach Löschen': { tab: 'studio', at: 120, pre: () => { select({kind:'main', i: curSeg + 3, src: (timeline[curSeg + 3].in + timeline[curSeg + 3].out) / 2}); delSel(); }, op: () => document.querySelector('#undoBtn').click() },
  'Untertitel: Modus auf 1 Wort': { tab: 'subs', at: 60, op: () => { S().mode = 'word'; syncStyleInputs(); commit(() => genCues()); } },
  'Studio: Format 9:16 und Rückgängig': { tab: 'studio', at: 120, pre: () => { commit(() => { P.format = '9:16'; P.frame = clampFrame({sc: coverSc(), tx: 0, ty: 0}); }, true); fitStage(); }, op: () => document.querySelector('#undoBtn').click() },
  'Reiterwechsel beim Abspielen': { tab: 'text', at: 60, op: () => { setTab('studio'); setTab('subs'); setTab('export'); setTab('text'); } },
};
const { browser, page, logs } = await launch();
let bad = 0;
for (const [name, sc] of Object.entries(S)) {
  logs.length = 0;
  const nid = await scratch(page, ids[key]);
  await page.evaluate(([t, a]) => { setTab(t); seekOut(a, false); window.__loops = 0; if (!window.__uh){ window.__uh = updateHead; window.updateHead = function (o) { window.__loops++; return window.__uh(o); }; } }, [sc.tab, sc.at]);
  await sleep(700);
  await page.evaluate(() => startPlay());
  try { await page.waitForFunction(() => !V.paused && V.readyState > 2 && !V.seeking, null, { timeout: 15000 }); } catch (_) {}
  await sleep(700);
  if (sc.pre) { await page.evaluate(sc.pre); await sleep(400); }
  const a = await page.evaluate(() => ({ out: outPos, loops: window.__loops, src: vT(), seg: curSeg, n: timeline.length }));
  let err = null; try { await page.evaluate(sc.op); } catch (e) { err = String(e.message).split('\n')[0]; }
  await sleep(2500);
  const b = await page.evaluate(() => ({ out: outPos, loops: window.__loops, src: vT(), seg: curSeg, n: timeline.length, playing, paused: V.paused, total, rs: V.readyState, seeking: V.seeking }));
  const loopAlive = b.loops - a.loops > 30, adv = b.out - a.out;
  const atEnd = b.out >= b.total - 0.3;
  const errs = logs.filter(l => !/404/.test(l));
  // Hat die Wiedergabe angehalten (Ende erreicht), muss sie sich neu starten lassen – sonst wäre die Schleife tot
  let revive = null;
  if (!b.playing){ await page.evaluate(() => { seekOut(Math.min(5, total / 2), false); startPlay(); }); await sleep(2200); revive = await page.evaluate(() => ({ out: outPos, playing, from: Math.min(5, total / 2) })); }
  const ok = !err && !errs.length && (loopAlive || (revive && revive.playing && revive.out - revive.from > 0.5));
  if (!ok || errs.length) bad++;
  console.log((ok ? 'ok   ' : 'FEHLER') + ' ' + name.padEnd(52), (revive ? `[hielt an; Neustart: ${revive.playing ? 'läuft' : 'STEHT'}, +${(revive.out - revive.from).toFixed(1)} s] ` : '') + `Δout ${adv.toFixed(2).padStart(7)} s · Schleife ${String(b.loops - a.loops).padStart(4)} · spielt ${b.playing} · V.paused ${b.paused} · seg ${a.seg}/${a.n}→${b.seg}/${b.n}`, err ? '· ' + err : '', errs.length ? '\n        ' + errs.slice(0, 3).join('\n        ').slice(0, 600) : '');
  await dropScratch(page, nid);
}
console.log(`ERGEBNIS Bearbeiten beim Abspielen (${key}): ${bad} Fehler`);
await browser.close();
process.exit(bad ? 1 : 0);
