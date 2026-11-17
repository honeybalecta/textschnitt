// Person im Bild halten (2.39, E5): Schalter im Clip-Reiter, Masken über das Test-Backend (die Figur der Testmedien wird an ihrer
// Farbe erkannt, das Personen-Modell selbst läuft in den Prüfläufen nicht), Kameraweg, Vorschau, Exportplan und ein echter Export.
// person.mp4: Figur bei 0,30 der Bildbreite, wandert von 6 bis 12 s nach 0,70; von 18 bis 20 s ist niemand im Bild.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { launch, newProject, transcribe, openById, dropScratch, sleep, pruefung, MEDIA } from './drv.mjs';
const { chk, ende } = pruefung('Person im Bild halten');
const { browser, page, logs } = await launch();
const ev = (f, a) => page.evaluate(f, a);
const made = [], trash = [];
const toast = () => ev(() => document.querySelector('#toast').textContent);
const px = t => t < 6 ? 0.3 : t < 12 ? 0.3 + 0.4 * (t - 6) / 6 : 0.7;
// Wo steht die Figur auf der Leinwand (0 … 1), gerechnet aus der Transformation des Vorschau-Videos?
const onCanvas = ts => ev(async ts => { const out = []; for (const t of ts){ seekOut(t, false); await new Promise(r => setTimeout(r, 60)); applyMainTransform();
  const m = /translate\(([-\d.]+)%/.exec(V.style.transform), s = /scale\(([-\d.]+)\)/.exec(V.style.transform), tx = m ? +m[1] / 100 : 0, sc = s ? +s[1] : 1, [wf] = fitFracOf(P.sources[0]);
  const p = t < 6 ? 0.3 : t < 12 ? 0.3 + 0.4 * (t - 6) / 6 : 0.7; out.push(+(0.5 + tx + (p - 0.5) * sc * wf).toFixed(3)); } return out; }, ts);
const follow = async on => { await ev(on => { const c = document.querySelector('#clipFollow'); if (c.checked !== on) c.click(); }, on);
  await page.waitForFunction(on => !document.querySelector('#foBox') && !!(P.follow && P.follow.on) === on, on, { timeout: 60000 }); await sleep(250); };
const figur = (file, t, W = 90, H = 160) => { const f = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-an', '-vf', `scale=${W}:${H}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 24 });
  let sx = 0, n = 0; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){ const o = (y * W + x) * 3; if (f[o] > 150 && f[o + 1] < 110 && f[o + 2] > 150){ sx += x + 0.5; n++; } } return n ? +(sx / n / W).toFixed(3) : -1; };

try {
  const id = await newProject(page, [MEDIA + 'person.mp4']); made.push(id); await transcribe(page);
  await ev(() => setTab('clip')); await sleep(300);
  let st = await ev(() => ({ ...followState(), row: !document.querySelector('#clipFollowRow').classList.contains('hidden'), chk: document.querySelector('#clipFollow').checked }));
  chk('Im Clip-Reiter steht unter „Bildausschnitt“ der Schalter „Person im Bild halten“, zunächst aus', st.can && st.row && !st.chk && !st.on, st);

  // ═════════ Hochformat: der Ausschnitt folgt ═════════
  await page.click('#clipFmt button[data-v="9:16"]'); await sleep(400);
  const vor = await onCanvas([1, 15]);
  chk('Ohne Folgen steht die Figur im Hochformat am Rand oder außerhalb (bei 0,30 und 0,70 der Breite)', vor[0] < 0.1 && vor[1] > 0.9, vor);
  const u0 = await ev(() => undo.length);
  await ev(() => document.querySelector('#clipFollow').click());
  const dlg = await page.waitForSelector('#foBox', { timeout: 5000 }).then(() => true, () => false);
  await page.waitForFunction(() => P.follow && P.follow.on && !document.querySelector('#foBox'), null, { timeout: 60000 }); await sleep(300);
  st = await ev(() => ({ ...followState(), chk: document.querySelector('#clipFollow').checked, info: document.querySelector('#clipFollowInfo').textContent, tr: P.sources[0].track, undo: undo.length }));
  chk('Einschalten: Blatt mit Fortschritt, danach Hinweis „folgt jetzt der Person“ und ein Schritt im Verlauf', dlg && st.on && st.chk && /folgt jetzt der Person/.test(await toast()) && /links und rechts/.test(st.info) && st.undo === u0 + 1, { dlg, info: st.info, undo: [u0, st.undo] });
  const tr = st.tr;
  chk('Im Projekt liegt die Lage der Person je Viertelsekunde (Tausendstel der Bildbreite), Lücken als -1', tr && tr.step === 0.25 && tr.x.length >= 94 && tr.x.length <= 97 && Math.abs(tr.x[4] - 300) <= 12 && Math.abs(tr.x[60] - 700) <= 12 && tr.x[76] === -1 && tr.x.every(Number.isInteger), tr && [tr.step, tr.x.length, tr.x[4], tr.x[60], tr.x[76]]);
  chk('Die Höhe gilt Kopf und Schultern (rund 30 % der Bildhöhe)', Math.abs(tr.y[4] - 300) <= 45, tr.y[4]);
  const ruhe = await onCanvas([1, 4, 15, 17, 19, 22]);
  chk('Steht die Figur, steht sie in der Bildmitte – auch über die Lücke hinweg', ruhe.every(v => Math.abs(v - 0.5) <= 0.025), ruhe);
  const gang = await onCanvas([7, 8, 9, 10, 11]);
  chk('Im Gang bleibt die Figur nahe der Mitte (höchstens 15 % der Bildbreite voraus)', gang.every(v => v >= 0.49 && v <= 0.65), gang);
  const still = await ev(() => { const g = timeline.find(x => x.kind === 'main'); return [0.5, 1, 2, 3, 4].map(t => mainTot(g, t).tx.toFixed(4)); });
  chk('Die Kamera steht still, solange die Figur steht (kein Zittern)', new Set(still).size === 1, still);
  const weich = await ev(() => { const g = timeline.find(x => x.kind === 'main'); let m = 0, prev = null; for (let t = 4; t <= 16; t += 1 / 30){ const v = mainTot(g, t).tx; if (prev != null) m = Math.max(m, Math.abs(v - prev)); prev = v; } return +m.toFixed(4); });
  chk('Die Fahrt ist weich: von Bild zu Bild höchstens 1,5 % der Bildbreite', weich > 0.001 && weich <= 0.015, weich);

  // ═════════ Exportplan ═════════
  let plan = await ev(() => { exFmt = 'video'; P.settings.burn = false; const p = buildPlan(true); return p.segments.map(s => ({ in: s.in, out: s.out, tx: s.tx, sc: s.sc, kf: s.kf })); });
  const k0 = plan[0].kf || [];
  chk('Plan: ein Abschnitt mit Keyframes von 0 bis zum Ende, höchstens 48, der feste Wert gleicht dem ersten', plan.length === 1 && k0.length >= 4 && k0.length <= 48 && k0[0].t === 0 && Math.abs(k0[k0.length - 1].t - (plan[0].out - plan[0].in)) < 0.01 && Math.abs(plan[0].tx - k0[0].tx) < 0.001 && k0.every(k => k.sc === plan[0].sc), { n: k0.length, tx: plan[0].tx });
  chk('Plan: Die Keyframes liegen im Gang dicht, davor und danach weit auseinander', k0.filter(k => k.t >= 5 && k.t <= 14).length >= k0.length - 3, k0.map(k => k.t));
  // Schnitt: Wörter zwischen 2 und 4 s sowie zwischen 9 und 10 s löschen → drei Abschnitte
  await ev(() => { const del = tokens.filter(t => t.type === 'word' && ((t.ws >= 2 && t.we <= 4) || (t.ws >= 9 && t.we <= 10))).map(t => t.i); commit(() => bulkDelete(del), false); });
  plan = await ev(() => buildPlan(true).segments.map(s => ({ in: s.in, out: s.out, tx: s.tx, kf: s.kf })));
  chk('Nach dem Schneiden hat jeder Abschnitt seinen eigenen Weg: der erste (Figur steht) ohne Keyframes, die späteren ab 0', plan.length >= 3 && !plan[0].kf && plan.slice(1).every(s => !s.kf || s.kf[0].t === 0) && plan.some(s => s.kf), plan.map(s => [s.in, s.out, s.kf ? s.kf.length : 0]));
  await page.click('#undoBtn'); await sleep(200);

  // ═════════ Echter Export ═════════
  const ex = await ev(async () => { P.settings.level = false; P.settings.burn = false; exFmt = 'video'; const plan = buildPlan(); plan.name = 'folgen-pruefung'; const id = TS.exportVideo(JSON.stringify(plan));
    for (;;){ await new Promise(r => setTimeout(r, 300)); const j = JSON.parse(TS.job(id)); if (j.status === 'done') return { ok: true, file: j.result.playable, files: j.result.files || [], w: plan.width, h: plan.height }; if (j.status === 'error') return { ok: false, error: j.error }; } });
  if (ex.ok){ for (const f of [ex.file, ...ex.files]) trash.push(f);
    const pos = [1, 5, 15, 22].map(t => figur(ex.file, t)), mid = [8, 10].map(t => figur(ex.file, t)), weg = figur(ex.file, 19);
    chk('Export im Hochformat: Die stehende Figur ist in der Bildmitte', ex.w < ex.h && pos.every(v => Math.abs(v - 0.5) <= 0.03), pos);
    chk('Export im Hochformat: Im Gang bleibt sie im Bild, in der Lücke ist niemand zu sehen', mid.every(v => v >= 0.47 && v <= 0.68) && weg === -1, { mid, weg });
  } else chk('Export im Hochformat läuft durch', false, ex.error);

  // ═════════ Verlauf, Ausschalten, Lage eines Clips ═════════
  await page.click('#undoBtn'); await sleep(250);
  const u1 = await ev(() => ({ on: !!(P.follow && P.follow.on), tr: !!P.sources[0].track, chk: document.querySelector('#clipFollow').checked })), p1 = await onCanvas([1]);
  await page.click('#redoBtn'); await sleep(250);
  const p2 = await onCanvas([1]);
  chk('„Rückgängig“ stellt den festen Ausschnitt wieder her, „Wiederholen“ das Folgen; die Lage der Person bleibt gemerkt', !u1.on && u1.tr && !u1.chk && p1[0] < 0.1 && Math.abs(p2[0] - 0.5) <= 0.025, { u1, p1, p2 });
  await follow(false);
  const aus = await onCanvas([1]);
  chk('Ausschalten: Der Ausschnitt steht wieder fest', aus[0] < 0.1 && /steht wieder fest/.test(await toast()), aus);
  await ev(() => document.querySelector('#clipFollow').click()); await sleep(400);
  chk('Erneut einschalten geht sofort, ohne die Aufnahme noch einmal auszuwerten', await ev(() => !!(P.follow && P.follow.on) && !document.querySelector('#foBox')));
  await ev(() => { const g = timeline.find(x => x.kind === 'main'); commit(() => { mainFxItem(g).fx.tx = 0.1; }, true); }); await sleep(300);
  const bias = await onCanvas([1, 15]);
  chk('Ein von Hand verschobener Clip behält seinen Versatz zusätzlich zum Folgen (Figur bei 60 %)', bias.every(v => Math.abs(v - 0.6) <= 0.03), bias);
  await page.click('#undoBtn'); await sleep(200);

  // ═════════ Formate ohne Spielraum ═════════
  await page.click('#clipFmt button[data-v="16:9"]'); await sleep(400);
  st = await ev(() => ({ ...followState(), info: document.querySelector('#clipFollowInfo').textContent, tf: V.style.transform, kf: buildPlan(true).segments[0].kf || null }));
  chk('Querformat: kein Spielraum – der Hinweis sagt es, Vorschau und Plan bleiben ohne Versatz', st.on && !st.room && /ganze Bild/.test(st.info) && !/translate/.test(st.tf) && !st.kf, { info: st.info, tf: st.tf });
  await page.click('#clipFmt button[data-v="1:1"]'); await sleep(400);
  const quad = await onCanvas([1, 15]);
  chk('Quadrat: Der Ausschnitt folgt auch hier', quad.every(v => Math.abs(v - 0.5) <= 0.03), quad);
  // hochkant aufgenommen, quer ausgegeben: Der Ausschnitt folgt senkrecht und hält Kopf und Schultern auf 40 % der Höhe
  const hoch = await ev(() => { const s = P.sources[0], w = s.width, h = s.height; s.width = h; s.height = w; const F = P.frame; P.format = '16:9'; P.frame = { sc: coverSc(), tx: 0, ty: 0 };
    const g = timeline.find(x => x.kind === 'main'), f = mainTot(g, 1), [, hf] = fitFracOf(s), y = Folgen.at(camOf(s), 1).y, r = { tx: f.tx, on: +(0.5 + f.ty + (y - 0.5) * f.sc * hf).toFixed(3), text: followState().text };
    s.width = w; s.height = h; P.format = '1:1'; P.frame = F; return r; });
  chk('Hochkant-Aufnahme im Querformat: Der Ausschnitt folgt nach oben und unten', hoch.tx === 0 && Math.abs(hoch.on - 0.4) <= 0.02 && /oben und unten/.test(hoch.text), hoch);
  await page.click('#clipFmt button[data-v="9:16"]'); await sleep(400);

  // ═════════ Speichern und Wiederöffnen ═════════
  await ev(() => { saveNow(); closeProject(); }); await sleep(300); await openById(page, id); await ev(() => setTab('clip')); await sleep(300);
  const re = await onCanvas([1, 15]);
  chk('Nach Schließen und Öffnen folgt der Ausschnitt weiter', await ev(() => !!(P.follow && P.follow.on) && document.querySelector('#clipFollow').checked) && re.every(v => Math.abs(v - 0.5) <= 0.025), re);

  // ═════════ Blatt „Leinwand“ im Studio ═════════
  await ev(() => { setTab('studio'); openCanvas(); }); await sleep(400);
  const cv = await ev(async () => { const b = document.querySelector('#canvasBox'), at = async t => { seekOut(t, false); await new Promise(r => setTimeout(r, 120)); return parseFloat(b.style.left); };
    return { row: !document.querySelector('#cvFollowRow').classList.contains('hidden'), chk: document.querySelector('#cvFollow').checked, info: document.querySelector('#cvFollowInfo').textContent, l1: await at(1), l15: await at(15), w: parseFloat(b.style.width), cls: b.classList.contains('follow') }; });
  chk('Leinwand: derselbe Schalter, und der Rahmen im Gesamtbild wandert mit der Figur (um 0,30 und um 0,70)', cv.row && cv.chk && /links und rechts/.test(cv.info) && cv.cls && Math.abs(cv.l1 + cv.w / 2 - 30) <= 2.5 && Math.abs(cv.l15 + cv.w / 2 - 70) <= 2.5, cv);
  await page.click('#cvFmt button[data-v=""]'); await sleep(300);
  chk('Leinwand im Originalformat: Der Schalter ist ausgeblendet', await ev(() => document.querySelector('#cvFollowRow').classList.contains('hidden')));
  await page.click('#undoBtn'); await sleep(300); await page.click('#cvOk').catch(() => {}); await sleep(300);
  await ev(() => { if (!document.querySelector('#sheet').classList.contains('hidden')) closeSheet(); setTab('clip'); }); await sleep(300);

  // ═════════ Abbruch, Fehler, keine Person ═════════
  await follow(false);
  await ev(() => { delete P.sources[0].track; });
  await ev(() => document.querySelector('#clipFollow').click()); await page.waitForSelector('#foStop'); await page.click('#foStop'); await sleep(1200);
  chk('Abbruch beim Auswerten: Blatt zu, Folgen bleibt aus, nichts gemerkt', await ev(() => !document.querySelector('#foBox') && !P.follow && !P.sources[0].track && !document.querySelector('#clipFollow').checked));
  const uri = await ev(() => P.sources[0].uri);
  await ev(() => { P.sources[0].uri = P.sources[0].uri.replace(/person\.mp4$/, 'gibt-es-nicht.mp4'); });
  await ev(() => document.querySelector('#clipFollow').click()); await page.waitForFunction(() => /fehlgeschlagen/.test(document.querySelector('#toast').textContent), null, { timeout: 30000 }).catch(() => {}); await sleep(300);
  chk('Fehlt die Datei, kommt eine Meldung und der Schalter bleibt aus', /fehlgeschlagen/.test(await toast()) && await ev(() => !P.follow && !document.querySelector('#clipFollow').checked), await toast());
  await ev(u => { P.sources[0].uri = u; }, uri);
  await ev(() => { P.sources[0].track = { step: 0.25, x: new Array(96).fill(-1), y: new Array(96).fill(-1) }; });
  await ev(() => document.querySelector('#clipFollow').click()); await sleep(500);
  const leer = await ev(() => ({ on: !!(P.follow && P.follow.on), info: document.querySelector('#clipFollowInfo').textContent, tf: V.style.transform, t: document.querySelector('#toast').textContent }));
  chk('War keine Person zu erkennen, sagt HoneyCut das, und der Ausschnitt bleibt stehen', leer.on && /keine Person zu erkennen/.test(leer.t) && /keine Person zu erkennen/.test(leer.info), leer);

  // ═════════ Rechenkern direkt ═════════
  const kern = await ev(() => {
    const W = 32, H = 18, mask = people => { const m = new Uint8Array(W * H); for (const p of people){ const cx = p.x * W, hw = (p.w || 0.12) * W / 2;
      for (let y = 4; y < H; y++) for (let x = 0; x < W; x++){ const d = Math.abs(x + 0.5 - cx), v = y < 7 ? (d <= hw * 0.5 ? 255 : 0) : d <= hw - 0.5 ? 255 : d <= hw + 0.5 ? Math.round(255 * (hw + 0.5 - d)) : 0; if (v) m[y * W + x] = Math.max(m[y * W + x], v); } } return m; };
    const build = (fn, n) => { const d = new Uint8Array(n * W * H); for (let k = 0; k < n; k++) d.set(mask(fn(k)), k * W * H); let bin = ''; for (const v of d) bin += String.fromCharCode(v); return { step: 0.5, w: W, h: H, n, data: btoa(bin) }; };
    const P1 = Folgen.path(Folgen.samples(build(k => [{ x: 0.4 + 0.008 * Math.sin(k * 1.7) }], 60)));
    const s2 = Folgen.samples(build(k => k >= 10 && k < 16 ? [] : k === 30 ? [{ x: 0.9 }] : [{ x: 0.5 }], 50)), P2 = Folgen.path(s2);
    const s3 = Folgen.samples(build(k => [{ x: 0.3, w: 0.16 }, { x: 0.75, w: k > 20 ? 0.2 : 0.1 }], 40));
    const s4 = Folgen.samples(build(k => [{ x: 0.25 + 0.5 * Math.min(1, Math.max(0, (k - 20) / 20)) }], 80)), P4 = Folgen.path(s4), keys = Folgen.keys(P4, 0, 39.5);
    let mono = true; for (let i = 1; i < 80; i++) if (P4.x[i] < P4.x[i - 1] - 1e-6) mono = false;
    return { jit: [Math.min(...P1.x), Math.max(...P1.x)], gap: s2.x.slice(9, 17), gapPath: [Math.min(...P2.x), Math.max(...P2.x)], two: [s3.x[0], s3.x[39]], walk: [P4.x[0], P4.x[79]], mono, keys: keys.length, first: keys[0], last: keys[keys.length - 1],
      none: Folgen.path(Folgen.samples(build(() => [], 10))), at: Folgen.at(P4, 15).x, short: Folgen.keys(P4, 3, 3.2).length };
  });
  chk('Kern: Zittern der Person bewegt die Kamera nicht', kern.jit[1] - kern.jit[0] < 1e-6 && Math.abs(kern.jit[0] - 0.4) < 0.02, kern.jit);
  chk('Kern: Lücken (niemand im Bild) und einzelne Ausreißer verändern den Weg nicht', kern.gap.slice(1, 7).every(v => v === -1) && kern.gapPath[1] - kern.gapPath[0] < 0.005, { gap: kern.gap, weg: kern.gapPath });
  chk('Kern: Bei zwei Menschen bleibt der Weg bei der Person, der er zuerst folgte', Math.abs(kern.two[0] - 300) <= 15 && Math.abs(kern.two[1] - 300) <= 15, kern.two);
  chk('Kern: Ein Gang ergibt eine stetige Fahrt vom Start zum Ziel mit wenigen Stützpunkten', Math.abs(kern.walk[0] - 0.25) < 0.02 && Math.abs(kern.walk[1] - 0.75) < 0.02 && kern.mono && kern.keys >= 4 && kern.keys <= 30 && kern.first === 0 && kern.last === 39.5 && kern.short === 2, { walk: kern.walk, keys: kern.keys });
  chk('Kern: Ohne Person entsteht kein Weg', kern.none === null);
} catch (e){ chk('Prüfung abgebrochen', false, String((e && e.stack) || e).replace(/\s+/g, ' ').slice(0, 500)); }

const echte = logs.filter(l => !/HTTP 404|gibt-es-nicht|HTTP 500: api\/job|Failed to load/.test(l));
chk('keine Fehlermeldungen der Seite', echte.length === 0, echte.slice(0, 6));
for (const id of made) await dropScratch(page, id).catch(() => {});
for (const f of trash) fs.rmSync(f, { force: true });
await ende(browser);
