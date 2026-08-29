/**
 * OpenAIStreamingSTT - WebSocket-first, REST-fallback Speech-to-Text para OpenAI
 *
 * Priority chain (automatic, com audio buffering durante transitions):
 *   1. WebSocket Realtime API → gpt-4o-transcribe        (servidor VAD, noise reduction)
 *   2. WebSocket Realtime API → gpt-4o-mini-transcribe   (servidor VAD, noise reduction)
 *   3. REST API              → whisper-1                 (cliente VAD flush)
 *
 * Implementa o mesmo EventEmitter interface como todos outro STT providers:
 *   Events:  'transcript' ({ text, isFinal, confidence }), 'error' (Error)
 *   Methods: stainicia stopara write(chunk), setSampleRate(), setAudioChannelCount(),
 *            setRecognitionLanguage(), setCredentials(), notifySpeechEnded()
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import axios from 'axios';
import FormData from 'form-data';
import { RECOGNITION_LANGUAGES } from '../config/languages';
import { streamingStttWsOptions } from './dnsHelpers';
import { OpenAITranscriptTurnCoalescer } from './openaiTranscriptTurnCoalescer';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_OPENAI_BASE = 'https://api.openai.com';
const REALTIME_WS_URL = 'wss://api.openai.com/v1/realtime?intent=transcription';
const REST_ENDPOINT   = 'https://api.openai.com/v1/audio/transcriptions';

/** Derivar REST transcription endpoint de a user-supplied base URL.
 *  Strips a trailing slash então we don't termina para cima com `//v1/...`. Accepts ambos
 *  `https://my-host.tld` e `https://my-host.tld/v1` (o último occurs em o wild). */
function deriveRestEndpoint(baseUrl: string): string {
    const trimmed = baseUrl.replace(/\/+$/, '');
    return /\/v\d+$/.test(trimmed)
        ? `${trimmed}/audio/transcriptions`
        : `${trimmed}/v1/audio/transcriptions`;
}

/** WebSocket modelo priority ordenar */
const WS_MODELS = ['gpt-4o-transcribe', 'gpt-4o-mini-transcribe'] as const;
type WsModel = typeof WS_MODELS[number];

/** Max consecutive WebSocket failures antes advancing para próximo modelo / REST */
const MAX_WS_FAILURES_PER_MODEL = 3;

/** Exponential recuo reconectar delays */
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS  = 30_000;

/** Keep-alive ping interval (ms) — previne idle disconnects */
const KEEPALIVE_INTERVAL_MS = 20_000;

/** Rolling audio ring-buffer: sized para worst-case raw Entrada audio (48kHz stereo 16-bit × 30s).
 *  O ring buffer armazena PRE-RESAMPLED chunks de wriescreve não o 24kHz WS osaída */
const MAX_RING_BUFFER_BYTES = 48_000 * 2 * 2 * 30; // 5 760 000 bytes (48kHz stereo × 16-bit × 30s)

/** REST safety-net esvaziar interval quando em REST alternativa modo */
const REST_SAFETY_NET_MS = 10_000;

/** Minimum buffered bytes antes attempting a REST upload */
const REST_MIN_UPLOAD_BYTES = 4_000;

/** WebSocket Audio Batching: Número de 24kHz samples para accumulate antes sending para prevenir rate limits (~250ms) */
const SEND_THRESHOLD_SAMPLES = 6000;

/** Silence RMS threshold — pular REST uploads para silent buffers */
const SILENCE_RMS_THRESHOLD = 50;

/** PCM parameters */
const WS_SAMPLE_RATE      = 24_000; // OpenAI Realtime API exige 24 kHz para pcm16
const REST_SAMPLE_RATE    = 16_000; // whisper-1 REST accepts 16 kHz
const BITS_PER_SAMPLE     = 16;
const NUM_CHANNELS        = 1;

// ─── Estado ────────────────────────────────────────────────────────────────────

type Mode = 'ws' | 'rest';

// ─── Class ────────────────────────────────────────────────────────────────────

export class OpenAIStreamingSTT extends EventEmitter {
    // Public config
    private apiKey: string;
    private languageKey = 'en';

    // Audio configuração (define de pipeline)
    private inputSampleRate = 16_000;
    private numChannels     = NUM_CHANNELS;

    // Lifecycle
    private isActive     = false;
    private isConnecting = false;
    private shouldReconnect = false;

    // WebSocket estado
    private ws: WebSocket | null = null;
    private wsModelIndex = 0;           // index dentro de WS_MODELS
    private wsFailures   = 0;           // consecutive failures para current WS modelo
    private reconnectAttempts = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private keepAliveTimer: NodeJS.Timeout | null = null;
    private connectionTimeoutTimer: NodeJS.Timeout | null = null;
    private sessionSetupTimer: NodeJS.Timeout | null = null;
    private isSessionReady = false;     // define em inbound session.created

    // Audio batching estado
    private pcmAccumulator: Int16Array[] = [];
    private pcmAccumulatorLen = 0;

    // Modo
    private mode: Mode = 'ws';

    // Rolling pre-buffer: holds audio enquanto connecting / transitioning
    // Used para avoid losing speech at o inicia de a WS sessão ou durante fallback
    private ringBuffer: Buffer[] = [];
    private ringBufferBytes = 0;
    private ringEvictedThisSession = false;
    private ringEvictedBytes = 0;

    // Rate-limit aviso de-dup: per-session define de rate-limit names we've
    // já surfaced an upstream aviso fpara Servidor emite rate_limits.updated
    // em todo turn; we apenas warn uma vez por crossing por ssessão
    private rateLimitWarned: Set<string> = new Set();

    // REST alternativa estado
    private restChunks: Buffer[]   = [];
    private restTotalBytes         = 0;
    private restSafetyTimer: NodeJS.Timeout | null = null;
    private restIsUploading        = false;
    private restFlushPending       = false;

    // Custom OpenAI-compatible endpoint (e.g. self-hosted Speaches). Quando sdefine o
    // WebSocket Realtime caminho é skipped — third-party servers don't implementar it.
    private restEndpoint: string = REST_ENDPOINT;
    private isCustomEndpoint = false;

    // Coalesce word-level GA completed events dentro de one final turn por utterance.
    private turnCoalescer = new OpenAITranscriptTurnCoalescer();

    // Suprimir duplicate final emite (finalize esvaziar + speech_stopped, etcetc
    private lastFinalEmitText = '';
    private lastFinalEmitAt = 0;
    private static readonly FINAL_DEDUPE_MS = 2500;

    // ─── Constructor ──────────────────────────────────────────────────────────

    constructor(apiKey: string, baseUrl?: string) {
        super();
        this.apiKey = apiKey;
        const effectiveBase = (baseUrl || '').trim();
        if (effectiveBase && effectiveBase !== DEFAULT_OPENAI_BASE) {
            this.restEndpoint = deriveRestEndpoint(effectiveBase);
            this.isCustomEndpoint = true;
            console.log(`[OpenAIStreaming] Initialized — custom endpoint (REST only): ${this.restEndpoint}`);
        } else {
            console.log('[OpenAIStreaming] Initialized — WebSocket priority (gpt-4o-transcribe → gpt-4o-mini-transcribe → whisper-1 REST)');
        }
    }

    // ─── Public Configuração (STTProvider iinterface ─────────────────────────

    public setApiKey(apiKey: string): void {
        const changed = this.apiKey !== apiKey;
        this.apiKey = apiKey;
        console.log('[OpenAIStreaming] API key updated');
        // O WebSocket's Authorization cabeçalho é sent em o handshake e cannot
        // ser updated em an established cconexão If we're já streaming, o
        // live socket iria continue para autenticar com o anterior chave até
        // its próximo reconectar — que é o wrong behavior para a security-relevant
        // setter (e.g. rotation de a leaked kechave Mirror setRecognitionLanguage's
        // close+reopen então a rotated chave takes efeito iimediatamente
        if (changed && this.isActive && this.mode === 'ws') {
            console.log('[OpenAIStreaming] Reconnecting WS to apply new API key');
            this._closeWs(true);
            this._connectWs();
        }
    }

    public setSampleRate(rate: number): void {
        if (this.inputSampleRate === rate) return;
        this.inputSampleRate = rate;
        console.log(`[OpenAIStreaming] Input sample rate set to ${rate}Hz`);
    }

    public setAudioChannelCount(count: number): void {
        if (this.numChannels === count) return;
        this.numChannels = count;
        console.log(`[OpenAIStreaming] Channel count set to ${count}`);
    }

    public setRecognitionLanguage(key: string): void {
        const prev = this.languageKey;
        this.languageKey = key;
        if (key !== prev && this.isActive && this.mode === 'ws') {
            console.log(`[OpenAIStreaming] Language changed to ${key} — restarting WS session`);
            this._closeWs(true);
            this._connectWs();
        }
    }

    /** No-op — não credential files necessário */
    public setCredentials(_path: string): void {}

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    public start(): void {
        if (this.isActive) return;
        console.log('[OpenAIStreaming] Starting...');
        this.isActive       = true;
        this.shouldReconnect = true;
        this.wsModelIndex   = 0;
        this.wsFailures     = 0;
        this.reconnectAttempts = 0;
        this.ringEvictedThisSession = false;
        this.ringEvictedBytes = 0;
        this.rateLimitWarned.clear();
        // Defensive: se a prior stpara raced an in-flight REST upload, these
        // flags pode ser ser stale. Clean slate guarantees o primeiro REST flush
        // após reiniciar isn't surprise-deferred por an orphaned axios ppromise
        this.restIsUploading  = false;
        this.restFlushPending = false;
        this.turnCoalescer.reset();

        // Custom endpoints (e.g. Speaches) don't implementar OpenAI's Realtime WebSocket
        // pprotocolo Go direto para REST modo para them.
        if (this.isCustomEndpoint) {
            this.mode = 'rest';
            this._switchToRest();
            return;
        }

        this.mode = 'ws';
        this._connectWs();
    }

    public stop(): void {
        if (!this.isActive) return;
        console.log('[OpenAIStreaming] Stopping...');
        this._flushTurnCoalescer();
        this.isActive        = false;
        this.shouldReconnect = false;

        // Flush qualquer remaining buffered audio para o WS antes closing então we
        // don't silently soltar para cima para ~250ms de speech at o termina de a ssessão
        // Então commit o entrada buffer então o servidor transcribes o trailing
        // audio até se its VAD hasn't tripped em o silence yainda
        // Divide append/commit dentro de separate tentar blocks: a falhou anexar precisa Não
        // bypass o commit — o servidor ainda tem buffered audio de prior
        // _sendWsAudioChunk calls que deve ser transcribed.
        if (this.mode === 'ws' && this.ws?.readyState === WebSocket.OPEN &&
            this.isSessionReady) {
            try {
                if (this.pcmAccumulatorLen > 0) {
                    const combined = new Int16Array(this.pcmAccumulatorLen);
                    let offset = 0;
                    for (const arr of this.pcmAccumulator) {
                        combined.set(arr, offset);
                        offset += arr.length;
                    }
                    this.ws.send(JSON.stringify({
                        type:  'input_audio_buffer.append',
                        audio: Buffer.from(combined.buffer).toString('base64'),
                    }));
                }
            } catch (err) {
                console.warn('[OpenAIStreaming][WS] Stop append failed (continuing to commit):', err);
            }
            try {
                this.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
                console.log('[OpenAIStreaming][WS] Stop — committed input buffer');
            } catch (err) {
                console.warn('[OpenAIStreaming][WS] Stop commit failed:', err);
            }
        }

        this._clearTimers();
        this._closeWs(false);
        this._stopRestTimer();

        this.restChunks     = [];
        this.restTotalBytes = 0;
        // Reinicia REST esvaziar estado também — sem this, a `restFlushPending=true`
        // esquerda sobre de an in-flight upload at para time iria cause o
        // finalmente re-entry em _restFlushAndUpload() para agendar outro
        // upload que o novo isActive proteger at entry agora correctly rejects,
        // mas it's cleaner para flip o latch aqui então future readers don't
        // wonder por que o entry proteger exists at atodos
        this.restFlushPending = false;
        // Note: restIsUploading é Não reinicia para falso synchronously — lá
        // pode ser an in-flight axios POST cujo finalmente precisa para observar o
        // verdadeiro valor para take its early-return branch. O axios tempo limite caps
        // o aguardar at 30s em o worst case.
        this.ringBuffer     = [];
        this.ringBufferBytes = 0;
        this.pcmAccumulator = [];
        this.pcmAccumulatorLen = 0;
    }

    public write(chunk: Buffer): void {
        if (!this.isActive) return;

        if (this.mode === 'ws') {
            // Sempre push para ring-buffer enquanto não ainda connected (pre-buffer)
            if (!this.isSessionReady) {
                this._ringBufferPush(chunk);
                // Acionar lazy conectar se não já em progress
                if (!this.isConnecting && this.shouldReconnect && !this.reconnectTimer) {
                    this._connectWs();
                }
                return;
            }
            this._sendWsAudioChunk(chunk);
        } else {
            // REST modo — accumulate para batch upload
            this.restChunks.push(chunk);
            this.restTotalBytes += chunk.length;
        }
    }

    /**
     * Called by Rust native VAD quando speech ends.
     * On WebSocket path: server handles VAD — isso is a no-op.
     * On REST alternativa path: triggers immediate flush.
     */
    public notifySpeechEnded(): void {
        if (!this.isActive) return;
        if (this.mode === 'rest') {
            console.log('[OpenAIStreaming][REST] Speech ended — flushing buffer');
            this._restFlushAndUpload();
        }
        // WebSocket pcaminho servidor VAD gerencia this; nada para dfazer
    }

    public finalize(): void {
        if (!this.isActive) return;
        if (this.mode === 'rest') {
            console.log('[OpenAIStreaming][REST] Finalize — flushing buffer');
            this._restFlushAndUpload();
            return;
        }
        if (this.ws?.readyState !== WebSocket.OPEN || !this.isSessionReady) return;

        // Divide append/commit dentro de separate tentar blocks — a falhou anexar precisa
        // não bypass o commit; server-buffered audio de earlier chunks
        // deve ainda ser transcribed.
        try {
            if (this.pcmAccumulatorLen > 0) {
                const combined = new Int16Array(this.pcmAccumulatorLen);
                let offset = 0;
                for (const arr of this.pcmAccumulator) {
                    combined.set(arr, offset);
                    offset += arr.length;
                }
                this.pcmAccumulator = [];
                this.pcmAccumulatorLen = 0;
                this.ws.send(JSON.stringify({
                    type:  'input_audio_buffer.append',
                    audio: Buffer.from(combined.buffer).toString('base64'),
                }));
            }
        } catch (err) {
            console.error('[OpenAIStreaming][WS] Finalize append failed (continuing to commit):', err);
        }
        try {
            this.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
            console.log('[OpenAIStreaming][WS] Finalize — committed input buffer');
        } catch (err) {
            console.error('[OpenAIStreaming][WS] Finalize commit failed:', err);
        }
        // Fazer não esvaziar o coalescer aqui — commit aciona servidor VAD/transcription
        // e speech_stopped vai emitir one coalesced final. Flushing aqui duplicates
        // o mesmo texto como a segundo final turn downstream.
    }

    // ─── WebSocket Caminho ───────────────────────────────────────────────────────

    private _connectWs(): void {
        if (this.isConnecting || !this.shouldReconnect) return;
        this.isConnecting  = true;
        this.isSessionReady = false;

        // Defensive: garante não stale timers de a anterior conectar tentar
        // remain armed contra o próximo socket. _closeWs() deve ter cleared
        // these, mas se _connectWs é já chamado sem a prior fechar (e.g.
        // future refactor), we don't want an orphaned 10s timer para kill o
        // novo socket fora de nem lugar nenhum
        this._clearConnectAndSessionTimers();

        const model: WsModel = WS_MODELS[this.wsModelIndex] ?? WS_MODELS[0];
        console.log(`[OpenAIStreaming] Connecting WebSocket (model=${model}, attempt=${this.reconnectAttempts + 1})...`);

        // streamingStttWsOptions: IPv4-only DNS + 15s handshake cap (dnsHelpers.ts).
        this.ws = new WebSocket(REALTIME_WS_URL, streamingStttWsOptions({
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
            },
        }) as WebSocket.ClientOptions);

        // 10-segundo conexão tempo limite para prevenir hanging em dropped networks
        this.connectionTimeoutTimer = setTimeout(() => {
            console.warn(`[OpenAIStreaming] WebSocket connection timed out after 10s (attempt=${this.reconnectAttempts + 1})`);
            if (this.ws) {
                this.ws.removeAllListeners();
                this.ws.close();
                this.ws = null;
                this.isConnecting = false;
                this._handleWsClose(1006, Buffer.from('Connection Timeout'));
            }
        }, 10_000);

        this.ws.on('open', () => {
            if (this.connectionTimeoutTimer) {
                clearTimeout(this.connectionTimeoutTimer);
                this.connectionTimeoutTimer = null;
            }
            console.log(`[OpenAIStreaming] WebSocket open — sending session config (model=${model})`);
            this.isConnecting      = false;
            this.reconnectAttempts = 0;

            // Inicia 5-segundo tempo limite waiting para session.created de servidor
            this.sessionSetupTimer = setTimeout(() => {
                console.warn(`[OpenAIStreaming] Server accepted connection but failed to create session within 5s. Forcing disconnect...`);
                // Force a desconectar para acionar o alternativa logic. Mirror o
                // connectionTimeoutTimer retorno de chamada por explicitly clearing
                // isConnecting — _handleWsClose vai também claro it, mas o
                // symmetry guards contra a refactor que breaks one pcaminho
                if (this.ws) {
                    this.ws.removeAllListeners();
                    this.ws.close();
                    this.ws = null;
                    this.isConnecting = false;
                    this._handleWsClose(1008, Buffer.from('Session Setup Timeout'));
                }
            }, 5_000);

            // Configura o transcription sessão
            // 'auto' chave → vazio string então Whisper/gpt-4o-transcribe auto-detects o language
            const lang = (this.languageKey && this.languageKey !== 'auto')
                ? (RECOGNITION_LANGUAGES[this.languageKey]?.iso639 ?? '')
                : '';

            const transcription: { model: string; language?: string } = { model };
            if (lang) transcription.language = lang;

            this.ws!.send(JSON.stringify({
                type: 'session.update',
                session: {
                    type: 'transcription',
                    audio: {
                        input: {
                            format: {
                                type: 'audio/pcm',
                                rate: WS_SAMPLE_RATE,
                            },
                            transcription,
                            noise_reduction: { type: 'near_field' },
                            turn_detection: {
                                type:                'server_vad',
                                threshold:           0.5,
                                prefix_padding_ms:   300,
                                // 1000ms reduz micro-turns que fragment one sentence dentro de
                                // muitos word-sized completed events (overlay fila rows).
                                silence_duration_ms: 1000,
                            },
                        },
                    },
                },
            }));
        });

        this.ws.on('message', (raw: WebSocket.Data) => {
            try {
                // WebSocket.Data é `Buffer | ArrayBuffer | Buffer[]`. Em fragmented
                // frames `ws` delivers an array de Buffers — calling `.toString()`
                // em o array iria produzir "buf1,buf2" (Array.prototype.toString),
                // failing JSON.parse silently. Normalizar fprimeiro
                const text = Array.isArray(raw)
                    ? Buffer.concat(raw).toString('utf8')
                    : Buffer.isBuffer(raw)
                        ? raw.toString('utf8')
                        : raw instanceof ArrayBuffer
                            ? Buffer.from(raw).toString('utf8')
                            : String(raw);
                const msg = JSON.parse(text);
                this._handleWsMessage(msg);
            } catch (err) {
                console.error('[OpenAIStreaming] WS parse error:', err);
            }
        });

        this.ws.on('error', (err: Error) => {
            console.error(`[OpenAIStreaming] WS error: ${err.message}`);
            // O 'cfechar evento vai follow, então we manipular reconectar tlá
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
            this._handleWsClose(code, reason);
        });
    }

    private _handleWsClose(code: number, reason: Buffer): void {
        this.isConnecting   = false;
        this.isSessionReady = false;
        // Tear abaixo per-connect timers + keepalive. We deliberately leave
        // `reconnectTimer` alone aqui — o fechar caminho pode want para (re-)arm it
        // a poucos lines abaixo via _scheduleWsReconnect quando shouldReconnect=true.
        this._clearKeepAlive();
        this._clearConnectAndSessionTimers();
        console.log(`[OpenAIStreaming] WS closed (code=${code}, reason=${reason.toString() || 'none'})`);

        if (!this.shouldReconnect) return;

        // Count isso como a failure
        this.wsFailures++;

        if (this.wsFailures >= MAX_WS_FAILURES_PER_MODEL) {
            // Advance para próximo WebSocket modelo
            this.wsModelIndex++;
            this.wsFailures = 0;

            if (this.wsModelIndex >= WS_MODELS.length) {
                // Todos WS models exhausted — fall voltar para REST. Surface isso to
                // upstream então main.ts's _consecutiveErrors counter advances em
                // sustained WS-layer outages (DNS/TLS/RST) que caso contrário churn
                // silently — sem isso eemitir o user iria see não banner and
                // não transcripts, apenas dead air.
                const msg = 'All WebSocket transcription models failed — falling back to whisper-1 REST';
                console.warn(`[OpenAIStreaming] ${msg}`);
                this.emit('error', new Error(msg));
                this._switchToRest();
            } else {
                const nextModel = WS_MODELS[this.wsModelIndex];
                console.warn(`[OpenAIStreaming] Switching to next WebSocket model: ${nextModel}`);
                this.reconnectAttempts = 0;
                this._scheduleWsReconnect();
            }
        } else {
            // Mesmo mmodelo tentar novamente com recuo (e.g. transient network error)
            this._scheduleWsReconnect();
        }
    }

    private _handleWsMessage(msg: Record<string, any>): void {
        // Late-arrival gproteger O ws biblioteca pode entregar a buffered servidor frame
        // (e.g. session.created) após we ter chamado stpara mas
        // antes removeAllListeners() drained. Sem isso gproteger o late
        // frame iria define isSessionReady=true e chamar _startKeepAlive(), leaking
        // a 20s setInterval contra a classe o caller thinks é shut dabaixo
        if (!this.isActive) return;
        switch (msg.type) {
            case 'session.created':
            case 'transcription_session.created':
                if (this.sessionSetupTimer) {
                    clearTimeout(this.sessionSetupTimer);
                    this.sessionSetupTimer = null;
                }
                console.log('[OpenAIStreaming] Session created — flushing ring buffer');
                this.isSessionReady = true;
                this.wsFailures     = 0; // Reinicia failures em successful sessão
                this._startKeepAlive();
                this._flushRingBuffer();
                break;

            case 'conversation.item.input_audio_transcription.delta': {
                const partial = this.turnCoalescer.onDelta(msg.delta ?? '');
                if (partial) {
                    this._emitTranscript(partial, false);
                }
                break;
            }

            case 'conversation.item.input_audio_transcription.completed': {
                const preview = this.turnCoalescer.onCompleted(msg.transcript ?? '');
                if (preview) {
                    this._emitTranscript(preview, false);
                }
                break;
            }

            // Quota observability. OpenAI emite rate_limits.updated cada turn
            // com { nnome limit, remaining, reset_seconds } por limit tipo
            // (rsolicita tokens, ...). Surface a one-shot upstream aviso por
            // limit nome quando remaining/limit drops abaixo 10% — gives o user
            // a soft heads-up antes hard 'error' events de o sservidor
            case 'rate_limits.updated': {
                const limits = Array.isArray(msg.rate_limits) ? msg.rate_limits : [];
                for (const entry of limits) {
                    if (!entry || typeof entry !== 'object') continue;
                    const name = String(entry.name ?? 'unknown');
                    const limit = Number(entry.limit);
                    const remaining = Number(entry.remaining);
                    if (!Number.isFinite(limit) || !Number.isFinite(remaining) || limit <= 0) continue;
                    const ratio = remaining / limit;
                    if (ratio < 0.1 && !this.rateLimitWarned.has(name)) {
                        this.rateLimitWarned.add(name);
                        const resetSec = Number(entry.reset_seconds);
                        console.warn(
                            `[OpenAIStreaming] Rate limit low: ${name} ${remaining}/${limit} ` +
                            `(${(ratio * 100).toFixed(1)}%${Number.isFinite(resetSec) ? `, resets in ${resetSec}s` : ''})`
                        );
                        this.emit('warning', {
                            code: 'rate_limit_low',
                            message: `OpenAI ${name} quota near exhaustion`,
                            name,
                            limit,
                            remaining,
                            resetSeconds: Number.isFinite(resetSec) ? resetSec : undefined,
                        });
                    }
                }
                break;
            }

            // Server's ACK de nosso session.update. Útil para confirming o servidor
            // applied nosso requested configuração — registrar oapenas não behavior change required.
            case 'session.updated':
            case 'transcription_session.updated':
                console.log('[OpenAIStreaming] Session config applied by server');
                break;

            // VAD events emitted por o servidor (informational — we don't precisa para act em them)
            case 'input_audio_buffer.speech_started': {
                console.log('[OpenAIStreaming] Server VAD: speech started');
                const orphan = this.turnCoalescer.onSpeechStarted();
                if (orphan) {
                    this._emitTranscript(orphan, true);
                }
                break;
            }
            case 'input_audio_buffer.speech_stopped': {
                console.log('[OpenAIStreaming] Server VAD: speech stopped');
                const finalText = this.turnCoalescer.onSpeechStopped();
                if (finalText) {
                    console.log(`[OpenAIStreaming] Final transcript received`, { length: finalText.length });
                    this._emitTranscript(finalText, true);
                }
                break;
            }
            case 'input_audio_buffer.committed':
                // Audio chunk committed para transcription
                break;

            case 'error': {
                const rawErrMsg = msg.error?.message ?? JSON.stringify(msg);
                // Defensive scrub: se o servidor já echoes voltar o Authorization
                // cabeçalho (ou qualquer 'Bearer sk-…' sstring dentro an erro bcorpo fazer não
                // registrar ou propagate o secret. Mirrors o STT chave scrubbing posture
                // de o Pode 24 telemetry change.
                const errMsg = OpenAIStreamingSTT._scrubBearerTokens(rawErrMsg);
                console.error(`[OpenAIStreaming] Server error: ${errMsg}`);
                this.emit('error', new Error(errMsg));
                break;
            }

            default:
                // Uncomment para verbose debugging:
                // console.log(`[OpenAIStreaming] Unhandled mensagem type: ${msg.type}`);
                break;
        }
    }

    private _emitTranscript(text: string, isFinal: boolean): void {
        const trimmed = text.trim();
        if (!trimmed) return;
        if (isFinal) {
            const now = Date.now();
            if (
                trimmed === this.lastFinalEmitText &&
                now - this.lastFinalEmitAt < OpenAIStreamingSTT.FINAL_DEDUPE_MS
            ) {
                return;
            }
            this.lastFinalEmitText = trimmed;
            this.lastFinalEmitAt = now;
        }
        this.emit('transcript', {
            text:       trimmed,
            isFinal,
            confidence: 1.0,
        });
    }

    private _flushTurnCoalescer(): void {
        const finalText = this.turnCoalescer.flush();
        if (finalText) {
            console.log(`[OpenAIStreaming] Flushed coalesced transcript`, { length: finalText.length });
            this._emitTranscript(finalText, true);
        }
    }

    private _sendWsAudioChunk(pcmChunk: Buffer): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        // Downsample se necessário (e.g. 48kHz → 24kHz para Realtime API)
        const pcm16 = this._resamplePcm16(pcmChunk, WS_SAMPLE_RATE);

        const inputS16 = new Int16Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength / 2);
        
        this.pcmAccumulator.push(inputS16);
        this.pcmAccumulatorLen += inputS16.length;

        if (this.pcmAccumulatorLen >= SEND_THRESHOLD_SAMPLES) {
            // Combina accumulated chunks
            const combined = new Int16Array(this.pcmAccumulatorLen);
            let offset = 0;
            for (const arr of this.pcmAccumulator) {
                combined.set(arr, offset);
                offset += arr.length;
            }

            // Reinicia accumulator
            this.pcmAccumulator = [];
            this.pcmAccumulatorLen = 0;

            const base64 = Buffer.from(combined.buffer).toString('base64');

            try {
                this.ws.send(JSON.stringify({
                    type:  'input_audio_buffer.append',
                    audio: base64,
                }));
            } catch (err) {
                console.warn('[OpenAIStreaming] WS send failed:', err);
            }
        }
    }

    private _closeWs(graceful: boolean): void {
        // Tear abaixo Todos pendente timers antes touching o socket:
        //   - keepAliveTimer: prevenir stale-socket envia
        //   - reconnectTimer: prevenir a 30s-pending reconectar de firing dentro de a
        //     replacement socket (o phantom-reconnect bug após language change)
        //   - connectionTimeoutTimer / sessionSetupTimer: prevenir o próximo
        //     conectar de sendo killed por a anterior connect's timer.
        this._clearTimers();
        if (!this.ws) return;
        // GA transcription intent tem não client→server session.close — que evento
        // apenas exists para o translation subresource. Sending it em intent=transcription
        // produces a servidor `error` (unknown_type) que iria bubble como a meeting-end
        // erro em todo language change. TCP-level fechar é ssuficiente
        // Para a graceful tear-down (language change) we esvaziar qualquer pendente PCM and
        // commit o entrada buffer antes closing então server-buffered audio isn't dropped.
        if (graceful && this.ws.readyState === WebSocket.OPEN && this.isSessionReady) {
            try {
                if (this.pcmAccumulatorLen > 0) {
                    const combined = new Int16Array(this.pcmAccumulatorLen);
                    let offset = 0;
                    for (const arr of this.pcmAccumulator) {
                        combined.set(arr, offset);
                        offset += arr.length;
                    }
                    this.ws.send(JSON.stringify({
                        type:  'input_audio_buffer.append',
                        audio: Buffer.from(combined.buffer).toString('base64'),
                    }));
                }
            } catch (err) {
                console.warn('[OpenAIStreaming][WS] Graceful append failed:', err);
            }
            try {
                this.ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
            } catch (err) {
                console.warn('[OpenAIStreaming][WS] Graceful commit failed:', err);
            }
        }
        this.ws.removeAllListeners();
        this.ws.close();
        this.ws = null;
        this.isSessionReady = false;
        this.isConnecting = false; // Permitir immediate reconnect (e.g. language change)
        this.pcmAccumulator = [];
        this.pcmAccumulatorLen = 0;
        // Timers eram já cleared at o topo de isso método via _clearTimers().
    }

    private _scheduleWsReconnect(): void {
        if (!this.shouldReconnect) return;
        const delay = Math.min(
            RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
            RECONNECT_MAX_MS,
        );
        this.reconnectAttempts++;
        console.log(`[OpenAIStreaming] WS reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.shouldReconnect && this.mode === 'ws') {
                this._connectWs();
            }
        }, delay);
    }

    // ─── Keep-alive ───────────────────────────────────────────────────────────

    /** 8 bytes de PCM silence (4 samples × 2 bytes) — safest keepalive para o Realtime API */
    private static readonly KEEPALIVE_AUDIO_B64 = Buffer.alloc(8).toString('base64');

    /** Strip Bearer / sk-… tokens de any string we might registro ou propagate upstream.
     *  Case-insensitive: HTTP cabeçalho names are case-insensitive e lowercased
     *  `bearer …` shows up in JSON-serialized erro bodies de some proxies. */
    private static _scrubBearerTokens(s: string): string {
        return s
            .replace(/Bearer\s+[A-Za-z0-9_\-.]+/gi, 'Bearer [REDACTED]')
            .replace(/sk-[A-Za-z0-9_\-]{10,}/gi, 'sk-[REDACTED]');
    }

    private _startKeepAlive(): void {
        this._clearKeepAlive();
        this.keepAliveTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                try {
                    // Envia a minimal silent PCM frame para prevenir idle disconnects.
                    // An vazio string ('') pode ser rejected por alguns API versions; 8 zero-bytes é safe.
                    this.ws.send(JSON.stringify({
                        type:  'input_audio_buffer.append',
                        audio: OpenAIStreamingSTT.KEEPALIVE_AUDIO_B64,
                    }));
                } catch { /* ignorar */ }
            }
        }, KEEPALIVE_INTERVAL_MS);
    }

    private _clearKeepAlive(): void {
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
        }
    }

    /** Per-connect timers (10s handshake + 5s session-setup). Cleared in three
     *  places (start of `_connectWs`, depois a synthetic fechar in `_handleWsClose`,
     *  e via `_clearTimers`) — factor so adding a novo one means editing once. */
    private _clearConnectAndSessionTimers(): void {
        if (this.connectionTimeoutTimer) {
            clearTimeout(this.connectionTimeoutTimer);
            this.connectionTimeoutTimer = null;
        }
        if (this.sessionSetupTimer) {
            clearTimeout(this.sessionSetupTimer);
            this.sessionSetupTimer = null;
        }
    }

    private _clearTimers(): void {
        this._clearKeepAlive();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this._clearConnectAndSessionTimers();
    }

    // ─── Ring Buffer (pre-buffer durante connecting / transitions) ────────────

    private _ringBufferPush(chunk: Buffer): void {
        this.ringBuffer.push(chunk);
        this.ringBufferBytes += chunk.length;

        // Evict oldest chunks quando sobre limit
        let evictedBytesThisCall = 0;
        while (this.ringBufferBytes > MAX_RING_BUFFER_BYTES && this.ringBuffer.length > 0) {
            const evicted = this.ringBuffer.shift()!;
            this.ringBufferBytes -= evicted.length;
            evictedBytesThisCall += evicted.length;
        }

        if (evictedBytesThisCall > 0) {
            this.ringEvictedBytes += evictedBytesThisCall;
            // Registrar + emitir a non-fatal aviso uma vez por sessão então upstream telemetry
            // pode surface que leading speech era dropped enquanto waiting para o WS
            // handshake. Após o primeiro hit we accumulate silently para avoid registrar spam.
            if (!this.ringEvictedThisSession) {
                this.ringEvictedThisSession = true;
                console.warn(
                    `[OpenAIStreaming] Ring buffer evicted ${evictedBytesThisCall} bytes ` +
                    `(cap=${MAX_RING_BUFFER_BYTES}). Session not yet ready — leading audio dropped.`
                );
                this.emit('warning', {
                    code: 'ring_buffer_eviction',
                    message: 'Leading audio dropped while waiting for STT session to become ready',
                    droppedBytes: evictedBytesThisCall,
                });
            }
        }
    }

    /** Flush o ring buffer uma vez o sessão é pronto */
    private _flushRingBuffer(): void {
        if (this.ringBuffer.length === 0) return;
        console.log(`[OpenAIStreaming] Flushing ${this.ringBuffer.length} buffered chunks (${this.ringBufferBytes} bytes)`);
        const chunks = this.ringBuffer.splice(0);
        this.ringBufferBytes = 0;
        for (const chunk of chunks) {
            this._sendWsAudioChunk(chunk);
        }
    }

    // ─── REST Fallback Caminho ───────────────────────────────────────────────────

    /** REST mode is terminal para isso STT instance — once we fall voltar to
     *  whisper-1 REST, we don't tentar para climb voltar para WS dentro o mesmo session.
     *  A user deve chamar `stop()` e `start()` again para tentar novamente o WS path. */
    private _switchToRest(): void {
        this.mode = 'rest';
        // _closeWs() agora routes através _clearTimers() (R3-1), então we don't
        // precisa a separate _clearTimers() chamar haqui
        this._closeWs(false);

        // Transfer ring-buffer contents para o REST accumulator então buffered audio isn't lost
        if (this.ringBuffer.length > 0) {
            console.log(`[OpenAIStreaming][REST] Transferring ${this.ringBufferBytes} ring-buffer bytes to REST accumulator`);
            const chunks = this.ringBuffer.splice(0);
            this.ringBufferBytes = 0;
            for (const chunk of chunks) {
                this.restChunks.push(chunk);
                this.restTotalBytes += chunk.length;
            }
        }

        // Inicia safety-net timer
        this._startRestTimer();
        console.log('[OpenAIStreaming][REST] Switched to whisper-1 REST fallback');
    }

    private _startRestTimer(): void {
        this._stopRestTimer();
        this.restSafetyTimer = setInterval(() => {
            this._restFlushAndUpload();
        }, REST_SAFETY_NET_MS);
    }

    private _stopRestTimer(): void {
        if (this.restSafetyTimer) {
            clearInterval(this.restSafetyTimer);
            this.restSafetyTimer = null;
        }
    }

    private async _restFlushAndUpload(): Promise<void> {
        // Mirror o RestSTT.flushAndUpload proteger (Issue 7). Sem this, o
        // finally-re-entrancy at line ~970 (`if (this.restFlushPending)
        // this._restFlushAndUpload()`) pode disparar Após stpara tem cleared
        // restChunks e o próximo meeting pode já ter started — and
        // o trailing in-flight upload iria emitir 'transcript' dentro de o new
        // ssessão Mesmo classe de bug como RestSTT's leak; gating aqui fecha
        // it em o OpenAI provedor ttambém
        if (!this.isActive) return;

        if (this.restChunks.length === 0 || this.restTotalBytes < REST_MIN_UPLOAD_BYTES) return;
        if (this.restIsUploading) {
            this.restFlushPending = true;
            return;
        }

        // Reinicia safety-net timer para prevenir double-flush
        this._startRestTimer();

        const chunks = this.restChunks.splice(0);
        this.restTotalBytes = 0;

        const rawPcm = Buffer.concat(chunks);

        // Pular silent buffers
        if (this._isSilent(rawPcm)) {
            if (Math.random() < 0.1) {
                console.log(`[OpenAIStreaming][REST] Skipping silent buffer (${rawPcm.length} bytes)`);
            }
            return;
        }

        // Downsample para 16kHz mono antes creating WAV (entrada pode ser 48kHz)
        const pcm16k = this._resamplePcm16(rawPcm, REST_SAMPLE_RATE);
        const wavBuffer = this._addWavHeader(pcm16k, REST_SAMPLE_RATE);
        this.restIsUploading = true;

        try {
            const transcript = await this._restUpload(wavBuffer);
            if (transcript && transcript.trim().length > 0) {
                console.log(`[OpenAIStreaming][REST] Transcript received`, { length: transcript.trim().length });
                this.emit('transcript', {
                    text:       transcript.trim(),
                    isFinal:    true,
                    confidence: 1.0,
                });
            }
        } catch (err) {
            console.error('[OpenAIStreaming][REST] Upload error:', err);
            this.emit('error', err instanceof Error ? err : new Error(String(err)));
        } finally {
            this.restIsUploading = false;
            if (this.restFlushPending) {
                this.restFlushPending = false;
                this._restFlushAndUpload();
            }
        }
    }

    private async _restUpload(wavBuffer: Buffer): Promise<string> {
        const form = new FormData();
        form.append('file', wavBuffer, {
            filename:    'audio.wav',
            contentType: 'audio/wav',
        });
        form.append('model', 'whisper-1');

        const lang = (this.languageKey && this.languageKey !== 'auto')
            ? (RECOGNITION_LANGUAGES[this.languageKey]?.iso639 ?? '')
            : '';
        if (lang) form.append('language', lang);

        const response = await axios.post(this.restEndpoint, form, {
            headers: {
                Authorization: `Bearer ${this.apiKey}`,
                ...form.getHeaders(),
            },
            timeout: 30_000,
        });

        const data = response.data;
        if (typeof data === 'string') return data;
        return data?.text ?? '';
    }

    // ─── Audio Utilities ──────────────────────────────────────────────────────

    /**
     * Convert raw PCM buffer de o capture pipeline em 16-bit PCM at o given target rate.
     * The pipeline outputs Int16LE PCM, potentially at a higher sample rate (e.g. 48kHz).
     */
    private _resamplePcm16(chunk: Buffer, targetRate: number): Buffer {
        // Safe lê de unaligned memory
        const numSamples = chunk.length / 2;
        const inputS16 = new Int16Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
            inputS16[i] = chunk.readInt16LE(i * 2);
        }

        if (this.inputSampleRate === targetRate && this.numChannels === 1) {
            return Buffer.from(inputS16.buffer);
        }

        // Mix abaixo multi-channel para mono fprimeiro então downsample
        let monoS16: Int16Array;
        if (this.numChannels > 1) {
            const monoLength = Math.floor(inputS16.length / this.numChannels);
            monoS16 = new Int16Array(monoLength);
            for (let i = 0; i < monoLength; i++) {
                let sum = 0;
                for (let c = 0; c < this.numChannels; c++) {
                    sum += inputS16[i * this.numChannels + c];
                }
                monoS16[i] = Math.round(sum / this.numChannels);
            }
        } else {
            monoS16 = inputS16;
        }

        // Downsample
        if (this.inputSampleRate === targetRate) {
            return Buffer.from(monoS16.buffer);
        }

        const factor       = this.inputSampleRate / targetRate;
        const outputLength = Math.floor(monoS16.length / factor);
        const outputS16    = new Int16Array(outputLength);
        for (let i = 0; i < outputLength; i++) {
            outputS16[i] = monoS16[Math.floor(i * factor)];
        }
        return Buffer.from(outputS16.buffer);
    }

    private _isSilent(pcm: Buffer): boolean {
        let sum   = 0;
        let count = 0;
        const step = 20;
        for (let i = 0; i < pcm.length - 1; i += 2 * step) {
            const sample = pcm.readInt16LE(i);
            sum  += sample * sample;
            count++;
        }
        if (count === 0) return true;
        return Math.sqrt(sum / count) < SILENCE_RMS_THRESHOLD;
    }

    /** Build a WAV file cabeçalho para mono 16-bit PCM at o given sample rate.
     *  The caller is responsible para passing o correto rate que matches `samples`. */
    private _addWavHeader(samples: Buffer, sampleRate: number): Buffer {
        const buf = Buffer.alloc(44 + samples.length);
        buf.write('RIFF', 0);
        buf.writeUInt32LE(36 + samples.length, 4);
        buf.write('WAVE', 8);
        buf.write('fmt ', 12);
        buf.writeUInt32LE(16, 16);
        buf.writeUInt16LE(1, 20);                                                                   // PCM
        buf.writeUInt16LE(NUM_CHANNELS, 22);
        buf.writeUInt32LE(sampleRate, 24);
        buf.writeUInt32LE(sampleRate * NUM_CHANNELS * (BITS_PER_SAMPLE / 8), 28);
        buf.writeUInt16LE(NUM_CHANNELS * (BITS_PER_SAMPLE / 8), 32);
        buf.writeUInt16LE(BITS_PER_SAMPLE, 34);
        buf.write('data', 36);
        buf.writeUInt32LE(samples.length, 40);
        samples.copy(buf, 44);
        return buf;
    }
}
