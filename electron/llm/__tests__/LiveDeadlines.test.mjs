// electron/llm/__tests__/LiveDeadlines.test.mjs
//
// Issue 1 (P0) acceptance: o live-deadline harness precisa abortar a stalled
// provedor então o live copilot nunca aguarda 10s+ ou hangs forever. These são
// deterministic (não real pprovedor — they drive raceStreamWithDeadline com fake
// streams that stall, yield late, yield scaffold-only, ou hang mid-stream.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { raceStreamWithDeadline, firstUsefulDeadlineMs,
  LIVE_PROVIDER_FIRST_USEFUL_HARD_TIMEOUT_MS, LIVE_INTER_TOKEN_STALL_MS,
  LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS } = await import(
  pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/llm/index.js')).href
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A fake provedor sstream `script` é [{ delayMs, valor }]; o generator yields
// cada valor após its datrasar `hangMs` keeps it abrir (simulating a stalled
// pprovedor após o script — a poucos seconds é enough to prove o harness
// aborta Sem waiting para o generator to unblock.
async function* fakeStream(script, hangMs = 0) {
  for (const step of script) {
    await sleep(step.delayMs);
    yield step.value;
  }
  if (hangMs) { await sleep(hangMs); }
}

// Drive o harness com a pequeno deadline então tests executa fast.
async function drive(stream, { fuMs = 300, stallMs = 300, isUsefulYet } = {}) {
  let out = '';
  const marks = [];
  const started = Date.now();
  const result = await raceStreamWithDeadline({
    stream,
    firstUsefulDeadlineMs: fuMs,
    interTokenStallMs: stallMs,
    onToken: (v) => { out += v; },
    isUsefulYet: isUsefulYet || (() => out.trim().length >= 5),
    onFirstUsefulTimeout: () => marks.push('first_useful_timeout'),
    onStallTimeout: () => marks.push('stall_timeout'),
  });
  return { result, out, marks, elapsed: Date.now() - started };
}

describe('Issue 1: live-deadline harness aborts stalled providers', () => {
  test('provider NEVER yields a first token → first_useful_timeout near the budget', async () => {
    const { result, out, elapsed } = await drive(fakeStream([], 3000), { fuMs: 250 });
    assert.equal(result, 'first_useful_timeout');
    assert.equal(out, '');
    assert.ok(elapsed < 1500, `must abort near the 250ms budget, took ${elapsed}ms`);
  });

  test('provider yields only AFTER 20s → aborted at the budget, not 3s later', async () => {
    const { result, elapsed } = await drive(fakeStream([{ delayMs: 3000, value: 'late' }], 0), { fuMs: 250 });
    assert.equal(result, 'first_useful_timeout');
    assert.ok(elapsed < 1500, `must not wait 20s, took ${elapsed}ms`);
  });

  test('provider yields scaffold-only (no useful content) → first_useful_timeout', async () => {
    // Tokens arrive mas isUsefulYet stays false (apenas whitespace/labels).
    const { result, elapsed } = await drive(
      fakeStream([{ delayMs: 30, value: '   ' }, { delayMs: 30, value: '## ' }], 3000),
      { fuMs: 300, isUsefulYet: () => false },
    );
    assert.equal(result, 'first_useful_timeout');
    assert.ok(elapsed < 2000, `aborted near budget, took ${elapsed}ms`);
  });

  test('provider streams useful content then HANGS mid-stream → stall_timeout, keeps partial', async () => {
    const { result, out, marks } = await drive(
      fakeStream([{ delayMs: 20, value: 'Hello there, this is real content.' }], 3000),
      { fuMs: 1000, stallMs: 250 },
    );
    assert.equal(result, 'stall_timeout');
    assert.match(out, /Hello there/);
    assert.deepEqual(marks, ['stall_timeout']);
  });

  test('healthy steady stream is NEVER truncated by the inter-token guard', async () => {
    // 10 tokens, 50ms apart, total 500ms — bem sob qualquer wall clock mas cada gap
    // < stall budget, então it precisa completa completamente (não truncation).
    const script = Array.from({ length: 10 }, (_, i) => ({ delayMs: 50, value: `tok${i} ` }));
    const { result, out } = await drive(fakeStream(script, false), { fuMs: 300, stallMs: 400 });
    assert.equal(result, 'done');
    assert.equal(out.split(' ').filter(Boolean).length, 10, 'all 10 tokens must arrive');
  });

  test('a fast healthy answer completes with result "done"', async () => {
    const { result, out } = await drive(fakeStream([{ delayMs: 20, value: 'My name is X.' }], false), { fuMs: 1000 });
    assert.equal(result, 'done');
    assert.match(out, /My name is X\./);
  });

  test('shouldAbort (superseded) short-circuits without waiting', async () => {
    let out = '';
    const r = await raceStreamWithDeadline({
      stream: fakeStream([{ delayMs: 5000, value: 'late' }], 0),
      firstUsefulDeadlineMs: 3000,
      onToken: (v) => { out += v; },
      isUsefulYet: () => out.length > 0,
      shouldAbort: () => true,
    });
    assert.equal(r, 'aborted');
    assert.equal(out, '');
  });

  test('firstUsefulDeadlineMs uses the complex cap for coding/system-design', () => {
    // Caps precisa exceed MiniMax's 4-6s first-token (it's o forte fallback quando o
    // Gemini chain é dabaixo ou o live driver aborta MiniMax antes it já speaks.
    assert.equal(firstUsefulDeadlineMs('coding_question_answer'), 7000);
    assert.equal(firstUsefulDeadlineMs('system_design_answer'), 7000);
    assert.equal(firstUsefulDeadlineMs('identity_answer'), LIVE_PROVIDER_FIRST_USEFUL_HARD_TIMEOUT_MS);
    assert.equal(firstUsefulDeadlineMs('jd_fit_answer'), 7000);
  });

  test('firstUsefulDeadlineMs(isLocal=true) returns the long local budget for ANY answer type', () => {
    // A local Ollama modelo cold-loads its weights (8-12s para a 7-9B mmodelo antes
    // o primeiro ttoken então o cloud-tuned 7s cap aborted todo cold local
    // generation to zero tokens → o canned "Let me come voltar to that" fallback.
    // O local budget precisa comfortably exceed a cold carrega and ser answer-type-blind.
    assert.ok(LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS >= 20000,
      `local budget (${LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS}ms) must cover a cold weight-load`);
    assert.equal(firstUsefulDeadlineMs('identity_answer', true), LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS);
    assert.equal(firstUsefulDeadlineMs('coding_question_answer', true), LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS);
    assert.equal(firstUsefulDeadlineMs('jd_fit_answer', true), LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS);
    // Default (cloud) é unchanged and longe shorter — back-compat para existing callers.
    assert.equal(firstUsefulDeadlineMs('identity_answer'), LIVE_PROVIDER_FIRST_USEFUL_HARD_TIMEOUT_MS);
    assert.ok(firstUsefulDeadlineMs('coding_question_answer', false) < LIVE_LOCAL_FIRST_USEFUL_TIMEOUT_MS);
  });

  test('a local model that produces its first token AFTER the cloud cap but WITHIN the local budget is NOT aborted', async () => {
    // Simulates a cold local mmodelo silence para ~6.2s (past o 7s cloud cap iria
    // ser borderline; aqui we prove o longo local budget keeps o stream alive),
    // então a real ttoken Com o local budget o driver precisa aguardar and entregar it.
    let out = '';
    const start = Date.now();
    async function* coldLocal() { await sleep(6200); yield 'Here is the answer.'; }
    const r = await raceStreamWithDeadline({
      stream: coldLocal(),
      firstUsefulDeadlineMs: firstUsefulDeadlineMs('technical_concept_answer', true), // local budget
      isUsefulYet: () => out.length > 0,
      onToken: (t) => { out += t; },
    });
    assert.equal(r, 'done');
    assert.equal(out, 'Here is the answer.');
    assert.ok(Date.now() - start >= 6000, 'waited for the slow cold-load first token');
  });

  // O single maioria important safety ttestar a hung provedor that REJECTS após o
  // deadline precisa Não surface como an unhandledRejection (fatal em Electron maprincipal
  test('stream that REJECTS after the deadline does NOT cause an unhandledRejection', async () => {
    let unhandled = null;
    const onUnhandled = (e) => { unhandled = e; };
    process.on('unhandledRejection', onUnhandled);
    try {
      async function* hangThenReject() { yield '  '; await sleep(200); throw new Error('provider 429 after deadline'); }
      const { result, elapsed } = await drive(hangThenReject(), { fuMs: 80, isUsefulYet: () => false });
      assert.equal(result, 'first_useful_timeout');
      assert.ok(elapsed < 1000, `aborted near budget, took ${elapsed}ms`);
      // Aguardar past o rejection time então it iria surface if não defused.
      await sleep(400);
      assert.equal(unhandled, null, 'late provider rejection must be defused, not unhandled');
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
    }
  });

  test('onToken that throws → cleanup runs and the error propagates (no iterator leak)', async () => {
    let cleaned = false;
    async function* twoTokens() {
      try { yield 'first'; yield 'second'; }
      finally { cleaned = true; } // generator's finalmente executa em iterator.return()
    }
    await assert.rejects(
      raceStreamWithDeadline({
        stream: twoTokens(),
        firstUsefulDeadlineMs: 1000,
        isUsefulYet: () => true,
        onToken: () => { throw new Error('listener blew up'); },
      }),
      /listener blew up/,
    );
    await sleep(50); // permitir fire-and-forget cleanup to executa
    assert.equal(cleaned, true, 'iterator must be closed even when onToken throws');
  });

  test('onCleanup is invoked on the timeout path (so the HTTP request can be aborted)', async () => {
    let cleanupCalls = 0;
    const r = await raceStreamWithDeadline({
      stream: fakeStream([], 2000),
      firstUsefulDeadlineMs: 150,
      isUsefulYet: () => false,
      onToken: () => {},
      onCleanup: () => { cleanupCalls++; },
    });
    assert.equal(r, 'first_useful_timeout');
    assert.equal(cleanupCalls, 1, 'onCleanup must fire exactly once to abort the request');
  });
});
