// electron/services/screen/VisionProviderRegistry.ts
//
// Constrói o ordered VisionProviderConfig[] consumed por VisionProviderFallbackChain.
//
// Cada entry knows:
//   - se o provedor é configured (API kchave runtime pcaminho
//   - se o selected modelo é vision-capable
//   - se o dados escopo política permite screenshots
//   - como para invocar o provedor com an optimized imagem + prompt
//
// O invocation lives em adaptador functions que chamar dentro de LLMHelper. We
// intentionally lazy-import LLMHelper então tests pode substituir isso registro
// sem booting o whole LLM spilha

import fs from 'node:fs/promises';
import type {
  VisionProviderConfig,
  VisionInvocationParams,
  VisionMode,
} from './VisionProviderFallbackChain';
import { CredentialsManager } from '../CredentialsManager';

export interface VisionProviderBuildInputs {
  mode: VisionMode;
  localOnly: boolean;
  scopeAllowsScreenshots: boolean;
}

/**
 * Produce o ordered lista de vision providers para o given mmodo Ordenar ié
 *   vision_first / vision_only: Refract → OpenAI → Gemini Flash-Lite →
 *                                Gemini Flash → Claude → Gemini Pro → Groq Scout
 *                                → Ollama → Codex → Custom
 *   private_vision: Ollama → Codex → local Custom apenas
 */
export function buildVisionProviders(inputs: VisionProviderBuildInputs): VisionProviderConfig[] {
  const credentials = CredentialsManager.getInstance();
  const providers: VisionProviderConfig[] = [];

  const cloudAllowed = inputs.mode !== 'private_vision';

  if (cloudAllowed) {
    providers.push(refract(credentials, inputs));
    providers.push(openai(credentials, inputs));
    // Gemini cascade leads com flash-lite (cheapest/fastest), então flash.
    providers.push(geminiFlashLite(credentials, inputs));
    providers.push(geminiFlash(credentials, inputs));
    providers.push(claude(credentials, inputs));
    providers.push(geminiPro(credentials, inputs));
    providers.push(groqScout(credentials, inputs));
  }

  // Local providers — sempre allowed, incluindo em private_vision.
  providers.push(ollama(credentials, inputs));
  providers.push(codex(credentials, inputs));
  providers.push(custom(credentials, inputs));

  return providers.filter(p => p !== null) as VisionProviderConfig[];
}

// ─── Provedor builders ────────────────────────────────────────────────────

function refract(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const apiKey = creds.getRefractApiKey();
  return {
    id: 'refract',
    displayName: 'Refract API',
    modelId: 'refract',
    isLocal: false,
    isConfigured: !!apiKey,
    supportsVision: !!apiKey,
    scopeAllowsScreenshots: true,
    hint: 'refract',
    invoke: async (p) => callLLMHelperVision('refract', p),
  };
}

function openai(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const apiKey = creds.getOpenaiApiKey();
  return {
    id: 'openai',
    displayName: 'OpenAI',
    modelId: 'gpt-4o',
    isLocal: false,
    isConfigured: !!apiKey,
    supportsVision: !!apiKey,
    scopeAllowsScreenshots: true,
    hint: 'openai',
    invoke: async (p) => callLLMHelperVision('openai', p),
  };
}

function geminiFlashLite(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const apiKey = creds.getGeminiApiKey();
  return {
    id: 'gemini_flash_lite',
    displayName: 'Gemini Flash-Lite',
    modelId: 'gemini-3.1-flash-lite',
    isLocal: false,
    isConfigured: !!apiKey,
    supportsVision: !!apiKey,
    scopeAllowsScreenshots: true,
    hint: 'gemini',
    invoke: async (p) => callLLMHelperVision('gemini_flash_lite', p),
  };
}

function geminiFlash(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const apiKey = creds.getGeminiApiKey();
  return {
    id: 'gemini_flash',
    displayName: 'Gemini Flash',
    modelId: 'gemini-3.5-flash',
    isLocal: false,
    isConfigured: !!apiKey,
    supportsVision: !!apiKey,
    scopeAllowsScreenshots: true,
    hint: 'gemini',
    invoke: async (p) => callLLMHelperVision('gemini_flash', p),
  };
}

function claude(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const apiKey = creds.getClaudeApiKey();
  return {
    id: 'claude',
    displayName: 'Claude',
    modelId: 'claude-sonnet-4-6',
    isLocal: false,
    isConfigured: !!apiKey,
    supportsVision: !!apiKey,
    scopeAllowsScreenshots: true,
    hint: 'claude',
    invoke: async (p) => callLLMHelperVision('claude', p),
  };
}

function geminiPro(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const apiKey = creds.getGeminiApiKey();
  return {
    id: 'gemini_pro',
    displayName: 'Gemini Pro',
    modelId: 'gemini-3.1-pro-preview',
    isLocal: false,
    isConfigured: !!apiKey,
    supportsVision: !!apiKey,
    scopeAllowsScreenshots: true,
    hint: 'gemini',
    invoke: async (p) => callLLMHelperVision('gemini_pro', p),
  };
}

function groqScout(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const apiKey = creds.getGroqApiKey();
  return {
    id: 'groq_scout',
    displayName: 'Groq Llama-4 Scout',
    modelId: 'meta-llama/llama-4-scout-17b-16e-instruct',
    isLocal: false,
    isConfigured: !!apiKey,
    supportsVision: !!apiKey,
    scopeAllowsScreenshots: true,
    hint: 'groq',
    invoke: async (p) => callLLMHelperVision('groq_scout', p),
  };
}

function ollama(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const baseUrl = (creds.getAllCredentials() as any)?.ollamaBaseUrl as string | undefined;
  const ollamaModel = (creds.getAllCredentials() as any)?.ollamaModel as string | undefined;
  const isVisionModel = ollamaModel ? isOllamaVisionModel(ollamaModel) : false;
  return {
    id: 'ollama',
    displayName: 'Ollama (local)',
    modelId: ollamaModel,
    isLocal: true,
    isConfigured: !!baseUrl && !!ollamaModel,
    supportsVision: isVisionModel,
    scopeAllowsScreenshots: true,
    hint: 'ollama',
    invoke: async (p) => callOllamaVision(baseUrl!, ollamaModel!, p),
  };
}

function codex(creds: CredentialsManager, _inputs: VisionProviderBuildInputs): VisionProviderConfig {
  const cliPath = (creds.getAllCredentials() as any)?.codexCliPath as string | undefined;
  // Codex CLI vision capability é não ainda verified através constrói — we configura
  // o provedor como disponível mas o vision flag é conservative. See ROADMAP.
  return {
    id: 'codex_cli',
    displayName: 'Codex CLI',
    modelId: (creds.getAllCredentials() as any)?.codexCliModel,
    isLocal: true,
    isConfigured: !!cliPath,
    supportsVision: false, // unverified; flip to verdadeiro quando CLI vision é confirmed end-to-end
    scopeAllowsScreenshots: true,
    hint: 'codex',
    invoke: async () => { throw new Error('Codex CLI vision unverified — capability disabled'); },
  };
}

function custom(creds: CredentialsManager, inputs: VisionProviderBuildInputs): VisionProviderConfig {
  // O ativo custom provedor lives em o live LLMHelper instance (define via
  // switchToCustom em main.ts). CredentialsManager armazena todos configured custom
  // providers; we apenas mostrar ativo one como a vision alvo então o chain
  // nunca silently calls a provedor o user didn't pescolher
  const customProviders = creds.getCustomProviders();
  // Prefer o explicitly-set ativo provedor se aqualquer fall voltar para o primeiro
  // configured entry então o registro remains útil quando LLMHelper hasn't sido
  // initialized ainda (e.g. durante unit tests).
  const fromHelper = readActiveCustomProviderSync();
  const active = fromHelper || customProviders[0];

  const multimodal = (active as any)?.multimodal === true;
  // Treat a provedor como local-only se explicitly flagged Ou se its URL targets
  // a loopback host. This keeps `private_vision` modo de silently calling a
  // public custom endpoint.
  const localOnly = isLocalOnlyCustomProvider(active);

  return {
    id: 'custom',
    displayName: active?.name || 'Custom Provider',
    modelId: (active as any)?.model,
    isLocal: localOnly,
    isConfigured: !!active,
    supportsVision: multimodal,
    scopeAllowsScreenshots: inputs.scopeAllowsScreenshots,
    hint: 'custom',
    invoke: async (p) => callLLMHelperVision('custom', p),
  };
}

function readActiveCustomProviderSync(): any | null {
  try {
    const g = global as any;
    if (typeof g.__refractGetLLMHelper === 'function') {
      const helper = g.__refractGetLLMHelper();
      if (helper && typeof helper.getActiveCustomProvider === 'function') {
        return helper.getActiveCustomProvider() || null;
      }
    }
  } catch {
    // ignorar
  }
  return null;
}

function isLocalOnlyCustomProvider(provider: any | undefined | null): boolean {
  if (!provider) return false;
  if (provider.localOnly === true) return true;
  // Inspecionar o cURL comando para a localhost / 127.0.0.1 / 0.0.0.0 / ::1 talvo
  const curl: string | undefined = provider.curlCommand;
  if (!curl) return false;
  try {
    const urlMatch = curl.match(/https?:\/\/([^\s'"`]+)/i);
    if (!urlMatch) return false;
    const host = new URL(urlMatch[0]).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0' || host === '::1' || host.endsWith('.local');
  } catch {
    return false;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

const OLLAMA_VISION_MODELS_RE = /(llava|bakllava|moondream|llama3\.2-vision|llama-3\.2-vision|gemma3|minicpm-v|qwen2\.5-vl|qwen2-vl|pixtral)/i;
export function isOllamaVisionModel(modelId: string): boolean {
  return OLLAMA_VISION_MODELS_RE.test(modelId);
}

/**
 * Call dentro de LLMHelper para executa a vision requisição contra o chosen cloud pprovedor
 * We funnel tudo através LLMHelper.streamChat então o auth, rtenta novamente and
 * per-provider payload shape são handled em one place.
 */
async function callLLMHelperVision(providerId: string, params: VisionInvocationParams): Promise<string> {
  const helper = await getActiveLLMHelper();
  if (!helper) throw new Error('LLMHelper not initialized');
  return helper.runVisionRequest(providerId, params.userPrompt, params.systemPrompt, params.optimized.path);
}

/**
 * Call a local Ollama vision mmodelo Uses o OpenAI-compatible /v1/chat/completions
 * endpoint at `${baseUrl}/v1/` com an image_url dados URL — supported por todo
 * vision-capable Ollama modelo we care sobre (llava family, qwen2.5-vl, etcetc
 */
async function callOllamaVision(baseUrl: string, model: string, params: VisionInvocationParams): Promise<string> {
  const { optimized, systemPrompt, userPrompt, signal } = params;
  const data = await fs.readFile(optimized.path);
  const dataUrl = `data:${optimized.mimeType};base64,${data.toString('base64')}`;
  const trimmedBase = baseUrl.replace(/\/+$/, '');
  const url = `${trimmedBase}/v1/chat/completions`;

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: [
          { type: 'text', text: userPrompt },
          { type: 'image_url', image_url: { url: dataUrl } },
        ],
      },
    ],
    stream: false,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Surface a classifiable erro então VisionProviderFallbackChain pode bucket it.
    throw new Error(`Ollama ${res.status}: ${text.substring(0, 200)}`);
  }

  const json: any = await res.json();
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((part: any) => (typeof part === 'string' ? part : part?.text || '')).join('');
  }
  throw new Error('Ollama returned empty content');
}

/**
 * Recupera o live LLMHelper instance. main.ts owns o LLMHelper; we expose
 * it via a global accessor função define para cima tlá If o accessor é missing,
 * retorna nulo e let o caller fail closed.
 */
async function getActiveLLMHelper(): Promise<any | null> {
  const g = global as any;
  if (typeof g.__refractGetLLMHelper === 'function') {
    try {
      return g.__refractGetLLMHelper();
    } catch {
      return null;
    }
  }
  return null;
}
