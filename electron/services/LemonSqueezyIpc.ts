/**
 * LemonSqueezyIpc — Registro dos handlers IPC do LemonSqueezy.
 *
 * Módulo AUTOCONTIDO: não altera nenhum arquivo existente. Para ativar,
 * basta chamar `registerLemonSqueezyHandlers()` uma vez no main process
 * (ex.: em electron/main.ts, após a inicialização do app).
 *
 * Handlers registrados:
 *   lemonsqueezy:create-checkout  → cria sessão de checkout e abre o navegador
 *   lemonsqueezy:poll-license      → consulta o backend até a licença estar pronta
 *
 * Notifica as janelas via 'license-status-changed' quando a licença é ativada,
 * seguindo o mesmo contrato já usado pelos handlers de licença existentes.
 */
import { ipcMain, BrowserWindow } from 'electron';
import { LemonSqueezyManager } from './LemonSqueezyManager';

export function registerLemonSqueezyHandlers(): void {
    ipcMain.handle('lemonsqueezy:create-checkout', async (event, params: { plan?: string; email?: string }) => {
        try {
            const plan = params?.plan === 'yearly' || params?.plan === 'lifetime' ? params.plan : 'monthly';
            const result = await LemonSqueezyManager.getInstance().createCheckout({
                plan,
                email: params?.email,
            });
            return result;
        } catch (err: any) {
            console.error('[LemonSqueezyIpc] create-checkout error:', err);
            return { success: false, error: 'LemonSqueezy checkout unavailable.' };
        }
    });

    ipcMain.handle('lemonsqueezy:poll-license', async (event, checkoutId: string) => {
        try {
            const result = await LemonSqueezyManager.getInstance().pollLicense(checkoutId);
            if (result?.activated) {
                BrowserWindow.getAllWindows().forEach((win) => {
                    if (!win.isDestroyed())
                        win.webContents.send('license-status-changed', {
                            isPremium: true,
                            plan: result.plan || 'monthly',
                        });
                });
            }
            return result;
        } catch (err: any) {
            console.error('[LemonSqueezyIpc] poll-license error:', err);
            return { success: false, error: 'LemonSqueezy poll unavailable.' };
        }
    });
}