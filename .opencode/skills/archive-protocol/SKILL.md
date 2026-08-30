---
name: archive-protocol
description: Metadata, versioning, dan penutupan arsip Unit Elite v1.3 melalui lifecycle tools yang aman.
---

# Archive Protocol v1.3

- Arsiparis tidak memakai shell `rm`/`mv` manual.
- Penutupan hanya melalui `task_close` setelah keyword TASK SELESAI.
- Pembatalan hanya melalui `task_cancel` setelah keyword BATALKAN TASK.
- Setiap task done memiliki `manifest.json`, checksum file, `executive-summary.pdf`, dan subfolder input/output/support/qc/working.
- Jangan overwrite task_done lama. Timestamp + slug topik menjadi identitas folder closure.
- Register/nomor surat tidak dibuat oleh Arsiparis.
