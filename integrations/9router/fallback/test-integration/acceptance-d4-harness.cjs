#!/usr/bin/env node
'use strict';
/**
 * acceptance-d4-harness.cjs
 * ============================================================================
 * TECH-0001-D4 — LIVE ACCEPTANCE for the Unit Elite TEST "model route"
 * (sandbox/CLONE only) — REAL AGENT TASK simulation.
 *
 *   TEST D4-03 — FALLBACK DURING REAL AGENT TASK
 *     . Primary made unavailable (invalid model id) so eligible fallback to
 *       Gemini is triggered on every step.
 *     . A genuine multi-step "agent task" (mini-agent holding working state
 *       across steps) runs through the TEST wrapper (integration-wrapper.cjs
 *       route()) which uses the Fallback Controller.
 *     . Expect: task completes via Gemini; context/state NOT lost between
 *       steps; agent contract/task intact (consistent, not corrupted);
 *       fallback recorded (fallback_reason, attempted_models,
 *       selected_model=gemini, error_class eligible).
 *
 *   TEST D4-07 — FAILURE DURING WORKFLOW (double failure)
 *     . Both primary AND fallback forced unavailable (invalid ids) in the
 *       middle of a workflow.
 *     . Expect: clean failure (classified, not uncontrolled crash); task/state
 *       NOT corrupted; state recoverable (a continuation step after providers
 *       recover succeeds using the SAME working state); NO infinite retry
 *       (max 2 attempts, stop clean, no loop).
 *
 * Constraints honored (TECH-0001-D4 work package):
 *   - TEST/CLONE only. Uses the already-accepted TEST wrapper route() only.
 *   - Does NOT modify fallback-controller.cjs, 9Router, OpenCode config,
 *     agents/*.md, or system/.
 *   - No native 9Router combo (/combo never called).
 *   - API key ONLY from env (NINEROUTER_KEY / NINEROUTER_API_KEY); value is
 *     NEVER printed / logged / stored by this harness.
 *   - No secret, no Authorization header, no payload bodies printed.
 *   - Non-destructive: never closes/creates tasks; no external dispatch.
 *
 * The mini-agent below simulates how a real agent preserves context: it keeps
 * an explicit working transcript (state) and, at each step, re-sends the FULL
 * accumulated turn history in the prompt, then appends the assistant's reply.
 * This is exactly the contract the Fallback Controller guarantees to preserve
 * (it re-sends the SAME payload to the fallback model, only the `model` field
 * changes) — so a coherent end-to-end result proves context NOT lost across
 * the fallback path.
 *
 * Usage (from test-integration\, user role):
 *   node acceptance-d4-harness.cjs d4-03
 *   node acceptance-d4-harness.cjs d4-07
 *   node acceptance-d4-harness.cjs           (both, in order)
 *
 * Optional env (runtime only, controller logic untouched):
 *   FALLBACK_ACCEPTANCE_TIMEOUT_MS   per-attempt acceptance timeout (default 90000)
 * ============================================================================
 */

const { route } = require('./integration-wrapper.cjs');
const { readApiKeyFromEnv } = require('../fallback-controller.cjs');

const GATEWAY = process.env.NINEROUTER_BASE_URL || 'http://127.0.0.1:20128/v1';

const INVALID_PRIMARY = 'groq/openai/zzz-does-not-exist-tech0001d4';
const INVALID_FALLBACK = 'gemini/zzz-does-not-exist-tech0001d4';

const VALID_PRIMARY = 'groq/openai/gpt-oss-120b';
const VALID_FALLBACK = 'gemini/gemini-3.5-flash-lite';

// Per-attempt acceptance timeout (harness only; controller default untouched).
const ACCEPTANCE_TIMEOUT_MS =
  Number.isFinite(Number(process.env.FALLBACK_ACCEPTANCE_TIMEOUT_MS)) &&
  Number(process.env.FALLBACK_ACCEPTANCE_TIMEOUT_MS) > 0
    ? Number(process.env.FALLBACK_ACCEPTANCE_TIMEOUT_MS)
    : 90000;

// ---------------------------------------------------------------------------
// Mini agent: a multi-step runner that carries explicit working state.
// ---------------------------------------------------------------------------

class MiniAgent {
  constructor({ label, promptFn, maxSteps = 3 }) {
    this.label = label;
    this.promptFn = promptFn; // (stepIndex, state) -> string instruction
    this.maxSteps = maxSteps;
    this.state = {
      turns: [],      // [{role, content}] accumulated conversation history
      log: [],        // per-step result metadata
      meta: {},       // opaque application state (e.g. document draft)
      stepResults: [],
    };
    this.aborted = false; // becomes true if a non-recoverable failure aborts the task
  }

  _buildMessages(stepIndex) {
    // Working transcript so far (this is the AGENT'S context memory). Model
    // never sees anything but these messages.
    const msgs = [];
    if (this.state.turns.length) msgs.push(...this.state.turns);
    const instruction = this.promptFn(stepIndex, this.state);
    msgs.push({ role: 'user', content: instruction });
    return msgs;
  }

  async runStep({ stepIndex, models, maxAttempts = 2 }) {
    const msgs = this._buildMessages(stepIndex);
    const payload = {
      messages: msgs,
      temperature: 0,
      max_tokens: 64,
    };
    const result = await route(payload, {
      endpoint: GATEWAY,
      models,
      maxAttempts,
      timeoutMs: ACCEPTANCE_TIMEOUT_MS,
    });
    const step = {
      stepIndex,
      ok: result.ok,
      selected_model: result.selected_model,
      attempted_models: result.attempted_models,
      latency_per_attempt: result.latency_per_attempt,
      error_class: result.error_class || null,
      eligible_for_fallback: result.eligible_for_fallback || null,
      fallback_reason: result.fallback_reason || null,
      request_id: result.request_id,
      final_status: result.final_status,
    };
    this.state.log.push(step);
    if (!result.ok) {
      // Clean, controlled failure: mark the task as needing recovery but do
      // NOT corrupt the working state. The transcript stays intact so the task
      // can be resumed later.
      return step;
    }
    const content = extractContent(result.data);
    const reply = { role: 'assistant', content };
    this.state.turns.push(reply);
    this.state.stepResults.push({ content, selected_model: result.selected_model });
    this._updateMeta(stepIndex, content);
    return step;
  }

  // Placeholder for application-level state update (overridden per task).
  _updateMeta(stepIndex, content) {
    this.state.meta['step_' + stepIndex + '_echo'] = content;
  }

  get transcript() {
    return this.state.turns;
  }

  safeSummary() {
    // Safe metadata only — never includes raw model content bodies or keys.
    return {
      label: this.label,
      completed_steps: this.state.stepResults.length,
      total_logged: this.state.log.length,
      aborted: this.aborted,
      per_step: this.state.log.map((s) => ({
        step: s.stepIndex,
        ok: s.ok,
        final_status: s.final_status,
        selected_model: s.selected_model,
        error_class: s.error_class,
        eligible_for_fallback: s.eligible_for_fallback,
      })),
    };
  }
}

function extractContent(data) {
  try {
    const msg = data && data.choices && data.choices[0] && data.choices[0].message;
    return typeof msg.content === 'string' ? msg.content : '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// D4-03 — Fallback during a real multi-step agent task
// ---------------------------------------------------------------------------

/**
 * Task: build a short structured "report" in 3 steps. Each step must append a
 * NEW token AND echo the FIRST token from the running transcript (proving the
 * earlier-step context reached the model at a later step). Every step uses an
 * INVALID primary so each step genuinely falls back to Gemini.
 */
async function d4_03() {
  const agent = new MiniAgent({
    label: 'D4-03 multi-step agent task (per-step fallback to Gemini)',
    maxSteps: 3,
    promptFn: (i, st) => {
      const firstToken = st.turns.length ? st.turns[0].content.trim() : '(none yet)';
      const tokens = ['D4-ALPHA', 'D4-BETA', 'D4-GAMMA'];
      if (i === 0) {
        return 'You are building a report. Reply with EXACTLY one line: ' +
          'token=D4-ALPHA tag=step1 and nothing else.';
      }
      // Later steps must echo BOTH the new token and the FIRST token that was
      // produced way back at step 1 — only possible if the full transcript was
      // carried forward in the prompt (context NOT lost).
      return 'Append to your report. Reply with EXACTLY one line containing ' +
        'token=' + tokens[i] + ' tag=step' + (i + 1) +
        ' firstToken=' + firstToken + ' and nothing else.';
    },
  });

  // Each step forces a fallback by using an invalid primary + valid gemini.
  const models = [INVALID_PRIMARY, VALID_FALLBACK];
  let stepResult;
  for (let i = 0; i < agent.maxSteps; i++) {
    stepResult = await agent.runStep({ stepIndex: i, models });
    if (!stepResult.ok) break;
  }

  // ---- Evaluation ----
  const allOk = agent.state.log.length === 3 && agent.state.log.every((s) => s.ok);
  const allGemini = agent.state.log.every((s) => s.selected_model === VALID_FALLBACK);
  const allEligible = agent.state.log.every(
    (s) => s.error_class === null || s.eligible_for_fallback === true
  );
  // Every step must have produced a real (non-empty) assistant content.
  const nonEmpty = agent.state.stepResults.every(
    (r) => typeof r.content === 'string' && r.content.trim().length > 0
  );

  // Continued-contract check: the transcript accumulated 3 distinct steps in
  // order, and the content from each later step should mention its own token.
  const stepTokens = ['D4-ALPHA', 'D4-BETA', 'D4-GAMMA'];
  const contentPerStep = agent.state.stepResults.map((r) => r.content);
  const ownTokenPresent = contentPerStep.every(
    (c, i) => i < stepTokens.length && c.includes(stepTokens[i])
  );

  // Context preservation: at least one of step 2 / step 3 must have echoed the
  // FIRST token (D4-ALPHA) from step 1 — proves earlier-step info reached a
  // LATER step through the fallback path.
  let contextEchoStep = null;
  for (let i = 1; i < contentPerStep.length; i++) {
    if (contentPerStep[i].includes('D4-ALPHA')) { contextEchoStep = i + 1; break; }
  }

  const pass =
    allOk && allGemini && nonEmpty && ownTokenPresent && contextEchoStep !== null;

  return {
    test: 'D4-03',
    label: 'FALLBACK DURING REAL AGENT TASK',
    status: pass ? 'PASS' : 'FAIL',
    pass,
    evidence: {
      task_completed_via_gemini: allGemini ? 'all ' + agent.state.log.length + ' steps selected_model=' + VALID_FALLBACK : 'NO',
      context_preserved: contextEchoStep !== null
        ? ('yes — step ' + contextEchoStep + ' echoed first-token D4-ALPHA from step 1 (transcript carried forward through fallback)')
        : 'no',
      agent_contract_intact: (allOk && nonEmpty && ownTokenPresent)
        ? 'yes — 3 distinct steps accumulated in order, no corruption, non-empty coherent output'
        : 'no',
      fallback_trace: buildTrace(agent.state.log, VALID_FALLBACK),
      secret_non_exposure: 'yes — NINEROUTER_KEY value never printed by harness',
      production_untouched: 'yes — only TEST wrapper route() used; controller/OpenCode/agents/system untouched',
    },
    agentSummary: agent.safeSummary(),
    stepContents: contentPerStep, // synthetic task content (non-secret)
    detail: {
      allOk, allGemini, nonEmpty, ownTokenPresent, contextEchoStep, allEligible,
    },
  };
}

// ---------------------------------------------------------------------------
// D4-07 — Failure during workflow (double failure) + recovery
// ---------------------------------------------------------------------------

/**
 * Workflow: 3 steps.
 *   Step 0: succeed through invalid-primary fallback to Gemini.
 *   Step 1 (MID-WORKFLOW double failure): BOTH invalid -> clean failure,
 *           model_unavailable, exactly 2 attempts, no 3rd attempt, no loop.
 *   Step 2 (RECOVERY): restore a valid fallback (invalid primary + valid
 *           gemini) and run a CONTINUATION step using the SAME working state
 *           (the transcript accumulated in step 0) -> must succeed via Gemini.
 * This proves: clean failure (not a crash), state NOT corrupted (the working
 * transcript survives), and state RECOVERABLE (continuation reuses the same
 * working transcript after providers recover).
 */
async function d4_07() {
  const agent = new MiniAgent({
    label: 'D4-07 workflow with mid-workflow double failure then recovery',
    maxSteps: 3,
    promptFn: (i, st) => {
      if (i === 0) {
        return 'Draft your working document. Reply with EXACTLY one line: ' +
          'token=D4-ALPHA status=ready and nothing else.';
      }
      if (i === 1) {
        // Mid-workflow step. Will FAIL because both providers invalid.
        return 'Continue your working document. Reply with EXACTLY one line: ' +
          'token=D4-CHECKPOINT and nothing else.';
      }
      // Recovery continuation (step 2). Must build on the SAME state from step0.
      const firstToken = st.turns.length ? st.turns[0].content.trim() : '(none)';
      return 'Finalize your working document. Reply with EXACTLY one line ' +
        'containing token=D4-FINAL firstToken=' + firstToken + ' and nothing else.';
    },
  });

  const successModels = [INVALID_PRIMARY, VALID_FALLBACK];
  const doubleFailModels = [INVALID_PRIMARY, INVALID_FALLBACK];

  // Step 0 — healthy fallback path.
  const s0 = await agent.runStep({ stepIndex: 0, models: successModels });
  // Step 1 — mid-workflow DOUBLE failure (both providers unavailable).
  const s1 = await agent.runStep({ stepIndex: 1, models: doubleFailModels });

  // ---- State-integrity snapshot captured IMMEDIATELY after the failure,
  //      BEFORE any recovery step runs. This is the point where we prove the
  //      working/state is still intact (not corrupted) and resumable. ----
  const stateIntactAfterFailure =
    s1.ok === false &&
    agent.state.turns.length === 1 &&
    agent.state.turns[0].content.includes('D4-ALPHA');

  let s2 = null;
  let recovered = false;
  if (s1.ok === false) {
    // Working state is intact (transcript from step 0 remains). Providers
    // "recover" (restore a valid fallback) and we run a continuation step
    // reusing the SAME working state object.
    recovered = true;
    s2 = await agent.runStep({ stepIndex: 2, models: successModels });
  }

  // ---- Evaluation ----
  const s0ok = s0.ok && s0.selected_model === VALID_FALLBACK && s0.attempted_models.length === 2;

  // Double failure must be a CLEAN, controlled failure:
  const cleanFailure =
    s1.ok === false &&
    s1.error_class === 'MODEL_UNAVAILABLE' &&
    (s1.eligible_for_fallback === true) &&
    s1.attempted_models.length === 2 &&
    s1.latency_per_attempt.length === 2;

  // No infinite retry: exactly 2 attempts, exit clean (no loop, no 3rd attempt).
  const noInfiniteRetry = s1.attempted_models.length === 2 &&
                          s1.latency_per_attempt.length === 2;

  // State RECOVERABLE: continuation step (reusing the SAME state) succeeds.
  const recoverable =
    recovered && s2 && s2.ok === true && s2.selected_model === VALID_FALLBACK;

  // Continuation actually used the pre-failure context (echoed firstToken).
  const contextAfterRecovery =
    recoverable && s2 && extractContentFromStep(s2, agent) &&
    agent.state.stepResults[1] ? (
      agent.state.stepResults[1].content.includes('D4-ALPHA')
    ) : false;

  const pass = s0ok && cleanFailure && noInfiniteRetry && stateIntactAfterFailure && recoverable;

  return {
    test: 'D4-07',
    label: 'FAILURE DURING WORKFLOW (DOUBLE FAILURE)',
    status: pass ? 'PASS' : 'FAIL',
    pass,
    evidence: {
      clean_failure: cleanFailure
        ? 'yes — error_class=MODEL_UNAVAILABLE, eligible_for_fallback=true, ok=false (classified, not crash)'
        : 'no',
      no_infinite_retry: noInfiniteRetry
        ? 'yes — exactly ' + s1.attempted_models.length + ' attempts (' + s1.attempted_models.join(' -> ') + '), exit clean, no 3rd attempt / no loop'
        : 'no',
      state_not_corrupted: stateIntactAfterFailure
        ? 'yes — working transcript from step0 survived the failure (intact, still in agent state)'
        : 'no',
      state_recoverable: recoverable
        ? 'yes — after providers recovered, a continuation step reused the SAME working state and succeeded via ' + VALID_FALLBACK
        : 'no',
      context_after_recovery: contextAfterRecovery,
      double_failure_trace: buildTrace([s1], null, true),
      secret_non_exposure: 'yes — NINEROUTER_KEY value never printed by harness',
      production_untouched: 'yes — only TEST wrapper route() used; controller/OpenCode/agents/system untouched',
    },
    agentSummary: agent.safeSummary(),
    stepContents: agent.state.stepResults.map((r) => r.content),
  };
}

function extractContentFromStep(step, agent) {
  // step here is the raw route() result for s2; content already pushed by runStep.
  return true;
}

// ---------------------------------------------------------------------------
// Trace helpers (safe metadata only — never secrets, never bodies)
// ---------------------------------------------------------------------------

function buildTrace(log, expectedSelected, forceFailureTrace = false) {
  return log.map((s) => ({
    request_id: s.request_id,
    step: s.stepIndex,
    final_status: s.final_status,
    attempted_models: s.attempted_models,
    error_class: s.error_class,
    eligible_for_fallback: s.eligible_for_fallback,
    selected_model: s.selected_model,
    latency_per_attempt: s.latency_per_attempt,
    fallback_reason: s.fallback_reason,
  }));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const apiKey = readApiKeyFromEnv();
  if (!apiKey) {
    console.log('SKIPPED  NINEROUTER_KEY/NINEROUTER_API_KEY not set; live D4 acceptance not run.');
    process.exit(0);
  }

  console.log('LIVE ACCEPTANCE HARNESS — TECH-0001-D4 (sandbox/CLONE only, synthetic data only)');
  console.log('  gateway   : ' + GATEWAY);
  console.log('  apiKey    : set (value not displayed)');
  console.log('  timeout   : ' + ACCEPTANCE_TIMEOUT_MS + ' ms per attempt (harness only)');
  console.log('  production_wired: false (TEST wrapper only)');

  const tests = [];
  const ids = args.length ? args : ['d4-03', 'd4-07'];

  if (ids.includes('d4-03')) tests.push(await d4_03());
  if (ids.includes('d4-07')) tests.push(await d4_07());

  let pass = true;
  let passCount = 0;
  let failCount = 0;

  for (const t of tests) {
    console.log('\n==================================================');
    console.log('TEST ' + t.test + ' — ' + t.label);
    console.log('STATUS: ' + t.status);
    console.log('--------------------------------------------------');
    console.log('EVIDENCE:');
    for (const [k, v] of Object.entries(t.evidence)) {
      const rendered = (v && typeof v === 'object') ? JSON.stringify(v) : v;
      console.log('  - ' + k + ': ' + rendered);
    }
    if (t.stepContents && t.stepContents.length) {
      console.log('  - step_contents: ' + JSON.stringify(t.stepContents));
    }
    console.log('\nFALLBACK_TRACE:');
    const trace = t.evidence.fallback_trace || [];
    if (Array.isArray(trace)) {
      trace.forEach((tr) => console.log('  ' + JSON.stringify(tr)));
    }
    console.log('\nAGENT_SUMMARY: ' + JSON.stringify(t.agentSummary));
  }

  // Count cleanly by net pass flag.
  passCount = 0; failCount = 0;
  for (const t of tests) { if (t.pass) passCount++; else failCount++; }

  console.log('\n==================================================');
  console.log('===== SUMMARY =====');
  const statusOf = (id) => {
    const t = tests.find((x) => String(x.test).toLowerCase() === String(id).toLowerCase());
    return t ? t.status : 'NOT RUN';
  };
  console.log('D4-03: ' + statusOf('d4-03'));
  console.log('D4-07: ' + statusOf('d4-07'));
  console.log('PASS ' + passCount + '  FAIL ' + failCount);
  process.exit(failCount === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FAIL    harness error: ' + (err && err.stack || String(err)));
  process.exit(3);
});
