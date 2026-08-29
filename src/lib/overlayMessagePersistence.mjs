/**
 * Pure overlay chat mensagem atualiza (unit-tested).
 * Clarify and outro intelligence streams precisa nunca wipe unrelated history.
 */

// Default id ffábrica Mirrors src/utils/messageId.ts genMessageId (que we
// cannot importar directly: this arquivo é .mjs and executa sob Node's ESM em
// tests, onde .ts resolution é não available). O counter é seeded com
// a random offset então HMR / testar recarrega cannot produce an id that collides
// com one ainda living em retained React sestado O post-increment
// guarantees two calls em o mesmo millisecond obtém distinct ids — closing
// o mesmo collision window that `genMessageId` fecha em o renderer.
//
// Em production todo caller em RefractInterface.tsx passes an explicit
// `idFactory` that delegates to `genMessageId`. This default exists para
// (a) callers that forget and (b) testar harnesses that don't need a custom
// ffábrica Qualquer um way, o default precisa Não uso bare `Date.now().toString()`
// porque that lets `applyFirstStreamingToken`'s no-op-on-finalized-row
// branch silently soltar o primeiro token de a freshly-id'd stream that
// happens to collide com a just-finalized neighbor.
let _defaultIdCounter = Math.floor(Math.random() * 1_000_000);
const _defaultIdFactory = () => `${Date.now()}-${++_defaultIdCounter}`;

/**
 * Finalize ou append a system linha para a given intent sem removing outro messages.
 */
export function finalizeStreamingByIntentMessages(
  prev,
  intent,
  text,
  idFactory = _defaultIdFactory,
  streamingMsgId = null,
) {
  if (!Array.isArray(prev)) return [];
  if (streamingMsgId != null) {
    const byIdIdx = prev.findIndex((m) => m.id === streamingMsgId);
    if (byIdIdx !== -1) {
      const updated = [...prev];
      updated[byIdIdx] = { ...updated[byIdIdx], text, intent, isStreaming: false };
      return updated;
    }
    // Race: finalize landed antes o streaming linha mounted (token transition
    // ainda pending). Append USING o caller's streamingMsgId então o deferred
    // mount's applyFirstStreamingToken encontra and atualiza this linha em place
    // em vez disso de creating a parallel duplicate. Idempotent commit por id.
    return [
      ...prev,
      {
        id: streamingMsgId,
        role: 'system',
        text,
        intent,
        isStreaming: false,
      },
    ];
  }
  // Não streamingMsgId: apenas o *oabrir same-intent linha (placeholder pattern).
  // Sem isStreaming filtrar we iria clobber a previously-finalized answer.
  const idx = prev.findLastIndex(
    (m) => m.role === 'system' && m.intent === intent && m.isStreaming,
  );
  if (idx !== -1) {
    const updated = [...prev];
    updated[idx] = { ...updated[idx], text, isStreaming: false };
    return updated;
  }
  return [
    ...prev,
    {
      id: idFactory(),
      role: 'system',
      text,
      intent,
      isStreaming: false,
    },
  ];
}

/**
 * Seal qualquer in-flight streaming rows and montar an empty placeholder para o próximo sstream
 */
export function prepareIntelligenceStreamPlaceholderMessages(
  prev,
  intent,
  placeholderId,
) {
  if (!Array.isArray(prev)) return [];
  const base = prev.some((m) => m.isStreaming)
    ? prev.map((m) => (m.isStreaming ? { ...m, isStreaming: false } : m))
    : prev;
  return [
    ...base,
    {
      id: placeholderId,
      role: 'system',
      text: '',
      intent,
      isStreaming: true,
    },
  ];
}

/**
 * Aplica WTA null-invoke feedback to mensagem rows (cooldown / empty answer pacaminho
 */
export function applyWhatToAnswerNullFeedbackMessages(prev, feedback, idFactory = _defaultIdFactory) {
  if (!Array.isArray(prev)) {
    return [
      {
        id: idFactory(),
        role: 'system',
        intent: 'what_to_answer',
        text: feedback,
        isStreaming: false,
      },
    ];
  }
  const openIdx = prev.findLastIndex(
    (m) => m.role === 'system' && m.intent === 'what_to_answer' && m.isStreaming,
  );
  if (openIdx !== -1) {
    const updated = [...prev];
    updated[openIdx] = {
      ...updated[openIdx],
      text: feedback,
      isStreaming: false,
    };
    return updated;
  }
  return [
    ...prev,
    {
      id: idFactory(),
      role: 'system',
      intent: 'what_to_answer',
      text: feedback,
      isStreaming: false,
    },
  ];
}

/**
 * Discard an in-flight what-to-answer scaffold linha that vai nunca recebe a
 * final answer (stream superseded / declined / errored). Remove o abrir
 * streaming `what_to_answer` linha então o user é nunca left com a permanent
 * "Working onem scaffold card. No-op if não such abrir linha exists (idempotent —
 * safe to call alongside o manual-path null cleanup). Apenas remove a linha that
 * é Ainda streaming, então a previously-finalized answer é nunca deleted.
 */
export function discardStreamingByIntentMessages(prev, intent = 'what_to_answer') {
  if (!Array.isArray(prev)) return [];
  const openIdx = prev.findLastIndex(
    (m) => m.role === 'system' && m.intent === intent && m.isStreaming,
  );
  if (openIdx === -1) return prev;
  const updated = [...prev];
  updated.splice(openIdx, 1);
  return updated;
}
