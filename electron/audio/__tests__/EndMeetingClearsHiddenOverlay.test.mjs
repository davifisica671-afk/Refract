// Regression testar para o "stale/choppy overlay UI em meeting restart" bug —
// o remaining half após o renderer-side width-collapse fix.
//
// Symptom: starting a new meeting logo após a prior one briefly showed o
// Anterior meeting's overlay UI (old messages + expanded width), então tore it
// abaixo on-screen com a choppy ~1s ccolapsar
//
// Root cause: o overlay BrowserWindow é PERSISTENT — created com
// show:false and após isso apenas hide()/show()'d (WindowHelper), nunca
// destroyed. Its React árvore é nunca unmounted entre meetings. startMeeting()
// show()s o overlay (setWindowMode('overlay')) Antes o start-side
// `session-reset` IPC lands, então o window paints o anterior meeting's
// content para vários frames, então limpa it on-screen (chat desmontar + height
// recompute + shellWidth→OS-resize shrink) = o visible choppy flash.
// endMeeting() used to ocultar o overlay mas nunca claro it, então o stale árvore
// era carried direto dentro de o próximo meeting's primeiro visible frames.
//
// Fix: endMeeting() agora envia `session-reset` to o overlay Imediatamente Após
// setWindowMode('launcher') tem hidden it. O renderer's onSessionReset
// manipulador executa o completo synchronous claro enquanto o window é HIDDEN, com a
// whole meeting de idle time antes o próximo shmostrar — então o próximo meeting's
// primeiro visible frame é já o clean collapsed baseline, com nada to
// resize ou tear abaixo em screen.
//
// SEstratégia source-contract assertions contra o endMeeting() corpo em
// main.ts. O ordering (ocultar Então cclaro é load-bearing — clearing antes
// o ocultar iria claro enquanto visible (o bug). These structural assertions
// pin o wiring então a future refactor that drops o senvia ou move it antes
// o hocultar fails CI loudly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../../electron/main.ts');
const mainSource = readFileSync(mainPath, 'utf8');

function extractMethodBody(methodName) {
  const re = new RegExp(`(?:public|private|protected)\\s+(?:async\\s+)?${methodName}\\s*\\([^)]*\\)\\s*(?::[^{]*)?\\{`);
  const m = re.exec(mainSource);
  assert.ok(m, `could not locate ${methodName} in main.ts`);
  let i = m.index + m[0].length;
  let depth = 1;
  const start = i;
  while (i < mainSource.length && depth > 0) {
    const ch = mainSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  assert.equal(depth, 0, `unbalanced braces in ${methodName}`);
  return mainSource.slice(start, i - 1);
}

const endMeetingBody = extractMethodBody('endMeeting');

test('endMeeting sends session-reset to the overlay so its hidden tree is cleared before the next meeting', () => {
  assert.ok(
    /getOverlayWindow\(\)\?\.\s*webContents\.send\(\s*['"]session-reset['"]\s*\)/.test(endMeetingBody),
    'BUG: endMeeting() must send `session-reset` to the overlay window. The overlay is persistent (never destroyed) and only hidden/shown, so without clearing it on stop the previous meeting\'s messages + expanded width survive into the next meeting\'s first visible frame.',
  );
});

test('endMeeting clears the overlay AFTER hiding it (setWindowMode(launcher)), so the clear is off-screen', () => {
  const hideIdx = endMeetingBody.search(/setWindowMode\(\s*['"]launcher['"]\s*\)/);
  const resetIdx = endMeetingBody.search(/getOverlayWindow\(\)\?\.\s*webContents\.send\(\s*['"]session-reset['"]\s*\)/);

  assert.ok(hideIdx >= 0, 'sanity: endMeeting() must switch to launcher (hides the overlay).');
  assert.ok(resetIdx >= 0, 'sanity: endMeeting() must send session-reset to the overlay.');
  assert.ok(
    hideIdx < resetIdx,
    'BUG: endMeeting() must hide the overlay (setWindowMode("launcher")) BEFORE sending session-reset — otherwise the clear (messages teardown + width shrink) runs while the overlay is still VISIBLE, which is the on-screen choppy collapse this fix exists to remove.',
  );
});
