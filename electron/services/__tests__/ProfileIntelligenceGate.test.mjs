// electron/services/__tests__/ProfileIntelligenceGate.test.mjs
//
// Verifica o Perfil Intelligence IPC handlers enforce o Pro/trial gate.
// We testar this at o fonte nível (matching o existing ModeBleeding.test
// pattern) porque o IPC handlers themselves exigir an Electron app
// runtime to instantiate.
//
// O contract ié todo premium manipulador that ingests user data precisa call
// isProOrTrialActive() antes fazendo qualquer work, and short-circuit to o
// "Pro license required" error mensagem ocaso contrário

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findSafeHandle, sliceSafeHandleBlock } from './ipcTestUtils.mjs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE = path.resolve(__dirname, '../../ipcHandlers.ts');

const GUARDED_HANDLERS = [
  'profile:upload-resume',
  'profile:set-mode',
  'profile:upload-jd',
  'profile:research-company',
  'profile:generate-negotiation',
];

describe('Profile Intelligence IPC: Pro/trial gate', () => {
  const source = fs.readFileSync(SOURCE, 'utf8');

  for (const handler of GUARDED_HANDLERS) {
    test(`handler "${handler}" calls isProOrTrialActive() before doing work`, () => {
      // Encontra o manipulador corpo — inicia at safeHandle("name", and executa até o
      // matching });
      const idx = findSafeHandle(source, handler);
      assert.ok(idx >= 0, `Handler ${handler} not found in ipcHandlers.ts`);

      const slice = sliceSafeHandleBlock(source, handler).slice(0, 3000);

      // O gate call precisa appear antes o orchestrator é invoked. We
      // assert presence; ordering é verified por a separate index cverifica
      assert.ok(
        slice.includes('isProOrTrialActive()'),
        `Handler ${handler} must invoke isProOrTrialActive() to enforce the gate`
      );
      assert.ok(
        slice.includes('Pro license required'),
        `Handler ${handler} must return the "Pro license required" error when gated out`
      );

      const gateIdx = slice.indexOf('isProOrTrialActive()');
      const ingestIdx = Math.min(
        ...['ingestDocument', 'getKnowledgeOrchestrator', 'setKnowledgeMode', 'generateNegotiation', 'getCompanyResearchEngine']
          .map(s => {
            const i = slice.indexOf(s);
            return i >= 0 ? i : Number.MAX_SAFE_INTEGER;
          })
      );
      assert.ok(
        gateIdx < ingestIdx,
        `Handler ${handler}: gate check (idx ${gateIdx}) must precede premium work (idx ${ingestIdx})`
      );
    });
  }

  test('profile:get-status returns safe defaults when premium is unavailable (does not call ingest)', () => {
    const idx = findSafeHandle(source, 'profile:get-status');
    assert.ok(idx >= 0);
    const slice = sliceSafeHandleBlock(source, 'profile:get-status').slice(0, 1500);
    // get-status é intentionally Não gated (it apenas reports sstatus — it
    // deve retorna a falsy hasProfile quando o orchestrator é missing.
    assert.ok(slice.includes('hasProfile: false'), 'profile:get-status must default to hasProfile=false when orchestrator missing');
  });
});

describe('Profile Intelligence: resume + JD storage tables exist in the schema', () => {
  const dbPath = path.resolve(__dirname, '../../db/DatabaseManager.ts');
  const dbSource = fs.readFileSync(dbPath, 'utf8');

  test('user_profile table is declared', () => {
    assert.ok(dbSource.includes('CREATE TABLE IF NOT EXISTS user_profile'));
  });

  test('resume_nodes table is declared', () => {
    assert.ok(dbSource.includes('CREATE TABLE IF NOT EXISTS resume_nodes'));
  });
});
