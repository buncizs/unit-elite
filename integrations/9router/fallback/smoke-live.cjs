#!/usr/bin/env node
'use strict';
/**
 * smoke-live.js
 * ============================================================================
 * Optional LIVE smoke test for the Unit Elite fallback controller
 * (TECH-0001-D2) against the real 9Router gateway at 127.0.0.1:20128.
 *
 * Safety rules:
 *  - Uses ONLY synthetic data (no Unit Elite production data).
 *  - Uses ONLY the loopback 9Router gateway (never modified).
 *  - Reads the API key from env (NINEROUTER_KEY / NINEROUTER_API_KEY); the key
 *    value is NEVER printed.
 *  - Skips (exit 0, SKIPPED) if the env key is unavailable — never forced.
 *
 * Run:  node smoke-live.js
 * Exit: 0 = live smoke PASS (or SKIPPED), 1 = FAIL, 2 = environment problem.
 * ============================================================================
 */

const {
  FallbackController,
  DEFAULT_MODELS,
  readApiKeyFromEnv,
} = require('./fallback-controller.cjs');

const GATEWAY = 'http://127.0.0.1:20128/v1';
const PRIMARY = process.env.NINEROUTER_MODEL_PRIMARY || DEFAULT_MODELS[0];
const FALLBACK = process.env.NINEROUTER_MODEL_FALLBACK || DEFAULT_MODELS[1];
const SYNTHETIC_PAYLOAD = {
  messages: [
    { role: 'user', content: 'Reply with exactly the single word: PONG' },
  ],
  temperature: 0,
  max_tokens: 16,
};

async function main() {
  const apiKey = readApiKeyFromEnv();
  if (!apiKey) {
    console.log('SKIPPED  NINEROUTER_KEY/NINEROUTER_API_KEY not set; live smoke not run (optional).');
    console.log('         Classification/fallback logic is covered by test-fallback-controller.js (no key needed).');
    process.exit(0);
  }

  console.log('LIVE SMOKE (synthetic data, loopback only)');
  console.log('  gateway        : ' + GATEWAY);
  console.log('  primary_model  : ' + PRIMARY);
  console.log('  fallback_model : ' + FALLBACK);
  console.log('  apiKey         : set (value not displayed)');
  console.log('  payload        : ' + JSON.stringify(SYNTHETIC_PAYLOAD.messages));

  // 1. Catalog reachability + model presence (read-only GET /v1/models).
  try {
    const res = await fetch(GATEWAY + '/models', {
      headers: { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    if (!res.ok) {
      console.log(`FAIL    GET /v1/models -> HTTP ${res.status}`);
      process.exit(1);
    }
    const body = await res.json();
    const ids = Array.isArray(body.data) ? body.data.map((m) => m.id) : [];
    const hasPrimary = ids.includes(PRIMARY);
    const hasFallback = ids.includes(FALLBACK);
    console.log(`  catalog        : ${ids.length} models; primary=${hasPrimary ? 'present' : 'MISSING'}, fallback=${hasFallback ? 'present' : 'MISSING'}`);
    if (!hasPrimary || !hasFallback) {
      console.log('FAIL    one or both routing model ids are missing from the gateway catalog.');
      console.log('        The controller still works; acceptance should re-check gateway provider config.');
      process.exit(1);
    }
  } catch (err) {
    console.log('FAIL    GET /v1/models error: ' + (err && err.message ? err.message : String(err)));
    process.exit(1);
  }

  // 2. One fallback-driven chat completion (per-attempt timeout 40s, max 2).
  const controller = new FallbackController({
    endpoint: GATEWAY,
    models: [PRIMARY, FALLBACK],
    timeoutMs: 40000,
    maxAttempts: 2,
  });

  const result = await controller.complete(SYNTHETIC_PAYLOAD);
  const excerpt = result.ok
    ? extractExcerpt(result.data)
    : null;

  console.log('--- metadata (no secrets) ---');
  console.log(JSON.stringify({
    request_id: result.request_id,
    final_status: result.final_status,
    selected_model: result.selected_model,
    attempted_models: result.attempted_models,
    latency_per_attempt: result.latency_per_attempt,
    error_class: result.error_class || null,
    fallback_reason: result.fallback_reason || null,
  }, null, 2));

  if (result.ok) {
    console.log('  content_excerpt : ' + JSON.stringify(excerpt));
    console.log('PASS    live smoke: primary or fallback returned a final completion.');
    process.exit(0);
  }

  console.log('FAIL    live smoke: no completion from primary or fallback.');
  console.log('        error_class=' + result.error_class + ' reason=' + result.fallback_reason);
  process.exit(1);
}

function extractExcerpt(data) {
  try {
    if (data && typeof data === 'object' && Array.isArray(data.choices)) {
      const msg = data.choices[0] && data.choices[0].message;
      if (msg && typeof msg.content === 'string') {
        return String(msg.content).slice(0, 120);
      }
      if (msg && Array.isArray(msg.tool_calls)) {
        return JSON.stringify(msg.tool_calls).slice(0, 200);
      }
      return JSON.stringify(data).slice(0, 200);
    }
    return String(data).slice(0, 200);
  } catch {
    return '(unparseable response)';
  }
}

main().catch((err) => {
  console.log('FAIL    unexpected smoke error: ' + (err && err.message ? err.message : String(err)));
  process.exit(3);
});