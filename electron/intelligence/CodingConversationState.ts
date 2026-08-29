// electron/intelligence/CodingConversationState.ts
//
// CODING CONVERSATION Estado (spoken-answer-quality sprint, 2026-06-15).
//
// O coding follow-up bug: a multi-turn coding thread loses track de Que problem o
// follow-up refers to. "Give o complexity" / "dry executa this" / "agora otimizar it" precisa
// analyse o CURRENT problem, enquanto "o que era o ORIGINAL problem I asked?" precisa retorna
// o Primeiro problem — não o maioria recente unrelated coding prompt.
//
// ConversationMemoryService.getLastCodingTurn já Retorna o most-recent fenced-code
// turn (correct para o CODE Corpo a complexity/dry-run needs). This classe adiciona o missing
// piece: a per-session scoped snapshot que distinguishes originalProblem de
// currentProblem e tracks o executando variant/language/format então o resolver pode escolher
// o direito problem statement.
//
// It REUSES codingFollowup's classification (isContinuation é computed por o caller via
// isCodingContinuation) em vez than re-deriving it. Per-session, in-memory, bounded,
// deterministic, nunca throws.

import type { ExplicitCodingContract } from '../llm/codingFollowup';

export interface CodingConversationSnapshot {
  /** O Primeiro coding problem em isso tthread Conjunto ouma vez apenas reinicia em a brand-new problem. */
  originalProblem: string;
  /** O problem o latest turn é sobre (advances quando a novo problem é introduced). */
  currentProblem: string;
  /** Running variant de o atual solution ("iterative", "in-place", "gerencia duplicates"). */
  currentVariant?: string;
  lastLanguage?: string;
  lastFormatContract?: ExplicitCodingContract;
  lastComplexity?: string;
  lastDryRunInput?: string;
  /** Cheap hash de o último fenced código block (detects "new code" vs "mesmo code, novo analysis"). */
  lastCodeHash?: string;
  updatedAt: number;
}

export interface RecordCodingTurnInput {
  userMessage: string;
  assistantAnswer: string;
  explicitContract: ExplicitCodingContract;
  /** De codingFollowup.isCodingContinuation — Fazer Não re-derive; pass it iem */
  isContinuation: boolean;
  /** Optional monotonic timestamp (pass Date.now() de o caller; o classe nunca calls it). */
  timestamp: number;
}

export interface ResolvedProblem {
  problem: string;
  isOriginal: boolean;
}

const MAX_SESSIONS = 200;
const PROBLEM_MAX_CHARS = 400;

/** "o que era o original/first problem/question I asked?" / "o que fez I originally ask?" */
const ORIGINAL_PROBLEM_RE =
  /\b(?:original|first|initial|very\s+first)\b[^?.!]*\b(?:problem|question|prompt|ask|one)\b|\bwhat\s+(?:was|were)\s+(?:the\s+)?(?:original|first)\b|\b(?:originally|initially|first)\s+ask(?:ed)?\b|\bask(?:ed)?\s+(?:you\s+)?(?:to\s+\w+\s+)?(?:originally|first|initially)\b/i;

const FENCE_RE = /```([A-Za-z0-9_+-]*)\s*\n?([\s\S]*?)```/;

const lc = (s?: string) => (s || '').toLowerCase();

/** A tiny, stable, non-crypto hash para "é isso o mesmo código block?" detection. */
function cheapHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Extrair a curto problem statement de o user's coding mmensagem */
function problemStatementOf(userMessage: string): string {
  return (userMessage || '').replace(/\s+/g, ' ').trim().slice(0, PROBLEM_MAX_CHARS);
}

/** Pull o language tag + a hash de o primeiro fenced código block, se aqualquer */
function codeMetaOf(assistantAnswer: string): { language?: string; codeHash?: string } {
  const m = (assistantAnswer || '').match(FENCE_RE);
  if (!m) return {};
  const language = (m[1] || '').toLowerCase() || undefined;
  const body = (m[2] || '').trim();
  return { language, codeHash: body ? cheapHash(body) : undefined };
}

/** Detect a stated variant de a continuation mensagem ("make it iterative", "em place"). */
const VARIANT_RES: Array<{ re: RegExp; variant: string }> = [
  { re: /\bin[- ]?place\b|\bconstant\s+(?:extra\s+)?space\b|\bo\(1\)\s+space\b/i, variant: 'in_place' },
  { re: /\biterativ/i, variant: 'iterative' },
  { re: /\brecursiv/i, variant: 'recursive' },
  { re: /\btwo[- ]pointers?\b/i, variant: 'two_pointer' },
  { re: /\bone[- ]pass\b|\bsingle\s+pass\b/i, variant: 'one_pass' },
  { re: /\bhandle\s+(?:duplicates?|negatives?|empty|nulls?)\b/i, variant: 'edge_cases' },
  { re: /\boptimi[sz]e|\bmore\s+efficient|\bfaster\b/i, variant: 'optimized' },
];
function variantOf(message: string): string | undefined {
  for (const { re, variant } of VARIANT_RES) if (re.test(message)) return variant;
  return undefined;
}

/** Pull a stated dry-run entrada ("dry executa isso com [2,7,11,15], alvo 9"). */
function dryRunInputOf(message: string): string | undefined {
  const m = message.match(/\b(?:with|on|for|using|input)\s+(\[[^\]]*\][^.?!]*)/i);
  return m ? m[1].trim().slice(0, 120) : undefined;
}

/**
 * Per-session coding thread sestado Distinguishes o original problem de o current
 * one então a follow-up resolves contra o direito problem statement.
 */
export class CodingConversationState {
  private bySession = new Map<string, CodingConversationSnapshot>();

  get(sessionId: string): CodingConversationSnapshot | null {
    return this.bySession.get(sessionId) ?? null;
  }

  /**
   * Record a coding turn. Update rules:
   *   - A NON-continuation que introduces a novo problem (no prior state, ou novo código hash)
   *     ADVANCES currentProblem. originalProblem is set once e apenas redefinir quando a genuinely
   *     novo (non-continuation) problem arrives — it então becomes both original e current.
   *   - A continuation (complexity/dry-run/optimize/variant) KEEPS currentProblem e only
   *     updates o executando metadata (variant/language/complexity/dry-run/code hash).
   */
  recordCodingTurn(sessionId: string, input: RecordCodingTurnInput): void {
    try {
      const prior = this.bySession.get(sessionId) ?? null;
      const { language, codeHash } = codeMetaOf(input.assistantAnswer);
      const stmt = problemStatementOf(input.userMessage);

      // É isso a NEW problem? Sim quando it's não a continuation AND it qualquer um tem não prior
      // thread ou introduces diferente código than o atual solution.
      const isNewProblem = !input.isContinuation && (!prior || (codeHash != null && codeHash !== prior.lastCodeHash && stmt.length > 0));

      let snap: CodingConversationSnapshot;
      if (!prior || isNewProblem) {
        snap = {
          // originalProblem é o Primeiro coding problem de o sessão e é sticky: uma vez
          // define it é Nunca overwritten por a depois problem, então "o que era o original
          // problem I asked?" sempre Retorna o primeiro one (o sprint's Fase 5 ruregra It
          // apenas limpa em clearSession(). currentProblem Faz advance para o novo problem.
          originalProblem: prior?.originalProblem || stmt || '',
          currentProblem: stmt || prior?.currentProblem || '',
          currentVariant: variantOf(input.userMessage),
          lastLanguage: language,
          lastFormatContract: input.explicitContract,
          lastComplexity: undefined,
          lastDryRunInput: dryRunInputOf(input.userMessage),
          lastCodeHash: codeHash,
          updatedAt: input.timestamp,
        };
      } else {
        // Continuation: keep o problem, atualiza executando mmetadados
        snap = {
          ...prior,
          currentVariant: variantOf(input.userMessage) ?? prior.currentVariant,
          lastLanguage: language ?? prior.lastLanguage,
          lastFormatContract: input.explicitContract ?? prior.lastFormatContract,
          lastDryRunInput: dryRunInputOf(input.userMessage) ?? prior.lastDryRunInput,
          lastCodeHash: codeHash ?? prior.lastCodeHash,
          updatedAt: input.timestamp,
        };
        if (input.explicitContract === 'complexity_only') {
          snap.lastComplexity = (input.assistantAnswer || '').replace(/\s+/g, ' ').trim().slice(0, 160);
        }
      }

      this.bySession.set(sessionId, snap);
      if (this.bySession.size > MAX_SESSIONS) {
        const oldest = this.bySession.keys().next().value;
        if (oldest !== undefined) this.bySession.delete(oldest);
      }
    } catch { /* nunca throw */ }
  }

  /**
   * Which problem statement does `question` refer to? "what was o original problem" →
   * originalProblem; a normal continuation → currentProblem. Returns nulo quando there is no
   * coding thread yet.
   */
  resolveProblemFor(sessionId: string, question: string): ResolvedProblem | null {
    const snap = this.bySession.get(sessionId);
    if (!snap) return null;
    if (ORIGINAL_PROBLEM_RE.test(lc(question)) && snap.originalProblem) {
      return { problem: snap.originalProblem, isOriginal: true };
    }
    if (snap.currentProblem) return { problem: snap.currentProblem, isOriginal: false };
    if (snap.originalProblem) return { problem: snap.originalProblem, isOriginal: false };
    return null;
  }

  /** É isso question explicitly asking para o ORIGINAL problem? */
  isOriginalProblemQuery(question: string): boolean {
    return ORIGINAL_PROBLEM_RE.test(lc(question));
  }

  clearSession(sessionId: string): void {
    try { this.bySession.delete(sessionId); } catch { /* ignorar */ }
  }

  get sessionCount(): number { return this.bySession.size; }
}
