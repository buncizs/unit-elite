$ErrorActionPreference = 'Stop'

$keyPath = Join-Path $env:USERPROFILE '.unit-elite-secrets\9router.key'
if (-not (Test-Path $keyPath)) {
    Write-Host 'KEY_FILE_NOT_FOUND'
    exit 1
}

$key = (Get-Content $keyPath -Raw).Trim()
$headers = @{ Authorization = ('Bearer ' + $key) }

$padSizes = @(27000, 28500, 29200, 29600, 29800, 30000, 30500, 31500)

foreach ($pad in $padSizes) {
    $body = @{
        model = 'groq/openai/gpt-oss-120b'
        messages = @(
            @{
                role = 'user'
                content = ('X' * $pad)
            }
        )
        max_tokens = 16
        stream = $false
    }

    $json = $body | ConvertTo-Json -Depth 10 -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetByteCount($json)

    try {
        $r = Invoke-WebRequest `
            -UseBasicParsing `
            -Uri 'http://127.0.0.1:20128/v1/chat/completions' `
            -Method Post `
            -Headers $headers `
            -ContentType 'application/json' `
            -Body $json `
            -TimeoutSec 30

        Write-Host ("PAD={0} JSON_BYTES={1} HTTP={2}" -f $pad, $bytes, [int]$r.StatusCode)
    }
    catch {
        $status = 'NO_HTTP'
        if ($_.Exception.Response) {
            try { $status = [int]$_.Exception.Response.StatusCode } catch {}
        }
        Write-Host ("PAD={0} JSON_BYTES={1} HTTP={2}" -f $pad, $bytes, $status)
    }
}
