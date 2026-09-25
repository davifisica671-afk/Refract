// Stub (build recovery): ChatGPT OAuth (PKCE) service for Codex sign-in.
// Degraded: login THROWS (both call sites — `codex:start-login` and the
// legacy `codex-cli:login` action — catch into { success: false }), listeners
// are accepted and never fired, signOut is a noop. startLogin() is typed
// Promise<never> because the call sites read result.email /
// result.tokens.expiresAt, which a stub can never produce.
export type CodexLoginEvent = 'login:complete' | 'login:failed' | 'tokens:refreshed' | 'signed-out';

export interface CodexLoginResult {
  email: string | null;
  tokens: { expiresAt: string | null };
}

export class CodexOAuthService {
  private static instance: CodexOAuthService | null = null;

  private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

  static getInstance(): CodexOAuthService {
    if (!CodexOAuthService.instance) CodexOAuthService.instance = new CodexOAuthService();
    return CodexOAuthService.instance;
  }

  on(event: string, cb: (...args: unknown[]) => void): void {
    const list = this.listeners.get(event) ?? [];
    list.push(cb);
    this.listeners.set(event, list);
  }

  async startLogin(): Promise<never> {
    throw new Error('Codex login unavailable');
  }

  signOut(): void {}

  getStatus(): { configured: boolean } {
    return { configured: false };
  }
}
