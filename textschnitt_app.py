"""
HoneyCut als Desktop-Anwendung: eigenes Programmfenster (Edge WebView2), kein Terminal, kein Browser.

Start: pythonw textschnitt_app.pyw [videodatei]
Läuft HoneyCut schon, wird die Datei im offenen Fenster geöffnet und das Fenster nach vorn geholt.

HoneyRec (Aufnahmeprogramm) ist dasselbe Programm mit eigenem Start: HoneyRec.exe bzw. „--rec“ öffnet das Aufnahmefenster.
Beide teilen sich Backend, Projekte und Datenordner; wer zuerst startet, öffnet das lokale Backend, der zweite Start
übergibt nur noch („bitte ein HoneyRec-Fenster“ bzw. „bitte HoneyCut“).
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
REC_TITLE = "HoneyRec"
REC_MODE = "--rec" in sys.argv or Path(sys.executable).stem.lower() == "honeyrec"
VIDEO_TYPES = ("Video und Audio (*.mp4;*.mov;*.mkv;*.m4v;*.webm;*.avi;*.mts;*.m2ts;*.wmv;*.mp3;*.wav;*.m4a;*.flac;*.aac;*.ogg)",
               "Alle Dateien (*.*)")
FONT_TYPES = ("Schriften (*.ttf;*.otf)", "Alle Dateien (*.*)")
CLIP_TYPES = ("Videos und Bilder (*.mp4;*.mov;*.mkv;*.m4v;*.webm;*.avi;*.jpg;*.jpeg;*.png;*.webp;*.bmp;*.gif)",
              "Alle Dateien (*.*)")
# Medienablage: mehrere Videos, Bilder und Tondateien auf einmal
CLIPS_TYPES = ("Videos Bilder und Ton (*.mp4;*.mov;*.mkv;*.m4v;*.webm;*.avi;*.jpg;*.jpeg;*.png;*.webp;*.bmp;*.gif;*.mp3;*.wav;*.m4a;*.flac;*.aac;*.ogg)",
               "Alle Dateien (*.*)")
# HoneyRec: Medien und Dokumente auf einmal (pywebview braucht die Endungen ohne Leerzeichen, durch Semikolon getrennt)
REC_TYPES = ("Medien und Dokumente (*.mp4;*.mov;*.mkv;*.m4v;*.webm;*.avi;*.jpg;*.jpeg;*.png;*.webp;*.bmp;*.gif;*.mp3;*.wav;*.m4a;*.flac;*.aac;*.ogg;"
             "*.pdf;*.pptx;*.ppt;*.pps;*.ppsx;*.odp;*.docx;*.doc;*.odt;*.rtf;*.txt;*.md;*.csv;*.html;*.htm;*.xlsx;*.xls;*.ods)",
             "PDF und Dokumente (*.pdf;*.pptx;*.ppt;*.docx;*.doc;*.odt;*.odp;*.rtf;*.txt;*.md)", "Alle Dateien (*.*)")
PACKAGE_TYPES = ("HoneyCut Projekt (*.honeycut)", "Alle Dateien (*.*)")
BACKUP_TYPES = ("HoneyCut Sicherung (*.zip)", "Alle Dateien (*.*)")


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
    body = json.dumps({"paths": paths, "app": "rec" if REC_MODE else "cut"}).encode("utf-8")
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
        # Eigenes Wörterbuch: Die Begriffe gehen als Hinweis (hotwords) an Whisper – das muss die mitgelieferte Fassung annehmen
        segs, info = model.transcribe(audio, language="de", word_timestamps=True, hotwords=T.asr_hint("Hermeier,  Bundestag"))
        rep["hotwords"] = len(list(segs)) >= 0
        # Automatisches Freistellen: onnxruntime und das RVM-Modell müssen im Paket stecken
        import onnxruntime
        rep["onnxruntime"] = onnxruntime.__version__
        rep["matte_model"] = str(T.matte_model_path() or "")
        if not rep["matte_model"]:
            raise RuntimeError("Modell zum Freistellen fehlt im Paket")
        sess = onnxruntime.InferenceSession(rep["matte_model"], providers=["CPUExecutionProvider"])
        rep["matte_inputs"] = [i.name for i in sess.get_inputs()]
        # Übersetzen: Modell im Paket und ein Probesatz
        rep["translate_pairs"] = T.translate_pairs()
        job = {"cancel": False, "progress": 0, "message": ""}
        rep["translate_probe"] = T.translate_job(job, ["Die Mieten sind stark gestiegen."], "de", "en")["texts"][0]
        if not rep["translate_probe"]:
            raise RuntimeError("Übersetzung liefert nichts")
        # Schrift im Export: Die gewählte Schrift muss im fertigen Video stehen, so groß wie in der Vorschau – mit dem
        # mitgelieferten ffmpeg, in der gebauten App. Kam sie nicht an, stand stillschweigend die Standardschrift im Bild.
        rep["schrift_export"] = T.font_selftest()
        if not rep["schrift_export"].get("ok"):
            raise RuntimeError(f"Schrift im Export stimmt nicht: {rep['schrift_export']}")
        # Ton und Übergänge: Absenkung der Musik, aufbereitete Stimme (numpy) und ein Übergang im fertigen Video – mit dem
        # mitgelieferten ffmpeg, in der gebauten App nachgemessen.
        rep["ton"] = T.ton_selftest()
        if not rep["ton"].get("ok"):
            raise RuntimeError(f"Ton oder Übergang im Export stimmt nicht: {rep['ton']}")
        # Belege im Bild: unkenntlich gemachte Bereiche (Rechteck verpixelt, Ellipse weichgezeichnet mit Keyframes) und eine Form
        # darüber – mit dem mitgelieferten ffmpeg, in der gebauten App am fertigen Video nachgemessen.
        rep["belege"] = T.belege_selftest()
        if not rep["belege"].get("ok"):
            raise RuntimeError(f"Unkenntlich machen im Export stimmt nicht: {rep['belege']}")
        rep["bild"] = T.bild_selftest()
        if not rep["bild"].get("ok"):
            raise RuntimeError(f"Weißabgleich, Hintergrund oder Beruhigen im Export stimmen nicht: {rep['bild']}")
        rep["uebergabe"] = T.uebergabe_selftest()
        if not rep["uebergabe"].get("ok"):
            raise RuntimeError(f"Die Übergabe im Heimnetz antwortet nicht wie erwartet: {rep['uebergabe']}")
        rep["folgen"] = T.folgen_selftest()
        if not rep["folgen"].get("ok"):
            raise RuntimeError(f"Die Masken für „Person im Bild halten“ kommen nicht wie erwartet: {rep['folgen']}")
        rep["kerne"] = [f for f in ("stimmen.js", "folgen.js", "skript.js") if (T.WEB_DIR / f).is_file()]
        if len(rep["kerne"]) != 3:
            raise RuntimeError(f"Rechenkerne der Oberfläche fehlen im Paket: {rep['kerne']}")
        rep["tonquelle"] = T.tonquelle_selftest()
        if not rep["tonquelle"].get("ok"):
            raise RuntimeError(f"Zweite Tonquelle angleichen arbeitet nicht wie erwartet: {rep['tonquelle']}")
        rep["honeyrec"] = T.rec_selftest()
        if not rep["honeyrec"].get("ok") or not (T.WEB_DIR / "rec.html").is_file():
            raise RuntimeError(f"HoneyRec sichert Aufnahmen nicht wie erwartet: {rep['honeyrec']}")
        rep["stimmen"] = T.stimmen_selftest()
        if not rep["stimmen"].get("ok"):
            raise RuntimeError(f"Der Ton für das Erkennen der Personen kommt nicht wie erwartet: {rep['stimmen']}")
        # Export über die Grafikkarte: Das mitgelieferte ffmpeg muss die Encoder von Nvidia, Intel und AMD kennen; die Suche nach
        # einer nutzbaren Grafikkarte darf auf einem Rechner ohne sie nichts finden und nicht scheitern.
        enc = subprocess.run([T.FFMPEG, "-hide_banner", "-encoders"], capture_output=True, text=True, **T.NOWIN).stdout
        rep["gpu_encoder"] = [c for _, _, c in T.GPU_ENCODERS if f" {c} " in enc]
        found = T.gpu_detect()
        rep["gpu"] = found["label"] if found else None
        rep["gpu_probe"] = list(T.GPU["tried"])
        if os.name == "nt" and len(rep["gpu_encoder"]) < len(T.GPU_ENCODERS):
            raise RuntimeError(f"Dem mitgelieferten ffmpeg fehlen Encoder für die Grafikkarte: {rep['gpu_encoder']}")
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
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("HoneyCut.HoneyRec" if REC_MODE else "HoneyCut.App")
    except Exception:
        pass

    url_cut = T.app_url(port)
    url_rec = url_cut.replace("index.html", "rec.html")
    first_title = REC_TITLE if REC_MODE else TITLE
    window = webview.create_window(first_title, url_rec if REC_MODE else url_cut, width=1480, height=940,
                                   min_size=(1000, 640), background_color="#131312", text_select=False)
    window.events.shown += lambda: fenster_einrichten(window, first_title, True)
    kinds = {"rec" if REC_MODE else "cut": window}   # je Art das zuletzt geöffnete Fenster

    def pick(kind: str):
        multi = kind in ("videos", "clips", "font", "rec")
        types = {"font": FONT_TYPES, "clip": CLIP_TYPES, "clips": CLIPS_TYPES, "rec": REC_TYPES, "package": PACKAGE_TYPES, "backup": BACKUP_TYPES}.get(kind, VIDEO_TYPES)
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

    def bring(w) -> bool:
        try:
            w.restore()
            w.show()
            w.on_top = True
            w.on_top = False
            return True
        except Exception:
            return False

    def focus(app: str = "cut"):
        """Zweiter Programmstart: passendes Fenster nach vorn holen – oder eines öffnen (HoneyRec neben HoneyCut und umgekehrt)."""
        w = kinds.get(app)
        if w is not None and bring(w):
            return
        try:
            t = REC_TITLE if app == "rec" else TITLE
            w2 = webview.create_window(t, url_rec if app == "rec" else url_cut, width=1480, height=940, min_size=(1000, 640),
                                       background_color="#131312", text_select=False)
            w2.events.shown += lambda: fenster_einrichten(w2, t, True)
            w2.events.closed += lambda: kinds.get(app) is w2 and kinds.pop(app, None)
            kinds[app] = w2
        except Exception as e:  # noqa: BLE001
            T.log(f"Fenster nicht geöffnet: {e!r}")

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

    def save(name: str):
        """Speichern-Dialog für Projektpakete (.honeycut)."""
        try:
            res = window.create_file_dialog(webview.SAVE_DIALOG, save_filename=name, file_types=PACKAGE_TYPES)
        except Exception:
            res = window.create_file_dialog(webview.SAVE_DIALOG, save_filename=name)
        if not res:
            return None
        return res[0] if isinstance(res, (list, tuple)) else res

    # HoneyRec: eingebauter Browser – ein eigenes Fenster des Programms, gesteuert aus der Leiste in HoneyRec.
    # Links, die ein neues Fenster öffnen wollen, bleiben in diesem Fenster (der Standardbrowser wird nie aufgerufen).
    BROWSER_TITLE = "HoneyRec – Browser"
    browser_state = {"w": None, "url": ""}
    keep_inside = ("(function(){if(window.__hrB)return;window.__hrB=1;"
                   "document.addEventListener('click',function(e){var a=e.target&&e.target.closest&&e.target.closest('a[target]');"
                   "if(a&&a.href){a.removeAttribute('target');}},true);"
                   "window.open=function(u){if(u){location.href=u;}return window;};})()")

    def browser(action: str, url: str = ""):
        w = browser_state["w"]
        try:
            if action == "open":
                if not url.lower().startswith(("http://", "https://")):
                    return {"ok": False, "error": "Nur Webadressen"}
                browser_state["url"] = url
                if w is None:
                    w = webview.create_window(BROWSER_TITLE, url, width=1280, height=860, min_size=(640, 420), text_select=True)
                    browser_state["w"] = w
                    w.events.shown += lambda: fenster_einrichten(w, BROWSER_TITLE, False)
                    w.events.loaded += lambda: (w.evaluate_js(keep_inside), browser_state.update(url=w.get_current_url() or browser_state["url"]))
                    w.events.closed += lambda: browser_state.update(w=None)
                else:
                    w.load_url(url)
                    bring(w)
                return {"ok": True, "open": True, "url": url}
            if w is None:
                return {"ok": action == "close", "open": False, "url": ""}
            if action in ("back", "forward", "reload"):
                w.evaluate_js({"back": "history.back()", "forward": "history.forward()", "reload": "location.reload()"}[action])
            elif action == "close":
                w.destroy()
                browser_state["w"] = None
                return {"ok": True, "open": False, "url": ""}
            elif action == "show":
                bring(w)
            return {"ok": True, "open": True, "url": w.get_current_url() or browser_state["url"]}
        except Exception as e:  # noqa: BLE001
            T.log(f"Browser: {e!r}")
            browser_state["w"] = None
            return {"ok": False, "error": str(e)}

    T.APP_HOOKS.update(pick=pick, browser=browser, focus=focus, open_files=open_files, open_window=open_window, fullscreen=fullscreen, save_any=save_any, save=save)
    if args:  # beim Start übergebene Dateien öffnen, sobald die Oberfläche geladen ist
        window.events.loaded += lambda: threading.Timer(0.8, T.handle_open_paths, args=(args,)).start()

    def on_closing():
        return True

    window.events.closing += on_closing
    try:
        webview.settings["ALLOW_DOWNLOADS"] = True
    except Exception:
        pass
    icon = RES_DIR / ("honeyrec.ico" if REC_MODE else "textschnitt.ico")
    try:
        webview.start(private_mode=False, storage_path=str(T.DATA_DIR / "webview"),
                      icon=str(icon) if icon.exists() else None)
    except TypeError:
        webview.start()
    srv.shutdown()


if __name__ == "__main__":
    main()
