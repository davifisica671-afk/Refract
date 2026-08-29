/**
 * ElevenLabsStreamingSTT — Provedor de Speech-to-Text via WebSocket do ElevenLabs
 *
 * Implementa transcrição de áudio em tempo real utilizando a API WebSocket
 * do ElevenLabs Scribe v2. Realiza downsampling de áudio de entrada para
 * 16kHz, acumula amostras PCM e envia em blocos. Suporta reconexão com
 * backoff exponencial e limite máximo de tentativas.
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RECOGNITION_LANGUAGES } from '../config/languages';
import { streamingStttWsOptions } from './dnsHelpers';

const ELEVENLABS_WS_URL = 'wss://api.elevenlabs.io/v1/speech-to-text/realtime';
// Limitar tentativas de reconexão para que uma rede instável não possa dirigir um WS
// em loop aberto contra ElevenLabs (risco de tempestade + risco de limite de taxa por chave). Após
// o limite, emitir 'error' para que o orquestrador possa mostrar prompt na interface; um
// reinício acionado pelo usuário via stop()/start() reinicia o contador para 0.
const RECONNECT_MAX_ATTEMPTS = 10;

export class ElevenLabsStreamingSTT extends EventEmitter {
    private apiKey: string;
    private ws: WebSocket | null = null;
    private isActive = false;
    private shouldReconnect = false;
    private reconnectAttempts = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private inputSampleRate = 48000; // taxa de captura do microfone/áudio do sistema
    private targetSampleRate = 16000; // taxa exigida pelo ElevenLabs Scribe v2
    
    private buffer: Buffer[] = [];
    private isConnecting = false;
    private isSessionReady = false;
    private languageCode = 'en'; // Padrão: inglês
    
    private debugWriteStream: fs.WriteStream | null = null;
    
    // Propriedades de buffering de chunks (250ms @ 16k = 4000 amostras)
    private pcmAccumulator: Int16Array[] = [];
    private pcmAccumulatorLen = 0;
    private readonly SEND_THRESHOLD_SAMPLES = 4000;
    
    private debugMessageCount = 0;

    constructor(apiKey: string) {
        super();
        this.apiKey = apiKey;
        
        // Abrir arquivo de depuração apenas em desenvolvimento para evitar preenchimento do disco em produção
        if (process.env.NODE_ENV === 'development') {
            try {
                const debugPath = path.join(os.homedir(), 'elevenlabs_debug.raw');
                this.debugWriteStream = fs.createWriteStream(debugPath);
                console.log(`[ElevenLabsStreaming] Audio debug stream opened at: ${debugPath}`);
            } catch (e) {
                console.error('[ElevenLabsStreaming] Failed to open debug stream:', e);
            }
        }
    }

    public setSampleRate(rate: number): void {
        this.inputSampleRate = rate;
        console.log(`[ElevenLabsStreaming] Input sample rate set to ${rate}Hz`);
        // Sempre fazemos downsampling para 16000Hz para o ElevenLabs
    }

    /** Sem operação — o ElevenLabs Scribe espera contagem de canais mono */
    public setAudioChannelCount(_count: number): void {}

    /** Idioma de reconhecimento — mapeia chave Refract para ISO-639-1 do ElevenLabs, ou 'auto' para omitir código */
    public setRecognitionLanguage(key: string): void {
        const newCode = key === 'auto' ? '' : (RECOGNITION_LANGUAGES[key]?.iso639 ?? this.languageCode);
        if (this.languageCode !== newCode) {
            console.log(`[ElevenLabsStreaming] Language changed: ${this.languageCode || '(auto)'} -> ${newCode || '(auto)'}`);
            this.languageCode = newCode;
            if (this.isActive) {
                console.log('[ElevenLabsStreaming] Restarting session to apply new language...');
                this.stop();
                this.start();
            }
        }
    }

    /** Sem operação — credenciais passadas via chave de API */
    public setCredentials(_path: string): void {}

    public start(): void {
        if (this.isActive) return;
        if (this.isConnecting) return; // Já em conexão (previne condição de corrida de dupla-conexão)
        this.isActive = true;          // Definido imediatamente para que escreva áudio nos buffers durante o handshake WS
        this.shouldReconnect = true;
        this.reconnectAttempts = 0;
        this.connect();
    }

    public stop(): void {
        this.shouldReconnect = false;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.close();
            this.ws = null;
        }
        this.isActive = false;
        this.isConnecting = false;
        this.isSessionReady = false;
        this.buffer = [];
        this.pcmAccumulator = [];
        this.pcmAccumulatorLen = 0;
        if (this.debugWriteStream) {
            this.debugWriteStream.end();
            this.debugWriteStream = null;
        }
        console.log('[ElevenLabsStreaming] Stopped');
    }

    public finalize(): void {
        if (!this.isActive || !this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isSessionReady) return;

        if (this.pcmAccumulatorLen > 0) {
            const combined = new Int16Array(this.pcmAccumulatorLen);
            let offset = 0;
            for (const arr of this.pcmAccumulator) {
                combined.set(arr, offset);
                offset += arr.length;
            }
            this.pcmAccumulator = [];
            this.pcmAccumulatorLen = 0;
            try {
                this.ws.send(JSON.stringify({
                    message_type: 'input_audio_chunk',
                    audio_base_64: Buffer.from(combined.buffer, combined.byteOffset, combined.byteLength).toString('base64'),
                }));
                console.log('[ElevenLabsStreaming] Finalize — flushed pending accumulator');
            } catch (err) {
                console.error('[ElevenLabsStreaming] Finalize flush failed:', err);
            }
        }
    }

    /**
     * Escreve dados de áudio PCM brutos.
     * O WebSocket do ElevenLabs espera "input_audio_chunk" em base64 16-bit PCM.
     * Nota: A entrada do Refract DSP é Float PCM de 32 bits (F32).
     */
    public write(chunk: Buffer): void {
        if (!this.isActive) return;

        if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.isSessionReady) {
            this.buffer.push(chunk);
            if (this.buffer.length > 500) {
                this.buffer.shift(); // Cap buffer size
                console.warn('[ElevenLabsStreaming] Buffer full — oldest audio chunk dropped.');
            }

            if (!this.isConnecting && this.shouldReconnect && !this.reconnectTimer) {
                console.log('[ElevenLabsStreaming] WS not ready. Lazy connecting on new audio...');
                this.connect();
            }
            return;
        }

        // Capturar referência do ws antes de operações assíncronas para proteger contra fechamento concorrente
        const ws = this.ws;

        try {
            // O buffer de entrada do módulo nativo já é 16-bit PCM (Int16LE).
            // Não ler como ponto flutuante
            const inputS16 = new Int16Array(chunk.buffer, chunk.byteOffset, chunk.byteLength / 2);
            
            let outputS16: Int16Array;

            if (this.inputSampleRate === this.targetSampleRate) {
                // Não downsampling needed
                outputS16 = inputS16;
            } else {
                // Downsampling de inputSampleRate (ex: 48000) para 16000Hz
                const downsampleFactor = this.inputSampleRate / this.targetSampleRate;
                const outputLength = Math.floor(inputS16.length / downsampleFactor);
                outputS16 = new Int16Array(outputLength);

                for (let i = 0; i < outputLength; i++) {
                    // Decimação simples (pegar cada N-ésimo sample)
                    outputS16[i] = inputS16[Math.floor(i * downsampleFactor)];
                }
            }

            // Escrever no arquivo de depuração
            if (this.debugWriteStream) {
                // Usar argumentos completos de slice para evitar copiar todo o ArrayBuffer
                this.debugWriteStream.write(Buffer.from(outputS16.buffer, outputS16.byteOffset, outputS16.byteLength));
            }

            // Acumular
            this.pcmAccumulator.push(outputS16);
            this.pcmAccumulatorLen += outputS16.length;

            if (this.pcmAccumulatorLen >= this.SEND_THRESHOLD_SAMPLES) {
                // Combinar
                const combined = new Int16Array(this.pcmAccumulatorLen);
                let offset = 0;
                for (const arr of this.pcmAccumulator) {
                    combined.set(arr, offset);
                    offset += arr.length;
                }

                // Reiniciar
                this.pcmAccumulator = [];
                this.pcmAccumulatorLen = 0;

                const base64 = Buffer.from(combined.buffer, combined.byteOffset, combined.byteLength).toString('base64');
                // ElevenLabs Scribe v2 exige os campos message_type e audio_base_64
                // Usar a captura feita anteriormente para evitar null-dereference por fechamento concorrente
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        message_type: 'input_audio_chunk',
                        audio_base_64: base64,
                    }));
                }
            }
        } catch (err) {
            console.warn('[ElevenLabsStreaming] write failed:', err);
        }
    }

    private connect(): void {
        if (this.isConnecting) return;
        this.isConnecting = true;
        this.isSessionReady = false;
        
        console.log(`[ElevenLabsStreaming] Connecting`, { hasApiKey: Boolean(this.apiKey) });

        // URL bruta do WebSocket com parâmetros
        let url = `${ELEVENLABS_WS_URL}?model_id=scribe_v2_realtime&include_timestamps=true&sample_rate=${this.targetSampleRate}`;
        
        // Sempre habilitar detecção de idioma, apenas fixar um código específico quando um for definido
        if (this.languageCode) {
            url += `&language_code=${this.languageCode}`;
        }
        url += `&include_language_detection=true`;
        
        console.log(`[ElevenLabsStreaming] Connecting with URL: ${url.replace(this.apiKey, '***')}`);

        // streamingStttWsOptions: DNS apenas-IPv4 + limite de 15s para handshake (dnsHelpers.ts).
        this.ws = new WebSocket(url, streamingStttWsOptions({
            headers: {
                'xi-api-key': this.apiKey,
            },
        }) as any);

        this.ws.on('open', () => {
            // Proteger contra chamadas de removeAllListeners() antes do fechamento, então este manipulador
            // normalmente não dispara após stop(). Mas se houver uma condição de corrida estreita, sair fora
            if (!this.isActive || !this.shouldReconnect) {
                this.ws?.close();
                this.ws = null;
                this.isConnecting = false;
                return;
            }
            this.isConnecting = false;
            this.reconnectAttempts = 0;
            console.log('[ElevenLabsStreaming] Connected');

            // Nota: ElevenLabs exige aguardar 'session_started' antes de enviar áudio.
            // O esvaziamento do buffer acontece não manipulador de mensagem 'session_started' abaixo
        });

        this.ws.on('message', (data: WebSocket.RawData) => {
            try {
                const rawStr = data.toString();
                if (this.debugMessageCount < 10) {
                    console.log(`[ElevenLabsStreaming] RAW[${this.debugMessageCount}]:`, rawStr);
                    this.debugMessageCount++;
                }

                const msg = JSON.parse(rawStr);

                // Nota: A API do websocket pode usar "tipo" ou "message_type"
                const msgType = msg.type || msg.message_type;

                switch (msgType) {
                    case 'session_started':
                        console.log('[ElevenLabsStreaming] Session started:', msg.config);
                        this.isSessionReady = true;
                        
                        // Esvaziar áudio armazenado agora que a sessão está estritamente pronta
                        while (this.buffer.length > 0) {
                            const chunk = this.buffer.shift();
                            if (chunk) {
                                this.write(chunk);
                            }
                        }
                        break;

                    case 'partial_transcript':
                        if (msg.text) {
                            this.emit('transcript', { 
                                text: msg.text, 
                                isFinal: false, 
                                confidence: 1.0 
                            });
                        }
                        break;

                    case 'committed_transcript':
                        if (msg.text) {
                            this.emit('transcript', { 
                                text: msg.text, 
                                isFinal: true, 
                                confidence: 1.0 
                            });
                        }
                        break;

                    case 'auth_error':
                        console.error('[ElevenLabsStreaming] Auth error — check key scope/permissions in ElevenLabs dashboard:', msg);
                        this.emit('error', msg);
                        // Parar loops de reconexão para falhas de autenticação para economizar créditos da API.
                        // Também limpar qualquer temporizador de reconexão em fila (conexão preguiçosa do write()
                        // ou enfileiramento de manipulador de fechamento anterior) para que não obtenhamos uma
                        // tentativa de reconexão stray após a mudança do latch.
                        this.shouldReconnect = false;
                        if (this.reconnectTimer) {
                            clearTimeout(this.reconnectTimer);
                            this.reconnectTimer = null;
                        }
                        if (this.ws) {
                            this.ws.close();
                        }
                        break;

                    default:
                        // Registrar outras mensagens para depuração (ex: metadados ou desconhecidas)
                        if (msg.error) {
                            console.error('[ElevenLabsStreaming] Server error:', msg.error);
                            this.emit('error', msg.error);
                        } else {
                            console.log('[ElevenLabsStreaming] Received message:', msgType, Object.keys(msg));
                        }
                }
            } catch (err) {
                console.error('[ElevenLabsStreaming] Failed to parse message:', err);
            }
        });

        this.ws.on('close', (code, reason) => {
            // Anular a referência ws imediatamente para prevenir reuso desatualizado
            this.ws = null;
            this.isConnecting = false;
            this.isSessionReady = false;
            console.log(`[ElevenLabsStreaming] Closed: code=${code} reason=${reason}`);
            if (this.shouldReconnect && code !== 1000) {
                this.scheduleReconnect();
            } else {
                // Se não reconectando, marcar sessão como verdadeiramente inativa
                this.isActive = false;
            }
        });

        this.ws.on('error', (err) => {
            console.error('[ElevenLabsStreaming] WS error:', err);
            this.emit('error', err);
        });
    }

    private scheduleReconnect(): void {
        if (!this.shouldReconnect) return;

        if (this.reconnectAttempts >= RECONNECT_MAX_ATTEMPTS) {
            console.error(`[ElevenLabsStreaming] Max reconnect attempts (${RECONNECT_MAX_ATTEMPTS}) reached — giving up`);
            // Bloquear o caminho de reconexão para que o lazy-connect do write() (linha 154)
            // não possa ressuscitar a tempestade no próximo chunk de áudio. Um start()
            // reinicia shouldReconnect=true para que um reinício acionado pelo usuário
            // ainda funcione. Espelha o padrão auth_error na linha ~317.
            this.shouldReconnect = false;
            this.emit('error', new Error('ElevenLabsStreamingSTT: max reconnect attempts exceeded'));
            return;
        }

        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        this.reconnectAttempts++;

        console.log(`[ElevenLabsStreaming] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${RECONNECT_MAX_ATTEMPTS})...`);
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            if (this.shouldReconnect) {
                this.connect();
            }
        }, delay);
    }
}
