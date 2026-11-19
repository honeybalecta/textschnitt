'use strict';
/* HoneyRec – aufnehmen mit Kamera, Skript (Souffleur), Medien und Bildschirm.
   Das Ergebnis ist ein gewöhnliches HoneyCut-Projekt: Jeder Take (Stück zwischen „Aufnehmen“ und „Pause“) wird eine Quelle,
   entfernte Teile werden zu gelöschten Bereichen (P.dels, in HoneyCut wiederherstellbar), abgespielte Medien und
   Bildschirmaufnahmen werden Elemente an genau der Stelle, an der sie während der Aufnahme liefen.
   Läuft auf allen drei Plattformen über window.TS (Windows: lokales Backend, Android: App, Browser: bridge-browser.js). */
(() => {
  const $ = s => document.querySelector(s);
  const J = t => { try { return typeof t === 'string' ? JSON.parse(t) : t; } catch(_){ return null; } };
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));
  const r3 = x => Math.round(x * 1000) / 1000;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const newId = () => Math.random().toString(36).slice(2, 10);
  const pad = n => String(n).padStart(2, '0');
  const fmt = s => { s = Math.max(0, s || 0); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = Math.floor(s % 60); return (h ? h + ':' + pad(m) : m) + ':' + pad(x); };
  const fmtD = s => fmt(s) + ',' + Math.floor((s % 1) * 10);
  const INFO = J(TS.info && TS.info()) || {};
  const PLAT = INFO.platform || 'desktop';
  const MEDIA = uri => TS.mediaUrl ? TS.mediaUrl(uri) : 'media?u=' + encodeURIComponent(uri);
  function toast(msg, ms){ const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), ms || 3400); }
  const log = m => { try { TS.log && TS.log('HoneyRec: ' + m); } catch(_){} };

  // ───────── Einstellungen (pro Gerät) ─────────
  const SET_KEY = 'hr-set';
  const SET = Object.assign({cam: '', mic: '', res: 1080, fps: 30, ns: false, mirror: true, count: true, micDuring: false, mode: 'broll', skSize: 38, skSpeed: 40, skMirror: false, skHide: false},
    J(localStorage.getItem(SET_KEY)) || {});
  const saveSet = () => { try { localStorage.setItem(SET_KEY, JSON.stringify(SET)); } catch(_){} };

  // ───────── Rückmeldungen der Plattform (Dateiauswahl, Zurück-Taste) ─────────
  const pending = new Map();
  window.TSApp = {
    onPicked(id, json){ const cb = pending.get(id); pending.delete(id); if (cb) cb(json ? J(json) : null); },
    onPause(){ saveNow(); },
    onBack(){ for (const v of ['#tkVeil', '#skVeil', '#setVeil']) if (!$(v).classList.contains('hidden')){ $(v).classList.add('hidden'); return true; } return !!live; },
    onOpenFiles(){}, onHandover(){},
    onSwitch(){ if (live || countT){ toast('Erst die Aufnahme pausieren – dann geht es zu HoneyCut'); return 'stay'; } saveNow(); stopTracks(Dev.cam); stopTracks(Dev.mic); return 'go'; },
  };
  const pick = kind => new Promise(res => { const id = newId(); pending.set(id, res); TS.pick(id, kind); });
  function watchJob(id, onTick){
    return new Promise((res, rej) => {
      let miss = 0;
      const tick = () => {
        let j; try { j = J(TS.job(id)); } catch(e){ if (++miss < 8) return setTimeout(tick, 600); return rej(e); }
        if (!j) return rej(new Error('Auftrag verloren'));
        if (onTick) onTick(j);
        if (j.status === 'running') return setTimeout(tick, 400);
        if (j.status === 'done') res(j.result); else rej(new Error(j.error || 'Abgebrochen'));
      };
      tick();
    });
  }

  // ───────── Projekt (HoneyCut-Format) ─────────
  // P.rec = {v, dir, takes: [{id, n, src, dels: [[a, b]], ev: [...]}], gone: [...], fixed, done}
  //   fixed = Anzahl Quellen, die vor dieser Sitzung schon im Projekt standen (beim Weiter-Aufnehmen nach „Fertig“)
  //   ev = {id, k: 'm' (Medium) | 's' (Bildschirm), clip, t0, t1, in, mode}  – Zeiten in Sekunden ab Beginn des Takes
  let P = null, stored = false;
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const takesOf = () => P ? P.rec.takes : [];
  const readyTakes = () => takesOf().filter(t => t.src);
  function newSession(name){
    name = String(name || '').trim() || `Aufnahme ${new Date().toLocaleDateString('de-DE')}`;
    P = {id: newId() + newId().slice(0, 4), name, created: Date.now(), updated: Date.now(), sources: [], tokens: [], deleted: [], trims: {}, adj: {}, dels: [], splits: [],
         settings: {pad: 0.06, burn: true}, cues: [], items: [], houseNew: 1, rec: {v: 1, dir: `${today()} ${name}`.replace(/[\\/:*?"<>|]/g, '_').slice(0, 80), takes: [], gone: [], fixed: 0, done: false}};
    stored = false; renderAll();
  }
  async function openSession(id){
    if (TS.prepare && !(await TS.prepare(id))) return;   // Browser: Zugriff auf die Dateien sicherstellen
    const p = J(TS.loadProject(id)); if (!p || !p.rec) return toast('Diese Aufnahme ließ sich nicht öffnen');
    P = p; stored = true; const R = P.rec;
    R.takes ||= []; R.gone ||= [];
    // Nach „Fertig“ oder wenn HoneyCut schon transkribiert hat: Vorhandenes bleibt fest, neue Takes kommen hinten dran
    if (R.done || (P.tokens || []).some(t => (t.src || 0) >= (R.fixed || 0))){ R.fixed = P.sources.length; (P.items || []).forEach(it => { delete it.rec; }); R.hist = (R.hist || []).concat(R.takes.filter(t => t.src)); R.takes = []; R.gone = []; }
    R.done = false;
    R.takes = R.takes.filter(t => t.src);   // abgebrochene Takes ohne Datei
    renderAll(); recoverOrphans();
  }
  // Abgeleitete Teile des Projekts aus den Takes neu aufbauen (nur, was HoneyRec gehört)
  function regen(){
    if (!P) return; const R = P.rec, fixed = R.fixed || 0;
    const keep = P.sources.slice(0, fixed), fixedEnd = keep.reduce((a, s) => a + (+s.duration || 0), 0);
    const old = new Map(P.sources.slice(fixed).map(s => [s.uri, s]));
    const items = [], dels = []; let off = fixedEnd;
    const srcs = readyTakes().map(t => {
      const s = old.get(t.src.uri) || {...t.src, tr: false};
      for (const [a, b] of t.dels) dels.push([r3(off + a), r3(off + b)]);
      for (const e of t.ev) if (e.t1 > e.t0 + 0.05) items.push(evItem(e, off, t));
      off += +t.src.duration || 0; return s;
    });
    P.sources = keep.concat(srcs);
    P.dels = (P.dels || []).filter(d => d[1] <= fixedEnd + 1e-6).concat(dels);
    P.items = (P.items || []).filter(it => !it.rec).concat(items);
  }
  function evItem(e, off, t){
    const c = {...e.clip}; for (const k of ['env', 'tr', 'off', 'k', 'legacy']) delete c[k];
    const img = c.kind === 'image', len = Math.max(0.1, Math.min(e.t1, t.src.duration || e.t1) - e.t0);
    const it = {id: e.id, rec: 1, type: e.mode === 'pip' ? 'pip' : 'broll', at: r3(off + e.t0), clip: c, in: img ? 0 : r3(e.in || 0), out: img ? r3(len) : r3((e.in || 0) + len), track: e.k === 's' ? 2 : 1};
    if (c.hasAudio !== false && !img) it.vol = 1;   // Ton des Mediums gehört ins Video
    if (it.type === 'pip'){ const W = t.src.width || 1920, H = t.src.height || 1080, ar = (c.width || 16) / (c.height || 9), w = 0.4, pw = w * W, ph = pw / ar, m = 0.03 * W;
      it.corner = 'or'; it.w = w; it.x = r3((W - m - pw / 2) / W); it.y = r3((m + ph / 2) / H); }
    return it;
  }
  let saveT = 0;
  function save(){ clearTimeout(saveT); saveT = setTimeout(saveNow, 400); }
  function saveNow(){
    clearTimeout(saveT); saveT = 0; if (!P) return;
    if (!stored && !readyTakes().length){ try { localStorage.setItem('hr-draft', JSON.stringify({name: P.name, script: P.script || null})); } catch(_){} return; }
    regen(); P.updated = Date.now();
    try { TS.saveProject(P.id, JSON.stringify(P)); stored = true; } catch(e){ toast('Speichern fehlgeschlagen: ' + e.message); log('Speichern: ' + e.message); }
  }

  // ───────── Geräte: Kamera und Mikrofon ─────────
  const Dev = {cam: null, mic: null, ac: null, an: null, buf: null};
  const md = navigator.mediaDevices;
  async function openDevices(){
    if (!md || !md.getUserMedia){ camMsg('Dieses Gerät erlaubt hier keinen Zugriff auf Kamera und Mikrofon.'); return; }
    if (live) return toast('Während der Aufnahme lässt sich das Gerät nicht wechseln');
    stopTracks(Dev.cam); stopTracks(Dev.mic); Dev.cam = Dev.mic = null;
    const H = +SET.res, W = Math.round(H * 16 / 9);
    const vc = {width: {ideal: W}, height: {ideal: H}, frameRate: {ideal: +SET.fps}};
    try { Dev.cam = await md.getUserMedia({video: SET.cam ? {...vc, deviceId: {exact: SET.cam}} : vc, audio: false}); }
    catch(e){
      try { Dev.cam = await md.getUserMedia({video: vc, audio: false}); if (SET.cam) toast('Die gewählte Kamera ist nicht verfügbar – die Standardkamera ist aktiv'); }
      catch(e2){ camMsg(e2.name === 'NotAllowedError' ? 'Kein Zugriff auf die Kamera. Bitte den Zugriff erlauben und HoneyRec neu öffnen.' : 'Keine Kamera gefunden. Ist sie angeschlossen und nicht in einem anderen Programm geöffnet?'); log('Kamera: ' + e2.name + ' ' + e2.message); }
    }
    const ac0 = {echoCancellation: false, noiseSuppression: !!SET.ns, autoGainControl: false, sampleRate: {ideal: 48000}, channelCount: {ideal: 2}};
    try { Dev.mic = await md.getUserMedia({audio: SET.mic ? {...ac0, deviceId: {exact: SET.mic}} : ac0, video: false}); }
    catch(e){ try { Dev.mic = await md.getUserMedia({audio: ac0, video: false}); } catch(e2){ toast('Kein Mikrofon verfügbar – aufgenommen wird nur das Bild'); log('Mikrofon: ' + e2.name); } }
    if (Dev.cam){ $('#camV').srcObject = Dev.cam; camMsg(''); }
    meterFrom(Dev.mic); gate();
    await fillDevices(); camInfo();
  }
  const stopTracks = s => { if (s) s.getTracks().forEach(t => t.stop()); };
  function camMsg(m){ const el = $('#camMsg'); el.textContent = m; el.classList.toggle('hidden', !m); }
  function camInfo(){
    const v = Dev.cam && Dev.cam.getVideoTracks()[0], s = v ? v.getSettings() : null;
    $('#camInfo').textContent = s ? `Aktiv: ${v.label || 'Kamera'} · ${s.width}×${s.height} bei ${Math.round(s.frameRate || 0)} Bildern/s` + (s.height < +SET.res - 8 ? ' – die Kamera liefert hier nicht mehr.' : '') : '';
  }
  async function fillDevices(){
    let list = []; try { list = await md.enumerateDevices(); } catch(_){}
    const fill = (sel, kind, cur, none) => { const xs = list.filter(d => d.kind === kind);
      sel.innerHTML = `<option value="">${none}</option>` + xs.map((d, k) => `<option value="${esc(d.deviceId)}">${esc(d.label || (kind === 'videoinput' ? 'Kamera ' : 'Mikrofon ') + (k + 1))}</option>`).join('');
      sel.value = xs.some(d => d.deviceId === cur) ? cur : ''; };
    fill($('#camSel'), 'videoinput', SET.cam, 'Standardkamera'); fill($('#micSel'), 'audioinput', SET.mic, 'Standardmikrofon');
  }
  if (md && md.addEventListener) md.addEventListener('devicechange', () => fillDevices());
  // Pegelanzeige
  function meterFrom(stream){
    try { if (Dev.ac) Dev.ac.close(); } catch(_){}
    Dev.ac = Dev.an = null; if (!stream || !stream.getAudioTracks().length) return;
    try { const ac = new (window.AudioContext || window.webkitAudioContext)(); const an = ac.createAnalyser(); an.fftSize = 1024;
      ac.createMediaStreamSource(stream).connect(an); Dev.ac = ac; Dev.an = an; Dev.buf = new Float32Array(an.fftSize); } catch(_){}
  }
  let peakHold = 0;
  (function meterLoop(){
    requestAnimationFrame(meterLoop);
    const an = Dev.an, m = $('#meter'); if (!an) return;
    if (Dev.ac.state === 'suspended') return;
    an.getFloatTimeDomainData(Dev.buf); let pk = 0; for (const x of Dev.buf) pk = Math.max(pk, Math.abs(x));
    const db = 20 * Math.log10(pk || 1e-6); peakHold = Math.max(db, peakHold - 0.6);
    m.querySelector('i').style.width = clamp((peakHold + 60) / 60 * 100, 0, 100) + '%';
    m.classList.toggle('hot', peakHold > -3);
  })();
  document.addEventListener('pointerdown', () => { if (Dev.ac && Dev.ac.state === 'suspended') Dev.ac.resume().catch(() => {}); }, true);

  // ───────── Mikrofon während Medien mit Ton ─────────
  // Standard: Läuft ein Medium mit eigenem Ton, nimmt HoneyRec das Mikrofon nicht auf (sonst käme der Ton aus den Lautsprechern
  // ein zweites Mal hinein). Bilder und Präsentationen schalten das Mikrofon nie stumm. Der Haken „Mikro auch …“ hebt das auf.
  const playingWithSound = () => !!(M.el && !M.el.paused && !M.el.ended && M.cur && M.cur.clip.kind !== 'image' && M.cur.clip.hasAudio !== false && M.el.volume > 0 && !M.el.muted);
  function gate(){
    const mute = playingWithSound() && !SET.micDuring;
    if (Dev.mic) Dev.mic.getAudioTracks().forEach(t => { t.enabled = !mute; });
    $('#meter').classList.toggle('mute', mute); $('#muteBadge').classList.toggle('hidden', !mute);
  }

  // ───────── Aufnahme ─────────
  const MIMES = ['video/mp4;codecs=avc1.640033,mp4a.40.2', 'video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4',
                 'video/webm;codecs=h264,opus', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  const pickMime = video => { if (!window.MediaRecorder) return null; for (const m of MIMES){ const x = video ? m : m.replace(/,(mp4a\.40\.2|mp4a|opus)/, ''); try { if (MediaRecorder.isTypeSupported(x)) return x; } catch(_){} } return ''; };
  const vbr = (h, fps) => Math.round(({720: 8e6, 1080: 16e6, 1440: 26e6, 2160: 45e6}[h >= 2000 ? 2160 : h >= 1400 ? 1440 : h >= 1000 ? 1080 : 720]) * (fps > 32 ? 1.5 : 1));
  const chunkTo = (id, blob) => TS.recChunk ? TS.recChunk(id, blob)
    : fetch('rec/chunk?id=' + encodeURIComponent(id), {method: 'POST', body: blob}).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
  // Ein Rekorder schreibt Stück für Stück in eine Datei; schlägt ein Stück fehl, wird es noch zweimal versucht
  function startRecorder(stream, name, bps){
    const mime = pickMime(stream.getVideoTracks().length > 0);
    if (mime == null) throw new Error('Dieses Gerät kann hier nicht aufnehmen (MediaRecorder fehlt)');
    const o = J(TS.recOpen(JSON.stringify({session: P.rec.dir, name, mime, project: P.id})));
    if (!o || !o.id) throw new Error('Die Aufnahmedatei ließ sich nicht anlegen');
    if (o.dir) P.rec.path = o.dir;
    const R = {id: o.id, mime, chain: Promise.resolve(), err: null, bytes: 0, rec: null, t0: performance.now(), stopped: null};
    const opts = {videoBitsPerSecond: bps, audioBitsPerSecond: 192000}; if (mime) opts.mimeType = mime;
    const rec = new MediaRecorder(stream, opts); R.rec = rec;
    const send = blob => { const go = n => chunkTo(R.id, blob).catch(e => { if (n < 2) return new Promise(r => setTimeout(r, 400)).then(() => go(n + 1)); throw e; });
      R.chain = R.chain.then(() => go(0)).then(() => { R.bytes += blob.size; }).catch(e => { if (!R.err){ R.err = e; log('Stück verloren: ' + e.message); toast('Achtung: Ein Teil der Aufnahme ließ sich nicht speichern (' + e.message + ')', 6000); } }); };
    rec.ondataavailable = e => { if (e.data && e.data.size) send(e.data); };
    R.stopped = new Promise(res => { rec.onstop = res; });
    rec.onerror = e => { log('Rekorder: ' + (e.error && e.error.message)); toast('Die Aufnahme wurde unterbrochen: ' + ((e.error && e.error.message) || 'Fehler')); if (live && live.R === R) stopTake(); };
    rec.start(1000); R.t0 = performance.now();
    return R;
  }
  async function finishRecorder(R, meta){
    try { if (R.rec.state !== 'inactive') R.rec.stop(); } catch(_){}
    await R.stopped; await R.chain;
    const jid = TS.recClose(R.id, JSON.stringify(meta));
    const media = await watchJob(jid);
    return media;
  }

  let live = null;   // laufender Take: {take, R, open: offenes Medien-Ereignis}
  const nowT = () => live ? (performance.now() - live.R.t0) / 1000 : 0;
  const nextNo = () => Math.max(0, ...takesOf().map(t => t.n), ...(P.rec.gone || []).map(t => t.n), ...(P.rec.hist || []).map(t => t.n)) + 1;
  async function toggleRec(){
    if (busyStart) return;
    if (live) return stopTake();
    if (countT){ cancelCount(); return; }
    if (!P) return;
    if (!Dev.cam){ await openDevices(); if (!Dev.cam) return toast('Ohne Kamera geht es nicht – bitte unter ⚙ eine wählen'); }
    if (Dev.ac && Dev.ac.state === 'suspended') Dev.ac.resume().catch(() => {});
    if (SET.count) countdown(startTake); else startTake();
  }
  let countT = 0;
  function countdown(fn){
    let n = 3; const el = $('#count'); el.textContent = n; el.classList.remove('hidden');
    const step = () => { n--; if (n <= 0){ countT = 0; el.classList.add('hidden'); fn(); return; } el.textContent = n; countT = setTimeout(step, 1000); };
    countT = setTimeout(step, 1000);
  }
  function cancelCount(){ clearTimeout(countT); countT = 0; $('#count').classList.add('hidden'); }
  let busyStart = false;
  async function startTake(){
    busyStart = true;
    try {
      const n = nextNo(), v = Dev.cam.getVideoTracks()[0], s = v.getSettings();
      const tracks = [v, ...(Dev.mic ? Dev.mic.getAudioTracks() : [])];
      const R = startRecorder(new MediaStream(tracks), `Take ${pad(n)}`, vbr(s.height || +SET.res, s.frameRate || +SET.fps));
      const take = {id: newId(), n, src: null, dels: [], ev: [], at: Date.now(), w: s.width, h: s.height};
      P.rec.takes.push(take);
      live = {take, R, open: null};
      document.body.classList.add('live'); paintRec();
      if (M.cur && (M.cur.clip.kind === 'image' || (M.el && !M.el.paused))) openEv();   // was schon läuft oder zu sehen ist, gehört ab jetzt dazu
      if (Scr.stream) startScreenSeg();
      renderTakes(); tickClock();
    } catch(e){ toast(e.message || 'Aufnahme ließ sich nicht starten'); log('Start: ' + e.message); live = null; document.body.classList.remove('live'); }
    busyStart = false; paintRec();
  }
  async function stopTake(){
    const L = live; if (!L) return; live = null;
    const t = (performance.now() - L.R.t0) / 1000;
    closeEv(L, t);
    if (M.el && !M.el.paused) M.el.pause();   // Medium hält mit an – sonst liefe es ohne Aufnahme weiter
    const scr = Scr.seg; Scr.seg = null;
    document.body.classList.remove('live'); paintRec();
    const take = L.take; take.busy = true; take.dur = t; renderTakes(); $('#dropLast').classList.remove('hidden');
    if (scr) endScreenSeg(scr, take, t);
    try {
      const s = Dev.cam && Dev.cam.getVideoTracks()[0] ? Dev.cam.getVideoTracks()[0].getSettings() : {};
      const media = await finishRecorder(L.R, {duration: t, width: s.width || take.w, height: s.height || take.h, fps: s.frameRate || +SET.fps, mime: L.R.mime, hasAudio: !!(Dev.mic && Dev.mic.getAudioTracks().length)});
      media.name = media.name || `Take ${pad(take.n)}`;
      if (!media.duration) media.duration = r3(t);
      take.src = media; take.busy = false;
      if (L.R.err) take.warn = 'Teile fehlen';
    } catch(e){ take.busy = false; take.failed = e.message; toast(`Take ${take.n} ließ sich nicht sichern: ${e.message}`, 7000); log('Sichern: ' + e.message); }
    P.rec.takes = P.rec.takes.filter(x => x.src || x.busy);
    renderTakes(); saveNow();
  }
  function paintRec(){
    const b = $('#recBtn'); b.classList.toggle('live', !!live); b.querySelector('.lbl').textContent = live ? 'Pause' : takesOf().length ? 'Weiter aufnehmen' : 'Aufnehmen';
    b.title = live ? 'Take beenden (R) – der nächste Druck beginnt einen neuen Take' : 'Aufnahme starten (R)';
    $('#rTake').textContent = live ? `Take ${live.take.n}` : '';
  }
  function tickClock(){
    const total = readyTakes().reduce((a, t) => a + (t.src.duration || 0), 0);
    $('#rClock').textContent = live ? fmt(nowT()) : fmt(total);
    if (live) setTimeout(tickClock, 250);
  }

  // ───────── Bildschirm mitaufnehmen ─────────
  const Scr = {stream: null, seg: null, n: 0};
  async function startScreen(){
    if (!md || !md.getDisplayMedia) return toast('Hier lässt sich kein Bildschirm aufnehmen – das geht in HoneyRec am Computer');
    if (Scr.stream) return stopScreen();
    try { Scr.stream = await md.getDisplayMedia({video: {frameRate: {ideal: 30}}, audio: false}); }
    catch(e){ if (e.name !== 'NotAllowedError') toast('Bildschirmaufnahme nicht möglich: ' + e.message); return; }
    const tr = Scr.stream.getVideoTracks()[0]; tr.onended = () => stopScreen();
    $('#scrV').srcObject = Scr.stream; $('#scrBox').classList.remove('hidden'); $('#scrBtn').classList.add('on'); $('#scrBtn').textContent = 'Bildschirm beenden';
    $('#scrInfo').textContent = live ? 'Wird gerade mitaufgenommen.' : 'Läuft mit, sobald du aufnimmst.';
    if (live) startScreenSeg();
  }
  function startScreenSeg(){
    if (!Scr.stream || !live) return;
    const s = Scr.stream.getVideoTracks()[0].getSettings();
    try { Scr.seg = {R: startRecorder(Scr.stream, `Bildschirm ${pad(live.take.n)}-${++Scr.n}`, vbr(s.height || 1080, 30)), t0: nowT(), take: live.take, w: s.width, h: s.height};
      $('#scrInfo').textContent = 'Wird gerade mitaufgenommen.'; }
    catch(e){ toast('Bildschirm: ' + e.message); }
  }
  async function endScreenSeg(seg, take, tEnd){
    $('#scrInfo').textContent = 'Läuft mit, sobald du aufnimmst.';
    try {
      const media = await finishRecorder(seg.R, {duration: tEnd - seg.t0, width: seg.w, height: seg.h, mime: seg.R.mime, hasAudio: false});
      media.name = media.name || 'Bildschirm';
      take.ev.push({id: newId(), k: 's', clip: media, t0: r3(seg.t0), t1: r3(tEnd), in: 0, mode: SET.mode});
      renderTakes(); saveNow();
    } catch(e){ toast('Die Bildschirmaufnahme ließ sich nicht sichern: ' + e.message, 6000); }
  }
  function stopScreen(){
    if (Scr.seg && live){ const seg = Scr.seg; Scr.seg = null; endScreenSeg(seg, live.take, nowT()); }
    stopTracks(Scr.stream); Scr.stream = null; $('#scrV').srcObject = null; $('#scrBox').classList.add('hidden'); $('#scrBtn').classList.remove('on'); $('#scrBtn').textContent = 'Bildschirm mitaufnehmen';
  }

  // ───────── Medien zum Reagieren und Zeigen ─────────
  // Ein Eintrag ist ein Video, eine Tonaufnahme, ein Bild oder eine Bilderreihe (Präsentation, mehrere Bilder auf einmal geladen).
  const M = {list: [], cur: null, page: 0, el: null};
  async function addMedia(){
    const got = await pick('clips'); const list = !got ? [] : Array.isArray(got) ? got : [got]; if (!list.length) return;
    const imgs = list.filter(m => m.kind === 'image'), rest = list.filter(m => m.kind !== 'image');
    for (const m of rest) M.list.push({mid: newId(), clip: m, pages: null});
    if (imgs.length > 1) M.list.push({mid: newId(), clip: imgs[0], pages: imgs, name: `Präsentation (${imgs.length} Bilder)`});
    else if (imgs.length) M.list.push({mid: newId(), clip: imgs[0], pages: null});
    renderMedia(); saveMediaList();
    if (!M.cur) show(M.list[M.list.length - 1], false);
  }
  function saveMediaList(){ if (P){ P.rec.media = M.list.map(x => ({mid: x.mid, clip: x.clip, pages: x.pages, name: x.name})); save(); } }
  const kindLbl = x => x.pages ? 'Präsentation' : x.clip.kind === 'image' ? 'Bild' : x.clip.kind === 'audio' || x.clip.hasVideo === false ? 'Ton' : 'Video';
  function renderMedia(){
    const box = $('#mList'); box.innerHTML = '';
    for (const x of M.list){
      const b = document.createElement('div'); b.className = 'mitem' + (M.cur === x ? ' on' : ''); b.tabIndex = 0; b.title = x.name || x.clip.name;
      const k = kindLbl(x), au = k === 'Ton';
      b.innerHTML = (au ? '<div class="au">♪</div>' : x.clip.kind === 'image' ? `<img src="${esc(MEDIA(x.clip.uri))}" alt="">` : `<video preload="metadata" muted src="${esc(MEDIA(x.clip.uri))}#t=1"></video>`)
        + `<span class="kind">${k}</span><span class="nm">${esc(x.name || x.clip.name || '')}</span><button class="x" title="Aus der Liste nehmen">✕</button>`;
      b.onclick = e => { if (e.target.closest('.x')){ if (M.cur === x) hide(); M.list = M.list.filter(y => y !== x); renderMedia(); saveMediaList(); return; } show(x, false); };
      box.append(b);
    }
    $('#stageEmpty').classList.toggle('hidden', !!M.cur);
  }
  function show(x, play){
    if (!x) return;
    if (M.el && !M.el.paused) M.el.pause();
    closeEv(live, nowT());
    M.cur = x; M.page = 0; paintStage(play);
    renderMedia();
  }
  function hide(){ if (M.el && !M.el.paused) M.el.pause(); closeEv(live, nowT()); M.cur = null; M.el = null; $('#stageOn').innerHTML = ''; $('#stageOn').classList.add('hidden'); $('#stageCtl').classList.add('hidden'); renderMedia(); gate(); }
  const curClip = () => M.cur ? (M.cur.pages ? M.cur.pages[M.page] : M.cur.clip) : null;
  function paintStage(play){
    const x = M.cur, c = curClip(), on = $('#stageOn'); on.innerHTML = ''; on.classList.remove('hidden'); $('#stageCtl').classList.remove('hidden');
    const img = c.kind === 'image', au = !img && (c.kind === 'audio' || c.hasVideo === false);
    $('#mPrev').classList.toggle('hidden', !x.pages); $('#mNext').classList.toggle('hidden', !x.pages);
    $('#mPlay').classList.toggle('hidden', img); $('#mSeek').classList.toggle('hidden', img);
    M.el = null;
    if (img){ const im = new Image(); im.src = MEDIA(c.uri); on.append(im); $('#mTime').textContent = x.pages ? `Bild ${M.page + 1} von ${x.pages.length}` : 'Bild'; if (live) openEv(); gate(); return; }
    const el = document.createElement(au ? 'audio' : 'video'); el.src = MEDIA(c.uri); el.playsInline = true; el.preload = 'auto';
    if (au){ const card = document.createElement('div'); card.className = 'audio-card'; card.innerHTML = `<b>♪</b><span>${esc(c.name || 'Ton')}</span>`; on.append(card); }
    on.append(el); M.el = el;
    el.addEventListener('play', () => { if (live) openEv(); gate(); paintPlay(); });
    el.addEventListener('playing', () => { if (live && !live.open) openEv(); gate(); });
    el.addEventListener('pause', () => { closeEv(live, nowT()); gate(); paintPlay(); });
    el.addEventListener('ended', () => { closeEv(live, nowT()); gate(); paintPlay(); });
    el.addEventListener('seeking', () => { if (live && live.open) closeEv(live, nowT()); });
    el.addEventListener('timeupdate', () => { x.lastT = el.currentTime; paintTime(); });
    if (x.lastT && !x.pages) el.addEventListener('loadedmetadata', () => { if (x.lastT < (el.duration || 0) - 0.5) el.currentTime = x.lastT; }, {once: true});
    el.addEventListener('volumechange', gate);
    paintPlay(); paintTime();
    if (play) el.play().catch(() => {});
  }
  function paintPlay(){ $('#mPlay').textContent = M.el && !M.el.paused ? '❚❚' : '▶'; $('#stage').classList.toggle('playing', !!(M.el && !M.el.paused)); }
  function paintTime(){ const el = M.el; if (!el) return; const d = el.duration || 0; $('#mTime').textContent = `${fmt(el.currentTime)} / ${fmt(d)}`; if (!seekDrag) $('#mSeek').value = d ? Math.round(el.currentTime / d * 1000) : 0; }
  let seekDrag = false;
  $('#mSeek').addEventListener('pointerdown', () => { seekDrag = true; });
  $('#mSeek').addEventListener('input', () => { const el = M.el; if (el && el.duration) el.currentTime = $('#mSeek').value / 1000 * el.duration; });
  $('#mSeek').addEventListener('change', () => { seekDrag = false; });
  function mediaPlay(){ if (!M.el) return; if (M.el.paused) M.el.play().catch(e => toast('Abspielen nicht möglich: ' + e.message)); else M.el.pause(); }
  function page(d){ const x = M.cur; if (!x){ return; } if (!x.pages){ if (M.el) M.el.currentTime = clamp(M.el.currentTime + d * 5, 0, M.el.duration || 0); return; }
    const n = clamp(M.page + d, 0, x.pages.length - 1); if (n === M.page) return; closeEv(live, nowT()); M.page = n; paintStage(false); }
  // Ereignisse: Beginn und Ende dessen, was während eines Takes zu sehen bzw. zu hören war
  function openEv(){
    if (!live || !M.cur) return; closeEv(live, nowT());
    const c = curClip(); live.open = {id: newId(), k: 'm', mid: M.cur.mid, clip: c, t0: r3(nowT()), in: c.kind === 'image' ? 0 : r3(M.el ? M.el.currentTime : 0), mode: SET.mode};
  }
  function closeEv(L, t){
    if (!L || !L.open) return; const e = L.open; L.open = null;
    e.t1 = r3(t); if (e.t1 - e.t0 < 0.15) return;
    L.take.ev.push(e); save();
  }

  // ───────── Souffleur (Skript) ─────────
  function renderScript(){
    const txt = (P && P.script && P.script.text) || '', body = $('#skBody');
    if (!txt.trim()){ body.innerHTML = '<span class="empty">Noch kein Skript. Über „Bearbeiten“ einfügen – oder ohne Skript frei sprechen.</span>'; return; }
    body.innerHTML = txt.split('\n').map(l => /^\s*#/.test(l) ? `<span class="h">${esc(l.replace(/^\s*#+\s*/, ''))}</span>` : esc(l).replace(/\[[^\]]*\]/g, m => `<span class="rg">${m}</span>`)).join('\n');
  }
  function paintPromptStyle(){
    $('#skBody').style.fontSize = SET.skSize + 'px'; $('#skSize').value = SET.skSize; $('#skSpeed').value = SET.skSpeed;
    $('#prompt').classList.toggle('mirror', !!SET.skMirror); $('#skMirror').checked = !!SET.skMirror;
    $('#prompt').classList.toggle('hidden', !!SET.skHide); $('#skShow').classList.toggle('hidden', !SET.skHide);
    requestAnimationFrame(fitPrompt);
  }
  let roll = false, rollLast = 0, rollAcc = 0;
  function setRoll(on){ roll = on; $('#skRoll').textContent = on ? '❚❚ Anhalten' : '▶ Laufen lassen'; $('#skRoll').classList.toggle('on', on); rollLast = performance.now(); if (on) requestAnimationFrame(rollStep); }
  function rollStep(t){
    if (!roll) return; const v = $('#skView'), dt = Math.min(0.1, (t - rollLast) / 1000); rollLast = t;
    rollAcc += SET.skSpeed * 0.7 * (SET.skSize / 38) * dt; const px = Math.floor(rollAcc); if (px){ v.scrollTop += px; rollAcc -= px; }
    if (v.scrollTop + v.clientHeight >= v.scrollHeight - 2) return setRoll(false);
    requestAnimationFrame(rollStep);
  }
  const lineH = () => SET.skSize * 1.4;
  // Lesezeile im oberen Drittel: Abstand oben/unten so, dass der Text an der Markierung beginnt und bis zum letzten Wort hochlaufen kann
  function fitPrompt(){
    const v = $('#skView'), bar = $('.prompt-bar'); if (!v.clientHeight) return;
    const y = Math.round(v.clientHeight * 0.3);
    v.style.paddingTop = Math.max(12, y - lineH() * 0.5) + 'px'; v.style.paddingBottom = Math.round(v.clientHeight * 0.7) + 'px';
    $('.prompt-mark').style.top = (bar.offsetHeight + y) + 'px';
  }
  addEventListener('resize', fitPrompt);
  $('#skRoll').onclick = () => setRoll(!roll);
  $('#skSpeed').oninput = e => { SET.skSpeed = +e.target.value; saveSet(); };
  $('#skSize').oninput = e => { SET.skSize = +e.target.value; saveSet(); paintPromptStyle(); };
  $('#skMirror').onchange = e => { SET.skMirror = e.target.checked; saveSet(); paintPromptStyle(); };
  $('#skHide').onclick = () => { SET.skHide = true; saveSet(); paintPromptStyle(); };
  $('#skShow').onclick = () => { SET.skHide = false; saveSet(); paintPromptStyle(); };
  $('#skEdit').onclick = () => { $('#skText').value = (P && P.script && P.script.text) || ''; $('#skVeil').classList.remove('hidden'); setTimeout(() => $('#skText').focus(), 30); };
  $('#skNo').onclick = () => $('#skVeil').classList.add('hidden');
  $('#skOk').onclick = () => { if (P){ const t = $('#skText').value; if (t.trim()) P.script = {text: t}; else delete P.script; save(); } $('#skVeil').classList.add('hidden'); renderScript(); $('#skView').scrollTop = 0; };
  $('#skFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; $('#skText').value = await f.text(); e.target.value = ''; };

  // ───────── Takes: Übersicht, ansehen, kürzen, Teile entfernen ─────────
  const keptDur = t => Math.max(0, (t.src ? t.src.duration : t.dur || 0) - t.dels.reduce((a, [x, y]) => a + (y - x), 0));
  function renderTakes(){
    const row = $('#takeRow'), ts = takesOf();
    row.innerHTML = ts.length ? '' : '<p class="muted small take-empty">Jedes Stück zwischen „Aufnehmen“ und „Pause“ wird ein eigener Take. Takes lassen sich ansehen, kürzen, in Teilen entfernen oder verwerfen.</p>';
    for (const t of ts){
      const b = document.createElement('button'); const d = t.src ? t.src.duration : t.dur || 0;
      b.className = 'take' + (t.busy ? ' busy' : '') + (live && live.take === t ? ' live' : '');
      const ev = t.ev.length ? ` · ${t.ev.length} ${t.ev.length === 1 ? 'Einblendung' : 'Einblendungen'}` : '';
      b.innerHTML = `<b>Take ${t.n}${t.warn ? ' ⚠' : ''}</b><span>${live && live.take === t ? 'läuft …' : fmt(keptDur(t)) + (t.dels.length ? ` von ${fmt(d)}` : '') + ev}</span><div class="bar">${d ? t.dels.map(([x, y]) => `<i style="left:${x / d * 100}%;width:${(y - x) / d * 100}%"></i>`).join('') : ''}</div>`;
      b.title = t.failed ? 'Nicht gesichert: ' + t.failed : t.src ? 'Ansehen, kürzen, Teile entfernen' : '';
      b.onclick = () => { if (t.src && !t.busy) openTake(t); };
      row.append(b);
    }
    const gone = (P && P.rec.gone || []).length;
    const sum = readyTakes().reduce((a, t) => a + keptDur(t), 0);
    $('#takesSum').innerHTML = ts.length ? `${ts.length} ${ts.length === 1 ? 'Take' : 'Takes'} · ${fmt(sum)} im Schnitt` + (gone ? ` · <a href="#" id="goneLink">${gone} verworfen – zurückholen</a>` : '') : (gone ? `<a href="#" id="goneLink">${gone} verworfen – zurückholen</a>` : '');
    const gl = $('#goneLink'); if (gl) gl.onclick = e => { e.preventDefault(); P.rec.takes = P.rec.takes.concat(P.rec.gone).sort((a, b) => a.n - b.n); P.rec.gone = []; renderTakes(); saveNow(); toast('Verworfene Takes sind zurück'); };
    if (!live) tickClock();
    paintRec();
  }
  $('#dropLast').onclick = () => {
    const t = takesOf().filter(x => x.src).slice(-1)[0]; if (!t) return;
    P.rec.takes = P.rec.takes.filter(x => x !== t); P.rec.gone.push(t); $('#dropLast').classList.add('hidden'); renderTakes(); saveNow();
    toast(`Take ${t.n} verworfen – unten über „zurückholen“ wieder da`);
  };
  // Ansicht eines Takes
  const TK = {t: null, a: null, b: null, raf: 0};
  function openTake(t){
    TK.t = t; TK.a = TK.b = null; const v = $('#tkV'); v.src = MEDIA(t.src.uri); v.currentTime = 0;
    $('#tkTitle').textContent = `Take ${t.n} · ${fmt(t.src.duration)}`; $('#tkVeil').classList.remove('hidden'); $('#tkDrop').textContent = 'Ganzen Take verwerfen'; $('#tkDrop').dataset.sure = '';
    paintTk(); cancelAnimationFrame(TK.raf); TK.raf = requestAnimationFrame(tkLoop);
  }
  function closeTake(){ const v = $('#tkV'); v.pause(); v.removeAttribute('src'); v.load(); cancelAnimationFrame(TK.raf); $('#tkVeil').classList.add('hidden'); TK.t = null; renderTakes(); saveNow(); }
  function tkLoop(){
    const v = $('#tkV'), t = TK.t; if (!t) return;
    if (!v.paused){ const d = t.dels.find(([a, b]) => v.currentTime >= a - 0.01 && v.currentTime < b - 0.02); if (d) v.currentTime = d[1]; }
    const D = t.src.duration || v.duration || 1; $('#tkHead').style.left = clamp(v.currentTime / D * 100, 0, 100) + '%';
    $('#tkTime').textContent = `${fmtD(v.currentTime)} / ${fmt(D)}`; $('#tkPlay').textContent = v.paused ? '▶ Abspielen' : '❚❚ Anhalten';
    TK.raf = requestAnimationFrame(tkLoop);
  }
  function normDels(t){
    const D = t.src.duration, xs = t.dels.map(([a, b]) => [clamp(a, 0, D), clamp(b, 0, D)]).filter(([a, b]) => b - a > 0.04).sort((p, q) => p[0] - q[0]), out = [];
    for (const d of xs){ const l = out[out.length - 1]; if (l && d[0] <= l[1] + 0.02) l[1] = Math.max(l[1], d[1]); else out.push([r3(d[0]), r3(d[1])]); }
    t.dels = out;
  }
  function paintTk(){
    const t = TK.t, D = t.src.duration || 1;
    $('#tkDels').innerHTML = t.dels.map(([a, b]) => `<div style="left:${a / D * 100}%;width:${(b - a) / D * 100}%"></div>`).join('');
    const ab = $('#tkAB'); if (TK.a != null){ const a = TK.a, b = TK.b != null ? TK.b : a; ab.style.left = Math.min(a, b) / D * 100 + '%'; ab.style.width = Math.max(0.3, Math.abs(b - a) / D * 100) + '%'; ab.classList.remove('hidden'); } else ab.classList.add('hidden');
    $('#tkCut').disabled = !(TK.a != null && TK.b != null && Math.abs(TK.b - TK.a) > 0.05);
    $('#tkList').innerHTML = t.dels.length ? '<p class="muted small" style="margin:6px 0 2px">Entfernt (bleibt in HoneyCut wiederherstellbar):</p>' + t.dels.map(([a, b], k) =>
      `<div class="row"><span class="mono">${fmtD(a)} – ${fmtD(b)}</span><span class="muted">${fmtD(b - a)}</span><button class="sbtn" data-k="${k}">Zurückholen</button></div>`).join('') : '';
  }
  $('#tkList').onclick = e => { const b = e.target.closest('[data-k]'); if (!b) return; TK.t.dels.splice(+b.dataset.k, 1); paintTk(); save(); };
  const tkPos = () => $('#tkV').currentTime;
  $('#tkPlay').onclick = () => { const v = $('#tkV'); if (v.paused) v.play().catch(() => {}); else v.pause(); };
  $('#tkIn').onclick = () => { const t = TK.t; t.dels.push([0, tkPos()]); normDels(t); paintTk(); save(); toast('Anfang gekürzt'); };
  $('#tkOut').onclick = () => { const t = TK.t; t.dels.push([tkPos(), t.src.duration]); normDels(t); paintTk(); save(); toast('Ende gekürzt'); };
  $('#tkA').onclick = () => { TK.a = tkPos(); if (TK.b != null && TK.b <= TK.a) TK.b = null; paintTk(); };
  $('#tkB').onclick = () => { if (TK.a == null) TK.a = 0; TK.b = tkPos(); if (TK.b < TK.a) [TK.a, TK.b] = [TK.b, TK.a]; paintTk(); };
  $('#tkCut').onclick = () => { const t = TK.t; t.dels.push([Math.min(TK.a, TK.b), Math.max(TK.a, TK.b)]); normDels(t); TK.a = TK.b = null; paintTk(); save(); toast('Bereich entfernt'); };
  $('#tkDrop').onclick = () => { const b = $('#tkDrop'); if (!b.dataset.sure){ b.dataset.sure = '1'; b.textContent = 'Wirklich verwerfen?'; return; }
    const t = TK.t; P.rec.takes = P.rec.takes.filter(x => x !== t); P.rec.gone.push(t); closeTake(); toast(`Take ${t.n} verworfen – unten über „zurückholen“ wieder da`); };
  $('#tkOk').onclick = closeTake; $('#tkClose').onclick = closeTake;
  (() => { const line = $('#tkLine'); let drag = false;
    const at = e => { const r = line.getBoundingClientRect(), D = TK.t.src.duration || 1; $('#tkV').currentTime = clamp((e.clientX - r.left) / r.width, 0, 1) * D; };
    line.addEventListener('pointerdown', e => { drag = true; line.setPointerCapture(e.pointerId); at(e); });
    line.addEventListener('pointermove', e => { if (drag) at(e); });
    line.addEventListener('pointerup', () => { drag = false; }); })();

  // ───────── Wiederherstellen nach einem Absturz (Windows) ─────────
  async function recoverOrphans(){
    if (!P || !TS.recOrphans) return; let list = []; try { list = J(TS.recOrphans(P.rec.dir)) || []; } catch(_){ return; }
    for (const o of list.filter(x => /^Take/.test(x.name))){
      const take = {id: newId(), n: nextNo(), src: null, dels: [], ev: [], busy: true, at: Date.now()}; P.rec.takes.push(take); renderTakes();
      try { const media = await watchJob(TS.recClose(o.id, '{}')); media.name = o.name; take.src = media; take.busy = false; take.n = +(/(\d+)/.exec(o.name) || [0, take.n])[1] || take.n; take.warn = 'wiederhergestellt'; toast(`${o.name} nach einem Abbruch wiederhergestellt`); }
      catch(e){ P.rec.takes = P.rec.takes.filter(x => x !== take); }
    }
    P.rec.takes.sort((a, b) => a.n - b.n); renderTakes(); saveNow();
  }

  // ───────── Fertig: in HoneyCut öffnen ─────────
  async function finish(){
    if (live) await stopTake();
    const waitBusy = () => new Promise(res => { const w = () => takesOf().some(t => t.busy) || Scr.seg ? setTimeout(w, 300) : res(); w(); });
    if (takesOf().some(t => t.busy)){ toast('Die letzten Takes werden noch gesichert …'); await waitBusy(); }
    if (!readyTakes().length && !(P.rec.fixed || 0)) return toast('Noch nichts aufgenommen');
    stopScreen(); if (M.el) M.el.pause();
    P.rec.done = true; saveNow();
    stopTracks(Dev.cam); stopTracks(Dev.mic);
    try { localStorage.removeItem('hr-draft'); } catch(_){}
    location.href = 'index.html#open=' + encodeURIComponent(P.id);
  }

  // ───────── Startfenster ─────────
  function renderStart(){
    const d = J(localStorage.getItem('hr-draft')) || {};
    $('#newName').value = d.name || `Aufnahme ${new Date().toLocaleDateString('de-DE')}`;
    let sums = []; try { sums = J(TS.listProjects()) || []; } catch(_){}
    sums.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    const recs = [];
    for (const s of sums.slice(0, 40)){ let p = null; try { p = J(TS.loadProject(s.id)); } catch(_){} if (p && p.rec) recs.push(p); if (recs.length >= 6) break; }
    $('#resume').innerHTML = recs.length ? '<p class="resume-h">Weiter aufnehmen</p>' + recs.map(p => `<button class="res-item" data-id="${esc(p.id)}">${esc(p.name)}<span>${p.rec.done ? 'in HoneyCut' : 'offen'} · ${new Date(p.updated).toLocaleDateString('de-DE')}</span></button>`).join('') : '';
    $('#resume').onclick = e => { const b = e.target.closest('[data-id]'); if (!b) return; openSession(b.dataset.id); closeStart(); };
    const notes = [];
    if (!window.MediaRecorder) notes.push('Dieses Gerät kann hier nicht aufnehmen (MediaRecorder fehlt).');
    if (PLAT === 'web') notes.push('Im Browser bleiben die Aufnahmen in diesem Browser gespeichert. Für lange Aufnahmen ist HoneyRec am Computer (Windows) die bessere Wahl.');
    $('#startNote').textContent = notes.join(' ');
  }
  function closeStart(){ $('#startVeil').classList.add('hidden'); if (P && P.script) renderScript(); }
  $('#newGo').onclick = () => { const d = J(localStorage.getItem('hr-draft')) || {}; newSession($('#newName').value); if (d.script && d.name === P.name) P.script = d.script; closeStart(); renderScript(); };
  $('#newName').addEventListener('keydown', e => { if (e.key === 'Enter') $('#newGo').click(); });

  // ───────── Oberfläche verdrahten ─────────
  function renderAll(){ $('#rName').textContent = P ? P.name : ''; renderScript(); renderTakes(); M.list = P && P.rec.media ? P.rec.media.slice() : M.list; renderMedia(); paintRec(); }
  $('#rName').onclick = () => { if (!P) return; const el = $('#rName'); el.contentEditable = 'true'; el.focus(); document.getSelection().selectAllChildren(el); };
  $('#rName').addEventListener('blur', () => { const el = $('#rName'); el.contentEditable = 'false'; const n = el.textContent.trim(); if (P && n && n !== P.name){ P.name = n; save(); } el.textContent = P ? P.name : ''; });
  $('#rName').addEventListener('keydown', e => { if (e.key === 'Enter'){ e.preventDefault(); e.target.blur(); } });
  $('#recBtn').onclick = toggleRec;
  $('#doneBtn').onclick = finish;
  $('#addMedia').onclick = addMedia;
  $('#scrBtn').onclick = startScreen;
  $('#scrStop').onclick = stopScreen;
  $('#mPlay').onclick = mediaPlay; $('#mPrev').onclick = () => page(-1); $('#mNext').onclick = () => page(1); $('#mOff').onclick = hide;
  $('#micDuring').checked = !!SET.micDuring; $('#micDuring').onchange = e => { SET.micDuring = e.target.checked; saveSet(); gate(); };
  $('#mMode').value = SET.mode; $('#mMode').onchange = e => { SET.mode = e.target.value; saveSet(); };
  if (!md || !md.getDisplayMedia) $('#scrBtn').classList.add('hidden');
  // Einstellungen
  $('#setBtn').onclick = () => { $('#setVeil').classList.remove('hidden'); $('#resSel').value = String(SET.res); $('#fpsSel').value = String(SET.fps); $('#nsOn').checked = !!SET.ns; $('#mirrorOn').checked = !!SET.mirror; $('#countOn').checked = !!SET.count;
    const dir = TS.recDir ? TS.recDir(P ? P.rec.dir : '', false) : ''; $('#dirInfo').textContent = dir ? `Die Takes liegen als MP4 in: ${dir}` : PLAT === 'android' ? 'Die Takes liegen im Speicher der App und erscheinen in HoneyCut.' : 'Die Takes liegen im Speicher dieses Browsers.';
    $('#dirOpen').classList.toggle('hidden', !(TS.recDir && PLAT === 'desktop')); fillDevices(); camInfo(); };
  $('#dirOpen').onclick = () => TS.recDir(P ? P.rec.dir : '', true);
  $('#setOk').onclick = () => $('#setVeil').classList.add('hidden');
  const reopen = () => { saveSet(); openDevices(); };
  $('#camSel').onchange = e => { SET.cam = e.target.value; reopen(); };
  $('#micSel').onchange = e => { SET.mic = e.target.value; reopen(); };
  $('#resSel').onchange = e => { SET.res = +e.target.value; reopen(); };
  $('#fpsSel').onchange = e => { SET.fps = +e.target.value; reopen(); };
  $('#nsOn').onchange = e => { SET.ns = e.target.checked; reopen(); };
  $('#mirrorOn').onchange = e => { SET.mirror = e.target.checked; saveSet(); $('#camBox').classList.toggle('mirror', SET.mirror); };
  $('#countOn').onchange = e => { SET.count = e.target.checked; saveSet(); };
  $('#camBox').classList.toggle('mirror', !!SET.mirror);
  // Tastatur: R Aufnahme, K Medium, ←/→ bzw. Bild↑/Bild↓ Präsentation (Presenter), ↑/↓ Skript, S Lauf
  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase(); if (tag === 'textarea' || tag === 'input' && e.target.type !== 'range' && e.target.type !== 'checkbox' || e.target.isContentEditable || tag === 'select') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape'){ if (countT) return cancelCount(); if (!$('#tkVeil').classList.contains('hidden')) return closeTake(); for (const v of ['#skVeil', '#setVeil']) $(v).classList.add('hidden'); return; }
    if (!$('#startVeil').classList.contains('hidden')) return;
    if (!$('#tkVeil').classList.contains('hidden')){
      if (e.key === ' ' || e.key === 'k'){ e.preventDefault(); $('#tkPlay').click(); }
      else if (e.key === 'a') $('#tkA').click(); else if (e.key === 'b') $('#tkB').click();
      else if (e.key === 'ArrowLeft'){ e.preventDefault(); $('#tkV').currentTime -= e.shiftKey ? 5 : 1; } else if (e.key === 'ArrowRight'){ e.preventDefault(); $('#tkV').currentTime += e.shiftKey ? 5 : 1; }
      return;
    }
    const k = e.key;
    if (k === 'r' || k === 'R' || k === 'F9'){ e.preventDefault(); toggleRec(); }
    else if (k === 'k' || k === 'K'){ e.preventDefault(); mediaPlay(); }
    else if (k === 'ArrowRight' || k === 'PageDown'){ e.preventDefault(); page(1); }
    else if (k === 'ArrowLeft' || k === 'PageUp'){ e.preventDefault(); page(-1); }
    else if (k === 'ArrowDown'){ e.preventDefault(); $('#skView').scrollTop += lineH(); }
    else if (k === 'ArrowUp'){ e.preventDefault(); $('#skView').scrollTop -= lineH(); }
    else if (k === 's' || k === 'S'){ e.preventDefault(); setRoll(!roll); }
  });
  addEventListener('beforeunload', e => { if (live){ e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (document.hidden && saveT) saveNow(); });
  if (TS.keepAwake) try { TS.keepAwake(true); } catch(_){}

  paintPromptStyle(); renderStart(); renderScript(); openDevices();
  window.HoneyRec = {get P(){ return P; }, regen, SET};   // für Tests
})();
