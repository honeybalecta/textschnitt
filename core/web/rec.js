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
  const SET = Object.assign({cam: '', mic: '', res: 1080, fps: 30, ns: false, mirror: true, count: true, micDuring: false, facing: '', gainDb: 0, agc: false, mode: 'broll', regie: true, layout: 'medium-pip', corner: 'ur', fmt: '16:9', mouse: true, big: true, docFit: 'page', skSize: 38, skSpeed: 40, skMirror: false, skHide: false},
    J(localStorage.getItem(SET_KEY)) || {});
  const saveSet = () => { try { localStorage.setItem(SET_KEY, JSON.stringify(SET)); } catch(_){} };

  // ───────── Rückmeldungen der Plattform (Dateiauswahl, Zurück-Taste) ─────────
  const pending = new Map();
  window.TSApp = {
    onPicked(id, json){ const cb = pending.get(id); pending.delete(id); if (cb) cb(json ? J(json) : null); },
    onPause(){ saveNow(); },
    onBack(){ for (const v of ['#tkVeil', '#skVeil', '#setVeil']) if (!$(v).classList.contains('hidden')){ $(v).classList.add('hidden'); return true; } return !!live; },
    onOpenFiles(){}, onHandover(){},
    // Foldable: Außenbildschirm an/aus (Android meldet den Stand)
    onRear(st){ paintRear(st); },
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
      if (!t.regie) for (const e of t.ev) if (e.t1 > e.t0 + 0.05 && e.clip) items.push(evItem(e, off, t));   // Bildregie: Medien sind schon im Bild
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
    const vc = {width: {ideal: W}, height: {ideal: H}, frameRate: {ideal: +SET.fps}, ...(SET.facing ? {facingMode: {ideal: SET.facing}} : {})};
    try { Dev.cam = await md.getUserMedia({video: SET.cam ? {...vc, deviceId: {exact: SET.cam}} : vc, audio: false}); }
    catch(e){
      try { Dev.cam = await md.getUserMedia({video: vc, audio: false}); if (SET.cam) toast('Die gewählte Kamera ist nicht verfügbar – die Standardkamera ist aktiv'); }
      catch(e2){ camMsg(e2.name === 'NotAllowedError' ? 'Kein Zugriff auf die Kamera. Bitte den Zugriff erlauben und HoneyRec neu öffnen.' : 'Keine Kamera gefunden. Ist sie angeschlossen und nicht in einem anderen Programm geöffnet?'); log('Kamera: ' + e2.name + ' ' + e2.message); }
    }
    const ac0 = {echoCancellation: false, noiseSuppression: !!SET.ns, autoGainControl: !!SET.agc, sampleRate: {ideal: 48000}, channelCount: {ideal: 2}};
    try { Dev.mic = await md.getUserMedia({audio: SET.mic ? {...ac0, deviceId: {exact: SET.mic}} : ac0, video: false}); }
    catch(e){ try { Dev.mic = await md.getUserMedia({audio: ac0, video: false}); } catch(e2){ toast('Kein Mikrofon verfügbar – aufgenommen wird nur das Bild'); log('Mikrofon: ' + e2.name); } }
    if (Dev.cam){ $('#camV').srcObject = Dev.cam; camMsg(''); }
    meterFrom(Dev.mic); mixInit(); mixMic(); gate();
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
  // Übersteuerung am Eingang: Spitzen am Anschlag, bevor HoneyRec etwas am Ton ändert (Gerät liefert zu heiß)
  const Clip = {hits: [], warned: false, raw: 0};
  const peakOf = an => { if (!an.buf || an.buf.length !== an.fftSize) an.buf = new Float32Array(an.fftSize); an.getFloatTimeDomainData(an.buf); let p = 0; for (const x of an.buf) p = Math.max(p, Math.abs(x)); return p; };
  requestAnimationFrame(function meterLoop(){   // erster Durchlauf erst nach dem Laden (Mischpult steht weiter unten)
    requestAnimationFrame(meterLoop);
    const post = Mix.post || Dev.an, raw = Mix.raw || Dev.an, m = $('#meter'); if (!post) return;
    const ctx = Mix.post ? Mix.ac : Dev.ac; if (!ctx || ctx.state === 'suspended') return;
    const pk = peakOf(post), rp = Clip.raw = peakOf(raw), now = performance.now();
    if (rp >= 0.985 && !mutedNow()){ Clip.hits.push(now); }
    Clip.hits = Clip.hits.filter(t => now - t < 3000);
    const clipping = Clip.hits.length >= 4;
    const db = 20 * Math.log10(pk || 1e-6); peakHold = Math.max(db, peakHold - 0.6);
    m.querySelector('i').style.width = clamp((peakHold + 60) / 60 * 100, 0, 100) + '%';
    m.classList.toggle('hot', peakHold > -3 || clipping);
    const cb = $('#clipBadge'); cb.classList.toggle('hidden', !clipping);
    if (clipping && !Clip.warned){ Clip.warned = true; toast('Der Ton kommt übersteuert an – unter ⚙ den Pegel senken (am besten „Pegel am Gerät“) oder „Pegel einmessen“', 8000); }
  });
  const mutedNow = () => !!(Dev.mic && Dev.mic.getAudioTracks().some(t => !t.enabled));
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
      let R, take;
      if (SET.regie){   // Bildregie: das zusammengesetzte Programmbild, Ton aus Mikrofon und Medium
        const ps = progStream(), [pw, ph] = progSize(), aud = Mix.dest ? Mix.dest.stream.getAudioTracks() : (Dev.mic ? Dev.mic.getAudioTracks() : []);
        if (Mix.ac && Mix.ac.state === 'suspended') await Mix.ac.resume().catch(() => {});
        R = startRecorder(new MediaStream([ps.getVideoTracks()[0], ...aud]), `Take ${pad(n)}`, vbr(Math.min(pw, ph), +SET.fps));
        take = {id: newId(), n, src: null, dels: [], ev: [], at: Date.now(), w: pw, h: ph, regie: {fmt: SET.fmt, lay: [[0, curLayout()]]}};
      } else {
        if (Mix.ac && Mix.ac.state === 'suspended') await Mix.ac.resume().catch(() => {});
        const tracks = [v, ...(Mix.post && Mix.dest ? Mix.dest.stream.getAudioTracks() : Dev.mic ? Dev.mic.getAudioTracks() : [])];
        R = startRecorder(new MediaStream(tracks), `Take ${pad(n)}`, vbr(s.height || +SET.res, s.frameRate || +SET.fps));
        take = {id: newId(), n, src: null, dels: [], ev: [], at: Date.now(), w: s.width, h: s.height};
      }
      P.rec.takes.push(take);
      live = {take, R, open: null};
      document.body.classList.add('live'); paintRec();
      if (M.cur && (M.cur.doc || M.cur.clip.kind === 'image' || (M.el && !M.el.paused))) openEv();   // was schon läuft oder zu sehen ist, gehört ab jetzt dazu
      if (Scr.stream && !take.regie) startScreenSeg();
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
      const s = take.regie ? {width: take.w, height: take.h, frameRate: +SET.fps} : Dev.cam && Dev.cam.getVideoTracks()[0] ? Dev.cam.getVideoTracks()[0].getSettings() : {};
      const media = await finishRecorder(L.R, {duration: t, width: s.width || take.w, height: s.height || take.h, fps: s.frameRate || +SET.fps, mime: L.R.mime, hasAudio: !!(take.regie || (Dev.mic && Dev.mic.getAudioTracks().length))});
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
  async function startScreen(win){
    if (!md || !md.getDisplayMedia) return toast('Hier lässt sich kein Bildschirm aufnehmen – das geht in HoneyRec am Computer');
    if (Scr.stream){ if (win === true) return toast('Es läuft schon eine Bildschirmaufnahme – erst beenden, dann das Browserfenster wählen'); return stopScreen(); }
    try { Scr.stream = await md.getDisplayMedia({video: {frameRate: {ideal: 30}, ...(win === true ? {displaySurface: 'window'} : {})}, audio: false}); }
    catch(e){ if (e.name !== 'NotAllowedError') toast('Bildschirmaufnahme nicht möglich: ' + e.message); return; }
    const tr = Scr.stream.getVideoTracks()[0]; tr.onended = () => stopScreen();
    $('#scrV').srcObject = Scr.stream; $('#scrBox').classList.remove('hidden'); $('#scrBtn').classList.add('on'); $('#scrBtn').textContent = 'Bildschirm beenden';
    $('#scrInfo').textContent = live ? 'Wird gerade mitaufgenommen.' : 'Läuft mit, sobald du aufnimmst.';
    if (SET.regie){   // Bildregie: Der Bildschirm erscheint auf der Medienbühne und kommt so ins Bild
      $('#scrBox').classList.add('hidden');
      const x = {mid: 'scr-' + newId(), screen: true, clip: {name: 'Bildschirm', kind: 'screen'}}; M.list.push(x); show(x, false); return;
    }
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
    const sx = M.list.filter(x => x.screen); if (sx.length){ if (M.cur && M.cur.screen) hide(); M.list = M.list.filter(x => !x.screen); renderMedia(); }
    if (Scr.seg && live){ const seg = Scr.seg; Scr.seg = null; endScreenSeg(seg, live.take, nowT()); }
    stopTracks(Scr.stream); Scr.stream = null; $('#scrV').srcObject = null; $('#scrBox').classList.add('hidden'); $('#scrBtn').classList.remove('on'); $('#scrBtn').textContent = 'Bildschirm mitaufnehmen';
  }

  // ───────── Medien zum Reagieren und Zeigen ─────────
  // Ein Eintrag ist ein Video, eine Tonaufnahme, ein Bild oder eine Bilderreihe (Präsentation, mehrere Bilder auf einmal geladen).
  const M = {list: [], cur: null, page: 0, el: null};
  async function addMedia(){
    const got = await pick('rec'); const list = !got ? [] : Array.isArray(got) ? got : [got]; if (!list.length) return;
    const isDoc = m => m.kind === 'doc' || (window.RecDocs && RecDocs.kindOf(m) && m.kind !== 'video' && m.kind !== 'audio' && m.kind !== 'image');
    const imgs = list.filter(m => m.kind === 'image'), rest = list.filter(m => m.kind !== 'image');
    for (const m of rest) M.list.push(isDoc(m) ? {mid: newId(), clip: {...m, kind: 'doc'}, doc: true, imgs: {}} : {mid: newId(), clip: m, pages: null});
    if (imgs.length > 1) M.list.push({mid: newId(), clip: imgs[0], pages: imgs, name: `Präsentation (${imgs.length} Bilder)`});
    else if (imgs.length) M.list.push({mid: newId(), clip: imgs[0], pages: null});
    renderMedia(); saveMediaList();
    if (!M.cur) show(M.list[M.list.length - 1], false);
  }
  function saveMediaList(){ if (P){ P.rec.media = M.list.filter(x => !x.screen).map(x => ({mid: x.mid, clip: x.clip, pages: x.pages, name: x.name, doc: x.doc, imgs: x.imgs, n: x.n})); save(); } }
  const docLbl = x => { const e = RecDocs.EXT(x.clip.name); return RecDocs.isSlides(x.clip) ? 'Folien' : e === 'pdf' ? 'PDF' : RecDocs.kindOf(x.clip) === 'text' ? 'Text' : 'Dokument'; };
  const kindLbl = x => x.screen ? 'Bildschirm' : x.doc ? docLbl(x) : x.pages ? 'Präsentation' : x.clip.kind === 'image' ? 'Bild' : x.clip.kind === 'audio' || x.clip.hasVideo === false ? 'Ton' : 'Video';
  function renderMedia(){
    const box = $('#mList'); box.innerHTML = '';
    for (const x of M.list){
      const b = document.createElement('div'); b.className = 'mitem' + (M.cur === x ? ' on' : ''); b.tabIndex = 0; b.title = x.name || x.clip.name;
      const k = kindLbl(x), au = k === 'Ton';
      b.innerHTML = (x.screen ? '<div class="au doc">▣</div>' : x.doc ? `<div class="au doc">${esc(k)}</div>` : au ? '<div class="au">♪</div>' : x.clip.kind === 'image' ? `<img src="${esc(MEDIA(x.clip.uri))}" alt="">` : `<video preload="metadata" muted src="${esc(MEDIA(x.clip.uri))}#t=1"></video>`)
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
  function hide(){ if (M.el && !M.el.paused) M.el.pause(); closeEv(live, nowT()); M.cur = null; M.el = null; $('#stage').classList.remove('docmode'); $('#stageOn').innerHTML = ''; $('#stageOn').classList.add('hidden'); $('#stageCtl').classList.add('hidden'); renderMedia(); gate(); }
  const curClip = () => M.cur ? (M.cur.doc ? (M.cur.imgs || {})[M.page] || null : M.cur.pages ? M.cur.pages[M.page] : M.cur.clip) : null;
  function paintStage(play){
    const x = M.cur, on = $('#stageOn'); on.innerHTML = ''; on.classList.remove('hidden'); $('#stageCtl').classList.remove('hidden');
    if (x.doc) return paintDoc(x);
    if (x.screen){   // laufende Bildschirmaufnahme als Inhalt der Bühne
      $('#stage').classList.remove('docmode'); for (const id of ['#mPrev', '#mNext', '#mPlay', '#mSeek', '#mFit']) $(id).classList.add('hidden');
      const v = document.createElement('video'); v.muted = true; v.autoplay = true; v.playsInline = true; v.srcObject = Scr.stream; on.append(v); v.play().catch(() => {});
      M.el = null; $('#mTime').textContent = 'Bildschirm'; gate(); return;
    }
    $('#mFit').classList.add('hidden');
    const c = curClip();
    const img = c.kind === 'image', au = !img && (c.kind === 'audio' || c.hasVideo === false);
    $('#mPrev').classList.toggle('hidden', !x.pages); $('#mNext').classList.toggle('hidden', !x.pages); $('#stage').classList.remove('docmode');
    $('#mPlay').classList.toggle('hidden', img); $('#mSeek').classList.toggle('hidden', img);
    M.el = null;
    if (img){ const im = new Image(); im.src = MEDIA(c.uri); on.append(im); $('#mTime').textContent = x.pages ? `Bild ${M.page + 1} von ${x.pages.length}` : 'Bild'; if (live) openEv(); gate(); return; }
    const el = document.createElement(au ? 'audio' : 'video'); el.src = MEDIA(c.uri); el.playsInline = true; el.preload = 'auto';
    if (au){ const card = document.createElement('div'); card.className = 'audio-card'; card.innerHTML = `<b>♪</b><span>${esc(c.name || 'Ton')}</span>`; on.append(card); }
    on.append(el); M.el = el; if (SET.regie) mixMedia(el);
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
  // ── Dokumente: PDF, Text, Word, PowerPoint (rec-docs.js) ──
  const docs = new Map();   // mid → Promise<Dokument>
  let docNoted = false;
  function ensureDoc(x){
    if (!docs.has(x.mid)) docs.set(x.mid, RecDocs.load(x.clip, MEDIA, {
      convert: TS.recConvert ? m => watchJob(TS.recConvert(m.uri), j => { if (M.cur === x && j.message) $('#mTime').textContent = j.message; }) : null,
      onConvertFail: e => toast(e.message, 7000),
    }).then(d => { x.n = d.n; saveMediaList(); return d; }, e => { docs.delete(x.mid); throw e; }));
    return docs.get(x.mid);
  }
  async function paintDoc(x){
    const on = $('#stageOn'), st = $('#stage'); st.classList.add('docmode');
    $('#mPlay').classList.add('hidden'); $('#mSeek').classList.add('hidden'); $('#mFit').classList.remove('hidden');
    $('#mFit').textContent = SET.docFit === 'width' ? 'Ganze Seite' : 'Volle Breite';
    const keep = on.querySelector('.docwrap'), top0 = keep && keep.dataset.k === x.mid + ':' + M.page ? keep.scrollTop : 0;
    on.innerHTML = '<div class="docwrap"><div class="docin"><canvas></canvas><div class="links"></div></div></div>';
    $('#mTime').textContent = 'Wird geladen …'; gate();
    let d; try { d = await ensureDoc(x); } catch(e){ if (M.cur === x){ on.innerHTML = `<p class="doc-err">${esc(e.message || 'Das Dokument ließ sich nicht öffnen')}</p>`; $('#mTime').textContent = ''; } return; }
    if (M.cur !== x) return;
    if (d.note && !docNoted){ docNoted = true; toast(PLAT === 'desktop' ? 'Vereinfachte Ansicht (nur Text). Mit Microsoft Office oder LibreOffice auf dem Rechner zeigt HoneyRec das Original.' : 'Vereinfachte Ansicht (nur Text). Für das Original die Datei als PDF speichern.', 7000); }
    const pg = M.page = clamp(M.page, 0, d.n - 1), many = d.n > 1;
    $('#mPrev').classList.toggle('hidden', !many); $('#mNext').classList.toggle('hidden', !many);
    $('#mTime').textContent = `${RecDocs.isSlides(x.clip) ? 'Folie' : 'Seite'} ${pg + 1} von ${d.n}` + (d.note ? ' · vereinfacht' : '');
    const wrap = on.querySelector('.docwrap'), inn = wrap.querySelector('.docin'), cv = inn.querySelector('canvas'), dpr = Math.min(2, devicePixelRatio || 1);
    wrap.dataset.k = x.mid + ':' + pg;
    // Ganze Seite: eingepasst. Volle Breite: so breit wie die Bühne, nach unten scrollen (zum Lesen kleiner Schrift)
    const W = Math.max(50, wrap.clientWidth), H0 = Math.max(50, on.clientHeight);
    let H = H0; if (SET.docFit === 'width'){ const [pw, ph] = await d.size(pg); H = Math.max(H0, Math.round(W * ph / pw)); }
    inn.style.width = W + 'px'; inn.style.height = H + 'px'; cv.style.width = W + 'px'; cv.style.height = H + 'px';
    if (live) openEv();
    const r = await d.draw(pg, cv, Math.round(W * dpr), Math.round(H * dpr), '#000'); if (!r || M.cur !== x || M.page !== pg) return;
    cv._r = {x: r.x / dpr, y: r.y / dpr, w: r.w / dpr, h: r.h / dpr};   // Lage der Seite in der Leinwand (CSS-Pixel), für das Programmbild
    if (top0) wrap.scrollTop = top0;
    const box = inn.querySelector('.links'); box.innerHTML = '';
    let ls = []; try { ls = await d.links(pg); } catch(e){ log('Links: ' + e.message); }
    for (const l of ls){
      const a = document.createElement('a'); a.href = '#'; a.className = 'doclink'; a.title = l.url || `Zu Seite ${l.page + 1}`;
      a.style.cssText = `left:${cv._r.x + l.r[0] * cv._r.w}px;top:${cv._r.y + l.r[1] * cv._r.h}px;width:${l.r[2] * cv._r.w}px;height:${l.r[3] * cv._r.h}px`;
      a.onclick = e => { e.preventDefault(); if (l.url) openBrowser(l.url); else if (l.page != null){ page(l.page - M.page); } };
      box.append(a);
    }
    hiPage(x, pg).catch(() => {});                                            // scharfe Fassung für das Programmbild
    if (!(x.imgs || {})[pg]) pageImage(x, pg).catch(() => {});   // Bild der Seite für das Projekt schon vorbereiten
  }
  // Seite scharf in 1920×1080 eingepasst (nur im Speicher): für das Programmbild und als Bild im Projekt
  const hiCache = new Map();
  function hiPage(x, i){
    const key = x.mid + ':' + i; if (hiCache.has(key)) return hiCache.get(key);
    const pr = (async () => { const d = await ensureDoc(x), [pw, ph] = await d.size(i), sc = Math.min(1920 / pw, 1080 / ph), W = Math.round(pw * sc), H = Math.round(ph * sc);
      const cv = document.createElement('canvas'); await d.draw(i, cv, W, H, '#fff'); return cv; })();
    hiCache.set(key, pr); pr.then(cv => { x.hiCv ||= {}; x.hiCv[i] = cv; }, () => hiCache.delete(key)); return pr;
  }
  // Seite als Bild ablegen (für die Einblendung im Projekt): eingepasst in 1920×1080, ohne Rand
  const imgBusy = new Map();
  function pageImage(x, i){
    x.imgs ||= {}; if (x.imgs[i]) return Promise.resolve(x.imgs[i]);
    const key = x.mid + ':' + i; if (imgBusy.has(key)) return imgBusy.get(key);
    const pr = (async () => {
      const cv = await hiPage(x, i), W = cv.width, H = cv.height;
      const stem = String(x.clip.name || 'Dokument').replace(/\.[^.]+$/, '').replace(/[^\w\-]+/g, '_').slice(0, 40);
      const m = J(TS.saveImage(`${stem}-${pad(i + 1)}-${x.mid}.png`, cv.toDataURL('image/png'), W, H, P ? P.id : 'honeyrec'));
      if (!m || !m.uri) throw new Error('Seitenbild ließ sich nicht speichern');
      m.name = `${x.clip.name} · ${RecDocs.isSlides(x.clip) ? 'Folie' : 'Seite'} ${i + 1}`;
      x.imgs[i] = m; saveMediaList(); return m;
    })();
    imgBusy.set(key, pr); pr.finally(() => imgBusy.delete(key)); return pr;
  }
  addEventListener('resize', () => { if (M.cur && M.cur.doc){ clearTimeout(paintDoc.t); paintDoc.t = setTimeout(() => { if (M.cur && M.cur.doc) paintDoc(M.cur); }, 200); } });

  // ───────── Bildregie: Kamera und Medienbühne live zu einem Bild ─────────
  // Die Medienbühne wird wie ein eigenes Fenster behandelt: Was darin zu sehen ist (Video, Bild, Dokument, Bildschirm), samt
  // Mauszeiger, landet im Programmbild – in der gewählten Anordnung. Aufgenommen wird dieses Programmbild (Leinwand) mit dem Ton
  // aus Mikrofon und Medium. Ohne Medium auf der Bühne zeigt das Programm nur die Kamera.
  const LAYOUTS = [
    {id: 'ich', label: 'Nur ich', h: [[0, 0, 1, 1, 'c']]},
    {id: 'medium-pip', label: 'Medium, ich klein', h: [[0, 0, 1, 1, 'm'], ['pip', 'c']]},
    {id: 'ich-pip', label: 'Ich, Medium klein', h: [[0, 0, 1, 1, 'c'], ['pip', 'm']]},
    {id: 'neben', label: 'Nebeneinander', h: [[0, 0, .5, 1, 'm'], [.5, 0, .5, 1, 'c']]},
    {id: 'neben-gross', label: 'Medium ⅔, ich ⅓', h: [[0, 0, 2 / 3, 1, 'm'], [2 / 3, 0, 1 / 3, 1, 'c']]},
    {id: 'medium', label: 'Nur Medium', h: [[0, 0, 1, 1, 'm']]},
  ];
  const vert = () => SET.fmt === '9:16';
  const progSize = () => { const s = Math.min(1080, +SET.res || 1080), l = Math.round(s * 16 / 9 / 2) * 2; return vert() ? [s, l] : [l, s]; };
  const stageShown = () => !!(M.cur && !$('#stageOn').classList.contains('hidden'));
  const curLayout = () => stageShown() ? SET.layout : 'ich';
  // Bereiche des Programmbilds: [x, y, w, h] in Anteilen; 9:16 legt „nebeneinander“ untereinander
  function regions(id){
    const L = LAYOUTS.find(l => l.id === id) || LAYOUTS[0], [W, H] = progSize(), out = [];
    for (const r of L.h){
      if (r[0] === 'pip'){ const big = r[1] === 'm', w = vert() ? (big ? .62 : .42) : (big ? .36 : .28), ar = r[1] === 'c' ? camAr() : (vert() ? 16 / 9 : 16 / 9);
        const pw = w * W, ph = Math.min(H * .45, pw / ar), m = .03 * Math.min(W, H), c = SET.corner || 'ur';
        out.push({x: c[1] === 'l' ? m : W - m - pw, y: c[0] === 'u' ? m : H - m - ph, w: pw, h: ph, what: r[1], pip: true}); continue; }
      let [x, y, w, h, what] = r; if (vert() && w < 1){ [x, y, w, h] = [y, x, h, w]; }
      out.push({x: x * W, y: y * H, w: w * W, h: h * H, what});
    }
    return out;
  }
  const camAr = () => { const v = $('#camV'); return v.videoWidth ? v.videoWidth / v.videoHeight : 16 / 9; };
  // Fenster der Bühne zeichnen (so, wie es auf dem Bildschirm zu sehen ist), Mauszeiger obenauf
  const WIN = document.createElement('canvas'), Mouse = {in: false, x: 0, y: 0, down: 0};
  function renderWin(){
    const on = $('#stageOn'); if (!stageShown()) return null;
    const box = on.getBoundingClientRect(); if (box.width < 20 || box.height < 20) return null;
    const S = Math.min(1920 / box.width, 1920 / box.height), W = Math.round(box.width * S), H = Math.round(box.height * S);
    if (WIN.width !== W || WIN.height !== H){ WIN.width = W; WIN.height = H; }
    const g = WIN.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
    const rel = r => [(r.left - box.left) * S, (r.top - box.top) * S, r.width * S, r.height * S];
    for (const el of on.querySelectorAll('video, img, canvas')){
      const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
      let [dx, dy, dw, dh] = rel(r);
      try {
        if (el.tagName === 'CANVAS'){
          const hi = M.cur && M.cur.hiCv && M.cur.hiCv[M.page], pr = el._r;
          if (hi && pr){ const k = r.width / parseFloat(el.style.width || r.width); g.drawImage(hi, dx + pr.x * k * S, dy + pr.y * k * S, pr.w * k * S, pr.h * k * S); }
          else if (el.width) g.drawImage(el, dx, dy, dw, dh);
          continue;
        }
        const iw = el.videoWidth || el.naturalWidth, ih = el.videoHeight || el.naturalHeight; if (!iw || !ih) continue;
        const sc = Math.min(dw / iw, dh / ih), w = iw * sc, h = ih * sc; g.drawImage(el, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h);
      } catch(_){}
    }
    const card = on.querySelector('.audio-card'); if (card){ g.fillStyle = '#E5402A'; g.font = `800 ${Math.round(H * .14)}px Inter, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('♪', W / 2, H * .42);
      g.fillStyle = '#CFC6B0'; g.font = `500 ${Math.round(H * .05)}px Inter, sans-serif`; g.fillText(card.textContent.replace('♪', '').trim().slice(0, 60), W / 2, H * .6); }
    if (SET.mouse && Mouse.in) drawCursor(g, Mouse.x * S, Mouse.y * S, Math.max(1, W / 1100));
    return WIN;
  }
  function drawCursor(g, x, y, k){
    const age = performance.now() - Mouse.down;
    if (age < 450){ g.beginPath(); g.arc(x, y, (14 + age / 14) * k, 0, Math.PI * 2); g.fillStyle = `rgba(229,64,42,${.45 * (1 - age / 450)})`; g.fill(); }
    g.save(); g.translate(x, y); g.scale(k * 1.25, k * 1.25);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, 17); g.lineTo(4.2, 13.2); g.lineTo(7.2, 19.6); g.lineTo(9.8, 18.4); g.lineTo(6.9, 12.2); g.lineTo(12.3, 12.2); g.closePath();
    g.fillStyle = '#fff'; g.fill(); g.lineWidth = 1.3; g.strokeStyle = '#131312'; g.stroke(); g.restore();
  }
  // In einen Bereich zeichnen: einpassen (Medium, Rand in Anthrazit) oder füllen (Kamera, mittig beschnitten)
  function fitInto(g, src, sw, sh, r, cover){
    const sc = cover ? Math.max(r.w / sw, r.h / sh) : Math.min(r.w / sw, r.h / sh), w = sw * sc, h = sh * sc;
    g.save(); g.beginPath(); if (r.pip && g.roundRect) g.roundRect(r.x, r.y, r.w, r.h, Math.min(r.w, r.h) * .05); else g.rect(r.x, r.y, r.w, r.h); g.clip();
    if (!cover){ g.fillStyle = '#131312'; g.fillRect(r.x, r.y, r.w, r.h); }
    g.drawImage(src, r.x + (r.w - w) / 2, r.y + (r.h - h) / 2, w, h); g.restore();
    if (r.pip){ g.save(); g.lineWidth = Math.max(2, r.w * .008); g.strokeStyle = 'rgba(237,231,218,.85)'; g.beginPath(); if (g.roundRect) g.roundRect(r.x, r.y, r.w, r.h, Math.min(r.w, r.h) * .05); else g.rect(r.x, r.y, r.w, r.h); g.stroke(); g.restore(); }
  }
  const Prog = {cv: $('#progCv'), stream: null, timer: 0};
  function drawProg(){
    const cv = Prog.cv, [W, H] = progSize(); if (cv.width !== W || cv.height !== H){ cv.width = W; cv.height = H; }
    const g = cv.getContext('2d'); g.fillStyle = '#131312'; g.fillRect(0, 0, W, H);
    const cam = $('#camV'), win = renderWin(), lay = win ? SET.layout : 'ich';
    for (const r of regions(lay)){
      if (r.what === 'c'){ if (cam.videoWidth) fitInto(g, cam, cam.videoWidth, cam.videoHeight, r, true); }
      else if (win) fitInto(g, win, win.width, win.height, r, false);
    }
  }
  function progStream(){ if (!Prog.stream) Prog.stream = Prog.cv.captureStream(+SET.fps || 30); return Prog.stream; }
  function regieLoop(){ clearInterval(Prog.timer); Prog.timer = 0; if (SET.regie) Prog.timer = setInterval(drawProg, 1000 / (+SET.fps > 30 ? 30 : +SET.fps || 30)); }
  // Ton fürs Programm: Mikrofon (stumm, solange ein Medium mit Ton läuft) und Ton des Mediums
  const Mix = {ac: null, dest: null, mic: null};
  function mixInit(){ if (Mix.ac) return; try { Mix.ac = new (window.AudioContext || window.webkitAudioContext)({sampleRate: 48000}); Mix.dest = Mix.ac.createMediaStreamDestination(); } catch(e){ Mix.ac = null; log('Mischpult: ' + e.message); } }
  // Mikrofon: Eingang → Pegel (dB, einstellbar) → weiche Begrenzung kurz vor 0 dB → Aufnahme. Gilt mit und ohne Bildregie.
  const dbLin = d => Math.pow(10, d / 20);
  const softCurve = (() => { const n = 4096, c = new Float32Array(n); for (let i = 0; i < n; i++){ const x = i / (n - 1) * 2 - 1, a = Math.abs(x), k = 0.75;
    c[i] = Math.sign(x) * (a <= k ? a : k + (0.93 - k) * Math.tanh((a - k) / (0.93 - k))); } return c; })();
  function mixMic(){ if (!Mix.ac) return; for (const n of ['mic', 'gain', 'lim']) try { if (Mix[n]) Mix[n].disconnect(); } catch(_){} Mix.mic = Mix.gain = Mix.lim = Mix.raw = Mix.post = null;
    if (!(Dev.mic && Dev.mic.getAudioTracks().length)) return;
    try {
      const ac = Mix.ac; Mix.mic = ac.createMediaStreamSource(Dev.mic);
      Mix.raw = ac.createAnalyser(); Mix.raw.fftSize = 2048; Mix.mic.connect(Mix.raw);
      Mix.gain = ac.createGain(); Mix.gain.gain.value = dbLin(+SET.gainDb || 0);
      Mix.lim = ac.createWaveShaper(); Mix.lim.curve = softCurve; Mix.lim.oversample = 'none';   // ohne Überabtastung: Spitzen bleiben sicher unter 0,93
      Mix.post = ac.createAnalyser(); Mix.post.fftSize = 2048;
      Mix.mic.connect(Mix.gain); Mix.gain.connect(Mix.lim); Mix.lim.connect(Mix.dest); Mix.lim.connect(Mix.post);
    } catch(e){ log('Mikrofon ins Programm: ' + e.message); Mix.raw = Mix.post = null; } }
  function setGain(d){ SET.gainDb = clamp(Math.round(d), -30, 12); saveSet(); if (Mix.gain) Mix.gain.gain.setTargetAtTime(dbLin(SET.gainDb), Mix.ac.currentTime, 0.02); paintLevel(); }
  function mixMedia(el){ mixInit(); if (!Mix.ac) return; try { const n = Mix.ac.createMediaElementSource(el); n.connect(Mix.dest); n.connect(Mix.ac.destination); } catch(e){ log('Medium ins Programm: ' + e.message); } }
  const wake = () => { if (Mix.ac && Mix.ac.state === 'suspended') Mix.ac.resume().catch(() => {}); };
  document.addEventListener('pointerdown', wake, true); document.addEventListener('keydown', wake, true);
  // Bedienung
  const layIcon = id => { const vh = vert(), W = vh ? 18 : 40, H = vh ? 32 : 24; const sv = n => n.toFixed(1);
    const pr = SET.fmt; SET.fmt = vh ? '9:16' : '16:9'; const [PW, PH] = progSize(); const rs = regions(id).map(r => `<rect x="${sv(r.x / PW * W)}" y="${sv(r.y / PH * H)}" width="${sv(r.w / PW * W)}" height="${sv(r.h / PH * H)}" rx="${r.pip ? 1.5 : 0}" fill="${r.what === 'c' ? '#E5402A' : '#CFC6B0'}" stroke="#131312" stroke-width=".8"/>`).join(''); SET.fmt = pr;
    return `<svg viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#30302C"/>${rs}</svg>`; };
  function paintRegie(){
    document.body.classList.toggle('mode-regie', !!SET.regie); document.body.classList.toggle('fmt-v', vert());
    $('#regie').classList.toggle('hidden', !SET.regie); Prog.cv.classList.toggle('hidden', !SET.regie);
    $('#camBox').classList.toggle('mirror', !!SET.mirror && !SET.regie);
    $('#lays').innerHTML = LAYOUTS.map((l, k) => `<button class="lay${SET.layout === l.id ? ' on' : ''}" data-l="${l.id}" title="${l.label} (Taste ${k + 1})">${layIcon(l.id)}<span>${l.label}</span></button>`).join('');
    $('#corner').value = SET.corner; $('#mouseOn').checked = !!SET.mouse;
    $('#mModeWrap') && $('#mModeWrap').classList.toggle('hidden', !!SET.regie);
  }
  function setLayout(id){ if (!LAYOUTS.some(l => l.id === id)) return; SET.layout = id; saveSet(); paintRegie();
    if (live && live.take.regie) live.take.regie.lay.push([r3(nowT()), id]);
    if (!stageShown() && id !== 'ich') toast('Die Anordnung gilt, sobald ein Medium auf der Bühne ist'); }
  $('#lays').onclick = e => { const b = e.target.closest('[data-l]'); if (b) setLayout(b.dataset.l); };
  $('#corner').onchange = e => { SET.corner = e.target.value; saveSet(); paintRegie(); };
  $('#mouseOn').onchange = e => { SET.mouse = e.target.checked; saveSet(); };
  (() => { const on = $('#stageOn');   // Mauszeiger über der Bühne
    const at = e => { const b = on.getBoundingClientRect(); Mouse.x = e.clientX - b.left; Mouse.y = e.clientY - b.top; Mouse.in = Mouse.x >= 0 && Mouse.y >= 0 && Mouse.x <= b.width && Mouse.y <= b.height; };
    on.addEventListener('pointermove', at, true); on.addEventListener('pointerdown', e => { at(e); Mouse.down = performance.now(); }, true);
    on.addEventListener('pointerleave', () => { Mouse.in = false; });
    on.addEventListener('scroll', () => {}, true); })();
  // Große Bühne, Vollbild, Dokument einpassen
  function paintBig(){ document.body.classList.toggle('bigstage', !!SET.big); $('#mBig').classList.toggle('on', !!SET.big); requestAnimationFrame(fitPrompt); }
  $('#mBig').onclick = () => { SET.big = !SET.big; saveSet(); paintBig(); if (M.cur && M.cur.doc) setTimeout(() => paintDoc(M.cur), 60); };
  $('#mFull').onclick = () => { const st = $('#stage'); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else if (st.requestFullscreen) st.requestFullscreen().catch(e => toast('Vollbild nicht möglich: ' + e.message)); };
  document.addEventListener('fullscreenchange', () => { $('#mFull').textContent = document.fullscreenElement ? 'Vollbild beenden' : 'Vollbild'; if (M.cur && M.cur.doc) setTimeout(() => paintDoc(M.cur), 120); });
  $('#mFit').onclick = () => { SET.docFit = SET.docFit === 'width' ? 'page' : 'width'; saveSet(); if (M.cur && M.cur.doc) paintDoc(M.cur); };

  // ── Eingebauter Browser: Windows eigenes Fenster „HoneyRec – Browser“, Android eingeblendeter Browser, sonst neuer Tab ──
  function normUrl(u){
    u = String(u || '').trim(); if (!u) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return u;
    if (/^[^\s]+\.[^\s]{2,}(\/|$)/.test(u)) return 'https://' + u;
    return 'https://duckduckgo.com/?q=' + encodeURIComponent(u);
  }
  function browserCall(action, url){ if (!TS.recBrowser) return null; try { return J(TS.recBrowser(action, url || '')); } catch(_){ return null; } }
  function openBrowser(url){
    url = normUrl(url); if (!url) return;
    if (!/^https?:/i.test(url)) return toast('Diese Adresse lässt sich hier nicht öffnen');
    const r = browserCall('open', url);
    $('#brBar').classList.remove('hidden'); $('#brUrl').value = url; $('#brBtn').classList.add('on');
    if (!r || !r.ok){ window.open(url, '_blank', 'noopener'); return; }
  }
  $('#brBtn').onclick = () => { const bar = $('#brBar'), on = bar.classList.toggle('hidden'); $('#brBtn').classList.toggle('on', !on); if (!on) setTimeout(() => $('#brUrl').focus(), 30); };
  $('#brGo').onclick = () => openBrowser($('#brUrl').value);
  $('#brUrl').addEventListener('keydown', e => { if (e.key === 'Enter') openBrowser($('#brUrl').value); });
  for (const [id, act] of [['#brBack', 'back'], ['#brFwd', 'forward'], ['#brReload', 'reload']]) $(id).onclick = () => { const r = browserCall(act); if (r && r.url) $('#brUrl').value = r.url; };
  $('#brClose').onclick = () => { browserCall('close'); $('#brBar').classList.add('hidden'); $('#brBtn').classList.remove('on'); };
  $('#brRec').onclick = () => { toast('Im Auswahlfenster „HoneyRec – Browser“ wählen', 5000); startScreen(true); };
  if (PLAT !== 'desktop') $('#brRec').classList.add('hidden');
  if (!TS.recBrowser) for (const id of ['#brBack', '#brFwd', '#brReload']) $(id).classList.add('hidden');   // Browser-Fassung: Seiten öffnen sich in einem neuen Tab

  function paintPlay(){ $('#mPlay').textContent = M.el && !M.el.paused ? '❚❚' : '▶'; $('#stage').classList.toggle('playing', !!(M.el && !M.el.paused)); }
  function paintTime(){ const el = M.el; if (!el) return; const d = el.duration || 0; $('#mTime').textContent = `${fmt(el.currentTime)} / ${fmt(d)}`; if (!seekDrag) $('#mSeek').value = d ? Math.round(el.currentTime / d * 1000) : 0; }
  let seekDrag = false;
  $('#mSeek').addEventListener('pointerdown', () => { seekDrag = true; });
  $('#mSeek').addEventListener('input', () => { const el = M.el; if (el && el.duration) el.currentTime = $('#mSeek').value / 1000 * el.duration; });
  $('#mSeek').addEventListener('change', () => { seekDrag = false; });
  function mediaPlay(){ if (!M.el) return; if (M.el.paused) M.el.play().catch(e => toast('Abspielen nicht möglich: ' + e.message)); else M.el.pause(); }
  function page(d){ const x = M.cur; if (!x){ return; }
    if (x.doc){ if (!x.n) return; const n = clamp(M.page + d, 0, x.n - 1); if (n === M.page) return; closeEv(live, nowT()); M.page = n; paintDoc(x); return; }
    if (!x.pages){ if (M.el) M.el.currentTime = clamp(M.el.currentTime + d * 5, 0, M.el.duration || 0); return; }
    const n = clamp(M.page + d, 0, x.pages.length - 1); if (n === M.page) return; closeEv(live, nowT()); M.page = n; paintStage(false); }
  // Ereignisse: Beginn und Ende dessen, was während eines Takes zu sehen bzw. zu hören war
  function openEv(){
    if (!live || !M.cur) return; closeEv(live, nowT());
    const x = M.cur, c = curClip(), e = live.open = {id: newId(), k: 'm', mid: x.mid, clip: c, t0: r3(nowT()), in: !c || c.kind === 'image' ? 0 : r3(M.el ? M.el.currentTime : 0), mode: SET.mode};
    if (x.doc && !c){ e.page = M.page; pageImage(x, M.page).then(m => { e.clip = m; save(); }).catch(err => log('Seitenbild: ' + err.message)); }
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
  $('#scrBtn').onclick = () => startScreen();
  $('#scrStop').onclick = stopScreen;
  $('#mPlay').onclick = mediaPlay; $('#mPrev').onclick = () => page(-1); $('#mNext').onclick = () => page(1); $('#mOff').onclick = hide;
  $('#micDuring').checked = !!SET.micDuring; $('#micDuring').onchange = e => { SET.micDuring = e.target.checked; saveSet(); gate(); };
  $('#mMode').value = SET.mode; $('#mMode').onchange = e => { SET.mode = e.target.value; saveSet(); };
  if (!md || !md.getDisplayMedia) $('#scrBtn').classList.add('hidden');
  // Einstellungen
  $('#setBtn').onclick = () => { $('#setVeil').classList.remove('hidden'); $('#resSel').value = String(SET.res); $('#fpsSel').value = String(SET.fps); $('#nsOn').checked = !!SET.ns; $('#mirrorOn').checked = !!SET.mirror; $('#countOn').checked = !!SET.count;
    const dir = TS.recDir ? TS.recDir(P ? P.rec.dir : '', false) : ''; $('#dirInfo').textContent = dir ? `Die Takes liegen als MP4 in: ${dir}` : PLAT === 'android' ? 'Die Takes liegen im Speicher der App und erscheinen in HoneyCut.' : 'Die Takes liegen im Speicher dieses Browsers.';
    $('#dirOpen').classList.toggle('hidden', !(TS.recDir && PLAT === 'desktop')); paintLevel(); $('#lvlInfo').textContent = ''; readDevVol(); $('#regieOn').checked = !!SET.regie; $('#fmtSel').value = SET.fmt; fillDevices(); camInfo(); };
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
  // Pegel: am Gerät (Windows), in HoneyRec, automatisch, einmessen
  function paintLevel(){ $('#gainSl').value = SET.gainDb; $('#gainVal').textContent = (SET.gainDb > 0 ? '+' : '') + SET.gainDb + ' dB'; $('#agcOn').checked = !!SET.agc; }
  const micLabel = () => { const t = Dev.mic && Dev.mic.getAudioTracks()[0]; return t ? t.label : ''; };
  let devVol = null;
  async function readDevVol(){
    $('#devVolWrap').classList.add('hidden'); devVol = null;
    if (!TS.recMicVol || !micLabel()) return;
    try { const r = J(await TS.recMicVol(micLabel(), -1)); if (r && r.found){ devVol = r.volume; $('#devVol').value = r.volume; $('#devVolVal').textContent = r.volume + ' %'; $('#devVolWrap').classList.remove('hidden'); } } catch(_){}
  }
  async function setDevVol(v){ if (!TS.recMicVol) return null; try { const r = J(await TS.recMicVol(micLabel(), v)); if (r && r.found){ devVol = r.volume; $('#devVol').value = r.volume; $('#devVolVal').textContent = r.volume + ' %'; return r; } } catch(_){} return null; }
  $('#devVol').oninput = e => { $('#devVolVal').textContent = e.target.value + ' %'; };
  $('#devVol').onchange = e => setDevVol(+e.target.value);
  $('#gainSl').oninput = e => setGain(+e.target.value);
  $('#agcOn').onchange = e => { SET.agc = e.target.checked; saveSet(); openDevices().then(readDevVol); };
  $('#meter').onclick = () => $('#setBtn').click();
  $('#lvlCheck').onclick = async () => {
    if (!Mix.raw) return toast('Kein Mikrofon gefunden');
    wake(); const b = $('#lvlCheck'), info = $('#lvlInfo'); b.disabled = true; info.textContent = 'Bitte 5 Sekunden in normaler Lautstärke sprechen …';
    const pk = [], t0 = performance.now(); while (performance.now() - t0 < 5000){ pk.push(peakOf(Mix.raw)); await new Promise(r => setTimeout(r, 40)); }
    b.disabled = false; const s = pk.slice().sort((a, c) => a - c), p = s[Math.floor(s.length * 0.97)], over = pk.filter(x => x >= 0.985).length / pk.length;
    if (p < 0.01){ info.textContent = 'Kaum Ton – ist das richtige Mikrofon gewählt?'; return; }
    if (over > 0.02){
      if (devVol != null && devVol > 5){ const nv = Math.max(5, Math.round(devVol * 0.5)), old = devVol; const r = await setDevVol(nv);
        info.textContent = r ? `Übersteuert schon am Eingang – Pegel am Gerät von ${old} auf ${r.volume} % gesenkt. Bitte noch einmal einmessen.` : 'Übersteuert schon am Eingang – bitte den Pegel am Gerät senken.'; }
      else info.textContent = 'Übersteuert schon am Eingang. Bitte die Verstärkung am Mikrofon bzw. in der Kamera senken oder „Pegel automatisch anpassen“ einschalten.';
      return;
    }
    setGain(20 * Math.log10(dbLin(-9) / p)); Clip.hits = []; Clip.warned = false;
    info.textContent = `Passt: Pegel in HoneyRec auf ${(SET.gainDb > 0 ? '+' : '') + SET.gainDb} dB gesetzt (Spitzen um −9 dB).`;
  };
  $('#regieOn').onchange = e => { if (live){ e.target.checked = !!SET.regie; return toast('Während der Aufnahme lässt sich die Bildregie nicht umschalten'); }
    SET.regie = e.target.checked; saveSet(); mixInit(); mixMic(); paintRegie(); regieLoop(); if (M.cur && !M.cur.doc && !M.cur.screen) paintStage(false); };
  $('#fmtSel').onchange = e => { if (live){ e.target.value = SET.fmt; return toast('Während der Aufnahme bleibt das Format'); } SET.fmt = e.target.value; saveSet(); paintRegie(); };
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
    else if (SET.regie && /^[1-6]$/.test(k)){ e.preventDefault(); setLayout(LAYOUTS[+k - 1].id); }
  });
  addEventListener('beforeunload', e => { if (live){ e.preventDefault(); e.returnValue = ''; } });
  document.addEventListener('visibilitychange', () => { if (document.hidden && saveT) saveNow(); });
  if (TS.keepAwake) try { TS.keepAwake(true); } catch(_){}

  paintPromptStyle(); paintRegie(); paintBig(); regieLoop(); renderStart(); renderScript(); openDevices();
  // ───────── Foldables im Buchformat: Bedienung auf dem Außenbildschirm, Aufnahme mit der Hauptkamera ─────────
  let rearPrev = null;
  function paintRear(st){
    st = st || {}; const b = $('#rearBtn'), ok = st.status === 'available' || st.status === 'active', on = st.status === 'active';
    b.classList.toggle('hidden', !ok); b.textContent = on ? 'Innenbildschirm' : 'Außenbildschirm'; b.classList.toggle('on', on);
    if (st.error) toast('Außenbildschirm: ' + st.error, 6000);
    if (on && !rearPrev){ rearPrev = {cam: SET.cam, facing: SET.facing}; SET.cam = ''; SET.facing = 'environment'; document.body.classList.add('rear'); openDevices();
      toast('HoneyRec läuft auf dem Außenbildschirm – aufgenommen wird mit der Hauptkamera', 5000); }
    else if (!on && rearPrev){ SET.cam = rearPrev.cam; SET.facing = rearPrev.facing; rearPrev = null; document.body.classList.remove('rear'); saveSet(); openDevices(); }
  }
  if (TS.recRear){ try { paintRear(J(TS.recRear('state'))); } catch(_){} }
  $('#rearBtn').onclick = () => { if (live) return toast('Erst die Aufnahme pausieren, dann den Bildschirm wechseln');
    const st = J(TS.recRear(rearPrev ? 'off' : 'on')); if (st && st.status === 'unavailable') toast('Dafür das Handy ganz aufklappen'); };

  window.HoneyRec = {get P(){ return P; }, regen, SET, Mouse, drawProg, Mix, Clip};   // für Tests
})();
