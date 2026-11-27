// Studio aufgeräumt (2.42): eine Abspielleiste unter dem Bild (ohne Knöpfe neben dem Bild), Menüs „Einfügen“ und „Bearbeiten“
// über den Spuren, die untere Leiste nur für das ausgewählte Element (mit „Mehr“, wenn es eng wird), feste waagerechte Scrollleiste.
import { launch, openById, ids, sleep, pruefung } from './drv.mjs';
const { chk, ende } = pruefung('Leisten im Studio');
const { browser, page, logs } = await launch({ viewport: { width: 1366, height: 768 }, dpr: 1 });
const ev = (f, a) => page.evaluate(f, a);
const menu = () => ev(() => [...document.querySelectorAll('#ctxMenu button')].map(b => b.lastChild.textContent.trim()));   // ohne das Symbol davor
const inView = sel => ev(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth + 0.5 && r.top >= 0 && r.bottom <= innerHeight + 0.5; }, sel);

try {
  await openById(page, ids().edit);
  await ev(() => setTab('studio')); await sleep(1000);
  // ═════════ Vorschau und Abspielleiste ═════════
  const a = await ev(() => { const vis = e => e.offsetParent !== null && e.getBoundingClientRect().width > 0;
    return { side: document.querySelectorAll('.side, .sbtn').length, plays: [...document.querySelectorAll('button')].filter(b => vis(b) && /Abspielen \/ Pause/.test(b.title)).map(b => b.id),
      full: [...document.querySelectorAll('button')].filter(b => vis(b) && /^Vollbild/.test(b.title)).map(b => b.id), undo: [...document.querySelectorAll('button')].filter(b => vis(b) && /^Rückgängig/.test(b.title)).map(b => b.id),
      order: [...document.querySelectorAll('.transport > *')].map(e => e.id || e.className), stage: document.querySelector('#stage').getBoundingClientRect().width, wrap: document.querySelector('.stage-wrap').getBoundingClientRect().width }; });
  chk('Neben dem Bild stehen keine Knöpfe mehr; es gibt einen Abspielknopf, einen Vollbildknopf und ein „Rückgängig“', a.side === 0 && a.plays.join() === 'playBtn' && a.full.join() === 'fullBtn' && a.undo.join() === 'undoBtn', a);
  chk('Die Abspielleiste: Abspielen, voriger und nächster Schnitt, Zeitstrahl, Zeit, Ansicht, Vollbild', a.order.join() === 'playBtn,tPrevCut,tNextCut,scrub,times mono,viewBtn,fullBtn', a.order);
  const cuts = await ev(async () => { const e = [...new Set(timeline.map(g => +g.o.toFixed(3)))].sort((p, q) => p - q); seekOut(e[3] + 0.3, false); await new Promise(r => setTimeout(r, 100));
    document.querySelector('#tNextCut').click(); const n = outPos; document.querySelector('#tPrevCut').click(); const p1 = outPos; document.querySelector('#tPrevCut').click(); return { e: e.slice(2, 5), n, p1, p2: outPos }; });
  chk('„Nächster Schnitt“ und „Voriger Schnitt“ springen von Kante zu Kante', Math.abs(cuts.n - cuts.e[2]) < 0.01 && Math.abs(cuts.p1 - cuts.e[1]) < 0.01 && Math.abs(cuts.p2 - cuts.e[0]) < 0.01, cuts);
  await page.click('#viewBtn'); await sleep(200);
  const vm = await menu(), vb = await ev(() => { const m = document.querySelector('#ctxMenu').getBoundingClientRect(), b = document.querySelector('#viewBtn').getBoundingClientRect(); return { above: m.bottom <= b.top + 1, inside: m.top >= 0 && m.right <= innerWidth }; });
  chk('Menü „Ansicht“ klappt nach oben auf: Untertitel, Schrift, Schutzzonen, Schnitt anhören, Schnittsprünge, Einzelbilder', vm.join('|') === 'Untertitel ausblenden|Schrift der Untertitel …|Schutzzonen der Plattformen zeigen|Letzten Schnitt anhören|Zum vorigen Schnitt|Zum nächsten Schnitt|Ein Bild zurück (←)|Ein Bild vor (→)' && vb.above && vb.inside, { vm, vb });
  await page.locator('#ctxMenu button', { hasText: 'Untertitel ausblenden' }).click(); await sleep(300);
  const s1 = await ev(() => ({ on: S().enabled, menu: viewMenu()[0].label, toast: document.querySelector('#toast').textContent, open: !!document.querySelector('#ctxMenu') }));
  chk('„Untertitel ausblenden“ schaltet sie aus; der Eintrag heißt danach „Untertitel einblenden“', s1.on === false && s1.menu === 'Untertitel einblenden' && /Untertitel aus/.test(s1.toast) && !s1.open, s1);
  await ev(() => toggleSubs());
  await page.click('#viewBtn'); await page.locator('#ctxMenu button', { hasText: 'Ein Bild vor' }).click(); await sleep(200);
  chk('„Ein Bild vor“ rückt um ein Bild weiter', await ev(p => Math.abs(outPos - p - 1 / (P.fps || 30)) < 0.02, cuts.p2));
  await page.click('#viewBtn'); await page.locator('#ctxMenu button', { hasText: 'Schrift der Untertitel' }).click(); await sleep(300);
  chk('„Schrift der Untertitel“ öffnet die Schriftwahl', await ev(() => !document.querySelector('#sheet').classList.contains('hidden')));
  await ev(() => closeSheet());

  // ═════════ Leiste über den Spuren ═════════
  const bar = await ev(() => { const b = document.querySelector('.tl-bar'), vis = [...b.querySelectorAll('button')].filter(x => x.offsetParent !== null);
    return { fits: b.scrollWidth <= b.clientWidth, ids: vis.map(x => x.id), right: Math.max(...vis.map(x => x.getBoundingClientRect().right)), w: innerWidth }; });
  chk('Die Leiste über den Spuren passt vollständig ins Fenster: Teilen, Löschen, Einfügen, Bearbeiten, Einrasten, Zeiger, Zoom', bar.fits && bar.right <= bar.w && bar.ids.join() === 'barSplit,barDel,barInsert,barEdit,snapBtn,modeBtn,tlOut,tlIn,tlFit', bar);
  await page.click('#barInsert'); await sleep(200);
  const im = await menu();
  chk('Menü „Einfügen“: Medienablage, Clip, Titel, Untertitel, Folie, Form, Standbild, Kapitel, Notiz', im.join('|') === 'Medienablage öffnen|Clip|Titel|Untertitel|Folie (N)|Form|Standbild|Kapitel|Notiz', im);
  await page.locator('#ctxMenu button', { hasText: 'Medienablage öffnen' }).click(); await sleep(300);
  const bin = await ev(() => ({ open: !document.querySelector('#mediaBin').classList.contains('hidden'), label: barMenu('insert')[0].label }));
  chk('„Medienablage öffnen“ zeigt die Ablage; der Eintrag heißt danach „Medienablage schließen“', bin.open && bin.label === 'Medienablage schließen', bin);
  await ev(() => toggleBin());
  const n0 = await ev(() => P.items.filter(x => x.type === 'title').length);
  await page.click('#barInsert'); await page.locator('#ctxMenu button', { hasText: /^Titel$/ }).click(); await sleep(400);
  chk('„Titel“ aus dem Menü fügt einen Titel an der Abspiellinie ein', await ev(n => P.items.filter(x => x.type === 'title').length === n + 1, n0));
  await ev(() => { if (!document.querySelector('#sheet').classList.contains('hidden')) closeSheet(); select(null); }); await page.click('#undoBtn'); await sleep(300);
  await page.click('#barEdit'); await sleep(200);
  const em = await menu(), eb = await ev(() => { const m = document.querySelector('#ctxMenu').getBoundingClientRect(); return m.bottom <= innerHeight && m.top >= 0; });
  chk('Menü „Bearbeiten“: Anpassen, Zoom, Lautstärke, Spuren per Ton synchronisieren, Farbe, Übergang, Unkenntlich, Fortschritt, Zoom-Schnitte, Leinwand, Titelbild, Kapitel und Notizen, Clips, Schnitte an der Abspiellinie', em.join('|') === 'Anpassen (E)|Zoom|Lautstärke|Spuren per Ton synchronisieren|Farbe|Übergang|Unkenntlich|Fortschritt|Zoom-Schnitte|Leinwand|Titelbild|Kapitel und Notizen|Clips|Bis hier weg|Ab hier weg|Clip ab hier …' && eb, em);
  await page.locator('#ctxMenu button', { hasText: 'Lautstärke' }).click(); await sleep(300);
  chk('„Lautstärke“ aus dem Menü öffnet das Blatt', await ev(() => !document.querySelector('#sheet').classList.contains('hidden') && /Lautstärke/.test(document.querySelector('#sheetBody').textContent)));
  await ev(() => closeSheet());
  await page.click('#barEdit'); await sleep(200); await page.mouse.click(700, 200); await sleep(200);
  chk('Ein Klick daneben schließt das Menü', await ev(() => !document.querySelector('#ctxMenu')));

  // ═════════ Untere Leiste: nur für das Ausgewählte ═════════
  const leer = await ev(() => { select(null); updateTools(); return { n: document.querySelectorAll('#tools .tool').length, none: document.querySelector('#tools').classList.contains('none'), lbl: document.querySelector('#selLbl').textContent, info: document.querySelector('#tlInfo').textContent }; });
  chk('Ohne Auswahl ist die untere Leiste leer und zeigt nur den Hinweis', leer.n === 0 && leer.none && leer.lbl === '' && /Rechtsklick für Werkzeuge/.test(leer.info), leer);
  await page.click('#trMain .blk:nth-child(2)'); await sleep(300);
  const t1 = await ev(() => { const box = document.querySelector('#tools').getBoundingClientRect(), all = [...document.querySelectorAll('#tools .tool')];
    return { lbl: document.querySelector('#selLbl').textContent, shown: all.filter(b => !b.classList.contains('over')).map(b => b.textContent.trim()), over: all.filter(b => b.classList.contains('over')).map(b => b.textContent.trim()),
      cut: all.filter(b => !b.classList.contains('over')).some(b => { const r = b.getBoundingClientRect(); return r.right > box.right + 1 || r.right > innerWidth; }) }; });
  chk('Clip gewählt: Seine Werkzeuge stehen in der unteren Leiste, keines läuft aus dem Bild; der Rest steckt unter „Mehr“', t1.lbl === 'Clip' && !t1.cut && t1.shown[0] === 'Als Clip …' && t1.shown.includes('Anpassen') && t1.shown[t1.shown.length - 1] === 'Mehr' && t1.over.length >= 1, t1);
  await page.click('#tools .tool.more'); await sleep(200);
  const mm = await menu();
  chk('„Mehr“ zeigt genau die Werkzeuge, die keinen Platz hatten', mm.join('|') === t1.over.join('|'), mm);
  const sn = await ev(() => timeline.length);
  await page.locator('#ctxMenu button', { hasText: 'Duplizieren' }).click(); await sleep(400);
  chk('Ein Werkzeug aus „Mehr“ wirkt (Duplizieren fügt einen Clip hinzu)', await ev(n => timeline.length === n + 1, sn));
  await page.click('#undoBtn'); await sleep(300);
  // Rechtsklick wie bisher
  await ev(() => { select(null); document.querySelector('.tl-body').scrollTop = 0; }); await sleep(150); const rb = await page.locator('#ruler').boundingBox();
  await page.mouse.click(rb.x + 300, rb.y + rb.height + 30, { button: 'right' }); await sleep(250);
  const rm = await menu();
  chk('Rechtsklick in die Zeitleiste zeigt weiter alle Werkzeuge für die Abspiellinie', rm.includes('Unkenntlich') && rm.includes('Titelbild') && rm.includes('Clip ab hier …') && rm.length >= 18, rm.length);
  await ev(() => closeMenu());

  // ═════════ Feste waagerechte Scrollleiste ═════════
  const h0 = await ev(() => { const h = document.querySelector('#tlHbar'), r = h.getBoundingClientRect(), th = h.firstElementChild.getBoundingClientRect(), body = document.querySelector('.tl-body'), g = document.querySelector('.tl-gutter').getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, vh: innerHeight, left: r.left, gutter: g.right, thumbW: th.width, trackW: r.width, need: tlEl.scrollWidth > tlEl.clientWidth, bodyScroll: body.scrollHeight > body.clientHeight + 1, bodyTop: body.scrollTop, off: h.classList.contains('off') }; });
  chk('Die Scrollleiste ist sofort zu sehen, ohne die Spuren nach unten zu schieben; sie beginnt rechts neben den Spurnamen', h0.need && !h0.off && h0.bottom <= h0.vh && h0.bodyScroll && Math.abs(h0.left - h0.gutter) <= 1 && h0.thumbW >= 48 && h0.thumbW < h0.trackW, h0);
  await ev(() => { tlEl.scrollLeft = 0; }); await sleep(100);
  let tb = await page.locator('#tlHbar i').boundingBox();
  await page.mouse.move(tb.x + 10, tb.y + 4); await page.mouse.down(); await page.mouse.move(tb.x + 310, tb.y + 4, { steps: 6 }); await page.mouse.up(); await sleep(150);
  const d1 = await ev(() => { const h = document.querySelector('#tlHbar'), q = { track: h.clientWidth, tw: h.firstElementChild.getBoundingClientRect().width }; return { left: tlEl.scrollLeft, want: 300 / (q.track - q.tw) * (tlEl.scrollWidth - tlEl.clientWidth) }; });
  chk('Ziehen am Griff schiebt die Zeitleiste im passenden Verhältnis', Math.abs(d1.left - d1.want) <= Math.max(4, d1.want * 0.02), d1);
  await ev(() => { tlEl.scrollLeft = tlEl.scrollWidth; }); await sleep(150);
  const d2 = await ev(() => { const h = document.querySelector('#tlHbar').getBoundingClientRect(), t = document.querySelector('#tlHbar i').getBoundingClientRect(); return Math.abs(t.right - h.right); });
  chk('Schiebt man die Spuren selbst, wandert der Griff mit (am Ende steht er ganz rechts)', d2 <= 1.5, d2);
  const hb = await page.locator('#tlHbar').boundingBox();
  await page.mouse.click(hb.x + hb.width / 2, hb.y + hb.height / 2); await sleep(150);
  const d3 = await ev(() => tlEl.scrollLeft / (tlEl.scrollWidth - tlEl.clientWidth));
  chk('Ein Klick in die Leiste springt dorthin (Mitte)', Math.abs(d3 - 0.5) < 0.03, d3);
  await ev(() => { document.querySelector('.tl-body').scrollTop = 9999; }); await sleep(150);
  chk('Auch nach dem Schieben der Spuren nach unten bleibt die Leiste an ihrem Platz', await ev(t => Math.abs(document.querySelector('#tlHbar').getBoundingClientRect().top - t) <= 1, h0.top));

  // ═════════ Text-Reiter und schmale Fenster ═════════
  await ev(() => setTab('text')); await sleep(500);
  const tx = await ev(() => ({ ins: document.querySelector('#barInsert').offsetParent === null, tools: [...document.querySelectorAll('#tools .tool:not(.more)')].map(b => b.textContent.trim()), play: document.querySelector('#playBtn').offsetParent !== null, view: document.querySelector('#viewBtn').offsetParent !== null }));
  chk('Im Text-Reiter bleibt die kleine Schnitt-Zeitleiste, wie sie war (ohne Menüs, mit ihren drei Werkzeugen); die Abspielleiste ist dieselbe', tx.ins && tx.tools.join() === 'Teilen,Bis hier weg,Ab hier weg' && tx.play && tx.view, tx);
  await page.setViewportSize({ width: 390, height: 800 }); await ev(() => setTab('studio')); await sleep(900);
  await page.click('#trMain .blk:nth-child(2)').catch(() => {}); await sleep(300);
  const ph = await ev(() => { const b = document.querySelector('.tl-bar'), tools = document.querySelector('#tools').getBoundingClientRect(), vis = e => e.offsetParent !== null;
    return { cutBtns: vis(document.querySelector('#tPrevCut')), scrub: document.querySelector('#scrub').getBoundingClientRect().width, bar: b.scrollWidth <= b.clientWidth + 1, ins: vis(document.querySelector('#barInsert')),
      toolsCut: [...document.querySelectorAll('#tools .tool')].filter(x => !x.classList.contains('over')).some(x => x.getBoundingClientRect().right > innerWidth), more: !!document.querySelector('#tools .tool.more'), hbar: document.querySelector('#tlHbar').getBoundingClientRect().bottom <= innerHeight }; });
  chk('Handy-Breite: Die Sprungknöpfe weichen dem Zeitstrahl (sie stehen im Menü „Ansicht“), beide Leisten passen, die Scrollleiste ist zu sehen', !ph.cutBtns && ph.scrub > 120 && ph.bar && ph.ins && !ph.toolsCut && ph.more && ph.hbar, ph);
} catch (e){ chk('Prüfung abgebrochen', false, String((e && e.stack) || e).replace(/\s+/g, ' ').slice(0, 500)); }

chk('keine Fehlermeldungen der Seite', logs.length === 0, logs.slice(0, 6));
await ende(browser);
