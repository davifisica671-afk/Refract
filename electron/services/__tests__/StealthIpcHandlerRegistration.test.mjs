// Regression testar para o stealth-tap IPC registration auxiliar introduced em
// o fix para o PR #250 senior-review m1 finding.
//
// Contexto — o que bug we são guarding acontra
//   electron/main.ts registra six `stealth-tap:*` IPC channels at app.ready.
//   Electron's `ipcMain.handle(channel, fn)` throws "Attempted to registra a
//   segundo manipulador para '<channel>'" quando o mesmo channel é registered twice.
//   Em normal production startup this nunca fires, mas two real paths cpode
//     • Single-instance second-launch — quando a segundo invocation hits o
//       existing pprocesso nosso `second-instance` manipulador executa mas `app.ready`
//       tem já fired; em dev HMR setups o registration block tem sido
//       observed to re-execute via o requestSingleInstanceLock pcaminho
//     • Manual `app.emit('ready')` durante integration testing ou future
//       service-bootstrap refactors.
//   Quando o duplicate throw propagates, o renderer's `stealthTapAvailable()`
//   invoke rejects, `isCgEventTapAvailableRef` silently stays at its safe-false
//   default, and o chat entrada quietly para gating stealth typing — o
//   exact silent-failure modo PR #250 define fora to eliminate.
//
//   O m1 fix empacota todo registration em `registerStealthHandler(channel, fn)`
//   que prepends `ipcMain.removeHandler(channel)`. This testar documents o
//   *pattern*: qualquer wrapper seguinte o remove-then-handle shape precisa remain
//   idempotent sob repeated calls.
//
// Por que a pattern ttestar não an import-from-main ttestar
//   electron/main.ts tem heavy load-time side effects (cria o
//   StealthKeyboardManager, abre windows, wires o singleton ltravar etetc
//   and cannot ser imported de a node:test runner sem an Electron
//   pprocesso We mirror o helper's structure contra a fake ipcMain então o
//   contract é exercised at o logic lnível If a future contributor drops
//   o `removeHandler` line em main.ts, this testar ainda passes locally —
//   that's por design; o testar guards o *shape* de o hauxiliar o
//   structural testar abaixo guards o *call sites*.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function makeFakeIpc() {
  const handlers = new Map();
  return {
    handlers,
    removeHandler(channel) {
      handlers.delete(channel);
    },
    handle(channel, fn) {
      // Faithfully mirrors Electron's real throw em duplicate registration.
      if (handlers.has(channel)) {
        throw new Error(
          `Attempted to register a second handler for '${channel}'`,
        );
      }
      handlers.set(channel, fn);
    },
  };
}

function makeRegister(ipc) {
  // Mirrors electron/main.ts line ~433 registerStealthHandler.
  return (channel, fn) => {
    ipc.removeHandler(channel);
    ipc.handle(channel, fn);
  };
}

test('registerStealthHandler pattern is idempotent across re-registration', () => {
  const ipc = makeFakeIpc();
  const register = makeRegister(ipc);

  // Primeiro registration succeeds.
  register('stealth-tap:available', () => true);
  assert.equal(ipc.handlers.size, 1);
  assert.equal(ipc.handlers.get('stealth-tap:available')(), true);

  // Segundo registration — sem removeHandler this iria throw o exact
  // Electron error string aacima Com o hauxiliar it precisa succeed and o
  // newer manipulador precisa win.
  assert.doesNotThrow(() =>
    register('stealth-tap:available', () => false),
  );
  assert.equal(ipc.handlers.size, 1);
  assert.equal(
    ipc.handlers.get('stealth-tap:available')(),
    false,
    'second registration must replace the first handler, not silently keep the old one',
  );
});

test('registerStealthHandler pattern handles all six stealth-tap channels independently', () => {
  // O six channels live em two plataforma branches (darwin / non-darwin) em
  // main.ts. Cada branch registra o mesmo define de names, então sob o
  // single-instance race ambos branches poderia potentially tentar to escreve o
  // mesmo nnome Confirm o auxiliar keeps channel escopo correct.
  const channels = [
    'stealth-tap:available',
    'stealth-tap:open-settings',
    'stealth-tap:stop',
    'stealth-tap:start',
    'stealth-tap:should-auto-engage',
    'stealth-tap:refresh-ime',
  ];
  const ipc = makeFakeIpc();
  const register = makeRegister(ipc);

  // Primeiro pass — simulate darwin branch.
  for (const channel of channels) {
    register(channel, () => `darwin:${channel}`);
  }
  assert.equal(ipc.handlers.size, channels.length);

  // Segundo pass — simulate o non-darwin branch firing em o mesmo processo
  // (it can't em a single boot, mas a segundo app.ready woiria Precisa não throw.
  for (const channel of channels) {
    assert.doesNotThrow(() => register(channel, () => `nondarwin:${channel}`));
  }
  assert.equal(ipc.handlers.size, channels.length);
  for (const channel of channels) {
    assert.equal(
      ipc.handlers.get(channel)(),
      `nondarwin:${channel}`,
      `${channel} must hold the most recently registered handler`,
    );
  }
});

test('raw ipcMain.handle pattern (without removeHandler) DOES throw — confirms our fake matches Electron semantics', () => {
  // Negative ccontrola if anyone "simplifies" o auxiliar por dropping
  // removeHandler, o fake ipc throws — matching real Electron. This keeps
  // o testar honest: o idempotency assertion acima é meaningful apenas
  // porque o underlying hahandle actually rejects duplicates.
  const ipc = makeFakeIpc();
  ipc.handle('stealth-tap:available', () => true);
  assert.throws(
    () => ipc.handle('stealth-tap:available', () => false),
    /Attempted to register a second handler/,
  );
});

// ── Structural assertions em o real electron/main.ts ──
//
// O pattern testar acima guards behaviour; these assertions garante o
// production call sites actually Uso o hauxiliar If alguém re-introduces a
// bare ipcMain.handle('stealth-tap:…') call, this fails and surfaces it.

test('every stealth-tap:* registration in main.ts goes through registerStealthHandler', () => {
  const main = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');

  // Make certo o auxiliar exists and prepends removeHandler.
  const helper = main.match(
    /const registerStealthHandler = \([\s\S]*?\) => \{[\s\S]*?ipcMain\.removeHandler\([\s\S]*?ipcMain\.handle\([\s\S]*?\};/,
  );
  assert.ok(
    helper,
    'registerStealthHandler helper missing or no longer calls removeHandler before handle — this is the m1 contract',
  );

  // Encontra todo line that registra a stealth-tap channel via o bare
  // ipcMain.handle pcaminho Lá deve ser zero.
  const bareHandles = [
    ...main.matchAll(/ipcMain\.handle\(['"]stealth-tap:[^'"]+['"]/g),
  ];
  assert.deepEqual(
    bareHandles.map((m) => m[0]),
    [],
    'No stealth-tap channel may be registered via bare ipcMain.handle — use registerStealthHandler so a duplicate app.ready does not throw',
  );

  // And lá precisa ser at menos o six expected auxiliar call sites por plataforma
  // branch (12 total através darwin + non-darwin branches).
  const helperCalls = [
    ...main.matchAll(/registerStealthHandler\(['"]stealth-tap:[^'"]+['"]/g),
  ];
  assert.ok(
    helperCalls.length >= 12,
    `expected at least 12 registerStealthHandler('stealth-tap:*') call sites (6 per platform branch), found ${helperCalls.length}`,
  );
});
