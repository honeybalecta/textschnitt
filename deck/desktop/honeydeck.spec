# PyInstaller-Bauplan für HoneyDeck (Windows, Ordner-Build)
# Vorher: python deck/build.py deck/dist-web    Aufruf: pyinstaller deck/desktop/honeydeck.spec
from pathlib import Path
from PyInstaller.utils.hooks import collect_all

HERE = Path(SPECPATH)
datas = [(str(HERE.parent / "dist-web"), "web"), (str(HERE / "honeydeck.ico"), ".")]
binaries, hiddenimports = [], []
for pkg in ("webview", "clr_loader", "pythonnet"):
    d, b, h = collect_all(pkg)
    datas += d; binaries += b; hiddenimports += h

a = Analysis([str(HERE / "honeydeck_app.py")], pathex=[str(HERE)], binaries=binaries, datas=datas,
             hiddenimports=hiddenimports, excludes=["matplotlib", "PyQt5", "PySide6", "IPython", "pytest", "tkinter", "numpy"], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name="HoneyDeck", console=False, icon=str(HERE / "honeydeck.ico"))
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="HoneyDeck")
