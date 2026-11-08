@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

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

node bin\patch.mjs restore
echo.
pause
