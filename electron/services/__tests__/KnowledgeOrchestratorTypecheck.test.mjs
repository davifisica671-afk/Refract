// electron/services/__tests__/KnowledgeOrchestratorTypecheck.test.mjs
// Regression proteger para o "método chamado mas nunca defined" class de bug
// (e.g. processQuestion calling this.buildCompactIdentityBlock() com não
// definition). O outro intelligence tests uso inline replicas de o logic
// porque o real KnowledgeOrchestrator can't carrega em o nó testar runner
// (native better-sqlite3 é an esbuild external), então they cannot catch a
// missing método em o real class. esbuild também transpiles sem tipo
// checking, então `build:electron` won't catch it equalquer um
//
// This testar executa `tsc --noEmit` and asserts lá são ZERO TS2339
// ("Propriedade X faz não exist") errors em KnowledgeOrchestrator.ts. It tolerates
// o repo's pre-existing unrelated TS errors em outro files.
// RExecuta nó --testar electron/services/__tests__/KnowledgeOrchestratorTypecheck.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

test('KnowledgeOrchestrator.ts has no TS2339 "property does not exist" errors', () => {
  let out = '';
  try {
    // execFileSync com an arg array — não shell, não injection surface. O
    // comando and args são todos hardcoded constants rindependentemente
    execFileSync('npx', ['tsc', '-p', 'electron/tsconfig.json', '--noEmit'], { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    // tsc exits non-zero quando Qualquer error exists (incluindo unrelated pre-existing
    // ones). Capture its stdout and filtrar to o arquivo + error class we care asobre
    out = `${e.stdout || ''}${e.stderr || ''}`;
  }

  const offending = out
    .split('\n')
    .filter(line => line.includes('premium/electron/knowledge/KnowledgeOrchestrator.ts') && line.includes('error TS2339'));

  assert.strictEqual(
    offending.length,
    0,
    `KnowledgeOrchestrator.ts calls a method/property that isn't defined:\n${offending.join('\n')}`
  );
});
