# HoneyDeck

Folien für B-Roll und Präsentationen – immer im eigenen Design, in jedem Format, ohne dass etwas abgeschnitten wird.
HoneyDeck läuft eigenständig (Windows, Android, Browser) und, wenn es installiert ist, direkt in HoneyCut im Reiter „Folien“.

## Wo es läuft

| Plattform | eigenständig | in HoneyCut |
|---|---|---|
| Windows | `HoneyDeck-Setup-x.y.z.exe` (Release `deck-v…`) | HoneyCut findet HoneyDeck über den Registry-Eintrag, den der Installer setzt |
| Android | `HoneyDeck-Android-x.y.z.apk` (Release `deck-android-v…`) | HoneyCut lädt die Oberfläche aus der installierten HoneyDeck-App |
| Web | `honeybalecta.github.io/textschnitt/deck/` | immer dabei, gleiche Seite wie HoneyCut |

Ohne HoneyDeck bleibt der eingebaute Folien-Reiter von HoneyCut unverändert.

## Was es kann

- **Folien aus Text:** fertigen Text, Skript (Word, Markdown) oder Transkript (.srt, .vtt, HoneyCut) einfügen. „Folien je Satz“ oder „je Absatz“ legt einen Entwurf an; Überschriften (`#`, `##`), Listen (`-`), Zitate (`>`) und `**Begriff**: Erklärung` werden erkannt.
- **Markieren und übernehmen** wie bisher in HoneyCut: → Neue Folie, → Titel, → Text, → Stichpunkt, ⛓ Nur verknüpfen, ✨ Grundlage aus dem Text.
- **18 Folienarten:** Titel, Stichpunkte, Zitat, Zahl, Begriff, Bild + Text, Vollbild, Zwei Seiten (die bisherigen acht, unverändert) sowie Kernsatz, Frage, Piktogramme, Ablauf, Zeitstrahl, Richtig/Falsch, Kennzahlen, Balken, Anteil, Menschen.
- **150 Piktogramme** in 15 Gruppen (Protest, Politik, Recht, Staat, Arbeit, Wirtschaft, Medien, Menschen, Umwelt, Frieden, Krieg, Zeichen, Pfeile …). Antippen setzt das Symbol automatisch an die passende Stelle der Folie. Passende Symbole werden zum Text vorgeschlagen.
- **Hervorheben:** `*so*` im Text färbt den Teil in der Akzentfarbe.
- **Formate:** Quer 16:9, Hoch 9:16, Quadrat 1:1, Hoch 4:5, Quer 4:3, A4 quer. Jede Folie wird für jedes Format neu gesetzt; Texte werden verkleinert statt abgeschnitten. Wird ein Text dabei sehr klein, zeigt HoneyDeck eine Warnung beim Format.
- **Designprofile:** dieselben wie in HoneyCut (Honey Balecta Standard, Hell & ruhig, Kontrast) plus eigene – Farben, Schriften, Größen, Ausrichtung, Rand, Kennung unten rechts.
- **Import:** .honeydeck, PowerPoint (.pptx), HTML-Folien, Bilder, ZIP mit Bildern, Word (.docx), Text, Markdown, Untertitel. PDF und alte .ppt/.doc nicht.
- **Export:** PNG (einzeln oder als ZIP, ein Ordner je Format), PDF, .honeydeck.

## In HoneyCut

- Der Reiter „Folien“ zeigt HoneyDeck mit dem Transkript des Projekts. Rückgängig, Speichern und „Als B-Roll einsetzen“ laufen über HoneyCut, ebenso N im Studio.
- **Folien importieren:** Importierte Folien (z. B. eine .honeydeck-Datei oder eine PowerPoint) suchen sich ihre Stelle im Transkript selbst – über das Feld `cue` oder, wenn es fehlt, über ihren Text. Danach lassen sie sich gleich als B-Roll einsetzen.

## Das Format .honeydeck

JSON, UTF-8. Alles außer `app` und `slides` ist optional.

```json
{
  "app": "honeydeck", "v": 1,
  "name": "Die bestellte Distanz",
  "format": "16:9",
  "profile": { "id": "hb" },
  "slides": [
    {"layout": "titel", "kicker": "Gen Z regelt", "title": "Wer genau hat das gesagt?", "text": "Eine Spurensuche.", "source": "Eigene Recherche", "icons": ["megafon"], "cue": "Wer genau hat das eigentlich gesagt"},
    {"layout": "liste", "title": "Was wir wollen", "text": "Mietendeckel jetzt\nVermögen besteuern"},
    {"layout": "aussage", "title": "Solidarität ist eine *Einbahnstraße*."},
    {"layout": "icons", "title": "Machtressourcen", "text": "Strukturelle Macht\nOrganisationsmacht", "icons": ["fabrik", "gruppe"]},
    {"layout": "balken", "title": "Wahlergebnis", "text": "CDU: 31 %\n*AfD: 34 %\nLinke: 11 %"},
    {"layout": "bild", "title": "Paris", "img": "data:image/jpeg;base64,…", "imgFit": "cover", "imgPos": {"x": 0.5, "y": 0.3}}
  ]
}
```

| Feld | Bedeutung |
|---|---|
| `layout` | `titel`, `liste`, `zitat`, `zahl`, `begriff`, `bild`, `vollbild`, `zwei`, `aussage`, `frage`, `icons`, `prozess`, `zeitstrahl`, `checkliste`, `zahlen`, `balken`, `anteil`, `menschen` |
| `kicker` | Rubrik, klein über dem Titel |
| `title`, `text`, `text2` | Inhalt; bei Listen-Arten eine Zeile je Eintrag. `zeitstrahl`: `Datum: Text`, `zahlen`: `Zahl: Bedeutung`, `balken`: `Bezeichnung: Wert` (`*` vorn hebt hervor), `checkliste`: Zeilen mit `+` oder `-`, `zwei`: erste Zeile je Spalte = Überschrift, `anteil`: Titel z. B. `37 %`, `menschen`: Titel z. B. `3 von 10` |
| `source` | Quellenzeile („Quelle: …“ wird ergänzt) |
| `icons` | Piktogramme: eins für Titel/Stichpunkte/Zitat/Zahl/Begriff/Kernsatz, eins je Zeile für Piktogramme/Ablauf |
| `dark` | `true`/`false` erzwingt dunkel/hell, sonst abwechselnd |
| `img`, `imgFit`, `imgPos` | Bild als data-URL; `cover` (füllen) oder `contain` (ganz zeigen); Ausschnitt 0…1 |
| `cue` | gesprochener Satz, bei dem die Folie erscheinen soll – damit findet HoneyCut die Stelle im Transkript |

## Entwicklung

- `deck/web/` – Oberfläche: `deck-engine.js` (Folienarten, Formate, Text→Folien, Zuordnung zum Transkript), `deck-icons.js` (Piktogramme), `deck-io.js` (ZIP, PDF, Importe), `deck-app.js` (Editor)
- `deck/build.py ZIEL` – stellt die Oberfläche samt Schriften zusammen (Web, Android, Windows)
- `deck/android/` – Android-App (WebView), `deck/desktop/` – Windows-Programm (pywebview) und Installer
- `core/web/deck-host.js` – Schnittstelle in HoneyCut (`window.HC_DECK_HOST`)
- Builds: `.github/workflows/build-deck.yml` (Android + Windows), die Web-Version baut `build-web.yml` mit
