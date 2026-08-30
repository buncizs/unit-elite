# ARTIFACT ENGINE v1.3

## Mengapa bukan MCP?
MCP diperlukan bila Unit Elite perlu terhubung ke sistem eksternal seperti DMS, Srikandi, SharePoint, Google Drive, database register, atau regulatory service. Membuat DOCX/PPTX/XLSX/PDF lokal tidak memerlukan MCP.

v1.3.3 memakai OpenCode Custom Tools di `.opencode/tools/` dan runtime lokal di `artifact_engine/`.

## Tool Matrix
| Tool | Fungsi |
|---|---|
| artifact_diagnostics | cek embedded artifact engine tanpa spawn/install |
| generate_docx | isi master naskah dinas dan simpan DOCX |
| generate_pptx | buat paparan 16:9 |
| generate_xlsx | buat matriks/rekap |
| generate_pdf | buat brief PDF |
| artifact_validate | validasi struktur file |
| qc_record | simpan status QC |
| task_create | buat TASK-ID dan copy input |
| task_add_input | register/copy input inbox tambahan ke task aktif |
| task_status | baca status task |
| task_close | closure transaksional setelah TASK SELESAI |
| task_cancel | pembatalan aman |

## Dependencies
v1.3.3 menggunakan embedded artifact engine berbasis Node.js built-ins dan Open XML. Tidak memerlukan `node_modules`, npm registry, Bun install, atau proses eksternal. Ini sengaja dipilih untuk kompatibilitas OpenCode Desktop Windows.

## DOCX
DOCX menggunakan tujuh master normatif v1.2. Untuk produk yang belum memiliki master normatif, tersedia `generic-draft` berlabel DRAFT sebagai artifact kerja, bukan format final resmi. Missing field tidak dihilangkan: engine menulis marker `<<BELUM DIISI:FIELD>>`, sehingga QC dapat menangkap kekurangan metadata.

## Artifact validation
- DOCX: ZIP + `word/document.xml`
- PPTX: ZIP + `ppt/presentation.xml`
- XLSX: ZIP + `xl/workbook.xml`
- PDF: `%PDF-` signature

Validasi ini adalah structural gate, bukan pengganti visual/content QC.
