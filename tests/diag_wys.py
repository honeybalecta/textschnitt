"""Diagnose (nur auf dem Testzweig): die neu gebaute Windows-App – Schriftprobe des Selbsttests und der Vergleich
Vorschau ↔ Export für mehrere Schriften und Gestaltungen. Gemessen wird am fertigen Bild. Ergebnis: diag4/ergebnis.txt."""
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
OUT = ROOT / "diag4"
OUT.mkdir(exist_ok=True)
SHOTS = OUT / "bilder"
SHOTS.mkdir(exist_ok=True)
LOCAL = Path(os.environ.get("LOCALAPPDATA", ""))
APP = ROOT / "dist" / "HoneyCut"
EXE = APP / "HoneyCut.exe"
FFMPEG = APP / "_internal" / "ffmpeg" / "ffmpeg.exe"
DATA = LOCAL / "Textschnitt"
MEDIA = Path(os.environ.get("USERPROFILE", str(ROOT))) / "Videos" / "Mein Video äöü"
PID = os.environ.get("DIAG_PID") or "h0xjo2pm"
# Probelauf des Skripts selbst gegen ein schon laufendes Test-Backend: DIAG_PROBE=Port/Zugang
PROBE = os.environ.get("DIAG_PROBE") or ""
if PROBE:
    FFMPEG, DATA, MEDIA = Path("ffmpeg"), Path(os.environ["DIAG_DATA"]), Path(os.environ["DIAG_MEDIA"])
LOG = []


def P(*a):
    s = " ".join(str(x) for x in a)
    print(s, flush=True)
    LOG.append(s)
    (OUT / "ergebnis.txt").write_text("\n".join(LOG) + "\n", encoding="utf-8")


def run(cmd, cwd=None, timeout=1500, env=None):
    r = subprocess.run([str(c) for c in cmd], cwd=str(cwd) if cwd else None, capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=timeout, stdin=subprocess.DEVNULL, env=env)
    return r.returncode, r.stdout, r.stderr


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


def boxes():
    """Lage der hellen Schrift in Vorschau und Export (als Anteile des Bildes) und ihr Verhältnis."""
    import numpy as np
    from PIL import Image, ImageChops
    res = json.loads((SHOTS / "res.json").read_text(encoding="utf-8"))
    P("  Browser:", res.get("browser"), res.get("browserVersion"), "· App:", res.get("app"), "· ok:", res.get("ok"), res.get("error") or "")

    def white(a, b):
        A, B = Image.open(a).convert("RGB"), Image.open(b).convert("RGB")
        if A.size != B.size:
            B = B.resize(A.size)
        x, y = np.asarray(A).astype(int), np.asarray(B).astype(int)
        m = (np.abs(x - y).max(axis=2) > 40) & (x.min(axis=2) > 200)
        ys, xs = np.where(m)
        return None if len(xs) == 0 else [xs.min() / m.shape[1], ys.min() / m.shape[0], (xs.max() + 1) / m.shape[1], (ys.max() + 1) / m.shape[0]]
    bad = 0
    for c in res.get("cfg", []):
        if c.get("error"):
            P(f"  {c['name']:18s} FEHLER: {c['error'][:300]}")
            bad += 1
            continue
        for k, s in enumerate(c["shots"]):
            a = white(SHOTS / f"pv_{c['name']}_{k}.png", SHOTS / f"pv_{c['name']}_{k}_ohne.png")
            b = white(SHOTS / f"ex_{c['name']}_{k}.png", SHOTS / f"ex_{c['name']}_{k}_ohne.png")
            if not a or not b:
                P(f"  {c['name']:18s} {k}: keine Schrift gefunden (Vorschau {a}, Export {b})")
                bad += 1
                continue
            rw, rh = (b[2] - b[0]) / (a[2] - a[0]), (b[3] - b[1]) / (a[3] - a[1])
            dx, dy = ((b[0] + b[2]) - (a[0] + a[2])) / 2, ((b[1] + b[3]) - (a[1] + a[3])) / 2
            ok = 0.93 < rw < 1.07 and 0.90 < rh < 1.10 and abs(dx) < 0.012 and abs(dy) < 0.012
            bad += not ok
            P(f"  {c['name']:18s} {k}: Breite Export/Vorschau {rw:.3f} · Höhe {rh:.3f} · Mitte dx {dx:+.4f} dy {dy:+.4f} · {'passt' if ok else 'WEICHT AB'}"
              f" · Vorschau {s.get('fam', '')[:28]} {s.get('px', 0):.1f}px · {c.get('size')} · Hinweis: {c.get('warn')} · {repr(s['text'][:34])}")
    P("  Abweichungen:", bad)
    # Bildpaare zum Ansehen: links die Vorschau, rechts der Export
    for label, names, crop in (("quer", [c["name"] for c in res.get("cfg", []) if not c["name"].startswith("hoch") and not c.get("error")], 0.55),
                               ("hoch", [c["name"] for c in res.get("cfg", []) if c["name"].startswith("hoch") and not c.get("error")], 0.45)):
        tiles = []
        for n in names:
            c = next(x for x in res["cfg"] if x["name"] == n)
            W, H = c["size"]
            for k in range(len(c["times"])):
                pv = Image.open(SHOTS / f"pv_{n}_{k}.png").convert("RGB").resize((W, H), Image.LANCZOS)
                ex = Image.open(SHOTS / f"ex_{n}_{k}.png").convert("RGB")
                box = (0, int(H * crop) if n != "titel" else 0, W, H)
                tiles.append((pv.crop(box), ex.crop(box)))
        if not tiles:
            continue
        if label == "hoch":
            img = Image.new("RGB", (sum(a.size[0] + b.size[0] + 10 for a, b in tiles), max(a.size[1] for a, b in tiles)), (40, 40, 40))
            x = 0
            for a, b in tiles:
                img.paste(a, (x, 0))
                img.paste(b, (x + a.size[0] + 2, 0))
                x += a.size[0] + b.size[0] + 10
        else:
            img = Image.new("RGB", (max(a.size[0] + b.size[0] + 6 for a, b in tiles), sum(a.size[1] + 4 for a, b in tiles)), (40, 40, 40))
            y = 0
            for a, b in tiles:
                img.paste(a, (0, y))
                img.paste(b, (a.size[0] + 6, y))
                y += a.size[1] + 4
        img.save(OUT / f"paare_{label}.jpg", quality=82)
    return bad


def main():
    P("== Umgebung ==")
    P("System:", platform.platform(), "· Python des Prüfskripts:", sys.version.split()[0])
    if not PROBE:
        P("App:", EXE, "vorhanden:", EXE.exists())
        rc, o, e = run([EXE, "--diag", ROOT / "tests" / "diag_probe.py"], cwd=ROOT, env=dict(os.environ, DIAG_OUT=str(OUT)))
        try:
            rep = json.loads((OUT / "probe.json").read_text(encoding="utf-8"))
            P("== Schriftprobe des Selbsttests in der gebauten App ==")
            P("  Version", rep.get("version"), "· gebaut:", rep.get("frozen"), "· Standardschrift:", rep.get("standard"))
            P("  Ergebnis:", json.dumps(rep.get("probe"), ensure_ascii=False) if "probe" in rep else rep.get("error"))
        except Exception as ex:  # noqa: BLE001
            P("  Schriftprobe: FEHLER", ex, rc, (e or "")[-300:])

    P("\n== Vorbereitung ==")
    MEDIA.mkdir(parents=True, exist_ok=True)
    kurz = MEDIA / "kurz.mp4"
    rc, _, e = run([FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=440",
                    "-t", "180", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", kurz])
    P("  Testvideo:", kurz.name, "rc", rc, e.strip()[:200])
    proj = json.loads((ROOT / "tests" / "diag_projekt.json").read_text(encoding="utf-8"))
    proj["sources"][0]["uri"] = str(kurz)
    proj["id"] = PID
    (DATA / "projects").mkdir(parents=True, exist_ok=True)
    (DATA / "projects" / f"{PID}.json").write_text(json.dumps(proj, ensure_ascii=False), encoding="utf-8")
    proc = None
    port = tok = None
    if PROBE:
        port, tok = int(PROBE.split("/")[0]), PROBE.split("/")[1]
    else:
        proc = subprocess.Popen([str(EXE)], env=dict(os.environ, TEXTSCHNITT_OPEN_ROOT="1"), cwd=str(APP))
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
        P("\n== Vorschau ↔ Export (helle Schrift im Bild, Anteile von Breite und Höhe) ==")
        start = f"http://127.0.0.1:{port}/{tok}/index.html" if PROBE else f"http://127.0.0.1:{port}/"
        rc, o, e = run(["node", ROOT / "tests" / "diag_wys.mjs", start, PID, SHOTS, ROOT / "tests" / "diag_wys.json"], cwd=ROOT, env=dict(os.environ, DIAG_FFMPEG=str(FFMPEG)))
        P("  Bedienung beendet: rc", rc, (e or "").strip()[-300:])
        boxes()
    except Exception:  # noqa: BLE001
        P("FEHLER:", traceback.format_exc()[-2500:])
    finally:
        P("\n== Protokoll der App (Schriften) ==")
        try:
            lines = (DATA / "textschnitt.log").read_text(encoding="utf-8", errors="replace").splitlines()
            keep = [ln[:240] for ln in lines if any(k in ln for k in ("Schrift", "libass", "FEHLER", "ffmpeg-Fehler", "gestartet auf"))]
            seen, out = set(), []
            for ln in keep:
                key = ln[21:]
                if key not in seen:
                    seen.add(key)
                    out.append(ln)
            for ln in out[-60:]:
                P("  |", ln)
        except Exception as ex:  # noqa: BLE001
            P("  Protokoll nicht lesbar:", ex)
        if proc:
            subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
        for f in SHOTS.glob("*.png"):   # die Einzelbilder bleiben nicht im Zweig, nur die Bildpaare
            f.unlink()
        P("\nfertig")


if __name__ == "__main__":
    main()
