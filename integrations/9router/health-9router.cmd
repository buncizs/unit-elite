@echo off
setlocal EnableDelayedExpansion
REM ============================================================================
REM  health-9router.cmd
REM  Read-only health check for 9Router (Unit Elite TECH-0001-BIND-01)
REM ============================================================================
REM  Reports:
REM    1. Is the 9Router process alive (bound to loopback)? PID.
REM    2. Is 127.0.0.1:20128 LISTENING?
REM    3. API health: GET /api/health -> 200 {"ok":true}.
REM    4. DETECT exposure: if 0.0.0.0:20128 is LISTENING -> WARNING / FAIL.
REM  Exit codes: 0 = healthy; 1 = not running / unhealthy; 2 = exposed.
REM  This file makes NO changes (read-only).
REM ============================================================================

set "PORT=20128"
set "HEALTH_URL=http://127.0.0.1:%PORT%/api/health"

REM --- Listeners -------------------------------------------------------------
set "LOOPBACK=0"
set "LOOPBACK_PID="
set "WIDE_OPEN=0"

REM netstat line: PROTO LOCAL FOREIGN STATE PID  => with tokens=2-5:
REM   %%A=LOCAL %%B=FOREIGN %%C=STATE %%D=PID
for /f "tokens=2-5 delims= " %%A in ('netstat -ano ^| findstr ":%PORT%"') do (
    for %%S in ("%%C") do if "%%~S"=="LISTENING" (
        echo %%A | findstr /b "127.0.0.1:" >nul
        if not errorlevel 1 (
            set "LOOPBACK=1"
            if not defined LOOPBACK_PID set "LOOPBACK_PID=%%D"
        )
        echo %%A | findstr /b "0.0.0.0:" >nul
        if not errorlevel 1 set "WIDE_OPEN=1"
    )
)

echo [9ROUTER] ------------------------------------------------
echo [9ROUTER] Listener 127.0.0.1:%PORT%  : !LOOPBACK!
echo [9ROUTER] Binding PID (loopback)  : !LOOPBACK_PID!
echo [9ROUTER] Exposure 0.0.0.0:%PORT% : !WIDE_OPEN!

REM --- API health ------------------------------------------------------------
set "HEALTH_OUT="
for /f "delims=" %%H in ('powershell -NoProfile -Command "$u='%HEALTH_URL%'; try{$r=Invoke-WebRequest -Uri $u -UseBasicParsing -TimeoutSec 8; $b=$r.Content; if($b -is [byte[]]){ $b=[System.Text.Encoding]::UTF8.GetString($b) }; Write-Output ($r.StatusCode.ToString()+' '+$b.Trim())}catch{Write-Output ('ERR '+$_.Exception.Message)}"') do set "HEALTH_OUT=%%H"
echo [9ROUTER] API %HEALTH_URL% : !HEALTH_OUT!

set "HTTP_OK=0"
echo !HEALTH_OUT! | findstr /b "200" >nul && set "HTTP_OK=1"

REM --- Assessment ------------------------------------------------------------
if "!WIDE_OPEN!"=="1" (
    echo [9ROUTER][SECURITY] FAIL: 0.0.0.0:%PORT% is LISTENING - 9Router exposed beyond loopback.
    exit /b 2
)
if "!LOOPBACK!"=="0" (
    echo [9ROUTER][WARN] 9Router is NOT listening on 127.0.0.1:%PORT%.
    exit /b 1
)
if "!HTTP_OK!"=="1" if "!LOOPBACK_PID!" NEQ "" (
    echo [9ROUTER][OK] 9Router healthy: loopback listener PID !LOOPBACK_PID!, API 200.
    exit /b 0
)

echo [9ROUTER][WARN] 9Router listener present but API health not confirmed (HTTP 200 expected).
exit /b 1
endlocal
