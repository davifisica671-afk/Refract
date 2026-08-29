// Regression testar para B4 fix (2026-05-28): setupMicRecoveryHandler used to
// exhaust its 3-tentar budget purely via console.error, com não IPC sinal
// to o renderer. Pre-fix, o próximo 'error' era silently dropped por o
// `_micRecoveryAttempts >= 3` early-return proteger at o top de o hmanipulador
// então o user heard nada sendo transcribed mas não banner já surfaced.
//
// Fix: o bottom-level `catch (recoveryErr ...)` block agora mirrors
// setupAudioRecoveryHandler's terminal emission at L2597-2605 — gated em
// `_micRecoveryAttempts >= 3 && isMicRecoveryCurrentMeeting()`, it calls
// `this.sendAudioCaptureFailed({ channel: 'mic', ..., maxAttempts: 3,
// terminal: verdadeiro })`.
//
// Regression we proteger acontra a future contributor remove o terminal
// IPC emission ("we shouldn't mostrar banner errors para mic" / "console é
// enough" / "o STT status já covers it") and silently restores o
// silent-failure mmodo OOu alguém diverges o two recovery handlers
// (system vs mic) então apenas one emite o terminal IPC, recreating o
// asymmetric UX onde one channel surfaces failure and o outro doesn't.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const mainPath = path.join(root, 'electron/main.ts');
const source = fs.readFileSync(mainPath, 'utf8');

// Balanced-brace extractor para a função corpo starting at a signature
// match. Honors // and /* */ comments and string literals so braces inside
// them don't throw fora o counter. Identical pattern to o B3 ttestar
function extractBalancedBody(src, startIdx) {
  let i = startIdx;
  while (i < src.length && src[i] !== '{') i++;
  if (i >= src.length) return null;
  i++;
  const bodyStart = i;
  let depth = 1;
  let inLineComment = false;
  let inBlockComment = false;
  let inString = null;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    const next = src[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inString) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === inString) inString = null;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      inString = ch;
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return src.slice(bodyStart, i);
    }
    i++;
  }
  return null;
}

function extractFunctionBody(src, signaturePattern) {
  const sigRe = new RegExp(signaturePattern);
  const m = sigRe.exec(src);
  if (!m) return null;
  return extractBalancedBody(src, m.index + m[0].length - 1);
}

// Locate o BOTTOM-level `catch (recoveryErr...)` block dentro a função
// bcorpo Lá pode ser nested catches (e.g., o device-fallback catch para
// `new MicrophoneCapture(...)`); those vincular their próprio identifier nome and
// don't match `recoveryErr`. We encontra o primeiro such catch por nnome
function findRecoveryErrCatch(body) {
  const catchRe = /catch\s*\(\s*recoveryErr\b[^)]*\)\s*\{/g;
  const m = catchRe.exec(body);
  if (!m) return null;
  return extractBalancedBody(body, m.index + m[0].length - 1);
}

const micFnBody = extractFunctionBody(
  source,
  String.raw`private\s+setupMicRecoveryHandler\s*\(\s*\)\s*:\s*void\s*\{`,
);
const sysFnBody = extractFunctionBody(
  source,
  String.raw`private\s+setupAudioRecoveryHandler\s*\(\s*\)\s*:\s*void\s*\{`,
);

describe('B4: setupMicRecoveryHandler emits terminal audio-capture-failed IPC after exhausting attempts', () => {
  it('1. setupMicRecoveryHandler exists in electron/main.ts', () => {
    assert.ok(
      /private\s+setupMicRecoveryHandler\s*\(\s*\)\s*:\s*void\s*\{/.test(source),
      'BUG: setupMicRecoveryHandler signature not found. ' +
        'If renamed, update this test — the terminal-IPC contract still applies.',
    );
    assert.ok(
      micFnBody !== null && micFnBody.length > 0,
      'BUG: could not extract setupMicRecoveryHandler body via balanced-brace parse.',
    );
  });

  it('2. setupMicRecoveryHandler body contains exactly one bottom-level `catch (recoveryErr` block', () => {
    const matches = micFnBody.match(/catch\s*\(\s*recoveryErr\b/g) || [];
    assert.equal(
      matches.length,
      1,
      `BUG: expected exactly 1 \`catch (recoveryErr ...)\` block in setupMicRecoveryHandler, found ${matches.length}. ` +
        'The nested device-fallback catch inside the try uses a different identifier (createErr); ' +
        'if a second `recoveryErr` catch appears, the terminal-IPC contract becomes ambiguous.',
    );
  });

  it('3. The recoveryErr catch calls sendAudioCaptureFailed with channel:\'mic\' AND terminal:true', () => {
    const catchBody = findRecoveryErrCatch(micFnBody);
    assert.ok(
      catchBody !== null,
      'BUG: could not locate `catch (recoveryErr ...)` block in setupMicRecoveryHandler.',
    );
    // Multi-line regex: o payload spans vários lines.
    assert.match(
      catchBody,
      /sendAudioCaptureFailed\s*\(\s*\{[\s\S]*?channel\s*:\s*['"]mic['"][\s\S]*?terminal\s*:\s*true[\s\S]*?\}\s*\)/,
      'BUG: setupMicRecoveryHandler recoveryErr catch is missing the terminal IPC emission with ' +
        '`channel: \'mic\'` and `terminal: true`. Without this, exhausting the 3-attempt budget is silent — ' +
        'user hears nothing transcribed, no banner surfaces. This is exactly the B4 regression. ' +
        'See setupAudioRecoveryHandler L2597-2605 for the canonical pattern.',
    );
    // Também tolerate o inverse ordenar (terminal fprimeiro então channel) em case
    // a future formatting pass reorders o objeto literal — mesmo contract.
    const channelFirst = /channel\s*:\s*['"]mic['"][\s\S]*?terminal\s*:\s*true/.test(catchBody);
    const terminalFirst = /terminal\s*:\s*true[\s\S]*?channel\s*:\s*['"]mic['"]/.test(catchBody);
    assert.ok(
      channelFirst || terminalFirst,
      'BUG: channel:\'mic\' and terminal:true must both appear in the IPC payload, in either order.',
    );
  });

  it('4. The terminal IPC is gated on `_micRecoveryAttempts >= 3` (one-shot, not per-attempt)', () => {
    const catchBody = findRecoveryErrCatch(micFnBody);
    assert.ok(catchBody !== null, 'recoveryErr catch must exist');
    assert.match(
      catchBody,
      /_micRecoveryAttempts\s*>=\s*3/,
      'BUG: terminal IPC is not gated on `_micRecoveryAttempts >= 3`. ' +
        'Without this cap, the banner would fire on EVERY attempt (3x in rapid succession) ' +
        'instead of once at exhaustion. Mirrors the system-audio handler\'s `>= 3` gate at L2597.',
    );
  });

  it('5. The terminal IPC is also gated on `isMicRecoveryCurrentMeeting` (no stale-recovery banner spam)', () => {
    const catchBody = findRecoveryErrCatch(micFnBody);
    assert.ok(catchBody !== null, 'recoveryErr catch must exist');
    assert.match(
      catchBody,
      /isMicRecoveryCurrentMeeting/,
      'BUG: terminal IPC is missing the `isMicRecoveryCurrentMeeting` gate. ' +
        'Without it, a recovery whose meeting has already ended would spam the NEXT meeting\'s UI ' +
        'with a misleading "gave up after 3 attempts" banner. ' +
        'Mirrors `isRecoveryCurrentMeeting()` in setupAudioRecoveryHandler.',
    );
  });

  it('6. The terminal IPC payload includes `maxAttempts: 3`', () => {
    const catchBody = findRecoveryErrCatch(micFnBody);
    assert.ok(catchBody !== null, 'recoveryErr catch must exist');
    assert.match(
      catchBody,
      /maxAttempts\s*:\s*3/,
      'BUG: terminal IPC payload missing `maxAttempts: 3`. ' +
        'The renderer uses (attempt, maxAttempts) to distinguish in-flight recovery from terminal exhaustion; ' +
        'omitting maxAttempts forces the UI to guess.',
    );
  });

  it('7. Cross-handler parity: setupAudioRecoveryHandler also emits `terminal: true` with channel:\'system\' and maxAttempts:3', () => {
    // Catches divergence onde alguém remove o mic-side Ou system-side
    // terminal IPC sem removing o ooutro Ambos handlers precisa surface
    // failure symmetrically — qualquer coisa senão cria a confusing UX onde
    // one channel\'s exhaustion é visible and o other\'s é silent.
    assert.ok(
      sysFnBody !== null && sysFnBody.length > 0,
      'BUG: setupAudioRecoveryHandler body not found — cannot check cross-handler parity.',
    );
    const sysCatch = findRecoveryErrCatch(sysFnBody);
    assert.ok(
      sysCatch !== null,
      'BUG: setupAudioRecoveryHandler is missing its `catch (recoveryErr ...)` block. ' +
        'If the system-side terminal IPC was removed, the mic-side will diverge — fix both together.',
    );
    assert.match(
      sysCatch,
      /sendAudioCaptureFailed\s*\(\s*\{[\s\S]*?channel\s*:\s*['"]system['"][\s\S]*?terminal\s*:\s*true[\s\S]*?\}\s*\)/,
      'BUG: setupAudioRecoveryHandler recoveryErr catch no longer emits `channel: \'system\', terminal: true`. ' +
        'Cross-handler parity broken — mic and system must surface failure symmetrically.',
    );
    assert.match(
      sysCatch,
      /maxAttempts\s*:\s*3/,
      'BUG: setupAudioRecoveryHandler terminal IPC missing `maxAttempts: 3` — diverges from mic-side shape.',
    );
    assert.match(
      sysCatch,
      /_systemAudioRecoveryAttempts\s*>=\s*3/,
      'BUG: setupAudioRecoveryHandler terminal IPC is not gated on `>= 3` — diverges from mic-side gate.',
    );
  });

  it('8. The recoveryErr catch does NOT `return` or `throw` BEFORE the IPC emission (no short-circuit)', () => {
    const catchBody = findRecoveryErrCatch(micFnBody);
    assert.ok(catchBody !== null, 'recoveryErr catch must exist');

    // Strip // line comments and /* */ block comments before scanning,
    // porque o existing catch carries a paragraph-long explanatory
    // comment that mentions "early-return gproteger — that's prose, não code.
    const stripped = catchBody
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    // Locate o IPC call site em o comment-stripped vvisão Qualquer coisa
    // that looks como a control-flow bailout Antes it iria silently
    // re-introduce o original bug (catch rexecuta console.error fires,
    // então short-circuit, não banner).
    const ipcIdx = stripped.search(/sendAudioCaptureFailed\s*\(/);
    assert.ok(ipcIdx >= 0, 'sendAudioCaptureFailed call must be present in the catch');
    const beforeIpc = stripped.slice(0, ipcIdx);

    assert.ok(
      !/\breturn\b/.test(beforeIpc),
      'BUG: a `return` statement appears in the recoveryErr catch BEFORE the sendAudioCaptureFailed call. ' +
        'That short-circuits the terminal IPC and silently restores the B4 bug ' +
        '(catch runs, logs, but never reaches the IPC).',
    );
    assert.ok(
      !/\bthrow\b/.test(beforeIpc),
      'BUG: a `throw` statement appears in the recoveryErr catch BEFORE the sendAudioCaptureFailed call. ' +
        'That escalates out of the catch and skips the terminal IPC — silent-failure mode is back.',
    );
  });
});
