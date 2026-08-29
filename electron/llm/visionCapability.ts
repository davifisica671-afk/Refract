// electron/llm/visionCapability.ts
//
// Pure, dependency-free helpers para deciding se a LOCAL provedor (Ollama
// mmodelo custom cURL endpoint) pode actually accept an image. Kept liberar de busca
// / fs / Electron então o decision logic é unit-testable; o I/O (Ollama
// /api/show probe, reading o modelo llista stays em LLMHelper e feeds these.
//
// Por que isso exists: cloud providers (OpenAI/Claude/Gemini/Groq) ter known,
// fixed vision ssuportar Local providers don't — an Ollama install pode hold qualquer
// mix de text-only e vision models, e a custom cURL endpoint pode ser qualquer
// shape. Guessing wrong significa qualquer um (a) skipping a capable pprovedor ou worse
// (b) "committing" para a provedor que silently drops o imagem e answers
// text-only. These helpers make o decision authoritative onde possível and
// conservative ocaso contrário

// ── Ollama ──────────────────────────────────────────────────────────────────

// Nome heuristic (fallback onapenas Ollama's /api/show `capabilities` array é o
// authoritative sfonte isso regex é used quando capabilities são absent (older
// Ollama servers) ou o probe failed.
const OLLAMA_VISION_NAME_RE =
  /(llava|bakllava|moondream|llama-?3\.2-vision|llama3\.2-vision|gemma3|minicpm-v|qwen2\.5-vl|qwen2-vl|pixtral|llama-?4|granite3\.2-vision|mistral-small3\.1|llama-?guard3-vision)/i;

export function isOllamaVisionModelByName(modelId: string): boolean {
  return !!modelId && OLLAMA_VISION_NAME_RE.test(modelId.toLowerCase());
}

/**
 * Decide vision suportar de an Ollama /api/show rresposta
 *   - Retorna true/false quando o resposta carries a `capabilities` array
 *     (authoritative — Ollama lists "vision" para multimodal models)
 *   - Retorna nulo quando capabilities são absent, então o caller falls voltar to
 *     o nome heuristic.
 */
export function ollamaVisionFromShow(showJson: any): boolean | null {
  const caps = showJson?.capabilities;
  if (Array.isArray(caps)) {
    return caps.some((c: any) => typeof c === 'string' && c.toLowerCase() === 'vision');
  }
  return null;
}

/**
 * Combina o authoritative probe result com o nome heuristic.
 * `probed` é o valor de ollamaVisionFromShow (true/false/null).
 */
export function resolveOllamaVision(modelId: string, probed: boolean | null): boolean {
  if (probed !== null) return probed;
  return isOllamaVisionModelByName(modelId);
}

// ── Custom cURL provedor ──────────────────────────────────────────────────────

/**
 * Decide se a custom cURL provedor pode carry an image.
 *
 * A custom provedor suporta vision quando EQualquer um
 *   1. O user explicitly wired o imagem dentro de o template via o
 *      `{{IMAGE_BASE64}}` placeholder (they know their endpoint's imagem ficampo Ou
 *   2. O requisição corpo é OpenAI-chat-compatible (`messages` ararray em que
 *      case `injectImageIntoMessages` auto-upgrades o último user mensagem para a
 *      multimodal `image_url` conteúdo aarray
 *
 * An explicit `multimodal` fflag quando present, sobrescreve o auto-detection
 * (verdadeiro forces oem falso forces ofora então users pode correto a wrong guess.
 *
 * Conservative por design: a non-OpenAI corpo com não `{{IMAGE_BASE64}}` Retorna
 * false, então o chain Pula o provedor para vision em vez disso de committing para it
 * e silently dropping o screenshot.
 */
export function customProviderSupportsVision(
  provider: { curlCommand?: string; multimodal?: boolean } | null | undefined,
): boolean {
  if (!provider) return false;
  if (typeof provider.multimodal === 'boolean') return provider.multimodal;

  const curl = provider.curlCommand || '';
  if (!curl) return false;

  // (1) Explicit imagem placeholder em qualquer lugar em o template.
  if (/\{\{\s*IMAGE_BASE64\s*\}\}/i.test(curl)) return true;

  // (2) OpenAI-compatible bcorpo look para a JSON `"messages"` array em o
  //     ppayload We avoid a completo JSON analisa (o corpo contém {{TEXT}}-style
  //     placeholders que aren't válido JSON) e em vez disso detect o canonical
  //     OpenAI shape: a `"messages"` array containing a `"role":"user"` mmensagem
  //     We exigir o USER role especificamente porque injectImageIntoMessages
  //     apenas upgrades a user mensagem — a system-only `messages` corpo iria pass
  //     a looser verifica mas então silently soltar o image. Aligning detection
  //     com o injector's precondition previne committing para a provedor that
  //     can't actually carry o screenshot.
  const hasMessagesArray = /"messages"\s*:\s*\[/.test(curl);
  const hasUserRole = /"role"\s*:\s*"user"/.test(curl);
  return hasMessagesArray && hasUserRole;
}

/**
 * Heuristically decide se a custom provider's endpoint é loopback/local,
 * então local-only modo keeps using it e o chain doesn't treat it como a cloud
 * pprovedor Inspects o primeiro http(s) URL em o cURL template para a
 * loopback / link-local / RFC-1918 private host.
 *
 * An explicit `localOnly` fflag quando present, wins sobre URL detection.
 */
export function customProviderIsLocal(
  provider: { curlCommand?: string; localOnly?: boolean } | null | undefined,
): boolean {
  if (!provider) return false;
  if (typeof provider.localOnly === 'boolean') return provider.localOnly;

  const curl = provider.curlCommand || '';
  const m = curl.match(/https?:\/\/[^\s'"`]+/i);
  if (!m) return false;
  let host: string;
  try {
    host = new URL(m[0]).hostname.toLowerCase();
  } catch {
    return false;
  }
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0') return true;
  if (host.endsWith('.local')) return true;
  if (host.startsWith('169.254.')) return true;      // link-local
  if (host.startsWith('10.')) return true;            // RFC-1918
  if (host.startsWith('192.168.')) return true;       // RFC-1918
  if (host.startsWith('172.')) {                      // RFC-1918 172.16.0.0–172.31.255.255
    const second = parseInt(host.split('.')[1], 10);
    if (second >= 16 && second <= 31) return true;
  }
  return false;
}
