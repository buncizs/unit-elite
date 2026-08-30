# UNIT ELITE OpenCode Desktop v1.5 — Communication Gateway Edition

Unit Elite v1.5 is a cumulative build based on v1.4 Narahubung + v1.3.x artifact/task lifecycle + v1.2 Tata Naskah Dinas Jatim.

## Core capabilities retained
- 11-agent orchestrated team (Ketua + specialist + QC + Arsiparis + Dispatcher).
- Tata Naskah Dinas Jatim templates/rules.
- DOCX/PPTX/XLSX/PDF artifact generation.
- Atomic task closure with file-lock protection.
- School contact registry and Narahubung.
- Quick school-contact lookup.

## New in v1.5
- Universal Communication Gateway.
- Delivery Package state/audit model.
- Internal/pimpinan contact registry template.
- Universal `forward file X to targets from Y` workflow.
- Human approval gate (`KIRIM ...`) separated from `TASK SELESAI`.
- Per-recipient dispatch guard and immutable attachment checksum check.
- Delivery-result audit logging.
- Optional `lharries/whatsapp-mcp` pilot documentation, disabled by default.

## Safety defaults
- No live WhatsApp backend enabled automatically.
- QC PASS never means send.
- TASK SELESAI never means send.
- Delivery stops at `READY_FOR_APPROVAL` until explicit human authorization.
- Every school target remains in report even when no contact/WA can be used.

Start with `COMMUNICATION_GATEWAY_START_HERE.md`.
