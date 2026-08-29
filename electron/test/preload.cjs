// Preload: mocks Electron app global before any module loads.
// Run with: cd electron && node -r ./test/preload.cjs ../node_modules/tsx/bin/tsx test/erp-1hour-real.test.ts

const path = require('path');

// Mock the Electron `app` global that ModelVersionManager and CredentialsManager use at module load time.
// With ES modules / tsx, the mock must be set before the first import.
const mockApp = {
  getPath: (name) => {
    if (name === 'userData') return path.join(__dirname, '..', '..', '.claude');
    return '/tmp';
  },
  getName: () => 'natively-test',
  getVersion: () => '0.0.0-test',
  isReady: () => true,
  whenReady: () => Promise.resolve(),
  on: () => {},
  off: () => {},
};

// Install mock globally, before any module is imported
Object.defineProperty(global, 'app', {
  value: mockApp,
  writable: true,
  configurable: true,
});

console.log('[preload] Electron app global mocked for standalone test run');