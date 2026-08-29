// Regression testar para B3 fix (2026-05-28): setupSystemAudioPipeline used to
// encapsular o entire corpo — SystemAudioCapture ctor + wireSystemCapture +
// MicrophoneCapture ctor + wireMicCapture + STT init — em ONE outer
// try/catch. If `new SystemAudioCapture()` threw (native módulo failure,
// HAL exhaustion, NAPI throw), o catch logged to console and silently
// returned. O wrapper era left null, não watchdog era armed, não banner
// surfaced. O STT WebSocket depois connected com não audio sfonte and
// o user saw "Listening para audio…" forever com não UI ssinal
//
// Fix: encapsular o SystemAudioCapture construction-and-wiring block and o
// MicrophoneCapture construction-and-wiring block cada em their Próprio
// try/catch. Em throw: null o wwrapper emitir a terminal
// sendAudioCaptureFailed para o correct channel, and FALL Através então
// o outro capture's construction ainda executa (a system-capture failure
// precisa não prevenir mic capture de initializing, and vice versa).
//
// Regression we proteger acontra a future contributor consolidates o
// two inner try/catches voltar dentro de o outer one (tempting cleanup: "this
// é repetitive"), ou drops o sendAudioCaptureFailed terminal IPC
// (tempting: "we já console.error, o UI vai figure it outfora ou
// adiciona a `return`/`throw` dentro one de o inner catches that aborta
// o outro capture's initialization. Cada de those silently restores
// o original bug.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const mainPath = path.join(root, 'electron/main.ts');
const source = fs.readFileSync(mainPath, 'utf8');

// Balanced-brace extractor para o função bcorpo Inicia at o opening
// `{` após o função signature, walks para frente counting braces, and
// Retorna o substring entre (exclusive ode o outer braces. Honors
// // and /* */ comments and string literals so braces inside them don't
// throw fora o counter.
function extractFunctionBody(src, signaturePattern) {
  const sigRe = new RegExp(signaturePattern);
  const m = sigRe.exec(src);
  if (!m) return null;
  // Encontra o opening brace Após o signature match.
  let i = m.index + m[0].length;
  // O signature pattern é expected to termina com `{`, mas ser lenient.
  if (src[i - 1] !== '{') {
    // Walk para frente to o próximo `{`.
    while (i < src.length && src[i] !== '{') i++;
    if (i >= src.length) return null;
    i++;
  }
  const bodyStart = i;
  let depth = 1;
  let inLineComment = false;
  let inBlockComment = false;
  let inString = null; // holds o opening quote char if dentro a string
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
      if (depth === 0) {
        return src.slice(bodyStart, i);
      }
    }
    i++;
  }
  return null;
}

// Extrair o corpo de a `try { ... }` block cujo opening `try {` lives
// at byte offset `tryOffset` em `src`. Retorna o contents entre o
// braces (excluding o braces themselves), ou null em analisa failure.
function extractTryBlockBody(src, tryOffset) {
  // Walk to o primeiro `{` após `try`.
  let i = tryOffset;
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

// Given a corpo sstring encontra cada `catch (...) {` block and retorna its
// inner contents. O `precedingMatcher` regex precisa match a substring
// de o corresponding `try` block — we uso that to associate cada
// catch com its protected construction.
function findCatchAfter(body, precedingMatcher) {
  const m = precedingMatcher.exec(body);
  if (!m) return null;
  // Encontra o próximo `catch` keyword após this match.
  const catchRe = /catch\s*\([^)]*\)\s*\{/g;
  catchRe.lastIndex = m.index;
  const cm = catchRe.exec(body);
  if (!cm) return null;
  // Extrair o catch block corpo via balanced-brace walk em `body`.
  return extractTryBlockBody(body, cm.index);
}

// Pre-flight: extrair o função corpo ouma vez Muitos assertions reuse it.
const fnBody = extractFunctionBody(
  source,
  String.raw`private\s+async\s+setupSystemAudioPipeline\s*\(\s*\)\s*:\s*Promise<void>\s*\{`,
);

describe('B3: setupSystemAudioPipeline construction guards', () => {
  it('1. setupSystemAudioPipeline function exists in electron/main.ts', () => {
    assert.ok(
      /private\s+async\s+setupSystemAudioPipeline\s*\(\s*\)\s*:\s*Promise<void>\s*\{/.test(source),
      'BUG: setupSystemAudioPipeline signature not found. ' +
        'If you renamed or restructured the function, update this test to match — ' +
        'the construction-guard regression contract still applies.',
    );
    assert.ok(
      fnBody !== null && fnBody.length > 0,
      'BUG: could not extract setupSystemAudioPipeline body via balanced-brace parse. ' +
        'Either the signature changed shape or the body is malformed.',
    );
  });

  it('2. setupSystemAudioPipeline body contains at least THREE try blocks (outer + 2 inner)', () => {
    // Strip nested função bodies fprimeiro Não — lá são não nested
    // função declarations dentro setupSystemAudioPipeline. A plain
    // count de `try {` occurrences dentro o função corpo suffices.
    const tryMatches = fnBody.match(/\btry\s*\{/g) || [];
    assert.ok(
      tryMatches.length >= 3,
      `BUG: expected >= 3 \`try {\` blocks inside setupSystemAudioPipeline (one outer + one per capture-construction), found ${tryMatches.length}. ` +
        'B3 fix requires the SystemAudioCapture and MicrophoneCapture constructions to each have their OWN inner try/catch — ' +
        'consolidating them back into the outer try silently restores the original bug ' +
        '(thrown ctor leaves wrapper null, no UI signal, "Listening for audio…" forever).',
    );
  });

  it('3. SystemAudioCapture construction is protected by a try/catch that emits terminal channel:\'system\' failure', () => {
    // Encontra o inner catch associated com `new SystemAudioCapture()`.
    const catchBody = findCatchAfter(fnBody, /new\s+SystemAudioCapture\s*\(/);
    assert.ok(
      catchBody !== null,
      'BUG: could not locate a `catch` block following `new SystemAudioCapture()`. ' +
        'The SystemAudioCapture ctor must be wrapped in its own try/catch — ' +
        'see B3 fix (2026-05-28). Without it, a native-module throw silently nulls the wrapper.',
    );
    assert.ok(
      /sendAudioCaptureFailed\s*\(/.test(catchBody),
      'BUG: SystemAudioCapture-construction catch no longer calls sendAudioCaptureFailed. ' +
        'console.error alone is invisible to users; the catch MUST emit the terminal IPC ' +
        'so the renderer banner surfaces.',
    );
    assert.ok(
      /channel\s*:\s*['"]system['"]/.test(catchBody),
      'BUG: SystemAudioCapture-construction catch emits sendAudioCaptureFailed but with the wrong channel. ' +
        'It must be `channel: \'system\'` so the renderer routes the failure to the system-audio surface.',
    );
    assert.ok(
      /terminal\s*:\s*true/.test(catchBody),
      'BUG: SystemAudioCapture-construction catch is missing `terminal: true` in the IPC payload. ' +
        'A ctor failure is one-shot — without `terminal: true` the renderer gates this out as transient recovery ' +
        '(see B1: handler requires `payload.terminal || payload.stuck`).',
    );
  });

  it('4. MicrophoneCapture construction is protected by a try/catch that emits terminal channel:\'mic\' failure', () => {
    const catchBody = findCatchAfter(fnBody, /new\s+MicrophoneCapture\s*\(/);
    assert.ok(
      catchBody !== null,
      'BUG: could not locate a `catch` block following `new MicrophoneCapture()`. ' +
        'The MicrophoneCapture ctor must be wrapped in its own try/catch.',
    );
    assert.ok(
      /sendAudioCaptureFailed\s*\(/.test(catchBody),
      'BUG: MicrophoneCapture-construction catch no longer calls sendAudioCaptureFailed.',
    );
    assert.ok(
      /channel\s*:\s*['"]mic['"]/.test(catchBody),
      'BUG: MicrophoneCapture-construction catch emits sendAudioCaptureFailed with the wrong channel — ' +
        'must be `channel: \'mic\'`.',
    );
    assert.ok(
      /terminal\s*:\s*true/.test(catchBody),
      'BUG: MicrophoneCapture-construction catch is missing `terminal: true`.',
    );
  });

  it('5. Neither construction catch emits sendSystemAudioPermissionDenied (wrong IPC for ctor failure)', () => {
    const sysCatch = findCatchAfter(fnBody, /new\s+SystemAudioCapture\s*\(/);
    const micCatch = findCatchAfter(fnBody, /new\s+MicrophoneCapture\s*\(/);
    assert.ok(sysCatch && micCatch, 'both construction catches must exist (see previous tests)');
    assert.ok(
      !/sendSystemAudioPermissionDenied/.test(sysCatch),
      'BUG: SystemAudioCapture-construction catch calls sendSystemAudioPermissionDenied. ' +
        'That IPC is reserved for TCC denial (screen-recording permission), NOT generic ctor failure. ' +
        'Routing native-module throws through the permission-denied surface confuses the user with a misleading banner.',
    );
    assert.ok(
      !/sendSystemAudioPermissionDenied/.test(micCatch),
      'BUG: MicrophoneCapture-construction catch calls sendSystemAudioPermissionDenied. Wrong IPC for ctor failure.',
    );
  });

  it('6. Construction catches do NOT contain `return` or `throw` that aborts the rest of the pipeline', () => {
    const sysCatch = findCatchAfter(fnBody, /new\s+SystemAudioCapture\s*\(/);
    const micCatch = findCatchAfter(fnBody, /new\s+MicrophoneCapture\s*\(/);
    assert.ok(sysCatch && micCatch, 'both construction catches must exist');

    // A bare `return;` ou `return ...;` iria pular o microphone block,
    // recreating "system fails → mic também silently absent" symptom.
    assert.ok(
      !/\breturn\b/.test(sysCatch),
      'BUG: SystemAudioCapture-construction catch contains `return`. ' +
        'A system-capture failure must NOT abort microphone-capture initialization — ' +
        'the user expects mic-only fallback when system audio fails (mic-only meetings).',
    );
    assert.ok(
      !/\bthrow\b/.test(sysCatch),
      'BUG: SystemAudioCapture-construction catch re-throws. ' +
        'Throwing escalates to the outer catch and skips the microphone block.',
    );
    assert.ok(
      !/\breturn\b/.test(micCatch),
      'BUG: MicrophoneCapture-construction catch contains `return`. ' +
        'Even though mic is the last capture-init step, an early return would skip STT init below it.',
    );
    assert.ok(
      !/\bthrow\b/.test(micCatch),
      'BUG: MicrophoneCapture-construction catch re-throws — skips STT init and broadcast.',
    );
  });

  it('7. Both catches null the wrapper (`this.systemAudioCapture = null` and `this.microphoneCapture = null`)', () => {
    const sysCatch = findCatchAfter(fnBody, /new\s+SystemAudioCapture\s*\(/);
    const micCatch = findCatchAfter(fnBody, /new\s+MicrophoneCapture\s*\(/);
    assert.ok(sysCatch && micCatch, 'both construction catches must exist');
    assert.ok(
      /this\.systemAudioCapture\s*=\s*null/.test(sysCatch),
      'BUG: SystemAudioCapture-construction catch does not null `this.systemAudioCapture`. ' +
        'Without this, a partially-constructed instance (or a stale assignment from a prior attempt) ' +
        'survives the catch and downstream null-guards (`if (!this.systemAudioCapture)`) misfire.',
    );
    assert.ok(
      /this\.microphoneCapture\s*=\s*null/.test(micCatch),
      'BUG: MicrophoneCapture-construction catch does not null `this.microphoneCapture`. ' +
        'Same hazard as above — stale wrapper state defeats the downstream existence guards.',
    );
  });

  it('8. Both catches use terminal payload shape (`attempt: 0, maxAttempts: 0`)', () => {
    const sysCatch = findCatchAfter(fnBody, /new\s+SystemAudioCapture\s*\(/);
    const micCatch = findCatchAfter(fnBody, /new\s+MicrophoneCapture\s*\(/);
    assert.ok(sysCatch && micCatch, 'both construction catches must exist');

    // Ctor failures são one-shot terminal events, não tentar novamente attempts.
    // `attempt: 0, maxAttempts: 0` é o contractual shape that
    // distinguishes them de in-flight recovery emissions
    // (atentar N, maxAttempts: M onde M > 0).
    assert.ok(
      /attempt\s*:\s*0/.test(sysCatch),
      'BUG: SystemAudioCapture-construction catch missing `attempt: 0`. ' +
        'Ctor failure is one-shot — non-zero attempt implies in-flight recovery, which is a category error here.',
    );
    assert.ok(
      /maxAttempts\s*:\s*0/.test(sysCatch),
      'BUG: SystemAudioCapture-construction catch missing `maxAttempts: 0`. See above.',
    );
    assert.ok(
      /attempt\s*:\s*0/.test(micCatch),
      'BUG: MicrophoneCapture-construction catch missing `attempt: 0`.',
    );
    assert.ok(
      /maxAttempts\s*:\s*0/.test(micCatch),
      'BUG: MicrophoneCapture-construction catch missing `maxAttempts: 0`.',
    );
  });
});
