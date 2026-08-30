@echo off
setlocal EnableExtensions EnableDelayedExpansion

echo ============================================================
echo UNIT ELITE WhatsApp Pilot - Build Bridge v1.5.1a
echo GCC/MSYS2 auto-discovery hotfix
echo ============================================================
echo.

set /p "BRIDGE=Masukkan path folder whatsapp-bridge: "
if not exist "%BRIDGE%\go.mod" (
  echo [ERROR] go.mod tidak ditemukan di:
  echo %BRIDGE%
  pause
  exit /b 1
)

where go >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Go tidak ditemukan di PATH.
  echo Tutup jendela ini, pastikan Go sudah terpasang, lalu buka ulang Windows/OpenCode bila perlu.
  pause
  exit /b 1
)

rem ------------------------------------------------------------
rem Cari GCC. Tidak perlu menambah PATH Windows secara permanen.
rem ------------------------------------------------------------
where gcc >nul 2>nul
if not errorlevel 1 goto :gcc_found

if exist "C:\msys64\ucrt64\bin\gcc.exe" (
  set "GCC_DIR=C:\msys64\ucrt64\bin"
  goto :gcc_add
)

if exist "C:\msys64\mingw64\bin\gcc.exe" (
  set "GCC_DIR=C:\msys64\mingw64\bin"
  echo [WARNING] UCRT64 GCC tidak ditemukan. Menggunakan MINGW64 GCC.
  goto :gcc_add
)

if exist "%LOCALAPPDATA%\Programs\msys64\ucrt64\bin\gcc.exe" (
  set "GCC_DIR=%LOCALAPPDATA%\Programs\msys64\ucrt64\bin"
  goto :gcc_add
)

if exist "%USERPROFILE%\msys64\ucrt64\bin\gcc.exe" (
  set "GCC_DIR=%USERPROFILE%\msys64\ucrt64\bin"
  goto :gcc_add
)

echo [INFO] GCC belum ditemukan otomatis.
echo Lokasi standar biasanya: C:\msys64\ucrt64\bin
set /p "GCC_DIR=Masukkan folder yang berisi gcc.exe: "
if not exist "!GCC_DIR!\gcc.exe" (
  echo [ERROR] gcc.exe tidak ditemukan di:
  echo !GCC_DIR!
  echo.
  echo Pastikan di MSYS2 UCRT64 sudah dijalankan:
  echo pacman -S mingw-w64-ucrt-x86_64-gcc
  pause
  exit /b 1
)

goto :gcc_add

:gcc_add
set "PATH=!GCC_DIR!;!PATH!"

:gcc_found
where gcc >nul 2>nul
if errorlevel 1 (
  echo [ERROR] GCC tetap tidak dapat dipanggil setelah auto-discovery.
  pause
  exit /b 1
)

echo.
echo [OK] Go:
go version
if errorlevel 1 (
  echo [ERROR] Go gagal dijalankan.
  pause
  exit /b 1
)

echo.
echo [OK] GCC:
gcc --version | findstr /R /C:"gcc" /C:"GCC" /C:"Rev"
if errorlevel 1 gcc --version

echo.
echo [INFO] Build directory:
echo %BRIDGE%

cd /d "%BRIDGE%"
if errorlevel 1 (
  echo [ERROR] Tidak dapat masuk ke folder bridge.
  pause
  exit /b 1
)

rem Hanya berlaku untuk proses build ini; tidak mengubah konfigurasi Go global.
set "CGO_ENABLED=1"
set "CC=gcc"

echo.
echo [INFO] CGO_ENABLED=!CGO_ENABLED!
echo [INFO] CC=!CC!

gofmt -w main.go
if errorlevel 1 (
  echo [ERROR] GOFMT GAGAL
  pause
  exit /b 1
)

echo.
echo [INFO] Menjalankan go build...
go build -o whatsapp-bridge.exe .
if errorlevel 1 (
  echo.
  echo [ERROR] BUILD GAGAL.
  echo Salin seluruh pesan error di atas dan kirimkan untuk diagnosis berikutnya.
  pause
  exit /b 1
)

if not exist "%BRIDGE%\whatsapp-bridge.exe" (
  echo [ERROR] Build selesai tanpa error tetapi whatsapp-bridge.exe tidak ditemukan.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo BUILD PASS
echo %BRIDGE%\whatsapp-bridge.exe
echo ============================================================
pause
exit /b 0
