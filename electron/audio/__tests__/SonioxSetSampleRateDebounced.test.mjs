// Regression testar para o "SonioxStreamingSTT.setSampleRate fires
// synchronous stop()+start() and races two WebSocket handshakes" bug.
//
// Symptom: setSampleRate (and setRecognitionLanguage) chamado this.stop()
// então this.start() synchronously. Device rotea changes pode emitir Ambos
// new sample rate AND new language em o mesmo JS tick (e.g. AirPods
// hot-plug). Cada method's stop()+start() define isActive=false então verdadeiro
// sem coordination, leaving two WebSocket coconectar invocations em
// flight — one de them iria lose o race com code 1006 and acionar
// o exponential-backoff reconnect storm.
//
// Fix: rotea ambos setSampleRate and setRecognitionLanguage através a
// shared scheduleRestart() método that debounces por 250ms. Apenas o
// Último rate/language change wins; o timer corpo executa stop()+start()
// exatamente ouma vez após o 250ms quiet period.
//
// SEstratégia structural assertion contra SonioxStreamingSTT.ts sfonte
// This verifica o debounce era added sem needing a fake WebSocket
// fixture (que iria exigir mocking o Soniox endpoint).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const snxPath = path.resolve(__dirname, '../../../electron/audio/SonioxStreamingSTT.ts');
const snxSource = readFileSync(snxPath, 'utf8');

function extractMethodBody(methodName) {
  const re = new RegExp(`(?:^|\\n)\\s*(?:public|private|protected)\\s+(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*(?::[^{]*)?\\{`);
  const m = re.exec(snxSource);
  assert.ok(m, `could not locate ${methodName} declaration in SonioxStreamingSTT.ts`);
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < snxSource.length && depth > 0) {
    const ch = snxSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unbalanced braces in ${methodName}`);
  return snxSource.slice(start, i - 1);
}

test('SonioxStreamingSTT declares pendingRestartTimer field', () => {
  assert.ok(
    /private\s+pendingRestartTimer\s*:\s*NodeJS\.Timeout\s*\|\s*null\s*=\s*null/.test(snxSource),
    'BUG: SonioxStreamingSTT must declare `private pendingRestartTimer: NodeJS.Timeout | null = null;` to track the 250ms debounce.',
  );
});

test('setSampleRate uses scheduleRestart() instead of synchronous stop()+start()', () => {
  const body = extractMethodBody('setSampleRate');
  assert.ok(
    /this\.scheduleRestart\s*\(\s*\)/.test(body),
    'BUG: setSampleRate must call this.scheduleRestart() (the debounced restart) instead of synchronous stop()+start().',
  );
  // Verifica o old synchronous pattern é gone.
  assert.ok(
    !/this\.stop\s*\(\s*\)\s*;[\s\S]{0,50}this\.start\s*\(\s*\)\s*;/.test(body),
    'BUG REGRESSION: setSampleRate still contains synchronous `this.stop(); this.start();` — should call scheduleRestart() instead.',
  );
});

test('setRecognitionLanguage uses scheduleRestart() instead of synchronous stop()+start()', () => {
  const body = extractMethodBody('setRecognitionLanguage');
  assert.ok(
    /this\.scheduleRestart\s*\(\s*\)/.test(body),
    'BUG: setRecognitionLanguage must call this.scheduleRestart() instead of synchronous stop()+start().',
  );
  assert.ok(
    !/this\.stop\s*\(\s*\)\s*;[\s\S]{0,50}this\.start\s*\(\s*\)\s*;/.test(body),
    'BUG REGRESSION: setRecognitionLanguage still contains synchronous `this.stop(); this.start();`.',
  );
});

test('scheduleRestart() debounces at 250ms and bails when no longer active', () => {
  const body = extractMethodBody('scheduleRestart');
  // 250ms debounce datrasar
  assert.ok(
    /setTimeout\s*\([\s\S]*?,\s*250\s*\)/.test(body),
    'BUG: scheduleRestart() must use a 250ms setTimeout (matches RefractProSTT inline reconnect pattern).',
  );
  // pendingRestartTimer é cleared em re-entry.
  assert.ok(
    /if\s*\(\s*this\.pendingRestartTimer\s*\)\s*\{?\s*clearTimeout\s*\(\s*this\.pendingRestartTimer\s*\)/.test(body),
    'BUG: scheduleRestart() must clearTimeout(this.pendingRestartTimer) before assigning a new one so rapid changes coalesce to one restart.',
  );
  // Corpo bails if não longer active.
  assert.ok(
    /if\s*\(\s*!\s*this\.isActive\s*\)\s*return/.test(body),
    'BUG: scheduleRestart()\'s timer body must guard `if (!this.isActive) return;` so a stop() during the 250ms window cancels the queued restart.',
  );
});

test('start() cancels pendingRestartTimer to prevent leftover restarts firing into a fresh session', () => {
  const body = extractMethodBody('start');
  assert.ok(
    /if\s*\(\s*this\.pendingRestartTimer\s*\)[\s\S]*?clearTimeout\s*\(\s*this\.pendingRestartTimer\s*\)/.test(body),
    'BUG: start() must clear this.pendingRestartTimer at the top — otherwise a leftover 250ms debounce from a prior session can fire into the new session and trigger a gratuitous stop+start cycle.',
  );
});

test('clearTimers() clears pendingRestartTimer alongside reconnectTimer and keepAliveTimer', () => {
  const body = extractMethodBody('clearTimers');
  assert.ok(
    /if\s*\(\s*this\.pendingRestartTimer\s*\)[\s\S]*?clearTimeout\s*\(\s*this\.pendingRestartTimer\s*\)[\s\S]*?this\.pendingRestartTimer\s*=\s*null/.test(body),
    'BUG: clearTimers() must include the pendingRestartTimer cleanup so stop()/teardown paths cannot leave a queued restart.',
  );
});
