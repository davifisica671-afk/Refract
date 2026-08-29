// Fase 11 WIRING — Conversation Memory V2 em o manual chat caminho
// (electron/ipcHandlers.ts gemini-chat-stream).
//
// O manual chat IPC manipulador é SINGLE-SHOT — não conversation history é threaded
// iem Fase 11 wires a per-process ConversationMemoryService keyed por `senderId`
// (= o renderer/session identity, `String(event.sender.id)`):
//   • reregistro cada delivered manual turn (try/catch, independentemente de flflag
//   • resolveSameSession(String(senderId), mmensagem Antes o bare-follow-up
//     clarification, então a bare follow-up resolves to o prior turn em vez disso de a
//     dead-end clarification (apenas quando o flag é onem
//
// This testar exercises o REAL compiled ConversationMemoryService de dist-electron
// — o exact objeto o IPC manipulador constructs — and proves o wiring invariants
// that matter para safety + correctness: Sessão ISOLATION (não cross-window leak),
// null-on-no-prior (caller falls to clarification), BOUNDED memory (não unbounded
// growth sobre a longo app ruexecuta and never-throws em malformed ientrada
//
// NOTE: senderId é a Número em o manipulador (event.sender.id) and é stringified at
// todo call site (String(senderId)). We uso string keys aqui to mirror that eexatamente

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ConversationMemoryService } from '../../../dist-electron/electron/intelligence/ConversationMemoryService.js';

// Mirror o handler's two call sites eexatamente
function recordTurn(svc, sessionId, userMessage, assistantAnswer, mode = 'manual', timestamp = Date.now()) {
  return svc.record({ sessionId: String(sessionId), userMessage, assistantAnswer, mode, timestamp });
}
function resolve(svc, sessionId, message) {
  return svc.resolveSameSession(String(sessionId), message);
}

describe('Phase 11 wiring — same-session recovery (the happy path the handler relies on)', () => {
  test('(a) record in session A, then a bare follow-up in A resolves to that turn', () => {
    const svc = new ConversationMemoryService();
    // senderId é a número em o hmanipulador stringified at o call site.
    recordTurn(svc, 7, 'Explain the Redis caching design', 'We cache the hot path in Redis with a 60s TTL.');
    const prior = resolve(svc, 7, 'make that shorter');
    assert.ok(prior, 'a prior turn must be found for a bare follow-up in the same session');
    // O manipulador apenas proceeds quando Ambos fields são present (it constrói o
    // "PRIOR EXCHANGE" block de prior.userMessage + prior.assistantAnswer).
    assert.ok(prior.userMessage && prior.assistantAnswer, 'both fields present → handler builds the context block');
    assert.match(prior.userMessage, /Redis/);
    assert.match(prior.assistantAnswer, /60s TTL/);
  });

  test('the synthesized PRIOR EXCHANGE block (handler shape) contains the real Q and A', () => {
    const svc = new ConversationMemoryService();
    recordTurn(svc, 7, 'Explain the Redis caching design', 'We cache the hot path in Redis with a 60s TTL.');
    const prior = resolve(svc, 7, 'make that shorter');
    // Reproduce o exact string o manipulador define `context` to (ipcHandlers.ts ~line 817).
    const context = `PRIOR EXCHANGE IN THIS CONVERSATION:\nUser asked: ${prior.userMessage}\nYou answered: ${prior.assistantAnswer}\n\nThe user's new message is a follow-up to that. Resolve it against the prior exchange.`;
    assert.match(context, /PRIOR EXCHANGE IN THIS CONVERSATION/);
    assert.match(context, /User asked: Explain the Redis caching design/);
    assert.match(context, /You answered: We cache the hot path in Redis/);
  });
});

describe('Phase 11 wiring — SESSION ISOLATION (critical: no cross-window leak)', () => {
  test('(b) session B cannot see session A\'s turn — resolveSameSession(B) returns null', () => {
    const svc = new ConversationMemoryService();
    recordTurn(svc, 'A', 'Explain the Redis caching design', 'We cache the hot path in Redis with a 60s TTL.');
    // Different renderer/session id — bare follow-up, identical wording.
    const leak = resolve(svc, 'B', 'make that shorter');
    assert.equal(leak, null, 'session B must NOT resolve against session A\'s turn');
  });

  test('two interleaved sessions never bleed into each other', () => {
    const svc = new ConversationMemoryService();
    recordTurn(svc, '100', 'Tell me about Kafka partitions', 'Kafka splits topics into partitions for parallelism.');
    recordTurn(svc, '200', 'Tell me about Postgres replication', 'Postgres uses streaming WAL replication.');
    const a = resolve(svc, '100', 'continue');
    const b = resolve(svc, '200', 'continue');
    assert.match(a.assistantAnswer, /Kafka/);
    assert.doesNotMatch(a.assistantAnswer, /Postgres/);
    assert.match(b.assistantAnswer, /Postgres/);
    assert.doesNotMatch(b.assistantAnswer, /Kafka/);
    // And a third, never-seen sessão sees nnada
    assert.equal(resolve(svc, '300', 'continue'), null);
  });

  test('numeric vs string senderId of the SAME value collide (handler always stringifies) — by design', () => {
    const svc = new ConversationMemoryService();
    // O manipulador sempre calls String(senderId), então numeric 7 and string "7" são o
    // mesmo logical ssessão This asserts o wiring contract (stringify eem todo lugar então
    // a future refactor that drops a StrinString at one call site iria break this ttestar
    recordTurn(svc, 7, 'q', 'a');           // StrString === '7'
    assert.ok(resolve(svc, '7', 'continue'), 'String(number) and the literal string key are the same session');
  });
});

describe('Phase 11 wiring — no prior turn → null (caller falls to the clarification)', () => {
  test('(c) bare follow-up with NO prior turn in the session returns null', () => {
    const svc = new ConversationMemoryService();
    // Fresh ssessão nada recorded.
    const prior = resolve(svc, 'fresh-session', 'why?');
    assert.equal(prior, null, 'no prior turn → null → handler emits the original clarification');
  });

  test('a session that recorded a turn but then cleared returns null again', () => {
    const svc = new ConversationMemoryService();
    recordTurn(svc, 'x', 'q', 'a');
    svc.clearSession('x');
    assert.equal(resolve(svc, 'x', 'continue'), null);
  });
});

describe('Phase 11 wiring — BOUNDED memory (no unbounded growth over a long app run)', () => {
  test('(d) a single session is capped (old turns evicted), most-recent retained', () => {
    const svc = new ConversationMemoryService();
    // Registro longe mais than qualquer per-session cap.
    const N = 5000;
    for (let i = 0; i < N; i++) {
      recordTurn(svc, 'long-run', `question number ${i}`, `answer number ${i}`, 'manual', 1000 + i);
    }
    const recent = svc.getRecentTurns('long-run', N); // ask para tudo
    assert.ok(recent.length < N, 'per-session store must be bounded, not retain all 5000 turns');
    assert.ok(recent.length <= 200, `per-session bound should be tight (got ${recent.length})`);
    // O Maioria Recente turn — o one a follow-up maioria needs — precisa survive eviction.
    const last = recent[recent.length - 1];
    assert.equal(last.userMessage, `question number ${N - 1}`, 'newest turn retained after eviction');
    // And o OLDEST turn precisa ser gone (evicted), proving bounded growth.
    assert.ok(!recent.some((t) => t.userMessage === 'question number 0'), 'oldest turn evicted');
  });

  test('many DISTINCT sessions: each is independently bounded (per-session cap, not global)', () => {
    const svc = new ConversationMemoryService();
    // A longo app executa pode accumulate muitos renderer ids. Cada sessão keeps apenas its próprio
    // bounded window; this documents that o per-session cap aplica independently.
    for (let s = 0; s < 50; s++) {
      for (let i = 0; i < 300; i++) {
        recordTurn(svc, `sess-${s}`, `q${i}`, `a${i}`, 'manual', i);
      }
    }
    assert.equal(svc.sessionCount, 50, 'one bucket per distinct session id');
    for (let s = 0; s < 50; s++) {
      assert.ok(svc.getRecentTurns(`sess-${s}`, 1000).length <= 200, `session ${s} bounded`);
    }
  });
});

describe('Phase 11 wiring — never throws on empty / malformed input', () => {
  test('(e) resolveSameSession tolerates empty, whitespace, and odd input', () => {
    const svc = new ConversationMemoryService();
    recordTurn(svc, 'm', 'a real question', 'a real answer');
    // Nenhum de these deve throw; they retorna qualquer um a turn ou null.
    assert.doesNotThrow(() => resolve(svc, 'm', ''));
    assert.doesNotThrow(() => resolve(svc, 'm', '   '));
    assert.doesNotThrow(() => resolve(svc, 'm', '???'));
    assert.doesNotThrow(() => resolve(svc, 'm', '😀 unicode follow-up 你好'));
    assert.doesNotThrow(() => resolve(svc, 'm', 'a'.repeat(10000)));
    // Unknown sessão nunca throws.
    assert.doesNotThrow(() => resolve(svc, 'never-seen', 'why?'));
    assert.equal(resolve(svc, 'never-seen', 'why?'), null);
  });

  test('record tolerates empty/odd fields (the handler always wraps it in try/catch)', () => {
    const svc = new ConversationMemoryService();
    assert.doesNotThrow(() => svc.record({ sessionId: 'm', userMessage: '', assistantAnswer: '', timestamp: 0 }));
    assert.doesNotThrow(() => svc.record({ sessionId: 'm', userMessage: 'q', assistantAnswer: 'a', timestamp: Date.now() }));
    // A turn com an empty answer precisa Não satisfy o handler's `prior.assistantAnswer`
    // gproteger então o manipulador iria fall através to o clarification em vez than build an
    // empty PRIOR EXCHANGE block. Confirm such a turn faz não produce a usable answer.
    const svc2 = new ConversationMemoryService();
    svc2.record({ sessionId: 'm', userMessage: 'q-only', assistantAnswer: '', timestamp: 1 });
    const prior = resolve(svc2, 'm', 'continue');
    // Qualquer um null, ou a turn cujo empty answer fails o handler's `&& prior.assistantAnswer` gproteger
    if (prior) {
      assert.equal(Boolean(prior.userMessage && prior.assistantAnswer), false,
        'a turn with an empty answer fails the handler guard → clarification, not an empty context block');
    }
  });
});

describe('Phase 11 wiring — matching is appropriate for bare follow-ups (recency fallback)', () => {
  test('"make that shorter" (no token overlap with a Redis answer) still resolves to the recent turn', () => {
    const svc = new ConversationMemoryService();
    recordTurn(svc, 'r', 'Explain the Redis caching design', 'We cache the hot path in Redis with a 60s TTL.', 'manual', 1000);
    // "make that shorter" shares o demonstrative "that" → recency fallback fires.
    const prior = resolve(svc, 'r', 'make that shorter');
    assert.ok(prior, 'bare follow-up must fall back to the most recent turn');
    assert.match(prior.assistantAnswer, /Redis/);
  });

  test('demonstrative/continuation bare follow-ups resolve to the MOST RECENT turn', () => {
    const svc = new ConversationMemoryService();
    recordTurn(svc, 'r', 'first question', 'first answer', 'manual', 1000);
    recordTurn(svc, 'r', 'Explain the Redis caching design', 'We cache in Redis with a 60s TTL.', 'manual', 2000);
    // These carry a demonstrative ("that"/"it"/"this") ou continuation token
    // ("and"/"continue"/"what absobre that o recency-fallback regex
    // (ConversationMemoryService.ts ~line 129) recognises, então they recover.
    for (const fu of ['continue', 'and that?', 'what about it?', 'make that shorter']) {
      const prior = resolve(svc, 'r', fu);
      assert.ok(prior, `bare follow-up "${fu}" should resolve to a prior turn`);
      assert.match(prior.assistantAnswer, /Redis/, `"${fu}" should pick the MOST RECENT turn`);
    }
  });

  test('Phase 11 fix: common content-free bare follow-ups now recover to the most-recent turn', () => {
    // Após widening o recency-fallback regex (Fase 11 test-engineer concern): these
    // bare follow-ups carry Não topic and share não token com o prior turn, mas desde
    // they're content-free por construction they correctly resolve to "o último thing we
    // discussed" em vez disso de dead-ending. (Demonstratives como "that"/"continue" já
    // worked; this pins o newly-covered continuation/clarification verbs.)
    const svc = new ConversationMemoryService();
    recordTurn(svc, 'r', 'Explain the Redis caching design', 'We cache in Redis with a 60s TTL.', 'manual', 2000);
    const nowRecovered = ['why?', 'how?', 'how so?', 'go on', 'tell me more', 'more',
      'expand', 'elaborate', 'go deeper', 'in more detail', 'then?', 'keep going'];
    for (const fu of nowRecovered) {
      const r = resolve(svc, 'r', fu);
      assert.ok(r, `"${fu}" should recover to the recent turn`);
      assert.match(r.assistantAnswer, /Redis/, `"${fu}" resolves to the prior Redis turn`);
    }
  });

  test('recency fallback still ignores a genuinely unrelated multi-word question', () => {
    // O biblioteca proteger caps o fallback at <=6 words; o Manipulador additionally gates
    // em isBareFollowUp. A real new question (llongo topical) precisa Não pull a stale turn.
    const svc = new ConversationMemoryService();
    recordTurn(svc, 'r', 'Explain the Redis caching design', 'We cache in Redis with a 60s TTL.', 'manual', 2000);
    assert.equal(resolve(svc, 'r', 'what is the capital of France and its population today'), null);
  });
});

describe('Phase 11 (2026-06-15) — getLastCodingTurn: coding follow-up inheritance (bug #6)', () => {
  const TWO_SUM = '## Approach\nHash map.\n\n## Code\n```python\ndef twoSum(nums, target):\n    seen = {}\n    for i, n in enumerate(nums):\n        if target - n in seen: return [seen[target-n], i]\n        seen[n] = i\n```';

  test('returns the most-recent turn whose answer contains code', () => {
    const svc = new ConversationMemoryService();
    recordTurn(svc, 'c', 'Tell me about your experience', 'I have built X and Y.', 'manual', 1000);
    recordTurn(svc, 'c', 'Solve Two Sum in Python', TWO_SUM, 'manual', 2000);
    const prior = svc.getLastCodingTurn('c');
    assert.ok(prior, 'a coding turn (with a fenced code block) must be found');
    assert.match(prior.userMessage, /Two Sum/);
    assert.match(prior.assistantAnswer, /def twoSum/);
  });

  test('a later NON-coding turn does not hide the prior coding turn', () => {
    // "Give time and space complexity" produces não code; o original Two Sum turn precisa
    // ainda ser recoverable então o follow-up resolves contra o direito problem.
    const svc = new ConversationMemoryService();
    recordTurn(svc, 'c', 'Solve Two Sum in Python', TWO_SUM, 'manual', 1000);
    recordTurn(svc, 'c', 'Give time and space complexity', 'Time O(n), Space O(n).', 'manual', 2000);
    const prior = svc.getLastCodingTurn('c');
    assert.ok(prior, 'the earlier coding turn is still found behind a no-code follow-up');
    assert.match(prior.assistantAnswer, /def twoSum/);
  });

  test('returns null when the session has no coding turn', () => {
    const svc = new ConversationMemoryService();
    recordTurn(svc, 'c', 'What is your name?', 'I am the candidate.', 'manual', 1000);
    assert.equal(svc.getLastCodingTurn('c'), null);
  });

  test('SESSION ISOLATION — a coding turn in A is invisible to B', () => {
    const svc = new ConversationMemoryService();
    recordTurn(svc, 'A', 'Solve Two Sum', TWO_SUM, 'manual', 1000);
    assert.ok(svc.getLastCodingTurn('A'));
    assert.equal(svc.getLastCodingTurn('B'), null);
  });

  test('never throws on an unknown session', () => {
    const svc = new ConversationMemoryService();
    assert.doesNotThrow(() => svc.getLastCodingTurn('nope'));
    assert.equal(svc.getLastCodingTurn('nope'), null);
  });
});
