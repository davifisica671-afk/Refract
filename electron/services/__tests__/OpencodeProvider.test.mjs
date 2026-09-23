import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mgrPath = path.resolve(__dirname, '../../../dist-electron/electron/services/OpencodeManager.js');
const mgrMod = await import(pathToFileURL(mgrPath).href);
const { OpencodeManager, OPENCODE_PORT } = mgrMod;

function writeFakeServe(dir) {
  const p = path.join(dir, process.platform === 'win32' ? 'fakeserve.cmd' : 'fakeserve.sh');
  const body = process.platform === 'win32'
    ? '@echo off\r\nnode "%~dp0fakeserve.js" %*\r\n'
    : '#!/bin/sh\nexec node "$(dirname "$0")/fakeserver.js" "$@"\n';
  fs.writeFileSync(p, body);
  const js = `const http = require('http');
const port = Number(process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 4097);
http.createServer((req, res) => {
  if (req.url === '/global/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ healthy: true, version: 'stub' })); return; }
  res.writeHead(404); res.end();
}).listen(port, '127.0.0.1');`;
  fs.writeFileSync(path.join(dir, 'fakeserve.js'), js);
  return p;
}

describe('opencodeManager', () => {
  test('fixed port constant', () => {
    assert.equal(OPENCODE_PORT, 4097);
  });

  test('starts fake sidecar and reports healthy managed', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocmgr-'));
    const bin = writeFakeServe(dir);
    const mgr = OpencodeManager.getInstance();
    try {
      const res = await mgr.ensureRunning({ bin });
      assert.equal(res.ok, true);
      assert.equal(res.managed, true);
      assert.match(res.baseUrl, /127\.0\.0\.1:4097/);
      assert.match(mgr.getAuthHeader() ?? '', /^Basic /);
    } finally {
      mgr.stop();
    }
  });

  test('missing binary is unavailable without throwing', async () => {
    const mgr = OpencodeManager.getInstance();
    const res = await mgr.ensureRunning({ bin: path.join(os.tmpdir(), 'definitely-not-here-opencode') });
    assert.equal(res.ok, false);
  });
});
