@echo off
setlocal
set /p NUM=Masukkan nomor uji format 62... (gunakan nomor milik sendiri/tim): 
powershell -NoProfile -Command "$body=@{numbers=@('%NUM%')}|ConvertTo-Json; try { Invoke-RestMethod -Uri 'http://127.0.0.1:8080/api/verify' -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 10 | ConvertTo-Json -Depth 5 } catch { Write-Host ('VERIFY FAILED: ' + $_.Exception.Message); exit 1 }"
pause
