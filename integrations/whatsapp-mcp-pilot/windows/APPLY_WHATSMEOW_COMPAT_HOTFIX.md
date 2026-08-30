# Unit Elite v1.5.1b — Whatsmeow Compatibility Hotfix

Tujuan hotfix ini:
1. Memperbaiki mismatch API `IsOnWhatsApp` pada dependency lama.
2. Menyediakan jalur RECOMMENDED untuk menaikkan `whatsmeow` ke versi terbaru dan menyesuaikan 5 call site context-aware yang diketahui pada upstream bridge.

## Pilihan yang disarankan
Jalankan `02_UPGRADE_AND_BUILD_RECOMMENDED.bat`.

Alasannya: upstream `lharries/whatsapp-mcp` masih mem-pin `whatsmeow` versi 2025-03 yang diketahui sudah ditolak server WhatsApp pada 2026 dengan error client outdated/405.

## Jika hanya ingin membuktikan compiler
`01_FIX_OLD_API_ONLY.bat` hanya mengganti:

`client.IsOnWhatsApp(context.Background(), phones)`
menjadi
`client.IsOnWhatsApp(phones)`

Ini hanya compatibility fix untuk dependency lama dan BUKAN jalur yang direkomendasikan untuk pairing/live connection.

## Recommended path
1. Double-click `02_UPGRADE_AND_BUILD_RECOMMENDED.bat`.
2. Masukkan path folder `whatsapp-bridge`.
3. Script membuat backup `main.go`, `go.mod`, dan `go.sum`.
4. Script menyesuaikan known context-aware API calls.
5. Script menjalankan `go get go.mau.fi/whatsmeow@latest`, `go mod tidy`, lalu build dengan GCC/MSYS2 auto-discovery.
6. Jika BUILD PASS, lanjutkan pairing.

Jika build masih gagal, kirim seluruh error sejak `[INFO] go get ...` atau `[INFO] go build...`.
