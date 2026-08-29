// Tests executa contra o esbuild-compiled CodexCliService em dist-electron/.
// Executa vvia npm executa build:electron && nó --testar electron/services/__tests__/

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const compiledPath = path.resolve(__dirname, '../../../dist-electron/electron/services/CodexCliService.js');
const mod = await import(pathToFileURL(compiledPath).href);
const { CodexCliService, DEFAULT_CODEX_CLI_CONFIG, CODEX_SANDBOX_MODES } = mod;

// Mock binário that ignora todos argv and sleeps 30s — used para in-flight abort/timeout tests.
// /bin/sleep rejects codex's argv, então we need a script that swallows args.
const MOCK_HANG_BIN = path.join(os.tmpdir(), `codex-mock-hang-${process.pid}.sh`);
before(() => {
  fs.writeFileSync(MOCK_HANG_BIN, '#!/bin/sh\nexec sleep 30\n', { mode: 0o755 });
});
after(() => {
  try { fs.unlinkSync(MOCK_HANG_BIN); } catch {}
});

test('DEFAULT_CODEX_CLI_CONFIG has expected shape', () => {
  assert.equal(DEFAULT_CODEX_CLI_CONFIG.enabled, false);
  assert.equal(DEFAULT_CODEX_CLI_CONFIG.path, 'codex');
  assert.equal(DEFAULT_CODEX_CLI_CONFIG.model, 'gpt-5.4');
  assert.equal(DEFAULT_CODEX_CLI_CONFIG.fastModel, 'gpt-5.3-codex');
  assert.equal(DEFAULT_CODEX_CLI_CONFIG.timeoutMs, 60_000);
  assert.equal(DEFAULT_CODEX_CLI_CONFIG.sandboxMode, 'read-only');
});

test('CODEX_SANDBOX_MODES enumerates the three valid modes', () => {
  assert.deepEqual([...CODEX_SANDBOX_MODES], ['read-only', 'workspace-write', 'danger-full-access']);
});

test('normalizeConfig: empty input returns defaults', () => {
  assert.deepEqual(CodexCliService.normalizeConfig({}), DEFAULT_CODEX_CLI_CONFIG);
});

test('normalizeConfig: invalid timeouts fall back to default', () => {
  assert.equal(CodexCliService.normalizeConfig({ timeoutMs: null }).timeoutMs, 60_000);
  assert.equal(CodexCliService.normalizeConfig({ timeoutMs: -1 }).timeoutMs, 60_000);
  assert.equal(CodexCliService.normalizeConfig({ timeoutMs: 0 }).timeoutMs, 60_000);
  assert.equal(CodexCliService.normalizeConfig({ timeoutMs: 'abc' }).timeoutMs, 60_000);
  assert.equal(CodexCliService.normalizeConfig({ timeoutMs: 30_000 }).timeoutMs, 30_000);
});

test('normalizeConfig: whitespace path falls back to default', () => {
  assert.equal(CodexCliService.normalizeConfig({ path: '   ' }).path, 'codex');
  assert.equal(CodexCliService.normalizeConfig({ path: '/usr/local/bin/codex' }).path, '/usr/local/bin/codex');
});

test('normalizeConfig: enabled is coerced to boolean', () => {
  assert.equal(CodexCliService.normalizeConfig({ enabled: 1 }).enabled, true);
  assert.equal(CodexCliService.normalizeConfig({ enabled: 0 }).enabled, false);
  assert.equal(CodexCliService.normalizeConfig({ enabled: 'yes' }).enabled, true);
  assert.equal(CodexCliService.normalizeConfig({ enabled: undefined }).enabled, false);
});

test('normalizeConfig: invalid sandboxMode falls back to read-only', () => {
  assert.equal(CodexCliService.normalizeConfig({ sandboxMode: 'evil' }).sandboxMode, 'read-only');
  assert.equal(CodexCliService.normalizeConfig({ sandboxMode: undefined }).sandboxMode, 'read-only');
});

test('normalizeConfig: valid sandboxModes are preserved', () => {
  assert.equal(CodexCliService.normalizeConfig({ sandboxMode: 'workspace-write' }).sandboxMode, 'workspace-write');
  assert.equal(CodexCliService.normalizeConfig({ sandboxMode: 'danger-full-access' }).sandboxMode, 'danger-full-access');
});

test('buildArgs: argv ordering and fixed flags', () => {
  const args = CodexCliService.buildArgs('gpt-5.4');
  assert.equal(args[0], 'exec');
  assert.ok(args.includes('--json'));
  assert.ok(args.includes('--color') && args[args.indexOf('--color') + 1] === 'never');
  assert.ok(args.includes('--skip-git-repo-check'));
  assert.equal(args[args.length - 2], '--model');
  assert.equal(args[args.length - 1], 'gpt-5.4');
});

test('buildArgs: defaults sandbox to read-only', () => {
  const args = CodexCliService.buildArgs('gpt-5.4');
  const idx = args.indexOf('--sandbox');
  assert.notEqual(idx, -1);
  assert.equal(args[idx + 1], 'read-only');
});

test('buildArgs: respects explicit sandboxMode', () => {
  const args = CodexCliService.buildArgs('gpt-5.4', [], 'workspace-write');
  const idx = args.indexOf('--sandbox');
  assert.equal(args[idx + 1], 'workspace-write');
});

test('buildArgs: image paths are repeated as --image, empties skipped', () => {
  const args = CodexCliService.buildArgs('gpt-5.4', ['/tmp/a.png', '', '/tmp/b.png']);
  const imageFlags = args.filter(a => a === '--image');
  assert.equal(imageFlags.length, 2);
  assert.ok(args.includes('/tmp/a.png'));
  assert.ok(args.includes('/tmp/b.png'));
});

test('extractText: parses Codex --json delta event stream', () => {
  const sample = [
    '{"type":"thread.started","thread_id":"abc"}',
    '{"type":"agent_message.delta","delta":"Hello"}',
    '{"type":"agent_message.delta","delta":" world"}',
    '{"type":"turn.completed"}',
  ].join('\n');
  assert.equal(CodexCliService.extractText(sample), 'Hello world');
});

test('extractText: passes through plain text untouched', () => {
  assert.equal(CodexCliService.extractText('plain hi'), 'plain hi');
});

test('extractText: strips markdown json fence', () => {
  assert.equal(CodexCliService.extractText('```json\n{"x":1}\n```'), '{"x":1}');
});

test('extractText: lifecycle-only events return empty string', () => {
  assert.equal(
    CodexCliService.extractText('{"type":"turn.started"}\n{"type":"turn.completed"}'),
    '',
  );
});

test('extractText: agent_message item with text payload', () => {
  assert.equal(
    CodexCliService.extractText('{"item":{"type":"agent_message","text":"hi there"}}'),
    'hi there',
  );
});

test('extractText: error item is suppressed', () => {
  assert.equal(
    CodexCliService.extractText('{"item":{"type":"error","message":"boom"}}'),
    '',
  );
});

test('extractText: walks output_text key', () => {
  assert.equal(CodexCliService.extractText('{"output_text":"OK"}'), 'OK');
});

test('extractText: joins content arrays', () => {
  assert.equal(CodexCliService.extractText('{"content":["a","b","c"]}'), 'abc');
});

test('extractText: empty input returns empty', () => {
  assert.equal(CodexCliService.extractText(''), '');
  assert.equal(CodexCliService.extractText('   '), '');
});

test('extractCodexError: pulls message from stringified error envelope', () => {
  const sample = [
    '{"type":"thread.started","thread_id":"abc"}',
    '{"type":"turn.started"}',
    '{"type":"error","message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The \'gpt-5.3-codex-spark\' model is not supported when using Codex with a ChatGPT account.\\"}}"}',
    '{"type":"turn.failed"}',
  ].join('\n');
  const msg = CodexCliService.extractCodexError(sample);
  assert.match(msg, /not supported when using Codex with a ChatGPT account/);
});

test('extractCodexError: returns empty when no error events present', () => {
  const sample = '{"type":"agent_message.delta","delta":"hi"}';
  assert.equal(CodexCliService.extractCodexError(sample), '');
});

test('extractCodexError: handles plain string error message', () => {
  assert.equal(
    CodexCliService.extractCodexError('{"type":"error","message":"network unreachable"}'),
    'network unreachable',
  );
});

test('getCandidatePaths: includes /Applications/Codex.app on macOS', () => {
  const candidates = CodexCliService.getCandidatePaths();
  assert.ok(Array.isArray(candidates));
  assert.ok(candidates.length > 0);
  if (process.platform === 'darwin') {
    assert.ok(candidates.includes('/Applications/Codex.app/Contents/Resources/codex'));
  }
});

test('autoDetectPath: returns null or a real, existing executable file', () => {
  const detected = CodexCliService.autoDetectPath();
  if (detected !== null) {
    const stat = fs.statSync(detected);
    assert.ok(stat.isFile(), `${detected} should be a file`);
    if (process.platform !== 'win32') {
      assert.ok((stat.mode & 0o111) !== 0, `${detected} should be executable`);
    }
  }
});

test('validateExecutable: returns resolvedPath on success', async () => {
  const r = await CodexCliService.validateExecutable('/bin/echo', 2000);
  assert.equal(r.success, true);
  assert.equal(r.resolvedPath, '/bin/echo');
});

test('validateExecutable: bare unfound name falls back to auto-detection if available', async () => {
  // Uso a fake bare nome that won't exist; if autoDetectPath encontra a real
  // codex em this machine, we deve obtém success. OCaso contrário expect failure.
  const r = await CodexCliService.validateExecutable('definitely-not-a-real-binary-xyz', 5000);
  const detected = CodexCliService.autoDetectPath();
  if (detected) {
    assert.equal(r.success, true);
    assert.equal(r.resolvedPath, detected);
  } else {
    assert.equal(r.success, false);
    assert.ok(typeof r.error === 'string');
  }
});

test('validateExecutable: missing binary returns success=false with error string', async () => {
  const r = await CodexCliService.validateExecutable('/nonexistent/codex-bin', 2000);
  assert.equal(r.success, false);
  assert.equal(typeof r.error, 'string');
  assert.ok(r.error.length > 0);
});

test('validateExecutable: real --version-capable binary returns success=true', async () => {
  const r = await CodexCliService.validateExecutable('/bin/echo', 2000);
  assert.equal(r.success, true);
});

test('run: timeout is enforced (binary outlives timeoutMs)', async () => {
  const t0 = Date.now();
  await assert.rejects(
    () => CodexCliService.run(MOCK_HANG_BIN, { prompt: '', model: 'm', timeoutMs: 500 }),
    err => /timed out/i.test(err.message),
  );
  assert.ok(Date.now() - t0 < 2500);
});

test('run: AbortSignal pre-aborted rejects without spawning', async () => {
  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    () => CodexCliService.run(MOCK_HANG_BIN, { prompt: '', model: 'm', timeoutMs: 60_000, signal: ac.signal }),
    err => /aborted/i.test(err.message),
  );
});

test('run: AbortSignal aborts an in-flight call quickly', async () => {
  const ac = new AbortController();
  const promise = CodexCliService.run(MOCK_HANG_BIN, { prompt: '', model: 'm', timeoutMs: 60_000, signal: ac.signal });
  setTimeout(() => ac.abort(), 150);
  const t0 = Date.now();
  await assert.rejects(promise, err => /aborted/i.test(err.message));
  assert.ok(Date.now() - t0 < 2000);
});

test('stream: AbortSignal pre-aborted throws on first iteration', async () => {
  const ac = new AbortController();
  ac.abort();
  const gen = CodexCliService.stream(MOCK_HANG_BIN, { prompt: '', model: 'm', timeoutMs: 60_000, signal: ac.signal });
  await assert.rejects(async () => {
    for await (const _ of gen) { /* drain */ }
  }, err => /aborted/i.test(err.message));
});

test('stream: AbortSignal aborts an in-flight stream and returns without throwing', async () => {
  const ac = new AbortController();
  const gen = CodexCliService.stream(MOCK_HANG_BIN, { prompt: '', model: 'm', timeoutMs: 60_000, signal: ac.signal });
  setTimeout(() => ac.abort(), 150);
  const t0 = Date.now();
  // Após abortar o generator deve completa sem throwing (partials surfaced as-is).
  for await (const _ of gen) { /* drain */ }
  assert.ok(Date.now() - t0 < 2000);
});
