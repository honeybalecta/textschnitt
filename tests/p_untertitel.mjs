// Untertitel (2.32): laufende Wort-Hervorhebung (D1), Schlagwörter betonen (D2), Animationen (D3), Emojis und Symbole (D4).
// Geprüft werden Einstellungen, Vorschau, Exportplan und der echte Export unter Windows (libass). Die Zeichenroutine der
// Browser-Fassung (web/engine.js, textFx) läuft hier mit einem nachgestellten Zeichenbrett; Android übersetzt nur GitHub.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, newProject, transcribe, sleep, pruefung, MEDIA, OUT, HERE } from './drv.mjs';
const { chk, ende } = pruefung('Untertitel');
const { browser, page, logs } = await launch();
const ev = (f, a) => page.evaluate(f, a);
const shot = (name, pg = page) => pg.screenshot({ path: path.join(OUT, `untertitel-${name}.png`) });
const made = [], trash = new Set();
const leave = () => ev(() => { if (typeof P !== 'undefined' && P){ pausePlay(); clearTimeout(saveT); saveNow(); closeProject(); } });
const KEYS = ['hc-emoji', 'hc-dict', 'hc-sub-looks', 'hc-house', 'hc-house-def', 'hc-gpu'];
await ev(k => { for (const x of k) localStorage.removeItem(x); emojiMap = []; dict.length = 0; houseList = []; houseDef = ''; subLooks = []; }, KEYS);
const id = await newProject(page, [MEDIA + 'anlauf.mp4']); made.push(id); await transcribe(page);
await ev(() => { setTab('subs'); }); await sleep(300);
const cue = k => ev(k => { const p = buildPlan(true); return p.subs.cues.filter(c => !c.title && !c.line)[k]; }, k);
const ovState = () => ev(() => ({ words: [...document.querySelectorAll('#subOv .sw')].map(s => [s.textContent, s.style.color, s.style.visibility]), text: document.querySelector('#subOv').textContent, emoji: (document.querySelector('#subOv .se') || {}).textContent || '', cls: document.querySelector('#subOv').className }));
const rgb = h => { const n = parseInt(h.slice(1), 16); return `rgb(${n >> 16}, ${(n >> 8) & 255}, ${n & 255})`; };

// ═════════ Ausgangslage ═════════
let c0 = await cue(0), st = await ev(() => ({ hl: document.querySelector('#stHl').checked, dis: document.querySelector('#stHlColor').disabled, anim: document.querySelector('#stAnim').value, opts: [...document.querySelectorAll('#stAnim option')].map(o => o.textContent).join('|'), kw: document.querySelector('#stKwInfo').textContent, dict: document.querySelector('#stKwDict').checked, clear: document.querySelector('#stKwClear').classList.contains('hidden') }));
chk('ohne Effekte bleiben Plan und Vorschau wie bisher', !('words' in c0) && !('hl' in c0) && !('spans' in c0) && !('anim' in c0) && (await ovState()).words.length === 0, c0);
chk('der Untertitel-Reiter bietet Hervorhebung, Animation und betonte Wörter', !st.hl && st.dis && st.anim === '' && st.opts === 'keine|Einblenden|Aufpoppen|Wort für Wort aufbauen' && /Betonen/.test(st.kw) && !st.dict && st.clear, st);

// ═════════ D1 · Laufende Wort-Hervorhebung ═════════
await page.check('#stHl'); await sleep(250);
c0 = await cue(0);
const W0 = await ev(() => { const x = computedCues()[0]; return { s: x.s, e: x.e, words: wrapText(x.text).split(/\s+/), tok: cueWords(x.c).map(i => +srcToOut(wS(tokens[i])).toFixed(3)) }; });
chk('eingeschaltet trägt jeder Untertitel im Plan die Zeiten seiner Wörter und die Farbe des gesprochenen Worts', c0.hl === '#F5D90A' && c0.words.length === W0.words.length && c0.words[0][0] === c0.start && c0.words[c0.words.length - 1][1] === c0.end
  && c0.words.every((w, k) => w[1] >= w[0] && (k === 0 || w[0] === c0.words[k - 1][1])) && !c0.build && !c0.anim, c0);
chk('die Zeiten stammen aus dem Transkript', c0.words.slice(1).every((w, k) => Math.abs(w[0] - W0.tok[k + 1]) < 0.002), [c0.words.map(w => w[0]), W0.tok]);
chk('die Wahl steht im Projekt und im Schalter', await ev(() => S().hl === '#F5D90A' && !document.querySelector('#stHlColor').disabled && document.querySelector('#stHlColor').value === '#f5d90a'));
for (const k of [0, 2, c0.words.length - 1]){
  await ev(t => seekOut(t, false), (c0.words[k][0] + c0.words[k][1]) / 2); await sleep(250);
  const o = await ovState();
  chk(`Vorschau: beim ${k + 1}. Wort ist genau dieses Wort hervorgehoben`, o.words.length === W0.words.length && o.words.every((w, i) => (i === k ? w[1] === rgb('#F5D90A') : w[1] === '') && w[2] === '') && o.words.map(w => w[0]).join(' ') === W0.words.join(' '), o.words.map(w => w[1]));
}
await ev(() => { const el = document.querySelector('#stHlColor'); el.value = '#3e8a55'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(200);
chk('die Farbe der Hervorhebung lässt sich wählen', (await cue(0)).hl === '#3E8A55' && (await ovState()).words.some(w => w[1] === rgb('#3E8A55')));
await ev(() => { const el = document.querySelector('#stHlColor'); el.value = '#f5d90a'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
// von Hand geänderter Text: Zeiten nach Wortlänge
await ev(() => { commit(() => { P.cues[1].text = 'Ganz anderer Text hier'; }, false); cueCache.at = -1; }); await sleep(200);
let c1 = await cue(1);
chk('von Hand geänderter Text verteilt die Dauer nach der Länge der Wörter', c1.text.replace(/\n/g, ' ') === 'Ganz anderer Text hier' && c1.words.length === 4 && c1.words[0][0] === c1.start && c1.words[3][1] === c1.end && (c1.words[1][1] - c1.words[1][0]) > (c1.words[0][1] - c1.words[0][0]) * 1.2, c1);
await ev(() => document.querySelector('#undoBtn').click()); await sleep(200);
// andere Formate und SRT
st = await ev(() => { const a = exFmt, out = {}; for (const f of ['capcut', 'audio', 'concat']){ exFmt = f; const p = buildPlan(true); out[f] = p.subs.cues.some(c => c.words || c.hl || c.spans || c.anim); } exFmt = a; return out; });
chk('CapCut, Concat und Tonspur bekommen die Untertitel wie bisher, ohne Effekte', !st.capcut && !st.audio && !st.concat, st);
await page.selectOption('#stMode', 'word'); await sleep(400);
st = await ev(() => ({ fx: buildPlan(true).subs.cues.some(c => c.words), note: document.querySelector('#fxNote').textContent }));
chk('bei „1 Wort pro Untertitel“ entfällt die Hervorhebung; ein Hinweis erklärt es', !st.fx && /wirken bei der Aufteilung in Zeilen/.test(st.note), st);
await page.selectOption('#stMode', 'lines'); await sleep(400);

// ═════════ D3 · Animationen ═════════
await page.selectOption('#stAnim', 'build'); await sleep(250);
c0 = await cue(0);
chk('„Wort für Wort aufbauen“ steht im Plan', c0.build === true && c0.words.length === W0.words.length && !c0.anim && await ev(() => S().anim === 'build'), c0);
await ev(t => seekOut(t, false), (c0.words[2][0] + c0.words[2][1]) / 2); await sleep(250);
let o = await ovState();
chk('Vorschau: gesprochene Wörter stehen, das aktuelle ist hervorgehoben, spätere sind noch verborgen', o.words.every((w, i) => i < 2 ? w[1] === '' && w[2] === '' : i === 2 ? w[1] === rgb('#F5D90A') && w[2] === '' : w[2] === 'hidden'), o.words);
const boxA = await ev(() => { const r = document.querySelector('#subOv').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
await ev(t => seekOut(t, false), c0.end - 0.05); await sleep(250);
const boxB = await ev(() => { const r = document.querySelector('#subOv').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
chk('der Untertitel behält dabei Größe und Lage; verborgene Wörter halten ihren Platz', boxA.join() === boxB.join() && (await ovState()).words.every(w => w[2] === ''), [boxA, boxB]);
await shot('aufbau');
for (const [v, label] of [['fade', 'Einblenden'], ['pop', 'Aufpoppen']]){
  await page.selectOption('#stAnim', v); await sleep(250);
  c0 = await cue(0);
  chk(`„${label}“ steht im Plan; die Wort-Hervorhebung bleibt dabei`, c0.anim === v && !c0.build && c0.hl === '#F5D90A' && c0.words.length === W0.words.length, c0);
  await ev(t => { seekOut(Math.max(0, t - 0.25), false); startPlay(); }, c0.start);
  await page.waitForFunction(() => /a-fade|a-pop/.test(document.querySelector('#subOv').className), null, { timeout: 5000 }).catch(() => {});
  const cls = await ev(() => document.querySelector('#subOv').className); await ev(() => pausePlay()); await sleep(150);
  chk(`Vorschau: beim Abspielen läuft „${label}“, sobald der Untertitel erscheint`, new RegExp(v === 'fade' ? 'a-fade' : 'a-pop').test(cls), cls);
}
await page.selectOption('#stAnim', ''); await sleep(200);
chk('„keine“ nimmt die Animation wieder heraus', !('anim' in await cue(0)) && await ev(() => !('anim' in S())));

// ═════════ D2 · Schlagwörter betonen ═════════
const ids = await ev(() => { const x = computedCues()[0]; return cueWords(x.c); });
await ev(() => setTab('text')); await sleep(300);
await ev(([a, b]) => { selA = a; selB = b; showSel(); }, [ids[4], ids[5]]); await sleep(150);
chk('die Auswahlleiste im Text bietet „Betonen“', await ev(() => { const b = document.querySelector('#selKw'); return !!b && b.getBoundingClientRect().width > 0 && /Betonen/.test(b.textContent); }));
await page.click('#selKw'); await sleep(300);
st = await ev(([a, b]) => ({ kw: P.kw, cls: [a, b].map(i => spans[i].classList.contains('kw')), other: spans[a - 2] && spans[a - 2].classList.contains('kw'), toast: document.querySelector('#toast').textContent }), [ids[4], ids[5]]);
chk('zwei markierte Wörter sind betont und im Text unterstrichen', JSON.stringify(st.kw) === JSON.stringify([ids[4], ids[5]]) && st.cls.every(Boolean) && !st.other && /2 Wörter betont/.test(st.toast), st);
c0 = await cue(0);
chk('im Plan tragen genau diese Wörter die Farbe der betonten Wörter', JSON.stringify(c0.spans) === JSON.stringify([[4, '#E5402A'], [5, '#E5402A']]) && c0.hl === '#F5D90A', c0.spans);
await ev(() => setTab('subs')); await sleep(250);
await ev(t => seekOut(t, false), (c0.words[4][0] + c0.words[4][1]) / 2); await sleep(250);
o = await ovState();
chk('Vorschau: betonte Wörter stehen in ihrer Farbe; das gerade gesprochene zeigt die Hervorhebung', o.words[4][1] === rgb('#F5D90A') && o.words[5][1] === rgb('#E5402A') && o.words[0][1] === '', o.words.map(w => w[1]));
st = await ev(() => ({ info: document.querySelector('#stKwInfo').textContent, clear: !document.querySelector('#stKwClear').classList.contains('hidden') }));
chk('der Untertitel-Reiter zählt die betonten Wörter', st.info === '2 Wörter im Text betont' && st.clear, st);
await ev(() => { const el = document.querySelector('#stKwColor'); el.value = '#3e8a55'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }); await sleep(200);
chk('die Farbe betonter Wörter lässt sich wählen', (await cue(0)).spans[0][1] === '#3E8A55');
await ev(() => { const el = document.querySelector('#stKwColor'); el.value = '#e5402a'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
await ev(() => setTab('text')); await sleep(200);
await ev(i => { selA = selB = i; showSel(); }, ids[5]); await page.click('#selKw'); await sleep(250);
chk('nochmal „Betonen“ nimmt die Betonung eines Worts zurück', JSON.stringify(await ev(() => P.kw)) === JSON.stringify([ids[4]]) && /Betonung entfernt/.test(await ev(() => document.querySelector('#toast').textContent)));
await ev(() => document.querySelector('#undoBtn').click()); await sleep(250);
chk('Rückgängig stellt sie wieder her', JSON.stringify(await ev(() => P.kw)) === JSON.stringify([ids[4], ids[5]]) && await ev(i => spans[i].classList.contains('kw'), ids[5]));
// Wörterbuch
await ev(() => { dict.push({ t: 'Hermeyer', w: [] }, { t: 'Mieten', w: [] }, { t: 'AfD', w: [] }); saveDict(); setTab('subs'); }); await sleep(200);
await page.check('#stKwDict'); await sleep(250);
st = await ev(() => buildPlan(true).subs.cues.filter(c => !c.title).map(c => (c.spans || []).map(s => c.text.split(/\s+/)[s[0]])).flat());
chk('„Begriffe aus dem Wörterbuch betonen“ färbt die Begriffe in allen Untertiteln', st.includes('Hermeyer') && st.filter(w => /^Mieten/.test(w)).length >= 1 && st.some(w => /^AFD/.test(w)) && await ev(() => S().kwDict === true), st);
await page.uncheck('#stKwDict'); await sleep(200);
await page.click('#stKwClear'); await sleep(250);
chk('„Alle entfernen“ nimmt die einzelnen Betonungen heraus', await ev(() => (P.kw || []).length === 0 && !document.querySelector('#transcript .tk.kw')) && !('spans' in await cue(0)));
await ev(() => { document.querySelector('#undoBtn').click(); }); await sleep(250);

// ═════════ D4 · Emojis und Symbole ═════════
await ev(() => setTab('subs')); await sleep(250);
chk('jeder Untertitel in der Liste hat einen Knopf fürs Symbol', await ev(() => { const b = [...document.querySelectorAll('#cueList [data-a="emoji"]')]; return b.length === P.cues.length && b.every(x => x.textContent.trim() === '+ Symbol'); }));
await page.click('#cueList .cue:first-child [data-a="emoji"]'); await page.waitForSelector('.em-grid'); await sleep(200);
st = await ev(() => ({ n: document.querySelectorAll('.em-grid .em').length, svg: document.querySelectorAll('.em-grid .em svg').length, words: [...document.querySelectorAll('#emWord option')].map(o => o.textContent), learn: document.querySelector('#emLearn').disabled, all: document.querySelector('#emAll').disabled }));
chk('das Blatt zeigt eine Auswahl an Symbolen und die Wörter des Untertitels für die Zuordnung', st.n === 20 && st.svg === 0 && st.words.includes('Hermeyer') && st.learn && st.all, st);
await page.click('.em-grid .em[data-e="🔥"]'); await sleep(250);
st = await ev(() => ({ e: P.cues[0].emoji, btn: document.querySelector('#cueList .cue:first-child [data-a="emoji"]').textContent.trim(), on: document.querySelector('.em-grid .em.on').dataset.e, undo: undo.length }));
chk('ein Klick setzt das Symbol an den Untertitel', st.e === '🔥' && st.btn === '🔥 Symbol' && st.on === '🔥', st);
await shot('symbol-blatt');
await page.selectOption('#emWord', 'Hermeyer'); await page.click('#emLearn'); await sleep(200);
chk('„Merken“ legt die Zuordnung von Wort zu Symbol im Gerät ab', await ev(() => JSON.stringify(emojiMap) === JSON.stringify([{ w: 'Hermeyer', e: '🔥' }]) && localStorage.getItem('hc-emoji') === JSON.stringify(emojiMap)) && /„Hermeyer“ schlägt künftig 🔥 vor/.test(await ev(() => document.querySelector('#toast').textContent)));
await ev(() => { emojiMap.push({ w: 'Mieten', e: '🏠' }, { w: 'Zahlen', e: '📈' }); saveEmojiMap(); });
await page.click('#emAll'); await sleep(300);
st = await ev(() => P.cues.map(c => c.emoji || ''));
chk('„Vorschläge überall übernehmen“ gibt passenden Untertiteln ihr Symbol und lässt gesetzte stehen', st[0] === '🔥' && st.filter(e => e === '🏠').length >= 1 && st.filter(e => e === '📈').length === 1 && st.filter(Boolean).length < st.length, st);
await page.click('#emOk'); await sleep(200);
const ec = await ev(() => { const l = computedCues(); return { s: l[0].s, e: l[0].e }; });
await ev(t => seekOut(t, false), ec.s + 0.3); await sleep(300);
o = await ovState();
const geo = await ev(() => { const s = document.querySelector('#stage').getBoundingClientRect(), a = document.querySelector('#subOv').getBoundingClientRect(), b = document.querySelector('#subOv .se').getBoundingClientRect(); return { ovTop: (a.top - s.top) / s.height, ovCx: (a.left + a.width / 2 - s.left) / s.width, eBot: (b.bottom - s.top) / s.height, eCx: (b.left + b.width / 2 - s.left) / s.width, eH: b.height / s.height }; });
chk('Vorschau: das Symbol steht mittig direkt über dem Untertitel', o.emoji === '🔥' && Math.abs(geo.eCx - geo.ovCx) < 0.01 && geo.eBot <= geo.ovTop + 0.005 && geo.ovTop - geo.eBot < 0.03, geo);
const plan = await ev(() => { const p = buildPlan(); return { emo: p.overlays.filter(x => x.emoji), n: P.cues.filter(c => c.emoji).length, dry: buildPlan(true).overlays.filter(x => x.emoji).length, cue: p.subs.cues[0], H: p.height, W: p.width }; });
const e0 = plan.emo[0];
chk('im Plan liegt jedes Symbol als Bild über seinem Untertitel, für dessen Dauer, auf eigener Spur', plan.emo.length === plan.n && plan.dry === 0 && e0.mode === 'pip' && e0.image && e0.track === 96 && e0.at === plan.cue.start && Math.abs(e0.out - (plan.cue.end - plan.cue.start)) < 0.002 && e0.x === 0.5 && fs.existsSync(e0.uri), e0);
chk('seine Lage im Plan entspricht der Vorschau', Math.abs((e0.y + e0.w * plan.W / plan.H / 2 / 1.3) - geo.ovTop) < 0.035 && e0.y < plan.cue.y, [e0.y, geo.ovTop, geo.eBot]);
await shot('symbol');
await page.click('#cueList .cue:first-child [data-a="emoji"]'); await page.waitForSelector('#emOff'); await page.click('#emOff'); await sleep(200); await page.click('#emOk'); await sleep(200);
chk('„Ohne Symbol“ nimmt es wieder weg', await ev(() => !P.cues[0].emoji && document.querySelector('#cueList .cue:first-child [data-a="emoji"]').textContent.trim() === '+ Symbol' && !document.querySelector('#subOv .se')));
st = await ev(() => { const pr = uiPrefs(); const n = mergePrefs({ 'hc-emoji': [{ w: 'hermeyer', e: '❌' }, { w: 'Bundestag', e: '🏛️' }, { w: '', e: 'x' }] }); return [Object.keys(pr).includes('hc-emoji'), n, emojiMap.map(e => e.w + e.e).join()]; });
chk('die Zuordnung geht in die Sicherung der Einstellungen', st[0] && st[1] === 1 && st[2] === 'Hermeyer🔥,Mieten🏠,Zahlen📈,Bundestag🏛️', st);

// Übersetzung: Wort-Effekte nur am Original
await ev(() => { commit(() => { P.cues.forEach(c => delete c.emoji); const l = computedCues(); P.trans = { lang: 'en', mode: 'both', map: Object.fromEntries(l.map(x => [trKey(x.text), 'Translated line for this cue'])), sent: {} }; trMemo.list = null; }, true); cueCache.at = -1; }); await sleep(300);
st = await ev(() => buildPlan(true).subs.cues.filter(c => !c.title).slice(0, 2).map(c => [c.text.replace(/\n/g, ' ').slice(0, 20), !!c.words, !!c.hl]));
chk('mit Übersetzung gelten Hervorhebung und Betonung für das Original; die Übersetzung bleibt ohne', st.length === 2 && st.some(x => x[1] && x[2] && !/Translated/.test(x[0])) && st.some(x => /Translated/.test(x[0]) && !x[1] && !x[2]), st);
await ev(t => seekOut(t, false), ec.s + 0.3); await sleep(300);
o = await ovState();
chk('Vorschau mit Übersetzung: die Wörter des Originals sind einzeln gefärbt', o.words.length === W0.words.length && o.words.some(w => w[1] === rgb('#F5D90A')) && /Translated/.test(o.text), o.words.length);
await ev(() => { document.querySelector('#undoBtn').click(); delete P.trans; trMemo.list = null; cueCache.at = -1; }); await sleep(200);

// Looks und Hausstil tragen die Effekte
await page.selectOption('#stAnim', 'pop'); await sleep(200);
st = await ev(() => { const l = lookOf(S()); const h = houseOf(); return [l.hl, l.anim, h.sub.hl, h.sub.anim]; });
chk('eigene Looks und der Hausstil nehmen Hervorhebung und Animation mit', st.join() === '#F5D90A,pop,#F5D90A,pop', st);
await page.selectOption('#stAnim', ''); await sleep(200);

// ═════════ Zeichenroutine der Browser-Fassung (web/engine.js) ═════════
{
  const src = fs.readFileSync(path.join(HERE, '..', 'web', 'engine.js'), 'utf8'), a = src.indexOf('  textFx(c, t, rows, o){'), b = src.indexOf('\n  close(){', a);
  const res = a < 0 || b < 0 ? null : await ev(body => {
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));   // eslint-disable-line no-unused-vars
    const obj = eval('({' + body + '})');
    const W = 600, H = 200, run = (c, t) => { const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d'); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      const size = 40; ctx.font = `700 ${size}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const rows = ['Die Mieten steigen'], bw = ctx.measureText(rows[0]).width, o = { size, lh: size * 1.12, bw, bh: size * 1.12, cx: W / 2, cy: H / 2, outline: false, color: '#FFFFFF', ocol: '#000' };
      obj.textFx.call({ ctx }, c, t, rows, o);
      const d = ctx.getImageData(0, 0, W, H).data, x0 = W / 2 - bw / 2, ws = rows[0].split(' '); let x = x0; const out = [];
      for (const w of ws){ const ww = ctx.measureText(w).width; let white = 0, yel = 0, red = 0, any = 0;
        for (let yy = 60; yy < 140; yy++) for (let xx = Math.round(x); xx < Math.round(x + ww); xx++){ const i = (yy * W + xx) * 4, r = d[i], g = d[i + 1], bl = d[i + 2]; if (r + g + bl > 90) any++; if (r > 200 && g > 200 && bl > 200) white++; else if (r > 200 && g > 170 && bl < 90) yel++; else if (r > 180 && g < 110 && bl < 90) red++; }
        out.push(any < 20 ? 'leer' : yel > white && yel > red ? 'gelb' : red > white ? 'rot' : 'weiß'); x += ww + ctx.measureText(' ').width; }
      let sum = 0; for (let i = 0; i < d.length; i += 4) sum += d[i]; return { out: out.join(), sum, align: ctx.textAlign }; };
    const c = { start: 1, end: 3, words: [[1, 1.6], [1.6, 2.2], [2.2, 3]], hl: '#F5D90A', build: true, spans: [[1, '#E5402A']] };
    const fade = { start: 1, end: 3, anim: 'fade' }, pop = { start: 1, end: 3, anim: 'pop', words: [[1, 1.05], [1.05, 2], [2, 3]], hl: '#F5D90A' };
    return { t1: run(c, 1.2).out, t2: run(c, 1.8).out, t3: run(c, 2.5).out, plain: run({ start: 1, end: 3, spans: [[2, '#E5402A']] }, 2).out,
      f0: run(fade, 1.02).sum, f1: run(fade, 1.08).sum, f2: run(fade, 1.5).sum, p0: run(pop, 1.06).out, p1: run(pop, 1.5).out, align: run(c, 2).align };
  }, src.slice(a, b));
  chk('Browser-Fassung: die Zeichenroutine für Effekte ist vorhanden', !!res);
  if (res){
    chk('Browser-Fassung: gesprochenes Wort gelb, betontes rot, spätere Wörter verborgen', res.t1 === 'gelb,leer,leer' && res.t2 === 'weiß,gelb,leer' && res.t3 === 'weiß,rot,gelb' && res.plain === 'weiß,weiß,rot', res);
    chk('Browser-Fassung: Einblenden wird heller, während des Aufpoppens gilt der Stand vom Anfang', res.f0 < res.f1 && res.f1 < res.f2 && res.p0 === 'gelb,weiß,weiß' && res.p1 === 'weiß,gelb,weiß' && res.align === 'center', res);
  }
}

// ═════════ Echter Export unter Windows-Bedingungen (libass) ═════════
const exp = (nm) => ev(async nm => { exFmt = 'video'; const plan = buildPlan(); plan.name = nm; const id = TS.exportVideo(JSON.stringify(plan));
  for (;;){ await new Promise(r => setTimeout(r, 300)); const j = JSON.parse(TS.job(id)); if (j.status === 'done') return { ok: true, result: j.result, cue: plan.subs.cues[0], w: plan.width, h: plan.height, emo: plan.overlays.filter(o => o.emoji) }; if (j.status === 'error') return { ok: false, error: j.error }; } }, nm);
const frame = (f, t, vf = 'null') => execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', f, '-frames:v', '1', '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 1 << 26 });
const count = (buf, test) => { let n = 0; for (let i = 0; i < buf.length; i += 3) if (test(buf[i], buf[i + 1], buf[i + 2])) n++; return n / (buf.length / 3); };
const yellow = (r, g, b) => r > 170 && g > 140 && b < 110 && r - b > 90, white = (r, g, b) => r > 215 && g > 215 && b > 215, redc = (r, g, b) => r > 150 && g < 110 && b < 110 && r - g > 70;
await ev(() => { const m = timeline.filter(g => g.kind === 'main'); commit(() => { addDel(m[0].in + 4.4, m[m.length - 1].out); P.format = '9:16'; P.frame = clampFrame({ sc: coverSc(), tx: 0, ty: 0 }); Object.assign(S(), { y: 0.5, x: 0.5, pos: 'mitte', bg: false, outline: true }); P.sources[0].vol = 1; }, true); P.settings.burn = true; P.settings.level = false; fitStage(); }); await sleep(400);
// Bereich je Wort aus der Vorschau (Anteile der Bühne), der Untertitel steht mit Kasten in der Bildmitte
await ev(t => seekOut(t, false), ec.s + 0.2); await sleep(350);
const rects = await ev(() => { const s = document.querySelector('#stage').getBoundingClientRect(); return [...document.querySelectorAll('#subOv .sw')].map(el => { const r = el.getBoundingClientRect(); return [(r.left - s.left) / s.width, (r.top - s.top) / s.height, r.width / s.width, r.height / s.height]; }); });
// Vergleichsexporte: R = dieselben Untertitel ohne Effekte, N = ohne eingebrannte Untertitel
const keep = await ev(() => { const k = { hl: S().hl, kw: P.kw }; delete S().hl; P.kw = []; cueCache.at = -1; return k; });
const R = await exp('untertitel_r');
await ev(() => { P.settings.burn = false; }); const N = await exp('untertitel_n');
await ev(k => { P.settings.burn = true; S().hl = k.hl; P.kw = k.kw; cueCache.at = -1; }, keep);
await page.selectOption('#stAnim', 'build'); await sleep(200);
const A = await exp('untertitel_a');
if (chk('die Exporte mit Hervorhebung, Aufbau und betonten Wörtern sowie die Vergleichsexporte laufen durch', A.ok && R.ok && N.ok, [A.error, R.error, N.error])){
  const fa = A.result.playable, fr = R.result.playable, fn = N.result.playable, { w, h } = A, cu = A.cue; for (const x of [A, R, N]) x.result.files.forEach(y => trash.add(y));
  const reg = k => { const r = rects[k], pad = 0.004; return `crop=${Math.round((r[2] - 2 * pad) * w)}:${Math.round(r[3] * 0.8 * h)}:${Math.max(0, Math.round((r[0] + pad) * w))}:${Math.max(0, Math.round((r[1] + r[3] * 0.1) * h))}`; };
  const at = k => (cu.words[k][0] + cu.words[k][1]) / 2;
  const dd = (f1, f2, t, k) => { const a = frame(f1, t, reg(k)), b = frame(f2, t, reg(k)); let n = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 40) n++; return +(n / a.length).toFixed(3); };
  // Zustand eines Worts im Video: steht (gleich wie ohne Effekte), farbig (anders als ohne Effekte, aber da), verborgen (wie ohne Untertitel)
  const state = (t, k) => { const ar = dd(fa, fr, t, k), an = dd(fa, fn, t, k), rn = dd(fr, fn, t, k); return an < 0.01 && rn > 0.03 ? 'verborgen' : ar < 0.012 ? 'steht' : ar > 0.03 && an > 0.03 ? 'farbig' : `unklar(${ar},${an},${rn})`; };
  const row = t => rects.map((_, k) => state(t, k)).join();
  const n = rects.length, want = (act) => rects.map((_, k) => k < act ? (k === 4 || k === 5 ? 'farbig' : 'steht') : k === act ? 'farbig' : 'verborgen').join();
  for (const k of [0, 2, 6, n - 1]) chk(`im Video beim ${k + 1}. Wort: frühere Wörter stehen, das gesprochene und die betonten sind farbig, spätere verborgen`, row(at(k)) === want(k), row(at(k)));
  const yel = frame(fa, at(2), reg(2)), redw = frame(fa, at(6), reg(4));
  chk('im Video trägt das gesprochene Wort die gelbe Hervorhebung und das betonte Wort Rot', count(yel, yellow) > 0.08 && count(redw, redc) > 0.08, [count(yel, yellow), count(redw, redc)]);
  const srt = A.result.files.find(x => x.endsWith('.srt')), ns = srt ? fs.readFileSync(srt, 'utf8').split('-->').length - 1 : -1, wantN = await ev(() => computedCues().length);
  chk('die SRT-Datei hat weiter einen Eintrag je Untertitel', ns === wantN, [ns, wantN]);
}
// Einblenden und Symbol
await page.selectOption('#stAnim', 'fade'); await ev(() => { commit(() => { P.cues[0].emoji = '🔥'; }, false); cueCache.at = -1; }); await sleep(250);
const B = await exp('untertitel_b');
if (chk('der Export mit Einblenden und Symbol läuft durch', B.ok, B.error)){
  const f = B.result.playable, { w, h } = B, cu = B.cue, e = B.emo[0]; B.result.files.forEach(x => trash.add(x));
  const all = `crop=${Math.round(w * 0.9)}:${Math.round(h * 0.14)}:${Math.round(w * 0.05)}:${Math.round(h * 0.43)}`;
  const lum = buf => { let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i]; return s / buf.length; };
  const before = lum(frame(f, Math.max(0, cu.start - 0.08), all)), early = lum(frame(f, cu.start + 0.05, all)), late = lum(frame(f, cu.start + 0.6, all));
  chk('im Video blendet der Untertitel ein: kurz nach Beginn ist er erst teilweise da', Math.abs(early - before) > 0.5 && Math.abs(late - before) > Math.abs(early - before) * 1.25, { before, early, late });
  const ex = Math.round(e.x * w - e.w * w / 2), ey = Math.round(e.y * h - e.w * w / 2), es = Math.round(e.w * w), er = `crop=${es}:${es}:${Math.max(0, ex)}:${Math.max(0, ey)}`;
  const withE = frame(f, cu.start + 1, er), noE = frame(A.ok ? A.result.playable : f, cu.start + 1, er); let d = 0; for (let i = 0; i < withE.length; i++) if (Math.abs(withE[i] - noE[i]) > 40) d++;
  chk('im Video steht das Symbol über dem Untertitel', A.ok && d / withE.length > 0.08 && e.y < cu.y, d / withE.length);
}
await page.selectOption('#stAnim', 'pop'); await sleep(200);
const C = await exp('untertitel_c');
chk('der Export mit Aufpoppen läuft durch', C.ok, C.error); if (C.ok) C.result.files.forEach(x => trash.add(x));
await ev(async () => { exFmt = 'capcut'; const plan = buildPlan(); plan.name = 'untertitel_cc'; plan.capcutInstall = false; const id = TS.exportVideo(JSON.stringify(plan)); for (;;){ await new Promise(r => setTimeout(r, 300)); const j = JSON.parse(TS.job(id)); if (j.status !== 'running'){ window._cc = j; break; } } exFmt = 'video'; });
const cc = await ev(() => ({ st: window._cc.status, files: (window._cc.result || {}).files || [], err: window._cc.error }));
chk('der CapCut-Export läuft mit eingeschalteten Effekten weiter durch', cc.st === 'done', cc.err); cc.files.forEach(x => trash.add(x));

// ═════════ Handy ═════════
await leave();
{
  const ph = await launch({ viewport: { width: 390, height: 844 }, dpr: 2 }), pg = ph.page, pe = (f, a) => pg.evaluate(f, a);
  const pid = await newProject(pg, [MEDIA + 'anlauf.mp4']); made.push(pid); await transcribe(pg);
  await pe(() => setTab('subs')); await sleep(300);
  await pe(() => document.querySelector('.fx-box').scrollIntoView({ block: 'center' })); await sleep(200);
  const over = sel => pe(sel => [...document.querySelectorAll(sel + ' *')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1); }).length, sel);
  await pg.check('#stHl'); await pg.selectOption('#stAnim', 'build'); await sleep(200);
  chk('auf dem Handy passen die neuen Einstellungen in die Breite', (await over('.fx-box')) === 0);
  await shot('handy-einstellungen', pg);
  await pe(() => { const b = document.querySelector('#cueList [data-a="emoji"]'); b.scrollIntoView({ block: 'center' }); b.click(); }); await pg.waitForSelector('.em-grid'); await sleep(250);
  chk('das Symbol-Blatt passt in die Breite; die Symbole sind groß genug zum Antippen', (await over('#sheetBody')) === 0 && await pe(() => [...document.querySelectorAll('.em')].every(b => b.getBoundingClientRect().width >= 44)));
  await shot('handy-symbol', pg);
  await pe(() => document.querySelector('#emOk').click()); await sleep(200);
  await pe(() => { setTab('text'); const w = tokens.filter(t => t.type === 'word'); selA = w[3].i; selB = w[4].i; showSel(); }); await sleep(250);
  const kb = await pe(() => { const b = document.querySelector('#selKw').getBoundingClientRect(), bar = document.querySelector('#selbar').getBoundingClientRect(); return [b.width > 20, b.left >= 0, bar.right <= innerWidth + 1]; });
  chk('„Betonen“ ist in der Auswahlleiste am Handy erreichbar', kb[0] && kb[1] && kb[2], kb);
  chk('auf dem Handy bleiben Meldungen der Seite aus', ph.logs.length === 0, ph.logs);
  await pe(k => { pausePlay(); clearTimeout(saveT); saveNow(); closeProject(); for (const x of k) localStorage.removeItem(x); }, KEYS); await ph.browser.close();
}

chk('keine Fehlermeldungen der Seite', logs.length === 0, logs);
await leave();
await ev(([ids, k]) => { for (const i of ids){ try { TS.deleteProject(i); if (TS.trashPurge) TS.trashPurge(i); } catch (_) {} } for (const x of k) localStorage.removeItem(x); dict.length = 0; emojiMap = []; }, [made, KEYS]);
for (const f of trash) fs.rmSync(f, { force: true, recursive: true });
await browser.close();
ende();
