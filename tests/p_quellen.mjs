// Quellen und Belege (2.28): Quellen zu Aussagen (Zeile im Bild, Quellenliste), „Beleg nötig“ mit Hinweis vor dem Export,
// Bauchbinden (von selbst beim ersten Auftritt, von Hand), Prüfung auf Barrierefreiheit und Textfassung – samt echten Exporten.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, scratch, dropScratch, setPick, sleep, ids as loadIds, pruefung, OUT } from './drv.mjs';
const PJ = loadIds();
const { chk, ende } = pruefung('Quellen und Belege');
const { browser, ctx, page, logs } = await launch();
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
const ev = (f, a) => page.evaluate(f, a);
const toast = () => ev(() => document.querySelector('#toast').textContent);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const shot = name => page.screenshot({ path: path.join(OUT, `quellen-${name}.png`) });
const drop = async id => { await ev(() => { if (typeof P !== 'undefined' && P){ pausePlay(); clearTimeout(saveT); } }); await dropScratch(page, id); };
const undo = async () => { await page.click('#undoBtn'); await sleep(250); };
// Lage eines Elements auf der Bühne als Anteile (links, oben, rechts, unten, Breite, Höhe); null, wenn es fehlt oder ausgeblendet ist
const onStage = sel => ev(sel => { const e = document.querySelector(sel); if (!e || e.classList.contains('hidden')) return null; const r = e.getBoundingClientRect(), s = document.querySelector('#stage').getBoundingClientRect();
  return { l: (r.left - s.left) / s.width, t: (r.top - s.top) / s.height, r: (s.right - r.right) / s.width, b: (s.bottom - r.bottom) / s.height, w: r.width / s.width, h: r.height / s.height, text: e.textContent }; }, sel);
const seek = async o => { await ev(o => { pausePlay(); seekOut(o, false); }, o); await sleep(350); };
// Sätze des Texts: erstes und letztes Wort, Zeiten im geschnittenen Video und in der Quelle
const sentences = () => ev(() => { const out = [], word = i => isTextTok(i) && !!tokText(tokens[i]);
  for (let k = 0; k < order.length; k++){ if (!word(order[k])) continue; const [a, b] = sentBounds(k, k), ids = order.slice(a, b + 1).filter(i => word(i) && !isCut(i)); k = Math.max(k, b);
    if (ids.length >= 4) out.push({ a: ids[0], b: ids[ids.length - 1], ids, s: +srcToOut(wS(tokens[ids[0]])).toFixed(3), e: +srcToOut(wE(tokens[ids[ids.length - 1]])).toFixed(3), at: r3(wS(tokens[ids[0]])), end: r3(wE(tokens[ids[ids.length - 1]])), text: ids.map(i => tokText(tokens[i])).join(' ') }); }
  return out; });
const pick = (a, b) => ev(([a, b]) => { selA = a; selB = b; showSel(); }, [a, b]);
const fillRef = async v => { for (const [id, val] of Object.entries(v)) if (typeof val === 'boolean'){ if ((await ev(id => document.querySelector('#' + id).checked, id)) !== val) await page.click('#' + id); } else await page.fill('#' + id, val); };
const refs = () => ev(() => JSON.parse(JSON.stringify(P.refs || [])));
// Dialog abwarten, bis sein erstes Feld den Fokus hat (er wird kurz nach dem Öffnen gesetzt; früheres Ausfüllen landete sonst im falschen Feld)
const dlg = async sel => { await page.waitForSelector(sel); await page.waitForFunction(s => document.activeElement === document.querySelector(s), sel, { timeout: 5000 }); };
const cues = () => ev(() => refCues().map(c => ({ s: +c.s.toFixed(3), e: +c.e.toFixed(3), text: c.text })));

// ═════════ B1 · Quellen zu Aussagen ═════════
const sid = await scratch(page, PJ.lang);
await ev(() => setTab('text')); await sleep(400);
const S = await sentences();
chk('Ausgangslage: Text mit genug Sätzen, noch keine Quellen', S.length > 12 && (await refs()).length === 0 && (await ev(() => document.querySelector('#refsBtn').textContent)) === 'Quellen', S.length);
const s1 = S[2], s2 = S[5], s3 = S[8];
await pick(s1.a, s1.b); await page.click('#selRef'); await dlg('#rfMedium');
const d0 = await ev(() => ({ q: document.querySelector('.ref-q').textContent, ok: document.querySelector('#rfOk').textContent, at: document.querySelector('#rfAt').textContent, show: document.querySelector('#rfShow').checked, textRow: document.querySelector('#rfTextRow').classList.contains('hidden'), del: !!document.querySelector('#rfDel') }));
chk('Dialog „Quelle“ zeigt die markierte Aussage; ohne Angaben würde die Stelle als „Beleg nötig“ markiert', d0.q === `„${s1.text}“` && d0.ok === 'Als „Beleg nötig“ markieren' && /Ohne Angaben bleibt sie als „Beleg nötig“ offen/.test(d0.at) && d0.show && d0.textRow && !d0.del, d0);
await fillRef({ rfMedium: 'Statistisches Bundesamt', rfDate: '12.03.2025', rfTitle: 'Mieten in Großstädten 2024', rfUrl: 'https://www.destatis.de/mieten' });
const d1 = await ev(() => ({ ok: document.querySelector('#rfOk').textContent, at: document.querySelector('#rfAt').textContent, ph: document.querySelector('#rfText').placeholder, textRow: document.querySelector('#rfTextRow').classList.contains('hidden'), doneRow: document.querySelector('#rfDoneRow').classList.contains('hidden') }));
chk('mit Angaben: „Speichern“, Vorschlag für den Text im Bild aus Medium und Datum, Dauer der Zeile', d1.ok === 'Speichern' && d1.ph === 'Statistisches Bundesamt, 12.03.2025' && !d1.textRow && d1.doneRow && /Die Zeile steht \d+,\d s im Bild\./.test(d1.at), d1);
await shot('dialog');
await page.click('#rfOk'); await sleep(350);
let R = await refs();
chk('Quelle hinterlegt: Stelle vom ersten bis zum letzten Wort der Markierung (Quellzeit), alle Angaben', R.length === 1 && near(R[0].at, s1.at, 0.002) && near(R[0].end, s1.end, 0.002) && R[0].medium === 'Statistisches Bundesamt' && R[0].title === 'Mieten in Großstädten 2024' && R[0].date === '12.03.2025' && R[0].url === 'https://www.destatis.de/mieten' && !('show' in R[0]) && !('done' in R[0]) && (await toast()) === 'Quelle hinterlegt', R);
const mark1 = await ev(ids => ({ rf: ids.every(i => spans[i].classList.contains('rf') && !spans[i].classList.contains('need')), all: document.querySelectorAll('#transcript .tk.rf').length, pins: [...document.querySelectorAll('#transcript .ref-pin')].map(p => [p.className, p.title, p.nextElementSibling === spans[+p.nextElementSibling.dataset.i] ? +p.nextElementSibling.dataset.i : -1]), btn: document.querySelector('#refsBtn').textContent }), s1.ids);
chk('im Text: die Stelle ist unterstrichen, vor dem ersten Wort hängt ein Zettel mit der Quelle', mark1.rf && mark1.all === s1.ids.length && mark1.pins.length === 1 && mark1.pins[0][0] === 'ref-pin' && mark1.pins[0][1] === 'Quelle: Statistisches Bundesamt: Mieten in Großstädten 2024 (12.03.2025) – https://www.destatis.de/mieten' && mark1.pins[0][2] === s1.a && mark1.btn === 'Quellen (1)', mark1);
let C = await cues();
chk('Zeile im Bild: für die Dauer des Satzes, mindestens 2,5 s, „Quelle: Medium, Datum“', C.length === 1 && near(C[0].s, s1.s, 0.002) && near(C[0].e, Math.max(s1.e, s1.s + 2.5), 0.002) && C[0].text === 'Quelle: Statistisches Bundesamt, 12.03.2025', [C, s1.s, s1.e]);
await seek(s1.s + 0.4); let L = await onStage('#srcLine');
chk('Vorschau: die Zeile steht oben links, klein, einzeilig', L && L.text === C[0].text && near(L.l, 0.035 * 360 / 640, 0.004) && near(L.t, 0.035, 0.004) && L.h < 0.05 && L.w < 0.6, L);
await shot('zeile');
await seek(C[0].e + 0.3); chk('nach dem Satz verschwindet die Zeile', (await onStage('#srcLine')) === null);
await seek(Math.max(0, s1.s - 0.3)); chk('vor dem Satz steht sie noch nicht', (await onStage('#srcLine')) === null);
await undo(); chk('Rückgängig nimmt die Quelle weg (Text, Bild, Zähler)', (await refs()).length === 0 && (await ev(() => document.querySelectorAll('#transcript .tk.rf, #transcript .ref-pin').length)) === 0 && (await cues()).length === 0 && (await ev(() => document.querySelector('#refsBtn').textContent)) === 'Quellen');
await page.click('#redoBtn'); await sleep(250); chk('Wiederholen bringt sie zurück', (await refs()).length === 1 && (await ev(() => document.querySelectorAll('#transcript .ref-pin').length)) === 1 && (await cues()).length === 1);
// bearbeiten über den Zettel: eigener Text im Bild
await page.click('#transcript .ref-pin'); await dlg('#rfMedium');
const d2 = await ev(() => [document.querySelector('#rfMedium').value, document.querySelector('#rfDate').value, document.querySelector('#rfTitle').value, document.querySelector('#rfUrl').value, !!document.querySelector('#rfDel')]);
chk('Klick auf den Zettel öffnet die Quelle zum Bearbeiten', JSON.stringify(d2) === JSON.stringify(['Statistisches Bundesamt', '12.03.2025', 'Mieten in Großstädten 2024', 'https://www.destatis.de/mieten', true]), d2);
await page.fill('#rfText', 'Destatis 2025'); await page.click('#rfOk'); await sleep(300);
chk('eigener Text ersetzt den Vorschlag in der Zeile', (await cues())[0].text === 'Quelle: Destatis 2025' && (await refs())[0].text === 'Destatis 2025');
const nUndo = await ev(() => undo.length);
await page.click('#transcript .ref-pin'); await dlg('#rfMedium'); await page.click('#rfOk'); await sleep(250);
chk('Speichern ohne Änderung legt keinen Rückgängig-Schritt an', (await ev(() => undo.length)) === nUndo);
await page.click('#transcript .ref-pin'); await dlg('#rfMedium'); await fillRef({ rfText: '', rfShow: false }); await page.click('#rfOk'); await sleep(300);
chk('„im Bild zeigen“ aus: keine Zeile, die Quelle bleibt in der Liste', (await cues()).length === 0 && (await refs())[0].show === false && (await ev(() => refList().rows.length)) === 1);
await undo(); chk('… und zurück', (await cues()).length === 1);
// zweite Quelle im selben Satz: eine gemeinsame Zeile
await pick(s1.ids[1], s1.ids[2]); await page.keyboard.press('r'); await dlg('#rfMedium');
await fillRef({ rfMedium: 'taz', rfDate: '2024' }); await page.click('#rfOk'); await sleep(300);
C = await cues(); R = await refs();
chk('Taste R öffnet den Dialog; zwei Quellen im selben Satz teilen sich eine Zeile („Quellen: … · …“)', R.length === 2 && C.length === 1 && C[0].text === 'Quellen: Destatis 2025 · taz, 2024' && near(C[0].s, s1.s, 0.002), C);
// dieselbe Quelle an anderer Stelle: eine Nummer; nur ein Link: Adresse der Seite als Name
await pick(s2.a, s2.b); await page.click('#selRef'); await dlg('#rfMedium');
await fillRef({ rfMedium: 'Statistisches Bundesamt', rfDate: '12.03.2025', rfTitle: 'Mieten in Großstädten 2024', rfUrl: 'https://www.destatis.de/mieten' }); await page.click('#rfOk'); await sleep(300);
await pick(s3.a, s3.b); await page.click('#selRef'); await dlg('#rfMedium');
await fillRef({ rfUrl: 'www.mieterbund.de/studie.pdf' }); const ph3 = await ev(() => document.querySelector('#rfText').placeholder); await page.click('#rfOk'); await sleep(300);
const list1 = await ev(() => ({ text: refListText(), nums: P.refs.map(r => refList().byId.get(r.id)) }));
chk('Quellenliste: in der Reihenfolge des Videos nummeriert, gleiche Angaben nur einmal', list1.text === 'Quellen:\n[1] Statistisches Bundesamt: Mieten in Großstädten 2024 (12.03.2025) – https://www.destatis.de/mieten\n[2] taz (2024)\n[3] www.mieterbund.de/studie.pdf' && JSON.stringify(list1.nums) === '[1,2,1,3]', list1);
C = await cues();
chk('nur ein Link: Die Zeile nennt die Adresse der Seite', ph3 === 'mieterbund.de' && C.length === 3 && C[2].text === 'Quelle: mieterbund.de' && near(C[1].s, s2.s, 0.002) && near(C[2].s, s3.s, 0.002), [ph3, C]);
// dieselbe Stelle noch einmal: der vorhandene Eintrag öffnet sich
await pick(s3.a, s3.b); await page.click('#selRef'); await dlg('#rfMedium');
chk('dieselbe Stelle noch einmal gewählt: der vorhandene Eintrag wird bearbeitet', (await ev(() => document.querySelector('#rfUrl').value)) === 'www.mieterbund.de/studie.pdf' && (await ev(() => !!document.querySelector('#rfDel'))));
await page.click('#rfNo'); await sleep(150); chk('Abbrechen ändert nichts', (await refs()).length === 4);
// Schnitt: Zeile und Liste folgen
await ev(ids => { commit(() => ids.forEach(i => deleted.add(i)), false); tokens.forEach(t => paint(t.i)); }, s2.ids.slice(0, 2)); await sleep(300);
const part = await ev(ids => ({ c: refCues().map(c => +c.s.toFixed(3)), want: +srcToOut(wS(tokens[ids[2]])).toFixed(3) }), s2.ids);
chk('Anfang des Satzes weggeschnitten: Die Zeile beginnt mit dem ersten Wort, das bleibt', part.c.length === 3 && near(part.c[1], part.want, 0.002), part);
await ev(ids => { commit(() => ids.forEach(i => deleted.add(i)), false); tokens.forEach(t => paint(t.i)); }, s2.ids); await sleep(300);
const gone = await ev(() => ({ c: refCues().length, list: refListText(), gone: P.refs.map(refGone) }));
chk('ganze Stelle weggeschnitten: keine Zeile; die Quelle bleibt in der Liste, solange sie an anderer Stelle vorkommt', gone.c === 2 && /^Quellen:\n\[1\] Statistisches Bundesamt.*\n\[2\] taz \(2024\)\n\[3\] www\.mieterbund/.test(gone.list) && JSON.stringify(gone.gone) === '[false,false,true,false]', gone);
await undo(); await undo();
// Blatt „Quellen und Belege“
await ev(() => clearSel()); await page.click('#refsBtn'); await page.waitForSelector('#rfSheet .mk-row');
const sheet1 = await ev(() => ({ rows: [...document.querySelectorAll('#rfSheet .mk-row')].map(r => [r.querySelector('.mono').textContent, (r.querySelector('.mk-t b') || {}).textContent, r.querySelector('.mk-t i').textContent]), h: [...document.querySelectorAll('#rfSheet h4')].map(h => h.textContent), copy: !!document.querySelector('#rfSheet [data-a=copy]') }));
chk('Blatt: alle Quellen mit Zeit, Nummer, Name und dem Anfang der Aussage', sheet1.rows.length === 4 && sheet1.rows[0][1] === '[1] Destatis 2025' && sheet1.rows[1][1] === '[2] taz, 2024' && sheet1.rows[2][1] === '[1] Statistisches Bundesamt, 12.03.2025' && sheet1.rows[3][1] === '[3] mieterbund.de' && s3.text.startsWith(sheet1.rows[3][2].replace(' …', '')) && JSON.stringify(sheet1.h) === '["Beleg nötig","Quellen · 4"]' && sheet1.copy, sheet1);
await page.click('#rfSheet .mk-row:nth-of-type(4) .mk-go', { force: true }).catch(() => {});
await ev(() => [...document.querySelectorAll('#rfSheet .mk-row')][3].querySelector('.mk-go').click()); await sleep(350);
chk('Klick auf eine Zeile springt zur Stelle', near(await ev(() => outPos), s3.s, 0.03), await ev(() => outPos));
await page.click('#rfSheet [data-a=copy]'); await sleep(300);
chk('„Quellenliste kopieren“ legt die Liste in die Zwischenablage', (await ev(() => navigator.clipboard.readText())) === list1.text && (await toast()) === 'Quellenliste in der Zwischenablage');
// Stil der Zeile
await ev(() => { document.querySelector('#rfStyle').open = true; }); await sleep(150);
const st0 = await ev(() => ({ on: document.querySelector('#rsOn').checked, pre: document.querySelector('#rsPre').value, pos: document.querySelector('#rsPos button.on').dataset.p, size: document.querySelector('#rsSizeV').textContent, n: undo.length }));
chk('Stil der Zeile: Vorgabe oben links, „Quelle:“ davor, 2,4 % der kürzeren Bildseite', st0.on && st0.pre === 'Quelle:' && st0.pos === 'ol' && st0.size === '2,4 %', st0);
await shot('blatt');
await page.click('#rsPos [data-p=ur]'); await page.fill('#rsPre', ''); await page.click('#rsBg'); await sleep(200);
await seek(s3.s + 0.4); L = await onStage('#srcLine');
const st1 = await ev(() => ({ st: P.srcStyle, n: undo.length, bg: document.querySelector('#srcLine').classList.contains('bg') }));
chk('Lage, Kasten und das Wort davor lassen sich ändern; die Vorschau folgt', L && L.text === 'mieterbund.de' && L.r < 0.04 && L.b < 0.06 && st1.bg && st1.st.pos === 'ur' && st1.st.pre === '' && st1.st.bg === true, [L, st1]);
chk('die Änderungen am Stil sind zusammen ein Rückgängig-Schritt', st1.n === st0.n + 1, [st0.n, st1.n]);
await undo(); L = await onStage('#srcLine');
chk('Rückgängig stellt den Stil wieder her', L && L.text === 'Quelle: mieterbund.de' && near(L.t, 0.035, 0.004) && (await ev(() => !P.srcStyle)) && (await ev(() => document.querySelector('#rsPos button.on').dataset.p)) === 'ol', L);
await page.click('#rsOn'); await sleep(200);
chk('„Quellen im Bild zeigen“ aus: keine Zeilen, die Liste bleibt', (await cues()).length === 0 && (await onStage('#srcLine')) === null && (await ev(() => refList().rows.length)) === 3);
await undo();
// Textzeile in derselben Ecke: die Quellenzeile rückt darunter
await ev(() => { commit(() => { P.textline = { ...TLINE_DEF, text: '@kanal · V. i. S. d. P.: Vorname Nachname', pos: 'ol' }; }, false); }); await seek(s3.s + 0.4);
const stack = { tl: await onStage('#tline'), src: await onStage('#srcLine') };
chk('steht die dauerhafte Textzeile in derselben Ecke, rückt die Quellenzeile darunter', stack.tl && stack.src && stack.src.t > stack.tl.t + stack.tl.h && stack.src.t < stack.tl.t + stack.tl.h + 0.03 && near(stack.src.l, stack.tl.l, 0.004), stack);
// Exportplan
const plan1 = await ev(() => { const p = buildPlan(), q = p.subs.cues.filter(c => c.src), tl = p.subs.cues.filter(c => c.line && !c.src); return { q, tl: tl.length, sum: (exFmt = 'video', renderExport(), document.querySelector('#exSummary').textContent), spoken: p.subs.cues.filter(c => !c.title).length }; });
chk('Exportplan: jede Zeile als Titel mit Kennzeichen, Ecke und Zeit; die Textzeile bleibt daneben', plan1.q.length === 3 && plan1.tl === 1 && plan1.q.every(c => c.title && c.line && c.src && c.anchor === 'ol' && c.outline === true && near(c.size, 0.024, 1e-6)) && near(plan1.q[2].start, s3.s, 0.002) && plan1.q[2].text === 'Quelle: mieterbund.de' && plan1.q[0].my > 0.06 && / · 3 Quellenzeilen/.test(plan1.sum), [plan1.q[2], plan1.sum]);
await undo();
await ev(() => closeSheet());
// Export-Reiter: Quellenliste
await ev(() => setTab('export')); await sleep(400);
const ex1 = await ev(() => ({ text: document.querySelector('#refText').textContent, hidden: document.querySelector('#refText').classList.contains('hidden'), warn: document.querySelector('#exRefs').classList.contains('hidden'), copy: !document.querySelector('#refCopy').classList.contains('hidden') }));
chk('Export-Reiter: die Quellenliste steht zum Kopieren bereit, kein Hinweis auf offene Belege', ex1.text === list1.text && !ex1.hidden && ex1.warn && ex1.copy, ex1);
await ev(() => navigator.clipboard.writeText('')); await page.click('#refCopy'); await sleep(300);
chk('„Quellenliste kopieren“ im Export-Reiter', (await ev(() => navigator.clipboard.readText())) === list1.text && /In der Zwischenablage/.test(await ev(() => document.querySelector('#refMsg').textContent)));
await shot('export');

// ═════════ B2 · Belegliste ═════════
await ev(() => setTab('text')); await sleep(300);
const s4 = S[10], s5 = S[11];
await pick(s4.a, s4.b); await page.keyboard.press('Shift+R'); await sleep(300);
R = await refs();
const need1 = await ev(ids => ({ cls: ids.every(i => spans[i].classList.contains('rf') && spans[i].classList.contains('need')), pin: [...document.querySelectorAll('#transcript .ref-pin.need')].map(p => p.title), btn: document.querySelector('#refsBtn').textContent, warn: document.querySelector('#refsBtn').classList.contains('warn'), modal: !!document.querySelector('#hcModal') }), s4.ids);
chk('Umschalt+R markiert die Stelle ohne Rückfrage als „Beleg nötig“', R.length === 5 && near(R[4].at, s4.at, 0.002) && !R[4].medium && !R[4].done && need1.cls && need1.pin.length === 1 && /^Beleg nötig/.test(need1.pin[0]) && need1.btn === 'Quellen (1 offen)' && need1.warn && !need1.modal && (await toast()) === 'Als „Beleg nötig“ markiert', need1);
await pick(s4.a, s4.b); await page.keyboard.press('Shift+R'); await sleep(250);
chk('dieselbe Stelle noch einmal: kein zweiter Eintrag', (await refs()).length === 5 && (await toast()) === 'Die Stelle ist schon als „Beleg nötig“ markiert');
chk('offene Belege erscheinen nicht im Bild und nicht in der Quellenliste', (await cues()).length === 3 && (await ev(() => refList().rows.length)) === 3);
// über den Dialog ohne Angaben
await pick(s5.a, s5.b); await page.click('#selRef'); await dlg('#rfMedium'); await page.click('#rfOk'); await sleep(300);
chk('Dialog ohne Angaben bestätigt: ebenfalls „Beleg nötig“', (await refs()).length === 6 && (await ev(() => refsOpen().length)) === 2 && (await toast()) === 'Als „Beleg nötig“ markiert');
// Stellen vorschlagen: Sätze mit Zahlen, Mengen, Studien, Zitaten
const sg = [S[13], S[14], S[15], S[16], S[17]];
await ev(([sg, s4]) => { commit(() => { P.edits[sg[0].ids[1]] = '42'; P.edits[sg[1].ids[2]] = 'Prozent'; P.edits[sg[2].ids[0]] = 'Laut'; P.edits[sg[3].ids[1]] = '„Zitat“'; P.edits[sg[4].ids[1]] = 'lauter'; P.edits[s4.ids[1]] = '17'; }, false); renderTranscript(); }, [sg, S[10]]); await sleep(300);
await ev(() => clearSel()); await page.click('#refsBtn'); await page.waitForSelector('#rfSheet'); await page.click('#rfSheet [data-a=find]'); await sleep(400);
R = await refs();
const found = R.slice(6).map(r => sg.findIndex(x => near(x.at, r.at, 0.002) && near(x.end, r.end, 0.002)));
chk('„Stellen vorschlagen“ markiert Sätze mit Zahlen, Mengenangaben, „laut“ und Anführungszeichen – und keine, die schon einen Eintrag haben', R.length === 10 && JSON.stringify(found) === '[0,1,2,3]' && R.slice(6).every(r => !r.medium && !r.done) && (await toast()).startsWith('4 Sätze als „Beleg nötig“ markiert'), [R.length, found, await toast()]);
const sheet2 = await ev(() => ({ h: [...document.querySelectorAll('#rfSheet h4')].map(h => h.textContent), boxes: document.querySelectorAll('#rfSheet .mk-row input[type=checkbox]').length }));
chk('Blatt: offene Belege oben, mit Kästchen zum Abhaken', sheet2.h[0] === 'Beleg nötig · 6 offen' && sheet2.boxes === 6, sheet2);
await page.click('#rfSheet [data-a=find]'); await sleep(300);
chk('ein zweiter Durchgang findet nichts Neues', (await refs()).length === 10 && (await toast()) === 'Keine weiteren Sätze mit Zahlen, Studien oder Zitaten gefunden');
await undo(); chk('die Vorschläge sind zusammen ein Rückgängig-Schritt', (await refs()).length === 6 && (await ev(() => refsOpen().length)) === 2);
// abhaken, belegen, wegschneiden
await ev(() => document.querySelector('#rfSheet .mk-row input[type=checkbox]').click()); await sleep(300);
R = await refs();
const okd = await ev(ids => ({ cls: ids.every(i => spans[i].classList.contains('okd') && !spans[i].classList.contains('need')), pin: document.querySelectorAll('#transcript .ref-pin.okd').length, open: refsOpen().length, btn: document.querySelector('#refsBtn').textContent, h: [...document.querySelectorAll('#rfSheet h4')].map(h => h.textContent) }), s4.ids);
chk('abgehakt („geprüft“): nicht mehr offen, im Text blass markiert, eigene Gruppe im Blatt', R[4].done === true && okd.cls && okd.pin === 1 && okd.open === 1 && okd.btn === 'Quellen (1 offen)' && okd.h.includes('Geprüft, ohne Quelle') && okd.h[0] === 'Beleg nötig · 1 offen', okd);
await ev(() => [...document.querySelectorAll('#rfSheet .mk-row')].find(r => !r.querySelector('input') && false) || document.querySelector('#rfSheet .mk-row [data-a=edit]').click()); await dlg('#rfMedium');
await fillRef({ rfMedium: 'Mieterbund', rfDate: '2025' }); await page.click('#rfOk'); await sleep(300);
chk('offenen Beleg mit einer Quelle versehen: Er zählt als Quelle und steht im Bild', (await ev(() => refsOpen().length)) === 0 && (await cues()).length === 4 && (await ev(() => refList().rows.length)) === 4 && (await ev(() => document.querySelector('#refsBtn').textContent)) === 'Quellen (6)', await ev(() => document.querySelector('#refsBtn').textContent));
await undo(); await undo();   // wieder zwei offene Belege
await ev(ids => { commit(() => ids.forEach(i => deleted.add(i)), false); tokens.forEach(t => paint(t.i)); }, s5.ids); await sleep(600);
const cutOpen = await ev(() => ({ open: refsOpen().length, rows: [...document.querySelectorAll('#rfSheet .mk-row.cut')].length, btn: document.querySelector('#refsBtn').textContent }));
chk('offener Beleg an einer weggeschnittenen Stelle zählt nicht mehr', cutOpen.open === 1 && cutOpen.rows === 1 && cutOpen.btn === 'Quellen (1 offen)', cutOpen);
await undo();
await ev(() => closeSheet());
// Export warnt, solange Einträge offen sind
await ev(() => setTab('export')); await sleep(400);
const ex2 = await ev(() => ({ hidden: document.querySelector('#exRefs').classList.contains('hidden'), text: document.querySelector('#exRefs span').textContent }));
chk('Export-Reiter: Hinweis auf offene Belege', !ex2.hidden && ex2.text === 'Noch 2 Belege offen: So viele Stellen sind als „Beleg nötig“ markiert.', ex2);
await ev(() => { window.__jobs = 0; const f = TS.exportVideo; TS.exportVideo = (...a) => { window.__jobs++; return f.apply(TS, a); }; });
await page.click('#exBtn'); await page.waitForSelector('#xrSee');
chk('„Exportieren“ fragt nach, solange Belege offen sind', (await ev(() => document.querySelector('#hcModal h3').textContent)) === '2 Belege sind noch offen');
await shot('offen');
await page.click('#xrSee'); await sleep(500);
const see = await ev(() => ({ tab, sheet: !!document.querySelector('#rfSheet') && !document.querySelector('#sheet').classList.contains('hidden'), jobs: window.__jobs }));
chk('„Belege ansehen“ startet keinen Export und öffnet die Liste im Text-Reiter', see.tab === 'text' && see.sheet && see.jobs === 0, see);
await ev(() => { closeSheet(); setTab('export'); }); await sleep(300);
await page.click('#exRefsBtn'); await sleep(400);
chk('„Ansehen“ neben dem Hinweis öffnet die Liste ebenfalls', (await ev(() => tab)) === 'text' && (await ev(() => !!document.querySelector('#rfSheet'))));
await ev(() => closeSheet());

// ═════════ B3 · Bauchbinden ═════════
const words = await ev(() => order.filter(i => tokens[i].type === 'word' && !isCut(i)));
const stageRect = () => ev(() => { const e = document.querySelector('#lowerOv img'); if (!e) return null; const r = e.getBoundingClientRect(), s = document.querySelector('#stage').getBoundingClientRect();
  return { l: (r.left - s.left) / s.width, t: (r.top - s.top) / s.height, w: r.width / s.width, h: r.height / s.height, b: (s.bottom - r.bottom) / s.height, r: (s.right - r.right) / s.width, nw: e.naturalWidth, nh: e.naturalHeight, src: e.src.length }; });
const lowers = () => ev(() => lowerList().map(x => ({ id: x.id, name: x.name, role: x.role, a: +x.a.toFixed(3), e: +x.e.toFixed(3), spk: !!x.spk })));
const firstOut = i => ev(i => +srcToOut(wS(tokens[i])).toFixed(3), i);
await ev(() => { commit(() => { P.speakers.push({ id: 'alt1', name: 'Person 1', st: {} }); for (let i = 0; i < tokens.length; i++) if (tokens[i].type !== 'pause' && i > 400) tokens[i].spk = 'alt1'; }, false); renderTranscript(); }); await sleep(300);
chk('Personen aus älteren Projekten (ohne Funktion) bekommen keine Bauchbinde', (await lowers()).length === 0 && (await ev(() => buildPlan().overlays.filter(o => o.lower).length)) === 0);
await pick(words[14], words[40]); await page.click('#selSpk'); await sleep(200); await page.click('text=Neue Person'); await dlg('#apName');
const ap0 = await ev(() => [document.querySelector('#apName').value, document.querySelector('#apLt').checked]);
await page.fill('#apName', 'Anna Beispiel'); await page.fill('#apRole', 'Sprecherin, Mietenbündnis');
const ap1 = await ev(() => document.querySelector('#apLt').checked);
chk('neue Person: Sobald eine Funktion eingetragen ist, schaltet sich die Bauchbinde ein', ap0[0] === 'Person 2' && ap0[1] === false && ap1 === true, [ap0, ap1]);
await page.click('#apOk'); await sleep(500);
let LW = await lowers(); const sp1 = await ev(() => P.speakers[1]);
chk('die Person bekommt Funktion und Bauchbinde; sie erscheint bei ihrem ersten Wort für vier Sekunden', sp1.name === 'Anna Beispiel' && sp1.role === 'Sprecherin, Mietenbündnis' && sp1.lt === true && LW.length === 1 && LW[0].spk && LW[0].name === 'Anna Beispiel' && LW[0].role === 'Sprecherin, Mietenbündnis' && near(LW[0].a, await firstOut(words[14]), 0.002) && near(LW[0].e - LW[0].a, 4, 0.002), [sp1, LW]);
await seek(LW[0].a + 0.5); await page.waitForFunction(() => { const e = document.querySelector('#lowerOv img'); return e && e.complete && e.naturalWidth > 0; }, null, { timeout: 8000 }).catch(() => {});
await sleep(600);
let Q = await stageRect(); const band = await ev(() => { const [W, H] = outSize(), b = subBand(W, H); return [b[0] / H, b[1] / H]; });
chk('Vorschau: links, über den Untertiteln, in Ausgabegröße gezeichnet', Q && Q.nw > 60 && Q.nh > 20 && near(Q.l, 0.04 * 360 / 640, 0.004) && Q.t + Q.h < band[0] - 0.005 && Q.t + Q.h > band[0] - 0.05 && near(Q.w, Q.nw / 640, 0.004) && near(Q.h, Q.nh / 360, 0.004), [Q, band]);
await shot('bauchbinde');
// Farben aus dem Designprofil: dunkler Kasten, Akzentbalken links, helle Schrift
// (gelesen wird von einer eigenen Leinwand der Prüfung, damit Chrome nicht vor häufigem Auslesen warnt)
const pix = await ev(() => { const x = lowerList()[0], [W, H] = outSize(), im = lowerImage(x.name, x.role, W, H), t = document.createElement('canvas'); t.width = im.w; t.height = im.h; const c = t.getContext('2d', { willReadFrequently: true }); c.drawImage(im.cv, 0, 0); const d = (px, py) => [...c.getImageData(px, py, 1, 1).data];
  let light = 0; const all = c.getImageData(0, 0, im.w, im.h).data; for (let i = 0; i < all.length; i += 4) if (all[i] > 180 && all[i + 1] > 180 && all[i + 2] > 170) light++;
  return { bar: d(1, Math.round(im.h / 2)), bg: d(im.w - 3, 3), light: light / (im.w * im.h), w: im.w, h: im.h }; });
chk('im Design der Folien: Kasten in Anthrazit, Balken in Rot, Schrift in Creme', JSON.stringify(pix.bar) === '[229,64,42,255]' && JSON.stringify(pix.bg) === '[19,19,18,255]' && pix.light > 0.03 && pix.light < 0.5, pix);
await seek(LW[0].e + 0.3); chk('nach vier Sekunden ist sie wieder weg', (await stageRect()) === null);
// folgt dem Schnitt
await ev(ids => { commit(() => ids.forEach(i => deleted.add(i)), false); tokens.forEach(t => paint(t.i)); }, words.slice(14, 20)); await sleep(300);
LW = await lowers(); chk('die ersten Wörter der Person weggeschnitten: Die Bauchbinde erscheint beim nächsten Wort, das bleibt', LW.length === 1 && near(LW[0].a, await firstOut(words[20]), 0.002), LW);
await undo();
// Sprecher:innen-Karte: Funktion ändern, ausschalten
await ev(() => setTab('subs')); await sleep(400);
const card = await ev(() => { const r = document.querySelectorAll('#spkList .spk-row'); return [...r].map(x => [x.querySelector('.spk-name').value, x.querySelector('.sp-role').value, x.querySelector('.sp-lt').checked]); });
chk('Sprecher:innen: Funktion und „Bauchbinde beim ersten Auftritt“ je Person', JSON.stringify(card) === '[["Person 1","",false],["Anna Beispiel","Sprecherin, Mietenbündnis",true]]', card);
const key0 = await ev(() => { const x = lowerList()[0], [W, H] = outSize(); return lowerImage(x.name, x.role, W, H).key; });
await ev(() => { const el = document.querySelectorAll('#spkList .sp-role')[1]; el.value = 'Sprecherin'; el.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(300);
LW = await lowers(); const key1 = await ev(() => { const x = lowerList()[0], [W, H] = outSize(); return lowerImage(x.name, x.role, W, H).key; });
chk('Funktion geändert: Die Bauchbinde wird neu gezeichnet', LW[0].role === 'Sprecherin' && key1 !== key0);
await ev(() => { const el = document.querySelectorAll('#spkList .sp-role')[0]; el.value = 'Moderation'; el.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(300);
LW = await lowers();
chk('Funktion bei einer Person aus einem älteren Projekt eingetragen: Die Bauchbinde schaltet sich ein', LW.length === 2 && LW[1].name === 'Person 1' && LW[1].role === 'Moderation' && (await ev(() => P.speakers[0].lt)) === true, LW);
await ev(() => document.querySelectorAll('#spkList .sp-lt')[0].click()); await sleep(300);
chk('Haken entfernt: keine Bauchbinde für diese Person; die Funktion bleibt', (await lowers()).length === 1 && (await ev(() => [P.speakers[0].lt, P.speakers[0].role].join())) === 'false,Moderation');
await undo(); await undo(); await undo();
// Blatt „Bauchbinden“ und Bauchbinde von Hand
await page.click('#lowerBtn'); await page.waitForSelector('#lwSheet');
const lw0 = await ev(() => ({ rows: [...document.querySelectorAll('#lwRows .mk-row')].map(r => [r.querySelector('.mono').textContent, r.querySelector('b').textContent, r.querySelector('i').textContent]), v: document.querySelector('#lwV').value, h: document.querySelector('#lwH').value, dur: document.querySelector('#lwDur').value, size: document.querySelector('#lwSizeV').textContent }));
chk('Blatt „Bauchbinden“: Übersicht und Vorgaben (über den Untertiteln, links, 4 s, 100 %)', lw0.rows.length === 1 && lw0.rows[0][1] === 'Anna Beispiel' && lw0.rows[0][2] === 'Sprecherin, Mietenbündnis · erster Auftritt' && lw0.v === 'a' && lw0.h === 'l' && lw0.dur === '4' && lw0.size === '100 %', lw0);
await seek(LW[0].a + 2);
await page.click('#lwSheet [data-a=add]'); await dlg('#apName');
chk('Bauchbinde von Hand: Dialog mit Name, Funktion und Dauer', (await ev(() => [!!document.querySelector('#apDur'), !!document.querySelector('#apLt'), document.querySelector('#apDur').value].join())) === 'true,false,4');
await page.fill('#apName', 'Dr. Kim Muster'); await page.fill('#apRole', 'Stadtforschung, Universität Beispielstadt'); await page.fill('#apDur', '3'); await page.click('#apOk'); await sleep(400);
LW = await lowers(); const it1 = await ev(() => P.items.find(x => x.lt));
chk('sie ist ein Titel-Element an der Abspiellinie; die laufende Bauchbinde endet, wenn die nächste beginnt', it1 && it1.type === 'title' && it1.name === 'Dr. Kim Muster' && it1.role === 'Stadtforschung, Universität Beispielstadt' && it1.dur === 3 && LW.length === 2 && near(LW[0].e, LW[1].a, 0.002) && near(LW[1].e - LW[1].a, 3, 0.002) && !LW[1].spk, [it1, LW]);
await seek(LW[1].a + 0.5); await sleep(500); const Q2 = await stageRect();
chk('Vorschau zeigt die zweite Bauchbinde an derselben Stelle; als gewöhnlicher Titel erscheint sie nicht', Q2 && near(Q2.l, Q.l, 0.004) && near(Q2.t + Q2.h, Q.t + Q.h, 0.004) && Q2.w > Q.w && (await ev(() => document.querySelectorAll('#titleOv .titlebox').length)) === 0, Q2);
// Lage und Größe
await page.selectOption('#lwV', 'u'); await sleep(350); const Qu = await stageRect();
await page.selectOption('#lwH', 'r'); await sleep(350); const Qr = await stageRect();
await page.selectOption('#lwV', 'o'); await page.selectOption('#lwH', 'm'); await sleep(350); const Qo = await stageRect();
const topWant = await ev(() => { const [W, H] = outSize(); return (linesReach(W, H, 'o') + 0.014 * Math.min(W, H)) / H; });   // oben stehen die Quellenzeilen: Die Bauchbinde bleibt darunter
chk('Lage: unterer Rand, rechts, oben in der Mitte (unter den Quellenzeilen)', near(Qu.b, 0.04, 0.006) && near(Qu.l, Q.l, 0.004) && near(Qr.r, 0.04 * 360 / 640, 0.004) && near(Qr.b, 0.04, 0.006) && topWant > 0.06 && near(Qo.t, topWant, 0.006) && near(Qo.l + Qo.w / 2, 0.5, 0.004), [Qu, Qr, Qo, topWant]);
await ev(() => { const el = document.querySelector('#lwSize'); el.value = '1.5'; el.dispatchEvent(new Event('input', { bubbles: true })); }); await sleep(350); const Qb = await stageRect();
chk('Größe 150 %: die Bauchbinde wächst entsprechend', near(Qb.h / Qo.h, 1.5, 0.08) && (await ev(() => P.lower.size)) === 1.5, [Qb.h, Qo.h]);
const nU = await ev(() => undo.length); await undo();
chk('Lage und Größe sind zusammen ein Rückgängig-Schritt', (await ev(() => !P.lower)) && near((await stageRect()).t, Q2.t, 0.004), await ev(() => P.lower));
// Textzeile am unteren Rand: die Bauchbinde bleibt darüber
await ev(() => { commit(() => { P.lower = { pos: 'ul' }; P.textline = { ...TLINE_DEF, text: '@kanal', pos: 'ul' }; }, false); }); await seek(LW[1].a + 0.5); await sleep(300);
const over = { q: await stageRect(), tl: await onStage('#tline') };
chk('Textzeile am unteren Rand: Die Bauchbinde sitzt darüber', over.q && over.tl && over.q.t + over.q.h < over.tl.t && over.q.t + over.q.h > over.tl.t - 0.04, over);
await undo();
// Zeitleiste
await ev(() => closeSheet()); await ev(() => setTab('studio')); await sleep(700);
const tlb = await ev(() => ({ auto: [...document.querySelectorAll('#trTitle .lt-auto')].map(x => x.textContent), man: [...document.querySelectorAll('#trTitle .blk.title.lt')].map(x => x.querySelector('.txt').textContent) }));
chk('Zeitleiste: die Bauchbinde von Hand als Block, die automatische gestrichelt zur Übersicht', JSON.stringify(tlb.auto) === '["Bauchbinde · Anna Beispiel"]' && JSON.stringify(tlb.man) === '["Bauchbinde · Dr. Kim Muster"]', tlb);
await shot('studio');
await ev(() => { editTitle(P.items.find(x => x.lt).id); }); await dlg('#apName');
chk('Bearbeiten öffnet Name, Funktion und Dauer (mit „Entfernen“)', (await ev(() => [document.querySelector('#apName').value, document.querySelector('#apDur').value, !!document.querySelector('#apDel')].join('|'))) === 'Dr. Kim Muster|3|true');
await page.fill('#apName', 'Dr. Kim Beispiel'); await page.click('#apOk'); await sleep(350);
chk('Name geändert', (await ev(() => P.items.find(x => x.lt).name)) === 'Dr. Kim Beispiel' && (await lowers())[1].name === 'Dr. Kim Beispiel');
await ev(() => document.querySelector('#trTitle .lt-auto').click()); await sleep(300);
chk('Klick auf die automatische Bauchbinde öffnet das Blatt', await ev(() => !!document.querySelector('#lwSheet') && !document.querySelector('#sheet').classList.contains('hidden')));
await ev(() => closeSheet());
// Designprofil gewechselt: neue Farben
// (das Designprofil gehört nicht zum Rückgängig-Stand: von Hand setzen und zurücknehmen)
const pix2 = await ev(() => { const old = P.slideProfile; P.slideProfile = JSON.parse(JSON.stringify(SL_BUILTIN.find(p => p.id === 'ruhig'))); changed(false);
  const x = lowerList()[0], [W, H] = outSize(), im = lowerImage(x.name, x.role, W, H), t = document.createElement('canvas'); t.width = im.w; t.height = im.h; const c = t.getContext('2d', { willReadFrequently: true }); c.drawImage(im.cv, 0, 0); const px = [...c.getImageData(im.w - 3, 3, 1, 1).data];
  if (old) P.slideProfile = old; else delete P.slideProfile; changed(false); return px; });
chk('anderes Designprofil: Die Bauchbinde übernimmt dessen Farben (hier: heller Kasten)', JSON.stringify(pix2) === '[244,239,230,255]', pix2);
// Exportplan
await ev(() => setTab('export')); await sleep(300);
const plan2 = await ev(async () => { await lowerReady(); const p = buildPlan(), [W, H] = outSize(), lw = p.overlays.filter(o => o.lower), x = lowerList(); return { lw, n: p.overlays.length, last: p.overlays.map(o => o.track), sum: document.querySelector('#exSummary').textContent, titles: p.subs.cues.filter(c => c.title && !c.line).length, W, H }; });
const png = plan2.lw.map(o => fs.existsSync(o.uri) ? fs.readFileSync(o.uri).subarray(1, 4).toString() : '');
chk('Exportplan: jede Bauchbinde als Bild-Einblendung über allen Clips, an ihrer Stelle und Zeit', plan2.lw.length === 2 && plan2.lw.every(o => o.mode === 'pip' && o.image && o.track === 98 && o.vol === 0 && o.in === 0) && near(plan2.lw[0].at, LW[0].a, 0.002) && near(plan2.lw[0].out, LW[0].e - LW[0].a, 0.002) && near(plan2.lw[0].x - plan2.lw[0].w / 2, Q.l, 0.004) && near(plan2.lw[0].y + plan2.lw[0].w / plan2.lw[0].aspect * plan2.W / plan2.H / 2, Q.t + Q.h, 0.006) && plan2.titles === 0 && / · 2 Bauchbinden/.test(plan2.sum), [plan2.lw[0], plan2.sum]);
chk('die Bilder liegen als PNG im Datenordner des Projekts', png.length === 2 && png.every(x => x === 'PNG') && plan2.lw.every(o => /bauchbinde-[a-z0-9]+\.png$/.test(o.uri)), plan2.lw.map(o => o.uri));

// ═════════ B10 · Barrierefreiheit ═════════
const issues = so => ev(so => a11yIssues(so).map(x => [x.k, x.text, x.fix || '']), !!so);
const fix = async (box, k) => { await ev(([box, k]) => { const rows = [...document.querySelectorAll(`#${box} .a11y-row`)]; rows[k].querySelector('button').click(); }, [box, k]); await sleep(350); };
chk('Kontrast nach WCAG: Schwarz auf Weiß 21 : 1, #777 auf Weiß knapp unter 4,5 : 1', near(await ev(() => contrast('#FFFFFF', '#000000')), 21, 0.01) && near(await ev(() => contrast('#777777', '#FFFFFF')), 4.48, 0.01) && (await ev(() => fmtRatio(4.48))) === '4,4 : 1');
await ev(() => { readFix(); }); await sleep(300);
let I = await issues();
chk('Vorgaben (mittel, Weiß mit schwarzer Umrandung): keine Hinweise', I.length === 0 && (await ev(() => (renderExport(), document.querySelector('#a11yList').textContent))) === 'Untertitel sind an, groß genug und heben sich gut ab.' && (await ev(() => document.querySelector('#exA11y').classList.contains('hidden'))), I);
await ev(() => { commit(() => { S().size = 'klein'; S().color = '#333333'; }, false); syncStyleInputs(); renderExport(); }); await sleep(300);
I = await issues();
chk('klein im Querformat und dunkle Schrift mit schwarzer Umrandung: zwei Hinweise mit Kontrastwert', I.length === 2 && I[0][0] === 'size' && /Im Querformat sind sie auf dem Handy schwer zu lesen/.test(I[0][1]) && I[0][2] === 'Auf „mittel“ stellen' && I[1][0] === 'contrast' && /Kontrast 1,6 : 1, empfohlen sind mindestens 4,5 : 1/.test(I[1][1]) && I[1][2] === 'Umrandung weiß', I);
const exa = await ev(() => ({ hidden: document.querySelector('#exA11y').classList.contains('hidden'), text: document.querySelector('#exA11y span').textContent, rows: document.querySelectorAll('#a11yList .a11y-row').length }));
chk('Export-Reiter: Hinweis neben dem Export-Knopf und in der Karte „Barrierefreiheit“', !exa.hidden && exa.text === 'Barrierefreiheit: 2 Hinweise zu den Untertiteln.' && exa.rows === 2, exa);
await shot('barrierefrei');
await ev(() => setTab('subs')); await sleep(400);
chk('Untertitel-Reiter: dieselben Hinweise unter den Einstellungen', (await ev(() => document.querySelectorAll('#a11ySub .a11y-row').length)) === 2 && !(await ev(() => document.querySelector('#a11ySub').classList.contains('hidden'))));
await fix('a11ySub', 0); await fix('a11ySub', 0);
const fixed = await ev(() => ({ size: S().size, oc: S().outlineColor, inSize: document.querySelector('#stSize').value, inOc: document.querySelector('#stOutlineColor').value, rows: document.querySelectorAll('#a11ySub .a11y-row').length, hidden: document.querySelector('#a11ySub').classList.contains('hidden') }));
chk('„Auf mittel stellen“ und „Umrandung weiß“ beheben beides; die Eingabefelder ziehen mit', fixed.size === 'mittel' && fixed.oc === '#FFFFFF' && fixed.inSize === 'mittel' && fixed.inOc === '#ffffff' && fixed.rows === 0 && fixed.hidden, fixed);
await undo(); await undo(); await undo();
await ev(() => { commit(() => { S().outline = false; }, false); syncStyleInputs(); }); I = await issues(true);
chk('weder Umrandung noch Kasten: Hinweis mit „Umrandung an“', I.length === 1 && I[0][0] === 'bare' && I[0][2] === 'Umrandung an', I);
await ev(() => { commit(() => { S().bg = true; S().color = '#E5402A'; }, false); syncStyleInputs(); }); I = await issues(true);
chk('Kasten mit mittelheller Schrift: zu wenig Kontrast vor hellem Bild', I.length === 1 && I[0][0] === 'contrast' && /hebt sich vor hellem Bild kaum vom Kasten ab \(Kontrast 1,3 : 1/.test(I[0][1]) && I[0][2] === 'Schrift weiß', I);
await undo(); await undo();
await ev(() => { commit(() => { P.speakers[1].st = { color: '#222222' }; }, false); }); I = await issues(true);
chk('eigene Farbe einer Person mit zu wenig Kontrast: Hinweis nennt die Person', I.length === 1 && /Schrift und Umrandung von Anna Beispiel heben sich kaum voneinander ab/.test(I[0][1]) && I[0][2] === 'Farbe wie alle', I);
await ev(() => setTab('subs')); await sleep(300); await fix('a11ySub', 0);
chk('„Farbe wie alle“ entfernt die Abweichung', (await ev(() => JSON.stringify(P.speakers[1].st))) === '{}' && (await issues(true)).length === 0);
await undo(); await undo();
await ev(() => { commit(() => { S().enabled = false; }, false); syncStyleInputs(); setTab('export'); }); await sleep(300); I = await issues();
chk('Untertitel ausgeschaltet: Hinweis im Export-Reiter', I.length === 1 && I[0][0] === 'nosubs' && /^Die Untertitel sind ausgeschaltet\./.test(I[0][1]) && I[0][2] === 'Zu den Untertiteln', I);
await fix('a11yList', 0); chk('„Zu den Untertiteln“ wechselt den Reiter', (await ev(() => tab)) === 'subs');
await undo();
await ev(() => { exFmt = 'video'; P.settings.burn = false; setTab('export'); }); await sleep(300); I = await issues();
chk('Untertitel nicht eingebrannt: Hinweis auf die SRT-Datei, zählt nicht als Warnung', I.length === 1 && I[0][0] === 'burn' && /SRT-Datei/.test(I[0][1]) && (await ev(() => document.querySelector('#exA11y').classList.contains('hidden'))), I);
await ev(() => { P.settings.burn = true; renderExport(); });
// Hochformat: „klein“ ist dort groß genug
await ev(() => { commit(() => { P.format = '9:16'; S().size = 'klein'; }, true); }); await sleep(300); I = await issues(true);
chk('im Hochformat ist „klein“ groß genug (Schrift wächst dort um ein Viertel)', I.length === 0 && (await ev(() => outSize()[1] > outSize()[0])), [I, await ev(() => outSize())]);
await undo();

// ── Textfassung ──
await ev(() => { commit(() => { P.marks.push({ id: 'k1', k: 'chap', at: wS(tokens[order.find(i => tokens[i].type === 'word' && !isCut(i))]), text: 'Einstieg' }); }, false); }); await sleep(200);
const tv = await ev(() => textVersion());
const tvw = await ev(ids => ids.map(i => tokText(tokens[i])), [s1.ids[s1.ids.length - 1], words[14], words[13]]);
chk('Textfassung: Name, Länge, Kapitel als Überschrift', tv.startsWith(await ev(() => `${P.name}\nTextfassung des Videos · ${fmtT(total)}\n\n## Einstieg\n\n`)), tv.slice(0, 120));
chk('Textfassung: Person mit Funktion beim ersten Auftritt, danach nur der Name', tv.includes(`\n\nAnna Beispiel (Sprecherin, Mietenbündnis): ${tvw[1]} `) && (tv.match(/Anna Beispiel \(/g) || []).length === 1 && tv.includes('\n\nPerson 1: '), tv.slice(tv.indexOf('Anna Beispiel') - 40, tv.indexOf('Anna Beispiel') + 90));
chk('Textfassung: Fußnote hinter der belegten Stelle, Quellenliste am Ende', tv.includes(`${tvw[0]} [1]`) && tv.includes('[1][2]') === false && tv.endsWith('\n\nQuellen\n[1] Statistisches Bundesamt: Mieten in Großstädten 2024 (12.03.2025) – https://www.destatis.de/mieten\n[2] taz (2024)\n[3] www.mieterbund.de/studie.pdf\n') && (tv.match(/\[1\]/g) || []).length === 3, tv.slice(-220));
await ev(ids => { commit(() => ids.forEach(i => deleted.add(i)), false); }, s3.ids); const tv2 = await ev(() => textVersion());
chk('Weggeschnittenes fehlt in der Textfassung, auch seine Quelle', !tv2.includes(s3.text.split(' ').slice(0, 3).join(' ')) && !tv2.includes('mieterbund') && tv2.length < tv.length, tv2.slice(-160));
await undo();
const txtFile = path.join(OUT, 'quellen-textfassung.txt'); fs.rmSync(txtFile, { force: true });
await ev(() => setTab('export')); await sleep(300); setPick({ save_any: txtFile });
await page.click('#tvSave'); await page.waitForFunction(() => /Gespeichert|Fehler/.test(document.querySelector('#tvMsg').textContent), null, { timeout: 15000 }).catch(() => {});
chk('„Textfassung speichern“ schreibt die Textdatei', fs.existsSync(txtFile) && fs.readFileSync(txtFile, 'utf8') === tv && /^Gespeichert: /.test(await ev(() => document.querySelector('#tvMsg').textContent)), await ev(() => document.querySelector('#tvMsg').textContent));
await page.click('#tvCopy'); await sleep(300);
chk('„In die Zwischenablage“ kopiert sie', (await ev(() => navigator.clipboard.readText())) === tv);

// ═════════ Echte Exporte: Quellenzeile, Bauchbinde und Textfassung ═════════
// kurzes Video: nur die ersten Sekunden bleiben; Quelle und Bauchbinde liegen darin
await ev(([w, s, s0]) => { commit(() => { addDel(outToSrcT(Math.max(9, s.e + 3.2)), outToSrcT(total - 0.01)); for (const sp of P.speakers) sp.lt = false; P.items = P.items.filter(x => !x.lt);
  for (const i of w) tokens[i].spk = P.speakers[1].id; P.speakers[1].lt = true; P.marks = P.marks.filter(m => m.id !== 'k1'); P.refs.push({ id: 'offen1', at: s0.at, end: s0.end }); }, true); }, [words.slice(2, 12), S[2], S[0]]); await sleep(500);
const tA = await ev(() => { const q = refCues()[0], l = lowerList()[0], [W, H] = outSize(), im = lowerImage(l.name, l.role, W, H), r = lowerRect(im, W, H), L = srcLayout(q.text, W, H);
  return { total, q: [q.s, q.e], l: [l.a, l.e], rect: [Math.round(r.x), Math.round(r.y), im.w, im.h], line: [Math.round(L.mL), Math.round(L.mT), Math.round(L.tw), Math.round(L.px * 1.12)], W, H, open: refsOpen().length }; });
chk('Vorbereitung: kurzes Video mit einer Quellenzeile, einer Bauchbinde und einem offenen Beleg', tA.total < 20 && tA.q[1] < tA.total && tA.l[1] <= tA.total + 0.01 && tA.open === 1, tA);
const exp = (fmt, name, opt) => ev(async ([fmt, name, opt]) => {
  exFmt = fmt; const keep = [P.srcStyle, P.speakers[1].lt]; if (opt.plain){ P.srcStyle = { on: false }; P.speakers[1].lt = false; changed(false); }
  await lowerReady(); const plan = buildPlan(); plan.name = name; P.srcStyle = keep[0]; if (!P.srcStyle) delete P.srcStyle; P.speakers[1].lt = keep[1]; changed(false);
  const id = TS.exportVideo(JSON.stringify(plan));
  for (;;){ await new Promise(r => setTimeout(r, 300)); const j = JSON.parse(TS.job(id)); if (j.status === 'done') return { ok: true, result: j.result, lower: plan.overlays.filter(o => o.lower).length, src: plan.subs.cues.filter(c => c.src).length }; if (j.status === 'error') return { ok: false, error: j.error }; }
}, [fmt, name, opt || {}]);
const crop = (f, t, c) => execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', `crop=${c}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 24 });
const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 24) n++; return n / a.length; };
const mean = a => a.reduce((x, y) => x + y, 0) / a.length;
const A = await exp('video', 'quellen_mit'), B = await exp('video', 'quellen_ohne', { plain: true });
chk('zwei Exporte laufen durch (mit und ohne Quellenzeile und Bauchbinde)', A.ok && B.ok && A.lower === 1 && A.src === 1 && B.lower === 0 && B.src === 0, [A.error, B.error, A.lower, A.src]);
if (A.ok && B.ok){
  const fA = A.result.playable, fB = B.result.playable, box = tA.rect.join(':').replace(/^(\d+):(\d+):(\d+):(\d+)$/, '$3:$4:$1:$2'), ln = `${tA.line[2]}:${tA.line[3]}:${tA.line[0]}:${tA.line[1]}`;
  const tL = (tA.l[0] + Math.min(tA.l[1], tA.l[0] + 3)) / 2, tQ = (tA.q[0] + tA.q[1]) / 2, tOff = Math.min(tA.total - 0.4, Math.max(tA.l[1], tA.q[1]) + 0.6);
  const d = { box: diff(crop(fA, tL, box), crop(fB, tL, box)), boxMean: mean(crop(fA, tL, box)), boxOff: diff(crop(fA, tOff, box), crop(fB, tOff, box)), line: diff(crop(fA, tQ, ln), crop(fB, tQ, ln)), lineOff: diff(crop(fA, tOff, ln), crop(fB, tOff, ln)) };
  chk('im Video steht die Bauchbinde an ihrer Stelle (dunkler Kasten) und verschwindet nach ihrer Zeit', d.box > 0.5 && d.boxMean < 75 && d.boxOff < 0.01, d);
  chk('im Video steht die Quellenzeile oben links, solange der Satz läuft, danach ist sie weg', d.line > 0.04 && d.lineOff < 0.01, d);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.max(tL, tA.q[0] + 0.2)), '-i', fA, '-frames:v', '1', path.join(OUT, 'quellen-export.png')]);
  const srt = A.result.files.find(x => x.endsWith('.srt')), txt = srt ? fs.readFileSync(srt, 'utf8') : '';
  chk('die SRT-Datei enthält die Untertitel, aber weder Quelle noch Bauchbinde', txt.length > 40 && /-->/.test(txt) && !/Quelle|Destatis|Anna Beispiel/.test(txt), txt.slice(0, 100));
  for (const r of [A, B]) for (const x of r.result.files) fs.rmSync(x, { force: true, recursive: true });
}
const cc = await exp('capcut', 'quellen_cc');
if (chk('CapCut-Export läuft durch', cc.ok, cc.error)){
  const raw = fs.readFileSync(path.join(cc.result.files[0], 'draft_content.json'), 'utf8'), doc = JSON.parse(raw), tt = doc.tracks.filter(t => t.type === 'text').map(t => [t.name, t.segments.length]);
  chk('in CapCut liegen die Quellenzeilen auf einer eigenen Textspur, die Bauchbinde als Bild auf einer Videospur', tt.some(t => t[0] === 'Quellen' && t[1] === 1) && tt.some(t => t[0] === 'Untertitel' && t[1] > 1) && /bauchbinde-[a-z0-9]+\.png/.test(raw), tt);
  for (const x of cc.result.files) fs.rmSync(x, { force: true, recursive: true });
}
// über den Knopf: Nachfrage wegen offener Belege, dann Export mit Textfassung
await ev(() => { exFmt = 'video'; paintExportForm(); document.querySelector('#exName').value = 'quellen_knopf'; window.__jobs = 0; }); await sleep(200);
chk('„Textfassung mitspeichern“ ist anfangs aus', !(await ev(() => document.querySelector('#exTextv').checked)));
await page.click('#exTextv'); await sleep(150);
const tvNow = await ev(() => textVersion());
await page.click('#exBtn'); await page.waitForSelector('#xrGo'); await page.click('#xrGo');
await page.waitForFunction(() => !document.querySelector('#exDone').classList.contains('hidden') || /^Fehler/.test(document.querySelector('#exMsg').textContent), null, { timeout: 180000 });
const done = await ev(() => ({ jobs: window.__jobs, files: (exResult && exResult.files) || [], msg: document.querySelector('#exMsg').textContent, set: [P.settings.textv, localStorage.getItem('hc-textv')] }));
const tf = done.files.find(x => x.endsWith('quellen_knopf – Textfassung.txt'));
chk('„Trotzdem exportieren“ startet den Export; die Textfassung liegt neben dem Video', done.jobs === 1 && done.files.some(x => x.endsWith('quellen_knopf.mp4')) && tf && fs.readFileSync(tf, 'utf8') === tvNow && done.set[0] === true && done.set[1] === '1', done);
for (const x of done.files) fs.rmSync(x, { force: true, recursive: true });
await ev(() => { try { localStorage.removeItem('hc-textv'); } catch (_) {} });

// ═════════ Clip aus dem Projekt: Quellen des Ausschnitts kommen mit ═════════
await ev(() => { pausePlay(); saveNow(); });
const clipInfo = await ev(async s => { const o1 = Math.max(0, s.s - 0.2), o2 = Math.min(total, s.e + 3); makeClip(o1, o2, '9:16', 'Test Clip Quellen');
  for (let k = 0; k < 80 && !(P && P.clipOf && tab === 'clip'); k++) await new Promise(r => setTimeout(r, 100)); await new Promise(r => setTimeout(r, 400));
  return { id: P.id, clipOf: P.clipOf, refs: (P.refs || []).map(r => r.medium || ''), cues: refCues().map(c => c.text), lw: lowerList().map(x => [x.name, +x.a.toFixed(2)]), size: outSize() }; }, S[2]);
chk('Clip: die Quellen des Ausschnitts kommen mit, die Zeile steht auch dort im Bild; die Bauchbinde erscheint beim ersten Wort im Clip', clipInfo.clipOf === sid && clipInfo.refs.length === 2 && clipInfo.cues.length === 1 && clipInfo.cues[0] === 'Quellen: Destatis 2025 · taz, 2024' && clipInfo.lw.length === 1 && clipInfo.lw[0][0] === 'Anna Beispiel' && clipInfo.size[1] > clipInfo.size[0], clipInfo);
await ev(() => { commit(() => { P.settings.safe = 'tiktok'; }, false); }); await seek(0.6); await sleep(500);
const safe = await ev(() => { const [W, H] = outSize(), z = safeZone(), q = refCues()[0], L = srcLayout(q.text, W, H), l = lowerList()[0], im = lowerImage(l.name, l.role, W, H), r = lowerRect(im, W, H); return { z, top: L.mT / H, left: L.mL / W, lb: (r.y + im.h) / H, ll: r.x / W }; });
chk('Hochformat mit Schutzzonen: Quellenzeile und Bauchbinde bleiben in der freien Fläche', safe.z && safe.top >= safe.z.t - 1e-6 && safe.left >= safe.z.l - 1e-6 && safe.lb <= 1 - safe.z.b + 1e-6 && safe.ll >= safe.z.l - 1e-6, safe);
await shot('clip');
const cid = clipInfo.id;

chk('keine Fehlermeldungen in der Oberfläche', logs.length === 0, logs.slice(0, 5));
await drop(cid); await drop(sid);
await ende(browser);
