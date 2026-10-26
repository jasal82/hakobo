@echo off
rem Startet Sqizzo. Baut die Anwendung beim ersten Aufruf.
setlocal
cd /d "%~dp0"
if not exist dist\Sqizzo.exe (
  call build.cmd || exit /b 1
)
start "Sqizzo" dist\Sqizzo.exe
