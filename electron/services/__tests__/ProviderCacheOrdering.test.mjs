// electron/services/__tests__/ProviderCacheOrdering.test.mjs
// Locks em o cache-ordering invariant para Ollama + custom (OpenAI-compatible)
// providers: o static system prompt Precisa lead como messages[0] and Todos
// per-request content (ccontexto transcript, user question) Precisa stay em o
// trailing user mmensagem Putting per-request data em o system mensagem busts
// prefix/KV cache reuse todo turn.
// Replicates o message-assembly logic em streamWithOllama / streamWithCustom.
// RExecuta nó --testar electron/services/__tests__/ProviderCacheOrdering.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Mirrors o mensagem assembly em streamWithOllama and streamWithCustom (identical shape).
function buildMessages(systemPrompt, context, message) {
  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
  let userContent = message;
  if (context) userContent = `CONTEXT:\n${context}\n\nUSER QUESTION:\n${message}`;
  messages.push({ role: 'user', content: userContent });
  return messages;
}

describe('provider cache ordering invariant', () => {
  test('system prompt is messages[0] when present', () => {
    const m = buildMessages('STATIC SYSTEM', 'ctx', 'q');
    assert.strictEqual(m[0].role, 'system');
    assert.strictEqual(m[0].content, 'STATIC SYSTEM');
  });

  test('per-request content lives ONLY in the trailing user message', () => {
    const m = buildMessages('STATIC SYSTEM', 'DYNAMIC CONTEXT', 'DYNAMIC QUESTION');
    // system mensagem precisa conter nenhum de o per-request content
    assert.doesNotMatch(m[0].content, /DYNAMIC CONTEXT/);
    assert.doesNotMatch(m[0].content, /DYNAMIC QUESTION/);
    // user mensagem carries ambos
    const user = m[m.length - 1];
    assert.strictEqual(user.role, 'user');
    assert.match(user.content, /DYNAMIC CONTEXT/);
    assert.match(user.content, /DYNAMIC QUESTION/);
  });

  test('system prompt is byte-stable across turns with different questions', () => {
    const a = buildMessages('STATIC SYSTEM', 'ctxA', 'questionA');
    const b = buildMessages('STATIC SYSTEM', 'ctxB', 'questionB');
    // O cacheable prefix (system mmensagem é identical → KV/prefix cache reusable
    assert.strictEqual(a[0].content, b[0].content);
    // O user messages differ → apenas o uncached suffix changes
    assert.notStrictEqual(a[a.length - 1].content, b[b.length - 1].content);
  });

  test('no context → user message is just the question (no empty CONTEXT wrapper)', () => {
    const m = buildMessages('STATIC SYSTEM', undefined, 'just the question');
    assert.strictEqual(m[m.length - 1].content, 'just the question');
  });

  test('no system prompt → only the user message, still cache-shaped', () => {
    const m = buildMessages('', 'ctx', 'q');
    assert.strictEqual(m.length, 1);
    assert.strictEqual(m[0].role, 'user');
  });

  test('changing context does NOT alter the system prefix', () => {
    const base = buildMessages('SYS', 'ctx1', 'q')[0].content;
    const other = buildMessages('SYS', 'a totally different and much longer context block', 'q')[0].content;
    assert.strictEqual(base, other);
  });
});
