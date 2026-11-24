// Pfad-Videos (2.52): Pläne aus ScriptGenius (eigenes Programm, Repository honeybalecta/scriptgenius) und die Pfad-Videos in HoneyCut.
// Die Oberfläche von ScriptGenius prüft dessen eigener Prüflauf; hier geht es um die gemeinsame Ablage der Pläne (Ordner, über das
// Test-Backend in .work/sg-plaene) und – wenn lauf.sh ScriptGenius bereitstellen konnte (SCRIPTGENIUS_DIR) – um das eingebettete ScriptGenius.
// Grundlage ist pfade.mp4: eine Aufnahme nach einem Plan mit zwei Weichen, jedes Bild trägt seine Nummer (siehe medien.py).
// Am fertigen Video wird Bild für Bild abgelesen, welche Stellen der Aufnahme in welcher Reihenfolge darin stehen.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, newProject, sleep, pruefung, setPick, watch, MEDIA, OUT, HERE, WORK, BASE, fmt } from './drv.mjs';

const { chk, ende } = pruefung('Pfad-Videos');
const { browser, ctx, page, logs } = await launch();
const ev = (f, a) => page.evaluate(f, a);
const shot = (name, pg = page) => pg.screenshot({ path: path.join(OUT, `pfade-${name}.png`) });
const meta = JSON.parse(fs.readFileSync(MEDIA + 'pfade.json', 'utf8')), SEC = meta.secs, FPS = meta.fps;
const made = [], trash = new Set();
const toastTxt = (pg = page) => pg.evaluate(() => document.querySelector('#toast').textContent);
const idle = (t = 300000) => page.waitForFunction(() => !exBatch && !exDirect && EXQ.every(x => x.status !== 'wait' && x.status !== 'run'), null, { timeout: t });
const q = () => ev(() => EXQ.map(x => ({ name: x.name, st: x.status, err: x.error, proj: x.proj, files: (x.result && x.result.files) || [] })));
const clearQ = async () => { for (const x of await q()) for (const f of x.files) trash.add(f); await ev(() => { EXQ.length = 0; paintQueue(); }); };
const open = async id => { await ev(i => { if (P && P.id === i) return; closeSheet(); if (P) closeProject(); openProject(i); }, id); await page.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i, id, { timeout: 30000 }); await sleep(500); };
// Läufe aufeinanderfolgender Quellbilder im fertigen Video, in Sekunden der Aufnahme: [[von, bis], …]
const runs = f => { const r = JSON.parse(execFileSync('python3', [path.join(HERE, 'takt_lesen.py'), f], { maxBuffer: 1 << 28 }).toString()), out = [];
  for (const [, n] of r.frames){ if (n == null) continue; const l = out[out.length - 1]; if (l && n - l[1] >= 0 && n - l[1] <= 2) l[1] = n; else out.push([n, n]); }
  return out.filter(([a, b]) => b - a >= 3).map(([a, b]) => [a / FPS, b / FPS]); };
// Deckt ein Lauf den Abschnitt der Aufnahme ab (Wörter des Abschnitts liegen darin, der nächste Abschnitt beginnt nicht darin)?
const covers = (run, name, from) => run[0] <= (from ?? SEC[name].start) + 0.15 && run[0] >= (from ?? SEC[name].start) - 1.0 && run[1] >= SEC[name].end - 0.15 && run[1] <= SEC[name].end + 1.0;
const seq = (rs, names, firstFrom) => rs.length === names.length && names.every((n, k) => covers(rs[k], n, k === 0 ? firstFrom : undefined));
const exportAll = async click => { await click(); await page.waitForFunction(() => !exBatch, null, { timeout: 240000 }); await sleep(500); await idle(); await sleep(300); await ev(() => closeSheet()); const res = await q(); for (const x of res) for (const f of x.files) trash.add(f); return res; };
const mp4 = x => x.files.find(f => /\.mp4$/.test(f));

const PLANS = path.join(WORK, 'sg-plaene'); fs.rmSync(PLANS, { recursive: true, force: true });
const planFiles = () => fs.existsSync(PLANS) ? fs.readdirSync(PLANS).filter(f => f.endsWith('.scriptgenius')).sort() : [];
const SG = !!process.env.SCRIPTGENIUS_DIR && fs.existsSync(path.join(process.env.SCRIPTGENIUS_DIR, 'sg-core.js'));
const sgFrame = async () => { await page.waitForSelector('#sgOverlay iframe'); const f = page.frames().find(x => /\/sg\/index\.html/.test(x.url())); await f.waitForFunction(() => document.documentElement.classList.contains('ready')); return f; };
await ev(() => { for (const k of ['sg-plans', 'sg-current', 'hc-house', 'hc-house-def']) localStorage.removeItem(k); EXQ.length = 0;
  for (const p of JSON.parse(TS.listProjects() || '[]')) if (/^pfade( |$)/.test(p.name || '')){ try { TS.deleteProject(p.id); } catch (_) {} try { if (TS.trashPurge) TS.trashPurge(p.id); } catch (_) {} } });   // Reste eines abgebrochenen Laufs

// ══════════ 1) Rechenkern ══════════
let st = await ev(() => {
  const H = ScriptGenius, p = H.blank('Kern');
  const a = H.teil('Anfang', 'Guten Tag zusammen.'), w1 = H.weiche('Eins', ['A', 'B', 'C']), w2 = H.weiche('Zwei', ['X', 'Y']), w3 = H.weiche('Drei', ['M', 'N']), z = H.teil('Ende', 'Bis bald.');
  w1.outs.forEach((o, k) => o.text = 'Ausgang ' + 'ABC'[k] + ' ist eingetreten.'); w2.outs[0].text = 'Dazu kommt X.'; w2.outs[1].leer = true; w3.outs[0].text = 'M gilt.'; w3.outs[1].text = 'N gilt.';
  w2.when = {[w1.id]: [w1.outs[0].id, w1.outs[1].id]}; w3.when = {[w1.id]: [w1.outs[0].id], [w2.id]: [w2.outs[0].id]};
  z.alts = [H.alt({[w1.id]: [w1.outs[2].id]}, 'Bis bald, trotz C.'), H.alt({[w1.id]: [w1.outs[0].id], [w2.id]: [w2.outs[1].id]}, 'Bis bald, A ohne X.'), H.alt({[w1.id]: [w1.outs[0].id]}, 'Bis bald, mit A.')];
  p.blocks.push(a, w1, w2, w3, z); H.tidy(p);
  const P1 = H.paths(p), S = H.segs(p), by = new Map(S.map(s => [s.id, s]));
  const texts = P1.list.map(q => q.label + ' → ' + q.segs.map(s => by.get(s).text).join(' | '));
  // spätere Weiche in einer Bedingung, fremde Datei, zu viele Pfade
  const bad = JSON.parse(JSON.stringify(p)); bad.blocks[1].when = {[w3.id]: [w3.outs[0].id]}; const tb = H.parse(bad);
  let foreign = ''; try { H.parse('{"app":"etwas","blocks":[]}'); } catch(e){ foreign = e.message; }
  const big = H.blank('Viele'); for (let k = 0; k < 16; k++) big.blocks.push(H.weiche('W' + k, ['a', 'b']));
  const PB = H.paths(big, 50);
  return { count: P1.count, texts, segs: S.map(s => s.label + ':' + s.n), script: H.script(p), plain: H.script(p, { heads: false }), kept: !!tb.blocks[1].when, foreign, big: [PB.count, PB.list.length, PB.more],
    key: P1.list[0].key === P1.list[0].picks.map(x => x.w + '.' + x.o).join('~'), words: H.words('# Kopf\nDrei kurze Wörter [Regie] – hier.'), cond: H.condText(p, w3.when), rt: JSON.stringify(H.parse(JSON.stringify(p)).blocks) === JSON.stringify(p.blocks) };
});
chk('Pfade: Bedingungen an Weichen ergeben genau die möglichen Wege (6 statt 12)', st.count === 6 && st.texts.length === 6 && st.texts.filter(t => /^A · X · [MN] → /.test(t)).length === 2, st.texts);
chk('eine Weiche mit Bedingung fällt auf den übrigen Pfaden weg; ein Ausgang ohne eigenen Teil trägt nichts bei', st.texts.some(t => /^C → Guten Tag zusammen\. \| Ausgang C ist eingetreten\. \| Bis bald, trotz C\.$/.test(t)) && st.texts.some(t => /^B · Y → Guten Tag zusammen\. \| Ausgang B ist eingetreten\. \| Bis bald\.$/.test(t)), st.texts);
chk('abweichende Fassungen: die genaueste passende ersetzt den Standardtext', st.texts.some(t => /^A · Y → .*Bis bald, A ohne X\.$/.test(t)) && st.texts.filter(t => /Bis bald, mit A\.$/.test(t)).length === 2 && st.texts.filter(t => /\| Bis bald\.$/.test(t)).length === 2, st.texts);
chk('Abschnitte in Aufnahme-Reihenfolge mit der Zahl ihrer Videos', st.segs.join(' ') === 'Anfang:6 Eins: A:3 Eins: B:2 Eins: C:1 Zwei: X:3 Drei: M:1 Drei: N:1 Ende:2 Ende (C):1 Ende (A + Y):1 Ende (A):2', st.segs);
chk('Aufnahme-Skript: jeder Abschnitt einmal, mit Überschriften oder als reiner Text', (st.script.match(/^# /gm) || []).length === 11 && /^# Anfang\nGuten Tag zusammen\.\n\n# Eins: A\n/.test(st.script) && !/#/.test(st.plain) && st.plain.split('\n\n').length === 11, [(st.script.match(/^# /gm) || []).length, st.plain.split('\n\n').length, /#/.test(st.plain)]);
chk('Bedingungen auf spätere Weichen werden entfernt, fremde Dateien abgelehnt, sehr viele Pfade begrenzt', !st.kept && /kein Plan/.test(st.foreign) && st.big[0] === 20000 && st.big[1] === 50 && st.big[2] === true, [st.kept, st.foreign, st.big]);
chk('Schlüssel eines Pfads, Wortzahl ohne Überschriften und Regie, Bedingung in Worten, Datei bleibt beim Einlesen gleich', st.key && st.words === 4 && st.cond === 'A + X' && st.rt, [st.key, st.words, st.cond, st.rt]);

// ══════════ 2) Pläne aus ScriptGenius: gemeinsame Ablage, eingebettetes ScriptGenius ══════════
// Der Plan, wie ihn ScriptGenius anlegt: zwei Weichen, ein Ausgang ohne eigenen Teil, eine abweichende Fassung, ein Titel je Video
const planJson = await ev(() => { const H = ScriptGenius, p = H.blank('Mietendeckel');
  const a = H.teil('Einstieg', 'Heute entscheidet der Stadtrat über den Mietendeckel. Wir haben lange dafür gekämpft.');
  const w1 = H.weiche('Abstimmung', ['Angenommen', 'Abgelehnt']); w1.outs[0].text = 'Der Antrag ist angenommen. Die Mieten bleiben stabil.'; w1.outs[1].text = 'Der Antrag ist abgelehnt. Der Kampf geht weiter.';
  const m = H.teil('Einordnung', '');
  const w2 = H.weiche('Bürgerbegehren', ['Begehren kommt', 'Kein Begehren']); w2.outs[0].text = 'Außerdem startet jetzt das Bürgerbegehren.'; w2.outs[1].leer = true;
  const z = H.teil('Schluss', 'Kommt am Samstag zur Versammlung im Rathaus.'); z.alts = [H.alt({[w1.id]: [w1.outs[1].id]}, 'Kommt am Samstag zur Kundgebung vor dem Rathaus.')];
  p.blocks.push(a, w1, m, w2, z); H.tidy(p); p.paths[H.paths(p).list[0].key] = {title: 'Deckel steht'}; return JSON.stringify(p); });
st = await ev(j => ({ save: TS.sgSave(j), list: JSON.parse(TS.sgList()).map(p => p.name), plans: sgPlans().map(p => p.name) }), planJson);
chk('HoneyCut sichert Pläne im Ordner von ScriptGenius und liest sie von dort', st.save === '' && st.list.join() === 'Mietendeckel' && st.plans.join() === 'Mietendeckel' && planFiles().length === 1 && JSON.parse(fs.readFileSync(path.join(PLANS, planFiles()[0]), 'utf8')).app === 'scriptgenius', [st, planFiles()]);
st = await ev(() => ({ bad: TS.sgSave('{"app":"etwas","id":"x"}'), badId: TS.sgSave('{"app":"scriptgenius","id":"../x"}') }));
chk('fremde Dateien und unsichere Kennungen lehnt der Ordner ab', !!st.bad && !!st.badId && planFiles().length === 1, st);
st = await ev(() => ({ on: window.HC_SG_ON, home: document.querySelector('#planHome').textContent }));
if (!SG) console.log('HINWEIS eingebettetes ScriptGenius: nicht geprüft – kein SCRIPTGENIUS_DIR (lauf.sh baut es aus HC_SG_SRC oder von GitHub)');
else {
  await page.waitForFunction(() => window.HC_SG_ON === true, null, { timeout: 10000 });
  await page.click('#planHome'); let f = await sgFrame();
  st = await f.evaluate(() => ({ store: ScriptGeniusApp.store(), name: ScriptGeniusApp.plan.name, n: ScriptGeniusApp.plans.length, close: !document.querySelector('#closeBtn').classList.contains('hidden'), cut: document.querySelector('#cutBtn').classList.contains('hidden'), embed: document.documentElement.classList.contains('embed') }));
  chk('„Pfade planen“ öffnet das installierte ScriptGenius in HoneyCut – mit denselben Plänen', st.store === 'host' && st.name === 'Mietendeckel' && st.n === 1 && st.close && st.cut && st.embed, st);
  await shot('eingebettet');
  await f.click('#plansBtn'); await f.click('#modal [data-x="new"]'); await f.fill('#pName', 'Zweiter Plan'); await sleep(700);
  chk('ein neuer Plan aus dem eingebetteten ScriptGenius landet im gemeinsamen Ordner', planFiles().length === 2 && (await ev(() => sgPlans().map(p => p.name))).includes('Zweiter Plan'), planFiles());
  await f.click('#plansBtn'); await f.click('#modal .prow.cur [data-x="del"]'); await sleep(400);
  chk('Löschen verschiebt den Plan in den Papierkorb des Ordners', planFiles().length === 1 && fs.existsSync(path.join(PLANS, 'papierkorb')) && fs.readdirSync(path.join(PLANS, 'papierkorb')).length === 1, planFiles());
  await f.evaluate(() => document.querySelector('#modal [data-x="close"]').click());
  const fMd = path.join(OUT, 'pfade-eingebettet.md'); fs.rmSync(fMd, { force: true }); trash.add(fMd); setPick({ save_any: [fMd] });
  await f.click('#exportBtn'); await f.click('#modal [data-f="md"] [data-x="go"]'); await sleep(800);
  chk('Exportieren im eingebetteten ScriptGenius speichert über HoneyCut', fs.existsSync(fMd) && /^# Mietendeckel\n/.test(fs.readFileSync(fMd, 'utf8')), fs.existsSync(fMd) ? fs.readFileSync(fMd, 'utf8').slice(0, 40) : 'fehlt');
  await f.evaluate(() => document.querySelector('#modal [data-x="close"]').click());
  await f.click('#closeBtn'); await sleep(300);
  chk('✕ schließt ScriptGenius und führt zurück zu HoneyCut', !(await ev(() => !!document.querySelector('#sgOverlay'))));
}
await ev(() => { localStorage.removeItem('sg-plans'); });

// ══════════ 3) HoneyCut: Plan laden, transkribieren, zuordnen ══════════
st = await ev(() => ({ home: !!document.querySelector('#planHome'), txt: document.querySelector('#planHome').textContent }));
chk('Startseite von HoneyCut: „Pfade planen“ führt zu ScriptGenius', st.home && /Pfade planen/.test(st.txt), st);
const idM = await newProject(page, [MEDIA + 'pfade.mp4']); made.push(idM);
st = await ev(() => ({ tab, info: document.querySelector('#pfInfo').textContent, btn: document.querySelector('#pfPlanBtn').textContent, chip: document.querySelector('#pfadeBtn').classList.contains('hidden') }));
chk('neues Projekt: im Reiter „Transkribieren“ steht „Pfad-Plan: keiner“, der Chip „Pfade“ fehlt noch', st.tab === 'trans' && st.info === 'keiner' && st.btn === 'Wählen' && st.chip, st);
await page.click('#pfPlanBtn'); await page.waitForSelector('#pfPick [data-a="load"]');
st = await ev(() => [...document.querySelectorAll('#pfPick .cl-row')].map(r => r.textContent.replace(/\s+/g, ' ').trim()));
chk('das Blatt „Pfad-Plan“ zeigt die Pläne aus ScriptGenius', st.length === 1 && /^Mietendeckel4 Videos · geändert am .*Laden$/.test(st[0]), st);
if (SG){   // aus dem geöffneten Projekt: ScriptGenius öffnen und dort „Im Projekt verwenden“
  await page.click('#pfPick [data-a="app"]'); const f = await sgFrame();
  st = await f.evaluate(() => ({ cut: !document.querySelector('#cutBtn').classList.contains('hidden'), txt: document.querySelector('#cutBtn').textContent }));
  chk('im geöffneten Projekt bietet ScriptGenius „Im Projekt verwenden“', st.cut && st.txt === 'Im Projekt verwenden', st);
  await f.click('#cutBtn'); await page.waitForFunction(() => !document.querySelector('#sgOverlay') && P.pfade, null, { timeout: 10000 }); await sleep(300);
} else { await page.click('#pfPick [data-a="load"]'); await sleep(400); }
st = await ev(() => ({ info: document.querySelector('#pfInfo').textContent, btn: document.querySelector('#pfPlanBtn').textContent, pre: document.querySelector('#preScriptInfo').textContent, script: P.script && P.script.text, plan: P.script && P.script.plan === P.pfade.plan.id, toast: document.querySelector('#toast').textContent, sheet: document.querySelector('#sheet').classList.contains('hidden') }));
chk('Laden: Plan steht im Projekt, sein Aufnahme-Skript wird Vorlage für die Transkription', st.info === 'Mietendeckel · 4 Videos' && st.btn === 'Ändern' && /^\d+ Wörter · aus dem Pfad-Plan$/.test(st.pre) && /^# Einstieg\nHeute entscheidet/.test(st.script) && st.plan && /Plan „Mietendeckel“ geladen/.test(st.toast) && st.sheet, st);
await ev(() => { document.querySelector('#autoPauses').checked = false; document.querySelector('#autoFillers').checked = false; document.querySelector('#autoRepeats').checked = true; });
await page.click('#transBtn');
await page.waitForFunction(() => tokens.length > 0 && document.querySelector('#transCancel').classList.contains('hidden'), null, { timeout: 180000 }); await sleep(500);
const hint = JSON.parse(fs.readFileSync(path.join(WORK, 'hint.json'), 'utf8'));
st = await ev(() => { const c = pfCalc(), R = pfRanges(); return { toast: document.querySelector('#toast').textContent, secs: P.pfade.secs.map(x => c.by.get(x.seg).label + ': ' + secQuote(x, 30)), del: [...deleted].filter(i => tokens[i].type === 'word').map(i => tokText(tokens[i]).trim()), chip: document.querySelector('#pfadeBtn').textContent, chipOn: !document.querySelector('#pfadeBtn').classList.contains('hidden'),
  labels: [...document.querySelectorAll('#transcript .tk.pf0')].map(s => s.dataset.pf), marked: document.querySelectorAll('#transcript .tk.pf').length, words: tokens.filter(t => t.type === 'word').length, ranges: c.segs.map(s => R.get(s.id)) }; });
chk('nach der Transkription sind alle sieben Abschnitte des Plans in der Aufnahme gefunden', /7 von 7 Abschnitten des Plans gefunden/.test(st.toast) && st.secs.length === 7 && st.chip === 'Pfade (4/4)' && st.chipOn, [st.toast, st.chip]);
chk('jeder Abschnitt trägt seine Stelle: Text nach Skript, der freie Teil zwischen seinen Nachbarn', st.secs.join(' ¦ ') === 'Einstieg: Heute entscheidet der Stadtrat über den Mietendeckel. Wir haben lange dafür gekämpft. ¦ Abstimmung: Angenommen: Der Antrag ist angenommen. Die Mieten bleiben stabil. ¦ Abstimmung: Abgelehnt: Der Antrag ist abgelehnt. Der Kampf geht weiter. ¦ Einordnung: Das hier spreche ich frei und ohne Vorlage. ¦ Bürgerbegehren: Begehren kommt: Außerdem startet jetzt das Bürgerbegehren. ¦ Schluss: Kommt am Samstag zur Versammlung im Rathaus. ¦ Schluss (Abgelehnt): Kommt am Samstag zur Kundgebung vor dem Rathaus.', st.secs);
chk('„Wiederholungen weg“ nimmt nur den Anlauf im Einstieg – ähnliche Sätze in verschiedenen Ausgängen bleiben stehen', st.del.join(' ') === 'Heute entscheidet der', st.del);
chk('im Text steht am Anfang jedes Abschnitts seine Beschriftung, alle Wörter sind markiert', st.labels.join('|') === 'Einstieg|Abstimmung: Angenommen|Abstimmung: Abgelehnt|Einordnung|Bürgerbegehren: Begehren kommt|Schluss|Schluss (Abgelehnt)' && st.marked >= st.words, [st.labels, st.marked, st.words]);
chk('Begriffe aus dem Plan gehen als Hinweis an Whisper', /Bürgerbegehren/.test(hint.hint || ''), hint.hint);
chk('die Bereiche der Abschnitte überschneiden sich nicht', st.ranges.every((r, k) => r && (!k || r[0] >= st.ranges[k - 1][1] - 1e-6)), st.ranges);
await shot('text');

// Blatt „Pfade“: Abschnitte
await page.click('#pfadeBtn'); await page.waitForSelector('#pfSheet .pf-row');
st = await ev(() => ({ tabs: [...document.querySelectorAll('#pfSheet [data-view]')].map(b => b.textContent + (b.classList.contains('on') ? '*' : '')).join(' | '), rows: [...document.querySelectorAll('#pfSheet .pf-row')].map(r => r.querySelector('b').textContent + ' ¦ ' + r.querySelector('i').textContent), passive: document.querySelector('#sheet').classList.contains('passive') }));
chk('Blatt „Pfade“: Abschnitte mit Länge, Anfang des Textes und Zahl der Videos; der Text bleibt bedienbar', st.tabs === 'Abschnitte (7/7)* | Videos (4)' && st.rows.length === 7 && /^Einstieg ¦ \d,\d s · Heute entscheidet der Stadtrat über den … · in 4 Videos$/.test(st.rows[0]) && /^Schluss \(Abgelehnt\) ¦ \d,\d s · Kommt am Samstag zur Kundgebung vor … · in 2 Videos$/.test(st.rows[6]) && st.passive, st);
await shot('abschnitte');
// von Hand zuordnen: das letzte Wort der Einordnung („Vorlage.“) samt dem ersten des Begehrens wandert zum Schluss – und zurück
const before = await ev(() => ({ snap: snapshot(), secs: JSON.stringify(P.pfade.secs), undo: undo.length }));
await ev(() => { const w = t => order.findIndex(i => tokens[i].type === 'word' && tokText(tokens[i]).trim() === t); selA = order[w('Vorlage.')]; selB = order[w('Außerdem')]; showSel(); });
await page.click('#pfSheet .pf-row:nth-of-type(6) [data-a="set"]'); await sleep(300);
st = await ev(() => { const c = pfCalc(); return { secs: P.pfade.secs.map(x => c.by.get(x.seg).label + ': ' + secQuote(x, 30)).sort(), undo: undo.length, toast: document.querySelector('#toast').textContent, labels: [...document.querySelectorAll('#transcript .tk.pf0')].map(s => s.dataset.pf), sel: selA }; });
chk('„Zuordnen“ gibt die Markierung dem Abschnitt; Nachbarn geben ihre Wörter ab', st.secs.includes('Schluss: Vorlage. Außerdem') && st.secs.includes('Einordnung: Das hier spreche ich frei und ohne') && st.secs.includes('Bürgerbegehren: Begehren kommt: startet jetzt das Bürgerbegehren.') && st.undo === before.undo + 1 && /Zugeordnet/.test(st.toast) && st.sel == null, st);
chk('die Beschriftungen im Text folgen der neuen Zuordnung', st.labels.join('|') === 'Einstieg|Abstimmung: Angenommen|Abstimmung: Abgelehnt|Einordnung|Schluss|Bürgerbegehren: Begehren kommt|Schluss (Abgelehnt)', st.labels);
await page.click('#undoBtn'); await sleep(300);
st = await ev(() => ({ secs: JSON.stringify(P.pfade.secs), snap: snapshot(), rows: document.querySelectorAll('#pfSheet .pf-row').length }));
chk('„Rückgängig“ holt die Zuordnung zurück, das offene Blatt zieht nach', st.secs === before.secs && st.snap === before.snap && st.rows === 7);
await page.click('#pfSheet .pf-row:nth-of-type(4) [data-a="drop"]'); await sleep(250);
st = await ev(() => ({ row: document.querySelector('#pfSheet .pf-row:nth-of-type(4) i').textContent, tabs: document.querySelector('#pfSheet [data-view].on').textContent, chip: document.querySelector('#pfadeBtn').textContent, set: document.querySelector('#toast').textContent }));
chk('ohne Zuordnung fehlt der Abschnitt: kein Video ist mehr vollständig', /noch nicht zugeordnet/.test(st.row) && st.tabs === 'Abschnitte (6/7)' && st.chip === 'Pfade (0/4)', st);
await ev(() => clearSel()); await page.click('#pfSheet .pf-row:nth-of-type(4) [data-a="set"]'); await sleep(150);
chk('„Zuordnen“ ohne Markierung erklärt, was zu tun ist', /Erst im Text die Stelle markieren/.test(await toastTxt()), await toastTxt());
await page.click('#pfSheet [data-a="auto"]'); await sleep(300);
st = await ev(() => ({ segs: P.pfade.secs.map(x => x.seg).sort().join(), chip: document.querySelector('#pfadeBtn').textContent, toast: document.querySelector('#toast').textContent }));
chk('„Nach dem Skript zuordnen“ findet wieder alle Abschnitte', st.chip === 'Pfade (4/4)' && /7 von 7 Abschnitten gefunden/.test(st.toast) && st.segs === JSON.parse(before.secs).map(x => x.seg).sort().join(), [st.chip, st.toast]);

// ══════════ 4) Videos: Liste, „Was ist eingetreten?“, Export ══════════
await page.click('#pfSheet [data-view="vids"]'); await sleep(200);
st = await ev(() => ({ rows: [...document.querySelectorAll('#pfSheet .pf-vid')].map(r => r.querySelector('.mono').textContent + ' ' + r.querySelector('b').textContent + ' ¦ ' + r.querySelector('i').textContent), got: [...document.querySelectorAll('#pfSheet .pf-got')].map(g => [...g.querySelectorAll('button')].map(b => b.textContent).join('/')), all: document.querySelector('#pfSheet [data-a="vall"]').textContent, hit: !!document.querySelector('#pfHit') }));
chk('Videos: vier Pfade mit Länge; „Was ist eingetreten?“ fragt zuerst die erste Weiche', st.rows.length === 4 && /^1 Angenommen · Begehren kommt ¦ 0:\d\d$/.test(st.rows[0]) && /^4 Abgelehnt · Kein Begehren ¦ 0:\d\d$/.test(st.rows[3]) && st.got.join('|') === 'Angenommen/Abgelehnt' && st.all === 'Alle exportieren (4)' && !st.hit, st);
await page.click('#pfSheet .pf-got [data-o]:nth-child(2)'); await sleep(150);
st = await ev(() => [...document.querySelectorAll('#pfSheet .pf-got')].map(g => [...g.querySelectorAll('button')].map(b => b.textContent + (b.classList.contains('on') ? '*' : '')).join('/')));
chk('nach der ersten Entscheidung erscheint die nächste Weiche', st.join('|') === 'Angenommen/Abgelehnt*|Begehren kommt/Kein Begehren', st);
await ev(() => { const g = [...document.querySelectorAll('#pfSheet .pf-got')].pop(); g.querySelectorAll('button')[1].click(); }); await sleep(200);
st = await ev(() => ({ hit: document.querySelector('#pfHit') && document.querySelector('#pfHit').textContent, row: [...document.querySelectorAll('#pfSheet .pf-vid')].findIndex(r => r.classList.contains('hit')), got: Object.keys(P.pfade.got).length }));
chk('sind alle Weichen entschieden, steht das passende Video da und ist in der Liste hervorgehoben', /Das ist Video 4: Abgelehnt · Kein Begehren/.test(st.hit || '') && st.row === 3 && st.got === 2, st);
await shot('videos');
const mainBefore = await ev(() => ({ snap: snapshot(), undo: undo.length, pos: outPos }));
let res = await exportAll(() => page.click('#pfSheet [data-a="vhit"]'));
st = await ev(() => ({ id: P && P.id, tab, snap: snapshot(), undo: undo.length, vids: Object.keys(P.pfade.vids).length }));
chk('„Dieses Video exportieren“ rechnet genau ein Video und kehrt ins Projekt zurück', res.length === 1 && res[0].st === 'done' && res[0].name === 'pfade – Abgelehnt · Kein Begehren' && st.id === idM && st.tab === 'text' && st.snap === mainBefore.snap && st.undo === mainBefore.undo && st.vids === 1, [res.map(x => [x.name, x.st, x.err]), st.id, st.vids]);
let rs = mp4(res[0]) ? runs(mp4(res[0])) : [];
chk('im fertigen Video stehen der Reihe nach: Einstieg (ohne den Anlauf), „Abgelehnt“, Einordnung, Schluss für „Abgelehnt“', seq(rs, ['einstieg', 'abgelehnt', 'frei', 'schluss_abgelehnt'], 2.0), rs);
await clearQ();
res = await exportAll(async () => { await page.click('#pfadeBtn'); await page.waitForSelector('#pfSheet [data-a="vall"]'); await page.click('#pfSheet [data-a="vall"]'); });
chk('„Alle exportieren“ stellt je Pfad ein Video in die Warteschlange, benannt nach den Ausgängen', res.length === 4 && res.every(x => x.st === 'done') && res.map(x => x.name).join('|') === 'pfade – Angenommen · Begehren kommt|pfade – Angenommen · Kein Begehren|pfade – Abgelehnt · Begehren kommt|pfade – Abgelehnt · Kein Begehren', res.map(x => [x.name, x.st, x.err]));
const want = [['einstieg', 'angenommen', 'frei', 'begehren', 'schluss'], ['einstieg', 'angenommen', 'frei', 'schluss'], ['einstieg', 'abgelehnt', 'frei', 'begehren', 'schluss_abgelehnt'], ['einstieg', 'abgelehnt', 'frei', 'schluss_abgelehnt']];
const got = res.map(x => mp4(x) ? runs(mp4(x)) : []);
chk('jedes Video enthält genau die Abschnitte seines Pfads in der Reihenfolge des Plans', got.every((r, k) => seq(r, want[k], 2.0)), got);
const vids = await ev(() => { const pm = projMap(); return Object.values(P.pfade.vids).map(v => { const p = JSON.parse(TS.loadProject(v.id)); return { id: v.id, name: p.name, pfad: p.pfad && [p.pfad.main, p.pfad.k, p.pfad.n, p.pfad.label, !!p.pfad.own], clipOf: p.clipOf, plan: !!p.pfade, tpl: p.settings.coverTpl && p.settings.coverTpl.title, fmt: p.format || null, look: p.sub_style.look || null }; }); });
for (const v of vids) made.push(v.id);
chk('die Pfad-Videos sind eigene Projekte unter dem Hauptprojekt, in dessen Format und Untertitel-Stil', vids.length === 4 && vids.every(v => v.clipOf === idM && v.pfad && v.pfad[0] === idM && v.pfad[2] === 4 && !v.pfad[4] && !v.plan && v.fmt === null) && vids.map(v => v.pfad[1]).sort().join('') === '1234', vids);
chk('der Titel aus dem Plan steht im ersten Video als Titel fürs Titelbild bereit', vids.find(v => v.pfad[1] === 1).tpl === 'Deckel steht' && vids.filter(v => v.tpl).length === 1, vids.map(v => v.tpl));
await clearQ();

// ══════════ 5) Im Pfad-Video: Titelbild, Auffrischen, von Hand ändern ══════════
await page.click('#pfadeBtn'); await page.waitForSelector('#pfSheet .pf-vid'); await page.click('#pfSheet [data-view="vids"]').catch(() => {}); await sleep(150);
await page.click('#pfSheet .pf-vid:nth-of-type(1) [data-a="vopen"]');
const idV1 = vids.find(v => v.pfad[1] === 1).id;
await page.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i, idV1, { timeout: 30000 }); await sleep(600);
st = await ev(() => ({ tab, h: document.querySelector('#clipPfadH').textContent, info: document.querySelector('#clipPfadInfo').textContent, card: !document.querySelector('#clipPfadCard').classList.contains('hidden'), own: document.querySelector('#clipPfadOwn').textContent, total: +total.toFixed(1), chip: document.querySelector('#pfadeBtn').classList.contains('hidden'), text: order.filter(i => tokens[i].type === 'word' && !isCut(i)).map(i => tokText(tokens[i]).trim()).join(' ') }));
chk('ein Video aus der Liste öffnet sich als Clip: Karte „Pfad-Video 1 von 4“ erklärt, woher Schnitt und Gestaltung kommen', st.tab === 'clip' && st.h === 'Pfad-Video 1 von 4: Angenommen · Begehren kommt' && /kommen aus dem Hauptprojekt/.test(st.info) && st.card && st.own === 'Von Hand weiterbearbeiten' && st.chip, st);
chk('sein Text ist der des Pfads', st.text === 'Heute entscheidet der Stadtrat über den Mietendeckel. Wir haben lange dafür gekämpft. Der Antrag ist angenommen. Die Mieten bleiben stabil. Das hier spreche ich frei und ohne Vorlage. Außerdem startet jetzt das Bürgerbegehren. Kommt am Samstag zur Versammlung im Rathaus.', st.text);
await shot('clip');
// eigenes Titelbild: ein fertiges Bild als erstes Bild des Videos
const cover = path.join(OUT, 'pfade-titelbild.png'); trash.add(cover);
execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0xE5402A:size=640x360', '-frames:v', '1', cover]);
await page.setInputFiles('#coverImportFile', cover); await sleep(600);
st = await ev(() => ({ cf: P.settings.coverFirst && [P.settings.coverFirst.on, P.settings.coverFirst.own, P.settings.coverFirst.name], own: !!P.pfad.own }));
chk('ein eigenes Titelbild gehört dem Video und gilt nicht als Änderung von Hand', st.cf && st.cf[0] === true && st.cf[1] === true && st.cf[2] === 'pfade-titelbild.png' && !st.own, st);
await ev(() => saveNow()); await page.click('#clipPfadMain');
await page.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i, idM, { timeout: 30000 }); await sleep(500);
await page.click('#pfadeBtn'); await page.waitForSelector('#pfSheet'); await page.click('#pfSheet [data-view="vids"]').catch(() => {}); await sleep(200);
st = await ev(() => [...document.querySelectorAll('#pfSheet .pf-vid i')].map(i => i.textContent));
chk('„Zum Hauptprojekt“ führt zurück; die Liste nennt das eigene Titelbild', /eigenes Titelbild/.test(st[0]) && !st.slice(1).some(t => /Titelbild/.test(t)), st);
// Änderung im Hauptprojekt (ein Wort im Einstieg fällt weg) gilt nach dem Auffrischen in den Videos – Titelbild und Name bleiben
await ev(() => { closeSheet(); const i = order.find(k => tokens[k].type === 'word' && tokText(tokens[k]).trim() === 'lange'); selA = selB = i; showSel(); }); await page.click('#selDel'); await sleep(300);
res = await exportAll(async () => { await page.click('#pfadeBtn'); await page.waitForSelector('#pfSheet .pf-vid'); await page.click('#pfSheet .pf-vid:nth-of-type(1) [data-a="vexp"]'); });
const v1 = await ev(i => { const p = JSON.parse(TS.loadProject(i)); const del = new Set(p.deleted || []); return { text: p.tokens.filter((t, k) => t.type === 'word' && !del.has(k) && !(p.dels || []).some(d => (t.ws + t.we) / 2 > d[0] && (t.ws + t.we) / 2 < d[1])).map(t => t.text.trim()).join(' '), cf: p.settings.coverFirst && p.settings.coverFirst.own, name: p.name, own: !!p.pfad.own }; }, idV1);
chk('vor dem Export wird das Video aus dem Hauptprojekt neu aufgebaut: der neue Schnitt steht darin, Name und Titelbild bleiben', res.length === 1 && res[0].st === 'done' && res[0].proj === idV1 && /^Heute entscheidet der Stadtrat über den Mietendeckel\. Wir haben dafür gekämpft\. Der Antrag ist angenommen\./.test(v1.text) && v1.cf === true && v1.name === 'pfade – Angenommen · Begehren kommt' && !v1.own, [res.map(x => [x.name, x.st]), v1]);
if (mp4(res[0])){
  const px = execFileSync('ffmpeg', ['-v', 'error', '-i', mp4(res[0]), '-vf', 'select=lt(n\\,3),scale=1:1:flags=area', '-frames:v', '3', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 20 });
  const red = k => px[k * 3] > 170 && px[k * 3 + 1] < 110 && px[k * 3 + 2] < 90;
  chk('im fertigen Video liegt das eigene Titelbild auf dem ersten Bild, danach läuft das Video', red(0) && !red(1) && !red(2), [...px]);
  rs = runs(mp4(res[0])); chk('und der Schnitt aus dem Hauptprojekt ist drin (der Einstieg hat eine Lücke mehr)', rs.length === 6 && covers(rs[5], 'schluss'), rs);
}
await clearQ();
// von Hand ändern: das Video gehört sich selbst
await open(idV1);
await ev(() => { const i = order.find(k => tokens[k].type === 'word' && !isCut(k) && tokText(tokens[k]).trim() === 'stabil.'); setTab('text'); selA = selB = i; showSel(); }); await page.click('#selDel'); await sleep(300);
await sleep(1500); st = await ev(() => ({ own: !!P.pfad.own, toast: document.querySelector('#toast').textContent })); await ev(() => { saveNow(); setTab('clip'); }); await sleep(200);
const cardOwn = await ev(() => [document.querySelector('#clipPfadInfo').textContent, document.querySelector('#clipPfadOwn').textContent]);
chk('eine Änderung im Pfad-Video macht es eigenständig – mit Hinweis und Schalter im Clip-Reiter', st.own && /von Hand geändert/.test(st.toast) && /Von Hand geändert/.test(cardOwn[0]) && cardOwn[1] === 'Wieder aus dem Hauptprojekt aufbauen', [st, cardOwn]);
await open(idM);
res = await exportAll(async () => { await page.click('#pfadeBtn'); await page.waitForSelector('#pfSheet .pf-vid'); await page.click('#pfSheet .pf-vid:nth-of-type(1) [data-a="vexp"]'); });
const v1b = await ev(i => { const p = JSON.parse(TS.loadProject(i)); const del = new Set(p.deleted || []); return { gone: p.tokens.some((t, k) => t.text.trim() === 'stabil.' && del.has(k)), own: !!p.pfad.own }; }, idV1);
st = await ev(() => { document.querySelector('#pfadeBtn').click(); const r = document.querySelector('#pfSheet .pf-vid i'); return r ? r.textContent : ''; });
chk('ein von Hand geändertes Video bleibt beim Export, wie es ist; die Liste sagt es', res.length === 1 && res[0].st === 'done' && v1b.gone && v1b.own && /von Hand geändert/.test(st), [v1b, st]);
await clearQ(); await ev(() => closeSheet());

// ══════════ 6) Andere Reihenfolge in der Aufnahme, Beschriftungen ohne Skript, Plan entfernen ══════════
// Derselbe Plan, aber der Einstieg steht als „Abspann“ am Ende: Die Aufnahme hat ihn vorn – im Video gehört er nach hinten.
await ev(() => { const H = ScriptGenius, p = sgPlans()[0]; const a = p.blocks.shift(); a.label = 'Abspann'; p.blocks.push(a); p.id = H.newId(); p.name = 'Abspann hinten'; p.paths = {};
  const l = H.blank('Nur Beschriftungen'); const w = H.weiche('Ergebnis', ['Ja', 'Nein']); l.blocks.push(H.teil('Vorspann', ''), w, H.teil('Abschied', ''));
  TS.sgSave(JSON.stringify(p)); TS.sgSave(JSON.stringify(l)); });
await ev(() => closeProject());
const idR = await newProject(page, [MEDIA + 'pfade.mp4']); made.push(idR);
await ev(() => { document.querySelector('#autoPauses').checked = false; document.querySelector('#autoFillers').checked = false; document.querySelector('#autoRepeats').checked = false; });
await page.click('#transBtn'); await page.waitForFunction(() => tokens.length > 0 && document.querySelector('#transCancel').classList.contains('hidden'), null, { timeout: 180000 }); await sleep(400);
await ev(() => document.querySelector('#textMore').click()); await sleep(150);
st = await ev(() => [...document.querySelectorAll('#ctxMenu button')].map(b => b.textContent.trim()).filter(t => /Pfad-Plan/.test(t)));
chk('im fertigen Projekt führt „Weitere Werkzeuge → Pfad-Plan“ zum Laden', st.length === 1, st);
await ev(() => [...document.querySelectorAll('#ctxMenu button')].find(b => /Pfad-Plan/.test(b.textContent)).click()); await page.waitForSelector('#pfPick [data-a="load"]');
await ev(() => [...document.querySelectorAll('#pfPick [data-p]')].find(r => /Abspann hinten/.test(r.textContent)).querySelector('[data-a="load"]').click()); await sleep(500);
st = await ev(() => { const c = pfCalc(); return { toast: document.querySelector('#toast').textContent, secs: P.pfade.secs.map(x => c.by.get(x.seg).label + ': ' + secQuote(x, 4)), chip: document.querySelector('#pfadeBtn').textContent, script: !!P.script }; });
chk('ein Plan, nach der Transkription geladen, findet seine Abschnitte sofort – auch den, der in der Aufnahme an anderer Stelle liegt', /7 von 7 Abschnitten in der Aufnahme gefunden/.test(st.toast) && st.chip === 'Pfade (4/4)' && st.secs.some(s => /^Abspann: Heute entscheidet der Heute/.test(s)) && !st.script, st);
res = await exportAll(async () => { await page.click('#pfadeBtn'); await page.waitForSelector('#pfSheet'); await page.click('#pfSheet [data-view="vids"]'); await page.click('#pfSheet .pf-vid:nth-of-type(2) [data-a="vexp"]'); });
rs = mp4(res[0]) ? runs(mp4(res[0])) : [];
chk('im Video steht der Abschnitt dort, wo der Plan ihn will: „Angenommen“, Einordnung, Schluss – und der Einstieg als Abspann am Ende', res.length === 1 && res[0].st === 'done' && seq(rs, ['angenommen', 'frei', 'schluss', 'einstieg']), rs);
const vR = await ev(() => Object.values(P.pfade.vids).map(v => v.id)); made.push(...vR);
await clearQ();
// nur Beschriftungen: alles von Hand
await ev(() => { closeSheet(); pfOpenPick(); }); await page.waitForSelector('#pfPick [data-a="load"]');
await ev(() => [...document.querySelectorAll('#pfPick [data-p]')].find(r => /Nur Beschriftungen/.test(r.textContent)).querySelector('[data-a="load"]').click()); await sleep(400);
st = await ev(() => ({ toast: document.querySelector('#toast').textContent, chip: document.querySelector('#pfadeBtn').textContent, vids: Object.keys(P.pfade.vids).length }));
chk('ein Plan nur aus Beschriftungen lässt sich laden; zugeordnet wird von Hand', /von Hand zuordnen/.test(st.toast) && st.chip === 'Pfade (0/2)' && st.vids === 0, st);
await page.click('#pfadeBtn'); await page.waitForSelector('#pfSheet .pf-row');
st = await ev(() => ({ rows: [...document.querySelectorAll('#pfSheet .pf-row b')].map(b => b.textContent), auto: !!document.querySelector('#pfSheet [data-a="auto"]') }));
chk('seine Abschnitte heißen wie die Beschriftungen; „Nach dem Skript zuordnen“ fehlt', st.rows.join('|') === 'Vorspann|Ergebnis: Ja|Ergebnis: Nein|Abschied' && !st.auto, st);
const pick = async (a, b, row) => { await ev(([a, b]) => { const w = (t, n = 0) => order.filter(i => tokens[i].type === 'word' && tokText(tokens[i]).trim() === t)[n]; selA = w(a[0], a[1] || 0); selB = w(b[0], b[1] || 0); showSel(); }, [a, b]); await page.click(`#pfSheet .pf-row:nth-of-type(${row}) [data-a="set"]`); await sleep(200); };
await pick(['Wir'], ['gekämpft.'], 1); await pick(['Der', 0], ['stabil.'], 2); await pick(['Der', 1], ['weiter.'], 3); await pick(['Kommt', 0], ['Rathaus.', 0], 4);
st = await ev(() => ({ chip: document.querySelector('#pfadeBtn').textContent, paths: pfPaths().map(p => p.label + ':' + p.ok) }));
chk('nach dem Zuordnen von Hand sind beide Videos vollständig', st.chip === 'Pfade (2/2)' && st.paths.join('|') === 'Ja:true|Nein:true', st);
res = await exportAll(async () => { await page.click('#pfSheet [data-view="vids"]'); await page.click('#pfSheet [data-a="vall"]'); });
const gotL = res.map(x => mp4(x) ? runs(mp4(x)) : []);
chk('beide Videos tragen ihre Stellen: Vorspann, „Ja“ bzw. „Nein“, Abschied', res.length === 2 && res.every(x => x.st === 'done') && gotL[0].length === 3 && gotL[1].length === 3 && Math.abs(gotL[0][1][1] - SEC.angenommen.end) < 1 && Math.abs(gotL[1][1][1] - SEC.abgelehnt.end) < 1 && covers(gotL[0][2], 'schluss') && covers(gotL[1][2], 'schluss'), gotL);
made.push(...await ev(() => Object.values(P.pfade.vids).map(v => v.id)));
await clearQ();
// Plan entfernen
await ev(() => { closeSheet(); pfOpenPick(); }); await page.waitForSelector('#pfPick [data-a="unload"]'); await page.click('#pfPick [data-a="unload"]'); await sleep(300);
st = await ev(() => ({ has: !!P.pfade, chip: document.querySelector('#pfadeBtn').classList.contains('hidden'), marks: document.querySelectorAll('#transcript .tk.pf').length, toast: document.querySelector('#toast').textContent }));
chk('„Entfernen“ nimmt den Plan aus dem Projekt: Chip und Markierungen im Text verschwinden', !st.has && st.chip && st.marks === 0 && /Plan entfernt/.test(st.toast), st);
await ev(() => closeSheet());

// ══════════ 7) Handy-Ansicht ══════════
await open(idM); await page.setViewportSize({ width: 390, height: 844 }); await sleep(400);
await ev(() => { setTab('text'); pfOpen('vids'); }); await sleep(300);
st = await ev(() => { const s = document.querySelector('#sheet').getBoundingClientRect(); return { w: document.documentElement.scrollWidth, rows: document.querySelectorAll('#pfSheet .pf-vid').length, left: s.left, right: s.right, wide: [...document.querySelectorAll('#pfSheet *')].filter(e => e.getBoundingClientRect().right > 391).length }; });
chk('am Handy passt das Blatt „Pfade“ in die Breite', st.w <= 390 && st.rows === 4 && st.wide === 0, st);
await shot('handy');
await ev(() => closeSheet()); await page.setViewportSize({ width: 1480, height: 900 }); await sleep(200);

// aufräumen
await ev(list => { if (P){ pausePlay(); clearTimeout(saveT); saveNow(); closeSheet(); closeProject(); } for (const i of list){ try { TS.deleteProject(i); } catch (_) {} try { if (TS.trashPurge) TS.trashPurge(i); } catch (_) {} } for (const k of ['sg-plans', 'sg-current']) localStorage.removeItem(k); }, [...new Set(made)]);
fs.rmSync(PLANS, { recursive: true, force: true });
for (const f of trash) fs.rmSync(f, { force: true });
const echte = logs.filter(l => !/^HTTP 400: api\/sg\/save$/.test(l));   // die zwei absichtlich abgelehnten Pläne aus Abschnitt 2
chk('keine Fehlermeldungen in der Seite', echte.length === 0 && logs.length - echte.length === 2, logs);
await ende(browser);
