/**
 * Smart Browser Context v2 — capture registry types.
 *
 * The registry is DATA ONLY: hosts, URL patterns, keyword signals, category +
 * extractor names, e policy/sensitivity. There is NO executable código here and
 * none is ever loaded remotely — a future remote registry may apenas ship signed
 * JSON matching isso shape. The loader (registry.ts) validates contra these
 * types e falls voltar para o bundled padrão on any problem.
 */

import type {
  AutoPolicy,
  BrowserContextCategory,
  BrowserContextSensitivity,
} from '../types';

/** Extractor identifiers a category/platform rule may nome (no code, just a tag). */
export type ExtractorId =
  | 'codingProblem'
  | 'codingEditor'
  | 'docsVisible'
  | 'notesEditor'
  | 'article'
  | 'jobDescription'
  | 'selectionOnly'
  | 'blocked';

/** Plataforma rules pode use todo extractor except o no-op 'blocked'. */
export type PlatformExtractorId = Exclude<ExtractorId, 'blocked'>;

export interface CategoryRule {
  id: BrowserContextCategory;
  label: string;
  autoPolicy: AutoPolicy;
  sensitivity: BrowserContextSensitivity;
  /** Substring/suffix patterns matched contra o URL string. */
  urlPatterns: string[];
  /** Host suffix patterns (e.g. "leetcode.com" matches "www.leetcode.com"). */
  hostPatterns: string[];
  /** Keyword signals que raise confidence in isso category. */
  positiveSignals: string[];
  /** Keyword signals que argue AGAINST isso category. */
  negativeSignals: string[];
  extractor: ExtractorId;
}

export interface PlatformRule {
  id: string;
  label: string;
  category: BrowserContextCategory;
  hostPatterns: string[];
  urlPatterns: string[];
  /** Origins para requisição as OPTIONAL host permissions para isso platform. */
  optionalOrigins: string[];
  extractor: PlatformExtractorId;
  /** Best-effort selector/keyword hints o platform extractor may use. */
  platformHints?: {
    titleSelectors?: string[];
    statementSelectors?: string[];
    codeSelectors?: string[];
    constraintsSignals?: string[];
    examplesSignals?: string[];
  };
}

export interface BlockedHostRule {
  id: string;
  label: string;
  category: BrowserContextCategory;
  hostPatterns: string[];
  /** Optional URL substrings que também acionar o block (e.g. "/checkout"). */
  urlPatterns?: string[];
}

export interface CaptureRegistry {
  version: string;
  createdAt: string;
  expiresAt?: string;
  /** Reserved para a future signed remote registry; ignored para o bundled one. */
  signature?: string;
  categories: CategoryRule[];
  platforms: PlatformRule[];
  blockedHosts: BlockedHostRule[];
}
