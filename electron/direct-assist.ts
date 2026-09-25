// Stub (build recovery): Direct Assist streaming service consumed by the
// 'direct-assist-stream' handler (ipcHandlers.ts ~157-161, ~7162-7405).
// Degraded: the service constructs, but stream() throws a typed unavailable
// error — the single caller iterates it inside try/catch and converts ANY
// failure (throw OR empty stream) into a graceful INCOMPLETE_STREAM error
// event plus map/listener cleanup, so there is no crash, hang, or unhandled
// rejection either way.
// Empty-vs-throw decision: THROW. Rationale — (1) honest: the service cannot
// produce anything, mirroring the OpenRouterReranker.rerankOrThrow degraded
// pattern from Task 3; (2) the typed message ('direct-assist unavailable')
// is preserved for any future caller that inspects the exception, whereas
// an empty stream discards the reason and yields the identical user-visible
// INCOMPLETE_STREAM error anyway; (3) the current caller provably handles
// the throw (catch at ~7376 sends a terminal error, finally at ~7396 cleans
// up) — verified by reading, not assumed.
// Shape notes (READ-first adaptations vs the plan sketch):
// - Constructor takes the LLMHelper instance (unknown here).
// - stream(request, signal) is an async generator (consumed via for-await).
//   Event protocol READ from the consumer: every event carries requestId +
//   sequence; types are 'start' (first, once), 'delta' (monotonic sequence,
//   carries text), 'provider_switch' (non-terminal), and terminal
//   'done'/'cancel'/'error'. The stub never yields, so these live only in
//   the DirectAssistStreamEvent type.
// - DirectAssistRequestInput covers every field the handler freezes into
//   directRequest (~7252): requestId/source/selection/currentRequest/skill/
//   manualContext/referenceFiles/pageContext/history/transcript/
//   meetingTranscript/imagePaths/requestedLanguage/requestedFormat/
//   maxContextChars. skill is { id, name, instructions } | null (READ from
//   resolveDirectAssistSkill ~7075-7082); selection is { provider, model }
//   (READ from getDirectAssistSelection ~7166-7170).
export interface DirectAssistSelection {
  provider: string;
  model: string;
  [key: string]: unknown;
}

export interface DirectAssistSkill {
  id: string;
  name: string;
  instructions: string;
  [key: string]: unknown;
}

export interface DirectAssistReferenceFile {
  fileName: string;
  content: string;
  totalChars?: number;
  [key: string]: unknown;
}

export interface DirectAssistHistoryTurn {
  role: string;
  content: string;
  imagePaths?: string[];
  imageCount?: number;
  imageDescription?: string;
  [key: string]: unknown;
}

export interface DirectAssistPageContext {
  dom?: string;
  ocr?: string;
  url?: string;
  title?: string;
  [key: string]: unknown;
}

export interface DirectAssistRequestInput {
  requestId: string;
  source: string;
  selection: DirectAssistSelection;
  currentRequest: string;
  skill?: DirectAssistSkill | null;
  manualContext?: string;
  referenceFiles?: DirectAssistReferenceFile[];
  pageContext?: DirectAssistPageContext | null;
  history?: DirectAssistHistoryTurn[];
  transcript?: string;
  meetingTranscript?: string;
  imagePaths?: string[];
  requestedLanguage?: string;
  requestedFormat?: string;
  maxContextChars?: number;
  [key: string]: unknown;
}

export interface DirectAssistStreamEvent {
  type: string;
  requestId: string;
  sequence: number;
  text?: string;
  fullText?: string;
  partial?: boolean;
  error?: { code: string; message: string; retryable: boolean; [key: string]: unknown };
  [key: string]: unknown;
}

export class DirectAssistService {
  constructor(_llmHelper: unknown) {}

  async *stream(
    _request: DirectAssistRequestInput,
    _signal?: AbortSignal,
  ): AsyncGenerator<DirectAssistStreamEvent, void, unknown> {
    throw new Error('direct-assist unavailable');
  }
}
