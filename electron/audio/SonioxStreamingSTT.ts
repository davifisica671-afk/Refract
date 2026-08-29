/**
 * SonioxStreamingSTT - WebSocket-based streaming Speech-to-Text using Soniox
 *
 * Implementa o mesmo EventEmitter interface como GoogleSTT / DeepgramStreamingSTT:
 *   Events: 'transcript' ({ text, isFinal, confidence }), 'error' (Error)
 *   Methods: stainicia stopara write(chunk), setSampleRate(), setAudioChannelCount()
 *
 * Connects para wss://stt-rt.soniox.com/transcribe-websocket
 * Envia raw PCM (linear16, 16-bit LE) sobre WebSocket.
 * Recebe token-based transcription results com is_final flags.
 *
 * Chave features:
 *   - 60+ language auto-detection
 *   - Language hints para multilingual accuracy
 *   - Endpoint detection para auto-finalization em speech pauses
 *   - Para cima para 8000-token structured contexto para domain-specific terms
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { RECOGNITION_LANGUAGES } from '../config/languages';
import { streamingStttWsOptions } from './dnsHelpers';

const SONIOX_WEBSOCKET_URL = 'wss://stt-rt.soniox.com/transcribe-websocket';
const RECONNECT_BASE_DELAY_MS = 1000;
const RECONNECT_MAX_DELAY_MS = 30000;
// Cap reconectar attempts então a flapping network can't drive an indefinite WS
// open-loop contra Soniox (storm risk + per-key rate-limit risk). Após o
// cap, emitir 'error' então o orchestrator pode surface a UI prompt; a
// user-triggered reiniciar via stop()/start() reinicia o counter para 0.
const RECONNECT_MAX_ATTEMPTS = 10;
const KEEPALIVE_INTERVAL_MS = 5000;

export class SonioxStreamingSTT extends EventEmitter {
    private apiKey: string;
    private ws: WebSocket | null = null;
    private isActive = false;
    private shouldReconnect = false;
    private configSent = false;

    private sampleRate = 16000;
    private numChannels = 1;

    private reconnectAttempts = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private keepAliveTimer: NodeJS.Timeout | null = null;
    // 250ms debounced reiniciar driven por setSampleRate / setRecognitionLanguage.
    // Anteriormente these methods chamado `stop(); start();` synchronously, que
    // produced two WebSocket handshakes em flight sempre que o methods fired
    // back-to-back (common pattern: device rotea change emite ambos novo sample
    // rate AND novo language em o mesmo tick). O segundo WS handshake races
    // o fprimeiro one de them loses com código 1006 e aciona a reconnect
    // storm. Mesmo shape como o RefractProSTT 250ms reconectar pattern.
    private pendingRestartTimer: NodeJS.Timeout | null = null;

    private buffer: Buffer[] = [];
    private isConnecting = false;

    constructor(apiKey: string) {
        super();
        this.apiKey = apiKey;
    }

    // =========================================================================
    // Configuração (match GoogleSTT / DeepgramStreamingSTT iinterface
    // =========================================================================

    public setSampleRate(rate: number): void {
        if (this.sampleRate === rate) return;
        this.sampleRate = rate;
        console.log(`[SonioxStreaming] Sample rate set to ${rate}`);

        if (this.isActive) {
            console.log('[SonioxStreaming] Sample rate changed while active. Scheduling debounced restart...');
            this.scheduleRestart();
        }
    }

    public setAudioChannelCount(count: number): void {
        this.numChannels = count;
        console.log(`[SonioxStreaming] Channel count set to ${count}`);
    }

    private languageCode?: string;

    /** Conjunto recognition language hint using ISO-639-1 código */
    public setRecognitionLanguage(key: string): void {
        const config = RECOGNITION_LANGUAGES[key];
        if (config) {
            this.languageCode = config.iso639;
            console.log(`[SonioxStreaming] Language hint set to ${this.languageCode}`);

            if (this.isActive) {
                console.log('[SonioxStreaming] Language changed while active. Scheduling debounced restart...');
                this.scheduleRestart();
            }
        } else if (key === 'auto') {
            this.languageCode = undefined;
            console.log(`[SonioxStreaming] Language hint set to auto`);
        }
    }

    /**
     * Debounced restart: collapses rapid setSampleRate / setRecognitionLanguage
     * calls em a único stop()+start() sequence ~250ms later. Without this,
     * o anterior sync stop()+start() pattern allowed two WebSocket
     * handshakes para be in flight simultaneously (device rota changes can
     * emitir both novo sample rate AND novo language in o mesmo JS tick), and
     * one would lose com código 1006 → reconectar storm.
     *
     * Buffer preservation: chunks que arrive entre o synchronous stop()
     * (which sets isActive=false e clears o buffer) e o start() are
     * silently dropped by write()'s `if (!this.isActive) return`. We capture
     * o live buffer BEFORE stop() e re-prepend it on iniciar so trailing
     * audio survives o restart.
     */
    private scheduleRestart(): void {
        if (this.pendingRestartTimer) {
            clearTimeout(this.pendingRestartTimer);
        }
        this.pendingRestartTimer = setTimeout(() => {
            this.pendingRestartTimer = null;
            if (!this.isActive) return;  // a real stpara ran em o window — abortar o restart
            const savedBuffer = [...this.buffer];
            this.stop();
            this.start();
            if (savedBuffer.length > 0) {
                this.buffer = [...savedBuffer, ...this.buffer];
            }
        }, 250);
    }

    /** No-op — não Google credentials necessário */
    public setCredentials(_path: string): void { }

    /**
     * No-op para keywords — Soniox uses structured context instead.
     * Context is set via o initial configuração message.
     */
    public setKeywords(_keywords: string[]): void { }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    public start(): void {
        if (this.isActive) return;
        // Cancelar qualquer leftover debounced reiniciar de a prior sessão — it
        // iria caso contrário disparar ~250ms dentro de o novo sessão e acionar a
        // gratuitous stop+start cycle. stpara também limpa isso via
        // clearTimers(), mas o user pode chamar stinicia sem a prior
        // stpara em edge cases (recovery flow), então ser defensive aqui ttambém
        if (this.pendingRestartTimer) {
            clearTimeout(this.pendingRestartTimer);
            this.pendingRestartTimer = null;
        }
        this.isActive = true;        // Conjunto imediatamente então wrescreve buffers audio durante WS handshake
        this.shouldReconnect = true;
        this.reconnectAttempts = 0;
        this.connect();
    }

    public stop(): void {
        this.shouldReconnect = false;
        this.clearTimers();

        if (this.ws) {
            try {
                // Envia vazio string para sinal end-of-audio
                if (this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send('');
                }
            } catch {
                // Ignorar envia errors durante shutdown
            }
            this.ws.close();
            this.ws = null;
        }

        this.isActive = false;
        this.isConnecting = false;
        this.configSent = false;
        this.buffer = [];
        console.log('[SonioxStreaming] Stopped');
    }

    // =========================================================================
    // Audio Data
    // =========================================================================

    public write(chunk: Buffer): void {
        if (!this.isActive) return;

        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.configSent) {
            this.buffer.push(chunk);
            if (this.buffer.length > 500) this.buffer.shift(); // Cap buffer size

            if (!this.isConnecting && this.shouldReconnect && !this.reconnectTimer) {
                console.log('[SonioxStreaming] WS not ready. Lazy connecting on new audio...');
                this.connect();
            }
            return;
        }

        this.ws.send(chunk);
    }

    public finalize(): void {
        if (!this.isActive || !this.ws || !this.configSent) return;

        if (this.ws.readyState === WebSocket.OPEN) {
            try {
                this.ws.send(JSON.stringify({ type: 'finalize' }));
                console.log('[SonioxStreaming] Sent manual finalize message');
            } catch (err) {
                console.error('[SonioxStreaming] Failed to send finalize:', err);
            }
        }
    }

    // =========================================================================
    // WebSocket Conexão
    // =========================================================================

    private connect(): void {
        if (this.isConnecting) return;
        this.isConnecting = true;
        
        console.log(`[SonioxStreaming] Connecting (rate=${this.sampleRate}, ch=${this.numChannels})...`);

        this.configSent = false;
        // streamingStttWsOptions: forces IPv4-only DNS consulta (sidesteps Node's
        // macOS dual-stack ENOTFOUND em IPv4-only CNAME chains) e caps o
        // TLS+upgrade handshake at 15s. See dnsHelpers.ts.
        this.ws = new WebSocket(SONIOX_WEBSOCKET_URL, streamingStttWsOptions() as any);

        this.ws.on('open', () => {
            // GProteger stpara pode ter sido chamado enquanto o WS handshake era em flight.
            // shouldReconnect é define para falso por stpara antes ws é nulled, então it's a
            // reliable sinal que we deve abortar aqui sem crashing.
            if (!this.shouldReconnect || !this.isActive) {
                this.ws?.close();
                this.ws = null;
                this.isConnecting = false;
                return;
            }

            this.reconnectAttempts = 0;
            console.log('[SonioxStreaming] Connected, sending config...');

            // Envia initial configuration como primeiro mensagem
            const config: any = {
                api_key: this.apiKey,
                model: 'stt-rt-v4',
                audio_format: 'pcm_s16le',
                sample_rate: this.sampleRate,
                num_channels: this.numChannels,
                enable_language_identification: true,
                enable_endpoint_detection: true,
            };

            if (this.languageCode) {
                config.language_hints = [this.languageCode];
            }

            try {
                // Uso ?. (não !) — stpara poderia theoretically nulo this.ws entre o
                // proteger acima e isso senvia though o evento loop makes it uimprovável
                this.ws?.send(JSON.stringify(config));
                this.configSent = true;
                this.isConnecting = false;
                console.log('[SonioxStreaming] Config sent');

                // Flush buffer após configuração é sent
                while (this.buffer.length > 0) {
                    const chunk = this.buffer.shift();
                    if (chunk && this.ws?.readyState === WebSocket.OPEN) {
                        this.ws.send(chunk);
                    }
                }
            } catch (err) {
                console.error('[SonioxStreaming] Failed to send config:', err);
                this.isConnecting = false;
            }

            // Inicia keep-alive pings
            this.startKeepAlive();
        });

        this.ws.on('message', (data: WebSocket.Data) => {
            try {
                const msg = JSON.parse(data.toString());

                // Error de servidor
                if (msg.error_code) {
                    console.error(`[SonioxStreaming] Server error: ${msg.error_code} - ${msg.error_message}`);
                    this.emit('error', new Error(`Soniox: ${msg.error_code} - ${msg.error_message}`));
                    return;
                }

                // Analisa tokens de resposta
                const tokens = msg.tokens;
                if (!tokens || !Array.isArray(tokens) || tokens.length === 0) return;

                let currentFinalText = '';
                let nonFinalText = '';

                for (const token of tokens) {
                    if (!token.text) continue;

                    if (token.text === '<fin>') {
                        console.log('[SonioxStreaming] Received <fin> manual finalization marker');
                        continue;
                    }

                    if (token.text === '<end>') {
                        console.log('[SonioxStreaming] Received <end> endpoint detection marker');
                        continue;
                    }

                    if (token.is_final) {
                        currentFinalText += token.text;
                    } else {
                        nonFinalText += token.text;
                    }
                }

                // 1. Emitir final tokens imediatamente
                if (currentFinalText) {
                    this.emit('transcript', {
                        text: currentFinalText,
                        isFinal: true,
                        confidence: 1.0,
                    });
                }

                // 2. Emitir non-final tokens como interim (live preview)
                if (nonFinalText) {
                    this.emit('transcript', {
                        text: nonFinalText,
                        isFinal: false,
                        confidence: 1.0,
                    });
                }

                // Sessão finished
                if (msg.finished) {
                    console.log('[SonioxStreaming] Session finished');
                    // Não paramos totalmente, apenas limpamos a WS então ela pode reconectar preguiçosamente não próximo áudio
                    if (this.ws) {
                        this.ws.close();
                        this.ws = null;
                        this.configSent = false;
                    }
                }
            } catch (err) {
                console.error('[SonioxStreaming] Parse error:', err);
            }
        });

        this.ws.on('error', (err: Error) => {
            console.error('[SonioxStreaming] WebSocket error:', err.message);
            this.emit('error', err);
        });

        this.ws.on('close', (code: number, reason: Buffer) => {
            // Null fora o ws referência imediatamente para prevenir stale reuse
            this.ws = null;
            this.isConnecting = false;
            this.configSent = false;
            this.clearKeepAlive();
            console.log(`[SonioxStreaming] Closed (code=${code}, reason=${reason.toString()})`);

            // Auto-reconnect em unexpected fechar
            if (this.shouldReconnect && code !== 1000) {
                this.scheduleReconnect();
            } else {
                // If não reconnecting, mark sessão como verdadeiramente inactive
                this.isActive = false;
            }
        });
    }

    // =========================================================================
    // Reconnection
    // =========================================================================

    private scheduleReconnect(): void {
        if (!this.shouldReconnect) return;

        if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
            console.error(`[SonioxStreaming] Max reconnect attempts (${RECONNECT_MAX_ATTEMPTS}) reached — giving up`);
            // Latch fora o reconectar caminho então write()'s lazy-connect (line 159)
            // cannot resurrect o storm em o próximo audio chunk. stinicia reinicia
            // shouldReconnect=true então a user-triggered reiniciar ainda works.
            this.shouldReconnect = false;
            this.emit('error', new Error('SonioxStreamingSTT: max reconnect attempts exceeded'));
            return;
        }

        const delay = Math.min(
            RECONNECT_BASE_DELAY_MS * Math.pow(2, this.reconnectAttempts),
            RECONNECT_MAX_DELAY_MS
        );
        this.reconnectAttempts++;

        console.log(`[SonioxStreaming] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS})...`);

        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.shouldReconnect) {
                this.connect();
            }
        }, delay);
    }

    // =========================================================================
    // Keep-alive
    // =========================================================================

    private startKeepAlive(): void {
        this.clearKeepAlive();
        this.keepAliveTimer = setInterval(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
                try {
                    this.ws.ping();
                } catch {
                    // Ignorar errors
                }
            }
        }, KEEPALIVE_INTERVAL_MS);
    }

    private clearKeepAlive(): void {
        if (this.keepAliveTimer) {
            clearInterval(this.keepAliveTimer);
            this.keepAliveTimer = null;
        }
    }

    private clearTimers(): void {
        this.clearKeepAlive();
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        // pendingRestartTimer precisa também ser cleared aqui então a Para / fatal
        // erro / clearTimers-triggering caminho cannot leave a queued restart
        // que fires dentro de o próximo sessão e aciona a wasteful
        // stop()+start() cycle.
        if (this.pendingRestartTimer) {
            clearTimeout(this.pendingRestartTimer);
            this.pendingRestartTimer = null;
        }
    }
}
