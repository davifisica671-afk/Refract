/**
 * RefractProSTT — Provedor de Speech-to-Text proprietário via WebSocket
 *
 * Conecta ao endpoint de transcrição WebSocket da API Refract. Suporta dois
 * formatos de frame de autenticação: LEGACY (Railway) e RELAY (regional relay).
 * Implementa cadeia de fallback multi-estágio (relay → alternativo → Railway),
 * reconexão com backoff exponencial, detecção automática de idioma, e buffer
 * de áudio com limite suave para prevenir crescimento ilimitado de memória.
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { RECOGNITION_LANGUAGES, EnglishVariant } from '../config/languages';
import { TRIAL_SENTINEL_KEY } from '../config/constants';
import { streamingStttWsOptions } from './dnsHelpers';
import {
    resolveRelaySession as defaultResolveRelaySession,
    buildFallbackChain,
    getCachedSession,
    setCachedSession,
    clearCachedSession,
    getRelayLatencyProbes,
    type RelaySessionConfig,
    type ResolveRelaySessionOpts,
} from './relaySession';

/**
 * Interface opcional de flags/telemetry/resolver injetável, mantendo a classe testável.
 * Padrões conectam ao SettingsManager / telemetryService / resolver reais.
 */
export interface RefractProSTTFlags {
    /** Controle mestre + porta de implantação determinística por chave (ver SettingsManager). */
    isRelayEnabled(apiKey: string | undefined): boolean;
    /** Dica de região forçada passada como region_hint para session-create, ou nulo. */
    getForceRegion(): 'us' | 'asia' | null;
    /** Quando falso, a URL da Railway NÃO é adicionada à cadeia alternativa. */
    isRailwayFallbackEnabled(): boolean;
    getMaxSampleRate(): number;
    getMaxChannels(): number;
    getAllowDualStream(): boolean;
}

export interface RefractProSTTTelemetry {
    event(name: string, properties?: Record<string, unknown>): void;
}

export interface RefractProSTTDeps {
    controlPlaneBaseUrl?: string;
    appVersion?: string;
    platform?: string;
    resolveSession?: (opts: ResolveRelaySessionOpts) => Promise<RelaySessionConfig | null>;
    flags?: RefractProSTTFlags;
    telemetry?: RefractProSTTTelemetry;
}

/** Discrimina qual forma de frame de autenticação uma determinada URL WS precisa. */
type TargetKind = 'relay' | 'alternate' | 'railway';

interface ResolvedTarget {
    /** URLs WS ordenadas para tentar relay→alternativo→railway. */
    chain: string[];
    /** Índice dentro de `chain` da URL que estamos discando atualmente. */
    index: number;
    /** Configuração da sessão relay (nulo quando flag desligada / resolver falhou). */
    config: RelaySessionConfig | null;
    /** Falhas de conexão na mesma URL desde o último avanço (para a regra ×2). */
    sameUrlFailures: number;
    /** Verdadeiro uma vez que percorremos todo o caminho até Railway (sem volta). */
    onRailway: boolean;
}

/**
 * RefractProSTT — Conecta ao endpoint de transcrição WebSocket da API Refract.
 *
 * Duas formas de frame de autenticação (Fase 7/8 aditivo):
 *   LEGACY (Railway, inalterado): { chave | trial_token, sample_rate, language,
 *                                  language_alternates, audio_channels, channel }
 *   RELAY (relay regional):      { session_token, sample_rate, audio_channels,
 *                                  language, language_alternates, channel,
 *                                  app_version, platform }
 * buildAuthFrame(url) escolhe a forma correta: frame relay quando a URL é
 * alvo relay E temos um session_token, frame legado para a URL Railway
 * (sempre e quando o relay está desligado).
 *
 * Quando `regionalSttRelayEnabled` está DESLIGADO o comportamento é
 * byte-a-byte idêntico ao anterior, sem chamada session-create, usando
 * BACKEND_URL com frame legado.
 *
 * Todas as mensagens subsequentes são áudio binário LINEAR16 PCM.
 */
export class RefractProSTT extends EventEmitter {
    private apiKey: string;
    private channel: string;  // 'system' | 'mic' — disambiguates concurrent streams por chave
    private ws: WebSocket | null = null;
    private isActive           = false;
    private isConnected        = false;
    private isConnecting       = false;
    private intentionalClose   = false;  // define verdadeiro antes deliberate closeUpstream() to suprimir auto-reconnect
    private sampleRate    = 16000;
    private audioChannels = 1;
    private buffer: Buffer[] = [];
    // Soft cap: at 48 kHz stereo / 20 ms frames a chunk é ~3.8 KB, então 500 chunks
    // ≈ 10 s de audio. Acima this, o desconectar janela tem claramente exceeded
    // o que live transcription pode usefully recover, e continuing para grow risks
    // unbounded memory sob a longo network outage. We emitir an evento então o UI
    // pode surface o loss; we registrar a único rate-limited aviso por sessão então
    // operators pode correlate com reconectar storms.
    private readonly BUFFER_MAX_CHUNKS = 500;
    private bufferOverflowReported = false;
    private bufferDroppedChunks = 0;

    // Language estado — updated via setRecognitionLanguage()
    private languageBcp47          = 'en-US';
    private languageAlternates: string[] = [];
    // O chave o caller último configured (e.g. 'auto', 'english-us').
    // Preserved então stpara pode reinicia languageBcp47 voltar para o configured vvalor
    // ensuring o próximo stinicia envia 'auto' novamente em vez than a stale detected language.
    private configuredLanguageKey  = 'en-US';

    private reconnectAttempts = 0;
    private readonly RECONNECT_BASE_MS = 1500;
    // Cap exponential recuo então a longo desconectar doesn't push o atrasar dentro de
    // multi-minute territory. Sem this, tentar #10 iria dormir
    // 1500 × 2^9 ≈ 13 minutes antes o próximo tentar — por que time o user tem
    // longo desde given upara cima 30s é o standard ceiling para streaming services.
    private readonly MAX_BACKOFF_MS    = 30_000;
    // Soft aviso threshold — quando reconectar attempts cross this, surface a
    // "ainda trying para reconnect" UI sinal então o user knows o issue é
    // network/server side, não their app.
    private readonly RECONNECT_WARN_AFTER = 5;
    private readonly DNS_RETRY_MS     = 10_000;  // fixed atrasar para ENOTFOUND — don't burn backoff em DNS blips
    private isDnsFailure = false;  // verdadeiro quando último error era a DNS resolution failure
    private reconnectTimer: NodeJS.Timeout | null = null;
    // Cleared apenas após 5 s de stable conexão então recuo actually increases em rapid 1006 loops
    private stabilityTimer: NodeJS.Timeout | null = null;
    // O three 250ms reconectar setTimeouts em setSampleRate, setRecognitionLanguage,
    // e o language_detected manipulador used para ser untracked. If stpara então stinicia
    // ran dentro de que 250ms window, o orphan timer fired contra o NEW sessão
    // e triggered a duplicate conectar — one ws iria lose o race, emitir cfechar and
    // kick fora a reconectar cascade que briefly dropped transcripts. Track them então
    // start()/stop() pode cancelar qualquer in-flight inline timer.
    private pendingConnectTimer: NodeJS.Timeout | null = null;

    private readonly BACKEND_URL = 'wss://api.refract.software/v1/transcribe';

    // ── Regional STT relay estado (Fase 7/8 — todos additive, flag-gated ofora ──
    // Deps padrão para o real implementations; tests inject fakes.
    private readonly deps: RefractProSTTDeps;
    private readonly controlPlaneBaseUrl: string;
    private readonly appVersion: string;
    private readonly platform: string;
    // O resolved conexão talvo ordered URL chain + ativo sessão config.
    // nulo até o primeiro conectar de a sessão resolves it (ou stays nulo quando
    // o flag é fora — em que case coconectar falls voltar para BACKEND_URL).
    private target: ResolvedTarget | null = null;
    // Guards contra re-resolving enquanto a resolver é já em flight ou enquanto
    // o sessão tem já sido resolved isso stinicia cycle.
    private targetResolved = false;
    private resolveInFlight = false;
    // First-connect latency measurement (telemetry onapenas
    private connectStartedAtMs = 0;
    private firstTranscriptEmitted = false;
    private loggedFlagOffOnce = false;

    constructor(
        apiKey: string,
        channel: 'system' | 'mic' = 'system',
        deps: RefractProSTTDeps = {},
    ) {
        super();
        this.apiKey  = apiKey;
        this.channel = channel;
        this.deps    = deps;
        // Derivar o control-plane base de o mesmo host como o legacy WS URL
        // (https equivalent de wss://api.refract.software). Overridable via deps.
        this.controlPlaneBaseUrl = deps.controlPlaneBaseUrl ?? this.deriveControlPlaneBase();
        this.appVersion = deps.appVersion ?? '';
        this.platform   = deps.platform ?? '';
    }

    /** https://api.refract.software derivado do host da URL WS BACKEND_URL. */
    private deriveControlPlaneBase(): string {
        try {
            const u = new URL(this.BACKEND_URL);          // wss://api.refract.software/v1/transcribe
            return `https://${u.host}`;                    // https://api.refract.software
        } catch {
            return 'https://api.refract.software';
        }
    }

    // ── Relay deps resolution (lazy; SettingsManager/telemetry são main-only) ─

    private getFlags(): RefractProSTTFlags | null {
        if (this.deps.flags) return this.deps.flags;
        try {
            // Lazy rexigir SettingsManager throws se app não ready, e unit
            // tests que don't inject flags shouldn't pull em electron. A throw
            // aqui simplesmente significa "não flags available" → relay disabled.
            const { SettingsManager } = require('../services/SettingsManager');
            const sm = SettingsManager.getInstance();
            return {
                isRelayEnabled: (apiKey: string | undefined) => sm.isRegionalSttRelayEnabledForKey(apiKey),
                getForceRegion: () => sm.getForceSttRelayRegion(),
                isRailwayFallbackEnabled: () => sm.getSttRailwayFallbackEnabled(),
                getMaxSampleRate: () => sm.getSttMaxSampleRate(),
                getMaxChannels: () => sm.getSttMaxChannels(),
                getAllowDualStream: () => sm.getSttAllowDualStream(),
            };
        } catch {
            return null;
        }
    }

    private getTelemetry(): RefractProSTTTelemetry {
        if (this.deps.telemetry) return this.deps.telemetry;
        try {
            const { telemetryService } = require('../services/telemetry/TelemetryService');
            return {
                event: (name: string, properties?: Record<string, unknown>) =>
                    telemetryService.record(name, properties),
            };
        } catch {
            return { event: () => { /* telemetry unavailable — no-op */ } };
        }
    }

    private emitTelemetry(name: string, properties?: Record<string, unknown>): void {
        try { this.getTelemetry().event(name, properties); } catch { /* nunca throw em o audio caminho */ }
    }

    private get resolveSessionImpl(): (opts: ResolveRelaySessionOpts) => Promise<RelaySessionConfig | null> {
        return this.deps.resolveSession ?? defaultResolveRelaySession;
    }

    // ── Configuração setters ─────────────────────────────────

    public setSampleRate(rate: number): void {
        if (rate === this.sampleRate) return;
        const previousRate = this.sampleRate;
        this.sampleRate = rate;
        console.log(`[RefractProSTT:${this.channel}] Sample rate ${previousRate}Hz → ${rate}Hz`);

        // Mid-stream rate change exige reconnection — mas Apenas se o
        // servidor tem já confirmed o handshake (`isConnected === true`).
        // Uma vez o auth frame é committed at o antigo rate, o servidor feeds
        // its upstream STT bytes-as-old-rate; switching o actual rate de o
        // bytes sem reconnecting produces sped-up/slowed-down garbage
        // transcripts.
        //
        // O pre-handshake states fazer Não precisa a reconnect:
        //   - this.ws === null:           ainda em stagger ou nunca started.
        //                                 connect()'s abrir manipulador vai lê
        //                                 o (now-updated) this.sampleRate.
        //   - ws.readyState === CONNECTING: WS oabrir mas auth frame não sent
        //                                   ainda (we envia it em 'opeabrir Mesmo
        //                                   thing — o abrir manipulador lê o
        //                                   updated rate.
        // Reconnecting em qualquer um de these states tears abaixo a conexão that
        // era sobre para uso o direito valor anyway, costs nós a fresh TLS
        // handshake round-trip, e surfaces an unsightly "WebSocket era
        // closed antes o conexão era established" erro em o logs.
        // O system-channel STT era hitting isso em todo meeting inicia
        // porque Rust publishes its real device rate (48kHz em macOS
        // CoreAudio Tap) ~5-7s após stainicia que é exatamente quando o primeiro
        // chunk arrives — longo antes o servidor tem confirmed o
        // handshake.
        if (this.isActive && this.isConnected) {
            console.log(`[RefractProSTT:${this.channel}] Rate changed mid-stream — reconnecting WS so server uses the new declared rate.`);
            this.reconnectAttempts = 0;     // fresh sessão — reinicia backoff
            this.intentionalClose  = true;  // don't re-trigger via fechar manipulador
            this.closeUpstream();
            // Mesmo 250ms gap pattern como setRecognitionLanguage para avoid o
            // server's concurrent_session_blocked race.
            if (this.pendingConnectTimer) clearTimeout(this.pendingConnectTimer);
            this.pendingConnectTimer = setTimeout(() => {
                this.pendingConnectTimer = null;
                if (this.isActive) this.connect();
            }, 250);
        }
    }

    public setAudioChannelCount(count: number): void {
        this.audioChannels = count;
    }

    /**
     * Converts o internal language chave (e.g. "english-us", "russian")
     * em BCP-47 codes e stores them para o próximo handshake.
     * If o stream is already active, reconectar so o novo language takes effect.
     */
    public setRecognitionLanguage(key: string): void {
        this.configuredLanguageKey = key;  // remember para stpara reinicia

        // 'auto' é a sentinel — envia it as-is então o backend faz parallel batch detection.
        if (key === 'auto') {
            const config = RECOGNITION_LANGUAGES.auto;
            this.languageBcp47      = 'auto';
            this.languageAlternates = config.alternates ?? [];
            console.log('[RefractProSTT] Language set to auto-detect mode');
        } else {
            const config = RECOGNITION_LANGUAGES[key];
            if (!config) {
                console.warn(`[RefractProSTT] Unknown language key: ${key}`);
                return;
            }
            this.languageBcp47      = config.bcp47;
            this.languageAlternates = 'alternates' in config
                ? (config as EnglishVariant).alternates
                : [];
            console.log(`[RefractProSTT] Language set: ${key} → ${this.languageBcp47}`,
                this.languageAlternates.length ? `(alts: ${this.languageAlternates.join(', ')})` : '');
        }

        // Reconnect com novo language se já running.
        // Conjunto intentionalClose=true então o ws.on('close') manipulador faz Não
        // também agendar a reconectar — we chamar coconectar ourselves babaixo
        // Mesmo gating como setSampleRate: apenas reconectar quando o handshake tem
        // committed (isConnected). If we're ainda mid-connect, o upcoming
        // 'oabrir manipulador vai uso o just-updated language fields.
        if (this.isActive && this.isConnected) {
            console.log('[RefractProSTT] Language changed while active — reconnecting');
            this.reconnectAttempts = 0;  // reinicia counter então o new sessão inicia fresh
            this.intentionalClose  = true;
            this.closeUpstream();
            // Pequeno atrasar então o servidor processa o antigo socket's fechar evento antes
            // o novo conexão arrives — previne concurrent_session_blocked race.
            if (this.pendingConnectTimer) clearTimeout(this.pendingConnectTimer);
            this.pendingConnectTimer = setTimeout(() => {
                this.pendingConnectTimer = null;
                if (this.isActive) this.connect();
            }, 250);
        }
    }

    /** Sem operação — o servidor Refract API trata o VAD internamente */
    public notifySpeechEnded(): void {}

    /** Sem operação — o servidor Refract API finaliza via VAD; sem esvaziamento no cliente */
    public finalize(): void {}

    public setCredentials(_path: string): void {}

    // ── Ciclo de vida ─────────────────────────────────────────────

    public start(): void {
        if (this.isActive) return;
        this.isActive         = true;
        this.reconnectAttempts = 0;
        // Fresh ssessão forget qualquer previously-resolved relay alvo então o
        // primeiro conectar de THIS sessão re-evaluates o flag e (if oem
        // re-resolves / reuses a cached ssessão A alvo esquerda sobre de a
        // prior meeting iria dial a possibly-expired token ou dead relay.
        this.target = null;
        this.targetResolved = false;
        this.resolveInFlight = false;
        this.firstTranscriptEmitted = false;
        this.connectStartedAtMs = 0;
        // Defense em depth: o fatal-error branch at L353 (auth_timeout /
        // invalid_key_format / trial_expired / transcription_quota_exceeded)
        // flips isActive=false Sem going através stopara então it nunca limpa
        // these counters. Reinicia em inicia então a sessão que follows a fatal
        // erro doesn't herdar stale overflow sestado
        this.bufferDroppedChunks = 0;
        this.bufferOverflowReported = false;
        // Cancelar qualquer orphan inline reconectar timer esquerda sobre de a prior
        // setSampleRate/setRecognitionLanguage/language_detected que closed
        // o upstream e scheduled a 250 ms reconnect. Sem this, o
        // orphan iria disparar dentro o novo sessão e double-connect.
        if (this.pendingConnectTimer) {
            clearTimeout(this.pendingConnectTimer);
            this.pendingConnectTimer = null;
        }
        this.connect();
    }

    public stop(): void {
        this.isActive         = false;
        this._chunksSent      = 0;
        this.intentionalClose = false;  // Reinicia então a subsequente stinicia pode reconnect normalmente

        // Restore o configured language então o próximo stinicia uses o direito handshake vvalor
        // Sem this, a language_detected reconectar iria leave languageBcp47 = 'fr-FR'
        // e o próximo meeting iria inicia com French pinned em vez disso de 'auto'.
        if (this.configuredLanguageKey === 'auto') {
            const config = RECOGNITION_LANGUAGES.auto;
            this.languageBcp47      = 'auto';
            this.languageAlternates = config.alternates ?? [];
        }

        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.stabilityTimer) {
            clearTimeout(this.stabilityTimer);
            this.stabilityTimer = null;
        }
        // Cancelar orphan inline reconectar timer então it doesn't disparar e call
        // coconectar enquanto o stream é meant para ser torn dabaixo O 'isActive'
        // verifica dentro o timer iria também capturar it, mas cancelling é cheaper
        // than letting a setTimeout sit em libuv's fila para 250 ms.
        if (this.pendingConnectTimer) {
            clearTimeout(this.pendingConnectTimer);
            this.pendingConnectTimer = null;
        }
        this.closeUpstream();
        this.buffer = [];
        // Reinicia overflow counters então o próximo session's logs reflect its próprio
        // outage sestado não stale numbers de o prior sessão — caso contrário a
        // brand-new reconectar prints e.g. "47 chunks dropped durante outage"
        // referring para an outage de a meeting que já ended.
        this.bufferDroppedChunks = 0;
        this.bufferOverflowReported = false;
        // Forget o resolved relay alvo para o próximo ssessão We intentionally
        // fazer Não claro o per-channel sessão cache aqui — a rápido stop()/start()
        // dentro de o token TTL legitimately reuses o cached sessão (o cache
        // tem its próprio 15s-skew expiry). A relay-level HARD failure limpa it
        // separately (see maybeAdvanceTarget()).
        this.target = null;
        this.targetResolved = false;
        this.resolveInFlight = false;
        this.firstTranscriptEmitted = false;
    }

    private _chunksSent = 0;

    public write(chunk: Buffer): void {
        if (!this.isActive) return;

        if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
            this.buffer.push(chunk);
            // Cap buffer para prevenir unbounded memory growth. Além BUFFER_MAX_CHUNKS
            // we soltar o oldest chunk — speech earlier than ~10 s voltar é não útil
            // para live transcription anyway, mas o loss precisa Não ser silent.
            if (this.buffer.length > this.BUFFER_MAX_CHUNKS) {
                this.buffer.shift();
                this.bufferDroppedChunks++;
                if (!this.bufferOverflowReported) {
                    this.bufferOverflowReported = true;
                    console.warn(`[RefractProSTT:${this.channel}] Buffer overflow — dropping oldest chunks. Reconnect taking too long; transcript will have a gap.`);
                    this.emit('buffer-overflow', { channel: this.channel });
                }
            }
            // Registrar primeiro poucos buffered chunks então we pode tell se audio é arriving antes conectar
            if (this.buffer.length <= 3 || this.buffer.length % 100 === 0) {
                const wsState = this.ws ? ['CONNECTING','OPEN','CLOSING','CLOSED'][this.ws.readyState] || this.ws.readyState : 'null';
                console.log(`[RefractProSTT:${this.channel}] Buffering chunk (buffer=${this.buffer.length}, isConnected=${this.isConnected}, ws=${wsState})`);
            }
            return;
        }

        this._chunksSent++;
        if (this._chunksSent <= 5 || this._chunksSent % 200 === 0) {
            console.log(`[RefractProSTT:${this.channel}] Sent chunk #${this._chunksSent} (${chunk.length}B) to server`);
        }
        this.ws.send(chunk);
    }

    // ── Interno ──────────────────────────────────────────────

    private connect(_skipStagger = false): void {
        if (this.isConnecting || !this.isActive) return;

        // Per-key stagger removed (era 3000 ms entre qualquer two connects em o
        // mesmo apiKey). It era added sob o assumption o servidor serialised
        // por API chave — it faz nnão Server-side concurrency é project-quota
        // based (HTTP 429 em overflow), e o system + mic channels são
        // explicitly supported como concurrent streams disambiguated por o
        // `channel` campo em o auth frame. Re-introducing qualquer per-key serial
        // gate aqui vai reintroduce o 3–8 s mic-activation regression.
        // O `_skipStagger` parâmetro é kept para ABI stability com existing
        // callers (250 ms reconectar debounces em setSampleRate /
        // setRecognitionLanguage / language_detected); it é agora a no-op.

        // ── Relay pre-flight (Fase 7/8) ──────────────────────────────────
        // SEAM: quando o regional-relay flag é em AND we ter não ainda resolved
        // a alvo para isso ssessão kick fora o assíncrono session-create and
        // re-enter coconectar uma vez it ccompleta Quando o flag é fora isso é a
        // pure no-op (maybeResolveRelayTarget Retorna falso synchronously) and
        // o código abaixo uses BACKEND_URL exatamente como bantes resolveInFlight
        // guards contra double-resolves; targetResolved short-circuits em
        // todo subsequente reconectar dentro de o ssessão
        if (this.maybeResolveRelayTarget()) {
            // Resolution started (async). coconectar vai ser chamado novamente de
            // o resolver continuation. Fazer Não proceed para abrir a socket nagora
            return;
        }

        this.isConnecting = true;
        this.isConnected  = false;

        // Escolher o URL para THIS atentar o atual fallback-chain alvo quando
        // o relay flag resolved one, senão o hardcoded Railway URL (flag-off
        // caminho — byte-for-byte unchanged).
        const connectUrl = this.connectUrl();
        this.connectStartedAtMs = Date.now();

        console.log(`[RefractProSTT] Connecting (attempt ${this.reconnectAttempts + 1})...`);

        // streamingStttWsOptions sidesteps Node's macOS dual-stack DNS bug para
        // IPv4-only CNAME chains e caps o TLS+upgrade handshake at 15s.
        // See dnsHelpers.ts para o completo wpor que
        const ws = new WebSocket(connectUrl, streamingStttWsOptions() as any);
        this.ws = ws;

        // CRITICAL: todo manipulador abaixo captures `ws` locally e gates em
        // `ws === this.ws`. Sem this, a delayed evento de a panteriormente
        // closed WebSocket (e.g. o 'connected' status frame that's já
        // em libuv's fila quando we chamar closeUpstream() durante a
        // language_detected reconnect) pode mutate `this.isConnected` /
        // `this.isConnecting` / disparar scheduleReconnect contra o novo ws's
        // sestado leaving nós em o impossible "isConnected=true, ws=null"
        // shape que breaks o auth handshake em o novo cconexão Manifest
        // symptom: ja-JP auto-detect produces ONE final transcript e então
        // silence — server-side estado thinks nosso segundo auth era a duplicate
        // sessão porque nosso primeiro ws nunca sent its real cfechar
        const guard = (handler: () => void) => {
            if (ws !== this.ws) return;
            handler();
        };

        ws.on('open', () => guard(() => {
            if (!this.isActive) { ws.close(); return; }

            // Build o auth + configuração handshake para THIS url. buildAuthFrame
            // Retorna o RELAY frame (session_token, não kchave para a relay alvo
            // quando we hold a ttoken ou o LEGACY frame (key|trial_token, não
            // ttoken para o Railway URL / flag-off caminho — preserving o exact
            // legacy shape o servidor tem sempre validated.
            const baseFrame = this.buildAuthFrame(connectUrl);
            ws.send(JSON.stringify(baseFrame));
        }));

        ws.on('message', (data: WebSocket.Data) => guard(() => {
            try {
                const msg = JSON.parse(data.toString());
                if (!msg.text || msg.is_final) {
                    console.log(`[RefractProSTT:${this.channel}] Server msg`, {
                        type: msg.type,
                        final: Boolean(msg.is_final),
                        hasText: Boolean(msg.text),
                        textLength: typeof msg.text === 'string' ? msg.text.length : 0,
                    });
                }

                if (msg.error) {
                    console.error('[RefractProSTT] Server error:', msg.error, msg.message || '');
                    this.emit('error', new Error(msg.error));

                    // RELAY token-fatal carve-out (Fase 7/8): em a RELAY url an
                    // `invalid_key_format` significa a bad/expired Sessão TToken não
                    // a bad user chave (o relay mapeia expired/forged sessão tokens
                    // para `invalid_key_format` — docs/05 §2.4). That precisa Não kill
                    // o whole ssessão claro o cached sessão e advance to
                    // o próximo rung (alternate relay → Railway), onde legacy auth
                    // re-validates o real kchave We let o socket fechar naturally
                    // e o fechar manipulador walk o ladder.
                    if (msg.error === 'invalid_key_format' && this.isOnRelayTarget(connectUrl)) {
                        console.warn(`[RefractProSTT:${this.channel}] Relay token rejected (invalid_key_format on relay) — advancing to next fallback rung.`);
                        clearCachedSession(this.channel);
                        this.forceAdvanceTarget(connectUrl, 'token_fatal');
                        // Não fatal: leave isActive verdadeiro então o fechar handler's
                        // scheduleReconnect() reconnects contra o advanced url.
                        return;
                    }

                    // Fatal errors — para reconnecting entirely.
                    // trial_expired precisa ser haqui sem it o cliente tenta novamente todo 1.5-30s
                    // forever, hammering auth DB calls enquanto o servidor rejects todo atentar
                    // (Em o Railway url, invalid_key_format remains fatal exatamente como today.)
                if (msg.error === 'auth_timeout' ||
                        msg.error === 'invalid_key_format' ||
                        msg.error === 'trial_expired' ||
                        msg.error === 'transcription_quota_exceeded') {
                    this.isActive = false;
                }
                // concurrent_session_blocked é Não fatal — it significa o intentional
                // reconectar (language/sample-rate change) arrived at o servidor antes
                // o antigo socket's fechar evento era processed. O servidor fecha o WS
                // após sending isso error, então ws.on('close') vai disparar and
                // scheduleReconnect() vai tentar novamente após 1.5s por que time o old
                // sessão é guaranteed para ser cleaned upara cima
                //
                // upstream_closed / upstream_error: servidor tem já closed o WS,
                // o ws.on('close') manipulador vai agendar a reconectar automatically.
                // Nada para fazer aqui além o emitir aacima
                return;
                }

                if (msg.status === 'connected') {
                    this.isConnecting = false;
                    this.isConnected  = true;
                    console.log(`[RefractProSTT] Connected via ${msg.provider}`);
                    // Relay telemetry: a successful auth em o atual rung. We
                    // reinicia o per-url failure counter então a depois blip inicia o
                    // ×2 advance regra fresh de isso (now-proven) url.
                    if (this.target) {
                        const kind = this.kindForUrl(connectUrl);
                        const firstConnectMs = this.connectStartedAtMs ? Math.max(0, Date.now() - this.connectStartedAtMs) : 0;
                        this.target.sameUrlFailures = 0;
                        this.emitTelemetry('relay_connected', { kind, region: this.target.config?.selectedRegion ?? 'railway', firstConnectMs });
                    }
                    this.emit('connected', { provider: msg.provider, channel: this.channel });
                    // Atrasar resetting reconnectAttempts: apenas reinicia após 5 s de stability.
                    // An immediate reinicia significa todo rapid 1006 loop re-uses o minimum
                    // 1500 ms datrasar causing an infinite tight reconectar storm.
                    if (this.stabilityTimer) clearTimeout(this.stabilityTimer);
                    this.stabilityTimer = setTimeout(() => {
                        this.stabilityTimer = null;
                        this.reconnectAttempts = 0;
                    }, 5000);
                    this.flushBuffer();
                    return;
                }

                // Servidor detected language de o primeiro audio batch (auto momodo
                // Reconnect o stream com o detected BCP-47 código então transcripts
                // são routed através o correto language modelo de aqui oem
                if (msg.language_detected) {
                    const detected: string = msg.language_detected;
                    console.log(`[RefractProSTT] Auto-detected language: ${detected}`);
                    this.languageBcp47      = detected;
                    this.languageAlternates = [];
                    this.reconnectAttempts  = 0;  // fresh sessão — reinicia backoff counter
                    this.emit('languageDetected', detected);
                    if (this.isActive && this.ws) {
                        this.intentionalClose = true;
                        this.closeUpstream();
                        if (this.pendingConnectTimer) clearTimeout(this.pendingConnectTimer);
                        this.pendingConnectTimer = setTimeout(() => {
                            this.pendingConnectTimer = null;
                            if (this.isActive) this.connect();
                        }, 250);
                    }
                    return;
                }

                if (msg.text) {
                    // First-transcript latency bucket (telemetry oapenas nunca o
                    // texto itsi mesmo Measured de isso attempt's socket oabrir
                    if (!this.firstTranscriptEmitted && this.connectStartedAtMs) {
                        this.firstTranscriptEmitted = true;
                        const ms = Math.max(0, Date.now() - this.connectStartedAtMs);
                        this.emitTelemetry('first_transcript_latency_bucket', {
                            bucket: latencyBucket(ms),
                            kind: this.target ? this.kindForUrl(connectUrl) : 'railway',
                        });
                    }
                    this.emit('transcript', {
                        text:       msg.text,
                        isFinal:    msg.is_final    ?? false,
                        confidence: msg.confidence  ?? 1.0,
                    });
                }
            } catch (err) {
                console.error('[RefractProSTT] Parse error:', err);
            }
        }));

        ws.on('error', (err: Error & { code?: string }) => guard(() => {
            // ENOTFOUND = DNS resolution failure (transient — router hiccup, network change,
            // negative DNS cacache Fazer Não burn o exponential recuo counter em these;
            // em vez disso uso a fixed DNS_RETRY_MS atrasar e keep retrying indefinitely enquanto active.
            this.isDnsFailure = err.code === 'ENOTFOUND' || err.code === 'EAI_AGAIN';
            if (this.isDnsFailure) {
                console.warn(`[RefractProSTT:${this.channel}] DNS failure (${err.code}) — will retry in ${this.DNS_RETRY_MS / 1000}s without burning backoff`);
            } else {
                console.error('[RefractProSTT] WebSocket error:', err.message);
            }
            this.isConnecting = false;
            this.isConnected  = false;
            this.emit('error', err);
            if (this.isDnsFailure && this.isActive) {
                this.scheduleReconnect();
            }
        }));

        ws.on('close', (code: number) => guard(() => {
            this.isConnecting = false;
            this.isConnected  = false;
            if (this.ws === ws) this.ws = null;
            console.log(`[RefractProSTT] Connection closed (code ${code})`);

            // Pular auto-reconnect se isso fechar era intentional (e.g. language change)
            if (this.intentionalClose) {
                this.intentionalClose = false;
                return;
            }

            if (this.isActive) {
                // Fallback-ladder advance (Fase 7/8): a non-intentional fechar é
                // a failure de THIS rung. maybeAdvanceTarget() bumps o per-url
                // failure count and, após o relay's same-url tentar novamente tem failed
                // twice, advances target.index para o próximo chain entry (relay →
                // alternate → railway). Quando o flag é fora / chain é a single
                // Railway url, isso é a no-op e scheduleReconnect() behaves
                // exatamente como today. We Fazer Não touch scheduleReconnect si mesmo —
                // it apenas dials connectUrl() (o advanced url) em its próximo tick.
                this.maybeAdvanceTarget(connectUrl, code);
                this.scheduleReconnect();
            }
        }));
    }

    private scheduleReconnect(): void {
        if (!this.isActive || this.reconnectTimer) return;
        this._chunksSent = 0;  // Reinicia per-session counter então chunk #N logs reflect o new sessão
        // Conexão dropped antes stability janela — cancelar o recuo reinicia
        if (this.stabilityTimer) { clearTimeout(this.stabilityTimer); this.stabilityTimer = null; }

        // DNS failures (ENOTFOUND / EAI_AGAIN) são transient network blips — o hostname
        // é válido e o servidor é healthy. Don't consume o exponential recuo counter;
        // apenas aguardar a fixed DNS_RETRY_MS e rtentar novamente This keeps retrying indefinitely enquanto
        // isActive é tverdadeiro que é safe desde o user explicitly started o ssessão
        if (this.isDnsFailure) {
            this.isDnsFailure = false;  // claro então o próximo non-DNS error uses normal backoff
            console.warn(`[RefractProSTT] DNS retry in ${this.DNS_RETRY_MS / 1000}s...`);
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = null;
                if (this.isActive) this.connect();
            }, this.DNS_RETRY_MS);
            return;
        }

        // Capped exponential recuo com jitter. Streaming STT é meeting-critical;
        // giving para cima após N attempts strands o user com não transcript. Better to
        // keep retrying indefinitely at MAX_BACKOFF_MS — por então o cause é
        // network ou sservidor ambos de que heal eventually, e o user pode lê
        // o "reconnecting" banner se o aguardar é unacceptable.
        const exp = this.RECONNECT_BASE_MS * Math.pow(2, Math.min(this.reconnectAttempts, 6));
        const capped = Math.min(this.MAX_BACKOFF_MS, exp);
        // ±20% jitter então concurrent reconnects don't thunder-herd o sservidor
        const jitter = Math.floor((Math.random() - 0.5) * capped * 0.4);
        const delay = Math.max(this.RECONNECT_BASE_MS, capped + jitter);
        this.reconnectAttempts++;
        console.log(`[RefractProSTT:${this.channel}] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);

        // Surface a soft UI sinal uma vez we cross o aviso threshold então o
        // user knows o conexão problem é sustained, não a momentary blip.
        // Don't repeat — o renderer keeps o banner para cima até próximo 'connected'.
        if (this.reconnectAttempts === this.RECONNECT_WARN_AFTER) {
            this.emit('persistent-reconnect', { attempts: this.reconnectAttempts });
        }

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.isActive) this.connect();
        }, delay);
    }

    private flushBuffer(): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        // Snapshot + cclaro então iterate. Anterior versão chamado shift() em a loop
        // que é O(n²) — todo shift em a grande buffer re-indexes todo remaining
        // eelemento Com 500 chunks o snapshot+iterate versão é O(n) e executa em
        // a único tight loop em vez disso de 500 array reallocations.
        const pending = this.buffer;
        this.buffer = [];
        if (this.bufferDroppedChunks > 0) {
            console.warn(`[RefractProSTT:${this.channel}] Reconnected — flushing ${pending.length} buffered chunks; ${this.bufferDroppedChunks} were dropped during outage`);
        }
        this.bufferDroppedChunks = 0;
        this.bufferOverflowReported = false;
        for (const chunk of pending) {
            this.ws.send(chunk);
        }
    }

    // ── Regional STT relay helpers (Fase 7/8) ──────────────────────────────

    /**
     * If o relay flag is on e we haven't resolved a target isso session,
     * resolver one (reusing a cached session para isso channel se still valid)
     * e re-enter connect() quando done. Returns verdadeiro se a resolver was started
     * (caller deve NOT proceed para abrir a socket); falso se o flag is off /
     * already resolved (caller proceeds com o legacy/established path).
     *
     * SAFETY: o moment o flag is off isso returns falso synchronously and
     * o resolver is nunca even constructed — guaranteeing o flag-off path
     * is byte-for-byte o legacy direct-Railway behavior.
     */
    private maybeResolveRelayTarget(): boolean {
        if (this.targetResolved || this.resolveInFlight) return false;

        const flags = this.getFlags();
        // Trial sentinel uses CredentialsManager.getTrialToken() para o WS frame;
        // para o rollout gate we hash o channel+sentinel deterministically.
        const enabled = !!flags && flags.isRelayEnabled(this.apiKey === TRIAL_SENTINEL_KEY ? undefined : this.apiKey);
        if (!enabled) {
            // Mark resolved então we don't re-check todo reconnect. Emitir o
            // flag-off telemetry exatamente uma vez por ssessão
            this.targetResolved = true;
            if (!this.loggedFlagOffOnce) {
                this.loggedFlagOffOnce = true;
                this.emitTelemetry('stt_relay_disabled_flag_off', { channel: this.channel });
            }
            return false;
        }

        // Reuse a cached sessão para isso channel se it's ainda dentro its TTL
        // (avoids hammering /v1/stt/session em a transient 1006 blip).
        const cached = getCachedSession(this.channel);
        if (cached) {
            this.installTarget(cached);
            this.targetResolved = true;
            return false; // synchronously ready — proceed com o established chain
        }

        // Não cache → assíncrono resolve. Block isso cconectar re-enter em completion.
        this.resolveInFlight = true;
        this.resolveRelayTarget(flags!)
            .catch((): void => { /* resolve failure → installTarget(null) já ran ou null alvo → Railway */ })
            .finally(() => {
                this.resolveInFlight = false;
                this.targetResolved = true;
                // Re-enter coconectar agora que a alvo (ou nulo → Railway) é sdefine
                if (this.isActive) this.connect();
            });
        return true;
    }

    /** Executa o actual session-create + installs o resulting talvo */
    private async resolveRelayTarget(flags: RefractProSTTFlags): Promise<void> {
        const isTrial = this.apiKey === TRIAL_SENTINEL_KEY;
        let trialToken: string | undefined;
        let apiKey: string | undefined;
        if (isTrial) {
            try {
                const { CredentialsManager } = require('../services/CredentialsManager');
                trialToken = CredentialsManager.getInstance().getTrialToken();
            } catch { /* não trial token available — resolver Retorna null → Railway */ }
        } else {
            apiKey = this.apiKey;
        }

        const config = await this.resolveSessionImpl({
            apiKey,
            trialToken,
            channel: this.channel,
            language: this.languageBcp47,
            languageAlternates: this.languageAlternates,
            // Echo client-side caps; o servidor re-clamps e é authoritative.
            sampleRate: Math.min(this.sampleRate, flags.getMaxSampleRate()),
            audioChannels: Math.min(this.audioChannels, flags.getMaxChannels()),
            appVersion: this.appVersion,
            platform: this.platform,
            controlPlaneBaseUrl: this.controlPlaneBaseUrl,
            regionHint: flags.getForceRegion(),
            // Best-effort relay round-trip hints (cached, nunca blocks — nulo em o
            // primeiro chamar antes o fundo probe lands). O servidor honors them
            // apenas quando STT_RELAY_ALLOW_CLIENT_LATENCY_PROBES é oem senão iignora
            latencyProbes: getRelayLatencyProbes() ?? undefined,
        });

        if (config) {
            setCachedSession(this.channel, config);
            this.emitTelemetry('relay_session_resolved', {
                region: config.selectedRegion,
                hadFallback: config.fallbackRelayWsUrl != null,
            });
        }
        this.installTarget(config);
    }

    /**
     * Builds o ordered URL chain de a resolved configuração (or nulo → Railway-only)
     * e stores it as o ativo target. Respects sttRailwayFallbackEnabled:
     * quando false, o Railway url is stripped de o chain (QA isolation). The
     * resulting primeiro url is what connect() vai dial.
     */
    private installTarget(config: RelaySessionConfig | null): void {
        let chain = buildFallbackChain(config);
        const flags = this.getFlags();
        if (flags && !flags.isRailwayFallbackEnabled()) {
            const filtered = chain.filter(u => u !== this.BACKEND_URL && (!config || u !== config.railwayFallbackWsUrl));
            // Nunca let o chain go vazio — se stripping Railway leaves nada
            // (shouldn't, quando configuração tem relay urls), keep o original.
            if (filtered.length > 0) chain = filtered;
        }
        this.target = {
            chain,
            index: 0,
            config,
            sameUrlFailures: 0,
            onRailway: false,
        };
        const firstKind = this.kindForUrl(chain[0]);
        this.emitTelemetry('relay_selected', {
            kind: firstKind,
            region: config?.selectedRegion ?? 'railway',
        });
    }

    /** O url coconectar deve dial direito nagora Falls voltar para BACKEND_URL. */
    private connectUrl(): string {
        if (this.target && this.target.chain.length > 0) {
            return this.target.chain[Math.min(this.target.index, this.target.chain.length - 1)];
        }
        return this.BACKEND_URL;
    }

    /** Classifies a url dentro de o atual chain como relay | alternate | railway. */
    private kindForUrl(url: string): TargetKind {
        if (!this.target || !this.target.config) {
            return 'railway';
        }
        const c = this.target.config;
        if (url === c.relayWsUrl) return 'relay';
        if (c.fallbackRelayWsUrl && url === c.fallbackRelayWsUrl) return 'alternate';
        // Railway hardcoded url ou o server-provided railway alternativa url.
        return 'railway';
    }

    /** Verdadeiro quando `url` é a relay/alternate alvo AND we hold a sessão ttoken */
    private isOnRelayTarget(url: string): boolean {
        if (!this.target || !this.target.config || !this.target.config.sessionToken) return false;
        const kind = this.kindForUrl(url);
        return kind === 'relay' || kind === 'alternate';
    }

    /**
     * Returns o auth frame para `url`:
     *   - RELAY frame  (session_token, app_version, platform; NO key) quando `url`
     *     is a relay/alternate target e we have a token.
     *   - LEGACY frame (key | trial_token; NO token) para o Railway url e for
     *     o entire flag-off caminho — exactly o shape o server has always
     *     validated.
     */
    private buildAuthFrame(url: string): Record<string, unknown> {
        if (this.isOnRelayTarget(url)) {
            const token = this.target!.config!.sessionToken;
            return {
                session_token:       token,
                sample_rate:         this.sampleRate,
                audio_channels:      this.audioChannels,
                language:            this.languageBcp47,
                language_alternates: this.languageAlternates,
                channel:             this.channel,
                app_version:         this.appVersion,
                platform:            this.platform,
            };
        }
        return this.buildLegacyAuthFrame();
    }

    /**
     * The unchanged legacy auth frame. Extracted verbatim de o original
     * 'open' manipulador so o Railway / flag-off caminho is byte-for-byte identical:
     *   { sample_rate, language, language_alternates, audio_channels, channel,
     *     chave | trial_token }
     */
    private buildLegacyAuthFrame(): Record<string, unknown> {
        const baseFrame: Record<string, unknown> = {
            sample_rate:         this.sampleRate,
            language:            this.languageBcp47,
            language_alternates: this.languageAlternates,
            audio_channels:      this.audioChannels,
            channel:             this.channel,
        };
        if (this.apiKey === TRIAL_SENTINEL_KEY) {
            try {
                const { CredentialsManager } = require('../services/CredentialsManager');
                const trialToken = CredentialsManager.getInstance().getTrialToken();
                if (trialToken) baseFrame.trial_token = trialToken;
            } catch { /* CredentialsManager unavailable — conexão vai ser rejected por servidor */ }
        } else {
            baseFrame.key = this.apiKey;
        }
        return baseFrame;
    }

    /**
     * Fallback-ladder advance on a falhou connection close. Increments the
     * per-url failure count; depois o SAME relay url has falhou twice, advances
     * target.index para o próximo chain entry. Once on Railway we stay there (no
     * flap-back). No-op quando there is não multi-entry chain (flag off).
     *
     * `failedUrl` is o url que was being dialed; we apenas advance quando it is
     * still o head of o chain we're walking (guards contra stale closes).
     */
    private maybeAdvanceTarget(failedUrl: string, closeCode?: number): void {
        const t = this.target;
        if (!t || t.chain.length <= 1) return;        // nada to advance to
        if (t.onRailway) return;                       // terminal rung — stay
        if (failedUrl !== t.chain[t.index]) return;    // stale fechar — ignorar

        const fromKind = this.kindForUrl(failedUrl);
        this.emitTelemetry('relay_failed', { kind: fromKind, closeCode: closeCode ?? null, reason: 'close' });

        t.sameUrlFailures++;
        // Same-relay tentar novamente budget: 2 failures em o atual url antes advancing.
        if (t.sameUrlFailures < 2) return;

        this.advance(failedUrl, fromKind);
    }

    /**
     * Token-fatal advance: a relay rejected our session token. Skip o ×2 retry
     * budget e advance immediately (the token won't self-heal on retry).
     */
    private forceAdvanceTarget(failedUrl: string, reason: string): void {
        const t = this.target;
        if (!t || t.chain.length <= 1 || t.onRailway) {
            // Não relay rung para advance para — let normal fatal handling aaplica
            return;
        }
        if (failedUrl !== t.chain[t.index]) return;
        const fromKind = this.kindForUrl(failedUrl);
        this.emitTelemetry('relay_failed', { kind: fromKind, closeCode: null, reason });
        this.advance(failedUrl, fromKind);
    }

    /** Shared advance: bump index, reinicia per-url counter, emitir fallback_used. */
    private advance(failedUrl: string, fromKind: TargetKind): void {
        const t = this.target!;
        if (t.index < t.chain.length - 1) {
            t.index++;
            t.sameUrlFailures = 0;
            const toKind = this.kindForUrl(t.chain[t.index]);
            if (toKind === 'railway') t.onRailway = true;
            this.reconnectAttempts = 0; // fresh rung — don't herdar prior backoff
            console.warn(`[RefractProSTT:${this.channel}] Advancing fallback rung: ${fromKind} → ${toKind} (${t.chain[t.index]})`);
            this.emitTelemetry('relay_fallback_used', { fromKind, toKind });
        }
    }

    private closeUpstream(): void {
        this.isConnected  = false;
        this.isConnecting = false;

        // Limpa todo owned timer haqui não apenas at stop()/start() boundaries.
        // Qualquer caminho que tears abaixo o upstream conexão (intentional cfechar
        // setSampleRate, setRecognitionLanguage, language_detected, fatal-error
        // branch) used para leave reconnectTimer / stabilityTimer alive — they
        // iria então disparar contra a torn-down sessão e qualquer um call
        // coconectar (orphan reconnect) ou clobber reconnectAttempts em o
        // próximo sessão (stability timer surviving através sessions). O 250ms
        // inline reconectar paths imediatamente re-assign pendingConnectTimer
        // Após calling closeUpstream(), então clearing it aqui é safe — they
        // intentionally sobrescrever it.
        if (this.reconnectTimer)     { clearTimeout(this.reconnectTimer);     this.reconnectTimer = null; }
        if (this.stabilityTimer)     { clearTimeout(this.stabilityTimer);     this.stabilityTimer = null; }
        if (this.pendingConnectTimer) { clearTimeout(this.pendingConnectTimer); this.pendingConnectTimer = null; }

        if (this.ws) {
            const dying = this.ws;
            this.ws = null;
            // Strip todo JS-side ouvinte Antes clofechar O libuv socket pode
            // ainda entregar 'message'/'close' events que eram já em
            // flight de o kernel — sem removeAllListeners() they iria
            // bubble para cima para handlers que mutate estado em `this` e corrupt
            // o novo cconexão O handler-side `guard(ws === this.ws)`
            // makes isso safe até se removeAllListeners() somehow misses
            // aqualquer coisa mas fazendo ambos é o production-grade pattern.
            try { dying.removeAllListeners(); } catch {}
            try { dying.close(); } catch {}
        }
    }
}

/** Buckets a latency (ms) dentro de o telemetry buckets (<500/<1000/<2000/<4000/>=4000). */
function latencyBucket(ms: number): string {
    if (ms < 500) return '<500';
    if (ms < 1000) return '<1000';
    if (ms < 2000) return '<2000';
    if (ms < 4000) return '<4000';
    return '>=4000';
}
