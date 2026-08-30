> **v1.3.3 Desktop Root Hotfix:** perbaikan `Path escapes project root: package.json`. Lihat `HOTFIX_v1.3.3.md`.

# START HERE - UNIT ELITE v1.3.3 DESKTOP

## 1. Buka project
Extract ZIP lalu pilih folder `UNIT-ELITE-OpenCode-Desktop-v1.3-ArtifactTaskLifecycle` melalui Open Project di OpenCode Desktop.

Pastikan primary agent adalah `ketua-tim`.

## 2. Cek artifact engine
Jalankan:

`/diagnostik-artifact`

Pada v1.3.3, artifact engine sudah tertanam di project dan tidak memasang dependency apa pun. Tidak ada npm/Bun install, PowerShell, cmd.exe, atau child-process spawn yang diperlukan.

## 3. Taruh input
Masukkan file yang akan dikerjakan ke:

`workspace/inbox/`

## 4. Mulai task
Gunakan:

`/disposisi <instruksi>`

Ketua wajib membuat TASK-ID. Input akan disalin ke:

`workspace/active/<TASK-ID>/input/`

Input original di inbox tetap ada.

## 5. Output nyata
Jika disposisi meminta Nota Dinas dan PPT, output harus muncul sebagai file nyata di:

`workspace/active/<TASK-ID>/output/`

Contoh:
- `Nota_Dinas_Telaah_PSM.docx`
- `Paparan_Telaah_PSM.pptx`

Markdown hanya digunakan untuk working notes.

## 6. Revisi
Selama belum mengatakan `TASK SELESAI`, task tetap ACTIVE. Minta revisi seperti biasa; artifact baru/versi revisi tetap berada dalam TASK-ID yang sama.

## 7. Tutup task
Setelah output benar dan sudah tidak akan direvisi, katakan:

`TASK SELESAI`

atau gunakan `/task-selesai`.

Sistem akan memvalidasi QC/artifact lalu membentuk:

```text
workspace/task_done/YYYY-MM-DD_HH-MM-SS__TOPIK/
├── input/
├── working/
├── support/
├── output/
├── qc/
├── executive-summary.pdf
└── manifest.json
```

Setelah copy + checksum verified, input original yang dipakai dari inbox boleh dibersihkan. Jika file inbox berubah sejak task dimulai, file tersebut dipertahankan.

## 8. Batal
Katakan `BATALKAN TASK` atau gunakan `/batalkan-task`. Task masuk `workspace/task_cancelled/`; inbox tidak dibersihkan.

## 9. Smoke test
Gunakan `/uji-v13-ringkas`. Tes ini hanya memakai satu drafter + satu QC agar lebih ramah model gratis.
