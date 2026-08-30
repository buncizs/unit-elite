@echo off
setlocal
set /p BRIDGE=Masukkan path folder whatsapp-bridge: 
if not exist "%BRIDGE%\whatsapp-bridge.exe" (
  echo whatsapp-bridge.exe belum ada. Jalankan 02_BUILD_BRIDGE.bat terlebih dahulu.
  pause
  exit /b 1
)
cd /d "%BRIDGE%"
echo.
echo Jendela ini harus tetap terbuka selama pilot.
echo Jika QR muncul, scan dari WhatsApp ^> Linked Devices ^> Link a device.
echo.
whatsapp-bridge.exe
pause
