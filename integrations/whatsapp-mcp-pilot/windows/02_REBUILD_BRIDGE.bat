@echo off
setlocal EnableExtensions
chcp 65001 >nul

echo ============================================================
echo UNIT ELITE v1.5.1e - REBUILD WHATSAPP BRIDGE
echo ============================================================
echo.
set /p BRIDGE=Masukkan path folder whatsapp-bridge: 
if "%BRIDGE%"=="" goto :bad
if not exist "%BRIDGE%\main.go" (
  echo [ERROR] main.go tidak ditemukan.
  goto :bad
)

where go >nul 2>nul || (
  echo [ERROR] Go tidak ditemukan di PATH.
  goto :bad
)

set GCCBIN=
where gcc >nul 2>nul && for /f "delims=" %%G in ('where gcc') do if not defined GCCBIN set "GCCBIN=%%G"
if not defined GCCBIN if exist "C:\msys64\ucrt64\bin\gcc.exe" set "GCCBIN=C:\msys64\ucrt64\bin\gcc.exe"
if not defined GCCBIN if exist "C:\msys64\mingw64\bin\gcc.exe" set "GCCBIN=C:\msys64\mingw64\bin\gcc.exe"
if not defined GCCBIN (
  echo [ERROR] GCC tidak ditemukan.
  goto :bad
)
for %%I in ("%GCCBIN%") do set "GCCDIR=%%~dpI"
set "PATH=%GCCDIR%;%PATH%"
set CGO_ENABLED=1
set "CC=%GCCBIN%"

pushd "%BRIDGE%"
echo [INFO] gofmt...
gofmt -w main.go
if errorlevel 1 (popd & goto :bad)

echo [INFO] Memeriksa patch filename...
findstr /C:"Title:         proto.String(filepath.Base(mediaPath))" main.go >nul || (
  echo [ERROR] Title basename patch tidak ditemukan setelah gofmt.
  popd
  goto :bad
)
findstr /C:"FileName:      proto.String(filepath.Base(mediaPath))" main.go >nul || (
  echo [ERROR] FileName basename patch tidak ditemukan setelah gofmt.
  popd
  goto :bad
)

echo [INFO] go build...
go build -o whatsapp-bridge.exe .
if errorlevel 1 (popd & goto :bad)
popd

echo.
echo [PASS] BUILD PASS
echo [OUTPUT] %BRIDGE%\whatsapp-bridge.exe
echo [NEXT] Jalankan bridge kembali dan kirim ulang file PDF yang sama.
pause
exit /b 0

:bad
echo.
echo [ERROR] BUILD GAGAL.
pause
exit /b 1
