import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(root, 'electron/services/GitService.ts'), 'utf8');

/**
 * F-03 (alta): GitService executava `execAsync(`git ${args}`)` — shell real com
 * input do renderer. Correção: execFile/execFileSync com argv + allowlists.
 */
describe('GitService sem shell (F-03)', () => {
  test('nenhuma interpolação em shell resta no GitService', () => {
    assert.ok(!/execAsync\s*\(\s*`/.test(source), 'sem execAsync com template string');
    assert.ok(!/execSync\s*\(\s*`/.test(source), 'sem execSync com template string');
    assert.ok(!/[^e]exec\s*\(\s*`/.test(source), 'sem exec com template string');
    assert.ok(!/git \$\{/.test(source), 'sem `git ${...}` interpolado');
  });

  test('usa execFile/execFileSync com argv', () => {
    assert.match(source, /from 'child_process'/);
    assert.match(source, /execFile/);
    assert.match(source, /gitArgv/);
  });

  test('validadores de pathspec e branch existem e são aplicados', () => {
    assert.match(source, /assertSafePathSpec/);
    assert.match(source, /assertSafeBranchName/);
    assert.match(source, /SAFE_BRANCH_RE/);
  });
});

const built = path.join(root, 'dist-electron/electron/services/GitService.js');
const { assertSafePathSpec, assertSafeBranchName } = fs.existsSync(built)
  ? await import(pathToFileURL(built).href)
  : {};

describe('validadores do GitService (build dist-electron)', () => {
  test('assertSafePathSpec aceita paths normais e rejeita hostis', { skip: !assertSafePathSpec && 'rode npm run build:electron' }, () => {
    assert.doesNotThrow(() => assertSafePathSpec('src/index.ts'));
    assert.doesNotThrow(() => assertSafePathSpec('a b/c-d_e.ts'));
    // Via argv (sem shell), $()/backticks são literais inofensivos — o assert
    // estrito barra apenas o que pode alterar semântica: NUL, magia de
    // pathspec (":..."), tamanho absurdo e não-strings.
    assert.doesNotThrow(() => assertSafePathSpec('a$(id).txt'));
    for (const evil of ['', 'a\0b', ':!foo', ':/etc', 'x'.repeat(2000), 42, null]) {
      assert.throws(() => assertSafePathSpec(evil), /Invalid file path/, JSON.stringify(evil));
    }
  });

  test('assertSafeBranchName aceita branches normais e rejeita hostis', { skip: !assertSafeBranchName && 'rode npm run build:electron' }, () => {
    assert.doesNotThrow(() => assertSafeBranchName('feature/x-1.2'));
    assert.doesNotThrow(() => assertSafeBranchName('main'));
    for (const evil of ['-h', '--help', 'a$(id)', 'a`id`', 'a b', '..', 'a..b', 'a@{1}', 'a~1', 'a^', 'a:b', 'a?b', 'a*b', 'a[bc', '-foo', 'a/', 'a.lock', '', null, 7]) {
      assert.throws(() => assertSafeBranchName(evil), /Invalid branch name/, JSON.stringify(evil));
    }
  });
});
