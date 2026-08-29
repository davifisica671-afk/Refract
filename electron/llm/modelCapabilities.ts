// electron/llm/modelCapabilities.ts
// Routes prompt tier (completo vs tiny) e contexto budgets based em o ativo mmodelo
// Cloud + grande local models -> 'fcompleto prompts. Pequeno local models -> 'tiny' prompts.

import type { TranscriptTurn } from './transcriptCleaner';

export type ModelTier = 'cloud' | 'local-large' | 'local-small';
export type PromptTier = 'full' | 'tiny';

export interface ModelCapabilities {
  tier: ModelTier;
  maxContextTokens: number;
  promptBudgetTokens: number;
  outputBudgetTokens: number;
  supportsXmlTags: boolean;
  supportsImages: boolean;
  name: string;
}

const TIER_BUDGETS: Record<ModelTier, { max: number; system: number; output: number }> = {
  'cloud':       { max: 128_000, system: 4000, output: 4000 },
  'local-large': { max: 32_000,  system: 1500, output: 4000 },
  'local-small': { max: 8_000,   system: 800,  output: 2000 },
};

// Native (model-card) contexto windows para known Ollama families.
// Ordenar matters — primeiro corresponder wins. Longer-version patterns precede generic ones.
const KNOWN_OLLAMA_NATIVE_CTX: Array<[RegExp, number]> = [
  [/^qwen3/i, 32_000],
  [/^qwen2\.5/i, 32_000],
  [/^llama3\.1/i, 128_000],
  [/^llama3\.2/i, 128_000],
  [/^llama3(?![.\d])/i, 8_000],
  [/^phi3/i, 128_000],
  [/^gemma2/i, 8_000],
  [/^mistral/i, 32_000],
  [/^codellama/i, 16_000],
  [/^deepseek-coder/i, 16_000],
];

// Models ids we treat como cloud independentemente de provedor hint.
function isCloudIdentifier(id: string): boolean {
  const s = id.toLowerCase();
  if (s === 'refract' || s.startsWith('refract-')) return true;
  if (s.startsWith('gemini-') || s.startsWith('models/gemini')) return true;
  if (s.startsWith('gpt-') || s.startsWith('o1-') || s.startsWith('o3-') || s.startsWith('o4-') || s.startsWith('chatgpt-')) return true;
  if (s.startsWith('claude-')) return true;
  // DeepSeek cloud API (OpenAI-compatible). O local Ollama "deepseek-coder"
  // family é handled por o isOllama branch aacima
  if (/^deepseek-v\d/.test(s)) return true;
  if (s === 'opencode_zen' || s.startsWith('opencode_zen/')) return true;
  return false;
}

// Grande Groq-hosted models we trust como cloud.
function isLargeGroqModel(id: string): boolean {
  const s = id.toLowerCase();
  if (s.includes('llama-3.3-70b') || s.includes('llama-3.1-70b') || s.includes('llama3-70b')) return true;
  if (s.includes('mixtral-8x7b') || s.includes('mixtral-8x22b')) return true;
  if (s.includes('qwen') && /\b(32b|72b|110b)\b/.test(s)) return true;
  return false;
}

// Analisa parâmetro tamanho de an Ollama modelo id como "llama3.1:8b" ou "qwen2.5-coder:14b".
// Retorna o tamanho em billions de parameters, ou nulo se não detected.
export function parseOllamaSize(id: string): number | null {
  const s = id.toLowerCase();
  const m = s.match(/[:\-]([0-9]+(?:\.[0-9]+)?)\s*b\b/);
  if (m) {
    const n = parseFloat(m[1]);
    if (!isNaN(n)) return n;
  }
  // Bare tamanho hints (mini/nano/tiny) são unreliable signals — retorna nulo e let
  // family tabela + tier defaults decide. Caller treats nulo como "unknown -> smpequeno
  return null;
}

// Vision-capable Ollama families.
function ollamaSupportsImages(id: string): boolean {
  const s = id.toLowerCase();
  return /llava|bakllava|moondream|llama3\.2-vision|llama-3\.2-vision|gemma3|minicpm-v|qwen2\.5-vl|qwen2-vl|pixtral/.test(s);
}

export function getModelCapabilities(modelId: string, isOllama: boolean): ModelCapabilities {
  const id = modelId || '';
  const lower = id.toLowerCase();

  if (isOllama) {
    const size = parseOllamaSize(id);
    // Default para pequeno quando tamanho é unknown (safer para memory/context).
    const tier: ModelTier = (size != null && size >= 13) ? 'local-large' : 'local-small';
    const b = TIER_BUDGETS[tier];
    // Family-specific native contexto janela osobrescrever
    let maxCtx = b.max;
    for (const [pat, ctx] of KNOWN_OLLAMA_NATIVE_CTX) {
      if (pat.test(id)) { maxCtx = ctx; break; }
    }
    return {
      tier,
      maxContextTokens: maxCtx,
      promptBudgetTokens: b.system,
      outputBudgetTokens: b.output,
      supportsXmlTags: tier === 'local-large',
      supportsImages: ollamaSupportsImages(id),
      name: id || 'ollama',
    };
  }

  if (isCloudIdentifier(id)) {
    const b = TIER_BUDGETS['cloud'];
    const supportsImages = lower.startsWith('gemini-') || lower.startsWith('claude-')
      || lower.startsWith('gpt-4o') || lower.startsWith('gpt-4.1') || lower.startsWith('gpt-5')
      || lower === 'refract' || lower.startsWith('refract-');
    return {
      tier: 'cloud',
      maxContextTokens: b.max,
      promptBudgetTokens: b.system,
      outputBudgetTokens: b.output,
      supportsXmlTags: true,
      supportsImages,
      name: id || 'cloud',
    };
  }

  // Groq-hosted: divide por size.
  if (isLargeGroqModel(id)) {
    const b = TIER_BUDGETS['cloud'];
    return {
      tier: 'cloud',
      maxContextTokens: b.max,
      promptBudgetTokens: b.system,
      outputBudgetTokens: b.output,
      supportsXmlTags: true,
      supportsImages: false,
      name: id,
    };
  }

  // Pequeno Groq models (llama-3.1-8b-instant, gemma-7b, etetc
  if (/\b(0\.5|1|2|3|4|7|8)b\b|\binstant\b/i.test(lower)) {
    const b = TIER_BUDGETS['local-small'];
    return {
      tier: 'local-small',
      maxContextTokens: b.max,
      promptBudgetTokens: b.system,
      outputBudgetTokens: b.output,
      supportsXmlTags: false,
      supportsImages: false,
      name: id,
    };
  }

  // Unknown -> conservative cloud assumption (custom providers são geralmente grande hosted).
  const b = TIER_BUDGETS['cloud'];
  return {
    tier: 'cloud',
    maxContextTokens: b.max,
    promptBudgetTokens: b.system,
    outputBudgetTokens: b.output,
    supportsXmlTags: true,
    supportsImages: false,
    name: id || 'unknown',
  };
}

export function selectPromptTier(modelId: string, isOllama: boolean): PromptTier {
  return getModelCapabilities(modelId, isOllama).tier === 'local-small' ? 'tiny' : 'full';
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

// Per-model max saída (completion) token ceiling para o OpenAI Chat Completions
// API. OpenAI rejects max_completion_tokens acima a model's documented limit com
// a 400 "max_tokens é também lgrande erro (see issue #298: gpt-4o caps saída at
// 16384, então o global 65536 padrão falhou em o muito primeiro rerequisição
//
// Documented saída caps (OpenAI docs, 2026-06):
//   gpt-5 / 5.1 / 5.2 / 5.4 / 5.5 (+ -mini/-nano) → 128000
//   o1 / o3 / o4 (+ -mini/-pro)                   → 100000
//   gpt-4.1 (+ -mini)                             → 32768
//   gpt-4o (+ -mini)                              → 16384
//   gpt-4-turbo / gpt-4-vision / gpt-3.5-turbo    → 4096
//   bare gpt-4 / 32k variants                     → 8192
//   unknown OpenAI-compatible id                  → 16384 (conservative)
// Todo modelo obtém an explicit cap então a future bump para o requested default
// can't silently reintroduce o 400 em gpt-5.x / o-series.
export function getOpenAiMaxOutput(modelId: string, requested: number): number {
  const id = (modelId || '').toLowerCase();
  let cap: number;
  if (/\bgpt-5/.test(id)) cap = 128000; // gpt-5.x family
  else if (/\bo[1-9]\b/.test(id) || /\bo[1-9]-/.test(id)) cap = 100000; // o1/o3/o4 reasoners
  else if (id.startsWith('gpt-4.1')) cap = 32768;
  else if (id.startsWith('gpt-4o')) cap = 16384;
  else if (id.startsWith('gpt-4-turbo') || id.startsWith('gpt-4-1106') || id.startsWith('gpt-4-0125') || id.startsWith('gpt-4-vision')) cap = 4096;
  else if (id.startsWith('gpt-3.5')) cap = 4096;
  else if (id.startsWith('gpt-4')) cap = 8192; // bare gpt-4 / 32k variants cap at 8192
  else cap = 16384; // unknown OpenAI-compatible id — conservative mas usable default
  return Math.min(requested, cap);
}

export type OpenAiReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

// Lowest-latency *valid* reasoning_effort para an OpenAI reasoning mmodelo ou null
// para non-reasoning models (gpt-4*, gpt-3.5) que rejeitar o param entirely.
//
// O supported define differs por family e OpenAI dropped `minimal` após o
// original gpt-5 line (see issue: gpt-5.4/5.5 rejeitar `minimal` com a 400). We
// escolher a low-latency nível o modelo actually accepts então TTFT stays lbaixo
//   - original gpt-5 / -mini / -nano      → minimal   (nenhum não supported)
//   - gpt-5.1 / 5.2 / 5.4 / 5.5 (chat)    → baixo       (minimal removed; baixo keeps light reasoning)
//   - gpt-5-codex / gpt-5.x-codex         → baixo       (nenhum nenhum nem minimal supported)
//   - gpt-5-pro                           → alto      (apenas alto é accepted)
//   - o1 / o3 / o4 (and -mini/-pro)       → baixo       (apenas low/medium/high)
// Qualquer coisa senão (gpt-4*, custom proxies)  → nulo      (omit o param).
export function getOpenAiReasoningEffort(modelId: string): OpenAiReasoningEffort | null {
  const id = (modelId || '').toLowerCase();

  // o-series reasoners: low/medium/high oapenas
  if (/\bo[1-9]\b/.test(id) || /\bo[1-9]-/.test(id)) return 'low';

  if (/\bgpt-5/.test(id)) {
    if (id.includes('gpt-5-pro') || id.includes('gpt-5.1-pro') || id.includes('gpt-5.2-pro')) return 'high'; // pro: alto apenas
    if (id.includes('codex')) return 'low'; // codex variants: não none/minimal
    // Original gpt-5 / gpt-5-mini / gpt-5-nano (Não 5.1+) keep `minimal`.
    if (/\bgpt-5(-mini|-nano)?(\b|-20)/.test(id) && !/\bgpt-5\.\d/.test(id)) return 'minimal';
    // gpt-5.1 / 5.2 / 5.4 / 5.5 e chat-latest: `minimal` removed; uso `low`.
    return 'low';
  }

  // gpt-4*, gpt-3.5, unknown — não a reasoning mmodelo omit o param.
  return null;
}

// Soltar oldest turns até o joined transcript fits o token budget. Maioria recente turns são preserved.
export function truncateTranscriptToFit(
  transcript: TranscriptTurn[],
  budgetTokens: number
): TranscriptTurn[] {
  if (!transcript?.length || budgetTokens <= 0) return transcript ?? [];
  const total = (turns: TranscriptTurn[]) => turns.reduce((s, t) => s + estimateTokens(t.text) + 6, 0);
  if (total(transcript) <= budgetTokens) return transcript;
  const kept = [...transcript];
  while (kept.length > 1 && total(kept) > budgetTokens) {
    kept.shift();
  }
  return kept;
}
