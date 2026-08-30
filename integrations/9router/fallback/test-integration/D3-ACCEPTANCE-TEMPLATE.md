# ACCEPTANCE TEMPLATE — TECH-0001-D3 (TEST-INTEGRATION, sandbox/CLONE only)

**Untuk:** Pranata Komputer / Ketua Tim
**TASK-ID:** TASK-20260829-092021-TECH-0001-Evaluasi-9Router
**TECH-ID:** TECH-0001-D3
**Sumber:** `integrations/9router/fallback/test-integration/`
**Tujuan:** integrasi TEST/CLONE Fallback Controller ke jalur "model route" test
**Status Developer sebelum acceptance:** `PATCH_READY_FOR_ACCEPTANCE`

> **HASIL ACCEPTANCE FINAL oleh PRANATA KOMPUTER — 2026-08-29.**
> **Kesimpulan: `FALLBACK_INTEGRATION_ACCEPTED` (jalur TEST).** D3-01..D3-08 semua
> PASS live; D3-09 & D3-10 PASS (non-destruktif). Core controller tidak diubah
> selama acceptance. Secret tidak pernah ditampilkan.

---

## Lingkungan pengujian

| Item | Nilai |
|---|---|
| Node | `v24.20.0` (`C:\Program Files\nodejs\node.exe`, on PATH) |
| Gateway | 9Router `http://127.0.0.1:20128/v1` (loopback-only) |
| Katalog | `groq/openai/gpt-oss-120b` dan `gemini/gemini-3.5-flash-lite` terverifikasi present |
| Credential | `NINEROUTER_KEY` tersedia di env (nilai tak pernah dicetak/disimpan) |
| Opsional self-check | `node integration-wrapper.cjs --info` → `production_wired:false`, `combo_used:false` |

## Unit & integration self-test (Developer — diverifikasi ulang oleh Pranata)

- `node integrations\9router\fallback\test-fallback-controller.cjs` →
  **RESULT 16/16 PASS** (controller tidak rusak oleh integrasi / setelah fix scaffold).
- `node integrations\9router\fallback\test-integration\test-integration-controller.cjs` →
  **RESULT 9/9 PASS** (deterministik, tanpa gateway/key).
- `node acceptance-harness.cjs --verify-payload d3-01..d3-08` → **semua PASS**;
  payload bersih (metadata `_label`/`_expect` ter-strip), hanya field OpenAI valid, tanpa secret.

## ACCEPTANCE D3-01 — Normal route

- Perintah: `node acceptance-harness.cjs d3-01`
- Ekspektasi: `selected_model=groq/openai/gpt-oss-120b`, `attempted_models` len `1`.
- Hasil: **PASS**
- Bukti: `selected_model=groq/openai/gpt-oss-120b`, `attempted_models=["groq/openai/gpt-oss-120b"]` (len 1), `final_status=ok`, content "PONG". Gemini tidak dipanggil. Tidak ada fallback.
- Catatan: empty-content HTTP 200 pada primary = WARNING ekspektasi, bukan FAIL (tidak terjadi pada run ini; dianggap non-blokir).

## ACCEPTANCE D3-02 — Provider fallback (reversible controlled)

- Perintah: `node acceptance-harness.cjs d3-02`
- Ekspektasi: primary dipaksa tidak ada → `selected_model=gemini/gemini-3.5-flash-lite`, `attempted_models` len `2`.
- Hasil: **PASS**
- Bukti: `selected_model=gemini/gemini-3.5-flash-lite`, `attempted_models=[groq/openai/zzz-does-not-exist-tech0001d3, gemini/gemini-3.5-flash-lite]` (len 2), `final_status=ok`, content "PONG".
- `fallback_reason`: `MODEL_UNAVAILABLE on groq/openai/zzz-does-not-exist-tech0001d3: model unavailable signal (HTTP 404); retrying with gemini/gemini-3.5-flash-lite`

## ACCEPTANCE D3-03 — Context preservation multi-turn

- Perintah: `node acceptance-harness.cjs d3-03`
- Ekspektasi: token `CLOUD-20128` utuh kembali setelah fallback.
- Hasil: **PASS**
- Bukti: fallback ke gemini; content_excerpt `"CLOUD-20128"` — token history multi-turn utuh; `attempted_models=[invalid-primary, gemini]`.

## ACCEPTANCE D3-04 — Structured output

- Perintah: `node acceptance-harness.cjs d3-04`
- Ekspektasi: `response_format:json_object` dipertahankan; hasil JSON valid `{ok:true, word:PONG}`.
- Hasil: **PASS**
- Bukti: fallback ke gemini; content `{"ok": true, "word": "PONG"}` valid.

## ACCEPTANCE D3-05 — Tool calling

- Perintah: `node acceptance-harness.cjs d3-05`
- Ekspektasi: `tools`/`tool_choice` dipertahankan; response berisi `tool_calls` → `get_test_status`, `finish_reason=tool_calls`.
- Hasil: **PASS**
- Bukti: fallback ke gemini; `tool_calls` mencakup `get_test_status`; `finish_reason=tool_calls`. (Dijalankan dengan `FALLBACK_ACCEPTANCE_TIMEOUT_MS=120000` karena sebelumnya timeout transien Gemini pada attempt tool-calling; core controller default tetap 30000ms — tidak diubah.)

## ACCEPTANCE D3-06 — Non-fallback error (malformed)

- Perintah: `node acceptance-harness.cjs d3-06`
- Ekspektasi: `error_class=INVALID_PAYLOAD`, `eligible_for_fallback=false`, `attempted_models=[]`, exit 1.
- Hasil: **PASS**
- Bukti: `error_class=INVALID_PAYLOAD`, `eligible_for_fallback=false`, `attempted_models=[]`, `latency_per_attempt=[]` — zero network, Gemini tidak dipanggil. Penalty lokal sebelum provider.

## ACCEPTANCE D3-07 — Double failure (max 2 attempts, no infinite retry)

- Perintah: `node acceptance-harness.cjs d3-07`
- Ekspektasi: `ok=false`, `error_class=MODEL_UNAVAILABLE`, `eligible_for_fallback=true`, `attempted_models` len `2`, tanpa attempt ke-3.
- Hasil: **PASS**
- Bukti: `ok=false`, `error_class=MODEL_UNAVAILABLE`, `eligible_for_fallback=true`, `attempted_models=[invalid-primary, invalid-fallback]` len 2, `fallback_reason="... max attempts (2) reached"`, tanpa attempt ke-3 (controlled failure).

## ACCEPTANCE D3-08 — Router health

- Perintah: `node acceptance-harness.cjs d3-08` (atau `--health`)
- Ekspektasi: gateway reachable, katalog berisi primary+fallback.
- Hasil: **PASS**
- Bukti: `GET /v1/models` → HTTP 200; 52 models; `primary=present`, `fallback=present`. 9Router tidak hang; listener tetap `127.0.0.1:20128`.

## ACCEPTANCE D3-09 / D3-10 — openCode basic session & agent delegation (non-destruktif)

> Dijalankan saat ACCEPTANCE oleh Pranata/Ketua; **bukan** kode dari folder ini.
> Folder `test-integration/` hanya menjamin jalur TEST tidak mengubah routing/delegasi
> Unit Elite karena wrappernya standalone dan tidak dirujuk config/agent mana pun.

**D3-09 — openCode basic session:**
1. Mulai sesi openCode biasa; pastikan routing model default TIDAK berubah dan
   fallback controller TIDAK terdaftar sebagai model.
2. Structural proof: `grep` di config produksi → tidak ada referensi ke
   `fallback-controller.cjs` / `test-integration`.
Result: **PASS**
Bukti (all non-destruktif):
- `opencode.json` proyek HANYA berisi `default_agent`/`subagent_depth`/`permission`; TIDAK ada model custom, TIDAK ada referensi ke controller/wrapper/20128.
- Global `~/.config/opencode/opencode.json` → tidak ada referensi fallback-controller/test-integration/integration-wrapper/FallbackController/20128.
- Sesi ini berjalan di jalur openCode standar; controller TIDAK terdaftar sebagai model route.
- `node integration-wrapper.cjs --info` → `production_wired:false`, `combo_used:false`, `scope:"TEST/CLONE only"`, `apiKeySource:"(env only, value never shown)"`.
- Tidak ada secret / Authorization / key di log atau output.

**D3-10 — agent delegation:**
1. Dalam sesi openCode, delegasikan task ke agent; pastikan routing/delegasi
   berjalan persis seperti sebelumnya (wrapper TEST tidak di-import).
2. Structural proof: tidak ada file agent Unit Elite atau `system/` yang
   require/mereferensikan wrapper.
Result: **PASS**
Bukti (all non-destruktif):
- **Tidak ada file agent (`.opencode/agents/*.md`) atau `system/` yang mereferensikan** fallback-controller / test-integration / integration-wrapper / FallbackController / acceptance-harness / combo.
- Kontrak routing Ketua→spesialis di `ketua-tim.md` utuh (analis-legal, analis-dokumen, analis-kebijakan, juru-korespondensi, juru-kebijakan, dst). 14 subagent terdaftar.
- Controller sandbox TIDAK di-import oleh runtime agent mana pun, sehingga routing/delegasi normal tidak terpengaruh.

## Boundary compliance (1–8)

1. TEST/CLONE only — semua artefak di `test-integration/` bertanda TEST: **PASS**
   — seluruh artefak acceptance berada di bawah `test-integration/` yang jelas ditandai sandbox/CLONE; wrapper standalone tidak dirujuk config/agent mana pun.
2. Production Unit Elite tidak disentuh (config/agents/runtime): **PASS**
   — `opencode.json` proyek & global, `.opencode/agents/`, dan `system/` tidak mengandung referensi apa pun ke controller/wrapper/test-integration/combo; routing agent utuh.
3. Tidak ada native combo (`/combo`/combo object): **PASS**
   — controller hanya memanggil `POST {endpoint}/chat/completions` satu model per attempt; `combo_used:false` dari `--info`; tidak ada panggilan `/combo`.
4. 9Router tidak dimodifikasi: **PASS**
   — hanya HTTP loopback ke `127.0.0.1:20128/v1`; source 9Router tidak disentuh; listener tetap loopback-only.
5. API key hanya via env, tidak hardcode/tidak log: **PASS**
   — `NINEROUTER_KEY` dibaca via env (konstruktor/`readApiKeyFromEnv`); tidak pernah ditulis ke source/log/report; `apiKeySource:"(env only, value never shown)"`.
6. Tidak ada API key/Authorization tercetak: **PASS**
   — seluruh output harness/wrapper/harness-live/grep tidak menampilkan nilai key atau header Authorization; log audit hanya metadata aman.
7. Human approval gateway tidak diubah: **PASS**
   — wrapper/controller tidak melakukan dispatch eksternal dan tidak melewati persetujuan manusia; `KIRIM`/approval tetap pada batas yang sama.
8. Tidak ada perluasan permission agent global: **PASS**
   — tidak ada perubahan pada `permissions`, `opencode.json`, atau config agent; tugas ini murni test scaffolding.

## Hasil akhir

- **SEMUA item D3-01..D3-10: PASS** (live harness 8/8; D3-09 & D3-10 non-destruktif).
- **LT:** UNIT_TEST 16/16 · INTEGRATION_TEST 9/9 · LIVE D3-01..08 **8/8 PASS** · D3-09 PASS · D3-10 PASS · SECRET_NON_EXPOSURE terpenuhi · ROUTER_HEALTH_FINAL sehat.
- **Status:** `FALLBACK_INTEGRATION_ACCEPTED` (jalur TEST, **conditional**: belum terintegrasi ke production) — 2026-08-29.
- **Bukan** PRODUCTION_READY; **tidak** terintegrasi ke runtime produksi. Integrasi ke production hanya setelah persetujuan Ketua Tim.
