// Spracherkennung im Browser: Whisper über transformers.js (WebGPU, sonst WebAssembly).
// Das Modell wird einmal von Hugging Face geladen und vom Browser zwischengespeichert; der Ton bleibt auf dem Gerät.
import { pipeline, env } from './vendor/asr.js';

env.allowLocalModels = false;
// Laufzeitdateien von der eigenen Seite statt vom CDN, wenn sie mitgeliefert werden
const ORT = new URL('./vendor/ort/', import.meta.url).href;
let ortChecked = null;
async function useLocalOrt(){
  return ortChecked ||= (async () => {
    try {
      const list = await (await fetch(ORT + 'files.json')).json();
      const pick = suf => list.find(f => f === `ort-wasm-simd-threaded${suf}.mjs`) && list.find(f => f === `ort-wasm-simd-threaded${suf}.wasm`) ? suf : null;
      const suf = pick('.asyncify') ?? pick('.jsep') ?? pick('');
      if (suf != null) env.backends.onnx.wasm.wasmPaths = {mjs: ORT + `ort-wasm-simd-threaded${suf}.mjs`, wasm: ORT + `ort-wasm-simd-threaded${suf}.wasm`};
    } catch(_){}
  })();
}

const REPO = {tiny:'onnx-community/whisper-tiny_timestamped', base:'onnx-community/whisper-base_timestamped', small:'onnx-community/whisper-small_timestamped'};
let pipe = null, key = '', device = '';
let bundled = null;
const bundledModels = () => bundled ||= fetch(new URL('./models/bundled.json', import.meta.url)).then(r => r.ok ? r.json() : []).catch(() => []);

async function hasGpu(){
  try { return !!(navigator.gpu && await navigator.gpu.requestAdapter()); } catch(_){ return false; }
}
async function load(name, want, onProgress){
  const repo = REPO[name] || REPO.base;
  const dev = want === 'wasm' ? 'wasm' : (await hasGpu() ? 'webgpu' : 'wasm');
  if (pipe && key === repo + dev) return dev;
  if (pipe){ try { await pipe.dispose(); } catch(_){} pipe = null; }
  await useLocalOrt();
  // tiny und base liefert die Seite selbst aus, small kommt von Hugging Face
  const local = (await bundledModels()).includes(repo);
  env.allowLocalModels = local; env.allowRemoteModels = !local;
  env.localModelPath = new URL('./models/', import.meta.url).href;
  const files = new Map();
  const progress_callback = p => {
    if (p.status === 'progress' && p.total){ files.set(p.file, [p.loaded || 0, p.total]);
      let a = 0, b = 0; for (const [x, y] of files.values()){ a += x; b += y; } onProgress(a / b, b); }
  };
  const dtype = dev === 'webgpu' ? {encoder_model:'fp32', decoder_model_merged:'fp16'} : {encoder_model:'q8', decoder_model_merged:'q8'};
  try {
    pipe = await pipeline('automatic-speech-recognition', repo, {device: dev, dtype, progress_callback});
    device = dev;
  } catch(e){
    if (dev !== 'webgpu') throw e;
    // Grafikkarte macht Probleme → auf dem Prozessor rechnen
    pipe = await pipeline('automatic-speech-recognition', repo, {device:'wasm', dtype:{encoder_model:'q8', decoder_model_merged:'q8'}, progress_callback});
    device = 'wasm';
  }
  key = repo + device;
  return device;
}

self.onmessage = async e => {
  const m = e.data, id = m.id;
  try {
    if (m.cmd === 'load'){
      const dev = await load(m.model, m.device, (p, total) => self.postMessage({type:'progress', id, p, total}));
      self.postMessage({type:'done', id, device: dev});
    } else if (m.cmd === 'run'){
      await load(m.model, m.device, () => {});
      const out = await pipe(m.audio, {language: m.lang || 'de', task:'transcribe', return_timestamps:'word'});
      self.postMessage({type:'done', id, chunks: (out.chunks || []).map(c => ({text:c.text, ts:c.timestamp})), text: out.text, device});
    }
  } catch(err){
    self.postMessage({type:'error', id, error: String(err && err.message || err)});
  }
};
