// Testes do servidor de checkout LemonSqueezy — rodam SEM credencial real nem
// porta aberta, usando o TEST_MODE que a WIP de reliability adicionou:
//   LS_NO_LISTEN=1  → não abre porta (usamos app.inject do Fastify)
//   DB_PATH=<tmp>   → SQLite isolado e descartável
//
// Cobrem o núcleo de robustez do server: rate limiter, política de hwid,
// healthcheck e — o mais importante — validação de assinatura HMAC do webhook
// e idempotência de reentrega. Nada aqui toca a API real do LemonSqueezy.
//
// As env vars são definidas ANTES do import porque server.js as lê no topo do
// módulo (import dinâmico garante essa ordem).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

process.env.LS_NO_LISTEN = '1';
process.env.LEMONSQUEEZY_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.DB_PATH = path.join(os.tmpdir(), `refract-ls-test-${process.pid}-${Date.now()}.db`);

const { default: app, createRateLimiter, hwidAllowsAccess, isPlaceholderSecret } = await import('./server.js');

test.after(() => {
    try { app.close(); } catch { /* noop */ }
    for (const suffix of ['', '-shm', '-wal']) {
        try { fs.rmSync(process.env.DB_PATH + suffix, { force: true }); } catch { /* noop */ }
    }
});

// ── rate limiter ─────────────────────────────────────────────────────────
test('rate limiter: permite até max e bloqueia o excedente', () => {
    const check = createRateLimiter({ max: 2, windowMs: 1000 });
    assert.equal(check('ip').allowed, true);
    assert.equal(check('ip').allowed, true);
    const third = check('ip');
    assert.equal(third.allowed, false, '3ª req com max=2 deve ser bloqueada');
    assert.equal(third.remaining, 0);
    assert.ok(third.retryAfterMs > 0, 'deve informar retryAfterMs');
});

test('rate limiter: max<=0 é ilimitado', () => {
    const check = createRateLimiter({ max: 0, windowMs: 1000 });
    assert.equal(check('x').allowed, true);
    assert.equal(check('x').remaining, Infinity);
});

test('rate limiter: contadores isolados por IP', () => {
    const check = createRateLimiter({ max: 1, windowMs: 1000 });
    assert.equal(check('a').allowed, true);
    assert.equal(check('b').allowed, true, 'IP diferente tem contador próprio');
    assert.equal(check('a').allowed, false, 'IP "a" já estourou o limite');
});

// ── política de hwid ───────────────────────────────────────────────────────
test('hwid: linha com hwid conhecido exige match exato', () => {
    assert.equal(hwidAllowsAccess('abc', 'abc', false), true);
    assert.equal(hwidAllowsAccess('abc', 'xyz', false), false);
    assert.equal(hwidAllowsAccess('abc', '', false), false, 'query vazia não pode acessar linha com hwid');
    assert.equal(hwidAllowsAccess('abc', 'abc', true), true, 'strict não afrouxa um match válido');
});

test('hwid: linha legada (sem hwid) — recusada no estrito (F-04), bypass só fora dele', () => {
    assert.equal(hwidAllowsAccess('', '', false), true, 'compat explícita: sem hwid, sem strict → libera');
    assert.equal(hwidAllowsAccess('unknown', '', false), true);
    assert.equal(hwidAllowsAccess(null, 'q', false), true);
    assert.equal(hwidAllowsAccess('unknown', '', true), false, 'strict: linha legada sem query → nega');
    assert.equal(hwidAllowsAccess('', 'q', true), false, 'strict: hwid qualquer NÃO é posse → nega (F-04/F-12)');
    assert.equal(hwidAllowsAccess(null, 'q', true), false);
});

// ── healthcheck ────────────────────────────────────────────────────────────
test('GET /health responde 200', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true, service: 'refract-lemonsqueezy' });
});

// ── F-07: POST /v1/checkout tem rate-limit próprio ─────────────────────────
test('POST /v1/checkout sem plano válido conta p/ o limite e estoura em 429', async () => {
    // Default LS_CHECKOUT_LIMIT_PER_MIN=20 — 25 chamadas com plano inválido
    // (400, sem tocar a API do LS) devem terminar em 429.
    let last;
    for (let i = 0; i < 25; i++) {
        last = await app.inject({
            method: 'POST', url: '/v1/checkout/lemonsqueezy',
            payload: { plan: 'nope' },
        });
    }
    assert.equal(last.statusCode, 429, 'flood de checkout deve ser limitado');
    assert.equal(last.json().error, 'rate_limited');
});

// ── F-01: placeholders de segredo são detectados ───────────────────────────
test('isPlaceholderSecret recusa placeholders e aceita valores plausíveis', () => {
    for (const v of ['your_api_key_here', 'changeme', 'test-secret', 'test-webhook-secret', 'xxx', '', null, undefined, 'short']) {
        assert.equal(isPlaceholderSecret(v), true, JSON.stringify(v) + ' deve ser placeholder');
    }
    assert.equal(isPlaceholderSecret('whsec_9f2Kv7Qd8LmX4pTz'), false);
    assert.equal(isPlaceholderSecret('gsk_abc123XYZ456'), false);
});

// ── webhook: validação de assinatura HMAC ──────────────────────────────────
const sign = (body) =>
    'sha256=' + crypto.createHmac('sha256', process.env.LEMONSQUEEZY_WEBHOOK_SECRET).update(body).digest('hex');

test('webhook sem assinatura → 401 missing_signature', async () => {
    const res = await app.inject({
        method: 'POST', url: '/webhooks/lemonsqueezy',
        payload: { meta: { event_name: 'x' } },
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error, 'missing_signature');
});

test('webhook com assinatura inválida → 401 invalid_signature', async () => {
    const res = await app.inject({
        method: 'POST', url: '/webhooks/lemonsqueezy',
        headers: { 'x-signature': 'sha256=deadbeef' },
        payload: { meta: { event_name: 'x' } },
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.json().error, 'invalid_signature');
});

test('webhook com assinatura válida → 200, e reentrega é idempotente', async () => {
    const body = JSON.stringify({
        meta: { event_name: 'subscription_created' },
        data: { id: 'evt_test_dedupe', attributes: {} },
    });
    const headers = { 'x-signature': sign(body), 'content-type': 'application/json' };

    const first = await app.inject({ method: 'POST', url: '/webhooks/lemonsqueezy', headers, payload: body });
    assert.equal(first.statusCode, 200, 'assinatura válida deve ser aceita');
    assert.equal(first.json().received, true);
    assert.notEqual(first.json().duplicate, true, 'primeira entrega não é duplicata');

    const second = await app.inject({ method: 'POST', url: '/webhooks/lemonsqueezy', headers, payload: body });
    assert.equal(second.statusCode, 200);
    assert.equal(second.json().duplicate, true, 'reentrega do mesmo evento deve ser marcada como duplicata');
});
