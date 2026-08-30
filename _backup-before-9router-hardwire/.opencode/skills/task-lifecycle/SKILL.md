---
name: task-lifecycle
description: Aturan membuat, mempertahankan, menutup, membatalkan, dan mengarsipkan task Unit Elite secara transaksional.
---

# Task Lifecycle v1.3.3

## Start
Ketua menggunakan `task_create`. Input wajib berasal dari `workspace/inbox`. Tool MENYALIN input; original tidak dipindahkan. Jika file inbox tambahan dibutuhkan setelah task berjalan, Ketua harus menggunakan `task_add_input` agar file tersebut terdaftar dalam audit trail dan closure.

## Active
Seluruh agent bekerja di `workspace/active/<TASK-ID>/`. Task boleh berhari-hari dan dapat direvisi tanpa membuat task baru bila tujuan disposisinya sama.

## Done Keyword
`TASK SELESAI` adalah satu-satunya authorization phrase untuk closure.

Closure hanya boleh dilakukan Arsiparis melalui `task_close`, setelah:
- QC PASS/PASS WITH NOTES;
- artifact nyata tersedia;
- artifact validation PASS.

## Close Result
`workspace/task_done/YYYY-MM-DD_HH-MM-SS__TOPIK/` dengan input, working, support, output, qc, executive-summary.pdf, dan manifest.json.

## Safe Cleanup
Input original inbox hanya dihapus jika:
1. task telah berpindah atomik ke archive;
2. checksum artifact archive sesuai;
3. checksum source inbox belum berubah sejak task dimulai.

Jika source berubah, file dipertahankan dan manifest mencatat alasan.

## Cancel
`BATALKAN TASK` memindahkan task aktif ke `workspace/task_cancelled/` dan TIDAK membersihkan inbox.


## File-Lock Gate dan Atomic Closure
Sebelum closure atau cancellation, tool melakukan preflight terhadap lock file Office (`~$...`) dan kemampuan rename filesystem. Jika ada file/folder yang sedang terbuka/terkunci, closure wajib berhenti dengan `BLOCKED_FILE_IN_USE`. Tidak boleh membuat archive copy, tidak boleh menghapus active task, dan tidak boleh retry otomatis.

Closure sukses memakai **atomic rename** seluruh folder task dari `workspace/active/` ke `workspace/task_done/`, bukan pola copy lalu delete. Dengan demikian tidak boleh ada duplikasi output yang tertinggal di active. Inbox cleanup dilakukan paling akhir setelah archive dan checksum valid.
