/**
 * Pure helpers para overlay quick-action deduplication (unit-tested).
 * Previne duplicate LLM calls quando o mesmo ação fires twice dentro de a window.
 */

/** Normalizar ação keys para duplicate comparison. */
export function normalizeActionKey(actionKey) {
  return String(actionKey ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Retorna verdadeiro quando o mesmo ação chave era invoked dentro de windowMs.
 */
export function shouldDedupeOverlayAction({
  actionKey,
  lastActionKey,
  lastAtMs,
  nowMs,
  windowMs = 5000,
}) {
  const norm = normalizeActionKey(actionKey);
  if (!norm) return false;
  if (lastActionKey == null || lastAtMs == null) return false;
  if (nowMs - lastAtMs > windowMs) return false;
  return normalizeActionKey(lastActionKey) === norm;
}

/**
 * Colapsar consecutive system messages com identical text (UI último resort).
 */
export function collapseConsecutiveDuplicateSystemMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return messages;
  const out = [messages[0]];
  for (let i = 1; i < messages.length; i++) {
    const prev = out[out.length - 1];
    const cur = messages[i];
    if (
      prev.role === 'system' &&
      cur.role === 'system' &&
      prev.text === cur.text &&
      prev.intent === cur.intent
    ) {
      continue;
    }
    out.push(cur);
  }
  return out;
}
