// Schrift im Export (2.28): Der Windows-Export setzt Untertitel wie die Vorschau – gewählte Schrift, gleiche Größe, gleicher
// Umbruch. Gemessen wird am fertigen Bild: die helle Schrift in der Vorschau und im exportierten Video an derselben Stelle.
// Dazu: der Hinweis, wenn eine Schriftdatei fehlt, und der Name der SRT-Datei bei eingebrannten Untertiteln.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, scratch, dropScratch, setPick, sleep, ids as loadIds, pruefung, OUT, HERE, DATA } from './drv.mjs';
const PJ = loadIds();
const { chk, ende } = pruefung('Schrift im Export');
const { browser, page, logs } = await launch({ viewport: { width: 1480, height: 1000 } });
const ev = (f, a) => page.evaluate(f, a);
const LEN = 8;
const drop = async id => { await ev(() => { if (typeof P !== 'undefined' && P){ pausePlay(); clearTimeout(saveT); } }); await dropScratch(page, id); };
const waitJob = async job => { for (;;) { const j = await ev(id => JSON.parse(TS.job(id)), job); if (j && j.status !== 'running') { if (j.status !== 'done') throw new Error('Export: ' + j.error); return j.result; } await sleep(250); } };
// kurzer Export der ersten Sekunden (mit oder ohne Untertitel)
const exportShort = async mod => waitJob(await ev(([mod, LEN]) => { const pl = buildPlan(); pl.segments = [{ ...pl.segments[0], out: pl.segments[0].in + LEN }]; pl.total = LEN; pl.overlays = [];
  if (pl.subs) pl.subs.cues = pl.subs.cues.filter(c => c.start < LEN).map(c => ({ ...c, end: Math.min(c.end, LEN) })); if (mod.noSubs) pl.subs = null; delete mod.noSubs; Object.assign(pl, mod); window.__pl = pl; return TS.exportVideo(JSON.stringify(pl)); }, [mod, LEN]));
const rgb = (f, W, H, t) => execFileSync('ffmpeg', ['-v', 'error', ...(t == null ? [] : ['-ss', String(t)]), '-i', f, '-frames:v', '1', '-vf', `scale=${W}:${H}:flags=lanczos`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 });
// Rechteck um die helle Schrift, die im einen Bild steht und im anderen fehlt (Anteile von Breite und Höhe)
function whiteBox(A, B, W, H){
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){ const i = (y * W + x) * 3;
    if (Math.min(A[i], A[i + 1], A[i + 2]) > 200 && Math.max(Math.abs(A[i] - B[i]), Math.abs(A[i + 1] - B[i + 1]), Math.abs(A[i + 2] - B[i + 2])) > 40){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
  return x1 < 0 ? null : [x0 / W, y0 / H, (x1 + 1) / W, (y1 + 1) / H];
}
const hide = v => ev(v => { for (const s of ['#subOv', '#titleOv', '#tline', '#srcLine', '#lowerOv']) { const e = document.querySelector(s); if (e) e.style.visibility = v; } }, v);
// Ein Fall: frisches Projekt, Gestaltung setzen, Vorschau und Export an zwei Stellen (ein- und zweizeiliger Untertitel) vermessen
async function fall(name, code){
  const sid = await scratch(page, PJ.kurz);
  await ev(() => setTab('subs')); await sleep(300);
  await ev(code => { commit(() => { new Function(code)(); }, true); styleOverlay(); syncStyleInputs(); cueCache.at = -1; }, code);
  await ev(() => { fitStage(); renderExportForm(); seekOut(outPos, false); }); await sleep(300); await ev(() => { fitStage(); styleOverlay(); });
  await sleep(500); await ev(() => document.fonts.ready); await sleep(200);
  const ohne = (await exportShort({ name: 'schrift_ohne_' + name, noSubs: true })).playable, mit = await exportShort({ name: 'schrift_' + name });
  const [W, H] = await ev(() => [window.__pl.width, window.__pl.height]), S2 = 2;
  const times = await ev(LEN => { const cs = computedCues().filter(x => x.e < LEN), one = cs.find(x => !wrapText(x.text).includes('\n')), two = cs.find(x => wrapText(x.text).includes('\n')); return [one, two].filter(Boolean).map(x => +((x.s + x.e) / 2).toFixed(2)); }, LEN);
  const out = [];
  for (const [k, t] of times.entries()){
    await ev(o => { pausePlay(); seekOut(o, false); }, t); await sleep(800);
    const st = await page.$('#stage'), a = path.join(OUT, `schrift-${name}-${k}-vorschau.png`), b = path.join(OUT, `schrift-${name}-${k}-leer.png`);
    await st.screenshot({ path: a }); await hide('hidden'); await sleep(120); await st.screenshot({ path: b }); await hide('');
    const pv = whiteBox(rgb(a, W * S2, H * S2), rgb(b, W * S2, H * S2), W * S2, H * S2), ex = whiteBox(rgb(mit.playable, W * S2, H * S2, t), rgb(ohne, W * S2, H * S2, t), W * S2, H * S2);
    fs.unlinkSync(b);
    if (k === times.length - 1) execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t), '-i', mit.playable, '-frames:v', '1', path.join(OUT, `schrift-${name}-${k}-export.png`)]);
    out.push({ t, pv, ex, rows: await ev(() => document.querySelector('#subOv').getClientRects().length), rw: pv && ex ? (ex[2] - ex[0]) / (pv[2] - pv[0]) : 0, rh: pv && ex ? (ex[3] - ex[1]) / (pv[3] - pv[1]) : 0,
      dx: pv && ex ? ((ex[0] + ex[2]) - (pv[0] + pv[2])) / 2 : 9, dy: pv && ex ? ((ex[1] + ex[3]) - (pv[1] + pv[3])) / 2 : 9 });
  }
  await drop(sid);
  return { name, W, H, warn: mit.warn || null, files: (mit.files || []).map(f => path.basename(f)), out };
}
const passt = r => r.out.length === 2 && r.out.every(o => o.pv && o.ex && o.rw > 0.95 && o.rw < 1.05 && o.rh > 0.9 && o.rh < 1.1 && Math.abs(o.dx) < 0.008 && Math.abs(o.dy) < 0.008);
const kurz = r => r.out.map(o => `${o.rw.toFixed(3)}×${o.rh.toFixed(3)} ${o.dx >= 0 ? '+' : ''}${o.dx.toFixed(4)}/${o.dy >= 0 ? '+' : ''}${o.dy.toFixed(4)}`);

// ═════════ Vorschau und Export stimmen überein ═════════
const std = await fall('standard', '');
chk('Standardschrift: im Video so groß und an derselben Stelle wie in der Vorschau (Breite und Höhe der Schrift, Mittelpunkt)', passt(std), kurz(std));
const pop = await fall('poppins', "S().font = 'poppins';");
chk('Poppins: im Video so groß und an derselben Stelle wie in der Vorschau', passt(pop), kurz(pop));
chk('gewählte Schrift steht im Video: Poppins läuft breiter als die Standardschrift, wie in der Vorschau', pop.out[0].ex[2] - pop.out[0].ex[0] > (std.out[0].ex[2] - std.out[0].ex[0]) * 1.03
  && Math.abs((pop.out[0].ex[2] - pop.out[0].ex[0]) / (std.out[0].ex[2] - std.out[0].ex[0]) - (pop.out[0].pv[2] - pop.out[0].pv[0]) / (std.out[0].pv[2] - std.out[0].pv[0])) < 0.04,
  [pop.out[0].ex[2] - pop.out[0].ex[0], std.out[0].ex[2] - std.out[0].ex[0]].map(v => +v.toFixed(4)));
chk('eingebrannte Untertitel: kein Hinweis, die SRT-Datei heißt anders als das Video', pop.warn === null && pop.files.join('|') === 'schrift_poppins.mp4|Untertitel – schrift_poppins.srt', pop.files);
const ant = await fall('anton_kasten', "Object.assign(S(), {font: 'anton', bg: true});");
chk('Anton mit Kasten: Schrift im Video wie in der Vorschau', passt(ant), kurz(ant));
const hoch = await fall('hoch_poppins', "P.format = '9:16'; P.frame = clampFrame({sc: coverSc(), tx: 0, ty: 0}); S().font = 'poppins';");
chk('Hochformat: Zeilen, die nicht in die Breite passen, brechen im Video um wie in der Vorschau – nichts läuft aus dem Bild',
  hoch.W === 360 && hoch.H === 640 && passt(hoch) && hoch.out.every(o => o.ex[0] > 0.02 && o.ex[2] < 0.98) && hoch.out[1].ex[3] - hoch.out[1].ex[1] > 2.5 * 0.0725 * 360 / 640, [kurz(hoch), hoch.out.map(o => o.ex.map(v => +v.toFixed(3)))]);
const hstd = await fall('hoch_standard', "P.format = '9:16'; P.frame = clampFrame({sc: coverSc(), tx: 0, ty: 0});");
chk('Hochformat mit Standardschrift: bleibt im Bild und steht wie in der Vorschau', passt(hstd) && hstd.out.every(o => o.ex[0] > 0.02 && o.ex[2] < 0.98), [kurz(hstd), hstd.out.map(o => o.ex.map(v => +v.toFixed(3)))]);

// ═════════ Fehlt eine Schriftdatei, sagt der Export es ═════════
const sid = await scratch(page, PJ.kurz);
const probe = path.join(OUT, 'Probeschrift.ttf');
fs.copyFileSync(path.join(HERE, '..', 'core', 'web', 'fonts', 'Lora-Bold.ttf'), probe);
setPick({ font: [probe] });
const f = await ev(async () => { const f = await importFont(); if (f) setSubFont(f.key); return f && { key: f.key, uri: f.uri, label: f.label }; });
chk('eigene Schrift importiert und gewählt', !!f && (await ev(() => S().font)) === f.key && fs.existsSync(f.uri), f);
fs.unlinkSync(f.uri);   // die Datei verschwindet vom Datenträger – die Oberfläche kennt die Schrift noch
await ev(() => setTab('export')); await sleep(400);
await ev(() => { exFmt = 'video'; paintExportForm(); document.querySelector('#exName').value = 'schrift_fehlt'; });
await page.click('#exBtn');
await page.waitForFunction(() => !document.querySelector('#exDone').classList.contains('hidden') || /^Fehler/.test(document.querySelector('#exMsg').textContent), null, { timeout: 240000 });
const w1 = await ev(() => ({ warn: document.querySelector('#exWarn').classList.contains('hidden') ? '' : document.querySelector('#exWarn').textContent, msg: document.querySelector('#exMsg').textContent, toast: document.querySelector('#toast').textContent, files: (exResult && exResult.files || []).length }));
chk('fehlt die Schriftdatei, entsteht das Video trotzdem – mit einem deutlichen Hinweis beim Ergebnis', /^Fertig/.test(w1.msg) && w1.files >= 2 && w1.warn.includes(`„${f.label.replace(/^TS /, '')}“`) && /ließ sich beim Export nicht laden/.test(w1.warn) && /Standardschrift/.test(w1.warn), w1);
await page.screenshot({ path: path.join(OUT, 'schrift-hinweis.png') });
await ev(() => { setSubFont(''); document.querySelector('#exName').value = 'schrift_ohne_einbrennen'; }); await sleep(200);
if (await ev(() => document.querySelector('#exSubs').checked)) await page.click('#exSubs');
await page.click('#exBtn');
await page.waitForFunction(() => !document.querySelector('#exDone').classList.contains('hidden') && /schrift_ohne_einbrennen/.test(document.querySelector('#exFiles').textContent), null, { timeout: 240000 });
const w2 = await ev(() => ({ warn: document.querySelector('#exWarn').classList.contains('hidden'), files: (exResult.files || []).map(x => x.split(/[\\/]/).pop()) }));
chk('beim nächsten Export ist der Hinweis weg; ohne Einbrennen heißt die SRT-Datei wie das Video', w2.warn && w2.files.join('|') === 'schrift_ohne_einbrennen.mp4|schrift_ohne_einbrennen.srt', w2);
await ev(uri => { try { TS.deleteFont(uri); } catch (_) {} userFonts = userFonts.filter(x => x.uri !== uri); fillFontSelects(); }, f.uri);
fs.rmSync(probe, { force: true });
chk('keine Fehlermeldungen', logs.length === 0, logs.slice(0, 5));
await drop(sid);
await ende(browser);
