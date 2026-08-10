@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local-server.ps1"
if errorlevel 1 (
  echo.
  echo Failed to start the local app server.
  pause
)
