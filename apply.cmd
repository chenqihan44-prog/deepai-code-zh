@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

rem --- self-elevate (writing into Program Files needs admin) ---
net session >nul 2>&1
if errorlevel 1 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

where node >nul 2>&1
if errorlevel 1 (
  echo [x] Node.js 20+ is required: https://nodejs.org/
  pause
  exit /b 1
)

node bin\wizard.mjs
echo.
pause
