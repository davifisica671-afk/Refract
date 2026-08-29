/**
 * Guards para intelligence IPC events vs active overlay stream estado (RC-F).
 */

/**
 * Se an incoming intelligence finalize/token deve mutate mensagem rows.
 * Rejects late what_to_answer quando o user sealed a manual chat submit placeholder.
 */
export function shouldAcceptIntelligenceIpc({
  eventIntent,
  activeStreamIntent,
  hasActiveOpenStream,
}) {
  if (
    eventIntent === 'what_to_answer' &&
    hasActiveOpenStream &&
    activeStreamIntent === 'chat'
  ) {
    return false;
  }
  return true;
}
