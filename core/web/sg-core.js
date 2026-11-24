'use strict';
/* ScriptGenius – Rechenkern für Videos mit mehreren möglichen Ausgängen. Ohne Netz, für jede Plattform gleich.
   Gepflegt im Repository honeybalecta/scriptgenius (web/sg-core.js); HoneyCut trägt eine Kopie (core/web/sg-core.js)
   und rechnet damit die Pfad-Videos. Nach Änderungen hier die Datei nach HoneyCut kopieren.

   Ein Plan ist eine Folge von Blöcken in der Reihenfolge des Videos:
     {id, kind: 'teil',   label, text, when?, alts?}            gemeinsamer Teil
     {id, kind: 'weiche', label, when?, outs: [{id, label, text, leer?, alts?}]}   Stelle, an der sich Pfade trennen
   when  – Bedingung {Weiche: [Ausgang …]}: Der Block zählt nur auf Pfaden, auf denen jede genannte (frühere) Weiche einen der
           genannten Ausgänge genommen hat. Ohne Bedingung zählt er auf allen Pfaden.
   alts  – [{id, when, text}] abweichende Fassungen für bestimmte Pfade: Passt eine Bedingung, ersetzt sie den Standardtext
           (bei mehreren die genaueste). So wird ein Ausgang einmal aufgenommen und nur dort überschrieben, wo es nötig ist.
   leer  – Ausgang ohne eigenen Teil (auf diesem Pfad kommt an der Stelle nichts).
   plan.paths = {Schlüssel: {title}} – Angaben je Pfad (Titel fürs Titelbild).

   Ein Abschnitt (seg) ist ein Stück, das einmal aufgenommen wird: ein gemeinsamer Teil, ein Ausgang oder eine abweichende
   Fassung. Jeder Pfad – jeder vollständige Weg durch die Weichen – ist eine Folge von Abschnitten und ergibt ein Video.

   ScriptGenius.blank(name) · teil(label, text) · weiche(label, [Ausgänge]) · aus(label, text) · alt(when, text)
   ScriptGenius.parse(text | obj)   → geprüfter Plan (wirft bei fremden Dateien)
   ScriptGenius.tidy(plan)          → Bedingungen bereinigen (nur frühere Weichen, nur vorhandene Ausgänge)
   ScriptGenius.paths(plan, max)    → {list: [{key, picks: [{w, o}], label, segs: [id …]}], count, more}
   ScriptGenius.segs(plan)          → [{id, block, out, alt, kind, label, text, when, n}] in Aufnahme-Reihenfolge (n = Zahl der Pfade)
   ScriptGenius.script(plan, opts)  → Aufnahme-Skript: jeder Abschnitt einmal (opts.heads: mit Überschriften „# …“)
   ScriptGenius.pathText(plan, p, opts) → Skript eines Pfads
   ScriptGenius.words(text) · secs(n) → Wortzahl und geschätzte Sprechzeit
   ScriptGenius.condText(plan, when)   → Bedingung in Worten
   ScriptGenius.place(plan, spoken)    → {ranges: [{seg, a, b, n, of}], miss: [id …]} – wo die Abschnitte im Transkript liegen
                                      (spoken: [{text}] in Sprechreihenfolge; a, b: Stellen in spoken). Braucht skript.js. */
(function(g){
  const VERSION = 1, ID = /^[A-Za-z0-9_-]{1,24}$/, MAX_BLOCKS = 60, MAX_OUTS = 8, MAX_ALTS = 12, MAX_TEXT = 30000;
  let seq = 0;
  const newId = () => (Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 6) + (seq++ % 36).toString(36));
  const str = (v, n) => String(v == null ? '' : v).replace(/\r/g, '').slice(0, n);
  const line = (v, n) => str(v, n).replace(/\s+/g, ' ').trim();

  const blank = name => { const t = Date.now(); return {app: 'scriptgenius', v: 1, id: newId(), name: line(name, 80) || 'Neuer Plan', made: t, changed: t, blocks: [], paths: {}}; };
  const teil = (label, text) => ({id: newId(), kind: 'teil', label: line(label, 80), text: str(text, MAX_TEXT)});
  const aus = (label, text) => ({id: newId(), label: line(label, 80), text: str(text, MAX_TEXT)});
  const weiche = (label, outs) => ({id: newId(), kind: 'weiche', label: line(label, 80), outs: (outs && outs.length ? outs : ['', '']).slice(0, MAX_OUTS).map(o => typeof o === 'string' ? aus(o, '') : o)});
  const alt = (when, text) => ({id: newId(), when: when || {}, text: str(text, MAX_TEXT)});

  // ── Bedingungen ──
  const holds = (c, st) => !c || Object.keys(c).every(w => st[w] != null && c[w].includes(st[w]));
  function cleanCond(raw, earlier){   // earlier: Map Weiche → Set der Ausgänge
    if (!raw || typeof raw !== 'object') return null; const c = {};
    for (const w of Object.keys(raw)){ const outs = earlier.get(w); if (!outs || !Array.isArray(raw[w])) continue;
      const l = [...new Set(raw[w].filter(o => outs.has(o)))]; if (l.length) c[w] = l; }
    return Object.keys(c).length ? c : null;
  }
  function tidy(plan){
    const earlier = new Map();
    const alts = x => { if (!Array.isArray(x.alts)){ delete x.alts; return; }
      x.alts = x.alts.map(a => ({...a, when: cleanCond(a.when, earlier)})).filter(a => a.when); if (!x.alts.length) delete x.alts; };
    for (const b of plan.blocks){
      const c = cleanCond(b.when, earlier); if (c) b.when = c; else delete b.when;
      if (b.kind === 'weiche'){ for (const o of b.outs) alts(o); earlier.set(b.id, new Set(b.outs.map(o => o.id))); }
      else alts(b);
    }
    return plan;
  }

  // ── Datei lesen ──
  function parse(src){
    let raw = src; if (typeof src === 'string'){ try { raw = JSON.parse(src); } catch(_){ raw = null; } }
    if (!raw || typeof raw !== 'object' || raw.app !== 'scriptgenius' || !Array.isArray(raw.blocks)) throw new Error('Das ist kein Plan aus ScriptGenius.');
    const seen = new Set(), id = v => { let x = typeof v === 'string' && ID.test(v) && !seen.has(v) ? v : newId(); seen.add(x); return x; };
    const altsOf = x => Array.isArray(x.alts) ? x.alts.slice(0, MAX_ALTS).filter(a => a && typeof a === 'object').map(a => ({id: id(a.id), when: a.when && typeof a.when === 'object' ? a.when : {}, text: str(a.text, MAX_TEXT)})) : [];
    const t = Date.now(), p = {app: 'scriptgenius', v: 1, id: typeof raw.id === 'string' && ID.test(raw.id) ? raw.id : newId(), name: line(raw.name, 80) || 'Plan',
      made: +raw.made || t, changed: +raw.changed || t, blocks: [], paths: {}};
    for (const b of raw.blocks.slice(0, MAX_BLOCKS)){ if (!b || typeof b !== 'object') continue;
      if (b.kind === 'weiche'){
        const outs = (Array.isArray(b.outs) ? b.outs : []).slice(0, MAX_OUTS).filter(o => o && typeof o === 'object').map(o => { const q = {id: id(o.id), label: line(o.label, 80), text: str(o.text, MAX_TEXT)}; if (o.leer) q.leer = true; const a = altsOf(o); if (a.length) q.alts = a; return q; });
        if (!outs.length) continue;
        const q = {id: id(b.id), kind: 'weiche', label: line(b.label, 80), outs}; if (b.when && typeof b.when === 'object') q.when = b.when; p.blocks.push(q);
      } else {
        const q = {id: id(b.id), kind: 'teil', label: line(b.label, 80), text: str(b.text, MAX_TEXT)}; if (b.when && typeof b.when === 'object') q.when = b.when; const a = altsOf(b); if (a.length) q.alts = a; p.blocks.push(q);
      }
    }
    if (raw.paths && typeof raw.paths === 'object') for (const k of Object.keys(raw.paths).slice(0, 2000)){ const v = raw.paths[k]; if (k.length <= 600 && v && typeof v === 'object'){ const title = line(v.title, 120); if (title) p.paths[k] = {title}; } }
    return tidy(p);
  }

  // ── Namen ──
  function names(plan){   // Beschriftungen mit Ersatz, wo nichts eingetragen ist
    const blk = new Map(), out = new Map(); let nt = 0, nw = 0;
    for (const b of plan.blocks){
      if (b.kind === 'weiche'){ nw++; blk.set(b.id, b.label || `Weiche ${nw}`); b.outs.forEach((o, k) => out.set(o.id, o.label || `Ausgang ${String.fromCharCode(65 + k)}`)); }
      else { nt++; blk.set(b.id, b.label || `Gemeinsamer Teil ${nt}`); }
    }
    return {blk, out};
  }
  function condText(plan, when, N){
    if (!when) return 'alle Pfade'; N = N || names(plan);
    return Object.keys(when).filter(w => N.blk.has(w)).map(w => when[w].map(o => N.out.get(o) || '?').join(' oder ')).join(' + ') || 'alle Pfade';
  }

  // ── Pfade ──
  const KEY_NONE = '_';
  function fits(x, st){   // Abschnitt, der für diesen Block oder Ausgang auf dem Pfad gilt (null: nichts)
    if (x.leer) return null;
    let best = null, n = -1; for (const a of x.alts || []){ if (!holds(a.when, st)) continue; const k = Object.keys(a.when || {}).length; if (k > n){ best = a; n = k; } }
    return best ? best.id : x.id;
  }
  function paths(plan, max = 400){
    const B = plan.blocks, N = names(plan), list = []; let count = 0, more = false; const HARD = 20000;
    (function walk(k, st, picks, segs){
      if (count >= HARD){ more = true; return; }
      if (k === B.length){ count++; if (list.length < max) list.push({key: picks.length ? picks.map(p => p.w + '.' + p.o).join('~') : KEY_NONE, picks, label: picks.map(p => N.out.get(p.o)).join(' · '), segs}); else more = true; return; }
      const b = B[k];
      if (!holds(b.when, st)) return walk(k + 1, st, picks, segs);
      if (b.kind === 'weiche'){
        for (const o of b.outs){ const st2 = {...st, [b.id]: o.id}, s = fits(o, st2); walk(k + 1, st2, picks.concat({w: b.id, o: o.id}), s ? segs.concat(s) : segs); }
      } else { const s = fits(b, st); walk(k + 1, st, picks, s ? segs.concat(s) : segs); }
    })(0, {}, [], []);
    return {list, count, more};
  }

  // ── Abschnitte in Aufnahme-Reihenfolge ──
  function segs(plan, P){
    const N = names(plan), use = new Map(); for (const p of (P || paths(plan, 5000)).list) for (const s of p.segs) use.set(s, (use.get(s) || 0) + 1);
    const out = [];
    const add = (b, o, base) => {
      const x = o || b; if (!x.leer) out.push({id: x.id, block: b.id, out: o ? o.id : null, alt: null, kind: o ? 'aus' : 'teil', label: base, text: x.text || '', when: null, n: use.get(x.id) || 0});
      for (const a of x.alts || []) out.push({id: a.id, block: b.id, out: o ? o.id : null, alt: a.id, kind: o ? 'aus' : 'teil', label: `${base} (${condText(plan, a.when, N)})`, text: a.text || '', when: a.when, n: use.get(a.id) || 0});
    };
    for (const b of plan.blocks){ if (b.kind === 'weiche') for (const o of b.outs) add(b, o, `${N.blk.get(b.id)}: ${N.out.get(o.id)}`); else add(b, null, N.blk.get(b.id)); }
    return out;
  }

  // ── Skripte ──
  const words = text => String(text || '').replace(/\[[^\]\n]{0,300}\]/g, ' ').split('\n').filter(l => !/^\s*#/.test(l)).join(' ').split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length;
  const secs = n => n / 2.5;   // Sprechzeit: rund 150 Wörter in der Minute
  function script(plan, opts){
    const heads = !opts || opts.heads !== false, list = segs(plan).filter(s => s.n > 0), out = [];
    for (const s of list){ const t = s.text.trim(); if (heads) out.push('# ' + s.label + '\n' + (t || '[frei gesprochen]')); else if (t) out.push(t); }
    return out.join('\n\n');
  }
  function pathText(plan, p, opts){
    const heads = !opts || opts.heads !== false, by = new Map(segs(plan).map(s => [s.id, s])), out = [];
    for (const id of p.segs){ const s = by.get(id); if (!s) continue; const t = s.text.trim(); if (heads) out.push('# ' + s.label + '\n' + (t || '[frei gesprochen]')); else if (t) out.push(t); }
    return out.join('\n\n');
  }
  function pathWords(plan, p, by){ by = by || new Map(segs(plan).map(s => [s.id, s])); let n = 0; for (const id of p.segs){ const s = by.get(id); if (s) n += words(s.text); } return n; }

  // ── Abschnitte im Transkript finden ──
  // Erst das ganze Aufnahme-Skript gegen das Gesprochene (Skript.align: gleiche Reihenfolge, wiederholte Anläufe bleiben übrig),
  // dann jeden nicht gefundenen Abschnitt einzeln an der Stelle, an der er am dichtesten passt (anders aufgenommene Reihenfolge).
  // Was dazwischen frei gesprochen ist, geht an einen Abschnitt ohne Skript, der dort liegt, sonst an den Nachbarn, zu dem es passt.
  function local(ak, bk, free, S){   // beste zusammenhängende Stelle von bk in ak (nur wo free): {a, b, n} oder null
    const n = ak.length, m = bk.length; if (!n || !m) return null;
    let prev = new Float32Array(m + 1), cur = new Float32Array(m + 1), pn = new Int32Array(m + 1), cn = new Int32Array(m + 1), ps = new Int32Array(m + 1), cs = new Int32Array(m + 1);
    let best = 0, res = null;
    for (let i = 1; i <= n; i++){
      cur[0] = 0; cn[0] = 0; cs[0] = i;
      for (let j = 1; j <= m; j++){
        if (!free[i - 1]){ cur[j] = 0; cn[j] = 0; cs[j] = i; continue; }
        const l = S.like(ak[i - 1], bk[j - 1]); let v = prev[j - 1] + (l === 2 ? 3 : l === 1 ? 2 : -1), c = pn[j - 1] + (l ? 1 : 0), s = prev[j - 1] > 0 ? ps[j - 1] : i - 1;
        const up = prev[j] - 1, lf = cur[j - 1] - 1;
        if (up > v){ v = up; c = pn[j]; s = ps[j]; } if (lf > v){ v = lf; c = cn[j - 1]; s = cs[j - 1]; }
        if (v <= 0){ v = 0; c = 0; s = i; }
        cur[j] = v; cn[j] = c; cs[j] = s;
        if (v > best){ best = v; res = {a: s, b: i - 1, n: c}; }
      }
      [prev, cur] = [cur, prev]; [pn, cn] = [cn, pn]; [ps, cs] = [cs, ps];
    }
    return res;
  }
  function place(plan, spoken){
    const S = g.Skript; if (!S) return {ranges: [], miss: []};
    const list = segs(plan).filter(s => s.n > 0), bk = list.map(s => S.words(s.text).map(w => w.k));
    const ai = [], ak = []; spoken.forEach((s, q) => { const k = S.key(s.text); if (k){ ai.push(q); ak.push(k); } });
    const need = q => Math.max(Math.min(bk[q].length, 3), Math.ceil(bk[q].length * 0.4));
    const found = new Array(list.length).fill(null);   // {a, b, n} in Stellen von ak
    // 1) alles in einem Zug
    const all = [], owner = []; bk.forEach((ws, q) => { for (const k of ws){ all.push(k); owner.push(q); } });
    if (all.length && ak.length){
      const hits = list.map(() => []);
      for (const o of S.align(ak, all)){ if (o.op === 'eq' || o.op === 'fz' || o.op === 'm12') hits[owner[o.j]].push(o.i); else if (o.op === 'm21') hits[owner[o.j]].push(o.i, o.i + 1); }
      hits.forEach((h, q) => { if (!h.length) return; h.sort((x, y) => x - y);
        // dichteste Gruppe: einzelne Treffer weit weg gehören nicht dazu
        const gap = Math.max(8, Math.round(bk[q].length * 0.6)); let run = [h[0]], top = run;
        for (let k = 1; k < h.length; k++){ if (h[k] - h[k - 1] > gap){ if (run.length > top.length) top = run; run = []; } run.push(h[k]); }
        if (run.length > top.length) top = run;
        if (top.length >= need(q)) found[q] = {a: top[0], b: top[top.length - 1], n: top.length}; });
    }
    // 2) einzeln, wo noch nichts belegt ist
    const free = new Uint8Array(ak.length).fill(1), take = r => { for (let i = r.a; i <= r.b; i++) free[i] = 0; };
    found.forEach(r => { if (r) take(r); });
    list.forEach((s, q) => { if (found[q] || !bk[q].length) return; const r = local(ak, bk[q], free, S); if (r && r.n >= need(q)){ found[q] = r; take(r); } });
    // 3) Überschneidungen auflösen (in der Reihenfolge des Gesprochenen) und das Freie dazwischen verteilen
    const ord = found.map((r, q) => r ? {q, ...r} : null).filter(Boolean).sort((x, y) => x.a - y.a);
    for (let k = 1; k < ord.length; k++) if (ord[k].a <= ord[k - 1].b) ord[k].a = ord[k - 1].b + 1;
    const live = ord.filter(r => r.b >= r.a), extra = [];
    const bag = q => new Set(bk[q].filter(k => k.length >= 4));
    const span = (from, to, L, R) => {   // freie Stellen from…to zwischen den Abschnitten L und R (jeweils oder null)
      if (to < from) return;
      if (L && R && L.q < R.q){ const holes = []; for (let q = L.q + 1; q < R.q; q++) if (!found[q] && !bk[q].length) holes.push(q);
        if (holes.length === 1 && to - from + 1 >= 3){ extra.push({q: holes[0], a: from, b: to, n: 0}); return; } }
      if (!L && R && R.q > 0){ const holes = []; for (let q = 0; q < R.q; q++) if (!found[q] && !bk[q].length) holes.push(q); if (holes.length === 1 && holes[0] === R.q - 1 && to - from + 1 >= 3){ extra.push({q: holes[0], a: from, b: to, n: 0}); return; } }
      if (L && !R && L.q < list.length - 1){ const holes = []; for (let q = L.q + 1; q < list.length; q++) if (!found[q] && !bk[q].length) holes.push(q); if (holes.length === 1 && holes[0] === L.q + 1 && to - from + 1 >= 3){ extra.push({q: holes[0], a: from, b: to, n: 0}); return; } }
      if (!L){ if (R) R.a = from; return; } if (!R){ L.b = to; return; }
      const bl = bag(L.q), br = bag(R.q); let nl = 0, nr = 0; for (let i = from; i <= to; i++){ if (bl.has(ak[i])) nl++; if (br.has(ak[i])) nr++; }
      if (nr > nl) R.a = from; else L.b = to;
    };
    if (live.length){ span(0, live[0].a - 1, null, live[0]); for (let k = 1; k < live.length; k++) span(live[k - 1].b + 1, live[k].a - 1, live[k - 1], live[k]); span(live[live.length - 1].b + 1, ak.length - 1, live[live.length - 1], null); }
    const ranges = live.concat(extra).sort((x, y) => x.a - y.a).map(r => ({seg: list[r.q].id, a: ai[r.a], b: ai[r.b], n: r.n, of: bk[r.q].length}));
    const have = new Set(ranges.map(r => r.seg));
    return {ranges, miss: list.filter(s => !have.has(s.id)).map(s => s.id)};
  }

  g.ScriptGenius = {blank, teil, weiche, aus, alt, newId, parse, tidy, holds, names, condText, paths, segs, script, pathText, pathWords, words, secs, place, KEY_NONE, MAX_BLOCKS, MAX_OUTS, MAX_ALTS};
})(typeof window !== 'undefined' ? window : typeof self !== 'undefined' ? self : globalThis);
