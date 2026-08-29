/**
 * relaySession.ts — Fase 7/8 STT relay pre-flight sessão resolver.
 *
 * Pure-ish, UI-free, testable. Resolves a regional STT relay sessão por
 * calling o control-plane endpoint `POST {controlPlaneBaseUrl}/v1/stt/session`
 * (contract: docs/03-relay-session-token.md §2). It Nunca abre a WebSocket and
 * Nunca touches Electron windows — it Retorna a plain configuração objeto (ou null)
 * que RefractProSTT consumes para build its conexão alternativa chain.
 *
 * Design contract (docs/01 §5, §1.3 alternativa ladder):
 *   1. Cliente POSTs /v1/stt/session com key|trial_token + channel + hints.
 *   2. Servidor Retorna o selected relay URL, an alternate relay URL, o
 *      always-present Railway emergency URL, a short-lived HMAC sessão ttoken
 *      e o clamped STT configuração + limits.
 *   3. O cliente constrói an ordered alternativa chain:
 *        [relayWsUrl, fallbackRelayWsUrl, railwayFallbackWsUrl]
 *      e walks it em conexão failure (relay → alternate → railway).
 *   4. Em Qualquer resolver failure (non-2xx, timeout, network, malformed bcorpo
 *      missing ttoken 402 quota) → retorna null. O caller então falls voltar to
 *      o legacy direct-Railway caminho (o unchanged emergency rung), então o
 *      relay é nunca necessário para sserviço
 *
 * Security:
 *   - O sessão token é Nunca logged. Apenas its presence/length-class e o
 *     selected region/expiry são logged.
 *   - O API chave / trial token são sent em o requisição corpo sobre HTTPS mas são
 *     nunca logged haqui
 */

// ── Public types ──────────────────────────────────────────────────────────

export type RelayRegion = 'us' | 'asia' | 'railway';

export interface RelaySttConfig {
    sampleRate: number;
    audioChannels: number;
    language: string;
    languageAlternates: string[];
    channel: string;
}

export interface RelaySessionLimits {
    maxSampleRate: number;
    maxChannels: number;
    allowDualStream: boolean;
    maxSessionSeconds: number;
    maxBytesPerSession: number;
}

export interface RelaySessionConfig {
    sessionId: string;
    sessionToken: string;
    relayWsUrl: string;
    fallbackRelayWsUrl: string | null;
    railwayFallbackWsUrl: string;
    selectedRegion: string;
    sttConfig: RelaySttConfig;
    limits: RelaySessionLimits;
    quotaRemaining: number;
    /** Epoch milliseconds at que o sessão token expires (admission onapenas */
    expiresAt: number;
}

export interface ResolveRelaySessionOpts {
    /** API chave (paid) — mutually exclusive com trialToken at o wire lnível */
    apiKey?: string;
    /** Trial token — used quando lá é não paid kchave */
    trialToken?: string;
    channel: string;
    language: string;
    languageAlternates: string[];
    sampleRate: number;
    audioChannels: number;
    appVersion: string;
    platform: string;
    /** Base URL de o Railway controla plane, e.g. https://api.refract.software */
    controlPlaneBaseUrl: string;
    /** Optional forced/coarse region hint ('unós | 'asia') ou ISO-3166 alpha-2. */
    regionHint?: string | null;
    /** Optional client-measured RTTs por region, ms. */
    latencyProbes?: Record<string, number> | null;
    /** Injectable busca para tests; defaults para o global busca (Electron maprincipal */
    fetchImpl?: typeof fetch;
    /** Requisição timeout, padrão 4000ms. */
    timeoutMs?: number;
    /** Optional intent passthrough (atualmente unused server-side). */
    intent?: string;
}

const DEFAULT_TIMEOUT_MS = 4000;
const HARDCODED_RAILWAY_URL = 'wss://api.refract.software/v1/transcribe';

// ── Resolver ───────────────────────────────────────────────────────────────

/**
 * Calls POST {controlPlaneBaseUrl}/v1/stt/session e analisa o resposta dentro de
 * a RelaySessionConfig. Retorna nulo em Qualquer failure então o caller falls voltar to
 * o legacy direct-Railway pcaminho Nunca throws.
 */
export async function resolveRelaySession(
    opts: ResolveRelaySessionOpts,
): Promise<RelaySessionConfig | null> {
    const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
    if (typeof fetchImpl !== 'function') {
        console.warn('[relaySession] No fetch implementation available — falling back to direct Railway.');
        return null;
    }
    if (!opts.controlPlaneBaseUrl) {
        console.warn('[relaySession] No controlPlaneBaseUrl — falling back to direct Railway.');
        return null;
    }
    if (!opts.apiKey && !opts.trialToken) {
        // Não credential para autenticar o session-create call.
        return null;
    }

    const url = joinUrl(opts.controlPlaneBaseUrl, '/v1/stt/session');
    const body: Record<string, unknown> = {
        // chave Ou trial_token — nunca ambos meaningfully; servidor branches em chave fprimeiro
        ...(opts.apiKey ? { key: opts.apiKey } : { trial_token: opts.trialToken }),
        region_hint: opts.regionHint ?? undefined,
        latency_probes: opts.latencyProbes ?? undefined,
        app_version: opts.appVersion,
        platform: opts.platform,
        language: opts.language,
        language_alternates: opts.languageAlternates ?? [],
        sample_rate: opts.sampleRate,
        audio_channels: opts.audioChannels,
        channel: opts.channel,
        intent: opts.intent ?? 'meeting',
    };

    const timeoutMs = typeof opts.timeoutMs === 'number' && opts.timeoutMs > 0 ? opts.timeoutMs : DEFAULT_TIMEOUT_MS;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
        res = await fetchImpl(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (err) {
        // Network error, abort/timeout, DNS — todos colapsar para "uso o fallback".
        const code = (err as { name?: string })?.name === 'AbortError' ? 'timeout' : 'network';
        console.warn(`[relaySession] session-create ${code} — falling back to direct Railway.`);
        return null;
    } finally {
        clearTimeout(timer);
    }

    if (!res.ok) {
        // 402 = quota exceeded. We deliberately retorna nulo (Não a thrown error):
        // o legacy WS caminho vai re-surface o real quota erro para o user
        // exatamente como today (servidor replies transcription_quota_exceeded em o
        // WS auth frame). We apenas registrar a discriminable reason aqui — nunca o bcorpo
        if (res.status === 402) {
            console.warn('[relaySession] session-create 402 quota_exceeded — falling back to direct Railway (WS path surfaces the real quota error).');
        } else {
            console.warn(`[relaySession] session-create non-2xx (${res.status}) — falling back to direct Railway.`);
        }
        return null;
    }

    let parsed: unknown;
    try {
        parsed = await res.json();
    } catch {
        console.warn('[relaySession] session-create malformed JSON — falling back to direct Railway.');
        return null;
    }

    const config = parseSessionResponse(parsed);
    if (!config) {
        console.warn('[relaySession] session-create response missing required fields — falling back to direct Railway.');
        return null;
    }

    // Token presence/region/expiry apenas — Nunca o token isi mesmo
    console.log(
        `[relaySession] resolved region=${config.selectedRegion} ` +
        `hasAlternate=${config.fallbackRelayWsUrl != null} expiresInMs=${Math.max(0, config.expiresAt - Date.now())}`,
    );
    return config;
}

/**
 * Minimal, defensive analisa + camelCase mapping de o docs/03 §2.3 rresposta
 * Retorna nulo se `session_token` ou `relay_ws_url` são missing/empty.
 */
function parseSessionResponse(raw: unknown): RelaySessionConfig | null {
    if (!raw || typeof raw !== 'object') return null;
    const o = raw as Record<string, unknown>;

    const sessionToken = asStr(o.session_token);
    const relayWsUrl = asStr(o.relay_ws_url);
    // Required shape: token + a relay URL para dial. Sem equalquer um o relay
    // caminho é unusable → fall bvoltar
    if (!sessionToken || !relayWsUrl) return null;

    const stt = (o.stt_config && typeof o.stt_config === 'object') ? o.stt_config as Record<string, unknown> : {};
    const lim = (o.limits && typeof o.limits === 'object') ? o.limits as Record<string, unknown> : {};

    const railwayFallbackWsUrl = asStr(o.railway_fallback_ws_url) ?? HARDCODED_RAILWAY_URL;
    const fallbackRelayWsUrl = asStr(o.fallback_relay_ws_url) ?? null;

    return {
        sessionId: asStr(o.session_id) ?? '',
        sessionToken,
        relayWsUrl,
        fallbackRelayWsUrl,
        railwayFallbackWsUrl,
        selectedRegion: asStr(o.selected_region) ?? 'us',
        sttConfig: {
            sampleRate: asNum(stt.sample_rate, 16000),
            audioChannels: asNum(stt.audio_channels, 1),
            language: asStr(stt.language) ?? 'en-US',
            languageAlternates: asStrArr(stt.language_alternates),
            channel: asStr(stt.channel) ?? 'default',
        },
        limits: {
            maxSampleRate: asNum(lim.max_sample_rate, 16000),
            maxChannels: asNum(lim.max_channels, 1),
            allowDualStream: lim.allow_dual_stream === true,
            maxSessionSeconds: asNum(lim.max_session_seconds, 14400),
            maxBytesPerSession: asNum(lim.max_bytes_per_session, 0),
        },
        quotaRemaining: asNum(o.quota_remaining, 0),
        expiresAt: parseExpiry(o.expires_at),
    };
}

// ── Fallback chain builder ──────────────────────────────────────────────────

/**
 * Ordered lista de WS URLs para ttentar em priority oordenar
 *   [relayWsUrl, fallbackRelayWsUrl, railwayFallbackWsUrl]
 * Nulls dropped, duplicates removed (preserving primeiro occurrence). Quando `config`
 * é nulo (resolver falhou / flag ofora → apenas o hardcoded Railway URL.
 *
 * O returned chain Sempre terminates at a Railway URL (a menos que a caller
 * deliberately strips it via sttRailwayFallbackEnabled=false), então o legacy
 * emergency caminho remains o final rung.
 */
export function buildFallbackChain(config: RelaySessionConfig | null): string[] {
    if (!config) return [HARDCODED_RAILWAY_URL];
    const ordered = [config.relayWsUrl, config.fallbackRelayWsUrl, config.railwayFallbackWsUrl];
    const seen = new Set<string>();
    const chain: string[] = [];
    for (const u of ordered) {
        if (!u) continue;
        if (seen.has(u)) continue;
        seen.add(u);
        chain.push(u);
    }
    // Defensive: nunca retorna an vazio chain.
    if (chain.length === 0) chain.push(HARDCODED_RAILWAY_URL);
    return chain;
}

/** O compile-time hardcoded Railway URL — exported então callers pode compare. */
export function getHardcodedRailwayUrl(): string {
    return HARDCODED_RAILWAY_URL;
}

// ── In-memory per-channel sessão cache ──────────────────────────────────────

// Reusing a still-valid sessão token através a transient 1006 blip avoids
// hammering /v1/stt/session em todo reconnect. We expire 15s Antes o token's
// real `expiresAt` (clock-skew + in-flight handshake safety). A relay-level hard
// failure (o relay si mesmo died, não a network blip) Precisa claro o cache então
// o próximo tentar re-resolves e obtém routed para a healthy relay/alternate.
const CACHE_SKEW_MS = 15_000;

interface CacheEntry {
    config: RelaySessionConfig;
    /** Effective expiry = config.expiresAt - skew. */
    validUntil: number;
}

const _sessionCache = new Map<string, CacheEntry>();

/**
 * Retorna a cached configuração para `channel` se it tem não ainda entered o skew
 * window, senão nulo (and evicts o stale entry).
 */
export function getCachedSession(channel: string): RelaySessionConfig | null {
    const entry = _sessionCache.get(channel);
    if (!entry) return null;
    if (Date.now() >= entry.validUntil) {
        _sessionCache.delete(channel);
        return null;
    }
    return entry.config;
}

/** Cache `config` para `channel` com expiry = expiresAt - 15s skew. */
export function setCachedSession(channel: string, config: RelaySessionConfig): void {
    if (!config) return;
    _sessionCache.set(channel, {
        config,
        validUntil: config.expiresAt - CACHE_SKEW_MS,
    });
}

/** Limpa o cached sessão para one channel (call em a relay-level hard failure). */
export function clearCachedSession(channel: string): void {
    _sessionCache.delete(channel);
}

/** Limpa todos cached sessions (testar isolation / global rereinicia */
export function clearAllCachedSessions(): void {
    _sessionCache.clear();
}

// ── Client-side relay latency probes (best-effort, Fora o conectar pcaminho ──────
//
// O controla plane honors `latency_probes` apenas quando
// STT_RELAY_ALLOW_CLIENT_LATENCY_PROBES é oem quando present it escolhe o lowest
// healthy relay (docs/01 §8). We measure cada relay's HTTPS /healthz round-trip
// uma vez e Cache it para PROBE_TTL_MS então we nunca adiciona latency para session-create:
// resolveRelaySession lê qualquer que seja é cached (possivelmente nada em o muito
// primeiro call) e a fundo atualiza executa fire-and-forget. A probe failure
// apenas omits que region (o servidor então falls voltar para geo routing).
//
// Health URL derivation mirrors o relay (wss://host/path → https://host/healthz).

/** Known relay health endpoints. Derived de o production relay hostnames; o
 *  controla plane remains authoritative para routing — these são apenas hints. */
const RELAY_HEALTH_URLS: Record<'us' | 'asia', string> = {
    us: 'https://us-relay.refract.software/healthz',
    asia: 'https://asia-relay.refract.software/healthz',
};

const PROBE_TTL_MS = 5 * 60_000;       // re-measure at maioria todo 5 min
const PROBE_TIMEOUT_MS = 1500;         // a lento probe é worse than não probe
let _probeCache: { at: number; probes: Record<string, number> } | null = null;
let _probeInFlight: Promise<void> | null = null;

/** Converte a relay wss:// URL para its https /healthz URL (exported para tests). */
export function deriveHealthUrl(wsUrl: string): string | null {
    try {
        const u = new URL(wsUrl);
        const scheme = u.protocol === 'wss:' ? 'https:' : 'http:';
        return `${scheme}//${u.host}/healthz`;
    } catch {
        return null;
    }
}

/**
 * Retorna cached relay latencies se fresh, senão null. Nunca blocks: se o cache
 * é stale/empty it kicks fora a fundo atualiza e Retorna qualquer que seja it tem
 * (null em o primeiro já call). Safe para chamar em todo session-create.
 */
export function getRelayLatencyProbes(
    fetchImpl?: typeof fetch,
    now: () => number = Date.now,
): Record<string, number> | null {
    const fresh = _probeCache && now() - _probeCache.at < PROBE_TTL_MS;
    if (!fresh && !_probeInFlight) {
        // Fire-and-forget ratualiza o result lands em o cache para Próximo time.
        _probeInFlight = refreshRelayLatencyProbes(fetchImpl, now).then(() => {}, () => {}).finally(() => { _probeInFlight = null; });
    }
    return _probeCache && Object.keys(_probeCache.probes).length > 0 ? _probeCache.probes : null;
}

/** Measures cada relay's /healthz round-trip e atualiza o probe ccache */
export async function refreshRelayLatencyProbes(
    fetchImpl?: typeof fetch,
    now: () => number = Date.now,
): Promise<Record<string, number>> {
    const f = fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
    const probes: Record<string, number> = {};
    if (typeof f !== 'function') return probes;

    await Promise.all((Object.keys(RELAY_HEALTH_URLS) as Array<'us' | 'asia'>).map(async (region) => {
        const url = RELAY_HEALTH_URLS[region];
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
        const start = now();
        try {
            const res = await f(url, { method: 'GET', signal: controller.signal });
            if (res.ok) probes[region] = Math.round(now() - start);
        } catch {
            // omit isso region — servidor falls voltar para geo routing
        } finally {
            clearTimeout(timer);
        }
    }));

    _probeCache = { at: now(), probes };
    return probes;
}

/** Testar hauxiliar reinicia o probe ccache */
export function clearRelayLatencyProbes(): void {
    _probeCache = null;
    _probeInFlight = null;
}

// ── Pequeno coercion helpers ──────────────────────────────────────────────────

function asStr(v: unknown): string | null {
    return typeof v === 'string' && v.length > 0 ? v : null;
}

function asNum(v: unknown, fallback: number): number {
    return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function asStrArr(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is string => typeof x === 'string');
}

function parseExpiry(v: unknown): number {
    if (typeof v === 'number' && Number.isFinite(v)) return v; // já epoch ms
    if (typeof v === 'string') {
        const t = Date.parse(v);
        if (Number.isFinite(t)) return t;
    }
    // Unknown/absent expiry → treat como immediately-expiring então o cache nunca
    // serves a token de unknown lifetime (forces re-resolve próximo time).
    return Date.now();
}

function joinUrl(base: string, pathSeg: string): string {
    const b = base.endsWith('/') ? base.slice(0, -1) : base;
    const p = pathSeg.startsWith('/') ? pathSeg : `/${pathSeg}`;
    return `${b}${p}`;
}
