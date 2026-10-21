; Inno-Setup-Skript für Textschnitt (Installation ohne Adminrechte, pro Benutzer:in)
#define AppVersion GetEnv("TS_VERSION")
#if AppVersion == ""
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{6C7E1A52-6E3B-4D1A-9B3E-2B7F4C1D9A10}
AppName=Textschnitt
AppVersion={#AppVersion}
AppPublisher=Honey Balecta
DefaultDirName={localappdata}\Programs\Textschnitt
DefaultGroupName=Textschnitt
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=Textschnitt-Setup-{#AppVersion}
SetupIconFile=..\textschnitt.ico
UninstallDisplayIcon={app}\Textschnitt.exe
Compression=lzma2/normal
SolidCompression=no
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "de"; MessagesFile: "compiler:Languages\German.isl"

[Tasks]
Name: "desktopicon"; Description: "Symbol auf dem Desktop anlegen"; GroupDescription: "Zusätzlich:"

[Files]
Source: "..\dist\Textschnitt\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Textschnitt"; Filename: "{app}\Textschnitt.exe"
Name: "{autodesktop}\Textschnitt"; Filename: "{app}\Textschnitt.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\Textschnitt.exe"; Description: "Textschnitt jetzt starten"; Flags: nowait postinstall skipifsilent
