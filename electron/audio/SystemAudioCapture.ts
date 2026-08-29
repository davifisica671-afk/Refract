/**
 * SystemAudioCapture - Módulo de Captura de Áudio do Sistema
 *
 * Este arquivo implementa a captura de áudio do sistema (áudio reproduzido no dispositivo)
 * utilizando um módulo nativo Rust via NAPI-RS. O módulo é carregado de forma preguiçosa
 * (lazy loading) para evitar muting de áudio e perda de qualidade na inicialização.
 *
 * Funcionalidades principais:
 * - Captura de áudio do sistema via módulo Rust nativo
 * - Suporte a dispositivos específicos ou configuração padrão
 * - Callbacks de dados de áudio em tempo real
 * - Detecção de taxa de amostragem do hardware
 * - Detecção de silêncio via Rust SilenceSuppressor
 * - Gerenciamento seguro de recursos com teardown assíncrono
 *
 * O áudio é emitido como chunks de Buffer para processamento posterior (STT).
 */

import { EventEmitter } from 'events';
import { loadNativeModule } from './nativeModuleLoader';

// RustAudioCapture é a classe Rust nativa (napi-rs) que captura áudio do sistema.
// Pode ser nula se o módulo binário não estiver disponível — o construtor registra um erro nesse caso.
const NativeModule: any = loadNativeModule();
const { SystemAudioCapture: RustAudioCapture } = NativeModule || {};

export class SystemAudioCapture extends EventEmitter {
    private isRecording: boolean = false;
    private deviceId: string | null = null;
    private detectedSampleRate: number = 48000;
    private monitor: any = null;
    private chunkCount: number = 0;
    private sampleRatePollTimers: NodeJS.Timeout[] = [];
    // Ver MicrophoneCapture para o raciocínio completo — mesmo padrão de rastreamento
    // de teardown idempotente. Aguardar o teardown garante que o manipulador do
    // CoreAudio Tap / SCK / WASAPI foi liberado antes que o chamador construa
    // uma nova instância ou reinicie a captura.
    private _teardownPromise: Promise<void> | null = null;

    constructor(deviceId?: string | null) {
        super();
        this.deviceId = deviceId || null;
        if (!RustAudioCapture) {
            console.error('[SystemAudioCapture] Rust class implementation not found.');
        } else {
            // INICIALIZAÇÃO PREGUIÇOSA: Não cria o monitor nativo aqui - isso causa 1 segundo de mudo de áudio + perda de qualidade
            // O monitor será criado no start() quando a reunião realmente começar
            console.log(`[SystemAudioCapture] Initialized (lazy). Device ID: ${this.deviceId || 'default'}`);
        }
    }

    /**
     * A taxa de amostragem emitida entregue ao STT — canônica 16000 após o
     * resampler DSP (ou a taxa nativa se resampling não estiver disponível).
     * Declare ISTO para os provedores STT. (Pré-resampler isso retornava a taxa
     * nativa; o DSP agora normaliza para 16kHz para que os provedores recebam
     * uma taxa consistente e com anti-aliasing.)
     */
    public getSampleRate(): number {
        if (this.monitor) {
            // NAPI-RS V3 auto-converts Rust snake_case para camelCase
            if (typeof this.monitor.getSampleRate === 'function') {
                const emittedRate = this.monitor.getSampleRate();
                if (emittedRate !== this.detectedSampleRate) {
                    console.log(`[SystemAudioCapture] Emitted STT rate: ${emittedRate}`);
                    this.detectedSampleRate = emittedRate;
                }
                return emittedRate;
            } else if (typeof this.monitor.get_sample_rate === 'function') {
                const emittedRate = this.monitor.get_sample_rate();
                if (emittedRate !== this.detectedSampleRate) {
                    console.log(`[SystemAudioCapture] Emitted STT rate: ${emittedRate}`);
                    this.detectedSampleRate = emittedRate;
                }
                return emittedRate;
            }
        }
        return this.detectedSampleRate;
    }

    /**
     * Taxa de amostragem do hardware nativo (ex: 48000) — apenas para diagnósticos,
     * NÃO é a taxa dos bytes emitidos. Retorna 0 se indisponível.
     */
    public getNativeSampleRate(): number {
        if (!this.monitor) return 0;
        try {
            if (typeof this.monitor.getNativeSampleRate === 'function') {
                return this.monitor.getNativeSampleRate();
            }
        } catch (e) {
            console.warn('[SystemAudioCapture] getNativeSampleRate failed:', e);
        }
        return 0;
    }

    /**
     * Iniciar a captura de áudio
     */
    public start(): void {
        if (this.isRecording) return;

        if (!RustAudioCapture) {
            console.error('[SystemAudioCapture] Cannot start: Rust module missing');
            return;
        }

        // INICIALIZAÇÃO PREGUIÇOSA: Cria o monitor aqui quando a reunião inicia (não no construtor)
        // Isso previne o 1 segundo de mudo de áudio + perda de qualidade na inicialização do app
        if (!this.monitor) {
            console.log('[SystemAudioCapture] Creating native monitor (lazy init)...');
            try {
                this.monitor = new RustAudioCapture(this.deviceId);
            } catch (e) {
                console.error('[SystemAudioCapture] Failed to create native monitor:', e);
                this.emit('error', e);
                return;
            }
        }

        try {
            console.log('[SystemAudioCapture] Starting native capture...');
            this.chunkCount = 0;

            this.isRecording = true; // Definido antes do start() para prevenir chamadas reentrantes

            this.monitor.start((err: Error | null, chunk: Buffer) => {
                // napi v3 ThreadsafeFunction passa no formato (err, arg)
                if (err) {
                    console.error('[SystemAudioCapture] Callback error:', err);
                    this.isRecording = false; // Permitir recuperação via restart
                    this.emit('error', err);
                    return;
                }
                if (chunk && chunk.length > 0) {
                    // PROTEÇÃO PÓS-STOP: O stop() adia o monitor.stop() nativo para
                    // setImmediate, então durante essa breve janela a thread DSP do Rust
                    // ainda está executando e pode invocar este callback. Soltar chunks no
                    // limite JS permite que o STT.finalize() veja o "fim do áudio" e
                    // emita os finais restantes de forma determinística.
                    if (!this.isRecording) return;
                    this.chunkCount++;
                    if (this.chunkCount <= 3 || this.chunkCount % 500 === 0) {
                        console.log(`[SystemAudioCapture] Chunk #${this.chunkCount}: ${chunk.length} bytes from Rust`);
                    }
                    // DESEMPENHO: napi-rs já retorna um Nó Buffer owned do Buffer::from(bytes) do Rust.
                    // O anterior `Buffer.from(chunk)` era uma cópia redundante de ~1.9KB por chunk
                    // × 50/sec = ~95KB/sec de pressão de GC. O downstream (googleSTT.write)
                    // não muta o buffer.
                    this.emit('data', chunk);
                }
            }, (err: Error | null, _ended: boolean) => {
                // Callback de fim de fala do Rust SilenceSuppressor.
                // _ended é sempre `true` quando disparado (Rust apenas invoca na transição fala→silêncio).
                if (err) {
                    console.error('[SystemAudioCapture] Speech ended callback error:', err);
                    return;
                }
                this.emit('speech_ended');
            });

            // getSampleRate Precisa ser chamado Após o start() — a inicialização em segundo plano
            // atualiza o atômico uma vez que o SCK/CoreAudio inicializa (~5-7s). Ler antes do
            // start() sempre retorna o padrão do construtor (48000), não a taxa real do hardware.
            // Buscar a taxa de amostragem real assim que o monitor inicia
            if (typeof this.monitor.getSampleRate === 'function' || typeof this.monitor.get_sample_rate === 'function') {
                const pollRate = () => {
                    const rate = typeof this.monitor?.getSampleRate === 'function' 
                        ? this.monitor.getSampleRate() 
                        : this.monitor?.get_sample_rate?.();
                    if (rate && rate !== this.detectedSampleRate) {
                        this.detectedSampleRate = rate;
                        console.log(`[SystemAudioCapture] Detected sample rate: ${rate}Hz`);
                        this.emit('sample_rate_changed', rate);
                    }
                };
                
                // Consulta rapidamente no início, então uma vez após o SCK provavelmente estar completamente inicializado.
                // Armazenar IDs dos timers para que o stop() possa cancelá-los se chamado antes de dispararem —
                // impede que uma consulta obsoleta leia de uma instância nula ou recriada do monitor.
                this.sampleRatePollTimers.push(setTimeout(pollRate, 1000));
                this.sampleRatePollTimers.push(setTimeout(pollRate, 8000));
            }

            this.emit('start');
        } catch (error) {
            console.error('[SystemAudioCapture] Failed to start:', error);
            this.isRecording = false;
            // CORREÇÃO DE RECURSO ÓRFÃO: monitor.start() pode lançar após o construtor
            // Rust ter alocado recursos CoreAudio Tap / aggregate-device / SCK e
            // possivelmente iniciado sua thread DSP. O código anterior apenas
            // definia this.monitor como nulo, deixando esses recursos nativos
            // mantidos por um objeto JS inalcançável até o GC executar —
            // potencialmente segundos ou minutos depois. Se o usuário tentar
            // novamente via o manipulador de recuperação em main.ts, o NOVO monitor
            // construído para o próximo start() compete com o morrendo para travar
            // o property-listener do CoreAudio HAL e produz "0 chunks em 8s".
            //
            // Para a instância morrendo, no próximo tick seu lado nativo libera
            // seus recursos de forma determinística. Executa em setImmediate
            // (não sincronamente) por duas razões:
            //   (a) já estamos dentro de um manipulador de exceção — o usuário
            //       vai ver a emissão de 'error' no final deste bloco,
            //       e não queremos que uma chamada nativa bloqueante impeça
            //       o caminho de erro JS
            //   (b) a inicialização parcial pode ainda estar segurando locks
            //       Rust não-reentrantes; adiar contorna isso completamente.
            const dying = this.monitor;
            this.monitor = null;
            if (dying) {
                setImmediate(() => {
                    try {
                        dying.stop();
                    } catch (e) {
                        console.error('[SystemAudioCapture] Error stopping orphaned monitor after failed start:', e);
                    }
                });
            }
            this.emit('error', error);
        }
    }

    /**
     * Parar a captura.
     *
     * DESEMPENHO: A chamada nativa `monitor.stop()` é uma chamada Rust síncrona que
     * espera pela thread DSP para terminar E libera os manipuladores de áudio da
     * plataforma (CoreAudio Tap / SCK / WASAPI). No Windows isso pode bloquear
     * 100–300ms. Definimos `isRecording = false` sincronamente para que o resto
     * do mundo JS veja o estado parado imediatamente, então executamos a parada
     * nativa no próximo tick do loop de eventos libuv. O processo principal do
     * Electron retorna para o chamador IPC (botão "Parar" do renderer) sem
     * esperar pelo teardown nativo.
     *
     * SEGURANÇA: uma vez `isRecording = false`, nenhum evento `'data'` mais será
     * emitido (a proteção do lado JS faz curto-circuito) e a chamada nativa é um
     * no-op após o lado Rust inverter seu próprio atômico. Portanto, adiar a
     * parada nativa é livre de races em relação ao contrato externo deste objeto.
     */
    public stop(): Promise<void> {
        // Idempotente — ver MicrophoneCapture.stop().
        if (!this.isRecording) {
            return this._teardownPromise ?? Promise.resolve();
        }

        // Cancelar consultas de taxa de amostragem pendentes antes de definir o monitor como nulo
        // para prevenir timers obsoletos de lerem de nulo ou monitor recriado no próximo start()
        for (const t of this.sampleRatePollTimers) clearTimeout(t);
        this.sampleRatePollTimers = [];

        console.log('[SystemAudioCapture] Stopping capture (deferred native teardown)...');
        this.isRecording = false;
        const monitor = this.monitor;
        // Definir o campo como nulo sincronamente para que o próximo start() tome o ramo
        // de inicialização preguiçosa e construa um novo monitor Rust. O Rust monitor.stop()
        // libera o CoreAudio Tap / aggregate device — chamar start() na mesma instância
        // Rust depois disso deixa o Tap em um estado semi-inicializado que produz
        // zero chunks por 5–8s (sintoma manifest em segunda reunião: "produced 0 chunks
        // em 8s" + timeout de handshake STT).
        this.monitor = null;

        const teardownPromise = new Promise<void>((resolve) => {
            // Adiar a chamada nativa bloqueante. setImmediate executa após a iteração
            // atual do poll estar completa, o que é suficiente para liberar a thread
            // principal do Electron a voltar para o chamador IPC antes que o teardown
            // nativo comece. O resolve() no final deste corpo faz com que
            // `await capture.stop()` signifique "o manipulador HAL nativo foi liberado".
            setImmediate(() => {
                try {
                    monitor?.stop();
                } catch (e) {
                    console.error('[SystemAudioCapture] Error stopping (deferred):', e);
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
     * Descartar permanentemente esta instância.
     * Para a captura, remove todos os ouvintes de eventos e libera o monitor nativo.
     * Após destroy(), não reutilize esta instância.
     */
    public async destroy(): Promise<void> {
        // Aguardar o teardown antes de remover listeners para que callbacks Rust em
        // voo (data / speech_ended) não disparem em um wrapper que o chamador
        // considera morto. Ver MicrophoneCapture.destroy() para o raciocínio paralelo.
        await this.stop();
        this.removeAllListeners();
        this.monitor = null;
    }
}
