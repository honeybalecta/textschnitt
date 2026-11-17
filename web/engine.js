// Textschnitt im Browser – Medien-Engine.
// Alles läuft lokal: Dateien werden direkt von der Festplatte gelesen (mediabunny + WebCodecs),
// nichts wird hochgeladen. Entspricht dem, was am Desktop ffmpeg erledigt.
import {
  Input, ALL_FORMATS, BlobSource, CanvasSink, AudioSampleSink,
  Output, Mp4OutputFormat, WavOutputFormat, Mp3OutputFormat, FlacOutputFormat, BufferTarget, StreamTarget,
  CanvasSource, AudioSampleSource, AudioSample, Quality, Conversion,
  canEncodeAudio, getFirstEncodableVideoCodec,
  registerAacEncoder, registerMp3Encoder, registerFlacEncoder,
} from './vendor/media.js';

const SR = 48000;
const IMG_RE = /\.(jpe?g|png|webp|gif|bmp|avif|heic|heif)$/i;
export const isImageFile = f => (f.type || '').startsWith('image/') || IMG_RE.test(f.name || '');

// ───────── Eingaben ─────────
const inputs = new WeakMap();
function inputOf(file){
  let x = inputs.get(file);
  if (!x){ x = {input: new Input({formats: ALL_FORMATS, source: new BlobSource(file)})}; inputs.set(file, x); }
  return x;
}
async function firstTs(file){
  const x = inputOf(file);
  if (x.off == null){ try { x.off = Math.max(0, (await x.input.getFirstTimestamp()) || 0); } catch(_){ x.off = 0; } }
  return x.off;
}
async function videoTrack(file){ const x = inputOf(file); if (x.v === undefined) x.v = await x.input.getPrimaryVideoTrack().catch(() => null); return x.v; }
async function audioTrack(file){ const x = inputOf(file); if (x.a === undefined) x.a = await x.input.getPrimaryAudioTrack().catch(() => null); return x.a; }

const bitmaps = new WeakMap();
function bitmapOf(file){ let p = bitmaps.get(file); if (!p){ p = createImageBitmap(file, {imageOrientation: 'from-image'}); bitmaps.set(file, p); } return p; }

// Medien-Infos im Format der Oberfläche (Größe wie angezeigt, also bereits gedreht)
export async function probe(file){
  if (isImageFile(file)){
    const bm = await bitmapOf(file);
    return {kind:'image', duration:600, width:bm.width, height:bm.height, rotation:0, fps:30, hasAudio:false, hasVideo:true};
  }
  try {
    const v = await videoTrack(file), a = await audioTrack(file);
    if (!v && !a) throw new Error('keine Spuren');
    const duration = await inputOf(file).input.computeDuration();
    let w = 0, h = 0, fps = 30, decodable = true;
    if (v){
      w = await v.getDisplayWidth(); h = await v.getDisplayHeight();
      try { const st = await v.computePacketStats(120); if (st.averagePacketRate > 1 && st.averagePacketRate <= 240) fps = st.averagePacketRate; } catch(_){}
      try { decodable = await v.canDecode(); } catch(_){}
    }
    if (a){ try { decodable = decodable && await a.canDecode(); } catch(_){} }
    return {kind: v ? 'video' : 'audio', duration: +(+duration).toFixed(3), width:w, height:h, rotation:0, fps:+fps.toFixed(3),
            hasAudio: !!a, hasVideo: !!v, decodable};
  } catch(e){
    // Format, das mediabunny nicht liest: wenigstens die Eckdaten über den Browser-Player holen
    const m = await probeWithElement(file);
    if (!m) throw new Error(`„${file.name}“ kann dieser Browser nicht lesen.`);
    return {...m, decodable:false};
  }
}
function probeWithElement(file){
  return new Promise(res => {
    const v = document.createElement('video'), url = URL.createObjectURL(file);
    const done = r => { URL.revokeObjectURL(url); v.removeAttribute('src'); v.load(); res(r); };
    v.preload = 'metadata'; v.muted = true;
    v.onloadedmetadata = () => done({kind: v.videoWidth ? 'video' : 'audio', duration:+(v.duration || 0).toFixed(3), width:v.videoWidth, height:v.videoHeight,
      rotation:0, fps:30, hasAudio:true, hasVideo: !!v.videoWidth});
    v.onerror = () => done(null);
    setTimeout(() => done(null), 15000);
    v.src = url;
  });
}

// ───────── Vorschaubilder für die Zeitleiste ─────────
const thumbState = new WeakMap();
export function thumb(file, t, h){
  if (isImageFile(file)) return imageThumb(file, h);
  let st = thumbState.get(file);
  if (!st){ st = {queue:[], timer:null, chain:Promise.resolve(), sinks:new Map()}; thumbState.set(file, st); }
  return new Promise(res => {
    st.queue.push({t, h, res});
    if (!st.timer) st.timer = setTimeout(() => { st.timer = null; const batch = st.queue.splice(0); st.chain = st.chain.then(() => runThumbs(file, st, batch)).catch(() => {}); }, 40);
  });
}
async function runThumbs(file, st, batch){
  const v = await videoTrack(file);
  if (!v){ batch.forEach(b => b.res('')); return; }
  const off = await firstTs(file);
  const byH = new Map(); for (const b of batch){ if (!byH.has(b.h)) byH.set(b.h, []); byH.get(b.h).push(b); }
  for (const [h, list] of byH){
    let sink = st.sinks.get(h); if (!sink){ sink = new CanvasSink(v, {height:h, poolSize:2}); st.sinks.set(h, sink); }
    list.sort((a, b) => a.t - b.t);
    let k = 0;
    try {
      for await (const wc of sink.canvasesAtTimestamps(list.map(b => b.t + off))){
        const b = list[k++]; if (!wc){ b.res(''); continue; }
        b.res(await canvasUrl(wc.canvas, 0.7));
      }
    } catch(_){}
    for (; k < list.length; k++) list[k].res('');
  }
}
async function canvasUrl(c, q){
  const blob = c.convertToBlob ? await c.convertToBlob({type:'image/jpeg', quality:q}) : await new Promise(r => c.toBlob(r, 'image/jpeg', q));
  return blob ? URL.createObjectURL(blob) : '';
}
const imgThumbs = new WeakMap();
async function imageThumb(file, h){
  let m = imgThumbs.get(file); if (!m){ m = new Map(); imgThumbs.set(file, m); }
  if (!m.has(h)) m.set(h, (async () => {
    const bm = await bitmapOf(file), w = Math.max(1, Math.round(bm.width * h / bm.height));
    const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(bm, 0, 0, w, h);
    return canvasUrl(c, 0.75);
  })());
  return m.get(h);
}

// ───────── Ton ─────────
// Ton einer Datei als Mono mit der gewünschten Abtastrate (für Whisper 16 kHz)
export async function decodeAudio(file, rate, onProgress, job){
  const a = await audioTrack(file);
  if (!a) return new Float32Array(0);
  const dur = await inputOf(file).input.computeDuration(), off = await firstTs(file);
  let out = new Float32Array(Math.ceil((dur + 1) * rate)), o = 0;
  const grow = need => { if (need <= out.length) return; const n = new Float32Array(Math.max(need, out.length * 1.5 | 0)); n.set(out.subarray(0, o)); out = n; };
  let acc = 0, accN = 0, phase = 0, prev = 0, ipos = 0, lastP = -1;
  for await (const s of new AudioSampleSink(a).samples()){
    if (job && job.cancel){ s.close(); throw new Error('Abgebrochen'); }
    const n = s.numberOfFrames, ch = Math.min(2, s.numberOfChannels), sr = s.sampleRate, ts = s.timestamp - off;
    const mono = new Float32Array(n), tmp = ch > 1 ? new Float32Array(n) : null;
    s.copyTo(mono, {format:'f32-planar', planeIndex:0});
    if (tmp){ s.copyTo(tmp, {format:'f32-planar', planeIndex:1}); for (let i = 0; i < n; i++) mono[i] = (mono[i] + tmp[i]) * 0.5; }
    s.close();
    const at = Math.round(ts * rate);
    if (at > o + rate * 0.05){ grow(at + 1); o = at; }            // Lücke im Ton: Stille
    grow(o + Math.ceil(n * rate / sr) + 2);
    const r = sr / rate;
    if (r === 1){ out.set(mono, o); o += n; }
    else if (r > 1){                                             // herunterrechnen: Mittelwert je Ausgabe-Abtastwert
      for (let i = 0; i < n; i++){ acc += mono[i]; accN++; phase += 1; if (phase >= r){ out[o++] = acc / accN; acc = 0; accN = 0; phase -= r; } }
    } else {                                                     // hochrechnen: linear
      for (let i = 0; i < n; i++){ const x = mono[i]; while (ipos <= 1){ out[o++] = prev + (x - prev) * ipos; ipos += r; } ipos -= 1; prev = x; }
    }
    if (onProgress && dur){ const p = Math.min(1, (ts + n / sr) / dur); if (p - lastP > 0.01){ lastP = p; onProgress(p); } }
  }
  return out.subarray(0, o);
}

// Lautstärke in 10-ms-Schritten (dB, 0…255) als Base64 – identisch zur Desktop-Version
export function envelopeDb(pcm16){
  const n = Math.floor(pcm16.length / 160), db = new Float32Array(n);
  for (let k = 0; k < n; k++){
    let s = 0; for (let i = k * 160, e = i + 160; i < e; i++) s += pcm16[i] * pcm16[i];
    db[k] = Math.min(0, Math.max(-90, 20 * Math.log10(Math.sqrt(s / 160) + 1e-9)));
  }
  return db;
}
export function envelopeB64(db){
  const b = new Uint8Array(db.length); for (let k = 0; k < db.length; k++) b[k] = Math.round((db[k] + 90) * 2.8);
  let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}

// ───────── Encoder ─────────
let encReady = null;
export function ensureEncoders(){
  return encReady ||= (async () => {
    const cfg = {numberOfChannels:2, sampleRate:SR, quality:new Quality({bitrate:192e3})};
    try { if (!(await canEncodeAudio('aac', cfg))) registerAacEncoder(); } catch(_){ registerAacEncoder(); }
    try { if (!(await canEncodeAudio('mp3', cfg))) registerMp3Encoder(); } catch(_){ registerMp3Encoder(); }
    try { if (!(await canEncodeAudio('flac', cfg))) registerFlacEncoder(); } catch(_){ registerFlacEncoder(); }
  })();
}

// ───────── Export ─────────
const FX_DEF = {speed:1, vol:1, bright:0, contrast:0, sat:0, gray:false, tx:0, ty:0, sc:1};
const SIZE_F = {klein:0.045, mittel:0.058, 'groß':0.075};
const QUAL = {hoch:'very-high', standard:'high', klein:'medium'};
const AUDIO_FMT = {
  wav:  {ext:'wav',  mime:'audio/wav',  codec:'pcm-s16', fmt: big => new WavOutputFormat({large: big})},
  mp3:  {ext:'mp3',  mime:'audio/mpeg', codec:'mp3',     fmt: () => new Mp3OutputFormat()},
  m4a:  {ext:'m4a',  mime:'audio/mp4',  codec:'aac',     fmt: (big, stream) => new Mp4OutputFormat({fastStart: stream ? false : 'in-memory'})},
  flac: {ext:'flac', mime:'audio/flac', codec:'flac',    fmt: () => new FlacOutputFormat()},
};
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const cssFilter = fx => [fx.bright ? `brightness(${(1 + fx.bright).toFixed(3)})` : '', fx.contrast ? `contrast(${(1 + fx.contrast).toFixed(3)})` : '',
  fx.sat ? `saturate(${(1 + fx.sat / 100).toFixed(3)})` : '', fx.gray ? 'grayscale(1)' : ''].filter(Boolean).join(' ');
function zoomAt(zs, t){
  let s = 1, cx = .5, cy = .5;
  for (const z of zs || []){
    if (t < z.at || t > z.at + z.dur) continue;
    const p = clamp((t - z.at) / Math.max(0.05, z.dur), 0, 1), e = p * p * (3 - 2 * p);
    if (z.kind === 'punch') s = z.strength; else if (z.kind === 'out') s = z.strength + (1 - z.strength) * e; else s = 1 + (z.strength - 1) * e;
    cx = z.cx; cy = z.cy;
  }
  return {s, cx, cy};
}
// Keyframes: stückweise linear zwischen {t, x, y, w}
function kfAt(kf, rel){
  const n = kf.length; if (rel <= kf[0].t) return kf[0]; if (rel >= kf[n-1].t) return kf[n-1];
  for (let i = 0; i < n - 1; i++){ const a = kf[i], b = kf[i+1]; if (rel < b.t){ const f = (rel - a.t) / Math.max(1e-6, b.t - a.t);
    return {x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, w: a.w + (b.w - a.w) * f}; } }
  return kf[n-1];
}
// Bereich einer Leinwand verpixeln oder weichzeichnen (dieselbe Rechnung wie im Titelbild der Oberfläche und – in den Maßen –
// wie im Windows-Export): Fenster win = [x, y, w, h] in Pixeln, darin der Bereich reg; das Raster ist am Fenster verankert.
// Verkleinert wird in Schritten auf die Hälfte: So mittelt jeder Browser sauber, auch wenn er beim starken Verkleinern nur
// wenige Punkte liest.
function regionFx(ctx, src, win, reg, cell, soft, ellipse, tmp){
  const [wx, wy, ww, wh] = win, nx = Math.max(1, Math.round(ww / cell)), ny = Math.max(1, Math.round(wh / cell));
  let cur = src, sx = wx, sy = wy, sw = ww, sh = wh, k = 0;
  for (;;){
    const tw = Math.max(nx, Math.ceil(sw / 2)), th = Math.max(ny, Math.ceil(sh / 2));
    const c = tmp[k % 2] ||= document.createElement('canvas'); c.width = tw; c.height = th;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(cur, sx, sy, sw, sh, 0, 0, tw, th);
    cur = c; sx = sy = 0; sw = tw; sh = th; k++;
    if (tw <= nx && th <= ny) break;
  }
  ctx.save(); ctx.beginPath();
  if (ellipse) ctx.ellipse(reg[0] + reg[2] / 2, reg[1] + reg[3] / 2, reg[2] / 2, reg[3] / 2, 0, 0, Math.PI * 2); else ctx.rect(reg[0], reg[1], reg[2], reg[3]);
  ctx.clip(); ctx.imageSmoothingEnabled = !!soft; if (soft) ctx.imageSmoothingQuality = 'low';
  ctx.drawImage(cur, 0, 0, sw, sh, wx, wy, ww, wh); ctx.restore(); ctx.imageSmoothingEnabled = true;
}
// Weißabgleich aus dem Plan: Verstärkung je Farbkanal [r, g, b]; null = keiner
function wbOf(raw){ if (!Array.isArray(raw) || raw.length < 3) return null; const v = raw.slice(0, 3).map(x => clamp(+x || 1, 0.25, 4)); return v.some(x => Math.abs(x - 1) > 1e-3) ? v : null; }
// … als Filter für das Zeichnen des Hauptbilds: eine Farbmatrix im sRGB-Raum (dieselbe Rechnung wie „colorchannelmixer“ im
// Windows-Export und wie in der Vorschau), angewandt nach dem Freistellen. Je Wertesatz ein SVG-Filter im Dokument.
function wbFilter(wb){
  const NS = 'http://www.w3.org/2000/svg', key = wb.map(v => v.toFixed(4)).join('_');
  let host = document.getElementById('hcWbExport');
  if (!host){ host = document.createElementNS(NS, 'svg'); host.id = 'hcWbExport'; host.setAttribute('width', '0'); host.setAttribute('height', '0'); host.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none'; document.body.append(host); }
  let f = [...host.children].find(x => x.dataset.k === key);
  if (!f){ f = document.createElementNS(NS, 'filter'); f.id = 'hcWbX' + (host.children.length + 1) + '_' + Date.now().toString(36); f.dataset.k = key; f.setAttribute('color-interpolation-filters', 'sRGB');
    f.setAttribute('x', '0'); f.setAttribute('y', '0'); f.setAttribute('width', '1'); f.setAttribute('height', '1');
    const m = document.createElementNS(NS, 'feColorMatrix'); m.setAttribute('type', 'matrix'); m.setAttribute('values', `${wb[0]} 0 0 0 0 0 ${wb[1]} 0 0 0 0 0 ${wb[2]} 0 0 0 0 0 1 0`); f.append(m); host.append(f); }
  return `url(#${f.id})`;
}
function segFx(s){
  return {speed: clamp(+s.speed || 1, 0.25, 4), vol: clamp(s.vol == null ? 1 : +s.vol, 0, 8), bright:+s.bright || 0, contrast:+s.contrast || 0, sat:+s.sat || 0, gray:!!s.gray, wb: wbOf(s.wb),
    tx:+s.tx || 0, ty:+s.ty || 0, sc: clamp(+s.sc || 1, 0.002, 400), kf: Array.isArray(s.kf) && s.kf.length ? s.kf.map(k => ({t:+k.t || 0, tx:+k.tx || 0, ty:+k.ty || 0, sc: clamp(+k.sc || 1, 0.002, 400)})).sort((a, b) => a.t - b.t) : null};
}
// Keyframes der Hauptspur: Lage/Größe zum Zeitpunkt rel (Quellsekunden ab Abschnittsbeginn)
function mainAt(fx, rel){
  const kf = fx.kf; if (!kf) return fx;
  const n = kf.length; if (rel <= kf[0].t) return kf[0]; if (rel >= kf[n-1].t) return kf[n-1];
  for (let i = 0; i < n - 1; i++){ const a = kf[i], b = kf[i+1]; if (rel < b.t){ const f = (rel - a.t) / Math.max(1e-6, b.t - a.t);
    return {tx: a.tx + (b.tx - a.tx) * f, ty: a.ty + (b.ty - a.ty) * f, sc: a.sc + (b.sc - a.sc) * f}; } }
  return kf[n-1];
}

// Gibt das fertige Ergebnis als Blob/File zurück; job: {cancel, progress, message}
export async function render(plan, fileOf, job){
  await ensureEncoders();
  const video = plan.format !== 'audio';
  const W = Math.max(2, (plan.width | 0) & ~1), H = Math.max(2, (plan.height | 0) & ~1);
  const fps = clamp(+plan.fps || 30, 1, 120);
  const segs = (plan.segments || []).map(s => { const fx = s.kind === 'main' ? segFx(s) : {...FX_DEF, vol: clamp(s.vol == null ? 1 : +s.vol, 0, 8)};
    return {...s, fx, d: Math.max(0.04, (s.out - s.in) / fx.speed)}; });
  const total = segs.reduce((a, s) => a + s.d, 0);
  const af = video ? null : (AUDIO_FMT[plan.audioFormat] || AUDIO_FMT.wav);
  const ext = video ? 'mp4' : af.ext, mime = video ? 'video/mp4' : af.mime;

  // Ziel: Datei im privaten Browser-Speicher (große Exporte), sonst Arbeitsspeicher
  let handle = null, writable = null, target;
  try {
    const root = await navigator.storage.getDirectory();
    handle = await root.getFileHandle(`export-${Date.now()}.${ext}`, {create:true});
    writable = await handle.createWritable();
    target = new StreamTarget(writable, {chunked:true, chunkSize: 8 << 20});
  } catch(_){ handle = null; writable = null; target = new BufferTarget(); }
  const format = video ? new Mp4OutputFormat({fastStart: writable ? false : 'in-memory'}) : af.fmt(total * SR * 4 > 3.5e9, !!writable);
  const output = new Output({format, target});

  let canvas = null, ctx = null, vsrc = null;
  if (video){
    const codec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], {width:W, height:H});
    if (!codec) throw new Error('Dieser Browser kann kein Video in dieser Größe kodieren. Versuche eine kleinere Auflösung oder einen anderen Browser (z. B. Chrome oder Edge).');
    canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
    ctx = canvas.getContext('2d', {alpha:false});
    vsrc = new CanvasSource(canvas, {codec, quality: new Quality(QUAL[plan.quality] || 'high'), keyFrameInterval:2});
    output.addVideoTrack(vsrc, {frameRate: fps});
  }
  const asrc = new AudioSampleSource({codec: video ? 'aac' : af.codec, quality: new Quality({bitrate:192e3})});
  output.addAudioTrack(asrc);
  await output.start();

  const A = new AudioWriter(asrc);
  A.mix = await overlayAudio(plan, fileOf, job);
  const voiceState = new Map();   // Stimme aufbereiten: Rauschschätzung je Aufnahme, wandert von Abschnitt zu Abschnitt
  const totalFrames = Math.ceil(total * fps - 1e-6);
  let frame = 0, o = 0;
  const t0 = performance.now();
  const report = done => {
    job.progress = clamp(done, 0, 1);
    const el = (performance.now() - t0) / 1000, rest = done > 0.02 ? el / done - el : 0;
    job.message = `Exportiere ${fmt(done * total)} von ${fmt(total)}` + (rest > 2 ? ` · noch ca. ${fmt(rest)}` : '');
  };
  const R = video ? new Renderer(ctx, W, H, fps, plan, fileOf) : null;
  if (R) await R.loadFonts();
  try {
    for (const s of segs){
      if (job.cancel) throw new Error('Abgebrochen');
      // Ton dieses Abschnitts (exakt auf Abtastwerte gerundet, damit Bild und Ton nicht auseinanderlaufen)
      const n = Math.round((o + s.d) * SR) - A.pos;
      await segmentAudio(s, n, fileOf, A, job, voiceState);
      if (video){
        const f1 = Math.ceil((o + s.d) * fps - 1e-6);
        const list = []; for (let f = frame; f < f1 && f < totalFrames; f++) list.push(f);
        await R.segment(s, o, list, async f => {
          await vsrc.add(f / fps, 1 / fps);
          if (job.cancel) throw new Error('Abgebrochen');
          if (f % 5 === 0) report(f / totalFrames);
        });
        frame = Math.max(frame, f1);
      } else report((o + s.d) / total);
      o += s.d;
    }
    await A.flush();
    if (vsrc) vsrc.close(); asrc.close();
    job.message = 'Datei wird fertiggestellt …';
    await output.finalize();
  } catch(e){
    try { await output.cancel(); } catch(_){}
    if (handle) try { (await navigator.storage.getDirectory()).removeEntry(handle.name); } catch(_){}
    throw e;
  } finally { if (R) R.close(); }
  const blob = handle ? await handle.getFile() : new Blob([output.target.buffer], {type:mime});
  return {blob, ext, mime, opfsName: handle ? handle.name : null};
}
const fmt = t => { t = Math.max(0, Math.round(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };

// Sammelt Stereo-Abtastwerte und gibt sie in 1-s-Blöcken an den Encoder
class AudioWriter {
  constructor(src){ this.src = src; this.written = 0; this.L = new Float32Array(SR); this.R = new Float32Array(SR); this.n = 0; }
  async push(L, R){
    let i = 0;
    while (i < L.length){
      const k = Math.min(L.length - i, SR - this.n);
      this.L.set(L.subarray(i, i + k), this.n); this.R.set(R.subarray(i, i + k), this.n);
      this.n += k; i += k;
      if (this.n === SR) await this.flush();
    }
  }
  async silence(n){ const z = new Float32Array(Math.min(n, SR)); while (n > 0){ const k = Math.min(n, SR); await this.push(z.subarray(0, k), z.subarray(0, k)); n -= k; } }
  async flush(){
    if (!this.n) return;
    // Ton der Einblendungen an ihrer Stelle dazumischen
    for (const m of this.mix || []){
      const a = Math.max(this.written, m.start), b = Math.min(this.written + this.n, m.start + m.L.length);
      for (let p = a; p < b; p++){ const i = p - this.written, j = p - m.start; this.L[i] += m.L[j]; this.R[i] += m.R[j]; }
    }
    const d = new Float32Array(this.n * 2); d.set(this.L.subarray(0, this.n), 0); d.set(this.R.subarray(0, this.n), this.n);
    const s = new AudioSample({data:d, format:'f32-planar', numberOfChannels:2, sampleRate:SR, timestamp: this.written / SR});
    this.written += this.n; this.n = 0;
    await this.src.add(s); s.close();
  }
  get pos(){ return this.written + this.n; }
}

// Ton der Einblendungen mit Lautstärke > 0, fertig auf 48 kHz und mit Lautstärke
async function overlayAudio(plan, fileOf, job){
  const out = [];
  for (const o of plan.overlays || []){
    const vol = +o.vol || 0; if (vol <= 0 || o.image || o.hasAudio === false) continue;
    const file = fileOf(o.uri); if (!file || !(await audioTrack(file))) continue;
    if (job) job.message = 'Ton der Einblendungen wird vorbereitet …';
    const parts = []; let len = 0, rs = null;
    for await (const c of sourceAudio(file, +o.in, +o.out)){ rs ||= new Resampler(c.sr); const p = rs.push(c.L, c.R); parts.push(p); len += p[0].length; }
    const L = new Float32Array(len), R = new Float32Array(len); let q = 0;
    for (const [a, b] of parts){ L.set(a, q); R.set(b, q); q += a.length; }
    const fade = Math.min(480, len >> 2), start = Math.round(+o.at * SR), dk = o.duck ? gainRun(plan.duck) : null;   // dk: Tonspur weicht der Sprache
    for (let i = 0; i < len; i++){ let g = vol; if (i < fade) g *= i / fade; else if (i >= len - fade) g *= (len - 1 - i) / fade; if (dk) g *= dk((start + i) / SR); L[i] *= g; R[i] *= g; }
    out.push({start, L, R});
  }
  return out;
}
// Stückweise linearer Verlauf [[t, g], …] (Werte 0…1) als Funktion der Zeit. Für fortlaufend steigende Zeiten gedacht: Die
// Funktion merkt sich die Stelle im Verlauf. Vor dem ersten und nach dem letzten Punkt gilt deren Wert.
export function gainRun(pts){
  const p = (Array.isArray(pts) ? pts : []).map(q => [+q[0], clamp(+q[1], 0, 1)]).filter(q => q[0] === q[0] && q[1] === q[1]).sort((a, b) => a[0] - b[0]);
  const n = p.length; if (!n) return null; let k = 0;
  return t => {
    if (t <= p[0][0]) return p[0][1]; if (t >= p[n - 1][0]) return p[n - 1][1];
    if (t < p[k][0]) k = 0; while (k < n - 2 && t >= p[k + 1][0]) k++;
    const a = p[k], b = p[k + 1], w = b[0] - a[0]; return w > 1e-9 ? a[1] + (b[1] - a[1]) * (t - a[0]) / w : b[1];
  };
}
// Dekodierter Ton eines Zeitbereichs (Quelle in Sekunden), als Stereo-Stücke in Originalrate
async function* sourceAudio(file, a, b){
  const tr = await audioTrack(file); if (!tr) return;
  const off = await firstTs(file);
  let expect = a;
  for await (const s of new AudioSampleSink(tr).samples(a + off, b + off)){
    const sr = s.sampleRate, n = s.numberOfFrames, ch = s.numberOfChannels, ts = s.timestamp - off;
    const L = new Float32Array(n); s.copyTo(L, {format:'f32-planar', planeIndex:0});
    let R = L; if (ch > 1){ R = new Float32Array(n); s.copyTo(R, {format:'f32-planar', planeIndex:1}); }
    s.close();
    const i0 = clamp(Math.round((a - ts) * sr), 0, n), i1 = clamp(Math.round((b - ts) * sr), 0, n);
    if (i1 <= i0) continue;
    const t = ts + i0 / sr;
    if (t > expect + 0.02){ const z = new Float32Array(Math.round((t - expect) * sr)); yield {L:z, R:z, sr}; }
    yield {L:L.subarray(i0, i1), R:R.subarray(i0, i1), sr};
    expect = ts + i1 / sr;
  }
}
// Linear umrechnen auf 48 kHz, fortlaufend
class Resampler {
  constructor(from){ this.r = from / SR; this.pos = 0; this.pl = 0; this.pr = 0; }
  push(L, R){
    if (Math.abs(this.r - 1) < 1e-9) return [L, R];
    const n = L.length, r = this.r, cap = Math.ceil((n - this.pos) / r) + 2, oL = new Float32Array(cap), oR = new Float32Array(cap);
    let k = 0, pos = this.pos;
    while (pos <= n - 1){
      const i = Math.floor(pos), f = pos - i;
      const l0 = i < 0 ? this.pl : L[i], r0 = i < 0 ? this.pr : R[i];
      const l1 = i + 1 < n ? L[i + 1] : l0, r1 = i + 1 < n ? R[i + 1] : r0;
      oL[k] = l0 + (l1 - l0) * f; oR[k] = r0 + (r1 - r0) * f; k++; pos += r;
    }
    this.pos = pos - n; this.pl = L[n - 1]; this.pr = R[n - 1];
    return [oL.subarray(0, k), oR.subarray(0, k)];
  }
}
// Tempo ändern ohne Tonhöhe zu verändern (WSOLA)
function stretch(L, R, speed){
  const N = Math.round(SR * 0.04), Hs = N >> 1, Ha = Hs * speed, tol = Math.round(SR * 0.012);
  const outLen = Math.floor(L.length / speed), oL = new Float32Array(outLen + N), oR = new Float32Array(outLen + N);
  const win = new Float32Array(N); for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);
  const M = new Float32Array(L.length); for (let i = 0; i < L.length; i++) M[i] = L[i] + R[i];
  let prev = 0;
  for (let k = 0; k * Hs < outLen; k++){
    const nominal = Math.round(k * Ha);
    let best = clamp(nominal, 0, Math.max(0, L.length - N));
    if (k > 0){
      const ref = prev + Hs; let bestC = -Infinity;
      for (let d = -tol; d <= tol; d += 2){
        const p = nominal + d; if (p < 0 || p + N > L.length || ref + N > L.length) continue;
        let c = 0; for (let i = 0; i < N; i += 8) c += M[p + i] * M[ref + i];
        if (c > bestC){ bestC = c; best = p; }
      }
    }
    const o = k * Hs;
    for (let i = 0; i < N; i++){ const p = best + i; if (p >= L.length) break; oL[o + i] += L[p] * win[i]; oR[o + i] += R[p] * win[i]; }
    prev = best;
  }
  return [oL.subarray(0, outLen), oR.subarray(0, outLen)];
}
// Stimme aufbereiten (Abschnitte mit s.voice): Der Rechenkern steht in app.js (voiceDspLib) – derselbe wie in der Vorschau.
// push() nimmt Stereo-Stücke bei 48 kHz an und gibt zurück, was fertig ist; end() liefert den Rest. Beim ersten Abschnitt einer
// Aufnahme werden bis zu zwei Sekunden zurückgehalten, aus denen die Rauschschätzung lernt.
function voiceRun(s, state){
  if (!s.voice || !state || typeof globalThis.voiceDspLib !== 'function') return null;
  const lib = (voiceRun.lib ||= globalThis.voiceDspLib()), key = String(s.voice.k ?? s.uri);
  const lvl = (Array.isArray(s.voice.lvl) ? s.voice.lvl : []).map(p => [+p[0], clamp(+p[1], 0.1, 4)]).filter(p => p[0] === p[0] && p[1] === p[1]).sort((a, b) => a[0] - b[0]);
  const dsp = new lib.VoiceDsp(SR, 2, state.get(key) || null); dsp.setLevel(lvl, 1);
  const need = Math.floor(lib.V.prime * SR); let hold = dsp.noise ? null : [], held = 0;
  const begin = () => {
    const L = new Float32Array(held), R = new Float32Array(held); let q = 0; for (const [a, b] of hold){ L.set(a, q); R.set(b, q); q += a.length; }
    hold = null; dsp.prime([L, R], Math.min(held, need)); return dsp.feed([L, R], held);
  };
  return {
    push(L, R){ if (!hold) return dsp.feed([L, R], L.length); hold.push([L.slice(), R.slice()]); held += L.length; return held >= need ? begin() : [new Float32Array(0), new Float32Array(0)]; },
    end(){ const a = hold ? begin() : null, b = dsp.finish(); state.set(key, dsp.noise);
      if (!a) return b; const L = new Float32Array(a[0].length + b[0].length), R = new Float32Array(L.length); L.set(a[0]); L.set(b[0], a[0].length); R.set(a[1]); R.set(b[1], a[1].length); return [L, R]; },
  };
}
async function segmentAudio(s, n, fileOf, A, job, voiceState){
  if (n <= 0) return;
  const has = s.hasAudio !== false && !s.image;
  const file = has ? fileOf(s.uri) : null;
  if (!file || !(await audioTrack(file))){ await A.silence(n); return; }
  const {speed, vol} = s.fx, fade = Math.min(Math.round(0.008 * SR), Math.floor(n / 4));
  let w = 0;
  const emit = async (L, R) => {
    const k = Math.min(L.length, n - w); if (k <= 0) return;
    const oL = new Float32Array(k), oR = new Float32Array(k);
    for (let i = 0; i < k; i++){
      const idx = w + i; let g = vol;
      if (idx < fade) g *= idx / fade; else if (idx >= n - fade) g *= Math.max(0, (n - 1 - idx) / fade);
      oL[i] = L[i] * g; oR[i] = R[i] * g;
    }
    w += k; await A.push(oL, oR);
  };
  let rs = null;
  const vr = voiceRun(s, voiceState);   // Stimme aufbereiten: vor Tempo, Lautstärke und Blenden
  if (Math.abs(speed - 1) < 1e-3){
    for await (const c of sourceAudio(file, s.in, s.out)){
      if (job.cancel) throw new Error('Abgebrochen');
      rs ||= new Resampler(c.sr); let [L, R] = rs.push(c.L, c.R); if (vr) [L, R] = vr.push(L, R); await emit(L, R);
      if (w >= n) break;
    }
    if (vr){ const [L, R] = vr.end(); await emit(L, R); }
  } else {
    const parts = []; let len = 0;
    for await (const c of sourceAudio(file, s.in, s.out)){ rs ||= new Resampler(c.sr); let p = rs.push(c.L, c.R); if (vr) p = vr.push(p[0], p[1]); parts.push(p); len += p[0].length; }
    if (vr){ const p = vr.end(); parts.push(p); len += p[0].length; }
    const L = new Float32Array(len), R = new Float32Array(len); let q = 0;
    for (const [a, b] of parts){ L.set(a, q); R.set(b, q); q += a.length; }
    const [sL, sR] = stretch(L, R, speed); await emit(sL, sR);
  }
  if (w < n) await A.silence(n - w);
}

// Zeichnet Bild für Bild: Hauptspur (eingepasst), Zoom, Farben, B-Roll/Bild-im-Bild, Titel und Untertitel
class Renderer {
  constructor(ctx, W, H, fps, plan, fileOf){
    this.ctx = ctx; this.W = W; this.H = H; this.fps = fps; this.fileOf = fileOf;
    this.sinks = new Map();
    this.base = document.createElement('canvas'); this.base.width = W; this.base.height = H; this.bctx = this.base.getContext('2d', {alpha:false});
    this.ovs = (plan.overlays || []).filter(o => o.mode !== 'audio').map(o => ({...o, at:+o.at, d: Math.max(0.05, o.out - o.in)})).sort((a, b) => (a.track || 1) - (b.track || 1) || a.at - b.at);
    this.ovState = new Map();
    // Unkenntlich gemachte Bereiche (plan.blurs): wirken auf alles Bildmaterial; Einblendungen mit top (Formen, Fortschrittsbalken) liegen darüber
    this.blurs = (plan.blurs || []).filter(b => b && +b.d > 0.02 && +b.w > 0).map(b => { const kf = Array.isArray(b.kf) && b.kf.length >= 2 ? b.kf.map(k => ({t:+k.t, x:+k.x, y:+k.y, w:+k.w})).sort((p, q) => p.t - q.t) : null;
      return {at:+b.at, d:+b.d, x:+b.x, y:+b.y, w:+b.w, kf, a: Math.max(0.02, +b.aspect || 1), cell: Math.max(2, (+b.cell || 0.02) * W), soft: b.kind === 'soft', ellipse: b.form === 'ellipse',
        wmax: Math.max(+b.wmax || 0, +b.w, ...(kf || []).map(k => k.w))}; });
    this.fxTmp = [];
    // Übergänge: Bild-Ebenen direkt über der Hauptspur (plan.trans), je mit einem Abschnitt im Aufbau der Hauptspur
    // Sichtbar von t0 bis t1: das Fenster [at, at + d) mit der Deckkraft a0 → a1, davor und dahinter der bildgleiche Vor- und
    // Nachlauf (lead, tail) mit dem Randwert – so sitzt der Schnitt auch bei gerundeten Zeiten im Plan bildgenau.
    this.trans = (plan.trans || []).filter(j => j && j.seg && +j.d >= 0.04).map(j => { const lead = Math.max(0, +j.lead || 0), tail = Math.max(0, +j.tail || 0);
      return {at:+j.at, d:+j.d, t0: +j.at - lead, t1: +j.at + +j.d + tail, a0: j.a0 == null ? 1 : clamp(+j.a0, 0, 1), a1: j.a1 == null ? 1 : clamp(+j.a1, 0, 1),
        seg: {...j.seg, fx: j.seg.kind === 'main' ? segFx(j.seg) : {...FX_DEF}}}; }).sort((a, b) => a.t0 - b.t0);
    this.jnState = new Map();
    const subs = plan.subs || {}, style = subs.style || {};
    this.style = style;
    this.cues = (subs.cues || []).filter(c => c.title || plan.burn !== false).map(c => ({...c, start:+c.start, end:+c.end})).filter(c => (c.text || '').trim() && c.end - c.start > 0.05);
    this.font = (getComputedStyle(document.body).getPropertyValue('--ui') || '').trim() || 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
    this.fonts = subs.fonts || {};
    this.canFilter = 'filter' in ctx;
  }
  // Schriften der Untertitel/Titel (im Kern als TSF-<Schlüssel> angemeldet) vor dem ersten Bild laden
  async loadFonts(){
    try { await Promise.all(Object.keys(this.fonts).map(k => document.fonts.load(`400 48px "TSF-${k}"`, 'Aä1'))); } catch(_){}
  }
  fontOf(key, def){ return key && this.fonts[key] ? `400 %spx "TSF-${key}", ${this.font}` : `${def} %spx ${this.font}`; }
  sink(file, track, w, h, fit, tag = ''){   // tag: eigener Bildpuffer (Übergänge lesen dieselbe Datei zur selben Zeit wie die Hauptspur)
    const k = w + 'x' + h + fit + tag; let m = this.sinks.get(file); if (!m){ m = new Map(); this.sinks.set(file, m); }
    if (!m.has(k)) m.set(k, new CanvasSink(track, {width:w, height:h, fit, poolSize:3}));
    return m.get(k);
  }
  // Größe des Grundbilds für einen Abschnitt. Vergrößerter Bildausschnitt (z. B. 9:16 aus 16:9): Grundbild in höherer
  // Auflösung holen, damit nichts unscharf hochskaliert wird
  baseSize(s){
    const {W, H} = this, scMax = s.kind === 'main' ? Math.max(s.fx.sc, ...((s.fx.kf || []).map(k => k.sc))) : 1;
    const kq = scMax > 1.001 ? Math.min(scMax, 4096 / Math.max(W, H)) : 1;
    return [Math.max(2, Math.round(W * kq / 2) * 2), Math.max(2, Math.round(H * kq / 2) * 2)];
  }
  // Bildquelle eines Abschnitts: Foto oder die Videobilder zu den Quellzeiten times (in dieser Reihenfolge abzuholen)
  async openSeg(s, BW, BH, times, tag){
    const file = s.hasVideo === false ? null : this.fileOf(s.uri), q = {bm: null, it: null, last: null};
    if (s.kind === 'main' && s.key && s.key.bgImg){ const bf = this.fileOf(s.key.bgImg); if (bf) try { q.bg = await bitmapOf(bf); } catch(_){} }
    if (file && (s.image || isImageFile(file))) q.bm = await bitmapOf(file);
    else if (file){
      const tr = await videoTrack(file);
      if (tr){ const off = await firstTs(file); q.it = this.sink(file, tr, BW, BH, 'contain', tag).canvasesAtTimestamps(times.map(t => off + t))[Symbol.asyncIterator](); }
    }
    return q;
  }
  // Bild eines Abschnitts zur Quellzeit st auf ctx zeichnen: eingepasst, freigestellt, mit Lage, Zoom und Farben.
  // q: Bildquelle (openSeg) · base/bctx: Zwischenbild in der Größe des Grundbilds · slot: Kennung fürs Freistellen
  paintSeg(ctx, s, st, q, base, bctx, slot){
    const {W, H} = this, BW = base.width, BH = base.height;
    bctx.fillStyle = '#000'; bctx.fillRect(0, 0, BW, BH);
    if (q.bm) drawFit(bctx, q.bm, 0, 0, BW, BH, false); else if (q.last) bctx.drawImage(q.last, 0, 0);
    // freigestellt: Der Hintergrund (Farbe oder Bild) füllt die ganze Fläche, das Hauptbild liegt durchsichtig darüber
    const keyed = s.kind === 'main' && s.key ? this.keyed(base, {...s.key, bg: null}, slot, 4096) : null, wb = s.kind === 'main' ? s.fx.wb : null;
    const img = keyed || base;
    ctx.fillStyle = keyed && keyed !== base ? (s.key.bg || '#000000') : '#000'; ctx.fillRect(0, 0, W, H);
    if (keyed && keyed !== base && q.bg) drawFit(ctx, q.bg, 0, 0, W, H, true);
    const flt = s.kind === 'main' ? ((wb && this.canFilter ? wbFilter(wb) + ' ' : '') + cssFilter(s.fx)).trim() : '';
    const z = s.kind === 'main' ? zoomAt(s.zooms, st) : {s:1};
    if (flt && this.canFilter) ctx.filter = flt;
    const mf = s.kind === 'main' ? mainAt(s.fx, st - s.in) : s.fx;
    const tf = s.kind === 'main' && (Math.abs(mf.sc - 1) > 1e-3 || mf.tx || mf.ty);
    if (tf){ ctx.save(); ctx.translate(W / 2 + mf.tx * W, H / 2 + mf.ty * H); ctx.scale(mf.sc, mf.sc); ctx.translate(-W / 2, -H / 2); }
    if (z.s > 1.001){ const sw = BW / z.s, sh = BH / z.s; ctx.drawImage(img, z.cx * BW * (1 - 1 / z.s), z.cy * BH * (1 - 1 / z.s), sw, sh, 0, 0, W, H); }
    else ctx.drawImage(img, 0, 0, W, H);
    if (tf) ctx.restore();
    if (flt && this.canFilter) ctx.filter = 'none';
    if ((flt || wb) && !this.canFilter) manualFx(ctx, W, H, s.fx);
  }
  async segment(s, o, frames, add){
    if (!frames.length) return;
    const {ctx, fps} = this, speed = s.fx.speed;
    const [BW, BH] = this.baseSize(s);
    if (this.base.width !== BW || this.base.height !== BH){ this.base.width = BW; this.base.height = BH; this.bctx = this.base.getContext('2d', {alpha:false}); }
    const q = await this.openSeg(s, BW, BH, frames.map(f => s.in + (f / fps - o) * speed), '');
    try {
      for (const f of frames){
        const t = f / fps, st = s.in + (t - o) * speed;
        if (q.it){ const r = await q.it.next(); if (r.value) q.last = r.value.canvas; }
        this.paintSeg(ctx, s, st, q, this.base, this.bctx, 'main');
        await this.joins(t);
        await this.overlays(t);
        this.text(t);
        await add(f);
      }
    } finally { if (q.it && q.it.return) await q.it.return(); }
  }
  // Übergänge: Über das Bild der Hauptspur kommt das Bild des anderen Clips (sein Material beginnt bei t0)
  async joins(t){
    const {ctx, W, H, fps} = this;
    for (const j of this.trans){
      if (t < j.t0 - 1e-6 || t >= j.t1){ if (t >= j.t1) this.endJoin(j); continue; }
      const s = j.seg, sp = s.fx.speed, src = u => s.in + (u - j.t0) * sp;
      let st = this.jnState.get(j);
      if (!st){
        const [BW, BH] = this.baseSize(s), ts = [];
        for (let f = Math.ceil(t * fps - 1e-6); f / fps < j.t1; f++) ts.push(src(f / fps));
        st = await this.openSeg(s, BW, BH, ts, 'j');
        st.base = document.createElement('canvas'); st.base.width = BW; st.base.height = BH; st.bctx = st.base.getContext('2d', {alpha:false});
        this.jnState.set(j, st);
      }
      if (st.done) continue;
      if (st.it){ const r = await st.it.next(); if (r.value) st.last = r.value.canvas; }
      if (!this.jc){ this.jc = document.createElement('canvas'); this.jc.width = W; this.jc.height = H; this.jx = this.jc.getContext('2d', {alpha:false}); }
      this.paintSeg(this.jx, s, src(t), st, st.base, st.bctx, 'join');
      ctx.globalAlpha = clamp(j.a0 + (j.a1 - j.a0) * clamp((t - j.at) / j.d, 0, 1), 0, 1);
      ctx.drawImage(this.jc, 0, 0);
      ctx.globalAlpha = 1;
    }
  }
  endJoin(j){ const st = this.jnState.get(j); if (st && !st.done){ st.done = true; if (st.it && st.it.return) st.it.return(); st.base = st.bctx = st.last = null; } }
  async overlays(t){
    const {ctx, W, H, fps} = this;
    let blurred = !this.blurs.length;
    for (const o of this.ovs){
      if (!blurred && o.top){ this.blurAll(t); blurred = true; }
      if (t < o.at - 1e-6 || t >= o.at + o.d) { if (t >= o.at + o.d) this.endOverlay(o); continue; }
      let rect, sinkWH = null;
      if (o.w != null){
        const a = Math.max(0.05, +o.aspect || 16 / 9), v = o.kf && o.kf.length ? kfAt(o.kf, t - o.at) : o;
        const pw = Math.max(2, Math.round(W * v.w / 2) * 2), ph = Math.max(2, Math.round(pw / a / 2) * 2);
        rect = [Math.round(v.x * W - pw / 2), Math.round(v.y * H - ph / 2), pw, ph];
        if (o.kf && o.kf.length){ const mw = Math.max(...o.kf.map(k => k.w)); const sw = Math.max(2, Math.round(Math.min(W * 2, W * mw) / 2) * 2); sinkWH = [sw, Math.max(2, Math.round(sw / a / 2) * 2)]; }
      } else if (o.mode === 'pip'){
        const sz = +o.size || 0.33, pw = Math.max(2, Math.round(W * sz / 2) * 2), ph = Math.max(2, Math.round(H * sz / 2) * 2), m = Math.round(0.03 * W), c = o.corner || 'or';
        rect = [c[1] === 'r' ? W - pw - m : m, c[0] === 'o' ? m : H - ph - m, pw, ph];
      } else rect = [0, 0, W, H];
      // Zuschnitt: Bild/Video in voller Größe holen und nur den Ausschnitt zeichnen
      const cr = o.crop, cl = cr ? +cr.l || 0 : 0, ct = cr ? +cr.t || 0 : 0, cw = cr ? Math.max(0.02, 1 - cl - (+cr.r || 0)) : 1, chh = cr ? Math.max(0.02, 1 - ct - (+cr.b || 0)) : 1;
      if (cr){ const b = sinkWH || [rect[2], rect[3]], f = Math.min(1, 4096 / Math.max(b[0] / cw, b[1] / chh)); sinkWH = [Math.max(2, Math.round(b[0] / cw * f / 2) * 2), Math.max(2, Math.round(b[1] / chh * f / 2) * 2)]; }
      let st = this.ovState.get(o);
      if (!st){
        st = {last:null}; this.ovState.set(o, st);
        const file = this.fileOf(o.uri);
        if (file && (o.image || isImageFile(file))) st.bm = await bitmapOf(file);
        else if (file){
          const tr = await videoTrack(file);
          if (tr){
            const off = await firstTs(file), ts = [];
            for (let f = Math.ceil(t * fps - 1e-6); f / fps < o.at + o.d; f++) ts.push(off + o.in + (f / fps - o.at));
            st.it = this.sink(file, tr, (sinkWH || rect)[0], (sinkWH || rect)[1], 'cover').canvasesAtTimestamps(ts)[Symbol.asyncIterator]();
          }
        }
      }
      if (st.it){ const r = await st.it.next(); if (r.value) st.last = r.value.canvas; }
      let im = st.bm || st.last;
      if (im && o.key) im = this.keyed(im, o.key, o, 2048);   // freigestellt (Greenscreen)
      if (!im) continue;
      const op = o.opacity != null ? +o.opacity : 1; if (op < 0.999) ctx.globalAlpha = Math.max(0, op);
      if (cr){ const iw = im.width, ih = im.height; ctx.drawImage(im, cl * iw, ct * ih, cw * iw, chh * ih, rect[0], rect[1], rect[2], rect[3]); }
      else if (st.bm) drawFit(ctx, im, ...rect, true);
      else ctx.drawImage(im, rect[0], rect[1], rect[2], rect[3]);
      ctx.globalAlpha = 1;
    }
    if (!blurred) this.blurAll(t);
  }
  // Bereiche zur Zeit t unkenntlich machen: Fenster in der größten Größe des Bereichs um seine Mitte, im Bild gehalten
  blurAll(t){
    const {ctx, W, H} = this;
    for (const b of this.blurs){
      if (t < b.at - 1e-6 || t >= b.at + b.d) continue;
      const v = b.kf ? kfAt(b.kf, t - b.at) : b, rw = v.w * W, rh = rw / b.a;
      const ww = Math.min(W, Math.max(2, Math.ceil(b.wmax * W / 2) * 2)), wh = Math.min(H, Math.max(2, Math.ceil(b.wmax * W / b.a / 2) * 2));
      const wx = clamp(Math.trunc((v.x * W - ww / 2) / 2) * 2, 0, W - ww), wy = clamp(Math.trunc((v.y * H - wh / 2) / 2) * 2, 0, H - wh);
      regionFx(ctx, ctx.canvas, [wx, wy, ww, wh], [v.x * W - rw / 2, v.y * H - rh / 2, rw, rh], b.cell, b.soft, b.ellipse, this.fxTmp);
    }
  }
  // Freistellen per Farbschlüssel: dieselbe Rechnung wie in der Vorschau (chroma.js); liefert eine Leinwand mit dem freigestellten Bild
  keyed(im, key, slot, cap){
    const CG = typeof ChromaGL !== 'undefined' ? ChromaGL : (typeof window !== 'undefined' ? window.ChromaGL : null); if (!CG) return im;
    this.keyGL ||= new Map(); let g = this.keyGL.get(slot);
    if (!g){ try { g = CG.create(2, 2); } catch(_){ g = null; } if (!g) return im; this.keyGL.set(slot, g); }
    const iw = im.width, ih = im.height, f = Math.min(1, cap / Math.max(iw, ih));
    return g.draw(im, key, Math.max(2, Math.round(iw * f)), Math.max(2, Math.round(ih * f))) ? g.canvas : im;
  }
  endOverlay(o){ const st = this.ovState.get(o); if (st && st.it && !st.done){ st.done = true; st.it.return && st.it.return(); } }
  text(t){
    const act = this.cues.filter(c => t >= c.start && t < c.end); if (!act.length) return;
    const {ctx, W, H} = this, st = this.style, port = H > W ? 1.25 : 1;
    for (const c of act){
      const size = (c.size ? c.size : (SIZE_F[st.size] || 0.058)) * Math.min(W, H) * port;
      ctx.font = this.fontOf(c.title || c.font != null ? c.font : st.font, c.title ? 800 : 700).replace('%s', size.toFixed(1));
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const rows = wrapRows(ctx, String(c.text), W * (c.title ? 0.92 : 0.88));
      const lh = size * 1.12, bw = Math.max(...rows.map(r => ctx.measureText(r).width)), bh = rows.length * lh, m = 0.02;
      let cx = (c.x ?? 0.5) * W, cy = (c.y ?? 0.88) * H;
      if (!c.title){
        cx = bw > W * (1 - 2 * m) ? W / 2 : clamp(cx, bw / 2 + m * W, W - bw / 2 - m * W);
        cy = clamp(cy, bh / 2 + m * H, H - bh / 2 - m * H);
      }
      const outline = c.outline != null ? c.outline !== false : c.title ? true : st.outline !== false, color = c.color || (c.title ? '' : st.color) || '#FFFFFF';
      if (c.bg){
        const px = size * 0.3, py = size * 0.1, r = size * 0.15;
        ctx.fillStyle = 'rgba(0,0,0,.55)'; roundRect(ctx, cx - bw / 2 - px, cy - bh / 2 - py, bw + 2 * px, bh + 2 * py, r); ctx.fill();
      }
      const ocol = c.outlineColor || (c.title ? '#000' : st.outlineColor) || '#000';
      if (c.words || c.spans || c.anim){ this.textFx(c, t, rows, {size, lh, bw, bh, cx, cy, outline, color, ocol}); continue; }
      rows.forEach((row, k) => {
        const y = cy - bh / 2 + lh * (k + 0.5);
        if (outline){ ctx.lineJoin = 'round'; ctx.miterLimit = 2; ctx.lineWidth = 2 * Math.max(1, size / 14); ctx.strokeStyle = c.outlineColor || (c.title ? '#000' : st.outlineColor) || '#000'; ctx.strokeText(row, cx, y); }
        else if (!c.title){ ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = size / 10; ctx.shadowOffsetY = size / 20; }
        ctx.fillStyle = color; ctx.fillText(row, cx, y);
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      });
    }
  }
  // Untertitel mit Effekten (2.32): Farbe und Sichtbarkeit je Wort, Einblenden oder Aufpoppen am Anfang.
  // words = [[Beginn, Ende], …] für die ersten Wörter des Textes, hl = Farbe des gesprochenen Worts, build = Wörter erscheinen
  // erst beim Sprechen, spans = [[Wortnummer, Farbe], …], anim = fade | pop. Die Lage der Zeilen bleibt dabei fest.
  textFx(c, t, rows, o){
    const {ctx} = this, ws = c.words || [], spans = new Map((c.spans || []).map(s => [s[0], s[1]]));
    const A = 0.16, p = c.anim ? clamp((t - c.start) / A, 0, 1) : 1, tt = c.anim && t < c.start + A ? c.start : t;   // während der Animation gilt der Stand vom Anfang
    ctx.save();
    if (c.anim === 'fade') ctx.globalAlpha *= p;
    if (c.anim === 'pop'){ const s = 0.84 + 0.16 * p; ctx.translate(o.cx, o.cy); ctx.scale(s, s); ctx.translate(-o.cx, -o.cy); }
    ctx.textAlign = 'left';
    let i = 0;
    rows.forEach((row, k) => {
      const y = o.cy - o.bh / 2 + o.lh * (k + 0.5), x0 = o.cx - ctx.measureText(row).width / 2, parts = [];
      let pos = 0;
      for (const w of row.split(/\s+/).filter(Boolean)){
        const at = row.indexOf(w, pos); pos = at + w.length;
        let col = spans.get(i) || o.color, show = true;
        if (i < ws.length){ if (c.build && tt < ws[i][0] - 1e-6) show = false; else if (c.hl && tt >= ws[i][0] - 1e-6 && tt < ws[i][1] - 1e-6) col = c.hl; }
        if (show) parts.push({w, x: x0 + ctx.measureText(row.slice(0, at)).width, col});
        i++;
      }
      if (o.outline){ ctx.lineJoin = 'round'; ctx.miterLimit = 2; ctx.lineWidth = 2 * Math.max(1, o.size / 14); ctx.strokeStyle = o.ocol; for (const q of parts) ctx.strokeText(q.w, q.x, y); }
      else if (!c.title){ ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = o.size / 10; ctx.shadowOffsetY = o.size / 20; }
      for (const q of parts){ ctx.fillStyle = q.col; ctx.fillText(q.w, q.x, y); }
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    });
    ctx.restore();
  }
  close(){ for (const st of this.ovState.values()) if (st.it && !st.done && st.it.return) st.it.return(); for (const j of this.trans) this.endJoin(j); if (this.keyGL){ for (const g of this.keyGL.values()) g.destroy(); this.keyGL.clear(); } }
}
function wrapRows(ctx, text, maxW){
  const out = [];
  for (const line of text.split('\n')){
    const words = line.split(/\s+/).filter(Boolean); let cur = '';
    for (const w of words){ const t = cur ? cur + ' ' + w : w; if (cur && ctx.measureText(t).width > maxW){ out.push(cur); cur = w; } else cur = t; }
    out.push(cur);
  }
  return out;
}
function roundRect(ctx, x, y, w, h, r){ ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function drawFit(ctx, img, x, y, w, h, cover){
  const iw = img.width, ih = img.height, f = cover ? Math.max(w / iw, h / ih) : Math.min(w / iw, h / ih);
  const dw = iw * f, dh = ih * f;
  if (cover){ ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); ctx.restore(); }
  else ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}
// Für Browser ohne Canvas-Filter (ältere Safari): Farbanpassung pixelweise
function manualFx(ctx, W, H, fx){
  const img = ctx.getImageData(0, 0, W, H), d = img.data, b = 1 + fx.bright, c = 1 + fx.contrast, s = fx.gray ? 0 : 1 + fx.sat / 100, wb = fx.wb || [1, 1, 1];
  for (let i = 0; i < d.length; i += 4){
    let r = d[i] * wb[0] * b, g = d[i + 1] * wb[1] * b, bl = d[i + 2] * wb[2] * b;
    r = (r - 128) * c + 128; g = (g - 128) * c + 128; bl = (bl - 128) * c + 128;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    d[i] = l + (r - l) * s; d[i + 1] = l + (g - l) * s; d[i + 2] = l + (bl - l) * s;
  }
  ctx.putImageData(img, 0, 0);
}

// ───────── Vorschau-Datei für Formate, die der Browser nicht abspielt ─────────
// ───────── Automatisch freistellen: Person erkennen, Rest in Schlüsselgrün ─────────
// Die Personenerkennung kommt von MediaPipe (Selfie-Segmentierung) und wird beim ersten Mal aus dem Netz geladen;
// das Ergebnis ist ein normales Video mit grünem Hintergrund, das danach wie ein Greenscreen freigestellt wird.
const MP_VER = '0.10.14';
const MP_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}`;
const MP_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite';
export const MATTE_BG = '#00ff00';
let mpSeg = null;
async function segmenter(job){
  if (mpSeg) return mpSeg;
  job.message = 'Lade Personenerkennung (einmalig, ca. 10 MB) …';
  const mp = await import(/* webpackIgnore: true */ `${MP_CDN}/vision_bundle.mjs`);
  const vision = await mp.FilesetResolver.forVisionTasks(`${MP_CDN}/wasm`);
  const make = delegate => mp.ImageSegmenter.createFromOptions(vision, {baseOptions: {modelAssetPath: MP_MODEL, delegate}, runningMode: 'VIDEO', outputConfidenceMasks: true, outputCategoryMask: false});
  try { mpSeg = await make('GPU'); } catch(_){ mpSeg = await make('CPU'); }
  return mpSeg;
}
export async function autoMatte(file, job){
  await ensureEncoders();
  const v = await videoTrack(file); if (!v) throw new Error('Freistellen geht nur mit Videos.');
  const seg = await segmenter(job);
  const W = (await v.getDisplayWidth()) & ~1, H = (await v.getDisplayHeight()) & ~1, dur = await inputOf(file).input.computeDuration();
  let fps = 30; try { const st = await v.computePacketStats(120); if (st.averagePacketRate > 1 && st.averagePacketRate <= 120) fps = st.averagePacketRate; } catch(_){}
  const codec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], {width: W, height: H});
  if (!codec) throw new Error('Dieser Browser kann kein Video in dieser Größe kodieren.');
  let handle = null, writable = null, target;
  try { const root = await navigator.storage.getDirectory(); handle = await root.getFileHandle(`matte-${Date.now()}.mp4`, {create: true}); writable = await handle.createWritable(); target = new StreamTarget(writable, {chunked: true, chunkSize: 8 << 20}); }
  catch(_){ handle = null; writable = null; target = new BufferTarget(); }
  const output = new Output({format: new Mp4OutputFormat({fastStart: writable ? false : 'in-memory'}), target});
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H; const ctx = canvas.getContext('2d', {alpha: false});
  const vsrc = new CanvasSource(canvas, {codec, quality: new Quality('very-high'), keyFrameInterval: 2});
  output.addVideoTrack(vsrc, {frameRate: fps});
  const a = await audioTrack(file), asrc = a ? new AudioSampleSource({codec: 'aac', quality: new Quality({bitrate: 192e3})}) : null;
  if (asrc) output.addAudioTrack(asrc);
  await output.start();
  // Erkennung auf verkleinertem Bild (höchstens 512 px Kante), Maske wird weich hochskaliert
  const k = Math.min(1, 512 / Math.max(W, H)), sw = Math.max(2, Math.round(W * k)), sh = Math.max(2, Math.round(H * k));
  const small = document.createElement('canvas'); small.width = sw; small.height = sh; const sctx = small.getContext('2d', {alpha: false, willReadFrequently: true});
  const mask = document.createElement('canvas'); mask.width = sw; mask.height = sh; const mctx = mask.getContext('2d');
  const mimg = mctx.createImageData(sw, sh), md = mimg.data; for (let i = 0; i < md.length; i += 4){ md[i] = md[i + 1] = md[i + 2] = 255; }
  const off = await firstTs(file), t0 = performance.now();
  let n = 0, last = -1;
  try {
    const sink = new CanvasSink(v, {width: W, height: H, fit: 'contain', poolSize: 3});
    for await (const fr of sink.canvases()){
      if (job.cancel) throw new Error('Abgebrochen');
      const t = Math.max(0, fr.timestamp - off);
      sctx.drawImage(fr.canvas, 0, 0, sw, sh);
      const ms = Math.max(last + 1, Math.round(t * 1000)); last = ms;
      const res = seg.segmentForVideo(small, ms);
      try {
        const m = res.confidenceMasks && res.confidenceMasks[0]; if (m){
          const f = m.getAsFloat32Array(), mw = m.width, mh = m.height;
          if (mw === sw && mh === sh){ for (let i = 0, j = 3; i < f.length; i++, j += 4) md[j] = f[i] * 255; }
          else for (let y = 0; y < sh; y++){ const yy = Math.min(mh - 1, Math.floor(y * mh / sh)) * mw; for (let x = 0; x < sw; x++) md[(y * sw + x) * 4 + 3] = f[yy + Math.min(mw - 1, Math.floor(x * mw / sw))] * 255; }
        }
      } finally { if (res.close) res.close(); }
      mctx.putImageData(mimg, 0, 0);
      ctx.globalCompositeOperation = 'source-over'; ctx.drawImage(fr.canvas, 0, 0, W, H);
      ctx.globalCompositeOperation = 'destination-in'; ctx.drawImage(mask, 0, 0, W, H);
      ctx.globalCompositeOperation = 'destination-over'; ctx.fillStyle = MATTE_BG; ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
      await vsrc.add(t, fr.duration || 1 / fps);
      n++;
      if (n % 5 === 0){ job.progress = clamp(t / Math.max(0.1, dur), 0, 0.99); const el = (performance.now() - t0) / 1000, rest = t > 0.5 ? el / t * (dur - t) : 0;
        job.message = `Person wird freigestellt … ${fmt(t)} von ${fmt(dur)}` + (rest > 90 ? ` · noch ca. ${fmt(rest)}` : ''); }
    }
    vsrc.close();
    if (asrc){
      const A = new AudioWriter(asrc); await segmentAudio({uri: '', in: 0, out: dur, fx: {speed: 1, vol: 1}}, Math.round(dur * SR), () => file, A, job); await A.flush(); asrc.close();
    }
    job.message = 'Datei wird fertiggestellt …';
    await output.finalize();
  } catch(e){
    try { await output.cancel(); } catch(_){}
    if (handle) try { (await navigator.storage.getDirectory()).removeEntry(handle.name); } catch(_){}
    throw e;
  }
  const blob = handle ? await handle.getFile() : new Blob([output.target.buffer], {type: 'video/mp4'});
  return {blob, opfsName: handle ? handle.name : null, width: W, height: H, fps: +fps.toFixed(3), duration: +(+dur).toFixed(3), hasAudio: !!a, frames: n};
}

// Person im Bild halten (2.39): in festen Abständen ein verkleinertes Bild, die Maske der Person auf 32 × 18 Felder gemittelt.
// Aus den Masken rechnet die Oberfläche den Kameraweg (core/web/folgen.js). seg0: eigener Segmentierer (für die Prüfläufe).
export async function personTrack(file, job, seg0){
  const v = await videoTrack(file); if (!v) throw new Error('Die Person lässt sich nur in Videos verfolgen.');
  const seg = seg0 || await segmenter(job);
  const W = await v.getDisplayWidth(), H = await v.getDisplayHeight(), dur = await inputOf(file).input.computeDuration();
  if (!(dur > 0)) throw new Error('Das Video ließ sich nicht lesen.');
  const GW = 32, GH = 18, step = Math.max(0.25, Math.ceil(dur / 2400 * 20) / 20), n = Math.max(1, Math.floor(dur / step));
  const k = Math.min(1, 384 / Math.max(W, H)), sw = Math.max(32, Math.round(W * k)), sh = Math.max(32, Math.round(H * k));
  const small = document.createElement('canvas'); small.width = sw; small.height = sh; const sctx = small.getContext('2d', {alpha: false, willReadFrequently: true});
  const out = new Uint8Array(n * GW * GH), sum = new Float32Array(GW * GH), cnt = new Uint16Array(GW * GH);
  const off = await firstTs(file), times = Array.from({length: n}, (_, i) => i * step), sink = new CanvasSink(v, {width: sw, height: sh, fit: 'fill', poolSize: 2});
  job.message = 'Person wird gesucht …';
  let i = 0, last = -1;
  for await (const fr of sink.canvasesAtTimestamps(times.map(t => off + t))){
    if (job.cancel) throw new Error('Abgebrochen');
    if (fr){
      sctx.drawImage(fr.canvas, 0, 0, sw, sh);
      const ms = Math.max(last + 1, Math.round(times[i] * 1000)); last = ms;
      const res = seg.segmentForVideo(small, ms);
      try {
        const m = res.confidenceMasks && res.confidenceMasks[0];
        if (m){ const f = m.getAsFloat32Array(), mw = m.width, mh = m.height; sum.fill(0); cnt.fill(0);
          for (let y = 0; y < mh; y++){ const gy = Math.min(GH - 1, Math.floor(y * GH / mh)) * GW; for (let x = 0; x < mw; x++){ const c = gy + Math.min(GW - 1, Math.floor(x * GW / mw)); sum[c] += f[y * mw + x]; cnt[c]++; } }
          for (let c = 0; c < GW * GH; c++) out[i * GW * GH + c] = cnt[c] ? Math.round(clamp(sum[c] / cnt[c], 0, 1) * 255) : 0; }
      } finally { if (res.close) res.close(); }
    }
    i++; job.progress = Math.min(0.99, i / n); if (i % 8 === 0) job.message = `Person wird gesucht … ${Math.round(i * step)} von ${Math.round(dur)} s`;
  }
  let bin = ''; for (let p = 0; p < out.length; p += 0x8000) bin += String.fromCharCode.apply(null, out.subarray(p, p + 0x8000));
  return {step, w: GW, h: GH, n, data: btoa(bin)};
}

export async function makeProxy(file, job){
  await ensureEncoders();
  let handle = null, writable = null, target;
  try { const root = await navigator.storage.getDirectory(); handle = await root.getFileHandle(`proxy-${Date.now()}.mp4`, {create:true}); writable = await handle.createWritable(); target = new StreamTarget(writable, {chunked:true}); }
  catch(_){ handle = null; target = new BufferTarget(); }
  const output = new Output({format: new Mp4OutputFormat({fastStart: writable ? false : 'in-memory'}), target});
  const v = await videoTrack(file), h = v ? Math.min(720, await v.getDisplayHeight()) : 0;
  const conv = await Conversion.init({input: inputOf(file).input, output,
    video: v ? {height: h & ~1, codec:'avc', forceTranscode:true} : undefined, audio: {codec:'aac'}});
  if (!conv.isValid) throw new Error('Diese Datei kann der Browser leider nicht umwandeln.');
  conv.onProgress = p => { job.progress = p; job.message = `Vorschau wird erstellt … ${Math.round(p * 100)} %`; if (job.cancel) conv.cancel(); };
  await conv.execute();
  return {blob: handle ? await handle.getFile() : new Blob([output.target.buffer], {type:'video/mp4'}), opfsName: handle ? handle.name : null};
}
