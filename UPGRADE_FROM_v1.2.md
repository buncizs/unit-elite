# Upgrade dari v1.2 Tata Naskah ke v1.3

Disarankan membuka v1.3 sebagai project baru, bukan menimpa folder v1.2 yang sedang digunakan.

Yang dipertahankan:
- seluruh 9 agent;
- seluruh regulations/references;
- tujuh master template Tata Naskah;
- rulebook Pergub Jatim 31/2024;
- klasifikasi Pergub Jatim 30/2023;
- skill Tata Naskah/Kearsipan;
- QC legal/substance/tata naskah/numbering.

Yang baru:
- `artifact_engine/`;
- `.opencode/tools/`;
- `package.json` auto dependencies;
- `workspace/task_done/` dan `workspace/task_cancelled/`;
- task manifest + checksum;
- executive summary PDF closure;
- explicit `TASK SELESAI` / `BATALKAN TASK`;
- DOCX/PPTX/XLSX/PDF deliverables.

Catatan: placeholder `TANDA_TANGAN/TTE` pada master v1.2 dinormalisasi menjadi `TANDA_TANGAN_TTE` agar aman untuk template engine. Substansi/layout master tidak diubah karena perubahan ini.
