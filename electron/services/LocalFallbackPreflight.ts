// Stub (build recovery): local-fallback preflight snapshot.
// Degraded: preflight unavailable (renderer treats this as "not checked").
// getLatestLocalFallbackPreflight is SYNC (handler returns it without await);
// runLocalFallbackPreflight is async (handler returns the promise).
export interface LocalFallbackPreflightState {
  checkedAt: number;
  status: string;
}

export function getLatestLocalFallbackPreflight(): LocalFallbackPreflightState {
  return { checkedAt: Date.now(), status: 'unavailable' };
}

export async function runLocalFallbackPreflight(_args: {
  ollamaSelected?: boolean;
}): Promise<LocalFallbackPreflightState> {
  return { checkedAt: Date.now(), status: 'unavailable' };
}
