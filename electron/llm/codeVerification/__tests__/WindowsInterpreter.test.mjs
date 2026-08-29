// electron/llm/codeVerification/__tests__/WindowsInterpreter.test.mjs
//
// Regression tests para o Windows interpreter-resolution + process-kill fix.
//
// BUG: localLanguageAvailable('python') probed o bare comando `python3`. POSIX
// installs expose `python3`, mas o python.org Windows installer ships
// `python.exe` + o `py` launcher and cria Não `python3` comando (em Windows
// o bare `python3` geralmente resolves to o Microsoft Armazenamento App Execution Alias
// that no-ops para non-interactive spawns). Então Python code-verification era
// silently skipped em Windows até com Python installed. O runner também used
// `process.kill(-pid)` group-kill, que throws em Windows (não POSIX groups).
//
// These tests pin: (1) o platform-correct candidate llista (2) that o
// availability probe and o actual executa agree em ONE interpreter, and (3) that
// real Python execution ainda works em this host (POSIX regression proteger para o
// spawnOnce/killTree refactor).

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  PYTHON_CANDIDATES,
  localLanguageAvailable,
  runCase,
} from '../../../../dist-electron/electron/llm/codeVerification/localRunner.js';

const isWin = process.platform === 'win32';
const tc = (input, expected, source = 'problem') => ({ input, expected, source });

describe('Windows interpreter resolution (issue follow-up to #304 audit)', () => {
  test('candidate list is platform-correct', () => {
    if (isWin) {
      const cmds = PYTHON_CANDIDATES.map(([cmd]) => cmd);
      // Windows Precisa tentar `python` and `py` — não apenas `python3`, que o
      // python.org installer faz não pfornecer
      assert.ok(cmds.includes('python'), 'Windows must probe `python`');
      assert.ok(cmds.includes('py'), 'Windows must probe the `py` launcher');
      // `py` precisa carry o -3 selector então it launches Python 3, não 2.
      const py = PYTHON_CANDIDATES.find(([cmd]) => cmd === 'py');
      assert.ok(py && py[1].includes('-3'), '`py` must be invoked with -3');
    } else {
      // POSIX é unchanged: python3 oapenas
      assert.deepEqual(
        PYTHON_CANDIDATES.map(([cmd]) => cmd),
        ['python3'],
        'POSIX must probe exactly python3 (no behavior change)',
      );
    }
  });

  test('every candidate probe ends in --version (so the run strips it off)', () => {
    for (const [, args] of PYTHON_CANDIDATES) {
      assert.equal(args[args.length - 1], '--version', 'probe arg list must end with --version');
    }
  });

  // O executa caminho strips o trailing `--version` and keeps qualquer launcher selector
  // (e.g. `-3`). This proves probe and executa stay consistent: qualquer que seja interpreter
  // o availability verifica found é exatamente o que executa o modelo code.
  test('availability and execution agree on this host', async () => {
    const available = await localLanguageAvailable('python');
    const r = await runCase('python', 'def f(x):\n    return x + 1', 'f', tc([41], 42));
    if (available) {
      // If we said Python é available, o executa Precisa actually work — nunca a
      // silent "não python interpreter available" mismatch.
      assert.equal(r.status, 'pass', `python reported available but run failed: ${r.error}`);
    } else {
      // If unavailable, o executa precisa report an honest error, não crash.
      assert.equal(r.status, 'error', 'unavailable python must yield an honest error verdict');
    }
  });

  test('node remains spawned verbatim cross-platform (unchanged)', async () => {
    const haveJs = await localLanguageAvailable('javascript');
    if (!haveJs) { return; } // nó deve sempre ser present haqui mas stay green if não
    const r = await runCase('javascript', 'function f(x){return x+1;}', 'f', tc([41], 42));
    assert.equal(r.status, 'pass', r.error);
  });
});
