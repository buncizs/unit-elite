. "$PSScriptRoot\common.ps1"

$MaxAttempts = 3
Write-Host "[RECOVER] Unit Elite bounded recovery max_attempts=$MaxAttempts"

if (-not (Assert-Preflight)) { exit 20 }

for ($attempt = 1; $attempt -le $MaxAttempts; $attempt++) {
    Write-Host "RECOVERY_ATTEMPT=$attempt"

    if (-not (Test-9RouterAppHealth)) {
        Write-Host '[RECOVER] 9Router unhealthy; safe targeted restart.'
        & (Join-Path $Root 'integrations\9router\stop-9router.cmd')
        if ($LASTEXITCODE -eq 0) {
            & (Join-Path $Root 'integrations\9router\start-9router.cmd')
        }
    }

    if (Test-9RouterAppHealth) {
        if (-not (Test-RuntimeHealth)) {
            Write-Host '[RECOVER] Runtime unhealthy; safe targeted restart.'
            & (Join-Path $Root 'integrations\9router\runtime\stop-runtime.cmd')
            if ($LASTEXITCODE -eq 0) {
                & (Join-Path $Root 'integrations\9router\runtime\start-runtime.cmd')
            }
        }
    }


    if ((Test-9RouterAppHealth) -and (Test-RuntimeHealth) -and -not (Test-WhatsAppTransportSuspended)) {
        if (-not (Test-WhatsAppHealth)) {
            Write-Host '[RECOVER] WhatsApp Bridge unhealthy; safe targeted restart.'
            [void](Stop-WhatsAppManaged)
            [void](Start-WhatsAppManaged)
        }
    }

    if ((Test-9RouterAppHealth) -and (Test-RuntimeHealth) -and ((Test-WhatsAppHealth) -or (Test-WhatsAppTransportSuspended))) {
        [void](Start-OpenCodeManaged)
    }

    $s = Get-ComponentSnapshot
    Write-Host "RECOVERY_STATUS attempt=$attempt overall=$($s.Overall) router=$($s.Router) runtime=$($s.Runtime) whatsapp=$($s.WhatsApp) opencode=$($s.OpenCode)"

    if (
        $s.Router -eq 'READY' -and
        $s.Runtime -eq 'READY' -and
        $s.WhatsApp -eq 'READY_OWNED' -and
        $s.OpenCode -eq 'RUNNING_OWNED'
    ) {
        Write-Host "UNIT_ELITE_RECOVER_PASS attempts=$attempt"
        exit 0
    }

    if ($attempt -lt $MaxAttempts) { Start-Sleep -Seconds 2 }
}

Write-Host 'UNIT_ELITE_RECOVER_FAIL'
Write-Host 'RECOVERY_POLICY: no reinstall, no credential reset, no SQLite deletion, no routing-policy modification.'
exit 21

if (Test-WhatsAppTransportSuspended) { Write-Host 'WHATSAPP_RECOVERY_SKIPPED_SUSPENDED fallback=EXCEL_WA_ME' }
