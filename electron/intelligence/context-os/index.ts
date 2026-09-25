// Stub (build recovery): Context OS kernel surface consumed by
// ipcHandlers.ts (15+ call sites). Path resolution: the sibling imports
// './intelligence/context-os/EvidenceResolver' and
// './intelligence/context-os/evidencePack' already treat context-os as a
// DIRECTORY, so this stub is that directory's index.ts.
// Degraded: every gate fails SAFE (null contract, deny evidence, no govern,
// empty packs/claims, quiet clarification), so Context OS stays additive —
// a kernel absence can only narrow behavior to the legacy path, never break
// chat. All blocks below already treat null/false/empty as "legacy
// behavior, unchanged" (many wrapped in try/catch failing open).
// Shape notes (every name + arity READ from ipcHandlers.ts call sites):
// - buildTurnContractIfEnabled({...14 fields...}, :2552) -> null (contract
//   missing => legacy path decides alone).
// - ProfileEvidenceService.retrieveEvidence is SYNC (:2587, :3141, :3849 —
//   never awaited, fields read inline: turnId/packId/requestedProperty/
//   items.length).
// - checkImpossibleEvidenceState(pack, profileContextPolicy) -> { ok,
//   violations: [{ code, sourceKind }] } (:2594, :3148, :3171-3180).
// - clarificationShortCircuitEnabled() zero-arg (:2979, :3251, :17813);
//   clarificationIsActionable({ sourceAuthority, hasReferenceFiles }) (:2986).
// - buildSourceClarification({ hasReferenceFiles, hasProfileFacts,
//   hasLiveTranscript }) -> string sent as stream tokens (:3019).
// - buildContextOsTrace({ contract, sourceAuthority, question,
//   usedSources?, finalAction }) (:3038 with usedSources, :3076 without);
//   logContextOsTrace(trace) noop.
// - allowsEvidence(contract, kind) called with 'profile_resume' /
//   'profile_project' / 'profile_jd' (:3109-3111) -> false.
// - TurnEvidenceCoordinator.resolve({ decision, contract,
//   retrieveReferenceEvidence?, retrieveProfileEvidence? }) is AWAITED
//   (:3873) -> { pack, failures: [{ family, reason }] } (:3888, :3911-3915).
// - packGovernsGeneration({ answerPolicy, sourceAuthority,
//   hasReferenceFiles }) -> false (:3900).
// - toRecalledMemoryEvidence(memories, contract) + renderHindsightRecallBlock
//   -> '' so the legacy <long_term_memory> block is used (:3670-3676).
// - textCanProveProperty(block, requestedProperty) -> FALSE (fail-closed):
//   no prover exists in this stub, so text proves nothing; the caller
//   (ipcHandlers.ts) downgrades to the honest refusal line via
//   buildInsufficientPropertyAnswer. Fail-closed matches every sibling gate.
// - buildInsufficientPropertyAnswer({ property }) -> honest string (only
//   reachable when the gate above fires, i.e. never via this stub).
// - buildAssistantClaims({ answer, contract, evidencePack }) -> [] (a stub
//   cannot verify claims; persisting none is the memory-safe choice —
//   unverified claims must never re-enter prompts) (:6084-6093).
// - parseModeSnippets(block) -> [] (call site falls back to the whole
//   captured block when snippets is empty) (:6056-6057).
// - getContextOsBenchmarkAudit() -> [] ; clearContextOsBenchmarkAudit()
//   noop (:18486-18491).
// - Types TurnContextContract / ContextOsGenerationContext / EvidencePack
//   cover every field read on them (memoryReadPolicy, allowedSources,
//   evidencePack.items/answerPolicy, retrievedBlockRaw, govern, ...).
import type { EvidencePack, EvidenceItem } from './evidencePack';

export type { EvidencePack, EvidenceItem } from './evidencePack';

export interface TurnContextSourceCapability {
  sourceKind: string;
  [key: string]: unknown;
}

export interface TurnContextContract {
  turnId: string;
  surface: string;
  activeModeId: string | null;
  activeModeName?: string | null;
  answerShape: string;
  sourceOwner: string;
  sourceAuthority?: string | null;
  requestedProperty: string;
  allowedSources: TurnContextSourceCapability[];
  forbiddenSources: unknown;
  memoryWritePolicy: unknown;
  memoryReadPolicy: {
    allowPriorAssistantFacts: boolean;
    allowHindsight: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ContextOsGenerationContext {
  contract: TurnContextContract | null;
  turnQuestion: string;
  evidencePack: EvidencePack;
  modeSnapshot: {
    modeId: string | null;
    modeName: string | null;
    sourceAuthority: string;
    [key: string]: unknown;
  };
  turnSourceDecision: unknown;
  govern: boolean;
  retrievedBlockRaw?: string;
  [key: string]: unknown;
}

export interface BuildTurnContractArgs {
  surface?: string;
  question?: string;
  activeModeId?: string | null;
  activeModeName?: string | null;
  sourceAuthority?: string | null;
  answerType?: string;
  plannerVoicePerspective?: string;
  hasReferenceFiles?: boolean;
  hasProfileFacts?: boolean;
  hasLiveTranscript?: boolean;
  userExplicitSource?: unknown;
  turnSourceDecision?: unknown;
  turnId?: string;
  [key: string]: unknown;
}

export interface ProfileEvidenceArgs {
  question?: string;
  contract?: TurnContextContract | null;
  profile?: unknown;
  jobDescription?: unknown;
  answerType?: string;
  [key: string]: unknown;
}

export interface ImpossibilityViolation {
  code: string;
  sourceKind: string;
  [key: string]: unknown;
}

export interface ClarificationActionableArgs {
  sourceAuthority?: string | null;
  hasReferenceFiles?: boolean;
  [key: string]: unknown;
}

export interface SourceClarificationArgs {
  hasReferenceFiles?: boolean;
  hasProfileFacts?: boolean;
  hasLiveTranscript?: boolean;
  [key: string]: unknown;
}

export interface ContextOsTraceArgs {
  contract?: TurnContextContract | null;
  sourceAuthority?: unknown;
  question?: string;
  usedSources?: unknown[];
  finalAction?: string;
  [key: string]: unknown;
}

export interface ContextOsTrace {
  [key: string]: unknown;
}

export interface CoordinatorFailure {
  family: string;
  reason: string;
  [key: string]: unknown;
}

export interface CoordinatorResolveArgs {
  decision?: unknown;
  contract?: TurnContextContract | null;
  retrieveReferenceEvidence?: (() => unknown) | undefined;
  retrieveProfileEvidence?: (() => unknown) | undefined;
  [key: string]: unknown;
}

export interface PackGovernsArgs {
  answerPolicy?: unknown;
  sourceAuthority?: unknown;
  hasReferenceFiles?: boolean;
  [key: string]: unknown;
}

export interface RecalledMemoryEvidence {
  [key: string]: unknown;
}

export interface AssistantClaim {
  claimId: string;
  turnId: string;
  claimText: string;
  sourceOwner: string;
  requestedProperty: string;
  validationStatus: string;
  evidenceIds: string[];
  [key: string]: unknown;
}

export interface BuildAssistantClaimsArgs {
  answer: string;
  contract: { turnId: string; sourceOwner: string; requestedProperty: string };
  evidencePack: EvidencePack;
  [key: string]: unknown;
}

export interface ModeSnippet {
  text: string;
  [key: string]: unknown;
}

export interface ContextOsBenchmarkRecord {
  [key: string]: unknown;
}

export function buildTurnContractIfEnabled(_args: BuildTurnContractArgs): null {
  return null;
}

export class ProfileEvidenceService {
  retrieveEvidence(_args: ProfileEvidenceArgs): EvidencePack {
    const turnId = typeof _args.contract?.turnId === 'string' ? _args.contract.turnId : '';
    return {
      packId: turnId ? `${turnId}:profile:empty:1` : 'profile:empty:1',
      version: 1,
      turnId,
      sourceOwner: '',
      requestedProperty: 'unknown',
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
      answerPolicy: 'refuse_insufficient_evidence',
      cards: [],
      govern: false,
    };
  }
}

export function checkImpossibleEvidenceState(
  _pack: EvidencePack,
  _profileContextPolicy: unknown,
): { ok: boolean; violations: ImpossibilityViolation[] } {
  return { ok: true, violations: [] };
}

export function clarificationShortCircuitEnabled(): boolean {
  return false;
}

export function clarificationIsActionable(_args: ClarificationActionableArgs): boolean {
  return false;
}

export function buildSourceClarification(_args: SourceClarificationArgs): string {
  return '';
}

export function buildContextOsTrace(_args: ContextOsTraceArgs): ContextOsTrace {
  return {};
}

export function logContextOsTrace(_trace: ContextOsTrace): void {}

export function allowsEvidence(
  _contract: TurnContextContract | null,
  _kind: string,
): boolean {
  return false;
}

export class TurnEvidenceCoordinator {
  async resolve(_args: CoordinatorResolveArgs): Promise<{
    pack: EvidencePack;
    failures: CoordinatorFailure[];
  }> {
    const turnId = typeof _args.contract?.turnId === 'string' ? _args.contract.turnId : '';
    return {
      pack: {
        packId: turnId ? `${turnId}:coordinator:empty:1` : 'coordinator:empty:1',
        version: 1,
        turnId,
        sourceOwner: '',
        requestedProperty: 'unknown',
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
        answerPolicy: 'refuse_insufficient_evidence',
        cards: [],
        govern: false,
      },
      failures: [],
    };
  }
}

export function packGovernsGeneration(_args: PackGovernsArgs): boolean {
  return false;
}

export function toRecalledMemoryEvidence(
  _memories: unknown,
  _contract: TurnContextContract | null,
): RecalledMemoryEvidence[] {
  return [];
}

export function renderHindsightRecallBlock(_evidence: unknown): string {
  return '';
}

export function textCanProveProperty(_block: string, _property: unknown): boolean {
  return false;
}

export function buildInsufficientPropertyAnswer(_args: { property?: unknown }): string {
  return 'This is not directly mentioned in the uploaded material.';
}

export function buildAssistantClaims(_args: BuildAssistantClaimsArgs): AssistantClaim[] {
  return [];
}

export function parseModeSnippets(_block: string): ModeSnippet[] {
  return [];
}

export function getContextOsBenchmarkAudit(): ContextOsBenchmarkRecord[] {
  return [];
}

export function clearContextOsBenchmarkAudit(): void {}
