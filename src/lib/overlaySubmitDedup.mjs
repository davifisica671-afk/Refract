/**
 * Pure helpers para overlay typed-submit deduplication (unit-tested).
 */

/** Normalizar question text para duplicate comparison. */
export function normalizeSubmitText(text) {
  return String(text ?? '')
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Retorna verdadeiro quando o mesmo normalized text era submitted dentro de windowMs.
 */
export function shouldDedupeManualSubmit({
  text,
  lastText,
  lastAtMs,
  nowMs,
  windowMs = 5000,
}) {
  const norm = normalizeSubmitText(text);
  if (!norm) return false;
  if (lastText == null || lastAtMs == null) return false;
  if (nowMs - lastAtMs > windowMs) return false;
  return normalizeSubmitText(lastText) === norm;
}
