. "$PSScriptRoot\common.ps1"

$s = Get-ComponentSnapshot

Write-Host '[STATUS] Unit Elite Production'
Write-Host "STATUS=$($s.Overall)"
Write-Host "ROUTER=$($s.Router) ENDPOINT=127.0.0.1:20128"
Write-Host "RUNTIME=$($s.Runtime) ENDPOINT=127.0.0.1:20129"
Write-Host "WHATSAPP=$($s.WhatsApp) ENDPOINT=127.0.0.1:8080/api"
Write-Host "OPENCODE=$($s.OpenCode)"

$routerListener = Get-LoopbackListener $RouterPort
if ($routerListener) { Write-Host "ROUTER_PID=$($routerListener.OwningProcess)" }

$runtimeListener = Get-LoopbackListener $RuntimePort
if ($runtimeListener) { Write-Host "RUNTIME_PID=$($runtimeListener.OwningProcess)" }

$whatsappListener = Get-WhatsAppListener
if ($whatsappListener) { Write-Host "WHATSAPP_PID=$($whatsappListener.OwningProcess)" }

$oc = @(Get-OpenCodeMainProcesses)
if ($oc.Count -gt 0) { Write-Host "OPENCODE_PID=$($oc[0].ProcessId)" }

switch ($s.Overall) {
    'READY' { exit 0 }
    'DEGRADED' { exit 1 }
    'STOPPED' { exit 2 }
    'BLOCKED' { exit 3 }
    default { exit 4 }
}
