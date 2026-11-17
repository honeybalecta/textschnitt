// Skript abgleichen (2.40, C6): Manuskript einfügen, Schreibweisen übernehmen, frei Gesprochenes und Ausgelassenes zeigen.
// Grundlage ist serie.mp4 (fester Text in sechs Absätzen, siehe medien.py). Das Manuskript hier weicht gezielt ab.
import { launch, newProject, transcribe, dropScratch, sleep, pruefung, MEDIA } from './drv.mjs';
const { chk, ende } = pruefung('Skript abgleichen');
const { browser, page, logs } = await launch();
const ev = (f, a) => page.evaluate(f, a);
const made = [];
const toast = () => ev(() => document.querySelector('#toast').textContent);
// Abweichungen: Überschrift und Regieanweisung (zählen nicht) · „Mieten-Deckel“ · „dreißig“ für 30 · ein Satz, der im Video fehlt ·
// „Nachbar:innen“ · „mitanpacken“ (ein Wort für zwei gesprochene) · „Haus Gemeinschaften“ (zwei Wörter für ein gesprochenes) ·
// der dritte Absatz des Videos fehlt im Manuskript (frei gesprochen) · „Volks-Entscheid“
const SKRIPT = `# Mieten in Berlin
Warum steigen die Mieten in Berlin seit Jahren? Die Antwort ist einfacher, als viele denken. [Einblendung: Grafik Mieten] Der Mieten-Deckel wurde 2021 gekippt.
Seitdem zahlen viele Menschen dreißig Prozent mehr für ihre Wohnung. Das zeigen die Zahlen der Gewerkschaft sehr deutlich.
Die Löhne sind in derselben Zeit kaum gestiegen. Bei vielen geht inzwischen die Hälfte des Einkommens für die Miete drauf.
Dieser Satz steht nur im Manuskript und kommt im Video nirgends vor.

Und deshalb organisieren sich immer mehr Menschen in ihren Häusern. Sie gründen Haus Gemeinschaften und sprechen mit ihren Nachbarn.
Sie sammeln Unterschriften und gehen gemeinsam zur Hausverwaltung. In Neukölln hat eine Hausgemeinschaft so eine Mieterhöhung verhindert.
In Kreuzberg haben Nachbar:innen den Verkauf ihres Hauses gestoppt. Das klappt, weil viele zusammen mehr erreichen als eine Person allein.

Was können wir also tun? Erstens können wir uns im eigenen Haus zusammentun. Ein Aushang im Treppenhaus reicht oft für den Anfang.
Zweitens können wir die Initiativen in unserem Kiez unterstützen. Viele von ihnen suchen dringend Leute, die mitanpacken.
Drittens können wir Druck auf die Politik machen.

Der Volks-Entscheid zur Vergesellschaftung hat gezeigt, was möglich ist. Mehr als eine Million Menschen haben damals mit Ja gestimmt.
Das waren 59 Prozent der gültigen Stimmen. Umgesetzt ist der Entscheid bis heute nicht.
Deshalb braucht es weiter Solidarität zwischen den Häusern und den Kiezen. Solidarität heißt hier ganz praktisch, dass niemand allein vor dem Vermieter steht.

Am Ende zählt, dass wir zusammenhalten. Eine Stadt gehört den Menschen, die in ihr leben. Wohnen ist ein Grundbedürfnis.
Darum bleiben wir dran, Haus für Haus und Kiez für Kiez. Wenn dir dieses Video geholfen hat, dann teile es mit deinen Nachbarn.
Wir sehen uns beim nächsten Treffen der Initiative.`;
const text = () => ev(() => tokens.filter(t => t.type === 'word').map(t => tokText(t)).filter(Boolean).join(' '));

try {
  const id = await newProject(page, [MEDIA + 'serie.mp4']); made.push(id); await transcribe(page);
  await ev(() => setTab('text')); await sleep(300);
  const t0 = await text(), n0 = await ev(() => ({ words: tokens.filter(t => t.type === 'word').length, cues: P.cues.length, undo: undo.length }));
  chk('Im Menü „⋯“ steht „Skript abgleichen“; der Knopf „Skript“ erscheint erst nach einem Abgleich', await ev(() => !!document.querySelector('#textMoreBtns #scriptChip') && document.querySelector('#scriptBtn').classList.contains('hidden')));
  await ev(() => document.querySelector('#scriptChip').click()); await page.waitForSelector('#skText');
  await page.click('#skGo');
  chk('Ohne Manuskript geschieht nichts außer einem Hinweis', /Manuskript einfügen/.test(await toast()) && await ev(() => !P.script && !!document.querySelector('#skText')));
  await page.fill('#skText', SKRIPT); await page.click('#skGo'); await page.waitForSelector('#skSum'); await sleep(300);
  const r = await ev(() => ({ st: P.script.stats, free: P.script.free, miss: P.script.miss, sum: document.querySelector('#skSum').textContent, fr: document.querySelectorAll('#skFree .mk-row').length, ms: document.querySelectorAll('#skMiss .mk-row').length,
    btn: document.querySelector('#scriptBtn').textContent, hid: document.querySelector('#scriptBtn').classList.contains('hidden'), undo: undo.length, toast: document.querySelector('#toast').textContent }));
  const t1 = await text();
  chk('Abgleich: der dritte Absatz gilt als frei gesprochen, ein Satz des Manuskripts als ausgelassen', r.free.length === 1 && r.miss.length === 1 && r.fr === 1 && r.ms === 1 && /nur im Manuskript/.test(r.miss[0].text) && r.miss[0].n === 12, { free: r.free, miss: r.miss });
  chk('Die frei gesprochene Stelle reicht von „Wer sich organisiert“ bis „lassen sich ändern.“', await ev(([a, b]) => /^Wer$/.test(tokText(tokens[a])) && /^ändern\.$/.test(tokText(tokens[b])), r.free[0]), r.free[0]);
  chk('Übersicht: Anteil der Übereinstimmung, Zahl der angepassten Stellen, Knopf „Skript (2)“ und ein Schritt im Verlauf', /% der gesprochenen Wörter/.test(r.sum) && r.st.same >= r.st.spoken - 30 && r.st.fixed >= 5 && r.btn === 'Skript (2)' && !r.hid && r.undo === n0.undo + 1 && /stimmen überein/.test(r.toast), { sum: r.sum, st: r.st });
  chk('Schreibweisen aus dem Manuskript: „Mieten-Deckel“, „dreißig“, „Nachbar:innen“, „Volks-Entscheid“', /Der Mieten-Deckel wurde 2021/.test(t1) && /Menschen dreißig Prozent/.test(t1) && /haben Nachbar:innen den/.test(t1) && /Der Volks-Entscheid zur/.test(t1), t1.slice(0, 200));
  chk('Zwei gesprochene Wörter werden ein geschriebenes („mitanpacken“), ein gesprochenes wird zwei („Haus Gemeinschaften“)', /die mitanpacken\. Drittens/.test(t1) && /gründen Haus Gemeinschaften und/.test(t1), t1.match(/Leute, die .{0,30}/));
  chk('Alles andere bleibt, wie es war: der frei gesprochene Absatz und die Zahl 59', /Wer sich organisiert, kennt seine Rechte besser\./.test(t1) && /waren 59 Prozent/.test(t1) && !/nur im Manuskript/.test(t1) && !/Einblendung|# Mieten/.test(t1));
  const marks = await ev(() => ({ fr: [...document.querySelectorAll('#transcript .tk.fr, #paneText .tk.fr')].map(s => s.textContent), ms: [...document.querySelectorAll('#paneText .tk.ms')].map(s => s.textContent), ed: document.querySelectorAll('#paneText .tk.edited').length }));
  chk('Im Text sind die frei gesprochenen Wörter hinterlegt, ⌄ steht hinter „drauf.“, geänderte Wörter sind unterstrichen', marks.fr.length >= 20 && marks.fr[0] === 'Wer' && marks.ms.length === 1 && /drauf\./.test(marks.ms[0]) && marks.ed >= 5, { fr: marks.fr.length, ms: marks.ms, ed: marks.ed });
  // Sprung aus der Liste
  await page.click('#skFree .mk-go'); await sleep(400);
  const at = await ev(a => ({ out: outPos, want: srcToOut(tokens[a].ws) }), r.free[0][0]);
  chk('Ein Klick in der Liste springt zur Stelle', Math.abs(at.out - at.want) < 0.2, at);
  // Untertitel folgen
  chk('Untertitel zeigen die Schreibweisen des Manuskripts', await ev(() => P.cues.some(c => /Mieten-Deckel/.test(c.text != null ? c.text : autoText(c)))));
  await page.click('#skOk'); await sleep(200);
  // Rückgängig / Wiederholen
  await page.click('#undoBtn'); await sleep(300);
  const u = await ev(() => ({ sc: !!P.script, fr: document.querySelectorAll('#paneText .tk.fr').length, hid: document.querySelector('#scriptBtn').classList.contains('hidden') })), tu = await text();
  await page.click('#redoBtn'); await sleep(300);
  const tr = await text(), frR = await ev(() => document.querySelectorAll('#paneText .tk.fr').length);
  chk('„Rückgängig“ nimmt Schreibweisen und Markierungen in einem Schritt zurück, „Wiederholen“ bringt sie wieder', !u.sc && u.fr === 0 && u.hid && tu === t0 && tr === t1 && frR >= 20, { u, gleich0: tu === t0, gleich1: tr === t1, frR });
  // erneuter Abgleich mit demselben Manuskript ändert nichts mehr
  await ev(() => document.querySelector('#scriptBtn').click()); await page.waitForSelector('#skAgain'); await page.click('#skAgain'); await page.waitForSelector('#skText');
  chk('„Neu abgleichen“ zeigt das gemerkte Manuskript', (await ev(() => document.querySelector('#skText').value)).startsWith('# Mieten in Berlin'));
  await page.click('#skGo'); await page.waitForSelector('#skSum'); await sleep(200);
  const again = await ev(() => P.script.stats);
  chk('Ein zweiter Abgleich mit demselben Manuskript passt nichts mehr an', again.fixed === 0 && await text() === t1, again);
  // ohne Übernahme: nur Markierungen
  await page.click('#undoBtn'); await sleep(200); await page.click('#undoBtn'); await sleep(300);
  await ev(() => document.querySelector('#scriptChip').click()); await page.waitForSelector('#skText'); await page.fill('#skText', SKRIPT); await page.uncheck('#skAdopt'); await page.click('#skGo'); await page.waitForSelector('#skSum'); await sleep(200);
  const only = await ev(() => ({ st: P.script.stats, fr: P.script.free.length, ms: P.script.miss.length }));
  chk('Ohne „Schreibweisen übernehmen“ bleibt der Text unverändert, die Markierungen kommen trotzdem', only.st.fixed === 0 && only.fr === 1 && only.ms === 1 && await text() === t0, only);
  await page.click('#skOff'); await sleep(300);
  chk('„Markierungen entfernen“ räumt die Hinterlegung weg und merkt sich das Manuskript', await ev(() => !P.script.stats && P.script.text.length > 100 && document.querySelectorAll('#paneText .tk.fr, #paneText .tk.ms').length === 0 && document.querySelector('#scriptBtn').classList.contains('hidden')));
  // fremdes Manuskript
  await ev(() => document.querySelector('#scriptChip').click()); await page.waitForSelector('#skText');
  await page.fill('#skText', 'Ein ganz anderer Text über Segelboote, Wetterkarten und die Gezeiten an der Nordsee. Mit dem Video hat er nichts zu tun, kein einziger Satz kommt darin vor.'); await page.click('#skGo'); await page.waitForSelector('#skSum'); await sleep(200);
  chk('Passt das Manuskript nicht zum Video, fragt HoneyCut nach dem richtigen Skript', /richtige Skript/.test(await toast()), await toast());
  await page.click('#skOk'); await page.click('#undoBtn'); await sleep(200);
  // Speichern und Wiederöffnen
  await ev(() => document.querySelector('#scriptChip').click()); await page.waitForSelector('#skText'); await page.fill('#skText', SKRIPT); await page.click('#skGo'); await page.waitForSelector('#skSum'); await page.click('#skOk');
  await ev(() => { saveNow(); closeProject(); }); await sleep(300); await ev(i => openProject(i), id); await page.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i, id); await sleep(500);
  chk('Nach Schließen und Öffnen sind Abgleich und Markierungen noch da', await ev(() => !!(P.script && P.script.stats) && document.querySelectorAll('#paneText .tk.fr').length >= 20 && document.querySelector('#scriptBtn').textContent === 'Skript (2)') && await text() === t1);

  // ═════════ Rechenkern direkt ═════════
  const k = await ev(() => {
    const sp = s => s.split(' ').map((w, i) => ({ i: 100 + i, text: w }));
    const a = Skript.compare(sp('heute sprechen wir über den mieten deckel in berlin ähm und das sage ich hier ganz deutlich zwanzig prozent zahlen mehr'), 'Heute sprechen wir über den Mietendeckel in Berlin. 20 Prozent zahlen mehr.');
    const w = Skript.words('# Titel\nEins zwei [Regie: Schnitt] drei – vier.\n\n# noch eine\nfünf!');
    const voc = 'die der und in zu den das nicht von sie ist des sich mit dem dass er es ein ich auf so eine auch als an nach wie im für man aber aus durch wenn nur war noch'.split(' '); let seed = 5; const rnd = () => (seed = seed * 16807 % 2147483647) / 2147483647;
    const big = Array.from({ length: 12000 }, () => voc[Math.floor(rnd() * voc.length)] + (rnd() < 0.2 ? Math.floor(rnd() * 900) : '')), sp2 = []; big.forEach((x, i) => { if (i >= 5000 && i < 5200) return; sp2.push(x); });
    const t0 = performance.now(), b = Skript.compare(sp2.map((x, i) => ({ i, text: x })), big.join(' ')), ms = performance.now() - t0;
    return { a: { pairs: a.pairs.map(p => p.ids.join('+') + '→' + p.text), free: a.free, miss: a.miss.length, same: a.stats.same }, w: w.map(x => x.w), like: [Skript.like('hermeyer', 'hermeier'), Skript.like('zwanzig', '20'), Skript.like('einundzwanzig', '21'), Skript.like('drei', '4'), Skript.like('haus', 'maus'), Skript.like('und', 'uns')],
      b: { same: b.stats.same, miss: b.miss.map(m => m.n), free: b.free.length, ms: Math.round(ms) }, leer: Skript.compare([], 'Text ohne Video.').stats.share };
  });
  chk('Kern: Großschreibung, Satzzeichen, zusammengeschriebenes Wort und Zahl kommen aus dem Manuskript', k.a.pairs.join('|') === '100→Heute|105+106→Mietendeckel|108→Berlin.|117→20|118→Prozent|120→mehr.', k.a.pairs);
  chk('Kern: Füllwörter zählen nicht mit; die freie Stelle beginnt und endet richtig', k.a.free.length === 1 && k.a.free[0].a === 109 && k.a.free[0].b === 116 && k.a.free[0].n === 7 && k.a.miss === 0, k.a.free);
  chk('Kern: Überschriften und Regieanweisungen bleiben außen vor, ein Gedankenstrich hängt am Wort davor', k.w.join('|') === 'Eins|zwei|drei –|vier.|fünf!', k.w);
  chk('Kern: Ähnlichkeit – Schreibweise und Zahlwort gelten als gleich, kurze verschiedene Wörter nicht', k.like.join() === '1,1,1,0,0,0', k.like);
  chk('Kern: 12 000 Wörter mit einer Lücke von 200 – alles zugeordnet, in unter fünf Sekunden', k.b.same === 11800 && k.b.miss.join() === '200' && k.b.free === 0 && k.b.ms < 5000, k.b);
  chk('Kern: Ohne Transkript entsteht kein Ergebnis mit Anteil', k.leer === 0);
} catch (e){ chk('Prüfung abgebrochen', false, String((e && e.stack) || e).replace(/\s+/g, ' ').slice(0, 500)); }

chk('keine Fehlermeldungen der Seite', logs.length === 0, logs.slice(0, 6));
for (const id of made) await dropScratch(page, id).catch(() => {});
await ende(browser);
