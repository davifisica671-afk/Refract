/**
 * Funções puras para a barra de transcrição rolante do overlay.
 *
 * O STT da OpenAI emite pré-visualizações parciais crescentes (texto completo do segmento por
 * tick) e um final por fala. Estas funções substituem o
 * final em andamento nos parciais e evitam duplicar texto quando o final corresponde à pré-visualização.
 *
 * Particularidade do STT do Google: os interims chegam em minúsculas sem pontuação ("hello world hocomo")
 * enquanto os fins têm capitalização e pontuação próprias ("Hello world, como você está?")
 * porque enableAutomaticPunctuation se aplica apenas a resultados finais. Todas as comparações startsWith
 * precisam ser feitas em cópias normalizadas (minúsculas, sem pontuação) — as strings exibidas
 * nunca são modificadas.
 */

// electron/utils/rollingTranscriptState.ts
// Estado da barra de transcrição rolante do overlay
// Gerencia a mesclagem de segmentos finais e parciais do STT (Speech-to-Text),
// evitando duplicação de texto e mantendo o limite de caracteres da string de exibição.

const FINAL_SEPARATOR = '  ·  ';

/**
 * Limite rígido para a string de exibição da transcrição rolante. A barra normalmente mostra
 * apenas as uma ou duas linhas mais recentes, mas as funções de mesclagem adicionam todo segmento
 * finalizado para sempre, então em reuniões longas isso cresce como string de estado do React sem limite — cada
 * mesclagem subsequente re-normaliza/re-examina a string que continuava ficando maior
 * (achado de auditoria #7). 8 KiB é muito mais do que as poucas centenas de caracteres que a interface mostra
 * mas ainda pequeno o suficiente para que o trabalho de string por evento permaneça constante ao longo da reunião.
 * O limite descarta da FRENTE (segmentos comprometidos mais antigos) no limite de segmentos
 * finalizados para que a cauda visível nunca seja cortada no meio de uma palavra.
 */
export const ROLLING_TRANSCRIPT_MAX_CHARS = 8192;

/**
 * Limita uma string de transcrição rolante a ROLLING_TRANSCRIPT_MAX_CHARS descartando
 * segmentos iniciais inteiros (divididos por FINAL_SEPARATOR). Pura; nunca divide um segmento.
 * Retorna a entrada inalterada quando já dentro do limite.
 */
export function capRollingTranscript(s: string, maxChars: number = ROLLING_TRANSCRIPT_MAX_CHARS): string {
  if (s.length <= maxChars) return s;
  // Descartar segmentos iniciais inteiros até caber. Manter pelo menos o último segmento,
  // mesmo que ele sozinho exceda o limite (truncar a linha visível é pior que
  // um único segmento levemente acima do limite, que já é limitado por turn do STT).
  let idx = s.indexOf(FINAL_SEPARATOR);
  let out = s;
  while (out.length > maxChars && idx >= 0) {
    out = out.substring(idx + FINAL_SEPARATOR.length);
    idx = out.indexOf(FINAL_SEPARATOR);
  }
  return out;
}

/** Normalizar a string para comparação de sobreposição apenas — nunca usada para exibição */
function norm(s: string): string {
  return s.toLowerCase()
    .replace(/[\p{Pd}]+/gu, ' ')   // dashes/hyphens → space (state-of-the-art → estado de o art)
    .replace(/[\p{P}\p{S}]+/gu, '') // strip remaining punctuation and symbols (curly quotes, periods, etetc
    .replace(/\s+/g, ' ')
    .trim();
}

/** Índice após o último separador de segmento finalizado, ou -1 quando nenhum */
export function lastFinalSeparatorIndex(prev: string): number {
  return prev.lastIndexOf(FINAL_SEPARATOR);
}

/** Prefixo contendo todos os segmentos comprometidos (finalizados) incluindo separador final. */
export function committedRollingPrefix(prev: string): string {
  const idx = lastFinalSeparatorIndex(prev);
  return idx >= 0 ? prev.substring(0, idx + FINAL_SEPARATOR.length) : '';
}

/** Cauda em andamento (não final) após o último separador. */
export function inProgressRollingTail(prev: string): string {
  const idx = lastFinalSeparatorIndex(prev);
  return idx >= 0 ? prev.substring(idx + FINAL_SEPARATOR.length) : prev;
}

/** Aplica a pré-visualização parcial — substitui a cauda em andamento, nunca limpa o texto comprometido. */
export function mergeRollingTranscriptPartial(prev: string, partialText: string): string {
  const text = partialText.trim();
  if (!text) return prev;

  const prefix = committedRollingPrefix(prev);
  const inProgress = inProgressRollingTail(prev);
  const normText = norm(text);
  const normInProgress = norm(inProgress);

  // Mesmo turno — coalescer a pré-visualização que cresceu dentro do segmento atual.
  if (!prefix && inProgress && (normText.startsWith(normInProgress) || normInProgress.startsWith(normText))) {
    return text;
  }
  if (prefix && (normText.startsWith(normInProgress) || normInProgress.startsWith(normText) || !inProgress)) {
    return prefix + text;
  }

  // Novo turno após conteúdo comprometido anterior.
  if (prev) {
    return capRollingTranscript(prev + FINAL_SEPARATOR + text);
  }

  return text;
}

/** Comprometer um segmento final — substitui a cauda em andamento correspondente em vez de duplicar. */
export function mergeRollingTranscriptFinal(prev: string, finalText: string): string {
  const text = finalText.trim();
  if (!text) return prev;

  const prefix = committedRollingPrefix(prev);
  const inProgress = inProgressRollingTail(prev);
  const normText = norm(text);
  const normInProgress = norm(inProgress);

  if (inProgress && (normText.startsWith(normInProgress) || normInProgress.startsWith(normText))) {
    return prefix + text;
  }

  if (norm(inProgress).endsWith(normText) && norm(prev).endsWith(normText)) {
    return prev;
  }

  return capRollingTranscript(prev ? prev + FINAL_SEPARATOR + text : text);
}
