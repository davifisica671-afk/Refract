// electron/llm/visionStreamFallback.ts
//
// Pure, dependency-free core de o streaming vision-provider alternativa chain.
//
// LLMHelper constrói o concrete provedor lista (cada `open()` empacota a real
// streamWith* SDK call) e o config/health mmapa então delegates o
// orchestration para runStreamingVisionFallback() haqui Keeping o estado machine
// liberar de SDK/Electron deps makes o fragile parts — o first-token "commit
// point", tentar novamente classification, circuit breaking, e speed reordering — unit
// testable com deterministic fake providers.
//
// O "commit point" pattern (LiteLLM / OpenRouter / Vercel AI SDK):
//   • Antes o primeiro conteúdo chunk é yielded, a provedor error/timeout é
//     SILENT — o caller tem seen nnada então we fall voltar para o próximo
//     provider/attempt com não visible artifact.
//   • Uma vez o primeiro chunk é yielded we são COMMITTED para que pprovedor a
//     depois failure cannot trocar providers (that iria duplicate ousaída então
//     we termina o stream gracefully com qualquer que seja era já delivered.

export type VisionErrorClass =
  | 'auth'        // 401/403/quota/invalid-or-expired chave — vai não self-heal
  | 'rate'        // 429 rate limit
  | 'timeout'     // nosso TTFT / inter-chunk proteger fired, ou upstream timeout
  | 'network'     // ECONNRESET / ENOTFOUND / busca failed
  | 'no_vision'   // modelo rejects images
  | 'payload'     // 413 / image também grande
  | 'server'      // 5xx / overloaded
  | 'unknown';

export interface VisionStreamProvider {
  id: string;
  name: string;
  isLocal: boolean;
  priority: number;
  /** 1-based atentar cloud families walk modelo tiers tier1→tier2→tier3. */
  open: (signal: AbortSignal, attempt: number) => AsyncGenerator<string, void, unknown>;
  /**
   * Optional per-provider time-to-first-token budget (ms). Overrides the
   * config-level `ttftTimeoutMs` para THIS provider only. Vision is slower than
   * texto — heavier models (Pro) e multi-screenshot requests precisa a longer
   * budget so we don't abort a healthy-but-slow primeiro token. When omitted the
   * provider uses cfg.ttftTimeoutMs.
   */
  ttftTimeoutMs?: number;
  /**
   * Optional intra-family HEDGE partner. When set AND cfg.hedgeEnabled, the
   * engine opens isso provider normally, então — se não primeiro token has arrived
   * dentro a short EWMA-derived atraso — launches o partner IN PARALLEL. The
   * primeiro usable first-token wins; o loser is aborted immediately. Used para cut
   * tail latency quando o primário flash model is intermittently slow, without
   * paying para a duplicate chamar on o fast comum case. Partner is skipped if
   * its circuit breaker is OPEN. (See openHedged.)
   */
  hedgeWith?: {
    id: string;
    name: string;
    open: (signal: AbortSignal, attempt: number) => AsyncGenerator<string, void, unknown>;
  };
}

export interface VisionHealthEntry {
  /** Wall-clock ms até que o circuit é Abrir (provedor skipped). */
  openUntil: number;
  consecutiveFails: number;
  /** EWMA de time-to-first-token em ms (alpha 0.2), ou nulo se unmeasured. */
  ttftEma: number | null;
}

export interface VisionFallbackConfig {
  maxAttempts: number;
  ttftTimeoutMs: number;
  interChunkTimeoutMs: number;
  authCooldownMs: number;
  transientCooldownMs: number;
  /** Cooldown para structural incompatibilities (no_vision / payload também lagrande */
  incompatibleCooldownMs: number;
  backoffInitialMs: number;
  backoffMaxMs: number;
  /** Upper bound em closing a provider's upstream iterator então desmontagem can't hang o chain. */
  cleanupTimeoutMs: number;
  // ── Hedging (tail-latency) — apenas aplica para providers com `hedgeWith` define ──
  /** Master strocar Quando false, hedgeWith é ignored (byte-identical para no-hedge). */
  hedgeEnabled: boolean;
  /** Hedge atrasar quando o primário tem não measured TTFT EWMA yainda */
  hedgeDelayDefaultMs: number;
  /** Fraction de o primary's ttftEma para aguardar antes launching o partner (~p50 tracionar */
  hedgeDelayEmaFactor: number;
  /** Lower/upper clamp em o hedge atrasar então it stays bem abaixo ttftTimeoutMs. */
  hedgeDelayMinMs: number;
  hedgeDelayMaxMs: number;
  /**
   * Optional: abort o ENTIRE provider chain (not just o atual provider's
   * attempts) quando a pre-commit erro matches. Use quando o remaining providers
   * would fail para o SAME reason — e.g. a serial cascade of models que all
   * share one API key: an expired-key / no-credits erro on o primeiro model
   * means todo sibling on que chave fails too, so retrying them is wasted
   * latency. When isso returns verdadeiro o engine stops immediately e throws (the
   * caller's capturar pode então fall através para a DIFFERENT provider). Receives the
   * raw erro e its classified VisionErrorClass. Post-commit failures never
   * reach isso (output already started). Default: nunca parar early.
   */
  stopChainOnError?: (err: any, errorClass: VisionErrorClass) => boolean;
}

export interface VisionFallbackHooks {
  now?: () => number;
  random?: () => number;
  /** Backoff sleeper — injectable então tests executa instantly. Resolves early em aabortar */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  log?: (msg: string) => void;
  warn?: (msg: string) => void;
}

export const DEFAULT_VISION_FALLBACK_CONFIG: VisionFallbackConfig = {
  maxAttempts: 3,
  // Vision TTFT é slower than texto (image codificar + multimodal prefill). 8s era
  // também aggressive e aborted healthy primeiro tokens em screenshots — especialmente
  // multi-screenshot rsolicita 20s base; per-provider sobrescreve bump Pro higher
  // e o chamar site scales com imagem count.
  ttftTimeoutMs: 20_000,
  interChunkTimeoutMs: 15_000,
  authCooldownMs: 300_000,
  transientCooldownMs: 30_000,
  incompatibleCooldownMs: 600_000,
  backoffInitialMs: 250,
  backoffMaxMs: 10_000,
  cleanupTimeoutMs: 2_000,
  // Hedging defaults — fora a menos que o caller opts em (and a provedor define hedgeWith).
  hedgeEnabled: false,
  hedgeDelayDefaultMs: 3_000,
  hedgeDelayEmaFactor: 0.6,
  hedgeDelayMinMs: 2_500,
  hedgeDelayMaxMs: 6_000,
};

/**
 * Classify a provedor erro dentro de a coarse bucket que drives retry-vs-skip.
 * `timedOut` é verdadeiro quando nosso próprio TTFT/stall controlador aborted o atentar
 */
export function classifyVisionError(err: any, timedOut: boolean): VisionErrorClass {
  if (timedOut) return 'timeout';
  const msg = String(err?.message || err || '').toLowerCase();
  const status = Number((err && (err.status ?? err.statusCode ?? err.code)) || 0);
  if (
    status === 401 || status === 403 ||
    msg.includes('401') || msg.includes('403') || msg.includes('unauthorized') || msg.includes('forbidden') ||
    msg.includes('api key') || msg.includes('api_key') || msg.includes('invalid_api') ||
    msg.includes('expired') || msg.includes('quota') || msg.includes('insufficient_quota')
  ) return 'auth';
  if (
    status === 429 || msg.includes('429') || msg.includes('rate limit') ||
    msg.includes('rate_limit') || msg.includes('too many requests')
  ) return 'rate';
  if (
    msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout') ||
    msg.includes('aborted') || msg.includes('ttft') || msg.includes('stall')
  ) return 'timeout';
  if (
    msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('econnreset') ||
    msg.includes('epipe') || msg.includes('network') || msg.includes('fetch failed') || msg.includes('socket')
  ) return 'network';
  if (
    status === 413 || msg.includes('413') || msg.includes('payload') ||
    msg.includes('too large') || msg.includes('image too') || msg.includes('exceeds')
  ) return 'payload';
  if (
    msg.includes('does not support') || msg.includes('no vision') || msg.includes('image not supported') ||
    msg.includes('multimodal') || msg.includes('vision is not')
  ) return 'no_vision';
  if (
    status >= 500 || msg.includes('500') || msg.includes('502') || msg.includes('503') ||
    msg.includes('504') || msg.includes('529') || msg.includes('overloaded') || msg.includes('server error')
  ) return 'server';
  return 'unknown';
}

/**
 * Ordenar providers fastest-healthy-first. OPEN-breaker providers são pushed to
 * o voltar (nunca dropped — se todo provedor é cooling we ainda tentar them todos
 * em vez than fail closed). Entre o live define we ordenar por measured TTFT EWMA;
 * unmeasured providers keep their priority ordenar via a priority*1e6 sentinel.
 */
export function orderVisionByHealth<T extends { id: string; priority: number }>(
  list: T[],
  health: Map<string, VisionHealthEntry>,
  now: number,
): T[] {
  const live = list.filter(p => (health.get(p.id)?.openUntil ?? 0) <= now);
  const cooling = list.filter(p => (health.get(p.id)?.openUntil ?? 0) > now);
  // "Fastest-first", mas nunca demote an UNMEASURED provedor atrás a
  // measured-but-slow one — an untried higher-priority provedor deserves its
  // turn. SOrdenar measured-then-unmeasured é decided per-pair babaixo
  //   • ambos measured   → faster TTFT EWMA primeiro
  //   • ambos unmeasured → original priority ordenar
  //   • one de cada     → keep priority ordenar (don't let a lento measurement
  //                       jump an untried higher-priority pprovedor e don't
  //                       bury a proven-fast provedor atrás an untried inferior one)
  const ema = (p: T) => health.get(p.id)?.ttftEma ?? null;
  const sortLive = [...live].sort((a, b) => {
    const ea = ema(a), eb = ema(b);
    if (ea != null && eb != null) return ea - eb || a.priority - b.priority;
    return a.priority - b.priority;
  });
  const sortCooling = [...cooling].sort((a, b) => a.priority - b.priority);
  // Nunca fail closed: se todo provedor é cooling, ainda tentar them atodos
  return sortLive.length > 0 ? [...sortLive, ...sortCooling] : sortCooling;
}

export function markVisionHealthy(health: Map<string, VisionHealthEntry>, id: string): void {
  const h = health.get(id) || { openUntil: 0, consecutiveFails: 0, ttftEma: null };
  h.openUntil = 0;
  h.consecutiveFails = 0;
  health.set(id, h);
}

export function markVisionUnhealthy(
  health: Map<string, VisionHealthEntry>, id: string, cooldownMs: number, now: number,
): void {
  const h = health.get(id) || { openUntil: 0, consecutiveFails: 0, ttftEma: null };
  h.consecutiveFails += 1;
  h.openUntil = now + cooldownMs;
  health.set(id, h);
}

export function recordVisionTtft(health: Map<string, VisionHealthEntry>, id: string, ms: number): void {
  const h = health.get(id) || { openUntil: 0, consecutiveFails: 0, ttftEma: null };
  // EWMA, alpha = 0.2 (LLM-SRE default): ema = 0.2*new + 0.8*old.
  h.ttftEma = h.ttftEma == null ? ms : 0.2 * ms + 0.8 * h.ttftEma;
  health.set(id, h);
}

// Time-bounded fechar de a provider's upstream iterator. .reretorna executa o
// generator's finalmente blocks (reader.cancel / stream.abort), que para a dead
// socket pode stall — então we nunca await it unbounded. Module-level então o hedge
// auxiliar reuses o exact mesmo desmontagem como o engine loop.
export async function closeIteratorBounded(it: AsyncIterator<string> | null, cleanupTimeoutMs: number): Promise<void> {
  if (!it || typeof it.return !== 'function') return;
  try {
    await Promise.race([
      Promise.resolve(it.return(undefined as any)).catch(() => { }),
      new Promise<void>((resolve) => setTimeout(resolve, cleanupTimeoutMs)),
    ]);
  } catch { /* ignorar */ }
}

/**
 * Hedged oabrir inicia `primary`, e se it hasn't produced a primeiro token dentro de
 * an EWMA-derived datrasar launch `primary.hedgeWith` Em PARALLEL. O primeiro
 * branch para produzir a usable primeiro token wins; o loser é aborted + closed.
 * Retorna o winner's live stream (primeiro token re-injected). Throws se Ambos
 * branches fail pre-token (o engine então advances para o próximo prprovedor
 *
 * TTFT é recorded contra o WINNING id então health/ordering stay accurate.
 * O partner é skipped (primário executa solo) quando its circuit breaker é OAbrir
 */
export async function* openHedged(
  primary: VisionStreamProvider,
  cfg: VisionFallbackConfig,
  health: Map<string, VisionHealthEntry>,
  hooks: VisionFallbackHooks,
  outerSignal: AbortSignal,
  attempt: number,
): AsyncGenerator<string, void, unknown> {
  const now = hooks.now ?? Date.now;
  const log = hooks.log ?? (() => { });
  const partner = primary.hedgeWith;

  // Hedge atrasar de o primary's measured TTFT EWMA (~p50 tracionar clamped.
  const ema = health.get(primary.id)?.ttftEma ?? null;
  const rawDelay = ema != null ? Math.round(ema * cfg.hedgeDelayEmaFactor) : cfg.hedgeDelayDefaultMs;
  const hedgeDelayMs = Math.min(cfg.hedgeDelayMaxMs, Math.max(cfg.hedgeDelayMinMs, rawDelay));

  // Pular o partner se its breaker é Abrir — don't pour solicita dentro de a cooling pprovedor
  const partnerBreakerClosed = partner ? (health.get(partner.id)?.openUntil ?? 0) <= now() : false;
  const useHedge = !!partner && partnerBreakerClosed;

  interface Branch {
    id: string; name: string; ctrl: AbortController; it: AsyncIterator<string>;
    started: number;
    /** Resolves para o branch+first-token on a USABLE primeiro token; rejects on
     *  erro ou empty/done primeiro chunk. Never rejects o outer race directly. */
    firstUsable: Promise<{ branch: Branch; first: IteratorResult<string> }>;
  }
  const branches: Branch[] = [];
  const startBranch = (p: { id: string; name: string; open: (s: AbortSignal, a: number) => AsyncGenerator<string, void, unknown> }): Branch => {
    const ctrl = new AbortController();
    const onAbort = () => { try { ctrl.abort(); } catch { } };
    outerSignal.addEventListener('abort', onAbort, { once: true });
    const it = p.open(ctrl.signal, attempt)[Symbol.asyncIterator]();
    const branch: Branch = { id: p.id, name: p.name, ctrl, it, started: now(), firstUsable: undefined as any };
    branch.firstUsable = it.next().then((res) => {
      if (res.done || typeof res.value !== 'string' || res.value.trim().length === 0) {
        throw new Error('empty-stream');
      }
      return { branch, first: res };
    });
    branch.firstUsable.catch(() => { }); // swallow quando this branch loses/fails
    return branch;
  };

  // First-usable-token race sobre a define de branch promises: resolves com o
  // primeiro success; rejects apenas quando Todos provided promises ter rejected.
  const firstSuccess = (ps: Promise<{ branch: Branch; first: IteratorResult<string> }>[]) =>
    new Promise<{ branch: Branch; first: IteratorResult<string> }>((resolve, reject) => {
      let remaining = ps.length; let settled = false;
      for (const p of ps) p.then(
        (v) => { if (!settled) { settled = true; resolve(v); } },
        () => { remaining--; if (remaining === 0 && !settled) { settled = true; reject(new Error('all-branches-failed')); } },
      );
    });

  branches.push(startBranch(primary));
  let winner: Branch; let first: IteratorResult<string>;

  if (!useHedge) {
    // Não hedge: apenas await o primary's primeiro usable token (engine's próprio
    // ttftTimeoutMs ainda empacota isso chamar como o hard ceiling).
    ({ branch: winner, first } = await branches[0].firstUsable);
  } else {
    // Aguardar para o primário para win Ou o hedge atrasar para elapse.
    let hedgeTimer: ReturnType<typeof setTimeout> | null = null;
    const hedgeElapsed = new Promise<'hedge'>((resolve) => { hedgeTimer = setTimeout(() => resolve('hedge'), hedgeDelayMs); });
    const primaryOutcome = branches[0].firstUsable.then((v) => ({ kind: 'win' as const, v }), (e) => ({ kind: 'fail' as const, e }));

    const race = await Promise.race([primaryOutcome, hedgeElapsed]);
    if (hedgeTimer) clearTimeout(hedgeTimer);

    if (race !== 'hedge' && race.kind === 'win') {
      // Primário produced a usable token antes o hedge atrasar — não duplicate call.
      ({ branch: winner, first } = race.v);
    } else {
      // Qualquer um o atrasar elapsed (primário ainda pending) ou o primário failed
      // fast — launch o partner e race qualquer que seja é ainda live.
      log(`[Vision] hedge fired after ${hedgeDelayMs}ms → racing ${partner!.name}`);
      branches.push(startBranch(partner!));
      // If o primário já falhou fast, apenas o partner é em o race;
      // caso contrário race ambos still-pending primeiro tokens.
      const pool = (race !== 'hedge' && race.kind === 'fail')
        ? [branches[1].firstUsable]
        : [branches[0].firstUsable, branches[1].firstUsable];
      ({ branch: winner, first } = await firstSuccess(pool));
    }
  }

  // Abortar + fechar todo loser imediatamente (liberar socket/quota).
  for (const b of branches) {
    if (b !== winner) { try { b.ctrl.abort(new Error('hedge-lost')); } catch { } void closeIteratorBounded(b.it, cfg.cleanupTimeoutMs); }
  }
  recordVisionTtft(health, winner.id, now() - winner.started);
  if (branches.length > 1) log(`[Vision] hedge winner: ${winner.name} (ttft=${now() - winner.started}ms)`);

  // Re-inject o winning primeiro ttoken então delegate para its live sstream
  yield first.value as string;
  try {
    yield* { [Symbol.asyncIterator]: () => winner.it } as AsyncIterable<string>;
  } finally {
    await closeIteratorBounded(winner.it, cfg.cleanupTimeoutMs);
  }
}

/**
 * Executa o streaming vision alternativa sobre an already-ordered provedor llista
 * Yields conteúdo tokens de o primeiro provedor que produces a primeiro chunk.
 * Throws apenas quando todo provedor fails pre-commit (o caller turns que dentro de
 * a graceful user-facing memensagem
 */
export async function* runStreamingVisionFallback(
  orderedProviders: VisionStreamProvider[],
  cfg: VisionFallbackConfig,
  health: Map<string, VisionHealthEntry>,
  hooks: VisionFallbackHooks = {},
  abortSignal?: AbortSignal,
): AsyncGenerator<string, void, unknown> {
  const now = hooks.now ?? Date.now;
  const random = hooks.random ?? Math.random;
  const log = hooks.log ?? (() => { });
  const warn = hooks.warn ?? (() => { });
  const sleep = hooks.sleep ?? ((ms: number, signal?: AbortSignal) => new Promise<void>((resolve) => {
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); resolve(); };
    signal?.addEventListener('abort', onAbort, { once: true });
  }));

  if (orderedProviders.length === 0) {
    throw new Error('No vision-capable provider configured.');
  }

  const failures: string[] = [];

  // Time-bounded fechar de a provider's upstream iterator (módulo heauxiliar
  const closeIterator = (it: AsyncIterator<string> | null): Promise<void> =>
    closeIteratorBounded(it, cfg.cleanupTimeoutMs);

  for (const provider of orderedProviders) {
    let providerFatal = false;

    for (let attempt = 1; attempt <= cfg.maxAttempts && !providerFatal; attempt++) {
      if (abortSignal?.aborted) return;

      const ctrl = new AbortController();
      const onOuterAbort = () => { try { ctrl.abort(); } catch { } };
      abortSignal?.addEventListener('abort', onOuterAbort, { once: true });

      const attemptStart = now();
      let it: AsyncIterator<string> | null = null;
      let committed = false;

      try {
        // Hedge gagrupar quando habilitado e isso provedor declares a partner, o
        // primeiro usable token é raced através primary+partner (delayed launch).
        // Caso contrário plain single-provider oabrir Qualquer um way o engine's próprio TTFT
        // tempo limite abaixo empacota it como o hard ceiling.
        const src = (cfg.hedgeEnabled && provider.hedgeWith && (health.get(provider.id)?.openUntil ?? 0) <= now())
          ? openHedged(provider, cfg, health, hooks, ctrl.signal, attempt)
          : provider.open(ctrl.signal, attempt);
        it = src[Symbol.asyncIterator]();

        // ── Race chunk #1 contra o TTFT tempo limite (o apenas safe alternativa point) ──
        const firstNext = it.next();
        firstNext.catch(() => { }); // swallow late rejection if o timeout wins
        let ttftTimer: ReturnType<typeof setTimeout> | null = null;
        // Per-provider TTFT budget quando define (e.g. Pro é slower), senão configuração default.
        const providerTtftMs = provider.ttftTimeoutMs ?? cfg.ttftTimeoutMs;
        const ttft = new Promise<never>((_, rej) => {
          ttftTimer = setTimeout(() => { try { ctrl.abort(); } catch { } rej(new Error('ttft-timeout')); }, providerTtftMs);
        });
        let first: IteratorResult<string>;
        try {
          first = await Promise.race([firstNext, ttft]);
        } finally {
          if (ttftTimer) clearTimeout(ttftTimer);
        }

        if (first.done || typeof first.value !== 'string' || first.value.trim().length === 0) {
          throw new Error('empty-stream');
        }

        // ── COMMIT ──────────────────────────────────────────────────────────
        committed = true;
        recordVisionTtft(health, provider.id, now() - attemptStart);
        markVisionHealthy(health, provider.id);
        log(`[Vision] committed to ${provider.name} (attempt ${attempt}/${cfg.maxAttempts}, ttft=${now() - attemptStart}ms)`);
        yield first.value;

        // Drain — post-commit failures cannot trocar providers (iria duplicate
        // ousaída Todo exit abaixo funnels através o `finally` que aborta
        // o controlador e fecha o iterator, então não socket é esquerda dangling.
        while (true) {
          if (abortSignal?.aborted) return;
          let next: IteratorResult<string>;
          let stallTimer: ReturnType<typeof setTimeout> | null = null;
          try {
            const nextChunk = it.next();
            nextChunk.catch(() => { });
            const stall = new Promise<never>((_, rej) => {
              stallTimer = setTimeout(() => { try { ctrl.abort(); } catch { } rej(new Error('interchunk-stall')); }, cfg.interChunkTimeoutMs);
            });
            next = await Promise.race([nextChunk, stall]);
          } catch (drainErr: any) {
            warn(`[Vision] ${provider.name} interrupted mid-stream after commit: ${drainErr?.message || drainErr}`);
            return; // partial answer já delivered; fazer não duplicate via outro provedor
          } finally {
            if (stallTimer) clearTimeout(stallTimer);
          }
          if (next.done) return;
          if (typeof next.value === 'string' && next.value.length > 0) yield next.value;
        }
      } catch (err: any) {
        // A lançar após commit (e.g. consumidor .throw()) precisa Não acionar fallback.
        if (committed) return;
        // An outer cancelar mid-attempt isn't o provider's fault — don't penalize it.
        if (abortSignal?.aborted) return;

        // Pre-commit failure → safe para tentar novamente / fall voltar silently.
        const timedOut = ctrl.signal.aborted;
        const cls = classifyVisionError(err, timedOut);
        const detail = `${provider.name} attempt ${attempt}/${cfg.maxAttempts}: ${cls}`;
        warn(`[Vision] ${detail} (${err?.message || err})`);
        failures.push(detail);

        // Whole-chain aabortar quando o remaining providers iria fail para o Mesmo
        // reason (e.g. todo sibling shares one expired/no-credit API kechave para
        // imediatamente em vez disso de walking them. O `finally` abaixo ainda executa para
        // THIS atentar o lançar exits ambos loops então o caller pode fall através
        // para a diferente pprovedor Mark isso provedor unhealthy primeiro então it isn't
        // tried primeiro próximo time equalquer um
        if (cfg.stopChainOnError && cfg.stopChainOnError(err, cls)) {
          markVisionUnhealthy(health, provider.id, cfg.authCooldownMs, now());
          warn(`[Vision] ${provider.name}: ${cls} is fatal for the whole chain (shared-credential) — aborting remaining providers`);
          throw new Error(`Provider chain aborted (${cls}): ${err?.message || err}`);
        }

        if (cls === 'auth') {
          // Won't self-heal sem a configuração change — abrir o breaker llongo
          markVisionUnhealthy(health, provider.id, cfg.authCooldownMs, now());
          providerFatal = true;
        } else if (cls === 'no_vision' || cls === 'payload') {
          // Structurally incompatible com isso imagem — retrying won't help, and
          // demote it então it isn't tried primeiro em o próximo requisição equalquer um
          markVisionUnhealthy(health, provider.id, cfg.incompatibleCooldownMs, now());
          providerFatal = true;
        } else {
          // Transient (timeout/rate/network/server/unknown) → recuo + rtentar novamente
          if (attempt >= cfg.maxAttempts) {
            markVisionUnhealthy(health, provider.id, cfg.transientCooldownMs, now());
          } else {
            const ceiling = Math.min(cfg.backoffInitialMs * Math.pow(2, attempt), cfg.backoffMaxMs);
            await sleep(Math.floor(random() * ceiling), abortSignal);
          }
        }
      } finally {
        // Sempre release per-attempt resources em todo exit caminho (success,
        // commit-return, pre-commit error, timeout, outer aabortar ou o
        // orchestrator generator si mesmo sendo .return()-ed por its coconsumidor
        //   1. abortar o per-attempt controlador então o upstream SDK requisição é
        //      cancelled até em o non-timeout erro pcaminho and
        //   2. fechar o upstream iterator (time-bounded) então its finalmente blocks
        //      executa e não socket/connection leaks.
        abortSignal?.removeEventListener('abort', onOuterAbort);
        try { ctrl.abort(); } catch { /* ignorar */ }
        await closeIterator(it);
      }
    }
  }

  throw new Error(`All vision providers failed: ${failures.join(' | ') || 'no attempts made'}`);
}
