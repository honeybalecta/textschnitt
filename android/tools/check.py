#!/usr/bin/env python3
"""Vergleicht die Wortzeiten der Transkription mit den bekannten Satzfenstern. Aufruf: check.py windows.json out.json [bezeichnung]"""
import json, sys
win = json.load(open(sys.argv[1])); res = json.load(open(sys.argv[2])); label = sys.argv[3] if len(sys.argv) > 3 else ""
words = res.get("words", [])
lines = [f"**{label}** · {len(words)} Wörter · Verfahren: {res.get('timing')}"]
def win_of(t):
    for k, w in enumerate(win):
        if w["s"] - 0.3 <= t <= w["e"] + 0.3: return k
    return -1
order_ok, outside, late_start, overlap_err, prev = True, 0, 0, 0.0, -1
for w in words:
    mid = (w["start"] + w["end"]) / 2
    k = win_of(w["start"])
    if k < 0: outside += 1
    elif k < prev: order_ok = False
    prev = max(prev, k)
    # Anteil des Wortes außerhalb seines Fensters
    if k >= 0:
        a, b = win[k]["s"], win[k]["e"]
        overlap_err += max(0, a - w["start"]) + max(0, w["end"] - b)
# Satzanfänge: wie weit liegt das erste Wort je Satz vom echten Beginn entfernt?
starts = []
for wn in win:
    first = next((w for w in words if wn["s"] - 0.3 <= w["start"] <= wn["e"]), None)
    if first: starts.append(abs(first["start"] - wn["s"]))
start_err = sum(starts) / len(starts) if starts else 9
# Je Fenster: welche Wörter liegen darin? (Stichprobe für den Bericht)
per = []
for k, wn in enumerate(win):
    ws = [w["text"].strip() for w in words if wn["s"] - 0.3 <= w["start"] <= wn["e"] + 0.3]
    per.append(f"  {k+1}. [{wn['s']:.1f}–{wn['e']:.1f}] „{wn['text']}“ → {' '.join(ws)}")
lines.append(f"Reihenfolge stimmt: {order_ok} · Wörter außerhalb aller Sätze: {outside} · Satzanfänge im Mittel {start_err:.2f} s daneben ({len(starts)} von {len(win)} gefunden) · Zeit außerhalb des eigenen Satzes gesamt: {overlap_err:.2f} s")
lines += per
lines.append("  Wörter: " + " ".join(f"{w['text'].strip()}[{w['start']:.2f}-{w['end']:.2f}]" for w in words))
print("\n".join(lines))
json.dump({"label": label, "timing": res.get("timing"), "n": len(words), "order_ok": order_ok, "outside": outside, "overlap_err": round(overlap_err, 2), "start_err": round(start_err, 3), "starts": len(starts)}, open(sys.argv[2] + ".score.json", "w"))
