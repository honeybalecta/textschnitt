"""Diagnose (nur auf dem Testzweig): Die veröffentlichte Windows-App wird wie bei Nutzer:innen installiert und gestartet.
Dann exportiert sie Videos mit eingebrannten Untertiteln in verschiedenen Schriften – einmal über ihre Schnittstelle,
einmal über ihre echte Oberfläche (im Browser bedient). Geprüft wird das fertige Video. Ergebnis: diag2/ergebnis.txt."""
import http.client
import json
import os
import platform
import subprocess
import sys
import time
import traceback
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "diag2"
OUT.mkdir(exist_ok=True)
LOCAL = Path(os.environ.get("LOCALAPPDATA", ""))
APP = LOCAL / "Programs" / "HoneyCut"
EXE = APP / "HoneyCut.exe"
FFMPEG = APP / "_internal" / "ffmpeg" / "ffmpeg.exe"
DATA = LOCAL / "Textschnitt"
MEDIA = Path(os.environ.get("USERPROFILE", str(ROOT))) / "Videos" / "Mein Video äöü"
PID = os.environ.get("DIAG_PID") or "h0xjo2pm"
# Probelauf des Skripts selbst gegen ein schon laufendes Test-Backend (nur zum Prüfen des Skripts): DIAG_PROBE=Port/Zugang
PROBE = os.environ.get("DIAG_PROBE") or ""
if PROBE:
    FFMPEG, DATA, MEDIA = Path("ffmpeg"), Path(os.environ["DIAG_DATA"]), Path(os.environ["DIAG_MEDIA"])
FILES = {"poppins": "Poppins-Bold.ttf", "anton": "Anton-Regular.ttf", "playfair": "PlayfairDisplay-ExtraBold.ttf"}
LOG = []


def P(*a):
    s = " ".join(str(x) for x in a)
    print(s, flush=True)
    LOG.append(s)
    (OUT / "ergebnis.txt").write_text("\n".join(LOG) + "\n", encoding="utf-8")


def run(cmd, cwd=None, timeout=900):
    r = subprocess.run([str(c) for c in cmd], cwd=str(cwd) if cwd else None, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=timeout, stdin=subprocess.DEVNULL)
    return r.returncode, r.stdout, r.stderr


def crop(video, t, name, geo):
    """Bildausschnitt mit dem Untertitel: als PNG ablegen und als Graustufen-Rohdaten zurückgeben."""
    png, raw = OUT / f"{name}.png", OUT / f"{name}.raw"
    run([FFMPEG, "-v", "error", "-y", "-ss", t, "-i", video, "-frames:v", "1", "-vf", f"crop={geo}", png])
    run([FFMPEG, "-v", "error", "-y", "-ss", t, "-i", video, "-frames:v", "1", "-vf", f"crop={geo}", "-f", "rawvideo", "-pix_fmt", "gray", raw])
    data = raw.read_bytes() if raw.exists() else b""
    raw.unlink(missing_ok=True)
    return data


def diff(a, b):
    if not a or len(a) != len(b):
        return -1.0
    return sum(1 for x, y in zip(a, b) if abs(x - y) > 24) / len(a)


def verdict(d):
    return "Schrift kommt an" if d > 0.01 else "GLEICHES BILD: die Schrift kommt NICHT an"


def find_app():
    for port in range(8765, 8785):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/ping", timeout=1) as r:
                if json.load(r).get("app") != "textschnitt":
                    continue
            c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
            c.request("GET", "/")
            r = c.getresponse()
            loc = r.getheader("Location") or ""
            r.read()
            c.close()
            tok = loc.strip("/").split("/")[0]
            if tok:
                return port, tok
        except Exception:  # noqa: BLE001
            pass
    return None, None


def api(port, tok, path, body=None):
    req = urllib.request.Request(f"http://127.0.0.1:{port}/{tok}/api/{path}",
                                 data=json.dumps(body).encode("utf-8") if body is not None else None,
                                 headers={"Content-Type": "application/json"} if body is not None else {})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode("utf-8") or "null")


def export(port, tok, plan, timeout=900):
    job = api(port, tok, "export", plan)["job"]
    t0 = time.time()
    while time.time() - t0 < timeout:
        j = api(port, tok, f"job?id={job}")
        if j and j.get("status") != "running":
            return j
        time.sleep(1)
    raise TimeoutError("Export dauert zu lange")


def make_video(path, size, dur):
    rc, _, e = run([FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc2=size={size}:rate=30", "-f", "lavfi", "-i", "sine=frequency=440",
                    "-t", str(dur), "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", path])
    P(f"  Testvideo {path.name} ({size}, {dur} s): rc {rc} {e.strip()[:200]}")


def plan_for(video, w, h, font, name, segs, total, cue):
    seg = {"kind": "main", "src": 0, "uri": str(video), "zooms": [], "hasAudio": True, "hasVideo": True, "speed": 1, "vol": 1,
           "bright": 0, "contrast": 0, "sat": 0, "gray": False, "tx": 0, "ty": 0, "sc": 1}
    return {"format": "video", "name": name, "width": w, "height": h, "fps": 30, "total": total,
            "segments": [{**seg, "in": a, "out": b} for a, b in segs],
            "overlays": [], "burn": True, "quality": "standard", "audioFormat": "wav", "capcutInstall": False,
            "subs": {"cues": [cue],
                     "style": {"enabled": True, "mode": "lines", "chars": 32, "lines": 2, "dur": 4, "size": "mittel", "pos": "unten", "x": 0.5, "y": 0.88,
                               "color": "#FFFFFF", "outline": True, **({"font": font} if font else {})},
                     "fonts": {font: {"family": "TS " + font, "file": FILES[font]}} if font else {}},
            "sources": [{"uri": str(video), "name": Path(video).name, "duration": 200, "width": w, "height": h, "fps": 30, "hasAudio": True, "hasVideo": True, "kind": "video"}],
            "project": "diag"}


def main():
    P("== Umgebung ==")
    P("Windows:", platform.platform(), "· Python des Prüfskripts:", sys.version.split()[0])
    P("App:", EXE, "vorhanden:", EXE.exists(), "· ffmpeg:", FFMPEG.exists())
    fonts_dir = APP / "_internal" / "web" / "fonts"
    P("Schriftdateien der installierten App:", sorted(p.name for p in fonts_dir.glob("*.ttf")) if fonts_dir.is_dir() else "ORDNER FEHLT")
    try:
        st = OUT / "selftest.json"
        if not PROBE:
            subprocess.run([str(EXE), "--selftest", str(st)], timeout=300)
            rep = json.loads(st.read_text(encoding="utf-8"))
            P("Selbsttest der installierten App:", {k: rep.get(k) for k in ("ok", "ffmpeg", "faster_whisper", "web")})
    except Exception as ex:  # noqa: BLE001
        P("Selbsttest: FEHLER", ex)

    P("\n== Vorbereitung ==")
    MEDIA.mkdir(parents=True, exist_ok=True)
    kurz, hoch = MEDIA / "kurz.mp4", MEDIA / "hoch kant.mp4"
    make_video(kurz, "640x360", 180)
    make_video(hoch, "540x960", 20)
    proj = json.loads((ROOT / "tests" / "diag_projekt.json").read_text(encoding="utf-8"))
    proj["sources"][0]["uri"] = str(kurz)
    proj["id"] = PID
    (DATA / "projects").mkdir(parents=True, exist_ok=True)
    (DATA / "projects" / f"{PID}.json").write_text(json.dumps(proj, ensure_ascii=False), encoding="utf-8")
    P("  Projekt abgelegt:", DATA / "projects" / f"{PID}.json")

    proc = None
    port = tok = None
    if PROBE:
        port, tok = int(PROBE.split("/")[0]), PROBE.split("/")[1]
    else:
        env = dict(os.environ, TEXTSCHNITT_OPEN_ROOT="1")
        proc = subprocess.Popen([str(EXE)], env=env, cwd=str(APP))
        for _ in range(120):
            port, tok = find_app()
            if port:
                break
            time.sleep(1)
        P("  App gestartet: Prozess", proc.pid, "läuft:", proc.poll() is None, "· Port:", port, "· Zugang gefunden:", bool(tok))
    if not port:
        P("  Die App antwortet nicht – Abbruch")
        return
    try:
        P("\n== A · Export über die Schnittstelle der installierten App (von Hand gebauter Plan) ==")
        cue = {"start": 0.3, "end": 7.6, "text": "Schrift im Export\nHamburgefonstiv ÄÖÜ 123", "x": 0.5, "y": 0.82}
        cases = {
            "quer": dict(video=kurz, w=640, h=360, segs=[(0, 4)], total=4, t=["2"], geo="640:120:0:240"),
            "hoch": dict(video=hoch, w=540, h=960, segs=[(0, 4)], total=4, t=["2"], geo="540:240:0:680"),
            "stuecke": dict(video=kurz, w=640, h=360, segs=[(k * 3, k * 3 + 1) for k in range(8)], total=8, t=["2", "6.6"], geo="640:120:0:240"),
        }
        for cname, c in cases.items():
            raws = {}
            for font in ("", "poppins", "anton", "playfair") if cname == "quer" else ("", "poppins"):
                try:
                    j = export(port, tok, plan_for(c["video"], c["w"], c["h"], font, f"api_{cname}_{font or 'standard'}", c["segs"], c["total"], cue))
                    if j.get("status") != "done":
                        P(f"  {cname:8s} {font or 'standard':9s} Status {j.get('status')}: {str(j.get('error'))[:400]}")
                        continue
                    video = (j.get("result") or {}).get("playable")
                    raws[font] = [crop(video, t, f"A_{cname}_{font or 'standard'}_{n}", c["geo"]) for n, t in enumerate(c["t"])]
                    P(f"  {cname:8s} {font or 'standard':9s} exportiert: {Path(video).name}")
                except Exception as ex:  # noqa: BLE001
                    P(f"  {cname:8s} {font or 'standard':9s} FEHLER: {ex}")
            for font in raws:
                if font:
                    for n, t in enumerate(c["t"]):
                        d = diff(raws.get("", [b""] * 9)[n], raws[font][n])
                        P(f"    {cname}: Standard ↔ {font} bei {t} s: {d:.4f} → {verdict(d)}")

        P("\n== B · Export über die echte Oberfläche der installierten App ==")
        ui_json = OUT / "ui.json"
        try:
            start = f"http://127.0.0.1:{port}/{tok}/index.html" if PROBE else f"http://127.0.0.1:{port}/"
            rc, o, e = run(["node", str(ROOT / "tests" / "diag_ui.mjs"), start, PID, str(ui_json)], cwd=ROOT, timeout=1500)
            P("  Bedienung beendet: rc", rc, (e or "").strip()[-300:])
        except Exception as ex:  # noqa: BLE001
            P("  Bedienung: FEHLER", ex)
        ui = json.loads(ui_json.read_text(encoding="utf-8")) if ui_json.exists() else {}
        P("  Browser:", ui.get("browser"), ui.get("browserVersion"), "· App:", ui.get("platform"), "· ok:", ui.get("ok"), ui.get("error") or "")
        P("  Projekt geöffnet:", ui.get("opened"))
        vids = {}
        for s in ui.get("steps", []):
            if s["step"].startswith("Schrift wählen"):
                P(f"  {s['step']}: Stil {s.get('font')!r}, Auswahlfeld {s.get('select')!r}, Vorschau {s.get('ovFamily')!r}")
            elif s["step"].startswith("Export"):
                mp4 = next((f for f in s.get("files", []) if f.lower().endswith(".mp4")), None)
                vids[s["step"][8:]] = (mp4, s)
                P(f"  {s['step']}: {s.get('msg')!r} · Format {s.get('fmt')} · einbrennen {s.get('burnBox')}/{s.get('burn')} · {s.get('nSeg')} Abschnitte · {s.get('nCues')} Untertitel")
                P(f"      Stil im Plan: {s.get('style')}")
                P(f"      Schriften im Plan: {s.get('fonts')} · Schrift je Untertitel: {s.get('cueFonts')} · erster Untertitel: {s.get('cue0')}")
            else:
                P(f"  {s['step']}: {s}")
        for msg in ui.get("logs", [])[:20]:
            P("    Meldung der Seite:", msg)

        def ui_cmp(a, b, label):
            va, vb = vids.get(a, (None, None)), vids.get(b, (None, None))
            if not va[0] or not vb[0]:
                P(f"    {label}: Video fehlt ({a}: {va[0]}, {b}: {vb[0]})")
                return
            for n, t in enumerate(va[1].get("mids") or [2.0]):   # Zeitpunkte mitten in einem Untertitel (aus dem Plan der Oberfläche)
                ra, rb = crop(va[0], f"{t:.2f}", f"B_{a}_{n}", "640:140:0:220"), crop(vb[0], f"{t:.2f}", f"B_{b}_{n}", "640:140:0:220")
                d = diff(ra, rb)
                P(f"    {label} bei {t:.1f} s: {d:.4f} → {verdict(d)}")
        ui_cmp("ui_standard", "ui_poppins", "ungeschnitten: Standard ↔ Poppins")
        ui_cmp("ui_standard", "ui_anton", "ungeschnitten: Standard ↔ Anton")
        ui_cmp("ui_schnitt_standard", "ui_schnitt_poppins", "mit Schnitten: Standard ↔ Poppins")
    except Exception:  # noqa: BLE001
        P("FEHLER:", traceback.format_exc()[-2500:])
    finally:
        P("\n== Protokoll der App (Auszug) ==")
        try:
            lines = (DATA / "textschnitt.log").read_text(encoding="utf-8", errors="replace").splitlines()
            keep = [ln[:260] for ln in lines if any(k in ln for k in ("Export", "Schrift", "subtitles=", "Job ", "FEHLER", "ffmpeg-Fehler", "gestartet"))]
            for ln in keep[-90:]:
                P("  |", ln)
        except Exception as ex:  # noqa: BLE001
            P("  Protokoll nicht lesbar:", ex)
        if proc:
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
        P("\nfertig")


if __name__ == "__main__":
    main()
