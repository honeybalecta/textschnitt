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
function segFx(s){
  return {speed: clamp(+s.speed || 1, 0.25, 4), vol: clamp(s.vol == null ? 1 : +s.vol, 0, 4), bright:+s.bright || 0, contrast:+s.contrast || 0, sat:+s.sat || 0, gray:!!s.gray,
    tx:+s.tx || 0, ty:+s.ty || 0, sc: clamp(+s.sc || 1, 0.05, 4)};
}

// Gibt das fertige Ergebnis als Blob/File zurück; job: {cancel, progress, message}
export async function render(plan, fileOf, job){
  await ensureEncoders();
  const video = plan.format !== 'audio';
  const W = Math.max(2, (plan.width | 0) & ~1), H = Math.max(2, (plan.height | 0) & ~1);
  const fps = clamp(+plan.fps || 30, 1, 120);
  const segs = (plan.segments || []).map(s => { const fx = s.kind === 'main' ? segFx(s) : {...FX_DEF, vol: clamp(s.vol == null ? 1 : +s.vol, 0, 4)};
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
      await segmentAudio(s, n, fileOf, A, job);
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
    const fade = Math.min(480, len >> 2);
    for (let i = 0; i < len; i++){ let g = vol; if (i < fade) g *= i / fade; else if (i >= len - fade) g *= (len - 1 - i) / fade; L[i] *= g; R[i] *= g; }
    out.push({start: Math.round(+o.at * SR), L, R});
  }
  return out;
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
async function segmentAudio(s, n, fileOf, A, job){
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
  if (Math.abs(speed - 1) < 1e-3){
    for await (const c of sourceAudio(file, s.in, s.out)){
      if (job.cancel) throw new Error('Abgebrochen');
      rs ||= new Resampler(c.sr); const [L, R] = rs.push(c.L, c.R); await emit(L, R);
      if (w >= n) break;
    }
  } else {
    const parts = []; let len = 0;
    for await (const c of sourceAudio(file, s.in, s.out)){ rs ||= new Resampler(c.sr); const p = rs.push(c.L, c.R); parts.push(p); len += p[0].length; }
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
    this.ovs = (plan.overlays || []).map(o => ({...o, at:+o.at, d: Math.max(0.05, o.out - o.in)})).sort((a, b) => (a.track || 1) - (b.track || 1) || a.at - b.at);
    this.ovState = new Map();
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
  sink(file, track, w, h, fit){
    const k = w + 'x' + h + fit; let m = this.sinks.get(file); if (!m){ m = new Map(); this.sinks.set(file, m); }
    if (!m.has(k)) m.set(k, new CanvasSink(track, {width:w, height:h, fit, poolSize:3}));
    return m.get(k);
  }
  async segment(s, o, frames, add){
    if (!frames.length) return;
    const {ctx, W, H, fps} = this, speed = s.fx.speed;
    const file = s.hasVideo === false ? null : this.fileOf(s.uri);
    let it = null, bm = null, last = null;
    if (file && (s.image || isImageFile(file))) bm = await bitmapOf(file);
    else if (file){
      const tr = await videoTrack(file);
      if (tr){
        const off = await firstTs(file);
        const ts = frames.map(f => off + s.in + (f / fps - o) * speed);
        it = this.sink(file, tr, W, H, 'contain').canvasesAtTimestamps(ts)[Symbol.asyncIterator]();
      }
    }
    try {
      for (const f of frames){
        const t = f / fps, st = s.in + (t - o) * speed;
        if (it){ const r = await it.next(); if (r.value) last = r.value.canvas; }
        // Grundbild
        const b = this.bctx; b.fillStyle = '#000'; b.fillRect(0, 0, W, H);
        if (bm) drawFit(b, bm, 0, 0, W, H, false); else if (last) b.drawImage(last, 0, 0);
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
        const flt = s.kind === 'main' ? cssFilter(s.fx) : '';
        const z = s.kind === 'main' ? zoomAt(s.zooms, st) : {s:1};
        if (flt && this.canFilter) ctx.filter = flt;
        const tf = s.kind === 'main' && (Math.abs(s.fx.sc - 1) > 1e-3 || s.fx.tx || s.fx.ty);
        if (tf){ ctx.save(); ctx.translate(W / 2 + s.fx.tx * W, H / 2 + s.fx.ty * H); ctx.scale(s.fx.sc, s.fx.sc); ctx.translate(-W / 2, -H / 2); }
        if (z.s > 1.001){ const sw = W / z.s, sh = H / z.s; ctx.drawImage(this.base, z.cx * W * (1 - 1 / z.s), z.cy * H * (1 - 1 / z.s), sw, sh, 0, 0, W, H); }
        else ctx.drawImage(this.base, 0, 0);
        if (tf) ctx.restore();
        if (flt && this.canFilter) ctx.filter = 'none';
        if (flt && !this.canFilter) manualFx(ctx, W, H, s.fx);
        await this.overlays(t);
        this.text(t);
        await add(f);
      }
    } finally { if (it && it.return) await it.return(); }
  }
  async overlays(t){
    const {ctx, W, H, fps} = this;
    for (const o of this.ovs){
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
      if (cr){ const im = st.bm || st.last; if (im){ const iw = im.width, ih = im.height; ctx.drawImage(im, cl * iw, ct * ih, cw * iw, chh * ih, rect[0], rect[1], rect[2], rect[3]); } }
      else if (st.bm) drawFit(ctx, st.bm, ...rect, true);
      else if (st.last) ctx.drawImage(st.last, rect[0], rect[1], rect[2], rect[3]);
    }
  }
  endOverlay(o){ const st = this.ovState.get(o); if (st && st.it && !st.done){ st.done = true; st.it.return && st.it.return(); } }
  text(t){
    const act = this.cues.filter(c => t >= c.start && t < c.end); if (!act.length) return;
    const {ctx, W, H} = this, st = this.style, port = H > W ? 1.25 : 1;
    for (const c of act){
      const size = (c.size ? c.size : (SIZE_F[st.size] || 0.058)) * Math.min(W, H) * port;
      ctx.font = this.fontOf(c.title ? c.font : st.font, c.title ? 800 : 700).replace('%s', size.toFixed(1));
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const rows = wrapRows(ctx, String(c.text), W * (c.title ? 0.92 : 0.88));
      const lh = size * 1.12, bw = Math.max(...rows.map(r => ctx.measureText(r).width)), bh = rows.length * lh, m = 0.02;
      let cx = (c.x ?? 0.5) * W, cy = (c.y ?? 0.88) * H;
      if (!c.title){
        cx = bw > W * (1 - 2 * m) ? W / 2 : clamp(cx, bw / 2 + m * W, W - bw / 2 - m * W);
        cy = clamp(cy, bh / 2 + m * H, H - bh / 2 - m * H);
      }
      const outline = c.title ? c.outline !== false : st.outline !== false, color = (c.title ? c.color : st.color) || '#FFFFFF';
      if (c.bg){
        const px = size * 0.3, py = size * 0.1, r = size * 0.15;
        ctx.fillStyle = 'rgba(0,0,0,.55)'; roundRect(ctx, cx - bw / 2 - px, cy - bh / 2 - py, bw + 2 * px, bh + 2 * py, r); ctx.fill();
      }
      rows.forEach((row, k) => {
        const y = cy - bh / 2 + lh * (k + 0.5);
        if (outline){ ctx.lineJoin = 'round'; ctx.miterLimit = 2; ctx.lineWidth = 2 * Math.max(1, size / 14); ctx.strokeStyle = '#000'; ctx.strokeText(row, cx, y); }
        else if (!c.title){ ctx.shadowColor = 'rgba(0,0,0,.8)'; ctx.shadowBlur = size / 10; ctx.shadowOffsetY = size / 20; }
        ctx.fillStyle = color; ctx.fillText(row, cx, y);
        ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      });
    }
  }
  close(){ for (const st of this.ovState.values()) if (st.it && !st.done && st.it.return) st.it.return(); }
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
  const img = ctx.getImageData(0, 0, W, H), d = img.data, b = 1 + fx.bright, c = 1 + fx.contrast, s = fx.gray ? 0 : 1 + fx.sat / 100;
  for (let i = 0; i < d.length; i += 4){
    let r = d[i] * b, g = d[i + 1] * b, bl = d[i + 2] * b;
    r = (r - 128) * c + 128; g = (g - 128) * c + 128; bl = (bl - 128) * c + 128;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * bl;
    d[i] = l + (r - l) * s; d[i + 1] = l + (g - l) * s; d[i + 2] = l + (bl - l) * s;
  }
  ctx.putImageData(img, 0, 0);
}

// ───────── Vorschau-Datei für Formate, die der Browser nicht abspielt ─────────
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
