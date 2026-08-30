@echo off
setlocal EnableExtensions
chcp 65001 >nul

echo ============================================================
echo UNIT ELITE v1.5.1e - WHATSAPP FILENAME HOTFIX v2
echo ============================================================
echo.
set /p BRIDGE=Masukkan path folder whatsapp-bridge: 
if "%BRIDGE%"=="" goto :bad
if not exist "%BRIDGE%\main.go" (
  echo [ERROR] main.go tidak ditemukan di:
  echo %BRIDGE%
  goto :bad
)

for /f "tokens=1-4 delims=/ " %%a in ('date /t') do set D=%%a%%b%%c%%d
for /f "tokens=1-3 delims=:,. " %%a in ("%time%") do set T=%%a%%b%%c
set T=%T: =0%
copy /y "%BRIDGE%\main.go" "%BRIDGE%\main.go.before-v1.5.1e-%D%-%T%.bak" >nul

echo [INFO] Menerapkan filename basename fix menggunakan script PowerShell terpisah...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Apply-FilenameFix.ps1" -BridgePath "%BRIDGE%"
if errorlevel 1 goto :bad

echo.
echo [PASS] Filename hotfix v2 terpasang.
echo [NEXT] Jalankan 02_REBUILD_BRIDGE.bat
pause
exit /b 0

:bad
echo.
echo [ERROR] Hotfix gagal. main.go tidak dihapus dan backup tetap tersedia.
pause
exit /b 1
