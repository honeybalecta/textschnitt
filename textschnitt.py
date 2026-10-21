#!/usr/bin/env python3
"""
Textschnitt – gesprochene Videos über das Transkript schneiden.

Start:  python textschnitt.py [videodatei]
Danach öffnet sich die Oberfläche im Browser (http://127.0.0.1:8765).

Benötigt: Python 3.9+, ffmpeg/ffprobe im PATH, für die Transkription: pip install faster-whisper
"""
from __future__ import annotations

import importlib.util
import json
import mimetypes
import os
import platform
import re
import shutil
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
os.environ.setdefault("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1")
import warnings  # noqa: E402
warnings.filterwarnings("ignore", module="huggingface_hub")

APP_DIR = Path(__file__).resolve().parent
FROZEN = bool(getattr(sys, "frozen", False))          # als installierte .exe gebaut
RES_DIR = Path(getattr(sys, "_MEIPASS", APP_DIR))      # mitgelieferte Dateien (Oberfläche, ffmpeg, Modelle)
if FROZEN:
    DATA_DIR = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "Textschnitt"
else:
    DATA_DIR = APP_DIR
DATA_DIR.mkdir(parents=True, exist_ok=True)
PORT = int(os.environ.get("TEXTSCHNITT_PORT", "8765"))
_bundled = RES_DIR / "ffmpeg"
_exe = ".exe" if os.name == "nt" else ""
FFMPEG = os.environ.get("FFMPEG") or (str(_bundled / f"ffmpeg{_exe}") if (_bundled / f"ffmpeg{_exe}").exists() else "ffmpeg")
FFPROBE = os.environ.get("FFPROBE") or (str(_bundled / f"ffprobe{_exe}") if (_bundled / f"ffprobe{_exe}").exists() else "ffprobe")
MODELS_DIR = RES_DIR / "models"   # mitgelieferte Whisper-Modelle (Ordnername = Modellname)

PAUSE_MIN = 0.45        # Lücken ab dieser Länge werden als eigene Pause im Text angezeigt
PARA_GAP = 1.2          # neue Absätze nach so langen Pausen
PARA_MAX_WORDS = 55     # oder wenn ein Absatz zu lang wird (am Satzende)

# Unter Windows keine Konsolenfenster für ffmpeg/ffprobe aufblitzen lassen
NOWIN = {"creationflags": 0x08000000} if os.name == "nt" else {}
APP_HOOKS: dict = {}   # von der Desktop-App gesetzt (Dateidialog, Fenster nach vorn)

STATE: dict = {"source": None, "info": None, "project_path": None, "preview": None}
JOBS: dict[str, dict] = {}
CREATED_FILES: set[str] = set()


# ───────────────────────────── Hilfsfunktionen ─────────────────────────────

def probe(path: Path) -> dict:
    res = subprocess.run(
        [FFPROBE, "-v", "error", "-print_format", "json", "-show_streams", "-show_format", str(path)],
        capture_output=True, text=True, encoding="utf-8", errors="replace", **NOWIN)
    if res.returncode:
        raise RuntimeError(res.stderr.strip() or "ffprobe konnte die Datei nicht lesen.")
    d = json.loads(res.stdout)
    streams = d.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video"
              and not s.get("disposition", {}).get("attached_pic")), None)
    a = next((s for s in streams if s.get("codec_type") == "audio"), None)
    fmt = d.get("format", {})
    duration = float(fmt.get("duration") or 0)
    fps, w, h = 30.0, 0, 0
    if v:
        rate = v.get("avg_frame_rate") or v.get("r_frame_rate") or "30/1"
        try:
            n, dd = rate.split("/")
            fps = float(n) / float(dd) if float(dd) else 30.0
        except ValueError:
            fps = 30.0
        if not fps or fps > 240:
            fps = 30.0
        w, h = int(v.get("width", 0)), int(v.get("height", 0))
        rot = 0
        for sd in v.get("side_data_list", []) or []:
            if "rotation" in sd:
                rot = int(float(sd["rotation"]))
        rot = rot or int(float(v.get("tags", {}).get("rotate", 0) or 0))
        if abs(rot) % 180 == 90:
            w, h = h, w
    return {
        "duration": duration,
        "start_time": float(fmt.get("start_time") or 0),
        "has_video": v is not None,
        "has_audio": a is not None,
        "width": w, "height": h, "fps": round(fps, 3),
        "vcodec": v.get("codec_name") if v else None,
        "acodec": a.get("codec_name") if a else None,
    }


def ffmpeg_major() -> int:
    try:
        out = subprocess.run([FFMPEG, "-version"], capture_output=True, text=True, **NOWIN).stdout
        m = re.search(r"ffmpeg version n?(\d+)\.", out)
        if m:
            return int(m.group(1))
        return 99  # Git-/Nightly-Builds sind aktuell
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
    for c in cands:
        if c.is_dir():
            return c
    return None


def safe_name(s: str) -> str:
    return re.sub(r"[^\w\-. äöüÄÖÜß]", "_", s).strip() or "projekt"


def fmt_ts(t: float, sep: str = ",") -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


# ───────────────────────────── Projekt ─────────────────────────────

def load_project() -> dict | None:
    pp = STATE.get("project_path")
    if pp and Path(pp).exists():
        try:
            return json.loads(Path(pp).read_text(encoding="utf-8"))
        except Exception:
            return None
    return None


def save_project(proj: dict) -> None:
    pp = Path(STATE["project_path"])
    tmp = pp.with_suffix(".tmp")
    tmp.write_text(json.dumps(proj, ensure_ascii=False), encoding="utf-8")
    tmp.replace(pp)


def build_tokens(words: list[dict], duration: float) -> list[dict]:
    """Wörter + Pausen zu einer lückenlosen Zeitleiste verbinden.
    Jedes Token hat eine Region [s, e]; alle Regionen zusammen decken das ganze Video ab."""
    tokens: list[dict] = []
    cursor = 0.0
    para = 0
    para_words = 0
    prev_seg = None
    for w in words:
        ws = max(float(w["start"]), cursor)
        we = max(float(w["end"]), ws + 0.02)
        gap = ws - cursor
        new_para = False
        if tokens and w.get("seg") != prev_seg:
            last_word = next((t for t in reversed(tokens) if t["type"] == "word"), None)
            ends_sentence = bool(last_word and re.search(r"[.?!…]$", last_word["text"]))
            if gap >= PARA_GAP or (para_words >= PARA_MAX_WORDS and ends_sentence):
                new_para = True
        if gap >= PAUSE_MIN:
            tokens.append({"type": "pause", "text": "", "s": round(cursor, 3), "e": round(ws, 3),
                           "p": para})
            region_start = ws
        elif tokens:
            tokens[-1]["e"] = round(ws, 3)   # kurze Lücke gehört zum vorigen Token
            region_start = ws
        else:
            region_start = 0.0               # kurzer Vorlauf gehört zum ersten Wort
        if new_para:
            para += 1
            para_words = 0
        tokens.append({"type": "word", "text": w["text"].strip(), "s": round(region_start, 3),
                       "e": round(we, 3), "ws": round(ws, 3), "we": round(we, 3),
                       "pr": round(float(w.get("prob", 1.0)), 2), "p": para})
        para_words += 1
        cursor = we
        prev_seg = w.get("seg")
    if duration > cursor:
        if duration - cursor >= PAUSE_MIN or not tokens:
            tokens.append({"type": "pause", "text": "", "s": round(cursor, 3), "e": round(duration, 3),
                           "p": para})
        else:
            tokens[-1]["e"] = round(duration, 3)
    for i, t in enumerate(tokens):
        t["i"] = i
    return tokens


# ───────────────────────────── Jobs ─────────────────────────────

def new_job(kind: str) -> dict:
    jid = uuid.uuid4().hex[:10]
    job = {"id": jid, "kind": kind, "status": "running", "progress": 0.0, "message": "", "result": None,
           "error": None, "cancel": False, "started": time.time()}
    JOBS[jid] = job
    return job


LOG_PATH = DATA_DIR / "textschnitt.log"
_log_lock = threading.Lock()


def log(msg: str) -> None:
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')}  {msg}"
    print(line, flush=True)
    try:
        with _log_lock, open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def run_job(job: dict, fn, *args):
    def target():
        log(f"Job {job['kind']} gestartet {args!r}")
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


MODEL_SIZES = {  # ungefähre Downloadgröße in Bytes
    "large-v3-turbo": 1.62e9, "large-v3": 3.09e9, "medium": 1.53e9, "small": 4.84e8,
}


def hf_cache_dir() -> Path:
    if os.environ.get("HF_HUB_CACHE"):
        return Path(os.environ["HF_HUB_CACHE"])
    if os.environ.get("HF_HOME"):
        return Path(os.environ["HF_HOME"]) / "hub"
    return Path.home() / ".cache" / "huggingface" / "hub"


def watch_download(job: dict, model_name: str, stop: threading.Event, phase: dict | None = None):
    """Zeigt den Fortschritt des Modell-Downloads anhand der Ordnergröße im Cache."""
    total = MODEL_SIZES.get(model_name)
    if not total:
        return
    key = model_name.replace("/", "--").lower()
    start = time.time()
    while not stop.wait(1.0):
        size = 0
        try:
            for d in hf_cache_dir().glob("models--*"):
                if d.name.lower().endswith(key):
                    size += sum(f.stat().st_size for f in d.rglob("*") if f.is_file() and not f.is_symlink())
        except OSError:
            continue
        if size < 5e6 and time.time() - start < 5:
            continue
        if size >= total * 0.98:
            return
        if size > 0 and phase is not None:
            phase["text"] = (f"Lade Modell „{model_name}“ herunter (nur beim ersten Mal): "
                              f"{size / 1e9:.2f} von ca. {total / 1e9:.1f} GB")


FILLER_PROMPT = {
    "de": "Ähm, also, äh, ich mein, hm, ja. Ähm, äh.",
    "en": "Um, uh, so, like, you know, hmm. Uh, um.",
}


def read_wav16k(path: Path):
    """Liest ein 16-kHz-Mono-WAV (pcm_s16le) als float32-Array ein."""
    import wave
    import numpy as np  # wird mit faster-whisper installiert
    with wave.open(str(path), "rb") as w:
        if w.getsampwidth() != 2 or w.getnchannels() != 1 or w.getframerate() != 16000:
            raise RuntimeError("Unerwartetes Tonformat bei der Vorbereitung.")
        raw = w.readframes(w.getnframes())
    return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0


def bundled_models() -> list[str]:
    try:
        return sorted(d.name for d in MODELS_DIR.iterdir() if (d / "model.bin").exists())
    except OSError:
        return []


def model_ref(name: str) -> str:
    """Mitgeliefertes Modell bevorzugen, sonst Name (wird beim ersten Mal heruntergeladen)."""
    local = MODELS_DIR / name
    return str(local) if (local / "model.bin").exists() else name


def pick_device() -> tuple[str, str]:
    try:
        import ctranslate2  # type: ignore
        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", "float16"
    except Exception as e:  # noqa: BLE001
        log(f"CUDA-Prüfung: {e!r}")
    return "cpu", "int8"


def transcribe_job(job: dict, model_name: str, language: str | None, fillers: bool):
    import faster_whisper  # type: ignore
    from faster_whisper import WhisperModel  # type: ignore

    src = STATE["source"]
    duration = STATE["info"]["duration"] or 1
    t0 = time.time()
    phase = {"text": "Vorbereiten"}

    def heartbeat():  # zeigt, dass noch gerechnet wird
        while job["status"] == "running" and not job["cancel"]:
            el = int(time.time() - t0)
            base = phase["text"]
            job["message"] = f"{base} · läuft seit {el // 60}:{el % 60:02d}"
            time.sleep(1)
    threading.Thread(target=heartbeat, daemon=True).start()

    log(f"faster-whisper {getattr(faster_whisper, '__version__', '?')}, Python {sys.version.split()[0]}, "
        f"{platform.platform()}, {platform.machine()}, CPUs {os.cpu_count()}")

    # 1) Ton als 16-kHz-Mono-WAV vorbereiten (schneller und robuster als direkt aus dem Video)
    phase["text"] = "Ton wird vorbereitet"
    wav = Path(STATE["project_path"]).with_suffix(".tmp.wav")
    run_ffmpeg(["-i", str(src), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)],
               duration, job, 0.0, 0.05)
    log(f"Ton vorbereitet nach {time.time() - t0:.0f} s")

    # 2) Modell laden
    device, ctype = pick_device()
    phase["text"] = f"Modell „{model_name}“ wird geladen ({'Grafikkarte' if device == 'cuda' else 'Prozessor'})"
    stop = threading.Event()
    threading.Thread(target=watch_download, args=(job, model_name, stop, phase), daemon=True).start()
    try:
        try:
            model = WhisperModel(model_ref(model_name), device=device, compute_type=ctype,
                                 cpu_threads=max(1, (os.cpu_count() or 4)))
        except Exception as e:  # noqa: BLE001
            log(f"Laden mit {device}/{ctype} fehlgeschlagen: {e!r} – versuche CPU")
            device, ctype = "cpu", "int8"
            model = WhisperModel(model_ref(model_name), device="cpu", compute_type="int8")
    finally:
        stop.set()
    log(f"Modell geladen ({device}/{ctype}) nach {time.time() - t0:.0f} s")
    if job["cancel"]:
        raise RuntimeError("Abgebrochen")

    # 3) Transkribieren
    job["progress"] = 0.05
    phase["text"] = "Transkription startet (die erste Minute dauert am längsten)"
    prompt = FILLER_PROMPT.get(language or "de") if fillers else None
    kwargs = dict(language=language or None, word_timestamps=True, initial_prompt=prompt,
                  beam_size=5 if device == "cuda" else 2)
    try:
        audio = read_wav16k(wav)  # eigenes Einlesen, damit PyAV-Versionskonflikte keine Rolle spielen
        log(f"Ton eingelesen: {len(audio) / 16000:.0f} s")
        segments, info = model.transcribe(audio, condition_on_previous_text=False, vad_filter=False, **kwargs)
        words = []
        t_tr = time.time()
        for si, seg in enumerate(segments):
            if job["cancel"]:
                raise RuntimeError("Abgebrochen")
            for w in seg.words or []:
                if w.word.strip():
                    words.append({"text": w.word, "start": w.start, "end": w.end,
                                  "prob": w.probability, "seg": si})
            frac = min(1.0, seg.end / duration)
            job["progress"] = 0.05 + 0.94 * frac
            el = time.time() - t_tr
            rest = ""
            if frac > 0.02:
                r = int(el / frac - el)
                rest = f" · noch ca. {r // 60}:{r % 60:02d}"
            phase["text"] = f"Transkribiere {fmt_ts(seg.end)[:8]} von {fmt_ts(duration)[:8]}{rest}"
            if si % 20 == 0:
                log(f"  bei {seg.end:.0f}/{duration:.0f} s nach {el:.0f} s")
    finally:
        wav.unlink(missing_ok=True)
    tokens = build_tokens(words, STATE["info"]["duration"])
    proj = {
        "version": 1, "source": str(src), "info": STATE["info"], "model": model_name,
        "language": language or getattr(info, "language", None), "tokens": tokens,
        "deleted": [], "trims": {}, "settings": {}, "created": time.time(),
    }
    save_project(proj)
    return {"words": len(words)}


def run_ffmpeg(args: list[str], total: float, job: dict, base: float = 0.0, span: float = 1.0,
               cwd: Path | None = None):
    cmd = [FFMPEG, "-hide_banner", "-y", "-nostats", "-progress", "pipe:1"] + args
    p = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                         encoding="utf-8", errors="replace", cwd=str(cwd) if cwd else None, **NOWIN)
    err: list[str] = []
    t = threading.Thread(target=lambda: err.extend(p.stderr.readlines()), daemon=True)
    t.start()
    for line in p.stdout:  # type: ignore[union-attr]
        if line.startswith("out_time_us=") or line.startswith("out_time_ms="):
            val = line.split("=", 1)[1].strip()
            if val.isdigit() and total > 0:
                job["progress"] = base + span * min(1.0, int(val) / 1e6 / total)
        if job["cancel"]:
            p.terminate()
    p.wait()
    t.join(timeout=2)
    if job["cancel"]:
        raise RuntimeError("Abgebrochen")
    if p.returncode:
        tail = "".join(err[-12:])
        log(f"ffmpeg-Fehler bei: {' '.join(cmd)}\n{''.join(err[-30:])}")
        raise RuntimeError(f"ffmpeg-Fehler:\n{tail}")
    return "".join(err)


def filter_graph(ranges, video: bool, audio: bool, offset: float, fade: float = 0.008,
                 burn: str | None = None) -> str:
    parts, labels = [], []
    for i, (s, e) in enumerate(ranges):
        s0, e0 = s + offset, e + offset
        d = e - s
        if video:
            parts.append(f"[0:v:0]trim=start={s0:.4f}:end={e0:.4f},setpts=PTS-STARTPTS[v{i}]")
        if audio:
            f = min(fade, d / 4)
            parts.append(
                f"[0:a:0]atrim=start={s0:.4f}:end={e0:.4f},asetpts=PTS-STARTPTS,"
                f"afade=t=in:st=0:d={f:.4f},afade=t=out:st={max(0, d - f):.4f}:d={f:.4f}[a{i}]")
        labels.append((f"[v{i}]" if video else "") + (f"[a{i}]" if audio else ""))
    vlabel = "[cv]" if (video and burn) else "[outv]"
    tail = f"concat=n={len(ranges)}:v={int(video)}:a={int(audio)}"
    tail += (vlabel if video else "") + ("[outa]" if audio else "")
    parts.append("".join(labels) + tail)
    if video and burn:
        parts.append(f"[cv]subtitles=filename={burn}[outv]")
    return ";\n".join(parts) + "\n"


def render(job: dict, ranges, out: Path, video: bool, audio_codec_args: list[str], video_args: list[str],
           burn: Path | None = None):
    info = STATE["info"]
    graph = filter_graph(ranges, video, True, info.get("start_time", 0.0), burn=burn.name if burn else None)
    script = out.with_suffix(out.suffix + ".filter.txt")
    script.write_text(graph, encoding="utf-8")
    total = sum(e - s for s, e in ranges)
    maps = (["-map", "[outv]"] if video else []) + ["-map", "[outa]"]
    flag = ["-/filter_complex", str(script)] if ffmpeg_major() >= 7 else ["-filter_complex_script", str(script)]
    tail = maps + (video_args if video else ["-vn"]) + audio_codec_args + [str(out)]
    cwd = burn.parent if burn else None  # Untertiteldatei relativ ansprechen (Windows-Pfade im Filter vermeiden)
    try:
        try:
            run_ffmpeg(["-i", str(STATE["source"])] + flag + tail, total, job, cwd=cwd)
        except RuntimeError as e:
            if "Unrecognized option" in str(e) or "Option not found" in str(e):
                other = ["-filter_complex_script", str(script)] if flag[0].startswith("-/") \
                    else ["-/filter_complex", str(script)]
                run_ffmpeg(["-i", str(STATE["source"])] + other + tail, total, job, cwd=cwd)
            else:
                raise
    finally:
        script.unlink(missing_ok=True)


# ───────────────────────────── Exporte ─────────────────────────────

def keep_mapper(ranges):
    offs, acc = [], 0.0
    for s, e in ranges:
        offs.append(acc)
        acc += e - s

    def m(t: float):
        for (s, e), o in zip(ranges, offs):
            if s - 1e-6 <= t <= e + 1e-6:
                return o + (t - s)
        return None
    return m, acc


def clean_cues(raw) -> list[dict]:
    """Untertitel aus der Oberfläche (Zeiten bereits im geschnittenen Ergebnis)."""
    cues = []
    for c in raw or []:
        try:
            s, e, txt = float(c["start"]), float(c["end"]), str(c["text"]).strip()
        except (KeyError, TypeError, ValueError):
            continue
        if txt and e - s > 0.05:
            cues.append({"start": max(0.0, s), "end": e, "text": txt.replace("\r", "")})
    cues.sort(key=lambda c: c["start"])
    return cues


def write_srt(cues: list[dict], out: Path):
    lines = []
    for n, c in enumerate(cues, 1):
        lines += [str(n), f"{fmt_ts(c['start'])} --> {fmt_ts(c['end'])}", c["text"], ""]
    out.write_text("\n".join(lines), encoding="utf-8")


SUB_SIZES = {"klein": 0.045, "mittel": 0.058, "groß": 0.075}
SUB_POS = {"unten": (2, -0.78), "mitte": (5, 0.0), "oben": (8, 0.78)}
CAPCUT_SIZES = {"klein": 6.0, "mittel": 8.0, "groß": 11.0}


def hex_rgb(h: str) -> tuple[int, int, int]:
    h = (h or "#FFFFFF").lstrip("#")
    if len(h) != 6:
        h = "FFFFFF"
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def write_ass(cues: list[dict], style: dict, out: Path, w: int, h: int):
    w, h = w or 1920, h or 1080
    size = round(SUB_SIZES.get(style.get("size", "mittel"), 0.058) * min(w, h) * (1.25 if h > w else 1.0))
    align, _ = SUB_POS.get(style.get("pos", "unten"), (2, 0))
    r, g, b = hex_rgb(style.get("color", "#FFFFFF"))
    outline = max(1.0, size / 16) if style.get("outline", True) else 0
    margin_v = round(h * 0.07)

    def ts(t):
        cs = int(round(t * 100))
        hh, cs = divmod(cs, 360000)
        mm, cs = divmod(cs, 6000)
        ss, cs = divmod(cs, 100)
        return f"{hh}:{mm:02d}:{ss:02d}.{cs:02d}"
    lines = [
        "[Script Info]", "ScriptType: v4.00+", f"PlayResX: {w}", f"PlayResY: {h}", "WrapStyle: 2",
        "ScaledBorderAndShadow: yes", "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, "
        "Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, "
        "Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: Default,Arial,{size},&H00{b:02X}{g:02X}{r:02X},&H00FFFFFF,&H00000000,&H64000000,"
        f"-1,0,0,0,100,100,0,0,1,{outline:.1f},0,{align},{round(w * 0.06)},{round(w * 0.06)},{margin_v},1",
        "", "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    for c in cues:
        txt = c["text"].replace("{", "(").replace("}", ")").replace("\n", "\\N")
        lines.append(f"Dialogue: 0,{ts(c['start'])},{ts(c['end'])},Default,,0,0,0,,{txt}")
    out.write_text("\n".join(lines) + "\n", encoding="utf-8-sig")


def write_edl(ranges, out: Path, stem: str):
    src = Path(STATE["source"])
    fps_i = int(round(STATE["info"].get("fps") or 25))

    def tc(t):
        f = int(round(t * fps_i))
        hh, f = divmod(f, 3600 * fps_i)
        mm, f = divmod(f, 60 * fps_i)
        ss, ff = divmod(f, fps_i)
        return f"{hh:02d}:{mm:02d}:{ss:02d}:{ff:02d}"
    edl = [f"TITLE: {stem}", "FCM: NON-DROP FRAME", ""]
    rec = 0.0
    for n, (s, e) in enumerate(ranges, 1):
        d = e - s
        edl += [f"{n:03d}  AX       AA/V  C        {tc(s)} {tc(e)} {tc(rec)} {tc(rec + d)}",
                f"* FROM CLIP NAME: {src.name}", ""]
        rec += d
    out.write_text("\n".join(edl), encoding="utf-8")


def concat_root() -> Path:
    """Der Concat-Projektordner auf dem Desktop (wird bei Bedarf angelegt)."""
    home = Path.home()
    cands = [home / "Desktop" / "Concat", home / "OneDrive" / "Desktop" / "Concat",
             home / "OneDrive" / "Schreibtisch" / "Concat", home / "Schreibtisch" / "Concat"]
    for c in cands:
        if c.is_dir():
            return c
    for d in (home / "Desktop", home / "OneDrive" / "Desktop", home / "Schreibtisch"):
        if d.is_dir():
            return d / "Concat"
    return home / "Concat"


def rate_fraction(fps: float) -> tuple[int, int]:
    if abs(fps - round(fps)) < 0.01:
        return int(round(fps)) or 30, 1
    return int(round(fps * 1.001)) * 1000, 1001  # z. B. 29.97 -> 30000/1001


CONCAT_SIZES = {"klein": 0.035, "mittel": 0.045, "groß": 0.06}
CONCAT_POS = {"unten": 0.38, "mitte": 0.0, "oben": -0.38}


def write_concat(ranges, name: str, cues: list[dict], style: dict) -> Path:
    """Concat-Projekt (concat.json) im Concat-Ordner auf dem Desktop.
    Spur 1 (unten): die behaltenen Abschnitte des Originals, Spur 2: Untertitel als Textclips."""
    info = STATE["info"]
    src = Path(STATE["source"]).resolve()
    root = concat_root()
    root.mkdir(parents=True, exist_ok=True)
    folder = root / safe_name(name)
    n = 2
    while (folder / "concat.json").exists():
        folder = root / f"{safe_name(name)} ({n})"
        n += 1
    folder.mkdir(parents=True, exist_ok=True)
    is_video = info["has_video"]
    num, den = rate_fraction(float(info.get("fps") or 30))
    w, h = (info["width"], info["height"]) if is_video else (1920, 1080)
    video = {"width": w, "height": h, "rateNum": num, "rateDen": den}
    media = [{
        "id": "m1", "path": str(src), "name": src.name, "duration": round(info["duration"], 6),
        "kind": "video" if is_video else "audio",
        "width": info["width"] if is_video else None, "height": info["height"] if is_video else None,
        "frameRate": info.get("fps") if is_video else None,
        "frameRateFraction": f"{num}/{den}" if is_video else None,
        "videoCodec": info.get("vcodec"), "audioCodec": info.get("acodec"), "hasAudio": True,
    }]
    clips = []
    cursor = 0.0
    for s, e in ranges:
        d = e - s
        if d <= 0.0005:
            continue
        clips.append({
            "id": f"c{len(clips) + 1}", "trackId": "T1", "kind": "video" if is_video else "audio",
            "mediaId": "m1", "name": src.name, "start": round(cursor, 6), "duration": round(d, 6),
            "sourceStart": round(s, 6), "speed": 1.0, "volume": 1.0, "preservePitch": True,
            "fadeIn": 0.0, "fadeOut": 0.0, "filters": [], "videoEffects": [],
            "offsetX": 0.0, "offsetY": 0.0, "opacity": 1.0, "rotation": 0.0, "scale": 1.0,
        })
        cursor += d
    if cues:
        outline = style.get("outline", True)
        for c in cues:
            d = min(c["end"], cursor) - c["start"]
            if d <= 0:
                continue
            clips.append({
                "id": f"c{len(clips) + 1}", "trackId": "T2", "kind": "text", "mediaId": "",
                "name": c["text"].split("\n")[0][:40], "start": round(c["start"], 6), "duration": round(d, 6),
                "speed": 1.0, "volume": 1.0, "fadeIn": 0.0, "fadeOut": 0.0, "filters": [], "videoEffects": [],
                "offsetX": 0.0, "offsetY": CONCAT_POS.get(style.get("pos", "unten"), 0.38), "opacity": 1.0,
                "rotation": 0.0, "scale": 1.0,
                "text": {
                    "content": c["text"], "fontSize": CONCAT_SIZES.get(style.get("size", "mittel"), 0.045),
                    "fontWeight": 700, "italic": False, "color": (style.get("color") or "#FFFFFF").lower(),
                    "align": "center", "opacity": 1.0,
                    "strokeWidth": 0.0045 if outline else 0.0, "strokeColor": "#000000",
                    "shadow": bool(outline), "background": "", "lineHeight": 1.2, "tracking": 0.0,
                    "maxWidth": 0.9, "maxHeight": 0.0,
                },
            })
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


def capcut_text(text: str, style: dict) -> tuple[dict, str]:
    r, g, b = hex_rgb(style.get("color", "#FFFFFF"))
    outline = style.get("outline", True)
    content = {"styles": [{
        "fill": {"alpha": 1.0, "content": {"render_type": "solid",
                                           "solid": {"alpha": 1.0, "color": [r / 255, g / 255, b / 255]}}},
        "range": [0, len(text.encode("utf-16-le")) // 2],
        "size": CAPCUT_SIZES.get(style.get("size", "mittel"), 8.0),
        "bold": False, "italic": False, "underline": False,
        "strokes": [{"content": {"solid": {"alpha": 1.0, "color": [0, 0, 0]}}, "width": 0.08}] if outline else [],
    }], "text": text}
    mid = uuid.uuid4().hex
    material = {
        "id": mid, "content": json.dumps(content, ensure_ascii=False), "typesetting": 0, "alignment": 1,
        "letter_spacing": 0.0, "line_spacing": 0.02, "line_feed": 1, "line_max_width": 0.82,
        "force_apply_line_max_width": False, "check_flag": 15 if outline else 7, "type": "text",
        "global_alpha": 1.0,
    }
    return material, mid


def write_capcut(ranges, root: Path, name: str, cues: list[dict] | None = None, style: dict | None = None) -> Path:
    """Erzeugt einen CapCut-Entwurf (draft_content.json / draft_info.json / draft_meta_info.json)."""
    info = STATE["info"]
    style = style or {}
    src = Path(STATE["source"]).resolve()
    folder = root / safe_name(name)
    n = 2
    while folder.exists():
        folder = root / f"{safe_name(name)} ({n})"
        n += 1
    folder.mkdir(parents=True)
    us = lambda t: int(round(t * 1_000_000))  # noqa: E731
    total_us = us(info["duration"])
    is_video = info["has_video"]
    mat_id = uuid.uuid4().hex
    materials = {k: [] for k in MATERIAL_KEYS}
    if is_video:
        materials["videos"].append({
            "audio_fade": None, "category_id": "", "category_name": "local", "check_flag": 63487,
            "crop": {"upper_left_x": 0.0, "upper_left_y": 0.0, "upper_right_x": 1.0, "upper_right_y": 0.0,
                     "lower_left_x": 0.0, "lower_left_y": 1.0, "lower_right_x": 1.0, "lower_right_y": 1.0},
            "crop_ratio": "free", "crop_scale": 1.0, "duration": total_us, "height": info["height"],
            "id": mat_id, "local_material_id": "", "material_id": mat_id, "material_name": src.name,
            "media_path": "", "path": str(src), "type": "video", "width": info["width"]})
    else:
        materials["audios"].append({
            "app_id": 0, "category_id": "", "category_name": "local", "check_flag": 1,
            "duration": total_us, "effect_id": "", "formula_id": "", "id": mat_id, "intensifies_path": "",
            "local_material_id": mat_id, "music_id": mat_id, "name": src.name, "path": str(src),
            "query": "", "request_id": "", "resource_id": "", "search_id": "", "source_platform": 0,
            "team_id": "", "text_id": "", "tone_category_id": "", "tone_category_name": "",
            "tone_effect_id": "", "tone_effect_name": "", "tone_speaker": "", "tone_type": "",
            "type": "extract_music", "video_id": "", "wave_points": []})
    visual = {
        "enable_adjust": True, "enable_color_correct_adjust": False, "enable_color_curves": True,
        "enable_color_match_adjust": False, "enable_color_wheels": True, "enable_lut": True,
        "enable_smart_color_adjust": False,
    }
    segments = []
    cursor = 0
    for s, e in ranges:
        a, b = us(s), us(e)
        d = b - a
        if d <= 0:
            continue
        speed_id = uuid.uuid4().hex
        materials["speeds"].append({"curve_speed": None, "id": speed_id, "mode": 0, "speed": 1.0,
                                    "type": "speed"})
        seg = {
            **(visual if is_video else {}),
            "last_nonzero_volume": 1.0, "reverse": False, "track_attribute": 0, "track_render_index": 0,
            "visible": True, "id": uuid.uuid4().hex, "material_id": mat_id,
            "target_timerange": {"start": cursor, "duration": d}, "common_keyframes": [], "keyframe_refs": [],
            "source_timerange": {"start": a, "duration": d}, "speed": 1.0, "volume": 1.0,
            "extra_material_refs": [speed_id], "is_tone_modify": False,
        }
        if is_video:
            seg.update({
                "clip": {"alpha": 1.0, "flip": {"horizontal": False, "vertical": False}, "rotation": 0.0,
                         "scale": {"x": 1.0, "y": 1.0}, "transform": {"x": 0.0, "y": 0.0}},
                "uniform_scale": {"on": True, "value": 1.0},
                "hdr_settings": {"intensity": 1.0, "mode": 1, "nits": 1000}, "render_index": 0,
            })
        else:
            seg.update({"clip": None, "uniform_scale": None, "hdr_settings": None, "render_index": 0})
        segments.append(seg)
        cursor += d
    tracks = [{"attribute": 0, "flag": 0, "id": uuid.uuid4().hex, "is_default_name": True, "name": "",
               "segments": segments, "type": "video" if is_video else "audio"}]
    # Untertitel als Textspur
    if cues:
        _, ty = SUB_POS.get(style.get("pos", "unten"), (2, -0.78))
        tsegs = []
        for c in cues:
            a = us(c["start"])
            d = min(us(c["end"]), cursor) - a
            if d <= 0:
                continue
            mat, mid = capcut_text(c["text"], style)
            materials["texts"].append(mat)
            tsegs.append({
                **visual, "last_nonzero_volume": 1.0, "reverse": False, "track_attribute": 0,
                "track_render_index": 0, "visible": True, "id": uuid.uuid4().hex, "material_id": mid,
                "target_timerange": {"start": a, "duration": d}, "common_keyframes": [], "keyframe_refs": [],
                "source_timerange": None, "speed": 1.0, "volume": 1.0, "extra_material_refs": [],
                "clip": {"alpha": 1.0, "flip": {"horizontal": False, "vertical": False}, "rotation": 0.0,
                         "scale": {"x": 1.0, "y": 1.0}, "transform": {"x": 0.0, "y": ty}},
                "uniform_scale": {"on": True, "value": 1.0}, "render_index": 15000,
            })
        tracks.append({"attribute": 0, "flag": 0, "id": uuid.uuid4().hex, "is_default_name": False,
                       "name": "Untertitel", "segments": tsegs, "type": "text"})
    now = int(time.time())
    w, h = (info["width"], info["height"]) if is_video else (1920, 1080)
    plat = {"app_id": 359289, "app_source": "cc", "app_version": "6.7.0",
            "os": {"Windows": "windows", "Darwin": "mac"}.get(platform.system(), "windows")}
    content = {
        "canvas_config": {"width": w, "height": h, "ratio": "original"},
        "color_space": 0, "config": {
            "adjust_max_index": 1, "attachment_info": [], "combination_max_index": 1, "export_range": None,
            "extract_audio_last_index": 1, "lyrics_recognition_id": "", "lyrics_sync": True,
            "lyrics_taskinfo": [], "maintrack_adsorb": True, "material_save_mode": 0,
            "multi_language_current": "none", "multi_language_list": [], "multi_language_main": "none",
            "multi_language_mode": "none", "original_sound_last_index": 1, "record_audio_last_index": 1,
            "sticker_max_index": 1, "subtitle_keywords_config": None, "subtitle_recognition_id": "",
            "subtitle_sync": True, "subtitle_taskinfo": [], "system_font_list": [], "use_float_render": False,
            "video_mute": False, "zoom_info_params": None},
        "cover": None, "create_time": 0, "duration": cursor, "extra_info": None,
        "fps": float(info.get("fps") or 30.0), "free_render_index_mode_on": False, "group_container": None,
        "id": _uid(), "is_drop_frame_timecode": False, "keyframe_graph_list": [],
        "keyframes": {k: [] for k in ["adjusts", "audios", "effects", "filters", "handwrites", "stickers",
                                       "texts", "videos"]},
        "last_modified_platform": plat, "lyrics_effects": [],
        "materials": materials, "mutable_config": None, "name": "", "new_version": "140.0.0", "path": "",
        "platform": plat, "relationships": [], "render_index_track_mode_on": False, "retouch_cover": None,
        "source": "default", "static_cover_image_path": "", "time_marks": None,
        "tracks": tracks, "update_time": 0, "version": 360000,
    }
    txt = json.dumps(content, ensure_ascii=False)
    (folder / "draft_content.json").write_text(txt, encoding="utf-8")
    (folder / "draft_info.json").write_text(txt, encoding="utf-8")  # macOS-Variante
    meta = {
        "draft_cover": "", "draft_fold_path": str(folder), "draft_id": _uid(),
        "draft_is_from_deeplink": "false", "draft_is_invisible": False,
        "draft_materials": [{"type": 0, "value": [{
            "create_time": now, "duration": total_us, "extra_info": src.name, "file_Path": str(src),
            "height": info["height"], "id": _uid(), "import_time": now, "import_time_ms": now * 1_000_000,
            "item_source": 1, "md5": "", "metetype": "video" if is_video else "music",
            "roughcut_time_range": {"duration": -1, "start": -1}, "sub_time_range": {"duration": -1, "start": -1},
            "type": 0, "width": info["width"]}]}] + [{"type": t, "value": []} for t in (1, 2, 3, 6, 7, 8)],
        "draft_materials_copied_info": [], "draft_name": folder.name, "draft_new_version": "",
        "draft_removable_storage_device": "", "draft_root_path": str(root), "draft_segment_extra_info": [],
        "draft_timeline_materials_size_": 0, "draft_type": "", "tm_draft_create": now * 1_000_000,
        "tm_draft_modified": now * 1_000_000, "tm_draft_removed": 0, "tm_duration": cursor,
    }
    (folder / "draft_meta_info.json").write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
    return folder


def export_job(job: dict, fmt: str, opts: dict, ranges):
    src = Path(STATE["source"])
    info = STATE["info"]
    stem = safe_name(opts.get("name") or f"{src.stem}_geschnitten")
    outdir = src.parent / f"{src.stem}_textschnitt"
    outdir.mkdir(exist_ok=True)
    files: list[Path] = []
    cues = clean_cues(opts.get("cues")) if opts.get("subs") else []
    style = opts.get("sub_style") or {}
    job["message"] = "Exportiere …"
    log(f"Export {fmt} nach {outdir} · {len(ranges)} Abschnitte · {len(cues)} Untertitel")
    if fmt == "video":
        if not info["has_video"]:
            raise RuntimeError("Die Quelle hat keine Videospur – bitte Audio exportieren.")
        crf = {"hoch": "16", "standard": "20", "klein": "24"}.get(opts.get("quality", "standard"), "20")
        out = outdir / f"{stem}.mp4"
        ass = None
        if cues and opts.get("burn"):
            ass = outdir / "_untertitel_temp.ass"
            write_ass(cues, style, ass, info["width"], info["height"])
        try:
            render(job, ranges, out, True, ["-c:a", "aac", "-b:a", "192k"],
                   ["-c:v", "libx264", "-crf", crf, "-preset", "medium", "-pix_fmt", "yuv420p",
                    "-movflags", "+faststart"], burn=ass)
        finally:
            if ass:
                ass.unlink(missing_ok=True)
        files.append(out)
    elif fmt == "audio":
        af = opts.get("audio_format", "wav")
        codec = {"wav": ["-c:a", "pcm_s16le"], "mp3": ["-c:a", "libmp3lame", "-b:a", "192k"],
                 "m4a": ["-c:a", "aac", "-b:a", "192k"], "flac": ["-c:a", "flac"]}[af]
        out = outdir / f"{stem}.{af}"
        render(job, ranges, out, False, codec, [])
        files.append(out)
    elif fmt == "capcut":
        root = capcut_drafts_dir() if opts.get("capcut_install") else None
        folder = write_capcut(ranges, root or outdir, stem, cues, style)
        files.append(folder)
        if root is None:
            zp = shutil.make_archive(str(outdir / f"{folder.name}_capcut"), "zip", folder.parent, folder.name)
            files.append(Path(zp))
    elif fmt == "concat":
        folder = write_concat(ranges, stem, cues, style)
        files.append(folder)
        outdir = folder
    else:
        raise RuntimeError(f"Unbekanntes Format: {fmt}")
    if cues and fmt not in ("concat",):
        srt = outdir / f"{stem}.srt"
        write_srt(cues, srt)
        files.append(srt)
    for f in files:
        CREATED_FILES.add(str(f.resolve()))
    _, total = keep_mapper(ranges)
    log(f"Export erstellt: {', '.join(str(f) for f in files)}")
    return {"files": [str(f) for f in files], "folder": str(outdir), "duration": total}


def proxy_job(job: dict):
    src = Path(STATE["source"])
    out = src.with_name(src.stem + ".textschnitt-vorschau.mp4")
    job["message"] = "Erstelle Vorschau-Datei …"
    run_ffmpeg(["-i", str(src), "-vf", "scale=-2:'min(720,ih)'", "-c:v", "libx264", "-preset", "veryfast",
                "-crf", "26", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
                str(out)], STATE["info"]["duration"], job)
    STATE["preview"] = out
    return {"preview": str(out)}


# ───────────────────────────── HTTP ─────────────────────────────

def state_payload() -> dict:
    src = STATE.get("source")
    return {
        "source": str(src) if src else None,
        "name": Path(src).name if src else None,
        "info": STATE.get("info"),
        "project": load_project() if src else None,
        "whisper": whisper_available(),
        "capcut_dir": str(capcut_drafts_dir() or "") or None,
        "concat_dir": str(concat_root()),
        "bundled_models": bundled_models(),
        "has_preview": bool(STATE.get("preview")),
        "media_version": int(time.time()),
    }


def open_source(path: str) -> dict:
    p = Path(path.strip().strip('"').strip("'")).expanduser()
    if not p.is_file():
        raise ValueError(f"Datei nicht gefunden: {p}")
    p = p.resolve()
    info = probe(p)
    if not info["has_audio"]:
        raise ValueError("Die Datei enthält keine Tonspur.")
    preview = p.with_name(p.stem + ".textschnitt-vorschau.mp4")
    STATE.update(source=p, info=info, project_path=p.with_name(p.stem + ".textschnitt.json"),
                 preview=preview if preview.exists() else None)
    return state_payload()


def pick_file() -> str | None:
    if APP_HOOKS.get("pick"):
        return APP_HOOKS["pick"]()
    """Öffnet einen nativen Dateidialog (eigener Prozess, damit es auf macOS/Windows zuverlässig klappt)."""
    code = ("import tkinter as tk\nfrom tkinter import filedialog\nr=tk.Tk();r.withdraw()\n"
            "r.attributes('-topmost',True)\n"
            "p=filedialog.askopenfilename(title='Video oder Audio wählen',filetypes=[('Medien',"
            "'*.mp4 *.mov *.mkv *.m4v *.webm *.avi *.mp3 *.wav *.m4a *.flac *.aac'),('Alle','*.*')])\n"
            "print(p)")
    if platform.system() == "Darwin":
        osa = subprocess.run(["osascript", "-e", 'POSIX path of (choose file with prompt "Video oder Audio wählen")'],
                             capture_output=True, text=True)
        if osa.returncode == 0 and osa.stdout.strip():
            return osa.stdout.strip()
    res = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    if res.returncode:
        raise RuntimeError("Kein Dateidialog verfügbar – bitte den Pfad ins Feld einfügen.")
    return res.stdout.strip() or None


def reveal(path: str):
    p = Path(path).resolve()
    allowed = str(p) in CREATED_FILES
    if STATE.get("source"):
        src = Path(STATE["source"])
        allowed = allowed or p == (src.parent / f"{src.stem}_textschnitt").resolve()
    if not allowed:
        raise ValueError("Pfad nicht freigegeben.")
    target = p if p.is_dir() else p.parent
    if platform.system() == "Windows":
        if p.is_file():
            subprocess.Popen(["explorer", "/select,", str(p)])
        else:
            os.startfile(str(target))  # type: ignore[attr-defined]
    elif platform.system() == "Darwin":
        subprocess.Popen(["open", "-R", str(p)] if p.exists() else ["open", str(target)])
    else:
        subprocess.Popen(["xdg-open", str(target)])


class Handler(BaseHTTPRequestHandler):
    server_version = "Textschnitt/1.0"

    def log_message(self, fmt, *args):  # ruhig bleiben
        pass

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        if not n:
            return {}
        return json.loads(self.rfile.read(n).decode("utf-8"))

    def _file(self, path: Path, ctype: str | None = None, download: bool = False):
        size = path.stat().st_size
        ctype = ctype or mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        rng = self.headers.get("Range")
        start, end = 0, size - 1
        code = 200
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
            self.end_headers()
            return
        length = end - start + 1
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        if code == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        if download:
            self.send_header("Content-Disposition", f'attachment; filename="{path.name}"')
        self.end_headers()
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
        except ConnectionError:
            pass

    def handle_one_request(self):
        try:
            super().handle_one_request()
        except ConnectionError:
            self.close_connection = True

    def do_GET(self):
        u = urlparse(self.path)
        q = parse_qs(u.query)
        try:
            if u.path in ("/", "/index.html"):
                self._file(RES_DIR / "index.html", "text/html; charset=utf-8")
            elif u.path == "/media":
                src = STATE.get("preview") or STATE.get("source")
                if not src:
                    return self._json({"error": "Keine Datei geöffnet"}, 404)
                self._file(Path(src))
            elif u.path == "/api/ping":
                self._json({"app": "textschnitt", "pid": os.getpid()})
            elif u.path == "/api/state":
                self._json(state_payload())
            elif u.path == "/api/job":
                job = JOBS.get(q.get("id", [""])[0])
                if not job:
                    return self._json({"error": "Unbekannter Job"}, 404)
                self._json({k: v for k, v in job.items() if k != "cancel"})
            elif u.path == "/download":
                p = Path(q.get("path", [""])[0]).resolve()
                if str(p) not in CREATED_FILES or not p.is_file():
                    return self._json({"error": "Nicht freigegeben"}, 403)
                self._file(p, download=True)
            else:
                self._json({"error": "Nicht gefunden"}, 404)
        except ConnectionError:
            pass
        except Exception as e:  # noqa: BLE001
            self._json({"error": str(e)}, 500)

    def do_POST(self):
        u = urlparse(self.path)
        try:
            data = self._body()
            if u.path == "/api/open":
                self._json(open_source(data.get("path", "")))
            elif u.path == "/api/focus":
                if data.get("path"):
                    open_source(data["path"])
                if APP_HOOKS.get("focus"):
                    APP_HOOKS["focus"](bool(data.get("path")))
                self._json({"ok": True})
            elif u.path == "/api/pick":
                p = pick_file()
                self._json(open_source(p) if p else {"cancelled": True})
            elif u.path == "/api/transcribe":
                if not STATE.get("source"):
                    raise ValueError("Keine Datei geöffnet.")
                if not whisper_available():
                    raise ValueError("faster-whisper ist nicht installiert: pip install faster-whisper")
                job = new_job("transcribe")
                run_job(job, transcribe_job, data.get("model", "large-v3-turbo"),
                        data.get("language") or None, bool(data.get("fillers", True)))
                self._json({"job": job["id"]})
            elif u.path == "/api/cancel":
                job = JOBS.get(data.get("id", ""))
                if job:
                    job["cancel"] = True
                self._json({"ok": True})
            elif u.path == "/api/save":
                proj = load_project()
                if not proj:
                    raise ValueError("Noch kein Transkript vorhanden.")
                proj["deleted"] = sorted(set(int(i) for i in data.get("deleted", [])))
                proj["trims"] = {str(k): float(v) for k, v in (data.get("trims") or {}).items()}
                proj["settings"] = data.get("settings") or {}
                if "cues" in data:
                    proj["cues"] = data.get("cues") or []
                if "sub_style" in data:
                    proj["sub_style"] = data.get("sub_style") or {}
                save_project(proj)
                self._json({"ok": True})
            elif u.path == "/api/export":
                ranges = [(float(s), float(e)) for s, e in data.get("ranges", []) if float(e) - float(s) > 0.02]
                if not ranges:
                    raise ValueError("Nach dem Schnitt bleibt nichts übrig.")
                job = new_job("export")
                run_job(job, export_job, data.get("format", "video"), data, ranges)
                self._json({"job": job["id"]})
            elif u.path == "/api/proxy":
                job = new_job("proxy")
                run_job(job, proxy_job)
                self._json({"job": job["id"]})
            elif u.path == "/api/reveal":
                reveal(data.get("path", ""))
                self._json({"ok": True})
            else:
                self._json({"error": "Nicht gefunden"}, 404)
        except Exception as e:  # noqa: BLE001
            self._json({"error": str(e)}, 400)


def make_server(port: int) -> ThreadingHTTPServer:
    ThreadingHTTPServer.daemon_threads = True
    return ThreadingHTTPServer(("127.0.0.1", port), Handler)


def main():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    if not shutil.which(FFMPEG) or not shutil.which(FFPROBE):
        print("⚠  ffmpeg/ffprobe nicht gefunden. Bitte installieren und in den PATH aufnehmen.")
    if len(sys.argv) > 1:
        try:
            open_source(sys.argv[1])
            print(f"Geöffnet: {STATE['source']}")
        except Exception as e:  # noqa: BLE001
            print(f"Konnte {sys.argv[1]} nicht öffnen: {e}")
    srv = make_server(PORT)
    url = f"http://127.0.0.1:{PORT}"
    print(f"Textschnitt läuft auf {url}  (Beenden mit Strg+C)")
    log(f"Start – Python {sys.version.split()[0]}, {platform.platform()}, faster-whisper "
        f"{'ja' if whisper_available() else 'nein'}")
    if not os.environ.get("TEXTSCHNITT_NO_BROWSER"):
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nBeendet.")


if __name__ == "__main__":
    main()
