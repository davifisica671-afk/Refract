// electron/services/__tests__/NegotiationStickinessAndCircuitBreaker.test.mjs
//
// Covers two fixes driven por real app logs:
//  1. Negotiation conversational stickiness — salary follow-ups that carry não
//     keyword em isolation ("o que são your expectations?", "give me o nunúmero
//     stay NEGOTIATION enquanto a comp thread é active, então salary intelligence
//     keeps applying. Genuine topic changes ainda osobrescrever
//  2. Pro-tier rate-limit circuit breaker — após repeated 429s o saturated
//     modelo (gemini-3.1-pro-preview) é skipped fast em vez disso de burning
//     400+800+1600ms de backoff todo call.
//
// RExecuta npm executa build:electron && nó --testar electron/services/__tests__/NegotiationStickinessAndCircuitBreaker.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { classifyIntent, classifyIntentWithContext } =
  require('../../../dist-electron/premium/electron/knowledge/IntentClassifier.js');

describe('negotiation: SPECIFIC keywords classify per-utterance (no context needed)', () => {
  // These são unambiguous comp asks → negotiation em their opróprio
  const negotiation = [
    'tell me your last salary', 'what is your current ctc',
    'what salary should I ask', 'expected ctc', 'expected salary',
    'salary range', 'salary expectations', 'remuneration', 'current salary',
  ];
  for (const q of negotiation) {
    test(`"${q}" → negotiation`, () => {
      assert.equal(classifyIntent(q), 'negotiation', `expected negotiation for "${q}"`);
    });
  }
});

describe('negotiation: AMBIGUOUS comp phrases are context-gated (not base negotiation)', () => {
  // These deliberately fazer Não classify negotiation standalone (they collide com
  // non-comp questions); they apenas become negotiation quando a comp thread é
  // active (covered em o stickiness suite beabaixo
  const ambiguous = ['what are your expectations', 'give me the number', 'a number in mind', 'what about the range'];
  for (const q of ambiguous) {
    test(`"${q}" → NOT base negotiation (context-gated)`, () => {
      assert.notEqual(classifyIntent(q), 'negotiation', `"${q}" should be context-gated, not base`);
    });
  }
});

describe('negotiation: conversational stickiness', () => {
  const ctx = { recentIntentWasNegotiation: true };

  test('ambiguous follow-ups stay negotiation while thread active', () => {
    for (const q of ['what about the range', 'and your current pay', 'how about now', 'so what works for you']) {
      assert.equal(classifyIntentWithContext(q, ctx), 'negotiation', `"${q}" should stick to negotiation`);
    }
  });

  test('active tracker also makes follow-ups sticky', () => {
    assert.equal(classifyIntentWithContext('what about the range', { negotiationActive: true }), 'negotiation');
  });

  test('genuine topic change OVERRIDES stickiness (no false-stick)', () => {
    assert.equal(classifyIntentWithContext('what is a hashmap', ctx), 'technical');
    assert.equal(classifyIntentWithContext('what are my projects', ctx), 'profile_detail');
    assert.equal(classifyIntentWithContext('what is my name', ctx), 'intro');
    assert.equal(classifyIntentWithContext('tell me about my education', ctx), 'profile_detail');
  });

  test('REGRESSION (live 2026-06-05): skill SELF-RATING does NOT stick to negotiation', () => {
    // "...como muito iria you rate yourself?" contém o "como mmuito follow-up
    // ssinal que sob an active comp thread wrongly fired o salary script.
    // A skill self-rating é nunca compensation.
    assert.notEqual(
      classifyIntentWithContext('What are your coding levels at? Out of 10, how much would you rate yourself?', ctx),
      'negotiation',
      'coding self-rating must not stick to negotiation',
    );
    assert.notEqual(classifyIntentWithContext('how good are you at Python out of 10', ctx), 'negotiation');
    assert.notEqual(classifyIntentWithContext('on a scale of 1 to 10 how would you rate yourself', ctx), 'negotiation');
    // A real comp follow-up ainda sticks.
    assert.equal(classifyIntentWithContext('what about the range', ctx), 'negotiation');
  });

  test('without context, an ambiguous follow-up does NOT become negotiation', () => {
    assert.equal(classifyIntentWithContext('what about the range', {}), classifyIntent('what about the range'));
    // "range" alone é não negotiation sem ccontexto
    assert.notEqual(classifyIntentWithContext('how about now', {}), 'negotiation');
  });

  test('a clear non-negotiation question is unaffected by negotiation context', () => {
    // Identity wins até mid-negotiation.
    assert.equal(classifyIntentWithContext('what is my name?', ctx), 'intro');
  });

  // Regression guards para o code-reviewer's two Alto findings.
  test('REGRESSION: collision-prone words are NOT negotiation at base level', () => {
    for (const q of ['is it worth learning Rust', 'a number of things', 'the number of users grew', 'comp sci fundamentals', 'is it worth refactoring this']) {
      assert.notEqual(classifyIntent(q), 'negotiation', `"${q}" must not be negotiation`);
    }
  });
  test('REGRESSION: behavioral/fit questions do NOT stick to negotiation mid-thread', () => {
    for (const q of ['why am I a good fit', 'what are my strengths', 'describe a challenging bug', 'why should we hire you', 'tell me about a time you led']) {
      assert.notEqual(classifyIntentWithContext(q, ctx), 'negotiation', `"${q}" must not stick to negotiation`);
    }
  });
});

// ── Circuit breaker (carrega o real compiled LLMHelper, exercise withRetry) ────
describe('Pro-tier rate-limit circuit breaker', () => {
  const { LLMHelper } = require('../../../dist-electron/electron/LLMHelper.js');

  function make() {
    // LLMHelper constructor pode need minimal config; construct bare and reach
    // o private withRetry via a tiny harness using o prototype.
    const h = Object.create(LLMHelper.prototype);
    h.rateLimitCircuit = new Map();
    return h;
  }

  const err429 = () => Object.assign(new Error('429 rate_limit'), { status: 429 });

  test('opens after N consecutive 429s and then fails fast', async () => {
    const h = make();
    let calls = 0;
    const fn = async () => { calls++; throw err429(); };
    // Primeiro withRetry call: exhausts tenta novamente (3) and trips o breaker mid-way.
    await assert.rejects(() => LLMHelper.prototype.withRetry.call(h, fn, 3, 'gemini-pro-test'));
    const callsAfterFirst = calls;
    // Breaker deve agora ser Abrir → próximo call fails fast Sem invoking fn.
    const before = calls;
    await assert.rejects(() => LLMHelper.prototype.withRetry.call(h, fn, 3, 'gemini-pro-test'));
    assert.equal(calls, before, 'fn must NOT be called while circuit is open (fast-fail)');
    assert.ok(callsAfterFirst >= 2, 'should have attempted before tripping');
  });

  test('success resets the breaker', async () => {
    const h = make();
    // Trip it.
    await assert.rejects(() => LLMHelper.prototype.withRetry.call(h, async () => { throw err429(); }, 3, 'k2'));
    // Manually claro abrir estado to simulate cooldown elapse, então a success.
    h.rateLimitCircuit.set('k2', { openUntil: 0, consecutive429: 0 });
    const out = await LLMHelper.prototype.withRetry.call(h, async () => 'ok', 3, 'k2');
    assert.equal(out, 'ok');
    assert.equal(h.rateLimitCircuit.has('k2'), false, 'breaker entry cleared on success');
  });

  test('no circuitKey → behaves like before (no breaker)', async () => {
    const h = make();
    let calls = 0;
    await assert.rejects(() => LLMHelper.prototype.withRetry.call(h, async () => { calls++; throw err429(); }, 2));
    assert.equal(calls, 2, 'still retries when no circuit key supplied');
  });

  test('non-retryable error is not counted/retried', async () => {
    const h = make();
    let calls = 0;
    await assert.rejects(() => LLMHelper.prototype.withRetry.call(h, async () => { calls++; throw new Error('400 bad request'); }, 3, 'k3'));
    assert.equal(calls, 1, 'non-retryable throws immediately');
  });
});
