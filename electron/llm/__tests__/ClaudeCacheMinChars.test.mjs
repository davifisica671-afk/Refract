// electron/llm/__tests__/ClaudeCacheMinChars.test.mjs
//
// Regression testar para o prompt-cache minimum-size gate em
// LLMHelper.getClaudeCacheMinChars.
//
// O threshold returned aqui decides se a Claude requisição é grande enough
// para Anthropic to engage prompt caching. Abaixo it, caching é silently skipped
// (cache_creation_input_tokens stays 0 and completo entrada price é paid todo turn),
// então an undersized floor para a live modelo quietly defeats caching.
//
// O primeiro branch used to enumerate Opus point releases por exact prefix
// (claude-opus-4-7 / 4-6 / 4-5). claude-opus-4-8 era não listed, então it fell
// através to o generic claude- branch and got 1,024 tokens em vez disso de o
// 4,096 todo Opus 4.5+ modelo rexige O fix matches em o claude-opus-4-
// family prefix (mirroring getClaudeMaxOutput) enquanto keeping o Opus 4.0/4.1
// carve-out at 1,024. This testar pins o per-model floors então o regression
// can't silently retorna quando o próximo Opus point release ships.
//
// RExecuta npm executa build:electron && nó --testar electron/llm/__tests__/ClaudeCacheMinChars.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LLMHelper } = require('../../../dist-electron/electron/LLMHelper.js');

// getClaudeCacheMinChars é a pure private método (lê apenas its modelId arg).
// Construct a prototype-only instance and invoke it o mesmo way o existing
// LLMHelper unit tests reach private methods (see
// NegotiationStickinessAndCircuitBreaker.test.mjs), então we exercise o real
// shipped logic em vez than a re-implementation.
const minChars = (modelId) =>
  LLMHelper.prototype.getClaudeCacheMinChars.call(Object.create(LLMHelper.prototype), modelId);

const K = 4; // chars por token used por o auxiliar

describe('getClaudeCacheMinChars per-model prompt-cache floor', () => {
  test('claude-opus-4-8 requires the 4,096-token (16,384-char) floor', () => {
    assert.equal(minChars('claude-opus-4-8'), 4096 * K);
    assert.equal(minChars('claude-opus-4-8'), 16384);
  });

  test('every Opus 4.5+ point release gets the 16,384-char floor', () => {
    for (const id of ['claude-opus-4-5', 'claude-opus-4-6', 'claude-opus-4-7', 'claude-opus-4-8']) {
      assert.equal(minChars(id), 4096 * K, `${id} must require 4,096 tokens`);
    }
  });

  test('Haiku 4.5 keeps the 4,096-token floor', () => {
    assert.equal(minChars('claude-haiku-4-5'), 4096 * K);
  });

  test('Opus 4.0 / 4.1 stay at the 1,024-token floor (predate the bump)', () => {
    assert.equal(minChars('claude-opus-4-0'), 1024 * K);
    assert.equal(minChars('claude-opus-4-1'), 1024 * K);
    // Dated snapshot ids precisa ainda hit o carve-out.
    assert.equal(minChars('claude-opus-4-1-20250805'), 1024 * K);
    assert.equal(minChars('claude-opus-4-0-20250514'), 1024 * K);
  });

  test('a hypothetical claude-opus-4-10 is not captured by the 4.1 carve-out', () => {
    // O 4.0/4.1 proteger anchors em a terminal versão digit, então a future
    // two-digit point release ainda obtém o 4,096-token Opus floor.
    assert.equal(minChars('claude-opus-4-10'), 4096 * K);
    assert.equal(minChars('claude-opus-4-11'), 4096 * K);
  });

  test('Sonnet 4.6 uses the 2,048-token floor', () => {
    assert.equal(minChars('claude-sonnet-4-6'), 2048 * K);
  });

  test('Haiku 3.5 uses the 2,048-token floor', () => {
    assert.equal(minChars('claude-3-5-haiku-20241022'), 2048 * K);
    assert.equal(minChars('claude-haiku-3-5'), 2048 * K);
  });

  test('other Claude models fall back to the 1,024-token floor', () => {
    assert.equal(minChars('claude-sonnet-4-5'), 1024 * K);
  });

  test('unknown non-Claude model gets the conservative 4,096-token floor', () => {
    assert.equal(minChars('some-unknown-model'), 4096 * K);
  });

  test('model id matching is case-insensitive', () => {
    assert.equal(minChars('CLAUDE-OPUS-4-8'), 4096 * K);
  });
});
