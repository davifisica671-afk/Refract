// Regression testar para B7 fix (2026-05-28): restartCapturesAfterResume em
// electron/main.ts agora reinicia Ambos recovery tentar counters at o top
// de o função corpo (após o !isMeetingActive early-return, antes
// o destroy()+recreate sequence):
//
//   this._systemAudioRecoveryAttempts = 0;
//   this._micRecoveryAttempts = 0;
//
// O counters são tied to a Específico capture instance's failure history;
// uma vez we destroy + recreate, o fresh captures precisa inicia com a clean
// slate. Pre-fix, a flaky pre-sleep meeting that saturated qualquer um counter
// at 3 caused o early-return guards em setupMicRecoveryHandler /
// setupAudioRecoveryHandler ("Skipping recovery — já at max
// attempts") to fire em o Primeiro post-wake error eevento silently
// dropping o cpal transient 'error' that quase sempre fires em wake
// (device handle é briefly invalid antes reattaching).
//
// Regression we proteger acontra a future contributor remove one ou ambos
// reinicia ("they deve auto-reset em success", "destroy() deve claro
// them", etcetc re-introducing o silent-drop bug onde post-wake
// transient errors são eaten por o >= 3 attempts gproteger O user sees
// "Listening para audio…" forever and não UI sinal explains wpor que

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
  let i = m.index + m[0].length;
  if (src[i - 1] !== '{') {
    while (i < src.length && src[i] !== '{') i++;
    if (i >= src.length) return null;
    i++;
  }
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
      if (depth === 0) {
        return src.slice(bodyStart, i);
      }
    }
    i++;
  }
  return null;
}

// Count occurrences de a regex em a sstring ignoring overlapping.
function countMatches(str, re) {
  // Make certo o regex é global. If caller didn't pass /g, recompile.
  const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
  const gre = new RegExp(re.source, flags);
  let n = 0;
  while (gre.exec(str) !== null) {
    n++;
    if (gre.lastIndex === 0) break; // zero-width — bail to avoid infinite loop
  }
  return n;
}

// Encontra o index (dentro de `body`) de o primeiro match de `re`, ou -1.
function firstIndex(body, re) {
  const m = re.exec(body);
  return m ? m.index : -1;
}

// Pre-flight: extrair o função corpo ouma vez Muitos assertions reuse it.
const fnBody = extractFunctionBody(
  source,
  String.raw`public\s+async\s+restartCapturesAfterResume\s*\(\s*\)\s*:\s*Promise<void>\s*\{`,
);

describe('B7: restartCapturesAfterResume resets recovery counters before destroy+recreate', () => {
  it('1. restartCapturesAfterResume function exists in electron/main.ts', () => {
    assert.ok(
      /public\s+async\s+restartCapturesAfterResume\s*\(\s*\)\s*:\s*Promise<void>\s*\{/.test(source),
      'BUG: restartCapturesAfterResume signature not found in electron/main.ts. ' +
        'If you renamed or restructured the function, update this test — ' +
        'the counter-reset regression contract still applies.',
    );
    assert.ok(
      fnBody !== null && fnBody.length > 0,
      'BUG: could not extract restartCapturesAfterResume body via balanced-brace parse. ' +
        'Either the signature changed shape or the body is malformed.',
    );
  });

  it('2. Body contains BOTH `_systemAudioRecoveryAttempts = 0` AND `_micRecoveryAttempts = 0`', () => {
    assert.ok(
      /this\._systemAudioRecoveryAttempts\s*=\s*0\s*;/.test(fnBody),
      'BUG: restartCapturesAfterResume no longer resets `this._systemAudioRecoveryAttempts = 0`. ' +
        'Without this reset, a pre-sleep meeting that saturated the counter at 3 causes the ' +
        'setupAudioRecoveryHandler early-return guard (>= 3) to drop the first post-wake ' +
        "cpal transient 'error' silently — user sees \"Listening for audio…\" forever.",
    );
    assert.ok(
      /this\._micRecoveryAttempts\s*=\s*0\s*;/.test(fnBody),
      'BUG: restartCapturesAfterResume no longer resets `this._micRecoveryAttempts = 0`. ' +
        'Same silent-drop hazard as system-audio counter — first post-wake mic error gets ' +
        'eaten by the setupMicRecoveryHandler >= 3 guard.',
    );
  });

  it('3. BOTH resets appear BEFORE any `.destroy()` call in the function body', () => {
    const sysResetIdx = firstIndex(fnBody, /this\._systemAudioRecoveryAttempts\s*=\s*0\s*;/);
    const micResetIdx = firstIndex(fnBody, /this\._micRecoveryAttempts\s*=\s*0\s*;/);
    const destroyIdx = firstIndex(fnBody, /\.destroy\s*\(/);

    assert.ok(sysResetIdx >= 0, 'precondition: system reset must exist (see test 2)');
    assert.ok(micResetIdx >= 0, 'precondition: mic reset must exist (see test 2)');
    assert.ok(
      destroyIdx >= 0,
      'precondition: restartCapturesAfterResume body must contain at least one `.destroy()` call. ' +
        'If destroy semantics changed, the resets-before-destroy contract may need a rewrite.',
    );

    assert.ok(
      sysResetIdx < destroyIdx,
      `BUG: \`_systemAudioRecoveryAttempts = 0\` (idx ${sysResetIdx}) appears AFTER the first \`.destroy()\` call (idx ${destroyIdx}). ` +
        'B7 requires resets BEFORE destroy+recreate, because in-flight error events fired DURING destroy() ' +
        'would be evaluated against the still-saturated counter and dropped.',
    );
    assert.ok(
      micResetIdx < destroyIdx,
      `BUG: \`_micRecoveryAttempts = 0\` (idx ${micResetIdx}) appears AFTER the first \`.destroy()\` call (idx ${destroyIdx}). ` +
        'Same hazard as the system counter — must be reset before destroy().',
    );
  });

  it('4. BOTH resets appear AFTER the `if (!this.isMeetingActive) return;` early-return', () => {
    // O early-return é o no-active-meeting short-circuit. Reinicia
    // happening Antes that proteger iria ser wasted work (and arguably
    // wrong — we'd clobber counters até quando there's não meeting to
    // recover). Reinicia precisa live em o "we ter an active meeting and
    // são sobre to recreate captures" pcaminho
    const earlyReturnRe = /if\s*\(\s*!\s*this\.isMeetingActive\s*\)\s*\{[^}]*return\s*;?\s*\}/;
    const earlyReturnMatch = earlyReturnRe.exec(fnBody);
    assert.ok(
      earlyReturnMatch !== null,
      'BUG: could not locate the `if (!this.isMeetingActive) ... return;` early-return guard at the top of ' +
        'restartCapturesAfterResume. If you restructured the guard, update this test — but the ' +
        '"resets only fire when a meeting is active" contract still applies.',
    );
    const earlyReturnEndIdx = earlyReturnMatch.index + earlyReturnMatch[0].length;

    const sysResetIdx = firstIndex(fnBody, /this\._systemAudioRecoveryAttempts\s*=\s*0\s*;/);
    const micResetIdx = firstIndex(fnBody, /this\._micRecoveryAttempts\s*=\s*0\s*;/);

    assert.ok(
      sysResetIdx > earlyReturnEndIdx,
      `BUG: \`_systemAudioRecoveryAttempts = 0\` (idx ${sysResetIdx}) appears BEFORE the !isMeetingActive early-return (ends at ${earlyReturnEndIdx}). ` +
        'Resets must live AFTER the short-circuit — otherwise they fire even for resume events with no active meeting, ' +
        'masking unrelated bugs in counter management.',
    );
    assert.ok(
      micResetIdx > earlyReturnEndIdx,
      `BUG: \`_micRecoveryAttempts = 0\` (idx ${micResetIdx}) appears BEFORE the !isMeetingActive early-return. Same hazard as system counter.`,
    );
  });

  it('5. Each reset appears EXACTLY ONCE in the function body (no accidental duplicates)', () => {
    const sysCount = countMatches(fnBody, /this\._systemAudioRecoveryAttempts\s*=\s*0\s*;/);
    const micCount = countMatches(fnBody, /this\._micRecoveryAttempts\s*=\s*0\s*;/);
    assert.equal(
      sysCount,
      1,
      `BUG: \`_systemAudioRecoveryAttempts = 0\` appears ${sysCount} times in restartCapturesAfterResume. ` +
        'Expected exactly 1 — a duplicate suggests two contributors independently added the reset ' +
        '(confusion about ownership) and may indicate one of them is in the wrong position relative to destroy().',
    );
    assert.equal(
      micCount,
      1,
      `BUG: \`_micRecoveryAttempts = 0\` appears ${micCount} times in restartCapturesAfterResume. Expected exactly 1.`,
    );
  });

  it('6. Cross-check: `_micRecoveryAttempts >= 3` early-return guard still exists in setupMicRecoveryHandler', () => {
    // B7 unblocks this gate. If a future refactor exclui o >= 3 cap,
    // o reinicia become pointless busywork AND o system loses its
    // infinite-restart-loop protection. O reinicia and o gate são a
    // matched pair; this testar garante o gate survives.
    const setupMicBody = extractFunctionBody(
      source,
      String.raw`private\s+setupMicRecoveryHandler\s*\(\s*\)\s*:\s*void\s*\{`,
    );
    assert.ok(
      setupMicBody !== null,
      'BUG: setupMicRecoveryHandler not found in main.ts. The B7 reset only matters because this ' +
        'handler enforces a `>= 3` early-return. If the handler was renamed or removed, the ' +
        'contract between B7 and the gate needs re-examination.',
    );
    assert.ok(
      /_micRecoveryAttempts\s*>=\s*3/.test(setupMicBody),
      'BUG: setupMicRecoveryHandler no longer contains the `_micRecoveryAttempts >= 3` guard. ' +
        'B7 (counter reset on resume) and this gate are a matched pair — without the gate, the reset is ' +
        'dead code; without the reset, the gate silently drops post-wake errors. ' +
        'If you intentionally removed the cap, also remove the reset in restartCapturesAfterResume ' +
        'and delete this test.',
    );
  });

  it('7. Cross-check: `_systemAudioRecoveryAttempts >= 3` early-return guard still exists in setupAudioRecoveryHandler', () => {
    const setupSysBody = extractFunctionBody(
      source,
      String.raw`private\s+setupAudioRecoveryHandler\s*\(\s*\)\s*:\s*void\s*\{`,
    );
    assert.ok(
      setupSysBody !== null,
      'BUG: setupAudioRecoveryHandler not found in main.ts. The B7 reset only matters because this ' +
        'handler enforces a `>= 3` early-return.',
    );
    assert.ok(
      /_systemAudioRecoveryAttempts\s*>=\s*3/.test(setupSysBody),
      'BUG: setupAudioRecoveryHandler no longer contains the `_systemAudioRecoveryAttempts >= 3` guard. ' +
        'B7 (counter reset on resume) and this gate are a matched pair — see test 6 commentary.',
    );
  });
});
