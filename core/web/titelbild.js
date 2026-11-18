'use strict';
/* HoneyCut – Titelbild mit Vorlage: die abgespeckte Fassung von HoneyThumb.
   Das Bild an der Abspiellinie kommt in eine Vorlage aus HoneyThumb (thumb-engine.js, dort gepflegt und hierher kopiert):
   die Person wird freigestellt (thumb-cut.js), der Hintergrund kommt aus der Vorlage oder ist ein eigener, dazu Titel und Rubrik.
   Wer mehr will (Ebenen, Formen, Maske nachbessern), sichert das Ergebnis als .honeythumb und öffnet es in HoneyThumb.
   Markenunterlagen aus HoneyThumb (Datei „Markenunterlagen-….json“) bringen Auflagen (etwa ein Banner, das immer obenauf liegt),
   die Akzentfarbe und die Schriften der Marke mit; sie liegen im Gerät (IndexedDB „honeycut-marke“).
   „Als erstes Bild ins Video“ legt das fertige Titelbild als Bild über allem auf das erste Bild des Exports (coverFirstPlan). */
(function(){
  const H = window.HoneyThumb, CUT = window.HoneyThumbCut; if (!H || !CUT) return;
  const DEF = {tpl: 'rechts', fmt: '', acc: 'rot', title: '', kicker: '', sub: '', cut: true, size: 1, shift: 0, bg: 'tpl', bgc: '#131312', ov: true};
  let st = null;   // {frame, pos, cut: {img, mask} | null, cutFor, bgUrl}
  const opts = () => { const o = {...DEF, ...((P.settings && P.settings.coverTpl) || {})}; if (!H.template(o.tpl)) o.tpl = DEF.tpl; if (!o.fmt){ const [w, h] = baseDims(); o.fmt = h > w ? '9:16' : '16:9'; } o.fmt = H.format(o.fmt).k; o.acc = H.accent(o.acc).k; return o; };
  const safe = s => String(s || 'Video').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80);

  // ───────── Markenunterlagen aus HoneyThumb ─────────
  let brand = null, brandP = null;   // {name, accentKey, fonts: {title, small}, overlays: [{id, name, img, formats, auto, band, ar}], fontFiles: [{id, name, url}]}
  const idb = () => new Promise((res, rej) => { const r = indexedDB.open('honeycut-marke', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const kv = async (mode, fn) => { const d = await idb(); return new Promise((res, rej) => { const t = d.transaction('kv', mode), q = fn(t.objectStore('kv')); t.oncomplete = () => res(q && q.result); t.onerror = () => rej(t.error); }); };
  async function brandUse(b){ brand = b; if (!b) return; for (const o of b.overlays) await H.decode(o.img).catch(() => null); for (const f of b.fontFiles) await H.addFont('u:' + f.id, f.name, f.url).catch(() => null); }
  function brandReady(){ return brandP ||= (async () => { try { await brandUse(await kv('readonly', s => s.get('marke')) || null); } catch(_){ brand = null; } })(); }
  // Datei lesen: nur Bilder und Schriften als data-URL, bekannte Formate, begrenzte Längen
  async function brandRead(text){
    const raw = JSON.parse(text); if (!raw || raw.app !== 'honeythumb-marke' || !raw.brand || !Array.isArray(raw.items)) throw new Error('Das ist keine Datei mit Markenunterlagen aus HoneyThumb.');
    const ID = /^[\w-]{1,40}$/, IMG = /^data:image\/(png|jpeg|webp|gif);base64,/, str = (v, d) => String(v || d).slice(0, 60), fk = v => typeof v === 'string' && /^u:[\w-]{1,40}$/.test(v) ? v : null, rf = raw.brand.fonts || {};
    const b = {name: str(raw.brand.name, 'Marke'), accentKey: H.accent(raw.brand.accentKey).k, fonts: {title: fk(rf.title), small: fk(rf.small)}, overlays: [], fontFiles: []};
    for (const r of raw.items.slice(0, 500)){ if (!r || typeof r.id !== 'string' || !ID.test(r.id)) continue;
      if (r.kind === 'overlay' && typeof r.img === 'string' && IMG.test(r.img) && b.overlays.length < 12){ const im = await H.decode(r.img).catch(() => null); if (!im) continue;
        b.overlays.push({id: r.id, name: str(r.name, 'Auflage'), img: r.img, formats: (Array.isArray(r.formats) ? r.formats : []).filter(f => H.FORMATS.some(x => x.k === f)), auto: r.auto !== false, band: H.bandOf(im), ar: im.naturalWidth / im.naturalHeight}); }
      else if (r.kind === 'font' && typeof r.url === 'string' && H.FONT_URL.test(r.url) && b.fontFiles.length < 8) b.fontFiles.push({id: r.id, name: str(r.name, 'Schrift'), url: r.url}); }
    return b;
  }
  async function brandSet(b){ await kv('readwrite', s => b ? s.put(b, 'marke') : s.delete('marke')); await brandUse(b); }
  // Auflagen der Marke, die für dieses Format gelten und „immer dabei“ sind
  const tops = (fmt, assets) => !brand ? [] : brand.overlays.filter(o => o.auto && o.formats.includes(fmt) && H.imgOf({assets: {x: o.img}}, 'x')).map(o => { assets['ov-' + o.id] = o.img; return H.overlayLayer(fmt, 'ov-' + o.id, {lib: o.id, name: o.name, fmts: o.formats.slice(), band: o.band, ar: o.ar}); });

  // Das Bild an der Abspiellinie, wie die Bühne es zeigt (ohne Schrift), längste Seite höchstens 1600
  async function grab(){
    const [bw, bh] = baseDims(), k = Math.min(1, 1600 / Math.max(bw, bh)), cv = document.createElement('canvas'); cv.width = Math.round(bw * k / 2) * 2; cv.height = Math.round(bh * k / 2) * 2;
    await coverRender(cv, {text: '', titles: false, subs: false});
    return cv.toDataURL('image/jpeg', 0.92);
  }
  // Titelbild aus den Angaben bauen
  function build(o){
    const assets = {f1: st.frame}, c = {};
    for (const k of ['title', 'kicker', 'sub']) if (String(o[k] || '').trim()) c[k] = o[k];
    if (o.cut && st.cut){ assets.c1 = st.cut.img; assets.c2 = st.cut.mask; c.person = {img: 'c1', mask: 'c2', src: 'f1'}; } else c.person = {img: 'f1', mask: null};
    const d = H.fromTemplate(o.tpl, o.fmt, c, {accentKey: o.acc, assets, name: P.name || 'Titelbild', extra: o.ov === false ? [] : tops(o.fmt, assets), fonts: brand ? brand.fonts : null}), F = H.format(d.format), p = d.layers.find(L => L.slot === 'person'), b = d.layers[0];
    if (p){ const cx = p.x + p.w / 2, bottom = p.y + p.h, s = clamp(+o.size || 1, 0.5, 1.6); p.w *= s; p.h *= s; p.x = cx - p.w / 2 + clamp(+o.shift || 0, -0.5, 0.5) * F.w; p.y = bottom - p.h; }
    if (o.bg === 'blur') b.fill = {kind: 'img', img: 'f1', blur: 18, dim: 0.35, vig: 0.3};
    else if (o.bg === 'img' && st.bgUrl){ d.assets.b1 = st.bgUrl; b.fill = {kind: 'img', img: 'b1', vig: 0.2}; }
    else if (o.bg === 'color') b.fill = {kind: 'color', a: /^#[0-9a-f]{6}$/i.test(o.bgc) ? o.bgc : '#131312'};
    if (o.bg !== 'tpl'){ delete b.slot; delete b.auto; }
    return d;
  }

  async function openCoverTpl(){
    if (!P || !timeline.length) return; if (playing) pausePlay();
    const body = $('#sheetBody'), o0 = opts();
    body.innerHTML = `<h3>Titelbild mit Vorlage</h3>
      <canvas id="ctPrev" class="cover-prev ct-prev"></canvas>
      <div class="ct-tpls" id="ctTpls"></div>
      <div class="grid2">
        <label>Format <select id="ctFmt">${H.FORMATS.map(f => `<option value="${f.k}">${esc(f.n)} – ${esc(f.hint)}</option>`).join('')}</select></label>
        <label>Akzentfarbe <select id="ctAcc">${H.ACCENTS.map(a => `<option value="${a.k}">${esc(a.n)}</option>`).join('')}</select></label>
      </div>
      <label class="field"><span>Titel – *so* färbt Wörter in der Akzentfarbe</span><textarea id="ctTitle" rows="2" dir="auto" maxlength="200" placeholder="z. B. Wer hat das *wirklich* gesagt?"></textarea></label>
      <div class="grid2">
        <label>Rubrik <input type="text" id="ctKicker" maxlength="80" placeholder="z. B. Analyse"></label>
        <label id="ctSubL">Unterzeile <input type="text" id="ctSub" maxlength="120"></label>
      </div>
      <label class="row" style="margin-top:10px"><input type="checkbox" id="ctCut"> Person freistellen</label>
      <div class="grid2" id="ctPersonRow">
        <label>Person: Größe <input type="range" id="ctSize" min="0.6" max="1.5" step="0.01"></label>
        <label>Person: nach links / rechts <input type="range" id="ctShift" min="-0.3" max="0.3" step="0.005"></label>
      </div>
      <div class="grid2">
        <label>Hintergrund <select id="ctBg"><option value="tpl">wie in der Vorlage</option><option value="blur">Videobild, weichgezeichnet</option><option value="img">eigenes Bild</option><option value="color">Farbe</option></select></label>
        <label id="ctBgcL">Farbe <input type="color" id="ctBgc"></label>
        <label id="ctBgImgL" class="btn small" style="align-self:end">Bild wählen …<input type="file" id="ctBgFile" accept="image/*" hidden></label>
      </div>
      <div class="row wrap" style="margin-top:10px"><span class="muted small" id="ctBrand" style="flex:1;min-width:140px"></span><label class="row" id="ctOvL"><input type="checkbox" id="ctOv"> Auflage der Marke</label><label class="btn small">Markenunterlagen laden …<input type="file" id="ctBrandFile" accept=".json,application/json" hidden></label><button class="btn small" id="ctBrandOff">Entfernen</button></div>
      <label class="row" id="ctFirstL" style="margin-top:10px" title="Das Titelbild liegt im exportierten Video auf dem ersten Bild – über allem, nur ein Bild lang. Der Ton läuft von Anfang an. So lässt es sich auf jeder Plattform als Titelbild wählen, ohne es eigens hochzuladen."><input type="checkbox" id="ctFirst"> Als erstes Bild ins Video legen (nur ein Bild lang, der Ton läuft normal)</label>
      <div class="grid2">
        <label>Dateiart <select id="ctType"><option value="jpg">JPG (klein, für YouTube)</option><option value="png">PNG (verlustfrei)</option></select></label>
        <label>Größe <select id="ctOut"></select></label>
      </div>
      <p class="muted small">Für ein anderes Bild die Abspiellinie verschieben und „Bild neu holen“ wählen. Mehr Möglichkeiten (Ebenen, Formen, Maske nachbessern) gibt es in HoneyThumb: „Für HoneyThumb sichern“ legt eine Datei ab, die sich dort öffnen lässt.</p>
      <div class="row wrap" style="margin-top:12px"><span class="muted small" id="ctMsg" style="flex:1;min-width:120px"></span><button class="btn small" id="ctGrab">Bild neu holen</button><button class="btn small" id="ctFile">Für HoneyThumb sichern</button><button class="btn" id="ctNo">Schließen</button><button class="btn primary" id="ctSave">Speichern …</button></div>`;
    const msg = t => { const m = $('#ctMsg'); if (m) m.textContent = t || ''; };
    $('#ctFmt').value = o0.fmt; $('#ctAcc').value = o0.acc; $('#ctTitle').value = o0.title; $('#ctKicker').value = o0.kicker; $('#ctSub').value = o0.sub; $('#ctCut').checked = !!o0.cut;
    $('#ctSize').value = o0.size; $('#ctShift').value = o0.shift; $('#ctBg').value = o0.bg; $('#ctBgc').value = o0.bgc; $('#ctOv').checked = o0.ov !== false;
    $('#ctFirst').checked = !!(P.settings.coverFirst && P.settings.coverFirst.on); if (!TS.saveImage) $('#ctFirstL').style.display = 'none';
    let pref = {}; try { pref = JSON.parse(localStorage.getItem('hc-cover')) || {}; } catch(_){} $('#ctType').value = pref.tplType === 'png' ? 'png' : 'jpg';
    let tpl = o0.tpl, open = true, busy = false, again = false, stripT = 0;
    const read = () => ({tpl, fmt: $('#ctFmt').value, acc: $('#ctAcc').value, title: $('#ctTitle').value, kicker: $('#ctKicker').value, sub: $('#ctSub').value, cut: $('#ctCut').checked, size: +$('#ctSize').value, shift: +$('#ctShift').value, bg: $('#ctBg').value, bgc: $('#ctBgc').value, ov: $('#ctOv').checked});
    const keep = () => { P.settings.coverTpl = read(); try { localStorage.setItem('hc-cover', JSON.stringify({...pref, tplType: $('#ctType').value})); } catch(_){} clearTimeout(saveT); saveT = setTimeout(saveNow, 700); };
    const sizes = () => { const f = H.format($('#ctFmt').value), cur = $('#ctOut').value; $('#ctOut').innerHTML = f.out.map(([w, h]) => `<option value="${w}">${w} × ${h}</option>`).join(''); if ([...$('#ctOut').options].some(x => x.value === cur)) $('#ctOut').value = cur; };
    const show = () => { const o = read(), T = H.template(o.tpl), person = T.needs.includes('person'), hasSub = T.build({...H.format(o.fmt), wide: true}, {acc: '#000000', accL: '#000000'}).some(L => L.slot === 'sub');
      $('#ctPersonRow').style.display = person ? '' : 'none'; $('#ctCut').closest('label').style.display = person ? '' : 'none'; $('#ctSubL').style.display = hasSub ? '' : 'none';
      $('#ctBgcL').style.display = o.bg === 'color' ? '' : 'none'; $('#ctBgImgL').style.display = o.bg === 'img' ? '' : 'none';
      const n = brand ? brand.overlays.filter(x => x.auto && x.formats.includes(o.fmt)).length : 0;
      $('#ctBrand').textContent = brand ? `Markenunterlagen: ${brand.name}` + (brand.overlays.length ? (n ? ` – ${brand.overlays.filter(x => x.auto && x.formats.includes(o.fmt)).map(x => '„' + x.name + '“').join(', ')} liegt obenauf` : ' – keine Auflage für dieses Format') : '') : 'Markenunterlagen aus HoneyThumb: keine geladen';
      $('#ctOvL').style.display = n ? '' : 'none'; $('#ctBrandOff').style.display = brand ? '' : 'none'; };
    // Vorschau; läuft schon eine, folgt danach genau eine weitere mit dem neuesten Stand
    const paint = async () => { if (!open || !st) return; if (busy){ again = true; return; } busy = true;
      try { const d = build(read()), pv = $('#ctPrev'); await H.load(d); if (!open || !pv) return; const F = H.format(d.format), w = Math.round(F.w >= F.h ? 640 : 640 * F.w / F.h); H.render(d, w, {canvas: pv, edit: true}); }
      catch(e){ msg('Die Vorschau lässt sich nicht zeichnen: ' + ((e && e.message) || e)); }
      finally { busy = false; if (again){ again = false; paint(); } } };
    const strip = () => { clearTimeout(stripT); stripT = setTimeout(async () => { if (!open || !st) return; const o = read(), g = $('#ctTpls'); if (!g) return; const frag = document.createDocumentFragment();
      for (const t of H.TEMPLATES){ const d = build({...o, tpl: t.id, size: 1, shift: 0}); await H.load(d); const b = document.createElement('button'); b.type = 'button'; b.dataset.t = t.id; b.title = t.n; b.className = t.id === tpl ? 'on' : ''; b.append(H.render(d, 150, {edit: true})); const s = document.createElement('span'); s.textContent = t.n; b.append(s); frag.append(b); }
      if (!open || !$('#ctTpls')) return; g.innerHTML = ''; g.append(frag); }, 250); };
    // Person freistellen – einmal je geholtem Bild
    const cut = async () => { if (!st || st.cut || st.cutFor === st.frame || !$('#ctCut').checked || !H.template(tpl).needs.includes('person')) return; st.cutFor = st.frame;
      try { msg('Stelle die Person frei …'); const im = await H.decode(st.frame), r = await CUT.person(im, {msg}), c = CUT.crop(im, r.mask, r.box); st.cut = {img: c.img, mask: c.mask}; msg(''); }
      catch(e){ msg(((e && e.message) || 'Das Freistellen hat nicht geklappt.') + ' Das Bild steht ohne Freistellung in der Vorlage.'); hcLog('Titelbild, Freistellen: ' + ((e && e.message) || e)); }
      paint(); strip(); };
    const fresh = async () => { msg('Hole das Bild …'); try { const frame = await grab(); st = {frame, pos: outPos, cut: null, cutFor: null, bgUrl: st ? st.bgUrl : null}; msg(''); } catch(e){ msg('Das Bild an der Abspiellinie lässt sich nicht holen: ' + ((e && e.message) || e)); return; } await paint(); strip(); cut(); };

    // Titelbild als erstes Bild des Videos: das fertige Bild in der Größe des Videos beim Projekt ablegen
    const first = async quiet => { if (!TS.saveImage) return; const on = $('#ctFirst') ? $('#ctFirst').checked : !!(P.settings.coverFirst && P.settings.coverFirst.on);
      if (!on){ if (P.settings.coverFirst && P.settings.coverFirst.on){ P.settings.coverFirst = {on: false}; clearTimeout(saveT); saveT = setTimeout(saveNow, 300); } return; }
      if (!st) return;
      try { const [W, Hh] = outSize(), d = build(read()); await H.load(d); const F = H.format(d.format), w = Math.round(Math.max(W, Hh * F.w / F.h) / 2) * 2, cv = H.render(d, Math.min(2560, w)), url = cv.toDataURL('image/png');
        const m = J(TS.saveImage(`titelbild-${hashStr(url.slice(0, 4000) + url.length + url.slice(-4000))}.png`, url, cv.width, cv.height, P.id)); if (!m || !m.uri) throw new Error('nicht gespeichert');
        P.settings.coverFirst = {on: true, uri: m.uri, w: cv.width, h: cv.height}; clearTimeout(saveT); saveT = setTimeout(saveNow, 300);
        if (!quiet) msg(Math.abs(F.w / F.h - W / Hh) > 0.02 ? 'Das Titelbild liegt auf dem ersten Bild des Videos. Es hat ein anderes Format als das Video und wird an den Rändern beschnitten.' : 'Das Titelbild liegt beim nächsten Export auf dem ersten Bild des Videos.'); }
      catch(e){ if (!quiet) msg('Das Titelbild ließ sich nicht fürs Video ablegen: ' + ((e && e.message) || e)); hcLog('Titelbild als erstes Bild: ' + ((e && e.message) || e)); } };
    $('#ctFirst').addEventListener('change', async () => { const c = $('#ctFirst');
      if (c.checked){ const [W, Hh] = outSize(), fit = H.FORMATS.find(f => Math.abs(f.w / f.h - W / Hh) < 0.02); if (fit && $('#ctFmt').value !== fit.k){ $('#ctFmt').value = fit.k; keep(); show(); sizes(); await paint(); strip(); } }
      await first(false); });
    $('#ctBrandFile').addEventListener('change', async e => { const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try { msg('Lese die Markenunterlagen …'); const b = await brandRead(await f.text()); await brandSet(b); $('#ctAcc').value = b.accentKey; $('#ctOv').checked = true; keep(); show(); await paint(); strip(); msg(`Markenunterlagen „${b.name}“ geladen` + (b.overlays.length ? ` – ${b.overlays.length === 1 ? 'eine Auflage' : b.overlays.length + ' Auflagen'}` : '') + (b.fontFiles.length ? `, ${b.fontFiles.length === 1 ? 'eine Schrift' : b.fontFiles.length + ' Schriften'}` : '') + '.'); }
      catch(err){ msg((err && err.message) || 'Die Datei lässt sich nicht lesen.'); } });
    $('#ctBrandOff').onclick = async () => { try { await brandSet(null); } catch(_){ brand = null; } show(); await paint(); strip(); msg('Markenunterlagen entfernt.'); };
    for (const id of ['ctFmt', 'ctAcc', 'ctTitle', 'ctKicker', 'ctSub', 'ctCut', 'ctSize', 'ctShift', 'ctBg', 'ctBgc', 'ctType', 'ctOv']){ const el = $('#' + id), fn = () => { keep(); show(); if (id === 'ctFmt') sizes(); paint(); if (!['ctSize', 'ctShift', 'ctType'].includes(id)) strip(); if (id === 'ctCut') cut(); }; el.addEventListener('input', fn); el.addEventListener('change', fn); }
    for (const id of ['ctTitle', 'ctKicker', 'ctSub']) $('#' + id).addEventListener('keydown', e => e.stopPropagation());
    $('#ctTpls').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (!b) return; tpl = b.dataset.t; for (const x of $('#ctTpls').children) x.classList.toggle('on', x === b); keep(); show(); paint(); cut(); });
    $('#ctBgFile').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; const fr = new FileReader(); fr.onload = async () => { try { const im = await H.decode(String(fr.result)), k = Math.min(1, 2000 / Math.max(im.naturalWidth, im.naturalHeight)), c = H.mkCanvas(im.naturalWidth * k, im.naturalHeight * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); st.bgUrl = c.toDataURL('image/jpeg', 0.9); paint(); strip(); } catch(err){ msg('Dieses Bild lässt sich nicht lesen.'); } }; fr.readAsDataURL(f); });
    $('#ctGrab').onclick = fresh;
    $('#ctNo').onclick = closeSheet;
    const doc = async () => { const d = build(read()); await H.load(d); return d; };
    $('#ctSave').onclick = async () => { const b = $('#ctSave'), jpg = $('#ctType').value === 'jpg'; b.disabled = true; msg('Bild wird erzeugt …');
      try { const cv = H.render(await doc(), +$('#ctOut').value || 1280); let q = 0.93, blob = await new Promise(res => cv.toBlob(res, jpg ? 'image/jpeg' : 'image/png', q));
        while (jpg && blob && blob.size > 2e6 && q > 0.55){ q -= 0.07; blob = await new Promise(res => cv.toBlob(res, 'image/jpeg', q)); }   // YouTube nimmt höchstens 2 MB
        if (!blob) throw new Error('kein Bild erzeugt');
        const m = await saveBlob(safe(P.name) + ' – Titelbild.' + (jpg ? 'jpg' : 'png'), blob); msg(m ? `${m} · ${cv.width} × ${cv.height}, ${fmtBytes(blob.size)}` : 'Nicht gespeichert.'); }
      catch(e){ msg('Das Bild ließ sich nicht speichern: ' + ((e && e.message) || e)); hcLog('Titelbild mit Vorlage: ' + ((e && e.message) || e)); }
      b.disabled = false; };
    $('#ctFile').onclick = async () => { try { const d = H.prune(await doc()), m = await saveBlob(safe(P.name) + ' – Titelbild.honeythumb', new Blob([JSON.stringify(d)], {type: 'application/json'})); msg(m ? m + ' – in HoneyThumb über „Öffnen“ laden.' : 'Nicht gespeichert.'); } catch(e){ msg('Die Datei ließ sich nicht sichern: ' + ((e && e.message) || e)); } };
    sheetOnClose = () => { if (P.settings.coverFirst && P.settings.coverFirst.on && st) first(true);   // letzter Stand des Titelbilds fürs Video
      open = false; clearTimeout(stripT); };
    body.onclick = null; sheetItem = null; sizes(); show(); openSheet(true);
    if (window.slFonts) try { await slFonts(slProfile()); } catch(_){}
    await H.fonts(); await brandReady(); show();
    if (st && Math.abs(st.pos - outPos) < 0.02){ await paint(); strip(); cut(); } else await fresh();
  }
  // Exportplan: das abgelegte Titelbild als Bild über allem, vom Anfang an genau ein Bild lang (füllt das Bild, Überstand wird beschnitten)
  window.coverFirstPlan = (W, Hh) => { const c = P && P.settings && P.settings.coverFirst; if (!c || !c.on || !c.uri || !c.w || !c.h) return [];
    const a = c.w / c.h, fps = Math.max(1, +(primary().fps) || 30);
    return [{mode: 'pip', image: true, uri: c.uri, in: 0, out: Math.round(0.6 / fps * 10000) / 10000, at: 0, x: 0.5, y: 0.5, w: +Math.max(1, Hh * a / W).toFixed(4), aspect: +a.toFixed(5), track: 199, vol: 0, hasAudio: false, width: c.w, height: c.h, rotation: 0, top: true, first: true}]; };
  window.openCoverTpl = openCoverTpl;
  window.HCTitelbild = {build: o => build({...DEF, ...o}), get state(){ return st; }, set state(v){ st = v; }, opts, get brand(){ return brand; }, brandRead, brandSet, brandReady};
  const b = document.querySelector('#coverTplBtn'); if (b) b.onclick = openCoverTpl;
})();
