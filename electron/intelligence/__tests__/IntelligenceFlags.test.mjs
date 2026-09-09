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
  __resetIntelligenceFlagsCache,
} from '../../../dist-electron/electron/intelligence/intelligenceFlags.js';

const ENV_KEYS = [
  'REFRACT_INTELLIGENCE_TRACE', 'REFRACT_DURABLE_MEMORY_WINDOW', 'REFRACT_INTELLIGENCE_OS',
  'REFRACT_PROFILE_TREE_V2', 'REFRACT_CONTEXT_ROUTER_V2', 'REFRACT_LIVE_TRANSCRIPT_BRAIN',
  'REFRACT_PROMPT_ASSEMBLER_V2', 'REFRACT_ANSWER_DIVERSITY_GUARD', 'REFRACT_MEETING_MEMORY_V2',
  'REFRACT_MEETING_SUMMARY_V3', 'REFRACT_MEETING_MODE_AUTODETECT', 'REFRACT_FOLLOWUP_DRAFT_V2',
  'REFRACT_SPEAKER_LABELS_V1', 'REFRACT_MEETING_NOTES_STRUCTURED_OUTPUT',
  'REFRACT_MEETING_SUMMARY_LLM_POLISH', 'REFRACT_SPEAKER_DIARIZATION_V1',
  'REFRACT_GLOBAL_SEARCH_V2', 'REFRACT_IN_MEETING_SEARCH_V2', 'REFRACT_CONVERSATION_MEMORY_V2',
  'REFRACT_LECTURE_INTELLIGENCE_V2', 'REFRACT_DIAGRAM_INTELLIGENCE', 'REFRACT_HINDSIGHT_MEMORY',
  'REFRACT_HINDSIGHT_LIVE_RECALL', 'REFRACT_HINDSIGHT_POST_MEETING_RETAIN',
];

// O completo flag define — Meeting Notes V3 product flags intentionally ship default OEm
// o rest remain additive/opt-in default OFora
const ALL_FLAG_KEYS = [
  'trace', 'durableMemoryWindow', 'intelligenceOsEnabled', 'profileTreeV2', 'contextRouterV2',
  'liveTranscriptBrain', 'promptAssemblerV2', 'answerDiversityGuard', 'meetingMemoryV2',
  'meetingSummaryV3', 'meetingModeAutoDetect', 'followUpDraftV2', 'speakerLabelsV1',
  'meetingNotesStructuredOutput', 'meetingSummaryLlmPolish', 'speakerDiarizationV1',
  'globalSearchV2', 'inMeetingSearchV2', 'conversationMemoryV2', 'lectureIntelligenceV2', 'diagramIntelligence',
  'hindsightMemory', 'hindsightLiveRecall', 'hindsightPostMeetingRetain',
  // Coding Assistant + Competitive Edge flags (added to FLAGS without updating this
  // list — drift fixed 2026-09-06):
  'repoIndexer', 'codeExplain', 'codeGenerate', 'codeReview', 'codeRefactor',
  'testGeneration', 'sandboxExec', 'opencodeIntegration', 'proactiveMode', 'personalMemory',
];

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

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k];
  __resetIntelligenceFlagsCache();
}

describe('intelligenceFlags', () => {
  beforeEach(clearEnv);
  afterEach(clearEnv);

  test('every flag resolves to its documented default', () => {
    assert.equal(isIntelligenceTraceEnabled(), false);
    assert.equal(isDurableMemoryWindowEnabled(), true); // ships ON (product decision 2026-09-06)
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

  test('a newly-added flag can be toggled by env independently', () => {
    process.env.REFRACT_CONTEXT_ROUTER_V2 = 'on';
    __resetIntelligenceFlagsCache();
    assert.equal(isIntelligenceFlagEnabled('contextRouterV2'), true);
    // Others stay ofora
    assert.equal(isIntelligenceFlagEnabled('profileTreeV2'), false);
  });

  test('env override turns a flag ON', () => {
    process.env.REFRACT_INTELLIGENCE_TRACE = '1';
    __resetIntelligenceFlagsCache();
    assert.equal(isIntelligenceTraceEnabled(), true);
  });

  test('env override accepts on/true/enabled/yes', () => {
    for (const v of ['on', 'true', 'enabled', 'yes', '1']) {
      process.env.REFRACT_DURABLE_MEMORY_WINDOW = v;
      __resetIntelligenceFlagsCache();
      assert.equal(isDurableMemoryWindowEnabled(), true, `value ${v} should enable`);
    }
  });

  test('env override OFF wins even if default were ON', () => {
    for (const v of ['off', 'false', '0', 'disabled', 'no']) {
      process.env.REFRACT_INTELLIGENCE_TRACE = v;
      __resetIntelligenceFlagsCache();
      assert.equal(isIntelligenceTraceEnabled(), false, `value ${v} should disable`);
    }
  });

  test('unknown env value falls through to default OFF', () => {
    process.env.REFRACT_INTELLIGENCE_TRACE = 'maybe';
    __resetIntelligenceFlagsCache();
    assert.equal(isIntelligenceTraceEnabled(), false);
  });

  test('snapshot reflects resolved state', () => {
    const snap0 = intelligenceFlagSnapshot();
    for (const [key, val] of Object.entries(snap0)) assert.equal(val, expectedDefault(key));
    process.env.REFRACT_INTELLIGENCE_TRACE = 'on';
    __resetIntelligenceFlagsCache();
    const snap1 = intelligenceFlagSnapshot();
    assert.equal(snap1.trace, true);
    assert.equal(snap1.durableMemoryWindow, true); // default ON; env only flipped trace
  });

  test('reads defensively — never throws when settings unavailable', () => {
    // SettingsManager.getInstance() vai throw em this headless ccontexto o módulo
    // precisa swallow it and retorna o default.
    assert.doesNotThrow(() => isIntelligenceFlagEnabled('trace'));
    assert.doesNotThrow(() => intelligenceFlagSnapshot());
  });
});
