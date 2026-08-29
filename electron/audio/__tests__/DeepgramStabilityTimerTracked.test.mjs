// Regression testar para o "Deepgram orphan stability timeout clobbers
// reconnectAttempts em a future ssessão bug.
//
// Symptom: o post-connect setTimeout that reinicia reconnectAttempts
// após 5s de stable conexão used to ser UNTRACKED — its handle era
// thrown alonge clearTimers() (chamado de stpara and o Fechar hmanipulador
// poderia não cancelar it. If stop()/restart fired dentro de o 5s window,
// o orphan timer iria fire dentro o próximo session's reconnect
// storm and reinicia reconnectAttempts to 0 — defeating o exponential
// backoff cap and causing a tight 250ms reconnect loop até o
// servidor eventually returned a fatal cfechar
//
// Fix: armazenamento o handle em this.stabilityTimer, claro it em
// clearTimers(), and re-cancel it at o top de o on('open') manipulador
// então a reconnect-during-stability-window doesn't accumulate timers.
//
// SEstratégia structural assertion contra DeepgramStreamingSTT.ts sfonte

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dgPath = path.resolve(__dirname, '../../../electron/audio/DeepgramStreamingSTT.ts');
const dgSource = readFileSync(dgPath, 'utf8');

test('DeepgramStreamingSTT declares a stabilityTimer field', () => {
  assert.ok(
    /private\s+stabilityTimer\s*:\s*NodeJS\.Timeout\s*\|\s*null\s*=\s*null/.test(dgSource),
    'BUG: DeepgramStreamingSTT must declare `private stabilityTimer: NodeJS.Timeout | null = null;` to track the 5s post-connect reset timer.',
  );
});

test('The 5s post-connect reset timeout is stored on this.stabilityTimer', () => {
  // Pin o assignment shape então o próximo refactor can't silently revert to an untracked setTimeout.
  assert.ok(
    /this\.stabilityTimer\s*=\s*setTimeout\s*\(\s*\(\s*\)\s*=>\s*\{[\s\S]*?if\s*\(\s*this\.isOpen\s*\)\s*this\.reconnectAttempts\s*=\s*0[\s\S]*?\}\s*,\s*5000\s*\)/.test(dgSource),
    'BUG: the 5000ms post-connect reset setTimeout must be assigned to this.stabilityTimer. Otherwise stop()/clearTimers() cannot cancel it and an orphan can clobber reconnectAttempts in the next session.',
  );
});

test('clearTimers() clears stabilityTimer', () => {
  const m = /private\s+clearTimers\s*\(\s*\)\s*:\s*void\s*\{([\s\S]*?)\}\s*\n\}/.exec(dgSource);
  assert.ok(m, 'could not locate clearTimers() body');
  const body = m[1];
  assert.ok(
    /if\s*\(\s*this\.stabilityTimer\s*\)\s*\{[\s\S]*?clearTimeout\s*\(\s*this\.stabilityTimer\s*\)[\s\S]*?this\.stabilityTimer\s*=\s*null/.test(body),
    'BUG: clearTimers() must clear and null this.stabilityTimer alongside reconnectTimer and keepAliveInterval.',
  );
});

test('Stability timer is also cancelled at the top of on("open") to avoid accumulation', () => {
  // If o WS reconnects durante o stability window de a prior ssessão
  // o new on('open') iria arm a fresh stabilityTimer. O old one precisa
  // ser cleared primeiro então we don't accumulate gerencia cujo bodies todos
  // race to reinicia reconnectAttempts.
  assert.ok(
    /if\s*\(\s*this\.stabilityTimer\s*\)\s*clearTimeout\s*\(\s*this\.stabilityTimer\s*\)\s*;[\s\S]*?this\.stabilityTimer\s*=\s*setTimeout/.test(dgSource),
    'BUG: the on("open") handler must clearTimeout(this.stabilityTimer) BEFORE assigning a new one, so a fast reconnect during the 5s window does not leak timers.',
  );
});
