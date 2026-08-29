/**
 * LemonSqueezyManager — Integração de checkout LemonSqueezy (lado cliente).
 *
 * Fluxo:
 *   1. createCheckout() → pede ao backend refract-api uma URL de checkout
 *      (o backend cria a sessão no LemonSqueezy e devolve a URL).
 *   2. O usuário paga no checkout hospedado do LemonSqueezy.
 *   3. O LemonSqueezy envia webhook ao backend → o backend emite uma licença
 *      assinada (formato REFRACT-PRO) e a associa ao checkout.
 *   4. pollLicense() → o app consulta o backend até a licença estar pronta,
 *      então ativa via LicenseManager.
 *
 * Se o backend ainda não tiver o endpoint de checkout (fase de rollout),
 * createCheckout() cai num fallback: abre a URL de checkout direto do
 * LemonSqueezy (configurável via env LEMONSQUEEZY_CHECKOUT_URL).
 *
 * Contrato consumido por electron/ipcHandlers.ts:
 *   getInstance(), createCheckout({plan, email}), pollLicense(checkoutId)
 */
import { app, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const API_BASE = process.env.REFRACT_API_BASE || 'https://api.refract.software';
// Fallback: URL de checkout direto do LemonSqueezy (produto configurado no painel).
const LS_CHECKOUT_URL =
    process.env.LEMONSQUEEZY_CHECKOUT_URL || 'https://refract.lemonsqueezy.com/buy';

export interface LemonSqueezyCheckoutParams {
    plan: 'monthly' | 'yearly' | 'lifetime';
    email?: string;
}

export interface LemonSqueezyCheckoutResult {
    success: boolean;
    checkoutId?: string;
    checkoutUrl?: string;
    error?: string;
}

export interface LemonSqueezyPollResult {
    success: boolean;
    activated?: boolean;
    pending?: boolean;
    /** Plano associado à licença ativada ('monthly' | 'yearly' | 'lifetime'). */
    plan?: 'monthly' | 'yearly' | 'lifetime';
    error?: string;
}

export class LemonSqueezyManager {
    private static _instance: LemonSqueezyManager | null = null;

    private constructor() {}

    public static getInstance(): LemonSqueezyManager {
        if (!LemonSqueezyManager._instance) {
            LemonSqueezyManager._instance = new LemonSqueezyManager();
        }
        return LemonSqueezyManager._instance;
    }

    // ------------------------------------------------------------- checkout

    /**
     * Cria um checkout LemonSqueezy. Tenta o endpoint do backend primeiro;
     * se indisponível, cai no fallback de URL direta.
     */
    public async createCheckout(params: LemonSqueezyCheckoutParams): Promise<LemonSqueezyCheckoutResult> {
        try {
            const res = await fetch(`${API_BASE}/v1/checkout/lemonsqueezy`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    plan: params.plan,
                    email: params.email || '',
                    hwid: this.getHardwareId(),
                }),
                signal: AbortSignal.timeout(8000),
            });

            if (res.ok) {
                const data = (await res.json().catch((): null => null)) as any;
                if (data?.checkout_id && data?.checkout_url) {
                    return {
                        success: true,
                        checkoutId: String(data.checkout_id),
                        checkoutUrl: String(data.checkout_url),
                    };
                }
            }
            // Backend sem endpoint ainda — fallback para URL direta.
            return this.fallbackCheckout(params);
        } catch {
            // Offline ou backend fora — fallback para URL direta.
            return this.fallbackCheckout(params);
        }
    }

    /**
     * Fallback: abre a URL de checkout direto do LemonSqueezy.
     * Sem checkoutId rastreável, o usuário ativa a licença colando a chave
     * (enviada por e-mail pelo LemonSqueezy) — fluxo manual.
     */
    private async fallbackCheckout(params: LemonSqueezyCheckoutParams): Promise<LemonSqueezyCheckoutResult> {
        try {
            const url = new URL(LS_CHECKOUT_URL);
            if (params.plan === 'yearly') url.searchParams.set('checkout[discount_code]', 'YEARLY');
            if (params.email) url.searchParams.set('checkout[email]', params.email);
            await shell.openExternal(url.toString());
            return { success: true, checkoutUrl: url.toString() };
        } catch (err: any) {
            return { success: false, error: err?.message || 'failed_to_open_checkout' };
        }
    }

    // ------------------------------------------------------------- polling

    /**
     * Consulta o backend até a licença estar pronta para o checkout.
     * Retorna pending=true enquanto o pagamento não é confirmado.
     */
    public async pollLicense(checkoutId: string): Promise<LemonSqueezyPollResult> {
        if (!checkoutId) return { success: false, error: 'missing_checkout_id' };
        try {
            // hwid como fator de verificação server-side: o endpoint recusa
            // entregar a licença para quem não criou o checkout.
            const pollUrl = new URL(`${API_BASE}/v1/checkout/${encodeURIComponent(checkoutId)}/license`);
            const hwid = this.getHardwareId();
            if (hwid && hwid !== 'unknown') pollUrl.searchParams.set('hwid', hwid);

            const res = await fetch(pollUrl.toString(), {
                signal: AbortSignal.timeout(8000),
            });
            if (!res.ok) return { success: false, error: `poll_failed_${res.status}` };

            const data = (await res.json().catch((): null => null)) as any;
            if (data?.license_key) {
                // Ativa a licença assinada via LicenseManager.
                // Caminho relativo a electron/services/ — o arquivo real vive em
                // premium/electron/services/ na raiz do repo (e em
                // dist-electron/premium/... após o build).
                const { LicenseManager } = require('../../premium/electron/services/LicenseManager');
                const result = await LicenseManager.getInstance().activateLicense(String(data.license_key));
                if (result?.success) {
                    const plan =
                        data.plan === 'yearly' || data.plan === 'lifetime' ? data.plan : 'monthly';
                    return { success: true, activated: true, plan };
                }
                return { success: false, error: result?.error || 'activation_failed' };
            }
            if (data?.status === 'pending' || data?.status === 'open') {
                return { success: true, pending: true };
            }
            return { success: false, error: 'license_not_ready' };
        } catch (err: any) {
            return { success: false, error: err?.message || 'network_error' };
        }
    }

    // ------------------------------------------------------------- helpers

    /** ID estável do dispositivo (mesmo padrão do LicenseManager). */
    private getHardwareId(): string {
        try {
            const deviceIdPath = path.join(app.getPath('userData'), 'device-id');
            if (fs.existsSync(deviceIdPath)) {
                return fs.readFileSync(deviceIdPath, 'utf8').trim();
            }
        } catch {
            /* ignore */
        }
        return 'unknown';
    }
}