'use strict';
/* Textschnitt im Browser: stellt dem gemeinsamen Kern (app.js, studio.js) die Schnittstelle window.TS bereit –
   wie Android (nativ) und Windows (lokales Backend), hier aber vollständig im Browser:
   · Videos werden direkt von der Festplatte gelesen, nie hochgeladen
   · Projekte liegen in der Browser-Datenbank (IndexedDB)
   · Transkription mit Whisper im Browser, Export mit WebCodecs */
(() => {
  const VERSION = '__VERSION__';
  const $ = s => document.querySelector(s);
  const newId = () => Math.random().toString(36).slice(2, 10);
  const params = new URLSearchParams(location.search);

  // ───────── Browser-Datenbank ─────────
  let db = null;
  const idbOpen = () => new Promise((res) => {
    let r; try { r = indexedDB.open('textschnitt', 1); } catch(_){ return res(null); }
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('projects'); d.createObjectStore('files'); };
    r.onsuccess = () => res(r.result); r.onerror = () => res(null); r.onblocked = () => res(null);
  });
  function idb(store, mode, fn){
    if (!db) return Promise.resolve(null);
    return new Promise((res, rej) => {
      const tx = db.transaction(store, mode), req = fn(tx.objectStore(store));
      tx.oncomplete = () => res(req && req.result); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
    });
  }
  const idbAll = async store => {
    if (!db) return [];
    const [keys, vals] = await Promise.all([idb(store, 'readonly', s => s.getAllKeys()), idb(store, 'readonly', s => s.getAll())]);
    return keys.map((k, i) => [k, vals[i]]);
  };

  // ───────── Zustand ─────────
  const projects = new Map();     // id → JSON-Text
  const summaries = new Map();    // id → Kurzinfo für die Liste
  const fileRecs = new Map();     // id → {id, name, size, lastModified, type, handle?}
  const files = new Map();        // 'file:id' / 'opfs:name' → File
  const urls = new Map();         // uri → blob:-Adresse
  const outputs = new Map();      // 'out:n' → {blob, name}
  const jobs = new Map();
  let hasGpu = false;

  function summarize(id, txt){
    try {
      const p = JSON.parse(txt), srcs = p.sources || (p.main ? [p.main] : []);
      summaries.set(id, {id, name: p.name || '', updated: p.updated || 0, duration: srcs.reduce((a, s) => a + (+s.duration || 0), 0),
        sources: srcs.length, transcribed: !!(p.tokens && p.tokens.length)});
    } catch(_){}
  }
  function collectUris(o, out){
    if (Array.isArray(o)) o.forEach(v => collectUris(v, out));
    else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)){ if ((k === 'uri' || k === 'proxy') && typeof v === 'string') out.add(v); else collectUris(v, out); }
    return out;
  }
  const fileOf = uri => files.get(uri) || null;
  function need(uri){ const f = fileOf(uri); if (!f) throw new Error('Die Videodatei ist gerade nicht freigegeben. Öffne das Projekt neu und erlaube den Zugriff.'); return f; }

  // ───────── Engine & Spracherkennung (bei Bedarf geladen) ─────────
  let engineP = null;
  const E = () => engineP ||= import('./engine.js');
  let worker = null, wseq = 0; const wcb = new Map();
  function asr(msg, onProgress){
    if (!worker){
      worker = new Worker('asr-worker.js', {type:'module'});
      worker.onmessage = e => { const m = e.data, cb = wcb.get(m.id); if (!cb) return; if (m.type === 'progress') { onProg.get(m.id)?.(m); return; } wcb.delete(m.id); onProg.delete(m.id); cb(m); };
      worker.onerror = e => { for (const cb of wcb.values()) cb({type:'error', error: e.message || 'Spracherkennung konnte nicht gestartet werden'}); wcb.clear(); worker = null; };
    }
    return new Promise((res, rej) => {
      const id = ++wseq;
      wcb.set(id, m => m.type === 'error' ? rej(new Error(m.error)) : res(m));
      if (onProgress) onProg.set(id, onProgress);
      worker.postMessage({...msg, id}, msg.audio ? [msg.audio.buffer] : []);
    });
  }
  const onProg = new Map();

  // ───────── Hintergrund-Aufgaben (wie die Jobs am Desktop) ─────────
  function newJob(fn){
    const id = newId(), job = {id, status:'running', progress:0, message:'', result:null, error:null, cancel:false};
    jobs.set(id, job);
    Promise.resolve().then(() => fn(job)).then(r => { job.result = r; job.progress = 1; job.status = 'done'; },
      e => { job.status = job.cancel ? 'cancelled' : 'error'; job.error = String(e && e.message || e); console.error(e); });
    return id;
  }

  // ───────── Dateien wählen ─────────
  const ACCEPT = {
    videos: {'video/*':['.mp4','.mov','.m4v','.webm','.mkv','.avi','.3gp'], 'audio/*':['.mp3','.m4a','.wav','.aac','.ogg','.opus','.flac']},
    clip:   {'video/*':['.mp4','.mov','.m4v','.webm','.mkv'], 'image/*':['.jpg','.jpeg','.png','.webp','.gif','.avif']},
    video:  {'video/*':['.mp4','.mov','.m4v','.webm','.mkv']},
  };
  async function pickFiles(kind, multiple){
    const acc = ACCEPT[kind] || ACCEPT.videos;
    if (window.showOpenFilePicker){
      try {
        const hs = await showOpenFilePicker({multiple, types:[{description: kind === 'clip' ? 'Videos und Bilder' : 'Videos und Audio', accept: acc}], excludeAcceptAllOption:false, id:'textschnitt'});
        return Promise.all(hs.map(async h => ({file: await h.getFile(), handle: h})));
      } catch(e){ if (e && e.name === 'AbortError') return []; /* sonst: klassische Auswahl */ }
    }
    return new Promise(res => {
      const inp = document.createElement('input'); inp.type = 'file'; inp.multiple = multiple;
      inp.accept = Object.keys(acc).concat(...Object.values(acc)).join(',');
      inp.style.display = 'none'; document.body.append(inp);
      let done = false; const fin = list => { if (done) return; done = true; inp.remove(); res(list); };
      inp.onchange = () => fin([...inp.files].map(file => ({file, handle:null})));
      inp.addEventListener('cancel', () => fin([]));
      inp.click();
    });
  }
  function registerFile(file, handle){
    // Dieselbe Datei nochmal gewählt? Dann bleibt sie unter ihrer bisherigen Kennung.
    for (const r of fileRecs.values()) if (r.name === file.name && r.size === file.size && r.lastModified === file.lastModified){
      files.set('file:' + r.id, file); if (handle && !r.handle){ r.handle = handle; idb('files', 'readwrite', s => s.put(r, r.id)).catch(() => {}); }
      return 'file:' + r.id;
    }
    const id = newId(), rec = {id, name:file.name, size:file.size, lastModified:file.lastModified, type:file.type, handle: handle || null};
    fileRecs.set(id, rec); files.set('file:' + id, file);
    idb('files', 'readwrite', s => s.put(rec, id)).catch(() => { delete rec.handle; idb('files', 'readwrite', s => s.put(rec, id)).catch(() => {}); });
    return 'file:' + id;
  }
  async function pick(reqId, kind){
    let out = [];
    try {
      const list = await pickFiles(kind, kind === 'videos');
      if (list.length) showBusy('Dateien werden gelesen …');
      const eng = list.length ? await E() : null;
      for (const {file, handle} of list){
        try {
          const m = await eng.probe(file);
          if (kind === 'videos' && m.kind === 'image') continue;
          if (kind === 'video' && m.kind !== 'video') continue;
          const uri = registerFile(file, handle);
          out.push({uri, name: file.name, ...m});
          if (m.decodable === false) toastLater(`„${file.name}“: Dieses Format kann der Browser eventuell nicht verarbeiten.`);
        } catch(e){ toastLater(e.message || `„${file.name}“ kann nicht gelesen werden.`); }
      }
    } catch(e){ console.error(e); }
    hideBusy();
    requestPersist();
    TSApp.onPicked(reqId, out.length ? JSON.stringify(kind === 'videos' ? out : out[0]) : null);
  }

  // ───────── Zugriff nach dem Neuladen wiederherstellen ─────────
  const peers = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('textschnitt-files') : null;
  if (peers) peers.onmessage = e => {
    const m = e.data || {};
    if (m.t === 'need'){ const have = {}; for (const u of m.uris) if (files.has(u)) have[u] = files.get(u); if (Object.keys(have).length) peers.postMessage({t:'have', rid:m.rid, files:have}); }
  };
  function askPeers(uris){
    if (!peers || !uris.length) return Promise.resolve();
    return new Promise(res => {
      const rid = newId(), on = e => { const m = e.data || {}; if (m.t === 'have' && m.rid === rid) for (const [u, f] of Object.entries(m.files)) if (!files.has(u)) files.set(u, f); };
      peers.addEventListener('message', on); peers.postMessage({t:'need', rid, uris});
      setTimeout(() => { peers.removeEventListener('message', on); res(); }, 400);
    });
  }
  async function loadOpfs(name){
    try { const root = await navigator.storage.getDirectory(); files.set('opfs:' + name, await (await root.getFileHandle(name)).getFile()); } catch(_){}
  }
  async function prepare(pid){
    const txt = projects.get(pid); if (!txt) return true;
    let uris; try { uris = [...collectUris(JSON.parse(txt), new Set())]; } catch(_){ return true; }
    const missing = () => uris.filter(u => !files.has(u) && (u.startsWith('file:') || u.startsWith('opfs:')));
    for (const u of missing()){
      if (u.startsWith('opfs:')) { await loadOpfs(u.slice(5)); continue; }
      const r = fileRecs.get(u.slice(5));
      if (r && r.handle){ try { if (await r.handle.queryPermission({mode:'read'}) === 'granted') files.set(u, await r.handle.getFile()); } catch(_){} }
    }
    if (missing().length) await askPeers(missing());
    if (!missing().filter(u => u.startsWith('file:')).length) return true;
    return restoreDialog(() => missing().filter(u => u.startsWith('file:')));
  }
  function restoreDialog(missing){
    return new Promise(res => {
      const box = document.createElement('div'); box.className = 'web-modal';
      const render = () => {
        const list = missing();
        if (!list.length){ box.remove(); return res(true); }
        const recs = list.map(u => fileRecs.get(u.slice(5)) || {name: u});
        const canGrant = recs.some(r => r.handle);
        box.innerHTML = `<div class="web-card"><h3>Zugriff auf deine Videos</h3>
          <p class="muted small">Aus Datenschutzgründen merkt sich der Browser den Zugriff auf deine Dateien nicht dauerhaft. Erlaube ihn kurz noch einmal – die Videos bleiben dabei auf deinem Gerät.</p>
          <ul>${recs.map(r => `<li>${esc(r.name)}</li>`).join('')}</ul>
          <div class="web-row">${canGrant ? '<button class="btn primary" data-a="grant">Zugriff erlauben</button>' : ''}
          <button class="btn ${canGrant ? '' : 'primary'}" data-a="pick">Dateien auswählen …</button></div>
          <div class="web-row"><button class="btn ghost" data-a="skip">Ohne Videos öffnen</button><button class="btn ghost" data-a="cancel">Abbrechen</button></div></div>`;
      };
      box.addEventListener('click', async e => {
        const a = e.target.closest('button') && e.target.closest('button').dataset.a; if (!a) return;
        if (a === 'cancel'){ box.remove(); return res(false); }
        if (a === 'skip'){ box.remove(); return res(true); }
        if (a === 'grant'){
          for (const u of missing()){ const r = fileRecs.get(u.slice(5)); if (!r || !r.handle) continue;
            try { if (await r.handle.requestPermission({mode:'read'}) === 'granted') files.set(u, await r.handle.getFile()); } catch(_){} }
        }
        if (a === 'pick'){
          const list = await pickFiles('videos', true);
          for (const {file, handle} of list){
            const u = missing().find(x => { const r = fileRecs.get(x.slice(5)); return r && r.name === file.name && (!r.size || r.size === file.size); })
                   || missing().find(x => { const r = fileRecs.get(x.slice(5)); return r && r.name === file.name; });
            if (!u) { toast(`„${file.name}“ gehört nicht zu diesem Projekt.`); continue; }
            files.set(u, file); const r = fileRecs.get(u.slice(5)); if (handle){ r.handle = handle; idb('files', 'readwrite', s => s.put(r, r.id)).catch(() => {}); }
          }
        }
        render();
      });
      render(); document.body.append(box);
    });
  }

  // ───────── Modelle ─────────
  const MODELS = [
    {name:'tiny',  label:'Whisper tiny – sehr schnell, ungenauer', gpu:155, cpu:45},
    {name:'base',  label:'Whisper base – schnell',                 gpu:290, cpu:80},
    {name:'small', label:'Whisper small – genau (empfohlen)',      gpu:665, cpu:250},
  ];
  const forced = params.get('device') === 'wasm' ? 'wasm' : '';
  const dev = () => forced || (hasGpu ? 'webgpu' : 'wasm');
  const mKey = (n, d) => `ts.model.${n}.${d}`;
  const lsGet = k => { try { return localStorage.getItem(k); } catch(_){ return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch(_){} };
  function modelsList(){
    const d = dev(), rec = d === 'webgpu' ? 'small' : 'base';
    return MODELS.map(m => ({name:m.name, label: m.label.replace(' (empfohlen)', '') + (m.name === rec ? ' (empfohlen)' : ''), sizeMb: d === 'webgpu' ? m.gpu : m.cpu,
      installed: lsGet(mKey(m.name, d)) === '1', bundled:false, recommended: m.name === rec}));
  }
  async function loadModel(name, job, base, span){
    const r = await asr({cmd:'load', model:name, device:forced || ''}, m => {
      job.progress = base + span * m.p; job.message = `Modell wird geladen (einmalig): ${Math.round(m.p * m.total / 1e6)} von ${Math.round(m.total / 1e6)} MB`;
    });
    lsSet(mKey(name, r.device), '1');
    return r.device;
  }

  // ───────── Transkription ─────────
  const HALLU = /(untertitel (im auftrag|der amara|von stephanie)|amara\.org|vielen dank (fürs|für's) zuschauen|copyright|www\.\w+\.(de|com))/i;
  function speechChunks(db, rate){
    // höchstens ~28 s je Stück (Whisper-Fenster), geschnitten an der leisesten Stelle
    const n = db.length, sorted = Float32Array.from(db).sort(), floor = sorted[Math.floor(n * 0.2)] || -90;
    const out = []; let s = 0;
    while (s < n){
      let e;
      if (n - s <= 2800) e = n;
      else {
        let best = s + 2800, bestV = Infinity;
        for (let k = s + 1600; k < s + 2800; k++){ let v = 0; for (let j = -15; j <= 15; j++) v += db[Math.min(n - 1, Math.max(0, k + j))]; if (v < bestV){ bestV = v; best = k; } }
        e = best;
      }
      let mx = -90; for (let k = s; k < e; k++) if (db[k] > mx) mx = db[k];
      out.push({s, e, speech: mx > Math.max(-55, floor + 6)});
      s = e;
    }
    return {chunks: out, floor};
  }
  function fixWords(chunks, off, len, db0, floor, PAD){
    let words = [];
    for (const c of chunks){
      const text = c.text || ''; if (!text.trim()) continue;
      let [a, b] = c.ts || []; a = (a ?? NaN) - PAD; b = (b ?? NaN) - PAD;
      words.push({text, a, b});
    }
    if (HALLU.test(words.map(w => w.text).join(' '))) return [];
    // Sind die Zeitmarken unbrauchbar (bekannter Fehler bei manchen Modellen)? Dann über die gesprochenen Stellen verteilen.
    const bad = words.filter(w => !(w.a >= -0.2 && w.a <= len + 0.2) || !(w.b >= w.a)).length + words.filter(w => w.a >= len - 0.1).length;
    if (words.length && bad > Math.max(2, words.length * 0.2)){
      const voiced = []; for (let k = 0; k < db0.length; k++) if (db0[k] > floor + 10) voiced.push(k);
      const tot = words.reduce((x, w) => x + w.text.trim().length + 1, 0); let acc = 0;
      const at = f => { const i = Math.min(voiced.length - 1, Math.floor(f * voiced.length)); return voiced.length ? voiced[Math.max(0, i)] / 100 : f * len; };
      words.forEach(w => { const l = w.text.trim().length + 1; w.a = at(acc / tot); acc += l; w.b = Math.max(w.a + 0.05, at(acc / tot) - 0.01); });
    }
    let prev = 0;
    return words.map((w, i) => {
      let a = isFinite(w.a) ? w.a : prev, b = isFinite(w.b) ? w.b : (isFinite(words[i + 1] && words[i + 1].a) ? words[i + 1].a : a + 0.3);
      a = Math.min(len, Math.max(prev, a)); b = Math.min(len, Math.max(a + 0.02, b)); prev = a;
      return {text: w.text, start: +(off + a).toFixed(3), end: +(off + b).toFixed(3), prob: 1};
    });
  }
  const tfmt = t => { t = Math.max(0, Math.round(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  function transcribe(uri, model, lang, fillers){
    const file = need(uri);
    return newJob(async job => {
      const eng = await E();
      job.message = 'Ton wird vorbereitet';
      const pcm = await eng.decodeAudio(file, 16000, p => { job.progress = 0.04 * p; }, job);
      const db = eng.envelopeDb(pcm), env = eng.envelopeB64(db);
      if (job.cancel) throw new Error('Abgebrochen');
      job.message = 'Modell wird vorbereitet';
      const d = await loadModel(model, job, 0.04, 0.1);
      const lg = lang || (navigator.language || 'de').slice(0, 2).toLowerCase();
      const {chunks, floor} = speechChunks(db, 16000), PAD = 0.3, padN = Math.round(PAD * 16000);
      const words = []; const t0 = performance.now(); const dur = pcm.length / 16000;
      for (const c of chunks){
        if (job.cancel) throw new Error('Abgebrochen');
        if (c.speech){
          const s0 = c.s * 160, e0 = Math.min(pcm.length, c.e * 160), audio = new Float32Array(e0 - s0 + 2 * padN);
          audio.set(pcm.subarray(s0, e0), padN);
          const r = await asr({cmd:'run', model, device: forced || '', audio, lang: lg});
          words.push(...fixWords(r.chunks, s0 / 16000, (e0 - s0) / 16000, db.subarray(c.s, c.e), floor, PAD));
        }
        const frac = Math.min(1, c.e * 160 / Math.max(1, pcm.length)), el = (performance.now() - t0) / 1000;
        job.progress = 0.14 + 0.86 * frac;
        job.message = `Transkribiere ${tfmt(frac * dur)} von ${tfmt(dur)}` + (frac > 0.03 ? ` · noch ca. ${tfmt(el / frac - el)}` : '') + (d === 'webgpu' ? ' · Grafikkarte' : ' · Prozessor');
      }
      return {words, lang: lg, env};
    });
  }
  function envelope(uri){
    const file = need(uri);
    return newJob(async job => { const eng = await E(); const pcm = await eng.decodeAudio(file, 16000, p => job.progress = p, job); return {env: eng.envelopeB64(eng.envelopeDb(pcm))}; });
  }

  // ───────── Export ─────────
  let outSeq = 0;
  const srtTime = t => { const ms = Math.round(t * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
  function srtOf(cues){ return cues.slice().sort((a, b) => a.start - b.start).map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n'); }
  function download(blob, name){
    const a = document.createElement('a'), u = URL.createObjectURL(blob); a.href = u; a.download = name; document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 120000);
  }
  function exportVideo(planJson){
    const plan = JSON.parse(planJson);
    if (plan.format !== 'video' && plan.format !== 'audio') throw new Error('Dieses Format gibt es nur in der Windows-App.');
    for (const s of plan.segments || []) if (s.hasVideo !== false || s.hasAudio !== false) need(s.uri);
    return newJob(async job => {
      job.message = 'Export wird vorbereitet …';
      const eng = await E();
      const r = await eng.render(plan, fileOf, job);
      const stem = (plan.name || 'textschnitt').replace(/[\\/:*?"<>|]/g, '_');
      const name = `${stem}.${r.ext}`, id = 'out:' + (++outSeq);
      outputs.set(id, {blob: r.blob, name});
      download(r.blob, name);
      const names = [name];
      const cues = ((plan.subs || {}).cues || []).filter(c => !c.title);
      if (cues.length){ const srt = new Blob([srtOf(cues)], {type:'text/plain'}); outputs.set(id + ':srt', {blob: srt, name: stem + '.srt'}); setTimeout(() => download(srt, stem + '.srt'), 800); names.push(stem + '.srt'); }
      const mb = (r.blob.size / 1e6).toFixed(r.blob.size > 1e8 ? 0 : 1).replace('.', ',');
      return {uri:id, playable:id, files: names, note: `Fertig – „${name}“ (${mb} MB) wurde heruntergeladen.`};
    });
  }
  function makeProxy(uri){
    const file = need(uri);
    return newJob(async job => {
      const eng = await E(), r = await eng.makeProxy(file, job);
      const key = r.opfsName ? 'opfs:' + r.opfsName : 'mem:' + newId();
      files.set(key, r.blob instanceof File ? r.blob : new File([r.blob], 'vorschau.mp4', {type:'video/mp4'}));
      return {path: key};
    });
  }

  // ───────── Fenster-Abgleich ─────────
  const chans = new Map();
  function chan(pid){ if (!chans.has(pid)) chans.set(pid, new BroadcastChannel('textschnitt-bus-' + pid)); return chans.get(pid); }

  // ───────── Schnittstelle für den Kern ─────────
  let wake = null;
  window.TS = {
    info: () => JSON.stringify({platform:'web', version:VERSION, exportFormats:['video', 'audio'], bus: typeof BroadcastChannel !== 'undefined', gpu: hasGpu}),
    pick: (id, kind) => { pick(id, kind); },
    listProjects: () => JSON.stringify([...summaries.values()]),
    loadProject: id => projects.get(id) || '',
    saveProject: (id, json) => { projects.set(id, json); summarize(id, json); idb('projects', 'readwrite', s => s.put(json, id)).catch(e => { console.error(e); toast('Speichern im Browser fehlgeschlagen – ist der Speicher voll?'); }); },
    deleteProject: id => { projects.delete(id); summaries.delete(id); idb('projects', 'readwrite', s => s.delete(id)).catch(() => {}); },
    models: () => JSON.stringify(modelsList()),
    downloadModel: name => newJob(async job => { await loadModel(name, job, 0, 1); return {}; }),
    transcribe, exportVideo, makeProxy, envelope,
    job: id => { const j = jobs.get(id); if (!j) return ''; const {cancel, ...o} = j; if (j.status !== 'running') setTimeout(() => jobs.delete(id), 60000); return JSON.stringify(o); },
    cancel: id => { const j = jobs.get(id); if (j) j.cancel = true; },
    share: id => {
      const o = outputs.get(id); if (!o) return;
      const f = new File([o.blob], o.name, {type: o.blob.type});
      if (navigator.canShare && matchMedia('(pointer: coarse)').matches && navigator.canShare({files:[f]})) navigator.share({files:[f]}).catch(() => {});
      else download(o.blob, o.name);
    },
    view: id => { const o = outputs.get(id); if (o) window.open(URL.createObjectURL(o.blob), '_blank'); },
    keepAwake: on => {
      if (!navigator.wakeLock) return;
      if (on && !wake) navigator.wakeLock.request('screen').then(w => { wake = w; w.addEventListener('release', () => { if (wake === w) wake = null; }); }).catch(() => {});
      else if (!on && wake){ wake.release().catch(() => {}); wake = null; }
    },
    openWindow: (project, view) => location.origin + location.pathname + `#p=${encodeURIComponent(project)}&view=${encodeURIComponent(view)}`,
    mediaUrl: uri => {
      if (urls.has(uri)) return urls.get(uri);
      const f = fileOf(uri); if (!f) return '';
      const u = URL.createObjectURL(f); urls.set(uri, u); return u;
    },
    thumbUrl: (uri, t, h) => {
      const f = fileOf(uri); if (!f) return Promise.resolve('');
      const k = `${uri}|${t}|${h}`; if (!thumbs.has(k)) thumbs.set(k, E().then(e => e.thumb(f, t, h)).catch(() => ''));
      return thumbs.get(k);
    },
    prepare,
    busPost: (pid, from, msg) => { try { chan(pid).postMessage({from, msg}); } catch(_){} },
    busListen: (pid, me, cb) => { const c = chan(pid); c.onmessage = e => { if (e.data && e.data.from !== me) cb(e.data.msg); }; },
  };
  const thumbs = new Map();

  // ───────── kleine Oberflächen-Helfer ─────────
  const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;'}[c]));
  function toast(msg){ const t = $('#toast'); if (!t) return; t.textContent = msg; t.classList.add('on'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 3200); }
  function toastLater(msg){ setTimeout(() => toast(msg), 300); }
  function showBusy(msg){ let b = $('#webBusy'); if (!b){ b = document.createElement('div'); b.id = 'webBusy'; b.className = 'web-busy'; document.body.append(b); } b.textContent = msg; b.classList.remove('hidden'); }
  function hideBusy(){ const b = $('#webBusy'); if (b) b.classList.add('hidden'); }
  let persistAsked = false;
  function requestPersist(){ if (persistAsked || !navigator.storage || !navigator.storage.persist) return; persistAsked = true; navigator.storage.persist().catch(() => {}); }

  // ───────── Start ─────────
  function loadScript(src){ return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.async = false; s.onload = res; s.onerror = rej; document.body.append(s); }); }
  function supportNote(){
    const miss = [];
    if (!('VideoDecoder' in window) || !('VideoEncoder' in window)) miss.push('Video verarbeiten (WebCodecs)');
    if (!('AudioDecoder' in window)) miss.push('Ton verarbeiten');
    if (!db) miss.push('Projekte speichern (IndexedDB)');
    return miss;
  }
  async function cleanupOpfs(){
    try {
      const root = await navigator.storage.getDirectory(), keep = new Set();
      for (const txt of projects.values()) for (const u of collectUris(JSON.parse(txt), new Set())) if (u.startsWith('opfs:')) keep.add(u.slice(5));
      for await (const [name] of root.entries()){
        if (keep.has(name)) continue;
        const m = /^(export|proxy)-(\d+)\./.exec(name);
        if (m && Date.now() - +m[2] > 6 * 3600e3) await root.removeEntry(name).catch(() => {});
      }
    } catch(_){}
  }
  async function boot(){
    db = await idbOpen();
    try {
      for (const [k, v] of await idbAll('projects')){ projects.set(k, v); summarize(k, v); }
      for (const [k, v] of await idbAll('files')) fileRecs.set(k, v);
    } catch(e){ console.error(e); }
    try { hasGpu = !!(navigator.gpu && await Promise.race([navigator.gpu.requestAdapter(), new Promise(r => setTimeout(() => r(null), 1500))])); } catch(_){}
    await loadScript('app.js'); await loadScript('studio.js');
    // Hinweise auf der Startseite
    const home = $('#home .home-body');
    if (home){
      const n = document.createElement('div'); n.className = 'web-note';
      const miss = supportNote();
      n.innerHTML = (miss.length ? `<p class="web-warn">Dieser Browser kann nicht alles, was Textschnitt braucht (${miss.join(', ')}). Am besten funktioniert ein aktueller Chrome oder Edge am Computer.</p>` : '') +
        `<p>🔒 Deine Videos bleiben auf deinem Gerät: Transkription, Schnitt und Export laufen vollständig in diesem Browser. Nur das Whisper-Modell wird beim ersten Mal von Hugging Face geladen.</p>` +
        `<p class="muted">Textschnitt ${VERSION} · Projekte werden in diesem Browser gespeichert · <a href="https://github.com/honeybalecta/textschnitt" target="_blank" rel="noopener">Windows- und Android-App</a></p>`;
      home.append(n);
    }
    window.addEventListener('beforeunload', e => { for (const j of jobs.values()) if (j.status === 'running'){ e.preventDefault(); e.returnValue = ''; return; } });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && window.TSApp) TSApp.onPause(); });
    setTimeout(cleanupOpfs, 5000);
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && !params.has('nosw')){
      navigator.serviceWorker.register('sw.js').then(reg => {
        // Beim allerersten Besuch einmal neu laden, damit die Seite „isoliert“ läuft (schnellere Spracherkennung ohne Grafikkarte)
        if (!window.crossOriginIsolated && !navigator.serviceWorker.controller && !sessionStorage.getItem('tsCoi')){
          navigator.serviceWorker.addEventListener('controllerchange', () => {
            if (!document.querySelector('#proj:not(.hidden)') && !jobs.size){ sessionStorage.setItem('tsCoi', '1'); location.reload(); }
          }, {once:true});
        }
      }).catch(() => {});
    }
    document.documentElement.classList.add('web-ready');
  }
  boot();
})();
