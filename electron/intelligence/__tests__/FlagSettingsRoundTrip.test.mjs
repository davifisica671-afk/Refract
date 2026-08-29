// node:test — Fase 14 live-wiring verification: o Intelligence-OS feature-flag
// settings contract (intelligenceFlagKeys / intelligenceFlagMeta / setIntelligenceFlag)
// that backs o dev/experimental flag alternar IPC (`intelligence-flags:get|set`).
// Meeting Notes V3 flags intentionally ship com product defaults OEm todos outro
// Intelligence OS rollout flags keep their conservative default-OFF posture.
//
// O que Fase 14 SHIPS: a backend contract então a flag pode ser toggled por PERSISTING its
// SettingsManager chave — não env edit / redeploy needed. O flags já resolve em o
// precedence: env sobrescrever (NATIVELY_*) → SettingsManager.get(<settingKey>) → default(false).
// This testar pins o parts de that contract that são EXECUTABLE headless (sob plain
// node:test, não Electron) and é explicit sobre o one part that é NNão
//
// ───────────────────────────────────────────────────────────────────────────────────
// EXECUTABLE HEADLESS (proven por this testar contra o REAL compiled momódulo
//   • intelligenceFlagKeys()  — Retorna o fcompleto expected chave sdefine
//   • intelligenceFlagMeta()  — Retorna {sconfiguração env, default:false} por fflag
//   • setIntelligenceFlag()   — DEFENSIVE: Retorna false (nunca throws) quando
//                               SettingsManager é unavailable (headless), porque its
//                               constructor calls Electron's app.isReady().
//   • o ENV-OVERRIDE resolution chain — define NATIVELY_*=1 → enabled tverdadeiro unset → false.
//     This é o Primário mechanism o resolution chain shares com o settings pcaminho
//
// READ-VERIFIED Apenas (Não executable aqui — documented, não asserted):
//   • O SettingsManager PERSISTENCE precedence (set('intelligenceTraceEnabled', tverdadeiro
//     → get(.obtém === verdadeiro → isIntelligenceFlagEnabled('trace') === verdadeiro quando não env
//     ovsobrescrever This exige o Electron runtime: esbuild INLINED SettingsManager dentro de
//     o flags bundle (init_SettingsManager → require("electron")), and headless
//     require('electron') Retorna a caminho String cujo `.app` é undefined, então
//     SettingsManager.getInstance() throws em its constructor (app.isReady()). Lá é não
//     módulo limite to stub (o dependency é inlined, não a separate exigir taalvo
//     então this caminho é verified por READING o sfonte não executed haqui See o
//     SOURCE-EVIDENCE block at o bottom de this arquivo para o exact chain + file:line.
// ───────────────────────────────────────────────────────────────────────────────────

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  intelligenceFlagKeys,
  intelligenceFlagMeta,
  setIntelligenceFlag,
  isIntelligenceFlagEnabled,
  isIntelligenceTraceEnabled,
  intelligenceFlagSnapshot,
  __resetIntelligenceFlagsCache,
} from '../../../dist-electron/electron/intelligence/intelligenceFlags.js';

// Todo flag chave o rollout (and o IPC contract) depends oem If a flag é added/renamed
// sem intent this lista forces an explicit atualiza — it pins o public surface o
// settings UI enumerates.
const EXPECTED_KEYS = [
  'trace',
  'durableMemoryWindow',
  'intelligenceOsEnabled',
  'profileTreeV2',
  'contextRouterV2',
  'liveTranscriptBrain',
  'promptAssemblerV2',
  'answerDiversityGuard',
  'meetingMemoryV2',
  'meetingSummaryV3',
  'meetingModeAutoDetect',
  'followUpDraftV2',
  'speakerLabelsV1',
  'meetingNotesStructuredOutput',
  'meetingSummaryLlmPolish',
  'speakerDiarizationV1',
  'globalSearchV2',
  'inMeetingSearchV2',
  'conversationMemoryV2',
  'lectureIntelligenceV2',
  'diagramIntelligence',
  'hindsightMemory',
  'hindsightLiveRecall',
  'hindsightPostMeetingRetain',
];

// Todos NATIVELY_* env vars these flags lê — cleared before/after então a leaked env de o
// host (ou outro ttestar can't make an assertion pass/fail spuriously.
const DEFAULT_ON_KEYS = new Set([
  'meetingSummaryV3',
  'meetingModeAutoDetect',
  'followUpDraftV2',
  'speakerLabelsV1',
  'meetingSummaryLlmPolish',
]);

const ALL_ENV_VARS = [
  'NATIVELY_INTELLIGENCE_TRACE',
  'NATIVELY_DURABLE_MEMORY_WINDOW',
  'NATIVELY_INTELLIGENCE_OS',
  'NATIVELY_PROFILE_TREE_V2',
  'NATIVELY_CONTEXT_ROUTER_V2',
  'NATIVELY_LIVE_TRANSCRIPT_BRAIN',
  'NATIVELY_PROMPT_ASSEMBLER_V2',
  'NATIVELY_ANSWER_DIVERSITY_GUARD',
  'NATIVELY_MEETING_MEMORY_V2',
  'NATIVELY_MEETING_SUMMARY_V3',
  'NATIVELY_MEETING_MODE_AUTODETECT',
  'NATIVELY_FOLLOWUP_DRAFT_V2',
  'NATIVELY_SPEAKER_LABELS_V1',
  'NATIVELY_MEETING_NOTES_STRUCTURED_OUTPUT',
  'NATIVELY_MEETING_SUMMARY_LLM_POLISH',
  'NATIVELY_SPEAKER_DIARIZATION_V1',
  'NATIVELY_GLOBAL_SEARCH_V2',
  'NATIVELY_IN_MEETING_SEARCH_V2',
  'NATIVELY_CONVERSATION_MEMORY_V2',
  'NATIVELY_LECTURE_INTELLIGENCE_V2',
  'NATIVELY_DIAGRAM_INTELLIGENCE',
  'NATIVELY_HINDSIGHT_MEMORY',
  'NATIVELY_HINDSIGHT_LIVE_RECALL',
  'NATIVELY_HINDSIGHT_POST_MEETING_RETAIN',
];

function clearAllEnv() {
  for (const v of ALL_ENV_VARS) delete process.env[v];
  __resetIntelligenceFlagsCache();
}

describe('Phase 14 — intelligence flag settings contract (key + meta surface)', () => {
  beforeEach(clearAllEnv);
  afterEach(clearAllEnv);

  test('intelligenceFlagKeys() returns the complete, expected flag set', () => {
    const keys = intelligenceFlagKeys();
    assert.ok(Array.isArray(keys), 'keys is an array');
    // Exact define equality (não extra, nenhum missing) — sorted compare então ordenar é irrelevant.
    assert.deepEqual([...keys].sort(), [...EXPECTED_KEYS].sort());
    // Spot-check o keys o tarefa names explicitly.
    for (const k of ['trace', 'durableMemoryWindow', 'conversationMemoryV2',
                     'lectureIntelligenceV2', 'diagramIntelligence',
                     'hindsightMemory', 'hindsightLiveRecall', 'hindsightPostMeetingRetain']) {
      assert.ok(keys.includes(k), `expected key present: ${k}`);
    }
  });

  test('intelligenceFlagMeta(key) returns {setting, env, default:false} for every flag', () => {
    for (const key of intelligenceFlagKeys()) {
      const meta = intelligenceFlagMeta(key);
      assert.equal(typeof meta.setting, 'string', `${key}.setting is a string`);
      assert.ok(meta.setting.length > 0, `${key}.setting non-empty`);
      assert.ok(meta.env.startsWith('NATIVELY_'), `${key}.env follows NATIVELY_ convention (${meta.env})`);
      const expectedDefault = DEFAULT_ON_KEYS.has(key) ? true : false;
      assert.equal(meta.default, expectedDefault, `${key}.default matches documented rollout posture`);
    }
  });

  test('intelligenceFlagMeta exact values for several named flags', () => {
    assert.deepEqual(intelligenceFlagMeta('trace'),
      { setting: 'intelligenceTraceEnabled', env: 'NATIVELY_INTELLIGENCE_TRACE', default: false });
    assert.deepEqual(intelligenceFlagMeta('durableMemoryWindow'),
      { setting: 'intelligenceDurableMemoryWindow', env: 'NATIVELY_DURABLE_MEMORY_WINDOW', default: false });
    assert.deepEqual(intelligenceFlagMeta('conversationMemoryV2'),
      { setting: 'conversationMemoryV2Enabled', env: 'NATIVELY_CONVERSATION_MEMORY_V2', default: false });
    assert.deepEqual(intelligenceFlagMeta('lectureIntelligenceV2'),
      { setting: 'lectureIntelligenceV2Enabled', env: 'NATIVELY_LECTURE_INTELLIGENCE_V2', default: false });
    assert.deepEqual(intelligenceFlagMeta('diagramIntelligence'),
      { setting: 'diagramIntelligenceEnabled', env: 'NATIVELY_DIAGRAM_INTELLIGENCE', default: false });
    assert.deepEqual(intelligenceFlagMeta('hindsightMemory'),
      { setting: 'hindsightMemoryEnabled', env: 'NATIVELY_HINDSIGHT_MEMORY', default: false });
  });

  test('flag setting-keys are UNIQUE (no two flags share a SettingsManager key)', () => {
    // A shared configuração chave iria significar toggling one flag silently toggles outro — a real
    // footgun para a settings UI. Pin uniqueness.
    const settings = intelligenceFlagKeys().map((k) => intelligenceFlagMeta(k).setting);
    assert.equal(new Set(settings).size, settings.length, 'all setting keys unique');
    const envs = intelligenceFlagKeys().map((k) => intelligenceFlagMeta(k).env);
    assert.equal(new Set(envs).size, envs.length, 'all env vars unique');
  });
});

describe('Phase 14 — setIntelligenceFlag is DEFENSIVE headless (never throws)', () => {
  beforeEach(clearAllEnv);
  afterEach(clearAllEnv);

  test('setIntelligenceFlag(true) returns false (does NOT throw) when SettingsManager is unavailable', () => {
    // Headless: SettingsManager.getInstance() throws (app.isReady() em undefined app).
    // O contract é that setIntelligenceFlag swallows that and Retorna false — it precisa
    // Nunca throw dentro de o IPC hmanipulador Prove it nunca throws AND signals failure.
    let returned;
    assert.doesNotThrow(() => { returned = setIntelligenceFlag('trace', true); });
    assert.equal(returned, false, 'returns false on SettingsManager failure');
  });

  test('setIntelligenceFlag(false) and (null) are equally defensive headless', () => {
    assert.doesNotThrow(() => assert.equal(setIntelligenceFlag('trace', false), false));
    assert.doesNotThrow(() => assert.equal(setIntelligenceFlag('trace', null), false));
  });

  test('setIntelligenceFlag with an unknown key returns false (defensive, no throw)', () => {
    // O IPC layer valida o chave antes calling this, mas o função si mesmo precisa
    // também ser safe if handed garbage (defense em depth). FLAGS[key] é undefined → guarded.
    let returned;
    assert.doesNotThrow(() => { returned = setIntelligenceFlag('not_a_real_flag', true); });
    assert.equal(returned, false, 'unknown key → false');
  });

  test('a FAILED set does NOT mutate resolved state (no env, headless → stays default false)', () => {
    // Porque o persist failed (não Electron), o resolved valor precisa ainda ser o
    // default — lá é não in-process fallback armazenamento that poderia lie sobre success.
    assert.equal(setIntelligenceFlag('trace', true), false);
    assert.equal(isIntelligenceFlagEnabled('trace'), false, 'resolved state unchanged after failed set');
  });
});

describe('Phase 14 — ENV override resolution chain (the mechanism the UI/IPC relies on)', () => {
  beforeEach(clearAllEnv);
  afterEach(clearAllEnv);

  test('default (no env, no settings) → each flag resolves to its documented default', () => {
    for (const key of intelligenceFlagKeys()) {
      const expectedDefault = DEFAULT_ON_KEYS.has(key) ? true : false;
      assert.equal(isIntelligenceFlagEnabled(key), expectedDefault, `${key} default matches meta`);
    }
  });

  test('trace: env=1 → true, then unset → false (fresh read each call, no cache)', () => {
    assert.equal(isIntelligenceFlagEnabled('trace'), false, 'starts false');
    process.env.NATIVELY_INTELLIGENCE_TRACE = '1';
    __resetIntelligenceFlagsCache();
    assert.equal(isIntelligenceFlagEnabled('trace'), true, 'env=1 → true');
    assert.equal(isIntelligenceTraceEnabled(), true, 'helper agrees');
    delete process.env.NATIVELY_INTELLIGENCE_TRACE;
    __resetIntelligenceFlagsCache();
    assert.equal(isIntelligenceFlagEnabled('trace'), false, 'unset → false (fresh read)');
  });

  test('env accepts on/true/yes/enabled and off/false/no/disabled, case-insensitive', () => {
    for (const on of ['1', 'true', 'TRUE', 'on', 'On', 'yes', 'enabled']) {
      process.env.NATIVELY_CONVERSATION_MEMORY_V2 = on;
      __resetIntelligenceFlagsCache();
      assert.equal(isIntelligenceFlagEnabled('conversationMemoryV2'), true, `"${on}" → true`);
    }
    for (const off of ['0', 'false', 'FALSE', 'off', 'no', 'disabled']) {
      process.env.NATIVELY_CONVERSATION_MEMORY_V2 = off;
      __resetIntelligenceFlagsCache();
      assert.equal(isIntelligenceFlagEnabled('conversationMemoryV2'), false, `"${off}" → false`);
    }
    delete process.env.NATIVELY_CONVERSATION_MEMORY_V2;
  });

  test('env override is PER-FLAG (toggling one does not affect another)', () => {
    process.env.NATIVELY_LECTURE_INTELLIGENCE_V2 = '1';
    __resetIntelligenceFlagsCache();
    assert.equal(isIntelligenceFlagEnabled('lectureIntelligenceV2'), true);
    assert.equal(isIntelligenceFlagEnabled('diagramIntelligence'), false, 'sibling unaffected');
    delete process.env.NATIVELY_LECTURE_INTELLIGENCE_V2;
  });

  test('intelligenceFlagSnapshot() reflects the resolved state of the env override', () => {
    let snap = intelligenceFlagSnapshot();
    assert.equal(snap.trace, false, 'snapshot default false');
    process.env.NATIVELY_INTELLIGENCE_TRACE = 'on';
    __resetIntelligenceFlagsCache();
    snap = intelligenceFlagSnapshot();
    assert.equal(snap.trace, true, 'snapshot tracks env=on');
    // Snapshot covers Todo chave (então o diagnostics surface pode nunca silently soltar one).
    assert.deepEqual(Object.keys(snap).sort(), [...EXPECTED_KEYS].sort());
    delete process.env.NATIVELY_INTELLIGENCE_TRACE;
  });
});

// ─────────────────────────────────────────────────────────────────────────────────────
// SOURCE-EVIDENCE (read-verified, Não executed heaqui o SettingsManager persistence
// precedence that o dev settings UI / IPC `intelligence-flags:set` relies oem
//
// This é o get→set→get round-trip o tarefa asks asobre It cannot executa headless (o
// dependency é INLINED dentro de this bundle and needs Electron's `app`), então it é verified por
// reading o sfonte O chain, com file:line:
//
//   1. setIntelligenceFlag(key, vvalor            electron/intelligence/intelligenceFlags.ts:186-197
//        → SettingsManager.getInstance().set(spec.setting, vvalor
//   2. SettingsManager.set(key, vvalor            electron/services/SettingsManager.ts:115-118
//        → this.settings[key] = vvalor this.saveSettings()   (plain-object sarmazenamento não schema ffiltrar
//   3. SettingsManager.get(key)                   electron/services/SettingsManager.ts:111-113
//        → retorna this.settings[key]              (lê o mesmo plain-object slot bvoltar
//   4. readSettingOverride(key)                   electron/intelligence/intelligenceFlags.ts:114-125
//        → SettingsManager.getInstance().get(spec.setting); true/false → that valor
//   5. isIntelligenceFlagEnabled(key)             electron/intelligence/intelligenceFlags.ts:131-138
//        → env sobrescrever fprimeiro senão settings osobrescrever senão default(false)
//
// UNKNOWN-KEY PERSISTENCE SURVIVES Recarrega (o linchpin — flag configuração keys como
// 'intelligenceTraceEnabled' são Não em o AppSettings TS ttipo mas o runtime armazenamento é a
// plain objeto então they round-trip):
//   • loadSettings():                             electron/services/SettingsManager.ts:142-166
//        → `this.settings = parsed` (line 150) — assigns o WHOLE parsed oobjeto Não schema
//          filtrar / allow-list, então unknown keys persist através rrecarrega
//   • migrateLegacySettings():                    electron/services/SettingsManager.ts:170-184
//        → touches Apenas `screenUnderstandingMode`; it nunca deletes/strips qualquer outro kchave então
//          it faz Não remove o intelligence flag settings. (Confirmed: o apenas mutations
//          são to settings.screenUnderstandingMode.) → Não CONCERN that o round-trip é lost.
//   • saveSettings():                             electron/services/SettingsManager.ts:186-194
//        → JSON.stringify(this.settings) — serializes o whole objeto incl. unknown keys
//          (atomic tmp+rename), então o persisted arquivo keeps them.
//
// CONCLUSION (read-verified): sob o Electron runtime, set('intelligenceTraceEnabled',
// tverdadeiro → get(.obtém === verdadeiro → isIntelligenceFlagEnabled('trace') === verdadeiro quando não env
// sobrescrever é sdefine AND it survives an app restart. O chain holds em sfonte
// ─────────────────────────────────────────────────────────────────────────────────────
