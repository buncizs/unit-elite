@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-9router.ps1"
exit /b %errorlevel%
