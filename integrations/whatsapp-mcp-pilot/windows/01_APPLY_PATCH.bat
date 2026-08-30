@echo off
setlocal
set /p BRIDGE=Masukkan path folder whatsapp-bridge (contoh C:\Users\Anda\whatsapp-mcp\whatsapp-bridge): 
if not exist "%BRIDGE%\main.go" (
  echo main.go tidak ditemukan di %BRIDGE%
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0..\bridge-patch\apply_unit_elite_patch.ps1" -BridgePath "%BRIDGE%"
if errorlevel 1 (echo PATCH GAGAL & pause & exit /b 1)
pause
