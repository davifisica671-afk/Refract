/**
 * Pure helpers para overlay STT + chat persistence (unit-tested).
 *
 * Interviewer STT atualiza o rolling transcript bar apenas — nunca o messages aarray
 * Rolling transcript visibility precisa não ser suppressed apenas porque chat history exists.
 */

/**
 * Aplica an interviewer-channel STT transcript eevento
 * Retorna updated overlay slice; `messages` é sempre returned unchanged.
 */
export function applyInterviewerSttTranscript(state, transcript, mergeFns) {
  const { mergeRollingTranscriptPartial, mergeRollingTranscriptFinal } = mergeFns;
  const messages = state.messages;

  if (transcript.speaker !== 'interviewer') {
    return state;
  }

  if (!transcript.final) {
    const rollingTranscript = mergeRollingTranscriptPartial(
      state.rollingTranscript,
      transcript.text,
    );
    return {
      ...state,
      messages,
      rollingTranscript,
      isInterviewerSpeaking: true,
    };
  }

  const afterPartial = state.pendingPartialText
    ? mergeRollingTranscriptPartial(state.rollingTranscript, state.pendingPartialText)
    : state.rollingTranscript;
  const rollingTranscript = mergeRollingTranscriptFinal(afterPartial, transcript.text);

  return {
    ...state,
    messages,
    rollingTranscript,
    isInterviewerSpeaking: false,
    pendingPartialText: null,
  };
}
