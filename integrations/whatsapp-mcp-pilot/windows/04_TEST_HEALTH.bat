@echo off
powershell -NoProfile -Command "try { $r=Invoke-RestMethod -Uri 'http://127.0.0.1:8080/api/health' -Method Get -TimeoutSec 5; $r | ConvertTo-Json -Depth 4 } catch { Write-Host ('BRIDGE TEST FAILED: ' + $_.Exception.Message); exit 1 }"
pause
