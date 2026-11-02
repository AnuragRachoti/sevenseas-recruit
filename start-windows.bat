@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download the LTS version from https://nodejs.org and run this again.
  pause
  exit /b
)
if not exist .env copy .env.example .env >nul
if not exist node_modules (
  echo Installing for the first time, this takes a minute...
  call npm install
)
start "" http://localhost:3000
node server.js
pause
