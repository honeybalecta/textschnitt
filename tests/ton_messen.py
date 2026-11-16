#!/usr/bin/env python3
"""Misst den Pegel einer Ton- oder Videodatei in Frequenzbändern über die Zeit (für die Prüfungen zum Ton).
Aufruf: python3 ton_messen.py <Datei> <Schritt in s> <von-bis in Hz> [<von-bis> …]
Ausgabe: JSON {"sr", "dur", "step", "bands": {"von-bis": [dB je Schritt, …]}} – dB bezogen auf Vollaussteuerung (Effektivwert),
beide Kanäle gemittelt."""
import json
import subprocess
import sys

import numpy as np


def lesen(datei: str, sr: int = 48000):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", datei, "-vn", "-ac", "2", "-ar", str(sr), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype="<f4").reshape(-1, 2).astype(np.float64)


def baender(x, sr: int, step: float, ranges):
    n = int(round(step * sr))
    m = len(x) // n
    fr = x[: m * n].reshape(m, n, 2)
    spec = np.abs(np.fft.rfft(fr * np.hanning(n)[None, :, None], axis=1)) ** 2
    f = np.fft.rfftfreq(n, 1 / sr)
    norm = (np.hanning(n) ** 2).sum() * n / 2    # Leistung eines Sinus mit Scheitelwert 1 ergibt 0,5
    out = {}
    for lo, hi in ranges:
        p = spec[:, (f >= lo) & (f < hi), :].sum(axis=1).mean(axis=1) / norm
        out[f"{lo:g}-{hi:g}"] = [round(float(v), 2) for v in 10 * np.log10(p + 1e-12)]
    return out


if __name__ == "__main__":
    datei, step = sys.argv[1], float(sys.argv[2])
    ranges = [tuple(float(v) for v in a.split("-")) for a in sys.argv[3:]]
    x = lesen(datei)
    print(json.dumps({"sr": 48000, "dur": round(len(x) / 48000, 3), "step": step, "bands": baender(x, 48000, step, ranges)}))
