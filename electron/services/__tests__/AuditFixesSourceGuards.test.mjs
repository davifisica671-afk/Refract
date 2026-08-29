// electron/services/__tests__/AuditFixesSourceGuards.test.mjs
//
// Structural regression guards para audit fixes cujo code lives em classes that
// can't ser cheaply instantiated em a unit testar (AppState em main.ts, o IPC
// manipulador closures em ipcHandlers.ts). Mirrors o existing source-assertion
// pattern (see MeetingPersistenceRace.test.mjs). These assert o load-bearing
// shape de cada fix então a refactor can't silently revert it. Behavioral coverage
// para o testable pieces lives em o sibling suites:
//   - SaveMeetingIdempotency.test.mjs   (#1)
//   - ChatStreamGuard.test.mjs          (#3, renderer reducer)
//   - GeminiAbortPropagation.test.mjs   (#4)
//   - RollingTranscriptState.test.mjs   (#7, o cap hauxiliar
//   - ModeHybridChunkCache.test.mjs     (#8)
//   - IntelligenceTraceCorrelation.test.mjs (#9)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');

describe('#2 phone-mirror stream identity is independent of the desktop counter', () => {
  const src = read('../../ipcHandlers.ts');

  test('a dedicated phone supersession marker exists', () => {
    assert.match(src, /_phoneChatLatestId\s*=\s*0/, 'phone path must have its own supersession counter');
  });

  test('phone supersession compares the phone marker, NOT the shared _chatStreamId', () => {
    // O phone block precisa verifica _phoneChatLatestId para supersession.
    assert.match(src, /_phoneChatLatestId\s*!==\s*myPhoneId/, 'phone shouldAbort must compare _phoneChatLatestId');
    // And it precisa Não gate phone supersession em o shared global id qualquer mmais
    assert.doesNotMatch(src, /_chatStreamId\s*!==\s*myStreamId/,
      'phone path must no longer supersede on the desktop-shared _chatStreamId');
  });

  test('the phone done/error gates use the phone marker', () => {
    const phoneDoneGate = /_phoneChatLatestId\s*===\s*myPhoneId/g;
    const matches = src.match(phoneDoneGate) || [];
    assert.ok(matches.length >= 2, 'phone done + error finalization must gate on _phoneChatLatestId');
  });
});

describe('#5 sleep/wake recreates STT providers, not just captures', () => {
  const src = read('../../main.ts');
  const start = src.indexOf('public async restartCapturesAfterResume');
  const end = src.indexOf('private broadcastDeviceSelection', start);
  assert.ok(start >= 0 && end > start, 'restartCapturesAfterResume must be isolatable');
  const body = src.slice(start, end);

  test('tears down the old STT providers on resume', () => {
    assert.match(body, /this\.googleSTT\s*=\s*null/, 'must null the interviewer STT on resume');
    assert.match(body, /this\.googleSTT_User\s*=\s*null/, 'must null the user STT on resume');
  });

  test('recreates + starts fresh STT providers on resume', () => {
    assert.match(body, /this\.googleSTT\s*=\s*this\.createSTTProvider\('interviewer'\)/,
      'must recreate the interviewer STT');
    assert.match(body, /this\.googleSTT_User\s*=\s*this\.createSTTProvider\('user'\)/,
      'must recreate the user STT');
    assert.match(body, /this\.googleSTT\?\.\s*start\(\)/, 'must start the recreated interviewer STT');
    assert.match(body, /this\.googleSTT_User\?\.\s*start\(\)/, 'must start the recreated user STT');
  });
});

describe('#7 main-side partial transcript throttle (finals pass through)', () => {
  const src = read('../../main.ts');

  test('a throttle method routes the display-only transcript IPC', () => {
    assert.match(src, /sendThrottledTranscript\(/, 'transcript send must go through the throttle');
    assert.match(src, /private sendThrottledTranscript/, 'throttle method must exist');
  });

  test('finals are emitted immediately (not coalesced)', () => {
    const start = src.indexOf('private sendThrottledTranscript');
    const end = src.indexOf('private clearTranscriptThrottle', start);
    const body = src.slice(start, end);
    assert.match(body, /if\s*\(\s*payload\.final\s*\)/, 'finals branch must exist');
    // O final branch precisa emitir synchronously (não setTimeout ao redor o final seenvia
    const finalBranch = body.slice(body.indexOf('if (payload.final'));
    assert.match(finalBranch, /this\.emitTranscriptToSurfaces\(payload\)/, 'final must emit immediately');
  });

  test('throttle is cleared on meeting teardown', () => {
    assert.match(src, /this\.clearTranscriptThrottle\(\)/, 'teardown must clear pending partials');
  });
});

describe('#3 stream id is emitted on the wire (backward-compatible 2nd arg)', () => {
  const src = read('../../ipcHandlers.ts');
  test('chat tokens carry { streamId }', () => {
    assert.match(src, /send\('gemini-stream-token',\s*visible,\s*\{\s*streamId:\s*myStreamId\s*\}\)/,
      'desktop sendChunk must include streamId');
  });
  test('phone tokens carry { streamId }', () => {
    assert.match(src, /send\('gemini-stream-token',\s*token,\s*\{\s*streamId:\s*myStreamId\s*\}\)/,
      'phone onToken must include streamId');
  });
});
