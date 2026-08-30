@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=Join-Path '%~dp0' 'integrations\whatsapp-service\transport-state.json'; $o=[ordered]@{version=1;mode='SUSPENDED';reason='bridge_under_repair';fallback='EXCEL_WA_ME';updated_at=(Get-Date).ToString('o');note='Manual suspension'}; $o|ConvertTo-Json|Set-Content -LiteralPath $p -Encoding UTF8; Write-Host 'WHATSAPP_TRANSPORT=SUSPENDED FALLBACK=EXCEL_WA_ME'"
endlocal
