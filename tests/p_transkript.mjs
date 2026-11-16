// Transkript (2.29): eigenes Wörterbuch (C1), unsichere Wörter der Reihe nach prüfen (C2), Fassungen vergleichen (C5),
// Prüfliste nach dem Aufräumen (A5). Arbeitet mit anlauf.mp4: fester Text mit Anläufen, Füllwörtern, unsicheren Wörtern und
// falsch geschriebenen Namen (siehe medien.py).
import fs from 'node:fs';
import path from 'node:path';
import { launch, newProject, transcribe, sleep, pruefung, MEDIA, OUT, WORK } from './drv.mjs';
const { chk, ende } = pruefung('Transkript');
const { browser, page, logs } = await launch();
const ev = (f, a) => page.evaluate(f, a);
const shot = (name, pg = page) => pg.screenshot({ path: path.join(OUT, `transkript-${name}.png`) });
const key = async k => { await page.keyboard.press(k); await sleep(280); };
const hintFile = () => { try { return JSON.parse(fs.readFileSync(path.join(WORK, 'hint.json'), 'utf8')); } catch (_) { return null; } };
const made = [];
// Frisches Projekt aus anlauf.mp4, transkribiert; auto: was direkt nach der Transkription aufgeräumt wird
async function fresh(auto){
  await ev(() => { if (typeof P !== 'undefined' && P){ pausePlay(); clearTimeout(saveT); saveNow(); closeProject(); } });
  const id = await newProject(page, [MEDIA + 'anlauf.mp4']); made.push(id);
  if (auto){
    await ev(a => { for (const k of ['autoFillers', 'autoRepeats', 'autoPauses']) document.querySelector('#' + k).checked = !!a[k]; document.querySelector('#autoPauseLen').value = '0'; }, auto);
    await page.click('#transBtn');
    await page.waitForFunction(() => tokens.length > 0 && document.querySelector('#transCancel').classList.contains('hidden'), null, { timeout: 120000 });
    await sleep(300);
  } else await transcribe(page);
  await ev(() => { if (tab !== 'text') setTab('text'); }); await sleep(250);
  return id;
}
const words = () => ev(() => order.filter(i => isTextTok(i) && !isCut(i) && tokText(tokens[i])).map(i => tokText(tokens[i])).join(' '));
const idOf = (txt, nth = 0) => ev(([txt, nth]) => tokens.filter(t => t.type === 'word' && t.text === txt)[nth].i, [txt, nth]);
const bar = () => ev(() => ({ shown: !document.querySelector('#lowBar').classList.contains('hidden'), on: LQ.on, pos: document.querySelector('#lowPos').textContent, hint: document.querySelector('#lowHint').textContent,
  val: document.querySelector('#lowIn').value, chk: [...document.querySelectorAll('#transcript .tk.chk')].map(s => s.textContent).join(' '), focus: document.activeElement && document.activeElement.id, btn: document.querySelector('#lowBtn').textContent }));
const lowCls = txt => ev(txt => { const t = tokens.find(t => t.type === 'word' && t.text === txt); return spans[t.i].className; }, txt);
await ev(() => { try { for (const k of ['hc-dict', 'hc-fillers', 'ts-auto2']) localStorage.removeItem(k); } catch (_) {} dict.length = 0; });

// ═════════ Unsichere Wörter der Reihe nach prüfen (C2) ═════════
await fresh();
const text0 = await words();
chk('Testtext steht vollständig da', text0.startsWith('Heute spreche ich über Mareike Hermeyer und die AFD. Ich wollte ich wollte heute') && text0.endsWith('Gewerkschaft deutlich.'), text0);
let b = await bar();
chk('der Knopf nennt die Zahl der unsicheren Wörter; die Prüfleiste ist zu', b.btn === 'Unsichere prüfen (7)' && !b.shown && !b.on, b);
chk('unsichere Wörter sind gepunktet unterstrichen, sichere bleiben ohne Zeichen', /\blow\b/.test(await lowCls('Hermeyer')) && !/\blow\b/.test(await lowCls('Mareike')));
const snapA = await ev(() => snapshot());
await page.click('#lowBtn'); await sleep(500);
b = await bar();
chk('Prüfen beginnt bei der ersten unsicheren Stelle: Feld gefüllt, Wort hervorgehoben, Sicherheit genannt', b.shown && b.on && b.pos === 'Unsichere Stelle 1 von 5' && b.val === 'Hermeyer' && b.chk === 'Hermeyer' && b.hint === 'Whisper war sich zu 31 % sicher' && b.focus === 'lowIn', b);
let pl = await ev(() => ({ playing, stopAt, outPos, at: srcToOut(snapSrc(wS(tokens.find(t => t.text === 'Hermeyer')))) }));
chk('die Stelle wird abgespielt: ab etwa einer Sekunde davor bis kurz danach', pl.playing && pl.stopAt > pl.at + 0.5 && pl.stopAt < pl.at + 1.8 && pl.outPos < pl.at + 0.3, pl);
await page.waitForFunction(() => !playing, null, { timeout: 8000 });
pl = await ev(() => ({ outPos, end: srcToOut(snapSrc(wE(tokens.find(t => t.text === 'Hermeyer')))) }));
chk('die Wiedergabe hält kurz nach dem Wort von selbst an', pl.outPos > pl.end + 0.3 && pl.outPos < pl.end + 1.2, pl);
chk('das Anzeigen und Anhören ändert nichts am Projekt', (await ev(() => snapshot())) === snapA);
await shot('pruefen');

// Korrigieren mit Enter
await page.fill('#lowIn', 'Hermeier'); await key('Enter');
let st = await ev(() => { const t = tokens.find(t => t.text === 'Hermeyer'); return { edit: P.edits[t.i], ok: t.ok, cls: spans[t.i].className, shown: spans[t.i].textContent, undo: undo.length }; });
b = await bar();
chk('Enter mit geändertem Text übernimmt die Korrektur', st.edit === 'Hermeier' && st.ok === 1 && st.shown === 'Hermeier' && /\bedited\b/.test(st.cls) && !/\blow\b/.test(st.cls) && !/\bchk\b/.test(st.cls), st);
chk('danach steht die nächste Stelle im Feld', b.pos === 'Unsichere Stelle 1 von 4' && b.val === 'AFD.' && b.chk === 'AFD.' && b.btn === 'Unsichere prüfen (6)', b);
// Bestätigen mit Enter
await key('Enter');
st = await ev(() => { const t = tokens.find(t => t.text === 'AFD.'); return { edit: P.edits[t.i] ?? null, ok: t.ok, cls: spans[t.i].className }; });
b = await bar();
chk('Enter ohne Änderung bestätigt das Wort: keine Korrektur, die Unterstreichung ist weg', st.edit === null && st.ok === 1 && !/\blow\b/.test(st.cls) && !/\bedited\b/.test(st.cls), st);
chk('zwei unsichere Wörter direkt nacheinander gelten als eine Stelle', b.pos === 'Unsichere Stelle 1 von 3' && b.val === 'weiter zu' && b.chk === 'weiter zu' && b.hint === 'Whisper war sich zu 38 % sicher', b);
// Überspringen, zurück, noch einmal anhören
await key('Tab'); b = await bar();
chk('Tab überspringt die Stelle, sie bleibt unsicher', b.pos === 'Unsichere Stelle 2 von 3' && b.val === 'Hermeyers' && /\blow\b/.test(await lowCls('weiter')), b);
await key('Shift+Tab'); b = await bar();
chk('Umschalt+Tab geht zurück', b.pos === 'Unsichere Stelle 1 von 3' && b.val === 'weiter zu', b);
await page.waitForFunction(() => !playing, null, { timeout: 8000 });
await key('ArrowDown');
chk('Pfeil nach unten spielt die Stelle noch einmal', await ev(() => playing && stopAt != null));
await key('Shift+Tab');
chk('vor der ersten Stelle geht es nicht weiter zurück', (await bar()).pos === 'Unsichere Stelle 1 von 3' && /erste Stelle/.test(await ev(() => document.querySelector('#toast').textContent)));
// Löschen
await key('Control+Delete');
st = await ev(() => ({ del: ['weiter', 'zu'].map(x => deleted.has(tokens.find(t => t.text === x).i)), kommen: deleted.has(tokens.find(t => t.text === 'kommen.').i) }));
b = await bar();
chk('Strg+Entf löscht die Wörter der Stelle', st.del.every(Boolean) && !st.kommen && b.pos === 'Unsichere Stelle 1 von 2' && b.val === 'Hermeyers', [st, b]);
// Mehrere Wörter zu einem: Der Text verteilt sich auf die Stelle
await key('Tab'); b = await bar();
chk('letzte Stelle: zwei Wörter, die zusammengehören', b.pos === 'Unsichere Stelle 2 von 2' && b.val === 'Her Meier', b);
await key('Tab');
chk('nach der letzten Stelle bleibt die Anzeige stehen und sagt es', (await bar()).pos === 'Unsichere Stelle 2 von 2' && /letzte Stelle/.test(await ev(() => document.querySelector('#toast').textContent)));
await page.fill('#lowIn', 'Hermeier'); await key('Enter');
st = await ev(() => { const a = tokens.find(t => t.text === 'Her'), z = tokens.find(t => t.text === 'Meier'); return { a: P.edits[a.i], z: P.edits[z.i], ok: [a.ok, z.ok] }; });
b = await bar();
chk('zwei Wörter werden zu einem korrigiert', [st.a, st.z].filter(Boolean).join('') === 'Hermeier' && st.ok.join() === '1,1' && (await words()).includes('Bundestag. Hermeier sagt dazu nichts.'), [st, await words()]);
chk('übrig ist die übersprungene Stelle', b.pos === 'Unsichere Stelle 1 von 1' && b.val === 'Hermeyers', b);
// Knöpfe
await page.click('#lowNext'); await page.click('#lowPrev'); await page.click('#lowPlay'); await sleep(200);
chk('die Knöpfe „Weiter“, „Zurück“ und „Nochmal“ tun dasselbe wie die Tasten', (await bar()).val === 'Hermeyers' && await ev(() => playing));
await page.click('#lowOk'); await sleep(350);
b = await bar();
chk('ist alles geprüft, schließt sich die Prüfleiste und der Knopf verschwindet', !b.shown && !b.on && await ev(() => document.querySelector('#lowBtn').classList.contains('hidden') && /Alle unsicheren Wörter sind geprüft/.test(document.querySelector('#toast').textContent) && !document.querySelector('#transcript .tk.chk')), b);
// Rückgängig
await ev(() => { pausePlay(); document.activeElement && document.activeElement.blur(); });
await page.click('#undoBtn'); await sleep(300);
st = await ev(() => ({ ok: tokens.find(t => t.text === 'Hermeyers').ok ?? null, cls: spans[tokens.find(t => t.text === 'Hermeyers').i].className, btn: document.querySelector('#lowBtn').textContent, hidden: document.querySelector('#lowBtn').classList.contains('hidden') }));
chk('Rückgängig nimmt die letzte Bestätigung zurück', st.ok === null && /\blow\b/.test(st.cls) && st.btn === 'Unsichere prüfen (1)' && !st.hidden, st);
for (let k = 0; k < 4; k++){ await page.click('#undoBtn'); await sleep(200); }
st = await ev(() => ({ n: lowStops().length, edits: Object.keys(P.edits).length, del: deleted.size, ok: tokens.filter(t => t.ok).length }));
chk('fünfmal Rückgängig: alles wie nach der Transkription', st.n === 5 && st.edits === 0 && st.del === 0 && st.ok === 0 && (await ev(() => snapshot())) === snapA, st);
// Taste P, Esc, Reiterwechsel
await key('p'); b = await bar();
chk('die Taste P beginnt das Prüfen', b.shown && b.val === 'Hermeyer', b);
await key('Escape'); b = await bar();
chk('Esc beendet es, das Wort bleibt unsicher', !b.shown && !b.on && /\blow\b/.test(await lowCls('Hermeyer')) && !(await ev(() => document.querySelector('#transcript .tk.chk'))), b);
await key('p'); await ev(() => setTab('subs')); await sleep(300);
chk('ein Reiterwechsel beendet das Prüfen', await ev(() => !LQ.on && document.querySelector('#lowBar').classList.contains('hidden')));
await ev(() => setTab('text')); await sleep(300);
// Bestätigt bleibt bestätigt: speichern, schließen, öffnen
await key('p'); await key('Enter'); await key('Escape');
const pid1 = await ev(() => { saveNow(); return P.id; });
await ev(i => { closeProject(); openProject(i); }, pid1); await sleep(700);
st = await ev(() => ({ ok: tokens.find(t => t.text === 'Hermeyer').ok, n: lowStops().length, btn: document.querySelector('#lowBtn').textContent, cls: spans[tokens.find(t => t.text === 'Hermeyer').i].className }));
chk('eine Bestätigung bleibt nach Speichern und erneutem Öffnen erhalten', st.ok === 1 && st.n === 4 && st.btn === 'Unsichere prüfen (6)' && !/\blow\b/.test(st.cls), st);
// Am Ton ausrichten behält sie
await ev(() => realign()); await sleep(500);
st = await ev(() => ({ ok: tokens.find(t => t.text === 'Hermeyer').ok, n: lowStops().length }));
chk('„Am Ton ausrichten“ behält die Bestätigung', st.ok === 1 && st.n === 4, st);

// ═════════ Eigenes Wörterbuch (C1) ═════════
await fresh();
await ev(() => setTab('trans')); await sleep(250);
chk('im Transkriptions-Reiter steht das Wörterbuch, noch leer', await ev(() => document.querySelector('#dictInfo').textContent) === 'noch leer');
await page.click('#dictBtn'); await sleep(300);
await page.fill('#dcTerm', 'Hermeier'); await page.fill('#dcWrong', 'Hermeyer, Her Meier'); await page.click('#dcAdd'); await sleep(150);
await page.fill('#dcTerm', 'AfD'); await page.keyboard.press('Enter'); await sleep(150);
await page.fill('#dcTerm', 'Linke'); await page.click('#dcAdd'); await sleep(150);
st = await ev(() => ({ dict: JSON.parse(localStorage.getItem('hc-dict')), rows: [...document.querySelectorAll('#dcList .dc-row')].map(r => r.querySelector('b').textContent + ' | ' + r.querySelector('span').textContent),
  info: document.querySelector('#dcInfo').textContent, run: document.querySelector('#dcRun').disabled, on: document.querySelector('#dcOn').checked, lead: document.querySelector('#sheetBody p').textContent }));
chk('Begriffe mit und ohne Fehlschreibungen lassen sich anlegen und liegen im Gerät', JSON.stringify(st.dict) === '[{"t":"Hermeier","w":["Hermeyer","Her Meier"]},{"t":"AfD","w":[]},{"t":"Linke","w":[]}]', st.dict);
chk('die Liste zeigt Begriff und Fehlschreibungen', st.rows.join(' / ') === 'Hermeier | ersetzt Hermeyer, Her Meier / AfD | nur als Hinweis / Linke | nur als Hinweis', st.rows);
chk('die Erklärung nennt den Hinweis an Whisper; das Blatt zählt die Stellen im Text', /als Hinweis an Whisper/.test(st.lead) && st.info === 'Im Text stehen 4 Stellen mit hinterlegter Fehlschreibung.' && !st.run && st.on, st);
await shot('woerterbuch');
// doppelt, bearbeiten, entfernen
await page.fill('#dcTerm', 'hermeier');
chk('ein vorhandener Begriff wird gespeichert, ein zweiter Eintrag entsteht dabei nie', await ev(() => document.querySelector('#dcAdd').textContent) === 'Speichern');
await page.fill('#dcTerm', '');
await ev(() => document.querySelector('#dcList [data-ed="2"]').click()); await sleep(100);
chk('Antippen lädt einen Eintrag zum Bearbeiten', await ev(() => document.querySelector('#dcTerm').value === 'Linke' && document.querySelector('#dcAdd').textContent === 'Speichern'));
await page.fill('#dcWrong', 'Lincke; Linke'); await page.click('#dcAdd'); await sleep(150);
chk('Speichern setzt die Fehlschreibungen neu; der Begriff selbst zählt nicht als Fehlschreibung', JSON.stringify(await ev(() => dict[2])) === '{"t":"Linke","w":["Lincke"]}', await ev(() => dict[2]));
await ev(() => document.querySelector('#dcList [data-del="2"]').click()); await sleep(100);
chk('ein Eintrag lässt sich entfernen', await ev(() => dict.length === 2 && JSON.parse(localStorage.getItem('hc-dict')).length === 2));
await page.click('#dcOk'); await sleep(200);
chk('der Transkriptions-Reiter zählt die Begriffe', await ev(() => document.querySelector('#dictInfo').textContent) === '2 Begriffe');
// „Jetzt im Text ersetzen“ auf ein schon transkribiertes Projekt
const snapB = await ev(() => snapshot());
await ev(() => setTab('text')); await sleep(200);
await ev(() => document.querySelector('#textMore').click()); await sleep(150);
chk('das Wörterbuch steht auch im Mehr-Menü des Text-Reiters', await ev(() => { const it = [...document.querySelectorAll('.menu button, #menu button, .ctx button')].find(x => /Eigenes Wörterbuch/.test(x.textContent)); if (it) it.click(); return !!it; }));
await sleep(300);
await page.click('#dcRun'); await sleep(300);
st = await ev(() => ({ info: document.querySelector('#dcInfo').textContent, run: document.querySelector('#dcRun').disabled, toast: document.querySelector('#toast').textContent, edits: Object.values(P.edits).sort().join('|') }));
chk('„Jetzt im Text ersetzen“ korrigiert alle vier Stellen', st.toast === '4 Stellen ersetzt' && st.run && /keine hinterlegte Fehlschreibung/.test(st.info) && st.edits === '|AfD.|Hermeier|Hermeier|Hermeiers', st);
await page.click('#dcOk'); await sleep(150);
const textB = await words();
chk('Name, Genitiv, zwei Wörter als eines und die Schreibweise mit Großbuchstaben im Wort stimmen; Satzzeichen bleiben', textB.includes('über Mareike Hermeier und die AfD. Ich') && textB.includes('Frau Hermeiers Antrag') && textB.includes('Bundestag. Hermeier sagt dazu nichts.'), textB);
st = await ev(() => ({ low: lowStops().map(s => s.map(i => tokText(tokens[i])).join(' ')), ed: spans[tokens.find(t => t.text === 'Hermeyer').i].className }));
chk('korrigierte Wörter gelten als geprüft: unsicher bleibt, was das Wörterbuch nicht kennt', JSON.stringify(st.low) === '["weiter zu"]' && /\bedited\b/.test(st.ed), st);
chk('die Untertitel zeigen die Korrektur', await ev(() => { const all = computedCues().map(c => c.text).join(' '); return all.includes('Hermeier') && all.includes('AfD') && !all.includes('Hermeyer') && !all.includes('AFD'); }));
await page.click('#undoBtn'); await sleep(250);
chk('ein Rückgängig nimmt das Ersetzen zurück', (await ev(() => snapshot())) === snapB);
// Was ersetzt wird
st = await ev(() => ({ linke: dictPats([{ t: 'Linke', w: [] }]).length, afd: dictPats([{ t: 'AfD', w: [] }]).map(p => p[0].join(' ')), cdu: dictPats([{ t: 'CDU', w: ['Zedeu'] }]).map(p => p[0].join(' ')), two: dictPats([{ t: 'Katrin Fey', w: ['Kathrin Fei'] }]).map(p => p[0].join(' ')) }));
chk('gewöhnlich geschriebene Begriffe ändern keine Groß- und Kleinschreibung im Text; Begriffe mit Großbuchstaben im Wort schon', st.linke === 0 && st.afd.join() === 'afd' && st.cdu.join() === 'cdu,zedeu' && st.two.join() === 'kathrin fei', st);
// Projektschalter
await ev(() => { P.settings.dict = false; });
chk('je Projekt abschaltbar: kein Hinweis, kein Ersetzen', await ev(() => dictHint() === '' && dictApply(0, null, true) === 0 && !dictOn()));
await ev(() => { delete P.settings.dict; });
// Transkription mit Wörterbuch: Hinweis an Whisper, danach ersetzt
try { fs.unlinkSync(path.join(WORK, 'hint.json')); } catch (_) {}
await fresh();
let h = hintFile();
chk('die Begriffe gehen als Hinweis an die Transkription', h && h.hint === 'Hermeier, AfD' && h.ranges === false && h.datei === 'anlauf.mp4', h);
st = await ev(() => ({ toast: document.querySelector('#toast').textContent, edits: Object.values(P.edits).sort().join('|'), low: lowStops().length, btn: document.querySelector('#lowBtn').textContent, undo: undo.length }));
chk('nach der Transkription sind die hinterlegten Fehlschreibungen ersetzt, die Meldung nennt die Zahl', /61 Wörter erkannt · 4 Stellen nach dem Wörterbuch korrigiert/.test(st.toast) && st.edits === '|AfD.|Hermeier|Hermeier|Hermeiers' && st.low === 1 && st.btn === 'Unsichere prüfen (2)', st);
chk('auch die frisch erzeugten Untertitel stimmen', await ev(() => { const all = computedCues().map(c => c.text).join(' '); return all.includes('Mareike Hermeier') && !all.includes('Hermeyer'); }));
// Korrektur merken: einzelnes Wort
await ev(() => { const sp = spans[tokens.find(t => t.text === 'Gewerkschaft').i]; sp.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); }); await sleep(300);
await page.fill('#wordEdit', 'Gewerkschaften'); await page.check('#wordDict'); await page.click('#wordOk'); await sleep(300);
st = await ev(() => ({ e: dictHas('Gewerkschaften'), toast: document.querySelector('#toast').textContent, edit: P.edits[tokens.find(t => t.text === 'Gewerkschaft').i], info: document.querySelector('#dictInfo').textContent }));
chk('„Künftig immer so schreiben“ legt beim Korrigieren eines Worts einen Eintrag an', st.e && st.e.w.join() === 'Gewerkschaft' && st.toast === 'Im Wörterbuch gemerkt' && st.edit === 'Gewerkschaften' && st.info === '3 Begriffe', st);
// Korrektur merken im Prüfmodus: gilt gleich im ganzen Text
await ev(() => { dict.length = 0; saveDict(); }); await fresh();
await key('p'); await page.fill('#lowIn', 'Hermeier'); await page.check('#lowDict'); await key('Enter');
st = await ev(() => ({ e: dict[0], toast: document.querySelector('#toast').textContent, gen: P.edits[tokens.find(t => t.text === 'Hermeyers').i] }));
b = await bar();
chk('im Prüfmodus gemerkt: Eintrag angelegt und die zweite Stelle im Text gleich mitkorrigiert', JSON.stringify(st.e) === '{"t":"Hermeier","w":["Hermeyer"]}' && st.toast === 'Im Wörterbuch gemerkt · eine weitere Stelle korrigiert' && st.gen === 'Hermeiers' && b.pos === 'Unsichere Stelle 1 von 3', [st, b]);
await key('Escape');
await page.click('#undoBtn'); await sleep(250);
chk('Rückgängig nimmt beide Korrekturen zurück; der Eintrag im Wörterbuch bleibt', await ev(() => Object.keys(P.edits).length === 0 && dict.length === 1));
// Kurzer Bereich
await ev(() => { const a = tokens.find(t => t.text === 'Her').i, z = tokens.find(t => t.text === 'Meier').i; selA = a; selB = z; showSel(); document.querySelector('#selEdit').click(); }); await sleep(300);
chk('beim Korrigieren weniger Wörter steht das Merken zur Wahl', await ev(() => !document.querySelector('#rangeDict').closest('label').classList.contains('hidden')));
await page.fill('#rangeEdit', 'Hermeier'); await page.check('#rangeDict'); await page.click('#rangeOk'); await sleep(300);
chk('aus zwei falsch gehörten Wörtern wird eine Fehlschreibung des Begriffs', JSON.stringify(await ev(() => dict[0])) === '{"t":"Hermeier","w":["Hermeyer","Her Meier"]}', await ev(() => dict[0]));
await ev(() => { selA = tokens.find(t => t.text === 'Viele').i; selB = tokens.find(t => t.text === 'kommen.').i; showSel(); document.querySelector('#selEdit').click(); }); await sleep(300);
chk('bei einem ganzen Satz fehlt die Wahl', await ev(() => document.querySelector('#rangeDict').closest('label').classList.contains('hidden')));
await ev(() => closeSheet()); await sleep(150);
// Sicherung und Platz im Hinweis
st = await ev(() => { const pr = uiPrefs(); dict.length = 0; saveDict(); const n = mergePrefs({ 'hc-dict': [{ t: 'Thoden', w: ['Toden'] }, { t: 'Fey', w: [] }, { t: '', w: ['x'] }, null] }); return { saved: pr['hc-dict'], n, dict: JSON.stringify(dict) }; });
chk('das Wörterbuch gehört zur Sicherung der Einstellungen und kommt beim Einspielen zurück', st.saved && st.saved[0].t === 'Hermeier' && st.n === 2 && st.dict === '[{"t":"Thoden","w":["Toden"]},{"t":"Fey","w":[]}]', st);
st = await ev(() => { for (let k = 0; k < 60; k++) dictAdd('Begriffnummer' + k, []); const l = dictHintList(); return { all: dict.length, sent: l.length, len: dictHint().length }; });
chk('der Hinweis an Whisper bleibt kurz: höchstens 400 Zeichen, die Begriffe in der Reihenfolge der Liste', st.all === 62 && st.sent < st.all && st.sent > 20 && st.len <= 400, st);
await ev(() => openDict()); await sleep(250);
chk('das Blatt sagt, wie viele Begriffe als Hinweis mitgehen', /Als Hinweis an Whisper gehen die ersten \d+ von 62 Begriffen; ersetzt wird mit allen\./.test(await ev(() => document.querySelector('#dcInfo').textContent)), await ev(() => document.querySelector('#dcInfo').textContent));
await ev(() => { closeSheet(); dict.length = 0; saveDict(); });

// ═════════ Prüfliste nach dem Aufräumen (A5) ═════════
await fresh();
chk('ohne automatischen Schnitt bleibt der Knopf „Prüfliste“ weg', await ev(() => document.querySelector('#checkBtn').classList.contains('hidden') && P.checks.length === 0));
await page.click('#fillerBtn'); await sleep(300);
st = await ev(() => ({ btn: document.querySelector('#checkBtn').textContent, hidden: document.querySelector('#checkBtn').classList.contains('hidden'), toast: document.querySelector('#toast').textContent,
  list: P.checks.map(c => c.k + ':' + c.ids.map(i => tokens[i].type === 'pause' ? '⏸' : tokText(tokens[i])).join('+')) }));
chk('„Füllwörter weg“ schreibt jeden Schnitt in die Prüfliste', !st.hidden && st.btn === 'Prüfliste (2)' && st.list.join(' / ') === 'f:Ähm / f:äh' && /2 Füllwörter entfernt · die Prüfliste zeigt jeden Schnitt/.test(st.toast), st);
await page.click('#checkBtn'); await sleep(350);
const rows = () => ev(() => [...document.querySelectorAll('#ckSheet .ck-row')].map(r => ({ t: r.querySelector('.ck-t').textContent.replace(/\s+/g, ' ').trim(), s: (r.querySelector('.ck-t s') || {}).textContent || '', b: (r.querySelector('.ck-t b') || {}).textContent || '',
  time: r.querySelector('.mono').textContent, acts: [...r.querySelectorAll('.ck-acts button')].map(x => x.textContent.trim()), cls: r.className })));
const tabs = () => ev(() => [...document.querySelectorAll('#ckSheet .ck-tabs button')].map(x => x.textContent + (x.classList.contains('on') ? '*' : '')));
let R = await rows();
chk('die Liste zeigt die Füllwörter mit Zeit und den Wörtern davor und danach', (await tabs()).join(' | ') === 'Füllwörter (2)* | Wiederholungen (0) | Pausen (0)' && R.length === 2 && R[0].s === 'Ähm' && R[0].t === 'die Mieten sprechen. Ähm das ist ein' && R[1].s === 'äh' && R[1].t === 'sprechen. das ist äh ein Problem. Die' && /^0:\d\d$/.test(R[0].time), R);
chk('je Schnitt: anhören, Original anhören, zurücknehmen', R[0].acts.join(' | ') === 'Schnitt | Original | Zurücknehmen', R[0].acts);
chk('die Liste bleibt offen, der Text daneben bedienbar', await ev(() => document.querySelector('#sheet').classList.contains('passive') && document.querySelector('#sheetBack').classList.contains('hidden')));
await shot('pruefliste');
// Original anhören: die Aufnahme rings um das Füllwort, die Vorschau bleibt stehen
const pos0 = await ev(() => outPos);
await ev(() => document.querySelector('#ckSheet .ck-row [data-a=orig]').click());
await page.waitForFunction(() => AUD.k === 0 && AUD.el && !AUD.el.paused && AUD.el.currentTime > 0, null, { timeout: 8000 });
st = await ev(() => { const t = tokens.find(t => t.text === 'Ähm'); return { cur: AUD.el.currentTime, a: wS(t) - 1.2, b: wE(t) + 1.2, playing, rowOn: document.querySelector('#ckSheet .ck-row').classList.contains('playing'), outPos }; });
chk('„Original“ spielt die Aufnahme ab gut einer Sekunde vor der Stelle, über ein eigenes Tonelement', st.cur >= st.a - 0.05 && st.cur < st.b && !st.playing && st.rowOn && st.outPos === pos0, st);
await page.waitForFunction(() => AUD.k < 0, null, { timeout: 12000 });
st = await ev(() => { const t = tokens.find(t => t.text === 'Ähm'); return { cur: AUD.el.currentTime, b: wE(t) + 1.2, paused: AUD.el.paused, rowOn: document.querySelector('#ckSheet .ck-row').classList.contains('playing'), heard: document.querySelector('#ckSheet .ck-row').classList.contains('heard') }; });
chk('sie hält gut eine Sekunde nach der Stelle an; die Zeile ist als gehört vermerkt', st.paused && Math.abs(st.cur - st.b) < 0.25 && !st.rowOn && st.heard, st);
// Schnitt anhören: die Vorschau spielt über den Schnitt
await ev(() => document.querySelector('#ckSheet .ck-row [data-a=cut]').click()); await sleep(250);
st = await ev(() => { const o = srcToOut(snapSrc(wS(tokens.find(t => t.text === 'Ähm')))); return { playing, stopAt, o, outPos }; });
chk('„Schnitt“ spielt die Vorschau von anderthalb Sekunden davor bis anderthalb danach', st.playing && Math.abs(st.stopAt - (st.o + 1.5)) < 0.05 && st.outPos >= st.o - 1.6 && st.outPos < st.o, st);
// Hörprobe und Vorschau schließen einander aus
await ev(() => document.querySelector('#ckSheet .ck-row [data-a=orig]').click()); await sleep(400);
chk('beginnt die Hörprobe, hält die Vorschau an', await ev(() => !playing && AUD.k === 0));
await ev(() => startPlay()); await sleep(200);
chk('beginnt die Vorschau, endet die Hörprobe', await ev(() => playing && AUD.k < 0 && AUD.el.paused));
await ev(() => pausePlay());
// Zurücknehmen und wieder schneiden
await ev(() => document.querySelector('#ckSheet .ck-row [data-a=tog]').click()); await sleep(300);
R = await rows();
st = await ev(() => ({ del: deleted.has(tokens.find(t => t.text === 'Ähm').i), fill: document.querySelector('#fillerBtn').textContent, n: P.checks.length }));
chk('„Zurücknehmen“ holt genau dieses Füllwort zurück; der Eintrag bleibt in der Liste', !st.del && st.fill === 'Füllwörter weg (1)' && st.n === 2 && /\bback\b/.test(R[0].cls) && R[0].b === 'Ähm' && R[0].acts.join(' | ') === 'Stelle | Wieder schneiden' && !/\bback\b/.test(R[1].cls), [st, R[0]]);
chk('im Text steht das Wort wieder', (await words()).includes('sprechen. Ähm das ist ein Problem.'));
await ev(() => document.querySelector('#ckSheet .ck-row [data-a=tog]').click()); await sleep(300);
R = await rows();
chk('„Wieder schneiden“ schneidet es erneut', await ev(() => deleted.has(tokens.find(t => t.text === 'Ähm').i)) && !/\bback\b/.test(R[0].cls) && R[0].acts[2] === 'Zurücknehmen', R[0]);
// Zur Stelle springen
await ev(() => document.querySelectorAll('#ckSheet .ck-row .ck-go')[1].click()); await sleep(300);
st = await ev(() => ({ outPos, o: srcToOut(snapSrc(wS(tokens.find(t => t.text === 'äh')))), open: !!document.querySelector('#ckSheet') }));
chk('ein Klick auf die Zeile springt zur Stelle, die Liste bleibt offen', Math.abs(st.outPos - st.o) < 0.05 && st.open, st);
// Rückgängig aus dem Hauptfenster: Die Liste folgt
await page.click('#undoBtn'); await sleep(300);
R = await rows();
chk('Rückgängig wirkt auch auf die offene Liste', /\bback\b/.test(R[0].cls) && R.length === 2, R.map(r => r.cls));
await page.click('#redoBtn'); await sleep(300);
// Pausen (die offene Liste liegt auf breiten Bildschirmen über dem rechten Teil der Werkzeugleiste: Knopf ohne Mauszeiger auslösen)
await ev(() => document.querySelector('#pauseBtn').click()); await sleep(350);
st = await ev(() => ({ tabs: [...document.querySelectorAll('#ckSheet .ck-tabs button')].map(x => x.textContent), nP: P.checks.filter(c => c.k === 'p').length, nPause: tokens.filter(t => t.type === 'pause').length, kept: tokens.filter(t => t.type === 'pause' && !deleted.has(t.i)).length, toast: document.querySelector('#toast').textContent }));
chk('„Pausen kürzen“ (ganz weg): jede gelöschte Pause steht in der Liste', st.nP === 11 && st.nPause === 11 && st.kept === 0 && st.tabs[2] === 'Pausen (11)' && /Pausen gelöscht · die Prüfliste zeigt jeden Schnitt/.test(st.toast), st);
await ev(() => document.querySelector('#ckSheet [data-tab=p]').click()); await sleep(250);
R = await rows();
const secs = R.map(r => parseFloat(r.s.replace('Pause ', '').replace(',', '.')));
chk('Pausen: die längsten stehen oben, mit Länge und den Wörtern davor und danach', R.length === 11 && secs.every((x, k) => !k || x <= secs[k - 1]) && secs[0] >= 1.3 && /^Pause \d,\d s$/.test(R[0].s) && R[0].t.includes(R[0].s) && await ev(() => /längsten Pausen stehen oben/.test(document.querySelector('#ckSheet').textContent)), R.map(r => r.t));
// Die Füllwort-Einträge sind um die mitgelöschte Nachbarpause nicht gewachsen
chk('Einträge der anderen Arten bleiben, wie sie waren', await ev(() => P.checks.filter(c => c.k === 'f').map(c => c.ids.length).join() === '1,1'));
// eine Pause zurücknehmen
const longest = await ev(() => { const r = document.querySelector('#ckSheet .ck-row'); const c = P.checks.find(x => x.id === r.dataset.id); r.querySelector('[data-a=tog]').click(); return c.ids[0]; }); await sleep(300);
chk('eine einzelne Pause kommt zurück', await ev(i => !deleted.has(i) && tokens[i].type === 'pause' && tokens.filter(t => t.type === 'pause' && !deleted.has(t.i)).length === 1, longest));
// Alle zurücknehmen
await ev(() => document.querySelector('#ckSheet [data-a=undoall]').click()); await sleep(300);
st = await ev(() => ({ kept: tokens.filter(t => t.type === 'pause' && !deleted.has(t.i)).length, n: P.checks.filter(c => c.k === 'p').length, back: [...document.querySelectorAll('#ckSheet .ck-row')].every(r => r.classList.contains('back')), btn: !!document.querySelector('#ckSheet [data-a=undoall]'), fill: deleted.has(tokens.find(t => t.text === 'äh').i) }));
chk('„Alle zurücknehmen“ gilt für die gezeigte Art: alle Pausen stehen wieder, die Füllwörter bleiben geschnitten', st.kept === 11 && st.n === 11 && st.back && !st.btn && st.fill, st);
// Liste leeren
await ev(() => document.querySelector('#ckSheet [data-a=clear]').click()); await sleep(250);
st = await ev(() => ({ n: P.checks.map(c => c.k).join(''), tabs: [...document.querySelectorAll('#ckSheet .ck-tabs button')].map(x => x.textContent + (x.classList.contains('on') ? '*' : '')).join(' | '), btn: document.querySelector('#checkBtn').textContent }));
chk('„Liste leeren“ entfernt die Einträge dieser Art; die Liste zeigt die nächste Art mit Einträgen', st.n === 'ff' && st.tabs === 'Füllwörter (2)* | Wiederholungen (0) | Pausen (0)' && st.btn === 'Prüfliste (2)', st);
// Pausen kürzen auf eine Länge
await ev(() => { document.querySelector('#pauseLen').value = '0.3'; document.querySelector('#pauseBtn').click(); }); await sleep(350);
await ev(() => document.querySelector('#ckSheet [data-tab=p]').click()); await sleep(250);
R = await rows();
st = await ev(() => ({ tr: P.checks.filter(c => c.k === 'p').map(c => c.tr[0]), trims: Object.keys(P.trims).length }));
chk('Pausen auf 0,3 s gekürzt: Die Liste nennt Länge vorher und danach', st.trims === 11 && st.tr.length === 11 && st.tr.every(x => x[1] === null && x[2] === 0.3) && /^Pause \d,\d s → 0,3 s$/.test(R[0].s), [st.tr[0], R[0]]);
const trI = await ev(() => { const r = document.querySelector('#ckSheet .ck-row'); const c = P.checks.find(x => x.id === r.dataset.id); r.querySelector('[data-a=tog]').click(); return c.tr[0][0]; }); await sleep(300);
chk('Zurücknehmen gibt der Pause ihre volle Länge zurück', await ev(i => P.trims[i] === undefined && Object.keys(P.trims).length === 10, trI));
await ev(() => document.querySelector('#ckSheet .ck-row [data-a=tog]').click()); await sleep(300);
chk('Wieder schneiden kürzt sie erneut', await ev(i => P.trims[i] === 0.3, trI));
await ev(() => closeSheet()); await sleep(200);
chk('beim Schließen der Liste endet eine laufende Hörprobe', await ev(() => AUD.k < 0));
// Speichern und Öffnen
const pid2 = await ev(() => { saveNow(); return P.id; });
const chk0 = await ev(() => JSON.stringify(P.checks));
await ev(i => { closeProject(); openProject(i); }, pid2); await sleep(700);
chk('die Prüfliste bleibt nach Speichern und erneutem Öffnen erhalten', await ev(c => JSON.stringify(P.checks) === c && P.checks.length === 13 && document.querySelector('#checkBtn').textContent === 'Prüfliste (13)', chk0));
// Rückgängig des Aufräumens nimmt auch die Einträge weg
await fresh();
const snapC2 = await ev(() => snapshot());
await page.click('#fillerBtn'); await sleep(250); await page.click('#undoBtn'); await sleep(250);
chk('Rückgängig nach „Füllwörter weg“: Schnitt und Einträge sind weg', await ev(s => snapshot() === s && P.checks.length === 0 && document.querySelector('#checkBtn').classList.contains('hidden'), snapC2));
await page.click('#redoBtn'); await sleep(250);
chk('Wiederholen bringt beides zurück', await ev(() => P.checks.length === 2 && !document.querySelector('#checkBtn').classList.contains('hidden')));
// Dieselbe Stelle noch einmal geschnitten: kein doppelter Eintrag
await ev(() => { const c = P.checks[0]; chkUndo(c); }); await sleep(200);
await page.click('#fillerBtn'); await sleep(250);
chk('wird eine zurückgenommene Stelle erneut geschnitten, ersetzt der neue Eintrag den alten', await ev(() => P.checks.length === 2 && P.checks.every(c => chkState(c) === 'cut')));
// Direkt nach der Transkription
await fresh({ autoFillers: true, autoRepeats: true, autoPauses: true });
st = await ev(() => ({ k: P.checks.map(c => c.k).sort().join(''), toast: document.querySelector('#toast').textContent, btn: document.querySelector('#checkBtn').textContent, cut: P.checks.every(c => chkState(c) === 'cut') }));
chk('Aufräumen direkt nach der Transkription füllt die Prüfliste', /^ff(p+)rr$/.test(st.k) && st.cut && /entfernt: 2 Füllwörter, 7 Wörter aus Wiederholungen, \d+ Pausen/.test(st.toast) && /^Prüfliste \(\d+\)$/.test(st.btn), st);
chk('im geschnittenen Text steht jeder Satz einmal', (await words()) === 'Heute spreche ich über Mareike Hermeyer und die AFD. ich wollte heute über die Mieten sprechen. das ist ein Problem. Die Regierung sagt aber etwas anderes. Viele Menschen wissen nicht mehr weiter zu kommen. Frau Hermeyers Antrag liegt im Bundestag. Her Meier sagt dazu nichts. Das zeigen die Zahlen der Gewerkschaft deutlich.', await words());
// Clip-Reiter: Pausen raus
await fresh();
await ev(() => { setTab('clip'); }); await sleep(400);
await ev(() => document.querySelector('#clipPauses').click()); await sleep(300);
chk('„Pausen raus“ im Clip-Reiter schreibt ebenfalls in die Prüfliste', await ev(() => P.checks.length === 11 && P.checks.every(c => c.k === 'p')));
await ev(() => setTab('text')); await sleep(300);

// ═════════ Fassungen vergleichen (C5) ═════════
await fresh();
const snapD = await ev(() => snapshot()), textD = await words();
await page.click('#repeatCmp'); await sleep(400);
const groups = () => ev(() => [...document.querySelectorAll('#ckSheet .ck-row.var')].map(r => ({ head: r.querySelector('.ck-t').textContent, note: (r.querySelector('.ck-note') || {}).textContent || '',
  vars: [...r.querySelectorAll('.ck-var')].map(v => v.querySelector('.ck-vt').textContent.replace(/\s+/g, ' ').trim() + (v.querySelector('input').checked ? ' ●' : '') + (v.classList.contains('kept') ? ' kept' : '')),
  acts: [...r.querySelectorAll('.ck-acts button')].map(x => x.textContent.trim()) })));
let G = await groups();
chk('„Fassungen vergleichen“ öffnet die Liste der Wiederholungen, ohne etwas zu schneiden', (await tabs()).join(' | ') === 'Füllwörter (0) | Wiederholungen (2)* | Pausen (0)' && (await ev(s => snapshot().replace(/,"ck":\[.*\]\}$/, '') === s.replace(/,"ck":\[.*\]\}$/, ''), snapD)) && (await words()) === textD, await tabs());
chk('ein abgebrochener Anlauf: beide Fassungen, die letzte mit dem Rest des Satzes zum Mitlesen', G[0].head === 'Anlauf in 2 Fassungen' && G[0].vars.join(' / ') === 'Ich wollte / ich wollte heute über die Mieten sprechen.' && /Alle Fassungen stehen im Schnitt/.test(G[0].note), G[0]);
chk('ein wiederholter Satz: beide Sätze als Fassungen', G[1].head === 'Satz in 2 Fassungen' && G[1].vars.join(' / ') === 'Die Regierung sagt etwas anderes. / Die Regierung sagt aber etwas anderes.', G[1]);
chk('solange nichts gewählt ist, ist keine Fassung angekreuzt', G.every(g => g.vars.every(v => !v.includes('●'))) && G[0].acts.join(' | ') === 'Nacheinander anhören', G[0].acts);
await shot('fassungen');
// Nacheinander anhören
await ev(() => document.querySelector('#ckSheet .ck-row.var [data-a=seq]').click());
await page.waitForFunction(() => AUD.k === 0 && AUD.el && !AUD.el.paused, null, { timeout: 8000 });
st = await ev(() => ({ cur: AUD.el.currentTime, a: wS(tokens.find(t => t.text === 'Ich')), on: [...document.querySelectorAll('#ckSheet .ck-row.var')[0].querySelectorAll('.ck-var')].map(v => v.classList.contains('playing')), n: AUD.list.length }));
chk('„Nacheinander anhören“ beginnt mit der ersten Fassung und zeigt, welche läuft', st.n === 2 && st.cur >= st.a - 0.2 && st.cur < st.a + 1 && st.on.join() === 'true,false', st);
await page.waitForFunction(() => AUD.k === 1 && !AUD.el.paused, null, { timeout: 8000 });
st = await ev(() => ({ cur: AUD.el.currentTime, a: wS(tokens.filter(t => t.text === 'ich')[1]), on: [...document.querySelectorAll('#ckSheet .ck-row.var')[0].querySelectorAll('.ck-var')].map(v => v.classList.contains('playing')) }));
chk('dann folgt die zweite', st.cur >= st.a - 0.2 && st.cur < st.a + 1.5 && st.on.join() === 'false,true', st);
await page.waitForFunction(() => AUD.k < 0, null, { timeout: 12000 });
st = await ev(() => ({ cur: AUD.el.currentTime, end: wE(tokens.find(t => t.text === 'sprechen.')), on: document.querySelectorAll('#ckSheet .ck-var.playing').length }));
chk('die letzte Fassung läuft bis zum Ende des Satzes', Math.abs(st.cur - (st.end + 0.2)) < 0.3 && st.on === 0, st);
// einzelne Fassung anhören
await ev(() => document.querySelectorAll('#ckSheet .ck-row.var')[1].querySelectorAll('.ck-var [data-a=var]')[0].click());
await page.waitForFunction(() => AUD.k === 0 && !AUD.el.paused, null, { timeout: 8000 });
st = await ev(() => ({ n: AUD.list.length, r: AUD.list[0], a: wS(tokens.find(t => t.text === 'Die')), e: wE(tokens.find(t => t.text === 'anderes.')) }));
chk('jede Fassung lässt sich einzeln anhören', st.n === 1 && Math.abs(st.r[0] - (st.a - 0.12)) < 0.01 && Math.abs(st.r[1] - (st.e + 0.2)) < 0.01, st);
await ev(() => audStop());
// Wählen: die letzte
const pick = async (g, j) => { await ev(([g, j]) => document.querySelectorAll('#ckSheet .ck-row.var')[g].querySelectorAll('.ck-var input')[j].click(), [g, j]); await sleep(350); };
await pick(0, 1);
G = await groups();
chk('die letzte Fassung gewählt: Der Anlauf fällt weg', (await words()).startsWith('Heute spreche ich über Mareike Hermeyer und die AFD. ich wollte heute über die Mieten sprechen. Ähm') && G[0].vars.join(' / ') === 'Ich wollte / ich wollte heute über die Mieten sprechen. ● kept' && G[0].note === '' && G[0].acts.join(' | ') === 'Nacheinander anhören | Alle behalten', [await words(), G[0]]);
st = await ev(() => { const a = tokens.find(t => t.text === 'wollte').i; return { pause: tokens[a + 1].type, del: deleted.has(a + 1), ids: P.checks.find(c => c.v && !c.s).ids.map(i => tokens[i].type === 'pause' ? '⏸' : tokens[i].text).join(' ') }; });
chk('die Pause nach dem Anlauf fällt mit weg und gehört zum Eintrag', st.pause === 'pause' && st.del && st.ids === 'Ich wollte ⏸', st);
// Wählen: die erste
await pick(0, 0);
G = await groups();
chk('die erste Fassung gewählt: Sie steht wieder, die wiederholten Wörter der letzten fallen weg, der Satz geht weiter', (await words()).startsWith('Heute spreche ich über Mareike Hermeyer und die AFD. Ich wollte heute über die Mieten sprechen. Ähm') && G[0].vars[0] === 'Ich wollte ● kept' && !G[0].vars[1].includes('kept'), [await words(), G[0]]);
st = await ev(() => { const w = tokens.filter(t => t.text === 'wollte'), i2 = tokens.filter(t => t.text === 'ich')[1].i; return { first: deleted.has(w[0].i), second: deleted.has(w[1].i), ich2: deleted.has(i2), pausesKept: tokens.filter(t => t.type === 'pause' && !deleted.has(t.i) && t.i > w[0].i && t.i < i2).length }; });
chk('geschnitten ist genau die andere Fassung', !st.first && st.second && st.ich2, st);
// Alle behalten
await ev(() => document.querySelector('#ckSheet .ck-row.var [data-a=tog]').click()); await sleep(300);
G = await groups();
chk('„Alle behalten“ stellt beide Fassungen wieder her', (await words()) === textD && /Alle Fassungen stehen im Schnitt/.test(G[0].note) && G[0].vars.every(v => !v.includes('●')), G[0]);
// Satz: die frühere Fassung behalten
await pick(1, 0);
G = await groups();
chk('beim wiederholten Satz die frühere Fassung gewählt: Der spätere Satz fällt ganz weg', (await words()).includes('Problem. Die Regierung sagt etwas anderes. Viele Menschen') && G[1].vars[0].endsWith('● kept'), [await words(), G[1]]);
await pick(1, 1);
chk('umgekehrt bleibt der spätere Satz', (await words()).includes('Problem. Die Regierung sagt aber etwas anderes. Viele Menschen'), await words());
// Rückgängig
await page.click('#undoBtn'); await sleep(300);
G = await groups();
chk('Rückgängig nimmt die letzte Wahl zurück, die Liste zeigt es', (await words()).includes('Problem. Die Regierung sagt etwas anderes. Viele Menschen') && G[1].vars[0].endsWith('● kept'), G[1]);
// „Wiederholungen weg“ nach dem Vergleichen: dieselben Einträge, jetzt geschnitten
await ev(() => closeSheet()); await fresh();
await page.click('#repeatCmp'); await sleep(300); await ev(() => closeSheet());
await page.click('#repeatBtn'); await sleep(350);
st = await ev(() => ({ n: P.checks.length, st: P.checks.map(c => chkState(c)).join(), kept: P.checks.map(c => chkKept(c).join()).join('|'), toast: document.querySelector('#toast').textContent }));
chk('„Wiederholungen weg“ lässt die letzte Fassung stehen und ersetzt die offenen Einträge', st.n === 2 && st.st === 'cut,cut' && st.kept === '1|1' && /7 Wörter aus wiederholten Anläufen gelöscht · in der Prüfliste lässt sich je Stelle die beste Fassung wählen/.test(st.toast), st);
await page.click('#checkBtn'); await sleep(300);
G = await groups();
chk('die Prüfliste zeigt danach, welche Fassung steht, und lässt umschalten', G.length === 2 && G[0].vars[1].endsWith('● kept') && G[1].vars[1].endsWith('● kept'), G);
await pick(1, 0);
chk('Umschalten nach dem Schneiden', (await words()).includes('Problem. Die Regierung sagt etwas anderes. Viele Menschen') && !(await words()).includes('aber'));
// Von Hand geändert: Die Liste folgt dem Schnitt
await ev(() => { const ids = tokens.filter(t => ['Die', 'Regierung', 'sagt', 'etwas', 'anderes.'].includes(t.text)).slice(0, 5).map(t => t.i); commit(() => bulkDelete(ids), false); tokens.forEach(t => paint(t.i)); chkChanged(); }); await sleep(250);
G = await groups();
chk('steht nach Änderungen von Hand keine Fassung mehr, sagt die Liste das', /Keine Fassung steht mehr im Schnitt/.test(G[1].note) && G[1].vars.every(v => !v.includes('●')), G[1]);
await page.click('#undoBtn'); await sleep(250);
// Ohne Wiederholungen
await ev(() => closeSheet());
await ev(() => { const f = repeatFinds(0); commit(() => bulkDelete(f.ids), false); P.checks = []; chkChanged(); }); await sleep(200);
await page.click('#repeatCmp'); await sleep(250);
chk('ohne wiederholte Anläufe bleibt die Liste zu und eine Meldung sagt es', await ev(() => !document.querySelector('#ckSheet') || document.querySelector('#sheet').classList.contains('hidden')) && /Keine wiederholten Anläufe gefunden/.test(await ev(() => document.querySelector('#toast').textContent)));

// ═════════ Handy-Ansicht ═════════
await ev(() => { pausePlay(); clearTimeout(saveT); saveNow(); closeProject(); });
const ph = await browser.newContext({ viewport: { width: 400, height: 820 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
const pp = await ph.newPage(); const plog = [];
pp.on('pageerror', e => plog.push('PAGEERROR: ' + (e.stack || e.message)));
pp.on('dialog', d => d.accept().catch(() => {}));
await pp.goto(page.url()); await pp.waitForFunction(() => typeof showHome === 'function');
await pp.evaluate(i => openProject(i), made[made.length - 1]); await pp.waitForFunction(() => typeof P !== 'undefined' && P && tokens.length > 0, null, { timeout: 30000 }); await sleep(500);
await pp.evaluate(() => { setTab('text'); commit(() => { deleted = new Set(); P.trims = {}; P.checks = []; }, true); renderTranscript(); }); await sleep(400);
await pp.evaluate(() => document.querySelector('#fillerBtn').click()); await sleep(250);
await pp.evaluate(() => document.querySelector('#repeatBtn').click()); await sleep(250);
await pp.evaluate(() => document.querySelector('#checkBtn').click()); await sleep(400);
let m = await pp.evaluate(() => { const s = document.querySelector('#sheet').getBoundingClientRect(), over = [...document.querySelectorAll('#ckSheet *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).length;
  return { w: document.documentElement.scrollWidth, iw: innerWidth, sheetW: s.width, sheetTop: s.top, over, rows: document.querySelectorAll('#ckSheet .ck-row').length }; });
chk('Handy: Die Prüfliste passt in die Breite, nichts ragt hinaus', m.w <= m.iw && m.over === 0 && m.rows >= 1 && m.sheetTop > 300, m);
await pp.screenshot({ path: path.join(OUT, 'transkript-handy-liste.png') });
await pp.evaluate(() => document.querySelector('#ckSheet [data-tab=r]').click()); await sleep(300);
await pp.screenshot({ path: path.join(OUT, 'transkript-handy-fassungen.png') });
m = await pp.evaluate(() => ({ over: [...document.querySelectorAll('#ckSheet *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).length, vars: document.querySelectorAll('#ckSheet .ck-var').length }));
chk('Handy: auch die Fassungen passen', m.over === 0 && m.vars === 4, m);
await pp.evaluate(() => { closeSheet(); document.querySelector('#lowBtn').click(); }); await sleep(500);
m = await pp.evaluate(() => { const b = document.querySelector('#lowBar').getBoundingClientRect(), over = [...document.querySelectorAll('#lowBar *')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > innerWidth + 1 || r.left < -1); }).length;
  return { shown: !document.querySelector('#lowBar').classList.contains('hidden'), w: document.documentElement.scrollWidth, iw: innerWidth, h: b.height, over, focus: document.activeElement && document.activeElement.id, val: document.querySelector('#lowIn').value }; });
chk('Handy: Die Prüfleiste passt in die Breite; das Feld holt die Tastatur erst beim Antippen', m.shown && m.w <= m.iw && m.over === 0 && m.h < 240 && m.focus !== 'lowIn' && m.val === 'Hermeyer', m);
await pp.screenshot({ path: path.join(OUT, 'transkript-handy-pruefen.png') });
await pp.evaluate(() => document.querySelector('#lowOk').click()); await sleep(350);
chk('Handy: „Stimmt“ bestätigt per Antippen', await pp.evaluate(() => tokens.find(t => t.text === 'Hermeyer').ok === 1 && document.querySelector('#lowIn').value === 'AFD.'));
await pp.evaluate(() => { lowEnd(); pausePlay(); clearTimeout(saveT); saveNow(); closeProject(); });
chk('Handy: keine Fehlermeldungen der Seite', plog.length === 0, plog.slice(0, 5));
await ph.close();

// ═════════ Aufräumen ═════════
await ev(ids => { for (const i of ids){ try { TS.deleteProject(i); if (TS.trashPurge) TS.trashPurge(i); } catch (_) {} } try { localStorage.removeItem('hc-dict'); } catch (_) {} }, made);
chk('keine Fehlermeldungen der Seite', logs.length === 0, logs.slice(0, 8));
await ende(browser);
