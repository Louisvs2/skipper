# Skipper: BPM-Effekte für Premiere Pro

Skipper schneidet einen Clip im Takt deines Songs neu zusammen: Stotter, Scratch, Rückwärts, Half-Speed, Shuffle, plus ein rhythmisches An/Aus (Gate). Das Tempo erkennt Skipper selbst.

## Installation (Mac)

```bash
git clone -b claude/zen-maxwell-2j3i4h https://github.com/Louisvs2/skipper.git ~/skipper && bash ~/skipper/install-mac.sh
```

Danach Premiere Pro neu starten und das Panel unter **Fenster → Erweiterungen → Skipper** öffnen.

## Bedienung in 4 Schritten

1. **Clip markieren**: den Videoclip in der Timeline anklicken. Der Song liegt auf einer Audiospur darunter.
2. **Erkennen** klicken: BPM und Downbeat (die „1“ im Takt) werden automatisch eingetragen.
3. **Time slot** und **Gate slot** wählen:
   - *Time slot* bestimmt, wie das Bild springt, stottert oder rückwärts läuft, z. B. „Baby scratch 2 and 4“.
   - *Gate slot* bestimmt, wann das Bild im Takt ausgeht, z. B. „Eighth chop“.
4. **Apply** klicken.

**Time mix** steuert, in wie vielen Takten das Muster wirkt (50 % = jeder zweite). **Gate mix** steuert, wie stark das Gate abdunkelt.

Gefällt dir das Ergebnis nicht, stellst du einfach um und klickst noch einmal auf **Apply**. **Reset** stellt den Originalclip wieder her.

## Gut zu wissen

- **Erkennung danebengelegen?** BPM von Hand eintragen. Den Playhead auf eine „1“ im Song setzen und **⌖** klicken.
- Wird der falsche Song erkannt, markiere den Song-Clip zusätzlich mit (Shift-Klick).
- Das Original bleibt erhalten und wird nur deaktiviert. Die neuen Stücke liegen auf der Spur darüber und heißen `[skipper] …`.
- Unter **Mehr Einstellungen** findest du Link slots, Gate target (Bild/Ton), Attack/Release, Frame mode und Jump dissolve. Normalerweise musst du dort nichts ändern.
- Speed, Rückwärts und Überblendungen nutzen eine inoffizielle Premiere-Schnittstelle. Adobe kann sie mit einem Update ändern.

## Entwicklung

```bash
npm test
```

| Datei | Inhalt |
|---|---|
| `index.html`, `css/style.css`, `js/main.js` | Panel |
| `js/bpm.js` | BPM- und Downbeat-Erkennung |
| `js/patterns.js` | Time-/Gate-Muster und Schnittberechnung |
| `jsx/host.jsx` | Timeline-Bearbeitung in Premiere (ExtendScript) |
