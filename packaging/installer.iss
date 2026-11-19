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
Name: "{autoprograms}\HoneyRec"; Filename: "{app}\HoneyRec.exe"; Comment: "Aufnehmen mit Skript, Medien und Bildschirm"; AppUserModelID: "HoneyCut.HoneyRec"
Name: "{autodesktop}\HoneyRec"; Filename: "{app}\HoneyRec.exe"; Tasks: desktopicon; AppUserModelID: "HoneyCut.HoneyRec"

[InstallDelete]
; frühere Versionen hießen „Textschnitt“
Type: files; Name: "{app}\Textschnitt.exe"
Type: files; Name: "{autoprograms}\Textschnitt.lnk"
Type: files; Name: "{autodesktop}\Textschnitt.lnk"

[Run]
Filename: "{app}\HoneyCut.exe"; Description: "HoneyCut jetzt starten"; Flags: nowait postinstall skipifsilent

[Code]
// Frühere Fassungen hießen „Textschnitt“ und lagen in einem eigenen Programmordner. Wer danach neu installiert hat,
// behielt diesen Ordner samt alter Fassung; eine alte Verknüpfung (Taskleiste, Desktop) startete sie weiter.
// Nach der Installation richtet das Setup solche Verknüpfungen auf die neue Fassung aus und entfernt den alten
// Programmordner. Der Datenordner {localappdata}\Textschnitt (Projekte, Einstellungen, Protokoll) gehört nicht dazu
// und bleibt unberührt.
function OldAppDir: String;
begin
  Result := ExpandConstant('{localappdata}\Programs\Textschnitt');
end;

function SameDir(const A, B: String): Boolean;
begin
  Result := CompareText(RemoveBackslashUnlessRoot(A), RemoveBackslashUnlessRoot(B)) = 0;
end;

procedure RepointShortcuts(const Dir: String);
var
  Rec: TFindRec;
  Shell, Lnk: Variant;
  OldPrefix, NewExe, Target: String;
begin
  if not DirExists(Dir) then Exit;
  OldPrefix := Lowercase(AddBackslash(OldAppDir));
  NewExe := ExpandConstant('{app}\HoneyCut.exe');
  try
    Shell := CreateOleObject('WScript.Shell');
  except
    Exit;
  end;
  if FindFirst(AddBackslash(Dir) + '*.lnk', Rec) then
  try
    repeat
      try
        Lnk := Shell.CreateShortcut(AddBackslash(Dir) + Rec.Name);
        Target := Lnk.TargetPath;
        if Pos(OldPrefix, Lowercase(Target)) = 1 then
        begin
          Lnk.TargetPath := NewExe;
          Lnk.WorkingDirectory := ExpandConstant('{app}');
          Lnk.IconLocation := NewExe + ',0';
          Lnk.Save;
          Log('Verknuepfung umgestellt: ' + AddBackslash(Dir) + Rec.Name);
        end;
      except
        Log('Verknuepfung nicht lesbar: ' + AddBackslash(Dir) + Rec.Name);
      end;
    until not FindNext(Rec);
  finally
    FindClose(Rec);
  end;
end;

// Ordner über seine Setup-Konstante ansprechen; fehlt er auf diesem Rechner, entfällt der Schritt
procedure RepointIn(const Which: String);
var
  Dir: String;
begin
  try
    Dir := ExpandConstant(Which);
  except
    Exit;
  end;
  RepointShortcuts(Dir);
end;

procedure RemoveOldInstall;
var
  Old: String;
begin
  Old := OldAppDir;
  // HoneyCut selbst kann in diesem Ordner liegen (Update über eine Installation aus der Textschnitt-Zeit): dann bleibt er.
  if SameDir(Old, ExpandConstant('{app}')) or not DirExists(Old) then Exit;
  // Nur ein Ordner, der wie die alte Installation aussieht, und niemals einer mit Projekten.
  if DirExists(Old + '\projects') then Exit;
  if not (DirExists(Old + '\_internal') or FileExists(Old + '\Textschnitt.exe') or FileExists(Old + '\HoneyCut.exe')) then Exit;
  RepointIn('{userdesktop}');
  RepointIn('{userprograms}');
  RepointIn('{userstartmenu}');
  RepointIn('{userappdata}\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar');
  RepointIn('{userappdata}\Microsoft\Internet Explorer\Quick Launch\User Pinned\StartMenu');
  if DelTree(Old, True, True, True) then
    Log('Alter Programmordner entfernt: ' + Old)
  else
    Log('Alter Programmordner nur teilweise entfernt: ' + Old);
end;

// Das Aufräumen darf die Installation nie scheitern lassen: Ein unerwarteter Fehler landet im Protokoll des Setups.
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    try
      RemoveOldInstall;
    except
      Log('Aufraeumen der alten Installation uebersprungen: ' + GetExceptionMessage);
    end;
  end;
end;
