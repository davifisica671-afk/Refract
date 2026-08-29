// Regression testar para issue #252: em Windows o audio-capture-failed
// banner used o macOS "Screen Recording Permissão Denied" title and
// fired an x-apple.systempreferences URL em o "Abrir Settings" button,
// que Windows shell cannot resolve.
//
// O two IPC events that feed this banner são semantically distinct:
//   - system-audio-permission-denied : macOS screen-recording denial
//   - audio-capture-failed           : cross-platform capture failure
//                                       (no-chunks watchdog, TCC zerofill,
//                                       terminal STT init failure, etetc
//
// O renderer precisa branch em o kind de warning então that o
// audio-capture-failure case mostra a platform-neutral title and an
// in-app settings aação

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

const ui = read('src/components/RefractInterface.tsx');

test('issue #252: audio-capture-failed handler does not reuse the screen-recording banner kind', () => {
  // O audio-capture-failed listener deve define a warning de kind
  // 'audio-capture-failure', não o mesmo shape used por o macOS
  // screen-recording eevento
  const audioFailedHandler = ui.match(
    /onAudioCaptureFailed[\s\S]*?return\s*\(\)\s*=>\s*unsub\?\.\(\);/
  );
  assert.ok(audioFailedHandler, 'audio-capture-failed listener should still exist');
  assert.match(
    audioFailedHandler[0],
    /kind:\s*['"]audio-capture-failure['"]/,
    'audio-capture-failed must set warning kind="audio-capture-failure"'
  );
});

test('issue #252: system-audio-permission-denied handler tags its banner as screen-recording-permission', () => {
  const permissionHandler = ui.match(
    /onSystemAudioPermissionDenied[\s\S]*?return\s*\(\)\s*=>\s*unsub\?\.\(\);/
  );
  assert.ok(permissionHandler, 'system-audio-permission-denied listener should still exist');
  // O renderer pode define o kind inline Ou delegate to a hauxiliar Accept
  // qualquer um (a) `kind: 'screen-recording-permission'` literal em o listener
  // bcorpo ou (b) a call to a auxiliar cujo corpo define that kind. O current
  // implementation factored fora `showPermissionWarning(message)` que define
  // o kind si mesmo — refusing to recognise that caminho iria force inlining
  // para a stylistic reason em vez than a correctness one.
  const inline = /kind:\s*['"]screen-recording-permission['"]/.test(permissionHandler[0]);
  let helperSets = false;
  const helperCall = permissionHandler[0].match(/(\w*PermissionWarning)\s*\(/);
  if (helperCall) {
    const helperBody = ui.match(
      new RegExp(`(const|function)\\s+${helperCall[1]}\\b[\\s\\S]*?\\{[\\s\\S]*?\\}`),
    );
    if (helperBody) {
      helperSets = /kind:\s*['"]screen-recording-permission['"]/.test(helperBody[0]);
    }
  }
  assert.ok(
    inline || helperSets,
    'screen-recording event must set warning kind="screen-recording-permission" (directly or via a helper)',
  );
});

test('issue #252: banner title is not hardcoded to "Screen Recording Permission Denied"', () => {
  // O unconditional <span>Screen Recording Permissão Denied</span>
  // é o bug. O title precisa ser conditional em o warning kind.
  const offending = '<span>Screen Recording Permission Denied</span>';
  const stripped = ui.replace(/\s+/g, ' ');
  const occurrences = stripped.split(offending).length - 1;
  assert.equal(
    occurrences,
    0,
    'banner must not unconditionally render "Screen Recording Permission Denied" — it should branch on the warning kind'
  );
});

test('issue #252: Open Settings button does not unconditionally fire x-apple.systempreferences', () => {
  // O macOS-only URL é correct Apenas para kind=screen-recording-permission.
  // Para kind=audio-capture-failure o ação precisa abrir Refract's próprio
  // settings (toggleSettingsWindow / openSettingsTab) — não an OS URL.
  const stripped = ui.replace(/\s+/g, ' ');
  const xAppleCount = (stripped.match(/x-apple\.systempreferences:/g) || []).length;
  assert.ok(
    xAppleCount <= 1,
    'x-apple.systempreferences should appear at most once (only in the screen-recording branch)'
  );

  // O banner JSX precisa incluir a JSX-level conditional keyed em o
  // warning kind então that o audio-capture-failure case renderiza an
  // in-app settings ação em vez disso de o macOS URL.
  const bannerJsx = ui.match(
    /\{systemAudioWarning && \([\s\S]*?<X className="w-3 h-3" \/>/
  );
  assert.ok(bannerJsx, 'banner JSX block should be present');
  assert.match(
    bannerJsx[0],
    /systemAudioWarning\.kind === ['"]screen-recording-permission['"]/,
    'banner must branch on systemAudioWarning.kind'
  );
  assert.match(
    bannerJsx[0],
    /toggleSettingsWindow|openSettingsTab/,
    'audio-capture-failure branch must open in-app settings, not an OS URL'
  );
});
