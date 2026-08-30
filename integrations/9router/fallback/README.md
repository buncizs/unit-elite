# UNIT ELITE FALLBACK CONTROLLER — TECH-0001-D2 (SANDBOXED)

**Status: `PATCH_READY_FOR_ACCEPTANCE`** — NOT production-ready. NOT integrated
into the Unit Elite runtime path. Acceptance by Pranata Komputer is required
before any integration decision.

**Sub-work:** TECH-0001-D2 · **Task:** TASK-20260829-092021-TECH-0001-Evaluasi-9Router
**Location:** `integrations/9router/fallback/`

---

## 1. Purpose

9Router is the Unit Elite provider gateway (loopback only
`http://127.0.0.1:20128`). The native 9Router **combo** (`unit-elite-free-fallback`)
failed acceptance (request timeout / no app-layer response). This sandboxed
controller implements **provider fallback on the Unit Elite side** without
modifying or reinstalling 9Router and without using any native combo:

```
PRIMARY  groq/openai/gpt-oss-120b        (direct model id)
  └─(eligible failure)─►
FALLBACK gemini/gemini-3.5-flash-lite    (direct model id)
```

- 9Router is used as the gateway: `POST http://127.0.0.1:20128/v1/chat/completions`.
- `/combo` is **never** called; no combo is created (requirement 2).
- Primary is called with its **direct model id**, not a combo (requirement 3).

## 2. Files

| File | Purpose |
|------|---------|
| `fallback-controller.cjs` | Core module: `FallbackController` class + pure classification/sanitization helpers. No external deps (global `fetch`, `node:crypto`). |
| `fallback-cli.cjs` | CLI driver: payload file/stdin → final JSON result; `--info` prints classification table without network. |
| `test-fallback-controller.cjs` | Self-contained unit tests with a local stub HTTP server — no provider call, no API key needed. |
| `smoke-live.cjs` | Optional live smoke test against `127.0.0.1:20128` with synthetic data. Skips gracefully when env key absent. |
| `README.md` | This document. |

## 3. Usage

### 3.1 As a module

```js
const { FallbackController } = require('./fallback-controller.cjs');

const controller = new FallbackController({
  // endpoint defaults to http://127.0.0.1:20128/v1
  // models default to [groq/openai/gpt-oss-120b, gemini/gemini-3.5-flash-lite]
  timeoutMs: 30000,     // PER-ATTEMPT timeout
  maxAttempts: 2,       // V1: primary + 1 fallback
  // apiKey defaults to env NINEROUTER_KEY (or NINEROUTER_API_KEY)
});

const result = await controller.complete({
  messages: [{ role: 'user', content: 'Hello' }],
  temperature: 0.2,
  tools: [/* ... */],
  tool_choice: 'auto',
  response_format: { type: 'json_object' },
});

if (result.ok) {
  // result.data = final completion (content / structured output / tool_calls),
  // reasoning fields stripped, no secrets.
} else {
  // result.error_class, result.fallback_reason, result.eligible_for_fallback
}
```

### 3.2 CLI

```bat
REM Windows (PowerShell 5.1; node is on PATH)
set NINEROUTER_KEY=...
node integrations\9router\fallback\fallback-cli.cjs payload.json
node integrations\9router\fallback\fallback-cli.cjs --info
```

`--info` prints the classification table + resolved config without any network
call and without displaying the key value.

### 3.3 Environment (runtime options only)

| Variable | Meaning | Default |
|---|---|---|
| `NINEROUTER_KEY` | 9Router gateway API key (primary env var) | — |
| `NINEROUTER_API_KEY` | API key alias (secondary) | — |
| `NINEROUTER_BASE_URL` | Gateway base URL | `http://127.0.0.1:20128/v1` |
| `NINEROUTER_MODELS` | Comma-separated ordered model list (overrides below) | — |
| `NINEROUTER_MODEL_PRIMARY` | Primary model id | `groq/openai/gpt-oss-120b` |
| `NINEROUTER_MODEL_FALLBACK` | Fallback model id | `gemini/gemini-3.5-flash-lite` |
| `NINEROUTER_TIMEOUT_MS` | Per-attempt timeout | `30000` |
| `NINEROUTER_MAX_ATTEMPTS` | Max provider attempts | `2` |

The API key is **only** read from env at runtime. It is never written to
source, task files, logs, or reports (requirement 12).

## 4. Behaviour

### 4.1 Attempt flow

1. Validate payload structurally. Malformed request → `INVALID_PAYLOAD`, no
   network call, **no fallback**.
2. Send the **exact same payload** (only `model` replaced) to the primary via
   `POST {endpoint}/chat/completions` with `Authorization: Bearer <env key>`
   and a **per-attempt AbortController timeout**.
3. Classify the outcome.
4. Eligible failure + attempts remain → retry the **same payload** with the
   next model.
5. Success → return sanitized final completion + metadata.
6. Ineligible failure OR attempts exhausted → controlled failure with
   `error_class` + `fallback_reason` + `final_status`.

### 4.2 Preservation guarantees (requirements 8 & 9)

- The same `messages` array and every other field (`tools`, `tool_choice`,
  `response_format`, `temperature`, `max_tokens`, custom fields …) are sent to
  every attempt. Only `model` changes (`buildAttemptPayload`).
- Verified by unit test: deep-equality of primary vs fallback payload except
  `model`.

### 4.3 Reasoning isolation (requirement 10)

Only the final completion result (content / structured output / tool_calls) is
returned. Known provider-internal reasoning keys (`reasoning`,
`reasoning_content`, `thought`, `thinking`, `analysis`, …) are stripped from
the response before returning (`sanitizeCompletion`). No chain-of-thought is
translated or surfaced.

### 4.4 Per-request logging (requirement 11) — no secrets

One JSON line per request, emitted via the logger (default stdout):

```json
{
  "event": "fallback_controller.request",
  "ts": "2026-08-29T00:00:00.000Z",
  "request_id": "uefc-...",
  "primary_model": "groq/openai/gpt-oss-120b",
  "attempted_models": ["groq/openai/gpt-oss-120b", "gemini/gemini-3.5-flash-lite"],
  "error_class": null,
  "fallback_reason": null,
  "selected_model": "gemini/gemini-3.5-flash-lite",
  "latency_per_attempt": [1234, 987],
  "final_status": "ok"
}
```

Never logged: API key, Authorization header, bearer prefix, message content,
tools/schema content.

## 5. Error classification and fallback eligibility

| error_class | Trigger | Eligible fallback |
|---|---|---|
| `TIMEOUT` | Per-attempt timeout / `ETIMEDOUT` / `ABORT_ERR` / HTTP 408 | ✅ YES |
| `PROVIDER_UNAVAILABLE` | Gateway/provider offline, `no available provider`, provider down signal | ✅ YES |
| `MODEL_UNAVAILABLE` | HTTP 404; `model not found` / `unknown model` / `does not exist` on 400/422 | ✅ YES |
| `RATE_LIMIT` | HTTP 429 (rate limit / quota) | ✅ YES |
| `HTTP_5XX` | HTTP 500–599 | ✅ YES |
| `CONNECTION_FAILURE` | `ECONNREFUSED`, `ECONNRESET`, `ENOTFOUND`, `EHOSTUNREACH`, socket errors | ✅ YES |
| `INVALID_PAYLOAD` | Malformed request payload (local) / HTTP 400/422 generic | ❌ NO |
| `AUTH_FAILURE` | HTTP 401 (missing/invalid API key on local gateway) | ❌ NO |
| `POLICY_REJECTION` | HTTP 403; safety/policy/moderation/content-filter messages | ❌ NO |
| `UNKNOWN` | Any unclassified status/transport error | ❌ NO |

Rules that matter:

- Fallback is **only** attempted for the six eligible classes (requirement 5).
- No fallback for malformed payload, local auth failures, or policy/safety
  rejections (requirement 6).
- Maximum **2 provider attempts** on V1 (requirement 7).

## 6. Self-tests

### 6.1 Syntax

```bat
node --check fallback-controller.cjs
node --check fallback-cli.cjs
node --check test-fallback-controller.cjs
node --check smoke-live.cjs
```

### 6.2 Unit tests (no provider needed, no API key needed)

```bat
node test-fallback-controller.cjs
```

Cases covered:

1. Full error-classification table (eligible × not-eligible).
2. Eligible 5xx → fallback occurs; payload/tools/tool_choice/response_format
   preserved exactly.
3. `AUTH_FAILURE` 401 → no fallback, single attempt.
4. `INVALID_PAYLOAD` 400 → no fallback.
5. Malformed request payload → rejected locally, **zero** network attempts.
6. Per-attempt timeout → eligible fallback (measured elapsed ≪ stub delay).
7. `RATE_LIMIT` 429 → fallback occurs.
8. Both attempts fail → controlled error, both latencies recorded.
9. `maxAttempts=2` → third model never called.
10. `UNKNOWN` (418) → no fallback.
11. API key never appears in logs (no secret leak).
12. Reasoning fields stripped, final content/tool_calls kept.
13. `buildAttemptPayload` replaces only `model`.
14. Connection-refused → eligible, both attempts exhausted correctly.
15. Log record contains exactly the required metadata fields; no payload content.
16. `validatePayload` accepts/rejects correctly.

### 6.3 Live smoke (optional; requires env key, uses synthetic data only)

```bat
node smoke-live.cjs
```

Running with `NINEROUTER_KEY` set performs a read-only `GET /v1/models` and one
synthetic chat (`"Reply with exactly the single word: PONG"`, `max_tokens: 16`)
through the normal fallback flow. The key value is **not** displayed. If the
env key is absent, it prints `SKIPPED` and exits 0 — never forced.

## 7. Known limitations

- Classification uses OpenAI-compatible error shapes and common gateway
  message heuristics. Exotic gateway error formats may map to `UNKNOWN`
  (fail-closed: no fallback).
- `PROVIDER_UNAVAILABLE` detection relies on transport errors without HTTP
  status or on provider-down message heuristics; a gateway that returns a
  generic 400 for a down provider will be classified `INVALID_PAYLOAD`
  (fail-closed, no fallback).
- Timeout covers the whole exchange (headers + body). Very large streaming
  responses are not supported (controller is non-streaming by design for V1).
- `redirect: 'error'` means the controller fails closed if a gateway ever
  redirects (intentional: loopback-only gateway should never redirect).
- Sanitization strips known reasoning-key names; exotic names could slip
  through, and some models expose reasoning only via provider-specific fields
  not enumerated here.
- The controller is a sandboxed artifact: it is **not** wired into OpenCode
  config, Unit Elite agents, or the WhatsApp/communication pipeline.

## 8. Acceptance guide (for Pranata Komputer)

1. Confirm no `9Router` modifications: the sandbox only performs HTTP calls to
   `127.0.0.1:20128`; no files under the 9Router install are touched; no
   `/combo` endpoint or combo object is used.
2. Run `node --check` on all four JS files (syntax gate).
3. Run `node test-fallback-controller.cjs` — must be 16/16 PASS without any env.
4. Optional: set `NINEROUTER_KEY` and run `node smoke-live.cjs` against the live
   loopback gateway with synthetic data.
5. Verify no API key string is present in `integrations/9router/fallback/`
   (grep for `sk-`, `Authorization`, env names in source are references only).
6. Approval to integrate must be a separate decision; this artifact remains
   `PATCH_READY_FOR_ACCEPTANCE` until then.

## 9. Rollback

No existing file is modified and nothing is integrated: rollback = delete or
ignore `integrations/9router/fallback/`. The 9Router installation, OpenCode
config, Unit Elite runtime, and task data are untouched.

---

*Sandboxed work artifact — Unit Elite Developer (TECH-0001-D2). Not an
authorization to modify 9Router, integrate into Unit Elite, or dispatch
anything externally.*