/**
 * PurchaseActivationIpc — Registro dos handlers IPC do serviço de ativação
 * de compras (main process é o dono do ciclo de ativação).
 *
 * Módulo AUTOCONTIDO: não altera nenhum arquivo existente. Para ativar,
 * chame `registerPurchaseActivationHandlers()` uma vez no main process e
 * `PurchaseActivationService.resume()` no startup. Para reverter, remova
 * as duas chamadas — nenhum handler antigo depende deste módulo.
 *
 * Handlers registrados:
 *   purchase-activation:track   → renderer registra um checkout recém-criado
 *   purchase-activation:cancel  → renderer cancela o acompanhamento
 *   purchase-activation:list    → diagnóstico/suporte (sem chaves)
 *
 * Eventos enviados às janelas:
 *   'purchase-activation-changed' → { checkoutId, provider, status, plan?, licenseKey?, error? }
 *   'license-status-changed'      → { isPremium: true, plan } (quando ativado)
 */
import { ipcMain } from 'electron';
import { PurchaseActivationService } from './PurchaseActivationService';

export function registerPurchaseActivationHandlers(): void {
    ipcMain.handle(
        'purchase-activation:track',
        async (_event, params: { provider?: string; checkoutId?: string; plan?: string; email?: string }) => {
            try {
                const provider = params?.provider === 'lemonsqueezy' ? 'lemonsqueezy' : 'pix';
                return PurchaseActivationService.trackPurchase({
                    provider,
                    checkoutId: String(params?.checkoutId || ''),
                    plan: String(params?.plan || 'monthly'),
                    email: params?.email ? String(params.email) : undefined,
                });
            } catch (err: any) {
                console.error('[PurchaseActivationIpc] track error:', err?.message);
                return { ok: false, error: err?.message || 'track_failed' };
            }
        },
    );

    ipcMain.handle('purchase-activation:cancel', async (_event, checkoutId: string) => {
        try {
            return PurchaseActivationService.cancel(String(checkoutId || ''));
        } catch (err: any) {
            console.error('[PurchaseActivationIpc] cancel error:', err?.message);
            return { ok: false };
        }
    });

    ipcMain.handle('purchase-activation:list', async () => {
        try {
            return { ok: true, pending: PurchaseActivationService.list() };
        } catch (err: any) {
            console.error('[PurchaseActivationIpc] list error:', err?.message);
            return { ok: false, pending: [] };
        }
    });
}
