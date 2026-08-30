# Build Notes v1.5.1 — WhatsApp Pilot

- Mempertahankan seluruh v1.5 Communication Gateway.
- Menambahkan pilot config + allowlist real-dispatch.
- Menambahkan command `/uji-whatsapp-pilot` (tidak mengirim pesan).
- Menambahkan patch upstream Go bridge:
  - REST bind ke 127.0.0.1 saja;
  - `/api/health`;
  - `/api/verify` memakai `Client.IsOnWhatsApp`;
  - batch verify maksimum 50 nomor.
- Menambahkan Windows helper BAT untuk patch/build/pair/test.
- Python MCP server upstream tidak diperlukan untuk pilot Unit Elite karena adapter menggunakan REST Go bridge secara langsung.
