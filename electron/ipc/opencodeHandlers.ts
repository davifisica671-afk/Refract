/**
 * opencodeHandlers.ts — Opencode service IPC (health, prompt, explain, generate, search).
 */
import type { SafeHandle } from './safeIpc';

export function registerOpencodeHandlers(safeHandle: SafeHandle): void {
  safeHandle('opencode:health', async () => {
    try {
      const { OpencodeService } = require('../services/OpencodeService');
      const svc = new OpencodeService();
      const connected = await svc.checkHealth();
      return { success: true, connected };
    } catch (err: any) {
      return { success: false, connected: false, error: err.message };
    }
  });

  safeHandle('opencode:prompt', async (_event, prompt: string) => {
    try {
      const { OpencodeService } = require('../services/OpencodeService');
      const svc = new OpencodeService();
      const result = await svc.executeTask(prompt);
      return result;
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  safeHandle('opencode:explain', async (_event, code: string, language: string) => {
    try {
      const { OpencodeService } = require('../services/OpencodeService');
      const svc = new OpencodeService();
      return await svc.explainCode(code, language);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  safeHandle('opencode:generate', async (_event, description: string, language: string) => {
    try {
      const { OpencodeService } = require('../services/OpencodeService');
      const svc = new OpencodeService();
      return await svc.generateCode(description, language);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  safeHandle('opencode:search', async (_event, query: string) => {
    try {
      const { OpencodeService } = require('../services/OpencodeService');
      const svc = new OpencodeService();
      return await svc.searchCode(query);
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}
