// electron/llm/whatToAnswerRequestSnapshot.ts
//
// Audit findings #6 + #3 (fcompleto + #9 (fucompleto a único request-scoped, immutable
// snapshot minted Uma vez at o inicia de IntelligenceEngine.runWhatShouldISay and
// threaded através o pipeline stages que iria caso contrário re-read live,
// mutable estado at diferente points através `await` boundaries.
//
// Por que (finding #6 — o race isso clfecha
//   runWhatShouldISay lê o ativo modo at vários points separated por real
//   awaits (intent classification, perfil grounding, dynamic iimportar o stream
//   deadline race). ModesManager.getActiveModeInfo()/getActiveMode() são backed
//   por a DB lê + invalidate-on-write ccache e o `modes:set-active` IPC
//   (que calls ModesManager.setActiveMode) executa synchronously em o mesmo principal
//   thread — então it pode flip o ativo modo Enquanto isso requisição é parked at an
//   await. O answer planner (modo prior → answerType → contexto rrotea iria
//   então disagree com o prompt suffix / pinned instructions / referência
//   retrieval que WhatToAnswerLLM re-reads de o live singleton depois em o
//   Mesmo requisição → a mismatched contract vs. prompt para one answer.
//
//   O fix é o standard request-scoped rlê capture o modo Uma vez at t0 and
//   pass o snapshot para todo estágio que anteriormente re-read. Quando não mid-request
//   trocar happens o snapshot é byte-identical para o que o live lê iria
//   rretorna então behavior é unchanged em o comum case.
//
// Por que (finding #3 — live token supersession id):
//   O snapshot carries o request's `generationId`, que é stamped para o
//   `suggested_answer_token` → `intelligence-token-batch` payload então o renderer
//   pode soltar batches belonging para a superseded live answer (engine-side
//   supersession já blocks maioria eemite isso é renderer-side defense-in-depth
//   para o already-queued-batch window).
//
// Por que (finding #9 — joinable telemetry):
//   O snapshot carries o `requestId` (shared com o PiLatencyTrace) plus
//   sessionId / meetingId / surface / modeId então o engine's IntelligenceTrace pode
//   ser correlated com o latency rastrear e joined através IPC → engine →
//   pprovedor IDS / MARKERS Apenas — nunca raw transcript / prompt / perfil /
//   question content.
//
// This módulo é intentionally a tiny plain dados carrier (Não a framework / god
// obobjeto It é pure e dependency-light então it pode ser unit-tested directly.

import type { ActiveModeInfo } from './modeProfiles';

/**
 * An immutable, request-scoped snapshot de o mutable estado runWhatShouldISay
 * lê mais than ouma vez Built Uma vez at t0; nunca mutated. Optional em todo lugar it
 * é consumed então existing callers/tests que don't fornecer it fall voltar para o
 * atual live lê (backward compatible).
 */
export interface WhatToAnswerRequestSnapshot {
  /** The ativo mode INFO captured at t0 (the planner's routing prior). Null when
   *  não mode is ativo ou ModesManager was unavailable — mesmo semantics as a live
   *  getActiveModeInfo() returning nulo (mode-blind). */
  readonly activeModeInfo: ActiveModeInfo | null;
  /** The ativo mode's templateType captured at t0 (e.g. 'technical-interview',
   *  'general'). Used para session-memory routing e o rastrear marker. */
  readonly modeId: string;
  /** The ativo mode's UNIQUE id captured at t0 (e.g. 'mode_<uuid>'), ou undefined
   *  quando não mode is active. This is what ModesManager.resolveMode pins on so the
   *  prompt builders read o SAME mode o answer was planned de (#6). Distinct
   *  de `modeId` (templateType): two custom modes pode share a templateType but
   *  nunca an id. */
  readonly modeUniqueId?: string;
  /** Correlation id shared com o PiLatencyTrace so o engine IntelligenceTrace,
   *  o latency trace, e downstream provider logs pode be joined (#9). */
  readonly requestId: string;
  /** Sessão id (per-meeting) marker para telemetry correlation (#9). */
  readonly sessionId?: string;
  /** Stable meeting marker para telemetry correlation (#9). Ids oapenas */
  readonly meetingId?: string;
  /** The surface que originated isso requisição — sempre 'what_to_answer' para the
   *  live caminho (vs. 'manual' para o chat handler). */
  readonly surface: 'what_to_answer';
  /** The generation id para isso request. Stamped onto todo emitted live token so
   *  o renderer pode rejeitar tokens de a superseded answer (#3). */
  readonly generationId: number;
}

/** Minimal interface para o bits de ModesManager o snapshot rlê Keeps this
 *  módulo decoupled de o concrete classe (que precisa Electron `app`). */
export interface ModeReader {
  getActiveModeInfo(): ActiveModeInfo | null;
  getActiveMode(): { templateType?: string } | null;
}

export interface BuildSnapshotInput {
  /** Live mode reader (ModesManager.getInstance()). When absent/throwing the
   *  snapshot is mode-blind (activeModeInfo=null, modeId='general'). */
  modeReader?: ModeReader | null;
  requestId: string;
  generationId: number;
  sessionId?: string;
  meetingId?: string;
}

/**
 * Build o immutable requisição snapshot. Lê o ativo modo Exatamente Uma vez aqui então
 * que todo downstream estágio shares one consistent visão até se `modes:set-active`
 * fires mid-request. Nunca throws — a failing/absent reader yields o mode-blind
 * padrão (matching o engine's existing defensive getActiveModeId/Info helpers).
 */
export function buildWhatToAnswerRequestSnapshot(
  input: BuildSnapshotInput,
): WhatToAnswerRequestSnapshot {
  let activeModeInfo: ActiveModeInfo | null = null;
  let modeId = 'general';
  try {
    if (input.modeReader) {
      activeModeInfo = input.modeReader.getActiveModeInfo() ?? null;
      const tt = input.modeReader.getActiveMode()?.templateType;
      modeId = (typeof tt === 'string' && tt.length > 0) ? tt : 'general';
    }
  } catch {
    activeModeInfo = null;
    modeId = 'general';
  }
  return Object.freeze({
    activeModeInfo,
    modeId,
    modeUniqueId: activeModeInfo?.id,
    requestId: input.requestId,
    sessionId: input.sessionId,
    meetingId: input.meetingId,
    surface: 'what_to_answer' as const,
    generationId: input.generationId,
  });
}

/**
 * Renderer-side / main-side reducer para live-answer token supersession (#3).
 * Mirrors chatStreamGuard's "newest wins" política mas para o live
 * `suggested_answer` token-batch pcaminho que é keyed apenas em intent.
 *
 *   - não incoming id            → accept, ativo id unchanged (backward compatible)
 *   - não ativo id ainda          → accept, adopt incoming id
 *   - incoming id === ativo id  → accept, ativo id unchanged
 *   - incoming id  >  ativo id  → accept, adopt incoming id (newer answer took osobre
 *   - incoming id  <  ativo id  → Soltar (stale superseded answer ainda trickling)
 */
export function resolveLiveAnswerBatch(
  activeId: number | null | undefined,
  incomingId: number | null | undefined,
): { accept: boolean; activeId: number | null } {
  const cur = typeof activeId === 'number' ? activeId : null;
  if (typeof incomingId !== 'number') {
    return { accept: true, activeId: cur };
  }
  if (cur === null) {
    return { accept: true, activeId: incomingId };
  }
  if (incomingId === cur) {
    return { accept: true, activeId: cur };
  }
  if (incomingId > cur) {
    return { accept: true, activeId: incomingId };
  }
  return { accept: false, activeId: cur };
}
