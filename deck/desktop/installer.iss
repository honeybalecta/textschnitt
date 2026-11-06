; Inno-Setup-Skript für HoneyDeck (Installation ohne Adminrechte, pro Benutzer:in)
; Der Registry-Eintrag WebDir sagt HoneyCut, wo die Oberfläche liegt – dann läuft HoneyDeck im Reiter „Folien“.
#define AppVersion GetEnv("HD_VERSION")
#if AppVersion == ""
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{B3F1C5E2-7A4D-4C2B-9E61-5D8A2F0C7B34}
AppName=HoneyDeck
AppVersion={#AppVersion}
AppPublisher=Honey Balecta
DefaultDirName={localappdata}\Programs\HoneyDeck
DefaultGroupName=HoneyDeck
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\..\dist
OutputBaseFilename=HoneyDeck-Setup-{#AppVersion}
SetupIconFile=honeydeck.ico
UninstallDisplayIcon={app}\HoneyDeck.exe
Compression=lzma2/normal
SolidCompression=no
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
ChangesAssociations=yes

[Languages]
Name: "de"; MessagesFile: "compiler:Languages\German.isl"

[Tasks]
Name: "desktopicon"; Description: "Symbol auf dem Desktop anlegen"; GroupDescription: "Zusätzlich:"

[Files]
Source: "..\..\dist\HoneyDeck\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; Oberfläche zusätzlich als offener Ordner – für HoneyCut
Source: "..\dist-web\*"; DestDir: "{app}\web"; Flags: ignoreversion recursesubdirs createallsubdirs

[Registry]
Root: HKCU; Subkey: "Software\HoneyBalecta\HoneyDeck"; ValueType: string; ValueName: "WebDir"; ValueData: "{app}\web"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\HoneyBalecta\HoneyDeck"; ValueType: string; ValueName: "Version"; ValueData: "{#AppVersion}"
Root: HKCU; Subkey: "Software\Classes\.honeydeck"; ValueType: string; ValueName: ""; ValueData: "HoneyDeck.Praesentation"; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\HoneyDeck.Praesentation"; ValueType: string; ValueName: ""; ValueData: "HoneyDeck-Präsentation"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\HoneyDeck.Praesentation\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\HoneyDeck.exe,0"
Root: HKCU; Subkey: "Software\Classes\HoneyDeck.Praesentation\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\HoneyDeck.exe"" ""%1"""

[Icons]
Name: "{autoprograms}\HoneyDeck"; Filename: "{app}\HoneyDeck.exe"
Name: "{autodesktop}\HoneyDeck"; Filename: "{app}\HoneyDeck.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\HoneyDeck.exe"; Description: "HoneyDeck jetzt starten"; Flags: nowait postinstall skipifsilent
