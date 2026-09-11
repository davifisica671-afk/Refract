import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

async function loadWorkaround() {
  // O módulo é TS compilado para CJS pelo build:electron (roda antes dos testes).
  const modPath = path.join(root, 'dist-electron', 'electron', 'net', 'dnsWorkaround.js');
  return import('file:///' + modPath.replace(/\\/g, '/'));
}

test('workaround DNS afeta APENAS os hosts alvo — outros hostnames passam pelo lookup original', async () => {
  const { installDnsWorkaround, restoreDnsWorkaround } = await loadWorkaround();

  const originalLookup = dns.lookup;
  let originalCalls = 0;
  const originalSpy = function (hostname, options, callback) {
    originalCalls++;
    if (typeof options === 'function') {
      options({}, []);
      return;
    }
    callback(null, '10.0.0.1', 4);
  };
  dns.lookup = originalSpy;

  try {
    // resolve4 fake — NÃO toca rede.
    installDnsWorkaround({
      hosts: ['api.refract.software'],
      resolve4: (hostname, callback) => callback(null, ['1.2.3.4']),
    });

    // 1) Host alvo → resolve via resolve4 fake, retorna IPv4.
    const target = await new Promise((resolve, reject) => {
      dns.lookup('api.refract.software', (err, address, family) =>
        err ? reject(err) : resolve({ address, family }),
      );
    });
    assert.deepEqual(target, { address: '1.2.3.4', family: 4 });
    assert.equal(originalCalls, 0, 'host alvo não deve cair no lookup original quando resolve4 retorna endereço');

    // 2) Host alvo, forma {all:true} → array de objetos.
    const targetAll = await new Promise((resolve, reject) => {
      dns.lookup('api.refract.software', { all: true }, (err, addresses) =>
        err ? reject(err) : resolve(addresses),
      );
    });
    assert.deepEqual(targetAll, [{ address: '1.2.3.4', family: 4 }]);

    // 3) Host FORA da lista → passa intocado pelo lookup original.
    const untouched = await new Promise((resolve, reject) => {
      dns.lookup('example.com', (err, address, family) =>
        err ? reject(err) : resolve({ address, family }),
      );
    });
    assert.deepEqual(untouched, { address: '10.0.0.1', family: 4 });
    assert.equal(originalCalls, 1);

    // 4) resolve4 falhou → fallback para o lookup original.
    restoreDnsWorkaround();
    originalCalls = 0;
    installDnsWorkaround({
      hosts: ['api.refract.software'],
      resolve4: (hostname, callback) => callback(new Error('resolvor fake falhou'), []),
    });
    const fellBack = await new Promise((resolve, reject) => {
      dns.lookup('api.refract.software', (err, address, family) =>
        err ? reject(err) : resolve({ address, family }),
      );
    });
    assert.deepEqual(fellBack, { address: '10.0.0.1', family: 4 });
    assert.equal(originalCalls, 1, 'resolve4 com erro deve cair no lookup original');
  } finally {
    restoreDnsWorkaround();
    dns.lookup = originalLookup;
  }
});

test('install é idempotente e restore devolve o lookup original', async () => {
  const { installDnsWorkaround, restoreDnsWorkaround } = await loadWorkaround();

  const originalLookup = dns.lookup;

  installDnsWorkaround({ hosts: ['x.test'], resolve4: (h, cb) => cb(null, ['9.9.9.9']) });
  const patched = dns.lookup;
  assert.notEqual(patched, originalLookup, 'dns.lookup deve estar patchado após install');

  // Segunda chamada não deve re-patchar (idempotente).
  installDnsWorkaround({ hosts: ['y.test'], resolve4: (h, cb) => cb(null, ['8.8.8.8']) });
  assert.equal(dns.lookup, patched, 'install repetido não deve substituir o patch');

  restoreDnsWorkaround();
  assert.equal(dns.lookup, originalLookup, 'restore deve devolver o lookup original');
});
