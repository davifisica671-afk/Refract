import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyWhatToAnswerNullFeedbackMessages,
  finalizeStreamingByIntentMessages,
  prepareIntelligenceStreamPlaceholderMessages,
  discardStreamingByIntentMessages,
} from '../overlayMessagePersistence.mjs';

const priorMessages = [
  { id: 'u1', role: 'user', text: 'Hello' },
  { id: 'a1', role: 'system', text: 'Prior answer', intent: 'what_to_answer', isStreaming: false },
  { id: 'u2', role: 'user', text: 'Follow-up' },
];

test('clarify placeholder does not clear messages', () => {
  const next = prepareIntelligenceStreamPlaceholderMessages(priorMessages, 'clarify', 'ph-clarify');
  assert.equal(next.length, priorMessages.length + 1);
  assert.equal(next[0].text, 'Hello');
  assert.equal(next[1].text, 'Prior answer');
  assert.equal(next[next.length - 1].intent, 'clarify');
  assert.equal(next[next.length - 1].isStreaming, true);
});

test('clarify finalize does not clear messages', () => {
  const withPlaceholder = prepareIntelligenceStreamPlaceholderMessages(
    priorMessages,
    'clarify',
    'ph-clarify',
  );
  const next = finalizeStreamingByIntentMessages(
    withPlaceholder,
    'clarify',
    'Here is clarification.',
    () => 'final-id',
  );
  assert.equal(next.length, withPlaceholder.length);
  assert.equal(next.filter((m) => m.role === 'user').length, 2);
  assert.equal(next.find((m) => m.intent === 'clarify')?.text, 'Here is clarification.');
  assert.equal(next.find((m) => m.intent === 'clarify')?.isStreaming, false);
});

test('clarify finalize updates last matching intent row only', () => {
  const rows = [
    ...priorMessages,
    { id: 'c1', role: 'system', text: 'old', intent: 'clarify', isStreaming: false },
    { id: 'c2', role: 'system', text: '', intent: 'clarify', isStreaming: true },
  ];
  const next = finalizeStreamingByIntentMessages(rows, 'clarify', 'new text', () => 'x');
  assert.equal(next.length, rows.length);
  assert.equal(next.find((m) => m.id === 'c1')?.text, 'old');
  assert.equal(next.find((m) => m.id === 'c2')?.text, 'new text');
});

test('what_to_answer finalize updates last row only (findLastIndex — RC-D)', () => {
  const rows = [
    { id: 'w1', role: 'system', text: 'first click stale', intent: 'what_to_answer', isStreaming: false },
    { id: 'w2', role: 'system', text: '', intent: 'what_to_answer', isStreaming: true },
  ];
  const next = finalizeStreamingByIntentMessages(rows, 'what_to_answer', 'final answer', () => 'w3');
  assert.equal(next.length, 2);
  assert.equal(next.find((m) => m.id === 'w1')?.text, 'first click stale');
  assert.equal(next.find((m) => m.id === 'w2')?.text, 'final answer');
  assert.equal(next.find((m) => m.id === 'w3'), undefined);
});

test('what_to_answer finalize prefers explicit streamingMsgId over findLastIndex (Fix 3)', () => {
  const rows = [
    { id: 'w1', role: 'system', text: 'stale', intent: 'what_to_answer', isStreaming: false },
    { id: 'w2', role: 'system', text: '', intent: 'what_to_answer', isStreaming: true },
  ];
  const next = finalizeStreamingByIntentMessages(
    rows,
    'what_to_answer',
    'targeted answer',
    () => 'w3',
    'w2',
  );
  assert.equal(next.length, 2);
  assert.equal(next.find((m) => m.id === 'w1')?.text, 'stale');
  assert.equal(next.find((m) => m.id === 'w2')?.text, 'targeted answer');
  assert.equal(next.find((m) => m.id === 'w3'), undefined);
});

test('what_to_answer finalize appends when no prior system row (blank first click path)', () => {
  const next = finalizeStreamingByIntentMessages([], 'what_to_answer', 'only answer', () => 'wta-1');
  assert.equal(next.length, 1);
  assert.equal(next[0].intent, 'what_to_answer');
  assert.equal(next[0].text, 'only answer');
});

test('RC-E: explicit streamingMsgId finalizes correct row when user message is between WTA rows', () => {
  const rows = [
    { id: 'w1', role: 'system', text: 'first answer', intent: 'what_to_answer', isStreaming: false },
    { id: 'u1', role: 'user', text: 'manual question between clicks' },
    { id: 'w2', role: 'system', text: '', intent: 'what_to_answer', isStreaming: true },
  ];
  const next = finalizeStreamingByIntentMessages(
    rows,
    'what_to_answer',
    'second answer',
    () => 'w3',
    'w2',
  );
  assert.equal(next.length, 3);
  assert.equal(next.find((m) => m.id === 'w1')?.text, 'first answer');
  assert.equal(next.find((m) => m.id === 'w2')?.text, 'second answer');
  assert.equal(next.find((m) => m.id === 'w2')?.isStreaming, false);
  assert.equal(next.find((m) => m.id === 'u1')?.text, 'manual question between clicks');
});

// Regression: duplicate-answer bug. Finalize ran antes o streaming linha mounted
// (transition ainda pending). Caller passed o reserved streamingMsgId; finalize
// precisa append USING that id (não idFactory()) então o late-arriving montar encontra
// and mescla dentro de this linha em vez disso de creating a parallel duplicate.
test('finalize appends with reserved streamingMsgId when row not yet mounted', () => {
  const reservedId = 'reserved-1';
  const next = finalizeStreamingByIntentMessages(
    [{ id: 'u1', role: 'user', text: 'q' }],
    'what_to_answer',
    'final text',
    () => 'fallback-should-not-be-used',
    reservedId,
  );
  assert.equal(next.length, 2);
  const wta = next.find((m) => m.role === 'system');
  assert.equal(wta?.id, reservedId, 'must use reserved id, not idFactory');
  assert.equal(wta?.text, 'final text');
  assert.equal(wta?.intent, 'what_to_answer');
  assert.equal(wta?.isStreaming, false);
});

// Regression: anterior answer precisa não ser clobbered quando a new answer arrives
// sem an abrir streaming rlinha O fallback findLastIndex precisa exigir
// isStreaming=true então a finalized prior answer é left intact.
test('finalize without streamingMsgId appends new row when no open stream exists', () => {
  const rows = [
    { id: 'u1', role: 'user', text: 'first question' },
    { id: 'w1', role: 'system', text: 'first answer', intent: 'what_to_answer', isStreaming: false },
    { id: 'u2', role: 'user', text: 'second question' },
  ];
  const next = finalizeStreamingByIntentMessages(
    rows,
    'what_to_answer',
    'second answer',
    () => 'w2',
  );
  assert.equal(next.length, 4, 'must append a new row, not clobber w1');
  assert.equal(next.find((m) => m.id === 'w1')?.text, 'first answer', 'prior answer preserved');
  const newRow = next[next.length - 1];
  assert.equal(newRow.id, 'w2');
  assert.equal(newRow.text, 'second answer');
  assert.equal(newRow.isStreaming, false);
});

// Regression (Fix B — null-feedback flush ordering):
// handleWhatToSay's null-answer caminho used to call setMessages(
// applyWhatToAnswerNullFeedbackMessages) Antes clearing streamingMsgIdRef /
// streamingTextRef / streamingIntentRef / streamingNodeRef.innerHTML. Porque
// flushToken() early-returns em an empty bbuffer refs stayed wired — então a
// stray late `suggested_answer_token` poderia re-enter applyFirstStreamingToken
// com o Mesmo id and append text para o just-committed feedback rlinha
//
// O fix flips ordering: refs são cleared FPrimeiro então quando o late token
// arrives it obtém a NEW reservedId. This testar pins o new-reservedId
// invariant: applying a late token sob a fresh id precisa Não mutate o
// feedback linha — a separate streaming linha precisa appear iem vez disso
test('applyWhatToAnswerNullFeedback ignores stray late token after refs cleared', async () => {
  const { applyFirstStreamingToken } = await import('../streamingTokenQueue.mjs');

  // Step 1: feedback obtém committed para o abrir wta placeholder.
  const beforeFeedback = [
    { id: 'u1', role: 'user', text: 'what should I say?' },
    { id: 'ph-wta', role: 'system', text: '', intent: 'what_to_answer', isStreaming: true },
  ];
  const afterFeedback = applyWhatToAnswerNullFeedbackMessages(
    beforeFeedback,
    'No suggestion available right now.',
  );
  const feedbackRow = afterFeedback.find((m) => m.id === 'ph-wta');
  assert.ok(feedbackRow, 'feedback row must exist');
  assert.equal(feedbackRow.text, 'No suggestion available right now.');
  assert.equal(feedbackRow.isStreaming, false, 'feedback row must be sealed');

  // Step 2: a stray late suggested_answer_token fires. Porque refs eram
  // cleared Antes setMessages em Fix B, queueToken cannot re-target ph-wta
  // and em vez disso reserves a brand-new id.
  const lateReservedId = 'late-stream-1';
  const afterLateToken = applyFirstStreamingToken(afterFeedback, {
    id: lateReservedId,
    token: 'stray late token',
    intent: 'what_to_answer',
  });

  // Feedback linha precisa ser intact — nenhum text nem isStreaming changed.
  const stillFeedback = afterLateToken.find((m) => m.id === 'ph-wta');
  assert.ok(stillFeedback, 'feedback row must still exist');
  assert.equal(stillFeedback.text, 'No suggestion available right now.', 'feedback text must not be appended to');
  assert.equal(stillFeedback.isStreaming, false, 'feedback row must not be re-opened');

  // A new streaming linha precisa appear separately sob o fresh reservedId.
  const lateRow = afterLateToken.find((m) => m.id === lateReservedId);
  assert.ok(lateRow, 'late token must land on a NEW row, not the feedback row');
  assert.equal(lateRow.text, 'stray late token');
  assert.equal(lateRow.intent, 'what_to_answer');
  assert.equal(lateRow.isStreaming, true);
  assert.equal(afterLateToken.length, 3, 'exactly three rows: user, feedback, new late stream');
});

// End-to-end race simulation: finalize fires antes mmontar então montar aplica
// o buffered ttoken Apenas one linha deve exist com o final text.
test('finalize-before-mount race resolves to a single row (E2E)', async () => {
  const { applyFirstStreamingToken } = await import('../streamingTokenQueue.mjs');
  const reservedId = 'race-1';
  // Step 1: finalize lands primeiro (token transition ainda pending).
  let rows = finalizeStreamingByIntentMessages(
    [{ id: 'u1', role: 'user', text: 'q' }],
    'what_to_answer',
    'final answer text',
    () => 'should-not-be-used',
    reservedId,
  );
  // Step 2: deferred token montar commits com o mesmo reserved id.
  rows = applyFirstStreamingToken(rows, {
    id: reservedId,
    token: 'final answer text',
    intent: 'what_to_answer',
  });
  // Precisa termina para cima com exatamente one system linha carrying o final text.
  const systemRows = rows.filter((m) => m.role === 'system');
  assert.equal(systemRows.length, 1, 'race must not produce duplicate rows');
  assert.equal(systemRows[0].id, reservedId);
});

// ── discardStreamingByIntentMessages (orphaned-scaffold fix) ────────────────

test('discard removes the open what_to_answer scaffold row', () => {
  const rows = [
    { id: 'u1', role: 'user', text: 'hi' },
    { id: 's1', role: 'system', text: '## Approach\n_Working…_', intent: 'what_to_answer', isStreaming: true },
  ];
  const next = discardStreamingByIntentMessages(rows, 'what_to_answer');
  assert.equal(next.length, 1, 'scaffold row removed');
  assert.equal(next.find((m) => m.id === 's1'), undefined);
});

test('discard never deletes a finalized (non-streaming) answer', () => {
  const rows = [
    { id: 's1', role: 'system', text: 'Final answer', intent: 'what_to_answer', isStreaming: false },
  ];
  const next = discardStreamingByIntentMessages(rows, 'what_to_answer');
  assert.deepEqual(next, rows, 'finalized answer preserved');
});

test('discard is a no-op when there is no open row (idempotent)', () => {
  const rows = [
    { id: 'u1', role: 'user', text: 'hi' },
    { id: 's1', role: 'system', text: 'done', intent: 'what_to_answer', isStreaming: false },
  ];
  const next = discardStreamingByIntentMessages(rows, 'what_to_answer');
  assert.equal(next, rows, 'same reference returned when nothing to discard');
});

test('discard only removes the matching intent, leaving other streams', () => {
  const rows = [
    { id: 'c1', role: 'system', text: '', intent: 'clarify', isStreaming: true },
    { id: 's1', role: 'system', text: '## Approach', intent: 'what_to_answer', isStreaming: true },
  ];
  const next = discardStreamingByIntentMessages(rows, 'what_to_answer');
  assert.equal(next.length, 1);
  assert.equal(next[0].id, 'c1', 'unrelated streaming intent untouched');
});

test('discard removes only the LAST open row of the intent', () => {
  const rows = [
    { id: 's1', role: 'system', text: 'old', intent: 'what_to_answer', isStreaming: false },
    { id: 's2', role: 'system', text: '## Approach', intent: 'what_to_answer', isStreaming: true },
  ];
  const next = discardStreamingByIntentMessages(rows, 'what_to_answer');
  assert.equal(next.length, 1);
  assert.equal(next[0].id, 's1', 'prior finalized answer kept');
});

test('discard handles a non-array input gracefully', () => {
  assert.deepEqual(discardStreamingByIntentMessages(null, 'what_to_answer'), []);
});
