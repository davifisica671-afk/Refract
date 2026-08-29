/**
 * LocalWhisperSTT — provedor local de STT Whisper / Distil-Whisper / Moonshine
 *
 * Arquitetura de dois canais: Refract captura Microfone e Áudio do Sistema como dois
 * streams nativos completamente separados. createSTTProvider() instancia esta
 * classe DUAS VEZES — uma vez por canal. Nenhum modelo de diarização é necessário; a
 * atribuição de falante é liberada pelo hardware.
 *
 * DESIGN DE STREAMING (fecha o gap de latência com STT em nuvem):
 *
 *   Provedores de STT em nuvem (Deepgram/Soniox/ElevenLabs) emitem transcrições *intermediárias*
 *   a cada 100–300ms enquanto o usuário ainda está falando. Whisper
 *   não foi projetado para streaming — nós o aproximamos com um perfil
 *   por modelo (veja resolveStreamingProfile):
 *
 *   Caminho Whisper / Distil-Whisper (modelos silenciosos arquitetados em batch):
 *     - Marca a cada 1500ms enquanto o segmento está aberto (após 800ms de áudio)
 *     - Aplica LocalAgreement-2: apenas confirma texto onde duas inferências
 *       sobrepostas concordam (prefixo comum mais longo). Estabiliza o flicker.
 *     - Primeiro intermediário emitido ~1.5–2.5s após o início da fala
 *
 *   Caminho Moonshine (streaming-nativo, determinístico, inferência ~100ms):
 *     - Marca a cada 750ms após apenas 400ms de áudio
 *     - Pular LA-2 — a saída do modelo já é estável; emite cada
 *       intermediário limpo diretamente.
 *     - Primeiro intermediário emitido ~400–600ms após o início da fala
 *
 *   Quando o VAD fecha o segmento (ou atinge MAX_SEGMENT_MS para a confirmação suave):
 *     - Executa a passagem final não segmento completo
 *     - Emite { isFinal: verdadeiro confidence: 0.9 }
 *     - Reinicia o estado da sessão para o próximo segmento
 */

import { EventEmitter } from 'events';
import { Worker } from 'worker_threads';
import { resampleToF32 } from './whisper/audioResampler';
import { VadProcessor } from './whisper/vadProcessor';
import { filterHallucination } from './whisper/hallucinationFilter';
import { configureTransformersCache } from './whisper/modelManager';
import { modelPreloader } from './whisper/modelPreloader';
import { buildWorkerInitMessage } from './whisper/inferenceConfig';
import { resolveWhisperWorkerPath } from './whisper/workerPathResolver';
import type { WorkerOutMessage } from './whisper/types';

export class LocalWhisperSTT extends EventEmitter {
    private readonly modelId: string;
    private inputSampleRate = 48000;
    private language = 'auto';
    // Optional context-biasing prompt sent out-of-band para o worker via
    // mensagens setPrompt. O worker tokeniza uma vez e reutiliza os IDs
    // para toda transcrição (veja whisperWorker.ts updatePromptCache). Limite de
    // tokens do decodificador Whisper é aplicado do lado do worker. Sem operação para Moonshine.
    private contextPrompt = '';
    private contextPromptSentToWorker = '';
    // Limite de comprimento de caracteres para prevenir strings enormes de serem copiadas através
    // do IPC do worker. ~8KB é bem acima dos 224 tokens Whisper (~3-4 caracteres/token).
    private static readonly PROMPT_MAX_CHARS = 8000;

    // ── Latency telemetry ──────────────────────────────────────────────
    // Perceived latency tracking. Two metrics:
    //   firstPartial = ms do VAD abrindo um segmento → primeiro prefixo acordado/confirmado
    //                  emitido (LocalAgreement-2 precisa de duas marcações de streaming
    //                  para convergir, então isso NÃO é 'tempo de primeira inferência').
    //   final        = ms do VAD abrindo um segmento → transcrição final emitida
    // A detecção de limite usa VadProcessor.currentSegmentId() (contador
    // monotônico) em vez de bordas booleanas em isInSpeech() — bordas booleanas perdem
    // padrões open+close-in-one-push e close+open-in-one-push.
    private trackedSegmentId = 0;
    private segmentOpenedAt = 0;
    private firstPartialEmittedForSegment = 0;
    private firstPartialLatencies: number[] = [];
    private finalLatencies: number[] = [];
    private static readonly LATENCY_WINDOW = 100;
    private static readonly LATENCY_LOG_EVERY = 20;
    // Limite de sanidade: qualquer latência fora deste intervalo é tratada como um bug de rastreamento
    // (ex.: problema de relógio, id de segmento perdido) e descartada para que não contamine p95/p99.
    private static readonly LATENCY_MAX_MS = 60_000;
    private latencyLogCounter = 0;
    // Rótulo de canal opcional ('mic' / 'system') — desambigua linhas de registro
    // quando ambas as instâncias LocalWhisperSTT executam o mesmo modelo
    private channelLabel = '';
    private worker: Worker | null = null;
    private vad: VadProcessor | null = null;
    private isActive = false;
    private taskCounter = 0;
    private workerReady = false;
    private isDrainingFinals = false;
    private drainingFinalsInFlight = 0;
    // Áudio pendente esperando o worker ficar pronto. Sempre finais —
    // intermediários de streaming nunca são enfileirados (são melhor-esforço e apenas disparam
    // enquanto o segmento está aberto E o worker está pronto).
    private pendingAudio: Float32Array[] = [];

    // Gap-flush: garante que o segmento fecha mesmo se o SilenceSuppressor do Rust
    // parar de enviar áudio antes do hangover do VAD completar
    private gapFlushTimer: ReturnType<typeof setTimeout> | null = null;
    private static readonly GAP_FLUSH_MS = 400;
    // Timer de tolerância de 5s para o worker anterior finalizar transcrições em andamento
    // antes de terminá-lo. Rastreado para que ciclos rápidos stop/start ou encerramento do app não
    // prendam o evento loop com timers de terminação obsoletos.
    private workerTerminateTimer: ReturnType<typeof setTimeout> | null = null;

    // Estado do loop de inferência de streaming
    // setTimeout encadeado (não setInterval) então o atraso pode se adaptar a
    // cada marcação — o worker pode ser mais lento que STREAMING_INTERVAL_MS para
    // modelos maiores (whisper-medium ~3-5s, whisper-large ~5-10s); empilhar
    // marcações contra uma inferência em andamento apenas sobrecarrega o evento loop JS.
    private streamingTimer: ReturnType<typeof setTimeout> | null = null;
    // Ajustado por família de modelo não momento da construção (veja resolveStreamingProfile).
    private readonly streamingIntervalBaseMs: number;
    private readonly streamingMinAudioMs: number;
    private readonly skipAgreement: boolean;
    private static readonly STREAMING_INTERVAL_MAX_MS = 12000;
    private static readonly MAX_SEGMENT_MS = 14000;       // soft-commit antes VAD's 15s hard-flush
    // Backoff: conta marcações consecutivas onde não pudemos despachar (worker
    // ocupado ou não abrir segmento com áudio suficiente). Após 3 em linha dupla,
    // o próximo atraso reinicia para a base em um despacho bem-sucedido
    private streamingStallCount = 0;
    private streamingNextDelayMs = 0; // define em constructor de streamingIntervalBaseMs

    // Estado do LocalAgreement-2: mantemos a última transcrição intermediária, e quando
    // o próximo intermediário chega, emitimos o prefixo comum mais longo como o intermediário
    // "estável". O lastEmittedText what it já mostramos.
    private lastPartialText = '';
    private lastEmittedText = '';
    private streamingTaskInFlight = false;
    private streamingTaskId: string | null = null;

    constructor(modelId: string) {
        super();
        this.modelId = modelId;
        configureTransformersCache();

        // Ajusta o loop de streaming para as características específicas deste modelo.
        // Moonshine: inferência ~100ms, saída determinística single-pass sem preenchimento de 30s.
        // Nós podemos consultar mais rápido, despachar em áudio mais curto, e
        // pular a verificação de estabilidade de duas passagens do LocalAgreement-2 (que adiciona uma
        // marcação inteira de latência).
        // Whisper / Distil-Whisper: inferência ~500ms-5s, parâmetros
        // conservadores, LA-2 necessário para estabilidade.
        const profile = LocalWhisperSTT.resolveStreamingProfile(modelId);
        this.streamingIntervalBaseMs = profile.intervalMs;
        this.streamingMinAudioMs = profile.minAudioMs;
        this.skipAgreement = profile.skipAgreement;
        this.streamingNextDelayMs = this.streamingIntervalBaseMs;
        console.log(`[LocalWhisperSTT] streaming profile for ${modelId}: interval=${profile.intervalMs}ms minAudio=${profile.minAudioMs}ms skipAgreement=${profile.skipAgreement}`);
    }

    /**
     * Per-model streaming-loop profile. Faster, more aggressive parameters
     * para streaming-class models (Moonshine) — they finish cada pass in
     * <200ms e produce stable output, so we pode poll often e emit
     * partials directly sem LocalAgreement-2's two-pass confirmation.
     */
    private static resolveStreamingProfile(modelId: string): { intervalMs: number; minAudioMs: number; skipAgreement: boolean } {
        // Correspondência frouxa — cobre `onnx-community/moonshine-*`, `usefulsensors/
        // moonshine-*`, e qualquer fork futuro que mantenha "moonshine" no
        // caminho. Retorna para os padrões seguros do Whisper em caso de não correspondência.
        // TODO: validar os números 750/400 contra first-partial medido
        // p50 uma vez que o modelo Moonshine seja baixado; esperar <600ms.
        if (modelId.toLowerCase().includes('moonshine')) {
            return { intervalMs: 750, minAudioMs: 400, skipAgreement: true };
        }
        return { intervalMs: 1500, minAudioMs: 800, skipAgreement: false };
    }

    setSampleRate(rate: number): void { this.inputSampleRate = rate; }
    setAudioChannelCount(_count: number): void {}
    setRecognitionLanguage(key: string): void { this.language = key || 'auto'; }
    setCredentials(_credPath: string): void {}

    /**
     * Optional human-readable channel label (e.g. 'mic', 'system') para log
     * disambiguation quando both LocalWhisperSTT instances use o mesmo model.
     */
    setChannel(label: string): void { this.channelLabel = (label ?? '').trim(); }

    /**
     * Set a context-biasing prompt (proper nouns, jargon, attendee names).
     * Pushed para o worker out-of-band apenas quando o valor actually changes.
     * Empty string disables biasing. Worker truncates para 224 Whisper tokens
     * (front of string preserved) e skips entirely para Moonshine. Safe to
     * chamar mid-stream — o worker applies o novo prompt para subsequent
     * transcribes only; o in-flight one continues com o anterior cache.
     */
    setContext(prompt: string): void {
        let trimmed = (prompt ?? '').trim();
        if (trimmed.length > LocalWhisperSTT.PROMPT_MAX_CHARS) {
            trimmed = trimmed.slice(0, LocalWhisperSTT.PROMPT_MAX_CHARS);
        }
        this.contextPrompt = trimmed;
        this.maybePushPromptToWorker();
    }

    private maybePushPromptToWorker(): void {
        if (!this.worker || !this.workerReady) return; // enviado em flushPending após pronto
        if (this.contextPrompt === this.contextPromptSentToWorker) return;
        this.worker.postMessage({ type: 'setPrompt', prompt: this.contextPrompt });
        this.contextPromptSentToWorker = this.contextPrompt;
    }

    start(): void {
        if (this.isActive) return;
        this.isDrainingFinals = false;
        this.drainingFinalsInFlight = 0;
        this.isActive = true;
        this.vad = new VadProcessor();
        this.spawnWorker();
        this.startStreamingLoop();
    }

    stop(): void {
        if (!this.isActive) return;
        this.isActive = false;

        this.stopStreamingLoop();
        if (this.gapFlushTimer) {
            clearTimeout(this.gapFlushTimer);
            this.gapFlushTimer = null;
        }

        if (this.vad) {
            const segs = this.vad.flush();
            this.vad = null;
            this.isDrainingFinals = true;
            segs.forEach(s => this.dispatchFinal(s.samples));
        }

        this.resetAgreementState();

        // Imprime um resumo final de latência para a sessão que acabou e
        // reinicia as janelas então a próxima sessão começa do zero.
        if (this.firstPartialLatencies.length > 0 || this.finalLatencies.length > 0) {
            this.logLatencySummary();
        }
        this.firstPartialLatencies = [];
        this.finalLatencies = [];
        this.segmentOpenedAt = 0;
        this.firstPartialEmittedForSegment = 0;
        this.trackedSegmentId = 0;
        this.latencyLogCounter = 0;

        const w = this.worker;
        if (w) {
            const shouldKeepWorkerForFinals = this.isDrainingFinals && (this.pendingAudio.length > 0 || this.drainingFinalsInFlight > 0);
            if (shouldKeepWorkerForFinals) return;
            this.beginWorkerTermination(w);
        }
    }

    write(chunk: Buffer): void {
        if (!this.isActive || !this.vad) return;
        const f32 = resampleToF32(chunk, this.inputSampleRate);
        const segs = this.vad.push(f32);
        segs.forEach(s => this.dispatchFinal(s.samples));

        // Confirmação suave: se um segmento cresceu além de MAX_SEGMENT_MS, forçar uma
        // passagem final e iniciar um novo segmento (tail-keep). O softCommit
        // incrementa o id do segmento, então a verificação de limite abaixo o captura
        const open = this.vad.peekOpenSegment();
        if (open && open.durationMs >= LocalWhisperSTT.MAX_SEGMENT_MS) {
            const committed = this.vad.softCommit();
            if (committed) this.dispatchFinal(committed.samples);
        }

        // Telemetria: re-atualizar segmentOpenedAt sempre que o segmento aberto do VAD
        // é um diferente do que rastreamos por último. Detecção baseada em ID
        // gerencia corretamente open+close-in-one-push (dois novos segmentos vistos
        // dentro de uma única escrita) e close+open-in-one-push (id sobe mas
        // isInSpeech permanece verdadeiro)
        if (this.vad.isInSpeech()) {
            const id = this.vad.currentSegmentId();
            if (id !== this.trackedSegmentId) {
                this.trackedSegmentId = id;
                this.segmentOpenedAt = performance.now();
                this.firstPartialEmittedForSegment = 0;
            }
        }

        // Reinicia o timer gap-flush.
        if (this.gapFlushTimer) clearTimeout(this.gapFlushTimer);
        this.gapFlushTimer = setTimeout(() => {
            this.gapFlushTimer = null;
            if (this.isActive && this.vad) {
                const pending = this.vad.flush();
                pending.forEach(s => this.dispatchFinal(s.samples));
            }
        }, LocalWhisperSTT.GAP_FLUSH_MS);
    }

    finalize(): void {
        if (!this.isActive || !this.vad) return;
        const segs = this.vad.flush();
        segs.forEach(s => this.dispatchFinal(s.samples));
    }

    /* ──────────────── Streaming inference loop ──────────────── */

    private startStreamingLoop(): void {
        if (this.streamingTimer) return;
        this.streamingNextDelayMs = this.streamingIntervalBaseMs;
        this.streamingStallCount = 0;
        this.scheduleNextStreamingTick();
    }

    private scheduleNextStreamingTick(): void {
        if (!this.isActive) return;
        this.streamingTimer = setTimeout(() => {
            this.streamingTimer = null;
            // Encapsular a marcação em try/catch — um lançar aqui (worker descartado não meio do post,
            // VAD nulo, etc.) deixaria a cadeia não agendada
            // e silenciosamente mataria todos os intermediários pelo resto da sessão
            try {
                this.streamingTick();
            } catch (e) {
                console.warn('[LocalWhisperSTT] streamingTick threw, continuing loop:', e);
                // Tratar como uma estagnação então o timer de recuo entra em ação se o
                // lançar para persistente (ex.: erro recorrente de postMessage).
                this.recordStreamingStall();
            }
            this.scheduleNextStreamingTick();
        }, this.streamingNextDelayMs);
    }

    private stopStreamingLoop(): void {
        if (this.streamingTimer) {
            clearTimeout(this.streamingTimer);
            this.streamingTimer = null;
        }
        this.streamingTaskInFlight = false;
        this.streamingTaskId = null;
        this.streamingStallCount = 0;
        this.streamingNextDelayMs = this.streamingIntervalBaseMs;
    }

    private streamingTick(): void {
        if (!this.isActive || !this.vad || !this.workerReady || !this.worker) {
            this.recordStreamingStall();
            return;
        }
        // Retorno antecipado barato: pular a alocação de peekOpenSegment quando o
        // VAD não está atualmente em um segmento de fala.
        if (!this.vad.isInSpeech()) { this.recordStreamingStall(); return; }
        // Não empilhar solicitações de streaming — aguardar a anterior finalizar
        if (this.streamingTaskInFlight) { this.recordStreamingStall(); return; }

        const open = this.vad.peekOpenSegment();
        if (!open || open.durationMs < this.streamingMinAudioMs) {
            this.recordStreamingStall();
            return;
        }

        // Despacho bem-sucedido — reinicia recuo para o intervalo base.
        this.streamingStallCount = 0;
        this.streamingNextDelayMs = this.streamingIntervalBaseMs;

        this.streamingTaskInFlight = true;
        const taskId = `s${++this.taskCounter}`;
        this.streamingTaskId = taskId;
        const copy = open.samples.slice();
        this.worker.postMessage(
            { type: 'transcribe', taskId, audio: copy, language: this.language, streaming: true },
            [copy.buffer]
        );
    }

    private recordStreamingStall(): void {
        this.streamingStallCount++;
        // Após 3 estagnações consecutivas, voltar exponencialmente então paramos de girar
        // enquanto o worker processa um modelo lento. Reinício apenas
        // acontece em um despacho real
        if (this.streamingStallCount >= 3) {
            this.streamingNextDelayMs = Math.min(
                LocalWhisperSTT.STREAMING_INTERVAL_MAX_MS,
                this.streamingNextDelayMs * 2
            );
        }
    }

    /**
     * LocalAgreement-2: commit o longest comum prefix entre o previous
     * parcial e isso one. The primeiro parcial of a segment seeds the
     * baseline (no emitir — agreement requires two passes). Subsequent passes
     * emitir apenas o *new* committed texto as an interim transcript.
     */
    private handleStreamingPartial(text: string): void {
        this.streamingTaskInFlight = false;
        // Worker acabou de ficar livre → recuperar de qualquer estado de recuo então o
        // próximo despacho dispara não intervalo base em vez de esperar o atraso
        // dobrado agendado enquanto o worker estava ocupado.
        this.streamingStallCount = 0;
        this.streamingNextDelayMs = this.streamingIntervalBaseMs;

        const cleaned = filterHallucination(text);
        if (!cleaned) return;

        // Modelos de classe streaming (Moonshine) produzem saída estável e determinística
        // — emite cada intermediário diretamente. Pular a confirmação de duas passagens
        // do LA-2 corta uma marcação inteira de latência (~750ms) do tempo
        // de primeiro texto. A compensação é um flicker ocasional na última
        // palavra enquanto o modelo refina, mas transcrições intermediárias já carregam
        // confidence=0.7 para sinalizar "pode mudar" aos consumidores.
        if (this.skipAgreement) {
            // Pular emissões duplicadas quando o modelo produz texto idêntico
            // para marcações consecutivas (enunciação estável, não áudio novo).
            if (cleaned !== this.lastEmittedText) {
                this.lastEmittedText = cleaned;
                this.recordFirstPartialLatencyOnce();
                this.emit('transcript', {
                    text: cleaned.trim(),
                    isFinal: false,
                    confidence: 0.7,
                });
            }
            return;
        }

        // Caminho LocalAgreement-2 (Whisper / Distil-Whisper): precisa de duas
        // passagens sobrepostas para convergir em um prefixo confirmado estável.
        if (this.lastPartialText === '') {
            this.lastPartialText = cleaned;
            return;
        }

        const agreed = this.longestCommonPrefix(this.lastPartialText, cleaned);
        this.lastPartialText = cleaned;

        if (agreed.length > this.lastEmittedText.length) {
            this.lastEmittedText = agreed;
            this.recordFirstPartialLatencyOnce();
            this.emit('transcript', {
                text: this.lastEmittedText.trim(),
                isFinal: false,
                confidence: 0.7,
            });
        }
    }

    private recordFirstPartialLatencyOnce(): void {
        if (this.segmentOpenedAt > 0 && this.firstPartialEmittedForSegment !== this.trackedSegmentId) {
            const dt = performance.now() - this.segmentOpenedAt;
            if (dt > 0 && dt < LocalWhisperSTT.LATENCY_MAX_MS) {
                this.recordLatency(this.firstPartialLatencies, dt);
            }
            this.firstPartialEmittedForSegment = this.trackedSegmentId;
        }
    }

    /* ──────────────── Latency telemetry helpers ──────────────── */

    private recordLatency(arr: number[], ms: number): void {
        arr.push(ms);
        if (arr.length > LocalWhisperSTT.LATENCY_WINDOW) arr.shift();
        this.latencyLogCounter++;
        if (this.latencyLogCounter >= LocalWhisperSTT.LATENCY_LOG_EVERY) {
            this.latencyLogCounter = 0;
            this.logLatencySummary();
        }
    }

    private percentile(sorted: number[], p: number): number {
        if (sorted.length === 0) return 0;
        const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
        return Math.round(sorted[idx]);
    }

    private logLatencySummary(): void {
        const fp = [...this.firstPartialLatencies].sort((a, b) => a - b);
        const fn = [...this.finalLatencies].sort((a, b) => a - b);
        const fmt = (s: number[]) => s.length === 0
            ? 'n=0'
            : `n=${s.length} p50=${this.percentile(s, 50)}ms p95=${this.percentile(s, 95)}ms p99=${this.percentile(s, 99)}ms`;
        const channelTag = this.channelLabel ? `:${this.channelLabel}` : '';
        console.log(`[LocalWhisperSTT/${this.modelId.split('/').pop()}${channelTag}] latency · first-partial: ${fmt(fp)} · final: ${fmt(fn)}`);
    }

    /** Snapshot para UI / IPC. */
    public getLatencyStats(): { firstPartial: { count: number; p50: number; p95: number; p99: number }; final: { count: number; p50: number; p95: number; p99: number } } {
        const fp = [...this.firstPartialLatencies].sort((a, b) => a - b);
        const fn = [...this.finalLatencies].sort((a, b) => a - b);
        return {
            firstPartial: { count: fp.length, p50: this.percentile(fp, 50), p95: this.percentile(fp, 95), p99: this.percentile(fp, 99) },
            final:        { count: fn.length, p50: this.percentile(fn, 50), p95: this.percentile(fn, 95), p99: this.percentile(fn, 99) },
        };
    }

    private longestCommonPrefix(a: string, b: string): string {
        if (!a || !b) return '';
        const len = Math.min(a.length, b.length);
        let i = 0;
        while (i < len && a[i] === b[i]) i++;
        // Retroceder para o limite de palavra apenas quando dividimos não meio de uma palavra — ou seja,
        // ambos os lados da posição i são não-espaço. Sem isso, o snap-back percorreria
        // todo o prefixo e produziria ''.
        if (i < a.length && /\S/.test(a[i]) && i > 0 && /\S/.test(a[i - 1])) {
            while (i > 0 && /\S/.test(a[i - 1])) i--;
        }
        return a.slice(0, i);
    }

    private resetAgreementState(): void {
        this.lastPartialText = '';
        this.lastEmittedText = '';
        // Invalidate qualquer in-flight streaming tarefa então its late `partial`
        // resposta é dropped por o taskId proteger abaixo em vez disso de mutating
        // o próximo segment's agreement baseline.
        this.streamingTaskId = null;
    }

    /* ──────────────── Final segment despacha ──────────────── */

    private dispatchFinal(audio: Float32Array): void {
        if (!this.worker) return;

        // A final pass fecha o streaming janela — claro agreement estado então
        // o próximo segment inicia clean.
        this.resetAgreementState();
        this.streamingTaskInFlight = false;

        if (!this.workerReady) {
            const MAX_PENDING = 500;
            if (this.pendingAudio.length < MAX_PENDING) {
                this.pendingAudio.push(audio.slice());
            } else {
                console.warn('[LocalWhisperSTT] Pending queue full — dropping oldest segment');
                this.pendingAudio.shift();
                this.pendingAudio.push(audio.slice());
            }
            return;
        }

        if (this.isDrainingFinals) {
            this.drainingFinalsInFlight++;
        }
        this.sendTranscribe(audio, false);
    }

    private sendTranscribe(audio: Float32Array, streaming: boolean): void {
        if (!this.worker) return;
        const taskId = `${streaming ? 's' : 't'}${++this.taskCounter}`;
        const copy = audio.slice();
        this.worker.postMessage(
            { type: 'transcribe', taskId, audio: copy, language: this.language, streaming },
            [copy.buffer]
        );
    }

    /* ──────────────── Worker lifecycle ──────────────── */

    private spawnWorker(): void {
        const warm = modelPreloader.takeWarmWorker(this.modelId);
        if (warm) {
            console.log(`[LocalWhisperSTT] Using preloaded warm worker for ${this.modelId}`);
            this.worker = warm;
            this.workerReady = true;
            this.attachWorkerListeners();
            this.flushPending();
        } else {
            console.log(`[LocalWhisperSTT] Cold-starting worker for ${this.modelId}`);
            const workerPath = resolveWhisperWorkerPath();
            this.worker = new Worker(workerPath);
            this.attachWorkerListeners();
            this.worker.postMessage(buildWorkerInitMessage(this.modelId));
        }
    }

    private attachWorkerListeners(): void {
        if (!this.worker) return;

        this.worker.on('message', (msg: WorkerOutMessage) => {
            if (msg.type === 'ready') {
                this.workerReady = true;
                this.flushPending();
                return;
            }

            // Após stopara permitir apenas o explicitly flushed final segments to
            // retorna durante o 5s drenar window; partials e unrelated worker
            // messages remain ignored em a torn-down instance.
            if (!this.isActive && !(this.isDrainingFinals && msg.type === 'result')) return;

            if (msg.type === 'partial') {
                // Soltar partials cujo segment tem já sido finalized — o
                // agreement baseline é reinicia em todo final despacha e o
                // taskId é invalidated, então a late parcial iria caso contrário
                // corrupt o próximo segment.
                if (msg.taskId !== this.streamingTaskId) {
                    this.streamingTaskInFlight = false;
                    return;
                }
                this.handleStreamingPartial(msg.text);
            } else if (msg.type === 'result') {
                const text = filterHallucination(msg.text);
                if (text) {
                    if (this.segmentOpenedAt > 0) {
                        const dt = performance.now() - this.segmentOpenedAt;
                        if (dt > 0 && dt < LocalWhisperSTT.LATENCY_MAX_MS) {
                            this.recordLatency(this.finalLatencies, dt);
                        }
                    }
                    this.emit('transcript', { text, isFinal: true, confidence: 0.9 });
                }
                // Reinicia segment timer independentemente de emitir (silent finals também fechar
                // o segment). Próximo wrescreve que abre a fresh VAD segment vai
                // re-stamp via o segment-id cverifica
                this.segmentOpenedAt = 0;
                if (this.isDrainingFinals) {
                    this.drainingFinalsInFlight = Math.max(0, this.drainingFinalsInFlight - 1);
                    if (this.drainingFinalsInFlight === 0 && this.worker) {
                        this.beginWorkerTermination(this.worker);
                    }
                }
            } else if (msg.type === 'error') {
                console.error('[LocalWhisperSTT] Worker error:', msg.message);
                if (this.isDrainingFinals && msg.taskId?.startsWith('t')) {
                    this.drainingFinalsInFlight = Math.max(0, this.drainingFinalsInFlight - 1);
                    if (this.drainingFinalsInFlight === 0 && this.worker) {
                        this.beginWorkerTermination(this.worker);
                    }
                }
                // If o falhou tarefa era o in-flight streaming one, unblock
                // o loop então o próximo tick pode fire.
                if (msg.taskId && msg.taskId === this.streamingTaskId) {
                    this.streamingTaskInFlight = false;
                    this.streamingTaskId = null;
                    // Worker é liberar anovamente reinicia recuo então próximo tick é prompt.
                    this.streamingStallCount = 0;
                    this.streamingNextDelayMs = this.streamingIntervalBaseMs;
                }
                if (msg.message.includes('Failed to load model')) {
                    const isOnnxSymbolError = msg.message.includes('Symbol not found')
                        || msg.message.includes('__ZNSt3__18to_charsEPcS0_d')
                        || msg.message.includes('libonnxruntime');
                    this.emit('error', new Error(
                        isOnnxSymbolError
                            ? 'Local Whisper is not supported on macOS 12 (Monterey) or earlier. Please upgrade to macOS 13 Ventura or later, or use a cloud STT provider.'
                            : 'Local Whisper model not found. Please download a model in Settings → Audio.'
                    ));
                }
            }
        });

        this.worker.on('error', (err) => {
            const isOnnxSymbolError = err.message.includes('Symbol not found')
                || err.message.includes('to_chars')
                || err.message.includes('libonnxruntime');
            if (isOnnxSymbolError) {
                this.emit('error', new Error(
                    'Local Whisper is not supported on macOS 12 (Monterey) or earlier. Please upgrade to macOS 13 Ventura or later, or use a cloud STT provider.'
                ));
            } else {
                this.emit('error', err);
            }
        });
    }

    private flushPending(): void {
        // Push o cached prompt para o worker Primeiro então o queued transcribes
        // see o bias em their initial executa (worker honors o latest cached
        // prompt para qualquer que transcribe arrives nepróximo
        this.maybePushPromptToWorker();
        const queued = this.pendingAudio.splice(0);
        queued.forEach(audio => this.sendTranscribe(audio, false));
        if (this.isDrainingFinals && queued.length === 0 && this.drainingFinalsInFlight === 0 && this.worker) {
            this.beginWorkerTermination(this.worker);
        }
    }

    private beginWorkerTermination(w: Worker): void {
        this.worker = null;
        this.workerReady = false;
        this.isDrainingFinals = false;
        this.drainingFinalsInFlight = 0;
        // Reinicia o sent-prompt tracker: a future spawnWorker chamar vai obtém a
        // fresh worker com vazio ccache então we precisa re-push em próximo ready.
        this.contextPromptSentToWorker = '';
        w.removeAllListeners('message');
        w.removeAllListeners('error');
        if (this.workerTerminateTimer) clearTimeout(this.workerTerminateTimer);
        const t = setTimeout(() => {
            this.workerTerminateTimer = null;
            w.terminate();
        }, 5000);
        // unref então o timer doesn't pin o Nó evento loop em app quit.
        (t as any).unref?.();
        this.workerTerminateTimer = t;
    }
}
