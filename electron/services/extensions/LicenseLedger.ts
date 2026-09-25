// Stub (build recovery): licence acknowledgement ledger.
// Degraded: nothing acknowledged; acknowledge() records nothing. Call sites
// pass (extensionId, modelKey, spdx).
export interface LicenseLedger {
  hasAcknowledged: (extensionId: string, modelKey: string, spdx: string) => boolean;
  acknowledge: (extensionId: string, modelKey: string, spdx: string) => void;
}

export function getLicenseLedger(): LicenseLedger {
  return {
    hasAcknowledged: () => false,
    acknowledge: () => undefined,
  };
}
