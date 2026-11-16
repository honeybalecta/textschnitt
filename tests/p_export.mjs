// Export (2.31): Export-Pakete je Plattform (A1), Export-Warteschlange (A2), Export über die Grafikkarte (H1).
// Die Grafikkarte wird im Test-Backend nachgestellt (gpu.json: „ok“ kodiert in Wahrheit mit libx264, „fail“ scheitert) –
// geprüft werden damit Schalter, Plan, Meldungen und der Rückfall auf den bisherigen Weg.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, newProject, transcribe, setPick, sleep, pruefung, MEDIA, OUT, WORK } from './drv.mjs';
const { chk, ende } = pruefung('Export');
const { browser, page, logs } = await launch();
const ev = (f, a) => page.evaluate(f, a);
const shot = (name, pg = page) => pg.screenshot({ path: path.join(OUT, `export-${name}.png`) });
const made = [], trash = new Set();
const GPU = path.join(WORK, 'gpu.json');
const gpu = async mode => { if (mode) fs.writeFileSync(GPU, JSON.stringify({ mode })); else fs.rmSync(GPU, { force: true }); await ev(() => { gpuState = null; gpuTries = 0; if (P) gpuCheck(); }); await sleep(250); };
const leave = () => ev(() => { if (typeof P !== 'undefined' && P){ pausePlay(); clearTimeout(saveT); saveNow(); closeProject(); } });
const fresh = async (file, cutTo, tr = true) => { await leave(); const id = await newProject(page, [MEDIA + file]); made.push(id); if (tr) await transcribe(page);
  if (cutTo) await ev(t => { const m = timeline.filter(g => g.kind === 'main'); commit(() => addDel(m[0].in + t, m[m.length - 1].out), true); }, cutTo);
  await ev(() => { P.settings.burn = false; setTab('export'); }); await sleep(300); return id; };
const q = () => ev(() => EXQ.map(x => ({ name: x.name, st: x.status, info: x.info, err: x.error, note: x.result && x.result.note, files: x.result && x.result.files, plan: x.plan && { w: x.plan.width, h: x.plan.height, gpu: !!x.plan.gpu, level: !!x.plan.level, extras: (x.plan.extras || []).map(e => e.name), text: !!x.plan.textfile, pack: x.plan.pack || null } })));
const idle = (t = 240000) => page.waitForFunction(() => !exDirect && EXQ.every(x => x.status !== 'wait' && x.status !== 'run'), null, { timeout: t });
const clearQ = async () => { for (const x of await q()) for (const f of x.files || []) trash.add(f); await ev(() => { EXQ.length = 0; paintQueue(); }); };
const toastTxt = () => ev(() => document.querySelector('#toast').textContent);
const dur = f => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();
const dims = f => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', f]).toString().trim().split(',').map(Number);
const frame = (f, t, vf) => execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 });
const diff = (a, b, tol = 40) => { let n = 0; const m = Math.min(a.length, b.length); for (let i = 0; i < m; i++) if (Math.abs(a[i] - b[i]) > tol) n++; return a.length === b.length ? n / m : 1; };
const direct = async () => { await page.click('#exBtn'); await page.waitForFunction(() => exDirect, null, { timeout: 10000 }).catch(() => {}); await page.waitForFunction(() => !exDirect && !document.querySelector('#exBtn').disabled, null, { timeout: 240000 });
  const r = await ev(() => ({ msg: document.querySelector('#exMsg').textContent, files: (exResult && exResult.files) || [], gpu: exResult && exResult.gpu, fb: exResult && exResult.gpuFallback, play: exResult && exResult.playable })); r.files.forEach(f => trash.add(f)); return r; };

await ev(() => { for (const k of ['hc-gpu', 'hc-pack', 'hc-house', 'hc-house-def', 'hc-textv', 'hc-cover']) localStorage.removeItem(k); houseList = []; houseDef = ''; EXQ.length = 0; });
fs.rmSync(GPU, { force: true });

// ═════════ H1 · Export über die Grafikkarte ═════════
const idA = await fresh('anlauf.mp4', 6);
await gpu(null); await sleep(4500); await ev(() => gpuCheck()); await sleep(300);
let st = await ev(() => ({ row: document.querySelector('#exGpuRow').classList.contains('nogpu'), shown: getComputedStyle(document.querySelector('#exGpuRow')).display, state: gpuState && gpuState.state, name: gpuState && gpuState.name, plan: 'gpu' in buildPlan(true), btns: [...document.querySelectorAll('#exBtn, #exQueueBtn, #exPackBtn')].map(b => b.textContent.trim() + (b.classList.contains('hidden') ? ' (versteckt)' : '')) }));
chk('ohne nutzbare Grafikkarte bleibt der Schalter verborgen und der Plan wie bisher', st.row && st.shown === 'none' && st.state === 'ready' && st.name === null && !st.plan, st);
chk('der Export-Reiter bietet „Video exportieren“, „In die Warteschlange“ und „Export-Paket …“', st.btns.join('|') === 'Video exportieren|In die Warteschlange|Export-Paket …', st.btns);
await gpu('ok');
st = await ev(() => ({ shown: getComputedStyle(document.querySelector('#exGpuRow')).display, text: document.querySelector('#exGpuRow').textContent.replace(/\s+/g, ' ').trim(), on: document.querySelector('#exGpu').checked, plan: buildPlan(true).gpu === true }));
chk('mit Grafikkarte erscheint der Schalter mit ihrem Namen und ist eingeschaltet', st.shown !== 'none' && st.text === 'Über die Grafikkarte rechnen (Nvidia (Test))' && st.on && st.plan, st);
await page.uncheck('#exGpu');
st = await ev(() => ['gpu' in buildPlan(true), localStorage.getItem('hc-gpu')]);
chk('abgewählt rechnet der Export auf dem bisherigen Weg; die Wahl gilt für dieses Gerät', !st[0] && st[1] === '0', st);
await page.check('#exGpu');
st = await ev(() => { const a = exFmt; exFmt = 'audio'; const p1 = 'gpu' in buildPlan(true); exFmt = 'capcut'; const p2 = 'gpu' in buildPlan(true); exFmt = a; return [p1, p2, localStorage.getItem('hc-gpu'), buildPlan(true).gpu]; });
chk('nur der Video-Export geht über die Grafikkarte', !st[0] && !st[1] && st[2] === '1' && st[3] === true, st);
let r = await direct();
chk('der Export meldet, dass die Grafikkarte gerechnet hat', r.gpu === 'Nvidia (Test)' && /gerechnet über die Grafikkarte \(Nvidia \(Test\)\)/.test(r.msg) && r.play && fs.existsSync(r.play) && Math.abs(dur(r.play) - 6) < 0.3, r);
await gpu('fail');
r = await direct();
chk('kommt die Grafikkarte nicht durch, rechnet der Export von selbst auf dem bisherigen Weg – das Video ist vollständig, die Meldung sagt es', r.fb === 'Nvidia (Test)' && !r.gpu && /bisherigen Weg/.test(r.msg) && fs.existsSync(r.play) && Math.abs(dur(r.play) - 6) < 0.3, r);
await gpu('ok');
await shot('reiter');

// ═════════ A2 · Export-Warteschlange ═════════
await page.click('#exQueueBtn'); await page.waitForFunction(() => EXQ.length === 1, null, { timeout: 15000 });
st = await ev(() => ({ btn: !document.querySelector('#queueBtn').classList.contains('hidden'), n: document.querySelector('#queueBtn').dataset.n, card: !document.querySelector('#queueCard').classList.contains('hidden'), rows: document.querySelectorAll('#queueList .q-row').length, toast: document.querySelector('#toast').textContent, direct: exDirect, exBtn: document.querySelector('#exBtn').disabled }));
chk('„In die Warteschlange“ reiht den Export ein: Zähler in der Kopfzeile, Karte im Export-Reiter, der Reiter bleibt frei', st.btn && st.n === '1' && st.card && st.rows === 1 && /wird exportiert – du kannst weiterschneiden/.test(st.toast) && !st.direct && !st.exBtn, st);
await leave(); await sleep(300);
st = await ev(() => ({ home: !document.querySelector('#home').classList.contains('hidden'), btn: !document.querySelector('#queueHome').classList.contains('hidden'), title: document.querySelector('#queueHome').title }));
chk('nach dem Schließen des Projekts läuft der Export weiter; die Startseite zeigt die Warteschlange', st.home && st.btn && /Export-Warteschlange: /.test(st.title), st);
await idle();
let list = await q();
chk('der Export ist fertig, die Dateien liegen im Ordner neben dem Video', list.length === 1 && list[0].st === 'done' && list[0].files.length >= 1 && list[0].files.every(f => fs.existsSync(f)) && /Fertig – gespeichert in/.test(list[0].note) && /Export fertig: anlauf_geschnitten/.test(await toastTxt()), list);
await page.click('#queueHome'); await page.waitForSelector('#queueSheetList'); await sleep(200);
st = await ev(() => ({ rows: [...document.querySelectorAll('#queueSheetList .q-row')].map(r => r.className + ' | ' + r.querySelector('b').textContent + ' | ' + [...r.querySelectorAll('button')].map(b => b.dataset.a).join(',')), sum: document.querySelector('#queueSheetSum').textContent, clear: !!document.querySelector('#queueSheetList [data-a="clear"]') }));
chk('das Blatt der Warteschlange zeigt den fertigen Export mit „Abspielen“ und „Im Ordner zeigen“', st.rows.length === 1 && st.rows[0] === 'q-row done | anlauf_geschnitten | open,show,drop' && st.sum === '1 fertig' && st.clear, st);
const calls = await ev(() => { const c = []; const v = TS.view, s = TS.share; TS.view = p => c.push('view:' + p); TS.share = p => c.push('share:' + p);
  document.querySelector('#queueSheetList [data-a="open"]').click(); document.querySelector('#queueSheetList [data-a="show"]').click(); TS.view = v; TS.share = s; return c; });
chk('„Abspielen“ öffnet das Video, „Im Ordner zeigen“ den Ordner', calls.length === 2 && /^view:.*anlauf_geschnitten\.mp4$/.test(calls[0]) && /^share:.*anlauf_honeycut$/.test(calls[1]), calls);
await shot('warteschlange-startseite');
await page.click('#queueSheetList [data-a="clear"]'); await sleep(200);
st = await ev(() => ({ n: EXQ.length, btn: document.querySelector('#queueHome').classList.contains('hidden'), txt: document.querySelector('#queueSheetList').textContent }));
chk('„Erledigte aus der Liste nehmen“ leert die Liste; der Knopf in der Kopfzeile verschwindet', st.n === 0 && st.btn && /Die Warteschlange ist leer/.test(st.txt), st);
await page.click('#queueOk'); await sleep(200);
for (const f of list[0].files) trash.add(f);

// Mehrere Projekte nacheinander: immer nur ein Export läuft, in der Reihenfolge des Einreihens
const idK = await fresh('kurz.mp4', 40);
await page.click('#exQueueBtn'); await page.waitForFunction(() => EXQ.length === 1, null, { timeout: 15000 });
await ev(() => { document.querySelector('#exName').value = 'kurz_zweite'; }); await page.click('#exQueueBtn'); await page.waitForFunction(() => EXQ.length === 2, null, { timeout: 15000 });
const t2 = await toastTxt();
await ev(i => { pausePlay(); clearTimeout(saveT); saveNow(); closeProject(); openProject(i); }, idA); await page.waitForFunction(i => P && P.id === i, idA); await sleep(400);
await ev(() => setTab('export')); await sleep(200);
await page.click('#exQueueBtn'); await page.waitForFunction(() => EXQ.length === 3, null, { timeout: 15000 });
const seen = []; let maxRun = 0;
for (let k = 0; k < 400; k++){ const s = await ev(() => EXQ.map(x => x.status)); maxRun = Math.max(maxRun, s.filter(x => x === 'run').length); const key = s.join(','); if (seen[seen.length - 1] !== key) seen.push(key); if (s.every(x => x === 'done' || x === 'error')) break; await sleep(150); }
list = await q();
chk('drei Exporte aus zwei Projekten laufen nacheinander durch', list.map(x => x.st).join() === 'done,done,done' && list.map(x => x.name).join() === 'kurz_geschnitten,kurz_zweite,anlauf_geschnitten' && list.every(x => x.files.every(f => fs.existsSync(f))), list.map(x => [x.name, x.st, x.err]));
chk('es rechnet immer nur einer; die Reihenfolge ist die des Einreihens', maxRun === 1 && !seen.some(s => /wait,.*run|wait,.*done/.test(s)) && /„kurz_zweite“ ist eingereiht/.test(t2), [maxRun, seen, t2]);
chk('jeder Eintrag nennt Projekt, Format, Größe und Länge', list[0].info === 'kurz · Video · 640×360 · 0:40' && list[2].info === 'anlauf · Video · 640×360 · 0:06', list.map(x => x.info));
chk('die Längen stimmen', Math.abs(dur(list[0].files[0]) - 40) < 0.4 && Math.abs(dur(list[2].files[0]) - 6) < 0.3);
await clearQ();

// Abbrechen, Herausnehmen, Erneut, Fehler
await ev(i => { pausePlay(); clearTimeout(saveT); saveNow(); closeProject(); openProject(i); }, idK); await page.waitForFunction(i => P && P.id === i, idK); await sleep(400);
await ev(() => { setTab('export'); document.querySelector('#exName').value = 'eins'; }); await page.click('#exQueueBtn'); await page.waitForFunction(() => EXQ.length === 1);
await ev(() => { document.querySelector('#exName').value = 'zwei'; }); await page.click('#exQueueBtn'); await page.waitForFunction(() => EXQ.length === 2);
await ev(() => { document.querySelector('#exName').value = 'drei'; }); await page.click('#exQueueBtn'); await page.waitForFunction(() => EXQ.length === 3);
st = await ev(() => [...document.querySelectorAll('#queueList .q-row')].map(r => r.className.replace('q-row ', '') + ':' + r.querySelector('.q-msg').textContent.replace(/Exportiere.*|Startet.*|\d+ %/, 'läuft') + ':' + [...r.querySelectorAll('button')].map(b => b.dataset.a).join(',')));
chk('die Karte zeigt, was läuft und was auf welchem Platz wartet', st.length === 3 && /^run:läuft:cancel$/.test(st[0]) && st[1] === 'wait:wartet · Platz 1:drop' && st[2] === 'wait:wartet · Platz 2:drop', st);
await shot('warteschlange-karte');
await page.click('#queueList .q-row:nth-child(2) [data-a="drop"]'); await sleep(200);
chk('ein wartender Eintrag lässt sich herausnehmen', (await q()).map(x => x.name).join() === 'eins,drei');
await page.click('#queueList .q-row:first-child [data-a="cancel"]');
await page.waitForFunction(() => EXQ[0].status === 'cancelled', null, { timeout: 30000 });
await idle();
list = await q();
chk('der laufende Export lässt sich abbrechen; der nächste rückt nach', list[0].st === 'cancelled' && list[1].st === 'done' && list[1].name === 'drei', list.map(x => [x.name, x.st]));
st = await ev(() => [...document.querySelectorAll('#queueList .q-row:first-child button')].map(b => b.dataset.a).join());
chk('ein abgebrochener Eintrag bietet „Erneut“', st === 'retry,drop', st);
await ev(() => { EXQ[0].plan.segments = EXQ[0].plan.segments.slice(0, 1); EXQ[0].plan.segments[0].out = EXQ[0].plan.segments[0].in + 3; EXQ[0].plan.total = 3; if (EXQ[0].plan.subs) EXQ[0].plan.subs = null; });
await page.click('#queueList .q-row:first-child [data-a="retry"]'); await idle();
list = await q();
chk('„Erneut“ rechnet den Eintrag noch einmal', list[0].st === 'done' && fs.existsSync(list[0].files[0]), list.map(x => [x.name, x.st, x.err]));
await clearQ();
await ev(() => { document.querySelector('#exName').value = 'kaputt'; }); await page.click('#exQueueBtn');
await ev(() => { document.querySelector('#exName').value = 'danach'; }); await page.waitForFunction(() => EXQ.length === 1);
await ev(() => { const p = buildPlan(); p.name = 'fehlt'; p.segments = p.segments.map(s => ({ ...s, uri: s.uri.replace(/kurz\.mp4$/, 'gibtsnicht.mp4') })); p.sources = p.sources.map(s => ({ ...s, uri: s.uri.replace(/kurz\.mp4$/, 'gibtsnicht.mp4') })); exqAdd({ name: 'fehlt', proj: P.id, info: 'Test', plan: p, tv: '', tvName: '' }); });
await page.click('#exQueueBtn'); await page.waitForFunction(() => EXQ.length === 3); await idle();
list = await q();
st = await ev(() => ({ row: document.querySelector('#queueList .q-row.error .q-msg').textContent.slice(0, 60), btn: document.querySelector('#queueBtn').className, sum: document.querySelector('#queueSum').textContent }));
chk('scheitert ein Export, steht der Grund am Eintrag und die übrigen laufen weiter', list.map(x => x.st).join() === 'done,error,done' && /^Fehler: /.test(st.row) && st.sum === '2 fertig · 1 fehlgeschlagen' && /bad/.test(st.btn), [list.map(x => [x.name, x.st, (x.err || '').slice(0, 80)]), st]);
await clearQ();

// Direkter Export und Warteschlange kommen sich nicht in die Quere
await ev(() => { document.querySelector('#exName').value = 'lang_in_der_schlange'; }); await page.click('#exQueueBtn'); await page.waitForFunction(() => EXQ.length === 1 && EXQ[0].status === 'run');
await ev(() => { document.querySelector('#exName').value = 'direkt_gedrueckt'; });
st = await ev(() => document.querySelector('#exBtn').title);
await page.click('#exBtn'); await page.waitForFunction(() => EXQ.length === 2, null, { timeout: 15000 });
const s2 = await ev(() => [exDirect, EXQ.map(x => x.status).join(), document.querySelector('#toast').textContent]);
chk('läuft die Warteschlange, reiht „Video exportieren“ den Export ein', /wird eingereiht/.test(st) && s2[0] === false && s2[1] === 'run,wait' && /„direkt_gedrueckt“ ist eingereiht/.test(s2[2]), [st, s2]);
await idle(); await clearQ();
await ev(() => { document.querySelector('#exName').value = 'direkt_zuerst'; }); await page.click('#exBtn'); await page.waitForFunction(() => exDirect, null, { timeout: 15000 });
await ev(() => { document.querySelector('#exName').value = 'wartet_auf_direkt'; }); await page.click('#exQueueBtn'); await page.waitForFunction(() => EXQ.length === 1);
const s3 = await ev(() => [exDirect, EXQ[0].status, document.querySelector('#toast').textContent]);
await page.waitForFunction(() => !exDirect, null, { timeout: 240000 }); await sleep(300);
const s4 = await ev(() => [EXQ[0].status, (exResult && exResult.files) || []]); s4[1].forEach(f => trash.add(f));
await idle();
chk('läuft ein direkter Export, wartet die Warteschlange und startet danach von selbst', s3[0] === true && s3[1] === 'wait' && /ist eingereiht/.test(s3[2]) && (s4[0] === 'run' || s4[0] === 'done') && (await q())[0].st === 'done', [s3, s4[0]]);
st = await ev(() => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); const idleP = e.defaultPrevented; EXQ.push({ id: 'x', name: 'x', status: 'wait' }); const e2 = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e2); EXQ.pop(); return [idleP, e2.defaultPrevented]; });
chk('beim Schließen mit wartenden Exporten fragt der Browser nach', st[0] === false && st[1] === true, st);
await clearQ();

// ═════════ A1 · Export-Pakete ═════════
await ev(i => { pausePlay(); clearTimeout(saveT); saveNow(); closeProject(); openProject(i); }, idA); await page.waitForFunction(i => P && P.id === i, idA); await sleep(400);
await ev(() => { setTab('export'); seekOut(2, false); }); await sleep(400);
const before = await ev(() => ({ fmt: P.format || null, frame: 'frame' in P ? P.frame : '(fehlt)', undo: undo.length, exFmt, lim: outLim, snap: snapshot() }));
await page.click('#exPackBtn'); await page.waitForSelector('#pkGo'); await sleep(250);
st = await ev(() => ({ rows: [...document.querySelectorAll('.pk-row')].map(r => r.querySelector('b').textContent + ' | ' + [...r.querySelectorAll('.muted')].map(s => s.textContent).join(' | ') + ' | ' + r.querySelector('input').checked), go: document.querySelector('#pkGo').textContent, warn: !!document.querySelector('.pk-warn') }));
chk('das Paket bietet Hochformat, Querformat, Feed und Titelbild – mit Zweck, Größe und Dateinamen', st.rows.length === 4 && st.rows[0] === 'Hochformat 9:16 | TikTok, Reels, Shorts · 360 × 640 · das Video füllt das Bild | anlauf_hoch_9x16.mp4 | true'
  && st.rows[1] === 'Querformat 16:9 | YouTube · 640 × 360 · Format des Projekts | anlauf_quer_16x9.mp4 | true' && st.rows[2] === 'Feed 4:5 | Instagram-Feed · 360 × 450 · das Video füllt das Bild | anlauf_feed_4x5.mp4 | false' && /^Titelbild \| .*JPG.* \| true$/.test(st.rows[3]) && st.go === '2 Fassungen einreihen' && !st.warn, st);
await shot('paket');
await page.click('[data-pk="feed"]'); await sleep(100);
st = await ev(() => [document.querySelector('#pkGo').textContent, JSON.parse(localStorage.getItem('hc-pack'))]);
chk('die Auswahl zählt mit und bleibt im Gerät', st[0] === '3 Fassungen einreihen' && st[1].feed === true && st[1].hoch === true && st[1].cover === true, st);
await page.click('[data-pk="feed"]');
await ev(() => { P.settings.textv = true; });
await page.click('#pkGo'); await page.waitForFunction(() => EXQ.length === 2, null, { timeout: 30000 }); await sleep(200);
list = await q();
const after = await ev(() => ({ fmt: P.format || null, frame: 'frame' in P ? P.frame : '(fehlt)', undo: undo.length, exFmt, lim: outLim, snap: snapshot(), sheet: document.querySelector('#sheet').classList.contains('hidden'), toast: document.querySelector('#toast').textContent }));
chk('ein Klick reiht beide Fassungen ein – je mit Größe, einheitlicher Lautstärke und eigenem Namen', list.length === 2 && list[0].name === 'anlauf_hoch_9x16' && list[1].name === 'anlauf_quer_16x9'
  && (list[0].plan ? list[0].plan.w === 360 && list[0].plan.h === 640 && list[0].plan.level && list[0].plan.gpu : list[0].st === 'done') && list[1].plan && list[1].plan.w === 640 && list[1].plan.h === 360 && list[1].plan.level && list[1].plan.pack === 'quer'
  && list[0].info === 'anlauf · Hochformat 9:16 · 360×640 · 0:06' && /2 Fassungen sind eingereiht/.test(after.toast) && after.sheet, [list.map(x => [x.name, x.info, x.plan]), after.toast]);
chk('das Projekt bleibt dabei unberührt: Format, Bildausschnitt, Schnitt und Rückgängig-Verlauf', JSON.stringify({ ...after, sheet: 0, toast: 0 }) === JSON.stringify({ ...before, sheet: 0, toast: 0 }), [before.fmt, after.fmt, before.frame, after.frame, before.undo, after.undo, after.lim, after.exFmt]);
await idle();
list = await q();
const hoch = list[0].files.find(f => f.endsWith('.mp4')), quer = list[1].files.find(f => f.endsWith('.mp4')), titel = list[0].files.find(f => /Titelbild\.jpg$/.test(f)), names = list.map(x => x.files.map(f => path.basename(f)));
chk('beide Fassungen sind fertig; Titelbild, Textfassung und SRT liegen im selben Ordner', list.every(x => x.st === 'done') && hoch && quer && titel && fs.existsSync(titel) && names[0].includes('anlauf_hoch_9x16.srt') && names[0].some(n => / – Textfassung\.txt$/.test(n)) && names[1].includes('anlauf_quer_16x9.srt') && !names[1].some(n => /Titelbild|Textfassung/.test(n))
  && new Set(list.flatMap(x => x.files.map(f => path.dirname(f)))).size === 1, names);
if (hoch && quer && titel){
  const dh = dims(hoch), dq = dims(quer), dt = dims(titel);
  chk('Hochformat 360 × 640, Querformat 640 × 360, Titelbild im Format des Projekts; beide Videos gleich lang', dh.join() === '360,640' && dq.join() === '640,360' && dt.join() === '640,360' && Math.abs(dur(hoch) - 6) < 0.3 && Math.abs(dur(quer) - 6) < 0.3, [dh, dq, dt]);
  const src = MEDIA + 'anlauf.mp4', a = frame(hoch, 3, 'scale=90:160'), b = frame(src, 3, 'scale=-2:640,crop=360:640,scale=90:160'), c = frame(quer, 3, 'scale=160:90'), d = frame(src, 3, 'scale=160:90');
  chk('das Hochformat zeigt die Mitte des Videos bildfüllend, das Querformat das ganze Bild', diff(a, b) < 0.1 && diff(c, d) < 0.1, [diff(a, b), diff(c, d)]);
}
await clearQ();

// Eigener Bildausschnitt je Format, Auflösungsgrenzen, Hinweis bei Folien und Endkarte
await ev(() => { commit(() => { P.format = '9:16'; P.frame = clampFrame({ sc: coverSc(), tx: 0.6, ty: 0 }); }, true); commit(() => { P.format = null; P.frame = null; }, true); fitStage(); renderExportForm(); }); await sleep(300);
st = await ev(() => { const e = PACK[0], p = packWith(e, () => buildPlan(true)); return { by: P.frameBy, tx: p.segments[0].tx, sc: p.segments[0].sc, cover: +packWith(e, () => coverSc()).toFixed(3), fmt: P.format || null, frame: P.frame }; });
chk('hat das Format im Projekt schon einen eigenen Bildausschnitt, nimmt das Paket ihn', st.by && st.by['9:16'] && Math.abs(st.tx - 0.6) < 0.002 && Math.abs(st.sc - st.cover) < 0.01 && st.fmt === null && st.frame === null, st);
await page.click('#exPackBtn'); await page.waitForSelector('#pkGo'); await sleep(200);
chk('das Blatt sagt es dazu', /dein Bildausschnitt für dieses Format/.test(await ev(() => document.querySelector('.pk-row').textContent)));
await page.click('#pkNo'); await sleep(200);
st = await ev(() => { const s = P.sources[0], w0 = s.width, h0 = s.height; s.width = 3840; s.height = 2160; const a = PACK.map(e => packSize(e).join('×')); s.width = 1080; s.height = 1920; P.format = null; const b = PACK.map(e => [packSize(e).join('×'), packNative(e)]); s.width = w0; s.height = h0; return [a, b]; });
chk('aus 4K-Material entstehen 1080 × 1920 fürs Hochformat, das Querformat bleibt in 4K, der Feed bekommt 1080 × 1350', st[0].join() === '1080×1920,3840×2160,1080×1350', st[0]);
chk('ein Hochformat-Video ist selbst die Hochformat-Fassung; die Querfassung entsteht daraus', st[1][0].join() === '1080×1920,true' && st[1][1][1] === false && st[1][1][0] === '1920×1080', st[1]);
await ev(() => { commit(() => { P.items.push({ id: 'ec1', type: 'insert', at: r3(timeline[timeline.length - 1].out), clip: { uri: P.sources[0].uri, kind: 'image', width: 640, height: 360, duration: 600 }, in: 0, out: 2, endcard: { call: 'Test', name: '' } }); }, true); }); await sleep(200);
await page.click('#exPackBtn'); await page.waitForSelector('#pkGo'); await sleep(200);
chk('mit Endkarte, Folien oder Splitscreen weist das Blatt auf die abgeleiteten Fassungen hin', /Folien, Endkarte und Splitscreen sind für das Format des Projekts angelegt/.test(await ev(() => (document.querySelector('.pk-warn') || {}).textContent || '')));
// nur das Titelbild
for (const k of ['hoch', 'quer']) await page.uncheck(`[data-pk="${k}"]`);
st = await ev(() => document.querySelector('#pkGo').textContent);
const coverTo = path.join(OUT, 'export-titelbild-allein.jpg'); fs.rmSync(coverTo, { force: true }); setPick({ save_any: [coverTo] });
await page.click('#pkGo'); await sleep(1500);
chk('nur das Titelbild gewählt: Es wird gespeichert, die Warteschlange bleibt leer', st === 'Titelbild speichern' && fs.existsSync(coverTo) && dims(coverTo).join() === '640,360' && (await q()).length === 0, [st, fs.existsSync(coverTo)]);
await ev(() => openPack()); await sleep(250);
await page.uncheck('#pkCover');
st = await ev(() => [document.querySelector('#pkGo').textContent, document.querySelector('#pkGo').disabled]);
chk('ohne Auswahl ist der Knopf gesperrt', st[0] === 'Nichts gewählt' && st[1] === true, st);
for (const k of ['hoch', 'quer']) await page.check(`[data-pk="${k}"]`); await page.check('#pkCover'); await page.click('#pkNo'); await sleep(200);
await ev(() => { document.querySelector('#undoBtn').click(); delete P.settings.textv; });

// Projekt im Hochformat: Die Querfassung entsteht abgeleitet; offene Belege halten auch das Paket auf
await ev(() => { commit(() => { P.format = '9:16'; P.frame = clampFrame({ sc: coverSc(), tx: 0, ty: 0 }); }, true); fitStage(); renderExportForm(); }); await sleep(300);
await page.click('#exPackBtn'); await page.waitForSelector('#pkGo'); await sleep(200);
st = await ev(() => [...document.querySelectorAll('.pk-row')].slice(0, 2).map(r => r.querySelector('.muted').textContent));
chk('im Hochformat-Projekt ist das Hochformat das Format des Projekts, das Querformat abgeleitet', /Format des Projekts$/.test(st[0]) && /640 × 360 · das Video füllt das Bild$/.test(st[1]), st);
await page.click('#pkNo'); await sleep(200);

// ═════════ Handy ═════════
await leave();
{
  const ph = await launch({ viewport: { width: 390, height: 844 }, dpr: 2 }), pg = ph.page, pe = (f, a) => pg.evaluate(f, a);
  const id = await newProject(pg, [MEDIA + 'anlauf.mp4']); made.push(id); await sleep(300);
  await pe(() => { const m = timeline.filter(g => g.kind === 'main'); commit(() => addDel(m[0].in + 5, m[m.length - 1].out), true); P.settings.burn = false; setTab('export'); gpuState = null; gpuTries = 0; gpuCheck(); }); await sleep(500);
  const over = sel => pe(sel => [...document.querySelectorAll(sel + ' *')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1); }).length, sel);
  await pe(() => document.querySelector('#exBtn').scrollIntoView({ block: 'center' })); await sleep(200);
  const b = await pe(() => [...document.querySelectorAll('#exBtn, #exQueueBtn, #exPackBtn')].map(x => { const r = x.getBoundingClientRect(); return [Math.round(r.height), r.right <= innerWidth, x.scrollWidth <= x.clientWidth + 1]; }));
  chk('auf dem Handy sind die drei Export-Knöpfe ganz zu sehen und groß genug', b.every(x => x[0] >= 36 && x[1] && x[2]) && (await over('#paneExport')) === 0, b);
  await shot('handy-reiter', pg);
  await pg.click('#exPackBtn'); await pg.waitForSelector('#pkGo'); await sleep(300);
  chk('das Paket-Blatt passt in die Breite', (await over('#sheetBody')) === 0);
  await shot('handy-paket', pg);
  await pg.click('#pkGo'); await pg.waitForFunction(() => EXQ.length === 2, null, { timeout: 30000 }); await sleep(300);
  await pe(() => document.querySelector('#queueCard').scrollIntoView({ block: 'center' })); await sleep(200);
  chk('die Warteschlange passt in die Breite; der Zähler steht in der Kopfzeile', (await over('#queueCard')) === 0 && await pe(() => !document.querySelector('#queueBtn').classList.contains('hidden') && !!document.querySelector('#queueBtn').dataset.n));
  await shot('handy-warteschlange', pg);
  await pg.waitForFunction(() => EXQ.every(x => x.status === 'done' || x.status === 'error'), null, { timeout: 240000 });
  const fl = await pe(() => EXQ.flatMap(x => (x.result && x.result.files) || [])); fl.forEach(f => trash.add(f));
  chk('am Handy laufen beide Fassungen durch', await pe(() => EXQ.every(x => x.status === 'done')), await pe(() => EXQ.map(x => [x.name, x.status, x.error])));
  chk('auf dem Handy bleiben Meldungen der Seite aus', ph.logs.length === 0, ph.logs);
  await pe(() => { pausePlay(); clearTimeout(saveT); saveNow(); closeProject(); for (const k of ['hc-gpu', 'hc-pack']) localStorage.removeItem(k); }); await ph.browser.close();
}

chk('keine Fehlermeldungen der Seite', logs.filter(l => !/gibtsnicht\.mp4/.test(l)).length === 0, logs);
await leave();
await ev(ids => { for (const i of ids){ try { TS.deleteProject(i); if (TS.trashPurge) TS.trashPurge(i); } catch (_) {} } for (const k of ['hc-gpu', 'hc-pack', 'hc-textv']) localStorage.removeItem(k); }, made);
fs.rmSync(GPU, { force: true });
for (const f of trash) fs.rmSync(f, { force: true, recursive: true });
await browser.close();
ende();
