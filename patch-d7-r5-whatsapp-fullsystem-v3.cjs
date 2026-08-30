const fs = require("fs");
const path = require("path");

const root = process.cwd();
const prodDir = path.join(root, "scripts", "d7-production");

const files = {
  common: path.join(prodDir, "common.ps1"),
  start: path.join(prodDir, "start.ps1"),
  status: path.join(prodDir, "status.ps1"),
  stop: path.join(prodDir, "stop.ps1"),
  recover: path.join(prodDir, "recover.ps1"),
  manifest: path.join(prodDir, "controller-manifest.json"),
};

for (const [k, f] of Object.entries(files)) {
  if (!fs.existsSync(f)) {
    console.error(`ERROR: required ${k} file missing: ${f}`);
    process.exit(2);
  }
}

function backup(file) {
  const bak = file + ".pre-r5-whatsapp-fullsystem.bak";
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
  return bak;
}

function replaceOnce(src, needle, replacement, label) {
  const count = src.split(needle).length - 1;
  if (count !== 1) {
    throw new Error(`${label}: expected exactly 1 anchor, found ${count}`);
  }
  return src.replace(needle, replacement);
}

function replaceRegexOnce(src, re, replacement, label) {
  const matches = src.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")) || [];
  if (matches.length !== 1) {
    throw new Error(`${label}: expected exactly 1 regex match, found ${matches.length}`);
  }
  return src.replace(re, replacement);
}

let common = fs.readFileSync(files.common, "utf8");
let start = fs.readFileSync(files.start, "utf8");
let status = fs.readFileSync(files.status, "utf8");
let stop = fs.readFileSync(files.stop, "utf8");
let recover = fs.readFileSync(files.recover, "utf8");

// Normalize controller sources internally so patch anchors are independent of CRLF/LF.
common = common.replace(/\r\n/g, "\n");
start = start.replace(/\r\n/g, "\n");
status = status.replace(/\r\n/g, "\n");
stop = stop.replace(/\r\n/g, "\n");
recover = recover.replace(/\r\n/g, "\n");

if (common.includes("WhatsAppBridgeExe") || start.includes("WHATSAPP_READY")) {
  console.error("ERROR: WhatsApp full-system integration appears already applied. No changes made.");
  process.exit(3);
}

common = replaceOnce(
  common,
  "$RuntimePort = 20129",
  `$RuntimePort = 20129
$WhatsAppPort = 8080
$WhatsAppBridgeDir = 'D:\\OpenCode\\whatsapp-mcp-main\\whatsapp-bridge'
$WhatsAppBridgeExe = Join-Path $WhatsAppBridgeDir 'whatsapp-bridge.exe'
$WhatsAppState = Join-Path $StateDir 'whatsapp-owned.json'
$WhatsAppLog = Join-Path $StateDir 'whatsapp-bridge.log'
$WhatsAppErrLog = Join-Path $StateDir 'whatsapp-bridge.err.log'`,
  "common vars"
);

const whatsappFunctions = String.raw`
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

    $startArgs = @{
        FilePath = $WhatsAppBridgeExe
        WorkingDirectory = $WhatsAppBridgeDir
        RedirectStandardOutput = $WhatsAppLog
        RedirectStandardError = $WhatsAppErrLog
        WindowStyle = 'Hidden'
        PassThru = $true
    }
    $p = Start-Process @startArgs

    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500

        if ($p.HasExited) { break }

        $l = Get-WhatsAppListener
        if (
            $l -and
            [int]$l.OwningProcess -eq $p.Id -and
            (Test-IsCanonicalWhatsAppProcess $p.Id) -and
            (Test-WhatsAppHealth)
        ) {
            Save-OwnedWhatsApp -ProcessId $p.Id
            Write-Host "WHATSAPP_START_PASS PID=$($p.Id) PORT=$WhatsAppPort"
            return $true
        }
    }

    if (-not $p.HasExited -and (Test-IsCanonicalWhatsAppProcess $p.Id)) {
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }

    Clear-OwnedWhatsAppState

    Write-Host 'BLOCKED_WHATSAPP_NOT_READY_OR_PAIRING_REQUIRED'
    if (Test-Path -LiteralPath $WhatsAppErrLog) {
        Get-Content -LiteralPath $WhatsAppErrLog -Tail 20
    }
    Write-Host "WHATSAPP_LOG=$WhatsAppLog"
    Write-Host "WHATSAPP_ERR_LOG=$WhatsAppErrLog"
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

`;

common = replaceOnce(
  common,
  "function Resolve-OpenCodePath {",
  whatsappFunctions + "\nfunction Resolve-OpenCodePath {",
  "insert WhatsApp functions"
);

const snapshotReplacement = String.raw`function Get-ComponentSnapshot {
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
        if ($whatsappWide) { 'BLOCKED_EXPOSED' }
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

`;

common = replaceRegexOnce(
  common,
  /function Get-ComponentSnapshot \{[\s\S]*?\r?\n\}\r?\n\r?\nfunction Assert-Preflight \{/,
  snapshotReplacement + "function Assert-Preflight {",
  "replace snapshot"
);

common = replaceOnce(
  common,
  "    Write-Host 'PREFLIGHT_OPENCODE_CONFIG_OK'\n    return $true",
  `    Write-Host 'PREFLIGHT_OPENCODE_CONFIG_OK'

    if (-not (Test-Path -LiteralPath $WhatsAppBridgeExe)) {
        Write-Host "BLOCKED_WHATSAPP_EXECUTABLE_MISSING path=$WhatsAppBridgeExe"
        return $false
    }

    if (-not (Test-Path -LiteralPath $WhatsAppBridgeDir)) {
        Write-Host "BLOCKED_WHATSAPP_WORKDIR_MISSING path=$WhatsAppBridgeDir"
        return $false
    }

    Write-Host "PREFLIGHT_WHATSAPP_BINARY_OK path=$WhatsAppBridgeExe"
    return $true`,
  "preflight WhatsApp"
);

const whatsappStartBlock = String.raw`
if (-not (Start-WhatsAppManaged)) {
    Write-Host 'BLOCKED_WHATSAPP_START'
    exit 17
}
Write-Host 'WHATSAPP_READY endpoint=127.0.0.1:8080/api'

`;

start = replaceOnce(
  start,
  "if (-not (Start-OpenCodeManaged)) { exit 17 }",
  whatsappStartBlock + "if (-not (Start-OpenCodeManaged)) { exit 18 }",
  "start WhatsApp"
);

start = start.replace(
  "UNIT_ELITE_STATUS=$($s.Overall) ROUTER=$($s.Router) RUNTIME=$($s.Runtime) OPENCODE=$($s.OpenCode)",
  "UNIT_ELITE_STATUS=$($s.Overall) ROUTER=$($s.Router) RUNTIME=$($s.Runtime) WHATSAPP=$($s.WhatsApp) OPENCODE=$($s.OpenCode)"
);

start = replaceRegexOnce(
  start,
  /if \(\$s\.Router -eq 'READY' -and \$s\.Runtime -eq 'READY' -and\r?\n\s*\(\$s\.OpenCode -eq 'RUNNING_OWNED' -or \$s\.OpenCode -eq 'RUNNING_EXTERNAL'\)\) \{\r?\n\s*Write-Host 'UNIT_ELITE_START_PASS'\r?\n\s*exit 0\r?\n\}/,
  `if (
    $s.Router -eq 'READY' -and
    $s.Runtime -eq 'READY' -and
    $s.WhatsApp -eq 'READY_OWNED' -and
    $s.OpenCode -eq 'RUNNING_OWNED'
) {
    Write-Host 'UNIT_ELITE_START_PASS'
    exit 0
}`,
  "start final ready condition"
);

start = start.replace("exit 18", "exit 19");

status = replaceOnce(
  status,
  `Write-Host "RUNTIME=$($s.Runtime) ENDPOINT=127.0.0.1:20129"\nWrite-Host "OPENCODE=$($s.OpenCode)"`,
  `Write-Host "RUNTIME=$($s.Runtime) ENDPOINT=127.0.0.1:20129"
Write-Host "WHATSAPP=$($s.WhatsApp) ENDPOINT=127.0.0.1:8080/api"
Write-Host "OPENCODE=$($s.OpenCode)"`,
  "status WhatsApp line"
);

status = replaceOnce(
  status,
  `$runtimeListener = Get-LoopbackListener $RuntimePort
if ($runtimeListener) { Write-Host "RUNTIME_PID=$($runtimeListener.OwningProcess)" }`,
  `$runtimeListener = Get-LoopbackListener $RuntimePort
if ($runtimeListener) { Write-Host "RUNTIME_PID=$($runtimeListener.OwningProcess)" }

$whatsappListener = Get-WhatsAppListener
if ($whatsappListener) { Write-Host "WHATSAPP_PID=$($whatsappListener.OwningProcess)" }`,
  "status WhatsApp PID"
);

const whatsappStopBlock = String.raw`
if (-not (Stop-WhatsAppManaged)) {
    $stopFailed = $true
}

`;

stop = replaceOnce(
  stop,
  `& (Join-Path $Root 'integrations\\9router\\runtime\\stop-runtime.cmd')`,
  whatsappStopBlock + `& (Join-Path $Root 'integrations\\9router\\runtime\\stop-runtime.cmd')`,
  "stop WhatsApp"
);

stop = stop.replace(
  "UNIT_ELITE_STATUS=$($s.Overall) ROUTER=$($s.Router) RUNTIME=$($s.Runtime) OPENCODE=$($s.OpenCode)",
  "UNIT_ELITE_STATUS=$($s.Overall) ROUTER=$($s.Router) RUNTIME=$($s.Runtime) WHATSAPP=$($s.WhatsApp) OPENCODE=$($s.OpenCode)"
);

stop = replaceOnce(
  stop,
  "if ($s.Router -eq 'STOPPED' -and $s.Runtime -eq 'STOPPED') {",
  "if ($s.Router -eq 'STOPPED' -and $s.Runtime -eq 'STOPPED' -and $s.WhatsApp -eq 'STOPPED') {",
  "stop final condition"
);

const recoverWhatsappBlock = String.raw`
    if ((Test-9RouterAppHealth) -and (Test-RuntimeHealth)) {
        if (-not (Test-WhatsAppHealth)) {
            Write-Host '[RECOVER] WhatsApp Bridge unhealthy; safe targeted restart.'
            [void](Stop-WhatsAppManaged)
            [void](Start-WhatsAppManaged)
        }
    }

`;

recover = replaceOnce(
  recover,
  `    if ((Test-9RouterAppHealth) -and (Test-RuntimeHealth)) {
        [void](Start-OpenCodeManaged)
    }`,
  recoverWhatsappBlock + `    if ((Test-9RouterAppHealth) -and (Test-RuntimeHealth) -and (Test-WhatsAppHealth)) {
        [void](Start-OpenCodeManaged)
    }`,
  "recover WhatsApp"
);

recover = recover.replace(
  "RECOVERY_STATUS attempt=$attempt overall=$($s.Overall) router=$($s.Router) runtime=$($s.Runtime) opencode=$($s.OpenCode)",
  "RECOVERY_STATUS attempt=$attempt overall=$($s.Overall) router=$($s.Router) runtime=$($s.Runtime) whatsapp=$($s.WhatsApp) opencode=$($s.OpenCode)"
);

recover = replaceRegexOnce(
  recover,
  /if \(\$s\.Router -eq 'READY' -and \$s\.Runtime -eq 'READY' -and\r?\n\s*\(\$s\.OpenCode -eq 'RUNNING_OWNED' -or \$s\.OpenCode -eq 'RUNNING_EXTERNAL'\)\) \{/,
  `if (
        $s.Router -eq 'READY' -and
        $s.Runtime -eq 'READY' -and
        $s.WhatsApp -eq 'READY_OWNED' -and
        $s.OpenCode -eq 'RUNNING_OWNED'
    ) {`,
  "recover final ready condition"
);

const outputs = [
  [files.common, common],
  [files.start, start],
  [files.status, status],
  [files.stop, stop],
  [files.recover, recover],
];

for (const [file] of outputs) {
  console.log("BACKUP=" + backup(file));
}

for (const [file, content] of outputs) {
  fs.writeFileSync(file, content.replace(/\r?\n/g, "\r\n"), "utf8");
  console.log("PATCHED=" + file);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(files.manifest, "utf8"));
} catch (e) {
  console.error("ERROR: invalid controller-manifest.json after script patching.");
  process.exit(4);
}

backup(files.manifest);

manifest.whatsapp_bridge = {
  required_for_ready: true,
  endpoint: "http://127.0.0.1:8080/api",
  health: "GET /api/health",
  executable: "D:\\OpenCode\\whatsapp-mcp-main\\whatsapp-bridge\\whatsapp-bridge.exe",
  working_directory: "D:\\OpenCode\\whatsapp-mcp-main\\whatsapp-bridge",
  session_store_policy: "preserve; never delete/reset automatically",
  build_policy: "never rebuild during START/RECOVER",
  pairing_policy: "never reset pairing automatically",
  human_approval_gate: "still mandatory for external dispatch"
};

manifest.full_system_ready_requires = [
  "9Router READY",
  "Runtime READY",
  "WhatsApp Bridge READY_OWNED",
  "OpenCode RUNNING_OWNED"
];

fs.writeFileSync(files.manifest, JSON.stringify(manifest, null, 2) + "\r\n", "utf8");
console.log("PATCHED=" + files.manifest);

console.log("PATCH_OK");
console.log("WHATSAPP_FULL_SYSTEM_INTEGRATION=ENABLED");
console.log("WHATSAPP_EXE=D:\\OpenCode\\whatsapp-mcp-main\\whatsapp-bridge\\whatsapp-bridge.exe");
console.log("WHATSAPP_ENDPOINT=http://127.0.0.1:8080/api");
