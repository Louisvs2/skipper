# Skipper: BPM-Effekte für Premiere Pro

Skipper ist ein Panel für Adobe Premiere Pro (Mac). Es schneidet einen Clip im Takt deines Songs neu zusammen: Stotter, Scratch, Rückwärts, Half-Speed, Shuffle, und dazu ein rhythmisches Gate auf Opacity und/oder Lautstärke. Die Idee stammt von FL Studios *Gross Beat*, hier aber fürs Bild.

## Installation (Mac)

```bash
cd skipper
./install-mac.sh
```

Danach Premiere Pro neu starten und das Panel unter **Fenster → Erweiterungen → Skipper** öffnen.

Das Skript kopiert den Ordner nach `~/Library/Application Support/Adobe/CEP/extensions/skipper` und erlaubt unsignierte Erweiterungen (`PlayerDebugMode`).

## Bedienung

1. Songs BPM eintragen. **Downbeat (s)** ist die Sequenzzeit eines Taktanfangs. Am einfachsten setzt du den Playhead auf eine „1“ im Song und klickst auf **⌖**.
2. Den Videoclip in der Timeline markieren. Für das Audio-Gate zusätzlich die gewünschten Audioclips.
3. **Time slot**, **Gate slot** und die übrigen Regler einstellen. Die Vorschau zeigt einen Takt: Die blaue Linie ist die Quellposition, die gelbe Fläche das Gate.
4. Auf **Apply** klicken.

Das Original bleibt erhalten und wird nur **deaktiviert**. Die neuen Stücke landen auf der nächsten freien Videospur darüber und heißen `[skipper] …`.

- **Andere Einstellung ausprobieren**: Original oder ein Skipper-Stück markieren und erneut auf Apply klicken. Die alten Stücke werden ersetzt.
- **Reset**: entfernt alle Skipper-Stücke und aktiviert das Original wieder.

### Regler

| Regler | Wirkung |
|---|---|
| BPM / Downbeat (s) | Beat-Raster |
| Time slot | Zeit-Muster pro Takt: Bypass, 1/16 stutter beat 4, Half-speed beat 4, Previous bar, Downbeat cascade, Glitch shuffle, Ping-pong eighths, Triplet tumble, Baby scratch 2 and 4, Stop-motion build, Bar remix, Half-time boomerang, Rewind and spin-up, Rubber band |
| Gate slot | Open, Eighth chop, Sixteenth chop, Offbeats, Beats 1 and 3, Trance A, Trance B, Fade out bar, Fade in bar, User 1–8 (eigenes 16tel-Raster zum Anklicken) |
| Link slots | wählt automatisch ein passendes Gate zum Time slot |
| Time mix | Anteil der Takte mit Zeit-Muster (50 % = jeder zweite Takt) |
| Gate mix | Tiefe des Gates (100 % = ganz aus, 50 % = halbe Opacity/Lautstärke) |
| Gate target | Video (Opacity), Audio (Volume der markierten Audioclips) oder beides |
| Gate attack / release (frames) | weiche Flanken beim Auf- und Zugehen |
| Frame mode | Frame Sampling / Frame Blending / Optical Flow für Slow-Motion-Stücke |
| Jump dissolve (frames) | Überblendung an Sprungstellen (0 = harter Schnitt) |

## Gut zu wissen

- **Keine Live-Vorschau** wie bei einem nativen Effekt: Nach einer Änderung musst du erneut auf Apply klicken.
- Das Zeit-Muster wirkt **nur aufs Bild**. Lege den Song auf eine eigene Audiospur. Während des Aufbaus sperrt Skipper alle Audiospuren, damit nichts überschrieben wird.
- Bei vielen Stücken (z. B. Stop-motion über 30 s, etwa 240 Stücke) dauert Apply ein paar Sekunden.
- Mit Cmd+Z wird jeder Schritt einzeln zurückgenommen. Schneller geht es mit **Reset**.
- Der Clip sollte mit 100 % Geschwindigkeit in der Timeline liegen.
- Speed, Rückwärts, Frame mode und Überblendungen nutzen Premieres inoffizielle QE-Schnittstelle. Das funktioniert in aktuellen Versionen, Adobe kann es aber ändern. Falls Opacity-Keyframes bei Slow-Motion-Stücken verschoben sitzen, in `jsx/host.jsx` den Wert `SKIPPER_KEYS_SPEED_SCALED` auf `false` setzen.

## Entwicklung

```bash
npm test
```

Die Tests prüfen die Muster-Engine (`js/patterns.js`) und den Ablauf von `jsx/host.jsx` gegen ein nachgebautes Premiere-Modell. Premiere selbst wird dabei nicht gestartet.

Die Konsole des Panels erreichst du per Chrome-Debugging. Dafür eine `.debug`-Datei anlegen, siehe Adobe CEP-Dokumentation.

| Datei | Inhalt |
|---|---|
| `CSXS/manifest.xml` | Panel-Definition für Premiere (PPRO) |
| `index.html`, `css/style.css`, `js/main.js` | Panel-Oberfläche |
| `js/patterns.js` | Muster und Segment-Berechnung |
| `jsx/host.jsx` | Timeline-Bearbeitung in Premiere (ExtendScript) |
