$ErrorActionPreference = 'Stop'

$path = Resolve-Path '.\integrations\9router\runtime\runtime-gateway.cjs'
$text = [System.IO.File]::ReadAllText($path)

$marker = '// Message-shape diagnostics only. Never log content.'
if ($text.Contains($marker)) {
    Write-Host 'MESSAGE_SHAPE_DIAG_ALREADY_PRESENT'
    exit 0
}

$anchor = "  for (let i = 0; i < models.length; i++) {"
if (-not $text.Contains($anchor)) {
    Write-Host 'PATCH_ANCHOR_NOT_FOUND'
    exit 1
}

$diag = @'
  // Message-shape diagnostics only. Never log content.
  for (let mi = 0; mi < messages.length; mi++) {
    const m = messages[mi] || {};
    const content = m.content;
    const contentType =
      content === null ? 'null' :
      Array.isArray(content) ? 'array' :
      typeof content;
    const contentLen =
      typeof content === 'string'
        ? Buffer.byteLength(content, 'utf8')
        : Array.isArray(content)
          ? content.length
          : 0;
    const partTypes =
      Array.isArray(content)
        ? content.map((p) => {
            if (!p || typeof p !== 'object') return typeof p;
            if (p.type) return String(p.type);
            return 'keys:' + Object.keys(p).sort().join('|');
          }).join(',')
        : '';
    const toolCallsCount = Array.isArray(m.tool_calls) ? m.tool_calls.length : 0;

    safeLog('[runtime-gateway] message shape' +
      ' idx=' + mi +
      ' role=' + String(m.role || '?') +
      ' keys=' + Object.keys(m).sort().join(',') +
      ' content_type=' + contentType +
      ' content_len=' + contentLen +
      ' part_types=' + (partTypes || '-') +
      ' tool_calls=' + toolCallsCount +
      ' has_name=' + Object.prototype.hasOwnProperty.call(m, 'name') +
      ' has_tool_call_id=' + Object.prototype.hasOwnProperty.call(m, 'tool_call_id') +
      ' has_reasoning=' + Object.prototype.hasOwnProperty.call(m, 'reasoning') +
      ' has_reasoning_content=' + Object.prototype.hasOwnProperty.call(m, 'reasoning_content') +
      ' has_provider_options=' +
        (Object.prototype.hasOwnProperty.call(m, 'providerOptions') ||
         Object.prototype.hasOwnProperty.call(m, 'provider_options')) +
      ' req=' + requestId);
  }

'@

# Backup once, alongside the runtime source.
$backup = "$path.message-shape-diag.bak"
if (-not (Test-Path $backup)) {
    [System.IO.File]::WriteAllText(
        $backup,
        $text,
        (New-Object System.Text.UTF8Encoding($false))
    )
}

$text = $text.Replace($anchor, $diag + $anchor)
[System.IO.File]::WriteAllText(
    $path,
    $text,
    (New-Object System.Text.UTF8Encoding($false))
)

Write-Host 'MESSAGE_SHAPE_DIAG_PATCHED'
Write-Host ('BACKUP=' + $backup)
