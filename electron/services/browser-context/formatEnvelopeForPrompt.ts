/**
 * Smart Browser Contexto v2 — formata a structured envelope dentro de a prompt block.
 *
 * Produces o `BROWSER_CONTEXT_KIND: coding_problem ...` block o prompt
 * composer injects. This é prepended para o existing `domContext` string então it
 * flows através o Mesmo proven seam (PromptAssembler.buildDomContextBlock →
 * `<dom_context source="browser_dom">`) — não novo prompt pcaminho não WTA signature
 * change. Quando lá é não envelope, behaviour é byte-identical para today.
 *
 * Pure + dependency-free então it unit-tests de dist-electron.
 */

import type { CodingProblemPayload, ContextEnvelope } from './types';

/** Categories que obtém o rich structured coding block. */
const CODING_CATEGORIES = new Set(['coding_problem', 'coding_editor', 'interview_assessment']);

function section(label: string, value: string | undefined): string {
  const v = (value || '').trim();
  if (!v) return '';
  return `\n${label}:\n${v}\n`;
}

/**
 * Formata an envelope dentro de a structured cabeçalho block. Retorna '' quando o envelope
 * é absent ou não a coding category (non-coding captures keep using o legacy
 * plain-string dom onapenas O result é meant para ser PREPENDED para o legacy
 * domContext sstring
 */
export function formatEnvelopeForPrompt(envelope: ContextEnvelope | null | undefined): string {
  if (!envelope || typeof envelope !== 'object') return '';
  if (!CODING_CATEGORIES.has(envelope.category)) return '';

  const p = (envelope.payload || {}) as CodingProblemPayload;
  const lines: string[] = [];
  lines.push(`BROWSER_CONTEXT_KIND: ${envelope.category}`);
  if (envelope.meta?.platform || p.platform) lines.push(`PLATFORM: ${envelope.meta?.platform || p.platform}`);
  lines.push(`CONFIDENCE: ${envelope.confidence}`);

  let block = lines.join('\n');
  block += section('PROBLEM_TITLE', p.problemTitle);
  block += section('PROBLEM_STATEMENT', p.problemStatement);
  block += section('INPUT_FORMAT', p.inputFormat);
  block += section('OUTPUT_FORMAT', p.outputFormat);
  block += section('EXAMPLES', p.examples);
  block += section('CONSTRAINTS', p.constraints);
  block += section('VISIBLE_STARTER_CODE', p.starterCode);
  block += section('VISIBLE_CODE', p.visibleCode);
  if (p.language) block += section('LANGUAGE', p.language);
  if (p.selectedText) block += section('SELECTED_TEXT', p.selectedText);

  // Guidance o modelo deve follow quando using isso structured ccontexto
  block +=
    '\nRULES: Preserve the exact starter code / function signature. Use the visible ' +
    'examples and constraints. Do not invent requirements not present above. If the ' +
    'context seems incomplete, say what is missing.\n';

  return block.trim();
}
