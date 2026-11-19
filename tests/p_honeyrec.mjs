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

// ── Testdokumente ohne Hilfsprogramme: PDF von Hand (zwei Seiten, Link nach außen und auf Seite 2), Markdown, Word und PowerPoint als ZIP ──
function pdfFile(file){
  const objs = [], add = s => { objs.push(s); return objs.length; };
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const c1 = 'BT /F1 48 Tf 72 500 Td (Bericht Seite 1) Tj ET BT /F1 24 Tf 72 420 Td (Mehr unter example.org) Tj ET BT /F1 24 Tf 72 360 Td (Weiter zu Seite 2) Tj ET';
  const c2 = 'BT /F1 48 Tf 72 500 Td (Bericht Seite 2) Tj ET';
  const s1 = add(`<< /Length ${c1.length} >>\nstream\n${c1}\nendstream`), s2 = add(`<< /Length ${c2.length} >>\nstream\n${c2}\nendstream`);
  const pagesId = objs.length + 3, p1 = objs.length + 1, p2 = objs.length + 2;
  add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${s1} 0 R /Annots [<< /Type /Annot /Subtype /Link /Rect [66 410 380 450] /Border [0 0 0] /A << /S /URI /URI (https://example.org/) >> >> << /Type /Annot /Subtype /Link /Rect [66 350 330 390] /Border [0 0 0] /Dest [${p2} 0 R /Fit] >>] >>`);
  add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 842 595] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${s2} 0 R >>`);
  add(`<< /Type /Pages /Kids [${p1} 0 R ${p2} 0 R] /Count 2 >>`);
  const cat = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  let out = '%PDF-1.4\n'; const offs = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${cat} 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  fs.writeFileSync(file, out, 'latin1');
}
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++){ let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return b => { let c = ~0; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; }; })();
function zipFile(file, entries){   // ungepackt (Methode 0) – reicht für den Ersatz-Leser in rec-docs.js
  const parts = [], cen = []; let off = 0;
  for (const [name, text] of Object.entries(entries)){
    const nb = Buffer.from(name), data = Buffer.from(text), crc = CRC(data), h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt32LE(crc, 14); h.writeUInt32LE(data.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(nb.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt32LE(crc, 16); c.writeUInt32LE(data.length, 20); c.writeUInt32LE(data.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
    parts.push(h, nb, data); cen.push(c, nb); off += 30 + nb.length + data.length;
  }
  const cd = Buffer.concat(cen), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(cen.length / 2, 8); e.writeUInt16LE(cen.length / 2, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  fs.writeFileSync(file, Buffer.concat([...parts, cd, e]));
}
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"', A = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const DOCS = { pdf: MEDIA + 'rec-bericht.pdf', md: MEDIA + 'rec-notizen.md', docx: MEDIA + 'rec-text.docx', pptx: MEDIA + 'rec-folien.pptx' };
pdfFile(DOCS.pdf);
fs.writeFileSync(DOCS.md, '# Notizen\n\nErster Punkt mit Link www.example.org\n\n## Zweiter Abschnitt\n' + 'Viel Text zum Umbrechen auf mehrere Seiten. '.repeat(160));
zipFile(DOCS.docx, { 'word/document.xml': `<w:document ${W}><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Quellen</w:t></w:r></w:p><w:p><w:r><w:t>Die Mieten sind gestiegen.</w:t></w:r></w:p></w:body></w:document>` });
zipFile(DOCS.pptx, { 'ppt/slides/slide1.xml': `<p:sld ${A}><a:p><a:r><a:t>Mieten in München</a:t></a:r></a:p><a:p><a:r><a:t>Seit 2015 um 42 Prozent</a:t></a:r></a:p></p:sld>`,
  'ppt/slides/slide2.xml': `<p:sld ${A}><a:p><a:r><a:t>Forderung</a:t></a:r></a:p><a:p><a:r><a:t>Mietendeckel jetzt</a:t></a:r></a:p></p:sld>` });

try {
  await page.addInitScript(() => { if (!localStorage.getItem('hr-set')) localStorage.setItem('hr-set', JSON.stringify({ count: false, res: 720, fps: 30, regie: false, big: false })); });
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
  setPick({ rec: [CLIP, MEDIA + 'logo.png', MEDIA + 'wackel.png'] });
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


  // ── Dokumente: PDF (Seiten, Links), Markdown, Word, PowerPoint – und der eingebaute Browser ──
  setPick({ rec: [DOCS.pdf, DOCS.md, DOCS.docx, DOCS.pptx] });
  await page.click('#addMedia');
  await page.waitForFunction(() => document.querySelectorAll('.mitem').length === 6, null, { timeout: 10000 });
  const dk = await ev(() => [...document.querySelectorAll('.mitem .kind')].slice(2).map(x => x.textContent));
  chk('Dokumente lassen sich laden: PDF, Text, Word, PowerPoint', dk.join('|') === 'PDF|Text|Dokument|Folien', dk);
  await page.click('.mitem >> nth=2'); await page.waitForFunction(() => /Seite 1 von 2/.test(document.querySelector('#mTime').textContent) && document.querySelectorAll('.doclink').length, null, { timeout: 15000 });
  const lk = await ev(() => [...document.querySelectorAll('.doclink')].map(a => a.title));
  chk('PDF: Seite 1 von 2 mit Link nach außen und Verweis auf Seite 2', lk.includes('https://example.org/') && lk.includes('Zu Seite 2'), lk);
  chk('PDF-Seite ist gezeichnet (nicht leer)', await ev(() => { const c = document.querySelector('.docwrap canvas'), g = c.getContext('2d'), d = g.getImageData(0, 0, c.width, c.height).data; let w = 0, k = 0, o = 0; for (let i = 0; i < d.length; i += 4 * 97){ if (d[i] > 240 && d[i + 1] > 240) w++; else if (d[i] < 60 && d[i + 1] < 60 && d[i + 2] < 60) k++; else o++; } return w > 50 && k + o > 5; }));
  await page.click('.doclink[title="Zu Seite 2"]'); await sleep(400);
  chk('Verweis im PDF springt auf Seite 2', /Seite 2 von 2/.test(await ev(() => document.querySelector('#mTime').textContent)));
  await page.keyboard.press('PageUp'); await sleep(300);
  // Link nach außen: eingebauter Browser (hier im Test-Backend ohne Fenster → neuer Tab)
  const pop = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null);
  await page.click('.doclink[title="https://example.org/"]'); const pp = await pop;
  chk('Link aus dem PDF öffnet den Browser (Leiste mit Adresse; ohne Windows-Fenster ein neuer Tab)', !!pp && await ev(() => !document.querySelector('#brBar').classList.contains('hidden') && document.querySelector('#brUrl').value === 'https://example.org/'));
  if (pp) await pp.close().catch(() => {});
  chk('Backend ohne Programmfenster meldet „kein eingebauter Browser“', (await ev(() => TS.recBrowser('open', 'https://example.org/'))).includes('"ok": false'));
  await page.fill('#brUrl', 'honeybalecta.de'); const pop2 = page.waitForEvent('popup', { timeout: 5000 }).catch(() => null); await page.click('#brGo'); const pp2 = await pop2;
  chk('Adresse ohne https:// wird ergänzt', !!pp2 && (await ev(() => document.querySelector('#brUrl').value)) === 'https://honeybalecta.de'); if (pp2) await pp2.close().catch(() => {});
  await page.click('#brClose');
  // Aufnahme mit PDF-Seiten → Einblendungen als Bilder
  await page.click('#recBtn'); await sleep(900); await page.keyboard.press('PageDown'); await sleep(900); await page.click('#recBtn');
  await page.waitForFunction(() => { const t = HoneyRec.P.rec.takes.slice(-1)[0]; return t && t.src && t.ev.filter(e => e.k === 'm').length >= 2 && t.ev.every(e => e.clip); }, null, { timeout: 30000 });
  P = await R(); const dt = P.rec.takes.slice(-1)[0], di = P.items.filter(i => i.rec && i.clip && / · Seite /.test(i.clip.name));
  chk('PDF-Seiten werden als Bilder ins Projekt gelegt, je Seite eine Einblendung an ihrer Stelle', dt.ev.filter(e => e.k === 'm').length === 2 && di.length >= 2 && di.every(i => i.clip.kind === 'image' && Math.abs(Math.max(i.clip.width / 1920, i.clip.height / 1080) - 1) < 0.01) && fs.existsSync(di[0].clip.uri), {ev: dt.ev.length, di: di.map(i => [i.clip.name, i.clip.width, i.clip.height, i.clip.kind, i.clip.uri])});
  chk('Dokumente schalten das Mikrofon nie stumm', !(await muted()).badge);
  // Text und Office
  await page.click('.mitem >> nth=3'); await page.waitForFunction(() => /Seite 1 von \d/.test(document.querySelector('#mTime').textContent), null, { timeout: 10000 });
  const mdn = +(/von (\d+)/.exec(await ev(() => document.querySelector('#mTime').textContent)) || [0, 0])[1];
  chk('Markdown: auf mehrere Seiten umbrochen, Adresse im Text ist ein Link', mdn >= 2 && await ev(() => [...document.querySelectorAll('.doclink')].some(a => a.title === 'https://www.example.org')), mdn);
  await page.click('.mitem >> nth=4'); await page.waitForFunction(() => /Seite 1 von 1/.test(document.querySelector('#mTime').textContent), null, { timeout: 120000 });
  chk('Word: wird angezeigt (Original über LibreOffice/Office, sonst vereinfacht)', true, await ev(() => document.querySelector('#mTime').textContent));
  await page.click('.mitem >> nth=5'); await page.waitForFunction(() => /Folie 1 von 2/.test(document.querySelector('#mTime').textContent), null, { timeout: 120000 });
  chk('PowerPoint: zwei Folien, weiterschalten wie bei einer Präsentation', true);
  await page.keyboard.press('ArrowRight'); await sleep(300);
  chk('Pfeil nach rechts: Folie 2 von 2', /Folie 2 von 2/.test(await ev(() => document.querySelector('#mTime').textContent)));
  await shot('7_dokument');
  P = await R();
  chk('Dokumente bleiben in der Sitzung gemerkt (Art, Seitenzahl, Seitenbilder)', P.rec.media.filter(m => m.doc).length === 4 && P.rec.media.find(m => m.doc && /\.pdf$/.test(m.clip.name)).n === 2);


  // ── Bildregie: Kamera und Bühne in einem Bild, Anordnungen, Mauszeiger, große Bühne ──
  const px = (fx, fy) => ev(([fx, fy]) => { HoneyRec.drawProg(); const c0 = document.querySelector('#progCv'), c = document.createElement('canvas'); c.width = c0.width; c.height = c0.height; c.getContext('2d').drawImage(c0, 0, 0); const d = c.getContext('2d').getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data; return [d[0], d[1], d[2]]; }, [fx, fy]);
  const isGreen = c => c[1] > 100 && c[0] < 90 && c[2] < 90, isLight = c => c[0] > 200 && c[1] > 200 && c[2] > 200;
  await page.click('#setBtn'); await page.check('#regieOn'); await page.click('#setOk');
  chk('Bildregie an: Programmbild statt Kamerabild, Leiste mit sechs Anordnungen', await ev(() => !document.querySelector('#progCv').classList.contains('hidden') && document.querySelectorAll('.lay').length === 6 && document.body.classList.contains('mode-regie')));
  await page.click('.mitem >> nth=2'); await page.waitForFunction(() => document.querySelectorAll('.doclink').length, null, { timeout: 15000 }); await sleep(600);
  await page.keyboard.press('2'); await sleep(200);
  let a1 = await px(0.5, 0.75), a2 = await px(0.86, 0.15);
  chk('„Medium, ich klein“: Dokument füllt das Bild, Kamera klein oben rechts', isLight(a1) && isGreen(a2), [a1, a2]);
  await page.keyboard.press('1'); await sleep(100); a1 = await px(0.5, 0.75);
  chk('„Nur ich“ (Taste 1): Kamera füllt das Bild', isGreen(a1), a1);
  await page.keyboard.press('4'); await sleep(100); a1 = await px(0.25, 0.5); a2 = await px(0.75, 0.75);
  chk('„Nebeneinander“ (Taste 4): Dokument links, Kamera rechts', isLight(a1) && isGreen(a2), [a1, a2]);
  await page.keyboard.press('3'); await sleep(100); a1 = await px(0.3, 0.75); a2 = await px(0.86, 0.15);
  chk('„Ich, Medium klein“ (Taste 3): Kamera groß, Dokument klein in der Ecke', isGreen(a1) && isLight(a2), [a1, a2]);
  await page.selectOption('#corner', 'll'); await sleep(100); a2 = await px(0.14, 0.85);
  chk('Ecke wählbar: kleines Bild unten links', isLight(a2), a2);
  await page.selectOption('#corner', 'ur');
  const sb = await page.locator('#stageOn').boundingBox(); await page.mouse.move(sb.x + sb.width * 0.4, sb.y + sb.height * 0.5); await sleep(100);
  chk('Mauszeiger über der Bühne wird erfasst', await ev(() => HoneyRec.Mouse.in));
  await page.keyboard.press('6'); await sleep(100);
  const cur = await ev(() => { HoneyRec.drawProg(); const c0 = document.querySelector('#progCv'), c = document.createElement('canvas'); c.width = c0.width; c.height = c0.height; const g = c.getContext('2d'); g.drawImage(c0, 0, 0); const st = document.querySelector('#stageOn').getBoundingClientRect(), M = HoneyRec.Mouse;
    // Lage des Zeigers im Programm: Fenster eingepasst in das ganze Bild
    const S = Math.min(1920 / st.width, 1920 / st.height), ww = st.width * S, wh = st.height * S, k = Math.min(c.width / ww, c.height / wh), ox = (c.width - ww * k) / 2, oy = (c.height - wh * k) / 2;
    const x = Math.round(ox + (M.x * S + 4) * k), y = Math.round(oy + (M.y * S + 9) * k), d = g.getImageData(x - 2, y - 2, 5, 5).data; let w = 0, b = 0; for (let i = 0; i < d.length; i += 4){ if (d[i] > 240 && d[i + 1] > 240 && d[i + 2] > 240) w++; if (d[i] < 40) b++; } return {w, b}; });
  chk('Mauszeiger ist im Programmbild zu sehen (weißer Pfeil mit dunklem Rand)', cur.w > 3 && cur.b > 0, cur);
  // Aufnahme mit Wechsel der Anordnung
  const nItems = (await R()).items.length;
  await page.keyboard.press('2'); await page.click('#recBtn'); await sleep(900); await page.keyboard.press('4'); await sleep(900); await page.click('#recBtn');
  await page.waitForFunction(() => { const t = HoneyRec.P.rec.takes.slice(-1)[0]; return t && t.src && t.regie; }, null, { timeout: 30000 });
  P = await R(); const rt = P.rec.takes.slice(-1)[0];
  chk('Take mit Bildregie: fertiges Bild 1280×720 mit Ton, Wechsel der Anordnung gemerkt', rt.src.width === 1280 && rt.src.height === 720 && rt.src.hasAudio && rt.regie.lay.map(l => l[1]).join('>') === 'medium-pip>neben', { w: rt.src.width, h: rt.src.height, lay: rt.regie.lay });
  chk('Bildregie: keine zusätzlichen Einblendungen im Projekt (Medium steckt schon im Bild)', P.items.length === nItems, [P.items.length, nItems]);
  // 9:16
  await page.click('#setBtn'); await page.selectOption('#fmtSel', '9:16'); await page.click('#setOk'); await sleep(200);
  const dims = await ev(() => { HoneyRec.drawProg(); const c = document.querySelector('#progCv'); return [c.width, c.height]; });
  a1 = await px(0.5, 0.2); a2 = await px(0.5, 0.8);
  chk('9:16: Programm hochkant, „nebeneinander“ wird übereinander (Dokument oben, Kamera unten)', dims[0] === 720 && dims[1] === 1280 && isLight(a1) && isGreen(a2), {dims, a1, a2});
  await page.click('#setBtn'); await page.selectOption('#fmtSel', '16:9'); await page.uncheck('#regieOn'); await page.click('#setOk');
  // große Bühne, volle Breite, Vollbild
  const w0 = await ev(() => document.querySelector('#stage').getBoundingClientRect().width);
  await page.click('#mBig'); await sleep(300);
  const w1 = await ev(() => document.querySelector('#stage').getBoundingClientRect().width);
  chk('„Groß“: Die Medienbühne wird deutlich breiter', w1 > w0 * 1.2, [w0, w1]);
  await page.click('#mFit'); await page.waitForFunction(() => document.querySelector('#mFit').textContent === 'Ganze Seite', null, { timeout: 5000 }); await sleep(500);
  chk('„Volle Breite“: Seite so breit wie die Bühne, nach unten scrollbar', await ev(() => { const w = document.querySelector('.docwrap'), i = document.querySelector('.docin'); return i.offsetWidth >= w.clientWidth - 2 && Math.abs(i.offsetHeight - i.offsetWidth * 595 / 842) < 8; }));
  await page.click('#mFit');
  await page.click('#mFull'); await sleep(400);
  chk('Vollbild der Medienbühne', await ev(() => document.fullscreenElement === document.querySelector('#stage')));
  await ev(() => document.exitFullscreen()); await sleep(300);
  await shot('8_regie');

  // ── Fertig → HoneyCut ──
  const pid = P.id, nSrc = P.sources.length;
  await page.click('#doneBtn');
  await page.waitForFunction(id => typeof P !== 'undefined' && P && P.id === id, pid, { timeout: 20000 });
  await sleep(800);
  const hc = await ev(() => ({ n: P.sources.length, items: P.items.length, dels: P.dels.length, script: P.script && P.script.text, house: 'houseNew' in P, rec: P.rec && P.rec.done, tab, hash: location.hash }));
  chk('„Fertig“ öffnet die Aufnahme in HoneyCut als normales Projekt (Quellen, Elemente, Schnitte, Skript)', hc.n === nSrc && hc.items >= 7 && hc.dels === 2 && hc.script === SKRIPT && !hc.house && hc.rec && !hc.hash, hc);
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
  chk('Weiter aufnehmen: Der neue Take kommt als weitere Quelle hinten dazu, Bisheriges (Elemente, Schnitte) bleibt', P.sources.length === nSrc + 1 && P.sources[nSrc].name === `Take ${String(nSrc + 1).padStart(2, '0')}` && P.items.length === hc.items && P.dels.length === 2 && P.rec.fixed === nSrc, { n: P.sources.length, items: P.items.length, dels: P.dels, fixed: P.rec.fixed });

  // ── Schmaler Bildschirm (Handy hochkant) ──
  await page.setViewportSize({ width: 412, height: 860 }); await sleep(300); await shot('6_handy');
  chk('Handy hochkant: Aufnahmeknopf und Fertig bleiben erreichbar', await ev(() => { const a = document.querySelector('#recBtn').getBoundingClientRect(), b = document.querySelector('#doneBtn').getBoundingClientRect(); return a.width > 0 && b.right <= innerWidth + 1 && a.right <= innerWidth + 1; }));

  chk('Keine Fehler auf der Seite', !logs.length, logs);
  await ev(id => TS.deleteProject(id), pid);   // aufräumen: Die Aufnahme liegt danach im Papierkorb, die Dateien bleiben
} catch (e) { chk('Ablauf ohne Abbruch', false, String(e && e.stack || e).slice(0, 600)); }
await ende(br);
