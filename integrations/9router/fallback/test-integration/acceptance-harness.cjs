#!/usr/bin/env node
'use strict';
/**
 * acceptance-harness.cjs
 * ============================================================================
 * TECH-0001-D3 — LIVE ACCEPTANCE HARNESS for the Unit Elite TEST "model route"
 * (sandbox/CLONE only). Runs D3-01..D3-08 against the real 9Router loopback
 * gateway at 127.0.0.1:20128 using SYNTHETIC data only.
 *
 * This is the harness the PRANATA KOMPUTER / acceptance runs. It:
 *   - Uses ONLY synthetic payloads from ./scenarios/ (absolute).
 *   - Reads the API key from env (NINEROUTER_KEY / NINEROUTER_API_KEY); the key
 *     VALUE is never printed, logged, or stored by this harness.
 *   - Performs only read-only /models and /chat/completions calls to the
 *     loopback gateway. Never modifies 9Router, never uses /combo.
 *   - Skips gracefully (exit 0, SKIPPED) if the env key is absent.
 *
 * Roundtrip anomaly documented by D2 remains an EXPECTED behaviour, not a
 * failure: the Groq reasoning model can return HTTP 200 with empty content when
 * max_tokens is small. That is NOT an eligible error (V1), so the controller
 * does NOT fall back — the harness flags it as a WARNING, not a FAIL, provided
 * the selected_model was the primary. Real-content scenarios use max_tokens>=64
 * and a non-reasoning instruction to avoid it.
 *
 * Usage:
 *   node acceptance-harness.cjs            (run all D3-01..D3-08)
 *   node acceptance-harness.cjs d3-03      (run a single scenario by id)
 *   node acceptance-harness.cjs --health   (router health check only)
 * Exit codes: 0 = all PASS, 1 = FAIL, 2 = env/config problem.
 * ============================================================================
 */

const fs = require('node:fs');
const path = require('node:path');
const { route, buildController } = require('./integration-wrapper.cjs');
const { readApiKeyFromEnv } = require('../fallback-controller.cjs');

const SCEN = path.join(__dirname, 'scenarios');
const GATEWAY = process.env.NINEROUTER_BASE_URL || 'http://127.0.0.1:20128/v1';
const INVALID_PRIMARY = 'groq/openai/zzz-does-not-exist-tech0001d3';
const INVALID_FALLBACK = 'gemini/zzz-does-not-exist-tech0001d3';

// Per-scenario live options: which model list / expectations.
// D3-02 & D3-07 force the primary (and fallback for D3-07) to invalid ids so a
// REAL fallback to gemini happens deterministically without touching production.
const SCENARIO_OPTIONS = {
  'd3-01': { label: 'normal route (groq healthy, no fallback)', models: undefined, forceFallback: false, bothInvalid: false },
  'd3-02': { label: 'provider fallback (primary unavailable -> gemini)', models: [INVALID_PRIMARY, 'gemini/gemini-3.5-flash-lite'], forceFallback: true, bothInvalid: false },
  'd3-03': { label: 'context preservation multi-turn (echo token survives fallback)', models: [INVALID_PRIMARY, 'gemini/gemini-3.5-flash-lite'], forceFallback: true, bothInvalid: false },
  'd3-04': { label: 'structured output json_object (through fallback)', models: [INVALID_PRIMARY, 'gemini/gemini-3.5-flash-lite'], forceFallback: true, bothInvalid: false },
  'd3-05': { label: 'tool calling (through fallback)', models: [INVALID_PRIMARY, 'gemini/gemini-3.5-flash-lite'], forceFallback: true, bothInvalid: false },
  'd3-06': { label: 'non-fallback error (malformed payload -> INVALID_PAYLOAD)', models: undefined, forceFallback: false, bothInvalid: false },
  'd3-07': { label: 'double failure (both unavailable -> max 2 attempts, controlled error)', models: [INVALID_PRIMARY, INVALID_FALLBACK], bothInvalid: true },
  'd3-08': { label: 'router health (gateway reachable + primary/fallback present)', models: undefined, forceFallback: false, bothInvalid: false, healthOnly: true },
};

let passCount = 0;
let failCount = 0;
const warnings = [];

/**
 * Scenario files carry human-readable metadata (`_label`, `_expect`) in the SAME
 * JSON object as the OpenAI-compatible payload fields (messages, temperature,
 * max_tokens, ...) purely for readability. That metadata MUST NOT be forwarded to
 * the FallbackController/gateway, or Groq rejects the request with HTTP 400
 * `property '_expect' is unsupported` -> misclassified as INVALID_PAYLOAD (no
 * fallback) even though the controller is correct. (Acceptance finding 1.)
 *
 * loadPayload() strips every "_"-prefixed key and returns a NEW object holding
 * ONLY valid OpenAI-compatible fields. No mutation of the parsed raw object.
 */
function stripScenarioMetadata(payload) {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return payload;
  }
  const clean = {};
  for (const key of Object.keys(payload)) {
    if (!String(key).startsWith('_')) {
      clean[key] = payload[key];
    }
  }
  return clean;
}

function loadPayload(id) {
  const p = path.join(SCEN, id + '.json');
  const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  return stripScenarioMetadata(raw);
}

/**
 * Deterministic proof that a scenario parses as valid JSON AND that the payload
 * actually handed to the FallbackController contains no "_"-prefixed metadata.
 * Runs offline (no network, no API key); the scenario files contain only
 * synthetic content, so printing the clean payload leaks no secret.
 */
function verifyPayload(id) {
  const opt = SCENARIO_OPTIONS[id];
  if (!opt) {
    console.log(`SKIP    unknown scenario ${id}`);
    return false;
  }
  if (id === 'd3-08') {
    console.log(`OK      ${id}: health-only scenario has no gateway payload to inspect`);
    return true;
  }
  const payload = loadPayload(id); // metadata already stripped
  let syntacticallyValid = true;
  try {
    JSON.stringify(payload);
  } catch {
    syntacticallyValid = false;
  }
  const metaKeys = [];
  for (const key of Object.keys(payload)) {
    if (String(key).startsWith('_')) metaKeys.push(key);
  }
  if (metaKeys.length > 0 || !syntacticallyValid) {
    console.log(`FAIL    ${id}: payload must parse as valid JSON with no "_"-prefixed metadata`);
    return false;
  }
  console.log(`PASS    ${id} (${opt.label})`);
  console.log(`        final payload forwarded to FallbackController (no secrets, metadata stripped):`);
  console.log('        ' + JSON.stringify(payload));
  console.log(`        payload_keys: ${JSON.stringify(Object.keys(payload))}`);
  return true;
}

function excerpt(data) {
  try {
    if (data && typeof data === 'object' && Array.isArray(data.choices)) {
      const msg = data.choices[0] && data.choices[0].message;
      if (msg && typeof msg.content === 'string') return String(msg.content).slice(0, 120);
      if (msg && Array.isArray(msg.tool_calls)) return JSON.stringify(msg.tool_calls).slice(0, 200);
      return JSON.stringify(data).slice(0, 200);
    }
    return String(data).slice(0, 200);
  } catch {
    return '(unparseable)';
  }
}

async function checkHealth() {
  const controller = buildController({ endpoint: GATEWAY });
  try {
    const res = await fetch(controller.endpoint + '/models', {
      headers: { Authorization: 'Bearer ' + readApiKeyFromEnv(), Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    if (!res.ok) {
      console.log(`FAIL    GET /v1/models -> HTTP ${res.status}`);
      return false;
    }
    const body = await res.json();
    const ids = Array.isArray(body.data) ? body.data.map((m) => m.id) : [];
    const hasPrimary = ids.includes('groq/openai/gpt-oss-120b');
    const hasFallback = ids.includes('gemini/gemini-3.5-flash-lite');
    console.log(`  health         : ${res.status}; ${ids.length} models; primary=${hasPrimary ? 'present' : 'MISSING'}, fallback=${hasFallback ? 'present' : 'MISSING'}`);
    return hasPrimary && hasFallback;
  } catch (err) {
    console.log('FAIL    cannot reach gateway: ' + (err && err.message ? err.message : String(err)));
    return false;
  }
}

async function runScenario(id) {
  const opt = SCENARIO_OPTIONS[id];
  if (!opt) {
    console.log(`SKIP    unknown scenario ${id}`);
    return 'skip';
  }

  console.log(`\n===== ${id.toUpperCase()} — ${opt.label} =====`);

  // D3-08 (router health) is health-only: it has no scenario JSON payload file
  // (scenarios/d3-08.json does not exist) and must NOT go through loadPayload().
  // Short-circuit BEFORE any payload load so it never throws ENOENT. The health
  // check hits the gateway directly (GET /v1/models; presence of primary+fallback
  // ids) and, when a key is available, authenticates with it.
  if (id === 'd3-08') {
    const ok = await checkHealth();
    if (ok) { passCount++; console.log('PASS    ' + id + ' (router health: gateway reachable, primary+fallback present)'); }
    else { failCount++; console.log('FAIL    ' + id + ' (router health)'); }
    return;
  }

  // D3-01..D3-07 load their OpenAI-compatible payload (metadata _label/_expect
  // stripped by loadPayload) and exercise the real fallback logic.
  const payload = loadPayload(id);
  // Per-attempt timeout for live acceptance. Default 40000 ms, but an operator
  // may raise it WITHOUT changing controller logic when a provider (e.g. Gemini
  // tool calling, D3-05) is slow, via FALLBACK_ACCEPTANCE_TIMEOUT_MS.
  const ACCEPTANCE_TIMEOUT_MS =
    Number.isFinite(Number(process.env.FALLBACK_ACCEPTANCE_TIMEOUT_MS)) &&
    Number(process.env.FALLBACK_ACCEPTANCE_TIMEOUT_MS) > 0
      ? Number(process.env.FALLBACK_ACCEPTANCE_TIMEOUT_MS)
      : 40000;
  const opts = { endpoint: GATEWAY, maxAttempts: 2, timeoutMs: ACCEPTANCE_TIMEOUT_MS };
  // Forward the per-scenario model list (INVALID primary, gemini fallback, ...)
  // so fallback scenarios actually route through the fallback model instead of
  // silently using the controller default groq list.
  if (opt.models) opts.models = opt.models;

  const result = await route(payload, opts);
  const ok = result.ok;
  console.log('  metadata       : ' + JSON.stringify({
    final_status: result.final_status,
    selected_model: result.selected_model,
    attempted_models: result.attempted_models,
    latency_per_attempt: result.latency_per_attempt,
    error_class: result.error_class || null,
  }));
  if (ok && result.data) {
    console.log('  content_excerpt: ' + JSON.stringify(excerpt(result.data)));
  }
  if (!ok) {
    console.log('  fallback_reason: ' + (result.fallback_reason || '') + (result.detail ? ' | detail: ' + result.detail : ''));
  }

  // ---- Evaluate per-scenario outcome ----
  if (id === 'd3-01') {
    if (ok && result.selected_model === 'groq/openai/gpt-oss-120b' && result.attempted_models.length === 1) {
      // Empty-content HTTP200 on primary (reasoning budget) is EXPECTED, not a fail.
      if (contentEmpty(result)) {
        warnings.push('d3-01: primary returned HTTP200 content:"" (groq reasoning budget with small max_tokens). Not an eligible error; no fallback (by design).');
        passCount++; console.log('PASS    ' + id + ' (primary selected; empty-content HTTP200 noted as expected)');
      } else {
        passCount++; console.log('PASS    ' + id + ' (primary selected, no fallback)');
      }
    } else {
      failCount++; console.log('FAIL    ' + id);
    }
  } else if (id === 'd3-02') {
    if (ok && result.selected_model === 'gemini/gemini-3.5-flash-lite' && result.attempted_models.length === 2) {
      passCount++; console.log('PASS    ' + id + ' (fell back to gemini)');
    } else {
      failCount++; console.log('FAIL    ' + id);
    }
  } else if (id === 'd3-03') {
    const token = extractToken(result);
    if (ok && result.selected_model === 'gemini/gemini-3.5-flash-lite' && token && token === 'CLOUD-20128') {
      passCount++; console.log('PASS    ' + id + ' (token preserved through fallback)');
    } else {
      failCount++; console.log('FAIL    ' + id + (token ? ` (token=${JSON.stringify(token)})` : ' (no token)'));
    }
  } else if (id === 'd3-04') {
    const parsed = tryParseJson(result);
    if (ok && parsed && parsed.ok === true && parsed.word === 'PONG') {
      passCount++; console.log('PASS    ' + id + ' (structured output valid)');
    } else {
      failCount++; console.log('FAIL    ' + id);
    }
  } else if (id === 'd3-05') {
    const tc = result.ok && result.data && result.data.choices && result.data.choices[0] && result.data.choices[0].message && result.data.choices[0].message.tool_calls;
    const fr = result.ok && result.data && result.data.choices && result.data.choices[0] && result.data.choices[0].finish_reason;
    if (ok && Array.isArray(tc) && tc[0] && tc[0].function && tc[0].function.name === 'get_test_status' && fr === 'tool_calls') {
      passCount++; console.log('PASS    ' + id + ' (tool_calls present)');
    } else {
      failCount++; console.log('FAIL    ' + id);
    }
  } else if (id === 'd3-06') {
    if (!ok && result.error_class === 'INVALID_PAYLOAD' && result.eligible_for_fallback === false && result.attempted_models.length === 0) {
      passCount++; console.log('PASS    ' + id + ' (INVALID_PAYLOAD, zero attempts, no fallback)');
    } else {
      failCount++; console.log('FAIL    ' + id);
    }
  } else if (id === 'd3-07') {
    if (!ok && result.error_class === 'MODEL_UNAVAILABLE' && result.eligible_for_fallback === true && result.attempted_models.length === 2) {
      passCount++; console.log('PASS    ' + id + ' (controlled error, exactly 2 attempts, no infinite retry)');
    } else {
      failCount++; console.log('FAIL    ' + id);
    }
  }
}

function contentEmpty(result) {
  const c = result.data && result.data.choices && result.data.choices[0] && result.data.choices[0].message && result.data.choices[0].message.content;
  return c === '' || c === undefined || c === null;
}

function extractToken(result) {
  const c = result.ok && result.data && result.data.choices && result.data.choices[0] && result.data.choices[0].message && result.data.choices[0].message.content;
  if (typeof c !== 'string') return null;
  const m = String(c).match(/CLOUD-20128/);
  return m ? m[0] : String(c).trim();
}

function tryParseJson(result) {
  const c = result.ok && result.data && result.data.choices && result.data.choices[0] && result.data.choices[0].message && result.data.choices[0].message.content;
  if (typeof c !== 'string') return null;
  try {
    return JSON.parse(c);
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);

  // Offline, deterministic proof that scenario payloads are clean (no metadata
  // leaked, valid JSON). Runs WITHOUT the API key and WITHOUT the gateway, so it
  // is a repeatable developer self-test (no secret required to prove the fix).
  if (args[0] === '--verify-payload') {
    const id = args[1];
    if (!id) {
      console.error('Usage: node acceptance-harness.cjs --verify-payload <scenario-id>');
      process.exit(2);
    }
    process.exit(verifyPayload(id) ? 0 : 1);
  }

  const apiKey = readApiKeyFromEnv();
  if (!apiKey) {
    console.log('SKIPPED  NINEROUTER_KEY/NINEROUTER_API_KEY not set; live acceptance not run (optional).');
    console.log('         Deterministic contract coverage is in test-integration-controller.cjs (no key needed).');
    process.exit(0);
  }

  console.log('LIVE ACCEPTANCE HARNESS — TECH-0001-D3 (sandbox/CLONE only, synthetic data only)');
  console.log('  gateway      : ' + GATEWAY);
  console.log('  apiKey       : set (value not displayed)');
  console.log('  target_arch  : OpenCode/Unit Elite Test -> Fallback Controller -> 9Router');

  if (args[0] === '--health') {
    const ok = await checkHealth();
    process.exit(ok ? 0 : 1);
  }

  const ids = args.length > 0 ? args : Object.keys(SCENARIO_OPTIONS);
  for (const id of ids) {
    await runScenario(id);
  }

  console.log('\n===== SUMMARY =====');
  console.log(`PASS ${passCount}  FAIL ${failCount}`);
  if (warnings.length) {
    console.log('WARNINGS (expected behaviours, not failures):');
    for (const w of warnings) console.log('  - ' + w);
  }
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FAIL    harness error: ' + (err && err.message ? err.message : String(err)));
  process.exit(3);
});
