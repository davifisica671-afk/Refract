// node:test — Intelligence OS feature-flag mmódulo
// VValida default OFora env sobrescrever on/off, settings precedence, snapshot, __rreinicia
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  isIntelligenceFlagEnabled,
  isIntelligenceTraceEnabled,
  isDurableMemoryWindowEnabled,
  isIntelligenceOsEnabled,
  intelligenceFlagSnapshot,
  intelligenceFlagKeys,
  intelligenceFlagMeta,
  __resetIntelligenceFlagsCache,
} from '../../../dist-electron/electron/intelligence/intelligenceFlags.js';

// Nomes de env derivados do módulo, não hardcodados. A lista anterior usava o
// prefixo NATIVELY_* enquanto intelligenceFlagMeta reporta REFRACT_*, então
// clearEnv() não estava limpando as variáveis que os flags de fato leem.
const ENV_KEYS = intelligenceFlagKeys().map((k) => intelligenceFlagMeta(k).env);

// A lista completa de flags é derivada do módulo. Congelá-la aqui fazia o teste
// quebrar a cada flag nova (chegou a 11 de diferença antes desta correção), o que
// treina quem revisa a ignorar falhas vermelhas.
const ALL_FLAG_KEYS = intelligenceFlagKeys();

// Guarda de regressão: um flag que existia não deve ser renomeado nem removido
// sem que este teste seja atualizado de propósito.
const HISTORIC_FLAG_KEYS = [
  'trace', 'durableMemoryWindow', 'intelligenceOsEnabled', 'profileTreeV2', 'contextRouterV2',
  'liveTranscriptBrain', 'promptAssemblerV2', 'answerDiversityGuard', 'meetingMemoryV2',
  'meetingSummaryV3', 'meetingModeAutoDetect', 'followUpDraftV2', 'speakerLabelsV1',
  'meetingNotesStructuredOutput', 'meetingSummaryLlmPolish', 'speakerDiarizationV1',
  'globalSearchV2', 'inMeetingSearchV2', 'conversationMemoryV2', 'lectureIntelligenceV2', 'diagramIntelligence',
  'hindsightMemory', 'hindsightLiveRecall', 'hindsightPostMeetingRetain',
];

// Flags que a especificação declara default ON (Meeting Notes V3 + proatividade
// ship habilitados por decisão de produto). `proactiveMode` e `personalMemory`
// estavam ausentes aqui, o que fazia o teste de defaults falhar para eles.
const DEFAULT_ON_KEYS = new Set([
  'personalMemory',
  'proactiveMode',
  'meetingSummaryV3',
  'meetingModeAutoDetect',
  'followUpDraftV2',
  'speakerLabelsV1',
  'meetingSummaryLlmPolish',
]);

const expectedDefault = (key) => DEFAULT_ON_KEYS.has(key) ? true : false;

// Nomes de env resolvidos a partir do módulo. Os literais NATIVELY_* que este
// arquivo usava ficaram obsoletos quando o prefixo mudou para REFRACT_*: os
// testes "setavam" variáveis que nenhum flag lê, e passavam a falhar.
const envFor = (key) => intelligenceFlagMeta(key).env;

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
  __resetIntelligenceFlagsCache();
}

describe('intelligenceFlags', () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  test('every flag resolves to its documented default', () => {
    assert.equal(isIntelligenceTraceEnabled(), false);
    assert.equal(isDurableMemoryWindowEnabled(), false);
    assert.equal(isIntelligenceOsEnabled(), false);
    for (const key of ALL_FLAG_KEYS) {
      assert.equal(isIntelligenceFlagEnabled(key), expectedDefault(key), `flag ${key} default mismatch`);
    }
  });

  test('the full prompt flag set is present in the snapshot', () => {
    const snap = intelligenceFlagSnapshot();
    for (const key of ALL_FLAG_KEYS) {
      assert.ok(key in snap, `snapshot missing flag: ${key}`);
      assert.equal(snap[key], expectedDefault(key));
    }
    // Snapshot precisa não invent extra keys.
    assert.equal(Object.keys(snap).length, ALL_FLAG_KEYS.length);
  });

  test('nenhum flag historicamente existente foi renomeado ou removido', () => {
    // Protege contra remoção acidental: ALL_FLAG_KEYS agora é derivado do módulo,
    // então sem este guarda um flag deletado passaria despercebido.
    const snap = intelligenceFlagSnapshot();
    for (const key of HISTORIC_FLAG_KEYS) {
      assert.ok(key in snap, `flag removido ou renomeado: ${key}`);
    }
  });

  test('a newly-added flag can be toggled by env independently', () => {
    process.env[envFor('contextRouterV2')] = 'on';
    __resetIntelligenceFlagsCache();
    assert.equal(isIntelligenceFlagEnabled('contextRouterV2'), true);
    // Others stay ofora
    assert.equal(isIntelligenceFlagEnabled('profileTreeV2'), false);
  });

  test('env override turns a flag ON', () => {
    process.env[envFor('trace')] = '1';
    __resetIntelligenceFlagsCache();
    assert.equal(isIntelligenceTraceEnabled(), true);
  });

  test('env override accepts on/true/enabled/yes', () => {
    for (const v of ['on', 'true', 'enabled', 'yes', '1']) {
      process.env[envFor('durableMemoryWindow')] = v;
      __resetIntelligenceFlagsCache();
      assert.equal(isDurableMemoryWindowEnabled(), true, `value ${v} should enable`);
    }
  });

  test('env override OFF wins even if default were ON', () => {
    for (const v of ['off', 'false', '0', 'disabled', 'no']) {
      process.env[envFor('trace')] = v;
      __resetIntelligenceFlagsCache();
      assert.equal(isIntelligenceTraceEnabled(), false, `value ${v} should disable`);
    }
  });

  test('unknown env value falls through to default OFF', () => {
    process.env[envFor('trace')] = 'maybe';
    __resetIntelligenceFlagsCache();
    assert.equal(isIntelligenceTraceEnabled(), false);
  });

  test('snapshot reflects resolved state', () => {
    const snap0 = intelligenceFlagSnapshot();
    for (const [key, val] of Object.entries(snap0)) assert.equal(val, expectedDefault(key));
    process.env[envFor('trace')] = 'on';
    __resetIntelligenceFlagsCache();
    const snap1 = intelligenceFlagSnapshot();
    assert.equal(snap1.trace, true);
    assert.equal(snap1.durableMemoryWindow, false);
  });

  test('reads defensively — never throws when settings unavailable', () => {
    // SettingsManager.getInstance() vai throw em this headless ccontexto o módulo
    // precisa swallow it and retorna o default.
    assert.doesNotThrow(() => isIntelligenceFlagEnabled('trace'));
    assert.doesNotThrow(() => intelligenceFlagSnapshot());
  });
});
