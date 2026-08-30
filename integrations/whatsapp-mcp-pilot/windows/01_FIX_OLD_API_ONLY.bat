@echo off
setlocal EnableExtensions

echo ============================================================
echo UNIT ELITE v1.5.1b - OLD API COMPILE FIX ONLY
echo WARNING: tidak direkomendasikan untuk live pairing.
echo ============================================================
echo.
set /p "BRIDGE=Masukkan path folder whatsapp-bridge: "
if not exist "%BRIDGE%\main.go" (
  echo [ERROR] main.go tidak ditemukan.
  pause
  exit /b 1
)
copy /Y "%BRIDGE%\main.go" "%BRIDGE%\main.go.pre-v151b.bak" >nul
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$p='%BRIDGE%\main.go'; $s=[IO.File]::ReadAllText($p); $old='client.IsOnWhatsApp(context.Background(), phones)'; $new='client.IsOnWhatsApp(phones)'; if(-not $s.Contains($old)){Write-Host '[ERROR] Target string tidak ditemukan.'; exit 2}; $s=$s.Replace($old,$new); [IO.File]::WriteAllText($p,$s,[Text.UTF8Encoding]::new($false)); Write-Host '[OK] IsOnWhatsApp disesuaikan ke API lama.'"
if errorlevel 1 (
  pause
  exit /b 1
)
echo.
echo Jalankan kembali script build Anda.
pause
