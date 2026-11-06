'use strict';
/* HoneyDeck – Oberfläche. Läuft eigenständig (Browser, Windows, Android) oder eingebettet im HoneyCut-Reiter „Folien“.
   Eingebettet stellt HoneyCut im übergeordneten Fenster window.HC_DECK_HOST bereit: Folien, Transkript, Bilder,
   Rückgängig und „Als B-Roll einsetzen“ laufen dann über HoneyCut, gespeichert wird im HoneyCut-Projekt. */
(function(){
  const H = HoneyDeck, IO = HoneyDeckIO, IC = HoneyDeckIcons;
  const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);
  const clone = o => JSON.parse(JSON.stringify(o));
  const HOST = (() => { try { return window.parent !== window && window.parent.HC_DECK_HOST ? window.parent.HC_DECK_HOST : null; } catch(_){ return null; } })();
  const EMBED = !!HOST;
  if (EMBED) document.body.classList.add('embed');
  const DESKTOP = /[?&]desktop=1/.test(location.search);
  function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 3200); }

  // ───────── Ablage: Windows über das Programm, sonst IndexedDB ─────────
  const Store = (() => {
    let api = null;
    const ready = new Promise(res => {
      if (!DESKTOP) return res();
      if (window.pywebview && window.pywebview.api) { api = window.pywebview.api; return res(); }
      window.addEventListener('pywebviewready', () => { api = window.pywebview.api; res(); });
      setTimeout(res, 4000);
    });
    let dbP = null;
    const db = () => dbP ||= new Promise((res, rej) => { const r = indexedDB.open('honeydeck', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const tx = async (mode, fn) => { const d = await db(); return new Promise((res, rej) => { const t = d.transaction('kv', mode), s = t.objectStore('kv'); const r = fn(s); t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); }); };
    return {
      async get(k){ await ready; if (api){ const s = await api.store_get(k); return s ? JSON.parse(s) : null; } return tx('readonly', s => s.get(k)); },
      async set(k, v){ await ready; if (api) return api.store_set(k, JSON.stringify(v)); return tx('readwrite', s => s.put(v, k)); },
      async del(k){ await ready; if (api) return api.store_del(k); return tx('readwrite', s => s.delete(k)); },
      async keys(prefix){ await ready; if (api) return (await api.store_keys(prefix)) || []; const all = await tx('readonly', s => s.getAllKeys()); return (all || []).filter(k => String(k).startsWith(prefix)); },
      get desktop(){ return !!api; },
    };
  })();

  // ───────── Dateien speichern ─────────
  const blobB64 = b => new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(b); });
  async function saveBlob(blob, name){
    if (EMBED && HOST.saveFile) return HOST.saveFile(name, blob);
    if (Store.desktop && window.pywebview.api.save_file){ const p = await window.pywebview.api.save_file(name, await blobB64(blob)); if (p) toast('Gespeichert: ' + p); return; }
    if (window.DeckNative && window.DeckNative.saveFile){ const r = window.DeckNative.saveFile(name, blob.type || 'application/octet-stream', await blobB64(blob)); if (r) toast(r); return; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }
  const safeName = s => String(s || 'Präsentation').replace(/[\\/:*?"<>|]+/g, '_').trim().slice(0, 80) || 'Präsentation';

  // ───────── Zustand ─────────
  let deck = null, curId = null, viewFmt = null, sel = null, undo = [], redo = [], saveT = 0, icCat = '', inspTab = 'folie', lineTarget = null;
  const cur = () => deck && (deck.slides.find(s => s.id === curId) || null);
  const idx = sl => deck ? deck.slides.indexOf(sl) : 0;
  const profile = () => (deck && deck.profile) || H.BUILTIN[0];
  const projFmt = () => EMBED ? {k: 'projekt', n: 'Projekt', ...HOST.size()} : H.format(deck ? deck.format : '16:9');
  const fmtList = () => EMBED ? [projFmt(), ...H.FORMATS.filter(f => Math.abs(f.W / f.H - projFmt().W / projFmt().H) > 0.01)] : H.FORMATS;
  const workFmt = () => viewFmt || projFmt();
  const safe = f => EMBED && (!f || f.k === 'projekt') ? HOST.safe() : 0;
  const imgUrl = uri => !uri ? null : /^(data:|blob:|https?:)/.test(uri) ? uri : EMBED ? HOST.mediaUrl(uri) : null;
  const renderOpts = (sl, f, extra = {}) => ({k: idx(sl), profile: profile(), safe: safe(f), imgUrl, ...extra});

  // Rückgängig: eigenständig über Momentaufnahmen, eingebettet über HoneyCut
  function commit(fn, opts = {}){
    if (EMBED){ fn(); pushHost(); }
    else { undo.push(JSON.stringify(deck)); if (undo.length > 60) undo.shift(); redo = []; fn(); deck.updated = Date.now(); scheduleSave(); }
    if (opts.render !== false) renderAll(); else { renderList(); renderStage(); }
  }
  function pushHost(){ HOST.apply(clone(deck.slides), clone(deck.profile)); }
  function scheduleSave(){ if (EMBED) return; $('#saved').textContent = '…'; clearTimeout(saveT); saveT = setTimeout(saveNow, 500); }
  async function saveNow(){ if (!deck || EMBED) return; try { await Store.set('deck:' + deck.id, deck); $('#saved').textContent = 'gespeichert'; } catch(e){ $('#saved').textContent = 'nicht gespeichert'; toast('Speichern fehlgeschlagen: ' + e.message); } }
  function doUndo(){ if (EMBED) return HOST.undo(); if (!undo.length) return; redo.push(JSON.stringify(deck)); deck = JSON.parse(undo.pop()); scheduleSave(); renderAll(); }
  function doRedo(){ if (EMBED) return HOST.redo(); if (!redo.length) return; undo.push(JSON.stringify(deck)); deck = JSON.parse(redo.pop()); scheduleSave(); renderAll(); }

  // ───────── Profile ─────────
  const PROF_KEY = 'hc-slide-profiles';
  let userProfs = [];
  async function loadProfiles(){
    if (EMBED){ try { userProfs = JSON.parse(localStorage.getItem(PROF_KEY) || '[]').filter(p => p && p.id && p.colors); } catch(_){ userProfs = []; } }
    else userProfs = (await Store.get('profiles')) || [];
  }
  async function saveProfiles(){ if (EMBED) { try { localStorage.setItem(PROF_KEY, JSON.stringify(userProfs)); } catch(_){} } else await Store.set('profiles', userProfs); }
  const allProfiles = () => { const l = H.BUILTIN.concat(userProfs); const p = deck && deck.profile; if (p && !l.some(x => x.id === p.id)) l.push(p); return l; };

  // ───────── Vorschaubilder (zwischengespeichert) ─────────
  const thumbs = new Map();
  async function thumb(sl, f, w){
    const h = Math.round(w * f.H / f.W), key = JSON.stringify([sl, idx(sl), profile(), f.W, f.H, w, safe(f)]);
    const c = thumbs.get(sl.id + '|' + f.k + '|' + w);
    if (c && c.key === key) return c.url;
    const cv = await H.render(sl, w * 2, h * 2, renderOpts(sl, f));
    const url = cv.toDataURL('image/jpeg', 0.82); thumbs.set(sl.id + '|' + f.k + '|' + w, {key, url}); return url;
  }
  const checks = new Map();
  async function checkSlide(sl){
    const key = JSON.stringify([sl, profile(), EMBED ? HOST.safe() : 0]), c = checks.get(sl.id);
    if (c && c.key === key) return c.res;
    const res = await H.check(sl, profile(), {formats: fmtList(), k: idx(sl), safe: 0});
    checks.set(sl.id, {key, res}); return res;
  }

  // ───────── Übersicht ─────────
  async function showHome(){
    deck = null; $('#ed').classList.add('hidden'); $('#home').classList.remove('hidden');
    const keys = await Store.keys('deck:'), list = [];
    for (const k of keys){ try { const d = await Store.get(k); if (d) list.push(d); } catch(_){} }
    list.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    $('#homeEmpty').classList.toggle('hidden', list.length > 0);
    const box = $('#deckList'); box.innerHTML = '';
    for (const d of list){
      const el = document.createElement('div'); el.className = 'deck-card'; el.tabIndex = 0;
      el.innerHTML = `<img alt=""><div class="meta"><b>${esc(d.name)}</b><span class="muted small">${d.slides.length} Folien · ${esc(H.format(d.format).n)} · ${new Date(d.updated || d.created).toLocaleDateString('de-DE')}</span></div>
        <div class="acts"><button data-a="ren">Umbenennen</button><button data-a="dup">Kopie</button><button data-a="exp">.honeydeck</button><button data-a="del">Löschen</button></div>`;
      const img = el.querySelector('img'), f = H.format(d.format);
      img.style.aspectRatio = `${f.W} / ${f.H}`;
      if (d.slides[0]) H.render(d.slides[0], 480, Math.round(480 * f.H / f.W), {k: 0, profile: d.profile, imgUrl}).then(cv => img.src = cv.toDataURL('image/jpeg', 0.8));
      el.onclick = async e => {
        const a = e.target.closest('[data-a]');
        if (!a) return openDeck(d);
        e.stopPropagation();
        if (a.dataset.a === 'ren'){ const n = prompt('Neuer Name', d.name); if (n){ d.name = n.trim() || d.name; d.updated = Date.now(); await Store.set('deck:' + d.id, d); showHome(); } }
        if (a.dataset.a === 'dup'){ const c = clone(d); c.id = H.uid(); c.name = d.name + ' (Kopie)'; c.updated = Date.now(); await Store.set('deck:' + c.id, c); showHome(); }
        if (a.dataset.a === 'exp') saveBlob(new Blob([JSON.stringify(d)], {type: 'application/json'}), safeName(d.name) + '.honeydeck');
        if (a.dataset.a === 'del' && confirm(`„${d.name}“ löschen?`)){ await Store.del('deck:' + d.id); showHome(); }
      };
      el.onkeydown = e => { if (e.key === 'Enter') openDeck(d); };
      box.append(el);
    }
  }
  function openDeck(d){
    deck = H.normDeck(d); curId = deck.slides[0] ? deck.slides[0].id : null; viewFmt = null; sel = null; undo = []; redo = [];
    $('#home').classList.add('hidden'); $('#ed').classList.remove('hidden'); $('#saved').textContent = '';
    renderAll();
  }
  async function newDeckDialog(prefill){
    const m = modal(`<h3>Neue Präsentation</h3>
      <label class="field"><span>Name</span><input id="ndName" value="${esc(prefill && prefill.name ? prefill.name.replace(/\.[^.]+$/, '') : 'Neue Präsentation')}"></label>
      <div class="row wrap"><label class="field" style="flex:1"><span>Format</span><select id="ndFmt">${H.FORMATS.map(f => `<option value="${f.k}">${esc(f.n)}</option>`).join('')}</select></label>
        <label class="field" style="flex:1"><span>Design</span><select id="ndProf">${allProfiles().map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select></label></div>
      <label class="field"><span>Text oder Skript (optional) – Überschriften mit #, Listen mit -, Zitate mit &gt;</span><textarea id="ndText" rows="8" placeholder="Hier einen fertigen Text, ein Skript oder ein Transkript einfügen …">${esc(prefill && prefill.text || '')}</textarea></label>
      <div class="field"><span>Aus dem Text</span><div class="seg" id="ndMode"><button data-v="satz" class="on">Folien je Satz</button><button data-v="absatz">Folien je Absatz</button><button data-v="nur">nur als Text laden</button></div></div>
      <div class="acts"><button class="btn" data-x>Abbrechen</button><button class="btn primary" id="ndOk">Anlegen</button></div>`);
    let mode = 'satz';
    m.querySelector('#ndMode').onclick = e => { const b = e.target.closest('button'); if (!b) return; mode = b.dataset.v; m.querySelectorAll('#ndMode button').forEach(x => x.classList.toggle('on', x === b)); };
    m.querySelector('#ndOk').onclick = async () => {
      const text = m.querySelector('#ndText').value;
      const d = H.newDeck({name: m.querySelector('#ndName').value.trim() || 'Neue Präsentation', format: m.querySelector('#ndFmt').value,
        profile: clone(allProfiles().find(p => p.id === m.querySelector('#ndProf').value) || H.BUILTIN[0])});
      if (text.trim()){ d.source = {name: prefill && prefill.name || 'Eingefügter Text', text}; if (mode !== 'nur') d.slides = H.textToSlides(text, {mode}); linkToSource(d); }
      if (!d.slides.length) d.slides.push(H.newSlide({title: d.name}));
      closeModal(); await Store.set('deck:' + d.id, d); openDeck(d);
      if (d.slides.length > 1) toast(`${d.slides.length} Folien als Entwurf angelegt – kürzen, Art wählen, Symbole ergänzen`);
    };
  }

  // ───────── Text-/Transkriptquelle ─────────
  // Wörter mit Absatznummer; eingebettet kommt das Transkript aus HoneyCut (i = Wortnummer dort)
  function words(){
    if (EMBED) return HOST.words();
    if (!deck || !deck.source || !deck.source.text) return [];
    const out = []; let i = 0;
    String(deck.source.text).replace(/\r/g, '').split(/\n\s*\n/).forEach((para, p) => {
      para.split(/\s+/).filter(Boolean).forEach(w => { if (/^#+$|^[-*•>]$/.test(w)) return; const c = w.replace(/\*\*/g, ''); if (c) out.push({i: i++, w: c, p}); }); });
    return out;
  }
  const wordsText = (ws, a, b) => ws.filter(t => t.i >= a && t.i <= b && !t.cut).map(t => t.w).join(' ').replace(/\s+([.,!?;:])/g, '$1').trim();
  // Folien ohne Verknüpfung über ihren Text an die Quelle hängen (Reihenfolge bleibt)
  function linkToSource(d, ws){
    const prev = deck; deck = d; ws = ws || words(); deck = prev;
    let from = 0, n = 0;
    for (const s of d.slides){ if (s.a != null) { from = s.b + 1; continue; }
      const m = H.matchCue(H.slideText(s), ws, from) || H.matchCue(H.slideText(s), ws, 0);
      if (m){ s.a = m.a; s.b = m.b; from = m.b + 1; n++; } }
    return n;
  }

  // ───────── Zeichnen der Oberfläche ─────────
  function renderAll(){
    if (!deck) return;
    $('#edName').value = deck.name || '';
    $('#edFmt').innerHTML = H.FORMATS.map(f => `<option value="${f.k}">${esc(f.n)}</option>`).join(''); $('#edFmt').value = deck.format;
    $('#fmtWrap').classList.toggle('hidden', EMBED);
    $('#edProf').innerHTML = allProfiles().map(p => `<option value="${esc(p.id)}">${esc(p.name)}${p.builtin ? '' : ' (eigenes)'}</option>`).join(''); $('#edProf').value = profile().id;
    if (EMBED){ $('#subSafe').checked = HOST.subSafe(); }
    if (!cur() && deck.slides.length) curId = deck.slides[0].id;
    $('#edBody').classList.toggle('no-src', !EMBED && !(deck.source && deck.source.text) && innerWidth > 900);
    renderList(); renderStage(); renderInsp(); renderSrc();
  }
  function renderList(){
    const box = $('#slList'); box.innerHTML = '';
    $('#slCount').textContent = deck.slides.length ? deck.slides.length + '' : '';
    const ws = words(), f = projFmt();
    deck.slides.forEach((sl, k) => {
      const d = document.createElement('div'); d.className = 'sl-item' + (sl.id === curId ? ' on' : ''); d.dataset.id = sl.id; d.draggable = true;
      const t = EMBED ? HOST.times(sl) : null, linked = sl.a != null;
      d.innerHTML = `<img alt=""><div class="sl-meta"><b>${k + 1} <span class="warn" data-warn></span></b><span>${esc(H.layout(sl.layout).n)}</span>
        <span class="muted">${t ? HOST.fmtTime(t.s) : linked ? '⛓ verknüpft' : EMBED ? 'nicht verknüpft' : ''}${EMBED && HOST.placed(sl) ? ' · eingesetzt' : ''}</span></div>
        <div class="sl-acts"><button data-a="up" title="nach vorn">↑</button><button data-a="down" title="nach hinten">↓</button><button data-a="dup" title="duplizieren">⧉</button><button data-a="del" title="löschen">✕</button></div>`;
      thumb(sl, f, 160).then(u => d.querySelector('img').src = u);
      checkSlide(sl).then(r => { const bad = r.filter(x => x.over || x.small); const w = d.querySelector('[data-warn]'); if (w){ w.textContent = bad.length ? '⚠' : ''; w.title = bad.length ? 'Text sehr klein in: ' + bad.map(x => x.n).join(', ') : ''; } });
      box.append(d);
    });
    if (!deck.slides.length) box.innerHTML = `<p class="muted small" style="padding:8px">Noch keine Folien. ${EMBED || (deck.source && deck.source.text) ? 'Unten im Text Wörter markieren und „→ Neue Folie“ wählen – oder „✨ Grundlage aus dem Text“.' : '„＋ Folie“ legt eine an, „⤓ Import“ holt Text oder Folien herein.'}</p>`;
    void ws;
  }
  let stageTok = 0;
  async function renderStage(){
    const sl = cur(), cv = $('#stage'), tok = ++stageTok, f = workFmt();
    const strip = $('#fmtStrip');
    if (!sl){ cv.width = 16; cv.height = 9; cv.getContext('2d').clearRect(0, 0, 16, 9); strip.innerHTML = ''; $('#fmtNote').textContent = ''; return; }
    const st = $('.stage'), maxW = Math.max(320, st.clientWidth || 960), maxH = Math.max(200, st.clientHeight || 540);
    const sc = Math.min(maxW / f.W, maxH / f.H), w = Math.round(f.W * sc * (devicePixelRatio || 1)), h = Math.round(f.H * sc * (devicePixelRatio || 1));
    const r = await H.render(sl, w, h, renderOpts(sl, f));
    if (tok !== stageTok) return;
    cv.width = w; cv.height = h; cv.style.width = Math.round(f.W * sc) + 'px'; cv.style.height = Math.round(f.H * sc) + 'px';
    cv.getContext('2d').drawImage(r, 0, 0);
    drawMini(r);
    // Alle Formate nebeneinander, mit Warnung, wenn ein Text sehr klein werden musste
    const res = await checkSlide(sl); if (tok !== stageTok) return;
    strip.innerHTML = fmtList().map(x => { const c = res.find(q => q.k === x.k) || {}; return `<button data-f="${x.k}" class="${x.k === f.k ? 'on' : ''}" title="${esc(x.n)}${c.over || c.small ? ' – Text musste stark verkleinert werden, besser kürzen' : ''}"><img alt=""><span class="${c.over || c.small ? 'bad' : ''}">${c.over || c.small ? '⚠ ' : ''}${esc(x.k === 'projekt' ? 'Projekt' : x.k)}</span></button>`; }).join('');
    fmtList().forEach((x, i) => thumb(sl, x, 120).then(u => { const im = strip.querySelectorAll('img')[i]; if (im) im.src = u; }));
    const bad = res.filter(x => x.over || x.small);
    $('#fmtNote').innerHTML = bad.length ? `<span class="warn">⚠ In ${bad.map(x => esc(x.n)).join(', ')} wird Text sehr klein – kürzen oder eine andere Folienart wählen.</span>` : 'Passt in allen Formaten. Ein Klick auf ein Format zeigt die Folie darin.';
  }

  // Kleine Vorschau über dem Bearbeiten-Bereich (schmale Fenster)
  function drawMini(r){ const m = $('#miniPrev'); if (!m || !r) return; m.width = r.width; m.height = r.height; m.getContext('2d').drawImage(r, 0, 0); }
  async function miniPrev(){ const sl = cur(), m = $('#miniPrev'); if (!sl || !m || innerWidth > 900) return; const f = workFmt(), w = 640, h = Math.round(w * f.H / f.W);
    drawMini(await H.render(sl, w, h, renderOpts(sl, f))); }

  // ───────── Bearbeiten ─────────
  let layThumbs = new Map();
  function layoutPreview(k){
    const sl = cur(), key = k + '|' + profile().id + '|' + (sl ? sl.dark : '') + '|' + (sl ? idx(sl) : 0);
    if (layThumbs.has(key)) return layThumbs.get(key);
    const sample = SAMPLES[k] || {}, s = H.newSlide({layout: k, dark: sl ? sl.dark : null, ...sample});
    const f = projFmt(), w = 132, h = Math.round(w * f.H / f.W);
    const p = H.render(s, w * 2, h * 2, {k: sl ? idx(sl) : 0, profile: profile(), imgUrl: () => null}).then(cv => cv.toDataURL('image/jpeg', 0.75));
    layThumbs.set(key, p); return p;
  }
  const SAMPLES = {titel: {kicker: 'Rubrik', title: 'Ein klarer Titel', text: 'Mit einem kurzen Satz darunter.'}, liste: {title: 'Stichpunkte', text: 'Erster Punkt\nZweiter Punkt\nDritter Punkt'},
    zitat: {text: 'Ein Satz, den jemand gesagt hat.', title: 'Name'}, zahl: {title: '42 %', text: 'Was die Zahl bedeutet.'}, begriff: {title: 'Begriff', text: 'Die Bedeutung in einem Satz.'},
    bild: {title: 'Bild und Text', text: 'Erklärung.'}, vollbild: {title: 'Bildunterschrift'}, zwei: {title: 'Vergleich', text: 'Links\nText', text2: 'Rechts\nText'},
    aussage: {title: 'Ein Satz, der *hängen bleibt*.'}, frage: {title: 'Wem nützt das?'}, icons: {title: 'Piktogramme', text: 'Eins\nZwei\nDrei', icons: ['fabrik', 'gruppe', 'megafon']},
    prozess: {title: 'Ablauf', text: 'Schritt\nSchritt\nSchritt'}, zeitstrahl: {title: 'Zeitstrahl', text: '1918: Ereignis\n1919: Ereignis\n1933: Ereignis'},
    checkliste: {title: 'Richtig/Falsch', text: '+ Stimmt\n- Stimmt nicht\n+ Stimmt'}, zahlen: {title: 'Kennzahlen', text: '12: Eins\n40: Zwei\n7: Drei'},
    balken: {title: 'Balken', text: 'A: 30\n*B: 45\nC: 20'}, anteil: {title: '37 %', text: 'Anteil'}, menschen: {title: '3 von 10', text: 'Verhältnis'}};

  function renderInsp(){
    $$('#inspTabs button').forEach(b => b.classList.toggle('on', b.dataset.t === inspTab));
    $('#inspFolie').classList.toggle('hidden', inspTab !== 'folie'); $('#inspElemente').classList.toggle('hidden', inspTab !== 'elemente');
    if (inspTab === 'elemente') return renderLib();
    const box = $('#inspFolie'), sl = cur();
    if (!sl){ box.innerHTML = '<p class="muted small">Keine Folie ausgewählt.</p>'; return; }
    const L = H.layout(sl.layout), lbl = f => (L.lbl && L.lbl[f]) || H.LBL[f];
    const groups = [...new Set(H.LAYOUTS.map(l => l.g))];
    const th = sl.dark == null ? 'auto' : sl.dark ? 'dark' : 'light';
    const t = EMBED ? HOST.times(sl) : null, ws = sl.a != null ? wordsText(words(), sl.a, sl.b) : '';
    box.innerHTML = `<div class="mini-prev"><canvas id="miniPrev"></canvas></div>
      ${groups.map(g => `<div class="lay-group"><span>${esc(g)}</span><div class="lay-grid">${H.LAYOUTS.filter(l => l.g === g).map(l => `<button data-l="${l.k}" class="${l.k === sl.layout ? 'on' : ''}" title="${esc(l.n)}"><img alt="">${esc(l.n)}</button>`).join('')}</div></div>`).join('')}
      <div class="row wrap"><span class="muted small">Hintergrund</span><div class="seg" id="thSeg"><button data-v="auto" class="${th === 'auto' ? 'on' : ''}">abwechselnd</button><button data-v="dark" class="${th === 'dark' ? 'on' : ''}">dunkel</button><button data-v="light" class="${th === 'light' ? 'on' : ''}">hell</button></div></div>
      ${L.f.map(f => f === 'img' ? imgField(sl) : `<label class="field"><span>${esc(lbl(f))}</span>${f === 'text' || f === 'text2' ? `<textarea data-f="${f}" rows="${['liste', 'zwei', 'icons', 'prozess', 'zeitstrahl', 'checkliste', 'zahlen', 'balken'].includes(sl.layout) || f === 'text2' ? 5 : 3}"></textarea>` : `<input type="text" data-f="${f}">`}</label>`).join('')}
      ${iconField(sl)}
      <p class="muted small">Tipp: *Sternchen* um ein Wort färben es in der Akzentfarbe.</p>
      <div class="sl-link">${sl.a != null ? `⛓ verknüpft mit „${esc(ws.slice(0, 110))}${ws.length > 110 ? ' …' : ''}“${t ? ` · ${HOST.fmtTime(t.s)} – ${HOST.fmtTime(t.e)}` : ''} <button class="btn small ghost" id="unlink">lösen</button>${EMBED && t ? ' <button class="btn small ghost" id="jump">▶ anhören</button>' : ''}`
        : EMBED ? 'nicht mit dem Text verknüpft – unten markieren und „⛓ Nur verknüpfen“, oder im Studio mit N einsetzen' : (deck.source && deck.source.text ? 'nicht mit dem Text verknüpft' : '')}</div>`;
    box.querySelectorAll('[data-f]').forEach(i => { i.value = sl[i.dataset.f] || ''; });
    miniPrev();
    box.querySelectorAll('[data-l]').forEach(b => layoutPreview(b.dataset.l).then(u => { const im = b.querySelector('img'); if (im) im.src = u; }));
  }
  function imgField(sl){
    const pos = sl.imgPos || {x: 0.5, y: 0.5};
    return `<div class="field"><span>Bild</span><div class="row wrap"><button class="btn small" id="imgPick">${sl.img ? 'Anderes Bild …' : 'Bild wählen …'}</button>${sl.img ? '<button class="btn small ghost" id="imgDel">entfernen</button>' : ''}</div>
      ${sl.img ? `<div class="row wrap"><span class="muted small">Zuschnitt</span><div class="seg" id="imgFit"><button data-v="cover" class="${sl.imgFit !== 'contain' ? 'on' : ''}">füllen</button><button data-v="contain" class="${sl.imgFit === 'contain' ? 'on' : ''}">ganz zeigen</button></div></div>
      ${sl.imgFit !== 'contain' ? `<div class="row wrap"><span class="muted small">Ausschnitt</span><div class="seg" id="imgPosX">${[['0', 'links'], ['0.5', 'Mitte'], ['1', 'rechts']].map(([v, l]) => `<button data-v="${v}" class="${+v === pos.x ? 'on' : ''}">${l}</button>`).join('')}</div><div class="seg" id="imgPosY">${[['0', 'oben'], ['0.5', 'Mitte'], ['1', 'unten']].map(([v, l]) => `<button data-v="${v}" class="${+v === pos.y ? 'on' : ''}">${l}</button>`).join('')}</div></div>` : ''}` : ''}</div>`;
  }
  function iconField(sl){
    const L = H.layout(sl.layout), sv = k => IC.svg(k, 'currentColor', 'var(--acc)');
    if (L.icon === 'one'){
      const k = (sl.icons || [])[0], sg = IC.suggest(H.plain(sl.title + ' ' + sl.text + ' ' + sl.kicker)).filter(x => x !== k).slice(0, 8);
      return `<div class="field"><span>Symbol</span>${k ? `<div class="ic-slot"><span class="ic">${sv(k)}</span><span class="t">${esc(IC.LIB.get(k)?.label || k)}</span><button data-icdel="0" title="Symbol entfernen">✕</button></div>`
        : `<div class="ic-slot empty-slot"><span class="t">Kein Symbol – unten einen Vorschlag wählen oder im Reiter „Elemente“</span></div>`}
        ${sg.length ? `<div class="sugg">${sg.map(x => `<button data-icset="${x}" title="${esc(IC.LIB.get(x).label)}">${sv(x)}</button>`).join('')}</div>` : ''}
        <button class="btn small ghost" data-goto-lib>Alle Symbole …</button></div>`;
    }
    if (L.icon === 'lines'){
      const ls = String(sl.text || '').split('\n').map(x => x.trim()).filter(Boolean);
      return `<div class="field"><span>Symbole je Zeile${sl.layout === 'prozess' ? ' (ohne Symbol: Nummer)' : ''}</span>${ls.map((t, i) => { const k = (sl.icons || [])[i];
        return `<div class="ic-slot ${lineTarget === i ? 'target' : ''}" data-line="${i}" title="Antippen: nächstes Symbol aus „Elemente“ kommt hierhin">${k && IC.LIB.has(k) ? `<span class="ic">${sv(k)}</span>` : '<span class="ic muted" style="display:flex;align-items:center;justify-content:center">＋</span>'}<span class="t">${esc(H.plain(t))}</span>${k ? `<button data-icdel="${i}" title="entfernen">✕</button>` : ''}</div>`; }).join('') || '<p class="muted small">Erst oben Zeilen eintragen.</p>'}
        <div class="row wrap"><button class="btn small ghost" id="icAuto">✨ Symbole vorschlagen</button><button class="btn small ghost" data-goto-lib>Alle Symbole …</button></div></div>`;
    }
    return `<p class="muted small">Diese Folienart hat keinen Platz für Symbole. Mit Symbolen: Titel, Stichpunkte, Zitat, Zahl, Begriff, Kernsatz, Piktogramme, Ablauf.</p>`;
  }
  // Symbol aus der Bibliothek: wandert automatisch an die passende Stelle der Folie
  function placeIcon(k){
    const sl = cur(); if (!sl) return toast('Erst eine Folie auswählen');
    const L = H.layout(sl.layout);
    commit(() => {
      sl.icons = (sl.icons || []).slice();
      if (L.icon === 'one') sl.icons = [k];
      else if (L.icon === 'lines'){
        const ls = String(sl.text || '').split('\n').map(x => x.trim()).filter(Boolean);
        let i = lineTarget != null && lineTarget < ls.length ? lineTarget : -1;
        if (i < 0) for (let j = 0; j < ls.length; j++) if (!sl.icons[j]){ i = j; break; }
        if (i < 0){ ls.push(IC.LIB.get(k).label); i = ls.length - 1; sl.text = ls.join('\n'); }
        while (sl.icons.length < i) sl.icons.push(null);
        sl.icons[i] = k; lineTarget = null;
      } else {
        // Folienart ohne Symbol-Platz: auf die nächstverwandte Art mit Platz wechseln
        const to = {bild: 'titel', vollbild: 'titel', zwei: 'icons', zeitstrahl: 'icons', checkliste: 'liste', zahlen: 'zahl', balken: 'zahl', anteil: 'zahl', menschen: 'zahl', frage: 'aussage'}[sl.layout] || 'titel';
        if (to === 'icons'){ const ls = String(sl.text || '').split('\n').filter(x => x.trim()); if (!ls.length) sl.text = IC.LIB.get(k).label; sl.icons = [k]; }
        else sl.icons = [k];
        sl.layout = to; toast(`Folienart auf „${H.layout(to).n}“ gewechselt, damit das Symbol Platz hat`);
      }
    });
  }
  function renderLib(){
    const q = $('#icSearch').value, list = IC.search(q).filter(i => !icCat || i.cat === icCat);
    $('#icCats').innerHTML = ['', ...IC.CATS].map(c => `<button data-c="${esc(c)}" class="${c === icCat ? 'on' : ''}">${c || 'Alle'}</button>`).join('');
    const sl = cur(), L = sl && H.layout(sl.layout);
    $('#icHint').textContent = !sl ? '' : L.icon === 'one' ? 'Antippen setzt das Symbol neben den Text der Folie.' : L.icon === 'lines' ? (lineTarget != null ? `Antippen setzt das Symbol in Zeile ${lineTarget + 1}.` : 'Antippen setzt das Symbol in die nächste Zeile ohne Symbol – sonst kommt eine neue Zeile dazu.') : 'Diese Folienart hat keinen Symbol-Platz – beim Antippen wechselt sie auf eine passende Art.';
    $('#icGrid').innerHTML = list.map(i => `<button data-ic="${i.k}" title="${esc(i.label)}"><span class="svgw">${IC.svg(i.k, 'currentColor', 'var(--acc)')}</span><span>${esc(i.label)}</span></button>`).join('') || '<p class="muted small">Nichts gefunden.</p>';
  }

  // ───────── Text-Bereich: markieren und übernehmen ─────────
  function renderSrc(){
    const box = $('#srcText'), ws = words();
    $('#srcTitle').textContent = EMBED ? 'Transkript' : deck.source && deck.source.name ? deck.source.name : 'Text';
    if (!ws.length){ box.innerHTML = `<p class="src-empty">${EMBED ? 'Noch kein Transkript.' : 'Noch kein Text. „✎ Text“ fügt einen Text, ein Skript oder ein Transkript ein – dann lassen sich Stellen markieren und als Folien übernehmen.'}</p>`; paintSel(); return; }
    const mark = new Map(); deck.slides.forEach((s, k) => { if (s.a == null) return; for (let i = s.a; i <= s.b; i++) mark.set(i, k); });
    const frag = document.createDocumentFragment(); let para = -1, p = null;
    for (const t of ws){
      if (t.p !== para || !p){ para = t.p; p = document.createElement('p'); frag.append(p); }
      const k = mark.get(t.i);
      if (k != null && (t.i === deck.slides[k].a || mark.get(t.i - 1) !== k)){ const b = document.createElement('span'); b.className = 'badge' + (deck.slides[k].id === curId ? ' on' : ''); b.textContent = k + 1; b.dataset.slide = deck.slides[k].id; p.append(b); }
      const sp = document.createElement('span'); sp.className = 'w' + (t.cut ? ' cut' : '') + (k != null ? ' linked' + (deck.slides[k].id === curId ? ' cur' : '') : ''); sp.dataset.i = t.i; sp.textContent = t.w;
      p.append(sp, ' ');
    }
    box.innerHTML = ''; box.append(frag); paintSel();
  }
  function paintSel(){
    const [a, b] = sel ? [Math.min(sel.a, sel.b), Math.max(sel.a, sel.b)] : [-1, -2];
    $$('#srcText .w').forEach(sp => { const i = +sp.dataset.i; sp.classList.toggle('sel', i >= a && i <= b); });
    const t = sel ? wordsText(words(), a, b) : '';
    $('#selInfo').textContent = sel ? `„${t.slice(0, 80)}${t.length > 80 ? ' …' : ''}“` : 'Wort antippen, Umschalt+Klick oder Ziehen markiert einen Bereich';
  }
  function takeSel(to){
    if (!sel) return toast('Erst im Text Wörter markieren');
    const a = Math.min(sel.a, sel.b), b = Math.max(sel.a, sel.b), txt = wordsText(words(), a, b);
    if (to === 'new'){ const sl = H.fromText(txt, {a, b}); const sg = IC.suggest(txt); if (sg.length && H.layout(sl.layout).icon === 'one' && sl.layout !== 'zitat') sl.icons = [sg[0]];
      const at = cur() ? idx(cur()) + 1 : deck.slides.length; commit(() => deck.slides.splice(at, 0, sl)); curId = sl.id; sel = null; renderAll(); toast(`Folie ${idx(sl) + 1} erstellt`); return; }
    const sl = cur(); if (!sl) return toast('Erst eine Folie auswählen oder anlegen');
    commit(() => {
      if (to === 'title') sl.title = txt;
      else if (to === 'text') sl.text = sl.text ? sl.text + (['liste', 'icons', 'prozess', 'checkliste'].includes(sl.layout) ? '\n' : ' ') + txt : txt;
      else if (to === 'bullet'){ if (!['liste', 'zwei', 'icons', 'prozess', 'checkliste'].includes(sl.layout)) sl.layout = 'liste'; sl.text = (sl.text ? sl.text + '\n' : '') + txt; }
      if (to === 'link' || sl.a == null){ sl.a = a; sl.b = b; } else { sl.a = Math.min(sl.a, a); sl.b = Math.max(sl.b, b); }
      sl.cue = wordsText(words(), sl.a, sl.b);
    });
    sel = null; paintSel();
  }
  // Grundlage: je Satz (kurze Sätze zusammen, höchstens zwei) eine Folie, verknüpft mit genau dieser Stelle
  function suggestFromText(){
    const ws = words().filter(t => !t.cut); if (!ws.length) return toast(EMBED ? 'Erst transkribieren' : 'Erst einen Text einfügen');
    if (deck.slides.length && !confirm(`Es gibt schon ${deck.slides.length} Folien. Weitere Folien als Grundlage anlegen?`)) return;
    const sents = []; let c = null;
    for (const t of ws){ if (!c) c = {a: t.i, b: t.i, n: 0, p: t.p}; if (t.p !== c.p){ sents.push(c); c = {a: t.i, b: t.i, n: 0, p: t.p}; } c.b = t.i; c.n++; if (/[.?!…]["“”»«)]*$/.test(t.w)){ sents.push(c); c = null; } }
    if (c) sents.push(c);
    const groups = [];
    for (const x of sents){ const g = groups[groups.length - 1]; if (g && g.p === x.p && (g.n < 6 || x.n < 5) && g.k < 2 && g.n + x.n <= 26){ g.b = x.b; g.n += x.n; g.k++; } else groups.push({...x, k: 1}); }
    const made = groups.map(g => { const txt = wordsText(ws, g.a, g.b), sl = H.fromText(txt, {a: g.a, b: g.b}); const sg = IC.suggest(txt); if (sg.length && H.layout(sl.layout).icon === 'one' && sl.layout !== 'zitat') sl.icons = [sg[0]]; return sl; });
    commit(() => deck.slides.push(...made)); curId = (made[0] || {}).id || curId; renderAll();
    toast(`${made.length} Folien als Grundlage – Text kürzen, Art wählen, Symbole ergänzen`);
  }
  function editSourceText(){
    const m = modal(`<h3>Text</h3><p class="muted small">Ein fertiger Text, ein Skript oder ein Transkript. Danach lassen sich Stellen markieren und als Folien übernehmen.</p>
      <textarea id="stx" rows="14">${esc(deck.source && deck.source.text || '')}</textarea>
      <div class="acts"><button class="btn" data-x>Abbrechen</button><button class="btn primary" id="stxOk">Übernehmen</button></div>`);
    m.querySelector('#stxOk').onclick = () => { const t = m.querySelector('#stx').value; closeModal();
      commit(() => { deck.source = t.trim() ? {name: (deck.source && deck.source.name) || 'Text', text: t} : null; deck.slides.forEach(s => { s.a = s.b = null; }); linkToSource(deck); }); };
  }

  // ───────── Import ─────────
  async function importFiles(files){
    const results = [];
    for (const f of files){ try { results.push({f, r: await IO.importFile(f)}); } catch(e){ toast(`${f.name}: ${e.message}`); } }
    if (!results.length) return;
    // Ganze Präsentation (.honeydeck)
    const whole = results.find(x => x.r.kind === 'deck');
    if (whole && !deck && !EMBED){ const d = whole.r.deck; d.id = H.uid(); d.updated = Date.now(); await Store.set('deck:' + d.id, d); openDeck(d); return toast(`„${d.name}“ importiert`); }
    const slides = [], texts = []; let fmt = null;
    for (const {f, r} of results){
      if (r.kind === 'deck'){ slides.push(...r.deck.slides); fmt ||= r.deck.format; }
      if (r.kind === 'slides'){ slides.push(...r.slides); fmt ||= r.format; if (r.text) texts.push({name: f.name, text: r.text, transcript: true}); }
      if (r.kind === 'text') texts.push({name: f.name, text: r.text, transcript: r.transcript});
    }
    if (!deck && !EMBED){   // aus der Übersicht: neue Präsentation
      if (texts.length && !slides.length) return newDeckDialog({name: texts[0].name, text: texts.map(t => t.text).join('\n\n')});
      const d = H.newDeck({name: results[0].f.name.replace(/\.[^.]+$/, ''), format: fmt || '16:9', slides, source: texts.length ? {name: texts[0].name, text: texts.map(t => t.text).join('\n\n')} : null});
      if (d.source) linkToSource(d);
      await Store.set('deck:' + d.id, d); openDeck(d); return toast(`${slides.length} Folien importiert – alles bearbeitbar`);
    }
    if (texts.length && !slides.length){
      if (EMBED) return textToSlidesDialog(texts.map(t => t.text).join('\n\n'));
      const m = modal(`<h3>Text übernehmen</h3><p class="muted small">${esc(texts.map(t => t.name).join(', '))}</p>
        <div class="acts" style="justify-content:flex-start"><button class="btn" id="tSrc">Nur als Text laden (zum Markieren)</button><button class="btn" id="tSatz">Folien je Satz</button><button class="btn" id="tAbs">Folien je Absatz</button><button class="btn ghost" data-x>Abbrechen</button></div>`);
      const go = mode => { closeModal(); const t = texts.map(x => x.text).join('\n\n');
        commit(() => { deck.source = {name: texts[0].name, text: (deck.source && deck.source.text ? deck.source.text + '\n\n' : '') + t};
          if (mode){ const made = H.textToSlides(t, {mode}); deck.slides.push(...made); curId = (made[0] || {}).id || curId; }
          linkToSource(deck); }); };
      m.querySelector('#tSrc').onclick = () => go(null); m.querySelector('#tSatz').onclick = () => go('satz'); m.querySelector('#tAbs').onclick = () => go('absatz');
      return;
    }
    addSlides(slides, texts);
  }
  // Folien hinzufügen; eingebettet: Bilder an HoneyCut übergeben und Stellen im Transkript suchen
  async function addSlides(slides, texts = []){
    if (!slides.length) return;
    slides = slides.map(s => { const n = H.normSlide(clone(s)); n.id = H.uid(); delete n.media; delete n.mediaKey; delete n.rev; n.a = n.b = null; return n; });
    if (EMBED){
      for (const s of slides) if (s.img && /^data:/.test(s.img)){ try { s.img = await HOST.storeImage(s.img); } catch(e){ toast(e.message); s.img = null; } }
    } else if (texts.length && !(deck.source && deck.source.text)) deck.source = {name: texts[0].name, text: texts.map(t => t.text).join('\n\n')};
    const tmp = {slides}, n = linkToSource(tmp);
    commit(() => { deck.slides.push(...slides); }); curId = slides[0].id; renderAll();
    const ws = words();
    if (EMBED && n && confirm(`${slides.length} Folien importiert, ${n} davon an ihrer Stelle im Transkript gefunden.\n\nGleich als B-Roll an diese Stellen setzen?`)) return HOST.place($('#gapless').checked);
    toast(`${slides.length} Folien importiert${ws.length ? ` – ${n} an ihrer Stelle im Text gefunden` : ''}`);
  }
  function textToSlidesDialog(t){
    const m = modal(`<h3>Folien aus Text</h3><p class="muted small">Die Folien werden – soweit der Text im Transkript vorkommt – gleich mit ihrer Stelle verknüpft.</p>
      <textarea id="ttx" rows="10">${esc(t || '')}</textarea>
      <div class="acts"><button class="btn ghost" data-x>Abbrechen</button><button class="btn" id="ttAbs">Folien je Absatz</button><button class="btn primary" id="ttSatz">Folien je Satz</button></div>`);
    const go = mode => { const txt = m.querySelector('#ttx').value; closeModal(); addSlides(H.textToSlides(txt, {mode})); };
    m.querySelector('#ttSatz').onclick = () => go('satz'); m.querySelector('#ttAbs').onclick = () => go('absatz');
  }
  function importMenu(){
    const m = modal(`<h3>Importieren</h3>
      <p class="muted small">Folien aus PowerPoint (.pptx), HTML-Folien, Bildern oder .honeydeck werden bearbeitbar übernommen. Texte, Skripte (Word, Markdown) und Transkripte (.srt, .vtt) werden zu Folien oder zum Markieren geladen.${EMBED ? ' Importierte Folien suchen sich ihre Stelle im Transkript selbst.' : ''}</p>
      <div class="acts" style="justify-content:flex-start"><button class="btn primary" id="imFile">Datei wählen …</button><button class="btn" id="imPaste">Text einfügen …</button><button class="btn ghost" data-x>Abbrechen</button></div>
      <p class="muted small">Dateien lassen sich auch einfach ins Fenster ziehen.</p>`);
    m.querySelector('#imFile').onclick = () => { closeModal(); $('#fileIn').click(); };
    m.querySelector('#imPaste').onclick = () => { closeModal(); if (EMBED) textToSlidesDialog(''); else if (deck) editSourceText(); else newDeckDialog(); };
  }

  // ───────── Export ─────────
  function exportDialog(){
    const fl = fmtList(), sl = cur();
    const m = modal(`<h3>Exportieren</h3>
      <div class="field"><span>Formate – jede Folie wird für jedes Format neu gesetzt</span><div class="fmt-checks">${fl.map(f => `<label class="chk"><input type="checkbox" value="${f.k}" ${f.k === projFmt().k ? 'checked' : ''}> ${esc(f.n)}${f.k === 'projekt' ? ` (${f.W}×${f.H})` : ''}</label>`).join('')}</div></div>
      <div class="field"><span>Folien</span><div class="seg" id="exScope"><button data-v="all" class="on">alle ${deck.slides.length}</button>${sl ? `<button data-v="cur">nur Folie ${idx(sl) + 1}</button>` : ''}</div></div>
      ${EMBED ? '' : '<label class="chk small"><input type="checkbox" id="exSafe"> unten Platz für Untertitel lassen</label>'}
      <div class="progress hidden" id="exProg"><i></i></div>
      <div class="acts"><button class="btn ghost" data-x>Schließen</button><button class="btn" id="exHd" title="Zum Weiterbearbeiten in HoneyDeck oder HoneyCut">.honeydeck</button><button class="btn" id="exPdf">PDF</button><button class="btn primary" id="exPng">Bilder (PNG)</button></div>`);
    let scope = 'all';
    m.querySelector('#exScope').onclick = e => { const b = e.target.closest('button'); if (!b) return; scope = b.dataset.v; m.querySelectorAll('#exScope button').forEach(x => x.classList.toggle('on', x === b)); };
    const chosen = () => fl.filter(f => m.querySelector(`input[value="${f.k}"]`).checked);
    const list = () => scope === 'cur' && sl ? [sl] : deck.slides;
    const prog = v => { const p = m.querySelector('#exProg'); p.classList.remove('hidden'); p.querySelector('i').style.width = Math.round(v * 100) + '%'; };
    const sOf = f => m.querySelector('#exSafe') && m.querySelector('#exSafe').checked ? (f.H > f.W ? 0.2 : 0.17) : safe(f);
    m.querySelector('#exHd').onclick = () => { const d = clone(deck); d.slides = list().map(s => { const c = clone(s); delete c.media; delete c.mediaKey; return c; });
      if (EMBED){ d.slides.forEach(s => { if (s.img && !/^data:/.test(s.img)) s.img = null; }); d.name = HOST.name(); d.format = H.FORMATS.reduce((p, q) => Math.abs(q.W / q.H - projFmt().W / projFmt().H) < Math.abs(p.W / p.H - projFmt().W / projFmt().H) ? q : p).k; d.id = H.uid(); d.app = 'honeydeck'; d.v = 1; }
      saveBlob(new Blob([JSON.stringify(d)], {type: 'application/json'}), safeName(deck.name || (EMBED && HOST.name())) + '.honeydeck'); };
    m.querySelector('#exPng').onclick = async () => {
      const fs = chosen(); if (!fs.length) return toast('Mindestens ein Format wählen');
      const ss = list(), files = []; let n = 0;
      for (const f of fs) for (const s of ss){
        const cv = await H.render(s, f.W, f.H, renderOpts(s, f, {safe: sOf(f)}));
        const name = (fs.length > 1 ? (f.k === 'projekt' ? 'projekt' : f.k.replace(':', 'x')) + '/' : '') + `folie-${String(idx(s) + 1).padStart(2, '0')}.png`;
        files.push({name, data: await IO.canvasBytes(cv)}); prog(++n / (fs.length * ss.length));
      }
      const base = safeName(deck.name || (EMBED && HOST.name()));
      if (files.length === 1) await saveBlob(new Blob([files[0].data], {type: 'image/png'}), `${base}-${files[0].name.split('/').pop()}`);
      else await saveBlob(IO.zip(files), base + '-folien.zip');
      toast(files.length === 1 ? 'Folie gespeichert' : `${files.length} Bilder als ZIP gespeichert`);
    };
    m.querySelector('#exPdf').onclick = async () => {
      const fs = chosen(); if (!fs.length) return toast('Ein Format wählen'); const f = fs[0], ss = list(), pages = []; let n = 0;
      for (const s of ss){ const cv = await H.render(s, f.W, f.H, renderOpts(s, f, {safe: sOf(f)})); pages.push({jpeg: await IO.canvasBytes(cv, 'image/jpeg', 0.92), w: f.W, h: f.H}); prog(++n / ss.length); }
      const k = 960 / Math.max(f.W, f.H);
      await saveBlob(IO.pdf(pages, Math.round(f.W * k), Math.round(f.H * k)), safeName(deck.name || (EMBED && HOST.name())) + (fs.length > 1 ? `-${f.k.replace(':', 'x')}` : '') + '.pdf');
      toast('PDF gespeichert' + (fs.length > 1 ? ` (Format ${f.n} – PDF hat ein Format je Datei)` : ''));
    };
  }

  // ───────── Designprofil-Editor ─────────
  function editProfile(base, isNew){
    const pr = clone(base);
    if (isNew){ pr.id = 'p' + H.uid(); pr.name = base.name + ' – eigene Variante'; pr.builtin = false; }
    const fsel = r => `<select data-font="${r}">${H.FONT_CHOICES.map(o => `<option value="${esc(o.v)}">${esc(o.l)}</option>`).join('')}</select>`;
    const col = (t, k, l) => `<label><input type="color" data-col="${t}.${k}"> ${l}</label>`;
    const seg = (k, vals) => `<div class="seg" data-seg="${k}">${vals.map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('')}</div>`;
    const m = modal(`<h3>${isNew ? 'Neues Designprofil' : 'Designprofil bearbeiten'}</h3>
      <div class="pe"><canvas id="peCv"></canvas>
        <div class="full seg" id="peSample"><button data-v="d" class="on">dunkle Folie</button><button data-v="l">helle Folie</button><button data-v="cur">aktuelle Folie</button></div>
        <label class="field full"><span>Name</span><input id="peName"></label>
        <div class="field"><span>Farben dunkler Folien</span><div class="colors">${col('dark', 'bg', 'Grund')}${col('dark', 'fg', 'Schrift')}${col('dark', 'mute', 'Neben')}${col('dark', 'acc', 'Akzent')}</div></div>
        <div class="field"><span>Farben heller Folien</span><div class="colors">${col('light', 'bg', 'Grund')}${col('light', 'fg', 'Schrift')}${col('light', 'mute', 'Neben')}${col('light', 'acc', 'Akzent')}</div></div>
        <label class="field"><span>Überschriften</span>${fsel('head')}</label><label class="field"><span>Fließtext</span>${fsel('body')}</label>
        <label class="field"><span>Zitate und Begriffe</span>${fsel('serif')}</label>
        <label class="field"><span>Kennung unten rechts (optional, z. B. @kanal)</span><input id="peHandle" placeholder="leer = keine"></label>
        <div class="field"><span>Größe Überschriften <b id="peTsV"></b></span><input type="range" id="peTs" min="70" max="140" step="5"></div>
        <div class="field"><span>Größe Fließtext <b id="peXsV"></b></span><input type="range" id="peXs" min="70" max="140" step="5"></div>
        <div class="field"><span>Ausrichtung</span>${seg('align', [['left', 'linksbündig'], ['center', 'mittig']])}</div>
        <div class="field"><span>Rand</span>${seg('pad', [['eng', 'schmal'], ['normal', 'normal'], ['weit', 'breit']])}</div>
        <div class="field"><span>Hintergrund</span>${seg('theme', [['wechselnd', 'abwechselnd'], ['dunkel', 'dunkel'], ['hell', 'hell']])}</div>
        <div class="field"><label class="chk small"><input type="checkbox" id="peBar"> Akzentstrich über der Rubrik</label><label class="chk small"><input type="checkbox" id="peSrc"> Quelle rechts unten</label></div>
      </div>
      <div class="acts">${!isNew && !base.builtin ? '<button class="btn ghost" id="peDel">Profil löschen</button>' : ''}<span class="grow"></span><button class="btn" data-x>Abbrechen</button><button class="btn primary" id="peSave">${base.builtin && !isNew ? 'Als eigenes Profil speichern' : 'Speichern und verwenden'}</button></div>`, 'wide');
    const q = s => m.querySelector(s);
    let sample = 'd', tm = 0;
    const draw = () => { clearTimeout(tm); tm = setTimeout(async () => {
      const sl = sample === 'cur' && cur() ? cur() : H.newSlide({...SAMPLES.titel, icons: ['megafon'], source: 'Beispielquelle', dark: sample === 'd'});
      const f = projFmt(), cv = q('#peCv'), w = 720, h = Math.round(w * f.H / f.W); if (!cv) return;
      const r = await H.render(sl, w * 2, h * 2, {k: sample === 'cur' && cur() ? idx(cur()) : 0, profile: pr, imgUrl}); cv.width = w * 2; cv.height = h * 2; cv.getContext('2d').drawImage(r, 0, 0); }, 60); };
    q('#peName').value = pr.name; q('#peHandle').value = pr.handle || '';
    q('#peHandle').oninput = e => { pr.handle = e.target.value.trim(); draw(); };
    m.querySelectorAll('[data-col]').forEach(i => { const [t, k] = i.dataset.col.split('.'); i.value = pr.colors[t][k]; i.oninput = () => { pr.colors[t][k] = i.value; draw(); }; });
    m.querySelectorAll('[data-font]').forEach(s => { const r = s.dataset.font; if (![...s.options].some(o => o.value === pr.fonts[r])) s.append(new Option(pr.fonts[r], pr.fonts[r])); s.value = pr.fonts[r]; s.onchange = () => { pr.fonts[r] = s.value; draw(); }; });
    const segs = () => m.querySelectorAll('[data-seg]').forEach(g => g.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === pr[g.dataset.seg])));
    m.querySelectorAll('[data-seg]').forEach(g => g.onclick = e => { const b = e.target.closest('button'); if (!b) return; pr[g.dataset.seg] = b.dataset.v; segs(); draw(); });
    segs();
    const rng = (id, k) => { const i = q(id), v = q(id + 'V'); i.value = Math.round((pr[k] || 1) * 100); v.textContent = i.value + ' %'; i.oninput = () => { pr[k] = i.value / 100; v.textContent = i.value + ' %'; draw(); }; };
    rng('#peTs', 'titleScale'); rng('#peXs', 'textScale');
    q('#peBar').checked = pr.bar !== false; q('#peBar').onchange = e => { pr.bar = e.target.checked; draw(); };
    q('#peSrc').checked = !!pr.sourceRight; q('#peSrc').onchange = e => { pr.sourceRight = e.target.checked; draw(); };
    q('#peSample').onclick = e => { const b = e.target.closest('button'); if (!b) return; sample = b.dataset.v; q('#peSample').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); draw(); };
    if (q('#peDel')) q('#peDel').onclick = async () => { if (!confirm(`Profil „${base.name}“ löschen? Präsentationen, die es verwenden, behalten ihre Kopie.`)) return;
      userProfs = userProfs.filter(x => x.id !== base.id); await saveProfiles(); closeModal(); renderAll(); };
    q('#peSave').onclick = async () => {
      pr.name = q('#peName').value.trim() || 'Eigenes Profil';
      if (pr.builtin){ pr.id = 'p' + H.uid(); pr.builtin = false; if (pr.name === base.name) pr.name += ' – eigene Variante'; }
      const i = userProfs.findIndex(x => x.id === pr.id); if (i >= 0) userProfs[i] = pr; else userProfs.push(pr); await saveProfiles();
      closeModal(); useProfile(pr); toast(`Designprofil „${pr.name}“ gespeichert`);
    };
    draw();
  }
  function useProfile(pr){ layThumbs.clear(); commit(() => { deck.profile = clone(pr); }); }

  // ───────── Dialoge ─────────
  function modal(html, cls = ''){
    closeModal();
    const m = document.createElement('div'); m.className = 'modal'; m.id = 'modal';
    m.innerHTML = `<div class="card ${cls}">${html}</div>`;
    m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-x]')) closeModal(); });
    document.body.append(m); const f = m.querySelector('input,textarea'); if (f && innerWidth > 900) f.focus();
    return m;
  }
  function closeModal(){ const m = $('#modal'); if (m) m.remove(); }

  // ───────── Ereignisse ─────────
  $('#homeNew').onclick = () => newDeckDialog();
  $('#homeImport').onclick = () => $('#fileIn').click();
  $('#edBack').onclick = async () => { if (EMBED) return; clearTimeout(saveT); await saveNow(); showHome(); };
  $('#edName').onchange = e => { if (EMBED) return; commit(() => { deck.name = e.target.value.trim() || 'Präsentation'; }, {render: false}); };
  $('#edFmt').onchange = e => { viewFmt = null; layThumbs.clear(); commit(() => { deck.format = e.target.value; }); };
  $('#edProf').onchange = e => { const pr = allProfiles().find(x => x.id === e.target.value); if (pr){ useProfile(pr); toast(`Designprofil „${pr.name}“`); } };
  $('#profEdit').onclick = () => editProfile(profile(), false);
  $('#profNew').onclick = () => editProfile(profile(), true);
  $('#undoBtn').onclick = doUndo; $('#redoBtn').onclick = doRedo;
  $('#edImport').onclick = importMenu;
  $('#edExport').onclick = () => deck.slides.length ? exportDialog() : toast('Noch keine Folien');
  $('#placeBtn').onclick = () => HOST.place($('#gapless').checked);
  $('#subSafe').onchange = e => { HOST.setSubSafe(e.target.checked); thumbs.clear(); renderAll(); };
  $('#slAdd').onclick = () => { const sl = H.newSlide(); const at = cur() ? idx(cur()) + 1 : deck.slides.length; commit(() => deck.slides.splice(at, 0, sl)); curId = sl.id; renderAll(); };
  $('#fileIn').onchange = e => { const fs = [...e.target.files]; e.target.value = ''; if (fs.length) importFiles(fs); };
  $('#imgIn').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; const sl = cur(); if (!f || !sl) return;
    try { const url = await IO.shrinkImage(await IO.readAs(f, 'readAsDataURL')); commit(() => { sl.img = url; }); } catch(err){ toast(err.message); } };
  $('#srcSuggest').onclick = suggestFromText;
  $('#srcEdit').onclick = editSourceText;
  $$('[data-to]').forEach(b => b.onclick = () => takeSel(b.dataset.to));
  $('#inspTabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; inspTab = b.dataset.t; renderInsp(); };
  $('#icSearch').oninput = renderLib;
  $('#icCats').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; icCat = b.dataset.c; renderLib(); };
  $('#icGrid').onclick = e => { const b = e.target.closest('[data-ic]'); if (b) placeIcon(b.dataset.ic); };
  $('#mobTabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; mobPane(b.dataset.p); };
  function mobPane(p){ if (p === 'paneList' && innerWidth > 600 && innerWidth <= 900) p = 'paneStage'; $$('#mobTabs button').forEach(x => x.classList.toggle('on', x.dataset.p === p)); $$('.ed-body>.pane').forEach(x => x.classList.toggle('mob-on', x.id === p)); if (p === 'paneStage') renderStage(); }
  mobPane('paneStage');

  // Folienliste: auswählen, Aktionen, ziehen zum Umsortieren
  $('#slList').addEventListener('click', e => {
    const it = e.target.closest('.sl-item'); if (!it) return;
    const sl = deck.slides.find(s => s.id === it.dataset.id), act = e.target.closest('[data-a]');
    if (!act){ curId = sl.id; lineTarget = null; renderAll(); if (innerWidth <= 900) mobPane('paneStage'); return; }
    const k = idx(sl), a = act.dataset.a;
    commit(() => {
      if (a === 'up' && k > 0) deck.slides.splice(k - 1, 0, deck.slides.splice(k, 1)[0]);
      if (a === 'down' && k < deck.slides.length - 1) deck.slides.splice(k + 1, 0, deck.slides.splice(k, 1)[0]);
      if (a === 'dup'){ const c = {...clone(sl), id: H.uid(), a: null, b: null}; delete c.media; delete c.mediaKey; deck.slides.splice(k + 1, 0, c); curId = c.id; }
      if (a === 'del'){ deck.slides.splice(k, 1); if (curId === sl.id) curId = (deck.slides[Math.min(k, deck.slides.length - 1)] || {}).id || null; }
    });
  });
  let dragId = null;
  $('#slList').addEventListener('dragstart', e => { const it = e.target.closest('.sl-item'); if (!it) return; dragId = it.dataset.id; it.classList.add('drag'); e.dataTransfer.effectAllowed = 'move'; });
  $('#slList').addEventListener('dragover', e => { if (!dragId) return; e.preventDefault(); $$('.sl-item.over').forEach(x => x.classList.remove('over')); const it = e.target.closest('.sl-item'); if (it) it.classList.add('over'); });
  $('#slList').addEventListener('drop', e => { if (!dragId) return; e.preventDefault(); const it = e.target.closest('.sl-item'); const from = deck.slides.findIndex(s => s.id === dragId);
    let to = it ? deck.slides.findIndex(s => s.id === it.dataset.id) : deck.slides.length - 1; dragId = null;
    if (from >= 0 && to >= 0 && from !== to) commit(() => { const [s] = deck.slides.splice(from, 1); deck.slides.splice(to, 0, s); }); else renderList(); });
  $('#slList').addEventListener('dragend', () => { dragId = null; $$('.sl-item').forEach(x => x.classList.remove('drag', 'over')); });

  // Formatleiste
  $('#fmtStrip').onclick = e => { const b = e.target.closest('[data-f]'); if (!b) return; const f = fmtList().find(x => x.k === b.dataset.f); viewFmt = f && f.k !== projFmt().k ? f : null; renderStage(); };

  // Bearbeiten-Felder
  let typingT = 0, typingSnap = null;
  $('#inspFolie').addEventListener('focusin', e => { if (e.target.dataset.f && !EMBED) typingSnap = JSON.stringify(deck); });
  $('#inspFolie').addEventListener('input', e => {
    const f = e.target.dataset.f, sl = cur(); if (!f || !sl) return;
    sl[f] = e.target.value;
    clearTimeout(typingT); typingT = setTimeout(() => { renderStage(); miniPrev(); const it = $(`.sl-item[data-id="${sl.id}"] img`); if (it) thumb(sl, projFmt(), 160).then(u => it.src = u);
      if (EMBED) pushHost(); else { deck.updated = Date.now(); scheduleSave(); } }, 180);
  });
  $('#inspFolie').addEventListener('focusout', e => {
    if (!e.target.dataset.f) return;
    if (!EMBED && typingSnap && typingSnap !== JSON.stringify(deck)){ undo.push(typingSnap); redo = []; } typingSnap = null;
    const sl = cur(); if (sl && ['icons', 'prozess'].includes(sl.layout) || (sl && H.layout(sl.layout).icon === 'one')) setTimeout(() => { if (!document.activeElement || !document.activeElement.dataset || !document.activeElement.dataset.f) renderInsp(); }, 120);
    renderList();
  });
  $('#inspFolie').addEventListener('click', e => {
    const sl = cur(); if (!sl) return;
    const l = e.target.closest('[data-l]'); if (l){ commit(() => { sl.layout = l.dataset.l; }); return; }
    const th = e.target.closest('#thSeg button'); if (th){ commit(() => { sl.dark = th.dataset.v === 'auto' ? null : th.dataset.v === 'dark'; }); layThumbs.clear(); return; }
    const set = e.target.closest('[data-icset]'); if (set){ commit(() => { sl.icons = [set.dataset.icset]; }); return; }
    const del = e.target.closest('[data-icdel]'); if (del){ e.stopPropagation(); commit(() => { sl.icons = (sl.icons || []).slice(); sl.icons[+del.dataset.icdel] = null; while (sl.icons.length && !sl.icons[sl.icons.length - 1]) sl.icons.pop(); }); return; }
    const line = e.target.closest('[data-line]'); if (line){ lineTarget = +line.dataset.line; inspTab = 'elemente'; renderInsp(); if (innerWidth <= 900) mobPane('paneInsp'); return; }
    if (e.target.closest('[data-goto-lib]')){ inspTab = 'elemente'; renderInsp(); return; }
    if (e.target.id === 'icAuto'){ const ls = String(sl.text || '').split('\n').map(x => x.trim()).filter(Boolean);
      commit(() => { sl.icons = ls.map((t, i) => (sl.icons || [])[i] || IC.suggest(t)[0] || null); }); if (!ls.length) toast('Erst Zeilen eintragen'); return; }
    if (e.target.id === 'imgPick'){ if (EMBED) HOST.pickImage().then(uri => { if (uri) commit(() => { sl.img = uri; }); }); else $('#imgIn').click(); return; }
    if (e.target.id === 'imgDel'){ commit(() => { sl.img = null; }); return; }
    const fit = e.target.closest('#imgFit button'); if (fit){ commit(() => { sl.imgFit = fit.dataset.v; }); return; }
    const px = e.target.closest('#imgPosX button'), py = e.target.closest('#imgPosY button');
    if (px || py){ commit(() => { const p = {...(sl.imgPos || {x: 0.5, y: 0.5})}; if (px) p.x = +px.dataset.v; if (py) p.y = +py.dataset.v; sl.imgPos = p; }); return; }
    if (e.target.id === 'unlink'){ commit(() => { sl.a = sl.b = null; }); return; }
    if (e.target.id === 'jump') HOST.jump(sl);
  });

  // Text markieren
  (() => {
    const box = $('#srcText'); let drag = false;
    box.addEventListener('pointerdown', e => {
      const b = e.target.closest('.badge'); if (b){ curId = b.dataset.slide; renderAll(); return; }
      const sp = e.target.closest('.w'); if (!sp) return; const i = +sp.dataset.i;
      if (e.shiftKey && sel) sel.b = i; else if (sel && sel.a === sel.b && e.pointerType === 'touch' && i !== sel.a) sel.b = i; else sel = {a: i, b: i};
      drag = true; paintSel(); if (e.pointerType !== 'touch') e.preventDefault();
    });
    box.addEventListener('pointerover', e => { if (!drag || e.pointerType === 'touch') return; const sp = e.target.closest('.w'); if (!sp) return; sel.b = +sp.dataset.i; paintSel(); });
    window.addEventListener('pointerup', () => { drag = false; });
    box.addEventListener('dblclick', e => { const sp = e.target.closest('.w'); if (sp && EMBED) HOST.seekWord(+sp.dataset.i); });
  })();

  // Dateien ins Fenster ziehen
  let dropHint = null;
  window.addEventListener('dragover', e => { if (dragId || !e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return; e.preventDefault(); if (!dropHint){ dropHint = document.createElement('div'); dropHint.className = 'drop-hint'; dropHint.textContent = 'Loslassen zum Importieren'; document.body.append(dropHint); } });
  window.addEventListener('dragleave', e => { if (e.relatedTarget == null && dropHint){ dropHint.remove(); dropHint = null; } });
  window.addEventListener('drop', e => { if (dragId) return; if (dropHint){ dropHint.remove(); dropHint = null; } if (!e.dataTransfer || !e.dataTransfer.files.length) return; e.preventDefault(); importFiles([...e.dataTransfer.files]); });

  // Tastatur
  document.addEventListener('keydown', e => {
    const tag = document.activeElement && document.activeElement.tagName, typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !typing){ e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (mod && e.key.toLowerCase() === 'y' && !typing){ e.preventDefault(); doRedo(); return; }
    if (e.key === 'Escape'){ if ($('#modal')) closeModal(); else if (sel){ sel = null; paintSel(); } return; }
    if (typing || !deck || $('#modal')) return;
    const k = cur() ? idx(cur()) : -1;
    if ((e.key === 'ArrowDown' || e.key === 'ArrowRight') && k < deck.slides.length - 1){ e.preventDefault(); curId = deck.slides[k + 1].id; renderAll(); }
    if ((e.key === 'ArrowUp' || e.key === 'ArrowLeft') && k > 0){ e.preventDefault(); curId = deck.slides[k - 1].id; renderAll(); }
    if ((e.key === 'Delete' || e.key === 'Backspace') && cur() && !sel){ e.preventDefault(); const sl = cur(); commit(() => { deck.slides.splice(k, 1); curId = (deck.slides[Math.min(k, deck.slides.length - 1)] || {}).id || null; }); void sl; }
    if (e.key === 'Enter' && sel){ e.preventDefault(); takeSel('new'); }
  });
  let rsT = 0; window.addEventListener('resize', () => { clearTimeout(rsT); rsT = setTimeout(() => { if (deck){ $('#edBody').classList.toggle('no-src', !EMBED && !(deck.source && deck.source.text) && innerWidth > 900); renderStage(); } }, 120); });

  // ───────── Start ─────────
  // Eingebettet: HoneyCut ruft HD.reload() nach Rückgängig, Profilwechsel oder Änderungen im Studio
  function loadFromHost(){
    const st = HOST.state();
    const prevCur = curId;
    deck = H.normDeck({app: 'honeydeck', id: 'embed', name: st.name, format: '16:9', profile: st.profile || clone(H.BUILTIN[0]), slides: st.slides || []});
    deck.slides.forEach((s, i) => { const o = (st.slides || [])[i]; if (o) s.id = o.id; });
    curId = deck.slides.some(s => s.id === prevCur) ? prevCur : (deck.slides[0] || {}).id || null;
    thumbs.clear(); layThumbs.clear();
  }
  // Für die Plattform-Hüllen: Zurück-Taste (Android), übergebene Dateien und Texte
  const b64File = (name, b64) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new File([u], name); };
  window.HDBack = () => { if ($('#modal')){ closeModal(); return true; } if (deck && !EMBED){ $('#edBack').click(); return true; } return false; };
  window.HDImportB64 = (name, b64) => { importFiles([b64File(name, b64)]); return true; };
  window.HDImportText = text => { if (deck && !EMBED) commit(() => { deck.source = {name: 'Geteilter Text', text: ((deck.source && deck.source.text) ? deck.source.text + '\n\n' : '') + text}; linkToSource(deck); }); else newDeckDialog({name: 'Geteilter Text', text}); return true; };
  window.HD = {
    reload(){ if (!EMBED) return; loadFromHost(); renderAll(); },
    select(id){ curId = id; renderAll(); },
    importFiles, addSlides, get deck(){ return deck; },
  };
  (async () => {
    await loadProfiles();
    if (EMBED){
      loadFromHost();
      $('#ed').classList.remove('hidden');
      if (!deck.slides.length && HOST.firstRun && HOST.firstRun()) chooseProfileFirst();
      renderAll();
      HOST.ready && HOST.ready(window.HD);
    } else {
      const m = location.hash.match(/deck=([\w-]+)/), d = m ? await Store.get('deck:' + m[1]) : null;
      if (d) openDeck(d); else await showHome();
      const o = location.hash.match(/open=([\w=-]+)/);
      if (o && Store.desktop){ try { const f = await window.pywebview.api.open_file(o[1]); if (f) importFiles([b64File(f.name, f.data)]); } catch(e){ toast(e.message); } }
    }
  })();
  // Beim ersten Öffnen ohne Profil: Design wählen (wie bisher in HoneyCut)
  function chooseProfileFirst(){
    const list = allProfiles(), f = projFmt();
    const m = modal(`<h3>Welches Design sollen die Folien haben?</h3><p class="muted small">Das lässt sich jederzeit oben unter „Design“ ändern. Eigene Profile legst du dort mit „＋“ an.</p>
      <div class="prof-grid">${list.map(p => `<button data-p="${esc(p.id)}"><canvas></canvas><b>${esc(p.name)}</b></button>`).join('')}</div>`, 'wide');
    m.querySelectorAll('[data-p]').forEach(b => { const pr = list.find(x => x.id === b.dataset.p), cv = b.querySelector('canvas'), w = 400, h = Math.round(w * f.H / f.W);
      H.render(H.newSlide({...SAMPLES.titel, dark: true}), w, h, {profile: pr}).then(r => { cv.width = w; cv.height = h; cv.getContext('2d').drawImage(r, 0, 0); });
      b.onclick = () => { closeModal(); useProfile(pr); toast(`Designprofil „${pr.name}“`); }; });
  }
})();
