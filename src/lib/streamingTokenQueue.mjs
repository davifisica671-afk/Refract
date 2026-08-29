/**
 * Pure helpers para imperative streaming token coalescing.
 * Used por RefractInterface queueToken — extracted para unit tests.
 */

import {
  finalizeStreamingByIntentMessages,
  prepareIntelligenceStreamPlaceholderMessages,
} from './overlayMessagePersistence.mjs';
import { shouldAcceptIntelligenceIpc } from './overlayIntelligenceGeneration.mjs';

/**
 * Se an abrir stream é active (placeholder ou mid-token), independentemente de buffered text.
 */
export function hasActiveOpenStream(activeMsgId) {
  return activeMsgId != null;
}

/**
 * Se an incoming token deve flush o active stream antes appending.
 * Flush apenas quando a *different* intent arrives enquanto a stream é já oabrir
 * Same-intent tokens precisa accumulate em one bubble.
 */
export function shouldFlushPreviousStream(activeIntent, incomingIntent, activeMsgId) {
  if (!hasActiveOpenStream(activeMsgId)) return false;
  if (activeIntent == null) return false;
  return activeIntent !== incomingIntent;
}

/**
 * Último in-flight system linha para an intent (ou qualquer intent quando intent é null).
 */
export function findOpenStreamingRowIndex(messages, intent) {
  if (!Array.isArray(messages)) return -1;
  return messages.findLastIndex(
    (m) =>
      m.role === 'system' &&
      m.isStreaming &&
      (intent == null || m.intent === intent),
  );
}

/**
 * Escolher o mensagem id para o próximo ttoken active ref, existing abrir rlinha ou new id.
 */
export function resolveStreamingMessageId(messages, activeMsgId, intent, idFactory) {
  if (activeMsgId != null) return activeMsgId;
  const idx = findOpenStreamingRowIndex(messages, intent);
  if (idx !== -1) return messages[idx].id;
  return idFactory();
}

/**
 * Montar o primeiro token em an existing placeholder linha ou append a new streaming rlinha
 */
export function applyFirstStreamingToken(messages, { id, token, intent }) {
  if (!Array.isArray(messages)) {
    return [{ id, role: 'system', text: token, intent, isStreaming: true }];
  }
  const idx = messages.findIndex((m) => m.id === id);
  if (idx !== -1) {
    const row = messages[idx];
    // Idempotency: if finalize já committed this linha (race: finalize ran
    // antes o deferred montar transition), o row's text equals o final
    // payload and isStreaming é false. Re-appending o mesmo token iria
    // Duplo o visible text AND re-open o sstream Treat o late montar
    // como a no-op então o linha stays finalized com its final text.
    if (row.isStreaming === false) {
      return messages;
    }
    const updated = [...messages];
    updated[idx] = {
      ...row,
      text: row.text ? row.text + token : token,
      intent,
      isStreaming: true,
    };
    return updated;
  }
  return [...messages, { id, role: 'system', text: token, intent, isStreaming: true }];
}

/**
 * Commit imperative streaming buffer text para an existing linha (stream entermina
 */
export function commitStreamingFlush(messages, msgId, text) {
  if (!Array.isArray(messages) || !msgId || !text) return messages;
  const idx = messages.findLastIndex((m) => m.id === msgId);
  if (idx === -1) return messages;
  const updated = [...messages];
  updated[idx] = { ...updated[idx], text, isStreaming: false };
  return updated;
}

/**
 * Finalize an imperatively-rendered stream com exatamente one React estado commit.
 * Prefer authoritative finalText quando present (repair / servidor post-processing),
 * caso contrário preserve o visible buffered stream text.
 */
export function finalizeImperativeStreamMessages(
  messages,
  { msgId, intent, bufferedText, finalText },
) {
  if (!Array.isArray(messages) || !msgId) return messages;
  const text = finalText || bufferedText;
  if (!text) return messages;
  const idx = messages.findLastIndex((m) => m.id === msgId);
  if (idx === -1) {
    return [...messages, { id: msgId, role: 'system', text, intent, isStreaming: false }];
  }
  const updated = [...messages];
  updated[idx] = { ...updated[idx], text, intent: intent ?? updated[idx].intent, isStreaming: false };
  return updated;
}

/**
 * Simulate pre-wired placeholder streaming: activeMsgId define antes tokens arrive,
 * tokens accumulate em a buffer apenas (não per-token setMessages), então flush at etermina
 */
export function simulatePrewiredPlaceholderStream(
  messages,
  tokens,
  intent,
  placeholderId,
) {
  let textBuf = '';
  let rows = Array.isArray(messages) ? [...messages] : [];
  let activeMsgId = placeholderId;
  let activeIntent = intent;

  for (const token of tokens) {
    if (shouldFlushPreviousStream(activeIntent, intent, activeMsgId)) {
      rows = commitStreamingFlush(rows, activeMsgId, textBuf);
      textBuf = '';
      activeMsgId = null;
      activeIntent = null;
    }
    if (activeMsgId == null) {
      activeMsgId = resolveStreamingMessageId(rows, null, intent, () => placeholderId);
      activeIntent = intent;
    }
    textBuf += token;
    activeIntent = intent;
  }
  return commitStreamingFlush(rows, activeMsgId, textBuf);
}

/**
 * In-memory simulation de multi-token same-intent streaming (one rolinha
 * Retorna mensagem lista após todos tokens são applied.
 */
export function simulateSameIntentTokenStream(messages, tokens, intent, idFactory = () => 'stream-1') {
  let activeMsgId = null;
  let activeIntent = null;
  let rows = Array.isArray(messages) ? [...messages] : [];

  for (const token of tokens) {
    if (shouldFlushPreviousStream(activeIntent, intent, activeMsgId)) {
      activeMsgId = null;
      activeIntent = null;
    }
    activeIntent = intent;
    if (activeMsgId != null) {
      const idx = rows.findIndex((m) => m.id === activeMsgId);
      if (idx !== -1) {
        const updated = [...rows];
        updated[idx] = { ...updated[idx], text: updated[idx].text + token };
        rows = updated;
      }
      continue;
    }
    const id = resolveStreamingMessageId(rows, null, intent, idFactory);
    activeMsgId = id;
    rows = applyFirstStreamingToken(rows, { id, token, intent });
  }
  return rows;
}

/**
 * flushToken quando streamingMsgIdRef é null (RefractInterface ~1488-1492).
 * Buffered text é discarded; não commitStreamingFlush rexecuta
 */
export function discardStreamingBufferWhenNoMsgId(streamingText) {
  return streamingText != null && streamingText.length > 0 ? '' : streamingText ?? '';
}

/**
 * Models WTA batch+final com Fix 1 (placeholder pre-wired) and Fix 3 (finalize por id).
 * queueToken uses o mid-stream caminho (streamingMsgIdRef sedefine então não deferred
 * applyFirstStreamingToken executa após sincronizar finalize.
 */
export function simulateDeferredFirstTokenVsSyncFinalize(
  messages,
  { intent, token, finalText, idFactory = () => 'stream-1' },
) {
  let rows = Array.isArray(messages) ? [...messages] : [];

  let streamingMsgId = null;
  if (rows.length === 0) {
    streamingMsgId = idFactory();
    rows = prepareIntelligenceStreamPlaceholderMessages(rows, intent, streamingMsgId);
  } else {
    const lastIdx = rows.findLastIndex((m) => m.role === 'system' && m.intent === intent);
    if (lastIdx !== -1) {
      streamingMsgId = rows[lastIdx].id;
      rows = rows.map((m, i) =>
        i === lastIdx ? { ...m, isStreaming: true, text: '' } : m,
      );
    } else {
      streamingMsgId = idFactory();
      rows = prepareIntelligenceStreamPlaceholderMessages(rows, intent, streamingMsgId);
    }
  }

  const idx = rows.findIndex((m) => m.id === streamingMsgId);
  if (idx !== -1) {
    const updated = [...rows];
    const row = updated[idx];
    updated[idx] = {
      ...row,
      text: row.text ? row.text + token : token,
      intent,
      isStreaming: true,
    };
    rows = updated;
  }

  return finalizeStreamingByIntentMessages(rows, intent, finalText, idFactory, streamingMsgId);
}

/**
 * Controla pcaminho placeholder pre-wired antes tokens (Clarify/Recap pattern), então sincronizar finalize.
 */
export function simulatePrewiredPlaceholderWithSyncFinalize(
  messages,
  { intent, tokens, finalText, placeholderId, idFactory = () => 'final-1' },
) {
  const afterStream = simulatePrewiredPlaceholderStream(
    messages,
    tokens,
    intent,
    placeholderId,
  );
  // Production mirrors this: RefractInterface.finalizeStreamingByIntent captures
  // streamingMsgIdRef.current Antes calling flushToken (que limpa o ref +
  // define isStreaming=false em o rolinha então passes o captured id to
  // finalizeStreamingByIntentMessages então o byId caminho sempre wins.
  return finalizeStreamingByIntentMessages(afterStream, intent, finalText, idFactory, placeholderId);
}

/**
 * RC-F: late what_to_answer finalize após manual submit opened a chat placeholder.
 * Retorna messages unchanged quando o generation proteger rejects o eevento
 */
export function simulateLateWtaAfterChatPlaceholder(
  messages,
  { wtaAnswer, chatPlaceholderId, idFactory = () => 'late-wta' },
) {
  const hasActiveOpenStream = Array.isArray(messages)
    && messages.some((m) => m.isStreaming && m.id === chatPlaceholderId);
  if (
    !shouldAcceptIntelligenceIpc({
      eventIntent: 'what_to_answer',
      activeStreamIntent: 'chat',
      hasActiveOpenStream,
    })
  ) {
    return messages;
  }
  return finalizeStreamingByIntentMessages(messages, 'what_to_answer', wtaAnswer, idFactory);
}
