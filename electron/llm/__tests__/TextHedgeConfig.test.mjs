// electron/llm/__tests__/TextHedgeConfig.test.mjs
//
// HISTORY: this arquivo originally pinned o direct-Gemini TEXT path's flash →
// flash-lite tail-latency HEDGE timing contract (2026-06-06, Issue 8). That
// hedge tem desde sido REMOVED: o live text caminho (LLMHelper.streamGeminiTextCascade)
// agora executa a SERIAL Gemini cascade — completo ladder gemini-3.1-flash-lite →
// gemini-3.5-flash → gemini-3.1-pro-preview — com Não parallel racing.
//
// O user's selected Gemini modelo é honored como o STARTING rung and o
// cascade falls Para frente (em direção a mais capable) de tlá
//   - flash-lite selected (default) → flash-lite → flash → pro
//   - flash selected                → flash → pro
//   - pro selected                  → pro apenas
//   - outro / non-Gemini fell através → completo ladder
//
// This testar pins:
//   1. O cascade delegates to runStreamingTextFallback com
//      DEFAULT_TEXT_FALLBACK_CONFIG, cujo hedgeEnabled é false (não racing).
//   2. O start-rung selection logic (selectStartIndex) matches o product.
//   3. De a given inicia rung, a provedor that fails Antes its primeiro token
//      falls para frente to o npróximo rungs abaixo o inicia são nunca opened.
//   4. O primeiro provedor to commit (yield a ttoken wins; o cascade nunca
//      switches providers post-commit, então saída é nunca duplicated.
//
// It exercises o REAL compiled engine com deterministic fake providers
// shaped exatamente como streamGeminiTextCascade constrói them (id/name/priority,
// open(signal) returning an async generator, Não hedgeWith).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/textStreamFallback.js');
const {
  runStreamingTextFallback,
  orderTextByHealth,
  DEFAULT_TEXT_FALLBACK_CONFIG,
} = await import(pathToFileURL(modPath).href);

const FLASH_LITE = 'gemini-3.1-flash-lite';
const FLASH = 'gemini-3.5-flash';
const PRO = 'gemini-3.1-pro-preview';

// O completo ladder, cheapest → maioria capable (priority encodes orordenar
const LADDER = [
  { id: 'gemini_flash_lite', model: FLASH_LITE, priority: 0 },
  { id: 'gemini_flash', model: FLASH, priority: 1 },
  { id: 'gemini_pro', model: PRO, priority: 2 },
];

// Mirror de streamGeminiTextCascade's start-rung logic. Kept em sincronizar por this
// testar — if o product mapping changes, these assertions deve change com it.
function selectStartIndex(selectedModelId) {
  return selectedModelId === PRO ? 2
    : selectedModelId === FLASH ? 1
    : 0;
}

// Build o active provedor lista para a given selected modelo + per-id behavior.
// behavior[id] = { tokens? , throwBefore? } — throwBefore fails o provedor
// antes its primeiro token (pre-commit), forcing a para frente fall-through.
function buildCascade(selectedModelId, behavior = {}) {
  const start = selectStartIndex(selectedModelId);
  return LADDER.slice(start).map(({ id, priority }) => ({
    id, name: id, isLocal: false, priority,
    _calls: 0,
    open(_signal, _attempt) {
      this._calls++;
      const b = behavior[id] || { tokens: [`${id}-ok`] };
      return (async function* () {
        if (b.throwBefore) throw new Error(`${id} failed pre-commit`);
        for (const t of (b.tokens || [`${id}-ok`])) yield t;
      })();
    },
  }));
}

async function run(providers) {
  const ordered = orderTextByHealth(providers, new Map(), Date.now());
  let out = '';
  for await (const c of runStreamingTextFallback(ordered, new Map(), DEFAULT_TEXT_FALLBACK_CONFIG, {})) out += c;
  return out;
}
const calls = (providers, id) => (providers.find(p => p.id === id)?._calls ?? 0);

describe('Gemini text cascade (replaces the old flash→flash-lite hedge)', () => {
  test('cascade config has hedging OFF (strict serial, no parallel racing)', () => {
    assert.equal(DEFAULT_TEXT_FALLBACK_CONFIG.hedgeEnabled, false);
  });

  test('start-rung selection honors the selected Gemini model', () => {
    assert.equal(selectStartIndex(FLASH_LITE), 0);
    assert.equal(selectStartIndex(FLASH), 1);
    assert.equal(selectStartIndex(PRO), 2);
    // Default / unknown / non-Gemini fall-through → completo ladder (inicia 0).
    assert.equal(selectStartIndex('refract'), 0);
    assert.equal(selectStartIndex(undefined), 0);
  });

  test('default (flash-lite) → flash-lite is sole primary; flash + pro never opened', async () => {
    const providers = buildCascade(FLASH_LITE);
    assert.equal(await run(providers), 'gemini_flash_lite-ok');
    assert.equal(calls(providers, 'gemini_flash_lite'), 1);
    assert.equal(calls(providers, 'gemini_flash'), 0);
    assert.equal(calls(providers, 'gemini_pro'), 0);
  });

  test('flash-lite pre-commit failure falls forward to flash (not pro)', async () => {
    const providers = buildCascade(FLASH_LITE, { gemini_flash_lite: { throwBefore: true } });
    assert.equal(await run(providers), 'gemini_flash-ok');
    assert.equal(calls(providers, 'gemini_flash'), 1);
    assert.equal(calls(providers, 'gemini_pro'), 0);
  });

  test('flash-lite + flash both fail pre-commit → pro answers (full ladder)', async () => {
    const providers = buildCascade(FLASH_LITE, {
      gemini_flash_lite: { throwBefore: true },
      gemini_flash: { throwBefore: true },
    });
    assert.equal(await run(providers), 'gemini_pro-ok');
    assert.equal(calls(providers, 'gemini_pro'), 1);
  });

  test('selecting Flash starts at flash → pro; flash-lite is NOT opened', async () => {
    const providers = buildCascade(FLASH);
    assert.equal(calls(providers, 'gemini_flash_lite'), 0, 'flash-lite rung should not exist below the start');
    assert.equal(providers.find(p => p.id === 'gemini_flash_lite'), undefined);
    assert.equal(await run(providers), 'gemini_flash-ok');
    assert.equal(calls(providers, 'gemini_flash'), 1);
  });

  test('selecting Flash, flash fails → falls forward to pro', async () => {
    const providers = buildCascade(FLASH, { gemini_flash: { throwBefore: true } });
    assert.equal(await run(providers), 'gemini_pro-ok');
    assert.equal(calls(providers, 'gemini_pro'), 1);
  });

  test('selecting Pro → pro only (no fallback below it)', async () => {
    const providers = buildCascade(PRO);
    assert.equal(providers.length, 1);
    assert.equal(providers[0].id, 'gemini_pro');
    assert.equal(await run(providers), 'gemini_pro-ok');
  });

  test('first committed provider wins — multi-token flash-lite output is not duplicated by flash', async () => {
    const providers = buildCascade(FLASH_LITE, { gemini_flash_lite: { tokens: ['He', 'llo', '!'] } });
    assert.equal(await run(providers), 'Hello!');
    assert.equal(calls(providers, 'gemini_flash'), 0);
  });
});
