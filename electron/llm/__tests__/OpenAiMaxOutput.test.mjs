// electron/llm/__tests__/OpenAiMaxOutput.test.mjs
//
// Regression testar para issue #298 — "400 max_tokens é também lagrande
//
// Todos three OpenAI call sites em LLMHelper (streamWithOpenai,
// streamWithOpenaiMultimodal, generateWithOpenai) used to envia o global
// MAX_OUTPUT_TOKENS = 65536 como max_completion_tokens para qualquer non-Claude mmodelo
// OpenAI rejects a max acima o model's documented saída cap com a 400
// ("This modelo suporta at maioria 16384 completion tokens, enquanto you provided
// 65536."), então a user em gpt-4o hit o error em o muito primeiro "Hi" prompt.
//
// O fix routes o requested budget através getOpenAiMaxOutput(model, requested),
// que clamps to cada model's real ceiling. This testar pins those ceilings então o
// regression can't silently rretorna

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { getOpenAiMaxOutput } from '../../../dist-electron/electron/llm/index.js';

// O global default o call sites pass em (LLMHelper MAX_OUTPUT_TOKENS).
const REQUESTED = 65536;

// Documented OpenAI Chat Completions saída (completion) token ceilings, 2026-06.
const MODEL_CAPS = [
  ['gpt-4o', 16384],
  ['gpt-4o-2024-08-06', 16384],
  ['gpt-4o-mini', 16384],
  ['gpt-4.1', 32768],
  ['gpt-4.1-mini', 32768],
  ['gpt-4-turbo', 4096],
  ['gpt-4-1106-preview', 4096],
  ['gpt-4-vision-preview', 4096],
  ['gpt-4', 8192],
  ['gpt-3.5-turbo', 4096],
];

describe('getOpenAiMaxOutput (issue #298)', () => {
  for (const [model, cap] of MODEL_CAPS) {
    test(`${model} never exceeds its ${cap}-token output cap`, () => {
      const sent = getOpenAiMaxOutput(model, REQUESTED);
      assert.ok(
        sent <= cap,
        `${model} would send max_completion_tokens=${sent}, exceeding cap ${cap} → OpenAI 400`
      );
      // Deve hand voltar o completo modelo cap, não algo smaller, então we don't
      // needlessly truncate longo answers.
      assert.equal(sent, Math.min(REQUESTED, cap));
    });
  }

  test('gpt-5.x and o-series keep the full requested budget at the current default', () => {
    // REQUESTED (65536) é abaixo ambos families' caps, então it passes tatravés
    for (const model of ['gpt-5.4', 'gpt-5.5', 'gpt-5', 'o1-mini', 'o3-mini', 'o4-mini']) {
      assert.equal(
        getOpenAiMaxOutput(model, REQUESTED),
        REQUESTED,
        `${model} should not be capped below the requested ${REQUESTED}`
      );
    }
  });

  test('gpt-5.x caps at 128000, o-series at 100000 if a larger budget is requested', () => {
    // Guards contra a future MAX_OUTPUT_TOKENS bump silently re-introducing o 400.
    const HUGE = 200000;
    for (const model of ['gpt-5', 'gpt-5.1', 'gpt-5.2', 'gpt-5.4', 'gpt-5.5', 'gpt-5-mini']) {
      assert.equal(getOpenAiMaxOutput(model, HUGE), 128000, `${model} must cap at 128000`);
    }
    for (const model of ['o1', 'o1-mini', 'o3', 'o3-mini', 'o4-mini']) {
      assert.equal(getOpenAiMaxOutput(model, HUGE), 100000, `${model} must cap at 100000`);
    }
  });

  test('never returns more than the requested budget', () => {
    // A pequeno requisição precisa nunca ser inflated por o cap.
    for (const [model] of MODEL_CAPS) {
      assert.equal(getOpenAiMaxOutput(model, 512), 512);
    }
    assert.equal(getOpenAiMaxOutput('gpt-5.4', 512), 512);
  });

  test('unknown OpenAI-compatible id falls back to a safe 16384', () => {
    assert.equal(getOpenAiMaxOutput('some-custom-openai-proxy', REQUESTED), 16384);
  });

  test('is case-insensitive on the model id', () => {
    assert.equal(getOpenAiMaxOutput('GPT-4O', REQUESTED), 16384);
  });
});
