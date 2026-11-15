#!/usr/bin/env python3
"""Erzeugt die Testmedien für die Prüfläufe (nur Python-Standardbibliothek und ffmpeg):
   kurz.mp4 (3 min) und lang.mp4 (6 min) mit sprachähnlichem Ton und passender Wortliste (*.words.json),
   drei kurze Einspieler (broll1–3.mp4), acht Folienbilder und ein Logo.
Aufruf: python3 tests/medien.py <Zielordner>   – vorhandene Dateien bleiben stehen."""
import array
import json
import math
import random
import subprocess
import sys
import wave
from pathlib import Path

SR = 16000
VOCAB = ("ich wollte heute über die Mieten sprechen und warum das Thema so wichtig ist weil viele Menschen "
         "in dieser Stadt nicht mehr wissen wie sie ihre Wohnung bezahlen sollen ähm das ist ein Problem "
         "also schauen wir uns die Zahlen an die Regierung sagt etwas anderes aber die Fakten zeigen deutlich "
         "dass der Markt hier versagt hat und zwar seit Jahren Solidarität Organisierung Gewerkschaft Streik").split()


def sprache(wav: Path, words_json: Path, minutes: float, seed: int) -> None:
    """Wörter als Klangstöße mit Pausen – genug, damit Lautstärkeverlauf, Pausen und Schnittkanten wie bei Sprache arbeiten."""
    rnd = random.Random(seed)
    total = int(minutes * 60 * SR)
    noise = [rnd.gauss(0, 0.0015) for _ in range(4096)]            # leises Grundrauschen
    audio = [noise[i & 4095] for i in range(total)]
    words, t, sent = [], 0.6, 0
    two_pi = 2 * math.pi
    while t < minutes * 60 - 3:
        w = rnd.choice(VOCAB)
        d = 0.12 + 0.045 * len(w) + rnd.uniform(-0.03, 0.05)
        a, n = int(t * SR), int(d * SR)
        f0 = rnd.uniform(110, 220)
        k1, k2, k3 = two_pi * f0 / SR, two_pi * f0 * 2.01 / SR, two_pi * f0 * 3.2 / SR
        up, down = 0.02 * SR, 0.03 * SR
        for i in range(n):
            env = min(1.0, i / up, (n - i) / down)
            audio[a + i] += (0.25 * math.sin(k1 * i) + 0.12 * math.sin(k2 * i) + 0.06 * math.sin(k3 * i)) * env
        sent += 1
        end = sent >= rnd.randint(6, 16)
        txt = w + ("." if end else ("," if rnd.random() < 0.08 else ""))
        if sent == 1:
            txt = txt.capitalize()
        words.append({"text": " " + txt, "start": round(t, 3), "end": round(t + d, 3), "prob": round(rnd.uniform(0.55, 0.99), 3)})
        t += d
        if end:
            t += rnd.choice([0.5, 0.7, 0.9, 1.3, 1.8])
            sent = 0
        elif rnd.random() < 0.06:
            t += rnd.uniform(0.5, 1.0)      # Denkpause
        else:
            t += rnd.uniform(0.03, 0.09)
    pcm = array.array("h", (max(-32767, min(32767, int(x * 32767))) for x in audio))
    if sys.byteorder == "big":
        pcm.byteswap()
    with wave.open(str(wav), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm.tobytes())
    words_json.write_text(json.dumps(words, ensure_ascii=False), encoding="utf-8")


def ff(*args: str) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    enc = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-g", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart"]
    for name, minutes, seed in (("kurz", 3, 2), ("lang", 6, 1)):
        mp4 = out / f"{name}.mp4"
        if mp4.exists() and (out / f"{name}.words.json").exists():
            continue
        wav = out / f"{name}.wav"
        sprache(wav, out / f"{name}.words.json", minutes, seed)
        ff("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-i", str(wav), "-t", str(minutes * 60), *enc, str(mp4))
        wav.unlink()
        print(mp4.name, f"{mp4.stat().st_size / 1e6:.1f} MB")
    for k, (src, freq) in enumerate((("testsrc=size=640x360:rate=30", 440), ("smptebars=size=640x360:rate=30", 554), ("rgbtestsrc=size=640x360:rate=30", 659)), 1):
        mp4 = out / f"broll{k}.mp4"
        if not mp4.exists():
            ff("-f", "lavfi", "-i", src, "-f", "lavfi", "-i", f"sine=frequency={freq}:sample_rate=44100", "-t", "15", "-af", "volume=0.2", *enc, str(mp4))
    for k, col in enumerate(("1F2A24", "2A1F24", "24271F", "1F242A", "2A261F", "211F2A", "1F2A29", "2A1F1F"), 1):
        png = out / f"folie{k}.png"
        if not png.exists():
            ff("-f", "lavfi", "-i", f"color=c=0x{col}:size=1280x720", "-frames:v", "1", str(png))
    if not (out / "logo.png").exists():
        ff("-f", "lavfi", "-i", "color=c=0xE5402A@0.85:size=200x200,format=rgba", "-frames:v", "1", str(out / "logo.png"))
    print("Testmedien bereit:", out)


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent / ".work" / "media"))
