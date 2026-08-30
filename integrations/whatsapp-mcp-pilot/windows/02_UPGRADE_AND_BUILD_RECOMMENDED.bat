@echo off
setlocal EnableExtensions EnableDelayedExpansion

echo ============================================================
echo UNIT ELITE v1.5.1b - WHATSMeow UPGRADE + BUILD
 echo Recommended path
 echo ============================================================
echo.
set /p "BRIDGE=Masukkan path folder whatsapp-bridge: "
if not exist "%BRIDGE%\go.mod" (
  echo [ERROR] go.mod tidak ditemukan di %BRIDGE%
  pause
  exit /b 1
)
if not exist "%BRIDGE%\main.go" (
  echo [ERROR] main.go tidak ditemukan di %BRIDGE%
  pause
  exit /b 1
)

where go >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Go tidak ditemukan di PATH.
  pause
  exit /b 1
)

rem GCC auto-discovery
where gcc >nul 2>nul
if not errorlevel 1 goto :gcc_found
if exist "C:\msys64\ucrt64\bin\gcc.exe" (
  set "GCC_DIR=C:\msys64\ucrt64\bin"
  goto :gcc_add
)
if exist "C:\msys64\mingw64\bin\gcc.exe" (
  set "GCC_DIR=C:\msys64\mingw64\bin"
  goto :gcc_add
)
echo [ERROR] GCC tidak ditemukan. Pastikan MSYS2 UCRT64 GCC sudah terpasang.
pause
exit /b 1
:gcc_add
set "PATH=!GCC_DIR!;!PATH!"
:gcc_found

for /f "tokens=2" %%G in ('go version') do set "GOVER=%%G"
echo [OK] Go: !GOVER!
echo [OK] GCC:
gcc --version | findstr /R /C:"gcc" /C:"GCC" /C:"Rev"

set "STAMP=%RANDOM%%RANDOM%"
copy /Y "%BRIDGE%\main.go" "%BRIDGE%\main.go.pre-v151b.!STAMP!.bak" >nul
copy /Y "%BRIDGE%\go.mod" "%BRIDGE%\go.mod.pre-v151b.!STAMP!.bak" >nul
if exist "%BRIDGE%\go.sum" copy /Y "%BRIDGE%\go.sum" "%BRIDGE%\go.sum.pre-v151b.!STAMP!.bak" >nul

echo [INFO] Backup dibuat.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0patch_context_calls.ps1" -Bridge "%BRIDGE%"
if errorlevel 1 (
  echo [ERROR] Patch call-site gagal.
  pause
  exit /b 1
)

cd /d "%BRIDGE%"
set "CGO_ENABLED=1"
set "CC=gcc"

echo.
echo [INFO] Meng-upgrade whatsmeow ke latest yang tersedia...
go get go.mau.fi/whatsmeow@latest
if errorlevel 1 (
  echo [ERROR] go get gagal. Backup tidak dihapus.
  pause
  exit /b 1
)

echo.
echo [INFO] go mod tidy...
go mod tidy
if errorlevel 1 (
  echo [ERROR] go mod tidy gagal.
  pause
  exit /b 1
)

echo.
echo [INFO] gofmt...
gofmt -w main.go
if errorlevel 1 (
  echo [ERROR] gofmt gagal.
  pause
  exit /b 1
)

echo.
echo [INFO] go build...
go build -o whatsapp-bridge.exe .
if errorlevel 1 (
  echo.
  echo [ERROR] BUILD GAGAL.
  echo Kirim seluruh error mulai dari [INFO] go build...
  pause
  exit /b 1
)

echo.
echo ============================================================
echo BUILD PASS
 echo %BRIDGE%\whatsapp-bridge.exe
 echo ============================================================
pause
