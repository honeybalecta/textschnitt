// Rechnet die Prüffälle für „Stimme aufbereiten“ mit der JavaScript-Fassung des Rechenkerns (voiceDspLib in core/web/app.js):
// einmal unmittelbar (<Name>.js.f32) und – für Stereo bei 48 kHz – über den Weg des Browser-Exports (voiceRun in web/engine.js,
// <Name>.web.f32): Der Ton kommt dort in Stücken an, der Anfang wird zurückgehalten und daraus das Rauschen gelernt.
// Dazu der Verlauf für „Musik weicht der Sprache“ (gainRun in web/engine.js → gain.json).
// Aufruf: node rechenkern.mjs <Ordner mit cases.json> <Repo>      (wird von rechenkern.py gestartet)
import fs from 'node:fs';
const [dir, repo] = process.argv.slice(2);
const app = fs.readFileSync(`${repo}/core/web/app.js`, 'utf8'), eng = fs.readFileSync(`${repo}/web/engine.js`, 'utf8');
// Quelltext einer Funktion ab ihrem Kopf bis zur schließenden Klammer (die Funktionen enthalten keine Klammern in Zeichenketten)
const cut = (src, head) => { const a = src.indexOf(head); if (a < 0) throw new Error('nicht gefunden: ' + head);
  let d = 0; for (let i = src.indexOf('{', a); i < src.length; i++){ if (src[i] === '{') d++; else if (src[i] === '}' && --d === 0) return src.slice(a, i + 1); }
  throw new Error('Ende nicht gefunden: ' + head); };
globalThis.voiceDspLib = new Function(cut(app, 'function voiceDspLib(){') + '\nreturn voiceDspLib;')();
const lib = globalThis.voiceDspLib();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const { gainRun, voiceRun } = new Function('SR', 'clamp', cut(eng, 'function gainRun(pts){') + '\n' + cut(eng, 'function voiceRun(s, state){') + '\nreturn {gainRun, voiceRun};')(48000, clamp);
const STEPS = [777, 128, 4096, 1, 300, 20000];   // ungleiche Stücke, wie sie ein Decoder liefert
const save = (name, parts) => fs.writeFileSync(`${dir}/${name}`, Buffer.concat(parts.map(p => Buffer.from(p.buffer, p.byteOffset, p.byteLength))));
const weave = (got, n, ch, what) => { const out = new Float32Array(n * ch); let w = 0;
  for (const g of got){ for (let i = 0; i < g[0].length; i++) for (let q = 0; q < ch; q++) out[(w + i) * ch + q] = g[q][i]; w += g[0].length; }
  if (w !== n) throw new Error(`${what}: ${w} Abtastwerte, erwartet ${n}`); return out; };
for (const c of JSON.parse(fs.readFileSync(`${dir}/cases.json`, 'utf8'))){
  const buf = fs.readFileSync(`${dir}/${c.name}.in.f32`), f = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4), sr = c.sr, ch = c.ch;
  const chan = (a, b, T = Float64Array) => { const o = []; for (let q = 0; q < ch; q++){ const v = new T(b - a); for (let i = a; i < b; i++) v[i - a] = f[i * ch + q]; o.push(v); } return o; };
  const span = s => [Math.round(s[0] * sr), Math.round(s[1] * sr)];
  // unmittelbar
  const dsp = new lib.VoiceDsp(sr, ch, null), [a0, e0] = span(c.segs[0]), pn = Math.min(Math.floor(c.prime * sr), e0 - a0);
  dsp.prime(chan(a0, a0 + pn), pn);
  const parts = [];
  for (const s of c.segs){ const [i0, i1] = span(s), n = i1 - i0, x = chan(i0, i1), got = []; let p = 0, k = 0;
    dsp.reset(); dsp.setLevel(s[2], 1);
    while (p < n){ const m = Math.min(n - p, STEPS[k++ % STEPS.length]); got.push(dsp.feed(x.map(v => v.subarray(p, p + m)), m)); p += m; }
    got.push(dsp.finish()); parts.push(weave(got, n, ch, c.name)); }
  save(`${c.name}.js.f32`, parts);
  // über den Weg des Browser-Exports
  if (sr !== 48000 || ch !== 2) continue;
  const state = new Map(), web = [];
  for (const s of c.segs){ const [i0, i1] = span(s), n = i1 - i0, [L, R] = chan(i0, i1, Float32Array), got = []; let p = 0, k = 3;
    const vr = voiceRun({uri: 'x', voice: {k: 's0', ...(s[2] ? {lvl: s[2]} : {})}}, state);
    while (p < n){ const m = Math.min(n - p, STEPS[k++ % STEPS.length]); got.push(vr.push(L.subarray(p, p + m), R.subarray(p, p + m))); p += m; }
    got.push(vr.end()); web.push(weave(got, n, ch, c.name + ' (Browser-Export)')); }
  save(`${c.name}.web.f32`, web);
}
// Verlauf: Werte an festen Stellen, einmal aufsteigend abgefragt und einmal mit Sprung zurück
const curve = JSON.parse(fs.readFileSync(`${dir}/gain.in.json`, 'utf8'));
const out = curve.map(({pts, ts}) => { const g = gainRun(pts); return g ? ts.map(t => g(t)).concat(ts.slice(0, 3).map(t => g(t))) : null; });
fs.writeFileSync(`${dir}/gain.json`, JSON.stringify(out));
console.log('js fertig');
