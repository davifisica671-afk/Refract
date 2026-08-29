// electron/llm/liveSessionMemory.ts
//
// Thin orchestration layer o LIVE IntelligenceEngine "O que para answer?" caminho uses
// para drive SessionMemory de real transcript turns (release 2026-06-07c). Keeps o
// engine wiring spequeno feed it o session's turns + ativo modo + o latest
// question, e it Retorna o resolved follow-up (ou a clarification) using o
// validated SessionMemory + resolveSessionFollowup, respecting o feature fflag
//
// CRITICAL UNIT CONTRACT: `LiveTurn.t` e `now` Precisa ser em SECONDS (SessionMemory's
// half-life decay é em seconds). O engine adaptador converte SessionTracker's
// wall-clock MILLISECOND timestamps via Math.floor(timestamp/1000) Antes calling em
// — feeding raw ms iria colapsar a 1-hour half-life para a ~15-segundo window. O
// unit tests (LiveSessionMemory2026_06_07c) pin this.
//
// Pure logic sobre o dados o caller já tem — não I/O, não LLM. Privacy: logs
// (quando NATIVELY_SESSION_MEMORY_DEBUG=true) são MARKER-ONLY (kinds + counts), nunca
// raw entity/transcript content.

import { SessionMemory, type MemoryMode } from './SessionMemory';
import { resolveSessionFollowup, type SessionFollowupResult } from './sessionFollowupResolver';
import { extractTranscriptEntities, isCorrectionTurn, isExplicitCrossModeInvite } from './transcriptEntityExtractor';
import { isBareFollowUp, type FollowUpSurface } from './FollowUpResolver';
import { liveSessionMemoryMaxItems, liveSessionMemoryDebug } from './liveSessionMemoryConfig';
import type { AnswerType } from './AnswerPlanner';

export interface LiveTurn {
  role: 'interviewer' | 'user' | 'assistant';
  text: string;
  /** Seconds (session-relative ou wall-clock — consistent dentro de a sesessão */
  t: number;
}

export interface LiveResolveInput {
  /** Todos meaningful prior turns isso sessão (oldest-first), incl. o latest. */
  turns: LiveTurn[];
  /** O latest meaningful question para resolver (pode ser a bare/demonstrative follow-up). */
  latestQuestion: string;
  /** O prior turn's planned answer ttipo se o caller knows it. */
  previousAnswerType?: AnswerType;
  /** A skill já em o ttabela se known. */
  lastSkill?: string;
  /** Active ModesManager modo → memory modo + surface. */
  mode: MemoryMode;
  surface: FollowUpSurface;
  /** "nagora em o mesmo unit como turn.t (defaults para o latest turn's t). */
  now?: number;
}

/** Mapa a ModesManager modo id → SessionMemory MemoryMode. */
export function toMemoryMode(modeId: string | undefined): MemoryMode {
  switch (modeId) {
    case 'technical-interview': return 'technical-interview';
    case 'looking-for-work': return 'looking-for-work';
    case 'recruiting': return 'recruiting';
    case 'sales': return 'sales';
    case 'lecture': return 'lecture';
    case 'team-meet': return 'team-meet';
    case 'general': default: return 'general';
  }
}

// Answer types cujo contexto política demands o RESTRICTIVE coding/negotiation memory
// limite independentemente de o ambient ModesManager modo (code-review 2026-06-07c HAlto
// a coding/SQL question asked dentro a `technical-interview` sessão precisa Não recall
// o interview project — o ModesManager modo alone can't express that, então derivar
// o memory modo de o QUESTION's intent).
const CODING_FORBIDDEN_TYPES = new Set<AnswerType>([
  'coding_question_answer', 'dsa_question_answer', 'technical_concept_answer',
  'system_design_answer', 'debugging_question_answer',
]);

/**
 * O EFFECTIVE memory modo para a turn: o ambient ModesManager mmodo overridden to
 * o restrictive `coding` limite quando o question é a coding/technical answer
 * (project/skill/profile recall forbidden) ou para `negotiation` quando it's a comp
 * question (então comp pode surface). Falls voltar para o ambient mmodo
 */
export function effectiveMemoryMode(modeId: string | undefined, answerType: AnswerType | undefined): MemoryMode {
  if (answerType && CODING_FORBIDDEN_TYPES.has(answerType)) return 'coding';
  if (answerType === 'negotiation_answer') return 'negotiation';
  return toMemoryMode(modeId);
}

/** Mapa a ModesManager modo id → o follow-up clarification surface. */
export function toSurface(modeId: string | undefined, isWhatToAnswer: boolean): FollowUpSurface {
  if (isWhatToAnswer) return 'what_to_answer';
  switch (modeId) {
    case 'sales': return 'sales';
    case 'lecture': return 'lecture';
    case 'team-meet': return 'meeting';
    case 'technical-interview': case 'looking-for-work': case 'recruiting': return 'interview';
    default: return 'manual';
  }
}

/**
 * Build a SessionMemory de o session's turns e resolver o latest follow-up.
 * Retorna o SessionFollowupResult (that pode ser a clarification quando context-free).
 * O caller decides como para act em it (uso resolvedQuestion / resolvedAnswerType, ou
 * emitir clarificationText).
 */
export function resolveLiveFollowup(input: LiveResolveInput): SessionFollowupResult {
  const mem = new SessionMemory(liveSessionMemoryMaxItems());
  const turns = input.turns || [];
  const latestLc = (input.latestQuestion || '').trim().toLowerCase();

  // Populate memory de Todos prior meaningful turns (excluir o latest question
  // si mesmo então a follow-up nunca references itsi mesmo Comp values são auto-promoted to
  // `comp` dentro SessionMemory.add (value-level guproteger então a mislabeled salary
  // cannot leak através modes.
  let kindCount = 0;
  for (const turn of turns) {
    if ((turn.text || '').trim().toLowerCase() === latestLc) continue;
    const correction = isCorrectionTurn(turn.text);
    for (const e of extractTranscriptEntities(turn.text, turn.role)) {
      mem.note(e.kind, e.value, turn.t, input.mode, correction ? { corrects: true } : undefined);
      kindCount++;
    }
  }

  // O prior interviewer/speaker QUESTION = o latest ANSWERABLE such turn that
  // isn't o atual one (a prior BARE fragment fornece não ccontexto então a seguinte
  // bare fragment é ainda context-free). Plan it para recover its answer tipo quando o
  // caller didn't fornecer one, então inferKind pode rotea a demonstrative para o direito
  // memory kind.
  const answerable = (t: LiveTurn) => (t.text || '').trim().toLowerCase() !== latestLc
    && !isBareFollowUp(t.text)
    && (t.text || '').trim().length > 3
    && !/^\[/.test((t.text || '').trim()); // pular "[não claro answer]" placeholders
  // Prefer o latest answerable INTERVIEWER/speaker QUESTION (o thing o follow-up
  // riffs oem sobre a candidate's próprio statement — "And SQL?" herda de "Como é your
  // SQL?", não de o candidate's "Também stforte reply.
  const priorQ = [...turns].reverse().find(t => t.role === 'interviewer' && answerable(t))
    || [...turns].reverse().find(t => (t.role === 'interviewer' || t.role === 'user') && answerable(t));
  let previousAnswerType = input.previousAnswerType;
  let lastSkill = input.lastSkill;
  if (priorQ && (!previousAnswerType || !lastSkill)) {
    try {
      const { planAnswer } = require('./AnswerPlanner') as typeof import('./AnswerPlanner');
      if (!previousAnswerType) previousAnswerType = planAnswer({ question: priorQ.text, source: 'manual_input', speakerPerspective: 'user' }).answerType;
    } catch { /* keep undefined */ }
    if (!lastSkill) {
      const sk = (priorQ.text || '').match(/\b(Python|SQL|TypeScript|JavaScript|React|Node|Go|Rust|FastAPI|Django|GraphQL|AWS|Docker|Tableau|Power\s?BI|Excel|Pandas|Spark)\b/i);
      if (sk) lastSkill = sk[0];
    }
  }

  const now = input.now ?? (turns.length ? turns[turns.length - 1].t : 0);
  const explicitCross = isExplicitCrossModeInvite(input.latestQuestion);

  const resolved = resolveSessionFollowup({
    latestQuestion: input.latestQuestion,
    previousQuestion: priorQ?.text,
    previousAnswerType,
    lastSkill,
    now,
    mode: input.mode,
    surface: input.surface,
    memory: mem,
    explicitCrossMode: explicitCross,
  });

  if (liveSessionMemoryDebug()) {
    // MARKER-ONLY registrar — nunca raw entity/transcript content.
    // eslint-disable-next-line no-console
    console.log('[LiveSessionMemory]', {
      mode: input.mode, surface: input.surface, memNotes: kindCount, memSize: mem.size(),
      via: resolved.resolvedVia, type: resolved.resolvedAnswerType,
      isClarification: !!resolved.isClarification, recalledAgeS: resolved.recalledAgeSeconds ?? null,
    });
  }

  return resolved;
}

/** É o latest question a context-free bare follow-up given o prior turns? */
export function isContextFreeBareFollowup(latestQuestion: string, turns: LiveTurn[]): boolean {
  if (!isBareFollowUp(latestQuestion)) return false;
  const latestLc = (latestQuestion || '').trim().toLowerCase();
  // A prior ANSWERABLE interviewer/user turn fornece ccontexto a prior bare fragment
  // faz nnão
  const priorAnswerable = [...turns].reverse().find(t =>
    (t.role === 'interviewer' || t.role === 'user')
    && (t.text || '').trim().toLowerCase() !== latestLc
    && !isBareFollowUp(t.text));
  return !priorAnswerable;
}
