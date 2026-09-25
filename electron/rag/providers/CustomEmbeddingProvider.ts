// Build-recovery stub: normalises a user-hosted base URL. Real pass-through
// logic (behaviour-identical): trim whitespace, strip trailing slashes so the
// space key is stable whether the user pasted the bare host or the /v1 form.
export function normalizeCustomBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '');
}
