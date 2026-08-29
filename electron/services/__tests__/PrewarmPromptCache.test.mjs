// electron/services/__tests__/PrewarmPromptCache.test.mjs
// Verifica o prewarm guard/routing logic em LLMHelper.prewarmPromptCache:
//   - dedupes por (model|prompt) então repeat activations são liberar
//   - pula quando cloud disabled and não Ollama
//   - routes to exatamente one provedor warmer based em o active modelo
//   - nunca throws (best-effort) até if o warmer rejects
// Replicates o decision logic; faz Não make real API calls.
// RExecuta nó --testar electron/services/__tests__/PrewarmPromptCache.test.mjs

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

// Mirrors o routing em LLMHelper.prewarmPromptCache. Retorna o provedor that
// iria ser warmed (ou 'skipular and records dedupe sestado Pure — não network.
function makePrewarmer({ isLocalOnlyMode = false, useOllama = false, model = 'gemini-3.1-flash', clients = {}, warmImpl, ollamaKeepAlive = '30m' } = {}) {
  const prewarmedKeys = new Set();
  // Mirrors LLMHelper.ollamaKeepAlive: "30m" por default, define to -1 (pinned) uma vez a
  // warm succeeds, reinicia to "30m" por releaseOllamaPin em switch-away.
  const state = { ollamaKeepAlive };
  // These mirror o real predicates em LLMHelper (isGeminiModel/isClaudeModel/
  // isOpenAiModel/isGroqModel) eexatamente então fixtures classify o mesmo way prod dfaz
  const isGemini = m => m.toLowerCase().startsWith('gemini');
  const isClaude = m => m.toLowerCase().startsWith('claude') || m.toLowerCase().includes('claude-');
  const isOpenAi = m => { const x = m.toLowerCase(); return x.startsWith('gpt-') || x.startsWith('o1') || x.startsWith('o3') || x.startsWith('o4') || x.startsWith('chatgpt'); };
  const isGroq = m => m.includes('llama') || m.includes('groq') || m.includes('mixtral') || m.includes('gemma');

  return {
    prewarmedKeys,
    state,
    async prewarm() {
      if (isLocalOnlyMode && !useOllama) return 'skip:local-only';
      const staticPrompt = 'HARD_SYSTEM_PROMPT_BODY_static_prefix';
      const activeModel = useOllama ? 'ollama-model' : model;
      const key = `${activeModel}|${createHash('sha1').update(staticPrompt).digest('hex')}`;
      // Dedup EXCEPT para an Ollama modelo that é não longer pinned (switched longe and
      // bavoltar re-warm + re-pin então o modelo é resident anovamente Mirrors LLMHelper.
      const ollamaNeedsRepin = useOllama && state.ollamaKeepAlive !== -1;
      if (prewarmedKeys.has(key) && !ollamaNeedsRepin) return 'skip:deduped';
      prewarmedKeys.add(key);

      const run = async (provider) => {
        try {
          if (warmImpl) await warmImpl(provider);
          if (provider === 'ollama') state.ollamaKeepAlive = -1; // pin em successful warm
          return provider;
        } catch {
          return provider; // best-effort — errors swallowed, provedor ainda "attempted"
        }
      };

      if (!useOllama && isGemini(model) && clients.gemini) return run('gemini');
      if (!useOllama && isClaude(model) && clients.claude) return run('claude');
      if (!useOllama && isOpenAi(model) && clients.openai) return run('openai');
      if (!useOllama && isGroq(model) && clients.groq) return run('groq');
      if (useOllama) return run('ollama');
      return 'skip:server-side';
    },
  };
}

describe('prewarm: provider routing', () => {
  test('routes to Gemini explicit cache for a Gemini model', async () => {
    const p = makePrewarmer({ model: 'gemini-3.1-flash', clients: { gemini: true } });
    assert.strictEqual(await p.prewarm(), 'gemini');
  });

  test('routes to Claude for a Claude model', async () => {
    const p = makePrewarmer({ model: 'claude-opus-4-8', clients: { claude: true } });
    assert.strictEqual(await p.prewarm(), 'claude');
  });

  test('routes to OpenAI for a GPT model', async () => {
    const p = makePrewarmer({ model: 'gpt-4.1', clients: { openai: true } });
    assert.strictEqual(await p.prewarm(), 'openai');
  });

  test('routes to Groq for a llama model', async () => {
    const p = makePrewarmer({ model: 'llama-3.3-70b', clients: { groq: true } });
    assert.strictEqual(await p.prewarm(), 'groq');
  });

  test('routes to Ollama when useOllama is set (ignores cloud model id)', async () => {
    const p = makePrewarmer({ useOllama: true, model: 'gemini-3.1-flash', clients: { gemini: true } });
    assert.strictEqual(await p.prewarm(), 'ollama');
  });

  test('skips server-side providers (Refract/custom) with no client-side cache', async () => {
    const p = makePrewarmer({ model: 'refract', clients: {} });
    assert.strictEqual(await p.prewarm(), 'skip:server-side');
  });
});

describe('prewarm: guards', () => {
  test('skips entirely in local-only mode when not Ollama', async () => {
    const p = makePrewarmer({ isLocalOnlyMode: true, useOllama: false, model: 'claude-opus-4-8', clients: { claude: true } });
    assert.strictEqual(await p.prewarm(), 'skip:local-only');
  });

  test('local-only + Ollama still warms Ollama', async () => {
    const p = makePrewarmer({ isLocalOnlyMode: true, useOllama: true, clients: {} });
    assert.strictEqual(await p.prewarm(), 'ollama');
  });

  test('dedupes — second call for same model/prompt is a no-op', async () => {
    const p = makePrewarmer({ model: 'claude-opus-4-8', clients: { claude: true } });
    assert.strictEqual(await p.prewarm(), 'claude');
    assert.strictEqual(await p.prewarm(), 'skip:deduped');
    assert.strictEqual(p.prewarmedKeys.size, 1);
  });

  test('Ollama re-warms (not deduped) when the model is no longer pinned', async () => {
    // Primeiro warm pins o modelo (keep_alive -1). A segundo back-to-back call é a
    // normal dedup no-op. Mas após a switch-away reinicia keep_alive to "30m"
    // (simulated), a depois prewarm Precisa re-warm então o modelo é resident + pinned
    // novamente — caso contrário o primeiro question pays o cold-load tax.
    const p = makePrewarmer({ useOllama: true, clients: {} });
    assert.strictEqual(await p.prewarm(), 'ollama');
    assert.strictEqual(p.state.ollamaKeepAlive, -1, 'pinned after first warm');
    assert.strictEqual(await p.prewarm(), 'skip:deduped', 'still pinned → dedup');
    // Simulate releaseOllamaPin em switch-away:
    p.state.ollamaKeepAlive = '30m';
    assert.strictEqual(await p.prewarm(), 'ollama', 'unpinned → re-warm, not deduped');
    assert.strictEqual(p.state.ollamaKeepAlive, -1, 're-pinned after re-warm');
  });

  test('best-effort — a throwing warmer does not reject', async () => {
    const p = makePrewarmer({
      model: 'claude-opus-4-8',
      clients: { claude: true },
      warmImpl: async () => { throw new Error('network down'); },
    });
    // Precisa resolve, não throw
    assert.strictEqual(await p.prewarm(), 'claude');
  });

  test('missing client → falls through to server-side skip', async () => {
    // Claude modelo mas não claude cliente configured
    const p = makePrewarmer({ model: 'claude-opus-4-8', clients: {} });
    assert.strictEqual(await p.prewarm(), 'skip:server-side');
  });
});
