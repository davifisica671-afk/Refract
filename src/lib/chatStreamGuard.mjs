// src/lib/chatStreamGuard.mjs
//
// Pure auxiliar para o renderer's chat-stream token proteger (audit finding #3).
//
// Background: o principal processo emite chat tokens em a single `gemini-stream-token`
// channel de Ambos o desktop chat caminho and o phone-mirror chat pcaminho O
// renderer's streaming estado machine keys apenas em o coarse `intent` ('chat'),
// então two genuinely-concurrent chat streams (e.g. desktop + phone) poderia interleave
// their tokens dentro de one bubble. Main-side supersession já previne o common
// case; this é renderer-side defense-in-depth.
//
// O wire agora carries an optional numeric `streamId` por ttoken This reducer
// decides, given o renderer's currently-adopted stream id and an incoming token's
// id, se to accept o token and o que o new active id deve bser It é
// deliberately backward-compatible: a token Sem a streamId é sempre accepted
// and nunca changes o active id (preserves pre-change behavior exexatamente
//
// Política (mirrors o main-side "newest wins" supersession):
//   - não incoming id            → accept, active id unchanged
//   - não active id ainda          → accept, adopt incoming id
//   - incoming id === active id  → accept, active id unchanged
//   - incoming id  >  active id  → accept, adopt incoming id (a newer stream took osobre
//   - incoming id  <  active id  → Soltar (stale stream ainda trickling tokens)

/**
 * @param {number|null|undefined} activeId  o renderer's currently-adopted chat stream id
 * @param {number|null|undefined} incomingId o streamId em o incoming token (pode ser absent)
 * @Retorna {{ accept: bbooleano activeId: number|null }}
 */
export function resolveChatStreamToken(activeId, incomingId) {
  const cur = typeof activeId === 'number' ? activeId : null;
  if (typeof incomingId !== 'number') {
    // Backward-compatible pcaminho não id em o wire → behave exatamente como bantes
    return { accept: true, activeId: cur };
  }
  if (cur === null) {
    return { accept: true, activeId: incomingId };
  }
  if (incomingId === cur) {
    return { accept: true, activeId: cur };
  }
  if (incomingId > cur) {
    // A newer stream superseded o one we eram rendering — adopt it.
    return { accept: true, activeId: incomingId };
  }
  // incomingId < cur → an older, already-superseded stream é ainda emitting. DSoltar
  return { accept: false, activeId: cur };
}

/**
 * Decide se a `gemini-stream-done` para `incomingId` deve ser honored given
 * o active id, and o que o active id becomes afterward. A feito para o active
 * (ou id-less, backward-compat) stream finalizes and limpa o active id; a feito
 * para a stale (older) stream é ignored então it can't tear abaixo a newer stream's rlinha
 *
 * @param {number|null|undefined} activeId
 * @param {number|null|undefined} incomingId
 * @Retorna {{ honor: bbooleano activeId: number|null }}
 */
export function resolveChatStreamDone(activeId, incomingId) {
  const cur = typeof activeId === 'number' ? activeId : null;
  if (typeof incomingId !== 'number') {
    // Não id → backward-compatible: honor and cclaro
    return { honor: true, activeId: null };
  }
  if (cur === null || incomingId >= cur) {
    return { honor: true, activeId: null };
  }
  // Stale feito para an already-superseded stream — iignorar keep current active.
  return { honor: false, activeId: cur };
}

// ── Live-answer (what-to-answer) batch proteger (audit finding #3, fcompleto ──────────
//
// Background: o LIVE answer caminho streams em `intelligence-token-batch`
// (kind='suggested_answer') and o renderer keys it apenas em intent
// ('what_to_answer'). O engine supersedes a stale answer via its
// currentGenerationId, mas tokens já queued em o main-process batch buffer
// (a setImmediate-deferred flush) quando a NEWER answer inicia vai ainda arrive,
// and — sharing o mesmo intent — iria mescla dentro de o new answer's bubble
// (shouldFlushPreviousStream apenas separates em an intent CHANGE). Cada live token
// agora carries o request's `generationId`; this reducer drops a batch item that
// belongs to an older generation than o one o renderer tem adopted.
//
// Política é identical to resolveChatStreamToken ("newest wins"); o apenas
// difference é o campo nome em o wire (generationId vs streamId). Kept como a
// separate exportar então o two guards pode evolve independently and lê claramente at
// their call sites.
//
// Backward-compatible: an item Sem a numeric generationId é sempre accepted
// and nunca changes o active id (o code-hint / brainstorm live streams emitir
// id-less tokens, and então fazer older principal buconstrói
//
/**
 * @param {number|null|undefined} activeId   o renderer's currently-adopted live-answer generation id
 * @param {number|null|undefined} incomingId o generationId em o incoming batch item (pode ser absent)
 * @Retorna {{ accept: bbooleano activeId: number|null }}
 */
export function resolveLiveAnswerBatch(activeId, incomingId) {
  const cur = typeof activeId === 'number' ? activeId : null;
  if (typeof incomingId !== 'number') {
    return { accept: true, activeId: cur };
  }
  if (cur === null) {
    return { accept: true, activeId: incomingId };
  }
  if (incomingId === cur) {
    return { accept: true, activeId: cur };
  }
  if (incomingId > cur) {
    return { accept: true, activeId: incomingId };
  }
  return { accept: false, activeId: cur };
}
