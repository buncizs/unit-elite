---
description: Tampilkan status Delivery Package dan hasil dispatch tanpa melakukan perubahan
agent: ketua-tim
---

Tentukan TASK-ID dan Delivery Package yang dimaksud dari konteks atau argumen berikut:
$ARGUMENTS

Delegasikan `dispatcher-komunikasi` untuk membaca `communication_status` dan laporkan:
- package ID;
- state;
- total target;
- selected/approved;
- SENT/FAILED/SKIPPED;
- attachment;
- approval phrase/timestamp jika ada;
- exception.

Jangan mengirim atau mengubah status.
