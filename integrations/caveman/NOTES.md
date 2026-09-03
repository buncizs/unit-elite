# Caveman Integration — NOTES

> Disclaimer: **Wiring fail-open TERPASANG; proxy binary PENDING instalasi**.
> Wiring & regression test sudah dieksekusi (`runtime-gateway.cjs` → `caveman-router.cjs`,
> config.json enabled, test 3 skenario lulus). `@caveman-ai/cli` **belum terinstal**,
> sehingga listener 20127 belum ada → runtime log `caveman=BYPASS (unavailable)`.
> Sumber: RISTEK CAVEMAN_INTEGRATION.md.

## Topologi sasaran (mode B2)
`Runtime Gateway (:20129) → [CAVEMAN PROXY] → 9Router (:20128/v1)`
Proxy selip di antara gateway ↔ router, menangkap payload input penuh sebelum provider;
kompresi input/context untuk hemat token (akar dominan 7M token).

## Langkah yang akan ditempuh setelah wiring
1. **Aktivasi binary Caveman** — instal `@caveman-ai/cli` + start proxy 20127
   (via `start-caveman.cmd` atau set binary flag). Belum dilakukan secara otomatis;
   menunggu persetujuan Ketua (launcher jujur: exit 2 bila binary tidak ada).
2. Verifikasi fact base Caveman yang belum konfirmasi (versi skill/proxy, teks BSL-1.1,
   dukungan opencode). Semua detail spesifik Caveman yang belum dikonfirmasi →
   `[NEEDS_VERIFICATION]` (bukan blocker).
3. Sandbox di `integrations/caveman/` (sudah wired). Pastikan start/stop/health cmd
   (pola `integrations/9router/`, loopback-only, fail-closed 0.0.0.0) konsisten,
   arahkan `upstream_router` runtime-gateway lewat proxy (minimalisasi diff).
4. Bypass wajib: fail-open ke 9Router asli bila Caveman mati (sudah terprogram &
   runtime tetap lanjut).
5. Regression test: payload sampel, pengukuran hemat token (target 15–30% input),
   bypass test, fail-closed eksposur, latensi/timeout, acceptance harness FallbackController.
6. QC Verifikator.
7. Serialkan dengan patch P1 (agent write-tool) + P3 (write-to-disk handoff).

## Risiko utama
- **Protokol/parameter drift** gateway-streaming, `gemini_quarantine`,
  `sanitizeCompletion` (FallbackController), NO_PROVIDER short-circuit.
- **BSL-1.1**: self-host first-party dianggap ok oleh user (user setujui skip review
  Analis Legal; audit inference sudah profesional). Tidak ada fakta hukum baru
  dikarang; detail teks belum dikonfirmasi tetap `[NEEDS_VERIFICATION]` (bukan blocker);
  jangan tarik ke repo produksi bila tidak netral.
- **Latensi/timeout**: proxy harus di-bypass-able (fail-open), tidak memperlambat
  inference > ambang.
- **Status**: wiring fail-open terpasang, tetapi `caveman=ACTIVE` **belum tercapai** —
  perlu instalasi binary `@caveman-ai/cli` + start proxy 20127. Saat ini runtime
  di mode `caveman=BYPASS (unavailable)`. Aktivasi penuh menunggu instalasi binary &
  SYSTEM ACCEPTANCE (HANDOVER §7.4 Prioritas 4).