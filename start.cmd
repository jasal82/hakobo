@echo off
rem Startet Hakobo. Baut die Anwendung beim ersten Aufruf.
setlocal
cd /d "%~dp0"
if not exist dist\Hakobo.exe (
  call build.cmd || exit /b 1
)
start "Hakobo" dist\Hakobo.exe
