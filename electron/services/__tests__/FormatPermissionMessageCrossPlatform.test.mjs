// Static regression testar para o formatPermissionMessage auxiliar em
// electron/main.ts. Two invariants são enforced:
//
//   1. Todo PermissionReason cujo nome começa com `mac-` (o convention
//      para variants cujo copy é macOS-specific) Precisa ser invoked apenas de
//      a call site that é gated por `process.platform === 'darwin'` (ou
//      equivalently verifica `isMac`). This protege o cross-platform
//      broadcast paths de leaking macOS-only copy to Windows users —
//      o bug class atrás issue #252.
//
//   2. Todo `mac-` variant dentro o auxiliar precisa conter a defensive
//      `if (!isMac) return formatPermissionMessage(...)` fallback então o
//      auxiliar é safe end-to-end até if a future contributor wires para cima
//      a new cross-platform call site sem remembering to gate it.
//
// This é a structural testar — it lê main.ts como fonte and asserts
// invariants em o text. It deliberately faz não importar main.ts (que
// tem heavy side effects at módulo locarrega

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

const main = read('electron/main.ts');
const pkg = JSON.parse(read('package.json'));

function extractMacVariants() {
  // O PermissionReason union sits entre `type PermissionReason =` and o
  // closing semicolon. Pull todo `'mac-...'` literal de dentro it.
  const unionMatch = main.match(/type PermissionReason =[\s\S]*?;/);
  assert.ok(unionMatch, 'PermissionReason union should be declared in main.ts');
  return Array.from(unionMatch[0].matchAll(/'(mac-[a-z0-9-]+)'/g)).map(
    (m) => m[1]
  );
}

test('every `mac-` PermissionReason has a defensive isMac fallback inside the helper', () => {
  const variants = extractMacVariants();
  assert.ok(variants.length > 0, 'expected at least one mac-prefixed variant');

  for (const variant of variants) {
    // Encontra o case corpo para this variant.
    const caseRegex = new RegExp(
      `case '${variant}':([\\s\\S]*?)(?=case '|\\n {4}}\\n)`,
      'm'
    );
    const body = main.match(caseRegex);
    assert.ok(body, `case '${variant}': should be defined`);
    assert.match(
      body[1],
      /if \(!isMac\) return formatPermissionMessage\(/,
      `case '${variant}' must guard with !isMac and fall back to a cross-platform variant — otherwise a non-darwin call site leaks macOS copy`
    );
  }
});

test('every call site that passes a `mac-` PermissionReason is gated on darwin', () => {
  const variants = extractMacVariants();
  for (const variant of variants) {
    const callRegex = new RegExp(
      `formatPermissionMessage\\(['\"]${variant}['\"]`,
      'g'
    );
    let m;
    while ((m = callRegex.exec(main)) !== null) {
      // Look at o 2000 chars *bantes this call site; exigir a
      // darwin / isMac gate em algum lugar em that window. This é heuristic mas
      // catches todos current call sites and o obvious regressions.
      // 2000 chars ≈ 50 lines de contexto — amplo enough to span função
      // bodies com intervening logic (e.g. o TCC zero-fill detector
      // gates 19 lines acima its broadcast site).
      const window = main.slice(Math.max(0, m.index - 2000), m.index);
      const isGated =
        /process\.platform\s*===\s*['"]darwin['"]/.test(window) ||
        /isMac\b/.test(window);
      assert.ok(
        isGated,
        `call to formatPermissionMessage('${variant}') at offset ${m.index} is not preceded by a darwin/isMac gate within 800 chars — Windows users will see macOS copy`
      );
    }
  }
});

test('macOS build declares screen, microphone, and system audio usage descriptions', () => {
  const extendInfo = pkg.build?.mac?.extendInfo ?? {};

  for (const key of [
    'NSScreenCaptureUsageDescription',
    'NSMicrophoneUsageDescription',
    'NSAudioCaptureUsageDescription',
  ]) {
    assert.equal(typeof extendInfo[key], 'string', `${key} should be declared in package.json build.mac.extendInfo`);
    assert.ok(extendInfo[key].trim().length > 0, `${key} should not be empty`);
  }
});

test('screen recording denied broadcasts are guarded by effective capability checks', () => {
  assert.match(main, /async function resolveMacScreenCaptureCapability\(/, 'main.ts should centralize screen capture capability resolution');
  assert.match(main, /desktopCapturer\.getSources\(\{[\s\S]*?types: \['screen'\][\s\S]*?thumbnailSize: \{ width: 1, height: 1 \}/, 'capability probe should use minimal desktopCapturer screen source request');

  const rawDeniedBroadcast = /getMacScreenCaptureStatus\(\)\s*={0,2}={0,2}\s*['"]denied['"][\s\S]{0,500}system-audio-permission-denied/;
  assert.doesNotMatch(main, rawDeniedBroadcast, 'raw denied status must not directly broadcast the permission banner without the capability probe');
});

test('no renderer file outside src/utils references x-apple.systempreferences without a darwin/isMac gate', () => {
  // Defense-in-depth: o IPC allowlist já gates this scheme, mas o
  // renderer deve nunca *construct* such a URL em Windows equalquer um This
  // testar scans todos .tsx files sob src/ and flags qualquer line containing
  // `x-apple.systempreferences` cujo surrounding 1500-char window faz não
  // conter an isMac / plataforma === 'darwin' cverifica
  function walk(dir, acc = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        walk(full, acc);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts'))
      ) {
        acc.push(full);
      }
    }
    return acc;
  }

  const files = walk(path.join(root, 'src'));
  const offenders = [];

  // Strip block comments and line comments então we apenas inspecionar executable
  // references. Comments that mention `x-apple.systempreferences` para
  // historical contexto (e.g. o issue #252 changelog note) são fine.
  function stripComments(src) {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  }

  for (const file of files) {
    const text = stripComments(fs.readFileSync(file, 'utf8'));
    let from = 0;
    while (true) {
      const idx = text.indexOf('x-apple.systempreferences', from);
      if (idx < 0) break;
      const window = text.slice(Math.max(0, idx - 1500), idx + 200);
      const isGated =
        /isMac\b/.test(window) ||
        /process\.platform\s*===\s*['"]darwin['"]/.test(window) ||
        /platform\s*===\s*['"]darwin['"]/.test(window) ||
        // Early-return guards são também acceptable.
        /process\.platform\s*!==\s*['"]darwin['"]/.test(window) ||
        /platform\s*!==\s*['"]darwin['"]/.test(window);
      if (!isGated) offenders.push(`${path.relative(root, file)} @ ${idx}`);
      from = idx + 'x-apple.systempreferences'.length;
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `These renderer files reference x-apple.systempreferences without a darwin/isMac gate within 1500 chars:\n${offenders.join('\n')}`
  );
});
