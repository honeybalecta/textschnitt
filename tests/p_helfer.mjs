// Kleine Helfer (2.27): Projektliste mit Suche, Reihenfolge, Vorschaubild und Duplizieren; weitere Sprachen; eigene Füllwörter;
// Satz und Absatz auswählen, „Nur das behalten“; Kapitel und Notizen; Lesbarkeit der Untertitel; eigene Looks; Längen-Ampel;
// Schutzzonen der Plattformen; dauerhafte Textzeile (auch im echten Export); Titelbild.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, scratch, dropScratch, setPick, sleep, ids as loadIds, pruefung, OUT, BASE } from './drv.mjs';
const PJ = loadIds();
const { chk, ende } = pruefung('Kleine Helfer');
const { browser, ctx, page, logs } = await launch();
await ctx.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
const ev = (f, a) => page.evaluate(f, a);
const toast = () => ev(() => document.querySelector('#toast').textContent);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const shot = name => page.screenshot({ path: path.join(OUT, `helfer-${name}.png`) });
// Lage eines Elements auf der Bühne als Anteile: Abstand links/rechts/oben/unten, Breite, Höhe
const onStage = sel => ev(sel => { const e = document.querySelector(sel), r = e.getBoundingClientRect(), s = document.querySelector('#stage').getBoundingClientRect();
  return { hidden: e.classList.contains('hidden'), l: (r.left - s.left) / s.width, r: (s.right - r.right) / s.width, t: (r.top - s.top) / s.height, b: (s.bottom - r.bottom) / s.height, w: r.width / s.width, h: r.height / s.height, sw: s.width, sh: s.height }; }, sel);
const drop = async id => { await ev(() => { if (typeof P !== 'undefined' && P){ pausePlay(); clearTimeout(saveT); } }); await dropScratch(page, id); };

// ═════════ A9 · Projektliste: Suche, Reihenfolge, Vorschaubild, Duplizieren ═════════
await sleep(400);
const home = await ev(() => ({ n: homeList.length, find: !document.querySelector('#homeFind').classList.contains('hidden'), names: homeList.map(p => p.name) }));
chk('Projektliste: Suchzeile erscheint ab fünf Projekten', home.n >= 5 && home.find, home.n);
await page.waitForFunction(() => { const ims = [...document.querySelectorAll('#projList .proj-item')].slice(0, 3).map(el => el.querySelector('.pthumb img')); return ims.length === 3 && ims.every(im => im && im.complete && im.naturalWidth > 0); }, null, { timeout: 30000 }).catch(() => {});
const th0 = await ev(() => [...document.querySelectorAll('#projList .proj-item')].slice(0, 3).map(el => { const im = el.querySelector('.pthumb img'); return im ? [im.naturalWidth, im.naturalHeight, im.src.slice(0, 5)] : null; }));
chk('Projektliste: jedes Projekt zeigt ein Vorschaubild aus dem Video', th0.length === 3 && th0.every(t => t && t[0] > 20 && t[1] > 20), th0);
await page.fill('#projFind', 'LANG');
let shown = await ev(() => [...document.querySelectorAll('#projList .proj-item b')].map(b => b.textContent));
chk('Suche filtert nach dem Namen, Groß- und Kleinschreibung egal', shown.length > 0 && shown.length < home.n && shown.every(n => /lang/i.test(n)) && shown.length === home.names.filter(n => /lang/i.test(n)).length, shown);
await page.fill('#projFind', 'wort bearbeitet');
shown = await ev(() => [...document.querySelectorAll('#projList .proj-item b')].map(b => b.textContent));
chk('mehrere Suchwörter müssen alle vorkommen, Reihenfolge egal', shown.length === 1 && shown[0] === 'lang bearbeitet (Wort)', shown);
await page.fill('#projFind', 'gibt es nicht');
const none = await ev(() => ({ items: document.querySelectorAll('#projList .proj-item').length, msg: (document.querySelector('#projList .home-none') || {}).textContent }));
chk('ohne Treffer steht ein Hinweis da', none.items === 0 && /Kein Projekt passt zu „gibt es nicht“/.test(none.msg || ''), none);
await page.press('#projFind', 'Escape');
chk('Esc leert die Suche', (await ev(() => document.querySelectorAll('#projList .proj-item').length)) === home.n);
await page.selectOption('#projSort', 'name');
shown = await ev(() => [...document.querySelectorAll('#projList .proj-item b')].map(b => b.textContent));
chk('Reihenfolge „Name A–Z“', JSON.stringify(shown) === JSON.stringify([...shown].sort((a, b) => a.localeCompare(b, 'de', { numeric: true, sensitivity: 'base' }))), shown);
await page.selectOption('#projSort', 'len');
const lens = await ev(() => [...document.querySelectorAll('#projList .proj-item')].map(el => homeList.find(p => p.id === el.dataset.id).duration));
chk('Reihenfolge „Längste zuerst“', lens.every((d, k) => !k || d <= lens[k - 1] + 1e-6), lens);
await page.reload(); await page.waitForFunction(() => typeof showHome === 'function' && typeof homeList !== 'undefined' && homeList.length > 0); await sleep(300);
chk('die gewählte Reihenfolge bleibt nach einem Neustart', (await ev(() => document.querySelector('#projSort').value)) === 'len');
await page.selectOption('#projSort', 'new');
// Duplizieren
await page.locator(`.proj-item[data-id="${PJ.kurz}"] .del.dup`).click(); await sleep(500);
const dup = await ev(id => { const o = JSON.parse(TS.loadProject(id)), c = homeList.find(p => p.name === o.name + ' (Kopie)'), d = c && JSON.parse(TS.loadProject(c.id));
  return c ? { id: c.id, same: d.tokens.length === o.tokens.length && JSON.stringify(d.deleted) === JSON.stringify(o.deleted) && JSON.stringify(d.cues) === JSON.stringify(o.cues) && d.sources[0].uri === o.sources[0].uri, other: c.id !== id, first: document.querySelector('#projList .proj-item b').textContent } : null; }, PJ.kurz);
chk('Duplizieren legt „… (Kopie)“ mit demselben Schnitt an und stellt sie nach oben', !!dup && dup.same && dup.other && dup.first === 'kurz (Kopie)' && /„kurz \(Kopie\)“ angelegt/.test(await toast()), dup);
await page.locator(`.proj-item[data-id="${PJ.kurz}"] .del.dup`).click(); await sleep(500);
const dup2 = await ev(() => homeList.filter(p => /^kurz \(Kopie/.test(p.name)).map(p => p.name).sort());
chk('die zweite Kopie heißt „… (Kopie 2)“', JSON.stringify(dup2) === JSON.stringify(['kurz (Kopie 2)', 'kurz (Kopie)']), dup2);
// Kopie öffnen, Bild merken, schließen: Das Vorschaubild ist jetzt das zuletzt gesehene Bild
if (dup){
  await page.locator(`.proj-item[data-id="${dup.id}"] .meta`).click();
  await page.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i && total > 0, dup.id, { timeout: 30000 });
  await ev(() => seekOut(5, false)); await page.waitForFunction(() => !V.seeking && V.readyState >= 2, null, { timeout: 15000 }).catch(() => {}); await sleep(400);
  await ev(() => closeProject()); await sleep(400);
  const th1 = await ev(id => ({ key: (localStorage.getItem('hc-thumb-' + id) || '').slice(0, 22), src: (document.querySelector(`.proj-item[data-id="${id}"] .pthumb img`) || {}).src || '' }), dup.id);
  chk('nach dem Schließen zeigt die Liste das zuletzt gesehene Bild', th1.key.startsWith('data:image/jpeg') && th1.src.startsWith('data:image/jpeg'), [th1.key, th1.src.slice(0, 22)]);
}
await shot('projektliste');
await ev(() => { for (const p of homeList.filter(p => /^kurz \(Kopie/.test(p.name))){ TS.deleteProject(p.id); if (TS.trashPurge) try { TS.trashPurge(p.id); } catch (_) {} } showHome(); }); await sleep(300);
chk('Vorschaubilder gelöschter Projekte werden aufgeräumt', dup ? (await ev(id => localStorage.getItem('hc-thumb-' + id), dup.id)) === null : false);

// ═════════ C8 · Weitere Sprachen ═════════
let sid = await scratch(page, PJ.lang);
const lang = await ev(() => { const sel = document.querySelector('#lang'); return { vals: [...sel.options].map(o => o.value), groups: [...sel.querySelectorAll('optgroup')].map(g => g.label),
  sent: [sentEnd('Wie geht es?'), sentEnd('كيف حالك؟'), sentEnd('یہ ٹھیک ہے۔'), sentEnd('und,')], val: sel.value }; });
chk('Sprachauswahl: Türkisch, Arabisch, Russisch, Polnisch und Ukrainisch stehen bereit', ['tr', 'ar', 'ru', 'pl', 'uk'].every(v => lang.vals.includes(v)) && lang.groups.length === 2, lang.groups);
chk('über vierzig Sprachen, keine doppelt', lang.vals.length > 40 && new Set(lang.vals).size === lang.vals.length, lang.vals.length);
chk('Satzenden werden auch in arabischer Schrift erkannt', JSON.stringify(lang.sent) === '[true,true,true,false]', lang.sent);
const lsel = await ev(() => { const a = (P.language = 'tr', syncLang(), document.querySelector('#lang').value), b = (P.language = 'xx', syncLang(), document.querySelector('#lang').value); P.language = 'de'; syncLang(); return [a, b]; });
chk('die Sprache des Projekts ist vorgewählt, eine unbekannte fällt auf Deutsch zurück', lsel[0] === 'tr' && lsel[1] === 'de', lsel);
const rtl = await ev(() => { const w = tokens.find(t => t.type === 'word' && !deleted.has(t.i)); P.edits ||= {}; P.edits[w.i] = 'مرحبا'; renderTranscript(); const d = spans[w.i].parentElement.dir, other = [...document.querySelectorAll('#transcript p')].filter(p => p.dir === 'rtl').length; delete P.edits[w.i]; renderTranscript(); return [d, other]; });
chk('ein Absatz in arabischer Schrift läuft von rechts nach links, die anderen bleiben', rtl[0] === 'rtl' && rtl[1] === 1, rtl);

// ═════════ C3 · Eigene Füllwörter ═════════
const num = async () => +(await ev(() => document.querySelector('#fillerBtn').textContent)).match(/\((\d+)\)/)[1];
// unabhängig gezählt: Wörter im Schnitt, die einem Eintrag entsprechen (auch Wendungen aus zwei Wörtern)
const count = list => ev(list => { const ws = tokens.filter(t => t.type === 'word'), nw = ws.map(t => norm(tokText(t))), hit = new Set();
  for (const f of list){ const parts = f.toLowerCase().split(' '); for (let k = 0; k + parts.length <= ws.length; k++) if (parts.every((p, j) => nw[k + j] === p && ws[k + j].src === ws[k].src)) parts.forEach((_, j) => hit.add(ws[k + j].i)); }
  ws.forEach((t, k) => { if (FILLER.test(nw[k])) hit.add(t.i); });
  return [...hit].filter(i => !deleted.has(i)).length; }, list);
const base = await num();
chk('Füllwörter: der Knopf zählt die Verzögerungslaute im Schnitt', base > 0 && base === await count([]), base);
// ein häufiges Wort und eine Wendung aus zwei aufeinanderfolgenden Wörtern, die im Text vorkommen
const pick = await ev(() => { const ws = tokens.filter(t => t.type === 'word' && !deleted.has(t.i)), nw = ws.map(t => norm(tokText(t))), cnt = {};
  nw.forEach(w => { if (w.length > 3 && !FILLER.test(w)) cnt[w] = (cnt[w] || 0) + 1; });
  const word = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
  let phrase = ''; for (let k = 0; k + 1 < ws.length && !phrase; k++) if (nw[k] && nw[k + 1] && nw[k] !== word && nw[k + 1] !== word && ws[k].src === ws[k + 1].src && !FILLER.test(nw[k]) && !FILLER.test(nw[k + 1])) phrase = nw[k] + ' ' + nw[k + 1];
  return { word, phrase }; });
await page.click('#fillerCfg'); await page.waitForSelector('#fwIn');
await page.fill('#fwIn', pick.word.toUpperCase()); await page.press('#fwIn', 'Enter'); await sleep(150);
const n1 = await num(), e1 = await count([pick.word]);
chk('ein eigenes Wort zählt sofort mit (Groß- und Kleinschreibung egal)', n1 === e1 && n1 > base, [pick.word, base, n1, e1]);
chk('eigene Füllwörter sind im Text gekennzeichnet', (await ev(w => tokens.filter(t => t.type === 'word' && norm(tokText(t)) === w).every(t => spans[t.i].classList.contains('filler')), pick.word)));
await page.fill('#fwIn', pick.word); await page.click('#fwAdd'); await sleep(100);
const t1 = await toast();
await page.fill('#fwIn', 'ähm'); await page.click('#fwAdd'); await sleep(100);
chk('doppelte Einträge und ohnehin entfernte Laute werden abgelehnt', t1 === 'Steht schon in der Liste' && (await toast()) === 'Das wird ohnehin entfernt' && (await ev(() => ownFill.length)) === 1, [t1, await toast()]);
await page.click('#fwSugg [data-add="halt"]'); await sleep(100);
chk('ein Vorschlag wandert per Klick in die Liste', (await ev(() => ownFill.includes('halt') && !document.querySelector('#fwSugg [data-add="halt"]'))));
await page.fill('#fwIn', pick.phrase); await page.click('#fwAdd'); await sleep(150);
const n2 = await num(), e2 = await count([pick.word, pick.phrase]);
chk('eine Wendung aus mehreren Wörtern gilt über aufeinanderfolgende Wörter', n2 === e2 && n2 > n1, [pick.phrase, n1, n2, e2]);
await shot('fuellwoerter');
await page.click('#fwOn'); await sleep(150);
const nOff = await num(), setOff = await ev(() => P.settings.ownFillers);
await page.click('#fwOn'); await sleep(150);
chk('„In diesem Projekt anwenden“ schaltet die eigene Liste für das Projekt ab und wieder an', nOff === base && setOff === false && (await num()) === n2 && (await ev(() => P.settings.ownFillers)) === true, [nOff, setOff]);
await page.click('#fwList .fw-chip:nth-child(2) button'); await sleep(100);
chk('ein Eintrag lässt sich entfernen, die Liste liegt im Gerät', (await ev(() => JSON.stringify(ownFill) === localStorage.getItem('hc-fillers') && !ownFill.includes('halt') && ownFill.length === 2)));
await page.click('#fwOk'); await sleep(150);
const totalBefore = await ev(() => total);
await page.click('#fillerBtn'); await sleep(400);
chk('„Füllwörter weg“ entfernt Laute und eigene Einträge', (await count([pick.word, pick.phrase])) === 0 && (await num()) === 0 && (await toast()) === `${n2} Füllwörter entfernt` && (await ev(() => total)) < totalBefore, await toast());
await page.keyboard.press('Control+z'); await sleep(400);
chk('Rückgängig holt sie zurück, der Zähler folgt', (await num()) === n2 && near(await ev(() => total), totalBefore, 0.001), await num());
await ev(() => { ownFill.length = 0; saveOwnFill(); paintFillers(); });

// ═════════ C4 · Satz und Absatz auswählen, „Nur das behalten“ ═════════
// ein Wort mitten in einem Satz von wenigstens vier Wörtern; erwartet wird unabhängig von der Oberfläche gerechnet
const sent = await ev(() => { const ws = order.map(i => tokens[i]).filter(t => t.type === 'word'), end = t => /[.?!…]$/.test(tokText(t));
  for (let k = 40; k < ws.length - 6; k++){ if (end(ws[k]) || end(ws[k - 1]) || deleted.has(ws[k].i)) continue;
    let a = k, b = k; while (a > 0 && !end(ws[a - 1]) && ws[a - 1].src === ws[k].src) a--; while (!end(ws[b]) && b < ws.length - 1) b++;
    if (b - a >= 3 && spans[ws[a].i].parentElement === spans[ws[b].i].parentElement) return { i: ws[k].i, words: ws.slice(a, b + 1).map(t => t.i), para: [...spans[ws[k].i].parentElement.querySelectorAll('.tk')].map(s => +s.dataset.i) }; }
  return null; });
await ev(i => { selA = selB = i; showSel(); }, sent.i); await sleep(100);
const lbl0 = await ev(() => document.querySelector('#selSent span').textContent);
await page.keyboard.press('a'); await sleep(250);
const s1 = await ev(() => ({ words: selIds().filter(i => tokens[i].type === 'word'), lbl: document.querySelector('#selSent span').textContent }));
chk('A weitet die Markierung auf den ganzen Satz aus', JSON.stringify(s1.words) === JSON.stringify(sent.words) && lbl0 === 'Satz' && s1.lbl === 'Absatz', [s1.words.length, sent.words.length, lbl0, s1.lbl]);
await page.click('#selSent'); await sleep(250);
const s2 = await ev(() => ({ ids: selIds(), dis: document.querySelector('#selSent').disabled }));
chk('ein zweites Mal wählt den Absatz, mehr geht nicht', JSON.stringify(s2.ids) === JSON.stringify(sent.para) && s2.dis, [s2.ids.length, sent.para.length, s2.dis]);
await shot('satz-absatz');
const keepW = await ev(() => selIds().filter(i => tokens[i].type === 'word' && !deleted.has(i)).length), totalAll = await ev(() => total);
await page.keyboard.press('Shift+Delete'); await sleep(500);
const only = await ev(() => ({ words: tokens.filter(t => t.type === 'word' && !deleted.has(t.i)).length, inSel: tokens.filter(t => t.type === 'word' && !deleted.has(t.i)).every(t => selIds().includes(t.i)), total, out: outPos }));
chk('Umschalt+Entf behält nur das Markierte', only.words === keepW && only.inSel && only.total < totalAll / 4 && only.total > 0.5 && only.out < 0.05 && /Nur die Markierung bleibt/.test(await toast()), only);
await page.keyboard.press('Control+z'); await sleep(400);
chk('Rückgängig stellt den Schnitt wieder her', near(await ev(() => total), totalAll, 0.001));
await ev(() => { clearSel(); seekOut(30, false); }); await sleep(300);
await page.keyboard.press('a'); await sleep(250);
const s3 = await ev(() => ({ n: selIds().length, has: selIds().includes(tokAtOut(outPos)) }));
chk('ohne Markierung wählt A den Satz an der Abspiellinie', s3.n > 1 && s3.has, s3);
await drop(sid);

// ═════════ A7 / A8 · Kapitel und Notizen ═════════
sid = await scratch(page, PJ.edit);
const words = () => ev(() => tokens.filter(t => t.type === 'word' && !deleted.has(t.i)).map(t => t.i));
const W = await words();
const sel = async (a, b) => { await ev(([a, b]) => { selA = a; selB = b ?? a; showSel(); }, [a, b]); await sleep(100); };
await sel(W[0]); await page.click('#selChap'); await page.waitForSelector('#mkIn');
const sug = await ev(() => ({ val: document.querySelector('#mkIn').value, at: document.querySelector('#mkAt').textContent, first: tokens.filter(t => t.type === 'word' && !deleted.has(t.i)).slice(0, 2).map(t => tokText(t)).join(' ') }));
chk('Kapitel: der Titel ist mit den ersten Wörtern der Stelle vorbelegt', sug.val.startsWith(sug.first) && /Beginnt bei 0:00/.test(sug.at), sug);
await page.fill('#mkIn', 'Worum es geht'); await page.click('#mkOk'); await sleep(300);
await sel(W[120]); await page.keyboard.press('c'); await page.waitForSelector('#mkIn'); await page.fill('#mkIn', 'Die Zahlen'); await page.keyboard.press('Enter'); await sleep(300);
const two = await ev(() => ({ rows: chapterText().split('\n'), iss: chapterIssues().join(' | '), heads: [...document.querySelectorAll('#transcript .chap-head b')].map(b => b.textContent), btn: document.querySelector('#marksBtn').textContent }));
chk('zwei Kapitel stehen als Überschriften im Text und als Zeitstempel bereit', two.rows.length === 2 && two.rows[0] === '0:00 Worum es geht' && /^\d:\d\d Die Zahlen$/.test(two.rows[1]) && JSON.stringify(two.heads) === '["Worum es geht","Die Zahlen"]' && two.btn === 'Marken (2)', two);
chk('Hinweis: YouTube zeigt Kapitel erst ab drei Einträgen', /erst ab drei Einträgen, bisher sind es zwei/.test(two.iss), two.iss);
await sel(W[300]); await page.keyboard.press('c'); await page.waitForSelector('#mkIn'); await page.fill('#mkIn', 'Was jetzt zu tun ist'); await page.keyboard.press('Enter'); await sleep(300);
chk('mit drei Kapiteln ab 0:00 gibt es keinen Hinweis mehr', (await ev(() => chapterIssues().length)) === 0 && (await ev(() => chapterRows().length)) === 3);
// Notizen: über die Auswahlleiste und mit B
await sel(W[200]); await page.keyboard.press('b'); await page.waitForSelector('#mkIn'); await page.fill('#mkIn', 'Quelle fehlt'); await page.click('#mkOk'); await sleep(300);
await sel(W[40]); await page.click('#selNote'); await page.waitForSelector('#mkIn'); await page.click('#mkOk'); await sleep(200);
const noText = await toast();
await page.click('#selNote'); await page.waitForSelector('#mkIn'); await page.fill('#mkIn', 'B-Roll einsetzen'); await page.click('#mkOk'); await sleep(300);
const marks = await ev(() => ({ list: P.marks.map(m => [m.k, m.text]), pins: document.querySelectorAll('#transcript .note-pin').length, scrub: document.querySelectorAll('#segs .mk.chap').length + '/' + document.querySelectorAll('#segs .mk.note').length, btn: document.querySelector('#marksBtn').textContent }));
chk('Notizen hängen als Zettel im Text, eine leere wird nicht angelegt', marks.list.length === 5 && marks.pins === 2 && noText === 'Ohne Text wird keine Notiz angeheftet' && marks.scrub === '3/2' && marks.btn === 'Marken (5)', [marks, noText]);
await ev(() => { clearSel(); document.querySelector('#transcript .chap-head').scrollIntoView({ block: 'start' }); }); await sleep(200); await shot('kapitel-im-text');
// Die Zeiten folgen dem Schnitt
const before = await ev(() => chapterRows().map(r => r[0]));
await sel(W[20], W[60]); const cutLen = await ev(() => { const t0 = total; document.querySelector('#selDel').click(); return t0 - total; }); await sleep(600);
const after = await ev(() => ({ rows: chapterRows().map(r => r[0]), heads: [...document.querySelectorAll('#transcript .chap-head .t')].map(x => x.textContent), exp: chapterText().split('\n').map(l => l.split(' ')[0]) }));
chk('nach einem Schnitt davor beginnen die späteren Kapitel entsprechend früher', cutLen > 3 && near(after.rows[0], 0, 0.001) && near(before[1] - after.rows[1], cutLen, 0.05) && near(before[2] - after.rows[2], cutLen, 0.05) && JSON.stringify(after.heads) === JSON.stringify(after.exp), [cutLen, before, after]);
await page.keyboard.press('Control+z'); await sleep(400); await ev(() => clearSel());
// Liste: springen, abhaken, erledigte entfernen
await page.click('#marksBtn'); await page.waitForSelector('#mkSheet .mk-row');
const rows = await ev(() => [...document.querySelectorAll('#mkSheet .mk-row')].map(r => r.querySelector('.mk-t').textContent));
chk('die Liste zeigt Kapitel und Notizen in der Reihenfolge des Videos', JSON.stringify(rows) === JSON.stringify(['Worum es geht', 'Die Zahlen', 'Was jetzt zu tun ist', 'B-Roll einsetzen', 'Quelle fehlt']), rows);
await page.click('#mkSheet .mk-row:nth-of-type(2) .mk-go'); await sleep(400);
chk('ein Klick springt zur Stelle, die Liste bleibt offen', near(await ev(() => outPos), before[1], 0.05) && (await ev(() => !!document.querySelector('#mkSheet'))), [await ev(() => outPos), before[1]]);
await page.click('#mkSheet .mk-row:has-text("B-Roll") input[type=checkbox]'); await sleep(300);
const done = await ev(() => ({ done: P.marks.filter(m => m.done).map(m => m.text), btn: document.querySelector('#marksBtn').textContent, h4: [...document.querySelectorAll('#mkSheet h4')].map(h => h.textContent), row: document.querySelector('#mkSheet .mk-row.done .mk-t').textContent, pin: document.querySelectorAll('#transcript .note-pin.done').length }));
chk('eine Notiz lässt sich abhaken: durchgestrichen, zählt nicht mehr als offen', JSON.stringify(done.done) === '["B-Roll einsetzen"]' && done.btn === 'Marken (4)' && done.h4[1] === 'Notizen · 1 offen' && done.row === 'B-Roll einsetzen' && done.pin === 1, done);
await shot('marken-liste');
await page.click('#mkSheet [data-a="clear"]'); await sleep(300);
chk('„Erledigte entfernen“ räumt die abgehakten weg', (await ev(() => P.marks.length === 4 && !P.marks.some(m => m.text === 'B-Roll einsetzen') && !document.querySelector('#mkSheet [data-a="clear"]'))));
await page.keyboard.press('Control+z'); await sleep(300); await page.keyboard.press('Control+z'); await sleep(300);
const un = await ev(() => P.marks.filter(m => m.k === 'note').map(m => [m.text, !!m.done]));
chk('Rückgängig bringt die Notiz zurück und macht das Abhaken ungeschehen', JSON.stringify(un) === '[["Quelle fehlt",false],["B-Roll einsetzen",false]]' && (await ev(() => document.querySelectorAll('#mkSheet .mk-row').length)) === 5, un);
await page.click('#mkSheet .mk-row:has-text("Quelle fehlt") [data-a="edit"]'); await page.waitForSelector('#mkIn');
await page.fill('#mkIn', 'Quelle nachtragen: Statistik'); await page.click('#mkOk'); await sleep(300);
chk('eine Notiz lässt sich bearbeiten', (await ev(() => P.marks.some(m => m.text === 'Quelle nachtragen: Statistik') && document.querySelector('#transcript .note-pin[title="Notiz: Quelle nachtragen: Statistik"]') !== null)));
await page.click('#mkSheet [data-a="ok"]'); await sleep(150);
// Export-Reiter: Zeitstempel, offene Notizen, Kopieren
await ev(() => setTab('export')); await sleep(400);
const ex = await ev(() => ({ text: document.querySelector('#chapText').textContent, notes: document.querySelector('#exNotes span').textContent, shown: !document.querySelector('#exNotes').classList.contains('hidden'), warn: document.querySelector('#chapWarn').classList.contains('hidden') }));
chk('Export-Reiter: Zeitstempel für die Beschreibung und Hinweis auf offene Notizen', ex.text === (await ev(() => chapterText())) && ex.text.split('\n').length === 3 && ex.notes === 'Noch 2 offene Notizen in diesem Projekt.' && ex.shown && ex.warn, ex);
await page.click('#chapCopy'); await sleep(300);
const clipTxt = await ev(() => navigator.clipboard.readText().catch(e => 'FEHLER ' + e.message));
chk('„Zeitstempel kopieren“ legt die Liste in die Zwischenablage', clipTxt === ex.text && /Zwischenablage/.test(await ev(() => document.querySelector('#chapMsg').textContent)), clipTxt);
await ev(() => document.querySelector('#chapCard').scrollIntoView({ block: 'center' })); await sleep(150); await shot('kapitel-export');
// Beginnt das erste Kapitel später, steht „0:00 Einstieg“ davor; ein zu kurzes Kapitel wird gemeldet
const late = await ev(([a, b]) => { const m = P.marks.find(x => x.text === 'Worum es geht'), m2 = P.marks.find(x => x.text === 'Die Zahlen'), at0 = m.at, at2 = m2.at;
  m.at = tokens[a].ws; m2.at = tokens[b].ws; const r = { rows: chapterText().split('\n'), iss: chapterIssues().join(' | ') }; m.at = at0; m2.at = at2; return r; }, [W[30], W[36]]);
chk('späterer Beginn: „0:00 Einstieg“ steht davor, mit Erklärung; zu kurze Kapitel werden genannt', late.rows[0] === '0:00 Einstieg' && late.rows.length === 4 && /beginnt mit „0:00 Einstieg“/.test(late.iss) && /Das Kapitel „Worum es geht“ ist kürzer als zehn Sekunden/.test(late.iss), late);
// Zeitskala im Studio
await ev(() => { setTab('studio'); seekOut(0, false); }); await sleep(700);
const flags = await ev(() => ({ chap: [...document.querySelectorAll('#ruler .rmk.chap span')].map(s => s.textContent), bar: !!document.querySelector('#barMarks'), tools: [...document.querySelectorAll('#paneStudio button')].map(b => b.textContent.trim()).filter(t => ['Kapitel', 'Notiz', 'Titelbild'].includes(t)) }));
chk('Zeitskala im Studio zeigt Fähnchen, Werkzeuge für Kapitel, Notiz und Titelbild sind da', flags.chap.includes('Worum es geht') && flags.bar && flags.tools.length >= 3, flags);
await shot('marken-studio');
// Stelle am Ende wegschneiden: Das Kapitel dort fällt aus der Liste
await ev(() => setTab('text')); await sleep(300);
const W2 = await words();
await sel(W2[W2.length - 6]); await page.keyboard.press('c'); await page.waitForSelector('#mkIn'); await page.fill('#mkIn', 'Schluss'); await page.keyboard.press('Enter'); await sleep(300);
await ev(i => { selA = i; selB = tokens.length - 1; showSel(); }, W2[W2.length - 6]); await ev(() => document.querySelector('#selDel').click()); await sleep(600);
const gone = await ev(() => ({ rows: chapterText().split('\n'), iss: chapterIssues().join(' | '), head: [...document.querySelectorAll('#transcript .chap-head')].map(h => [h.querySelector('b').textContent, h.querySelector('.t').textContent, h.classList.contains('cut')]).pop() }));
chk('ein Kapitel an einer weggeschnittenen Stelle am Ende fehlt in der Liste und ist im Text so bezeichnet', gone.rows.length === 3 && /Ein Kapitel liegt an einer weggeschnittenen Stelle/.test(gone.iss) && JSON.stringify(gone.head) === '["Schluss","weggeschnitten",true]', gone);
await page.keyboard.press('Control+z'); await sleep(300); await page.keyboard.press('Control+z'); await sleep(300); await ev(() => clearSel());
await ev(() => saveNow()); await sleep(300);
chk('Kapitel und Notizen sind im Projekt gespeichert', (await ev(() => JSON.parse(TS.loadProject(P.id)).marks.length)) === 5);

// ═════════ D7 · Lesbarkeit der Untertitel ═════════
await ev(() => setTab('subs')); await sleep(700);
const rd0 = await ev(() => { const l = computedCues(), q = readIssues(l); return { n: l.length, hard: q.filter(Boolean).length, kinds: q.filter(Boolean).map(x => x.short ? 'kurz' : x.fast ? 'schnell' : 'lang'), count: document.querySelector('#subCount').textContent, warn: document.querySelector('#subCount').classList.contains('warn'),
  marked: document.querySelectorAll('#cueList .cue.hard').length, why: [...document.querySelectorAll('#cueList .cue.hard .rd')].map(x => x.textContent), fix: document.querySelector('#readFix').textContent, fixShown: !document.querySelector('#readFix').classList.contains('hidden') }; });
chk('Untertitel-Reiter markiert schwer lesbare Untertitel und nennt den Grund', rd0.hard > 0 && rd0.kinds.every(k => k === 'kurz') && rd0.count === `${rd0.n} Untertitel · ${rd0.hard} schwer lesbar` && rd0.warn && rd0.marked === rd0.hard && rd0.why.every(w => /^Schwer lesbar: steht nur 0,\d s$/.test(w)) && rd0.fix === `Neu umbrechen (${rd0.hard})` && rd0.fixShown, rd0);
// zwei weitere Fälle von Hand: viel zu viel Text für die Zeit und ein überlanges Wort
const made = await ev(() => { const l = computedCues().filter(x => !readIssues([x])[0] && x.e - x.s > 1.2 && x.c.text == null && !x.c.own), a = l[3].c, b = l[9].c;
  commit(() => { a.text = 'Dieser Untertitel ist von Hand viel zu lang geraten und will einfach nicht aufhören zu reden'; b.text = 'Bundesverfassungsgerichtsentscheidungsbegründungen'; }, true);
  const l2 = computedCues(), q = readIssues(l2); return { a: q[l2.findIndex(x => x.c === a)], b: q[l2.findIndex(x => x.c === b)], hard: q.filter(Boolean).length }; });
await sleep(500);
chk('zu viel Text für die Zeit und überlange Zeilen werden erkannt', made.a && made.a.long && made.a.fast && /Zeichen in einer Zeile/.test(made.a.why[0]) && /Zeichen je Sekunde/.test(made.a.why[1]) && made.b && made.b.long && /^50 Zeichen in einer Zeile$/.test(made.b.why[0]) && made.hard === rd0.hard + 2, made);
const nBefore = await ev(() => computedCues().length);
await page.click('#readFix'); await sleep(900);
const rd1 = await ev(() => { const l = computedCues(), q = readIssues(l); return { n: l.length, hard: q.filter(Boolean).map(x => x.why.join(', ')), count: document.querySelector('#subCount').textContent, parts: l.filter(x => /von Hand viel zu lang|nicht aufhören zu reden/.test(x.text)).length, short: q.filter(x => x && x.short).length }; });
const t2 = await toast();
chk('„Neu umbrechen“ teilt den zu langen Untertitel und legt die zu kurzen mit dem Nachbarn zusammen', rd1.parts === 2 && rd1.short === 0 && /1 geteilt/.test(t2) && t2.includes(`${rd0.hard} zusammengelegt`) && rd1.n === nBefore + 1 - rd0.hard, [t2, rd1, nBefore]);
chk('was sich so nicht beheben lässt, bleibt markiert: zu viel Text für die Zeit, ein einzelnes überlanges Wort', rd1.hard.length === 3 && rd1.hard.filter(w => /Zeichen je Sekunde/.test(w)).length === 2 && rd1.hard.includes('50 Zeichen in einer Zeile') && /3 bleiben markiert/.test(t2) && rd1.count === `${rd1.n} Untertitel · 3 schwer lesbar`, rd1.hard);
await page.keyboard.press('Control+z'); await sleep(500);
chk('ein Rückgängig-Schritt nimmt das Umbrechen zurück', (await ev(() => computedCues().length)) === nBefore && (await ev(() => readIssues(computedCues()).filter(Boolean).length)) === made.hard);
await page.keyboard.press('Control+z'); await sleep(500);
// „Zeichen/Zeile“ in der Oberfläche von 32 auf 18: Die vorhandene Aufteilung passt nicht mehr, „Neu umbrechen“ teilt alle zu langen
await page.fill('#stChars', '18'); await page.press('#stChars', 'Tab'); await sleep(600);
const rd2 = await ev(() => { const l = computedCues(), q = readIssues(l); return { n: l.length, long: q.filter(x => x && x.long).length, hard: q.filter(Boolean).length, count: document.querySelector('#subCount').textContent, marked: document.querySelectorAll('#cueList .cue.hard').length }; });
chk('nach „Zeichen/Zeile 18“ sind die zu langen Zeilen sofort markiert', rd2.long > 10 && rd2.count === `${rd2.n} Untertitel · ${rd2.hard} schwer lesbar` && rd2.marked === rd2.hard, rd2);
await ev(() => document.querySelector('#readFix').scrollIntoView({ block: 'center' })); await sleep(150); await shot('lesbarkeit');
await page.click('#readFix'); await sleep(900);
const rd3 = await ev(() => { const l = computedCues(), q = readIssues(l); return { n: l.length, long: q.filter(x => x && x.long).length, rest: q.filter(Boolean).map(x => x.why.join(', ')), maxRow: Math.max(...l.map(x => Math.max(...wrapText(x.text).split('\n').map(r => r.length)))) }; });
chk('„Neu umbrechen“ teilt sie: keine Zeile ist mehr zu lang', rd3.long === 0 && rd3.n > rd2.n + rd2.long / 2 && rd3.maxRow <= 21 && rd3.rest.every(w => /steht nur/.test(w)), rd3);
await page.keyboard.press('Control+z'); await sleep(500);
await page.fill('#stChars', '32'); await page.press('#stChars', 'Tab'); await sleep(500);
chk('zurück auf 32 Zeichen und einen Schritt zurück ist alles wie vorher', (await ev(() => readIssues(computedCues()).filter(Boolean).length)) === rd0.hard && (await ev(() => computedCues().length)) === rd0.n);

// ═════════ D5 · Eigene Looks ═════════
const st0 = await ev(() => JSON.stringify(S()));
await ev(() => { commit(() => { const st = S(); st.color = '#EDE7DA'; st.size = 'groß'; st.bg = true; st.y = 0.8; st.pos = 'frei'; }, false); syncStyleInputs(); styleOverlay(); }); await sleep(200);
chk('ohne eigene Looks steht ein Hinweis da', (await ev(() => document.querySelector('#lookList').textContent)) === 'noch keine eigenen');
await page.click('#lookSave'); await page.waitForSelector('#nmIn'); await page.fill('#nmIn', 'Kampagne Miete'); await page.click('#nmOk'); await sleep(300);
const lk = await ev(() => ({ looks: subLooks.map(l => [l.name, l.st.color, l.st.size, l.st.bg, l.st.y]), stored: localStorage.getItem('hc-sub-looks') === JSON.stringify(subLooks), on: !!document.querySelector('#lookList .look-chip.on'), cur: S().look === 'own:' + subLooks[0].id }));
chk('„Als Look speichern“ legt den Stil unter einem Namen ab', JSON.stringify(lk.looks) === '[["Kampagne Miete","#EDE7DA","groß",true,0.8]]' && lk.stored && lk.on && lk.cur && /Look „Kampagne Miete“ gespeichert/.test(await toast()), lk);
await ev(() => { commit(() => { S().color = '#FFFFFF'; S().bg = false; }, false); syncStyleInputs(); styleOverlay(); renderLooks(); }); await sleep(150);
const off = await ev(() => !!document.querySelector('#lookList .look-chip.on'));
await page.click('#lookList .look-chip b'); await sleep(400);
const back = await ev(() => ({ on: !!document.querySelector('#lookList .look-chip.on'), color: S().color, bg: S().bg }));
chk('nach einer Änderung am Stil ist der Look nicht mehr gewählt; ein Klick stellt ihn wieder her', !off && back.on && back.color === '#EDE7DA' && back.bg === true && /Look „Kampagne Miete“ übernommen$/.test(await toast()), [off, back]);
await ev(() => document.querySelector('#lookRow').scrollIntoView({ block: 'center' })); await sleep(150); await shot('looks');
// Im Projektpaket auf Wunsch dabei; aus einem Paket oder einer Sicherung kommen nur neue dazu
const pkg = await ev(() => { const p = JSON.parse(TS.loadProject(P.id)); return { mit: (packageSpec(p, false, true).header.looks || []).map(l => l.name), ohne: packageSpec(p, false, false).header.looks === undefined,
  neu: mergeLooks([{ id: 'x1', name: 'Kampagne Miete', st: subLooks[0].st }, { id: 'x2', name: 'Ruhig', st: { ...subLooks[0].st, color: '#CFC6B0' } }, { name: '', st: {} }]), names: subLooks.map(l => l.name) }; });
chk('Looks reisen auf Wunsch im Projektpaket mit; beim Einlesen kommen nur neue dazu', JSON.stringify(pkg.mit) === '["Kampagne Miete"]' && pkg.ohne && pkg.neu === 1 && JSON.stringify(pkg.names) === '["Kampagne Miete","Ruhig"]', pkg);
await ev(st => { commit(() => { P.sub_style = JSON.parse(st); }, true); syncStyleInputs(); styleOverlay(); renderLooks(); }, st0);
await drop(sid);
// In einem anderen Projekt steht der Look bereit; weicht die Aufteilung ab, werden die Untertitel neu aufgeteilt
await ev(() => { const l = subLooks.find(x => x.name === 'Ruhig'); l.st.chars = 20; l.st.lines = 1; saveLooks(); });
sid = await scratch(page, PJ.kurz);
await ev(() => setTab('subs')); await sleep(600);
const cuesBefore = await ev(() => P.cues.length);
await page.click('#lookList .look-chip:has-text("Ruhig") b'); await sleep(600);
const ap = await ev(() => ({ chips: document.querySelectorAll('#lookList .look-chip').length, n: P.cues.length, st: [S().color, S().chars, S().lines, S().size], inputs: [document.querySelector('#stChars').value, document.querySelector('#stLines').value] }));
chk('in einem anderen Projekt übernommen: Stil und Aufteilung stimmen, die Untertitel sind neu aufgeteilt', ap.chips === 2 && ap.n > cuesBefore && JSON.stringify(ap.st) === '["#CFC6B0",20,1,"groß"]' && JSON.stringify(ap.inputs) === '["20","1"]' && /neu aufgeteilt/.test(await toast()), [ap, cuesBefore, await toast()]);
await ev(() => setTab('clip')); await sleep(500);
const own = await ev(() => [...document.querySelectorAll('#clipLooks [data-own]')].map(b => [b.querySelector('b').textContent, b.classList.contains('on')]));
chk('im Clip-Reiter stehen die eigenen Looks hinter den mitgelieferten', JSON.stringify(own) === '[["Kampagne Miete",false],["Ruhig",true]]', own);
await ev(() => setTab('subs')); await sleep(400);
await page.click('#lookList .look-chip:has-text("Ruhig") [data-del]'); await sleep(300);
chk('ein Look lässt sich löschen, das Projekt behält seinen Stil', (await ev(() => subLooks.length === 1 && S().color === '#CFC6B0' && document.querySelectorAll('#lookList .look-chip').length === 1)));
await ev(() => { subLooks.length = 0; saveLooks(); });
const wordMode = await ev(() => { const m = S().mode; S().mode = 'word'; const r = readIssues(computedCues()).filter(Boolean).length; S().mode = m; return r; });
chk('bei „1 Wort pro Untertitel“ gibt es keine Lesbarkeits-Warnungen', wordMode === 0);
await drop(sid);

// ═════════ Clip im Hochformat: Kapitel wandern mit, Längen-Ampel, Schutzzonen, Textzeile, Titelbild ═════════
sid = await scratch(page, PJ.edit);
await ev(() => { P.marks = [{ id: 'm1', k: 'chap', at: outToSrcT(4), text: 'Davor' }, { id: 'm2', k: 'chap', at: outToSrcT(40), text: 'Mittendrin' }, { id: 'm3', k: 'note', at: outToSrcT(120), text: 'Prüfen' }, { id: 'm4', k: 'chap', at: outToSrcT(220), text: 'Danach' }]; saveNow(); });
const landscape = await ev(() => { setTab('export'); return { len: document.querySelector('#exLen').classList.contains('hidden'), fits: safeFits() }; });
chk('Längen-Ampel: bei einem langen Video im Querformat bleibt sie weg', landscape.len && !landscape.fits);
await ev(() => setSafe('tiktok')); await sleep(200);
chk('Schutzzonen: im Querformat bleibt die Maske aus, ein Hinweis erklärt es', (await ev(() => document.querySelector('#safeOv').classList.contains('hidden'))) && /nur im Hochformat/.test(await toast()), await toast());
await ev(() => { setSafe(''); makeClip(10, 200, '9:16', 'Hochkant-Prüfung'); });
await page.waitForFunction(() => typeof P !== 'undefined' && P && P.name === 'Hochkant-Prüfung' && tab === 'clip' && total > 0, null, { timeout: 20000 }); await sleep(1200);
const cid = await ev(() => P.id);
const cm = await ev(() => ({ marks: (P.marks || []).map(m => m.text), outs: (P.marks || []).map(m => +markOut(m).toFixed(1)), total: +total.toFixed(1), dims: baseDims() }));
chk('ein Clip übernimmt nur die Kapitel und Notizen aus seinem Ausschnitt, an der richtigen Stelle', JSON.stringify(cm.marks) === '["Mittendrin","Prüfen"]' && near(cm.outs[0], 30, 0.2) && near(cm.outs[1], 110, 0.2) && near(cm.total, 190, 0.2) && cm.dims[1] > cm.dims[0], cm);
// F6 · Längen-Ampel
const lights = await ev(() => ({ chips: [...document.querySelectorAll('#clipLen .len-chip')].map(c => [c.dataset.k, c.className.replace('len-chip ', ''), c.textContent]), shown: !document.querySelector('#clipLen').classList.contains('hidden') }));
const over = Math.ceil((await ev(() => total)) - 180), mmss = v => `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;   // was zu viel ist, wird aufgerundet; was noch Platz hat, abgerundet
chk('Längen-Ampel im Clip-Reiter: 3:10 ist für Shorts zu lang, für Reels eingeschränkt, für TikTok in Ordnung', lights.shown && JSON.stringify(lights.chips.map(c => c.slice(0, 2))) === '[["shorts","over"],["reels","warn"],["tiktok","ok"]]' &&
  lights.chips[0][2] === `YouTube Shorts ${mmss(over)} zu lang – ab 3:00 wird daraus ein normales YouTube-Video` && lights.chips[1][2].startsWith(`Instagram Reels ${mmss(over)} über 3:00 – `) && lights.chips[2][2] === `TikTok passt, noch ${mmss(600 - 180 - over)} Platz bis 10:00`, lights.chips);
await shot('laengen-ampel');
const steps = await ev(() => { const t0 = total, out = {}; for (const t of [150, 181, 700, 1300, 3700]){ total = t; out[t] = lenLights().map(l => l.st).join(','); } total = t0; return out; });
chk('die Grenzen: Shorts 3:00; Reels 3:00 und 20:00; TikTok 10:00 und 60:00', JSON.stringify(steps) === JSON.stringify({ 150: 'ok,ok,ok', 181: 'over,warn,ok', 700: 'over,warn,warn', 1300: 'over,over,warn', 3700: 'over,over,over' }), steps);
// den Clip kürzen: Die Ampel folgt
await ev(() => { const o = total; commit(() => addDel(outToSrcT(60), outToSrcT(o - 0.01)), true); }); await sleep(500);
const lights2 = await ev(() => ({ chips: [...document.querySelectorAll('#clipLen .len-chip')].map(c => c.className.replace('len-chip ', '')), total: +total.toFixed(1), info: document.querySelector('#clipInfo').textContent }));
chk('nach dem Kürzen auf eine Minute stehen alle drei auf Grün', near(lights2.total, 60, 0.3) && JSON.stringify(lights2.chips) === '["ok","ok","ok"]', lights2);
await ev(() => setTab('export')); await sleep(300);
chk('der Export-Reiter zeigt dieselbe Ampel', (await ev(() => !document.querySelector('#exLen').classList.contains('hidden') && document.querySelectorAll('#exLen .len-chip.ok').length === 3)));
await ev(() => setTab('clip')); await sleep(400);

// B7 · Schutzzonen
const opts = await ev(() => ({ n: document.querySelector('#clipSafe').options.length, groups: [...document.querySelectorAll('#clipSafe optgroup')].map(g => g.label) }));
chk('Schutzzonen: Auswahl für Beiträge und für Anzeigen', opts.n === 9 && JSON.stringify(opts.groups) === '["Beiträge (Richtwerte)","Anzeigen (Vorgaben der Plattformen)"]', opts);
await page.selectOption('#clipSafe', 'tiktok'); await sleep(300);
const z1 = await ev(() => { const s = document.querySelector('#stage').getBoundingClientRect(), r = [...document.querySelectorAll('#safeOv i')].map(i => { const b = i.getBoundingClientRect(); return [(b.left - s.left) / s.width, (b.top - s.top) / s.height, b.width / s.width, b.height / s.height].map(v => +v.toFixed(3)); });
  return { r, lbl: document.querySelector('#safeOv b').textContent, set: P.settings.safe, other: document.querySelector('#safeSel').value, side: document.querySelector('#sideSafe').classList.contains('on'), hidden: document.querySelector('#safeOv').classList.contains('hidden') }; });
chk('TikTok: Maske oben 8 %, unten 21 %, an den Seiten 6 %, dazu die Knopfspalte rechts', !z1.hidden && z1.r.length === 5 && near(z1.r[0][3], 0.08, 0.004) && near(z1.r[1][3], 0.21, 0.004) && near(z1.r[1][1], 0.79, 0.004) && near(z1.r[2][2], 0.06, 0.004) && near(z1.r[3][2], 0.06, 0.004) && near(z1.r[4][0], 0.84, 0.004) && near(z1.r[4][2], 0.10, 0.004) && near(z1.r[4][1], 0.41, 0.004), z1.r);
chk('Beschriftung, Einstellung im Projekt, zweite Auswahl und Seitenknopf ziehen mit', z1.lbl === 'Bedienelemente · TikTok' && z1.set === 'tiktok' && z1.other === 'tiktok' && z1.side, z1);
// Untertitel in der gesperrten Fläche: gekennzeichnet; beim Ziehen rastet er in der freien Fläche ein
await ev(() => { commit(() => { S().y = 0.93; S().x = 0.5; S().pos = 'frei'; }, false); const c = computedCues()[2]; seekOut(c.s + 0.1, false); }); await sleep(500);
const u1 = await ev(() => ({ txt: document.querySelector('#subOv').textContent.length, unsafe: document.querySelector('#subOv').classList.contains('unsafe') }));
chk('ein Untertitel in der gesperrten Fläche ist gekennzeichnet', u1.txt > 0 && u1.unsafe, u1);
await shot('schutzzonen');
const sb = await page.locator('#subOv').boundingBox();
await page.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); await page.mouse.down(); await page.mouse.move(sb.x + sb.width / 2 + 2, sb.y + sb.height / 2 + 6, { steps: 3 }); await page.mouse.up(); await sleep(400);
const u2 = await ev(() => { const ov = document.querySelector('#subOv'), s = document.querySelector('#stage'); return { y: S().y, h: ov.offsetHeight / s.clientHeight, unsafe: ov.classList.contains('unsafe') }; });
chk('beim Ziehen rastet er oberhalb der unteren Zone ein', near(u2.y, 1 - 0.21 - u2.h / 2, 0.006) && !u2.unsafe, u2);
// Rechnung dahinter: Rand, Knopfspalte, zu breite Kästen
const cl = await ev(() => [safeClamp(0.5, 0.02, 0.4, 0.06), safeClamp(0.9, 0.6, 0.3, 0.06), safeClamp(0.5, 0.5, 0.95, 0.06), safeClamp(0.3, 0.3, 0.3, 0.06)].map(p => p.map(v => +v.toFixed(3))));
chk('Einrasten: oben an den Rand, aus der Knopfspalte heraus; zu Breites bleibt mittig stehen, Freies unverändert', JSON.stringify(cl[0]) === '[0.5,0.11]' && JSON.stringify(cl[1]) === '[0.69,0.6]' && JSON.stringify(cl[2]) === '[0.5,0.5]' && JSON.stringify(cl[3]) === '[0.3,0.3]', cl);
// Titel
await ev(() => { commit(() => P.items.push({ id: 'tt1', type: 'title', at: outToSrcT(Math.max(0, outPos - 0.3)), dur: 4, text: 'Ein Titel', x: 0.5, y: 0.97, size: 'mittel', color: '#FFFFFF', outline: true }), true); updateTitles(outPos); }); await sleep(400);
chk('auch ein Titel in der gesperrten Fläche ist gekennzeichnet', (await ev(() => { const t = document.querySelector('#titleOv .titlebox'); return !!t && t.classList.contains('unsafe'); })));
await ev(() => { commit(() => { P.items = P.items.filter(x => x.id !== 'tt1'); }, true); updateTitles(outPos); });
await page.selectOption('#clipSafe', 'all:ad'); await sleep(300);
const z2 = await ev(() => ({ z: safeZone(), lbl: document.querySelector('#safeOv b').textContent }));
chk('„alle drei“ für Anzeigen nimmt je Seite die größte Vorgabe', JSON.stringify(z2.z) === JSON.stringify({ t: 0.15, b: 0.35, l: 0.111, r: 0.178, cw: 0.278, cy: 0.4375 }) && z2.lbl === 'Bedienelemente · alle drei · Anzeige', z2);
await page.click('#sideSafe'); await sleep(200);
const offS = await ev(() => [P.settings.safe, document.querySelector('#safeOv').classList.contains('hidden'), document.querySelector('#clipSafe').value]);
await page.click('#sideSafe'); await sleep(200);
chk('der Seitenknopf schaltet aus und holt die letzte Wahl zurück', JSON.stringify(offS) === '["",true,""]' && (await ev(() => P.settings.safe)) === 'all:ad', offS);
await page.selectOption('#clipSafe', 'tiktok'); await sleep(200);

// B9 · Dauerhafte Textzeile
const LINE = '@kanal · V. i. S. d. P.: Vorname Nachname';
await page.click('#clipTline'); await page.waitForSelector('#tlText'); await page.fill('#tlText', LINE); await sleep(250);
let tl = await onStage('#tline');
const asp = tl.sw / tl.sh;
chk('Textzeile: steht unten links und rückt bei eingeschalteten Schutzzonen in die freie Fläche', !tl.hidden && near(tl.l, 0.06, 0.006) && near(tl.b, 0.21, 0.006) && (await ev(() => !document.querySelector('#tlSafeRow').classList.contains('hidden') && document.querySelector('#tlSafe').checked)), tl);
await page.click('#tlSafe'); await sleep(200); tl = await onStage('#tline');
chk('ohne den Haken sitzt sie mit dem eingestellten Abstand am Bildrand', near(tl.l, 0.035, 0.006) && near(tl.b, 0.035 * asp, 0.006), tl);
await page.click('#tlSafe');
await page.click('#tlPos [data-p="ur"]'); await sleep(200); tl = await onStage('#tline');
chk('unten rechts weicht sie der Knopfspalte aus', near(tl.r, 0.16, 0.006) && near(tl.b, 0.21, 0.006), tl);
await page.click('#tlPos [data-p="or"]'); await page.click('#tlBg'); await sleep(200); tl = await onStage('#tline');
const tlBg = await ev(() => ({ bg: document.querySelector('#tline').classList.contains('bg'), olDis: document.querySelector('#tlOutline').disabled, shadow: document.querySelector('#tline').style.textShadow }));
chk('oben rechts mit dunklem Kasten: Abstand zur Zone, Umrandung entfällt', near(tl.r, 0.06, 0.006) && near(tl.t, 0.08, 0.006) && tlBg.bg && tlBg.olDis && tlBg.shadow === 'none', [tl, tlBg]);
await shot('textzeile');
// Größe und zu langer Text: Die Zeile bleibt einzeilig und passt zwischen die Ränder
const fs0 = await ev(() => parseFloat(document.querySelector('#tline').style.fontSize));
await ev(() => { const s = document.querySelector('#tlSize'); s.value = '0.06'; s.dispatchEvent(new Event('input', { bubbles: true })); }); await sleep(200);
await page.fill('#tlText', 'Eine sehr lange Zeile mit Kanalname, Kampagne und Verantwortlichen im Sinne'); await sleep(250);
tl = await onStage('#tline');
const fit = await ev(() => { const [W, H] = baseDims(), c = tlineCue(W, H); return { size: c.size, set: P.textline.size, fs: parseFloat(document.querySelector('#tline').style.fontSize), rows: Math.round(document.querySelector('#tline').offsetHeight / (parseFloat(document.querySelector('#tline').style.fontSize) * 1.12)) }; });
chk('zu langer Text wird so weit verkleinert, dass er einzeilig zwischen die Ränder passt', fit.set === 0.06 && fit.size < 0.06 && fit.fs < fs0 * 0.06 / 0.028 && tl.w <= 0.9 && tl.l >= 0.05 && near(tl.r, 0.06, 0.006) && fit.rows === 1, [fit, tl]);
await page.fill('#tlText', LINE); await ev(() => { const s = document.querySelector('#tlSize'); s.value = '0.028'; s.dispatchEvent(new Event('input', { bubbles: true })); });
await page.click('#tlOk'); await sleep(300);
const plan1 = await ev(() => { const p = buildPlan(), l = p.subs.cues.filter(c => c.line); return { n: l.length, c: l[0], total: +total.toFixed(3), sum: document.querySelector('#exSummary') ? (renderExport(), document.querySelector('#exSummary').textContent) : '' }; });
chk('im Exportplan steht sie als ein Titel über die ganze Länge, mit Ecke und Randabstand', plan1.n === 1 && plan1.c.start === 0 && near(plan1.c.end, plan1.total, 0.002) && plan1.c.title === true && plan1.c.text === LINE && plan1.c.anchor === 'or' && plan1.c.bg === true && plan1.c.outline === false && near(plan1.c.mx, 0.06, 0.001) && near(plan1.c.my, 0.08, 0.001) && plan1.c.x > 0.5 && plan1.c.y < 0.12 && / · Textzeile/.test(plan1.sum), plan1);
await page.keyboard.press('Control+z'); await sleep(400);
const un1 = await ev(() => [P.textline === undefined, document.querySelector('#tline').classList.contains('hidden')]);
await page.keyboard.press('Control+y'); await sleep(400);
chk('das Anlegen ist ein Rückgängig-Schritt; Wiederholen bringt die Zeile zurück', JSON.stringify(un1) === '[true,true]' && (await ev(t => P.textline && P.textline.text === t && !document.querySelector('#tline').classList.contains('hidden'), LINE)), un1);
await page.click('#clipTline'); await page.waitForSelector('#tlOn'); await page.click('#tlOn'); await sleep(200);
const hid = await ev(() => [document.querySelector('#tline').classList.contains('hidden'), buildPlan().subs.cues.filter(c => c.line).length]);
await page.click('#tlOn'); await page.click('#tlOk'); await sleep(200);
chk('„Anzeigen“ blendet sie aus, ohne sie zu löschen', JSON.stringify(hid) === '[true,0]' && (await ev(() => !document.querySelector('#tline').classList.contains('hidden'))), hid);
await ev(() => setTab('studio')); await sleep(500);
await page.click('#barClip'); await page.waitForSelector('#sheetBody [data-t="tline"]');
await page.click('#sheetBody [data-t="tline"]'); await sleep(300);
chk('im Studio führt „Clip einfügen“ → „Textzeile“ zum selben Blatt', (await ev(t => (document.querySelector('#tlText') || {}).value === t, LINE)));
await ev(() => { closeSheet(); setTab('clip'); }); await sleep(400);

// A6 · Titelbild
const png = path.join(OUT, 'helfer-bild.png'), png2 = path.join(OUT, 'helfer-bild-titel.png'), jpg = path.join(OUT, 'helfer-bild.jpg');
for (const f of [png, png2, jpg]) fs.rmSync(f, { force: true });
await ev(() => { const c = computedCues()[4]; seekOut(c.s + 0.1, false); }); await page.waitForFunction(() => !V.seeking && V.readyState >= 2, null, { timeout: 15000 }).catch(() => {}); await sleep(500);
await page.click('#clipCover'); await page.waitForSelector('#cvPrev');
// warten, bis die Vorschau gezeichnet ist (ein schwarzes Bild ergibt als JPG nur wenige Bytes)
await page.waitForFunction(() => { const c = document.querySelector('#cvPrev'), b = document.createElement('canvas'); b.width = c.width; b.height = c.height; b.getContext('2d').fillRect(0, 0, b.width, b.height);
  return c.toDataURL('image/jpeg', 0.4).length > b.toDataURL('image/jpeg', 0.4).length * 2; }, null, { timeout: 20000 }).catch(() => {});
await sleep(300);
const pv = await ev(() => { const c = document.querySelector('#cvPrev'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let lit = 0; for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 60) lit++; return { w: c.width, h: c.height, lit: lit / (d.length / 16), def: [document.querySelector('#cvPos').value, document.querySelector('#cvTitles').checked, document.querySelector('#cvSubs').checked, document.querySelector('#cvFmt').value] }; });
chk('Titelbild: die Vorschau zeigt das Bild an der Abspiellinie im Format des Videos', pv.h > pv.w && pv.lit > 0.8 && JSON.stringify(pv.def) === '["mitte",true,false,"png"]', pv);
const dims = f => { const b = fs.readFileSync(f); return b.subarray(1, 4).toString() === 'PNG' ? [b.readUInt32BE(16), b.readUInt32BE(20)] : null; };
const save = async file => { setPick({ save_any: file }); await page.click('#cvSave'); await page.waitForFunction(() => /^(Gespeichert|Nicht gespeichert|Das Bild ließ)/.test(document.querySelector('#cvMsg').textContent), null, { timeout: 20000 }); const m = await ev(() => document.querySelector('#cvMsg').textContent); await ev(() => { document.querySelector('#cvMsg').textContent = ''; }); return m; };
const m1 = await save(png), want = await ev(() => baseDims().map(v => Math.round(v / 2) * 2));
chk('„Speichern“ schreibt ein PNG in der Größe des Videos', /^Gespeichert: /.test(m1) && fs.existsSync(png) && JSON.stringify(dims(png)) === JSON.stringify(want), [m1, want]);
// Titelzeile im Design der Folien: Kasten in der Hintergrundfarbe, Balken in der Akzentfarbe, hervorgehobene Wörter in der Akzentfarbe
await page.selectOption('#cvPos', 'oben'); await page.fill('#cvText', 'Wer zahlt die *Miete*?'); await sleep(900);
const tb = await ev(async () => { const [bw, bh] = baseDims(), W = Math.round(bw / 2) * 2, H = Math.round(bh / 2) * 2, cv = document.createElement('canvas'); cv.width = W; cv.height = H; cv.getContext('2d', { willReadFrequently: true });
  await coverRender(cv, { text: 'Wer zahlt die *Miete*?', pos: 'oben', titles: true, subs: false });
  const ctx = cv.getContext('2d'), u = Math.min(W, H) / 100, C = slColors(slProfile(), true), px = (x, y) => [...ctx.getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3), hex = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
  const d = ctx.getImageData(0, 0, W, H).data, acc = hex(C.acc); let accN = 0; for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - acc[0]) + Math.abs(d[i + 1] - acc[1]) + Math.abs(d[i + 2] - acc[2]) < 40) accN++;
  return { bar: px(5 * u + 0.6 * u, 16 * u + 4 * u), acc, box: px(5 * u + 2.4 * u, 16 * u + 0.8 * u), bg: hex(C.bg), accShare: accN / (W * H) }; });
const col = (a, b, tol) => a.every((v, k) => Math.abs(v - b[k]) <= tol);
chk('Titelzeile: Balken und hervorgehobenes Wort in der Akzentfarbe, Kasten in der Hintergrundfarbe der Folien', col(tb.bar, tb.acc, 12) && col(tb.box, tb.bg, 40) && tb.accShare > 0.004, tb);
const m2 = await save(png2);
chk('mit Titelzeile entsteht ein anderes Bild in derselben Größe', fs.existsSync(png2) && JSON.stringify(dims(png2)) === JSON.stringify(want) && !fs.readFileSync(png).equals(fs.readFileSync(png2)), m2);
await shot('titelbild');
// Untertitel auf Wunsch
const subDiff = await ev(async () => { const [bw, bh] = baseDims(), mk = () => { const c = document.createElement('canvas'); c.width = Math.round(bw / 2) * 2; c.height = Math.round(bh / 2) * 2; c.getContext('2d', { willReadFrequently: true }); return c; }, a = mk(), b = mk();
  await coverRender(a, { text: '', pos: 'oben', titles: true, subs: false }); await coverRender(b, { text: '', pos: 'oben', titles: true, subs: true });
  const da = a.getContext('2d').getImageData(0, 0, a.width, a.height).data, db = b.getContext('2d').getImageData(0, 0, b.width, b.height).data; let n = 0, top = 0;
  for (let i = 0; i < da.length; i += 4) if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]){ n++; if (i / 4 / a.width < a.height * 0.5) top++; }
  return { n, top, shown: document.querySelector('#subOv').textContent.length }; });
chk('„Untertitel“ nimmt den gerade sichtbaren Untertitel mit ins Bild (untere Bildhälfte)', subDiff.shown > 0 && subDiff.n > 200 && subDiff.top === 0, subDiff);
await page.selectOption('#cvFmt', 'jpg'); const m3 = await save(jpg);
chk('als JPG gespeichert', fs.existsSync(jpg) && fs.readFileSync(jpg).subarray(0, 2).toString('hex') === 'ffd8' && /\.jpg · /.test(m3), m3);
await page.click('#cvNo'); await sleep(200);
await page.click('#clipCover'); await page.waitForSelector('#cvText');
chk('Titelzeile und Format sind beim nächsten Öffnen noch da', (await ev(() => [document.querySelector('#cvText').value, document.querySelector('#cvPos').value, document.querySelector('#cvFmt').value].join('|'))) === 'Wer zahlt die *Miete*?|oben|jpg');
await page.click('#cvNo'); await sleep(200);

// ═════════ Echter Export: Textzeile und Titel stehen im Video, auch ohne eingebrannte Untertitel; die SRT-Datei enthält nur Untertitel ═════════
await ev(() => { commit(() => { addDel(outToSrcT(6), outToSrcT(total - 0.01)); P.items.push({ id: 'tt2', type: 'title', at: outToSrcT(0.5), dur: 5, text: 'Ein Titel', x: 0.5, y: 0.3, size: 'groß', color: '#FFFFFF', outline: true }); S().y = 0.7; }, true); }); await sleep(500);
const exp = (fmt, burn, name, line) => ev(async ([fmt, burn, name, line]) => {
  exFmt = fmt; P.settings.burn = burn; P.textline.on = line; const plan = buildPlan(); plan.name = name;
  const id = TS.exportVideo(JSON.stringify(plan));
  for (;;){ await new Promise(r => setTimeout(r, 300)); const j = JSON.parse(TS.job(id)); if (j.status === 'done') return { ok: true, result: j.result, total }; if (j.status === 'error') return { ok: false, error: j.error }; }
}, [fmt, burn, name, line]);
// Bildausschnitt eines Einzelbilds als Rohdaten: Textzeile oben rechts, Titel bei 30 %, Untertitel bei 70 %
const crop = (f, t, c) => execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', `crop=${c}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 24 });
const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 24) n++; return n / a.length; };
const cueAt = await ev(() => { const c = computedCues().find(x => x.s > 0.8 && x.e - x.s > 0.6 && x.e < 5); return c ? +(c.s + 0.3).toFixed(2) : 2; });
const A = await exp('video', true, 'helfer_mit', true), B = await exp('video', false, 'helfer_ohne_ut', true), C = await exp('video', false, 'helfer_ohne_zeile', false);
chk('drei Exporte laufen durch', A.ok && B.ok && C.ok, [A.error, B.error, C.error]);
if (A.ok && B.ok && C.ok){
  const [w, h] = want, R = { line: `${Math.round(w * 0.6)}:${Math.round(h * 0.06)}:${Math.round(w * 0.36)}:${Math.round(h * 0.07)}`, title: `${Math.round(w * 0.8)}:${Math.round(h * 0.1)}:${Math.round(w * 0.1)}:${Math.round(h * 0.25)}`, sub: `${Math.round(w * 0.8)}:${Math.round(h * 0.14)}:${Math.round(w * 0.1)}:${Math.round(h * 0.63)}` };
  const f = { A: A.result.playable, B: B.result.playable, C: C.result.playable }, px = Object.fromEntries(Object.entries(f).map(([k, file]) => [k, Object.fromEntries(Object.entries(R).map(([r, c]) => [r, crop(file, cueAt, c)]))]));
  const d = { lineBC: diff(px.B.line, px.C.line), lineAB: diff(px.A.line, px.B.line), titleAB: diff(px.A.title, px.B.title), titleBC: diff(px.B.title, px.C.title), subAB: diff(px.A.sub, px.B.sub), subBC: diff(px.B.sub, px.C.sub) };
  chk('ohne „Untertitel einbrennen“ fehlen nur die Untertitel: Titel und Textzeile stehen weiter im Bild', d.subAB > 0.03 && d.titleAB < 0.005 && d.lineAB < 0.005, d);
  chk('die Textzeile steht oben rechts im Video und fehlt, wenn sie ausgeblendet ist', d.lineBC > 0.05 && d.titleBC < 0.005 && d.subBC < 0.005, d);
  const srt = A.result.files.find(x => x.endsWith('.srt')), txt = srt ? fs.readFileSync(srt, 'utf8') : '';
  chk('die SRT-Datei enthält die Untertitel, aber weder Titel noch Textzeile', txt.length > 40 && /-->/.test(txt) && !txt.includes('Ein Titel') && !txt.includes('@kanal') && B.result.files.some(x => x.endsWith('.srt')), txt.slice(0, 120));
  for (const r of [A, B, C]) for (const x of r.result.files) fs.rmSync(x, { force: true, recursive: true });
}
const cc = await exp('capcut', true, 'helfer_cc', true);
if (chk('CapCut-Export läuft durch', cc.ok, cc.error)){
  const doc = JSON.parse(fs.readFileSync(path.join(cc.result.files[0], 'draft_content.json'), 'utf8')), tt = doc.tracks.filter(t => t.type === 'text').map(t => [t.name, t.segments.length]);
  const lineSeg = doc.tracks.find(t => t.name === 'Textzeile')?.segments[0], us = v => Math.round(v * 1e6);
  chk('in CapCut liegt die Textzeile auf einer eigenen Textspur über die ganze Länge', tt.length === 2 && tt[0][0] === 'Untertitel' && tt[0][1] > 2 && JSON.stringify(tt[1]) === '["Textzeile",1]' && lineSeg.target_timerange.start === 0 && Math.abs(lineSeg.target_timerange.duration - us(cc.total)) < 50000, tt);
  for (const x of cc.result.files) fs.rmSync(x, { force: true, recursive: true });
}

chk('keine Fehlermeldungen in der Oberfläche', logs.length === 0, logs.slice(0, 5));
await drop(cid); await drop(sid);
for (const f of [png, jpg]) fs.rmSync(f, { force: true });   // das Bild mit Titelzeile bleibt zum Ansehen liegen
await ende(browser);
