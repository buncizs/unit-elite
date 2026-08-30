'use strict';
/**
 * fallback-controller.js
 * ============================================================================
 * UNIT ELITE FALLBACK CONTROLLER — TECH-0001-D2 (SANDBOXED implementation)
 * ============================================================================
 *
 * Purpose
 * -------
 * OpenAI-compatible fallback controller for the 9Router provider gateway
 * (loopback only: http://127.0.0.1:20128/v1). It implements provider-level
 * fallback ON THE UNIT ELITE SIDE:
 *
 *   PRIMARY  groq/openai/gpt-oss-120b
 *   FALLBACK gemini/gemini-3.5-flash-lite
 *
 * Design invariants
 * -----------------
 * - 9Router is USED as the provider gateway (loopback). It is NEVER modified.
 * - Native 9Router COMBO is NEVER used: no /combo endpoint is called, no combo
 *   object is created. Only POST {endpoint}/chat/completions is used, once per
 *   provider attempt, with a DIRECT model id in the `model` field.
 * - Timeout is enforced PER ATTEMPT (AbortController per request).
 * - Maximum 2 provider attempts on V1 (primary + 1 fallback) by default.
 * - Fallback happens ONLY for eligible failures (see ELIGIBLE_FOR_FALLBACK).
 * - The SAME payload is re-sent to the fallback model (messages, tools,
 *   tool_choice, response_format, temperature, ...) — only `model` is replaced.
 * - Internal provider reasoning is NOT exposed: only the final completion
 *   result (content / structured output / tool_calls) is returned; known
 *   reasoning fields are stripped from the response before returning.
 * - Transparent per-request logs WITHOUT secrets:
 *   request_id, primary_model, attempted_models, error_class, fallback_reason,
 *   selected_model, latency_per_attempt, final_status.
 * - API key is only read from the environment (NINEROUTER_KEY or
 *   NINEROUTER_API_KEY). It is never written to source, logs, or reports.
 *
 * This module is SANDBOXED: it is NOT wired into the Unit Elite runtime path.
 * Status: PATCH_READY_FOR_ACCEPTANCE (NOT production-ready).
 *
 * Dependencies: Node.js >= 18 (uses global fetch, node:crypto). No npm deps.
 * ============================================================================
 */

const crypto = require('node:crypto');

// --- Defaults (V1 routing per TECH-0001-D2) ---------------------------------

const DEFAULT_ENDPOINT = 'http://127.0.0.1:20128/v1';
const DEFAULT_MODELS = ['groq/openai/gpt-oss-120b', 'gemini/gemini-3.5-flash-lite'];
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_ATTEMPTS = 2; // V1: primary + 1 fallback

const ENV_KEY_VARIANTS = ['NINEROUTER_KEY', 'NINEROUTER_API_KEY'];

// --- Error classification domain ---------------------------------------------

const ERROR_CLASSES = Object.freeze([
  'TIMEOUT',
  'PROVIDER_UNAVAILABLE',
  'MODEL_UNAVAILABLE',
  'RATE_LIMIT',
  'HTTP_5XX',
  'CONNECTION_FAILURE',
  'INVALID_PAYLOAD',
  'AUTH_FAILURE',
  'POLICY_REJECTION',
  'UNKNOWN',
]);

/**
 * Eligible-for-fallback map.
 * TRUE  -> fallback to next model is allowed when this error class occurs.
 * FALSE -> fail closed; no further provider attempt.
 */
const ELIGIBLE_FOR_FALLBACK = Object.freeze({
  TIMEOUT: true,
  PROVIDER_UNAVAILABLE: true,
  MODEL_UNAVAILABLE: true,
  RATE_LIMIT: true,
  HTTP_5XX: true,
  CONNECTION_FAILURE: true,
  INVALID_PAYLOAD: false,
  AUTH_FAILURE: false,
  POLICY_REJECTION: false,
  UNKNOWN: false,
});

// Node transport error codes that are clearly connection-level failures.
const NODE_TRANSPORT_CODES = new Set([
  'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH', 'ENOTFOUND',
  'ECONNRESET', 'EPIPE', 'EADDRNOTAVAIL', 'ERR_EMPTY_RESPONSE',
  'UND_ERR_SOCKET', 'ERR_SOCKET_CLOSED_BEFORE_RESPONSE',
  'ECONNABORTED', 'ERR_STREAM_PREMATURE_CLOSE',
]);

// Node error codes that indicate a timeout of some kind.
const NODE_TIMEOUT_CODES = new Set([
  'ABORT_ERR', 'ETIMEDOUT', 'ESOCKETTIMEDOUT', 'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT', 'UND_ERR_CONNECT_TIMEOUT',
]);

// Known keys that carry internal provider reasoning / chain-of-thought.
const REASONING_KEYS = [
  'reasoning', 'reasoning_content', 'reasoning_text', 'reasoning_summary',
  'thought', 'thoughts', 'thinking', 'thinking_content', 'thinking_blocks',
  'chain_of_thought', 'internal_reasoning', 'analysis', 'candidates_reasoning',
];

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

function createRequestId() {
  return (
    'uefc-' +
    Date.now().toString(36) +
    '-' +
    crypto.randomBytes(4).toString('hex')
  );
}

function readApiKeyFromEnv() {
  for (const name of ENV_KEY_VARIANTS) {
    const v = process.env[name];
    if (v && String(v).trim().length > 0) {
      return String(v).trim();
    }
  }
  return null;
}

function normalizeS(value) {
  return typeof value === 'string' ? value : '';
}

function isModelUnavailableMessage(message) {
  const m = normalizeS(message).toLowerCase();
  return (
    /model[_ .-]?not[ _-]?found/i.test(m) ||
    /no such model/i.test(m) ||
    /the model .{0,40}(not found|does not exist|is not available|is not supported|is unavailable|is unknown|is invalid)/i.test(m) ||
    /model .{0,40}(does not exist|not found|not available|not supported|unknown|invalid|missing|unavailable)/i.test(m) ||
    /unknown model/i.test(m) ||
    /invalid model identifier/i.test(m) ||
    /model identifier .{0,40}(unknown|invalid|not found)/i.test(m) ||
    /no model/i.test(m)
  );
}

function isPolicyRejectionMessage(message) {
  const m = normalizeS(message).toLowerCase();
  return (
    /policy/i.test(m) ||
    /safety/i.test(m) ||
    /content[ _-]?filter/i.test(m) ||
    /moderation/i.test(m) ||
    /refus/i.test(m) ||
    /violat/i.test(m) ||
    /blocked/i.test(m) ||
    /terms of service/i.test(m) ||
    /["'](forbidden|denied)["']/i.test(m) ||
    /not allowed (by|under)/i.test(m)
  );
}

function isProviderUnavailableMessage(message) {
  const m = normalizeS(message).toLowerCase();
  return (
    /provider .{0,60}(unavailable|offline|not available|not found|no available|does not exist)/i.test(m) ||
    /no (available )?(provider|upstream|route)/i.test(m) ||
    /provider connection (failed|error)/i.test(m)
  );
}

function extractErrorMessage(body, responseText) {
  if (body && typeof body === 'object') {
    if (body.error && typeof body.error === 'object') {
      const msg =
        body.error.message ||
        body.error.code ||
        body.error.type;
      if (typeof msg === 'string' && msg.trim()) return msg.trim();
    }
    if (typeof body.message === 'string' && body.message.trim()) {
      return body.message.trim();
    }
  }
  const t = normalizeS(responseText).trim();
  if (t) return t.slice(0, 1000);
  return '';
}

/**
 * classifyError(input) -> { error_class, eligible, label }
 * input:
 *   { httpStatus: number|null, code: string|null, message: string,
 *     timedOut: boolean, networkError: boolean,
 *     body: object|null, responseText: string|null }
 */
function classifyError(input) {
  const httpStatus =
    input && Number.isFinite(input.httpStatus) ? input.httpStatus : null;
  const code = input && input.code ? String(input.code) : null;
  const message =
    extractErrorMessage(
      input && input.body,
      input && input.responseText
    ) || (input && input.message ? String(input.message) : '');

  const timedOut =
    Boolean(input && input.timedOut) ||
    (code !== null && NODE_TIMEOUT_CODES.has(code));

  // --- Transport level (no HTTP status received) ---------------------------
  if (httpStatus === null) {
    if (timedOut) {
      return { error_class: 'TIMEOUT', eligible: true, label: 'per-attempt timeout (no response)' };
    }
    if (code !== null && NODE_TRANSPORT_CODES.has(code)) {
      return { error_class: 'CONNECTION_FAILURE', eligible: true, label: `transport error ${code}` };
    }
    if (input && input.networkError) {
      return { error_class: 'PROVIDER_UNAVAILABLE', eligible: true, label: 'network/proxy error without HTTP status' };
    }
    return { error_class: 'UNKNOWN', eligible: false, label: 'unclassified transport error' };
  }

  // --- Provider-level signal embedded in a message can override status -----
  // Some gateways return 400/409/503 with "provider unavailable" phrasing.
  if (isProviderUnavailableMessage(message)) {
    return { error_class: 'PROVIDER_UNAVAILABLE', eligible: true, label: `provider unavailable signal (HTTP ${httpStatus})` };
  }
  if (isModelUnavailableMessage(message)) {
    return { error_class: 'MODEL_UNAVAILABLE', eligible: true, label: `model unavailable signal (HTTP ${httpStatus})` };
  }

  // --- HTTP status based classification ------------------------------------
  if (httpStatus === 401) {
    return { error_class: 'AUTH_FAILURE', eligible: false, label: 'HTTP 401 authentication failure (missing/invalid API key)' };
  }
  if (httpStatus === 403) {
    return { error_class: 'POLICY_REJECTION', eligible: false, label: 'HTTP 403 forbidden / policy denied' };
  }
  if (httpStatus === 404) {
    return { error_class: 'MODEL_UNAVAILABLE', eligible: true, label: 'HTTP 404 model not found' };
  }
  if (httpStatus === 408) {
    return { error_class: 'TIMEOUT', eligible: true, label: 'HTTP 408 request timeout' };
  }
  if (httpStatus === 429) {
    return { error_class: 'RATE_LIMIT', eligible: true, label: 'HTTP 429 rate limit / quota exceeded' };
  }
  if (httpStatus === 400 || httpStatus === 422) {
    if (isPolicyRejectionMessage(message)) {
      return { error_class: 'POLICY_REJECTION', eligible: false, label: `HTTP ${httpStatus} policy/safety rejection` };
    }
    return { error_class: 'INVALID_PAYLOAD', eligible: false, label: `HTTP ${httpStatus} malformed/invalid request payload` };
  }
  if (httpStatus >= 500 && httpStatus <= 599) {
    return { error_class: 'HTTP_5XX', eligible: true, label: `HTTP ${httpStatus} gateway/provider server error` };
  }

  return { error_class: 'UNKNOWN', eligible: false, label: `HTTP ${httpStatus} not classified` };
}

/**
 * Validate an OpenAI-compatible chat completion request payload.
 * Only structural checks on the part the caller controls. Fallback is NEVER
 * attempted for a malformed request payload (requirement 6).
 */
function validatePayload(payload) {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return { ok: false, detail: 'payload must be an object' };
  }
  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return { ok: false, detail: 'payload.messages must be a non-empty array' };
  }
  const bad = payload.messages.findIndex(
    (m) =>
      typeof m !== 'object' ||
      m === null ||
      Array.isArray(m) ||
      typeof m.role !== 'string' ||
      (m.content !== undefined &&
        m.content !== null &&
        typeof m.content !== 'string' &&
        !Array.isArray(m.content))
  );
  if (bad !== -1) {
    return { ok: false, detail: `payload.messages[${bad}] is not a valid OpenAI message` };
  }
  return { ok: true };
}

/**
 * Build the exact payload for a given attempt: same object, only `model`
 * replaced. This preserves messages, tools, tool_choice, response_format,
 * temperature, and any other OpenAI-compatible field (requirements 8 & 9).
 */
function buildAttemptPayload(payload, model) {
  if (typeof payload !== 'object' || payload === null) {
    throw new TypeError('payload must be an object');
  }
  return Object.assign({}, payload, { model });
}

/**
 * Strip provider-internal reasoning fields from a completion result.
 * Only the final user-facing result (content / structured output / tool_calls)
 * is returned (requirement 10). Works on a deep clone; never mutates input.
 */
function sanitizeCompletion(data) {
  if (typeof structuredClone === 'function') {
    try {
      data = structuredClone(data);
    } catch {
      data = JSON.parse(JSON.stringify(data));
    }
  }

  function stripReasoning(obj) {
    if (!obj || typeof obj !== 'object') return;
    for (const key of Object.keys(obj)) {
      const lower = String(key).toLowerCase();
      if (REASONING_KEYS.includes(lower)) {
        delete obj[key];
        continue;
      }
      // Nested walk only for plain objects/arrays (protects against cycles).
      if (obj[key] && typeof obj[key] === 'object') {
        stripReasoning(obj[key]);
      }
    }
  }

  stripReasoning(data);
  return data;
}

// ---------------------------------------------------------------------------
// FallbackController
// ---------------------------------------------------------------------------

class FallbackController {
  /**
   * options:
   *   endpoint     string  base URL, e.g. http://127.0.0.1:20128/v1
   *   models       string[] ordered provider attempts: [primary, fallback, ...]
   *   apiKey       string|null  (defaults to env NINEROUTER_KEY / NINEROUTER_API_KEY)
   *   timeoutMs    number  per-attempt timeout
   *   maxAttempts  number  max provider attempts (V1: 2)
   *   logger       function(recordLine:string)  default console.log
   */
  constructor(options = {}) {
    this.endpoint = String(
      options.endpoint || process.env.NINEROUTER_BASE_URL || DEFAULT_ENDPOINT
    ).replace(/\/+$/, '');

    const models =
      Array.isArray(options.models) && options.models.length > 0
        ? options.models.map((m) => String(m))
        : readModelsFromEnv() || [...DEFAULT_MODELS];
    this.models = models;

    this.apiKey =
      options.apiKey !== undefined ? options.apiKey : readApiKeyFromEnv();

    this.timeoutMs =
      Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0
        ? Number(options.timeoutMs)
        : DEFAULT_TIMEOUT_MS;

    const att =
      options.maxAttempts !== undefined
        ? Number(options.maxAttempts)
        : readIntEnv('NINEROUTER_MAX_ATTEMPTS', DEFAULT_MAX_ATTEMPTS);
    this.maxAttempts = Math.max(
      1,
      Math.min(Number.isFinite(att) ? Math.floor(att) : DEFAULT_MAX_ATTEMPTS, this.models.length)
    );

    this.logger = typeof options.logger === 'function' ? options.logger : console.log;
  }

  _emit(record) {
    const line = JSON.stringify({
      event: 'fallback_controller.request',
      ts: new Date().toISOString(),
      ...record,
    });
    try {
      this.logger(line);
    } catch {
      /* logging must never break request handling */
    }
  }

  /**
   * Execute one chat completion with provider fallback.
   *
   * payload: OpenAI-compatible request body (messages required).
   *
   * Returns (never throws for provider errors):
   *   on success: { ok:true, request_id, final_status:'ok', selected_model,
   *                 attempted_models, latency_per_attempt, data (sanitized),
   *                 last_error_class }
   *   on failure: { ok:false, request_id, final_status:'error',
   *                 error_class, eligible_for_fallback, fallback_reason,
   *                 attempted_models, latency_per_attempt, detail }
   */
  async complete(payload, options = {}) {
    const requestId = createRequestId();
    const primaryModel = this.models[0];
    const maxAttempts =
      options.maxAttempts !== undefined
        ? Math.max(1, Math.min(Math.floor(Number(options.maxAttempts)) || 1, this.models.length))
        : this.maxAttempts;
    const models = this.models.slice(0, maxAttempts);

    const logBase = {
      request_id: requestId,
      primary_model: primaryModel,
      attempted_models: [],
      error_class: null,
      fallback_reason: null,
      selected_model: null,
      latency_per_attempt: [],
      final_status: 'error',
    };

    // Structural validation: malformed user/request payload => NO fallback,
    // NO network attempt (requirement 6).
    const validation = validatePayload(payload);
    if (!validation.ok) {
      logBase.error_class = 'INVALID_PAYLOAD';
      logBase.fallback_reason = 'request payload rejected before any provider attempt: ' + validation.detail;
      this._emit(logBase);
      return {
        ok: false,
        request_id: requestId,
        final_status: 'error',
        error_class: 'INVALID_PAYLOAD',
        eligible_for_fallback: false,
        fallback_reason: logBase.fallback_reason,
        selected_model: null,
        attempted_models: [],
        latency_per_attempt: [],
        detail: validation.detail,
      };
    }

    let lastErrorClass = null;
    let lastEligible = false;

    for (let i = 0; i < models.length; i++) {
      const model = models[i];
      const attempt = await this._attemptOnce(payload, model);

      logBase.attempted_models.push(model);
      logBase.latency_per_attempt.push(attempt.latencyMs);

      if (attempt.ok) {
        logBase.selected_model = model;
        logBase.final_status = 'ok';
        logBase.error_class = null;
        this._emit(logBase);
        return {
          ok: true,
          request_id: requestId,
          final_status: 'ok',
          selected_model: model,
          attempted_models: [...logBase.attempted_models],
          latency_per_attempt: [...logBase.latency_per_attempt],
          last_error_class: lastErrorClass,
          data: sanitizeCompletion(attempt.data),
        };
      }

      const cls = classifyError(attempt.errorInput);
      lastErrorClass = cls.error_class;
      lastEligible = ELIGIBLE_FOR_FALLBACK[cls.error_class] === true;

      const hasNext = i + 1 < models.length;
      if (lastEligible && hasNext) {
        // Eligible failure and attempts remain: re-send the SAME payload to
        // the next model (only `model` changes).
        logBase.error_class = cls.error_class;
        logBase.fallback_reason = `${cls.error_class} on ${model}: ${cls.label}; retrying with ${models[i + 1]}`;
        continue;
      }

      // Final failure: either not eligible, or eligible but attempts exhausted.
      const reason = lastEligible
        ? `${cls.error_class} on ${model} (eligible) but max attempts (${models.length}) reached`
        : `${cls.error_class} on ${model} (NOT eligible for fallback): ${cls.label}`;
      logBase.error_class = cls.error_class;
      logBase.fallback_reason = reason;
      logBase.final_status = 'error';
      this._emit(logBase);
      return {
        ok: false,
        request_id: requestId,
        final_status: 'error',
        error_class: cls.error_class,
        eligible_for_fallback: lastEligible,
        fallback_reason: reason,
        selected_model: null,
        attempted_models: [...logBase.attempted_models],
        latency_per_attempt: [...logBase.latency_per_attempt],
        detail: cls.label,
      };
    }

    // Unreachable with default config, but fail closed just in case.
    logBase.error_class = 'UNKNOWN';
    logBase.fallback_reason = 'no provider attempt executed';
    this._emit(logBase);
    return {
      ok: false,
      request_id: requestId,
      final_status: 'error',
      error_class: 'UNKNOWN',
      eligible_for_fallback: false,
      fallback_reason: logBase.fallback_reason,
      selected_model: null,
      attempted_models: [...logBase.attempted_models],
      latency_per_attempt: [...logBase.latency_per_attempt],
      detail: 'no provider attempt executed',
    };
  }

  /**
   * Single attempt against {endpoint}/chat/completions with Bearer auth and a
   * PER-ATTEMPT timeout. Returns a normalized attempt object; never throws.
   */
  async _attemptOnce(payload, model) {
    const started = Date.now();
    const url = this.endpoint + '/chat/completions';
    const body = buildAttemptPayload(payload, model);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();

    let res = null;
    let responseText = '';
    try {
      const headers = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };
      if (this.apiKey) {
        headers.Authorization = 'Bearer ' + this.apiKey;
      }

      res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
        redirect: 'error', // never follow redirects (loopback-only gateway)
      });

      responseText = await res.text();
      const latencyMs = Date.now() - started;

      let parsed = null;
      if (responseText) {
        try {
          parsed = JSON.parse(responseText);
        } catch {
          parsed = null;
        }
      }

      if (res.ok) {
        return {
          ok: true,
          latencyMs,
          data: parsed !== null ? parsed : responseText,
        };
      }

      return {
        ok: false,
        latencyMs,
        status: res.status,
        errorInput: {
          httpStatus: res.status,
          code: null,
          message: '',
          timedOut: false,
          networkError: false,
          body: parsed,
          responseText,
        },
      };
    } catch (err) {
      const latencyMs = Date.now() - started;
      const errName = err && err.name ? String(err.name) : '';
      const errCode =
        (err && err.code) || (err && err.cause && err.cause.code) || null;
      const timedOut =
        errName === 'AbortError' ||
        errName === 'TimeoutError' ||
        (err && err.cause && /timeout/i.test(String(err.cause.name || err.cause.code || ''))) ||
        /abort/i.test(errName);

      return {
        ok: false,
        latencyMs,
        status: null,
        errorInput: {
          httpStatus: null,
          code: errCode ? String(errCode) : null,
          message:
            (err && err.message ? String(err.message) : String(err)).slice(0, 500) +
            (err && err.cause ? ' (cause: ' + String(err.cause.message || err.cause.name || err.cause.code || '') + ')' : ''),
          timedOut: Boolean(timedOut),
          networkError: true,
          body: null,
          responseText: '',
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------------------
// Env helpers
// ---------------------------------------------------------------------------

function readModelsFromEnv() {
  const models = process.env.NINEROUTER_MODELS;
  if (models && String(models).trim()) {
    const list = String(models)
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    if (list.length > 0) return list;
  }
  const primary = process.env.NINEROUTER_MODEL_PRIMARY;
  const fallback = process.env.NINEROUTER_MODEL_FALLBACK;
  if (primary || fallback) {
    const list = [];
    if (primary) list.push(String(primary).trim());
    if (fallback) list.push(String(fallback).trim());
    if (list.length > 0) return list;
  }
  return null;
}

function readIntEnv(name, def) {
  const v = process.env[name];
  if (v && Number.isFinite(Number(v)) && Number(v) > 0) {
    return Math.floor(Number(v));
  }
  return def;
}

module.exports = {
  FallbackController,
  classifyError,
  sanitizeCompletion,
  buildAttemptPayload,
  validatePayload,
  createRequestId,
  readApiKeyFromEnv,
  DEFAULT_ENDPOINT,
  DEFAULT_MODELS,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_ATTEMPTS,
  ERROR_CLASSES,
  ELIGIBLE_FOR_FALLBACK,
  ENV_KEY_VARIANTS,
};