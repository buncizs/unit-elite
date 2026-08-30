param()

$ErrorActionPreference = 'Stop'

$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$PidFile = Join-Path $Dir 'runtime-gateway.pid'
$Port = 20129
$HostIp = '127.0.0.1'

function Get-RuntimeListener {
    Get-NetTCPConnection -LocalAddress $HostIp -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -First 1
}

function Get-ProcessInfo([int]$ProcessId) {
    Get-CimInstance Win32_Process -Filter ("ProcessId=" + $ProcessId) -ErrorAction SilentlyContinue
}

function Test-IsRuntimeProcess([int]$ProcessId) {
    $p = Get-ProcessInfo $ProcessId
    if (-not $p) { return $false }

    $exe = [string]$p.ExecutablePath
    $cmd = [string]$p.CommandLine

    return (
        ($exe -match '(?i)node(\.exe)?$') -and
        ($cmd -match '(?i)runtime-gateway\.cjs')
    )
}

function Read-PidFile {
    if (-not (Test-Path -LiteralPath $PidFile)) { return $null }

    try {
        $raw = (Get-Content -LiteralPath $PidFile -Raw).Trim()
        if ($raw -match '^\d+$') {
            return [int]$raw
        }
    } catch {}

    return $null
}

$listener = Get-RuntimeListener
$pidFromFile = Read-PidFile
$target = $null

if ($listener) {
    $listenerPid = [int]$listener.OwningProcess

    if (-not (Test-IsRuntimeProcess $listenerPid)) {
        Write-Host "BLOCKED_FOREIGN_PROCESS PID=$listenerPid PORT=$Port"
        exit 3
    }

    $target = $listenerPid
}
elseif ($pidFromFile -and (Test-IsRuntimeProcess $pidFromFile)) {
    # Handles a verified runtime process that exists but is no longer listening.
    $target = $pidFromFile
}
else {
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    Write-Host 'RUNTIME_ALREADY_STOPPED'
    exit 0
}

Write-Host "Stopping Runtime Gateway PID $target..."
Stop-Process -Id $target -Force -ErrorAction Stop

for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 250
    if (-not (Get-RuntimeListener)) { break }
}

$left = Get-RuntimeListener
if ($left) {
    Write-Host "RUNTIME_STOP_FAIL PORT_STILL_LISTENING PID=$($left.OwningProcess)"
    exit 4
}

if (Test-Path -LiteralPath $PidFile) {
    try {
        $raw = (Get-Content -LiteralPath $PidFile -Raw).Trim()
        if ($raw -eq [string]$target -or -not $raw) {
            Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
        }
    } catch {
        Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    }
}

Write-Host "RUNTIME_STOP_PASS PID=$target"
exit 0
