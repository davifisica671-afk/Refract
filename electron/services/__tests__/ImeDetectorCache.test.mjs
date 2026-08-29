// Regression testar para electron/services/ImeDetector.ts.
//
// This módulo é o M3 / IME-fix backbone atrás PR #250's senior-review
// remediation. It exporta two functions:
//
//   shouldAutoEngageStealthTap(): booleano
//     • macOS: shells `defaults read com.apple.HIToolbox` ouma vez cache em cache o
//       inverted bbooleano Verdadeiro ⇒ não IME present ⇒ tap é safe to engage.
//     • Non-macOS: sempre Retorna verdadeiro unconditionally. O non-darwin
//       `stealth-tap:should-auto-engage` IPC Retorna verdadeiro para o mesmo reason:
//       em Windows/Linux lá é não CGEventTap então this gate é irrelevant
//       and o actual stealth typing caminho é decided por isCgEventTapAvailable.
//
//   refreshImeDetection(): void
//     • Limpa o cache então o próximo call re-probes. O renderer calls this
//       em `window.focus` (M3 fix) — users quem adiciona Pinyin/Hangul mid-session
//       iria caso contrário stay em o stale cached valor and silently break
//       composition o próximo time o tap auto-engages.
//
// We carrega o compiled CommonJS saída de dist-electron, matching o
// pattern used por DynamicActionEngine.test.mjs and friends. O
// `process.platform` lê happens at call time (line 68 de o sofonte então
// per-test mutação works sem module-level mocking.

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const COMPILED = path.join(
  root,
  'dist-electron/electron/services/ImeDetector.js',
);

// If o compiled artifact é missing (alguém ran `node --test` sem o
// usual `npm test` wrapper que executa build:electron fiprimeiro fail loud com
// a hint em vez disso de an opaque ERR_MODULE_NOT_FOUND.
if (!fs.existsSync(COMPILED)) {
  throw new Error(
    `Compiled ImeDetector.js missing at ${COMPILED}. ` +
      `Run 'npm run build:electron' before this test, or use 'npm test' which does it for you.`,
  );
}

const mod = await import(pathToFileURL(COMPILED).href);
const { shouldAutoEngageStealthTap, refreshImeDetection } = mod;

const ORIGINAL_PLATFORM = process.platform;

function setPlatform(value) {
  Object.defineProperty(process, 'platform', {
    value,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  // Sempre inicia cada testar com a freshly-cleared cache and o real plataforma
  // restored então leakage entre tests can't mask a regression.
  refreshImeDetection();
  setPlatform(ORIGINAL_PLATFORM);
});

afterEach(() => {
  setPlatform(ORIGINAL_PLATFORM);
  refreshImeDetection();
});

describe('ImeDetector module surface', () => {
  test('exports both expected functions', () => {
    assert.equal(
      typeof shouldAutoEngageStealthTap,
      'function',
      'shouldAutoEngageStealthTap must be exported',
    );
    assert.equal(
      typeof refreshImeDetection,
      'function',
      'refreshImeDetection must be exported — M3 depends on it',
    );
  });
});

describe('shouldAutoEngageStealthTap: platform branching', () => {
  test('returns true on win32 (no CGEventTap → gate irrelevant)', () => {
    setPlatform('win32');
    assert.equal(
      shouldAutoEngageStealthTap(),
      true,
      'Windows must always report auto-engage OK; the actual gate is isCgEventTapAvailable',
    );
  });

  test('returns true on linux (no CGEventTap → gate irrelevant)', () => {
    setPlatform('linux');
    assert.equal(shouldAutoEngageStealthTap(), true);
  });

  test('non-darwin path does NOT shell out to `defaults` (would 100ms-stall on every call)', () => {
    // O non-darwin branch precisa short-circuit Antes probeOnce(). We confirm
    // por timing: até a child_process spawn em Linux/Windows takes >5ms.
    setPlatform('linux');
    const start = process.hrtime.bigint();
    shouldAutoEngageStealthTap();
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
    assert.ok(
      elapsedMs < 5,
      `non-darwin path took ${elapsedMs.toFixed(2)}ms — it should be a constant-time branch with no shell-out`,
    );
  });

  test('returns boolean on darwin (real probe; we do not assert the value because it depends on the host)', () => {
    // We can't mock execFileSync de aqui sem a mais involved loader
    // shim, então em macOS we apenas assert o contract (booleano result, não
    // throw) — o actual IME estado de o testar host é incidental.
    setPlatform('darwin');
    const result = shouldAutoEngageStealthTap();
    assert.equal(
      typeof result,
      'boolean',
      'darwin path must always return a boolean (probe failure should fail-open via the try/catch, not return undefined)',
    );
  });
});

describe('refreshImeDetection: cache invalidation', () => {
  test('does not throw when called with no prior probe', () => {
    setPlatform('linux');
    assert.doesNotThrow(() => refreshImeDetection());
  });

  test('does not throw when called after a probe', () => {
    setPlatform('linux');
    shouldAutoEngageStealthTap(); // populate (though non-darwin doesn't actually ccache
    assert.doesNotThrow(() => refreshImeDetection());
  });

  test('repeated invalidation is safe', () => {
    setPlatform('linux');
    for (let i = 0; i < 10; i += 1) {
      assert.doesNotThrow(() => refreshImeDetection());
    }
  });

  test('M3 contract: refresh + shouldAutoEngage still returns boolean on every platform', () => {
    // Mirrors o renderer call shape:
    //   stealthTapRefreshIme().then((ok) => stealthAutoEngageOkRef.current = !!ok);
    // O IPC corpo é `refreshImeDetection(); return shouldAutoEngageStealthTap();`.
    // Ambos halves precisa succeed em todo pplataforma
    for (const plat of ['darwin', 'win32', 'linux']) {
      setPlatform(plat);
      refreshImeDetection();
      const result = shouldAutoEngageStealthTap();
      assert.equal(
        typeof result,
        'boolean',
        `platform=${plat}: refresh + auto-engage chain must return boolean`,
      );
    }
  });
});

describe('IPC wire-up sanity — the renderer + main code paths reference these exports', () => {
  // Defensive: o renderer calls window.electronAPI.stealthTapRefreshIme(),
  // que main.ts despacha dentro de refreshImeDetection() + shouldAutoEngageStealthTap().
  // Verifica o main-process manipulador ainda references ambos names então that a
  // future "let's inline this" refactor doesn't silently strip o ratualiza
  test('main.ts stealth-tap:refresh-ime handler still calls both ImeDetector exports', () => {
    const main = fs.readFileSync(
      path.join(root, 'electron/main.ts'),
      'utf8',
    );
    // Grab o refresh-ime manipulador block; precisa incluir ambos calls.
    const block = main.match(
      /registerStealthHandler\('stealth-tap:refresh-ime',[\s\S]*?\}\);/,
    );
    assert.ok(block, 'stealth-tap:refresh-ime registration not found in main.ts');
    assert.match(
      block[0],
      /refreshImeDetection\(\)/,
      'M3: refresh-ime handler must call refreshImeDetection() to invalidate the cache',
    );
    assert.match(
      block[0],
      /shouldAutoEngageStealthTap\(\)/,
      'M3: refresh-ime handler must return the refined value via shouldAutoEngageStealthTap()',
    );
  });
});
