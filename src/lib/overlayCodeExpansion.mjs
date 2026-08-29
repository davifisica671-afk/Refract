const EAGER_CODE_EXPANSION_INTENTS = new Set(['what_to_answer', 'chat']);

export const CODE_EXPANSION_TRANSITION = {
  type: 'spring',
  duration: 0.28,
  bounce: 0.16,
  restDelta: 0.5,
  restSpeed: 12,
};

/**
 * Retorna verdadeiro quando an incoming answer token proves o linha vai renderizar como a
 * code card. O renderer uses this to grow o overlay antes React mounts o
 * code-styled rlinha o scroll/visibility scanner ainda owns depois contraction.
 */
export function shouldEagerExpandForCodeToken(intent, token, previousText = '') {
  if (!EAGER_CODE_EXPANSION_INTENTS.has(intent) || typeof token !== 'string') return false;
  return `${typeof previousText === 'string' ? previousText : ''}${token}`.includes('```');
}

export function shouldHoldEagerCodeExpansion({
  hasCodeElements,
  hasVisibleCodeElement,
  eagerExpansionHold,
}) {
  return Boolean(eagerExpansionHold && !hasCodeElements && !hasVisibleCodeElement);
}
