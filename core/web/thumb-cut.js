'use strict';
/* HoneyThumb – Person freistellen.
   Die Erkennung kommt von MediaPipe (Selfie-Segmentierung) und wird beim ersten Mal aus dem Netz geladen (ca. 10 MB).
   Ihre Maske ist grob (256 Punkte Kantenlänge); ein geführter Filter zieht sie an die Kanten des Bildes heran.
   Ergebnis: eine Leinwand in Bildgröße, deren Deckkraft die Maske ist. Das Original bleibt unverändert – so lässt sich die Maske nachbessern. */
(function(){
  const G = typeof window !== 'undefined' ? window : globalThis;
  const MP_VER = '0.10.14', MP_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}`;
  const MODELS = ['https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite',
    'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite'];
  const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
  let custom = null, segP = null;
  // Eigene Erkennung einsetzen (HoneyCut, Prüfläufe): fn(Leinwand) → {data: Float32Array, w, h}, Werte 0…1 = Person
  const setSegmenter = fn => { custom = fn; };
  async function mediapipe(msg){
    if (!segP) segP = (async () => {
      msg && msg('Lade Personenerkennung (einmalig, ca. 10 MB) …');
      const mp = await import(/* webpackIgnore: true */ `${MP_CDN}/vision_bundle.mjs`), vision = await mp.FilesetResolver.forVisionTasks(`${MP_CDN}/wasm`);
      const make = (model, delegate) => mp.ImageSegmenter.createFromOptions(vision, {baseOptions: {modelAssetPath: model, delegate}, runningMode: 'IMAGE', outputConfidenceMasks: true, outputCategoryMask: false});
      let last = null;
      for (const m of MODELS) for (const d of ['GPU', 'CPU']){ try { return await make(m, d); } catch(e){ last = e; } }
      throw last || new Error('Die Personenerkennung ließ sich nicht laden.');
    })().catch(e => { segP = null; throw e; });
    const seg = await segP;
    return c => { const res = seg.segment(c); try { const m = res.confidenceMasks && res.confidenceMasks[0]; if (!m) throw new Error('Die Personenerkennung hat nichts geliefert.'); return {data: new Float32Array(m.getAsFloat32Array()), w: m.width, h: m.height}; } finally { if (res.close) res.close(); } };
  }

  // Mittelwert über ein Fenster (Radius r) mit Summentabelle
  function box(src, w, h, r){
    const S = new Float64Array((w + 1) * (h + 1)), out = new Float32Array(w * h);
    for (let y = 0; y < h; y++){ let row = 0; for (let x = 0; x < w; x++){ row += src[y * w + x]; S[(y + 1) * (w + 1) + x + 1] = S[y * (w + 1) + x + 1] + row; } }
    for (let y = 0; y < h; y++){ const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
      for (let x = 0; x < w; x++){ const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1); out[y * w + x] = (S[y1 * (w + 1) + x1] - S[y0 * (w + 1) + x1] - S[y1 * (w + 1) + x0] + S[y0 * (w + 1) + x0]) / ((y1 - y0) * (x1 - x0)); } }
    return out;
  }
  // Geführter Filter: Maske p folgt den Kanten des Helligkeitsbilds I
  function guided(I, p, w, h, r, eps){
    const n = w * h, mI = box(I, w, h, r), mp = box(p, w, h, r), Ip = new Float32Array(n), II = new Float32Array(n);
    for (let i = 0; i < n; i++){ Ip[i] = I[i] * p[i]; II[i] = I[i] * I[i]; }
    const mIp = box(Ip, w, h, r), mII = box(II, w, h, r), a = new Float32Array(n), b = new Float32Array(n);
    for (let i = 0; i < n; i++){ const v = mII[i] - mI[i] * mI[i]; a[i] = (mIp[i] - mI[i] * mp[i]) / (v + eps); b[i] = mp[i] - a[i] * mI[i]; }
    const ma = box(a, w, h, r), mb = box(b, w, h, r), q = new Float32Array(n);
    for (let i = 0; i < n; i++) q[i] = ma[i] * I[i] + mb[i];
    return q;
  }
  // Grobe Maske (beliebige Größe) → feine Maske in Arbeitsgröße
  function refine(img, m, W, H){
    const c = canvas(W, H), x = c.getContext('2d', {willReadFrequently: true}); x.drawImage(img, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data, n = W * H, I = new Float32Array(n), p = new Float32Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) I[i] = (0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]) / 255;
    for (let y = 0; y < H; y++){ const fy = (y + 0.5) * m.h / H - 0.5, y0 = Math.max(0, Math.floor(fy)), y1 = Math.min(m.h - 1, y0 + 1), ty = Math.min(1, Math.max(0, fy - y0));
      for (let xx = 0; xx < W; xx++){ const fx = (xx + 0.5) * m.w / W - 0.5, x0 = Math.max(0, Math.floor(fx)), x1 = Math.min(m.w - 1, x0 + 1), tx = Math.min(1, Math.max(0, fx - x0));
        p[y * W + xx] = (m.data[y0 * m.w + x0] * (1 - tx) + m.data[y0 * m.w + x1] * tx) * (1 - ty) + (m.data[y1 * m.w + x0] * (1 - tx) + m.data[y1 * m.w + x1] * tx) * ty; } }
    const r = Math.max(3, Math.round(Math.max(W, H) / 90)), q = guided(I, p, W, H, r, 2e-3), out = new Float32Array(n);
    // Die Kante steiler machen; sichere Flächen der groben Maske bleiben, wie sie sind
    for (let i = 0; i < n; i++){ const v = p[i] > 0.97 ? 1 : p[i] < 0.03 ? 0 : q[i], t = Math.min(1, Math.max(0, (v - 0.3) / 0.4)); out[i] = t * t * (3 - 2 * t); }
    return out;
  }
  function toCanvas(a, w, h){ const c = canvas(w, h), x = c.getContext('2d'), im = x.createImageData(w, h); for (let i = 0, j = 0; i < a.length; i++, j += 4){ im.data[j] = im.data[j + 1] = im.data[j + 2] = 255; im.data[j + 3] = Math.round(a[i] * 255); } x.putImageData(im, 0, 0); return c; }

  // Person im Bild finden. Rückgabe: {mask: Leinwand (Deckkraft = Person), share: Anteil der Fläche, box: Rahmen der Person 0…1}
  async function person(img, o = {}){
    const iw = img.naturalWidth || img.videoWidth || img.width, ih = img.naturalHeight || img.videoHeight || img.height;
    if (!iw || !ih) throw new Error('Das Bild ist leer.');
    const seg = custom || await mediapipe(o.msg);
    o.msg && o.msg('Stelle die Person frei …');
    const k = Math.min(1, 640 / Math.max(iw, ih)), W = Math.round(iw * k), H = Math.round(ih * k), small = canvas(W, H); small.getContext('2d').drawImage(img, 0, 0, W, H);
    const m = await seg(small), a = refine(img, m, W, H);
    let sum = 0, x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++){ const v = a[y * W + x]; sum += v; if (v > 0.5){ if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } }
    const share = sum / (W * H); if (share < 0.01 || x1 < 0) throw new Error('Auf diesem Bild ist keine Person zu erkennen.');
    const fk = Math.min(1, 1600 / Math.max(iw, ih)), mask = canvas(iw * fk, ih * fk), mx = mask.getContext('2d'); mx.imageSmoothingQuality = 'high'; mx.drawImage(toCanvas(a, W, H), 0, 0, mask.width, mask.height);
    return {mask, share, box: {x: x0 / W, y: y0 / H, w: (x1 - x0 + 1) / W, h: (y1 - y0 + 1) / H}};
  }
  // Bild auf den Rahmen der Person zuschneiden (mit etwas Luft): Original und Maske, beide als data-URL
  function crop(img, mask, box, pad = 0.04){
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const x0 = Math.max(0, Math.floor((box.x - pad) * iw)), y0 = Math.max(0, Math.floor((box.y - pad) * ih)), x1 = Math.min(iw, Math.ceil((box.x + box.w + pad) * iw)), y1 = Math.min(ih, Math.ceil((box.y + box.h + pad) * ih));
    const k = Math.min(1, 1600 / Math.max(x1 - x0, y1 - y0)), w = Math.round((x1 - x0) * k), h = Math.round((y1 - y0) * k), a = canvas(w, h), b = canvas(w, h);
    a.getContext('2d').drawImage(img, x0, y0, x1 - x0, y1 - y0, 0, 0, w, h);
    const mk = mask.width / iw; b.getContext('2d').drawImage(mask, x0 * mk, y0 * mk, (x1 - x0) * mk, (y1 - y0) * mk, 0, 0, w, h);
    return {img: a.toDataURL('image/jpeg', 0.92), mask: b.toDataURL('image/png'), w, h};
  }
  G.HoneyThumbCut = {person, crop, setSegmenter, refine, guided, box, toCanvas};
})();
