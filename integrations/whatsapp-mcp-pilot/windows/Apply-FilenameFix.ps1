param(
    [Parameter(Mandatory=$true)]
    [string]$BridgePath
)

$ErrorActionPreference = 'Stop'
$mainGo = Join-Path $BridgePath 'main.go'
if (-not (Test-Path -LiteralPath $mainGo)) {
    throw "main.go tidak ditemukan: $mainGo"
}

$s = [System.IO.File]::ReadAllText($mainGo)
$nl = if ($s.Contains("`r`n")) { "`r`n" } else { "`n" }

# Pastikan path/filepath tersedia di import block.
if ($s -notmatch '(?m)^\s*"path/filepath"\s*$') {
    $old = "`t`"os`"" + $nl
    $new = "`t`"os`"" + $nl + "`t`"path/filepath`"" + $nl
    if ($s.Contains($old)) {
        $s = $s.Replace($old, $new)
    } else {
        # Fallback jika indent/import berbeda.
        $importIdx = $s.IndexOf('import (')
        if ($importIdx -lt 0) { throw 'Import block Go tidak ditemukan.' }
        $insertAt = $s.IndexOf($nl, $importIdx)
        if ($insertAt -lt 0) { throw 'Tidak dapat menemukan posisi insert import.' }
        $insertAt += $nl.Length
        $s = $s.Substring(0,$insertAt) + "`t`"path/filepath`"" + $nl + $s.Substring($insertAt)
    }
}

# Patch hanya DocumentMessage pada jalur pengiriman media.
$pattern = '(?ms)(msg\.DocumentMessage\s*=\s*&waProto\.DocumentMessage\{\s*\r?\n)(.*?)(^\s*\})'
$m = [regex]::Match($s, $pattern)
if (-not $m.Success) {
    throw 'Block msg.DocumentMessage tidak ditemukan. Jangan patch manual; kirim main.go untuk diagnosis.'
}

$head = $m.Groups[1].Value
$body = $m.Groups[2].Value
$tail = $m.Groups[3].Value

$titlePattern = '(?m)^(\s*)Title:\s*.*$'
$titleMatch = [regex]::Match($body, $titlePattern)
if (-not $titleMatch.Success) {
    throw 'Field Title pada DocumentMessage tidak ditemukan.'
}
$indent = $titleMatch.Groups[1].Value
$newTitle = $indent + 'Title:         proto.String(filepath.Base(mediaPath)),'
$body = [regex]::Replace($body, $titlePattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($x) $newTitle }, 1)

$filePattern = '(?m)^\s*FileName:\s*.*$'
$newFile = $indent + 'FileName:      proto.String(filepath.Base(mediaPath)),'
if ([regex]::IsMatch($body, $filePattern)) {
    $body = [regex]::Replace($body, $filePattern, [System.Text.RegularExpressions.MatchEvaluator]{ param($x) $newFile }, 1)
} else {
    # Sisipkan FileName persis setelah Title.
    $needle = $newTitle + $nl
    if (-not $body.Contains($needle)) {
        throw 'Title sudah dipatch tetapi posisi untuk menyisipkan FileName tidak ditemukan.'
    }
    $body = $body.Replace($needle, $newTitle + $nl + $newFile + $nl)
}

$patchedBlock = $head + $body + $tail
$s = $s.Substring(0, $m.Index) + $patchedBlock + $s.Substring($m.Index + $m.Length)

# Validasi sebelum menulis.
if ($s -notmatch 'Title:\s*proto\.String\(filepath\.Base\(mediaPath\)\)') {
    throw 'Validasi Title basename gagal.'
}
if ($s -notmatch 'FileName:\s*proto\.String\(filepath\.Base\(mediaPath\)\)') {
    throw 'Validasi FileName basename gagal.'
}
if ($s -notmatch '(?m)^\s*"path/filepath"\s*$') {
    throw 'Validasi import path/filepath gagal.'
}

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($mainGo, $s, $utf8NoBom)

Write-Host '[PASS] main.go berhasil dipatch.'
Write-Host '[CHECK] DocumentMessage sekarang memakai basename asli:'
Write-Host '        Title    = filepath.Base(mediaPath)'
Write-Host '        FileName = filepath.Base(mediaPath)'
