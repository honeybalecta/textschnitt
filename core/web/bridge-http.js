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
  let asrHint = '';   // Begriffe aus dem eigenen Wörterbuch: Hinweis für die nächsten Transkriptionen
  window.TS = {
    info: () => call('GET', 'info'),
    pick(id, kind){
      fetch(api + 'pick', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({kind})})
        .then(r => r.text()).then(t => TSApp.onPicked(id, t && t !== 'null' ? t : null))
        .catch(() => TSApp.onPicked(id, null));
    },
    immersive: on => { try { return JSON.parse(call('POST', 'fullscreen', {on: !!on})).ok; } catch(_){ return false; } },
    fonts: () => call('GET', 'fonts'),
    saveImage: (name, b64, width, height, project) => call('POST', 'image', {name, data: b64, width, height, project}),
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
    setAsrHint: text => { asrHint = String(text || ''); },
    transcribe: (uri, model, lang, fillers) => jobOf(call('POST', 'transcribe', {uri, model, lang, fillers, hint: asrHint})),
    transcribeRanges: (uri, model, lang, ranges) => jobOf(call('POST', 'transcribe', {uri, model, lang, fillers:false, hint: asrHint, ranges: JSON.parse(ranges)})),
    exportVideo: plan => jobOf(call('POST', 'export', plan)),
    gpu: () => call('GET', 'gpu'),   // Grafikkarte für den Export: {state: pending|ready, name, label}
    makeProxy: uri => jobOf(call('POST', 'proxy', {uri})),
    autoMatte: uri => jobOf(call('POST', 'matte', {uri})),
    stabilize: (uri, level) => jobOf(call('POST', 'stabilize', {uri, level})),
    // Übergabe im Heimnetz (am Handy weiterschneiden): Empfang öffnen (spec = Paket des angebotenen Projekts als JSON oder ''), Stand, schließen, Empfangenes übernehmen
    handoverStart: spec => call('POST', 'handover/start', spec ? '{"spec":' + spec + '}' : '{}'),
    handoverState: () => call('GET', 'handover/state'),
    handoverStop: () => call('POST', 'handover/stop', {}),
    handoverTake: id => call('POST', 'handover/take', {id}),
    translate: (texts, src, tgt) => jobOf(call('POST', 'translate', {texts: JSON.parse(texts), src, tgt})),
    job: id => call('GET', 'job?id=' + q(id)),
    cancel: id => { call('POST', 'cancel', {id}); },
    share: path => { call('POST', 'reveal', {path}); },
    view: path => { call('POST', 'open', {path}); },
    keepAwake: () => {},
    envelope: uri => jobOf(call('POST', 'envelope', {uri})),
    // Datei aus HoneyDeck speichern: Dialog im Backend, Rückgabe = Meldung für den Hinweis
    saveFile: (name, mime, b64) => { try { const r = JSON.parse(call('POST', 'savefile', {name, data: b64})); return r.ok ? 'Gespeichert: ' + r.path : ''; } catch(e){ return 'Speichern fehlgeschlagen: ' + e.message; } },
    // Frühere Fassungen und Papierkorb (liegen im Datenordner unter sicherungen/)
    versions: id => call('GET', 'project/versions?id=' + q(id)),
    restoreVersion: (id, file, copy) => call('POST', 'project/restore', {id, file, copy: !!copy}),
    trash: () => call('GET', 'trash'),
    trashCount: () => { try { return JSON.parse(call('GET', 'trash/count')).n || 0; } catch(_){ return 0; } },
    trashRestore: id => call('POST', 'trash/restore', {id}),
    trashPurge: id => call('POST', 'trash/purge', id ? {id} : {all: true}),
    // Speicher verwalten: Die Übersicht zählt Dateien zusammen und kommt deshalb im Hintergrund (Promise)
    storage: () => fetch(api + 'storage').then(r => r.json()).then(d => { if (d && d.error) throw new Error(d.error); return d; }),
    storageClear: (what, name) => call('POST', 'storage/clear', {what, name: name || ''}),
    storageOpen: () => { call('POST', 'storage/open', {}); },
    // Alle Projekte sichern / Sicherung einspielen: Dateidialog im Backend, danach läuft ein Job (Antwort wie bei pick)
    backupAll(id, prefs){ fetch(api + 'backup/export', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({prefs: prefs || {}})})
      .then(r => r.text()).then(t => TSApp.onPicked(id, t && t !== 'null' ? t : null)).catch(() => TSApp.onPicked(id, null)); },
    backupRestore(id){ fetch(api + 'backup/import', {method:'POST', headers:{'Content-Type':'application/json'}, body: '{}'})
      .then(r => r.text()).then(t => TSApp.onPicked(id, t && t !== 'null' ? t : null)).catch(() => TSApp.onPicked(id, null)); },
    // Fehlerbericht: Protokoll und Systemangaben als eine Datei (Speichern-Dialog im Backend)
    saveReport(id, ui){ fetch(api + 'report', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ui: ui || {}})})
      .then(r => r.text()).then(t => TSApp.onPicked(id, t && t !== 'null' ? t : null)).catch(() => TSApp.onPicked(id, null)); },
    // Hinweis auf neue Versionen (nur die installierte Windows-App fragt bei GitHub nach)
    updateInfo: () => call('GET', 'update'),
    updateCheck: () => fetch(api + 'update/check', {method:'POST', headers:{'Content-Type':'application/json'}, body: '{}'}).then(r => r.json()).then(d => { if (d && d.error) throw new Error(d.error); return d; }),
    updateSet: patch => call('POST', 'update/set', patch),
    updateOpen: what => { call('POST', 'update/open', {what}); },
    // Auffälligkeiten der Oberfläche ins Protokoll (textschnitt.log) schreiben – für die Fehlersuche; darf nie stören
    log: msg => { try { fetch(api + 'log', {method:'POST', body: String(msg).slice(0, 800), keepalive: true}).catch(() => {}); } catch(_){} },
    openWindow: (project, view) => { try { return JSON.parse(call('POST', 'window', {project, view})).url || ''; } catch(_){ return ''; } },
  };
})();
