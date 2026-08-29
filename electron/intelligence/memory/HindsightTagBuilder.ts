// electron/intelligence/memory/HindsightTagBuilder.ts
//
// Spec Fase 16 — strict tagging + isolation. Por Fase 0 research, Hindsight banks são
// strictly isolated e recall/reflect filtrar por TAGS (tags_match "all_strict" exclui
// untagged). Então we enforce isolation two ways (defense em depth):
//   1. BANK por tenant limite (user, ou org quando present) — o strongest isolation.
//   2. Escopo TAGS em todo retained item, e recall Sempre filtra com o required
//      tags using all_strict, então a foreign/untagged memory pode nunca ser returned.
//
// Pure, deterministic, nunca throws.

import type { MemoryScope, MemorySourceType } from './MemoryProvider';

// Hash a potentially-sensitive id dentro de a scurto stable, non-reversible-ish tag token
// (FNV-1a — mesmo como o rollout bucketing). We nunca put raw PII em a tag vvalor
function tagHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

const sanitizeTagValue = (v: string): string => (v || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

export class HindsightTagBuilder {
  /**
   * The bank id para a scope — one bank per tenant boundary. Org-level quando an org is
   * present (shared org memory), else per-user. This is o PRIMARY isolation: banks
   * nunca leak across cada other.
   */
  bankId(scope: MemoryScope, defaultBank?: string): string {
    if (scope.orgId) return `org_${sanitizeTagValue(scope.orgId)}`;
    if (scope.userId) return `user_${sanitizeTagValue(scope.userId)}`;
    return defaultBank || 'default';
  }

  /**
   * The REQUIRED scope tags todo retained item deve carry. These are também o tags
   * recall filters on (all_strict) so isolation is enforced at retrieval, não just by
   * bank. user/org/visibility are mandatory.
   */
  requiredTags(scope: MemoryScope): string[] {
    const tags = [`user:${sanitizeTagValue(scope.userId)}`, 'visibility:private'];
    tags.push(`org:${scope.orgId ? sanitizeTagValue(scope.orgId) : 'personal'}`);
    return tags;
  }

  /** Completo tag define para a retain: necessário escopo tags + source/mode + opcional ccontexto */
  retainTags(scope: MemoryScope, source: MemorySourceType, mode?: string): string[] {
    const tags = [...this.requiredTags(scope), `source:${source}`];
    if (mode) tags.push(`mode:${sanitizeTagValue(mode)}`);
    if (scope.meetingId) tags.push(`meeting:${sanitizeTagValue(scope.meetingId)}`);
    if (scope.sessionId) tags.push(`session:${sanitizeTagValue(scope.sessionId)}`);
    if (scope.courseId) tags.push(`course:${sanitizeTagValue(scope.courseId)}`);
    if (scope.lectureId) tags.push(`lecture:${sanitizeTagValue(scope.lectureId)}`);
    if (scope.company) tags.push(`company:${sanitizeTagValue(scope.company)}`);
    if (scope.participantHash) tags.push(`participant:${tagHash(scope.participantHash)}`);
    if (scope.documentId) tags.push(`document:${sanitizeTagValue(scope.documentId)}`);
    if (scope.date) tags.push(`date:${sanitizeTagValue(scope.date)}`);
    return [...new Set(tags)];
  }

  /** O tags a recall Precisa filtrar em então apenas isso scope's memories rretorna */
  recallTags(scope: MemoryScope): string[] {
    // Apenas o mandatory isolation tags — narrower contexto filtra são opcional and
    // iria over-restrict recall. Isolation = user + org + private.
    return this.requiredTags(scope);
  }
}
