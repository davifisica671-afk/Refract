/**
 * settingsPassthroughHandlers.ts — whitelisted settings passthrough + folder picker.
 *
 * `get-setting` / `set-setting` expose a small, whitelisted surface of the
 * SettingsManager to the renderer. Today the only consumer is the coding
 * assistant's repo path (preload.getRepoPath / preload.setRepoPath), which
 * maps to the 'repoIndexerPath' key. Keys are restricted to the whitelist so
 * a compromised renderer can never read/write arbitrary (e.g. secret) settings.
 *
 * `dialog:selectFolder` opens a native directory picker (used by the Dev
 * Dashboard's "Browse" button).
 */
import { dialog } from 'electron';
import { SettingsManager } from '../services/SettingsManager';
import type { SafeHandle } from './safeIpc';

export function registerSettingsPassthroughHandlers(safeHandle: SafeHandle): void {
  const SETTINGS_WHITELIST: ReadonlySet<string> = new Set(['repoIndexerPath']);

  safeHandle('get-setting', (_event, key: string) => {
    if (!SETTINGS_WHITELIST.has(key)) return undefined;
    return SettingsManager.getInstance().get(key as any);
  });

  safeHandle('set-setting', (_event, key: string, value: unknown) => {
    if (!SETTINGS_WHITELIST.has(key)) return;
    SettingsManager.getInstance().set(key as any, value as any);
  });

  safeHandle('dialog:selectFolder', async () => {
    try {
      const result: any = await dialog.showOpenDialog({
        title: 'Select repository folder',
        properties: ['openDirectory'],
      });
      if (result.canceled || !result.filePaths.length) return null;
      return result.filePaths[0];
    } catch (err: any) {
      console.error('[IPC] dialog:selectFolder failed:', err);
      return null;
    }
  });
}
