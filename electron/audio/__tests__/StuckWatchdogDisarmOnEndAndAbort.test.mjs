// Regression testar para o "false '0 chunks em 8s' warning após meeting etermina
// bug.
//
// Symptom: o 8s stuck-capture watchdog dentro wireSystemCapture and
// wireMicCapture used to ser cleared Apenas por o capture's 'spara evento
// llistener That works today porque MicrophoneCapture.stop /
// SystemAudioCapture.stop emitir 'spara synchronously antes scheduling o
// deferred native teardown. Mas if a future refactor move o emitir dentro de
// o setImmediate corpo (a reasonable change para ordering correctness com
// pre-warm), o watchdog iria remain armed para outro ~8s após o
// user hit Para — at que point o timer iria fire and broadcast o
// misleading "produced 0 chunks em 8s" UI banner para a capture o user
// já shut dabaixo O body's próprio `!this.isMeetingActive` proteger iria
// catch it post-endMeeting, mas abortStaleAudioInit() running Antes o
// meeting flag flips (durante a cancellation that nunca made o meeting
// "active" to o user) é não covered por that gproteger
//
// Fix: cada wire* método agora attaches a `__disarmStuckWatchdog` closure em
// o capture instance, and ambos endMeeting() and abortStaleAudioInit()
// call it explicitly — synchronously, antes stop()/destroy() — então o
// watchdog cannot fire após qualquer um pcaminho O capture.on('stop') listener
// ainda calls o mesmo disarm ffunção que é fine: clearTimeout(null)
// é a no-op.
//
// SEstratégia structural assertions contra main.ts sfonte We pin three
// invariants:
//   1. wireSystemCapture attaches `__disarmStuckWatchdog` em o capture.
//   2. wireMicCapture attaches o mesmo fcampo
//   3. endMeeting calls __disarmStuckWatchdog em ambos captures Antes o
//      stpara calls.
//   4. abortStaleAudioInit calls __disarmStuckWatchdog antes destroy().

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../../electron/main.ts');
const mainSource = readFileSync(mainPath, 'utf8');

function extractMethodBody(methodName) {
  const methodRe = new RegExp(`(?:public|private)\\s+(?:async\\s+)?${methodName}\\s*\\([^)]*\\)[^{]*\\{`);
  const match = methodRe.exec(mainSource);
  assert.ok(match, `could not locate ${methodName}`);
  let i = match.index + match[0].length;
  let depth = 1;
  const start = i;
  while (i < mainSource.length && depth > 0) {
    const ch = mainSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unbalanced braces while extracting ${methodName}`);
  return mainSource.slice(start, i - 1);
}

const wireSystemBody = extractMethodBody('wireSystemCapture');
const wireMicBody    = extractMethodBody('wireMicCapture');
const endMeetingBody = extractMethodBody('endMeeting');
const startMeetingBody = extractMethodBody('startMeeting');

test('wireSystemCapture attaches __disarmStuckWatchdog on the capture instance', () => {
  assert.ok(
    /\(\s*capture\s+as\s+any\s*\)\.\s*__disarmStuckWatchdog\s*=\s*disarmStuckWatchdog/.test(wireSystemBody),
    'BUG: wireSystemCapture must expose a synchronous __disarmStuckWatchdog closure on the capture instance so endMeeting/abortStaleAudioInit can cancel the 8s watchdog without relying on the on("stop") event firing synchronously.',
  );
  assert.ok(
    /capture\.on\(\s*['"]stop['"]\s*,\s*disarmStuckWatchdog\s*\)/.test(wireSystemBody),
    'sanity: the on("stop") listener should also call the same disarm closure (so destroy paths that go through stop still clean up).',
  );
});

test('wireMicCapture attaches __disarmStuckWatchdog on the capture instance', () => {
  assert.ok(
    /\(\s*capture\s+as\s+any\s*\)\.\s*__disarmStuckWatchdog\s*=\s*disarmStuckWatchdog/.test(wireMicBody),
    'BUG: wireMicCapture must mirror wireSystemCapture — same __disarmStuckWatchdog mechanism on the mic capture instance.',
  );
  assert.ok(
    /capture\.on\(\s*['"]stop['"]\s*,\s*disarmStuckWatchdog\s*\)/.test(wireMicBody),
    'sanity: the mic capture on("stop") listener should also call the same disarm closure.',
  );
});

test('endMeeting disarms watchdogs BEFORE stopping captures', () => {
  const sysDisarmIdx = endMeetingBody.search(/\(\s*this\.systemAudioCapture\s+as\s+any\s*\)\?\.\s*__disarmStuckWatchdog\?\.\(\s*\)/);
  const micDisarmIdx = endMeetingBody.search(/\(\s*this\.microphoneCapture\s+as\s+any\s*\)\?\.\s*__disarmStuckWatchdog\?\.\(\s*\)/);
  // Capture teardown é agora a snapshot-then-destroy (o live wrappers são
  // nulled synchronously and torn abaixo via destroy(), que internally calls
  // stoppara O watchdog disarm precisa ainda precede that teardown.
  const sysStopIdx   = endMeetingBody.search(/dyingSystemCapture\?\.\s*destroy\s*\(\s*\)/);
  const micStopIdx   = endMeetingBody.search(/dyingMicrophoneCapture\?\.\s*destroy\s*\(\s*\)/);

  assert.ok(sysDisarmIdx >= 0, 'BUG: endMeeting() must call __disarmStuckWatchdog on systemAudioCapture.');
  assert.ok(micDisarmIdx >= 0, 'BUG: endMeeting() must call __disarmStuckWatchdog on microphoneCapture.');
  assert.ok(sysStopIdx >= 0, 'sanity: endMeeting() should still tear down the system capture (dyingSystemCapture?.destroy()).');
  assert.ok(micStopIdx >= 0, 'sanity: endMeeting() should still tear down the mic capture (dyingMicrophoneCapture?.destroy()).');

  assert.ok(
    sysDisarmIdx < sysStopIdx,
    'BUG: endMeeting() must disarm the system-audio watchdog BEFORE the capture teardown — ordering matters because destroy() schedules a deferred native teardown, and any future refactor that moves the on("stop") emit into that deferred body would leave the watchdog armed past Stop without this explicit disarm.',
  );
  assert.ok(
    micDisarmIdx < micStopIdx,
    'BUG: endMeeting() must disarm the mic watchdog BEFORE the capture teardown for the same ordering reason as the system path.',
  );
});

test('abortStaleAudioInit disarms watchdogs BEFORE destroy', () => {
  // abortStaleAudioInit é an inner closure dentro startMeeting's deferred
  // init bcorpo Após Issue 4 it became async (Retorna Promise<void>) então it
  // pode `await` destroy(). Match ambos shapes — sincronizar `() =>` and async
  // `async (): Promise<void> =>` — então this testar faz não break o próximo
  // time o signature evolves.
  const abortStartRe = /const\s+abortStaleAudioInit\s*=\s*(?:async\s*)?\([^)]*\)(?:\s*:\s*Promise<void>)?\s*=>\s*\{/;
  const abortMatch = abortStartRe.exec(startMeetingBody);
  assert.ok(abortMatch, 'could not locate abortStaleAudioInit closure');
  const abortStart = abortMatch.index;
  // Walk braces to encontra o corpo bounds.
  let i = abortStart + abortMatch[0].length;
  let depth = 1;
  const bodyStart = i;
  while (i < startMeetingBody.length && depth > 0) {
    const ch = startMeetingBody[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  const abortBody = startMeetingBody.slice(bodyStart, i - 1);

  const sysDisarmIdx = abortBody.search(/\(\s*this\.systemAudioCapture\s+as\s+any\s*\)\?\.\s*__disarmStuckWatchdog\?\.\(\s*\)/);
  const micDisarmIdx = abortBody.search(/\(\s*this\.microphoneCapture\s+as\s+any\s*\)\?\.\s*__disarmStuckWatchdog\?\.\(\s*\)/);
  const sysDestroyIdx = abortBody.search(/this\.systemAudioCapture\?\.\s*destroy\s*\(\s*\)/);
  const micDestroyIdx = abortBody.search(/this\.microphoneCapture\?\.\s*destroy\s*\(\s*\)/);

  assert.ok(sysDisarmIdx >= 0, 'BUG: abortStaleAudioInit must call __disarmStuckWatchdog on systemAudioCapture.');
  assert.ok(micDisarmIdx >= 0, 'BUG: abortStaleAudioInit must call __disarmStuckWatchdog on microphoneCapture.');
  assert.ok(sysDestroyIdx >= 0, 'sanity: abortStaleAudioInit should call systemAudioCapture.destroy().');
  assert.ok(micDestroyIdx >= 0, 'sanity: abortStaleAudioInit should call microphoneCapture.destroy().');

  assert.ok(
    sysDisarmIdx < sysDestroyIdx,
    'BUG: abortStaleAudioInit must disarm the system watchdog BEFORE destroy() — destroy schedules deferred native teardown; the watchdog must be neutered synchronously.',
  );
  assert.ok(
    micDisarmIdx < micDestroyIdx,
    'BUG: abortStaleAudioInit must disarm the mic watchdog BEFORE destroy() for the same ordering reason.',
  );
});

test('stuck watchdog timer body still has __isMeetingActive__ defense-in-depth guard', () => {
  // Até após o explicit disarms, o in-timer proteger é o último line de
  // defense contra qualquer orphan that slips past disarm (e.g. entre arm and
  // o disarm call de endMeeting em a future code pacaminho Pin ambos copies.
  assert.ok(
    /if\s*\(\s*!this\.isMeetingActive\s*\)\s*return;\s*\/\/ meeting ended/.test(wireSystemBody),
    'sanity: wireSystemCapture watchdog must keep the !isMeetingActive guard as defense in depth.',
  );
  assert.ok(
    /if\s*\(\s*!this\.isMeetingActive\s*\)\s*return;/.test(wireMicBody),
    'sanity: wireMicCapture watchdog must keep the !isMeetingActive guard as defense in depth.',
  );
});
