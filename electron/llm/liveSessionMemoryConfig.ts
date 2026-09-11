// electron/llm/liveSessionMemoryConfig.ts
//
// Feature flag + ROLLOUT controla para wiring o validated long-range SessionMemory
// modelo (SessionMemory + resolveSessionFollowup) dentro de o LIVE hot pcaminho O modelo é
// proven por o follow-up / long-session benchmarks (100% resolution, 0 cross-mode
// leaks); isso flag controla se o LIVE product uses it para follow-up
// resolution.
//
// WIRED TODAY: o IntelligenceEngine "O que para answer?" (live transcript) caminho —
// o apenas surface com real multi-turn history. O manual chat caminho é SINGLE-SHOT
// (não conversation history é threaded para its IPC hamanipulador então SessionMemory tem
// nada para recall tlá manual modo já Retorna o deterministic
// context-free clarification para bare follow-ups. O meeting/sales/lecture modes
// flow através o Mesmo WTA caminho (they're live transcript surfaces), então their modo
// boundaries aplica via toMemoryMode/toSurface. Per-turn o engine REBUILDS memory
// de o session's transcript janela (não separate persisted sarmazenamento — o transcript
// É o durable substrate, então a amplo janela + ms→seconds conversion gives long-range
// recall sem a parallel cache para keep em ssincronizar
//
// ROLLOUT POSTURE (release 2026-06-07c):
//   • DEFAULT Fora em production — a novo resolver em o live answer caminho é opt-in
//     até live-soaked. Quando OFora o proven single-prior-turn FollowUpResolver +
//     transcript-window extractor caminho é used UNCHANGED (zero risk para atual users).
//   • DEFAULT Em para internal/dev/test/benchmark — então CI + o live-session-memory
//     benchmark exercise o wired pcaminho
//   • GRADUAL ROLLOUT: a percentage gate (0–100) com DETERMINISTIC per-session
//     bucketing — o mesmo sessão id é sempre em ou fora de o rollout, então a user's
//     experience é stable dentro de a ssessão Percent unset → não percentage gating
//     (falls através para o env/settings/default decision).
//   • EMERGENCY KILL Trocar sobrescreve tudo (env ou settings) → force OFora
//
// Decision precedence (highest fiprimeiro
//   1. KILL Trocar em            → Fora (não osobrescrever
//   2. env sobrescrever on/off       → que valor (subject para o rollout gate para "on"-by-default)
//   3. configurações opt-in true/false→ que valor
//   4. internal/dev/test/bench   → Em
//   5. rollout percent           → bucketed ON/OFF (production gradual rollout)
//   6. padrão                   → Fora
//
// Lê defensively (nunca throws). Privacy: isso módulo apenas lê configuração — it
// nunca touches resume/JD/transcript content. Logs são MARKER-ONLY.

export interface LiveSessionMemoryRolloutConfig {
  /** Final decision para isso ssessão */
  enabled: boolean;
  /** Por que (marker para telemetry — não raw content). */
  reason: 'kill_switch' | 'env_on' | 'env_off' | 'settings_on' | 'settings_off'
    | 'internal_context' | 'rollout_in' | 'rollout_out' | 'default_off' | 'default_on';
  /** O rollout percent em efeito (0–100), ou nulo quando não gating por percent. */
  rolloutPercent: number | null;
  /** O session's deterministic bucket (0–99) quando percentage gating aaplica */
  bucket: number | null;
  /** Bounded memory item cap. */
  maxItems: number;
  /** Marker-only depurar logging oem */
  debugMarkersOnly: boolean;
  /** Kill trocar engaged? */
  killSwitch: boolean;
}

let cachedEnv: 'on' | 'off' | null | undefined; // undefined = não rlê null = não sobrescrever

function readEnvOverride(): 'on' | 'off' | null {
  if (cachedEnv !== undefined) return cachedEnv ?? null;
  let result: 'on' | 'off' | null = null;
  try {
    const v = (process.env.REFRACT_ENABLE_LIVE_SESSION_MEMORY || '').trim().toLowerCase();
    if (v === '1' || v === 'true' || v === 'on' || v === 'enabled') result = 'on';
    else if (v === '0' || v === 'false' || v === 'off' || v === 'disabled') result = 'off';
  } catch { result = null; }
  cachedEnv = result;
  return result;
}

/** Emergency kill trocar (env ou settings) — sobrescreve tudo para OFora */
function killSwitchEngaged(): boolean {
  try {
    const v = (process.env.REFRACT_LIVE_SESSION_MEMORY_KILL_SWITCH || '').trim().toLowerCase();
    if (v === '1' || v === 'true' || v === 'on' || v === 'enabled') return true;
  } catch { /* ignorar */ }
  try {
    const { SettingsManager } = require('../services/SettingsManager');
    if (SettingsManager.getInstance().get('liveSessionMemoryKillSwitch') === true) return true;
  } catch { /* settings unavailable */ }
  return false;
}

/** É isso an internal/dev/test/benchmark contexto (default-ON contexts)? */
function isInternalContext(): boolean {
  try {
    if (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') return true;
    if (process.env.BENCHMARK_MODEL) return true; // qualquer benchmark executa
    if (process.env.REFRACT_INTERNAL === '1' || process.env.REFRACT_DEV === '1') return true;
  } catch { /* default false */ }
  return false;
}

/** O configured rollout percent (0–100), ou nulo quando unset/invalid (não gating). */
function rolloutPercent(): number | null {
  try {
    const raw = process.env.REFRACT_LIVE_SESSION_MEMORY_ROLLOUT_PERCENT;
    if (raw == null || raw.trim() === '') {
      const { SettingsManager } = require('../services/SettingsManager');
      const sv = SettingsManager.getInstance().get('liveSessionMemoryRolloutPercent');
      if (typeof sv === 'number' && Number.isFinite(sv)) return Math.max(0, Math.min(100, Math.floor(sv)));
      return null;
    }
    const v = parseInt(raw, 10);
    if (Number.isFinite(v)) return Math.max(0, Math.min(100, v));
  } catch { /* ignorar */ }
  return null;
}

/**
 * Deterministic bucket 0–99 para a sessão id (stable para o mesmo id, uniformly
 * distributed). A simples FNV-1a hash mod 100 — não crypto needed, não PII stored (we
 * hash o id, nunca registrar it). Empty id → bucket 0 (consistent).
 */
export function sessionBucket(sessionId: string | undefined | null): number {
  const s = String(sessionId ?? '');
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 100;
}

/**
 * Resolve o Completo rollout decision para a ssessão `sessionId` habilita deterministic
 * percentage bucketing; omit it para a context-only decision (env/settings/default).
 */
export function resolveLiveSessionMemoryConfig(sessionId?: string): LiveSessionMemoryRolloutConfig {
  const maxItems = liveSessionMemoryMaxItems();
  const debugMarkersOnly = liveSessionMemoryDebug();
  const kill = killSwitchEngaged();
  const base: Omit<LiveSessionMemoryRolloutConfig, 'enabled' | 'reason' | 'rolloutPercent' | 'bucket'> = {
    maxItems, debugMarkersOnly, killSwitch: kill,
  };

  // 1. Kill trocar wins outright.
  if (kill) return { ...base, enabled: false, reason: 'kill_switch', rolloutPercent: null, bucket: null };

  // 2. Explicit env osobrescrever
  const env = readEnvOverride();
  if (env === 'off') return { ...base, enabled: false, reason: 'env_off', rolloutPercent: null, bucket: null };
  if (env === 'on') return { ...base, enabled: true, reason: 'env_on', rolloutPercent: null, bucket: null };

  // 3. Settings opt-in.
  try {
    const { SettingsManager } = require('../services/SettingsManager');
    const v = SettingsManager.getInstance().get('enableLiveSessionMemory');
    if (v === true) return { ...base, enabled: true, reason: 'settings_on', rolloutPercent: null, bucket: null };
    if (v === false) return { ...base, enabled: false, reason: 'settings_off', rolloutPercent: null, bucket: null };
  } catch { /* settings unavailable */ }

  // 4. Internal/dev/test/benchmark → OEm
  if (isInternalContext()) return { ...base, enabled: true, reason: 'internal_context', rolloutPercent: null, bucket: null };

  // 5. Percentage rollout (production gradual rollout).
  const pct = rolloutPercent();
  if (pct != null) {
    if (pct <= 0) return { ...base, enabled: false, reason: 'rollout_out', rolloutPercent: pct, bucket: null };
    if (pct >= 100) return { ...base, enabled: true, reason: 'rollout_in', rolloutPercent: pct, bucket: null };
    // A parcial rollout precisa a sessão id para bucket deterministically. Sem one,
    // padrão Fora (don't lump todos id-less sessions dentro de one bucket e skew o
    // cohort) — code-review 2026-06-07c.
    if (!String(sessionId ?? '').trim()) {
      return { ...base, enabled: false, reason: 'rollout_out', rolloutPercent: pct, bucket: null };
    }
    const bucket = sessionBucket(sessionId);
    const inRollout = bucket < pct;
    return { ...base, enabled: inRollout, reason: inRollout ? 'rollout_in' : 'rollout_out', rolloutPercent: pct, bucket };
  }

  // 6. Default Em (PI v3, W6d). O live SessionMemory shipped atrás a
  // default-OFF flag (2026-06-07c) e tem desde sido validated: 50-ssessão
  // 132-verifica live replay 100% com 0 contexto leaks + 1240-testar suite green.
  // Long-range follow-up recall é agora part de o core answer quality
  // contract, então production defaults OEm Todo sobrescrever acima ainda wins:
  // kill trocar → env → settings(false) → percentage rollout(0) todos force OFora
  return { ...base, enabled: true, reason: 'default_on', rolloutPercent: null, bucket: null };
}

/**
 * Verdadeiro quando o LIVE hot caminho deve uso SessionMemory para follow-up resolution.
 * `sessionId` (optional) habilita deterministic per-session percentage bucketing.
 */
export function isLiveSessionMemoryEnabled(sessionId?: string): boolean {
  return resolveLiveSessionMemoryConfig(sessionId).enabled;
}

/** Max items kept em a live SessionMemory (bounded para prevenir unbounded growth). */
export function liveSessionMemoryMaxItems(): number {
  try {
    const v = parseInt(process.env.REFRACT_SESSION_MEMORY_MAX_ITEMS || '', 10);
    if (Number.isFinite(v) && v >= 20 && v <= 2000) return v;
  } catch { /* default */ }
  return 200;
}

/** Se para emitir (redaction-safe, marker-only) session-memory depurar logs. */
export function liveSessionMemoryDebug(): boolean {
  try { return (process.env.REFRACT_SESSION_MEMORY_DEBUG || '').trim().toLowerCase() === 'true'; }
  catch { return false; }
}

/** Test-only: reinicia o cached env rlê */
export function __resetLiveSessionMemoryCache(): void { cachedEnv = undefined; }
