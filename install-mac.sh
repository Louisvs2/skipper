#!/bin/bash
# Installiert das Skipper-Panel für Premiere Pro auf dem Mac.
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/Library/Application Support/Adobe/CEP/extensions/skipper"

mkdir -p "$DEST"
rsync -a --delete --exclude ".git" --exclude "test" --exclude "node_modules" "$SRC/" "$DEST/"

# Unsignierte Erweiterungen erlauben (CEP 9–12 abdecken)
for v in 9 10 11 12; do
  defaults write "com.adobe.CSXS.$v" PlayerDebugMode 1
done

echo "Skipper installiert nach: $DEST"
echo "Premiere Pro neu starten → Fenster → Erweiterungen → Skipper"
