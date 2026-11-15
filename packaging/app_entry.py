# Einstieg für den gebauten Installer
import sys

if len(sys.argv) > 2 and sys.argv[1] == "--diag":   # nur auf dem Testzweig: ein Prüfskript in der gebauten App ausführen
    import runpy
    import traceback
    from pathlib import Path
    sys.argv = sys.argv[2:]
    try:
        runpy.run_path(sys.argv[0], run_name="__main__")
    except BaseException:  # noqa: BLE001
        Path("diag_fehler.txt").write_text(traceback.format_exc(), encoding="utf-8")
        sys.exit(1)
    sys.exit(0)

from textschnitt_app import main

main()
