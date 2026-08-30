param()

$ErrorActionPreference = 'Stop'

$Dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Script = Join-Path $Dir 'runtime-gateway.cjs'
$PidFile = Join-Path $Dir 'runtime-gateway.pid'
$Log = Join-Path $Dir 'runtime-gateway.log'
$ErrLog = Join-Path $Dir 'runtime-gateway.err.log'
$Secret = Join-Path $env:USERPROFILE '.unit-elite-secrets\9router.key'
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

function Test-RuntimeHealth {
    try {
        $h = Invoke-RestMethod -Uri "http://$HostIp`:$Port/health" -TimeoutSec 2
        return (
            $h.status -eq 'ready' -and
            $h.runtime -eq 'unit-elite-runtime' -and
            $h.router -eq 'healthy' -and
            $h.fallback_controller -eq 'ready' -and
            $h.gemini_quarantine -eq $true
        )
    } catch {
        return $false
    }
}

function Write-PidFile([int]$ProcessId) {
    Set-Content -LiteralPath $PidFile -Value $ProcessId -NoNewline -Encoding ascii
}

function Remove-PidFileIfOwned([int]$ProcessId) {
    if (-not (Test-Path -LiteralPath $PidFile)) { return }
    try {
        $raw = (Get-Content -LiteralPath $PidFile -Raw).Trim()
        if ($raw -eq [string]$ProcessId) {
            Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
        }
    } catch {}
}

if (-not (Test-Path -LiteralPath $Script)) {
    Write-Host 'BLOCKED_RUNTIME_SCRIPT_MISSING'
    exit 2
}

$existing = Get-RuntimeListener
if ($existing) {
    $existingPid = [int]$existing.OwningProcess

    if (-not (Test-IsRuntimeProcess $existingPid)) {
        Write-Host "BLOCKED_PORT_IN_USE PID=$existingPid PORT=$Port"
        exit 3
    }

    Write-PidFile $existingPid

    if (Test-RuntimeHealth) {
        Write-Host "RUNTIME_ALREADY_RUNNING PID=$existingPid PORT=$Port"
        exit 0
    }

    Write-Host "BLOCKED_RUNTIME_UNHEALTHY PID=$existingPid PORT=$Port"
    exit 7
}

if (-not (Test-Path -LiteralPath $Secret)) {
    Write-Host 'BLOCKED_SECRET_FILE_MISSING'
    exit 4
}

$key = (Get-Content -LiteralPath $Secret -Raw).Trim()
if ([string]::IsNullOrWhiteSpace($key)) {
    Write-Host 'BLOCKED_SECRET_FILE_EMPTY'
    exit 5
}

$node = (Get-Command node -ErrorAction Stop).Source

# Force the child runtime to inherit the verified local 9Router key.
# The secret is never placed on the command line or printed to logs.
$hadOldKey = Test-Path Env:\NINEROUTER_KEY
$oldKey = if ($hadOldKey) { $env:NINEROUTER_KEY } else { $null }

try {
    $env:NINEROUTER_KEY = $key

    $p = Start-Process `
        -FilePath $node `
        -ArgumentList @($Script) `
        -WorkingDirectory $Dir `
        -RedirectStandardOutput $Log `
        -RedirectStandardError $ErrLog `
        -WindowStyle Hidden `
        -PassThru
}
finally {
    if ($hadOldKey) {
        $env:NINEROUTER_KEY = $oldKey
    } else {
        Remove-Item Env:\NINEROUTER_KEY -ErrorAction SilentlyContinue
    }
}

$ready = $false
for ($i = 0; $i -lt 20; $i++) {
    Start-Sleep -Milliseconds 500

    if ($p.HasExited) { break }

    $listener = Get-RuntimeListener
    if (
        $listener -and
        [int]$listener.OwningProcess -eq $p.Id -and
        (Test-IsRuntimeProcess $p.Id) -and
        (Test-RuntimeHealth)
    ) {
        $ready = $true
        break
    }
}

if ($ready) {
    Write-PidFile $p.Id
    Write-Host "RUNTIME_START_PASS PID=$($p.Id) PORT=$Port"
    exit 0
}

if (-not $p.HasExited -and (Test-IsRuntimeProcess $p.Id)) {
    Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
}

Remove-PidFileIfOwned $p.Id

Write-Host 'RUNTIME_START_FAIL'

try {
    $listener = Get-RuntimeListener
    if ($listener) {
        Write-Host "DIAG_LISTENER_PID=$($listener.OwningProcess)"
        try {
            $h = Invoke-RestMethod -Uri "http://$HostIp`:$Port/health" -TimeoutSec 2
            Write-Host ("DIAG_HEALTH status={0} router={1} fallback={2} quarantine={3}" -f `
                $h.status, $h.router, $h.fallback_controller, $h.gemini_quarantine)
        } catch {
            Write-Host 'DIAG_HEALTH_UNREACHABLE'
        }
    } else {
        Write-Host 'DIAG_NO_LISTENER'
    }
} catch {}

if (Test-Path -LiteralPath $ErrLog) {
    Get-Content -LiteralPath $ErrLog -Tail 20
}

exit 6
