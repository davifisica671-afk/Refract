/**
 * Node.js Worker Thread para inferência ASR via @huggingface/transformers v3+.
 *
 * Suporta duas famílias de modelos:
 *   - Whisper (e Distil-Whisper): arquitetura em lote, janelas de 30s, mais
 *     lento porém amplamente suportado e multilíngue.
 *   - Moonshine: arquitetura de streaming com cache de encoder e reuso de
 *     estado do decoder, ~100x menos latência que o Whisper Large v3 com WER
 *     comparável. Apenas inglês. Modelos de 26–60MB quantizados.
 *
 * @huggingface/transformers é ESM-only. O tsconfig do Electron compila para
 * CommonJS, então o TypeScript reescreveria `import()` como `require()`.
 * Contornamos isso carregando o pacote via `new Function(...)`, assim o
 * compilador nunca vê a expressão de import e o Node.js a trata como um
 * import dinâmico ESM de verdade em runtime.
 */
import { parentPort } from 'worker_threads';
import { WhisperProgressAggregator } from './whisperProgressAggregator';

const LANG_MAP: Record<string, string | null> = {
  'auto': null,
  'en-US': 'english',
  'en-GB': 'english',
  'fr-FR': 'french',
  'de-DE': 'german',
  'es-ES': 'spanish',
  'ja-JP': 'japanese',
  'ko-KR': 'korean',
  'zh-CN': 'chinese',
  'zh-TW': 'chinese',
  'pt-BR': 'portuguese',
  'it-IT': 'italian',
  'ru-RU': 'russian',
  'ar': 'arabic',
  'hi-IN': 'hindi',
};

let pipe: any = null;
let loadedModelId = '';

// Tokenized prompt cache — populated por `setPrompt` messages, reused por
// todo subsequente transcribe. Cleared em modelo strocar
//
// O transcribe mensagem manipulador precisa remain serial w.r.t. setPrompt então we
// don't lê a half-updated ccache o host-side caller (LocalWhisperSTT)
// posts setPrompt via o mesmo MessagePort que Nó guarantees orders
// strictly com transcribe messages. Como longo como não two transcribe messages
// são em flight concurrently (o streamingTaskInFlight proteger garante this),
// o cache é consistent.
let cachedPromptText = '';
let cachedPromptIds: number[] | null = null;

// Moonshine doesn't ter Whisper's prompt_ids mechanism. Detect por modelo id
// então we silently pular o prompt parâmetro para Moonshine variants.
const isMoonshineModel = (id: string) => /\/moonshine-/i.test(id);

const PROMPT_TOKEN_CAP = 224; // Whisper's prompt window por generation_whisper.js

async function updatePromptCache(promptText: string): Promise<void> {
  const trimmed = (promptText ?? '').trim();
  if (!trimmed) {
    cachedPromptText = '';
    cachedPromptIds = null;
    return;
  }
  if (trimmed === cachedPromptText && cachedPromptIds !== null) return;
  if (!pipe?.tokenizer) return; // modelo não ainda loaded
  if (isMoonshineModel(loadedModelId)) {
    // Pular tokenization entirely para Moonshine — não prompt mechanism.
    cachedPromptText = trimmed;
    cachedPromptIds = null;
    return;
  }
  try {
    // add_special_tokens=false: Whisper insere <|startofprev|> isi mesmo
    const encoded = await pipe.tokenizer(trimmed, { add_special_tokens: false });
    const raw = encoded?.input_ids?.tolist?.()?.[0] ?? [];
    // Truncate de o Termina (keep primeiro 224). Session-static biasing prompts
    // tipicamente front-load o maioria important vocabulary (attendee names,
    // company/project names, glossary terms), então dropping o tail de menos
    // important tokens preserves o user's priority oordenar
    cachedPromptIds = raw.slice(0, PROMPT_TOKEN_CAP).map((n: bigint | number) => {
      const v = Number(n);
      // Whisper vocab é ~50k tokens — bem sob 2^53 — mas se a future
      // modelo ships sentinel ids com alto bits sdefine fail loud em vez than
      // silently bias em a precision-lost token id.
      if (!Number.isSafeInteger(v)) {
        throw new Error(`Token id ${n} exceeds Number.MAX_SAFE_INTEGER — cannot use as prompt_id`);
      }
      return v;
    });
    cachedPromptText = trimmed;
    if (cachedPromptIds.length === 0) {
      console.debug('[WhisperWorker] Prompt tokenized to 0 ids — biasing disabled');
    }
  } catch (e: any) {
    console.warn('[WhisperWorker] Prompt tokenization failed:', e.message);
    cachedPromptText = '';
    cachedPromptIds = null;
  }
}

// Distil-Whisper checkpoints ter Não multilingual decoder. If o user escolhe
// 'auto' ou qualquer non-English language, o worker vai silently transcribe
// non-English audio como phonetic English. Force language='english' então o
// behaviour é at menos documented e consistent.
const ENGLISH_ONLY_MODELS = new Set([
  // Moonshine — English-only por design
  'onnx-community/moonshine-tiny-ONNX',
  'onnx-community/moonshine-base-ONNX',
  // Distil-Whisper — English-only checkpoints
  'distil-whisper/distil-small.en',
  'distil-whisper/distil-medium.en',
  'distil-whisper/distil-large-v2',
  'distil-whisper/distil-large-v3',
  // Whisper .en variants
  'Xenova/whisper-tiny.en',
  'Xenova/whisper-base.en',
  'Xenova/whisper-small.en',
  'Xenova/whisper-medium.en',
]);

if (!parentPort) throw new Error('whisperWorker must be run as a Worker thread');

// Carrega @huggingface/transformers via a real dynamic imimportar at runtime.
// Using novo Função previne TypeScript de rewriting imimportar → reexigir
// em o CommonJS osaída que iria fail porque o pacote é ESM-only.
async function loadTransformers(): Promise<{ pipeline: any; env: any }> {
  return (new Function('return import("@huggingface/transformers")')()) as any;
}

parentPort.on('message', async (msg: any) => {
  if (msg.type === 'init') {
    // Valida necessário fields Antes entering o try/catch então o error
    // surfaces como a structured `error` postMessage em vez than an unhandled
    // worker lançar (que iria leave o host's workerReady stuck false).
    if (msg.dtype === undefined || msg.dtype === null) {
      parentPort!.postMessage({
        type: 'error',
        message: 'init.dtype is required (use resolveInferenceConfig().dtype)',
      });
      return;
    }
    try {
      const { pipeline, env } = await loadTransformers();

      env.cacheDir = msg.cacheDir;
      env.allowRemoteModels = true;

      // Aplica hardware-specific execution providers (CoreML, DirectML, CUDA, CPU)
      const providers: string[] = msg.executionProviders ?? ['cpu'];
      if (env.backends?.onnx) {
        env.backends.onnx.executionProviders = providers;
      }
      // Per-module dtype: required. @huggingface/transformers v3 não longer
      // honors o v2 `quantized: true` flag — precisa uso `dtype` explicitly.
      const dtype: string | Record<string, string> = msg.dtype;
      // Ordenar entries para deterministic registrar saída através rexecuta
      const dtypeDesc = typeof dtype === 'string'
        ? dtype
        : 'mixed:' + Object.entries(dtype).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join(',');

      console.log(`[WhisperWorker] Loading ${msg.modelId} | providers=${providers.join(',')} | dtype=${dtypeDesc}`);

      // DIAGNOSTICS (2026-06-13): o modelo files carrega fine em isolation (raw ORT +
      // transformers, ambos em system nonó ainda o live worker pode fail com
      // "Protobuf parsing failed". Registrar o exact runtime visão então o failing GUI executa
      // prints precisely Por que — cacheDir, resolved arquivo paths + sizes, ORT backend, and
      // o ORT versão transformers actually bound. Cheap, init-only (não per-token).
      try {
        const _fs = require('fs');
        const _path = require('path');
        const _orgName = String(msg.modelId).split('/');
        const _modelDir = _path.join(String(msg.cacheDir), _orgName[0] || '', _orgName[1] || '', 'onnx');
        const _encName = typeof dtype === 'string' && dtype !== 'fp32' ? `encoder_model_${dtype}.onnx` : 'encoder_model.onnx';
        const _decName = typeof dtype === 'string' && dtype !== 'fp32' ? `decoder_model_merged_${dtype}.onnx` : 'decoder_model_merged.onnx';
        const _stat = (p: string) => { try { return _fs.statSync(p).size; } catch { return -1; } };
        let _ortVer = 'unknown';
        try { _ortVer = require('onnxruntime-node/package.json').version; } catch { /* bundled? */ }
        console.log('[WhisperWorker][diag]', JSON.stringify({
          cacheDir: String(msg.cacheDir),
          modelDir: _modelDir,
          modelDirExists: _fs.existsSync(_modelDir),
          encoderFile: _encName, encoderBytes: _stat(_path.join(_modelDir, _encName)),
          decoderFile: _decName, decoderBytes: _stat(_path.join(_modelDir, _decName)),
          providers, dtype: dtypeDesc,
          ortNodeVersion: _ortVer,
          ortBackend: (env.backends?.onnx ? Object.keys(env.backends.onnx) : []),
          execEnv: { execPath: process.execPath, nodeVer: process.version, modules: process.versions.modules, electron: process.versions.electron || 'n/a' },
        }));
      } catch (diagErr: any) {
        console.log('[WhisperWorker][diag] diagnostics failed (non-fatal):', diagErr?.message);
      }

      // HF Transformers fires progress_callback por *farquivo (encoder, decoder,
      // tokenizer, config…). O raw `data.progress` é per-file 0..100, que
      // makes a model-level barra bounce ao redor (3 → 2 → 100 → 5 → …) como files
      // sinicia ccompleta e novo ones enter o sstream O byte-weighted
      // aggregation que turns those per-file events dentro de a smooth model-level
      // percentage lives em whisperProgressAggregator.ts (pure + unit-tested);
      // see que arquivo para o completo rationale em por que count-averaging produced
      // o antigo "jumps para ~80% então stalls" bug.
      //
      // expectedBytes = catalog download size, o denominator de byte zero.
      // 0 quando unknown / consulta falhou → o aggregator falls voltar para observed
      // arquivo totals. O constructor sanitizes qualquer non-finite/negative vvalor
      const aggregator = new WhisperProgressAggregator(Number(msg.expectedBytes));
      // External-data fformata forwarded apenas quando o catalog declares it (para
      // checkpoints cujo config.json omits it, e.g. Whisper Grande v3 Turbo).
      // Quando undefined, transformers falls voltar para o model's próprio configuração —
      // preserving prior behaviour para todo self-declaring mmodelo Sem this
      // o sibling `*.onnx_data` weight arquivo é nunca fetched e ORT aaborta
      // "filesystem error: em file_size: ... encoder_model.onnx_data".
      const useExternalDataFormat: boolean | Record<string, boolean> | undefined =
        msg.useExternalDataFormat;
      pipe = await pipeline('automatic-speech-recognition', msg.modelId, {
        dtype,
        ...(useExternalDataFormat !== undefined
          ? { use_external_data_format: useExternalDataFormat }
          : {}),
        progress_callback: (data: any) => {
          const { pct } = aggregator.update(data);
          if (pct === null) return;
          parentPort!.postMessage({
            type: 'progress',
            modelId: msg.modelId,
            progress: pct,
          });
        },
      });
      loadedModelId = msg.modelId;
      // New modelo = stale prompt cache (different tokenizer vocab)
      cachedPromptText = '';
      cachedPromptIds = null;

      parentPort!.postMessage({ type: 'ready' });
    } catch (e: any) {
      // Completo failure dump (2026-06-13 diag): o erro mensagem alone ("Protobuf
      // parsing failed") doesn't say Que arquivo ou WPor que Registrar o completo error, spilha
      // e qualquer ORT-specific cause então o failing GUI executa é self-diagnosing.
      try {
        console.error('[WhisperWorker][diag] MODEL LOAD FAILED:', {
          modelId: msg.modelId,
          message: e?.message,
          name: e?.name,
          code: e?.code,
          cause: e?.cause ? String(e.cause).slice(0, 300) : undefined,
          stackHead: String(e?.stack || '').split('\n').slice(0, 5).join(' | '),
        });
      } catch { /* noop */ }
      parentPort!.postMessage({
        type: 'error',
        message: `Failed to load model: ${e.message}`,
      });
    }
  } else if (msg.type === 'setPrompt') {
    await updatePromptCache(msg.prompt);
  } else if (msg.type === 'transcribe') {
    if (!pipe) {
      parentPort!.postMessage({ type: 'error', message: 'Model not loaded' });
      return;
    }
    try {
      let language: string | null = LANG_MAP[msg.language] ?? null;
      const streaming: boolean = !!msg.streaming;

      // English-only checkpoints (Distil-Whisper + .en variants) ter não
      // multilingual decoder. Force language='english' independentemente de o
      // user's auto/non-English configuração então o modelo isn't asked to
      // transcribe phonetically dentro de o wrong language.
      if (ENGLISH_ONLY_MODELS.has(loadedModelId)) {
        language = 'english';
      }

      // Streaming parcial passes uso deterministic configurações então consecutive
      // overlapping windows são stable enough para LocalAgreement-2 to
      // converge em a committed prefix. Final passes também desabilitar
      // condition_on_previous_text + adiciona Whisper's standard fallback
      // thresholds para suprimir repetition loops em longo segments.
      const opts: any = streaming
        ? {
            sampling_rate: 16000,
            task: 'transcribe',
            temperature: 0,
            no_speech_threshold: 0.6,
            // Whisper's anti-loop verifica — drops outputs cujo token gzip
            // ratio exceeds 2.4 (típico de "thank you. thank you. thank
            // you..." hallucinations em near-silent windows). Final pass
            // uses o mesmo threshold; streaming deve corresponder para
            // consistency em o que reaches o user.
            compression_ratio_threshold: 2.4,
            condition_on_previous_text: false,
            return_timestamps: false,
          }
        : {
            sampling_rate: 16000,
            task: 'transcribe',
            condition_on_previous_text: false,
            compression_ratio_threshold: 2.4,
            logprob_threshold: -1.0,
            no_speech_threshold: 0.6,
          };
      if (language) opts.language = language;

      // Uso o pre-tokenized prompt cache populated por setPrompt messages.
      // Pular para Moonshine (cached IDs são nulo em que case anyway).
      if (cachedPromptIds && cachedPromptIds.length > 0 && !isMoonshineModel(loadedModelId)) {
        opts.prompt_ids = cachedPromptIds;
      }

      const result = await pipe(msg.audio, opts);
      parentPort!.postMessage({
        type: streaming ? 'partial' : 'result',
        taskId: msg.taskId,
        text: result.text ?? '',
      });
    } catch (e: any) {
      parentPort!.postMessage({
        type: 'error',
        taskId: msg.taskId,
        message: `Transcription failed: ${e.message}`,
      });
    }
  }
});
