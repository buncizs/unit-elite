# Expected behavior saat TASK SELESAI — v1.3.3

User: `TASK SELESAI`

Expected:
1. Ketua membaca task status.
2. Jika QC belum PASS/PASS WITH NOTES -> closure ditolak.
3. Jika output belum ada/korup -> closure ditolak.
4. `task_close` menjalankan file-lock preflight.
5. Jika DOCX/PPTX/XLSX/PDF atau input inbox masih terbuka/terkunci -> return `BLOCKED_FILE_IN_USE`; tidak membuat task_done, tidak menghapus active, tidak cleanup inbox.
6. Setelah user menutup file dan menjalankan `TASK SELESAI` lagi, task aktif dipindahkan dengan atomic rename ke `workspace/task_done/YYYY-MM-DD_HH-MM-SS__TOPIK/`.
7. `executive-summary.pdf` + `manifest.json` wajib ada dan artifact archive diverifikasi.
8. Inbox source hanya dibersihkan bila checksum source tidak berubah; cleanup dilakukan terakhir.
9. Closure sukses tidak boleh meninggalkan duplicate `workspace/active/<TASK-ID>/output`.
