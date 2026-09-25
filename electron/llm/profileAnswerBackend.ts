import {
  logManualProfileRoute,
  profileFactsReady,
  tryBuildManualProfileFastPathAnswer,
  type ManualProfileRouteLog,
  type ManualProfileRouteResult,
  type ManualProfileSource,
  type StructuredJobFacts,
  type StructuredProfileFacts,
} from './manualProfileIntelligence';

type MaybeStructured<T> = T | null | undefined;

interface StructuredDocument<T> {
  structured_data?: MaybeStructured<T>;
}

export interface ProfileAnswerBackendOrchestrator {
  activeResume?: StructuredDocument<StructuredProfileFacts> | null;
  activeJD?: StructuredDocument<StructuredJobFacts> | null;
}

export interface BuildManualProfileBackendAnswerInput {
  question: string;
  orchestrator?: ProfileAnswerBackendOrchestrator | null;
  source?: ManualProfileSource;
}

export interface BuildManualProfileBackendAnswerResult {
  route: ManualProfileRouteResult | null;
  routeLog: ManualProfileRouteLog;
  profileFactsReady: boolean;
}

const activeResumeFacts = (
  orchestrator?: ProfileAnswerBackendOrchestrator | null,
): MaybeStructured<StructuredProfileFacts> => orchestrator?.activeResume?.structured_data ?? null;

const activeJobFacts = (
  orchestrator?: ProfileAnswerBackendOrchestrator | null,
): MaybeStructured<StructuredJobFacts> => orchestrator?.activeJD?.structured_data ?? null;

export const buildManualProfileBackendAnswer = ({
  question,
  orchestrator,
  source = 'manual_input',
}: BuildManualProfileBackendAnswerInput): BuildManualProfileBackendAnswerResult => {
  const profile = activeResumeFacts(orchestrator);
  const jobDescription = activeJobFacts(orchestrator);
  const ready = profileFactsReady(profile);
  const route = tryBuildManualProfileFastPathAnswer({
    question,
    profile,
    jobDescription,
    source,
  });

  return {
    route,
    routeLog: logManualProfileRoute({
      source,
      question,
      route,
      profileFactsReady: ready,
    }),
    profileFactsReady: ready,
  };
};

// ── Build-recovery degraded export (appended 2026-09-25; existing code above untouched) ──
// ipcHandlers destructures { route, routeLog } (:3299) and reads
// routeLog.profileFactsReady (:3309); every evidenceRoute shape read (:3316-:3377)
// sits inside `if (evidenceRoute)`, so a null route skips the JIT prompt,
// diagnostics, and attribution paths and the turn falls back to the non-evidence
// context. Null (not a fabricated route) is the honest value: the
// ManualProfileRouteResult behind a real route carries no answerShape/sourceOwner
// fields, so delegating to buildManualProfileBackendAnswer would trade this TS2305
// for TS2339s at the shape reads. `orchestrator` is intentionally unconsumed
// (typed unknown so every caller shape passes). Never throws.
export interface ManualProfileEvidenceRoute extends ManualProfileRouteResult {
  // Planned shape inferred from the ipcHandlers reads: answerShape (:3317),
  // sourceOwner (:3318/:3347), items[{ sourceKind }] (:3370/:3377). answerType /
  // selectedContextLayers / excludedContextLayers are inherited.
  answerShape: string;
  sourceOwner: string;
  items: Array<{ sourceKind: string }>;
}

export interface BuildManualProfileEvidenceRouteResult {
  // Union with null (degraded value below is null): every evidenceRoute shape read
  // in ipcHandlers sits inside `if (evidenceRoute)`, which narrows to
  // ManualProfileEvidenceRoute — so the guarded reads typecheck without inventing
  // evidence, and at runtime the JIT prompt, diagnostics, and attribution paths are
  // skipped so the turn falls back to the non-evidence context.
  route: ManualProfileEvidenceRoute | null;
  routeLog: ReturnType<typeof logManualProfileRoute>;
  profileFactsReady: boolean;
}

export function buildManualProfileEvidenceRoute(input: {
  question: string;
  orchestrator?: unknown;
  source?: ManualProfileSource;
  answerType?: string;
  allowedSourceKinds?: string[];
}): BuildManualProfileEvidenceRouteResult {
  const source = input.source ?? 'manual_input';
  return {
    route: null,
    routeLog: logManualProfileRoute({
      source,
      question: input.question,
      route: null,
      profileFactsReady: false,
    }),
    profileFactsReady: false,
  };
}
