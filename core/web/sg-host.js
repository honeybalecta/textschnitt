'use strict';
/* Schnittstelle zu ScriptGenius (eigenes Programm: Videos mit mehreren möglichen Ausgängen planen).

   Pläne: Beide Programme lesen und schreiben dieselbe Ablage – über window.TS:
     Windows   Ordner %APPDATA%\ScriptGenius\plaene (Backend: api/sg/list, api/sg/save, api/sg/delete)
     Android   Schnittstelle der App ScriptGenius (ContentProvider, nur mit demselben Signaturschlüssel)
     Browser   localStorage „sg-plans“ (ScriptGenius liegt auf derselben Website unter /scriptgenius/)
   Eingebettet: Ist ScriptGenius installiert (Windows/Android) bzw. auf der Website vorhanden, liefert der lokale Server
   seine Oberfläche unter sg/ aus. „Pfade planen“ öffnet sie dann über HoneyCut, mit window.HC_SG_HOST als Gegenstelle.
   Fehlt ScriptGenius, lädt HoneyCut Pläne als Datei (.scriptgenius). */
(() => {
  const BASE = window.TS_SG_BASE || 'sg/';
  window.HC_SG_ON = false;
  let box = null, frame = null, detected = null;

  function detect(){
    return detected ||= (async () => {
      try {
        const r = await fetch(BASE + 'version.txt', {cache: 'no-store'}); if (!r.ok) return false;
        const v = (await r.text()).trim(); if (!/^\d+\.\d+/.test(v)) return false;
        window.HC_SG_ON = true; window.HC_SG_VERSION = v; document.body.classList.add('has-sg'); return true;
      } catch(_){ return false; }
    })();
  }
  window.sgDetect = detect;

  // Pläne aus der gemeinsamen Ablage (neueste zuerst)
  window.sgPlans = () => {
    let raw = ''; try { raw = window.TS && TS.sgList ? TS.sgList() : ''; } catch(_){}
    let a = []; try { a = JSON.parse(raw || '[]'); } catch(_){}
    return (Array.isArray(a) ? a : []).map(p => { try { return ScriptGenius.parse(p); } catch(_){ return null; } }).filter(Boolean).sort((x, y) => y.changed - x.changed);
  };

  // Gegenstelle für das eingebettete ScriptGenius (P ist in app.js mit let angelegt, also kein window.P)
  const proj = () => (typeof P !== 'undefined' && P) ? P : null;
  window.HC_SG_HOST = {
    list(){ let a = []; try { a = JSON.parse((TS.sgList && TS.sgList()) || '[]'); } catch(_){} return Array.isArray(a) ? a : []; },
    save(p){ const r = TS.sgSave ? TS.sgSave(JSON.stringify(p)) : 'Speichern geht hier nicht'; if (r) throw new Error(r); },
    remove(id){ const r = TS.sgDelete ? TS.sgDelete(id) : ''; if (r) throw new Error(r); },
    async saveFile(name, blob){ return window.saveBlob ? saveBlob(name, blob) : ''; },
    project: () => { const p = proj(); return (p && !p.clipOf) ? p.name : null; },
    planId: () => { const p = proj(); return (p && p.pfade && p.pfade.plan) ? p.pfade.plan.id : null; },
    use(plan){ close(); try { pfLoad(ScriptGenius.parse(JSON.stringify(plan))); if (document.querySelector('#pfPick') && window.closeSheet) closeSheet(); } catch(e){ toast((e && e.message) || 'Der Plan ließ sich nicht übernehmen'); } },
    close: () => close(),
  };

  function close(){
    if (!box) return false;
    box.remove(); box = null; frame = null; document.body.classList.remove('sg-open');
    if (window.pfPaintInfo && proj()) pfPaintInfo();
    if (typeof pfPickRefresh === "function") pfPickRefresh();
    return true;
  }
  window.sgClose = close;
  window.sgIsOpen = () => !!box;
  // Android: Zurück-Taste erst an ScriptGenius geben (Fenster, Ansicht), dann schließen
  window.sgBack = () => { if (!box) return false; try { if (frame && frame.contentWindow.SGBack && frame.contentWindow.SGBack()) return true; } catch(_){} try { frame.contentWindow.ScriptGeniusApp.persist(); } catch(_){} close(); return true; };

  async function open(){
    if (box) return;
    if (!(await detect())){
      // Android: als eigene App öffnen, wenn sie da ist (dann ist meist nur die Oberfläche nicht eingebaut)
      if (window.TS && TS.sgOpenApp && TS.sgOpenApp()) return;
      return missing();
    }
    if (proj() && window.saveNow) saveNow();
    box = document.createElement('div'); box.className = 'sg-overlay'; box.id = 'sgOverlay';
    frame = document.createElement('iframe'); frame.title = 'ScriptGenius'; frame.src = BASE + 'index.html?embed=1';
    box.append(frame); document.body.append(box); document.body.classList.add('sg-open');
  }
  window.sgOpen = open;

  function missing(){
    const web = 'https://honeybalecta.github.io/scriptgenius/';
    const m = hcModal(`<h3>ScriptGenius ist nicht installiert</h3>
      <p>Mit ScriptGenius planst du Videos mit mehreren möglichen Ausgängen: gemeinsame Teile, Weichen und je Pfad ein Video. Installiert ist es über „Honeys Werkstatt“ – danach öffnet es sich hier direkt in HoneyCut.</p>
      <p class="muted small">Ohne Installation läuft ScriptGenius im Browser unter <b>honeybalecta.github.io/scriptgenius</b>. Einen Plan von dort lädst du hier als Datei (.scriptgenius) unter „Pfad-Plan“.</p>
      <div class="row" style="margin-top:12px"><button class="btn" id="sgMissWeb">Im Browser öffnen</button><button class="btn primary" id="sgMissOk" style="margin-left:auto">Verstanden</button></div>`);
    m.querySelector('#sgMissOk').onclick = closeHcModal;
    m.querySelector('#sgMissWeb').onclick = () => { closeHcModal(); if (TS.openUrl) TS.openUrl(web); else window.open(web, '_blank', 'noopener'); };
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', detect); else detect();
})();
