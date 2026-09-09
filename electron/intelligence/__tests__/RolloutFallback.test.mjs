// Fase 19 — Rollout + backward compatibility. Verifica todo feature flag defaults
// Fora (old behavior preserved), pode ser enabled independently, and o memory provedor
// falls voltar to Noop quando its flag é fora — o app works em ambos states.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  isIntelligenceFlagEnabled,
  intelligenceFlagSnapshot,
  __resetIntelligenceFlagsCache,
} from '../../../dist-electron/electron/intelligence/intelligenceFlags.js';
import { LongTermMemoryService } from '../../../dist-electron/electron/intelligence/memory/LongTermMemoryService.js';

const DEFAULT_ON_KEYS = new Set([
  'meetingSummaryV3',
  'meetingModeAutoDetect',
  'followUpDraftV2',
  'speakerLabelsV1',
  'meetingSummaryLlmPolish',
  // Ships ON by default (product decision 2026-09-06) — see intelligenceFlags.ts comments:
  'durableMemoryWindow',
  'meetingMemoryV2',
  'globalSearchV2',
  // Pre-existing default-ON flags that were missing from this pin set (drift fixed 2026-09-06):
  'proactiveMode',
  'personalMemory',
]);

const expectedDefault = (key) => DEFAULT_ON_KEYS.has(key) ? true : false;

const FLAG_ENV = {
  intelligenceOsEnabled: 'REFRACT_INTELLIGENCE_OS',
  profileTreeV2: 'REFRACT_PROFILE_TREE_V2',
  contextRouterV2: 'REFRACT_CONTEXT_ROUTER_V2',
  liveTranscriptBrain: 'REFRACT_LIVE_TRANSCRIPT_BRAIN',
  promptAssemblerV2: 'REFRACT_PROMPT_ASSEMBLER_V2',
  answerDiversityGuard: 'REFRACT_ANSWER_DIVERSITY_GUARD',
  meetingMemoryV2: 'REFRACT_MEETING_MEMORY_V2',
  globalSearchV2: 'REFRACT_GLOBAL_SEARCH_V2',
  inMeetingSearchV2: 'REFRACT_IN_MEETING_SEARCH_V2',
  lectureIntelligenceV2: 'REFRACT_LECTURE_INTELLIGENCE_V2',
  diagramIntelligence: 'REFRACT_DIAGRAM_INTELLIGENCE',
  hindsightMemory: 'REFRACT_HINDSIGHT_MEMORY',
  hindsightLiveRecall: 'REFRACT_HINDSIGHT_LIVE_RECALL',
  hindsightPostMeetingRetain: 'REFRACT_HINDSIGHT_POST_MEETING_RETAIN',
  trace: 'REFRACT_INTELLIGENCE_TRACE',
  durableMemoryWindow: 'REFRACT_DURABLE_MEMORY_WINDOW',
};

const EXTRA_FLAG_ENV = [
  'REFRACT_MEETING_SUMMARY_V3',
  'REFRACT_MEETING_MODE_AUTODETECT',
  'REFRACT_FOLLOWUP_DRAFT_V2',
  'REFRACT_SPEAKER_LABELS_V1',
  'REFRACT_MEETING_NOTES_STRUCTURED_OUTPUT',
  'REFRACT_MEETING_SUMMARY_LLM_POLISH',
  'REFRACT_SPEAKER_DIARIZATION_V1',
];

function clearAll() {
  for (const env of [...Object.values(FLAG_ENV), ...EXTRA_FLAG_ENV]) delete process.env[env];
  __resetIntelligenceFlagsCache();
}

describe('Rollout — disabled mode (default = old behavior)', () => {
  beforeEach(clearAll);
  afterEach(clearAll);

  test('all rollout flags resolve to their documented defaults', () => {
    const snap = intelligenceFlagSnapshot();
    for (const [key, val] of Object.entries(snap)) {
      assert.equal(val, expectedDefault(key), `flag ${key} default mismatch`);
    }
  });

  test('LongTermMemoryService.fromFlags is Noop when hindsight_memory is OFF', () => {
    const svc = LongTermMemoryService.fromFlags({ hindsight: { baseUrl: 'http://localhost:8888' } });
    assert.equal(svc.enabled, false);
    assert.equal(svc.providerName, 'noop');
  });
});

describe('Rollout — enabled mode (per-flag, independent)', () => {
  beforeEach(clearAll);
  afterEach(clearAll);

  test('each flag can be enabled independently via env without affecting others', () => {
    for (const [key, env] of Object.entries(FLAG_ENV)) {
      clearAll();
      process.env[env] = 'on';
      __resetIntelligenceFlagsCache();
      assert.equal(isIntelligenceFlagEnabled(key), true, `${key} should enable via ${env}`);
      // Não sibling muda quando um é toggled: cada outro resolve para SEU default documentado
      // (com todos os três flags de memória ON por padrão desde 2026-09-06, "não vazou" significa
      // permanecer no padrão, não necessariamente falso).
      const others = Object.keys(FLAG_ENV).filter((k) => k !== key);
      for (const o of others) assert.equal(isIntelligenceFlagEnabled(o), expectedDefault(o), `${o} changed when only ${key} set`);
    }
  });

  test('the recommended rollout order is all independently gated (no hard coupling)', () => {
    // Habilitar o primeiro poucos em o spec's recommended oordenar depois ones stay ofora
    process.env.REFRACT_INTELLIGENCE_TRACE = 'on';
    process.env.REFRACT_PROFILE_TREE_V2 = 'on';
    __resetIntelligenceFlagsCache();
    assert.equal(isIntelligenceFlagEnabled('trace'), true);
    assert.equal(isIntelligenceFlagEnabled('profileTreeV2'), true);
    assert.equal(isIntelligenceFlagEnabled('hindsightLiveRecall'), false, 'last-to-enable stays off');
  });
});

describe('Rollout — instant rollback', () => {
  beforeEach(clearAll);
  afterEach(clearAll);

  test('an explicit OFF overrides everything (instant kill)', () => {
    process.env.REFRACT_DIAGRAM_INTELLIGENCE = 'off';
    __resetIntelligenceFlagsCache();
    assert.equal(isIntelligenceFlagEnabled('diagramIntelligence'), false);
  });
});
