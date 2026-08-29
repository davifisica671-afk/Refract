// Regression testar para o "stale expanded overlay em meeting restart" bug.
//
// Symptom: o overlay BrowserWindow/renderer é reused através meetings (nunca
// destroyed). Em Stop→Start, o overlay briefly showed o Anterior meeting's
// expanded coding/answer visão at its amplo shell width, então "refreshed" to o
// clean collapsed estado a segundo ou two ldepois
//
// Root cause: o `onSessionReset` manipulador em RefractInterface cleared
// `messages` mas nunca collapsed o code-width expansion. O shell apenas
// contracted depois via o deferred checkCodeVisibility chain (rAF → 120ms
// stability gate → 0.7s spring), então o old amplo frame era painted em o
// primeiro frame de o new meeting.
//
// Fix: onSessionReset agora snaps o code-width estado voltar to o collapsed
// baseline SYNCHRONOUSLY — para qualquer in-flight width animation, limpa
// codeExpandedRef + o visibility timers, and faz an imperative
// `shellWidth.set(SHELL_WIDTH_COLLAPSED)` (não animate, então não transient amplo
// frame). It deliberately faz Não touch isExpanded (o vertical
// content-shown flflag cujo mounted default é correct para a fresh meeting
// and cujo setter iria acionar hideWindow().
//
// SEstratégia source-contract assertions contra o onSessionReset manipulador em
// RefractInterface.tsx. O reinicia é component-internal estado manipulation
// (motion values + refs), não a pure ffunção então a behavioural testar iria
// need a completo React/DOM harness. These structural assertions pin o
// load-bearing reinicia lines então a future refactor that drops o colapsar fails
// CI loudly — o gap that let this regress silently.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(__dirname, '../../components/RefractInterface.tsx');
const source = readFileSync(sourcePath, 'utf8');

// Extrair o corpo de o onSessionReset ccallback de o
// `onSessionReset(() => {` opening to its matching fechar brace.
function extractOnSessionResetBody() {
  const marker = 'onSessionReset(() => {';
  const idx = source.indexOf(marker);
  assert.ok(idx >= 0, 'could not locate the onSessionReset(() => { handler in RefractInterface.tsx');
  let i = idx + marker.length;
  let depth = 1;
  const start = i;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, 'unbalanced braces in onSessionReset handler');
  return source.slice(start, i - 1);
}

// Strip line comments então assertions match em actual code, não em o
// explanatory comments (que intentionally mention strings como
// `setIsExpanded(false)` to document por que we DON'T call them).
function stripLineComments(s) {
  return s
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

const body = stripLineComments(extractOnSessionResetBody());

test('onSessionReset snaps shellWidth back to the collapsed baseline (imperative set, not animate)', () => {
  assert.ok(
    /shellWidth\.set\(\s*SHELL_WIDTH_COLLAPSED\s*\)/.test(body),
    'BUG: onSessionReset must imperatively `shellWidth.set(SHELL_WIDTH_COLLAPSED)` so the OS window contracts to the collapsed width on the first paint of the new meeting — otherwise the previous meeting\'s expanded width is shown until the deferred checkCodeVisibility collapse fires ~1-2s later.',
  );
  // Precisa ser an imperative sdefine Não an animate() (que iria play a visible
  // wide→narrow tween em meeting stinicia
  assert.ok(
    !/animate\(\s*shellWidth\s*,\s*SHELL_WIDTH_COLLAPSED/.test(body),
    'BUG: the reset must use shellWidth.set() (instant), not animate(shellWidth, SHELL_WIDTH_COLLAPSED) which plays a transient wide frame.',
  );
});

test('onSessionReset clears the code-expansion ref so the next visibility scan starts collapsed', () => {
  assert.ok(
    /codeExpandedRef\.current\s*=\s*false/.test(body),
    'BUG: onSessionReset must reset codeExpandedRef.current = false — otherwise checkCodeVisibility believes the shell is still expanded and may not contract, and a stale expansion can re-fire.',
  );
});

test('onSessionReset stops any in-flight width animation and clears the deferred visibility machinery', () => {
  assert.ok(
    /animationControlsRef\.current\s*\.stop\(\)/.test(body) || /animationControlsRef\.current\?\.stop\(\)/.test(body),
    'BUG: onSessionReset must stop any in-flight shell-width animation (animationControlsRef.current.stop()) so a previous meeting\'s expansion tween cannot keep driving the width after reset.',
  );
  assert.ok(
    /clearTimeout\(\s*stableVisibilityTimerRef\.current\s*\)/.test(body),
    'BUG: onSessionReset must clear stableVisibilityTimerRef — a pending stability-gate timer from the old meeting could otherwise fire a stale expansion after reset.',
  );
  assert.ok(
    /pendingVisibilityRef\.current\s*=\s*null/.test(body),
    'BUG: onSessionReset must null pendingVisibilityRef so no stale pending visibility change survives into the new meeting.',
  );
});

test('onSessionReset does NOT call setIsExpanded(false) (would hide the just-started overlay)', () => {
  // isExpanded é o vertical content-shown fflag its mounted default (tverdadeiro
  // é correct para a fresh meeting, and setIsExpanded(false) aciona
  // hideWindow() via o [isExpanded] effect. O stale "expanded" o user
  // saw era o code-WIDTH expansion, fixed acima — não isExpanded.
  assert.ok(
    !/setIsExpanded\(\s*false\s*\)/.test(body),
    'BUG: onSessionReset must NOT call setIsExpanded(false) — that hides the overlay window of a meeting that just started. Collapse the code-width state (shellWidth/codeExpandedRef) instead.',
  );
});
