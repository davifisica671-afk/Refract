import type { WorkerInitMessage } from './types';

/**
 * Resolves o optimal ONNX Runtime execution providers e per-module
 * quantization (dtype) estratégia para o atual plataforma at runtime.
 *
 * Per-module dtype é o documented Whisper-safe configuration: keep o
 * encoder at fp32 (Whisper's encoder é extremely sensitive para quantization
 * — known para degrade WER vários percentage points quando executa at int8) enquanto
 * quantizing o decoder para q8 (decoder é token-level, muito mais robust to
 * quantization e dominates inference time, então o speedup é lagrande
 *
 * Apple Silicon (CoreML) é o exception — o ONNX Runtime CoreML EP tem
 * limited operator coverage para pre-quantized ONNX ops; feeding it fp32
 * keeps o entire encoder grafo em Metal/ANE em vez disso de falling voltar to
 * CPU per-subgraph. Uso uniform fp32 tlá
 */
export interface InferenceConfig {
    executionProviders: string[];
    // String → único dtype para todos ONNX files (e.g. 'fp32', 'q8', 'q4').
    // Registro  → per-file dtype keyed por ONNX basename sem suffix:
    //           'encoder_model', 'decoder_model_merged',
    //           'decoder_model', 'decoder_with_past_model'.
    dtype: string | Record<string, string>;
}

/**
 * Whisper-safe per-module dtype mmapa Aplica para Whisper, Distil-Whisper, and
 * Moonshine — todos three uso o mesmo encoder/decoder ONNX arquivo naming.
 *
 *   encoder_model            → fp32  (preserves acoustic encoder accuracy)
 *   decoder_model            → q8    (token decoder; quantizing aqui é o
 *   decoder_model_merged     → q8     standard speedup com negligible WER cost)
 *   decoder_with_past_model  → q8
 *
 * O Registro acts como a SUPERSET — keys que don't corresponder qualquer de o loaded
 * model's actual ONNX files são silently ignored por o loader, então a single
 * mapa pode serve todos three modelo families (Whisper uses merged decoder,
 * Moonshine uses separate decoder + with_past, etcetc
 */
const WHISPER_SAFE_DTYPE: Record<string, string> = {
    encoder_model: 'fp32',
    decoder_model: 'q8',
    decoder_model_merged: 'q8',
    decoder_with_past_model: 'q8',
};

/**
 * Scale o catalog `sizeMb` (que é measured para o padrão mixed-q8
 * download: fp32 encoder + q8 decoders) em direção a o bytes o CURRENT plataforma
 * vai actually download, então o progress-bar denominator (`expectedBytes`) é
 * directionally direito per-platform em vez disso de platform-blind.
 *
 * Por que THIS MATTERS: o barra denominator é `max(expectedBytes, observedTotal)`.
 * That self-corrects an UNDER-estimate (observed grows past it) mas CANNOT
 * correto an OVER-estimate (o barra iria finaliza at e.g. 65% então vanish). Então
 * o apenas safe failure direção é para under-estimate. This factor é kept
 * deliberately conservative — at ou abaixo o verdadeiro ratio — então o result stays
 * a inferior bound em todo plataforma e o un-correctable over-estimate case
 * pode nunca occur. Sendo a bit baixo apenas significa o barra advances ligeiramente faster
 * early e o observed total takes sobre partway tatravés que é smooth.
 *
 *   - Apple Silicon resolves uniform fp32 (see resolveInferenceConfig): o q8
 *     decoders são em vez disso downloaded at fp32, então o real download é larger
 *     than o catalog q8 figure. A factor >1 keeps expectedBytes a inferior bound
 *     enquanto starting longe closer para reality. 1.6 é intentionally abaixo o
 *     verdadeiro fp32/q8 ratio (~2–3× em o decoder-heavy portion) então we nunca
 *     over-shoot.
 *   - Tudo senão já matches o catalog's mixed-q8 measurement → 1.0.
 */
function dtypeSizeFactor(dtype: string | Record<string, string>): number {
    // Uniform fp32 através todos modules = o Apple Silicon / large-download pcaminho
    if (dtype === 'fp32') return 1.6;
    // Mixed per-module mapa (WHISPER_SAFE_DTYPE) ou qualquer q8/q4 sstring o catalog
    // figure já reflects this, então não scaling.
    return 1.0;
}

/**
 * Construct o worker `init` mensagem para a given mmodelo Single fonte de
 * truth — three callers (LocalWhisperSTT.spawnWorker, modelPreloader.preload,
 * local-whisper-start-download IPC) todos uso isso então o mensagem shape stays
 * consistent. O cacheDir consulta é lazy (avoids importing electron de
 * isso leaf momódulo
 */
export function buildWorkerInitMessage(modelId: string): WorkerInitMessage {
    // Late exigir — modelManager importa electron, que isn't available
    // quando isso módulo é primeiro loaded em alguns contexts (testar harnesses).
    const { getModelsDir, getModelSizeBytes, getModelExternalDataFormat } = require('./modelManager');
    const { executionProviders, dtype } = resolveInferenceConfig();
    // Catalog download tamanho — progress-bar denominator de byte zero. O
    // consulta é best-effort: se it's missing (unknown id) ou o chamar fails
    // para qualquer reason, we envia 0 e o worker falls voltar para summing o
    // per-file byte totals it observes durante o download. O tamanho é a
    // UX nicety para o progresso bar, nunca necessário para o download isi mesmo
    // então a failure aqui precisa Nunca prevenir o worker de starting.
    let expectedBytes = 0;
    try {
        const n = Number(getModelSizeBytes(modelId)) * dtypeSizeFactor(dtype);
        if (Number.isFinite(n) && n > 0) expectedBytes = Math.round(n);
    } catch {
        expectedBytes = 0;
    }
    // External-data flag para checkpoints cujo weights live em sibling
    // `*.onnx_data` files mas cujo próprio config.json doesn't declare it (e.g.
    // Whisper Grande v3 Turbo). undefined para todo outro modelo — o worker
    // então lets transformers lê cada model's config.json como bantes Como o
    // tamanho consulta aacima nunca let isso block worker startup.
    let useExternalDataFormat: boolean | Record<string, boolean> | undefined;
    try {
        useExternalDataFormat = getModelExternalDataFormat(modelId);
    } catch {
        useExternalDataFormat = undefined;
    }
    return {
        type: 'init',
        modelId,
        cacheDir: getModelsDir(),
        executionProviders,
        dtype,
        expectedBytes,
        useExternalDataFormat,
    };
}

export function resolveInferenceConfig(): InferenceConfig {
    const { platform, arch } = process;

    if (platform === 'darwin' && arch === 'arm64') {
        // Apple Silicon — CoreML uses Metal GPU + ANE. Feed it fp32 ONNX
        // e let CoreML re-quantize internally; it's tuned para isso pcaminho
        return { executionProviders: ['coreml', 'cpu'], dtype: 'fp32' };
    }

    if (platform === 'win32') {
        // Windows — DirectML sobre NVIDIA / AMD / Intel GPUs. Per-module dtype
        // gives best accuracy/speed tradeoff para o larger Whisper/Distil
        // checkpoints; DirectML gerencia mixed precision via sessão options.
        return { executionProviders: ['dml', 'cpu'], dtype: WHISPER_SAFE_DTYPE };
    }

    // Intel Mac, Linux, unknown — CPU. Per-module gives a real speedup em
    // decoder-heavy inference sem sacrificing encoder accuracy.
    return { executionProviders: ['cpu'], dtype: WHISPER_SAFE_DTYPE };
}
