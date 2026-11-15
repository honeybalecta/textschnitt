// Bearbeiten im Stand: Die Abspiellinie bleibt auf demselben Bild; Bild, Abschnitt und Zeitanzeige passen danach zusammen.
import { launch, scratch, dropScratch, sleep, ids as loadIds, OUT, DATA, WORK } from './drv.mjs';
import fs from 'node:fs';
const ids = loadIds();
const key = process.argv[2] || 'stress';
const { browser, page, logs } = await launch();
let bad = 0;
// Zustand der Abspiellinie samt Prüfung, ob alles zusammenpasst
const probe = () => page.evaluate(() => {
  const g = timeline[curSeg], k = segAtOut(outPos), want = g ? g.in + (outPos - g.o) * (g.speed || 1) : 0;
  return { out: +outPos.toFixed(3), seg: curSeg, segOk: curSeg === k || !timeline.length, main: g && g.kind === 'main', src: +vT().toFixed(3), want: +want.toFixed(3),
    frameOk: !g || g.kind !== 'main' || (vSi === g.si && Math.abs(vT() - want) < 0.05), empty: !timeline.length, headOk: document.querySelector('#tNow').textContent === fmtT(outPos), total: +total.toFixed(3), n: timeline.length, seeks: window.__seeks };
});
async function scen(name, tab, at, op, expect){
  const nid = await scratch(page, ids[key]);
  // Stelle: mitten in einem Wort eines Hauptspur-Clips in der Nähe von „at“ (nicht auf einem Einschub, nicht an einer Kante)
  await page.evaluate(([t, a]) => { setTab(t);
    if (a > 0 && a < 1e8){ const w = tokens.find(x => x.type === 'word' && !deleted.has(x.i) && x.e - x.s > 0.25 && srcToOut(snapSrc(x.s)) > a && timeline[segAtOut(srcToOut((x.s + x.e) / 2))].kind === 'main' && Math.abs(snapSrc((x.s + x.e) / 2) - (x.s + x.e) / 2) < 1e-6
        && (() => { const g = timeline[segAtOut(srcToOut((x.s + x.e) / 2))]; return (x.s + x.e) / 2 - g.in > 0.3 && g.out - (x.s + x.e) / 2 > 0.3; })());
      a = srcToOut((w.s + w.e) / 2); }
    seekOut(a, false); if (!window.__sk){ window.__sk = true; window.__seeks = 0; V.addEventListener('seeking', () => window.__seeks++); } }, [tab, at]);
  await sleep(900);
  await page.evaluate(() => { window.__seeks = 0; });
  const a = await probe();
  let err = null, info = null; try { info = await page.evaluate(op); } catch (e) { err = String(e.message).split('\n')[0]; }
  await sleep(900);
  const b = await probe();
  const exp = expect(a, b, info || {});
  const ok = !err && b.segOk && b.frameOk && b.headOk && exp.ok;
  if (!ok) bad++;
  console.log((ok ? 'ok    ' : 'FEHLER') + ' ' + name.padEnd(58), `Stelle ${a.out} → ${b.out} · Bild ${a.src} → ${b.src} · ${b.seeks} Sprünge · ${exp.txt}`, err ? '· ' + err : '', b.segOk ? '' : '· Abschnitt passt nicht', b.frameOk ? '' : `· Bild passt nicht (soll ${b.want})`, b.headOk ? '' : '· Zeitanzeige passt nicht');
  await dropScratch(page, nid);
}
const near = (x, y, tol = 0.03) => Math.abs(x - y) <= tol;

await scen('Text: Satz vor der Abspiellinie löschen', 'text', 40, () => { const t = outToSrcT(outPos); const ws = tokens.filter(x => x.type === 'word' && !deleted.has(x.i) && x.we < t - 2).slice(-8); const before = total; selA = ws[0].i; selB = ws[7].i; showSel(); document.querySelector('#selDel').click(); return { removed: before - total }; },
  (a, b, i) => ({ ok: near(b.out, a.out - i.removed) && near(b.src, a.src) && b.seeks === 0, txt: `${i.removed.toFixed(2)} s davor entfernt → Linie rückt um genau so viel, Bild bleibt` }));
await scen('Text: Wort unter der Abspiellinie löschen', 'text', 40, () => { const t = outToSrcT(outPos); const w = tokens.find(x => x.type === 'word' && !deleted.has(x.i) && x.s <= t && x.e > t); selA = selB = w.i; showSel(); document.querySelector('#selDel').click(); return { next: srcToOut(snapSrc(t)) }; },
  (a, b, i) => ({ ok: near(b.out, i.next) && b.src > a.src, txt: 'Stelle fiel weg → weiter an der nächsten behaltenen' }));
await scen('Text: Satz hinter der Abspiellinie löschen', 'text', 40, () => { const t = outToSrcT(outPos); const ws = tokens.filter(x => x.type === 'word' && !deleted.has(x.i) && x.s > t + 3).slice(0, 8); selA = ws[0].i; selB = ws[7].i; showSel(); document.querySelector('#selDel').click(); return {}; },
  (a, b) => ({ ok: b.out === a.out && near(b.src, a.src) && b.seeks === 0, txt: 'nichts verschiebt sich' }));
await scen('Text: Rückgängig bringt Gelöschtes vor der Linie zurück', 'text', 40, async () => { const t = outToSrcT(outPos); const ws = tokens.filter(x => x.type === 'word' && !deleted.has(x.i) && x.we < t - 2).slice(-8); const before = total; commit(() => bulkDelete(ws.map(x => x.i)), false); const removed = before - total; await new Promise(r => setTimeout(r, 300)); const mid = outPos; document.querySelector('#undoBtn').click(); return { removed, mid }; },
  (a, b, i) => ({ ok: near(i.mid, a.out - i.removed) && near(b.out, a.out) && near(b.src, a.src), txt: `Linie ${a.out} → ${i.mid.toFixed(3)} → ${b.out}` }));
await scen('Text: Untertitel-Stil ändern (kein Schnitt)', 'text', 40, () => { commit(() => { S().color = '#FFE600'; }, false); return {}; },
  (a, b) => ({ ok: b.out === a.out && b.seeks === 0, txt: 'unverändert, kein Sprung' }));
await scen('Studio: Clip unter der Abspiellinie löschen', 'studio', 40, () => { const i = curSeg, nx = timeline[i + 1]; select({ kind: 'main', i, src: (timeline[i].in + timeline[i].out) / 2 }); const o = timeline[i].o; delSel(); return { o, nextIn: nx ? nx.in : null }; },
  (a, b, i) => i.nextIn == null ? { ok: b.out === 0 || near(b.out, b.total - 0.01, 0.02), txt: 'es war der letzte bzw. einzige Clip' } : ({ ok: near(b.out, i.o) && near(b.src, i.nextIn, 0.06), txt: 'weiter am Anfang des folgenden Clips' }));
await scen('Studio: Clip vor der Abspiellinie löschen', 'studio', 40, () => { let i = curSeg - 2; while (i >= 0 && timeline[i].kind !== 'main') i--; if (i < 0) return { skip: true }; const before = total; select({ kind: 'main', i, src: (timeline[i].in + timeline[i].out) / 2 }); delSel(); return { d: before - total }; },
  (a, b, i) => i.skip ? { ok: true, txt: 'entfällt (kein Clip davor)' } : ({ ok: near(b.out, a.out - i.d) && near(b.src, a.src) && b.seeks === 0, txt: `Clip von ${i.d.toFixed(2)} s davor entfernt → Bild bleibt` }));
await scen('Studio: Tempo 2× für den Clip unter der Linie', 'studio', 40, () => { const g = timeline[curSeg], into = outPos - g.o; const it = { id: newId(), type: 'fx', at: r3(g.in), dur: r3(g.out - g.in), fx: { ...FX_DEF, speed: 2 } }; commit(() => P.items.push(it), true); return { into }; },
  (a, b, i) => ({ ok: near(b.out, a.out - i.into / 2, 0.05) && near(b.src, a.src), txt: 'Bild bleibt, Zeit im Clip halbiert' }));
await scen('Studio: Clip mit der Abspiellinie nach hinten verschieben', 'studio', 40, () => { const i = curSeg, g = timeline[i], into = outPos - g.o; if (timeline.length < i + 5) return { skip: true }; const s = { kind: 'main', i, src: (g.in + g.out) / 2 }; select(s); TL.drag = { ptr: timeline[i + 4].o + 0.05 }; let moved = false; commit(() => { moved = reorderDrop(s, segDur(timeline[i + 1]) + segDur(timeline[i + 2]) + segDur(timeline[i + 3]) + 0.3); }, true); TL.drag = null; return { moved, into }; },
  (a, b, i) => i.skip ? { ok: true, txt: 'entfällt (zu wenige Clips)' } : ({ ok: i.moved && near(b.src, a.src) && b.out !== a.out, txt: i.moved ? 'Linie wandert mit dem Clip' : 'Clip wurde nicht verschoben' }));
await scen('Studio: teilen an der Abspiellinie', 'studio', 40, () => { splitHere(); return {}; },
  (a, b) => ({ ok: b.out === a.out && b.n === a.n + 1 && b.seeks === 0, txt: 'unverändert' }));
await scen('Am Anfang: die ersten Wörter löschen', 'text', 0, () => { const ws = tokens.filter(x => x.type === 'word' && !deleted.has(x.i)).slice(0, 5); selA = ws[0].i; selB = ws[4].i; showSel(); document.querySelector('#selDel').click(); return { first: timeline[0].in }; },
  (a, b, i) => ({ ok: b.out === 0 && near(b.src, i.first, 0.06), txt: 'Linie bleibt am Anfang, Bild zeigt den neuen Anfang' }));
await scen('Am Ende: etwas weiter vorn löschen', 'text', 1e9, () => { const ws = tokens.filter(x => x.type === 'word' && !deleted.has(x.i)).slice(20, 30); const before = total; selA = ws[0].i; selB = ws[9].i; showSel(); document.querySelector('#selDel').click(); return { removed: before - total }; },
  (a, b, i) => ({ ok: near(b.out, b.total - 0.01, 0.02) && near(b.src, a.src), txt: 'Linie bleibt am Ende' }));
const errs = logs.filter(l => !/404/.test(l));
if (errs.length){ bad++; console.log('Fehler in der Seite:', errs.slice(0, 4).join(' | ')); }
console.log(`ERGEBNIS Bearbeiten im Stand (${key}): ${bad} Fehler`);
await browser.close();
process.exit(bad ? 1 : 0);
