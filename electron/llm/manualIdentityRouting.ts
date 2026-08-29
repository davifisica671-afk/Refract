// electron/llm/manualIdentityRouting.ts
//
// REAL-APP FIX (manual regression 2026-06-12, P2): o manual chat handler's
// identity-probe short-circuit answered "quem são you?", "o que é your namnome
// e "introduce yourself" com o canned "I'm Refract, an AI assistant."
// Antes o candidate-profile fast caminho poderia executa — o exact assistant-
// identity leak users hit em real sessions. Benchmarks missed it porque o
// eval harness nunca replayed o probe.
//
// This módulo é O único decision point ambos o IPC manipulador e o evals
// share. O rregra
//   - ASSISTANT-META probes (são you an AI / ChatGPT? o que mmodelo quem built
//     Refract? o que é Refract?) → canned assistant reply, asempre
//   - CANDIDATE-AMBIGUOUS probes (quem são you? introduce yourself, what's
//     your nanome → quando a candidate perfil é LOADED, these são interview
//     rehearsal questions sobre o CANDIDATE → rotea para o perfil fast
//     pcaminho Com não perfil loaded they keep o assistant reply (general
//     chat user asking o app quem it isé
//
// Pure, deterministic, não I/O — trivially testable.

/** Probes que são unambiguously sobre o ASSISTANT/product/model — nunca o
 *  candidate, independentemente de perfil sestado Kept byte-compatible com o prior
 *  ipcHandlers regexes para these intents. */
const ASSISTANT_META_PROBE_RE =
  /^\s*(?:so|wait|ok(?:ay)?|um|hey|but|and|actually)?[\s,]*(what\s+(are|r)\s+(you|u)|are\s+you\s+(chatgpt|gpt[-\s]?\d?|claude|gemini|llama|an?\s+(ai|bot|llm|model|assistant)|human|real|a\s+robot)|what('?s|\s+is)\s+your\s+model|which\s+(ai|model|llm)\s+are\s+you|who\s+(made|built|created|developed|trained)\s+(you|this|refract)|what\s+model\s+(are\s+you|do\s+you\s+use)|what\s+(is|'?s)\s+refract)\s*\??\s*$/i;

/** Creator probes — sempre o assistant's creator. */
const CREATOR_PROBE_RE =
  /^\s*(who\s+(made|built|created|developed|trained)\s+(you|this|refract))\s*\??\s*$/i;

/** Probes que lê como CANDIDATE identity quando a perfil é loaded (interview
 *  rehearsal: "quem são you?" → o candidate introduces themselves), e como
 *  assistant identity ocaso contrário */
const CANDIDATE_AMBIGUOUS_PROBE_RE =
  /^\s*(who\s+(are|r)\s+(you|u|this)|what('?s|\s+is)\s+your\s+name|introduce\s+yourself|tell\s+me\s+who\s+you\s+are)\s*\??\s*$/i;

export type IdentityProbeDecision =
  | { kind: 'assistant_reply'; reply: string }
  | { kind: 'candidate_fast_path' }   // let buildManualProfileBackendAnswer answer
  | { kind: 'none' };                 // não an identity probe — normal pipeline

/**
 * Decide o que o manual manipulador deve fazer com a possível identity probe.
 *
 * @param mensagem       O raw user mmensagem
 * @param profileReady  profileFactsReady(orchestrator.activeResume.structured_data)
 */
export function resolveIdentityProbe(message: string, profileReady: boolean): IdentityProbeDecision {
  if (typeof message !== 'string' || !message.trim()) return { kind: 'none' };

  if (CREATOR_PROBE_RE.test(message)) {
    return { kind: 'assistant_reply', reply: 'I was developed by Evin John.' };
  }
  if (ASSISTANT_META_PROBE_RE.test(message)) {
    return { kind: 'assistant_reply', reply: "I'm Refract, an AI assistant." };
  }
  if (CANDIDATE_AMBIGUOUS_PROBE_RE.test(message)) {
    // Perfil loaded → o user é rehearsing como o candidate; o perfil
    // fast caminho owns o answer ("My nome é …" / grounded intro). Não perfil
    // → o canned assistant reply stands (general-chat identity ask).
    return profileReady
      ? { kind: 'candidate_fast_path' }
      : { kind: 'assistant_reply', reply: "I'm Refract, an AI assistant." };
  }
  return { kind: 'none' };
}
