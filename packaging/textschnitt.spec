# PyInstaller-Bauplan für HoneyCut (Windows, Ordner-Build)
# Aufruf aus dem Projektordner:  pyinstaller packaging/textschnitt.spec
from pathlib import Path
from PyInstaller.utils.hooks import collect_all

ROOT = Path(SPECPATH).parent
datas = [(str(ROOT / "core" / "web"), "web"), (str(ROOT / "textschnitt.ico"), ".")]
for sub in ("ffmpeg", "models"):
    src = ROOT / "build" / sub
    if src.exists():
        datas.append((str(src), sub))
binaries, hiddenimports = [], ["textschnitt", "textschnitt_app"]
for pkg in ("faster_whisper", "ctranslate2", "webview", "clr_loader", "pythonnet", "av", "tokenizers", "onnxruntime", "numpy", "sentencepiece"):
    d, b, h = collect_all(pkg)
    datas += d; binaries += b; hiddenimports += h

a = Analysis([str(ROOT / "packaging" / "app_entry.py")], pathex=[str(ROOT)], binaries=binaries, datas=datas,
             hiddenimports=hiddenimports, excludes=["matplotlib", "PyQt5", "PySide6", "IPython", "pytest"],
             noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="HoneyCut", console=False,
          icon=str(ROOT / "textschnitt.ico"), version=str(ROOT / "packaging" / "version.txt"))
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="HoneyCut")
