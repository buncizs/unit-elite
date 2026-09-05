'use strict';
/**
 * caveman-router.cjs
 * ============================================================================
 * UNIT ELITE — CAVEMAN B2 BYPASS ROUTER  (TECH-0002-optimasi-token)
 * ============================================================================
 *
 * Fail-open routing decision between the Runtime Gateway (:20129) and 9Router
 * (:20128), placing an OPTIONAL Caveman proxy in the inference path:
 *
 *   Runtime Gateway (:20129)  →  [ CAVEMAN PROXY (B2) ]  →  9Router (:20128/v1)
 *
 * PRINCIPLE (contract CAVEMAN_INTEGRATION.md §4):
 *   - Caveman is STRICTLY OPTIONAL. If the proxy is not enabled in config, or
 *     is enabled but not reachable / errors, the request MUST fall back to the
 *     direct 9Router endpoint so the inference service is never broken.
 *
 * This module contains NO protocol/content assumptions about what Caveman
 * does to the payload. It ONLY decides WHERE to send the HTTP request
 * (`endpoint`) and reports a routing `mode` for logging.
 *
 *   mode === 'caveman'             → send via Caveman proxy, log 'caveman=ACTIVE'
 *   mode === 'bypass-unavailable'  → proxy enabled but unreachable/error,
 *                                    log 'caveman=bypass (unavailable)'
 *   mode === 'bypass-disabled'     → proxy not enabled in config,
 *                                    log 'caveman=bypass (disabled)'
 *
 * Dependencies: Node.js built-ins only (node:fs, node:net, node:path).
 * No npm deps. No secrets. No payload logging.
 *
 * Status: PATCH_READY_FOR_ACCEPTANCE.
 * ============================================================================
 */

const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');

// Default Caveman proxy config location (integration package).
const DEFAULT_CONFIG_PATH = path.join(__dirname, 'config.json');

// Default port the Caveman proxy is expected to listen on (B2 listener side).
// The proxy receives requests on this port and forwards them to 9Router.
// 8787 = `caveman start` default (sendjaan; diseragamkan, tidak bergantung env).
const DEFAULT_CAVEMAN_PORT = 8787;
const DEFAULT_CAVEMAN_HOST = '127.0.0.1';

// Health-probe timeout (short, so an unreachable proxy never stalls inference).
const DEFAULT_HEALTH_TIMEOUT_MS = 1500;

// ---------------------------------------------------------------------------
// Config loading (fail-open: any parse/read error → disabled, direct route)
// ---------------------------------------------------------------------------

function loadCavemanConfig(configPath) {
  const target = configPath || DEFAULT_CONFIG_PATH;
  try {
    if (!fs.existsSync(target)) return null;
    const raw = fs.readFileSync(target, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    // Unreadable / invalid config → treat as "not enabled" (fail-open).
    return null;
  }
}

// ---------------------------------------------------------------------------
// Port reachability probe (TCP connect, loopback only)
// ---------------------------------------------------------------------------

/**
 * Returns true if a TCP connection to host:port succeeds within timeoutMs.
 */
function isPortReachable(host, port, timeoutMs) {
  return new Promise((resolve) => {
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      resolve(false);
      return;
    }
    const socket = new net.Socket();
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs || DEFAULT_HEALTH_TIMEOUT_MS);
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.once('timeout', () => done(false));
    socket.connect(port, host);
  });
}

// ---------------------------------------------------------------------------
// Decision resolver (pure-ish; only I/O is the optional health probe)
// ---------------------------------------------------------------------------

/**
 * Resolve the effective upstream endpoint for a completion request.
 *
 * @param {object}   [options]
 * @param {string}   [options.configPath]      path to caveman config.json
 * @param {string}   [options.directEndpoint]  direct 9Router endpoint
 * @param {boolean}  [options.probe]           if true, actually probe the port
 *                                             (default true). Used to make the
 *                                             resolver fully deterministic in
 *                                             unit tests.
 * @param {number}   [options.healthTimeoutMs]
 *
 * @returns {Promise<{ endpoint: string, mode: string, reason: string|null }>}
 *
 *   endpoint:
 *     - directEndpoint (9Router) when bypassing.
 *     - the Caveman endpoint (its listener address + '/v1') when active.
 *   mode:
 *     - 'caveman' | 'bypass-unavailable' | 'bypass-disabled'
 *   reason:
 *     - human-readable, secret-free descriptor for logging.
 */
async function resolveRoute(options = {}) {
  const directEndpoint = options.directEndpoint || 'http://127.0.0.1:20128/v1';
  const probe = options.probe !== false;
  const healthTimeoutMs = options.healthTimeoutMs || DEFAULT_HEALTH_TIMEOUT_MS;

  const cfg = loadCavemanConfig(options.configPath);
  if (!cfg || cfg.enabled !== true) {
    return {
      endpoint: directEndpoint,
      mode: 'bypass-disabled',
      reason: 'caveman proxy not enabled in config',
    };
  }

  // Resolve the Caveman proxy listener.
  const host = (typeof cfg.listen_host === 'string' && cfg.listen_host.trim())
    ? cfg.listen_host.trim()
    : DEFAULT_CAVEMAN_HOST;
  const port = Number.isInteger(cfg.port) && cfg.port > 0
    ? cfg.port
    : DEFAULT_CAVEMAN_PORT;

  // If unavailable → fail-open straight to the direct 9Router endpoint.
  if (probe) {
    const reachable = await isPortReachable(host, port, healthTimeoutMs);
    if (!reachable) {
      return {
        endpoint: directEndpoint,
        mode: 'bypass-unavailable',
        reason: 'caveman proxy unreachable (no listener on ' + host + ':' + port + ')',
      };
    }
  }

  // Proxy is reachable → route inference through it.
  const endpoint = 'http://' + host + ':' + port + '/v1';
  return {
    endpoint,
    mode: 'caveman',
    reason: 'caveman proxy active on ' + host + ':' + port,
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  resolveRoute,
  isPortReachable,
  loadCavemanConfig,
  DEFAULT_CONFIG_PATH,
  DEFAULT_CAVEMAN_PORT,
  DEFAULT_CAVEMAN_HOST,
  DEFAULT_HEALTH_TIMEOUT_MS,
};