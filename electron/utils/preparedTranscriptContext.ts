// electron/utils/preparedTranscriptContext.ts
// Construção de contexto de transcrição preparado
// Prepara turnos de transcrição alinhados com o módulo What-to-Answer,
// incluindo turnos limpos, fala interim do entrevistador e respostas recentes do assistente.

import {
  buildTemporalContext,
  prepareTranscriptForWhatToAnswer,
} from '../llm';

export interface PreparedContextItem {
  role: string;
  text: string;
  timestamp: number;
}

export interface PreparedContextSession {
  getContextWithInterim(lastSeconds: number): PreparedContextItem[];
  getAssistantResponseHistory(): string[];
}

/**
 * Constrói contexto de transcrição alinhado com What-to-Answer: turnos limpos,
 * fala interim do entrevistador e respostas recentes do assistente.
 */
export function buildPreparedTranscriptContext(
  session: PreparedContextSession,
  lastSeconds: number = 180,
): string {
  const contextItems = session.getContextWithInterim(lastSeconds);
  if (contextItems.length === 0) return '';

  const transcriptTurns = contextItems.map((item) => ({
    role: item.role,
    text: item.text,
    timestamp: item.timestamp,
  }));

  // `as any` aqui conecta as formas estruturalmente distintas de turn/context:
  // os helpers LLM (prepareTranscriptForWhatToAnswer / buildTemporalContext)
  // declaram seus próprios tipos de turno derivados de RollingTranscript, e os itens acima
  // (role/text/timestamp + PreparedContextItem) são compatíveis em tempo de execução
  // mas não são atribuíveis nominalmente. As conversões são seguras dado o alinhamento de campos.
  const preparedTranscript = prepareTranscriptForWhatToAnswer(transcriptTurns as any, 12);
  const temporalContext = buildTemporalContext(
    contextItems as any,
    session.getAssistantResponseHistory() as any,
    lastSeconds,
  );

  const parts: string[] = [preparedTranscript];
  if (temporalContext.hasRecentResponses && temporalContext.previousResponses.length > 0) {
    parts.push(
      '[RECENT ASSISTANT RESPONSES]\n' +
        temporalContext.previousResponses.map((r) => `- ${r}`).join('\n'),
    );
  }
  return parts.filter(Boolean).join('\n\n');
}
