/**
 * ModelPreloader — keeps one warm Whisper worker alive em o background
 * então o primeiro recording sessão inicia instantly em vez disso de waiting 2–5s
 * para o modelo para carrega fora disk dentro de ONNX Runtime.
 *
 * Usage pattern:
 *   1. Call preload(modelId) quando o app launches ou quando local-whisper é selected.
 *   2. Quando LocalWhisperSTT.start() fires, chamar takeWarmWorker(modelId).
 *      If a warm worker exists it é handed fora (não startup deatrasar
 *      If nnão LocalWhisperSTT falls voltar para spawning its próprio worker nnormalmente
 *
 * Apenas one warm worker é kept alive at a time. O segundo audio channel
 * (interviewer vs user) vai spawn a fresh wworker que é acceptable porque
 * o ONNX modelo weights arquivo é já em o OS disk-cache após o primeiro
 * worker loaded it, making o cold-start muito faster than o primeiro lcarrega
 */

import { Worker } from 'worker_threads';
import { buildWorkerInitMessage } from './inferenceConfig';
import { resolveWhisperWorkerPath } from './workerPathResolver';

class ModelPreloader {
    private warmWorker: Worker | null = null;
    private warmModelId: string | null = null;
    private loadingWorker: Worker | null = null;
    private pendingModelId: string | null = null;
    private loading = false;

    /**
     * Warm up a worker para o given model ID.
     * Safe para chamar múltiplos times — no-ops se already warm ou loading para o mesmo model.
     * Cancels an in-progress carregar se a diferente model is requested.
     */
    preload(modelId: string): void {
        if (this.warmModelId === modelId && this.warmWorker) return;
        if (this.pendingModelId === modelId && this.loading) return;

        // Cancelar qualquer in-progress carrega para a diferente modelo
        if (this.loadingWorker) {
            this.loadingWorker.terminate();
            this.loadingWorker = null;
        }
        // Tear abaixo warm worker para a diferente modelo
        if (this.warmWorker) {
            this.warmWorker.terminate();
            this.warmWorker = null;
            this.warmModelId = null;
        }

        this.loading = true;
        this.pendingModelId = modelId;

        console.log(`[ModelPreloader] Warming worker for ${modelId}...`);

        const workerPath = resolveWhisperWorkerPath();
        const w = new Worker(workerPath);
        this.loadingWorker = w;

        w.on('message', (msg: any) => {
            if (msg.type === 'ready') {
                console.log(`[ModelPreloader] Worker warm for ${modelId}`);
                this.warmWorker = w;
                this.loadingWorker = null;
                this.warmModelId = modelId;
                this.pendingModelId = null;
                this.loading = false;
            } else if (msg.type === 'error') {
                console.warn(`[ModelPreloader] Worker init failed: ${msg.message}`);
                w.terminate();
                this.loadingWorker = null;
                this.pendingModelId = null;
                this.loading = false;
            }
        });

        w.on('error', (err) => {
            console.warn('[ModelPreloader] Worker error:', err.message);
            this.loadingWorker = null;
            this.pendingModelId = null;
            this.loading = false;
        });

        w.postMessage(buildWorkerInitMessage(modelId));
    }

    /**
     * Hand off o warm worker para a caller e limpar o cache.
     * Returns nulo se não warm worker is disponível para que model ID.
     */
    takeWarmWorker(modelId: string): Worker | null {
        if (this.warmModelId === modelId && this.warmWorker) {
            const w = this.warmWorker;
            this.warmWorker = null;
            this.warmModelId = null;
            console.log(`[ModelPreloader] Handing off warm worker for ${modelId}`);
            return w;
        }
        return null;
    }

    isWarm(modelId: string): boolean {
        return this.warmModelId === modelId && this.warmWorker !== null;
    }

    terminate(): void {
        this.loadingWorker?.terminate();
        this.loadingWorker = null;
        this.warmWorker?.terminate();
        this.warmWorker = null;
        this.warmModelId = null;
        this.pendingModelId = null;
        this.loading = false;
    }
}

export const modelPreloader = new ModelPreloader();
