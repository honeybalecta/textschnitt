'use strict';
/* Schnittstelle zu HoneyDeck. Ist HoneyDeck installiert (Windows/Android) bzw. auf der Seite vorhanden (Web),
   liefert der lokale Server die Dateien unter deck/ aus. Dann
   – zeichnet die HoneyDeck-Engine alle Folien (auch die neuen Folienarten und Symbole),
   – läuft im Reiter „Folien“ der HoneyDeck-Editor (eingebettet, mit Transkript, Import, Export),
   – bleibt alles andere (Einsetzen als B-Roll, N im Studio, Exporte) wie bisher in HoneyCut.
   Fehlt HoneyDeck, bleibt der eingebaute Folien-Reiter unverändert. */
(() => {
  let frame = null, hd = null, lastApply = 0, refreshT = 0;
  const loadScript = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error(src)); document.head.append(s); });
  const clone = o => JSON.parse(JSON.stringify(o));
  window.HC_DECK_ON = false;

  async function detect(){
    try {
      const r = await fetch('deck/version.txt', {cache: 'no-store'});
      if (!r.ok) return;
      const v = (await r.text()).trim(); if (!/^\d+\.\d+/.test(v)) return;
      await loadScript('deck/deck-icons.js'); await loadScript('deck/deck-engine.js');
      if (!window.HoneyDeck) return;
      // Schriften der Folien (Lora/Inter sind in HoneyCut schon geladen, die übrigen kommen über TSF-*)
      window.HC_DECK_ON = true; window.HC_DECK_VERSION = v;
      document.body.classList.add('has-deck');
      if (window.P && window.slSyncAll && P.slides && P.slides.length) slSyncAll();
      if (typeof tab !== 'undefined' && tab === 'slides') mount();
    } catch(_){ /* nicht installiert */ }
  }

  // Eingebetteten Editor im Reiter „Folien“ anzeigen
  function mount(){
    if (!window.HC_DECK_ON) return false;
    const pane = document.getElementById('paneSlides');
    if (!frame){
      frame = document.createElement('iframe'); frame.id = 'deckFrame'; frame.className = 'deck-frame'; frame.title = 'HoneyDeck';
      frame.src = 'deck/index.html?embed=1';
      pane.prepend(frame);
    } else if (hd) hd.reload();
    return true;
  }
  window.deckMount = mount;
  window.deckReload = () => { if (hd && frame && !document.getElementById('paneSlides').classList.contains('hidden')) hd.reload(); };

  // Folien zeichnen (von slides.js aufgerufen, wenn HoneyDeck da ist)
  window.deckRender = (sl, W, H, k, prof, safe) => HoneyDeck.render(sl, W, H, {k, profile: prof, safe, imgUrl: uri => !uri ? null : /^(data:|blob:|https?:)/.test(uri) ? uri : MEDIA(uri)});

  const wordsOf = () => tokens.filter(t => t.type !== 'pause' && isTextTok(t.i)).map(t => ({i: t.i, w: t.type === 'unk' ? (P.edits[t.i] || '') : tokText(t), p: t.p, cut: isCut(t.i)})).filter(t => t.w);
  const MEDIA_KEYS = ['media', 'mediaKey', 'rev'];

  window.HC_DECK_HOST = {
    ready(h){ hd = h; },
    state(){ return {name: P.name || 'Projekt', profile: P.slideProfile ? clone(P.slideProfile) : null, slides: clone(P.slides || []).map(s => { MEDIA_KEYS.forEach(k => delete s[k]); return s; })}; },
    firstRun: () => !P.slideProfile,
    name: () => P.name || 'Projekt',
    size(){ const [W, H] = outSize(); return {W, H}; },
    safe: () => slSafe(),
    subSafe: () => P.settings.slSubSafe !== false,
    setSubSafe(on){ P.settings.slSubSafe = on; changed(false); slSyncAll(); toast(on ? 'Folien lassen unten Platz, Untertitel rücken dorthin' : 'Folien nutzen das ganze Bild'); },
    // Änderungen aus dem Editor übernehmen. Schnelles Tippen ergibt einen Rückgängig-Schritt.
    apply(slides, profile){
      const old = new Map((P.slides || []).map(s => [s.id, s]));
      const next = slides.map(s => { const o = old.get(s.id); if (o) MEDIA_KEYS.forEach(k => { if (o[k] != null) s[k] = o[k]; }); return s; });
      const profChanged = JSON.stringify(profile) !== JSON.stringify(P.slideProfile || null);
      const now = Date.now(), quick = now - lastApply < 1500; lastApply = now;
      const doIt = () => { P.slides = next; if (profChanged) P.slideProfile = profile; };
      if (quick){ doIt(); changed(false); } else commit(doIt, false);
      // Eingesetzte Folien neu zeichnen (gebündelt)
      clearTimeout(refreshT); refreshT = setTimeout(() => { if (window.slSyncAll) slSyncAll(); }, profChanged ? 50 : 700);
    },
    undo(){ document.getElementById('undoBtn').click(); hd && hd.reload(); },
    redo(){ document.getElementById('redoBtn').click(); hd && hd.reload(); },
    words: wordsOf,
    times: sl => { try { return slTimes(sl); } catch(_){ return null; } },
    fmtTime: s => fmtS(s),
    placed: sl => P.items.some(x => x.slide === sl.id),
    mediaUrl: uri => MEDIA(uri),
    async pickImage(){ const m = await pickMedia('clip'); if (!m) return null; if (m.kind !== 'image'){ toast('Bitte ein Foto oder eine Grafik wählen'); return null; } return m.uri; },
    // Bild aus einer importierten Folie im Projekt ablegen
    async storeImage(dataUrl){
      const im = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Bild unlesbar')); i.src = dataUrl; });
      let url = dataUrl;
      if (!/^data:image\/png/.test(dataUrl)){ const c = document.createElement('canvas'); c.width = im.width; c.height = im.height; c.getContext('2d').drawImage(im, 0, 0); url = c.toDataURL('image/png'); }
      if (!TS.saveImage) throw new Error('Bilder speichern geht in dieser Version nicht');
      const m = J(TS.saveImage(`folienbild-${newId()}.png`, url, im.width, im.height, P.id));
      if (!m || !m.uri) throw new Error('Bild konnte nicht gespeichert werden');
      return m.uri;
    },
    async place(gapless){ const g = document.getElementById('slGapless'); if (g) g.checked = !!gapless; await slPlaceAll(); hd && hd.reload(); },
    jump(sl){ const t = slTimes(P.slides.find(s => s.id === sl.id) || sl); if (t){ seekOut(Math.max(0, t.s - 0.3), false); startPlay(); stopAt = t.e + 0.3; } },
    seekWord(i){ const t = tokens[i]; if (t){ if (playing) pausePlay(); seekOut(srcToOut(snapSrc(wS(t))), false); } },
    toast: m => toast(m),
    async saveFile(name, blob){
      const b64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(blob); });
      if (TS.saveFile){ const r = TS.saveFile(name, blob.type || 'application/octet-stream', b64); const msg = typeof r === 'string' ? r : ''; if (msg) toast(msg); return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 30000);
    },
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', detect); else detect();
})();
