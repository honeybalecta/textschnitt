#!/bin/bash
# Erzeugt Testton mit Neuansätzen (wie in echten Aufnahmen) und merkt sich, wann welcher Satz gesprochen wird.
set -e
OUT=${1:-testaudio}; mkdir -p "$OUT"
i=0; parts=(); win="["
t=0.8   # Stille am Anfang
say(){ # Satz, Pause danach
  i=$((i+1)); f="$OUT/p$i.wav"
  espeak-ng -v de -s 140 -w "$f" "$1"
  d=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")
  e=$(python3 -c "print(round($t+$d,3))")
  [ "$win" != "[" ] && win="$win,"
  win="$win{\"text\":$(python3 -c "import json;print(json.dumps('$1'))"),\"s\":$t,\"e\":$e}"
  parts+=("$f" "$2"); t=$(python3 -c "print(round($e+$2,3))")
}
say "Dieser Typ hier ist Jochen Kopelke, der Vorsitzende." 0.5
say "Dieser Typ hier ist Jochen Kopelke, der Vorsitzende der Gewerkschaft der Polizei." 0.9
say "Ich wollte" 0.35
say "Ich wollte heute über die Tarifverhandlungen sprechen." 0.7
say "Das ist ein Muster, das sich an mehreren Stellen wiederholt." 0.6
say "Am Ende" 0.3
say "Am Ende bleibt nur der letzte Versuch stehen." 1.0
echo "$win]" > "$OUT/windows.json"
# zusammensetzen: 0,8 s Stille, dann Sätze mit Pausen, 16 kHz mono
args=(-f lavfi -t 0.8 -i anullsrc=r=16000:cl=mono); n=1; filter="[0:a]"
for ((k=0;k<${#parts[@]};k+=2)); do
  args+=(-i "${parts[k]}" -f lavfi -t "${parts[k+1]}" -i anullsrc=r=16000:cl=mono)
  filter="$filter[$n:a][$((n+1)):a]"; n=$((n+2))
done
ffmpeg -v error -y "${args[@]}" -filter_complex "${filter}concat=n=$n:v=0:a=1,aformat=sample_rates=16000:channel_layouts=mono[a]" -map "[a]" -c:a pcm_s16le "$OUT/test16k.wav"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT/test16k.wav"
cat "$OUT/windows.json"
