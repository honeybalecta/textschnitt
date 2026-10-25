; Inno-Setup-Skript für HoneyCut (Installation ohne Adminrechte, pro Benutzer:in)
#define AppVersion GetEnv("TS_VERSION")
#if AppVersion == ""
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{6C7E1A52-6E3B-4D1A-9B3E-2B7F4C1D9A10}
AppName=HoneyCut
AppVersion={#AppVersion}
AppPublisher=Honey Balecta
DefaultDirName={localappdata}\Programs\HoneyCut
DefaultGroupName=HoneyCut
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=HoneyCut-Setup-{#AppVersion}
SetupIconFile=..\textschnitt.ico
UninstallDisplayIcon={app}\HoneyCut.exe
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
Source: "..\dist\HoneyCut\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\HoneyCut"; Filename: "{app}\HoneyCut.exe"
Name: "{autodesktop}\HoneyCut"; Filename: "{app}\HoneyCut.exe"; Tasks: desktopicon

[InstallDelete]
; frühere Versionen hießen „Textschnitt“
Type: files; Name: "{app}\Textschnitt.exe"
Type: files; Name: "{autoprograms}\Textschnitt.lnk"
Type: files; Name: "{autodesktop}\Textschnitt.lnk"

[Run]
Filename: "{app}\HoneyCut.exe"; Description: "HoneyCut jetzt starten"; Flags: nowait postinstall skipifsilent
