#!/usr/bin/env python3
"""Lädt die Whisper-Modelle tiny und base beim Bauen herunter, damit die Seite sie selbst ausliefert
(Nutzer:innen müssen dann nichts von Hugging Face laden). small ist zu groß für GitHub Pages und
kommt weiterhin von Hugging Face. Aufruf: python3 web/fetch-models.py <site>"""
import json, sys, urllib.request
from pathlib import Path

SITE = Path(sys.argv[1])
REPOS = ["onnx-community/whisper-tiny_timestamped", "onnx-community/whisper-base_timestamped"]
# Grafikkarte: Encoder fp32 + Decoder fp16 · Prozessor: beide 8-bit (q8 → _quantized)
ONNX = ["encoder_model.onnx", "decoder_model_merged_fp16.onnx", "encoder_model_quantized.onnx", "decoder_model_merged_quantized.onnx"]
total, done = 0, []
for repo in REPOS:
    tree = json.load(urllib.request.urlopen(f"https://huggingface.co/api/models/{repo}/tree/main?recursive=1"))
    want = [f for f in tree if f["type"] == "file" and (
        ("/" not in f["path"] and not f["path"].endswith((".md", ".gitattributes")))
        or (f["path"].startswith("onnx/") and any(f["path"] == "onnx/" + o or f["path"].startswith("onnx/" + o + "_data") for o in ONNX)))]
    for f in want:
        dst = SITE / "models" / repo / f["path"]
        dst.parent.mkdir(parents=True, exist_ok=True)
        urllib.request.urlretrieve(f"https://huggingface.co/{repo}/resolve/main/{f['path']}", dst)
        size = dst.stat().st_size; total += size
        print(f"{repo}/{f['path']}: {size / 1e6:.1f} MB")
        if size > 100e6:
            print(f"::warning::{f['path']} ist größer als 100 MB")
    done.append(repo)
(SITE / "models" / "bundled.json").write_text(json.dumps(done))
print(f"Modelle gesamt: {total / 1e6:.0f} MB")
