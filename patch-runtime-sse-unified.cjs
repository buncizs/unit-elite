const fs = require('fs');
const path = require('path');

const target = path.resolve('integrations','9router','runtime','runtime-gateway.cjs');

if (!fs.existsSync(target)) {
  console.error('RUNTIME_SOURCE_NOT_FOUND:', target);
  process.exit(1);
}

let text = fs.readFileSync(target, 'utf8');

const startNeedle = 'async function streamFromProvider(';
const nextNeedle = 'async function handleChatStream(';

const start = text.indexOf(startNeedle);
const next = text.indexOf(nextNeedle, start + startNeedle.length);

if (start < 0 || next < 0) {
  console.error('STREAM_FUNCTION_ANCHOR_NOT_FOUND');
  process.exit(1);
}

const backup = target + '.pre-sse-unified.bak';
if (!fs.existsSync(backup)) fs.copyFileSync(target, backup);

const replacement = `async function streamFromProvider(payload, model, endpoint, apiKey, clientRes, requestId) {
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
      if (line.endsWith('\\r')) line = line.slice(0, -1);

      if (line.trim() === 'data: [DONE]') {
        upstreamDoneCount += 1;
        return;
      }

      if (line.startsWith('data: ')) forwardedDataLines += 1;

      if (clientWritable()) {
        clientRes.write(line + (withNewline ? '\\n' : ''));
      }
    }

    function consumeText(textChunk) {
      if (!textChunk) return;
      pending += textChunk;

      let newlineIndex;
      while ((newlineIndex = pending.indexOf('\\n')) !== -1) {
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
      clientRes.write('data: [DONE]\\n\\n');
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

`;

text = text.slice(0, start) + replacement + text.slice(next);
fs.writeFileSync(target, text, 'utf8');

console.log('SSE_UNIFIED_CANONICALIZER_PATCHED');
console.log('BACKUP=' + backup);
console.log('EXPECTED_BEHAVIOR=');
console.log('  Groq duplicate [DONE] -> downstream exactly one [DONE]');
console.log('  Sonnet no [DONE]       -> downstream exactly one [DONE]');
console.log('  All non-[DONE] data lines are preserved');
console.log('NEXT=node --check integrations\\\\9router\\\\runtime\\\\runtime-gateway.cjs');
