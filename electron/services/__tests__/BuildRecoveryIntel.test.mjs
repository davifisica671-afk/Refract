import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildTurnContractIfEnabled,
  ProfileEvidenceService,
  checkImpossibleEvidenceState,
  clarificationShortCircuitEnabled,
  clarificationIsActionable,
  buildSourceClarification,
  buildContextOsTrace,
  logContextOsTrace,
  allowsEvidence,
  TurnEvidenceCoordinator,
  packGovernsGeneration,
  toRecalledMemoryEvidence,
  renderHindsightRecallBlock,
  textCanProveProperty,
  buildInsufficientPropertyAnswer,
  buildAssistantClaims,
  parseModeSnippets,
  getContextOsBenchmarkAudit,
  clearContextOsBenchmarkAudit,
} from '../../../dist-electron/electron/intelligence/context-os/index.js';
import { emptyEvidencePack } from '../../../dist-electron/electron/intelligence/context-os/evidencePack.js';
import { EvidenceResolver } from '../../../dist-electron/electron/intelligence/context-os/EvidenceResolver.js';
import { DirectAssistService } from '../../../dist-electron/electron/direct-assist.js';
import {
  NO_CONVERSATION_SCOPE,
  resolveConversationSessionId,
  recordAnswerSummary,
  clearConversationState,
} from '../../../dist-electron/electron/context-intelligence/question/conversation-state-store.js';

test('context-os: contract builder is null-safe (Context OS off, degraded)', () => {
  const contract = buildTurnContractIfEnabled({
    surface: 'manual_chat',
    question: 'what is this?',
    activeModeId: null,
    activeModeName: null,
    sourceAuthority: 'ask_if_ambiguous',
    answerType: 'unknown_answer',
    plannerVoicePerspective: 'second',
    hasReferenceFiles: false,
    hasProfileFacts: false,
    hasLiveTranscript: false,
    userExplicitSource: null,
    turnSourceDecision: null,
    turnId: 'turn-1',
  });
  assert.equal(contract, null);
});

test('context-os: clarification gates stay quiet (degraded)', () => {
  assert.equal(clarificationShortCircuitEnabled(), false);
  assert.equal(
    clarificationIsActionable({ sourceAuthority: null, hasReferenceFiles: false }),
    false,
  );
  assert.equal(
    buildSourceClarification({
      hasReferenceFiles: false,
      hasProfileFacts: false,
      hasLiveTranscript: false,
    }),
    '',
  );
});

test('context-os: evidence gates deny, traces noop (degraded)', () => {
  assert.equal(allowsEvidence(null, 'profile_resume'), false);
  assert.equal(
    packGovernsGeneration({
      answerPolicy: 'answer',
      sourceAuthority: null,
      hasReferenceFiles: false,
    }),
    false,
  );
  assert.doesNotThrow(() => logContextOsTrace(buildContextOsTrace({
    contract: null,
    sourceAuthority: 'ask_if_ambiguous',
    question: 'q',
    finalAction: 'answer',
  })));
  assert.doesNotThrow(() => logContextOsTrace(buildContextOsTrace({
    contract: null,
    sourceAuthority: 'ask_if_ambiguous',
    question: 'q',
    usedSources: [],
    finalAction: 'clarify',
  })));
});

test('context-os: profile evidence service returns empty pack (degraded)', () => {
  const svc = new ProfileEvidenceService();
  const pack = svc.retrieveEvidence({
    question: 'q',
    contract: null,
    profile: null,
    jobDescription: null,
    answerType: 'unknown_answer',
  });
  assert.deepEqual(pack.items, []);
  assert.equal(typeof pack.turnId, 'string');
  const check = checkImpossibleEvidenceState(pack, 'allowed');
  assert.equal(check.ok, true);
  assert.deepEqual(check.violations, []);
});

test('context-os: coordinator resolves empty pack with no failures (degraded)', async () => {
  const coordinator = new TurnEvidenceCoordinator();
  const result = await coordinator.resolve({
    decision: null,
    contract: null,
    retrieveReferenceEvidence: undefined,
    retrieveProfileEvidence: undefined,
  });
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.pack.items, []);
});

test('context-os: memory recall renders nothing (degraded)', () => {
  assert.deepEqual(toRecalledMemoryEvidence([{ text: 'fact' }], null), []);
  assert.equal(renderHindsightRecallBlock([]), '');
});

test('context-os: property gate fails closed, refusal line stays honest (degraded)', () => {
  assert.equal(textCanProveProperty('some block', 'unknown'), false);
  const line = buildInsufficientPropertyAnswer({ property: 'unknown' });
  assert.ok(line.length > 0);
});

test('context-os: claim persistence writes nothing (degraded)', () => {
  const pack = emptyEvidencePack({ turnId: 't' });
  assert.deepEqual(
    buildAssistantClaims({
      answer: 'hello world, this is a longer answer',
      contract: { turnId: 't', sourceOwner: 'ask', requestedProperty: 'unknown' },
      evidencePack: pack,
    }),
    [],
  );
  assert.deepEqual(parseModeSnippets('## EVIDENCE\ntext'), []);
});

test('context-os: benchmark audit empty + clearable (degraded)', () => {
  assert.deepEqual(getContextOsBenchmarkAudit(), []);
  assert.doesNotThrow(() => clearContextOsBenchmarkAudit());
  assert.deepEqual(getContextOsBenchmarkAudit(), []);
});

test('evidencePack: empty pack carries args with no cards and no govern (degraded)', () => {
  const pack = emptyEvidencePack({
    turnId: 'turn-1',
    sourceOwner: 'reference_files',
    requestedProperty: 'unknown',
    answerPolicy: 'refuse_insufficient_evidence',
  });
  assert.equal(pack.turnId, 'turn-1');
  assert.deepEqual(pack.cards, []);
  assert.equal(pack.govern, false);
  assert.deepEqual(pack.items, []);
});

test('EvidenceResolver: resolves to an empty pack (degraded)', async () => {
  const resolver = new EvidenceResolver({
    getModeSnapshot: () => null,
    getReferenceFiles: () => [],
    hybridRetriever: { retrieveHybrid: () => [] },
    knowledgeManager: { getPackForFile: () => null },
    classifyQuestion: () => ({ targetEntities: [] }),
    queryOkfCards: () => [],
  });
  const resolution = await resolver.resolve({
    turnId: 'turn-1',
    question: 'what is this?',
    sourceContract: null,
    activeMode: { modeId: 'm', modeUniqueId: 'm' },
    requestedProperty: 'unknown',
    transcript: '',
  });
  assert.deepEqual(resolution.pack.cards, []);
  assert.equal(resolution.pack.govern, false);
});

test('DirectAssistService: constructs, stream throws typed unavailable (degraded)', async () => {
  const service = new DirectAssistService({ getDirectAssistSelection: () => null });
  await assert.rejects(
    async () => {
      const gen = service.stream(
        {
          requestId: 'r1',
          source: 'typed',
          selection: { provider: 'p', model: 'm' },
          currentRequest: 'hello',
        },
        new AbortController().signal,
      );
      for await (const _event of gen) { /* must throw before yielding */ }
    },
    /unavailable/i,
  );
});

test('conversation-state-store: scope const, session resolve, sinks noop (degraded)', () => {
  assert.equal(typeof NO_CONVERSATION_SCOPE, 'string');
  assert.equal(resolveConversationSessionId(null, 'sender-1'), 'sender-1');
  assert.equal(resolveConversationSessionId(null, ''), NO_CONVERSATION_SCOPE);
  assert.doesNotThrow(() => recordAnswerSummary('sender-1', 'answer', undefined));
  assert.doesNotThrow(() => recordAnswerSummary('sender-1', 'answer', undefined, 'q', { anchor: true }));
  assert.doesNotThrow(() => clearConversationState('sender-1'));
  assert.doesNotThrow(() => clearConversationState());
});
