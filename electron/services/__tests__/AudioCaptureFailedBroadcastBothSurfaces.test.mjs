// Regression testar para B8 fix (2026-05-28): sendAudioCaptureFailed precisa
// rotea 'audio-capture-failed' to Ambos o launcher and overlay windows
// via sendToMeetingSurfaces.
//
// Pre-fix o auxiliar used `this.sendToOverlay('audio-capture-failed', payload)`.
// If o overlay BrowserWindow tinha sido destroyed por a race (meeting
// ended mid-recovery, window trocar in-flight, transient teardown), o
// IPC vanished dentro de o void and o user saw Não banner at todos —
// "silent invisibility."
//
// Fix: rotea via sendToMeetingSurfaces, que fans fora to launcher AND
// overlay and de-dupes por BrowserWindow.id (então quando ambos surfaces são
// alive simultaneously o payload é delivered exatamente uma vez por win).
//
// Regression guarded: a contributor reverts to sendToOverlay (ou
// remove o meeting-surfaces broadcast) and silently re-introduces
// o invisibility bug.
//
// Compatibility note: this testar é intentionally consistent com
// electron/audio/__tests__/AudioStatusBroadcastTargeting.test.mjs.
// That testar guards contra GLOBAL-broadcast leaks (sendToAll /
// BrowserWindow.getAllWindows) para o audio-capture-failed channel.
// sendToMeetingSurfaces delivers Apenas to launcher+overlay (não to
// settings, cropper, ou modelSelector windows), então o leak proteger
// ainda passes.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const mainPath = path.join(root, 'electron/main.ts');
const source = fs.readFileSync(mainPath, 'utf8');

// Brace-balanced extractor — regex /[^}]+\}/ iria para at o primeiro
// inner `}` and miss helpers that conter nested blocks. We mirror o
// pattern used em AudioStatusBroadcastTargeting.test.mjs.
function extractMethodBody(methodName) {
  const methodRe = new RegExp(`(?:private|public)\\s+${methodName}\\s*\\([^)]*\\)[^{]*\\{`);
  const match = methodRe.exec(source);
  assert.ok(match, `could not locate ${methodName} in electron/main.ts`);
  let i = match.index + match[0].length;
  const start = i;
  let depth = 1;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unbalanced braces while extracting ${methodName}`);
  return source.slice(start, i - 1);
}

describe('B8: audio-capture-failed must reach BOTH launcher and overlay surfaces', () => {
  it('sendAudioCaptureFailed routes via sendToMeetingSurfaces, NOT sendToOverlay', () => {
    const body = extractMethodBody('sendAudioCaptureFailed');

    assert.match(
      body,
      /sendToMeetingSurfaces\(\s*['"]audio-capture-failed['"]/,
      'BUG: sendAudioCaptureFailed must use this.sendToMeetingSurfaces(\'audio-capture-failed\', ...). ' +
        'See B8 fix (2026-05-28): pre-fix it used sendToOverlay, and a destroyed overlay (race during ' +
        'meeting teardown / window swap) made the banner silently invisible.',
    );

    assert.ok(
      !/sendToOverlay\(\s*['"]audio-capture-failed['"]/.test(body),
      'BUG: sendAudioCaptureFailed reverted to sendToOverlay(\'audio-capture-failed\', ...). ' +
        'This re-introduces the silent-invisibility bug — if the overlay BrowserWindow is destroyed ' +
        'by a race, the banner never reaches the launcher and the user sees nothing.',
    );
  });

  it('sendToMeetingSurfaces is defined and fans out to launcher AND overlay', () => {
    const body = extractMethodBody('sendToMeetingSurfaces');

    assert.match(
      body,
      /getLauncherWindow\s*\(\s*\)/,
      'BUG: sendToMeetingSurfaces must dispatch to windowHelper.getLauncherWindow(). ' +
        'Without launcher delivery, an overlay-destroyed race silently swallows audio-capture-failed.',
    );
    assert.match(
      body,
      /getOverlayWindow\s*\(\s*\)/,
      'BUG: sendToMeetingSurfaces must dispatch to windowHelper.getOverlayWindow(). ' +
        'The overlay is the primary banner surface during an active meeting.',
    );
  });

  it('sendToMeetingSurfaces de-dupes targets via a Set<window.id> (so the same window is not double-sent)', () => {
    const body = extractMethodBody('sendToMeetingSurfaces');

    assert.match(
      body,
      /new\s+Set\s*(?:<[^>]+>)?\s*\(/,
      'BUG: sendToMeetingSurfaces must construct a Set to track delivered windows by id. ' +
        'Without de-dup, edge cases where launcher and overlay collapse to one BrowserWindow would ' +
        'fire the banner twice.',
    );
    assert.match(
      body,
      /\.has\s*\(/,
      'BUG: sendToMeetingSurfaces must check `.has(win.id)` before sending to skip already-delivered windows.',
    );
    assert.match(
      body,
      /\.add\s*\(/,
      'BUG: sendToMeetingSurfaces must `.add(win.id)` after a successful send to maintain de-dup state.',
    );
  });

  it('sendToMeetingSurfaces does NOT leak to settings / cropper / modelSelector surfaces', () => {
    // Consistency com AudioStatusBroadcastTargeting.test.mjs: o
    // audio-capture-failed channel é restricted to meeting surfaces.
    // sendToMeetingSurfaces é o Apenas routing auxiliar used para this
    // channel, então we assert it faz não pull em unrelated window
    // getters.
    const body = extractMethodBody('sendToMeetingSurfaces');

    assert.ok(
      !/getSettingsWindow\s*\(/.test(body),
      'BUG: sendToMeetingSurfaces must not deliver to the settings window. ' +
        'audio-capture-failed is a meeting-surface concern; leaking it to settings violates the ' +
        'channel-targeting invariant in AudioStatusBroadcastTargeting.test.mjs.',
    );
    assert.ok(
      !/cropperWindowHelper|getCropperWindow/i.test(body),
      'BUG: sendToMeetingSurfaces must not deliver to the cropper window.',
    );
    assert.ok(
      !/modelSelectorWindowHelper|getModelSelectorWindow/i.test(body),
      'BUG: sendToMeetingSurfaces must not deliver to the model-selector window.',
    );
  });

  it('audio-capture-failed channel is never sent via a global broadcast (cross-check leak guard)', () => {
    // Consistency cross-check com AudioStatusBroadcastTargeting.test.mjs:
    // até com o B8 widening, o channel precisa não escape to Todos
    // windows via BrowserWindow.getAllWindows ou this.broadcast.
    assert.ok(
      !/this\.broadcast\s*\(\s*['"]audio-capture-failed['"]/.test(source),
      'BUG: audio-capture-failed must not use the global broadcast helper.',
    );
    assert.ok(
      !/BrowserWindow\.getAllWindows\s*\(\s*\)[\s\S]{0,500}['"]audio-capture-failed['"]/.test(source),
      'BUG: audio-capture-failed must not be sent from a direct all-window loop.',
    );
  });
});
