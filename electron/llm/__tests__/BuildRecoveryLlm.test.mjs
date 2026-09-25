import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveCodingPromptSignals,
  isDeicticAsk,
} from '../../../dist-electron/electron/llm/codingPromptSignals.js';
import { stripPriorAssistantTurns } from '../../../dist-electron/electron/llm/conversationHistoryPolicy.js';
import {
  isDocGroundedAnswerType,
  isAssistantRefusal,
  SYSTEM_REFUSAL_RE,
  detectIncompleteNumericAnswer,
  detectIncompleteSubQuestionAnswer,
  detectUnsupportedDocumentAnswer,
  completenessRegenFabricates,
  expandQueryWithHints,
  appendCustomModeSystemPromptLayer,
  extractNumericUnitTokens,
} from '../../../dist-electron/electron/llm/documentGroundedPrompt.js';
import { decideSessionWritePolicy } from '../../../dist-electron/electron/llm/FinalAnswerGenerationPolicy.js';
import {
  NVIDIA_NIM_TEST_MODEL_LADDER,
  isNvidiaNimRetiredModelId,
  classifyNvidiaNimProbeError,
  nvidiaNimErrorDetail,
} from '../../../dist-electron/electron/llm/nvidiaNimModels.js';
import {
  performanceHooks,
  applyAdaptiveTtft,
  secondaryStreamObserver,
} from '../../../dist-electron/electron/llm/performance/wiring.js';
import { buildProfileJitPrompt } from '../../../dist-electron/electron/llm/ProfileJitPromptBuilder.js';
import {
  resolveV2SystemPrompt,
  v2TierForPromptTier,
  couldBecomeNoActionSentinel,
  stripLeadingNoActionSentinel,
  shouldSuppressModelOutput,
} from '../../../dist-electron/electron/llm/promptSystemV2.js';
import { stripEmbeddedAnswerContract } from '../../../dist-electron/electron/llm/stripEmbeddedAnswerContract.js';
import { mintTurnId } from '../../../dist-electron/electron/llm/turnIdentity.js';
import { TEXT_PLACEHOLDER_RE } from '../../../dist-electron/electron/utils/curlPlaceholderPolicy.js';
// NOTE: src/lib/micPermissionPolicy.mjs is not an electron build entry — it is
// inlined into consumers by esbuild (bundle:true), so there is no dist copy.
// The source is already plain .mjs, imported directly.
import { micSettingsUri } from '../../../src/lib/micPermissionPolicy.mjs';

test('codingPromptSignals: no coding task by default + non-deictic (degraded)', () => {
  assert.deepEqual(
    resolveCodingPromptSignals({
      answerType: 'general_meeting_answer',
      question: 'what was decided?',
      priorCodingTurnExists: false,
      codingTurnPromoted: false,
    }),
    { codingTask: false },
  );
  assert.equal(isDeicticAsk('solve this'), false);
});

test('conversationHistoryPolicy: identity keeps history (safe)', () => {
  assert.equal(stripPriorAssistantTurns('prior snapshot'), 'prior snapshot');
});

test('documentGroundedPrompt: degraded gates + pass-throughs', () => {
  assert.equal(isDocGroundedAnswerType('lecture_answer'), false);
  assert.equal(isAssistantRefusal('I cannot help'), false);
  assert.equal(SYSTEM_REFUSAL_RE.test('anything'), false);
  assert.deepEqual(
    detectIncompleteNumericAnswer({
      question: 'q',
      answer: 'a',
      retrievedBlock: 'b',
      answerIsRefusal: false,
    }),
    { missing: [], incomplete: false },
  );
  assert.deepEqual(
    detectIncompleteSubQuestionAnswer({ question: 'q', answer: 'a', answerIsRefusal: false }),
    { missing: [], incomplete: false },
  );
  assert.deepEqual(
    detectUnsupportedDocumentAnswer({ answer: 'a', retrievedBlock: 'b' }),
    { unsupported: false, reason: null, unsupportedTokens: [] },
  );
  assert.equal(completenessRegenFabricates('regen', 'block'), false);
  assert.equal(expandQueryWithHints('q'), 'q');
  assert.equal(
    appendCustomModeSystemPromptLayer({
      baseSystemPrompt: 'base',
      modePromptSuffix: 'suffix',
      pinnedInstructions: 'pins',
      isActiveCustomMode: true,
    }),
    'base',
  );
  assert.deepEqual(extractNumericUnitTokens('96 GB'), new Set());
});

test('FinalAnswerGenerationPolicy: no session write (degraded)', () => {
  assert.equal(
    decideSessionWritePolicy({
      finalGenerationMode: 'jit_llm',
      validationOk: true,
      sourceContractHonored: true,
    }),
    undefined,
  );
  assert.equal(
    decideSessionWritePolicy({
      finalGenerationMode: 'provider_error_no_answer',
      validationOk: false,
      criticalViolations: ['provider_error_no_answer'],
    }),
    undefined,
  );
});

test('nvidiaNimModels: empty ladder + nothing retired (degraded)', () => {
  assert.deepEqual(NVIDIA_NIM_TEST_MODEL_LADDER, []);
  assert.equal(isNvidiaNimRetiredModelId('nvidia_nim/some-model'), false);
  assert.equal(isNvidiaNimRetiredModelId(undefined), false);
  assert.equal(classifyNvidiaNimProbeError(new Error('410 gone')), 'key-ok');
  assert.equal(nvidiaNimErrorDetail(new Error('boom')), 'boom');
});

test('performance/wiring: hooks shape + identity ttft (degraded)', () => {
  const hooks = performanceHooks({
    llmHelper: null,
    hasImages: false,
    inputTokens: 10,
    isUserCancelled: () => false,
    onDiagnostics: () => undefined,
  });
  assert.equal(typeof hooks.observe, 'function');
  assert.equal(hooks.interTokenStallMs, 8000); // aligned to LIVE_INTER_TOKEN_STALL_MS (Task 5)
  assert.equal(applyAdaptiveTtft(7000, { llmHelper: null, hasImages: false, inputTokens: 10 }), 7000);
  assert.equal(typeof secondaryStreamObserver('regeneration'), 'function');
});

test('ProfileJitPromptBuilder: empty prompts (degraded)', () => {
  assert.deepEqual(
    buildProfileJitPrompt({
      question: 'q',
      answerType: 'skills_answer',
      answerShape: 'bullets',
      sourceOwner: 'profile',
      sourceAuthority: 'profile',
      contract: null,
      evidence: null,
      styleInstructions: 'style',
      maxAnswerWords: 90,
    }),
    { systemPrompt: '', userPrompt: '' },
  );
});

test('promptSystemV2: legacy fallback null + pass-throughs (degraded)', () => {
  assert.equal(
    resolveV2SystemPrompt({ action: 'answer', tier: 'cloud', chatSurface: true }),
    null,
  );
  assert.equal(v2TierForPromptTier('cloud'), 'cloud');
  assert.equal(couldBecomeNoActionSentinel('[[NO_AC'), false);
  assert.equal(stripLeadingNoActionSentinel('hello'), 'hello');
  assert.equal(shouldSuppressModelOutput('hello'), false);
});

test('stripEmbeddedAnswerContract: strips contract block (real logic)', () => {
  assert.equal(
    stripEmbeddedAnswerContract('before <answer_contract>{"a":1}</answer_contract> after'),
    'before  after',
  );
  assert.equal(stripEmbeddedAnswerContract('plain text'), 'plain text');
});

test('turnIdentity: mints unique UUIDs (real logic)', () => {
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const a = mintTurnId();
  const b = mintTurnId();
  assert.match(a, uuidRe);
  assert.match(b, uuidRe);
  assert.notEqual(a, b);
});

test('curlPlaceholderPolicy: matches {{TEXT}} with tolerated spacing', () => {
  assert.equal(TEXT_PLACEHOLDER_RE.test('curl https://x --data {{TEXT}}'), true);
  assert.equal(TEXT_PLACEHOLDER_RE.test('curl https://x --data {{ TEXT }}'), true);
  assert.equal(TEXT_PLACEHOLDER_RE.test('curl https://x'), false);
});

test('micPermissionPolicy: platform URIs (real logic)', () => {
  assert.equal(
    micSettingsUri('darwin'),
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  );
  assert.equal(micSettingsUri('win32'), 'ms-settings:privacy-microphone');
  assert.equal(micSettingsUri('linux'), null);
});
