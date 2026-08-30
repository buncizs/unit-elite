---
description: Smoke test offline Communication Gateway tanpa WhatsApp backend dan tanpa send eksternal
agent: ketua-tim
---

Lakukan UJI KOMUNIKASI OFFLINE v1.5.

1. Buat task dummy tanpa menyentuh data sensitif.
2. Buat satu artifact PDF atau gunakan artifact dummy di task.
3. Siapkan 2 target dummy dengan nomor contoh non-operasional dan pesan natural.
4. Delegasikan `dispatcher-komunikasi` membuat Delivery Package.
5. Pastikan state `READY_FOR_APPROVAL`.
6. Panggil `communication_status`.
7. JANGAN approve dan JANGAN mengirim.
8. Laporkan hasil: task ID, package ID, state, target count, attachment validation, human_approval_required.
