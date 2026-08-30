@echo off
setlocal
title Unit Elite - RECOVER
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\d7-production\recover.ps1"
exit /b %errorlevel%
