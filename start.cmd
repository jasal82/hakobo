@echo off
rem Copyright (C) 2026 Johannes Asal
rem SPDX-License-Identifier: AGPL-3.0-or-later
rem Lizenz und Gewaehrleistungsausschluss: siehe LICENSE im Projektordner.
rem Startet Hakobo. Baut die Anwendung beim ersten Aufruf.
setlocal
cd /d "%~dp0"
if not exist dist\Hakobo.exe (
  call build.cmd || exit /b 1
)
start "Hakobo" dist\Hakobo.exe
