#!/bin/bash
# Prüfläufe für HoneyCut (Desktop-Fassung): bereitet Testmedien und Testprojekte vor und fährt alle Prüfungen.
#   tests/lauf.sh                        alles
#   tests/lauf.sh p_stand.mjs edit       nur eine Prüfung (Backend und Testprojekte werden bei Bedarf vorbereitet)
#   HC_BASIS=v2.25.0 tests/lauf.sh       zusätzlich der Vergleich mit einer früheren Fassung (Git-Angabe):
#                                        Exportplan, Bedienung und echte Exporte sollen gleich bleiben
# Braucht python3 mit numpy, ffmpeg, Google Chrome und einmal „npm install“ in tests/ (Playwright). Siehe tests/README.md.
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"; REPO="$(dirname "$HERE")"
export HC_WORK="${HC_WORK:-$HERE/.work}"
OUT="$HC_WORK/out"; LOG="$OUT/lauf.log"; BER="$OUT/bericht.md"
PORT=8795; BPORT=8796
mkdir -p "$OUT"; : > "$LOG"; : > "$OUT/zeilen.txt"
PIDS=()
stop() { for p in "${PIDS[@]:-}"; do [ -n "$p" ] && kill "$p" 2>/dev/null; done; }
trap stop EXIT

backend() {   # backend <Ordner mit textschnitt.py> <Datenordner> <Port>
  local pidf="$HC_WORK/backend-$3.pid"
  if [ -f "$pidf" ] && grep -qs backend.py "/proc/$(cat "$pidf")/cmdline" 2>/dev/null; then kill "$(cat "$pidf")" 2>/dev/null; sleep 0.5; fi   # Rest eines früheren Laufs
  if curl -s -o /dev/null "http://127.0.0.1:$3/api/ping"; then echo "Port $3 ist belegt – läuft dort schon ein HoneyCut-Testbackend?"; return 1; fi
  ( cd "$HERE" && HC_REPO="$1" TEXTSCHNITT_DATA="$2" TEXTSCHNITT_PORT="$3" exec python3 backend.py > "$OUT/backend-$3.log" 2>&1 ) &
  PIDS+=($!); echo $! > "$pidf"
  for _ in $(seq 1 100); do curl -s -o /dev/null "http://127.0.0.1:$3/api/ping" && return 0; sleep 0.2; done
  echo "Das Backend auf Port $3 startet nicht:"; tail -20 "$OUT/backend-$3.log"; return 1
}

FAILS=0; WARN=0
lauf() {   # lauf <hart|weich> <Programm> <Datei> [Angaben …]
  local art="$1"; shift
  local name="${*:2}" tmp="$OUT/einzel.log"; name="${name#"$HERE"/}"
  echo "== $name" | tee -a "$LOG"
  rm -f "$HC_WORK/gpu.json"   # eine nachgestellte Grafikkarte aus einer abgebrochenen Prüfung soll die nächste nicht beeinflussen
  timeout 1200 "$@" > "$tmp" 2>&1; local rc=$?
  cat "$tmp" >> "$LOG"
  local erg ohne=0; erg="$(grep '^ERGEBNIS' "$tmp" | tail -1 | sed 's/^ERGEBNIS //')"
  [ -n "$erg" ] || { erg="$name: ohne Ergebnis abgebrochen (Code $rc)"; ohne=1; }
  grep -E '^(FEHLER|ABWEICHUNG)' "$tmp" | cut -c1-400 | head -12
  [ $ohne -eq 0 ] || { echo "   letzte Zeilen:"; tail -6 "$tmp" | cut -c1-300 | sed 's/^/     /'; }
  if [ $rc -eq 0 ]; then echo "- ✅ $erg" >> "$OUT/zeilen.txt"
  elif [ "$art" = hart ]; then FAILS=$((FAILS + 1)); echo "- ❌ $erg" >> "$OUT/zeilen.txt"; grep -E '^FEHLER' "$tmp" | cut -c1-300 | head -6 | sed 's/^/    - /' >> "$OUT/zeilen.txt"
    [ $ohne -eq 0 ] || tail -4 "$tmp" | cut -c1-300 | sed 's/^/    - /' >> "$OUT/zeilen.txt"
  else WARN=$((WARN + 1)); echo "- ⚠️ $erg" >> "$OUT/zeilen.txt"; grep -E '^ABWEICHUNG|^FEHLER' "$tmp" | cut -c1-300 | head -6 | sed 's/^/    - /' >> "$OUT/zeilen.txt"; fi
  echo "   → $erg"
}
bericht() {
  local v; v="$(grep -m1 '^VERSION' "$REPO/textschnitt.py" | cut -d'"' -f2)"
  { if [ $FAILS -eq 0 ]; then echo "### Prüfläufe HoneyCut $v: bestanden"; else echo "### Prüfläufe HoneyCut $v: $FAILS mit Fehlern"; fi
    [ $WARN -eq 0 ] || echo "Der Vergleich mit der früheren Fassung zeigt $WARN Abweichung(en). Bei einer gewollten Änderung ist das in Ordnung."
    echo; cat "$OUT/zeilen.txt"; } > "$BER"
  echo; cat "$BER"
}

# Ein einzelner Lauf: tests/lauf.sh <Datei> [Angaben]
EINZELN=("$@")

# 1) Backend ohne Browser; Rechenkern für den Ton in allen drei Fassungen (Python, JavaScript, Java)
if [ ${#EINZELN[@]} -eq 0 ]; then
  lauf hart python3 "$HERE/backend_test.py"
  lauf hart python3 "$HERE/rechenkern.py" "$HC_WORK/rechenkern"
fi

# 2) Testmedien, Backend, Testprojekte
python3 "$HERE/medien.py" "$HC_WORK/media" >> "$LOG" 2>&1 || { echo "Die Testmedien ließen sich nicht erzeugen (ffmpeg vorhanden?)"; tail -5 "$LOG"; exit 1; }
[ -f "$HC_WORK/github.json" ] || echo '{"releases": [], "notes": ""}' > "$HC_WORK/github.json"
backend "$REPO" "$HC_WORK/data" $PORT || exit 1
if [ ! -f "$HC_WORK/projects.json" ]; then
  echo "== Testprojekte anlegen" | tee -a "$LOG"
  node "$HERE/einrichten.mjs" >> "$LOG" 2>&1 || { echo "Die Testprojekte ließen sich nicht anlegen:"; tail -30 "$LOG"; exit 1; }
fi

if [ ${#EINZELN[@]} -gt 0 ]; then
  case "${EINZELN[0]}" in *.py) lauf hart python3 "$HERE/${EINZELN[0]}" "${EINZELN[@]:1}" ;; *) lauf hart node "$HERE/${EINZELN[0]}" "${EINZELN[@]:1}" ;; esac
  bericht; exit $((FAILS > 0))
fi

# 3) Prüfungen in der Oberfläche
lauf hart node "$HERE/p_umbenennen.mjs"
lauf hart node "$HERE/p_fassungen.mjs"
lauf hart node "$HERE/p_verwaltung.mjs"
lauf hart node "$HERE/p_paket.mjs"
lauf hart node "$HERE/p_helfer.mjs"
lauf hart node "$HERE/p_schutz.mjs"
lauf hart node "$HERE/p_quellen.mjs"
lauf hart node "$HERE/p_schnittleiste.mjs"
lauf hart node "$HERE/p_schrift.mjs"
lauf hart node "$HERE/p_transkript.mjs"
lauf hart node "$HERE/p_hausstil.mjs"
lauf hart node "$HERE/p_export.mjs"
lauf hart node "$HERE/p_untertitel.mjs"
lauf hart node "$HERE/p_clips.mjs"
lauf hart node "$HERE/p_ton.mjs"
lauf hart node "$HERE/p_belege.mjs"
lauf hart node "$HERE/p_bild.mjs"
lauf hart node "$HERE/p_uebergabe.mjs"
lauf hart node "$HERE/p_stimmen.mjs"
lauf hart node "$HERE/p_folgen.mjs"
lauf hart node "$HERE/p_skript.mjs"
lauf hart node "$HERE/p_mikrofon.mjs"
lauf hart node "$HERE/p_leisten.mjs"
lauf hart node "$HERE/p_titelbild.mjs"
lauf hart node "$HERE/p_browser.mjs"
for p in stress edit multi editWord; do lauf hart node "$HERE/p_stand.mjs" $p; done
for p in stress edit; do lauf hart node "$HERE/p_wiedergabe.mjs" $p; done

# 4) Vergleich mit einer früheren Fassung (nur wenn HC_BASIS eine gültige Git-Angabe ist)
REF="${HC_BASIS:-}"
if [ -n "$REF" ] && ! [[ "$REF" =~ ^0+$ ]] && git -C "$REPO" rev-parse -q --verify "$REF^{commit}" > /dev/null 2>&1; then
  rm -rf "$HC_WORK/basis" "$HC_WORK/data-basis"; mkdir -p "$HC_WORK/basis"
  git -C "$REPO" archive "$REF" textschnitt.py core | tar -x -C "$HC_WORK/basis"
  cp -r "$HC_WORK/data" "$HC_WORK/data-basis"
  if backend "$HC_WORK/basis" "$HC_WORK/data-basis" $BPORT; then
    export HC_BASIS_URL="http://127.0.0.1:$BPORT/test/index.html"
    echo "Vergleich mit $(git -C "$REPO" log -1 --format='%h %s' "$REF" | cut -c1-80)" | tee -a "$LOG"
    echo "- Vergleich mit \`$(git -C "$REPO" log -1 --format='%h' "$REF")\` ($(git -C "$REPO" log -1 --format='%s' "$REF" | cut -c1-60))" >> "$OUT/zeilen.txt"
    lauf weich node "$HERE/v_plan.mjs"
    for p in stress edit; do lauf weich node "$HERE/v_bedienung.mjs" $p; done
    lauf weich node "$HERE/v_export.mjs" stress:video kurz:capcut
  fi
else
  echo "- Vergleich mit einer früheren Fassung: nicht gefahren (HC_BASIS nicht gesetzt)" >> "$OUT/zeilen.txt"
fi
bericht
exit $((FAILS > 0))
