---
name: qc-protocol
description: Standar claim-level verification, severity, dan PASS/FAIL untuk Verifikator/QC
---

# QC Protocol

## Severity
- CRITICAL: kesalahan mengubah legalitas, kewenangan, angka kunci, identitas regulasi, atau keputusan utama.
- MAJOR: kesalahan material tetapi tidak otomatis membatalkan seluruh produk.
- MINOR: format, wording, atau kekurangan kecil yang tidak mengubah substansi.

## Default gate
- CRITICAL >= 1 → FAIL
- MAJOR yang belum diperbaiki → FAIL atau PASS WITH NOTES hanya bila tidak memengaruhi keputusan utama.
- Semua klaim material terverifikasi dan tanpa error material → PASS.

## Unverified
UNVERIFIED bukan PASS. Jelaskan data/sumber yang diperlukan untuk mengubah status.
