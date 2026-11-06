"""
HoneyDeck als Windows-Programm: eigenes Fenster (Edge WebView2) mit der gemeinsamen Oberfläche aus web/.

Gespeichert wird in %APPDATA%\\HoneyDeck\\store (eine JSON-Datei je Präsentation) – unabhängig vom Fenster.
HoneyCut findet HoneyDeck über den Registry-Eintrag HKCU\\Software\\HoneyBalecta\\HoneyDeck\\WebDir (setzt der Installer)
und bettet dieselbe Oberfläche im Reiter „Folien“ ein.
"""
from __future__ import annotations

import base64
import json
import os
import re
import socket
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

FROZEN = bool(getattr(sys, "frozen", False))
APP_DIR = Path(sys.executable).resolve().parent if FROZEN else Path(__file__).resolve().parent
RES_DIR = Path(getattr(sys, "_MEIPASS", APP_DIR))
WEB_DIR = next((p for p in (APP_DIR / "web", RES_DIR / "web", APP_DIR.parent / "dist-web") if (p / "index.html").is_file()), APP_DIR / "web")
DATA = Path(os.environ.get("APPDATA") or Path.home()) / "HoneyDeck"
STORE = DATA / "store"
STORE.mkdir(parents=True, exist_ok=True)
TITLE = "HoneyDeck"


def fail(msg: str):
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, msg, TITLE, 0x10)
    except Exception:
        print(msg, file=sys.stderr)
    sys.exit(1)


def key_file(key: str) -> Path:
    return STORE / (re.sub(r"[^A-Za-z0-9_.-]", "_", key)[:120] + ".json")


class Api:
    """Aufrufbar aus der Oberfläche über window.pywebview.api."""
    window = None

    def store_get(self, key):
        f = key_file(key)
        return f.read_text(encoding="utf-8") if f.is_file() else None

    def store_set(self, key, value):
        f = key_file(key)
        tmp = f.with_suffix(".tmp")
        tmp.write_text(value, encoding="utf-8")
        tmp.replace(f)
        return True

    def store_del(self, key):
        f = key_file(key)
        if f.is_file():
            f.unlink()
        return True

    def store_keys(self, prefix):
        out = []
        for f in STORE.glob("*.json"):
            k = f.stem
            if k.startswith(re.sub(r"[^A-Za-z0-9_.-]", "_", prefix)):
                out.append(k.replace("deck_", "deck:", 1) if k.startswith("deck_") else k)
        return out

    def open_file(self, b64path):
        """Beim Start übergebene Datei (Doppelklick auf .honeydeck, „Öffnen mit“) an die Oberfläche geben."""
        p = Path(base64.urlsafe_b64decode(b64path.encode()).decode())
        return {"name": p.name, "data": base64.b64encode(p.read_bytes()).decode()}

    def save_file(self, name, b64):
        import webview
        ext = Path(name).suffix.lstrip(".") or "*"
        try:
            res = self.window.create_file_dialog(webview.SAVE_DIALOG, save_filename=name,
                                                 file_types=(f"{ext.upper()}-Datei (*.{ext})", "Alle Dateien (*.*)"))
        except Exception:
            res = self.window.create_file_dialog(webview.SAVE_DIALOG, save_filename=name)
        if not res:
            return None
        dest = res[0] if isinstance(res, (list, tuple)) else res
        Path(dest).write_bytes(base64.b64decode(b64))
        return dest


class Quiet(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".webmanifest": "application/manifest+json",
                      ".ttf": "font/ttf", ".svg": "image/svg+xml"}

    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(WEB_DIR), **k)

    def log_message(self, *a):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def free_port(start=8790):
    for p in range(start, start + 40):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
    return 0


def main():
    if not (WEB_DIR / "index.html").is_file():
        fail(f"Oberfläche nicht gefunden: {WEB_DIR}")
    try:
        import webview
    except Exception:
        fail("pywebview fehlt – bitte HoneyDeck neu installieren.")
    port = free_port()
    srv = ThreadingHTTPServer(("127.0.0.1", port), Quiet)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    try:
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("HoneyDeck.App")
    except Exception:
        pass
    api = Api()
    url = f"http://127.0.0.1:{port}/index.html?desktop=1"
    if len(sys.argv) > 1 and Path(sys.argv[1]).is_file():   # „Öffnen mit“ / Doppelklick auf .honeydeck
        url += "#open=" + base64.urlsafe_b64encode(str(Path(sys.argv[1]).resolve()).encode()).decode()
    api.window = webview.create_window(TITLE, url, js_api=api, width=1440, height=900, min_size=(900, 600),
                                       background_color="#131312", text_select=False)
    webview.start(private_mode=False, storage_path=str(DATA / "webview"))


if __name__ == "__main__":
    main()
