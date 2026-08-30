Lakukan UJI WHATSAPP PILOT secara read-only/verification-only. JANGAN mengirim pesan.

1. Delegasikan ke `dispatcher-komunikasi`.
2. Jalankan `whatsapp_bridge_diagnostics`.
3. Baca `integrations/whatsapp-mcp-pilot/pilot_config.json`.
4. Jika bridge OFFLINE, STOP dan laporkan.
5. Jika `allowed_numbers` kosong, laporkan bahwa user harus mengisi 1-3 nomor uji format 62...; STOP.
6. Jika tersedia, panggil `whatsapp_bridge_verify` hanya terhadap `allowed_numbers`.
7. Jangan panggil `whatsapp_bridge_dispatch`.
8. Laporkan: bridge status, jumlah nomor pilot, hasil verify tiap nomor, dan readiness untuk delivery test.
