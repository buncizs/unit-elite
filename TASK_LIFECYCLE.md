# TASK LIFECYCLE v1.3.3

## State
`INBOX -> ACTIVE -> DONE` atau `INBOX -> ACTIVE -> CANCELLED`.

## Safety model
- task start = COPY input dari inbox ke task aktif, bukan move;
- agent boleh membuat/mengubah working file di task aktif sesuai permission;
- tidak ada agent yang mendapat unrestricted delete shell;
- move/delete final hanya melalui lifecycle tool milik Arsiparis;
- `TASK SELESAI` membutuhkan literal confirmation dan QC PASS/PASS WITH NOTES;
- semua artifact terdaftar wajib valid;
- sebelum commit, tool mendeteksi Office lock file (`~$...`) dan melakukan rename-probe pada file/folder;
- jika ada file terbuka/terkunci: `BLOCKED_FILE_IN_USE`, **hard stop**, tidak ada archive copy dan tidak ada cleanup;
- closure sukses memakai **atomic rename** seluruh `workspace/active/<TASK-ID>` ke `workspace/task_done/<timestamp>__<topik>`;
- executive-summary.pdf dan manifest.json dibuat setelah atomic move;
- inbox cleanup adalah langkah terakhir dan hanya untuk source yang checksum-nya tidak berubah;
- source inbox yang berubah atau gagal dibersihkan dipertahankan dan dicatat.

## Transaction behavior
Normal: `PRECHECK -> LOCK PREFLIGHT -> ATOMIC MOVE -> EXECUTIVE SUMMARY -> MANIFEST/CHECKSUM -> INBOX CLEANUP -> CLOSED`.

Jika finalisasi archive gagal sebelum inbox cleanup, tool mencoba rollback folder task ke `workspace/active/`.

## Cancellation
`BATALKAN TASK` juga memakai lock preflight + atomic rename ke `workspace/task_cancelled/`. Tidak ada cleanup inbox.

## Recovery
Jika OpenCode interrupted/crash sebelum closure, folder `workspace/active/<TASK-ID>` tetap dapat dilanjutkan.

Untuk residue partial-close yang sudah terlanjur dibuat oleh v1.3.2, gunakan `/repair-partial-close` setelah seluruh file ditutup. Tool hanya membersihkan residue bila ada archive CLOSED yang cocok dan checksum residue identik.

---

## v1.5 Communication directory
New tasks also contain:

```text
communication/
└── DELIVERY-.../
    └── package.json
```

The entire directory is moved atomically with the task and included in `manifest.json`/executive summary audit. `TASK SELESAI` never creates or approves an outbound send.
