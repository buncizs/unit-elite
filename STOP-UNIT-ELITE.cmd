@echo off
setlocal
title Unit Elite - STOP
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\d7-production\stop.ps1"
exit /b %errorlevel%
