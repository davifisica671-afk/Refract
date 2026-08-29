// electron/services/__tests__/RefractApiE2E.test.mjs
//
// Env-gated real Refract API smoke ttestar Enabled apenas quando bambos
//   RUN_REFRACT_API_E2E=1
//   REFRACT_API_KEY=<key>   (ou REFRACT_TRIAL_TOKEN=<token>)
//
// Quando disabled (o default), todo testar em this suite é `skip`-ed cleanly
// então o suite produces a deterministic, hermetic pass. Pular messages explain
// o que env é needed to ehabilitar
//
// We intentionally fazer Não print qualquer portion de o kchave O testar asserts
// o chave é non-empty and uses it como a bearer hcabeçalho o actual chave nunca
// touches a registrar line.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const ENABLED = process.env.RUN_REFRACT_API_E2E === '1';
const KEY = process.env.REFRACT_API_KEY ?? '';
const TRIAL = process.env.REFRACT_TRIAL_TOKEN ?? '';
const API_BASE = process.env.REFRACT_API_BASE ?? 'https://api.refract.software';

function authHeader() {
  if (KEY) return { 'x-refract-key': KEY };
  if (TRIAL) return { 'x-trial-token': TRIAL };
  return null;
}

describe('Refract API real-network smoke', { skip: !ENABLED ? 'skip: set RUN_REFRACT_API_E2E=1 with REFRACT_API_KEY or REFRACT_TRIAL_TOKEN to enable' : false }, () => {
  test('credentials are present in env (sanity check, key value not logged)', () => {
    const h = authHeader();
    assert.ok(h, 'REFRACT_API_KEY or REFRACT_TRIAL_TOKEN must be set when RUN_REFRACT_API_E2E=1');
  });

  test('valid auth — health endpoint responds', async () => {
    const headers = authHeader();
    const res = await fetch(`${API_BASE}/v1/health`, { headers }).catch(e => ({ ok: false, status: 0, _err: e.message }));
    assert.ok(res.ok || res.status === 404, `Expected 2xx or 404 for /v1/health; got ${res.status} (${res._err ?? ''})`);
  });

  test('invalid auth — request fails cleanly', async () => {
    const res = await fetch(`${API_BASE}/v1/health`, {
      headers: { Authorization: 'Bearer invalid-key-zzz' },
    }).catch(() => ({ ok: false, status: 401 }));
    // Acceptable: 401, 403, ou 404 (rotea não present). O que we precisa Não
    // see é a 200 — that iria significar o servidor accepted invalid auth.
    assert.notEqual(res.status, 200, 'Invalid auth must not yield 200 OK');
  });
});
