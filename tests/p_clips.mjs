// Clips in Serie (2.33): Abschnitte vormerken und Clip-Reihe (F2), Zusammenschnitt (F3), Clip-Vorschläge (F1), Hook-Varianten (F4),
// Kennzeichnung „Teil 1/3“ (F5), Suche über alle Projekte (C9).
// Grundlage ist serie.mp4: fester Text in sechs Absätzen mit Fragen, Zahlen und Schlagwörtern (siehe medien.py).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, newProject, transcribe, scratch, ids, sleep, pruefung, MEDIA, OUT } from './drv.mjs';
const { chk, ende } = pruefung('Clips in Serie');
const { browser, page, logs } = await launch();
const ev = (f, a) => page.evaluate(f, a);
const shot = (name, pg = page) => pg.screenshot({ path: path.join(OUT, `clips-${name}.png`) });
const made = [], trash = new Set();
const toastTxt = () => ev(() => document.querySelector('#toast').textContent);
const leave = () => ev(() => { if (typeof P !== 'undefined' && P){ pausePlay(); clearTimeout(saveT); saveNow(); closeSheet(); closeProject(); } });
const open = async id => { await ev(i => { if (P && P.id === i) return; closeSheet(); if (P) closeProject(); openProject(i); }, id); await page.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i, id, { timeout: 30000 }); await sleep(500); };
const idle = (t = 300000) => page.waitForFunction(() => !exBatch && !exDirect && EXQ.every(x => x.status !== 'wait' && x.status !== 'run'), null, { timeout: t });
const q = () => ev(() => EXQ.map(x => ({ name: x.name, st: x.status, info: x.info, err: x.error, files: (x.result && x.result.files) || [] })));
const clearQ = async () => { for (const x of await q()) for (const f of x.files) trash.add(f); await ev(() => { for (const x of EXQ.slice()) if (x.status === 'wait' || x.status === 'run') exqCancel(x); }); await sleep(400); await idle(60000).catch(() => {}); await ev(() => { EXQ.length = 0; paintQueue(); }); };
const dur = f => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();
const dims = f => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f]).toString().trim().split(',').map(Number);
const frame = (f, t, vf = 'null') => execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 });
const diff = (a, b, tol = 40) => { let n = 0; const m = Math.min(a.length, b.length); for (let i = 0; i < m; i++) if (Math.abs(a[i] - b[i]) > tol) n++; return a.length === b.length ? n / m : 1; };
// Hilfen in der Seite: Wörter an ihrer Stelle im Text finden, Bereiche markieren, den Text eines gespeicherten Projekts lesen
const injectT = (pg = page) => pg.evaluate(() => {
  window.HX = {
    words: () => order.filter(i => tokens[i].type === 'word'),
    at: (text, nth = 0) => { const w = order.filter(i => tokens[i].type === 'word' && tokText(tokens[i]).replace(/[.,?!]/g, '') === text)[nth]; return w == null ? -1 : pos[w]; },   // Stelle im Text
    pick: (a, b) => { selA = order[a]; selB = order[b]; showSel(); },
    para: k => { const w = HX.words().filter(i => tokens[i].p === k); return [pos[w[0]], pos[w[w.length - 1]]]; },
    text: ids => ids.filter(i => tokens[i].type === 'word' && !isCut(i)).map(i => tokText(tokens[i]).trim()).join(' '),
    kept: p => { const del = new Set(p.deleted || []), cut = t => (p.dels || []).some(d => t > d[0] + 1e-4 && t < d[1] - 1e-4); return (p.tokens || []).filter((t, i) => t.type === 'word' && !del.has(i) && !cut((t.ws + t.we) / 2)).map(t => t.text.trim()).join(' '); },
    rect: sel => { const im = document.querySelector(sel); if (!im) return null; const r = im.getBoundingClientRect(), s = document.querySelector('#stage').getBoundingClientRect(); return { l: (r.left - s.left) / s.width, t: (r.top - s.top) / s.height, w: r.width / s.width, h: r.height / s.height, r: (s.right - r.right) / s.width, b: (s.bottom - r.bottom) / s.height }; },
    row: r => [r.querySelector('.mono').textContent, r.querySelector('b').textContent, r.querySelector('i').textContent].join(' | '),
    first: x => secQuote(x, 1).split(' ')[0],
    drop: list => { for (const i of list){ try { TS.deleteProject(i); } catch (_) {} try { if (TS.trashPurge) TS.trashPurge(i); } catch (_) {} } },
  };
});
await injectT();

await ev(() => { for (const k of ['hc-clipfmt', 'hc-clippart', 'hc-clipwords', 'hc-house', 'hc-house-def', 'hc-safe']) localStorage.removeItem(k); clipWords = []; houseList = []; houseDef = ''; EXQ.length = 0; });
const idS = await newProject(page, [MEDIA + 'serie.mp4']); made.push(idS); await transcribe(page);
await ev(() => { P.settings.burn = false; setTab('text'); }); await sleep(300);
const base = await ev(() => ({ words: HX.words().length, paras: [...new Set(tokens.filter(t => t.type === 'word').map(t => t.p))].length, total: +total.toFixed(1), unk: tokens.filter(t => t.type === 'unk').length }));
chk('das Prüfvideo hat sechs Absätze und 293 Wörter', base.words === 293 && base.paras === 6 && base.unk === 0 && base.total > 150 && base.total < 156, base);

// ═════════ F2 · Abschnitte vormerken ═════════
await ev(() => HX.pick(HX.at('Warum'), HX.at('Jahren')));
let st = await ev(() => ({ btn: getComputedStyle(document.querySelector('#selList')).display, lbl: document.querySelector('#selList span').textContent, chip: document.querySelector('#clipsBtn').textContent }));
chk('die Auswahlleiste bietet „Vormerken“, die Leiste über dem Text „Clips“', st.btn !== 'none' && st.lbl === 'Vormerken' && st.chip === 'Clips', st);
const u0 = await ev(() => undo.length);
await page.keyboard.press('v'); await sleep(250);
st = await ev(() => ({ n: P.clipList.length, x: P.clipList[0], quote: secQuote(P.clipList[0], 20), cl: document.querySelectorAll('#transcript .tk.cl').length, want: secIds(P.clipList[0]).length, chip: document.querySelector('#clipsBtn').textContent, on: document.querySelector('#clipsBtn').classList.contains('on'), sel: selA, undo: undo.length, toast: document.querySelector('#toast').textContent, r: secOut(P.clipList[0]) }));
chk('V merkt den markierten Abschnitt vor: Anfang und Ende als Quellzeit, die Wörter sind im Text hinterlegt', st.n === 1 && st.quote === 'Warum steigen die Mieten in Berlin seit Jahren?' && st.cl === st.want && st.cl >= 8 && Math.abs(st.x.at - 0.6) < 0.05 && st.x.end > st.x.at + 3, st);
chk('die Leiste zählt mit, die Markierung ist aufgehoben, ein Hinweis nennt den nächsten Schritt', st.chip === 'Clips (1)' && st.on && st.sel === null && st.undo === u0 + 1 && /Vorgemerkt – weitere Abschnitte markieren/.test(st.toast), st);
chk('der Abschnitt belegt im Video den Bereich seiner Wörter, mit etwas Luft davor und dahinter', st.r && Math.abs(st.r[0] - (st.x.at - 0.08)) < 0.005 && Math.abs(st.r[1] - (st.x.end + 0.15)) < 0.005, st.r);
await ev(() => HX.pick(HX.at('Warum'), HX.at('Jahren')));
chk('auf demselben Abschnitt heißt der Knopf „Vormerkung weg“', (await ev(() => document.querySelector('#selList span').textContent)) === 'Vormerkung weg');
await page.click('#selList'); await sleep(200);
st = await ev(() => ({ n: P.clipList.length, cl: document.querySelectorAll('#transcript .tk.cl').length, chip: document.querySelector('#clipsBtn').textContent, toast: document.querySelector('#toast').textContent }));
chk('noch einmal nimmt die Vormerkung zurück', st.n === 0 && st.cl === 0 && st.chip === 'Clips' && st.toast === 'Vormerkung entfernt', st);
// ohne Markierung: der Satz an der Abspiellinie
await ev(() => { clearSel(); seekOut(40, false); }); await sleep(150);
const sentAt = await ev(() => { const k = tokAtOut(outPos), r = sentBounds(pos[k], pos[k]); return HX.text(order.slice(r[0], r[1] + 1)); });
await page.keyboard.press('v'); await sleep(200);
st = await ev(() => ({ n: P.clipList.length, quote: secQuote(P.clipList[0], 30) }));
chk('ohne Markierung merkt V den Satz an der Abspiellinie vor', st.n === 1 && st.quote === sentAt && /^[A-ZÄÖÜ].*\.$/.test(sentAt), [st.quote, sentAt]);
await page.click('#undoBtn'); await sleep(200);
st = await ev(() => ({ n: P.clipList.length, cl: document.querySelectorAll('#transcript .tk.cl').length, chip: document.querySelector('#clipsBtn').textContent }));
const undone = st.n === 0 && st.cl === 0 && st.chip === 'Clips';
await page.click('#redoBtn'); await sleep(200);
st = await ev(() => ({ n: P.clipList.length, cl: document.querySelectorAll('#transcript .tk.cl').length, chip: document.querySelector('#clipsBtn').textContent, snap: JSON.parse(snapshot()).cl.length }));
chk('Rückgängig und Wiederholen nehmen die Vormerkung mit, im Text und in der Leiste', undone && st.n === 1 && st.cl > 5 && st.chip === 'Clips (1)' && st.snap === 1, st);
await ev(() => { commit(() => { P.clipList = []; }, false); clipListChanged(); });
// über den Clip-Dialog
await ev(() => { const [a, b] = HX.para(3); HX.pick(a, b); }); await page.click('#selClip'); await sleep(250);
st = await ev(() => ({ keep: !!document.querySelector('#hcModal #clipKeep'), go: !!document.querySelector('#hcModal #clipGo'), hint: /Vormerken“ sammelt den Abschnitt/.test(document.querySelector('#hcModal').textContent) }));
chk('der Clip-Dialog bietet neben „Clip öffnen“ auch „Vormerken“', st.keep && st.go && st.hint, st);
await page.click('#clipKeep'); await sleep(250);
st = await ev(() => ({ n: P.clipList.length, quote: secQuote(P.clipList[0], 5), modal: !!document.querySelector('#hcModal'), sel: selA }));
chk('„Vormerken“ im Dialog legt den Abschnitt in die Liste', st.n === 1 && /^Was können wir also tun\?/.test(st.quote) && !st.modal && st.sel === null, st);
// weitere Abschnitte: Absatz 1 und Absatz 6 – die Liste steht in der Reihenfolge des Textes
await ev(() => { let [a, b] = HX.para(5); HX.pick(a, b); clipListToggle(); [a, b] = HX.para(0); HX.pick(a, b); clipListToggle(); });
st = await ev(() => ({ first: P.clipList.map(x => HX.first(x)), secs: P.clipList.map(x => secOut(x).map(v => +v.toFixed(2))) }));
chk('mehrere Abschnitte stehen in der Reihenfolge des Videos', st.first.join('|') === 'Warum|Was|Am' && st.secs[0][1] < st.secs[1][0] && st.secs[1][1] < st.secs[2][0], st);
const secs = st.secs;

// Blatt „Clips aus diesem Video“
await page.click('#clipsBtn'); await sleep(350);
st = await ev(() => ({ open: clipsSheetOpen(), passive: document.querySelector('#sheet').classList.contains('passive'), tabs: [...document.querySelectorAll('#clSheet [data-view]')].map(b => b.textContent + (b.classList.contains('on') ? '*' : '')), rows: [...document.querySelectorAll('#clSheet .cl-row')].map(r => r.querySelector('.mono').textContent + ' ' + r.querySelector('i').textContent),
  head: document.querySelector('#clSheet p').textContent, fmt: [...document.querySelectorAll('#clFmt button')].map(b => b.textContent + (b.classList.contains('on') ? '*' : '')).join(' '), part: document.querySelector('#clPart').checked, partLbl: document.querySelector('#clPart').closest('label').textContent.trim(),
  btns: [...document.querySelectorAll('#clSheet [data-a]')].filter(b => ['series', 'best', 'one', 'clear', 'ok'].includes(b.dataset.a)).map(b => b.textContent.trim()) }));
chk('das Blatt zeigt die vorgemerkten Abschnitte mit Zeit und Länge', st.open && st.passive && st.tabs.join(' | ') === 'Vorgemerkt (3)* | Vorschläge | Reihen (0)' && st.rows.length === 3 && /^0:00 27,[0-9] s$/.test(st.rows[0]) && /^1:1[45] 2[23],[0-9] s$/.test(st.rows[1]) && /^3 Abschnitte, zusammen 1:1[34]\./.test(st.head), st);
chk('darunter: Format (9:16 voreingestellt), „Teil 1/3“ einblenden, Clip-Reihe, Zusammenschnitt, Liste leeren', st.fmt === '9:16* 4:5 1:1 16:9 Original' && st.part && /„Teil 1\/3“ in jedem Clip der Reihe einblenden/.test(st.partLbl) && st.btns[0] === 'Clip-Reihe anlegen (3 Clips)' && /^Zusammenschnitt \(1:1[34]\)$/.test(st.btns[1]) && st.btns[2] === 'Liste leeren' && st.btns[3] === 'Fertig', st);
await shot('blatt-vorgemerkt');
await page.click('#clSheet .cl-row:nth-child(2) [data-a="play"]'); await sleep(500);
st = await ev(() => ({ playing, stopAt, pos: outPos }));
chk('▶ spielt genau den Abschnitt', st.playing && Math.abs(st.stopAt - secs[1][1]) < 0.02 && st.pos >= secs[1][0] - 0.05 && st.pos < secs[1][0] + 1.5, st);
await page.click('#clSheet .cl-row:nth-child(2) [data-a="play"]'); await sleep(200);
chk('noch einmal ▶ hält an', !(await ev(() => playing)));
await page.click('#clSheet .cl-row:nth-child(3) .mk-go'); await sleep(400);
st = await ev(() => ({ tab, sel: HX.text(selIds()).split(' ').slice(0, 3).join(' '), n: selIds().length, want: secIds(P.clipList[2]).length, lbl: document.querySelector('#selList span').textContent, pos: +outPos.toFixed(1) }));
chk('Antippen einer Zeile markiert den Abschnitt im Text und setzt die Abspiellinie an seinen Anfang', st.tab === 'text' && st.sel === 'Am Ende zählt,' && st.n === st.want && st.lbl === 'Vormerkung weg' && Math.abs(st.pos - secs[2][0]) < 0.3, st);
await ev(() => clearSel());
// Abschnitte folgen dem Schnitt
const lenA = secs[0][1] - secs[0][0];
await ev(() => { HX.pick(HX.at('Die', 0), HX.at('denken')); document.querySelector('#selDel').click(); }); await sleep(600);
st = await ev(() => ({ r: secOut(P.clipList[0]), row: document.querySelector('#clSheet .cl-row i').textContent, quote: secQuote(P.clipList[0], 12) }));
chk('ein Schnitt im Abschnitt verkürzt ihn; die Liste zeigt die neue Länge', st.r && lenA - (st.r[1] - st.r[0]) > 2.5 && !/Die Antwort/.test(st.quote) && parseFloat(st.row.replace(',', '.')) < lenA - 2.5, st);
await ev(() => { const [a, b] = HX.para(0); HX.pick(a, b); document.querySelector('#selDel').click(); }); await sleep(600);
st = await ev(() => ({ r: secOut(P.clipList[0]), cls: document.querySelector('#clSheet .cl-row').className, txt: document.querySelector('#clSheet .cl-row i').textContent, play: document.querySelector('#clSheet .cl-row [data-a="play"]').disabled, btn: document.querySelector('#clSheet [data-a="series"]').textContent, head: document.querySelector('#clSheet p').textContent }));
chk('ein ganz weggeschnittener Abschnitt zählt nicht mehr mit', st.r === null && /cut/.test(st.cls) && /weggeschnitten/.test(st.txt) && st.play && st.btn === 'Clip-Reihe anlegen (2 Clips)' && /^2 Abschnitte/.test(st.head), st);
await page.click('#undoBtn'); await page.click('#undoBtn'); await sleep(600);
st = await ev(() => ({ r: secOut(P.clipList[0]), btn: document.querySelector('#clSheet [data-a="series"]').textContent }));
chk('Rückgängig stellt Schnitt und Abschnitt wieder her', st.r && Math.abs(st.r[1] - st.r[0] - lenA) < 0.02 && st.btn === 'Clip-Reihe anlegen (3 Clips)', st);
// entfernen und leeren
await page.click('#clSheet .cl-row:nth-child(2) [data-a="drop"]'); await sleep(200);
st = await ev(() => ({ n: P.clipList.length, rows: document.querySelectorAll('#clSheet .cl-row').length, btn: document.querySelector('#clSheet [data-a="series"]').textContent }));
const dropped = st.n === 2 && st.rows === 2 && st.btn === 'Clip-Reihe anlegen (2 Clips)';
await page.click('#clSheet .cl-row:nth-child(2) [data-a="drop"]'); await sleep(200);
st = await ev(() => ({ n: P.clipList.length, one: (document.querySelector('#clSheet [data-a="one"]') || {}).textContent, series: !!document.querySelector('#clSheet [data-a="series"]'), part: !!document.querySelector('#clPart') }));
chk('× nimmt einen Abschnitt heraus; mit nur einem bleibt „Als Clip öffnen“', dropped && st.n === 1 && st.one === 'Als Clip öffnen' && !st.series && !st.part, st);
await page.click('#clSheet [data-a="clear"]'); await sleep(200);
st = await ev(() => ({ n: P.clipList.length, txt: document.querySelector('#clSheet p').textContent, cl: document.querySelectorAll('#transcript .tk.cl').length }));
chk('„Liste leeren“ leert sie, der Hinweis erklärt das Vormerken', st.n === 0 && st.cl === 0 && /Noch nichts vorgemerkt/.test(st.txt) && /Taste V/.test(st.txt), st);
await page.click('#undoBtn'); await page.click('#undoBtn'); await page.click('#undoBtn'); await sleep(250);
chk('dreimal Rückgängig: die drei Abschnitte sind wieder da', (await ev(() => P.clipList.length)) === 3);
// gespeichert und nach dem Neuladen wieder da
await ev(() => { closeSheet(); saveNow(); });
await page.reload(); await page.waitForFunction(() => typeof showHome === 'function' && typeof P !== 'undefined'); await sleep(600);
await ev(() => { if (!P) return; });
if (!(await ev(() => !!P))) await open(idS);
await page.waitForFunction(i => P && P.id === i && spans.length > 0, idS, { timeout: 30000 }); await sleep(400);
await injectT(); await ev(() => { if (tab !== 'text') setTab('text'); });
st = await ev(() => ({ n: (P.clipList || []).length, cl: document.querySelectorAll('#transcript .tk.cl').length, chip: document.querySelector('#clipsBtn').textContent, blocks: document.querySelectorAll('.tl .blk').length }));
chk('nach dem Neuladen sind die vorgemerkten Abschnitte noch da und im Text hinterlegt', st.n === 3 && st.cl > 100 && st.chip === 'Clips (3)', st);
chk('nach dem Neuladen ist die Zeitleiste unter dem Text gezeichnet', st.blocks >= 1, st.blocks);

// ═════════ F1 · Clip-Vorschläge ═════════
await ev(() => { openClips('sug'); }); await sleep(350);
const sug = () => ev(() => clipSuggest().map(s => ({ o1: +s.o1.toFixed(2), o2: +s.o2.toFixed(2), sc: s.sc, why: s.why, first: HX.text(s.ids).split(' ')[0], last: HX.text(s.ids).split(' ').pop(), n: s.ids.length })));
let sg = await sug();
chk('die Vorschläge dauern 20 bis 90 Sekunden, überschneiden sich nicht und stehen in der Reihenfolge des Videos', sg.length === 5 && sg.every(s => s.o2 - s.o1 >= 20 && s.o2 - s.o1 <= 90.3) && sg.every((s, k) => !k || s.o1 >= sg[k - 1].o2 - 0.3), sg.map(s => [s.o1, s.o2]));
chk('jeder Vorschlag besteht aus ganzen Sätzen', sg.every(s => /^[A-ZÄÖÜ]/.test(s.first) && /[.?!]$/.test(s.last)), sg.map(s => [s.first, s.last]));
chk('der erste Absatz steht vorn: ganzer Absatz, Frage zum Einstieg, Zahlen', sg[0].first === 'Warum' && sg[0].why.join('|') === 'ganzer Absatz|Frage zum Einstieg|Zahlen' && sg[0].sc === Math.max(...sg.map(s => s.sc)), sg[0]);
const und = sg.find(s => s.first === 'Und'), was = sg.find(s => s.first === 'Was');
chk('ein Einstieg mit „Und deshalb“ zählt weniger als einer mit einer Frage', und && was && und.sc < was.sc && und.sc === Math.min(...sg.map(s => s.sc)) && was.why.includes('Frage zum Einstieg') && und.why.join() === 'ganzer Absatz', [und, was]);
chk('der dritte Absatz ist für einen eigenen Clip zu kurz und wird nicht vorgeschlagen', !sg.some(s => s.first === 'Wer') && sg.map(s => s.first).join(' ') === 'Warum Und Was Der Am', sg.map(s => s.first));
st = await ev(() => ({ rows: document.querySelectorAll('#clSheet .cl-row.sug').length, txt: document.querySelector('#clSheet p').textContent, first: HX.row(document.querySelector('#clSheet .cl-row.sug')), on: [...document.querySelectorAll('#clSheet .cl-row.sug')].map(r => !!r.querySelector('.cl-on')), field: !!document.querySelector('#clWords') }));
chk('das Blatt nennt die Regeln und zeigt je Vorschlag Zeit, Text, Länge und Gründe', st.rows === 5 && /Vorauswahl nach festen Regeln, ohne Online-Dienst/.test(st.txt) && /20 bis 90 Sekunden/.test(st.txt) && /^0:00 \| Warum steigen die Mieten in Berlin seit Jahren\? .* … \| 27,[0-9] s · ganzer Absatz · Frage zum Einstieg · Zahlen$/.test(st.first) && st.field, st);
chk('schon vorgemerkte Vorschläge sind als solche gekennzeichnet', st.on.join() === 'true,false,true,false,true', st.on);
await shot('blatt-vorschlaege');
// eigene Schlagwörter
await page.fill('#clWords', 'Mietendeckel, Solidarität;  Kiez für Kiez'); await page.press('#clWords', 'Enter'); await sleep(300);
sg = await sug();
st = await ev(() => ({ ls: JSON.parse(localStorage.getItem('hc-clipwords')), field: document.querySelector('#clWords').value, prefs: uiPrefs()['hc-clipwords'] }));
chk('eigene Schlagwörter bleiben im Gerät und gehen in die Sicherung', st.ls.join('|') === 'Mietendeckel|Solidarität|Kiez für Kiez' && st.field === 'Mietendeckel, Solidarität, Kiez für Kiez' && st.prefs && st.prefs.length === 3, st);
chk('Schlagwörter heben Vorschläge und stehen als Grund dabei – auch mehrere Wörter am Stück', sg[0].why.includes('Schlagwort: Mietendeckel') && sg.find(s => s.first === 'Der').why.includes('Schlagwort: Solidarität') && sg.find(s => s.first === 'Am').why.includes('Schlagwort: Kiez für Kiez') && sg[0].sc === 14.5, sg.map(s => [s.first, s.sc, s.why]));
// Wörterbuch und betonte Wörter zählen als Schlagwörter
const dict0 = await ev(() => JSON.stringify(dict));
await ev(() => { dictAdd('Vergesellschaftung'); sugMemo = null; });
sg = await sug();
const dictOk = /Vergesellschaftung/.test(sg.find(s => s.first === 'Der').why.join());
await ev(d => { dict = JSON.parse(d); saveDict(); const i = order[HX.at('Initiativen')]; commit(() => { P.kw = [i]; }, false); }, dict0);
sg = await sug();
chk('Begriffe aus dem Wörterbuch und betonte Wörter zählen ebenfalls', dictOk && /Initiativen/.test(was && sg.find(s => s.first === 'Was').why.join()) && !/Vergesellschaftung/.test(sg.find(s => s.first === 'Der').why.join()), sg.map(s => s.why));
await ev(() => { commit(() => { P.kw = []; }, false); });
// Kapitel als Einschnitt
await ev(() => { const t = tokens[order[HX.at('Neukölln') - 1]]; commit(() => { P.marks.push({ id: 'kap1', k: 'chap', at: t.ws, text: 'Beispiele' }); }, false); });
sg = await sug();
chk('ein Kapitel gilt als Absatzgrenze: Ein Vorschlag beginnt dort', sg.some(s => s.first === 'In' && /Absätze|beginnt mit einem Absatz/.test(s.why.join())), sg.map(s => [s.first, s.sc, s.why]));
await ev(() => { commit(() => { P.marks = P.marks.filter(m => m.id !== 'kap1'); }, false); sugMemo = null; if (clipsSheetOpen()) renderClipsSheet(); });
// anhören und übernehmen
sg = await sug();
await page.click('#clSheet .cl-row.sug:nth-child(2) [data-a="play"]'); await sleep(450);
st = await ev(() => ({ playing, stopAt, pos: outPos }));
chk('▶ am Vorschlag spielt ihn ab', st.playing && Math.abs(st.stopAt - sg[1].o2) < 0.02 && st.pos >= sg[1].o1 - 0.05, st);
await ev(() => pausePlay());
await page.click('#clSheet .cl-row.sug:nth-child(2) [data-a="take"]'); await sleep(250);
st = await ev(() => ({ n: P.clipList.length, quotes: P.clipList.map(x => HX.first(x)), on: [...document.querySelectorAll('#clSheet .cl-row.sug')].map(r => !!r.querySelector('.cl-on')), tab: document.querySelector('#clSheet [data-view="list"]').textContent }));
chk('„Übernehmen“ legt den Vorschlag in die Liste', st.n === 4 && st.quotes.join('|') === 'Warum|Und|Was|Am' && st.on.join() === 'true,true,true,false,true' && st.tab === 'Vorgemerkt (4)', st);
await page.click('#clSheet .cl-row.sug:nth-child(4) .mk-go'); await sleep(300);
st = await ev(() => ({ sel: HX.text(selIds()).split(' ').slice(0, 2).join(' '), lbl: document.querySelector('#selList span').textContent }));
chk('Antippen zeigt den Vorschlag im Text – dort lässt er sich vor dem Vormerken anpassen', st.sel === 'Der Volksentscheid' && st.lbl === 'Vormerken', st);
await ev(() => clearSel());
await page.click('#clSheet [data-a="takeall"]'); await sleep(300);
st = await ev(() => ({ n: P.clipList.length, view: clipsView, toast: document.querySelector('#toast').textContent }));
chk('„Alle übernehmen“ merkt die übrigen vor und wechselt zur Liste', st.n === 5 && st.view === 'list' && st.toast === '1 Vorschlag vorgemerkt', st);
// Vorschläge folgen dem Schnitt
await ev(() => { const [a, b] = HX.para(0); HX.pick(a, b); document.querySelector('#selDel').click(); }); await sleep(300);
sg = await sug();
chk('nach einem Schnitt stehen neue Vorschläge da', sg.length >= 3 && sg[0].first !== 'Warum' && sg[0].o1 < 1, sg.map(s => [s.first, s.o1]));
await page.click('#undoBtn'); await sleep(250);
await ev(() => { clipWordsSet(''); sugMemo = null; });

// ═════════ F2 · Clip-Reihe ═════════
// Liste: Absatz 1, 4 und 6 (die Reihe bekommt drei Teile)
await ev(() => { commit(() => { P.clipList = P.clipList.filter(x => ['Warum', 'Was', 'Am'].includes(HX.first(x))); }, false); clipListChanged(); clipsView = 'list'; renderClipsSheet(); }); await sleep(250);
const secs3 = await ev(() => P.clipList.map(x => secOut(x)));
const texts3 = await ev(() => P.clipList.map(x => HX.text(secIds(x))));
const snapMain = await ev(() => snapshot());
await page.click('#clSheet [data-a="series"]'); await sleep(900);
st = await ev(() => { const s = (P.clipSeries || [])[0], all = J(TS.listProjects()); return { s, names: s ? s.clips.map(c => (all.find(p => p.id === c.id) || {}).name) : [], view: clipsView, toast: document.querySelector('#toast').textContent, snap: snapshot(), list: P.clipList.length,
  clips: s ? s.clips.map(c => { const p = J(TS.loadProject(c.id)); return { clipOf: p.clipOf, part: p.part, fmt: p.format, regen: p.regen, frameNew: p.frameNew, frame: p.frame || null, list: 'clipList' in p, ser: 'clipSeries' in p, text: HX.kept(p), range: p.clipRange, look: p.sub_style.look }; }) : [] }; });
const ser = st.s;
for (const c of (ser && ser.clips) || []) made.push(c.id);
chk('„Clip-Reihe anlegen“ legt je Abschnitt ein Clip-Projekt an und führt die Reihe im Projekt', ser && ser.clips.length === 3 && ser.fmt === '9:16' && ser.name === 'Reihe 1' && st.names.join('|') === 'serie – Teil 1|serie – Teil 2|serie – Teil 3' && st.view === 'series' && /3 Clips angelegt/.test(st.toast), [ser, st.names, st.toast]);
chk('jeder Clip kennt seine Stelle in der Reihe und seine Geschwister', st.clips.every((c, k) => c.clipOf === idS && c.part.series === ser.id && c.part.k === k + 1 && c.part.n === 3 && c.part.on === true && c.part.ids.join() === ser.clips.map(x => x.id).join()), st.clips.map(c => c.part));
chk('die Clips enthalten genau die Wörter ihres Abschnitts', st.clips.every((c, k) => c.text === texts3[k]) && st.clips.every((c, k) => Math.abs(c.range[0] - secs3[k][0]) < 0.002 && Math.abs(c.range[1] - secs3[k][1]) < 0.002), st.clips.map(c => c.text.slice(0, 30)));
chk('Format, Untertitel-Look und Bildausschnitt entstehen beim ersten Öffnen; Vorgemerktes und Reihen bleiben im Hauptprojekt', st.clips.every(c => c.fmt === '9:16' && c.regen === true && c.frameNew === true && !c.frame && !c.list && !c.ser && c.look === 'punch') && st.snap === snapMain && st.list === 3, st.clips.map(c => [c.fmt, c.regen, c.frameNew, c.list, c.ser]));
st = await ev(() => ({ tabs: [...document.querySelectorAll('#clSheet [data-view]')].map(b => b.textContent + (b.classList.contains('on') ? '*' : '')).join(' | '), head: [document.querySelector('.cl-ser-n b').textContent, document.querySelector('.cl-ser-n span').textContent].join(' | '), rows: [...document.querySelectorAll('.cl-ser .cl-row')].map(HX.row), exp: (document.querySelector('.cl-ser [data-a="sexp"]') || {}).textContent }));
chk('das Blatt führt die Reihe mit ihren Clips und „Alle exportieren“', st.tabs === 'Vorgemerkt (3) | Vorschläge | Reihen (1)*' && /^Reihe 1 \| 3 Clips · 9:16 · \d+\.\d+\.\d{4}$/.test(st.head) && st.rows.length === 3 && /^1\/3 \| serie – Teil 1 \| 0:2[78] · Warum steigen/.test(st.rows[0]) && /^3\/3 \| serie – Teil 3 \|/.test(st.rows[2]) && st.exp === 'Alle exportieren', st);
await shot('blatt-reihen');
// zweite Reihe: eindeutige Namen
await ev(() => { lsSet('hc-clipfmt', ''); seriesCreate('', false); }); await sleep(700);
st = await ev(() => { const s = P.clipSeries[1], all = J(TS.listProjects()); return { s, names: s.clips.map(c => all.find(p => p.id === c.id).name), clips: s.clips.map(c => { const p = J(TS.loadProject(c.id)); return [p.format, p.part.on, p.frameNew || false, p.sub_style.look]; }) }; });
for (const c of st.s.clips) made.push(c.id);
chk('eine zweite Reihe bekommt eigene Namen; „Original“ und „ohne Kennzeichnung“ gelten für ihre Clips', st.s.name === 'Reihe 2' && st.s.fmt === '' && st.names.join('|') === 'serie – Reihe 2, Teil 1|serie – Reihe 2, Teil 2|serie – Reihe 2, Teil 3' && st.clips.every(c => c[0] === null && c[1] === false && c[2] === false && c[3] === 'classic'), st);
const ser2 = st.s;
// Reihe verwalten: umbenennen (über den Dialog), mit Clips löschen
const S2 = `.cl-ser[data-s="${ser2.id}"]`;
await page.click(S2 + ' [data-a="smenu"]'); await sleep(200);
const menu = await ev(() => [...document.querySelectorAll('#ctxMenu button')].map(b => b.textContent.trim()));
chk('das Menü der Reihe: umbenennen, auflösen, mit Clips löschen', menu.join('|') === 'Reihe umbenennen|Reihe auflösen (Clips bleiben)|Reihe mit ihren Clips löschen', menu);
await page.click('#ctxMenu button:nth-child(1)'); await sleep(200); await page.fill('#nmIn', 'Querformat'); await page.click('#nmOk'); await sleep(250);
const renamed = await ev(q => P.clipSeries[1].name === 'Querformat' && /Querformat/.test(document.querySelector(q + ' .cl-ser-h').textContent) && J(TS.loadProject(P.id)).clipSeries[1].name === 'Querformat', S2);
await page.click(S2 + ' [data-a="smenu"]'); await sleep(200); await page.click('#ctxMenu button:nth-child(3)'); await sleep(500);
st = await ev(s => ({ n: P.clipSeries.length, left: s.clips.filter(c => J(TS.listProjects()).some(p => p.id === c.id)).length, sers: document.querySelectorAll('.cl-ser').length, toast: document.querySelector('#toast').textContent }), ser2);
chk('umbenennen ändert den Namen der Reihe; „mit ihren Clips löschen“ entfernt Reihe und Clips', renamed && st.n === 1 && st.left === 0 && st.sers === 1 && st.toast === 'Reihe gelöscht', st);

// ═════════ F5 · Clip der Reihe: Kennzeichnung „Teil 2/3“ ═════════
await page.click(`.cl-ser .cl-row[data-c="${ser.clips[1].id}"] .mk-go`);
await page.waitForFunction(i => P && P.id === i, ser.clips[1].id, { timeout: 30000 }); await sleep(1200);
st = await ev(() => ({ tab, total, fmt: P.format, frame: P.frame, cover: +coverSc().toFixed(3), cues: P.cues.length, regen: 'regen' in P, frameNew: 'frameNew' in P, text: partText(), on: partOn(), img: HX.rect('#partOv img'), card: !document.querySelector('#clipSeriesCard').classList.contains('hidden'), h: document.querySelector('#clipSeriesH').textContent, info: document.querySelector('#clipSeriesInfo').textContent,
  prev: document.querySelector('#clipPrev').disabled, next: document.querySelector('#clipNext').disabled, sheet: !document.querySelector('#sheet').classList.contains('hidden'), saved: (p => [!!p.frame, 'regen' in p, 'frameNew' in p])(J(TS.loadProject(P.id))) }));
chk('ein Clip der Reihe öffnet im Clip-Reiter: 9:16, das Bild füllt die Leinwand, Untertitel sind erzeugt', st.tab === 'clip' && Math.abs(st.total - (secs3[1][1] - secs3[1][0])) < 0.05 && st.fmt === '9:16' && st.frame && Math.abs(st.frame.sc - st.cover) < 0.002 && st.cues > 3 && !st.regen && !st.frameNew && !st.sheet && st.saved.join() === 'true,false,false', st);
chk('„Teil 2/3“ steht oben links im Bild', st.on && st.text === 'Teil 2/3' && st.img && st.img.l > 0.02 && st.img.l < 0.08 && st.img.t > 0.01 && st.img.t < 0.05 && st.img.w > 0.12 && st.img.w < 0.4, st.img);
chk('die Karte der Reihe nennt den Teil und führt zu den Nachbarn', st.card && st.h === 'Teil 2 von 3' && /„Teil 2\/3“ steht im Bild/.test(st.info) && !st.prev && !st.next, st);
await shot('clip-teil');
await page.click('#clipNext'); await page.waitForFunction(i => P && P.id === i, ser.clips[2].id, { timeout: 30000 }); await sleep(900);
st = await ev(() => ({ h: document.querySelector('#clipSeriesH').textContent, next: document.querySelector('#clipNext').disabled, prev: document.querySelector('#clipPrev').disabled, text: partText(), tab }));
const atLast = st.h === 'Teil 3 von 3' && st.next && !st.prev && st.text === 'Teil 3/3' && st.tab === 'clip';
await page.click('#clipPrev'); await page.waitForFunction(i => P && P.id === i, ser.clips[1].id, { timeout: 30000 }); await sleep(900);
chk('„Nächster Teil“ und „Teil davor“ wechseln zwischen den Clips', atLast && (await ev(() => document.querySelector('#clipSeriesH').textContent)) === 'Teil 2 von 3', st);
// Plan
st = await ev(() => { const pl = buildPlan(), o = pl.overlays.filter(x => x.part), [W, H] = outSize(), b = partBox(W, H); return { n: o.length, o: o[0], total: pl.total, W, H, b, sum: (setTab('export'), document.querySelector('#exSummary').textContent) }; });
chk('im Exportplan liegt die Kennzeichnung als Bild über die ganze Länge auf eigener Spur', st.n === 1 && st.o.mode === 'pip' && st.o.image && st.o.at === 0 && st.o.in === 0 && Math.abs(st.o.out - st.total) < 0.002 && st.o.track === 97 && Math.abs(st.o.x * st.W - (st.b.x + st.b.w / 2)) < 1 && Math.abs(st.o.y * st.H - (st.b.y + st.b.h / 2)) < 1 && /· „Teil 2\/3“/.test(st.sum), st);
await ev(() => setTab('clip'));
// Einstellungen
const u1 = await ev(() => undo.length);
await page.click('#clipPartBtn'); await sleep(300);
st = await ev(() => ({ open: partSheetOpen(), on: document.querySelector('#ptOn').checked, lbl: document.querySelector('#ptOn').closest('label').textContent.trim(), pos: document.querySelector('#ptPos .on').dataset.p, word: document.querySelector('#ptWord').value, dur: document.querySelector('#ptDur').value, size: document.querySelector('#ptSizeV').textContent }));
chk('„Kennzeichnung …“ öffnet die Einstellungen: ein/aus, Ecke, Bezeichnung, Dauer, Größe', st.open && st.on && st.lbl === '„Teil 2/3“ in diesem Clip einblenden' && st.pos === 'ol' && st.word === 'Teil' && st.dur === '0' && st.size === '100 %', st);
await shot('blatt-kennzeichnung');
const w0 = (await ev(() => HX.rect('#partOv img'))).w;
await page.click('#ptPos [data-p="ur"]'); await sleep(150);
await page.fill('#ptWord', 'Folge'); await sleep(150);
await page.selectOption('#ptDur', '5'); await sleep(150);
await ev(() => { const s = document.querySelector('#ptSize'); s.value = '1.4'; s.dispatchEvent(new Event('input', { bubbles: true })); }); await sleep(200);
st = await ev(() => ({ st: P.partStyle, text: partText(), img: HX.rect('#partOv img'), undo: undo.length, lbl: document.querySelector('#ptPrev').textContent, at6: (seekOut(6, false), !!document.querySelector('#partOv img')), plan: (seekOut(0, false), buildPlan().overlays.find(x => x.part)) }));
chk('Ecke, Bezeichnung und Größe wirken sofort im Bild', st.st.pos === 'ur' && st.text === 'Folge 2/3' && st.lbl === 'Folge 2/3' && st.img && st.img.r > 0.02 && st.img.r < 0.08 && st.img.b > 0.01 && st.img.b < 0.05 && st.img.w > w0 * 1.3, st);
chk('mit „erste 5 s“ verschwindet sie danach – in der Vorschau und im Plan', st.st.dur === 5 && st.at6 === false && st.plan.out === 5 && st.st.size === 1.4, [st.at6, st.plan.out]);
chk('die Änderungen im Blatt sind zusammen ein Rückgängig-Schritt', st.undo === u1 + 1, [u1, st.undo]);
await ev(() => closeSheet()); await sleep(300);
st = await ev(s => ({ toast: document.querySelector('#toast').textContent, sib: s.clips.map(c => (J(TS.loadProject(c.id)).partStyle || {})) }), ser);
chk('beim Schließen übernehmen die anderen Clips der Reihe Ecke, Bezeichnung, Dauer und Größe', /für die 2 anderen Clips der Reihe übernommen/.test(st.toast) && [0, 2].every(k => st.sib[k].pos === 'ur' && st.sib[k].word === 'Folge' && st.sib[k].dur === 5 && st.sib[k].size === 1.4), st);
await page.click('#undoBtn'); await sleep(1300);
st = await ev(s => ({ st: P.partStyle || null, text: partText(), img: HX.rect('#partOv img'), sib: s.clips.map(c => J(TS.loadProject(c.id)).partStyle || null) }), ser);
chk('Rückgängig stellt die Kennzeichnung zurück – auch in den anderen Clips', st.st === null && st.text === 'Teil 2/3' && st.img.l < 0.08 && st.img.t < 0.05 && st.sib[0] === null && st.sib[2] === null, st);
// aus/an
await page.click('#clipPartBtn'); await sleep(250); await page.click('#ptOn'); await sleep(200);
st = await ev(() => ({ on: partOn(), img: !!document.querySelector('#partOv img'), plan: buildPlan().overlays.filter(x => x.part).length, info: document.querySelector('#clipSeriesInfo').textContent }));
const off = !st.on && !st.img && st.plan === 0 && /ausgeschaltet/.test(st.info);
await page.click('#ptOn'); await sleep(200); await ev(() => closeSheet());
chk('ausgeschaltet steht sie weder im Bild noch im Plan; wieder eingeschaltet ist sie zurück', off && (await ev(() => partOn() && !!document.querySelector('#partOv img'))), st);
// Schutzzonen, Wasserzeichen, Bauchbinde
st = await ev(m => { const [W, H] = outSize(), b0 = partBox(W, H); setSafe('tiktok');
  const b1 = partBox(W, H), z = safeZone();
  P.watermark = { ...WM_DEF, clip: { uri: m + 'logo.png', name: 'logo.png', kind: 'image', width: 256, height: 256, duration: 5 }, pos: 'ol', on: true }; const wm = wmRect(W, H), b2 = partBox(W, H);
  delete P.watermark; P.lower = { pos: 'ol' }; lowerRects.clear(); const lr = lowerRect({ key: 'probe', w: 220, h: 70 }, W, H); delete P.lower; lowerRects.clear();
  setSafe(''); return { W, H, b0, b1, z, wm, b2, lr }; }, MEDIA);
chk('mit Schutzzonen rückt die Kennzeichnung in die freie Fläche', st.z && st.b1.y >= st.z.t * st.H - 0.5 && st.b1.x >= st.z.l * st.W - 0.5 && st.b1.y > st.b0.y + 5, [st.b0, st.b1, st.z]);
chk('ein Wasserzeichen in derselben Ecke bleibt frei: Die Kennzeichnung steht darunter', st.b2.y >= st.wm.cy + st.wm.h / 2 - 0.5, [st.wm, st.b2]);
chk('eine Bauchbinde in derselben Ecke weicht der Kennzeichnung aus', st.lr.y >= st.b1.y + st.b1.h - 0.5, [st.b1, st.lr]);
// Hausstil
st = await ev(() => { commit(() => { P.partStyle = { pos: 'or', size: 1.2, dur: 3, word: 'Part' }; }, false);
  const h = houseOf(), p1 = { settings: {}, partStyle: { pos: 'ul' } }, p2 = { settings: {}, partStyle: { pos: 'ul' } }, old = { ...h }; delete old.part;
  houseInto(p1, h); houseInto(p2, old); undo.pop(); delete P.partStyle; partChanged(); return { h: h.part, p1: p1.partStyle, p2: p2.partStyle }; });
chk('das Aussehen der Kennzeichnung gehört zum Hausstil; ältere Vorlagen lassen es unberührt', st.h && st.h.pos === 'or' && st.h.word === 'Part' && st.p1.pos === 'or' && st.p1.dur === 3 && st.p2.pos === 'ul', st);

// ═════════ F4 · Hook-Varianten ═════════
await ev(() => { document.querySelector('#clipHookAlts').open = true; });
st = await ev(() => ({ b: document.querySelector('#clipHookB').disabled, c: document.querySelector('#clipHookC').disabled, ph: document.querySelector('#clipHookB').placeholder, vars: hookVars().length }));
chk('ohne Hook sind die Varianten gesperrt', st.b && st.c && /erst oben den Hook einblenden/.test(st.ph) && st.vars === 0, st);
await page.fill('#clipHook', 'Was tun gegen hohe Mieten?'); await page.click('#clipHookSet'); await sleep(350);
st = await ev(() => ({ h: hookItem(), b: document.querySelector('#clipHookB').disabled, btn: (setTab('export'), document.querySelector('#exBtn').textContent), plans: videoPlans().length }));
chk('der Hook steht unter „Teil 2/3“; ohne Varianten bleibt der Export bei einer Datei', st.h && st.h.y === 0.24 && !st.b && st.btn === 'Video exportieren' && st.plans === 1, st);
await ev(() => setTab('clip'));
const u2 = await ev(() => undo.length);
await page.fill('#clipHookB', 'Drei Schritte, die jede Hausgemeinschaft gehen kann'); await page.dispatchEvent('#clipHookB', 'change'); await sleep(250);
await page.fill('#clipHookC', 'Dein Haus kann mehr, als du denkst'); await page.dispatchEvent('#clipHookC', 'change'); await sleep(250);
st = await ev(() => ({ vars: hookVars(), alts: hookItem().alts, n: document.querySelector('#clipHookAltN').textContent, undo: undo.length, toast: document.querySelector('#toast').textContent }));
chk('Variante B und C gehören zum Hook und werden beim Verlassen des Felds gespeichert', st.vars.map(v => v.tag).join('') === 'ABC' && st.vars[1].text === 'Drei Schritte, die jede Hausgemeinschaft gehen kann' && st.alts.length === 2 && st.n === '· 3 Dateien im Export' && st.undo === u2 + 2 && /3 Hook-Varianten/.test(st.toast), st);
await shot('clip-hook');
// Pläne
st = await ev(() => { const keep = exFmt; exFmt = 'video'; const pl = videoPlans(), t = p => p.subs.cues.filter(c => c.title).map(c => c.text.replace(/\s+/g, ' ')), rest = p => JSON.stringify([p.segments, p.subs.cues.filter(c => !c.title), p.overlays, p.total, p.width, p.height]); exFmt = 'audio'; const au = videoPlans(); exFmt = keep;
  return { names: pl.map(p => p.name), tags: pl.map(p => p.hook), titles: pl.map(t), same: rest(pl[0]) === rest(pl[1]) && rest(pl[1]) === rest(pl[2]), hook: hookItem().text, audio: [au.length, au[0].name, 'hook' in au[0]] }; });
chk('der Export baut je Variante einen Plan: gleiche Schnitte und Einblendungen, eigener Titel, eigener Dateiname', st.names.join('|') === 'serie – Teil 2_geschnitten_Hook-A|serie – Teil 2_geschnitten_Hook-B|serie – Teil 2_geschnitten_Hook-C' && st.tags.join('') === 'ABC' && st.titles[0][0] === 'Was tun gegen hohe Mieten?' && st.titles[1][0] === 'Drei Schritte, die jede Hausgemeinschaft gehen kann' && st.titles[2][0] === 'Dein Haus kann mehr, als du denkst' && st.same && st.hook === 'Was tun gegen hohe Mieten?', st);
chk('der Audio-Export bleibt bei einer Datei', st.audio[0] === 1 && !/Hook/.test(st.audio[1]) && !st.audio[2], st.audio);
// tauschen
await page.click('#clipHookAlts [data-swap="1"]'); await sleep(300);
st = await ev(() => ({ a: hookItem().text, alts: hookItem().alts, fa: document.querySelector('#clipHook').value, fc: document.querySelector('#clipHookC').value, shown: [...document.querySelectorAll('#stage .titlebox')].map(e => e.textContent.replace(/\s+/g, ' ').trim()), toast: document.querySelector('#toast').textContent }));
chk('„mit A tauschen“ zeigt die Variante im Bild', st.a === 'Dein Haus kann mehr, als du denkst' && st.alts[1] === 'Was tun gegen hohe Mieten?' && st.fa === st.a && st.fc === 'Was tun gegen hohe Mieten?' && st.shown.some(t => t === st.a) && /Variante C steht jetzt als A im Bild/.test(st.toast), st);
await page.click('#undoBtn'); await sleep(250);
chk('Rückgängig tauscht zurück', (await ev(() => hookItem().text === 'Was tun gegen hohe Mieten?' && hookItem().alts[1] === 'Dein Haus kann mehr, als du denkst' && document.querySelector('#clipHook').value === 'Was tun gegen hohe Mieten?')));
// Variante C leeren → A und B bleiben
await page.fill('#clipHookC', ''); await page.dispatchEvent('#clipHookC', 'change'); await sleep(250);
await ev(() => setTab('export')); await sleep(250);
st = await ev(() => ({ vars: hookVars().map(v => v.tag).join(''), btn: document.querySelector('#exBtn').textContent, title: document.querySelector('#exBtn').title, sum: document.querySelector('#exSummary').textContent }));
chk('der Export-Reiter nennt die Varianten am Knopf und in der Zusammenfassung', st.vars === 'AB' && st.btn === '2 Hook-Varianten exportieren' && /Je Hook-Variante entsteht eine Datei/.test(st.title) && /· 2 Hook-Varianten$/.test(st.sum), st);
await ev(() => { document.querySelector('#exLevel').checked = false; P.settings.level = false; });
await page.click('#exBtn'); await sleep(900);
st = await ev(() => ({ direct: exDirect, q: EXQ.map(x => x.name), toast: document.querySelector('#toast').textContent, text: EXQ.map(x => !!(x.plan && x.plan.textfile) || !!x.tv) }));
chk('„… exportieren“ reiht je Variante einen Export ein', !st.direct && st.q.join('|') === 'serie – Teil 2_geschnitten_Hook-A|serie – Teil 2_geschnitten_Hook-B' && /2 Hook-Varianten eingereiht/.test(st.toast), st);
await clearQ();
await ev(() => openPack()); await sleep(250);
st = await ev(() => ({ hint: /Hook-Varianten: Das Paket nimmt Variante A/.test(document.querySelector('#sheetBody').textContent), title: packWith(PACK[0], () => buildPlan(true)).subs.cues.filter(c => c.title).map(c => c.text.replace(/\s+/g, ' '))[0] }));
chk('das Export-Paket nimmt Variante A und sagt das', st.hint && st.title === 'Was tun gegen hohe Mieten?', st);
await ev(() => { closeSheet(); setTab('clip'); });
await ev(() => document.querySelector('#clipHookAlts').scrollIntoView({ block: 'center' })); await sleep(200); await shot('clip-hook-karte');

// ═════════ F2 · Gemeinsam exportieren ═════════
const boxes = {};
for (const k of [0, 1]) { await open(ser.clips[k].id); boxes[k] = await ev(() => { const [W, H] = outSize(), b = partBox(W, H); P.settings.burn = false; P.settings.level = false; saveNow(); return { W, H, b, total }; }); }
await open(idS); await ev(() => { setTab('text'); seekOut(33, false); commit(() => { P.settings.level = false; }, false); openClips('series'); }); await sleep(300);
const before = await ev(() => ({ undo: undo.length, snap: snapshot(), pos: outPos }));
// Das Fenster mit dem Fortschritt steht nur, solange die Clips vorbereitet werden: in der Seite ablesen, sobald es erscheint
// (auf einem schnellen Rechner war es sonst schon wieder zu, bevor die Prüfung nachsah)
const modalP = ev(() => new Promise(res => { const t0 = Date.now(); (function look(){ const m = document.querySelector('#hcModal #bxMsg');
  if (exBatch && m) return res(document.querySelector('#hcModal').textContent.replace(/\s+/g, ' ')); if (Date.now() - t0 > 15000) return res(''); requestAnimationFrame(look); })(); }));
await page.click('.cl-ser [data-a="sexp"]');
const modal = await modalP;
await page.waitForFunction(() => !exBatch, null, { timeout: 180000 }); await sleep(600);
st = await ev(() => ({ id: P && P.id, tab, pos: outPos, undo: undo.length, snap: snapshot(), q: EXQ.map(x => [x.name, x.status, x.info, x.proj]), sheet: !!document.querySelector('#queueSheetList') && !document.querySelector('#sheet').classList.contains('hidden'), modal: !!document.querySelector('#hcModal'), toast: document.querySelector('#toast').textContent }));
chk('„Alle exportieren“ öffnet jeden Clip kurz und zeigt den Fortschritt', /„Reihe 1“ exportieren/.test(modal) && /Clip \d von 3|Wird vorbereitet/.test(modal) && /Abbrechen/.test(modal), modal.slice(0, 160));
chk('je Clip steht ein Export in der Warteschlange, je Hook-Variante einer mehr – benannt nach dem Clip', st.q.map(x => x[0]).join('|') === 'serie – Teil 1|serie – Teil 2_Hook-A|serie – Teil 2_Hook-B|serie – Teil 3' && st.q.every((x, k) => x[3] === ser.clips[[0, 1, 1, 2][k]].id && /· Video · 360×640 · 0:2[2-8]$/.test(x[2])) && /4 Exporte eingereiht/.test(st.toast), st.q);
chk('danach ist das Ausgangsprojekt wieder offen: derselbe Reiter, dieselbe Stelle, derselbe Rückgängig-Verlauf', st.id === idS && st.tab === 'text' && Math.abs(st.pos - before.pos) < 0.05 && st.undo === before.undo && st.snap === before.snap && !st.modal && st.sheet, [st.id, st.tab, st.pos, st.undo]);
await idle(); await sleep(300);
const res = await q(); for (const x of res) for (const f of x.files) trash.add(f);
const vids = res.map(x => x.files.find(f => /\.mp4$/.test(f)));
chk('alle vier Exporte laufen durch', res.length === 4 && res.every(x => x.st === 'done') && vids.every(f => f && fs.existsSync(f)), res.map(x => [x.name, x.st, x.err]));
if (vids.every(Boolean)) {
  const d = vids.map(dur), wh = vids.map(dims);
  chk('die Videos haben Format und Länge ihrer Clips', wh.every(x => x[0] === 360 && x[1] === 640) && Math.abs(d[0] - boxes[0].total) < 0.2 && Math.abs(d[1] - boxes[1].total) < 0.2 && Math.abs(d[2] - boxes[1].total) < 0.2 && Math.abs(d[3] - (secs3[2][1] - secs3[2][0])) < 0.2, [d, wh]);
  // Kennzeichnung im Bild: innen die dunkle Fläche des Designprofils, rechts daneben das Video
  const b = boxes[0].b, px = (buf, x, y) => { const i = (Math.round(y) * 360 + Math.round(x)) * 3; return [buf[i], buf[i + 1], buf[i + 2]]; };
  const f1 = frame(vids[0], 1), inner = px(f1, b.x + b.w - 3, b.y + b.h / 2), outer = px(f1, b.x + b.w + 10, b.y + b.h / 2), bar = px(f1, b.x + 1, b.y + b.h / 2);
  chk('im Video steht die Kennzeichnung an ihrer Stelle: dunkle Fläche mit rotem Balken, daneben das Bild', inner.every(v => v < 70) && outer.some(v => v > 150) && bar[0] > 150 && bar[1] < 110 && bar[2] < 90, { inner, outer, bar, b });
  // Hook-Varianten: oben verschieden, solange der Hook steht; danach gleich
  const top = 'crop=360:240:0:60', low = 'crop=360:200:0:400';
  const dTop = diff(frame(vids[1], 1, top), frame(vids[2], 1, top)), dLow = diff(frame(vids[1], 1, low), frame(vids[2], 1, low)), dLate = diff(frame(vids[1], 6, top), frame(vids[2], 6, top));
  chk('die beiden Hook-Dateien unterscheiden sich nur im Titel und nur, solange er steht', dTop > 0.03 && dLow < 0.01 && dLate < 0.01, { dTop, dLow, dLate });
}
await ev(() => { EXQ.length = 0; paintQueue(); closeSheet(); });
// aus einem Clip heraus
await open(ser.clips[2].id);
await page.click('#clipSeriesEx'); await page.waitForFunction(() => exBatch, null, { timeout: 15000 }).catch(() => {});
await page.waitForFunction(() => !exBatch && EXQ.length >= 4, null, { timeout: 180000 }); await sleep(400);
st = await ev(() => ({ id: P && P.id, tab, n: EXQ.length }));
chk('„Alle Teile exportieren“ im Clip reiht dieselben Exporte ein und kehrt in den Clip zurück', st.id === ser.clips[2].id && st.tab === 'clip' && st.n === 4, st);
await clearQ(); await ev(() => closeSheet());

// Reihe: ein Clip fehlt → neu nummerieren; auflösen
await open(idS);
await ev(s => { HX.drop([s.clips[1].id]); openClips('series'); }, ser); await sleep(300);
st = await ev(() => ({ head: document.querySelector('.cl-ser-n span').textContent, rows: [...document.querySelectorAll('.cl-ser .cl-row .mono')].map(e => e.textContent), menu: seriesMenu(P.clipSeries[0]).map(m => m.label) }));
chk('fehlt ein Clip, zeigt die Reihe die übrigen und bietet „Neu nummerieren“', /^2 Clips · 9:16/.test(st.head) && st.rows.join() === '1/3,3/3' && st.menu.includes('Neu nummerieren (1 bis 2)'), st);
await page.click('.cl-ser [data-a="smenu"]'); await sleep(200); await page.click('#ctxMenu button:nth-child(2)'); await sleep(400);
st = await ev(() => ({ clips: P.clipSeries[0].clips.map(c => { const p = J(TS.loadProject(c.id)); return [p.name, p.part.k, p.part.n, p.part.ids.length]; }), rows: [...document.querySelectorAll('.cl-ser .cl-row .mono')].map(e => e.textContent), toast: document.querySelector('#toast').textContent }));
chk('„Neu nummerieren“ zählt die Clips durch und zieht ihre Namen nach', st.clips.map(c => c.join()).join('|') === 'serie – Teil 1,1,2,2|serie – Teil 2,2,2,2' && st.rows.join() === '1/2,2/2' && st.toast === '2 Clips neu nummeriert', st);
await page.click('.cl-ser [data-a="smenu"]'); await sleep(200);
await ev(() => [...document.querySelectorAll('#ctxMenu button')].find(b => /auflösen/.test(b.textContent)).click()); await sleep(400);
st = await ev(s => ({ n: P.clipSeries.length, left: s.clips.filter(c => J(TS.listProjects()).some(p => p.id === c.id)).length, txt: document.querySelector('#clSheet p').textContent }), ser);
chk('„Reihe auflösen“ nimmt sie aus der Liste, die Clips bleiben', st.n === 0 && st.left === 2 && /Noch keine Clip-Reihe/.test(st.txt), st);

// ═════════ F3 · Zusammenschnitt ═════════
await ev(() => { clipsView = 'list'; renderClipsSheet(); }); await sleep(200);
await page.click('#clFmt [data-fmt="1:1"]'); await sleep(150);
const sum3 = secs3.reduce((s, r) => s + r[1] - r[0], 0);
st = await ev(() => ({ fmt: localStorage.getItem('hc-clipfmt'), on: document.querySelector('#clFmt .on').textContent, btn: document.querySelector('#clSheet [data-a="best"]').textContent }));
chk('das gewählte Format bleibt für das nächste Mal stehen', st.fmt === '1:1' && st.on === '1:1' && /^Zusammenschnitt \(1:1[34]\)$/.test(st.btn), st);
await page.click('#clSheet [data-a="best"]');
await page.waitForFunction(() => P && P.clipOf && tab === 'clip' && /Best of/.test(P.name), null, { timeout: 30000 }); await sleep(1000);
st = await ev(() => ({ id: P.id, name: P.name, total, fmt: P.format, ranges: P.clipRanges, range: P.clipRange, part: 'part' in P, list: 'clipList' in P, card: document.querySelector('#clipSeriesCard').classList.contains('hidden'), segs: timeline.filter(g => g.kind === 'main').length, text: HX.text(order), frame: P.frame, cover: +coverSc().toFixed(3), cues: P.cues.length, sheet: !document.querySelector('#sheet').classList.contains('hidden'), toast: document.querySelector('#toast').textContent }));
made.push(st.id);
chk('„Zusammenschnitt“ sammelt alle vorgemerkten Abschnitte in einem Clip und öffnet ihn', st.name === 'serie – Best of' && Math.abs(st.total - sum3) < 0.02 && st.segs === 3 && st.ranges.length === 3 && Math.abs(st.range[0] - secs3[0][0]) < 0.002 && Math.abs(st.range[1] - secs3[2][1]) < 0.002 && /Zusammenschnitt erstellt/.test(st.toast) && !st.sheet, [st.name, st.total, sum3, st.segs]);
chk('die Abschnitte stehen in der Reihenfolge des Videos, ohne das Dazwischen', st.text === texts3.join(' '), st.text.slice(0, 80));
chk('er ist ein gewöhnlicher Clip: eigenes Format, das Bild füllt die Leinwand, Untertitel erzeugt, keine Kennzeichnung', st.fmt === '1:1' && st.frame && Math.abs(st.frame.sc - st.cover) < 0.002 && st.cues > 5 && !st.part && !st.list && st.card, st);
await shot('zusammenschnitt');
// überlappende Abschnitte verschmelzen; ein Bereich schneidet wie der bisherige Clip
await open(idS);
st = await ev(() => { const c = clipData([[5, 20], [15, 30], [60, 70]], '', 'x'), kept = (c.tokens || []).length; let t = 0; const cut = c.dels.reduce((s, d) => s + d[1] - d[0], 0); return { ranges: c.clipRanges, range: c.clipRange, keptDur: +(P.sources[0].duration - cut).toFixed(2) }; });
chk('überlappende Abschnitte zählen im Zusammenschnitt nur einmal', st.ranges.length === 2 && st.ranges[0].join() === '5,30' && st.ranges[1].join() === '60,70' && Math.abs(st.keptDur - 35) < 0.3, st);
const idStress = await scratch(page, ids().stress); made.push(idStress);
st = await ev(() => {
  // der Schnitt eines einzelnen Clips, wie er bis 2.32 gerechnet wurde
  const old = (o1, o2, fmt) => { const c = JSON.parse(JSON.stringify(P)), cut = [];
    for (const g of timeline){ const d = segDur(g), a = g.o, e = g.o + d;
      if (g.kind === 'insert'){ if (e <= o1 + 0.01 || a >= o2 - 0.01) c.items = c.items.filter(x => x.id !== g.item.id); continue; }
      const sp = g.speed || 1, ka = Math.max(a, o1), kb = Math.min(e, o2);
      if (kb <= ka + 0.01){ cut.push([g.in, g.out]); continue; }
      if (ka > a + 0.001) cut.push([g.in, g.in + (ka - a) * sp]);
      if (kb < e - 0.001) cut.push([g.in + (kb - a) * sp, g.out]); }
    c.dels = (c.dels || []).concat(cut.map(([x, y]) => [r3(x), r3(y)])).sort((p, q) => p[0] - q[0]).reduce((acc, r) => { const l = acc[acc.length - 1]; if (l && r[0] <= l[1] + 1e-3) l[1] = Math.max(l[1], r[1]); else acc.push([...r]); return acc; }, []);
    c.items = c.items.filter(x => { if (x.type === 'insert') return true; const [a, e] = itemOutRange(x); return e > o1 + 0.05 && a < o2 - 0.05; });
    c.cues = c.cues.filter(x => { if (!x.own) return true; const t = cueTimes(x); return t && t.e > o1 && t.s < o2; });
    c.marks = (c.marks || []).filter(m => { const o = markOut(m); return o >= o1 - 0.05 && o < o2 - 0.05 && !isSrcDeleted(m.at); });
    c.refs = (c.refs || []).filter(r => { const o = refOut(r); return !refGone(r) && o >= o1 - 0.05 && o < o2 - 0.05; });
    return [c.dels, c.items.map(x => x.id), c.cues.length, c.marks.map(m => m.id), c.refs.map(r => r.id)]; };
  saveNow(); const out = [];
  for (const [a, b] of [[10, 200], [0, 12.5], [33.3, 61.7], [total - 20, total]]){ const c = clipData([[a, b]], '9:16', 'x'); out.push(JSON.stringify(old(a, b)) === JSON.stringify([c.dels, c.items.map(x => x.id), c.cues.length, c.marks.map(m => m.id), c.refs.map(r => r.id)]) && !('clipRanges' in c) && c.clipRange.join() === [r3(a), r3(b)].join()); }
  return { out, items: P.items.length, segs: timeline.length, dels: P.dels.length };
});
chk('ein einzelner Bereich ergibt denselben Schnitt wie der bisherige Clip (Projekt mit vielen Elementen, vier Bereiche)', st.out.every(Boolean) && st.items > 5 && st.segs > 3, st);
// Bildausschnitt bei anderem Format
st = await ev(() => { commit(() => { P.format = '9:16'; P.frame = clampFrame({ sc: coverSc(), tx: 0.2, ty: 0 }); }, true); const same = clipData([[5, 20]], '9:16', 'x'), other = clipData([[5, 20]], '1:1', 'x'), orig = clipData([[5, 20]], '', 'x'); const r = { same: same.frame, other: 'frame' in other, orig: 'frame' in orig, fr: P.frame }; undo.pop(); return r; });
chk('ein Clip im Format des Projekts übernimmt dessen Bildausschnitt; in einem anderen Format wird er neu gesetzt', st.same && st.same.tx === st.fr.tx && st.same.sc === st.fr.sc && !st.other && !st.orig, st);
await leave(); await ev(i => HX.drop([i]), idStress);

// ═════════ C9 · Suche über alle Projekte ═════════
const idCopy = await scratch(page, idS); made.push(idCopy);
await ev(() => { setTab('text'); HX.pick(HX.at('Volksentscheid'), HX.at('Volksentscheid') + 2); document.querySelector('#selDel').click(); saveNow(); }); await sleep(200);
await leave(); await sleep(400);
const find = async text => { await page.fill('#projFind', text); await ev(() => { findDoneQ = null; }); await page.press('#projFind', 'Space'); await page.press('#projFind', 'Backspace'); await page.waitForFunction(t => findDoneQ === t.trim(), text, { timeout: 60000 }); await sleep(150);
  return ev(() => ({ hidden: document.querySelector('#findHits').classList.contains('hidden'), h: (document.querySelector('.fh-h') || {}).textContent || '', projs: [...document.querySelectorAll('.fh-proj')].map(p => ({ name: p.querySelector('b').textContent, n: p.querySelector('.fh-name span').textContent, rows: [...p.querySelectorAll('.fh-row')].map(r => ({ t: r.querySelector('.mono').textContent, mark: r.querySelector('mark').textContent, text: r.querySelector('.fh-t').textContent.replace(/\s+/g, ' ').trim() })), more: (p.querySelector('[data-a="more"]') || {}).textContent })),
    items: [...document.querySelectorAll('#projList .proj-item b')].map(b => b.textContent), none: (document.querySelector('#projList .home-none') || {}).textContent || '', ph: document.querySelector('#projFind').placeholder, row: !document.querySelector('#homeFind').classList.contains('hidden') })); };
let f = await find('Volksentscheid zur');
chk('die Suchzeile der Projektliste findet auch, was in den Videos gesagt wird', f.row && f.ph === 'Projekte und Text durchsuchen' && !f.hidden && f.h === 'Im gesprochenen Text · 1 Treffer' && f.projs.length === 1 && f.projs[0].name === 'serie' && f.projs[0].rows[0].mark === 'Volksentscheid zur', f);
chk('der Treffer zeigt Zeit und Umgebung; herausgeschnittene Wörter zählen nicht (die Kopie hat die Stelle geschnitten)', /^1:3\d$/.test(f.projs[0].rows[0].t) && /Politik machen\. Der Volksentscheid zur Vergesellschaftung hat gezeigt/.test(f.projs[0].rows[0].text) && !f.projs.some(p => /^Test tmp/.test(p.name)), f.projs[0].rows[0]);
chk('passt kein Projektname, stehen nur die Treffer aus dem Text da', f.items.length === 0 && f.none === '', f.none);
const noHit = await find('Quittenmarmelade');
chk('ohne Treffer bleibt der bisherige Hinweis', noHit.hidden && noHit.items.length === 0 && noHit.none === 'Kein Projekt passt zu „Quittenmarmelade“.', noHit.none);
await shot('suche');
f = await find('Mietendeckel wurde');
chk('Clips bleiben außen vor, solange es ihr Hauptprojekt gibt – der Treffer steht dort', f.projs.map(p => p.name).sort().join('|') === ['serie', 'Test ' + idCopy].sort().join('|') && f.h === 'Im gesprochenen Text · 2 Treffer in 2 Projekten', f.projs.map(p => p.name));
f = await find('entscheid');
const sp = f.projs.find(p => p.name === 'serie');
chk('ein einzelnes Wort ab vier Buchstaben findet auch Zusammensetzungen', sp && sp.n === '4 Treffer' && sp.rows.map(r => r.mark.replace(/[.,]/g, '')).join('|') === 'Entscheidungen|Entscheidungen|Volksentscheid|Entscheid', sp);
f = await find('tun');
chk('kurze Wörter (drei Buchstaben) zählen am Wortanfang', f.projs.find(p => p.name === 'serie').rows.map(r => r.mark).join('|') === 'tun?', f.projs.map(p => [p.name, p.rows.map(r => r.mark)]));
f = await find('zu');
chk('unter drei Buchstaben wird nicht im Text gesucht', f.hidden && f.projs.length === 0, f.h);
f = await find('wir');
const many = f.projs.find(p => p.name === 'serie');
chk('je Projekt stehen zunächst vier Treffer da, „Weitere … zeigen“ holt die übrigen', many && many.rows.length === 4 && /^Weitere \d+ zeigen$/.test(many.more) && parseInt(many.n, 10) > 4, many && [many.n, many.more]);
await ev(() => [...document.querySelectorAll('.fh-proj')].find(p => p.querySelector('b').textContent === 'serie').querySelector('[data-a="more"]').click()); await sleep(200);
chk('danach sind alle Treffer des Projekts zu sehen', (await ev(() => { const p = [...document.querySelectorAll('.fh-proj')].find(p => p.querySelector('b').textContent === 'serie'); return [p.querySelectorAll('.fh-row').length, parseInt(p.querySelector('.fh-name span').textContent, 10), !!p.querySelector('[data-a="more"]')]; })).join() === [parseInt(many.n, 10), parseInt(many.n, 10), false].join());
f = await find('serie');
chk('die Suche nach Namen bleibt, wie sie war', f.items.length >= 3 && f.items.every(n => /serie/i.test(n)) && f.none === '' && f.hidden, f.items);
await page.press('#projFind', 'Escape'); await sleep(300);
chk('Esc leert Suche und Treffer', (await ev(() => document.querySelector('#projFind').value === '' && document.querySelector('#findHits').classList.contains('hidden') && document.querySelectorAll('#projList .proj-item').length === homeList.length)));
// Sprung zur Stelle
f = await find('Aushang im');
await ev(() => [...document.querySelectorAll('.fh-proj')].find(p => p.querySelector('b').textContent === 'serie').querySelector('.fh-go').click());
await page.waitForFunction(i => P && P.id === i && selA != null, idS, { timeout: 30000 }); await sleep(500);
st = await ev(() => ({ tab, sel: HX.text(selIds()), pos: outPos, want: srcToOut(tokens[selA].ws), vis: (r => r.top > 60 && r.bottom < innerHeight - 20)(spans[selA].getBoundingClientRect()), modal: !!document.querySelector('#hcModal') }));
chk('ein Treffer öffnet das Projekt an der Stelle: Wörter markiert, im Text sichtbar, Abspiellinie dort', st.tab === 'text' && st.sel === 'Aushang im' && Math.abs(st.pos - st.want) < 0.05 && st.vis && !st.modal, st);
await shot('suche-sprung');
await leave(); await sleep(500);
st = await ev(() => ({ q: document.querySelector('#projFind').value, rows: document.querySelectorAll('.fh-row').length }));
chk('zurück in der Projektliste stehen Suche und Treffer noch da', st.q === 'Aushang im' && st.rows >= 1, st);
// als Clip übernehmen
await ev(() => [...document.querySelectorAll('.fh-proj')].find(p => p.querySelector('b').textContent === 'serie').querySelector('[data-a="clip"]').click());
await page.waitForFunction(i => P && P.id === i && document.querySelector('#hcModal #clipGo'), idS, { timeout: 30000 }); await sleep(300);
st = await ev(() => ({ sel: HX.text(selIds()), dlg: document.querySelector('#hcModal p').textContent, keep: !!document.querySelector('#clipKeep'), name: document.querySelector('#clipName').value }));
chk('„Als Clip“ markiert den ganzen Satz und öffnet den Clip-Dialog', st.sel === 'Ein Aushang im Treppenhaus reicht oft für den Anfang.' && /wird ein eigenes Kurzvideo/.test(st.dlg) && st.keep && /^serie – Clip \d+$/.test(st.name), st);
await ev(() => { closeHcModal(); clearSel(); });
// der Index folgt Änderungen
await ev(() => { const i = order[HX.at('Aushang')]; commit(() => { P.edits[i] = 'Zettel'; }, false); if (spans.length) paint(i); saveNow(); });
await leave(); await sleep(400);
f = await find('Zettel im');
const edited = f.projs.length === 1 && f.projs[0].name === 'serie' && f.projs[0].rows[0].mark === 'Zettel im';
f = await find('Aushang im');
chk('nach einer Änderung im Projekt sucht die Liste im neuen Stand', edited && !f.projs.some(p => p.name === 'serie') && f.projs.some(p => p.name === 'Test ' + idCopy), [edited, f.projs.map(p => p.name)]);
await page.press('#projFind', 'Escape'); await sleep(200);

// ═════════ Handy ═════════
const hp = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage(); hp.on('dialog', d => d.accept().catch(() => {}));
await hp.goto(page.url()); await hp.waitForFunction(() => typeof showHome === 'function');
const hev = (f, a) => hp.evaluate(f, a);
await injectT(hp);
await hev(i => openProject(i), idS); await hp.waitForFunction(i => P && P.id === i && spans.length > 0, idS, { timeout: 30000 }); await sleep(500);
await hev(() => { setTab('text'); const w = order.filter(i => tokens[i].type === 'word'); selA = w[70]; selB = w[95]; showSel(); }); await sleep(250);
st = await hev(() => ({ list: getComputedStyle(document.querySelector('#selList')).display, rows: new Set([...document.querySelectorAll('#selbar .sb')].filter(x => x.offsetParent).map(x => Math.round(x.getBoundingClientRect().top))).size }));
chk('Handy: Die Auswahlleiste bleibt zweizeilig, „Vormerken“ steht im Clip-Dialog', st.list === 'none' && st.rows === 2, st);
await hp.click('#selClip'); await sleep(300);
st = await hev(() => { const m = document.querySelector('#hcModal .hc-card').getBoundingClientRect(), k = document.querySelector('#clipKeep').getBoundingClientRect(), g = document.querySelector('#clipGo').getBoundingClientRect(); return { fit: m.left >= 0 && m.right <= innerWidth && m.bottom <= innerHeight, keep: k.width > 60 && k.right <= m.right, go: g.right <= m.right + 1 && g.top >= k.top - 1, order: g.left > k.left }; });
chk('Handy: Der Dialog passt, „Vormerken“ und „Clip öffnen“ stehen nebeneinander', st.fit && st.keep && st.go && st.order, st);
await hp.screenshot({ path: path.join(OUT, 'clips-handy-dialog.png') });
await hp.click('#clipKeep'); await sleep(250);
await hev(() => document.querySelector('#clipsBtn').scrollIntoView({ inline: 'center' })); await hp.click('#clipsBtn'); await sleep(400);
st = await hev(() => { const s = document.querySelector('#sheet').getBoundingClientRect(); return { open: clipsSheetOpen(), n: document.querySelectorAll('#clSheet .cl-row').length, wide: [...document.querySelectorAll('#clSheet *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).length, h: s.height / innerHeight }; });
chk('Handy: Das Blatt zeigt die Liste, nichts ragt über den Rand', st.open && st.n === 4 && st.wide === 0 && st.h <= 0.56, st);
chk('Handy: Der Hinweis im leeren Blatt nennt den Weg über den Clip-Dialog', await hev(() => { const keep = P.clipList; P.clipList = []; const h = clipsListHtml(); P.clipList = keep; return /„Clip“ wählen und dort „Vormerken“/.test(h) && !/Taste V/.test(h); }));
await hp.screenshot({ path: path.join(OUT, 'clips-handy-blatt.png') });
await hev(() => { clipsView = 'sug'; renderClipsSheet(); }); await sleep(250);
st = await hev(() => { const r = document.querySelector('#clSheet .cl-row.sug'), g = r.querySelector('.mk-go').getBoundingClientRect(), b = r.querySelector('.btn, .cl-on').getBoundingClientRect(); return { below: b.top >= g.bottom - 2, textW: g.width, wide: [...document.querySelectorAll('#clSheet *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).length }; });
chk('Handy: In den Vorschlägen steht „Übernehmen“ unter dem Text, der dadurch die ganze Breite hat', st.below && st.textW > 300 && st.wide === 0, st);
await hp.screenshot({ path: path.join(OUT, 'clips-handy-vorschlaege.png') });
await hev(() => { commit(() => { P.clipList = P.clipList.filter(x => ['Warum', 'Was', 'Am'].includes(HX.first(x))); }, false); closeSheet(); pausePlay(); clearTimeout(saveT); saveNow(); closeProject(); });
await hev(() => { document.querySelector('#projFind').value = 'Hausgemeinschaft'; renderHome(); }); await sleep(1500);
st = await hev(() => ({ rows: document.querySelectorAll('.fh-row').length, wide: [...document.querySelectorAll('#findHits *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1).length, btn: (document.querySelector('.fh-row [data-a="clip"]') || {}).textContent }));
chk('Handy: Die Treffer der Suche passen in die Breite', st.rows >= 2 && st.wide === 0 && st.btn === 'Als Clip', st);
await hp.screenshot({ path: path.join(OUT, 'clips-handy-suche.png') });
await hp.close();

// ═════════ Am Rande: betonte Wörter ziehen beim Ausrichten am Ton mit ═════════
const idK = await scratch(page, ids().kurz); made.push(idK);
st = await ev(() => {
  // Im alten Stand fehlt die Pause vor dem ersten Wort; beim Ausrichten kommt sie zurück und alle Nummern rücken um eins weiter
  if (tokens[0].type !== 'pause') return { skip: true };
  tokens.splice(0, 1); tokens.forEach((t, i) => { t.i = i; }); deleted = new Set(); P.edits = {}; P.trims = {}; P.cues = []; computeOrder();
  const w = tokens.filter(t => t.type === 'word').map(t => t.i), pick = [w[5], w[40], w[120]], before = pick.map(i => tokens[i].text); P.kw = pick.slice();
  realign(); return { before, after: (P.kw || []).map(i => tokens[i] && tokens[i].text), shift: (P.kw || []).map((i, k) => i - pick[k]), types: (P.kw || []).map(i => tokens[i].type) }; });
chk('nach „Am Ton ausrichten“ zeigen die Betonungen auf dieselben Wörter, auch wenn sich die Nummern verschieben', !st.skip && st.after.length === 3 && st.before.join('|') === st.after.join('|') && st.shift.some(d => d !== 0) && st.types.every(t => t === 'word'), st);
await leave();

// Aufräumen
await ev(list => { HX.drop(list); for (const k of ['hc-clipfmt', 'hc-clippart', 'hc-clipwords']) localStorage.removeItem(k); showHome(); }, [...new Set(made)]);
for (const f of trash) { try { fs.rmSync(f, { force: true }); } catch (_) {} }
chk('keine Fehlermeldungen in der Konsole', logs.length === 0, logs.slice(0, 5));
await ende(browser);
