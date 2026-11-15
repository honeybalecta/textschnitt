"""Diagnose (nur auf dem Testzweig): Kommt die gewählte Untertitel-Schrift unter Windows im eingebrannten Video an?
Läuft auf einem Windows-Rechner von GitHub mit demselben ffmpeg wie im Installer. Schreibt diag/ergebnis.txt und Bildausschnitte."""
import os
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FF = ROOT / "build" / "ffmpeg"
EXE = ".exe" if os.name == "nt" else ""
if (FF / f"ffmpeg{EXE}").exists():
    os.environ["FFMPEG"] = str(FF / f"ffmpeg{EXE}")
    os.environ["FFPROBE"] = str(FF / f"ffprobe{EXE}")
os.environ["TEXTSCHNITT_DATA"] = str(ROOT / "diag-daten")
sys.path.insert(0, str(ROOT))
import textschnitt as T  # noqa: E402

OUT = ROOT / "diag"
OUT.mkdir(exist_ok=True)
LOG = []


def P(*a):
    s = " ".join(str(x) for x in a)
    print(s, flush=True)
    LOG.append(s)
    (OUT / "ergebnis.txt").write_text("\n".join(LOG) + "\n", encoding="utf-8")


def run(cmd, cwd=None):
    r = subprocess.run([str(c) for c in cmd], cwd=str(cwd) if cwd else None, capture_output=True, text=True, encoding="utf-8", errors="replace")
    return r.returncode, r.stdout, r.stderr


def fontlines(err):
    keys = ("fontselect", "Loading font", "font provider", "libass", "ontconfig", "Glyph", "fontsdir", "No such", "rror", "Unable", "annot")
    return [ln.strip()[:230] for ln in err.splitlines() if any(k in ln for k in keys)]


def crop(video, t, name):
    """Bildausschnitt mit dem Untertitel: als PNG ablegen und als Graustufen-Rohdaten zurückgeben."""
    png = OUT / f"{name}.png"
    run([T.FFMPEG, "-v", "error", "-y", "-ss", t, "-i", video, "-frames:v", "1", "-vf", "crop=640:120:0:240", png])
    rc, _, _ = run([T.FFMPEG, "-v", "error", "-y", "-ss", t, "-i", video, "-frames:v", "1", "-vf", "crop=640:120:0:240", "-f", "rawvideo", "-pix_fmt", "gray", OUT / f"{name}.raw"])
    raw = (OUT / f"{name}.raw").read_bytes() if (OUT / f"{name}.raw").exists() else b""
    (OUT / f"{name}.raw").unlink(missing_ok=True)
    return raw


def diff(a, b):
    if not a or len(a) != len(b):
        return -1.0
    return sum(1 for x, y in zip(a, b) if abs(x - y) > 24) / len(a)


def main():
    P("== Umgebung ==")
    P("Python", sys.version.split()[0], "·", sys.platform, "· ffmpeg:", T.FFMPEG)
    rc, o, e = run([T.FFMPEG, "-hide_banner", "-version"])
    P((o or e).splitlines()[0] if (o or e) else "ffmpeg -version ohne Ausgabe")
    P("ffmpeg_major:", T.ffmpeg_major(), "· WEB_DIR:", T.WEB_DIR, "· Schriften dort:", sorted(p.name for p in (T.WEB_DIR / "fonts").glob("*.ttf")))
    work = Path(tempfile.mkdtemp(prefix="diag schrift äö "))   # mit Leerzeichen und Umlauten wie in manchem Benutzerordner
    video = work / "test.mp4"
    rc, o, e = run([T.FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=440",
                    "-t", "4", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", video])
    P("Testvideo:", video, "rc", rc, e.strip()[:200])

    def plan(font, name):
        fonts = {font: {"family": "TS " + font, "file": FILES[font]}} if font else {}
        return {"format": "video", "name": name, "width": 640, "height": 360, "fps": 30, "total": 4,
                "segments": [{"kind": "main", "src": 0, "uri": str(video), "in": 0, "out": 4, "zooms": [], "hasAudio": True, "hasVideo": True, "speed": 1, "vol": 1,
                              "bright": 0, "contrast": 0, "sat": 0, "gray": False, "tx": 0, "ty": 0, "sc": 1}],
                "overlays": [], "burn": True, "quality": "standard", "audioFormat": "wav", "capcutInstall": False,
                "subs": {"cues": [{"start": 0.3, "end": 3.9, "text": "Schrift im Export\nHamburgefonstiv ÄÖÜ 123", "x": 0.5, "y": 0.82}],
                         "style": {"enabled": True, "mode": "lines", "chars": 32, "lines": 2, "dur": 4, "size": "mittel", "pos": "unten", "x": 0.5, "y": 0.88,
                                   "color": "#FFFFFF", "outline": True, "font": font},
                         "fonts": fonts},
                "sources": [{"uri": str(video), "name": "test.mp4", "duration": 4, "width": 640, "height": 360, "fps": 30, "hasAudio": True, "hasVideo": True, "kind": "video"}],
                "project": "diag"}

    P("\n== A · Der echte Weg der App: export_job mit eingebrannten Untertiteln ==")
    raws = {}
    for font in ("", "poppins", "anton", "playfair"):
        try:
            res = T.export_job({"cancel": False, "progress": 0, "message": ""}, plan(font, "diag_" + (font or "standard")))
            raws[font] = crop(res["playable"], "2", "A_" + (font or "standard"))
            P(f"  {font or 'standard':10s} exportiert: {Path(res['playable']).name} · Ausschnitt {len(raws[font])} Bytes")
        except Exception as ex:  # noqa: BLE001
            P(f"  {font or 'standard':10s} FEHLER: {ex}")
            P(traceback.format_exc()[-1500:])
    for font in ("poppins", "anton", "playfair"):
        d = diff(raws.get(""), raws.get(font))
        P(f"  Unterschied Standard ↔ {font}: {d:.4f}  →  {'Schrift kommt an' if d > 0.01 else 'GLEICHES BILD: die Schrift kommt NICHT an'}")

    P("\n== B · Dieselben Dateien wie im Export, ffmpeg mit ausführlichem Protokoll ==")
    tmp = work / "nachbau"
    tmp.mkdir()
    names = T.collect_fonts({"poppins": {"family": "TS Poppins", "file": FILES["poppins"]}}, tmp / "fonts")
    P("collect_fonts →", names, "· Dateien:", [(p.name, p.stat().st_size) for p in (tmp / "fonts").iterdir()])
    cues = T.clean_cues(plan("poppins", "x")["subs"]["cues"])
    T.write_ass(cues, plan("poppins", "x")["subs"]["style"], tmp / "untertitel.ass", 640, 360, names)
    P("ASS:", [ln for ln in (tmp / "untertitel.ass").read_text(encoding="utf-8-sig").splitlines() if ln.startswith(("Style: Default", "Dialogue"))])
    absf = str(tmp / "fonts").replace("\\", "/")
    variants = {
        "a relativ (wie die App)": "subtitles=filename=untertitel.ass:fontsdir=fonts",
        "b relativ mit ./": "subtitles=filename=untertitel.ass:fontsdir=./fonts",
        "c absolut, Doppelpunkt maskiert": "subtitles=filename=untertitel.ass:fontsdir='" + absf.replace(":", "\\:") + "'",
        "d absolut, doppelt maskiert": "subtitles=filename=untertitel.ass:fontsdir=" + absf.replace(":", "\\\\:").replace(" ", "\\ "),
        "e Filter ass": "ass=filename=untertitel.ass:fontsdir=fonts",
    }
    for label, vf in variants.items():
        (tmp / "filter.txt").write_text(f"[0:v]{vf}[vout]", encoding="utf-8")
        for how, args in (("-/filter_complex", ["-/filter_complex", str(tmp / "filter.txt"), "-map", "[vout]"]), ("-vf", ["-vf", vf])):
            outv = tmp / "v.mp4"
            rc, o, e = run([T.FFMPEG, "-hide_banner", "-v", "verbose", "-y", "-i", video] + args + ["-an", "-frames:v", "75", outv], cwd=tmp)
            raw = crop(outv, "2", "B_" + label.split(" ")[0] + ("_datei" if how.startswith("-/") else "_vf")) if rc == 0 else b""
            d = diff(raws.get(""), raw)
            P(f"\n  [{label} · {how}] rc={rc} · Unterschied zu Standard: {d:.4f} · {'Schrift kommt an' if d > 0.01 else 'NICHT'}")
            P(f"    {vf}")
            for ln in fontlines(e)[:14]:
                P("    |", ln)
    P("\n== C · Schrift in die ASS-Datei eingebettet (ohne fontsdir) ==")
    try:
        ass = (tmp / "untertitel.ass").read_text(encoding="utf-8-sig")
        data = (tmp / "fonts" / "poppins.ttf").read_bytes()
        enc = []
        for i in range(0, len(data), 3):
            b = data[i:i + 3]
            n = int.from_bytes(b + b"\0" * (3 - len(b)), "big")
            enc.append("".join(chr(((n >> s) & 63) + 33) for s in (18, 12, 6, 0))[:len(b) + 1])
        txt = "".join(enc)
        fonts_sec = "[Fonts]\nfontname: poppins_0.ttf\n" + "\n".join(txt[i:i + 80] for i in range(0, len(txt), 80)) + "\n\n"
        (tmp / "eingebettet.ass").write_text(ass.replace("[Events]", fonts_sec + "[Events]"), encoding="utf-8-sig")
        for vf in ("subtitles=filename=eingebettet.ass", "ass=filename=eingebettet.ass"):
            outv = tmp / "v2.mp4"
            rc, o, e = run([T.FFMPEG, "-hide_banner", "-v", "verbose", "-y", "-i", video, "-vf", vf, "-an", "-frames:v", "75", outv], cwd=tmp)
            raw = crop(outv, "2", "C_" + vf.split("=")[0]) if rc == 0 else b""
            d = diff(raws.get(""), raw)
            P(f"\n  [{vf}] rc={rc} · Unterschied zu Standard: {d:.4f} · {'Schrift kommt an' if d > 0.01 else 'NICHT'}")
            for ln in fontlines(e)[:10]:
                P("    |", ln)
    except Exception as ex:  # noqa: BLE001
        P("  FEHLER:", ex, traceback.format_exc()[-800:])
    P("\nfertig")


FILES = {"poppins": "Poppins-Bold.ttf", "anton": "Anton-Regular.ttf", "playfair": "PlayfairDisplay-ExtraBold.ttf"}
try:
    main()
except Exception as ex:  # noqa: BLE001
    P("ABBRUCH:", ex)
    P(traceback.format_exc()[-3000:])
    raise
