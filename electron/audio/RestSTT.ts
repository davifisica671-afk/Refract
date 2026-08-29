/**
 * RestSTT - REST-based Speech-to-Text para Groq, OpenAI Whisper, ElevenLabs, Azure, e IBM Watson
 *
 * Implementa o mesmo EventEmitter interface como GoogleSTT:
 *   Events: 'transcript' ({ text, isFinal, confidence }), 'error' (Error)
 *   Methods: stainicia stopara write(chunk: BBuffer
 *
 * Buffers raw PCM chunks, prepends a WAV hcabeçalho e uploads via REST todo ~3 seconds.
 * Suporta two upload modes:
 *   - Multipart FormData (Groq, OpenAI, ElevenLabs)
 *   - Raw binário corpo (Azure, IBM Watson)
 */

import { EventEmitter } from 'events';
import axios from 'axios';
import FormData from 'form-data';
import { RECOGNITION_LANGUAGES } from '../config/languages';

export type RestSttProvider = 'groq' | 'openai' | 'elevenlabs' | 'azure' | 'ibmwatson';

interface RestSttProviderConfig {
    endpoint: string;
    model: string;
    authHeader: Record<string, string>;
    uploadType: 'multipart' | 'binary';
    extraFormFields?: Record<string, string>;
    /** Extrair transcript texto de o API resposta */
    extractTranscript: (data: any) => string;
}

type ProviderConfigFactory = (apiKey: string, region?: string, languageKey?: string) => RestSttProviderConfig;

const PROVIDER_CONFIGS: Record<RestSttProvider, ProviderConfigFactory> = {
    groq: (apiKey, region, languageKey) => {
        const lang = (languageKey && languageKey !== 'auto') ? RECOGNITION_LANGUAGES[languageKey]?.iso639 : undefined;
        return {
            endpoint: 'https://api.groq.com/openai/v1/audio/transcriptions',
            model: 'whisper-large-v3-turbo',
            authHeader: { Authorization: `Bearer ${apiKey}` },
            uploadType: 'multipart',
            extraFormFields: {
                temperature: '0',
                response_format: 'json',
                ...(lang ? { language: lang } : {})
            },
            extractTranscript: (data: any) => {
                if (typeof data === 'string') return data;
                return data?.text ?? '';
            },
        };
    },
    openai: (apiKey, region, languageKey) => {
        const lang = (languageKey && languageKey !== 'auto') ? RECOGNITION_LANGUAGES[languageKey]?.iso639 : undefined;
        return {
            endpoint: 'https://api.openai.com/v1/audio/transcriptions',
            model: 'whisper-1',
            authHeader: { Authorization: `Bearer ${apiKey}` },
            uploadType: 'multipart',
            extraFormFields: {
                ...(lang ? { language: lang } : {})
            },
            extractTranscript: (data: any) => {
                if (typeof data === 'string') return data;
                return data?.text ?? '';
            },
        };
    },
    elevenlabs: (apiKey, region, languageKey) => {
        const lang = (languageKey && languageKey !== 'auto') ? RECOGNITION_LANGUAGES[languageKey]?.iso639 : undefined;
        return {
            endpoint: 'https://api.elevenlabs.io/v1/speech-to-text',
            model: 'scribe_v2',
            authHeader: { 'xi-api-key': apiKey },
            uploadType: 'multipart',
            extraFormFields: {
                ...(lang ? { language_code: lang } : {})
            },
            extractTranscript: (data: any) => {
                if (typeof data === 'string') return data;
                return data?.text ?? '';
            },
        };
    },
    azure: (apiKey, region = 'eastus', languageKey) => {
        const lang = (languageKey && languageKey !== 'auto') ? RECOGNITION_LANGUAGES[languageKey]?.bcp47 : undefined;
        const finalLang = lang || 'en-US';
        return {
            endpoint: `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${finalLang}`,
            model: '',
            authHeader: { 'Ocp-Apim-Subscription-Key': apiKey },
            uploadType: 'binary',
            extractTranscript: (data: any) => {
                return data?.DisplayText ?? '';
            },
        };
    },
    ibmwatson: (apiKey, region = 'us-south', languageKey) => {
        const lang = (languageKey && languageKey !== 'auto') ? RECOGNITION_LANGUAGES[languageKey]?.bcp47 : undefined;
        const finalLang = lang || 'en-US';
        return {
            endpoint: `https://api.${region}.speech-to-text.watson.cloud.ibm.com/v1/recognize?language=${finalLang}`,
            model: '',
            authHeader: { Authorization: `Basic ${Buffer.from(`apikey:${apiKey}`).toString('base64')}` },
            uploadType: 'binary',
            extractTranscript: (data: any) => {
                try {
                    return data?.results?.[0]?.alternatives?.[0]?.transcript ?? '';
                } catch {
                    return '';
                }
            },
        };
    },
};

// Minimum buffer tamanho antes sending (avoid sending tiny fragments)
// 16kHz * 2 bytes/sample * 1 channel * 0.125 seconds = 4000 bytes
// Lowered de 16000 para permitir curto comando utterances ("YeSim "StPara para esvaziar instantly.
const MIN_BUFFER_BYTES = 4000;

// Safety-net upload interval (ms). Primário esvaziar é triggered por speech_ended events.
// This fires como a backstop se alguém talks continuously para >10s sem qualquer ppausar
// preventing unbounded buffer growth e Whisper API timeouts.
const SAFETY_NET_INTERVAL_MS = 10000;

// Silence threshold - se RMS é abaixo this, pular o upload
const SILENCE_RMS_THRESHOLD = 50;

export class RestSTT extends EventEmitter {
    private provider: RestSttProvider;
    private apiKey: string;
    private region?: string;
    private config: RestSttProviderConfig;

    private chunks: Buffer[] = [];
    private totalBufferedBytes = 0;
    private safetyNetTimer: NodeJS.Timeout | null = null;
    private isActive = false;
    private isUploading = false;
    private flushPending = false;  // Bug #2 fix: fila flush quando upload em progress

    // Audio configuração (precisa corresponder SystemAudioCapture osaída
    private sampleRate = 16000;
    private numChannels = 1;
    private bitsPerSample = 16;

    constructor(provider: RestSttProvider, apiKey: string, modelOverride?: string, region?: string) {
        super();
        this.provider = provider;
        this.apiKey = apiKey;
        this.region = region;
        this.config = PROVIDER_CONFIGS[provider](apiKey, region);
        if (modelOverride) {
            this.config.model = modelOverride;
        }
        console.log(`[RestSTT] Initialized for provider: ${provider}, model: ${this.config.model || '(default)'}`);
    }

    /**
     * Update API chave (e.g., quando user saves a novo key)
     */
    public setApiKey(apiKey: string): void {
        this.apiKey = apiKey;
        this.config = PROVIDER_CONFIGS[this.provider](apiKey, this.region);
        console.log(`[RestSTT] API key updated for ${this.provider}`);
    }

    /**
     * Update sample rate para corresponder o audio source
     */
    public setSampleRate(rate: number): void {
        if (this.sampleRate === rate) return;
        console.log(`[RestSTT] Updating sample rate to ${rate}Hz`);
        this.sampleRate = rate;
    }

    /**
     * Update channel count
     */
    public setAudioChannelCount(count: number): void {
        if (this.numChannels === count) return;
        console.log(`[RestSTT] Updating channel count to ${count}`);
        this.numChannels = count;
    }

    /**
     * Update recognition language
     */
    public setRecognitionLanguage(key: string): void {
        console.log(`[RestSTT] Updating recognition language to: ${key}`);
        this.config = PROVIDER_CONFIGS[this.provider](this.apiKey, this.region, key);
    }

    /**
     * No-op para RestSTT (no Google credentials needed)
     */
    public setCredentials(_keyFilePath: string): void {
        console.log(`[RestSTT] setCredentials called (no-op for REST provider)`);
    }

    /**
     * Start o upload timer
     */
    public start(): void {
        if (this.isActive) return;

        console.log(`[RestSTT] Starting (${this.provider})...`);
        this.isActive = true;
        this.chunks = [];
        this.totalBufferedBytes = 0;

        // Safety-net timer: esvaziar até durante continuous speech para prevenir
        // unbounded buffer growth e Whisper API file-size/timeout errors.
        // Primário esvaziar é driven por Rust speech_ended events.
        this.safetyNetTimer = setInterval(() => {
            this.flushAndUpload();
        }, SAFETY_NET_INTERVAL_MS);
    }

    /**
     * Stop o upload timer e esvaziar remaining buffer
     */
    public stop(): void {
        if (!this.isActive) return;

        console.log(`[RestSTT] Stopping (${this.provider})...`);
        this.isActive = false;

        if (this.safetyNetTimer) {
            clearInterval(this.safetyNetTimer);
            this.safetyNetTimer = null;
        }

        // Flush remaining audio
        this.flushAndUpload();
    }

    /**
     * Write raw PCM audio dados para o internal buffer
     */
    public write(audioData: Buffer): void {
        if (!this.isActive) return;
        this.chunks.push(audioData);
        this.totalBufferedBytes += audioData.length;
    }

    /**
     * Called quando o native SilenceSuppressor detects speech has ended.
     * The internal Rust engine already applies a 150-200ms VAD hangover para avoid
     * word-breaks, so we esvaziar immediately sem adding redundant TS debouncing.
     */
    public notifySpeechEnded(): void {
        if (!this.isActive) return;

        console.log(`[RestSTT] Speech ended detected by native VAD — flushing buffer immediately`);
        this.flushAndUpload();
    }

    public finalize(): void {
        if (!this.isActive) return;
        console.log(`[RestSTT] Finalize — flushing buffer immediately`);
        this.flushAndUpload();
    }

    /**
     * Concatenate buffered chunks, adicionar WAV header, e upload para REST API
     */
    private async flushAndUpload(): Promise<void> {
        // Gate todo esvaziar em isActive. Sem this, o
        // finally-re-entrancy at line ~334 (`if (this.flushPending) this.flushAndUpload()`)
        // pode disparar Após stpara tem define isActive=false, e o corpo abaixo
        // iria happily upload trailing audio para o REST provedor para o
        // rest de o processo lifetime. O re-arm block abaixo iria também
        // resurrect a fresh setInterval se safetyNetTimer happened para ser
        // non-null em alguns race window. Bailing aqui fecha ambos holes.
        if (!this.isActive) return;

        // Pular se não data
        if (this.chunks.length === 0 || this.totalBufferedBytes < MIN_BUFFER_BYTES) return;

        // Bug #2 fix: se atualmente uploading, fila a esvaziar para quando it completa
        if (this.isUploading) {
            this.flushPending = true;
            return;
        }

        // Reinicia safety-net timer para prevenir double-flush. O outer
        // `if (!this.isActive) return` acima guarantees we nunca re-arm
        // após stpara — mas keep o timer proteger aqui também como belt-and-braces
        // em case a future caller invokes flushAndUpload de a caminho that
        // pula o isActive cverifica
        if (this.safetyNetTimer && this.isActive) {
            clearInterval(this.safetyNetTimer);
            this.safetyNetTimer = setInterval(() => {
                this.flushAndUpload();
            }, SAFETY_NET_INTERVAL_MS);
        }

        // Grab atual buffer e reinicia
        const currentChunks = this.chunks;
        this.chunks = [];
        const currentBytes = this.totalBufferedBytes;
        this.totalBufferedBytes = 0;

        // Concatenate todos chunks
        const rawPcm = Buffer.concat(currentChunks);

        // Verifica para silence (pular upload se audio é também quiet)
        if (this.isSilent(rawPcm)) {
            if (Math.random() < 0.1) {
                console.log(`[RestSTT] Skipping silent buffer (${rawPcm.length} bytes)`);
            }
            return;
        }

        // Resample para 16kHz mono antes upload. At 48kHz stereo isso produces a
        // 6x smaller WAV farquivo reducing upload latency e keeping arquivo sizes bem
        // sob o Groq/OpenAI 25MB limit até para 10-segundo safety-net flushes.
        const TARGET_RATE = 16_000;
        const pcm16k = this.sampleRate === TARGET_RATE && this.numChannels === 1
            ? rawPcm
            : this.resampleTo16kHz(rawPcm);

        // Adiciona WAV cabeçalho — stamp com actual rate/channel após resampling (sempre 16kHz mono)
        const wavBuffer = this.addWavHeader(pcm16k, TARGET_RATE);

        this.isUploading = true;

        try {
            const transcript = await this.uploadAudio(wavBuffer);

            if (transcript && transcript.trim().length > 0) {
                console.log(`[RestSTT] Transcript received`, { length: transcript.trim().length });
                this.emit('transcript', {
                    text: transcript.trim(),
                    isFinal: true,
                    confidence: 1.0,
                });
            }
        } catch (err) {
            console.error(`[RestSTT] Upload error:`, err);
            this.emit('error', err instanceof Error ? err : new Error(String(err)));
        } finally {
            this.isUploading = false;

            // Bug #2 fix: se a esvaziar era requested enquanto we eram uploading, processo it agora
            if (this.flushPending) {
                this.flushPending = false;
                this.flushAndUpload();
            }
        }
    }

    /**
     * Upload WAV audio para o REST endpoint
     */
    private async uploadAudio(wavBuffer: Buffer): Promise<string> {
        if (this.config.uploadType === 'binary') {
            return this.uploadBinary(wavBuffer);
        }
        return this.uploadMultipart(wavBuffer);
    }

    /**
     * Upload via multipart FormData (Groq, OpenAI, ElevenLabs)
     */
    private async uploadMultipart(wavBuffer: Buffer): Promise<string> {
        const form = new FormData();

        form.append('file', wavBuffer, {
            filename: 'audio.wav',
            contentType: 'audio/wav',
        });

        // ElevenLabs uses 'model_id' em vez disso de 'mmodelo
        if (this.provider === 'elevenlabs') {
            form.append('model_id', this.config.model);
        } else {
            form.append('model', this.config.model);
        }

        if (this.config.extraFormFields) {
            for (const [key, value] of Object.entries(this.config.extraFormFields)) {
                form.append(key, value);
            }
        }

        const response = await axios.post(this.config.endpoint, form, {
            headers: {
                ...this.config.authHeader,
                ...form.getHeaders(),
            },
            timeout: 30000,
        });

        return this.config.extractTranscript(response.data);
    }

    /**
     * Upload via raw binary corpo (Azure, IBM Watson)
     */
    private async uploadBinary(wavBuffer: Buffer): Promise<string> {
        const response = await axios.post(this.config.endpoint, wavBuffer, {
            headers: {
                ...this.config.authHeader,
                'Content-Type': 'audio/wav',
            },
            timeout: 30000,
        });

        return this.config.extractTranscript(response.data);
    }

    /**
     * Resample Int16LE PCM de inputRate/numChannels → 16kHz mono.
     * Uses integer decimation (same approach as Rust DSP e OpenAIStreamingSTT).
     * Returns a novo Buffer containing o resampled 16-bit mono PCM.
     */
    private resampleTo16kHz(raw: Buffer): Buffer {
        const TARGET_RATE = 16_000;

        // Build Int16Array de o raw buffer using safe byte-by-byte lê
        // para avoid alignment issues com unaligned ArrayBuffer slices.
        const numSamples = Math.floor(raw.length / 2);
        const inputS16 = new Int16Array(numSamples);
        for (let i = 0; i < numSamples; i++) {
            inputS16[i] = raw.readInt16LE(i * 2);
        }

        // Já at alvo rate e mono — retorna as-is
        if (this.sampleRate === TARGET_RATE && this.numChannels === 1) {
            return Buffer.from(inputS16.buffer);
        }

        // Mix abaixo multi-channel para mono
        let monoS16: Int16Array;
        if (this.numChannels > 1) {
            const monoLen = Math.floor(inputS16.length / this.numChannels);
            monoS16 = new Int16Array(monoLen);
            for (let i = 0; i < monoLen; i++) {
                let sum = 0;
                for (let c = 0; c < this.numChannels; c++) {
                    sum += inputS16[i * this.numChannels + c];
                }
                monoS16[i] = Math.round(sum / this.numChannels);
            }
        } else {
            monoS16 = inputS16;
        }

        // Decimate para alvo rate
        if (this.sampleRate === TARGET_RATE) {
            return Buffer.from(monoS16.buffer);
        }

        const factor = this.sampleRate / TARGET_RATE;
        const outLen = Math.floor(monoS16.length / factor);
        const outS16 = new Int16Array(outLen);
        for (let i = 0; i < outLen; i++) {
            outS16[i] = monoS16[Math.floor(i * factor)];
        }
        return Buffer.from(outS16.buffer);
    }

    /**
     * Check se audio buffer is essentially silence
     */
    private isSilent(pcmBuffer: Buffer): boolean {
        let sum = 0;
        const step = 20; // Sample todo 20th sample para speed
        let count = 0;

        for (let i = 0; i < pcmBuffer.length - 1; i += 2 * step) {
            const sample = pcmBuffer.readInt16LE(i);
            sum += sample * sample;
            count++;
        }

        if (count === 0) return true;
        const rms = Math.sqrt(sum / count);
        return rms < SILENCE_RMS_THRESHOLD;
    }

    /**
     * Add a WAV RIFF cabeçalho para raw PCM data.
     * channels defaults para 1 (mono) because callers sempre resample para mono first.
     * Critical: Most REST STT APIs require a válido WAV file, NOT raw PCM.
     */
    private addWavHeader(samples: Buffer, sampleRate: number = 16_000, channels: number = 1): Buffer {
        const buffer = Buffer.alloc(44 + samples.length);
        // RIFF chunk descriptor
        buffer.write('RIFF', 0);
        buffer.writeUInt32LE(36 + samples.length, 4);
        buffer.write('WAVE', 8);
        // fmt sub-chunk
        buffer.write('fmt ', 12);
        buffer.writeUInt32LE(16, 16); // Subchunk1Size (16 para PCM)
        buffer.writeUInt16LE(1, 20);  // AudioFormat (1 = PCM)
        buffer.writeUInt16LE(channels, 22);
        buffer.writeUInt32LE(sampleRate, 24);
        buffer.writeUInt32LE(sampleRate * channels * (this.bitsPerSample / 8), 28); // ByteRate
        buffer.writeUInt16LE(channels * (this.bitsPerSample / 8), 32);              // BlockAlign
        buffer.writeUInt16LE(this.bitsPerSample, 34);
        // dados sub-chunk
        buffer.write('data', 36);
        buffer.writeUInt32LE(samples.length, 40);
        // Copy raw PCM data
        samples.copy(buffer, 44);

        return buffer;
    }
}
