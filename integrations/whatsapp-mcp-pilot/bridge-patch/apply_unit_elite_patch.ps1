param(
  [Parameter(Mandatory=$true)][string]$BridgePath
)
$ErrorActionPreference = 'Stop'
$main = Join-Path $BridgePath 'main.go'
if (!(Test-Path $main)) { throw "main.go tidak ditemukan: $main" }
$text = Get-Content -LiteralPath $main -Raw -Encoding UTF8
$marker = 'UNIT_ELITE_WHATSAPP_PILOT_V151'
if ($text.Contains($marker)) {
  Write-Host 'Patch v1.5.1 sudah terpasang. Tidak ada perubahan.' -ForegroundColor Yellow
  exit 0
}
$anchors = @(
  'type SendMessageRequest struct {',
  'func startRESTServer(client *whatsmeow.Client, messageStore *MessageStore, port int) {',
  'serverAddr := fmt.Sprintf(":%d", port)'
)
foreach ($a in $anchors) { if (!$text.Contains($a)) { throw "Anchor upstream berubah/tidak ditemukan: $a" } }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path $BridgePath "main.go.pre-unit-elite-$stamp.bak"
Copy-Item -LiteralPath $main -Destination $backup

$needle = "// Function to send a WhatsApp message`n"
$insert = @'
// UNIT_ELITE_WHATSAPP_PILOT_V151
// Minimal local verification API types for Unit Elite pilot.
type VerifyNumbersRequest struct {
	Numbers []string `json:"numbers"`
}

type VerifyNumberResult struct {
	Number     string `json:"number"`
	Registered bool   `json:"registered"`
	JID        string `json:"jid,omitempty"`
}

'@
if (!$text.Contains($needle)) { throw 'Insertion point send function tidak ditemukan' }
$text = $text.Replace($needle, $insert + $needle)

$needle2 = "func startRESTServer(client *whatsmeow.Client, messageStore *MessageStore, port int) {`n"
$handlers = @'

	// Unit Elite pilot: local health endpoint, no message access.
	http.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success":   true,
			"connected": client.IsConnected(),
		})
	})

	// Unit Elite pilot: verify whether normalized phone numbers are registered on WhatsApp.
	http.HandleFunc("/api/verify", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !client.IsConnected() {
			http.Error(w, "WhatsApp bridge is not connected", http.StatusServiceUnavailable)
			return
		}
		var req VerifyNumbersRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, "Invalid request format", http.StatusBadRequest)
			return
		}
		if len(req.Numbers) == 0 {
			http.Error(w, "numbers is required", http.StatusBadRequest)
			return
		}
		if len(req.Numbers) > 50 {
			http.Error(w, "maximum 50 numbers per verification request", http.StatusBadRequest)
			return
		}
		phones := make([]string, 0, len(req.Numbers))
		for _, p := range req.Numbers {
			p = strings.TrimSpace(strings.TrimPrefix(p, "+"))
			if p != "" {
				phones = append(phones, p)
			}
		}
		if len(phones) == 0 {
			http.Error(w, "no usable numbers", http.StatusBadRequest)
			return
		}
		resp, err := client.IsOnWhatsApp(context.Background(), phones)
		if err != nil {
			http.Error(w, fmt.Sprintf("verification failed: %v", err), http.StatusBadGateway)
			return
		}
		results := make([]VerifyNumberResult, 0, len(resp))
		for _, item := range resp {
			results = append(results, VerifyNumberResult{
				Number: item.Query,
				Registered: item.IsIn,
				JID: item.JID.String(),
			})
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": true,
			"results": results,
		})
	})
'@
if (!$text.Contains($needle2)) { throw 'Insertion point startRESTServer tidak ditemukan' }
$text = $text.Replace($needle2, $needle2 + $handlers)
$text = $text.Replace('serverAddr := fmt.Sprintf(":%d", port)', 'serverAddr := fmt.Sprintf("127.0.0.1:%d", port)')
Set-Content -LiteralPath $main -Value $text -Encoding UTF8
Write-Host "PATCHED: $main" -ForegroundColor Green
Write-Host "BACKUP : $backup"
Write-Host 'REST bridge akan dibind ke 127.0.0.1 setelah build/run.'
