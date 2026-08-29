// electron/utils/nativeModuleGuard.ts
// Guarda de módulos nativos para Electron
// Detecta incompatibilidade de ABI entre módulos nativos compilados para o Node do sistema
// e os requisitados pelo Electron. Em modo dev, reconstrói automaticamente via electron-rebuild.
// Em build empacotado, encerra o app com mensagem de erro.

import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';

// Módulos nativos compilados contra a ABI do Node do sistema em vez da do Electron causam
// crashes na inicialização por incompatibilidade de NODE_MODULE_VERSION e exigem
// `npm rebuild` (pula postinstall), `npm install --ignore-scripts`, ou atualização do Node do
// sistema após uma build anterior bem-sucedida. Em dev, recupera automaticamente.
const GUARDED_MODULES = ['better-sqlite3', 'keytar'];

interface AbiMismatch {
  module: string;
  expected: string;
  actual: string;
}

function probeAbi(moduleName: string): AbiMismatch | null {
  try {
    require(moduleName);
    return null;
  } catch (err: any) {
    const msg = String(err?.message ?? '');
    if (err?.code !== 'ERR_DLOPEN_FAILED' || !/NODE_MODULE_VERSION/.test(msg)) {
      throw err;
    }
    const expected = msg.match(/This version of Node\.js requires\s+NODE_MODULE_VERSION\s+(\d+)/)?.[1];
    const actual = msg.match(/compiled against a different Node\.js version using\s+NODE_MODULE_VERSION\s+(\d+)/)?.[1];
    return {
      module: moduleName,
      expected: expected ?? String(process.versions.modules),
      actual: actual ?? 'unknown',
    };
  }
}

function findRepoRoot(): string {
  let current = __dirname;
  while (current !== path.dirname(current)) {
    const pkgPath = path.join(current, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        if (pkg?.name === 'refract') return current;
      } catch {
        // fall através
      }
    }
    current = path.dirname(current);
  }
  return process.cwd();
}

function findElectronRebuildBin(repoRoot: string): string | null {
  const candidates = [
    path.join(repoRoot, 'node_modules', '.bin', 'electron-rebuild'),
    path.join(repoRoot, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function ensureNativeModuleAbi(): void {
  const mismatches: AbiMismatch[] = [];
  for (const name of GUARDED_MODULES) {
    const result = probeAbi(name);
    if (result) mismatches.push(result);
  }
  if (mismatches.length === 0) return;

  const summary = mismatches
    .map((m) => `  - ${m.module}: built for ABI v${m.actual}, Electron expects v${m.expected}`)
    .join('\n');
  console.error('\n[NativeModuleGuard] Native module ABI mismatch:');
  console.error(summary);

  if (app.isPackaged) {
    console.error(
      '[NativeModuleGuard] Packaged build — cannot rebuild at runtime. ' +
        'The release pipeline shipped the wrong .node binaries.'
    );
    app.exit(1);
    return;
  }

  console.warn('[NativeModuleGuard] Dev mode — rebuilding native modules against Electron…');

  const repoRoot = findRepoRoot();
  const rebuildBin = findElectronRebuildBin(repoRoot);
  if (!rebuildBin) {
    console.error(
      '[NativeModuleGuard] electron-rebuild not found in node_modules. ' +
        'Run: npm install, then: npx electron-rebuild -f -w better-sqlite3,keytar'
    );
    app.exit(1);
    return;
  }

  // electron-rebuild precisa usar o Node do sistema (não o binário do Electron em que estamos
  // executando) para spawnar o node-gyp corretamente. Remover ELECTRON_RUN_AS_NODE para que o
  // shebang no script .bin escolha o Node do sistema do PATH
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  const result = spawnSync(rebuildBin, ['-f', '-w', GUARDED_MODULES.join(',')], {
    cwd: repoRoot,
    stdio: 'inherit',
    env,
  });

  if (result.status !== 0) {
    console.error(
      `[NativeModuleGuard] electron-rebuild exited with code ${result.status}. ` +
        'Manual recovery: npx electron-rebuild -f -w better-sqlite3,keytar'
    );
    app.exit(1);
    return;
  }

  console.warn('[NativeModuleGuard] Rebuild complete — relaunching Electron.');
  app.relaunch();
  app.exit(0);
}
