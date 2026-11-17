#!/usr/bin/env python3
"""
HoneyCut (früher Textschnitt) – Desktop-Backend für das gemeinsame Studio (core/web).

Start:  python textschnitt.py            (öffnet die Oberfläche im Browser)
        pythonw textschnitt_app.pyw      (eigenes Programmfenster)

Die Oberfläche spricht über dieselbe Schnittstelle wie die Android-App (window.TS);
hier wird sie per HTTP bedient. Schnitt und Export laufen über ffmpeg, die Transkription über faster-whisper.
"""
from __future__ import annotations

import base64
import hashlib
import importlib.util
import json
import math
import mimetypes
import os
import platform
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse, unquote

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1")
import warnings  # noqa: E402
warnings.filterwarnings("ignore", module="huggingface_hub")

VERSION = "2.43.0"
APP_DIR = Path(__file__).resolve().parent
FROZEN = bool(getattr(sys, "frozen", False))          # als installierte .exe gebaut
RES_DIR = Path(getattr(sys, "_MEIPASS", APP_DIR))      # mitgelieferte Dateien (Oberfläche, ffmpeg, Modelle)
WEB_DIR = RES_DIR / "web" if (RES_DIR / "web" / "index.html").exists() else APP_DIR / "core" / "web"
if FROZEN or os.environ.get("TEXTSCHNITT_DATA"):
    DATA_DIR = Path(os.environ.get("TEXTSCHNITT_DATA") or os.environ.get("LOCALAPPDATA") or Path.home()) / ("" if os.environ.get("TEXTSCHNITT_DATA") else "Textschnitt")
else:
    DATA_DIR = APP_DIR / "daten"
PROJ_DIR = DATA_DIR / "projects"
FONT_DIR = DATA_DIR / "fonts"          # importierte Untertitel-Schriften
FONT_EXT = (".ttf", ".otf")
CACHE_DIR = DATA_DIR / "cache"
for _d in (PROJ_DIR, CACHE_DIR / "thumbs", CACHE_DIR / "proxies"):
    _d.mkdir(parents=True, exist_ok=True)
PORT = int(os.environ.get("TEXTSCHNITT_PORT", "8765"))
TOKEN = secrets.token_urlsafe(12)
_bundled = RES_DIR / "ffmpeg"
_exe = ".exe" if os.name == "nt" else ""
FFMPEG = os.environ.get("FFMPEG") or (str(_bundled / f"ffmpeg{_exe}") if (_bundled / f"ffmpeg{_exe}").exists() else "ffmpeg")
FFPROBE = os.environ.get("FFPROBE") or (str(_bundled / f"ffprobe{_exe}") if (_bundled / f"ffprobe{_exe}").exists() else "ffprobe")
MODELS_DIR = RES_DIR / "models"   # mitgelieferte Whisper-Modelle (Ordnername = Modellname)

NOWIN = {"creationflags": 0x08000000} if os.name == "nt" else {}   # keine Konsolenfenster unter Windows
APP_HOOKS: dict = {}   # von der Desktop-App gesetzt (Dateidialog, Fenster nach vorn)
JOBS: dict[str, dict] = {}
ALLOWED: set[str] = set()          # Dateien, die die Oberfläche lesen darf (gewählt, im Projekt, erzeugt)
CREATED: set[str] = set()          # vom Export erzeugte Dateien/Ordner
IMG_EXT = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".heic", ".tif", ".tiff"}
VIDEO_EXT = "*.mp4 *.mov *.mkv *.m4v *.webm *.avi *.mts *.m2ts *.wmv *.flv *.3gp"
AUDIO_EXT = "*.mp3 *.wav *.m4a *.flac *.aac *.ogg *.opus"
IMAGE_EXT = "*.jpg *.jpeg *.png *.webp *.bmp *.gif"


# ───────────────────────────── Hilfsfunktionen ─────────────────────────────

LOG_PATH = DATA_DIR / "textschnitt.log"
_log_lock = threading.Lock()


def log(msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')}  {msg}"
    try:
        print(line, flush=True)
    except Exception:
        pass
    try:
        with _log_lock, open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def not_a_path(p: str) -> bool:
    """Eingebettete Daten statt eines Dateipfads – z. B. ein Folienbild, das als „data:…“ direkt im Projekt steht."""
    return len(p) > 4096 or p[:5].lower() in ("data:", "blob:")


def norm_path(p: str) -> str:
    """Pfad in einheitlicher Schreibweise. Was kein Pfad ist, bleibt, wie es ist: Unter Windows bricht Path.resolve() bei mehr
    als 32 767 Zeichen mit „stat: path too long for Windows“ ab (ein ValueError, kein OSError). Daran scheiterte „Projekt
    weitergeben“, sobald ein Bild direkt im Projekt eingebettet war; beim Laden und Speichern eines solchen Projekts wurden
    außerdem die übrigen Dateien nicht mehr freigegeben."""
    p = str(p)
    if not_a_path(p):
        return p
    try:
        return str(Path(p).expanduser().resolve())
    except (OSError, ValueError, RuntimeError):
        return p


def allow(p: str | Path) -> str:
    s = norm_path(str(p))
    if not not_a_path(s):
        ALLOWED.add(s)
    return s


def safe_name(s: str) -> str:
    return re.sub(r"[^\w\-. äöüÄÖÜß()+]", "_", s).strip() or "projekt"


def fmt_ts(t: float, sep: str = ",") -> str:
    ms = int(round(max(0.0, t) * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


_probe_cache: dict[str, dict] = {}


def probe_raw(path: str) -> dict:
    key = f"{path}|{os.path.getmtime(path) if os.path.exists(path) else 0}"
    if key in _probe_cache:
        return _probe_cache[key]
    try:
        res = subprocess.run([FFPROBE, "-v", "error", "-print_format", "json", "-show_streams", "-show_format", path],
                             capture_output=True, text=True, encoding="utf-8", errors="replace", stdin=subprocess.DEVNULL, timeout=90, **NOWIN)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"ffprobe kam bei „{Path(path).name}“ nicht weiter (liegt die Datei in einem Cloud-Ordner, der erst geladen werden muss?).")
    if res.returncode:
        raise RuntimeError(res.stderr.strip() or "ffprobe konnte die Datei nicht lesen.")
    d = json.loads(res.stdout)
    _probe_cache[key] = d
    return d


def probe(path: str) -> dict:
    """Medien-Infos im Format der Oberfläche (Größe bereits gedreht wie angezeigt)."""
    path = norm_path(path)
    d = probe_raw(path)
    streams = d.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video" and not s.get("disposition", {}).get("attached_pic")), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    fmt = d.get("format", {})
    duration = float(fmt.get("duration") or 0)
    ext = Path(path).suffix.lower()
    is_img = bool(v) and (ext in IMG_EXT or (v.get("codec_name") in ("mjpeg", "png", "webp", "bmp", "gif", "tiff") and duration < 0.5))
    fps, w, h = 30.0, 0, 0
    if v:
        rate = v.get("avg_frame_rate") or v.get("r_frame_rate") or "30/1"
        try:
            n, dd = rate.split("/")
            fps = float(n) / float(dd) if float(dd) else 30.0
        except ValueError:
            fps = 30.0
        if not fps or fps > 240 or is_img:
            fps = 30.0
        w, h = int(v.get("width", 0)), int(v.get("height", 0))
        rot = 0
        for sd in v.get("side_data_list", []) or []:
            if "rotation" in sd:
                rot = int(float(sd["rotation"]))
        rot = rot or int(float(v.get("tags", {}).get("rotate", 0) or 0))
        if abs(rot) % 180 == 90:
            w, h = h, w
    kind = "image" if is_img else ("video" if v else "audio")
    info = {
        "uri": path, "name": Path(path).name, "kind": kind,
        "duration": 600.0 if is_img else round(duration, 3),
        "width": w, "height": h, "rotation": 0, "fps": round(fps, 3),
        "hasAudio": a is not None and not is_img, "hasVideo": v is not None,
        "startTime": float(fmt.get("start_time") or 0),
        # Ton beginnt später als das Bild (z. B. bei geschnittenen Handyvideos): so weit lagen Wortzeiten früher daneben
        "audioStart": round(max(0.0, float(a.get("start_time") or 0) - float(fmt.get("start_time") or 0)), 3) if a else 0.0,
    }
    allow(path)
    return info


def legacy_project(path: str) -> dict | None:
    """Projekt der alten Desktop-Version (…textschnitt.json neben dem Video) – Transkript übernehmen."""
    p = Path(path)
    lp = p.with_name(p.stem + ".textschnitt.json")
    if not lp.exists():
        return None
    try:
        d = json.loads(lp.read_text(encoding="utf-8"))
        if Path(d.get("source", "")).name != p.name or not d.get("tokens"):
            return None
        return {k: d.get(k) for k in ("tokens", "deleted", "trims", "cues", "sub_style", "language")}
    except Exception:
        return None


def ffmpeg_major() -> int:
    try:
        out = subprocess.run([FFMPEG, "-version"], capture_output=True, text=True, **NOWIN).stdout
        m = re.search(r"ffmpeg version n?(\d+)\.", out)
        return int(m.group(1)) if m else 99
    except Exception:
        return 0


def whisper_available() -> bool:
    return importlib.util.find_spec("faster_whisper") is not None


def capcut_drafts_dir() -> Path | None:
    cands = []
    if platform.system() == "Windows":
        la = os.environ.get("LOCALAPPDATA")
        if la:
            cands.append(Path(la) / "CapCut" / "User Data" / "Projects" / "com.lveditor.draft")
    elif platform.system() == "Darwin":
        cands.append(Path.home() / "Movies" / "CapCut" / "User Data" / "Projects" / "com.lveditor.draft")
    return next((c for c in cands if c.is_dir()), None)


def concat_root() -> Path:
    """Der Concat-Projektordner auf dem Desktop (wird bei Bedarf angelegt)."""
    home = Path.home()
    for c in (home / "Desktop" / "Concat", home / "OneDrive" / "Desktop" / "Concat",
              home / "OneDrive" / "Schreibtisch" / "Concat", home / "Schreibtisch" / "Concat"):
        if c.is_dir():
            return c
    for d in (home / "Desktop", home / "OneDrive" / "Desktop", home / "Schreibtisch"):
        if d.is_dir():
            return d / "Concat"
    return home / "Concat"


# ───────────────────────────── Jobs ─────────────────────────────

JOB_KEEP = 1800            # so lange (Sekunden) bleibt ein fertiger, bereits abgeholter Auftrag noch abfragbar
JOB_KEEP_ASR = 12 * 3600   # Transkriptionen länger: falls das Fenster nach dem Abholen abstürzt, lässt sich das Ergebnis erneut holen
JOB_KEEP_LOST = 6 * 3600   # nie abgeholte Ergebnisse (Fenster wurde geschlossen) – außer Transkriptionen, die bleiben


def prune_jobs() -> None:
    """Fertige Aufträge samt Ergebnis (Lautstärkeverläufe, Übersetzungen, Transkripte) nach einer Weile vergessen –
    sonst wächst der Speicherbedarf mit jedem Auftrag einer langen Sitzung. Eine fertige Transkription, die noch niemand
    abgeholt hat, bleibt in jedem Fall: Sie wird beim nächsten Öffnen des Projekts übernommen, auch Tage später."""
    now = time.time()
    for jid, job in list(JOBS.items()):
        if job["status"] == "running":
            continue
        age, asr = now - job.get("ended", now), job.get("kind") == "transcribe"
        if (job.get("fetched") and age > (JOB_KEEP_ASR if asr else JOB_KEEP)) or (not asr and age > JOB_KEEP_LOST):
            JOBS.pop(jid, None)


def new_job(kind: str) -> dict:
    prune_jobs()
    jid = uuid.uuid4().hex[:10]
    job = {"id": jid, "kind": kind, "status": "running", "progress": 0.0, "message": "", "result": None,
           "error": None, "cancel": False, "started": time.time()}
    JOBS[jid] = job
    return job


def run_job(job: dict, fn, *args):
    def target():
        log(f"Job {job['kind']} gestartet")
        try:
            job["result"] = fn(job, *args)
            job["ended"] = time.time()
            job["status"] = "cancelled" if job["cancel"] else "done"
            job["progress"] = 1.0
            log(f"Job {job['kind']} fertig nach {time.time() - job['started']:.0f} s")
        except BaseException as e:  # noqa: BLE001
            import traceback
            job["ended"] = time.time()
            job["error"] = str(e) or e.__class__.__name__
            job["status"] = "cancelled" if job["cancel"] else "error"
            log(f"Job {job['kind']} FEHLER: {e!r}\n{traceback.format_exc()}")
    threading.Thread(target=target, daemon=True).start()
    return job


def run_ffmpeg(args: list[str], total: float, job: dict | None, base: float = 0.0, span: float = 1.0,
               cwd: Path | None = None):
    cmd = [FFMPEG, "-hide_banner", "-y", "-nostats", "-progress", "pipe:1"] + args
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, text=True,
                         encoding="utf-8", errors="replace", cwd=str(cwd) if cwd else None, **NOWIN)
    err: list[str] = []
    t = threading.Thread(target=lambda: err.extend(p.stderr.readlines()), daemon=True)
    t.start()
    # Wächter: kommt minutenlang kein Fortschritt, wird ffmpeg beendet und der Fehler gemeldet statt ewig zu warten
    state = {"last": time.time(), "pos": -1, "stuck": False, "t0": time.time(), "stopping": False}

    def stop():
        """ffmpeg beenden: erst höflich, nach drei Sekunden hart. Kurz nach dem Start bleibt ffmpeg nach der höflichen Aufforderung
        mitunter stehen, statt sich zu beenden – der Auftrag liefe dann nach „Abbrechen“ für immer weiter (unter Linux und macOS
        beobachtet; unter Windows beendet terminate() den Prozess ohnehin sofort)."""
        if state["stopping"]:
            return
        state["stopping"] = True
        try:
            p.terminate()
        except OSError:
            pass

        def hard():
            try:
                p.wait(timeout=3)
            except subprocess.TimeoutExpired:
                try:
                    p.kill()
                except OSError:
                    pass
        threading.Thread(target=hard, daemon=True).start()

    def watchdog():
        while p.poll() is None:
            time.sleep(2)
            if job and job["cancel"]:
                stop()
                return
            if time.time() - state["last"] > 240:
                state["stuck"] = True
                log(f"ffmpeg hängt seit 4 Minuten ohne Fortschritt – wird beendet:\n{' '.join(cmd)}\n{''.join(err[-40:])}")
                p.kill()
                return
    threading.Thread(target=watchdog, daemon=True).start()
    for line in p.stdout:  # type: ignore[union-attr]
        if line.startswith("out_time_us=") or line.startswith("out_time_ms="):
            val = line.split("=", 1)[1].strip()
            if val.isdigit():
                if int(val) != state["pos"]:
                    state["pos"], state["last"] = int(val), time.time()
                if job and total > 0:
                    job["progress"] = base + span * min(1.0, int(val) / 1e6 / total)
                    el = int(time.time() - state["t0"])
                    job["message"] = f"Exportiere … {int(job['progress'] * 100)} % · läuft seit {el // 60}:{el % 60:02d}"
        if job and job["cancel"]:
            stop()
    p.wait()
    t.join(timeout=2)
    if job and job["cancel"]:
        raise RuntimeError("Abgebrochen")
    if state["stuck"]:
        raise RuntimeError("Der Export ist hängen geblieben (ffmpeg kam nicht weiter). Details stehen in der Protokolldatei textschnitt.log.")
    if p.returncode:
        log(f"ffmpeg-Fehler bei: {' '.join(cmd)}\n{''.join(err[-40:])}")
        raise RuntimeError("ffmpeg-Fehler:\n" + "".join(err[-12:]))
    return "".join(err)


# ───────────────────────────── Modelle & Transkription ─────────────────────────────

MODELS = [  # Name, Beschriftung, ungefähre Größe (MB)
    ("small", "small – schnell", 480),
    ("large-v3-turbo", "large-v3-turbo – genauer", 1600),
    ("medium", "medium", 1500),
]
MODEL_REPO = {"large-v3-turbo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo"}


def bundled_models() -> list[str]:
    try:
        return sorted(d.name for d in MODELS_DIR.iterdir() if (d / "model.bin").exists() and not d.name.startswith("opus-mt-"))   # Übersetzungsmodelle zählen nicht
    except OSError:
        return []


def model_cached(name: str) -> bool:
    if (MODELS_DIR / name / "model.bin").exists():
        return True
    try:
        from faster_whisper.utils import download_model  # type: ignore
        download_model(MODEL_REPO.get(name, name), local_files_only=True)
        return True
    except Exception:
        return False


def model_ref(name: str) -> str:
    local = MODELS_DIR / name
    return str(local) if (local / "model.bin").exists() else name


_models_cache: dict = {"t": 0.0, "v": None}


def models_list() -> list[dict]:
    if _models_cache["v"] is not None and time.time() - _models_cache["t"] < 600:
        return _models_cache["v"]
    out = []
    inst = {n: model_cached(n) for n, _, _ in MODELS} if whisper_available() else {}
    rec = "large-v3-turbo" if inst.get("large-v3-turbo") else "small"
    for n, label, mb in MODELS:
        out.append({"name": n, "label": label, "sizeMb": mb, "installed": bool(inst.get(n)),
                    "bundled": n in bundled_models(), "recommended": n == rec})
    _models_cache.update(t=time.time(), v=out)
    return out


def hf_cache_dir() -> Path:
    if os.environ.get("HF_HUB_CACHE"):
        return Path(os.environ["HF_HUB_CACHE"])
    if os.environ.get("HF_HOME"):
        return Path(os.environ["HF_HOME"]) / "hub"
    return Path.home() / ".cache" / "huggingface" / "hub"


def watch_download(job: dict, name: str, stop: threading.Event, phase: dict | None = None):
    total = dict((n, mb) for n, _, mb in MODELS).get(name, 0) * 1e6
    if not total:
        return
    key = MODEL_REPO.get(name, f"Systran/faster-whisper-{name}").replace("/", "--").lower()
    while not stop.wait(1.0):
        size = 0
        try:
            for d in hf_cache_dir().glob("models--*"):
                if d.name.lower().endswith(key):
                    size += sum(f.stat().st_size for f in d.rglob("*") if f.is_file() and not f.is_symlink())
        except OSError:
            continue
        frac = min(0.99, size / total)
        job["progress"] = frac if phase is None else job["progress"]
        msg = f"Lade Modell „{name}“ (nur beim ersten Mal): {size / 1e9:.2f} von ca. {total / 1e9:.1f} GB"
        if phase is not None:
            phase["text"] = msg
        else:
            job["message"] = msg


def download_job(job: dict, name: str):
    from faster_whisper.utils import download_model  # type: ignore
    stop = threading.Event()
    threading.Thread(target=watch_download, args=(job, name, stop), daemon=True).start()
    try:
        download_model(MODEL_REPO.get(name, name))
    finally:
        stop.set()
        _models_cache["v"] = None
    return {"name": name}


FILLER_PROMPT = {"de": "Ähm, also, äh, ich mein, hm, ja. Also ich – ich wollte, das ist, das ist ja so. Ähm, äh.",
                 "en": "Um, uh, so, like, you know, hmm. So I – I wanted, this is, this is like. Uh, um."}
_model_cache: dict = {}
_model_lock = threading.Lock()


def read_wav16k(path: Path):
    """Liest ein 16-kHz-Mono-WAV (pcm_s16le) als float32-Array ein."""
    import wave
    import numpy as np  # wird mit faster-whisper installiert
    with wave.open(str(path), "rb") as w:
        if w.getsampwidth() != 2 or w.getnchannels() != 1 or w.getframerate() != 16000:
            raise RuntimeError("Unerwartetes Tonformat bei der Vorbereitung.")
        raw = w.readframes(w.getnframes())
    return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0


def envelope(audio) -> str:
    """Lautstärke in 10-ms-Schritten (dB, 0…255) als Base64 – damit setzt die Oberfläche Schnitte in Sprechpausen."""
    import numpy as np
    n = len(audio) // 160
    if n == 0:
        return ""
    fr = audio[: n * 160].reshape(n, 160).astype(np.float64)
    rms = np.sqrt((fr * fr).mean(axis=1)) + 1e-9
    db = np.clip(20 * np.log10(rms), -90, 0)
    return base64.b64encode(np.round((db + 90) * 2.8).astype(np.uint8).tobytes()).decode("ascii")


def pick_device() -> tuple[str, str]:
    try:
        import ctranslate2  # type: ignore
        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", "float16"
    except Exception as e:  # noqa: BLE001
        log(f"CUDA-Prüfung: {e!r}")
    return "cpu", "int8"


def get_model(name: str, phase: dict, job: dict):
    from faster_whisper import WhisperModel  # type: ignore
    with _model_lock:
        if name in _model_cache:
            return _model_cache[name]
        device, ctype = pick_device()
        phase["text"] = f"Modell „{name}“ wird geladen ({'Grafikkarte' if device == 'cuda' else 'Prozessor'})"
        stop = threading.Event()
        threading.Thread(target=watch_download, args=(job, name, stop, phase), daemon=True).start()
        try:
            try:
                m = WhisperModel(model_ref(MODEL_REPO.get(name, name) if not (MODELS_DIR / name).exists() else name),
                                 device=device, compute_type=ctype, cpu_threads=max(1, os.cpu_count() or 4))
            except Exception as e:  # noqa: BLE001
                log(f"Laden mit {device}/{ctype} fehlgeschlagen: {e!r} – versuche CPU")
                device = "cpu"
                m = WhisperModel(model_ref(name), device="cpu", compute_type="int8")
        finally:
            stop.set()
        _model_cache.clear()
        _model_cache[name] = (m, device)
        _models_cache["v"] = None   # Modell ist jetzt sicher vorhanden
        return _model_cache[name]


def asr_hint(hint) -> str | None:
    """Begriffe aus dem eigenen Wörterbuch als Hinweis für Whisper (hotwords): gilt für jedes Stück der Aufnahme."""
    text = " ".join(str(hint or "").split())[:600]
    return text or None


def whisper_run(model, audio, hot: str | None, **kw):
    """model.transcribe mit Hinweis; ältere Fassungen von faster-whisper kennen ihn nicht und laufen ohne."""
    if hot:
        try:
            return model.transcribe(audio, hotwords=hot, **kw)
        except TypeError:
            log("faster-whisper kennt keine Hinweise (hotwords) – Transkription ohne Wörterbuch-Hinweis")
    return model.transcribe(audio, **kw)


def transcribe_job(job: dict, path: str, model_name: str, language: str | None, fillers: bool, ranges: list | None = None, hint: str | None = None):
    path = norm_path(path)
    info = probe(path)
    duration = info["duration"] or 1
    t0 = time.time()
    phase = {"text": "Vorbereiten"}

    def heartbeat():
        while job["status"] == "running" and not job["cancel"]:
            el = int(time.time() - t0)
            job["message"] = f"{phase['text']} · läuft seit {el // 60}:{el % 60:02d}"
            time.sleep(1)
    threading.Thread(target=heartbeat, daemon=True).start()

    phase["text"] = "Ton wird vorbereitet"
    wav = Path(tempfile.gettempdir()) / f"textschnitt_{uuid.uuid4().hex[:8]}.wav"
    try:
        run_ffmpeg(["-i", path, "-vn", "-af", "aresample=async=1:first_pts=0", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)], duration, job, 0.0, 0.04)
        audio = read_wav16k(wav)
    finally:
        wav.unlink(missing_ok=True)
    env = envelope(audio)
    model, device = get_model(model_name, phase, job)
    if job["cancel"]:
        raise RuntimeError("Abgebrochen")
    if ranges is not None:
        return {"ranges": transcribe_ranges(job, model, device, audio, ranges, language, phase, asr_hint(hint))}
    job["progress"] = 0.05
    phase["text"] = "Transkription startet (die erste Minute dauert am längsten)"
    prompt = FILLER_PROMPT.get(language or "de") if fillers else None
    segments, tinfo = whisper_run(model, audio, asr_hint(hint), language=language or None, word_timestamps=True, initial_prompt=prompt,
                                  beam_size=5 if device == "cuda" else 2, condition_on_previous_text=False, vad_filter=False)
    words = []
    t_tr = time.time()
    for si, seg in enumerate(segments):
        if job["cancel"]:
            raise RuntimeError("Abgebrochen")
        for w in seg.words or []:
            if w.word.strip():
                words.append({"text": w.word, "start": round(w.start, 3), "end": round(w.end, 3), "prob": round(w.probability, 3)})
        frac = min(1.0, seg.end / duration)
        job["progress"] = 0.05 + 0.94 * frac
        el = time.time() - t_tr
        rest = ""
        if frac > 0.02:
            r = int(el / frac - el)
            rest = f" · noch ca. {r // 60}:{r % 60:02d}"
        phase["text"] = f"Transkribiere {fmt_ts(seg.end)[:8]} von {fmt_ts(duration)[:8]}{rest}"
    return {"words": words, "lang": language or getattr(tinfo, "language", None), "env": env, "padded": True}


def transcribe_ranges(job: dict, model, device, audio, ranges: list, language: str | None, phase: dict, hot: str | None = None) -> list:
    """Einzelne Stellen getrennt transkribieren (Lücken, die Whisper im Zusammenhang ausgelassen hat)."""
    out = []
    pad = 0.15
    for n, (a, b) in enumerate(ranges):
        if job["cancel"]:
            raise RuntimeError("Abgebrochen")
        phase["text"] = f"Nicht erkannte Stellen nachhören ({n + 1} von {len(ranges)})"
        job["progress"] = 0.05 + 0.94 * n / max(1, len(ranges))
        s0 = max(0, int((float(a) - pad) * 16000))
        e0 = min(len(audio), int((float(b) + pad) * 16000))
        words = []
        if e0 - s0 >= 3200:
            segs, _ = whisper_run(model, audio[s0:e0], hot, language=language or None, word_timestamps=True,
                                  beam_size=5 if device == "cuda" else 2, condition_on_previous_text=False, vad_filter=False)
            for seg in segs:
                for w in seg.words or []:
                    if w.word.strip():
                        words.append({"text": w.word.strip(), "start": round(w.start + s0 / 16000, 3),
                                      "end": round(w.end + s0 / 16000, 3), "prob": round(w.probability, 3)})
        out.append({"words": words})
    return out


def envelope_job(job: dict, path: str):
    """Nur die Lautstärke-Hüllkurve (für ältere Projekte ohne)."""
    path = norm_path(path)
    info = probe(path)
    job["message"] = "Analysiere Ton …"
    wav = Path(tempfile.gettempdir()) / f"textschnitt_{uuid.uuid4().hex[:8]}.wav"
    try:
        run_ffmpeg(["-i", path, "-vn", "-af", "aresample=async=1:first_pts=0", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)], info["duration"], job)
        return {"env": envelope(read_wav16k(wav)), "astart": info.get("audioStart", 0.0), "padded": True}
    finally:
        wav.unlink(missing_ok=True)


# ───────────────────────────── Zweite Tonquelle angleichen (2.41) ─────────────────────────────
SYNC_SR = 8000          # Abtastrate für den Vergleich der beiden Tonspuren
SYNC_FINE = 0.08        # die Feinmessung sucht ± so viele Sekunden um den groben Versatz
SYNC_DRIFT_MIN = 0.02   # ab dieser Abweichung über die gemeinsame Länge (Sekunden) wird die Geschwindigkeit des Mikrofons angepasst


def _sync_read(path: str, job: dict | None, base: float, span: float):
    """Ton als float32 mit SYNC_SR, mono – ab Beginn der Datei (Zeit 0), wie ihn auch die Transkription liest."""
    import numpy as np
    info = probe(path)
    raw = Path(tempfile.gettempdir()) / f"honeycut_sync_{uuid.uuid4().hex[:8]}.pcm"
    try:
        run_ffmpeg(["-i", path, "-vn", "-af", "aresample=async=1:first_pts=0", "-ac", "1", "-ar", str(SYNC_SR), "-c:a", "pcm_s16le", "-f", "s16le", str(raw)], float(info["duration"] or 1), job, base, span)
        return np.frombuffer(raw.read_bytes(), dtype="<i2").astype(np.float32) / 32768.0
    finally:
        raw.unlink(missing_ok=True)


def sync_measure(cam, mic, sr: int = SYNC_SR) -> dict:
    """Wo liegt die Mikrofon-Aufnahme auf der Zeitachse der Kamera? Rückgabe {offset, drift, score, ratio, overlap, windows}:
    offset – die Zeit 0 des Mikrofons liegt bei dieser Kamerazeit (Sekunden; negativ: das Mikrofon lief schon vorher),
    drift – das Mikrofon läuft je Sekunde um so viel auseinander (Uhren zweier Geräte), score/ratio – wie eindeutig die Stelle ist.

    Grob: Lautstärkeverläufe (10 ms) beider Aufnahmen übereinanderschieben – das verträgt verschiedene Mikrofone, Pegel und Hall.
    Fein: in mehreren Fenstern die Wellenformen selbst vergleichen (GCC-PHAT) und daraus Versatz und Auseinanderlaufen bestimmen."""
    import numpy as np
    hop = sr // 100

    def env(x):
        n = len(x) // hop
        e = np.log((x[: n * hop].reshape(n, hop).astype(np.float64) ** 2).mean(axis=1) + 1e-9)
        k = 200                                               # langsamen Verlauf (2 s) abziehen: Es zählen die Silben, nicht der Pegel
        pad = np.pad(e, (k // 2, k - k // 2 - 1), mode="edge")
        cs = np.cumsum(np.insert(pad, 0, 0.0))
        e = e - (cs[k:] - cs[:-k]) / k
        return np.clip((e - e.mean()) / (e.std() + 1e-9), -3, 3)
    ea, eb = env(cam), env(mic)
    if len(ea) < 100 or len(eb) < 100:
        raise ValueError("Für den Vergleich braucht es mindestens eine Sekunde Ton in beiden Aufnahmen.")
    n = 1 << int(np.ceil(np.log2(len(ea) + len(eb))))
    c = np.fft.irfft(np.fft.rfft(ea, n) * np.conj(np.fft.rfft(eb, n)), n)
    lags = np.concatenate([np.arange(0, len(ea)), np.arange(-(n - len(ea)), 0)])     # Versatz in 10-ms-Schritten zu jedem Feld von c
    ok = (lags > -len(eb)) & (lags < len(ea))
    over = np.where(lags >= 0, np.minimum(len(ea) - lags, len(eb)), np.minimum(len(eb) + lags, len(ea))).astype(np.float64)
    need = max(100.0, 0.1 * min(len(ea), len(eb)))            # mindestens eine Sekunde und ein Zehntel der kürzeren Aufnahme gemeinsam
    ok &= over >= need
    val = np.where(ok, c / np.sqrt(np.maximum(over, 1.0)), -np.inf)
    k0 = int(np.argmax(val))
    lag0 = int(lags[k0])
    fin = val[ok]
    score = float((val[k0] - fin.mean()) / (fin.std() + 1e-9))
    far = ok & (np.abs(lags - lag0) > 50)
    ratio = float(val[k0] / max(1e-9, val[far].max())) if far.any() else 99.0
    overlap = float(over[k0]) / 100.0
    # Feinmessung: Fenster von 4 s über den gemeinsamen Bereich
    a0 = max(0, lag0 * hop)                                   # Beginn des gemeinsamen Bereichs in der Kamera
    b0 = max(0, -lag0 * hop)                                  # … und im Mikrofon
    common = int(min(len(cam) - a0, len(mic) - b0))
    win, m = 4 * sr, int(SYNC_FINE * sr)
    count = int(min(16, max(1, common // win)))
    pts = []
    for q in range(count):
        s = int((common - win) * (q + 0.5) / count) if common > win else 0
        xa, xb = cam[a0 + s: a0 + s + win].astype(np.float64), mic[b0 + s: b0 + s + win].astype(np.float64)
        L = min(len(xa), len(xb))
        if L < sr // 2 or xa[:L].std() < 1e-4 or xb[:L].std() < 1e-4:
            continue
        nf = 1 << int(np.ceil(np.log2(2 * L)))
        X = np.fft.rfft(xa[:L], nf) * np.conj(np.fft.rfft(xb[:L], nf))
        g = np.fft.irfft(X / (np.abs(X) + 1e-9), nf)
        g = np.concatenate([g[-m:], g[: m + 1]])              # Versätze −m … +m
        p = int(np.argmax(g))
        d = float(p - m)
        if 0 < p < len(g) - 1:                                # Scheitel zwischen den Abtastwerten
            y0, y1, y2 = g[p - 1], g[p], g[p + 1]
            den = y0 - 2 * y1 + y2
            if abs(den) > 1e-12:
                d += 0.5 * (y0 - y2) / den
        sharp = float(g[p] / (np.abs(g).mean() + 1e-9))
        if sharp >= 6:
            pts.append(((a0 + s + win / 2) / sr, lag0 * hop / sr + d / sr))
    offset, drift = lag0 * hop / sr, 0.0
    if pts:
        ts, os_ = np.array([p[0] for p in pts]), np.array([p[1] for p in pts])
        if len(pts) >= 4 and ts[-1] - ts[0] >= 30:
            sl = [(os_[j] - os_[i]) / (ts[j] - ts[i]) for i in range(len(pts)) for j in range(i + 1, len(pts)) if ts[j] - ts[i] >= 10]
            drift = float(np.median(sl)) if sl else 0.0       # Theil-Sen: verträgt einzelne Fehlmessungen
            if abs(drift) * overlap < SYNC_DRIFT_MIN or abs(drift) > 0.002:
                drift = 0.0
        offset = float(np.median(os_ - drift * ts)) / (1 - drift)   # Kamerazeit, zu der das Mikrofon beginnt
    return {"offset": round(offset, 5), "drift": round(drift, 8), "score": round(score, 2), "ratio": round(ratio, 3), "overlap": round(overlap, 2), "windows": len(pts), "tried": count}


def sync_ok(m: dict) -> bool:
    """Passt die Stelle eindeutig? Der Lautstärkeverlauf muss klar herausstechen (bei kurzen Aufnahmen genügt ein deutlicher
    Abstand zur zweitbesten Stelle), und die Wellenformen müssen sich in mindestens einem Viertel der Fenster decken."""
    return m["windows"] >= max(1, m["tried"] / 4) and (m["score"] >= 8 or (m["score"] >= 5 and m["ratio"] >= 1.5))


def audio_sync_job(job: dict, path: str, audio: str):
    """Zweite Tonquelle angleichen: misst, wo die Aufnahme des externen Mikrofons zum Ton der Kamera passt, und erzeugt eine Kopie
    des Videos mit dem Ton des Mikrofons an der richtigen Stelle. Das Bild wird dabei unverändert übernommen (ohne neues Kodieren),
    die Bildzeiten bleiben – Transkript und Schnitt gelten weiter."""
    path, audio = norm_path(path), norm_path(audio)
    info, ainfo = probe(path), probe(audio)
    if not info["hasVideo"] or info["kind"] == "image":
        raise ValueError("Der Ton lässt sich nur an ein Video angleichen.")
    if not info["hasAudio"]:
        raise ValueError("Das Video hat keinen eigenen Ton – daran lässt sich die zweite Aufnahme nicht ausrichten.")
    if not ainfo["hasAudio"]:
        raise ValueError("Die gewählte Datei enthält keinen Ton.")
    dur = float(info["duration"] or 0)
    out_dir = DATA_DIR / "mikrofon"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / (hashlib.sha1(f"{path}|{os.path.getmtime(path)}|{audio}|{os.path.getmtime(audio)}".encode("utf-8")).hexdigest()[:16] + ".mp4")
    meta = out.with_suffix(".json")

    def res(m):
        return {**probe(str(out)), "name": Path(path).stem + " – Mikrofon", "orig": path, "mic": Path(audio).name, **m}
    if out.exists() and out.stat().st_size > 0 and meta.exists():
        try:
            return res(json.loads(meta.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            pass
    job["message"] = "Ton der Kamera wird gelesen …"
    cam = _sync_read(path, job, 0.0, 0.15)
    if job["cancel"]:
        raise RuntimeError("Abgebrochen")
    job["message"] = "Ton des Mikrofons wird gelesen …"
    mic = _sync_read(audio, job, 0.15, 0.15)
    if job["cancel"]:
        raise RuntimeError("Abgebrochen")
    job["message"] = "Die beiden Aufnahmen werden verglichen …"
    m = sync_measure(cam, mic)
    del cam, mic
    if not sync_ok(m):
        raise ValueError("Die beiden Aufnahmen passen nicht erkennbar zusammen. Stammen sie vom selben Moment, und ist im Video der Ton der Kamera zu hören?")
    off, drift = m["offset"], m["drift"]
    chain = ["aresample=48000"]
    if drift:
        chain += [f"asetrate={48000 * (1 - drift):.4f}", "aresample=48000"]     # das Mikrofon auf die Uhr der Kamera bringen
    if off > 0:
        chain.append(f"adelay={off * 1000:.3f}:all=1")
    elif off < 0:
        chain += [f"atrim=start={-off:.5f}", "asetpts=PTS-STARTPTS"]
    chain.append("apad")
    tmp_out = out.with_suffix(".tmp.mp4")
    job["message"] = "Das Video bekommt den Ton des Mikrofons …"
    base = ["-i", path, "-i", audio, "-filter_complex", f"[1:a:0]{','.join(chain)}[a]", "-map", "0:v:0", "-map", "[a]", "-t", f"{dur:.3f}"]
    tail = ["-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart", str(tmp_out)]
    try:
        try:
            run_ffmpeg(base + ["-c:v", "copy"] + tail, dur, job, 0.3, 0.7)
            how = "copy"
        except RuntimeError as e:
            if job["cancel"] or "Abgebrochen" in str(e):
                raise
            log(f"Ton angleichen: Bild ließ sich nicht unverändert übernehmen ({e}); wird neu kodiert")
            job["message"] = "Das Video bekommt den Ton des Mikrofons (Bild wird neu kodiert) …"
            run_ffmpeg(base + ["-c:v", "libx264", "-preset", "fast", "-crf", "16", "-pix_fmt", "yuv420p"] + tail, dur, job, 0.3, 0.7)
            how = "encode"
        if job["cancel"]:
            raise RuntimeError("Abgebrochen")
        tmp_out.replace(out)
    finally:
        tmp_out.unlink(missing_ok=True)
    m = {**m, "video": how}
    meta.write_text(json.dumps(m), encoding="utf-8")
    return res(m)


TRACK_W, TRACK_H = 32, 18     # Größe der Masken für „Person im Bild halten“
TRACK_MAX = 2400               # höchstens so viele Masken je Aufnahme


def person_alpha_fn(job: dict, mw: int, mh: int):
    """Liefert eine Funktion Bild (mh × mw × 3, uint8) → Deckkraft der Person (mh × mw, 0…1). Rechnet mit RVM wie das Freistellen;
    jedes Bild für sich, weil zwischen den Bildern hier bis zu eine Sekunde liegt."""
    import numpy as np
    import onnxruntime as ort
    model = matte_model_ensure(job)
    so = ort.SessionOptions()
    so.intra_op_num_threads = max(1, (os.cpu_count() or 4) - 1)
    sess = ort.InferenceSession(str(model), so, providers=["CPUExecutionProvider"])
    dsr = np.array([float(min(1.0, max(0.2, 384 / max(mw, mh))))], np.float32)
    zero = [np.zeros([1, 1, 1, 1], np.float32) for _ in range(4)]

    def alpha(rgb):
        src = np.ascontiguousarray(rgb.reshape(1, mh, mw, 3).transpose(0, 3, 1, 2).astype(np.float32) / 255.0)
        res = sess.run(None, {"src": src, "r1i": zero[0], "r2i": zero[1], "r3i": zero[2], "r4i": zero[3], "downsample_ratio": dsr})
        return np.clip(res[1][0, 0], 0, 1)
    return alpha


def person_track_job(job: dict, path: str):
    """Person im Bild halten (2.39): in festen Abständen ein verkleinertes Bild lesen, die Person erkennen und ihre Maske auf
    TRACK_W × TRACK_H Felder mitteln. Aus den Masken rechnet die Oberfläche den Kameraweg (core/web/folgen.js).
    Ergebnis: {step, w, h, n, data} – data ist Base64 mit n·w·h Bytes (0 … 255)."""
    import numpy as np
    path = norm_path(path)
    info = probe(path)
    if not info["hasVideo"] or info["kind"] == "image":
        raise ValueError("Die Person lässt sich nur in Videos verfolgen.")
    W, H, dur = int(info["width"]), int(info["height"]), float(info["duration"] or 0)
    if dur <= 0 or W < 2 or H < 2:
        raise ValueError("Das Video ließ sich nicht lesen.")
    step = max(0.25, math.ceil(dur / TRACK_MAX * 20) / 20)     # 0,25 s; bei langen Aufnahmen gröber (höchstens TRACK_MAX Masken)
    k = min(1.0, 384 / max(W, H))
    mw, mh = max(32, int(W * k) // 2 * 2), max(32, int(H * k) // 2 * 2)
    job["message"] = "Person wird gesucht …"
    alpha = person_alpha_fn(job, mw, mh)
    dec = subprocess.Popen([FFMPEG, "-v", "error", "-nostdin", "-i", path, "-vf", f"fps=1/{step:.2f},scale={mw}:{mh}", "-an",
                            "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, **NOWIN)
    # Felder: Mittel über gleich große Bereiche
    ys = [round(i * mh / TRACK_H) for i in range(TRACK_H + 1)]
    xs = [round(i * mw / TRACK_W) for i in range(TRACK_W + 1)]
    out, n, nbytes = bytearray(), 0, mw * mh * 3
    total = max(1, int(dur / step) + 1)
    try:
        while True:
            buf = dec.stdout.read(nbytes)
            if len(buf) < nbytes:
                break
            a = np.asarray(alpha(np.frombuffer(buf, np.uint8).reshape(mh, mw, 3)), dtype=np.float32)
            rows = np.add.reduceat(a, ys[:-1], axis=0)
            cells = np.add.reduceat(rows, xs[:-1], axis=1)
            area = np.outer(np.diff(ys), np.diff(xs)).astype(np.float32)
            out += np.clip(np.round(cells / np.maximum(area, 1) * 255), 0, 255).astype(np.uint8).tobytes()
            n += 1
            job["progress"] = min(0.99, n / total)
            if n % 8 == 0:
                job["message"] = f"Person wird gesucht … {n * step:.0f} von {dur:.0f} s"
            if job["cancel"]:
                raise RuntimeError("Abgebrochen")
    finally:
        try:
            dec.stdout.close()
            dec.kill()
            dec.wait(timeout=15)
        except Exception:
            pass
    if n == 0:
        raise RuntimeError("Aus dem Video ließen sich keine Bilder lesen.")
    return {"step": round(step, 2), "w": TRACK_W, "h": TRACK_H, "n": n, "data": base64.b64encode(bytes(out)).decode("ascii")}


VOICE_PCM: dict = {}   # Job-Kennung → Datei mit dem Ton für das Trennen der Stimmen (wird nach dem Abholen gelöscht)


def voice_pcm_job(job: dict, path: str):
    """Ton einer Aufnahme als 16 kHz, mono, 16 Bit – so, wie ihn auch die Transkription liest. Die Oberfläche holt die
    Datei über api/pcm ab und trennt damit die Stimmen (core/web/stimmen.js)."""
    path = norm_path(path)
    info = probe(path)
    job["message"] = "Ton wird gelesen …"
    for old, f in list(VOICE_PCM.items()):          # liegen gebliebene Dateien früherer Läufe
        if old not in JOBS or time.time() - JOBS[old].get("started", 0) > 3600:
            Path(f).unlink(missing_ok=True)
            VOICE_PCM.pop(old, None)
    out = Path(tempfile.gettempdir()) / f"honeycut_stimmen_{job['id']}.pcm"
    try:
        run_ffmpeg(["-i", path, "-vn", "-af", "aresample=async=1:first_pts=0", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", "-f", "s16le", str(out)], info["duration"], job)
    except BaseException:
        out.unlink(missing_ok=True)
        raise
    VOICE_PCM[job["id"]] = out
    return {"url": "api/pcm?id=" + job["id"], "bytes": out.stat().st_size}


# ───────────────────────────── Mehrere Fenster: Nachrichten zwischen den Fenstern ─────────────────────────────

BUS: dict[str, dict] = {}
_bus_lock = threading.Lock()
BUS_ALIVE = 180.0   # so lange gilt ein Fenster nach seiner letzten Abfrage als offen. Großzügig, weil verdeckte oder minimierte
                    # Fenster ihre Zeitgeber stark drosseln (bis auf eine Abfrage je Minute). Wer schließt, meldet sich ab.


def _bus_peers(b: dict, sender: str, now: float) -> int:
    return sum(1 for w, t in b["seen"].items() if w != sender and now - t < BUS_ALIVE)


def bus_post(pid: str, sender: str, msg: str, kind: str = ""):
    """Nachricht für die anderen Fenster desselben Projekts. Hört keines zu, wird nichts aufbewahrt – früher sammelte
    sich hier bei jeder Änderung ein kompletter Projektstand an (bis zu 300 Stück je Projekt, über Stunden viele MB).
    Von Stand und Abspielposition zählt je Fenster nur die neueste Meldung: Sie ersetzt die vorige, statt sich dahinter
    einzureihen. So bekommt auch ein Fenster, das eine Weile nicht nachgefragt hat, sicher den letzten Stand."""
    with _bus_lock:
        b = BUS.setdefault(pid, {"seq": 0, "msgs": [], "seen": {}, "joins": 0})
        b["seq"] += 1
        if not _bus_peers(b, sender, time.time()):
            return
        if kind in ("state", "pos"):
            b["msgs"] = [m for m in b["msgs"] if not (m[1] == sender and m[3] == kind)]
        b["msgs"].append((b["seq"], sender, msg, kind))
        del b["msgs"][:-60]


def bus_bye(pid: str, sender: str):
    with _bus_lock:
        b = BUS.get(pid)
        if b:
            b["seen"].pop(sender, None)
            if not b["seen"]:
                del BUS[pid]


def bus_get(pid: str, since: int, sender: str) -> dict:
    now = time.time()
    with _bus_lock:
        for k in [k for k, v in BUS.items() if k != pid and (not v["seen"] or now - max(v["seen"].values()) > BUS_ALIVE)]:
            del BUS[k]   # Projekte, die niemand mehr offen hat
        b = BUS.setdefault(pid, {"seq": 0, "msgs": [], "seen": {}, "joins": 0})
        for w in [w for w, t in b["seen"].items() if now - t >= BUS_ALIVE]:
            del b["seen"][w]
        new = sender not in b["seen"]   # dieses Fenster ist gerade dazugekommen (oder nach langer Pause zurück)
        if new:
            b["joins"] += 1
        b["seen"][sender] = now
        peers = _bus_peers(b, sender, now)
        # „joins“ zählt, wie oft ein Fenster dazugekommen ist: Steigt die Zahl, schicken die übrigen Fenster dem neuen ihren
        # Stand (es selbst erkennt sich an „new“ und schickt nichts – sein Stand ist der ältere).
        msgs = [] if since < 0 else [m[2] for m in b["msgs"] if m[0] > since and m[1] != sender]
        return {"seq": b["seq"], "msgs": msgs, "peers": peers, "joins": b["joins"], "new": new}


VIEW_LBL = {"text": "Text", "subs": "Untertitel", "studio": "Studio", "export": "Export"}


def proxy_job(job: dict, path: str):
    path = norm_path(path)
    info = probe(path)
    out = CACHE_DIR / "proxies" / (hashlib.sha1(path.encode("utf-8")).hexdigest()[:16] + ".mp4")
    tmp = out.with_suffix(".tmp.mp4")   # erst fertigstellen, dann umbenennen – ein Abbruch hinterlässt keine halbe Vorschau-Datei
    job["message"] = "Erstelle Vorschau-Datei …"
    try:
        run_ffmpeg(["-i", path, "-vf", "scale=-2:'min(720,ih)'", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
                    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(tmp)], info["duration"], job)
        replace_retry(tmp, out)
    finally:
        try:
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
    return {"path": allow(out)}


# ───────────────────────────── Automatisch freistellen (Person vom Hintergrund trennen) ─────────────────────────────

MATTE_MODEL = "rvm_mobilenetv3_fp32.onnx"   # Robust Video Matting (Lin et al.), MobileNetV3, ca. 15 MB
MATTE_URL = "https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/" + MATTE_MODEL
MATTE_BG = "00ff00"   # einheitliche Schlüsselfarbe im Ergebnis – wird danach wie ein Greenscreen entfernt


# ───────────────────────────── Bild beruhigen (E11) ─────────────────────────────
# Gleicht Wackeln aus der Hand aus: zwei Durchgänge mit „vidstab“ (Bewegung messen, dann gegenrechnen); fehlt der Filter im
# mitgelieferten ffmpeg, übernimmt das einfachere „deshake“. Das Ergebnis ist eine Kopie mit denselben Bildzeiten und demselben
# Ton – Transkript und Schnitt gelten weiter. Der Rand wird leicht beschnitten (fester Zoom), damit keine Kanten ins Bild wandern.
STAB_LEVELS = {1: (4, 8), 2: (6, 16), 3: (8, 30)}   # Stufe → (shakiness, smoothing)
_stab_method: list = []


def stab_method() -> str:
    if not _stab_method:
        try:
            out = subprocess.run([FFMPEG, "-hide_banner", "-filters"], capture_output=True, text=True, timeout=20, **NOWIN).stdout
        except Exception:
            out = ""
        _stab_method.append("vidstab" if "vidstabdetect" in out and "vidstabtransform" in out else "deshake")
    return _stab_method[0]


def stabilize_job(job: dict, path: str, level=2):
    path = norm_path(path)
    info = probe(path)
    if not info["hasVideo"] or info["kind"] == "image":
        raise ValueError("Beruhigen geht nur mit Videos.")
    try:
        level = min(3, max(1, int(level)))
    except (TypeError, ValueError):
        level = 2
    method = stab_method()
    out_dir = DATA_DIR / "beruhigt"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / (hashlib.sha1(f"{path}|{os.path.getmtime(path)}|stab{level}|{method}".encode("utf-8")).hexdigest()[:16] + ".mp4")
    res = lambda: {**probe(str(out)), "name": Path(path).stem + " – beruhigt", "orig": path, "method": method, "level": level}  # noqa: E731
    if out.exists() and out.stat().st_size > 0:
        return res()
    dur = float(info["duration"] or 1)
    shak, smooth = STAB_LEVELS[level]
    tmp_out, trf = out.with_suffix(".tmp.mp4"), out_dir / (out.stem + ".trf")
    try:
        if method == "vidstab":
            job["message"] = "Bewegung wird gemessen …"
            # Die Messdatei liegt im Arbeitsordner und wird nur mit ihrem Namen genannt – Pfade mit Doppelpunkt (C:\…) vertragen die Filter nicht
            run_ffmpeg(["-i", path, "-map", "0:v:0", "-vf", f"vidstabdetect=shakiness={shak}:accuracy=15:result={trf.name}", "-an", "-f", "null", "-"], dur, job, 0.0, 0.4, cwd=out_dir)
            if job["cancel"]:
                raise RuntimeError("Abgebrochen")
            vf = f"vidstabtransform=input={trf.name}:smoothing={smooth}:optzoom=1:interpol=bicubic:crop=black,format=yuv420p"
            base, span = 0.4, 0.6
        else:
            vf = f"deshake=rx={16 * level}:ry={16 * level}:edge=mirror,format=yuv420p"
            base, span = 0.0, 1.0
        job["message"] = "Bild wird beruhigt …"
        run_ffmpeg(["-i", path, "-map", "0:v:0"] + (["-map", "0:a:0", "-c:a", "aac", "-b:a", "192k"] if info["hasAudio"] else []) +
                   ["-vf", vf, "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-movflags", "+faststart", tmp_out.name], dur, job, base, span, cwd=out_dir)
        if job["cancel"]:
            raise RuntimeError("Abgebrochen")
        tmp_out.replace(out)
    finally:
        for x in (tmp_out, trf):
            try:
                x.unlink(missing_ok=True)
            except OSError:
                pass
    log(f"Bild beruhigt ({method}, Stufe {level}): {Path(path).name}")
    return res()


def matte_model_path() -> Path | None:
    for d in (MODELS_DIR, DATA_DIR / "models"):
        if (d / MATTE_MODEL).exists():
            return d / MATTE_MODEL
    return None


def matte_available() -> bool:
    try:
        import onnxruntime  # noqa: F401
        import numpy  # noqa: F401
        return True
    except Exception:
        return False


def matte_model_ensure(job: dict) -> Path:
    """Das Modell zum Erkennen der Person (RVM): mitgeliefert, schon geladen oder jetzt einmalig laden."""
    model = matte_model_path()
    if model is not None:
        return model
    job["message"] = "Lade Modell zum Freistellen (einmalig, ca. 15 MB) …"
    import urllib.request
    dst = DATA_DIR / "models" / MATTE_MODEL
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_suffix(".part")
    try:
        with urllib.request.urlopen(MATTE_URL, timeout=60) as r, open(tmp, "wb") as f:
            total = int(r.headers.get("Content-Length") or 0)
            got = 0
            while True:
                chunk = r.read(1 << 20)
                if not chunk:
                    break
                f.write(chunk)
                got += len(chunk)
                if total:
                    job["message"] = f"Lade Modell zum Freistellen (einmalig): {got / 1e6:.0f} von {total / 1e6:.0f} MB"
                if job["cancel"]:
                    raise RuntimeError("Abgebrochen")
        if total and got != total:
            raise RuntimeError("Das Modell zum Freistellen wurde nicht vollständig geladen – bitte noch einmal versuchen.")
        tmp.replace(dst)
    finally:
        try:
            tmp.unlink(missing_ok=True)   # nach Abbruch oder Fehler kein halbes Modell liegen lassen
        except OSError:
            pass
    model = dst
    return model


def matte_job(job: dict, path: str):
    """Erzeugt eine Kopie des Videos, in der alles außer der Person in der Schlüsselfarbe (Grün) steht.
    Die Alphamaske rechnet RVM in verkleinerter Auflösung; zusammengesetzt wird in voller Größe mit ffmpeg."""
    import numpy as np
    import onnxruntime as ort
    path = norm_path(path)
    info = probe(path)
    if not info["hasVideo"] or info["kind"] == "image":
        raise ValueError("Freistellen geht nur mit Videos.")
    out_dir = DATA_DIR / "freigestellt"
    out_dir.mkdir(parents=True, exist_ok=True)
    out = out_dir / (hashlib.sha1(f"{path}|{os.path.getmtime(path)}".encode("utf-8")).hexdigest()[:16] + ".mp4")
    if out.exists() and out.stat().st_size > 0:
        return {**probe(str(out)), "name": Path(path).stem + " – freigestellt", "orig": path}
    model = matte_model_ensure(job)
    W, H, fps, dur = info["width"], info["height"], float(info["fps"]), float(info["duration"])
    # Modellauflösung: höchstens 960 px Kante; downsample_ratio so, dass das grobe Netz um 384 px rechnet
    k = min(1.0, 960 / max(W, H))
    mw, mh = max(2, int(W * k) // 2 * 2), max(2, int(H * k) // 2 * 2)
    ratio = float(min(1.0, max(0.2, 384 / max(mw, mh))))
    fps_s = f"{fps:.3f}".rstrip("0").rstrip(".")
    so = ort.SessionOptions()
    so.intra_op_num_threads = max(1, (os.cpu_count() or 4) - 1)
    sess = ort.InferenceSession(str(model), so, providers=["CPUExecutionProvider"])
    job["message"] = "Person wird erkannt und freigestellt …"
    dec = subprocess.Popen([FFMPEG, "-v", "error", "-nostdin", "-i", path, "-vf", f"fps={fps_s},scale={mw}:{mh}", "-an",
                            "-f", "rawvideo", "-pix_fmt", "rgb24", "pipe:1"], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, **NOWIN)
    tmp_out = out.with_suffix(".tmp.mp4")
    enc_args = [FFMPEG, "-v", "error", "-y", "-i", path, "-f", "rawvideo", "-pix_fmt", "gray", "-s", f"{mw}x{mh}", "-framerate", fps_s, "-i", "pipe:0",
                "-filter_complex", f"[0:v]fps={fps_s}[v];[1:v]scale={W}:{H}:flags=bicubic[a];[v][a]alphamerge[fg];"
                                   f"color=c=0x{MATTE_BG}:s={W}x{H}:r={fps_s}[bg];[bg][fg]overlay=shortest=1:format=auto,format=yuv420p[out]",
                "-map", "[out]"] + (["-map", "0:a:0", "-c:a", "aac", "-b:a", "192k"] if info["hasAudio"] else []) + \
               ["-c:v", "libx264", "-preset", "fast", "-crf", "16", "-movflags", "+faststart", "-shortest", str(tmp_out)]
    enc = subprocess.Popen(enc_args, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, **NOWIN)
    rec = [np.zeros([1, 1, 1, 1], np.float32) for _ in range(4)]
    dsr = np.array([ratio], np.float32)
    n, nbytes = 0, mw * mh * 3
    t0 = time.time()
    try:
        while True:
            buf = dec.stdout.read(nbytes)
            if len(buf) < nbytes:
                break
            src = np.frombuffer(buf, np.uint8).reshape(1, mh, mw, 3).transpose(0, 3, 1, 2).astype(np.float32) / 255.0
            fgr, pha, *rec = sess.run(None, {"src": np.ascontiguousarray(src), "r1i": rec[0], "r2i": rec[1], "r3i": rec[2], "r4i": rec[3], "downsample_ratio": dsr})
            enc.stdin.write((np.clip(pha[0, 0], 0, 1) * 255).astype(np.uint8).tobytes())
            n += 1
            if n % 5 == 0:
                done = n / fps
                job["progress"] = min(0.99, done / max(0.1, dur))
                left = (time.time() - t0) / n * max(0.0, dur * fps - n)
                job["message"] = f"Person wird freigestellt … {done:.0f} von {dur:.0f} s (noch etwa {left / 60:.0f} min)" if left > 90 else f"Person wird freigestellt … {done:.0f} von {dur:.0f} s"
            if job["cancel"]:
                raise RuntimeError("Abgebrochen")
    except BaseException as e:
        # Abbruch oder Fehler: beide ffmpeg-Prozesse beenden und das angefangene Ergebnis entfernen (sonst blieben
        # nach jedem Abbruch mehrere hundert MB liegen)
        detail = ""
        for proc in (dec, enc):
            try:
                proc.kill()
            except Exception:
                pass
        try:
            detail = enc.stderr.read().decode("utf-8", "replace").strip()[-300:]
            enc.wait(timeout=15)
        except Exception:
            pass
        try:
            tmp_out.unlink(missing_ok=True)
        except OSError:
            pass
        if isinstance(e, OSError) and not job["cancel"]:   # z. B. „Broken pipe“: der eigentliche Grund steht in der ffmpeg-Ausgabe
            raise RuntimeError("Freistellen fehlgeschlagen: " + (detail or str(e))) from e
        raise
    finally:
        try:
            dec.stdout.close()
            dec.terminate()
        except Exception:
            pass
        try:
            enc.stdin.close()
        except Exception:
            pass
    err = enc.stderr.read().decode("utf-8", "replace")
    if enc.wait() != 0 or not tmp_out.exists():
        try:
            tmp_out.unlink(missing_ok=True)
        except OSError:
            pass
        raise RuntimeError("Freistellen fehlgeschlagen: " + err.strip()[-300:])
    tmp_out.replace(out)
    log(f"Freigestellt: {path} → {out} ({n} Bilder, {time.time() - t0:.0f} s)")
    return {**probe(str(out)), "name": Path(path).stem + " – freigestellt", "orig": path}


# ───────────────────────────── Übersetzen (Untertitel) ─────────────────────────────
# OPUS-MT (Helsinki-NLP), mit CTranslate2 auf int8 umgewandelt und im Installer enthalten (Ordner models/opus-mt-<von>-<nach>).
# Läuft ganz auf dem Rechner. Weitere Sprachpaare: Ordner gleichen Namens danebenlegen.

def translate_model_dir(src: str, tgt: str) -> Path | None:
    name = f"opus-mt-{src}-{tgt}"
    for d in (MODELS_DIR, DATA_DIR / "models"):
        if (d / name / "model.bin").exists() and (d / name / "source.spm").exists():
            return d / name
    return None


def translate_pairs() -> list[str]:
    out = []
    for d in (MODELS_DIR, DATA_DIR / "models"):
        if d.exists():
            out += [p.name[8:] for p in d.glob("opus-mt-*") if (p / "model.bin").exists()]
    return sorted(set(out))


def translate_available() -> bool:
    try:
        import ctranslate2  # noqa: F401
        import sentencepiece  # noqa: F401
    except Exception:
        return False
    return bool(translate_pairs())


_tr_cache: dict = {}


def translate_job(job: dict, texts: list, src: str, tgt: str):
    import ctranslate2
    import sentencepiece as spm
    src, tgt = (src or "de").lower()[:2], (tgt or "en").lower()[:2]
    if src == tgt:
        return {"texts": list(texts)}
    d = translate_model_dir(src, tgt)
    if d is None:
        raise ValueError(f"Für {src.upper()} → {tgt.upper()} ist noch kein Übersetzungsmodell enthalten (vorhanden: {', '.join(translate_pairs()) or 'keins'}).")
    key = str(d)
    if key not in _tr_cache:
        job["message"] = "Übersetzung wird vorbereitet …"
        _tr_cache[key] = (ctranslate2.Translator(str(d), device="cpu", compute_type="int8", inter_threads=1, intra_threads=max(1, (os.cpu_count() or 4) - 1)),
                          spm.SentencePieceProcessor(model_file=str(d / "source.spm")),
                          spm.SentencePieceProcessor(model_file=str(d / "target.spm")))
    tr, sp_s, sp_t = _tr_cache[key]
    out = []
    n = len(texts)
    for i in range(0, n, 16):
        if job["cancel"]:
            raise RuntimeError("Abgebrochen")
        batch = [str(t or "").strip() for t in texts[i:i + 16]]
        toks = [sp_s.encode(t, out_type=str) + ["</s>"] if t else ["</s>"] for t in batch]
        res = tr.translate_batch(toks, beam_size=4, max_decoding_length=256)
        for t, r in zip(batch, res):
            hyp = [x for x in r.hypotheses[0] if x not in ("</s>", "<pad>")]
            out.append(sp_t.decode(hyp).strip() if t else "")
        job["progress"] = min(0.99, len(out) / max(1, n))
        job["message"] = f"Übersetze … {len(out)} von {n}"
    return {"texts": out}


# ───────────────────────────── Vorschaubilder ─────────────────────────────

_thumb_sem = threading.Semaphore(3)


def thumb(path: str, t: float, h: int) -> Path | None:
    path = norm_path(path)
    try:
        mt = os.path.getmtime(path)
    except OSError:
        return None
    key = hashlib.sha1(f"{path}|{mt}|{t:.1f}|{h}".encode("utf-8")).hexdigest()
    out = CACHE_DIR / "thumbs" / f"{key}.jpg"
    try:
        age = time.time() - out.stat().st_mtime
        if age > 86400:   # gebraucht: Zeitstempel auffrischen, damit das Aufräumen nur wirklich Ungenutztes entfernt
            os.utime(out)
        return out
    except OSError:
        pass
    info = probe(path)
    if not info["hasVideo"]:
        return None
    with _thumb_sem:
        if out.exists():
            return out
        tmp = out.with_suffix(".tmp.jpg")
        seek = [] if info["kind"] == "image" else ["-ss", f"{max(0.0, min(t, info['duration'] - 0.05)):.2f}"]
        try:
            subprocess.run([FFMPEG, "-v", "error", "-y", "-nostdin"] + seek + ["-i", path, "-frames:v", "1", "-vf", f"scale=-2:{h}",
                            "-q:v", "6", str(tmp)], capture_output=True, stdin=subprocess.DEVNULL, timeout=25, **NOWIN)
        except subprocess.TimeoutExpired:
            # Datei hängt (z. B. Cloud-Ordner, der erst geladen werden muss): aufgeben statt alle weiteren Vorschaubilder zu blockieren
            log(f"Vorschaubild abgebrochen (25 s ohne Ergebnis): {Path(path).name} bei {t:.1f} s")
        try:
            if tmp.exists() and tmp.stat().st_size:
                tmp.replace(out)
                return out
            tmp.unlink(missing_ok=True)
        except OSError:
            pass
    return None


# ───────────────────────────── Export: Untertitel-Dateien ─────────────────────────────

SUB_SIZES = {"klein": 0.045, "mittel": 0.058, "groß": 0.075}


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = (h or "#FFFFFF").lstrip("#")
    if len(h) != 6:
        h = "FFFFFF"
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


SUB_ANIMS = ("fade", "pop")
SUB_ANIM_S = 0.16   # Dauer von Einblenden und Aufpoppen


def clean_fx(c: dict, n_words: int) -> dict:
    """Untertitel-Effekte (2.32), bezogen auf die Wörter des Textes in ihrer Reihenfolge:
    words = [[Beginn, Ende], …] in Ausgabezeit für die ersten Wörter; hl = Farbe des gerade gesprochenen Worts;
    build = Wörter erscheinen erst, wenn sie gesprochen werden; spans = [[Wortnummer, Farbe], …] für betonte Wörter;
    anim = fade | pop beim Erscheinen. Unbrauchbare Angaben fallen weg."""
    o: dict = {}
    col = lambda v: str(v) if isinstance(v, str) and re.fullmatch(r"#[0-9a-fA-F]{6}", v) else None   # noqa: E731
    try:
        ws = [[float(a), float(b)] for a, b in (c.get("words") or [])][:n_words]
    except (TypeError, ValueError):
        ws = []
    if ws and all(b >= a for a, b in ws):
        if col(c.get("hl")):
            o["hl"] = col(c.get("hl"))
        if c.get("build"):
            o["build"] = True
        if "hl" in o or "build" in o:
            o["words"] = ws
    spans = []
    for s in c.get("spans") or []:
        try:
            k, v = int(s[0]), col(s[1])
        except (TypeError, ValueError, IndexError):
            continue
        if 0 <= k < n_words and v:
            spans.append([k, v])
    if spans:
        o["spans"] = spans
    if c.get("anim") in SUB_ANIMS:
        o["anim"] = c["anim"]
    return o


def cue_has_fx(c: dict) -> bool:
    return any(k in c for k in ("words", "spans", "anim"))


def fx_state(c: dict, t: float, n_words: int) -> list:
    """Farbe je Wort zum Zeitpunkt t: None = Grundfarbe, "" = noch verborgen, sonst #rrggbb."""
    ws, hl, build = c.get("words") or [], c.get("hl"), bool(c.get("build"))
    spans = {k: v for k, v in c.get("spans") or []}
    out = []
    for k in range(n_words):
        v = spans.get(k)
        if k < len(ws):
            if build and t < ws[k][0] - 1e-6:
                v = ""
            elif hl and ws[k][0] - 1e-6 <= t < ws[k][1] - 1e-6:
                v = hl
        out.append(v)
    return out


def fx_slices(c: dict) -> list[tuple[float, float]]:
    """Zeitabschnitte eines Untertitels, in denen sich an den Wörtern nichts ändert. Wechsel, die in die Dauer der
    Animation am Anfang fielen, rücken an deren Ende – so läuft die Animation in einem Stück."""
    s, e = c["start"], c["end"]
    cuts = {s, e}
    if c.get("hl") or c.get("build"):
        for a, b in c.get("words") or []:
            for t in ((a, b) if c.get("hl") else (a,)):
                if s < t < e:
                    cuts.add(t)
    lead = s + SUB_ANIM_S if c.get("anim") else s
    pts = sorted({(min(lead, e) if s < t < lead else t) for t in cuts})
    pts = [t for k, t in enumerate(pts) if k == 0 or t - pts[k - 1] > 0.011 or t == e]
    if len(pts) > 1 and pts[-1] - pts[-2] <= 0.011 and len(pts) > 2:
        pts.pop(-2)
    return [(a, b) for a, b in zip(pts, pts[1:]) if b - a > 0.005]


def clean_cues(raw) -> list[dict]:
    cues = []
    for c in raw or []:
        try:
            s, e, txt = float(c["start"]), float(c["end"]), str(c["text"]).strip()
        except (KeyError, TypeError, ValueError):
            continue
        if txt and e - s > 0.05:
            o = {"start": max(0.0, s), "end": e, "text": txt.replace("\r", ""),
                 "x": float(c.get("x", 0.5) if c.get("x") is not None else 0.5),
                 "y": float(c.get("y", 0.88) if c.get("y") is not None else 0.88),
                 "size": float(c["size"]) if c.get("size") else None, "color": c.get("color"),
                 "outline": c.get("outline"), "bg": bool(c.get("bg")), "title": bool(c.get("title"))}
            # Schrift nur übernehmen, wenn der Untertitel eine eigene hat (Titel, Person, Übersetzung). Früher stand hier
            # immer ein (leerer) Eintrag – damit galt jeder Untertitel als „eigene Schrift: Standard“, und die im Stil
            # gewählte Schrift kam im eingebrannten Video nie an.
            if "font" in c and c["font"] is not None:
                o["font"] = str(c["font"])
            if c.get("outlineColor"):
                o["outlineColor"] = str(c["outlineColor"])
            # Dauerhafte Textzeile: sitzt an einer Ecke (anchor = o/u + l/m/r) mit Randabstand mx/my als Anteil von Breite/Höhe
            fx = clean_fx(c, len(o["text"].split()))
            if fx:
                o.update(fx)
            if c.get("src"):   # Quellenzeile: wie die Textzeile an einer Ecke, auf einer eigenen Textspur
                o["src"] = True
            if c.get("line"):
                o["line"] = True
                a = str(c.get("anchor") or "")
                if len(a) == 2 and a[0] in "ou" and a[1] in "lmr":
                    try:
                        o.update(anchor=a, mx=min(0.5, max(0.0, float(c.get("mx") or 0))), my=min(0.5, max(0.0, float(c.get("my") or 0))))
                    except (TypeError, ValueError):
                        pass
            cues.append(o)
    cues.sort(key=lambda c: c["start"])
    return cues


def spoken_cues(cues: list[dict]) -> list[dict]:
    """Nur die Untertitel – ohne Titel und Textzeile, die zum Bild gehören."""
    return [c for c in cues if not c.get("title")]


def write_srt(cues: list[dict], out: Path):
    lines = []
    for n, c in enumerate(cues, 1):
        lines += [str(n), f"{fmt_ts(c['start'])} --> {fmt_ts(c['end'])}", c["text"], ""]
    out.write_text("\n".join(lines), encoding="utf-8")


def sub_px(style: dict, w: int, h: int) -> float:
    return SUB_SIZES.get(style.get("size", "mittel"), 0.058) * min(w, h) * (1.25 if h > w else 1.0)


class FontFace:
    """Was der Export über eine Schriftdatei (TTF/OTF) wissen muss: Namen, Strichstärke, Höhenmaße und Laufweiten.

    libass sucht eine Schrift unter dem Familiennamen, der in der Datei steht, und rechnet die Schriftgröße auf die Zellenhöhe
    um (OS/2 winAscent + winDescent). Die Vorschau im Programmfenster rechnet wie jeder Browser mit dem Geviert. Ohne
    Umrechnung stand eine gewählte Schrift deshalb deutlich kleiner im Video als in der Vorschau (Poppins: 57 %)."""

    def __init__(self, data: bytes):
        import struct
        u = struct.unpack
        self.data = data
        tabs = {}
        for i in range(u(">H", data[4:6])[0]):
            tag, _cs, off, ln = u(">4sIII", data[12 + 16 * i:28 + 16 * i])
            tabs[tag] = (off, ln)
        names = {}
        if b"name" in tabs:
            off, _ = tabs[b"name"]
            _fmt, cnt, so = u(">HHH", data[off:off + 6])
            for i in range(cnt):
                pid, _eid, lid, nid, ln, o = u(">HHHHHH", data[off + 6 + 12 * i:off + 18 + 12 * i])
                if nid not in (1, 2, 6, 16, 17):
                    continue
                raw = data[off + so + o:off + so + o + ln]
                try:
                    txt = raw.decode("utf-16-be") if pid in (0, 3) else raw.decode("mac_roman")
                except Exception:  # noqa: BLE001
                    continue
                pri = 2 if (pid == 3 and lid == 0x409) else 1 if pid in (0, 3) else 0
                if nid not in names or pri > names[nid][1]:
                    names[nid] = (txt.strip(), pri)
        self.family = names.get(1, ("", 0))[0]
        self.ps = names.get(6, ("", 0))[0]          # PostScript-Name: daran erkennt der Export, welche Datei libass genommen hat
        sub = names.get(2, ("", 0))[0].lower()
        upm = u(">H", data[tabs[b"head"][0] + 18:tabs[b"head"][0] + 20])[0] if b"head" in tabs else 0
        self.upm = upm or 1000
        h_asc = h_desc = n_h = 0
        if b"hhea" in tabs:
            o = tabs[b"hhea"][0]
            h_asc, h_desc = u(">hh", data[o + 4:o + 8])
            n_h = u(">H", data[o + 34:o + 36])[0]
        weight, fs_sel, t_asc, t_desc, w_asc, w_desc = 400, 0, 0, 0, 0, 0
        if b"OS/2" in tabs:
            o, ln = tabs[b"OS/2"]
            weight = u(">H", data[o + 4:o + 6])[0]
            if ln >= 78:
                fs_sel = u(">H", data[o + 62:o + 64])[0]
                t_asc, t_desc, _gap, w_asc, w_desc = u(">hhhHH", data[o + 68:o + 78])
        self.bold = ("bold" in sub) or (weight >= 600 and sub in ("", "regular"))
        k = float(self.upm)
        # Zelle, auf die libass die Schriftgröße bezieht (wie GDI): win-Werte, ersatzweise hhea
        self.cell = (w_asc / k, w_desc / k) if w_asc + w_desc > 0 else (h_asc / k, -h_desc / k)
        # Ober- und Unterlänge, mit denen der Browser der Vorschau die Zeile setzt: die Typo-Werte, wenn die Schrift das verlangt;
        # sonst unter Windows (WebView2) die win-Werte, überall sonst hhea
        if fs_sel & 0x80 and t_asc - t_desc > 0:
            self.css = (t_asc / k, -t_desc / k)
        elif os.name == "nt" and w_asc + w_desc > 0:
            self.css = (w_asc / k, w_desc / k)
        elif h_asc - h_desc > 0:
            self.css = (h_asc / k, -h_desc / k)
        else:
            self.css = self.cell
        self.ok = self.cell[0] + self.cell[1] > 0.2 and b"hmtx" in tabs and b"cmap" in tabs and n_h > 0
        self._hmtx, self._nh = (tabs[b"hmtx"][0] if b"hmtx" in tabs else 0), n_h
        self._cmap = None        # (Format, Anfang der Untertabelle)
        if b"cmap" in tabs:
            off, _ = tabs[b"cmap"]
            best = -1
            for i in range(u(">H", data[off + 2:off + 4])[0]):
                pid, eid, so = u(">HHI", data[off + 4 + 8 * i:off + 12 + 8 * i])
                fmt = u(">H", data[off + so:off + so + 2])[0]
                rank = 3 if fmt == 12 and (pid, eid) in ((3, 10), (0, 4), (0, 6)) else 2 if fmt == 4 and (pid, eid) == (3, 1) else 1 if fmt == 4 and pid == 0 else -1
                if rank > best:
                    best, self._cmap = rank, (fmt, off + so)
        self._adv: dict[str, float] = {}

    def _glyph(self, cp: int) -> int:
        import struct
        u, d = struct.unpack, self.data
        if not self._cmap:
            return 0
        fmt, o = self._cmap
        if fmt == 12:
            n = u(">I", d[o + 12:o + 16])[0]
            lo, hi = 0, n - 1
            while lo <= hi:
                m = (lo + hi) // 2
                a, e, g = u(">III", d[o + 16 + 12 * m:o + 28 + 12 * m])
                if cp < a:
                    hi = m - 1
                elif cp > e:
                    lo = m + 1
                else:
                    return g + cp - a
            return 0
        if cp > 0xFFFF:
            return 0
        seg = u(">H", d[o + 6:o + 8])[0] // 2
        ends, starts, deltas, ranges = o + 14, o + 16 + 2 * seg, o + 16 + 4 * seg, o + 16 + 6 * seg
        lo, hi = 0, seg - 1
        while lo < hi:   # erster Abschnitt, dessen Ende nicht vor dem Zeichen liegt
            m = (lo + hi) // 2
            if u(">H", d[ends + 2 * m:ends + 2 * m + 2])[0] < cp:
                lo = m + 1
            else:
                hi = m
        if lo >= seg or u(">H", d[starts + 2 * lo:starts + 2 * lo + 2])[0] > cp:
            return 0
        delta, ro = u(">H", d[deltas + 2 * lo:deltas + 2 * lo + 2])[0], u(">H", d[ranges + 2 * lo:ranges + 2 * lo + 2])[0]
        if not ro:
            return (cp + delta) & 0xFFFF
        p = ranges + 2 * lo + ro + 2 * (cp - u(">H", d[starts + 2 * lo:starts + 2 * lo + 2])[0])
        g = u(">H", d[p:p + 2])[0] if p + 2 <= len(d) else 0
        return (g + delta) & 0xFFFF if g else 0

    def width(self, text: str) -> float:
        """Laufweite eines Textes in Geviert (ohne Unterschneidung – libass setzt ebenso)."""
        import struct
        total = 0.0
        for ch in text:
            w = self._adv.get(ch)
            if w is None:
                g = self._glyph(ord(ch) if ch not in "\t " else 32)
                if g:
                    p = self._hmtx + 4 * min(g, self._nh - 1)
                    w = struct.unpack(">H", self.data[p:p + 2])[0] / self.upm
                else:   # Zeichen fehlt in der Schrift (z. B. ein Emoji): libass nimmt dafür eine andere, die Breite ist geschätzt
                    w = 1.0 if ord(ch) > 0x2E7F else 0.6
                self._adv[ch] = w
            total += w
        return total


def font_names(path: Path) -> tuple[str, bool]:
    """Familienname und Fettschnitt aus der Schriftdatei (TTF/OTF, Tabellen „name“ und „OS/2“).
    libass sucht im fontsdir nach dem Namen, der in der Datei steht – der Anzeigename der Oberfläche
    (z. B. „TS Anton“) passt nicht, dann nahm ffmpeg stillschweigend die Standardschrift."""
    f = FontFace(path.read_bytes())
    return f.family, f.bold


class FontSet(dict):
    """Die Schriften eines Exports: {Schlüssel: (Familienname, fett)} – so, wie write_ass sie einsetzt. Dazu je Schrift die
    Maße und der Inhalt der Datei (zum Einbetten in die Untertiteldatei) und die Liste der Schriften, die fehlen."""

    def __init__(self):
        super().__init__()
        self.face: dict[str, FontFace] = {}
        self.label: dict[str, str] = {}     # Familienname in der Datei → Name, wie er in der Oberfläche steht
        self.missing: list[str] = []


FONT_EMBED_MAX = 12 << 20   # größere Schriftdateien liegen nur im Schriftordner des Exports, nicht zusätzlich in der Untertiteldatei
_SSA64 = bytes.maketrans(b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", bytes(range(33, 97)))


def font_label(f: dict, key: str) -> str:
    name = str((f or {}).get("family") or key)
    return name[3:] if name.startswith("TS ") else name


def collect_fonts(fonts: dict, dest: Path) -> FontSet:
    """Benötigte Schriftdateien für den Export bereitstellen; liefert {Schlüssel: (Familienname, fett)} samt Maßen.
    Jede Schrift wird im Protokoll vermerkt – auch, wenn sie fehlt: Dann steht die Standardschrift im Video, und der Export
    sagt das hinterher dazu (siehe font_check)."""
    names = FontSet()
    try:
        dest.mkdir(parents=True, exist_ok=True)
    except OSError as e:
        log(f"Schriftordner {dest}: {e!r}")
    for key, f in (fonts or {}).items():
        label = font_label(f if isinstance(f, dict) else {}, str(key))
        try:
            src = WEB_DIR / "fonts" / Path(f["file"]).name if f.get("file") else Path(norm_path(f.get("uri", "")))
            if not src.is_file():
                log(f"Schrift „{label}“ ({key}): Datei fehlt – {src}")
                names.missing.append(label)
                continue
            data = src.read_bytes()
            try:   # Kopie im Schriftordner des Exports (fontsdir); scheitert sie, bleibt die eingebettete Fassung
                (dest / (re.sub(r"[^A-Za-z0-9_-]", "_", str(key)) + src.suffix.lower())).write_bytes(data)
            except OSError as e:
                log(f"Schrift „{label}“ ({key}): Kopie in den Export-Ordner scheitert – {e!r}")
            fam, bold, face = "", False, None
            try:
                face = FontFace(data)
                fam, bold = face.family, face.bold
            except Exception as e:  # noqa: BLE001
                log(f"Schrift „{label}“ ({key}): Datei {src.name} nicht lesbar – {e!r}")
            fam = (fam or str(f.get("family") or "")).replace(",", " ")
            names[key] = (fam, bold if face and face.family else bool(f.get("bold")))
            names.label[fam] = label
            if face:
                names.face[key] = face
            log(f"Schrift „{label}“ ({key}): {src.name}, {len(data) // 1024} kB, Familie „{fam}“"
                + (f", PostScript-Name „{face.ps}“, Zelle {sum(face.cell):.3f} Geviert" if face else ""))
        except Exception as e:  # noqa: BLE001
            log(f"Schrift „{label}“ ({key}): {e!r}")
            names.missing.append(label)
    return names


def font_check(err: str, fonts) -> list[str]:
    """Liest aus der Ausgabe von ffmpeg, welche Schrift libass je Familie genommen hat („fontselect: (Familie, …) -> …“).
    Liefert die Anzeigenamen der Schriften, die NICHT aus der mitgegebenen Datei kamen. Die erste Zeile je Familie zählt:
    Weitere Zeilen stehen für einzelne Zeichen, die der Schrift fehlen (z. B. Emojis)."""
    faces = getattr(fonts, "face", {}) or {}

    def plain(s):   # Schreibweise angleichen: Manche Schriftdateien führen den Namen in zwei Tabellen leicht verschieden
        return re.sub(r"[^a-z0-9]", "", s.lower())
    want = {fonts[k][0]: plain(f.ps) for k, f in faces.items() if k in fonts and plain(f.ps)}
    bad, seen = [], set()
    for m in re.finditer(r"fontselect: \((.*?), (\d+), (\d+)\) -> (.*), (-?\d+), (.*)", err or ""):
        fam, path, ps = m.group(1), m.group(4).strip(), m.group(6).strip()
        if fam in seen or fam not in want:
            continue
        seen.add(fam)
        if want[fam] not in (plain(ps), plain(path)):
            bad.append(fonts.label.get(fam, fam))
            log(f"Schrift „{fam}“ ist im Video nicht angekommen – libass meldet: {m.group(0)}")
    for ln in (err or "").splitlines():
        if "fontselect:" in ln or "font provider" in ln or ("font" in ln.lower() and ("rror" in ln or "ailed" in ln)):
            log("libass: " + ln.split("] ", 1)[-1].strip()[:300])
    return bad


SUB_LINE = 1.12   # Zeilenhöhe der Vorschau (CSS line-height) in Geviert
_SYS_FACES: dict[str, FontFace | None] = {}


def standard_face() -> FontFace | None:
    """Maße der Standardschrift im Video: Arial fett. Unter Linux (dort laufen die Prüfläufe) die Schrift, die fontconfig
    dafür einsetzt. Fehlt die Datei, setzt write_ass die Standardschrift auf dem alten Weg."""
    if "std" not in _SYS_FACES:
        face = None
        try:
            if os.name == "nt":
                files = [Path(os.environ.get("WINDIR") or r"C:\Windows") / "Fonts" / "arialbd.ttf"]
            else:
                r = subprocess.run(["fc-match", "-f", "%{file}", "Arial:bold"], capture_output=True, text=True, timeout=5)
                files = [Path(r.stdout.strip())] if r.returncode == 0 and r.stdout.strip() else []
            for p in files:
                if p.is_file():
                    f = FontFace(p.read_bytes())
                    if f.ok:
                        face = f
                        break
        except Exception as e:  # noqa: BLE001
            log(f"Standardschrift: Maße nicht lesbar – {e!r}")
        _SYS_FACES["std"] = face
    return _SYS_FACES["std"]


def wrap_px(text: str, face: FontFace, px: float, limit: float) -> list[str]:
    """Eine Zeile umbrechen wie der Browser der Vorschau: so viele Wörter, wie in die Breite passen."""
    words = []
    for wd in text.split():
        # Schriften ohne Wortzwischenräume (Chinesisch, Japanisch …): Der Browser bricht dort nach jedem Zeichen um
        if face.width(wd) * px > limit and any(ord(ch) >= 0x2E80 for ch in wd):
            words += [(ch, "") for ch in wd[:-1]] + [(wd[-1], " ")]
        else:
            words.append((wd, " "))
    if not words:
        return [""]
    out, cur, glue = [], words[0][0], words[0][1]
    for wd, sep in words[1:]:
        t = cur + glue + wd
        if face.width(t) * px > limit:
            out.append(cur)
            cur = wd
        else:
            cur = t
        glue = sep
    out.append(cur)
    return out


def ass_rrect(bw: float, bh: float, rad: float) -> str:
    """Rechteck mit runden Ecken als ASS-Zeichnung (\\p4: Angaben in Achtel-Pixeln)."""
    rad = max(0.0, min(rad, bw / 2, bh / 2))
    k = rad * 0.5523

    def p(*v):
        return " ".join(str(int(round(x * 8))) for x in v)
    return (f"m {p(rad, 0)} l {p(bw - rad, 0)} b {p(bw - rad + k, 0, bw, rad - k, bw, rad)} l {p(bw, bh - rad)} "
            f"b {p(bw, bh - rad + k, bw - rad + k, bh, bw - rad, bh)} l {p(rad, bh)} b {p(rad - k, bh, 0, bh - rad + k, 0, bh - rad)} "
            f"l {p(0, rad)} b {p(0, rad - k, rad - k, 0, rad, 0)}")


def ass_layout(c: dict, style: dict, face: FontFace, name: tuple, w: int, h: int) -> dict:
    """Lage eines Untertitels, eines Titels oder einer Textzeile, gesetzt wie in der Vorschau (und wie Android und Browser
    exportieren): gleiche Schriftgröße (Geviert statt Zelle), gleiche Zeilenhöhe, Umbruch bei 88 % der Breite."""
    title = bool(c.get("title"))
    px = c["size"] * min(w, h) * (1.25 if h > w else 1.0) if c.get("size") else sub_px(style, w, h)
    bg = bool(c.get("bg"))
    pad_x, pad_y = (px * 0.3, px * 0.1) if bg else (0.0, 0.0)
    rows = [r.strip() for r in c["text"].replace("{", "(").replace("}", ")").split("\n")]
    wrapped = False
    if not title:   # Titel und Textzeile sind in der Oberfläche schon passend umbrochen; Untertitel bricht dort der Browser um
        # Die Vorschau bricht bei 88 % der Breite um. Gemessen wird hier ohne Unterschneidung (etwa 1 % breiter); die
        # Standardschrift (Arial) läuft außerdem rund 2 % breiter als die Schrift, die die Vorschau dafür zeigt.
        limit = (0.90 if name[0] == "Arial" else 0.888) * w - 2 * pad_x
        split = [wrap_px(r, face, px, limit) for r in rows]
        wrapped = any(len(x) > 1 for x in split)
        rows = [x for part in split for x in part]
    cw = max((face.width(r) * px for r in rows), default=0.0)
    ch = len(rows) * SUB_LINE * px
    box_w, box_h = (max(cw, 0.88 * w - 2 * pad_x) if wrapped else cw) + 2 * pad_x, ch + 2 * pad_y
    al, a = "m", str(c.get("anchor") or "")
    if len(a) == 2:      # Textzeile: an der Ecke, mit Randabstand
        al = a[1]
        cy = c["my"] * h + pad_y + ch / 2 if a[0] == "o" else h - c["my"] * h - pad_y - ch / 2
        x = c["mx"] * w + pad_x if al == "l" else w - c["mx"] * w - pad_x if al == "r" else w / 2
        bx = c["mx"] * w if al == "l" else w - c["mx"] * w - box_w if al == "r" else w / 2 - box_w / 2
    elif title:          # Titel stehen, wo sie hingezogen wurden
        x, cy = c["x"] * w, c["y"] * h
        bx = x - box_w / 2
    else:                # Untertitel bleiben im Bild (2 % Rand), wie in der Vorschau
        m = 0.02
        x = min(max(c["x"] * w, box_w / 2 + m * w), w - box_w / 2 - m * w) if box_w <= w * (1 - 2 * m) else w / 2
        cy = min(max(c["y"] * h, box_h / 2 + m * h), h - box_h / 2 - m * h)
        bx = x - box_w / 2
    return {"c": c, "face": face, "name": name, "title": title, "px": px, "bg": bg, "rows": rows, "ch": ch, "box_w": box_w, "box_h": box_h,
            "al": al, "x": x, "cy": cy, "bx": bx}


def ass_spread(group: list[dict], h: int) -> None:
    """Untertitel, die gleichzeitig stehen (Original und Übersetzung): Die Oberfläche rechnet ihre Lage ohne den Umbruch
    bei 88 % der Breite. Bricht eine Zeile dabei um, wird der Block höher – dann rücken die Blöcke auseinander statt übereinander."""
    group.sort(key=lambda g: g["cy"])
    for up, lo in zip(group, group[1:]):
        over = (up["cy"] + up["box_h"] / 2 + up["px"] * 0.2) - (lo["cy"] - lo["box_h"] / 2)
        if over > 0:
            up["cy"] -= over / 2
            lo["cy"] += over / 2
    m = 0.02 * h
    low = group[-1]["cy"] + group[-1]["box_h"] / 2 - (h - m)
    if low > 0:     # unten aus dem Bild: alle zusammen nach oben
        for g in group:
            g["cy"] -= low
    top = m - (group[0]["cy"] - group[0]["box_h"] / 2)
    if top > 0:
        for g in group:
            g["cy"] += top


def ass_events(g: dict, style: dict, t0: str, t1: str, ts=None) -> list[str]:
    """Die Einträge zu einer Lage aus ass_layout: der Kasten als eigene Fläche, darüber jede Zeile mit fester Lage –
    der Zeilenabstand von libass hängt sonst an der Zelle der Schrift."""
    c, face, title, px = g["c"], g["face"], g["title"], g["px"]
    fam, bold = g["name"]
    col = c.get("color") or style.get("color") or "#FFFFFF"
    ocol = c.get("outlineColor") or ("#000000" if title else style.get("outlineColor") or "#000000")
    out_on = bool(c["outline"]) if c.get("outline") is not None else bool(style.get("outline", True))
    cr, cg, cb = hex_rgb(col)
    qr, qg, qb = hex_rgb(ocol)
    look = (f"\\fn{fam}\\b{1 if bold else 0}\\fs{px * sum(face.cell):.2f}\\1c&H{cb:02X}{cg:02X}{cr:02X}&\\3c&H{qb:02X}{qg:02X}{qr:02X}&"
            + (f"\\bord{max(1.0, px / 14):.1f}\\shad0" if out_on else "\\bord0\\shad0" if title else f"\\bord0\\shad{max(1.0, px / 20):.1f}"))
    base = f"\\1c&H{cb:02X}{cg:02X}{cr:02X}&"

    def box(a0: str, a1: str, extra: str = "") -> list[str]:
        if not g["bg"]:
            return []
        return [f"Dialogue: 0,{a0},{a1},Default,,0,0,0,,{{{extra}\\an7\\pos({g['bx']:.1f},{g['cy'] - g['box_h'] / 2:.1f})\\bord0\\shad0\\1c&H000000&"
                f"\\1a&H{0x73 if title else 0x66:02X}&\\p4}}{ass_rrect(g['box_w'], g['box_h'], px * (0.15 if title else 0.18))}{{\\p0}}"]
    # Grundlinie: Der Browser setzt Ober- und Unterlänge mittig in die Zeile, libass richtet die Zelle der Schrift aus
    shift = ((face.css[0] - face.css[1]) - (face.cell[0] - face.cell[1])) / 2 * px
    an = 4 if g["al"] == "l" else 6 if g["al"] == "r" else 5
    ys = [g["cy"] - g["ch"] / 2 + (k + 0.5) * SUB_LINE * px + shift for k in range(len(g["rows"]))]
    if cue_has_fx(c) and ts is not None:
        return ass_fx_events(g, c, look, base, an, ys, ts, box)
    ev = box(t0, t1)
    for k, row in enumerate(g["rows"]):
        if row:
            ev.append(f"Dialogue: 1,{t0},{t1},Default,,0,0,0,,{{\\an{an}\\pos({g['x']:.1f},{ys[k]:.1f}){look}}}{row}")
    return ev


def ass_fx_events(g: dict, c: dict, look: str, base: str, an: int, ys: list[float], ts, box) -> list[str]:
    """Untertitel mit Effekten: je Zeitabschnitt ein Satz Einträge; Farbe und Sichtbarkeit je Wort stehen als Angaben im Text.
    Die Lage der Zeilen bleibt über alle Abschnitte gleich – es ändert sich nur, was die Wörter zeigen."""
    rows = [r.split() for r in g["rows"]]
    n = sum(len(r) for r in rows)
    anim, ev, ms = c.get("anim"), [], int(SUB_ANIM_S * 1000)
    for k, (a, b) in enumerate(fx_slices(c)):
        t0, t1 = ts(a), ts(b)
        if t0 == t1:
            continue
        first = k == 0 and bool(anim)
        fade = f"\\fad({ms},0)" if first and anim == "fade" else ""
        pop = f"\\fscx84\\fscy84\\t(0,{ms},\\fscx100\\fscy100)" if first and anim == "pop" else ""
        ev += box(t0, t1, fade)
        state, i = fx_state(c, a if k == 0 else (a + b) / 2, n), 0
        for r, words in enumerate(rows):
            parts, cur = [], None
            for w in words:
                v = state[i]
                i += 1
                if v != cur:
                    if v == "":
                        parts.append("{\\alpha&HFF&}")
                    else:
                        tag = "\\alpha&H00&" if cur == "" else ""
                        if v is None:
                            tag += base
                        else:
                            rr, gg, bb = hex_rgb(v)
                            tag += f"\\1c&H{bb:02X}{gg:02X}{rr:02X}&"
                        parts.append("{" + tag + "}")
                    cur = v
                parts.append(w + " ")
            if words:
                ev.append(f"Dialogue: 1,{t0},{t1},Default,,0,0,0,,{{\\an{an}\\pos({g['x']:.1f},{ys[r]:.1f}){look}{fade}{pop}}}{''.join(parts).rstrip()}")
    return ev


def write_ass(cues: list[dict], style: dict, out: Path, w: int, h: int, fonts: dict | None = None):
    """ASS-Untertitel mit fester Lage je Zeile, gesetzt wie in der Vorschau (ass_layout, ass_events). Die mitgegebenen
    Schriftdateien stehen zusätzlich in der Datei selbst (Abschnitt [Fonts])."""
    fonts = fonts or {}
    faces = getattr(fonts, "face", None) or {}
    used: set[str] = set()
    size = sub_px(style, w, h)
    fam, fbold = fonts.get(style.get("font") or "") or ("", False)
    r, g, b = hex_rgb(style.get("color", "#FFFFFF"))
    outline = max(1.0, size / 14) if style.get("outline", True) else 0
    shadow = 0 if style.get("outline", True) else max(1.0, size / 20)
    orr, og, ob = hex_rgb(style.get("outlineColor") or "#000000")

    def ts(t):
        cs = int(round(t * 100))
        hh, cs = divmod(cs, 360000)
        mm, cs = divmod(cs, 6000)
        ss, cs = divmod(cs, 100)
        return f"{hh}:{mm:02d}:{ss:02d}.{cs:02d}"
    lines = ["[Script Info]", "ScriptType: v4.00+", f"PlayResX: {w}", f"PlayResY: {h}", "WrapStyle: 2",
             "ScaledBorderAndShadow: yes", "Kerning: yes", "", "[V4+ Styles]",
             "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, "
             "Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
             "Alignment, MarginL, MarginR, MarginV, Encoding",
             f"Style: Default,{fam or 'Arial'},{size:.0f},&H00{b:02X}{g:02X}{r:02X},&H00FFFFFF,&H00{ob:02X}{og:02X}{orr:02X},&H96000000,"
             f"{-1 if fbold or not fam else 0},0,0,0,100,100,0,0,1,{outline:.1f},{shadow:.1f},5,0,0,0,1",
             # Kasten hinter dem Text (BorderStyle 3: deckender Kasten in OutlineColour)
             f"Style: Box,{fam or 'Arial'},{size:.0f},&H00{b:02X}{g:02X}{r:02X},&H00FFFFFF,&H64000000,&H64000000,"
             f"{-1 if fbold or not fam else 0},0,0,0,100,100,0,0,3,{max(2.0, size / 6):.1f},0,5,0,0,0,1",
             "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
    # Lage je Eintrag wie in der Vorschau – für mitgegebene Schriften und für die Standardschrift (Arial fett). Nur wenn sich
    # die Maße einer Schrift nicht lesen lassen, setzt der alte Weg weiter unten den Eintrag (Größe nach Zelle, ohne Umbruch).
    lay: dict[int, dict] = {}
    for c in cues:
        key = (c.get("font") or "") if (c.get("title") or "font" in c) else (style.get("font") or "")
        face, name = None, ("Arial", True)
        if key and key in fonts:
            used.add(key)
            if key in faces and faces[key].ok and fonts[key][0]:
                face, name = faces[key], fonts[key]
        else:   # Standardschrift – auch dann, wenn eine gewählte Schrift fehlt
            face = standard_face()
        if face is not None:
            lay[id(c)] = ass_layout(c, style, face, name, w, h)
    same: dict[tuple, list[dict]] = {}
    for c in cues:
        if id(c) in lay and not c.get("title"):
            same.setdefault((round(c["start"], 3), round(c["end"], 3)), []).append(lay[id(c)])
    for group in same.values():
        if len(group) > 1:
            ass_spread(group, h)
    for c in cues:
        placed = lay.get(id(c))
        if placed is not None:
            lines += ass_events(placed, style, ts(c["start"]), ts(c["end"]), ts)
            continue
        rows = c["text"].split("\n")
        csize = c["size"] * min(w, h) * (1.25 if h > w else 1.0) if c.get("size") else size
        bw = max(len(x) for x in rows) * csize * 0.56
        bh = len(rows) * csize * 1.15
        m = 0.02
        cx = min(max(c["x"] * w, bw / 2 + m * w), w - bw / 2 - m * w) if bw < w * (1 - 2 * m) else w / 2
        cy = min(max(c["y"] * h, bh / 2 + m * h), h - bh / 2 - m * h)
        txt = c["text"].replace("{", "(").replace("}", ")").replace("\n", "\\N")
        ov = f"\\an5\\pos({cx:.0f},{cy:.0f})"
        if c.get("anchor"):
            # Textzeile: an der Ecke ausgerichtet – unabhängig davon, wie breit die Schrift im Export tatsächlich läuft.
            # Mit Kasten rückt sie um dessen Rand nach innen, damit der Kasten am Randabstand endet.
            a, pad = c["anchor"], (max(2.0, csize / 6) if c.get("bg") else 0.0)
            ax = c["mx"] * w + pad if a[1] == "l" else w - c["mx"] * w - pad if a[1] == "r" else w / 2
            ay = c["my"] * h + pad if a[0] == "o" else h - c["my"] * h - pad
            ov = f"\\an{(7 if a[0] == 'o' else 1) + 'lmr'.index(a[1])}\\pos({ax:.0f},{ay:.0f})"
        if c.get("size"):
            ov += f"\\fs{csize:.0f}"
        if c.get("title"):
            tf, tb = fonts.get(c.get("font") or "") or ("", True)
            ov += f"\\fn{tf}\\b{1 if tb else 0}" if tf else "\\fnArial\\b1"
        elif "font" in c:   # eigene Schrift einer Sprecherin / eines Sprechers
            tf, tb = fonts.get(c.get("font") or "") or ("", False)
            ov += f"\\fn{tf}\\b{1 if tb else 0}" if tf else "\\fnArial\\b1"
        if c.get("color"):
            cr, cg, cb = hex_rgb(c["color"])
            ov += f"\\1c&H{cb:02X}{cg:02X}{cr:02X}&"
        if c.get("outlineColor"):
            qr, qg, qb = hex_rgb(c["outlineColor"])
            ov += f"\\3c&H{qb:02X}{qg:02X}{qr:02X}&"
        if c.get("outline") is not None:
            ov += f"\\bord{max(1.0, csize / 14):.1f}\\shad0" if c["outline"] else ("\\bord0\\shad1" if c.get("title") else f"\\bord0\\shad{max(1.0, csize / 20):.1f}")
        sty = "Default"
        if c.get("bg"):   # dunkler Kasten statt Umrandung
            sty = "Box"
            ov = re.sub(r"\\(bord|shad)[0-9.]+", "", ov) + f"\\bord{max(2.0, csize / 6):.1f}\\shad0"
        lines.append(f"Dialogue: 0,{ts(c['start'])},{ts(c['end'])},{sty},,0,0,0,,{{{ov}}}{txt}")
    # Die gebrauchten Schriften stehen auch in der Datei selbst: Der Schriftordner des Exports (fontsdir) ist dann der zweite Weg.
    sec = []
    for n, key in enumerate(sorted(used)):
        face = faces.get(key)
        if face is None or len(face.data) > FONT_EMBED_MAX:
            continue
        if getattr(face, "ssa", None) is None:
            face.ssa = base64.b64encode(face.data).rstrip(b"=").translate(_SSA64).decode("ascii")
        sec.append(f"fontname: schrift{n}_0.ttf")
        sec += [face.ssa[j:j + 80] for j in range(0, len(face.ssa), 80)]
    if sec:
        at = lines.index("[Events]")
        lines[at:at] = ["[Fonts]"] + sec + [""]
    out.write_text("\n".join(lines) + "\n", encoding="utf-8-sig")


# ───────────────────────────── Export: Video / Audio per ffmpeg ─────────────────────────────

def zoom_expr(zooms: list[dict], seg_in: float):
    """Zoom als zoompan-Ausdrücke (Zeit it = Sekunden ab Abschnittsbeginn)."""
    def part(z):
        a = z["at"] - seg_in
        d = max(0.05, z["dur"])
        s = z["strength"]
        p = f"clip((it-{a:.4f})/{d:.4f},0,1)"
        e = f"({p}*{p}*(3-2*{p}))"
        if z["kind"] == "punch":
            return a, a + d, f"{s:.4f}"
        if z["kind"] == "out":
            return a, a + d, f"({s:.4f}+(1-{s:.4f})*{e})"
        return a, a + d, f"(1+({s:.4f}-1)*{e})"
    zx, cx, cy = "1", "0.5", "0.5"
    for z in zooms:   # spätere Zooms gewinnen (wie in der Vorschau)
        a, b, ex = part(z)
        cond = f"between(it,{a:.4f},{b:.4f})"
        zx = f"if({cond},{ex},{zx})"
        cx = f"if({cond},{z['cx']:.4f},{cx})"
        cy = f"if({cond},{z['cy']:.4f},{cy})"
    return zx, cx, cy


def kf_expr(pts: list[tuple[float, float]], var: str = "it") -> str:
    """Stückweise lineare Funktion (Keyframes) als ffmpeg-Ausdruck in der Variablen var."""
    return pw_expr(pts).replace("t,", f"{var},").replace("(t-", f"({var}-")


def kf_filter(kf: list[dict], zooms: list[dict], seg_in: float, sp: float, W: int, H: int, fps_s: str) -> str:
    """Lage und Größe der Hauptspur über die Zeit (Keyframes), zusammen mit Zooms, als ein zoompan-Filter.

    Das eingepasste Bild (W×H) wird so weit gepolstert, dass jeder Ausschnitt hineinpasst; zoompan wählt je Bild
    den Ausschnitt: Mitte/Größe aus den Keyframes (linear), darüber der Zoom um seinen Mittelpunkt."""
    ks = sorted(kf, key=lambda k: float(k["t"]))
    def win(k):
        sc = max(0.05, float(k.get("sc") or 1)); tx = float(k.get("tx") or 0); ty = float(k.get("ty") or 0)
        return (W / 2 - tx * W / sc - W / (2 * sc), H / 2 - ty * H / sc - H / (2 * sc), W / sc, H / sc)
    wins = [win(k) for k in ks]
    left, top = min(w[0] for w in wins), min(w[1] for w in wins)
    right, bottom = max(w[0] + w[2] for w in wins), max(w[1] + w[3] for w in wins)
    pl, pt = max(0.0, -left), max(0.0, -top)
    pr, pb = max(0.0, right - W), max(0.0, bottom - H)
    K = min(6.0, max((W + pl + pr) / W, (H + pt + pb) / H, 1.0))   # Polsterung begrenzen (sehr kleine Bilder: Rand wird abgeschnitten)
    PW, PH = max(2, round(W * K / 2) * 2), max(2, round(H * K / 2) * 2)
    ox = pl + max(0.0, (PW - (W + pl + pr)) / 2)
    oy = pt + max(0.0, (PH - (H + pt + pb)) / 2)
    # Keyframe-Zeiten: Quellsekunden ab Abschnittsbeginn; zoompan rechnet in it (Sekunden des beschleunigten Bilds)
    var = f"(it*{sp:.4f})" if abs(sp - 1) > 1e-3 else "it"
    scx = kf_expr([(float(k["t"]), max(0.05, float(k.get("sc") or 1))) for k in ks], var)
    txx = kf_expr([(float(k["t"]), float(k.get("tx") or 0)) for k in ks], var)
    tyx = kf_expr([(float(k["t"]), float(k.get("ty") or 0)) for k in ks], var)
    zs, cx, cy = ("1", "0.5", "0.5")
    if zooms:
        zs, cx, cy = zoom_expr(zooms, seg_in)
        if abs(sp - 1) > 1e-3:
            zs, cx, cy = (e.replace("it", var) for e in (zs, cx, cy))
    # Ausschnitt im gepolsterten Bild: links/oben aus den Keyframes, dann der Zoom um (cx, cy) des sichtbaren Bilds
    zoom = f"({scx})*({PW}/{W})*({zs})"
    x = f"{ox:.3f}+{W}/2-({txx})*{W}/({scx})-{W}/(2*({scx}))+({cx})*{W}*(1-1/({zs}))/({scx})"
    y = f"{oy:.3f}+{H}/2-({tyx})*{H}/({scx})-{H}/(2*({scx}))+({cy})*{H}*(1-1/({zs}))/({scx})"
    return (f",pad={PW}:{PH}:{round(ox)}:{round(oy)}:black,zoompan=z='{zoom}':x='{x}':y='{y}':d=1:s={W}x{H}:fps={fps_s}")


def cover_window(s: dict, plan: dict, W: int, H: int, fx: dict) -> str | None:
    """Ausschnitt in Quellpixeln (crop=w:h:x:y), wenn der vergrößerte Clip das Bild vollständig füllt, sonst None."""
    if fx["sc"] <= 1.001:
        return None
    srcs = plan.get("sources") or []
    si = s.get("src")
    src = srcs[si] if isinstance(si, int) and 0 <= si < len(srcs) else None
    sw, sh = float((src or {}).get("width") or 0), float((src or {}).get("height") or 0)
    if sw < 2 or sh < 2:
        return None
    k = min(W / sw, H / sh)
    ox, oy = (W - sw * k) / 2, (H - sh * k) / 2
    vw, vh = W / fx["sc"], H / fx["sc"]
    cx, cy = W / 2 - fx["tx"] * W / fx["sc"], H / 2 - fx["ty"] * H / fx["sc"]
    xs, ys, ws, hs = (cx - vw / 2 - ox) / k, (cy - vh / 2 - oy) / k, vw / k, vh / k
    if xs < -1 or ys < -1 or xs + ws > sw + 1 or ys + hs > sh + 1:
        return None
    ws, hs = max(2, int(ws) // 2 * 2), max(2, int(hs) // 2 * 2)
    xs, ys = int(min(max(0.0, xs), sw - ws)), int(min(max(0.0, ys), sh - hs))
    return f"{ws}:{hs}:{xs}:{ys}"


def seg_fx(s: dict) -> dict:
    return {"speed": max(0.25, min(4.0, float(s.get("speed") or 1))), "vol": max(0.0, min(8.0, float(s.get("vol", 1) if s.get("vol") is not None else 1))),
            "bright": float(s.get("bright") or 0), "contrast": float(s.get("contrast") or 0), "sat": float(s.get("sat") or 0), "gray": bool(s.get("gray")),
            "tx": float(s.get("tx") or 0), "ty": float(s.get("ty") or 0), "sc": max(0.05, float(s.get("sc") or 1)), "wb": wb_gains(s.get("wb"))}


def wb_gains(raw) -> list | None:
    """Weißabgleich aus dem Plan: Verstärkung je Farbkanal [r, g, b]; None = keiner."""
    try:
        v = [min(4.0, max(0.25, float(x))) for x in raw][:3]
    except (TypeError, ValueError):
        return None
    return v if len(v) == 3 and any(abs(x - 1) > 1e-3 for x in v) else None


def pw_expr(pts: list[tuple[float, float]]) -> str:
    """Stückweise lineare Funktion der Zeit t (Keyframes) als ffmpeg-Ausdruck."""
    if len(pts) == 1:
        return f"{pts[0][1]:.5f}"
    e = f"{pts[-1][1]:.5f}"
    for i in range(len(pts) - 2, -1, -1):
        (t0, v0), (t1, v1) = pts[i], pts[i + 1]
        e = f"if(lt(t,{t1:.4f}),{v0:.5f}+({v1 - v0:.5f})*(t-{t0:.4f})/{max(1e-3, t1 - t0):.4f},{e})"
    return f"if(lt(t,{pts[0][0]:.4f}),{pts[0][1]:.5f},{e})"


def ovl_geom(o: dict, W: int, H: int):
    """Lage einer Einblendung: (Breite, Höhe, x, y) fest oder als Ausdrücke (Keyframes); None = Vollbild."""
    if o.get("w") is None:
        return None
    a = max(0.05, float(o.get("aspect") or 16 / 9))
    kf = o.get("kf") or []
    if len(kf) >= 2:
        at = float(o["at"])
        ks = sorted(kf, key=lambda k: float(k["t"]))
        ws = [float(k["w"]) for k in ks]
        xx = pw_expr([(at + float(k["t"]), float(k["x"])) for k in ks])
        yx = pw_expr([(at + float(k["t"]), float(k["y"])) for k in ks])
        if max(ws) - min(ws) < 1e-4:
            # nur die Lage ändert sich: Bild einmal skalieren, nur die Position wird je Bild berechnet
            pw = max(2, round(W * ws[0] / 2) * 2)
            ph = max(2, round(pw / a / 2) * 2)
            # Lage auf ganze Pixel gerundet wie bei festen Einblendungen (ffmpeg schneidet sonst ab: ein Balken am Bildrand säße
            # mit Keyframes zwei Zeilen höher als ohne)
            return {"anim": False, "move": True, "w": pw, "h": ph, "x": f"floor({W}*({xx})-overlay_w/2+0.5)", "y": f"floor({H}*({yx})-overlay_h/2+0.5)"}
        wx = pw_expr([(at + float(k["t"]), float(k["w"])) for k in ks])
        mw = max(2, round(W * max(ws) / 2) * 2)
        return {"anim": True, "move": True, "w": f"max(2,trunc({W}*({wx})/2)*2)", "h": f"max(2,trunc({W}*({wx})/{a:.5f}/2)*2)",
                "x": f"floor({W}*({xx})-overlay_w/2+0.5)", "y": f"floor({H}*({yx})-overlay_h/2+0.5)", "maxw": mw, "maxh": max(2, round(mw / a / 2) * 2)}
    k0 = kf[0] if kf else o
    pw = max(2, round(W * float(k0["w"]) / 2) * 2)
    ph = max(2, round(pw / a / 2) * 2)
    return {"anim": False, "move": False, "w": pw, "h": ph, "x": round(float(k0["x"]) * W - pw / 2), "y": round(float(k0["y"]) * H - ph / 2)}


def blur_graph(blurs: list, cur: str, parts: list, inputs: list, W: int, H: int, fps_s: str, total: float) -> str:
    """Unkenntlich gemachte Bereiche (plan["blurs"]) in die Bildkette einbauen; liefert das neue Ende der Kette.
    Je Bereich: {at, d, x, y, w, aspect, kf?, form: rect|ellipse, kind: pixel|soft, cell, wmax?, mask?} – Mitte und Breite als Anteile
    des Bilds, cell = Feldgröße als Anteil der Bildbreite. Gerechnet wird in einem Fenster in der größten Größe des Bereichs, das
    seiner Mitte folgt und im Bild bleibt: ausschneiden, auf wenige Felder verkleinern (Mittelwert je Feld), wieder vergrößern
    (hart = verpixelt, weich = weichgezeichnet), zurücklegen. Eine Maske begrenzt das Fenster auf den Bereich, wo beide sich
    unterscheiden (Ellipse, wechselnde Größe, Lage am Bildrand). Die Kette läuft über die ganze Länge mit – ein Zuschnitt in der
    Zeit würde die Bilder der Hauptkette davor im Speicher stauen; das kleine Fenster kostet kaum Rechenzeit."""
    for j, b in enumerate(blurs):
        try:
            at, d = float(b["at"]), max(0.05, float(b["d"]))
            a = max(0.02, float(b.get("aspect") or 1))
            kf = sorted([k for k in (b.get("kf") or []) if isinstance(k, dict)], key=lambda k: float(k["t"]))
            pts = ([(at + float(k["t"]), float(k["x"]), float(k["y"]), float(k["w"])) for k in kf] if len(kf) >= 2
                   else [(at, float((kf[0] if kf else b)["x"]), float((kf[0] if kf else b)["y"]), float((kf[0] if kf else b)["w"]))])
        except (KeyError, TypeError, ValueError):
            continue
        ws = [p[3] for p in pts]
        wmax = max(max(ws), float(b.get("wmax") or 0))
        cw = min(W, max(2, math.ceil(wmax * W / 2) * 2))
        ch = min(H, max(2, math.ceil(wmax * W / a / 2) * 2))
        cell = max(2.0, float(b.get("cell") or 0.02) * W)
        sw, sh = max(1, round(cw / cell)), max(1, round(ch / cell))
        xx = pw_expr([(p[0], p[1]) for p in pts])
        yx = pw_expr([(p[0], p[2]) for p in pts])
        wx = pw_expr([(p[0], p[3]) for p in pts])
        xc = f"max(0,min({W - cw},trunc(({W}*({xx})-{cw / 2:.1f})/2)*2))"
        yc = f"max(0,min({H - ch},trunc(({H}*({yx})-{ch / 2:.1f})/2)*2))"
        anim = max(ws) - min(ws) > 1e-4
        # Ragt der Bereich an einem Keyframe über das Bild hinaus, sitzt das Fenster dort nicht mehr mittig auf ihm
        edge = any(p[1] * W - p[3] * W / 2 < -0.5 or p[1] * W + p[3] * W / 2 > W + 0.5 or p[2] * H - p[3] * W / a / 2 < -0.5
                   or p[2] * H + p[3] * W / a / 2 > H + 0.5 for p in pts)
        mask = b.get("mask") if (b.get("form") == "ellipse" or anim or edge or wmax - max(ws) > 1e-4) else None
        up = "bilinear" if b.get("kind") == "soft" else "neighbor"
        parts.append(f"{cur}split[bva{j}][bvb{j}]")
        # accurate_rnd: ohne diese Angabe rundet der Skalierer einfarbige Flächen um eine Stufe daneben – der Bereich hätte einen Farbstich
        parts.append(f"[bvb{j}]crop={cw}:{ch}:x='{xc}':y='{yc}',format=yuv444p,scale={sw}:{sh}:flags=area+accurate_rnd+full_chroma_int,"
                     f"scale={cw}:{ch}:flags={up}+accurate_rnd+full_chroma_int,setsar=1[bl{j}]")
        en = f"enable='between(t,{at:.4f},{at + d:.4f})'"
        if mask and os.path.isfile(norm_path(str(mask))):
            inputs.append(["-i", norm_path(str(mask))])
            i = len(inputs) - 1
            if anim:
                nfr = max(1, int(d * float(fps_s) + 2))
                ms = (f"[{i}:v:0]format=gray,loop=loop={nfr}:size=1:start=0,setpts=N/({fps_s})/TB+{at:.4f}/TB,"
                      f"scale=w='max(2,trunc({W}*({wx})))':h='max(2,trunc({W}*({wx})/{a:.5f}))':eval=frame,setsar=1[bms{j}]")
            else:
                ms = f"[{i}:v:0]format=gray,scale={max(2, round(ws[0] * W))}:{max(2, round(ws[0] * W / a))},setsar=1,setpts=PTS-STARTPTS+{at:.4f}/TB[bms{j}]"
            parts.append(ms)
            parts.append(f"color=c=black:s={cw}x{ch}:r={fps_s}:d={total + 1:.3f},format=gray[bbk{j}]")
            parts.append(f"[bbk{j}][bms{j}]overlay=x='floor({W}*({xx})-overlay_w/2+0.5)-({xc})':y='floor({H}*({yx})-overlay_h/2+0.5)-({yc})':eval=frame:"
                         f"eof_action=repeat,format=gray[bmk{j}]")
            parts.append(f"[bl{j}][bmk{j}]alphamerge[blm{j}]")
            parts.append(f"[bva{j}][blm{j}]overlay=x='{xc}':y='{yc}':eval=frame:eof_action=pass:{en},format=yuv420p[bo{j}]")
        else:
            parts.append(f"[bva{j}][bl{j}]overlay=x='{xc}':y='{yc}':eval=frame:eof_action=pass:{en},format=yuv420p[bo{j}]")
        cur = f"[bo{j}]"
    return cur


def chroma_graph(key: dict | None, inl: str, outl: str, tag: str) -> list[str]:
    """Freistellen als Filter-Teilgraph von inl nach outl (leer = kein Freistellen).
    Je Schlüsselfarbe eine eigene Maske: bunte Farben über „chromakey“ (Abstand im Farbton), unbunte (Weiß, Grau,
    Schwarz) über „colorkey“ (Abstand im RGB-Raum). Die Masken werden mit „darken“ vereint (Minimum) – hintereinander
    gehängte Keyer würden die Maske des vorigen überschreiben. Danach bei Grün/Blau den Farbsaum zurück (despill).
    Dieselbe Rechnung steckt in der Vorschau (chroma.js) und im Android-Export (ChromaKeyEffect.kt)."""
    if not key or not key.get("colors"):
        return []
    cols = []
    for c in list(key["colors"])[:4]:
        c = str(c).strip().lstrip("#")
        if len(c) == 6 and all(ch in "0123456789abcdefABCDEF" for ch in c):
            cols.append(c.lower())
    if not cols:
        return []
    tol = min(1.0, max(0.01, float(key.get("tol") or 0.22)))
    soft = min(1.0, max(0.0, float(key.get("soft") or 0)))

    def rgb(c):
        return [int(c[i:i + 2], 16) for i in (0, 2, 4)]

    def chroma(c):
        v = rgb(c)
        return max(v) - min(v) >= 64

    n = len(cols)
    parts = [f"{inl}format=yuva444p,split={n + 1}[{tag}s]" + "".join(f"[{tag}k{i}]" for i in range(n))]
    for i, c in enumerate(cols):
        f = (f"chromakey=color=0x{c}:similarity={tol:.3f}:blend={soft:.3f}" if chroma(c)
             else f"format=rgba,colorkey=color=0x{c}:similarity={tol:.3f}:blend={soft:.3f}")
        parts.append(f"[{tag}k{i}]{f},alphaextract[{tag}a{i}]")
    cur = f"[{tag}a0]"
    for i in range(1, n):
        parts.append(f"{cur}[{tag}a{i}]blend=all_mode=darken[{tag}m{i}]")
        cur = f"[{tag}m{i}]"
    tail = ""
    cc = next((c for c in cols if chroma(c)), None)   # Farbsaum: erste bunte Schlüsselfarbe
    if key.get("spill") and cc:
        r, g, b = rgb(cc)
        m = max(r, g, b)
        if m == g:
            tail = ",despill=type=green:mix=0.5"
        elif m == b:
            tail = ",despill=type=blue:mix=0.5"
    parts.append(f"[{tag}s]{cur}alphamerge{tail}{outl}")
    return parts


def key_pad(key: dict | None) -> str:
    """Farbe für die Ränder eines freigestellten Hauptbilds: die erste Schlüsselfarbe – sie wird mit freigestellt."""
    for c in list((key or {}).get("colors") or [])[:4]:
        c = str(c).strip().lstrip("#")
        if len(c) == 6 and all(ch in "0123456789abcdefABCDEF" for ch in c):
            return c.lower()
    return "00ff00"


def video_fx_chain(fx: dict) -> str:
    parts = []
    wb = fx.get("wb")
    if wb:   # Weißabgleich zuerst, auf dem unveränderten Bild (wie in der Vorschau)
        parts.append(f"colorchannelmixer=rr={wb[0]:.4f}:gg={wb[1]:.4f}:bb={wb[2]:.4f}")
    if fx["bright"] or fx["contrast"] or fx["sat"]:
        parts.append(f"eq=brightness={fx['bright'] * 0.5:.3f}:contrast={1 + fx['contrast']:.3f}:saturation={max(0.0, 1 + fx['sat'] / 100):.3f}")
    if fx["gray"]:
        parts.append("hue=s=0")
    return "".join("," + p for p in parts)


def atempo_chain(speed: float) -> str:
    """atempo kann 0,5–100; kleinere Werte werden verkettet."""
    out = []
    while speed < 0.5:
        out.append("atempo=0.5")
        speed /= 0.5
    out.append(f"atempo={speed:.4f}")
    return "".join("," + p for p in out)


# ───────────────────────────── Stimme aufbereiten (E2) ─────────────────────────────
# Ein Schalter im Projekt: Hochpass gegen Trittschall und Brummen, Rauschminderung, weniger Nachhall, gleichmäßigere Lautstärke.
# Die Rechnung steht dreimal im Projekt und liefert überall dasselbe Ergebnis: hier (numpy), in core/web/app.js (voiceDspLib:
# Vorschau und Browser) und in android/…/VoiceDsp.java. Die Prüfläufe vergleichen die drei Fassungen Abtastwert für Abtastwert.
# Im Plan trägt jeder Abschnitt der Hauptspur, dessen Ton aufbereitet wird, voice = {k: Schlüssel der Aufnahme, lvl: Pegelverlauf
# [[Sekunden ab Abschnittsbeginn in der Quelle, Faktor], …]}.
VOICE = {"hp": 85.0, "tau_s": 0.04, "rise": 2.0, "beta": 2.5, "floor_n": -12.0, "floor_r": -9.0, "rt60": 0.6, "td": 0.05,
         "tau_g": 0.05, "dd": 0.96, "makeup": 1.5, "knee": 0.8, "prime": 2.0}


class VoiceDsp:
    """Ein STFT-Durchgang je Abschnitt: Hochpass, Rauschminderung (Minimum-Verfolgung, entscheidungsgestützter Wiener-Gewinn),
    Nachhall-Dämpfung (späte Anteile), danach Pegelverlauf und weiche Begrenzung. Die Rauschschätzung (noise) wird von
    Abschnitt zu Abschnitt derselben Aufnahme weitergegeben."""

    def __init__(self, sr: int, ch: int, noise=None):
        import numpy as np
        v = VOICE
        self.sr, self.ch = sr, ch
        self.N = 2048 if sr >= 64000 else 1024 if sr >= 32000 else 512 if sr >= 16000 else 256
        N = self.N
        self.H = H = N // 4
        self.K = K = N // 2 + 1
        self.win = np.sin(np.pi * np.arange(N) / N)
        f = np.arange(K) * sr / N
        self.hp = np.zeros(K)
        self.hp[1:] = 1 / np.sqrt(1 + (v["hp"] / f[1:]) ** 4)
        self.aS = float(np.exp(-H / (sr * v["tau_s"])))
        self.W = max(2, int(round(2 * v["tau_s"] * sr / H)))
        self.up = float(10 ** (v["rise"] * H / sr / 10))
        self.rel = float(np.exp(-H / (sr * v["tau_g"])))
        self.D = max(1, int(round(v["td"] * sr / H)))
        self.rho = float(10 ** (-6 * (self.D * H / sr) / v["rt60"]))
        self.gn, self.gr = 10 ** (v["floor_n"] / 20), 10 ** (v["floor_r"] / 20)
        self.makeup = 10 ** (v["makeup"] / 20)
        self.noise = None if noise is None or len(noise) != K else np.array(noise, dtype=np.float64)
        self.reset()

    def reset(self):
        import numpy as np
        self.S, self.m = None, 0
        self.ring = np.zeros((self.D, self.K))
        self.ri = 0
        self.Gs = np.full(self.K, self.gn)
        self.Gp = np.full(self.K, self.gn)
        self.gam = np.ones(self.K)

    def _track(self, P):
        """Geglättete Leistung und Rauschschätzung aus einem vollständigen Rahmen."""
        import numpy as np
        self.m += 1
        if self.m == 1:
            self.S = P.copy()
        elif self.m <= self.W:
            self.S = self.S + (P - self.S) / self.m
        else:
            self.S = self.aS * self.S + (1 - self.aS) * P
        if self.noise is None:
            if self.m == self.W:
                self.noise = self.S.copy()
        elif self.m > self.W:
            self.noise = np.where(self.S < self.noise, self.S, np.minimum(self.S, self.noise * self.up))

    def _gain(self, P, full: bool):
        import numpy as np
        v = VOICE
        if full and float(P.sum()) > 1e-9:   # völlige Stille (stumm geschaltete Stellen) lehrt nichts über das Rauschen
            self._track(P)
        Sx = self.S if self.S is not None else P
        if self.noise is None:
            Gn = np.ones(self.K)
            gam = np.ones(self.K)
        else:
            gam = P / (v["beta"] * self.noise + 1e-12)
            xi = v["dd"] * self.Gp * self.Gp * self.gam + (1 - v["dd"]) * np.maximum(gam - 1, 0)
            Gn = np.maximum(self.gn, xi / (1 + xi))
        self.Gp, self.gam = Gn, gam
        Gr = np.maximum(self.gr, 1 - self.rho * self.ring[self.ri] / (Sx + 1e-12))
        if full and self.S is not None:
            self.ring[self.ri] = self.S
            self.ri = (self.ri + 1) % self.D
        G = np.maximum(self.gn, Gn * Gr)
        Gf = G.copy()
        Gf[1:-1] = 0.25 * G[:-2] + 0.5 * G[1:-1] + 0.25 * G[2:]
        self.Gs = np.where(Gf > self.Gs, Gf, self.rel * self.Gs + (1 - self.rel) * Gf)
        return self.Gs * self.hp

    def prime(self, x):
        """Rauschschätzung aus dem Anfang einer Aufnahme lernen (nur vollständige Rahmen, ohne Ausgabe)."""
        import numpy as np
        N, H = self.N, self.H
        x = np.asarray(x, dtype=np.float64).reshape(-1, self.ch)
        nf = (len(x) - N) // H + 1
        self.reset()
        if nf >= 1:
            fr = np.lib.stride_tricks.sliding_window_view(x, N, axis=0)[::H][:nf]     # (nf, ch, N)
            P = (np.abs(np.fft.rfft(fr * self.win, axis=2)) ** 2).mean(axis=1)
            for j in range(nf):
                if float(P[j].sum()) > 1e-9:
                    self._track(P[j])
            if self.noise is None and self.m >= 2:
                self.noise = self.S.copy()
        self.reset()

    def process(self, x, lvl=None):
        """x: (n, ch) – ein Abschnitt. Rückgabe gleich lang, ohne Versatz. lvl: Pegelverlauf [[t, g], …] ab Abschnittsbeginn."""
        import numpy as np
        N, H, ch = self.N, self.H, self.ch
        x = np.asarray(x, dtype=np.float64).reshape(-1, ch)
        n = len(x)
        if n == 0:
            return x
        J = -(-(n + N - H) // H)
        xp = np.zeros(((J - 1) * H + N, ch))
        xp[N - H: N - H + n] = x
        out = np.zeros_like(xp)
        self.reset()
        B = 1024
        for j0 in range(0, J, B):
            j1 = min(J, j0 + B)
            fr = np.lib.stride_tricks.sliding_window_view(xp[j0 * H: (j1 - 1) * H + N], N, axis=0)[::H]   # (nb, ch, N)
            X = np.fft.rfft(fr * self.win, axis=2)
            P = (X.real ** 2 + X.imag ** 2).mean(axis=1)
            G = np.empty((j1 - j0, self.K))
            for j in range(j0, j1):
                a = j * H - (N - H)
                G[j - j0] = self._gain(P[j - j0], a >= 0 and a + N <= n)
            y = np.fft.irfft(X * G[:, None, :], N, axis=2) * (self.win * 0.5)
            for q in range(4):   # je vier Rahmen überlappen sich: phasenweise aufaddieren
                yq = y[q::4]
                if len(yq):
                    a = (j0 + q) * H
                    out[a: a + len(yq) * N] += yq.transpose(0, 2, 1).reshape(-1, ch)
        y = out[N - H: N - H + n] * self.makeup
        if lvl:
            t = np.array([p[0] for p in lvl], dtype=np.float64)
            g = np.array([p[1] for p in lvl], dtype=np.float64)
            y = y * np.interp(np.arange(n) / self.sr, t, g)[:, None]
        k = VOICE["knee"]
        a = np.abs(y)
        return np.where(a <= k, y, np.sign(y) * (k + (1 - k) * np.tanh((a - k) / (1 - k))))


def clean_level(raw) -> list:
    """Pegelverlauf aus dem Plan: Zahlenpaare, nach Zeit geordnet, Faktoren zwischen 0,1 und 4."""
    out = []
    for p in raw if isinstance(raw, list) else []:
        try:
            t, g = float(p[0]), float(p[1])
        except (TypeError, ValueError, IndexError):
            continue
        if t == t and g == g:
            out.append([t, min(4.0, max(0.1, g))])
    out.sort(key=lambda p: p[0])
    return out


def write_wav_float(path: Path, data, sr: int) -> None:
    """Schreibt (n, Kanäle) als WAV mit 32-Bit-Gleitkommawerten."""
    import struct
    raw = data.astype("<f4").tobytes()
    ch = data.shape[1]
    with open(path, "wb") as f:
        f.write(struct.pack("<4sI4s4sIHHIIHH4sI", b"RIFF", 36 + len(raw), b"WAVE", b"fmt ", 16, 3, ch, sr, sr * ch * 4, ch * 4, 32, b"data", len(raw)))
        f.write(raw)


VOICE_SR = 48000
VOICE_SPAN = 120.0   # so viele Sekunden einer Aufnahme dekodiert ein ffmpeg-Aufruf höchstens am Stück


def voice_decode(uri: str, a: float, b: float):
    """Ton einer Aufnahme von a bis b (Sekunden) als (n, 2)-Feld bei 48 kHz – über denselben Weg wie der Ton der Hauptspur
    im Export (Vorspulen, sekundengenau zuschneiden, auf 48 kHz Stereo bringen)."""
    import numpy as np
    seek = max(0.0, a - 1.0)
    cmd = [FFMPEG, "-hide_banner", "-v", "error", "-ss", f"{seek:.3f}", "-i", uri, "-vn", "-map", "0:a:0",
           "-af", f"atrim=start={a - seek:.4f}:end={b - seek:.4f},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=flt:channel_layouts=stereo",
           "-f", "f32le", "-"]
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, stdin=subprocess.DEVNULL, **NOWIN)
    if p.returncode:
        raise RuntimeError("Der Ton ließ sich zum Aufbereiten nicht lesen: " + p.stderr.decode("utf-8", "replace")[-300:])
    return np.frombuffer(p.stdout, dtype="<f4").reshape(-1, 2)


def voice_prepare(job: dict | None, plan: dict, tmp: Path) -> int:
    """Rechnet den Ton aller Abschnitte mit voice vor und legt ihn je Abschnitt als WAV in tmp ab; der Abschnitt bekommt den
    Dateinamen in _voice, build_graph liest den Ton dieses Abschnitts dann aus dieser Datei. Rückgabe: Zahl der Abschnitte."""
    for s in plan.get("segments") or []:
        s.pop("_voice", None)
    todo = [(k, s) for k, s in enumerate(plan.get("segments") or [])
            if isinstance(s.get("voice"), dict) and s.get("kind") == "main" and s.get("hasAudio", True) and not s.get("image") and float(s["out"]) - float(s["in"]) > 0.01]
    if not todo:
        return 0
    import numpy as np
    sr = VOICE_SR
    total = sum(float(s["out"]) - float(s["in"]) for _, s in todo)
    done = 0.0
    state: dict = {}   # Rauschschätzung je Aufnahme, wandert von Abschnitt zu Abschnitt
    by_uri: dict[str, list] = {}
    for k, s in todo:
        by_uri.setdefault(norm_path(s["uri"]), []).append((k, s))
    t0 = time.time()
    for uri, lst in by_uri.items():
        lst.sort(key=lambda q: float(q[1]["in"]))
        i = 0
        while i < len(lst):   # nahe beieinanderliegende Abschnitte mit einem Aufruf dekodieren
            a, b, j = float(lst[i][1]["in"]), float(lst[i][1]["out"]), i
            while j + 1 < len(lst) and float(lst[j + 1][1]["out"]) - a <= VOICE_SPAN:
                j += 1
                b = max(b, float(lst[j][1]["out"]))
            pcm = voice_decode(uri, a, b)
            for k, s in lst[i:j + 1]:
                if job and job.get("cancel"):
                    raise RuntimeError("Abgebrochen")
                i0, i1 = int(round((float(s["in"]) - a) * sr)), int(round((float(s["out"]) - a) * sr))
                x = np.zeros((i1 - i0, 2))
                got = pcm[i0:i1]
                x[: len(got)] = got   # fehlt am Ende der Aufnahme etwas, bleibt Stille
                key = str(s["voice"].get("k", uri))
                dsp = VoiceDsp(sr, 2, state.get(key))
                if dsp.noise is None:
                    dsp.prime(x[: int(VOICE["prime"] * sr)])
                y = dsp.process(x, clean_level(s["voice"].get("lvl")))
                state[key] = dsp.noise
                name = f"stimme_{k:05d}.wav"
                write_wav_float(tmp / name, y, sr)
                s["_voice"] = name
                done += float(s["out"]) - float(s["in"])
                if job is not None:
                    job["message"] = f"Stimme wird aufbereitet … {int(100 * done / total)} %"
            i = j + 1
    log(f"Stimme aufbereitet: {len(todo)} Abschnitte, {total:.1f} s Ton in {time.time() - t0:.1f} s")
    return len(todo)


def curve_at(pts: list, t: float) -> float:
    """Wert eines stückweise linearen Verlaufs [[t, g], …]; vor dem ersten und nach dem letzten Punkt gilt deren Wert."""
    if not pts:
        return 1.0
    if t <= pts[0][0]:
        return float(pts[0][1])
    for (t0, g0), (t1, g1) in zip(pts, pts[1:]):
        if t < t1:
            return float(g0 + (g1 - g0) * (t - t0) / (t1 - t0)) if t1 - t0 > 1e-9 else float(g1)
    return float(pts[-1][1])


def clean_curve(raw) -> list:
    """Verlauf aus dem Plan: Zahlenpaare, nach Zeit geordnet, Werte zwischen 0 und 1."""
    out = []
    for p in raw if isinstance(raw, list) else []:
        try:
            t, g = float(p[0]), float(p[1])
        except (TypeError, ValueError, IndexError):
            continue
        if t == t and g == g:
            out.append([t, min(1.0, max(0.0, g))])
    out.sort(key=lambda p: p[0])
    return out


def shift_curve(pts: list, o0: float, dur: float) -> list:
    """Verlauf für ein Stück der Ausgabe [o0, o0+dur): zugeschnitten und auf den Beginn des Stücks verschoben."""
    if not pts:
        return []
    return [[0.0, curve_at(pts, o0)]] + [[t - o0, g] for t, g in pts if o0 < t < o0 + dur] + [[dur, curve_at(pts, o0 + dur)]]


def gain_expr(pts: list) -> str:
    """Verlauf als ffmpeg-Ausdruck in t: Anfangswert plus eine begrenzte Rampe je Stück. Jeder Summand bleibt zwischen 0 und
    seinem Hub – so summieren sich auch bei langen Videos keine Rundungsfehler auf."""
    if not pts:
        return "1"
    e = f"{pts[0][1]:.5f}"
    for (t0, g0), (t1, g1) in zip(pts, pts[1:]):
        if abs(g1 - g0) < 1e-6:
            continue
        e += f"{g1 - g0:+.5f}*clip((t-{t0:.4f})/{max(1e-4, t1 - t0):.4f},0,1)"
    return e


def build_graph(plan: dict, with_video: bool, ass_name: str | None):
    """Erzeugt Eingaben und filter_complex für den Export-Plan der Oberfläche."""
    W, H = int(plan["width"]) // 2 * 2, int(plan["height"]) // 2 * 2
    fps = float(plan.get("fps") or 30)
    fps_s = f"{fps:.3f}".rstrip("0").rstrip(".")
    inputs: list[list[str]] = []
    idx: dict[str, int] = {}
    starts: dict[str, float] = {}

    def file_input(uri: str) -> int:
        uri = norm_path(uri)
        if uri not in idx:
            idx[uri] = len(inputs)
            inputs.append(["-i", uri])
            try:
                starts[uri] = float(probe_raw(uri).get("format", {}).get("start_time") or 0)
            except Exception:
                starts[uri] = 0.0
        return idx[uri]

    def image_input(uri: str, dur: float) -> int:
        inputs.append(["-loop", "1", "-framerate", fps_s, "-t", f"{dur + 0.1:.3f}", "-i", norm_path(uri)])
        return len(inputs) - 1

    fit = f"scale={W}:{H}:force_original_aspect_ratio=decrease,pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1"
    parts, labels = [], []
    # Übergänge: Bild-Ebenen, die trans_prepare an ihren Abschnitt gehängt hat (s["_trans"]). Ihre Bildketten entstehen in
    # derselben Schleife wie die Abschnitte selbst (Kennung "t0", "t1", …, ohne Ton) und werden gleich danach auf das Bild
    # ihres Abschnitts gelegt – noch vor dem Aneinanderhängen. So sitzt jede Ebene bildgenau am Schnitt.
    trans = [(k, t) for k, s in enumerate(plan["segments"]) for t in (s.get("_trans") or [])] if with_video else []
    tvl: dict[str, str] = {}
    seglab: list[list[str]] = []
    for k, s in list(enumerate(plan["segments"])) + [(f"t{j}", t["seg"]) for j, (_, t) in enumerate(trans)]:
        is_tr = isinstance(k, str)
        a0, b0 = float(s["in"]), float(s["out"])
        fx = seg_fx(s) if s.get("kind") == "main" else seg_fx({"vol": s.get("vol", 1)})
        sp = fx["speed"]
        d = max(0.04, (b0 - a0) / sp)
        img = bool(s.get("image"))
        vlab, alab = f"[v{k}]", f"[a{k}]"
        if img:
            i = image_input(s["uri"], d) if with_video else None
            if with_video:
                parts.append(f"[{i}:v:0]{fit},fps={fps_s},format=yuv420p,trim=duration={d:.4f},setpts=PTS-STARTPTS{vlab}")
            if not is_tr:
                parts.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={d:.4f},aformat=sample_fmts=fltp:channel_layouts=stereo{alab}")
        else:
            # Jeder Abschnitt bekommt eine eigene, vorgespulte Eingabe. Liest man alle Abschnitte aus einer
            # gemeinsamen Eingabe, puffert ffmpeg die Bilder für spätere Abschnitte – bei 4K und vielen Schnitten
            # oder umsortierten Abschnitten reicht dann der Arbeitsspeicher nicht.
            un = norm_path(s["uri"])
            seek = max(0.0, a0 - 1.0)
            inputs.append(["-ss", f"{seek:.3f}", "-i", un])
            i, off = len(inputs) - 1, -seek
            if with_video:
                ck = bool(s.get("hasVideo", True) and chroma_graph(s.get("key"), "", "", ""))
                vfin = vlab
                fitc, padc, fxc = fit, "black", video_fx_chain(fx)
                if ck:
                    # Freigestellt: Das fertige Bild wird noch über den Hintergrund gelegt. Ränder (eingepasstes oder verkleinertes
                    # Bild) stehen in der Schlüsselfarbe – so füllt der Hintergrund die ganze Fläche. Die Farbanpassung folgt nach dem
                    # Freistellen, auf dem freigestellten Bild: wie in der Vorschau, im Browser und unter Android.
                    vlab = f"[vq{k}]"
                    padc = "0x" + key_pad(s.get("key"))
                    fitc, fxc = fit.replace(":black,", f":{padc},"), ""
                kf = [k for k in (s.get("kf") or []) if isinstance(k, dict)]
                if len(kf) == 1:   # ein Keyframe = feste Werte
                    fx = {**fx, "sc": max(0.05, float(kf[0].get("sc") or 1)), "tx": float(kf[0].get("tx") or 0), "ty": float(kf[0].get("ty") or 0)}
                    kf = []
                if s.get("hasVideo", True) and len(kf) >= 2:
                    # Keyframes: Lage und Größe ändern sich über die Zeit – eingepasstes Bild, dann zoompan je Bild
                    spv = f"setpts=(PTS-STARTPTS)/{sp:.4f}" if abs(sp - 1) > 1e-3 else "setpts=PTS-STARTPTS"
                    z = kf_filter(kf, s.get("zooms") or [], a0, sp, W, H, fps_s)
                    parts.append(f"[{i}:v:0]trim=start={a0 + off:.4f}:end={b0 + off:.4f},{spv},{fitc},fps={fps_s}{z}{fxc},format=yuv420p{vlab}")
                elif s.get("hasVideo", True):
                    z = ""
                    # Vergrößerter Ausschnitt, der das Bild ganz füllt (z. B. 9:16 aus 16:9): direkt aus der Quelle
                    # ausschneiden statt das verkleinerte Bild hochzuskalieren – bleibt scharf und spart Rechenzeit
                    win = cover_window(s, plan, W, H, fx)
                    zooms = s.get("zooms") or []
                    if win and zooms:   # Zoom-Mittelpunkte in den Ausschnitt umrechnen (gleiches Ergebnis wie Zoom vor Lage)
                        zooms = [{**zz, "cx": min(1.0, max(0.0, 0.5 + (float(zz["cx"]) - 0.5) * fx["sc"] + fx["tx"])),
                                  "cy": min(1.0, max(0.0, 0.5 + (float(zz["cy"]) - 0.5) * fx["sc"] + fx["ty"]))} for zz in zooms]
                    if zooms:
                        zx, cx, cy = zoom_expr(zooms, a0)
                        if abs(sp - 1) > 1e-3:
                            zx, cx, cy = (e.replace("it", f"(it*{sp:.4f})") for e in (zx, cx, cy))
                        z = (f",zoompan=z='{zx}':x='{cx}*iw*(1-1/zoom)':y='{cy}*ih*(1-1/zoom)':d=1:s={W}x{H}:fps={fps_s}")
                    spv = f"setpts=(PTS-STARTPTS)/{sp:.4f}" if abs(sp - 1) > 1e-3 else "setpts=PTS-STARTPTS"
                    tf = not win and (abs(fx["sc"] - 1) > 1e-3 or abs(fx["tx"]) > 1e-4 or abs(fx["ty"]) > 1e-4)
                    lab = f"[vp{k}]" if tf else vlab
                    fitk = f"crop={win},scale={W}:{H},setsar=1" if win else fitc
                    parts.append(f"[{i}:v:0]trim=start={a0 + off:.4f}:end={b0 + off:.4f},{spv},{fitk},fps={fps_s}{z}{fxc},format=yuv420p{lab}")
                    if tf:   # Bild verkleinern/vergrößern und verschieben, Rest schwarz
                        sc_ = fx["sc"]
                        sw, sh = W * sc_, H * sc_
                        X, Y = (W - sw) / 2 + fx["tx"] * W, (H - sh) / 2 + fx["ty"] * H
                        # nur den sichtbaren Teil ausschneiden und skalieren – auch bei sehr starkem Zoom klein und schnell
                        vx0, vy0, vx1, vy1 = max(0.0, X), max(0.0, Y), min(float(W), X + sw), min(float(H), Y + sh)
                        parts.append(f"color=c={padc}:s={W}x{H}:r={fps_s}:d={d:.4f},format=yuv420p[vb{k}]")
                        if vx1 - vx0 < 2 or vy1 - vy0 < 2:
                            parts.append(f"[vp{k}]nullsink")
                            parts.append(f"[vb{k}]null{vlab}")
                        else:
                            cx0, cy0 = (vx0 - X) / sc_, (vy0 - Y) / sc_
                            cw, ch = max(2, int((vx1 - vx0) / sc_)), max(2, int((vy1 - vy0) / sc_))
                            cx0, cy0 = int(min(max(0.0, cx0), W - cw)), int(min(max(0.0, cy0), H - ch))
                            ow, oh = max(2, round((vx1 - vx0) / 2) * 2), max(2, round((vy1 - vy0) / 2) * 2)
                            parts.append(f"[vp{k}]crop={min(cw, W)}:{min(ch, H)}:{cx0}:{cy0},scale={ow}:{oh},setsar=1[vs{k}]")
                            parts.append(f"[vb{k}][vs{k}]overlay=x={round(vx0)}:y={round(vy0)}:shortest=1:eof_action=pass,format=yuv420p,setsar=1{vlab}")
                else:
                    parts.append(f"color=c={padc}:s={W}x{H}:r={fps_s},trim=duration={d:.4f},format=yuv420p,setsar=1{vlab}")
                if ck:
                    bg = str((s.get("key") or {}).get("bg") or "#000000").lstrip("#")
                    bg = bg if len(bg) == 6 else "000000"
                    fxk = video_fx_chain(fx)
                    parts += chroma_graph(s.get("key"), vlab, f"[vk{k}]" if not fxk else f"[vkr{k}]", f"q{k}")
                    if fxk:   # Farbe auf dem freigestellten Bild; die Deckkraft bleibt
                        parts.append(f"[vkr{k}]format=rgba{fxk},format=yuva444p[vk{k}]")
                    bgi = str((s.get("key") or {}).get("bgImg") or "")
                    if bgi and os.path.exists(norm_path(bgi)):   # Bild, das das ganze Bild füllt (Verlauf, eigenes Bild, weichgezeichnetes Standbild)
                        bi = image_input(bgi, d)
                        parts.append(f"[{bi}:v:0]scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1,fps={fps_s},format=yuv420p,trim=duration={d:.4f},setpts=PTS-STARTPTS[kb{k}]")
                    else:
                        parts.append(f"color=c=0x{bg}:s={W}x{H}:r={fps_s}:d={d:.4f},format=yuv420p[kb{k}]")
                    parts.append(f"[kb{k}][vk{k}]overlay=shortest=1:eof_action=pass,format=yuv420p,setsar=1{vfin}")
                    vlab = vfin
            if is_tr:
                pass
            elif s.get("hasAudio", True):
                f = min(0.008, d / 4)
                spa = atempo_chain(sp) if abs(sp - 1) > 1e-3 else ""
                vol = f",volume={fx['vol']:.3f}" if abs(fx["vol"] - 1) > 1e-3 else ""
                head = f"[{i}:a:0]atrim=start={a0 + off:.4f}:end={b0 + off:.4f},asetpts=PTS-STARTPTS,"
                if s.get("_voice"):   # Stimme aufbereitet: der Ton dieses Abschnitts liegt fertig zugeschnitten als Datei vor
                    inputs.append(["-i", str(s["_voice"])])
                    head = f"[{len(inputs) - 1}:a:0]asetpts=PTS-STARTPTS,"
                parts.append(head + f"aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo{spa}{vol},"
                             f"afade=t=in:st=0:d={f:.4f},afade=t=out:st={max(0, d - f):.4f}:d={f:.4f}{alab}")
            else:
                parts.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={d:.4f},aformat=sample_fmts=fltp:channel_layouts=stereo{alab}")
        if is_tr:
            tvl[k] = vlab
        else:
            seglab.append([vlab if with_video else "", alab])
    for j, (k, t) in enumerate(trans):
        off, d, lead = float(t["off"]), float(t["d"]), max(0.0, float(t.get("lead") or 0))
        a0, a1 = (min(1.0, max(0.0, float(t[q]) if t.get(q) is not None else 1.0)) for q in ("a0", "a1"))
        # feine Zeitbasis: sonst rundet setpts den Beginn der Ebene auf ganze Bilder
        chain = tvl[f"t{j}"] + (f"trim=start={lead:.4f},setpts=PTS-STARTPTS," if lead > 0.001 else "") + "format=yuva420p,settb=AVTB"
        if abs(a1 - a0) > 1e-3:
            # Deckkraft von a0 nach a1: Die Blende des Filters läuft über df Sekunden von 0 nach 1 (bzw. von 1 nach 0); die
            # Ebene steigt bei s0 in diese Rampe ein. Davor und danach hält der Filter den Randwert.
            up = a1 > a0
            df = d / abs(a1 - a0)
            s0 = (a0 if up else 1 - a0) * df
            chain += f",setpts=PTS-STARTPTS+{s0:.4f}/TB,fade=t={'in' if up else 'out'}:st=0:d={df:.4f}:alpha=1"
        elif a0 < 0.999:
            chain += f",colorchannelmixer=aa={a0:.3f}"
        parts.append(chain + f",setpts=PTS-STARTPTS+{off:.4f}/TB[tf{j}]")
        # Reicht die Ebene bis ans Ende des Abschnitts, deckt sie auch dessen letztes Bild: Ihr Material läuft dafür ein Stück
        # über den Schnitt hinaus (tail). eof_action=pass: Die Länge des Abschnitts bestimmt allein sein eigenes Bild.
        to_end = off + d >= seg_duration(plan["segments"][k]) - 0.02
        en = f"gte(t,{off:.4f})" if to_end else f"gte(t,{off:.4f})*lt(t,{off + d:.4f})"
        parts.append(f"{seglab[k][0]}[tf{j}]overlay=x=0:y=0:eof_action=pass:enable='{en}',format=yuv420p[vj{j}]")
        seglab[k][0] = f"[vj{j}]"
    labels = [v + a for v, a in seglab]
    n = len(plan["segments"])
    ovs = sorted(plan.get("overlays") or [], key=lambda o: (int(o.get("track") or 1), float(o["at"])))
    # Ton der Einblendungen (Lautstärke je Element) dazumischen. Tonspuren, die der Sprache weichen (duck), laufen vorher
    # gemeinsam durch den Verlauf plan["duck"] (Ausgabezeit, 0…1).
    oa, od = [], []
    duck = clean_curve(plan.get("duck"))
    for k, o in enumerate(ovs):
        vol = float(o.get("vol") or 0)
        if vol <= 0 or o.get("image") or o.get("hasAudio") is False:
            continue
        at, inn = float(o["at"]), float(o["in"])
        d = max(0.05, float(o["out"]) - inn)
        i = file_input(o["uri"])
        off = starts.get(norm_path(o["uri"]), 0.0)
        ms = int(round(at * 1000))
        parts.append(f"[{i}:a:0]atrim=start={inn + off:.4f}:end={inn + d + off:.4f},asetpts=PTS-STARTPTS,aresample=48000,"
                     f"aformat=sample_fmts=fltp:channel_layouts=stereo,volume={vol:.3f},afade=t=in:st=0:d=0.01,adelay={ms}|{ms}[oa{k}]")
        (od if duck and o.get("duck") else oa).append(f"[oa{k}]")
    if od:
        bus = od[0]
        if len(od) > 1:
            parts.append("".join(od) + f"amix=inputs={len(od)}:normalize=0:duration=longest:dropout_transition=0[odm]")
            bus = "[odm]"
        # in kleinen Blöcken, damit der Verlauf ohne hörbare Stufen läuft (die Lautstärke gilt je Block)
        parts.append(f"{bus}asetnsamples=n=256,volume=eval=frame:volume='{gain_expr(duck)}'[oduck]")
        oa.append("[oduck]")
    afin = "[apre]" if plan.get("level") else "[aout]"   # Lautstärke vereinheitlicht: Spitzen zum Schluss begrenzen
    amain = "[amain]" if oa else afin
    parts.append("".join(labels) + f"concat=n={n}:v={int(with_video)}:a=1" + ("[base]" if with_video else "") + amain)
    if oa:
        parts.append("[amain]" + "".join(oa) + f"amix=inputs={len(oa) + 1}:normalize=0:duration=first:dropout_transition=0{afin}")
    if plan.get("level"):
        parts.append("[apre]alimiter=limit=0.89:attack=5:release=60:level=false[aout]")
    if with_video:
        cur = "[base]"
        # Unkenntlich gemachte Bereiche wirken auf alles Bildmaterial; Formen und Fortschrittsbalken (top) liegen darüber
        blurs = [b for b in (plan.get("blurs") or []) if isinstance(b, dict)]
        for k, o in enumerate(ovs):
            if o.get("mode") == "audio":   # Tonspur: nur gemischt, kein Bild
                continue
            if blurs and o.get("top"):
                cur = blur_graph(blurs, cur, parts, inputs, W, H, fps_s, float(plan.get("total") or 0))
                blurs = []
            at, inn, out = float(o["at"]), float(o["in"]), float(o["out"])
            d = max(0.05, out - inn)
            g = ovl_geom(o, W, H)
            if g and g["anim"]:
                x, y = f"'{g['x']}'", f"'{g['y']}'"
                sc = f"scale=w='{g['w']}':h='{g['h']}':eval=frame,setsar=1"
            elif g:
                pw, ph = g["w"], g["h"]
                x, y = (f"'{g['x']}'", f"'{g['y']}'") if g["move"] else (g["x"], g["y"])
                sc = f"scale={pw}:{ph}:force_original_aspect_ratio=increase,crop={pw}:{ph},setsar=1"
                if not g["move"] and (pw > W or ph > H):   # stark vergrößert: nur den sichtbaren Teil skalieren
                    vx0, vy0, vx1, vy1 = max(0, x), max(0, y), min(W, x + pw), min(H, y + ph)
                    if vx1 - vx0 >= 2 and vy1 - vy0 >= 2:
                        fx0, fy0, fw_, fh_ = (vx0 - x) / pw, (vy0 - y) / ph, (vx1 - vx0) / pw, (vy1 - vy0) / ph
                        ow, oh = max(2, round((vx1 - vx0) / 2) * 2), max(2, round((vy1 - vy0) / 2) * 2)
                        sc = (f"crop=w='max(2,trunc(iw*{fw_:.6f}))':h='max(2,trunc(ih*{fh_:.6f}))':x='trunc(iw*{fx0:.6f})':y='trunc(ih*{fy0:.6f})',"
                              f"scale={ow}:{oh},setsar=1")
                        x, y = vx0, vy0
            elif o.get("mode") == "pip":
                sz = float(o.get("size") or 0.33)
                pw, ph = max(2, round(W * sz / 2) * 2), max(2, round(H * sz / 2) * 2)
                m = round(0.03 * W)
                c = o.get("corner") or "or"
                x = W - pw - m if c[1] == "r" else m
                y = m if c[0] == "o" else H - ph - m
                sc = f"scale={pw}:{ph}:force_original_aspect_ratio=increase,crop={pw}:{ph},setsar=1"
            else:
                x = y = 0
                sc = f"scale={W}:{H}:force_original_aspect_ratio=increase,crop={W}:{H},setsar=1"
            cr = o.get("crop") or None
            cropf = ""
            if cr:   # Zuschnitt: zuerst den Ausschnitt aus der Datei, dann wie gewohnt skalieren
                l, t_, r_, b_ = (max(0.0, min(0.98, float(cr.get(k) or 0))) for k in ("l", "t", "r", "b"))
                cw, ch = max(0.02, 1 - l - r_), max(0.02, 1 - t_ - b_)
                cropf = f"crop=w='max(2,trunc(iw*{cw:.5f}/2)*2)':h='max(2,trunc(ih*{ch:.5f}/2)*2)':x='trunc(iw*{l:.5f}/2)*2':y='trunc(ih*{t_:.5f}/2)*2',"
            if o.get("image"):
                # Standbild: nur ein Bild einlesen (kein Endlos-Eingang, der Speicher füllt); die Überlagerung wiederholt es
                inputs.append(["-i", norm_path(o["uri"])])
                i = len(inputs) - 1
                if g and g["anim"]:   # wächst/schrumpft: einmal auf die größte Größe bringen, dann im Filter wiederholen
                    nfr = max(1, int(d * fps + 0.999))
                    src = (f"[{i}:v:0]{cropf}scale={g['maxw']}:{g['maxh']},format=yuva420p,"
                           f"loop=loop={nfr}:size=1:start=0,setpts=N/({fps_s})/TB+{at:.4f}/TB")
                else:
                    src = f"[{i}:v:0]{cropf}setpts=PTS-STARTPTS+{at:.4f}/TB"
            else:
                i = file_input(o["uri"])
                off = starts.get(norm_path(o["uri"]), 0.0)
                src = f"[{i}:v:0]trim=start={inn + off:.4f}:end={inn + d + off:.4f},{cropf}setpts=PTS-STARTPTS+{at:.4f}/TB"
            still = bool(o.get("image")) and not (g and g["anim"])
            op = min(1.0, max(0.0, float(o.get("opacity", 1) if o.get("opacity") is not None else 1)))
            opf = f",colorchannelmixer=aa={op:.3f}" if op < 0.999 else ""   # Deckkraft (z. B. Wasserzeichen)
            kg = chroma_graph(o.get("key"), f"[op{k}]", f"[ok{k}]", f"x{k}")
            if kg:
                parts.append(f"{src}{'' if still else f',fps={fps_s}'},{sc}[op{k}]")
                parts += kg
                parts.append(f"[ok{k}]format=yuva420p{opf}[o{k}]")
            else:
                parts.append(f"{src}{'' if still else f',fps={fps_s}'},{sc},format=yuva420p{opf}[o{k}]")
            ev = ":eval=frame" if g and (g["anim"] or g["move"]) else ""
            parts.append(f"{cur}[o{k}]overlay=x={x}:y={y}{ev}:eof_action={'repeat' if still else 'pass'}:enable='between(t,{at:.4f},{at + d:.4f})'[c{k}]")
            cur = f"[c{k}]"
        if blurs:
            cur = blur_graph(blurs, cur, parts, inputs, W, H, fps_s, float(plan.get("total") or 0))
        if ass_name:
            parts.append(f"{cur}subtitles=filename={ass_name}:fontsdir=fonts[vout]")
        else:
            parts.append(f"{cur}null[vout]")
    flat = [x for a in inputs for x in a]
    return flat, ";\n".join(parts) + "\n"


QUALITY_CRF = {"hoch": "16", "standard": "20", "klein": "25"}
AUDIO_CODECS = {"wav": ["-c:a", "pcm_s16le"], "mp3": ["-c:a", "libmp3lame", "-b:a", "192k"],
                "m4a": ["-c:a", "aac", "-b:a", "192k"], "flac": ["-c:a", "flac"]}


CHUNK = 6   # so viele Abschnitte der Hauptspur rechnet ffmpeg auf einmal (begrenzt den Speicher)


def seg_duration(s: dict) -> float:
    fx = seg_fx(s) if s.get("kind") == "main" else seg_fx({})
    return max(0.04, (float(s["out"]) - float(s["in"])) / fx["speed"])


def trans_prepare(plan: dict) -> None:
    """Übergänge (plan["trans"]) an die Abschnitte hängen, über denen sie liegen: s["_trans"] = [{…, "off": Beginn im Abschnitt}].
    Eine Ebene: {at, d: Fenster in Ausgabezeit · a0, a1: Deckkraft am Anfang und Ende · lead, tail: bildgleicher Vor- und
    Nachlauf im Material · over: Nummer des Abschnitts · seg: das Material im Aufbau eines Abschnitts der Hauptspur}."""
    segs = plan.get("segments") or []
    starts, o = [], 0.0
    for s in segs:
        s.pop("_trans", None)
        starts.append(o)
        o += seg_duration(s)
    for t in plan.get("trans") or []:
        try:
            k, at, d = int(t["over"]), float(t["at"]), float(t["d"])
            if not (0 <= k < len(segs)) or d < 0.04 or not isinstance(t["seg"], dict) or float(t["seg"]["out"]) - float(t["seg"]["in"]) < 0.02:
                continue
        except (KeyError, TypeError, ValueError):
            continue
        off = min(max(0.0, at - starts[k]), max(0.0, seg_duration(segs[k]) - 0.04))
        if off < 0.02:   # beginnt am Schnitt: vom ersten Bild des Abschnitts an (die Zeiten im Plan sind auf Millisekunden gerundet)
            off = 0.0
        segs[k].setdefault("_trans", []).append({**t, "off": off, "d": d})


def shift_plan(plan: dict, segs: list[dict], o0: float, dur: float) -> dict:
    """Teilplan für ein Stück der Ausgabe [o0, o0+dur): Einblendungen werden verschoben und zugeschnitten."""
    sub = dict(plan)
    sub["segments"] = segs
    sub["total"] = dur
    ovs = []
    for o in plan.get("overlays") or []:
        at, inn, out = float(o["at"]), float(o["in"]), float(o["out"])
        d = out - inn
        a, e = max(at, o0), min(at + d, o0 + dur)
        if e - a < 0.02:
            continue
        cut = a - at   # am Anfang abgeschnittener Teil
        q = dict(o)
        q["at"] = a - o0
        q["in"] = inn + (0.0 if o.get("image") else cut)
        q["out"] = q["in"] + (e - a)
        if o.get("image"):
            q["in"], q["out"] = 0.0, e - a
        if o.get("kf"):
            q["kf"] = [{**k, "t": float(k["t"]) - cut} for k in o["kf"]]
        ovs.append(q)
    sub["overlays"] = ovs
    bls = []
    for b in plan.get("blurs") or []:   # unkenntlich gemachte Bereiche: wie Einblendungen verschieben und zuschneiden
        at, d = float(b["at"]), float(b["d"])
        a, e = max(at, o0), min(at + d, o0 + dur)
        if e - a < 0.02:
            continue
        q = dict(b)
        q["at"], q["d"] = a - o0, e - a
        if b.get("kf"):
            q["kf"] = [{**k, "t": float(k["t"]) - (a - at)} for k in b["kf"]]
        bls.append(q)
    sub["blurs"] = bls
    if plan.get("duck"):
        sub["duck"] = shift_curve(clean_curve(plan["duck"]), o0, dur)
    return sub


def shift_cues(cues: list[dict], o0: float, dur: float) -> list[dict]:
    out = []
    for c in cues:
        a, e = max(c["start"], o0), min(c["end"], o0 + dur)
        if e - a > 0.02:
            out.append({**c, "start": a - o0, "end": e - o0})
    return out


# ───────────────────────────── Export über die Grafikkarte (H1) ─────────────────────────────
# Die Videoeinheit von Nvidia (NVENC), Intel (Quick Sync) oder AMD (AMF) kodiert H.264 um ein Mehrfaches schneller als der
# Prozessor. Angeboten wird nur, was ein kurzer Probelauf mit genau den Einstellungen des Exports wirklich schafft; scheitert
# ein Export über die Grafikkarte, rechnet HoneyCut ihn auf dem bisherigen Weg (libx264) neu.
GPU_ENCODERS = [("nvenc", "Nvidia", "h264_nvenc"), ("qsv", "Intel", "h264_qsv"), ("amf", "AMD", "h264_amf")]
GPU_Q = {"hoch": 0, "standard": 1, "klein": 2}
GPU: dict = {"state": "new", "enc": None, "tried": []}   # state: new → pending → ready
_gpu_lock = threading.Lock()


def gpu_vcodec(name: str, quality: str | None) -> list[str]:
    """Kodier-Einstellungen je Grafikkarte; die Stufen entsprechen ungefähr CRF 16 / 20 / 25 von libx264."""
    q = GPU_Q.get(quality or "standard", 1)
    if name == "nvenc":
        return ["-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq", ("19", "23", "28")[q], "-b:v", "0", "-pix_fmt", "yuv420p"]
    if name == "qsv":
        return ["-c:v", "h264_qsv", "-preset", "medium", "-global_quality", ("19", "23", "28")[q], "-pix_fmt", "nv12"]
    if name == "amf":
        v = ("18", "22", "27")[q]
        return ["-c:v", "h264_amf", "-quality", "quality", "-rc", "cqp", "-qp_i", v, "-qp_p", v, "-qp_b", str(int(v) + 2), "-pix_fmt", "nv12"]
    raise ValueError(name)


def gpu_probe(name: str) -> bool:
    """Probelauf: eine halbe Sekunde Testbild mit den Einstellungen des Exports kodieren."""
    try:
        r = subprocess.run([FFMPEG, "-hide_banner", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=0.5"]
                           + gpu_vcodec(name, "standard") + ["-f", "null", "-"], capture_output=True, text=True, timeout=25,
                           stdin=subprocess.DEVNULL, **NOWIN)
        if r.returncode:
            GPU["tried"].append(f"{name}: {(r.stderr or '').strip().splitlines()[-1][:160] if (r.stderr or '').strip() else 'Fehler'}")
        return r.returncode == 0
    except Exception as e:  # noqa: BLE001
        GPU["tried"].append(f"{name}: {e!r}"[:200])
        return False


def gpu_detect() -> dict | None:
    """Sucht einmal je Programmlauf die nutzbare Grafikkarte: zuerst, was ffmpeg kennt, dann der Probelauf."""
    with _gpu_lock:
        if GPU["state"] == "ready":
            return GPU["enc"]
        GPU["state"] = "pending"
        enc = None
        if os.environ.get("TEXTSCHNITT_NO_GPU"):
            GPU["tried"].append("abgeschaltet über TEXTSCHNITT_NO_GPU")
        else:
            try:
                known = subprocess.run([FFMPEG, "-hide_banner", "-encoders"], capture_output=True, text=True, timeout=20,
                                       stdin=subprocess.DEVNULL, **NOWIN).stdout
            except Exception as e:  # noqa: BLE001
                known = ""
                GPU["tried"].append(f"ffmpeg -encoders: {e!r}"[:200])
            for name, label, codec in GPU_ENCODERS:
                if f" {codec} " not in known:
                    GPU["tried"].append(f"{name}: in diesem ffmpeg nicht enthalten")
                    continue
                if gpu_probe(name):
                    enc = {"name": name, "label": label, "codec": codec}
                    break
        GPU["enc"], GPU["state"] = enc, "ready"
        log("Grafikkarte für den Export: " + (f"{enc['label']} ({enc['codec']})" if enc else "keine nutzbare gefunden") + (" · " + "; ".join(GPU["tried"]) if GPU["tried"] else ""))
        return enc


def gpu_info(start: bool = True) -> dict:
    """Für die Oberfläche: {state: pending|ready, name, label}. Die Suche läuft im Hintergrund an."""
    if GPU["state"] == "new" and start:
        GPU["state"] = "pending"
        threading.Thread(target=gpu_detect, daemon=True).start()
    e = GPU["enc"] if GPU["state"] == "ready" else None
    return {"state": "ready" if GPU["state"] == "ready" else "pending", "name": e["name"] if e else None, "label": e["label"] if e else None}


def ffmpeg_graph(job, inputs, graph, tail, total, tmp, base=0.0, span=1.0):
    script = tmp / "filter.txt"
    script.write_text(graph, encoding="utf-8")
    log(f"ffmpeg startet: {sum(1 for a in inputs if a == '-i')} Eingaben, Graph {len(graph)} Zeichen\n{graph[:20000]}")
    flag = ["-/filter_complex", str(script)] if ffmpeg_major() >= 7 else ["-filter_complex_script", str(script)]
    try:
        return run_ffmpeg(inputs + flag + tail, total, job, base, span, cwd=tmp)
    except RuntimeError as e:
        if "Unrecognized option" in str(e) or "Option not found" in str(e):
            other = ["-filter_complex_script", str(script)] if flag[0].startswith("-/") else ["-/filter_complex", str(script)]
            return run_ffmpeg(inputs + other + tail, total, job, base, span, cwd=tmp)
        raise


def render_plan(job: dict, plan: dict, out: Path, with_video: bool, cues: list[dict]) -> list[str]:
    """Rechnet Video oder Ton – das Video auf Wunsch über die Grafikkarte, mit Rückfall auf den bisherigen Weg."""
    enc = gpu_detect() if with_video and plan.get("gpu") else None
    if enc:
        try:
            lost = render_plan_with(job, plan, out, with_video, cues, gpu_vcodec(enc["name"], plan.get("quality")))
            job["gpu"] = enc["label"]
            return lost
        except RuntimeError as e:
            if job.get("cancel"):
                raise
            log(f"Export über die Grafikkarte ({enc['label']}) gescheitert, rechne auf dem bisherigen Weg: {str(e)[:600]}")
            job["gpu_fallback"] = enc["label"]
            job["progress"], job["message"] = 0.0, "Die Grafikkarte kam nicht durch – der Export rechnet auf dem bisherigen Weg …"
            try:
                out.unlink(missing_ok=True)
            except OSError:
                pass
    return render_plan_with(job, plan, out, with_video, cues, None)


def render_plan_with(job: dict, plan: dict, out: Path, with_video: bool, cues: list[dict], vcodec: list[str] | None) -> list[str]:
    """Rechnet Video oder Ton. Liefert die Namen der Schriften, die im Video nicht angekommen sind (fehlende Datei oder von
    libass nicht genommen) – dort steht dann die Standardschrift, und der Export sagt das dazu.
    vcodec: Kodier-Einstellungen der Grafikkarte; ohne sie rechnet libx264."""
    tmp = Path(tempfile.mkdtemp(prefix="textschnitt_"))
    lost: list[str] = []

    def checked(err, fonts):
        for name in font_check(err or "", fonts):
            if name not in lost:
                lost.append(name)
    try:
        W, H = int(plan["width"]) // 2 * 2, int(plan["height"]) // 2 * 2
        total = float(plan.get("total") or 1)
        # Titel und Textzeile gehören zum Bild und stehen immer im Video; die Untertitel nur mit „Untertitel einbrennen“.
        if not plan.get("burn", True):
            cues = [c for c in cues if c.get("title")]
        burn = with_video and bool(cues)
        subs = plan.get("subs") or {}
        fonts = collect_fonts(subs.get("fonts") or {}, tmp / "fonts") if burn else {}
        lost += [n for n in getattr(fonts, "missing", []) if n not in lost]
        vtail = (vcodec or ["-c:v", "libx264", "-crf", QUALITY_CRF.get(plan.get("quality"), "20"), "-preset", "medium",
                            "-pix_fmt", "yuv420p"]) + ["-r", f"{float(plan.get('fps') or 30):.3f}"]
        segs = plan["segments"]
        voice_prepare(job, plan, tmp)
        trans_prepare(plan)
        if not with_video:
            inputs, graph = build_graph(plan, False, None)
            tail = ["-map", "[aout]", "-vn"] + AUDIO_CODECS.get(plan.get("audioFormat") or "wav", AUDIO_CODECS["wav"]) + [str(out)]
            ffmpeg_graph(job, inputs, graph, tail, total, tmp)
            return lost
        if len(segs) <= CHUNK:
            ass = None
            if burn:
                ass = "untertitel.ass"
                write_ass(cues, subs.get("style") or {}, tmp / ass, W, H, fonts)
            inputs, graph = build_graph(plan, True, ass)
            tail = ["-map", "[vout]", "-map", "[aout]"] + vtail + ["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out)]
            checked(ffmpeg_graph(job, inputs, graph, tail, total, tmp), fonts)
            return lost
        # Viele Abschnitte: in Stücken zu je CHUNK Abschnitten fertig rechnen (gleiche Qualität, Ton unkomprimiert),
        # dann ohne erneutes Kodieren aneinanderhängen. So bleibt der Speicherbedarf klein.
        parts, o0 = [], 0.0
        groups = [segs[i:i + CHUNK] for i in range(0, len(segs), CHUNK)]
        for n, g in enumerate(groups):
            dur = sum(seg_duration(x) for x in g)
            sub = shift_plan(plan, g, o0, dur)
            ass = None
            if burn:
                cs = shift_cues(cues, o0, dur)
                if cs:
                    ass = f"untertitel_{n}.ass"
                    write_ass(cs, subs.get("style") or {}, tmp / ass, W, H, fonts)
            inputs, graph = build_graph(sub, True, ass)
            part = tmp / f"stueck_{n:03d}.mkv"
            tail = ["-map", "[vout]", "-map", "[aout]"] + vtail + ["-c:a", "pcm_s16le", str(part)]
            job["message"] = f"Exportiere Teil {n + 1} von {len(groups)} …"
            checked(ffmpeg_graph(job, inputs, graph, tail, dur, tmp, base=0.97 * o0 / total, span=0.97 * dur / total), fonts)
            parts.append(part)
            o0 += dur
        lst = tmp / "stuecke.txt"
        lst.write_text("".join(f"file '{p.name}'\n" for p in parts), encoding="utf-8")
        job["message"] = "Teile werden zusammengefügt …"
        run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(lst), "-map", "0:v", "-map", "0:a", "-c:v", "copy",
                    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out)], total, job, 0.97, 0.03, cwd=tmp)
        return lost
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


# ───────────────────────────── Export: Concat-Projekt ─────────────────────────────

def rate_fraction(fps: float) -> tuple[int, int]:
    if abs(fps - round(fps)) < 0.01:
        return int(round(fps)) or 30, 1
    return int(round(fps * 1.001)) * 1000, 1001  # z. B. 29.97 -> 30000/1001


CONCAT_SIZES = {"klein": 0.035, "mittel": 0.045, "groß": 0.06}


def split_zooms(seg: dict):
    """Teilt einen Abschnitt an Zoom-Grenzen: [(in, out, scale, cx, cy)] – weiche Fahrten als Sprung."""
    a0, b0 = float(seg["in"]), float(seg["out"])
    cuts = {a0, b0}
    for z in seg.get("zooms") or []:
        for t in (z["at"], z["at"] + z["dur"]):
            if a0 < t < b0:
                cuts.add(t)
    pts = sorted(cuts)
    out = []
    for a, b in zip(pts, pts[1:]):
        if b - a < 0.02:
            continue
        mid = (a + b) / 2
        s, cx, cy = 1.0, 0.5, 0.5
        for z in seg.get("zooms") or []:
            if z["at"] <= mid <= z["at"] + z["dur"]:
                s, cx, cy = float(z["strength"]), float(z["cx"]), float(z["cy"])
        out.append((a, b, s, cx, cy))
    return out


def main_kf_samples(seg: dict) -> list[tuple[float, float, float, float]]:
    """Keyframes der Hauptspur samt Zooms als Stützstellen [(t_quelle, scale, tx, ty)] in CapCut-Maßen
    (Skalierung, Lage in halben Bildbreiten/-höhen)."""
    kf = sorted([k for k in (seg.get("kf") or []) if isinstance(k, dict)], key=lambda k: float(k["t"]))
    a0 = float(seg["in"])
    if len(kf) < 2:
        return []
    def at(rel):
        pts = [(float(k["t"]), float(k.get("tx") or 0), float(k.get("ty") or 0), max(0.05, float(k.get("sc") or 1))) for k in kf]
        if rel <= pts[0][0]:
            return pts[0][1:]
        if rel >= pts[-1][0]:
            return pts[-1][1:]
        for (t0, x0, y0, s0), (t1, x1, y1, s1) in zip(pts, pts[1:]):
            if rel < t1:
                f = (rel - t0) / max(1e-6, t1 - t0)
                return (x0 + (x1 - x0) * f, y0 + (y1 - y0) * f, s0 + (s1 - s0) * f)
        return pts[-1][1:]
    def zoom(t):
        zs, cx, cy = 1.0, 0.5, 0.5
        for z in seg.get("zooms") or []:
            if t < z["at"] or t > z["at"] + z["dur"]:
                continue
            p = min(1.0, max(0.0, (t - z["at"]) / max(0.05, z["dur"]))); e = p * p * (3 - 2 * p)
            st = float(z["strength"])
            zs = st if z["kind"] == "punch" else (st + (1 - st) * e if z["kind"] == "out" else 1 + (st - 1) * e)
            cx, cy = float(z["cx"]), float(z["cy"])
        return zs, cx, cy
    times = {a0 + float(k["t"]) for k in kf}
    for z in seg.get("zooms") or []:
        for q in (0.0, 0.001, 0.25, 0.5, 0.75, 0.999, 1.0):
            times.add(z["at"] + q * z["dur"])
    out = []
    for t in sorted(x for x in times if a0 - 1e-6 <= x <= float(seg["out"]) + 1e-6):
        tx, ty, sc = at(t - a0)
        zs, cx, cy = zoom(t)
        ztx, zty = (2 * (cx - 0.5) * (1 - zs), 2 * (cy - 0.5) * (zs - 1)) if zs > 1.001 else (0.0, 0.0)
        out.append((t, round(zs * sc, 4), round(ztx * sc + 2 * tx, 4), round(zty * sc - 2 * ty, 4)))
    return out


def cover_factor(cw: float, ch: float, W: float, H: float) -> float:
    if not cw or not ch:
        return 1.0
    return max(W / cw, H / ch) / min(W / cw, H / ch)


def pip_scale(o: dict, W: float, H: float, w: float | None = None) -> float:
    """Skalierung einer Einblendung in CapCut/Concat (Clip wird dort zuerst ins Bild eingepasst)."""
    if w is None and o.get("w") is None:
        return float(o.get("size") or 0.33)
    a = max(0.05, float(o.get("aspect") or 16 / 9))
    return round(float(w if w is not None else o["w"]) * W / min(W, H * a), 4)


def capcut_keyframes(o: dict, W: float, H: float) -> list[dict]:
    """Keyframes einer Einblendung für CapCut (Lage in halben Bildbreiten, Skalierung wie clip.scale)."""
    kf = sorted(o.get("kf") or [], key=lambda k: float(k["t"]))
    if len(kf) < 2:
        return []
    props = {"KFTypePositionX": lambda k: round((float(k["x"]) - 0.5) * 2, 5),
             "KFTypePositionY": lambda k: round((0.5 - float(k["y"])) * 2, 5),
             "KFTypeScaleX": lambda k: pip_scale(o, W, H, float(k["w"])),
             "KFTypeScaleY": lambda k: pip_scale(o, W, H, float(k["w"]))}
    out = []
    for prop, fn in props.items():
        out.append({"id": uuid.uuid4().hex, "material_id": "", "property_type": prop, "keyframe_list": [
            {"curveType": "Line", "graphID": "", "id": uuid.uuid4().hex, "left_control": {"x": 0.0, "y": 0.0},
             "right_control": {"x": 0.0, "y": 0.0}, "time_offset": int(round(float(k["t"]) * 1_000_000)), "values": [fn(k)]}
            for k in kf]})
    return out


def pip_center(o: dict, W: float, H: float) -> tuple[float, float]:
    if o.get("w") is not None:
        return float(o.get("x", 0.5)), float(o.get("y", 0.5))
    sz = float(o.get("size") or 0.33)
    c = o.get("corner") or "or"
    mx, my = 0.03, 0.03 * W / H
    x = 1 - mx - sz / 2 if c[1] == "r" else mx + sz / 2
    y = my + sz / 2 if c[0] == "o" else 1 - my - sz / 2
    return x, y


def write_concat(plan: dict, name: str, cues: list[dict], style: dict) -> Path:
    """Concat-Projekt (concat.json): T1 Hauptspur, T2 B-Roll/Bild-im-Bild, T3 Untertitel und Titel, T4 dauerhafte Textzeile."""
    root = concat_root()
    root.mkdir(parents=True, exist_ok=True)
    folder = root / safe_name(name)
    n = 2
    while (folder / "concat.json").exists():
        folder = root / f"{safe_name(name)} ({n})"
        n += 1
    folder.mkdir(parents=True, exist_ok=True)
    W, H = int(plan["width"]), int(plan["height"])
    num, den = rate_fraction(float(plan.get("fps") or 30))
    video = {"width": W, "height": H, "rateNum": num, "rateDen": den}
    media, mid = [], {}

    def med(uri: str, image: bool = False) -> str:
        uri = norm_path(uri)
        if uri in mid:
            return mid[uri]
        info = probe(uri)
        m = {"id": f"m{len(media) + 1}", "path": uri, "name": Path(uri).name,
             "duration": round(3600.0 if image else info["duration"], 6),
             "kind": "image" if image else ("video" if info["hasVideo"] else "audio"),
             "width": info["width"] or None, "height": info["height"] or None,
             "frameRate": info["fps"] if info["hasVideo"] and not image else None,
             "frameRateFraction": "{}/{}".format(*rate_fraction(info["fps"])) if info["hasVideo"] and not image else None,
             "hasAudio": info["hasAudio"]}
        media.append(m)
        mid[uri] = m["id"]
        return m["id"]

    base = {"speed": 1.0, "volume": 1.0, "preservePitch": True, "fadeIn": 0.0, "fadeOut": 0.0, "filters": [],
            "videoEffects": [], "offsetX": 0.0, "offsetY": 0.0, "opacity": 1.0, "rotation": 0.0, "scale": 1.0}
    clips = []
    cursor = 0.0
    for s in plan["segments"]:
        img = bool(s.get("image"))
        m = med(s["uri"], img)
        kind = "image" if img else ("video" if s.get("hasVideo", True) else "audio")
        pieces = [(float(s["in"]), float(s["out"]), 1.0, 0.5, 0.5)] if img else split_zooms(s)
        fx = seg_fx(s) if s.get("kind") == "main" else seg_fx({"vol": s.get("vol", 1)})
        for a, b, sc, cx, cy in pieces:
            d = (b - a) / fx["speed"]
            if d <= 0.0005:
                continue
            c = {**base, "id": f"c{len(clips) + 1}", "trackId": "T1", "kind": kind, "mediaId": m,
                 "name": Path(s["uri"]).name, "start": round(cursor, 6), "duration": round(d, 6),
                 "sourceStart": round(0.0 if img else a, 6), "speed": round(fx["speed"], 4), "volume": round(fx["vol"], 3)}
            if sc > 1.001:
                c.update(scale=round(sc, 4), offsetX=round((cx - 0.5) * (1 - sc), 4), offsetY=round((cy - 0.5) * (1 - sc), 4))
            kf0 = sorted([k for k in (s.get("kf") or []) if isinstance(k, dict)], key=lambda k: float(k["t"]))
            if kf0:
                fx = {**fx, "sc": max(0.05, float(kf0[0].get("sc") or 1)), "tx": float(kf0[0].get("tx") or 0), "ty": float(kf0[0].get("ty") or 0)}
            if abs(fx["sc"] - 1) > 1e-3 or fx["tx"] or fx["ty"]:
                c.update(scale=round(c["scale"] * fx["sc"], 4), offsetX=round(c["offsetX"] * fx["sc"] + fx["tx"], 4), offsetY=round(c["offsetY"] * fx["sc"] + fx["ty"], 4))
            clips.append(c)
            cursor += d
    ovl_tracks: set[int] = set()
    aud_tracks: set[int] = set()
    for o in plan.get("overlays") or []:
        img = bool(o.get("image"))
        m = med(o["uri"], img)
        d = float(o["out"]) - float(o["in"])
        trk = int(o.get("track") or 1)
        if o.get("mode") == "audio":   # Tonspur
            aud_tracks.add(trk)
            clips.append({**base, "id": f"c{len(clips) + 1}", "trackId": f"A{trk}", "kind": "audio", "mediaId": m, "name": Path(o["uri"]).name,
                          "start": round(float(o["at"]), 6), "duration": round(d, 6), "sourceStart": round(float(o["in"]), 6),
                          "volume": round(float(o.get("vol", 1) if o.get("vol") is not None else 1), 3)})
            continue
        c = {**base, "id": f"c{len(clips) + 1}", "trackId": f"V{trk}", "kind": "image" if img else "video", "mediaId": m,
             "name": Path(o["uri"]).name, "start": round(float(o["at"]), 6), "duration": round(d, 6),
             "sourceStart": round(0.0 if img else float(o["in"]), 6), "volume": round(float(o.get("vol") or 0), 3)}
        ovl_tracks.add(trk)
        if o.get("mode") == "pip" or o.get("w") is not None:
            x, y = pip_center(o, W, H)
            c.update(scale=pip_scale(o, W, H), offsetX=round(x - 0.5, 4), offsetY=round(y - 0.5, 4))
        else:
            c.update(scale=round(cover_factor(o.get("width") or 0, o.get("height") or 0, W, H), 4))
        clips.append(c)
    outline = style.get("outline", True)
    for cu in cues:
        d = min(cu["end"], cursor) - cu["start"]
        if d <= 0:
            continue
        clips.append({**base, "id": f"c{len(clips) + 1}", "trackId": "T5" if cu.get("src") else "T4" if cu.get("line") else "T3", "kind": "text", "mediaId": "",
                      "name": cu["text"].split("\n")[0][:40], "start": round(cu["start"], 6), "duration": round(d, 6),
                      "offsetX": round(cu["x"] - 0.5, 4), "offsetY": round(cu["y"] - 0.5, 4),
                      "text": {"content": cu["text"], "fontSize": round(cu["size"] * 0.78, 4) if cu.get("size") else CONCAT_SIZES.get(style.get("size", "mittel"), 0.045),
                               "fontWeight": 700, "italic": False, "color": (cu.get("color") or style.get("color") or "#FFFFFF").lower(),
                               "align": "center", "opacity": 1.0, "strokeWidth": 0.0045 if outline else 0.0,
                               "strokeColor": str(style.get("outlineColor") or "#000000"), "shadow": bool(outline), "background": "", "lineHeight": 1.2,
                               "tracking": 0.0, "maxWidth": 0.9, "maxHeight": 0.0}})
    for c in clips:   # nicht benötigte Felder bei Textclips entfernen
        if c["kind"] == "text":
            c.pop("sourceStart", None)
            c.pop("preservePitch", None)
    # Spuren: T1 Hauptspur, Videospuren V1…, T3 Untertitel und Titel, T4 Textzeile, T5 Quellenzeilen (Reihenfolge der Liste = Stapel)
    text_tracks = (3, 4, 5) if any(c.get("src") for c in cues) else (3, 4)
    tracks = [{"id": "T1", "muted": False, "visible": True}] + [{"id": f"V{k}", "muted": False, "visible": True} for k in sorted(ovl_tracks)] + \
             [{"id": f"T{i}", "muted": False, "visible": True} for i in text_tracks] + [{"id": f"A{k}", "muted": False, "visible": True} for k in sorted(aud_tracks)]
    timeline = {"id": "TL1", "name": "Timeline 1", "tracks": tracks, "clips": clips, "video": video}
    doc = {"activeTimelineId": "TL1", "clips": clips, "concat": "0.1.0", "fonts": [], "media": media,
           "name": folder.name, "timelines": [timeline], "tracks": tracks, "version": 1, "video": video}
    check_concat(doc)
    (folder / "concat.json").write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    if spoken_cues(cues):
        write_srt(spoken_cues(cues), folder / f"{safe_name(name)}.srt")
    log(f"Concat-Projekt: {folder} · {len(clips)} Clips")
    return folder


def check_concat(doc: dict):
    """Die Laderegeln von Concat nachgeprüft (doc.rs: settle_timeline/settle_clip)."""
    if doc.get("version", 1) > 1:
        raise RuntimeError("Concat-Dokumentversion zu neu.")
    mids = {m["id"] for m in doc["media"] if m.get("id")}
    for tl in doc["timelines"]:
        tids = {t["id"] for t in tl["tracks"] if t.get("id")}
        if not tl.get("id") or not tids:
            raise RuntimeError("Concat-Timeline ohne Spuren.")
        for c in tl["clips"]:
            if not c.get("id") or c["trackId"] not in tids:
                raise RuntimeError(f"Clip {c.get('id')} liegt auf keiner Spur.")
            if c["kind"] in ("video", "audio", "image") and c["mediaId"] not in mids:
                raise RuntimeError(f"Clip {c['id']} verweist auf fehlendes Medium.")
            if c["duration"] <= 0:
                raise RuntimeError(f"Clip {c['id']} hat keine Länge.")


# ───────────────────────────── Export: CapCut-Entwurf ─────────────────────────────

def _uid() -> str:
    return str(uuid.uuid4()).upper()


MATERIAL_KEYS = [
    "ai_translates", "audio_balances", "audio_effects", "audio_fades", "audio_track_indexes", "audios",
    "beats", "canvases", "chromas", "color_curves", "common_mask", "digital_human_model_dressing",
    "digital_humans", "drafts", "effects", "flowers", "green_screens", "handwrites", "hsl", "images",
    "log_color_wheels", "loudnesses", "manual_beautys", "manual_deformations", "material_animations",
    "material_colors", "multi_language_refs", "placeholder_infos", "placeholders", "plugin_effects",
    "primary_color_wheels", "realtime_denoises", "shapes", "smart_crops", "smart_relights",
    "sound_channel_mappings", "speeds", "stickers", "tail_leaders", "text_templates", "texts", "time_marks",
    "transitions", "video_effects", "video_trackings", "videos", "vocal_beautifys", "vocal_separations",
]
CAPCUT_SIZES = {"klein": 6.0, "mittel": 8.0, "groß": 11.0}
VISUAL = {"enable_adjust": True, "enable_color_correct_adjust": False, "enable_color_curves": True,
          "enable_color_match_adjust": False, "enable_color_wheels": True, "enable_lut": True,
          "enable_smart_color_adjust": False}


def capcut_text(text: str, style: dict, cue: dict | None = None) -> tuple[dict, str]:
    cue = cue or {}
    r, g, b = hex_rgb(cue.get("color") or style.get("color", "#FFFFFF"))
    outline = cue["outline"] if cue.get("outline") is not None else style.get("outline", True)
    sr, sg, sb = hex_rgb(cue.get("outlineColor") or ("" if cue.get("title") else style.get("outlineColor")) or "#000000")
    content = {"styles": [{
        "fill": {"alpha": 1.0, "content": {"render_type": "solid", "solid": {"alpha": 1.0, "color": [r / 255, g / 255, b / 255]}}},
        "range": [0, len(text.encode("utf-16-le")) // 2],
        "size": round(cue["size"] / 0.058 * 8.0, 2) if cue.get("size") else CAPCUT_SIZES.get(style.get("size", "mittel"), 8.0),
        "bold": False, "italic": False, "underline": False,
        "strokes": [{"content": {"solid": {"alpha": 1.0, "color": [sr / 255, sg / 255, sb / 255]}}, "width": 0.08}] if outline else [],
    }], "text": text}
    mid = uuid.uuid4().hex
    material = {"id": mid, "content": json.dumps(content, ensure_ascii=False), "typesetting": 0, "alignment": 1,
                "letter_spacing": 0.0, "line_spacing": 0.02, "line_feed": 1, "line_max_width": 0.82,
                "force_apply_line_max_width": False, "check_flag": 15 if outline else 7, "type": "text", "global_alpha": 1.0}
    return material, mid


def write_capcut(plan: dict, root: Path, name: str, cues: list[dict], style: dict) -> Path:
    """CapCut-Entwurf: Hauptspur (Schnitte, Einschübe, Zooms), Overlay-Spur (B-Roll, Bild-im-Bild), Textspur."""
    folder = root / safe_name(name)
    n = 2
    while folder.exists():
        folder = root / f"{safe_name(name)} ({n})"
        n += 1
    folder.mkdir(parents=True)
    us = lambda t: int(round(t * 1_000_000))  # noqa: E731
    W, H = int(plan["width"]), int(plan["height"])
    materials = {k: [] for k in MATERIAL_KEYS}
    mats: dict[str, tuple[str, str, dict]] = {}
    any_video = any(s.get("hasVideo", True) or s.get("image") for s in plan["segments"])
    now = int(time.time())
    meta_values = []

    def material(uri: str, image: bool, crop: dict | None = None) -> tuple[str, str, dict]:
        uri = norm_path(uri)
        l, t_, r_, b_ = ((max(0.0, min(0.98, float((crop or {}).get(k) or 0))) for k in ("l", "t", "r", "b")))
        key = uri + (f"|{l:.4f},{t_:.4f},{r_:.4f},{b_:.4f}" if crop else "")
        if key in mats:
            return mats[key]
        info = probe(uri)
        mid = uuid.uuid4().hex
        dur = us(10800.0 if image else info["duration"])
        if info["hasVideo"] or image:
            materials["videos"].append({
                "audio_fade": None, "category_id": "", "category_name": "local", "check_flag": 63487,
                "crop": {"upper_left_x": l, "upper_left_y": t_, "upper_right_x": 1.0 - r_, "upper_right_y": t_,
                         "lower_left_x": l, "lower_left_y": 1.0 - b_, "lower_right_x": 1.0 - r_, "lower_right_y": 1.0 - b_},
                "crop_ratio": "free", "crop_scale": 1.0, "duration": dur, "height": info["height"], "id": mid,
                "local_material_id": "", "material_id": mid, "material_name": Path(uri).name, "media_path": "",
                "path": uri, "type": "photo" if image else "video", "width": info["width"]})
            kind = "video"
        else:
            materials["audios"].append({
                "app_id": 0, "category_id": "", "category_name": "local", "check_flag": 1, "duration": dur,
                "effect_id": "", "formula_id": "", "id": mid, "intensifies_path": "", "local_material_id": mid,
                "music_id": mid, "name": Path(uri).name, "path": uri, "query": "", "request_id": "",
                "resource_id": "", "search_id": "", "source_platform": 0, "team_id": "", "text_id": "",
                "tone_category_id": "", "tone_category_name": "", "tone_effect_id": "", "tone_effect_name": "",
                "tone_speaker": "", "tone_type": "", "type": "extract_music", "video_id": "", "wave_points": []})
            kind = "audio"
        if not any(m["file_Path"] == uri for m in meta_values):
          meta_values.append({"create_time": now, "duration": dur, "extra_info": Path(uri).name, "file_Path": uri,
                            "height": info["height"], "id": _uid(), "import_time": now, "import_time_ms": now * 1_000_000,
                            "item_source": 1, "md5": "", "metetype": "photo" if image else ("video" if kind == "video" else "music"),
                            "roughcut_time_range": {"duration": -1, "start": -1},
                            "sub_time_range": {"duration": -1, "start": -1}, "type": 0, "width": info["width"]})
        mats[key] = (mid, kind, info)
        return mats[key]

    def segment(mid: str, kind: str, target: float, src: float | None, d: float, volume=1.0, scale=1.0, tx=0.0, ty=0.0, render=0, speed=1.0, alpha=1.0):
        speed_id = uuid.uuid4().hex
        materials["speeds"].append({"curve_speed": None, "id": speed_id, "mode": 0, "speed": speed, "type": "speed"})
        seg = {"last_nonzero_volume": 1.0, "reverse": False, "track_attribute": 0, "track_render_index": 0,
               "visible": True, "id": uuid.uuid4().hex, "material_id": mid,
               "target_timerange": {"start": us(target), "duration": us(d)}, "common_keyframes": [], "keyframe_refs": [],
               "source_timerange": {"start": us(src or 0.0), "duration": us(d * speed)}, "speed": speed, "volume": volume,
               "extra_material_refs": [speed_id], "is_tone_modify": False}
        if kind == "video":
            seg.update(VISUAL)
            seg.update({"clip": {"alpha": alpha, "flip": {"horizontal": False, "vertical": False}, "rotation": 0.0,
                                 "scale": {"x": scale, "y": scale}, "transform": {"x": tx, "y": ty}},
                        "uniform_scale": {"on": True, "value": 1.0},
                        "hdr_settings": {"intensity": 1.0, "mode": 1, "nits": 1000}, "render_index": render})
        else:
            seg.update({"clip": None, "uniform_scale": None, "hdr_settings": None, "render_index": 0})
        return seg

    main_segs, audio_segs = [], []
    cursor = 0.0
    for s in plan["segments"]:
        img = bool(s.get("image"))
        mid, kind, _ = material(s["uri"], img)
        samples = [] if img else main_kf_samples(s)
        pieces = [(float(s["in"]), float(s["out"]), 1.0, 0.5, 0.5)] if (img or samples) else split_zooms(s)
        fx = seg_fx(s) if s.get("kind") == "main" else seg_fx({"vol": s.get("vol", 1)})
        for a, b, sc, cx, cy in pieces:
            d = (b - a) / fx["speed"]
            if d <= 0.0005:
                continue
            tx, ty = (2 * (cx - 0.5) * (1 - sc), 2 * (cy - 0.5) * (sc - 1)) if sc > 1.001 else (0.0, 0.0)
            # Lage/Größe des Clips: zuerst Zoom, dann skaliert um die Mitte und verschoben
            tx, ty, sc = tx * fx["sc"] + 2 * fx["tx"], ty * fx["sc"] - 2 * fx["ty"], sc * fx["sc"]
            if samples:   # Keyframes der Hauptspur: erste Stützstelle fest, Verlauf als CapCut-Keyframes
                sc, tx, ty = samples[0][1], samples[0][2], samples[0][3]
            seg = segment(mid, kind, cursor, 0.0 if img else a, d, volume=round(fx["vol"], 3), scale=round(sc, 4), tx=round(tx, 4), ty=round(ty, 4), speed=round(fx["speed"], 4))
            if samples and kind == "video":
                props = {"KFTypePositionX": 2, "KFTypePositionY": 3, "KFTypeScaleX": 1, "KFTypeScaleY": 1}
                seg["common_keyframes"] = [{"id": uuid.uuid4().hex, "material_id": "", "property_type": prop, "keyframe_list": [
                    {"curveType": "Line", "graphID": "", "id": uuid.uuid4().hex, "left_control": {"x": 0.0, "y": 0.0}, "right_control": {"x": 0.0, "y": 0.0},
                     "time_offset": int(round((t - a) / fx["speed"] * 1_000_000)), "values": [smp[idx]]} for smp in samples for t in [smp[0]]]}
                    for prop, idx in props.items()]
            (main_segs if kind == "video" else audio_segs).append(seg)
            cursor += d
    tracks = []
    if main_segs:
        tracks.append({"attribute": 0, "flag": 0, "id": uuid.uuid4().hex, "is_default_name": True, "name": "",
                       "segments": main_segs, "type": "video"})
    if audio_segs:
        tracks.append({"attribute": 0, "flag": 0, "id": uuid.uuid4().hex, "is_default_name": True, "name": "",
                       "segments": audio_segs, "type": "audio"})
    by_track: dict[int, list] = {}
    aud_by: dict[int, list] = {}
    for o in plan.get("overlays") or []:
        img = bool(o.get("image"))
        mid, kind, info = material(o["uri"], img, o.get("crop"))
        d = float(o["out"]) - float(o["in"])
        trk = int(o.get("track") or 1)
        vol = round(float(o.get("vol") or 0), 3)
        if o.get("mode") == "audio":   # Tonspur (Musik, Geräusche)
            aud_by.setdefault(trk, []).append(segment(mid, "audio", float(o["at"]), float(o["in"]), d, volume=vol))
            continue
        if o.get("mode") == "pip" or o.get("w") is not None:
            x, y = pip_center(o, W, H)
            seg = segment(mid, "video", float(o["at"]), 0.0 if img else float(o["in"]), d, volume=vol,
                          scale=pip_scale(o, W, H), tx=round((x - 0.5) * 2, 4), ty=round((0.5 - y) * 2, 4), render=trk,
                          alpha=round(float(o.get("opacity") if o.get("opacity") is not None else 1), 3))
            seg["common_keyframes"] = capcut_keyframes(o, W, H)
        else:
            seg = segment(mid, "video", float(o["at"]), 0.0 if img else float(o["in"]), d, volume=vol,
                          scale=round(cover_factor(info["width"], info["height"], W, H), 4), render=trk)
        by_track.setdefault(trk, []).append(seg)
    for trk in sorted(by_track):
        # Formen und abgedeckte Bereiche (Spuren ab 100) liegen über allem Bildmaterial und heißen in CapCut auch so
        tracks.append({"attribute": 0, "flag": 0, "id": uuid.uuid4().hex, "is_default_name": False, "name": f"Formen {trk - 99}" if trk >= 100 else f"Video {trk + 1}",
                       "segments": by_track[trk], "type": "video"})
    for trk in sorted(aud_by):
        tracks.append({"attribute": 0, "flag": 0, "id": uuid.uuid4().hex, "is_default_name": False, "name": f"Ton {trk}",
                       "segments": aud_by[trk], "type": "audio"})
    # Textspuren: Untertitel und Titel auf einer, die dauerhafte Textzeile auf einer eigenen (so lässt sie sich in CapCut für sich ausblenden)
    # und die Quellenzeilen auf einer dritten: Sie überschneiden sich zeitlich mit der Textzeile
    for tname, tcues in (("Untertitel", [c for c in cues if not c.get("line")]), ("Textzeile", [c for c in cues if c.get("line") and not c.get("src")]),
                         ("Quellen", [c for c in cues if c.get("line") and c.get("src")])):
        if not tcues:
            continue
        tsegs = []
        for c in tcues:
            d = min(c["end"], cursor) - c["start"]
            if d <= 0:
                continue
            mat, mid = capcut_text(c["text"], style, c)
            materials["texts"].append(mat)
            tsegs.append({**VISUAL, "last_nonzero_volume": 1.0, "reverse": False, "track_attribute": 0,
                          "track_render_index": 0, "visible": True, "id": uuid.uuid4().hex, "material_id": mid,
                          "target_timerange": {"start": us(c["start"]), "duration": us(d)}, "common_keyframes": [],
                          "keyframe_refs": [], "source_timerange": None, "speed": 1.0, "volume": 1.0,
                          "extra_material_refs": [],
                          "clip": {"alpha": 1.0, "flip": {"horizontal": False, "vertical": False}, "rotation": 0.0,
                                   "scale": {"x": 1.0, "y": 1.0},
                                   "transform": {"x": round((c["x"] - 0.5) * 2, 4), "y": round((0.5 - c["y"]) * 2, 4)}},
                          "uniform_scale": {"on": True, "value": 1.0}, "render_index": 15000})
        tracks.append({"attribute": 0, "flag": 0, "id": uuid.uuid4().hex, "is_default_name": False,
                       "name": tname, "segments": tsegs, "type": "text"})
    if not any_video:
        W, H = 1920, 1080
    plat = {"app_id": 359289, "app_source": "cc", "app_version": "6.7.0",
            "os": {"Windows": "windows", "Darwin": "mac"}.get(platform.system(), "windows")}
    total = us(cursor)
    content = {
        "canvas_config": {"width": W, "height": H, "ratio": "original"},
        "color_space": 0, "config": {
            "adjust_max_index": 1, "attachment_info": [], "combination_max_index": 1, "export_range": None,
            "extract_audio_last_index": 1, "lyrics_recognition_id": "", "lyrics_sync": True,
            "lyrics_taskinfo": [], "maintrack_adsorb": True, "material_save_mode": 0,
            "multi_language_current": "none", "multi_language_list": [], "multi_language_main": "none",
            "multi_language_mode": "none", "original_sound_last_index": 1, "record_audio_last_index": 1,
            "sticker_max_index": 1, "subtitle_keywords_config": None, "subtitle_recognition_id": "",
            "subtitle_sync": True, "subtitle_taskinfo": [], "system_font_list": [], "use_float_render": False,
            "video_mute": False, "zoom_info_params": None},
        "cover": None, "create_time": 0, "duration": total, "extra_info": None,
        "fps": float(plan.get("fps") or 30.0), "free_render_index_mode_on": False, "group_container": None,
        "id": _uid(), "is_drop_frame_timecode": False, "keyframe_graph_list": [],
        "keyframes": {k: [] for k in ["adjusts", "audios", "effects", "filters", "handwrites", "stickers", "texts", "videos"]},
        "last_modified_platform": plat, "lyrics_effects": [], "materials": materials, "mutable_config": None,
        "name": "", "new_version": "140.0.0", "path": "", "platform": plat, "relationships": [],
        "render_index_track_mode_on": False, "retouch_cover": None, "source": "default", "static_cover_image_path": "",
        "time_marks": None, "tracks": tracks, "update_time": 0, "version": 360000,
    }
    txt = json.dumps(content, ensure_ascii=False)
    (folder / "draft_content.json").write_text(txt, encoding="utf-8")
    (folder / "draft_info.json").write_text(txt, encoding="utf-8")  # macOS-Variante
    meta = {
        "draft_cover": "", "draft_fold_path": str(folder), "draft_id": _uid(), "draft_is_from_deeplink": "false",
        "draft_is_invisible": False,
        "draft_materials": [{"type": 0, "value": meta_values}] + [{"type": t, "value": []} for t in (1, 2, 3, 6, 7, 8)],
        "draft_materials_copied_info": [], "draft_name": folder.name, "draft_new_version": "",
        "draft_removable_storage_device": "", "draft_root_path": str(root), "draft_segment_extra_info": [],
        "draft_timeline_materials_size_": 0, "draft_type": "", "tm_draft_create": now * 1_000_000,
        "tm_draft_modified": now * 1_000_000, "tm_draft_removed": 0, "tm_duration": total,
    }
    (folder / "draft_meta_info.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return folder


# ───────────────────────────── Export-Auftrag ─────────────────────────────

def export_job(job: dict, plan: dict):
    fmt = plan.get("format") or "video"
    first = next((s for s in plan.get("sources") or [] if s.get("uri")), None) or {"uri": plan["segments"][0]["uri"]}
    src = Path(norm_path(first["uri"]))
    outdir = src.parent / f"{src.stem}_honeycut"
    stem = safe_name(plan.get("name") or f"{src.stem}_geschnitten")
    subs = plan.get("subs") or {}
    cues = clean_cues(subs.get("cues"))
    style = subs.get("style") or {}
    files: list[Path] = []
    result: dict = {}
    job["message"] = "Exportiere …"
    log(f"Export {fmt}: {len(plan['segments'])} Abschnitte, {len(plan.get('overlays') or [])} Overlays, {len(cues)} Untertitel")
    if fmt in ("video", "audio"):
        outdir.mkdir(exist_ok=True)
        if fmt == "video":
            out = outdir / f"{stem}.mp4"
            lost = render_plan(job, plan, out, True, cues)
            if lost:   # die Standardschrift steht im Video: nicht stillschweigend, die Oberfläche zeigt den Hinweis beim Ergebnis
                names = " und ".join([", ".join(f"„{n}“" for n in lost[:-1]), f"„{lost[-1]}“"] if len(lost) > 1 else [f"„{lost[0]}“"])
                result["warn"] = (f"Achtung: Die Schrift {names} ließ sich beim Export nicht laden. Im Video steht dafür die Standardschrift. "
                                  "Einzelheiten zeigt der Fehlerbericht (Einstellungen → Fehlerbericht).")
                log("Export: " + result["warn"])
        else:
            out = outdir / f"{stem}.{plan.get('audioFormat') or 'wav'}"
            render_plan(job, plan, out, False, [])
        files.append(out)
        result["playable"] = str(out)
        result["note"] = f"Fertig – gespeichert in {outdir}"
        if job.get("gpu"):
            result["gpu"] = job["gpu"]
            result["note"] += f" · gerechnet über die Grafikkarte ({job['gpu']})"
        elif job.get("gpu_fallback"):
            result["gpuFallback"] = job["gpu_fallback"]
            result["note"] += " · Die Grafikkarte kam nicht durch; gerechnet wurde auf dem bisherigen Weg"
    elif fmt == "capcut":
        root = capcut_drafts_dir() if plan.get("capcutInstall") else None
        if root is None:
            outdir.mkdir(exist_ok=True)
        folder = write_capcut(plan, root or outdir, stem, cues, style)
        files.append(folder)
        if root is None:
            zp = shutil.make_archive(str(outdir / f"{folder.name}_capcut"), "zip", folder.parent, folder.name)
            files.append(Path(zp))
            result["note"] = "Fertig – CapCut-Projekt als Ordner und ZIP gespeichert."
        else:
            result["note"] = "Fertig – öffne CapCut, das Projekt steht in deinen Entwürfen."
    elif fmt == "concat":
        folder = write_concat(plan, stem, cues, style)
        files.append(folder)
        outdir = folder
        result["note"] = f"Fertig – Concat-Projekt in {folder}"
    else:
        raise RuntimeError(f"Unbekanntes Format: {fmt}")
    if spoken_cues(cues) and fmt != "concat":   # die SRT-Datei enthält die Untertitel; Titel und Textzeile stehen im Bild
        outdir.mkdir(exist_ok=True)
        # Sind die Untertitel ins Video eingebrannt, trägt die SRT-Datei einen anderen Namen als das Video: Viele
        # Abspielprogramme (z. B. VLC) blenden eine gleichnamige SRT-Datei von selbst ein – dann stünden die Untertitel doppelt
        # im Bild, die eingeblendeten in der Schrift des Abspielprogramms. Die frühere Datei desselben Exports weicht.
        plain, apart = outdir / f"{stem}.srt", outdir / f"Untertitel – {stem}.srt"
        srt, old = (apart, plain) if fmt == "video" and plan.get("burn", True) else (plain, apart)
        write_srt(spoken_cues(cues), srt)
        try:
            old.unlink(missing_ok=True)
        except OSError as e:
            log(f"SRT-Datei {old.name} ließ sich nicht entfernen: {e!r}")
        files.append(srt)
    # Textfassung (gesprochener Text mit Kapiteln, Sprecher:innen und Quellen): liegt neben dem Video bzw. der Tonspur
    tf = plan.get("textfile")
    if fmt in ("video", "audio") and isinstance(tf, dict) and str(tf.get("text") or "").strip():
        txt = outdir / f"{stem} – Textfassung.txt"
        txt.write_text(str(tf["text"]).replace("\r\n", "\n"), encoding="utf-8")
        files.append(txt)
    # Beigaben eines Export-Pakets (z. B. das Titelbild): liegen im selben Ordner
    for x in (plan.get("extras") or [])[:8] if fmt in ("video", "audio") else []:
        try:
            raw = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", str(x.get("name") or "Beigabe")).strip(". ") or "Beigabe"
            name = Path(raw).stem[:100] + Path(raw).suffix.lower()[:6]
            data = base64.b64decode(str(x.get("data") or "").split(",")[-1])
            if data and len(data) < 60_000_000 and Path(name).suffix in (".jpg", ".png", ".txt", ".srt"):
                (outdir / name).write_bytes(data)
                files.append(outdir / name)
        except Exception as e:  # noqa: BLE001
            log(f"Export: Beigabe ließ sich nicht speichern: {e!r}")
    for f in files + [outdir]:
        CREATED.add(norm_path(str(f)))
    allow(files[0]) if files and files[0].is_file() else None
    result.update(files=[str(f) for f in files], folder=str(outdir))
    log(f"Export erstellt: {', '.join(result['files'])}")
    return result


PROBE_FONTS = {"poppins": "Poppins-Bold.ttf", "anton": "Anton-Regular.ttf"}


def font_selftest(keys: tuple = ("poppins", "anton")) -> dict:
    """Probe für den Selbsttest der gebauten App und für die Prüfläufe: exportiert ein kurzes Video mit eingebrannten
    Untertiteln – ohne, in der Standardschrift und in mitgelieferten Schriften – und misst am fertigen Bild nach: Die gewählte
    Schrift steht im Video (libass hat die mitgegebene Datei genommen) und der Text ist so breit, wie die Vorschau ihn zeigt."""
    tmp = Path(tempfile.mkdtemp(prefix="textschnitt_probe_"))
    w, h, text = 640, 360, "Hamburgefonstiv 123"
    try:
        video = tmp / "probe.mp4"
        subprocess.run([FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=0x305070:size={w}x{h}:rate=25", "-f", "lavfi", "-i", "sine=frequency=440",
                        "-t", "2", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", str(video)],
                       check=True, capture_output=True, stdin=subprocess.DEVNULL, **NOWIN)
        style = {"enabled": True, "mode": "lines", "size": "mittel", "x": 0.5, "y": 0.82, "color": "#FFFFFF", "outline": True}
        px = sub_px(style, w, h)

        def shot(font: str | None):
            st = {**style, **({"font": font} if font else {})}
            plan = {"format": "video", "name": "probe_" + (font or ("standard" if font == "" else "ohne")), "width": w, "height": h, "fps": 25, "total": 2,
                    "segments": [{"kind": "main", "src": 0, "uri": str(video), "in": 0, "out": 2, "zooms": [], "hasAudio": True, "hasVideo": True,
                                  "speed": 1, "vol": 1, "bright": 0, "contrast": 0, "sat": 0, "gray": False, "tx": 0, "ty": 0, "sc": 1}],
                    "overlays": [], "burn": font is not None, "quality": "klein",
                    "subs": {"cues": [{"start": 0.1, "end": 1.9, "text": text, "x": 0.5, "y": 0.82}], "style": st,
                             "fonts": {font: {"family": "TS " + font, "file": PROBE_FONTS[font]}} if font else {}},
                    "sources": [{"uri": str(video), "name": video.name, "duration": 2, "width": w, "height": h, "fps": 25, "hasAudio": True, "hasVideo": True}]}
            res = export_job({"cancel": False, "progress": 0, "message": ""}, plan)
            raw = subprocess.run([FFMPEG, "-v", "error", "-ss", "1", "-i", res["playable"], "-frames:v", "1", "-vf", f"crop={w}:120:0:{h - 120}",
                                  "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"], capture_output=True, stdin=subprocess.DEVNULL, **NOWIN).stdout
            return raw, res.get("warn")

        def span(raw: bytes, ref: bytes) -> int:   # Breite der Stelle, an der sich das Bild durch den Untertitel ändert
            cols = [x for x in range(w) if any(abs(raw[y * w + x] - ref[y * w + x]) > 40 for y in range(120))] if len(raw) == len(ref) == w * 120 else []
            return cols[-1] - cols[0] + 1 if cols else 0

        ref, _ = shot(None)
        out: dict = {"ok": True, "schriften": {}}
        frames = {}
        for key in ("",) + tuple(keys):
            raw, warn = shot(key)
            frames[key] = raw
            face = FontFace((WEB_DIR / "fonts" / PROBE_FONTS[key]).read_bytes()) if key else standard_face()
            want = face.width(text) * px + 2 * max(1.0, px / 14) if face else 0
            got = span(raw, ref)
            other = sum(1 for a, b in zip(frames[""], raw) if abs(a - b) > 40) / max(1, len(raw)) if key and len(raw) == len(frames[""]) else None
            good = not warn and got > 0 and (not want or abs(got / want - 1) < 0.08) and (other is None or other > 0.01)
            out["schriften"][key or "standard"] = {"breite": got, "soll": round(want, 1), "hinweis": warn, "anders_als_standard": None if other is None else round(other, 4), "ok": good}
            out["ok"] = out["ok"] and good
        return out
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def ton_selftest() -> dict:
    """Probe für den Selbsttest der gebauten App und für die Prüfläufe: ein kurzer Export mit „Musik weicht der Sprache“,
    „Stimme aufbereiten“ und einem Übergang – gerechnet mit dem mitgelieferten ffmpeg und numpy – neben demselben Export ohne
    die drei. Gemessen wird am fertigen Video: Die Musik ist im abgesenkten Teil leiser, das Brummen der Aufnahme ist
    zurückgenommen, und im Fenster des Übergangs steht schon das Bild des nächsten Clips."""
    import numpy as np
    tmp = Path(tempfile.mkdtemp(prefix="textschnitt_ton_"))
    w, h, fps = 320, 180, 25
    out: dict = {"ok": False}
    try:
        # Aufnahme: Die Helligkeit steigt mit jedem Bild um zwei Stufen (so verrät ein Bild, aus welcher Stelle es stammt);
        # der Ton: Tonstöße bei 800 Hz über einem Brummen bei 50 Hz. Musik: ein Dauerton bei 3 kHz.
        video, musik = tmp / "aufnahme.mp4", tmp / "musik.wav"
        subprocess.run([FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=black:size={w}x{h}:rate={fps},format=yuv420p,geq=lum='16+2*N':cb=128:cr=128",
                        "-f", "lavfi", "-i", "aevalsrc='0.05*sin(2*PI*50*t)+0.12*sin(2*PI*800*t)*lt(mod(t,0.5),0.3)':s=48000:c=stereo", "-t", "4",
                        "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-g", "25", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", str(video)],
                       check=True, capture_output=True, stdin=subprocess.DEVNULL, **NOWIN)
        subprocess.run([FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=3000:sample_rate=48000", "-t", "5", "-af", "volume=0.5", "-ac", "2", str(musik)],
                       check=True, capture_output=True, stdin=subprocess.DEVNULL, **NOWIN)

        def seg(a, b, **kw):
            return {"kind": "main", "src": 0, "uri": str(video), "in": a, "out": b, "zooms": [], "hasAudio": True, "hasVideo": True, "speed": 1, "vol": 1,
                    "bright": 0, "contrast": 0, "sat": 0, "gray": False, "tx": 0, "ty": 0, "sc": 1, **kw}

        def run(name, full):
            vo = {"voice": {"k": "s0"}} if full else {}
            plan = {"format": "video", "name": name, "width": w, "height": h, "fps": fps, "total": 3.2, "quality": "klein", "burn": False,
                    "segments": [seg(0, 1.6, **vo), seg(2.4, 4.0, **vo)],
                    "overlays": [{"mode": "audio", "uri": str(musik), "in": 0, "out": 3.2, "at": 0, "track": 1, "vol": 1, "hasAudio": True, **({"duck": True} if full else {})}],
                    "sources": [{"uri": str(video), "name": video.name, "duration": 4, "width": w, "height": h, "fps": fps, "hasAudio": True, "hasVideo": True}]}
            if full:   # Musik ab 1,2 s um 14 dB zurück; „Bild früher“: 0,4 s vor dem Schnitt bei 1,6 s
                plan["duck"] = [[0, 1], [1.0, 1], [1.2, 0.2], [9, 0.2]]
                plan["trans"] = [{"at": 1.2, "d": 0.4, "a0": 1, "a1": 1, "lead": 0, "tail": 0.1, "over": 0, "seg": {**seg(2.0, 2.5), "hasAudio": False, "vol": 0}}]
            res = export_job({"cancel": False, "progress": 0, "message": ""}, plan)
            raw = subprocess.run([FFMPEG, "-v", "error", "-i", res["playable"], "-vn", "-ac", "1", "-ar", "48000", "-f", "s16le", "pipe:1"],
                                 capture_output=True, stdin=subprocess.DEVNULL, **NOWIN).stdout
            pcm = np.frombuffer(raw, dtype="<i2").astype(float) / 32768
            pic = subprocess.run([FFMPEG, "-v", "error", "-i", res["playable"], "-an", "-vf", "scale=8:8:flags=area,format=gray", "-f", "rawvideo", "pipe:1"],
                                 capture_output=True, stdin=subprocess.DEVNULL, **NOWIN).stdout
            return pcm, [sum(pic[k * 64:(k + 1) * 64]) / 64 for k in range(len(pic) // 64)]

        def band(x, a, b, lo, hi):   # Pegel eines Frequenzbands in einem Zeitfenster (dB)
            part = x[int(a * 48000): int(b * 48000)]
            if len(part) < 1000:
                return -200.0
            sp = np.abs(np.fft.rfft(part * np.hanning(len(part)))) ** 2
            fr = np.fft.rfftfreq(len(part), 1 / 48000)
            return float(10 * np.log10(sp[(fr >= lo) & (fr <= hi)].sum() / len(part) ** 2 + 1e-15))
        p0, y0 = run("probe_ton_ohne", False)
        p1, y1 = run("probe_ton_mit", True)
        out["absenkung_db"] = round((band(p1, 1.6, 3.0, 2900, 3100) - band(p1, 0.2, 0.9, 2900, 3100)) - (band(p0, 1.6, 3.0, 2900, 3100) - band(p0, 0.2, 0.9, 2900, 3100)), 1)
        out["brummen_db"] = round(band(p1, 0.3, 1.5, 40, 60) - band(p0, 0.3, 1.5, 40, 60), 1)
        k = int(1.4 * fps)   # mitten im Fenster des Übergangs: ohne ihn Bild 35 der Aufnahme, mit ihm Bild 55
        out["bild"] = [round(y0[k], 1) if k < len(y0) else None, round(y1[k], 1) if k < len(y1) else None]
        out["bilder"] = [len(y0), len(y1)]
        step = 2 * 255 / 219   # zwei Stufen im Videobereich, als volle Graustufen gelesen
        want0, want1 = (16 + 2 * 35 - 16) * 255 / 219, (16 + 2 * 55 - 16) * 255 / 219
        out["ok"] = bool(-16 < out["absenkung_db"] < -12 and out["brummen_db"] < -10 and len(y0) == len(y1) and k < len(y0)
                         and abs(y0[k] - want0) < 4 * step and abs(y1[k] - want1) < 4 * step)
    except Exception as e:
        out["fehler"] = f"{type(e).__name__}: {e}"[:300]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return out


def belege_selftest() -> dict:
    """Probe für den Selbsttest der gebauten App und für die Prüfläufe: ein kurzer Export mit einem verpixelten Rechteck, einer
    weichgezeichneten Ellipse, die wandert und wächst, und einer Form darüber – gerechnet mit dem mitgelieferten ffmpeg.
    Gemessen wird am fertigen Video: Im Bereich ist das Schachbrett der Aufnahme zu Grau gemittelt, daneben steht es unverändert,
    die Form liegt scharf darüber, und vor und nach der Zeit des Bereichs ist das Bild unberührt."""
    import numpy as np
    tmp = Path(tempfile.mkdtemp(prefix="textschnitt_belege_"))
    w, h, fps = 320, 180, 25
    out: dict = {"ok": False}
    try:
        video, maske, form = tmp / "muster.mp4", tmp / "maske.png", tmp / "form.png"

        def ff(*args):
            subprocess.run([FFMPEG, "-v", "error", "-y", *args], check=True, capture_output=True, stdin=subprocess.DEVNULL, **NOWIN)
        # Aufnahme: Schachbrett aus 4 Pixel großen Feldern; Maske der Ellipse (weiß = Bereich); eine weiße Form
        ff("-f", "lavfi", "-i", f"color=c=black:size={w}x{h}:rate={fps},format=gray,geq=lum='16+219*mod(floor(X/4)+floor(Y/4)\\,2)'", "-t", "3",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-g", "25", "-pix_fmt", "yuv420p", str(video))
        ff("-f", "lavfi", "-i", "color=c=black:size=96x96,format=gray,geq=lum='255*lte(pow((X+0.5-48)/48\\,2)+pow((Y+0.5-48)/48\\,2)\\,1)'", "-frames:v", "1", str(maske))
        ff("-f", "lavfi", "-i", "color=c=white:size=16x16", "-frames:v", "1", str(form))
        plan = {"format": "video", "name": "probe_belege", "width": w, "height": h, "fps": fps, "total": 3, "quality": "hoch", "burn": False,
                "segments": [{"kind": "main", "src": 0, "uri": str(video), "in": 0, "out": 3, "zooms": [], "hasAudio": False, "hasVideo": True, "speed": 1, "vol": 1,
                              "bright": 0, "contrast": 0, "sat": 0, "gray": False, "tx": 0, "ty": 0, "sc": 1}],
                "sources": [{"uri": str(video), "name": video.name, "duration": 3, "width": w, "height": h, "fps": fps, "hasAudio": False, "hasVideo": True}],
                # Rechteck: Fenster [48, 112) × [58, 122), vier mal vier Felder zu 16 Pixeln; Ellipse: bei 1,5 s um (240, 90), 48 Pixel breit
                "blurs": [{"at": 0.8, "d": 1.4, "x": 0.25, "y": 0.5, "w": 0.2, "wmax": 0.2, "aspect": 1, "form": "rect", "kind": "pixel", "cell": 0.05},
                          {"at": 0.8, "d": 1.4, "x": 0.7, "y": 0.5, "w": 0.1, "wmax": 0.2, "aspect": 1, "form": "ellipse", "kind": "soft", "cell": 0.05, "mask": str(maske),
                           "kf": [{"t": 0, "x": 0.7, "y": 0.5, "w": 0.1}, {"t": 1.4, "x": 0.8, "y": 0.5, "w": 0.2}]}],
                "overlays": [{"mode": "pip", "image": True, "uri": str(form), "at": 0, "in": 0, "out": 3, "x": 0.25, "y": 0.5, "w": 0.05, "aspect": 1, "track": 100,
                              "vol": 0, "hasAudio": False, "width": 16, "height": 16, "rotation": 0, "top": True}]}
        res = export_job({"cancel": False, "progress": 0, "message": ""}, plan)
        raw = subprocess.run([FFMPEG, "-v", "error", "-i", res["playable"], "-an", "-f", "rawvideo", "-pix_fmt", "gray", "pipe:1"],
                             capture_output=True, stdin=subprocess.DEVNULL, **NOWIN).stdout
        fr = np.frombuffer(raw, dtype=np.uint8).reshape(-1, h, w).astype(float)
        out["bilder"] = int(len(fr))

        def span(k, x0, y0, x1, y1):   # Spanne der Helligkeit in einem Ausschnitt: groß = Schachbrett, klein = gemittelt
            p = fr[k][y0:y1, x0:x1]
            return round(float(p.max() - p.min()), 1)
        mid, pre, post = int(1.5 * fps), int(0.3 * fps), int(2.6 * fps)
        if len(fr) > post:
            links = fr[mid][62:118, 52:68]   # im Rechteck, neben der Form
            out["rechteck"] = [round(float(links.mean()), 1), span(mid, 52, 62, 68, 118)]
            out["daneben"] = span(mid, 8, 62, 40, 118)
            out["form"] = round(float(fr[mid][85:95, 75:85].mean()), 1)
            out["ellipse"] = [span(mid, 232, 82, 248, 98), span(mid, 217, 67, 223, 73)]   # Mitte gemittelt, Ecke des Rahmens unberührt
            out["davor"], out["danach"] = span(pre, 52, 62, 108, 118), span(post, 52, 62, 108, 118)
            out["ok"] = bool(out["rechteck"][1] < 40 and 105 < out["rechteck"][0] < 150 and out["daneben"] > 120 and out["form"] > 205
                             and out["ellipse"][0] < 60 and out["ellipse"][1] > 120 and out["davor"] > 120 and out["danach"] > 120)
    except Exception as e:
        out["fehler"] = f"{type(e).__name__}: {e}"[:300]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return out


def bild_selftest() -> dict:
    """Probe für den Selbsttest der gebauten App und für die Prüfläufe (2.36): ein kurzer Export eines Greenscreen-Bilds mit
    Weißabgleich und einem Bild als Hintergrund, dazu „Bild beruhigen“ an einem wandernden Ausschnitt – gerechnet mit dem
    mitgelieferten ffmpeg. Gemessen wird am fertigen Video: Das Feld mit Farbstich ist neutral, hinter ihm steht das Bild; die
    beruhigte Kopie hat dieselbe Bildzahl und steht ruhiger. „verfahren“ nennt, womit beruhigt wurde (vidstab oder deshake)."""
    import numpy as np
    tmp = Path(tempfile.mkdtemp(prefix="textschnitt_bild_"))
    w, h, fps = 320, 180, 25
    out: dict = {"ok": False, "verfahren": stab_method()}
    made: list[Path] = []
    try:
        video, bg, wolke, wackel = tmp / "gruen.mp4", tmp / "blau.png", tmp / "wolke.png", tmp / "wackel.mp4"

        def ff(*args):
            subprocess.run([FFMPEG, "-v", "error", "-y", *args], check=True, capture_output=True, stdin=subprocess.DEVNULL, **NOWIN)

        def frames(file, fmt, ch):
            raw = subprocess.run([FFMPEG, "-v", "error", "-i", str(file), "-an", "-f", "rawvideo", "-pix_fmt", fmt, "pipe:1"], capture_output=True, stdin=subprocess.DEVNULL, **NOWIN).stdout
            return np.frombuffer(raw, dtype=np.uint8).reshape((-1, h, w, ch) if ch > 1 else (-1, h, w)).astype(float)
        ff("-f", "lavfi", "-i", f"color=c=0x00FF00:size={w}x{h}:rate={fps},drawbox=x=100:y=40:w=120:h=100:color=0xA08060:t=fill", "-t", "1",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-pix_fmt", "yuv420p", str(video))
        ff("-f", "lavfi", "-i", "color=c=0x2040C0:size=64x64", "-frames:v", "1", str(bg))
        plan = {"format": "video", "name": "probe_bild", "width": w, "height": h, "fps": fps, "total": 1, "quality": "hoch", "burn": False, "overlays": [],
                "segments": [{"kind": "main", "src": 0, "uri": str(video), "in": 0, "out": 1, "zooms": [], "hasAudio": False, "hasVideo": True, "speed": 1, "vol": 1,
                              "bright": 0, "contrast": 0, "sat": 0, "gray": False, "tx": 0, "ty": 0, "sc": 1, "wb": [0.8, 1, 1.3333],
                              "key": {"colors": ["#00ff00"], "tol": 0.3, "soft": 0.05, "spill": True, "bg": "#000000", "bgImg": str(bg)}}],
                "sources": [{"uri": str(video), "name": video.name, "duration": 1, "width": w, "height": h, "fps": fps, "hasAudio": False, "hasVideo": True}]}
        res = export_job({"cancel": False, "progress": 0, "message": ""}, plan)
        fr = frames(res["playable"], "rgb24", 3)
        if len(fr) > 12:
            out["feld"] = [round(float(v)) for v in fr[12][70:110, 130:190].reshape(-1, 3).mean(axis=0)]
            out["hintergrund"] = [round(float(v)) for v in fr[12][8:28, 8:40].reshape(-1, 3).mean(axis=0)]
        # Beruhigen: ein stehendes Wolkenmuster, dessen Ausschnitt wandert
        ff("-f", "lavfi", "-i", f"nullsrc=s={w + 80}x{h + 60}:r={fps},geq=lum='random(1)*255':cb=128:cr=128,gblur=sigma=5,eq=contrast=4", "-frames:v", "1", str(wolke))
        ff("-loop", "1", "-framerate", str(fps), "-i", str(wolke), "-vf", f"crop={w}:{h}:40+14*sin(t*9)+8*sin(t*23):30+10*cos(t*7)+6*sin(t*19)", "-t", "2",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-pix_fmt", "yuv420p", str(wackel))
        st = stabilize_job({"cancel": False, "progress": 0, "message": ""}, str(wackel), 3)
        made.append(Path(st["uri"]))
        a, b = frames(wackel, "gray", 1), frames(st["uri"], "gray", 1)
        unruhe = lambda g: round(float(np.abs(g[1:, 30:-30, 40:-40] - g[:-1, 30:-30, 40:-40]).mean()), 2)  # noqa: E731
        out["bilder"] = [int(len(a)), int(len(b))]
        out["unruhe"] = [unruhe(a), unruhe(b)]
        out["ok"] = bool(out.get("feld") and max(out["feld"]) - min(out["feld"]) <= 8 and 110 < out["feld"][1] < 140
                         and abs(out["hintergrund"][0] - 32) < 12 and abs(out["hintergrund"][2] - 192) < 14
                         and out["bilder"][0] == out["bilder"][1] and out["unruhe"][1] < out["unruhe"][0] * (0.6 if out["verfahren"] == "vidstab" else 1.0))
    except Exception as e:
        out["fehler"] = f"{type(e).__name__}: {e}"[:300]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
        for x in made:   # die Probe-Kopie gehört nicht in den Datenordner
            try:
                x.unlink(missing_ok=True)
            except OSError:
                pass
    return out


def uebergabe_selftest() -> dict:
    """Probe für den Selbsttest der gebauten App (2.37): Der Empfang für die Übergabe im Heimnetz öffnet, antwortet unter seiner
    Kennung mit Seite und Auskunft, weist eine falsche Kennung ab und schließt wieder. Gefragt wird über 127.0.0.1."""
    import urllib.error
    import urllib.request
    out: dict = {"ok": False}
    try:
        st = handover_start(None, bind="127.0.0.1")
        base = f"http://127.0.0.1:{HAND['port']}/h/{HAND['token']}"
        with urllib.request.urlopen(base + "/info", timeout=10) as r:
            info = json.loads(r.read())
        with urllib.request.urlopen(base + "/", timeout=10) as r:
            page = r.read().decode("utf-8")
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{HAND['port']}/h/falsch/info", timeout=10)
            bad = 200
        except urllib.error.HTTPError as e:
            bad = e.code
        out.update(aktiv=bool(st.get("active")), app=info.get("app"), seite="In HoneyCut öffnen" in page, falsch=bad, adressen=len(lan_ips()))
        handover_stop()
        out["zu"] = handover_state() == {"active": False}
        out["ok"] = bool(out["aktiv"] and out["app"] == "honeycut" and out["seite"] and bad == 404 and out["zu"])
    except Exception as e:
        out["fehler"] = f"{type(e).__name__}: {e}"[:300]
        try:
            handover_stop()
        except Exception:
            pass
    return out


def tonquelle_selftest() -> dict:
    """Probe für den Selbsttest der gebauten App (2.41): Zweite Tonquelle angleichen mit dem mitgelieferten ffmpeg – ein Rauschen mit
    unregelmäßigem Lautstärkeverlauf als „Kamera“, dasselbe um eine Sekunde verzögert als „Mikrofon“; erwartet wird ein Versatz von
    −1 s und ein unverändert übernommenes Bild."""
    out: dict = {"ok": False}
    tag = uuid.uuid4().hex[:8]
    cam = Path(tempfile.gettempdir()) / f"honeycut_selbsttest_{tag}.mp4"
    mic = Path(tempfile.gettempdir()) / f"honeycut_selbsttest_{tag}.wav"
    made = None
    try:
        subprocess.run([FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=10", "-f", "lavfi", "-i", "aevalsrc='(random(0)-0.5)*(0.05+0.95*lt(mod(t*t\\,1.7)\\,0.6))':s=16000",
                        "-t", "10", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", str(cam)], check=True, capture_output=True, **NOWIN)
        subprocess.run([FFMPEG, "-v", "error", "-y", "-i", str(cam), "-vn", "-af", "adelay=1000:all=1", "-ac", "1", "-ar", "16000", str(mic)], check=True, capture_output=True, **NOWIN)
        r = audio_sync_job({"id": "selbsttest", "cancel": False, "progress": 0.0, "message": "", "status": "running"}, str(cam), str(mic))
        made = Path(r["uri"])
        out.update(versatz=r["offset"], bild=r["video"], dauer=r["duration"])
        out["ok"] = bool(abs(r["offset"] + 1.0) < 0.01 and r["video"] == "copy" and abs(r["duration"] - 10) < 0.3)
    except Exception as e:
        out["fehler"] = f"{type(e).__name__}: {e}"[:300]
    finally:
        for f in (cam, mic, made, made.with_suffix(".json") if made else None):
            if f:
                f.unlink(missing_ok=True)
    return out


def folgen_selftest() -> dict:
    """Probe für den Selbsttest der gebauten App (2.39): Das Personen-Modell rechnet Masken für „Person im Bild halten“ –
    zwei Sekunden Testbild ohne Person ergeben acht Masken mit 32 × 18 Feldern; folgen.js liegt bei der Oberfläche."""
    out: dict = {"ok": False}
    mp4 = Path(tempfile.gettempdir()) / f"honeycut_selbsttest_{uuid.uuid4().hex[:8]}.mp4"
    try:
        subprocess.run([FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=10:duration=2", "-pix_fmt", "yuv420p", str(mp4)], check=True, capture_output=True, **NOWIN)
        r = person_track_job({"id": "selbsttest", "cancel": False, "progress": 0.0, "message": "", "status": "running"}, str(mp4))
        out.update(n=r["n"], felder=[r["w"], r["h"]], bytes=len(base64.b64decode(r["data"])), kern=(WEB_DIR / "folgen.js").is_file())
        out["ok"] = bool(7 <= r["n"] <= 9 and out["bytes"] == r["n"] * TRACK_W * TRACK_H and out["kern"])
    except Exception as e:
        out["fehler"] = f"{type(e).__name__}: {e}"[:300]
    finally:
        mp4.unlink(missing_ok=True)
    return out


def stimmen_selftest() -> dict:
    """Probe für den Selbsttest der gebauten App (2.38): Das mitgelieferte ffmpeg liefert den Ton für das Erkennen der Personen
    (16 kHz, mono, 16 Bit), und der Rechenkern stimmen.js liegt bei der Oberfläche."""
    out: dict = {"ok": False}
    wav = Path(tempfile.gettempdir()) / f"honeycut_selbsttest_{uuid.uuid4().hex[:8]}.wav"
    job = {"id": "selbsttest" + uuid.uuid4().hex[:6], "cancel": False, "progress": 0.0, "message": "", "status": "running"}
    try:
        subprocess.run([FFMPEG, "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=1", "-ac", "2", str(wav)], check=True, capture_output=True, **NOWIN)
        r = voice_pcm_job(job, str(wav))
        f = VOICE_PCM.pop(job["id"])
        out.update(bytes=r["bytes"], kern=(WEB_DIR / "stimmen.js").is_file())
        f.unlink(missing_ok=True)
        out["ok"] = bool(abs(r["bytes"] - 32000) < 2000 and out["kern"])
    except Exception as e:
        out["fehler"] = f"{type(e).__name__}: {e}"[:300]
    finally:
        wav.unlink(missing_ok=True)
    return out


# ───────────────────────────── Projekte ─────────────────────────────

BACKUP_DIR = DATA_DIR / "sicherungen"   # frühere Fassungen der Projekte (je Projekt ein Ordner, gepackt)
BACKUP_EVERY = 15 * 60                  # frühestens alle 15 Minuten eine weitere Fassung zurücklegen
BACKUP_KEEP = 6                         # so viele Fassungen je Projekt bleiben
_proj_lock = threading.Lock()
_list_cache: dict[str, tuple] = {}      # Dateiname → (Änderungszeit, Größe, Kurzinfo)


def proj_path(pid: str) -> Path:
    return PROJ_DIR / (re.sub(r"[^A-Za-z0-9_-]", "", pid)[:40] + ".json")


def collect_uris(obj, out: set):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in ("uri", "proxy") and isinstance(v, str):
                out.add(v)
            else:
                collect_uris(v, out)
    elif isinstance(obj, list):
        for v in obj:
            collect_uris(v, out)


def allow_all(obj) -> None:
    """Alle Dateien eines Projekts für die Oberfläche freigeben. Jede für sich: Früher brach die Schleife beim ersten Eintrag
    ab, der sich nicht als Pfad lesen ließ, und alle weiteren Dateien blieben gesperrt."""
    uris: set = set()
    try:
        collect_uris(obj, uris)
    except Exception:  # noqa: BLE001
        return
    for u in uris:
        try:
            allow(u)
        except Exception:  # noqa: BLE001
            pass


def project_summary(p: dict) -> dict:
    srcs = p.get("sources") or ([p["main"]] if p.get("main") else [])
    # Erstes Video des Projekts: daraus holt sich die Projektliste ein Vorschaubild, solange das Projekt noch nie geöffnet war
    thumb = next((str(s.get("uri") or "") for s in srcs if isinstance(s, dict) and s.get("kind") != "audio" and s.get("hasVideo") is not False and s.get("uri")), "")
    return {"id": p["id"], "name": p.get("name", ""), "updated": p.get("updated", 0),
            "duration": sum(float(s.get("duration") or 0) for s in srcs), "sources": len(srcs),
            "transcribed": bool(p.get("tokens")), "thumb": "" if not_a_path(thumb) else thumb}


def list_projects() -> list[dict]:
    """Kurzinfos aller Projekte für die Startseite. Eine Projektdatei wird nur dann neu gelesen, wenn sie sich geändert
    hat – vorher wurden bei jedem Aufruf alle Projekte vollständig eingelesen (je Projekt bis zu mehreren MB)."""
    out, seen = [], set()
    for f in PROJ_DIR.glob("*.json"):
        try:
            st = f.stat()
            seen.add(f.name)
            c = _list_cache.get(f.name)
            if not c or c[0] != st.st_mtime_ns or c[1] != st.st_size:
                c = (st.st_mtime_ns, st.st_size, project_summary(json.loads(f.read_text(encoding="utf-8"))))
                _list_cache[f.name] = c
                if c[2].get("thumb"):   # für das Vorschaubild in der Projektliste freigeben (einmal je gelesener Projektdatei)
                    allow(c[2]["thumb"])
            out.append(dict(c[2]))
        except Exception:
            continue
    for k in set(_list_cache) - seen:
        _list_cache.pop(k, None)
    return out


def backup_dir(f: Path) -> Path:
    return BACKUP_DIR / f.stem


_last_backup: dict[str, float] = {}     # Dateiname → Zeitpunkt der letzten Sicherung in dieser Sitzung
_last_stamp: dict[str, str] = {}        # Dateiname → Zeitstempel im Namen der zuletzt angelegten Fassung


def backup_project(f: Path, force: bool = False, tag: str = "") -> None:
    """Die bisherige Fassung zurücklegen, bevor sie überschrieben wird – höchstens alle 15 Minuten, die letzten sechs bleiben.
    So lässt sich ein Projekt auch dann retten, wenn ein Stand einmal kaputt gespeichert wurde. Gelesen wird sofort,
    gepackt und geschrieben im Hintergrund, damit das Speichern selbst nicht länger dauert."""
    import gzip
    try:
        if not f.exists() or f.stat().st_size < 2:
            return
        d = backup_dir(f)
        now = time.time()
        if not force:
            last = _last_backup.get(f.name)
            if last is None:
                old = sorted(d.glob("*.json.gz")) if d.is_dir() else []
                last = old[-1].stat().st_mtime if old else 0
            if now - last < BACKUP_EVERY:
                _last_backup[f.name] = last
                return
        _last_backup[f.name] = now
        data = f.read_bytes()
        # Name = Zeitpunkt, und immer später als jede vorhandene Fassung: Die Namen bestimmen die Reihenfolge, und beim
        # Ausdünnen fallen die kleinsten weg. Mehrere Sicherungen in derselben Sekunde rücken deshalb sekundenweise weiter.
        fmt = "%Y%m%d-%H%M%S"
        newest = max((x.name[:15] for x in d.glob("*.json.gz")), default="") if d.is_dir() else ""
        newest = max(newest, _last_stamp.get(f.name, ""))   # auch eine Fassung, die gerade noch im Hintergrund geschrieben wird
        t = now
        if newest and time.strftime(fmt, time.localtime(t)) <= newest:
            try:
                t = time.mktime(time.strptime(newest, fmt)) + 1
            except (ValueError, OverflowError):
                t = now
            for _ in range(7300):   # Zeitumstellung: notfalls bis zu zwei Stunden weiterrücken
                if time.strftime(fmt, time.localtime(t)) > newest:
                    break
                t += 1
        _last_stamp[f.name] = time.strftime(fmt, time.localtime(t))
        dst = d / (_last_stamp[f.name] + tag + ".json.gz")

        def work():
            try:
                d.mkdir(parents=True, exist_ok=True)
                part = dst.with_suffix(".part")
                with open(part, "wb") as fh:
                    fh.write(gzip.compress(data, 5))
                    fh.flush()
                    os.fsync(fh.fileno())
                os.replace(part, dst)
                for x in sorted(d.glob("*.json.gz"))[:-BACKUP_KEEP]:
                    x.unlink(missing_ok=True)
            except Exception as e:  # noqa: BLE001 – eine misslungene Sicherung darf das Speichern nicht verhindern
                log(f"Sicherung von {f.name} nicht möglich: {e!r}")
        if force:
            work()
        else:
            threading.Thread(target=work, daemon=True).start()
    except Exception as e:  # noqa: BLE001
        log(f"Sicherung von {f.name} nicht möglich: {e!r}")


def restore_backup(f: Path):
    """Jüngste lesbare frühere Fassung eines Projekts: (Text, Dateiname) oder None."""
    import gzip
    d = backup_dir(f)
    for x in sorted(d.glob("*.json.gz"), reverse=True) if d.is_dir() else []:
        try:
            txt = gzip.open(x, "rb").read().decode("utf-8")
            if isinstance(json.loads(txt), dict):
                return txt, x.name
        except Exception:  # noqa: BLE001
            continue
    return None


def replace_retry(tmp: Path, f: Path) -> None:
    """Datei ersetzen. Unter Windows schlägt das fehl, solange ein anderes Programm (Virenscanner, Suchindex) die Zieldatei
    kurz geöffnet hält – dann wenige Male nachfassen statt den Speichervorgang aufzugeben."""
    for k in range(8):
        try:
            os.replace(tmp, f)
            return
        except PermissionError:
            if k == 7:
                raise
            time.sleep(0.05 * (k + 1))


def load_project(pid: str) -> str:
    f = proj_path(pid)
    if not f.exists():
        return ""
    obj = None
    try:
        txt = f.read_text(encoding="utf-8")
        obj = json.loads(txt)
    except (ValueError, OSError):
        txt = ""
    if not isinstance(obj, dict):
        # Projektdatei unlesbar (abgebrochener Schreibvorgang, voller Datenträger): jüngste frühere Fassung nehmen
        rec = restore_backup(f)
        if not rec:
            log(f"Projekt {f.name} ist unlesbar und es gibt keine frühere Fassung.")
            return txt
        txt = rec[0]
        obj = json.loads(txt)
        try:
            shutil.copyfile(f, f.with_suffix(".defekt"))
            save_project(pid, txt, obj, backup=False)
        except Exception as e:  # noqa: BLE001
            log(f"Wiederhergestellte Fassung ließ sich nicht zurückschreiben: {e!r}")
        log(f"Projekt {f.name} war unlesbar – frühere Fassung {rec[1]} wiederhergestellt.")
    allow_all(obj)
    return txt


def save_project(pid: str, txt: str, obj=None, backup: bool = True):
    """Projekt sicher speichern: vollständig in eine Nebendatei schreiben, dann die bisherige Datei ersetzen.
    Ein unvollständig angekommener oder unlesbarer Stand wird abgewiesen – die letzte gute Fassung bleibt stehen."""
    if obj is None:
        try:
            obj = json.loads(txt)
        except ValueError:
            raise ValueError("Der Projektstand kam unvollständig an und wurde nicht gespeichert.")
    if not isinstance(obj, dict) or not obj.get("id"):
        raise ValueError("Der Projektstand ist unvollständig und wurde nicht gespeichert.")
    if not re.sub(r"[^A-Za-z0-9_-]", "", pid):
        raise ValueError("Projekt ohne Kennung.")
    f = proj_path(pid)
    with _proj_lock:
        if backup:
            backup_project(f)
        tmp = f.with_suffix(".tmp")
        with open(tmp, "wb") as fh:
            fh.write(txt.encode("utf-8"))
            fh.flush()
            try:
                os.fsync(fh.fileno())   # erst wirklich auf dem Datenträger, dann die bisherige Fassung ersetzen (Stromausfall, Absturz)
            except OSError:
                pass
        replace_retry(tmp, f)
        try:
            st = f.stat()
            _list_cache[f.name] = (st.st_mtime_ns, st.st_size, project_summary(obj))
        except Exception:  # noqa: BLE001
            _list_cache.pop(f.name, None)


def delete_project(pid: str) -> None:
    """Projekt löschen. Die letzte Fassung bleibt noch 30 Tage bei den Sicherungen (falls es ein Versehen war)."""
    f = proj_path(pid)
    with _proj_lock:
        backup_project(f, force=True, tag="-geloescht")
        f.unlink(missing_ok=True)
        _list_cache.pop(f.name, None)


# ───────────────────────────── Frühere Fassungen und Papierkorb ─────────────────────────────
# Beides liest die Sicherungen, die save_project und delete_project ablegen (sicherungen/<Projekt>/JJJJMMTT-HHMMSS.json.gz).

_VERSION_RE = re.compile(r"^\d{8}-\d{6}(-geloescht)?\.json\.gz$")
TRASH_DAYS = 30


def _read_backup(x: Path):
    """(Text, Objekt) einer gesicherten Fassung oder None."""
    import gzip
    try:
        txt = gzip.open(x, "rb").read().decode("utf-8")
        obj = json.loads(txt)
        return (txt, obj) if isinstance(obj, dict) else None
    except Exception:  # noqa: BLE001
        return None


def _version_info(x: Path) -> dict | None:
    r = _read_backup(x)
    if not r:
        return None
    obj = r[1]
    srcs = obj.get("sources") or ([obj["main"]] if obj.get("main") else [])
    st = x.stat()
    return {"file": x.name, "at": int(obj.get("updated") or st.st_mtime * 1000), "saved": int(st.st_mtime * 1000), "bytes": st.st_size,
            "name": obj.get("name", ""), "duration": sum(float(q.get("duration") or 0) for q in srcs), "sources": len(srcs),
            "words": sum(1 for t in obj.get("tokens") or [] if t.get("type") == "word"), "cut": len(obj.get("deleted") or []),
            "items": len(obj.get("items") or []), "cues": len(obj.get("cues") or []), "deleted": "-geloescht" in x.name}


def project_versions(pid: str) -> list[dict]:
    """Gesicherte Stände eines Projekts, jüngster zuerst."""
    d = backup_dir(proj_path(pid))
    out = [_version_info(x) for x in sorted(d.glob("*.json.gz"), reverse=True)] if d.is_dir() else []
    return [v for v in out if v]


def new_project_id() -> str:
    abc = "abcdefghijklmnopqrstuvwxyz0123456789"
    while True:
        pid = "".join(secrets.choice(abc) for _ in range(8))
        if not proj_path(pid).exists() and not backup_dir(proj_path(pid)).exists():
            return pid


def restore_version(pid: str, file: str, copy: bool) -> dict:
    """Einen gesicherten Stand zurückholen – als neues Projekt (copy) oder an die Stelle des jetzigen. Der jetzige Stand
    wird dabei selbst als Fassung zurückgelegt, das Zurückholen lässt sich also wieder umkehren."""
    f = proj_path(pid)
    if not _VERSION_RE.match(file or ""):
        raise ValueError("Unbekannte Fassung.")
    r = _read_backup(backup_dir(f) / file)
    if not r:
        raise ValueError("Diese Fassung lässt sich nicht lesen.")
    obj = r[1]
    when = time.strftime("%d.%m. %H:%M", time.localtime((obj.get("updated") or 0) / 1000 or (backup_dir(f) / file).stat().st_mtime))
    if copy:
        nid = new_project_id()
        obj["id"] = nid
        obj["name"] = f"{obj.get('name') or 'Projekt'} (Fassung vom {when})"[:120]
        obj["updated"] = int(time.time() * 1000)
        save_project(nid, json.dumps(obj, ensure_ascii=False), obj, backup=False)
        log(f"Fassung {file} von {f.name} als neues Projekt {nid} geöffnet")
        return {"id": nid, "name": obj["name"]}
    if not f.exists():
        raise ValueError("Das Projekt gibt es nicht mehr – im Papierkorb lässt es sich wiederherstellen.")
    obj["id"] = json.loads(f.read_text(encoding="utf-8")).get("id") or obj.get("id") or pid
    obj["updated"] = int(time.time() * 1000)
    with _proj_lock:
        backup_project(f, force=True)
    save_project(pid, json.dumps(obj, ensure_ascii=False), obj, backup=False)
    log(f"Projekt {f.name}: Fassung {file} zurückgeholt")
    return {"id": pid, "name": obj.get("name", "")}


def trash_list() -> list[dict]:
    """Gelöschte Projekte, deren letzte Fassung noch bei den Sicherungen liegt (30 Tage)."""
    out, now = [], time.time()
    for d in (BACKUP_DIR.iterdir() if BACKUP_DIR.is_dir() else []):
        if not d.is_dir() or (PROJ_DIR / (d.name + ".json")).exists():
            continue
        files = sorted(d.glob("*.json.gz"), reverse=True)
        v = next((i for i in (_version_info(x) for x in files) if i), None)
        if not v:
            continue
        gone = max(x.stat().st_mtime for x in files)
        out.append({**v, "id": d.name, "gone": int(gone * 1000), "left": max(0, TRASH_DAYS - int((now - gone) / 86400)),
                    "bytes": sum(x.stat().st_size for x in files)})
    return sorted(out, key=lambda t: -t["gone"])


def trash_count() -> int:
    """Anzahl der Projekte im Papierkorb – ohne die Sicherungen zu lesen (für die Startseite)."""
    return sum(1 for d in (BACKUP_DIR.iterdir() if BACKUP_DIR.is_dir() else [])
               if d.is_dir() and not (PROJ_DIR / (d.name + ".json")).exists() and any(d.glob("*.json.gz")))


def trash_restore(pid: str) -> dict:
    f = proj_path(pid)
    d = backup_dir(f)
    if f.exists():
        raise ValueError("Dieses Projekt gibt es schon wieder.")
    for x in (sorted(d.glob("*.json.gz"), reverse=True) if d.is_dir() else []):
        r = _read_backup(x)
        if r:
            obj = r[1]
            obj["id"] = obj.get("id") or pid
            obj["updated"] = int(time.time() * 1000)
            save_project(pid, json.dumps(obj, ensure_ascii=False), obj, backup=False)
            log(f"Projekt {f.name} aus dem Papierkorb wiederhergestellt ({x.name})")
            return {"id": pid, "name": obj.get("name", "")}
    raise ValueError("Im Papierkorb liegt keine lesbare Fassung dieses Projekts.")


def trash_purge(pid: str | None) -> dict:
    """Gelöschte Projekte endgültig entfernen – eines oder alle. Bestehende Projekte bleiben unberührt."""
    n = 0
    for d in (BACKUP_DIR.iterdir() if BACKUP_DIR.is_dir() else []):
        if d.is_dir() and not (PROJ_DIR / (d.name + ".json")).exists() and (pid is None or d.name == proj_path(pid).stem):
            shutil.rmtree(d, ignore_errors=True)
            n += 1
    return {"removed": n}


# ───────────────────────────── Aufräumen im Hintergrund ─────────────────────────────

THUMB_MAX_AGE = 30 * 86400      # Vorschaubilder, die 30 Tage nicht gebraucht wurden, werden entfernt (entstehen bei Bedarf neu)
THUMB_MAX_BYTES = 1_500_000_000  # und insgesamt höchstens 1,5 GB – die ältesten zuerst


def housekeeping() -> None:
    """Einmal je Programmstart, im Hintergrund: Zwischenspeicher begrenzen und liegengebliebene Hilfsdateien entfernen.
    Angefasst werden nur Dateien, die HoneyCut selbst erzeugt hat und jederzeit neu erzeugen kann."""
    now = time.time()
    freed = 0
    try:
        files = []
        for x in (CACHE_DIR / "thumbs").iterdir():
            try:
                st = x.stat()
            except OSError:
                continue
            if now - st.st_mtime > THUMB_MAX_AGE or (x.name.endswith(".tmp.jpg") and now - st.st_mtime > 3600):
                x.unlink(missing_ok=True)
                freed += st.st_size
            else:
                files.append((st.st_mtime, st.st_size, x))
        total = sum(n for _, n, _ in files)
        for _, n, x in sorted(files, key=lambda t: t[0]):
            if total <= THUMB_MAX_BYTES:
                break
            x.unlink(missing_ok=True)
            total -= n
            freed += n
    except OSError as e:
        log(f"Aufräumen (Vorschaubilder): {e!r}")
    try:   # liegengebliebene Teilstücke abgebrochener Vorgänge (älter als ein Tag)
        for d, pat in ((DATA_DIR / "freigestellt", "*.tmp.mp4"), (DATA_DIR / "beruhigt", "*.tmp.mp4"), (DATA_DIR / "beruhigt", "*.trf"), (DATA_DIR / "mikrofon", "*.tmp.mp4"), (CACHE_DIR / "proxies", "*.tmp.mp4"),
                       (DATA_DIR / "models", "*.part"), (PROJ_DIR, "*.tmp")):
            for x in d.glob(pat) if d.is_dir() else []:
                st = x.stat()
                if now - st.st_mtime > 86400:
                    x.unlink(missing_ok=True)
                    freed += st.st_size
        for x in Path(tempfile.gettempdir()).glob("textschnitt_*"):
            try:
                st = x.stat()
                if now - st.st_mtime > 86400:
                    freed += st.st_size if x.is_file() else 0
                    shutil.rmtree(x, ignore_errors=True) if x.is_dir() else x.unlink(missing_ok=True)
            except OSError:
                continue
    except OSError as e:
        log(f"Aufräumen (Teilstücke): {e!r}")
    try:   # Sicherungen gelöschter Projekte nach 30 Tagen entfernen
        for d in BACKUP_DIR.iterdir() if BACKUP_DIR.is_dir() else []:
            for x in d.glob("*.part") if d.is_dir() else []:
                if now - x.stat().st_mtime > 3600:
                    x.unlink(missing_ok=True)
            if d.is_dir() and not (PROJ_DIR / (d.name + ".json")).exists():
                newest = max((x.stat().st_mtime for x in d.iterdir()), default=0)
                if now - newest > TRASH_DAYS * 86400:
                    shutil.rmtree(d, ignore_errors=True)
    except OSError as e:
        log(f"Aufräumen (Sicherungen): {e!r}")
    try:
        freed += sweep_orphans(now)
    except Exception as e:  # noqa: BLE001
        log(f"Aufräumen (verwaiste Dateien): {e!r}")
    freed += trim_log()
    if freed > 1_000_000:
        log(f"Aufgeräumt: {freed / 1e6:.0f} MB an Zwischenspeicher, Teilstücken und verwaisten Dateien freigegeben")
    try:   # einmal am Tag nach einer neueren Version sehen (nur die installierte Windows-App; abschaltbar)
        update_check()
    except Exception as e:  # noqa: BLE001 – offline oder GitHub nicht erreichbar: beim nächsten Start wieder
        log(f"Versionsprüfung nicht möglich: {e!r}")


SWEEP_EVERY = 7 * 86400         # die Suche nach verwaisten Vorschau-Dateien höchstens einmal je Woche
ORPHAN_AGE = 30 * 86400         # … und erst 30 Tage nach der letzten Verwendung
_REF_RE = re.compile(r"[0-9a-f]{16}\.mp4")


def sweep_orphans(now: float) -> int:
    """Vorschau-Dateien entfernen (verkleinerte Kopien für Videos, die sich in der Vorschau nicht abspielen ließen), auf die
    kein Projekt mehr verweist – das Video wurde ersetzt oder das Projekt gelöscht. Als „verwendet“ zählt alles, was in
    irgendeinem Projekt oder in einer Sicherung steht. Lässt sich ein Projekt nicht lesen, wird nichts entfernt.
    Bewusst NICHT angefasst werden Folienbilder, freigestellte und beruhigte Kopien: Auf sie können bereits exportierte CapCut- und
    Concat-Projekte verweisen."""
    import gzip
    stamp = CACHE_DIR / "aufgeraeumt.txt"
    try:
        if now - stamp.stat().st_mtime < SWEEP_EVERY:
            return 0
    except OSError:
        pass
    cand: list[tuple[Path, int]] = []
    for x in (CACHE_DIR / "proxies").glob("*.mp4"):
        st = x.stat()
        if not x.name.endswith(".tmp.mp4") and now - max(st.st_mtime, st.st_atime) > ORPHAN_AGE:
            cand.append((x, st.st_size))
    freed = 0
    if cand:
        used: set[str] = set()
        for f in PROJ_DIR.glob("*.json"):       # jedes Projekt muss lesbar sein – sonst lieber nichts entfernen
            used.update(_REF_RE.findall(f.read_text(encoding="utf-8")))
            time.sleep(0.02)
        if any(x.name not in used for x, _ in cand):
            for f in (BACKUP_DIR.glob("*/*.json.gz") if BACKUP_DIR.is_dir() else []):
                try:
                    used.update(_REF_RE.findall(gzip.open(f, "rb").read().decode("utf-8", "replace")))
                except (OSError, EOFError):
                    continue
                time.sleep(0.02)
        for x, size in cand:
            if x.name not in used:
                try:
                    x.unlink()
                    freed += size
                except OSError:
                    continue
    stamp.write_text(time.strftime("%Y-%m-%d %H:%M:%S"), encoding="utf-8")
    return freed


# ───────────────────────────── Speicher verwalten ─────────────────────────────
# Übersicht, was im Datenordner wie viel Platz belegt, und gezieltes Löschen. Gelöscht wird nur, was HoneyCut selbst erzeugt
# hat und worauf kein Projekt, keine frühere Fassung und kein Projekt im Papierkorb mehr verweist. Was gelöscht werden darf,
# rechnet der Server bei jedem Aufruf neu aus – die Oberfläche nennt nur die Gruppe.

# Erzeugte Bilder, die ein Projekt verwendet: Folien (auch die Bilder ihrer Schritte) und markierte Screenshots
_SLIDE_RE = re.compile(r"(?:folie|markiert)-[A-Za-z0-9_.\-]+?\.png")
SLIDE_OLD = ("folie-", "markiert-")   # nur diese räumt „Frühere Bilder löschen“ weg; Formen, Balken und Masken sind winzig und entstehen je Export neu


def _du(d: Path) -> tuple[int, int]:
    """(Bytes, Anzahl) aller Dateien unter d."""
    size = n = 0
    stack = [d]
    while stack:
        try:
            with os.scandir(stack.pop()) as it:
                for e in it:
                    if e.is_dir(follow_symlinks=False):
                        stack.append(Path(e.path))
                    elif e.is_file(follow_symlinks=False):
                        size += e.stat(follow_symlinks=False).st_size
                        n += 1
        except OSError:
            continue
    return size, n


def storage_refs() -> dict[str, set[tuple]]:
    """Erzeugte Dateien (Vorschau-Dateien, freigestellte Kopien, Folienbilder) → wer sie verwendet, als (Art, Projektname):
    Art 0 = ein Projekt, 1 = eine frühere Fassung eines Projekts, 2 = ein Projekt im Papierkorb. Ein unlesbares Projekt
    löst eine Ausnahme aus: Dann wird nichts als „unbenutzt“ eingestuft."""
    import gzip
    names = {p["id"]: p["name"] or "Projekt" for p in list_projects()}
    refs: dict[str, set[tuple]] = {}

    def add(txt: str, who: tuple):
        for n in set(_REF_RE.findall(txt)) | set(_SLIDE_RE.findall(txt)):
            refs.setdefault(n, set()).add(who)
    for f in PROJ_DIR.glob("*.json"):
        add(f.read_text(encoding="utf-8"), (0, names.get(f.stem, f.stem)))
    for f in (BACKUP_DIR.glob("*/*.json.gz") if BACKUP_DIR.is_dir() else []):
        try:
            txt = gzip.open(f, "rb").read().decode("utf-8", "replace")
        except (OSError, EOFError):
            continue
        add(txt, (1, names[f.parent.name]) if f.parent.name in names else (2, ""))
    return refs


def _used_by(who: set[tuple]) -> list[str]:
    """Verwendung in Worten, fertig für „verwendet von …“."""
    now = sorted(n for k, n in who if k == 0)
    out = [f"„{n}“" for n in now]
    out += [f"einer früheren Fassung von „{n}“" for n in sorted({n for k, n in who if k == 1} - set(now))]
    if any(k == 2 for k, _ in who):
        out.append("einem Projekt im Papierkorb")
    return out


def _hf_model_dirs(name: str) -> list[Path]:
    key = MODEL_REPO.get(name, f"Systran/faster-whisper-{name}").replace("/", "--").lower()
    try:
        return [d for d in hf_cache_dir().glob("models--*") if d.name.lower().endswith(key)]
    except OSError:
        return []


FRESH = 600   # so lange gilt eine eben erzeugte Datei als „in Arbeit“: Sie steht womöglich noch in keinem gespeicherten Projekt


def _is_fresh(x: Path) -> bool:
    try:
        return time.time() - x.stat().st_mtime < FRESH
    except OSError:
        return True


def storage_info() -> dict:
    problem = ""
    try:
        refs = storage_refs()
    except Exception as e:  # noqa: BLE001 – unlesbares Projekt: nichts gilt als unbenutzt
        log(f"Speicher verwalten: Verweise nicht lesbar ({e!r})")
        refs, problem = None, "Ein Projekt ließ sich nicht lesen. Solange das so ist, gibt HoneyCut hier nichts frei, was zu einem Projekt gehören könnte."
    free_ok = refs is not None
    refs = refs or {}
    groups = []
    b, n = _du(CACHE_DIR / "thumbs")
    groups.append({"key": "thumbs", "label": "Vorschaubilder der Zeitleiste", "bytes": b, "count": n, "freeable": b,
                   "hint": "Entstehen beim Öffnen eines Projekts von selbst neu."})

    def files(d: Path, pat: str):
        out = []
        for x in (sorted(d.glob(pat)) if d.is_dir() else []):
            if x.is_file() and ".tmp." not in x.name:
                used = _used_by(refs.get(x.name, set())) if free_ok else ["?"]
                if not used and _is_fresh(x):
                    used = ["einem laufenden Vorgang (eben erst entstanden)"]
                out.append({"name": x.name, "bytes": x.stat().st_size, "used": used, "at": int(x.stat().st_mtime * 1000)})
        return out
    px = files(CACHE_DIR / "proxies", "*.mp4")
    groups.append({"key": "proxies", "label": "Vorschau-Dateien", "bytes": sum(i["bytes"] for i in px), "count": len(px),
                   "freeable": sum(i["bytes"] for i in px if not i["used"]), "nfree": sum(1 for i in px if not i["used"]),
                   "hint": "Verkleinerte Kopien für Videos, die sich in der Vorschau nicht abspielen ließen."})
    mt = files(DATA_DIR / "freigestellt", "*.mp4")
    groups.append({"key": "matte", "label": "Freigestellte Kopien", "bytes": sum(i["bytes"] for i in mt), "count": len(mt),
                   "freeable": sum(i["bytes"] for i in mt if not i["used"]), "nfree": sum(1 for i in mt if not i["used"]), "items": mt, "warn": True,
                   "hint": "Kopien von Videos mit entferntem Hintergrund. Löschen lässt sich nur, was kein Projekt mehr verwendet."})
    sb = files(DATA_DIR / "beruhigt", "*.mp4")
    groups.append({"key": "stab", "label": "Beruhigte Kopien", "bytes": sum(i["bytes"] for i in sb), "count": len(sb),
                   "freeable": sum(i["bytes"] for i in sb if not i["used"]), "nfree": sum(1 for i in sb if not i["used"]), "items": sb, "warn": True,
                   "hint": "Kopien von Videos mit ausgeglichenem Wackeln. Löschen lässt sich nur, was kein Projekt mehr verwendet."})
    mc = files(DATA_DIR / "mikrofon", "*.mp4")
    groups.append({"key": "mic", "label": "Kopien mit Mikrofon-Ton", "bytes": sum(i["bytes"] for i in mc), "count": len(mc),
                   "freeable": sum(i["bytes"] for i in mc if not i["used"]), "nfree": sum(1 for i in mc if not i["used"]), "items": mc, "warn": True,
                   "hint": "Kopien von Videos mit dem Ton eines externen Mikrofons. Löschen lässt sich nur, was kein Projekt mehr verwendet."})
    fol = DATA_DIR / "folien"
    sl = [x for d in (fol.iterdir() if fol.is_dir() else []) if d.is_dir() for x in d.glob("*.png")]
    old = [x for x in sl if x.name.startswith(SLIDE_OLD) and x.name not in refs and not _is_fresh(x)] if free_ok else []
    groups.append({"key": "slides", "label": "Folienbilder", "bytes": sum(x.stat().st_size for x in sl), "count": len(sl),
                   "freeable": sum(x.stat().st_size for x in old), "nfree": len(old), "warn": True,
                   "hint": "Bei jeder Änderung einer Folie oder einer Markierung im Screenshot entsteht ein neues Bild; die früheren bleiben liegen."})
    models = []
    for name, label, _mb in MODELS:
        if name in bundled_models():
            continue
        size = sum(_du(d)[0] for d in _hf_model_dirs(name))
        if size:
            models.append({"name": name, "label": label, "bytes": size})
    groups.append({"key": "models", "label": "Nachgeladene Whisper-Modelle", "bytes": sum(m["bytes"] for m in models), "count": len(models), "items": models,
                   "hint": "Lassen sich in den Einstellungen jederzeit wieder laden."})
    b, n = _du(BACKUP_DIR)
    groups.append({"key": "backups", "label": "Frühere Fassungen und Papierkorb", "bytes": b, "count": n, "trash": trash_count(),
                   "hint": "Sechs Fassungen je Projekt; der Papierkorb leert sich nach 30 Tagen von selbst."})
    b, n = _du(DATA_DIR / "models")
    if b:
        groups.append({"key": "extra", "label": "Weitere Modelle", "bytes": b, "count": n, "hint": "Für das automatische Freistellen und die Übersetzung."})
    b, n = _du(PROJ_DIR)
    groups.append({"key": "projects", "label": "Projektdateien", "bytes": b, "count": n, "hint": "Schnitt, Transkript und Untertitel deiner Projekte."})
    b, n = _du(DATA_DIR / "webview")
    if b:
        groups.append({"key": "webview", "label": "Zwischenspeicher des Programmfensters", "bytes": b, "count": n, "hint": "Wird vom Fenster selbst verwaltet."})
    try:
        free = shutil.disk_usage(DATA_DIR).free
    except OSError:
        free = 0
    return {"free": free, "folder": norm_path(str(DATA_DIR)), "groups": groups, "total": sum(g["bytes"] for g in groups), "problem": problem}


def storage_clear(what: str, name: str = "") -> dict:
    freed = n = 0

    def kill(x: Path):
        nonlocal freed, n
        try:
            size = x.stat().st_size
            x.unlink()
            freed += size
            n += 1
        except OSError:
            pass
    if what == "thumbs":
        d = CACHE_DIR / "thumbs"
        for x in (d.iterdir() if d.is_dir() else []):
            if x.is_file() and ".tmp." not in x.name:   # ein Bild, das gerade entsteht, bleibt
                kill(x)
    elif what in ("proxies", "matte", "stab", "mic", "slides"):
        refs = storage_refs()   # frisch gerechnet; ein unlesbares Projekt bricht hier ab, bevor etwas gelöscht ist
        if what == "slides":
            fol = DATA_DIR / "folien"
            for d in (fol.iterdir() if fol.is_dir() else []):
                if not d.is_dir():
                    continue
                for x in d.glob("*.png"):
                    if x.name.startswith(SLIDE_OLD) and x.name not in refs and not _is_fresh(x):
                        kill(x)
                try:
                    if not any(d.iterdir()):
                        d.rmdir()
                except OSError:
                    pass
        else:
            d = CACHE_DIR / "proxies" if what == "proxies" else DATA_DIR / ("beruhigt" if what == "stab" else "mikrofon" if what == "mic" else "freigestellt")
            for x in (d.glob("*.mp4") if d.is_dir() else []):
                if x.name not in refs and ".tmp." not in x.name and (not name or x.name == name) and not _is_fresh(x):
                    kill(x)
                    if what == "mic":
                        kill(x.with_suffix(".json"))
    elif what == "model":
        if name not in [m[0] for m in MODELS] or name in bundled_models():
            raise ValueError("Dieses Modell lässt sich nicht löschen.")
        if any(j["status"] == "running" and j["kind"] in ("transcribe", "download") for j in list(JOBS.values())):
            raise ValueError("Gerade läuft eine Transkription oder ein Download. Bitte danach noch einmal versuchen.")
        with _model_lock:
            for k in [k for k in _model_cache if name in str(k)]:
                _model_cache.pop(k, None)   # geladenes Modell loslassen, damit seine Dateien frei werden
        for d in _hf_model_dirs(name):
            b, k = _du(d)
            gone = d.with_name(d.name + ".loeschen")   # erst umbenennen: Das gelingt nur, wenn keine Datei mehr in Gebrauch ist
            shutil.rmtree(gone, ignore_errors=True)
            try:
                d.rename(gone)
            except OSError:
                raise ValueError("Das Modell ist gerade in Gebrauch. Bitte HoneyCut neu starten und es dann löschen.")
            shutil.rmtree(gone, ignore_errors=True)
            freed += b
            n += k
        _models_cache["v"] = None
    else:
        raise ValueError("Unbekannte Gruppe.")
    log(f"Speicher verwalten: {what}{' ' + name if name else ''} – {n} Dateien, {freed / 1e6:.0f} MB freigegeben")
    return {"freed": freed, "count": n}


# ───────────────────────────── Einstellungen (bleiben über Neustarts erhalten) ─────────────────────────────

SETTINGS_PATH = DATA_DIR / "einstellungen.json"
_settings_lock = threading.Lock()
_settings: dict | None = None


def settings_get() -> dict:
    global _settings
    with _settings_lock:
        if _settings is None:
            try:
                _settings = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
                if not isinstance(_settings, dict):
                    _settings = {}
            except (OSError, ValueError):
                _settings = {}
        return dict(_settings)


def settings_set(**patch) -> dict:
    global _settings
    settings_get()
    with _settings_lock:
        _settings.update(patch)
        try:
            tmp = SETTINGS_PATH.with_suffix(".tmp")
            tmp.write_text(json.dumps(_settings, ensure_ascii=False, indent=1), encoding="utf-8")
            replace_retry(tmp, SETTINGS_PATH)
        except OSError as e:
            log(f"Einstellungen nicht gespeichert: {e!r}")
        return dict(_settings)


# ───────────────────────────── Hinweis auf neue Versionen ─────────────────────────────
# Die installierte Windows-App sieht höchstens einmal am Tag bei GitHub nach, ob ein neuerer Installer bereitsteht
# (abschaltbar in den Einstellungen). Übertragen wird dabei nichts außer den beiden Abfragen selbst:
# die Liste der Veröffentlichungen und die Datei NEUIGKEITEN.md mit den Änderungen in Stichpunkten.

UPDATE_API = os.environ.get("HONEYCUT_UPDATE_API") or "https://api.github.com/repos/honeybalecta/textschnitt/releases?per_page=30"
UPDATE_NOTES = os.environ.get("HONEYCUT_UPDATE_NOTES") or "https://raw.githubusercontent.com/honeybalecta/textschnitt/main/NEUIGKEITEN.md"
UPDATE_EVERY = 20 * 3600
UPDATE_SITE = "https://github.com/honeybalecta/textschnitt/"   # nur Adressen darunter werden im Browser geöffnet
_update_lock = threading.Lock()


def _ver(s: str) -> tuple:
    m = re.fullmatch(r"v?(\d+)\.(\d+)(?:\.(\d+))?", (s or "").strip())
    return tuple(int(x or 0) for x in m.groups()) if m else ()


def parse_notes(md: str) -> dict[str, dict]:
    """NEUIGKEITEN.md → {Version: {"title": …, "points": […]}}. Je Version eine Zeile „## 2.26.0 · Titel“, darunter Stichpunkte."""
    out: dict[str, dict] = {}
    cur = None
    for line in md.splitlines():
        m = re.match(r"^##\s+v?(\d+\.\d+(?:\.\d+)?)\s*(?:[·–—:-]\s*(.*))?$", line.strip())
        if m:
            cur = out.setdefault(m.group(1), {"title": (m.group(2) or "").strip()[:120], "points": []})
            continue
        if line.startswith("#"):
            cur = None
            continue
        m = re.match(r"^\s*[-*]\s+(.*)$", line)
        if m and cur is not None and len(cur["points"]) < 12:
            cur["points"].append(m.group(1).strip()[:400])
    return out


def _http_get(url: str, timeout: float = 8.0) -> bytes:
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": f"HoneyCut/{VERSION}", "Accept": "application/vnd.github+json, text/plain, */*"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(3_000_000)


def update_supported() -> bool:
    return (FROZEN and platform.system() == "Windows") or bool(os.environ.get("HONEYCUT_UPDATE_API"))


def update_state() -> dict:
    st = settings_get()
    latest = st.get("updateLatest") or None
    if not isinstance(latest, dict) or _ver(str(latest.get("version", ""))) <= _ver(VERSION):
        latest = None       # nichts Neueres bekannt (oder inzwischen installiert)
    return {"supported": update_supported(), "enabled": st.get("updates", True) is not False, "current": VERSION, "latest": latest,
            "checked": int(float(st.get("updateChecked") or 0) * 1000), "skip": str(st.get("updateSkip") or "")}


def update_check(force: bool = False) -> dict:
    st = settings_get()
    if not update_supported():
        return update_state()
    if not force and (st.get("updates", True) is False or time.time() - float(st.get("updateChecked") or 0) < UPDATE_EVERY):
        return update_state()
    with _update_lock:
        rels = json.loads(_http_get(UPDATE_API).decode("utf-8"))
        cur = _ver(VERSION)
        best = None
        for rel in rels if isinstance(rels, list) else []:
            if not isinstance(rel, dict):
                continue
            tag = str(rel.get("tag_name") or "")
            v = _ver(tag) if tag.startswith("v") else ()      # „android-v…“ sind die Android-Fassungen
            if not v or rel.get("draft") or rel.get("prerelease"):
                continue
            exe = next((a for a in rel.get("assets") or [] if str(a.get("name", "")).lower().endswith(".exe")), None)
            if exe and (best is None or v > best[0]):
                best = (v, rel, exe)
        latest = None
        if best and best[0] > cur:
            v, rel, exe = best
            notes = []
            try:
                known = parse_notes(_http_get(UPDATE_NOTES).decode("utf-8", "replace"))
                notes = [{"version": k, **known[k]} for k in sorted(known, key=_ver, reverse=True) if cur < _ver(k) <= v]
            except Exception as e:  # noqa: BLE001 – ohne Stichpunkte geht es auch
                log(f"Neuigkeiten nicht abrufbar: {e!r}")
            latest = {"version": ".".join(str(x) for x in v), "page": str(rel.get("html_url") or ""),
                      "installer": str(exe.get("browser_download_url") or ""), "size": int(exe.get("size") or 0),
                      "published": str(rel.get("published_at") or ""), "notes": notes[:8]}
        settings_set(updateChecked=time.time(), updateLatest=latest)
        log("Versionsprüfung: " + (f"{latest['version']} steht bereit" if latest else "HoneyCut ist aktuell"))
    return update_state()


def update_open(what: str) -> dict:
    """Den Installer oder die Seite der neuen Version im Standardbrowser öffnen."""
    latest = update_state()["latest"] or {}
    url = str(latest.get("installer" if what == "installer" else "page") or "")
    if not url.startswith(UPDATE_SITE):
        raise ValueError("Für diese Version ist keine Adresse bei GitHub hinterlegt.")
    webbrowser.open(url)
    return {"ok": True, "url": url}


# ───────────────────────────── Fehlerbericht ─────────────────────────────

def _ram_bytes() -> int:
    try:
        if platform.system() == "Windows":
            import ctypes

            class MEMORYSTATUSEX(ctypes.Structure):
                _fields_ = [("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong), ("ullTotalPhys", ctypes.c_ulonglong),
                            ("ullAvailPhys", ctypes.c_ulonglong), ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                            ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong), ("sullAvailExtendedVirtual", ctypes.c_ulonglong)]
            m = MEMORYSTATUSEX()
            m.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
            ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
            return int(m.ullTotalPhys)
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemTotal:"):
                return int(line.split()[1]) * 1024
    except Exception:  # noqa: BLE001
        pass
    return 0


def report_text(ui: dict | None = None) -> str:
    """Systemangaben und das Protokoll als ein Text – für die Fehlersuche. Enthält Datei- und Projektnamen, aber weder
    Videos noch Transkripte."""
    out: list[str] = []
    add = out.append

    def safe(label: str, fn):
        try:
            v = fn()
        except Exception as e:  # noqa: BLE001
            v = f"nicht ermittelbar ({e!r})"
        add(f"{label}: {v}")

    def mod(name: str) -> str:
        try:
            m = __import__(name)
            return str(getattr(m, "__version__", "vorhanden"))
        except Exception:  # noqa: BLE001
            return "nicht installiert"
    add("HoneyCut – Fehlerbericht")
    add(f"Erstellt: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    add("Enthält Systemangaben und das Protokoll mit Datei- und Projektnamen. Videos, Transkripte und Texte sind nicht enthalten.")
    add("")
    add("── Programm ──")
    add(f"Version: {VERSION} ({'installierte App' if FROZEN else 'aus dem Quelltext gestartet'})")
    add(f"Fenster: {'eigenes Programmfenster' if APP_HOOKS.get('focus') else 'Browser'}")
    safe("ffmpeg", lambda: (subprocess.run([FFMPEG, "-version"], capture_output=True, text=True, timeout=10, **NOWIN).stdout.splitlines() or ["?"])[0])
    add(f"faster-whisper: {mod('faster_whisper')} · ctranslate2: {mod('ctranslate2')} · onnxruntime: {mod('onnxruntime')}")
    safe("Grafikkarte für die Transkription", lambda: "ja" if __import__("ctranslate2").get_cuda_device_count() > 0 else "nein (Prozessor)")
    safe("Whisper-Modelle", lambda: ", ".join(f"{m['name']} ({'eingebaut' if m['bundled'] else 'geladen' if m['installed'] else 'nicht geladen'})" for m in models_list()) or "keine")
    safe("Freistellen", lambda: "verfügbar" if matte_available() else "nicht verfügbar")
    safe("Bild beruhigen", lambda: "vidstab" if stab_method() == "vidstab" else "einfaches Verfahren (deshake)")
    safe("Übersetzen", lambda: ", ".join(translate_pairs()) if translate_available() else "nicht verfügbar")
    safe("HoneyDeck", lambda: (lambda d: f"{(d / 'version.txt').read_text(encoding='utf-8').strip()} ({d})" if d else "nicht installiert")(deck_dir()))
    add("")
    add("── System ──")
    add(f"Betriebssystem: {platform.system()} {platform.release()} ({platform.version()}), {platform.machine()}")
    add(f"Prozessor: {platform.processor() or '?'} · {os.cpu_count() or '?'} Kerne")
    ram = _ram_bytes()
    if ram:
        add(f"Arbeitsspeicher: {ram / 1e9:.1f} GB")
    add(f"Python: {sys.version.split()[0]}")
    for k, v in (ui or {}).items():
        add(f"{str(k)[:40]}: {str(v)[:300]}")
    add("")
    add("── Daten ──")
    add(f"Datenordner: {DATA_DIR}")
    try:
        info = storage_info()
        add(f"Frei auf dem Laufwerk: {info['free'] / 1e9:.1f} GB")
        for g in info["groups"]:
            add(f"{g['label']}: {g['bytes'] / 1e6:.1f} MB in {g['count']} Dateien" + (f", davon {g['freeable'] / 1e6:.1f} MB freigebbar" if g.get("freeable") else ""))
        if info.get("problem"):
            add(info["problem"])
    except Exception as e:  # noqa: BLE001
        add(f"Speicherübersicht nicht ermittelbar ({e!r})")
    safe("Projekte", lambda: f"{len(list_projects())}, im Papierkorb {trash_count()}")
    add("")
    add("── Aufträge seit dem Start ──")
    jobs = sorted(JOBS.values(), key=lambda j: j.get("started", 0))
    for j in jobs[-40:]:
        add(f"{time.strftime('%H:%M:%S', time.localtime(j.get('started', 0)))}  {j['kind']}: {j['status']}"
            + (f" · {j['message']}" if j.get("message") else "") + (f" · Fehler: {j['error']}" if j.get("error") else ""))
    if not jobs:
        add("keine")
    add("")
    try:
        with _log_lock:
            size = LOG_PATH.stat().st_size
            with open(LOG_PATH, "rb") as f:
                f.seek(max(0, size - 400_000))
                tail = f.read().decode("utf-8", "replace")
        lines = tail.splitlines()[(1 if size > 400_000 else 0):]
        add(f"── Protokoll (die letzten {len(lines)} Zeilen) ──")
        out.extend(lines)
    except OSError:
        add("── Protokoll ──")
        add("Es gibt noch kein Protokoll.")
    return "\n".join(out) + "\n"


def trim_log(limit: int = 5_000_000, keep: int = 2_000_000) -> int:
    """Das Protokoll wächst sonst unbegrenzt: ab 5 MB bleiben nur die letzten 2 MB."""
    try:
        with _log_lock:
            size = LOG_PATH.stat().st_size
            if size <= limit:
                return 0
            with open(LOG_PATH, "rb") as f:
                f.seek(size - keep)
                tail = f.read()
            tail = tail[tail.find(b"\n") + 1:]
            tmp = LOG_PATH.with_suffix(".tmp")
            tmp.write_bytes(tail)
            os.replace(tmp, LOG_PATH)
            return size - len(tail)
    except OSError:
        return 0


# ───────────────────────────── Alle Projekte sichern, Sicherung einspielen ─────────────────────────────
# Eine ZIP-Datei mit allen Projekten, ihren Folienbildern und den importierten Schriften – ohne die Videos. Gedacht für
# die externe Festplatte oder die Cloud. Beim Einspielen bleibt alles Vorhandene erhalten: Fehlende Projekte kommen dazu;
# ist ein Projekt hier schon vorhanden, bleibt der neuere Stand stehen und der ältere liegt bei den früheren Fassungen.

BACKUP_FORMAT = "honeycut-sicherung"


def _js_hash(s: str) -> str:
    """Dieselbe Prüfsumme wie hashStr() in der Oberfläche (FNV-1a über UTF-16) – daraus entstehen die Schlüssel eigener Schriften."""
    h = 2166136261
    b = s.encode("utf-16-le")
    for i in range(0, len(b), 2):
        h ^= b[i] | (b[i + 1] << 8)
        h = (h * 16777619) & 0xFFFFFFFF
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = ""
    while True:
        h, r = divmod(h, 36)
        out = digits[r] + out
        if not h:
            return out


def _rel_under(s: str, root: str) -> str | None:
    """Teilpfad von s unterhalb von root (mit „/“ getrennt) oder None – unabhängig von der Schreibweise der Trenner."""
    a, r = s.replace("\\", "/"), root.replace("\\", "/").rstrip("/") + "/"
    win = len(r) > 2 and r[1] == ":"
    if (a.lower() if win else a).startswith(r.lower() if win else r):
        return a[len(r):]
    return None


def _walk_strings(o, fn):
    """Alle Zeichenketten in o durch fn(wert) ersetzen (fn gibt den neuen Wert oder None für „unverändert“ zurück)."""
    it = o.items() if isinstance(o, dict) else enumerate(o) if isinstance(o, list) else ()
    for k, v in it:
        if isinstance(v, str):
            n = fn(v)
            if n is not None:
                o[k] = n
        elif isinstance(v, (dict, list)):
            _walk_strings(v, fn)


def backup_all_job(job: dict, dest: str, prefs: dict | None = None):
    import zipfile
    root = norm_path(str(DATA_DIR))
    files = sorted(PROJ_DIR.glob("*.json"))
    listing, skipped, slides = [], [], set()
    tmp = Path(dest + ".part")
    try:
        with zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
            for k, f in enumerate(files):
                if job["cancel"]:
                    raise RuntimeError("Abgebrochen")
                job["progress"] = 0.9 * k / max(1, len(files))
                job["message"] = f"Projekt {k + 1} von {len(files)}"
                try:
                    with _proj_lock:
                        txt = f.read_text(encoding="utf-8")
                    obj = json.loads(txt)
                    if not isinstance(obj, dict):
                        raise ValueError("kein Projekt")
                except (OSError, ValueError) as e:
                    skipped.append(f.stem)
                    log(f"Sicherung: {f.name} übersprungen ({e!r})")
                    continue
                z.writestr(f"projekte/{f.name}", txt)
                listing.append({"id": f.stem, "name": str(obj.get("name") or "Projekt"), "updated": int(obj.get("updated") or f.stat().st_mtime * 1000)})

                def note(v: str):   # Folienbilder und eigene Bilder, die das Projekt aus dem Datenordner verwendet
                    rel = _rel_under(v, root) if len(v) < 600 else None
                    if rel and rel.startswith("folien/") and rel not in slides and (DATA_DIR / rel).is_file():
                        slides.add(rel)
                _walk_strings(obj, note)
            for rel in sorted(slides):
                if job["cancel"]:
                    raise RuntimeError("Abgebrochen")
                z.write(DATA_DIR / rel, rel, zipfile.ZIP_STORED)   # PNG ist schon gepackt
            job["progress"], job["message"] = 0.95, "Schriften"
            fonts = fonts_list()
            for ft in fonts:
                z.write(ft["uri"], "schriften/" + ft["name"])
            if prefs:
                z.writestr("einstellungen.json", json.dumps(prefs, ensure_ascii=False))
            z.writestr("sicherung.json", json.dumps({
                "format": BACKUP_FORMAT, "v": 1, "app": VERSION, "created": int(time.time() * 1000), "dataDir": root,
                "projects": listing, "fonts": [{"name": ft["name"], "uri": ft["uri"]} for ft in fonts], "slides": len(slides)}, ensure_ascii=False, indent=1))
        os.replace(tmp, dest)
    finally:
        tmp.unlink(missing_ok=True)
    CREATED.add(norm_path(dest))
    log(f"Alle Projekte gesichert: {len(listing)} Projekte, {len(slides)} Bilder, {len(fonts)} Schriften → {dest}")
    return {"path": norm_path(dest), "bytes": os.path.getsize(dest), "projects": len(listing), "slides": len(slides), "fonts": len(fonts), "skipped": skipped}


def _stash_version(f: Path, txt: str, at_ms: float) -> None:
    """Einen (älteren) Stand zu den früheren Fassungen eines Projekts legen."""
    import gzip
    d = backup_dir(f)
    d.mkdir(parents=True, exist_ok=True)
    t = (at_ms / 1000) if at_ms else time.time()
    while True:
        dst = d / (time.strftime("%Y%m%d-%H%M%S", time.localtime(t)) + ".json.gz")
        if dst.exists():
            r = _read_backup(dst)
            if r and r[0] == txt:
                return          # liegt schon dort (dieselbe Sicherung wurde schon einmal eingespielt)
        elif not (d / dst.name.replace(".json.gz", "-geloescht.json.gz")).exists():
            break
        t += 1
    part = dst.with_suffix(".part")
    part.write_bytes(gzip.compress(txt.encode("utf-8"), 5))
    os.replace(part, dst)


def backup_restore_job(job: dict, src: str):
    import zipfile
    try:
        z = zipfile.ZipFile(src)
    except (OSError, zipfile.BadZipFile):
        raise ValueError("Diese Datei ist keine HoneyCut-Sicherung.")
    with z:
        try:
            meta = json.loads(z.read("sicherung.json").decode("utf-8"))
        except (KeyError, ValueError):
            meta = None
        if not isinstance(meta, dict) or meta.get("format") != BACKUP_FORMAT:
            raise ValueError("Diese Datei ist keine HoneyCut-Sicherung.")
        infos = {i.filename: i for i in z.infolist() if not i.is_dir()}
        root = norm_path(str(DATA_DIR))
        old_root = str(meta.get("dataDir") or "")
        moved = bool(old_root) and _rel_under(root + "/x", old_root) != "x"    # Sicherung stammt aus einem anderen Datenordner

        # Schriften zuerst: Ihre Schlüssel hängen am Speicherort – nach einem Umzug bekommen die Projekte die neuen
        fonts, keys = 0, {}
        have = {x["name"] for x in fonts_list()}
        old_uri = {str(x.get("name")): str(x.get("uri") or "") for x in meta.get("fonts") or [] if isinstance(x, dict)}
        with tempfile.TemporaryDirectory(prefix="textschnitt_") as td:
            for name, i in infos.items():
                m = re.fullmatch(r"schriften/([^/\\]{1,150})", name)
                if not m or Path(m.group(1)).suffix.lower() not in FONT_EXT or i.file_size > 80_000_000:
                    continue
                t = Path(td) / re.sub(r"[^\w.\- ]", "_", m.group(1))
                t.write_bytes(z.read(i))
                got = font_import([str(t)])
                if got:
                    fonts += got["name"] not in have
                    have.add(got["name"])
                    if old_uri.get(m.group(1)) and old_uri[m.group(1)] != got["uri"]:
                        keys["u" + _js_hash(old_uri[m.group(1)])] = "u" + _js_hash(got["uri"])

        slides = 0
        for name, i in infos.items():
            m = re.fullmatch(r"folien/([A-Za-z0-9_-]{1,40})/([\w.\-]{1,120}\.png)", name)
            if not m or i.file_size > 80_000_000:
                continue
            dst = DATA_DIR / "folien" / m.group(1) / m.group(2)
            if not dst.exists():
                dst.parent.mkdir(parents=True, exist_ok=True)
                part = dst.with_suffix(".part")
                part.write_bytes(z.read(i))
                os.replace(part, dst)
                slides += 1

        def rebase(v: str):
            if v in keys:
                return keys[v]
            rel = _rel_under(v, old_root) if moved and len(v) < 600 else None
            return norm_path(str(DATA_DIR / rel)) if rel else None

        res = {"added": [], "updated": [], "updatedIds": [], "kept": [], "same": 0, "failed": [], "fonts": fonts, "slides": slides}
        todo = [(n, i) for n, i in sorted(infos.items()) if re.fullmatch(r"projekte/[A-Za-z0-9_-]{1,40}\.json", n)]
        for k, (name, i) in enumerate(todo):
            if job["cancel"]:
                raise RuntimeError("Abgebrochen")
            job["progress"] = 0.1 + 0.9 * k / max(1, len(todo))
            job["message"] = f"Projekt {k + 1} von {len(todo)}"
            pid = Path(name).stem
            try:
                if i.file_size > 600_000_000:
                    raise ValueError("zu groß")
                obj = json.loads(z.read(i).decode("utf-8"))
                if not isinstance(obj, dict):
                    raise ValueError("kein Projekt")
                obj["id"] = obj.get("id") or pid
                if moved or keys:
                    _walk_strings(obj, rebase)
                txt = json.dumps(obj, ensure_ascii=False)
                label = str(obj.get("name") or "Projekt")
                f = proj_path(pid)
                cur = None
                if f.exists():
                    try:
                        cur = json.loads(f.read_text(encoding="utf-8"))
                    except (OSError, ValueError):
                        cur = None      # unlesbar: die Fassung aus der Sicherung nimmt den Platz ein, der alte Stand wird zurückgelegt
                    if isinstance(cur, dict):
                        a, b = int(cur.get("updated") or 0), int(obj.get("updated") or 0)
                        if a == b:
                            res["same"] += 1
                            continue
                        if a > b:
                            _stash_version(f, txt, b)
                            res["kept"].append(label)
                            continue
                    with _proj_lock:
                        backup_project(f, force=True)
                    save_project(pid, txt, obj, backup=False)
                    res["updated"].append(label)
                    res["updatedIds"].append(pid)
                else:
                    save_project(pid, txt, obj, backup=False)
                    res["added"].append(label)
            except Exception as e:  # noqa: BLE001 – ein kaputtes Projekt hält die übrigen nicht auf
                log(f"Sicherung einspielen: {name} übersprungen ({e!r})")
                res["failed"].append(pid)
        try:
            res["prefs"] = json.loads(z.read("einstellungen.json").decode("utf-8")) if "einstellungen.json" in infos else {}
        except ValueError:
            res["prefs"] = {}
        if keys and isinstance(res["prefs"], dict):   # eigene Looks: Schriften bekommen wie in den Projekten ihre neuen Schlüssel
            _walk_strings(res["prefs"], lambda v: keys.get(v))
    res["created"] = int(meta.get("created") or 0)
    res["total"] = len(todo)
    log(f"Sicherung eingespielt: {len(res['added'])} neu, {len(res['updated'])} aktualisiert, {len(res['kept'])} hier neuer, "
        f"{res['same']} unverändert, {len(res['failed'])} unlesbar – {src}")
    return res


def open_dialog_backup() -> str | None:
    if APP_HOOKS.get("pick"):
        r = APP_HOOKS["pick"]("backup") or []
        return r[0] if r else None
    code = ("import tkinter as tk, json\nfrom tkinter import filedialog\nr=tk.Tk();r.withdraw()\nr.attributes('-topmost',True)\n"
            "f=filedialog.askopenfilename(title='Sicherung wählen',filetypes=[('HoneyCut-Sicherung','*.zip'),('Alle','*.*')])\nprint(json.dumps(f or ''))")
    res = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    if res.returncode:
        raise RuntimeError("Kein Dateidialog verfügbar.")
    return json.loads(res.stdout.strip() or '""') or None


# ───────────────────────────── Dateiauswahl, Ordner öffnen ─────────────────────────────

def pick_files(kind: str) -> list[str]:
    multi = kind in ("videos", "clips")
    if APP_HOOKS.get("pick"):
        return APP_HOOKS["pick"](kind) or []
    types = ("Schriften|*.ttf *.otf" if kind == "font" else f"Video und Audio|{VIDEO_EXT} {AUDIO_EXT}" if kind not in ("clip", "clips") else f"Videos, Bilder und Ton|{VIDEO_EXT} {IMAGE_EXT} {AUDIO_EXT}" if kind == "clips" else f"Videos und Bilder|{VIDEO_EXT} {IMAGE_EXT}")
    label, pattern = types.split("|")
    code = ("import tkinter as tk, json\nfrom tkinter import filedialog\nr=tk.Tk();r.withdraw()\nr.attributes('-topmost',True)\n"
            f"f=filedialog.{'askopenfilenames' if multi else 'askopenfilename'}(title='Datei wählen',filetypes=[({label!r},{pattern!r}),('Alle','*.*')])\n"
            "print(json.dumps(list(f) if isinstance(f,(list,tuple)) else ([f] if f else [])))")
    res = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    if res.returncode:
        raise RuntimeError("Kein Dateidialog verfügbar.")
    return json.loads(res.stdout.strip() or "[]")


def fonts_list() -> list[dict]:
    """Importierte Schriften (bleiben für alle Projekte verfügbar)."""
    out = []
    if FONT_DIR.is_dir():
        for f in sorted(FONT_DIR.iterdir()):
            if f.is_file() and f.suffix.lower() in FONT_EXT:
                p = norm_path(str(f))
                ALLOWED.add(p)
                out.append({"uri": p, "name": f.name})
    return out


def font_import(paths: list[str]):
    FONT_DIR.mkdir(parents=True, exist_ok=True)
    res = None
    for src in paths:
        sp = Path(src)
        if sp.suffix.lower() not in FONT_EXT or not sp.is_file():
            continue
        dest = FONT_DIR / re.sub(r"[^\w.\- ]", "_", sp.name)
        if not dest.exists() or dest.read_bytes() != sp.read_bytes():
            k = 2
            while dest.exists():
                dest = FONT_DIR / f"{sp.stem}_{k}{sp.suffix}"
                k += 1
            shutil.copyfile(sp, dest)
        p = norm_path(str(dest))
        ALLOWED.add(p)
        res = {"uri": p, "name": dest.name}
    return res


def font_delete(uri: str) -> bool:
    f = Path(norm_path(uri))
    if f.parent != Path(norm_path(str(FONT_DIR))) or not f.is_file():
        return False
    f.unlink()
    return True


def picked_media(kind: str):
    paths = pick_files(kind)
    if kind == "font":
        return font_import(paths)
    out = []
    for p in paths:
        try:
            m = probe(p)
            if kind == "videos" and m["kind"] == "image":
                continue
            if kind == "videos" and len(paths) == 1:
                lg = legacy_project(p)
                if lg:
                    m["legacy"] = lg
            out.append(m)
        except Exception as e:  # noqa: BLE001
            log(f"Datei nicht lesbar: {p}: {e}")
    if not out:
        return None
    return out if kind in ("videos", "clips") else out[0]


# ───────────────────────────── Projektpakete (.honeycut) ─────────────────────────────
# Ein Projekt samt Videos, Bildern und Schriften in einer Datei – zum Weiterarbeiten auf einem anderen Gerät
# (Android, Browser) oder zum Weitergeben an andere. Aufbau (gleich auf allen Plattformen):
#   "HONEYCUT1\n" · 8 Byte Kopf-Länge (little endian) · Kopf (JSON, UTF-8) · Dateien in der Reihenfolge des Kopfes
PKG_MAGIC = b"HONEYCUT1\n"


def save_image(data: dict) -> dict:
    """Bild aus der Oberfläche (Base64-PNG) im Datenordner ablegen, z. B. Folien des B-Roll-Generators."""
    name = re.sub(r"[^\w.\-]", "_", str(data.get("name") or "bild"))[:80]
    if not name.lower().endswith(".png"):
        name += ".png"
    proj = re.sub(r"[^A-Za-z0-9_-]", "", str(data.get("project") or ""))[:20] or "allgemein"
    d = DATA_DIR / "folien" / proj
    d.mkdir(parents=True, exist_ok=True)
    f = d / name
    f.write_bytes(base64.b64decode(str(data.get("data") or "").split(",")[-1]))
    uri = allow(f)
    return {"uri": uri, "name": name, "kind": "image", "duration": 600.0, "width": int(data.get("width") or 0), "height": int(data.get("height") or 0),
            "rotation": 0, "fps": 30.0, "hasAudio": False, "hasVideo": True}


def import_root() -> Path:
    home = Path.home()
    for d in (home / "Documents", home / "Dokumente", home / "OneDrive" / "Dokumente", home / "OneDrive" / "Documents"):
        if d.is_dir():
            return d / "HoneyCut Importe"
    return home / "HoneyCut Importe"


# ───────── HoneyDeck (eigenes Programm für Folien) ─────────
def deck_dir() -> Path | None:
    """Ordner mit der Oberfläche von HoneyDeck, wenn HoneyDeck installiert ist (sonst None)."""
    cands = []
    if os.environ.get("HONEYDECK_DIR"):
        cands.append(Path(os.environ["HONEYDECK_DIR"]))
    if sys.platform == "win32":
        try:
            import winreg
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\HoneyBalecta\HoneyDeck") as k:
                cands.append(Path(winreg.QueryValueEx(k, "WebDir")[0]))
        except OSError:
            pass
        if os.environ.get("LOCALAPPDATA"):
            cands.append(Path(os.environ["LOCALAPPDATA"]) / "Programs" / "HoneyDeck" / "web")
    else:
        cands.append(Path.home() / ".local" / "share" / "honeydeck" / "web")
    for c in cands:
        if (c / "deck-engine.js").is_file() and (c / "version.txt").is_file():
            return c
    return None


DECK_TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
              ".svg": "image/svg+xml", ".png": "image/png", ".ttf": "font/ttf", ".otf": "font/otf", ".txt": "text/plain; charset=utf-8",
              ".md": "text/plain; charset=utf-8", ".webmanifest": "application/manifest+json", ".json": "application/json"}


def _with_ext(dest: str, ext: str) -> str:
    """Dateiname aus einem Speichern-Dialog: die erwartete Endung ergänzen, falls sie fehlt."""
    return dest if dest.lower().endswith(ext) else dest + ext


def save_any_dialog(name: str) -> str | None:
    """Speichern-Dialog für beliebige Dateien (Bilder, PDF, ZIP, .honeydeck aus HoneyDeck)."""
    if APP_HOOKS.get("save_any"):
        return APP_HOOKS["save_any"](name)
    ext = Path(name).suffix
    code = ("import tkinter as tk, json\nfrom tkinter import filedialog\nr=tk.Tk();r.withdraw()\nr.attributes('-topmost',True)\n"
            f"f=filedialog.asksaveasfilename(title='Speichern',initialfile={name!r},defaultextension={ext!r})\nprint(json.dumps(f or ''))")
    res = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    if res.returncode:
        raise RuntimeError("Kein Dateidialog verfügbar.")
    return json.loads(res.stdout.strip() or '""') or None


def save_dialog(name: str) -> str | None:
    if APP_HOOKS.get("save"):
        return APP_HOOKS["save"](name)
    init = str(import_root().parent)
    code = ("import tkinter as tk, json\nfrom tkinter import filedialog\nr=tk.Tk();r.withdraw()\nr.attributes('-topmost',True)\n"
            f"f=filedialog.asksaveasfilename(title='Projekt speichern',initialdir={init!r},initialfile={name!r},defaultextension='.honeycut',"
            "filetypes=[('HoneyCut-Projekt','*.honeycut')])\nprint(json.dumps(f or ''))")
    res = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    if res.returncode:
        raise RuntimeError("Kein Dateidialog verfügbar.")
    return json.loads(res.stdout.strip() or '""') or None


def open_dialog_package() -> str | None:
    if APP_HOOKS.get("pick"):
        r = APP_HOOKS["pick"]("package") or []
        return r[0] if r else None
    code = ("import tkinter as tk, json\nfrom tkinter import filedialog\nr=tk.Tk();r.withdraw()\nr.attributes('-topmost',True)\n"
            "f=filedialog.askopenfilename(title='Projekt öffnen',filetypes=[('HoneyCut-Projekt','*.honeycut'),('Alle','*.*')])\nprint(json.dumps(f or ''))")
    res = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    if res.returncode:
        raise RuntimeError("Kein Dateidialog verfügbar.")
    return json.loads(res.stdout.strip() or '""') or None


def pkg_copy(src, dst, n: int, job: dict, done: list, total: int, label: str):
    left = n
    while left > 0:
        if job["cancel"]:
            raise RuntimeError("Abgebrochen")
        b = src.read(min(1 << 20, left))
        if not b:
            raise RuntimeError("Projektdatei ist unvollständig.")
        dst.write(b)
        left -= len(b)
        done[0] += len(b)
        if total:
            job["progress"] = min(0.99, done[0] / total)
            job["message"] = f"{label} · {done[0] // 1_000_000} von {total // 1_000_000} MB"


def package_plan(spec: dict) -> tuple[bytes, list, int]:
    """Kopf und Dateiliste eines Pakets: (Kopf als JSON-Bytes, [(Pfad, Größe), …] in der Reihenfolge des Kopfes, Summe der Dateien).
    Trägt in den Kopf ein, welche Dateien mitkommen und wie groß sie sind."""
    header = spec["header"]
    srcs = {f["n"]: f for f in spec.get("files", [])}
    plan = []
    font_dir = norm_path(str(FONT_DIR))
    for h in header.get("files", []):
        f = srcs.get(h["n"])
        size = 0
        if f and f.get("include", True) and not not_a_path(str(f.get("uri") or "")):
            try:   # eine Datei, die sich nicht lesen lässt, fehlt im Paket – das Paket selbst entsteht trotzdem
                p = norm_path(f["uri"])
                ok = p in ALLOWED or norm_path(str(Path(p).parent)) == font_dir
                if ok and os.path.isfile(p):
                    size = os.path.getsize(p)
                    plan.append((p, size))
            except (OSError, ValueError) as e:
                log(f"Projektpaket: {h.get('name') or h.get('n')} übersprungen ({e!r})")
        h["size"], h["included"] = size, size > 0
    head = json.dumps(header, ensure_ascii=False).encode("utf-8")
    return head, plan, sum(n for _, n in plan)


def package_write(job: dict, out, head: bytes, plan: list, total: int, label: str = "Projekt wird gepackt") -> int:
    """Schreibt ein Paket in einen Strom; Rückgabe: Zahl der Bytes."""
    done = [0]
    out.write(PKG_MAGIC)
    out.write(len(head).to_bytes(8, "little"))
    out.write(head)
    for p, n in plan:
        with open(p, "rb") as f:
            pkg_copy(f, out, n, job, done, total, label)
    return total + len(head) + len(PKG_MAGIC) + 8


def package_export_job(job: dict, spec: dict, dest: str):
    head, plan, total = package_plan(spec)
    tmp = Path(dest + ".part")
    with open(tmp, "wb") as out:
        n = package_write(job, out, head, plan, total)
    os.replace(tmp, dest)
    CREATED.add(norm_path(dest))
    return {"path": norm_path(dest), "bytes": n}


def _read_exact(f, n: int) -> bytes:
    buf = bytearray()
    while len(buf) < n:
        b = f.read(n - len(buf))
        if not b:
            raise ValueError("Projektdatei ist unvollständig.")
        buf += b
    return bytes(buf)


def package_read(job: dict, f) -> dict:
    """Liest ein Paket aus einem Strom (Datei oder Verbindung – ohne Zurückspulen) und legt seine Dateien im Import-Ordner ab."""
    if _read_exact(f, len(PKG_MAGIC)) != PKG_MAGIC:
        raise ValueError("Das ist kein HoneyCut-Projekt (.honeycut).")
    n = int.from_bytes(_read_exact(f, 8), "little")
    if n <= 0 or n > 200_000_000:
        raise ValueError("Projektdatei ist beschädigt.")
    header = json.loads(_read_exact(f, n).decode("utf-8"))
    proj = header.get("project") or {}
    folder = re.sub(r'[\\/:*?"<>|]', "_", (proj.get("name") or "Projekt").strip())[:80] or "Projekt"
    pid = re.sub(r"[^A-Za-z0-9_-]", "", proj.get("id", ""))[:12]
    dest_dir = import_root() / (folder + (f" ({pid})" if pid else ""))
    files = [h for h in header.get("files", []) if h.get("included")]
    total = sum(int(h["size"]) for h in files)
    done = [0]
    mp = {}
    for h in header.get("files", []):
        if not h.get("included"):
            continue
        size = int(h["size"])
        name = re.sub(r'[\\/:*?"<>|]', "_", h.get("name") or h["n"])[:120] or h["n"]
        if h.get("kind") == "font":
            if size > 60_000_000:
                raise ValueError("Projektdatei ist beschädigt.")
            FONT_DIR.mkdir(parents=True, exist_ok=True)
            data = _read_exact(f, size)
            done[0] += size
            tgt, k = FONT_DIR / name, 2
            while tgt.exists() and tgt.read_bytes() != data:
                tgt = FONT_DIR / f"{Path(name).stem}_{k}{Path(name).suffix}"
                k += 1
            if not tgt.exists():
                tgt.write_bytes(data)
            mp[h["n"]] = allow(tgt)
            continue
        dest_dir.mkdir(parents=True, exist_ok=True)
        tgt, k = dest_dir / name, 2
        while tgt.exists() and tgt.stat().st_size != size:
            tgt = dest_dir / f"{Path(name).stem}_{k}{Path(name).suffix}"
            k += 1
        if tgt.exists():   # schon da (erneuter Import desselben Projekts): überlesen
            pkg_copy(f, _Sink(), size, job, done, total, "Projekt wird entpackt")
        else:
            part = Path(str(tgt) + ".part")
            try:
                with open(part, "wb") as out:
                    pkg_copy(f, out, size, job, done, total, "Projekt wird entpackt")
                os.replace(part, tgt)
            finally:
                part.unlink(missing_ok=True)   # nach Abbruch oder abgerissener Verbindung kein halbes Stück liegen lassen
        mp[h["n"]] = allow(tgt)
    log(f"Projekt importiert: {len(mp)} Dateien nach {dest_dir}")
    return {"header": header, "map": mp, "folder": norm_path(str(dest_dir))}


class _Sink:
    def write(self, b):
        return len(b)


def package_import_job(job: dict, path: str):
    with open(norm_path(path), "rb") as f:
        return package_read(job, f)


# ───────────────────────────── Übergabe im Heimnetz (G7) ─────────────────────────────
# „Ans Handy übergeben“: Solange das Blatt in der Oberfläche offen ist, lauscht ein zweiter, eigener Server im Heimnetz. Er kennt
# genau vier Adressen unter einer Einmal-Kennung, die nur im QR-Code steht: eine Seite fürs Handy, eine Auskunft, das Paket des
# angebotenen Projekts (direkt aus den Dateien gelesen, ohne Zwischenkopie) und den Empfang eines Pakets vom Handy. Alles andere
# – Projekte, Dateien, Einstellungen – bleibt dem Server auf 127.0.0.1 vorbehalten und ist aus dem Netz unerreichbar.
HAND: dict = {"srv": None, "token": "", "port": 0, "offer": None, "inbox": {}, "bad": 0, "seen": 0.0}
_hand_lock = threading.Lock()
HAND_IDLE = 30 * 60      # so lange ohne Nachfrage der Oberfläche bleibt der Empfang höchstens offen
HAND_BAD_MAX = 40        # so viele Anfragen mit falscher Kennung, dann schließt er
HAND_SPARE = 300_000_000 # so viel Platz soll nach einer Rückgabe vom Handy mindestens frei bleiben


def lan_ips() -> list[str]:
    """Adressen dieses Rechners im Heimnetz, die wahrscheinlichste zuerst."""
    import ipaddress
    import socket
    out: list[str] = []
    for probe_ip in ("192.168.0.1", "10.0.0.1", "172.16.0.1"):   # es wird nichts gesendet – nur gefragt, über welche Adresse es ginge
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            s.connect((probe_ip, 9))
            out.append(s.getsockname()[0])
        except OSError:
            pass
        finally:
            s.close()
    try:
        out += socket.gethostbyname_ex(socket.gethostname())[2]
    except OSError:
        pass
    good = []
    for ip in out:
        try:
            a = ipaddress.ip_address(ip)
        except ValueError:
            continue
        if a.version == 4 and a.is_private and not a.is_loopback and not a.is_link_local and ip not in good:
            good.append(ip)
    return good


def _hand_page(base: str, offer: dict | None) -> str:
    """Die Seite, die das Handy nach dem Scannen des QR-Codes im Browser zeigt."""
    from html import escape
    from urllib.parse import quote
    link = f"intent://uebergabe?u={quote(base, safe='')}#Intent;scheme=honeycut;package=de.honeybalecta.textschnitt;end"
    mb = (lambda b: f"{b / 1e9:.1f} GB".replace(".", ",") if b >= 1e9 else f"{max(1, round(b / 1e6))} MB")
    angebot = (f"<p class=k>Bereit zum Holen</p><h2>{escape(offer['name'])}</h2><p class=m>{mb(offer['bytes'])}</p>" if offer
               else "<p class=k>Verbunden</p><h2>Projekt zurückgeben</h2><p class=m>Der Computer wartet auf ein Projekt vom Handy.</p>")
    datei = f'<a class="b z" href="{escape(base)}/paket">Als Datei herunterladen (.honeycut)</a>' if offer else ""
    return f"""<!doctype html><html lang="de"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>HoneyCut – Übergabe</title>
<style>body{{margin:0;background:#131312;color:#EDE7DA;font:17px/1.45 Inter,system-ui,sans-serif}}main{{max-width:520px;margin:0 auto;padding:28px 22px}}
h1{{font-size:20px;margin:0 0 26px}}h2{{font-size:26px;margin:2px 0 4px}}.k{{color:#A9A397;font-size:13px;text-transform:uppercase;letter-spacing:.08em;margin:0}}.m{{color:#A9A397;margin:0 0 24px}}
.b{{display:block;text-align:center;padding:15px 18px;border-radius:12px;background:#E5402A;color:#fff;text-decoration:none;font-weight:700;margin:0 0 12px}}.b.z{{background:#262624;color:#EDE7DA;font-weight:500}}
small{{display:block;color:#A9A397;margin-top:22px}}</style>
<main><h1>HoneyCut</h1>{angebot}<a class="b" href="{escape(link)}">In HoneyCut öffnen</a>{datei}
<small>Öffnet sich die App nicht? <a style="color:#EDE7DA" href="honeycut://uebergabe?u={quote(base, safe='')}">Hier noch einmal versuchen</a> – oder in HoneyCut unter „Computer“ die Adresse eintippen, die am Computer unter dem QR-Code steht.</small>
<small>Diese Seite kommt von deinem Computer im selben WLAN. Sie gilt, solange dort „Ans Handy übergeben“ geöffnet ist.</small></main></html>"""


class _Limited:
    """Liest höchstens n Bytes aus einer Verbindung (der Rumpf einer Anfrage)."""
    def __init__(self, f, n: int):
        self.f, self.left = f, n

    def read(self, k: int = -1) -> bytes:
        if self.left <= 0:
            return b""
        b = self.f.read(self.left if k is None or k < 0 else min(k, self.left))
        self.left -= len(b)
        return b


class HandoverHandler(BaseHTTPRequestHandler):
    server_version = "HoneyCut-Uebergabe"
    timeout = 90   # eine Verbindung, auf der so lange nichts kommt, wird geschlossen

    def log_message(self, fmt, *args):
        pass

    def _out(self, code: int, body: bytes, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "close")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, obj, code=200):
        self._out(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def _sub(self) -> str | None:
        """Teil der Adresse hinter /h/<Kennung>; None bei falscher Kennung (mit Verzögerung, gezählt)."""
        parts = urlparse(self.path).path.strip("/").split("/")
        tok = HAND["token"]
        if len(parts) >= 2 and parts[0] == "h" and tok and secrets.compare_digest(parts[1], tok) and len(parts) <= 3:
            return parts[2] if len(parts) == 3 else ""
        HAND["bad"] += 1
        time.sleep(0.4)
        if HAND["bad"] >= HAND_BAD_MAX:
            log("Übergabe: zu viele Anfragen mit falscher Kennung – der Empfang wird geschlossen")
            threading.Thread(target=handover_stop, daemon=True).start()
        self._json({"error": "Nicht gefunden"}, 404)
        return None

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        try:
            sub = self._sub()
            if sub is None:
                return
            offer = HAND["offer"]
            base = f"http://{self.headers.get('Host') or ''}/h/{HAND['token']}"
            if sub == "":
                return self._out(200, _hand_page(base, offer).encode("utf-8"), "text/html; charset=utf-8")
            if sub == "info":
                try:
                    root = import_root()
                    free = max(0, shutil.disk_usage(root if root.exists() else root.parent).free - HAND_SPARE)
                except OSError:
                    free = -1   # unbekannt
                return self._json({"app": "honeycut", "version": VERSION, "free": free, "offer": {"name": offer["name"], "bytes": offer["bytes"], "project": offer["project"]} if offer else None})
            if sub == "paket" and offer:
                name = re.sub(r'[^A-Za-z0-9 _.()\-]', "_", offer["name"])[:80] or "Projekt"
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(offer["bytes"]))
                self.send_header("Content-Disposition", f'attachment; filename="{name}.honeycut"')
                self.send_header("Connection", "close")
                self.end_headers()
                if self.command == "HEAD":
                    return
                job = {"cancel": False, "progress": 0, "message": ""}
                offer["job"] = job
                offer["status"] = "sending"
                try:
                    package_write(job, self.wfile, offer["head"], offer["plan"], offer["total"], "Wird übertragen")
                    offer["status"], offer["done"] = "done", offer.get("done", 0) + 1
                    log(f"Übergabe: „{offer['name']}“ ans Handy übertragen")
                except Exception as e:  # noqa: BLE001 – Verbindung abgerissen oder Blatt geschlossen
                    offer["status"] = "ready"
                    log(f"Übergabe: Übertragung abgebrochen ({e!r})")
                return
            return self._json({"error": "Nicht gefunden"}, 404)
        except (BrokenPipeError, ConnectionError, OSError):
            pass

    def do_POST(self):
        try:
            sub = self._sub()
            if sub is None:
                return
            if sub != "zurueck":
                return self._json({"error": "Nicht gefunden"}, 404)
            try:
                n = int(self.headers.get("Content-Length") or 0)
            except ValueError:
                n = 0
            if n < len(PKG_MAGIC) + 8:
                return self._json({"error": "Das ist kein HoneyCut-Projekt."}, 400)
            root = import_root()
            root.mkdir(parents=True, exist_ok=True)
            if shutil.disk_usage(root).free < n + HAND_SPARE:
                # Kleine Sendungen erst zu Ende lesen, damit die Antwort sicher ankommt; große bricht der Computer gleich ab
                # (das Handy fragt den freien Platz vorher über „info“ ab und schickt dann gar nicht erst).
                if n <= 16_000_000:
                    lim = _Limited(self.rfile, n)
                    while lim.read(1 << 20):
                        pass
                return self._json({"error": "Auf dem Computer ist zu wenig Platz frei."}, 507)
            eid = uuid.uuid4().hex[:8]
            job = {"cancel": False, "progress": 0, "message": ""}
            ent = {"id": eid, "name": "Projekt", "bytes": n, "status": "receiving", "error": "", "at": int(time.time() * 1000), "job": job, "result": None}
            HAND["inbox"][eid] = ent
            try:
                res = package_read(job, _Limited(self.rfile, n))
                ent["result"], ent["status"] = res, "ready"
                ent["name"] = ((res["header"].get("project") or {}).get("name") or "Projekt")[:120]
                log(f"Übergabe: „{ent['name']}“ vom Handy empfangen")
                return self._json({"ok": True, "name": ent["name"]})
            except Exception as e:  # noqa: BLE001
                ent["status"], ent["error"] = "error", str(e) or e.__class__.__name__
                log(f"Übergabe: Empfang fehlgeschlagen ({e!r})")
                return self._json({"error": ent["error"]}, 400)
        except (BrokenPipeError, ConnectionError, OSError):
            pass


def handover_state() -> dict:
    HAND["seen"] = time.time()
    srv, offer = HAND["srv"], HAND["offer"]
    if not srv:
        return {"active": False}
    ips = lan_ips()
    return {"active": True, "port": HAND["port"], "ips": ips, "urls": [f"http://{ip}:{HAND['port']}/h/{HAND['token']}" for ip in ips],
            "offer": {"name": offer["name"], "bytes": offer["bytes"], "status": offer["status"], "done": offer.get("done", 0),
                      "progress": round(float((offer.get("job") or {}).get("progress") or 0), 4)} if offer else None,
            "inbox": [{"id": e["id"], "name": e["name"], "bytes": e["bytes"], "status": e["status"], "error": e["error"], "at": e["at"],
                       "progress": round(float(e["job"].get("progress") or 0), 4)} for e in sorted(HAND["inbox"].values(), key=lambda e: e["at"])]}


def handover_start(spec: dict | None = None, bind: str = "0.0.0.0") -> dict:
    """Empfang im Heimnetz öffnen (falls noch nicht offen) und – mit spec – ein Projekt zum Holen anbieten."""
    with _hand_lock:
        if not HAND["srv"]:
            ThreadingHTTPServer.daemon_threads = True
            srv = ThreadingHTTPServer((bind, 0), HandoverHandler)
            HAND.update(srv=srv, port=srv.server_address[1], token=secrets.token_urlsafe(9), bad=0, inbox={}, offer=None)
            threading.Thread(target=srv.serve_forever, daemon=True).start()
            threading.Thread(target=_hand_watch, args=(srv,), daemon=True).start()
            log(f"Übergabe: Empfang im Heimnetz geöffnet (Port {HAND['port']})")
        if spec is not None:
            head, plan, total = package_plan(spec)
            proj = (spec.get("header") or {}).get("project") or {}
            HAND["offer"] = {"name": (spec.get("name") or proj.get("name") or "Projekt")[:120], "project": str(proj.get("id") or ""), "head": head, "plan": plan, "total": total,
                             "bytes": total + len(head) + len(PKG_MAGIC) + 8, "status": "ready", "done": 0}
    return handover_state()


def _hand_watch(srv):
    while HAND["srv"] is srv:
        time.sleep(5)
        if HAND["srv"] is srv and time.time() - HAND["seen"] > HAND_IDLE:
            log("Übergabe: lange keine Nachfrage der Oberfläche – der Empfang wird geschlossen")
            handover_stop()


def handover_stop() -> dict:
    with _hand_lock:
        srv = HAND["srv"]
        if srv:
            for j in [(HAND["offer"] or {}).get("job")] + [e["job"] for e in HAND["inbox"].values()]:
                if j:
                    j["cancel"] = True   # laufende Übertragungen enden
            HAND.update(srv=None, token="", port=0, offer=None, inbox={})
            try:
                srv.shutdown()
                srv.server_close()
            except Exception:
                pass
            log("Übergabe: Empfang geschlossen")
    return {"active": False}


def handover_take(eid: str) -> dict:
    """Ein vom Handy empfangenes Projekt an die Oberfläche geben (Kopf und Zuordnung der Dateien wie beim Paket-Import)."""
    ent = HAND["inbox"].get(eid)
    if not ent or ent["status"] != "ready":
        raise ValueError("Dieses Projekt ist nicht mehr da.")
    HAND["inbox"].pop(eid, None)
    return ent["result"]


def open_data_dir():
    if platform.system() == "Windows":
        os.startfile(str(DATA_DIR))  # type: ignore[attr-defined]
    else:
        subprocess.Popen(["open" if platform.system() == "Darwin" else "xdg-open", str(DATA_DIR)])


def reveal(path: str):
    p = Path(norm_path(path))
    if norm_path(str(p)) not in CREATED and norm_path(str(p.parent)) not in CREATED:
        raise ValueError("Pfad nicht freigegeben.")
    if platform.system() == "Windows":
        if p.is_file():
            subprocess.Popen(["explorer", "/select,", str(p)])
        else:
            os.startfile(str(p))  # type: ignore[attr-defined]
    elif platform.system() == "Darwin":
        subprocess.Popen(["open", "-R", str(p)])
    else:
        subprocess.Popen(["xdg-open", str(p if p.is_dir() else p.parent)])


def open_file(path: str):
    p = Path(norm_path(path))
    if norm_path(str(p)) not in CREATED:
        raise ValueError("Pfad nicht freigegeben.")
    if platform.system() == "Windows":
        os.startfile(str(p))  # type: ignore[attr-defined]
    elif platform.system() == "Darwin":
        subprocess.Popen(["open", str(p)])
    else:
        subprocess.Popen(["xdg-open", str(p)])


def app_info() -> dict:
    cc = capcut_drafts_dir()
    return {"platform": "desktop", "version": VERSION, "exportFormats": ["video", "audio", "capcut", "concat"], "bus": True, "matte": matte_available(), "stabilize": True, "audiosync": True, "handover": True, "translate": translate_available(), "translatePairs": translate_pairs(),
            "capcutDir": str(cc) if cc else None, "concatDir": str(concat_root()),
            "whisper": whisper_available(), "os": platform.system()}


def handle_open_paths(paths: list[str]):
    """Dateien, die beim Start oder per „Öffnen mit“ übergeben wurden, als neues Projekt öffnen."""
    media = []
    for p in paths:
        try:
            media.append(probe(p))
        except Exception as e:  # noqa: BLE001
            log(f"Startdatei nicht lesbar: {p}: {e}")
    if media and APP_HOOKS.get("open_files"):
        APP_HOOKS["open_files"](media)
    return media


# ───────────────────────────── HTTP ─────────────────────────────

MEDIA_CHUNK = 8 << 20   # 8 MB je Antwort auf offene Bereichsanfragen


class Handler(BaseHTTPRequestHandler):
    server_version = "HoneyCut/2"
    protocol_version = "HTTP/1.1"
    # Antworten sofort und möglichst in einem Stück senden. Ohne das hält das Betriebssystem das zweite kleine Paket
    # (den Inhalt) zurück, bis das erste (die Kopfzeilen) bestätigt ist – und die Gegenseite bestätigt erst nach rund
    # 40 ms. Jede kurze Antwort (Auftragsstatus, Speichern, Vorschaubild) dauerte dadurch 40 ms länger als nötig, und
    # weil die Oberfläche auf viele dieser Antworten wartet, stand sie jedes Mal so lange still.
    disable_nagle_algorithm = True
    wbufsize = 1 << 16

    def log_message(self, fmt, *args):
        pass

    def _send(self, code: int, body: bytes, ctype: str, extra: dict | None = None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def _text(self, txt: str, code=200):
        self._send(code, txt.encode("utf-8"), "application/json; charset=utf-8")

    def _body(self) -> bytes:
        n = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(n) if n else b""

    def _file(self, path: Path, ctype: str | None = None, cache: bool = False):
        size = path.stat().st_size
        ctype = ctype or mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        rng = self.headers.get("Range")
        start, end, code = 0, size - 1, 200
        if rng:
            m = re.match(r"bytes=(\d*)-(\d*)", rng)
            if m:
                if m.group(1):
                    start = int(m.group(1))
                    # offene Anfrage („ab hier bis Ende“) in Stücken beantworten: Die Verbindung ist schnell wieder frei,
                    # der Browser holt den Rest bei Bedarf nach. Sonst halten pausierte Videos Verbindungen dauerhaft fest.
                    end = int(m.group(2)) if m.group(2) else min(size - 1, start + MEDIA_CHUNK - 1)
                else:
                    start = max(0, size - int(m.group(2)))
                end = min(end, size - 1)
                code = 206
        if start > end or start >= size:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        length = end - start + 1
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "max-age=3600" if cache else "no-store")
        if code == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if self.command == "HEAD":
            return
        try:
            with open(path, "rb") as f:
                f.seek(start)
                remaining = length
                while remaining > 0:
                    chunk = f.read(min(1 << 20, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (ConnectionError, OSError):
            self.close_connection = True

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except (ConnectionError, OSError):
            self.close_connection = True

    def _route(self):
        u = urlparse(self.path)
        parts = u.path.split("/", 2)       # ['', TOKEN, rest]
        if len(parts) < 3 or parts[1] != TOKEN:
            return None, u
        return parts[2], u

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        rest, u = self._route()
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            if u.path == "/api/ping":
                return self._json({"app": "textschnitt", "pid": os.getpid()})
            if rest is None:
                if u.path in ("/", "/index.html") and os.environ.get("TEXTSCHNITT_OPEN_ROOT"):
                    self.send_response(302)
                    self.send_header("Location", f"/{TOKEN}/index.html")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                return self._json({"error": "Nicht gefunden"}, 404)
            if rest.startswith("fonts/") and "/" not in rest[6:] and rest.lower().endswith(FONT_EXT + (".txt", ".md")):
                f = WEB_DIR / "fonts" / rest[6:]
                if not f.is_file():
                    return self._json({"error": "Nicht gefunden"}, 404)
                return self._file(f, "font/ttf" if f.suffix.lower() == ".ttf" else "font/otf" if f.suffix.lower() == ".otf" else "text/plain; charset=utf-8", cache=True)
            if rest == "api/fonts":
                return self._json(fonts_list())
            if rest == "api/handover/state":
                return self._json(handover_state())
            if rest == "api/pcm":
                f = VOICE_PCM.get(q.get("id", ""))
                if not f or not f.is_file():
                    return self._json({"error": "Nicht gefunden"}, 404)
                try:
                    return self._send(200, f.read_bytes(), "application/octet-stream")
                finally:
                    f.unlink(missing_ok=True)
                    VOICE_PCM.pop(q.get("id", ""), None)
            if rest.startswith("deck/"):
                d = deck_dir()
                sub = rest[5:] or "index.html"
                if not d or ".." in sub or sub.startswith(("/", "\\")):
                    return self._json({"error": "HoneyDeck ist nicht installiert"}, 404)
                f = (d / sub).resolve()
                if not str(f).startswith(str(d.resolve())) or not f.is_file():
                    return self._json({"error": "Nicht gefunden"}, 404)
                return self._send(200, f.read_bytes(), DECK_TYPES.get(f.suffix.lower(), "application/octet-stream"))
            if rest in ("", "index.html", "app.js", "studio.js", "slides.js", "deck-host.js", "app.css", "bridge-http.js", "icons.js", "chroma.js", "stimmen.js", "folgen.js", "skript.js", "thumb-engine.js", "thumb-cut.js", "titelbild.js"):
                f = WEB_DIR / (rest or "index.html")
                ctype = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                         ".css": "text/css; charset=utf-8"}[f.suffix]
                return self._send(200, f.read_bytes(), ctype)
            if rest == "media":
                p = norm_path(q.get("u") or q.get("f") or "")
                if p not in ALLOWED or not os.path.isfile(p):
                    return self._json({"error": "Nicht freigegeben"}, 403)
                return self._file(Path(p))
            if rest == "thumb":
                p = norm_path(q.get("u", ""))
                if p not in ALLOWED:
                    return self._json({"error": "Nicht freigegeben"}, 403)
                t = thumb(p, float(q.get("t", 0)), max(20, min(400, int(float(q.get("h", 120))))))
                if not t:
                    return self._send(404, b"", "image/jpeg")
                return self._file(t, "image/jpeg", cache=True)
            if rest == "api/info":
                return self._json(app_info())
            if rest == "api/gpu":
                return self._json(gpu_info())
            if rest == "api/projects":
                return self._json(list_projects())
            if rest == "api/project":
                return self._text(load_project(q.get("id", "")))
            if rest == "api/models":
                return self._json(models_list())
            if rest == "api/project/versions":
                return self._json(project_versions(q.get("id", "")))
            if rest == "api/trash":
                return self._json(trash_list())
            if rest == "api/trash/count":
                return self._json({"n": trash_count()})
            if rest == "api/storage":
                return self._json(storage_info())
            if rest == "api/update":
                return self._json(update_state())
            if rest == "api/bus":
                return self._json(bus_get(q.get("p", ""), int(q.get("since", "-1")), q.get("from", "")))
            if rest == "api/job":
                job = JOBS.get(q.get("id", ""))
                if not job:
                    return self._text("null")
                if job["status"] != "running":
                    job["fetched"] = time.time()   # Ergebnis wurde abgeholt (siehe prune_jobs)
                return self._json({k: v for k, v in job.items() if k not in ("cancel", "fetched", "ended")})
            return self._json({"error": "Nicht gefunden"}, 404)
        except (ConnectionError, OSError) as e:
            if isinstance(e, FileNotFoundError):
                return self._json({"error": str(e)}, 404)
            self.close_connection = True
        except Exception as e:  # noqa: BLE001
            log(f"GET {u.path}: {e!r}")
            self._json({"error": str(e)}, 500)

    def do_POST(self):
        rest, u = self._route()
        q = {k: v[0] for k, v in parse_qs(u.query).items()}
        try:
            raw = self._body()
            if u.path == "/api/focus":   # zweiter Programmstart übergibt Dateien
                data = json.loads(raw or b"{}")
                if APP_HOOKS.get("focus"):
                    APP_HOOKS["focus"]()
                if data.get("paths"):
                    threading.Thread(target=handle_open_paths, args=(data["paths"],), daemon=True).start()
                return self._json({"ok": True})
            if rest is None:
                return self._json({"error": "Nicht gefunden"}, 404)
            if rest == "api/savefile":   # Datei aus HoneyDeck (eingebettet) speichern
                data = json.loads(raw or b"{}")
                name = re.sub(r'[\\/:*?"<>|]', "_", data.get("name") or "Datei")[:120]
                dest = save_any_dialog(name)
                if not dest:
                    return self._json({"ok": False})
                Path(dest).write_bytes(base64.b64decode(data.get("data") or ""))
                return self._json({"ok": True, "path": dest})
            if rest == "api/project":
                if len(raw) != int(self.headers.get("Content-Length") or 0):
                    raise ValueError("Der Projektstand kam unvollständig an und wurde nicht gespeichert.")
                txt = raw.decode("utf-8")
                try:
                    obj = json.loads(txt)
                except ValueError:
                    raise ValueError("Der Projektstand kam unvollständig an und wurde nicht gespeichert.")
                save_project(q.get("id", ""), txt, obj)
                allow_all(obj)
                return self._text('"ok"')
            if rest == "api/log":   # Meldungen der Oberfläche (unerwartete Fehler, Auffälligkeiten beim Abspielen) für die Fehlersuche
                log("Oberfläche: " + raw.decode("utf-8", "replace")[:800].replace("\n", " ⏎ "))
                return self._json({"ok": True})
            if rest == "api/bus":
                if q.get("bye"):
                    bus_bye(q.get("p", ""), q.get("from", ""))
                else:
                    bus_post(q.get("p", ""), q.get("from", ""), raw.decode("utf-8"), q.get("k", ""))
                return self._json({"ok": True})
            if rest == "api/project/delete":
                delete_project(q.get("id", ""))
                return self._json({"ok": True})
            data = json.loads(raw or b"{}")
            if rest == "api/project/restore":
                return self._json(restore_version(str(data.get("id") or ""), str(data.get("file") or ""), bool(data.get("copy"))))
            if rest == "api/trash/restore":
                return self._json(trash_restore(str(data.get("id") or "")))
            if rest == "api/storage/clear":
                return self._json(storage_clear(str(data.get("what") or ""), str(data.get("name") or "")))
            if rest == "api/storage/open":
                open_data_dir()
                return self._json({"ok": True})
            if rest == "api/update/check":
                return self._json(update_check(force=True))
            if rest == "api/update/open":
                return self._json(update_open(str(data.get("what") or "installer")))
            if rest == "api/update/set":   # Prüfung ein-/ausschalten, eine Version überspringen
                patch = {}
                if "enabled" in data:
                    patch["updates"] = bool(data["enabled"])
                if "skip" in data:
                    patch["updateSkip"] = str(data["skip"] or "")[:20]
                settings_set(**patch)
                return self._json(update_state())
            if rest == "api/report":
                dest = save_any_dialog(f"HoneyCut-Fehlerbericht-{time.strftime('%Y-%m-%d-%H%M')}.txt")
                if not dest:
                    return self._json({"ok": False})
                dest = _with_ext(dest, ".txt")
                Path(dest).write_text(report_text(data.get("ui") if isinstance(data.get("ui"), dict) else None), encoding="utf-8")
                CREATED.add(norm_path(dest))
                return self._json({"ok": True, "path": norm_path(dest)})
            if rest == "api/backup/export":
                dest = save_any_dialog(f"HoneyCut-Sicherung-{time.strftime('%Y-%m-%d')}.zip")
                if not dest:
                    return self._json(None)
                job = run_job(new_job("backup-export"), backup_all_job, _with_ext(dest, ".zip"), data.get("prefs") if isinstance(data.get("prefs"), dict) else None)
                return self._json({"job": job["id"]})
            if rest == "api/backup/import":
                src = open_dialog_backup()
                if not src:
                    return self._json(None)
                job = run_job(new_job("backup-import"), backup_restore_job, src)
                return self._json({"job": job["id"]})
            if rest == "api/trash/purge":
                return self._json(trash_purge(None if data.get("all") else str(data.get("id") or "-")))
            if rest == "api/fullscreen":
                fn = APP_HOOKS.get("fullscreen")
                return self._json({"ok": bool(fn and fn(bool(data.get("on"))))})
            if rest == "api/fonts/delete":
                return self._json({"ok": font_delete(data.get("uri", ""))})
            if rest == "api/pick":
                return self._json(picked_media(data.get("kind", "videos")))
            if rest == "api/image":   # erzeugtes Bild (z. B. Folie) speichern und als Medium zurückgeben
                return self._json(save_image(data))
            if rest == "api/handover/start":
                return self._json(handover_start(data.get("spec")))
            if rest == "api/handover/stop":
                return self._json(handover_stop())
            if rest == "api/handover/take":
                return self._json(handover_take(str(data.get("id") or "")))
            if rest == "api/package/export":
                dest = save_dialog(re.sub(r'[\\/:*?"<>|]', "_", data.get("name") or "Projekt")[:80] + ".honeycut")
                if not dest:
                    return self._json(None)
                job = run_job(new_job("package-export"), package_export_job, data, _with_ext(dest, ".honeycut"))
                return self._json({"job": job["id"]})
            if rest == "api/package/import":
                src = open_dialog_package()
                if not src:
                    return self._json(None)
                job = run_job(new_job("package-import"), package_import_job, src)
                return self._json({"job": job["id"]})
            if rest == "api/transcribe":
                if not whisper_available():
                    raise ValueError("faster-whisper ist nicht installiert.")
                job = run_job(new_job("transcribe"), transcribe_job, data["uri"], data.get("model") or "small",
                              data.get("lang") or None, bool(data.get("fillers", True)), data.get("ranges"), data.get("hint"))
                return self._json({"job": job["id"]})
            if rest == "api/models/download":
                job = run_job(new_job("download"), download_job, data["name"])
                return self._json({"job": job["id"]})
            if rest == "api/export":
                if not data.get("segments"):
                    raise ValueError("Nach dem Schnitt bleibt nichts übrig.")
                job = run_job(new_job("export"), export_job, data)
                return self._json({"job": job["id"]})
            if rest == "api/envelope":
                job = run_job(new_job("envelope"), envelope_job, data["uri"])
                return self._json({"job": job["id"]})
            if rest == "api/persontrack":
                job = run_job(new_job("persontrack"), person_track_job, data["uri"])
                return self._json({"job": job["id"]})
            if rest == "api/voicepcm":
                job = run_job(new_job("voicepcm"), voice_pcm_job, data["uri"])
                return self._json({"job": job["id"]})
            if rest == "api/window":
                pid, view = re.sub(r"[^A-Za-z0-9_-]", "", data.get("project", "")), data.get("view", "text")
                url = app_url(self.server.server_address[1]) + f"#p={pid}&view={view}"
                if APP_HOOKS.get("open_window"):
                    APP_HOOKS["open_window"](url, VIEW_LBL.get(view, view))
                    return self._json({"ok": True})
                return self._json({"url": url})
            if rest == "api/proxy":
                job = run_job(new_job("proxy"), proxy_job, data["uri"])
                return self._json({"job": job["id"]})
            if rest == "api/translate":
                if not translate_available():
                    raise ValueError("Übersetzen braucht das Übersetzungsmodell aus dem Installer (ab Version 2.22).")
                job = run_job(new_job("translate"), translate_job, list(data.get("texts") or []), data.get("src") or "de", data.get("tgt") or "en")
                return self._json({"job": job["id"]})
            if rest == "api/matte":
                if not matte_available():
                    raise ValueError("Automatisches Freistellen braucht onnxruntime (in der installierten Version enthalten).")
                job = run_job(new_job("matte"), matte_job, data["uri"])
                return self._json({"job": job["id"]})
            if rest == "api/audiosync":
                job = run_job(new_job("audiosync"), audio_sync_job, data["uri"], data["audio"])
                return self._json({"job": job["id"]})
            if rest == "api/stabilize":
                job = run_job(new_job("stabilize"), stabilize_job, data["uri"], data.get("level") or 2)
                return self._json({"job": job["id"]})
            if rest == "api/cancel":
                job = JOBS.get(data.get("id", ""))
                if job:
                    job["cancel"] = True
                return self._json({"ok": True})
            if rest == "api/reveal":
                reveal(data.get("path", ""))
                return self._json({"ok": True})
            if rest == "api/open":
                open_file(data.get("path", ""))
                return self._json({"ok": True})
            return self._json({"error": "Nicht gefunden"}, 404)
        except Exception as e:  # noqa: BLE001
            log(f"POST {u.path}: {e!r}")
            self._json({"error": str(e)}, 400)


_housekept = False


def make_server(port: int) -> ThreadingHTTPServer:
    global _housekept
    ThreadingHTTPServer.daemon_threads = True
    srv = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    if not _housekept:   # einmal je Programmstart, eine halbe Minute nach dem Start und ohne den Start aufzuhalten
        _housekept = True
        t = threading.Timer(30, housekeeping)
        t.daemon = True
        t.start()
    return srv


def app_url(port: int) -> str:
    return f"http://127.0.0.1:{port}/{TOKEN}/index.html"


def main():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    if not shutil.which(FFMPEG) or not shutil.which(FFPROBE):
        print("⚠  ffmpeg/ffprobe nicht gefunden. Bitte installieren und in den PATH aufnehmen.")
    srv = make_server(PORT)
    url = app_url(PORT)
    print(f"HoneyCut läuft auf {url}  (Beenden mit Strg+C)")
    log(f"Start – Python {sys.version.split()[0]}, {platform.platform()}, faster-whisper {'ja' if whisper_available() else 'nein'}")
    if not os.environ.get("TEXTSCHNITT_NO_BROWSER"):
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nBeendet.")


if __name__ == "__main__":
    main()
