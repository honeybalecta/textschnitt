"""
HoneyCut als Desktop-Anwendung: eigenes Programmfenster (Edge WebView2), kein Terminal, kein Browser.

Start: pythonw textschnitt_app.pyw [videodatei]
Läuft HoneyCut schon, wird die Datei im offenen Fenster geöffnet und das Fenster nach vorn geholt.
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
TITLE = "HoneyCut"
VIDEO_TYPES = ("Video und Audio (*.mp4;*.mov;*.mkv;*.m4v;*.webm;*.avi;*.mts;*.m2ts;*.wmv;*.mp3;*.wav;*.m4a;*.flac;*.aac;*.ogg)",
               "Alle Dateien (*.*)")
FONT_TYPES = ("Schriften (*.ttf;*.otf)", "Alle Dateien (*.*)")
CLIP_TYPES = ("Videos und Bilder (*.mp4;*.mov;*.mkv;*.m4v;*.webm;*.avi;*.jpg;*.jpeg;*.png;*.webp;*.bmp;*.gif)",
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


def hand_over(port: int, paths: list[str]):
    body = json.dumps({"paths": paths}).encode("utf-8")
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
        rep["web"] = all((T.WEB_DIR / f).exists() for f in ("index.html", "app.js", "studio.js", "app.css", "bridge-http.js"))
        if not rep["web"]:
            raise RuntimeError(f"Oberfläche fehlt in {T.WEB_DIR}")
        wav = Path(tempfile.gettempdir()) / "textschnitt_selftest.wav"
        subprocess.run([T.FFMPEG, "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=300:duration=3",
                        "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)], check=True, **T.NOWIN)
        audio = T.read_wav16k(wav)
        m = T.bundled_models()[0] if T.bundled_models() else "tiny"
        model = faster_whisper.WhisperModel(T.model_ref(m), device="cpu", compute_type="int8")
        segs, info = model.transcribe(audio, language="de", word_timestamps=True)
        rep["segments"] = len(list(segs))
        # Automatisches Freistellen: onnxruntime und das RVM-Modell müssen im Paket stecken
        import onnxruntime
        rep["onnxruntime"] = onnxruntime.__version__
        rep["matte_model"] = str(T.matte_model_path() or "")
        if not rep["matte_model"]:
            raise RuntimeError("Modell zum Freistellen fehlt im Paket")
        sess = onnxruntime.InferenceSession(rep["matte_model"], providers=["CPUExecutionProvider"])
        rep["matte_inputs"] = [i.name for i in sess.get_inputs()]
        rep["ok"] = True
    except Exception:
        rep["ok"] = False
        rep["error"] = traceback.format_exc()
    Path(out_path).write_text(json.dumps(rep, indent=2), encoding="utf-8")
    return 0 if rep["ok"] else 1


def fenster_einrichten(fenster, titel: str, maximieren: bool):
    """Fenster mittig auf den Bildschirm setzen und auf Wunsch maximieren.

    Windows legt neue Fenster sonst versetzt nach rechts unten ab. Läuft über die Win32-Funktionen,
    damit Position und Größe bei jeder Bildschirmskalierung in denselben (physischen) Pixeln gerechnet werden."""
    if sys.platform != "win32":
        return
    try:
        import ctypes
        from ctypes import wintypes
        u = ctypes.windll.user32
        hwnd = 0
        try:
            hwnd = int(fenster.native.Handle.ToInt64())
        except Exception:  # noqa: BLE001
            hwnd = u.FindWindowW(None, titel)
        if not hwnd:
            return

        class MONITORINFO(ctypes.Structure):
            _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT), ("rcWork", wintypes.RECT), ("dwFlags", wintypes.DWORD)]

        r = wintypes.RECT()
        u.GetWindowRect(hwnd, ctypes.byref(r))
        mi = MONITORINFO()
        mi.cbSize = ctypes.sizeof(MONITORINFO)
        u.GetMonitorInfoW(u.MonitorFromWindow(hwnd, 2), ctypes.byref(mi))   # 2 = nächster Bildschirm
        a = mi.rcWork
        aw, ah = a.right - a.left, a.bottom - a.top
        w, h = min(r.right - r.left, int(aw * 0.94)), min(r.bottom - r.top, int(ah * 0.94))
        u.SetWindowPos(hwnd, 0, a.left + (aw - w) // 2, a.top + (ah - h) // 2, w, h, 0x0004 | 0x0010)   # ohne Z-Reihenfolge/Aktivierung
        if maximieren:
            u.ShowWindow(hwnd, 3)   # SW_MAXIMIZE
    except Exception:  # noqa: BLE001
        pass


def main():
    if len(sys.argv) > 2 and sys.argv[1] == "--selftest":
        sys.exit(selftest(sys.argv[2]))
    args = [a for a in sys.argv[1:] if not a.startswith("--")]

    # Schon offen? Dann dorthin übergeben und beenden.
    if running_instance(FIRST_PORT):
        hand_over(FIRST_PORT, args)
        return

    try:
        import webview  # pywebview
    except ImportError:
        fail("Für das Programmfenster fehlt „pywebview“.\n\nBitte install.bat im HoneyCut-Ordner noch einmal ausführen.")

    try:
        import textschnitt as T
    except Exception:
        fail("HoneyCut konnte nicht geladen werden:\n\n" + traceback.format_exc()[-1500:])

    port = next((p for p in range(FIRST_PORT, FIRST_PORT + 20) if port_free(p)), None)
    if port is None:
        fail("Kein freier lokaler Port gefunden (8765–8784).")

    srv = T.make_server(port)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    T.log(f"Desktop-App gestartet auf Port {port} – Python {sys.version.split()[0]}")

    try:  # eigenes Taskleisten-Symbol statt dem von Python
        import ctypes
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("HoneyCut.App")
    except Exception:
        pass

    window = webview.create_window(TITLE, T.app_url(port), width=1480, height=940,
                                   min_size=(1000, 640), background_color="#131312", text_select=False)
    window.events.shown += lambda: fenster_einrichten(window, TITLE, True)

    def pick(kind: str):
        multi = kind == "videos"
        types = FONT_TYPES if kind == "font" else CLIP_TYPES if kind == "clip" else VIDEO_TYPES
        multi = multi or kind == "font"
        try:
            res = window.create_file_dialog(webview.OPEN_DIALOG, allow_multiple=multi, file_types=types)
        except Exception:
            res = window.create_file_dialog(webview.OPEN_DIALOG, allow_multiple=multi)
        if not res:
            return []
        return list(res) if isinstance(res, (list, tuple)) else [res]

    full_state = {"on": False}

    def fullscreen(on: bool) -> bool:
        """Vollbild-Vorschau: ganzes Fenster bildschirmfüllend."""
        try:
            if on != full_state["on"]:
                window.toggle_fullscreen()
                full_state["on"] = on
            return True
        except Exception:
            return False

    def focus():
        try:
            window.restore()
            window.show()
            window.on_top = True
            window.on_top = False
        except Exception:
            pass

    def open_files(media: list):
        try:
            window.evaluate_js("window.TSApp && TSApp.onOpenFiles(" + json.dumps(json.dumps(media)) + ")")
        except Exception:
            pass

    def open_window(url: str, label: str):
        try:
            w2 = webview.create_window(f"{TITLE} – {label}", url, width=1280, height=860, min_size=(820, 560),
                                       background_color="#131312", text_select=False)
            w2.events.shown += lambda: fenster_einrichten(w2, f"{TITLE} – {label}", False)
        except Exception as e:  # noqa: BLE001
            T.log(f"Fenster nicht geöffnet: {e!r}")

    def save_any(name: str):
        """Speichern-Dialog für Dateien aus HoneyDeck."""
        ext = Path(name).suffix.lstrip(".") or "*"
        try:
            res = window.create_file_dialog(webview.SAVE_DIALOG, save_filename=name, file_types=(f"{ext.upper()}-Datei (*.{ext})", "Alle Dateien (*.*)"))
        except Exception:
            res = window.create_file_dialog(webview.SAVE_DIALOG, save_filename=name)
        if not res:
            return None
        return res[0] if isinstance(res, (list, tuple)) else res

    T.APP_HOOKS.update(pick=pick, focus=focus, open_files=open_files, open_window=open_window, fullscreen=fullscreen, save_any=save_any)
    if args:  # beim Start übergebene Dateien öffnen, sobald die Oberfläche geladen ist
        window.events.loaded += lambda: threading.Timer(0.8, T.handle_open_paths, args=(args,)).start()

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
