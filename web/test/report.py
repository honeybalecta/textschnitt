#!/usr/bin/env python3
"""Prüft die Exporte des Browser-Tests mit ffprobe/ffmpeg und schreibt report.md. Exit 1 bei Fehlern."""
import json, subprocess, sys
from pathlib import Path

OUT = Path(sys.argv[1])
res = json.loads((OUT / "results.json").read_text()) if (OUT / "results.json").exists() else {"steps": [], "errors": ["keine results.json"]}
exp = json.loads((OUT / "expected.json").read_text()) if (OUT / "expected.json").exists() else {}
checks = []

def probe(f):
    r = subprocess.run(["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(f)], capture_output=True, text=True)
    return json.loads(r.stdout or "{}")

def decodes(f):
    r = subprocess.run(["ffmpeg", "-v", "error", "-i", str(f), "-f", "null", "-"], capture_output=True, text=True)
    return r.stderr.strip()[:300]

total = exp.get("total")
for name in ("out.mp4", "out-ton.mp4", "out.mp3", "out.wav"):
    f = OUT / name
    if not f.exists():
        checks.append((name, False, "fehlt")); continue
    d = probe(f); st = d.get("streams", []); dur = float(d.get("format", {}).get("duration") or 0)
    v = [s for s in st if s["codec_type"] == "video"]; a = [s for s in st if s["codec_type"] == "audio"]
    err = decodes(f)
    ok = bool(a) and not err and (total is None or abs(dur - total) < 0.25) and (bool(v) if name.endswith("mp4") else True)
    info = f"Dauer {dur:.2f} s (erwartet {total:.2f})" if total else f"Dauer {dur:.2f}"
    info += " · " + ", ".join(f"{s['codec_type']}:{s.get('codec_name')}" + (f" {s.get('width')}x{s.get('height')}" if s['codec_type'] == 'video' else f" {s.get('sample_rate')}Hz/{s.get('channels')}ch") for s in st)
    if err: info += f" · Dekodierfehler: {err}"
    checks.append((name, ok, info))

# Titel gelb oben im Bild?
mp4 = OUT / "out.mp4"
if mp4.exists():
    try:
        from PIL import Image
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", "1.5", "-i", str(mp4), "-frames:v", "1", str(OUT / "frame-titel.png")], check=True)
        im = Image.open(OUT / "frame-titel.png").convert("RGB"); w, h = im.size
        reg = im.crop((int(w * .3), int(h * .1), int(w * .7), int(h * .3))).getdata()
        yellow = sum(1 for r, g, b in reg if r > 200 and g > 180 and b < 90)
        checks.append(("Titel im Bild", yellow > 200, f"{yellow} gelbe Pixel im oberen Bereich"))
    except Exception as e:
        checks.append(("Titel im Bild", False, str(e)[:200]))

# „Stimme aufbereiten“ an der Sprachausgabe des Testvideos: Die Sprache soll ihren Pegel in etwa behalten (reine Auskunft)
notes = []
try:
    import array, math
    def rms_db(f):
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", str(f), "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "-"], capture_output=True).stdout
        a = array.array("h"); a.frombytes(raw[: len(raw) // 2 * 2])
        win = [math.sqrt(sum(v * v for v in a[i:i + 1600]) / 1600) / 32768 for i in range(0, len(a) - 1600, 1600)]
        if not win: return None
        win.sort(); loud = win[len(win) * 6 // 10:]; quiet = win[: max(1, len(win) // 10)]
        db = lambda xs: 20 * math.log10(max(1e-6, math.sqrt(sum(v * v for v in xs) / len(xs))))
        return db(loud), db(quiet)
    if (OUT / "out.mp4").exists() and (OUT / "out-ton.mp4").exists():
        a, b = rms_db(OUT / "out.mp4"), rms_db(OUT / "out-ton.mp4")
        if a and b:
            d = b[0] - a[0]
            notes.append(f"- {'ℹ️' if abs(d) < 6 else '⚠️'} Stimme aufbereiten an der Sprachausgabe: Sprache {a[0]:.1f} → {b[0]:.1f} dB ({d:+.1f}), leiseste Stellen {a[1]:.1f} → {b[1]:.1f} dB")
except Exception as e:
    notes.append(f"- ℹ️ Pegelvergleich nicht möglich: {str(e)[:150]}")

lines = ["### Web-Version: Browser-Test", f"Browser: {res.get('browser')} {res.get('browserVersion', '')}", ""]
ok_all = True
for s in res.get("steps", []):
    ok_all &= bool(s["ok"])
    extra = {k: v for k, v in s.items() if k not in ("name", "ok")}
    lines.append(f"- {'✅' if s['ok'] else '❌'} {s['name']} `{json.dumps(extra, ensure_ascii=False)[:900]}`")
for n, ok, info in checks:
    ok_all &= ok
    lines.append(f"- {'✅' if ok else '❌'} Datei {n}: {info}")
lines += notes
if res.get("errors"):
    ok_all = False
    lines += ["", "**Fehler:**"] + [f"```\n{e[:1500]}\n```" for e in res["errors"][:5]]
errs = [c for c in res.get("console", []) if c.startswith("[error]")]
if errs:
    lines += ["", "<details><summary>Konsole (Fehler)</summary>", "", "```"] + [e[:300] for e in errs[:25]] + ["```", "</details>"]
lines.insert(1, "**Ergebnis: alles in Ordnung** ✅" if ok_all else "**Ergebnis: Probleme gefunden** ❌")
(OUT / "report.md").write_text("\n".join(lines))
print("\n".join(lines))
sys.exit(0 if ok_all else 1)
