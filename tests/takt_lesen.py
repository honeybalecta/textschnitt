"""Liest aus einem Video, das aus takt.mp4 geschnitten wurde, je Bild die Balken ab (siehe medien.py, takt()).
   python3 takt_lesen.py <Datei> [von bis]      Zeiten in Sekunden; ohne Angabe das ganze Video
Ausgabe (JSON): {"fps": …, "frames": [[t, n, [v0 … v9]], …]}
   t: Zeit des Bilds · v: Helligkeit je Balken von 0 (dunkel) bis 1 (hell) · n: Nummer des Quellbilds, wenn alle Balken
   eindeutig sind, sonst null (z. B. mitten in einer Blende: dort stehen die Balken anteilig zwischen zwei Bildern)."""
import json
import subprocess
import sys

BITS, COLS = 10, 40   # je Balken vier Spalten; ausgewertet werden die beiden mittleren


def lesen(datei: str, von: float | None = None, bis: float | None = None) -> dict:
    pr = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", datei],
                        capture_output=True, text=True, check=True).stdout.strip().split("/")
    fps = float(pr[0]) / float(pr[1] if len(pr) > 1 and pr[1] else 1)
    cut = ([] if von is None else ["-ss", f"{max(0.0, von):.4f}"]) + ([] if bis is None else ["-to", f"{bis:.4f}"])
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", datei, *cut, "-an", "-vf", f"scale={COLS}:4:flags=area,format=gray", "-f", "rawvideo", "-"],
                         capture_output=True, check=True).stdout
    size, t0 = COLS * 4, max(0.0, von or 0.0)
    frames = []
    for k in range(len(raw) // size):
        px = raw[k * size:(k + 1) * size]
        v = []
        for b in range(BITS):
            cells = [px[r * COLS + b * 4 + c] for r in range(4) for c in (1, 2)]
            v.append(sum(cells) / len(cells))
        frames.append([round(t0 + k / fps, 4), v])
    # Schwarz und Weiß am Video selbst festmachen (Farbbereich und Kodierung verschieben die Werte leicht)
    alle = sorted(x for _, v in frames for x in v)
    lo, hi = (alle[len(alle) // 50], alle[-1 - len(alle) // 50]) if alle else (0.0, 255.0)
    out = []
    for t, v in frames:
        w = [round(min(1.0, max(0.0, (x - lo) / max(1.0, hi - lo))), 3) for x in v]
        klar = all(x < 0.2 or x > 0.8 for x in w)
        out.append([t, sum(1 << b for b, x in enumerate(w) if x > 0.5) if klar else None, w])
    return {"fps": fps, "frames": out}


if __name__ == "__main__":
    a = sys.argv[1:]
    print(json.dumps(lesen(a[0], float(a[1]) if len(a) > 2 else None, float(a[2]) if len(a) > 2 else None)))
