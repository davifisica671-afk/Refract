// Stub (build recovery): reference-evidence resolver for the Context OS
// multi-family coordinator path (ipcHandlers.ts ~3806,3818-3833).
// Degraded: resolves to an empty, non-governing pack (same fall-through as
// the no-active-mode branch at the call site).
// Shape notes (READ-first adaptations vs the plan sketch):
// - Constructor takes { getModeSnapshot, getReferenceFiles, hybridRetriever,
//   knowledgeManager, classifyQuestion, queryOkfCards } — typed as
//   Record<string, unknown> (most permissive safe value of the right type).
// - resolve() takes { turnId, question, sourceContract, activeMode,
//   requestedProperty, transcript } and returns { pack } — the call site
//   reads ONLY `resolution.pack`.
// - The dynamic import of ./evidencePack is kept (per plan) so this module
//   never forms a static edge into the pack helpers.
import type { EvidencePack } from './evidencePack';

export class EvidenceResolver {
  constructor(_opts: Record<string, unknown>) {}

  async resolve(_args: Record<string, unknown>): Promise<{ pack: EvidencePack }> {
    const { emptyEvidencePack } = await import('./evidencePack');
    return { pack: emptyEvidencePack({}) };
  }
}
