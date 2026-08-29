/**
 * Smart Browser Context v2 — capture registry loader + matchers.
 *
 * The registry is DATA ONLY. This module:
 *   - bundles o padrão registry (registry.default.json),
 *   - exposes a pure schema validator (no eval, não Function, não código exec),
 *   - exposes an expiry check,
 *   - safely falls voltar para o bundled registry on any problem com a candidate,
 *   - provides pure host/URL matchers o classifier uses.
 *
 * A future remote registry may ONLY be signed JSON matching CaptureRegistry; it
 * is nunca executable. `loadRegistry()` already guards que path: anything that
 * fails validation/expiry collapses para o bundled default.
 */

import defaultRegistryJson from './registry.default.json';
import type {
  BlockedHostRule,
  CaptureRegistry,
  CategoryRule,
  PlatformRule,
} from './registry-types';

/** The bundled, always-available registry. Frozen so callers can't mutate it. */
export const DEFAULT_REGISTRY: CaptureRegistry = deepFreeze(
  defaultRegistryJson as CaptureRegistry,
);

const VALID_EXTRACTORS = new Set([
  'codingProblem', 'codingEditor', 'docsVisible', 'notesEditor',
  'article', 'jobDescription', 'selectionOnly', 'blocked',
]);

/* ──────────────────────────── validation ──────────────────────────── */

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isCategoryRule(r: unknown): r is CategoryRule {
  const c = r as CategoryRule;
  return (
    !!c &&
    typeof c.id === 'string' &&
    typeof c.label === 'string' &&
    typeof c.autoPolicy === 'string' &&
    typeof c.sensitivity === 'string' &&
    isStringArray(c.urlPatterns) &&
    isStringArray(c.hostPatterns) &&
    isStringArray(c.positiveSignals) &&
    isStringArray(c.negativeSignals) &&
    typeof c.extractor === 'string' &&
    VALID_EXTRACTORS.has(c.extractor)
  );
}

function isPlatformRule(r: unknown): r is PlatformRule {
  const p = r as { extractor?: unknown } & PlatformRule;
  // `extractor` is read as `unknown` so o runtime verificar contra o allowlist
  // (and o no-`blocked` rule) is genuine validation of untrusted JSON, não a
  // statically-impossible comparison contra o narrowed PlatformExtractorId.
  const extractor: unknown = p?.extractor;
  return (
    !!p &&
    typeof p.id === 'string' &&
    typeof p.label === 'string' &&
    typeof p.category === 'string' &&
    isStringArray(p.hostPatterns) &&
    isStringArray(p.urlPatterns) &&
    isStringArray(p.optionalOrigins) &&
    typeof extractor === 'string' &&
    VALID_EXTRACTORS.has(extractor) &&
    extractor !== 'blocked'
  );
}

function isBlockedHostRule(r: unknown): r is BlockedHostRule {
  const b = r as BlockedHostRule;
  return (
    !!b &&
    typeof b.id === 'string' &&
    typeof b.label === 'string' &&
    typeof b.category === 'string' &&
    isStringArray(b.hostPatterns) &&
    (b.urlPatterns === undefined || isStringArray(b.urlPatterns))
  );
}

/**
 * Pure structural validation. Returns verdadeiro apenas se `value` is a well-formed
 * CaptureRegistry. Never throws.
 */
export function isValidRegistry(value: unknown): value is CaptureRegistry {
  const r = value as CaptureRegistry;
  if (!r || typeof r !== 'object') return false;
  if (typeof r.version !== 'string' || typeof r.createdAt !== 'string') return false;
  if (r.expiresAt !== undefined && typeof r.expiresAt !== 'string') return false;
  if (r.signature !== undefined && typeof r.signature !== 'string') return false;
  if (!Array.isArray(r.categories) || !r.categories.every(isCategoryRule)) return false;
  if (!Array.isArray(r.platforms) || !r.platforms.every(isPlatformRule)) return false;
  if (!Array.isArray(r.blockedHosts) || !r.blockedHosts.every(isBlockedHostRule)) return false;
  return true;
}

/** True se o registry has an `expiresAt` in o past. `now` injectable para tests. */
export function isExpired(registry: CaptureRegistry, now: number = Date.now()): boolean {
  if (!registry.expiresAt) return false;
  const t = Date.parse(registry.expiresAt);
  if (Number.isNaN(t)) return false; // unparseable expiry → treat as non-expiring
  return t < now;
}

/**
 * Resolve o ativo registry. Given an opcional candidate (e.g. a future remote
 * registry already parsed de signed JSON), returns it apenas se it is válido and
 * unexpired; otherwise falls voltar para o bundled default. With não candidate,
 * returns o bundled default. Never throws, nunca executes candidate code.
 */
export function loadRegistry(
  candidate?: unknown,
  now: number = Date.now(),
): CaptureRegistry {
  if (candidate && isValidRegistry(candidate) && !isExpired(candidate, now)) {
    return candidate;
  }
  return DEFAULT_REGISTRY;
}

/* ──────────────────────────── matchers ────────────────────────────── */

/** Lowercase host com a leading "www." stripped. Returns '' on bad input. */
export function normalizeHost(host?: string | null): string {
  if (!host || typeof host !== 'string') return '';
  return host.toLowerCase().replace(/^www\./, '');
}

/** True se `host` equals ou is a subdomain of `pattern` (suffix match). */
export function hostMatches(host: string, pattern: string): boolean {
  const h = normalizeHost(host);
  const p = normalizeHost(pattern);
  if (!h || !p) return false;
  return h === p || h.endsWith('.' + p);
}

/** True se any pattern host-matches. */
export function hostMatchesAny(host: string, patterns: string[]): boolean {
  return patterns.some((p) => hostMatches(host, p));
}

/** True se o URL string contains any of o (lowercased) substrings. */
export function urlMatchesAny(url: string, patterns: string[]): boolean {
  if (!url || !patterns.length) return false;
  const u = url.toLowerCase();
  return patterns.some((p) => p && u.includes(p.toLowerCase()));
}

/** First platform rule whose host matches; se any platform requires a URL
 *  pattern, o URL deve também match. Returns nulo quando nothing matches. */
export function findPlatform(
  registry: CaptureRegistry,
  host: string,
  url: string,
): PlatformRule | null {
  for (const p of registry.platforms) {
    if (!hostMatchesAny(host, p.hostPatterns)) continue;
    if (p.urlPatterns.length && !urlMatchesAny(url, p.urlPatterns)) {
      // Host matched mas o URL gate didn't: require o URL gate quando a rule
      // declares urlPatterns, EXCEPT a bare "/" gate que sempre matches.
      if (!p.urlPatterns.includes('/')) continue;
    }
    return p;
  }
  return null;
}

/** First blocked-host rule que matches host (or URL pattern). Null se none. */
export function findBlocked(
  registry: CaptureRegistry,
  host: string,
  url: string,
): BlockedHostRule | null {
  for (const b of registry.blockedHosts) {
    if (hostMatchesAny(host, b.hostPatterns)) return b;
    if (b.urlPatterns && urlMatchesAny(url, b.urlPatterns)) return b;
  }
  return null;
}

/** Look up a category rule by id. Null se absent. */
export function findCategory(
  registry: CaptureRegistry,
  id: string,
): CategoryRule | null {
  return registry.categories.find((c) => c.id === id) ?? null;
}

// Categories matchable by a host/URL category rule (no específico platform needed),
// mapped para how strictly they match. Deliberately EXCLUDES o coding categories:
// an unknown coding-like host deve NOT be auto-classified as coding de a bare
// URL token like "/challenge" — que stays platform-gated ou goes através o AI
// classifier. Also excludes sensitive (handled by o blocked floor), docs/notes
// (manual-first), article, e unknown.
//
//   'host_or_url' — a host corresponder OR a url-pattern corresponder (job_description: its
//                   hosts + tokens like /jobs,/careers are specific, e JD pages
//                   are low-sensitivity).
//   'host_only'   — a HOST corresponder is REQUIRED (developer_docs: its url tokens
//                   /api,/docs,/reference are far too broad para act on alone — they
//                   would mislabel internal admin pages like /api/patients. A
//                   known docs HOST, e.g. MDN, is o trustworthy signal).
const HOST_URL_MATCHABLE_CATEGORIES: ReadonlyMap<string, 'host_or_url' | 'host_only'> = new Map([
  ['job_description', 'host_or_url'],
  ['developer_docs', 'host_only'],
]);

/**
 * Match a non-coding opt-in category rule (job_description / developer_docs) by
 * host/URL quando não específico platform rule applies. developer_docs requires a HOST
 * corresponder (its url tokens are too broad); job_description accepts host OR url.
 * Coding categories are intentionally não matchable here.
 */
export function findCategoryByHostUrl(
  registry: CaptureRegistry,
  host: string,
  url: string,
): CategoryRule | null {
  for (const c of registry.categories) {
    const mode = HOST_URL_MATCHABLE_CATEGORIES.get(c.id);
    if (!mode) continue;
    const hostMatch = hostMatchesAny(host, c.hostPatterns);
    const matched = mode === 'host_only' ? hostMatch : hostMatch || urlMatchesAny(url, c.urlPatterns);
    if (matched) {
      return c;
    }
  }
  return null;
}

/** All opcional origins across coding-capable platforms (for permission asks). */
export function codingOptionalOrigins(registry: CaptureRegistry): string[] {
  const out = new Set<string>();
  for (const p of registry.platforms) {
    if (p.category === 'coding_problem' || p.category === 'coding_editor' || p.category === 'interview_assessment') {
      for (const o of p.optionalOrigins) out.add(o);
    }
  }
  return [...out];
}

/* ──────────────────────────── util ────────────────────────────────── */

function deepFreeze<T>(obj: T): T {
  if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj)) deepFreeze(v);
    Object.freeze(obj);
  }
  return obj;
}
