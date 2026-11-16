// Hausstil und Bausteine (2.30): Hausstil als Vorlage (A3), Bausteine für Intro und Abspann (A4), Endkarte (F7),
// Layout-Vorlagen für Reaktionen (B8: Splitscreen, Bild-im-Bild mit Rahmen und Namensschild). Arbeitet mit anlauf.mp4 und den Einspielern.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, newProject, transcribe, setPick, sleep, pruefung, MEDIA, OUT } from './drv.mjs';
const { chk, ende } = pruefung('Hausstil und Bausteine');
const { browser, page, logs } = await launch();
const ev = (f, a) => page.evaluate(f, a);
const shot = (name, pg = page) => pg.screenshot({ path: path.join(OUT, `hausstil-${name}.png`) });
const made = [];
const KEYS = ['hc-house', 'hc-house-def', 'hc-blocks', 'hc-endcard', 'ts-auto2', 'hc-safe'];
const wipe = () => ev(k => { for (const x of k) localStorage.removeItem(x); houseList = []; blockList = []; houseDef = ''; }, KEYS);
const leave = () => ev(() => { if (typeof P !== 'undefined' && P){ pausePlay(); clearTimeout(saveT); saveNow(); closeProject(); } });
const fresh = async (file = 'anlauf.mp4', tr = false) => { await leave(); const id = await newProject(page, [MEDIA + file]); made.push(id); if (tr) await transcribe(page); await sleep(250); return id; };
const pick = async (kind, files) => { setPick({ [kind]: files }); return ev(k => pickMedia(k), kind); };
const name = async txt => { await page.waitForSelector('#nmIn'); await page.fill('#nmIn', txt); await page.click('#nmOk'); await sleep(300); };
const toastTxt = () => ev(() => document.querySelector('#toast').textContent);
const rows = sel => ev(sel => [...document.querySelectorAll(sel + ' .hs-row')].map(r => r.querySelector('b').textContent + ' | ' + r.querySelector('.muted').textContent + ' | ' + [...r.querySelectorAll('button')].map(b => b.dataset.a + (b.classList.contains('on') ? '*' : '')).join(',')), sel);
const openSheetHouse = async () => { await page.click('#houseBtn'); await page.waitForSelector('#hsList'); await sleep(250); };
const done = async () => { await ev(() => { const b = document.querySelector('#hsOk') || document.querySelector('#itOk'); if (b) b.click(); }); await sleep(250); };

await wipe();

// ═════════ A3 · Hausstil als Vorlage ═════════
await fresh('anlauf.mp4', true);
const logo = await pick('clip', [MEDIA + 'logo.png']);
const cues0 = await ev(() => P.cues.length);
await ev(logo => { commit(() => { P.format = '9:16'; P.frame = clampFrame({ sc: coverSc(), tx: 0, ty: 0 }); Object.assign(S(), { color: '#EDE7DA', size: 'groß', chars: 18, lines: 1 }); genCues();
  P.watermark = { ...WM_DEF, clip: logo, pos: 'ol' }; P.textline = { ...TLINE_DEF, text: '@honeybalecta' }; P.lower = { pos: 'ol', size: 1.2, dur: 5 }; }, true);
  setSafe('tiktok'); P.settings.level = false; P.settings.burn = false; changed(false); fitStage(); renderExportForm();
  document.querySelector('#autoFillers').checked = true; document.querySelector('#autoPauseLen').value = '0.3'; document.querySelector('#autoPauseLen').dispatchEvent(new Event('change')); }, logo);
const cues1 = await ev(() => P.cues.length);
await openSheetHouse();
chk('das Blatt zeigt Hausstil, Bausteine und Endkarte; zu Beginn ist alles leer', await ev(() => [...document.querySelectorAll('#sheetBody h4')].map(h => h.textContent).join('|') === 'Hausstil|Bausteine|Endkarte' && /Noch keine Vorlage/.test(document.querySelector('#hsList').textContent) && /Noch keine Bausteine/.test(document.querySelector('#bkList').textContent)));
await page.click('#hsSave'); await name('Statement');
let st = await ev(() => ({ list: houseList.map(h => [h.name, Object.keys(h.st).sort().join(',')]), stored: localStorage.getItem('hc-house') === JSON.stringify(houseList), st: houseList[0].st }));
chk('„Stil dieses Projekts als Vorlage speichern“ legt die Vorlage im Gerät ab', st.list.length === 1 && st.list[0][0] === 'Statement' && st.stored && st.list[0][1] === 'audio,auto,burn,color,format,level,lower,part,progress,safe,slideProfile,srcStyle,sub,textline,wm', st.list);
chk('die Vorlage hält Untertitel-Stil, Wasserzeichen, Format, Schutzzonen, Lautstärke und Aufräum-Optionen', st.st.sub.color === '#EDE7DA' && st.st.sub.chars === 18 && st.st.wm.pos === 'ol' && /logo\.png$/.test(st.st.wm.clip.uri) && st.st.format === '9:16' && st.st.safe === 'tiktok'
  && st.st.level === false && st.st.burn === false && st.st.textline.text === '@honeybalecta' && st.st.lower.dur === 5 && st.st.auto.autoFillers === true && st.st.auto.autoPauseLen === '0.3', st.st);
let r = await rows('#hsList');
chk('die Zeile nennt Namen und Inhalt und bietet Anwenden, Stern, Umbenennen, Löschen', r.length === 1 && r[0] === 'Statement | 9:16 · Untertitel · Wasserzeichen · Textzeile · Schutzzonen | use,def,ren,del', r);
await page.click('#hsList [data-a="def"]'); await sleep(200);
r = await rows('#hsList');
chk('der Stern macht die Vorlage zur Vorgabe für neue Projekte', (await ev(() => houseDef === houseList[0].id && localStorage.getItem('hc-house-def') === houseDef)) && /für neue Projekte/.test(r[0]) && /def\*/.test(r[0]) && /Neue Projekte starten mit „Statement“/.test(await toastTxt()), r);
await shot('blatt');
await done();

// Neues Projekt startet im Hausstil
await ev(() => { document.querySelector('#autoFillers').checked = false; document.querySelector('#autoPauseLen').value = '0'; document.querySelector('#autoPauseLen').dispatchEvent(new Event('change')); });
await fresh('kurz.mp4');
st = await ev(() => ({ house: P.house === houseDef, sub: [S().color, S().size, S().chars, S().lines], wm: P.watermark && [P.watermark.pos, P.watermark.clip.name], fmt: P.format, fr: P.frame, cover: +coverSc().toFixed(3), safe: P.settings.safe, level: P.settings.level, burn: P.settings.burn,
  line: P.textline && P.textline.text, lower: P.lower, auto: [document.querySelector('#autoFillers').checked, document.querySelector('#autoPauseLen').value], stored: JSON.parse(localStorage.getItem('ts-auto2')), toast: document.querySelector('#toast').textContent,
  wmShown: !document.querySelector('#wm').classList.contains('hidden'), stage: (r => +(r.width / r.height).toFixed(2))(document.querySelector('#stage').getBoundingClientRect()), exSubs: document.querySelector('#exSubs').checked, exLevel: document.querySelector('#exLevel').checked,
  clipTab: !document.querySelector('.clip-tab').classList.contains('hidden'), frameNew: 'frameNew' in P }));
chk('ein neues Projekt startet mit Untertitel-Stil, Wasserzeichen, Textzeile und Bauchbinden-Stil der Vorgabe', st.house && st.sub.join() === '#EDE7DA,groß,18,1' && st.wm && st.wm.join() === 'ol,logo.png' && st.line === '@honeybalecta' && st.lower.dur === 5 && /Hausstil „Statement“ übernommen/.test(st.toast), st);
chk('Format, Schutzzonen und Lautstärke kommen mit; das Video füllt die Leinwand', st.fmt === '9:16' && st.fr && Math.abs(st.fr.sc - st.cover) < 0.002 && st.fr.tx === 0 && !st.frameNew && st.safe === 'tiktok' && st.level === false && st.burn === false && st.exSubs === false && st.exLevel === false && Math.abs(st.stage - 0.56) < 0.02 && st.clipTab && st.wmShown, st);
chk('die Aufräum-Optionen der Vorgabe stehen im neuen Projekt bereit', st.auto[0] === true && st.auto[1] === '0.3' && st.stored.autoFillers === true && st.stored.autoPauseLen === '0.3', st.auto);
const savedNew = await ev(() => { saveNow(); const p = JSON.parse(TS.loadProject(P.id)); return [p.format, p.house === houseDef, !!p.frame, 'frameNew' in p]; });
chk('der Stil ist im Projekt gespeichert', savedNew[0] === '9:16' && savedNew[1] && savedNew[2] && !savedNew[3], savedNew);

// Zweite Vorlage, Anwenden auf ein offenes Projekt, Rückgängig
await ev(() => { commit(() => { P.format = null; P.frame = null; Object.assign(S(), { color: '#FFFFFF', size: 'mittel', chars: 32, lines: 2 }); delete P.watermark; delete P.textline; delete P.lower; }, true); setSafe(''); P.settings.level = true; P.settings.burn = true; fitStage(); renderExportForm(); });
await openSheetHouse(); await page.click('#hsSave'); await name('Interview');
r = await rows('#hsList');
chk('mehrere Vorlagen stehen nebeneinander', r.length === 2 && /^Interview \| Originalformat · Untertitel \|/.test(r[1]) && /def\*/.test(r[0]) && !/def\*/.test(r[1]), r);
await done();
await fresh('anlauf.mp4', true);
await ev(() => { commit(() => { houseInto(P, houseList[1].st); P.frame = null; genCues(); }, true); fitStage(); });
const before = await ev(() => ({ n: P.cues.length, fmt: P.format || null, undo: undo.length }));
await ev(() => { commit(() => { P.cues[0].text = 'Von Hand'; }, false); });
await openSheetHouse(); await page.click('#hsList .hs-row:first-child [data-a="use"]'); await sleep(600);
st = await ev(() => ({ sub: [S().color, S().size, S().chars, S().lines], fmt: P.format, fr: P.frame, cover: +coverSc().toFixed(3), wm: !!P.watermark, line: P.textline && P.textline.text, safe: P.settings.safe, level: P.settings.level, n: P.cues.length, manual: P.cues.some(c => c.text === 'Von Hand'),
  house: P.house === houseList[0].id, toast: document.querySelector('#toast').textContent, selSafe: document.querySelector('select.safe-sel').value, auto: document.querySelector('#autoFillers').checked, stage: (r => +(r.width / r.height).toFixed(2))(document.querySelector('#stage').getBoundingClientRect()) }));
chk('„Anwenden“ setzt den Stil im offenen Projekt: Untertitel, Wasserzeichen, Textzeile, Format, Schutzzonen', st.sub.join() === '#EDE7DA,groß,18,1' && st.fmt === '9:16' && Math.abs(st.fr.sc - st.cover) < 0.002 && st.wm && st.line === '@honeybalecta' && st.safe === 'tiktok' && st.selSafe === 'tiktok' && st.level === false && st.house && Math.abs(st.stage - 0.56) < 0.02 && /Hausstil „Statement“ angewendet/.test(st.toast), st);
chk('ändert die Vorlage die Aufteilung, werden die Untertitel neu aufgeteilt', st.n === cues1 && st.n !== before.n && !st.manual && cues1 !== cues0, [cues0, cues1, before.n, st.n]);
await done();
await ev(() => document.querySelector('#undoBtn').click()); await sleep(500);
st = await ev(() => ({ sub: [S().color, S().chars], fmt: P.format || null, wm: !!P.watermark, n: P.cues.length, manual: P.cues.some(c => c.text === 'Von Hand'), stage: (r => +(r.width / r.height).toFixed(2))(document.querySelector('#stage').getBoundingClientRect()) }));
chk('Rückgängig stellt Untertitel, Format und Wasserzeichen wieder her', st.sub.join() === '#FFFFFF,32' && st.fmt === null && !st.wm && st.n === before.n && st.manual && Math.abs(st.stage - 1.78) < 0.03, st);

// Umbenennen, Überschreiben, Löschen, Stern abwählen
await openSheetHouse();
await page.click('#hsList .hs-row:nth-child(2) [data-a="ren"]'); await name('Erklärvideo');
await page.click('#hsSave'); await name('erklärvideo');
st = await ev(() => ({ names: houseList.map(h => h.name), fmt: houseList[1].st.format, stored: JSON.parse(localStorage.getItem('hc-house')).map(h => h.name) }));
chk('Umbenennen und Überschreiben unter gleichem Namen (nach Rückfrage) halten die Liste sauber', st.names.join() === 'Statement,Erklärvideo' && st.stored.join() === st.names.join() && st.fmt === null, st);
await page.click('#hsList .hs-row:first-child [data-a="def"]'); await sleep(200);
chk('der Stern lässt sich wieder abwählen', await ev(() => houseDef === '' && localStorage.getItem('hc-house-def') === null) && /ohne Vorlage/.test(await toastTxt()));
await page.click('#hsList .hs-row:nth-child(2) [data-a="del"]'); await sleep(200);
chk('Löschen entfernt die Vorlage aus dem Gerät', await ev(() => houseList.length === 1 && JSON.parse(localStorage.getItem('hc-house')).length === 1 && document.querySelectorAll('#hsList .hs-row').length === 1));
await done();
await fresh('kurz.mp4');
st = await ev(() => ({ house: P.house || null, fmt: P.format || null, color: S().color, wm: !!P.watermark }));
chk('ohne Vorgabe startet ein neues Projekt mit den Grundeinstellungen', st.house === null && st.fmt === null && st.color === '#FFFFFF' && !st.wm, st);

// Sicherung der Einstellungen
st = await ev(() => { const pr = uiPrefs(), h0 = JSON.stringify(houseList); const n1 = mergePrefs({ 'hc-house': [houseList[0], { id: 'x1', name: 'Kampagne', st: { format: '1:1', sub: { color: '#FFFFFF' } } }, { id: 'x2', name: '', st: {} }, null], 'hc-blocks': [{ id: 'b9', name: 'Abspann', clip: { uri: '/tmp/abspann.mp4', kind: 'video', duration: 3 } }, { id: 'b8', name: 'kaputt' }] });
  const res = { keys: Object.keys(pr), n1, names: houseList.map(h => h.name), blocks: blockList.map(b => b.name) }; houseList = JSON.parse(h0); saveHouse(); blockList = []; saveBlocks(); return res; });
chk('Vorlagen und Bausteine gehen in die Sicherung der Einstellungen und kommen beim Zurückholen ohne Doppelte dazu', st.keys.includes('hc-house') && st.n1 === 2 && st.names.join() === 'Statement,Kampagne' && st.blocks.join() === 'Abspann', st);

// ═════════ A4 · Bausteine ═════════
await fresh('anlauf.mp4', true);
await openSheetHouse();
setPick({ clip: [MEDIA + 'broll1.mp4'] }); await page.click('#bkAdd'); await name('Intro');
setPick({ clip: [MEDIA + 'folie1.png'] }); await page.click('#bkAdd'); await name('Spendenhinweis');
setPick({ clip: [MEDIA + 'broll1.mp4'] }); await page.click('#bkAdd'); await sleep(400);
st = await ev(() => ({ list: blockList.map(b => [b.name, b.clip.kind, b.clip.duration]), stored: localStorage.getItem('hc-blocks') === JSON.stringify(blockList), toast: document.querySelector('#toast').textContent, modal: !!document.querySelector('#nmIn') }));
chk('Clips und Bilder lassen sich als Bausteine ablegen; dieselbe Datei kommt nur einmal in die Liste', st.list.length === 2 && st.list[0].join() === 'Intro,video,15' && st.list[1][0] === 'Spendenhinweis' && st.list[1][1] === 'image' && st.stored && /liegt schon bei den Bausteinen/.test(st.toast) && !st.modal, st);
r = await rows('#bkList');
chk('jede Zeile bietet Vorn, Hinten, Umbenennen, Entfernen', r.length === 2 && r[0] === 'Intro | 0:15,0 | front,back,ren,del' && r[1] === 'Spendenhinweis | Bild | front,back,ren,del', r);
const tot0 = await ev(() => total);
await page.click('#bkList .hs-row:first-child [data-a="front"]'); await sleep(500);
st = await ev(() => ({ total, first: timeline[0].kind, uri: timeline[0].uri, o1: timeline[1].o, kinds: timeline.map(g => g.kind).join(','), it: (x => [x.type, x.block, x.in, x.out])(P.items[0]), pos: outPos, toast: document.querySelector('#toast').textContent, undo: undo.length }));
chk('„Vorn“ fügt den Baustein vor dem Video an', st.first === 'insert' && /broll1\.mp4$/.test(st.uri) && Math.abs(st.total - tot0 - 15) < 0.01 && Math.abs(st.o1 - 15) < 0.01 && st.it.join() === 'insert,Intro,0,15' && st.pos < 0.05 && /Baustein „Intro“ vorn angefügt/.test(st.toast), st);
await page.click('#bkList .hs-row:nth-child(2) [data-a="back"]'); await sleep(500);
st = await ev(() => ({ total, last: timeline[timeline.length - 1].kind, uri: timeline[timeline.length - 1].uri, o: timeline[timeline.length - 1].o, kinds: timeline.map(g => g.kind).join(','), n: P.items.filter(x => x.type === 'insert').length, pos: outPos }));
chk('„Hinten“ hängt ein Bild für vier Sekunden ans Ende', st.last === 'insert' && /folie1\.png$/.test(st.uri) && Math.abs(st.total - tot0 - 19) < 0.01 && Math.abs(st.o - tot0 - 15) < 0.01 && st.n === 2 && Math.abs(st.pos - st.o) < 0.05, st);
await page.click('#bkList .hs-row:nth-child(2) [data-a="front"]'); await page.click('#bkList .hs-row:first-child [data-a="back"]'); await sleep(500);
st = await ev(() => timeline.map(g => g.kind === 'insert' ? g.item.block : 'main').join(','));
chk('ein weiterer Baustein vorn steht vor dem ersten, ein weiterer hinten hinter dem letzten', /^Spendenhinweis,Intro,(main,)+Spendenhinweis,Intro$/.test(st), st);
await done(); await shot('bausteine-zeitleiste');
// Schnitt am Anfang und am Ende: Die Bausteine bleiben außen
await ev(() => { const m = timeline.filter(g => g.kind === 'main'), a = m[0].in, b = m[m.length - 1].out; commit(() => { addDel(a, a + 2); addDel(b - 3, b); }, true); }); await sleep(400);
st = await ev(() => ({ kinds: timeline.map(g => g.kind === 'insert' ? g.item.block : 'main').join(','), total }));
chk('wird vorn und hinten geschnitten, bleiben die Bausteine am Anfang und am Ende', /^Spendenhinweis,Intro,(main,)+Spendenhinweis,Intro$/.test(st.kinds) && Math.abs(st.total - (tot0 - 5 + 38)) < 0.05, st);
for (let k = 0; k < 5; k++) await ev(() => document.querySelector('#undoBtn').click()); await sleep(400);
st = await ev(() => ({ total, n: P.items.length }));
chk('Rückgängig nimmt die Bausteine wieder heraus', Math.abs(st.total - tot0) < 0.01 && st.n === 0, st);
// Verschobene Reihenfolge: vorn heißt vor dem ersten Stück des fertigen Videos
await ev(() => { const s0 = pieces[0].s; commit(() => { P.moves.push({ a: r3(s0 + 10), b: r3(s0 + 14), to: r3(s0) }); P.splits.push(r3(s0 + 10), r3(s0 + 14), r3(s0)); }, true); }); await sleep(400);
const moved = await ev(() => timeline.filter(g => g.kind === 'main').map(g => [+g.in.toFixed(2), +g.out.toFixed(2)]));
await ev(() => { blockAdd(blockList[0].clip, 'front', 'Intro'); blockAdd(blockList[1].clip, 'back', 'Spendenhinweis'); }); await sleep(400);
st = await ev(() => ({ kinds: timeline.map(g => g.kind === 'insert' ? g.item.block : 'main').join(','), firstMain: timeline.find(g => g.kind === 'main').in }));
chk('auch bei umgestellten Abschnitten landen Bausteine ganz vorn und ganz hinten', moved.length >= 2 && moved[0][0] > moved[1][0] && /^Intro,(main,)+Spendenhinweis$/.test(st.kinds) && Math.abs(st.firstMain - moved[0][0]) < 0.01, [moved, st]);
await ev(() => { while (undo.length) document.querySelector('#undoBtn').click(); }); await sleep(300);
await openSheetHouse();
await page.click('#bkList .hs-row:first-child [data-a="ren"]'); await name('Vorspann');
await page.click('#bkList .hs-row:nth-child(2) [data-a="del"]'); await sleep(200);
chk('Bausteine lassen sich umbenennen und entfernen', await ev(() => blockList.length === 1 && blockList[0].name === 'Vorspann' && JSON.parse(localStorage.getItem('hc-blocks'))[0].name === 'Vorspann'));

// ═════════ F7 · Endkarte ═════════
await ev(() => { commit(() => { P.format = '9:16'; P.frame = clampFrame({ sc: coverSc(), tx: 0, ty: 0 }); }, true); fitStage(); }); await done(); await openSheetHouse();
st = await ev(() => ({ call: document.querySelector('#ecCall').value, btn: document.querySelector('#ecAdd').textContent.trim(), cv: (c => [c.width, c.height])(document.querySelector('#ecPrev')) }));
chk('die Endkarte schlägt einen Aufruf vor und zeigt eine Vorschau im Format des Projekts', st.call === 'Folge für mehr' && /Endkarte anfügen/.test(st.btn) && Math.abs(st.cv[0] / st.cv[1] - 9 / 16) < 0.01, st);
await page.fill('#ecCall', 'Folge für mehr Analysen'); await page.fill('#ecName', '@honeybalecta'); await ev(() => { const d = document.querySelector('#ecDur'); d.value = '3'; d.dispatchEvent(new Event('input')); }); await sleep(250);
const prevInk = await ev(() => { const c = document.querySelector('#ecPrev'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let light = 0, red = 0; for (let i = 0; i < d.length; i += 4){ if (d[i] > 200 && d[i + 1] > 200) light++; else if (d[i] > 180 && d[i + 1] < 110) red++; } return [light, red, document.querySelector('#ecDurV').textContent]; });
chk('die Vorschau zeigt Aufruf, Akzentbalken und Kanalnamen', prevInk[0] > 150 && prevInk[1] > 40 && prevInk[2] === '3,0 s', prevInk);
await shot('endkarte-blatt');
await page.click('#ecAdd'); await page.waitForFunction(() => P.items.some(x => x.endcard), null, { timeout: 15000 }); await sleep(400);
st = await ev(() => { const g = timeline[timeline.length - 1], it = g.item; return { kind: g.kind, ec: it.endcard, dur: +(it.out - it.in).toFixed(2), clip: [it.clip.kind, it.clip.width, it.clip.height, it.clip.uri], out: outSize(), total, o: g.o, btn: document.querySelector('#ecAdd').textContent.trim(), saved: JSON.parse(localStorage.getItem('hc-endcard')), toast: document.querySelector('#toast').textContent, block: it.block }; });
chk('„Endkarte anfügen“ hängt das Schlussbild hinten an – im Format des Projekts, mit der gewählten Dauer', st.kind === 'insert' && st.ec.call === 'Folge für mehr Analysen' && st.ec.name === '@honeybalecta' && st.dur === 3 && st.clip[0] === 'image' && st.clip[1] === st.out[0] && st.clip[2] === st.out[1] && Math.abs(st.total - st.o - 3) < 0.01 && st.block === 'Endkarte' && /Endkarte hinten angefügt/.test(st.toast), st);
chk('die Angaben bleiben im Gerät für das nächste Video', st.saved.call === 'Folge für mehr Analysen' && st.saved.name === '@honeybalecta' && st.saved.dur === 3 && /Endkarte aktualisieren/.test(st.btn), st.saved);
const ecFile = st.clip[3], ecDims = [st.clip[1], st.clip[2]];
const raw = (f, vf, extra = []) => execFileSync('ffmpeg', ['-v', 'error', ...extra, '-i', f, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 });
if (chk('das Schlussbild liegt als PNG beim Projekt', fs.existsSync(ecFile), ecFile)){
  const px = raw(ecFile, 'null'), [w, h] = ecDims, at = (x, y) => { const i = (Math.round(y) * w + Math.round(x)) * 3; return [px[i], px[i + 1], px[i + 2]]; };
  let light = 0, red = 0; for (let i = 0; i < px.length; i += 3){ if (px[i] > 200 && px[i + 1] > 200) light++; else if (px[i] > 180 && px[i + 1] < 110) red++; }
  const c = at(4, 4), prof = await ev(() => { const pr = slProfile(), C = slColors(pr, pr.theme !== 'hell'); return C.bg; });
  const bg = [1, 3, 5].map(k => parseInt(prof.slice(k, k + 2), 16));
  chk('es trägt den Hintergrund des Designprofils, hellen Text und die Akzentfarbe', px.length === w * h * 3 && c.every((v, k) => Math.abs(v - bg[k]) < 4) && light > 400 && red > 150, { c, bg, light, red });
}
await page.fill('#ecCall', 'Abonnieren und teilen'); await sleep(150); await page.click('#ecAdd'); await page.waitForFunction(() => P.items.some(x => x.endcard && x.endcard.call === 'Abonnieren und teilen'), null, { timeout: 15000 }); await sleep(300);
st = await ev(() => ({ n: P.items.filter(x => x.endcard).length, uri: P.items.find(x => x.endcard).clip.uri, toast: document.querySelector('#toast').textContent }));
chk('ein zweiter Klick aktualisiert die vorhandene Endkarte', st.n === 1 && st.uri !== ecFile && /Endkarte aktualisiert/.test(st.toast), st);
await done();
await ev(() => seekOut(total - 1, false)); await sleep(700); await shot('endkarte');
chk('auf der Bühne steht am Ende die Endkarte', await ev(() => { const g = timeline[curSeg]; return g && g.kind === 'insert' && !!g.item.endcard; }));

// ═════════ Echter Export: Baustein vorn, Video, Endkarte ═════════
const exp = (fmt, nm) => ev(async ([fmt, nm]) => { exFmt = fmt; await lowerReady(); await decoReady(); const plan = buildPlan(); plan.name = nm; const id = TS.exportVideo(JSON.stringify(plan));
  for (;;){ await new Promise(r => setTimeout(r, 300)); const j = JSON.parse(TS.job(id)); if (j.status === 'done') return { ok: true, result: j.result, total, plan: { n: plan.segments.length, kinds: plan.segments.map(s => s.kind).join(','), ovs: plan.overlays.map(o => ({ mode: o.mode, track: o.track, at: o.at, out: o.out, x: o.x, y: o.y, w: o.w, aspect: o.aspect, deco: !!o.deco, crop: o.crop || null })), w: plan.width, h: plan.height } }; if (j.status === 'error') return { ok: false, error: j.error }; } }, [fmt, nm]);
const dur = f => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();
const dims = f => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f]).toString().trim().split(',').map(Number);
const frame = (f, t, vf = 'null') => raw(f, vf, ['-ss', String(t)]);
const diff = (a, b, tol = 28) => { let n = 0; const m = Math.min(a.length, b.length); for (let i = 0; i < m; i++) if (Math.abs(a[i] - b[i]) > tol) n++; return a.length === b.length ? n / m : 1; };
await ev(() => { const m = timeline.filter(g => g.kind === 'main'); commit(() => { addDel(m[0].in + 5, m[m.length - 1].out); }, true); blockAdd(blockList[0].clip, 'front', 'Vorspann'); const it = P.items.find(x => x.block === 'Vorspann'); commit(() => { it.out = 3; }, true); P.settings.burn = false; }); await sleep(500);
const A = await exp('video', 'hausstil_a');
if (chk('der Export mit Baustein und Endkarte läuft durch', A.ok, A.error)){
  const f = A.result.playable, d = dur(f), [w, h] = dims(f);
  chk('Länge und Format stimmen: Baustein, Video, Endkarte im Hochformat', Math.abs(d - A.total) < 0.25 && Math.abs(A.total - 11) < 0.1 && h > w && /^insert,(main,?)+,insert$/.test(A.plan.kinds), { d, total: A.total, w, h, kinds: A.plan.kinds });
  const card = frame(f, A.total - 1), ref = raw(await ev(() => P.items.find(x => x.endcard).clip.uri), `scale=${w}:${h}`);
  chk('am Ende des Videos steht die Endkarte', diff(card, ref, 40) < 0.03, diff(card, ref, 40));
  const intro = frame(f, 1), body = frame(f, 5);
  chk('am Anfang läuft der Baustein, danach das Video', diff(intro, body) > 0.3 && diff(intro, card) > 0.1, [diff(intro, body), diff(intro, card)]);
  for (const x of A.result.files) fs.rmSync(x, { force: true, recursive: true });
}
const cc = await exp('capcut', 'hausstil_cc');
chk('auch der CapCut-Export nimmt Baustein und Endkarte mit', cc.ok, cc.error);
if (cc.ok) for (const x of cc.result.files) fs.rmSync(x, { force: true, recursive: true });

// ═════════ B8 · Layout-Vorlagen für Reaktionen ═════════
const geo = () => ev(() => { const s = document.querySelector('#stage').getBoundingClientRect(), f = el => { const r = el.getBoundingClientRect(); return [(r.left - s.left) / s.width, (r.top - s.top) / s.height, r.width / s.width, r.height / s.height].map(x => +x.toFixed(3)); };
  const it = P.items.find(x => x.type === 'pip' || x.type === 'broll'), l = layers.get(it.id), d = document.querySelector('#decoOv canvas'), [wf, hf] = fitFrac(), F = P.frame || { sc: 1, tx: 0, ty: 0 };
  // sichtbare Fläche der Einblendung (nach Zuschnitt) und Fläche des Hauptvideos, als Anteile der Bühne
  const c = cropOf(it), lr = f(l), vis = [lr[0] + c.l * lr[2], lr[1] + c.t * lr[3], lr[2] * (1 - c.l - c.r), lr[3] * (1 - c.t - c.b)].map(x => +x.toFixed(3));
  const main = [0.5 + F.tx - F.sc * wf / 2, 0.5 + F.ty - F.sc * hf / 2, F.sc * wf, F.sc * hf].map(x => +x.toFixed(3));
  return { vis, main, deco: d ? f(d) : null, it: { type: it.type, x: it.x, y: it.y, w: it.w, crop: it.crop || null, deco: it.deco || null, back: !!it.splitBack }, frame: P.frame || null, split: splitOf(it), on: [...document.querySelectorAll('#cSplit button.on')].map(b => b.textContent).join(), tf: V.style.transform }; });
const near = (a, b, tol = 0.012) => a.every((v, k) => Math.abs(v - b[k]) <= tol);
const covers = (m, half) => m[0] <= half[0] + 0.005 && m[1] <= half[1] + 0.005 && m[0] + m[2] >= half[0] + half[2] - 0.005 && m[1] + m[3] >= half[1] + half[3] - 0.005;
const HALF = { o: [0, 0, 1, 0.5], u: [0, 0.5, 1, 0.5], l: [0, 0, 0.5, 1], r: [0.5, 0, 0.5, 1] }, OPP = { o: 'u', u: 'o', l: 'r', r: 'l' };
async function splitRound(label){
  const res = {};
  for (const v of ['o', 'u', 'l', 'r']){ await page.click(`#cSplit [data-v="${v}"]`); await sleep(350); res[v] = await geo(); }
  chk(`${label}: Oben, Unten, Links, Rechts legen die Einblendung genau in ihre Hälfte`, ['o', 'u', 'l', 'r'].every(v => near(res[v].vis, HALF[v]) && res[v].split === v && res[v].it.type === 'pip'), Object.fromEntries(Object.entries(res).map(([k, x]) => [k, x.vis])));
  chk(`${label}: das Hauptvideo füllt jeweils die andere Hälfte`, ['o', 'u', 'l', 'r'].every(v => covers(res[v].main, HALF[OPP[v]]) && Math.abs(res[v].main[0] + res[v].main[2] / 2 - (HALF[OPP[v]][0] + HALF[OPP[v]][2] / 2)) < 0.006 && Math.abs(res[v].main[1] + res[v].main[3] / 2 - (HALF[OPP[v]][1] + HALF[OPP[v]][3] / 2)) < 0.006), Object.fromEntries(Object.entries(res).map(([k, x]) => [k, x.main])));
  chk(`${label}: der gewählte Knopf ist markiert`, res.o.on === 'Oben' && res.u.on === 'Unten' && res.l.on === 'Links' && res.r.on === 'Rechts', [res.o.on, res.r.on]);
  return res;
}
// Hochformat
await ev(() => { while (undo.length) document.querySelector('#undoBtn').click(); }); await sleep(300);
await ev(() => { commit(() => { P.format = '9:16'; P.frame = clampFrame({ sc: coverSc(), tx: 0.1, ty: 0 }); P.items = []; }, true); fitStage(); }); await sleep(300);
const react = await pick('clip', [MEDIA + 'broll2.mp4']);
await ev(m => { seekOut(1, false); placeMedia(m, 'pip', 1); }, react); await sleep(500);
const pipId = await ev(() => P.items.find(x => x.type === 'pip').id);
const start = await ev(() => { const it = P.items.find(x => x.type === 'pip'); return { x: it.x, y: it.y, w: it.w, frame: { ...P.frame } }; });
await ev(id => openItem(id), pipId); await sleep(400);
chk('das Element-Blatt bietet Splitscreen und Bild-im-Bild mit Rahmen und Namensschild', await ev(() => [...document.querySelectorAll('#cSplit button')].map(b => b.textContent).join() === 'Oben,Unten,Links,Rechts,Aus' && !!document.querySelector('#cFrame') && !!document.querySelector('#cTag') && document.querySelector('#cSplit button.on').textContent === 'Aus'));
const u0 = await ev(() => undo.length);
await splitRound('Hochformat');
await page.click('#cSplit [data-v="u"]'); await sleep(400); await shot('split-hoch');
await page.click('#cSplit [data-v=""]'); await sleep(350);
st = await geo();
chk('„Aus“ stellt Lage, Größe und Bildausschnitt von vorher wieder her', st.split === '' && st.on === 'Aus' && !st.it.crop && !st.it.back && Math.abs(st.it.x - start.x) < 0.002 && Math.abs(st.it.y - start.y) < 0.002 && Math.abs(st.it.w - start.w) < 0.002 && Math.abs(st.frame.tx - 0.1) < 0.002 && Math.abs(st.frame.sc - start.frame.sc) < 0.002, st);
await page.click('#cSplit [data-v="o"]'); await sleep(300);
await ev(() => document.querySelector('#undoBtn').click()); await sleep(400);
st = await ev(() => { const it = P.items.find(x => x.type === 'pip'); return [splitOf(it), !!it.crop, +P.frame.tx.toFixed(2)]; });
chk('Rückgängig nimmt den Splitscreen samt Bildausschnitt zurück', st[0] === '' && !st[1] && st[2] === 0.1, st);
// Rahmen und Namensschild
await ev(id => openItem(id), pipId); await sleep(300);
await page.check('#cFrame'); await page.fill('#cTag', '@honeybalecta'); await sleep(700);
st = await geo();
const ink = await ev(() => { const c = document.querySelector('#decoOv canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, at = (x, y) => { const i = (y * c.width + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]]; };
  const pr = slProfile(), C = slColors(pr, pr.theme !== 'hell'); return { top: at(c.width >> 1, 1), mid: at(c.width >> 1, c.height >> 1), tag: at(c.width >> 3, c.height - 8), acc: C.acc, bg: C.bg, size: [c.width, c.height] }; });
const hex = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
chk('Rahmen und Namensschild liegen genau um die Einblendung', st.deco && st.it.deco.frame && st.it.deco.name === '@honeybalecta' && st.deco[0] < st.vis[0] && st.deco[1] < st.vis[1] && st.deco[2] > st.vis[2] && st.deco[2] - st.vis[2] < 0.03 && Math.abs(st.deco[0] + st.deco[2] / 2 - st.vis[0] - st.vis[2] / 2) < 0.004 && Math.abs(st.deco[1] + st.deco[3] / 2 - st.vis[1] - st.vis[3] / 2) < 0.004, st);
chk('der Rahmen trägt die Akzentfarbe, die Mitte bleibt frei, das Schild steht unten links', ink.top[3] === 255 && hex(ink.acc).every((v, k) => Math.abs(v - ink.top[k]) < 6) && ink.mid[3] === 0 && ink.tag[3] === 255, ink);
await shot('rahmen');
await ev(() => { const it = P.items.find(x => x.type === 'pip'); const d = { x: 0.1, y: 0.15 }; commit(() => setElVals(it, 0, { x: it.x - d.x, y: it.y + d.y, w: it.w * 1.3 }), false); seekOut(outPos, false); }); await sleep(400);
const st2 = await geo();
chk('beim Verschieben und Vergrößern wandern Rahmen und Schild mit', st2.deco && st2.deco[2] > st.deco[2] * 1.2 && Math.abs(st2.deco[0] + st2.deco[2] / 2 - st2.vis[0] - st2.vis[2] / 2) < 0.004 && Math.abs(st2.deco[1] + st2.deco[3] / 2 - st2.vis[1] - st2.vis[3] / 2) < 0.004, [st.deco, st2.deco]);
await ev(() => { seekOut(0.2, false); }); await sleep(300);
chk('vor Beginn der Einblendung ist kein Rahmen zu sehen', await ev(() => !document.querySelector('#decoOv canvas')));
await ev(() => { seekOut(2, false); }); await sleep(300);
// Export: mit und ohne Rahmen
await done(); await ev(() => { P.settings.burn = false; const m = timeline.filter(g => g.kind === 'main'); commit(() => { addDel(m[0].in + 5, m[m.length - 1].out); const it = P.items.find(x => x.type === 'pip'); it.out = 3; }, true); }); await sleep(400);
const B = await exp('video', 'hausstil_b');
await ev(() => { commit(() => { delete P.items.find(x => x.type === 'pip').deco; }, false); }); await sleep(200);
const C = await exp('video', 'hausstil_c');
if (chk('Exporte mit und ohne Rahmen laufen durch', B.ok && C.ok, [B.error, C.error])){
  const el = B.plan.ovs.find(o => !o.deco), dc = B.plan.ovs.find(o => o.deco), [w, h] = dims(B.result.playable);
  chk('im Exportplan liegt der Rahmen als Bild über der Einblendung, zur selben Zeit, auf eigener Spur', dc && el && dc.mode === 'pip' && dc.track === 60 + el.track && dc.at === el.at && Math.abs(dc.out - (el.out - 0)) < 0.01 && dc.x === el.x && dc.y === el.y && dc.w > el.w && dc.w - el.w < 0.03 && C.plan.ovs.every(o => !o.deco), B.plan.ovs);
  const ew = el.w * w, eh = ew / el.aspect, ex = el.x * w - ew / 2, ey = el.y * h - eh / 2, t = el.at + 1;
  const reg = (x, y, cw, ch) => `crop=${Math.max(2, Math.round(cw))}:${Math.max(2, Math.round(ch))}:${Math.max(0, Math.round(x))}:${Math.max(0, Math.round(y))}`;
  const R = { tag: reg(ex + 4, ey + eh - 11, 46, 8), mid: reg(ex + ew * 0.3, ey + eh * 0.25, ew * 0.4, eh * 0.3), edge: reg(ex + ew * 0.2, ey - 3, ew * 0.6, 3) };
  const d = Object.fromEntries(Object.entries(R).map(([k, c]) => [k, +diff(frame(B.result.playable, t, c), frame(C.result.playable, t, c)).toFixed(3)]));
  chk('im Video stehen Namensschild und Rahmen an der Einblendung; ihr Bild bleibt unverändert', d.tag > 0.4 && d.edge > 0.3 && d.mid < 0.02, d);
  const edge = frame(B.result.playable, t, R.edge), acc = hex(ink.acc); let redish = 0; for (let i = 0; i < edge.length; i += 3) if (Math.abs(edge[i] - acc[0]) < 70 && edge[i] > edge[i + 1] + 50) redish++;
  chk('der Rahmen im Video hat die Akzentfarbe', redish / (edge.length / 3) > 0.5, redish / (edge.length / 3));
  for (const r of [B, C]) for (const x of r.result.files) fs.rmSync(x, { force: true, recursive: true });
}
// Keyframes: ohne Rahmen
await ev(() => { const it = P.items.find(x => x.type === 'pip'); commit(() => { it.deco = { frame: true, name: 'Test' }; it.kf = [{ t: 0, x: 0.3, y: 0.3, w: 0.3 }, { t: 2, x: 0.6, y: 0.6, w: 0.4 }]; }, false); seekOut(1.5, false); }); await sleep(400);
st = await ev(() => [!!document.querySelector('#decoOv canvas'), buildPlan(true).overlays.some(o => o.deco), decoOn(P.items.find(x => x.type === 'pip'))]);
chk('bewegte Einblendungen (Keyframes) bleiben ohne Rahmen', !st[0] && !st[1] && !st[2], st);

// Querformat ohne gewähltes Format, B-Roll als Ausgangspunkt, echter Export des Splitscreens
await fresh('anlauf.mp4');
await ev(m => { seekOut(0.5, false); placeMedia(m, 'broll', 0.5); }, react); await sleep(500);
const brId = await ev(() => P.items.find(x => x.type === 'broll').id);
await ev(id => openItem(id), brId); await sleep(400);
await splitRound('Querformat');
await page.click('#cSplit [data-v=""]'); await sleep(300);
st = await ev(() => { const it = P.items[0]; return [it.type, it.w == null, !it.crop, P.frame]; });
chk('aus einem B-Roll heraus führt „Aus“ zurück zum Vollbild', st[0] === 'broll' && st[1] && st[2] && st[3] == null, st);
await page.click('#cSplit [data-v="l"]'); await sleep(400); await shot('split-quer');
await done(); await ev(() => { P.settings.burn = false; const m = timeline.filter(g => g.kind === 'main'); commit(() => { addDel(m[0].in + 5, m[m.length - 1].out); P.items[0].out = 4; }, true); }); await sleep(400);
const D = await exp('video', 'hausstil_d');
if (chk('der Export mit Splitscreen läuft durch', D.ok, D.error)){
  const f = D.result.playable, [w, h] = dims(f), o = D.plan.ovs[0], t = 2;
  chk('im Exportplan füllt die Einblendung die linke Hälfte, mit Zuschnitt aufs halbe Bild', o.x === 0.25 && o.y === 0.5 && o.w === 0.5 && Math.abs(o.aspect - (w / 2) / h) < 0.01 && o.crop && Math.abs(o.crop.l - 0.25) < 0.002 && Math.abs(o.crop.r - 0.25) < 0.002, o);
  const half = (file, tt, x, src) => frame(file, tt, `${src ? `scale=${w}:${h},` : ''}crop=${w / 2}:${h}:${x}:0,scale=64:72`);
  const L = half(f, t, 0), Rr = half(f, t, w / 2), bro = half(MEDIA + 'broll2.mp4', t - o.at, w / 4, true), mainSrc = half(MEDIA + 'anlauf.mp4', t, w / 4, true);
  const d = { leftIsClip: +diff(L, bro, 40).toFixed(3), rightIsMain: +diff(Rr, mainSrc, 40).toFixed(3), cross: +diff(L, mainSrc, 40).toFixed(3) };
  chk('im Video zeigt die linke Hälfte den Einspieler und die rechte die Mitte des Hauptvideos', d.leftIsClip < 0.12 && d.rightIsMain < 0.12 && d.cross > 0.3, d);
  for (const x of D.result.files) fs.rmSync(x, { force: true, recursive: true });
}

// ═════════ Startseite und Handy ═════════
await leave(); await sleep(300);
await page.click('#houseHome'); await page.waitForSelector('#hsList'); await sleep(250);
st = await ev(() => ({ h: [...document.querySelectorAll('#sheetBody h4')].map(x => x.textContent).join('|'), use: document.querySelectorAll('#sheetBody [data-a="use"], #sheetBody [data-a="front"], #sheetBody [data-a="back"], #hsSave, #ecAdd').length, rows: document.querySelectorAll('#hsList .hs-row').length + document.querySelectorAll('#bkList .hs-row').length }));
chk('auf der Startseite lassen sich Vorlagen und Bausteine verwalten', st.h === 'Hausstil|Bausteine' && st.use === 0 && st.rows === 2, st);
await page.click('#hsList [data-a="def"]'); await sleep(200); await shot('startseite');
await page.click('#hsOk'); await sleep(250);
chk('das Blatt schließt auf der Startseite sauber', await ev(() => document.querySelector('#sheet').classList.contains('hidden') && !document.querySelector('#home').classList.contains('hidden') && houseDef === houseList[0].id));
await fresh('kurz.mp4');
chk('die auf der Startseite gewählte Vorgabe gilt für das nächste neue Projekt', await ev(() => P.house === houseDef && P.format === '9:16' && !!P.watermark));
await leave();
{
  const ph = await launch({ viewport: { width: 390, height: 844 }, dpr: 2 }), pg = ph.page, pe = (f, a) => pg.evaluate(f, a);
  const id = await newProject(pg, [MEDIA + 'anlauf.mp4']); made.push(id); await sleep(300);
  setPick({ clip: [MEDIA + 'broll1.mp4'] }); const bm = await pe(() => pickMedia('clip'));   // eigener Browser-Kontext: Vorlage und Baustein hier neu anlegen
  await pe(bm => { commit(() => { P.format = '9:16'; P.frame = clampFrame({ sc: coverSc(), tx: 0, ty: 0 }); P.textline = { ...TLINE_DEF, text: '@honeybalecta' }; }, true); fitStage(); seekOut(0, false);
    houseList.push({ id: newId(), name: 'Statement', st: houseOf() }); houseDef = houseList[0].id; saveHouse(); blockList.push({ id: newId(), name: 'Intro mit Kanal-Logo', clip: bm }); saveBlocks(); }, bm);
  await pg.click('#houseBtn'); await pg.waitForSelector('#hsList'); await sleep(300);
  const fit = await pe(() => { const s = document.querySelector('#sheet').getBoundingClientRect(); return { w: innerWidth, over: [...document.querySelectorAll('#sheetBody *')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1); }).length, rows: document.querySelectorAll('#sheetBody .hs-row').length, sheet: [Math.round(s.left), Math.round(s.right)] }; });
  chk('auf dem Handy passt das Blatt in die Breite', fit.over === 0 && fit.rows === 2 && fit.sheet[0] >= 0 && fit.sheet[1] <= fit.w, fit);
  await shot('handy-blatt', pg);
  await pe(() => document.querySelector('#sheet').scrollTo(0, 9999)); await sleep(200); await shot('handy-endkarte', pg);
  await pe(() => document.querySelector('#hsOk').click()); await sleep(200);
  setPick({ clip: [MEDIA + 'broll2.mp4'] }); const m = await pe(() => pickMedia('clip'));
  await pe(m => { seekOut(1, false); placeMedia(m, 'pip', 1); openItem(P.items[P.items.length - 1].id); }, m); await sleep(500);
  await pe(() => document.querySelector('#cSplit').scrollIntoView({ block: 'center' })); await sleep(200);
  const seg = await pe(() => { const b = [...document.querySelectorAll('#cSplit button')].map(x => x.getBoundingClientRect()); return { min: Math.min(...b.map(r => r.width)), right: Math.max(...b.map(r => r.right)), w: innerWidth, clipped: [...document.querySelectorAll('#cSplit button')].some(x => x.scrollWidth > x.clientWidth + 1) }; });
  chk('die fünf Splitscreen-Knöpfe sind auf dem Handy bedienbar', seg.min >= 44 && seg.right <= seg.w && !seg.clipped, seg);
  await pg.click('#cSplit [data-v="o"]'); await sleep(400); await shot('handy-split', pg);
  chk('auf dem Handy bleiben Meldungen der Seite aus', ph.logs.length === 0, ph.logs);
  await pe(k => { pausePlay(); clearTimeout(saveT); saveNow(); closeProject(); for (const x of k) localStorage.removeItem(x); }, KEYS); await ph.browser.close();
}

chk('keine Fehlermeldungen der Seite', logs.length === 0, logs);
await leave();
await ev(ids => { for (const i of ids){ try { TS.deleteProject(i); if (TS.trashPurge) TS.trashPurge(i); } catch (_) {} } }, made);
await wipe();
await browser.close();
ende();
