// Browser-Export (web/engine.js): Bild und Ton aus dem Exportplan, gerechnet in echtem Chrome – aber ohne echte Dateien und ohne
// Kodierer. Die Medienbibliothek ist durch eine Attrappe ersetzt (tests/attrappe/media.js): Ein „Video“ zeigt zu jeder Zeit das
// Balkenbild seiner Bildnummer (wie takt.mp4) und klingt als Sinuston; der „Kodierer“ liest jedes fertige Bild ab und sammelt den Ton.
// Geprüft wird damit, was der Browser-Export aus dem Plan macht: Schnitte, Übergänge (2.34), Tempo, Bild-Einschub, „Musik weicht der
// Sprache“ und „Stimme aufbereiten“. Die Erwartungen sind dieselben wie beim Windows-Export (backend_test.py, ton_234).
// Belege im Bild (2.35): unkenntlich gemachte Bereiche (plan.blurs) am Schachbrett-Muster gemessen, Formen und Fortschrittsbalken
// als Bilder darüber (top). Die Fenster-Rechnung ist dieselbe wie in textschnitt.py (blur_graph) und OvGeom.java.
import fs from 'node:fs';
import path from 'node:path';
import { browser as startBrowser, pruefung, HERE } from './drv.mjs';
const REPO = process.env.HC_REPO || path.dirname(HERE);
const { chk, ende } = pruefung('Browser-Export aus dem Plan');
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const rnd = v => +(+v).toFixed(2);
const cut = (src, head) => { const a = src.indexOf(head); if (a < 0) throw new Error('nicht gefunden: ' + head);
  let d = 0; for (let i = src.indexOf('{', a); i < src.length; i++){ if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) return src.slice(a, i + 1); }
  throw new Error('Ende nicht gefunden: ' + head); };
const br = await startBrowser();
const page = await (await br.newContext()).newPage();
const logs = [];
// (Der Hinweis auf willReadFrequently kommt vom Ablesen der Bilder in der Attrappe, nicht vom Export.)
page.on('console', m => { if ((m.type() === 'error' || m.type() === 'warning') && !/willReadFrequently/.test(m.text())) logs.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', e => logs.push('PAGEERROR: ' + (e.stack || e.message)));
const files = {
  '/index.html': ['text/html', '<!doctype html><meta charset="utf-8"><title>Browser-Export</title><body><script type="module">import * as E from "./engine.js"; window.E = E; window.ready = true;</script>'],
  '/engine.js': ['text/javascript', fs.readFileSync(path.join(REPO, 'web', 'engine.js'), 'utf8')],
  '/vendor/media.js': ['text/javascript', fs.readFileSync(path.join(HERE, 'attrappe', 'media.js'), 'utf8')],
};
await page.route('http://hc.test/**', route => { const f = files[new URL(route.request().url()).pathname]; return f ? route.fulfill({ status: 200, contentType: f[0] + '; charset=utf-8', body: f[1] }) : route.fulfill({ status: 404, body: '' }); });
// der Rechenkern von „Stimme aufbereiten“ kommt im Browser aus app.js
await page.addInitScript(src => { globalThis.voiceDspLib = new Function(src + '\nreturn voiceDspLib;')(); }, cut(fs.readFileSync(path.join(REPO, 'core', 'web', 'app.js'), 'utf8'), 'function voiceDspLib(){'));

// Plan rechnen; levels: [[Frequenz, von, bis], …] → Pegel dieses Tons im fertigen Ton (dBFS, Scheitelwert)
const run = (plan, levels = []) => page.evaluate(async ([plan, levels]) => {
  HC_OUT.reset();
  const mk = (name, fake) => ({ name, type: name.endsWith('.wav') ? 'audio/wav' : 'video/mp4', fake: { name, ...fake } });
  if (!window.FILES){
    window.FILES = { takt: mk('takt.mp4', { fps: 30, duration: 30, audio: [[1000, 0.1], [50, 0.05]] }), musik: mk('musik.wav', { duration: 40, audio: [[3000, 0.2]] }) };
    const c = document.createElement('canvas'); c.width = 64; c.height = 36; const x = c.getContext('2d'); x.fillStyle = '#181818'; x.fillRect(0, 0, 64, 36);
    FILES.bild = new File([await new Promise(r => c.toBlob(r, 'image/png'))], 'bild.png', { type: 'image/png' });
    FILES.karo = mk('karo.mp4', { fps: 30, duration: 30, pattern: 'karo', audio: [[1000, 0.1]] });
    for (const [k, col, w, h] of [['rot', '#FF0000', 32, 32], ['gruen', '#00FF00', 32, 32], ['balken', '#E5402A', 640, 4]]){ c.width = w; c.height = h; x.fillStyle = col; x.fillRect(0, 0, w, h);
      FILES[k] = new File([await new Promise(r => c.toBlob(r, 'image/png'))], k + '.png', { type: 'image/png' }); }
  }
  const job = { cancel: false, progress: 0, message: '' };
  let res; try { res = await E.render(plan, uri => FILES[uri] || null, job); } catch (e) { return { error: String(e && e.stack || e) }; }
  const n = HC_OUT.audio.L.reduce((s, a) => s + a.length, 0), L = new Float32Array(n); let q = 0; for (const a of HC_OUT.audio.L){ L.set(a, q); q += a.length; }
  const level = (f, a, b) => { const i0 = Math.round(a * 48000), i1 = Math.min(n, Math.round(b * 48000)), w = 2 * Math.PI * f / 48000; let re = 0, im = 0;
    for (let i = i0; i < i1; i++){ re += L[i] * Math.cos(w * i); im += L[i] * Math.sin(w * i); } return 20 * Math.log10(2 * Math.hypot(re, im) / Math.max(1, i1 - i0) + 1e-9); };
  return { frames: HC_OUT.frames, samples: n, sinks: HC_OUT.sinks, ext: res.ext, levels: levels.map(([f, a, b]) => +level(f, a, b).toFixed(2)) };
}, [plan, levels]);
// Bildnummer aus den Balken (null, wenn sie zwischen zwei Bildern stehen) und Anteil des Bilds b in einer Mischung mit a
const num = v => v.every(x => x < 0.2 || x > 0.8) ? v.reduce((s, x, k) => s + (x > 0.5 ? 1 << k : 0), 0) : null;
const anteil = (v, a, b) => { const e = []; for (let k = 0; k < 10; k++){ const x = (a >> k) & 1, y = (b >> k) & 1; if (x !== y) e.push((v[k] - x) / (y - x)); } return e.reduce((s, q) => s + q, 0) / e.length; };
const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
const seg = (a, b, kw = {}) => ({ kind: 'main', src: 0, uri: 'takt', in: a, out: b, zooms: [], hasAudio: true, hasVideo: true, speed: 1, vol: 1, bright: 0, contrast: 0, sat: 0, gray: false, tx: 0, ty: 0, sc: 1, ...kw });
const lay = (a, b, kw = {}) => ({ ...seg(a, b, kw), hasAudio: false, vol: 0 });
const plan = (segs, kw = {}) => ({ format: 'video', name: 'x', width: 640, height: 360, fps: 30, total: +segs.reduce((s, x) => s + (x.out - x.in) / (x.speed || 1), 0).toFixed(3), quality: 'klein', burn: false, audioFormat: 'wav', overlays: [], segments: segs,
  sources: [{ uri: 'takt', name: 'takt.mp4', duration: 30, width: 640, height: 360, fps: 30, hasAudio: true, hasVideo: true }], ...kw });

try {
  await page.goto('http://hc.test/index.html');
  await page.waitForFunction(() => window.ready === true, null, { timeout: 15000 });
  const segs3 = () => [seg(0, 2), seg(3, 5), seg(6, 8)];
  const h = await run(plan(segs3()));
  const nh = (h.frames || []).map(f => num(f[1]));
  chk('ohne Übergänge: 180 Bilder, harte Schnitte, jedes Bild an seiner Stelle; eine Bildquelle je Datei', !h.error && nh.join() === [...range(0, 60), ...range(90, 150), ...range(180, 240)].join() && h.sinks.length === 1 && h.ext === 'mp4', h.error || [nh.length, h.sinks]);
  chk('Ton: so viele Abtastwerte wie das Video lang ist', h.samples === 6 * 48000, h.samples);

  // dieselben Übergänge wie in backend_test.py: Blende 0,4 s vor dem ersten Schnitt, „Bild später“ 0,5 s am zweiten
  const tr3 = [{ at: 1.6, d: 0.4, a0: 0, a1: 1, lead: 0, tail: 0.1, over: 0, seg: lay(2.6, 3.1) }, { at: 4.0, d: 0.5, a0: 1, a1: 1, lead: 0.1, tail: 0, over: 2, seg: lay(4.9, 5.5) }];
  const e = await run(plan(segs3(), { trans: tr3 }));
  const ne = (e.frames || []).map(f => num(f[1]));
  chk('mit Übergängen: gleich viele Bilder und derselbe Ton; die Ebenen lesen aus einer eigenen Bildquelle', !e.error && ne.length === 180 && e.samples === h.samples && e.sinks.length === 2, e.error || [ne.length, e.sinks.length]);
  if (!e.error && ne.length === 180){
    const al = range(48, 60).map(i => anteil(e.frames[i][1], i, 78 + i - 48));
    chk('Blende: Die Deckkraft steigt gleichmäßig von 0 auf 1 und ist am Schnitt fertig', al.every((a, j) => near(a, j / 12, 0.03)), al.map(rnd));
    chk('Blende: davor das Bild des vorigen Clips, danach nahtlos der nächste', ne.slice(40, 48).join() === range(40, 48).join() && ne.slice(60, 70).join() === range(90, 100).join(), ne.slice(58, 66));
    chk('Bild später: Der vorige Clip läuft 15 Bilder weiter, dann steigt der nächste an der richtigen Stelle ein', ne.slice(110, 140).join() === [...range(140, 165), ...range(195, 200)].join(), ne.slice(116, 140));
  }
  // acht kurze Abschnitte: Blende hinter dem Schnitt, „Bild früher“, „Bild später“
  const segs8 = range(0, 8).map(m => seg(m, m + 0.5));
  const tr8 = [{ at: 0.5, d: 0.2, a0: 1, a1: 0, lead: 0.1, tail: 0, over: 1, seg: lay(0.4, 0.7) }, { at: 2.8, d: 0.2, a0: 1, a1: 1, lead: 0, tail: 0.1, over: 5, seg: lay(5.8, 6.1) }, { at: 3.5, d: 0.2, a0: 1, a1: 1, lead: 0.1, tail: 0, over: 7, seg: lay(6.4, 6.7) }];
  const mus = [{ mode: 'audio', uri: 'musik', in: 0, out: 4, at: 0, track: 1, vol: 1, hasAudio: true, duck: true }];
  const duck = [[0, 1], [2.9, 1], [3.1, 0.2], [9, 0.2]];
  const k = await run(plan(segs8, { trans: tr8, overlays: mus, duck }), [[3000, 0.3, 2.7], [3000, 3.3, 3.9], [1000, 0.6, 0.9], [1000, 3.6, 3.9]]);
  const nk = (k.frames || []).map(f => num(f[1]));
  if (!k.error && nk.length === 120){
    chk('Bild früher: sechs Bilder des nächsten Clips vor dem Schnitt, dann nahtlos weiter', nk.slice(78, 96).join() === [...range(153, 159), ...range(174, 186)].join(), nk.slice(78, 96));
    chk('Bild später: sechs Bilder des vorigen Clips hinter dem Schnitt', nk.slice(99, 114).join() === [...range(189, 201), ...range(216, 219)].join(), nk.slice(99, 114));
    const al = range(15, 21).map(i => anteil(k.frames[i][1], 30 + i - 15, 15 + i - 15));
    chk('Blende hinter dem Schnitt: Die Deckkraft fällt gleichmäßig von 1 auf 0', al.every((a, j) => near(a, 1 - j / 6, 0.03)) && nk.slice(21, 30).join() === range(36, 45).join(), al.map(rnd));
    chk('Musik weicht der Sprache: Die Tonspur folgt dem Verlauf (−14 dB), der Ton der Hauptspur bleibt', near(k.levels[0], -13.98, 0.3) && near(k.levels[1], -27.96, 0.4) && near(k.levels[2], -20, 0.5) && near(k.levels[3], -20, 0.5), k.levels);
  } else chk('Plan mit acht Abschnitten, Übergängen und Tonspur läuft durch', false, k.error || nk.length);
  const k0 = await run(plan(range(0, 8).map(m => seg(m, m + 0.5)), { overlays: [{ ...mus[0], duck: false }], duck }), [[3000, 0.3, 2.7], [3000, 3.3, 3.9]]);
  chk('Tonspur ohne Kennzeichnung bleibt trotz Verlauf im Plan gleich laut', !k0.error && near(k0.levels[0], -13.98, 0.3) && near(k0.levels[1], -13.98, 0.3), k0.error || k0.levels);

  // Tempo: der zweite Abschnitt läuft doppelt so schnell; „Bild früher“ nimmt sein Material im selben Tempo
  const fast = [seg(0, 2), seg(3, 7, { speed: 2 })];
  const sp = await run(plan(fast, { trans: [{ at: 1.4, d: 0.6, a0: 1, a1: 1, lead: 0, tail: 0.1, over: 0, seg: lay(1.8, 3.2, { speed: 2 }) }] }));
  const ns = (sp.frames || []).map(f => num(f[1]));
  chk('Tempo: Die Ebene läuft im Tempo ihres Clips auf den Schnitt zu (zwei Quellbilder je Bild), danach der Clip selbst', !sp.error && ns.length === 120 && ns.slice(40, 64).join() === [40, 41, ...range(0, 18).map(j => 54 + 2 * j), 90, 92, 94, 96].join(), sp.error || ns.slice(40, 64));

  // Bild als Einschub: Blende auf das Bild, dahinter bleibt es beim „Bild später“ stehen
  const insert = { kind: 'insert', uri: 'bild', in: 0, out: 2, image: true, hasAudio: false, hasVideo: true, vol: 1 };
  const withImg = [seg(0, 2), insert, seg(3, 5)];
  const im = await run(plan(withImg, { trans: [{ at: 1.6, d: 0.4, a0: 0, a1: 1, lead: 0, tail: 0.1, over: 0, seg: { ...insert, in: 0, out: 0.5, vol: 0 } }, { at: 4.0, d: 0.3, a0: 1, a1: 1, lead: 0.1, tail: 0, over: 2, seg: { ...insert, in: 0, out: 0.4, vol: 0 } }] }));
  if (!im.error && im.frames.length === 180){
    const hell = i => Math.max(...im.frames[i][1]), ramp = range(48, 60).map(hell), still = range(120, 129).map(hell), after = range(129, 132).map(i => num(im.frames[i][1]));
    chk('Bild-Einschub: Das Bild blendet über 12 Bilder ein, bleibt hinter dem Einschub 9 Bilder stehen, dann läuft das Video an der richtigen Stelle weiter',
      ramp.every((v, j) => near(v, 1 - j / 12, 0.04)) && still.every(v => v < 0.03) && after.join() === '99,100,101' && range(60, 120).every(i => hell(i) < 0.03), { ramp: ramp.map(rnd), still: still.map(rnd), after });
  } else chk('Plan mit Bild-Einschub und Übergängen läuft durch', false, im.error || im.frames.length);

  // Stimme aufbereiten: das Brummen bei 50 Hz verschwindet, die Länge bleibt; ohne voice im Plan bleibt der Ton unberührt
  const lv = [[50, 0.5, 1.9], [50, 2.5, 3.9]];
  const raw = await run(plan([seg(0, 2), seg(3, 5)]), lv), cl = await run(plan([seg(0, 2, { voice: { k: 's0' } }), seg(3, 5, { voice: { k: 's0', lvl: [[0, 1], [2, 1]] } })]), lv);
  chk('Stimme aufbereiten: Brummen deutlich leiser, in beiden Abschnitten; gleiche Länge', !raw.error && !cl.error && near(raw.levels[0], -26.02, 0.5) && cl.levels[0] < raw.levels[0] - 15 && cl.levels[1] < raw.levels[1] - 15 && cl.samples === raw.samples, raw.error || cl.error || [raw.levels, cl.levels]);

  // ── Belege im Bild (2.35) ──
  // Ein fertiges Bild auswerten: fn(px, s) läuft in der Seite; px(x, y) → [r, g, b]
  const probe = (t, fn) => page.evaluate(([t, src]) => { const s = HC_OUT.shots.find(q => Math.abs(q.t - t) < 1e-3); if (!s) return null;
    const px = (x, y) => { const i = (y * s.w + x) * 4; return [s.data[i], s.data[i + 1], s.data[i + 2]]; };
    return new Function('px', 's', 'return (' + src + ')(px, s)')(px, s); }, [t, fn.toString()]);
  // Rahmen um alle Pixel, die nicht mehr zum Schachbrett gehören (Werte zwischen den beiden Feldfarben), und die Spanne ihrer Werte
  const changed = (px, s) => { let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1, n = 0, lo = 255, hi = 0; const seen = new Set();
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++){ const [r, g, b] = px(x, y); if (r === g && g === b && (r <= 0x1A || r >= 0xE6)) continue;
      n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (r < lo) lo = r; if (r > hi) hi = r; seen.add(r << 16 | g << 8 | b); }
    return { box: n ? [x0, y0, x1, y1] : null, n, lo, hi, colors: seen.size }; };
  const want = ts => page.evaluate(ts => { HC_OUT.want = ts; }, ts);
  const kseg = (a, b) => ({ ...seg(a, b), uri: 'karo' });
  const kplan = kw => plan([kseg(0, 2)], { sources: [{ uri: 'karo', name: 'karo.mp4', duration: 30, width: 640, height: 360, fps: 30, hasAudio: true, hasVideo: true }], ...kw });
  const fr = n => +(n / 30).toFixed(4);
  await want([fr(6), fr(30), fr(51)]);
  const b0 = await run(kplan({}));
  const leer = await probe(fr(30), changed);
  chk('Schachbrett ohne Bereiche: jedes Pixel hat eine der beiden Feldfarben', !b0.error && leer && leer.n === 0, b0.error || leer);
  // 1) Rechteck verpixelt, 0,5 bis 1,5 s: Fenster [96, 224) × [116, 244), Felder von 16 Pixeln → jedes Feld mittelt zu Grau
  const rect = { at: 0.5, d: 1, x: 0.25, y: 0.5, w: 0.2, wmax: 0.2, aspect: 1, form: 'rect', kind: 'pixel', cell: 0.025 };
  const b1 = await run(kplan({ blurs: [rect] }));
  const r1 = [await probe(fr(6), changed), await probe(fr(30), changed), await probe(fr(51), changed)];
  chk('verpixeltes Rechteck: genau der Bereich ist betroffen, davor und danach nichts', !b1.error && r1[0] && r1[0].n === 0 && r1[2].n === 0 && r1[1].box && r1[1].box.join() === '96,116,223,243' && r1[1].n === 128 * 128, b1.error || r1.map(q => q && [q.box, q.n]));
  chk('verpixeltes Rechteck: Die Felder mitteln das Schachbrett zu gleichmäßigem Grau', r1[1] && r1[1].lo >= 120 && r1[1].hi <= 136 && r1[1].colors <= 12, r1[1] && [r1[1].lo, r1[1].hi, r1[1].colors]);
  // 2) Ellipse weichgezeichnet mit Keyframes: wandert von 0,7 nach 0,8 und wächst von 0,1 auf 0,2 der Bildbreite
  const ell = { at: 0.5, d: 1, x: 0.7, y: 0.5, w: 0.1, wmax: 0.2, aspect: 1, form: 'ellipse', kind: 'soft', cell: 0.025, kf: [{ t: 0, x: 0.7, y: 0.5, w: 0.1 }, { t: 1, x: 0.8, y: 0.5, w: 0.2 }] };
  await want([fr(15), fr(30)]);
  const b2 = await run(kplan({ blurs: [ell] }));
  const e0 = await probe(fr(15), changed), e1 = await probe(fr(30), changed);
  const nearBox = (q, w) => q && q.box && q.box.every((v, i) => Math.abs(v - w[i]) <= 2);
  chk('weichgezeichnete Ellipse mit Keyframes: Lage und Größe folgen dem Verlauf', !b2.error && nearBox(e0, [416, 148, 479, 211]) && nearBox(e1, [432, 132, 527, 227]), b2.error || [e0 && e0.box, e1 && e1.box]);
  const ecken = await probe(fr(30), (px) => [px(435, 135), px(524, 224), px(480, 180), px(440, 180)].map(p => p[0]));
  chk('Ellipse: Die Ecken ihres Rahmens bleiben Schachbrett, Mitte und Achse sind grau', ecken && [ecken[0], ecken[1]].every(v => v <= 0x1A || v >= 0xE6) && ecken[2] > 100 && ecken[2] < 156 && ecken[3] > 100 && ecken[3] < 156, ecken);
  chk('Ellipse: Fläche passt zur Ellipse (π/4 des Rahmens)', e1 && Math.abs(e1.n / (96 * 96) - Math.PI / 4) < 0.03, e1 && +(e1.n / (96 * 96)).toFixed(3));
  // 3) Randlage: Der Bereich ragt links unten aus dem Bild – das Fenster rückt ins Bild, verändert wird nur der sichtbare Teil
  await want([fr(30)]);
  const b3 = await run(kplan({ blurs: [{ ...rect, x: 0.02, y: 0.95 }] }));
  const r3 = await probe(fr(30), changed);
  chk('Bereich am Bildrand: nur der sichtbare Teil ist betroffen', !b3.error && nearBox(r3, [0, 278, 76, 359]), b3.error || (r3 && r3.box));
  // 4) Reihenfolge: Einblendungen darunter werden mit unkenntlich, Formen und Fortschrittsbalken (top) liegen unberührt darüber
  const img = (uri, x, y, w, kw = {}) => ({ mode: 'pip', image: true, uri, at: 0, in: 0, out: 2, x, y, w, aspect: 1, track: 5, vol: 0, hasAudio: false, width: 32, height: 32, rotation: 0, ...kw });
  const ovs = [img('gruen', 0.2, 0.5, 0.04), img('rot', 0.25, 0.5, 0.05, { track: 100, top: true }),
    img('balken', 0.5, 358 / 360, 1, { aspect: 160, track: 150, top: true, opacity: 0.35, width: 640, height: 4 }),
    img('balken', 0.5, 358 / 360, 1, { aspect: 160, track: 151, top: true, width: 640, height: 4, kf: [{ t: 0, x: -0.5, y: 358 / 360, w: 1 }, { t: 2, x: 0.5, y: 358 / 360, w: 1 }] })];
  const b4 = await run(kplan({ blurs: [rect], overlays: ovs }));
  const o4 = await probe(fr(30), (px) => ({ rot: px(160, 180), a: px(129, 181), b: px(140, 190), c: px(142, 181), frei: px(118, 170 - 60), balken: [px(100, 358), px(310, 357)], grund: px(500, 358), ueber: px(500, 354) }));
  chk('Form über dem Bereich bleibt scharf (reines Rot in der Mitte)', !b4.error && o4 && o4.rot.join() === '255,0,0', b4.error || (o4 && o4.rot));
  chk('Einblendung unter dem Bereich wird mit verpixelt: Mischfarbe, im ganzen Feld gleich', o4 && o4.a.join() === o4.b.join() && o4.a.join() === o4.c.join() && o4.a[1] > o4.a[0] + 40 && o4.a[0] > 10 && o4.a[1] < 250, o4 && [o4.a, o4.b, o4.c]);
  chk('Fortschrittsbalken: zur Hälfte der Zeit ist die linke Bildhälfte gefüllt, rechts liegt die Grundlinie', o4 && o4.balken.every(p => p.join() === '229,64,42') && o4.grund.join() !== '229,64,42' && o4.grund[0] > o4.grund[2] + 20 && (o4.ueber[0] <= 0x1A || o4.ueber[0] >= 0xE6), o4 && [o4.balken, o4.grund, o4.ueber]);
  const b5 = await run(kplan({ blurs: [{ ...rect, kind: 'soft' }], overlays: ovs }));
  const o5 = await probe(fr(30), (px) => ({ rot: px(160, 180), a: px(129, 181), c: px(142, 181) }));
  chk('weichgezeichnet: dieselbe Stelle verläuft (kein hartes Feld), die Form darüber bleibt scharf', !b5.error && o5 && o5.rot.join() === '255,0,0' && o5.a.join() !== o5.c.join() && o5.a[1] > o5.a[0], b5.error || (o5 && [o5.a, o5.c]));
  await want(null);
  chk('keine Fehlermeldungen der Seite', logs.length === 0, logs.slice(0, 5));
} catch (e) {
  chk('Prüfung läuft ohne Abbruch durch', false, String(e && e.stack || e).slice(0, 600));
}
await ende(br);
