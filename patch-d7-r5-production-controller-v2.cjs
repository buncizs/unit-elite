const fs = require("fs");
const path = require("path");

const root = process.cwd();
const prodDir = path.join(root, "scripts", "d7-production");
const stateDir = path.join(prodDir, "state");
fs.mkdirSync(stateDir, { recursive: true });

function backup(file) {
  if (!fs.existsSync(file)) return;
  const bak = file + ".pre-r5-production.bak";
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content.replace(/\r?\n/g, "\r\n"), "utf8");
  console.log("WROTE=" + file);
}

const common = String.raw`$ErrorActionPreference = 'Stop'

$ProdDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = (Resolve-Path (Join-Path $ProdDir '..\..')).Path
$StateDir = Join-Path $ProdDir 'state'
$OpenCodeState = Join-Path $StateDir 'opencode-owned.json'
$RouterPort = 20128
$RuntimePort = 20129
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
    $routerLoop = [bool](Get-LoopbackListener $RouterPort)
    $runtimeLoop = [bool](Get-LoopbackListener $RuntimePort)

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

    $oc = @(Get-OpenCodeMainProcesses)
    $openCode =
        if ($oc.Count -eq 0) { 'STOPPED' }
        elseif (Test-OwnedOpenCode) { 'RUNNING_OWNED' }
        else { 'RUNNING_EXTERNAL' }

    $overall =
        if ($router -like 'BLOCKED*' -or $runtime -like 'BLOCKED*') { 'BLOCKED' }
        elseif ($router -eq 'STOPPED' -and $runtime -eq 'STOPPED') { 'STOPPED' }
        elseif ($router -eq 'READY' -and $runtime -eq 'READY' -and $openCode -eq 'RUNNING_OWNED') { 'READY' }
        elseif ($router -eq 'READY' -and $runtime -eq 'READY' -and $openCode -eq 'RUNNING_EXTERNAL') { 'DEGRADED' }
        else { 'DEGRADED' }

    [pscustomobject]@{
        Overall = $overall
        Router = $router
        Runtime = $runtime
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
    return $true
}
`;

const start = String.raw`. "$PSScriptRoot\common.ps1"

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

if (-not (Start-OpenCodeManaged)) { exit 17 }

$s = Get-ComponentSnapshot
Write-Host "UNIT_ELITE_STATUS=$($s.Overall) ROUTER=$($s.Router) RUNTIME=$($s.Runtime) OPENCODE=$($s.OpenCode)"

if ($s.Router -eq 'READY' -and $s.Runtime -eq 'READY' -and
    ($s.OpenCode -eq 'RUNNING_OWNED' -or $s.OpenCode -eq 'RUNNING_EXTERNAL')) {
    Write-Host 'UNIT_ELITE_START_PASS'
    exit 0
}

Write-Host 'UNIT_ELITE_START_INCOMPLETE'
exit 18
`;

const status = String.raw`. "$PSScriptRoot\common.ps1"

$s = Get-ComponentSnapshot

Write-Host '[STATUS] Unit Elite Production'
Write-Host "STATUS=$($s.Overall)"
Write-Host "ROUTER=$($s.Router) ENDPOINT=127.0.0.1:20128"
Write-Host "RUNTIME=$($s.Runtime) ENDPOINT=127.0.0.1:20129"
Write-Host "OPENCODE=$($s.OpenCode)"

$routerListener = Get-LoopbackListener $RouterPort
if ($routerListener) { Write-Host "ROUTER_PID=$($routerListener.OwningProcess)" }

$runtimeListener = Get-LoopbackListener $RuntimePort
if ($runtimeListener) { Write-Host "RUNTIME_PID=$($runtimeListener.OwningProcess)" }

$oc = @(Get-OpenCodeMainProcesses)
if ($oc.Count -gt 0) { Write-Host "OPENCODE_PID=$($oc[0].ProcessId)" }

switch ($s.Overall) {
    'READY' { exit 0 }
    'DEGRADED' { exit 1 }
    'STOPPED' { exit 2 }
    'BLOCKED' { exit 3 }
    default { exit 4 }
}
`;

const stop = String.raw`. "$PSScriptRoot\common.ps1"

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
Write-Host "UNIT_ELITE_STATUS=$($s.Overall) ROUTER=$($s.Router) RUNTIME=$($s.Runtime) OPENCODE=$($s.OpenCode)"

if ($stopFailed) { exit 1 }

if ($s.Router -eq 'STOPPED' -and $s.Runtime -eq 'STOPPED') {
    Write-Host 'UNIT_ELITE_STOP_PASS'
    exit 0
}

Write-Host 'UNIT_ELITE_STOP_INCOMPLETE'
exit 2
`;

const recover = String.raw`. "$PSScriptRoot\common.ps1"

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

    if ((Test-9RouterAppHealth) -and (Test-RuntimeHealth)) {
        [void](Start-OpenCodeManaged)
    }

    $s = Get-ComponentSnapshot
    Write-Host "RECOVERY_STATUS attempt=$attempt overall=$($s.Overall) router=$($s.Router) runtime=$($s.Runtime) opencode=$($s.OpenCode)"

    if ($s.Router -eq 'READY' -and $s.Runtime -eq 'READY' -and
        ($s.OpenCode -eq 'RUNNING_OWNED' -or $s.OpenCode -eq 'RUNNING_EXTERNAL')) {
        Write-Host "UNIT_ELITE_RECOVER_PASS attempts=$attempt"
        exit 0
    }

    if ($attempt -lt $MaxAttempts) { Start-Sleep -Seconds 2 }
}

Write-Host 'UNIT_ELITE_RECOVER_FAIL'
Write-Host 'RECOVERY_POLICY: no reinstall, no credential reset, no SQLite deletion, no routing-policy modification.'
exit 21
`;

const wrappers = {
  "START-UNIT-ELITE.cmd": `@echo off
setlocal
title Unit Elite - START
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\\d7-production\\start.ps1"
exit /b %errorlevel%
`,
  "STATUS-UNIT-ELITE.cmd": `@echo off
setlocal
title Unit Elite - STATUS
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\\d7-production\\status.ps1"
exit /b %errorlevel%
`,
  "STOP-UNIT-ELITE.cmd": `@echo off
setlocal
title Unit Elite - STOP
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\\d7-production\\stop.ps1"
exit /b %errorlevel%
`,
  "RECOVER-UNIT-ELITE.cmd": `@echo off
setlocal
title Unit Elite - RECOVER
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\\d7-production\\recover.ps1"
exit /b %errorlevel%
`
};

for (const name of Object.keys(wrappers)) backup(path.join(root, name));

write(path.join(prodDir, "common.ps1"), common);
write(path.join(prodDir, "start.ps1"), start);
write(path.join(prodDir, "status.ps1"), status);
write(path.join(prodDir, "stop.ps1"), stop);
write(path.join(prodDir, "recover.ps1"), recover);

for (const [name, content] of Object.entries(wrappers)) {
  write(path.join(root, name), content);
}

const manifest = {
  phase: "TECH-0001-D7-R5",
  controller: "Unit Elite production single-button controller",
  router: "127.0.0.1:20128",
  runtime: "127.0.0.1:20129",
  router_app_health: "authenticated GET /v1/models",
  runtime_health: "GET /health full readiness",
  opencode_discovery: "%LOCALAPPDATA%\\Programs\\@opencode-aidesktop\\OpenCode.exe",
  recovery_max_attempts: 3,
  forbidden_recovery_actions: [
    "reinstall",
    "credential reset",
    "SQLite deletion",
    "routing policy modification",
    "kill all node.exe",
    "kill all OpenCode.exe"
  ]
};
write(path.join(prodDir, "controller-manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

console.log("PATCH_OK");
console.log("PRODUCTION_CONTROLLER_DIR=" + prodDir);
console.log("BACKUPS_SUFFIX=.pre-r5-production.bak");
