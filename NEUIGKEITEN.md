# Neuigkeiten

Was sich mit jeder Version von HoneyCut ändert. Die Windows-App zeigt diese Stichpunkte an, sobald eine neuere Version bereitsteht.

## 2.37.0 · Am Handy weiterschneiden
- Ans Handy übergeben (Windows → Android-App): Im Export-Reiter, im Menü der Projektliste oder über „Handy“ auf der Startseite zeigt HoneyCut einen QR-Code. Mit der Kamera des Handys scannen, auf der Seite „In HoneyCut öffnen“ antippen – das Projekt landet samt Videos, Bildern und Schriften in der App. Computer und Handy müssen im selben WLAN sein
- Und zurück: Am Handy „An den Computer zurückgeben“ wählen, am Computer „Übernehmen“. In der Regel geht nur der Schnitt zurück; die Videos hat der Computer schon
- Ohne Kamera: Am Handy unter „Computer“ lässt sich die Adresse eintippen, die am Computer unter dem QR-Code steht
- Die Verbindung besteht nur, solange das Fenster am Computer offen ist, und nur für dieses eine Projekt. Sie läuft unverschlüsselt im eigenen WLAN – für fremde Netze (Hotel, Veranstaltung) bleibt „Projekt exportieren“ der richtige Weg
- Fragt Windows beim ersten Mal nach dem Netzwerkzugriff, bitte für private Netzwerke erlauben

## 2.36.0 · Bildgestaltung
- Farbe für das ganze Video (Studio → „Farbe“): Helligkeit, Kontrast, Sättigung, Farbtemperatur und Tönung gelten für alle Abschnitte; was unter „Anpassen“ an einem einzelnen Abschnitt steht, kommt hinzu. Gehört zum Hausstil
- Weißabgleich: „Weiß im Bild wählen“ macht eine angetippte weiße oder graue Stelle farbneutral; „An den Clip davor angleichen“ bringt Farbe und Helligkeit zweier Aufnahmen zusammen
- Farb-Vorlagen: Neutral, Warm, Kühl, Kräftig, Matt und Schwarzweiß, dazu eigene unter einem Namen – sie stehen in jedem Projekt bereit und reisen mit der Sicherung
- Zoom-Schnitte (Studio → „Zoom-Schnitte“): Jeder zweite Abschnitt zwischen zwei Schnitten rückt leicht näher, in drei Stärken. Sprünge im Bild wirken dadurch wie ein gewollter Wechsel der Einstellung
- Standbild (Studio → „Standbild“): Das Bild an der Abspiellinie bleibt zwei Sekunden stehen, etwa für eine Einblendung; die Dauer lässt sich am Rand ziehen
- Tempo-Verlauf („Anpassen“ → „Tempo-Verlauf: am Ende“): Das Tempo eines Abschnitts steigt oder fällt in feinen Stufen vom Anfangs- zum Endwert
- Hintergründe fürs Freistellen: hinter der freigestellten Person eine Farbe, ein Verlauf, ein eigenes Bild oder – nach „Hintergrund automatisch erkennen“ – ein weichgezeichnetes Standbild der Aufnahme. Der Hintergrund füllt die ganze Fläche, auch um ein verkleinertes Hauptbild herum
- Bild beruhigen (Windows, „Anpassen“ → „Verwackeln ausgleichen“): gleicht Wackeln aus der Hand in drei Stärken aus. Es entsteht einmalig eine Kopie der Aufnahme; Transkript und Schnitt bleiben, „Original zurück“ nimmt es zurück. „Speicher verwalten“ führt die Kopien als eigene Gruppe
- Farbe, Weißabgleich und Hintergründe gelten in der Vorschau und im Video-Export unter Windows, Android und im Browser. CapCut- und Concat-Projekte übernehmen Zoom-Schnitte, Standbild und die Stufen des Tempo-Verlaufs
- Behoben: Im Windows-Export wirkte die Farbanpassung vor dem Freistellen – mit „Schwarzweiß“ oder starker Sättigung ging der Greenscreen dort verloren. Rückgängig zeichnet die Vorschau nach einer Farbänderung sofort neu. Die Zeitleiste fragt kein Vorschaubild hinter dem letzten Bild einer Aufnahme mehr an

## 2.35.0 · Belege im Bild
- Formen und Pfeile: Rahmen, Kreis, Pfeil und Textmarker über dem Bild – im Bild verschieben, an der Ecke in der Größe ändern, mit Keyframes (Taste M) über die Zeit bewegen
- Unkenntlich machen: Gesichter, Kennzeichen oder Namen verpixeln, weichzeichnen oder abdecken, als Ellipse oder Rechteck. Mit Keyframes folgt der Bereich dem, was er verdeckt. Wechselt das Format oder der Bildausschnitt – auch bei Clips im Hochformat und im Export-Paket –, bleibt er auf derselben Stelle des Bilds
- Markieren im Screenshot: in einem eingefügten Artikel oder Beitrag Stellen farbig hinterlegen, den Rest abdunkeln und langsam darauf zufahren
- Folien bauen sich Schritt für Schritt auf: Stichpunkte erscheinen nacheinander, passend zum gesprochenen Satz; mit HoneyDeck 1.3.0 auch Ablauf, Zeitstrahl, Piktogramme, Richtig/Falsch, Kennzahlen und Balken. Die Zeiten lassen sich im Studio verschieben, N schaltet zum nächsten Schritt
- Fortschrittsbalken: eine dünne Leiste am Bildrand zeigt, wie weit das Video ist – in der Akzentfarbe des Designs oder einer eigenen Farbe; gehört zum Hausstil
- Formen, Bereiche und Balken gelten in der Vorschau und im Video-Export unter Windows, Android und im Browser. CapCut- und Concat-Projekte übernehmen Formen und abgedeckte Flächen als Bilder; Verpixeln und Weichzeichnen stecken nur im Export „Video“, und HoneyCut fragt vor einem Projekt-Export nach
- Behoben: Einblendungen mit Keyframes saßen im Windows-Export bis zu zwei Pixel versetzt. Lag ein Keyframe hinter dem Ende eines Elements, bewegte es sich im Export anders als in der Vorschau. Android: Der Export brach ab, wenn die Mitte einer frei liegenden Einblendung außerhalb des Bilds lag (große Screenshots, herangefahrene Bilder)
- Zeitleiste: Am ausgewählten Element liegen die Griffe zum Kürzen über den Keyframe-Marken

## 2.34.0 · Ton
- Musik weicht der Sprache: Tonspuren werden leiser, sobald gesprochen wird, und kommen in Pausen ab zwei Sekunden zurück. Ein Schalter je Projekt unter „Lautstärke“, in drei Stärken; einzelne Tonspuren lassen sich ausnehmen oder selbst als Sprache einstellen
- Stimme aufbereiten: ein Schalter gegen Brummen, Rauschen und Raumhall, der zugleich leise und laute Stellen angleicht – zu hören in der Vorschau und im Export, gerechnet auf dem eigenen Gerät
- Übergänge: an jedem Schnitt der Hauptspur eine weiche Blende oder ein versetzter Bildwechsel – das Bild wechselt vor dem Ton (L-Schnitt) oder nach ihm (J-Schnitt). „Übergang“ in der Zeitleiste öffnet die Auswahl am nächsten Schnitt; der Ton wechselt weiter am Schnitt
- Die kurze Ton-Blende an jedem Schnitt gibt es jetzt auch im Android-Export
- Alles gilt in der Vorschau und in den Exporten Video und Audio unter Windows, Android und im Browser; die beiden Schalter zum Ton gehören zum Hausstil

## 2.33.0 · Clips in Serie
- Abschnitte vormerken: im Text markieren und „Vormerken“ wählen (Taste V, am Handy im Clip-Dialog). Aus der Liste wird mit einem Klick eine Clip-Reihe – je Abschnitt ein eigener Clip –, und „Alle exportieren“ reiht die ganze Reihe in die Warteschlange ein
- Zusammenschnitt: alle vorgemerkten Abschnitte in einem Clip, als „Best of“ in der Reihenfolge des Videos
- Clip-Vorschläge: HoneyCut sucht in sich geschlossene Abschnitte von 20 bis 90 Sekunden heraus – nach Absätzen, Fragen, Zahlen und eigenen Schlagwörtern, zum Anhören und Übernehmen. Die Vorauswahl folgt festen Regeln und kommt ohne Online-Dienst aus
- Hook-Varianten: bis zu drei Einstiegstitel hinterlegen; der Export erzeugt je Variante eine Datei zum Testen
- „Teil 1/3“: Clips einer Reihe tragen ihre Nummer im Bild, im Design deiner Folien. Ecke, Bezeichnung, Größe und Dauer gelten für die ganze Reihe und gehören zum Hausstil
- Suche über alle Projekte: Die Suchzeile der Projektliste findet auch, was in den Videos gesagt wird – mit Sprung zur Stelle und „Als Clip“
- Behoben: Nach dem Neuladen blieb die Zeitleiste leer, bis man den Reiter wechselte. Betonte Wörter verrutschten bei „Am Ton ausrichten“

## 2.32.0 · Untertitel
- Laufende Wort-Hervorhebung: Das gerade gesprochene Wort bekommt in den Zeilen-Untertiteln eine eigene Farbe
- Animationen: Einblenden, Aufpoppen oder Wort für Wort aufbauen
- Schlagwörter betonen: Wörter im Text markieren und „Betonen“ wählen, oder alle Begriffe aus dem Wörterbuch farbig setzen
- Emojis und Symbole: per Klick über einen Untertitel setzen; eine eigene Zuordnung von Wort zu Symbol schlägt passende vor
- Alles gilt in der Vorschau und im Video-Export unter Windows, Android und im Browser; SRT, CapCut und Concat bleiben schlichter Text

## 2.31.0 · Export
- Export-Paket: Ein Klick erzeugt Hochformat (TikTok, Reels, Shorts), Querformat (YouTube) und auf Wunsch den Feed in 4:5 – je mit passender Auflösung, einheitlicher Lautstärke und eigenem Dateinamen, dazu Titelbild und SRT
- Export-Warteschlange: Exporte einreihen und im Hintergrund rechnen lassen, während du am nächsten Video schneidest; der Zähler in der Kopfzeile zeigt den Stand, auch auf der Startseite
- Windows: Export über die Grafikkarte (Nvidia, Intel, AMD), je nach Rechner mehrfach schneller. Kommt die Grafikkarte bei einem Export nicht durch, rechnet HoneyCut ihn von selbst auf dem bisherigen Weg
- Öffnest du ein anderes Projekt, steht im Export-Reiter kein Ergebnis des vorigen Projekts mehr

## 2.30.0 · Hausstil und Bausteine
- Hausstil als Vorlage: Untertitel-Stil, Wasserzeichen, Format, Schutzzonen, Lautstärke, Textzeile, Bauchbinden, Designprofil und Aufräum-Optionen unter einem Namen speichern. Mit dem Stern starten neue Projekte in diesem Stil; mehrere Vorlagen sind möglich
- Bausteine: Intro, „Folgen“-Aufruf oder Spendenhinweis einmal ablegen und mit einem Klick vorn oder hinten anfügen
- Endkarte: Schlussbild mit Aufruf und Kanalnamen im Designprofil der Folien, im Format des Projekts
- Splitscreen für Reaktionen: Eine Einblendung füllt mit einem Klick die obere, untere, linke oder rechte Bildhälfte, das Hauptvideo die andere
- Bild-im-Bild mit Rahmen und Namensschild
- Alles zusammen liegt hinter dem Paletten-Symbol in der Kopfzeile, im Projekt und auf der Startseite

## 2.29.0 · Transkript
- Eigenes Wörterbuch: Namen und Fachbegriffe hinterlegen. Whisper bekommt sie als Hinweis, und bekannte Fehlschreibungen ersetzt HoneyCut nach jeder Transkription von selbst
- Beim Korrigieren eines Worts merkt sich „Künftig immer so schreiben“ die Korrektur im Wörterbuch und wendet sie gleich im ganzen Text an
- Unsichere Wörter der Reihe nach prüfen (Taste P): Die Stelle spielt ab, Enter bestätigt oder übernimmt die Korrektur, Tab überspringt
- Fassungen vergleichen: wiederholte Anläufe nacheinander anhören und wählen, welche Fassung bleibt. Bisher blieb stets die letzte stehen
- Prüfliste nach dem Aufräumen: jeder Schnitt von „Füllwörter weg“, „Wiederholungen weg“ und „Pausen kürzen“ zum Anhören, einzeln zurückzunehmen
- Hörprobe: Weggeschnittene Stellen lassen sich aus der Aufnahme anhören, der Schnitt bleibt dabei unberührt
- Windows: Der Installer entfernt einen alten Programmordner „Textschnitt“ und richtet Verknüpfungen, die noch dorthin zeigen, auf die neue Fassung aus. Projekte und Einstellungen bleiben, wo sie sind

## 2.28.0 · Quellen und Belege
- Quellen zu Aussagen (Taste R): Medium, Titel, Datum und Link hinterlegen; im Bild steht für die Dauer des Satzes eine dezente Quellenzeile, die Quellenliste lässt sich für die Beschreibung kopieren
- „Beleg nötig“ (Umschalt+R): offene Stellen markieren; der Export fragt nach, solange Belege fehlen
- Bauchbinden mit Name und Funktion im eigenen Design, für zugeordnete Personen von selbst beim ersten Auftritt
- Prüfung auf Barrierefreiheit: Hinweis bei fehlenden, zu kleinen oder kontrastarmen Untertiteln, je mit Knopf zum Beheben
- Textfassung des Videos als Textdatei neben dem Export, mit Kapiteln, Sprecher:innen und Quellen
- Zeitleiste im Text-Reiter: Schnitte gleich dort nachziehen, teilen und kürzen; die Wörter stehen unter der Hauptspur
- Windows: Untertitel, Titel und Textzeile stehen im Video so groß und so umbrochen wie in der Vorschau. Gewählte Schriften kamen bisher deutlich kleiner an (Poppins auf 57 % der eingestellten Größe), und lange Zeilen liefen im Hochformat aus dem Bild
- Windows: Lässt sich eine gewählte Schrift nicht laden, sagt der Export es dazu; bisher stand dann stillschweigend die Standardschrift im Video
- Windows: Bei eingebrannten Untertiteln heißt die SRT-Datei „Untertitel – Name.srt“. Abspielprogramme wie VLC blenden eine gleichnamige SRT-Datei von selbst ein, die Untertitel standen dann doppelt im Bild

## 2.27.0 · Kleine Helfer
- Projektliste mit Suche, Reihenfolge nach Datum, Namen oder Länge, Vorschaubild und „Duplizieren“
- Kapitel im Text setzen (Taste C): fertige Zeitstempel für die YouTube-Beschreibung, die dem Schnitt folgen
- Notizen an jede Stelle heften (Taste B), mit Aufgabenliste je Projekt
- Schutzzonen für TikTok, Reels und Shorts: Untertitel und Titel rasten in der freien Fläche ein
- Dauerhafte Textzeile über das ganze Video, etwa Kanalname oder „V. i. S. d. P.“
- Titelbild speichern: das Bild an der Abspiellinie als PNG oder JPG, auf Wunsch mit Titelzeile
- Eigene Füllwörter für „Füllwörter weg“, je Projekt abschaltbar
- Taste A wählt den ganzen Satz, dann den Absatz; „Nur das“ behält allein die Markierung
- Lesbarkeits-Prüfung der Untertitel mit „Neu umbrechen“
- Eigene Untertitel-Looks speichern und im Projektpaket weitergeben
- Längen-Ampel für Shorts, Reels und TikTok
- Über vierzig Sprachen in der Sprachauswahl, darunter Türkisch, Arabisch, Russisch, Polnisch und Ukrainisch
- Titel und Textzeile bleiben im Video, auch wenn „Untertitel einbrennen“ aus ist; die SRT-Datei enthält nur die Untertitel

## 2.26.1 · Projekt weitergeben
- „Projekt weitergeben“ läuft auch, wenn ein Bild direkt im Projekt steckt, etwa ein Folienbild aus HoneyDeck. Unter Windows brach es bisher mit „path too long“ ab
- Das Wasserzeichen kommt im Projektpaket mit
- Ein Projekt mit eingebetteten Bildern gibt beim Öffnen alle seine Dateien für die Vorschau frei

## 2.26.0 · Projekte, Sicherheit, Speicher
- Projekte umbenennen: mit dem Stift in der Projektliste oder per Klick auf den Namen im offenen Projekt
- Frühere Fassungen eines Projekts ansehen, als Kopie öffnen oder zurückholen (Uhr in der Projektliste)
- Papierkorb: gelöschte Projekte 30 Tage lang mit einem Klick wiederherstellen
- Speicher verwalten: sehen, was wie viel Platz belegt, und Unbenutztes gezielt freigeben
- Alle Projekte in eine Datei sichern und wieder einspielen, ohne die Videos
- Fehlerbericht per Knopf: Protokoll und Systemangaben als eine Datei
- Hinweis auf neue Versionen mit den Änderungen in Stichpunkten, abschaltbar
- „Projekt weitergeben“ öffnet in der Windows-App den Speichern-Dialog; die Medienablage nimmt mehrere Dateien auf einmal

## 2.25.0 · Grundüberholung
- Zeitleiste und Wiedergabe laufen deutlich flüssiger, auch bei langen Projekten
- Sicheres Speichern mit früheren Fassungen im Hintergrund
- Die Abspiellinie bleibt beim Bearbeiten auf demselben Bild
- „Rückgängig“ umfasst auch Format, Bildausschnitt und Lautstärke der Hauptvideos
