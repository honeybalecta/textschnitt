// Personen automatisch erkennen (2.38, C7): der Rechenkern (core/web/stimmen.js) und der Weg durch die Oberfläche.
// Prüfmedien: gespraech.mp4 mit drei künstlichen Stimmen (gespraech.json nennt die Lösung) und – wo ffmpeg die Sprachsynthese
// flite kennt – stimmen-flite.wav mit drei Synthese-Stimmen. Echte Aufnahmen kommen hier nicht vor.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { launch, newProject, transcribe, dropScratch, sleep, pruefung, MEDIA, API } from './drv.mjs';
const { chk, ende } = pruefung('Personen erkennen');
const { browser, page, logs } = await launch();
const ev = (f, a) => page.evaluate(f, a);
const made = [];
const SOLL = JSON.parse(fs.readFileSync(MEDIA + 'gespraech.json', 'utf8'));
const pcmFiles = () => fs.readdirSync(os.tmpdir()).filter(f => f.startsWith('honeycut_stimmen_'));
// Anteil richtig zugeordneter Wörter bei bester Paarung von Stimmen und Lösung
const quote = (got, soll, K) => { const perms = a => a.length <= 1 ? [a] : a.flatMap((x, i) => perms(a.filter((_, j) => j !== i)).map(p => [x, ...p]));
  const conf = Array.from({ length: K }, () => new Array(K).fill(0)); got.forEach((k, i) => { if (k >= 0 && k < K && soll[i] < K) conf[soll[i]][k]++; });
  let best = 0; for (const p of perms([...Array(K).keys()])){ let s = 0; for (let k = 0; k < K; k++) s += conf[k][p[k]]; best = Math.max(best, s); } return best / got.length; };
const zuordnung = () => ev(() => tokens.filter(t => t.type === 'word').map(t => P.speakers.findIndex(s => s.id === t.spk)));
const erkennen = async (n = 0) => { await ev(() => voiceDialog()); await page.waitForSelector('#vcGo'); if (n) await page.selectOption('#vcN', String(n)); await page.click('#vcGo');
  await page.waitForFunction(() => !document.querySelector('#vcBox'), null, { timeout: 120000 }); await sleep(300); return ev(() => document.querySelector('#toast').textContent); };

try {
  // ═════════ Knopf und Blatt ═════════
  const id = await newProject(page, [MEDIA + 'gespraech.mp4']); made.push(id);
  await ev(() => setTab('subs')); await sleep(200);
  chk('Ohne Transkript bleibt „Personen erkennen“ verborgen', await ev(() => document.querySelector('#spkAuto').classList.contains('hidden')));
  await ev(() => setTab('trans')); await transcribe(page);
  await ev(() => setTab('subs')); await sleep(200);
  const n0 = await ev(() => ({ words: tokens.filter(t => t.type === 'word').length, cues: P.cues.length, hidden: document.querySelector('#spkAuto').classList.contains('hidden'), ready: voiceReady() }));
  chk('Mit Transkript steht der Knopf bei den Sprecher:innen', !n0.hidden && n0.ready && n0.words === SOLL.wer.length, n0);
  await page.click('#spkAuto'); await page.waitForSelector('#vcBox');
  const blatt = await ev(() => ({ opts: [...document.querySelectorAll('#vcN option')].map(o => o.textContent).join('|'), text: document.querySelector('#vcSetup').textContent }));
  chk('Das Blatt fragt nach der Zahl der Personen (selbst schätzen, 2 bis 6) und nennt die Vorgabe-Namen', blatt.opts === 'selbst schätzen|2|3|4|5|6' && /Person 1/.test(blatt.text) && /ohne Netz/.test(blatt.text), blatt.opts);
  await page.click('#vcNo');
  chk('„Abbrechen“ schließt das Blatt, nichts ist geändert', await ev(() => !document.querySelector('#vcBox') && !P.speakers.length && !undo.length));

  // ═════════ Erkennen am Gespräch mit drei Stimmen ═════════
  const t1 = await erkennen();
  const z1 = await zuordnung(), s1 = await ev(() => ({ sp: P.speakers.map(s => s.name), cues: P.cues.length, undo: undo.length, mixed: P.cues.filter(c => { const s = new Set(); for (let i = c.a; i <= c.b; i++) if (tokens[i] && tokens[i].type === 'word') s.add(tokens[i].spk || ''); return s.size > 1; }).length,
    labels: [...document.querySelectorAll('#transcript .spk-lbl, #paneText .spk-lbl')].length, rows: document.querySelectorAll('#spkList .spk-row').length }));
  const q1 = quote(z1, SOLL.wer, 3);
  chk('Drei Stimmen: drei Personen mit den Namen „Person 1“ bis „Person 3“', s1.sp.join() === 'Person 1,Person 2,Person 3' && /3 Personen erkannt/.test(t1), { t1, sp: s1.sp });
  chk('Drei Stimmen: mindestens 97 % der Wörter liegen bei der richtigen Person', q1 >= 0.97, +q1.toFixed(3));
  chk('Die Personen stehen in der Reihenfolge ihres ersten Auftritts', z1[0] === 0 && z1.indexOf(1) < z1.indexOf(2) && z1.indexOf(1) > 0, [z1.indexOf(1), z1.indexOf(2)]);
  chk('Untertitel sind an den Wechseln geteilt: kein Untertitel mischt zwei Personen', s1.mixed === 0 && s1.cues >= n0.cues, { vorher: n0.cues, nachher: s1.cues, gemischt: s1.mixed });
  chk('Der Text zeigt die Personen an den Wechseln, die Liste führt drei Einträge', s1.labels >= 10 && s1.rows === 3, { marken: s1.labels, zeilen: s1.rows });
  chk('Ein Schritt im Verlauf: „Rückgängig“ nimmt alles zurück, „Wiederholen“ stellt es wieder her', s1.undo === 1 && await (async () => { await page.click('#undoBtn'); await sleep(200); const a = await ev(() => P.speakers.length + tokens.filter(t => t.spk).length + '/' + P.cues.length);
    await page.click('#redoBtn'); await sleep(200); const b = await ev(() => P.speakers.length + '/' + tokens.filter(t => t.type === 'word' && t.spk).length); return a === '0/' + n0.cues && b === '3/' + n0.words; })());
  chk('Der Ton liegt nach dem Abholen nicht mehr auf der Platte', pcmFiles().length === 0, pcmFiles());

  // ═════════ Vorhandene Personen ═════════
  await ev(() => { commit(() => { P.speakers[0].name = 'Moderation'; P.speakers[0].role = 'Redaktion'; P.speakers[0].st = { color: '#E5402A' }; P.speakers[2].name = 'Ben'; }, false); renderSpeakers(); });
  const t2 = await erkennen(3); const z2 = await zuordnung();
  const s2 = await ev(() => ({ sp: P.speakers.map(s => s.name + (s.role ? '/' + s.role : '') + (s.st && s.st.color ? '/' + s.st.color : '')) }));
  chk('Erneutes Erkennen behält die angelegten Personen mit Name, Funktion und Gestaltung', s2.sp.join() === 'Moderation/Redaktion/#E5402A,Person 2,Ben' && z2.join() === z1.join() && /3 Personen/.test(t2), s2.sp);
  await ev(() => { commit(() => { tokens.forEach(t => delete t.spk); P.speakers = [{ id: newId(), name: 'Anna', st: {} }, { id: newId(), name: 'Bela', st: {} }]; }, false); renderSpeakers(); });
  await erkennen(); const s3 = await ev(() => P.speakers.map(s => s.name)), z3 = await zuordnung();
  chk('Angelegte, noch freie Personen werden der Reihe nach vergeben; die dritte Stimme bekommt „Person 3“', s3.join() === 'Anna,Bela,Person 3' && z3.join() === z1.join(), s3);
  // von Hand zugeordnete Wörter bestimmen, welche Person eine Stimme bekommt
  await ev(() => { commit(() => { tokens.forEach(t => delete t.spk); P.speakers = [{ id: newId(), name: 'Gast', st: {} }, { id: newId(), name: 'Host', st: {} }]; const w = tokens.filter(t => t.type === 'word'); for (let i = 0; i < 6; i++) w[i].spk = P.speakers[1].id; }, false); renderSpeakers(); });
  await erkennen(); const z4 = await zuordnung(), s4 = await ev(() => P.speakers.map(s => s.name));
  chk('Eine Zuordnung von Hand bleibt maßgeblich: Die Stimme der ersten Wörter gehört weiter zu „Host“', z4[0] === 1 && z4.every((k, i) => (k === 1) === (SOLL.wer[i] === 0)) && s4[0] === 'Gast' && s4.length === 3, { s4, erste: z4.slice(0, 8) });

  // ═════════ Feste Anzahl, Abbruch, Fehler ═════════
  await ev(() => { commit(() => { tokens.forEach(t => delete t.spk); P.speakers = []; }, false); renderSpeakers(); });
  const t5 = await erkennen(2); const z5 = await zuordnung(), s5 = await ev(() => P.speakers.length);
  chk('Vorgabe „2 Personen“: genau zwei Personen, jedes Wort ist vergeben', s5 === 2 && new Set(z5).size === 2 && !z5.includes(-1) && /2 Personen/.test(t5), { t5, s5 });
  await page.click('#undoBtn'); await sleep(200);
  const before = await ev(() => undo.length);
  await ev(() => voiceDialog()); await page.waitForSelector('#vcGo'); await page.click('#vcGo'); await page.click('#vcStop'); await sleep(1500);
  chk('Abbruch während des Lesens: Blatt zu, nichts geändert, keine Datei bleibt liegen', await ev(b => !document.querySelector('#vcBox') && undo.length === b && !P.speakers.length, before) && pcmFiles().length === 0, pcmFiles());
  const uri = await ev(() => P.sources[0].uri);
  await ev(() => { P.sources[0].uri = P.sources[0].uri.replace(/gespraech\.mp4$/, 'gibt-es-nicht.mp4'); });
  const t6 = await erkennen();
  chk('Fehlt die Datei, kommt eine Meldung und das Projekt bleibt unverändert', /fehlgeschlagen/.test(t6) && await ev(() => !P.speakers.length), t6);
  await ev(u => { P.sources[0].uri = u; }, uri);
  const r404 = await fetch(API + 'pcm?id=gibtesnicht');
  chk('Die Adresse für den Ton antwortet ohne gültige Kennung mit 404', r404.status === 404, r404.status);

  // ═════════ Rechenkern direkt ═════════
  const kern = await ev(async () => {
    const words = voiceWords(), pcm = await voiceAudio(P.sources[0].uri, () => {}), src = [{ pcm }];
    const a = await Stimmen.run(src, words, {}), f = Float32Array.from(pcm, v => v / 32768), b = await Stimmen.run([{ pcm: f }], words, {});
    const first = words.filter((w, i) => a.spk[i] === 0), one = await Stimmen.run(src, first, {});
    let calls = 0; const stop = await Stimmen.run(src, words, { cancelled: () => ++calls > 2 });
    const leer = await Stimmen.run(src, [], {}), ohne = await Stimmen.run([{}], words, {});
    const hinten = words.map(w => ({ ...w, a: w.a + 500, b: w.b + 500 })), aus = await Stimmen.run(src, hinten, {});
    const prog = []; await Stimmen.run(src, words, { onProgress: p => prog.push(p) });
    return { n: words.length, pcm: pcm.length, int16: pcm instanceof Int16Array, a: [...a.spk], count: a.count, same: [...a.spk].join() === [...b.spk].join(), sure: Math.min(...a.sure), one: one.count, oneAll: [...one.spk].every(k => k === 0),
      stop: stop === null, leer: leer.count, ohne: ohne.count, aus: aus.count, prog: prog.length > 3 && prog.every((p, i) => p >= 0 && p <= 1 && (i === 0 || p >= prog[i - 1] - 1e-9)) && prog[prog.length - 1] === 1 };
  });
  chk('Kern: Der Ton kommt als 16 kHz mit 16 Bit an (Länge passt zum Video)', kern.int16 && Math.abs(kern.pcm / 16000 - 54.9) < 0.6, kern.pcm / 16000);
  chk('Kern: drei Stimmen, Trefferquote mindestens 97 %, jedes Wort mit Sicherheitswert', kern.count === 3 && quote(kern.a, SOLL.wer, 3) >= 0.97 && kern.sure >= 0 && kern.a.length === kern.n, { count: kern.count, q: +quote(kern.a, SOLL.wer, 3).toFixed(3) });
  chk('Kern: Ton als Gleitkommawerte ergibt dieselbe Zuordnung', kern.same);
  chk('Kern: Die Wörter einer einzigen Stimme ergeben eine Person', kern.one === 1 && kern.oneAll, kern.one);
  chk('Kern: Abbruch liefert kein Ergebnis; der Fortschritt läuft stetig bis 1', kern.stop && kern.prog);
  chk('Kern: ohne Wörter, ohne Ton oder mit Zeiten hinter dem Ende entsteht keine Person', kern.leer === 0 && kern.ohne === 0 && kern.aus === 0, [kern.leer, kern.ohne, kern.aus]);
  chk('Auch nach dem direkten Abholen liegt keine Datei mehr im Zwischenordner', pcmFiles().length === 0);

  // Sprachsynthese-Stimmen (flite), wo vorhanden
  const fl = path.join(MEDIA, 'stimmen-flite.wav');
  if (fs.existsSync(fl)){
    const F = JSON.parse(fs.readFileSync(path.join(MEDIA, 'stimmen-flite.json'), 'utf8')), b64 = fs.readFileSync(fl).subarray(44).toString('base64');
    const r = await ev(async ({ b64, words }) => { const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const pcm = new Int16Array(u8.buffer, 0, u8.length >> 1), w = words.map(x => ({ src: 0, a: x.start, b: x.end, end: /[.!?]$/.test(x.text) }));
      const a = await Stimmen.run([{ pcm }], w, {}), c = await Stimmen.run([{ pcm }], w, { count: 2 }); return { a: [...a.spk], count: a.count, two: c.count }; }, { b64, words: F.words });
    chk('Synthese-Stimmen (flite): drei Stimmen erkannt, mindestens 97 % richtig; mit Vorgabe 2 bleiben zwei', r.count === 3 && quote(r.a, F.wer, 3) >= 0.97 && r.two === 2, { count: r.count, q: +quote(r.a, F.wer, 3).toFixed(3), two: r.two });
  } else console.log('hinweis Synthese-Stimmen (flite) ausgelassen: ffmpeg ohne flite');

  // ═════════ Zwei Aufnahmen in einem Projekt ═════════
  const zwei = path.join(MEDIA, 'gespraech2.mp4');
  fs.copyFileSync(MEDIA + 'gespraech.mp4', zwei); fs.copyFileSync(MEDIA + 'gespraech.words.json', path.join(MEDIA, 'gespraech2.words.json'));
  await ev(() => { if (P) closeProject(); });
  const id2 = await newProject(page, [MEDIA + 'gespraech.mp4', zwei]); made.push(id2);
  await transcribe(page);
  const m0 = await ev(() => ({ src: P.sources.length, tr: P.sources.filter(s => s.tr).length, words: tokens.filter(t => t.type === 'word').length }));
  if (m0.src === 2 && m0.tr === 2){
    const t7 = await erkennen(); const z7 = await zuordnung(), half = z7.length / 2;
    chk('Zwei Aufnahmen: dieselben drei Personen in beiden, die Zuordnung stimmt in beiden Hälften', /3 Personen/.test(t7) && z7.slice(0, half).join() === z7.slice(half).join() && quote(z7.slice(0, half), SOLL.wer, 3) >= 0.97, { t7, q: +quote(z7.slice(0, half), SOLL.wer, 3).toFixed(3) });
  } else chk('Zwei Aufnahmen: Projekt mit zwei transkribierten Aufnahmen angelegt', false, m0);
  for (const f of ['gespraech2.mp4', 'gespraech2.words.json']) fs.rmSync(path.join(MEDIA, f), { force: true });
} catch (e){ chk('Prüfung abgebrochen', false, String((e && e.stack) || e).replace(/\s+/g, ' ').slice(0, 500)); }

// (Die 404-Antworten gehören zu den Prüfungen „Fehlt die Datei“ und „ohne gültige Kennung“.)
const echte = logs.filter(l => !/HTTP 404|gibt-es-nicht|HTTP 500: api\/job|Failed to load/.test(l));
chk('keine Fehlermeldungen der Seite', echte.length === 0, echte.slice(0, 6));
for (const id of made) await dropScratch(page, id).catch(() => {});
await ende(browser);
