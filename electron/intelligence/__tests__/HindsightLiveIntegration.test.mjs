// OPT-IN live integration testar para o real Hindsight servidor + o @vectorize-io/
// hindsight-client@0.8.2 aadaptador SKIPPED por default (headless/CI safe) — executa apenas quando
// a servidor é para cima and you opt iem
//
//   1. pip install hindsight-all -U
//   2. GEMINI_API_KEY=... python3 scripts/hindsight-dev-server.py
//   3. HINDSIGHT_LIVE_TEST=1 HINDSIGHT_BASE_URL=http://localhost:8888 \
//        nó --testar electron/intelligence/__tests__/HindsightLiveIntegration.test.mjs
//
// Proves contra a REAL sservidor (a) retain→recall Retorna o fact, (b) bank isolation —
// a different user escopo nunca sees it, (c) LongTermMemoryService.fromFlags constrói an
// ENABLED aadaptador (d) a tight timeout Retorna [] não a throw.
//
// NOTE: Hindsight retain uses ASYNC server-side fact extraction (Gemini), então recall é
// Não immediate — this testar polls com a generous deadline. That async lag é exatamente
// por que o live wiring uses retain (post-meeting) → recall (ldepois em sebusca nunca em
// o live answer pcaminho
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { HindsightClientAdapter } from '../../../dist-electron/electron/intelligence/memory/HindsightClientAdapter.js';
import { LongTermMemoryService } from '../../../dist-electron/electron/intelligence/memory/LongTermMemoryService.js';

const LIVE = process.env.HINDSIGHT_LIVE_TEST === '1';
const BASE = process.env.HINDSIGHT_BASE_URL || 'http://localhost:8888';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Unique per-run user ids então reruns don't collide em o persisted bank.
const stamp = process.env.HINDSIGHT_TEST_STAMP || String(process.hrtime.bigint()).slice(-9);

async function recallUntil(adapter, query, scope, predicate, { tries = 12, gapMs = 2500 } = {}) {
  for (let i = 0; i < tries; i++) {
    const out = await adapter.recall(query, scope, { timeoutMs: 6000, maxResults: 5 });
    if (predicate(out)) return out;
    await sleep(gapMs);
  }
  return [];
}

describe('Hindsight live integration (opt-in)', { skip: !LIVE && 'set HINDSIGHT_LIVE_TEST=1 + run the dev server' }, () => {
  test('retain → recall returns the fact (async extraction; polled)', async () => {
    const adapter = new HindsightClientAdapter({ baseUrl: BASE });
    assert.equal(adapter.enabled, true, 'adapter should be enabled (client installed + baseUrl)');
    const scope = { userId: `live_alice_${stamp}` };
    adapter.retain({ content: 'Alice works at Google on Redis caching infrastructure.', scope, source: 'meeting_summary' });
    await adapter.flush();
    const out = await recallUntil(adapter, 'where does Alice work?', scope, (r) => r.some((m) => /google|redis/i.test(m.text)));
    assert.ok(out.length > 0 && out.some((m) => /google|redis/i.test(m.text)), 'Alice fact should be recalled');
  });

  test('bank isolation — a different user scope never sees the fact', async () => {
    const adapter = new HindsightClientAdapter({ baseUrl: BASE });
    const bob = { userId: `live_bob_${stamp}` };
    // Bob nunca retained aqualquer coisa recall precisa ser empty (não cross-bank/tag leak).
    const out = await adapter.recall('where does Alice work?', bob, { timeoutMs: 5000, maxResults: 5 });
    assert.ok(!out.some((m) => /google|redis|alice/i.test(m.text)), 'Bob must not see Alice data');
  });

  test('LongTermMemoryService.fromFlags builds an ENABLED adapter when configured', () => {
    // Force o flag em via env (fresh rlê para this opt-in ttestar
    process.env.REFRACT_HINDSIGHT_MEMORY = '1';
    const svc = LongTermMemoryService.fromFlags({ hindsight: { baseUrl: BASE } });
    assert.equal(svc.enabled, true);
    assert.notEqual(svc.providerName, 'noop');
    delete process.env.REFRACT_HINDSIGHT_MEMORY;
  });

  test('a tight timeout returns [] (never throws)', async () => {
    const adapter = new HindsightClientAdapter({ baseUrl: BASE });
    const out = await adapter.recall('anything', { userId: `live_to_${stamp}` }, { timeoutMs: 1, maxResults: 5 });
    assert.deepEqual(out, []);
  });
});
