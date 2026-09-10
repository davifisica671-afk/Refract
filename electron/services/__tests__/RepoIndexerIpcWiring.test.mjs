// Regression test for the Dev Dashboard "repository indexer" IPC wiring.
//
// Context — the bug we are guarding against
//   The Dev Dashboard (src/components/dev/DevDashboard.tsx) lets the user pick a
//   local repository folder and index it for coding-assistant RAG. It depends on
//   three bridge methods exposed by preload:
//     getRepoPath() -> ipcRenderer.invoke('get-setting', 'repoIndexerPath')
//     setRepoPath() -> ipcRenderer.invoke('set-setting', 'repoIndexerPath', path)
//     selectFolder() -> ipcRenderer.invoke('dialog:selectFolder')
//   Until this fix, NONE of those three channels had a matching ipcMain.handle
//   registration in the main process. The renderer's invokes rejected (or hung)
//   silently, so the Dev Dashboard's "Browse" button did nothing and the stored
//   repo path could never be read back.
//
//   This is exactly the class of bug the existing SkillsIpcWiring.test.mjs
//   "every invoke channel has a handler" invariant already catches; this suite
//   pins the specific three-channel contract plus the security property that the
//   generic get-setting/set-setting surface is whitelist-guarded.
//
// Why a static/source test, not an import-from-main test
//   electron/ipcHandlers.ts imports the whole app (electron, services, LLM
//   helpers) and cannot be imported from a node:test runner without an Electron
//   process and a compiled dist-electron. Like the other wiring tests, we read
//   the sources and assert the shape of the code so a future contributor cannot
//   silently drop a handler, a preload binding, or the whitelist guard.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSafeHandle, sliceSafeHandleBlock } from './ipcTestUtils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('get-setting / set-setting / dialog:selectFolder handlers are registered in ipcHandlers.ts', () => {
  const source = read('electron/ipcHandlers.ts');

  assert.ok(findSafeHandle(source, 'get-setting') >= 0, 'get-setting handler must be registered');
  assert.ok(findSafeHandle(source, 'set-setting') >= 0, 'set-setting handler must be registered');
  assert.ok(findSafeHandle(source, 'dialog:selectFolder') >= 0, 'dialog:selectFolder handler must be registered');
});

test('get-setting / set-setting are whitelist-guarded to repoIndexerPath', () => {
  const source = read('electron/ipcHandlers.ts');

  // The generic settings passthrough must never expose arbitrary keys. The only
  // key allowed today is the coding-assistant repo path.
  const getBlock = sliceSafeHandleBlock(source, 'get-setting');
  assert.match(getBlock, /SETTINGS_WHITELIST\.has\(key\)/, 'get-setting must consult the whitelist');
  assert.match(getBlock, /SettingsManager\.getInstance\(\)\.get\(/, 'get-setting must delegate to SettingsManager');

  const setBlock = sliceSafeHandleBlock(source, 'set-setting');
  assert.match(setBlock, /SETTINGS_WHITELIST\.has\(key\)/, 'set-setting must consult the whitelist');
  assert.match(setBlock, /SettingsManager\.getInstance\(\)\.set\(/, 'set-setting must delegate to SettingsManager');

  // The whitelist itself must contain only repoIndexerPath (single source of truth).
  assert.match(
    source,
    /SETTINGS_WHITELIST[^;]*new Set\(\s*\[?\s*['"]repoIndexerPath['"]\s*\]?\s*\)/s,
    'whitelist must be seeded with repoIndexerPath',
  );
});

test('dialog:selectFolder opens a directory picker and returns a single path', () => {
  const block = sliceSafeHandleBlock(read('electron/ipcHandlers.ts'), 'dialog:selectFolder');

  assert.match(block, /dialog\.showOpenDialog\(/, 'must use the native open dialog');
  assert.match(block, /properties:\s*\[\s*['"]openDirectory['"]\s*\]/, 'must be a folder (openDirectory) picker');
  assert.match(block, /result\.filePaths\[0\]/, 'must return the first selected path');
});

test('preload maps getRepoPath / setRepoPath / selectFolder to the three channels', () => {
  const preload = read('electron/preload.ts');

  assert.match(preload, /getRepoPath:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(['"]get-setting['"],\s*['"]repoIndexerPath['"]\)/);
  assert.match(preload, /setRepoPath:\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\(['"]set-setting['"],\s*['"]repoIndexerPath['"],\s*[^)]+\)/);
  assert.match(preload, /selectFolder:\s*\(\)\s*=>\s*ipcRenderer\.invoke\(['"]dialog:selectFolder['"]\)/);
});

test('repoIndexerPath is a declared AppSettings key (SettingsManager)', () => {
  const sm = read('electron/services/SettingsManager.ts');
  assert.match(sm, /repoIndexerPath\?:\s*string;/, 'AppSettings must declare repoIndexerPath');
});

test('Dev Dashboard consumes the bridge methods (not a silent optional chain)', () => {
  const view = read('src/components/dev/DevDashboard.tsx');

  assert.match(view, /api\?\.getRepoPath/, 'must guard the bridge before reading the repo path');
  assert.match(view, /api\.getRepoPath\(\)\.then\(setRepoPath\)/, 'must read the repo path on mount');
  assert.match(view, /await\s+api\.selectFolder\(\)/, 'must call selectFolder to browse');
});
