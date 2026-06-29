#!/bin/bash
# OpenFront launcher (macOS / Linux) — LAN multiplayer.
# Double-click in Finder to run (you may need to `chmod +x Play-OpenFront.command` once).
# Keep the Terminal window open while playing; close it to stop the game.
#
# This hosts a game on your local network: friends on the same Wi-Fi/network can
# play by opening the http://<your-ip>:9000 address printed below in a browser.

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

echo "Starting OpenFront in LAN mode."
echo "Keep this window open while playing; close it to stop."
echo "Share the http://<your-ip>:9000 address shown below with friends."
# `npm run lan` binds to the local network, prints the shareable address, and
# opens the browser once the server is ready.
npm run lan
