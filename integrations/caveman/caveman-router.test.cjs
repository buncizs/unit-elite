'use strict';
/**
 * caveman-router.test.cjs
 * ============================================================================
 * UNIT ELITE — CAVEMAN B2 ROUTER REGRESSION TEST
 * ============================================================================
 *
 * Verifies the fail-open Caveman routing contract (TECH-0002-optimasi-token) at
 * the router layer, WITHOUT requiring a real Caveman binary (which is NOT yet
 * installed in this environment — see TECH-0002 report).
 *
 * Scenarios covered:
 *   (a) config enabled + real TCP listener on the Caveman port
 *           → resolveRoute returns mode 'caveman'  (⇒ gateway logs caveman=ACTIVE)
 *   (b) config enabled + NO listener on the Caveman port
 *           → resolveRoute returns mode 'bypass-unavailable'
 *             (⇒ gateway logs caveman=BYPASS, fail-open to 9Router)
 *   (c) config disabled (enabled:false)
 *           → resolveRoute returns mode 'bypass-disabled'
 *
 * Dependencies: Node.js built-ins only (node:net, node:fs, node:os, node:path,
 *               node:assert). No npm deps.
 * ============================================================================
 */

const assert = require('node:assert');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  resolveRoute,
} = require('./caveman-router.cjs');

const DIRECT = 'http://127.0.0.1:20128/v1';

function tmpConfig(overrides) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caveman-test-'));
  const file = path.join(dir, 'config.json');
  const base = {
    enabled: true,
    mode: 'b2',
    listen_host: '127.0.0.1',
    port: 0,
    upstream: 'http://127.0.0.1:20129/v1',
    downstream_to: 'http://127.0.0.1:20128/v1',
    compress_threshold_tokens: 0,
  };
  fs.writeFileSync(file, JSON.stringify(Object.assign(base, overrides), null, 2), 'utf8');
  return file;
}

function startPassiveListener(port) {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(port, '127.0.0.1', () => {
      resolve(srv);
    });
  });
}

async function freePort() {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

async function main() {
  let failures = 0;

  // -------------------------------------------------------------------------
  // Scenario (a): enabled + live listener ⇒ mode 'caveman'  (gateway logs ACTIVE)
  // -------------------------------------------------------------------------
  {
    const port = await freePort();
    const listener = await startPassiveListener(port);
    const cfgPath = tmpConfig({ port });
    try {
      const r = await resolveRoute({ configPath: cfgPath, directEndpoint: DIRECT });
      assert.strictEqual(r.mode, 'caveman', 'mode should be caveman when listener up');
      assert.strictEqual(r.endpoint, `http://127.0.0.1:${port}/v1`, 'endpoint should point at Caveman listener');
    } finally {
      listener.close();
    }
    console.log('[caveman-test] PASS (a) ACTIVE: enabled + live listener → mode=caveman');
  }

  // -------------------------------------------------------------------------
  // Scenario (b): enabled + NO listener ⇒ mode 'bypass-unavailable' (fail-open)
  // -------------------------------------------------------------------------
  {
    const port = await freePort(); // port is now free (no listener)
    const cfgPath = tmpConfig({ port });
    const r = await resolveRoute({ configPath: cfgPath, directEndpoint: DIRECT });
    assert.strictEqual(r.mode, 'bypass-unavailable', 'mode should be bypass-unavailable when no listener');
    assert.strictEqual(r.endpoint, DIRECT, 'endpoint should fall back to direct 9Router');
    console.log('[caveman-test] PASS (b) BYPASS: enabled + no listener → mode=bypass-unavailable (fail-open)');
  }

  // -------------------------------------------------------------------------
  // Scenario (c): disabled ⇒ mode 'bypass-disabled'
  // -------------------------------------------------------------------------
  {
    const cfgPath = tmpConfig({ enabled: false });
    const r = await resolveRoute({ configPath: cfgPath, directEndpoint: DIRECT });
    assert.strictEqual(r.mode, 'bypass-disabled', 'mode should be bypass-disabled when enabled:false');
    assert.strictEqual(r.endpoint, DIRECT, 'endpoint should stay direct 9Router when disabled');
    console.log('[caveman-test] PASS (c) DISABLED: enabled=false → mode=bypass-disabled');
  }

  if (failures > 0) {
    console.error(`[caveman-test] ${failures} FAILURE(S)`);
    process.exit(1);
  }
  console.log('[caveman-test] ALL PASS');
}

main().catch((err) => {
  console.error('[caveman-test] FATAL:', err && err.message ? err.message : String(err));
  process.exit(2);
});