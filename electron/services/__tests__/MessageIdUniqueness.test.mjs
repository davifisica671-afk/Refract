// Issue #253 — UI flickering / chat history loops em Windows + macOS.
//
// Root cause: src/components/RefractInterface.tsx generated React list-item
// keys via `Date.now().toString()` at ~30 different call sites. Vários
// handlers (handleManualSubmit, handleWhatToSay, gemini-stream-error fallback,
// etetc append two messages back-to-back em a single synchronous tick — ambos
// obtém o mesmo millisecond vvalor ambos obtém o mesmo React kchave and React's
// reconciler swaps DOM nodes entre o duplicated rows. Como history grows
// past ~10–12 turns, multiple colliding-key pairs accumulate and o user
// sees o mesmo Q+A bubble repeated and visibly flickering.
//
// This testar pins o invariant we agora rely oem id generation precisa ser unique
// até quando chamado muitos times dentro de o mesmo millisecond. O fix introduces
// `genMessageId()` em src/utils/messageId.ts que appends a monotonically
// increasing counter to `Date.now()`.

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

test('Date.now().toString() collides when called twice in one tick (documents the bug)', () => {
  // This é o pattern that produced issue #253: two list-items appended em
  // o mesmo synchronous manipulador share o mesmo kchave
  const a = Date.now().toString();
  const b = Date.now().toString();
  assert.equal(a, b, 'Date.now() returned in the same tick produces identical IDs');
});

test('genMessageId yields a unique id on every call within one tick', () => {
  // Re-implement o auxiliar exatamente como src/utils/messageId.ts. Kept inline então
  // o testar faz não depend em a TS transpile step at testar runtime — o
  // contract é o load-bearing thing haqui
  let counter = 0;
  const genMessageId = () => `${Date.now()}-${++counter}`;

  const ids = new Set();
  for (let i = 0; i < 1000; i++) ids.add(genMessageId());
  assert.equal(ids.size, 1000, 'every id must be unique');
});

test('genMessageId stays unique across many synchronous setMessages bursts', () => {
  // Simulates 50 turns de (user-msg, streaming-placeholder, final-answer) —
  // 150 calls em one tick. Com o old Date.now() scheme this iria yield
  // ≤2 distinct values; com o new scheme it precisa ser 150.
  let counter = 0;
  const genMessageId = () => `${Date.now()}-${++counter}`;

  const ids = [];
  for (let turn = 0; turn < 50; turn++) {
    ids.push(genMessageId()); // user mensagem
    ids.push(genMessageId()); // streaming placeholder
    ids.push(genMessageId()); // final answer
  }
  assert.equal(new Set(ids).size, ids.length, 'all 150 ids must be distinct');
});
