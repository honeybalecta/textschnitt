// Schnitt-Zeitleiste im Text-Reiter (2.28): die Zeitleiste des Studios unter dem Bild, dort nur mit der Hauptspur und nur für Schnitte
// (teilen, Kanten ziehen, löschen). Wörter unter der Hauptspur zeigen, wo ein Schnitt sitzt. Am Handy eingeklappt, auf Wunsch ausklappbar.
import path from 'node:path';
import { launch, scratch, dropScratch, sleep, ids as loadIds, pruefung, watch, BASE, OUT } from './drv.mjs';
const PJ = loadIds();
const { chk, ende } = pruefung('Schnitt-Zeitleiste');
const { browser, page, logs } = await launch();
const ev = (f, a) => page.evaluate(f, a);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const shot = (name, pg = page) => pg.screenshot({ path: path.join(OUT, `schnittleiste-${name}.png`) });
const drop = async (id, pg = page) => { await pg.evaluate(() => { if (typeof P !== 'undefined' && P){ pausePlay(); clearTimeout(saveT); } }); await dropScratch(pg, id); };
const undo = async () => { await page.click('#undoBtn'); await sleep(250); };
const rect = sel => ev(sel => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height, shown: getComputedStyle(e).display !== 'none' && r.width > 0 && r.height > 0 }; }, sel);
const tools = () => ev(() => [...document.querySelectorAll('#tools .tool')].map(b => b.textContent));
const tool = name => ev(name => { const b = [...document.querySelectorAll('#tools .tool')].find(b => b.textContent === name); if (b) b.click(); return !!b; }, name);
const segs = () => ev(() => timeline.map(g => [g.kind, +g.in.toFixed(3), +g.out.toFixed(3)]));
await ev(() => { try { localStorage.removeItem('hc-text-tl'); localStorage.removeItem('hc-clip-tl'); } catch (_) {} });

// ═════════ Aufbau im Text-Reiter (breiter Bildschirm) ═════════
const sid = await scratch(page, PJ.edit);
const snap0 = await ev(() => snapshot());
await ev(() => setTab('text')); await sleep(900);
const st = await ev(() => ({ tab, hidden: document.querySelector('#paneStudio').classList.contains('hidden'), min: document.querySelector('#proj').classList.contains('tl-min'), on: tlOn(), lite: tlLite(), studio: studioOn(),
  fold: document.querySelector('#tlFold span').textContent, hint: document.querySelector('#tlFold em').textContent, blocks: document.querySelectorAll('#trMain .blk').length, segs: timeline.length, words: document.querySelectorAll('#trWords .wd').length }));
chk('im Text-Reiter steht die Zeitleiste offen da (breiter Bildschirm), als Schnitt-Zeitleiste', st.tab === 'text' && !st.hidden && !st.min && st.on && st.lite && !st.studio && st.fold === 'Zeitleiste · Schnitt' && st.hint === 'antippen zum Einklappen', st);
chk('die Hauptspur zeigt alle Abschnitte, darunter stehen die Wörter', st.blocks === st.segs && st.segs > 20 && st.words > 20, st);
const R = { stage: await rect('#stage'), wrap: await rect('#proj > .stage-wrap'), tr: await rect('#proj > .transport'), pane: await rect('#paneStudio'), text: await rect('#paneText'), tabs: await rect('#proj > .tabs') };
chk('sie liegt unter Bild und Abspielleiste in der linken Spalte; der Text behält rechts die volle Höhe', R.pane.shown && near(R.pane.l, R.stage.l, 2) && R.pane.r <= R.text.l + 2 && R.pane.t >= R.tr.b - 2 && R.text.t <= R.tabs.b + 4 && R.text.b >= R.pane.b - 2 && R.stage.h > 250, R);
// sichtbar oder nicht: Ein Element in einer ausgeblendeten Gruppe hat selbst noch „display: flex“, belegt aber keine Fläche
const vis = await ev(() => { const d = s => { const e = document.querySelector(s); if (!e) return 'fehlt'; const r = e.getBoundingClientRect(); return getComputedStyle(e).display === 'none' || (r.width === 0 && r.height === 0) ? 'none' : 'da'; };
  return { main: d('#trMain'), words: d('#trWords'), ruler: d('#ruler'), fx: d('#trFx'), title: d('#trTitle'), txt: d('#trTxt'), ovl: d('#trOvlBox'), aud: d('#trAudBox'), media: d('#barMedia'), clip: d('#barClip'), titleBtn: d('#barTitle'), split: d('#barSplit'), del: d('#barDel'), zoomIn: d('#tlIn'), snap: d('#snapBtn'), bin: d('#mediaBin') }; });
chk('zu sehen sind nur Zeitskala, Hauptspur und Wörter; die übrigen Spuren und Werkzeuge des Studios fehlen', vis.main !== 'none' && vis.words !== 'none' && vis.ruler !== 'none' && [vis.fx, vis.title, vis.txt, vis.ovl, vis.aud, vis.media, vis.clip, vis.titleBtn, vis.bin].every(x => x === 'none') && vis.split !== 'none' && vis.del !== 'none' && vis.zoomIn !== 'none' && vis.snap !== 'none', vis);
chk('Werkzeuge ohne Auswahl: nur Schnitte', JSON.stringify(await tools()) === '["Teilen","Bis hier weg","Ab hier weg"]', await tools());
chk('das Anzeigen allein ändert nichts am Projekt', (await ev(() => snapshot())) === snap0);
await shot('text');

// ═════════ Wörter unter der Hauptspur ═════════
await ev(() => { TL.snap = false; setPps(120); seekOut(0, false); revealHead(0); }); await sleep(400);
const w0 = await ev(() => { const els = [...document.querySelectorAll('#trWords .wd')].slice(0, 12), pad = padL();
  return els.map(el => { const i = +el.dataset.i, t = tokens[i], g = timeline.find(g => g.kind === 'main' && wS(t) < g.out && wE(t) > g.in), a = Math.max(wS(t), g.in);
    return { i, text: el.textContent, want: tokText(t), left: parseFloat(el.style.left), wantLeft: pad + (g.o + (a - g.in) / (g.speed || 1)) * TL.pps, cut: isCut(i) }; }); });
chk('jedes Wort steht an seiner Stelle im geschnittenen Video', w0.length === 12 && w0.every(x => x.text === x.want && near(x.left, x.wantLeft, 0.6)), w0.slice(0, 3));
await ev(() => document.querySelectorAll('#trWords .wd')[6].click()); await sleep(300);
const wc = await ev(() => { const i = +document.querySelectorAll('#trWords .wd')[6].dataset.i; return { i, selA, selB, sel: spans[i].classList.contains('sel'), bar: !document.querySelector('#selbar').classList.contains('hidden'), out: outPos, want: srcToOut(snapSrc(wS(tokens[i]))) }; });
chk('Klick auf ein Wort in der Zeitleiste markiert es im Text und setzt die Abspiellinie an seinen Anfang', wc.selA === wc.i && wc.selB === wc.i && wc.sel && wc.bar && near(wc.out, wc.want, 0.02), wc);
await ev(() => clearSel());
// Wort im Text anklicken: die Zeitleiste rückt die Abspiellinie ins Bild
const far = await ev(() => { const ids = order.filter(i => tokens[i].type === 'word' && !isCut(i)), i = ids[Math.floor(ids.length * 0.7)]; spans[i].scrollIntoView({ block: 'center' }); return i; });
await page.click(`#transcript .tk[data-i="${far}"]`); await sleep(400);
const pl = await ev(i => { const p = document.querySelector('.playline').getBoundingClientRect(), b = document.querySelector('#tl').getBoundingClientRect(); return { out: outPos, want: srcToOut(snapSrc(wS(tokens[i]))), x: p.left - b.left, w: b.width, hidden: document.querySelector('.playline').classList.contains('hidden'), scroll: document.querySelector('#tl').scrollLeft }; }, far);
chk('Wort im Text angeklickt: die Zeitleiste springt mit, die Abspiellinie ist zu sehen', near(pl.out, pl.want, 0.02) && !pl.hidden && pl.x > 0 && pl.x < pl.w && pl.scroll > 100, pl);
await ev(() => clearSel());

// ═════════ Schnitte: Kanten ziehen, bildgenau versetzen, teilen, löschen ═════════
const k = 4;
await ev(k => { seekOut(timeline[k].o + 0.2, false); revealHead(outPos); }, k); await sleep(300);
await ev(k => document.querySelectorAll('#trMain .blk')[k].click(), k); await sleep(250);
const sel = await ev(() => ({ sel: TL.sel && TL.sel.kind, i: TL.sel && TL.sel.i, box: !document.querySelector('#pipBox').classList.contains('hidden'), info: document.querySelector('#tlInfo').textContent, lbl: document.querySelector('#selLbl').textContent }));
chk('Clip anklicken wählt ihn aus; Werkzeuge: teilen, löschen und die Kanten bildgenau versetzen', sel.sel === 'main' && sel.i === k && JSON.stringify(await tools()) === '["Teilen","Bis hier weg","Ab hier weg","Löschen","Anfang −1","Anfang +1","Ende −1","Ende +1"]' && /Griffe an den Kanten ziehen verschiebt den Schnitt/.test(sel.info), [sel, await tools()]);
chk('im Bild erscheint kein Rahmen zum Verschieben (das gibt es nur im Studio)', sel.box === false);
let S0 = await segs(); const fr = await ev(() => 1 / fps()), u0 = await ev(() => undo.length);
await tool('Ende +1'); await sleep(250); let S1 = await segs();
chk('„Ende +1“ verlängert den Clip um ein Bild', near(S1[k][2] - S0[k][2], fr, 0.002) && S1[k][1] === S0[k][1] && S1.length === S0.length && (await ev(() => undo.length)) === u0 + 1, [S0[k], S1[k], fr]);
await tool('Anfang −1'); await sleep(250); let S2 = await segs();
chk('„Anfang −1“ setzt den Anfang ein Bild früher', near(S1[k][1] - S2[k][1], fr, 0.002) && S2[k][2] === S1[k][2], [S1[k], S2[k]]);
await undo(); await undo();
chk('Rückgängig stellt die Kanten wieder her', JSON.stringify(await segs()) === JSON.stringify(S0));
// Griff ziehen: rechte Kante 36 Bildpunkte nach links = 0,3 s bei 120 Bildpunkten je Sekunde
await ev(k => document.querySelectorAll('#trMain .blk')[k].click(), k); await sleep(200);
const h = await ev(() => { const b = document.querySelector('#trMain .blk.sel'), r = b.querySelector('.h.r').getBoundingClientRect(), q = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, bx: q.left + q.width / 2, by: q.top + q.height / 2 }; });
await page.mouse.move(h.x, h.y); await page.mouse.down(); await page.mouse.move(h.x - 36, h.y, { steps: 6 }); await page.mouse.up(); await sleep(400);
let S3 = await segs();
const part = await ev(k => { const g = timeline[k], out = []; for (const el of document.querySelectorAll('#trWords .wd')){ const t = tokens[+el.dataset.i]; if (wS(t) < g.out && wE(t) > g.out - 0.4) out.push([el.textContent, el.className]); } return out; }, k);
chk('Griff an der rechten Kante gezogen: der Schnitt sitzt 0,3 s früher, ein Rückgängig-Schritt', near(S0[k][2] - S3[k][2], 0.3, 0.02) && S3[k][1] === S0[k][1] && (await ev(() => undo.length)) === u0 + 1 && (await ev(() => P.moves.length)) === 0, [S0[k], S3[k]]);
chk('ein angeschnittenes Wort ist in der Zeitleiste hervorgehoben', part.some(x => /\bpart\b/.test(x[1])), part);
await shot('kante');
await undo();
// Clip am Körper ziehen: kein Umsortieren
await ev(k => document.querySelectorAll('#trMain .blk')[k].click(), k); await sleep(200);
const u1 = await ev(() => undo.length);
await page.mouse.move(h.bx, h.by); await page.mouse.down(); await page.mouse.move(h.bx + 260, h.by, { steps: 8 }); await page.mouse.up(); await sleep(400);
chk('Clip am Körper ziehen sortiert hier nichts um', (await ev(() => P.moves.length)) === 0 && (await ev(() => undo.length)) === u1 && JSON.stringify(await segs()) === JSON.stringify(S0));
// Doppelklick und Tasten des Studios: wirkungslos
await page.mouse.dblclick(h.bx, h.by); await sleep(300);
const noStudio = await ev(() => ({ sheet: !document.querySelector('#sheet').classList.contains('hidden'), items: P.items.length }));
await ev(() => select(null)); await page.keyboard.press('t'); await page.keyboard.press('e'); await page.keyboard.press('m'); await sleep(300);
const noKeys = await ev(() => ({ sheet: !document.querySelector('#sheet').classList.contains('hidden'), items: P.items.length, modal: !!document.querySelector('#hcModal') }));
chk('Doppelklick und die Tasten T, E, M des Studios bleiben im Text-Reiter ohne Wirkung', !noStudio.sheet && !noKeys.sheet && !noKeys.modal && noKeys.items === noStudio.items && (await ev(() => undo.length)) === u1, [noStudio, noKeys]);
// Teilen an der Abspiellinie
await ev(k => { const g = timeline[k]; seekOut(g.o + segDur(g) / 2, false); revealHead(outPos); }, k); await sleep(300);
await page.click('#barSplit'); await sleep(300); let S4 = await segs();
chk('„Teilen“ teilt den Clip an der Abspiellinie', S4.length === S0.length + 1 && S4[k][1] === S0[k][1] && near(S4[k][2], S4[k + 1][1], 0.002) && S4[k + 1][2] === S0[k][2], [S0[k], S4[k], S4[k + 1]]);
// zweite Hälfte löschen: die Wörter sind im Text gelöscht
const inSeg = await ev(k => { const g = timeline[k + 1]; return tokens.filter(t => t.type === 'word' && !isCut(t.i) && (t.ws + t.we) / 2 > g.in && (t.ws + t.we) / 2 < g.out).map(t => t.i); }, k);
await ev(k => document.querySelectorAll('#trMain .blk')[k + 1].click(), k); await sleep(200);
await page.keyboard.press('Delete'); await sleep(350);
const del = await ev(ids => ({ segs: timeline.length, del: ids.map(i => spans[i].classList.contains('del')), sel: TL.sel }), inSeg);
chk('Entf löscht den ausgewählten Clip; seine Wörter sind im Text als gelöscht markiert', del.segs === S0.length && inSeg.length > 0 && del.del.every(Boolean) && del.sel === null, [del, inSeg.length]);
await undo(); await undo();
chk('Rückgängig bringt Clip und Wörter zurück', JSON.stringify(await segs()) === JSON.stringify(S0) && (await ev(ids => ids.every(i => !spans[i].classList.contains('del')), inSeg)));
// „Bis hier weg“ ohne Auswahl: schneidet vom Clip-Anfang bis zur Abspiellinie
await ev(k => { select(null); const g = timeline[k]; seekOut(g.o + 0.5, false); revealHead(outPos); }, k); await sleep(300);
const cutAt = await ev(() => vT());
await tool('Bis hier weg'); await sleep(300); const S5 = await segs();
chk('„Bis hier weg“ entfernt den Anfang des Clips bis zur Abspiellinie', near(S5[k][1], cutAt, 0.01) && S5[k][2] === S0[k][2] && S5.length === S0.length, [S0[k], S5[k], cutAt]);
await undo();

// ═════════ Text und Zeitleiste halten sich gegenseitig aktuell ═════════
const wdel = await ev(() => { const ids = order.filter(i => tokens[i].type === 'word' && !isCut(i)); return ids[30]; });
const before = await ev(i => ({ n: timeline.length, total, lane: !!document.querySelector(`#trWords .wd[data-i="${i}"]`) }), wdel);
await ev(i => { spans[i].scrollIntoView({ block: 'center' }); }, wdel); await page.click(`#transcript .tk[data-i="${wdel}"]`); await sleep(250);
await page.click('#selDel'); await sleep(350);
const after = await ev(i => ({ total, lane: !!document.querySelector(`#trWords .wd[data-i="${i}"]`), blocks: document.querySelectorAll('#trMain .blk').length, n: timeline.length }), wdel);
chk('Wort im Text gelöscht: die Zeitleiste zeigt sofort den neuen Schnitt', after.total < before.total - 0.05 && before.lane && !after.lane && after.blocks === after.n, [before, after]);
await undo(); await ev(() => clearSel());

// ═════════ Einklappen, eigener Stand je Reiter, Studio unverändert ═════════
await page.click('#tlFold'); await sleep(500);
const folded = await ev(() => ({ min: document.querySelector('#proj').classList.contains('tl-min'), on: tlOn(), key: localStorage.getItem('hc-text-tl'), clipKey: localStorage.getItem('hc-clip-tl'), hint: document.querySelector('#tlFold em').textContent }));
const Rf = { wrap: await rect('#proj > .stage-wrap'), pane: await rect('#paneStudio') };
chk('Einklappen: nur die Kopfzeile bleibt, der Bereich für das Bild bekommt den Platz; der Stand wird gemerkt', folded.min && !folded.on && folded.key === '1' && folded.clipKey === null && folded.hint === 'antippen zum Ausklappen' && Rf.pane.h < 50 && Rf.wrap.h > R.wrap.h + 150, [folded, Rf.pane.h, Rf.wrap.h, R.wrap.h]);
await ev(() => setTab('studio')); await sleep(600);
const studio = await ev(() => { const d = s => getComputedStyle(document.querySelector(s)).display; return { min: document.querySelector('#proj').classList.contains('tl-min'), lite: tlLite(), fx: d('#trFx'), title: d('#trTitle'), txt: d('#trTxt'), words: d('#trWords'), media: d('#barMedia'), fold: d('#tlFold'), tools: [...document.querySelectorAll('#tools .tool')].length, titles: document.querySelectorAll('#trTitle .blk').length }; });
chk('im Studio ist die Zeitleiste vollständig wie bisher (alle Spuren und Werkzeuge, ohne Wörter-Spur)', !studio.min && !studio.lite && studio.fx !== 'none' && studio.title !== 'none' && studio.txt !== 'none' && studio.words === 'none' && studio.media !== 'none' && studio.fold === 'none' && studio.tools > 8, studio);
await ev(() => setTab('text')); await sleep(500);
chk('zurück im Text-Reiter ist sie weiter eingeklappt', await ev(() => document.querySelector('#proj').classList.contains('tl-min')));
await page.click('#tlFold'); await sleep(600);
chk('Ausklappen zeichnet sie wieder', (await ev(() => [document.querySelector('#proj').classList.contains('tl-min'), document.querySelectorAll('#trMain .blk').length === timeline.length, localStorage.getItem('hc-text-tl')].join())) === 'false,true,0');
chk('am Ende ist das Projekt unverändert', (await ev(() => snapshot())) === snap0);
chk('keine Fehlermeldungen in der Oberfläche', logs.length === 0, logs.slice(0, 5));
await ev(() => { try { localStorage.removeItem('hc-text-tl'); } catch (_) {} });
await drop(sid);

// ═════════ Handy (schmaler Bildschirm): eingeklappt, auf Wunsch über dem Text ═════════
const ctx2 = await browser.newContext({ viewport: { width: 400, height: 820 }, deviceScaleFactor: 2 });
const p2 = await ctx2.newPage(); const logs2 = watch(p2);
await p2.goto(BASE); await p2.waitForFunction(() => typeof showHome === 'function');
const e2 = (f, a) => p2.evaluate(f, a);
await e2(() => { try { localStorage.removeItem('hc-text-tl'); } catch (_) {} });
const mid = await scratch(p2, PJ.edit);
await e2(() => setTab('text')); await sleep(800);
const m0 = await e2(() => { const r = s => document.querySelector(s).getBoundingClientRect(); return { wide: isWide(), min: document.querySelector('#proj').classList.contains('tl-min'), on: tlOn(), pane: r('#paneStudio').height, text: r('#paneText').height, fold: getComputedStyle(document.querySelector('#tlFold')).display }; });
chk('Handy: die Zeitleiste ist anfangs eingeklappt, nur eine schmale Kopfzeile über dem Text', !m0.wide && m0.min && !m0.on && m0.pane < 44 && m0.fold !== 'none' && m0.text > 300, m0);
await p2.click('#tlFold'); await sleep(700);
const m1 = await e2(() => { const r = s => document.querySelector(s).getBoundingClientRect(); return { min: document.querySelector('#proj').classList.contains('tl-min'), pane: r('#paneStudio'), text: r('#paneText'), stage: r('#stage'), blocks: document.querySelectorAll('#trMain .blk').length, n: timeline.length, tools: [...document.querySelectorAll('#tools .tool')].map(b => b.textContent), w: innerWidth,
  tk: (() => { const t = document.querySelector('#transcript .tk'); const q = t.getBoundingClientRect(); return q.top < innerHeight && q.height > 0; })() }; });
chk('Handy, ausgeklappt: Zeitleiste zwischen Bild und Text in voller Breite, der Text bleibt darunter bedienbar', !m1.min && m1.blocks === m1.n && near(m1.pane.width, m1.w, 2) && m1.pane.top >= m1.stage.bottom - 2 && m1.text.top >= m1.pane.bottom - 2 && m1.text.height > 110 && m1.pane.height < 300 && m1.tk && JSON.stringify(m1.tools) === '["Teilen","Bis hier weg","Ab hier weg"]', { pane: m1.pane.height, text: m1.text.height, stage: m1.stage.height, tools: m1.tools });
await shot('handy', p2);
chk('Handy: keine Fehlermeldungen', logs2.length === 0, logs2.slice(0, 5));
await e2(() => { try { localStorage.removeItem('hc-text-tl'); } catch (_) {} });
await drop(mid, p2); await ctx2.close();
await ende(browser);
