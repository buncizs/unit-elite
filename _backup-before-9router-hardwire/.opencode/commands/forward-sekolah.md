---
description: Siapkan forwarding file di inbox kepada sekolah sesuai daftar target pada dokumen lain; berhenti sebelum pengiriman
agent: ketua-tim
---

Perlakukan ini sebagai DISPOSISI FORWARD KE SEKOLAH.

Instruksi user:
$ARGUMENTS

Workflow wajib:
1. Identifikasi secara eksplisit FILE YANG DITERUSKAN dan DOKUMEN SUMBER TARGET. Jika ambigu, jangan menebak.
2. Buat TASK-ID dan daftarkan kedua file melalui lifecycle.
3. Delegasikan `analis-dokumen` untuk ekstrak semua target minimal NPSN + nama sekolah + Kab/Kota bila ada.
4. Delegasikan `verifikator-qc` untuk TARGET QC. Hard fail jika jumlah target sumber != jumlah target hasil ekstraksi.
5. Delegasikan `narahubung` untuk contact resolution + pesan natural. Semua target sumber WAJIB tetap ada meskipun tanpa nomor/verifikasi.
6. QC contact/message.
7. Delegasikan `dispatcher-komunikasi` untuk `communication_prepare` menggunakan file yang akan diteruskan sebagai attachment.
8. Buat Delivery Preview XLSX bila berguna.
9. Laporkan Delivery Package ID, total target, eligible, no-contact, exception, attachment dan state.
10. **STOP pada READY_FOR_APPROVAL. Jangan mengirim.**

Human approval hanya boleh diproses pada pesan user berikutnya yang eksplisit diawali KIRIM.
