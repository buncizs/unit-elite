---
description: Otorisasi eksplisit human-in-the-loop untuk mengirim Delivery Package yang sedang direview
agent: ketua-tim
---

Pesan ini adalah approval eksplisit USER untuk pengiriman:
$ARGUMENTS

WAJIB:
1. Identifikasi Delivery Package yang sedang direview. Jika lebih dari satu/ambigu, minta package ID.
2. Terjemahkan selection user menjadi indeks target eksplisit. Jangan memperluas selection.
3. [LEGACY V1 ONLY] Untuk WhatsApp V2, jangan panggil `communication_approve`; gunakan approval phrase langsung pada `whatsapp_bulk_v2 action=dispatch`.
4. [LEGACY V1 ONLY] Untuk WhatsApp V2, jangan melakukan guard per target; gunakan satu `whatsapp_bulk_v2 action=dispatch` untuk seluruh package.
5. Jika backend WhatsApp belum aktif/terhubung, STOP dengan status `BACKEND_NOT_CONNECTED`; jangan menandai SENT.
6. Setelah attempt backend, `communication_record` wajib mencatat hasil faktual per target.
7. Laporkan SENT / FAILED / SKIPPED secara terpisah.

Jangan menganggap TASK SELESAI sebagai approval kirim.

<!-- UNIT_ELITE_MANAGED:COMMUNICATION_GATEWAY_V2_BEGIN -->
## V2 override

For WhatsApp, do not follow the legacy per-target communication_approve / communication_dispatch_guard / whatsapp_bridge_dispatch loop.

Use:
- whatsapp_bulk_v2 prepare with the complete recipient list
- one consolidated preview
- explicit KIRIM
- whatsapp_bulk_v2 dispatch once

Standalone WhatsApp is SERVICE-COMM-WHATSAPP and must not create a normal TASK-ID.
<!-- UNIT_ELITE_MANAGED:COMMUNICATION_GATEWAY_V2_END -->

<!-- UNIT_ELITE_MANAGED:WHATSAPP_V2_FINAL_CLEAN_ROUTE_BEGIN -->
## WhatsApp V2 Final Command Override

If the requested channel is WhatsApp, ignore all legacy V1 steps above that mention:
`communication-gateway`, `communication_prepare`, `communication_approve`,
`communication_dispatch_guard`, `whatsapp_bridge_dispatch`, TASK-ID, or recipient index.

Use only:
1. `contact_registry_v2` as needed;
2. `whatsapp_bulk_v2 action=prepare` once;
3. one preview;
4. one explicit user send approval;
5. `whatsapp_bulk_v2 action=dispatch` once;
6. one final summary.
<!-- UNIT_ELITE_MANAGED:WHATSAPP_V2_FINAL_CLEAN_ROUTE_END -->

<!-- UNIT_ELITE_MANAGED:WHATSAPP_EXCEL_FALLBACK_V2_BEGIN -->
## WhatsApp Bridge-Unavailable UX

If WhatsApp V2 reports BRIDGE_UNAVAILABLE, do not expose backend stack traces or retry loops.
Ask whether to export the package to Excel with wa.me links.

YES -> export_excel.
NO -> ask TUNGGU BRIDGE or BATALKAN.
TUNGGU BRIDGE -> wait.
BATALKAN -> cancel.

A waiting package must never send automatically when the bridge later returns.
<!-- UNIT_ELITE_MANAGED:WHATSAPP_EXCEL_FALLBACK_V2_END -->
