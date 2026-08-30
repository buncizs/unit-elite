---
description: Smoke test ringan tata naskah dan QC tanpa membuat dokumen final
agent: ketua-tim
---

Lakukan pengujian SEKUENSIAL dan hemat request:
1. Minta `juru-korespondensi` membuat skeleton Nota Dinas dari kasus fiktif: "Bidang SMK melaporkan perlunya rapat internal evaluasi sarana SMK". Jangan buat nomor agenda, kode komponen, atau pejabat fiktif; pakai placeholder.
2. Minta `verifikator-qc` mengecek hanya: jenis naskah, struktur Nota Dinas, font/template rule, dan anti-fabrication numbering.
3. Laporkan PASS/FAIL komponen. Jangan panggil agent lain. Jangan mengarsipkan.
