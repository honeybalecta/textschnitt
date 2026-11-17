#!/usr/bin/env python3
"""Erzeugt die Testmedien für die Prüfläufe (nur Python-Standardbibliothek und ffmpeg):
   kurz.mp4 (3 min) und lang.mp4 (6 min) mit sprachähnlichem Ton und passender Wortliste (*.words.json),
   anlauf.mp4 (knapp 1 min) mit festem Text: Anläufe, Füllwörter, unsichere Wörter und falsch geschriebene Namen,
   serie.mp4 (knapp 3 min) mit festem Text in sechs Absätzen: Fragen, Zahlen und Schlagwörter für die Clip-Vorschläge,
   ton.mp4 (Sprache mit Rauschen, Brummen und Nachhall) und musik.wav für die Prüfungen am Ton,
   takt.mp4 (30 s): jedes Bild trägt seine Nummer als Balkenmuster – daran lesen die Prüfungen Schnitte und Übergänge bildgenau ab,
   karo.mp4 (12 s): ein Schachbrett aus 4 Pixel großen Feldern – daran messen die Prüfungen, wo im fertigen Bild gemittelt wurde,
   gruen.mp4 (10 s): Greenscreen mit einem Feld in der Mitte (erst mit Farbstich, dann neutral) für Farbe und Hintergründe,
   wackel.mp4 (4 s): ein stehendes Wolkenmuster mit wanderndem Ausschnitt für das Beruhigen,
   gespraech.mp4 (gut 1 min): drei künstliche Stimmen im Wechsel für das Erkennen der Personen (gespraech.json nennt die Lösung);
   mit einem ffmpeg, das flite kennt, zusätzlich stimmen-flite.wav mit drei Sprachsynthese-Stimmen,
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


# Prüfmedium zum Ton (2.34): drei Sprechblöcke, dazwischen eine Pause von gut vier Sekunden und eine von 1,2 s. Der zweite Block
# ist 9 dB leiser aufgenommen. Über allem liegen Rauschen und ein Brummen bei 50 Hz, die Sprache trägt Nachhall (0,6 s).
# (Sätze, Pegel des Blocks, Pause nach dem Block in Sekunden)
TON = [
    (["Heute sprechen wir über den Ton in unseren Videos.", "Musik soll leiser werden, sobald jemand spricht."], 1.0, 4.2),
    (["Diese Stelle ist deutlich leiser aufgenommen als der Anfang.", "Das gleicht HoneyCut beim Aufbereiten aus."], 0.355, 1.2),
    (["Am Ende kommt die Musik zurück."], 1.0, 4.0),
]
TON_SR = 48000
TON_START = 3.0      # so lange läuft am Anfang nur der Raum
TON_NOISE = 0.006    # Rauschen (Effektivwert), rund −44 dBFS
TON_HUM = 0.03       # Brummen bei 50 Hz (Scheitelwert), rund −33 dBFS


def ton(out: Path) -> None:
    """ton.mp4 (mit ton.words.json und ton.json: Lage der Blöcke, Pegel) und musik.wav (gleichmäßiger Zweiklang, 40 s)."""
    import numpy as np
    sr, rng = TON_SR, np.random.default_rng(11)
    words, blocks, t = [], [], TON_START
    plan = []
    for sents, level, pause in TON:
        b0 = t
        for si, sent in enumerate(sents):
            ws = sent.split()
            for k, w in enumerate(ws):
                d = 0.14 + 0.045 * len(w.strip(".,"))
                plan.append((t, d, level, rng.uniform(110, 220)))
                words.append({"text": " " + w, "start": round(t, 3), "end": round(t + d, 3), "prob": 0.92})
                t += d + (0.05 if k < len(ws) - 1 else 0.5 if si < len(sents) - 1 else 0.0)
        blocks.append({"a": round(b0, 3), "b": round(t, 3), "level": level})
        t += pause
    length = t
    n = int(length * sr)
    dry = np.zeros(n)
    for a, d, level, f0 in plan:
        m = int(d * sr)
        i = np.arange(m)
        env = np.minimum(1.0, np.minimum(i / (0.02 * sr), (m - i) / (0.03 * sr)))
        # Grundton mit Obertönen bis 6 kHz, zu den Höhen hin leiser – genug, damit auch oberhalb von 2 kHz Sprache liegt
        sig = sum(np.sin(2 * np.pi * f0 * h * i / sr + h) / h ** 1.2 for h in range(1, int(6000 / f0)))
        dry[int(a * sr): int(a * sr) + m] += 0.16 * level * env * sig
    # Nachhall: abklingendes Rauschen, 60 dB in 0,6 s, 8 dB unter dem Direktschall
    m = int(0.7 * sr)
    ir = rng.standard_normal(m) * np.exp(-6.9 * np.arange(m) / (0.6 * sr))
    ir[: int(0.01 * sr)] = 0
    ir *= 10 ** (-8 / 20) / np.sqrt((ir ** 2).sum())
    size = 1 << int(np.ceil(np.log2(n + m)))
    wet = np.fft.irfft(np.fft.rfft(dry, size) * np.fft.rfft(ir, size), size)[:n]
    tt = np.arange(n) / sr
    audio = dry + wet + TON_NOISE * rng.standard_normal(n) + TON_HUM * np.sin(2 * np.pi * 50 * tt) + 0.4 * TON_HUM * np.sin(2 * np.pi * 100 * tt)
    wav = out / "ton.wav"
    with wave.open(str(wav), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(sr)
        f.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
    ff("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-i", str(wav), "-t", f"{length:.2f}",
       "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-g", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(out / "ton.mp4"))
    wav.unlink()
    (out / "ton.words.json").write_text(json.dumps(words, ensure_ascii=False), encoding="utf-8")
    (out / "ton.json").write_text(json.dumps({"length": round(length, 3), "start": TON_START, "blocks": blocks, "noise": TON_NOISE, "hum": TON_HUM}), encoding="utf-8")
    # Musik: zwei Töne weit oberhalb der Sprache (2 und 3,1 kHz) – ihr Pegel lässt sich im fertigen Ton für sich messen
    tm = np.arange(40 * sr) / sr
    mus = 0.12 * np.sin(2 * np.pi * 2000 * tm) + 0.08 * np.sin(2 * np.pi * 3100 * tm)
    with wave.open(str(out / "musik.wav"), "wb") as f:
        f.setnchannels(2)
        f.setsampwidth(2)
        f.setframerate(sr)
        f.writeframes((np.repeat(mus[:, None], 2, axis=1) * 32767).astype("<i2").tobytes())
    print("ton.mp4", f"{length:.1f} s · musik.wav 40 s")


TAKT_S, TAKT_FPS, TAKT_BITS = 30, 30, 10


def takt(out: Path) -> None:
    """takt.mp4 (30 s, 30 Bilder/s) mit takt.words.json: Jedes Bild zeigt seine Nummer als zehn senkrechte Balken (von links:
    Stelle 0 bis 9 der Dualzahl, hell = 1). Im fertigen Export lässt sich so ablesen, welches Bild der Quelle zu sehen ist –
    und bei einer Blende, zu welchem Anteil. Der Ton: je halbe Sekunde ein kurzer Ton, dazu ein Wort in der Wortliste."""
    import numpy as np
    sr = 48000
    n = TAKT_S * sr
    audio, words = np.zeros(n), []
    names = "eins zwei drei vier fünf sechs sieben acht neun zehn".split()
    for k in range(TAKT_S * 2):
        a, d = 0.5 * k + 0.05, 0.4
        m = int(d * sr)
        i = np.arange(m)
        env = np.minimum(1.0, np.minimum(i / (0.02 * sr), (m - i) / (0.03 * sr)))
        f0 = 140 + 12 * (k % 10)
        audio[int(a * sr): int(a * sr) + m] += 0.15 * env * sum(np.sin(2 * np.pi * f0 * h * i / sr) / h for h in range(1, 9))
        words.append({"text": " " + names[k % 10] + ("." if k % 10 == 9 else ""), "start": round(a, 3), "end": round(a + d, 3), "prob": 0.95})
    wav = out / "takt.wav"
    with wave.open(str(wav), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(sr)
        f.writeframes((np.clip(audio, -1, 1) * 32767).astype("<i2").tobytes())
    bars = f"geq=lum='if(gt(mod(floor(N/pow(2,floor(X*{TAKT_BITS}/W))),2),0),232,24)':cb=128:cr=128"
    ff("-f", "lavfi", "-i", f"color=c=black:size=160x90:rate={TAKT_FPS},format=yuv420p,{bars},scale=640:360:flags=neighbor", "-i", str(wav), "-t", str(TAKT_S),
       "-c:v", "libx264", "-preset", "veryfast", "-crf", "24", "-g", "30", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(out / "takt.mp4"))
    wav.unlink()
    (out / "takt.words.json").write_text(json.dumps(words, ensure_ascii=False), encoding="utf-8")
    print("takt.mp4", f"{TAKT_S} s")


# Prüfmedium zum Erkennen der Personen (2.38): drei künstliche Stimmen. Jede hat eine eigene Grundtonhöhe und einen eigenen
# „Rachenraum“ (Lage der Formanten); die Vokale wechseln von Silbe zu Silbe. (Grundton in Hz, Faktor der Formanten, Pegel)
STIMMEN = [(112, 1.0, 1.0), (205, 1.2, 0.7), (150, 0.86, 0.85)]
VOKALE = [(730, 1090, 2440), (270, 2290, 3010), (390, 1990, 2550), (570, 840, 2410), (300, 870, 2240), (520, 1600, 2500)]
GESPRAECH = [   # (Stimme, Satz, Pause danach)
    (0, "Heute sprechen wir über die Mieten in unserer Stadt.", 0.5), (0, "Zu Gast sind zwei Menschen aus der Nachbarschaft.", 0.7),
    (1, "Danke für die Einladung.", 0.4), (1, "Bei uns im Haus steigt die Miete seit Jahren.", 0.6),
    (2, "Das kenne ich gut.", 0.3), (2, "Unsere Hausgemeinschaft hat sich deshalb zusammengetan und einen Brief geschrieben.", 0.8),
    (0, "Was stand in dem Brief?", 0.5),
    (2, "Wir fordern eine Rücknahme der Erhöhung und ein Gespräch mit der Verwaltung.", 0.6),
    (1, "Genau.", 0.3), (1, "Allein hätte ich mich das kaum getraut.", 0.5), (1, "Zusammen ging es leichter als gedacht.", 0.7),
    (0, "Wie hat die Verwaltung reagiert?", 0.5),
    (2, "Erst kam keine Antwort.", 0.3), (2, "Nach zwei Wochen haben wir alle gemeinsam im Büro gestanden.", 0.6),
    (0, "Und dann?", 0.4),
    (1, "Dann gab es plötzlich einen Termin.", 0.5), (1, "Die Erhöhung liegt inzwischen auf Eis.", 0.8),
    (0, "Was ratet ihr anderen Häusern?", 0.5),
    (2, "Redet mit euren Nachbarinnen und Nachbarn und fangt klein an.", 0.5),
    (1, "Und schreibt alles auf, was die Verwaltung sagt.", 0.7),
    (0, "Vielen Dank euch beiden.", 0.4), (0, "Nächste Woche geht es an dieser Stelle um Nebenkosten.", 1.0),
]


def gespraech(out: Path) -> None:
    rnd = random.Random(38)
    audio = [rnd.gauss(0, 0.0012) for _ in range(int(0.6 * SR))]
    words, truth = [], []
    for who, satz, pause in GESPRAECH:
        f0, tract, gain = STIMMEN[who]
        for w in satz.split():
            t0 = len(audio) / SR
            kern = w.strip(".,?!")
            silben = max(1, round(len(kern) / 3))
            for s in range(silben):
                n = int(rnd.uniform(0.11, 0.17) * SR)
                fm = VOKALE[rnd.randrange(len(VOKALE))]
                res = []   # drei Resonatoren (zweipolig), Bandbreite wächst mit der Frequenz
                for k, f in enumerate(fm):
                    fc, bw = f * tract, 60 + 40 * k
                    r = math.exp(-math.pi * bw / SR)
                    res.append([2 * r * math.cos(2 * math.pi * fc / SR), -r * r, 0.0, 0.0, (1.0, 0.6, 0.3)[k]])
                per, ph = SR / (f0 * rnd.uniform(0.96, 1.04)), 0.0
                for i in range(n):
                    ph += 1.0
                    x = rnd.gauss(0, 0.02)
                    if ph >= per:
                        ph -= per
                        x += 1.0
                    y = 0.0
                    for q in res:
                        v = x + q[0] * q[2] + q[1] * q[3]
                        q[3], q[2] = q[2], v
                        y += q[4] * v
                    env = min(1.0, i / (0.015 * SR), (n - i) / (0.02 * SR))
                    audio.append(0.035 * gain * env * y + rnd.gauss(0, 0.0012))
            t1 = len(audio) / SR
            words.append({"text": " " + w, "start": round(t0, 3), "end": round(t1, 3), "prob": 0.9})
            truth.append(who)
            audio.extend(rnd.gauss(0, 0.0012) for _ in range(int(rnd.uniform(0.03, 0.07) * SR)))
        audio.extend(rnd.gauss(0, 0.0012) for _ in range(int(pause * SR)))
    audio.extend(rnd.gauss(0, 0.0012) for _ in range(SR))
    pcm = array.array("h", (max(-32767, min(32767, int(x * 32767))) for x in audio))
    if sys.byteorder == "big":
        pcm.byteswap()
    wav = out / "gespraech.wav"
    with wave.open(str(wav), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm.tobytes())
    (out / "gespraech.words.json").write_text(json.dumps(words, ensure_ascii=False), encoding="utf-8")
    (out / "gespraech.json").write_text(json.dumps({"stimmen": len(STIMMEN), "wer": truth}), encoding="utf-8")
    length = len(audio) / SR
    ff("-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-i", str(wav), "-t", f"{length:.2f}", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-g", "30",
       "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(out / "gespraech.mp4"))
    wav.unlink()
    print("gespraech.mp4", f"{length:.1f} s")


FLITE = [("slt", "we need to talk about wages and rent in this city"), ("rms", "the numbers from last year tell a different story"),
         ("awb", "people are organizing in their neighborhoods right now"), ("slt", "how would that work in practice"),
         ("rms", "the union has been saying this for years and nobody listened"), ("awb", "I was there on monday and saw it with my own eyes"),
         ("slt", "housing is a right and the market has failed"), ("rms", "so what should people do tomorrow morning"),
         ("awb", "join a union and talk to your neighbors"), ("slt", "that sounds good to me"), ("rms", "the press reported it very differently"),
         ("awb", "solidarity means that nobody is left alone when the pressure rises"), ("slt", "let me finish my point please"),
         ("rms", "we looked at the data from twelve regions and the pattern is the same everywhere"), ("awb", "exactly and that is why we went on strike"),
         ("slt", "the strike was a success because everyone stood together"), ("rms", "I think the question is who pays for the crisis"),
         ("awb", "there is a long history behind this decision")]


def stimmen_flite(out: Path) -> None:
    """Drei Stimmen der Sprachsynthese flite im Wechsel – nur, wenn das ffmpeg hier flite kennt. Die Wortzeiten sind gleichmäßig über den Satz verteilt."""
    r = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True)
    if " flite " not in r.stdout:
        print("stimmen-flite.wav: ausgelassen (ffmpeg ohne flite)")
        return
    order = sorted({v for v, _ in FLITE})
    pcm, words, truth = array.array("h", [0] * (SR // 2)), [], []
    tmp, txt = out / "_flite.wav", out / "_flite.txt"
    for voice, satz in FLITE:
        txt.write_text(satz, encoding="utf-8")
        ff("-f", "lavfi", "-i", f"flite=textfile={txt}:voice={voice}", "-ar", str(SR), "-ac", "1", str(tmp))
        with wave.open(str(tmp), "rb") as f:
            a = array.array("h", f.readframes(f.getnframes()))
        if sys.byteorder == "big":
            a.byteswap()
        loud = [i for i, x in enumerate(a) if abs(x) > 400]
        a = a[max(0, loud[0] - 160): loud[-1] + 160] if loud else a
        t0, d, ws = len(pcm) / SR, len(a) / SR, satz.split()
        tot, c = sum(len(w) + 1 for w in ws), 0.0
        for w in ws:
            part = (len(w) + 1) / tot * d
            words.append({"text": " " + w, "start": round(t0 + c, 3), "end": round(t0 + c + part * 0.95, 3), "prob": 0.9})
            truth.append(order.index(voice))
            c += part
        words[-1]["text"] += "."
        pcm.extend(a)
        pcm.extend([0] * int(0.4 * SR))
    tmp.unlink(missing_ok=True)
    txt.unlink(missing_ok=True)
    if sys.byteorder == "big":
        pcm.byteswap()
    with wave.open(str(out / "stimmen-flite.wav"), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(SR)
        f.writeframes(pcm.tobytes())
    (out / "stimmen-flite.json").write_text(json.dumps({"stimmen": len(order), "wer": truth, "words": words}), encoding="utf-8")
    print("stimmen-flite.wav", f"{len(pcm) / SR:.1f} s")


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
    if not all((out / f).exists() for f in ("ton.mp4", "ton.words.json", "ton.json", "musik.wav")):
        ton(out)
    if not all((out / f).exists() for f in ("takt.mp4", "takt.words.json")):
        takt(out)
    if not all((out / f).exists() for f in ("gespraech.mp4", "gespraech.words.json", "gespraech.json")):
        gespraech(out)
    if not (out / "stimmen-flite.wav").exists():
        stimmen_flite(out)
    if not (out / "karo.mp4").exists():
        ff("-f", "lavfi", "-i", "color=c=black:size=640x360:rate=30,format=gray,geq=lum='16+219*mod(floor(X/4)+floor(Y/4)\\,2)'", "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=44100",
           "-t", "12", "-af", "volume=0.1", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "10", "-g", "30", "-c:a", "aac", "-b:a", "96k", str(out / "karo.mp4"))
    if not (out / "gruen.mp4").exists():   # Greenscreen: grüne Fläche, in der Mitte ein Feld – erst mit warmem Farbstich, ab 5 s neutral grau
        ff("-f", "lavfi", "-i", "color=c=0x00FF00:size=640x360:rate=30,drawbox=x=200:y=80:w=240:h=200:color=0xA08060:t=fill:enable='lt(t,5)',"
           "drawbox=x=200:y=80:w=240:h=200:color=0x808080:t=fill:enable='gte(t,5)',drawbox=x=300:y=160:w=40:h=40:color=0x202020:t=fill",
           "-f", "lavfi", "-i", "sine=frequency=392:sample_rate=44100", "-t", "10", "-af", "volume=0.1", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "10", "-g", "30", "-c:a", "aac", "-b:a", "96k", str(out / "gruen.mp4"))
    if not (out / "wackel.mp4").exists():   # ein stehendes Wolkenmuster, dessen Ausschnitt hin- und herwandert – wie aus der Hand gefilmt
        ff("-f", "lavfi", "-i", "nullsrc=s=760x440:r=30,geq=lum='random(1)*255':cb=128:cr=128,gblur=sigma=6,eq=contrast=4", "-frames:v", "1", str(out / "wackel.png"))
        ff("-loop", "1", "-framerate", "30", "-i", str(out / "wackel.png"), "-f", "lavfi", "-i", "sine=frequency=262:sample_rate=44100",
           "-vf", "crop=640:360:60+22*sin(t*9)+12*sin(t*23):40+16*cos(t*7)+9*sin(t*19)",
           "-t", "4", "-af", "volume=0.1", "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast", "-crf", "14", "-g", "30", "-c:a", "aac", "-b:a", "96k", str(out / "wackel.mp4"))
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
