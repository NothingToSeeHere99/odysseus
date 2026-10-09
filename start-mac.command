#!/bin/sh
# Double-click to start Pack Rush with the bundled server (Mac). On Linux: sh start-mac.command
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Get the LTS version from https://nodejs.org, install it, then run this again."
  open https://nodejs.org 2>/dev/null || xdg-open https://nodejs.org 2>/dev/null
  exit 1
fi
if [ ! -f keys.txt ]; then
  cp keys.example.txt keys.txt
  echo "Created keys.txt. Paste your API keys into it, save, then run this again."
  open -e keys.txt 2>/dev/null || xdg-open keys.txt 2>/dev/null
  exit 0
fi
(sleep 2; open http://localhost:8787 2>/dev/null || xdg-open http://localhost:8787 2>/dev/null) &
echo "Pack Rush is running. Keep this window open while you play; close it to stop."
exec node server/proxy.js
