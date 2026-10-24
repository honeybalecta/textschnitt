#!/usr/bin/env python3
"""
Textschnitt – Desktop-Backend für das gemeinsame Studio (core/web).

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

VERSION = "2.5.0"
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


def norm_path(p: str) -> str:
    return str(Path(p).expanduser().resolve())


def allow(p: str | Path) -> str:
    s = norm_path(str(p))
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
    res = subprocess.run([FFPROBE, "-v", "error", "-print_format", "json", "-show_streams", "-show_format", path],
                         capture_output=True, text=True, encoding="utf-8", errors="replace", **NOWIN)
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

def new_job(kind: str) -> dict:
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
            job["status"] = "cancelled" if job["cancel"] else "done"
            job["progress"] = 1.0
            log(f"Job {job['kind']} fertig nach {time.time() - job['started']:.0f} s")
        except BaseException as e:  # noqa: BLE001
            import traceback
            job["status"] = "cancelled" if job["cancel"] else "error"
            job["error"] = str(e) or e.__class__.__name__
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
    for line in p.stdout:  # type: ignore[union-attr]
        if job and (line.startswith("out_time_us=") or line.startswith("out_time_ms=")):
            val = line.split("=", 1)[1].strip()
            if val.isdigit() and total > 0:
                job["progress"] = base + span * min(1.0, int(val) / 1e6 / total)
        if job and job["cancel"]:
            p.terminate()
    p.wait()
    t.join(timeout=2)
    if job and job["cancel"]:
        raise RuntimeError("Abgebrochen")
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
        return sorted(d.name for d in MODELS_DIR.iterdir() if (d / "model.bin").exists())
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


def transcribe_job(job: dict, path: str, model_name: str, language: str | None, fillers: bool):
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
        run_ffmpeg(["-i", path, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)], duration, job, 0.0, 0.04)
        audio = read_wav16k(wav)
    finally:
        wav.unlink(missing_ok=True)
    env = envelope(audio)
    model, device = get_model(model_name, phase, job)
    if job["cancel"]:
        raise RuntimeError("Abgebrochen")
    job["progress"] = 0.05
    phase["text"] = "Transkription startet (die erste Minute dauert am längsten)"
    prompt = FILLER_PROMPT.get(language or "de") if fillers else None
    segments, tinfo = model.transcribe(audio, language=language or None, word_timestamps=True, initial_prompt=prompt,
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
    return {"words": words, "lang": language or getattr(tinfo, "language", None), "env": env}


def envelope_job(job: dict, path: str):
    """Nur die Lautstärke-Hüllkurve (für ältere Projekte ohne)."""
    path = norm_path(path)
    info = probe(path)
    job["message"] = "Analysiere Ton …"
    wav = Path(tempfile.gettempdir()) / f"textschnitt_{uuid.uuid4().hex[:8]}.wav"
    try:
        run_ffmpeg(["-i", path, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)], info["duration"], job)
        return {"env": envelope(read_wav16k(wav))}
    finally:
        wav.unlink(missing_ok=True)


# ───────────────────────────── Mehrere Fenster: Nachrichten zwischen den Fenstern ─────────────────────────────

BUS: dict[str, dict] = {}
_bus_lock = threading.Lock()


def bus_post(pid: str, sender: str, msg: str):
    with _bus_lock:
        b = BUS.setdefault(pid, {"seq": 0, "msgs": []})
        b["seq"] += 1
        b["msgs"].append((b["seq"], sender, msg))
        del b["msgs"][:-300]


def bus_get(pid: str, since: int, sender: str) -> dict:
    with _bus_lock:
        b = BUS.get(pid) or {"seq": 0, "msgs": []}
        if since < 0:
            return {"seq": b["seq"], "msgs": []}
        return {"seq": b["seq"], "msgs": [m for s, f, m in b["msgs"] if s > since and f != sender]}


VIEW_LBL = {"text": "Text", "subs": "Untertitel", "studio": "Studio", "export": "Export"}


def proxy_job(job: dict, path: str):
    path = norm_path(path)
    info = probe(path)
    out = CACHE_DIR / "proxies" / (hashlib.sha1(path.encode("utf-8")).hexdigest()[:16] + ".mp4")
    job["message"] = "Erstelle Vorschau-Datei …"
    run_ffmpeg(["-i", path, "-vf", "scale=-2:'min(720,ih)'", "-c:v", "libx264", "-preset", "veryfast", "-crf", "26",
                "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(out)], info["duration"], job)
    return {"path": allow(out)}


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
    if out.exists():
        return out
    info = probe(path)
    if not info["hasVideo"]:
        return None
    with _thumb_sem:
        if out.exists():
            return out
        tmp = out.with_suffix(".tmp.jpg")
        seek = [] if info["kind"] == "image" else ["-ss", f"{max(0.0, min(t, info['duration'] - 0.05)):.2f}"]
        subprocess.run([FFMPEG, "-v", "error", "-y"] + seek + ["-i", path, "-frames:v", "1", "-vf", f"scale=-2:{h}",
                        "-q:v", "6", str(tmp)], capture_output=True, **NOWIN)
        if tmp.exists() and tmp.stat().st_size:
            tmp.replace(out)
            return out
    return None


# ───────────────────────────── Export: Untertitel-Dateien ─────────────────────────────

SUB_SIZES = {"klein": 0.045, "mittel": 0.058, "groß": 0.075}


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = (h or "#FFFFFF").lstrip("#")
    if len(h) != 6:
        h = "FFFFFF"
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def clean_cues(raw) -> list[dict]:
    cues = []
    for c in raw or []:
        try:
            s, e, txt = float(c["start"]), float(c["end"]), str(c["text"]).strip()
        except (KeyError, TypeError, ValueError):
            continue
        if txt and e - s > 0.05:
            cues.append({"start": max(0.0, s), "end": e, "text": txt.replace("\r", ""),
                         "x": float(c.get("x", 0.5) if c.get("x") is not None else 0.5),
                         "y": float(c.get("y", 0.88) if c.get("y") is not None else 0.88),
                         "size": float(c["size"]) if c.get("size") else None, "color": c.get("color"),
                         "outline": c.get("outline"), "bg": bool(c.get("bg")), "title": bool(c.get("title")),
                         "font": str(c.get("font") or "")})
    cues.sort(key=lambda c: c["start"])
    return cues


def write_srt(cues: list[dict], out: Path):
    lines = []
    for n, c in enumerate(cues, 1):
        lines += [str(n), f"{fmt_ts(c['start'])} --> {fmt_ts(c['end'])}", c["text"], ""]
    out.write_text("\n".join(lines), encoding="utf-8")


def sub_px(style: dict, w: int, h: int) -> float:
    return SUB_SIZES.get(style.get("size", "mittel"), 0.058) * min(w, h) * (1.25 if h > w else 1.0)


def collect_fonts(fonts: dict, dest: Path) -> dict:
    """Benötigte Schriftdateien in den Export-Ordner kopieren; liefert {Schlüssel: Familienname}."""
    names = {}
    dest.mkdir(parents=True, exist_ok=True)
    for key, f in (fonts or {}).items():
        try:
            src = WEB_DIR / "fonts" / Path(f["file"]).name if f.get("file") else Path(norm_path(f.get("uri", "")))
            if not src.is_file():
                continue
            dest.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src, dest / f"{key}{src.suffix.lower()}")
            names[key] = (str(f.get("family") or "").replace(",", " "), bool(f.get("bold")))
        except Exception as e:  # noqa: BLE001
            log(f"Schrift {key}: {e}")
    return names


def write_ass(cues: list[dict], style: dict, out: Path, w: int, h: int, fonts: dict | None = None):
    """ASS-Untertitel mit fester Position je Zeile (\\an5\\pos = Mittelpunkt), wie in der Vorschau."""
    fonts = fonts or {}
    size = sub_px(style, w, h)
    fam, fbold = fonts.get(style.get("font") or "") or ("", False)
    r, g, b = hex_rgb(style.get("color", "#FFFFFF"))
    outline = max(1.0, size / 14) if style.get("outline", True) else 0
    shadow = 0 if style.get("outline", True) else max(1.0, size / 20)

    def ts(t):
        cs = int(round(t * 100))
        hh, cs = divmod(cs, 360000)
        mm, cs = divmod(cs, 6000)
        ss, cs = divmod(cs, 100)
        return f"{hh}:{mm:02d}:{ss:02d}.{cs:02d}"
    lines = ["[Script Info]", "ScriptType: v4.00+", f"PlayResX: {w}", f"PlayResY: {h}", "WrapStyle: 2",
             "ScaledBorderAndShadow: yes", "", "[V4+ Styles]",
             "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, "
             "Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
             "Alignment, MarginL, MarginR, MarginV, Encoding",
             f"Style: Default,{fam or 'Arial'},{size:.0f},&H00{b:02X}{g:02X}{r:02X},&H00FFFFFF,&H00000000,&H96000000,"
             f"{-1 if fbold or not fam else 0},0,0,0,100,100,0,0,1,{outline:.1f},{shadow:.1f},5,0,0,0,1",
             "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"]
    for c in cues:
        rows = c["text"].split("\n")
        csize = c["size"] * min(w, h) * (1.25 if h > w else 1.0) if c.get("size") else size
        bw = max(len(x) for x in rows) * csize * 0.56
        bh = len(rows) * csize * 1.15
        m = 0.02
        cx = min(max(c["x"] * w, bw / 2 + m * w), w - bw / 2 - m * w) if bw < w * (1 - 2 * m) else w / 2
        cy = min(max(c["y"] * h, bh / 2 + m * h), h - bh / 2 - m * h)
        txt = c["text"].replace("{", "(").replace("}", ")").replace("\n", "\\N")
        ov = f"\\an5\\pos({cx:.0f},{cy:.0f})"
        if c.get("size"):
            ov += f"\\fs{csize:.0f}"
        if c.get("title"):
            tf, tb = fonts.get(c.get("font") or "") or ("", True)
            ov += f"\\fn{tf}\\b{1 if tb else 0}" if tf else "\\fnArial\\b1"
        if c.get("color"):
            cr, cg, cb = hex_rgb(c["color"])
            ov += f"\\1c&H{cb:02X}{cg:02X}{cr:02X}&"
        if c.get("outline") is not None and c.get("title"):
            ov += f"\\bord{max(1.0, csize / 14):.1f}" if c["outline"] else "\\bord0\\shad1"
        if c.get("bg"):
            ov += f"\\bord{max(2.0, csize / 8):.1f}\\3c&H000000&\\3a&H60&"   # dunkler Kasten statt Umrandung
        lines.append(f"Dialogue: 0,{ts(c['start'])},{ts(c['end'])},Default,,0,0,0,,{{{ov}}}{txt}")
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


def seg_fx(s: dict) -> dict:
    return {"speed": max(0.25, min(4.0, float(s.get("speed") or 1))), "vol": max(0.0, min(4.0, float(s.get("vol", 1) if s.get("vol") is not None else 1))),
            "bright": float(s.get("bright") or 0), "contrast": float(s.get("contrast") or 0), "sat": float(s.get("sat") or 0), "gray": bool(s.get("gray"))}


def video_fx_chain(fx: dict) -> str:
    parts = []
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
    for k, s in enumerate(plan["segments"]):
        a0, b0 = float(s["in"]), float(s["out"])
        fx = seg_fx(s) if s.get("kind") == "main" else seg_fx({})
        sp = fx["speed"]
        d = max(0.04, (b0 - a0) / sp)
        img = bool(s.get("image"))
        vlab, alab = f"[v{k}]", f"[a{k}]"
        if img:
            i = image_input(s["uri"], d) if with_video else None
            if with_video:
                parts.append(f"[{i}:v:0]{fit},fps={fps_s},format=yuv420p,trim=duration={d:.4f},setpts=PTS-STARTPTS{vlab}")
            parts.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={d:.4f},aformat=sample_fmts=fltp:channel_layouts=stereo{alab}")
        else:
            i = file_input(s["uri"])
            off = starts.get(norm_path(s["uri"]), 0.0)
            if with_video:
                if s.get("hasVideo", True):
                    z = ""
                    if s.get("zooms"):
                        zx, cx, cy = zoom_expr(s["zooms"], a0)
                        if abs(sp - 1) > 1e-3:
                            zx, cx, cy = (e.replace("it", f"(it*{sp:.4f})") for e in (zx, cx, cy))
                        z = (f",zoompan=z='{zx}':x='{cx}*iw*(1-1/zoom)':y='{cy}*ih*(1-1/zoom)':d=1:s={W}x{H}:fps={fps_s}")
                    spv = f"setpts=(PTS-STARTPTS)/{sp:.4f}" if abs(sp - 1) > 1e-3 else "setpts=PTS-STARTPTS"
                    parts.append(f"[{i}:v:0]trim=start={a0 + off:.4f}:end={b0 + off:.4f},{spv},{fit},fps={fps_s}{z}{video_fx_chain(fx)},format=yuv420p{vlab}")
                else:
                    parts.append(f"color=c=black:s={W}x{H}:r={fps_s},trim=duration={d:.4f},format=yuv420p,setsar=1{vlab}")
            if s.get("hasAudio", True):
                f = min(0.008, d / 4)
                spa = atempo_chain(sp) if abs(sp - 1) > 1e-3 else ""
                vol = f",volume={fx['vol']:.3f}" if abs(fx["vol"] - 1) > 1e-3 else ""
                parts.append(f"[{i}:a:0]atrim=start={a0 + off:.4f}:end={b0 + off:.4f},asetpts=PTS-STARTPTS,"
                             f"aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo{spa}{vol},"
                             f"afade=t=in:st=0:d={f:.4f},afade=t=out:st={max(0, d - f):.4f}:d={f:.4f}{alab}")
            else:
                parts.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={d:.4f},aformat=sample_fmts=fltp:channel_layouts=stereo{alab}")
        labels.append((vlab if with_video else "") + alab)
    n = len(plan["segments"])
    parts.append("".join(labels) + f"concat=n={n}:v={int(with_video)}:a=1" + ("[base]" if with_video else "") + "[aout]")
    if with_video:
        cur = "[base]"
        for k, o in enumerate(plan.get("overlays") or []):
            at, inn, out = float(o["at"]), float(o["in"]), float(o["out"])
            d = max(0.05, out - inn)
            if o.get("mode") == "pip" and o.get("w") is not None:
                # frei platziert: Mittelpunkt x/y, Breite w (Anteil), Seitenverhältnis des Clips
                pw = max(2, round(W * float(o["w"]) / 2) * 2)
                ph = max(2, round(pw / max(0.05, float(o.get("aspect") or 16 / 9)) / 2) * 2)
                x = round(float(o.get("x", 0.5)) * W - pw / 2)
                y = round(float(o.get("y", 0.5)) * H - ph / 2)
                sc = f"scale={pw}:{ph}:force_original_aspect_ratio=increase,crop={pw}:{ph},setsar=1"
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
            if o.get("image"):
                i = image_input(o["uri"], d)
                src = f"[{i}:v:0]trim=duration={d:.4f},setpts=PTS-STARTPTS+{at:.4f}/TB"
            else:
                i = file_input(o["uri"])
                off = starts.get(norm_path(o["uri"]), 0.0)
                src = f"[{i}:v:0]trim=start={inn + off:.4f}:end={inn + d + off:.4f},setpts=PTS-STARTPTS+{at:.4f}/TB"
            parts.append(f"{src},fps={fps_s},{sc},format=yuva420p[o{k}]")
            parts.append(f"{cur}[o{k}]overlay=x={x}:y={y}:eof_action=pass:enable='between(t,{at:.4f},{at + d:.4f})'[c{k}]")
            cur = f"[c{k}]"
        if ass_name:
            parts.append(f"{cur}subtitles=filename={ass_name}:fontsdir=fonts[vout]")
        else:
            parts.append(f"{cur}null[vout]")
    flat = [x for a in inputs for x in a]
    return flat, ";\n".join(parts) + "\n"


QUALITY_CRF = {"hoch": "16", "standard": "20", "klein": "25"}
AUDIO_CODECS = {"wav": ["-c:a", "pcm_s16le"], "mp3": ["-c:a", "libmp3lame", "-b:a", "192k"],
                "m4a": ["-c:a", "aac", "-b:a", "192k"], "flac": ["-c:a", "flac"]}


def render_plan(job: dict, plan: dict, out: Path, with_video: bool, cues: list[dict]):
    tmp = Path(tempfile.mkdtemp(prefix="textschnitt_"))
    try:
        ass = None
        if with_video and cues and plan.get("burn", True):
            ass = "untertitel.ass"
            subs = plan.get("subs") or {}
            fonts = collect_fonts(subs.get("fonts") or {}, tmp / "fonts")
            write_ass(cues, subs.get("style") or {}, tmp / ass, int(plan["width"]) // 2 * 2, int(plan["height"]) // 2 * 2, fonts)
        inputs, graph = build_graph(plan, with_video, ass)
        script = tmp / "filter.txt"
        script.write_text(graph, encoding="utf-8")
        flag = ["-/filter_complex", str(script)] if ffmpeg_major() >= 7 else ["-filter_complex_script", str(script)]
        if with_video:
            tail = ["-map", "[vout]", "-map", "[aout]", "-c:v", "libx264", "-crf", QUALITY_CRF.get(plan.get("quality"), "20"),
                    "-preset", "medium", "-pix_fmt", "yuv420p", "-r", f"{float(plan.get('fps') or 30):.3f}",
                    "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", str(out)]
        else:
            tail = ["-map", "[aout]", "-vn"] + AUDIO_CODECS.get(plan.get("audioFormat") or "wav", AUDIO_CODECS["wav"]) + [str(out)]
        total = float(plan.get("total") or 1)
        try:
            run_ffmpeg(inputs + flag + tail, total, job, cwd=tmp)
        except RuntimeError as e:
            if "Unrecognized option" in str(e) or "Option not found" in str(e):
                other = ["-filter_complex_script", str(script)] if flag[0].startswith("-/") else ["-/filter_complex", str(script)]
                run_ffmpeg(inputs + other + tail, total, job, cwd=tmp)
            else:
                raise
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


def cover_factor(cw: float, ch: float, W: float, H: float) -> float:
    if not cw or not ch:
        return 1.0
    return max(W / cw, H / ch) / min(W / cw, H / ch)


def pip_scale(o: dict, W: float, H: float) -> float:
    """Skalierung einer Einblendung in CapCut/Concat (Clip wird dort zuerst ins Bild eingepasst)."""
    if o.get("w") is None:
        return float(o.get("size") or 0.33)
    a = max(0.05, float(o.get("aspect") or 16 / 9))
    return round(float(o["w"]) * W / min(W, H * a), 4)


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
    """Concat-Projekt (concat.json): T1 Hauptspur, T2 B-Roll/Bild-im-Bild, T3 Untertitel."""
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
        fx = seg_fx(s) if s.get("kind") == "main" else seg_fx({})
        for a, b, sc, cx, cy in pieces:
            d = (b - a) / fx["speed"]
            if d <= 0.0005:
                continue
            c = {**base, "id": f"c{len(clips) + 1}", "trackId": "T1", "kind": kind, "mediaId": m,
                 "name": Path(s["uri"]).name, "start": round(cursor, 6), "duration": round(d, 6),
                 "sourceStart": round(0.0 if img else a, 6), "speed": round(fx["speed"], 4), "volume": round(fx["vol"], 3)}
            if sc > 1.001:
                c.update(scale=round(sc, 4), offsetX=round((cx - 0.5) * (1 - sc), 4), offsetY=round((cy - 0.5) * (1 - sc), 4))
            clips.append(c)
            cursor += d
    for o in plan.get("overlays") or []:
        img = bool(o.get("image"))
        m = med(o["uri"], img)
        d = float(o["out"]) - float(o["in"])
        c = {**base, "id": f"c{len(clips) + 1}", "trackId": "T2", "kind": "image" if img else "video", "mediaId": m,
             "name": Path(o["uri"]).name, "start": round(float(o["at"]), 6), "duration": round(d, 6),
             "sourceStart": round(0.0 if img else float(o["in"]), 6), "volume": 0.0}
        if o.get("mode") == "pip":
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
        clips.append({**base, "id": f"c{len(clips) + 1}", "trackId": "T3", "kind": "text", "mediaId": "",
                      "name": cu["text"].split("\n")[0][:40], "start": round(cu["start"], 6), "duration": round(d, 6),
                      "offsetX": round(cu["x"] - 0.5, 4), "offsetY": round(cu["y"] - 0.5, 4),
                      "text": {"content": cu["text"], "fontSize": round(cu["size"] * 0.78, 4) if cu.get("size") else CONCAT_SIZES.get(style.get("size", "mittel"), 0.045),
                               "fontWeight": 700, "italic": False, "color": (cu.get("color") or style.get("color") or "#FFFFFF").lower(),
                               "align": "center", "opacity": 1.0, "strokeWidth": 0.0045 if outline else 0.0,
                               "strokeColor": "#000000", "shadow": bool(outline), "background": "", "lineHeight": 1.2,
                               "tracking": 0.0, "maxWidth": 0.9, "maxHeight": 0.0}})
    for c in clips:   # nicht benötigte Felder bei Textclips entfernen
        if c["kind"] == "text":
            c.pop("sourceStart", None)
            c.pop("preservePitch", None)
    tracks = [{"id": f"T{i}", "muted": False, "visible": True} for i in range(1, 5)]
    timeline = {"id": "TL1", "name": "Timeline 1", "tracks": tracks, "clips": clips, "video": video}
    doc = {"activeTimelineId": "TL1", "clips": clips, "concat": "0.1.0", "fonts": [], "media": media,
           "name": folder.name, "timelines": [timeline], "tracks": tracks, "version": 1, "video": video}
    check_concat(doc)
    (folder / "concat.json").write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    if cues:
        write_srt(cues, folder / f"{safe_name(name)}.srt")
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
    outline = cue["outline"] if cue.get("title") and cue.get("outline") is not None else style.get("outline", True)
    content = {"styles": [{
        "fill": {"alpha": 1.0, "content": {"render_type": "solid", "solid": {"alpha": 1.0, "color": [r / 255, g / 255, b / 255]}}},
        "range": [0, len(text.encode("utf-16-le")) // 2],
        "size": round(cue["size"] / 0.058 * 8.0, 2) if cue.get("size") else CAPCUT_SIZES.get(style.get("size", "mittel"), 8.0),
        "bold": False, "italic": False, "underline": False,
        "strokes": [{"content": {"solid": {"alpha": 1.0, "color": [0, 0, 0]}}, "width": 0.08}] if outline else [],
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

    def material(uri: str, image: bool) -> tuple[str, str, dict]:
        uri = norm_path(uri)
        if uri in mats:
            return mats[uri]
        info = probe(uri)
        mid = uuid.uuid4().hex
        dur = us(10800.0 if image else info["duration"])
        if info["hasVideo"] or image:
            materials["videos"].append({
                "audio_fade": None, "category_id": "", "category_name": "local", "check_flag": 63487,
                "crop": {"upper_left_x": 0.0, "upper_left_y": 0.0, "upper_right_x": 1.0, "upper_right_y": 0.0,
                         "lower_left_x": 0.0, "lower_left_y": 1.0, "lower_right_x": 1.0, "lower_right_y": 1.0},
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
        meta_values.append({"create_time": now, "duration": dur, "extra_info": Path(uri).name, "file_Path": uri,
                            "height": info["height"], "id": _uid(), "import_time": now, "import_time_ms": now * 1_000_000,
                            "item_source": 1, "md5": "", "metetype": "photo" if image else ("video" if kind == "video" else "music"),
                            "roughcut_time_range": {"duration": -1, "start": -1},
                            "sub_time_range": {"duration": -1, "start": -1}, "type": 0, "width": info["width"]})
        mats[uri] = (mid, kind, info)
        return mats[uri]

    def segment(mid: str, kind: str, target: float, src: float | None, d: float, volume=1.0, scale=1.0, tx=0.0, ty=0.0, render=0, speed=1.0):
        speed_id = uuid.uuid4().hex
        materials["speeds"].append({"curve_speed": None, "id": speed_id, "mode": 0, "speed": speed, "type": "speed"})
        seg = {"last_nonzero_volume": 1.0, "reverse": False, "track_attribute": 0, "track_render_index": 0,
               "visible": True, "id": uuid.uuid4().hex, "material_id": mid,
               "target_timerange": {"start": us(target), "duration": us(d)}, "common_keyframes": [], "keyframe_refs": [],
               "source_timerange": {"start": us(src or 0.0), "duration": us(d * speed)}, "speed": speed, "volume": volume,
               "extra_material_refs": [speed_id], "is_tone_modify": False}
        if kind == "video":
            seg.update(VISUAL)
            seg.update({"clip": {"alpha": 1.0, "flip": {"horizontal": False, "vertical": False}, "rotation": 0.0,
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
        pieces = [(float(s["in"]), float(s["out"]), 1.0, 0.5, 0.5)] if img else split_zooms(s)
        fx = seg_fx(s) if s.get("kind") == "main" else seg_fx({})
        for a, b, sc, cx, cy in pieces:
            d = (b - a) / fx["speed"]
            if d <= 0.0005:
                continue
            tx, ty = (2 * (cx - 0.5) * (1 - sc), 2 * (cy - 0.5) * (sc - 1)) if sc > 1.001 else (0.0, 0.0)
            seg = segment(mid, kind, cursor, 0.0 if img else a, d, volume=round(fx["vol"], 3), scale=round(sc, 4), tx=round(tx, 4), ty=round(ty, 4), speed=round(fx["speed"], 4))
            (main_segs if kind == "video" else audio_segs).append(seg)
            cursor += d
    tracks = []
    if main_segs:
        tracks.append({"attribute": 0, "flag": 0, "id": uuid.uuid4().hex, "is_default_name": True, "name": "",
                       "segments": main_segs, "type": "video"})
    if audio_segs:
        tracks.append({"attribute": 0, "flag": 0, "id": uuid.uuid4().hex, "is_default_name": True, "name": "",
                       "segments": audio_segs, "type": "audio"})
    ovl = []
    for o in plan.get("overlays") or []:
        img = bool(o.get("image"))
        mid, kind, info = material(o["uri"], img)
        d = float(o["out"]) - float(o["in"])
        if o.get("mode") == "pip":
            x, y = pip_center(o, W, H)
            ovl.append(segment(mid, "video", float(o["at"]), 0.0 if img else float(o["in"]), d, volume=0.0,
                               scale=pip_scale(o, W, H), tx=round((x - 0.5) * 2, 4), ty=round((0.5 - y) * 2, 4), render=1))
        else:
            ovl.append(segment(mid, "video", float(o["at"]), 0.0 if img else float(o["in"]), d, volume=0.0,
                               scale=round(cover_factor(info["width"], info["height"], W, H), 4), render=1))
    if ovl:
        tracks.append({"attribute": 0, "flag": 0, "id": uuid.uuid4().hex, "is_default_name": False, "name": "B-Roll",
                       "segments": ovl, "type": "video"})
    if cues:
        tsegs = []
        for c in cues:
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
                       "name": "Untertitel", "segments": tsegs, "type": "text"})
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
    outdir = src.parent / f"{src.stem}_textschnitt"
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
            render_plan(job, plan, out, True, cues)
        else:
            out = outdir / f"{stem}.{plan.get('audioFormat') or 'wav'}"
            render_plan(job, plan, out, False, [])
        files.append(out)
        result["playable"] = str(out)
        result["note"] = f"Fertig – gespeichert in {outdir}"
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
    if cues and fmt != "concat":
        outdir.mkdir(exist_ok=True)
        srt = outdir / f"{stem}.srt"
        write_srt(cues, srt)
        files.append(srt)
    for f in files + [outdir]:
        CREATED.add(norm_path(str(f)))
    allow(files[0]) if files and files[0].is_file() else None
    result.update(files=[str(f) for f in files], folder=str(outdir))
    log(f"Export erstellt: {', '.join(result['files'])}")
    return result


# ───────────────────────────── Projekte ─────────────────────────────

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


def list_projects() -> list[dict]:
    out = []
    for f in PROJ_DIR.glob("*.json"):
        try:
            p = json.loads(f.read_text(encoding="utf-8"))
            srcs = p.get("sources") or ([p["main"]] if p.get("main") else [])
            out.append({"id": p["id"], "name": p.get("name", ""), "updated": p.get("updated", 0),
                        "duration": sum(float(s.get("duration") or 0) for s in srcs), "sources": len(srcs),
                        "transcribed": bool(p.get("tokens"))})
        except Exception:
            continue
    return out


def load_project(pid: str) -> str:
    f = proj_path(pid)
    if not f.exists():
        return ""
    txt = f.read_text(encoding="utf-8")
    try:
        uris: set = set()
        collect_uris(json.loads(txt), uris)
        for u in uris:
            allow(u)
    except Exception:
        pass
    return txt


def save_project(pid: str, txt: str):
    f = proj_path(pid)
    tmp = f.with_suffix(".tmp")
    tmp.write_text(txt, encoding="utf-8")
    tmp.replace(f)


# ───────────────────────────── Dateiauswahl, Ordner öffnen ─────────────────────────────

def pick_files(kind: str) -> list[str]:
    multi = kind == "videos"
    if APP_HOOKS.get("pick"):
        return APP_HOOKS["pick"](kind) or []
    types = ("Schriften|*.ttf *.otf" if kind == "font" else f"Video und Audio|{VIDEO_EXT} {AUDIO_EXT}" if kind != "clip" else f"Videos und Bilder|{VIDEO_EXT} {IMAGE_EXT}")
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
    return out if kind == "videos" else out[0]


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
    return {"platform": "desktop", "version": VERSION, "exportFormats": ["video", "audio", "capcut", "concat"], "bus": True,
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

class Handler(BaseHTTPRequestHandler):
    server_version = "Textschnitt/2"
    protocol_version = "HTTP/1.1"

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
                    end = int(m.group(2)) if m.group(2) else size - 1
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
            if rest in ("", "index.html", "app.js", "studio.js", "app.css", "bridge-http.js", "icons.js"):
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
            if rest == "api/projects":
                return self._json(list_projects())
            if rest == "api/project":
                return self._text(load_project(q.get("id", "")))
            if rest == "api/models":
                return self._json(models_list())
            if rest == "api/bus":
                return self._json(bus_get(q.get("p", ""), int(q.get("since", "-1")), q.get("from", "")))
            if rest == "api/job":
                job = JOBS.get(q.get("id", ""))
                if not job:
                    return self._text("null")
                return self._json({k: v for k, v in job.items() if k != "cancel"})
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
            if rest == "api/project":
                save_project(q.get("id", ""), raw.decode("utf-8"))
                try:
                    uris: set = set()
                    collect_uris(json.loads(raw), uris)
                    for x in uris:
                        allow(x)
                except Exception:
                    pass
                return self._text('"ok"')
            if rest == "api/bus":
                bus_post(q.get("p", ""), q.get("from", ""), raw.decode("utf-8"))
                return self._json({"ok": True})
            if rest == "api/project/delete":
                proj_path(q.get("id", "")).unlink(missing_ok=True)
                return self._json({"ok": True})
            data = json.loads(raw or b"{}")
            if rest == "api/fullscreen":
                fn = APP_HOOKS.get("fullscreen")
                return self._json({"ok": bool(fn and fn(bool(data.get("on"))))})
            if rest == "api/fonts/delete":
                return self._json({"ok": font_delete(data.get("uri", ""))})
            if rest == "api/pick":
                return self._json(picked_media(data.get("kind", "videos")))
            if rest == "api/transcribe":
                if not whisper_available():
                    raise ValueError("faster-whisper ist nicht installiert.")
                job = run_job(new_job("transcribe"), transcribe_job, data["uri"], data.get("model") or "small",
                              data.get("lang") or None, bool(data.get("fillers", True)))
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


def make_server(port: int) -> ThreadingHTTPServer:
    ThreadingHTTPServer.daemon_threads = True
    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


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
    print(f"Textschnitt läuft auf {url}  (Beenden mit Strg+C)")
    log(f"Start – Python {sys.version.split()[0]}, {platform.platform()}, faster-whisper {'ja' if whisper_available() else 'nein'}")
    if not os.environ.get("TEXTSCHNITT_NO_BROWSER"):
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nBeendet.")


if __name__ == "__main__":
    main()
