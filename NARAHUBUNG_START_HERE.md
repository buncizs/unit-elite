# Unit Elite v1.5 — Narahubung

Narahubung remains the school-contact specialist. v1.5 separates **contact/message preparation** from **external dispatch**.

## Quick lookup
Use:

```text
/cari-kontak-sekolah SMKN 1 BANDUNG Kab. Tulungagung dan SMKN 1 SAWOO Kab. Ponorogo
```

Quick lookup does not create a task unless an artifact/report is requested.

## Mass school communication
1. Analis Dokumen extracts all NPSN/school targets.
2. Target QC confirms count/integrity.
3. Narahubung resolves contacts and drafts natural messages.
4. Every source target remains in the XLSX, including no-contact/unknown-WA cases.
5. XLSX uses `PENGIRIMAN` + `QC_DETAIL` sheets.
6. Contact/message QC.
7. Dispatcher Komunikasi creates the Delivery Package.
8. System stops at `READY_FOR_APPROVAL`.
9. Only explicit user `KIRIM ...` can proceed to live dispatch.

## Contact rule
- Kepala Sekolah usable number first.
- If absent/invalid format, first usable management contact in the same NPSN/source order.
- `UNKNOWN` WhatsApp status is not proof of failure.
- When reliable verification later reports `NOT_REGISTERED`, fallback may continue within the same NPSN.

## Natural language
Machine status fields never belong in the WhatsApp message itself.
