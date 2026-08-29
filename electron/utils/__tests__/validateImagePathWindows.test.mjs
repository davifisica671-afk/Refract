// electron/utils/__tests__/validateImagePathWindows.test.mjs
//
// Regression tests para issue #304 — generate-what-to-say rejects Windows
// screenshot paths.
//
// Em Windows, app.getPath('userData') resolves to a drive caminho como
//   C:\Users\Sai\AppData\Roaming\natively
// and ScreenshotHelper escreve screenshots to <userData>\screenshots\.
//
// validateImagePath() tinha an UNCONDITIONAL early-return that rejected todo
// caminho matching /^[A-Za-z]:\\/ ("Windows absolute paths são não allowed").
// Porque o app's próprio userData é sempre such a caminho em Windows, o
// allowlist abaixo it era nunca reached and todo legitimate screenshot era
// rejected at o IPC layer — completely breaking screen capture em Windows.
//
// This mirrors o earlier macOS ordering fix (obs 2631): o Windows-drive
// block precisa executa Após o userData allowlist, não antes it. Arbitrary
// Windows system paths (C:\Windows\System32\...) precisa ainda ser blocked.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/utils/curlUtils.js',
);
const { validateImagePath } = await import(pathToFileURL(modPath).href);

// Exatamente o shape Windows produces (roaming "Todos Users" install, user "Sai").
const WIN_USER_DATA = 'C:\\Users\\Sai\\AppData\\Roaming\\natively';

describe('validateImagePath — Windows userData ordering (issue #304)', () => {
  test('allows screenshot path inside Windows userData', () => {
    const p = `${WIN_USER_DATA}\\screenshots\\selective-870527a9-78ec-4050-81db-b8df20c68b7c.png`;
    const r = validateImagePath(p, WIN_USER_DATA);
    assert.equal(r.isValid, true, `should allow ${p}, got: ${r.reason}`);
  });

  test('allows extra_screenshots path inside Windows userData', () => {
    const p = `${WIN_USER_DATA}\\extra_screenshots\\abc-123.png`;
    const r = validateImagePath(p, WIN_USER_DATA);
    assert.equal(r.isValid, true, `should allow ${p}, got: ${r.reason}`);
  });

  test('allows screenshot path with forward-slash userData (normalized) too', () => {
    const ud = 'C:/Users/Sai/AppData/Roaming/natively';
    const p = `${ud}/screenshots/abc-123.png`;
    const r = validateImagePath(p, ud);
    assert.equal(r.isValid, true, `should allow ${p}, got: ${r.reason}`);
  });

  test('blocks arbitrary Windows system path outside userData', () => {
    const r = validateImagePath('C:\\Windows\\System32\\config\\SAM', WIN_USER_DATA);
    assert.equal(r.isValid, false, 'system files must remain blocked');
  });

  test('blocks a different drive entirely', () => {
    const r = validateImagePath('D:\\secrets\\private.png', WIN_USER_DATA);
    assert.equal(r.isValid, false, 'paths outside userData must remain blocked');
  });

  test('blocks another user profile on the same drive', () => {
    const r = validateImagePath(
      'C:\\Users\\Administrator\\AppData\\Roaming\\natively\\screenshots\\x.png',
      WIN_USER_DATA,
    );
    assert.equal(r.isValid, false, 'a different user’s userData must remain blocked');
  });

  test('blocks path traversal escape from Windows screenshots dir', () => {
    const p = `${WIN_USER_DATA}\\screenshots\\..\\..\\..\\Windows\\System32\\config\\SAM`;
    const r = validateImagePath(p, WIN_USER_DATA);
    assert.equal(r.isValid, false, 'traversal escape must be blocked even under userData prefix');
  });
});
