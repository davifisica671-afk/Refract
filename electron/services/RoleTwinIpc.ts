/**
 * RoleTwinIpc — Registro dos handlers IPC do Role Twin.
 *
 * Handlers registrados (canais kebab-case, mesma convenção de skills:/phone-mirror:):
 *   role-twin:list       → RoleTwin[]
 *   role-twin:get-active → RoleTwin | null
 *   role-twin:analyze    → { success, twin?, error? }
 *   role-twin:set-active → { success, error? }
 *   role-twin:delete     → { success, error? }
 *
 * Convenção safeHandle do ipcHandlers.ts: removeHandler antes de handle para
 * permitir re-registro (hot reload de dev) sem duplicar listeners.
 */
import { ipcMain } from 'electron';
import type { AppState } from '../main';
import { RoleTwinManager } from './RoleTwinManager';

export function registerRoleTwinHandlers(appState: AppState): void {
    const safeHandle = (channel: string, handler: (event: any, ...args: any[]) => any) => {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, handler);
    };

    const manager = RoleTwinManager.getInstance();
    manager.setAppState(appState);

    safeHandle('role-twin:list', async () => {
        try {
            return manager.list();
        } catch (err: any) {
            console.error('[RoleTwinIpc] list error:', err);
            return [];
        }
    });

    safeHandle('role-twin:get-active', async () => {
        try {
            return manager.getActive();
        } catch (err: any) {
            console.error('[RoleTwinIpc] get-active error:', err);
            return null;
        }
    });

    safeHandle(
        'role-twin:analyze',
        async (
            _,
            input: {
                id?: string;
                company?: string;
                roleTitle?: string;
                jobDescription?: string;
                forceResearch?: boolean;
            },
        ) => {
            try {
                return await manager.analyze({
                    id: input?.id,
                    company: input?.company || '',
                    roleTitle: input?.roleTitle || '',
                    jobDescription: input?.jobDescription || '',
                    forceResearch: input?.forceResearch === true,
                });
            } catch (err: any) {
                console.error('[RoleTwinIpc] analyze error:', err);
                return { success: false, error: err?.message || 'analysis_failed' };
            }
        },
    );

    safeHandle('role-twin:set-active', async (_, id: string | null) => {
        try {
            return manager.setActive(id);
        } catch (err: any) {
            console.error('[RoleTwinIpc] set-active error:', err);
            return { success: false, error: err?.message || 'set_active_failed' };
        }
    });

    safeHandle('role-twin:delete', async (_, id: string) => {
        try {
            return manager.delete(id);
        } catch (err: any) {
            console.error('[RoleTwinIpc] delete error:', err);
            return { success: false, error: err?.message || 'delete_failed' };
        }
    });
}
