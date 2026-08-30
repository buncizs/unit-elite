# Skill: Communication Gateway & Human Approval

## Tujuan
Menyiapkan dan, bila backend live telah diaktifkan, mendispatch komunikasi keluar secara terkontrol tanpa mencampurkan pembuatan dokumen dengan tindakan pengiriman.

## Boundary
- Artifact creation ≠ communication.
- QC PASS ≠ approval to send.
- `TASK SELESAI` ≠ approval to send.
- Pengiriman eksternal memerlukan approval eksplisit user yang diawali `KIRIM`.

## Delivery Package state machine
`DRAFT -> READY_FOR_APPROVAL -> APPROVED -> DISPATCHING/PARTIAL_SENT -> DISPATCHED | SENT_WITH_ERRORS`.
Alternatif sebelum dispatch: `CANCELLED`.

## Prepare
Delivery Package wajib mencatat:
- package ID dan TASK-ID;
- channel;
- target source;
- setiap recipient/target;
- message per recipient;
- attachment + checksum;
- status contact/WhatsApp;
- exception;
- state.

Attachment harus sudah berada di `input/`, `output/`, atau `support/` task aktif.

## Human approval
Sebelum approval tampilkan preview ke user. Stop pada `READY_FOR_APPROVAL`.
Approval valid hanya bila user memberi instruksi eksplisit seperti:
- `KIRIM PESAN`
- `KIRIM SEMUA`
- `KIRIM NOMOR 1-10`
- `KIRIM 1,3,7`
- `KIRIM SEMUA KECUALI ...`

Selection harus diterjemahkan menjadi indeks target eksplisit dan dicatat dengan `communication_approve`.

## Dispatch guard
Sebelum SETIAP send eksternal, `communication_dispatch_guard` wajib PASS. Gunakan recipient, message, dan attachment persis dari guard. Guard memeriksa approval dan checksum attachment.

## Record
Setelah backend attempt, catat outcome faktual dengan `communication_record`:
- `SENT`
- `FAILED`
- `SKIPPED`
- `DELIVERED`
- `READ`

Jangan memakai DELIVERED/READ tanpa evidence backend.

## School forwarding
Flow: extract target -> target QC -> Narahubung -> contact/message QC -> Dispatcher -> Delivery Package -> user approval -> optional dispatch.
Target tanpa kontak tetap ada dan `SKIPPED_NO_CONTACT`.

## Internal/pimpinan forwarding
Resolve melalui `internal_contact_lookup`; ambiguity harus dikembalikan ke Ketua/user. Jangan menebak nomor pimpinan.

## Natural communication
Pesan eksternal tidak boleh memuat enum mesin, confidence score, atau istilah workflow internal. Bahasa harus sesuai relasi dan konteks penerima.

## Backend abstraction
Agent bekerja terhadap konsep verify/send/file/status. Build dasar tidak boleh bergantung permanen pada satu backend. Pilot `lharries/whatsapp-mcp` bersifat optional dan disabled by default.
