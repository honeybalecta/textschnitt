# HoneyCut – Einrichtung für Windows
# Installiert (falls nötig) Python 3.12, ffmpeg und faster-whisper und legt Verknüpfungen an.
$ErrorActionPreference = "Stop"
$App = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $App

function Refresh-Path {
    $env:Path = [Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [Environment]::GetEnvironmentVariable("Path","User")
}
function Step($t) { Write-Host ""; Write-Host "==> $t" -ForegroundColor Yellow }

function Find-Python {
    foreach ($v in @("3.12","3.13","3.11","3.10")) {
        try {
            $exe = & py "-$v" -c "import sys;print(sys.executable)" 2>$null
            if ($LASTEXITCODE -eq 0 -and $exe) { return $exe.Trim() }
        } catch {}
    }
    foreach ($c in @("$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
                     "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
                     "C:\Program Files\Python312\python.exe")) {
        if (Test-Path $c) { return $c }
    }
    return $null
}

Step "Python suchen"
$py = Find-Python
if (-not $py) {
    Step "Python 3.12 installieren (winget)"
    winget install -e --id Python.Python.3.12 --scope user --accept-source-agreements --accept-package-agreements --silent
    Refresh-Path
    $py = Find-Python
    if (-not $py) { throw "Python wurde installiert, ist aber noch nicht auffindbar. Bitte das Fenster schließen und install.bat erneut starten." }
}
Write-Host "Python: $py"

Step "ffmpeg suchen"
Refresh-Path
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Step "ffmpeg installieren (winget)"
    winget install -e --id Gyan.FFmpeg --accept-source-agreements --accept-package-agreements --silent
    Refresh-Path
}
$ff = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($ff) { Write-Host "ffmpeg: $($ff.Source)" } else { Write-Host "ffmpeg ist installiert, wird aber erst nach einem Neustart von Windows gefunden." -ForegroundColor Red }

Step "faster-whisper installieren (kann ein paar Minuten dauern)"
& $py -m pip install --upgrade pip --quiet --disable-pip-version-check
& $py -m pip install --upgrade faster-whisper --disable-pip-version-check
if ($LASTEXITCODE -ne 0) { throw "pip install faster-whisper ist fehlgeschlagen." }
& $py -c "import faster_whisper, tkinter; print('faster-whisper OK')"

Step "Programmfenster (pywebview) installieren"
& $py -m pip install --upgrade pywebview --disable-pip-version-check
if ($LASTEXITCODE -ne 0) { throw "pip install pywebview ist fehlgeschlagen." }
& $py -c "import webview; print('pywebview OK')"

Step "Starter und Verknüpfungen anlegen"
$bat = Join-Path $App "HoneyCut starten.bat"
@"
@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
set PATH=%LOCALAPPDATA%\Microsoft\WinGet\Links;%PATH%
"$py" textschnitt.py %*
pause
"@ | Set-Content -Path $bat -Encoding Default

$pyw = Join-Path (Split-Path -Parent $py) "pythonw.exe"
if (-not (Test-Path $pyw)) { $pyw = $py }
$appScript = Join-Path $App "textschnitt_app.pyw"
$icon = Join-Path $App "textschnitt.ico"
$shell = New-Object -ComObject WScript.Shell
$targets = @(
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "HoneyCut.lnk"),
    (Join-Path ([Environment]::GetFolderPath("Programs")) "HoneyCut.lnk")
)
foreach ($lnkPath in $targets) {
    if (Test-Path $lnkPath) { Remove-Item $lnkPath -Force }
    $lnk = $shell.CreateShortcut($lnkPath)
    $lnk.TargetPath = $pyw
    $lnk.Arguments = "`"$appScript`""
    $lnk.WorkingDirectory = $App
    $lnk.IconLocation = "$icon,0"
    $lnk.Description = "Videos über das Transkript schneiden"
    $lnk.Save()
}

Write-Host ""
Write-Host "Fertig. HoneyCut liegt auf dem Desktop und im Startmenü." -ForegroundColor Green
Write-Host "HoneyCut öffnet sich jetzt als eigenes Programmfenster. Videos lassen sich auch auf die Verknüpfung oder ins Fenster ziehen."
