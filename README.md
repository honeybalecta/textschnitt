# HoneyCut

*(früher „Textschnitt“)* – Gesprochene Videos über das Transkript schneiden – mit einem kleinen Studio dazu: Videos öffnen (auch mehrere hintereinander), transkribieren lassen, im Text löschen, was raus soll, in der Zeitleiste feinschneiden, Clips, Fotos, Bild-im-Bild und Zooms einsetzen, Untertitel gestalten und frei platzieren, exportieren.

HoneyCut gibt es für **Windows**, **Android** und als **Web-Version** direkt im Browser: **https://honeybalecta.github.io/textschnitt/**

## Aufbau

| Ordner | Inhalt |
|---|---|
| `core/web/` | **Der gemeinsame Studio-Kern**: Oberfläche, Schnittmodell, Zeitleiste, Untertitel, Export-Plan. Läuft unverändert auf allen Plattformen. |
| `textschnitt.py`, `textschnitt_app.py` | Windows-Adapter: lokales Backend (faster-whisper, ffmpeg) und Programmfenster (Edge WebView2) |
| `android/` | Android-Adapter: whisper.cpp, Media3-Export, Galerie; bindet `core/web` beim Bauen ein |
| `web/` | Browser-Adapter: Whisper über transformers.js (WebGPU/WebAssembly), Export über WebCodecs (mediabunny), Projekte in IndexedDB – nichts wird hochgeladen |

Die Plattformen stellen dem Kern dieselbe Schnittstelle `window.TS` bereit (Dateiauswahl, Projekte, Transkription, Export). Neue Studio-Funktionen entstehen einmal im Kern; nur was plattformabhängig ist (Transkription, Rendern, Dateizugriff), lebt in den Adaptern.

## Installieren

- **Windows**: Installer unter [Releases](https://github.com/honeybalecta/textschnitt/releases) (`HoneyCut-Setup-….exe`). Whisper-Modell „small“ und ffmpeg sind dabei, alles läuft offline.
- **Android**: APK unter Releases (`HoneyCut-Android-….apk`), Android 10 oder neuer.
- **Browser**: https://honeybalecta.github.io/textschnitt/ – ohne Installation. Videos bleiben auf dem Gerät; die Whisper-Modelle tiny und base liefert die Seite selbst aus (einmal geladen, dann im Browser gespeichert); nur das größere Modell small kommt von Hugging Face. Am besten in aktuellem Chrome oder Edge (mit Grafikkarte deutlich schneller); läuft nach dem ersten Besuch auch offline und lässt sich als App installieren.

## Arbeiten

- **Projekte**: In der Projektliste benennt der Stift ein Projekt um; im offenen Projekt genügt ein Klick auf den Namen in der Kopfzeile. Der Export schlägt den neuen Namen gleich als Dateinamen vor.
- **Neues Projekt**: ein oder mehrere Videos wählen. Mehrere werden hintereinandergehängt und gemeinsam transkribiert; weitere lassen sich später mit „＋ Video anhängen“ ergänzen.
- **Text**: Wörter anklicken/antippen oder mit gedrückter Maustaste bzw. nach kurzem Gedrückthalten mit dem Finger über mehrere Wörter ziehen, dann löschen. Markierten Text an eine andere Stelle ziehen verschiebt den Abschnitt. Suchen (`Strg+F`) und Ersetzen (`Strg+H`), Doppelklick korrigiert ein Wort.
- **Aufräumen**: „Füllwörter weg“, „Wiederholungen weg“ (wiederholte Anläufe – der letzte Versuch bleibt stehen) und „Pausen kürzen auf …“ bis „ganz weg“ – auf Wunsch automatisch direkt nach der Transkription. Wird Text gelöscht, verschwinden Pausen, die danach leer stehen bleiben würden, gleich mit (z. B. am Videoanfang).
- **Saubere Schnitte**: Bei der Transkription wird zusätzlich der Lautstärkeverlauf gespeichert und das Transkript daran ausgerichtet: Wiederholte Anläufe („ich wollte – ich wollte heute …“) bekommen je ihren eigenen Sprachabschnitt, und Sprache, zu der Whisper kein Wort geliefert hat (ausgelassene Anläufe), erscheint im Text als **🗣**-Eintrag, den du anhören und löschen kannst. Jede Schnittkante wird an die Grenzen der Sprachabschnitte gelegt. „▶ Letzten Schnitt anhören“ spielt die Stelle zur Kontrolle ab; im Studio zeigt ein Lautstärkeband unter den Clips, wo gesprochen wird.
- **Studio**: dunkles Bearbeitungsfeld mit Werkzeugleiste und Spurköpfen (Video · B-Roll/PiP · Zoom/Effekte · Titel · Untertitel). Teilen, trimmen, Clips per Ziehen umsortieren (mit Einrasten an Kanten und Zeiger), B-Roll, Einschub, Bild-im-Bild, Fotos, Zoom-Sprünge und -Fahrten, **Titel** (frei im Bild platzierbar, Größe/Farbe/Hintergrund) und **Anpassen** pro Clip: Tempo 0,5–3×, Lautstärke, Helligkeit, Kontrast, Sättigung, Schwarzweiß – alles in der Vorschau sichtbar und in Video-, CapCut- und Concat-Export enthalten (Farbanpassungen nur im Video-Export). Rechtsklick öffnet die Werkzeuge des Clips. Der Zeiger läuft am Desktop über die Spur und springt am Rand weiter („⇥“ schaltet auf den festen Zeiger in der Mitte um, wie am Handy).
- **Lage, Größe, Keyframes**: Jedes Medium lässt sich im Bild frei verschieben, vergrößern und zuschneiden – auch das Hauptbild. Mit Keyframes (Taste `M`) bewegt es sich über die Zeit (Hauptspur, B-Roll und Bild-im-Bild); Rauten auf dem Clip zeigen sie an.
- **Freistellen (Greenscreen)**: In „Anpassen“ (Hauptspur) oder im Clip-Blatt (Einblendung) eine oder mehrere Schlüsselfarben wählen – in einer bildschirmfüllenden Ansicht mit Lupe und Zwei-Finger-Zoom, auch Weiß, Grau oder Schwarz – mit Toleranz, weichem Rand und Farbsaum-Korrektur. **Hintergrund automatisch erkennen** kommt ohne Greenscreen aus: Die Person wird erkannt (Windows: Robust Video Matting, Android: ML Kit, Browser: MediaPipe), alles andere ersetzt. Für ein Bild als Hintergrund: Foto auf Spur 1, das freigestellte Video als Vollbild-Einblendung darüber. Vorschau, Video-Export und alle Plattformen rechnen mit derselben Formel (wie ffmpeg „chromakey“).
- **Wasserzeichen**: Studio → „+ Clip“ → „Wasserzeichen“: ein Logo (am besten PNG mit durchsichtigem Hintergrund) liegt über das ganze Video – Ecke, Größe, Randabstand und Deckkraft einstellbar, ohne eigene Spur, in jedem Export und in allen daraus erstellten Clips.
- **Übersetzung der Untertitel**: Reiter „Untertitel“ → „Übersetzung erzeugen“ (zunächst Englisch). Erscheint unter dem Original oder statt des Originals und lässt sich je Untertitel nachbessern. Windows: OPUS-MT im Installer, Android: ML Kit (Sprachpaket wird einmal geladen), Browser: eingebaute Übersetzung von Chrome/Edge.
- **Leinwand** (Studio → „▭ Leinwand“): Seitenverhältnis für das ganze Video (9:16, 4:5, 1:1, 16:9, 4:3). Die Bühne zeigt dabei das ganze Ausgangsbild mit der Leinwand als hellem Rahmen – ziehen verschiebt den Ausschnitt, die Ecken ändern die Größe. Gilt für alle Schnitte auf einmal.
- **Übersetzung von außen**: „Text exportieren“ gibt einen Satz pro Zeile aus (Zwischenablage und Textdatei); „Übersetzung einfügen …“ nimmt die fertige Übersetzung wieder auf – Zeile für Zeile, sonst Satz für Satz, sonst nach Länge verteilt; SRT-Dateien gehen auch. Bei „1 Wort pro Untertitel“ springt die Übersetzung mit jedem Wort des Originals mit: Hat sie weniger Wörter, bleibt ein Wort stehen, hat sie mehr, erscheinen zwei.
- **Stil der Übersetzung**: eigene Schrift, Farbe, Größe, Umrandung, Kasten und Lage (unter/über dem Original).
- **Lautstärke vereinheitlichen** (Export, standardmäßig an): Sprache aller Clips auf dieselbe Lautheit, das Ganze auf etwa −14 LUFS; Musik und B-Roll behalten ihr Verhältnis.
- **Nur Ton**: Von einem importierten Video lässt sich auch nur die Tonspur auf eine Tonspur legen (Ablage → ♪ „Nur den Ton“, oder das Video auf „Ton 1“ ziehen).
- **Fenster**: Text, Untertitel, Studio und Export sind eigene Reiter; am Desktop lässt sich jeder mit ⧉ in ein eigenes Fenster abdocken (z. B. für einen zweiten Bildschirm). Alle Fenster bleiben synchron. Ein neues Fenster übernimmt Stand und Abspielstelle der vorhandenen; Formatwechsel und Lautstärken werden mit abgeglichen.
- **Abspiellinie**: Sie bleibt beim Bearbeiten auf demselben Bild – beim Abspielen wie im Stand. Wird davor etwas geschnitten, verschiebt sich nur die Zeitanzeige; fällt die Stelle selbst weg, geht es an der nächsten behaltenen weiter. „Rückgängig“ umfasst auch Format, Bildausschnitt und die Lautstärke der Hauptvideos.
- **Untertitel**: Aufteilung in Zeilen oder ein Wort pro Untertitel, Text bearbeiten, Stil wählen. **Direkt im Bild ziehen**, um sie zu platzieren – alle gemeinsam oder (im Studio ausgewählt) einzeln.
- Tastenkürzel wie in CapCut (`⌨` in der Kopfzeile zeigt alle): `Leertaste`, `←/→` bildweise, `Strg+B` teilen, `Q/W` links/rechts löschen, `Entf`, `Strg+Z`.

## Daten, Sicherungen, Aufräumen (Windows)

Alles liegt in `%LOCALAPPDATA%\Textschnitt`: `projects\` (ein Projekt je Datei), `sicherungen\`, `cache\` (Vorschaubilder, Vorschau-Dateien), `folien\`, `freigestellt\`, dazu das Protokoll `textschnitt.log`.

- **Speichern**: Ein Projektstand wird erst vollständig auf den Datenträger geschrieben und ersetzt dann die bisherige Datei – ein Absturz oder Stromausfall mitten im Speichern lässt die letzte gute Fassung stehen. Kommt ein Stand unvollständig an, wird er abgewiesen. Klappt das Speichern nicht (Datenträger voll, Ordner gesperrt), steht in der Kopfzeile ein rotes „!“ mit dem Grund, und HoneyCut versucht es von selbst weiter.
- **Frühere Fassungen**: Höchstens alle 15 Minuten wandert die vorige Fassung eines Projekts gepackt nach `sicherungen\<Projekt>\` (die letzten sechs bleiben). Die Uhr in der Projektliste zeigt sie mit Datum, Länge und Zahl der Schnitte: „Als Kopie öffnen“ legt ein eigenes Projekt an, „Zurückholen“ setzt das Projekt auf diesen Stand und legt den bisherigen selbst als Fassung zurück. Ist eine Projektdatei einmal unlesbar, nimmt HoneyCut beim Öffnen von selbst die jüngste lesbare Fassung; die defekte Datei bleibt als `.defekt` daneben liegen.
- **Papierkorb**: Gelöschte Projekte bleiben 30 Tage erhalten. „Papierkorb“ unter der Projektliste oder in den Einstellungen stellt sie mit einem Klick wieder her oder löscht sie endgültig.
- **Speicher** (Einstellungen → Speicher): zeigt, was HoneyCut belegt – Vorschaubilder, Vorschau-Dateien, freigestellte Kopien, Folienbilder, nachgeladene Modelle, Fassungen, Projektdateien – und gibt gezielt frei, was kein Projekt, keine frühere Fassung und kein Projekt im Papierkorb mehr verwendet. Bei freigestellten Kopien und Folienbildern fragt HoneyCut nach: Ein früher exportiertes CapCut- oder Concat-Projekt kann noch darauf zugreifen.
- **Alle Projekte sichern** (Einstellungen): eine ZIP-Datei mit allen Projekten, ihren Folienbildern, den importierten Schriften, eigenen Designprofilen und Farbfavoriten, ohne die Videos. „Sicherung einspielen“ holt daraus zurück, was fehlt. Liegt ein Projekt hier schon vor, bleibt der neuere Stand stehen und der andere liegt bei den früheren Fassungen. Auf einem anderen Rechner passen sich die Pfade der Folienbilder und Schriften an den neuen Datenordner an.
- **Aufräumen**: Beim Start räumt HoneyCut im Hintergrund auf – Vorschaubilder, die 30 Tage nicht gebraucht wurden (insgesamt höchstens 1,5 GB), liegengebliebene Teilstücke abgebrochener Vorgänge, Vorschau-Dateien, auf die kein Projekt mehr verweist, und ein Protokoll über 5 MB. Eigene Videos, Exporte, Folienbilder und freigestellte Kopien werden dabei nie angefasst.
- **Protokoll und Fehlerbericht**: `textschnitt.log` enthält auch Meldungen der Oberfläche (unerwartete Fehler, hängende Wiedergabe mit dem Zustand des Videos). „Fehlerbericht“ in den Einstellungen speichert das Protokoll zusammen mit Version, System und Speicherübersicht als eine Textdatei – mit Datei- und Projektnamen, ohne Videos, Transkripte oder Texte.
- **Neue Versionen** (Windows-App): HoneyCut sieht höchstens einmal am Tag bei GitHub nach, ob ein neuerer Installer bereitsteht, und zeigt dann auf der Startseite einen Hinweis mit den Änderungen in Stichpunkten. Abgerufen werden nur die Liste der Veröffentlichungen und `NEUIGKEITEN.md`; in den Einstellungen lässt sich das abschalten.

## Exporte

| Format | Windows | Android |
|---|---|---|
| Video (MP4, Originalauflösung, Untertitel eingebrannt) | ✓ Ordner `…_textschnitt` neben dem ersten Video | ✓ direkt in die Galerie (Ordner „Textschnitt“) |
| Audio (WAV, MP3, M4A, FLAC) | ✓ | ✓ M4A (Ordner „Musik/HoneyCut“) |
| CapCut-Entwurf (Schnitte, Clips, Bild-im-Bild, Zooms, Untertitel an ihrer Position) | ✓ | – |
| Concat-Projekt (`Desktop\Concat`) | ✓ | – |
| SRT-Untertitel | ✓ zu jedem Export | – |

Im Browser: Video (MP4) und Audio (WAV, MP3, M4A, FLAC) samt SRT als Download.

Weiche Zoomfahrten werden in CapCut und Concat als Zoom-Sprung angelegt; Freistellen (Greenscreen) ist nur im Video-Export enthalten. HDR-Videos vom Handy werden beim Video-Export nach SDR umgerechnet.

## Entwickeln

- Windows/macOS/Linux ohne Installer: `pip install -r requirements.txt`, ffmpeg in den PATH, dann `python textschnitt.py` (Browser) oder `pythonw textschnitt_app.pyw` (Fenster).
- Builds laufen über GitHub Actions: Änderungen an `core/` bauen beide Plattformen neu. Versionen: `packaging/app-version.txt` (Windows), `android/version.txt` (Android).
- **Neuigkeiten**: `NEUIGKEITEN.md` nennt je Version die Änderungen in Stichpunkten („## 2.26.0 · Titel“, darunter eine Liste). Die Windows-App zeigt daraus, was seit der installierten Version dazugekommen ist.
- **Prüfläufe**: `tests/lauf.sh` erzeugt Testmedien, startet das echte Backend mit einer nachgestellten Transkription und prüft in Chrome die Bedienung – Bearbeiten beim Abspielen und im Stand, Rückgängig, mehrere Fenster, Speicherfehler, Umbenennen, Fassungen, Papierkorb, Speicher, Sicherung, Versionshinweis – dazu das Backend ohne Browser. Mit `HC_BASIS=<Git-Angabe>` kommt der Vergleich mit einer früheren Fassung dazu: Exportplan, Bedienschritte und echte Exporte sollen gleich bleiben. Auf GitHub läuft das bei jeder Änderung an `core/`, `textschnitt.py` oder `tests/` mit (`.github/workflows/test.yml`); Einzelheiten in `tests/README.md`.
