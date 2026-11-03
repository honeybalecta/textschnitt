#!/usr/bin/env python3
"""Baut die Browser-Version von HoneyCut nach site/ (für GitHub Pages).

Voraussetzung: `npm install` in web/ (mediabunny, transformers.js, esbuild).
Aufruf: python3 web/build.py [Zielordner]
"""
import json, re, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB, CORE = ROOT / "web", ROOT / "core" / "web"
OUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "site"
VERSION = (WEB / "version.txt").read_text().strip()

shutil.rmtree(OUT, ignore_errors=True)
(OUT / "vendor" / "ort").mkdir(parents=True)

for f in ("app.js", "studio.js", "slides.js", "app.css", "icons.js"):
    shutil.copy(CORE / f, OUT / f)
shutil.copytree(CORE / "fonts", OUT / "fonts")
for f in ("engine.js", "asr-worker.js", "web.css", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"):
    shutil.copy(WEB / f, OUT / f)
(OUT / "bridge-browser.js").write_text((WEB / "bridge-browser.js").read_text().replace("__VERSION__", VERSION))

# index.html: gleicher Aufbau wie in den Apps, nur mit der Browser-Brücke
html = (CORE / "index.html").read_text()
html, n = re.subn(r'<script src="bridge-http\.js"></script>\s*<script src="app\.js"></script>\s*<script src="studio\.js"></script>\s*<script src="slides\.js"></script>',
                  '<script src="bridge-browser.js"></script>', html)
assert n == 1, "Skript-Einbindung in index.html nicht gefunden"
head = ('<meta name="description" content="Gesprochene Videos über das Transkript schneiden – direkt im Browser, ohne Upload.">\n'
        '<meta name="theme-color" content="#131312">\n<link rel="manifest" href="manifest.webmanifest">\n'
        '<link rel="icon" href="icon.svg" type="image/svg+xml">\n<link rel="apple-touch-icon" href="icon-192.png">\n'
        '<link rel="stylesheet" href="web.css">\n</head>')
html = html.replace("</head>", head, 1)
html = html.replace("<body>", '<body>\n<div class="web-boot">HoneyCut wird geladen …</div>', 1)
(OUT / "index.html").write_text(html)

# Bibliotheken bündeln
def esbuild(entry, out):
    subprocess.run(["npx", "--no-install", "esbuild", str(WEB / "src" / entry), "--bundle", "--format=esm", "--minify",
                    "--target=es2022", "--legal-comments=eof", f"--outfile={OUT / 'vendor' / out}"], cwd=WEB, check=True)
esbuild("media-entry.js", "media.js")
esbuild("asr-entry.js", "asr.js")

# ONNX-Runtime (WebAssembly) selbst ausliefern
ort = sorted({p for p in (WEB / "node_modules").rglob("ort-wasm-simd-threaded*") if p.parent.name == "dist" and p.suffix in (".wasm", ".mjs")})
names = []
for p in ort:
    if p.name not in names:
        shutil.copy(p, OUT / "vendor" / "ort" / p.name)
        names.append(p.name)
(OUT / "vendor" / "ort" / "files.json").write_text(json.dumps(names))
print("ONNX-Runtime:", ", ".join(names) or "– (wird vom CDN geladen)")

fonts = sorted("fonts/" + p.name for p in (CORE / "fonts").iterdir() if p.suffix == ".ttf")
shell = ["./", "index.html", "app.js", "studio.js", "slides.js", "app.css", "icons.js", "web.css", "bridge-browser.js", "engine.js", "asr-worker.js",
         "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png", "vendor/media.js", "vendor/asr.js"] + fonts
sw = (WEB / "sw.js").read_text().replace("__VERSION__", VERSION + "-" + subprocess.run(
    ["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()).replace("__SHELL__", json.dumps(shell))
(OUT / "sw.js").write_text(sw)
(OUT / ".nojekyll").write_text("")
print(f"HoneyCut Web {VERSION} → {OUT}")
