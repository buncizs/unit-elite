# ACCEPTANCE REPORT — TECH-0001-D2
## SYSTEM ACCEPTANCE UNIT ELITE FALLBACK CONTROLLER — oleh PRANATA KOMPUTER

- **TASK-ID:** TASK-20260829-092021-TECH-0001-Evaluasi-9Router
- **TECH-ID:** TECH-0001-D2
- **Tanggal:** 2026-08-29
- **Status Developer sebelum acceptance:** `PATCH_READY_FOR_ACCEPTANCE`
- **Hasil:** **FALLBACK_CONTROLLER_ACCEPTED** (A–H semua PASS) — tetap **bukan** PRODUCTION_READY, **belum** terintegrasi ke Unit Elite.

---

## Ringkasan eksekutif

Fallback controller sandbox (`integrations/9router/fallback/`) lolos seluruh acceptance
A–H terhadap gateway 9Router loopback `127.0.0.1:20128` dengan data sintetis. Logika
klasifikasi error dan pemicu fallback sesuai spesifikasi. Tidak ada modifikasi 9Router,
tidak ada combo, tidak ada integrasi runtime, tidak ada secret terekspos, dan 9Router
sehat loopback-only pada akhir pengujian.

---

## Lingkungan pengujian (terverifikasi)

| Item | Nilai |
|---|---|
| Node | v24.20.0 (`C:\Program Files\nodejs\node.exe`, on PATH) |
| Gateway | 9Router `http://127.0.0.1:20128/v1` (loopback-only) |
| Health baseline | `127.0.0.1:20128` LISTENING PID 27644, exposure `0.0.0.0:20128`=0, `GET /api/health` → 200 `{"ok":true}` |
| Katalog model | 52 model; `groq/openai/gpt-oss-120b` present; `gemini/gemini-3.5-flash-lite` present |
| Credential | `NINEROUTER_KEY` tersedia di env (nilai tidak pernah dibaca-dan-dicetak/disimpan) |

## UNIT_TEST — test-fallback-controller.cjs

`RESULT 16/16 passed` (exit 0), tanpa API key, memakai stub HTTP lokal. Cakupan:
klasifikasi penuh, fallback 5xx/timeout/429/connection, AUTH/INVALID/UNKNOWN no-fallback,
payload malformed zero-network, controlled failure 2-attempt, maxAttempts cap, sanitasi
reasoning, no-secret-in-logs, deep-equality payload antar attempt, validatePayload.

## ACCEPTANCE_A — PASS

Groq sehat → Groq dipakai, Gemini TIDAK dipanggil.
- Payload `payload-a.json` ("Reply with exactly: PONG", max_tokens 64), env default
  [primary, fallback], maxAttempts 2.
- `selected_model=groq/openai/gpt-oss-120b`; `attempted_models=["groq/openai/gpt-oss-120b"]`
  (gemini tidak pernah dicoba); `content="PONG"` (konten nyata, bukan empty);
  `final_status=ok`; exit 0; latency 470 ms.
- Smoke bawaan Developer juga PASS (`content_excerpt:""` pada smoke max_tokens 16 = Groq
  menghabiskan budget untuk reasoning_tokens 33; HTTP 200 content kosong BUKAN error
  eligible → tidak fallback, sesuai desain; acceptance A memakai max_tokens ≥ 32).

## ACCEPTANCE_B — PASS

Groq sengaja unavailable → Gemini mengambil alih.
- Simulasi aman: primary dipaksa model id tidak ada
  (`groq/openai/zzz-does-not-exist-tech0001d2`) → gateway HTTP 404 → diklasifikasi
  `MODEL_UNAVAILABLE` (eligible).
- `fallback_reason` tercatat:
  `MODEL_UNAVAILABLE on groq/openai/zzz-does-not-exist-tech0001d2: model unavailable signal (HTTP 404); retrying with gemini/gemini-3.5-flash-lite`
- `attempted_models=[primary-invalid, gemini/gemini-3.5-flash-lite]`;
  `selected_model=gemini/gemini-3.5-flash-lite`; `content="PONG"`; exit 0.

## ACCEPTANCE_C — PASS

Konteks tetap sama setelah fallback.
- Unit test 2: deep-equality payload primary vs fallback kecuali `model` (messages,
  tools, tool_choice, response_format, temperature, field kustom).
- Live: payload token `ZEPHYR-7741` dengan fallback dipaksa → Gemini menjawab
  `ZEPHYR-7741` (echo utuh) → messages sampai ke fallback secara utuh.

## ACCEPTANCE_D — PASS

Structured output tetap valid.
- Unit test 2: `response_format:{type:"json_object"}` dipertahankan ke fallback.
- Live: payload `payload-d.json` + fallback dipaksa → Gemini menjawab
  `{"ok": true, "word": "PONG"}`; `D_JSON_VALID=True`, `ok=true`, `word=PONG`.

## ACCEPTANCE_E — PASS

Tool calling tetap valid.
- Unit test 2: `tools`/`tool_choice` identik ke fallback.
- Live: payload `payload-e.json` (tools `get_test_status`, tool_choice auto) + fallback
  dipaksa → response fallback berisi `tool_calls` dengan `function.name=get_test_status`,
  `finish_reason=tool_calls`.

## ACCEPTANCE_F — PASS

Invalid payload TIDAK memicu fallback.
- `payload-f.json` (tanpa `messages`) → `error_class=INVALID_PAYLOAD`,
  `eligible_for_fallback=false`, `attempted_models=[]`, `latency=[]`, exit 1.
- `payload-f2.json` (`messages[0]` tanpa role) → `INVALID_PAYLOAD`, 0 attempt, exit 1.
- Unit test 5: stub server mencatat **0 request HTTP** untuk payload malformed.

## ACCEPTANCE_G — PASS

Kedua provider gagal → clean controlled failure.
- Primary & fallback keduanya model id tidak ada → keduanya HTTP 404.
- Hasil: `ok=false`, `final_status=error`, `error_class=MODEL_UNAVAILABLE`,
  `eligible_for_fallback=true`, `fallback_reason=... but max attempts (2) reached`,
  `attempted_models` berisi keduanya, `latency_per_attempt=[35,181]`,
  elapsed total 301 ms (tidak hang; exit 1). Unit test 8/9 mengonfirmasi jalur yang sama
  termasuk skenario timeout tanpa hang.

## ACCEPTANCE_H — PASS

9Router sehat setelah seluruh skenario.
- `127.0.0.1:20128` LISTENING PID 27644 (sama dengan baseline), exposure 0, API 200
  `{"ok":true}`, exit 0. Tidak ada perubahan instalasi 9Router; tidak ada combo dibuat.

## ERROR_CLASSIFICATION_VERIFICATION

- Unit test 1 (24 kasus) + tabel `--info` cocok dengan spesifikasi:
  eligible = TIMEOUT, PROVIDER_UNAVAILABLE, MODEL_UNAVAILABLE, RATE_LIMIT, HTTP_5XX,
  CONNECTION_FAILURE; fail-closed = INVALID_PAYLOAD, AUTH_FAILURE, POLICY_REJECTION,
  UNKNOWN.
- Live: `MODEL_UNAVAILABLE` (404) → fallback terjadi (B/C/D/E); attempts habis →
  controlled failure (G); `INVALID_PAYLOAD` → tanpa fallback (F).
- Catatan desain terverifikasi: HTTP 200 dengan content kosong tidak diklasifikasi error
  → tidak memicu fallback (smoke max_tokens 16).

## SECRET_NON_EXPOSURE — PASS

- Scan 15 file di `integrations/9router` terhadap nilai `NINEROUTER_KEY`:
  `KEY_VALUE_MATCHES_IN_FILES=0` (penghitungan tanpa pernah mencetak nilainya).
- Satu-satunya pola `sk-` = dummy `sk-test-secret-12345-abcdef` di test file (bukan
  credential asli; dipakai untuk uji no-leak log).
- Seluruh output CLI/smoke menampilkan metadata tanpa Authorization header/bearer/nilai
  key; `--info` hanya menampilkan `apiKeyConfigured: true`.
- Laporan ini tidak memuat nilai key atau header auth.

## SERVICE_FINAL_STATE

loopback-only: `127.0.0.1:20128` LISTENING (PID 27644), `0.0.0.0:20128` tidak ada,
API 200.

## Batasan kepatuhan

- 9Router tidak dimodifikasi; hanya dipanggil HTTP loopback (GET /v1/models, POST
  /v1/chat/completions). `/combo` tidak pernah dipanggil; tidak ada combo dibuat.
- Tidak ada perubahan source controller inti (payload uji saja yang ditambahkan di
  `acceptance/`).
- Tidak ada integrasi ke Unit Elite runtime; tidak ada dispatch eksternal.

## ISSUES_FOUND

1. **Operasional (bukan cacat controller):** model Groq `gpt-oss-120b` menghabiskan
   budget `max_tokens` untuk reasoning bila max_tokens kecil → HTTP 200 content kosong,
   tidak eligible → tidak fallback (sesuai desain). Implikasi: payload pemanggil sebaiknya
   memberi `max_tokens` cukup dan instruksi ringkas non-reasoning (≥32, mis. 64).
2. Catatan README: heuristik klasifikasi fail-closed pada format error eksotik
   (→ UNKNOWN/INVALID_PAYLOAD). Diterima sebagai perilaku yang disengaja.

## UNCERTAINTIES

- Observed live D/E bergantung pada perilaku provider (Gemini) lewat gateway; verifikasi
  kontraktual (payload dipertahankan) dibuktikan deterministik oleh unit test stub.
- Tidak ada audit hash instalasi 9Router; integritas dibuktikan secara perilaku (PID sama,
  health 200, tidak ada akses file instalasi).

## OUTPUT CONTRACT (ringkas)

| Field | Nilai |
|---|---|
| TECH_ID | TECH-0001-D2 |
| SOURCE | SYSTEM ACCEPTANCE — fallback controller sandbox `integrations/9router/fallback/` |
| SEVERITY | S0 informational (sandbox; tidak ada dampak produksi) |
| SYMPTOM | Native 9Router combo gagal acceptance sebelumnya; verifikasi fallback controller sisi Unit Elite |
| EXPECTED | A–H semua PASS; 16/16 unit; tanpa secret; 9Router loopback-only sehat di akhir |
| ACTUAL | A–H semua PASS; 16/16 PASS; 0 secret; 9Router PID 27644 health 200 exposure 0 |
| REPRODUCIBLE | Ya — unit test deterministik + skenario live sintetis |
| ROOT_CAUSE | NOT_CONFIRMED untuk kegagalan combo asli (di luar scope); acceptance controller ini tanpa cacat ditemukan |
| CLASSIFICATION | CODE (artefak sandbox teruji; tidak ada kode produksi diubah) |
| IMPACT | Terbatas pada sandbox; runtime Unit Elite, 9Router, kredensial tidak tersentuh |
| RECOMMENDED_OWNER | NO_CODE_FIX_REQUIRED (acceptance lolos); keputusan integrasi = Ketua Tim |
| RECOMMENDED_ACTION | Terima controller; integrasi hanya via persetujuan Ketua terpisah; pertimbangkan panduan `max_tokens` untuk primary Groq |
| REGRESSION_SCOPE | Tidak ada regression ditimbulkan (sandbox). Bila integrasi nanti: scope = jalur chat/completion Unit Elite + task hilir |
| ACCEPTANCE_STATUS | ACCEPTED |
| UNCERTAINTIES | Lihat bagian UNCERTAINTIES di atas |
| CONFIDENCE | High |

## STATUS_AKHIR

**FALLBACK_CONTROLLER_ACCEPTED** — acceptance A–H semua PASS. Artefak tetap
`PATCH_READY_FOR_ACCEPTANCE`→ACCEPTED untuk acceptance, **bukan** PRODUCTION_READY,
**tidak diintegrasikan** ke Unit Elite. Integrasi memerlukan persetujuan Ketua Tim
sebagai keputusan terpisah. 9Router tetap running loopback-only.