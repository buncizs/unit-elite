---
description: Batalkan Delivery Package sebelum dispatch dimulai tanpa membatalkan task
agent: ketua-tim
---

Ini adalah instruksi pembatalan PENGIRIMAN, bukan pembatalan task.
Argumen:
$ARGUMENTS

Identifikasi Delivery Package. Jika ambigu, minta package ID. Delegasikan `dispatcher-komunikasi` untuk `communication_cancel`.
Jika dispatch sudah dimulai, jangan mencoba menghapus histori; laporkan bahwa package tidak dapat dibatalkan secara retroaktif.
