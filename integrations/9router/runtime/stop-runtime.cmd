@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-runtime.ps1"
exit /b %ERRORLEVEL%
