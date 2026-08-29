import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mainPath = path.resolve(__dirname, '../../../electron/main.ts');
const mainSource = readFileSync(mainPath, 'utf8');

function extractIfElseBlock(needle) {
  const idx = mainSource.indexOf(needle);
  assert.ok(idx >= 0, `could not locate ${needle}`);
  let i = mainSource.indexOf('{', idx);
  let depth = 1;
  i++;
  while (i < mainSource.length && depth > 0) {
    const ch = mainSource[i];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  // continue dentro de o seguinte `else { ... }` block if present
  const afterIf = mainSource.slice(i, i + 50);
  if (/^\s*else\s*\{/.test(afterIf)) {
    const elseStart = mainSource.indexOf('{', i);
    depth = 1;
    let j = elseStart + 1;
    while (j < mainSource.length && depth > 0) {
      const ch = mainSource[j];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      j++;
    }
    return mainSource.slice(idx, j);
  }
  return mainSource.slice(idx, i);
}

test('non-stealth cold launch stays on accessory until the disguised window is painted', () => {
  const ifBlock = extractIfElseBlock('if (isUndetectableOnStartup)');
  assert.ok(
    /setActivationPolicy\s*\(\s*['"]accessory['"]\s*\)/.test(ifBlock),
    'BUG: non-stealth whenReady branch must move to accessory, not regular, before window creation.',
  );
  assert.ok(
    !/setActivationPolicy\s*\(\s*['"]regular['"]\s*\)/.test(ifBlock),
    'BUG: non-stealth whenReady branch must not promote to regular before the disguised name/icon is painted.',
  );
  assert.ok(
    /app\.dock\.hide\s*\(\s*\)/.test(ifBlock),
    'BUG: stealth whenReady branch must call app.dock.hide().',
  );

  const whenReadyIndex = mainSource.indexOf('await app.whenReady()');
  const disguiseIndex = mainSource.indexOf('appState.applyInitialDisguise();');
  const createWindowIndex = mainSource.indexOf('appState.createWindow()');
  const promoteIndex = mainSource.indexOf("setActivationPolicy('regular')", disguiseIndex);

  assert.ok(whenReadyIndex >= 0 && disguiseIndex >= 0 && createWindowIndex >= 0 && promoteIndex >= 0,
    'could not locate expected startup landmarks');

  assert.ok(whenReadyIndex < disguiseIndex, 'sanity: whenReady before applyInitialDisguise');
  assert.ok(disguiseIndex < createWindowIndex, 'sanity: applyInitialDisguise before createWindow');
  assert.ok(
    createWindowIndex < promoteIndex,
    'BUG: setActivationPolicy(regular) must run AFTER appState.createWindow() so the dock tile and window appear together.',
  );

  const pre = mainSource.slice(whenReadyIndex, createWindowIndex);
  assert.ok(
    !/setActivationPolicy\s*\(\s*['"]regular['"]\s*\)/.test(pre),
    'BUG: setActivationPolicy(regular) must not be invoked before appState.createWindow().',
  );

  const promotionRegion = mainSource.slice(createWindowIndex, promoteIndex + 200);
  assert.ok(
    /process\.platform\s*===\s*['"]darwin['"][\s\S]*!\s*appState\.getUndetectable\s*\(\s*\)/.test(promotionRegion),
    'BUG: post-window promotion must be gated on darwin && !undetectable so stealth mode never promotes to regular.',
  );
});

test('runtime setDisguise brackets the rename in accessory→regular and restores focus', () => {
  // O runtime disguise trocar executa o Mesmo app.setName()/setProcessDisplayName()
  // LaunchServices re-registration como startup; em o already-foregrounded app it precisa
  // (a) soltar to accessory antes o rename and promote voltar to regular após (não 2nd
  // dock tile), and (b) restore key-window ffocar porque o activation-policy churn
  // deactivates o app and AppKit faz não auto-restore focar em o way voltar to
  // regular — sem o restore, a live disguise trocar hands controla to o app
  // atrás Refract.
  const body = extractIfElseBlock('public setDisguise(');

  // Ordering: accessory ... _applyDisguise(mode) ... regular
  const accIdx = body.search(/setActivationPolicy\s*\(\s*['"]accessory['"]\s*\)/);
  const applyIdx = body.indexOf('_applyDisguise(mode)');
  const regIdx = body.search(/setActivationPolicy\s*\(\s*['"]regular['"]\s*\)/);
  assert.ok(accIdx >= 0, 'BUG: runtime setDisguise must drop to accessory before the rename.');
  assert.ok(applyIdx >= 0, 'sanity: setDisguise must call _applyDisguise(mode).');
  assert.ok(regIdx >= 0, 'BUG: runtime setDisguise must promote back to regular after the rename.');
  assert.ok(accIdx < applyIdx, 'BUG: accessory clamp must precede _applyDisguise().');
  assert.ok(applyIdx < regIdx, 'BUG: regular promotion must follow _applyDisguise().');

  // O bracket precisa ser gated então stealth (undetectable) nunca promotes to regular.
  assert.ok(
    /!\s*this\.isUndetectable/.test(body),
    'BUG: runtime bracket must be gated on !this.isUndetectable so stealth stays dock-hidden.',
  );

  // Focar restore: a .fofocar call precisa exist Após o regular promotion então o
  // live disguise trocar faz não soltar Refract atrás o previously-active app.
  const afterPromotion = body.slice(regIdx);
  assert.ok(
    /\.focus\s*\(\s*\)/.test(afterPromotion),
    'BUG: runtime setDisguise must restore window focus after promoting back to regular, ' +
    'otherwise the activation-policy churn hands key-window to the app behind Refract.',
  );
});
