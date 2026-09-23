// electron/services/OpencodeManager.ts
import { ChildProcess, spawn } from 'child_process';
import * as crypto from 'crypto';
import treeKill from 'tree-kill';

export const OPENCODE_PORT = 4097;
const OPENCODE_HOST = '127.0.0.1';

export interface EnsureResult { ok: boolean; managed: boolean; baseUrl: string; }

export class OpencodeManager {
  private static instance: OpencodeManager;
  private proc: ChildProcess | null = null;
  private isAppManaged = false;
  private password: string | null = null;

  private constructor() {}

  public static getInstance(): OpencodeManager {
    if (!OpencodeManager.instance) OpencodeManager.instance = new OpencodeManager();
    return OpencodeManager.instance;
  }

  public getBaseUrl(): string {
    return `http://${OPENCODE_HOST}:${OPENCODE_PORT}`;
  }

  public getAuthHeader(): string | null {
    if (!this.password) return null;
    return `Basic ${Buffer.from(`opencode:${this.password}`).toString('base64')}`;
  }

  public isManaged(): boolean {
    return this.isAppManaged;
  }

  public async ensureRunning(opts: { bin?: string } = {}): Promise<EnsureResult> {
    if (this.password && (await this.checkHealth(this.password))) {
      return { ok: true, managed: this.isAppManaged, baseUrl: this.getBaseUrl() };
    }
    if (await this.checkHealth(null)) {
      console.log('[OpencodeManager] port 4097 occupied by foreign server — not managed');
      return { ok: false, managed: false, baseUrl: this.getBaseUrl() };
    }
    const bin = opts.bin ?? 'opencode';
    this.password = crypto.randomBytes(24).toString('base64url');
    const child = this.trySpawn(bin);
    if (!child) {
      this.password = null;
      return { ok: false, managed: false, baseUrl: this.getBaseUrl() };
    }
    this.proc = child;
    this.isAppManaged = true;
    const ready = await this.pollReady(12, 1000);
    if (!ready) {
      this.stop();
      return { ok: false, managed: false, baseUrl: this.getBaseUrl() };
    }
    return { ok: true, managed: true, baseUrl: this.getBaseUrl() };
  }

  private trySpawn(bin: string): ChildProcess | null {
    try {
      const child = spawn(bin, ['serve', '--port', String(OPENCODE_PORT), '--hostname', OPENCODE_HOST], {
        windowsHide: true,
        stdio: 'ignore',
        shell: process.platform === 'win32',
        env: { ...process.env, OPENCODE_SERVER_PASSWORD: this.password ?? '' },
      });
      child.on('error', () => { this.proc = null; this.isAppManaged = false; });
      child.on('close', () => { if (this.proc === child) this.proc = null; });
      return child;
    } catch {
      return null;
    }
  }

  private async checkHealth(password: string | null): Promise<boolean> {
    try {
      const headers: Record<string, string> = {};
      if (password) headers['Authorization'] = `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`;
      const res = await fetch(`${this.getBaseUrl()}/global/health`, { signal: AbortSignal.timeout(2000), headers });
      if (!res.ok) return false;
      const data = (await res.json()) as { healthy?: boolean };
      return data.healthy === true;
    } catch {
      return false;
    }
  }

  private async pollReady(attempts: number, intervalMs: number): Promise<boolean> {
    for (let i = 0; i < attempts; i += 1) {
      if (await this.checkHealth(this.password)) return true;
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
  }

  public stop(): void {
    this.password = null;
    if (this.isAppManaged && this.proc && this.proc.pid) {
      const pid = this.proc.pid;
      this.proc = null;
      this.isAppManaged = false;
      try {
        treeKill(pid, 'SIGTERM', () => undefined);
      } catch {
        /* already gone */
      }
      return;
    }
    this.proc = null;
    this.isAppManaged = false;
  }
}
