/**
 * repoIndexerHandlers.ts — coding-assistant repository indexer IPC.
 *
 * Scans and queries a local code repository (chosen in the Dev Dashboard) so
 * the coding assistant can ground answers in the user's own codebase during
 * technical interviews.
 */
import { DatabaseManager } from '../db/DatabaseManager';
import type { SafeHandle } from './safeIpc';

export function registerRepoIndexerHandlers(safeHandle: SafeHandle): void {
  safeHandle('repo-index:scan', async (_event, repoPath: string) => {
    try {
      const { RepoIndexer } = require('../repo-indexer/RepoIndexer');
      const indexer = new RepoIndexer({
        repoPath,
        db: DatabaseManager.getInstance().getDb(),
        dbPath: DatabaseManager.getInstance().getDbPath(),
        extPath: DatabaseManager.getInstance().getExtPath(),
      });
      const result = await indexer.scanRepo();
      indexer.dispose();
      return { success: true, ...result };
    } catch (err: any) {
      console.error('[IPC] repo-index:scan failed:', err);
      return { success: false, error: err.message };
    }
  });

  safeHandle('repo-index:query', async (_event, query: string, topK?: number) => {
    try {
      const { RepoIndexer } = require('../repo-indexer/RepoIndexer');
      const { SettingsManager } = require('../services/SettingsManager');
      const sm = SettingsManager.getInstance();
      const repoPath = sm.get('repoIndexerPath') || '';
      if (!repoPath) return { success: false, error: 'No repo path configured' };
      const indexer = new RepoIndexer({
        repoPath,
        db: DatabaseManager.getInstance().getDb(),
        dbPath: DatabaseManager.getInstance().getDbPath(),
        extPath: DatabaseManager.getInstance().getExtPath(),
      });
      const results = await indexer.query(query, topK || 10);
      indexer.dispose();
      return { success: true, results };
    } catch (err: any) {
      console.error('[IPC] repo-index:query failed:', err);
      return { success: false, error: err.message };
    }
  });
}
