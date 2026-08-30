---
description: Perbaiki residue active task akibat bug closure v1.3.2 setelah file ditutup
agent: ketua-tim
---

Gunakan HANYA untuk task yang sebelumnya mengalami partial close pada v1.3.2: archive CLOSED sudah terbentuk tetapi `workspace/active/<TASK-ID>/` masih menyisakan file/folder.

1. Minta/identifikasi TASK-ID secara pasti; jangan menebak.
2. Delegasikan ke `arsiparis` untuk memanggil `task_repair_partial_close`.
3. Jika `BLOCKED_FILE_IN_USE`, STOP dan minta user menutup file yang tercantum.
4. Jika `REPAIR_BLOCKED`, jangan hapus manual; laporkan mismatch/masalah untuk review.
5. Jika `REPAIRED`, laporkan archive yang dipertahankan dan residue active yang sudah dibersihkan.
