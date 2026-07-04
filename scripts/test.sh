#!/bin/bash
# Validation suite: syntax check every JS file, then headless smoke tests.
set -e
cd "$(dirname "$0")/.."

echo "— syntax —"
# renderer/js has a package.json {"type":"module"} so node --check parses ESM there
for f in main/*.js renderer/js/*.js preload.js scripts/smoke.js; do
  node --check "$f"
done
echo "all files parse"
if [ "$(grep -l "const esc =" renderer/js/*.js | wc -l | tr -d ' ')" != "1" ]; then
  echo "FAIL: esc() must exist exactly once (shared.js)"; exit 1
fi

echo "— smoke (inside the real app) —"
# The bundle shim always boots Sparky, so the smoke suite rides along via
# --require and exits the process when done. Needs no other instance running.
if pgrep -f "Sparky/node_modules/electron/dist/Electron.app/Contents/MacOS" >/dev/null; then
  echo "NOTE: quitting the running Sparky instance for the test run"
  pkill -f "Sparky/node_modules/electron/dist/Electron.app" || true
  sleep 2
fi
NODE_OPTIONS="--require $(pwd)/scripts/smoke.js" npx electron . 2>&1 | grep -E "^(PASS|FAIL|All smoke|[0-9]+ test)"
