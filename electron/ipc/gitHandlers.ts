/**
 * gitHandlers.ts — Git integration IPC (repository-aware coding context).
 *
 * Wraps the singleton GitService so the renderer can browse status, diffs,
 * branches and history of the user's local repository during interviews.
 */
import type { SafeHandle } from './safeIpc';

export function registerGitHandlers(safeHandle: SafeHandle): void {
  const { GitService } = require('../services/GitService');
  const gitService = GitService.getInstance();

  safeHandle('git:set-cwd', async (_event, dirPath: string | null) => {
    return gitService.setCwd(dirPath);
  });

  safeHandle('git:get-cwd', async () => {
    return { path: gitService.getCwd() };
  });

  safeHandle('git:status', async () => {
    try {
      return await gitService.getStatus();
    } catch (err: any) {
      return { error: err?.message || 'Git status failed', branch: '', ahead: 0, behind: 0, files: [], isDirty: false, isRebase: false, isMerge: false };
    }
  });

  safeHandle('git:diff', async (_event, filePath?: string) => {
    try {
      return await gitService.getDiff(filePath);
    } catch (err: any) {
      return [];
    }
  });

  safeHandle('git:log', async (_event, count?: number) => {
    try {
      return await gitService.getLog(count || 20);
    } catch (err: any) {
      return [];
    }
  });

  safeHandle('git:commit', async (_event, message: string, options?: { files?: string[]; amend?: boolean }) => {
    return await gitService.commit(message, options);
  });

  safeHandle('git:branches', async () => {
    try {
      return await gitService.getBranches();
    } catch (err: any) {
      return [];
    }
  });

  safeHandle('git:create-branch', async (_event, name: string) => {
    return await gitService.createBranch(name);
  });

  safeHandle('git:switch-branch', async (_event, name: string) => {
    return await gitService.switchBranch(name);
  });

  safeHandle('git:pull', async () => {
    return await gitService.pull();
  });

  safeHandle('git:push', async (_event, options?: { force?: boolean }) => {
    return await gitService.push(options);
  });

  safeHandle('git:stash', async (_event, message?: string) => {
    return await gitService.stash(message);
  });

  safeHandle('git:stash-pop', async () => {
    return await gitService.stashPop();
  });

  safeHandle('git:stash-drop', async () => {
    return await gitService.stashDrop();
  });

  safeHandle('git:repo-name', async () => {
    try {
      return await gitService.getRepoName();
    } catch (err: any) {
      return 'unknown';
    }
  });

  safeHandle('git:is-repository', async () => {
    return await gitService.isRepository();
  });

  safeHandle('git:open-in-file-manager', async () => {
    return await gitService.openInFileManager();
  });
}
