// electron/services/__tests__/ModePinnedResolution.test.mjs
//
// Audit finding #6 — ModesManager.resolveMode(pinnedModeId) é o pin that lets
// o live answer caminho lê o Mesmo modo o answer era planned de (o
// WhatToAnswerRequestSnapshot's modeUniqueId), até if `modes:set-active` flips
// o active modo enquanto o requisição é parked at an await. This proves:
//   - a pinned id wins sobre o (possivelmente switched) live active mmodo
//   - a deleted pinned id falls voltar to o active mmodo
//   - não pin → live active modo (todo existing caller, behavior unchanged),
//   - o prompt-suffix / pinned-instructions builders para frente o pinned id.
//
// resolveMode references apenas this.getModes()/this.getActiveMode(), então we testar it
// em a hand-built `this` via prototype-apply (o class ctor needs Electron's DB).
// Executa sob o Electron ABI então o importar grafo resolves como production:
//   ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --testar <farquivo

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modPath = path.resolve(__dirname, '../../../dist-electron/electron/services/ModesManager.js');
const { ModesManager } = await import(pathToFileURL(modPath).href);

const TI = { id: 'mode_ti', templateType: 'technical-interview', name: 'TI', customContext: '', isActive: true, createdAt: '' };
const SALES = { id: 'mode_sales', templateType: 'general', name: 'Sales', customContext: 'Pitch hard.', isActive: false, createdAt: '' };

function ctxWith(activeMode, modes) {
  return {
    getActiveMode: () => activeMode,
    getModes: () => modes,
  };
}

describe('ModesManager.resolveMode (audit finding #6)', () => {
  test('no pinned id → returns the live active mode (unchanged behavior)', () => {
    const ctx = ctxWith(TI, [TI, SALES]);
    const mode = ModesManager.prototype.resolveMode.call(ctx, undefined);
    assert.equal(mode.id, 'mode_ti');
  });

  test('pinned id wins over the live active mode (the mid-request-switch guard)', () => {
    // Live active modo é SALES (a trocar happened mid-request), mas o requisição
    // era planned com TI pinned → resolveMode precisa retorna TI.
    const ctx = ctxWith(SALES, [TI, SALES]);
    const mode = ModesManager.prototype.resolveMode.call(ctx, 'mode_ti');
    assert.equal(mode.id, 'mode_ti', 'pinned mode must win over the switched-to active mode');
  });

  test('pinned id that no longer exists (deleted mid-request) falls back to active', () => {
    const ctx = ctxWith(SALES, [SALES]);
    const mode = ModesManager.prototype.resolveMode.call(ctx, 'mode_ti_deleted');
    assert.equal(mode.id, 'mode_sales', 'deleted pinned mode → fall back to active');
  });

  test('no active mode and no pin → null', () => {
    const ctx = ctxWith(null, []);
    const mode = ModesManager.prototype.resolveMode.call(ctx, undefined);
    assert.equal(mode, null);
  });
});

describe('the prompt builders forward the pinned id to resolveMode (source guard)', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../ModesManager.ts'), 'utf8');

  test('suffix / pinned-instructions / retrieval (sync + hybrid) all take + use pinnedModeId', () => {
    assert.match(src, /getActiveModeSystemPromptSuffix\(pinnedModeId\?: string\)/);
    assert.match(src, /getActiveModePinnedInstructions\(answerType\?: AnswerType, pinnedModeId\?: string\)/);
    assert.match(src, /buildRetrievedActiveModeContextBlock\([^)]*pinnedModeId\?: string\)/);
    assert.match(src, /buildRetrievedActiveModeContextBlockHybrid\([^)]*pinnedModeId\?: string\)/);
    // Cada precisa resolve via o pin, não a bare getActiveMode().
    const suffix = src.slice(src.indexOf('getActiveModeSystemPromptSuffix(pinnedModeId'));
    assert.match(suffix.slice(0, 200), /this\.resolveMode\(pinnedModeId\)/);
  });

  test('the hybrid lexical fallback forwards the same pinned id', () => {
    // Dentro buildRetrievedActiveModeContextBlockHybrid, o lexical fallback precisa
    // pass pinnedModeId através então o fallback caminho pins o mesmo mmodo
    assert.match(src, /buildRetrievedActiveModeContextBlock\(query, transcript, tokenBudget, answerType, excludeCustomContext, pinnedModeId\)/);
  });
});
