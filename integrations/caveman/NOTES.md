# Caveman Integration — NOTES

> Disclaimer: **SKELETON** (belum diaktifkan). Ini placeholder; proxy nyata, reversal
> config, dan wiring gateway belum dieksekusi. Sumber: RISTEK CAVEMAN_INTEGRATION.md.

## Topologi sasaran (mode B2)
`Runtime Gateway (:20129) → [CAVEMAN PROXY] → 9Router (:20128/v1)`
Proxy selip di antara gateway ↔ router, menangkap payload input penuh sebelum provider;
kompresi input/context untuk hemat token (akar dominan 7M token).

## Langkah yang akan ditempuh setelah skeleton
1. Verifikasi fact base Caveman (versi skill/proxy, teks BSL-1.1, dukungan opencode).
   Semua detail spesifik Caveman belum konfirmasi → `[NEEDS_VERIFICATION]`.
2. Keputusan jalur (rekomendasi mulai B2); sandbox di `integrations/caveman/`.
3. Implementasi B2: salin proxy binary/config, tambah start/stop/health cmd
   (mirip pola `integrations/9router/`, loopback-only, fail-closed 0.0.0.0),
   arahkan `upstream_router` runtime-gateway lewat proxy (minimalisasi diff).
4. Bypass wajib: fail-open ke 9Router asli bila Caveman mati (runtime tetap lanjut).
5. Regression test: payload sampel, pengukuran hemat token (target 15–30% input),
   bypass test, fail-closed eksposur, latensi/timeout, acceptance harness FallbackController.
6. Review lisensi Analis Legal (BSL-1.1 first-party vs SaaS) + QC Verifikator.
7. Serialkan dengan patch P1 (agent write-tool) + P3 (write-to-disk handoff).

## Risiko utama
- **Protokol/parameter drift** gateway-streaming, `gemini_quarantine`,
  `sanitizeCompletion` (FallbackController), NO_PROVIDER short-circuit.
- **BSL-1.1**: self-host first-party diperkirakan gratis; batas "pihak ketiga"
  perlu review; jangan tarik ke repo produksi bila tidak netral.
- **Latensi/timeout**: proxy harus di-bypass-able (fail-open), tidak memperlambat
  inference > ambang.
- **Status**: belum production; aktivasi menunggu SYSTEM ACCEPTANCE
  (HANDOVER §7.4 Prioritas 4).