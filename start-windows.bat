@echo off
cd /d "%~dp0"
where python >nul 2>nul && (python textschnitt.py %*) || (py textschnitt.py %*)
pause
