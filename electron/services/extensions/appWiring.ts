// Stub (build recovery): extension system wiring.
// Degraded: no manager (every 'extensions:*' handler null-checks and reports
// extensions_unavailable).
export function getExtensionManager(): null {
  return null;
}
