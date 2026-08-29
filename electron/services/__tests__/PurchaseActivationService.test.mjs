// PurchaseActivationService — rede de segurança de ativação no main process.
// Testa contra o COMPILADO em dist-electron (mesmo padrão do teste de
// MicrophoneCapture). Todas as dependências externas são injetadas, então
// nenhum acesso real a rede/electron/disco de produção acontece: fetch, poll,
// ativação, broadcast, relógio e userDataPath são todos stubs/temporários.
//
// O `require('electron')` do módulo é interceptado via Module._load antes do
// import dinâmico (o compilado é CJS).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import Module from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const origLoad = Module._load;
Module._load = function patched(request, ...rest) {
    if (request === 'electron') {
        return {
            app: { getPath: () => os.tmpdir() },
            BrowserWindow: { getAllWindows: () => [] },
        };
    }
    return origLoad.call(this, request, ...rest);
};

const distPath = path.resolve('dist-electron/electron/services/PurchaseActivationService.js');
const { PurchaseActivationServiceImpl, computeBackoffMs, maskKey } =
    await import(pathToFileUrl(distPath));

function pathToFileUrl(p) { return new URL(`file://${p.replace(/\\/g, '/')}`).href; }

const tmpDirs = [];
function freshUserData() {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'refract-pa-'));
    tmpDirs.push(d);
    return d;
}
after(() => {
    Module._load = origLoad;
    for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* noop */ } }
});

function makeService(overrides = {}) {
    const events = [];
    const svc = new PurchaseActivationServiceImpl({
        userDataPath: freshUserData(),
        tickMs: 5,
        broadcast: (channel, payload) => events.push({ channel, payload }),
        ...overrides,
    });
    return { svc, events };
}

function waitFor(pred, { timeout = 2000, interval = 5 } = {}) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        const t = setInterval(() => {
            let ok = false;
            try { ok = pred(); } catch { ok = false; }
            if (ok) { clearInterval(t); resolve(); }
            else if (Date.now() - start > timeout) { clearInterval(t); reject(new Error('waitFor timeout')); }
        }, interval);
    });
}
const has = (events, channel, match) =>
    events.some((e) => e.channel === channel && Object.entries(match).every(([k, v]) => e.payload?.[k] === v));

// ── funções puras ──────────────────────────────────────────────────────────
test('computeBackoffMs: cresce exponencialmente e satura em 30s (±20% jitter)', () => {
    const zero = () => 0;   // jitter mínimo (0.8×)
    const one = () => 1;    // jitter máximo (1.2×)
    assert.equal(computeBackoffMs(1, zero), Math.round(3000 * 0.8));   // 2400
    assert.equal(computeBackoffMs(2, zero), Math.round(6000 * 0.8));   // 4800
    // satura: 3000*2^9 = 1.5M >> 30000 → usa o cap
    assert.equal(computeBackoffMs(10, zero), Math.round(30000 * 0.8)); // 24000
    assert.equal(computeBackoffMs(10, one), Math.round(30000 * 1.2));  // 36000
    // dentro dos limites com jitter real
    const v = computeBackoffMs(1);
    assert.ok(v >= 2400 && v <= 3600, `backoff ${v} fora de [2400,3600]`);
});

test('maskKey: nunca vaza a chave completa', () => {
    assert.equal(maskKey(undefined), '***');
    assert.equal(maskKey('short'), '***');
    assert.equal(maskKey('REFRACT-PRO.abcdefghij'), 'REFRACT-PRO.…');
});

// ── fluxos do loop ───────────────────────────────────────────────────────────
test('ativação bem-sucedida emite os dois broadcasts e limpa a pendência', async () => {
    const { svc, events } = makeService({ pollProvider: async () => ({ kind: 'activated', plan: 'yearly' }) });
    svc.trackPurchase({ provider: 'pix', checkoutId: 'c-act', plan: 'yearly', email: 'a@b.c' });
    await waitFor(() => has(events, 'purchase-activation-changed', { status: 'activated' }));
    svc.stop();
    assert.ok(has(events, 'license-status-changed', { isPremium: true }), 'deve destravar o Pro');
    assert.equal(svc.list().length, 0, 'pendência ativada é removida');
});

test('reembolso encerra a pendência como expired', async () => {
    const { svc, events } = makeService({ pollProvider: async () => ({ kind: 'refunded' }) });
    svc.trackPurchase({ provider: 'lemonsqueezy', checkoutId: 'c-ref', plan: 'monthly' });
    await waitFor(() => has(events, 'purchase-activation-changed', { status: 'expired' }));
    svc.stop();
    const ev = events.find((e) => e.channel === 'purchase-activation-changed');
    assert.equal(ev.payload.error, 'payment_refunded');
    assert.equal(svc.list().length, 0);
});

test('pagamento confirmado mas ativação falha repetidamente → needs_manual com a chave', async () => {
    let clock = 1_000_000;
    const { svc, events } = makeService({
        now: () => (clock += 5_000), // relógio auto-avança: backoff sempre já venceu
        pollProvider: async () => ({ kind: 'paid_needs_manual', licenseKey: 'REFRACT-PRO.zzzzzzzzzzzz', error: 'e' }),
    });
    svc.trackPurchase({ provider: 'pix', checkoutId: 'c-man', plan: 'monthly' });
    await waitFor(() => has(events, 'purchase-activation-changed', { status: 'needs_manual' }), { timeout: 3000 });
    svc.stop();
    const ev = events.find((e) => e.payload?.status === 'needs_manual');
    assert.equal(ev.payload.licenseKey, 'REFRACT-PRO.zzzzzzzzzzzz', 'entrega a chave para ativação manual');
    assert.equal(svc.list().length, 0);
});

// ── persistência e resume ────────────────────────────────────────────────────
test('trackPurchase persiste em disco e uma nova instância recarrega a pendência', () => {
    const userDataPath = freshUserData();
    const a = new PurchaseActivationServiceImpl({ userDataPath, broadcast: () => {} });
    a.trackPurchase({ provider: 'pix', checkoutId: 'c-persist', plan: 'monthly', email: 'x@y.z' });
    a.stop();
    assert.ok(fs.existsSync(path.join(userDataPath, 'pending-purchases.json')), 'grava o store');

    const b = new PurchaseActivationServiceImpl({ userDataPath, broadcast: () => {} });
    const list = b.list();
    b.stop();
    assert.equal(list.length, 1);
    assert.equal(list[0].checkoutId, 'c-persist');
});

test('resume descarta pendências com mais de 7 dias e mantém as recentes', () => {
    const userDataPath = freshUserData();
    const now = Date.now();
    const old = now - 8 * 24 * 60 * 60 * 1000;  // 8 dias
    fs.writeFileSync(
        path.join(userDataPath, 'pending-purchases.json'),
        JSON.stringify([
            { provider: 'pix', checkoutId: 'velha', plan: 'monthly', email: '', startedAt: old },
            { provider: 'pix', checkoutId: 'nova', plan: 'monthly', email: '', startedAt: now },
        ]),
    );
    const events = [];
    const svc = new PurchaseActivationServiceImpl({
        userDataPath, broadcast: (c, p) => events.push({ c, p }),
    });
    const { resumed } = svc.resume();
    svc.stop();
    assert.equal(resumed, 1, 'só a recente é retomada');
    assert.deepEqual(svc.list().map((p) => p.checkoutId), ['nova']);
    assert.ok(events.some((e) => e.p?.status === 'expired' && e.p?.checkoutId === 'velha'), 'emite expired para a velha');
});
