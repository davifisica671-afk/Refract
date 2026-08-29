// Regression testar para B8b fix (2026-05-28): sendSttStatus and
// sendSystemAudioPermissionDenied precisa rotea their channels to Ambos o
// launcher and overlay windows via sendToMeetingSurfaces (o mesmo
// dual-surface delivery that B8 introduced para sendAudioCaptureFailed).
//
// Pre-fix these helpers used `this.sendToOverlay(channel, payload)`. If
// o overlay BrowserWindow tinha sido destroyed por a race (meeting ended
// mid-recovery, window trocar in-flight, transient teardown), o IPC
// vanished dentro de o void and o user saw Não status / Não permissão
// banner at todos — silent invisibility em o two maioria user-actionable
// diagnostic surfaces.
//
// Fix: rotea via sendToMeetingSurfaces, que fans fora to launcher AND
// overlay and de-dupes por BrowserWindow.id.
//
// Regression guarded: a contributor reverts qualquer um sister método to
// sendToOverlay (ou remove o dual-surface broadcast / changes o
// channel nanome
//
// Compatibility note: this testar é intentionally consistent com
// electron/services/__tests__/AudioCaptureFailedBroadcastBothSurfaces.test.mjs
// (B8) — mesmo brace-balanced extraction, mesmo channel-targeting
// invariants.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const mainPath = path.join(root, 'electron/main.ts');
const interfacePath = path.join(root, 'src/components/RefractInterface.tsx');
const source = fs.readFileSync(mainPath, 'utf8');
const interfaceSource = fs.readFileSync(interfacePath, 'utf8');

// Brace-balanced extractor — regex /[^}]+\}/ iria para at o primeiro
// inner `}` and miss helpers that conter nested blocks. Mirrors o
// pattern used em AudioCaptureFailedBroadcastBothSurfaces.test.mjs.
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

describe('B8b: stt-status and system-audio-permission-denied must reach BOTH launcher and overlay surfaces', () => {
  it('sendSttStatus routes via sendToMeetingSurfaces, NOT sendToOverlay', () => {
    const body = extractMethodBody('sendSttStatus');

    assert.match(
      body,
      /sendToMeetingSurfaces\(\s*['"]stt-status['"]/,
      'BUG: sendSttStatus must use this.sendToMeetingSurfaces(\'stt-status\', ...). ' +
        'See B8b fix (2026-05-28): pre-fix it used sendToOverlay, and a destroyed overlay ' +
        '(launcher↔overlay swap race / meeting end/start transition) made the STT status ' +
        'indicator silently disappear.',
    );

    assert.ok(
      !/sendToOverlay\(\s*['"]stt-status['"]/.test(body),
      'BUG: sendSttStatus reverted to sendToOverlay(\'stt-status\', ...). ' +
        'This re-introduces the silent-invisibility bug — if the overlay BrowserWindow is ' +
        'destroyed by a race, the status indicator never reaches the launcher and the user ' +
        'sees a stale/missing state.',
    );
  });

  it('sendSystemAudioPermissionDenied routes via sendToMeetingSurfaces, NOT sendToOverlay', () => {
    const body = extractMethodBody('sendSystemAudioPermissionDenied');

    assert.match(
      body,
      /sendToMeetingSurfaces\(\s*['"]system-audio-permission-denied['"]/,
      'BUG: sendSystemAudioPermissionDenied must use ' +
        'this.sendToMeetingSurfaces(\'system-audio-permission-denied\', ...). ' +
        'The TCC permission-denied banner is one of the most user-actionable diagnostic ' +
        'signals — losing it to an overlay-destroy race defeats the entire permission ' +
        'recovery path (HIGH severity sister bug to B8).',
    );

    assert.ok(
      !/sendToOverlay\(\s*['"]system-audio-permission-denied['"]/.test(body),
      'BUG: sendSystemAudioPermissionDenied reverted to ' +
        'sendToOverlay(\'system-audio-permission-denied\', ...). ' +
        'This re-introduces the HIGH-severity silent-invisibility bug for TCC banners.',
    );
  });

  it('channel-string invariance: literal channel names match preload.ts subscribers', () => {
    // O renderer subscribes em o exact string channels — if a
    // contributor renames qualquer um channel sem updating o subscriber
    // and preload bponte o IPC dead-letters silently.
    assert.ok(
      /sendToMeetingSurfaces\(\s*['"]stt-status['"]/.test(source),
      'BUG: the literal channel name \'stt-status\' must not be changed — ' +
        'preload.ts onSttStatusChanged subscribes on this exact string.',
    );
    assert.ok(
      /sendToMeetingSurfaces\(\s*['"]system-audio-permission-denied['"]/.test(source),
      'BUG: the literal channel name \'system-audio-permission-denied\' must not be changed — ' +
        'preload.ts onSystemAudioPermissionDenied subscribes on this exact string.',
    );
  });

  it('no accidental broadcast leak: neither method uses this.broadcast or BrowserWindow.getAllWindows', () => {
    const sttBody = extractMethodBody('sendSttStatus');
    const permBody = extractMethodBody('sendSystemAudioPermissionDenied');

    assert.ok(
      !/this\.broadcast\s*\(/.test(sttBody),
      'BUG: sendSttStatus must not use this.broadcast(...) — it would leak the status ' +
        'indicator to settings/cropper/modelSelector windows that should never receive it.',
    );
    assert.ok(
      !/BrowserWindow\.getAllWindows\s*\(/.test(sttBody),
      'BUG: sendSttStatus must not iterate BrowserWindow.getAllWindows() — same leak risk.',
    );

    assert.ok(
      !/this\.broadcast\s*\(/.test(permBody),
      'BUG: sendSystemAudioPermissionDenied must not use this.broadcast(...) — it would leak ' +
        'the permission banner to unrelated surfaces.',
    );
    assert.ok(
      !/BrowserWindow\.getAllWindows\s*\(/.test(permBody),
      'BUG: sendSystemAudioPermissionDenied must not iterate BrowserWindow.getAllWindows() — same leak risk.',
    );
  });

  it('subscriber side intact: RefractInterface.tsx still subscribes to both channels', () => {
    // Structural confidence that o rendering paths match o sender
    // channels. If o subscriber side regresses, o broadcast ainda
    // succeeds mas não UI uatualiza
    // Tolerate ambos `window.electronAPI.onX(...)` and o optional-chaining
    // variant `window.electronAPI?.onX?.(...)` — ambos são valid subscriber
    // call shapes used em o renderer.
    assert.match(
      interfaceSource,
      /window\.electronAPI\??\.onSttStatusChanged(?:\?\.)?\s*\(/,
      'BUG: RefractInterface.tsx must still subscribe via ' +
        'window.electronAPI.onSttStatusChanged(...). Without this, the stt-status IPC ' +
        'is broadcast successfully but no renderer renders it.',
    );
    assert.match(
      interfaceSource,
      /window\.electronAPI\??\.onSystemAudioPermissionDenied(?:\?\.)?\s*\(/,
      'BUG: RefractInterface.tsx must still subscribe via ' +
        'window.electronAPI.onSystemAudioPermissionDenied(...). Without this, the TCC ' +
        'permission banner IPC is broadcast successfully but no banner is rendered.',
    );
  });

  it('symmetry: all THREE user-facing diagnostic IPCs use sendToMeetingSurfaces', () => {
    // sendAudioCaptureFailed (B8), sendSttStatus (B8b), and
    // sendSystemAudioPermissionDenied (B8b) todos share o mesmo
    // dual-surface delivery invariant. If qualquer one de them drifts voltar
    // to sendToOverlay (ou qualquer coisa elsenão o symmetry breaks and we
    // re-introduce o asymmetric silent-invisibility class de bug.
    const audioBody = extractMethodBody('sendAudioCaptureFailed');
    const sttBody = extractMethodBody('sendSttStatus');
    const permBody = extractMethodBody('sendSystemAudioPermissionDenied');

    assert.match(
      audioBody,
      /sendToMeetingSurfaces\(/,
      'BUG: sendAudioCaptureFailed must use sendToMeetingSurfaces (B8 invariant).',
    );
    assert.match(
      sttBody,
      /sendToMeetingSurfaces\(/,
      'BUG: sendSttStatus must use sendToMeetingSurfaces (B8b invariant).',
    );
    assert.match(
      permBody,
      /sendToMeetingSurfaces\(/,
      'BUG: sendSystemAudioPermissionDenied must use sendToMeetingSurfaces (B8b invariant).',
    );
  });
});
