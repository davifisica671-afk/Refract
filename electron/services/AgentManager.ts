/**
 * =============================================================================
 * AgentManager.ts — FASE 4: AGENTE AUTÔNOMO COM GUARDA-CORPO (SANDBOX)
 * =============================================================================
 *
 * Permite que a IA execute ações no computador do usuário:
 * - read_file: Leitura segura (capped a 512KB, sem aprovação)
 * - edit_file: Escrita em disco (requer aprovação UI)
 * - run_command: Execução de shell (requer aprovação UI, blocklist de comandos)
 * - open_file: Abre no app padrão do SO (requer aprovação UI)
 *
 * SEGURANÇA:
 * - Ações destrutivas bloqueiam até aprovação explícita do usuário via IPC modal
 * - Pending actions auto-expiram em 60s (previne memory leak)
 * - Comandos passam por blocklist básica (rm -rf, format, del /s, etc.)
 * - Leitura de arquivo limitada a 512KB para prevenir OOM
 * - IDs criptográficos (crypto.randomUUID) para prevenir colisão
 * =============================================================================
 */

import fs from 'fs';
import { exec } from 'child_process';
import util from 'util';
import crypto from 'crypto';
import { BrowserWindow, shell } from 'electron';

const execAsync = util.promisify(exec);

/** Maximum file size readable via agent (512KB). */
const MAX_READ_BYTES = 512 * 1024;

/** Auto-expire pending actions after this many ms. */
const ACTION_TTL_MS = 60_000;

/** Commands that are never allowed regardless of user approval. */
const COMMAND_BLOCKLIST: ReadonlyArray<RegExp> = [
    /\brm\s+(-rf?|--recursive)\s+[\/\\]/i,
    /\bformat\b.*[A-Z]:/i,
    /\bdel\s+\/[sS]/i,
    /\bmkfs\b/i,
    /\bdd\s+if=/i,
    /\b(shutdown|reboot|halt)\b/i,
];

export type AgentActionType = 'read_file' | 'edit_file' | 'run_command' | 'open_file';

export type AgentAction =
    | { type: 'read_file'; path: string }
    | { type: 'edit_file'; path: string; content: string }
    | { type: 'run_command'; command: string; cwd?: string }
    | { type: 'open_file'; path: string };

interface PendingAction {
    resolve: (result: string) => void;
    reject: (err: Error) => void;
    action: AgentAction;
    expiresAt: number;
}

export class AgentManager {
    private static instance: AgentManager;
    private mainWindow: BrowserWindow | null = null;
    private pendingActions = new Map<string, PendingAction>();
    private gcTimer: ReturnType<typeof setInterval> | null = null;

    private constructor() {
        // Sweep expired pending actions every 15s
        this.gcTimer = setInterval(() => this.sweepExpired(), 15_000);
    }

    public static getInstance(): AgentManager {
        if (!AgentManager.instance) {
            AgentManager.instance = new AgentManager();
        }
        return AgentManager.instance;
    }

    public setMainWindow(window: BrowserWindow): void {
        this.mainWindow = window;
    }

    // ── Public API ──────────────────────────────────────────────────────────

    /** Proposes an action. Read is auto-approved; destructive actions require UI confirmation. */
    public async proposeAction(action: AgentAction): Promise<string> {
        if (action.type === 'read_file') {
            return this.executeReadFile(action.path);
        }

        if (action.type === 'run_command' && this.isBlockedCommand(action.command)) {
            return `BLOCKED: Command "${action.command}" is on the security blocklist and cannot be executed.`;
        }

        return new Promise<string>((resolve, reject) => {
            const actionId = crypto.randomUUID();
            const pending: PendingAction = {
                resolve,
                reject,
                action,
                expiresAt: Date.now() + ACTION_TTL_MS,
            };
            this.pendingActions.set(actionId, pending);

            if (this.mainWindow && !this.mainWindow.isDestroyed()) {
                this.mainWindow.webContents.send('agent:request_approval', { actionId, action });
            } else {
                this.pendingActions.delete(actionId);
                reject(new Error('Main window not attached. Cannot request user approval.'));
            }
        });
    }

    /** Called via IPC when the user clicks "Approve". */
    public async approveAction(actionId: string): Promise<void> {
        const pending = this.pendingActions.get(actionId);
        if (!pending) throw new Error('Action not found or already expired.');

        this.pendingActions.delete(actionId);

        if (Date.now() > pending.expiresAt) {
            pending.resolve('Action expired before approval was received.');
            return;
        }

        try {
            const result = await this.executeAction(pending.action);
            pending.resolve(result);
        } catch (error: any) {
            pending.reject(error instanceof Error ? error : new Error(String(error)));
        }
    }

    /** Called via IPC when the user clicks "Reject". */
    public rejectAction(actionId: string): void {
        const pending = this.pendingActions.get(actionId);
        if (!pending) return;
        this.pendingActions.delete(actionId);
        pending.resolve('User rejected the action.');
    }

    public dispose(): void {
        if (this.gcTimer) clearInterval(this.gcTimer);
        this.gcTimer = null;
        // Resolve all pending as rejected
        for (const [, pending] of this.pendingActions) {
            pending.resolve('AgentManager disposed.');
        }
        this.pendingActions.clear();
    }

    // ── Internals ───────────────────────────────────────────────────────────

    private async executeAction(action: AgentAction): Promise<string> {
        switch (action.type) {
            case 'edit_file': {
                await fs.promises.writeFile(action.path, action.content, 'utf8');
                return `File ${action.path} successfully updated.`;
            }
            case 'run_command': {
                const { stdout, stderr } = await execAsync(action.command, {
                    cwd: action.cwd,
                    timeout: 30_000, // Hard 30s timeout for any shell command
                    maxBuffer: 1024 * 1024, // 1MB output cap
                });
                return stdout || stderr || 'Command executed successfully with no output.';
            }
            case 'open_file': {
                // Sem shell: shell.openPath delega ao SO sem interpretar
                // metacaracteres (mesma classe de correção do GitService F-03).
                // run_command continua sendo shell intencional (aprovado na UI).
                if (typeof action.path !== 'string' || !action.path || action.path.includes('\0')) {
                    throw new Error('Invalid path');
                }
                const error = await shell.openPath(action.path);
                if (error) throw new Error(error);
                return `File ${action.path} opened.`;
            }
            default:
                return 'Unknown action type.';
        }
    }

    private async executeReadFile(filePath: string): Promise<string> {
        try {
            const stat = await fs.promises.stat(filePath);
            if (stat.size > MAX_READ_BYTES) {
                return `File too large (${(stat.size / 1024).toFixed(0)}KB). Maximum is ${MAX_READ_BYTES / 1024}KB.`;
            }
            return await fs.promises.readFile(filePath, 'utf8');
        } catch (error: any) {
            return `Failed to read file: ${error.message}`;
        }
    }

    private isBlockedCommand(command: string): boolean {
        return COMMAND_BLOCKLIST.some(pattern => pattern.test(command));
    }

    private sweepExpired(): void {
        const now = Date.now();
        for (const [id, pending] of this.pendingActions) {
            if (now > pending.expiresAt) {
                this.pendingActions.delete(id);
                pending.resolve('Action expired (60s timeout without user approval).');
            }
        }
    }
}
