@echo off
setlocal
title Unit Elite - STATUS
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\d7-production\status.ps1"
exit /b %errorlevel%
