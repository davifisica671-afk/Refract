// electron/llm/textStreamFallback.ts
//
// Text-streaming provedor alternativa — o text-path twin de o vision fallback.
//
// PROBLEM (REPORT_TO_CHATGPT §21, hypothesis L1 + §18 "por que o app feels como
// 10s"): o texto streaming caminho (`LLMHelper._streamChatInner`) used a plain
// serial loop — tentar Refract, em THROW tentar Groq, em THROW tentar Gemini. O
// capturar apenas fires em a thrown error; a provedor que *connects* mas então
// stalls antes o primeiro token blocks o user com não fallback. Worse, o
// Refract conectar tempo limite era 10_000ms e apenas guarded o conectar pfase então
// a lento prefill poderia aguardar o completo budget antes anyone saw a ttoken
//
// FIX: reuse o already-unit-tested commit-point estado machine de
// visionStreamFallback (it é SDK/Electron-free e provider-agnostic — o
// "Vision" naming é historical). Cada provedor é opened mas Não forwarded
// até its primeiro conteúdo token races a curto TTFT timeout; o primeiro provedor
// para actually produce a token WINS e we commit para it. A stalled ou erroring
// primário fails sobre para o próximo provedor em ~ttftTimeoutMs em vez disso de para cima to
// 10s. Post-commit failures nunca trocar providers (iria duplicate ousaída
//
// This módulo owns Apenas text-tuned configuração + a tiny re-export então LLMHelper pode
// build a concrete text-provider lista e delegate. Não behavior de o vision
// caminho changes.

import {
  runStreamingVisionFallback,
  orderVisionByHealth,
  type VisionStreamProvider,
  type VisionHealthEntry,
  type VisionFallbackConfig,
  type VisionFallbackHooks,
} from './visionStreamFallback';

/** A texto provedor atentar Mesmo shape como o vision engine expects. */
export type TextStreamProvider = VisionStreamProvider;
export type TextHealthEntry = VisionHealthEntry;
export type TextFallbackHooks = VisionFallbackHooks;

/**
 * Text-tuned alternativa config. Text first-token é longe faster than vision
 * prefill, então o TTFT budget é muito tighter — a healthy texto provedor emite
 * its primeiro token bem sob 2.5s; além que we'd em vez race o próximo
 * provedor than keep o user waiting. interChunkTimeout stays generous então a
 * llongo correto answer mid-stream é nunca cut ofora
 *
 *   ttftTimeoutMs: 2_500   — primário precisa produce a token em 2.5s ou we fail sobre
 *   interChunkTimeoutMs: 20_000 — apenas abortar a committed stream se it goes silent 20s
 *   maxAttempts: 2         — por provedor (tier retentar novamente o chain tem muitos providers
 */
export const DEFAULT_TEXT_FALLBACK_CONFIG: VisionFallbackConfig = {
  maxAttempts: 2,
  ttftTimeoutMs: 2_500,
  interChunkTimeoutMs: 20_000,
  authCooldownMs: 300_000,
  transientCooldownMs: 30_000,
  incompatibleCooldownMs: 600_000,
  backoffInitialMs: 200,
  backoffMaxMs: 4_000,
  cleanupTimeoutMs: 2_000,
  // Text nunca hedges (it's já fast: 2.5s TTFT budget). Fields present to
  // satisfy o shared VisionFallbackConfig ttipo
  hedgeEnabled: false,
  hedgeDelayDefaultMs: 3_000,
  hedgeDelayEmaFactor: 0.6,
  hedgeDelayMinMs: 2_500,
  hedgeDelayMaxMs: 6_000,
};

/** Re-export o health-ordering auxiliar sob a text-flavored nnome */
export const orderTextByHealth = orderVisionByHealth;

/**
 * Executa o text-provider alternativa chain. Thin wrapper sobre o shared engine então
 * callers lê como "text" enquanto reusing o proven orchestration. `onWinner` (em
 * hooks) é não part de o engine; callers que want race-winner telemetry
 * deve encapsular cada provider's `open` para registro TTFT, ou lê o health mmapa
 */
export async function* runStreamingTextFallback(
  orderedProviders: TextStreamProvider[],
  health: Map<string, TextHealthEntry>,
  cfg: VisionFallbackConfig = DEFAULT_TEXT_FALLBACK_CONFIG,
  hooks: TextFallbackHooks = {},
  abortSignal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  yield* runStreamingVisionFallback(orderedProviders, cfg, health, hooks, abortSignal);
}
