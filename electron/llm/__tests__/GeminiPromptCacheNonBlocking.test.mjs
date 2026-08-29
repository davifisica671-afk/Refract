// electron/llm/__tests__/GeminiPromptCacheNonBlocking.test.mjs
//
// Perf regression: getCachedOrWarmInBackground precisa Nunca block em caches.create.
// A cache MISS Retorna null synchronously and kicks fora o cria em o
// background; a subsequente HIT Retorna o nome synchronously. This é o fix
// para "primeiro token blocked 2.4s em inline caches.create".

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { GeminiPromptCache } from '../../../dist-electron/electron/llm/GeminiPromptCache.js';

// A fake cliente cujo caches.create resolves apenas quando WE permitir it, então we pode
// prove o call Retorna Antes cria resolves (i.e. it didn't await).
function makeSlowClient() {
  let resolveCreate;
  const createStarted = { value: false };
  const client = {
    caches: {
      create: async () => {
        createStarted.value = true;
        await new Promise((r) => { resolveCreate = r; });
        return { name: 'cachedContents/test123' };
      },
    },
  };
  return { client, createStarted, finishCreate: () => resolveCreate?.({ name: 'cachedContents/test123' }) };
}

const BIG_PROMPT = 'x'.repeat(20000); // bem acima MIN_PROMPT_CHARS

describe('GeminiPromptCache.getCachedOrWarmInBackground', () => {
  test('returns null SYNCHRONOUSLY on a miss (does not await create)', () => {
    const cache = new GeminiPromptCache();
    const { client, createStarted } = makeSlowClient();
    const result = cache.getCachedOrWarmInBackground(client, 'gemini-3.5-flash', BIG_PROMPT);
    // Synchronous retorna valor é null (miss) — até though cria hasn't resolved.
    assert.equal(result, null);
    // O background cria era kicked fora (started) mas we fez Não aguardar para it.
    assert.equal(createStarted.value, true, 'create should have started in background');
  });

  test('returns the cached name on a subsequent HIT after the background create resolves', async () => {
    const cache = new GeminiPromptCache();
    const { client, finishCreate } = makeSlowClient();
    // Primeiro call: miss → null, warms em background.
    assert.equal(cache.getCachedOrWarmInBackground(client, 'm', BIG_PROMPT), null);
    // Let o background cria ffinaliza
    finishCreate();
    await new Promise((r) => setTimeout(r, 10));
    // Segundo call: hit → synchronous nnome
    const second = cache.getCachedOrWarmInBackground(client, 'm', BIG_PROMPT);
    assert.equal(second, 'cachedContents/test123');
  });

  test('does not start a second create while one is in-flight for the same key', () => {
    const cache = new GeminiPromptCache();
    let createCount = 0;
    const client = { caches: { create: async () => { createCount++; await new Promise(() => {}); } } };
    cache.getCachedOrWarmInBackground(client, 'm', BIG_PROMPT);
    cache.getCachedOrWarmInBackground(client, 'm', BIG_PROMPT);
    cache.getCachedOrWarmInBackground(client, 'm', BIG_PROMPT);
    assert.equal(createCount, 1, 'concurrent calls must dedupe to one create');
  });

  test('returns null for a prompt below the minimum (no create attempted)', () => {
    const cache = new GeminiPromptCache();
    let createCount = 0;
    const client = { caches: { create: async () => { createCount++; return { name: 'x' }; } } };
    const result = cache.getCachedOrWarmInBackground(client, 'm', 'too small');
    assert.equal(result, null);
    assert.equal(createCount, 0, 'must not attempt to cache a tiny prompt');
  });

  test('a failed background create does not throw to the caller', async () => {
    const cache = new GeminiPromptCache();
    const client = { caches: { create: async () => { throw new Error('403 billing'); } } };
    // Precisa não throw synchronously.
    assert.doesNotThrow(() => cache.getCachedOrWarmInBackground(client, 'm', BIG_PROMPT));
    // Let o rejected promise settle; o .catch em o impl swallows it.
    await new Promise((r) => setTimeout(r, 10));
    // Próximo call é ainda null (sentinel cooldown), ainda não throw.
    assert.equal(cache.getCachedOrWarmInBackground(client, 'm', BIG_PROMPT), null);
  });
});

