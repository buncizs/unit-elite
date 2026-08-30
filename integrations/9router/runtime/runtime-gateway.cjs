'use strict';
/**
 * runtime-gateway.cjs
 * ============================================================================
 * UNIT ELITE RUNTIME GATEWAY — TECH-0001-D7-R3
 * ============================================================================
 *
 * Persistent HTTP server that sits between OpenCode and 9Router.
 *
 *   OpenCode
 *      ↓  http://127.0.0.1:20129/v1
 *   Unit Elite Runtime Gateway   ← THIS FILE
 *      ↓  (internal routing + fallback via FallbackController)
 *   9Router  (127.0.0.1:20128 — unchanged)
 *      ↓
 *   Provider Pool
 *
 * Security invariants:
 *   - Binds ONLY to 127.0.0.1 (never 0.0.0.0).
 *   - No API key/Authorization header in logs or responses.
 *   - Gemini quarantine ACTIVE: gemini/* and ag/gemini-* NEVER in routing.
 *   - Raw provider error bodies are NEVER forwarded to OpenCode.
 *   - Reasoning fields stripped via FallbackController.sanitizeCompletion.
 *
 * Dependencies: Node.js built-ins only (node:http, node:net, node:crypto,
 *               node:fs, node:path, node:process). No npm deps.
 *
 * Status: PATCH_READY_FOR_ACCEPTANCE (not production-ready until wired).
 * ============================================================================
 */

const http = require('node:http');
const net = require('node:net');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { FallbackController, sanitizeCompletion, validatePayload } =
  require('../fallback/fallback-controller.cjs');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const CONFIG_FILE = path.join(__dirname, 'runtime-config.json');
let _config = null;
function loadConfig() {
  if (_config) return _config;
  try {
    _config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch {
    _config = {
      runtime_version: '1.0.0',
      tech_id: 'TECH-0001-D7-R3',
      bind_host: '127.0.0.1',
      default_port: 20129,
      port_env_var: 'UNIT_ELITE_RUNTIME_PORT',
      upstream_router: 'http://127.0.0.1:20128/v1',
      logical_model: 'unit-elite-runtime',
      gemini_quarantine: true,
      routing: {
        primary: 'groq/openai/gpt-oss-120b',
        fallback: 'ag/claude-sonnet-4-6',
        gemini_excluded: ['gemini/*', 'ag/gemini-*'],
      },
      timeout_ms: 30000,
      max_attempts: 2,
      pid_file: 'runtime-gateway.pid',
      log_secrets: false,
    };
  }
  return _config;
}

// Gemini quarantine: provider models that are NEVER allowed in any routing slot.
const GEMINI_QUARANTINE_PATTERNS = [
  /^gemini\//i,
  /^ag\/gemini-/i,
];

function isGeminiQuarantined(model) {
  return GEMINI_QUARANTINE_PATTERNS.some((p) => p.test(String(model)));
}

// Routing policy — Gemini EXCLUDED per quarantine.
// These are the candidate models forwarded to FallbackController.
const ROUTING_POLICY = {
  primary: 'groq/openai/gpt-oss-120b',
  fallback: 'ag/claude-sonnet-4-6',
};

// Verify quarantine at module load — fail fast if someone misconfigures.
if (isGeminiQuarantined(ROUTING_POLICY.primary) || isGeminiQuarantined(ROUTING_POLICY.fallback)) {
  console.error('[runtime-gateway] FATAL: Gemini quarantine violation in ROUTING_POLICY. Exiting.');
  process.exit(1);
}

// Read dynamically so tests can override via env before/after require.
function getUpstreamRouter() {
  return (process.env.UNIT_ELITE_UPSTREAM_URL || 'http://127.0.0.1:20128/v1').replace(/\/+$/, '');
}

const BIND_HOST = '127.0.0.1';
const DEFAULT_PORT = 20129;
const LOGICAL_MODEL = 'unit-elite-runtime';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getPort() {
  const envPort = process.env.UNIT_ELITE_RUNTIME_PORT;
  if (envPort) {
    const n = parseInt(envPort, 10);
    if (Number.isFinite(n) && n > 0 && n < 65536) return n;
  }
  return DEFAULT_PORT;
}

function getApiKey() {
  // Never log the value.
  // Priority 1: explicit environment variables.
  for (const name of ['NINEROUTER_KEY', 'NINEROUTER_API_KEY']) {
    const v = process.env[name];
    if (v && String(v).trim().length > 0) return String(v).trim();
  }

  // Priority 2: Unit Elite local secret file used by OpenCode/9Router.
  // Do not log the key value.
  const home = process.env.USERPROFILE || process.env.HOME;
  if (home) {
    const keyPath = path.join(home, '.unit-elite-secrets', '9router.key');
    try {
      if (fs.existsSync(keyPath)) {
        const v = fs.readFileSync(keyPath, 'utf8').trim();
        if (v.length > 0) return v;
      }
    } catch {
      // Treat unreadable/missing secret as no key.
    }
  }

  return null;
}

function createRequestId() {
  return 'rg-' + Date.now().toString(36) + '-' + crypto.randomBytes(4).toString('hex');
}

function safeLog(msg) {
  // Never log secrets — redact Authorization patterns just in case.
  const safe = String(msg).replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
                           .replace(/"Authorization"\s*:\s*"[^"]*"/gi, '"Authorization": "[REDACTED]"');
  console.log(safe);
}

function pidFilePath() {
  return path.join(__dirname, 'runtime-gateway.pid');
}

function writePidFile() {
  try {
    fs.writeFileSync(pidFilePath(), String(process.pid), 'utf8');
  } catch (err) {
    safeLog('[runtime-gateway] WARNING: could not write PID file: ' + err.message);
  }
}

function deletePidFile() {
  try {
    if (fs.existsSync(pidFilePath())) fs.unlinkSync(pidFilePath());
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Port occupancy check
// ---------------------------------------------------------------------------

function isPortFree(port, host) {
  return new Promise((resolve) => {
    const tester = net.createServer();
    tester.once('error', () => resolve(false));
    tester.once('listening', () => {
      tester.close(() => resolve(true));
    });
    tester.listen(port, host);
  });
}

// ---------------------------------------------------------------------------
// 9Router reachability check (for /health)
// ---------------------------------------------------------------------------

async function checkRouterHealth() {
  const url = getUpstreamRouter() + '/models';
  try {
    const headers = { Accept: 'application/json' };
    const apiKey = getApiKey();
    if (apiKey) headers.Authorization = 'Bearer ' + apiKey;

    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Build FallbackController per request (stateless — config from ROUTING_POLICY)
// ---------------------------------------------------------------------------

function buildController(options = {}) {
  const cfg = loadConfig();
  const timeoutMs = options.timeoutMs || cfg.timeout_ms || 30000;
  const maxAttempts = options.maxAttempts || cfg.max_attempts || 2;
  const endpoint = options.endpoint || getUpstreamRouter();
  const models = [ROUTING_POLICY.primary, ROUTING_POLICY.fallback];

  // Quarantine double-check (defense in depth).
  for (const m of models) {
    if (isGeminiQuarantined(m)) {
      throw new Error('Gemini quarantine violation: ' + m);
    }
  }

  return new FallbackController({
    endpoint,
    models,
    apiKey: getApiKey(),
    timeoutMs,
    maxAttempts,
    logger: (line) => {
      // Strip any Authorization header values from controller logs.
      safeLog('[fallback-ctrl] ' + line);
    },
  });
}

// ---------------------------------------------------------------------------
// Request body reader
// ---------------------------------------------------------------------------

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const MAX = 10 * 1024 * 1024; // 10 MB guard
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX) {
        reject(new Error('request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Canonical conversation normalization
// ---------------------------------------------------------------------------

function cloneJsonValue(value) {
  if (Array.isArray(value)) return value.map(cloneJsonValue);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, child] of Object.entries(value)) {
      out[key] = cloneJsonValue(child);
    }
    return out;
  }
  return value;
}

function isEmptyAssistantContent(content) {
  if (content === null || content === undefined) return true;
  if (typeof content === 'string') return content.trim().length === 0;
  if (Array.isArray(content)) {
    if (content.length === 0) return true;
    return content.every((part) => {
      if (!part || typeof part !== 'object') return false;
      if (part.type !== 'text') return false;
      return typeof part.text !== 'string' || part.text.trim().length === 0;
    });
  }
  return false;
}

function hasToolCalls(message) {
  return Boolean(
    message &&
    Array.isArray(message.tool_calls) &&
    message.tool_calls.length > 0
  );
}

function isSyntheticAssistantPrefill(message) {
  if (!message || message.role !== 'assistant' || hasToolCalls(message)) return false;
  if (message.__synthetic_prefill__ === true) return true;
  return isEmptyAssistantContent(message.content);
}

/**
 * Convert an OpenCode/OpenAI-compatible payload into a canonical provider-safe
 * conversation state before any provider is selected.
 *
 * Invariants:
 *   - Never mutates the caller's payload.
 *   - Never invents a user message, assistant content, or tool result.
 *   - Removes only a trailing assistant prefill that is unambiguously synthetic:
 *       (a) empty assistant content with no tool_calls, or
 *       (b) explicit __synthetic_prefill__ === true marker.
 *   - A completed assistant turn without new user/tool input never triggers inference.
 *   - Unresolved tool_calls never trigger inference.
 */
function normalizeConversationPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      ok: false,
      action: 'REJECT',
      payload: null,
      code: 'INVALID_PAYLOAD',
      detail: 'Request body must be a JSON object.',
    };
  }

  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return {
      ok: false,
      action: 'REJECT',
      payload: null,
      code: 'INVALID_PAYLOAD',
      detail: 'messages must be a non-empty array.',
    };
  }

  const normalized = cloneJsonValue(payload);
  const messages = normalized.messages;

  for (const message of messages) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return {
        ok: false,
        action: 'REJECT',
        payload: null,
        code: 'INVALID_PAYLOAD',
        detail: 'Each message must be an object.',
      };
    }
    if (typeof message.role !== 'string' || message.role.trim().length === 0) {
      return {
        ok: false,
        action: 'REJECT',
        payload: null,
        code: 'INVALID_PAYLOAD',
        detail: 'Each message must have a role.',
      };
    }
  }

  // Remove one or more trailing client-generated assistant prefills. This is
  // deliberately conservative; non-empty assistant content is only removable
  // when the explicit marker is present.
  let removedPrefills = 0;
  while (messages.length > 0 && isSyntheticAssistantPrefill(messages[messages.length - 1])) {
    messages.pop();
    removedPrefills++;
  }

  if (messages.length === 0) {
    return {
      ok: false,
      action: 'NO_PROVIDER',
      payload: null,
      code: 'INCOMPATIBLE_SHAPE',
      detail: 'Conversation contains only synthetic assistant prefill.',
    };
  }

  // Internal marker is a client/runtime hint and must never be forwarded to a
  // provider, even if it appeared on an earlier message.
  for (const message of messages) {
    if (Object.prototype.hasOwnProperty.call(message, '__synthetic_prefill__')) {
      delete message.__synthetic_prefill__;
    }
  }

  // Track tool-call lifecycle using only evidence already present in messages.
  // Missing or unmatched results are never fabricated.
  const pendingToolCalls = new Set();
  let unmatchedToolResult = false;
  for (const message of messages) {
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      for (const call of message.tool_calls) {
        if (call && typeof call.id === 'string' && call.id.length > 0) {
          pendingToolCalls.add(call.id);
        }
      }
    } else if (message.role === 'tool') {
      const id = typeof message.tool_call_id === 'string' ? message.tool_call_id : '';
      if (id && pendingToolCalls.has(id)) {
        pendingToolCalls.delete(id);
      } else {
        unmatchedToolResult = true;
      }
    }
  }

  if (unmatchedToolResult) {
    return {
      ok: false,
      action: 'NO_PROVIDER',
      payload: null,
      code: 'INCOMPATIBLE_SHAPE',
      detail: 'Tool result has no matching in-payload tool_call.',
    };
  }

  if (pendingToolCalls.size > 0) {
    return {
      ok: false,
      action: 'NO_PROVIDER',
      payload: null,
      code: 'WAITING_FOR_TOOL_RESULT',
      detail: 'One or more tool calls are waiting for matching tool results.',
    };
  }

  const last = messages[messages.length - 1];
  if (last.role === 'assistant') {
    return {
      ok: false,
      action: 'NO_PROVIDER',
      payload: null,
      code: 'NO_NEW_USER_TURN',
      detail: 'Conversation ends with a completed assistant turn and has no new user/tool input.',
    };
  }

  if (last.role !== 'user' && last.role !== 'tool') {
    return {
      ok: false,
      action: 'NO_PROVIDER',
      payload: null,
      code: 'INCOMPATIBLE_SHAPE',
      detail: 'Conversation must end with a user turn or a completed tool result.',
    };
  }

  return {
    ok: true,
    action: removedPrefills > 0 ? 'NORMALIZED' : 'DISPATCH',
    payload: normalized,
    code: removedPrefills > 0 ? 'SYNTHETIC_ASSISTANT_PREFILL_REMOVED' : null,
    detail: removedPrefills > 0 ? `Removed ${removedPrefills} synthetic trailing assistant prefill turn(s).` : null,
  };
}

// ---------------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------------

function sendJSON(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function sendError(res, statusCode, errorCode, message) {
  // Never forward raw provider error. Always normalize.
  sendJSON(res, statusCode, {
    error: {
      message,
      type: errorCode,
      code: String(statusCode),
    },
  });
}

function sendControlledError(res, statusCode, controlCode, message) {
  sendJSON(res, statusCode, {
    error: {
      message,
      type: 'invalid_request_error',
      code: controlCode,
    },
  });
}

// ---------------------------------------------------------------------------
// Streaming proxy (SSE pass-through)
// ---------------------------------------------------------------------------

/**
 * Forward a streaming SSE response from 9Router to OpenCode transparently.
 * Uses fetch + ReadableStream pipe. Does NOT buffer the full response.
 *
 * Returns { ok: boolean, streamStarted: boolean }
 */
async function streamFromProvider(payload, model, endpoint, apiKey, clientRes, requestId) {
  const url = endpoint + '/chat/completions';
  const body = Object.assign({}, payload, { model, stream: true });
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (apiKey) headers.Authorization = 'Bearer ' + apiKey;

  const controller = new AbortController();
  const cfg = loadConfig();
  const timeoutMs = cfg.timeout_ms || 30000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const upstreamRes = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!upstreamRes.ok) {
      safeLog('[runtime-gateway] stream upstream reject model=' +
        model +
        ' HTTP=' + upstreamRes.status +
        ' content_type=' + String(upstreamRes.headers.get('content-type') || '-') +
        ' req=' + requestId);
      return { ok: false, streamStarted: false, status: upstreamRes.status };
    }

    clientRes.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Transfer-Encoding': 'chunked',
    });

    const reader = upstreamRes.body.getReader();
    const decoder = new TextDecoder();
    let pending = '';
    let upstreamDoneCount = 0;
    let forwardedDataLines = 0;

    function clientWritable() {
      return !clientRes.writableEnded && !clientRes.destroyed;
    }

    function emitLine(rawLine, withNewline = true) {
      let line = rawLine;
      if (line.endsWith('\r')) line = line.slice(0, -1);

      if (line.trim() === 'data: [DONE]') {
        upstreamDoneCount += 1;
        return;
      }

      if (line.startsWith('data: ')) forwardedDataLines += 1;

      if (clientWritable()) {
        clientRes.write(line + (withNewline ? '\n' : ''));
      }
    }

    function consumeText(textChunk) {
      if (!textChunk) return;
      pending += textChunk;

      let newlineIndex;
      while ((newlineIndex = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, newlineIndex);
        pending = pending.slice(newlineIndex + 1);
        emitLine(line, true);
      }
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      consumeText(decoder.decode(value, { stream: true }));
    }

    consumeText(decoder.decode());

    if (pending.length > 0) {
      emitLine(pending, true);
      pending = '';
    }

    if (clientWritable()) {
      clientRes.write('data: [DONE]\n\n');
      clientRes.end();
    }

    safeLog('[runtime-gateway] SSE canonicalized upstream_done_count=' +
      upstreamDoneCount +
      ' forwarded_data_lines=' + forwardedDataLines +
      ' model=' + model +
      ' req=' + requestId);

    return { ok: true, streamStarted: true };
  } catch (err) {
    clearTimeout(timer);
    const errName = err && err.name ? String(err.name) : '';
    const timedOut = errName === 'AbortError' || errName === 'TimeoutError';
    return { ok: false, streamStarted: false, timedOut, error: err };
  }
}

// ---------------------------------------------------------------------------
// Route: POST /v1/chat/completions — streaming variant
// ---------------------------------------------------------------------------

async function handleChatStream(parsedPayload, res, requestId) {
  const cfg = loadConfig();
  const endpoint = getUpstreamRouter();
  const apiKey = getApiKey();
  const models = [ROUTING_POLICY.primary, ROUTING_POLICY.fallback];

  for (let i = 0; i < models.length; i++) {
    const model = models[i];
    if (isGeminiQuarantined(model)) {
      safeLog('[runtime-gateway] SKIP gemini-quarantined model: ' + model + ' req=' + requestId);
      continue;
    }

    safeLog('[runtime-gateway] stream attempt model=' + model + ' req=' + requestId);
    const result = await streamFromProvider(parsedPayload, model, endpoint, apiKey, res, requestId);

    if (result.streamStarted) {
      // Streaming committed — response already sent.
      return;
    }

    if (result.ok) {
      // Shouldn't happen (streamStarted=true when ok), but guard.
      return;
    }

    // Pre-stream failure — check if fallback eligible.
    const status = result.status || 0;
    const isEligible = (
      status === 413 ||

      status === 429 ||
      (status >= 500 && status <= 599) ||
      status === 404 ||
      status === 408 ||
      result.timedOut ||
      (status === 0 && !result.timedOut) // connection-level
    );
    const isAuthFailure = status === 401;

    if (isAuthFailure) {
      sendError(res, 401, 'auth_failure', 'Authentication failed. Check API key configuration.');
      return;
    }

    const hasNext = i + 1 < models.length;
    if (isEligible && hasNext) {
      safeLog('[runtime-gateway] stream pre-start failure HTTP=' + status + ' falling back req=' + requestId);
      continue;
    }

    // All models exhausted or non-eligible error.
    const code = isEligible ? 'provider_error' : 'provider_error';
    sendError(res, 502, code, 'Provider error. Please retry.');
    return;
  }

  // All candidates skipped/exhausted.
  sendError(res, 502, 'no_provider', 'No eligible provider available.');
}

// ---------------------------------------------------------------------------
// Route: POST /v1/chat/completions — non-streaming variant
// ---------------------------------------------------------------------------

async function handleChatNonStream(parsedPayload, res, requestId) {
  const controller = buildController();

  // Strip the logical model; FallbackController will use ROUTING_POLICY models.
  const forwardPayload = Object.assign({}, parsedPayload);
  delete forwardPayload.model; // model will be injected per attempt by FallbackController

  const result = await controller.complete(forwardPayload);

  if (result.ok) {
    safeLog('[runtime-gateway] completion ok model=' + result.selected_model + ' req=' + requestId);
    sendJSON(res, 200, result.data);
    return;
  }

  // Map error class to HTTP status.
  const errClass = result.error_class || 'UNKNOWN';
  let httpStatus = 502;
  let errType = 'provider_error';
  let errMsg = 'Provider error. Please retry.';

  if (errClass === 'INVALID_PAYLOAD') {
    httpStatus = 400;
    errType = 'invalid_request_error';
    errMsg = 'Invalid request: ' + (result.detail || 'malformed payload');
  } else if (errClass === 'AUTH_FAILURE') {
    httpStatus = 401;
    errType = 'auth_failure';
    errMsg = 'Authentication failed. Check API key configuration.';
  } else if (errClass === 'POLICY_REJECTION') {
    httpStatus = 403;
    errType = 'policy_rejection';
    errMsg = 'Request rejected by provider policy.';
  } else if (errClass === 'RATE_LIMIT') {
    httpStatus = 429;
    errType = 'rate_limit_error';
    errMsg = 'Rate limit exceeded. Please retry later.';
  }

  safeLog('[runtime-gateway] completion error class=' + errClass + ' status=' + httpStatus + ' req=' + requestId);
  sendError(res, httpStatus, errType, errMsg);
}

// ---------------------------------------------------------------------------
// HTTP request router
// ---------------------------------------------------------------------------

async function handleRequest(req, res) {
  const method = req.method || 'GET';
  const url = req.url || '/';
  const requestId = createRequestId();

  // CORS / preflight (loopback only — minimal)
  res.setHeader('X-Runtime', 'unit-elite-runtime');

  try {
    // GET /health
    if (method === 'GET' && url === '/health') {
      const routerOk = await checkRouterHealth();
      sendJSON(res, 200, {
        status: 'ready',
        runtime: 'unit-elite-runtime',
        router: routerOk ? 'healthy' : 'unreachable',
        routing_policy: 'loaded',
        fallback_controller: 'ready',
        gemini_quarantine: true,
      });
      return;
    }

    // GET /v1/models
    if (method === 'GET' && (url === '/v1/models' || url === '/v1/models/')) {
      sendJSON(res, 200, {
        object: 'list',
        data: [
          { id: LOGICAL_MODEL, object: 'model', owned_by: 'unit-elite' },
        ],
      });
      return;
    }

    // POST /v1/chat/completions
    if (method === 'POST' && (url === '/v1/chat/completions' || url === '/v1/chat/completions/')) {
      let rawBody;
      try {
        rawBody = await readBody(req);
      } catch (err) {
        sendError(res, 400, 'invalid_request_error', 'Could not read request body.');
        return;
      }

      let parsedPayload;
      try {
        parsedPayload = JSON.parse(rawBody);
      } catch {
        sendError(res, 400, 'invalid_request_error', 'Request body is not valid JSON.');
        return;
      }

      if (typeof parsedPayload !== 'object' || parsedPayload === null || Array.isArray(parsedPayload)) {
        sendError(res, 400, 'invalid_request_error', 'Request body must be a JSON object.');
        return;
      }

      // Canonicalize conversation state BEFORE provider selection. This prevents
      // trailing assistant/model-prefill shapes from reaching providers that
      // reject assistant prefill, while never inventing conversation content.
      const normalization = normalizeConversationPayload(parsedPayload);
      if (!normalization.ok) {
        const code = normalization.code || 'INCOMPATIBLE_SHAPE';
        if (code === 'NO_NEW_USER_TURN') {
          sendControlledError(res, 409, code, 'No new user or tool turn is available for inference.');
        } else if (code === 'WAITING_FOR_TOOL_RESULT') {
          sendControlledError(res, 409, code, 'Waiting for matching tool result before inference can continue.');
        } else if (code === 'INCOMPATIBLE_SHAPE') {
          sendControlledError(res, 400, code, normalization.detail || 'Conversation shape is not provider-safe.');
        } else {
          sendControlledError(res, 400, code, normalization.detail || 'Invalid request payload.');
        }
        return;
      }

      const normalizedPayload = normalization.payload;
      if (normalization.action === 'NORMALIZED') {
        safeLog('[runtime-gateway] conversation normalized code=' + normalization.code + ' req=' + requestId);
      }

      // Validate the normalized provider-bound payload. This preserves the
      // existing FallbackController validation contract without blocking the
      // normalizer from repairing a safe synthetic trailing prefill first.
      const validation = validatePayload(normalizedPayload);
      if (!validation.ok) {
        sendError(res, 400, 'invalid_request_error', 'Invalid request: ' + validation.detail);
        return;
      }

      const isStream = normalizedPayload.stream === true;

      if (isStream) {
        await handleChatStream(normalizedPayload, res, requestId);
      } else {
        await handleChatNonStream(normalizedPayload, res, requestId);
      }
      return;
    }

    // 404 for everything else
    sendError(res, 404, 'not_found', 'Endpoint not found: ' + method + ' ' + url);
  } catch (err) {
    safeLog('[runtime-gateway] INTERNAL ERROR req=' + requestId + ' ' + (err && err.message ? err.message : String(err)));
    try {
      if (!res.headersSent) {
        sendError(res, 500, 'internal_error', 'Internal runtime error.');
      }
    } catch { /* response may already be closed */ }
  }
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------

let server = null;
let managesPidFile = false;

async function start(options = {}) {
  const port = options.port !== undefined ? options.port : getPort();
  const host = options.host || BIND_HOST;
  const cfg = loadConfig();
  const managePidFile = options.managePidFile !== undefined
    ? Boolean(options.managePidFile)
    : (require.main === module);

  // Verify port is free before binding.
  const free = await isPortFree(port, host);
  if (!free) {
    const msg = `[runtime-gateway] FATAL: Port ${port} on ${host} is already in use. Exiting.`;
    console.error(msg);
    process.exit(1);
  }

  server = http.createServer(handleRequest);

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });

  if (managePidFile) {
    writePidFile();
    managesPidFile = true;
  }

  const banner = [
    '╔══════════════════════════════════════════════════════════════╗',
    '║        Unit Elite Runtime Gateway — TECH-0001-D7-R3          ║',
    '╠══════════════════════════════════════════════════════════════╣',
    `║  Listening : http://${host}:${port}/v1`,
    `║  PID       : ${process.pid}`,
    `║  Started   : ${new Date().toISOString()}`,
    `║  Upstream  : ${getUpstreamRouter()}`,
    `║  Routing   : primary=${ROUTING_POLICY.primary}`,
    `║              fallback=${ROUTING_POLICY.fallback}`,
    '║  Gemini    : QUARANTINED (zero Gemini in routing)            ║',
    '╚══════════════════════════════════════════════════════════════╝',
  ].join('\n');
  safeLog(banner);

  return server;
}

function shutdown(signal) {
  safeLog('[runtime-gateway] Received ' + signal + '. Shutting down...');
  if (managesPidFile) deletePidFile();
  if (server) {
    server.close(() => {
      safeLog('[runtime-gateway] Server closed. Exiting.');
      process.exit(0);
    });
    // Force exit after 5s if connections linger.
    setTimeout(() => {
      safeLog('[runtime-gateway] Forced exit after graceful timeout.');
      process.exit(0);
    }, 5000).unref();
  } else {
    process.exit(0);
  }
}

// ---------------------------------------------------------------------------
// Process signal handling
// ---------------------------------------------------------------------------

// Signal/PID lifecycle belongs only to the production CLI process.
// Imported test harnesses must never create, overwrite, or delete the production PID file.
if (require.main === module) {
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('exit', () => {
    if (managesPidFile) {
      try { deletePidFile(); } catch { /* best effort */ }
    }
  });
}

// ---------------------------------------------------------------------------
// Exports (for testing)
// ---------------------------------------------------------------------------

module.exports = {
  start,
  shutdown,
  handleRequest,
  buildController,
  checkRouterHealth,
  isPortFree,
  isGeminiQuarantined,
  normalizeConversationPayload,
  ROUTING_POLICY,
  LOGICAL_MODEL,
  BIND_HOST,
  DEFAULT_PORT,
};

// ---------------------------------------------------------------------------
// Entry point (CLI only)
// ---------------------------------------------------------------------------

if (require.main === module) {
  start().catch((err) => {
    console.error('[runtime-gateway] FATAL startup error: ' + (err && err.message ? err.message : String(err)));
    process.exit(1);
  });
}
