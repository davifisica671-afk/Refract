/**
 * Filtra comum Whisper hallucinations.
 * Retorna an vazio string se o texto é a known hallucination,
 * caso contrário Retorna o trimmed text.
 */

const EXACT_BLOCKS = new Set([
  '[music]',
  '[applause]',
  '[inaudible]',
  '(music)',
  'thank you for watching',
  'thanks for watching',
  'you',
  'bye',
  '...',
  '.',
]);

// Matches qualquer token que é entirely wrapped em square brackets e.g. [Noise], [BLANK_AUDIO]
const BRACKET_TOKEN_RE = /^\[.*\]$/;

export function filterHallucination(text: string): string {
  const trimmed = text.trim();

  // Também curto
  if (trimmed.length < 2) return '';

  const lower = trimmed.toLowerCase();

  // Exact corresponder contra known hallucinations
  if (EXACT_BLOCKS.has(lower)) return '';

  // Qualquer token que é purely a bracketed tag
  if (BRACKET_TOKEN_RE.test(trimmed)) return '';

  return trimmed;
}
