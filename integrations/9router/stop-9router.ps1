param()

$ErrorActionPreference = 'Stop'

$Port = 20128
$HostIp = '127.0.0.1'
$CanonicalCustomServer = Join-Path $env:APPDATA 'npm\node_modules\9router\app\custom-server.js'
$CanonicalCli = Join-Path $env:APPDATA 'npm\node_modules\9router\cli.js'

function Get-LoopbackListener {
    Get-NetTCPConnection -LocalAddress $HostIp -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
}

function Get-ProcessInfo([int]$ProcessId) {
    Get-CimInstance Win32_Process -Filter ("ProcessId=" + $ProcessId) -ErrorAction SilentlyContinue
}

function Test-IsNodeProcess($ProcessInfo) {
    if (-not $ProcessInfo) { return $false }
    $exe = [string]$ProcessInfo.ExecutablePath
    return ($exe -match '(?i)\\node\.exe$')
}

function Test-IsTrustedCustomServer($ProcessInfo) {
    if (-not (Test-IsNodeProcess $ProcessInfo)) { return $false }

    $cmd = [string]$ProcessInfo.CommandLine
    if ([string]::IsNullOrWhiteSpace($cmd)) { return $false }

    $normalizedCmd = $cmd.Replace('/', '\')
    $normalizedTrusted = $CanonicalCustomServer.Replace('/', '\')

    return ($normalizedCmd.IndexOf($normalizedTrusted, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
}

function Find-VerifiedCliAncestor([int]$StartPid) {
    $all = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
    if (-not $all) { return $null }

    $curPid = $StartPid
    for ($i = 0; $i -lt 12; $i++) {
        $p = $all | Where-Object { $_.ProcessId -eq $curPid } | Select-Object -First 1
        if (-not $p) { break }

        $cmd = [string]$p.CommandLine
        if (-not [string]::IsNullOrWhiteSpace($cmd)) {
            $normalizedCmd = $cmd.Replace('/', '\')
            $normalizedCli = $CanonicalCli.Replace('/', '\')

            if (
                (Test-IsNodeProcess $p) -and
                ($normalizedCmd.IndexOf($normalizedCli, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
            ) {
                return [int]$p.ProcessId
            }
        }

        if (-not $p.ParentProcessId -or [int]$p.ParentProcessId -eq 0) { break }
        $curPid = [int]$p.ParentProcessId
    }

    return $null
}

$listener = Get-LoopbackListener

if (-not $listener) {
    Write-Host "9ROUTER_ALREADY_STOPPED endpoint=127.0.0.1:$Port"
    exit 0
}

$listenerPid = [int]$listener.OwningProcess
$listenerProc = Get-ProcessInfo $listenerPid

if (-not $listenerProc) {
    Write-Host "BLOCKED_9ROUTER_LISTENER_PROCESS_NOT_FOUND PID=$listenerPid"
    exit 2
}

if (-not (Test-IsTrustedCustomServer $listenerProc)) {
    Write-Host "BLOCKED_9ROUTER_UNVERIFIED_LISTENER PID=$listenerPid"
    Write-Host "REFUSE_TO_KILL reason=listener_not_verified_as_canonical_9router_custom_server"
    exit 3
}

Write-Host "9ROUTER_LISTENER_VERIFIED PID=$listenerPid"
Write-Host "9ROUTER_PROCESS=canonical custom-server.js"

$cliRoot = Find-VerifiedCliAncestor $listenerPid
$targetPid = $listenerPid
$mode = 'verified-listener-fallback'

if ($cliRoot) {
    $targetPid = [int]$cliRoot
    $mode = 'verified-cli-root'
    Write-Host "9ROUTER_CLI_ROOT_VERIFIED PID=$targetPid"
}
else {
    Write-Host '9ROUTER_CLI_ROOT_NOT_PRESENT'
    Write-Host "9ROUTER_SAFE_FALLBACK=kill_verified_listener_tree_only PID=$listenerPid"
}

Write-Host "Stopping verified 9Router process tree PID=$targetPid MODE=$mode ..."

$taskkill = Join-Path $env:SystemRoot 'System32\taskkill.exe'
$startArgs = @{
    FilePath = $taskkill
    ArgumentList = @('/PID', [string]$targetPid, '/T', '/F')
    Wait = $true
    PassThru = $true
    WindowStyle = 'Hidden'
}
$tk = Start-Process @startArgs

if ($tk.ExitCode -ne 0) {
    Write-Host "9ROUTER_STOP_FAIL taskkill_exit=$($tk.ExitCode) PID=$targetPid"
    exit 4
}

for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 250
    if (-not (Get-LoopbackListener)) { break }
}

$left = Get-LoopbackListener
if ($left) {
    Write-Host "9ROUTER_STOP_FAIL listener_still_present PID=$($left.OwningProcess)"
    exit 5
}

Write-Host "9ROUTER_STOP_PASS PID=$targetPid MODE=$mode"
exit 0
