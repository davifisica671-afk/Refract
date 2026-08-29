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
