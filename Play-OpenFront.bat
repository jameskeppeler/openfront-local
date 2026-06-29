@echo off
title OpenFront Launcher (LAN)
REM OpenFront launcher (Windows) - LAN multiplayer.
REM Double-click to host a game on your local network. Friends on the same
REM Wi-Fi/network play by opening the http://<your-ip>:9000 address in a browser.
REM Run from this script's own folder, so it works wherever the repo is cloned.
pushd "%~dp0"

REM --- First run: install dependencies if missing ---
if not exist "node_modules" (
  echo First run: installing dependencies. This can take a few minutes...
  call npm run inst
)

REM --- If the game server is already running, just open the browser ---
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri 'http://localhost:9000' -UseBasicParsing -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  echo OpenFront is already running. Opening browser...
  start "" "http://localhost:9000"
  popd
  exit /b
)

echo Starting OpenFront in LAN mode...
echo (A separate window will open - keep it open while playing, close it to stop.)
echo Share the http://your-ip:9000 address shown in that window with friends.
REM `npm run lan` binds to the local network, prints the shareable address, and
REM opens the browser once the server is ready. The new window inherits this folder.
start "OpenFront LAN Server - close this window to stop the game" cmd /k "npm run lan"

popd
exit /b
