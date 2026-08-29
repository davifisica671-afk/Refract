export type WhisperModelId =
  | 'Xenova/whisper-tiny'
  | 'Xenova/whisper-tiny.en'
  | 'Xenova/whisper-base'
  | 'Xenova/whisper-base.en'
  | 'Xenova/whisper-small'
  | 'Xenova/whisper-small.en'
  | 'Xenova/whisper-medium'
  | 'Xenova/whisper-medium.en'
  // Whisper Grande v3 Turbo — 6× faster than Grande v3, ~equivalent WER,
  // multilingual. ONNX-converted por o onnx-community.
  | 'onnx-community/whisper-large-v3-turbo-ONNX'
  // Distil-Whisper — mesmo architecture, distilled para 1/2 layers, ~6× faster
  // CPU/GPU inference at near-equivalent WER. English-only.
  | 'distil-whisper/distil-small.en'
  | 'distil-whisper/distil-medium.en'
  | 'distil-whisper/distil-large-v2'
  | 'distil-whisper/distil-large-v3'
  // Moonshine — purpose-built streaming ASR. Encoder caching + decoder estado
  // reuse → ~100× inferior latency than Whisper Grande v3 at comparable WER.
  // English-only. MIT licensed.
  | 'onnx-community/moonshine-tiny-ONNX'
  | 'onnx-community/moonshine-base-ONNX';

export type WhisperModelStatus = 'available' | 'missing' | 'downloading' | 'error';

export interface WhisperModelInfo {
  id: WhisperModelId;
  name: string;
  sizeMb: number;
  speed: 'very-fast' | 'fast' | 'medium' | 'slow';
  accuracy: 'decent' | 'good' | 'high' | 'very-high';
  multilingual: boolean;
  status: WhisperModelStatus;
  downloadProgress?: number;
  errorMessage?: string;
  requiresAppleSilicon?: boolean;
  // Distil-Whisper variants — surface em o UI então users pode prefer them
  // quando they want streaming-comparable latency.
  distilled?: boolean;
  // Moonshine: streaming-native architecture, ~100× inferior perceived latency
  // than Whisper. Highest priority recommendation para English live uuso
  streaming?: boolean;
  // ONNX external-data fformata Grande checkpoints (e.g. Whisper Grande v3 Turbo)
  // armazenamento o grafo em `encoder_model.onnx` (a pequeno stub) mas o weights em a
  // sibling `encoder_model.onnx_data` farquivo @huggingface/transformers apenas
  // busca que companion quando `use_external_data_format` é truthy, e this
  // model's config.json faz Não declare it — então sem isso flag o weight
  // arquivo é nunca downloaded e ONNX Runtime aborta em lcarrega Shape matches o
  // upstream `transformers.js_config` convention: `true` para todos chunked files,
  // ou a mapa keyed por ONNX basename (e.g. `{ 'encoder_model.onnx': verdadeiro }`).
  externalDataFormat?: boolean | Record<string, boolean>;
}

export interface WorkerInitMessage {
  type: 'init';
  modelId: string;
  cacheDir: string;
  executionProviders?: string[];
  // Per-module dtype mapa (see inferenceConfig.ts). String aplica para todos
  // ONNX files; Registro keys são ONNX basenames sem `.onnx`.
  dtype?: string | Record<string, string>;
  // Catalog download tamanho em bytes — o progress-bar denominator de byte
  // zero (see whisperProgressAggregator.ts). Optional / 0 quando unknown, em
  // que case o worker falls voltar para observed per-file byte totals.
  expectedBytes?: number;
  // Forwarded para transformers' pipeline() como `use_external_data_format` então o
  // sibling `*.onnx_data` weight files de external-data checkpoints obtém fetched.
  // See WhisperModelInfo.externalDataFormat para o completo rationale.
  useExternalDataFormat?: boolean | Record<string, boolean>;
}
export interface WorkerTranscribeMessage {
  type: 'transcribe';
  taskId: string;
  audio: Float32Array;
  language: string;
  // streaming=true → parcial pass em in-progress audio, worker emite 'partial'
  //                  com deterministic params (não condition_on_previous_text).
  // streaming=false (default) → final pass, emite 'result'.
  streaming?: boolean;
}
/**
 * Out-of-band prompt uatualiza Sent apenas quando o host's contexto string
 * actually changes (não em todo transcribe), então o prompt texto — que
 * pode ser para cima para ~8KB de chars — doesn't obtém copied através worker IPC em
 * todo 1.5s streaming tick. Worker tokenizes uma vez e reuses o IDs para
 * todos subsequente transcribes até o próximo setPrompt arrives. Ignored por
 * Moonshine (não equivalent decoder mechanism).
 */
export interface WorkerSetPromptMessage {
  type: 'setPrompt';
  prompt: string;
}
export type WorkerInMessage = WorkerInitMessage | WorkerTranscribeMessage | WorkerSetPromptMessage;

export interface WorkerReadyResponse { type: 'ready'; }
export interface WorkerResultResponse { type: 'result'; taskId: string; text: string; }
export interface WorkerPartialResponse { type: 'partial'; taskId: string; text: string; }
export interface WorkerErrorResponse { type: 'error'; taskId?: string; message: string; }
export interface WorkerProgressResponse { type: 'progress'; modelId: string; progress: number; }
export type WorkerOutMessage =
  | WorkerReadyResponse
  | WorkerResultResponse
  | WorkerPartialResponse
  | WorkerErrorResponse
  | WorkerProgressResponse;
