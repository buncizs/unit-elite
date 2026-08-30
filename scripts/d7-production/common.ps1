
# UNIT_ELITE_MANAGED:WHATSAPP_TRANSPORT_SUSPEND_V2_BEGIN
function Get-WhatsAppTransportMode {
    try {
        $transportFile = Join-Path $Root 'integrations\whatsapp-service\transport-state.json'
        if (-not (Test-Path -LiteralPath $transportFile)) { return 'ACTIVE' }
        $transport = Get-Content -LiteralPath $transportFile -Raw | ConvertFrom-Json
        if (-not $transport.mode) { return 'ACTIVE' }
        return ([string]$transport.mode).ToUpperInvariant()
    } catch {
        return 'SUSPENDED'
    }
}

function Test-WhatsAppTransportSuspended {
    return ((Get-WhatsAppTransportMode) -eq 'SUSPENDED')
}
# UNIT_ELITE_MANAGED:WHATSAPP_TRANSPORT_SUSPEND_V2_END

$ErrorActionPreference = 'Stop'

$ProdDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = (Resolve-Path (Join-Path $ProdDir '..\..')).Path
$StateDir = Join-Path $ProdDir 'state'
$OpenCodeState = Join-Path $StateDir 'opencode-owned.json'
$RouterPort = 20128
$RuntimePort = 20129
$WhatsAppPort = 8080
$WhatsAppBridgeDir = 'D:\OpenCode\whatsapp-mcp-main\whatsapp-bridge'
$WhatsAppBridgeExe = Join-Path $WhatsAppBridgeDir 'whatsapp-bridge.exe'
$WhatsAppState = Join-Path $StateDir 'whatsapp-owned.json'
$WhatsAppLog = Join-Path $StateDir 'whatsapp-bridge.log'
$WhatsAppErrLog = Join-Path $StateDir 'whatsapp-bridge.err.log'
$Loopback = '127.0.0.1'
$SecretFile = Join-Path $env:USERPROFILE '.unit-elite-secrets\9router.key'

function Get-Listener([int]$Port) {
    Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
}

function Get-LoopbackListener([int]$Port) {
    Get-Listener $Port | Where-Object { $_.LocalAddress -eq '127.0.0.1' } | Select-Object -First 1
}

function Test-WideOpen([int]$Port) {
    $x = Get-Listener $Port | Where-Object { $_.LocalAddress -eq '0.0.0.0' } | Select-Object -First 1
    return [bool]$x
}

function Read-9RouterKey {
    if (-not (Test-Path -LiteralPath $SecretFile)) { return $null }
    try {
        $k = (Get-Content -LiteralPath $SecretFile -Raw).Trim()
        if ([string]::IsNullOrWhiteSpace($k)) { return $null }
        return $k
    } catch {
        return $null
    }
}

function Test-9RouterAppHealth {
    if (Test-WideOpen $RouterPort) { return $false }
    if (-not (Get-LoopbackListener $RouterPort)) { return $false }

    $key = Read-9RouterKey
    if (-not $key) { return $false }

    try {
        $headers = @{ Authorization = "Bearer $key" }
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$RouterPort/v1/models" -Headers $headers -UseBasicParsing -TimeoutSec 5
        return ($r.StatusCode -eq 200)
    } catch {
        return $false
    }
}

function Test-RuntimeHealth {
    if (Test-WideOpen $RuntimePort) { return $false }
    $l = Get-LoopbackListener $RuntimePort
    if (-not $l) { return $false }

    try {
        $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + [int]$l.OwningProcess) -ErrorAction SilentlyContinue
        if (-not $p) { return $false }
        if ([string]$p.ExecutablePath -notmatch '(?i)node(\.exe)?$') { return $false }
        if ([string]$p.CommandLine -notmatch '(?i)runtime-gateway\.cjs') { return $false }

        $h = Invoke-RestMethod -Uri "http://127.0.0.1:$RuntimePort/health" -TimeoutSec 5
        return (
            $h.status -eq 'ready' -and
            $h.runtime -eq 'unit-elite-runtime' -and
            $h.router -eq 'healthy' -and
            $h.routing_policy -eq 'loaded' -and
            $h.fallback_controller -eq 'ready' -and
            $h.gemini_quarantine -eq $true
        )
    } catch {
        return $false
    }
}


function Get-WhatsAppListener {
    Get-NetTCPConnection -LocalPort $WhatsAppPort -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalAddress -eq '127.0.0.1' } |
        Select-Object -First 1
}

function Test-WhatsAppWideOpen {
    $x = Get-NetTCPConnection -LocalPort $WhatsAppPort -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.LocalAddress -eq '0.0.0.0' } |
        Select-Object -First 1
    return [bool]$x
}

function Test-IsCanonicalWhatsAppProcess([int]$ProcessId) {
    $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + $ProcessId) -ErrorAction SilentlyContinue
    if (-not $p) { return $false }

    if (-not (Test-Path -LiteralPath $WhatsAppBridgeExe)) { return $false }
    $resolved = (Resolve-Path -LiteralPath $WhatsAppBridgeExe).Path

    return (
        $p.ExecutablePath -and
        ([string]$p.ExecutablePath -ieq $resolved)
    )
}

function Test-WhatsAppHealth {
    if (Test-WhatsAppWideOpen) { return $false }

    $listener = Get-WhatsAppListener
    if (-not $listener) { return $false }
    if (-not (Test-IsCanonicalWhatsAppProcess ([int]$listener.OwningProcess))) { return $false }

    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$WhatsAppPort/api/health" -UseBasicParsing -TimeoutSec 5
        return ($r.StatusCode -eq 200)
    } catch {
        return $false
    }
}

function Get-OwnedWhatsAppState {
    if (-not (Test-Path -LiteralPath $WhatsAppState)) { return $null }
    try {
        return (Get-Content -LiteralPath $WhatsAppState -Raw | ConvertFrom-Json)
    } catch {
        return $null
    }
}

function Test-OwnedWhatsApp {
    $s = Get-OwnedWhatsAppState
    if (-not $s -or -not $s.owned -or -not $s.pid) { return $false }
    return (Test-IsCanonicalWhatsAppProcess ([int]$s.pid))
}

function Save-OwnedWhatsApp([int]$ProcessId) {
    New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
    [ordered]@{
        owned = $true
        pid = $ProcessId
        executable = $WhatsAppBridgeExe
        working_directory = $WhatsAppBridgeDir
        started_at = (Get-Date).ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $WhatsAppState -Encoding ascii
}

function Clear-OwnedWhatsAppState {
    Remove-Item -LiteralPath $WhatsAppState -Force -ErrorAction SilentlyContinue
}

function Start-WhatsAppManaged {
    if (Test-WhatsAppTransportSuspended) {
        Clear-OwnedWhatsAppState
        Write-Host 'WHATSAPP_SUSPENDED reason=bridge_under_repair fallback=EXCEL_WA_ME'
        return $true
    }
    if (Test-WhatsAppWideOpen) {
        Write-Host 'BLOCKED_WHATSAPP_EXPOSED_0.0.0.0'
        return $false
    }

    $listener = Get-WhatsAppListener
    if ($listener) {
        $pidExisting = [int]$listener.OwningProcess
        if (-not (Test-IsCanonicalWhatsAppProcess $pidExisting)) {
            Write-Host "BLOCKED_WHATSAPP_PORT_FOREIGN_PROCESS PID=$pidExisting"
            return $false
        }

        if (Test-WhatsAppHealth) {
            if (Test-OwnedWhatsApp) {
                Write-Host "WHATSAPP_ALREADY_RUNNING_OWNED PID=$pidExisting"
            } else {
                Write-Host "WHATSAPP_ALREADY_RUNNING_EXTERNAL PID=$pidExisting"
            }
            return $true
        }

        Write-Host "BLOCKED_WHATSAPP_UNHEALTHY PID=$pidExisting"
        return $false
    }

    if (-not (Test-Path -LiteralPath $WhatsAppBridgeExe)) {
        Write-Host "BLOCKED_WHATSAPP_EXECUTABLE_MISSING path=$WhatsAppBridgeExe"
        return $false
    }

    if (-not (Test-Path -LiteralPath $WhatsAppBridgeDir)) {
        Write-Host "BLOCKED_WHATSAPP_WORKDIR_MISSING path=$WhatsAppBridgeDir"
        return $false
    }

    New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

    Write-Host 'WHATSAPP_CONSOLE_OPENING'
    Write-Host 'WHATSAPP_STATUS=CONNECTING'
    Write-Host 'WHATSAPP_ACTION=If a QR code appears in the WhatsApp Bridge window, scan it from WhatsApp > Linked devices.'
    Write-Host 'WHATSAPP_PAIRING_TIMEOUT_SECONDS=300'

    # Deliberately do not redirect stdout/stderr here.
    # The bridge console is the operator UI for session/QR status.
    $startArgs = @{
        FilePath = $WhatsAppBridgeExe
        WorkingDirectory = $WhatsAppBridgeDir
        WindowStyle = 'Normal'
        PassThru = $true
    }

    $p = Start-Process @startArgs
    $pairingNoticeShown = $false

    # Allow enough time for either an existing session to reconnect or
    # a human to scan a QR code. 600 x 500 ms = 300 seconds.
    for ($i = 0; $i -lt 600; $i++) {
        Start-Sleep -Milliseconds 500

        if ($p.HasExited) {
            Write-Host "WHATSAPP_PROCESS_EXITED PID=$($p.Id) EXIT_CODE=$($p.ExitCode)"
            break
        }

        $l = Get-WhatsAppListener
        if (
            $l -and
            [int]$l.OwningProcess -eq $p.Id -and
            (Test-IsCanonicalWhatsAppProcess $p.Id) -and
            (Test-WhatsAppHealth)
        ) {
            Save-OwnedWhatsApp -ProcessId $p.Id
            Write-Host "WHATSAPP_CONNECTED PID=$($p.Id)"
            Write-Host "WHATSAPP_START_PASS PID=$($p.Id) PORT=$WhatsAppPort"
            return $true
        }

        # After ~10 seconds without health, make the expected QR action explicit.
        if (-not $pairingNoticeShown -and $i -ge 20) {
            Write-Host 'WHATSAPP_STATUS=WAITING_FOR_SESSION_OR_PAIRING'
            Write-Host 'WHATSAPP_ACTION=Check the visible WhatsApp Bridge window. If QR is shown, scan it. No restart is required after scanning.'
            $pairingNoticeShown = $true
        }
    }

    if (-not $p.HasExited -and (Test-IsCanonicalWhatsAppProcess $p.Id)) {
        Write-Host "WHATSAPP_PAIRING_TIMEOUT PID=$($p.Id)"
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }

    Clear-OwnedWhatsAppState

    if ($p.HasExited) {
        Write-Host 'BLOCKED_WHATSAPP_PROCESS_EXITED_BEFORE_READY'
    } else {
        Write-Host 'BLOCKED_WHATSAPP_PAIRING_TIMEOUT'
    }

    Write-Host 'WHATSAPP_ACTION=Run START-UNIT-ELITE.cmd again when ready. Do not delete the WhatsApp store.'
    return $false
}

function Stop-WhatsAppManaged {
    $listener = Get-WhatsAppListener

    if (-not $listener) {
        Clear-OwnedWhatsAppState
        Write-Host 'WHATSAPP_ALREADY_STOPPED'
        return $true
    }

    $pidListener = [int]$listener.OwningProcess

    if (-not (Test-IsCanonicalWhatsAppProcess $pidListener)) {
        Write-Host "BLOCKED_WHATSAPP_FOREIGN_PROCESS PID=$pidListener"
        return $false
    }

    if (-not (Test-OwnedWhatsApp)) {
        Write-Host "WHATSAPP_EXTERNAL_SKIP PID=$pidListener"
        return $true
    }

    $state = Get-OwnedWhatsAppState
    if ([int]$state.pid -ne $pidListener) {
        Write-Host "BLOCKED_WHATSAPP_OWNERSHIP_MISMATCH STATE_PID=$($state.pid) LISTENER_PID=$pidListener"
        return $false
    }

    Write-Host "Stopping managed WhatsApp Bridge PID=$pidListener ..."
    Stop-Process -Id $pidListener -Force -ErrorAction Stop

    for ($i = 0; $i -lt 20; $i++) {
        Start-Sleep -Milliseconds 250
        if (-not (Get-WhatsAppListener)) { break }
    }

    if (Get-WhatsAppListener) {
        Write-Host "WHATSAPP_STOP_FAIL PID=$pidListener"
        return $false
    }

    Clear-OwnedWhatsAppState
    Write-Host "WHATSAPP_STOP_PASS PID=$pidListener"
    return $true
}


function Resolve-OpenCodePath {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\@opencode-aidesktop\OpenCode.exe')
    )

    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath $c)) {
            return (Resolve-Path -LiteralPath $c).Path
        }
    }

    try {
        $cmd = Get-Command OpenCode.exe -ErrorAction Stop
        if ($cmd -and $cmd.Source -and (Test-Path -LiteralPath $cmd.Source)) {
            return (Resolve-Path -LiteralPath $cmd.Source).Path
        }
    } catch {}

    return $null
}

function Get-OpenCodeMainProcesses {
    $resolved = Resolve-OpenCodePath
    if (-not $resolved) { return @() }

    @(Get-CimInstance Win32_Process -Filter "Name='OpenCode.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.ExecutablePath -and
            ([string]$_.ExecutablePath -ieq $resolved) -and
            ([string]$_.CommandLine -notmatch '(?i)\s--type=')
        })
}

function Get-OwnedOpenCodeState {
    if (-not (Test-Path -LiteralPath $OpenCodeState)) { return $null }
    try {
        return (Get-Content -LiteralPath $OpenCodeState -Raw | ConvertFrom-Json)
    } catch {
        return $null
    }
}

function Test-OwnedOpenCode {
    $s = Get-OwnedOpenCodeState
    if (-not $s -or -not $s.owned -or -not $s.pid) { return $false }

    $p = Get-CimInstance Win32_Process -Filter ("ProcessId=" + [int]$s.pid) -ErrorAction SilentlyContinue
    if (-not $p) { return $false }

    $resolved = Resolve-OpenCodePath
    if (-not $resolved) { return $false }

    return (
        ([string]$p.ExecutablePath -ieq $resolved) -and
        ([string]$p.CommandLine -notmatch '(?i)\s--type=')
    )
}

function Save-OwnedOpenCode([int]$ProcessId, [string]$ExePath) {
    New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
    [ordered]@{
        owned = $true
        pid = $ProcessId
        executable = $ExePath
        started_at = (Get-Date).ToString('o')
    } | ConvertTo-Json | Set-Content -LiteralPath $OpenCodeState -Encoding ascii
}

function Clear-OwnedOpenCodeState {
    Remove-Item -LiteralPath $OpenCodeState -Force -ErrorAction SilentlyContinue
}

function Start-OpenCodeManaged {
    $existing = @(Get-OpenCodeMainProcesses)
    if ($existing.Count -gt 0) {
        $pidExisting = [int]$existing[0].ProcessId
        if (Test-OwnedOpenCode) {
            Write-Host "OPENCODE_ALREADY_RUNNING_OWNED PID=$pidExisting"
        } else {
            Write-Host "OPENCODE_ALREADY_RUNNING_EXTERNAL PID=$pidExisting"
        }
        return $true
    }

    $exe = Resolve-OpenCodePath
    if (-not $exe) {
        Write-Host 'BLOCKED_OPENCODE_EXECUTABLE_NOT_FOUND'
        return $false
    }

    $before = @((Get-OpenCodeMainProcesses | ForEach-Object { [int]$_.ProcessId }))
    $started = Start-Process -FilePath $exe -WorkingDirectory $Root -PassThru

    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 300

        $candidate = Get-CimInstance Win32_Process -Filter ("ProcessId=" + [int]$started.Id) -ErrorAction SilentlyContinue
        if ($candidate -and
            ([string]$candidate.ExecutablePath -ieq $exe) -and
            ([string]$candidate.CommandLine -notmatch '(?i)\s--type=')) {
            Save-OwnedOpenCode -ProcessId ([int]$candidate.ProcessId) -ExePath $exe
            Write-Host "OPENCODE_START_PASS PID=$($candidate.ProcessId)"
            return $true
        }

        $current = @(Get-OpenCodeMainProcesses)
        $new = $current | Where-Object { $before -notcontains [int]$_.ProcessId } | Select-Object -First 1
        if ($new) {
            Save-OwnedOpenCode -ProcessId ([int]$new.ProcessId) -ExePath $exe
            Write-Host "OPENCODE_START_PASS PID=$($new.ProcessId)"
            return $true
        }
    }

    Write-Host 'OPENCODE_START_FAIL'
    return $false
}

function Get-ComponentSnapshot {
    $routerWide = Test-WideOpen $RouterPort
    $runtimeWide = Test-WideOpen $RuntimePort
    $whatsappWide = Test-WhatsAppWideOpen

    $routerLoop = [bool](Get-LoopbackListener $RouterPort)
    $runtimeLoop = [bool](Get-LoopbackListener $RuntimePort)
    $whatsappLoop = [bool](Get-WhatsAppListener)

    $router =
        if ($routerWide) { 'BLOCKED_EXPOSED' }
        elseif (Test-9RouterAppHealth) { 'READY' }
        elseif ($routerLoop) { 'DEGRADED' }
        else { 'STOPPED' }

    $runtime =
        if ($runtimeWide) { 'BLOCKED_EXPOSED' }
        elseif (Test-RuntimeHealth) { 'READY' }
        elseif ($runtimeLoop) { 'DEGRADED' }
        else { 'STOPPED' }

    $whatsapp =
        if (Test-WhatsAppTransportSuspended) { 'SUSPENDED' }
        elseif ($whatsappWide) { 'BLOCKED_EXPOSED' }
        elseif (Test-WhatsAppHealth) {
            if (Test-OwnedWhatsApp) { 'READY_OWNED' } else { 'READY_EXTERNAL' }
        }
        elseif ($whatsappLoop) { 'DEGRADED' }
        else { 'STOPPED' }

    $oc = @(Get-OpenCodeMainProcesses)
    $openCode =
        if ($oc.Count -eq 0) { 'STOPPED' }
        elseif (Test-OwnedOpenCode) { 'RUNNING_OWNED' }
        else { 'RUNNING_EXTERNAL' }

    $overall =
        if ($router -like 'BLOCKED*' -or $runtime -like 'BLOCKED*' -or $whatsapp -like 'BLOCKED*') { 'BLOCKED' }
        elseif ($router -eq 'STOPPED' -and $runtime -eq 'STOPPED' -and $whatsapp -eq 'STOPPED') { 'STOPPED' }
        elseif (
            $router -eq 'READY' -and
            $runtime -eq 'READY' -and
            $whatsapp -eq 'READY_OWNED' -and
            $openCode -eq 'RUNNING_OWNED'
        ) { 'READY' }
        else { 'DEGRADED' }

    [pscustomobject]@{
        Overall = $overall
        Router = $router
        Runtime = $runtime
        WhatsApp = $whatsapp
        OpenCode = $openCode
    }
}

function Assert-Preflight {
    try {
        $node = (Get-Command node -ErrorAction Stop).Source
        Write-Host "PREFLIGHT_NODE_OK path=$node"
    } catch {
        Write-Host 'BLOCKED_NODE_NOT_FOUND'
        return $false
    }

    $key = Read-9RouterKey
    if (-not $key) {
        Write-Host 'BLOCKED_9ROUTER_SECRET_MISSING_OR_EMPTY'
        return $false
    }
    Write-Host 'PREFLIGHT_SECRET_OK'

    $configPath = Join-Path $Root 'opencode.json'
    if (-not (Test-Path -LiteralPath $configPath)) {
        Write-Host 'BLOCKED_OPENCODE_CONFIG_MISSING'
        return $false
    }

    try {
        $cfgRaw = Get-Content -LiteralPath $configPath -Raw
        $cfg = $cfgRaw | ConvertFrom-Json
    } catch {
        Write-Host 'BLOCKED_OPENCODE_CONFIG_INVALID_JSON'
        return $false
    }

    if ($cfgRaw -match '0\.0\.0\.0') {
        Write-Host 'BLOCKED_CONFIG_WIDE_OPEN_BINDING'
        return $false
    }

    if ([string]$cfg.model -ne 'unit-elite-runtime/unit-elite-runtime' -or
        [string]$cfg.small_model -ne 'unit-elite-runtime/unit-elite-runtime') {
        Write-Host 'BLOCKED_OPENCODE_MODEL_NOT_RUNTIME'
        return $false
    }

    $provider = $cfg.provider.'unit-elite-runtime'
    if (-not $provider -or [string]$provider.options.baseURL -ne 'http://127.0.0.1:20129/v1') {
        Write-Host 'BLOCKED_OPENCODE_BASEURL_NOT_RUNTIME'
        return $false
    }

    Write-Host 'PREFLIGHT_OPENCODE_CONFIG_OK'

    if (-not (Test-Path -LiteralPath $WhatsAppBridgeExe)) {
        Write-Host "BLOCKED_WHATSAPP_EXECUTABLE_MISSING path=$WhatsAppBridgeExe"
        return $false
    }

    if (-not (Test-Path -LiteralPath $WhatsAppBridgeDir)) {
        Write-Host "BLOCKED_WHATSAPP_WORKDIR_MISSING path=$WhatsAppBridgeDir"
        return $false
    }

    Write-Host "PREFLIGHT_WHATSAPP_BINARY_OK path=$WhatsAppBridgeExe"
    return $true
}
