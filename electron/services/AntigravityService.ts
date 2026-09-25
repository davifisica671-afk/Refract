// Stub (build recovery): Google Antigravity OAuth lifecycle + service.
// Degraded: never signed in, no models. startLogin() THROWS (both call sites
// treat it as failure: `antigravity:start-login` catches into
// { success: false }, the legacy login path catches into an error result),
// which is honest — returning { ok: false } without throwing would have the
// handler report success:true. signOut() reports not-available.
export interface AntigravityStatus {
  signedIn: boolean;
}

export interface AntigravityModel {
  id: string;
}

export function initializeAntigravityLifecycle(
  _app: unknown,
  _onUpdate?: (status: AntigravityStatus) => void,
  _onError?: () => void,
): void {}

export class AntigravityService {
  private static instance: AntigravityService | null = null;

  static getInstance(): AntigravityService {
    if (!AntigravityService.instance) AntigravityService.instance = new AntigravityService();
    return AntigravityService.instance;
  }

  getStatus(): AntigravityStatus {
    return { signedIn: false };
  }

  async getModels(_force?: boolean): Promise<AntigravityModel[]> {
    return [];
  }

  async startLogin(): Promise<void> {
    throw new Error('Antigravity login unavailable');
  }

  async cancelLogin(): Promise<void> {}

  async signOut(): Promise<{ success: boolean; error?: string }> {
    return { success: false, error: 'not-available' };
  }
}
