# Hotfix v1.3.3 — Atomic Close & File-Lock Gate

Masalah v1.3.2: `task_close` membuat salinan ke `task_done` terlebih dahulu, kemudian menghapus `workspace/active/<TASK-ID>`. Di Windows, bila DOCX/PPTX/XLSX/PDF masih dibuka, recursive delete dapat gagal di tengah proses. Akibatnya archive sudah ada tetapi active task tersisa sebagian (sering hanya `output/` dan file yang terkunci).

v1.3.3 mengubah closure menjadi fail-fast dan atomik:

1. Deteksi Office lock file `~$...`.
2. Probe rename terhadap file task, folder task, dan input inbox yang akan dibersihkan.
3. Jika ada lock: return `BLOCKED_FILE_IN_USE`; tidak membuat task_done, tidak menghapus active, tidak cleanup inbox.
4. Jika aman: seluruh folder active dipindah dengan satu atomic filesystem rename ke task_done.
5. Executive summary dan manifest dibuat setelah move; bila finalisasi gagal sebelum cleanup, sistem mencoba rollback ke active.
6. Inbox cleanup dilakukan paling akhir.
7. `BATALKAN TASK` juga memakai atomic rename dan file-lock gate.
8. Tool `task_repair_partial_close` tersedia untuk membersihkan residue yang ditinggalkan v1.3.2, hanya jika archive CLOSED yang cocok ada dan checksum residue identik.
