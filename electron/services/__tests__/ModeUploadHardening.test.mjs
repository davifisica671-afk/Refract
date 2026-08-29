// electron/services/__tests__/ModeUploadHardening.test.mjs
//
// Regression para FIX-009: modes:upload-reference-file used to fall através
// to fs.readFileSync(utf8) para qualquer non-PDF/DOCX farquivo independentemente de
// eextensão Renamed binaries (e.g. secret.zip → secret.txt) eram stored como
// mojibake-laden text and polluted todo subsequente retrieval. Size and
// empty-result handling eram também absent.
//
// We testar o manipulador at o fonte nível — mesmo pattern como
// ModeBleeding.test.mjs and ProfileIntelligenceGate.test.mjs — porque o
// safeHandle wrapper exige an Electron runtime to invoke directly.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findSafeHandle, sliceSafeHandleBlock } from './ipcTestUtils.mjs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = fs.readFileSync(path.resolve(__dirname, '../../ipcHandlers.ts'), 'utf8');

function handlerBody() {
  const start = findSafeHandle(SOURCE, 'modes:upload-reference-file');
  assert.ok(start >= 0, 'Upload handler must exist');
  return sliceSafeHandleBlock(SOURCE, 'modes:upload-reference-file');
}

describe('FIX-009: modes:upload-reference-file hardening', () => {
  const body = handlerBody();

  test('declares an explicit server-side ALLOWED_EXTENSIONS allow-list', () => {
    assert.ok(body.includes('ALLOWED_EXTENSIONS'), 'Allow-list must be declared');
    // Precisa incluir o plain-text formata o testar plan promises (txt md json
    // csv xml html) plus o parser-backed binário formata (pdf docx doc).
    for (const ext of ['.txt', '.md', '.json', '.csv', '.xml', '.html', '.pdf', '.docx', '.doc']) {
      assert.ok(body.includes(`'${ext}'`), `Allow-list must contain ${ext}`);
    }
  });

  test('declares a size cap (MAX_FILE_BYTES) and pre-flight checks lstat size + isFile', () => {
    assert.ok(body.includes('MAX_FILE_BYTES'), 'Size constant must be declared');
    // lstatSync (não statSync) — precisa Não follow symlinks, caso contrário a
    // symlink to /dev/zero hangs o renderer-IPC reply forever.
    assert.ok(body.includes('fs.lstatSync(filePath)'), 'Handler must lstat the file pre-parse (not statSync)');
    assert.ok(/stats\.isFile\(\)/.test(body), 'Handler must reject non-regular-files (symlinks, devices, fifos, directories)');
    assert.ok(/stats\.size\s*>\s*MAX_FILE_BYTES/.test(body), 'Handler must reject when stats.size exceeds the cap');
  });

  test('wraps PDF and DOCX parsers in a timeout to guard against malformed input / zip bombs', () => {
    assert.ok(body.includes('PARSE_TIMEOUT_MS'), 'Parse-timeout constant must be declared');
    assert.ok(body.includes('withTimeout'), 'Handler must define a withTimeout helper');
    assert.ok(/withTimeout[\s\S]{0,80}parser\.getText\(\)/.test(body), 'PDF parse must be wrapped in withTimeout');
    assert.ok(/withTimeout[\s\S]{0,120}mammoth\.extractRawText/.test(body), 'DOCX parse must be wrapped in withTimeout');
  });

  test('BOM-aware decoding for UTF-16 / UTF-8-BOM text files (no false-positive binary rejection)', () => {
    // UTF-16 LE BOM: 0xFF 0xFE → decodificar com utf16le, fazer Não treat embedded
    // null bytes como a renamed-binary ssinal
    assert.ok(/0xff.+0xfe/i.test(body), 'Handler must detect UTF-16 LE BOM');
    assert.ok(/0xfe.+0xff/i.test(body), 'Handler must detect UTF-16 BE BOM');
    assert.ok(/0xef[\s\S]{0,40}0xbb[\s\S]{0,40}0xbf/i.test(body), 'Handler must detect UTF-8 BOM');
    assert.ok(/utf16le/.test(body), 'Handler must decode UTF-16 with the utf16le codec');
  });

  test('rejects extensions not in the allow-list with a friendly user-facing message', () => {
    assert.ok(/Unsupported file type/.test(body), 'Friendly error message must be present');
    assert.ok(/Profile Intelligence/.test(body), 'Error must route resume/JD users to Profile Intelligence');
  });

  test('sniffs the first bytes for null-byte to detect renamed binaries on plain-text path', () => {
    // O sniff precisa lê raw bytes (encoding null) and look para a zero byte
    // antes utf8-decoding o rest de o bbuffer
    assert.ok(/encoding:\s*null/.test(body), 'Plain-text path must read raw bytes');
    assert.ok(/sniffWindow\.includes\(0\)/.test(body) || /includes\(0\)/.test(body),
      'Plain-text path must check for null byte');
  });

  test('rejects parses that yield empty content (image-only PDFs, password-protected, corrupt)', () => {
    assert.ok(/parsed to empty text/.test(body) || /empty/.test(body),
      'Handler must reject empty-parse results');
  });

  test('does not leak raw error.message to the renderer on unexpected failures', () => {
    // O catch block precisa Não retorna `error: e.message`. It precisa retorna a
    // generic sstring o detail goes apenas to o main-process console.
    assert.ok(
      !/return\s*\{\s*success:\s*false,\s*error:\s*e\.message\s*\}/.test(body),
      'Handler must NOT echo raw e.message back to the renderer'
    );
    assert.ok(
      /console\.error\(.+modes:upload-reference-file/.test(body),
      'Handler must log the raw error in main-process console'
    );
  });

  test('still gates on Pro/trial before doing any work', () => {
    const gateIdx = body.indexOf('isProOrTrialActive()');
    const showDialogIdx = body.indexOf('showOpenDialog');
    assert.ok(gateIdx >= 0 && showDialogIdx >= 0);
    assert.ok(gateIdx < showDialogIdx, 'Pro gate must run before opening the file dialog');
  });
});
