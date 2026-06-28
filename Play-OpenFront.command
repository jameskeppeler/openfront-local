#!/bin/bash
# OpenFront launcher (macOS / Linux).
# Double-click in Finder to run (you may need to `chmod +x Play-OpenFront.command` once).
# Keep the Terminal window open while playing; close it to stop the game.

# Run from this script's own folder, so it works wherever the repo is cloned.
cd "$(dirname "$0")" || exit 1

# First run: install dependencies if missing.
if [ ! -d node_modules ]; then
  echo "First run: installing dependencies. This can take a few minutes..."
  npm run inst
fi

# If the game is already running, just open the browser.
if curl -sf http://localhost:9000 >/dev/null 2>&1; then
  echo "OpenFront is already running. Opening browser..."
  open http://localhost:9000 2>/dev/null || xdg-open http://localhost:9000
  exit 0
fi

# Open the browser as soon as the server is ready (in the background).
(
  for i in $(seq 1 120); do
    if curl -sf http://localhost:9000 >/dev/null 2>&1; then
      open http://localhost:9000 2>/dev/null || xdg-open http://localhost:9000
      break
    fi
    sleep 1
  done
) &

echo "Starting OpenFront. Keep this window open while playing; close it to stop."
npm run dev
