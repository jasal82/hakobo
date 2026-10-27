# Erzeugt den Windows-Installer (Inno Setup 6) aus dist\Hakobo.exe.
# Wird von build.cmd aufgerufen; ISCC.exe aus dem PATH, der Variable ISCC
# oder dem Standard-Installationsordner. -Optional: ohne Inno Setup nur
# einen Hinweis ausgeben (lokaler Build), sonst abbrechen (Release-Build).
[CmdletBinding()]
param([string]$Iscc = $env:ISCC, [switch]$Optional)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
Push-Location $root
try {
    $version = & node scripts/version.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Versionsprüfung fehlgeschlagen.' }
    $hostInfo = & rustc -vV
    if ($LASTEXITCODE -ne 0 -or $hostInfo -notcontains 'host: x86_64-pc-windows-msvc') {
        throw 'Der Windows-Installer setzt eine x64-MSVC-Rust-Toolchain voraus.'
    }
    if (!$Iscc) {
        $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
        if ($command) { $Iscc = $command.Source }
        else {
            $Iscc = @(
                (Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6/ISCC.exe'),
                (Join-Path $env:LOCALAPPDATA 'Programs/Inno Setup 6/ISCC.exe')
            ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
        }
    }
    if (!$Iscc -or !(Test-Path -LiteralPath $Iscc)) {
        if ($Optional) {
            Write-Host 'Kein Installer: Inno Setup 6 nicht gefunden (https://jrsoftware.org/isdl.php). Das Programm unter dist\ ist fertig.'
            return
        }
        throw 'Inno Setup 6 installieren (https://jrsoftware.org/isdl.php), ISCC.exe in den PATH aufnehmen oder ISCC auf den vollständigen Pfad setzen. Nur das Programm ohne Installer: build.cmd --no-installer'
    }
    foreach ($file in 'Hakobo.exe', 'THIRD-PARTY-LICENSES.txt') {
        if (!(Test-Path -LiteralPath "dist/$file")) { throw "dist/$file fehlt. Zuerst build.cmd ausführen." }
    }
    & $Iscc /Q "/DAppVersion=$version" 'installer/hakobo.iss'
    if ($LASTEXITCODE -ne 0) { throw 'Der Installer konnte nicht erzeugt werden.' }
    Write-Host "Installer: dist/packages/Hakobo-$version-windows-x64-setup.exe"
} finally { Pop-Location }
