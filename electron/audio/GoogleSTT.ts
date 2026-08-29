/**
 * GoogleSTT — Provedor de Speech-to-Text via Google Cloud Speech API
 *
 * Gerencia a conexão de streaming bidirecional com o Google Speech-to-Text
 * para transcrição de áudio em tempo real. Suporta múltiplos idiomas com
 * detecção automática, reinício proativo de stream antes do limite de 305s
 * do Google, e buffer de áudio para reconexões. Emite eventos de transcrição
 * (parcial e final) através da interface EventEmitter.
 */

import { SpeechClient } from '@google-cloud/speech';
import { EventEmitter } from 'events';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { RECOGNITION_LANGUAGES, EnglishVariant } from '../config/languages';

/**
 * GoogleSTT
 * 
 * Gerencia a conexão de streaming bi-direcional com o Google Speech-to-Text.
 * Espelha a lógica anteriormente em Swift:
 * - Gerencia limites infinitos de stream reiniciando periodicamente (embora menos crítico para chamadas curtas).
 * - Gerencia autenticação via GOOGLE_APPLICATION_CREDENTIALS.
 * - Analisa resultados intermediários e finais.
 */
export class GoogleSTT extends EventEmitter {
    private client: SpeechClient;
    private stream: any = null; // O tipo Stream é complexo nas bibliotecas do google-cloud
    private isStreaming = false;
    private isActive = false;
    private isFatalError = false;
    private label = 'default';
    private writeCount = 0;

    // Diagnóstico de dump de PCM cru. Ativado via REFRACT_STT_DUMP=1. Captura os
    // bytes EXATOS encaminhados para o gRPC stream do Google (após o keepalive-drop), então
    // podemos tocar o arquivo de volta e ouvir o que o Google realmente recebe —
    // resolvendo "o áudio está distorcido ou o Google está mal configurado?" empiricamente
    // em vez de por inferência. Um arquivo cru por canal; converta com
    //   ffmpeg -f s16le -ar <rate> -ac 1 -i google_stt_<label>.raw out.wav
    private dumpStream: fs.WriteStream | null = null;
    private dumpBytes = 0;

    // Códigos de falha permanente do gRPC — tentar novamente estes é inútil.
    //   3  = INVALID_ARGUMENT (o servidor nunca vai aceitar a config)
    //   7  = PERMISSION_DENIED (API não habilitada / projeto errado / não IAM)
    //   16 = UNAUTHENTICATED (credenciais ruins/expiradas)
    private static readonly PERMANENT_GRPC_CODES = new Set([3, 7, 16]);

    // Configuração
    private encoding = 'LINEAR16' as const;
    private sampleRateHertz = 16000;
    private audioChannelCount = 1; // Padrão: Mono
    private languageCode = 'en-US';
    private alternativeLanguageCodes: string[] = ['en-IN', 'en-GB']; // Códigos alternativos padrão

    constructor(label?: string) {
        super();
        if (label) this.label = label;
        // ... (configuração de credenciais ...

        // Nota: Em produção, as credenciais são definidas pelo main.ts via process.env.GOOGLE_APPLICATION_CREDENTIALS
        // ou passadas explicitamente para setCredentials(). Nós não carregamos arquivos .env aqui para evitar problemas de caminho ASAR.
        const credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
        if (!credentialsPath) {
            console.error(`[GoogleSTT/${this.label}] Missing GOOGLE_APPLICATION_CREDENTIALS in environment. Checked CWD:`, process.cwd());
        } else {
            console.log(`[GoogleSTT/${this.label}] Using credentials from: ${credentialsPath}`);
        }

        this.client = new SpeechClient({
            keyFilename: credentialsPath
        });
    }

    public setCredentials(keyFilePath: string): void {
        console.log(`[GoogleSTT/${this.label}] Updating credentials to: ${keyFilePath}`);
        process.env.GOOGLE_APPLICATION_CREDENTIALS = keyFilePath;
        this.client = new SpeechClient({
            keyFilename: keyFilePath
        });
    }

    public setSampleRate(rate: number): void {
        if (this.sampleRateHertz === rate) return;
        console.log(`[GoogleSTT/${this.label}] Updating Sample Rate to: ${rate}Hz`);
        this.sampleRateHertz = rate;
        if (this.isStreaming || this.isActive) {
            console.warn(`[GoogleSTT/${this.label}] Config changed while active. Restarting stream...`);
            this.stop();
            this.start();
        }
    }

    /**
     * Sem operação para GoogleSTT — o Google trata o VAD no lado do servidor.
     * Este método existe para consistência de interface com RestSTT, de modo que
     * main.ts possa chamar notifySpeechEnded() sem conversão de tipo para `any`.
     */
    public notifySpeechEnded(): void {
        // Intencionalmente vazio. O Google STT detecta limites de fala no lado do servidor.
    }

    public setAudioChannelCount(count: number): void {
        if (this.audioChannelCount === count) return;
        console.log(`[GoogleSTT/${this.label}] Updating Channel Count to: ${count}`);
        this.audioChannelCount = count;
        if (this.isStreaming || this.isActive) {
            console.warn(`[GoogleSTT/${this.label}] Config changed while active. Restarting stream...`);
            this.stop();
            this.start();
        }
    }

    private pendingLanguageChange?: NodeJS.Timeout;

    public setRecognitionLanguage(key: string): void {
        // Debounce para prevenir reinícios rápidos (ex.: rolando através da lista
        if (this.pendingLanguageChange) {
            clearTimeout(this.pendingLanguageChange);
        }

        this.pendingLanguageChange = setTimeout(() => {
            if (key === 'auto') {
                // Google STT v1 suporta até 3 alternativeLanguageCodes.
                // Uso en-US como primário com a maioria das linguagens comuns como alternativas.
                this.languageCode = 'en-US';
                this.alternativeLanguageCodes = ['fr-FR', 'es-ES', 'de-DE'];
                console.log(`[GoogleSTT/${this.label}] Language set to auto-detect (en-US + fr/es/de alternates)`);
            } else {
                const config = RECOGNITION_LANGUAGES[key];
                if (!config) {
                    console.warn(`[GoogleSTT/${this.label}] Unknown language key: ${key}`);
                    return;
                }

                console.log(`[GoogleSTT/${this.label}] Updating recognition language to: ${key} (${config.bcp47})`);
                this.languageCode = config.bcp47;

                if ('alternates' in config) {
                    this.alternativeLanguageCodes = (config as EnglishVariant).alternates;
                } else {
                    this.alternativeLanguageCodes = [];
                }

                console.log(`[GoogleSTT/${this.label}] Primary:`, this.languageCode);
                if (this.alternativeLanguageCodes.length > 0) {
                    console.log(`[GoogleSTT/${this.label}] Alternates:`, this.alternativeLanguageCodes.join(', '));
                }
            }

            // Restart se active
            if (this.isStreaming || this.isActive) {
                console.log(`[GoogleSTT/${this.label}] Language changed while active. Restarting stream...`);
                this.stop();
                this.start();
            }

            this.pendingLanguageChange = undefined;
        }, 250);
    }

    public start(): void {
        if (this.isActive) return;
        this.isActive = true;
        this.isFatalError = false;
        this.writeCount = 0;

        this.openDumpStream();

        console.log(`[GoogleSTT/${this.label}] Starting recognition stream (rate=${this.sampleRateHertz}Hz, ch=${this.audioChannelCount})...`);
        this.startStream();
    }

    /** Diagnóstico opcional: abrir o dump PCM cru dos bytes exatos enviados ao Google. */
    private openDumpStream(): void {
        if (process.env.REFRACT_STT_DUMP !== '1' || this.dumpStream) return;
        try {
            const file = path.join(os.homedir(), `google_stt_${this.label}_${this.sampleRateHertz}hz.raw`);
            this.dumpStream = fs.createWriteStream(file);
            this.dumpBytes = 0;
            console.log(`[GoogleSTT/${this.label}] 🎙️  PCM dump OPEN → ${file} (play: ffmpeg -f s16le -ar ${this.sampleRateHertz} -ac ${this.audioChannelCount} -i "${file}" out.wav)`);
        } catch (e) {
            console.error(`[GoogleSTT/${this.label}] Failed to open PCM dump:`, e);
        }
    }

    private closeDumpStream(): void {
        if (!this.dumpStream) return;
        try { this.dumpStream.end(); } catch { /* ignorar */ }
        console.log(`[GoogleSTT/${this.label}] 🎙️  PCM dump CLOSED (${this.dumpBytes} bytes ≈ ${(this.dumpBytes / 2 / Math.max(1, this.sampleRateHertz)).toFixed(1)}s @ ${this.sampleRateHertz}Hz)`);
        this.dumpStream = null;
    }

    public stop(): void {
        if (!this.isActive) return;

        console.log(`[GoogleSTT/${this.label}] Stopping stream (wrote ${this.writeCount} chunks total)...`);
        this.isActive = false;
        this.isStreaming = false;

        if (this.proactiveRestartTimer) {
            clearTimeout(this.proactiveRestartTimer);
            this.proactiveRestartTimer = null;
        }

        // Limpa qualquer debounce de mudança de idioma de 250ms em andamento. Sem isso,
        // um usuário que muda o idioma logo antes de clicar em Parar teria
        // o corpo do debounce disparando ~250ms após endMeeting() — o corpo
        // veria isStreaming=false e isActive=false (then it pula a
        // reinicialização stop()+start()), mas o slot libuv do timer sobrevive, e
        // mais importante, a variável `key` capturada por fechamento poderia vazar
        // os alternativas de idioma para a próxima sessão se start() executar antes do timer
        // disparar. Cancelar aqui mantém o estado de idioma da próxima reunião limpo.
        if (this.pendingLanguageChange) {
            clearTimeout(this.pendingLanguageChange);
            this.pendingLanguageChange = undefined;
        }

        if (this.stream) {
            this.stream.end();
            this.stream.destroy();
            this.stream = null;
        }

        this.closeDumpStream();
    }

    public finalize(): void {
        if (!this.isActive || !this.stream) return;
        console.log(`[GoogleSTT/${this.label}] Finalize — ending gRPC stream to flush final transcript`);
        try {
            this.stream.end();
        } catch (err) {
            console.error(`[GoogleSTT/${this.label}] Finalize end() failed:`, err);
        }
        this.isStreaming = false;
        this.stream = null;
    }

    private buffer: Buffer[] = [];
    private isConnecting = false;
    private lastConnectAttempt = 0;

    // O streamingRecognize do Google mata qualquer stream após 305 segundos.
    // Nós reiniciamos proativamente em 4:30 (270s) para prevenir que o fechamento forçado cause
    // um gap de 1 segundo na transcrição durante entrevistas longas.
    private proactiveRestartTimer: NodeJS.Timeout | null = null;
    private static readonly PROACTIVE_RESTART_MS = 270_000; // 4 min 30 sec

    /**
     * Verdadeiro apenas se todo byte do chunk for zero (frame keepalive do Rust-DSP).
     * Percorre o buffer inteiro — sem striding — para que um chunk contendo mesmo
     * uma amostra não-zero de áudio real nunca seja classificado incorretamente
     * como silêncio e descartado. Chunks têm ≤5760 bytes e chegam a cada 20–60ms,
     * então a verificação completa é barata.
     */
    private isAllZeroChunk(buf: Buffer): boolean {
        if (buf.length === 0) return true;
        for (let i = 0; i < buf.length; i++) {
            if (buf[i] !== 0) return false;
        }
        return true;
    }

    public write(audioData: Buffer): void {
        if (!this.isActive || this.isFatalError) {
            // Registrar apenas ocasionalmente para evitar spam
            if (this.writeCount === 0) console.warn(`[GoogleSTT/${this.label}] write() called but isActive=false — data dropped`);
            return;
        }

        // Descartar frames keepalive de preenchimento zero puro injetados pelo DSP Rust
        // (FrameAction::SendSilence → vec![0u8; chunk_size*2]). Para áudio do sistema,
        // o supressor executa com VAD desabilitado e um piso RMS permissivo, então it
        // oscila entre frames reais de baixa amplitude e estes keepalives
        // silenciosos. O streamingRecognize do Google (diferente do Deepgram/Refract, que
        // faz endpoint limpo em silêncio) alucina fragmentos intermediários minúsculos —
        // "he", "heh", "hehehe" — quando áudio real é intercalado com frames zero.
        // Google mantém o gRPC stream aberto em seu próprio (timeout de ociosidade de 10s) e
        // reconecta lazy não próximo chunk real, então o keepalive não serve
        // propósito aqui e apenas corrompe o reconhecimento. Áudio real nunca é
        // zero bit a bit (piso de ruído/dither), então um chunk todo zero é
        // inconfundivelmente um keepalive.
        if (this.isAllZeroChunk(audioData)) return;

        // Diagnóstico: captura os bytes exatos não-keepalive entregues ao Google.
        if (this.dumpStream) {
            try { this.dumpStream.write(audioData); this.dumpBytes += audioData.length; } catch { /* ignorar */ }
        }

        this.writeCount++;

        if (!this.isStreaming || !this.stream) {
            // Armazenar em buffer se estamos em estado de conexão apenas iniciado, ou fechado
            this.buffer.push(audioData);
            if (this.buffer.length > 500) this.buffer.shift(); // Cap buffer size

            if (!this.isConnecting) {
                if (Date.now() - this.lastConnectAttempt > 1000) {
                    console.log(`[GoogleSTT/${this.label}] Stream not ready (write #${this.writeCount}). Lazy connecting on new audio...`);
                    this.startStream();
                }
            }
            return;
        }

        // Verificação de segurança para prevenir erro "escrita após destruído"
        if (this.stream.destroyed) {
            this.isStreaming = false;
            this.stream = null;
            this.buffer.push(audioData);
            if (this.buffer.length > 500) this.buffer.shift(); // Cap buffer size

            if (!this.isConnecting) {
                if (Date.now() - this.lastConnectAttempt > 1000) {
                    console.log(`[GoogleSTT/${this.label}] Stream destroyed (write #${this.writeCount}). Lazy reconnecting...`);
                    this.startStream();
                }
            }
            return;
        }

        try {
            // Registrar os primeiros 5 sempre, depois a cada ~50ª escrita
            if (this.writeCount <= 5 || Math.random() < 0.02) {
                console.log(`[GoogleSTT/${this.label}] Writing ${audioData.length} bytes to stream (write #${this.writeCount}, isStreaming=${this.isStreaming})`);
            }

            if (this.stream.writable) {
                this.stream.write(audioData);
            } else {
                console.warn(`[GoogleSTT/${this.label}] Stream not writable! (write #${this.writeCount})`);
            }
        } catch (err) {
            console.error(`[GoogleSTT/${this.label}] Safe write failed:`, err);
            this.isStreaming = false;
        }
    }

    private flushBuffer(): void {
        if (!this.stream) return;

        while (this.buffer.length > 0) {
            if (!this.stream.writable) {
                console.warn(`[GoogleSTT/${this.label}] flushBuffer: stream not writable — ${this.buffer.length} chunks re-queued`);
                break; // Deixar chunks restantes no buffer para o próximo stream
            }
            const data = this.buffer.shift();
            if (data) {
                try {
                    this.stream.write(data);
                } catch (e) {
                    console.error(`[GoogleSTT/${this.label}] Failed to flush buffer chunk:`, e);
                    break;
                }
            }
        }
    }

    private startStream(): void {
        this.lastConnectAttempt = Date.now();
        this.isStreaming = true;
        this.isConnecting = true;

        console.log(`[GoogleSTT/${this.label}] Creating gRPC stream (rate=${this.sampleRateHertz}Hz, ch=${this.audioChannelCount}, lang=${this.languageCode})...`);

        this.stream = this.client
            .streamingRecognize({
                config: {
                    encoding: this.encoding,
                    sampleRateHertz: this.sampleRateHertz,
                    audioChannelCount: this.audioChannelCount,
                    languageCode: this.languageCode,
                    enableAutomaticPunctuation: true,
                    model: 'latest_long',
                    useEnhanced: true,
                    alternativeLanguageCodes: this.alternativeLanguageCodes,
                },
                interimResults: true,
            })
            .on('error', (err: Error) => {
                this.isConnecting = false;
                this.isStreaming = false;
                this.stream = null;

                const grpcCode = (err as any)?.code;

                // O streamingRecognize do Google fecha o stream com código 11
                // ("Audio Timeout Error: Longo duração elapsed sem audio")
                // após ~10s de silêncio. O caminho lazy-reconnect em write()
                // recupera automaticamente não próximo chunk, então isso é benigno
                // e recorre a cada período de silêncio. Registrar uma única linha de aviso e
                // não re-emitir como um erro — propagá-lo para cima dispara o
                // contador de erros consecutivos não main.ts e spama o renderer
                // com atualizações de status STT reconectando/falhou durante silêncio
                // normal.
                const isIdleTimeout = grpcCode === 11
                    || /Audio Timeout Error/i.test(err.message || '');
                if (isIdleTimeout) {
                    console.warn(`[GoogleSTT/${this.label}] Stream idle-timed-out (Google's 10s no-audio limit), reconnecting on next chunk.`);
                    return;
                }

                console.error(`[GoogleSTT/${this.label}] Stream error:`, err);

                if (typeof grpcCode === 'number' && GoogleSTT.PERMANENT_GRPC_CODES.has(grpcCode)) {
                    // Falha permanente — para o loop de reconexão dirigido por write(). Sem isso,
                    // um projeto Google mal configurado (ex.: Speech API não habilitada →
                    // PERMISSION_DENIED) entra em loop infinito a ~1 reconexão/segundo durante toda a
                    // sessão. Veja issue #171.
                    console.error(
                        `[GoogleSTT/${this.label}] Permanent gRPC error (code ${grpcCode}) — ` +
                        `disabling STT for this session. No further retries.`
                    );
                    this.isFatalError = true;
                    if (this.proactiveRestartTimer) {
                        clearTimeout(this.proactiveRestartTimer);
                        this.proactiveRestartTimer = null;
                    }
                }

                this.emit('error', err);
            })
            .on('end', () => {
                console.log(`[GoogleSTT/${this.label}] Stream ended server-side (idle timeout)`);
                this.isConnecting = false;
                this.isStreaming = false;
                this.stream = null;
            })
            .on('close', () => {
                console.log(`[GoogleSTT/${this.label}] Stream closed server-side`);
                this.isConnecting = false;
                this.isStreaming = false;
                this.stream = null;
            })
            .on('data', (data: any) => {
                if (data.results[0] && data.results[0].alternatives[0]) {
                    const result = data.results[0];
                    const alt = result.alternatives[0];
                    const transcript = alt.transcript;
                    const isFinal = result.isFinal;

                    if (transcript) {
                        console.log(`[GoogleSTT/${this.label}] Transcript received`, { final: isFinal, length: transcript.length });
                        this.emit('transcript', {
                            text: transcript,
                            isFinal,
                            confidence: alt.confidence
                        });
                    }
                }
            });

        // Streams gRPC são graváveis imediatamente — nenhuma negociação necessária.
        const bufferedCount = this.buffer.length;
        this.isConnecting = false;
        this.flushBuffer();

        console.log(`[GoogleSTT/${this.label}] Stream created. Flushed ${bufferedCount} buffered chunks. Waiting for events...`);

        // Agendar reinício proativo antes do limite rígido de 305 segundos do Google.
        // Sem isso, o servidor fecha o stream em 305s causando até 1s de
        // áudio perdido até o lazy reconectar em write() disparar.
        if (this.proactiveRestartTimer) clearTimeout(this.proactiveRestartTimer);
        this.proactiveRestartTimer = setTimeout(() => {
            this.proactiveRestartTimer = null;
            if (!this.isActive) return;
            console.log(`[GoogleSTT/${this.label}] Proactive stream restart at 4:30 to preempt Google's 305s limit`);
            if (this.stream) {
                this.stream.end();
                this.stream.destroy();
                this.stream = null;
            }
            this.isStreaming = false;
            this.startStream();
        }, GoogleSTT.PROACTIVE_RESTART_MS);
    }
}
