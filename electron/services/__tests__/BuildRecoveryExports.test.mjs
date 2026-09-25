import { test } from 'node:test';
import assert from 'node:assert/strict';

// Build-recovery contracts (Task 5b): the 12 degraded exports appended to 7
// pre-existing modules so the rewritten ipcHandlers' static imports resolve.
// Every assertion pins the DEGRADED contract documented at the call site — not
// real behavior. Imports resolve from dist-electron/ like the other
// BuildRecovery suites.
import {
  getCodexAuthStatus,
  isCodexAuthError,
} from '../../../dist-electron/electron/services/CodexCliService.js';
import {
  isBareCodeRequest,
  looksLikeCodingAnswer,
} from '../../../dist-electron/electron/llm/codingFollowup.js';
import {
  totalHardTimeoutMs,
  repairDeadlineMs,
  CODING_REGEN_ABORT_CHARS,
  acceptRepairedAnswer,
} from '../../../dist-electron/electron/llm/index.js';
import { getSourceOwnerEnforcementStage } from '../../../dist-electron/electron/intelligence/intelligenceFlags.js';
import { buildManualProfileEvidenceRoute } from '../../../dist-electron/electron/llm/profileAnswerBackend.js';
import { DOC_GROUNDED_TOKEN_BUDGET } from '../../../dist-electron/electron/services/ModeContextRetriever.js';
import { mergeProviderDataScopes } from '../../../dist-electron/electron/llm/ProviderRouter.js';

// Additive-sanity imports: prove the appends displaced nothing.
import { CodexCliService } from '../../../dist-electron/electron/services/CodexCliService.js';
import { buildPriorCodingContextBlock } from '../../../dist-electron/electron/llm/codingFollowup.js';
import { firstUsefulDeadlineMs } from '../../../dist-electron/electron/llm/index.js';
import { isIntelligenceFlagEnabled } from '../../../dist-electron/electron/intelligence/intelligenceFlags.js';
import { buildManualProfileBackendAnswer } from '../../../dist-electron/electron/llm/profileAnswerBackend.js';
import { ModeContextRetriever } from '../../../dist-electron/electron/services/ModeContextRetriever.js';
import { routeLLMProviders } from '../../../dist-electron/electron/llm/ProviderRouter.js';

test('getCodexAuthStatus degraded: signed-out, never carries a token', () => {
  const status = getCodexAuthStatus();
  assert.equal(status.signedIn, false);
  assert.equal(status.email, null);
  assert.equal(status.source, null);
  assert.equal(status.cliLogin, 'missing');
  assert.ok(!('token' in status), 'auth status must never carry a token (ipcHandlers:13256)');
});

test('isCodexAuthError degraded: unclassified, callers use the generic message', () => {
  assert.equal(isCodexAuthError(new Error('boom')), false);
  assert.equal(isCodexAuthError(new Error('Codex login expired, please sign in')), false);
});

test('isBareCodeRequest degraded: false, turns use the continuation classifier', () => {
  assert.equal(isBareCodeRequest('code?'), false);
  assert.equal(isBareCodeRequest('just give me the code, no explanation'), false);
  assert.equal(isBareCodeRequest(''), false);
});

test('looksLikeCodingAnswer degraded: false, no prior-problem inheritance', () => {
  assert.equal(looksLikeCodingAnswer('```python\nprint(1)\n```'), false);
  assert.equal(looksLikeCodingAnswer(''), false);
});

test('totalHardTimeoutMs degraded: mirrors the liveDeadlines ceilings', () => {
  assert.equal(totalHardTimeoutMs({ isLocal: false, isVisionTurn: true }), 8000);
  assert.equal(totalHardTimeoutMs({ isLocal: true, isVisionTurn: true }), 30000);
});

test('repairDeadlineMs degraded: honors the caller floor, defaults to 7000', () => {
  assert.equal(
    repairDeadlineMs({ hasImages: false, isLocal: false, viaServerCascade: false, minMs: 8000 }),
    8000,
  );
  assert.equal(repairDeadlineMs({}), 7000);
});

test('CODING_REGEN_ABORT_CHARS degraded: 4000 truncation guard', () => {
  assert.equal(CODING_REGEN_ABORT_CHARS, 4000);
});

test('acceptRepairedAnswer degraded: conservative reject, keeps the original', () => {
  const verdict = acceptRepairedAnswer({ original: 'orig', repaired: 'fixed', stillInvalid: false });
  assert.equal(verdict.accepted, false);
  assert.equal(verdict.text, 'orig');
  assert.equal(typeof verdict.reason, 'string');
  assert.ok(verdict.reason.length > 0);
});

test('getSourceOwnerEnforcementStage degraded: blocking posture unless dialed off', () => {
  const key = 'REFRACT_SOURCE_OWNER_ENFORCEMENT_STAGE';
  const saved = process.env[key];
  try {
    delete process.env[key];
    assert.equal(getSourceOwnerEnforcementStage(), 'enforce');
    process.env[key] = 'off';
    assert.equal(getSourceOwnerEnforcementStage(), 'off');
    process.env[key] = 'bogus';
    assert.equal(getSourceOwnerEnforcementStage(), 'enforce');
  } finally {
    if (saved === undefined) delete process.env[key];
    else process.env[key] = saved;
  }
});

test('buildManualProfileEvidenceRoute degraded: null route, not-ready log', () => {
  const out = buildManualProfileEvidenceRoute({
    question: 'what did I do at Acme?',
    orchestrator: { activeResume: { structured_data: { name: 'X' } } },
    source: 'manual_input',
    answerType: 'profile_fact_answer',
    allowedSourceKinds: ['profile_resume'],
  });
  assert.equal(out.route, null);
  assert.equal(out.profileFactsReady, false);
  assert.equal(out.routeLog.profileFactsReady, false);
  assert.equal(out.routeLog.source, 'manual_input');
});

test('DOC_GROUNDED_TOKEN_BUDGET degraded: equals the module default budget', () => {
  assert.equal(DOC_GROUNDED_TOKEN_BUDGET, 1800);
});

test('mergeProviderDataScopes degraded: key-preserving merge, undefined-safe', () => {
  assert.deepEqual(
    mergeProviderDataScopes({ transcript: false, code_execution: false }, { transcript: true }),
    { transcript: true, code_execution: false },
  );
  const merged = mergeProviderDataScopes({ code_execution: false }, { screenshots: true });
  assert.equal(merged.code_execution, false);
  assert.equal(merged.screenshots, true);
  assert.deepEqual(mergeProviderDataScopes(undefined, undefined), {});
});

test('appends displaced no existing export', () => {
  assert.equal(typeof CodexCliService.normalizeConfig, 'function');
  assert.equal(typeof buildPriorCodingContextBlock, 'function');
  assert.equal(typeof firstUsefulDeadlineMs, 'function');
  assert.equal(typeof isIntelligenceFlagEnabled, 'function');
  assert.equal(typeof buildManualProfileBackendAnswer, 'function');
  assert.equal(typeof ModeContextRetriever, 'function');
  assert.equal(typeof routeLLMProviders, 'function');
});
