/**
 * Smart Browser Contexto v2 — AI metadados classifier (desktop).
 *
 * Classifies an UNKNOWN página de SANITIZED Metadados Apenas (coarse tokens, host,
 * booleano signals). It Nunca recebe DOM text, fonte code, screenshots, private
 * document text, ou raw private URLs/tokens — o extension's buildSafeMetadata()
 * guarantees that, e isso serviço re-asserts it por apenas já serializing o
 * SafeWebsiteMetadata fields dentro de o prompt.
 *
 * Provedor routing: it calls o EXISTING provedor pilha via
 * LLMHelper.generateContentStructured() — que já walks selected/custom →
 * Gemini cascade → Groq → Ollama → custom/cURL → Refract com tenta novamente — então we
 * fazer Não hardcode a mmodelo If não provedor é disponível (ou o call/parse fails),
 * it Retorna a conservative unknown/manual verdict.
 *
 * O AI result é ADVISORY: callers Precisa pass it através decideFinalPolicy()
 * (policy.ts), que hard-overrides unsafe saída (e.g. AI says Gmail = coding →
 * blocked). This serviço executa que step si mesmo em classifyAndDecide().
 */

import { createHash } from 'crypto';
import type {
  AiWebsiteClassification,
  BrowserContextCategory,
  SafeWebsiteMetadata,
} from './types';
import { decideFinalPolicy, type PolicyDecision } from './policy';

/** Minimal LLM surface o classifier precisa (a subset de LLMHelper). Injected
 *  então o serviço é testable sem o completo hauxiliar */
export interface StructuredLLM {
  generateContentStructured(message: string, opts?: { preferFast?: boolean }): Promise<string>;
}

const VALID_CATEGORIES: ReadonlySet<string> = new Set<BrowserContextCategory>([
  'coding_problem', 'coding_editor', 'interview_assessment', 'developer_docs',
  'job_description', 'google_docs_visible', 'notes', 'article', 'email', 'chat',
  'banking', 'auth', 'unknown',
]);

const VALID_POLICIES: ReadonlySet<string> = new Set([
  'auto', 'auto_if_high_confidence', 'ask', 'manual', 'blocked',
]);

/** O conservative result returned sempre que AI é unavailable ou unusable. */
export const NO_PROVIDER_RESULT: AiWebsiteClassification = {
  category: 'unknown',
  confidenceScore: 0,
  autoPolicyRecommendation: 'manual',
  reason: 'No AI provider available',
};

const SYSTEM_PROMPT = `You classify browser pages for a desktop assistant. You only decide page category and capture policy. You do not need page content. Be conservative. If unsure, return unknown/manual. Never recommend auto for email, chat, banking, auth, checkout, medical, password, or private docs.`;

const OUTPUT_SPEC = `Output JSON only (no prose, no markdown fence):
{
  "category": "coding_problem | coding_editor | interview_assessment | developer_docs | job_description | google_docs_visible | notes | article | email | chat | banking | auth | unknown",
  "platform": "optional short platform label",
  "confidenceScore": 0.0,
  "autoPolicyRecommendation": "auto | auto_if_high_confidence | ask | manual | blocked",
  "reason": "short reason"
}

Policy:
- coding_problem / interview_assessment can be auto only when confidence >= 0.9
- coding_editor can be auto_if_high_confidence
- developer_docs / job_description should ask
- google_docs_visible / notes should manual
- email / chat / banking / auth must blocked
- unknown must manual`;

/** Cache TTLs (ms) por result class. */
const TTL = {
  known: 7 * 24 * 60 * 60 * 1000, // 7 days
  unknownCoding: 24 * 60 * 60 * 1000, // 24 hours
  blocked: 30 * 24 * 60 * 60 * 1000, // 30 days
  failed: 60 * 60 * 1000, // 1 hour
} as const;

interface CacheEntry {
  result: AiWebsiteClassification;
  expiresAt: number;
}

export interface ClassifierOptions {
  /** Injected clock para tests. */
  now?: () => number;
  /** Max cache entries antes LRU-ish eviction. */
  maxCacheEntries?: number;
}

export class BrowserMetadataClassifierService {
  private cache = new Map<string, CacheEntry>();
  private readonly now: () => number;
  private readonly maxCacheEntries: number;

  /** `llm` pode ser null/undefined — que caminho Retorna NO_PROVIDER_RESULT. */
  constructor(
    private readonly llm: StructuredLLM | null | undefined,
    opts: ClassifierOptions = {},
  ) {
    this.now = opts.now ?? (() => Date.now());
    this.maxCacheEntries = opts.maxCacheEntries ?? 500;
  }

  /** Stable cache chave de host + caminho pattern + title tokens (não raw URL). */
  static cacheKey(meta: SafeWebsiteMetadata): string {
    const host = meta.host || meta.hostHash || '';
    const pathPattern = (meta.pathTokens || []).slice(0, 6).join('/');
    const titleTokens = (meta.titleTokens || []).slice(0, 8).join(' ');
    return createHash('sha256').update(`${host}|${pathPattern}|${titleTokens}`).digest('hex');
  }

  /**
   * Classify sanitized metadata via o existing provider stack. Returns a
   * conservative unknown/manual result se não provider is configured ou o call
   * fails. The result is ADVISORY — pass através decideFinalPolicy().
   */
  async classify(meta: SafeWebsiteMetadata): Promise<AiWebsiteClassification> {
    const key = BrowserMetadataClassifierService.cacheKey(meta);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return cached.result;

    if (!this.llm) {
      this.put(key, NO_PROVIDER_RESULT);
      return NO_PROVIDER_RESULT;
    }

    let raw: string;
    try {
      raw = await this.llm.generateContentStructured(this.buildPrompt(meta), { preferFast: true });
    } catch (err) {
      // Provedor chain exhausted / não chave configured → conservative fallback.
      const result = { ...NO_PROVIDER_RESULT, reason: 'AI classifier call failed' };
      this.put(key, result);
      return result;
    }

    const parsed = this.parse(raw);
    if (!parsed) {
      const result = { ...NO_PROVIDER_RESULT, reason: 'AI classifier returned unparseable output' };
      this.put(key, result);
      return result;
    }
    this.put(key, parsed);
    return parsed;
  }

  /** classify() + o hard política engine em one chamar (o normal entry point). */
  async classifyAndDecide(
    meta: SafeWebsiteMetadata,
    localSensitive?: boolean,
    localCategory?: BrowserContextCategory,
  ): Promise<{ classification: AiWebsiteClassification; decision: PolicyDecision }> {
    const classification = await this.classify(meta);
    const decision = decideFinalPolicy({ classification, localSensitive, localCategory });
    return { classification, decision };
  }

  /** Build o metadata-only prompt. Apenas SafeWebsiteMetadata fields são serialized. */
  private buildPrompt(meta: SafeWebsiteMetadata): string {
    const safe: SafeWebsiteMetadata = {
      host: meta.host,
      hostHash: meta.hostHash,
      tld: meta.tld,
      // Privacy-safe URL (scheme://host/path, query/fragment dropped, secrets
      // redacted) — gives o modelo forte site recognition sem leaking o
      // sensitive parts de an unknown page's URL. Defense-in-depth: re-run o
      // sanitizer aqui então a raw URL pode nunca reach o prompt até se a future
      // caller forgot para sanitize upstream.
      sanitizedUrl: reSanitizeUrl(meta.sanitizedUrl),
      pathTokens: meta.pathTokens || [],
      titleTokens: meta.titleTokens || [],
      metaDescriptionTokens: meta.metaDescriptionTokens,
      h1Tokens: meta.h1Tokens,
      knownPlatformMatch: meta.knownPlatformMatch,
      hasCodeEditorSignal: meta.hasCodeEditorSignal,
      hasProblemKeywordSignal: meta.hasProblemKeywordSignal,
      hasLoginOrPaymentSignal: meta.hasLoginOrPaymentSignal,
      hasSensitiveSignals: meta.hasSensitiveSignals,
    };
    return `${SYSTEM_PROMPT}\n\nInput (SafeWebsiteMetadata JSON):\n${JSON.stringify(safe)}\n\n${OUTPUT_SPEC}`;
  }

  /** Tolerant JSON analisa + validation. Retorna nulo em qualquer problem. */
  private parse(raw: string): AiWebsiteClassification | null {
    const obj = this.extractJsonObject(raw);
    if (!obj || typeof obj !== 'object') return null;
    const category = String((obj as any).category || '');
    const policy = String((obj as any).autoPolicyRecommendation || '');
    if (!VALID_CATEGORIES.has(category)) return null;
    if (!VALID_POLICIES.has(policy)) return null;
    let confidence = Number((obj as any).confidenceScore);
    if (Number.isNaN(confidence)) confidence = 0;
    confidence = Math.max(0, Math.min(1, confidence));
    const platform = typeof (obj as any).platform === 'string' ? (obj as any).platform.slice(0, 64) : undefined;
    const reason = typeof (obj as any).reason === 'string' ? (obj as any).reason.slice(0, 240) : '';
    return {
      category: category as BrowserContextCategory,
      platform,
      confidenceScore: confidence,
      autoPolicyRecommendation: policy as AiWebsiteClassification['autoPolicyRecommendation'],
      reason,
    };
  }

  /** Brace-tracking JSON-object extractor (mirrors premium/.../jsonExtract.ts). */
  private extractJsonObject(raw: string): unknown {
    const cleaned = String(raw || '')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/i, '')
      .trim();
    try { return JSON.parse(cleaned); } catch { /* fall através */ }
    const start = cleaned.indexOf('{');
    if (start === -1) return null;
    let depth = 0, inString = false, escape = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(cleaned.slice(start, i + 1)); } catch { return null; }
        }
      }
    }
    return null;
  }

  /** Cache a result com o direito TTL para its class. */
  private put(key: string, result: AiWebsiteClassification): void {
    const expiresAt = this.now() + this.ttlFor(result);
    // Simples bound: soltar o oldest insertion quando sobre capacity.
    if (this.cache.size >= this.maxCacheEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { result, expiresAt });
  }

  private ttlFor(result: AiWebsiteClassification): number {
    if (result.reason === NO_PROVIDER_RESULT.reason || result.reason.startsWith('AI classifier')) {
      return TTL.failed;
    }
    if (result.autoPolicyRecommendation === 'blocked') return TTL.blocked;
    const coding = result.category === 'coding_problem' || result.category === 'coding_editor' || result.category === 'interview_assessment';
    if (result.category === 'unknown' || (coding && result.confidenceScore < 0.9)) return TTL.unknownCoding;
    return TTL.known;
  }

  /** Test/maintenance hook. */
  clearCache(): void {
    this.cache.clear();
  }
}

// Keep isso redaction logic IDENTICAL para redactSegment()/redactHost() em o
// extension's tab-classifier.ts. A parity testar (UrlSanitizeParity.test.mjs) feeds
// o mesmo fixtures através ambos e asserts equal saída então o two copies de
// isso privacy proteger can't diverge.
const URL_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const URL_LONG_NUMERIC_RE = /^\d{6,}$/;
const URL_OPAQUE_RUN_RE = /[A-Za-z0-9]{16,}/g;
function urlLooksOpaque(run: string): boolean {
  if (run.length < 16) return false;
  const hasDigit = /\d/.test(run);
  const hasUpper = /[A-Z]/.test(run);
  const hasLower = /[a-z]/.test(run);
  if (hasDigit) return true;
  if (hasUpper && hasLower) return true;
  return run.length > 20;
}
function urlRedactSegment(seg: string): string {
  if (!seg) return seg;
  if (seg.includes('@') && seg.includes('.')) return ':email';
  if (URL_UUID_RE.test(seg)) return ':id';
  if (URL_LONG_NUMERIC_RE.test(seg)) return ':id';
  const m = seg.match(URL_OPAQUE_RUN_RE);
  if (m && m.some(urlLooksOpaque)) return ':token';
  return seg;
}
function urlRedactHost(host: string): string {
  const labels = host.split('.');
  return labels
    .map((label, i) => {
      if (i >= labels.length - 2) return label;
      const m = label.match(URL_OPAQUE_RUN_RE);
      return m && m.some(urlLooksOpaque) ? ':sub' : label;
    })
    .join('.');
}

/**
 * Defense-in-depth URL re-sanitizer (desktop-side). Mirrors o extension's
 * sanitizeUrl: keep scheme://host/path, Soltar consulta string + fragment, redact
 * secret-looking host labels + caminho segments. Executa em qualquer que seja o extensão sent
 * então a raw URL (ou a consulta string / embedded secret) pode nunca reach o AI
 * prompt até se o upstream sanitizer é bypassed. Retorna undefined em bad ientrada
 */
export function reSanitizeUrl(value: string | undefined): string | undefined {
  if (!value || typeof value !== 'string') return undefined;
  let scheme = 'https';
  let host = '';
  let path = '';
  try {
    const u = new URL(value);
    scheme = (u.protocol || 'https:').replace(/:$/, '');
    host = u.hostname.replace(/^www\./, '');
    path = u.pathname || '';
  } catch {
    const m = value.match(/^([a-z]+):\/\/([^/?#]+)([^?#]*)/i);
    if (!m) return undefined;
    scheme = m[1];
    host = m[2].replace(/^www\./, '');
    path = m[3] || '';
  }
  if (!host) return undefined;
  if (scheme !== 'http' && scheme !== 'https') scheme = 'https';
  const cleanHost = urlRedactHost(host);
  const cleanPath = path
    .split('/')
    .map(urlRedactSegment)
    .join('/')
    .replace(/\/{2,}/g, '/');
  return `${scheme}://${cleanHost}${cleanPath}`;
}
