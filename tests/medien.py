#!/usr/bin/env python3
"""Erzeugt die Testmedien für die Prüfläufe (nur Python-Standardbibliothek und ffmpeg):
   kurz.mp4 (3 min) und lang.mp4 (6 min) mit sprachähnlichem Ton und passender Wortliste (*.words.json),
   anlauf.mp4 (knapp 1 min) mit festem Text: Anläufe, Füllwörter, unsichere Wörter und falsch geschriebene Namen,
   serie.mp4 (knapp 3 min) mit festem Text in sechs Absätzen: Fragen, Zahlen und Schlagwörter für die Clip-Vorschläge,
   ton.mp4 (Sprache mit Rauschen, Brummen und Nachhall) und musik.wav für die Prüfungen am Ton,
   takt.mp4 (30 s): jedes Bild trägt seine Nummer als Balkenmuster – daran lesen die Prüfungen Schnitte und Übergänge bildgenau ab,
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
