@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-runtime.ps1"
exit /b %ERRORLEVEL%
