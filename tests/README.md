# Prüfläufe

Die Prüfläufe fahren die Desktop-Fassung von HoneyCut so, wie sie auch im Alltag läuft: das echte Backend (`textschnitt.py`), die echte Oberfläche in Chrome, echte Videos und echte Exporte über ffmpeg. Nachgestellt sind nur drei Dinge: Die Transkription liefert eine vorbereitete Wortliste, damit kein Whisper-Modell nötig ist; Dateidialoge lesen ihre Antwort aus einer Datei; und nichts verlässt den Rechner – die Abfrage bei GitHub und „im Browser öffnen“ landen in Dateien.

## Starten

```
cd tests && npm install        # einmalig: Playwright
tests/lauf.sh                  # alles (rund 10 Minuten, mit Vergleich rund 15)
tests/lauf.sh p_stand.mjs edit # eine einzelne Prüfung
HC_BASIS=v2.25.0 tests/lauf.sh # zusätzlich der Vergleich mit einer früheren Fassung
```

Gebraucht werden python3 mit numpy, ffmpeg, Node und Google Chrome (`HC_CHROME=/pfad/zu/chrome`, falls Chrome woanders liegt). Alles, was die Läufe anlegen, liegt in `tests/.work/` (Testmedien, Datenordner, Protokolle, Bildschirmfotos, `out/bericht.md`); der Ordner lässt sich jederzeit löschen. Die Backends laufen auf den Ports 8795 und 8796 und kommen einer installierten HoneyCut-App nicht in die Quere.

## Was geprüft wird

| Datei | Inhalt |
|---|---|
| `backend_test.py` | Backend ohne Browser: sicheres Speichern, frühere Fassungen, Papierkorb, Speicher verwalten, alle Projekte sichern und einspielen (auch in einen anderen Datenordner), Projekt weitergeben mit eingebetteten Bildern (das Verhalten von Windows bei überlangen Pfaden ist nachgestellt), Vorschaubild der Projektliste, Textzeile und Untertitel im Export (Untertiteldatei, eingebrannt, Concat), Quellenzeilen und Textfassung, Schrift im Export (Maße der Schriftdateien, Größe und Umbruch wie in der Vorschau, eingebettete Schrift, Nachprüfung am Protokoll von ffmpeg, echte Probe-Exporte, Hinweis bei fehlender Schrift, Name der SRT-Datei), Hinweis auf neue Versionen, Fehlerbericht |
| `p_umbenennen.mjs` | Projekte umbenennen in der Liste und im offenen Projekt |
| `p_fassungen.mjs` | Frühere Fassungen und Papierkorb in der Oberfläche, auch mit dem Projekt in einem zweiten Fenster |
| `p_verwaltung.mjs` | Einstellungen: Speicher, Sicherung, Fehlerbericht, Hinweis auf neue Versionen |
| `p_paket.mjs` | Projekt weitergeben: Paket schreiben und wieder einlesen, mit eingebettetem Folienbild, Wasserzeichen und eigenen Untertitel-Looks |
| `p_helfer.mjs` | Kleine Helfer: Projektliste (Suche, Reihenfolge, Vorschaubild, Duplizieren), weitere Sprachen, eigene Füllwörter, Satz und Absatz auswählen, Kapitel und Notizen, Lesbarkeit der Untertitel, eigene Looks, Längen-Ampel, Schutzzonen, dauerhafte Textzeile (auch im echten Export und in CapCut), Titelbild |
| `p_schutz.mjs` | Rückgängig für Format, Ausschnitt und Lautstärke; Abgleich mehrerer Fenster; sichtbare Speicherfehler |
| `p_quellen.mjs` | Quellen und Belege: Quellen zu Aussagen (Zeile im Bild, Quellenliste), „Beleg nötig“ mit Hinweis vor dem Export, Bauchbinden (beim ersten Auftritt und von Hand), Prüfung auf Barrierefreiheit, Textfassung – auch in echten Exporten und in CapCut |
| `p_schnittleiste.mjs` | Schnitt-Zeitleiste im Text-Reiter: Hauptspur und Wörter, Schnitte an Kanten und Abspiellinie, keine weiteren Studio-Werkzeuge; breit und am Handy |
| `p_schrift.mjs` | Schrift im Export: Vorschau und exportiertes Video zeigen die Untertitel gleich groß, an derselben Stelle und gleich umbrochen (Standardschrift, gewählte Schriften, Kasten, Hochformat) – gemessen am fertigen Bild; Hinweis, wenn eine Schriftdatei fehlt; Name der SRT-Datei |
| `p_stand.mjs` | Bearbeiten im Stand: Die Abspiellinie bleibt auf demselben Bild (zwölf Fälle je Projekt) |
| `p_wiedergabe.mjs` | Bearbeiten beim Abspielen: Die Wiedergabe läuft weiter (achtzehn Fälle je Projekt) |
| `v_plan.mjs` | Vergleich mit einer früheren Fassung: Exportplan, Untertitel, Zeitleiste und Umrechnungen aller Testprojekte |
| `v_bedienung.mjs` | Vergleich: dieselben Handgriffe mit Maus und Tastatur führen zum selben Projektstand |
| `v_export.mjs` | Vergleich: echte Exporte (Video, CapCut) liefern dasselbe Bild und denselben Ton |

Die Prüfungen mit `p_` müssen bestehen. Die Vergleiche mit `v_` melden Abweichungen als Hinweis: Ändert ein Update den Export oder die Bedienung mit Absicht, ist die Abweichung erwünscht und wird im Bericht sichtbar.

## Hilfsdateien

- `backend.py` startet das Test-Backend, `medien.py` erzeugt die Testmedien, `einrichten.mjs` legt die Testprojekte über die Oberfläche an (`kurz`, `lang`, `edit`, `editWord`, `stress`, `multi`), `drv.mjs` enthält die gemeinsamen Hilfen.
- Auf GitHub startet `.github/workflows/test.yml` die Läufe bei jeder Änderung an `core/`, `textschnitt.py` oder `tests/` und hängt den Bericht als Kommentar an den Commit.
