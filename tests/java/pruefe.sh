#!/bin/bash
# Übersetzt die Tonklassen der Android-App (reines Java) mit Nachbauten der Media3-Schnittstellen und rechnet sie durch.
# Ohne javac wird der Lauf ausgelassen.
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(dirname "$(dirname "$HERE")")"
OUT="${HC_WORK:-$(dirname "$HERE")/.work}/java"
if ! command -v javac > /dev/null 2>&1; then echo "ERGEBNIS Android-Tonklassen: ausgelassen (kein javac)"; exit 0; fi
rm -rf "$OUT"; mkdir -p "$OUT"
SRC="$REPO/android/app/src/main/java/de/honeybalecta/textschnitt"
unset JAVA_TOOL_OPTIONS
javac -nowarn -encoding UTF-8 -d "$OUT" $(find "$HERE/stubs" -name '*.java') $(ls "$SRC"/*.java) "$HERE"/*.java 2>&1 || { echo "FEHLER Die Tonklassen lassen sich nicht übersetzen"; echo "ERGEBNIS Android-Tonklassen: 1 geprüft, 1 Fehler"; exit 1; }
java -Dfile.encoding=UTF-8 -Dstdout.encoding=UTF-8 -cp "$OUT" TonTest "$@"
