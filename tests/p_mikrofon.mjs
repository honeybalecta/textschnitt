// Zweite Tonquelle angleichen (2.41, E10; Windows): Feld „Ton vom externen Mikrofon“ im Blatt „Anpassen“. kamera.mp4 trägt das
// Gespräch mit Hall und Rauschen, mikrofon.wav dasselbe Gespräch sauber und 3,2 s früher gestartet (siehe medien.py).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, newProject, transcribe, openById, dropScratch, setPick, sleep, pruefung, MEDIA, DATA } from './drv.mjs';
const { chk, ende } = pruefung('Zweite Tonquelle angleichen');
const { browser, page, logs } = await launch();
const ev = (f, a) => page.evaluate(f, a);
const made = [], trash = [];
const toast = () => ev(() => document.querySelector('#toast').textContent);
const openAdj = async () => { await ev(() => { setTab('studio'); }); await sleep(500); await ev(() => { TL.sel = { kind: 'main', i: 0 }; renderTimeline(); openFx(timeline[0]); }); await sleep(300); };
const state = () => ev(() => { const s = P.sources[0], q = c => document.querySelector(c); return { uri: s.uri, orig: s.orig || null, mic: s.mic || null, matte: !!s.matte, go: q('.mcGo').textContent, goOff: q('.mcGo').disabled, origBtn: !q('.mcOrig').classList.contains('hidden'), hint: q('.mcHint').textContent, prog: q('.mcProg').classList.contains('hidden'), toast: q('#toast').textContent, stGo: q('.stGo') ? q('.stGo').disabled : null, stHint: q('.stHint') ? q('.stHint').textContent : '' }; });
const waitDone = () => page.waitForFunction(() => document.querySelector('.mcProg').classList.contains('hidden') && !document.querySelector('.mcGo').disabled, null, { timeout: 120000 });
// Lautstärke (Effektivwert) eines Abschnitts der Datei – die Kamera ist leise, das Mikrofon laut
const rms = (file, a, d) => { const b = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(a), '-t', String(d), '-i', file, '-vn', '-ac', '1', '-ar', '8000', '-f', 's16le', '-'], { maxBuffer: 1 << 26 }); let s = 0; const n = b.length >> 1; for (let i = 0; i < n; i++){ const v = b.readInt16LE(i * 2) / 32768; s += v * v; } return Math.sqrt(s / Math.max(1, n)); };

try {
  const id = await newProject(page, [MEDIA + 'kamera.mp4']); made.push(id); await transcribe(page);
  const words0 = await ev(() => tokens.filter(t => t.type === 'word').map(t => [t.text, t.ws, t.we]));
  await openAdj();
  let st = await state();
  chk('Im Blatt „Anpassen“ steht das Feld „Ton vom externen Mikrofon“ mit einer Erklärung', await ev(() => CAP.audiosync && !!document.querySelector('.micblk')) && /Tonaufnahme wählen/.test(st.go) && !st.goOff && !st.origBtn && /externen Mikrofons oder Rekorders/.test(st.hint), st.hint);
  // keine Datei gewählt
  setPick({ audio: [] }); await ev(() => document.querySelector('.mcGo').click()); await sleep(500);
  chk('Ohne gewählte Datei geschieht nichts', await ev(() => !P.sources[0].mic && !P.sources[0].orig && document.querySelector('.mcProg').classList.contains('hidden')));
  // ein Bild statt Ton
  setPick({ audio: [MEDIA + 'folie1.png'] }); await ev(() => document.querySelector('.mcGo').click()); await sleep(700);
  chk('Ein Bild wird mit einem Hinweis abgelehnt', /Tonaufnahme wählen/.test(await toast()) && await ev(() => !P.sources[0].mic));
  // fremde Aufnahme
  setPick({ audio: [MEDIA + 'musik.wav'] }); await ev(() => document.querySelector('.mcGo').click()); await page.waitForFunction(() => /fehlgeschlagen/.test(document.querySelector('#toast').textContent), null, { timeout: 60000 }).catch(() => {}); await waitDone();
  st = await state();
  chk('Eine Aufnahme, die nicht zum Video passt, wird abgelehnt; die Aufnahme bleibt, wie sie war', /passen nicht erkennbar zusammen/.test(st.toast) && !st.mic && !st.orig && st.uri.endsWith('kamera.mp4'), st.toast);
  // das passende Mikrofon
  const camUri = st.uri;
  setPick({ audio: [MEDIA + 'mikrofon.wav'] }); await ev(() => document.querySelector('.mcGo').click());
  const lief = await page.waitForFunction(() => !document.querySelector('.mcProg').classList.contains('hidden'), null, { timeout: 5000 }).then(() => true, () => false);
  await page.waitForFunction(() => !!P.sources[0].mic, null, { timeout: 120000 }); await waitDone();
  st = await state(); trash.push(st.uri, st.uri.replace(/\.mp4$/, '.json'));
  chk('Angleichen: Fortschritt, danach läuft die Aufnahme als Kopie mit dem Ton des Mikrofons', lief && st.orig === camUri && /mikrofon[\\/][0-9a-f]{16}\.mp4$/.test(st.uri) && /liegt jetzt unter dem Bild/.test(st.toast) && !st.matte, { uri: st.uri, toast: st.toast });
  chk('Gemerkt: Name der Datei und Versatz (das Mikrofon lief 3,2 s vor der Kamera an)', st.mic && st.mic.name === 'mikrofon.wav' && Math.abs(st.mic.offset + 3.2) < 0.003 && st.mic.drift === 0, st.mic);
  chk('Der Hinweis nennt Datei und Versatz, der Knopf heißt „Andere Tonaufnahme wählen“, „Original zurück“ erscheint', /„mikrofon\.wav“/.test(st.hint) && /3,2 s vor der Kamera/.test(st.hint) && /Andere Tonaufnahme/.test(st.go) && st.origBtn, st.hint);
  chk('„Bild beruhigen“ verweist auf die Reihenfolge und ist gesperrt', st.stGo === true && /Erst beruhigen, dann den Ton angleichen/.test(st.stHint), st.stHint);
  const laut = [rms(camUri, 5, 20), rms(st.uri, 5, 20)];
  chk('Die Kopie klingt wie das Mikrofon (deutlich lauter als der Kameraton) und ist so lang wie das Video', laut[1] > laut[0] * 1.6 && await ev(() => Math.abs(P.sources[0].duration - 54.97) < 0.2), laut.map(v => +v.toFixed(4)));
  const words1 = await ev(() => tokens.filter(t => t.type === 'word').map(t => [t.text, t.ws, t.we]));
  chk('Transkript und Wortzeiten bleiben unverändert', JSON.stringify(words0) === JSON.stringify(words1));
  // Lage prüfen: Im Kameraton beginnt das erste Wort bei words0[0][1]; in der Kopie muss dort ebenfalls Sprache beginnen
  const w0 = words0[0][1], vorher = rms(st.uri, Math.max(0, w0 - 0.35), 0.25), dabei = rms(st.uri, w0 + 0.02, 0.25);
  chk('Das erste Wort beginnt in der Kopie an derselben Stelle wie im Kameraton', dabei > 8 * Math.max(vorher, 1e-4), { w0, vorher: +vorher.toFixed(5), dabei: +dabei.toFixed(4) });
  await ev(() => document.querySelector('#fxOk').click()); await sleep(300);
  // Vorschau spielt die Kopie; Export nimmt sie
  const plan = await ev(() => { exFmt = 'video'; const p = buildPlan(true); return { uri: p.segments[0].uri, src: p.sources[0].uri, v: V.src }; });
  chk('Vorschau und Exportplan verwenden die Kopie', plan.uri === st.uri && plan.src === st.uri && /mikrofon/.test(decodeURIComponent(plan.v)), plan);
  // Speichern, Wiederöffnen
  await ev(() => { saveNow(); closeProject(); }); await sleep(300); await openById(page, id); await openAdj();
  let re = await state();
  chk('Nach Schließen und Öffnen: Kopie, Versatz und Hinweis sind noch da', re.uri === st.uri && re.mic && re.mic.name === 'mikrofon.wav' && /3,2 s vor der Kamera/.test(re.hint) && re.origBtn, re.hint);
  // Speicher verwalten: die Kopie zählt als verwendet
  const sto = await ev(() => TS.storage()), grp = sto.groups.find(g => g.key === 'mic');
  chk('Speicher verwalten: „Kopien mit Mikrofon-Ton“ führt die Kopie als verwendet', grp && grp.count === 1 && grp.nfree === 0 && !!grp.items[0].used, grp && { count: grp.count, nfree: grp.nfree });
  // erneut dieselbe Datei: sofort, selbes Ergebnis (aus der Aufnahme mit Kameraton gerechnet)
  setPick({ audio: [MEDIA + 'mikrofon.wav'] }); await ev(() => document.querySelector('.mcGo').click()); await sleep(300); await waitDone(); await sleep(300);
  re = await state();
  chk('Erneutes Angleichen geht vom Kameraton aus und liefert dieselbe Kopie', re.uri === st.uri && re.orig === camUri && Math.abs(re.mic.offset + 3.2) < 0.003, { uri: re.uri, off: re.mic && re.mic.offset });
  // Original zurück
  await ev(() => document.querySelector('.mcOrig').click()); await sleep(500);
  re = await state();
  chk('„Original zurück“: Die Aufnahme läuft wieder mit dem Ton der Kamera, „Bild beruhigen“ ist wieder frei', re.uri === camUri && !re.orig && !re.mic && !re.origBtn && /Ton der Kamera/.test(re.toast) && re.stGo === false && /Tonaufnahme wählen/.test(re.go), { uri: re.uri, toast: re.toast });
  // Abbruch
  await ev(() => { const f = P.sources[0]; f._x = 1; });
  fs.rmSync(st.uri, { force: true }); fs.rmSync(st.uri.replace(/\.mp4$/, '.json'), { force: true });
  setPick({ audio: [MEDIA + 'mikrofon.wav'] }); await ev(() => document.querySelector('.mcGo').click());
  await page.waitForFunction(() => !document.querySelector('.mcStop').classList.contains('hidden'), null, { timeout: 5000 }); await ev(() => document.querySelector('.mcStop').click()); await waitDone(); await sleep(500);
  re = await state();
  chk('Abbruch: nichts eingetauscht, keine halbe Datei im Datenordner', !re.mic && re.uri === camUri && !fs.readdirSync(path.join(DATA, 'mikrofon')).some(f => /\.tmp\./.test(f)), fs.readdirSync(path.join(DATA, 'mikrofon')));
  // Aufnahme ohne Ton: Feld gesperrt
  await ev(() => { P.sources[0].hasAudio = false; document.querySelector('#fxOk').click(); }); await openAdj();
  re = await state();
  chk('Eine Aufnahme ohne Kameraton: Der Knopf ist gesperrt, der Hinweis erklärt es', re.goOff && /Ton der Kamera/.test(re.hint), re.hint);
  await ev(() => { delete P.sources[0].hasAudio; document.querySelector('#fxOk').click(); });
} catch (e){ chk('Prüfung abgebrochen', false, String((e && e.stack) || e).replace(/\s+/g, ' ').slice(0, 500)); }

const echte = logs.filter(l => !/HTTP 500: api\/job|Failed to load/.test(l));
chk('keine Fehlermeldungen der Seite', echte.length === 0, echte.slice(0, 6));
for (const id of made) await dropScratch(page, id).catch(() => {});
for (const f of trash) fs.rmSync(f, { force: true });
await ende(browser);
