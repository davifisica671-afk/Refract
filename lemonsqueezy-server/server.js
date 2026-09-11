#!/usr/bin/env node
/**
 * Refract LemonSqueezy Server — Checkout + Licenças (standalone).
 *
 * Servidor autocontido que implementa o backend de pagamento LemonSqueezy
 * para o Refract Pro. Emite licenças assinadas Ed25519 no formato REFRACT-PRO
 * (mesmo formato verificado offline pelo LicenseManager do app).
 *
 * Endpoints:
 *   POST /v1/checkout/lemonsqueezy        → cria sessão de checkout
 *   GET  /v1/checkout/:id/license         → devolve licença assinada (ou pending)
 *   POST /v1/license/lookup               → self-service "paguei e perdi a chave"
 *                                            (exige email + hwid exatos)
 *   POST /webhooks/lemonsqueezy           → recebe eventos do LemonSqueezy
 *   GET  /health                          → healthcheck
 *
 * Variáveis de ambiente:
 *   PORT                    (default 8787)
 *   LEMONSQUEEZY_API_KEY    chave de API do LemonSqueezy (obrigatória)
 *   LEMONSQUEEZY_STORE_ID   ID da loja (obrigatório)
 *   LEMONSQUEEZY_WEBHOOK_SECRET  segredo do webhook (obrigatório)
 *   LEMONSQUEEZY_VARIANT_MONTHLY / _YEARLY / _LIFETIME
 *                            IDs das variantes de produto por plano (obrigatórias)
 *   LICENSE_SIGNING_KEY_PATH caminho da chave privada Ed25519
 *                            (default ~/.refract/license-signing-key.pem)
 *   DB_PATH                 caminho do SQLite (default ./data/refract-ls.db)
 *   LS_RATE_LIMIT_PER_MIN   limite de requisições/min por IP nos endpoints de
 *                           licença (default 120; 0 desativa — apenas p/ debug)
 *   LS_CHECKOUT_LIMIT_PER_MIN limite de criações de checkout/min por IP
 *                           (default 20; protege o POST público contra spam)
 *   LS_TRUST_PROXY=1       confia em X-Forwarded-For p/ req.ip (obrigatório
 *                           atrás de proxy — ex.: Fly.io — senão todos os
 *                           clientes dividem o mesmo bucket de rate-limit)
 *   LS_REQUIRE_HWID         (obsoleta) o modo estrito agora é o padrão;
 *                           manter =1 não faz mal; qualquer outro valor dela
 *                           é ignorado — use LS_ALLOW_LEGACY_NO_HWID p/ afrouxar
 *   LS_ALLOW_LEGACY_NO_HWID=1 reativa o bypass de poll p/ linhas sem hwid
 *                           (compatibilidade temporária; loga warning alto).
 *                           SEM essa flag, linhas sem hwid são recusadas (403).
 *   LS_RECONCILE_DISABLED=1 desativa o job de reconciliação de checkouts abertos
 *   LS_RECONCILE_INTERVAL_MS intervalo do job (default 600000 = 10 min)
 *   LS_NO_LISTEN=1          não escuta porta (usado pelos testes com app.inject)
 *
 * Deploy: Railway / Render / Fly.io — `npm start`.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
// @lemonsqueezy/lemonsqueezy.js is published as CommonJS; import its default and
// destructure to be compatible when running under ESM (Node >= 20).
import lemonSqueezyPkg from '@lemonsqueezy/lemonsqueezy.js';
// The SDK exports a LemonSqueezy client class. Normalize access for both CJS/ESM shapes.
const LemonSqueezy = lemonSqueezyPkg?.LemonSqueezy || lemonSqueezyPkg?.default || lemonSqueezyPkg;

// ── config ─────────────────────────────────────────────────────────────
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEST_MODE = process.env.LS_NO_LISTEN === '1';
const PORT = Number(process.env.PORT || 8787);
const LS_API_KEY = process.env.LEMONSQUEEZY_API_KEY;
const LS_STORE_ID = process.env.LEMONSQUEEZY_STORE_ID;
const LS_WEBHOOK_SECRET = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
const VARIANT_IDS = {
    monthly: process.env.LEMONSQUEEZY_VARIANT_MONTHLY,
    yearly: process.env.LEMONSQUEEZY_VARIANT_YEARLY,
    lifetime: process.env.LEMONSQUEEZY_VARIANT_LIFETIME,
};
const KEY_PATH = process.env.LICENSE_SIGNING_KEY_PATH || path.join(os.homedir(), '.refract', 'license-signing-key.pem');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'refract-ls.db');
const RATE_LIMIT_PER_MIN = Number(process.env.LS_RATE_LIMIT_PER_MIN ?? 120);
const CHECKOUT_LIMIT_PER_MIN = Number(process.env.LS_CHECKOUT_LIMIT_PER_MIN ?? 20);
// F-04: estrito por padrão (secure-by-default). O bypass legado de poll para
// linhas sem hwid só volta com opt-out explícito LS_ALLOW_LEGACY_NO_HWID=1
// (logado como warning). LS_REQUIRE_HWID=1 (flag antiga) continua forçando o
// estrito; qualquer outro valor dela é ignorado em favor do padrão seguro.
const STRICT_HWID = process.env.LS_ALLOW_LEGACY_NO_HWID === '1'
    ? false
    : true;
const TRUST_PROXY = process.env.LS_TRUST_PROXY === '1';
const RECONCILE_INTERVAL_MS = Number(process.env.LS_RECONCILE_INTERVAL_MS || 10 * 60_000);

const KEY_PREFIX = 'REFRACT-PRO.';
const PLAN_DAYS = { lifetime: null, yearly: 365, monthly: 31 };

// ── validação de config ────────────────────────────────────────────────
/**
 * F-01: recusa valores que são claramente placeholders (ex.: copiados de um
 * .env.example sem preencher). Só vale em produção — testes usam segredos
 * de mentira de propósito. Exportada pura para os testes.
 */
export function isPlaceholderSecret(v) {
    if (typeof v !== 'string') return true;
    const s = v.trim();
    if (s.length < 8) return true;
    return /^(your_|change-?me|example|placeholder|xxx+|test-|to-?do|here\b)/i.test(s)
        || /your_|change-?me|example\.com|placeholder/i.test(s);
}

const missing = [];
if (!LS_API_KEY) missing.push('LEMONSQUEEZY_API_KEY');
if (!LS_STORE_ID) missing.push('LEMONSQUEEZY_STORE_ID');
if (!LS_WEBHOOK_SECRET) missing.push('LEMONSQUEEZY_WEBHOOK_SECRET');
for (const [plan, variantId] of Object.entries(VARIANT_IDS)) {
    if (!variantId) missing.push(`LEMONSQUEEZY_VARIANT_${plan.toUpperCase()}`);
}
if (missing.length && !TEST_MODE) {
    console.error(`[Refract-LS] Faltam variáveis de ambiente: ${missing.join(', ')}`);
    process.exit(1);
}
if (!TEST_MODE) {
    const placeholders = [
        ['LEMONSQUEEZY_API_KEY', LS_API_KEY],
        ['LEMONSQUEEZY_WEBHOOK_SECRET', LS_WEBHOOK_SECRET],
        ...Object.entries(VARIANT_IDS).map(([plan, v]) => [`LEMONSQUEEZY_VARIANT_${plan.toUpperCase()}`, v]),
    ].filter(([, v]) => isPlaceholderSecret(v)).map(([k]) => k);
    if (placeholders.length) {
        console.error(`[Refract-LS] Valores placeholder detectados (preencha com segredos reais): ${placeholders.join(', ')}`);
        process.exit(1);
    }
    if (RATE_LIMIT_PER_MIN === 0 || CHECKOUT_LIMIT_PER_MIN === 0) {
        console.error('[Refract-LS] Rate-limit zerado (LS_RATE_LIMIT_PER_MIN/LS_CHECKOUT_LIMIT_PER_MIN=0) — recuse em produção.');
        process.exit(1);
    }
    // F-13: nunca assinar com a chave de teste em produção.
    if (path.basename(KEY_PATH).toLowerCase().includes('test-key')) {
        console.error(`[Refract-LS] LICENSE_SIGNING_KEY_PATH aponta para chave de teste (${KEY_PATH}) — recuse em produção.`);
        process.exit(1);
    }
    if (!STRICT_HWID) {
        console.warn('[Refract-LS] ATENÇÃO: LS_ALLOW_LEGACY_NO_HWID=1 ativo — poll de linhas sem hwid liberado (bypass legado F-04).');
    }
}
if (!fs.existsSync(KEY_PATH)) {
    if (!TEST_MODE) {
        console.error(`[Refract-LS] Chave privada não encontrada em ${KEY_PATH}`);
        console.error('Gere com: node premium/tools/gen-keypair.mjs (ou restaure seu backup).');
        process.exit(1);
    }
}

// ── LemonSqueezy client ─────────────────────────────────────────────────
// Create a client instance when the API key is present. We delay instantiation
// until runtime so the file can be imported without the env var set.
let lsClient = null;
if (LS_API_KEY) {
    try {
        lsClient = new LemonSqueezy(LS_API_KEY);
    } catch (e) {
        console.error('[Refract-LS] Failed to initialize LemonSqueezy client:', e);
    }
}

// ── SQLite ─────────────────────────────────────────────────────────────
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS checkouts (
    id            TEXT PRIMARY KEY,
    plan          TEXT NOT NULL,
    email         TEXT,
    hwid          TEXT,
    status        TEXT NOT NULL DEFAULT 'open',
    license_key   TEXT,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS webhook_events (
    event_key    TEXT PRIMARY KEY,
    event_name   TEXT,
    processed_at INTEGER NOT NULL
  );
`);

// ── assinatura de licença (mesmo formato do issue-license.mjs) ────────
// Chave carregada sob demanda (lazy): importar o módulo em TEST_MODE sem
// chave no disco não deve derrubar a suíte; em produção a falta da chave
// já causou process.exit(1) acima.
let cachedPrivateKey = null;
function getPrivateKey() {
    if (!cachedPrivateKey) {
        cachedPrivateKey = crypto.createPrivateKey(fs.readFileSync(KEY_PATH, 'utf8'));
    }
    return cachedPrivateKey;
}

function issueLicense({ plan, email }) {
    const now = Date.now();
    const days = PLAN_DAYS[plan] ?? 31;
    const payload = {
        v: 1,
        provider: 'lemonsqueezy',
        plan,
        ...(email ? { email } : {}),
        iat: now,
        ...(days !== null ? { exp: now + days * 86_400_000 } : {}),
    };
    const payloadBuf = Buffer.from(JSON.stringify(payload), 'utf8');
    const sig = crypto.sign(null, payloadBuf, getPrivateKey()); // Ed25519
    return KEY_PREFIX + payloadBuf.toString('base64url') + '.' + sig.toString('base64url');
}

/** Emite e persiste a licença de um checkout, uma única vez (guard anti-duplo). */
function issueAndStoreLicense(row) {
    if (!row || row.license_key) return row?.license_key ?? null;
    const licenseKey = issueLicense({ plan: row.plan, email: row.email });
    const changes = db
        .prepare(
            `UPDATE checkouts SET status = 'paid', license_key = ?, updated_at = ? WHERE id = ? AND license_key IS NULL`
        )
        .run(licenseKey, Date.now(), row.id).changes;
    return changes > 0 ? licenseKey : null;
}

// ── rate limit (em memória, por IP — suficiente p/ deploy single-instance) ─
/**
 * Token bucket simples com janela fixa. Exportado puro para os testes.
 * LS_RATE_LIMIT_PER_MIN=0 desativa.
 */
export function createRateLimiter({ max, windowMs }) {
    const hits = new Map();
    return function check(ip) {
        if (max <= 0) return { allowed: true, remaining: Infinity, retryAfterMs: 0 };
        const now = Date.now();
        let entry = hits.get(ip);
        if (!entry || entry.resetAt <= now) {
            entry = { count: 0, resetAt: now + windowMs };
            hits.set(ip, entry);
            // poda periódica para o mapa não crescer sem limite
            if (hits.size > 10_000) {
                for (const [k, v] of hits) {
                    if (v.resetAt <= now) hits.delete(k);
                }
            }
        }
        entry.count += 1;
        return {
            allowed: entry.count <= max,
            remaining: Math.max(0, max - entry.count),
            retryAfterMs: Math.max(0, entry.resetAt - now),
        };
    };
}

/**
 * Política de acesso ao poll por hwid (exportada pura para os testes).
 *  - linha COM hwid conhecido → exige match exato (sempre).
 *  - linha SEM hwid (legado/'unknown') → em modo estrito é RECUSADA (F-04:
 *    aceitar qualquer hwid não-vazio não é prova de posse); fora do estrito
 *    (apenas com LS_ALLOW_LEGACY_NO_HWID=1) mantém o bypass antigo para
 *    clientes que ainda não enviam hwid.
 */
export function hwidAllowsAccess(rowHwid, queryHwid, strict) {
    const r = String(rowHwid || '');
    const q = String(queryHwid || '');
    if (r && r !== 'unknown') return q === r;
    return strict ? false : true;
}

const licenseRateLimit = createRateLimiter({
    max: RATE_LIMIT_PER_MIN,
    windowMs: 60_000,
});

// F-07: bucket separado e mais apertado p/ criação de checkout (rota pública
// de escrita — sem ele, spam enche o SQLite e gera custo de API no LS).
const checkoutRateLimit = createRateLimiter({
    max: CHECKOUT_LIMIT_PER_MIN,
    windowMs: 60_000,
});

function rateLimitPreHandler(req, reply, done) {
    const verdict = licenseRateLimit(req.ip || 'unknown');
    if (!verdict.allowed) {
        reply.code(429).header('retry-after', Math.ceil(verdict.retryAfterMs / 1000)).send({ error: 'rate_limited' });
        return;
    }
    done();
}

function checkoutRateLimitPreHandler(req, reply, done) {
    const verdict = checkoutRateLimit(req.ip || 'unknown');
    if (!verdict.allowed) {
        reply.code(429).header('retry-after', Math.ceil(verdict.retryAfterMs / 1000)).send({ error: 'rate_limited' });
        return;
    }
    done();
}

// ── consulta de status no LemonSqueezy (poll + reconciliação) ──────────
async function fetchLsCheckoutStatus(checkoutId) {
    const res = await fetch(`https://api.lemonsqueezy.com/v1/checkouts/${encodeURIComponent(checkoutId)}`, {
        headers: { Authorization: `Bearer ${LS_API_KEY}` },
    });
    if (!res.ok) throw new Error(`ls_status_${res.status}`);
    const data = await res.json();
    return data?.data?.attributes?.status || 'open';
}

// ── Fastify ────────────────────────────────────────────────────────────
// F-12: trustProxy SOMENTE com opt-in explícito (sem ele, X-Forwarded-For é
// ignorado e req.ip é o IP do proxy — todos os clientes dividiriam 1 bucket).
const app = Fastify({ logger: true, trustProxy: TRUST_PROXY });

// Captura o body cru (raw) para validação de assinatura de webhook (HMAC).
// O LemonSqueezy assina o corpo exato da requisição; precisamos do buffer cru.
app.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (req, body, done) => {
        try {
            const raw = body.toString('utf8');
            // Guarda o raw para o webhook validar a assinatura.
            req.rawBody = raw;
            done(null, raw ? JSON.parse(raw) : {});
        } catch (err) {
            done(err);
        }
    }
);

// Healthcheck
app.get('/health', async () => ({ ok: true, service: 'refract-lemonsqueezy' }));

// Cria sessão de checkout (pública por design, mas com rate-limit F-07)
app.post('/v1/checkout/lemonsqueezy', { preHandler: checkoutRateLimitPreHandler }, async (req, reply) => {
    const { plan, email, hwid } = req.body || {};
    if (!['monthly', 'yearly', 'lifetime'].includes(plan)) {
        return reply.code(400).send({ error: 'invalid_plan' });
    }
    // hwid opcional por compatibilidade, mas SEMPRE persistido quando enviado:
    // linhas futuras carregam o fator de posse exigido no poll (F-04).
    const cleanHwid = typeof hwid === 'string' && hwid.length <= 128 ? hwid : null;
    const cleanEmail = typeof email === 'string' && email.length <= 320 ? email : null;

    try {
        // SDK oficial: createCheckout({ storeId, variantId, attributes }) — variante é obrigatória.
        if (!lsClient) {
            app.log.error('LemonSqueezy client not initialized');
            return reply.code(502).send({ error: 'lemonsqueezy_client_unavailable' });
        }
        const checkout = await lsClient.createCheckout({
            storeId: Number(LS_STORE_ID),
            variantId: Number(VARIANT_IDS[plan]),
            attributes: {
                checkoutData: {
                    custom: { plan, hwid: hwid || '' },
                    email: email || undefined,
                },
            },
        });

        const checkoutId = String(checkout.data?.data?.id || checkout.data?.id || '');
        const checkoutUrl = checkout.data?.data?.attributes?.url || checkout.data?.attributes?.url || '';
        if (!checkoutId || !checkoutUrl) {
            return reply.code(502).send({ error: 'lemonsqueezy_checkout_failed' });
        }

        const now = Date.now();
        db.prepare(
            `INSERT INTO checkouts (id, plan, email, hwid, status, created_at, updated_at)
             VALUES (?, ?, ?, ?, 'open', ?, ?)`
        ).run(checkoutId, plan, cleanEmail, cleanHwid, now, now);

        return { checkout_id: checkoutId, checkout_url: checkoutUrl };
    } catch (err) {
        app.log.error(err, 'createCheckout failed');
        return reply.code(502).send({ error: 'lemonsqueezy_checkout_failed' });
    }
});

// Polling: devolve a licença quando o pagamento é confirmado.
// O `hwid` enviado na criação do checkout é exigido como fator de verificação —
// sem ele, qualquer um que adivinhar um checkout id poderia ler a license_key.
// Em modo estrito (padrão; ver LS_ALLOW_LEGACY_NO_HWID) linhas SEM hwid gravado
// são recusadas — "qualquer hwid não-vazio" não é prova de posse (F-04/F-12).
app.get('/v1/checkout/:id/license', { preHandler: rateLimitPreHandler }, async (req, reply) => {
    const { id } = req.params;
    const row = db.prepare('SELECT * FROM checkouts WHERE id = ?').get(id);
    if (!row) return reply.code(404).send({ error: 'checkout_not_found' });

    if (row.status === 'refunded') {
        return { status: 'refunded' };
    }

    if (!hwidAllowsAccess(row.hwid, req.query?.hwid, STRICT_HWID)) {
        return reply.code(403).send({ error: 'hwid_mismatch' });
    }

    // Se já emitimos a licença, devolve direto (com o plano para o cliente
    // propagar o status correto de premium sem hardcode).
    if (row.license_key) {
        return { license_key: row.license_key, status: 'paid', plan: row.plan };
    }

    // Consulta o status no LemonSqueezy.
    try {
        const status = await fetchLsCheckoutStatus(id);

        if (status === 'paid') {
            const licenseKey = issueAndStoreLicense(row);
            if (licenseKey) {
                app.log.info(`[poll] Licença emitida para checkout ${id}`);
                return { license_key: licenseKey, status: 'paid', plan: row.plan };
            }
            // Perdeu a corrida (webhook emitiu primeiro) — rele a linha.
            const fresh = db.prepare('SELECT * FROM checkouts WHERE id = ?').get(id);
            return fresh?.license_key
                ? { license_key: fresh.license_key, status: 'paid', plan: fresh.plan }
                : { status: 'pending' };
        }

        return { status: 'pending' };
    } catch (err) {
        app.log.error(err, 'poll status failed');
        return reply.code(502).send({ error: 'lemonsqueezy_status_failed' });
    }
});

// Self-service: "paguei e perdi a chave". Só devolve a licença quando email E
// hwid batem exatamente com o checkout pago (o hwid é o desafio de posse —
// saber só o e-mail não basta).
app.post('/v1/license/lookup', { preHandler: rateLimitPreHandler }, async (req, reply) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const hwid = String(req.body?.hwid || '');
    if (!email || !hwid) return reply.code(400).send({ error: 'missing_params' });

    const row = db
        .prepare(
            `SELECT * FROM checkouts
             WHERE status = 'paid' AND license_key IS NOT NULL
               AND lower(email) = ? AND hwid = ?
             ORDER BY updated_at DESC LIMIT 1`
        )
        .get(email, hwid);
    if (!row) return reply.code(404).send({ error: 'not_found' });

    return { license_key: row.license_key, status: 'paid', plan: row.plan };
});

// Webhook do LemonSqueezy (robustez — cobre o caso sem polling).
// Matriz de eventos tratada + idempotência por event_key (replay-safe).
app.post('/webhooks/lemonsqueezy', async (req, reply) => {
    const signature = req.headers['x-signature'];
    if (!signature) return reply.code(401).send({ error: 'missing_signature' });

    // Valida a assinatura do webhook (HMAC SHA-256 do body com o secret).
    const raw = req.rawBody || JSON.stringify(req.body || {});
    const expected = crypto
        .createHmac('sha256', LS_WEBHOOK_SECRET)
        .update(raw)
        .digest('hex');
    const received = String(signature).replace(/^sha256=/, '');
    const expectedBuf = Buffer.from(expected, 'utf8');
    const receivedBuf = Buffer.from(received, 'utf8');
    // timingSafeEqual lança se os buffers tiverem tamanhos diferentes — uma
    // assinatura maliciosa com length != 64 viraria 500 em vez de 401.
    if (expectedBuf.length !== receivedBuf.length || !crypto.timingSafeEqual(expectedBuf, receivedBuf)) {
        return reply.code(401).send({ error: 'invalid_signature' });
    }

    const eventName = req.body?.meta?.event_name || '';
    const attrs = req.body?.data?.attributes || {};
    const objectId = req.body?.data?.id || '';
    // Webhooks de order carregam o objeto ORDER; o id do checkout vem em
    // attributes.checkout_id. Fallback para data.id mantém compatibilidade.
    const checkoutId = String(attrs.checkout_id || objectId || '');

    // Idempotência: o mesmo evento (reentrega do LS) é processado uma vez.
    const eventKey = `${eventName}:${objectId}:${attrs.order_number ?? ''}`;
    const inserted = db
        .prepare(`INSERT OR IGNORE INTO webhook_events (event_key, event_name, processed_at) VALUES (?, ?, ?)`)
        .run(eventKey, eventName, Date.now()).changes;
    if (!inserted) {
        return { received: true, duplicate: true };
    }

    if (eventName === 'order_created' && checkoutId) {
        const row = db.prepare('SELECT * FROM checkouts WHERE id = ?').get(checkoutId);
        if (row && !row.license_key) {
            const licenseKey = issueAndStoreLicense(row);
            if (licenseKey) app.log.info(`[webhook] Licença emitida para checkout ${checkoutId}`);
        }
    } else if (eventName === 'order_refunded' && checkoutId) {
        // Marca como reembolsado: o poll passa a devolver status='refunded'
        // (o cliente encerra o rastreio) e a chave deixa de ser reemitida.
        const result = db
            .prepare(`UPDATE checkouts SET status = 'refunded', updated_at = ? WHERE id = ? AND status != 'refunded'`)
            .run(Date.now(), checkoutId);
        if (result.changes > 0) app.log.warn(`[webhook] Checkout ${checkoutId} marcado como reembolsado`);
    } else if (eventName.startsWith('subscription_')) {
        // Produtos de assinatura ainda não estão no ar; registramos o evento
        // (idempotente acima) para auditoria futura sem quebrar o fluxo.
        app.log.info(`[webhook] Evento de assinatura registrado: ${eventName} (${objectId})`);
    } else {
        app.log.debug(`[webhook] Evento ignorado: ${eventName || '(sem nome)'}`);
    }

    return { received: true };
});

// ── reconciliação: checkouts 'open' esquecidos são re-checados ─────────
// Cobre o caso "pagou e fechou o app antes do primeiro poll": o job consulta
// a API do LS e emite a licença mesmo sem ninguém perguntando.
async function reconcileOpenCheckouts() {
    const cutoff = Date.now() - 10 * 60_000; // abertos há mais de 10 min
    const rows = db
        .prepare(`SELECT * FROM checkouts WHERE status = 'open' AND created_at < ? LIMIT 25`)
        .all(cutoff);
    for (const row of rows) {
        try {
            const status = await fetchLsCheckoutStatus(row.id);
            if (status === 'paid') {
                const licenseKey = issueAndStoreLicense(row);
                if (licenseKey) app.log.info(`[reconcile] Licença emitida para checkout ${row.id}`);
            }
        } catch (err) {
            app.log.warn(err, `[reconcile] Falha ao re-checar checkout ${row.id}`);
        }
    }
}
if (!process.env.LS_RECONCILE_DISABLED) {
    const timer = setInterval(() => {
        void reconcileOpenCheckouts();
    }, RECONCILE_INTERVAL_MS);
    if (typeof timer.unref === 'function') timer.unref();
}

// ── start ──────────────────────────────────────────────────────────────
if (!TEST_MODE) {
    app.listen({ port: PORT, host: '0.0.0.0' }, (err) => {
        if (err) {
            app.log.error(err);
            process.exit(1);
        }
        app.log.info(`[Refract-LS] rodando em :${PORT}`);
    });
}

// createRateLimiter e hwidAllowsAccess já são exportados inline (export function)
// nas suas definições — re-exportá-los aqui gerava "Duplicate export" e derrubava
// o parse do módulo inteiro (o server nem subia). reconcileOpenCheckouts não tem
// export inline, então é o único que precisa ser exportado aqui.
export { reconcileOpenCheckouts };
export default app;
