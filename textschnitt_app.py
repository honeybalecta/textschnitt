"""
Textschnitt als Desktop-Anwendung: eigenes Programmfenster (Edge WebView2), kein Terminal, kein Browser.

Start: pythonw textschnitt_app.pyw [videodatei]
Läuft Textschnitt schon, wird die Datei im offenen Fenster geöffnet und das Fenster nach vorn geholt.
"""
from __future__ import annotations

import json
import os
import socket
import sys
import threading
import traceback
import urllib.request
from pathlib import Path

FROZEN = bool(getattr(sys, "frozen", False))
APP_DIR = Path(sys.executable).resolve().parent if FROZEN else Path(__file__).resolve().parent
RES_DIR = Path(getattr(sys, "_MEIPASS", APP_DIR))
if not FROZEN:
    sys.path.insert(0, str(APP_DIR))
os.chdir(APP_DIR)

# winget-ffmpeg liegt hier – auch wenn die Verknüpfung den PATH noch nicht kennt
links = Path(os.environ.get("LOCALAPPDATA", "")) / "Microsoft" / "WinGet" / "Links"
if links.is_dir():
    os.environ["PATH"] = str(links) + os.pathsep + os.environ.get("PATH", "")

FIRST_PORT = 8765
TITLE = "Textschnitt"
VIDEO_TYPES = ("Video und Audio (*.mp4;*.mov;*.mkv;*.m4v;*.webm;*.avi;*.mts;*.mp3;*.wav;*.m4a;*.flac;*.aac)",
               "Alle Dateien (*.*)")


def fail(msg: str):
    """Fehlermeldung als normales Windows-Fenster (pythonw hat keine Konsole)."""
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, msg, TITLE, 0x10)
    except Exception:
        print(msg, file=sys.stderr)
    sys.exit(1)


def running_instance(port: int) -> bool:
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/ping", timeout=0.8) as r:
            return json.load(r).get("app") == "textschnitt"
    except Exception:
        return False


def port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(("127.0.0.1", port))
            return True
        except OSError:
            return False


def hand_over(port: int, path: str | None):
    body = json.dumps({"path": path} if path else {}).encode("utf-8")
    req = urllib.request.Request(f"http://127.0.0.1:{port}/api/focus", data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=5).read()
    except Exception:
        pass


def selftest(out_path: str) -> int:
    """Prüft im Build, ob alles Nötige im Paket steckt (läuft ohne Fenster)."""
    import subprocess
    import tempfile
    rep: dict = {}
    try:
        import textschnitt as T
        import faster_whisper
        import ctranslate2
        import webview  # noqa: F401
        rep["faster_whisper"] = faster_whisper.__version__
        rep["ctranslate2"] = ctranslate2.__version__
        rep["ffmpeg"] = subprocess.run([T.FFMPEG, "-version"], capture_output=True, text=True,
                                       **T.NOWIN).stdout.splitlines()[0]
        rep["models"] = T.bundled_models()
        rep["index_html"] = (T.RES_DIR / "index.html").exists()
        wav = Path(tempfile.gettempdir()) / "textschnitt_selftest.wav"
        subprocess.run([T.FFMPEG, "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=3",
                        "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)], check=True, **T.NOWIN)
        audio = T.read_wav16k(wav)
        m = T.bundled_models()[0] if T.bundled_models() else "tiny"
        model = faster_whisper.WhisperModel(T.model_ref(m), device="cpu", compute_type="int8")
        segs, info = model.transcribe(audio, language="de", word_timestamps=True)
        rep["segments"] = len(list(segs))
        rep["ok"] = True
    except Exception:
        rep["ok"] = False
        rep["error"] = traceback.format_exc()
    Path(out_path).write_text(json.dumps(rep, indent=2), encoding="utf-8")
    return 0 if rep["ok"] else 1


def main():
    if len(sys.argv) > 2 and sys.argv[1] == "--selftest":
        sys.exit(selftest(sys.argv[2]))
    arg = sys.argv[1] if len(sys.argv) > 1 else None

    # Schon offen? Dann dorthin übergeben und beenden.
    if running_instance(FIRST_PORT):
        hand_over(FIRST_PORT, arg)
        return

    try:
        import webview  # pywebview
    except ImportError:
        fail("Für das Programmfenster fehlt „pywebview“.\n\nBitte install.bat im Textschnitt-Ordner noch einmal ausführen.")

    try:
        import textschnitt as T
    except Exception:
        fail("Textschnitt konnte nicht geladen werden:\n\n" + traceback.format_exc()[-1500:])

    port = next((p for p in range(FIRST_PORT, FIRST_PORT + 20) if port_free(p)), None)
    if port is None:
        fail("Kein freier lokaler Port gefunden (8765–8784).")

    if arg:
        try:
            T.open_source(arg)
        except Exception as e:  # noqa: BLE001
            T.log(f"Startdatei nicht geöffnet: {e}")

    srv = T.make_server(port)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    T.log(f"Desktop-App gestartet auf Port {port} – Python {sys.version.split()[0]}")

    try:  # eigenes Taskleisten-Symbol statt dem von Python
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("Textschnitt.App")
    except Exception:
        pass

    window = webview.create_window(TITLE, f"http://127.0.0.1:{port}/", width=1440, height=920,
                                   min_size=(980, 640), background_color="#FAF6EE", text_select=True)

    def pick():
        try:
            res = window.create_file_dialog(webview.OPEN_DIALOG, allow_multiple=False, file_types=VIDEO_TYPES)
        except Exception:
            res = window.create_file_dialog(webview.OPEN_DIALOG, allow_multiple=False)
        if not res:
            return None
        return res[0] if isinstance(res, (list, tuple)) else res

    def focus(reload_ui: bool):
        try:
            window.restore()
            window.show()
            window.on_top = True
            window.on_top = False
            if reload_ui:
                window.evaluate_js("window.refresh && refresh()")
        except Exception:
            pass

    T.APP_HOOKS.update(pick=pick, focus=focus)

    def on_closing():
        return True

    window.events.closing += on_closing
    try:
        webview.settings["ALLOW_DOWNLOADS"] = True
    except Exception:
        pass
    icon = RES_DIR / "textschnitt.ico"
    try:
        webview.start(private_mode=False, storage_path=str(T.DATA_DIR / "webview"),
                      icon=str(icon) if icon.exists() else None)
    except TypeError:
        webview.start()
    srv.shutdown()


if __name__ == "__main__":
    main()
