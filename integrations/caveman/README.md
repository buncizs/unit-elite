# Unit Elite — Caveman Proxy Integration (integrations/caveman/)

Status: **DRAFT / belum production** — skeleton fungsional, belum diaktifkan.
TECH-ID: `TECH-0002-optimasi-token` (riset: `workspace/active/TECH-0002-optimasi-token/CAVEMAN_INTEGRATION.md`)

## Peran

Caveman diintegrasikan sebagai **proxy OPSIONAL penghemat token** pada jalur:

```
Runtime Gateway (:20129)  →  [ CAVEMAN PROXY (B2) ]  →  9Router (:20128/v1)
```

Jalur aktif yang direkomendasikan riset adalah **B2** (antara Runtime Gateway ↔ 9Router).
Proxy menangkap payload input penuh yang dikirim antar-subagent sebelum masuk provider,
mengompresi input/context untuk **hemat token**. Ini adalah akar dominan boros token
(7M token) menurut CAVEMAN_INTEGRATION.md §3.

Jalur B1 (OpenCode ↔ Runtime Gateway) dan Jalur A (skill hemat-output) adalah
opsi lanjutan — belum diimplementasikan di skeleton ini.

## Lisensi

- **Caveman skill** — lisensi **MIT** (aman dibawa masuk sebagai source Unit Elite).
- **Caveman proxy** — lisensi **BSL-1.1** (Business Source License). Self-host untuk
  use **first-party** (Unit Elite operasi internal) diperkirakan gratis, bukan SaaS
  pihak ketiga. Batas persis `Additional Use Grant` perlu review Analis Legal.
  `[NEEDS_VERIFICATION]` — teks lisensi & detail kontrib jaringan belum dikonfirmasi
  dari sumber resmi Caveman (tidak ada berkas knowl Caveman di pohon repo).

## Status

| Item | Nilai |
|---|---|
| Jalur aktif | B2 (Runtime :20129 ↔ 9Router :20128) |
| Mode default | `enabled: false` — **aman**: tidak menyentuh jalur inference |
| Implementasi | Skeleton placeholder — bukan proxy nyata |
| Pengujian acceptance | Belum (dilakukan setelah proxy nyata tersedia) |
| Bypass | Wajib fail-open ke 9Router asli bila Caveman mati (kontrak §4 riset) |

## Detail yang belum dikonfirmasi dari sumber resmi Caveman

- Versi skill & proxy Caveman yang tersedia. `[NEEDS_VERIFICATION]`
- Teks lengkap lisensi BSL-1.1 dan batas `Additional Use Grant`. `[NEEDS_VERIFICATION]`
- Dukungan opencode "natively". `[NEEDS_VERIFICATION]`
- Perilaku kompresi input/output dan format endpoint OpenAI/Anthropic-compatible. `[NEEDS_VERIFICATION]`

## File

| File | Tujuan |
|---|---|
| `README.md` | Dokumen ini (peran, topologi B2, lisensi, status). |
| `start-caveman.cmd` | Placeholder launcher (loopback-only, fail-closed — mengikuti pola `integrations/9router/`). |
| `config.sample.json` | Template konfigurasi proxy (default aman `enabled: false`). |
| `package.json` | Skeleton npm package (`unit-elite-caveman` v0.1.0, dependencies kosong). |
| `NOTES.md` | Catatan langkah & risiko ringkas dari CAVEMAN_INTEGRATION.md. |

## Prinsip keselamatan (mengikuti konvensi integrations/9router/)

- Loopback only — tidak pernah bind `0.0.0.0`; fail-closed bila eksposur terdeteksi.
- Tidak menyimpan credential/secret di file konfigurasi.
- Tidak mengubah source 9Router, runtime-gateway.cjs, atau OpenCode di skeleton ini.
- Saat diaktifkan nanti: perubahan `runtime-config.json` (`upstream_router`) harus
  minimal, dan proxy harus bypassable (fail-open) agar runtime tetap bisa lanjut.

## Acceptance

Skeleton ini **PATCH_READY_FOR_ACCEPTANCE** — bukan PRODUCTION_READY. Aktivasi proxy
nyata menunggu verifikasi fact base Caveman, review lisensi Analis Legal, regression
test, dan SYSTEM ACCEPTANCE (sesuai HANDOVER §7.4 Prioritas 4).
