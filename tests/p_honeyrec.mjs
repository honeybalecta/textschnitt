// HoneyRec (2.46): aufnehmen mit Kamera, Skript, Medien und Bildschirm – das Ergebnis ist ein HoneyCut-Projekt.
// Kamera und Mikrofon sind die Testgeräte von Chrome (--use-fake-device-for-media-stream). Geprüft wird der echte Weg:
// MediaRecorder → Stücke an das Backend → MP4 im Aufnahmeordner → Takes, Einblendungen und entfernte Teile im Projekt.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { browser, watch, setPick, sleep, pruefung, MEDIA, BASE, WORK, OUT } from './drv.mjs';
const { chk, ende } = pruefung('HoneyRec');
const br = await browser(['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--auto-select-desktop-capture-source=Entire screen']);
const ctx = await br.newContext({ viewport: { width: 1480, height: 900 }, permissions: ['camera', 'microphone'] });
const page = await ctx.newPage();
const logs = watch(page);
page.on('crash', () => console.log('ABSTURZ der Seite'));
if (process.env.HR_DEBUG) page.on('console', m => console.log('console:', m.type(), m.text()));
const ev = (f, a) => page.evaluate(f, a);
const REC = BASE.replace(/index\.html$/, 'rec.html');
const DIR = path.join(WORK, 'honeyrec');
// Eigener Name je Lauf: Aufnahmen früherer Läufe (gleicher Tag, gleicher Name) bekämen sonst „(2)“ angehängt. Die Dateien bleiben liegen,
// damit Projekte früherer Läufe in der Projektliste (spätere Prüfungen) keine fehlenden Vorschaubilder melden.
const NAME = 'Prüfaufnahme ' + Date.now().toString(36);
const shot = n => page.screenshot({ path: path.join(OUT, `honeyrec_${n}.png`) });
const R = () => ev(() => JSON.parse(JSON.stringify(HoneyRec.P)));
const muted = () => ev(() => ({ badge: !document.querySelector('#muteBadge').classList.contains('hidden') }));
const waitTakes = n => page.waitForFunction(n => HoneyRec.P.rec.takes.length === n && HoneyRec.P.rec.takes.every(t => t.src && !t.busy), n, { timeout: 40000 });
const SKRIPT = '# Einstieg\nDie Mieten in München sind seit 2015 um 42 Prozent gestiegen. [Grafik einblenden]\nGleichzeitig stagnieren die Löhne.\n\n# Forderung\nWir fordern einen Mietendeckel.';

// Video mit Ton als WebM: spielt auch in Chromium ohne H.264 (Chrome kann beides)
const CLIP = MEDIA + 'ton-rec.webm';
if (!fs.existsSync(CLIP)) execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', MEDIA + 'ton.mp4', '-t', '12', '-vf', 'scale=640:-2', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '600k', '-c:a', 'libopus', CLIP]);

try {
  await page.addInitScript(() => { if (!localStorage.getItem('hr-set')) localStorage.setItem('hr-set', JSON.stringify({ count: false, res: 720, fps: 30 })); });
  await page.goto(REC);
  await page.waitForFunction(() => window.HoneyRec && document.querySelector('#camV').videoWidth > 0, null, { timeout: 15000 });
  chk('Startfenster mit Namen und „Neue Aufnahme“; die Kamera läuft schon in der Vorschau', await ev(() => !document.querySelector('#startVeil').classList.contains('hidden') && !!document.querySelector('#newName').value && document.querySelector('#camV').videoWidth > 0));
  await shot('1_start');
  await page.fill('#newName', NAME);
  await page.click('#newGo');
  chk('Name der Aufnahme steht in der Kopfleiste', (await ev(() => document.querySelector('#rName').textContent)) === NAME);
  // Skript
  await page.click('#skEdit'); await page.fill('#skText', SKRIPT); await page.click('#skOk');
  const sk = await ev(() => ({ h: [...document.querySelectorAll('#skBody .h')].map(x => x.textContent), rg: [...document.querySelectorAll('#skBody .rg')].map(x => x.textContent), txt: document.querySelector('#skBody').textContent }));
  chk('Souffleur: Überschriften und Regieanweisungen gedämpft, Text vollständig', sk.h.join('|') === 'Einstieg|Forderung' && sk.rg[0] === '[Grafik einblenden]' && sk.txt.includes('Mietendeckel'), sk);
  const y0 = await ev(() => document.querySelector('#skView').scrollTop);
  await page.keyboard.press('ArrowDown'); await sleep(100);
  chk('Pfeil nach unten schiebt das Skript eine Zeile weiter', (await ev(() => document.querySelector('#skView').scrollTop)) > y0);
  // Medien: Video mit Ton, zwei Bilder (= Präsentation)
  setPick({ clips: [CLIP, MEDIA + 'logo.png', MEDIA + 'wackel.png'] });
  await page.click('#addMedia');
  await page.waitForFunction(() => document.querySelectorAll('.mitem').length === 2);
  const kinds = await ev(() => [...document.querySelectorAll('.mitem .kind')].map(x => x.textContent));
  chk('Medien: ein Video und eine Präsentation aus zwei Bildern', kinds.join('|') === 'Video|Präsentation', kinds);
  chk('Ohne Aufnahme bleibt das Projekt ungespeichert (erscheint erst mit dem ersten Take in HoneyCut)', await ev(async () => !JSON.parse(TS.listProjects()).some(p => p.id === HoneyRec.P.id)));

  // ── Take 1: Präsentation, Video mit Ton, Haken „Mikro auch …“ ──
  await page.keyboard.press('r'); await sleep(1200);
  chk('Taste R startet die Aufnahme (Knopf „Pause“, Rahmen rot)', await ev(() => document.body.classList.contains('live') && document.querySelector('#recBtn .lbl').textContent === 'Pause'));
  chk('Bild der Präsentation: Mikrofon bleibt an', !(await muted()).badge && await ev(() => HoneyRec.P && true));
  await page.keyboard.press('PageDown'); await sleep(900);
  chk('Bild weiter (Bild↓ wie ein Presenter): zweites Bild', (await ev(() => document.querySelector('#mTime').textContent)) === 'Bild 2 von 2');
  await page.click('.mitem >> nth=0'); await page.click('#mPlay'); await sleep(1500);
  const m1 = await muted(), tr1 = await ev(() => document.querySelector('#camV') && true);
  chk('Video mit Ton läuft: Mikrofon wird nicht aufgenommen (Hinweis „Mikro stumm“)', m1.badge, m1);
  await shot('2_live');
  await page.click('#mPlay'); await sleep(500);
  chk('Video angehalten: Mikrofon wieder an', !(await muted()).badge);
  await page.check('#micDuring'); await page.click('#mPlay'); await sleep(700);
  chk('Mit Haken „Mikro auch bei Medien mit Ton“ bleibt das Mikrofon an, obwohl das Video läuft', !(await muted()).badge && await ev(() => !document.querySelector('#stageOn video').paused));
  await page.uncheck('#micDuring'); await sleep(200);
  chk('Haken wieder weg: sofort stumm', (await muted()).badge);
  await page.keyboard.press('r');
  await waitTakes(1);
  chk('Pause hält das Video mit an', await ev(() => document.querySelector('#stageOn video').paused));
  let P = await R(); const t1 = P.rec.takes[0];
  const files = fs.existsSync(DIR) ? fs.readdirSync(path.join(DIR, P.rec.dir)) : [];
  chk('Take 1 liegt als MP4 im Aufnahmeordner, ohne Reste', files.includes('Take 01.mp4') && !files.some(f => f.endsWith('.part')), files);
  chk('Take 1 hat Bild und Ton, Länge passend', t1.src.hasAudio && t1.src.hasVideo && t1.src.duration > 3 && t1.src.duration < 12, t1.src);
  const evs = t1.ev.map(e => [e.clip.name, e.t0, e.t1]);
  chk('Ereignisse: Bild 1, Bild 2, Video, Video (mit Haken) – lückenlos und in Reihenfolge', t1.ev.length === 4 && t1.ev[0].clip.name === 'logo.png' && t1.ev[0].t0 === 0 && t1.ev[1].clip.name === 'wackel.png' && t1.ev[2].clip.name === 'ton-rec.webm' && t1.ev.every((e, k) => e.t1 > e.t0 && (!k || e.t0 >= t1.ev[k - 1].t1 - 0.01)), evs);
  chk('Zweiter Abschnitt des Videos läuft dort weiter, wo es angehalten wurde', t1.ev[3].in > 1, t1.ev[3]);
  chk('Projekt steht jetzt in HoneyCut', await ev(() => JSON.parse(TS.listProjects()).some(p => p.id === HoneyRec.P.id)));

  // ── Take 2 (mit Bildschirm, wenn Chrome ihn hergibt) und Verwerfen ──
  let scr = false;
  try { await page.click('#scrBtn'); await page.waitForFunction(() => !document.querySelector('#scrBox').classList.contains('hidden'), null, { timeout: 4000 }); scr = true; } catch (_) {}
  await page.click('.mitem >> nth=0'); await page.click('#mOff');
  await page.click('#recBtn'); await sleep(1800); await page.click('#recBtn');
  await waitTakes(2); if (scr) await page.waitForFunction(() => HoneyRec.P.rec.takes[1].ev.some(e => e.k === 's'), null, { timeout: 20000 }).catch(() => {});
  P = await R();
  if (scr) chk('Bildschirm mitaufgenommen: eigenes Element auf Spur 2, an der Stelle des Takes', P.items.some(i => i.track === 2 && i.clip.name.startsWith('Bildschirm') && Math.abs(i.at - P.sources[0].duration) < 0.6), P.items.filter(i => i.track === 2));
  else console.log('Hinweis: Bildschirmaufnahme in diesem Chrome nicht verfügbar – übersprungen');
  await page.click('#dropLast');
  P = await R();
  chk('„Letzten Take verwerfen“ nimmt Take 2 heraus (Quelle weg, Elemente weg)', P.rec.takes.length === 1 && P.rec.gone.length === 1 && P.sources.length === 1 && !P.items.some(i => i.track === 2));
  await page.click('#goneLink');
  P = await R();
  chk('„zurückholen“ bringt ihn zurück', P.rec.takes.length === 2 && P.sources.length === 2);

  // ── Take 1 ansehen: Anfang kürzen, Bereich entfernen ──
  await page.click('.take >> nth=0'); await page.waitForFunction(() => document.querySelector('#tkV').readyState >= 1);
  await ev(() => { document.querySelector('#tkV').currentTime = 0.4; }); await sleep(150); await page.click('#tkIn');
  await ev(() => { document.querySelector('#tkV').currentTime = 1.5; }); await sleep(150); await page.keyboard.press('a');
  await ev(() => { document.querySelector('#tkV').currentTime = 2.3; }); await sleep(150); await page.keyboard.press('b');
  await page.click('#tkCut'); await shot('3_take');
  P = await R(); const d1 = P.rec.takes[0].dels;
  chk('Anfang hier + Bereich entfernen: zwei entfernte Teile im Take', d1.length === 2 && Math.abs(d1[0][0]) < 0.01 && Math.abs(d1[0][1] - 0.4) < 0.05 && Math.abs(d1[1][0] - 1.5) < 0.05 && Math.abs(d1[1][1] - 2.3) < 0.05, d1);
  await page.click('#tkList [data-k="1"]'); P = await R();
  chk('„Zurückholen“ in der Liste holt einen Teil wieder', P.rec.takes[0].dels.length === 1);
  await ev(() => { document.querySelector('#tkV').currentTime = 1.5; }); await page.click('#tkA'); await ev(() => { document.querySelector('#tkV').currentTime = 2.3; }); await page.click('#tkB'); await page.click('#tkCut');
  await page.click('#tkOk');
  P = await R();
  chk('Entfernte Teile werden zu gelöschten Bereichen im Projekt (in HoneyCut wiederherstellbar)', P.dels.length === 2 && Math.abs(P.dels[1][0] - 1.5) < 0.05, P.dels);
  const it = P.items.filter(i => i.rec);
  chk('Einblendungen werden Elemente an genau der Stelle der Aufnahme', it.length >= 4 && it.every(i => i.type === 'broll') && Math.abs(it[2].at - t1.ev[2].t0) < 0.01 && Math.abs((it[2].out - it[2].in) - (t1.ev[2].t1 - t1.ev[2].t0)) < 0.01, it.map(i => [i.clip.name, i.at, i.in, i.out]));
  chk('Video-Einblendung bringt ihren Ton mit, Bilder nicht', it[2].vol === 1 && it[0].vol === undefined);
  await page.selectOption('#mMode', 'pip');
  await page.click('.mitem >> nth=0'); await page.click('#recBtn'); await sleep(600); await page.click('#mPlay'); await sleep(1000); await page.click('#recBtn');
  await waitTakes(3); P = await R();
  const pip = P.items.find(i => i.rec && i.type === 'pip');
  chk('„Im Video als Bild im Bild“: Element als Bild im Bild oben rechts', pip && pip.corner === 'or' && pip.w === 0.4 && pip.x > 0.7 && pip.y < 0.4, pip);
  chk('Takes laufen in der Reihenfolge hintereinander (Quellen 1–3)', P.sources.length === 3 && P.sources.map(s => s.name).join('|') === 'Take 01|Take 02|Take 03', P.sources.map(s => s.name));
  await page.selectOption('#mMode', 'broll');
  await shot('4_takes');

  // ── Fertig → HoneyCut ──
  const pid = P.id;
  await page.click('#doneBtn');
  await page.waitForFunction(id => typeof P !== 'undefined' && P && P.id === id, pid, { timeout: 20000 });
  await sleep(800);
  const hc = await ev(() => ({ n: P.sources.length, items: P.items.length, dels: P.dels.length, script: P.script && P.script.text, house: 'houseNew' in P, rec: P.rec && P.rec.done, tab, hash: location.hash }));
  chk('„Fertig“ öffnet die Aufnahme in HoneyCut als normales Projekt (Quellen, Elemente, Schnitte, Skript)', hc.n === 3 && hc.items >= 5 && hc.dels === 2 && hc.script === SKRIPT && !hc.house && hc.rec && !hc.hash, hc);
  await ev(() => setTab('studio')); await sleep(1200); await shot('5_honeycut');
  chk('Studio zeigt Hauptspur und Einblendungen ohne Fehler', await ev(() => document.querySelectorAll('.blk').length >= 6));

  // ── Weiter aufnehmen: Bisheriges bleibt fest, neuer Take kommt hinten dran ──
  await page.goto(REC);
  await page.waitForFunction(() => window.HoneyRec && document.querySelector('#resume [data-id]'), null, { timeout: 15000 });
  chk('Startfenster bietet die Aufnahme zum Weiter-Aufnehmen an („in HoneyCut“)', await ev(id => { const b = document.querySelector(`#resume [data-id="${id}"]`); return !!b && /in HoneyCut/.test(b.textContent); }, pid));
  await ev(() => { const it = JSON.parse(TS.loadProject(document.querySelector('#resume [data-id]').dataset.id)); return it; });
  await page.click(`#resume [data-id="${pid}"]`); await sleep(400);
  await page.click('#recBtn'); await sleep(1200); await page.click('#recBtn'); await waitTakes(1);
  P = await R();
  chk('Weiter aufnehmen: Take 4 kommt als vierte Quelle dazu, Bisheriges (Elemente, Schnitte) bleibt', P.sources.length === 4 && P.sources[3].name === 'Take 04' && P.items.length === hc.items && P.dels.length === 2 && P.rec.fixed === 3, { n: P.sources.length, items: P.items.length, dels: P.dels, fixed: P.rec.fixed });

  // ── Schmaler Bildschirm (Handy hochkant) ──
  await page.setViewportSize({ width: 412, height: 860 }); await sleep(300); await shot('6_handy');
  chk('Handy hochkant: Aufnahmeknopf und Fertig bleiben erreichbar', await ev(() => { const a = document.querySelector('#recBtn').getBoundingClientRect(), b = document.querySelector('#doneBtn').getBoundingClientRect(); return a.width > 0 && b.right <= innerWidth + 1 && a.right <= innerWidth + 1; }));

  chk('Keine Fehler auf der Seite', !logs.length, logs);
  await ev(id => TS.deleteProject(id), pid);   // aufräumen: Die Aufnahme liegt danach im Papierkorb, die Dateien bleiben
} catch (e) { chk('Ablauf ohne Abbruch', false, String(e && e.stack || e).slice(0, 600)); }
await ende(br);
