@echo off
rem Double-click to start Pack Rush with the bundled server.
cd /d "%~dp0"
title Pack Rush
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org, install it, then run this again.
  start "" https://nodejs.org
  pause
  exit /b 1
)
if not exist keys.txt (
  copy keys.example.txt keys.txt >nul
  echo Created keys.txt. Paste your API keys into it, save, then run this again.
  start "" notepad keys.txt
  pause
  exit /b 0
)
start "" cmd /c "timeout /t 2 >nul & start http://localhost:8787"
echo Pack Rush is running. Keep this window open while you play; close it to stop.
node server\proxy.js
pause
