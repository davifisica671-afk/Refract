/**
 * MicrophoneCapture - Módulo de Captura de Áudio do Microfone
 *
 * Captura o áudio de entrada (microfone) via módulo nativo Rust (NAPI-RS),
 * emitindo chunks de PCM para o pipeline de STT.
 *
 * Diferente de SystemAudioCapture (lazy), este wrapper faz PRÉ-WARM ANSIOSO:
 * o monitor Rust é construído já no construtor e novamente no fim de stop(),
 * pronto para a próxima reunião. O cold-start do cpal (abertura do stream de
 * entrada) custa centenas de ms; pré-aquecer evita esse atraso no start().
 *
 * Contrato observável (ver __tests__/MicrophoneCapturePreWarmFailed.test.mjs):
 * - `new MicrophoneCapture(id)` constrói a instância nativa #1 (pré-warm).
 * - `start()` reutiliza o monitor já construído — NÃO cria um novo.
 * - `stop()` adia o teardown nativo via setImmediate e, em seguida, pré-aquece
 *   um novo monitor; se essa construção lançar, emite `'pre_warm_failed'` com
 *   o Error subjacente (observabilidade — antes o erro era silenciosamente
 *   engolido por um console.error).
 *
 * Eventos: 'start', 'stop', 'data' (Buffer), 'speech_ended',
 *          'sample_rate_changed' (number), 'error' (Error), 'pre_warm_failed' (Error).
 */

import { EventEmitter } from 'events';
import { loadNativeModule } from './nativeModuleLoader';

// RustMicCapture é a classe Rust nativa (napi-rs) que captura o microfone.
// Pode ser nula se o binário não estiver disponível — os métodos degradam com log.
const NativeModule: any = loadNativeModule();
const { MicrophoneCapture: RustMicCapture } = NativeModule || {};

export class MicrophoneCapture extends EventEmitter {
    private isRecording: boolean = false;
    private deviceId: string | null = null;
    private detectedSampleRate: number = 48000;
    private monitor: any = null;
    private chunkCount: number = 0;
    private sampleRatePollTimers: NodeJS.Timeout[] = [];
    // Pré-warm ligado por padrão. O painel de teste de áudio o desliga via
    // disablePreWarm() para não manter a thread DSP viva após fechar o painel.
    private preWarmEnabled: boolean = true;
    // Teardown assíncrono idempotente — aguardar garante que o handler do cpal /
    // WASBI foi liberado antes do chamador reiniciar a captura.
    private _teardownPromise: Promise<void> | null = null;

    constructor(deviceId?: string | null) {
        super();
        this.deviceId = deviceId || null;
        if (!RustMicCapture) {
            console.error('[MicrophoneCapture] Rust class implementation not found.');
            return;
        }
        // PRÉ-WARM ANSIOSO: constrói o monitor nativo já aqui para que o próximo
        // start() não pague o cold-start do cpal. Falha de construção não é fatal:
        // o start() faz um re-init defensivo.
        try {
            this.monitor = new RustMicCapture(this.deviceId);
            console.log(`[MicrophoneCapture] Initialized (eager pre-warm). Device ID: ${this.deviceId || 'default'}`);
        } catch (e) {
            console.error('[MicrophoneCapture] Eager native init failed; will retry lazily on start():', e);
            this.monitor = null;
        }
    }

    /**
     * Desliga o pré-warm-no-stop. Usado pelo teste de áudio para que fechar o
     * painel não deixe um monitor recém-construído mantendo a thread DSP viva.
     */
    public disablePreWarm(): void {
        this.preWarmEnabled = false;
    }

    /**
     * Taxa de amostragem EMITIDA entregue ao STT (canônica 16000 após o resampler
     * DSP, ou a taxa nativa se o resampling não estiver disponível). Declare ISTO
     * aos provedores STT.
     */
    public getSampleRate(): number {
        if (this.monitor) {
            if (typeof this.monitor.getSampleRate === 'function') {
                const emittedRate = this.monitor.getSampleRate();
                if (emittedRate !== this.detectedSampleRate) {
                    console.log(`[MicrophoneCapture] Emitted STT rate: ${emittedRate}`);
                    this.detectedSampleRate = emittedRate;
                }
                return emittedRate;
            } else if (typeof this.monitor.get_sample_rate === 'function') {
                const emittedRate = this.monitor.get_sample_rate();
                if (emittedRate !== this.detectedSampleRate) {
                    console.log(`[MicrophoneCapture] Emitted STT rate: ${emittedRate}`);
                    this.detectedSampleRate = emittedRate;
                }
                return emittedRate;
            }
        }
        return this.detectedSampleRate;
    }

    /**
     * Taxa nativa do hardware (ex: 24000 para AirPods HFP, 48000 built-in) — apenas
     * para diagnóstico / detecção de degradação HFP. Retorna 0 se indisponível.
     */
    public getNativeSampleRate(): number {
        if (!this.monitor) return 0;
        try {
            if (typeof this.monitor.getNativeSampleRate === 'function') {
                return this.monitor.getNativeSampleRate();
            }
        } catch (e) {
            console.warn('[MicrophoneCapture] getNativeSampleRate failed:', e);
        }
        return 0;
    }
    /**
     * Inicia a captura. Reutiliza o monitor pré-aquecido (construído no construtor
     * ou no stop() anterior); só constrói um novo se o pré-warm tiver falhado.
     */
    public start(): void {
        if (this.isRecording) return;

        if (!RustMicCapture) {
            console.error('[MicrophoneCapture] Cannot start: Rust module missing');
            return;
        }

        // Re-init defensivo: o pré-warm falhou ou foi consumido. Normalmente
        // o monitor já existe (pré-aquecido), então nenhum novo é criado aqui.
        if (!this.monitor) {
            try {
                this.monitor = new RustMicCapture(this.deviceId);
            } catch (e) {
                console.error('[MicrophoneCapture] Failed to create native monitor:', e);
                this.emit('error', e);
                return;
            }
        }

        try {
            console.log('[MicrophoneCapture] Starting native capture...');
            this.chunkCount = 0;
            this.isRecording = true; // antes do start() para prevenir reentrância

            this.monitor.start((err: Error | null, chunk: Buffer) => {
                if (err) {
                    console.error('[MicrophoneCapture] Callback error:', err);
                    this.isRecording = false; // permitir recuperação via restart
                    this.emit('error', err);
                    return;
                }
                // PROTEÇÃO PÓS-STOP: stop() adia monitor.stop() para setImmediate,
                // então a thread DSP do Rust ainda pode chamar isto na janela. Soltar
                // chunks no limite JS deixa o STT.finalize() ver o fim do áudio.
                if (!this.isRecording) return;
                if (chunk && chunk.length > 0) {
                    this.chunkCount++;
                    if (this.chunkCount <= 3 || this.chunkCount % 500 === 0) {
                        console.log(`[MicrophoneCapture] Chunk #${this.chunkCount}: ${chunk.length} bytes from Rust`);
                    }
                    this.emit('data', chunk);
                }
            }, (err: Error | null, _ended: boolean) => {
                // Fim de fala do Rust SilenceSuppressor (_ended sempre true quando dispara).
                if (err) {
                    console.error('[MicrophoneCapture] Speech ended callback error:', err);
                    return;
                }
                this.emit('speech_ended');
            });

            // A taxa real só é conhecida após o cpal inicializar (~1s). Ler antes do
            // start() retornaria o default do construtor. Consultar em 1s e 8s.
            if (typeof this.monitor.getSampleRate === 'function' || typeof this.monitor.get_sample_rate === 'function') {
                const pollRate = () => {
                    const rate = typeof this.monitor?.getSampleRate === 'function'
                        ? this.monitor.getSampleRate()
                        : this.monitor?.get_sample_rate?.();
                    if (rate && rate !== this.detectedSampleRate) {
                        this.detectedSampleRate = rate;
                        console.log(`[MicrophoneCapture] Detected sample rate: ${rate}Hz`);
                        this.emit('sample_rate_changed', rate);
                    }
                };
                this.sampleRatePollTimers.push(setTimeout(pollRate, 1000));
                this.sampleRatePollTimers.push(setTimeout(pollRate, 8000));
            }

            this.emit('start');
        } catch (error) {
            console.error('[MicrophoneCapture] Failed to start:', error);
            this.isRecording = false;
            // Recurso órfão: monitor.start() pode lançar após o construtor Rust já
            // ter alocado o stream cpal. Liberar de forma determinística no próximo
            // tick evita contention com um novo monitor no retry de recuperação.
            const dying = this.monitor;
            this.monitor = null;
            if (dying) {
                setImmediate(() => {
                    try {
                        dying.stop();
                    } catch (e) {
                        console.error('[MicrophoneCapture] Error stopping orphaned monitor after failed start:', e);
                    }
                });
            }
            this.emit('error', error);
        }
    }
    /**
     * Para a captura. Define isRecording=false sincronamente (o mundo JS vê o
     * estado parado na hora) e adia o monitor.stop() nativo bloqueante para
     * setImmediate. Após o teardown, PRÉ-AQUECE um novo monitor para a próxima
     * sessão (a menos que disablePreWarm() tenha sido chamado). Se o construtor
     * de pré-warm lançar, emite 'pre_warm_failed' — nunca propaga.
     * `await stop()` resolve quando o handler nativo foi liberado.
     */
    public stop(): Promise<void> {
        if (!this.isRecording) {
            return this._teardownPromise ?? Promise.resolve();
        }

        // Cancelar polls de sample rate pendentes antes de zerar o monitor.
        for (const t of this.sampleRatePollTimers) clearTimeout(t);
        this.sampleRatePollTimers = [];

        console.log('[MicrophoneCapture] Stopping capture (deferred native teardown)...');
        this.isRecording = false;
        const dying = this.monitor;
        // Zerar sincronamente. O pré-warm abaixo (ou o próximo start()) instala um
        // monitor fresco — reusar a mesma instância Rust após stop() deixa o stream
        // cpal semi-inicializado (0 chunks por vários segundos na segunda reunião).
        this.monitor = null;

        const teardownPromise = new Promise<void>((resolve) => {
            setImmediate(() => {
                try {
                    dying?.stop();
                } catch (e) {
                    console.error('[MicrophoneCapture] Error stopping (deferred):', e);
                }
                // Pré-warm do monitor para a próxima sessão. Uma falha aqui (cpal/HAL
                // transiente, dispositivo removido) é observável via 'pre_warm_failed'
                // em vez de ser silenciosamente engolida.
                if (this.preWarmEnabled && RustMicCapture) {
                    try {
                        this.monitor = new RustMicCapture(this.deviceId);
                    } catch (e) {
                        this.monitor = null;
                        this.emit('pre_warm_failed', e instanceof Error ? e : new Error(String(e)));
                    }
                }
                resolve();
            });
        });
        this._teardownPromise = teardownPromise;
        void teardownPromise.then(() => {
            if (this._teardownPromise === teardownPromise) {
                this._teardownPromise = null;
            }
        });

        this.emit('stop');
        return teardownPromise;
    }

    /**
     * Descarta permanentemente esta instância. Após destroy(), não reutilizar.
     * Desliga o pré-warm para não ressuscitar um monitor durante o teardown, então
     * libera qualquer monitor pré-aquecido remanescente e remove os listeners.
     */
    public async destroy(): Promise<void> {
        this.preWarmEnabled = false;
        // Aguardar o teardown antes de remover listeners para que callbacks Rust em
        // voo não disparem num wrapper que o chamador considera morto.
        await this.stop();
        const dying = this.monitor;
        this.monitor = null;
        if (dying) {
            try {
                dying.stop();
            } catch (e) {
                console.error('[MicrophoneCapture] Error stopping pre-warmed monitor on destroy:', e);
            }
        }
        this.removeAllListeners();
    }
}
