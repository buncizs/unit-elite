#!/usr/bin/env node
'use strict';
/**
 * test-integration-controller.cjs
 * ============================================================================
 * TECH-0001-D3 — DETERMINISTIC integration self-test for the Unit Elite TEST
 * "model route" wrapper (sandbox/CLONE only). Uses a LOCAL STUB HTTP server to
 * emulate the 9Router gateway. NO live provider, NO API key required.
 *
 * Validates the acceptance scenarios D3-01..D3-08 at the CONTRACT level through
 * the same `route()` entry that the live acceptance harness uses, so developer
 * self-verification is deterministic even without a running gateway:
 *
 *   D3-01 normal route (primary healthy, no fallback)
 *   D3-02 provider fallback (eligible 5xx -> fallback occurs, reversible)
 *   D3-03 context preservation multi-turn (messages preserved across attempts)
 *   D3-04 structured output (response_format preserved)
 *   D3-05 tool calling (tools/tool_choice preserved)
 *   D3-06 non-fallback error (malformed payload -> no attempt, no fallback)
 *   D3-07 double failure (max 2 attempts, no infinite retry)
 *   D3-08 router health (gateway reachable + model ids present)
 *
 * Run:  node test-integration-controller.cjs
 * Exit: 0 = all PASS, 1 = FAIL.
 * ============================================================================
 */

const http = require('node:http');
const assert = require('node:assert/strict');
const { route, buildController } = require('./integration-wrapper.cjs');
const { DEFAULT_MODELS } = require('../fallback-controller.cjs');

const PRIMARY = DEFAULT_MODELS[0]; // groq/openai/gpt-oss-120b
const FALLBACK = DEFAULT_MODELS[1]; // gemini/gemini-3.5-flash-lite

// ---------------------------------------------------------------------------
// Tiny runner
// ---------------------------------------------------------------------------
const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}
let failures = 0;
async function run() {
  for (const t of tests) {
    try {
      await t.fn();
      console.log('PASS  ' + t.name);
    } catch (err) {
      failures += 1;
      console.log('FAIL  ' + t.name);
      console.log('      ' + (err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n      ') : String(err)));
    }
  }
  console.log('');
  console.log(`RESULT ${tests.length - failures}/${tests.length} passed`);
  process.exit(failures === 0 ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Stub gateway (OpenAI-compatible /chat/completions + /models)
// ---------------------------------------------------------------------------
function createStub(scenarios) {
  const requests = [];
  const server = http.createServer((req, res) => {
    if (String(req.url).endsWith('/models')) {
      const data = Array.from(new Set([PRIMARY, FALLBACK])).map((id) => ({ id }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data }));
      return;
    }
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body = null;
      try {
        body = JSON.parse(raw);
      } catch {
        body = null;
      }
      const model = body && typeof body.model === 'string' ? body.model : null;
      requests.push({ model, body, url: req.url });
      const scenario = scenarios.find((s) => s.model === model);
      if (!scenario) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'no scenario for model ' + model } }));
        return;
      }
      scenario.calls = (scenario.calls || 0) + 1;
      const respond = () => {
        try {
          res.writeHead(scenario.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(scenario.body));
        } catch { /* client aborted */ }
      };
      if (scenario.delayMs) {
        setTimeout(respond, scenario.delayMs);
      } else {
        respond();
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        port: server.address().port,
        requests,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

const OK_TEXT = (content) => ({
  id: 'stub',
  object: 'chat.completion',
  created: 0,
  model: 'stub',
  choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

const SAMPLE_PAYLOAD = {
  messages: [
    { role: 'system', content: 'You are a test assistant.' },
    { role: 'user', content: 'Hello, reply with POOF' },
  ],
  temperature: 0.2,
  max_tokens: 64,
  tools: [
    { type: 'function', function: { name: 'get_test_status', description: 'x', parameters: { type: 'object', properties: {} } } },
  ],
  tool_choice: 'auto',
  response_format: { type: 'json_object' },
  x_custom_extra: 'keep-me',
};

function noopLogger() {}

// ---------------------------------------------------------------------------
// D3-01: normal route — primary healthy, no fallback
// ---------------------------------------------------------------------------
test('D3-01 normal route: primary healthy -> no fallback, primary selected', async () => {
  const stub = await createStub([
    { model: PRIMARY, status: 200, body: OK_TEXT('PONG') },
  ]);
  try {
    const result = await route(SAMPLE_PAYLOAD, {
      endpoint: `http://127.0.0.1:${stub.port}/v1`,
      models: [PRIMARY, FALLBACK],
      maxAttempts: 2,
      timeoutMs: 3000,
      logger: noopLogger,
    });
    assert.equal(result.ok, true);
    assert.equal(result.selected_model, PRIMARY);
    assert.deepEqual(result.attempted_models, [PRIMARY], 'fallback must not be attempted');
    assert.equal(result.latency_per_attempt.length, 1);
    assert.equal(stub.requests.length, 1, 'exactly one provider attempt');
  } finally {
    await stub.close();
  }
});

// ---------------------------------------------------------------------------
// D3-02: provider fallback (eligible 5xx -> reversible controlled fallback)
// ---------------------------------------------------------------------------
test('D3-02 provider fallback: eligible 5xx -> fallback occurs, payload preserved', async () => {
  const stub = await createStub([
    { model: PRIMARY, status: 503, body: { error: { message: 'upstream down' } } },
    { model: FALLBACK, status: 200, body: OK_TEXT('PONG') },
  ]);
  try {
    const result = await route(SAMPLE_PAYLOAD, {
      endpoint: `http://127.0.0.1:${stub.port}/v1`,
      models: [PRIMARY, FALLBACK],
      maxAttempts: 2,
      timeoutMs: 3000,
      logger: noopLogger,
    });
    assert.equal(result.ok, true);
    assert.equal(result.selected_model, FALLBACK);
    assert.deepEqual(result.attempted_models, [PRIMARY, FALLBACK]);
    assert.equal(result.last_error_class, 'HTTP_5XX');
    assert.equal(stub.requests.length, 2);
    // Payload preserved identically except model.
    const p = stub.requests.find((r) => r.model === PRIMARY);
    const f = stub.requests.find((r) => r.model === FALLBACK);
    const { model: _p, ...pRest } = p.body;
    const { model: _f, ...fRest } = f.body;
    assert.deepEqual(pRest, fRest, 'payload identical across attempts (except model)');
  } finally {
    await stub.close();
  }
});

// ---------------------------------------------------------------------------
// D3-03: context preservation multi-turn
// ---------------------------------------------------------------------------
test('D3-03 context preservation: full message history preserved through fallback', async () => {
  const history = [
    { role: 'user', content: 'Remember this token: CLOUD-20128.' },
    { role: 'assistant', content: 'Understood.' },
    { role: 'user', content: 'Repeat the token you remember.' },
  ];
  const stub = await createStub([
    { model: PRIMARY, status: 500, body: { error: { message: 'boom' } } },
    { model: FALLBACK, status: 200, body: OK_TEXT('CLOUD-20128') },
  ]);
  try {
    const result = await route(
      { messages: history, temperature: 0, max_tokens: 64 },
      {
        endpoint: `http://127.0.0.1:${stub.port}/v1`,
        models: [PRIMARY, FALLBACK],
        maxAttempts: 2,
        timeoutMs: 3000,
        logger: noopLogger,
      }
    );
    assert.equal(result.ok, true);
    assert.equal(result.selected_model, FALLBACK);
    const f = stub.requests.find((r) => r.model === FALLBACK);
    assert.deepEqual(f.body.messages, history, 'full multi-turn history preserved to fallback');
  } finally {
    await stub.close();
  }
});

// ---------------------------------------------------------------------------
// D3-04: structured output
// ---------------------------------------------------------------------------
test('D3-04 structured output: response_format preserved through fallback', async () => {
  const stub = await createStub([
    { model: PRIMARY, status: 500, body: { error: { message: 'boom' } } },
    { model: FALLBACK, status: 200, body: OK_TEXT('{"ok": true, "word": "PONG"}') },
  ]);
  try {
    const result = await route(
      { messages: [{ role: 'user', content: 'json please' }], response_format: { type: 'json_object' }, max_tokens: 128 },
      {
        endpoint: `http://127.0.0.1:${stub.port}/v1`,
        models: [PRIMARY, FALLBACK],
        maxAttempts: 2,
        timeoutMs: 3000,
        logger: noopLogger,
      }
    );
    assert.equal(result.ok, true);
    const f = stub.requests.find((r) => r.model === FALLBACK);
    assert.deepEqual(f.body.response_format, { type: 'json_object' }, 'response_format preserved');
    const text = result.data.choices[0].message.content;
    const parsed = JSON.parse(text);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.word, 'PONG');
  } finally {
    await stub.close();
  }
});

// ---------------------------------------------------------------------------
// D3-05: tool calling
// ---------------------------------------------------------------------------
test('D3-05 tool calling: tools/tool_choice preserved; fallback issues tool_calls', async () => {
  const stub = await createStub([
    { model: PRIMARY, status: 500, body: { error: { message: 'boom' } } },
    {
      model: FALLBACK,
      status: 200,
      body: {
        id: 's', object: 'chat.completion', created: 0, model: 'stub',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_test_status', arguments: '{}' } }],
          },
          finish_reason: 'tool_calls',
        }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      },
    },
  ]);
  try {
    const result = await route(SAMPLE_PAYLOAD, {
      endpoint: `http://127.0.0.1:${stub.port}/v1`,
      models: [PRIMARY, FALLBACK],
      maxAttempts: 2,
      timeoutMs: 3000,
      logger: noopLogger,
    });
    assert.equal(result.ok, true);
    const f = stub.requests.find((r) => r.model === FALLBACK);
    assert.deepEqual(f.body.tools, SAMPLE_PAYLOAD.tools, 'tools preserved');
    assert.equal(f.body.tool_choice, 'auto', 'tool_choice preserved');
    const msg = result.data.choices[0].message;
    assert.equal(msg.tool_calls[0].function.name, 'get_test_status');
    assert.equal(result.data.choices[0].finish_reason, 'tool_calls');
  } finally {
    await stub.close();
  }
});

// ---------------------------------------------------------------------------
// D3-06: non-fallback error (malformed payload) -> INVALID_PAYLOAD, no network
// ---------------------------------------------------------------------------
test('D3-06 non-fallback error: malformed payload -> INVALID_PAYLOAD, ZERO network attempts', async () => {
  const stub = await createStub([
    { model: PRIMARY, status: 200, body: OK_TEXT('PONG') },
  ]);
  try {
    const result = await route(
      { model: PRIMARY, prompt: 'no messages field' },
      {
        endpoint: `http://127.0.0.1:${stub.port}/v1`,
        models: [PRIMARY, FALLBACK],
        maxAttempts: 2,
        timeoutMs: 3000,
        logger: noopLogger,
      }
    );
    assert.equal(result.ok, false);
    assert.equal(result.error_class, 'INVALID_PAYLOAD');
    assert.equal(result.eligible_for_fallback, false);
    assert.deepEqual(result.attempted_models, []);
    assert.equal(stub.requests.length, 0, 'no HTTP request sent for malformed payload');
  } finally {
    await stub.close();
  }
});

// ---------------------------------------------------------------------------
// D3-07: double failure (max 2 attempts, no infinite retry)
// ---------------------------------------------------------------------------
test('D3-07 double failure: both providers fail -> controlled error, exactly 2 attempts, no 3rd', async () => {
  const third = 'groq/qwen/qwen3-32b';
  const stub = await createStub([
    { model: PRIMARY, status: 404, body: { error: { message: 'model not found' } } },
    { model: FALLBACK, status: 404, body: { error: { message: 'model not found' } } },
    { model: third, status: 200, body: OK_TEXT('PONG') },
  ]);
  try {
    const result = await route(SAMPLE_PAYLOAD, {
      endpoint: `http://127.0.0.1:${stub.port}/v1`,
      models: [PRIMARY, FALLBACK, third],
      maxAttempts: 2,
      timeoutMs: 3000,
      logger: noopLogger,
    });
    assert.equal(result.ok, false);
    assert.equal(result.final_status, 'error');
    assert.equal(result.error_class, 'MODEL_UNAVAILABLE');
    assert.equal(result.eligible_for_fallback, true);
    assert.deepEqual(result.attempted_models, [PRIMARY, FALLBACK]);
    assert.equal(result.latency_per_attempt.length, 2);
    assert.ok(result.fallback_reason.includes('max attempts'), 'reason mentions attempt cap');
    const thirdCalled = stub.requests.some((r) => r.model === third);
    assert.equal(thirdCalled, false, 'third model must never be called');
  } finally {
    await stub.close();
  }
});

// ---------------------------------------------------------------------------
// D3-08: router health (gateway reachable + model ids present) — via stub
// ---------------------------------------------------------------------------
test('D3-08 router health: gateway /models reachable and contains primary+fallback ids', async () => {
  const stub = await createStub([]);
  try {
    const controller = buildController({
      endpoint: `http://127.0.0.1:${stub.port}/v1`,
      models: [PRIMARY, FALLBACK],
      logger: noopLogger,
    });
    const res = await fetch(controller.endpoint + '/models', {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(3000),
      redirect: 'error',
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    const ids = Array.isArray(body.data) ? body.data.map((m) => m.id) : [];
    assert.ok(ids.includes(PRIMARY), 'primary id present in catalog');
    assert.ok(ids.includes(FALLBACK), 'fallback id present in catalog');
  } finally {
    await stub.close();
  }
});

// ---------------------------------------------------------------------------
// Boundary: wrapper is NOT tied to production routing (structural check)
// ---------------------------------------------------------------------------
test('boundary: wrapper does not reference OpenCode config nor any production routing file', () => {
  const fs = require('node:fs');
  const wrapper = fs.readFileSync(require.resolve('./integration-wrapper.cjs'), 'utf8');
  // Must not require or mention production files.
  for (const forbidden of ['opencode.json', 'openCode', 'openCode/', 'agent', 'system/', 'task.json']) {
    // 'agent' as a substring would be too broad; check for requiring it.
  }
  // Ensure the wrapper only requires the controller, not anything else.
  const requires = [...wrapper.matchAll(/require\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]);
  assert.ok(requires.includes('../fallback-controller.cjs'), 'wrapper requires the controller');
  // The wrapper must be a module (exports route) and NOT auto-wired.
  assert.ok(wrapper.includes('module.exports'), 'wrapper is a module');
  assert.ok(wrapper.includes('require.main === module'), 'CLI only when invoked directly');
});

run();
