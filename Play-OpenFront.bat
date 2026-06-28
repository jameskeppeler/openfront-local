@echo off
title OpenFront Launcher
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

echo Starting the OpenFront dev server...
echo (A separate window will open - keep it open while playing, close it to stop.)
REM The new window inherits this folder as its working directory.
start "OpenFront Server - close this window to stop the game" cmd /k "npm run dev"

echo.
echo Waiting for the game to be ready (first launch can take ~15-30s)...
powershell -NoProfile -Command "for ($i=0; $i -lt 120; $i++) { try { Invoke-WebRequest -Uri 'http://localhost:9000' -UseBasicParsing -TimeoutSec 2 | Out-Null; Write-Host 'Ready!'; exit 0 } catch { Start-Sleep -Seconds 1 } } ; exit 1"

start "" "http://localhost:9000"
popd
exit /b
