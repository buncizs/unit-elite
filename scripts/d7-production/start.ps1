. "$PSScriptRoot\common.ps1"

Write-Host '[START] Unit Elite production startup'

if (-not (Assert-Preflight)) { exit 10 }

if (Test-WideOpen $RouterPort) {
    Write-Host 'BLOCKED_9ROUTER_EXPOSED_0.0.0.0'
    exit 11
}

if (-not (Test-9RouterAppHealth)) {
    Write-Host '[START] Starting/recovering 9Router...'
    & (Join-Path $Root 'integrations\9router\start-9router.cmd')
    if ($LASTEXITCODE -ne 0) {
        Write-Host "BLOCKED_9ROUTER_START exit=$LASTEXITCODE"
        exit 12
    }
}

$routerReady = $false
for ($i=0; $i -lt 10; $i++) {
    if (Test-9RouterAppHealth) { $routerReady = $true; break }
    Start-Sleep -Milliseconds 500
}
if (-not $routerReady) {
    Write-Host 'BLOCKED_9ROUTER_V1_MODELS_HEALTH'
    exit 13
}
Write-Host 'ROUTER_READY endpoint=127.0.0.1:20128'

Write-Host '[START] Starting optional Caveman proxy (fail-open)...'
[void](Start-CavemanManaged)

if (Test-WideOpen $RuntimePort) {
    Write-Host 'BLOCKED_RUNTIME_EXPOSED_0.0.0.0'
    exit 14
}

if (-not (Test-RuntimeHealth)) {
    Write-Host '[START] Starting Unit Elite Runtime...'
    & (Join-Path $Root 'integrations\9router\runtime\start-runtime.cmd')
    if ($LASTEXITCODE -ne 0) {
        Write-Host "BLOCKED_RUNTIME_START exit=$LASTEXITCODE"
        exit 15
    }
}

$runtimeReady = $false
for ($i=0; $i -lt 10; $i++) {
    if (Test-RuntimeHealth) { $runtimeReady = $true; break }
    Start-Sleep -Milliseconds 500
}
if (-not $runtimeReady) {
    Write-Host 'BLOCKED_RUNTIME_HEALTH'
    exit 16
}
Write-Host 'RUNTIME_READY endpoint=127.0.0.1:20129'


if (-not (Start-WhatsAppManaged)) {
    Write-Host 'BLOCKED_WHATSAPP_START'
    exit 17
}
if (Test-WhatsAppTransportSuspended) {
    Write-Host 'WHATSAPP_SUSPENDED fallback=EXCEL_WA_ME'
} else {
    Write-Host 'WHATSAPP_READY endpoint=127.0.0.1:8080/api'
}

if (-not (Start-OpenCodeManaged)) { exit 19 }

$s = Get-ComponentSnapshot
Write-Host "UNIT_ELITE_STATUS=$($s.Overall) ROUTER=$($s.Router) RUNTIME=$($s.Runtime) WHATSAPP=$($s.WhatsApp) OPENCODE=$($s.OpenCode) CAVEMAN=$($s.Caveman)"
Write-Host "CAVEMAN_STATUS value=$($s.Caveman)"

if (
    $s.Router -eq 'READY' -and
    $s.Runtime -eq 'READY' -and
    $s.WhatsApp -eq 'READY_OWNED' -and
    $s.OpenCode -eq 'RUNNING_OWNED'
) {
    if ($s.WhatsApp -eq 'SUSPENDED') {
        Write-Host 'UNIT_ELITE_START_PASS_FALLBACK WHATSAPP=SUSPENDED FALLBACK=EXCEL_WA_ME'
    } else {
        Write-Host 'UNIT_ELITE_START_PASS'
    }
    exit 0
}

Write-Host 'UNIT_ELITE_START_INCOMPLETE'
exit 18
