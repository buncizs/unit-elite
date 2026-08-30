'use strict';
/**
 * test-fallback-controller.js
 * ============================================================================
 * Self-contained unit tests for the Unit Elite fallback controller
 * (TECH-0001-D2). Uses a local stub HTTP server — NO real provider is called
 * and NO API key is required.
 *
 * Run:  node test-fallback-controller.js
 * Exits 0 when all tests pass, 1 otherwise.
 * ============================================================================
 */

const http = require('node:http');
const assert = require('node:assert/strict');
const {
  FallbackController,
  classifyError,
  buildAttemptPayload,
  validatePayload,
  sanitizeCompletion,
  DEFAULT_MODELS,
} = require('./fallback-controller.cjs');

const PRIMARY = DEFAULT_MODELS[0]; // groq/openai/gpt-oss-120b
const FALLBACK = DEFAULT_MODELS[1]; // gemini/gemini-3.5-flash-lite

// ---------------------------------------------------------------------------
// Tiny test runner
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
// Stub HTTP server for OpenAI-compatible /chat/completions
// ---------------------------------------------------------------------------
/**
 * createStub(scenarios)
 *  scenarios: array of { model, status, body, delayMs }
 *  -> { server, port, requests, close() }
 * requests entries: { model, body, headers, url }
 */
function createStub(scenarios) {
  const requests = [];
  const server = http.createServer((req, res) => {
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
      requests.push({ model, body, headers: req.headers, url: req.url });
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
        } catch {
          /* client may have aborted (timeout tests) */
        }
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

const OK_RESPONSE = {
  id: 'stub-ok',
  object: 'chat.completion',
  created: 0,
  model: 'stub',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'ok' },
      finish_reason: 'stop',
    },
  ],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
};

const SAMPLE_PAYLOAD = {
  messages: [
    { role: 'system', content: 'You are a test assistant.' },
    { role: 'user', content: 'Hello, please respond with exactly: OK' },
  ],
  temperature: 0.2,
  max_tokens: 16,
  tools: [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get current weather',
        parameters: { type: 'object', properties: { city: { type: 'string' } } },
      },
    },
  ],
  tool_choice: 'auto',
  response_format: { type: 'json_object' },
  x_custom_extra: 'must-be-preserved',
};

function noopLogger() {}

// ---------------------------------------------------------------------------
// 1. Error classification table
// ---------------------------------------------------------------------------
test('classifyError: full classification table', () => {
  const cases = [
    // [input, expectedClass, expectedEligible]
    [{ httpStatus: null, timedOut: true, networkError: true }, 'TIMEOUT', true],
    [{ httpStatus: null, code: 'ETIMEDOUT', networkError: true }, 'TIMEOUT', true],
    [{ httpStatus: null, code: 'ABORT_ERR', networkError: true }, 'TIMEOUT', true],
    [{ httpStatus: null, code: 'ECONNREFUSED', networkError: true }, 'CONNECTION_FAILURE', true],
    [{ httpStatus: null, code: 'ECONNRESET', networkError: true }, 'CONNECTION_FAILURE', true],
    [{ httpStatus: null, code: 'ENOTFOUND', networkError: true }, 'CONNECTION_FAILURE', true],
    [{ httpStatus: null, code: 'UND_ERR_SOCKET', networkError: true }, 'CONNECTION_FAILURE', true],
    [{ httpStatus: null, code: null, networkError: true, message: 'socket hang up' }, 'PROVIDER_UNAVAILABLE', true],
    [{ httpStatus: 401, body: { error: { message: 'Missing API key' } } }, 'AUTH_FAILURE', false],
    [{ httpStatus: 401, body: { error: { message: 'invalid key' } } }, 'AUTH_FAILURE', false],
    [{ httpStatus: 403, body: { error: { message: 'forbidden' } } }, 'POLICY_REJECTION', false],
    [{ httpStatus: 404, body: { error: { message: 'model not found' } } }, 'MODEL_UNAVAILABLE', true],
    [{ httpStatus: 400, body: { error: { message: 'The model `x` does not exist' } } }, 'MODEL_UNAVAILABLE', true],
    [{ httpStatus: 400, body: { error: { code: 'model_not_found' } } }, 'MODEL_UNAVAILABLE', true],
    [{ httpStatus: 422, body: { error: { message: 'Unknown model: y' } } }, 'MODEL_UNAVAILABLE', true],
    [{ httpStatus: 400, body: { error: { message: 'malformed json body' } } }, 'INVALID_PAYLOAD', false],
    [{ httpStatus: 422, body: { error: { message: 'messages: field required' } } }, 'INVALID_PAYLOAD', false],
    [{ httpStatus: 400, body: { error: { message: 'content policy violation' } } }, 'POLICY_REJECTION', false],
    [{ httpStatus: 429, body: { error: { message: 'rate limit exceeded' } } }, 'RATE_LIMIT', true],
    [{ httpStatus: 500, body: { error: { message: 'server error' } } }, 'HTTP_5XX', true],
    [{ httpStatus: 503, body: { error: { message: 'service unavailable' } } }, 'HTTP_5XX', true],
    [{ httpStatus: 418, body: { error: { message: "i'm a teapot" } } }, 'UNKNOWN', false],
    [{ httpStatus: 400, body: { error: { message: 'provider unavailable' } } }, 'PROVIDER_UNAVAILABLE', true],
    [{ httpStatus: 409, body: { error: { message: 'no available provider' } } }, 'PROVIDER_UNAVAILABLE', true],
    [{ httpStatus: 200, body: { error: { message: 'no provider route' } } }, 'PROVIDER_UNAVAILABLE', true],
    [{ httpStatus: 302, body: { error: { message: 'redirect' } } }, 'UNKNOWN', false],
  ];
  for (const [input, cls, eligible] of cases) {
    const out = classifyError(input);
    assert.equal(out.error_class, cls, `classify ${JSON.stringify(input)} -> ${out.error_class}, expected ${cls}`);
    assert.equal(out.eligible, eligible, `eligible for ${cls}`);
  }
});

// ---------------------------------------------------------------------------
// 2. Eligible failure -> fallback occurs, payload + tools preserved
// ---------------------------------------------------------------------------
test('eligible 5xx -> fallback occurs; payload/tools/tool_choice/response_format preserved', async () => {
  const stub = await createStub([
    { model: PRIMARY, status: 500, body: { error: { message: 'boom' } } },
    { model: FALLBACK, status: 200, body: OK_RESPONSE },
  ]);
  try {
    const controller = new FallbackController({
      endpoint: `http://127.0.0.1:${stub.port}/v1`,
      models: [PRIMARY, FALLBACK],
      timeoutMs: 3000,
      logger: noopLogger,
    });
    const result = await controller.complete(SAMPLE_PAYLOAD);

    assert.equal(result.ok, true);
    assert.equal(result.final_status, 'ok');
    assert.equal(result.selected_model, FALLBACK);
    assert.deepEqual(result.attempted_models, [PRIMARY, FALLBACK]);
    assert.equal(result.latency_per_attempt.length, 2);
    assert.equal(result.last_error_class, 'HTTP_5XX');

    // Two HTTP requests hit the gateway: primary + fallback.
    assert.equal(stub.requests.length, 2);
    const primaryReq = stub.requests.find((r) => r.model === PRIMARY);
    const fallbackReq = stub.requests.find((r) => r.model === FALLBACK);
    assert.ok(primaryReq, 'primary request recorded');
    assert.ok(fallbackReq, 'fallback request recorded');

    // Preservation: everything except `model` must be identical.
    assert.equal(primaryReq.body.model, PRIMARY);
    assert.equal(fallbackReq.body.model, FALLBACK);
    const { model: _p, ...primaryRest } = primaryReq.body;
    const { model: _f, ...fallbackRest } = fallbackReq.body;
    assert.deepEqual(primaryRest, fallbackRest, 'payload identical across attempts (except model)');
    assert.deepEqual(fallbackRest.messages, SAMPLE_PAYLOAD.messages, 'messages preserved');
    assert.deepEqual(fallbackRest.tools, SAMPLE_PAYLOAD.tools, 'tools preserved');
    assert.deepEqual(fallbackRest.tool_choice, SAMPLE_PAYLOAD.tool_choice, 'tool_choice preserved');
    assert.deepEqual(fallbackRest.response_format, SAMPLE_PAYLOAD.response_format, 'response_format preserved');
    assert.equal(fallbackRest.temperature, SAMPLE_PAYLOAD.temperature, 'temperature preserved');
    assert.equal(fallbackRest.x_custom_extra, SAMPLE_PAYLOAD.x_custom_extra, 'extra field preserved');
  } finally {
    await stub.close();
  }
});

// ---------------------------------------------------------------------------
// 3. AUTH_FAILURE (401) -> NO fallback
// ---------------------------------------------------------------------------
test('AUTH_FAILURE 401 -> no fallback, single attempt', async () => {
  const stub = await createStub([
    { model: PRIMARY, status: 401, body: { error: { message: 'Missing API key' } } },
    { model: FALLBACK, status: 200, body: OK_RESPONSE },
  ]);
  try {
    const controller = new FallbackController({
      endpoint: `http://127.0.0.1:${stub.port}/v1`,
      models: [PRIMARY, FALLBACK],
      timeoutMs: 3000,
      logger: noopLogger,
    });
    const result = await controller.complete(SAMPLE_PAYLOAD);

    assert.equal(result.ok, false);
    assert.equal(result.final_status, 'error');
    assert.equal(result.error_class, 'AUTH_FAILURE');
    assert.equal(result.eligible_for_fallback, false);
    assert.deepEqual(result.attempted_models, [PRIMARY]);
    assert.equal(result.latency_per_attempt.length, 1);
    assert.equal(stub.requests.length, 1, 'only one provider attempt');
  } finally {
    await stub.close();
  }
});

// ---------------------------------------------------------------------------
// 4. INVALID_PAYLOAD 400 -> NO fallback
// ---------------------------------------------------------------------------
test('INVALID_PAYLOAD 400 -> no fallback, single attempt', async () => {
  const stub = await createStub([
    { model: PRIMARY, status: 400, body: { error: { message: 'malformed json body' } } },
    { model: FALLBACK, status: 200, body: OK_RESPONSE },
  ]);
  try {
    const controller = new FallbackController({
      endpoint: `http://127.0.0.1:${stub.port}/v1`,
      models: [PRIMARY, FALLBACK],
      timeoutMs: 3000,
      logger: noopLogger,
    });
    const result = await controller.complete(SAMPLE_PAYLOAD);

    assert.equal(result.ok, false);
    assert.equal(result.error_class, 'INVALID_PAYLOAD');
    assert.equal(result.eligible_for_fallback, false);
    assert.deepEqual(result.attempted_models, [PRIMARY]);
    assert.equal(stub.requests.length, 1);
  } finally {
    await stub.close();
  }
});

// ---------------------------------------------------------------------------
// 5. Malformed request payload -> rejected locally, NO network at all
// ---------------------------------------------------------------------------
test('malformed payload (no messages) -> INVALID_PAYLOAD, zero network attempts', async () => {
  const stub = await createStub([
    { model: PRIMARY, status: 200, body: OK_RESPONSE },
  ]);
  try {
    const controller = new FallbackController({
      endpoint: `http://127.0.0.1:${stub.port}/v1`,
      models: [PRIMARY, FALLBACK],
      timeoutMs: 3000,
      logger: noopLogger,
    });
    const result = await controller.complete({ model: PRIMARY, prompt: 'not openai shape' });

    assert.equal(result.ok, false);
    assert.equal(result.error_class, 'INVALID_PAYLOAD');
    assert.equal(result.eligible_for_fallback, false);
    assert.equal(result.attempted_models.length, 0);
    assert.equal(stub.requests.length, 0, 'no HTTP request sent for malformed payload');
  } finally {
    await stub.close();
  }
});

// ---------------------------------------------------------------------------
// 6. Timeout -> eligible fallback
// ---------------------------------------------------------------------------
test('per-attempt TIMEOUT -> fallback occurs; latency of first attempt recorded', async () => {
  const stub = await createStub([
    { model: PRIMARY, status: 200, body: OK_RESPONSE, delayMs: 5000 }, // slower than client timeout
    { model: FALLBACK, status: 200, body: OK_RESPONSE, delayMs: 0 },
  ]);
  const logs = [];
  try {
    const controller = new FallbackController({
      endpoint: `http://127.0.0.1:${stub.port}/v1`,
      models: [PRIMARY, FALLBACK],
      timeoutMs: 120, // force abort on primary
      logger: (line) => logs.push(line),
    });
    const started = Date.now();
    const result = await controller.complete(SAMPLE_PAYLOAD);
    const elapsed = Date.now() - started;

    assert.equal(result.ok, true);
    assert.equal(result.selected_model, FALLBACK);
    assert.equal(result.last_error_class, 'TIMEOUT');
    assert.deepEqual(result.attempted_models, [PRIMARY, FALLBACK]);
    assert.ok(elapsed < 5000, `timed out attempt must not wait for stub delay (elapsed=${elapsed}ms)`);
    assert.equal(stub.requests.length, 2);

    const finalLog = JSON.parse(logs[logs.length - 1]);
    assert.ok(finalLog.fallback_reason.includes('TIMEOUT'), 'fallback_reason mentions TIMEOUT');
    assert.equal(finalLog.final_status, 'ok');
  } finally {
    await stub.close();
  }
});

// ---------------------------------------------------------------------------
// 7. RATE_LIMIT 429 -> eligible fallback
// ---------------------------------------------------------------------------
test('RATE_LIMIT 429 -> fallback occurs', async () => {
  const stub = await createStub([
    { model: PRIMARY, status: 429, body: { error: { message: 'rate limit exceeded' } } },
    { model: FALLBACK, status: 200, body: OK_RESPONSE },
  ]);
  try {
    const controller = new FallbackController({
      endpoint: `http://127.0.0.1:${stub.port}/v1`,
      models: [PRIMARY, FALLBACK],
      timeoutMs: 3000,
      logger: noopLogger,
    });
    const result = await controller.complete(SAMPLE_PAYLOAD);
    assert.equal(result.ok, true);
    assert.equal(result.selected_model, FALLBACK);
    assert.equal(result.last_error_class, 'RATE_LIMIT');
    assert.equal(stub.requests.length, 2);
  } finally {
    await stub.close();
  }
});

// ---------------------------------------------------------------------------
// 8. Both attempts fail -> controlled failure, both latencies recorded
// ---------------------------------------------------------------------------
test('both attempts fail -> controlled error, 2 attempts, error_class recorded', async () => {
  const stub = await createStub([
    { model: PRIMARY, status: 500, body: { error: { message: 'boom' } } },
    { model: FALLBACK, status: 502, body: { error: { message: 'bad gateway' } } },
  ]);
  try {
    const controller = new FallbackController({
      endpoint: `http://127.0.0.1:${stub.port}/v1`,
      models: [PRIMARY, FALLBACK],
      timeoutMs: 3000,
      logger: noopLogger,
    });
    const result = await controller.complete(SAMPLE_PAYLOAD);

    assert.equal(result.ok, false);
    assert.equal(result.final_status, 'error');
    assert.equal(result.error_class, 'HTTP_5XX');
    assert.equal(result.eligible_for_fallback, true);
    assert.deepEqual(result.attempted_models, [PRIMARY, FALLBACK]);
    assert.equal(result.latency_per_attempt.length, 2);
    assert.ok(result.fallback_reason.includes('max attempts'), 'reason mentions attempt cap');
  } finally {
    await stub.close();
  }
});

// ---------------------------------------------------------------------------
// 9. Max attempts capped (never call 3rd model)
// ---------------------------------------------------------------------------
test('maxAttempts=2 -> third model never called', async () => {
  const third = 'groq/qwen/qwen3-32b';
  const stub = await createStub([
    { model: PRIMARY, status: 500, body: { error: { message: 'boom' } } },
    { model: FALLBACK, status: 502, body: { error: { message: 'bad gateway' } } },
    { model: third, status: 200, body: OK_RESPONSE },
  ]);
  try {
    const controller = new FallbackController({
      endpoint: `http://127.0.0.1:${stub.port}/v1`,
      models: [PRIMARY, FALLBACK, third],
      maxAttempts: 2,
      timeoutMs: 3000,
      logger: noopLogger,
    });
    const result = await controller.complete(SAMPLE_PAYLOAD);

    assert.equal(result.ok, false);
    assert.deepEqual(result.attempted_models, [PRIMARY, FALLBACK]);
    const thirdCalled = stub.requests.some((r) => r.model === third);
    assert.equal(thirdCalled, false, 'third model must not be called');
  } finally {
    await stub.close();
  }
});

// ---------------------------------------------------------------------------
// 10. UNKNOWN -> no fallback
// ---------------------------------------------------------------------------
test('UNKNOWN error (418) -> no fallback', async () => {
  const stub = await createStub([
    { model: PRIMARY, status: 418, body: { error: { message: "i'm a teapot" } } },
    { model: FALLBACK, status: 200, body: OK_RESPONSE },
  ]);
  try {
    const controller = new FallbackController({
      endpoint: `http://127.0.0.1:${stub.port}/v1`,
      models: [PRIMARY, FALLBACK],
      timeoutMs: 3000,
      logger: noopLogger,
    });
    const result = await controller.complete(SAMPLE_PAYLOAD);

    assert.equal(result.ok, false);
    assert.equal(result.error_class, 'UNKNOWN');
    assert.equal(result.eligible_for_fallback, false);
    assert.deepEqual(result.attempted_models, [PRIMARY]);
    assert.equal(stub.requests.length, 1);
  } finally {
    await stub.close();
  }
});

// ---------------------------------------------------------------------------
// 11. API key never leaks into logs
// ---------------------------------------------------------------------------
test('API key is never written to logs', async () => {
  const SECRET = 'sk-test-secret-12345-abcdef';
  const stub = await createStub([
    { model: PRIMARY, status: 500, body: { error: { message: 'boom' } } },
    { model: FALLBACK, status: 200, body: OK_RESPONSE },
  ]);
  const logs = [];
  try {
    const controller = new FallbackController({
      endpoint: `http://127.0.0.1:${stub.port}/v1`,
      models: [PRIMARY, FALLBACK],
      apiKey: SECRET,
      timeoutMs: 3000,
      logger: (line) => logs.push(line),
    });
    const result = await controller.complete(SAMPLE_PAYLOAD);
    assert.equal(result.ok, true);

    assert.ok(logs.length > 0, 'logger produced lines');
    for (const line of logs) {
      assert.ok(!line.includes(SECRET), 'log line must not contain the api key');
      assert.ok(!/authorization/i.test(line), 'log line must not contain auth headers');
      assert.ok(!/bearer/i.test(line), 'log line must not contain bearer prefix');
    }
  } finally {
    await stub.close();
  }
});

// ---------------------------------------------------------------------------
// 12. Reasoning fields stripped from returned data
// ---------------------------------------------------------------------------
test('sanitizeCompletion strips reasoning fields, keeps final content + tool_calls', () => {
  const raw = {
    id: 'x',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: 'final answer',
          reasoning_content: 'internal chain of thought (secret)',
          reasoning: 'more internal reasoning',
        },
        finish_reason: 'tool_calls',
      },
      {
        index: 1,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Surabaya"}' } }],
          thinking: 'should not appear',
        },
        finish_reason: 'stop',
      },
    ],
  };
  const out = sanitizeCompletion(raw);

  assert.equal(out.choices[0].message.content, 'final answer');
  assert.equal(out.choices[0].message.reasoning_content, undefined, 'reasoning_content stripped');
  assert.equal(out.choices[0].message.reasoning, undefined, 'reasoning stripped');
  assert.deepEqual(
    out.choices[1].message.tool_calls,
    [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Surabaya"}' } }],
    'tool_calls preserved'
  );
  assert.equal(out.choices[1].message.thinking, undefined, 'thinking stripped');
});

// ---------------------------------------------------------------------------
// 13. buildAttemptPayload preserves everything except model
// ---------------------------------------------------------------------------
test('buildAttemptPayload replaces only `model`', () => {
  const payload = { ...SAMPLE_PAYLOAD, model: PRIMARY };
  const out = buildAttemptPayload(payload, FALLBACK);
  assert.equal(out.model, FALLBACK);
  assert.equal(out.messages, payload.messages, 'messages reference preserved');
  assert.equal(out.tools, payload.tools);
  assert.equal(out.tool_choice, payload.tool_choice);
  assert.equal(out.response_format, payload.response_format);
  assert.ok('x_custom_extra' in out);
  // No mutation of the original payload object.
  assert.equal(payload.model, PRIMARY);
});

// ---------------------------------------------------------------------------
// 14. CONNECTION_FAILURE -> eligible fallback (gateway port refused)
// ---------------------------------------------------------------------------
test('CONNECTION_FAILURE (refused port) -> eligible, both attempts exhausted correctly', async () => {
  // Reserve a port then close it so nothing listens there.
  const dead = await createStub([]);
  const deadPort = dead.port;
  await dead.close();
  const controller = new FallbackController({
    endpoint: `http://127.0.0.1:${deadPort}/v1`, // nothing listening -> connection failure
    models: [PRIMARY, FALLBACK],
    timeoutMs: 1500,
    logger: noopLogger,
  });
  const result = await controller.complete(SAMPLE_PAYLOAD);
  assert.equal(result.ok, false);
  assert.ok(
    result.error_class === 'CONNECTION_FAILURE' || result.error_class === 'PROVIDER_UNAVAILABLE',
    `expected CONNECTION_FAILURE/PROVIDER_UNAVAILABLE, got ${result.error_class}`
  );
  assert.equal(result.eligible_for_fallback, true);
  assert.deepEqual(result.attempted_models, [PRIMARY, FALLBACK], 'tried both models against dead gateway');
});

// ---------------------------------------------------------------------------
// 15. Logging contract: required fields present, no payload content logged
// ---------------------------------------------------------------------------
test('log record contains required fields only (no secrets, no payload content)', async () => {
  const stub = await createStub([
    { model: PRIMARY, status: 429, body: { error: { message: 'rate limited' } } },
    { model: FALLBACK, status: 200, body: OK_RESPONSE },
  ]);
  const logs = [];
  try {
    const controller = new FallbackController({
      endpoint: `http://127.0.0.1:${stub.port}/v1`,
      models: [PRIMARY, FALLBACK],
      timeoutMs: 3000,
      logger: (line) => logs.push(line),
    });
    await controller.complete(SAMPLE_PAYLOAD);
    assert.ok(logs.length >= 1);
    const rec = JSON.parse(logs[logs.length - 1]);
    for (const field of [
      'request_id',
      'primary_model',
      'attempted_models',
      'error_class',
      'fallback_reason',
      'selected_model',
      'latency_per_attempt',
      'final_status',
    ]) {
      assert.ok(field in rec, `log record must contain ${field}`);
    }
    assert.equal(rec.final_status, 'ok');
    assert.equal(rec.selected_model, FALLBACK);
    assert.equal(rec.error_class, null);
    const serialized = JSON.stringify(rec);
    assert.ok(!serialized.includes('Hello, please respond'), 'messages content must not be logged');
    assert.ok(!serialized.includes('get_weather'), 'tools must not be logged');
  } finally {
    await stub.close();
  }
});

// ---------------------------------------------------------------------------
// 16. validatePayload
// ---------------------------------------------------------------------------
test('validatePayload accepts valid and rejects invalid shapes', () => {
  assert.equal(validatePayload(SAMPLE_PAYLOAD).ok, true);
  assert.equal(validatePayload({ messages: [] }).ok, false);
  assert.equal(validatePayload({}).ok, false);
  assert.equal(validatePayload({ messages: [{ content: 'no role' }] }).ok, false);
  assert.equal(validatePayload({ messages: [{ role: 'user', content: 'hi' }] }).ok, true);
  assert.equal(validatePayload({ messages: [{ role: 'user', content: ['ok'] }] }).ok, true);
});

// ---------------------------------------------------------------------------
run();