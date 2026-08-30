# UNIT ELITE TEST-INTEGRATION — TECH-0001-D3 (sandbox/CLONE only)

**Status: `PATCH_READY_FOR_ACCEPTANCE`** — NOT production-ready. NOT wired into the
Unit Elite runtime, OpenCode config, or agent routing. Acceptance by Pranata
Komputer is required before any integration decision.

**Sub-work:** TECH-0001-D3 · **Task:** TASK-20260829-092021-TECH-0001-Evaluasi-9Router
**Location:** `integrations/9router/fallback/test-integration/`

---

## 1. What this is

D2 delivered and accepted a sandboxed **Fallback Controller**
(`integrations/9router/fallback/fallback-controller.cjs`) that performs
provider-level fallback on the Unit Elite side. D3 **integrates that controller
into a TEST/CLONE "model route" path** so acceptance can be exercised without
touching the production workflow.

Target architecture (TEST):

```
OpenCode/Unit Elite Test → Fallback Controller → 9Router @ http://127.0.0.1:20128/v1
                                                                │ PRIMARY  groq/openai/gpt-oss-120b
                                                                └ FALLBACK gemini/gemini-3.5-flash-lite
```

The wrapper `integration-wrapper.cjs` is the "model route" entry for the TEST
scenarios. It is **standalone**: it is never referenced by any OpenCode config,
Unit Elite agent, or production routing file, so it cannot alter Unit Elite task
routing or delegation.

## 2. Files in this folder

| File | Purpose |
|------|---------|
| `integration-wrapper.cjs` | TEST "model route" wrapper: calls `FallbackController.complete()`; module API `route()` + CLI. Standalone, no production wiring. |
| `test-integration-controller.cjs` | Deterministic contract self-test (local stub HTTP, no live gateway, no API key). Covers D3-01..D3-08. |
| `acceptance-harness.cjs` | Live acceptance harness against `127.0.0.1:20128`, synthetic data only, skips if no key. Registers D3-01..D3-08; strips `_`-metadata from scenario payloads; adds offline `--verify-payload` mode. |
| `scenarios/d3-01..d3-07.json` | Synthetic payloads for the acceptance scenarios. Human-readable `_label`/`_expect` metadata is stripped by the harness before transmission (see §5b). |
| `README-D3.md` | This guide. |
| `D3-ACCEPTANCE-TEMPLATE.md` | Template output report for the 9-item acceptance (D3-01..D3-09/D3-10). |
| `undistributed/` | Reserve folder for any future non-routed output (currently empty). |

## 3. Env (runtime options only — the key is NEVER stored/printed)

| Variable | Meaning | Default |
|---|---|---|
| `NINEROUTER_KEY` | 9Router gateway API key (primary) | — |
| `NINEROUTER_API_KEY` | API key alias (secondary) | — |
| `NINEROUTER_BASE_URL` | Gateway base URL | `http://127.0.0.1:20128/v1` |
| `NINEROUTER_MODELS` / `_PRIMARY` / `_FALLBACK` | ordered model list | groq→gemini |
| `NINEROUTER_TIMEOUT_MS` | per-attempt timeout (controller) | `30000` |
| `NINEROUTER_MAX_ATTEMPTS` | max provider attempts | `2` |
| `FALLBACK_ACCEPTANCE_TIMEOUT_MS` | **acceptance harness only** — per-attempt timeout used by the live harness (raised for slow providers, e.g. Gemini tool calling) | `40000` |

The API key value is read from env at runtime by the controller and is never
written to source, logs, or reports. This harness and wrapper never print it.

## 4. Running the self-tests (Developer)

### 4.1 Syntax gate

```bat
node --check integration-wrapper.cjs
node --check test-integration-controller.cjs
node --check acceptance-harness.cjs
```

### 4.2 Original D2 unit tests (must stay 16/16 PASS — integration must not break it)

```bat
node test-fallback-controller.cjs      (run from integrations\9router\fallback\)
```

### 4.3 D3 deterministic integration self-test (no key, no live gateway)

```bat
node test-integration-controller.cjs   (run from this folder)
```

This uses a local stub HTTP server and validates the D3-01..D3-08 contract
through the same `route()` entry the live harness uses.

### 4.4 Payload-cleanliness proof (no secret, no gateway)

A developer-only, offline check that each scenario parses as valid JSON **and**
that the payload actually forwarded to the FallbackController carries NO
`_label`/`_expect` (or any `_`-prefixed) metadata. Runs without the API key and
without touching the gateway:

```bat
node acceptance-harness.cjs --verify-payload d3-03
node acceptance-harness.cjs --verify-payload d3-06
```

It prints the final clean payload (synthetic content only — no secrets) and its
key list. See "Fix notes" below.

## 5. Running the live acceptance (for Pranata Komputer)

Set `NINEROUTER_KEY` in the environment (do not paste the value anywhere), then:

```bat
REM from integrations\9router\fallback\test-integration\
node acceptance-harness.cjs            REM all D3-01..D3-08
node acceptance-harness.cjs d3-01      REM a single scenario by id
node acceptance-harness.cjs --health   REM router health check only
```

If the key is absent the harness prints `SKIPPED` and exits 0 — never forced.

### Scenario → running command quick reference

| Scenario | What it verifies | Run |
|---|---|---|
| D3-01 | Normal route: primary groq healthy, no fallback | `node acceptance-harness.cjs d3-01` |
| D3-02 | Provider fallback (primary forced unavailable → gemini) | `node acceptance-harness.cjs d3-02` |
| D3-03 | Context preservation multi-turn (token survives fallback) | `node acceptance-harness.cjs d3-03` |
| D3-04 | Structured output (`json_object`) through fallback | `node acceptance-harness.cjs d3-04` |
| D3-05 | Tool calling through fallback | `node acceptance-harness.cjs d3-05` |
| D3-06 | Non-fallback error: malformed payload → INVALID_PAYLOAD | `node acceptance-harness.cjs d3-06` |
| D3-07 | Double failure (both unavailable → max 2 attempts) | `node acceptance-harness.cjs d3-07` |
| D3-08 | Router health (gateway reachable, both ids present) | `node acceptance-harness.cjs d3-08` (or `--health`) |

### Important expected behaviour (from D2 observation)

The Groq reasoning model `gpt-oss-120b` can return **HTTP 200 with empty content**
when `max_tokens` is small (it spends the budget on reasoning tokens). This is
**NOT an eligible error** (V1), so the controller **does not fall back** — by
design. Real-content scenarios therefore use `max_tokens >= 64` and a short,
non-reasoning instruction. If D3-01 returns empty-content HTTP 200 on the
primary, that is a **WARNING** (expected), not a FAIL. This is documented in the
harness output and in the D3-ACCEPTANCE-TEMPLATE.md.

## 5b. Fix notes (developer — scaffolding only, controller untouched)

### 5b.1 Scenario payload contamination (acceptance finding 1)

**Observation:** the scenario files (`d3-01..d3-07.json`) store human-readable
metadata `_label` / `_expect` in the SAME JSON object as the OpenAI payload. The
harness previously forwarded the whole object to the FallbackController, and the
gateway (Groq) rejected it with `HTTP 400 property '_expect' is unsupported`,
misclassifying a healthy request as `INVALID_PAYLOAD` (so it never fell back)
even though the controller was correct.

**Fix:** `acceptance-harness.cjs` now strips every `_`-prefixed key
(`stripScenarioMetadata`) inside `loadPayload()`, so the object actually passed to
`route()` / `FallbackController.complete()` / the gateway contains **only** valid
OpenAI-compatible fields (`messages`, `temperature`, `max_tokens`, `tools`,
`tool_choice`, `response_format`, ...). `max_tokens` remains `>= 64` with
non-reasoning instructions for real-content scenarios, so the D2 empty-content
quirk is still avoided. The controller core (`fallback-controller.cjs`) was NOT
modified.

**Proof (no secret, no gateway):**
```bat
node acceptance-harness.cjs --verify-payload d3-03
```
prints the exact clean payload and its key list.

### 5b.2 d3-08 not registered (acceptance finding 2)

**Observation:** `SCENARIO_OPTIONS` in the harness only listed `d3-01..d3-07`, so
`acceptance-harness.cjs d3-08` printed `SKIP unknown scenario d3-08`.

**Fix:** `d3-08` (router health) is registered in `SCENARIO_OPTIONS`, and
`runScenario(id)` now short-circuits `d3-08` to run `checkHealth()` directly
**before** any `loadPayload(id)` — there is no `scenarios/d3-08.json` file, so the
health scenario must not attempt to load a payload (that would throw ENOENT).
`d3-01..d3-07` still load their payload (metadata-stripped) and exercise the real
fallback logic. `--health` remains available as an alias for the health check.

```bat
node acceptance-harness.cjs d3-08   REM registered; checks /v1/models health
node acceptance-harness.cjs --health
```

Verify scope: the developer verifies deterministically (`--verify-payload`, unit,
integration). The **live** D3-01..D3-07 run is performed by Pranata Komputer at
acceptance and is not run here.

### 5b.3 Fallback scenario not forwarding models (acceptance finding 3)

**Observation:** `runScenario()` contained a **typo / self-assignment**:

```js
if (opt.models) opts.models = opts.models;   // WRONG — no-op
```

The per-scenario model list from `SCENARIO_OPTIONS[id].models` (which forces an
INVALID primary → real fallback to gemini for D3-02/03/05/07) was never copied
into the `opts` object passed to `route()`. The controller therefore fell back to
its DefaultModels (healthy groq → gemini); the forced-fallback scenarios instead
routed to the real groq model, so the live harness never exercised a genuine
fallback and D3-04/05 could pass spuriously (they did not actually go through the
fallback path).

**Fix:** the line is now the correct assignment `opts.models = opt.models;`
(source `opt.models`, target `opts.models`). A reproducibility scan of the whole
`fallback/` tree confirmed this was the **only** self-assignment; all other
`x = y.z;` lines are normal assignments to distinct variables.

### 5b.4 Configurable live-acceptance timeout (no controller change)

**Observation (acceptance finding 4):** D3-05 (tool calling via the Gemini
fallback) can occasionally exceed the harness's fixed 40000 ms per-attempt
timeout (transient latency, e.g. ~40006 ms vs the 40000 ms limit), which would
abort the attempt with an eligible `TIMEOUT` and cause the scenario to fail even
though the controller logic is correct.

**Fix (harness only, controller untouched):** the harness now reads
`FALLBACK_ACCEPTANCE_TIMEOUT_MS` (default `40000`) for its per-attempt timeout.
An operator performing **live acceptance** may raise it (or retry) when Gemini
tool calling is slow, e.g.:

```bat
REM Windows PowerShell
$env:FALLBACK_ACCEPTANCE_TIMEOUT_MS = "120000"
node acceptance-harness.cjs d3-05
```

No default behaviour changes: with the variable unset the harness uses the same
40000 ms as before. The controller's own timeout logic (`NINEROUTER_TIMEOUT_MS`,
default 30000) is **not** modified; this option only adjusts the harness's live
acceptance window so a slow-but-correct Gemini tool-calling response is not
aborted by the acceptance runner.

## 6. Acceptance items D3-01..D3-10

- **D3-01..D3-08** are exercised by the live harness above (and deterministically
  by the self-test).
- **D3-09** (openCode basic session) and **D3-10** (agent delegation) are
  **openCode basic-session / agent-delegation checks** that run at ACCEPTANCE time
  (Pranata/Ketua), **not** code in this folder. This folder only guarantees that
  the TEST wrapper does **not** alter Unit Elite routing/delegation.

### Non-destructive verification of D3-09/D3-10 (guidance)

Because the wrapper is standalone and never referenced by OpenCode config or
Unit Elite agents, it cannot affect task routing or delegation. To verify
non-destructively at acceptance:

1. **D3-09 (openCode basic session):** Start an ordinary openCode session,
   confirm the default model routing is unchanged and the fallback controller is
   NOT listed as a model. Confirm no new dependency was added to
   `opencode.json` / `~/.config/opencode/`. Structural proof: `grep` the
   production config and confirm it contains no reference to
   `fallback-controller.cjs` or `test-integration`.
2. **D3-10 (agent delegation):** In an openCode session delegate a task to an
   agent and confirm routing/delegation works exactly as before (the TEST wrapper
   is not imported). Structural proof: no Unit Elite agent file or `system/`
   runtime file requires or references the wrapper.
3. Optionally, run the wrapper CLI directly (`node integration-wrapper.cjs --info`)
   to show it is a sandbox artifact with `production_wired:false` and
   `combo_used:false`, and confirm it is NOT part of the running agents.

These checks require no modification and no dispatch. All evidence is collected
by Pranata during acceptance.

## 7. Boundary compliance summary (D3)

1. TEST/CLONE only — all artifacts live under `test-integration/`, clearly marked.
2. Production Unit Elite untouched — wrapper is standalone; never referenced by
   config/agents/runtime.
3. No native 9Router combo — no `/combo` call, no combo object (delegated to
   controller which never calls it).
4. 9Router source untouched — only HTTP loopback calls.
5. API key only via env (`NINEROUTER_KEY`); never hardcoded, never logged.
6. No API key / Authorization logged anywhere in this folder or its output.
7. Human approval gateway unchanged — the wrapper does no external dispatch and
   no approval bypass.
8. No global agent permission expansion — nothing in `permissions`, `opencode.json`,
   or agent config is modified; this folder is pure test scaffolding.

## 8. Rollback

No production file is modified and nothing is integrated. Rollback = delete or
ignore `integrations/9router/fallback/test-integration/`. The 9Router install,
OpenCode config, Unit Elite runtime, and task data remain untouched.

---

*Sandboxed work artifact — Unit Elite Developer (TECH-0001-D3). Not an
authorization to modify 9Router, integrate into Unit Elite, or dispatch anything
externally.*
