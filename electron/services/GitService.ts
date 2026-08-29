/**
 * GitService.ts - Serviço de integração Git
 * Fornece uma API de alto nível para operações Git comuns: status, diff, log,
 * commit, branches, stash, pull/push e abertura de repositórios.
 * Implementa o padrão Singleton para uso consistente em todo o aplicativo.
 */

import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs';

const execAsync = promisify(exec);

export interface GitFileStatus {
    path: string;
    status: 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'conflict';
    indexStatus: string;
    worktreeStatus: string;
}

export interface GitStatusResult {
    branch: string;
    ahead: number;
    behind: number;
    files: GitFileStatus[];
    isDirty: boolean;
    isRebase: boolean;
    isMerge: boolean;
}

export interface GitLogEntry {
    hash: string;
    shortHash: string;
    author: string;
    date: string;
    message: string;
}

export interface GitDiffResult {
    file: string;
    additions: number;
    deletions: number;
    patch: string;
}

export interface GitBranchInfo {
    name: string;
    isCurrent: boolean;
    isRemote: boolean;
    upstream?: string;
}

export interface GitCommitResult {
    success: boolean;
    hash?: string;
    error?: string;
}

export class GitService {
    private static instance: GitService;
    private cwd: string | null = null;

    static getInstance(): GitService {
        if (!GitService.instance) {
            GitService.instance = new GitService();
        }
        return GitService.instance;
    }

    /**
     * Define o diretório de trabalho para operações git.
     * Verifica se o diretório existe e é um repositório git válido.
     */
    setCwd(dirPath: string | null): { success: boolean; error?: string } {
        if (!dirPath) {
            this.cwd = null;
            return { success: true };
        }

        if (!fs.existsSync(dirPath)) {
            return { success: false, error: `Directory does not exist: ${dirPath}` };
        }

        // Verificar se é um repositório git
        try {
            const resolved = fs.realpathSync(dirPath);
            this.cwd = resolved;
            // Testar se é um repo git válido
            const stdout = execSync('git rev-parse --is-inside-work-tree', {
                cwd: this.cwd,
                encoding: 'utf-8',
                timeout: 5000,
            });
            if (!stdout.trim().includes('true')) {
                this.cwd = null;
                return { success: false, error: 'Directory is not a git repository' };
            }
            return { success: true };
        } catch (err: any) {
            this.cwd = null;
            return { success: false, error: `Not a git repository: ${err?.message || 'unknown error'}` };
        }
    }

    getCwd(): string | null {
        return this.cwd;
    }

    /**
     * Executa um comando git não diretório de trabalho atual.
     * Lança erro se nenhum diretório estiver configurado.
     */
    private async git(args: string): Promise<{ stdout: string; stderr: string }> {
        if (!this.cwd) {
            throw new Error('No git repository configured. Use git:set-cwd first.');
        }
        return execAsync(`git ${args}`, {
            cwd: this.cwd,
            maxBuffer: 10 * 1024 * 1024, // 10MB buffer para diffs grandes
            timeout: 30000,
            encoding: 'utf-8',
        });
    }

    /**
     * Verifica se o diretório atual é um repositório git válido.
     */
    async isRepository(): Promise<boolean> {
        if (!this.cwd) return false;
        try {
            const { stdout } = await this.git('rev-parse --is-inside-work-tree');
            return stdout.trim() === 'true';
        } catch {
            return false;
        }
    }

    /**
     * Retorna o status do repositório: branch, arquivos modificados, ahead/behind.
     */
    async getStatus(): Promise<GitStatusResult> {
        const { stdout: branchOutput } = await this.git('branch --show-current');
        const branch = branchOutput.trim() || 'HEAD detached';

        // Verificar ahead/behind
        let ahead = 0;
        let behind = 0;
        try {
            const { stdout: abOutput } = await this.git('rev-list --left-right --count HEAD...@{upstream}');
            const [a, b] = abOutput.trim().split('\t');
            ahead = parseInt(a, 10) || 0;
            behind = parseInt(b, 10) || 0;
        } catch {
            // Sem upstream configurado
        }

        // Verificar rebase/merge
        const isRebase = fs.existsSync(path.join(this.cwd, '.git', 'rebase-merge'))
            || fs.existsSync(path.join(this.cwd, '.git', 'rebase-apply'));
        const isMerge = fs.existsSync(path.join(this.cwd, '.git', 'MERGE_HEAD'));

        // Status dos arquivos
        const { stdout: statusOutput } = await this.git('status --porcelain=v1');
        const files: GitFileStatus[] = statusOutput
            .split('\n')
            .filter(line => line.trim().length > 0)
            .map(line => {
                const indexStatus = line.charAt(0);
                const worktreeStatus = line.charAt(1);
                const filePath = line.substring(3).trim();

                let status: GitFileStatus['status'] = 'modified';
                if (worktreeStatus === '?' || indexStatus === '?') {
                    status = 'untracked';
                } else if (indexStatus === 'A' || worktreeStatus === 'A') {
                    status = 'added';
                } else if (indexStatus === 'D' || worktreeStatus === 'D') {
                    status = 'deleted';
                } else if (indexStatus === 'R' || worktreeStatus === 'R') {
                    status = 'renamed';
                } else if (indexStatus === 'C' || worktreeStatus === 'C') {
                    status = 'copied';
                } else if (indexStatus === 'U' || worktreeStatus === 'U'
                    || indexStatus === 'A' && worktreeStatus === 'A') {
                    status = 'conflict';
                }

                return { path: filePath, status, indexStatus, worktreeStatus };
            });

        return {
            branch,
            ahead,
            behind,
            files,
            isDirty: files.length > 0,
            isRebase,
            isMerge,
        };
    }

    /**
     * Retorna o diff de arquivos específicos ou de todos os arquivos modificados.
     */
    async getDiff(filePath?: string): Promise<GitDiffResult[]> {
        const target = filePath ? `-- "${filePath}"` : '';
        const { stdout: diffOutput } = await this.git(`diff --stat ${target}`);

        const results: GitDiffResult[] = [];

        if (!filePath) {
            // Diff para todos os arquivos
            const { stdout: fullDiff } = await this.git(`diff ${target}`);
            // Parse estatísticas
            const statLines = diffOutput.split('\n').filter(l => l.includes('|'));
            for (const line of statLines) {
                const parts = line.split('|');
                const file = parts[0].trim();
                const stats = parts[1].trim();
                const additions = (stats.match(/\+/g) || []).length;
                const deletions = (stats.match(/-/g) || []).length;

                // Obter correção individual
                const { stdout: patch } = await this.git(`diff -- "${file}"`);
                results.push({ file, additions, deletions, patch });
            }

            // Adicionar arquivos untracked
            const { stdout: untracked } = await this.git('ls-files --others --exclude-standard');
            for (const file of untracked.split('\n').filter(f => f.trim())) {
                results.push({ file, additions: 0, deletions: 0, patch: '(new file)' });
            }
        } else {
            const { stdout: patch } = await this.git(`diff -- "${filePath}"`);
            const additions = (patch.match(/^\+[^+]/gm) || []).length;
            const deletions = (patch.match(/^-[^-]/gm) || []).length;
            results.push({ file: filePath, additions, deletions, patch });
        }

        return results;
    }

    /**
     * Retorna o registro de commits recentes.
     */
    async getLog(count: number = 20): Promise<GitLogEntry[]> {
        const { stdout } = await this.git(
            `log --oneline -${count} --format="%H|%h|%an|%ai|%s"`,
        );

        return stdout
            .split('\n')
            .filter(line => line.trim().length > 0)
            .map(line => {
                const [hash, shortHash, author, date, ...messageParts] = line.split('|');
                return {
                    hash,
                    shortHash,
                    author,
                    date,
                    message: messageParts.join('|'),
                };
            });
    }

    /**
     * Cria um commit com a mensagem especificada.
     * Se não houver arquivos especificados, faz commit de todos os staged files.
     */
    async commit(
        message: string,
        options?: { files?: string[]; amend?: boolean },
    ): Promise<GitCommitResult> {
        try {
            // Adicionar arquivos específicos ou todos
            if (options?.files && options.files.length > 0) {
                for (const file of options.files) {
                    await this.git(`add -- "${file}"`);
                }
            } else {
                await this.git('add -A');
            }

            // Criar commit usando --file para evitar injeção de comando via shell
            const amendFlag = options?.amend ? ' --amend' : '';
            const stdout = execSync(
                `git commit${amendFlag} -F -`,
                {
                    cwd: this.cwd!,
                    encoding: 'utf-8',
                    timeout: 30000,
                    input: message,
                },
            );

            // Extrair hash do commit
            const hashMatch = stdout.match(/\[[\w\d]+ ([a-f0-9]+)\]/);
            const hash = hashMatch?.[1] || '';

            return { success: true, hash };
        } catch (err: any) {
            return { success: false, error: err?.message || 'Commit failed' };
        }
    }

    /**
     * Lista branches locais e remotas.
     */
    async getBranches(): Promise<GitBranchInfo[]> {
        const { stdout } = await this.git('branch -a --format=%(refname:short)|%(HEAD)|%(upstream:short)');
        const branches: GitBranchInfo[] = [];

        for (const line of stdout.split('\n').filter(l => l.trim())) {
            const [name, isCurrent, upstream] = line.split('|');
            const isRemote = name.startsWith('origin/') || name.includes('remotes/');
            branches.push({
                name,
                isCurrent: isCurrent === '*',
                isRemote,
                upstream: upstream || undefined,
            });
        }

        return branches;
    }

    /**
     * Retorna o nome do repositório (baseado não diretório remoto ou caminho local).
     */
    async getRepoName(): Promise<string> {
        try {
            const { stdout } = await this.git('remote get-url origin');
            const url = stdout.trim();
            // Extrair nome do repo da URL
            const match = url.match(/[:/]([^/]+\/[^/]+?)(?:\.git)?$/);
            return match ? match[1] : path.basename(this.cwd || '');
        } catch {
            return path.basename(this.cwd || '');
        }
    }

    /**
     * Stash das mudanças atuais.
     */
    async stash(message?: string): Promise<{ success: boolean; error?: string }> {
        try {
            const msgFlag = message ? ` -m "${message.replace(/"/g, '\\"')}"` : '';
            await this.git(`stash${msgFlag}`);
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err?.message || 'Stash failed' };
        }
    }

    /**
     * Aplica o stash mais recente.
     */
    async stashPop(): Promise<{ success: boolean; error?: string }> {
        try {
            await this.git('stash pop');
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err?.message || 'Stash pop failed' };
        }
    }

    /**
     * Descarta o stash mais recente.
     */
    async stashDrop(): Promise<{ success: boolean; error?: string }> {
        try {
            await this.git('stash drop');
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err?.message || 'Stash drop failed' };
        }
    }

    /**
     * Cria uma nova branch.
     */
    async createBranch(name: string): Promise<{ success: boolean; error?: string }> {
        try {
            await this.git(`checkout -b "${name.replace(/"/g, '\\"')}"`);
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err?.message || 'Failed to create branch' };
        }
    }

    /**
     * Troca para uma branch existente.
     */
    async switchBranch(name: string): Promise<{ success: boolean; error?: string }> {
        try {
            await this.git(`checkout "${name.replace(/"/g, '\\"')}"`);
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err?.message || 'Failed to switch branch' };
        }
    }

    /**
     * Faz pull da branch remota.
     */
    async pull(): Promise<{ success: boolean; error?: string }> {
        try {
            await this.git('pull --ff-only');
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err?.message || 'Pull failed' };
        }
    }

    /**
     * Faz push da branch atual.
     */
    async push(options?: { force?: boolean }): Promise<{ success: boolean; error?: string }> {
        try {
            const forceFlag = options?.force ? ' --force-with-lease' : '';
            await this.git(`push${forceFlag}`);
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err?.message || 'Push failed' };
        }
    }

    /**
     * Abre o repositório não editor de código padrão do sistema.
     */
    /**
     * Abre o diretório do repositório não gerenciador de arquivos do sistema.
     */
    async openInFileManager(): Promise<{ success: boolean; error?: string }> {
        if (!this.cwd) {
            return { success: false, error: 'No git repository configured' };
        }
        try {
            if (process.platform === 'darwin') {
                execSync(`open "${this.cwd}"`, { timeout: 5000 });
            } else if (process.platform === 'win32') {
                execSync(`explorer "${this.cwd}"`, { timeout: 5000 });
            } else {
                execSync(`xdg-open "${this.cwd}"`, { timeout: 5000 });
            }
            return { success: true };
        } catch (err: any) {
            return { success: false, error: err?.message || 'Failed to open in file manager' };
        }
    }
}
