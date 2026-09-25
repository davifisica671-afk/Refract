// Stub (build recovery): hosted-reranker configuration + eligibility policy.
// READ-first surface (exact names from ipcHandlers.ts 8606-8609, 8614, 8798,
// 8875-8877, 8882, 8893, 9121, 9132):
// - evaluateHostedEligibility({ provider, hasApiKey, model, localOnly,
//   referenceFilesScopeAllowed, customEndpoint }) -> { eligible, reason? }
// - describeIneligibility(reason) -> message string
// - DEFAULT_RERANKER_SETTINGS.provider (fallback when nothing stored)
// - isLocalOnlyMode() / referenceFilesScopeAllowed() (privacy gates)
// - readHostedApiKey(provider) -> key or null (presence only downstream)
// - readHostedModel(stored) -> configured model or null
// - customRerankPrivacyBlock({ customEndpoint, localOnly,
//   referenceFilesScopeAllowed }) -> block code or null
// - resetLocalGgufPort() (called in try/catch; noop)
// - buildLocalGgufPort() -> port with rerank(), or null when the GGUF runtime
//   cannot be prepared (the activation path throws a clear error on null).
// Degraded: hosted reranking is never eligible (no keys exist in stub world),
// no privacy block is fabricated, the GGUF port is unavailable.
export interface HostedEligibilityInput {
  provider?: string;
  hasApiKey?: boolean;
  model?: string;
  localOnly?: boolean;
  referenceFilesScopeAllowed?: boolean;
  customEndpoint?: string;
}

export interface HostedEligibility {
  eligible: boolean;
  reason?: string;
}

export interface PrivacyBlockInput {
  customEndpoint?: string;
  localOnly?: boolean;
  referenceFilesScopeAllowed?: boolean;
}

export const DEFAULT_RERANKER_SETTINGS: { provider: string } = { provider: 'local' };

export function evaluateHostedEligibility(_input: HostedEligibilityInput): HostedEligibility {
  return { eligible: false, reason: 'not-available' };
}

export function describeIneligibility(reason: string): string {
  return reason
    ? `Reranking is unavailable (${reason}).`
    : 'Reranking is unavailable.';
}

export function isLocalOnlyMode(): boolean {
  return false;
}

export function referenceFilesScopeAllowed(): boolean {
  return false;
}

export function readHostedApiKey(_provider: string): string | null {
  return null;
}

export function readHostedModel(_stored: unknown): string | null {
  return null;
}

export function customRerankPrivacyBlock(_input: PrivacyBlockInput): string | null {
  return null;
}

export function resetLocalGgufPort(): void {}

export function buildLocalGgufPort(): null {
  return null;
}
