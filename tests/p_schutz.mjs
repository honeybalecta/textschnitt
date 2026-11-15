// Neue Schutzfunktionen: Rückgängig für Format/Ausschnitt/Lautstärke, Fenster-Abgleich nur bei Bedarf, sichtbare Speicherfehler.
import { launch, scratch, dropScratch, sleep, BASE, ids as loadIds, OUT, DATA, WORK } from './drv.mjs';
import fs from 'node:fs';
const ids = loadIds();
let bad = 0;
const check = (name, ok, extra = '') => { if (!ok) bad++; console.log((ok ? 'ok    ' : 'FEHLER') + ' ' + name + (extra ? '  · ' + extra : '')); };

const { browser, ctx, page, logs } = await launch();
const reqs = []; page.on('request', r => { const u = r.url(); if (/\/api\//.test(u)) reqs.push({ m: r.method(), u: u.replace(/^.*\/api\//, '') , t: Date.now() }); });

// ── 1. Rückgängig: Format, Bildausschnitt, Lautstärke der Hauptvideos ──
let nid = await scratch(page, ids.multi);
await page.evaluate(() => setTab('studio')); await sleep(300);
let r = await page.evaluate(async () => {
  const out = {};
  const st = () => ({ fm: P.format || null, fr: P.frame ? JSON.stringify(P.frame) : null, sv: P.sources.map(s => s.vol ?? null), stage: document.querySelector('#stage').offsetWidth + 'x' + document.querySelector('#stage').offsetHeight, clipTab: !document.querySelector('.clip-tab').classList.contains('hidden') });
  out.s0 = st();
  // Formatwechsel über den echten Knopf im Leinwand-Dialog bzw. Clip-Reiter
  commit(() => { P.format = '9:16'; P.frame = clampFrame({ sc: coverSc(), tx: 0, ty: 0 }); }, true); fitStage(); renderExportForm();
  await new Promise(r => setTimeout(r, 120)); out.s1 = st();
  commit(() => { P.frame = clampFrame({ sc: coverSc() * 1.4, tx: 0.1, ty: 0 }); }, false); out.s2 = st();
  commit(() => { P.sources.forEach((s, k) => s.vol = 0.5 + k * 0.25); }, false); out.s3 = st();
  document.querySelector('#undoBtn').click(); out.u3 = st();
  document.querySelector('#undoBtn').click(); out.u2 = st();
  document.querySelector('#undoBtn').click(); await new Promise(r => setTimeout(r, 120)); out.u1 = st();
  document.querySelector('#redoBtn').click(); await new Promise(r => setTimeout(r, 120)); out.r1 = st();
  document.querySelector('#redoBtn').click(); out.r2 = st();
  document.querySelector('#redoBtn').click(); out.r3 = st();
  out.exRes = document.querySelector('#exRes').options[0].textContent;
  return out;
});
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check('Rückgängig: Lautstärke der Hauptvideos kommt zurück', eq(r.u3.sv, r.s2.sv) && !eq(r.s3.sv, r.s2.sv), `${JSON.stringify(r.s3.sv)} → ${JSON.stringify(r.u3.sv)}`);
check('Rückgängig: Bildausschnitt kommt zurück', r.u2.fr === r.s1.fr && r.s2.fr !== r.s1.fr, `${r.s2.fr} → ${r.u2.fr}`);
check('Rückgängig: Format kommt zurück (samt Bühne und Clip-Reiter)', eq(r.u1, r.s0), `${r.s1.fm} ${r.s1.stage} → ${r.u1.fm} ${r.u1.stage}`);
check('Wiederholen stellt alle drei Schritte wieder her', eq(r.r1, r.s1) && r.r2.fr === r.s2.fr && eq(r.r3.sv, r.s3.sv), `${r.r1.fm} ${r.r1.stage}` + (eq(r.r1, r.s1) ? '' : ' ' + JSON.stringify(r.r1) + ' statt ' + JSON.stringify(r.s1)));
await dropScratch(page, nid);

// ── 2. Fenster-Abgleich ──
nid = await scratch(page, ids.kurz);
await sleep(1800); reqs.length = 0;
await page.evaluate(() => { setTab('text'); const w = tokens.filter(t => t.type === 'word'); commit(() => bulkDelete([w[3].i, w[4].i]), false); startPlay(); });
await sleep(4000);
await page.evaluate(() => pausePlay());
let posts = reqs.filter(q => q.m === 'POST' && /^bus/.test(q.u)), polls = reqs.filter(q => q.m === 'GET' && /^bus/.test(q.u));
check('ein Fenster: keine Meldungen an den Abgleich', posts.length === 0, `${posts.length} Meldungen, ${polls.length} Abfragen in 4 s (vorher rund 20 Meldungen und 11 Abfragen)`);
check('ein Fenster: seltene Abfrage', polls.length <= 4, `${polls.length} Abfragen`);
// zweites Fenster mit demselben Projekt
await page.evaluate(() => { const w = tokens.filter(t => t.type === 'word'); commit(() => bulkDelete([w[10].i]), false); clearTimeout(saveT); });   // ungespeicherte Änderung in Fenster 1
const before = await page.evaluate(() => ({ del: [...deleted].sort((a, b) => a - b), saved: JSON.parse(TS.loadProject(P.id)).deleted.length }));
const page2 = await ctx.newPage(); const logs2 = []; page2.on('pageerror', e => logs2.push(e.message));
await page2.goto(BASE); await page2.waitForFunction(() => typeof showHome === 'function');
await page2.evaluate(i => openProject(i), nid); await page2.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i, nid);
const at0 = await page2.evaluate(() => deleted.size);
await sleep(2600);
let st2 = await page2.evaluate(() => ({ del: [...deleted].sort((a, b) => a - b), peers: busPeers }));
check('neues Fenster bekommt den aktuellen (noch ungespeicherten) Stand', eq(st2.del, before.del), `beim Öffnen ${at0} gelöscht, danach ${st2.del.length} (Fenster 1: ${before.del.length}, gespeichert waren ${before.saved})`);
check('beide Fenster sehen einander', st2.peers === 1 && await page.evaluate(() => busPeers) === 1);
const pos12 = [await page.evaluate(() => outPos), await page2.evaluate(() => outPos)];
check('neues Fenster übernimmt die Stelle des ersten (das erste springt nicht an den Anfang)', pos12[0] > 3 && Math.abs(pos12[0] - pos12[1]) < 0.1, `Fenster 1 bei ${pos12[0].toFixed(2)} s, Fenster 2 bei ${pos12[1].toFixed(2)} s`);
// Änderung in Fenster 2 → erscheint in Fenster 1
await page2.evaluate(() => { const w = tokens.filter(t => t.type === 'word'); commit(() => bulkDelete([w[20].i, w[21].i]), false); });
await sleep(900);
let d1 = await page.evaluate(() => [...deleted].sort((a, b) => a - b)), d2 = await page2.evaluate(() => [...deleted].sort((a, b) => a - b));
check('Änderung aus Fenster 2 kommt in Fenster 1 an', eq(d1, d2), `${d1.length} gelöschte Wörter in beiden`);
// Im Stand in Fenster 1 einen Satz VOR der Abspiellinie löschen: beide Fenster bleiben auf demselben Bild und an derselben Stelle
await page.evaluate(() => { const w = tokens.filter(t => t.type === 'word' && !deleted.has(t.i) && t.e - t.s > 0.25)[120]; seekOut(srcToOut((w.s + w.e) / 2), false); }); await sleep(1200);
const pa = await Promise.all([page, page2].map(p => p.evaluate(() => ({ out: outPos, src: outToSrcT(outPos) }))));
const cutLen = await page.evaluate(() => { const t = outToSrcT(outPos), ws = tokens.filter(x => x.type === 'word' && !deleted.has(x.i) && x.we < t - 2).slice(-8), before = total; commit(() => bulkDelete(ws.map(x => x.i)), false); return before - total; });
await sleep(1500);
const pb = await Promise.all([page, page2].map(p => p.evaluate(() => ({ out: outPos, src: outToSrcT(outPos) }))));
check('Schnitt vor der Abspiellinie: beide Fenster bleiben auf demselben Bild', Math.abs(pa[0].out - pa[1].out) < 0.05 && Math.abs(pb[0].out - pb[1].out) < 0.05 && Math.abs(pb[0].out - (pa[0].out - cutLen)) < 0.05 && Math.abs(pb[0].src - pa[0].src) < 0.05 && Math.abs(pb[1].src - pa[0].src) < 0.05,
  `${cutLen.toFixed(2)} s entfernt · Fenster 1: ${pa[0].out.toFixed(2)} → ${pb[0].out.toFixed(2)} · Fenster 2: ${pa[1].out.toFixed(2)} → ${pb[1].out.toFixed(2)}`);
// Formatwechsel wird jetzt mit übertragen
await page.evaluate(() => { commit(() => { P.format = '9:16'; P.frame = clampFrame({ sc: coverSc(), tx: 0, ty: 0 }); }, true); fitStage(); });
await sleep(900);
check('Formatwechsel kommt im anderen Fenster an', await page2.evaluate(() => P.format) === '9:16');
// Position
await page.evaluate(() => seekOut(42, false)); await sleep(900);
const p2 = await page2.evaluate(() => outPos);
check('Abspielposition wird übertragen', Math.abs(p2 - 42) < 0.1, p2.toFixed(2));
// Viele Änderungen hintereinander, während Fenster 2 „schläft“ (keine Abfragen): danach stimmt der Stand trotzdem
await page2.evaluate(() => { const f = window.fetch; window.__hold = true;   // Fenster 2 „schläft“: seine Abfragen bleiben liegen (wie bei gedrosselten Zeitgebern)
  window.fetch = async (u, o) => { if (/api\/bus\?/.test(String(u)) && !(o && o.method === 'POST')) while (window.__hold) await new Promise(r => setTimeout(r, 100)); return f(u, o); }; });
await sleep(500);
await page.evaluate(async () => { const w = tokens.filter(t => t.type === 'word' && !deleted.has(t.i)); for (let k = 0; k < 12; k++){ commit(() => bulkDelete([w[30 + k].i]), false); await new Promise(r => setTimeout(r, 160)); } startPlay(); });
await sleep(14000);   // 14 s Wiedergabe: früher verdrängten die Positionsmeldungen den letzten Stand
await page.evaluate(() => pausePlay());
await page2.evaluate(() => { window.__hold = false; });   // Fenster 2 „wacht auf“ und fragt mit seinem alten Zähler weiter
await sleep(1500);
d1 = await page.evaluate(() => [...deleted].sort((a, b) => a - b)); d2 = await page2.evaluate(() => [...deleted].sort((a, b) => a - b));
check('Fenster, das eine Weile nicht nachgefragt hat, bekommt den letzten Stand', eq(d1, d2), `Fenster 1: ${d1.length}, Fenster 2: ${d2.length}`);
// Fenster 2 lädt die Seite neu (neue Kennung, alte abgemeldet) – während Fenster 1 eine ungespeicherte Änderung hat
await page.evaluate(() => { const w = tokens.filter(t => t.type === 'word' && !deleted.has(t.i)); commit(() => bulkDelete([w[45].i]), false); clearTimeout(saveT); });
await page2.reload(); await page2.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i, nid);   // das zuletzt offene Projekt öffnet sich von selbst wieder
await sleep(2600);
d1 = await page.evaluate(() => [...deleted].sort((a, b) => a - b)); d2 = await page2.evaluate(() => [...deleted].sort((a, b) => a - b));
check('neu geladenes Fenster bekommt ebenfalls den aktuellen Stand', eq(d1, d2), `Fenster 1: ${d1.length}, Fenster 2: ${d2.length}`);
// Fenster 2 schließen → Fenster 1 hört auf zu melden
await page2.close(); await sleep(2200); reqs.length = 0;
await page.evaluate(() => { const w = tokens.filter(t => t.type === 'word' && !deleted.has(t.i)); commit(() => bulkDelete([w[50].i]), false); startPlay(); }); await sleep(3000); await page.evaluate(() => pausePlay());
posts = reqs.filter(q => q.m === 'POST' && /^bus/.test(q.u));
check('nach dem Schließen des zweiten Fensters: wieder Ruhe', posts.length === 0 && await page.evaluate(() => busPeers) === 0, `${posts.length} Meldungen, andere Fenster: ${await page.evaluate(() => busPeers)}`);
check('keine Fehler in Fenster 2', logs2.length === 0, logs2.join(' | '));

// ── 3. Speichern schlägt fehl ──
let fail = true;
await page.route('**/api/project?id=*', route => { if (fail && route.request().method() === 'POST') return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Der Datenträger ist voll.' }) }); return route.continue(); });
await page.evaluate(() => { const w = tokens.filter(t => t.type === 'word' && !deleted.has(t.i)); commit(() => bulkDelete([w[60].i]), false); });
await sleep(1200);
let sv = await page.evaluate(() => ({ txt: document.querySelector('#saved').textContent, err: document.querySelector('#saved').classList.contains('err'), title: document.querySelector('#saved').title, toast: document.querySelector('#toast').textContent, on: document.querySelector('#toast').classList.contains('on') }));
check('Speicherfehler wird deutlich angezeigt', sv.err && sv.txt === '!' && /Datenträger/.test(sv.toast) && sv.on, `Hinweis: „${sv.toast}“ · Anzeige: ${sv.title}`);
await page.screenshot({ path: OUT + '/speicherfehler.png', clip: { x: 0, y: 0, width: 1480, height: 160 } });
// Schließen bei fehlgeschlagenem Speichern: Rückfrage; „Abbrechen“ lässt das Projekt offen
page.removeAllListeners('dialog'); let asked = '';
page.once('dialog', d => { asked = d.message(); d.dismiss(); });
await page.evaluate(() => closeProject()); await sleep(300);
check('Schließen ohne gespeicherten Stand fragt nach und bleibt bei „Abbrechen“ im Projekt', /nicht speichern/.test(asked) && await page.evaluate(() => !!P), asked.split('\n')[0]);
page.on('dialog', d => d.accept().catch(() => {}));
fail = false; await sleep(3600);
sv = await page.evaluate(() => ({ txt: document.querySelector('#saved').textContent, err: document.querySelector('#saved').classList.contains('err'), toast: document.querySelector('#toast').textContent }));
const onDisk = await page.evaluate(() => JSON.parse(TS.loadProject(P.id)).deleted.length === deleted.size);
check('sobald es wieder geht, wird von selbst gespeichert', !sv.err && sv.txt === '✓' && onDisk, `Hinweis: „${sv.toast}“`);
await page.unroute('**/api/project?id=*');
await dropScratch(page, nid);
const errs = logs.filter(l => !/404|Speichern fehlgeschlagen|400 \(Bad Request\)|HTTP 400: api\/project/.test(l));
check('keine unerwarteten Fehler in der Seite', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`ERGEBNIS Rückgängig, Fenster, Speicherfehler: ${bad} Fehler`);
await browser.close();
process.exit(bad ? 1 : 0);
