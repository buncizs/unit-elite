# Unit Elite — Caveman Proxy Integration (integrations/caveman/)

Status: **Wiring fail-open TERPASANG; proxy binary PENDING instalasi**.
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
opsi lanjutan — belum diimplementasikan di sini.

## Status Aktual

| Item | Nilai |
|---|---|
| Wiring fail-open B2 | ✅ **TERPASANG & terprogram** — `runtime-gateway.cjs` memanggil `caveman-router.cjs` (require line 46) dan menge-log `caveman=ACTIVE` / `caveman=BYPASS (unavailable)` / `caveman=BYPASS (disabled)` via `safeLog`. |
| Router fail-open | ✅ `caveman-router.cjs` = resolver fail-open (port 20127; jika config menyatakan; bila tak reachable → bypass ke 9Router :20128). |
| Config | ✅ `config.json` = `enabled:true`, port 20127, fail-open. |
| Regression test | ✅ `caveman-router.test.cjs` = 3 skenario (ACTIVE / BYPASS-unavailable / BYPASS-disabled) — lulus. |
| Launcher | ✅ `start-caveman.cmd` = launcher jujur (deteksi binary; exit 2 bila tidak ada; fail-closed 0.0.0.0). |
| **Proxy binary** | ❌ **BELUM TERINSTAL** (`@caveman-ai/cli` tidak ada di sistem). Karena itu listener 20127 tidak ada → runtime akan log `caveman=BYPASS (unavailable)` (bukan ACTIVE) sampai binary diinstal & proxy dijalankan. |

**Kesimpulan status sebenarnya:** Wiring lengkap & siap, tetapi `caveman=ACTIVE`
BELUM tercapai. Runtime akan berjalan aman dalam mode **BYPASS (unavailable)**,
fail-open ke 9Router :20128, sampai binary Caveman diinstal dan proxy di-start.

## Lisensi

- **Caveman skill** — lisensi **MIT** (aman dibawa masuk sebagai source Unit Elite).
- **Caveman proxy** — lisensi **BSL-1.1** (Business Source License). Self-host untuk
  use **first-party** (Unit Elite operasi internal) dianggap ok oleh user — user
  telah menyetujui **skip** review Analis Legal untuk langkah ini (audit inference
  sudah profesional). **Catatan:** tidak ada fakta hukum baru yang dikarang di sini;
  detail teks lisensi/`Additional Use Grant` yang belum dikonfirmasi dari sumber
  resmi tetap `[NEEDS_VERIFICATION]`, tetapi **bukan blocker**.

## Status

| Item | Nilai |
|---|---|
| Jalur aktif | B2 (Runtime :20129 ↔ 9Router :20128) |
| Mode default | `enabled: true` — wired, fail-open |
| Router | `caveman-router.cjs` (resolver fail-open port 20127, bypass ke 9Router bila unreachable) |
| Regression test | Lulus (3 skenario: ACTIVE / BYPASS-unavailable / BYPASS-disabled) |
| Binary proxy | **PENDING instalasi** — `caveman=ACTIVE` belum tercapai |
| Runtime saat ini | `caveman=BYPASS (unavailable)` (fail-open aman ke 9Router :20128) |
| Bypass | Wajib fail-open ke 9Router asli bila Caveman mati (kontrak §4 riset) |

## Detail yang belum dikonfirmasi dari sumber resmi Caveman

- Versi skill & proxy Caveman yang tersedia. `[NEEDS_VERIFICATION]`
- Teks lengkap lisensi BSL-1.1 dan batas `Additional Use Grant`. `[NEEDS_VERIFICATION]`
- Dukungan opencode "natively". `[NEEDS_VERIFICATION]`
- Perilaku kompresi input/output dan format endpoint OpenAI/Anthropic-compatible. `[NEEDS_VERIFICATION]`

## File

| File | Tujuan |
|---|---|
| `README.md` | Dokumen ini (peran, topologi B2, status aktual, lisensi, status). |
| `config.json` | Konfigurasi aktif (`enabled:true`, port 20127, fail-open). |
| `caveman-router.cjs` | Resolver fail-open B2 (port 20127; bypass ke 9Router :20128 bila unreachable). |
| `caveman-router.test.cjs` | Regression test resolver (3 skenario: ACTIVE / BYPASS-unavailable / BYPASS-disabled). |
| `start-caveman.cmd` | Launcher jujur (deteksi binary; exit 2 bila tidak ada; fail-closed 0.0.0.0). |
| `config.sample.json` | Template konfigurasi proxy (referensi default). |
| `package.json` | Skeleton npm package (`unit-elite-caveman` v0.1.0, dependencies kosong). |
| `NOTES.md` | Catatan langkah & status dari CAVEMAN_INTEGRATION.md. |

## Prinsip keselamatan (mengikuti konvensi integrations/9router/)

- Loopback only — tidak pernah bind `0.0.0.0`; fail-closed bila eksposur terdeteksi.
- Tidak menyimpan credential/secret di file konfigurasi.
- Wiring fail-open sudah terpasang: `runtime-gateway.cjs` + `caveman-router.cjs`.
- Proxy tetap bypassable (fail-open) agar runtime selalu bisa lanjut bila Caveman mati.

## Acceptance

Status instalasi ini: **PATCH_READY_FOR_PENDING_BINARY_ACTIVATION**. Wiring fail-open
terpasang & diuji; aktivasi proxy nyata menunggu **instalasi binary**:

Untuk menaikkan **BYPASS → ACTIVE**:
1. Instal binary `@caveman-ai/cli` (atas persetujuan Ketua, tidak menginstal otomatis).
2. Jalankan `start-caveman.cmd` (atau set binary flag sesuai launcher) sehingga
   listener 20127 aktif.
3. Verifikasi runtime meng-log `caveman=ACTIVE`.

Sampai langkah tersebut selesai, runtime berjalan aman dalam mode
`caveman=BYPASS (unavailable)` (fail-open ke 9Router :20128). Ini bukan
PRODUCTION_READY — aktivasi penuh menunggu instalasi binary & SYSTEM ACCEPTANCE.
