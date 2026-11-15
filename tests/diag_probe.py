"""Diagnose (nur Testzweig): die Schriftprobe des Selbsttests in der gebauten App ausführen und das Ergebnis ablegen."""
import json
import os
import sys
import traceback
from pathlib import Path

out = Path(os.environ.get("DIAG_OUT") or "diag4")
out.mkdir(exist_ok=True)
try:
    import textschnitt as T
    rep = {"version": T.VERSION, "frozen": bool(getattr(sys, "frozen", False)), "ffmpeg": T.FFMPEG, "probe": T.font_selftest()}
    std = T.standard_face()
    rep["standard"] = None if std is None else {"family": std.family, "ps": std.ps, "cell": std.cell, "css": std.css}
except Exception:  # noqa: BLE001
    rep = {"error": traceback.format_exc()}
(out / "probe.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
