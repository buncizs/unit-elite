$ErrorActionPreference = 'Stop'

$path = Resolve-Path '.\integrations\9router\runtime\runtime-gateway.cjs'
$text = [System.IO.File]::ReadAllText($path)

$anchor = "' tools=' + toolsCount +"
$replacement = "' tools=' + toolsCount + ' max_tokens=' + String(parsedPayload.max_tokens) + ' stream_options=' + JSON.stringify(parsedPayload.stream_options || null) +"

if (-not $text.Contains($anchor)) {
    Write-Host 'PATCH_ANCHOR_NOT_FOUND'
    exit 1
}

$text = $text.Replace($anchor, $replacement)
[System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding($false)))

Write-Host 'DIAG_VALUE_PATCHED'
