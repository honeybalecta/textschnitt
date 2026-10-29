'use strict';
/* Plattform-Brücke für Desktop (und später Web): stellt dieselbe Schnittstelle window.TS bereit,
   die Android nativ über addJavascriptInterface liefert – hier über HTTP-Aufrufe an das lokale Backend.
   Auf Android existiert window.TS bereits; dann tut diese Datei nichts. */
(() => {
  if (window.TS) return;
  const api = 'api/';
  // Kurze, synchrone Aufrufe (wie bei Android); lange Arbeiten laufen als Job im Hintergrund.
  function call(method, path, body){
    const x = new XMLHttpRequest();
    x.open(method, api + path, false);
    if (body !== undefined) x.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
    x.send(body === undefined ? null : (typeof body === 'string' ? body : JSON.stringify(body)));
    if (x.status >= 400){
      let msg = x.statusText; try { msg = JSON.parse(x.responseText).error || msg; } catch(_){}
      throw new Error(msg);
    }
    return x.responseText;
  }
  const jobOf = txt => { try { return JSON.parse(txt).job; } catch(_){ return ''; } };
  const q = encodeURIComponent;
  window.TS = {
    info: () => call('GET', 'info'),
    pick(id, kind){
      fetch(api + 'pick', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({kind})})
        .then(r => r.text()).then(t => TSApp.onPicked(id, t && t !== 'null' ? t : null))
        .catch(() => TSApp.onPicked(id, null));
    },
    immersive: on => { try { return JSON.parse(call('POST', 'fullscreen', {on: !!on})).ok; } catch(_){ return false; } },
    fonts: () => call('GET', 'fonts'),
    // Projektpakete: Dateidialog im Backend, danach läuft ein Job; Antwort kommt wie bei pick über TSApp.onPicked
    exportPackage(id, spec){ fetch(api + 'package/export', {method:'POST', headers:{'Content-Type':'application/json'}, body: spec})
      .then(r => r.text()).then(t => TSApp.onPicked(id, t && t !== 'null' ? t : null)).catch(() => TSApp.onPicked(id, null)); },
    importPackage(id){ fetch(api + 'package/import', {method:'POST', headers:{'Content-Type':'application/json'}, body: '{}'})
      .then(r => r.text()).then(t => TSApp.onPicked(id, t && t !== 'null' ? t : null)).catch(() => TSApp.onPicked(id, null)); },
    deleteFont: uri => { call('POST', 'fonts/delete', {uri}); },
    listProjects: () => call('GET', 'projects'),
    loadProject: id => call('GET', 'project?id=' + q(id)),
    saveProject: (id, json) => call('POST', 'project?id=' + q(id), json),
    deleteProject: id => call('POST', 'project/delete?id=' + q(id), ''),
    models: () => call('GET', 'models'),
    downloadModel: name => jobOf(call('POST', 'models/download', {name})),
    transcribe: (uri, model, lang, fillers) => jobOf(call('POST', 'transcribe', {uri, model, lang, fillers})),
    transcribeRanges: (uri, model, lang, ranges) => jobOf(call('POST', 'transcribe', {uri, model, lang, fillers:false, ranges: JSON.parse(ranges)})),
    exportVideo: plan => jobOf(call('POST', 'export', plan)),
    makeProxy: uri => jobOf(call('POST', 'proxy', {uri})),
    job: id => call('GET', 'job?id=' + q(id)),
    cancel: id => { call('POST', 'cancel', {id}); },
    share: path => { call('POST', 'reveal', {path}); },
    view: path => { call('POST', 'open', {path}); },
    keepAwake: () => {},
    envelope: uri => jobOf(call('POST', 'envelope', {uri})),
    openWindow: (project, view) => { try { return JSON.parse(call('POST', 'window', {project, view})).url || ''; } catch(_){ return ''; } },
  };
})();
