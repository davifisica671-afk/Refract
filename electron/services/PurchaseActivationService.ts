/**
 * PurchaseActivationService — ativação de compras à prova de falhas (main process).
 *
 * Problema que resolve (plans/payments-reliability-upgrade.md, causas #1 e #2):
 * o polling de licença vivia nos componentes de checkout do renderer com um
 * deadline de 15 min. Fechar a janela/app matava o polling para sempre e a
 * compra paga nunca ativava o Pro.
 *
 * Agora o main process é o dono do ciclo:
 *   - persiste compras pendentes em userData/pending-purchases.json (escrita atômica)
 *   - faz o poll com backoff exponencial (3s → 30s cap) + jitter, sem deadline
 *     curto (expira apenas após MAX_AGE_MS = 7 dias)
 *   - retoma pendências no startup (resume()) — sobrevive a quit/crash/reload
 *   - ao ativar, broadcast 'license-status-changed' + 'purchase-activation-changed'
 *     para todas as janelas (a UI atualiza mesmo se o checkout foi fechado)
 *
 * Autocontido e reversível: nenhum handler existente é alterado. O renderer
 * continua com seu próprio poll como caminho rápido; este serviço é a rede de
 * segurança que roda independente da UI. Para desabilitar, basta não chamar
 * registerPurchaseActivationHandlers()/resume() no main.ts.
 */
import { app, BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

export type PurchaseProvider = 'pix' | 'lemonsqueezy';

export interface PendingPurchase {
    provider: PurchaseProvider;
    checkoutId: string;
    plan: string;
    email: string;
    startedAt: number;
    /** Próxima tentativa (epoch ms) — backoff exponencial por checkout. */
    nextAttemptAt?: number;
    /** Número de tentativas consecutivas (para o backoff). */
    attempts?: number;
}

export type PurchaseActivationStatus = 'pending' | 'activated' | 'needs_manual' | 'expired';

export interface PurchaseActivationEvent {
    checkoutId: string;
    provider: PurchaseProvider;
    status: PurchaseActivationStatus;
    plan?: string;
    licenseKey?: string;
    error?: string;
}

/** Resultado normalizado de uma tentativa de poll. */
export type PollOutcome =
    | { kind: 'activated'; plan?: string }
    | { kind: 'pending' }
    | { kind: 'paid_needs_manual'; licenseKey?: string; error?: string }
    | { kind: 'refunded' }
    | { kind: 'transient'; error?: string };

const STORE_FILE = 'pending-purchases.json';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
const BASE_DELAY_MS = 3_000;
const MAX_DELAY_MS = 30_000;
const TICK_MS = 1_000;
/** Tentativas de ativação pós-pagamento antes de marcar needs_manual. */
const MAX_ACTIVATION_ATTEMPTS = 5;

/**
 * Backoff exponencial com jitter determinístico-testável:
 *   delay = min(BASE * 2^(attempt-1), CAP) * (1 ± JITTER)
 * Exportado puro para os testes (node:test contra dist-electron).
 */
export function computeBackoffMs(
    attempt: number,
    rand: () => number = Math.random,
): number {
    const exp = Math.min(BASE_DELAY_MS * Math.pow(2, Math.max(0, attempt - 1)), MAX_DELAY_MS);
    const jitter = 0.8 + rand() * 0.4; // ±20%
    return Math.round(exp * jitter);
}

/** Chave mascarada para logs — nunca vazar a licença completa. */
export function maskKey(key: string | undefined): string {
    if (!key || key.length < 16) return '***';
    return `${key.slice(0, 12)}…`;
}

export interface PurchaseActivationDeps {
    /** Fetch injetável (testes). */
    fetchImpl?: typeof fetch;
    /** Ativação de licença injetável (testes). Default: LicenseManager.activateLicense. */
    activateLicense?: (key: string) => Promise<{ success: boolean; error?: string }>;
    /** Poll do provider injetável (testes). */
    pollProvider?: (purchase: PendingPurchase) => Promise<PollOutcome>;
    /** Broadcast injetável (testes). Default: envia para todas as BrowserWindows. */
    broadcast?: (channel: string, payload: unknown) => void;
    /** Override do diretório userData (testes). */
    userDataPath?: string;
    /** Relógio injetável (testes). */
    now?: () => number;
    /** Intervalo do ticker injetável (testes usam valor curto). */
    tickMs?: number;
}

const API_BASE = process.env.REFRACT_API_BASE || 'https://api.refract.software';

export class PurchaseActivationServiceImpl {
    private pending = new Map<string, PendingPurchase>();
    private ticker: ReturnType<typeof setInterval> | null = null;
    private polling = new Set<string>();
    private storeLoaded = false;
    private manualRetries = new Map<string, number>();
    private deps: PurchaseActivationDeps;

    constructor(deps: PurchaseActivationDeps = {}) {
        this.deps = deps;
    }

    // ── Persistência ──────────────────────────────────────────────────────
    private storePath(): string {
        const base = this.deps.userDataPath ?? app.getPath('userData');
        return path.join(base, STORE_FILE);
    }

    private loadStore(): void {
        if (this.storeLoaded) return;
        this.storeLoaded = true;
        try {
            const raw = fs.readFileSync(this.storePath(), 'utf8');
            const list = JSON.parse(raw);
            if (Array.isArray(list)) {
                for (const p of list) {
                    if (p && typeof p.checkoutId === 'string' && typeof p.provider === 'string') {
                        this.pending.set(p.checkoutId, p);
                    }
                }
            }
        } catch {
            // arquivo ausente/corrompido — começa vazio (fail-safe)
        }
    }

    private persist(): void {
        try {
            const list = Array.from(this.pending.values());
            const file = this.storePath();
            fs.mkdirSync(path.dirname(file), { recursive: true });
            const tmp = `${file}.tmp`;
            fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
            fs.renameSync(tmp, file);
        } catch (err) {
            console.error('[PurchaseActivation] persist failed:', err);
        }
    }

    // ── API pública ───────────────────────────────────────────────────────

    /**
     * Registra/renova uma compra pendente e garante o ticker rodando.
     * Chamado pelo renderer logo após criar o checkout (fire-and-forget).
     */
    trackPurchase(input: {
        provider: PurchaseProvider;
        checkoutId: string;
        plan: string;
        email?: string;
    }): { ok: boolean; error?: string } {
        try {
            const checkoutId = String(input?.checkoutId || '');
            const provider = input?.provider;
            if (!checkoutId || (provider !== 'pix' && provider !== 'lemonsqueezy')) {
                return { ok: false, error: 'invalid_params' };
            }
            this.loadStore();
            const existing = this.pending.get(checkoutId);
            const entry: PendingPurchase = {
                provider,
                checkoutId,
                plan: String(input?.plan || 'monthly'),
                email: String(input?.email || existing?.email || ''),
                startedAt: existing?.startedAt ?? this.now(),
                nextAttemptAt: this.now(), // primeira tentativa imediata
                attempts: 0,
            };
            this.pending.set(checkoutId, entry);
            this.persist();
            this.ensureTicker();
            console.log(
                `[PurchaseActivation] event=checkout_tracked provider=${provider} checkout=${checkoutId} plan=${entry.plan}`,
            );
            return { ok: true };
        } catch (err: any) {
            console.error('[PurchaseActivation] trackPurchase failed:', err?.message);
            return { ok: false, error: err?.message || 'track_failed' };
        }
    }

    /** Cancela o acompanhamento (usuário cancelou o checkout na UI). */
    cancel(checkoutId: string): { ok: boolean } {
        this.loadStore();
        if (this.pending.delete(String(checkoutId || ''))) {
            this.persist();
        }
        if (this.pending.size === 0) this.stopTicker();
        return { ok: true };
    }

    /** Lista pendências (diagnóstico/suporte). Nunca inclui chaves. */
    list(): Array<PendingPurchase> {
        this.loadStore();
        return Array.from(this.pending.values()).map((p) => ({ ...p }));
    }

    /**
     * Retoma pendências no startup: recarrega o store, descarta expiradas
     * (>7 dias) e religa o ticker. Sobrevive a quit/crash/reload.
     */
    resume(): { resumed: number } {
        this.loadStore();
        const now = this.now();
        let resumed = 0;
        for (const [id, p] of Array.from(this.pending.entries())) {
            if (now - p.startedAt > MAX_AGE_MS) {
                this.pending.delete(id);
                this.emit({ checkoutId: id, provider: p.provider, status: 'expired', plan: p.plan });
            } else {
                p.nextAttemptAt = now;
                resumed++;
            }
        }
        this.persist();
        if (this.pending.size > 0) this.ensureTicker();
        if (resumed > 0) {
            console.log(`[PurchaseActivation] event=resume_resumed count=${resumed}`);
        }
        return { resumed };
    }

    /** Para o ticker (usado pelos testes e quando não há pendências). */
    stop(): void {
        this.stopTicker();
    }

    // ── Loop ──────────────────────────────────────────────────────────────

    private now(): number {
        return this.deps.now ? this.deps.now() : Date.now();
    }

    private ensureTicker(): void {
        if (this.ticker !== null) return;
        this.ticker = setInterval(() => this.tick(), this.deps.tickMs ?? TICK_MS);
    }

    private stopTicker(): void {
        if (this.ticker !== null) {
            clearInterval(this.ticker);
            this.ticker = null;
        }
    }

    private tick(): void {
        const now = this.now();
        for (const p of Array.from(this.pending.values())) {
            if (this.polling.has(p.checkoutId)) continue;
            const next = p.nextAttemptAt ?? 0;
            if (next <= now) {
                void this.pollOne(p);
            }
        }
        if (this.pending.size === 0) this.stopTicker();
    }

    private async pollOne(p: PendingPurchase): Promise<void> {
        if (this.polling.has(p.checkoutId)) return;
        this.polling.add(p.checkoutId);
        try {
            // Expiração por idade — deadline longo, mas existe (7 dias).
            if (this.now() - p.startedAt > MAX_AGE_MS) {
                this.finish(p, { status: 'expired', error: 'max_age_reached' });
                return;
            }

            p.attempts = (p.attempts ?? 0) + 1;
            const outcome = await (this.deps.pollProvider
                ? this.deps.pollProvider(p)
                : this.defaultPoll(p));

            switch (outcome.kind) {
                case 'activated': {
                    this.finish(p, { status: 'activated', plan: outcome.plan || p.plan });
                    return;
                }
                case 'paid_needs_manual': {
                    // Pagamento confirmou; só a ativação local falhou. Tenta de
                    // novo algumas vezes antes de entregar a chave manualmente.
                    p.attempts = 0;
                    const retries = (this.manualRetries.get(p.checkoutId) ?? 0) + 1;
                    this.manualRetries.set(p.checkoutId, retries);
                    if (retries >= MAX_ACTIVATION_ATTEMPTS) {
                        this.finish(p, {
                            status: 'needs_manual',
                            licenseKey: outcome.licenseKey,
                            error: outcome.error || 'activation_failed_repeatedly',
                        });
                        return;
                    }
                    break;
                }
                case 'refunded': {
                    this.finish(p, { status: 'expired', error: 'payment_refunded' });
                    return;
                }
                case 'pending':
                case 'transient':
                default:
                    break; // segue para o backoff abaixo
            }

            // Agenda a próxima tentativa com backoff + jitter.
            p.nextAttemptAt = this.now() + computeBackoffMs(Math.max(1, p.attempts));
            this.persist();
        } catch (err: any) {
            // Nunca deixar o ticker morrer.
            console.error('[PurchaseActivation] pollOne error:', err?.message);
            p.nextAttemptAt = this.now() + computeBackoffMs(Math.max(1, p.attempts ?? 1));
            this.persist();
        } finally {
            this.polling.delete(p.checkoutId);
        }
    }

    private finish(
        p: PendingPurchase,
        result: { status: PurchaseActivationStatus; plan?: string; licenseKey?: string; error?: string },
    ): void {
        this.pending.delete(p.checkoutId);
        this.manualRetries.delete(p.checkoutId);
        this.persist();
        if (this.pending.size === 0) this.stopTicker();

        const event: PurchaseActivationEvent = {
            checkoutId: p.checkoutId,
            provider: p.provider,
            status: result.status,
            plan: result.plan || p.plan,
            licenseKey: result.licenseKey,
            error: result.error,
        };
        this.emit(event);
        console.log(
            `[PurchaseActivation] event=activation_${result.status} provider=${p.provider} checkout=${p.checkoutId}` +
                (result.licenseKey ? ` key=${maskKey(result.licenseKey)}` : ''),
        );
    }

    private emit(event: PurchaseActivationEvent): void {
        try {
            const broadcast =
                this.deps.broadcast ??
                ((channel: string, payload: unknown) => {
                    for (const win of BrowserWindow.getAllWindows()) {
                        if (!win.isDestroyed()) win.webContents.send(channel, payload);
                    }
                });
            broadcast('purchase-activation-changed', event);
            if (event.status === 'activated') {
                broadcast('license-status-changed', { isPremium: true, plan: event.plan || 'monthly' });
            }
        } catch (err) {
            console.error('[PurchaseActivation] broadcast failed:', err);
        }
    }

    // ── Providers (caminho padrão de produção) ────────────────────────────

    private async defaultPoll(p: PendingPurchase): Promise<PollOutcome> {
        if (p.provider === 'pix') return this.pollPix(p.checkoutId);
        return this.pollLemonSqueezy(p.checkoutId);
    }

    /** PIX (AbacatePay via refract-api): GET /v1/checkout/:id/license */
    private async pollPix(checkoutId: string): Promise<PollOutcome> {
        try {
            const url = new URL(`${API_BASE}/v1/checkout/${encodeURIComponent(checkoutId)}/license`);
            const hwid = this.getRawDeviceId();
            if (hwid && hwid !== 'unknown') url.searchParams.set('hwid', hwid);

            const res = await (this.deps.fetchImpl ?? fetch)(url.toString(), {
                signal: AbortSignal.timeout(8_000),
            });
            if (!res.ok) return { kind: 'transient', error: `http_${res.status}` };

            const data = (await res.json().catch((): null => null)) as any;
            if (data?.status === 'refunded') return { kind: 'refunded' };
            if (data?.status === 'paid' && data?.license_key) {
                return this.activate(data.license_key, undefined);
            }
            return { kind: 'pending' };
        } catch (err: any) {
            return { kind: 'transient', error: err?.message || 'network_error' };
        }
    }

    /** LemonSqueezy: delega ao manager existente (mesmo contrato do IPC). */
    private async pollLemonSqueezy(checkoutId: string): Promise<PollOutcome> {
        try {
            const { LemonSqueezyManager } = require('./LemonSqueezyManager');
            const result = await LemonSqueezyManager.getInstance().pollLicense(checkoutId);
            if (result?.activated) return { kind: 'activated', plan: result.plan };
            if (result?.pending) return { kind: 'pending' };
            return { kind: 'transient', error: result?.error || 'poll_failed' };
        } catch (err: any) {
            return { kind: 'transient', error: err?.message || 'poll_failed' };
        }
    }

    private async activate(licenseKey: string, plan?: string): Promise<PollOutcome> {
        try {
            const activate =
                this.deps.activateLicense ??
                (async (key: string) => {
                    const { LicenseManager } = require('../../premium/electron/services/LicenseManager');
                    return LicenseManager.getInstance().activateLicense(String(key));
                });
            const result = await activate(licenseKey);
            if (result?.success) return { kind: 'activated', plan };
            return { kind: 'paid_needs_manual', licenseKey, error: result?.error };
        } catch (err: any) {
            return { kind: 'paid_needs_manual', licenseKey, error: err?.message || 'activation_error' };
        }
    }

    /** Mesmo padrão do LemonSqueezyManager: device-id cru persistido em userData. */
    private getRawDeviceId(): string {
        try {
            const base = this.deps.userDataPath ?? app.getPath('userData');
            const deviceIdPath = path.join(base, 'device-id');
            if (fs.existsSync(deviceIdPath)) {
                return fs.readFileSync(deviceIdPath, 'utf8').trim();
            }
        } catch {
            /* ignore */
        }
        return 'unknown';
    }
}

export const PurchaseActivationService = new PurchaseActivationServiceImpl();
