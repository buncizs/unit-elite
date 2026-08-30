---
description: Smoke test ringan v1.3 secara sekuensial; satu DOCX dan satu QC, task dibiarkan ACTIVE
agent: ketua-tim
---

Lakukan uji paling ringan dan SEKUENSIAL:
1. jalankan `artifact_diagnostics`;
2. buat TASK-ID tanpa input berjudul `Uji v1.3 DOCX`;
3. delegasikan hanya ke `juru-korespondensi` untuk membuat satu Nota Dinas fiktif menggunakan master `nota-dinas`. Semua metadata yang tidak diketahui wajib placeholder. Artifact DOCX harus benar-benar dibuat;
4. delegasikan hanya ke `verifikator-qc` untuk artifact validation dan QC sederhana;
5. laporkan TASK-ID, path DOCX, dan QC status.

JANGAN tutup atau hapus task. Informasikan bahwa user dapat mengatakan `BATALKAN TASK` setelah selesai menguji.
