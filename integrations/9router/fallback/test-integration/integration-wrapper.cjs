#!/usr/bin/env node
'use strict';
/**
 * integration-wrapper.cjs
 * ============================================================================
 * TECH-0001-D3 — UNIT ELITE TEST MODEL ROUTE WRAPPER (sandbox/CLONE only)
 * ============================================================================
 *
 * Purpose
 * -------
 * A TEST-ONLY entry point that represents the target architecture
 *
 *     OpenCode/Unit Elite Test → Fallback Controller → 9Router gateway
 *
 * for ACCEPTANCE scenarios. It calls the already-accepted
 * `fallback-controller.cjs` `FallbackController.complete()` exactly as a model
 * route would, WITHOUT wiring anything into the Unit Elite runtime, OpenCode
 * config, or the global model routing. It is intentionally a STANDALONE module
 * + CLI that only the acceptance harness and integration tests invoke.
 *
 * Constraint compliance (from the D3 work package):
 *   - TEST/CLONE only. Never referenced by OpenCode config or Unit Elite agents.
 *   - Never modifies 9Router; only HTTP to 127.0.0.1:20128/v1.
 *   - Never uses /combo; no combo objects (delegates to controller, which never
 *     calls /combo).
 *   - API key ONLY from env (NINEROUTER_KEY / NINEROUTER_API_KEY); never
 *     hardcoded, never logged, never printed.
 *   - No secret in logs; no Authorization header logged.
 *   - Human approval gateway unchanged (this wrapper performs NO enforcement
 *     bypass and NO external dispatch).
 *   - Does NOT extend any agent permission globally (no change to permissions).
 *
 * API
 * ---
 *   const { route } = require('./integration-wrapper.cjs');
 *   const result = await route(payload, { endpoint, models, maxAttempts, timeoutMs });
 *
 *   `route` returns exactly the controller result object (ok, final_status,
 *   selected_model, attempted_models, error_class, fallback_reason, data,...).
 *   It NEVER throws for provider errors and NEVER prints secrets.
 *
 * CLI (used by the acceptance harness)
 * ---
 *   node integration-wrapper.cjs scenarios/d3-01.json
 *   node integration-wrapper.cjs --info           (print resolved config, no network)
 *   node integration-wrapper.cjs --help
 *
 * Env (runtime options only)
 *   NINEROUTER_KEY / NINEROUTER_API_KEY  API key (never shown)
 *   NINEROUTER_BASE_URL                  gateway base URL (default http://127.0.0.1:20128/v1)
 *   NINEROUTER_MODELS / _PRIMARY / _FALLBACK
 *   NINEROUTER_TIMEOUT_MS                per-attempt timeout (default 30000)
 *   NINEROUTER_MAX_ATTEMPTS              max provider attempts (default 2)
 * ============================================================================
 */

const fs = require('node:fs');
const { FallbackController, DEFAULT_MODELS } = require('../fallback-controller.cjs');

/**
 * Build a FallbackController for the TEST route. Options override env/defaults.
 * The exact same construction path a production route would use.
 */
function buildController(options = {}) {
  return new FallbackController({
    endpoint: options.endpoint,
    models: options.models,
    timeoutMs: options.timeoutMs,
    maxAttempts: options.maxAttempts,
    apiKey: options.apiKey, // defaults to env inside controller; we never read it here
    logger: options.logger,
  });
}

/**
 * route(payload, options?) -> Promise<result>
 * A thin "model route" contract: OpenAI-compatible payload in, controller result
 * out. Used by acceptance scenarios and integration tests. Does not mutate the
 * payload. Never throws for provider errors.
 */
async function route(payload, options = {}) {
  const controller = buildController(options);
  // A per-call maxAttempts override is honored the same way the CLI does.
  const maxAttempts =
    options.maxAttempts !== undefined
      ? options.maxAttempts
      : Number(process.env.NINEROUTER_MAX_ATTEMPTS) || controller.maxAttempts;
  return controller.complete(payload, { maxAttempts });
}

/**
 * Print resolved config for the TEST route WITHOUT displaying the key value.
 */
function printInfo() {
  const c = buildController();
  console.log(JSON.stringify({
    msg: 'test-integration-wrapper info (no network, no secrets)',
    scope: 'TEST/CLONE only — NOT wired into Unit Elite production runtime',
    target_arch: 'OpenCode/Unit Elite Test -> Fallback Controller -> 9Router gateway',
    endpoint: c.endpoint,
    models: c.models,
    maxAttempts: c.maxAttempts,
    timeoutMs: c.timeoutMs,
    apiKeyConfigured: Boolean(c.apiKey),
    apiKeySource: '(env only, value never shown)',
    combo_used: false,
    production_wired: false,
  }, null, 2));
}

function printHelp() {
  console.log('Unit Elite test-integration wrapper (TECH-0001-D3, sandbox/CLONE only)');
  console.log('');
  console.log('Usage:');
  console.log('  node integration-wrapper.cjs payload.json');
  console.log('  node integration-wrapper.cjs -            (read payload JSON from stdin)');
  console.log('  node integration-wrapper.cjs --info       (print resolved config, no network)');
  console.log('  node integration-wrapper.cjs --help');
  console.log('');
  console.log('Env: NINEROUTER_KEY, NINEROUTER_API_KEY, NINEROUTER_BASE_URL,');
  console.log('     NINEROUTER_MODELS, NINEROUTER_MODEL_PRIMARY, NINEROUTER_MODEL_FALLBACK,');
  console.log('     NINEROUTER_TIMEOUT_MS, NINEROUTER_MAX_ATTEMPTS');
  console.log('');
  console.log('This wrapper is a TEST artifact only. It is NOT referenced by any');
  console.log('OpenCode config, Unit Elite agent, or production routing file.');
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    printHelp();
    process.exit(0);
  }
  if (args.includes('--info')) {
    printInfo();
    process.exit(0);
  }

  const source = args[0];
  let raw;
  try {
    if (source === '-') {
      raw = fs.readFileSync(0, 'utf8');
    } else {
      raw = fs.readFileSync(source, 'utf8');
    }
  } catch (err) {
    console.error('[integration-wrapper] cannot read payload: ' + err.message);
    process.exit(2);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    console.error('[integration-wrapper] payload is not valid JSON: ' + err.message);
    process.exit(2);
  }

  route(payload)
    .then((result) => {
      // Print ONLY the safe metadata summary plus result flags. `data` (the
      // completion content) is printed as an excerpt only when ok. Never print
      // the payload/attempt bodies or the API key.
      const out = {
        request_id: result.request_id,
        final_status: result.final_status,
        ok: result.ok,
        selected_model: result.selected_model,
        attempted_models: result.attempted_models,
        latency_per_attempt: result.latency_per_attempt,
        error_class: result.error_class || null,
        eligible_for_fallback: result.eligible_for_fallback || null,
      };
      if (result.ok) {
        out.content_excerpt = excerpt(result.data);
      } else {
        out.fallback_reason = result.fallback_reason || null;
        out.detail = result.detail || null;
      }
      console.log(JSON.stringify(out, null, 2));
      process.exit(result.ok ? 0 : 1);
    })
    .catch((err) => {
      console.error('[integration-wrapper] unexpected error: ' + (err && err.message ? err.message : String(err)));
      process.exit(3);
    });
}

function excerpt(data) {
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

module.exports = { route, buildController, DEFAULT_MODELS };

// Only run CLI entry when invoked directly (not when required by tests).
if (require.main === module) {
  main();
}
