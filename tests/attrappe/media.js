// Attrappe für web/vendor/media.js (die Medienbibliothek mediabunny samt Kodierern), gerade so viel, dass der Browser-Export
// (web/engine.js) ohne echte Dateien und ohne Kodierer durchläuft – für p_browser.mjs.
//   „Videodatei“: ein Objekt {name, type, fake: {fps, audio: [[Frequenz, Scheitelwert], …]}}. Sie liefert zu jeder Zeit das Balkenbild
//   ihrer Bildnummer (wie takt.mp4, siehe medien.py) und als Ton die Summe der angegebenen Sinustöne (Stereo, 48 kHz).
//   Mit fake.pattern = 'karo' zeigt sie ein Schachbrett aus 8 Pixel großen Feldern (für Prüfungen am Bildinhalt),
//   mit fake.pattern = 'gruen' einen Greenscreen mit einem Feld in der Mitte (Freistellen, Hintergründe, Weißabgleich).
//   „Kodierer“: liest aus jedem fertigen Bild die Balken ab (HC_OUT.frames = [[Zeit, [v0 … v9]], …]) und sammelt den Ton
//   (HC_OUT.audio = {L, R} als Listen von Float32Array). HC_OUT.sinks zählt die angelegten Bildquellen je Datei.
//   HC_OUT.want = [Zeit, …] hält die fertigen Bilder zu diesen Zeiten ganz fest (HC_OUT.shots = [{t, w, h, data}]).
const OUT = globalThis.HC_OUT = { frames: [], audio: { L: [], R: [] }, sinks: [], want: null, shots: [], reset(){ this.frames = []; this.audio = { L: [], R: [] }; this.sinks = []; this.shots = []; } };
export const ALL_FORMATS = [];
export class BlobSource { constructor(file){ this.file = file; } }
export class Input {
  constructor(o){ this.fake = (o.source.file || {}).fake || null; }
  async getFirstTimestamp(){ return 0; }
  async computeDuration(){ return this.fake ? this.fake.duration || 60 : 0; }
  async getPrimaryVideoTrack(){ return this.fake && this.fake.fps ? { kind: 'video', fake: this.fake, getDisplayWidth: async () => this.fake.width || 640, getDisplayHeight: async () => this.fake.height || 360 } : null; }
  async getPrimaryAudioTrack(){ return this.fake && this.fake.audio ? { kind: 'audio', fake: this.fake } : null; }
}
const BITS = 10;
function bars(ctx, w, h, n){
  ctx.fillStyle = '#181818'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#E8E8E8';
  for (let b = 0; b < BITS; b++) if ((n >> b) & 1) ctx.fillRect(Math.round(b * w / BITS), 0, Math.round((b + 1) * w / BITS) - Math.round(b * w / BITS), h);
}
// Greenscreen: grüne Fläche, in der Mitte ein Feld mit warmem Farbstich (wie gruen.mp4, siehe medien.py)
function gruen(ctx, w, h){ ctx.fillStyle = '#00FF00'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#A08060'; ctx.fillRect(Math.round(w * 200 / 640), Math.round(h * 80 / 360), Math.round(w * 240 / 640), Math.round(h * 200 / 360)); }
function karo(ctx, w, h){
  ctx.fillStyle = '#181818'; ctx.fillRect(0, 0, w, h); ctx.fillStyle = '#E8E8E8';
  for (let y = 0; y < h; y += 8) for (let x = (y / 8) % 2 ? 8 : 0; x < w; x += 16) ctx.fillRect(x, y, 8, 8);
}
// Bilder zu Zeitpunkten: wie ein Decoder das letzte Bild, dessen Zeit erreicht ist; die Leinwände kommen reihum aus einem kleinen Vorrat
export class CanvasSink {
  constructor(track, o){ this.fake = track.fake; this.w = o.width; this.h = o.height; this.pool = Array.from({ length: o.poolSize || 1 }, () => { const c = document.createElement('canvas'); c.width = o.width; c.height = o.height; return c; }); this.k = 0;
    OUT.sinks.push({ file: this.fake.name || '', w: o.width, h: o.height, fit: o.fit }); }
  canvasesAtTimestamps(ts){ const self = this;
    return { [Symbol.asyncIterator](){ let i = 0; return {
      async next(){ if (i >= ts.length) return { done: true, value: undefined }; const t = ts[i++]; await null;
        if (!(t >= 0) || t >= (self.fake.duration || 1e9)) return { done: false, value: null };
        const c = self.pool[self.k++ % self.pool.length]; if (self.fake.pattern === 'karo') karo(c.getContext('2d'), self.w, self.h); else if (self.fake.pattern === 'gruen') gruen(c.getContext('2d'), self.w, self.h); else bars(c.getContext('2d'), self.w, self.h, Math.floor(t * self.fake.fps + 1e-4)); return { done: false, value: { canvas: c, timestamp: t } }; },
      async return(){ i = ts.length; return { done: true, value: undefined }; } }; } }; }
}
export class AudioSampleSink {
  constructor(track){ this.fake = track.fake; }
  async *samples(a, b){
    const sr = 48000, N = 1024, tones = this.fake.audio || [];
    for (let i0 = Math.floor(Math.max(0, a) * sr / N) * N; i0 / sr < b; i0 += N){
      const d = new Float32Array(N);
      for (const [f, amp] of tones){ const w = 2 * Math.PI * f / sr; for (let i = 0; i < N; i++) d[i] += amp * Math.sin(w * (i0 + i)); }
      yield { sampleRate: sr, numberOfFrames: N, numberOfChannels: 2, timestamp: i0 / sr, copyTo(dst){ dst.set(d); }, close(){} };
    }
  }
}
export class AudioSample { constructor(o){ Object.assign(this, o); } close(){} }
export class CanvasSource {
  constructor(canvas){ this.canvas = canvas; }
  async add(t){ const c = this.canvas, x = c.getContext('2d'), v = [];
    for (let b = 0; b < BITS; b++){ const p = x.getImageData(Math.floor((b + 0.5) * c.width / BITS), c.height >> 1, 1, 1).data; v.push(+(((p[0] + p[1] + p[2]) / 3 - 0x18) / (0xE8 - 0x18)).toFixed(3)); }
    OUT.frames.push([+t.toFixed(4), v]);
    if (OUT.want && OUT.want.some(q => Math.abs(q - t) < 1e-3)) OUT.shots.push({ t: +t.toFixed(4), w: c.width, h: c.height, data: x.getImageData(0, 0, c.width, c.height).data }); }
  close(){}
}
export class AudioSampleSource {
  async add(s){ const n = s.data.length / 2; OUT.audio.L.push(s.data.slice(0, n)); OUT.audio.R.push(s.data.slice(n)); }
  close(){}
}
export class Output { constructor(o){ this.target = o.target; } addVideoTrack(){} addAudioTrack(){} async start(){} async finalize(){ this.target.buffer = new ArrayBuffer(16); } async cancel(){} }
export class BufferTarget {}
export class StreamTarget { constructor(w){ this.w = w; } }
export class Mp4OutputFormat {} export class WavOutputFormat {} export class Mp3OutputFormat {} export class FlacOutputFormat {}
export class Quality { constructor(v){ this.v = v; } }
export class Conversion {}
export const canEncodeAudio = async () => true;
export const getFirstEncodableVideoCodec = async () => 'avc';
export const registerAacEncoder = () => {}, registerMp3Encoder = () => {}, registerFlacEncoder = () => {};
