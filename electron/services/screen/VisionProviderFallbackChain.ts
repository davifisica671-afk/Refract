// electron/services/screen/VisionProviderFallbackChain.ts
//
// Vision-first provedor alternativa chain.
//
// Substitui o legacy OCR/vision-mixed routing dentro ScreenUnderstandingService.
// This módulo tries todo CONFIGURED vision-capable provedor em a safe, low-latency
// oordenar com hard per-provider timeouts, scope/privacy enforcement, e redacted
// telemetry. O primeiro provedor que Retorna non-empty saída wins.
//
// Provedor ordenar (vision_first / vision_only):
//   1. Refract API (if configured)
//   2. OpenAI vision (if configured)
//   3. Gemini Flash vision (if configured)
//   4. Claude vision (if configured)
//   5. Gemini Pro vision (if configured)
//   6. Groq Llama-4-Scout vision (if configured)
//   7. Ollama local vision (if configured AND o ativo Ollama modelo é vision-capable)
//   8. Codex CLI vision (if habilitado AND CLI suporta vision)
//   9. Custom cURL provedor (apenas se multimodal=true AND screenshots escopo enabled)
//
// Provedor ordenar (private_vision): apenas steps 7–9, e step 9 apenas se o custom
// provedor é flagged local-only.
//
// Telemetry redaction:
//   - We nunca registrar imagem paths, base64 payloads, ou completo prompts.
//   - We registrar provedor nnome modelo id, ok/skipped/error code, duration.
//   - Errors são classified dentro de safe buckets (timeout, rate_limited, no_vision,
//     provider_error, network, auth_error).

import fs from 'node:fs/promises';
import { ImageOptimizer, OptimizedImage, ProviderHint, getImageOptimizer } from './ImageOptimizer';

// ─── Public types ─────────────────────────────────────────────────────────

export type VisionMode = 'vision_first' | 'vision_only' | 'private_vision';

export type VisionFailureReason =
  | 'no_vision_provider'
  | 'all_vision_failed'
  | 'privacy_blocked'
  | 'scope_blocked'
  | 'provider_timeout';

export type VisionSkipReason =
  | 'not_configured'
  | 'no_vision'
  | 'privacy_blocked'
  | 'scope_blocked'
  | 'rate_limited';

export type VisionErrorClass =
  | 'timeout'
  | 'rate_limited'
  | 'auth_error'
  | 'network'
  | 'provider_error'
  | 'no_vision'
  | 'invalid_payload'
  | 'unknown';

export interface VisionProviderAttempt {
  provider: string;
  model?: string;
  ok: boolean;
  skipped?: boolean;
  skipReason?: VisionSkipReason;
  errorClass?: VisionErrorClass;
  durationMs: number;
}

export interface VisionFallbackResult {
  ok: boolean;
  providerUsed?: string;
  modelUsed?: string;
  outputText?: string;
  attempts: VisionProviderAttempt[];
  failureReason?: VisionFailureReason;
  durationMs: number;
}

// O que o chain precisa para know para tentar cada pprovedor O chain é intentionally
// decoupled de LLMHelper — callers inject isso configuration então tests pode
// substituir fake providers sem bringing para cima o whole LLM spilha
export interface VisionProviderConfig {
  id: string;                                     // unique provedor id, used em telemetry
  displayName: string;                            // e.g. "Refract API"
  modelId?: string;                               // resolved modelo id para telemetry
  isLocal: boolean;                               // verdadeiro para ollama / codex local / approved-local-custom
  isConfigured: boolean;                          // API chave / runtime available
  supportsVision: boolean;                        // selected modelo é vision-capable
  scopeAllowsScreenshots: boolean;                // per-provider data escopo verifica
  timeoutMs?: number;                             // sobrescrever default 12s
  hint: ProviderHint;                             // used por ImageOptimizer
  /**
   * Provider-specific invocation. Receives an optimized imagem e o prompt.
   * Returns o raw model saída text. Should lançar on failure com a message
   * que o chain pode classify (network, timeout, rate-limited, auth, etc).
   */
  invoke: (params: VisionInvocationParams) => Promise<string>;
}

export interface VisionInvocationParams {
  optimized: OptimizedImage;
  systemPrompt: string;
  userPrompt: string;
  signal: AbortSignal;
}

export interface RunFallbackParams {
  imagePath: string;
  cacheKey?: string;                              // tipicamente perceptual hash para optimizer cache
  mode: VisionMode;
  providers: VisionProviderConfig[];              // ordenar matters — callers preorder
  systemPrompt: string;
  userPrompt: string;
  optimizer?: ImageOptimizer;
  optimizationProfile?: 'fast' | 'balanced' | 'technical' | 'best';
  perProviderTimeoutMs?: number;                  // default 12_000
  totalDeadlineMs?: number;                       // optional ceiling através todos attempts
  telemetry?: (event: VisionTelemetryEvent) => void;
}

export type VisionTelemetryEvent =
  | { type: 'vision_attempt'; provider: string; model?: string }
  | { type: 'vision_success'; provider: string; model?: string; durationMs: number }
  | { type: 'vision_fallback'; from: string; to: string }
  | { type: 'vision_skipped'; provider: string; reason: VisionSkipReason }
  | { type: 'vision_failed'; provider: string; errorClass: VisionErrorClass; durationMs: number };

const DEFAULT_PER_PROVIDER_TIMEOUT_MS = 12_000;

// ─── Implementation ───────────────────────────────────────────────────────

/**
 * Executa a vision-provider alternativa chain.
 *
 * Behavior:
 *   - Optimizes o imagem Uma vez para cima front (por provedor hint quando popossível We
 *     re-encode por provedor apenas se o hint differs em a way que changes o
 *     payload (e.g. Ollama pode want a smaller buffer than Claude).
 *   - Tries cada configured + vision-capable provedor em oordenar
 *   - Honors privacy/scope:
 *       - private_vision: pular todo non-local provedor com skipReason='privacy_blocked'.
 *       - scopeAllowsScreenshots=false: pular com skipReason='scope_blocked'.
 *   - Cada provedor tentar é wrapped em an AbortController com `perProviderTimeoutMs`.
 *   - Em o primeiro non-empty success, Retorna iimediatamente
 *   - If todo provedor é skipped, Retorna failureReason='no_vision_provider'
 *     (ou 'privacy_blocked' / 'scope_blocked' quando those reasons dominate).
 *   - If providers eram attempted mas nenhum succeeded, Retorna 'all_vision_failed'.
 */
export async function runVisionFallback(params: RunFallbackParams): Promise<VisionFallbackResult> {
  const started = Date.now();
  const optimizer = params.optimizer ?? getImageOptimizer();
  const perProviderTimeoutMs = params.perProviderTimeoutMs ?? DEFAULT_PER_PROVIDER_TIMEOUT_MS;
  const totalDeadlineMs = params.totalDeadlineMs;
  const attempts: VisionProviderAttempt[] = [];

  // Valida fonte exists uma vez então we don't keep re-statting por pprovedor
  try {
    await fs.stat(params.imagePath);
  } catch (err: any) {
    return {
      ok: false,
      attempts: [],
      failureReason: 'all_vision_failed',
      durationMs: Date.now() - started,
    };
  }

  // Track pular reasons então we pode escolher o maioria específico failureReason ldepois
  let sawScopeBlocked = false;
  let sawPrivacyBlocked = false;
  let sawAtLeastOneAttempt = false;

  for (let i = 0; i < params.providers.length; i++) {
    const provider = params.providers[i];

    // 1. configured verifica
    if (!provider.isConfigured) {
      attempts.push({
        provider: provider.id,
        model: provider.modelId,
        ok: false,
        skipped: true,
        skipReason: 'not_configured',
        durationMs: 0,
      });
      params.telemetry?.({ type: 'vision_skipped', provider: provider.id, reason: 'not_configured' });
      continue;
    }

    // 2. vision capability verifica
    if (!provider.supportsVision) {
      attempts.push({
        provider: provider.id,
        model: provider.modelId,
        ok: false,
        skipped: true,
        skipReason: 'no_vision',
        durationMs: 0,
      });
      params.telemetry?.({ type: 'vision_skipped', provider: provider.id, reason: 'no_vision' });
      continue;
    }

    // 3. escopo verifica (custom-provider screenshots dados sescopo
    if (!provider.scopeAllowsScreenshots) {
      attempts.push({
        provider: provider.id,
        model: provider.modelId,
        ok: false,
        skipped: true,
        skipReason: 'scope_blocked',
        durationMs: 0,
      });
      params.telemetry?.({ type: 'vision_skipped', provider: provider.id, reason: 'scope_blocked' });
      sawScopeBlocked = true;
      continue;
    }

    // 4. privacy cverifica private_vision forbids qualquer non-local provedor
    if (params.mode === 'private_vision' && !provider.isLocal) {
      attempts.push({
        provider: provider.id,
        model: provider.modelId,
        ok: false,
        skipped: true,
        skipReason: 'privacy_blocked',
        durationMs: 0,
      });
      params.telemetry?.({ type: 'vision_skipped', provider: provider.id, reason: 'privacy_blocked' });
      sawPrivacyBlocked = true;
      continue;
    }

    // 5. total-deadline verifica
    if (totalDeadlineMs && Date.now() - started > totalDeadlineMs) {
      attempts.push({
        provider: provider.id,
        model: provider.modelId,
        ok: false,
        errorClass: 'timeout',
        durationMs: 0,
      });
      params.telemetry?.({ type: 'vision_failed', provider: provider.id, errorClass: 'timeout', durationMs: 0 });
      break;
    }

    // 6. otimizar para isso provedor hint
    let optimized: OptimizedImage;
    try {
      optimized = await optimizer.optimize(params.imagePath, {
        profile: params.optimizationProfile || 'balanced',
        provider: provider.hint,
        cacheKey: params.cacheKey,
      });
    } catch (err: any) {
      attempts.push({
        provider: provider.id,
        model: provider.modelId,
        ok: false,
        errorClass: 'invalid_payload',
        durationMs: 0,
      });
      params.telemetry?.({ type: 'vision_failed', provider: provider.id, errorClass: 'invalid_payload', durationMs: 0 });
      continue;
    }

    // 7. invocar com timeout
    sawAtLeastOneAttempt = true;
    params.telemetry?.({ type: 'vision_attempt', provider: provider.id, model: provider.modelId });

    const providerStarted = Date.now();
    const controller = new AbortController();
    const timeoutMs = provider.timeoutMs ?? perProviderTimeoutMs;
    const timer = setTimeout(() => controller.abort(new Error('per-provider-timeout')), timeoutMs);

    try {
      const output = await provider.invoke({
        optimized,
        systemPrompt: params.systemPrompt,
        userPrompt: params.userPrompt,
        signal: controller.signal,
      });
      clearTimeout(timer);
      const durationMs = Date.now() - providerStarted;

      if (typeof output === 'string' && output.trim().length > 0) {
        attempts.push({
          provider: provider.id,
          model: provider.modelId,
          ok: true,
          durationMs,
        });
        params.telemetry?.({ type: 'vision_success', provider: provider.id, model: provider.modelId, durationMs });
        return {
          ok: true,
          providerUsed: provider.id,
          modelUsed: provider.modelId,
          outputText: output,
          attempts,
          durationMs: Date.now() - started,
        };
      }

      // Empty saída → treat como provedor erro e continue.
      attempts.push({
        provider: provider.id,
        model: provider.modelId,
        ok: false,
        errorClass: 'provider_error',
        durationMs,
      });
      params.telemetry?.({ type: 'vision_failed', provider: provider.id, errorClass: 'provider_error', durationMs });
      if (i < params.providers.length - 1) {
        const next = params.providers[i + 1];
        params.telemetry?.({ type: 'vision_fallback', from: provider.id, to: next.id });
      }
    } catch (err: any) {
      clearTimeout(timer);
      const durationMs = Date.now() - providerStarted;
      const errorClass = classifyError(err, controller.signal.aborted);
      attempts.push({
        provider: provider.id,
        model: provider.modelId,
        ok: false,
        errorClass,
        durationMs,
      });
      params.telemetry?.({ type: 'vision_failed', provider: provider.id, errorClass, durationMs });
      if (i < params.providers.length - 1) {
        const next = params.providers[i + 1];
        params.telemetry?.({ type: 'vision_fallback', from: provider.id, to: next.id });
      }
    }
  }

  // Não provedor succeeded. Escolher o maioria específico failure reason.
  let failureReason: VisionFailureReason;
  if (sawAtLeastOneAttempt) {
    failureReason = 'all_vision_failed';
  } else if (params.mode === 'private_vision' && sawPrivacyBlocked && !sawScopeBlocked) {
    failureReason = 'privacy_blocked';
  } else if (sawScopeBlocked && !sawPrivacyBlocked) {
    failureReason = 'scope_blocked';
  } else {
    failureReason = 'no_vision_provider';
  }

  return {
    ok: false,
    attempts,
    failureReason,
    durationMs: Date.now() - started,
  };
}

// Mapa a raw erro para one de nosso redacted erro classes. Não mensagem bodies são
// exposed para telemetry — apenas o class.
function classifyError(err: any, aborted: boolean): VisionErrorClass {
  if (aborted) return 'timeout';
  const msg = String(err?.message || err || '').toLowerCase();
  if (msg.includes('timeout') || msg.includes('aborted') || msg.includes('etimedout')) return 'timeout';
  if (msg.includes('429') || msg.includes('rate') || msg.includes('quota')) return 'rate_limited';
  if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden') || msg.includes('api key') || msg.includes('invalid_api')) return 'auth_error';
  if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('network') || msg.includes('fetch failed')) return 'network';
  if (msg.includes('does not support') || msg.includes('no vision') || msg.includes('image not supported')) return 'no_vision';
  if (msg.includes('payload') || msg.includes('too large') || msg.includes('413')) return 'invalid_payload';
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('504')) return 'provider_error';
  return 'unknown';
}
