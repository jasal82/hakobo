@echo off
rem Baut Hakobo (Oberflaeche und Programm) und legt das Ergebnis unter dist\ ab:
rem   dist\Hakobo.exe                 App, Server und Kommandozeile in einem Programm
rem   dist\THIRD-PARTY-LICENSES.txt   Lizenzen der enthaltenen Komponenten Dritter
rem   dist\packages\Hakobo-X.Y.Z-windows-x64-setup.exe   Installer (Inno Setup 6)
rem
rem   build.cmd                  Installer, sofern Inno Setup 6 installiert ist
rem   build.cmd --installer      Installer ist Pflicht (Release-Build)
rem   build.cmd --no-installer   nur Programm und Lizenzdatei
setlocal
cd /d "%~dp0"
set "INSTALLER=optional"
if "%~1"=="--installer" set "INSTALLER=required"
if "%~1"=="--no-installer" set "INSTALLER=none"
if not "%~1"=="" if not "%~1"=="--installer" if not "%~1"=="--no-installer" (
  echo Aufruf: build.cmd [--installer ^| --no-installer]
  exit /b 1
)
node scripts\version.mjs || goto :error

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

if not exist dist\packages mkdir dist\packages
copy /y target\release\hakobo.exe dist\Hakobo.exe >nul || goto :error
node scripts\third-party-licenses.mjs dist\THIRD-PARTY-LICENSES.txt || goto :error
if "%INSTALLER%"=="required" (
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-installer.ps1 || goto :error
)
if "%INSTALLER%"=="optional" (
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-installer.ps1 -Optional || goto :error
)

echo.
echo Fertig: dist\Hakobo.exe  (Start per Doppelklick oder start.cmd)
exit /b 0

:error
echo.
echo Build fehlgeschlagen.
exit /b 1
