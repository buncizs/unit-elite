#!/usr/bin/env node
'use strict';
/**
 * fallback-cli.cjs
 * ============================================================================
 * Command-line driver for the Unit Elite fallback controller (TECH-0001-D2).
 *
 * Usage:
 *   node fallback-cli.cjs payload.json
 *   node fallback-cli.cjs -            (read payload JSON from stdin)
 *   node fallback-cli.cjs --info       (print classification table + config, no network)
 *   node fallback-cli.cjs --help
 *
 * Environment (runtime options only — the key is NEVER read from source and
 * NEVER printed):
 *   NINEROUTER_KEY            API key for the 9Router gateway (primary)
 *   NINEROUTER_API_KEY        API key alias (secondary)
 *   NINEROUTER_BASE_URL       gateway base URL (default http://127.0.0.1:20128/v1)
 *   NINEROUTER_MODELS         comma-separated ordered model list (overrides both below)
 *   NINEROUTER_MODEL_PRIMARY  primary model id (default groq/openai/gpt-oss-120b)
 *   NINEROUTER_MODEL_FALLBACK fallback model id (default gemini/gemini-3.5-flash-lite)
 *   NINEROUTER_TIMEOUT_MS     per-attempt timeout (default 30000)
 *   NINEROUTER_MAX_ATTEMPTS   max provider attempts (default 2)
 *
 * Output: final JSON result (one line) on stdout. Never includes the API key.
 * ============================================================================
 */

const fs = require('node:fs');
const {
  FallbackController,
  ERROR_CLASSES,
  ELIGIBLE_FOR_FALLBACK,
  DEFAULT_MODELS,
  DEFAULT_ENDPOINT,
} = require('./fallback-controller.cjs');

function printHelp() {
  console.log('Unit Elite fallback controller CLI (TECH-0001-D2, sandboxed)');
  console.log('');
  console.log('Usage:');
  console.log('  node fallback-cli.cjs payload.json');
  console.log('  node fallback-cli.cjs -            (read payload JSON from stdin)');
  console.log('  node fallback-cli.cjs --info       (no network; prints config)');
  console.log('  node fallback-cli.cjs --help');
  console.log('');
  console.log('Env: NINEROUTER_KEY, NINEROUTER_API_KEY, NINEROUTER_BASE_URL,');
  console.log('     NINEROUTER_MODELS, NINEROUTER_MODEL_PRIMARY,');
  console.log('     NINEROUTER_MODEL_FALLBACK, NINEROUTER_TIMEOUT_MS,');
  console.log('     NINEROUTER_MAX_ATTEMPTS');
}

function printInfo() {
  const c = new FallbackController();
  console.log(JSON.stringify({
    msg: 'fallback-controller info (no network)',
    endpoint: c.endpoint,
    models: c.models,
    maxAttempts: c.maxAttempts,
    timeoutMs: c.timeoutMs,
    apiKeyConfigured: Boolean(c.apiKey),
    apiKeySource: '(env only, value not shown)',
    classification: ERROR_CLASSES.map((cls) => ({
      error_class: cls,
      eligible_for_fallback: ELIGIBLE_FOR_FALLBACK[cls] === true,
    })),
  }, null, 2));
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
    console.error('[fallback-cli] cannot read payload: ' + err.message);
    process.exit(2);
  }

  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (err) {
    console.error('[fallback-cli] payload is not valid JSON: ' + err.message);
    process.exit(2);
  }

  const timeoutMs = Number(process.env.NINEROUTER_TIMEOUT_MS) || 30000;
  const maxAttempts = Number(process.env.NINEROUTER_MAX_ATTEMPTS) || 2;

  const controller = new FallbackController({
    timeoutMs,
    maxAttempts,
  });

  controller
    .complete(payload, { maxAttempts })
    .then((result) => {
      console.log(JSON.stringify(result));
      process.exit(result.ok ? 0 : 1);
    })
    .catch((err) => {
      console.error('[fallback-cli] unexpected error: ' + (err && err.message ? err.message : String(err)));
      process.exit(3);
    });
}

main();