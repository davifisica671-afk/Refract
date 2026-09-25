// Stub (build recovery): Google service-account key rejection explainer.
// Real pass-through logic (behavior-identical to intent): names the reason.
export function describeServiceAccountRejection(reason: string): string {
  return (
    `Google service account rejected (${reason || 'unknown reason'}). ` +
    'Select a valid service-account JSON with the Speech-to-Text API enabled.'
  );
}
