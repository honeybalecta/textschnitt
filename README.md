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

- **Windows**: Installer unter [Releases](https://github.com/honeybalecta/textschnitt/releases) (`Textschnitt-Setup-….exe`). Whisper-Modell „small“ und ffmpeg sind dabei, alles läuft offline.
- **Android**: APK unter Releases (`Textschnitt-Android-….apk`), Android 10 oder neuer.
- **Browser**: https://honeybalecta.github.io/textschnitt/ – ohne Installation. Videos bleiben auf dem Gerät; die Whisper-Modelle tiny und base liefert die Seite selbst aus (einmal geladen, dann im Browser gespeichert); nur das größere Modell small kommt von Hugging Face. Am besten in aktuellem Chrome oder Edge (mit Grafikkarte deutlich schneller); läuft nach dem ersten Besuch auch offline und lässt sich als App installieren.

## Arbeiten

- **Neues Projekt**: ein oder mehrere Videos wählen. Mehrere werden hintereinandergehängt und gemeinsam transkribiert; weitere lassen sich später mit „＋ Video anhängen“ ergänzen.
- **Text**: Wörter anklicken/antippen oder mit gedrückter Maustaste bzw. nach kurzem Gedrückthalten mit dem Finger über mehrere Wörter ziehen, dann löschen. Markierten Text an eine andere Stelle ziehen verschiebt den Abschnitt. Suchen (`Strg+F`) und Ersetzen (`Strg+H`), Doppelklick korrigiert ein Wort.
- **Aufräumen**: „Füllwörter weg“, „Wiederholungen weg“ (wiederholte Anläufe – der letzte Versuch bleibt stehen) und „Pausen kürzen auf …“ bis „ganz weg“ – auf Wunsch automatisch direkt nach der Transkription. Wird Text gelöscht, verschwinden Pausen, die danach leer stehen bleiben würden, gleich mit (z. B. am Videoanfang).
- **Saubere Schnitte**: Bei der Transkription wird zusätzlich der Lautstärkeverlauf gespeichert und das Transkript daran ausgerichtet: Wiederholte Anläufe („ich wollte – ich wollte heute …“) bekommen je ihren eigenen Sprachabschnitt, und Sprache, zu der Whisper kein Wort geliefert hat (ausgelassene Anläufe), erscheint im Text als **🗣**-Eintrag, den du anhören und löschen kannst. Jede Schnittkante wird an die Grenzen der Sprachabschnitte gelegt. „▶ Letzten Schnitt anhören“ spielt die Stelle zur Kontrolle ab; im Studio zeigt ein Lautstärkeband unter den Clips, wo gesprochen wird.
- **Studio**: dunkles Bearbeitungsfeld mit Werkzeugleiste und Spurköpfen (Video · B-Roll/PiP · Zoom/Effekte · Titel · Untertitel). Teilen, trimmen, Clips per Ziehen umsortieren (mit Einrasten an Kanten und Zeiger), B-Roll, Einschub, Bild-im-Bild, Fotos, Zoom-Sprünge und -Fahrten, **Titel** (frei im Bild platzierbar, Größe/Farbe/Hintergrund) und **Anpassen** pro Clip: Tempo 0,5–3×, Lautstärke, Helligkeit, Kontrast, Sättigung, Schwarzweiß – alles in der Vorschau sichtbar und in Video-, CapCut- und Concat-Export enthalten (Farbanpassungen nur im Video-Export). Rechtsklick öffnet die Werkzeuge des Clips. Der Zeiger läuft am Desktop über die Spur und springt am Rand weiter („⇥“ schaltet auf den festen Zeiger in der Mitte um, wie am Handy).
- **Lage, Größe, Keyframes**: Jedes Medium lässt sich im Bild frei verschieben, vergrößern und zuschneiden – auch das Hauptbild. Mit Keyframes (Taste `M`) bewegt es sich über die Zeit (Hauptspur, B-Roll und Bild-im-Bild); Rauten auf dem Clip zeigen sie an.
- **Freistellen (Greenscreen)**: In „Anpassen“ (Hauptspur) oder im Clip-Blatt (Einblendung) eine oder mehrere Schlüsselfarben wählen – in einer bildschirmfüllenden Ansicht mit Lupe und Zwei-Finger-Zoom, auch Weiß, Grau oder Schwarz – mit Toleranz, weichem Rand und Farbsaum-Korrektur. **Hintergrund automatisch erkennen** kommt ohne Greenscreen aus: Die Person wird erkannt (Windows: Robust Video Matting, Android: ML Kit, Browser: MediaPipe), alles andere ersetzt. Für ein Bild als Hintergrund: Foto auf Spur 1, das freigestellte Video als Vollbild-Einblendung darüber. Vorschau, Video-Export und alle Plattformen rechnen mit derselben Formel (wie ffmpeg „chromakey“).
- **Wasserzeichen**: Studio → „+ Clip“ → „Wasserzeichen“: ein Logo (am besten PNG mit durchsichtigem Hintergrund) liegt über das ganze Video – Ecke, Größe, Randabstand und Deckkraft einstellbar, ohne eigene Spur, in jedem Export und in allen daraus erstellten Clips.
- **Übersetzung der Untertitel**: Reiter „Untertitel“ → „Übersetzung erzeugen“ (zunächst Englisch). Erscheint unter dem Original oder statt des Originals und lässt sich je Untertitel nachbessern. Windows: OPUS-MT im Installer, Android: ML Kit (Sprachpaket wird einmal geladen), Browser: eingebaute Übersetzung von Chrome/Edge.
- **Lautstärke vereinheitlichen** (Export, standardmäßig an): Sprache aller Clips auf dieselbe Lautheit, das Ganze auf etwa −14 LUFS; Musik und B-Roll behalten ihr Verhältnis.
- **Nur Ton**: Von einem importierten Video lässt sich auch nur die Tonspur auf eine Tonspur legen (Ablage → ♪ „Nur den Ton“, oder das Video auf „Ton 1“ ziehen).
- **Fenster**: Text, Untertitel, Studio und Export sind eigene Reiter; am Desktop lässt sich jeder mit ⧉ in ein eigenes Fenster abdocken (z. B. für einen zweiten Bildschirm). Alle Fenster bleiben synchron.
- **Untertitel**: Aufteilung in Zeilen oder ein Wort pro Untertitel, Text bearbeiten, Stil wählen. **Direkt im Bild ziehen**, um sie zu platzieren – alle gemeinsam oder (im Studio ausgewählt) einzeln.
- Tastenkürzel wie in CapCut (`⌨` in der Kopfzeile zeigt alle): `Leertaste`, `←/→` bildweise, `Strg+B` teilen, `Q/W` links/rechts löschen, `Entf`, `Strg+Z`.

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
