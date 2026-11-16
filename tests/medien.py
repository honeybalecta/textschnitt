#!/usr/bin/env python3
"""Erzeugt die Testmedien für die Prüfläufe (nur Python-Standardbibliothek und ffmpeg):
   kurz.mp4 (3 min) und lang.mp4 (6 min) mit sprachähnlichem Ton und passender Wortliste (*.words.json),
   anlauf.mp4 (knapp 1 min) mit festem Text: Anläufe, Füllwörter, unsichere Wörter und falsch geschriebene Namen,
   serie.mp4 (knapp 3 min) mit festem Text in sechs Absätzen: Fragen, Zahlen und Schlagwörter für die Clip-Vorschläge,
   drei kurze Einspieler (broll1–3.mp4), acht Folienbilder und ein Logo.
Aufruf: python3 tests/medien.py <Zielordner>   – vorhandene Dateien bleiben stehen."""
import array
import json
import math
import random
import subprocess
import sys
import wave
from pathlib import Path

SR = 16000
VOCAB = ("ich wollte heute über die Mieten sprechen und warum das Thema so wichtig ist weil viele Menschen "
         "in dieser Stadt nicht mehr wissen wie sie ihre Wohnung bezahlen sollen ähm das ist ein Problem "
         "also schauen wir uns die Zahlen an die Regierung sagt etwas anderes aber die Fakten zeigen deutlich "
         "dass der Markt hier versagt hat und zwar seit Jahren Solidarität Organisierung Gewerkschaft Streik").split()


def sprache(wav: Path, words_json: Path, minutes: float, seed: int) -> None:
    """Wörter als Klangstöße mit Pausen – genug, damit Lautstärkeverlauf, Pausen und Schnittkanten wie bei Sprache arbeiten."""
    rnd = random.Random(seed)
    total = int(minutes * 60 * SR)
    noise = [rnd.gauss(0, 0.0015) for _ in range(4096)]            # leises Grundrauschen
    audio = [noise[i & 4095] for i in range(total)]
    words, t, sent = [], 0.6, 0
    two_pi = 2 * math.pi
    while t < minutes * 60 - 3:
        w = rnd.choice(VOCAB)
        d = 0.12 + 0.045 * len(w) + rnd.uniform(-0.03, 0.05)
        a, n = int(t * SR), int(d * SR)
        f0 = rnd.uniform(110, 220)
        k1, k2, k3 = two_pi * f0 / SR, two_pi * f0 * 2.01 / SR, two_pi * f0 * 3.2 / SR
        up, down = 0.02 * SR, 0.03 * SR
        for i in range(n):
            env = min(1.0, i / up, (n - i) / down)
            audio[a + i] += (0.25 * math.sin(k1 * i) + 0.12 * math.sin(k2 * i) + 0.06 * math.sin(k3 * i)) * env
        sent += 1
        end = sent >= rnd.randint(6, 16)
        txt = w + ("." if end else ("," if rnd.random() < 0.08 else ""))
        if sent == 1:
            txt = txt.capitalize()
        words.append({"text": " " + txt, "start": round(t, 3), "end": round(t + d, 3), "prob": round(rnd.uniform(0.55, 0.99), 3)})
        t += d
        if end:
            t += rnd.choice([0.5, 0.7, 0.9, 1.3, 1.8])
            sent = 0
        elif rnd.random() < 0.06:
            t += rnd.uniform(0.5, 1.0)      # Denkpause
        else:
            t += rnd.uniform(0.03, 0.09)
    pcm = array.array("h", (max(-32767, min(32767, int(x * 32767))) for x in audio))
    if sys.byteorder == "big":
        pcm.byteswap()
    with wave.open(str(wav), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm.tobytes())
    words_json.write_text(json.dumps(words, ensure_ascii=False), encoding="utf-8")


# Fester Text für die Prüfungen rund ums Transkript: (Wort, Sicherheit laut Whisper, Pause danach in Sekunden)
ANLAUF = [
    ("Heute", .93, .05), ("spreche", .9, .05), ("ich", .95, .05), ("über", .9, .05), ("Mareike", .62, .05), ("Hermeyer", .31, .06), ("und", .95, .05), ("die", .93, .05), ("AFD.", .44, .9),
    ("Ich", .9, .05), ("wollte", .9, .55), ("ich", .92, .05), ("wollte", .93, .05), ("heute", .9, .05), ("über", .9, .05), ("die", .9, .05), ("Mieten", .88, .05), ("sprechen.", .9, 1.0),
    ("Ähm", .8, .06), ("das", .9, .05), ("ist", .9, .06), ("äh", .7, .06), ("ein", .9, .05), ("Problem.", .9, 1.5),
    ("Die", .9, .05), ("Regierung", .9, .05), ("sagt", .9, .05), ("etwas", .9, .05), ("anderes.", .9, .8),
    ("Die", .9, .05), ("Regierung", .9, .05), ("sagt", .9, .05), ("aber", .9, .05), ("etwas", .9, .05), ("anderes.", .9, 1.3),
    ("Viele", .9, .05), ("Menschen", .9, .05), ("wissen", .9, .05), ("nicht", .9, .05), ("mehr", .9, .05), ("weiter", .38, .05), ("zu", .41, .05), ("kommen.", .9, .7),
    ("Frau", .9, .05), ("Hermeyers", .35, .05), ("Antrag", .9, .05), ("liegt", .9, .05), ("im", .9, .05), ("Bundestag.", .9, 1.0),
    ("Her", .3, .05), ("Meier", .33, .05), ("sagt", .9, .05), ("dazu", .9, .05), ("nichts.", .9, .6),
    ("Das", .9, .05), ("zeigen", .9, .05), ("die", .9, .05), ("Zahlen", .9, .05), ("der", .9, .05), ("Gewerkschaft", .9, .05), ("deutlich.", .9, 1.2),
]


# Fester Text für „Clips in Serie“: sechs Absätze (Pause von 1,6 s dazwischen, 0,5 s zwischen den Sätzen). Der erste und der vierte beginnen
# mit einer Frage, der zweite knüpft mit „Und deshalb“ an, der dritte ist für einen Clip zu kurz; Zahlen stehen im ersten und im fünften.
SERIE = [
    ["Warum steigen die Mieten in Berlin seit Jahren?", "Die Antwort ist einfacher, als viele denken.", "Der Mietendeckel wurde 2021 gekippt.",
     "Seitdem zahlen viele Menschen 30 Prozent mehr für ihre Wohnung.", "Das zeigen die Zahlen der Gewerkschaft sehr deutlich.",
     "Die Löhne sind in derselben Zeit kaum gestiegen.", "Bei vielen geht inzwischen die Hälfte des Einkommens für die Miete drauf."],
    ["Und deshalb organisieren sich immer mehr Menschen in ihren Häusern.", "Sie gründen Hausgemeinschaften und sprechen mit ihren Nachbarn.",
     "Sie sammeln Unterschriften und gehen gemeinsam zur Hausverwaltung.", "In Neukölln hat eine Hausgemeinschaft so eine Mieterhöhung verhindert.",
     "In Kreuzberg haben Nachbarinnen den Verkauf ihres Hauses gestoppt.", "Das klappt, weil viele zusammen mehr erreichen als eine Person allein."],
    ["Wer sich organisiert, kennt seine Rechte besser.", "Wer seine Rechte kennt, lässt sich weniger gefallen.",
     "Diese Entwicklung ist das Ergebnis politischer Entscheidungen.", "Entscheidungen lassen sich ändern."],
    ["Was können wir also tun?", "Erstens können wir uns im eigenen Haus zusammentun.", "Ein Aushang im Treppenhaus reicht oft für den Anfang.",
     "Zweitens können wir die Initiativen in unserem Kiez unterstützen.", "Viele von ihnen suchen dringend Leute, die mit anpacken.",
     "Drittens können wir Druck auf die Politik machen."],
    ["Der Volksentscheid zur Vergesellschaftung hat gezeigt, was möglich ist.", "Mehr als eine Million Menschen haben damals mit Ja gestimmt.",
     "Das waren 59 Prozent der gültigen Stimmen.", "Umgesetzt ist der Entscheid bis heute nicht.",
     "Deshalb braucht es weiter Solidarität zwischen den Häusern und den Kiezen.", "Solidarität heißt hier ganz praktisch, dass niemand allein vor dem Vermieter steht."],
    ["Am Ende zählt, dass wir zusammenhalten.", "Eine Stadt gehört den Menschen, die in ihr leben.", "Wohnen ist ein Grundbedürfnis.",
     "Darum bleiben wir dran, Haus für Haus und Kiez für Kiez.", "Wenn dir dieses Video geholfen hat, dann teile es mit deinen Nachbarn.",
     "Wir sehen uns beim nächsten Treffen der Initiative."],
]


def serie_items() -> list:
    items = []
    for para in SERIE:
        for si, sent in enumerate(para):
            ws = sent.split()
            for k, w in enumerate(ws):
                items.append((w, .92, (1.6 if si == len(para) - 1 else 0.5) if k == len(ws) - 1 else 0.05))
    return items


def skript(wav: Path, words_json: Path, items: list) -> float:
    """Wie sprache(), aber mit festem Text und festen Pausen. Rückgabe: Länge in Sekunden."""
    rnd = random.Random(5)
    dur = [0.14 + 0.045 * len(w.strip(".")) for w, _, _ in items]
    length = 0.6 + sum(dur) + sum(g for _, _, g in items) + 1.0
    total = int(length * SR)
    noise = [rnd.gauss(0, 0.0015) for _ in range(4096)]
    audio = [noise[i & 4095] for i in range(total)]
    words, t, two_pi = [], 0.6, 2 * math.pi
    for (w, prob, gap), d in zip(items, dur):
        a, n = int(t * SR), int(d * SR)
        f0 = rnd.uniform(110, 220)
        k1, k2, k3 = two_pi * f0 / SR, two_pi * f0 * 2.01 / SR, two_pi * f0 * 3.2 / SR
        up, down = 0.02 * SR, 0.03 * SR
        for i in range(n):
            env = min(1.0, i / up, (n - i) / down)
            audio[a + i] += (0.25 * math.sin(k1 * i) + 0.12 * math.sin(k2 * i) + 0.06 * math.sin(k3 * i)) * env
        words.append({"text": " " + w, "start": round(t, 3), "end": round(t + d, 3), "prob": prob})
        t += d + gap
    pcm = array.array("h", (max(-32767, min(32767, int(x * 32767))) for x in audio))
    if sys.byteorder == "big":
        pcm.byteswap()
    with wave.open(str(wav), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm.tobytes())
    words_json.write_text(json.dumps(words, ensure_ascii=False), encoding="utf-8")
    return length


def ff(*args: str) -> None:
    subprocess.run(["ffmpeg", "-v", "error", "-y", *args], check=True)


def main(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    enc = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-g", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart"]
    for name, minutes, seed in (("kurz", 3, 2), ("lang", 6, 1)):
        mp4 = out / f"{name}.mp4"
        if mp4.exists() and (out / f"{name}.words.json").exists():
            continue
        wav = out / f"{name}.wav"
        sprache(wav, out / f"{name}.words.json", minutes, seed)
        ff("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-i", str(wav), "-t", str(minutes * 60), *enc, str(mp4))
        wav.unlink()
        print(mp4.name, f"{mp4.stat().st_size / 1e6:.1f} MB")
    if not ((out / "anlauf.mp4").exists() and (out / "anlauf.words.json").exists()):
        wav = out / "anlauf.wav"
        length = skript(wav, out / "anlauf.words.json", ANLAUF)
        ff("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-i", str(wav), "-t", f"{length:.2f}", *enc, str(out / "anlauf.mp4"))
        wav.unlink()
        print("anlauf.mp4", f"{length:.1f} s")
    if not ((out / "serie.mp4").exists() and (out / "serie.words.json").exists()):
        wav = out / "serie.wav"
        length = skript(wav, out / "serie.words.json", serie_items())
        ff("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-i", str(wav), "-t", f"{length:.2f}", *enc, str(out / "serie.mp4"))
        wav.unlink()
        print("serie.mp4", f"{length:.1f} s")
    for k, (src, freq) in enumerate((("testsrc=size=640x360:rate=30", 440), ("smptebars=size=640x360:rate=30", 554), ("rgbtestsrc=size=640x360:rate=30", 659)), 1):
        mp4 = out / f"broll{k}.mp4"
        if not mp4.exists():
            ff("-f", "lavfi", "-i", src, "-f", "lavfi", "-i", f"sine=frequency={freq}:sample_rate=44100", "-t", "15", "-af", "volume=0.2", *enc, str(mp4))
    for k, col in enumerate(("1F2A24", "2A1F24", "24271F", "1F242A", "2A261F", "211F2A", "1F2A29", "2A1F1F"), 1):
        png = out / f"folie{k}.png"
        if not png.exists():
            ff("-f", "lavfi", "-i", f"color=c=0x{col}:size=1280x720", "-frames:v", "1", str(png))
    if not (out / "logo.png").exists():
        ff("-f", "lavfi", "-i", "color=c=0xE5402A@0.85:size=200x200,format=rgba", "-frames:v", "1", str(out / "logo.png"))
    print("Testmedien bereit:", out)


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parent / ".work" / "media"))
