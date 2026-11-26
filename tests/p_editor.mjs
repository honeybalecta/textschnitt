// Editor (2.53): Spuren per Ton synchronisieren, weiße Leinwand, Griffe an allen vier Ecken, Eigenschaften neben der Vorschau.
// Grundlage: kamera.mp4 (Ton mit Hall und Rauschen), mikrofon.wav (dasselbe Gespräch, 3,2 s früher gestartet), gespraech.mp4
// (dieselbe Szene als zweites Video), musik.wav (fremder Ton), siehe medien.py.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, newProject, setPick, dropScratch, sleep, pruefung, MEDIA, OUT } from './drv.mjs';
const { chk, ende } = pruefung('Editor');
const { browser, page, logs } = await launch({ viewport: { width: 1480, height: 900 }, dpr: 1 });
const ev = (f, a) => page.evaluate(f, a);
const shot = name => page.screenshot({ path: path.join(OUT, `editor-${name}.png`) });
const toast = () => ev(() => document.querySelector('#toast').textContent);
const rect = sel => ev(s => { const r = document.querySelector(s).getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height, r: r.right, b: r.bottom }; }, sel);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const made = [];
const place = async (file, type, at) => { setPick({ clip: [MEDIA + file] }); const m = await ev(() => pickMedia('clip')); return ev(([m, type, at]) => { placeMedia(m, type, at, null, false); return TL.sel.id; }, [m, type, at]); };
const item = id => ev(id => { const it = P.items.find(x => x.id === id); return it ? { at: it.at, in: it.in, out: it.out, x: it.x, y: it.y, w: it.w, vol: it.vol, start: objStart(it) } : null; }, id);
const setVal = (sel, v) => ev(([sel, v]) => { const el = document.querySelector(sel); if (el.type === 'checkbox') el.checked = v; else el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, v]);
const drag = async (from, dx, dy) => { await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x + dx / 2, from.y + dy / 2, { steps: 4 }); await page.mouse.move(from.x + dx, from.y + dy, { steps: 4 }); await page.mouse.up(); await sleep(250); };
const selIt = (id, kind = 'ovl') => ev(([id, kind]) => { const it = P.items.find(x => x.id === id); if (kind === 'ovl') seekOut(objStart(it) + 1, false); select({ kind, id }); seekOut(outPos, false); }, [id, kind]);
const selMain = o => ev(o => { seekOut(o, false); const i = segAtOut(o), g = timeline[i]; select({ kind: 'main', i, src: (g.in + g.out) / 2 }); seekOut(o, false); }, o);
const corner = c => ev(c => { const r = document.querySelector(`#pipBox .pip-h[data-c=${c}]`).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }, c);

try {
  const id = await newProject(page, [MEDIA + 'kamera.mp4']); made.push(id);
  await ev(() => setTab('studio')); await sleep(700);

  // ═════════ 1 · Spuren per Ton synchronisieren ═════════
  const mic = await place('mikrofon.wav', 'audio', 5); await sleep(300);
  const m0 = await item(mic);
  chk('Ausgangslage: Die Tonaufnahme liegt falsch (bei 5 s, ab ihrem Anfang)', near(m0.start, 5, 0.01) && m0.in === 0, m0);
  chk('Werkzeug „Per Ton synchronisieren“ steht bei der ausgewählten Tonspur', await ev(() => toolList().some(t => t.label === 'Per Ton synchronisieren')));
  const r1 = await ev(() => syncByAudio()); await sleep(300);
  const m1 = await item(mic), t1 = await toast();
  // Das Mikrofon lief 3,2 s vor der Kamera: Die Stelle 3,2 s der Tonaufnahme gehört an den Anfang des Videos
  chk('Tonspur am Ton der Hauptspur ausgerichtet: beginnt am Anfang des Videos, 3,2 s weiter in der Aufnahme', near(m1.start, 0, 0.005) && near(m1.in, 3.2, 0.03), m1);
  chk('Genauigkeit: Abweichung höchstens 15 ms', Math.abs(m1.in - 3.2) <= 0.015, { in: m1.in, ms: Math.round((m1.in - 3.2) * 1000) });
  chk('Die Meldung nennt Clip und Verschiebung', /mikrofon\.wav/.test(t1) && /per Ton ausgerichtet/.test(t1) && /−8,2\d s/.test(t1), t1);
  chk('Ergebnis: ein Clip verschoben, keiner ohne Ergebnis', r1 && r1.moved.length === 1 && r1.fails.length === 0 && r1.moved[0].score >= 8, r1);
  const r1b = await ev(() => syncByAudio()); await sleep(200);
  chk('Zweiter Lauf ändert nichts mehr („liegt schon genau richtig“)', r1b.moved.length === 0 && /schon genau richtig/.test(await toast()) && (await item(mic)).in === m1.in, await toast());
  await page.click('#undoBtn'); await sleep(300);
  chk('„Rückgängig“ legt die Tonspur wieder an die alte Stelle', near((await item(mic)).start, 5, 0.01) && (await item(mic)).in === 0);
  await page.click('#redoBtn'); await sleep(300);

  // zweites Video derselben Szene auf einer Videospur, absichtlich verschoben; fremde Musik dazu
  await ev(() => { TL.sel = null; seekOut(12, false); });
  const cam2 = await place('gespraech.mp4', 'pip', 12); await sleep(400);
  const mus = await place('musik.wav', 'audio', 20); await sleep(300);
  const c0 = await item(cam2), u0 = await item(mus);
  chk('Menü „Bearbeiten“ nennt „Spuren per Ton synchronisieren“', await ev(() => barMenu('edit').some(t => t.label === 'Spuren per Ton synchronisieren')));
  const r2 = await ev(() => syncByAudio(true)); await sleep(400);
  const c1 = await item(cam2), u1 = await item(mus), t2 = await toast();
  chk('Alle Spuren: Das zweite Video liegt danach deckungsgleich auf der Hauptspur', near(c1.start - c1.in, 0, 0.03) && near(c0.start, 12, 0.01), { vorher: c0, nachher: c1 });
  chk('Alle Spuren: Die fremde Musik bleibt liegen und wird als „ohne passende Stelle“ gemeldet', u1.at === u0.at && u1.in === u0.in && r2.fails.length === 1 && r2.fails[0].id === mus && /keine passende Stelle/.test(t2), t2);
  chk('Alle Spuren: Die schon ausgerichtete Tonspur bleibt unverändert', (await item(mic)).in === m1.in && r2.moved.length === 1 && r2.moved[0].id === cam2, r2);
  // Stelle herausgeschnitten: Der Clip beginnt an der nächsten behaltenen Stelle
  await ev(() => { commit(() => { P.dels.push([0, 4]); }, true); }); await sleep(300);
  await ev(id => { const it = P.items.find(x => x.id === id); it.at = 30; it.in = 0; changed(true); select({ kind: 'aud', id }); }, mic); await sleep(200);
  await ev(() => syncByAudio()); await sleep(300);
  const m2 = await item(mic);
  chk('Ist der Anfang des Videos herausgeschnitten, beginnt die Tonspur an der ersten behaltenen Stelle – passend weiter in der Aufnahme', near(m2.at, 4, 0.005) && near(m2.in, 7.2, 0.03) && near(m2.start, 0, 0.005), m2);
  await ev(() => { commit(() => { P.dels = []; }, true); }); await sleep(200);
  // Zwei Clips, die zueinander gehören, über einer Hauptspur mit anderem Inhalt: Sie richten sich aneinander aus
  await ev(() => { saveNow(); closeProject(); }); await sleep(300);
  const idB = await newProject(page, [MEDIA + 'serie.mp4']); made.push(idB); await ev(() => setTab('studio')); await sleep(700);
  const camB = await place('kamera.mp4', 'pip', 2); await sleep(300); const micB = await place('mikrofon.wav', 'audio', 6); await sleep(300);
  const rB = await ev(() => syncByAudio(true)); await sleep(300);
  const cB = await item(camB), mB = await item(micB);
  chk('Hauptspur mit anderem Ton: Tonaufnahme und Video auf den Spuren richten sich aneinander aus (das Video bleibt liegen)', near(cB.start, 2, 0.01) && cB.in === 0 && near(mB.start - mB.in, cB.start - 3.2, 0.03) && rB.moved.length === 1 && rB.moved[0].id === micB && rB.fails.length === 0, { cB, mB, rB });
  await ev(() => { saveNow(); closeProject(); }); await sleep(300); await ev(i => openProject(i), id); await page.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i, id); await ev(() => setTab('studio')); await sleep(700);
  const k = await ev(() => { const mk = (n, f) => Uint8Array.from({ length: n }, (_, i) => f(i)); let s = 5; const rnd = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    let v = 120; const A = mk(30000, () => { if (rnd() < 0.08) v = 90 + rnd() * 140; return Math.round(v + rnd() * 8); }), B = A.slice(4321, 12000), F = mk(8000, () => { if (rnd() < 0.08) v = 90 + rnd() * 140; return Math.round(v); });
    const t0 = performance.now(), m = TonSync.measure(A, B), ms = performance.now() - t0, f = TonSync.measure(A, F);
    return { m, ms, ok: TonSync.ok(m), fremd: TonSync.ok(f), kurz: TonSync.measure(A.slice(0, 50), B) }; });
  chk('Kern: Versatz auf 10 ms genau, fremder Ton abgelehnt, unter einer Sekunde Ton kein Ergebnis', k.ok && near(k.m.offset, 43.21, 0.005) && !k.fremd && k.kurz === null && k.ms < 3000, k);

  // ═════════ 2 · Leinwand weiß ═════════
  const bg = await ev(() => { const c = s => getComputedStyle(document.querySelector(s)).backgroundColor; const studio = [c('#stage'), c('.stage-wrap')]; setTab('text'); const text = c('#stage'); setTab('studio'); return { studio, text }; }); await sleep(600);
  chk('Im Studio ist die Leinwand weiß, die Umgebung dunkel; im Text-Reiter bleibt das Bild schwarz hinterlegt', bg.studio[0] === 'rgb(255, 255, 255)' && bg.studio[1] !== 'rgb(255, 255, 255)' && bg.text === 'rgb(0, 0, 0)', bg);

  // ═════════ 3 · Griffe an allen vier Ecken ═════════
  await selIt(cam2); await sleep(500);
  chk('Der Rahmen des ausgewählten Videos hat vier Griffe', await ev(() => !document.querySelector('#pipBox').classList.contains('hidden') && document.querySelectorAll('#pipBox .pip-h').length === 4));
  await page.hover('#pipBox'); await sleep(200);
  let b0 = await rect('#pipBox');
  await drag(await corner('nw'), -60, -30);
  let b1 = await rect('#pipBox');
  chk('Ecke oben links ziehen: größer, die Ecke unten rechts bleibt stehen, Seitenverhältnis bleibt', b1.w > b0.w + 40 && near(b1.r, b0.r, 2) && near(b1.b, b0.b, 2) && near(b1.w / b1.h, b0.w / b0.h, 0.02), { b0, b1 });
  await drag(await corner('sw'), 40, -20);
  let b2 = await rect('#pipBox');
  chk('Ecke unten links ziehen: kleiner, die Ecke oben rechts bleibt stehen', b2.w < b1.w - 25 && near(b2.r, b1.r, 2) && near(b2.y, b1.y, 2), { b1, b2 });
  await drag(await corner('ne'), -30, 20);
  let b3 = await rect('#pipBox');
  chk('Ecke oben rechts ziehen: die Ecke unten links bleibt stehen', b3.w < b2.w - 15 && near(b3.x, b2.x, 2) && near(b3.b, b2.b, 2), { b2, b3 });
  await drag(await corner('se'), 50, 30);
  let b4 = await rect('#pipBox');
  chk('Ecke unten rechts ziehen (wie bisher): die Ecke oben links bleibt stehen', b4.w > b3.w + 35 && near(b4.x, b3.x, 2) && near(b4.y, b3.y, 2), { b3, b4 });
  await shot('ecken');
  // Hauptspur: jede Ecke skaliert um die Bildmitte
  await selMain(40); await sleep(500);
  const h0 = await rect('#pipBox');
  await page.hover('#pipBox'); await sleep(150);
  await drag(await corner('nw'), 80, 45);
  const h1 = await rect('#pipBox'), sc1 = await ev(() => mainFx().sc);
  chk('Hauptspur, Ecke oben links nach innen: Das Bild wird kleiner und bleibt in der Mitte', sc1 < 0.9 && h1.w < h0.w - 100 && near(h1.x + h1.w / 2, h0.x + h0.w / 2, 2) && near(h1.y + h1.h / 2, h0.y + h0.h / 2, 2), { h0, h1, sc1 });
  const px = await ev(() => { const st = document.querySelector('#stage').getBoundingClientRect(), v = document.querySelector('#stage video').getBoundingClientRect(); return { frei: v.left - st.left, bg: getComputedStyle(document.querySelector('#stage')).backgroundColor }; });
  chk('Um das verkleinerte Video herum ist die weiße Leinwand zu sehen', px.frei > 20 && px.bg === 'rgb(255, 255, 255)', px);
  await shot('leinwand');

  // ═════════ 4 · Eigenschaften neben der Vorschau ═════════
  const lay = await ev(() => { const r = s => document.querySelector(s).getBoundingClientRect(), p = r('#props'), w = r('.stage-wrap'), t = r('.transport'), tl = r('#paneStudio');
    return { shown: getComputedStyle(document.querySelector('#props')).display !== 'none', left: p.left, wrapR: w.right, top: p.top, wrapT: w.top, bottom: p.bottom, trB: t.bottom, tlT: tl.top, w: p.width, vw: innerWidth }; });
  chk('Das Feld steht rechts neben der Vorschau, von der Oberkante des Bildes bis zur Zeitleiste', lay.shown && near(lay.left, lay.wrapR, 1.5) && near(lay.top, lay.wrapT, 1.5) && near(lay.bottom, lay.trB, 1.5) && lay.bottom <= lay.tlT + 1.5 && lay.w >= 300 && near(lay.left + lay.w, lay.vw, 1.5), lay);
  const pm = await ev(() => ({ title: document.querySelector('#prTitle').textContent, tabs: [...document.querySelectorAll('#prTabs button')].map(b => b.textContent), on: document.querySelector('#prTabs .on').textContent, size: +document.querySelector('#prSizeN').value, sc: mainFx().sc,
    felder: ['prSize', 'prSizeN', 'prX', 'prY', 'prBr', 'prCo', 'prSa', 'prGray'].every(i => { const el = document.querySelector('#' + i); return el && el.getBoundingClientRect().height > 0; }) }));
  chk('Clip der Hauptspur: Reiter Bild · Farbe · Ton & Tempo · Werkzeuge; Größe, Position und Filter sind direkt sichtbar', pm.title === 'Clip' && pm.tabs.join('|') === 'Bild|Farbe|Ton & Tempo|Werkzeuge' && pm.on === 'Bild' && pm.felder && near(pm.size, pm.sc * 100, 0.06), pm);
  await setVal('#prSizeN', 80); await setVal('#prX', 10); await setVal('#prY', -5); await sleep(300);
  const g1 = await ev(() => ({ f: mainFx(), tr: document.querySelector('#stage video').style.transform, range: +document.querySelector('#prSize').value }));
  chk('Größe und Position als Zahl: Das Bild folgt sofort (80 %, 10 % nach rechts, 5 % nach oben)', near(g1.f.sc, 0.8, 0.001) && near(g1.f.tx, 0.1, 0.001) && near(g1.f.ty, -0.05, 0.001) && /scale\(0\.8/.test(g1.tr) && g1.range === 80, g1);
  await page.click('#prBody [data-pa=fill]'); await sleep(300);
  const g2 = await ev(() => { const [wf, hf] = mainFit(); return { f: mainFx(), want: Math.max(1 / wf, 1 / hf) }; });
  chk('„Füllen“ setzt das Bild formatfüllend in die Mitte, „Einpassen“ zurück auf 100 %', near(g2.f.sc, g2.want, 0.002) && g2.f.tx === 0 && g2.f.ty === 0 && await (async () => { await page.click('#prBody [data-pa=fit]'); await sleep(250); return ev(() => mainFx().sc === 1); })(), g2);
  await setVal('#prBr', 0.2); await setVal('#prSa', -40); await sleep(300);
  const f1 = await ev(() => { const g = timeline[TL.sel.i]; return { fx: { b: g.fx.bright, s: g.fx.sat }, css: document.querySelector('#stage video').style.filter, v: document.querySelector('#prBrV').textContent, items: P.items.filter(x => x.type === 'fx').length }; });
  chk('Filter: Helligkeit und Sättigung wirken sofort im Bild und stehen in der Anpassung des Clips', f1.fx.b === 0.2 && f1.fx.s === -40 && /brightness|saturate/.test(f1.css) && f1.v === '20' && f1.items === 1, f1);
  await page.click('#undoBtn'); await sleep(250);
  chk('Jede Änderung im Feld ist ein Schritt für „Rückgängig“', await ev(() => { const g = timeline[TL.sel.i]; return g.fx.bright === 0.2 && !g.fx.sat && +document.querySelector('#prSa').value === 0; }));
  await page.click('#prBody [data-pa=nofilter]'); await sleep(250);
  chk('„Zurücksetzen“ nimmt die Filter heraus', await ev(() => { const g = timeline[TL.sel.i]; return !g.fx.bright && !g.fx.sat && document.querySelector('#stage video').style.filter.replace('none', '') === ''; }));
  await page.click('#prTabs [data-pt=ton]'); await sleep(200);
  await setVal('#prVol', 60); await sleep(200);
  chk('Reiter „Ton & Tempo“: Lautstärke des Clips, Tempo wählbar', await ev(() => Math.abs(timeline[TL.sel.i].fx.vol - 0.6) < 0.001 && document.querySelector('#prVolV').textContent === '60 %' && document.querySelectorAll('#prSpeed button').length === 7 && document.querySelector('#prSpeed .on').dataset.v === '1'));
  await page.click('#prTabs [data-pt=farbe]'); await sleep(200);
  chk('Reiter „Farbe“: Farbtemperatur, Tönung und Farb-Vorlagen', await ev(() => !!document.querySelector('#prBody .wb-temp') && !!document.querySelector('#prBody .wb-tint') && document.querySelectorAll('#prBody .look-chip').length >= 2));
  await page.click('#prTabs [data-pt=mehr]'); await sleep(200);
  const tl1 = await ev(() => ({ a: [...document.querySelectorAll('#prBody .pr-tool')].map(b => b.textContent.trim()), b: toolList().map(t => t.label) }));
  chk('Reiter „Werkzeuge“: alles aus der Leiste unter den Spuren', tl1.a.length >= 10 && tl1.a.join('|') === tl1.b.join('|'), tl1.a);
  await page.click('#prTabs [data-pt=bild]'); await sleep(150);
  // Video auf einer Videospur
  await selIt(cam2); await sleep(500);
  const po = await ev(id => { const it = P.items.find(x => x.id === id); return { title: document.querySelector('#prTitle').textContent, sub: document.querySelector('#prSub').textContent, tabs: [...document.querySelectorAll('#prTabs button')].map(b => b.textContent), size: +document.querySelector('#prSizeN').value, w: it.w, x: +document.querySelector('#prX').value, ix: it.x }; }, cam2);
  chk('Video auf einer Videospur: Reiter Bild · Farbe · Ton · Werkzeuge, Werte aus dem Element', po.title === 'Einblendung' && /gespraech\.mp4/.test(po.sub) && po.tabs.join('|') === 'Bild|Farbe|Ton|Werkzeuge' && near(po.size, po.w * 100, 0.06) && near(po.x, (po.ix - 0.5) * 100, 0.06), po);
  await setVal('#prSizeN', 50); await sleep(200); await page.click('#prBody [data-pa=mid]'); await sleep(300);
  const o1 = await item(cam2), bx = await rect('#pipBox'), stg = await rect('#stage');
  chk('Größe 50 % und „Mitte“: Das Element ist halb so breit wie das Bild und steht mittig – Rahmen im Bild und Feld stimmen überein', near(o1.w, 0.5, 0.001) && o1.x === 0.5 && o1.y === 0.5 && near(bx.w, stg.w / 2, 2) && near(bx.x + bx.w / 2, stg.x + stg.w / 2, 2), { o1, bx, stg });
  await page.hover('#pipBox'); await drag(await corner('se'), 40, 20); await sleep(200);
  const o2 = await item(cam2);
  chk('Umgekehrt: Nach dem Ziehen an einer Ecke zeigt das Feld die neue Größe', o2.w > 0.52 && near(await ev(() => +document.querySelector('#prSizeN').value), o2.w * 100, 0.06), o2);
  await page.click('#prTabs [data-pt=ton]'); await sleep(150); await setVal('#prVol', 80); await sleep(200);
  chk('Reiter „Ton“ am Video der Videospur: Lautstärke und „Per Ton synchronisieren“', (await item(cam2)).vol === 0.8 && await ev(() => !!document.querySelector('#prBody [data-pa=sync]')));
  await shot('eigenschaften');
  // ═════════ 5 · Filter für Videos auf den Videospuren (2.54) ═════════
  await page.click('#prTabs [data-pt=bild]'); await sleep(200);
  await ev(id => { const it = P.items.find(x => x.id === id); it.w = 0.5; it.x = 0.5; it.y = 0.5; delete it.kf; changed(true); seekOut(outPos, false); }, cam2); await sleep(300);
  chk('Auch am Video der Videospur stehen die Filter direkt im Reiter „Bild“', await ev(() => ['prBr', 'prCo', 'prSa', 'prGray'].every(i => { const el = document.querySelector('#' + i); return el && el.getBoundingClientRect().height > 0; })));
  await setVal('#prBr', 0.1); await setVal('#prGray', true); await sleep(300);
  const oc = await ev(id => { const it = P.items.find(x => x.id === id), el = layers.get(id); exFmt = 'video'; const o = buildPlan(true).overlays.find(q => q.uri === it.clip.uri);
    return { col: it.col, css: el.style.filter, main: document.querySelector('#stage video#v, #stage video').style.filter, plan: o && { b: o.bright, g: o.gray, c: o.contrast, s: o.sat } }; }, cam2);
  chk('Helligkeit und Schwarzweiß wirken sofort am Element (nicht an der Hauptspur) und stehen im Exportplan', oc.col && oc.col.bright === 0.1 && oc.col.gray === true && /brightness\(1\.1/.test(oc.css) && /grayscale/.test(oc.css) && !/grayscale/.test(oc.main || '') && oc.plan && oc.plan.b === 0.1 && oc.plan.g === true, oc);
  await page.click('#prTabs [data-pt=farbe]'); await sleep(200);
  await setVal('#prBody .wb-temp', 40); await sleep(250);
  const ow = await ev(id => { const it = P.items.find(x => x.id === id); exFmt = 'video'; const o = buildPlan(true).overlays.find(q => q.uri === it.clip.uri); return { temp: it.col.temp, wb: o.wb, pick: !!document.querySelector('#prBody .cPick'), looks: document.querySelectorAll('#prBody .look-chip').length }; }, cam2);
  chk('Reiter „Farbe“ am Element: Farbtemperatur landet als Weißabgleich im Plan (Rot verstärkt, Blau gesenkt), Farb-Vorlagen vorhanden', ow.temp === 40 && ow.wb && ow.wb[0] > 1.05 && ow.wb[2] < 0.95 && !ow.pick && ow.looks >= 2, ow);
  await page.click('#undoBtn'); await sleep(250);
  chk('„Rückgängig“ nimmt die Farbtemperatur zurück, Helligkeit und Schwarzweiß bleiben', await ev(id => { const c = P.items.find(x => x.id === id).col; return c && !c.temp && c.gray === true && c.bright === 0.1; }, cam2));
  // echter Export über ffmpeg (wie in der Windows-App): Das Element ist grau, die Hauptspur daneben bleibt farbig
  const ex = await ev(async () => { P.settings.level = false; P.settings.burn = false; exFmt = 'video'; const plan = buildPlan(); plan.name = 'editor-filter';
    const id = TS.exportVideo(JSON.stringify(plan)); for (;;){ await new Promise(r => setTimeout(r, 300)); const j = JSON.parse(TS.job(id)); if (j.status === 'done') return { ok: true, file: j.result.playable, files: j.result.files || [] }; if (j.status === 'error') return { ok: false, error: j.error }; } });
  if (ex.ok){
    const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', '1', '-i', ex.file, '-an', '-vf', 'scale=320:180', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 22 });
    const at = (x, y) => { const i = (Math.round(y * 180) * 320 + Math.round(x * 320)) * 3; return [raw[i], raw[i + 1], raw[i + 2]]; }, spread = c => Math.max(...c) - Math.min(...c);
    const innen = [at(0.4, 0.5), at(0.5, 0.45), at(0.6, 0.55)], aussen = [at(0.1, 0.8), at(0.9, 0.8), at(0.12, 0.5)];
    chk('Export: Das Video auf der Videospur ist schwarzweiß, die Hauptspur daneben bleibt farbig', innen.every(c => spread(c) <= 14) && aussen.filter(c => spread(c) >= 80).length >= 2, { innen, aussen });
    for (const f of [ex.file, ...ex.files]) try { fs.rmSync(f, { force: true }); } catch (_){}
  } else chk('Export mit Filter am Element', false, ex.error);
  await page.click('#prTabs [data-pt=bild]'); await sleep(150); await page.click('#prBody [data-pa=nofilter]'); await sleep(250);
  chk('„Zurücksetzen“ nimmt die Filter des Elements heraus (Vorschau und Plan)', await ev(id => { const it = P.items.find(x => x.id === id); exFmt = 'video'; const o = buildPlan(true).overlays.find(q => q.uri === it.clip.uri); return !it.col && layers.get(id).style.filter === '' && !('bright' in o) && !('gray' in o); }, cam2));
  // Dialog „Größe, Lage, Ton“ (Weg für schmale Fenster und das Handy)
  await ev(id => openItem(id), cam2); await sleep(400);
  const dl = await ev(() => { const d = document.querySelector('#sheet .it-col'); return { da: !!d && !d.classList.contains('hidden'), regler: d ? d.querySelectorAll('.cR').length : 0 }; });
  await ev(() => { const d = document.querySelector('#sheet .it-col'); d.open = true; const r = d.querySelector('.cR[data-k=sat]'); r.value = -60; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(250);
  chk('Im Dialog des Elements steht „Farbe und Filter“ mit denselben Reglern', dl.da && dl.regler === 5 && await ev(id => { const it = P.items.find(x => x.id === id); return it.col && it.col.sat === -60 && /saturate\(0\.4/.test(layers.get(id).style.filter); }, cam2), dl);
  await ev(id => { closeSheet(); const it = P.items.find(x => x.id === id); delete it.col; changed(true); }, cam2); await sleep(200);
  // ohne Auswahl
  await ev(() => { select(null); seekOut(30, false); }); await sleep(400);
  const pn = await ev(() => ({ title: document.querySelector('#prTitle').textContent, tabs: [...document.querySelectorAll('#prTabs button')].map(b => b.textContent), tools: document.querySelector('#tools').classList.contains('none') }));
  chk('Ohne Auswahl gilt das Feld dem Clip an der Abspiellinie', pn.title === 'Clip an der Abspiellinie' && pn.tabs[0] === 'Bild' && pn.tools, pn);
  await setVal('#prSizeN', 120); await sleep(250);
  chk('… und ändert ihn auch ohne Auswahl', await ev(() => Math.abs(mainFxAt(timeline[curSeg], outToSrcT(outPos)).sc - 1.2) < 0.001 && /scale\(1\.2/.test(document.querySelector('#stage video').style.transform)));
  // schmales Fenster: Feld ausgeblendet, Leiste unter den Spuren bleibt
  await page.setViewportSize({ width: 900, height: 800 }); await sleep(700);
  await selIt(cam2); await sleep(300);
  chk('Schmales Fenster: Das Feld ist ausgeblendet, die Werkzeuge stehen weiter unter den Spuren', await ev(() => getComputedStyle(document.querySelector('#props')).display === 'none' && document.querySelectorAll('#tools .tool').length >= 5));
  await page.setViewportSize({ width: 1480, height: 900 }); await sleep(500);
  // Export unverändert: freie Ränder bleiben schwarz – der Plan kennt keine Hintergrundfarbe
  chk('Der Exportplan bleibt, wie er war (keine neue Hintergrundfarbe)', await ev(() => { exFmt = 'video'; const p = buildPlan(true); return !('bg' in p) && !('background' in p); }));
} catch (e){ chk('Prüfung abgebrochen', false, String((e && e.stack) || e).replace(/\s+/g, ' ').slice(0, 600)); }

chk('keine Fehlermeldungen der Seite', logs.length === 0, logs.slice(0, 6));
for (const id of made) await dropScratch(page, id).catch(() => {});
await ende(browser);
