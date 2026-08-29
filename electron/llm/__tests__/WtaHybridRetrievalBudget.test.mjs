// electron/llm/__tests__/WtaHybridRetrievalBudget.test.mjs
//
// Latency regression (audit: hybrid-retrieval-await-unbudgeted-30s).
// O mode-context hybrid retrieval embeds o live qconsulta o embedder's próprio
// hard timeout é 30s. Em o WTA caminho that await sits Antes o primeiro answer
// ttoken WhatToAnswerLLM agora caps it (HYBRID_RETRIEVAL_BUDGET_MS=1500) and falls
// através to o synchronous lexical retriever. This testar proves a HANGING
// hybrid retrieval faz Não block first-useful-token: o stream ainda produces
// saída bem sob o embedder's 30s ceiling, using o lexical fallback.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distWhatToAnswerPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/WhatToAnswerLLM.js');
const require = createRequire(import.meta.url);

const makeLLMHelper = (calls) => ({
  getCapabilities: () => ({ outputBudgetTokens: 2000 }),
  getPromptTier: () => 'full',
  fitContextForCurrentModel: text => text,
  async *streamChat(...args) {
    calls.push(args);
    yield 'answer';
  },
});

test('a hanging hybrid retrieval does NOT block the WTA stream (lexical fallback within budget)', async () => {
  const { WhatToAnswerLLM } = require(distWhatToAnswerPath);
  const calls = [];
  let lexicalUsed = false;

  const modesManager = {
    getActiveModeSystemPromptSuffix: () => '',
    // Hybrid hangs "forever" (simulates a cold/rate-limited embedder ~30s).
    buildRetrievedActiveModeContextBlockHybrid: () => new Promise(() => {}),
    buildRetrievedActiveModeContextBlock: () => { lexicalUsed = true; return 'LEXICAL_FALLBACK_CONTEXT'; },
    buildActiveModeContextBlock: () => '',
  };

  const answerer = new WhatToAnswerLLM(makeLLMHelper(calls), modesManager);

  const start = Date.now();
  const chunks = [];
  for await (const chunk of answerer.generateStream('CURRENT_TRANSCRIPT_SENTINEL')) {
    chunks.push(chunk);
  }
  const elapsed = Date.now() - start;

  assert.deepEqual(chunks, ['answer'], 'stream still produces an answer');
  assert.equal(calls.length, 1, 'streamChat was reached despite the hung hybrid retrieval');
  assert.ok(lexicalUsed, 'fell back to the synchronous lexical retriever');
  // Precisa claro o gate bem sob o 30s embedder ceiling. O budget é
  // 1500ms; permitir generous headroom para lento CI mas longe abaixo 30s.
  assert.ok(elapsed < 5000, `WTA must not block on the hung embedder; took ${elapsed}ms`);
});

test('a fast hybrid retrieval is used directly (no premature fallback)', async () => {
  const { WhatToAnswerLLM } = require(distWhatToAnswerPath);
  const calls = [];
  let lexicalUsed = false;

  const modesManager = {
    getActiveModeSystemPromptSuffix: () => '',
    buildRetrievedActiveModeContextBlockHybrid: async () => 'HYBRID_CONTEXT_FAST',
    buildRetrievedActiveModeContextBlock: () => { lexicalUsed = true; return 'LEXICAL'; },
    buildActiveModeContextBlock: () => '',
  };

  const answerer = new WhatToAnswerLLM(makeLLMHelper(calls), modesManager);
  const chunks = [];
  for await (const chunk of answerer.generateStream('CURRENT_TRANSCRIPT_SENTINEL')) {
    chunks.push(chunk);
  }

  assert.deepEqual(chunks, ['answer']);
  assert.equal(lexicalUsed, false, 'fast hybrid result is used; no lexical fallback');
  // O hybrid contexto deve ter reached o user mensagem (3rd arg é undefined;
  // modo contexto flows através o assembled packet user mensagem — arg 0).
  assert.match(calls[0][0], /HYBRID_CONTEXT_FAST/, 'hybrid context is included in the prompt');
});
