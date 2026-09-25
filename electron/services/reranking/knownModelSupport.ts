// Stub (build recovery): known-broken local model registry.
// Degraded: nothing known-broken (null = "no verdict"). The call site guards
// with `known && !known.supported`, so null renders no warning.
export interface KnownModelSupport {
  supported: boolean;
  reason?: string;
}

export function lookupKnownModelSupport(_repo: string): KnownModelSupport | null {
  return null;
}
