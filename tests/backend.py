"""Test-Backend für die Prüfläufe: das echte textschnitt.py mit drei Unterschieden –
   – die Transkription liefert eine vorbereitete Wortliste (<video>.words.json), damit kein Whisper-Modell nötig ist;
     Ton-Vorbereitung und Lautstärkeverlauf laufen echt über ffmpeg,
   – Dateidialoge lesen ihre Antwort aus pick.json im Arbeitsordner ({"videos": […], "clip": […], "save_any": […], …}),
   – nichts verlässt den Rechner: „im Browser öffnen“ und die Abfrage bei GitHub landen in Dateien im Arbeitsordner
     (geoeffnet.txt, github.json, github-abfragen.txt).

Umgebung: HC_WORK (Arbeitsordner, sonst tests/.work), HC_REPO (Ordner mit textschnitt.py, sonst das Projekt selbst –
für den Vergleich mit einer früheren Fassung zeigt HC_REPO auf deren Arbeitskopie), TEXTSCHNITT_DATA, TEXTSCHNITT_PORT."""
import json
import os
import sys
import tempfile
import time
import uuid
import webbrowser
from pathlib import Path

HERE = Path(__file__).resolve().parent
WORK = Path(os.environ.get("HC_WORK") or HERE / ".work")
REPO = Path(os.environ.get("HC_REPO") or HERE.parent)
WORK.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("TEXTSCHNITT_DATA", str(WORK / "data"))
os.environ.setdefault("TEXTSCHNITT_PORT", "8795")
os.environ.setdefault("TEXTSCHNITT_NO_BROWSER", "1")
os.environ.setdefault("HONEYCUT_UPDATE_API", "test://releases")   # schaltet die Versionsprüfung auch außerhalb der Windows-App ein
sys.path.insert(0, str(REPO))
import textschnitt as T  # noqa: E402

T.TOKEN = "test"
PICK = WORK / "pick.json"


def pick(kind):
    try:
        d = json.loads(PICK.read_text(encoding="utf-8"))
    except Exception:
        return []
    v = d.get(kind) or d.get("*") or []
    return v if isinstance(v, list) else [v]


def note(x):
    with open(WORK / "geoeffnet.txt", "a", encoding="utf-8") as f:
        f.write(str(x) + "\n")
    return True


def fake_http_get(url, timeout=8.0):
    """Nachgestelltes GitHub: github.json = {"releases": [...], "notes": "…", "fail": false}"""
    with open(WORK / "github-abfragen.txt", "a", encoding="utf-8") as f:
        f.write(url + "\n")
    st = json.loads((WORK / "github.json").read_text(encoding="utf-8"))
    if st.get("fail"):
        raise OSError("GitHub ist nicht erreichbar (Test)")
    return (json.dumps(st["releases"]) if "releases" in url else st["notes"]).encode("utf-8")


def fake_transcribe(job, path, model_name, language, fillers, ranges=None):
    path = T.norm_path(path)
    info = T.probe(path)
    job["message"] = "Ton wird vorbereitet"
    wav = Path(tempfile.gettempdir()) / f"textschnitt_{uuid.uuid4().hex[:8]}.wav"
    try:
        T.run_ffmpeg(["-i", path, "-vn", "-af", "aresample=async=1:first_pts=0", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(wav)], info["duration"] or 1, job, 0.0, 0.3)
        audio = T.read_wav16k(wav)
    finally:
        wav.unlink(missing_ok=True)
    env = T.envelope(audio)
    if ranges is not None:
        return {"ranges": [{"words": []} for _ in ranges]}
    wf = Path(path).with_suffix(".words.json")
    words = json.loads(wf.read_text(encoding="utf-8")) if wf.exists() else []
    for k in range(5):
        if job["cancel"]:
            raise RuntimeError("Abgebrochen")
        job["progress"] = 0.3 + 0.14 * k
        job["message"] = f"Transkribiere (Test) {k + 1}/5"
        time.sleep(0.15)
    return {"words": words, "lang": language or "de", "env": env, "padded": True}


T.APP_HOOKS["pick"] = pick
T.APP_HOOKS["save_any"] = lambda name: (pick("save_any") or [None])[0]
T.APP_HOOKS["save"] = lambda name: (pick("save") or [None])[0]
webbrowser.open = lambda url, *a, **k: note(url)
T.open_data_dir = lambda: note("DATENORDNER")
T._http_get = fake_http_get
T.whisper_available = lambda: True
T.models_list = lambda: [{"name": "small", "label": "small – schnell", "sizeMb": 480, "installed": True, "bundled": True, "recommended": True}]
T.transcribe_job = fake_transcribe

if __name__ == "__main__":
    T.main()
