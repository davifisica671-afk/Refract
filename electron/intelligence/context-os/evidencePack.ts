// Stub (build recovery): typed evidence-pack helpers for the Context OS
// multi-family coordinator path (ipcHandlers.ts ~3812).
// Degraded: every pack is empty and non-governing — callers fall through to
// the legacy raw-text paths (the coordinator treats an empty pack as
// "the evidence system has nothing to add").
// Shape notes (READ-first adaptations vs the plan sketch):
// - The single call site passes { turnId, sourceOwner, requestedProperty,
//   answerPolicy: 'refuse_insufficient_evidence' } and feeds the result into
//   TurnEvidenceCoordinator.retrieveReferenceEvidence (typed as EvidencePack).
//   The returned object is therefore a FULL EvidencePack (items/rejected/
//   coverage/conflicts included), not just { cards, govern }.
// - EvidencePack/EvidenceItem live here (single source of truth);
//   context-os/index.ts re-exports the types (type-only, no runtime cycle).
// - Default answerPolicy is 'refuse_insufficient_evidence': an empty pack
//   refuses — matching the real path's empty-pack semantics and the
//   `packGovernsGeneration` stub (which returns false regardless).
export interface EvidenceItem {
  evidenceId: string;
  sourceKind: string;
  sourceId: string;
  sourceOwner: string;
  authority: string;
  trustLevel: string;
  text: string;
  pointer?: { section?: string; [key: string]: unknown };
  supports?: { property?: unknown; [key: string]: unknown };
  score?: { final?: number; [key: string]: unknown };
  reasonIncluded?: string;
  [key: string]: unknown;
}

export interface EvidenceCoverage {
  hasDirectEvidence: boolean;
  propertySatisfied: boolean;
  entityMatched: boolean;
  sourceOwnerSatisfied: boolean;
  confidence: number;
  [key: string]: unknown;
}

export interface EvidencePack {
  packId: string;
  version: number;
  turnId: string;
  sourceOwner: string;
  requestedProperty: string;
  items: EvidenceItem[];
  rejected: unknown[];
  coverage: EvidenceCoverage;
  conflicts: unknown[];
  answerPolicy: string;
  // Optional: the inline verify-pack literal at ipcHandlers.ts ~6071 builds
  // an EvidencePack without these (pre-existing call-site code, STUB ONLY
  // rule forbids editing it), so they must stay optional on the type even
  // though emptyEvidencePack always sets them.
  cards?: unknown[];
  govern?: boolean;
  [key: string]: unknown;
}

export interface EmptyEvidencePackArgs {
  turnId?: string;
  sourceOwner?: string;
  requestedProperty?: string;
  answerPolicy?: string;
}

export function emptyEvidencePack(args: EmptyEvidencePackArgs): EvidencePack {
  const turnId = args.turnId ?? '';
  return {
    ...args,
    packId: turnId ? `${turnId}:empty:1` : 'empty:1',
    version: 1,
    turnId,
    sourceOwner: args.sourceOwner ?? '',
    requestedProperty: args.requestedProperty ?? 'unknown',
    items: [],
    rejected: [],
    coverage: {
      hasDirectEvidence: false,
      propertySatisfied: false,
      entityMatched: false,
      sourceOwnerSatisfied: true,
      confidence: 0,
    },
    conflicts: [],
    answerPolicy: args.answerPolicy ?? 'refuse_insufficient_evidence',
    cards: [],
    govern: false,
  };
}
