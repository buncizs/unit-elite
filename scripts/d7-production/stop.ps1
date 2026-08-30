. "$PSScriptRoot\common.ps1"

Write-Host '[STOP] Unit Elite production shutdown'

$stopFailed = $false

if (Test-OwnedOpenCode) {
    $state = Get-OwnedOpenCodeState
    $pidOwned = [int]$state.pid
    Write-Host "Stopping managed OpenCode tree PID=$pidOwned ..."
    & taskkill.exe /PID $pidOwned /T /F | Out-Null
    Start-Sleep -Milliseconds 500
    if (Get-CimInstance Win32_Process -Filter ("ProcessId=" + $pidOwned) -ErrorAction SilentlyContinue) {
        Write-Host "OPENCODE_STOP_FAIL PID=$pidOwned"
        $stopFailed = $true
    } else {
        Write-Host "OPENCODE_STOP_PASS PID=$pidOwned"
        Clear-OwnedOpenCodeState
    }
} else {
    $oc = @(Get-OpenCodeMainProcesses)
    if ($oc.Count -gt 0) {
        Write-Host "OPENCODE_EXTERNAL_SKIP PID=$($oc[0].ProcessId)"
    } else {
        Write-Host 'OPENCODE_ALREADY_STOPPED'
        Clear-OwnedOpenCodeState
    }
}


if (-not (Stop-WhatsAppManaged)) {
    $stopFailed = $true
}

& (Join-Path $Root 'integrations\9router\runtime\stop-runtime.cmd')
if ($LASTEXITCODE -ne 0) {
    Write-Host "RUNTIME_STOP_CONTROLLER_FAIL exit=$LASTEXITCODE"
    $stopFailed = $true
}

& (Join-Path $Root 'integrations\9router\stop-9router.cmd')
if ($LASTEXITCODE -ne 0) {
    Write-Host "ROUTER_STOP_CONTROLLER_FAIL exit=$LASTEXITCODE"
    $stopFailed = $true
}

$s = Get-ComponentSnapshot
Write-Host "UNIT_ELITE_STATUS=$($s.Overall) ROUTER=$($s.Router) RUNTIME=$($s.Runtime) WHATSAPP=$($s.WhatsApp) OPENCODE=$($s.OpenCode)"

if ($stopFailed) { exit 1 }

if ($s.Router -eq 'STOPPED' -and $s.Runtime -eq 'STOPPED' -and $s.WhatsApp -eq 'STOPPED') {
    Write-Host 'UNIT_ELITE_STOP_PASS'
    exit 0
}

Write-Host 'UNIT_ELITE_STOP_INCOMPLETE'
exit 2
