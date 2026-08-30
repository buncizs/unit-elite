@echo off
REM Check Unit Elite Runtime Gateway status
cd /d "%~dp0"
if exist runtime-gateway.pid (
  set /p PID=<runtime-gateway.pid
  echo Checking Runtime Gateway PID %PID%...
  tasklist /FI "PID eq %PID%" /NH 2>nul | findstr /I "node" && (
    echo Runtime Gateway is RUNNING on port 20129
    curl -s http://127.0.0.1:20129/health 2>nul || echo Health check failed
  ) || (
    echo Runtime Gateway is NOT running (stale PID file)
    del runtime-gateway.pid 2>nul
  )
) else (
  echo No PID file found. Runtime Gateway is not running.
)
