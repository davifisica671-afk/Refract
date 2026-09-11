import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

// BUG CONCRETO (TCC/macOS): o handler 'repair-tcc-permissions' hardcodava
// 'com.electron.meeting-notes' (appId STALE de template) enquanto o app real
// usa com.joaolucas.refract (package.json build.appId). Resultado: tccutil
// reset reparava permissões de uma identidade que não era a do app.
test('ipcHandlers não contém mais bundle IDs hardcoded no TCC repair', () => {
  const source = read('electron/ipcHandlers.ts');

  assert.doesNotMatch(source, /com\.electron\.meeting-notes/);
  // O bundle id de dev só pode existir dentro de appIdentity.ts.
  const ipcBody = source;
  assert.doesNotMatch(ipcBody, /'com\.github\.Electron'/);
  assert.match(ipcBody, /resolveTccBundleId\(app\.isPackaged\)/);
});

test('appIdentity APP_BUNDLE_ID == package.json build.appId (fonte única)', () => {
  const pkg = JSON.parse(read('package.json'));
  const identitySource = read('electron/appIdentity.ts');

  assert.ok(pkg.build?.appId, 'package.json build.appId deve existir');
  assert.match(
    identitySource,
    new RegExp(`APP_BUNDLE_ID = ['"]${pkg.build.appId.replace(/\./g, '\\.')}['"]`),
    'appIdentity.ts APP_BUNDLE_ID deve ser idêntico ao build.appId do package.json',
  );
});

test('resolveTccBundleId: packaged → appId do app; dev → bundle id do Electron de dev', async () => {
  const mod = await import(
    'file:///' + path.join(root, 'dist-electron', 'electron', 'appIdentity.js').replace(/\\/g, '/')
  );

  assert.equal(mod.APP_BUNDLE_ID, 'com.joaolucas.refract');

  const packaged = mod.resolveTccBundleId(true);
  assert.equal(packaged.bundleId, mod.APP_BUNDLE_ID);
  assert.equal(packaged.usingDevFallback, false);

  const dev = mod.resolveTccBundleId(false);
  assert.equal(dev.bundleId, mod.DEV_BUNDLE_ID);
  assert.equal(dev.usingDevFallback, true);
});
