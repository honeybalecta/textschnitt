'use strict';
/* HoneyCut – Pfad-Videos (2.52): mehrere Videos aus einer Aufnahme, die sich nur an den Weichen eines Plans unterscheiden.
   Der Plan kommt aus ScriptGenius (plan-core.js: gemeinsame Teile, Weichen mit Ausgängen, Bedingungen, abweichende Fassungen).

   P.pfade = {plan, secs: [{seg, at, end}], vids: {Pfad: {id}}, got: {Weiche: Ausgang}}
     plan – Kopie des Plans, wie er geladen wurde
     secs – wo jeder Abschnitt des Plans in der Aufnahme liegt: Quellzeit vom Anfang des ersten bis zum Ende des letzten Worts
            (wie P.clipList). Die Zuordnung folgt dem Schnitt und gehört zum Rückgängig-Stand (pf).
     vids – die angelegten Pfad-Videos (Clip-Projekte, eines je Pfad)
     got  – Auswahl unter „Was ist eingetreten?“
   Im Pfad-Video: P.pfad = {main, plan, key, label, k, n, own}. Schnitt, Untertitel und Gestaltung kommen aus dem Hauptprojekt
   und werden vor jedem gemeinsamen Export von dort neu aufgebaut; Name und Titelbild (settings.coverFirst, settings.coverTpl)
   gehören dem Video. Wer ein Pfad-Video von Hand ändert, behält es (own) – es wird dann nicht mehr aufgefrischt. */

const pfOn = () => !!(P && P.pfade && P.pfade.plan && window.ScriptGenius);
const pfSecs = () => (P.pfade.secs ||= []);
let pfMemo = null, pfTokMemo = null;
function pfCalc(){
  const pl = P.pfade.plan; if (pfMemo && pfMemo.pl === pl) return pfMemo;
  const paths = ScriptGenius.paths(pl, 400), segs = ScriptGenius.segs(pl).filter(s => s.n > 0);
  return pfMemo = {pl, paths, segs, by: new Map(segs.map(s => [s.id, s]))};
}
// Token → {seg, k, first}: zu welchem Abschnitt ein Wort gehört (k: laufende Nummer im Text, first: Beschriftung am ersten Wort)
function pfToks(){
  if (pfTokMemo) return pfTokMemo; const m = new Map(); if (!pfOn() || !tokens.length) return pfTokMemo = m;
  const c = pfCalc(), list = pfSecs().map(x => ({x, r: secSpan(x)})).filter(q => q.r).sort((p, q) => p.r[0] - q.r[0]);
  list.forEach((q, k) => { const s = c.by.get(q.x.seg); for (let p = q.r[0]; p <= q.r[1]; p++) m.set(order[p], {seg: q.x.seg, k, first: p === q.r[0] ? (s ? s.label : 'Abschnitt') : ''}); });
  return pfTokMemo = m;
}
// Gehören zwei Wörter zum selben Abschnitt? Ähnliche Sätze in verschiedenen Ausgängen sind keine wiederholten Anläufe.
function pfSame(a, b){ if (!pfOn() || !pfSecs().length) return true; const m = pfToks(), x = m.get(a), y = m.get(b); return (x ? x.seg : null) === (y ? y.seg : null); }
function pfPaintTok(i, sp){
  const q = pfOn() ? pfToks().get(i) : null;
  sp.classList.toggle('pf', !!q); sp.classList.toggle('pfx', !!q && q.k % 2 === 1);
  if (q && q.first){ sp.classList.add('pf0'); if (sp.dataset.pf !== q.first) sp.dataset.pf = q.first; } else if (sp.classList.contains('pf0')){ sp.classList.remove('pf0'); delete sp.dataset.pf; }
}
// Bereich jedes Abschnitts im geschnittenen Video; wo sich zwei mit ihrer Luft davor und dahinter überschneiden, liegt die Grenze in der Mitte
function pfRanges(){
  const list = pfSecs().map(x => ({seg: x.seg, r: secOut(x)})).filter(q => q.r).map(q => ({seg: q.seg, a: q.r[0], b: q.r[1]})).sort((p, q) => p.a - q.a);
  for (let k = 1; k < list.length; k++){ const p = list[k - 1], q = list[k]; if (q.a < p.b){ const m = Math.min(Math.max((q.a + p.b) / 2, p.a), q.b); p.b = m; q.a = m; } }
  return new Map(list.filter(r => r.b - r.a > 0.2).map(r => [r.seg, [r.a, r.b]]));
}
function pfPaths(){
  const c = pfCalc(), R = pfRanges();
  return c.paths.list.map((p, k) => { const miss = p.segs.filter(s => !R.has(s)), rs = p.segs.filter(s => R.has(s)).map(s => R.get(s));
    return {...p, k, miss, rs, dur: rs.reduce((n, r) => n + r[1] - r[0], 0), ok: !miss.length && rs.length > 0}; });
}
function pfReset(){ pfMemo = null; pfTokMemo = null; clearTimeout(pfLateT); }
// Chip und offenes Blatt folgen dem Schnitt (kurz nach einer Änderung)
let pfLateT = 0;
function pfLater(){ if (!pfOn()) return; clearTimeout(pfLateT); pfLateT = setTimeout(() => { if (!pfOn()) return; pfTokMemo = null; pfPaintBtn(); if (pfSheetOpen()) pfRender(); }, 300); }
function pfChanged(){
  pfMemo = null; pfTokMemo = null;
  if (P && spans.length) tokens.forEach(t => paint(t.i));
  pfPaintBtn(); pfPaintInfo(); if (pfSheetOpen()) pfRender(); if (tab === 'export') pfExportNote();
}
function pfPaintBtn(){
  const b = $('#pfadeBtn'); if (!b) return; const on = pfOn(); b.classList.toggle('hidden', !on); if (!on) return;
  const ps = pfPaths(), ok = ps.filter(p => p.ok).length; b.textContent = `Pfade (${ok}/${ps.length})`; b.classList.toggle('on', ok > 0);
}
function pfPaintInfo(){
  const el = $('#pfInfo'); if (!el || !P) return; const on = pfOn();
  el.closest('.row').classList.toggle('hidden', !window.ScriptGenius || !!P.clipOf);
  if (on){ const n = pfCalc().paths.count; el.textContent = `${P.pfade.plan.name} · ${n} ${n === 1 ? 'Video' : 'Videos'}`; } else el.textContent = 'keiner';
  $('#pfPlanBtn').textContent = on ? 'Ändern' : 'Wählen';
}
function pfExportNote(){
  const box = $('#exPfade'); if (!box) return; const on = pfOn() && tokens.length > 0; box.classList.toggle('hidden', !on); if (!on) return;
  const ps = pfPaths(), ok = ps.filter(p => p.ok).length;
  box.firstElementChild.textContent = `Pfad-Plan „${P.pfade.plan.name}“: ${ok} von ${ps.length} Videos sind vollständig. „Video exportieren“ rechnet nur dieses Projekt als Ganzes – die Pfad-Videos exportierst du unter „Pfade“.`;
}

// ───────── Plan laden ─────────
function pfDevicePlans(){ const raw = J(lsGet('sg-plans', '[]')); return (Array.isArray(raw) ? raw : []).map(p => { try { return ScriptGenius.parse(p); } catch(_){ return null; } }).filter(Boolean); }
function pfLoad(plan){
  const old = P.pfade, same = !!(old && old.plan && old.plan.id === plan.id), ids = new Set(ScriptGenius.segs(plan).map(s => s.id));
  P.pfade = {plan, secs: same ? (old.secs || []).filter(x => ids.has(x.seg)) : [], vids: same ? old.vids || {} : {}, got: {}};
  const text = ScriptGenius.script(plan, {heads: true}), fresh = !tokens.some(t => t.type === 'word');
  if (fresh && window.Skript && Skript.words(text).length >= 5 && (!P.script || !Skript.words(P.script.text || '').length || P.script.plan)) P.script = {...(P.script || {}), text, plan: plan.id};
  pfMemo = null; pfTokMemo = null;
  let msg = `Plan „${plan.name}“ geladen`;
  if (!fresh){ const r = pfAuto(true); msg += r.n ? ` – ${r.n} von ${r.of} Abschnitten in der Aufnahme gefunden` : ' – die Abschnitte lassen sich unter „Pfade“ von Hand zuordnen'; }
  else msg += P.script && P.script.plan === plan.id ? ' – sein Skript dient der Transkription als Vorlage' : '';
  changed(false); saveNow(); if (window.paintPreScript) paintPreScript(); pfChanged(); toast(msg, 5000);
}
function pfUnload(){
  if (!pfOn()) return; const n = Object.keys(P.pfade.vids || {}).length;
  if (!confirm(`Den Plan „${P.pfade.plan.name}“ aus diesem Projekt nehmen?\n\nDie Zuordnung der Abschnitte geht verloren.` + (n ? ' Schon angelegte Pfad-Videos bleiben als eigene Projekte erhalten.' : ''))) return false;
  if (P.script && P.script.plan && !tokens.some(t => t.type === 'word')) P.script = null;
  delete P.pfade; changed(false); saveNow(); if (window.paintPreScript) paintPreScript(); pfChanged(); toast('Plan entfernt'); return true;
}
function pfOpenPick(){
  if (!P || !window.ScriptGenius) return; sheetItem = null;
  const body = $('#sheetBody'); body.onclick = null; body.onchange = null;
  const paint = () => {
    const list = pfDevicePlans(), curId = pfOn() ? P.pfade.plan.id : '';
    body.innerHTML = `<div id="pfPick"><h3>Pfad-Plan</h3>
      <p class="muted small">Ein Plan aus ScriptGenius legt fest, was in jedem Video gleich ist und an welchen Stellen sich die Videos trennen. HoneyCut ordnet die Aufnahme den Abschnitten des Plans zu und baut je Pfad ein eigenes Video.</p>
      ${pfOn() ? `<div class="cl-row"><span class="mk-t" style="flex:1"><b dir="auto">${esc(P.pfade.plan.name)}</b><i>in diesem Projekt geladen · ${pfCalc().paths.count} Videos</i></span><button type="button" class="btn small danger" data-a="unload">Entfernen</button></div>` : ''}
      <h4 style="margin:14px 0 6px">Pläne auf diesem Gerät</h4>
      ${list.length ? `<div class="cl-list">${list.map(p => { const n = ScriptGenius.paths(p, 1).count; return `<div class="cl-row" data-p="${esc(p.id)}"><span class="mk-t" style="flex:1"><b dir="auto">${esc(p.name)}</b><i>${n} ${n === 1 ? 'Video' : 'Videos'} · geändert am ${new Date(p.changed).toLocaleDateString('de-DE')}</i></span><button type="button" class="btn small${p.id === curId ? '' : ' primary'}" data-a="load">${p.id === curId ? 'Neu laden' : 'Laden'}</button></div>`; }).join('')}</div>`
        : '<p class="muted small">Noch keiner. Lege in ScriptGenius einen Plan an – er steht danach hier.</p>'}
      <div class="row wrap" style="margin-top:12px"><label class="btn">Aus Datei laden …<input type="file" id="pfFile" accept=".scriptgenius,.json,application/json" hidden></label><button type="button" class="btn" data-a="app">ScriptGenius öffnen</button><button type="button" class="btn" data-a="ok" style="margin-left:auto">Fertig</button></div></div>`;
    $('#pfFile').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try { pfLoad(ScriptGenius.parse(await f.text())); closeSheet(); } catch(err){ toast((err && err.message) || 'Die Datei lässt sich nicht lesen'); } };
  };
  body.onclick = e => { const a = e.target.closest('[data-a]'); if (!a) return; const act = a.dataset.a;
    if (act === 'ok') return closeSheet();
    if (act === 'unload'){ if (pfUnload()) paint(); return; }
    if (act === 'app') return pfOpenApp();
    if (act === 'load'){ const p = pfDevicePlans().find(q => q.id === a.closest('[data-p]').dataset.p); if (!p) return paint(); pfLoad(p); return closeSheet(); } };
  sheetOnClose = () => { body.onclick = null; };
  paint(); openSheet();
}
function pfOpenApp(){ if (TS.openPlan && TS.openPlan()) return; if (P && !saveNow()) return toast('Das Projekt ließ sich nicht speichern'); try { sessionStorage.setItem('sg-from', 'cut'); } catch(_){} location.href = 'plan.html'; }

// ───────── Abschnitte zuordnen ─────────
// Nach dem Skript des Plans: die Wörter, die im Video bleiben, in der Reihenfolge des Textes. → {n: gefunden, of: Abschnitte}
function pfAuto(quiet){
  const c = pfCalc(), res = {n: 0, of: c.segs.length}; if (!tokens.length || !window.Skript) return res;
  if (order.length !== tokens.length) computeOrder();
  const ids = order.filter(i => tokens[i].type === 'word' && tokText(tokens[i]) && !isCut(i));
  const r = ScriptGenius.place(c.pl, ids.map(i => ({text: tokText(tokens[i])}))), secs = [];
  for (const x of r.ranges){ const s = secOf(order.slice(pos[ids[x.a]], pos[ids[x.b]] + 1)); if (s) secs.push({seg: x.seg, ...s}); }
  res.n = secs.length; if (!secs.length) return res;
  const set = () => { P.pfade.secs = secs; };
  if (quiet) set(); else { commit(set, false); pfChanged(); }
  pfMemo = null; pfTokMemo = null; return res;
}
// Direkt nach der ersten Transkription (noch vor dem Aufräumen): Abschnitte nach dem Skript des Plans zuordnen
function pfAfterTrans(){ if (!pfOn()) return null; pfMemo = null; pfTokMemo = null; try { return pfAuto(true); } catch(e){ hcLog('Abschnitte des Plans zuordnen: ' + ((e && e.message) || e)); return null; } }
function pfAssign(seg, ids){
  const s = secOf(ids); if (!s){ toast('Erst im Text die Stelle markieren, die zu diesem Abschnitt gehört'); return false; }
  commit(() => {
    const n = secSpan(s), out = [];
    for (const x of pfSecs()){ if (x.seg === seg) continue; const r = secSpan(x); if (!r || !n || r[1] < n[0] || r[0] > n[1]){ out.push(x); continue; }
      const left = r[0] < n[0] ? [r[0], n[0] - 1] : null, right = r[1] > n[1] ? [n[1] + 1, r[1]] : null, keep = left && right ? (left[1] - left[0] >= right[1] - right[0] ? left : right) : left || right;
      const y = keep ? secOf(order.slice(keep[0], keep[1] + 1)) : null; if (y) out.push({seg: x.seg, ...y}); }
    out.push({seg, ...s}); P.pfade.secs = out; }, false);
  pfChanged(); return true;
}
function pfDrop(seg){ commit(() => { P.pfade.secs = pfSecs().filter(x => x.seg !== seg); }, false); pfChanged(); }

// ───────── Blatt „Pfade“: Abschnitte · Videos ─────────
let pfView = 'secs';
const pfSheetOpen = () => !$('#sheet').classList.contains('hidden') && !!$('#pfSheet');
function pfSecsHtml(){
  const c = pfCalc(), R = pfRanges(), by = new Map(pfSecs().map(x => [x.seg, x])), miss = c.segs.filter(s => !R.has(s.id)).length;
  return `<p class="muted small">${miss ? (miss === 1 ? 'Ein Abschnitt hat' : miss + ' Abschnitte haben') + ' noch keine Stelle in der Aufnahme.' : 'Jeder Abschnitt hat seine Stelle in der Aufnahme.'} Zum Ändern die Stelle im Text markieren und beim Abschnitt „Zuordnen“ wählen. Antippen zeigt den Abschnitt im Text.</p>
    <div class="cl-list">${c.segs.map(s => { const x = by.get(s.id), r = R.get(s.id);
      return `<div class="cl-row pf-row${r ? '' : ' cut'}" data-seg="${esc(s.id)}"><button type="button" class="mini" data-a="play" title="Anhören"${r ? '' : ' disabled'}>▶</button>
        <button type="button" class="mk-go" title="${r ? 'Im Text zeigen' : ''}"><span class="mono">${r ? fmtT(r[0]) : '–'}</span><span class="mk-t"><b dir="auto">${esc(s.label)}</b><i>${r ? fmtD(r[1] - r[0]) + ' s · ' + esc(secQuote(x, 6) || 'ohne Worte') : x ? 'weggeschnitten' : 'noch nicht zugeordnet'}${s.n > 1 ? ` · in ${s.n} Videos` : ''}</i></span></button>
        <button type="button" class="btn small" data-a="set" title="Die im Text markierte Stelle diesem Abschnitt zuordnen">Zuordnen</button>${x ? '<button type="button" class="mini" data-a="drop" title="Zuordnung entfernen">×</button>' : ''}</div>`; }).join('')}</div>
    <div class="row wrap">${window.Skript && c.segs.some(s => s.text.trim()) ? '<button type="button" class="btn small" data-a="auto" title="Die Abschnitte anhand ihres Skripts in der Aufnahme suchen">Nach dem Skript zuordnen</button>' : ''}<button type="button" class="btn small ghost" data-a="plan">Plan wechseln …</button></div>`;
}
// „Was ist eingetreten?“: die Weichen der Reihe nach; spätere erscheinen erst, wenn die früheren entschieden sind
function pfGot(){
  const pl = P.pfade.plan, got = (P.pfade.got ||= {}), N = ScriptGenius.names(pl), st = {}, picks = []; let html = '', open = false;
  for (const b of pl.blocks){ if (b.kind !== 'weiche' || !ScriptGenius.holds(b.when, st)) continue;
    const sel = b.outs.some(o => o.id === got[b.id]) ? got[b.id] : null;
    html += `<div class="field"><span dir="auto">${esc(N.blk.get(b.id))}</span><div class="seg-ctl pf-got" data-w="${esc(b.id)}">${b.outs.map(o => `<button type="button" data-o="${esc(o.id)}"${o.id === sel ? ' class="on"' : ''} dir="auto">${esc(N.out.get(o.id))}</button>`).join('')}</div></div>`;
    if (!sel){ open = true; break; } st[b.id] = sel; picks.push(b.id + '.' + sel); }
  return {html, key: open ? null : (picks.length ? picks.join('~') : ScriptGenius.KEY_NONE), any: !!html};
}
function pfVidsHtml(){
  const ps = pfPaths(), c = pfCalc(), pm = projMap(), vids = P.pfade.vids || {}, g = pfGot(), hit = g.key ? ps.find(p => p.key === g.key) : null, ok = ps.filter(p => p.ok).length;
  const row = p => { const v = vids[p.key], have = v && pm.has(v.id), st = p.ok ? fmtT(p.dur) : p.rs.length ? `es ${p.miss.length === 1 ? 'fehlt' : 'fehlen'}: ${p.miss.map(s => (c.by.get(s) || {}).label || '?').join(', ')}` : 'noch nichts zugeordnet';
    return `<div class="cl-row pf-vid${p === hit ? ' hit' : ''}${p.ok ? '' : ' cut'}" data-key="${esc(p.key)}"><button type="button" class="mk-go" data-a="vopen" title="Dieses Video öffnen: ansehen und sein Titelbild festlegen"${p.ok ? '' : ' disabled'}><span class="mono">${p.k + 1}</span><span class="mk-t"><b dir="auto">${esc(p.label || 'Video')}</b><i>${esc(st)}${have && v.own ? ' · von Hand geändert' : ''}${have && v.cover ? ' · eigenes Titelbild' : ''}</i></span></button>
      <button type="button" class="mini" data-a="vexp" title="Nur dieses Video exportieren"${p.ok ? '' : ' disabled'}>⤓</button>${have ? '<button type="button" class="mini" data-a="vmenu" title="Mehr zu diesem Video">⋯</button>' : ''}</div>`; };
  return `${g.any ? `<div class="pf-gotbox"><h4>Was ist eingetreten?</h4>${g.html}${hit ? `<p class="small" id="pfHit">Das ist <b>Video ${hit.k + 1}</b>: ${esc(hit.label || 'Video')}${hit.ok ? '' : ' – noch unvollständig'}.</p><div class="row wrap"><button type="button" class="btn primary" data-a="vhit"${hit.ok ? '' : ' disabled'}>Dieses Video exportieren</button><button type="button" class="btn small ghost" data-a="gotclear">Auswahl leeren</button></div>` : '<p class="muted small">Wähle je Weiche den Ausgang – dann steht hier das passende Video.</p>'}</div>` : ''}
    <p class="muted small">${ps.length === 1 ? 'Ein Video' : ps.length + ' Videos'}${c.paths.more ? ' (weitere nicht angezeigt)' : ''}, ${ok === ps.length ? 'alle vollständig' : ok + ' vollständig'}. Schnitt, Untertitel und Gestaltung kommen aus diesem Projekt und gelten für alle. Ein eigenes Titelbild legst du im geöffneten Video fest.</p>
    <div class="cl-list">${ps.map(row).join('')}</div>
    <div class="row wrap"><button type="button" class="btn primary" data-a="vall"${ok ? '' : ' disabled'}>Alle exportieren (${ok})</button></div>`;
}
function pfRender(){
  const box = $('#pfSheet'); if (!box) return; if (!pfOn()){ closeSheet(); return; } const top = $('#sheet').scrollTop, c = pfCalc(), R = pfRanges();
  const tabs = [['secs', `Abschnitte (${c.segs.filter(s => R.has(s.id)).length}/${c.segs.length})`], ['vids', `Videos (${c.paths.count})`]];
  box.innerHTML = `<h3 dir="auto">Pfade: ${esc(P.pfade.plan.name)}</h3><div class="seg-ctl small ck-tabs">${tabs.map(([k, l]) => `<button type="button" data-view="${k}"${k === pfView ? ' class="on"' : ''}>${l}</button>`).join('')}</div>
    ${pfView === 'secs' ? pfSecsHtml() : pfVidsHtml()}
    <div class="row" style="margin-top:12px"><button type="button" class="btn" data-a="ok" style="margin-left:auto">Fertig</button></div>`;
  $('#sheet').scrollTop = top;
}
function pfOpen(view){
  if (!pfOn()) return pfOpenPick(); sheetItem = null;
  if (view) pfView = view; else { const R = pfRanges(); if (pfCalc().segs.some(s => !R.has(s.id))) pfView = 'secs'; }   // fehlt noch ein Abschnitt, geht es dort los
  const body = $('#sheetBody'); body.innerHTML = '<div id="pfSheet"></div>'; body.onchange = null; body.onclick = pfClick;
  sheetOnClose = () => { body.onclick = null; };
  pfRender(); openSheet(true);
}
function pfClick(e){
  const v = e.target.closest('[data-view]'); if (v){ pfView = v.dataset.view; $('#sheet').scrollTop = 0; return pfRender(); }
  const go = e.target.closest('.pf-got [data-o]');
  if (go){ const got = (P.pfade.got ||= {}), w = go.closest('[data-w]').dataset.w; if (got[w] === go.dataset.o) delete got[w]; else got[w] = go.dataset.o; clearTimeout(saveT); saveT = setTimeout(saveNow, 300); return pfRender(); }
  const a = e.target.closest('[data-a]'), act = a ? a.dataset.a : '';
  if (act === 'ok') return closeSheet();
  if (act === 'plan') return pfOpenPick();
  if (act === 'auto'){ const r = pfAuto(false); return toast(r.n ? `${r.n} von ${r.of} Abschnitten gefunden – „Rückgängig“ holt die alte Zuordnung zurück` : 'Im Transkript ließ sich kein Abschnitt des Plans finden'); }
  const sr = e.target.closest('.pf-row');
  if (sr){ const seg = sr.dataset.seg, x = pfSecs().find(q => q.seg === seg);
    if (act === 'set'){ if (pfAssign(seg, selIds())){ clearSel(); toast('Zugeordnet'); } return; }
    if (act === 'drop') return pfDrop(seg);
    if (act === 'play'){ const r = pfRanges().get(seg); return r ? rangePlay(r) : null; }
    if (x && e.target.closest('.mk-go')) return secShow(x); return; }
  if (act === 'gotclear'){ P.pfade.got = {}; clearTimeout(saveT); saveT = setTimeout(saveNow, 300); return pfRender(); }
  if (act === 'vall') return pfExport(null);
  if (act === 'vhit'){ const g = pfGot(); return g.key ? pfExport([g.key]) : null; }
  const vr = e.target.closest('.pf-vid'); if (!vr) return; const key = vr.dataset.key;
  if (act === 'vexp') return pfExport([key]);
  if (act === 'vopen') return pfOpenVid(key);
  if (act === 'vmenu'){ const r = a.getBoundingClientRect(); return showMenu(Math.min(r.left, innerWidth - 300), r.bottom + 4, pfVidMenu(key)); }
}
function pfVidMenu(key){
  const v = (P.pfade.vids || {})[key]; if (!v) return [];
  return [{icon: icon('▶'), label: 'Video öffnen', fn: () => pfOpenVid(key)},
    v.own ? {icon: icon('↻'), label: 'Wieder aus diesem Projekt aufbauen', fn: () => { if (!confirm('Dieses Video wieder aus dem Hauptprojekt aufbauen?\n\nWas du im Video von Hand geändert hast, geht dabei verloren. Name und Titelbild bleiben.')) return; if (projEdit(v.id, p => { if (p.pfad) delete p.pfad.own; })){ delete v.own; saveNow(); pfRender(); toast('Beim nächsten Öffnen oder Export wird das Video neu aufgebaut'); } }}
      : {icon: icon('✎'), label: 'Von Hand weiterbearbeiten (nicht mehr auffrischen)', fn: () => { if (projEdit(v.id, p => { if (p.pfad) p.pfad.own = true; })){ v.own = true; saveNow(); pfRender(); } }},
    {icon: icon('🗑'), label: 'Dieses Video-Projekt löschen', cls: 'danger', fn: () => { if (!confirm('Das Projekt dieses Pfad-Videos löschen?' + (TS.trash ? '\n\nEs liegt danach noch 30 Tage im Papierkorb.' : '') + '\n\nBeim nächsten Export entsteht es neu – ohne sein Titelbild.')) return; try { TS.deleteProject(v.id); } catch(_){} delete P.pfade.vids[key]; saveNow(); pfRender(); }}];
}

// ───────── Pfad-Videos bauen ─────────
// Liegen die Abschnitte eines Pfads in der Aufnahme in anderer Reihenfolge als im Plan, wandern sie im Clip der Reihe nach ans Ende
function pfMoves(c, rs){
  let asc = true; for (let k = 1; k < rs.length; k++) if (rs[k][0] < rs[k - 1][1] - 0.01) asc = false;
  if (asc) return false;
  for (const [o1, o2] of rs) for (const g of timeline){ if (g.kind !== 'main') continue;
    const d = segDur(g), a = Math.max(g.o, o1), e = Math.min(g.o + d, o2); if (e <= a + 0.01) continue;
    const sp = g.speed || 1, s0 = r3(g.in + (a - g.o) * sp), s1 = r3(g.in + (e - g.o) * sp); c.moves.push({a: s0, b: s1, to: null}); c.splits.push(s0, s1); }
  return true;
}
// → {ids: Projekte der Videos in der Reihenfolge von list, bad: [Namen]}
function pfEnsure(list){
  const pm = projMap(), plan = P.pfade.plan, vids = (P.pfade.vids ||= {}), thumb = lsGet(THUMB_KEY(P.id), ''), ids = [], bad = [], n = pfCalc().paths.count;
  const own = new Set(Object.values(vids).map(v => v.id)), names = new Set([...pm.values()].filter(p => !own.has(p.id)).map(p => p.name));
  for (const p of list){
    const v = vids[p.key]; let old = null; if (v && pm.has(v.id)){ try { old = J(TS.loadProject(v.id)); } catch(_){} }
    if (old && old.pfad && old.pfad.own){ v.own = true; names.add(old.name); ids.push(old.id); continue; }
    try {
      const c = clipData(p.rs, P.format || '', uniqueName(old && old.name ? old.name : `${P.name} – ${p.label || 'Video'}`.slice(0, 120), names), true);
      pfMoves(c, p.rs);
      c.id = old ? old.id : newId(); if (old && old.created) c.created = old.created;
      c.pfad = {main: P.id, plan: plan.id, key: p.key, label: p.label || 'Video', k: p.k + 1, n, made: Date.now()};
      delete c.pfade; c.settings = {...(c.settings || {})};
      const os = old && old.settings;
      if (os && os.coverFirst) c.settings.coverFirst = os.coverFirst; if (os && os.coverTpl) c.settings.coverTpl = os.coverTpl;
      if (!os){ const t = (plan.paths[p.key] || {}).title; if (t) c.settings.coverTpl = {...(c.settings.coverTpl || {}), title: t}; }
      TS.saveProject(c.id, JSON.stringify(c)); if (thumb && !old) lsSet(THUMB_KEY(c.id), thumb);
      vids[p.key] = {id: c.id, ...(os && os.coverFirst && os.coverFirst.on ? {cover: 1} : {})}; ids.push(c.id);
    } catch(e){ hcLog('Pfad-Video anlegen: ' + ((e && e.message) || e)); bad.push(p.label || 'Video'); }
  }
  return {ids, bad};
}
async function pfExport(keys){
  if (!pfOn() || exBatch) return;
  if (transJob) return toast('Die Transkription läuft noch – danach lassen sich die Videos exportieren');
  const all = pfPaths(), want = keys ? all.filter(p => keys.includes(p.key)) : all, ok = want.filter(p => p.ok), no = want.filter(p => !p.ok);
  if (!ok.length) return toast(want.length === 1 ? 'Diesem Video fehlen noch Abschnitte – unter „Abschnitte“ zuordnen' : 'Noch ist kein Video vollständig – unter „Abschnitte“ zuordnen');
  if (no.length && !confirm(`${no.length === 1 ? 'Ein Video ist' : no.length + ' Videos sind'} noch unvollständig und ${no.length === 1 ? 'bleibt' : 'bleiben'} außen vor:\n\n${no.slice(0, 8).map(p => '· ' + (p.label || 'Video')).join('\n')}${no.length > 8 ? '\n…' : ''}\n\nDie ${ok.length === 1 ? 'übrige Datei' : 'übrigen ' + ok.length} exportieren?`)) return;
  if (playing) pausePlay(); if (!saveNow()) return toast('Das Projekt ließ sich nicht speichern – der Export wurde nicht gestartet');
  const r = pfEnsure(ok); saveNow();
  if (!r.ids.length) return toast('Die Videos ließen sich nicht anlegen' + (r.bad.length ? ': ' + r.bad.join(', ') : ''));
  if (r.bad.length) toast(`Nicht angelegt: ${r.bad.join(', ')}`, 5000);
  await exportProjects(r.ids, ok.length === 1 ? `„${ok[0].label || 'Video'}“ exportieren` : `${r.ids.length} Pfad-Videos exportieren`);
}
function pfOpenVid(key){
  const p = pfPaths().find(q => q.key === key); if (!p || !p.ok) return toast('Diesem Video fehlen noch Abschnitte');
  if (playing) pausePlay(); if (!saveNow()) return toast('Das Projekt ließ sich nicht speichern');
  const r = pfEnsure([p]); saveNow(); if (!r.ids.length) return toast('Das Video ließ sich nicht anlegen');
  closeSheet(); closeProject(); if (!P) openProject(r.ids[0]);
}

// ───────── Im Pfad-Video ─────────
// Erste Änderung von Hand: Das Video gehört ab jetzt sich selbst und wird nicht mehr aus dem Hauptprojekt aufgefrischt
function pfTouched(){
  if (!P || !P.pfad || P.pfad.own || exBatch) return; P.pfad.own = true;
  const pid = P.id;   // der Hinweis kommt nach der Meldung der Änderung selbst (etwa „Gelöscht“)
  setTimeout(() => { if (P && P.id === pid) toast('Dieses Pfad-Video hast du von Hand geändert. Es bleibt jetzt, wie es ist, und wird nicht mehr aus dem Hauptprojekt aufgefrischt – im Clip-Reiter lässt sich das umstellen.', 8000); }, 1400);
  setTimeout(pfClipCard, 0);
}
function pfClipCard(){
  const card = $('#clipPfadCard'); if (!card) return; const pf = P && P.pfad; card.classList.toggle('hidden', !pf); if (!pf) return;
  $('#clipPfadH').textContent = `Pfad-Video ${pf.k} von ${pf.n}: ${pf.label}`;
  $('#clipPfadInfo').textContent = pf.own ? 'Von Hand geändert: Dieses Video bleibt, wie es ist, und wird nicht mehr aus dem Hauptprojekt aufgefrischt.'
    : 'Schnitt, Untertitel und Gestaltung kommen aus dem Hauptprojekt und werden vor jedem gemeinsamen Export von dort neu aufgebaut. Name und Titelbild gehören diesem Video. Sobald du hier etwas änderst, bleibt das Video, wie es ist.';
  $('#clipPfadOwn').textContent = pf.own ? 'Wieder aus dem Hauptprojekt aufbauen' : 'Von Hand weiterbearbeiten';
}
function pfClipInit(){
  const q = id => document.getElementById(id); if (!q('clipPfadCard')) return;
  q('clipPfadCover').onclick = () => { if (window.openCoverTpl) openCoverTpl(); else $('#clipCover').click(); };
  q('clipPfadMain').onclick = () => { const pf = P && P.pfad; if (!pf) return; if (!projMap().has(pf.main)) return toast('Das Hauptprojekt gibt es nicht mehr'); closeSheet(); closeProject(); if (!P) openProject(pf.main); };
  q('clipPfadOwn').onclick = () => { const pf = P && P.pfad; if (!pf) return;
    if (pf.own){ if (!confirm('Dieses Video wieder aus dem Hauptprojekt aufbauen?\n\nBeim nächsten gemeinsamen Export oder Öffnen aus dem Hauptprojekt gehen die Änderungen von Hand verloren. Name und Titelbild bleiben.')) return; delete pf.own; }
    else pf.own = true;
    projEdit(pf.main, m => { const v = m.pfade && m.pfade.vids && m.pfade.vids[pf.key]; if (v){ if (pf.own) v.own = true; else delete v.own; } });
    saveNow(); pfClipCard(); };
}
// Ein Pfad-Video merkt im Hauptprojekt, ob es ein eigenes Titelbild trägt und ob es von Hand geändert ist (für die Liste dort)
function pfNoteMain(){
  const pf = P && P.pfad; if (!pf) return; const cover = !!(P.settings && P.settings.coverFirst && P.settings.coverFirst.on), own = !!pf.own, k = `${P.id}|${cover}|${own}`;
  if (pfNoteMain.k === k) return; pfNoteMain.k = k;
  let m = null; try { m = J(TS.loadProject(pf.main)); } catch(_){}
  const v = m && m.pfade && m.pfade.vids && m.pfade.vids[pf.key]; if (!v || v.id !== P.id || (!!v.cover === cover && !!v.own === own)) return;
  if (cover) v.cover = 1; else delete v.cover; if (own) v.own = true; else delete v.own;
  try { TS.saveProject(m.id, JSON.stringify(m)); } catch(e){ hcLog('Pfad-Video im Hauptprojekt vermerken: ' + ((e && e.message) || e)); }
}

// ───────── Anschluss an die Oberfläche ─────────
(function(){
  const on = (id, fn) => { const el = document.getElementById(id); if (el) el.onclick = fn; };
  on('pfadeBtn', () => pfOpen()); on('pfPlanBtn', pfOpenPick); on('exPfadeBtn', () => { setTab('text'); pfOpen('vids'); });
  on('planHome', pfOpenApp);
  pfClipInit();
})();
