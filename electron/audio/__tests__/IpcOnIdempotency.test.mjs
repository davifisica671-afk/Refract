import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ipcHandlersPath = path.resolve(__dirname, '../../../electron/ipcHandlers.ts');
const ipcSource = readFileSync(ipcHandlersPath, 'utf8');

test('send-style IPC registrations use safeOn to avoid listener accumulation', () => {
  const safeOnStart = ipcSource.indexOf('const safeOn =');
  assert.ok(safeOnStart >= 0, 'BUG: initializeIpcHandlers must define safeOn.');
  const safeOnBody = ipcSource.slice(safeOnStart, ipcSource.indexOf('};', safeOnStart) + 2);
  // Justification (deliberate evolution, invariant kept): safeOn now wraps
  // the listener with an assertAppSender forbidden-sender guard, so the raw
  // `listener` is no longer passed straight to ipcMain.on. Idempotency
  // (removeAllListeners before on) is unchanged; the guard is pinned too.
  assert.ok(
    /ipcMain\.removeAllListeners\s*\(\s*channel\s*\)/.test(safeOnBody) &&
      /ipcMain\.on\s*\(\s*channel\s*,/.test(safeOnBody) &&
      /assertAppSender\s*\(\s*event\s*,\s*channel\s*\)/.test(safeOnBody),
    'BUG: safeOn must remove old listeners before registering ipcMain.on channels.',
  );

  for (const channel of ['gemini-chat-stream-stop', 'forward-log-to-file', 'interface-theme:set']) {
    assert.ok(
      new RegExp(`safeOn\\s*\\(\\s*['"]${channel}['"]`).test(ipcSource),
      `BUG: ${channel} must be registered through safeOn, not raw ipcMain.on.`,
    );
    assert.ok(
      !new RegExp(`ipcMain\\.on\\s*\\(\\s*['"]${channel}['"]`).test(ipcSource),
      `BUG: ${channel} raw ipcMain.on registration would accumulate listeners on re-init.`,
    );
  }
});
