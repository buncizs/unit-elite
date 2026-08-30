---
description: Tutup TASK aktif secara atomik setelah QC dan artifact validation; BLOK jika file masih terbuka
agent: ketua-tim
---

Ini adalah otorisasi eksplisit pengguna: **TASK SELESAI**.

Tentukan TASK-ID aktif yang sedang dibahas. Jika ambigu, jangan menebak dan minta user memilih TASK-ID. Jika jelas:
1. cek status task;
2. pastikan QC PASS atau PASS WITH NOTES dan output artifact ada;
3. buat ringkasan eksekutif final yang ringkas namun substantif;
4. delegasikan ke `arsiparis` untuk memanggil `task_close` dengan confirmation phrase `TASK SELESAI` dan `cleanup_inbox=true`;
5. jika `task_close` mengembalikan `BLOCKED_FILE_IN_USE`, **STOP**. Jangan retry otomatis, jangan copy manual, jangan hapus apa pun. Beri warning kepada user dan tampilkan file yang harus ditutup;
6. hanya jika status `CLOSED`/`CLOSED_WITH_NOTES`, laporkan archive path, executive-summary.pdf, dan hasil cleanup inbox.
