@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p=Join-Path '%~dp0' 'integrations\whatsapp-service\transport-state.json'; $o=[ordered]@{version=1;mode='ACTIVE';reason=$null;fallback='EXCEL_WA_ME';updated_at=(Get-Date).ToString('o');note='Manual resume'}; $o|ConvertTo-Json|Set-Content -LiteralPath $p -Encoding UTF8; Write-Host 'WHATSAPP_TRANSPORT=ACTIVE'; Write-Host 'NEXT=Run START-UNIT-ELITE.cmd or RECOVER-UNIT-ELITE.cmd to start/check the bridge.'"
endlocal
