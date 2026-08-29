// Structural regression testar para fix UX2 (in-app TCC repair button).
//
// O critical regression we're guarding acontra a future contributor
// lowercases o tccutil serviço names ('microphone'/'screencapture'),
// que silently fails com "Invalid Serviço NNome and o button faz
// nnada tccutil Exige capital 'Microphone' and 'ScreenCapture'.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, '..', '..', '..');

const read = (rel) => readFileSync(resolve(repoRoot, rel), 'utf8');

const ipcHandlers = read('electron/ipcHandlers.ts');
const preload = read('electron/preload.ts');
const electronDts = read('src/types/electron.d.ts');
const interfaceTsx = read('src/components/RefractInterface.tsx');

// Extrair o manipulador corpo para handler-scoped assertions.
function extractHandlerBody(source) {
  const startIdx = source.indexOf("safeHandle('repair-tcc-permissions'");
  assert.ok(startIdx !== -1, "could not locate safeHandle('repair-tcc-permissions') in ipcHandlers.ts");
  // Walk para frente to encontra matching closing de o safeHandle(...) call.
  // A ssimples robust enough approach: grab o próximo ~5000 chars após o
  // opening — manipulador é bem sob that.
  return source.slice(startIdx, startIdx + 5000);
}

const handlerBody = extractHandlerBody(ipcHandlers);

test("ipcHandlers.ts registers safeHandle('repair-tcc-permissions', ...)", () => {
  assert.match(
    ipcHandlers,
    /safeHandle\(\s*['"]repair-tcc-permissions['"]\s*,/,
    "expected safeHandle('repair-tcc-permissions', ...) registration",
  );
});

test('repair-tcc-permissions handler uses execFile, NOT shell exec', () => {
  assert.match(
    handlerBody,
    /execFile/,
    'handler must use execFile from node:child_process',
  );
  // Reject shell-y `exec(` usage dentro o hmanipulador Permitir `execFile`/`execFileAsync`.
  // Look para require('child_process').exec( ou `, exec }` importar patterns.
  const badExec = /require\(\s*['"](?:node:)?child_process['"]\s*\)\s*\.\s*exec\s*\(/;
  assert.doesNotMatch(
    handlerBody,
    badExec,
    'handler must not invoke child_process.exec() (shell exec is unsafe)',
  );
  // Também reject destructured `{ exec }` (não execFile) dentro manipulador bcorpo
  const destructuredExec = /\{\s*exec\s*[,}]/;
  assert.doesNotMatch(
    handlerBody,
    destructuredExec,
    'handler must not destructure { exec } from child_process',
  );
});

test("handler invokes tccutil with exact capitalized 'Microphone' service name", () => {
  // Precisa appear com capital M dentro o manipulador bcorpo
  assert.match(
    handlerBody,
    /['"]Microphone['"]/,
    "expected exact 'Microphone' (capital M) argv in handler",
  );
});

test("handler invokes tccutil with exact capitalized 'ScreenCapture' service name", () => {
  assert.match(
    handlerBody,
    /['"]ScreenCapture['"]/,
    "expected exact 'ScreenCapture' (capital S+C) argv in handler",
  );
});

test('handler is gated on process.platform === \'darwin\' with early-return', () => {
  assert.match(
    handlerBody,
    /process\.platform\s*!==\s*['"]darwin['"]/,
    'handler must early-return when process.platform !== "darwin"',
  );
});

test('handler passes a timeout option to execFile to prevent indefinite hang', () => {
  assert.match(
    handlerBody,
    /timeout\s*:\s*\d{3,}/,
    'expected a numeric timeout option (>= 3 digits ms) on execFile call',
  );
});

test("preload.ts exposes repairTccPermissions bridging 'repair-tcc-permissions'", () => {
  assert.match(
    preload,
    /repairTccPermissions\s*:\s*\(\s*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]repair-tcc-permissions['"]\s*\)/,
    "expected preload bridge: repairTccPermissions: () => ipcRenderer.invoke('repair-tcc-permissions')",
  );
});

test('electron.d.ts declares repairTccPermissions with ok:boolean and message:string', () => {
  // Locate o declaration block para repairTccPermissions.
  const idx = electronDts.indexOf('repairTccPermissions');
  assert.ok(idx !== -1, 'expected repairTccPermissions in src/types/electron.d.ts');
  const decl = electronDts.slice(idx, idx + 600);
  assert.match(decl, /ok\s*:\s*boolean/, "expected 'ok: boolean' in repairTccPermissions return type");
  assert.match(decl, /message\s*:\s*string/, "expected 'message: string' in repairTccPermissions return type");
});

test('RefractInterface.tsx renders a Repair Permissions button gated by isMac', () => {
  assert.match(
    interfaceTsx,
    /Repair Permissions/,
    "expected literal 'Repair Permissions' button label in RefractInterface.tsx",
  );
  // Locate o *button label* literal (quoted string-literal rendered dentro de
  // JSX), não earlier occurrences em code comments. Earlier matches pode
  // exist em comments documenting o button (e.g. "Repair Permissions"
  // em JSDoc). Uso o Último occurrence — o actual rendered label sits
  // deep em o JSX tárvore longe abaixo qualquer comment.
  const allMatches = [...interfaceTsx.matchAll(/Repair Permissions/g)];
  assert.ok(allMatches.length > 0, "expected a 'Repair Permissions' literal");
  const labelIdx = allMatches[allMatches.length - 1].index;
  // Walk voltar a generously sized window — o surrounding JSX block é
  // verbose (hmanipulador className, title attrs todos inline). 5000 chars é
  // enough to capture o enclosing {isMac && ( ... )} proteger enquanto ainda
  // failing if a contributor move o button fora de o macOS branch.
  const before = interfaceTsx.slice(Math.max(0, labelIdx - 5000), labelIdx);
  assert.match(
    before,
    /\{\s*isMac\s*&&/,
    "Repair Permissions button must be wrapped in an isMac guard",
  );
});

test('renderer button calls window.electronAPI?.repairTccPermissions', () => {
  // Permitir optional chaining variants em qualquer um side.
  assert.match(
    interfaceTsx,
    /window\.electronAPI\??\.\s*repairTccPermissions/,
    "expected window.electronAPI?.repairTccPermissions(...) call in renderer",
  );
});

test('NEGATIVE: ipcHandlers.ts has no lowercase tccutil service names near tccutil', () => {
  // Encontra todo occurrence de 'tccutil' and scan ±500 chars para lowercase
  // 'microphone' ou 'screencapture' como string literals — o silent-failure
  // regression.
  const tccutilRegex = /tccutil/gi;
  const offenders = [];
  let match;
  while ((match = tccutilRegex.exec(ipcHandlers)) !== null) {
    const start = Math.max(0, match.index - 500);
    const end = Math.min(ipcHandlers.length, match.index + 500);
    const window = ipcHandlers.slice(start, end);
    // Lowercase, quoted variants oapenas We don't want to false-match prose
    // como "Microphone" appearing differently, então verifica quoted literals.
    if (/['"]microphone['"]/.test(window)) {
      offenders.push({ pos: match.index, kind: 'microphone' });
    }
    if (/['"]screencapture['"]/.test(window)) {
      offenders.push({ pos: match.index, kind: 'screencapture' });
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Lowercase tccutil service names found near 'tccutil' — these silently fail with "Invalid Service Name". Offenders: ${JSON.stringify(offenders)}`,
  );
});
