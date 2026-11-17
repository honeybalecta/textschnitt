// Ton (2.34): Musik weicht der Sprache (E1), Stimme aufbereiten (E2), Übergänge (E3) – in der Oberfläche und in echten Exporten.
// Grundlage: ton.mp4 (Sprache in drei Blöcken, dazu Rauschen, Brummen und Nachhall), musik.wav (Zweiklang bei 2 und 3,1 kHz)
// und takt.mp4 (jedes Bild trägt seine Nummer als Balkenmuster) – siehe medien.py. Gemessen wird mit ton_messen.py und takt_lesen.py.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { launch, newProject, transcribe, setPick, sleep, pruefung, MEDIA, OUT, HERE } from './drv.mjs';
const { chk, ende } = pruefung('Ton und Übergänge');
const { browser, page, logs } = await launch();
const ev = (f, a) => page.evaluate(f, a);
const shot = (name, pg = page) => pg.screenshot({ path: path.join(OUT, `ton-${name}.png`) });
const made = [], trash = new Set();
const toastTxt = () => ev(() => document.querySelector('#toast').textContent);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const rnd = (v, k = 2) => +(+v).toFixed(k);
// Echter Export des offenen Projekts; prep läuft vorher in der Seite (Einstellungen), pick wählt aus dem Plan, was die Prüfung braucht
const exportNow = async (name, fmt, extra = {}) => {
  const r = await ev(async ([name, fmt, extra]) => {
    P.settings.level = false; exFmt = fmt; const plan = buildPlan(); plan.name = name; Object.assign(plan, extra);
    const t0 = performance.now(), id = TS.exportVideo(JSON.stringify(plan));
    for (;;){ await new Promise(r => setTimeout(r, 200)); const j = JSON.parse(TS.job(id));
      if (j.status === 'done') return { ok: true, file: j.result.playable, files: j.result.files || [], ms: Math.round(performance.now() - t0), plan };
      if (j.status === 'error') return { ok: false, error: j.error, plan }; } }, [name, fmt, extra]);
  for (const f of [r.file, ...(r.files || [])]) if (f) trash.add(f);
  return r;
};
const messen = (file, step, ...bands) => JSON.parse(execFileSync('python3', [path.join(HERE, 'ton_messen.py'), file, String(step), ...bands]).toString()).bands;
const mittel = (arr, step, t0, t1) => { const s = arr.slice(Math.round(t0 / step), Math.round(t1 / step)); return 10 * Math.log10(s.reduce((x, v) => x + Math.pow(10, v / 10), 0) / s.length); };
const lesen = file => JSON.parse(execFileSync('python3', [path.join(HERE, 'takt_lesen.py'), file], { maxBuffer: 1 << 26 }).toString()).frames;
const tonMd5 = file => crypto.createHash('md5').update(execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vn', '-f', 's16le', '-'], { maxBuffer: 1 << 28 })).digest('hex');
const dauer = f => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).toString().trim();
// Anteil des Bilds b in einer Mischung mit dem Bild a (aus den Balken, in denen sich beide unterscheiden)
const anteil = (v, a, b) => { const e = []; for (let k = 0; k < 10; k++){ const x = (a >> k) & 1, y = (b >> k) & 1; if (x !== y) e.push((v[k] - x) / (y - x)); } return e.length ? e.reduce((s, q) => s + q, 0) / e.length : NaN; };
const leave = () => ev(() => { if (typeof P !== 'undefined' && P){ pausePlay(); clearTimeout(saveT); saveNow(); closeSheet(); closeProject(); } });

try {
  // ═════════ E1 · Musik weicht der Sprache ═════════
  const idA = await newProject(page, [MEDIA + 'ton.mp4']); made.push(idA); await transcribe(page);
  const info = JSON.parse(fs.readFileSync(MEDIA + 'ton.json', 'utf8')), [bA, bB, bC] = info.blocks;
  setPick({ clip: [MEDIA + 'musik.wav'] });
  const med = await ev(() => pickMedia('clip'));
  await ev(m => { setTab('clip'); placeMedia(m, 'audio', 0, null, false); }, med); await sleep(300);
  const t0 = await toastTxt();
  const st0 = await ev(() => ({ on: duckOn(), audio: P.audio || null, n: P.items.filter(x => x.type === 'audio').length, plan: (() => { exFmt = 'audio'; const p = buildPlan(); return { duck: p.duck || null, flag: p.overlays.filter(o => o.mode === 'audio').map(o => !!o.duck) }; })() }));
  chk('Ton eingefügt: Die Absenkung ist anfangs aus, der Hinweis nennt den Weg dorthin', st0.n === 1 && !st0.on && !st0.audio && /Lautstärke/.test(t0) && /weicht/.test(t0), t0);
  chk('ohne den Schalter bleibt der Plan, wie er war (kein Verlauf, keine Kennzeichnung der Tonspur)', st0.plan.duck === null && st0.plan.flag.join() === 'false', st0.plan);
  await ev(() => openVolumes()); await sleep(200);
  const box0 = await ev(() => ({ box: !!document.querySelector('#toneBox'), on: document.querySelector('#duckOn').checked, row: document.querySelector('#duckDbRow').classList.contains('hidden'), voice: document.querySelector('#voiceOn').checked }));
  chk('Blatt „Lautstärke“: Schalter für „Musik weicht der Sprache“ und „Stimme aufbereiten“, beide aus', box0.box && !box0.on && box0.row && !box0.voice, box0);
  await page.click('#duckOn'); await sleep(250);
  const box1 = await ev(() => ({ on: duckOn(), db: duckDb(), row: !document.querySelector('#duckDbRow').classList.contains('hidden'), steps: [...document.querySelectorAll('#duckDb button')].map(b => b.textContent + (b.classList.contains('on') ? '*' : '')),
    role: [...document.querySelectorAll('.vol-row .muted')].map(x => x.textContent), undo: undo.length }));
  chk('eingeschaltet: Stärke in drei Stufen (mittel = 14 dB voreingestellt), der Schritt lässt sich zurücknehmen', box1.on && box1.db === 14 && box1.row && box1.steps.join() === 'leicht,mittel*,stark' && box1.undo > 0, box1);
  await sleep(2800); await shot('lautstaerke');   // der Hinweis oben ist dann wieder weg
  await ev(() => openVolumes()); await sleep(150);
  const roles = await ev(() => [...document.querySelectorAll('.vol-row .vol-name .muted')].map(x => x.textContent));
  chk('die Liste nennt bei der Tonspur ihre Rolle', roles.some(r => /Tonspur/.test(r) && /weicht der Sprache/.test(r)), roles);
  await ev(() => closeSheet());
  // Verlauf: vor der Sprache voll, in den Blöcken abgesenkt, in der langen Pause zurück, in der kurzen Pause weiter unten
  const k14 = Math.pow(10, -14 / 20);
  const cv = await ev(ts => ({ v: ts.map(t => +curveAt(duckPts(), t).toFixed(4)), speech: speechOut().map(r => r.map(x => +x.toFixed(2))), total }), [1, bA.a - 0.125, bA.a + 2, bA.b + 0.2, (bA.b + bB.a) / 2, bB.a + 1, (bB.b + bC.a) / 2, bC.b + 0.2, bC.b + 1.5]);
  chk('Verlauf: Sprache als zwei Abschnitte erkannt (die Pause von 1,2 s zählt mit, die von gut 4 s trennt)', cv.speech.length === 2 && near(cv.speech[0][0], bA.a, 0.15) && near(cv.speech[0][1], bA.b, 0.2) && near(cv.speech[1][0], bB.a, 0.15) && near(cv.speech[1][1], bC.b, 0.2), cv.speech);
  chk('Verlauf: voll vor der Sprache, halb im Absenken, unten während der Sprache und in der kurzen Pause, zurück in der langen Pause und am Ende',
    cv.v[0] === 1 && near(cv.v[1], (1 + k14) / 2, 0.1) && near(cv.v[2], k14, 0.002) && near(cv.v[3], k14, 0.002) && cv.v[4] === 1 && near(cv.v[5], k14, 0.002) && near(cv.v[6], k14, 0.002) && near(cv.v[7], k14, 0.002) && cv.v[8] === 1, cv.v);
  // Vorschau: die Tonspur läuft leiser, solange gesprochen wird
  const pv = await ev(async ts => { const it = P.items.find(x => x.type === 'audio'), out = [];
    for (const t of ts){ seekOut(t, false); await new Promise(r => setTimeout(r, 350)); const el = audLayers.get(it.id); out.push(el ? +(el._g ? el._g.gain.value : el.volume).toFixed(3) : null); } return out; }, [1, bA.a + 2, (bA.b + bB.a) / 2]);
  chk('Vorschau: Lautstärke der Tonspur folgt dem Verlauf', pv[0] === 1 && near(pv[1], k14, 0.01) && pv[2] === 1, pv);
  // echter Tonexport mit und ohne Absenkung; gemessen wird der Pegel der Musik bei 2 kHz
  const eOn = await exportNow('ton_weicht', 'audio', { audioFormat: 'wav' });
  await ev(() => { P.audio = { duck: { on: false } }; audioDirty(); });
  const eOff = await exportNow('ton_gleich', 'audio', { audioFormat: 'wav' });
  await ev(() => { P.audio = { duck: { on: true } }; audioDirty(); });
  chk('Tonexport mit und ohne Absenkung läuft durch', eOn.ok && eOff.ok, eOn.error || eOff.error);
  chk('Plan: Verlauf in Ausgabezeit und Kennzeichnung an der Tonspur – nur mit eingeschalteter Absenkung', Array.isArray(eOn.plan.duck) && eOn.plan.duck.length >= 6 && eOn.plan.overlays.some(o => o.mode === 'audio' && o.duck === true) && !eOff.plan.duck && !eOff.plan.overlays.some(o => o.duck), (eOn.plan.duck || []).slice(0, 4));
  if (eOn.ok && eOff.ok){
    const mOn = messen(eOn.file, 0.25, '1900-2100')['1900-2100'], mOff = messen(eOff.file, 0.25, '1900-2100')['1900-2100'];
    const d = (a, b) => mittel(mOn, 0.25, a, b) - mittel(mOff, 0.25, a, b);
    const got = [d(0.5, 2), d(bA.a + 1, bA.b), d(bA.b + 1.6, bB.a - 0.6), d(bB.a + 0.5, bB.b), d(bB.b + 0.2, bC.a - 0.2), d(bC.b + 1.6, cv.total - 0.2)].map(v => rnd(v, 1));
    chk('Export: Musik 14 dB leiser, solange gesprochen wird – auch in der kurzen Pause; davor, in der langen Pause und danach unverändert',
      near(got[0], 0, 0.6) && near(got[1], -14, 1) && near(got[2], 0, 0.6) && near(got[3], -14, 1) && near(got[4], -14, 1) && near(got[5], 0, 0.6), got);
  }
  // Stärke und Rolle
  await ev(() => openVolumes()); await sleep(150);
  await page.click('#duckDb button[data-db="20"]'); await sleep(200);
  const strong = await ev(t => ({ db: duckDb(), v: +curveAt(duckPts(), t).toFixed(4), saved: (P.audio.duck || {}).db }), bA.a + 2);
  chk('Stufe „stark“: 20 dB', strong.db === 20 && near(strong.v, 0.1, 0.001) && strong.saved === 20, strong);
  await page.click('#duckDb button[data-db="14"]'); await sleep(150); await ev(() => closeSheet());
  const audId = await ev(() => P.items.find(x => x.type === 'audio').id);
  await ev(id => { TL.sel = { kind: 'aud', id }; openItem(id); }, audId); await sleep(250);
  const sheet = await ev(() => ({ opts: [...document.querySelectorAll('#cDuck button')].map(o => o.textContent + (o.classList.contains('on') ? '*' : '')), note: (document.querySelector('#cDuckNote') || {}).textContent || '' }));
  chk('Blatt der Tonspur: Rolle wählbar (wird leiser, ist selbst Sprache, bleibt gleich) mit Erklärung', sheet.opts.join() === 'wird leiser*,ist selbst Sprache,bleibt gleich' && /14 dB/.test(sheet.note), sheet);
  await page.click('#cDuck button[data-v="keep"]'); await sleep(200);
  const keep = await ev(() => { exFmt = 'audio'; const p = buildPlan(), it = P.items.find(x => x.type === 'audio'); return { duck: it.duck, role: duckRole(it), plan: p.duck || null, flag: p.overlays.some(o => o.duck), note: document.querySelector('#cDuckNote').textContent }; });
  chk('„bleibt gleich“: Die Tonspur ist ausgenommen, der Plan trägt keinen Verlauf mehr', keep.duck === false && keep.role === 'keep' && keep.plan === null && !keep.flag && /durchgehend/.test(keep.note), keep);
  await page.click('#cDuck button[data-v="voice"]'); await sleep(200);
  const voiceRole = await ev(() => { const it = P.items.find(x => x.type === 'audio'); return { duck: it.duck, role: duckRole(it), speech: speechOut().map(r => r.map(x => +x.toFixed(1))), total: +total.toFixed(1) }; });
  chk('„ist selbst Sprache“: Die Aufnahme auf der Tonspur zählt zu den Sprachabschnitten', voiceRole.duck === 'voice' && voiceRole.role === 'voice' && voiceRole.speech.length === 1 && voiceRole.speech[0][0] < 0.5 && voiceRole.speech[0][1] > voiceRole.total - 1, voiceRole);
  await page.click('#cDuck button[data-v="duck"]'); await sleep(200);
  const back = await ev(() => { const it = P.items.find(x => x.type === 'audio'); return { has: 'duck' in it, role: duckRole(it) }; });
  chk('zurück auf „wird leiser“: ohne Eintrag am Element', !back.has && back.role === 'duck', back);
  await ev(() => closeSheet());
  // Rückgängig und Speichern
  await ev(() => openVolumes()); await sleep(150); await page.click('#duckOn'); await sleep(200);
  const off = await ev(() => duckOn()); await ev(() => closeSheet());
  await page.click('#undoBtn'); await sleep(250);
  const undone = await ev(() => duckOn());
  await ev(() => saveNow()); await sleep(200);
  const disk = await ev(() => JSON.parse(TS.loadProject(P.id)).audio);
  chk('Ausschalten lässt sich zurücknehmen; die Einstellung steht im gespeicherten Projekt', off === false && undone === true && disk && disk.duck && disk.duck.on === true, { off, undone, disk });
  const sumA = await ev(() => { setTab('export'); exFmt = 'video'; paintExportForm(); return document.querySelector('#exSummary').textContent; });
  chk('Export-Übersicht nennt die Absenkung', /Musik weicht der Sprache/.test(sumA), sumA.slice(-90));

  // ═════════ E2 · Stimme aufbereiten ═════════
  await ev(() => { setTab('clip'); commit(() => { P.items = P.items.filter(x => x.type !== 'audio'); }, false); });   // ohne Musik messen
  const vOff = await exportNow('stimme_roh', 'audio', { audioFormat: 'wav' });
  await ev(() => openVolumes()); await sleep(150); await page.click('#voiceOn'); await sleep(300);
  const t1 = await toastTxt();
  const vs = await ev(() => ({ on: voiceOn(), saved: P.audio.voice, lvl: voiceLevel(0) }));
  await ev(() => closeSheet());
  chk('Schalter „Stimme aufbereiten“: an, mit Hinweis', vs.on && vs.saved.on === true && /aufbereitet/.test(t1), t1);
  const at = (pts, t) => { if (!pts || !pts.length) return 1; if (t <= pts[0][0]) return pts[0][1]; for (let i = 1; i < pts.length; i++) if (t < pts[i][0]){ const a = pts[i - 1], b = pts[i]; return a[1] + (b[1] - a[1]) * (t - a[0]) / (b[0] - a[0]); } return pts[pts.length - 1][1]; };
  const lA = at(vs.lvl, (bA.a + bA.b) / 2), lB = at(vs.lvl, (bB.a + bB.b) / 2);
  chk('Pegelverlauf: Der leise Block wird angehoben, der laute zurückgenommen (in Grenzen von −6 bis +9 dB)', lB > 1.2 && lA < 1 && lA > 0.5 && lB < 2.83, [rnd(lA), rnd(lB)]);
  const vOn = await exportNow('stimme_klar', 'audio', { audioFormat: 'wav' });
  chk('Tonexport mit aufbereiteter Stimme läuft durch; der Plan gibt Aufnahme und Pegelverlauf je Abschnitt mit', vOn.ok && vOff.ok && vOn.plan.segments.every(s => s.voice && s.voice.k === 's0' && Array.isArray(s.voice.lvl)) && vOff.plan.segments.every(s => !s.voice), vOn.error || vOff.error);
  let humOff = null;
  if (vOn.ok && vOff.ok){
    const bands = ['30-70', '6500-9000', '300-1800'], A = messen(vOff.file, 0.1, ...bands), B = messen(vOn.file, 0.1, ...bands);
    const d = (band, a, b) => mittel(B[band], 0.1, a, b) - mittel(A[band], 0.1, a, b);
    humOff = mittel(A['30-70'], 0.1, 0.5, 2.5);
    const hum = d('30-70', 0.5, 2.5), noise = d('6500-9000', 0.5, 2.5), tail = d('300-1800', bA.b + 0.1, bA.b + 0.4);
    const gapA = mittel(A['300-1800'], 0.1, bA.a, bA.b) - mittel(A['300-1800'], 0.1, bB.a, bB.b), gapB = mittel(B['300-1800'], 0.1, bA.a, bA.b) - mittel(B['300-1800'], 0.1, bB.a, bB.b);
    chk('Export: Brummen und Rauschen gehen deutlich zurück', hum < -12 && noise < -6, { brummen: rnd(hum, 1), rauschen: rnd(noise, 1) });
    chk('Export: Der Nachhall hinter dem ersten Block klingt schneller ab', tail < -4, rnd(tail, 1));
    chk('Export: Leiser und lauter Block rücken zusammen', gapA > 7 && gapB < gapA - 3 && gapB > 0, { vorher: rnd(gapA, 1), nachher: rnd(gapB, 1) });
    chk('Export: gleiche Länge wie ohne Aufbereitung', near(dauer(vOn.file), dauer(vOff.file), 0.01), [dauer(vOn.file), dauer(vOff.file)]);
  }
  // Vorschau: das Hauptvideo läuft durch den Rechenkern; gemessen am Ausgang der Lautstärke-Kette im Raum vor dem ersten Wort
  const pvVoice = await ev(async () => {
    const rms = async sec => { const an = actx.createAnalyser(); an.fftSize = 2048; V._g.connect(an); const buf = new Float32Array(2048); let s = 0, n = 0; const t0 = performance.now();
      while (performance.now() - t0 < sec * 1000){ await new Promise(r => setTimeout(r, 40)); an.getFloatTimeDomainData(buf); for (const v of buf){ s += v * v; n++; } } V._g.disconnect(an); return 10 * Math.log10(s / n + 1e-12); };
    const run = async () => { seekOut(0.4, false); await new Promise(r => setTimeout(r, 400)); startPlay(); await new Promise(r => setTimeout(r, 900)); const v = await rms(1.0); pausePlay(); return v; };
    const on = await run(), st = { von: !!V._von, node: !!V._vn, fail: voiceFail, ctx: actx && actx.state };
    P.audio.voice.on = false; audioDirty(); setVol(V, 1, true); const offV = await run(), st2 = { von: !!V._von };
    P.audio.voice.on = true; audioDirty();
    return { on: +on.toFixed(1), off: +offV.toFixed(1), st, st2 }; });
  chk('Vorschau: Das Hauptvideo läuft durch den Rechenkern (AudioWorklet), ausgeschaltet wieder direkt', pvVoice.st.von && pvVoice.st.node && !pvVoice.st.fail && pvVoice.st.ctx === 'running' && !pvVoice.st2.von, pvVoice);
  chk('Vorschau: Brummen und Rauschen sind hörbar leiser', pvVoice.on < pvVoice.off - 6, { mit: pvVoice.on, ohne: pvVoice.off });
  // Videoexport in Stücken (mehr als sechs Abschnitte): die aufbereiteten Tondateien passen zu den Stücken
  const segN = await ev(() => { const w = tokens.filter(t => t.type === 'word'), pick = [3, 7, 11, 15, 19, 23, 27, 31].filter(k => k < w.length - 2).map(k => w[k].i); commit(() => bulkDelete(pick), false); return timeline.length; });
  const vVid = await exportNow('stimme_video', 'video', { quality: 'klein' });
  chk('Videoexport in Stücken mit aufbereiteter Stimme läuft durch und ist so lang wie der Schnitt', segN > 6 && vVid.ok && near(dauer(vVid.file), vVid.plan.total, 0.15), vVid.error || [segN, vVid.ok && dauer(vVid.file), vVid.plan.total]);
  if (vVid.ok && humOff !== null){
    const hv = mittel(messen(vVid.file, 0.1, '30-70')['30-70'], 0.1, 0.5, 2.5);
    chk('Videoexport: Auch dort ist das Brummen zurückgenommen', hv < humOff - 12, [rnd(hv, 1), rnd(humOff, 1)]);
  }
  const sumB = await ev(() => { setTab('export'); exFmt = 'video'; paintExportForm(); const a = document.querySelector('#exSummary').textContent; let note = null;
    if ((CAP.exportFormats || []).includes('capcut')){ exFmt = 'capcut'; paintExportForm(); note = document.querySelector('#exToneNote').classList.contains('hidden') ? '' : document.querySelector('#exToneNote').textContent; exFmt = 'video'; paintExportForm(); }
    return { a, note, hidden: document.querySelector('#exToneNote').classList.contains('hidden') }; });
  chk('Export-Übersicht nennt die aufbereitete Stimme; beim CapCut-Entwurf steht, dass sie dort fehlt', /Stimme aufbereitet/.test(sumB.a) && sumB.hidden && (sumB.note === null || /Stimme aufbereiten/.test(sumB.note)), sumB);
  // Hausstil: Die Einstellungen zum Ton gehören zur Vorlage und kommen in einem anderen Projekt wieder an
  const house = await ev(() => { const st = houseOf(), other = { settings: {}, audio: { duck: { on: false } } }; houseInto(other, st); const old = { settings: {}, audio: { duck: { on: true, db: 20 } } }; houseInto(old, { sub: null });
    return { st: st.audio, sum: houseSummary(st), other: other.audio, kept: old.audio }; });
  chk('Hausstil: „Musik weicht der Sprache“ und „Stimme aufbereiten“ stehen in der Vorlage; ältere Vorlagen lassen den Ton eines Projekts, wie er ist',
    house.st && house.st.duck.on === true && house.st.voice.on === true && /Musik weicht der Sprache/.test(house.sum) && /Stimme aufbereiten/.test(house.sum) && JSON.stringify(house.other) === JSON.stringify(house.st) && house.kept.duck.db === 20, house);
  await leave();

  // ═════════ E3 · Übergänge ═════════
  const idT = await newProject(page, [MEDIA + 'takt.mp4']); made.push(idT); await transcribe(page);
  // Sprachaufnahme auf einer Tonspur (hier der Ton von ton.mp4) als „ist selbst Sprache“: Ihre Sprachabschnitte kommen aus ihrem Lautstärkeverlauf
  setPick({ clip: [MEDIA + 'ton.mp4'] });
  const vo = await ev(() => pickMedia('clip'));
  const voice = await ev(async m => { setTab('clip'); placeMedia(m, 'audio', 0, null, false); const it = P.items.find(x => x.type === 'audio'); P.sources[0].vol = 0; it.duck = 'voice'; P.audio = { duck: { on: true } }; audioDirty();
    const first = speechOut().map(r => r.map(x => +x.toFixed(1)));
    for (let k = 0; k < 100 && !envDone.has(it.clip.uri); k++) await new Promise(r => setTimeout(r, 100));
    await new Promise(r => setTimeout(r, 150)); const then = speechOut().map(r => r.map(x => +x.toFixed(1)));
    delete P.sources[0].vol; delete P.audio; P.items = P.items.filter(x => x !== it); recompute(); audioDirty(); setTab('studio');
    return { first, then, total: +total.toFixed(1), left: P.items.length }; }, vo);
  // (Der leise mittlere Block von ton.mp4 liegt nur knapp über Brummen und Rauschen; ohne Transkript bleibt er unter der Schwelle.)
  chk('Sprachaufnahme auf einer Tonspur: zuerst zählt die ganze Aufnahme, mit ihrem Lautstärkeverlauf dann ihre Sprachabschnitte',
    voice.first.length === 1 && voice.first[0][0] === 0 && voice.then.length >= 2 && near(voice.then[0][0], bA.a, 0.2) && near(voice.then[0][1], bA.b, 0.3) && near(voice.then[voice.then.length - 1][1], bC.b, 0.3) && voice.left === 0, voice);
  // sieben Schnitte: Wörter liegen im Halbsekundentakt (Wort k bei 0,5·k s)
  const tl = await ev(() => { const w = tokens.filter(t => t.type === 'word'), cut = [[4, 6], [10, 20], [24, 26], [30, 40], [44, 48], [50, 52], [54, 56]];
    commit(() => bulkDelete(cut.flatMap(([a, b]) => w.slice(a, b).map(t => t.i))), false); setTab('studio');
    return { segs: timeline.map(g => [rnd3(g.in), rnd3(g.out), rnd3(g.o)]), cuts: cutList(), total: +total.toFixed(3) }; function rnd3(v){ return +v.toFixed(3); } });
  chk('Ausgangslage: acht Abschnitte, sieben Schnitte', tl.segs.length === 8 && tl.cuts.join() === '1,2,3,4,5,6,7', tl.segs);
  const T = k => tl.segs[k][2];
  const hart = await exportNow('takt_hart', 'video', { quality: 'klein' });
  const H = hart.ok ? lesen(hart.file) : [];
  const first = k => H.findIndex(f => f[0] >= T(k) - 0.017);   // erstes Bild des Abschnitts k im Export
  chk('Export ohne Übergänge: harte Schnitte, jedes Bild lesbar', hart.ok && H.length > 300 && H.every(f => f[1] !== null) && !hart.plan.trans, hart.error || H.length);
  // Bedienung: Werkzeug „Übergang“, Blatt, Marken
  await ev(() => { TL.sel = null; seekOut(timeline[1].o + 0.2, false); renderTimeline(); }); await sleep(200);
  const tool = await ev(() => { const t = barMenu('edit').find(x => x.label === 'Übergang'); if (!t) return null; t.fn(); return true; }); await sleep(300);   // seit 2.42 im Menü „Bearbeiten“
  const sh0 = await ev(() => ({ open: joinSheetOpen(), k: joinK, head: (document.querySelector('#jnSheet p') || {}).textContent || '', kinds: [...document.querySelectorAll('#jnKind button')].map(b => b.textContent + (b.classList.contains('on') ? '*' : '')), dur: document.querySelector('#jnDur').closest('.field').classList.contains('hidden'), note: document.querySelector('#jnNote').textContent, out: +outPos.toFixed(2) }));
  chk('Werkzeug „Übergang“ öffnet das Blatt am nächsten Schnitt: vier Arten, „Hart“ gewählt, die Abspiellinie steht am Schnitt',
    tool && sh0.open && sh0.k === 1 && sh0.kinds.join() === 'Hart*,Blende,Bild früher,Bild später' && sh0.dur && /selben Augenblick/.test(sh0.note) && near(sh0.out, T(1), 0.02) && /Schnitt 1 von 7/.test(sh0.head), sh0);
  await page.click('#jnKind button[data-v="fade"]'); await sleep(250);
  const sh1 = await ev(() => ({ item: P.items.filter(x => x.type === 'join').map(x => ({ at: x.at, pa: x.pa, kind: x.kind, d: x.d })), durs: [...document.querySelectorAll('#jnDur button')].map(b => b.textContent + (b.classList.contains('on') ? '*' : '')), note: document.querySelector('#jnNote').textContent,
    parts: joinParts.map(p => ({ over: p.over, at: +p.at.toFixed(3), d: +p.d.toFixed(3), a0: p.a0, a1: p.a1, lead: p.lead, tail: p.tail })), marks: [...document.querySelectorAll('#trMain .jn')].map(m => m.className + ':' + m.dataset.k) }));
  chk('„Blende“ gewählt: Übergang am Schnitt gespeichert (an beiden Abschnitten verankert), 0,4 s voreingestellt, Marke in der Zeitleiste',
    sh1.item.length === 1 && sh1.item[0].kind === 'fade' && sh1.item[0].d === 0.4 && near(sh1.item[0].at, tl.segs[1][0], 0.002) && near(sh1.item[0].pa, tl.segs[0][1], 0.002) && sh1.durs.join() === '0,2 s,0,4 s*,0,8 s' && sh1.marks.join() === 'jn fade:1', sh1);
  chk('Blende: eine Ebene vor dem Schnitt, Deckkraft von 0 auf 1, am Schnitt fertig; der Text sagt das', sh1.parts.length === 1 && sh1.parts[0].over === 0 && near(sh1.parts[0].at, T(1) - 0.4, 0.002) && sh1.parts[0].d === 0.4 && sh1.parts[0].a0 === 0 && sh1.parts[0].a1 === 1 && sh1.parts[0].tail > 0 && /weich über/.test(sh1.note) && /am Schnitt fertig/.test(sh1.note) && /Ton wechselt am Schnitt/.test(sh1.note), sh1.note);
  await shot('uebergang');
  await page.click('#jnDur button[data-d="0.8"]'); await sleep(200);
  await page.click('#jnSheet button[data-a="next"]'); await sleep(300);
  await page.click('#jnKind button[data-v="early"]'); await sleep(200);
  await page.click('#jnSheet button[data-a="next"]'); await sleep(300);
  await page.click('#jnKind button[data-v="late"]'); await sleep(200);
  await page.click('#jnDur button[data-d="0.3"]'); await sleep(200);
  const sh2 = await ev(() => ({ k: joinK, items: P.items.filter(x => x.type === 'join').map(x => [x.kind, x.d]), parts: joinParts.map(p => ({ k: p.k, over: p.over, at: +p.at.toFixed(3), d: +p.d.toFixed(3), a0: p.a0, a1: p.a1, lead: p.lead, tail: p.tail })),
    marks: [...document.querySelectorAll('#trMain .jn')].map(m => m.className + ':' + m.dataset.k), note: document.querySelector('#jnNote').textContent }));
  chk('Dauer ändern und von Schnitt zu Schnitt weitergehen: Blende 0,8 s, Bild früher 0,6 s, Bild später 0,3 s', sh2.k === 3 && JSON.stringify(sh2.items) === '[["fade",0.8],["early",0.6],["late",0.3]]' && sh2.marks.join() === 'jn fade:1,jn early:2,jn late:3', sh2.items);
  chk('Bild früher liegt vor dem Schnitt, Bild später dahinter – beide deckend, mit bildgleichem Nachlauf bzw. Vorlauf an der Schnittseite',
    sh2.parts.length === 3 && sh2.parts[1].over === 1 && near(sh2.parts[1].at, T(2) - 0.6, 0.002) && sh2.parts[1].a0 === 1 && sh2.parts[1].a1 === 1 && sh2.parts[1].tail > 0 && sh2.parts[1].lead === 0
    && sh2.parts[2].over === 3 && near(sh2.parts[2].at, T(3), 0.002) && sh2.parts[2].d === 0.3 && sh2.parts[2].lead > 0 && sh2.parts[2].tail === 0 && /J-Schnitt/.test(sh2.note), sh2.parts);
  await page.click('#jnSheet button[data-a="ok"]'); await sleep(200);
  chk('„Fertig“ schließt das Blatt', await ev(() => !joinSheetOpen()));
  // Marke anklicken öffnet das Blatt an diesem Schnitt
  await page.click('#trMain .jn.early'); await sleep(300);
  const sh3 = await ev(() => ({ open: joinSheetOpen(), k: joinK, on: [...document.querySelectorAll('#jnSheet .on')].map(b => b.textContent) })); await ev(() => closeSheet());
  chk('Klick auf die Marke öffnet den Übergang dieses Schnitts', sh3.open && sh3.k === 2 && sh3.on.join() === 'Bild früher,0,6 s', sh3);
  // Vorschau: Ebene mit dem Bild des anderen Clips
  const pj = await ev(async () => { const out = [], look = async o => { seekOut(o, false); await new Promise(r => setTimeout(r, 700)); return { hidden: TO.classList.contains('hidden'), op: +TO.style.opacity, ct: +TV.currentTime.toFixed(2) }; };
    const [f, e, l] = joinParts; out.push(await look(f.at + f.d / 2), await look(e.at + 0.2), await look(l.at + 0.1), await look(l.at + l.d + 0.5));
    return { out, want: [+(f.from + f.d / 2).toFixed(2), +(e.from + 0.2).toFixed(2), +(l.from + 0.1).toFixed(2)] }; });
  chk('Vorschau: in der Blende halb deckend, bei „Bild früher“ und „Bild später“ ganz, sonst unsichtbar – jeweils an der richtigen Stelle im Material',
    !pj.out[0].hidden && near(pj.out[0].op, 0.5, 0.03) && near(pj.out[0].ct, pj.want[0], 0.08) && !pj.out[1].hidden && pj.out[1].op === 1 && near(pj.out[1].ct, pj.want[1], 0.08) && !pj.out[2].hidden && pj.out[2].op === 1 && near(pj.out[2].ct, pj.want[2], 0.08) && pj.out[3].hidden, pj);
  // Plan und echter Export
  const weich = await exportNow('takt_weich', 'video', { quality: 'klein' });
  const tr = weich.plan.trans || [];
  const base = JSON.parse(JSON.stringify(weich.plan)); delete base.trans; base.name = hart.plan.name;
  chk('Plan: drei Ebenen mit Fenster, Deckkraft, Abschnitt und Material; alles Übrige wie ohne Übergänge', tr.length === 3 && tr.map(t => t.over).join() === '0,1,3' && tr.every(t => t.seg && t.seg.hasAudio === false && t.seg.vol === 0 && t.seg.out > t.seg.in) && JSON.stringify(base) === JSON.stringify(hart.plan), tr.map(t => [t.at, t.d, t.a0, t.a1, t.lead, t.tail, t.seg.in, t.seg.out]));
  const E = weich.ok ? lesen(weich.file) : [];
  chk('Export mit Übergängen: gleich viele Bilder, derselbe Ton', weich.ok && E.length === H.length && tonMd5(weich.file) === tonMd5(hart.file), weich.error || [E.length, H.length]);
  if (weich.ok && E.length === H.length){
    // Blende 0,8 s vor Schnitt 1: 24 Bilder, das Bild des nächsten Clips kommt gleichmäßig dazu
    const c1 = first(1), b1 = H[c1][1], L1 = 24, al = []; for (let i = c1 - L1; i < c1; i++) al.push(anteil(E[i][2], H[i][1], b1 - (c1 - i)));
    chk('Blende: Deckkraft steigt gleichmäßig von 0 auf 1; davor und danach das unveränderte Bild', al.every((a, j) => near(a, j / L1, 0.07)) && E[c1 - L1 - 2][1] === H[c1 - L1 - 2][1] && E[c1][1] === b1 && E[c1 + 5][1] === b1 + 5, al.map(a => rnd(a)));
    // Bild früher 0,6 s vor Schnitt 2: 18 Bilder des nächsten Clips, die nahtlos in ihn übergehen
    const c2 = first(2), b2 = H[c2][1], got2 = E.slice(c2 - 20, c2 + 3).map(f => f[1]), want2 = [H[c2 - 20][1], H[c2 - 19][1], ...Array.from({ length: 18 }, (_, j) => b2 - 18 + j), b2, b2 + 1, b2 + 2];
    chk('Bild früher: Das Bild wechselt 18 Bilder vor dem Ton und läuft nahtlos weiter', got2.join() === want2.join(), got2);
    // Bild später 0,3 s hinter Schnitt 3: der vorige Clip läuft 9 Bilder weiter
    const c3 = first(3), a3 = H[c3 - 1][1], b3 = H[c3][1], got3 = E.slice(c3 - 2, c3 + 12).map(f => f[1]), want3 = [a3 - 1, a3, ...Array.from({ length: 9 }, (_, j) => a3 + 1 + j), b3 + 9, b3 + 10, b3 + 11];
    chk('Bild später: Der vorige Clip bleibt 9 Bilder länger zu sehen, dann steigt der nächste an der richtigen Stelle ein', got3.join() === want3.join(), got3);
    const rest = E.slice(first(4)).every((f, i) => f[1] === H[first(4) + i][1]);
    chk('alle anderen Schnitte bleiben hart und bildgleich (auch über die Stückelung des langen Exports hinweg)', rest && weich.plan.segments.length === 8);
  }
  const sumT = await ev(() => { setTab('export'); exFmt = 'video'; paintExportForm(); const a = document.querySelector('#exSummary').textContent; setTab('studio'); return a; });
  chk('Export-Übersicht nennt die Übergänge', /3 Übergänge/.test(sumT), sumT.slice(-80));
  // Übergänge am Übergang zwischen zwei Stücken des Exports (Schnitt 6) und im zweiten Stück (Schnitt 7), dazu Tempo
  await ev(() => { commit(() => { P.items = P.items.filter(x => x.type !== 'join'); }, true); joinSet(6, 'early', 0.3); joinSet(7, 'fade', 0.2); joinSet(5, 'late', 0.3); });
  const stueck = await exportNow('takt_stuecke', 'video', { quality: 'klein' });
  const S = stueck.ok ? lesen(stueck.file) : [];
  if (stueck.ok && S.length === H.length){
    const c6 = first(6), b6 = H[c6][1], got6 = S.slice(c6 - 10, c6 + 2).map(f => f[1]), want6 = [H[c6 - 10][1], ...Array.from({ length: 9 }, (_, j) => b6 - 9 + j), b6, b6 + 1];
    chk('Stückelung: „Bild früher“ am Schnitt zwischen zwei Stücken sitzt bildgenau', got6.join() === want6.join(), got6);
    const c5 = first(5), a5 = H[c5 - 1][1], b5 = H[c5][1], got5 = S.slice(c5 - 1, c5 + 11).map(f => f[1]), want5 = [a5, ...Array.from({ length: 9 }, (_, j) => a5 + 1 + j), b5 + 9, b5 + 10];
    chk('Stückelung: „Bild später“ am letzten Abschnitt des ersten Stücks', got5.join() === want5.join(), got5);
    const c7 = first(7), b7 = H[c7][1], al7 = []; for (let i = c7 - 6; i < c7; i++) al7.push(anteil(S[i][2], H[i][1], b7 - (c7 - i)));
    chk('Stückelung: Blende im zweiten Stück', al7.every((a, j) => near(a, j / 6, 0.09)) && S[c7][1] === b7, al7.map(a => rnd(a)));
  } else chk('Export mit Übergängen an der Stückgrenze läuft durch', false, stueck.error || [S.length, H.length]);
  // Tempo: der Abschnitt nach Schnitt 2 läuft doppelt so schnell – „Bild früher“ nimmt sein Material im selben Tempo
  await ev(() => { const g = timeline[2]; commit(() => { P.items = P.items.filter(x => x.type !== 'join'); P.items.push({ id: newId(), type: 'fx', at: r3(g.in), dur: r3(g.out - g.in), fx: { ...FX_DEF, speed: 2 } }); }, true); });
  const fastH = await exportNow('takt_tempo_hart', 'video', { quality: 'klein' });
  const sp = await ev(() => { joinSet(2, 'early', 0.6); const p = joinParts[0]; return { T: +timeline[2].o.toFixed(3), in: timeline[2].in, from: +p.from.toFixed(3), d: p.d, speed: timeline[2].speed }; });
  const fastE = await exportNow('takt_tempo_weich', 'video', { quality: 'klein' });
  if (fastH.ok && fastE.ok){
    const FH = lesen(fastH.file), FE = lesen(fastE.file), c = FH.findIndex(f => f[0] >= sp.T - 0.017), b = FH[c][1], win = FE.slice(c - 18, c).map(f => f[1]);
    chk('Tempo: Das Material vor dem schnellen Clip läuft in dessen Tempo auf den Schnitt zu (zwei Quellbilder je Bild)', sp.speed === 2 && near(sp.from, sp.in - 1.2, 0.002) && FE.length === FH.length && win.every((n, j) => n !== null && Math.abs(n - (b - 2 * (18 - j))) <= 2) && FE[c][1] === b && FE[c - 19][1] === FH[c - 19][1], win);
  } else chk('Export mit Tempo und Übergang läuft durch', false, fastH.error || fastE.error);
  await ev(() => { commit(() => { P.items = P.items.filter(x => x.type !== 'join' && x.type !== 'fx'); }, true); });
  // Der Übergang bleibt an seinem Schnitt, wenn sich eine Seite ändert; verschwindet der Schnitt, ruht er
  const anchor = await ev(() => {
    const res = {}, w = tokens.filter(t => t.type === 'word'), parts = () => joinParts.map(p => [p.k, +p.at.toFixed(2), +p.d.toFixed(2)]);
    joinSet(2, 'early', 0.6); res.start = parts();
    const B = timeline[2], firstB = w.find(t => !deleted.has(t.i) && t.ws >= B.in - 0.05), A = timeline[1], lastA = [...w].reverse().find(t => !deleted.has(t.i) && t.we <= A.out + 0.05);
    const u0 = snapshot();
    commit(() => bulkDelete([firstB.i]), false); res.trimB = { parts: parts(), marks: document.querySelectorAll('#trMain .jn').length, in: +timeline[2].in.toFixed(2) };
    restore(u0);
    commit(() => bulkDelete([lastA.i]), false); res.trimA = { parts: parts(), out: +timeline[1].out.toFixed(2) };
    restore(u0);
    // die gestrichenen Wörter zwischen beiden Abschnitten zurückholen: Der Schnitt ist weg
    const gone = w.filter(t => deleted.has(t.i) && t.ws > A.out - 0.05 && t.we < B.in + 0.05).map(t => t.i);
    commit(() => { for (const i of gone) deleted.delete(i); }, false); res.merged = { parts: parts(), segs: timeline.length, item: P.items.filter(x => x.type === 'join').length, marks: document.querySelectorAll('#trMain .jn').length };
    restore(u0); res.again = parts();
    return res; });
  chk('ein Wort mehr am Anfang des nächsten Clips gestrichen: Der Übergang bleibt am Schnitt', anchor.start.length === 1 && anchor.trimB.parts.length === 1 && anchor.trimB.parts[0][0] === 2 && anchor.trimB.marks === 1 && anchor.trimB.in > tl.segs[2][0] + 0.3, anchor.trimB);
  chk('das letzte Wort des vorigen Clips gestrichen: Der Übergang bleibt am Schnitt', anchor.trimA.parts.length === 1 && anchor.trimA.parts[0][0] === 2 && anchor.trimA.out < tl.segs[1][1] - 0.3, anchor.trimA);
  chk('Schnitt aufgehoben: kein Übergang mehr im Bild, die Einstellung ruht im Projekt und gilt wieder, sobald es den Schnitt wieder gibt', anchor.merged.segs === 7 && anchor.merged.parts.length === 0 && anchor.merged.marks === 0 && anchor.merged.item === 1 && anchor.again.length === 1, anchor.merged);
  // Rückgängig, Speichern, Clip aus einem Bereich
  const keepT = await ev(async () => { const res = {}; res.before = P.items.filter(x => x.type === 'join').length; joinSet(2, '', 0); res.removed = P.items.filter(x => x.type === 'join').length; document.querySelector('#undoBtn').click(); await new Promise(r => setTimeout(r, 200));
    res.undone = joinParts.length; saveNow(); await new Promise(r => setTimeout(r, 200)); res.disk = JSON.parse(TS.loadProject(P.id)).items.filter(x => x.type === 'join').map(x => [x.kind, x.d, x.at != null, x.pa != null]);
    const Tc = timeline[2].o; res.inside = clipData([[Tc - 2, Tc + 2]], null, 'x').items.filter(x => x.type === 'join').length; res.outside = clipData([[Tc + 0.5, Tc + 3]], null, 'x').items.filter(x => x.type === 'join').length;
    res.edge = clipData([[Tc - 4, Tc - 3], [Tc + 0.5, Tc + 3]], null, 'x').items.filter(x => x.type === 'join').length; return res; });
  chk('Übergang entfernen („Hart“) und zurückholen; im gespeicherten Projekt steht er mit beiden Ankern', keepT.before === 1 && keepT.removed === 0 && keepT.undone === 1 && JSON.stringify(keepT.disk) === '[["early",0.6,true,true]]', keepT);
  chk('Clip aus einem Bereich: Der Übergang geht mit, wenn sein Schnitt im Bereich liegt – sonst bleibt er im Hauptprojekt', keepT.inside === 1 && keepT.outside === 0 && keepT.edge === 0, keepT);
  // Bild als Einschub: Blende auf das Bild, das Bild bleibt beim „Bild später“ stehen
  setPick({ clip: [MEDIA + 'folie1.png'] });
  const img = await ev(() => pickMedia('clip'));
  const ins = await ev(async m => { commit(() => { P.items = P.items.filter(x => x.type !== 'join'); }, true); seekOut(1.0, false); placeMedia(m, 'insert', 1.0, null, false); await new Promise(r => setTimeout(r, 300));
    const k = timeline.findIndex(g => g.kind === 'insert'); joinSet(k, 'fade', 0.4); joinSet(k + 1, 'late', 0.3);
    return { k, n: timeline.length, kinds: timeline.slice(0, 4).map(g => g.kind), T: [+timeline[k].o.toFixed(3), +timeline[k + 1].o.toFixed(3)], parts: joinParts.map(p => ({ over: p.over, g: p.g.kind, d: +p.d.toFixed(2), a0: p.a0, a1: p.a1 })), items: P.items.filter(x => x.type === 'join').map(x => [x.kind, !!x.ins, !!x.pins]) }; }, img);
  chk('Einschub mit Bild: Blende auf das Bild (verankert am Einschub) und „Bild später“ hinter ihm', ins.k > 0 && ins.parts.length === 2 && ins.parts[0].g === 'insert' && ins.parts[0].a1 === 1 && ins.parts[1].g === 'insert' && JSON.stringify(ins.items) === '[["fade",true,false],["late",false,true]]', ins);
  const bild = await exportNow('takt_bild', 'video', { quality: 'klein' });
  if (bild.ok){
    const B = lesen(bild.file), cI = B.findIndex(f => f[0] >= ins.T[0] - 0.017), cM = B.findIndex(f => f[0] >= ins.T[1] - 0.017);
    const hell = f => Math.max(...f[2]);   // das Bild ist dunkel und einfarbig: je deckender es liegt, desto dunkler die hellen Balken
    const ramp = B.slice(cI - 12, cI).map(hell), still = B.slice(cM, cM + 9).map(hell), after = B.slice(cM + 9, cM + 12).map(f => f[1]);
    const dark = still[4];   // so hell erscheint das Bild selbst zwischen Schwarz und Weiß der Balken
    chk('Export: Das Bild blendet über 12 Bilder gleichmäßig ein und bleibt hinter dem Einschub 9 Bilder stehen, dann läuft das Video an der richtigen Stelle weiter',
      dark < 0.25 && ramp.every((v, j) => near(v, 1 - (1 - dark) * j / 12, 0.06)) && still.every(v => near(v, dark, 0.03)) && after.join() === '39,40,41', { ramp: ramp.map(v => rnd(v)), still: still.map(v => rnd(v)), after });
  } else chk('Export mit Bild-Einschub und Übergängen läuft durch', false, bild.error);
  // Fehlt das Bildmaterial (ein Einspieler beginnt an seinem ersten Bild), sagt HoneyCut das: „Bild früher“ bleibt ein harter Schnitt,
  // eine Blende weicht hinter den Schnitt aus
  setPick({ clip: [MEDIA + 'broll1.mp4'] });
  const br1 = await ev(() => pickMedia('clip'));
  const none = await ev(async m => { commit(() => { P.items = P.items.filter(x => x.type !== 'join' && x.type !== 'insert'); }, true); seekOut(1.0, false); placeMedia(m, 'insert', 1.0, null, false); await new Promise(r => setTimeout(r, 300));
    const k = timeline.findIndex(g => g.kind === 'insert'), res = { k, in: timeline[k].in };
    joinSet(k, 'early', 0.6); renderTimeline(); res.early = { parts: joinParts.length, mark: [...document.querySelectorAll('#trMain .jn')].map(x => x.className).join(), note: joinNote(k) };
    joinSet(k, 'fade', 0.4); renderTimeline(); res.fade = { parts: joinParts.map(p => [p.over, p.a0, p.a1, +p.d.toFixed(2)]), mark: [...document.querySelectorAll('#trMain .jn')].map(x => x.className).join(), note: joinNote(k) };
    exFmt = 'video'; res.plan = (buildPlan().trans || []).length; return res; }, br1);
  chk('ohne Bildmaterial vor dem nächsten Clip: „Bild früher“ bleibt ein harter Schnitt, Marke und Text zeigen es', none.in === 0 && none.early.parts === 0 && /\boff\b/.test(none.early.mark) && /fehlt dafür das Bildmaterial/.test(none.early.note), none.early);
  chk('die Blende weicht dann hinter den Schnitt aus (der vorige Clip blendet aus)', none.fade.parts.length === 1 && none.fade.parts[0][0] === none.k && none.fade.parts[0][1] === 1 && none.fade.parts[0][2] === 0 && none.fade.mark === 'jn fade' && /beginnt am Schnitt/.test(none.fade.note) && none.plan === 1, none.fade);
  await leave();

  // ═════════ Handy ═════════
  const mob = await launch({ viewport: { width: 390, height: 844 }, dpr: 2 });
  try {
    await mob.page.evaluate(i => openProject(i), idT); await mob.page.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i, idT, { timeout: 30000 }); await sleep(500);
    const m1 = await mob.page.evaluate(async () => { setTab('studio'); await new Promise(r => setTimeout(r, 300)); openJoin(cutList()[2]); await new Promise(r => setTimeout(r, 400));
      const r = document.querySelector('#jnSheet').getBoundingClientRect(), bs = [...document.querySelectorAll('#jnSheet button')].map(b => b.getBoundingClientRect());
      return { open: joinSheetOpen(), wide: document.documentElement.scrollWidth <= innerWidth + 1, inside: r.left >= 0 && r.right <= innerWidth + 1, btns: bs.every(b => b.left >= 0 && b.right <= innerWidth + 1 && b.height >= 28) }; });
    await shot('handy-uebergang', mob.page);
    await mob.page.evaluate(() => { closeSheet(); openVolumes(); }); await sleep(300);
    const m2 = await mob.page.evaluate(() => { const r = document.querySelector('#toneBox').getBoundingClientRect(); return { inside: r.left >= 0 && r.right <= innerWidth + 1, wide: document.documentElement.scrollWidth <= innerWidth + 1 }; });
    await shot('handy-lautstaerke', mob.page);
    chk('Handy (390 × 844): Blatt „Übergang“ und die Schalter zum Ton passen in die Breite', m1.open && m1.wide && m1.inside && m1.btns && m2.inside && m2.wide, { m1, m2 });
    await mob.page.evaluate(() => { closeSheet(); pausePlay(); clearTimeout(saveT); closeProject(); });
    chk('keine Fehlermeldungen in der Handy-Ansicht', mob.logs.length === 0, mob.logs.slice(0, 4));
  } finally { await mob.browser.close(); }
  chk('keine Fehlermeldungen der Seite', logs.length === 0, logs.slice(0, 5));
} catch (e) {
  chk('Prüfung läuft ohne Abbruch durch', false, String(e && e.stack || e).slice(0, 600));
} finally {
  await ev(list => { if (typeof P !== 'undefined' && P){ pausePlay(); clearTimeout(saveT); closeSheet(); closeProject(); } for (const i of list){ try { TS.deleteProject(i); } catch (_) {} try { if (TS.trashPurge) TS.trashPurge(i); } catch (_) {} } }, made).catch(() => {});
  for (const f of trash){ try { fs.rmSync(f, { force: true }); } catch (_) {} }
}
await ende(browser);
