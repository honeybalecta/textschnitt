#!/usr/bin/env python3
"""Der Rechenkern von „Stimme aufbereiten“ gibt es dreimal: in Python (textschnitt.py, Windows-Export), in JavaScript (core/web/app.js,
Vorschau und Browser-Export) und in Java (Android-Export). Alle drei müssen dasselbe rechnen. Dieser Lauf erzeugt Prüfsignale
(Sprache mit Nachhall, Rauschen und Brummen bei 16 bis 96 kHz, Mono und Stereo, mit und ohne Pegelverlauf, mit Stille), rechnet
sie mit allen drei Fassungen und vergleicht Abtastwert für Abtastwert. Dazu der Verlauf für „Musik weicht der Sprache“ und die
übrigen Tonklassen der Android-App (tests/java).
Aufruf: python3 tests/rechenkern.py [Arbeitsordner]        Java wird ausgelassen, wenn kein javac da ist."""
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = Path(os.environ.get("HC_REPO") or HERE.parent)
DIR = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(tempfile.mkdtemp(prefix="honeycut-rechenkern-"))
DIR.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("TEXTSCHNITT_DATA", str(DIR / "daten"))
sys.path.insert(0, str(REPO))
import textschnitt as T  # noqa: E402

N = BAD = 0
TOL = 2e-5


def chk(name, ok, extra=""):
    global N, BAD
    N += 1
    BAD += not ok
    print(("ok     " if ok else "FEHLER ") + name + (f" · {extra}" if extra != "" else ""), flush=True)


def signal(sr: int, dur: float, ch: int, seed: int, quiet=None):
    """Sprachähnlich: Silben aus Obertönen mit gleitender Tonhöhe und Pausen, dazu Nachhall, Rauschen und Brummen."""
    rng = np.random.default_rng(seed)
    n = int(dur * sr)
    t = np.arange(n) / sr
    x = np.zeros(n)
    pos = 0.3
    while pos < dur - 0.4:
        m = min(int(rng.uniform(0.1, 0.3) * sr), n - int(pos * sr))
        i = np.arange(m)
        f0 = rng.uniform(100, 220)
        ph = 2 * np.pi * np.cumsum(f0 * np.linspace(1, rng.uniform(0.9, 1.1), m)) / sr
        s = sum(np.sin(h * ph + rng.uniform(0, 6.28)) / h ** 1.1 for h in range(1, max(2, int(min(0.45 * sr, 7000) / f0))))
        x[int(pos * sr): int(pos * sr) + m] += s * np.minimum(1, np.minimum(i / (0.015 * sr), (m - i) / (0.04 * sr))) * rng.uniform(0.6, 1)
        pos += m / sr + rng.choice([0.03, 0.05, 0.3, 0.8])
    x *= 0.06 / np.sqrt((x ** 2).mean() + 1e-12)
    m = int(0.5 * sr)
    ir = rng.standard_normal(m) * np.exp(-6.9 * np.arange(m) / (0.5 * sr))
    ir[: int(0.01 * sr)] = 0
    ir *= 10 ** (-8 / 20) / np.sqrt((ir ** 2).sum())
    size = 1 << int(np.ceil(np.log2(n + m)))
    wet = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[:n]
    y = x + wet + 0.006 * rng.standard_normal(n) + 0.02 * np.sin(2 * np.pi * 50 * t)
    out = y[:, None] if ch == 1 else np.stack([y, 0.7 * y + 0.004 * rng.standard_normal(n)], axis=1)
    if quiet:
        out[int(quiet[0] * sr): int(quiet[1] * sr)] = 0
    return out.astype(np.float32)


# Name, Rate, Kanäle, Dauer, Zufall, Abschnitte [von, bis, Pegelverlauf], Stille von–bis
CASES = (
    ("48k-stereo", 48000, 2, 7.0, 1, [[0.0, 3.0, None], [3.5, 4.2, None], [5.0, 6.5, [[0.0, 1.0], [0.4, 2.0], [1.0, 2.0], [1.5, 0.5]]]], None),
    ("441-mono", 44100, 1, 5.0, 2, [[0.3, 2.6, None], [2.61, 2.65, None], [3.0, 5.0, [[0.0, 1.5], [2.0, 1.5]]]], None),
    ("16k-mono", 16000, 1, 4.0, 3, [[0.0, 4.0, None]], None),
    ("96k-stereo", 96000, 2, 3.0, 4, [[0.5, 2.9, None]], None),
    ("48k-laut", 48000, 1, 4.0, 5, [[0.0, 4.0, [[0.0, 6.0], [4.0, 6.0]]]], None),
    ("48k-stille", 48000, 2, 7.0, 6, [[0.0, 3.5, None], [3.6, 7.0, None]], (2.0, 4.5)),
    ("48k-kurz", 48000, 2, 3.0, 7, [[0.2, 1.1, None], [1.5, 3.0, [[0.0, 0.7], [1.5, 1.3]]]], None),
)
GAIN = [{"pts": [[0, 1], [1, 1], [1.25, 0.2], [3, 0.2], [3.8, 1]], "ts": [round(0.05 * k - 0.5, 3) for k in range(110)]},
        {"pts": [[2, 0.5]], "ts": [0, 2, 5]}, {"pts": [[1, 1], [1, 0.1], [2, 0.1]], "ts": [0.5, 1, 1.0001, 1.5, 3]}, {"pts": [], "ts": [0, 1]}]


def main():
    cases, txt = [], []
    for name, sr, ch, dur, seed, segs, quiet in CASES:
        x = signal(sr, dur, ch, seed, quiet)
        x.tofile(DIR / f"{name}.in.f32")
        cases.append({"name": name, "sr": sr, "ch": ch, "n": len(x), "prime": T.VOICE["prime"], "segs": segs})
        txt.append(f"{name} {sr} {ch} {len(x)} {T.VOICE['prime']} {len(segs)}")
        for a, b, lvl in segs:
            txt.append(f"{a} {b} {len(lvl or [])}" + "".join(f" {p[0]} {p[1]}" for p in lvl or []))
        # Python-Fassung: wie voice_prepare – am Anfang des ersten Abschnitts das Rauschen lernen, dann Abschnitt für Abschnitt
        x64 = x.astype(np.float64)
        dsp, outs = T.VoiceDsp(sr, ch), []
        for k, (a, b, lvl) in enumerate(segs):
            part = x64[int(round(a * sr)): int(round(b * sr))]
            if k == 0:
                dsp.prime(part[: int(T.VOICE["prime"] * sr)])
            outs.append(dsp.process(part, lvl or []))
        np.concatenate(outs).astype(np.float32).tofile(DIR / f"{name}.py.f32")
    (DIR / "cases.json").write_text(json.dumps(cases), encoding="utf-8")
    (DIR / "cases.txt").write_text("\n".join(txt) + "\n", encoding="utf-8")
    (DIR / "gain.in.json").write_text(json.dumps(GAIN), encoding="utf-8")
    for f in DIR.glob("*.js.f32"):
        f.unlink()
    for f in list(DIR.glob("*.web.f32")) + list(DIR.glob("*.java.f32")):
        f.unlink()

    r = subprocess.run(["node", str(HERE / "rechenkern.mjs"), str(DIR), str(REPO)], capture_output=True, text=True)
    chk("die JavaScript-Fassung läuft außerhalb des Browsers durch", r.returncode == 0, (r.stderr or r.stdout).strip()[-300:] if r.returncode else "")
    for c in cases:
        ref = np.fromfile(DIR / f"{c['name']}.py.f32", dtype=np.float32)
        level = 20 * np.log10(np.sqrt((ref.astype(float) ** 2).mean()) + 1e-12)
        for kind, label in (("js", "JavaScript"), ("web", "Browser-Export")):
            f = DIR / f"{c['name']}.{kind}.f32"
            if not f.exists():
                if kind == "js":
                    chk(f"{c['name']}: Ergebnis der JavaScript-Fassung liegt vor", False)
                continue
            o = np.fromfile(f, dtype=np.float32)
            mx = float(np.abs(o - ref).max()) if len(o) == len(ref) else -1.0
            chk(f"{c['name']}: {label} rechnet wie Python", 0 <= mx < TOL, f"{len(ref)} Werte, größte Abweichung {mx:.1e}, Pegel {level:.1f} dB")
    chk("über den Weg des Browser-Exports gerechnet: alle Fälle mit Stereo bei 48 kHz", len(list(DIR.glob("*.web.f32"))) == sum(1 for c in cases if c["sr"] == 48000 and c["ch"] == 2))
    # Verlauf
    try:
        got = json.loads((DIR / "gain.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        got = None
    ok = got is not None and len(got) == len(GAIN)
    worst = 0.0
    for g, q in zip(got or [], GAIN):
        pts = T.clean_curve(q["pts"])
        if not pts:
            ok = ok and g is None
            continue
        want = [T.curve_at(pts, t) for t in q["ts"]] + [T.curve_at(pts, t) for t in q["ts"][:3]]
        ok = ok and g is not None and len(g) == len(want)
        if ok:
            worst = max(worst, max(abs(a - b) for a, b in zip(g, want)))
    chk("Verlauf für „Musik weicht der Sprache“: Browser-Export rechnet wie Python, auch nach einem Sprung zurück", ok and worst < 1e-9, f"größte Abweichung {worst:.1e}")

    # Java: übersetzt die Tonklassen der Android-App und rechnet dieselben Fälle (vergleicht dort mit .js.f32 und .py.f32)
    global N, BAD
    j = subprocess.run(["bash", str(HERE / "java" / "pruefe.sh"), str(DIR)], capture_output=True, text=True)
    lines = [ln for ln in j.stdout.splitlines() if ln.startswith(("ok", "FEHLER"))]
    m = re.search(r"ERGEBNIS Android-Tonklassen: (\d+) geprüft, (\d+) Fehler", j.stdout)
    if m:
        for ln in lines:
            if ln.startswith("FEHLER") or "rechnet wie" in ln:
                print(ln)
        N += int(m.group(1))
        BAD += int(m.group(2))
        print(f"       Android-Tonklassen (Java): {m.group(1)} geprüft, {m.group(2)} Fehler")
    elif "ausgelassen" in j.stdout:
        print("       Android-Tonklassen (Java): ausgelassen – kein javac auf diesem Rechner")
    else:
        chk("die Java-Fassung lässt sich übersetzen und rechnen", False, (j.stdout + j.stderr).strip()[-400:])
    print(f"ERGEBNIS Rechenkern Ton (Python, JavaScript, Java): {N} geprüft, {BAD} Fehler")
    sys.exit(1 if BAD else 0)


main()
