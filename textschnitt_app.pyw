# Startet Textschnitt als Desktop-App ohne Konsolenfenster (pythonw).
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from textschnitt_app import main  # noqa: E402

main()
