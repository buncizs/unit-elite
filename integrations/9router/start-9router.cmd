@echo off
setlocal EnableDelayedExpansion
REM ============================================================================
REM  start-9router.cmd
REM  Deterministic 9Router launcher for Unit Elite (TECH-0001-BIND-01)
REM ============================================================================
REM  CONTRACTS ENFORCED:
REM    1. Resolve a legitimate 9Router executable. Prefer verified absolute
REM       paths on this machine (node.exe + 9router cli.js); fall back to
REM       `where node` / `where 9router` when available on PATH. Never rely on
REM       a hardcoded path when it can be detected, but use the verified path
REM       as the default (the opencode session PATH is trimmed, so `where`
REM       often returns nothing and absolute defaults are required).
REM    2. Guarantee NO duplicate listener on port 20128 BEFORE start:
REM         - existing 127.0.0.1 (loopback) healthy 9Router -> "already running",
REM           idempotent SKIP (safe).
REM         - existing 0.0.0.0 listener -> report conflict -> FAIL (no double start).
REM    3. Start 9Router explicitly with:
REM         --host 127.0.0.1 --port 20128 --tray --skip-update
REM       (env HOSTNAME/PORT are NOT honoured by cli.js, so never rely on them).
REM    4. Poll GET /api/health until 200 or timeout (default 30s).
REM    5. Verify listener: 127.0.0.1:20128 LISTENING and 0.0.0.0:20128 ABSENT.
REM    6. FAIL CLOSED if 0.0.0.0:20128 is found (non-zero exit + clear message).
REM    7. Basic health/API check -> 200 {"ok":true}.
REM    8. NO credential stored (nothing written to file/log).
REM    9. Does NOT modify 9Router source.
REM   10. Does NOT modify OpenCode.
REM ============================================================================

set "PORT=20128"
set "HOST=127.0.0.1"
set "HEALTH_URL=http://127.0.0.1:20128/api/health"
set "TIMEOUT_SEC=30"
set "POLL_INTERVAL_SEC=2"

REM ---------------------------------------------------------------------------
REM (1) Resolve the 9Router executable.
REM ---------------------------------------------------------------------------
set "NODE_EXE="
set "CLI_JS="
set "RESOLVED_BY="

REM --- primary: verified absolute defaults -----------------------------------
if not defined NODE_EXE if exist "C:\Program Files\nodejs\node.exe" (
    set "NODE_EXE=C:\Program Files\nodejs\node.exe"
    set "RESOLVED_BY=verified-node-default"
)
if not defined NODE_EXE if exist "%ProgramFiles(x86)%\nodejs\node.exe" (
    set "NODE_EXE=%ProgramFiles(x86)%\nodejs\node.exe"
    set "RESOLVED_BY=verified-node-x86"
)

REM --- fallback: `where node` (only if PATH provides it) ----------------------
if not defined NODE_EXE (
    for /f "delims=" %%N in ('where node 2^>nul') do (
        if not defined NODE_EXE set "NODE_EXE=%%N"
        if not defined RESOLVED_BY set "RESOLVED_BY=where-node"
    )
)

REM --- resolve cli.js: derive from npm global root when available ------------
set "GLOBAL_NM="
for /f "delims=" %%R in ('npm root -g 2^>nul') do if not defined GLOBAL_NM set "GLOBAL_NM=%%R"
if defined GLOBAL_NM if exist "!GLOBAL_NM!\9router\cli.js" (
    set "CLI_JS=!GLOBAL_NM!\9router\cli.js"
    set "RESOLVED_BY=!RESOLVED_BY!+npm-root-g"
)

REM --- fallback cli.js: %APPDATA%\npm\node_modules (the known global layout) --
if not defined CLI_JS if exist "%APPDATA%\npm\node_modules\9router\cli.js" (
    set "CLI_JS=%APPDATA%\npm\node_modules\9router\cli.js"
    set "RESOLVED_BY=!RESOLVED_BY!+appdata-global"
)

REM --- hard failure if we cannot find a legitimate executable -----------------
if not defined NODE_EXE (
    echo [9ROUTER][ERROR] Could not locate node.exe ^(checked verified default and `where node`^).
    exit /b 1
)
if not defined CLI_JS (
    echo [9ROUTER][ERROR] Could not locate 9router\cli.js ^(checked npm root -g and %%APPDATA%%\npm\node_modules^).
    exit /b 1
)
if not exist "%CLI_JS%" (
    echo [9ROUTER][ERROR] Resolved cli.js does not exist: "%CLI_JS%"
    exit /b 1
)

echo [9ROUTER] Resolved executable ^(via %RESOLVED_BY%^):
echo [9ROUTER]   node.exe : "%NODE_EXE%"
echo [9ROUTER]   cli.js   : "%CLI_JS%"

REM ---------------------------------------------------------------------------
REM (2) Pre-flight: inspect current listeners on :PORT.
REM ---------------------------------------------------------------------------
set "HAS_NON_LOOPBACK=0"
set "HAS_LOOPBACK=0"

REM netstat line: PROTO LOCAL FOREIGN STATE PID  => with tokens=2-5:
REM   %%A=LOCAL %%B=FOREIGN %%C=STATE %%D=PID
for /f "tokens=2-5 delims= " %%A in ('netstat -ano ^| findstr ":%PORT%"') do (
    for %%S in ("%%C") do (
        if "%%~S"=="LISTENING" (
            echo %%A | findstr /b "0.0.0.0:" >nul
            if not errorlevel 1 (
                set "HAS_NON_LOOPBACK=1"
            )
            echo %%A | findstr /b "%HOST%:" >nul
            if not errorlevel 1 (
                set "HAS_LOOPBACK=1"
            )
        )
    )
)

REM --- Exact 0.0.0.0 exposure -> FAIL CLOSED --------------------------------
REM --- Per-field LOCAL check (%%A = LOCAL address, tokens=2-5): only a LOCAL
REM --- address that begins with "0.0.0.0:" while LISTENING counts as exposure.
REM --- The foreign address "0.0.0.0:0" (tokens=3) is deliberately ignored;
REM --- line-level matching of "0.0.0.0" would false-positive on every
REM --- LISTENING line (loopback listeners would be reported as exposed).
for /f "tokens=2-5 delims= " %%A in ('netstat -ano ^| findstr ":%PORT%"') do (
    for %%S in ("%%C") do if "%%~S"=="LISTENING" (
        echo %%A | findstr /b "0.0.0.0:" >nul
        if not errorlevel 1 set "HAS_NON_LOOPBACK=1"
    )
)
if "!HAS_NON_LOOPBACK!"=="1" (
    echo [9ROUTER][FATAL] Listener 0.0.0.0:20128 detected - potential exposure/conflict.
    echo [9ROUTER][FATAL] Refusing to start. Resolve the conflicting process first.
    exit /b 3
)

REM --- Loopback already healthy -> idempotent skip ---------------------------
if "!HAS_LOOPBACK!"=="1" (
    if exist "%CLI_JS%" (
        echo [9ROUTER] 127.0.0.1:%PORT% already LISTENING - checking health...
        powershell -NoProfile -Command ^
          "$u='http://127.0.0.1:%PORT%/api/health'; try{$r=Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 8; if($r.StatusCode -eq 200){Write-Output ('OK '+$r.Content)}else{Write-Output ('BAD '+$r.StatusCode); exit 1}}catch{Write-Output ('ERR '+$_.Exception.Message); exit 1}"
        if errorlevel 1 goto :skip_health_fail
        echo [9ROUTER] 9Router already running and healthy [loopback]. Skipping start - idempotent-safe.
        exit /b 0
    )
)

REM ---------------------------------------------------------------------------
REM (3) Start 9Router.
REM ---------------------------------------------------------------------------
echo [9ROUTER] Starting 9Router (background/tray mode, non-interactive safe)...
start "" "%NODE_EXE%" --dns-result-order=ipv4first "%CLI_JS%" --tray --skip-update --host %HOST% --port %PORT%

REM ---------------------------------------------------------------------------
REM (4) Wait for service startup (poll health until 200 or timeout).
REM ---------------------------------------------------------------------------
echo [9ROUTER] Waiting for health on %HEALTH_URL% ^(timeout %TIMEOUT_SEC%s^)...
set "ELAPSED=0"
:health_loop
if !ELAPSED! GEQ %TIMEOUT_SEC% (
    echo [9ROUTER][ERROR] Timed out waiting for %HEALTH_URL% to return 200.
    goto :fail
)
powershell -NoProfile -Command ^
  "$u='http://127.0.0.1:%PORT%/api/health'; try{$r=Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 3; if($r.StatusCode -eq 200){exit 0}else{exit 1}}catch{exit 1}"
if not errorlevel 1 (
    echo [9ROUTER] Health OK - HTTP 200.
    goto :verify
)
timeout /t %POLL_INTERVAL_SEC% /nobreak >nul
set /a ELAPSED=!ELAPSED!+%POLL_INTERVAL_SEC%
goto :health_loop

:fail
exit /b 2

REM ---------------------------------------------------------------------------
REM (5)+(6) Verify listener: loopback LISTENING, no 0.0.0.0 LISTENING.
REM ---------------------------------------------------------------------------
:verify
set "LOOPBACK_OK=0"
set "WIDE_OPEN=0"
for /f "tokens=2-5 delims= " %%A in ('netstat -ano ^| findstr ":%PORT%"') do (
    for %%S in ("%%C") do if "%%~S"=="LISTENING" (
        echo %%A | findstr /b "%HOST%:" >nul
        if not errorlevel 1 set "LOOPBACK_OK=1"
        echo %%A | findstr /b "0.0.0.0:" >nul
        if not errorlevel 1 set "WIDE_OPEN=1"
    )
)

if "!WIDE_OPEN!"=="1" (
    echo [9ROUTER][FATAL] FAIL CLOSED: 0.0.0.0:20128 found in LISTENING after start.
    echo [9ROUTER][FATAL] 9Router is exposed. Refusing to report success.
    exit /b 3
)
if "!LOOPBACK_OK!"=="1" (
    echo [9ROUTER] Verified: 127.0.0.1:%PORT% LISTENING, no 0.0.0.0:%PORT% listener. ^(FAIL CLOSED check passed^)
) else (
    echo [9ROUTER][ERROR] Loopback listener not confirmed on 127.0.0.1:%PORT%.
    exit /b 2
)

REM ---------------------------------------------------------------------------
REM (7) Final basic health/API check.
REM ---------------------------------------------------------------------------
powershell -NoProfile -Command ^
  "$u='http://127.0.0.1:%PORT%/api/health'; try{$r=Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 8; if($r.StatusCode -eq 200){Write-Output ('[9ROUTER] health 200 '+$r.Content); exit 0}else{Write-Output ('[9ROUTER][ERROR] status '+$r.StatusCode); exit 1}}catch{Write-Output ('[9ROUTER][ERROR] '+$_.Exception.Message); exit 1}"
if errorlevel 1 exit /b 2

echo [9ROUTER] START OK. 9Router running at http://127.0.0.1:%PORT%/  ^(loopback only^)
exit /b 0

:skip_health_fail
echo [9ROUTER][ERROR] Loopback listener exists but health check FAILED.
echo [9ROUTER][ERROR] Inspect the running process; do not double start.
exit /b 2

endlocal
