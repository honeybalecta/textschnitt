'use strict';
/* ScriptGenius – Planer für Videos mit mehreren möglichen Ausgängen (Oberfläche). Der Rechenkern steht in plan-core.js.
   Pläne liegen im Gerät (localStorage „sg-plans“) – dort findet HoneyCut sie unter „Pfad-Plan“; für andere Geräte gibt es die Datei .scriptgenius. */
(function(){
  const H = window.ScriptGenius, $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const KEY = 'sg-plans', CUR = 'sg-current';
  let plans = [], cur = null, saveT = 0, sideT = 0;
  const openPaths = new Set();

  function toast(msg, ms){ const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), ms || 2600); }
  const fmtDur = s => { s = Math.round(s); return s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} min`; };
  const metaOf = text => { const n = H.words(text); return n ? `${n} ${n === 1 ? 'Wort' : 'Wörter'} · etwa ${fmtDur(H.secs(n))}` : 'ohne Skript – es zählt die Beschriftung'; };
  const cleanFile = s => String(s || 'Plan').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);

  // ───────── Ablage ─────────
  function load(){
    try { const raw = JSON.parse(localStorage.getItem(KEY) || '[]'); plans = (Array.isArray(raw) ? raw : []).map(p => { try { return H.parse(p); } catch(_){ return null; } }).filter(Boolean); }
    catch(_){ plans = []; }
  }
  function persist(){
    clearTimeout(saveT);
    try { localStorage.setItem(KEY, JSON.stringify(plans)); if (cur) localStorage.setItem(CUR, cur.id); $('#pSaved').textContent = 'Gespeichert'; return true; }
    catch(_){ $('#pSaved').textContent = 'Nicht gespeichert'; toast('Der Plan ließ sich nicht im Gerät speichern – bitte als Datei sichern'); return false; }
  }
  function touch(){ cur.changed = Date.now(); $('#pSaved').textContent = '…'; clearTimeout(saveT); saveT = setTimeout(persist, 400); }
  addEventListener('pagehide', () => { if (cur) persist(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && cur) persist(); });
  function use(p){ cur = p; openPaths.clear(); $('#pName').value = p.name; try { localStorage.setItem(CUR, p.id); } catch(_){} renderFlow(); renderSide(); $('#flowCol').scrollTop = 0; }
  function addPlan(p){ plans.unshift(p); use(p); persist(); }
  function sample(){
    const p = H.blank('Beispiel: Misstrauensvotum');
    const a = H.teil('Einstieg', 'Heute hat der Bundestag über das Misstrauensvotum abgestimmt. Seit Wochen war offen, wie es ausgeht.');
    const w1 = H.weiche('Abstimmung', ['Angenommen', 'Abgelehnt']);
    w1.outs[0].text = 'Der Antrag ist angenommen. Die Regierung ist damit am Ende.'; w1.outs[1].text = 'Der Antrag ist abgelehnt. Die Regierung bleibt im Amt.';
    const w2 = H.weiche('Neuwahl', ['Neuwahl kommt', 'Keine Neuwahl']);
    w2.outs[0].text = 'Dazu steht fest: Im Frühjahr wird neu gewählt.'; w2.outs[1].leer = true;
    const w3 = H.weiche('Kandidatur', ['Tritt wieder an', 'Zieht sich zurück']); w3.when = {[w1.id]: [w1.outs[0].id], [w2.id]: [w2.outs[0].id]};
    w3.outs[0].text = 'Und der bisherige Kanzler will noch einmal antreten.'; w3.outs[1].text = 'Und der bisherige Kanzler zieht sich zurück.';
    const z = H.teil('Schluss', 'Was daraus folgt, entscheidet sich an dem, was wir jetzt gemeinsam tun.');
    z.alts = [H.alt({[w1.id]: [w1.outs[1].id]}, 'Die Regierung bleibt. Was daraus folgt, entscheidet sich am Druck, den wir jetzt gemeinsam aufbauen.')];
    p.blocks.push(a, w1, w2, w3, z); return H.tidy(p);
  }

  // ───────── Ablauf ─────────
  const blkOf = el => { const a = el.closest('[data-b]'); return a ? cur.blocks.find(b => b.id === a.dataset.b) : null; };
  const outOf = (el, b) => { const a = el.closest('[data-o]'); return a && b && b.outs ? b.outs.find(o => o.id === a.dataset.o) : null; };
  const earlierW = k => cur.blocks.slice(0, k).filter(b => b.kind === 'weiche');
  const condSpan = when => `<b data-cond="${esc(JSON.stringify(when))}">${esc(H.condText(cur, when))}</b>`;
  const condHtml = when => when ? `<div class="cond"><span>Nur auf Pfaden mit ${condSpan(when)}</span><button type="button" class="sbtn slim" data-a="cond">Ändern</button><button type="button" class="ibtn slim" data-a="condDel" title="Bedingung entfernen – gilt wieder auf allen Pfaden">×</button></div>` : '';
  const altsHtml = x => (x.alts || []).map(a => `<div class="alt" data-alt="${a.id}"><div class="cond"><span>Abweichende Fassung für ${condSpan(a.when)}</span><button type="button" class="sbtn slim" data-a="altCond">Ändern</button><button type="button" class="ibtn slim" data-a="altDel" title="Diese Fassung entfernen">×</button></div>
      <textarea data-f="alt" rows="3" dir="auto" placeholder="Text dieser Fassung – ersetzt auf diesen Pfaden den Standardtext">${esc(a.text)}</textarea><div class="meta">${metaOf(a.text)}</div></div>`).join('');
  const insHtml = (k, n) => `<div class="ins${k === 0 ? ' first' : ''}${k === n ? ' last' : ''}" data-at="${k}"><button type="button" data-a="addTeil">＋ Gemeinsamer Teil</button><button type="button" data-a="addWeiche">＋ Weiche</button></div>`;
  function blockHtml(b, k, n){
    const hasW = earlierW(k).length > 0, move = `<button type="button" class="ibtn slim" data-a="up" title="Nach oben"${k ? '' : ' disabled'}>↑</button><button type="button" class="ibtn slim" data-a="down" title="Nach unten"${k < n - 1 ? '' : ' disabled'}>↓</button><button type="button" class="sbtn slim danger" data-a="del">Löschen</button>`;
    const condBtn = hasW && !b.when ? '<button type="button" class="sbtn slim" data-a="cond" title="Dieser Block kommt nur auf Pfaden vor, die du auswählst">Nur auf bestimmten Pfaden</button>' : '';
    const altBtn = hasW ? '<button type="button" class="sbtn slim" data-a="altAdd" title="Auf ausgewählten Pfaden einen anderen Text sagen – überall sonst gilt der Standardtext">＋ Abweichende Fassung</button>' : '';
    if (b.kind === 'weiche'){
      return `<article class="blk weiche" data-b="${b.id}"><header><span class="tag">Weiche</span><input type="text" class="lbl" data-f="label" maxlength="80" dir="auto" placeholder="Was entscheidet sich? Zum Beispiel: Abstimmung" value="${esc(b.label)}"></header>
        ${condHtml(b.when)}
        <div class="outs">${b.outs.map((o, j) => `<div class="out${o.leer ? ' leer' : ''}" data-o="${o.id}"><header><span class="letter">${String.fromCharCode(65 + j)}</span><input type="text" data-f="olabel" maxlength="80" dir="auto" placeholder="Ausgang, zum Beispiel: Angenommen" value="${esc(o.label)}"><button type="button" class="ibtn slim" data-a="outDel" title="Ausgang entfernen"${b.outs.length > 2 ? '' : ' disabled'}>×</button></header>
            <textarea data-f="otext" rows="4" dir="auto" placeholder="Was du bei diesem Ausgang sagst (optional)">${esc(o.text)}</textarea><div class="meta">${o.leer ? 'ohne eigenen Teil – hier geht es direkt weiter' : metaOf(o.text)}</div>
            ${o.leer ? '' : altsHtml(o)}
            <label class="chk"><input type="checkbox" data-f="leer"${o.leer ? ' checked' : ''}> Ohne eigenen Teil</label>
            ${o.leer || !altBtn ? '' : `<div class="acts">${altBtn}</div>`}</div>`).join('')}
          ${b.outs.length < H.MAX_OUTS ? '<button type="button" class="add-out" data-a="outAdd">＋ Ausgang</button>' : ''}</div>
        <div class="acts">${condBtn}${move}</div></article>`;
    }
    return `<article class="blk teil" data-b="${b.id}"><header><span class="tag">Gemeinsamer Teil</span><input type="text" class="lbl" data-f="label" maxlength="80" dir="auto" placeholder="Beschriftung, zum Beispiel: Einstieg" value="${esc(b.label)}"></header>
      ${condHtml(b.when)}
      <textarea data-f="text" rows="4" dir="auto" placeholder="Skript (optional)">${esc(b.text)}</textarea><div class="meta">${metaOf(b.text)}</div>
      ${altsHtml(b)}
      <div class="acts">${altBtn}${condBtn}${move}</div></article>`;
  }
  function renderFlow(){
    const B = cur.blocks, n = B.length, box = $('#flow');
    if (!n){ box.innerHTML = `<div class="empty" data-at="0"><p>Noch leer. Beginne mit dem, was in jedem Video gleich ist, oder gleich mit der ersten Weiche.</p><div class="row"><button type="button" class="rbtn" data-a="addTeil">＋ Gemeinsamer Teil</button><button type="button" class="rbtn red" data-a="addWeiche">＋ Weiche</button><button type="button" class="sbtn" data-a="sample">Beispiel ansehen</button></div></div>`; return; }
    box.innerHTML = B.map((b, k) => insHtml(k, n) + blockHtml(b, k, n)).join('') + insHtml(n, n);
  }
  function structure(focusSel){ H.tidy(cur); const top = $('#flowCol').scrollTop; renderFlow(); $('#flowCol').scrollTop = top; renderSide(); touch(); if (focusSel){ const el = $(focusSel); if (el){ el.focus({preventScroll: true}); el.scrollIntoView({block: 'nearest', behavior: 'smooth'}); } } }
  function sideSoon(){ clearTimeout(sideT); sideT = setTimeout(renderSide, 300); }
  const hasText = x => !!(String(x.text || '').trim() || (x.alts || []).some(a => a.text.trim()));

  $('#flow').addEventListener('input', e => {
    const t = e.target, f = t.dataset.f; if (!f) return; const b = blkOf(t); if (!b) return; const o = outOf(t, b);
    if (f === 'label') b.label = t.value.replace(/\s+/g, ' ').slice(0, 80);
    else if (f === 'text') b.text = t.value;
    else if (f === 'olabel' && o){ o.label = t.value.replace(/\s+/g, ' ').slice(0, 80); for (const el of $$('#flow [data-cond]')){ try { el.textContent = H.condText(cur, JSON.parse(el.dataset.cond)); } catch(_){} } }
    else if (f === 'otext' && o) o.text = t.value;
    else if (f === 'alt'){ const id = t.closest('[data-alt]').dataset.alt, a = ((o || b).alts || []).find(q => q.id === id); if (a) a.text = t.value; }
    else if (f === 'leer' && o){ if (t.checked) o.leer = true; else delete o.leer; return structure(); }
    if (t.tagName === 'TEXTAREA'){ const m = t.nextElementSibling; if (m && m.classList.contains('meta')) m.textContent = metaOf(t.value); }
    touch(); sideSoon();
  });
  $('#flow').addEventListener('click', async e => {
    const a = e.target.closest('[data-a]'); if (!a) return; const act = a.dataset.a;
    if (act === 'sample'){ if (!cur.blocks.length){ const s = sample(); cur.blocks = s.blocks; cur.name = s.name; $('#pName').value = cur.name; structure(); } return; }
    if (act === 'addTeil' || act === 'addWeiche'){
      if (cur.blocks.length >= H.MAX_BLOCKS) return toast('Mehr Blöcke fasst ein Plan nicht');
      const at = +(a.closest('[data-at]') || {dataset: {at: cur.blocks.length}}).dataset.at, nb = act === 'addTeil' ? H.teil('', '') : H.weiche('', ['', '']);
      cur.blocks.splice(at, 0, nb); return structure(`[data-b="${nb.id}"] .lbl`);
    }
    const b = blkOf(a); if (!b) return; const k = cur.blocks.indexOf(b), o = outOf(a, b), x = o || b;
    if (act === 'up' || act === 'down'){ const to = k + (act === 'up' ? -1 : 1); if (to < 0 || to >= cur.blocks.length) return;
      cur.blocks.splice(k, 1); cur.blocks.splice(to, 0, b); const lost = lostConds(); structure(`[data-b="${b.id}"] [data-a="${act}"]`); if (lost) toast('Bedingungen, die sich auf spätere Weichen bezogen, sind entfernt'); return; }
    if (act === 'del'){ const dep = dependents(b);
      if ((b.kind === 'weiche' ? b.outs.some(hasText) : hasText(b)) || dep){ if (!confirm(`${b.kind === 'weiche' ? 'Diese Weiche' : 'Diesen Teil'} löschen?` + (dep ? `\n\n${dep === 1 ? 'Eine Bedingung bezieht' : dep + ' Bedingungen beziehen'} sich darauf und ${dep === 1 ? 'fällt' : 'fallen'} mit weg.` : ''))) return; }
      cur.blocks.splice(k, 1); return structure(); }
    if (act === 'outAdd'){ if (b.outs.length >= H.MAX_OUTS) return; const no = H.aus('', ''); b.outs.push(no); return structure(`[data-o="${no.id}"] [data-f="olabel"]`); }
    if (act === 'outDel' && o){ if (b.outs.length <= 2) return; const dep = dependents(b, o); if ((hasText(o) || dep) && !confirm('Diesen Ausgang löschen?' + (dep ? '\n\nBedingungen, die sich darauf beziehen, werden angepasst.' : ''))) return;
      b.outs = b.outs.filter(q => q !== o); return structure(); }
    if (act === 'cond'){ const w = await askCond(k, b.when, {title: b.kind === 'weiche' ? 'Wann gibt es diese Weiche?' : 'Wann kommt dieser Teil vor?'}); if (w === undefined) return; if (w) b.when = w; else delete b.when; return structure(); }
    if (act === 'condDel'){ delete b.when; return structure(); }
    if (act === 'altAdd'){ if ((x.alts || []).length >= H.MAX_ALTS) return toast('Mehr Fassungen fasst ein Abschnitt nicht');
      const w = await askCond(k, null, {title: 'Für welche Pfade gilt die abweichende Fassung?', need: true}); if (!w) return; const na = H.alt(w, ''); (x.alts ||= []).push(na); return structure(`[data-alt="${na.id}"] textarea`); }
    const al = a.closest('[data-alt]'), alt = al && (x.alts || []).find(q => q.id === al.dataset.alt);
    if (act === 'altCond' && alt){ const w = await askCond(k, alt.when, {title: 'Für welche Pfade gilt die abweichende Fassung?', need: true}); if (!w) return; alt.when = w; return structure(); }
    if (act === 'altDel' && alt){ if (alt.text.trim() && !confirm('Diese Fassung löschen?')) return; x.alts = x.alts.filter(q => q !== alt); return structure(); }
  });
  // Wie viele Bedingungen hängen an dieser Weiche (oder diesem Ausgang)?
  function dependents(b, o){
    if (b.kind !== 'weiche') return 0; let n = 0;
    const hit = w => w && w[b.id] && (!o || w[b.id].includes(o.id));
    for (const q of cur.blocks){ if (hit(q.when)) n++; for (const x of q.kind === 'weiche' ? q.outs : [q]) for (const a of x.alts || []) if (hit(a.when)) n++; }
    return n;
  }
  function lostConds(){ const before = JSON.stringify(cur.blocks); const copy = H.tidy(JSON.parse(JSON.stringify(cur))); return JSON.stringify(copy.blocks) !== before; }

  // ───────── Bedingung wählen ─────────
  function askCond(k, when, o){
    const ws = earlierW(k), N = H.names(cur), sel = {}; for (const w of ws) sel[w.id] = new Set((when && when[w.id]) || []);
    return new Promise(res => {
      let done = false; const fin = v => { if (done) return; done = true; closeModal(); res(v); };
      const m = showModal(`<h3>${esc(o.title)}</h3><p class="muted small">Tippe die Ausgänge an, bei denen es gelten soll. Eine Weiche ohne Auswahl spielt keine Rolle.</p>
        ${ws.map(w => `<div class="cgroup" data-w="${w.id}"><b>${esc(N.blk.get(w.id))}</b><div class="chips">${w.outs.map(q => `<button type="button" class="chipb${sel[w.id].has(q.id) ? ' on' : ''}" data-o="${q.id}" aria-pressed="${sel[w.id].has(q.id)}">${esc(N.out.get(q.id))}</button>`).join('')}</div></div>`).join('')}
        <div class="row end wrap"><button type="button" class="sbtn" data-x="no">Abbrechen</button>${o.need ? '' : '<button type="button" class="sbtn" data-x="all">Auf allen Pfaden</button>'}<button type="button" class="rbtn" data-x="ok">Übernehmen</button></div>`, () => fin(undefined));
      m.onclick = e => {
        const c = e.target.closest('.chipb'); if (c){ const s = sel[c.closest('[data-w]').dataset.w], id = c.dataset.o; if (s.has(id)) s.delete(id); else s.add(id); c.classList.toggle('on', s.has(id)); c.setAttribute('aria-pressed', s.has(id)); return; }
        const x = e.target.closest('[data-x]'); if (!x) return;
        if (x.dataset.x === 'no') return fin(undefined); if (x.dataset.x === 'all') return fin(null);
        const w = {}; for (const id of Object.keys(sel)) if (sel[id].size) w[id] = [...sel[id]];
        if (!Object.keys(w).length){ if (o.need) return toast('Bitte mindestens einen Ausgang wählen'); return fin(null); }
        fin(w);
      };
    });
  }

  // ───────── Übersicht: Zahlen, Baum, Videos ─────────
  function treeSvg(list, N){
    const root = {label: 'Start', kids: new Map(), d: 0}; let maxD = 0;
    list.forEach((p, k) => { let n = root; p.picks.forEach((pk, d) => { const key = pk.w + '.' + pk.o; let c = n.kids.get(key); if (!c){ c = {label: N.out.get(pk.o), tip: N.blk.get(pk.w), kids: new Map(), d: d + 1}; n.kids.set(key, c); } n = c; maxD = Math.max(maxD, d + 1); }); n.leaf = k; n.key = p.key; });
    const RH = 40, CW = 168, BW = 140, BH = 28, RW = 58; let row = 0; const out = [];
    const cut = s => s.length > 17 ? s.slice(0, 16) + '…' : s, xOf = n => n.d === 0 ? 4 : RW + 30 + (n.d - 1) * CW, wOf = n => n.d === 0 ? RW : BW;
    (function lay(n){ const ks = [...n.kids.values()]; if (!ks.length){ n.y = RH * (row++ + 0.5); return; } ks.forEach(lay); n.y = (ks[0].y + ks[ks.length - 1].y) / 2; })(root);
    (function draw(n){
      const x = xOf(n), w = wOf(n);
      for (const c of n.kids.values()){ const cx = xOf(c), mid = x + w + (cx - x - w) / 2; out.push(`<path class="lk" d="M${x + w} ${n.y}H${mid}V${c.y}H${cx}"/>`); draw(c); }
      out.push(`<g class="nd${n.d ? '' : ' root'}"><title>${esc(n.d ? `${n.tip}: ${n.label}` : 'Anfang des Videos')}</title><rect x="${x}" y="${n.y - BH / 2}" width="${w}" height="${BH}" rx="8"/><text x="${x + w / 2}" y="${n.y + 4.5}" text-anchor="middle">${esc(cut(n.label))}</text></g>`);
      if (n.leaf != null) out.push(`<g class="leaf" data-k="${esc(n.key)}"><title>Video ${n.leaf + 1}</title><path class="lk" d="M${x + w} ${n.y}H${x + w + 12}"/><circle cx="${x + w + 24}" cy="${n.y}" r="12"/><text x="${x + w + 24}" y="${n.y + 4.5}">${n.leaf + 1}</text></g>`);
    })(root);
    const W = RW + 30 + Math.max(0, maxD - 1) * CW + (maxD ? BW : 0) + 48, Hh = Math.max(1, row) * RH;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Die Pfade als Baum">${out.join('')}</svg>`;
  }
  function renderSide(){
    clearTimeout(sideT); if (!cur) return;
    const P = H.paths(cur, 200), S = H.segs(cur), used = S.filter(s => s.n > 0), by = new Map(S.map(s => [s.id, s])), N = H.names(cur);
    const recWords = used.reduce((n, s) => n + H.words(s.text), 0), unused = S.filter(s => !s.n && s.text.trim()).length, cnt = P.count + (P.more && P.count >= 20000 ? '+' : '');
    $('#tabCount').textContent = cur.blocks.length ? cnt : '';
    $('#stats').innerHTML = `<div class="stat${P.count > 12 ? ' warn' : ''}"><b>${cnt}</b><span>${P.count === 1 ? 'Video' : 'Videos'}</span></div><div class="stat"><b>${used.length}</b><span>${used.length === 1 ? 'Abschnitt' : 'Abschnitte'} aufzunehmen</span></div><div class="stat"><b>${recWords ? fmtDur(H.secs(recWords)) : '–'}</b><span>Aufnahme nach Skript</span></div>`
      + (P.count > 12 ? `<p class="muted small" style="grid-column:1/-1;margin:2px 0 0">Jede weitere Weiche vervielfacht die Zahl der Videos. Mit Bedingungen („Nur auf bestimmten Pfaden“) bleibt sie klein.</p>` : '')
      + (unused ? `<p class="muted small" style="grid-column:1/-1;margin:2px 0 0">${unused === 1 ? 'Ein Text kommt' : unused + ' Texte kommen'} auf keinem Pfad vor (überall von einer abweichenden Fassung ersetzt).</p>` : '');
    const tb = $('#treeBox'); tb.classList.toggle('hidden', !cur.blocks.length);
    $('#tree').innerHTML = P.count > 60 ? `<p class="muted small" style="margin:6px">Der Baum ist für ${cnt} Videos zu groß – unten stehen die ersten ${P.list.length}.</p>` : treeSvg(P.list, N);
    const box = $('#paths');
    if (!cur.blocks.length){ box.innerHTML = '<p class="muted small">Sobald der Ablauf eine Weiche hat, stehen hier die Videos, die daraus entstehen.</p>'; return; }
    box.innerHTML = P.list.map((p, k) => { const n = H.pathWords(cur, p, by), meta = cur.paths[p.key] || {}, open = openPaths.has(p.key);
      return `<details class="path" data-k="${esc(p.key)}"${open ? ' open' : ''}><summary><span class="nr">${k + 1}</span><span class="pl" dir="auto">${esc(p.label || 'Ein Video – noch ohne Weiche')}</span><span class="pd">${n ? 'etwa ' + fmtDur(H.secs(n)) : p.segs.length + (p.segs.length === 1 ? ' Abschnitt' : ' Abschnitte')}</span></summary>
        <div class="body"><label class="fld">Titel für dieses Video (optional, für Titelbild und Übersicht)<input type="text" data-f="ptitle" maxlength="120" dir="auto" value="${esc(meta.title || '')}"></label>
        <div class="ptext" dir="auto">${p.segs.map(id => by.get(id)).filter(Boolean).map(s => `<span class="hd">${esc(s.label)}</span>${s.text.trim() ? esc(s.text.trim()) : '<span class="free">frei gesprochen</span>'}`).join('\n') || '<span class="free">Auf diesem Pfad liegt kein Abschnitt.</span>'}</div>
        <div class="row"><button type="button" class="sbtn slim" data-a="pcopy">Text dieses Videos kopieren</button></div></div></details>`; }).join('')
      + (P.more ? `<p class="muted small">… und weitere. Angezeigt sind die ersten ${P.list.length}.</p>` : '');
  }
  $('#paths').addEventListener('toggle', e => { const d = e.target.closest && e.target.closest('.path'); if (!d) return; if (d.open) openPaths.add(d.dataset.k); else openPaths.delete(d.dataset.k); }, true);
  $('#paths').addEventListener('input', e => { if (e.target.dataset.f !== 'ptitle') return; const k = e.target.closest('.path').dataset.k, v = e.target.value.replace(/\s+/g, ' ').slice(0, 120); if (v.trim()) cur.paths[k] = {title: v}; else delete cur.paths[k]; touch(); });
  $('#paths').addEventListener('click', async e => { const a = e.target.closest('[data-a="pcopy"]'); if (!a) return; const k = a.closest('.path').dataset.k, p = H.paths(cur, 200).list.find(q => q.key === k); if (!p) return;
    toast(await copyText(H.pathText(cur, p, {heads: false})) ? 'Text kopiert' : 'Kopieren hat nicht geklappt'); });
  $('#tree').addEventListener('click', e => { const l = e.target.closest('.leaf'); if (!l) return; const d = $$('#paths .path').find(q => q.dataset.k === l.dataset.k); if (!d) return; d.open = true; openPaths.add(d.dataset.k); d.scrollIntoView({block: 'center', behavior: 'smooth'}); d.classList.add('flash'); setTimeout(() => d.classList.remove('flash'), 1200); });

  // ───────── Fenster ─────────
  let modalClose = null;
  function showModal(html, onClose){ const m = $('#modal'); m.innerHTML = html; m.onclick = null; m.classList.remove('hidden'); $('#modalBack').classList.remove('hidden'); modalClose = onClose || null; m.scrollTop = 0; return m; }
  function closeModal(){ $('#modal').classList.add('hidden'); $('#modalBack').classList.add('hidden'); const f = modalClose; modalClose = null; if (f) f(); }
  $('#modalBack').onclick = closeModal;
  addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').classList.contains('hidden')) closeModal(); });

  async function copyText(t){
    try { await navigator.clipboard.writeText(t); return true; } catch(_){}
    try { const ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;opacity:0'; document.body.append(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch(_){ return false; }
  }
  // Datei sichern: am Computer und in der Android-App über die Brücke (Dialog bzw. Ordner „ScriptGenius“), im Browser als Download
  function saveText(name, mime, text){
    const bytes = new TextEncoder().encode(text);
    if (window.TS && TS.saveFile){ let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      try { const m = TS.saveFile(name, mime, btoa(bin), 'ScriptGenius'); return typeof m === 'string' ? (m || 'Nicht gespeichert') : 'Gespeichert'; } catch(e){ return 'Speichern fehlgeschlagen: ' + ((e && e.message) || e); } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], {type: mime})); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return 'Heruntergeladen: ' + name;
  }
  function fileOf(p){ const keys = new Set(H.paths(p, 5000).list.map(q => q.key)), c = JSON.parse(JSON.stringify(p)); for (const k of Object.keys(c.paths)) if (!keys.has(k)) delete c.paths[k]; return JSON.stringify(c); }

  // Pläne: öffnen, anlegen, duplizieren, löschen, aus einer Datei laden
  function openPlans(){
    const row = p => { const n = H.paths(p, 1).count; return `<div class="prow${p === cur ? ' cur' : ''}" data-p="${p.id}"><span class="pn"><b dir="auto">${esc(p.name)}</b><span class="muted small">${n} ${n === 1 ? 'Video' : 'Videos'} · geändert am ${new Date(p.changed).toLocaleDateString('de-DE')}</span></span><button type="button" class="sbtn slim" data-x="open">${p === cur ? 'Geöffnet' : 'Öffnen'}</button><button type="button" class="sbtn slim" data-x="dup" title="Als Kopie anlegen">Kopie</button><button type="button" class="ibtn slim" data-x="del" title="Plan löschen">×</button></div>`; };
    const m = showModal(`<h3>Pläne</h3><p class="muted small">Die Pläne liegen in diesem Gerät. HoneyCut findet sie hier unter „Pfad-Plan“; für ein anderes Gerät sicherst du einen Plan über „Für HoneyCut“ als Datei.</p>
      <div class="plist">${plans.map(row).join('')}</div>
      <div class="row wrap"><button type="button" class="rbtn" data-x="new">＋ Neuer Plan</button><label class="sbtn">Aus Datei öffnen …<input type="file" id="planFile" accept=".scriptgenius,.json,application/json" hidden></label><button type="button" class="sbtn" data-x="sample">Beispiel ansehen</button><span class="grow"></span><button type="button" class="sbtn" data-x="close">Schließen</button></div>`);
    m.querySelector('#planFile').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try { const p = H.parse(await f.text()); const old = plans.find(q => q.id === p.id);
        if (old){ if (!confirm(`„${old.name}“ gibt es hier schon. Durch die Datei ersetzen?\n\n„Abbrechen“ legt den Plan aus der Datei als Kopie an.`)){ p.id = H.newId(); p.name = (p.name + ' (Kopie)').slice(0, 80); plans.unshift(p); } else plans[plans.indexOf(old)] = p; use(p); persist(); }
        else addPlan(p);
        closeModal(); toast(`„${p.name}“ geöffnet`); }
      catch(err){ toast((err && err.message) || 'Die Datei lässt sich nicht lesen'); } };
    m.onclick = e => { const x = e.target.closest('[data-x]'); if (!x) return; const act = x.dataset.x, r = x.closest('[data-p]'), p = r && plans.find(q => q.id === r.dataset.p);
      if (act === 'close') return closeModal();
      if (act === 'new'){ persist(); addPlan(H.blank('Neuer Plan')); closeModal(); const n = $('#pName'); n.focus(); n.select(); return; }
      if (act === 'sample'){ persist(); addPlan(sample()); closeModal(); return; }
      if (!p) return;
      if (act === 'open'){ persist(); use(p); return closeModal(); }
      if (act === 'dup'){ persist(); const c = H.parse(JSON.stringify(p)); c.id = H.newId(); c.name = (p.name + ' (Kopie)').slice(0, 80); c.made = c.changed = Date.now(); addPlan(c); closeModal(); return toast('Kopie angelegt'); }
      if (act === 'del'){ if (!confirm(`Plan „${p.name}“ löschen?\n\nProjekte in HoneyCut, die ihn schon geladen haben, behalten ihre Kopie.`)) return;
        plans = plans.filter(q => q !== p); if (p === cur){ if (!plans.length) plans.push(H.blank('Neuer Plan')); use(plans[0]); } persist(); return openPlans(); }
    };
  }
  $('#plansBtn').onclick = () => { persist(); openPlans(); };

  // Aufnahme-Skript: jeder Abschnitt einmal
  function openScript(){
    let heads = true; const n = H.segs(cur).filter(s => s.n > 0).length;
    const m = showModal(`<h3>Aufnahme-Skript</h3><p class="muted small">Jeder der ${n} Abschnitte steht einmal da, in der Reihenfolge des Ablaufs: gemeinsame Teile, alle Ausgänge einer Weiche nacheinander, abweichende Fassungen. So nimmst du alles in einem Zug auf; HoneyCut setzt daraus die Videos zusammen.</p>
      <div class="row wrap"><div class="seg" id="scMode"><button type="button" data-h="1" class="on">Mit Überschriften</button><button type="button" data-h="0">Reiner Text</button></div><span class="muted small" id="scInfo"></span></div>
      <textarea class="script-box" id="scText" readonly dir="auto"></textarea>
      <p class="muted small" id="scNote"></p>
      <div class="row end wrap"><button type="button" class="sbtn" data-x="close">Schließen</button><button type="button" class="sbtn" data-x="save">Als Textdatei sichern</button><button type="button" class="rbtn" data-x="copy">Kopieren</button></div>`);
    const paint = () => { const t = H.script(cur, {heads}); m.querySelector('#scText').value = t; const w = H.words(t); m.querySelector('#scInfo').textContent = w ? `${w} Wörter · etwa ${fmtDur(H.secs(w))}` : 'noch ohne Text';
      m.querySelector('#scNote').textContent = heads ? 'Überschriften (Zeilen mit #) und Hinweise in eckigen Klammern liest HoneyCut beim Abgleich nicht mit. So passt das Skript auch in HoneyRec.' : 'Nur der Text zum Vorlesen, ohne Überschriften – für den Souffleur. Abschnitte ohne Skript fehlen hier.';
      for (const b of m.querySelectorAll('#scMode button')) b.classList.toggle('on', (b.dataset.h === '1') === heads); };
    m.onclick = async e => { const h = e.target.closest('[data-h]'); if (h){ heads = h.dataset.h === '1'; return paint(); }
      const x = e.target.closest('[data-x]'); if (!x) return;
      if (x.dataset.x === 'close') return closeModal();
      const t = H.script(cur, {heads}); if (!t.trim()) return toast('Der Plan hat noch keinen Text');
      if (x.dataset.x === 'copy') return toast(await copyText(t) ? 'Skript kopiert' : 'Kopieren hat nicht geklappt');
      if (x.dataset.x === 'save') return toast(saveText(`${cleanFile(cur.name)} – Aufnahme-Skript.txt`, 'text/plain', t), 4000); };
    paint();
  }
  $('#scriptBtn').onclick = openScript;

  // An HoneyCut geben
  function openCut(){
    const n = H.paths(cur, 1).count, same = !!(window.TS || /(^|\/)plan\.html$/.test(location.pathname));
    const m = showModal(`<h3>Für HoneyCut</h3>
      <p><b>Auf diesem Gerät:</b> Der Plan „${esc(cur.name)}“ steht in HoneyCut schon bereit. Öffne dort das Projekt mit der Aufnahme und wähle unter „Transkribieren“ den <b>Pfad-Plan</b>. HoneyCut ordnet die Aufnahme den Abschnitten zu und baut daraus ${n === 1 ? 'das Video' : `die ${n} Videos`}.</p>
      <p><b>Auf einem anderen Gerät:</b> Sichere den Plan als Datei und lade sie dort in HoneyCut unter „Pfad-Plan“ → „Aus Datei laden“.</p>
      <div class="row end wrap"><button type="button" class="sbtn" data-x="close">Schließen</button><button type="button" class="sbtn" data-x="file">Als Datei sichern (.scriptgenius)</button>${same ? '<button type="button" class="rbtn" data-x="cut">HoneyCut öffnen</button>' : ''}</div>`);
    m.onclick = e => { const x = e.target.closest('[data-x]'); if (!x) return;
      if (x.dataset.x === 'close') return closeModal();
      if (x.dataset.x === 'file') return toast(saveText(`${cleanFile(cur.name)}.scriptgenius`, 'application/json', fileOf(cur)), 4000);
      if (x.dataset.x === 'cut'){ persist(); if (window.TS && TS.openCut && TS.openCut()) return closeModal(); location.href = 'index.html'; } };
  }
  $('#cutBtn').onclick = () => { persist(); openCut(); };

  // ───────── Kopf, Umschalter, Start ─────────
  $('#pName').addEventListener('input', e => { cur.name = e.target.value.replace(/\s+/g, ' ').slice(0, 80) || 'Plan'; touch(); });
  $('#pName').addEventListener('change', e => { e.target.value = cur.name; });
  $('#pName').addEventListener('keydown', e => { if (e.key === 'Enter') e.target.blur(); });
  $('#pTabs').onclick = e => { const b = e.target.closest('[data-view]'); if (!b) return; $('#pMain').dataset.view = b.dataset.view; for (const q of $$('#pTabs button')) q.classList.toggle('on', q === b); if (b.dataset.view === 'side') renderSide(); };

  // Android: Zurück-Taste und Wechsel über ein anderes Startsymbol; aus HoneyCut geöffnet führt „Zurück“ dorthin
  let fromCut = false; try { fromCut = sessionStorage.getItem('sg-from') === 'cut'; sessionStorage.removeItem('sg-from'); } catch(_){}
  window.TSApp = Object.assign(window.TSApp || {}, {
    onBack(){ if (!$('#modal').classList.contains('hidden')){ closeModal(); return true; }
      if ($('#pMain').dataset.view === 'side' && getComputedStyle($('#pTabs')).display !== 'none'){ $('#pTabs [data-view="flow"]').click(); return true; }
      if (fromCut){ persist(); location.href = 'index.html'; return true; } persist(); return false; },
    onSwitch(){ persist(); return 'go'; },
  });

  load();
  if (!plans.length) plans.push(H.blank('Neuer Plan'));
  let first = plans[0]; try { const id = localStorage.getItem(CUR); first = plans.find(p => p.id === id) || first; } catch(_){}
  use(first);
  window.ScriptGeniusApp = {get plan(){ return cur; }, get plans(){ return plans; }, persist, use, sample};   // für die Prüfläufe
})();
