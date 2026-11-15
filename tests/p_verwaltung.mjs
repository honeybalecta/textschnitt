// Einstellungen (Desktop): Speicher verwalten, alle Projekte sichern und einspielen, Fehlerbericht, Hinweis auf neue Versionen
import { launch, scratch, dropScratch, setPick, sleep, api, ids as loadIds, pruefung, DATA, OUT, WORK } from './drv.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const PJ = loadIds();
const { chk, ende } = pruefung('Speicher, Sicherung, Fehlerbericht, neue Versionen');
// Testdateien entstehen „vor einer Stunde“: Eben erst erzeugte Dateien gelten dem Speicher-Aufräumen als in Arbeit
const mk = (p, n) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.alloc(n, 1)); const t = Date.now() / 1000 - 3600; fs.utimesSync(p, t, t); };
const OPENED = path.join(WORK, 'geoeffnet.txt'), GITHUB = path.join(WORK, 'github.json');
fs.rmSync(OPENED, { force: true });
// Nachgestelltes GitHub: zuerst gibt es nichts Neueres
const cur = (await api('update')).current, [maj, min] = cur.split('.').map(Number), v1 = `${maj}.${min + 1}.0`, v2 = `${maj}.${min + 2}.0`;
const rel = v => ({ tag_name: 'v' + v, html_url: `https://github.com/honeybalecta/textschnitt/releases/tag/v${v}`, published_at: '2026-12-01T10:00:00Z',
  assets: [{ name: `HoneyCut-Setup-${v}.exe`, browser_download_url: `https://github.com/honeybalecta/textschnitt/releases/download/v${v}/HoneyCut-Setup-${v}.exe`, size: 640000000 }] });
const github = o => fs.writeFileSync(GITHUB, JSON.stringify(o));
github({ releases: [rel(cur), { tag_name: 'android-v9.9.9', assets: [] }], notes: '' });
await api('update/set', { enabled: true, skip: '' });

const { browser, page, logs } = await launch();
const dialogs = []; page.on('dialog', d => dialogs.push(d.message()));
const toastText = () => page.evaluate(() => document.querySelector('#toast').textContent);
const sid = await scratch(page, PJ.kurz);
// Ausgangslage im Datenordner: je eine verwendete und eine unbenutzte Datei
const used = `${DATA}/freigestellt/1111111111111111.mp4`, free = `${DATA}/freigestellt/2222222222222222.mp4`, orphan = `${DATA}/cache/proxies/3333333333333333.mp4`;
const slUsed = `${DATA}/folien/${sid.slice(0, 20)}/folie-t1-2.png`, slOld = `${DATA}/folien/${sid.slice(0, 20)}/folie-t1-1.png`;
mk(used, 3_000_000); mk(free, 2_000_000); mk(orphan, 1_500_000); mk(slUsed, 40_000); mk(slOld, 30_000); mk(`${DATA}/cache/thumbs/test-vorschaubild.jpg`, 5000);
await page.evaluate(([u, s]) => { P.media = [{ uri: u, name: 'frei.mp4', kind: 'video', duration: 2 }, { uri: s, name: 'folie.png', kind: 'image', duration: 600 }]; saveNow(); closeProject(); }, [used, slUsed]);
await page.evaluate(() => { localStorage.setItem('hc-slide-profiles', JSON.stringify([{ id: 'meins', name: 'Mein Profil', colors: { dark: {}, light: {} } }])); favCols = ['#E5402A']; saveFavs(); });
await sleep(300);

// ── Einstellungen ──
await page.click('#modelsBtn'); await sleep(200);
const rows = await page.evaluate(() => ({ title: document.querySelector('#modelSheet h3').textContent, secs: [...document.querySelectorAll('#setMore h4')].map(h => h.textContent), keys: [...document.querySelectorAll('#setMore .mg-item')].map(e => e.dataset.k), models: document.querySelectorAll('#modelList .model').length }));
chk('Einstellungen zeigen Modelle, „Projekte und Speicher“ und „Hilfe“', rows.title === 'Einstellungen' && rows.secs.join('|') === 'Projekte und Speicher|Hilfe' && rows.keys.join(',') === 'storage,trash,backup,restore,report,update' && rows.models >= 1, rows);
await page.screenshot({ path: OUT + '/einstellungen.png' });

// ── Speicher ──
await page.click('#setMore [data-k=storage] button'); await page.waitForSelector('#stList .mg-item');
let st = await page.evaluate(() => ({ sum: document.querySelector('#stSum').textContent, groups: [...document.querySelectorAll('#stList .mg-item.st')].map(e => ({ k: e.dataset.key, t: e.querySelector('b').textContent, btn: [...e.querySelectorAll(':scope > button')].map(b => b.textContent), sub: [...e.querySelectorAll('.st-row')].map(r => r.textContent) })), settingsOpen: !document.querySelector('#modelSheet').classList.contains('hidden') }));
const G = k => st.groups.find(g => g.k === k);
chk('Übersicht nennt Gesamtgröße und freien Platz; das Einstellungsblatt macht Platz', /HoneyCut belegt .+ frei\./.test(st.sum) && !st.settingsOpen, st.sum);
chk('Vorschau-Dateien: die verwaiste lässt sich freigeben', G('proxies').btn.join() === 'Unbenutzte löschen · 2 MB' || G('proxies').btn.join() === 'Unbenutzte löschen · 1 MB', G('proxies'));
chk('Freigestellte Kopien: verwendete nennt das Projekt, unbenutzte bekommt „Löschen“', G('matte').btn.join() === 'Unbenutzte löschen · 2 MB' && G('matte').sub.length === 2 && G('matte').sub.some(t => t.endsWith('verwendet von „Test ' + sid + '“')) && G('matte').sub.some(t => t.includes('von keinem Projekt verwendet') && t.includes('Löschen')), G('matte'));
chk('Folienbilder: das frühere Bild lässt sich freigeben', G('slides').btn.join() === 'Frühere Bilder löschen · 30 KB', G('slides'));
await page.screenshot({ path: OUT + '/speicher.png' });
dialogs.length = 0; await page.click('#stList [data-key=matte] > button'); await sleep(500);
chk('Rückfrage warnt vor exportierten CapCut-Projekten', dialogs.length === 1 && dialogs[0].includes('1 freigestellte Kopie löschen (2 MB)?') && dialogs[0].includes('CapCut- oder Concat-Projekt'), dialogs);
chk('nur die unbenutzte Kopie ist weg', !fs.existsSync(free) && fs.existsSync(used) && (await toastText()) === '2 MB freigegeben', await toastText());
dialogs.length = 0; await page.click('#stList [data-key=slides] > button'); await sleep(500);
chk('frühere Folienbilder: Rückfrage, dann nur das unbenutzte entfernt', dialogs.length === 1 && dialogs[0].includes('1 früheres Folienbild löschen') && !fs.existsSync(slOld) && fs.existsSync(slUsed), dialogs);
dialogs.length = 0; await page.click('#stList [data-key=proxies] > button'); await sleep(500);
chk('Vorschau-Dateien ohne Rückfrage entfernt (kein Export greift darauf zu)', dialogs.length === 0 && !fs.existsSync(orphan));
const thumbsBefore = fs.readdirSync(DATA + '/cache/thumbs').length; await page.click('#stList [data-key=thumbs] > button'); await sleep(500);
chk('Vorschaubilder leeren', thumbsBefore > 0 && fs.readdirSync(DATA + '/cache/thumbs').length === 0, thumbsBefore);
st = await page.evaluate(() => [...document.querySelectorAll('#stList .mg-item.st')].map(e => ({ k: e.dataset.key, btn: [...e.querySelectorAll(':scope > button')].map(b => b.textContent), hint: e.querySelector('.muted').textContent })));
chk('danach bietet die Übersicht nichts mehr zum Löschen an', st.filter(g => ['thumbs', 'proxies', 'matte', 'slides'].includes(g.k)).every(g => !g.btn.length), st.map(g => [g.k, g.btn]));
await page.click('#stFolder'); await sleep(200);
chk('„Datenordner öffnen“ erreicht das Backend', fs.readFileSync(OPENED, 'utf8').includes('DATENORDNER'));
await page.click('#mgClose'); await sleep(100);
chk('Schließen räumt Blatt und Hintergrund weg', await page.evaluate(() => document.querySelector('#mgSheet').classList.contains('hidden') && document.querySelector('#sheetBack').classList.contains('hidden')));

// ── Alle Projekte sichern ──
const zip = path.join(OUT, 'sicherung.zip'); fs.rmSync(zip, { force: true }); setPick({ save_any: [zip] });
await page.click('#modelsBtn'); await sleep(150); await page.click('#setMore [data-k=backup] button');
await page.waitForFunction(() => document.querySelector('#hcModal #pkgCancel') && document.querySelector('#hcModal #pkgCancel').textContent === 'Schließen', null, { timeout: 30000 });
const bmsg = await page.evaluate(() => document.querySelector('#pkgMsg').textContent);
const names = execFileSync('python3', ['-c', 'import zipfile, sys; print("\\n".join(sorted(zipfile.ZipFile(sys.argv[1]).namelist())))', zip]).toString().trim().split('\n');
const nProj = (await api('projects')).length;
chk('Sicherung geschrieben: alle Projekte, verwendetes Folienbild, Einstellungen – ohne Videos', fs.existsSync(zip) && names.filter(n => n.startsWith('projekte/')).length === nProj && names.includes(`projekte/${sid}.json`) && names.includes(`folien/${sid.slice(0, 20)}/folie-t1-2.png`) && names.includes('einstellungen.json') && names.includes('sicherung.json') && !names.some(n => /\.(mp4|mov)$/.test(n)), names.length);
chk('Meldung nennt Anzahl, Größe, Ort und dass die Videos fehlen', new RegExp(`^${nProj} Projekte gesichert \\(.+\\): ${zip.replace(/\//g, '\\/')}.* Die Videos sind nicht enthalten\\.$`).test(bmsg), bmsg);
await page.screenshot({ path: OUT + '/sichern.png' });
await page.click('#pkgCancel');

// ── Sicherung einspielen: gelöschtes Projekt, hier neueres Projekt, verlorene Designprofile ──
const trash0 = await page.evaluate(() => TS.trashCount());
await page.evaluate(i => TS.deleteProject(i), sid);
const other = PJ.edit; const before = JSON.parse(await page.evaluate(i => TS.loadProject(i), other));
await page.evaluate(([i, t]) => { const p = JSON.parse(TS.loadProject(i)); p.updated = t; p.name = p.name + ' (neuer)'; TS.saveProject(i, JSON.stringify(p)); }, [other, Date.now() + 5000]);
await page.evaluate(() => { localStorage.removeItem('hc-slide-profiles'); favCols = []; saveFavs(); });
chk('vor dem Einspielen: Projekt fehlt in der Liste', !(await api('projects')).some(p => p.id === sid));
setPick({ backup: [zip] });
chk('nach dem Sichern sind die Einstellungen noch offen', await page.evaluate(() => !document.querySelector('#modelSheet').classList.contains('hidden') && !document.querySelector('#sheetBack').classList.contains('hidden')));
await page.click('#setMore [data-k=restore] button');
await page.waitForFunction(() => document.querySelector('#hcModal #pkgCancel') && document.querySelector('#hcModal #pkgCancel').textContent === 'Schließen', null, { timeout: 30000 });
const rmsg = await page.evaluate(() => document.querySelector('#pkgMsg').textContent);
chk('Meldung: eins dazu, eins hier neuer, der Rest unverändert, Designprofil und Farbfavorit zurück', /1 Projekt ist dazugekommen, 1 Projekt ist hier neuer und bleibt so, \d+ Projekte waren schon auf diesem Stand\. Dazu 2 Designprofile und Farbfavoriten\. Der jeweils andere Stand liegt bei den früheren Fassungen des Projekts\.$/.test(rmsg), rmsg);
await page.screenshot({ path: OUT + '/einspielen.png' });
await page.click('#pkgCancel'); await sleep(200);
const after = await page.evaluate(i => ({ list: [...document.querySelectorAll('#projList .proj-item b')].map(b => b.textContent), prof: JSON.parse(localStorage.getItem('hc-slide-profiles') || '[]').map(p => p.id), fav: favCols, trash: TS.trashCount() }), sid);
chk('Projekt steht wieder in der Liste und nicht mehr im Papierkorb, Profile und Favoriten sind zurück', after.list.includes('Test ' + sid) && after.trash === trash0 && after.prof.join() === 'meins' && after.fav.join() === '#E5402A', after);
const vers = await api('project/versions?id=' + other);
chk('das hier neuere Projekt bleibt; der gesicherte Stand liegt bei seinen früheren Fassungen', JSON.parse(await page.evaluate(i => TS.loadProject(i), other)).name.endsWith('(neuer)') && vers.some(v => v.name === before.name && v.at === before.updated), vers.map(v => v.name));
await page.evaluate(([i, b]) => TS.saveProject(i, JSON.stringify(b)), [other, before]);   // Ausgangszustand wiederherstellen

// ── Fehlerbericht ──
const rep = path.join(OUT, 'fehlerbericht.txt'); fs.rmSync(rep, { force: true }); setPick({ save_any: [rep] });
await page.click('#setMore [data-k=report] button'); await sleep(1200);
const rtxt = fs.existsSync(rep) ? fs.readFileSync(rep, 'utf8') : '';
chk('Fehlerbericht gespeichert: Version, System, Fensterangaben der Oberfläche, Protokoll', rtxt.includes('HoneyCut – Fehlerbericht') && rtxt.includes('Fenster: 1480×900') && rtxt.includes('Browser-Kennung: Mozilla') && rtxt.includes('── Protokoll') && rtxt.includes('Alle Projekte gesichert') && (await toastText()) === 'Fehlerbericht gespeichert: ' + rep, rtxt.length);
await page.evaluate(() => { document.querySelector('#toast').textContent = ''; });
const size0 = fs.statSync(rep).size; setPick({}); await page.click('#setMore [data-k=report] button'); await sleep(600);
chk('abgebrochener Dialog: nichts geschrieben, keine Fehlermeldung', fs.statSync(rep).size === size0 && (await toastText()) === '', await toastText());

// ── Neue Versionen ──
await page.click('#setMore [data-k=update] button'); await sleep(900);
let u = await page.evaluate(() => ({ note: document.querySelector('#setMore [data-k=update] .muted').textContent, on: document.querySelector('#updOn').checked, banner: !document.querySelector('#updBanner').classList.contains('hidden'), toast: document.querySelector('#toast').textContent }));
chk('nichts Neueres bei GitHub: „HoneyCut ist aktuell“, kein Hinweis auf der Startseite', u.on && u.toast === 'HoneyCut ist aktuell' && u.note.includes(`HoneyCut ${cur} ist aktuell.`) && !u.banner, u);
// jetzt stehen zwei neuere Versionen bereit (dazu ein Entwurf, eine Android-Fassung und eine Fassung ohne Installer, die nicht zählen)
github({ releases: [{ ...rel(`${maj}.${min + 9}.0`), draft: true }, { tag_name: `v${maj}.${min + 8}.0`, assets: [] }, { tag_name: 'android-v9.9.9', assets: [] }, rel(v2), rel(v1), rel(cur)],
  notes: `# Neuigkeiten\n\n## ${maj}.${min + 3}.0 · Noch nicht veröffentlicht\n- kommt später\n\n## ${v2} · Quellen und Belege\n- Quellen zu Aussagen hinterlegen\n- Bauchbinden im Hausstil\n\n## ${v1} – Kleine Helfer\n- Titelbild exportieren\n* Kapitelmarken\n\n## ${cur} · Diese Version\n- schon installiert\n` });
await page.click('#setMore [data-k=update] button'); await page.waitForSelector('#updNotes h4', { timeout: 15000 });
const up = await page.evaluate(() => ({ h: document.querySelector('#mgBody h3').textContent, p: document.querySelector('#mgBody p').textContent, notes: [...document.querySelectorAll('#updNotes h4')].map(h => h.textContent), points: [...document.querySelectorAll('#updNotes li')].map(l => l.textContent) }));
chk('„Jetzt prüfen“ zeigt die neue Version mit den Änderungen aller übersprungenen Versionen', up.h === `HoneyCut ${v2}` && up.p.includes(`Du verwendest ${cur}`) && up.p.includes('640 MB') && up.notes.join('|') === `${v2} · Quellen und Belege|${v1} · Kleine Helfer` && up.points.length === 4, up);
await page.screenshot({ path: OUT + '/neue-version.png' });
await page.click('#updGet'); await sleep(300); await page.click('#updPage'); await sleep(300);
const opened = fs.readFileSync(OPENED, 'utf8').trim().split('\n');
chk('Installer und Seite öffnen sich im Standardbrowser', opened.includes(`https://github.com/honeybalecta/textschnitt/releases/download/v${v2}/HoneyCut-Setup-${v2}.exe`) && opened.includes(`https://github.com/honeybalecta/textschnitt/releases/tag/v${v2}`), opened);
await page.click('#mgClose'); await sleep(150);
let b = await page.evaluate(() => ({ shown: !document.querySelector('#updBanner').classList.contains('hidden'), t: document.querySelector('#updBanner b') && document.querySelector('#updBanner b').textContent, s: document.querySelector('#updBanner .muted') && document.querySelector('#updBanner .muted').textContent }));
chk('Startseite meldet die neue Version', b.shown && b.t === `HoneyCut ${v2} ist da` && b.s === `Du verwendest ${cur}.`, b);
await page.screenshot({ path: OUT + '/hinweis.png' });
await page.click('#updBanner [data-a=skip]'); await sleep(200);
await page.reload(); await page.waitForFunction(() => typeof showHome === 'function'); await sleep(400);
chk('„Überspringen“ gilt auch nach einem Neustart der Oberfläche', await page.evaluate(() => document.querySelector('#updBanner').classList.contains('hidden')) && (await api('update')).skip === v2);
await page.click('#modelsBtn'); await sleep(200);
u = await page.evaluate(() => ({ note: document.querySelector('#setMore [data-k=update] .muted').textContent, btns: [...document.querySelectorAll('#setMore [data-k=update] button')].map(x => x.textContent) }));
chk('in den Einstellungen bleibt die Version zu finden', u.note.startsWith(`HoneyCut ${v2} steht bereit.`) && u.btns.join() === 'Jetzt prüfen,Ansehen', u);
await page.click('#updOn'); await sleep(200);
chk('Abschalten wird gespeichert', (await api('update')).enabled === false && JSON.parse(fs.readFileSync(DATA + '/einstellungen.json', 'utf8')).updates === false);
await page.click('#updOn'); await sleep(200);
chk('Wiedereinschalten ebenso', (await api('update')).enabled === true);
await page.mouse.click(20, 400); await sleep(200);
chk('Klick neben das Blatt schließt die Einstellungen samt Hintergrund', await page.evaluate(() => document.querySelector('#modelSheet').classList.contains('hidden') && document.querySelector('#sheetBack').classList.contains('hidden')));

// Aufräumen: Wegwerf-Projekt, Testdateien, nachgestelltes GitHub wieder ohne neuere Version
await dropScratch(page, sid);
fs.rmSync(used, { force: true }); fs.rmSync(`${DATA}/folien/${sid.slice(0, 20)}`, { recursive: true, force: true });
github({ releases: [rel(cur)], notes: '' }); await api('update/check', {}); await api('update/set', { skip: '' });
chk('keine Fehler in der Seite, keine fehlgeschlagenen Anfragen', !logs.length, logs.slice(0, 8));
await ende(browser);
