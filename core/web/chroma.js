'use strict';
/* Freistellen per Farbschlüssel (Greenscreen): Ein kleiner WebGL-Zeichner, der ein Video oder Bild mit bis zu
   vier Schlüsselfarben durchsichtig macht. Die Rechnung entspricht den ffmpeg-Filtern „chromakey“ (Abstand in der
   Farbebene U/V nach BT.709, Ähnlichkeit und weicher Übergang) und „despill“, damit Vorschau, Browser-Export und
   Windows-Export übereinstimmen. Die gleiche Formel steckt im Android-Export (ChromaKeyEffect.kt).

   key = {colors: ['#00ff00', …], tol: 0.22, soft: 0.08, spill: true, bg: '#000000' | null}
     colors – Schlüsselfarben, tol – Ähnlichkeit (0,01…1), soft – weicher Rand (0…1),
     spill – Farbsaum der Schlüsselfarbe zurücknehmen, bg – Hintergrundfarbe (deckend) oder null (durchsichtig). */
(function(g){
  const VS = 'attribute vec2 p;varying vec2 v;void main(){v=vec2(p.x*0.5+0.5,0.5-p.y*0.5);gl_Position=vec4(p,0.,1.);}';
  const FS = `precision mediump float;varying vec2 v;uniform sampler2D tex;uniform vec2 keys[4];uniform vec3 krgb[4];uniform float km[4];uniform int n;uniform float sim[4];uniform float bl[4];
uniform float spill;uniform int dom;uniform vec3 bg;uniform float opaque;uniform float premul;
vec2 uv(vec3 c){return vec2(-0.1146*c.r-0.3854*c.g+0.5*c.b,0.5*c.r-0.4542*c.g-0.0458*c.b)*0.8784;}
void main(){vec4 c=texture2D(tex,v);vec2 p=uv(c.rgb);float a=1.0;
for(int i=0;i<4;i++){if(i>=n)break;float d=km[i]>0.5?distance(c.rgb,krgb[i])*0.57735027:distance(p,keys[i])*0.70710678;float ai=bl[i]>0.0001?clamp((d-sim[i])/bl[i],0.0,1.0):(d>sim[i]?1.0:0.0);a=min(a,ai);}
a*=c.a;vec3 rgb=c.rgb;
if(spill>0.0){if(dom==1){rgb.g-=max(rgb.g-(rgb.r+rgb.b)*0.5,0.0)*spill;}else if(dom==2){rgb.b-=max(rgb.b-(rgb.r+rgb.g)*0.5,0.0)*spill;}}
if(opaque>0.5)gl_FragColor=vec4(mix(bg,rgb,a),1.0);else gl_FragColor=premul>0.5?vec4(rgb*a,a):vec4(rgb,a);}`;
  const hex = h => { const m = /^#?([0-9a-f]{6})$/i.exec(String(h || '').trim()); const n = m ? parseInt(m[1], 16) : 0x00ff00; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
  const uvOf = ([r, g_, b]) => [(-0.1146 * r - 0.3854 * g_ + 0.5 * b) * 0.8784, (0.5 * r - 0.4542 * g_ - 0.0458 * b) * 0.8784];
  // Vorherrschender Kanal der (ersten) Schlüsselfarbe – Farbsaum lässt sich wie bei ffmpeg „despill“ nur für Grün (1) und Blau (2) zurücknehmen
  // Bunte Schlüsselfarbe (Grün, Blau …): Abstand nur im Farbton – Helligkeit egal, wie ffmpeg „chromakey“.
  // Unbunte Farbe (Weiß, Grau, Schwarz, blasse Töne): Abstand im RGB-Raum, wie ffmpeg „colorkey“ – sonst würden alle grauen Stellen mit verschwinden.
  const isChroma = h => { const c = hex(h); return Math.max(...c) - Math.min(...c) >= 0.25; };
  const domOf = cols => { const f = cols.find(isChroma); if (!f) return -1; const c = hex(f); const m = Math.max(c[0], c[1], c[2]); if (m - Math.min(c[0], c[1], c[2]) < 0.25) return -1; return c.indexOf(m); };
  function norm(key){
    const colors = (key && key.colors || []).filter(Boolean).slice(0, 4); if (!colors.length) colors.push('#00ff00');
    return {colors, tol: Math.min(1, Math.max(0.01, +(key && key.tol) || 0.22)), soft: Math.min(1, Math.max(0, +(key && key.soft) || 0)), spill: key && key.spill ? 1 : 0, bg: key && key.bg ? hex(key.bg) : null};
  }
  function create(w, h, opts){
    const canvas = (opts && opts.canvas) || (typeof OffscreenCanvas !== 'undefined' && opts && opts.offscreen ? new OffscreenCanvas(w, h) : document.createElement('canvas'));
    canvas.width = w; canvas.height = h;
    const gl = canvas.getContext('webgl', {premultipliedAlpha: true, alpha: true, preserveDrawingBuffer: false, antialias: false});
    if (!gl) return null;
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error('Programm: ' + gl.getProgramInfoLog(pr));
    gl.useProgram(pr);
    const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    const U = n => gl.getUniformLocation(pr, n);
    const u = {krgb: U('krgb'), km: U('km'), keys: U('keys'), n: U('n'), sim: U('sim'), bl: U('bl'), spill: U('spill'), dom: U('dom'), bg: U('bg'), opaque: U('opaque'), premul: U('premul'), tex: U('tex')};
    gl.uniform1i(u.tex, 0);
    let lastKey = '';
    function setKey(key){
      const k = norm(key), js = JSON.stringify(k); if (js === lastKey) return; lastKey = js;
      const keys = new Float32Array(8), krgb = new Float32Array(12), km = new Float32Array(4), sim = new Float32Array(4), bl = new Float32Array(4);
      k.colors.forEach((c, i) => { const rgb = hex(c), [a, b] = uvOf(rgb); keys[i * 2] = a; keys[i * 2 + 1] = b; krgb.set(rgb, i * 3); km[i] = isChroma(c) ? 0 : 1; sim[i] = k.tol; bl[i] = k.soft; });
      gl.uniform2fv(u.keys, keys); gl.uniform3fv(u.krgb, krgb); gl.uniform1fv(u.km, km); gl.uniform1i(u.n, k.colors.length); gl.uniform1fv(u.sim, sim); gl.uniform1fv(u.bl, bl);
      gl.uniform1f(u.spill, k.spill ? 1 : 0); gl.uniform1i(u.dom, domOf(k.colors));
      gl.uniform3fv(u.bg, new Float32Array(k.bg || [0, 0, 0])); gl.uniform1f(u.opaque, k.bg ? 1 : 0); gl.uniform1f(u.premul, 1);
    }
    // source: <video>, <img>, <canvas> oder ImageBitmap; zeichnet das freigestellte Bild in die Leinwand (w×h)
    function draw(source, key, w2, h2){
      if (w2 && h2 && (canvas.width !== w2 || canvas.height !== h2)){ canvas.width = w2; canvas.height = h2; }
      gl.viewport(0, 0, canvas.width, canvas.height); setKey(key);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source); } catch(_){ return false; }
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); return true;
    }
    return {canvas, gl, draw, setKey, destroy(){ try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch(_){} }};
  }
  // Farbe eines Punkts (0…1) aus einem Video/Bild lesen – zum Wählen der Schlüsselfarbe im Bild
  function sample(source, fx, fy){
    const c = document.createElement('canvas'); c.width = 64; c.height = 64; const ctx = c.getContext('2d', {willReadFrequently: true});
    const w = source.videoWidth || source.naturalWidth || source.width, h = source.videoHeight || source.naturalHeight || source.height; if (!w || !h) return null;
    const x = Math.max(0, Math.min(w - 4, fx * w - 2)), y = Math.max(0, Math.min(h - 4, fy * h - 2));
    try { ctx.drawImage(source, x, y, 4, 4, 0, 0, 64, 64); const d = ctx.getImageData(28, 28, 8, 8).data; let r = 0, g_ = 0, b = 0; for (let i = 0; i < d.length; i += 4){ r += d[i]; g_ += d[i + 1]; b += d[i + 2]; } const n = d.length / 4;
      return '#' + [r / n, g_ / n, b / n].map(v => Math.round(v).toString(16).padStart(2, '0')).join(''); } catch(_){ return null; }
  }
  g.ChromaGL = {create, sample, norm, domOf, isChroma, VS, FS};
})(typeof window !== 'undefined' ? window : self);
