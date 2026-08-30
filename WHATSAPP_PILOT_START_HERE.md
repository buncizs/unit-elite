# WhatsApp Pilot Start Here

Unit Elite v1.5.1 adalah tahap **pilot**, bukan produksi sekolah.

## Tujuan lulus tahap ini
1. Bridge Go berjalan hanya pada `127.0.0.1:8080`.
2. QR pairing berhasil menggunakan akun WhatsApp pilot.
3. `/api/health` -> connected true.
4. `/api/verify` membedakan nomor pilot terdaftar/tidak terdaftar.
5. OpenCode `/uji-whatsapp-pilot` PASS tanpa mengirim apa pun.
6. Satu Delivery Package dikirim hanya ke nomor allowlist setelah user memberi `KIRIM PESAN`.

Setelah enam poin PASS, baru lanjut Stage 4: verifikasi/fallback kontak sekolah dengan batch terbatas.
