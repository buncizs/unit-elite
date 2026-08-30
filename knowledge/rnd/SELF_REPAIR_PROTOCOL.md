# SELF-REPAIR PROTOCOL

Self-repair = Developer mendiagnosis, membuat patch terisolasi, menguji, memperbaiki patch, menyiapkan rollback. Bukan unrestricted self-modification.

DETECT -> DIAGNOSE -> SNAPSHOT/PATCH AREA -> PATCH -> TEST -> REVIEW -> ACCEPTANCE

Maksimal 3 attempt per TECH-ID. Setelah 3 gagal: ESCALATION_REQUIRED.
Hard stop: potensi data loss, credential/session mutation, external dispatch, security-sensitive change, destructive action tanpa rollback realistis.
