// Übergabe im Heimnetz (2.37, G7 „Am Handy weiterschneiden“): QR-Code, das Blatt am Computer mit dem zeitweiligen Empfang, die
// Abläufe am Handy. Das „Handy“ ist hier zweierlei: für den Empfang am Computer ein HTTP-Aufruf aus dieser Prüfung (wie ihn die
// Android-App über Handover.kt stellt), für die Oberfläche am Handy eine nachgestellte Brücke (TS.handoverInfo/Fetch/Send).
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launch, ids, scratch, dropScratch, sleep, pruefung, OUT, WORK } from './drv.mjs';
const { chk, ende } = pruefung('Übergabe im Heimnetz');
const { browser, page, logs } = await launch();
const ev = (f, a) => page.evaluate(f, a);
const dialogs = []; page.on('dialog', d => dialogs.push(d.message()));
const made = [];
const FEST = '33,3605063143,535';   // Größe, Prüfsumme über alle Felder, Zahl der dunklen Felder
const IMP = path.join(WORK, 'importe');
const readPkg = b => { const n = Number(b.readBigUInt64LE(10)); return { magic: b.subarray(0, 10).toString(), header: JSON.parse(b.subarray(18, 18 + n).toString('utf8')), rest: b.length - 18 - n }; };
const mkPkg = header => { const h = Buffer.from(JSON.stringify(header), 'utf8'), l = Buffer.alloc(8); l.writeBigUInt64LE(BigInt(h.length)); return Buffer.concat([Buffer.from('HONEYCUT1\n'), l, h]); };

try {
  // ═════════ QR-Code ═════════
  const texts = ['A', 'http://192.168.178.123:54321/h/AbCdEf123456', 'http://10.0.0.7:8080/h/Zz09_-Zz09_-', 'ÄÖÜ ß – „Test“ ' + 'x'.repeat(60), 'y'.repeat(120), 'z'.repeat(178)];
  const ms = await ev(ts => ts.map(t => qrMatrix(t)), texts);
  chk('QR-Code: Die Größe wächst mit dem Text (Version 1 bis 9), jede Zeile ist so lang wie das Feld', ms.map(m => m.length).join() === '21,33,29,41,45,53' && ms.every(m => m.every(r => r.length === m.length && r.every(v => v === 0 || v === 1))), ms.map(m => m.length));
  const finder = (m, x, y) => { for (let dy = 0; dy < 7; dy++) for (let dx = 0; dx < 7; dx++){ const d = Math.max(Math.abs(dx - 3), Math.abs(dy - 3)); if (m[y + dy][x + dx] !== (d === 2 ? 0 : 1)) return false; } return true; };
  chk('QR-Code: drei Suchmuster in den Ecken, Taktlinien dazwischen', ms.every(m => { const n = m.length; return finder(m, 0, 0) && finder(m, n - 7, 0) && finder(m, 0, n - 7) && m[6].slice(8, n - 8).every((v, i) => v === (i % 2 ? 0 : 1)); }));
  let gelesen = null;
  try {
    fs.writeFileSync(path.join(OUT, 'qr.json'), JSON.stringify({ texts, ms }));
    gelesen = JSON.parse(execFileSync('python3', ['-c', `
import json, sys
import numpy as np, cv2
d = json.load(open(sys.argv[1])); det = cv2.QRCodeDetector(); out = []
for t, m in zip(d['texts'], d['ms']):
    a = np.array(m, dtype=np.uint8); n = len(a)
    img = np.full(((n + 8) * 8, (n + 8) * 8), 255, np.uint8)
    img[32:32 + n * 8, 32:32 + n * 8] = np.kron(1 - a, np.ones((8, 8), np.uint8)) * 255
    out.append(det.detectAndDecode(img)[0] == t)
print(json.dumps(out))`, path.join(OUT, 'qr.json')], { stdio: ['ignore', 'pipe', 'ignore'] }).toString());
  } catch (_) { gelesen = null; }
  if (gelesen) chk('QR-Code: Ein unabhängiger Leser (OpenCV) liest aus allen sechs Codes genau den Text', gelesen.length === 6 && gelesen.every(Boolean), gelesen);
  else console.log('hinweis QR-Code: kein OpenCV auf diesem Rechner – das Gegenlesen entfällt hier');
  // Bezugswert: Der Code für eine feste Adresse bleibt Feld für Feld derselbe (gegengelesen mit OpenCV, als die Prüfung entstand)
  const fest = await ev(() => { const m = qrMatrix('http://192.168.178.123:54321/h/AbCdEf123456'); let h = 0; for (const r of m) for (const v of r) h = (h * 31 + v) >>> 0; return [m.length, h, m.flat().reduce((s, v) => s + v, 0)]; });
  chk('QR-Code: fester Bezugswert für eine feste Adresse', fest.join() === FEST, fest);
  chk('zu langer Text wird abgewiesen', await ev(() => { try { qrMatrix('x'.repeat(400)); return false; } catch (e) { return /zu lang/.test(e.message); } }));
  const adr = await ev(() => ['192.168.1.20:51234/h/AbCdEf123456', ' http://10.0.0.7:8080/h/Zz09_-Zz09_-/ ', 'https://example.org/h/AbCdEf123456', '192.168.1.20/h/AbCdEf123456', '192.168.1.20:51234/x/AbCdEf123456', ''].map(handoverUrl));
  chk('Adresse am Handy: mit oder ohne „http://“, Leerzeichen und Schrägstrich am Ende zählen nicht; ohne Port oder Kennung passt sie nicht',
    adr[0] === 'http://192.168.1.20:51234/h/AbCdEf123456' && adr[1] === 'http://10.0.0.7:8080/h/Zz09_-Zz09_-' && adr.slice(2).every(a => a === ''), adr);

  // ═════════ Am Computer ═════════
  fs.rmSync(IMP, { recursive: true, force: true });
  let st = await ev(() => ({ cap: CAP.handover, home: [document.querySelector('#handBtn').classList.contains('hidden'), document.querySelector('#handBtn').textContent.trim()], state: JSON.parse(TS.handoverState()) }));
  chk('Startseite am Computer: Knopf „Handy“; ohne offenes Blatt läuft kein Empfang', st.cap === true && st.home[0] === false && st.home[1] === 'Handy' && st.state.active === false, st);
  const id = await scratch(page, ids().kurz); made.push(id);
  await ev(() => setTab('export')); await sleep(300);
  st = await ev(() => { const b = document.querySelector('#handProjBtn'); return [b.classList.contains('hidden'), b.textContent.trim(), b.getBoundingClientRect().width > 50]; });
  chk('Export-Reiter: „Ans Handy übergeben …“ neben „Projekt exportieren“', st[0] === false && /Ans Handy übergeben/.test(st[1]) && st[2], st);
  await ev(() => { P.name = 'Rede zur Übergabe'; saveNow(); }); await sleep(200);
  await page.click('#handProjBtn'); await sleep(300);
  st = await ev(() => ({ h: document.querySelector('#hoBox h3').textContent, media: document.querySelector('#hoMedia').checked, go: document.querySelector('#hoGo').textContent, live: document.querySelector('#hoLive').classList.contains('hidden'), txt: document.querySelector('#hoSetup').textContent, state: JSON.parse(TS.handoverState()).active }));
  chk('das Blatt fragt zuerst, ob Videos mitgehen; bis „Bereitstellen“ ist nichts im Netz erreichbar', st.h === 'Ans Handy übergeben' && st.media && st.go === 'Bereitstellen' && st.live && /Rede zur Übergabe/.test(st.txt) && st.state === false, st);
  await page.screenshot({ path: path.join(OUT, 'uebergabe-fragen.png') });
  await page.click('#hoGo'); await sleep(1300);
  const s1 = await ev(() => JSON.parse(TS.handoverState()));
  st = await ev(() => { const cv = document.querySelector('#hoQr'), x = cv.getContext('2d'), d = x.getImageData(0, 0, cv.width, cv.height).data; let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 80) dark++;
    return { size: [cv.width, cv.height], dark: dark / (d.length / 4), addr: document.querySelector('#hoAddr').textContent, status: document.querySelector('#hoStatus').textContent, steps: document.querySelectorAll('.ho-steps li').length, setup: document.querySelector('#hoSetup').classList.contains('hidden'),
      same: (() => { const m = qrMatrix('http://' + document.querySelector('#hoAddr').textContent), n = m.length, cell = cv.width / (n + 8); const p = (c, r) => x.getImageData(Math.floor((c + 4.5) * cell), Math.floor((r + 4.5) * cell), 1, 1).data[0] < 80 ? 1 : 0; let ok = 0; for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (p(c, r) === m[r][c]) ok++; return ok === n * n; })() }; });
  chk('„Bereitstellen“ öffnet den Empfang: QR-Code mit der Adresse, drei Schritte, das Projekt steht bereit',
    s1.active && s1.urls.length >= 1 && st.setup && st.steps === 3 && st.size[0] === st.size[1] && st.size[0] >= 200 && st.dark > 0.15 && st.dark < 0.6 && st.same && st.addr === s1.urls[0].replace('http://', '') && /steht bereit .*Warte auf das Handy/.test(st.status) && s1.offer.name === 'Rede zur Übergabe', { st, offer: s1.offer });
  await page.screenshot({ path: path.join(OUT, 'uebergabe-qr.png') });
  const base = `http://127.0.0.1:${s1.port}/h/${s1.urls[0].split('/h/')[1]}`;
  // … das Handy: Seite, Auskunft, Paket
  const seite = await (await fetch(base + '/')).text();
  chk('Seite fürs Handy: Projektname und der Knopf in die App', /Rede zur Übergabe/.test(seite) && /intent:\/\/uebergabe\?u=http%3A%2F%2F127\.0\.0\.1/.test(seite) && /In HoneyCut öffnen/.test(seite));
  const info = await (await fetch(base + '/info')).json();
  const buf = Buffer.from(await (await fetch(base + '/paket')).arrayBuffer()), pk = readPkg(buf);
  chk('das Handy holt das Paket: Projekt mit Platzhaltern, das Video steckt darin', info.app === 'honeycut' && info.offer.project === id && buf.length === info.offer.bytes && pk.magic === 'HONEYCUT1\n' && pk.header.project.id === id && pk.header.project.sources[0].uri === '@hc:m0'
    && pk.header.files[0].included === true && pk.rest === pk.header.files.reduce((s, f) => s + (f.included ? f.size : 0), 0) && pk.rest > 1e6, [buf.length, pk.header.files.map(f => [f.name, f.size, f.included])]);
  await sleep(1300);
  chk('das Blatt meldet: angekommen', /ist auf dem Handy angekommen/.test(await ev(() => document.querySelector('#hoStatus').textContent)), await ev(() => document.querySelector('#hoStatus').textContent));
  // … am Handy bearbeitet: ein Titel dazu, nur der Schnitt geht zurück
  const zur = JSON.parse(JSON.stringify(pk.header)); zur.files.forEach(f => { f.included = false; f.size = 0; });
  zur.project.items = (zur.project.items || []).concat({ id: 'vomhandy', type: 'title', at: 2, dur: 3, text: 'Am Handy ergänzt', x: 0.5, y: 0.2, size: 'mittel' }); zur.project.updated = Date.now();
  const rr = await fetch(base + '/zurueck', { method: 'POST', body: mkPkg(zur) });
  await sleep(1300);
  st = await ev(() => ({ inbox: document.querySelector('#hoInbox').textContent, btn: document.querySelectorAll('#hoInbox [data-take]').length }));
  chk('Rückgabe vom Handy: steht im Blatt unter „Vom Handy“ mit „Übernehmen“', rr.status === 200 && /Vom Handy/.test(st.inbox) && /Rede zur Übergabe/.test(st.inbox) && st.btn === 1, st);
  await page.screenshot({ path: path.join(OUT, 'uebergabe-eingang.png') });
  dialogs.length = 0;
  await page.click('#hoInbox [data-take]');
  await page.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i && P.items.some(x => x.id === 'vomhandy'), id, { timeout: 20000 }); await sleep(500);
  st = await ev(() => ({ title: P.items.find(x => x.id === 'vomhandy').text, src: P.sources[0].uri, modal: !!document.querySelector('#hoBox'), state: JSON.parse(TS.handoverState()).active, toast: document.querySelector('#toast').textContent, dur: total > 10, v: !!V.src }));
  chk('„Übernehmen“ fragt nach (ersetzen oder Kopie) und öffnet die Fassung vom Handy; die Videos des Computers bleiben verknüpft', dialogs.length === 1 && /gibt es auf diesem Gerät schon/.test(dialogs[0]) && st.title === 'Am Handy ergänzt' && /kurz\.mp4$/.test(st.src) && st.dur && st.v && /importiert/.test(st.toast), [dialogs, st]);
  chk('danach ist das Blatt zu und der Empfang geschlossen', !st.modal && st.state === false, st);
  let zu = false; try { await fetch(base + '/info', { signal: AbortSignal.timeout(2500) }); } catch (_) { zu = true; }
  chk('die Adresse antwortet nicht mehr', zu);
  // nur warten: von der Startseite aus, ohne Projekt
  await ev(() => { pausePlay(); clearTimeout(saveT); saveNow(); closeProject(); }); await sleep(300);
  await page.click('#handBtn'); await sleep(250);
  st = await ev(() => [document.querySelector('#hoBox h3').textContent, document.querySelector('#hoGo').textContent, !!document.querySelector('#hoMedia')]);
  await page.click('#hoGo'); await sleep(1200);
  const s2 = await ev(() => JSON.parse(TS.handoverState()));
  chk('Startseite → „Handy“: Verbindung ohne Angebot, mit neuer Kennung', st[0] === 'Mit dem Handy verbinden' && st[1] === 'Verbindung öffnen' && !st[2] && s2.active && s2.offer === null && s2.urls[0].split('/h/')[1] !== s1.urls[0].split('/h/')[1] && /Warte auf das Handy/.test(await ev(() => document.querySelector('#hoStatus').textContent)), [st, s2.offer]);
  await page.click('#hoDone'); await sleep(300);
  chk('„Schließen“ beendet den Empfang', (await ev(() => [JSON.parse(TS.handoverState()).active, !!document.querySelector('#hoBox')])).join() === 'false,false');

  // ═════════ Am Handy (nachgestellte Brücke der Android-App) ═════════
  const mob = await launch({ viewport: { width: 390, height: 844 }, dpr: 2 }), hp = mob.page, pe = (f, a) => hp.evaluate(f, a);
  const hdlg = []; hp.on('dialog', d => hdlg.push(d.message()));
  try {
    const hid = await scratch(hp, ids().kurz);
    await pe(() => { pausePlay(); clearTimeout(saveT); P.name = 'Rede am Handy'; saveNow(); closeProject(); showHome(); });
    // Brücke wie in der Android-App: keine Übergabe „vom Computer aus“, dafür Auskunft, Holen und Senden
    await pe(hid => { window.HO = { calls: [], reach: true, offer: { name: 'Rede vom Computer', bytes: 1234000000, project: hid }, jobs: {} };
      TS.handoverStart = undefined; const job0 = TS.job;
      TS.job = i => HO.jobs[i] ? JSON.stringify(HO.jobs[i]()) : job0(i);
      TS.handoverInfo = (rid, url) => { HO.calls.push(['info', url]); setTimeout(() => TSApp.onPicked(rid, JSON.stringify(HO.reach ? { app: 'honeycut', version: '2.37.0', free: 5e10, offer: HO.offer } : { error: 'Zeitüberschreitung' })), 30); };
      const start = (rid, make) => { const jid = 'fake' + Math.random().toString(36).slice(2); let n = 0; HO.jobs[jid] = () => ++n < 3 ? { status: 'running', progress: n / 3, message: 'Wird übertragen · ' + n } : { status: 'done', progress: 1, result: make() }; setTimeout(() => TSApp.onPicked(rid, JSON.stringify({ job: jid })), 30); };
      TS.handoverFetch = (rid, url) => { HO.calls.push(['fetch', url]); start(rid, () => { const p = JSON.parse(TS.loadProject(hid)); p.name = 'Rede vom Computer'; p.items = (p.items || []).concat({ id: 'vompc', type: 'title', at: 1, dur: 2, text: 'Vom Computer', x: 0.5, y: 0.2, size: 'mittel' }); return { header: packageSpec(p, false, false).header, map: {} }; }); };
      TS.handoverSend = (rid, url, spec) => { HO.calls.push(['send', url, JSON.parse(spec)]); start(rid, () => ({ ok: true })); };
      showHome(); }, hid);
    await sleep(300);
    let h = await pe(() => [document.querySelector('#handBtn').classList.contains('hidden'), document.querySelector('#handBtn').textContent.trim()]);
    chk('Handy: Der Knopf auf der Startseite heißt „Computer“', h[0] === false && h[1] === 'Computer', h);
    await hp.click('#handBtn'); await sleep(250);
    h = await pe(() => ({ h: document.querySelector('#hcModal h3').textContent, txt: document.querySelector('#hcModal').textContent, inp: !!document.querySelector('#hcAddr'), wide: document.querySelector('.hc-card').getBoundingClientRect().width <= innerWidth }));
    chk('Handy: „Mit Computer verbinden“ erklärt den QR-Code und nimmt die Adresse auch getippt', h.h === 'Mit Computer verbinden' && /QR-Code mit der Kamera/.test(h.txt) && h.inp && h.wide, h);
    await pe(() => { document.querySelector('#hcAddr').value = 'unsinn'; document.querySelector('#hcGo').click(); }); await sleep(200);
    chk('Handy: Eine Adresse, die nicht passt, wird mit Beispiel abgewiesen', /passt nicht/.test(await pe(() => document.querySelector('#toast').textContent)) && (await pe(() => HO.calls.length)) === 0);
    await pe(() => { HO.reach = false; document.querySelector('#hcAddr').value = '192.168.1.20:51234/h/AbCdEf123456'; document.querySelector('#hcGo').click(); }); await sleep(400);
    h = await pe(() => [document.querySelector('#hpMsg').textContent, HO.calls.slice(-1)[0], !!document.querySelector('#hpGet')]);
    chk('Handy: Ist der Computer nicht erreichbar, nennt das Blatt die beiden üblichen Gründe', /nicht erreichbar/.test(h[0]) && /selben WLAN/.test(h[0]) && /noch geöffnet/.test(h[0]) && h[1].join() === 'info,http://192.168.1.20:51234/h/AbCdEf123456' && !h[2], h);
    // über den Link von der Seite des Computers (so ruft die App die Oberfläche)
    await pe(() => { HO.reach = true; closeHcModal(); TSApp.onHandover('http://192.168.1.20:51234/h/AbCdEf123456'); }); await sleep(400);
    h = await pe(hid => ({ msg: document.querySelector('#hpMsg').textContent, get: document.querySelector('#hpBody').textContent, sel: document.querySelector('#hpProj').value === hid, media: document.querySelector('#hpMedia').checked, opts: document.querySelectorAll('#hpProj option').length,
      fits: [...document.querySelectorAll('#hoPhone button, #hoPhone select')].every(el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 1; }) }), hid);
    chk('Handy: Nach dem Link aus der Seite zeigt das Blatt das Angebot mit Größe und die Rückgabe – das passende Projekt ist vorgewählt, ohne Videos', /bietet ein Projekt an/.test(h.msg) && /Rede vom Computer/.test(h.get) && /1,2 GB/.test(h.get) && /Auf dieses Handy holen/.test(h.get) && h.sel && h.media === false && h.opts >= 2 && h.fits, h);
    await hp.screenshot({ path: path.join(OUT, 'uebergabe-handy.png') });
    // zurückgeben: nur der Schnitt
    await hp.click('#hpSend');
    await hp.waitForFunction(() => /ist am Computer angekommen/.test(document.querySelector('#hpMsg').textContent), null, { timeout: 15000 });
    h = await pe(() => { const c = HO.calls.slice(-1)[0]; return { kind: c[0], url: c[1], inc: c[2].files.map(f => [f.n, f.include]), name: c[2].header.project.name, src: c[2].header.project.sources[0].uri, msg: document.querySelector('#hpMsg').textContent, prog: document.querySelector('#hpProg').classList.contains('hidden') }; });
    chk('Handy: „An den Computer zurückgeben“ schickt das Projekt mit Platzhaltern und ohne die Videos; danach steht, wie es am Computer weitergeht', h.kind === 'send' && h.url === 'http://192.168.1.20:51234/h/AbCdEf123456' && h.inc.length >= 1 && h.inc.every(f => f[1] === false) && h.name === 'Rede am Handy' && h.src === '@hc:m0' && /„Übernehmen“/.test(h.msg) && h.prog, h);
    await pe(() => { document.querySelector('#hpMedia').checked = true; document.querySelector('#hpSend').click(); });
    await hp.waitForFunction(() => HO.calls.filter(c => c[0] === 'send').length === 2, null, { timeout: 10000 });
    chk('Handy: Mit Häkchen gehen die Videos mit', (await pe(() => HO.calls.slice(-1)[0][2].files.every(f => f.include === true))));
    await hp.waitForFunction(() => /angekommen/.test(document.querySelector('#hpMsg').textContent) && !document.querySelector('#hpSend').disabled, null, { timeout: 15000 });
    // holen
    hdlg.length = 0;
    await hp.click('#hpGet');
    await hp.waitForFunction(i => typeof P !== 'undefined' && P && P.id === i && P.items.some(x => x.id === 'vompc'), hid, { timeout: 20000 }); await sleep(400);
    h = await pe(() => ({ name: P.name, calls: HO.calls.map(c => c[0]).join(), modal: !!document.querySelector('#hoPhone'), toast: document.querySelector('#toast').textContent, src: P.sources[0].uri }));
    chk('Handy: „Auf dieses Handy holen“ importiert das Projekt wie ein Paket und öffnet es; vorhandene Videos bleiben verknüpft', h.name === 'Rede vom Computer' && /fetch$/.test(h.calls) && !h.modal && /importiert/.test(h.toast) && /kurz\.mp4$/.test(h.src) && hdlg.length === 1, [h, hdlg]);
    await hp.evaluate(i => { if (typeof P !== 'undefined' && P && P.id === i){ pausePlay(); clearTimeout(saveT); P = null; busPid = null; showHome(); } TS.deleteProject(i); if (TS.trashPurge) try { TS.trashPurge(i); } catch (_) {} }, hid);
  } catch (e) {
    chk('Handy-Prüfung läuft ohne Abbruch durch', false, String(e && e.stack || e).slice(0, 600));
  }
  await mob.browser.close();
} catch (e) {
  chk('Prüfung läuft ohne Abbruch durch', false, String(e && e.stack || e).slice(0, 700));
}
await ev(() => { try { TS.handoverStop(); } catch (_) {} }).catch(() => {});
// (Der Hinweis auf willReadFrequently kommt vom Ablesen des QR-Codes in dieser Prüfung.)
const echte = logs.filter(l => !/willReadFrequently/.test(l));
chk('keine Fehlermeldungen der Seite', echte.length === 0, echte.slice(0, 6));
for (const id of made) await dropScratch(page, id).catch(() => {});
fs.rmSync(IMP, { recursive: true, force: true });
await ende(browser);
