---
description: Otorisasi eksplisit human-in-the-loop untuk mengirim Delivery Package yang sedang direview
agent: ketua-tim
---

Pesan ini adalah approval eksplisit USER untuk pengiriman:
$ARGUMENTS

WAJIB:
1. Identifikasi Delivery Package yang sedang direview. Jika lebih dari satu/ambigu, minta package ID.
2. Terjemahkan selection user menjadi indeks target eksplisit. Jangan memperluas selection.
3. Delegasikan ke `dispatcher-komunikasi` untuk `communication_approve` dengan phrase user saat ini.
4. Untuk tiap target terpilih, dispatcher WAJIB memanggil `communication_dispatch_guard` sebelum tool backend eksternal.
5. Jika backend WhatsApp belum aktif/terhubung, STOP dengan status `BACKEND_NOT_CONNECTED`; jangan menandai SENT.
6. Setelah attempt backend, `communication_record` wajib mencatat hasil faktual per target.
7. Laporkan SENT / FAILED / SKIPPED secara terpisah.

Jangan menganggap TASK SELESAI sebagai approval kirim.
