---
name: artifact-generation
description: Mengubah working content menjadi DOCX/PPTX/XLSX/PDF nyata di task aktif Unit Elite v1.3.
---

# Artifact Generation v1.3

## Prinsip
- `.md` dan `.json` adalah intermediate internal.
- Jika disposisi meminta file Office/PDF, gunakan custom tool artifact terkait sebelum QC II.
- Semua artifact disimpan hanya di `workspace/active/<TASK-ID>/output/`.
- Generator otomatis mendaftarkan file pada `task.json`.
- Jangan membuat file langsung di `workspace/output/` legacy.

## Tool
- `generate_docx`: naskah dinas berbasis master template v1.2.
- `generate_pptx`: paparan 16:9 berbasis slide JSON.
- `generate_xlsx`: matriks/rekap dari workbook JSON.
- `generate_pdf`: brief PDF sederhana.
- `artifact_validate`: pemeriksaan struktur file sebelum QC/closure.
- `artifact_diagnostics`: memeriksa embedded artifact engine; tidak melakukan install atau spawn proses eksternal.

## DOCX
Gunakan `template_manifest.json` untuk nama field. Jangan menebak field register/kode/pejabat. Missing fields akan muncul sebagai marker `<<BELUM DIISI:FIELD>>` agar tidak tersembunyi.

## PPTX
Buat slide specification terlebih dahulu. Hindari memasukkan klaim yang belum QC I. Table/bullets harus ringkas dan decision-oriented.

## XLSX
Gunakan untuk matriks comparison, RIA, rekapan, atau data terstruktur. Jangan mengarang data untuk mengisi sel kosong.
