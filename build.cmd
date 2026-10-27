@echo off
rem Baut Hakobo (Oberflaeche und Programm) und legt das Ergebnis unter dist\ ab:
rem   dist\Hakobo.exe   App, Server und Kommandozeile in einem Programm
setlocal
cd /d "%~dp0"

if "%HAKOBO_FRONTEND_READY%"=="1" (
  if not exist web\dist\index.html (
    echo HAKOBO_FRONTEND_READY verlangt eine bereits gebaute Oberflaeche ^(web\dist\index.html fehlt^).
    goto :error
  )
  echo [1-2/3] Vorbereitete Oberflaeche verwenden ...
) else (
  echo [1/3] Abhaengigkeiten der Oberflaeche ...
  call npm ci --no-audit --no-fund || goto :error
  echo [2/3] Oberflaeche bauen ...
  call npm run build || goto :error
)

echo [3/3] Programm bauen (Release) ...
cargo build --locked --release --bin hakobo || goto :error

if not exist dist mkdir dist
copy /y target\release\hakobo.exe dist\Hakobo.exe >nul || goto :error

echo.
echo Fertig: dist\Hakobo.exe  (Start per Doppelklick oder start.cmd)
exit /b 0

:error
echo.
echo Build fehlgeschlagen.
exit /b 1
