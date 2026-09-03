@echo off
REM ============================================================================
REM  start-caveman.cmd - CAVEMAN B2 proxy launcher (integrations/caveman/)
REM  Unit Elite (TECH-0002-optimasi-token, mode B2)
REM  Jalur: Runtime Gateway (:20129) -> [CAVEMAN PROXY B2] -> 9Router (:20128/v1)
REM ============================================================================
REM  STATUS: PATCH_READY_FOR_ACCEPTANCE (wiring siap, fail-open sudah di
REM  runtime-gateway.cjs + caveman-router.cjs). PROXY BINARY BELUM TERSEDIA
REM  di lingkungan ini — lihat laporan TECH-0002 (deteksi binary).
REM ============================================================================
REM  Aturan keselamatan (loopback-only, fail-open ke 9Router asli):
REM    1. Caveman proxy WAJIB bypassable (fail-open ke 9Router :20128) bila mati.
REM    2. Binder WAJIB 127.0.0.1:<port>, TANPA 0.0.0.0 (0.0.0.0 -> FAIL CLOSED exit 3).
REM ============================================================================

setlocal
set "BIN_PORT=20127"

REM ---------------------------------------------------------------------------
REM  STEP 1 - Deteksi binary Caveman (JANGAN install otomatis).
REM  Binary resmi CLI: @caveman-ai/cli. Tanpa binary, proxy tidak bisa jalan.
REM ---------------------------------------------------------------------------
set "BIN="
where caveman >nul 2>nul && set "BIN=caveman"
if not defined BIN (
  if exist "node_modules\.bin\caveman.cmd" set "BIN=node_modules\.bin\caveman.cmd"
)

if not defined BIN (
  echo [CAVEMAN][FAIL] Binary proxy Caveman TIDAK ditemukan.
  echo [CAVEMAN][FAIL] Deteksi:
  echo      - ^"caveman^" CLI  : TIDAK ADA
  echo      - node_modules\... : TIDAK ADA
  echo      - @caveman-ai/cli   : TIDAK TERINSTAL
  echo [CAVEMAN][FAIL] Tidak menginstal tanpa persetujuan Ketua.
  echo [CAVEMAN][INFO ] Wiring fail-open tetap AMAN: runtime akan log
  echo      caveman=BYPASS (unavailable) dan menuju langsung 9Router :20128.
  echo [CAVEMAN][EXIT ] 2 = binary not available.
  exit /b 2
)

REM ---------------------------------------------------------------------------
REM  STEP 2 - Pre-flight: pastikan port listener bebas dan tanpa 0.0.0.0.
REM ---------------------------------------------------------------------------
netstat -ano | findstr /R /C:":%BIN_PORT% " >nul 2>nul
if %ERRORLEVEL%==0 (
  echo [CAVEMAN][FAIL] Port %BIN_PORT% sudah dipakai. Cek listener (0.0.0.0 -> FAIL CLOSED).
  exit /b 3
)

REM ---------------------------------------------------------------------------
REM  STEP 3 - Mulai proxy Caveman (mode B2, kompresi input).
REM  Suntik credential NINEROUTER_KEY agar forward ke 9Router :20128 diterima.
REM ---------------------------------------------------------------------------
echo [CAVEMAN][INFO ] Binary Caveman terdeteksi di: %BIN%

REM --- Muat NINEROUTER_KEY dari env atau ~/.unit-elite-secrets/9router.key ---
set "NINEROUTER_KEY=%NINEROUTER_KEY%"
if not defined NINEROUTER_KEY (
  set "NINEROUTER_KEY=%NINEROUTER_API_KEY%"
)
if not defined NINEROUTER_KEY (
  if exist "%USERPROFILE%\.unit-elite-secrets\9router.key" (
    set /p NINEROUTER_KEY=<"%USERPROFILE%\.unit-elite-secrets\9router.key"
  )
)

if not defined NINEROUTER_KEY (
  echo [CAVEMAN][WARN ] NINEROUTER_KEY tidak ditemukan. Forward ke 9Router bisa gagal auth.
)

REM --- Konfigurasi proxy ---
set "CAVE_SSRF_ALLOWLIST=127.0.0.1:20128"
set "CAVEMAN_CONFIG=%~dp0caveman.yaml"

echo [CAVEMAN][INFO ] Proxy bind 127.0.0.1:20127 (mode B2, SSRF-allowlist=9Router:20128).
echo [CAVEMAN][INFO ] Menjalankan: %BIN% start
call %BIN% start
echo [CAVEMAN][EXIT ] exit=%errorlevel%
exit /b %errorlevel%