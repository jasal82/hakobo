; Copyright (C) 2026 Johannes Asal
; SPDX-License-Identifier: AGPL-3.0-or-later
; Lizenz und Gewährleistungsausschluss: siehe LICENSE im Projektordner.

; Windows-Installer für Hakobo (Inno Setup 6).
; Erzeugen über scripts/build-installer.ps1 bzw. build.cmd nach dem Release-Build.
#ifndef AppVersion
  #error AppVersion muss vom Build-Skript übergeben werden
#endif

[Setup]
; Die AppId nie ändern: an ihr erkennt Windows Updates und Deinstallation.
AppId={{A49038EB-C332-4972-979C-C8A00ED8049C}
AppName=Hakobo
AppVersion={#AppVersion}
AppVerName=Hakobo {#AppVersion}
AppPublisher=Johannes Asal
AppPublisherURL=https://github.com/jasal82/hakobo
VersionInfoVersion={#AppVersion}
VersionInfoProductName=Hakobo
VersionInfoDescription=Hakobo Setup
DefaultDirName={localappdata}\Programs\Hakobo
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
LicenseFile=..\LICENSE
SetupIconFile=..\assets\icon\hakobo.ico
UninstallDisplayIcon={app}\Hakobo.exe
UninstallDisplayName=Hakobo
OutputDir=..\dist\packages
OutputBaseFilename=Hakobo-{#AppVersion}-windows-x64-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
; Hakobo läuft meist im Infobereich weiter: vor dem Ersetzen beenden lassen.
CloseApplications=yes
RestartApplications=no
; Der Programmordner kommt in den PATH des Benutzers: laufende Programme benachrichtigen.
ChangesEnvironment=yes

[Languages]
Name: "german"; MessagesFile: "compiler:Languages\German.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
german.AddToPath=Befehl „hakobo“ im Terminal verfügbar machen (PATH)
english.AddToPath=Make the hakobo command available in terminals (PATH)

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked
Name: "addtopath"; Description: "{cm:AddToPath}"

[Files]
; Ausdrückliche Liste: Notizen liegen im Notizbuch (Dokumente\Hakobo), nie im Programmordner.
Source: "..\dist\Hakobo.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\LICENSE.txt"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\THIRD-PARTY-LICENSES.txt"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Hakobo"; Filename: "{app}\Hakobo.exe"; WorkingDir: "{app}"
Name: "{autodesktop}\Hakobo"; Filename: "{app}\Hakobo.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Registry]
; Autostart (Einstellungen → „Mit Windows starten“) beim Deinstallieren entfernen, nie anlegen.
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: none; ValueName: "Hakobo"; Flags: uninsdeletevalue

[Run]
Filename: "{app}\Hakobo.exe"; Description: "{cm:LaunchProgram,Hakobo}"; Flags: nowait postinstall skipifsilent
; Selbst-Update (src/update.rs): /RELAUNCH=1 startet das aktualisierte Programm wieder.
; Es erbt die Umgebung des Setups und damit Port und Zugangstoken der vorigen Version.
Filename: "{app}\Hakobo.exe"; Flags: nowait; Check: Relaunch

[Code]
function Relaunch: Boolean;
begin
  Result := ExpandConstant('{param:relaunch|}') <> '';
end;

// PATH des Benutzers (HKCU\Environment): Einträge durch „;“ getrennt, Groß-/Kleinschreibung egal.
// Der Wert bleibt REG_EXPAND_SZ, damit Einträge wie %USERPROFILE%\bin erhalten bleiben.
const
  EnvKey = 'Environment';

function UserPath: string;
begin
  if not RegQueryStringValue(HKCU, EnvKey, 'Path', Result) then
    Result := '';
end;

function PathPos(Paths, Dir: string): Integer;
begin
  Result := Pos(';' + Uppercase(Dir) + ';', ';' + Uppercase(Paths) + ';');
end;

procedure AddToPath(Dir: string);
var
  Paths: string;
begin
  Paths := UserPath;
  if PathPos(Paths, Dir) > 0 then
    exit;
  if (Paths <> '') and (Paths[Length(Paths)] <> ';') then
    Paths := Paths + ';';
  RegWriteExpandStringValue(HKCU, EnvKey, 'Path', Paths + Dir);
end;

procedure RemoveFromPath(Dir: string);
var
  Paths: string;
  P: Integer;
begin
  Paths := UserPath;
  P := PathPos(Paths, Dir);
  if P = 0 then
    exit;
  // In „;Pfade;“ steht der Eintrag samt führendem „;“ an Stelle P.
  Paths := ';' + Paths + ';';
  Delete(Paths, P, Length(Dir) + 1);
  // Übrig sind die anderen Einträge zwischen „;“ – oder nichts, wenn Hakobo der einzige war.
  if Length(Paths) <= 2 then
    Paths := ''
  else
    Paths := Copy(Paths, 2, Length(Paths) - 2);
  RegWriteExpandStringValue(HKCU, EnvKey, 'Path', Paths);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
    if WizardIsTaskSelected('addtopath') then
      AddToPath(ExpandConstant('{app}'))
    else
      RemoveFromPath(ExpandConstant('{app}'));
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    RemoveFromPath(ExpandConstant('{app}'));
end;
