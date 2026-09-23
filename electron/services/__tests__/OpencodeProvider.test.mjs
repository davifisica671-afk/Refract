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

describe('opencodeService', () => {
  test('chat uses ephemeral session and Basic auth', async () => {
    const http = await import('node:http');
    const seen = { auth: '', deleted: '' };
    const server = http.createServer((req, res) => {
      seen.auth = String(req.headers.authorization ?? '');
      const json = (obj) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.url === '/global/health') return json({ healthy: true, version: 'stub' });
      if (req.url === '/session' && req.method === 'POST') return json({ id: 'ses_test' });
      if (req.url === '/session/ses_test/message' && req.method === 'POST') {
        return json({ info: {}, parts: [{ type: 'text', text: 'hello from stub' }] });
      }
      if (req.url === '/session/ses_test' && req.method === 'DELETE') { seen.deleted = 'yes'; return json(true); }
      res.writeHead(404); res.end();
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const mod = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/services/OpencodeService.js')).href);
    const svc = new mod.OpencodeService({ baseUrl: `http://127.0.0.1:${port}`, password: 'pw' });
    try {
      assert.equal(await svc.checkHealth(), true);
      const out = await svc.chat('hi', 'opencode/stub/model');
      assert.equal(out, 'hello from stub');
      assert.match(seen.auth, /^Basic /);
      assert.equal(seen.deleted, 'yes');
    } finally {
      server.close();
    }
  });

  test('listModels returns connected-only entries', async () => {
    const http = await import('node:http');
    const server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        all: [{ id: 'a' }, { id: 'b' }],
        default: { a: 'm1' },
        connected: ['a'],
      }));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const mod = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/services/OpencodeService.js')).href);
    const svc = new mod.OpencodeService({ baseUrl: `http://127.0.0.1:${port}`, password: 'pw' });
    try {
      assert.deepEqual(await svc.listModels(), [{ provider: 'a', model: 'm1', label: 'a/m1' }]);
    } finally {
      server.close();
    }
  });
});
