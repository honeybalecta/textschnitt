# Textschnitt

Gesprochene Videos über das Transkript schneiden: Video öffnen, transkribieren lassen, im Text löschen, was raus soll, exportieren.

## Einrichtung (einmalig)

1. **Python 3.9+** installieren (python.org; unter Windows beim Installieren „Add to PATH“ anhaken).
2. **ffmpeg** installieren und in den PATH aufnehmen
   - macOS: `brew install ffmpeg`
   - Windows: `winget install Gyan.FFmpeg`
3. **Whisper** für die Transkription: `pip install faster-whisper`

Beim ersten Transkribieren lädt Whisper das gewählte Modell herunter (large-v3-turbo ≈ 1,6 GB). Danach läuft alles offline.

## Starten

Nach der Einrichtung (install.bat) liegt **Textschnitt** auf dem Desktop und im Startmenü. Es öffnet sich als eigenes Programmfenster – ohne Terminal und ohne Browser.

- Video öffnen: „Öffnen“, oder die Datei ins Fenster bzw. auf die Verknüpfung ziehen
- Ist Textschnitt schon offen, landet eine weitere Datei im vorhandenen Fenster
- Fehlersuche: `textschnitt.log` im Programmordner; `Textschnitt starten.bat` startet die alte Variante mit Terminal und Browser

## Arbeiten

| Aktion | So geht's |
|---|---|
| Stelle löschen | Text markieren → `Entf` oder `Backspace` |
| Wiederherstellen | Gelöschtes markieren → nochmal `Entf` |
| Springen | Auf ein Wort oder den Zeitstempel am Absatz klicken |
| Abspielen | `Leertaste` – gelöschte Stellen werden übersprungen |
| Rückgängig / Wiederholen | `Strg+Z` / `Strg+Umschalt+Z` (Mac: `⌘`) |
| Suchen | `Strg+F`, `Enter` markiert den nächsten Treffer – direkt mit `Entf` löschbar |

Werkzeuge:
- **Füllwörter entfernen** löscht alle „äh“, „ähm“, „hm“ usw. in einem Rutsch (vorher mit „Füllwörter mit transkribieren“ transkribieren, sonst lässt Whisper sie oft weg).
- **Pausen kürzen** setzt alle langen Pausen auf eine Wunschlänge. Pausen erscheinen im Text als ⏸-Marken und lassen sich auch einzeln löschen.
- **Luft an Schnitten** lässt an jeder Schnittkante ein paar Millisekunden Ton stehen, damit nichts abgehackt klingt. Zusätzlich blendet der Export an jedem Schnitt 8 ms Ton ein und aus – so gibt es keine Knackser.
- Gepunktet unterstrichene Wörter hat Whisper unsicher erkannt.

Transkript und Schnitte werden automatisch als `<video>.textschnitt.json` neben dem Video gespeichert und beim nächsten Öffnen wiederhergestellt.

## Untertitel

Über den Reiter **Untertitel** oben im Editor:
- Schalter **Untertitel an/aus**: schaltet Untertitel mit einem Klick für Vorschau und alle Exporte ab
- Aufteilung **Zeilen** oder **1 Wort pro Untertitel**
- Text jedes Untertitels direkt bearbeiten (eigener Text wird orange markiert; „↺ automatisch“ holt den gesprochenen Text zurück)
- **✂ teilen** an der Cursorposition, **⤓ zusammenführen** mit dem nächsten, **ausblenden**
- Start und Ende in 0,1-s-Schritten verschieben
- Zeichen pro Zeile, Zeilenzahl und Maximaldauer festlegen und **Neu aufteilen**
- Größe, Position, Farbe und Umrandung – die Vorschau im Player zeigt das Ergebnis
- Gelöschte Stellen verschwinden automatisch aus den Untertiteln, die Zeiten folgen dem Schnitt

## Exporte

Video-, Audio- und SRT-Exporte landen im Ordner `<video>_textschnitt` neben der Quelldatei, CapCut-Projekte in CapCuts Entwurfsordner, Concat-Projekte in `Desktop\Concat`.

- **Video**: MP4 (H.264/AAC), bildgenau geschnitten; Untertitel wahlweise eingebrannt.
- **Audio**: WAV, MP3, M4A oder FLAC.
- **CapCut-Projekt**: ein Entwurf mit der Originaldatei auf der Zeitleiste, jeder behaltene Abschnitt als eigener Clip, dazu eine Textspur „Untertitel“ mit allen Untertiteln in deinem Stil. Wenn CapCut gefunden wird, legt Textschnitt den Entwurf direkt in den Entwurfsordner; nach einem Neustart von CapCut steht er in der Projektliste. Sonst den erzeugten Ordner selbst dorthin kopieren:
  - Windows: `%LOCALAPPDATA%\CapCut\User Data\Projects\com.lveditor.draft\`
  - macOS: `~/Movies/CapCut/User Data/Projects/com.lveditor.draft/`
- **Concat-Projekt**: ein Projektordner für das Schnittprogramm Concat in `Desktop\Concat`. Spur 1 enthält die behaltenen Abschnitte des Originals, Spur 2 die Untertitel als Textclips. In Concat einfach den Ordner öffnen. Das Projekt greift auf die Originaldatei zu – die also nicht verschieben.
- **SRT**: bei „Untertitel mitnehmen“ zu jedem Export – mit den Zeiten des geschnittenen Ergebnisses.

## Hinweise

- **Geschwindigkeit**: Mit NVIDIA-Grafikkarte (CUDA) nutzt Whisper automatisch die GPU. Auf dem Mac läuft es auf der CPU; für lange Rohschnitte ist `small` oder `medium` deutlich schneller.
- **Vorschau**: Kann der Browser eine Datei nicht abspielen (etwa HEVC vom iPhone in Firefox oder ProRes), bietet Textschnitt eine Vorschau-Datei an. Exportiert wird immer aus dem Original.
- **CapCut** hat kein offizielles Projektformat. Der Entwurf folgt dem Aufbau, den aktuelle Desktop-Versionen lesen. Sollte ein CapCut-Update ihn nicht mehr öffnen, bleiben Video-Export und EDL als verlässlicher Weg.
