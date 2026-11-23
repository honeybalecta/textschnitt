// Skript vor dem Transkribieren (2.51): Skript einfügen oder aus einer Datei laden, ehe transkribiert wird. Begriffe daraus gehen als
// Hinweis an Whisper; danach bringt HoneyCut mehrere Videos in die Reihenfolge des Skripts und übernimmt die Schreibweisen.
// Grundlage: serie.mp4 in drei Teile geschnitten (Absätze 1–2, 3–4, 5–6), absichtlich in falscher Reihenfolge angelegt.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, newProject, transcribe, dropScratch, sleep, pruefung, MEDIA, WORK } from './drv.mjs';
const { chk, ende } = pruefung('Skript vor dem Transkribieren');
const { browser, page, logs } = await launch();
const ev = (f, a) => page.evaluate(f, a);
const made = [];
const toast = () => ev(() => document.querySelector('#toast').textContent);
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

// ── Teile von serie.mp4 mit eigenem Transkript (die Attrappe liest <Datei>.words.json) ──
const words = JSON.parse(fs.readFileSync(MEDIA + 'serie.words.json', 'utf8'));
const W = w => String(w.text || w.word || '').trim();
const startOf = (wort, nach) => words.findIndex((w, k) => k > (nach ?? -1) && W(w) === wort);
const iB = startOf('Wer'), iC = startOf('Der', startOf('Drittens'));
const cut = q => q < words.length ? r3((words[q - 1].end + words[q].start) / 2) : null;
function r3(x){ return Math.round(x * 1000) / 1000; }
const teile = [['vorab_a', 0, iB], ['vorab_b', iB, iC], ['vorab_c', iC, words.length]].map(([name, a, b]) => {
  const t0 = a ? cut(a) : 0, t1 = b < words.length ? cut(b) : null, file = MEDIA + name + '.mp4';
  if (!fs.existsSync(file)) execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(t0), ...(t1 ? ['-to', String(t1)] : []), '-i', MEDIA + 'serie.mp4', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', file]);
  fs.writeFileSync(MEDIA + name + '.words.json', JSON.stringify(words.slice(a, b).map(w => ({...w, start: r3(w.start - t0), end: r3(w.end - t0)}))));
  return file;
});
const text = () => ev(() => tokens.filter(t => t.type === 'word').map(t => tokText(t)).filter(Boolean).join(' '));
const hint = () => { try { return JSON.parse(fs.readFileSync(path.join(WORK, 'hint.json'), 'utf8')).hint || ''; } catch(_){ return ''; } };

try {
  chk('Testteile: drei Stücke an Absatzgrenzen', iB > 0 && iC > iB, { iB, iC, n: words.length });
  // Falsche Reihenfolge: Schluss, Anfang, Mitte
  const id = await newProject(page, [teile[2], teile[0], teile[1]]); made.push(id); await sleep(300);
  const v0 = await ev(() => ({ info: document.querySelector('#preScriptInfo').textContent, btn: document.querySelector('#preScriptBtn').textContent, opts: document.querySelector('#preScriptOpts').classList.contains('hidden'), names: P.sources.map(s => s.name) }));
  chk('Im Reiter „Transkribieren“ steht „Skript zum Abgleichen: keins“ mit dem Knopf „Einfügen“', v0.info === 'keins' && v0.btn === 'Einfügen' && v0.opts, v0);
  await page.click('#preScriptBtn'); await page.waitForSelector('#psText');
  await page.click('#psGo');
  chk('Ohne Text geschieht nichts außer einem Hinweis', /Skript einfügen/.test(await toast()) && await ev(() => !P.script));
  // Word-Datei mit Überschrift und Regieanweisung
  const docx = path.join(WORK, 'skript-vorab.docx');
  execFileSync('python3', ['-c', `
import zipfile, sys, html
paras = sys.argv[2].split("\\n")
def p(t, h=False):
    st = '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>' if h else ''
    return '<w:p>' + st + '<w:r><w:t xml:space="preserve">' + html.escape(t) + '</w:t></w:r></w:p>'
body = ''.join(p(l[2:], True) if l.startswith('# ') else p(l) for l in paras)
doc = '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' + body + '</w:body></w:document>'
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
    z.writestr('word/document.xml', doc)
`, docx, SKRIPT]);
  await page.setInputFiles('#psFile', docx); await page.waitForFunction(() => document.querySelector('#psText').value.length > 100, null, { timeout: 10000 });
  const fromDoc = await ev(() => document.querySelector('#psText').value);
  chk('Word-Datei: Text kommt ins Feld, die Überschrift mit #, damit sie beim Abgleich außen vor bleibt', fromDoc.startsWith('# Mieten in Berlin') && /Der Mieten-Deckel wurde 2021 gekippt\./.test(fromDoc) && /Wir sehen uns beim nächsten Treffen der Initiative\.$/.test(fromDoc), fromDoc.slice(0, 120));
  await page.click('#psGo'); await sleep(300);
  const v1 = await ev(() => ({ info: document.querySelector('#preScriptInfo').textContent, btn: document.querySelector('#preScriptBtn').textContent, opts: !document.querySelector('#preScriptOpts').classList.contains('hidden'), sortRow: !document.querySelector('#preScriptSortRow').classList.contains('hidden'), adopt: document.querySelector('#preScriptAdopt').checked, sort: document.querySelector('#preScriptSort').checked, sc: P.script }));
  chk('Nach „Übernehmen“: Wortzahl, Knopf „Ändern“, beide Haken gesetzt (Schreibweisen, Reihenfolge)', /^\d+ Wörter$/.test(v1.info) && v1.btn === 'Ändern' && v1.opts && v1.sortRow && v1.adopt && v1.sort && v1.sc.text.length > 100 && !v1.sc.stats, v1);
  const terms = await ev(() => transHint());
  chk('Hinweis an Whisper: Begriffe aus dem Skript – gegenderte Formen, Bindestrich-Wörter, Namen', /Nachbar:innen/.test(terms) && /Mieten-Deckel/.test(terms) && /Volks-Entscheid/.test(terms) && /Neukölln/.test(terms) && terms.length <= 580, terms);
  await ev(() => { saveNow(); closeProject(); }); await sleep(300); await ev(i => openProject(i), id); await page.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i, id); await ev(() => setTab('trans')); await sleep(400);
  chk('Das Skript bleibt beim Projekt gemerkt', await ev(() => !!(P.script && P.script.text.length > 100) && /Wörter$/.test(document.querySelector('#preScriptInfo').textContent)));

  await transcribe(page); await sleep(500);
  const h = hint();
  chk('Der Hinweis ist bei der Transkription angekommen', /Nachbar:innen/.test(h) && /Volks-Entscheid/.test(h), h.slice(0, 200));
  const r = await ev(() => ({ names: P.sources.map(s => s.name), offs: P.sources.map(s => s.off), durs: P.sources.map(s => s.duration),
    mono: tokens.every((t, i) => !i || t.s >= tokens[i - 1].s - 0.001), inSrc: tokens.every(t => t.s >= P.sources[t.src].off - 0.002 && t.e <= P.sources[t.src].off + P.sources[t.src].duration + 0.002),
    srcOrder: tokens.every((t, i) => !i || t.src >= tokens[i - 1].src), ids: tokens.every((t, i) => t.i === i), st: P.script && P.script.stats, adopt: P.script && P.script.adopt, sort: P.script && P.script.sort }));
  chk('Die Videos stehen danach in der Reihenfolge des Skripts', r.names.join() === 'vorab_a.mp4,vorab_b.mp4,vorab_c.mp4', r.names);
  chk('Zeiten, Videos und Wortnummern passen zur neuen Reihenfolge', r.mono && r.inSrc && r.srcOrder && r.ids && Math.abs(r.offs[1] - r.durs[0]) < 0.002 && Math.abs(r.offs[2] - r.durs[0] - r.durs[1]) < 0.002, r);
  const t1 = await text();
  chk('Der Text beginnt mit dem Anfang des Skripts und endet mit seinem Schluss', /^Warum steigen die Mieten/.test(t1) && /Treffen der Initiative\.$/.test(t1), [t1.slice(0, 60), t1.slice(-60)]);
  chk('Schreibweisen aus dem Skript sind übernommen: „Mieten-Deckel“, „dreißig“, „Nachbar:innen“, „Volks-Entscheid“', /Der Mieten-Deckel wurde 2021/.test(t1) && /Menschen dreißig Prozent/.test(t1) && /haben Nachbar:innen den/.test(t1) && /Der Volks-Entscheid zur/.test(t1), t1.slice(0, 200));
  chk('Frei Gesprochenes bleibt, wie es gesagt wurde; der Abgleich steht im Projekt (Knopf „Skript“)', /Wer sich organisiert, kennt seine Rechte besser\./.test(t1) && r.st && r.st.fixed >= 5 && r.adopt !== false && r.sort !== false && await ev(() => !document.querySelector('#scriptBtn').classList.contains('hidden')), r.st);
  chk('Die Meldung nennt das Ordnen und den Abgleich', /nach dem Skript geordnet/.test(await toast()) && /% wie im Skript/.test(await toast()), await toast());
  chk('Untertitel folgen der neuen Reihenfolge und den Schreibweisen', await ev(() => { const c = computedCues(); return c.length > 5 && /Warum/.test(c[0].text) && c.every((x, k) => !k || x.s >= c[k - 1].s - 0.001) && c.some(x => /Mieten-Deckel/.test(x.text)); }));
  chk('Wiedergabe: das erste Video läuft zuerst', await ev(() => timeline.length > 0 && timeline[0].si === 0 && P.sources[0].name === 'vorab_a.mp4'));
  chk('Nach der Transkription heißt der Knopf „Abgleichen“ und öffnet „Skript abgleichen“', await ev(() => document.querySelector('#preScriptBtn').textContent === 'Abgleichen' && document.querySelector('#preScriptOpts').classList.contains('hidden')));
  await page.click('#undoBtn'); await sleep(300);
  chk('„Rückgängig“ nimmt den Abgleich zurück; die Reihenfolge bleibt', await ev(() => !(P.script && P.script.stats) && P.sources[0].name === 'vorab_a.mp4') && !/Mieten-Deckel/.test(await text()));

  // Ohne Haken „Reihenfolge“: Videos bleiben, wie sie angelegt wurden
  await ev(() => { saveNow(); closeProject(); }); await sleep(300);
  const id2 = await newProject(page, [teile[2], teile[0], teile[1]]); made.push(id2); await sleep(300);
  await page.click('#preScriptBtn'); await page.waitForSelector('#psText'); await page.fill('#psText', SKRIPT); await page.click('#psGo'); await sleep(200);
  await page.uncheck('#preScriptSort'); await page.uncheck('#preScriptAdopt');
  await transcribe(page); await sleep(500);
  const r2 = await ev(() => ({ names: P.sources.map(s => s.name), st: P.script && P.script.stats }));
  const t2 = await text();
  chk('Ohne Haken bleiben Reihenfolge und Schreibweisen, wie sie sind; markiert wird trotzdem', r2.names.join() === 'vorab_c.mp4,vorab_a.mp4,vorab_b.mp4' && /^Der Volksentscheid/.test(t2) && !/Mieten-Deckel/.test(t2) && r2.st && r2.st.fixed === 0, { names: r2.names, st: r2.st, t: t2.slice(0, 60) });

  // Ein Video allein: kein Haken für die Reihenfolge
  await ev(() => { saveNow(); closeProject(); }); await sleep(300);
  const id3 = await newProject(page, [MEDIA + 'serie.mp4']); made.push(id3); await sleep(300);
  await page.click('#preScriptBtn'); await page.waitForSelector('#psText'); await page.fill('#psText', SKRIPT); await page.click('#psGo'); await sleep(200);
  chk('Mit nur einem Video gibt es keinen Haken für die Reihenfolge', await ev(() => document.querySelector('#preScriptSortRow').classList.contains('hidden') && !document.querySelector('#preScriptOpts').classList.contains('hidden')));
  await page.click('#preScriptBtn'); await page.waitForSelector('#psDel'); await page.click('#psDel'); await sleep(200);
  chk('„Entfernen“ nimmt das Skript wieder heraus', await ev(() => !P.script && document.querySelector('#preScriptInfo').textContent === 'keins'));

  // Kern
  const k = await ev(() => { const w = Skript.words('Eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf').map(x => x.w);
    return { a: Skript.place(w.slice(8), w.join(' ')).at, b: Skript.place(w.slice(0, 4), w.join(' ')).at, none: Skript.place(['Segelboot', 'Nordsee', 'Gezeiten'], w.join(' ')).n,
      t: Skript.terms('Die SPD und die Grünen. Gestern sprach Eralp mit Nachbar:innen über das 49-Euro-Ticket. Das Haus ist alt.', 100) }; });
  chk('Kern: Lage im Skript (hinten > vorne), fremder Text ohne Fundstelle; Begriffe ohne Allerweltswörter', k.a > 0.6 && k.b < 0.3 && k.none === 0 && k.t.includes('SPD') && k.t.includes('Eralp') && k.t.includes('Nachbar:innen') && k.t.includes('49-Euro-Ticket') && !k.t.includes('Haus') && !k.t.includes('Grünen'), k);
} catch (e){ chk('Prüfung abgebrochen', false, String((e && e.stack) || e).replace(/\s+/g, ' ').slice(0, 500)); }

chk('keine Fehlermeldungen der Seite', logs.length === 0, logs.slice(0, 6));
for (const id of made) await dropScratch(page, id).catch(() => {});
await ende(browser);
