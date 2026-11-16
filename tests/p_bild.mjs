// Bildgestaltung (2.36): Farbe für das ganze Video und je Abschnitt mit Weißabgleich, Pipette, Angleichen und Farb-Vorlagen (E9),
// Zoom-Schnitte (E4), Standbild und Tempo-Verlauf (E7), Hintergründe fürs Freistellen (E12), Bild beruhigen (E11) –
// in der Oberfläche, im Exportplan und in echten Exporten.
// Grundlage: das Testprojekt „kurz“ (Schnitte, Zeitleiste), gruen.mp4 (Greenscreen mit einem Feld in der Mitte: erst mit warmem
// Farbstich, ab 5 s neutral grau) und wackel.mp4 (ein stehendes Wolkenmuster mit wanderndem Ausschnitt), siehe medien.py.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, ids, scratch, dropScratch, newProject, setPick, sleep, pruefung, MEDIA, OUT } from './drv.mjs';
const { chk, ende } = pruefung('Bildgestaltung');
const { browser, page, logs } = await launch();
const ev = (f, a) => page.evaluate(f, a);
const shot = (name, pg = page) => pg.screenshot({ path: path.join(OUT, `bild-${name}.png`) });
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const nah = (a, b, tol = 8) => !!a && [0, 1, 2].every(i => Math.abs(a[i] - b[i]) <= tol);
const toastTxt = (pg = page) => pg.evaluate(() => document.querySelector('#toast').textContent);
const tools = (pg = page) => pg.evaluate(() => [...document.querySelectorAll('#tools .tool')].map(b => b.textContent.trim()));
const made = [], trash = new Set();
const W = 640, H = 360;
// Echter Export des offenen Projekts über das Test-Backend (ffmpeg wie in der Windows-App)
const exportNow = async name => {
  const r = await ev(async name => {
    P.settings.level = false; P.settings.burn = false; exFmt = 'video'; const plan = buildPlan(); plan.name = name;
    const id = TS.exportVideo(JSON.stringify(plan));
    for (;;){ await new Promise(r => setTimeout(r, 200)); const j = JSON.parse(TS.job(id));
      if (j.status === 'done') return { ok: true, file: j.result.playable, files: j.result.files || [], plan };
      if (j.status === 'error') return { ok: false, error: j.error, plan }; } }, name);
  for (const f of [r.file, ...(r.files || [])]) if (f) trash.add(f);
  return r;
};
const frame = (file, n) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-an', '-vf', `select=eq(n\\,${n}),scale=${W}:${H}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 24 });
const px = (f, x, y) => { const s = [0, 0, 0]; for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) for (let c = 0; c < 3; c++) s[c] += f[((y + j) * W + x + i) * 3 + c]; return s.map(v => Math.round(v / 25)); };
const dauer = file => +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim();
const slide = (sel, v, pg = page) => pg.evaluate(([sel, v]) => { const r = document.querySelector(sel); r.value = v; r.dispatchEvent(new Event('input', { bubbles: true })); r.dispatchEvent(new Event('change', { bubbles: true })); }, [sel, v]);
const gains = fx => ev(fx => wbGains(fx), fx);

try {
  // ═════════ Farbe (E9) ═════════
  let id = await scratch(page, ids().kurz); made.push(id);
  await ev(() => { localStorage.removeItem('hc-color-looks'); colorLooks = []; setTab('studio'); }); await sleep(500);
  // drei Schnitte: vier Abschnitte mit Bildsprung dazwischen
  await ev(() => { commit(() => { addDel(10, 12); addDel(20, 23); addDel(30, 31); addDel(40, 180); }, true); TL.sel = null; renderTimeline(); seekOut(2, false); }); await sleep(500);
  const tl0 = await ev(() => timeline.map(g => [g.kind, g.in, g.out]));
  let t = await tools();
  chk('ohne Auswahl stehen „Standbild“, „Zoom-Schnitte“ und „Farbe“ in der Werkzeugleiste', ['Standbild', 'Zoom-Schnitte', 'Farbe'].every(x => t.includes(x)), t);
  chk('das Testprojekt hat vier Abschnitte', tl0.length === 4 && tl0.every(g => g[0] === 'main'), tl0);

  await ev(() => openColorAll()); await sleep(250);
  let st = await ev(() => ({ open: !document.querySelector('#sheet').classList.contains('hidden'), h: document.querySelector('#sheetBody h3').textContent, sl: [...document.querySelectorAll('#caHost .cR')].map(r => r.dataset.k).join(), looks: [...document.querySelectorAll('#caHost .clooks [data-cl]')].map(b => b.textContent.trim()), undo: undo.length }));
  chk('„Farbe“ öffnet das Blatt für das ganze Video: fünf Regler, Schwarzweiß, sechs Vorlagen und „+ Speichern“', st.open && /ganze Video/.test(st.h) && st.sl === 'bright,contrast,sat,temp,tint' && st.looks.join() === 'Neutral,Warm,Kühl,Kräftig,Matt,Schwarzweiß,+ Speichern', st);
  await slide('#caHost .cR[data-k="temp"]', 40); await sleep(250);
  let g40 = await gains({ temp: 40 });
  let c = await ev(() => ({ co: P.color, flt: V.style.filter, mat: (document.querySelector('#hcWbSvg feColorMatrix') || { getAttribute(){ return ''; } }).getAttribute('values'), lab: document.querySelector('#caHost .cV[data-k="temp"]').textContent, wb: buildPlan(true).segments.map(s => s.wb), fx: timeline.map(g => [g.fx.temp, !!g.fx.cb]) }));
  chk('Farbtemperatur 40: steht im Projekt, die Vorschau trägt einen Farbfilter, alle Abschnitte des Plans denselben Weißabgleich', c.co && c.co.temp === 40 && /url\("?#hcWb\d+"?\)/.test(c.flt) && c.lab === 'warm 40' && c.wb.length === 4 && c.wb.every(w => JSON.stringify(w) === JSON.stringify(g40)) && c.fx.every(f => f[0] === 40 && f[1]), c);
  chk('Weißabgleich: Rot stärker, Blau schwächer, die Helligkeit bleibt (Summe der gewichteten Kanäle = 1)', g40[0] > 1.1 && g40[2] < 0.9 && near(0.2126 * g40[0] + 0.7152 * g40[1] + 0.0722 * g40[2], 1, 0.001) && c.mat.startsWith(`${g40[0]} 0 0 0 0 0 ${g40[1]} 0 0 0 0 0 ${g40[2]}`), [g40, c.mat]);
  await slide('#caHost .cR[data-k="tint"]', -30); await sleep(250);
  const gt = await gains({ temp: 40, tint: -30 });
  chk('Tönung nach Grün: Grün gewinnt gegenüber Rot und Blau', gt[1] / gt[0] > g40[1] / g40[0] && gt[1] / gt[2] > g40[1] / g40[2] && (await ev(() => document.querySelector('#caHost .cV[data-k="tint"]').textContent)) === 'grün 30', gt);
  const u1 = await ev(() => { document.querySelector('#undoBtn').click(); return [P.color || null, V.style.filter]; });
  chk('Rückgängig nimmt die Züge an den Reglern in einem Schritt zurück', u1[0] === null && u1[1] === '', u1);
  await ev(() => { document.querySelector('#redoBtn').click(); }); await sleep(200);
  chk('Wiederholen bringt sie zurück', JSON.stringify(await ev(() => P.color)) === '{"temp":40,"tint":-30}');
  await ev(() => document.querySelector('#caHost [data-cl="kraeftig"]').click()); await sleep(250);
  c = await ev(() => ({ co: P.color, on: [...document.querySelectorAll('#caHost .look-chip.on')].map(x => x.textContent.trim()), flt: V.style.filter, seg: (({ contrast, sat, wb }) => ({ contrast, sat, wb }))(buildPlan(true).segments[0]) }));
  chk('Vorlage „Kräftig“ ersetzt die Farbwerte: mehr Kontrast und Sättigung, kein Weißabgleich', JSON.stringify(c.co) === '{"contrast":0.12,"sat":24}' && c.on.join() === 'Kräftig' && c.flt === 'contrast(1.12) saturate(1.24)' && c.seg.contrast === 0.12 && c.seg.sat === 24 && !c.seg.wb, c);
  // eigene Vorlage speichern, anwenden, löschen
  await slide('#caHost .cR[data-k="temp"]', -18); await sleep(200);
  await ev(() => document.querySelector('#caHost [data-cl="+"]').click()); await sleep(250);
  await ev(() => { document.querySelector('#nmIn').value = 'Studio kühl'; document.querySelector('#nmOk').click(); }); await sleep(300);
  let lk = await ev(() => ({ ls: JSON.parse(localStorage.getItem('hc-color-looks') || '[]').map(l => [l.name, l.v]), chips: [...document.querySelectorAll('#caHost .clooks [data-cl^="own:"]')].map(x => [x.querySelector('b').textContent, x.classList.contains('on')]), toast: document.querySelector('#toast').textContent, pref: uiPrefs()['hc-color-looks'] ? 1 : 0 }));
  chk('„+ Speichern“ legt eine eigene Farb-Vorlage auf dem Gerät ab; sie reist mit der Sicherung', lk.ls.length === 1 && lk.ls[0][0] === 'Studio kühl' && JSON.stringify(lk.ls[0][1]) === '{"contrast":0.12,"sat":24,"temp":-18}' && lk.chips.length === 1 && lk.chips[0][1] && /gespeichert/.test(lk.toast) && lk.pref === 1, lk);
  await ev(() => document.querySelector('#caHost [data-cl="neutral"]').click()); await sleep(200);
  const neu = await ev(() => [P.color || null, V.style.filter]);
  await ev(() => document.querySelector('#caHost .clooks [data-cl^="own:"] b').click()); await sleep(200);
  const own = await ev(() => P.color);
  chk('„Neutral“ nimmt alles zurück, die eigene Vorlage bringt ihre Werte wieder', neu[0] === null && neu[1] === '' && JSON.stringify(own) === '{"contrast":0.12,"sat":24,"temp":-18}', [neu, own]);
  await ev(() => document.querySelector('#caHost .clooks [data-del]').click()); await sleep(200);
  chk('eine eigene Vorlage lässt sich löschen', (await ev(() => [JSON.parse(localStorage.getItem('hc-color-looks') || '[]').length, document.querySelectorAll('#caHost .clooks [data-cl^="own:"]').length])).join() === '0,0');
  await shot('farbe-ganzes-video');
  // Abschnitt: eigene Werte kommen hinzu
  await ev(() => { document.querySelector('#caHost [data-cl="neutral"]').click(); }); await slide('#caHost .cR[data-k="temp"]', 20); await ev(() => document.querySelector('#caOk').click()); await sleep(200);
  await ev(() => { TL.sel = { kind: 'main', i: 1 }; renderTimeline(); openFx(timeline[1]); }); await sleep(300);
  st = await ev(() => ({ h: document.querySelector('#sheetBody h3').textContent, note: /kommen zu „Farbe für das ganze Video“ hinzu/.test(document.querySelector('#sheetBody').textContent), match: !!document.querySelector('#fxColHost .cMatch'), pick: !!document.querySelector('#fxColHost .cPick'), ramp: [...document.querySelectorAll('#fxRamp button')].map(b => b.textContent).join(' ') }));
  chk('„Anpassen“ am Abschnitt: Farbe mit Farbtemperatur, Tönung, Pipette, „angleichen“ und Vorlagen; Hinweis auf die Farbe des ganzen Videos', st.h === 'Anpassen' && st.note && st.match && st.pick && st.ramp === 'gleich 0,5× 0,75× 1× 1,25× 1,5× 2× 3×', st);
  await slide('#fxColHost .cR[data-k="temp"]', 15); await slide('#fxColHost .cR[data-k="contrast"]', 0.1); await sleep(250);
  const g35 = await gains({ temp: 35 }), g20 = await gains({ temp: 20 });
  c = await ev(() => { const p = buildPlan(true).segments; return { wb: p.map(s => s.wb), con: p.map(s => s.contrast), own: P.items.filter(x => x.type === 'fx').map(x => [x.fx.temp, x.fx.contrast]), flt: V.style.filter }; });
  chk('die Werte des Abschnitts kommen zu denen des ganzen Videos hinzu (20 + 15 = 35), die übrigen Abschnitte bleiben bei 20', JSON.stringify(c.wb[1]) === JSON.stringify(g35) && [0, 2, 3].every(k => JSON.stringify(c.wb[k]) === JSON.stringify(g20)) && c.con.join() === '0,0.1,0,0' && c.own.join() === '15,0.1', c);
  await ev(() => document.querySelector('#fxOk').click()); await sleep(250);
  const bd = await ev(() => [...document.querySelectorAll('#trMain .blk')].map(b => (b.querySelector('.badge') || { textContent: '' }).textContent));
  chk('Zeitleiste: Nur der Abschnitt mit eigenen Farbwerten trägt das Farb-Abzeichen', bd.length === 4 && bd[1].includes('🎨') && [0, 2, 3].every(k => !bd[k].includes('🎨')), bd);
  const sn = await ev(() => { const o = JSON.parse(snapshot()); return [Object.keys(o).indexOf('co') === Object.keys(o).indexOf('pg') + 1, o.co, houseOf().color]; });
  chk('die Farbe des ganzen Videos gehört zum Rückgängig-Stand und zum Hausstil', sn[0] && sn[1] && sn[1].temp === 20 && sn[2] && sn[2].temp === 20, sn);

  // ═════════ Zoom-Schnitte (E4) ═════════
  await ev(() => { TL.sel = null; renderTimeline(); openCutZoom(); }); await sleep(250);
  st = await ev(() => ({ info: document.querySelector('#czInfo').textContent, lv: [...document.querySelectorAll('#czLevel button')].map(b => [b.textContent, b.classList.contains('on')]), off: document.querySelector('#czOff').classList.contains('hidden'), runs: zoomRuns().map(r => [r.a, r.b]) }));
  chk('„Zoom-Schnitte“: drei Stärken, „mittel“ vorgewählt; das Blatt nennt die vier Abschnitte', st.lv.map(x => x[0]).join() === 'leicht,mittel,deutlich' && st.lv[1][1] && /^4 Abschnitte/.test(st.info) && st.off && st.runs.length === 4, st);
  await ev(() => document.querySelector('#czOk').click()); await sleep(300);
  let z = await ev(() => ({ zs: P.items.filter(x => x.type === 'zoom').map(q => [q.auto, q.at, q.dur, q.kind, q.strength]), info: document.querySelector('#czInfo').textContent, toast: document.querySelector('#toast').textContent, plan: buildPlan(true).segments.map(s => (s.zooms || []).map(q => q.strength)), row: document.querySelectorAll('#trFx .blk.zoom').length }));
  chk('Anwenden: Jeder zweite Abschnitt rückt als Ganzes näher (1,1×), der erste bleibt', z.zs.length === 2 && z.zs.every(q => q[0] === 'cut' && q[3] === 'punch' && q[4] === 1.1) && near(z.zs[0][1], tl0[1][1], 0.002) && near(z.zs[0][2], tl0[1][2] - tl0[1][1], 0.002) && near(z.zs[1][1], tl0[3][1], 0.002)
    && JSON.stringify(z.plan) === '[[],[1.1],[],[1.1]]' && /^2 von 4/.test(z.info) && /2 Zoom-Schnitte gesetzt/.test(z.toast), z);
  await ev(() => document.querySelector('#czLevel [data-v="3"]').click()); await sleep(250);
  z = await ev(() => [P.items.filter(x => x.type === 'zoom').map(q => q.strength), localStorage.getItem('hc-cutzoom')]);
  chk('eine andere Stärke ersetzt die gesetzten Zoom-Schnitte', z[0].join() === '1.16,1.16' && z[1] === '3', z);
  // über einem unkenntlich gemachten Bereich bleibt das Bild, wie es ist (der Bereich folgt einem Zoom nicht von selbst)
  await ev(() => { commit(() => P.items.push({ id: 'bl1', type: 'blur', at: 13, dur: 2, x: 0.5, y: 0.5, w: 0.2, ar: 1, kind: 'pixel', form: 'rect', str: 2 }), false); document.querySelector('#czOk').click(); }); await sleep(300);
  z = await ev(() => [P.items.filter(x => x.type === 'zoom').map(q => q.at), document.querySelector('#czInfo').textContent]);
  chk('ein Abschnitt mit einem unkenntlich gemachten Bereich bekommt keinen Zoom-Schnitt; das Blatt sagt es', z[0].length === 1 && near(z[0][0], tl0[3][1], 0.002) && /Ein Abschnitt mit einem unkenntlich gemachten Bereich bleibt, wie er ist/.test(z[1]), z);
  await ev(() => { commit(() => { P.items = P.items.filter(x => x.id !== 'bl1'); }, false); document.querySelector('#czOk').click(); }); await sleep(300);
  // geteilt ohne Bildsprung zählt nicht als Schnitt; ein eigener Zoom bleibt unberührt
  await ev(() => { closeSheet(); seekOut(5, false); }); await sleep(300);
  await ev(() => { splitHere(); commit(() => P.items.push({ id: newId(), type: 'zoom', at: 24, dur: 2, kind: 'in', strength: 1.3, cx: 0.5, cy: 0.5 }), false); openCutZoom(); }); await sleep(250);
  await ev(() => document.querySelector('#czOk').click()); await sleep(250);
  z = await ev(() => ({ runs: zoomRuns().length, segs: timeline.length, zs: P.items.filter(x => x.type === 'zoom').map(q => [q.auto || 'eigen', q.at, q.strength]) }));
  chk('eine geteilte Stelle ohne Bildsprung ist kein Schnitt; wo schon ein eigener Zoom steht, kommt keiner dazu', z.runs === 4 && z.segs === 5 && z.zs.filter(q => q[0] === 'cut').length === 2 && z.zs.some(q => q[0] === 'eigen' && q[2] === 1.3) && !z.zs.some(q => q[0] === 'cut' && near(q[1], tl0[2][1], 0.01)), z);
  await shot('zoom-schnitte');
  await ev(() => document.querySelector('#czOff').click()); await sleep(250);
  z = await ev(() => [P.items.filter(x => x.type === 'zoom').map(q => q.auto || 'eigen').join(), document.querySelector('#toast').textContent]);
  chk('„Entfernen“ nimmt nur die Zoom-Schnitte weg', z[0] === 'eigen' && /entfernt/.test(z[1]), z);
  await ev(() => { closeSheet(); commit(() => { P.items = P.items.filter(x => x.type !== 'zoom'); P.splits = []; }, true); });

  // ═════════ Standbild und Tempo-Verlauf (E7) ═════════
  await ev(() => seekOut(3, false)); await sleep(700);
  const tot0 = await ev(() => total);
  await ev(() => addFreeze()); await page.waitForFunction(() => P.items.some(x => x.type === 'insert' && x.freeze), null, { timeout: 15000 }); await sleep(400);
  let fz = await ev(() => { const it = P.items.find(x => x.freeze), k = timeline.findIndex(g => g.kind === 'insert'); const p = buildPlan(true).segments;
    return { it: [it.at, it.in, it.out, it.clip.kind, it.clip.width, it.clip.height, it.clip.name, /standbild-[a-z0-9]+\.png$/.test(it.clip.uri)], file: it.clip.uri, k, kinds: timeline.map(g => g.kind).join(), total, sel: TL.sel && TL.sel.kind, pos: outPos, toast: document.querySelector('#toast').textContent, plan: p[k] && [p[k].kind, p[k].image, p[k].in, p[k].out, p[k].hasAudio] }; });
  chk('„Standbild“ schiebt an der Abspiellinie ein Bild von zwei Sekunden ein; der Abschnitt ist dort geteilt', fz.it[0] === 3 && fz.it[2] === 2 && fz.it[3] === 'image' && fz.it[4] === 640 && fz.it[5] === 360 && fz.it[6] === 'Standbild' && fz.it[7] && fz.kinds === 'main,insert,main,main,main,main'
    && near(fz.total, tot0 + 2, 0.01) && fz.sel === 'insert' && near(fz.pos, 3, 0.05) && /Standbild eingefügt/.test(fz.toast) && fz.plan.join() === 'insert,true,0,2,false', fz);
  chk('das Standbild liegt als Bilddatei beim Projekt', fs.existsSync(fz.file) && fs.statSync(fz.file).size > 1000, fz.file);
  // Tempo-Verlauf am dritten Abschnitt (12 bis 20 s der Aufnahme)
  const ki = await ev(() => { const k = timeline.findIndex(g => g.kind === 'main' && Math.abs(g.in - 12) < 0.01); TL.sel = { kind: 'main', i: k }; renderTimeline(); openFx(timeline[k]); return k; }); await sleep(300);
  await ev(() => document.querySelector('#fxRamp [data-v="2"]').click()); await sleep(300);
  let rp = await ev(() => { const it = P.items.find(x => x.type === 'fx' && x.fx.speed2 === 2), gs = timeline.filter(g => g.kind === 'main' && g.in >= 11.99 && g.out <= 20.01);
    return { it: [it.at, it.dur, it.fx.speed, it.fx.speed2], n: gs.length, sp: gs.map(g => g.speed), len: gs.map(g => +(g.out - g.in).toFixed(3)), L: gs.slice(1).every(g => g.L.k === 'fx'), note: document.querySelector('#fxRampNote').textContent, on: [...document.querySelectorAll('#fxRamp .on')].map(b => b.textContent).join(), total, runs: zoomRuns().length }; });
  chk('Tempo-Verlauf 1× → 2×: acht gleich lange Stufen, das Tempo steigt von 1 auf 2', rp.n === 8 && rp.sp[0] === 1 && rp.sp[7] === 2 && rp.sp.every((v, i) => i === 0 || v > rp.sp[i - 1]) && rp.len.every(v => near(v, 1, 0.002)) && rp.L && /in 8 Stufen von 1× auf 2×/.test(rp.note) && rp.on === '2×', rp);
  const want = rp.sp.reduce((s, v) => s + 1 / v, 0);
  chk('das Video wird um die gesparte Zeit kürzer; die Stufen zählen nicht als Schnitte', near(rp.total, tot0 + 2 - 8 + want, 0.02) && rp.runs === 4 + 1, [rp.total, tot0 + 2 - 8 + want, rp.runs]);
  await ev(() => document.querySelector('#fxOk').click()); await sleep(300);
  const badge = await ev(() => [...document.querySelectorAll('#trFx .blk.fx .txt')].map(x => x.textContent));
  chk('Zeitleiste: Die Anpassung zeigt den Verlauf „1→2×“', badge.some(x => /1→2×/.test(x)), badge);
  await shot('standbild-tempo');
  // echter Export: Standbild und Stufen
  await ev(() => { delete P.color; P.items = P.items.filter(x => !(x.type === 'fx' && !x.fx.speed2)); commit(() => {}, true); });
  let r = await exportNow('bild_standbild_tempo');
  const tot1 = await ev(() => total);
  chk('Export mit Standbild und Tempo-Verlauf läuft durch; die Länge stimmt', r.ok && near(dauer(r.file), tot1, 0.15), r.ok ? [dauer(r.file), tot1] : r.error);
  if (r.ok){ const a = frame(r.file, 100), b = frame(r.file, 140); let d = 0; for (let i = 0; i < a.length; i += 97) d = Math.max(d, Math.abs(a[i] - b[i]));
    const m1 = frame(r.file, 60), m2 = frame(r.file, 80); let dm = 0; for (let i = 0; i < m1.length; i += 97) dm = Math.max(dm, Math.abs(m1[i] - m2[i]));
    chk('im fertigen Video steht das Bild während des Standbilds; davor bewegt es sich', d <= 12 && dm > 40, [d, dm]); }
  // Verlauf zurücknehmen: die Stufen verschwinden
  await ev(() => { const it = P.items.find(x => x.type === 'fx' && x.fx.speed2 === 2); openFxItem(it); }); await sleep(250);
  await ev(() => document.querySelector('#fxRamp [data-v=""]').click()); await sleep(250);
  rp = await ev(() => [timeline.filter(g => g.kind === 'main' && g.in >= 11.99 && g.out <= 20.01).length, P.items.find(x => x.type === 'fx').fx.speed2 === undefined, document.querySelector('#fxRampNote').textContent]);
  chk('„gleich“ nimmt den Verlauf zurück: ein Abschnitt, festes Tempo', rp[0] === 1 && rp[1] && rp[2] === '', rp);
  await ev(() => document.querySelector('#fxOk').click());
  await dropScratch(page, id); made.pop();

  // ═════════ Hintergründe fürs Freistellen (E12), Pipette und Angleichen (E9) – am Greenscreen ═════════
  id = await newProject(page, [MEDIA + 'gruen.mp4']); made.push(id);
  await ev(() => setTab('studio')); await sleep(600);
  await ev(() => seekOut(5, false)); await sleep(400);
  await ev(() => splitHere()); await sleep(300);
  await ev(() => { commit(() => P.items.push({ id: 'fxkey', type: 'fx', at: 0, dur: 10, fx: { ...FX_DEF, key: { on: true, colors: ['#00ff00'], tol: 0.3, soft: 0.05, spill: true, bg: '#c02020' } } }), true); seekOut(2, false); }); await sleep(700);
  await ev(() => { TL.sel = { kind: 'main', i: 0 }; renderTimeline(); openFxItem(P.items.find(x => x.id === 'fxkey')); }); await sleep(400);
  st = await ev(() => ({ kinds: [...document.querySelectorAll('.kbKind button')].map(b => [b.textContent, b.classList.contains('on'), b.classList.contains('hidden')]), bg: document.querySelector('#keyBg').style.background, shown: !document.querySelector('#keyBg').classList.contains('hidden'), vop: V.style.opacity, first: document.querySelector('#stage').firstElementChild.id }));
  chk('Freistellen am Hauptbild: Hintergrund als Farbe, Verlauf, Bild oder Weich („Weich“ nur bei automatisch freigestellten Aufnahmen)', st.kinds.map(k => k[0]).join() === 'Farbe,Verlauf,Bild,Weich' && st.kinds[0][1] && st.kinds[3][2] && !st.kinds[1][2], st.kinds);
  chk('Vorschau: Der Hintergrund liegt als eigene Ebene hinter dem durchsichtig freigestellten Bild', st.shown && /rgb\(192, 32, 32\)/.test(st.bg) && st.vop === '0' && st.first === 'keyBg', st);
  r = await exportNow('bild_farbe');
  let f = r.ok ? frame(r.file, 30) : null;
  chk('Export mit Hintergrundfarbe: Farbe hinter dem Feld', r.ok && nah(px(f, 30, 20), [192, 32, 32]) && nah(px(f, 250, 120), [158, 126, 94]) && !r.plan.segments[0].key.bgImg, r.ok ? [px(f, 30, 20), px(f, 250, 120)] : r.error);
  // Verlauf
  await ev(() => document.querySelector('.kbKind [data-v="grad"]').click()); await sleep(250);
  await ev(() => { const a = document.querySelector('.keyBg'), b = document.querySelector('.keyBg2'); a.value = '#2040c0'; a.dispatchEvent(new Event('change', { bubbles: true })); b.value = '#c02020'; b.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(400);
  st = await ev(() => ({ key: P.items.find(x => x.id === 'fxkey').fx.key, bg: document.querySelector('#keyBg').style.background, c2: !document.querySelector('.keyBg2').classList.contains('hidden'), note: document.querySelector('.kbNote').textContent }));
  chk('Verlauf: zwei Farben, die Vorschau zeigt ihn von oben nach unten', st.key.bgKind === 'grad' && st.key.bg === '#2040c0' && st.key.bg2 === '#c02020' && /linear-gradient\(rgb\(32, 64, 192\), rgb\(192, 32, 32\)\)/.test(st.bg) && st.c2 && /oben/.test(st.note), st);
  await shot('hintergrund-verlauf');
  r = await exportNow('bild_verlauf'); f = r.ok ? frame(r.file, 30) : null;
  chk('Export mit Verlauf: oben die erste, unten die zweite Farbe; das Bild des Verlaufs liegt beim Projekt', r.ok && nah(px(f, 30, 6), [32, 62, 188], 10) && nah(px(f, 30, 352), [188, 32, 34], 10) && nah(px(f, 250, 120), [158, 126, 94]) && /hintergrund-2040c0-c02020-640x360\.png$/.test(r.plan.segments[0].key.bgImg) && r.plan.segments[1].key.bgImg === r.plan.segments[0].key.bgImg,
    r.ok ? [px(f, 30, 6), px(f, 30, 352), r.plan.segments[0].key.bgImg] : r.error);
  // Titelbild zeichnet den Hintergrund mit
  const cov = await ev(async () => { const cv = document.createElement('canvas'); cv.width = 640; cv.height = 360; await coverRender(cv, { titles: false, subs: false, text: '' }); const x = cv.getContext('2d'); return [[...x.getImageData(30, 6, 1, 1).data].slice(0, 3), [...x.getImageData(30, 352, 1, 1).data].slice(0, 3), [...x.getImageData(250, 120, 1, 1).data].slice(0, 3)]; });
  chk('Titelbild: Verlauf und Feld wie in der Vorschau', nah(cov[0], [32, 63, 190], 8) && nah(cov[1], [190, 32, 34], 8) && nah(cov[2], [158, 126, 94], 12), cov);
  // eigenes Bild
  setPick({ clip: MEDIA + 'folie1.png' });
  await ev(() => document.querySelector('.kbKind [data-v="image"]').click()); await page.waitForFunction(() => (P.items.find(x => x.id === 'fxkey').fx.key.bgImg || {}).name === 'folie1.png', null, { timeout: 15000 }); await sleep(400);
  st = await ev(() => ({ key: P.items.find(x => x.id === 'fxkey').fx.key, bg: document.querySelector('#keyBg').style.background, note: document.querySelector('.kbNote').textContent, btn: !document.querySelector('.kbPick').classList.contains('hidden') }));
  chk('Bild: Die gewählte Datei steht am Schlüssel und füllt die Vorschau', st.key.bgKind === 'image' && /folie1\.png$/.test(st.key.bgImg.uri) && /url\(/.test(st.bg) && /cover/.test(st.bg) && st.note === 'folie1.png' && st.btn, st);
  r = await exportNow('bild_bild'); f = r.ok ? frame(r.file, 30) : null;
  chk('Export mit Bild: das Folienbild (31, 42, 36) hinter dem Feld', r.ok && nah(px(f, 30, 20), [31, 42, 36], 8) && nah(px(f, 600, 340), [31, 42, 36], 8) && nah(px(f, 250, 120), [158, 126, 94]), r.ok ? [px(f, 30, 20), px(f, 250, 120)] : r.error);
  // Weich: braucht das Original einer automatisch freigestellten Aufnahme – hier nachgestellt
  await ev(() => { const s = P.sources[0]; s.orig = s.uri; s.matte = true; openFxItem(P.items.find(x => x.id === 'fxkey')); }); await sleep(300);
  await ev(() => document.querySelector('.kbKind [data-v="blur"]').click()); await page.waitForFunction(() => P.items.find(x => x.id === 'fxkey').fx.key.bgKind === 'blur', null, { timeout: 15000 }); await sleep(400);
  st = await ev(() => ({ key: P.items.find(x => x.id === 'fxkey').fx.key, note: document.querySelector('.kbNote').textContent, vis: !document.querySelector('.kbKind [data-v="blur"]').classList.contains('hidden') }));
  chk('Weich: ein weichgezeichnetes Standbild der Aufnahme wird als Bild abgelegt', st.vis && st.key.bgKind === 'blur' && /hintergrund-weich-[a-z0-9]+\.png$/.test(st.key.bgImg.uri) && fs.existsSync(st.key.bgImg.uri) && st.key.bgImg.width === 960 && /weichgezeichnetes Standbild/.test(st.note), st);
  if (st.key.bgImg && fs.existsSync(st.key.bgImg.uri)){
    const kante = (args) => { const raw = execFileSync('ffmpeg', ['-v', 'error', ...args, '-frames:v', '1', '-vf', 'scale=192:108', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 22 }); let m = 0; for (let i = 1; i < raw.length; i++) if (i % 192) m = Math.max(m, Math.abs(raw[i] - raw[i - 1])); return m; };
    const k1 = kante(['-i', st.key.bgImg.uri]), k0 = kante(['-ss', '2', '-i', MEDIA + 'gruen.mp4']);
    chk('das Standbild ist weich: Die harte Kante des Felds ist zu einem Verlauf geworden', k0 > 40 && k1 < k0 * 0.35, [k0, k1]); }
  await ev(() => { const s = P.sources[0]; delete s.orig; delete s.matte; const k = P.items.find(x => x.id === 'fxkey').fx.key; delete k.bgKind; delete k.bgImg; k.bg = '#000000'; commit(() => {}, true); openFxItem(P.items.find(x => x.id === 'fxkey')); seekOut(2, false); }); await sleep(500);

  // Pipette: Weiß im Bild wählen
  await ev(() => document.querySelector('#fxColHost .cPick').click()); await sleep(200);
  const sr = await ev(() => { const r = document.querySelector('#stage').getBoundingClientRect(); return [r.left, r.top, r.width, r.height, document.querySelector('#stageHint').textContent, !document.querySelector('#stageHint').classList.contains('hidden')]; });
  chk('„Weiß im Bild wählen“ bittet um einen Klick ins Bild', sr[5] && /farbneutral/.test(sr[4]), sr[4]);
  await page.mouse.click(sr[0] + sr[2] * 0.40, sr[1] + sr[3] * 0.35); await sleep(400);
  c = await ev(() => { const fx = P.items.find(x => x.id === 'fxkey').fx; return { temp: fx.temp, tint: fx.tint, toast: document.querySelector('#toast').textContent, flt: V.style.filter, kflt: document.querySelector('canvas.vkey').style.filter, hint: document.querySelector('#stageHint').classList.contains('hidden'), wb: buildPlan(true).segments[0].wb }; });
  chk('ein Klick auf das Feld mit Farbstich setzt Farbtemperatur und Tönung: kühler, Rot zurück, Blau vor', c.temp < -40 && Math.abs(c.tint) < 40 && /Weißabgleich gesetzt/.test(c.toast) && /url\(/.test(c.flt) && c.kflt === c.flt && c.hint && c.wb[0] < 0.9 && c.wb[2] > 1.2, c);
  r = await exportNow('bild_pipette'); f = r.ok ? frame(r.file, 30) : null;
  const p1 = f ? px(f, 250, 120) : null;
  chk('Export: Das Feld (158, 126, 94) ist jetzt farbneutral', r.ok && Math.max(...p1) - Math.min(...p1) <= 8 && near(p1[1], 126, 8), r.ok ? p1 : r.error);
  await ev(() => { document.querySelector('#fxColHost .cPick').click(); }); await sleep(150);
  await page.mouse.click(sr[0] + sr[2] * 0.05, sr[1] + sr[3] * 0.05); await sleep(300);
  chk('eine farbige Stelle taugt nicht für den Weißabgleich: Hinweis, die Werte bleiben', /zu farbig/.test(await toastTxt()) && (await ev(() => P.items.find(x => x.id === 'fxkey').fx.temp)) === c.temp, await toastTxt());
  // Angleichen: der zweite Abschnitt (neutral grau) soll aussehen wie der erste (warm, ohne Anpassung)
  await ev(() => { const it = P.items.find(x => x.id === 'fxkey'); delete it.fx.temp; delete it.fx.tint; it.dur = 5; commit(() => P.items.push({ id: 'fx2', type: 'fx', at: 5, dur: 5, fx: { ...FX_DEF, key: JSON.parse(JSON.stringify(it.fx.key)) } }), true); seekOut(7, false); }); await sleep(500);
  await ev(() => { TL.sel = { kind: 'main', i: 1 }; renderTimeline(); openFxItem(P.items.find(x => x.id === 'fx2')); }); await sleep(300);
  await ev(() => document.querySelector('#fxColHost .cMatch').click());
  await page.waitForFunction(() => /angeglichen|vergleichen|braucht/.test(document.querySelector('#toast').textContent), null, { timeout: 20000 }); await sleep(300);
  c = await ev(() => { const fx = P.items.find(x => x.id === 'fx2').fx; return { temp: fx.temp, tint: fx.tint, bright: fx.bright, toast: document.querySelector('#toast').textContent, lab: document.querySelector('#fxColHost .cV[data-k="temp"]').textContent }; });
  chk('„An den Clip davor angleichen“ setzt Farbtemperatur, Tönung und Helligkeit des Abschnitts', c.temp > 40 && /angeglichen/.test(c.toast) && /^warm/.test(c.lab) && Math.abs(c.bright) <= 0.2, c);
  r = await exportNow('bild_angleichen'); f = r.ok ? frame(r.file, 60) : null; const f2 = r.ok ? frame(r.file, 240) : null;
  chk('Export: Das graue Feld des zweiten Abschnitts sieht jetzt aus wie das warme des ersten', r.ok && nah(px(f, 250, 120), [158, 126, 94]) && nah(px(f2, 250, 120), px(f, 250, 120), 14), r.ok ? [px(f, 250, 120), px(f2, 250, 120)] : r.error);
  await ev(() => document.querySelector('#fxOk').click());
  await dropScratch(page, id); made.pop();

  // ═════════ Bild beruhigen (E11) ═════════
  id = await newProject(page, [MEDIA + 'wackel.mp4']); made.push(id);
  await ev(() => setTab('studio')); await sleep(600);
  await ev(() => { TL.sel = { kind: 'main', i: 0 }; renderTimeline(); openFx(timeline[0]); }); await sleep(300);
  st = await ev(() => ({ cap: CAP.stabilize, blk: !!document.querySelector('.stabblk'), lv: [...document.querySelectorAll('.stLevel button')].map(b => [b.textContent, b.classList.contains('on')]), go: document.querySelector('.stGo').textContent, orig: document.querySelector('.stOrig').classList.contains('hidden'), hint: document.querySelector('.stHint').textContent }));
  chk('„Anpassen“ bietet unter Windows „Bild beruhigen“ in drei Stärken an', st.cap === true && st.blk && st.lv.map(x => x[0]).join() === 'leicht,mittel,stark' && st.lv[1][1] && /Verwackeln ausgleichen/.test(st.go) && st.orig && /Kopie/.test(st.hint), st);
  const uri0 = await ev(() => P.sources[0].uri);
  await ev(() => document.querySelector('.stGo').click());
  await page.waitForFunction(() => !!P.sources[0].stab, null, { timeout: 120000 }); await sleep(500);
  st = await ev(() => { const s = P.sources[0]; return { uri: s.uri, orig: s.orig, stab: s.stab, matte: !!s.matte, go: document.querySelector('.stGo').textContent, origBtn: !document.querySelector('.stOrig').classList.contains('hidden'), hint: document.querySelector('.stHint').textContent, toast: document.querySelector('#toast').textContent, prog: document.querySelector('.stProg').classList.contains('hidden'), src: decodeURIComponent(V.src), tl: timeline.length, total }; });
  chk('ein Klick erzeugt die beruhigte Kopie und tauscht sie ein; das Original bleibt gemerkt', /[\\/]beruhigt[\\/][0-9a-f]{16}\.mp4$/.test(st.uri) && st.orig === uri0 && st.stab === 2 && !st.matte && /Erneut/.test(st.go) && st.origBtn && /beruhigte Kopie \(mittel\)/.test(st.hint) && /ruhiger/.test(st.toast) && st.prog && st.src.includes('beruhigt') && near(st.total, 4, 0.1), st);
  if (/beruhigt/.test(st.uri)) trash.add(st.uri);
  const unruhe = file => { const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-an', '-vf', 'scale=160:90', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 1 << 26 }), n = raw.length / (160 * 90); let d = 0; for (let k = 1; k < n; k++) for (let i = 0; i < 160 * 90; i += 7) d += Math.abs(raw[k * 14400 + i] - raw[(k - 1) * 14400 + i]); return [n, d / (n - 1) / (14400 / 7)]; };
  const [n0, w0] = unruhe(uri0), [n1, w1] = fs.existsSync(st.uri) ? unruhe(st.uri) : [0, 1e9];
  chk('die Kopie hat dieselbe Bildzahl und steht deutlich ruhiger', n1 === n0 && w1 < w0 * 0.65, [n0, n1, +w0.toFixed(2), +w1.toFixed(2)]);
  r = await exportNow('bild_beruhigt');
  chk('der Export nimmt die beruhigte Kopie', r.ok && /beruhigt/.test(r.plan.segments[0].uri) && near(dauer(r.file), 4, 0.15), r.ok ? r.plan.segments[0].uri : r.error);
  await ev(() => document.querySelector('.stOrig').click()); await sleep(400);
  st = await ev(() => { const s = P.sources[0]; return [s.uri, s.orig || null, s.stab || null, document.querySelector('.stGo').textContent, document.querySelector('#toast').textContent]; });
  chk('„Original zurück“ stellt die Aufnahme wieder her', st[0] === uri0 && st[1] === null && st[2] === null && /Verwackeln ausgleichen/.test(st[3]) && /Original/.test(st[4]), st);
  await ev(() => { P.sources[0].matte = true; P.sources[0].orig = P.sources[0].uri; openFx(timeline[0]); }); await sleep(250);
  st = await ev(() => [document.querySelector('.stGo').disabled, document.querySelector('.stHint').textContent]);
  chk('eine freigestellte Aufnahme lässt sich nicht beruhigen; der Hinweis nennt die Reihenfolge', st[0] && /Erst beruhigen, dann freistellen/.test(st[1]), st);
  await ev(() => { delete P.sources[0].matte; delete P.sources[0].orig; document.querySelector('#fxOk').click(); });
  // Speicher verwalten kennt die beruhigten Kopien
  const grp = await ev(async () => (await TS.storage()).groups.find(g => g.key === 'stab') || null);
  chk('„Speicher verwalten“ führt die beruhigten Kopien als eigene Gruppe', !!grp && grp.label === 'Beruhigte Kopien' && grp.count >= 1, grp && [grp.label, grp.count]);
  await dropScratch(page, id); made.pop();

  // ═════════ Am Handy (390 × 844) ═════════
  const mob = await launch({ viewport: { width: 390, height: 844 }, dpr: 2 }), hp = mob.page, pe = (f, a) => hp.evaluate(f, a);
  try {
    const hid = await scratch(hp, ids().kurz);
    await pe(() => { setTab('studio'); }); await sleep(600);
    const fits = () => pe(() => { const s = document.querySelector('#sheet'), r = s.getBoundingClientRect(), b = document.querySelector('#sheetBody'); const over = [...b.querySelectorAll('button, input, .look-chip')].filter(el => { const q = el.getBoundingClientRect(); return q.width > 0 && (q.left < r.left - 1 || q.right > r.right + 1); }).length;
      return { open: !s.classList.contains('hidden'), wide: r.width <= innerWidth + 1, over, scroll: b.scrollHeight > b.clientHeight + 4 || s.scrollHeight > s.clientHeight + 4 || r.height <= innerHeight }; });
    await pe(() => openColorAll()); await sleep(300);
    const m1 = await fits(); await hp.screenshot({ path: path.join(OUT, 'bild-handy-farbe.png') });
    await pe(() => { closeSheet(); openCutZoom(); }); await sleep(300);
    const m2 = await fits();
    await pe(() => { closeSheet(); TL.sel = { kind: 'main', i: 0 }; renderTimeline(); openFx(timeline[0]); }); await sleep(300);
    const m3 = await fits(); await hp.screenshot({ path: path.join(OUT, 'bild-handy-anpassen.png') });
    chk('Handy: Die Blätter „Farbe“, „Zoom-Schnitte“ und „Anpassen“ passen in die Breite, nichts ragt hinaus', [m1, m2, m3].every(m => m.open && m.wide && m.over === 0 && m.scroll), { m1, m2, m3 });
    await pe(() => closeSheet());
    await hp.evaluate(i => { if (typeof P !== 'undefined' && P && P.id === i){ pausePlay(); clearTimeout(saveT); P = null; busPid = null; showHome(); } TS.deleteProject(i); if (TS.trashPurge) try { TS.trashPurge(i); } catch (_) {} }, hid);
  } catch (e) {
    chk('Handy-Prüfung läuft ohne Abbruch durch', false, String(e && e.stack || e).slice(0, 600));
  }
  await mob.browser.close();
} catch (e) {
  chk('Prüfung läuft ohne Abbruch durch', false, String(e && e.stack || e).slice(0, 700));
}
// (Chrome meldet beim Ablesen einer Farbe aus dem freigestellten Bild einen Hinweis des Grafiktreibers – der gehört nicht zur Seite.)
const echte = logs.filter(l => !/GPU stall due to ReadPixels|willReadFrequently/.test(l));
chk('keine Fehlermeldungen der Seite', echte.length === 0, echte.slice(0, 6));
for (const id of made) await dropScratch(page, id).catch(() => {});
for (const f of trash) try { fs.rmSync(f, { recursive: true, force: true }); } catch (_) {}
await ende(browser);
