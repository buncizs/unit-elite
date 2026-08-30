# Unit Elite v1.5.1 — WhatsApp Pilot Bridge

Tahap ini menghubungkan Communication Gateway Unit Elite ke **Go bridge** dari `lharries/whatsapp-mcp` secara lokal. Unit Elite **tidak mengekspos seluruh MCP WhatsApp** dan **tidak memerlukan Python/uv** untuk pilot ini; custom tool Unit Elite berkomunikasi langsung dengan REST bridge pada `127.0.0.1:8080`.

## Mengapa bridge dipatch
Upstream bridge mendengarkan pada `:8080` (semua interface). Pilot Unit Elite mengubahnya menjadi `127.0.0.1:8080`, menambah endpoint read-only `/api/health`, dan endpoint `/api/verify` berbasis `whatsmeow.Client.IsOnWhatsApp`.

## Guard pilot
- `pilot_mode=true` secara default.
- Hanya nomor dalam `allowed_numbers` yang boleh menerima dispatch nyata.
- Maksimum 3 recipient per approval pada pilot.
- Human approval `KIRIM ...` tetap wajib.
- `TASK SELESAI` bukan approval pengiriman.

## Prasyarat Windows
1. Go 1.24+.
2. MSYS2 UCRT64/GCC karena upstream menggunakan `go-sqlite3`/CGO.
3. Repository `lharries/whatsapp-mcp` yang sudah diekstrak/clone.

Python/uv tidak diperlukan untuk Unit Elite pilot karena Python MCP server tidak digunakan dan patch bridge dijalankan melalui PowerShell.

## Urutan
1. Copy folder `bridge-patch` dan `windows` ke lokasi yang mudah ditemukan.
2. Jalankan `01_APPLY_PATCH.bat` dan pilih folder `whatsapp-bridge` upstream.
3. Jalankan `02_BUILD_BRIDGE.bat`.
4. Jalankan `03_RUN_AND_PAIR.bat`, lalu scan QR WhatsApp.
5. Edit `pilot_config.json` di project Unit Elite dan isi 1–3 nomor milik tim sendiri.
6. Di OpenCode jalankan `/uji-whatsapp-pilot`.
7. Jangan menguji sekolah dulu.
