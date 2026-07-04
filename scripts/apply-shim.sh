#!/bin/bash
# Re-applies the launch shim + branding to the Electron bundle so that
# launching it any way (Dock, Spotlight, Finder) boots Sparky directly.
# Run this after `npm install` updates the electron package.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/node_modules/electron/dist/Electron.app"

if [ ! -d "$APP" ]; then
  echo "Electron bundle not found at $APP — run npm install first." >&2
  exit 1
fi

mkdir -p "$APP/Contents/Resources/app"
cat > "$APP/Contents/Resources/app/package.json" <<EOF
{ "name": "sparky", "productName": "Sparky", "main": "index.js" }
EOF
cat > "$APP/Contents/Resources/app/index.js" <<EOF
// Shim: boot Sparky no matter how this bundle is launched.
require('$ROOT/main/main.js');
EOF

plutil -replace CFBundleName -string "Sparky" "$APP/Contents/Info.plist"
plutil -replace CFBundleDisplayName -string "Sparky" "$APP/Contents/Info.plist"

# Orb icon, if the iconset has been generated
if [ -f "$ROOT/assets/icon.png" ]; then
  ICONSET="$(mktemp -d)/Sparky.iconset"
  mkdir -p "$ICONSET"
  for sz in 16 32 64 128 256 512; do
    sips -z $sz $sz "$ROOT/assets/icon.png" --out "$ICONSET/icon_${sz}x${sz}.png" > /dev/null
    dbl=$((sz*2)); sips -z $dbl $dbl "$ROOT/assets/icon.png" --out "$ICONSET/icon_${sz}x${sz}@2x.png" > /dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/electron.icns"
fi

codesign --force --deep -s - "$APP"
echo "Shim applied — the Electron bundle now boots Sparky on any launch."
