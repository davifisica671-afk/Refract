// Stub (build recovery): provider status registry (TOP-level import).
// Degraded: no providers known; any single lookup is `unknown`.
export class ProviderStatusRegistry {
  private static instance: ProviderStatusRegistry | null = null;

  static getInstance(): ProviderStatusRegistry {
    if (!ProviderStatusRegistry.instance) {
      ProviderStatusRegistry.instance = new ProviderStatusRegistry();
    }
    return ProviderStatusRegistry.instance;
  }

  getAll(): unknown[] {
    return [];
  }

  getStatus(_id: string): { status: string } {
    return { status: 'unknown' };
  }
}
