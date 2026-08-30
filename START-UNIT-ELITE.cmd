@echo off
setlocal
title Unit Elite - START
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\d7-production\start.ps1"
exit /b %errorlevel%
