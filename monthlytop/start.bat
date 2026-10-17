@echo off
title Monthly Top
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Node.js is not installed on this computer.
  echo 1. Go to https://nodejs.org and install the LTS version.
  echo 2. Close this window and double-click start.bat again.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing, this takes about a minute the first time...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo Install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

if not exist .env copy .env.example .env >nul

echo.
echo Starting the site. Your browser will open in a few seconds.
echo Keep this window open while you use the site. Press Ctrl+C to stop.
echo.
start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000"
node server.js
pause
