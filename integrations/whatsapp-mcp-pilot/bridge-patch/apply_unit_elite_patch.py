from pathlib import Path
import sys, shutil, re, datetime

MARKER = "UNIT_ELITE_WHATSAPP_PILOT_V151"

def fail(msg):
    print(f"ERROR: {msg}")
    sys.exit(1)

if len(sys.argv) < 2:
    fail("Usage: apply_unit_elite_patch.py <path-to-whatsapp-bridge>")
bridge = Path(sys.argv[1]).expanduser().resolve()
main = bridge / "main.go"
if not main.exists():
    fail(f"main.go tidak ditemukan: {main}")
text = main.read_text(encoding="utf-8")
if MARKER in text:
    print("Patch v1.5.1 sudah terpasang. Tidak ada perubahan.")
    sys.exit(0)

anchors = [
    'type SendMessageRequest struct {',
    'func startRESTServer(client *whatsmeow.Client, messageStore *MessageStore, port int) {',
    'serverAddr := fmt.Sprintf(":%d", port)',
]
for a in anchors:
    if a not in text:
        fail(f"Anchor upstream berubah/tidak ditemukan: {a}. Jangan patch otomatis; review manual diperlukan.")

stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
backup = main.with_name(f"main.go.pre-unit-elite-{stamp}.bak")
shutil.copy2(main, backup)

# Insert verification structs before the send function comment.
needle = '// Function to send a WhatsApp message\n'
insert = r'''// UNIT_ELITE_WHATSAPP_PILOT_V151
// Minimal local verification API types for Unit Elite pilot.
type VerifyNumbersRequest struct {
	Numbers []string `json:"numbers"`
}

type VerifyNumberResult struct {
	Number     string `json:"number"`
	Registered bool   `json:"registered"`
	JID        string `json:"jid,omitempty"`
}

'''
if needle not in text:
    fail("Insertion point send function tidak ditemukan")
text = text.replace(needle, insert + needle, 1)

# Insert health + verify handlers immediately after startRESTServer opening.
needle2 = 'func startRESTServer(client *whatsmeow.Client, messageStore *MessageStore, port int) {\n'
handlers = r'''
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
'''
text = text.replace(needle2, needle2 + handlers, 1)

# Bind REST API only to loopback instead of all interfaces.
text = text.replace('serverAddr := fmt.Sprintf(":%d", port)', 'serverAddr := fmt.Sprintf("127.0.0.1:%d", port)', 1)

main.write_text(text, encoding="utf-8")
print(f"PATCHED: {main}")
print(f"BACKUP : {backup}")
print("Security: REST bridge sekarang dibind ke 127.0.0.1 setelah build/run.")
