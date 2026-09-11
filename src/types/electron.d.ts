/**
 * =============================================================================
 * electron.d.ts — DECLARAÇÕES DE TIPO DA API DO ELECTRON
 * =============================================================================
 * 
 * DESCRIÇÃO:
 * Este arquivo define os TIPOS TypeScript para toda a API do Electron
 * exposta ao processo renderer via contextBridge (preload.ts).
 * 
 * POR QUE EXISTE:
 * - O renderer (React) precisa saber quais funções estão disponíveis em
 *   window.electronAPI sem importar módulos do Electron diretamente
 * - Garante type-safety: se uma função mudar no backend, o TypeScript
 *   avisa imediatamente no frontend
 * - Documenta CONTRATO entre processo principal e renderer
 * 
 * SEGURANÇA:
 * - Este arquivo é APENAS declaração de tipo (não gera JavaScript)
 * - O renderer não pode acessar funções que não estejam declaradas aqui
 * - Cada tipo espelha uma função IPC registrada em ipcHandlers.ts
 * =============================================================================
 */

// Fase 3 — DynamicActionPayload espelha electron/services/dynamic-actions/DynamicAction.ts.
// Mantido como interface estrutural (não a classe importada) para preservar o limite estrito
// de tipos main↔renderer — o renderer nunca importa de electron/* diretamente.

// Role Twin — espelha src/types/roleTwin.ts (import aqui seria circular com window, então referência direta)
import type { RoleTwin } from './roleTwin';

export interface DynamicActionEvidenceRef {
  source: 'transcript' | 'screen' | 'reference' | 'meeting_history' | 'browser_dom'
  text: string
  timestamp?: number
  speaker?: string
  fileId?: string
  chunkId?: string
}

export interface DynamicActionPayload {
  id: string
  sessionId: string
  modeId: string
  modeTemplateType: string
  type: string
  label: string
  description?: string
  confidence: number
  priority: number
  evidenceRefs: DynamicActionEvidenceRef[]
  status: 'candidate' | 'shown' | 'accepted' | 'dismissed' | 'completed' | 'expired'
  createdAt: number
  expiresAt?: number
  promptInstruction: string
  answerStyle?: {
    maxWords: number
    format: 'bullets' | 'short_script' | 'code' | 'checklist' | 'summary'
    tone: string
  }
}

export interface ElectronAPI {
  updateContentDimensions: (dimensions: {
    width: number
    height: number
  }) => Promise<void>
  onToggleExpand: (callback: () => void) => () => void
  getRecognitionLanguages: () => Promise<Record<string, any>>
  getScreenshots: () => Promise<Array<{ path: string; preview: string }>>
  deleteScreenshot: (
    path: string
  ) => Promise<{ success: boolean; error?: string }>
  onScreenshotTaken: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void
  onScreenshotAttached: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void
  onCaptureAndProcess: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void
  onSolutionsReady: (callback: (solutions: string) => void) => () => void
  onResetView: (callback: () => void) => () => void
  onSolutionStart: (callback: () => void) => () => void
  onDebugStart: (callback: () => void) => () => void
  onDebugSuccess: (callback: (data: any) => void) => () => void
  onSolutionError: (callback: (error: string) => void) => () => void
  onProcessingNoScreenshots: (callback: () => void) => () => void
  onProblemExtracted: (callback: (data: any) => void) => () => void
  onSolutionSuccess: (callback: (data: any) => void) => () => void
  onUnauthorized: (callback: () => void) => () => void
  onDebugError: (callback: (error: string) => void) => () => void
  takeScreenshot: () => Promise<{ path: string; preview: string }>
  takeSelectiveScreenshot: () => Promise<{ path: string; preview: string; cancelled?: boolean }>
  moveWindowLeft: () => Promise<void>
  moveWindowRight: () => Promise<void>
  moveWindowUp: () => Promise<void>
  moveWindowDown: () => Promise<void>
  windowMinimize: () => Promise<void>
  windowMaximize: () => Promise<void>
  windowClose: () => Promise<void>
  windowIsMaximized: () => Promise<boolean>

  analyzeImageFile: (path: string) => Promise<void>
  quitApp: () => Promise<void>
  toggleWindow: () => Promise<void>
  showWindow: (inactive?: boolean) => Promise<void>
  hideWindow: () => Promise<void>
  showOverlay: () => Promise<void>
  hideOverlay: () => Promise<void>
  getMeetingActive: () => Promise<boolean>
  onMeetingStateChanged: (callback: (data: { isActive: boolean }) => void) => () => void
  onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => () => void
  onEnsureExpanded: (callback: () => void) => () => void
  openExternal: (url: string) => Promise<void>
  // UX2: reparo TCC in-app. Apenas macOS; retorna { ok, bundleId, results, message, promptRelaunch }.
  repairTccPermissions: () => Promise<{
    ok: boolean
    bundleId?: string
    results?: Array<{ service: string; ok: boolean; output: string }>
    promptRelaunch?: boolean
    error?: string
    message: string
  }>
  setUndetectable: (state: boolean) => Promise<{ success: boolean; error?: string }>
  getUndetectable: () => Promise<boolean>
  setOverlayMousePassthrough: (enabled: boolean) => Promise<{ success: boolean }>
  toggleOverlayMousePassthrough: () => Promise<{ success: boolean; enabled: boolean }>
  getOverlayMousePassthrough: () => Promise<boolean>
  onOverlayMousePassthroughChanged: (callback: (enabled: boolean) => void) => () => void
  setDisguise: (mode: 'terminal' | 'settings' | 'activity' | 'none') => Promise<{ success: boolean; error?: string }>
  getDisguise: () => Promise<'none' | 'terminal' | 'settings' | 'activity'>
  onDisguiseChanged: (callback: (mode: 'terminal' | 'settings' | 'activity' | 'none') => void) => () => void
  setOpenAtLogin: (open: boolean) => Promise<{ success: boolean; error?: string }>
  getOpenAtLogin: () => Promise<boolean>
  onSettingsVisibilityChange: (callback: (isVisible: boolean) => void) => () => void
  toggleSettingsWindow: (coords?: { x: number; y: number }) => Promise<void>
  closeSettingsWindow: () => Promise<void>
  toggleAdvancedSettings: () => Promise<void>
  closeAdvancedSettings: () => Promise<void>
  openSettingsTab: (tab: string) => Promise<void>
  onOpenSettingsTab: (callback: (tab: string) => void) => () => void

  // LLM Model Management
  getCurrentLlmConfig: () => Promise<{ provider: "ollama" | "gemini" | "custom" | "codex-cli"; model: string; isOllama: boolean }>
  getAvailableOllamaModels: () => Promise<string[]>
  switchToOllama: (model?: string, url?: string) => Promise<{ success: boolean; error?: string }>
  switchToGemini: (apiKey?: string, modelId?: string) => Promise<{ success: boolean; error?: string }>
  testLlmConnection: (provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', apiKey?: string) => Promise<{ success: boolean; error?: string }>
  selectServiceAccount: () => Promise<{ success: boolean; path?: string; cancelled?: boolean; error?: string }>

  // API Key Management
  setGeminiApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setGroqApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setOpenaiApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setClaudeApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setDeepseekApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setOpencodeZenApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setLitellmConfig: (config: { apiKey: string; baseURL: string; maxTokens?: number }) => Promise<{ success: boolean; error?: string }>
  getAvailableLiteLLMModels: () => Promise<string[]>
  setRefractApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  getRefractPricing: () => Promise<{ ok: boolean; currency?: string; fetchedAt?: string; stale?: boolean; products?: Record<string, { id: string; dodoProductId: string; name: string; amount: number | null; currency: string; formattedPrice: string | null; interval: 'month' | 'year' | 'lifetime'; checkoutUrl: string; coupon: { code: string; eligible: boolean; discountPercent: number; reason?: string } }>; error?: string; status?: number }>
  getRefractUsage: () => Promise<{ ok: boolean; error?: string; plan?: string; quota?: { transcription: { used: number; limit: number; remaining: number }; ai: { used: number; limit: number; remaining: number }; search: { used: number; limit: number; remaining: number }; resets_at: string }; member_since?: string }>
  getStoredCredentials: () => Promise<{ hasRefractKey?: boolean; hasGeminiKey: boolean; hasGroqKey: boolean; hasOpenaiKey: boolean; hasClaudeKey: boolean; hasDeepseekKey: boolean; hasOpencodeZenKey?: boolean; hasLitellmBaseURL?: boolean; litellmBaseURL?: string | null; litellmMaxTokens?: number | null; googleServiceAccountPath: string | null; sttProvider: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'refract'; hasSttGroqKey: boolean; hasSttOpenaiKey: boolean; hasDeepgramKey: boolean; hasElevenLabsKey: boolean; hasAzureKey: boolean; azureRegion: string; hasIbmWatsonKey: boolean; ibmWatsonRegion: string; groqSttModel?: string; hasSonioxKey?: boolean; hasTavilyKey?: boolean; geminiPreferredModel?: string; groqPreferredModel?: string; openaiPreferredModel?: string; claudePreferredModel?: string; deepseekPreferredModel?: string; opencodeZenPreferredModel?: string; sttGroqKey?: string; sttOpenaiKey?: string; sttDeepgramKey?: string; sttElevenLabsKey?: string; sttAzureKey?: string; sttIbmKey?: string; sttSonioxKey?: string; openAiSttBaseUrl?: string }>
  // Permissions
  checkPermissions:     () => Promise<{ microphone: 'granted'|'denied'|'not-determined'|'restricted'; screen: 'granted'|'denied'|'not-determined'|'restricted'; platform: string }>
  requestMicPermission: () => Promise<boolean>

  // Free Trial
  startTrial:     () => Promise<{ ok: boolean; hasToken?: boolean; started_at?: string; expires_at?: string; expired?: boolean; already_used?: boolean; converted_to?: string | null; usage?: { ai: number; stt_seconds: number; search: number }; limits?: { duration_ms: number; ai_requests: number; stt_minutes: number; search_requests: number }; error?: string; status?: number }>
  getTrialStatus: () => Promise<{ ok: boolean; expired?: boolean; remaining_ms?: number; started_at?: string; expires_at?: string; converted_to?: string | null; usage?: { ai: number; stt_seconds: number; search: number }; limits?: object; error?: string }>
  getLocalTrial:  () => Promise<{ hasToken: boolean; trialClaimed?: boolean; expiresAt?: string; startedAt?: string; expired?: boolean }>
  convertTrial:   (choice: string) => Promise<{ ok: boolean }>
  endTrialByok:        () => Promise<{ success: boolean; error?: string }>
  wipeTrialProfileData: () => Promise<{ success: boolean; error?: string }>
  onTrialEnded:   (cb: (data: { choice: string }) => void) => () => void

  // STT Provider Management
  setSttProvider: (provider: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'refract') => Promise<{ success: boolean; error?: string }>
  getSttProvider: () => Promise<string>
  setGroqSttApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setOpenAiSttApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setOpenAiSttBaseUrl: (url: string) => Promise<{ success: boolean; error?: string }>
  setDeepgramApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setElevenLabsApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setAzureApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setAzureRegion: (region: string) => Promise<{ success: boolean; error?: string }>
  setIbmWatsonApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setGroqSttModel: (model: string) => Promise<{ success: boolean; error?: string }>
  setSonioxApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setIbmWatsonRegion: (region: string) => Promise<{ success: boolean; error?: string }>
  testSttConnection: (provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox', apiKey: string, region?: string) => Promise<{ success: boolean; error?: string }>

  // Eventos de Configuração STT (disparados quando provedor/chave STT muda durante uma reunião)
  onSttConfigChanged: (callback: (data: { configured: boolean; provider: string }) => void) => () => void
  onCredentialsChanged: (callback: () => void) => () => void

  // Eventos do Serviço de Áudio Nativo
  onNativeAudioTranscript: (callback: (transcript: { speaker: string; text: string; timestamp: number; final: boolean; confidence?: number }) => void) => () => void
  onNativeAudioSuggestion: (callback: (suggestion: { context: string; lastQuestion: string; confidence: number }) => void) => () => void
  onNativeAudioConnected: (callback: () => void) => () => void
  onNativeAudioDisconnected: (callback: () => void) => () => void
  onSuggestionGenerated: (callback: (data: { question: string; suggestion: string; confidence: number }) => void) => () => void
  onSuggestionProcessingStart: (callback: () => void) => () => void
  onSuggestionError: (callback: (error: { error: string }) => void) => () => void
  generateSuggestion: (context: string, lastQuestion: string) => Promise<{ suggestion: string }>
  getInputDevices: () => Promise<Array<{ id: string; name: string }>>
  getOutputDevices: () => Promise<Array<{ id: string; name: string }>>
  setRecognitionLanguage: (key: string) => Promise<{ success: boolean; error?: string }>
  getAiResponseLanguages: () => Promise<Array<{ label: string; code: string }>>
  setAiResponseLanguage: (language: string) => Promise<{ success: boolean; error?: string }>
  getSttLanguage: () => Promise<string>
  getAiResponseLanguage: () => Promise<string>
  onSttLanguageAutoDetected: (callback: (bcp47: string) => void) => () => void
  onSystemAudioPermissionDenied: (callback: (message: string) => void) => () => void
  onDeviceSelectionApplied: (callback: (payload: { kind: 'input' | 'output'; requested: string | null; actual: string | null; fellBack: boolean; reason?: string }) => void) => () => void
  onAudioCaptureFailed: (callback: (payload: { channel: 'system' | 'mic'; message: string; attempt: number; maxAttempts: number; terminal?: boolean; stuck?: boolean }) => void) => () => void
  onAudioInputAutoSwitched: (callback: (payload: { from: string; to: string; reason: string; message?: string }) => void) => () => void

  // STT Status Events
  onSttStatusChanged: (callback: (data: { state: 'connected' | 'reconnecting' | 'failed' | 'awaiting-audio'; provider: string; error?: string; channel: 'user' | 'interviewer'; reconnectAttempts?: number }) => void) => () => void

  getNativeAudioStatus: () => Promise<{ connected: boolean }>

  // Intelligence Mode IPC
  generateAssist: () => Promise<{ insight: string | null }>
  generateWhatToSay: (question?: string, imagePaths?: string[], options?: { promptInstruction?: string; domContext?: string; domContextEnvelope?: ContextEnvelope }) => Promise<{
    answer: string | null;
    question?: string;
    error?: string;
    /** Vision pipeline outcome — replaces legacy screenContextStatus/ocrTextLength fields */
    screenContextStatus?: 'not_available' | 'available' | 'failed';
    visionProviderUsed?: string;
    visionModelUsed?: string;
    visionAttempts?: number;
    visionFailureReason?: 'no_vision_provider' | 'all_vision_failed' | 'privacy_blocked' | 'scope_blocked' | 'provider_timeout';
    imageCount?: number;
    usedImageInput?: boolean;
  }>
  generateClarify: () => Promise<{ clarification: string | null }>
  generateCodeHint: (imagePaths?: string[], problemStatement?: string) => Promise<{ hint: string | null }>
  generateBrainstorm: (imagePaths?: string[], problemStatement?: string) => Promise<{ script: string | null }>
  generateFollowUp: (intent: string, userRequest?: string) => Promise<{ refined: string | null; intent: string }>
  generateFollowUpQuestions: () => Promise<{ questions: string | null }>
  generateRecap: () => Promise<{ summary: string | null }>
  submitManualQuestion: (question: string) => Promise<{ answer: string | null; question: string }>
  getIntelligenceContext: () => Promise<{ context: string; lastAssistantMessage: string | null; activeMode: string }>
  resetIntelligence: () => Promise<{ success: boolean; error?: string }>

  // Modo de Ação Dinâmica
  getActionButtonMode: () => Promise<'recap' | 'brainstorm'>
  setActionButtonMode: (mode: 'recap' | 'brainstorm') => Promise<{ success: boolean }>
  onActionButtonModeChanged: (callback: (mode: 'recap' | 'brainstorm') => void) => () => void
  onModeChanged: (callback: (data: { id: string | null; name: string | null }) => void) => () => void

  // Modes
  modesGetAll: () => Promise<Array<{ id: string; name: string; templateType: string; customContext: string; isActive: boolean; createdAt: string; referenceFileCount: number }>>
  modesGetActive: () => Promise<{ id: string; name: string; templateType: string; customContext: string; isActive: boolean; createdAt: string } | null>
  modesCreate: (params: { name: string; templateType: string }) => Promise<{ success: boolean; mode?: any; error?: string }>
  modesUpdate: (id: string, updates: { name?: string; templateType?: string; customContext?: string }) => Promise<{ success: boolean; error?: string }>
  modesDelete: (id: string) => Promise<{ success: boolean; error?: string }>
  modesSetActive: (id: string | null) => Promise<{ success: boolean; error?: string }>
  modesGetReferenceFiles: (modeId: string) => Promise<Array<{ id: string; modeId: string; fileName: string; content: string; createdAt: string }>>
  modesUploadReferenceFile: (modeId: string) => Promise<{ success: boolean; file?: any; cancelled?: boolean; error?: string }>
  modesDeleteReferenceFile: (id: string) => Promise<{ success: boolean; error?: string }>
  modesGetNoteSections: (modeId: string) => Promise<Array<{ id: string; modeId: string; title: string; description: string; sortOrder: number }>>
  modesAddNoteSection: (modeId: string, title: string, description: string) => Promise<{ success: boolean; section?: any; error?: string }>
  modesUpdateNoteSection: (id: string, updates: { title?: string; description?: string }) => Promise<{ success: boolean; error?: string }>
  modesDeleteNoteSection: (id: string) => Promise<{ success: boolean; error?: string }>
  modesRemoveAllNoteSections: (modeId: string) => Promise<{ success: boolean; error?: string }>

  // Meeting Lifecycle
  startMeeting: (metadata?: any) => Promise<{ success: boolean; error?: string; code?: string }>
  endMeeting: () => Promise<{ success: boolean; error?: string }>
  finalizeMicSTT: () => Promise<void>
  getRecentMeetings: () => Promise<Array<{ id: string; title: string; date: string; duration: string; summary: string }>>
  getMeetingDetails: (id: string) => Promise<any>
  searchGlobalMeetings: (query: string, filters?: any) => Promise<{ enabled: boolean; results: any[] }>
  searchInMeeting: (query: string) => Promise<{ enabled: boolean; results: any[] }>
  generateLectureNotes: (opts?: { title?: string; course?: string }) => Promise<{ enabled: boolean; notes: any }>
  generateDiagram: (text?: string) => Promise<{ enabled: boolean; diagram: any }>
  getIntelligenceFlags: () => Promise<Array<{ key: string; enabled: boolean; setting: string; env: string; default: boolean }>>
  setIntelligenceFlag: (key: string, value: boolean | null) => Promise<{ success: boolean; enabled?: boolean; error?: string }>
  getHindsightConfig: () => Promise<{ baseUrl: string; hasApiKey: boolean; autoStart: boolean; serverCommand: string; llmProvider: string; available: boolean }>
  setHindsightConfig: (cfg: { baseUrl?: string; apiKey?: string; autoStart?: boolean; serverCommand?: string; llmProvider?: string }) => Promise<{ success: boolean; healthy?: boolean; error?: string }>
  testHindsightConnection: () => Promise<{ healthy: boolean; error?: string }>
  updateMeetingTitle: (id: string, title: string) => Promise<boolean>
  updateMeetingSummary: (id: string, updates: { overview?: string, actionItems?: string[], keyPoints?: string[], actionItemsTitle?: string, keyPointsTitle?: string }) => Promise<boolean>
  regenerateMeetingSummary: (id: string, opts?: { templateType?: string; tone?: 'professional' | 'warm' | 'concise' | 'friendly' }) => Promise<{ success: boolean; error?: string }>
  regenerateMeetingFollowUp: (id: string, tone?: 'professional' | 'warm' | 'concise' | 'friendly') => Promise<{ success: boolean; error?: string }>
  updateMeetingSpeakerLabels: (id: string, labels: Record<string, string>) => Promise<{ success: boolean; labels?: Record<string, string>; error?: string }>
  deleteMeeting: (id: string) => Promise<boolean>
  setWindowMode: (mode: 'launcher' | 'overlay', inactive?: boolean) => Promise<void>
  setMeetingInterfaceTheme: (theme: string) => void
  onMeetingInterfaceThemeChanged: (callback: (theme: string) => void) => () => void

  // Fase 3 — Refract-style dynamic ação cards.
  onIntelligenceDynamicAction: (callback: (data: { action: DynamicActionPayload }) => void) => () => void
  acceptDynamicAction: (actionId: string) => Promise<{ success: boolean; action?: DynamicActionPayload; error?: string }>
  dismissDynamicAction: (actionId: string) => Promise<{ success: boolean; error?: string }>
  listDynamicActions: () => Promise<{ success: boolean; actions: DynamicActionPayload[]; error?: string }>
  getSmartMeetingWorkspace: (params?: { meetingId?: string; event?: any }) => Promise<any>

  // Intelligence Modo Events
  onIntelligenceAssistUpdate: (callback: (data: { insight: string }) => void) => () => void
  onIntelligenceSuggestedAnswerToken: (callback: (data: { token: string; question: string; confidence: number }) => void) => () => void
  onIntelligenceSuggestedAnswer: (callback: (data: { answer: string; question: string; confidence: number }) => void) => () => void
  onIntelligenceSuggestedAnswerDiscard: (callback: (data: { reason: string }) => void) => () => void
  // Verificação de código executada em segundo plano: ✓ badge + mensagem corrigida
  onIntelligenceCodeVerified: (callback: (data: { question: string; passed: number; total: number; language: string }) => void) => () => void
  onIntelligenceCodeCorrection: (callback: (data: { question: string; answer: string; note: string; reVerified: boolean }) => void) => () => void
  // Sprint 7: canal dedicado de coaching de negociação.
  onIntelligenceNegotiationCoaching: (callback: (data: { payload: any }) => void) => () => void
  // Sprint 9: canal de tokens IPC com agrupamento por tempo.
  onIntelligenceTokenBatch: (callback: (data: { kind: 'suggested_answer' | 'refined_answer' | 'recap' | 'clarify' | 'follow_up_questions'; items: any[] }) => void) => () => void
  onIntelligenceRefinedAnswerToken: (callback: (data: { token: string; intent: string }) => void) => () => void
  onIntelligenceRefinedAnswer: (callback: (data: { answer: string; intent: string }) => void) => () => void
  onIntelligenceFollowUpQuestionsUpdate: (callback: (data: { questions: string }) => void) => () => void
  onIntelligenceFollowUpQuestionsToken: (callback: (data: { token: string }) => void) => () => void
  onIntelligenceRecap: (callback: (data: { summary: string }) => void) => () => void
  onIntelligenceRecapToken: (callback: (data: { token: string }) => void) => () => void
  onIntelligenceClarify: (callback: (data: { clarification: string }) => void) => () => void
  onIntelligenceClarifyToken: (callback: (data: { token: string }) => void) => () => void
  onIntelligenceManualStarted: (callback: () => void) => () => void
  onIntelligenceManualResult: (callback: (data: { answer: string; question: string }) => void) => () => void
  onIntelligenceModeChanged: (callback: (data: { mode: string }) => void) => () => void
  onIntelligenceError: (callback: (data: { error: string, mode: string }) => void) => () => void;
  // Gestão de Sessão
  onSessionReset: (callback: () => void) => () => void;

  // Streaming listeners
  streamGeminiChat: (message: string, imagePaths?: string[], context?: string, options?: { skipSystemPrompt?: boolean, ignoreKnowledgeMode?: boolean }) => Promise<void>
  onGeminiStreamToken: (callback: (token: string, meta?: { streamId?: number }) => void) => () => void
  onGeminiStreamDone: (callback: (data?: { finalText?: string; streamId?: number }) => void) => () => void
  onGeminiStreamError: (callback: (error: string) => void) => () => void;
  cancelChatStream: () => void;

  // Gestão de Modelo
  getDefaultModel: () => Promise<{ model: string }>;
  setModel: (modelId: string) => Promise<{ success: boolean; error?: string }>;
  setDefaultModel: (modelId: string) => Promise<{ success: boolean; error?: string }>;
  toggleModelSelector: (coords: { x: number; y: number; activate?: boolean }) => Promise<void>;
  modelSelectorCloseIfOpen: () => Promise<void>;
  forceRestartOllama: () => Promise<void>;

  // Settings Window
  toggleSettingsWindow: (coords?: { x: number; y: number }) => Promise<void>;

  // Modo de Texto Rápido Groq
  getGroqFastTextMode: () => Promise<{ enabled: boolean }>;
  setGroqFastTextMode: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  getCodexCliConfig: () => Promise<{ enabled: boolean; path: string; model: string; fastModel: string; timeoutMs: number; sandboxMode: string; serviceTier?: string; modelReasoningEffort?: string }>;
  setCodexCliConfig: (config: { enabled: boolean; path: string; model: string; fastModel: string; timeoutMs: number; sandboxMode?: string; serviceTier?: string; modelReasoningEffort?: string }) => Promise<{ success: boolean; error?: string; config?: { enabled: boolean; path: string; model: string; fastModel: string; timeoutMs: number; sandboxMode: string; serviceTier?: string; modelReasoningEffort?: string } }>;
  testCodexCli: (config?: { enabled?: boolean; path?: string; model?: string; fastModel?: string; timeoutMs?: number; sandboxMode?: string; serviceTier?: string; modelReasoningEffort?: string }) => Promise<{ success: boolean; error?: string; resolvedPath?: string; config?: { enabled: boolean; path: string; model: string; fastModel: string; timeoutMs: number; sandboxMode: string; serviceTier?: string; modelReasoningEffort?: string } }>;

  // Demo
  seedDemo: () => Promise<{ success: boolean }>;

  // Custom Providers
  saveCustomProvider: (provider: any) => Promise<{ success: boolean; id?: string; error?: string }>;
  getCustomProviders: () => Promise<any[]>;
  deleteCustomProvider: (id: string) => Promise<{ success: boolean; error?: string }>;

  // Follow-up Email
  generateFollowupEmail: (input: any) => Promise<string>;
  extractEmailsFromTranscript: (transcript: Array<{ text: string }>) => Promise<string[]>;
  getCalendarAttendees: (eventId: string) => Promise<Array<{ email: string; name: string }>>;
  openMailto: (params: { to: string; subject: string; body: string }) => Promise<{ success: boolean; error?: string }>;

  // Testar Áudio
  startAudioTest: (deviceId?: string) => Promise<{ success: boolean }>;
  stopAudioTest: () => Promise<{ success: boolean }>;
  onAudioTestLevel: (callback: (level: number) => void) => () => void;
  // UX4: sonda de áudio do sistema em paralelo — nível + eventos de erro emitidos durante
  // o mesmo ciclo de vida do startAudioTest.
  onAudioTestSystemLevel: (callback: (level: number) => void) => () => void;
  onAudioTestSystemError: (callback: (errorMessage: string) => void) => () => void;

  // Banco de Dados
  flushDatabase: () => Promise<{ success: boolean }>;

  onUndetectableChanged: (callback: (state: boolean) => void) => () => void;
  onGroqFastTextChanged: (callback: (enabled: boolean) => void) => () => void;
  onModelChanged: (callback: (modelId: string) => void) => () => void;

  onOllamaPullProgress: (callback: (data: { status: string; percent: number }) => void) => () => void;
  onOllamaPullComplete: (callback: () => void) => () => void;

  onMeetingsUpdated: (callback: () => void) => () => void

  // Compatibilidade de Provedor
  onIncompatibleProviderWarning: (callback: (data: { count: number, oldProvider: string, newProvider: string }) => void) => () => void;
  onReindexProgress: (callback: (phase: 'started' | 'progress' | 'complete', data: { count?: number, done?: number, total?: number, space?: string, partial?: boolean }) => void) => () => void;
  reindexIncompatibleMeetings: () => Promise<void>;

  // Theme API
  getThemeMode: () => Promise<{ mode: 'system' | 'light' | 'dark', resolved: 'light' | 'dark' }>
  setThemeMode: (mode: 'system' | 'light' | 'dark') => Promise<void>
  onThemeChanged: (callback: (data: { mode: 'system' | 'light' | 'dark', resolved: 'light' | 'dark' }) => void) => () => void

  // Calendar
  calendarConnect: () => Promise<{ success: boolean; error?: string }>
  calendarDisconnect: () => Promise<{ success: boolean; error?: string }>
  getCalendarStatus: () => Promise<{ connected: boolean; email?: string }>
  getUpcomingEvents: () => Promise<Array<{ id: string; title: string; startTime: string; endTime: string; link?: string; source: 'google'; attendees?: Array<{ email: string; name?: string; photoUrl?: string; response?: 'accepted' | 'declined' | 'tentative' | 'needsAction' }> }>>
  calendarRefresh: () => Promise<{ success: boolean; error?: string }>

  // Auto-Update
  onUpdateAvailable: (callback: (info: any) => void) => () => void
  onUpdateDownloaded: (callback: (info: any) => void) => () => void
  onUpdateChecking: (callback: () => void) => () => void
  onUpdateNotAvailable: (callback: (info: any) => void) => () => void
  onUpdateError: (callback: (err: string) => void) => () => void
  onDownloadProgress: (callback: (progressObj: any) => void) => () => void
  restartAndInstall: () => Promise<void>
  checkForUpdates: () => Promise<void>
  downloadUpdate: () => Promise<void>
  getCanAutoUpdate: () => Promise<{ canAutoUpdate: boolean }>
  testReleaseFetch: () => Promise<{ success: boolean; error?: string }>

  // API RAG (Geração Aumentada por Recuperação)
  ragQueryMeeting: (meetingId: string, query: string) => Promise<{ success?: boolean; fallback?: boolean; error?: string }>
  ragQueryLive: (query: string) => Promise<{ success?: boolean; fallback?: boolean; error?: string }>
  ragQueryGlobal: (query: string) => Promise<{ success?: boolean; fallback?: boolean; error?: string }>
  ragCancelQuery: (options: { meetingId?: string; global?: boolean }) => Promise<{ success: boolean }>
  ragIsMeetingProcessed: (meetingId: string) => Promise<boolean>
  ragGetQueueStatus: () => Promise<{ pending: number; processing: number; completed: number; failed: number }>
  ragRetryEmbeddings: () => Promise<{ success: boolean }>
  onRAGStreamChunk: (callback: (data: { meetingId?: string; global?: boolean; chunk: string }) => void) => () => void
  onRAGStreamComplete: (callback: (data: { meetingId?: string; global?: boolean }) => void) => () => void
  onRAGStreamError: (callback: (data: { meetingId?: string; global?: boolean; error: string }) => void) => () => void

  // API de Doação
  getDonationStatus: () => Promise<{ shouldShow: boolean; hasDonated: boolean; lifetimeShows: number }>;
  markDonationToastShown: () => Promise<{ success: boolean }>;
  setDonationComplete: () => Promise<{ success: boolean }>;

  // Gestão de Atalhos
  getKeybinds: () => Promise<Array<{ id: string; label: string; accelerator: string; isGlobal: boolean; defaultAccelerator: string }>>
  setKeybind: (id: string, accelerator: string) => Promise<boolean>
  resetKeybinds: () => Promise<Array<{ id: string; label: string; accelerator: string; isGlobal: boolean; defaultAccelerator: string }>>
  onKeybindsUpdate: (callback: (keybinds: Array<any>) => void) => () => void
  onKeybindRegistrationFailed: (callback: (data: { id: string; accelerator: string }) => void) => () => void
  onGlobalShortcut: (callback: (data: { action: string }) => void) => () => void

  // Digitação stealth baseada em CGEventTap (apenas macOS — degradação graciosa em outros)
  stealthTapAvailable: () => Promise<boolean>
  stealthTapOpenSettings: () => Promise<void>
  stealthTapStop: () => Promise<void>
  stealthTapStart: () => Promise<boolean>
  /** False on macOS when a composition IME (Pinyin/Hangul/Kanji/…) is
   *  enabled — the tap captures below the IME and breaks composition, so
   *  the renderer falls back to plain DOM focus on click. */
  stealthTapShouldAutoEngage: () => Promise<boolean>
  stealthTapRefreshIme: () => Promise<boolean>
  onStealthTapState: (cb: (state: { active: boolean; reason?: string }) => void) => () => void
  onStealthKeyCaptured: (cb: (ev: { keyCode: number; chars: string; flags: number; isKeyDown: boolean }) => void) => () => void

  // API do Motor de Perfil
  profileUploadResume: (filePath: string) => Promise<{ success: boolean; error?: string }>
  // D3 (PROFILE_INTELLIGENCE_RESEARCH_AND_REDESIGN.md §15 R3): o backend
  // retorna flags de prontidão explícitas para que a UI possa verificar "perfil é USÁVEL"
  // (resume_profile_facts_ready) em vez do hasProfile mais grosseiro. Os fatos estão
  // prontos assim que a extração estruturada é salva — sem gating em embeddings/AOT.
  profileGetStatus: () => Promise<{
    hasProfile: boolean
    profileMode: boolean
    name?: string
    role?: string
    totalExperienceYears?: number
    resume_structured_extraction_complete?: boolean
    resume_profile_facts_ready?: boolean
    profileFactsReady?: boolean
    jd_structured_extraction_complete?: boolean
    jdFactsReady?: boolean
    aot_pipeline_running?: boolean
    extractionMode?: 'llm' | 'heuristic' | 'none'
  }>
  profileSetMode: (enabled: boolean) => Promise<{ success: boolean; error?: string }>
  profileDelete: () => Promise<{ success: boolean; error?: string }>
  profileGetProfile: () => Promise<any>
  profileSelectFile: () => Promise<{ success?: boolean; cancelled?: boolean; filePath?: string; error?: string }>

  // JD & Research API
  profileUploadJD: (filePath: string) => Promise<{ success: boolean; error?: string }>
  profileDeleteJD: () => Promise<{ success: boolean; error?: string }>
  profileResearchCompany: (companyName: string) => Promise<{ success: boolean; dossier?: any; error?: string; searchQuotaExhausted?: boolean }>
  profileGenerateNegotiation: (force?: boolean) => Promise<{ success: boolean; script?: any; error?: string }>
  profileGetNegotiationState: () => Promise<{ success: boolean; state?: any; isActive?: boolean; error?: string }>
  profileResetNegotiation: () => Promise<{ success: boolean; error?: string }>
  profileGetNotes: () => Promise<{ success: boolean; content: string; error?: string }>
  profileSaveNotes: (content: string) => Promise<{ success: boolean; error?: string }>
  profileGetPersona: () => Promise<{ success: boolean; content: string; error?: string }>
  profileSavePersona: (content: string) => Promise<{ success: boolean; error?: string }>

  // API de Busca Tavily
  setTavilyApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>

  // Descoberta Dinâmica de Modelo
  fetchProviderModels: (provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', apiKey: string) => Promise<{ success: boolean; models?: {id: string, label: string}[]; error?: string }>
  setProviderPreferredModel: (provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', modelId: string) => Promise<void>

  // Checkout PIX (AbacatePay) — cobrança criada no main process, sem CORS
  pixCreateCheckout: (params: { plan: string; email: string }) => Promise<{
    ok: boolean; checkoutId?: string; url?: string; error?: string
  }>
  /** Polling do checkout. `activated` = licença já ativada pelo main process. */
  pixPollLicense: (checkoutId: string) => Promise<{
    ok: boolean; status?: 'pending' | 'activated' | 'paid'; licenseKey?: string; error?: string
  }>

  // Gestão de Licença
  licenseActivate: (key: string) => Promise<{ success: boolean; error?: string }>
  licenseCheckPremium: () => Promise<boolean>
  licenseGetDetails: () => Promise<{ isPremium: boolean; plan?: string; provider?: string }>
  /** Verificação assíncrona de inicialização — chama endpoint de validação do Dodo para detectar revogações no servidor. */
  licenseCheckPremiumAsync: () => Promise<boolean>
  onLicenseStatusChanged: (callback: (data: { isPremium: boolean, plan?: string }) => void) => () => void
  licenseDeactivate: () => Promise<void>
  licenseGetHardwareId: () => Promise<string>

  // Opacidade do Overlay (Modo Stealth)
  setOverlayOpacity: (opacity: number) => Promise<void>;
  onOverlayOpacityChanged: (callback: (opacity: number) => void) => () => void;

  // Log Detalhado / Depuração
  getVerboseLogging: () => Promise<boolean>;
  setVerboseLogging: (enabled: boolean) => Promise<{ success: boolean }>;
  getMeetingRetention: () => Promise<'forever' | '7d' | '30d' | 'never'>;
  setMeetingRetention: (retention: 'forever' | '7d' | '30d' | 'never') => Promise<{ success: boolean; error?: string }>;
  onMeetingRetentionChanged: (callback: (retention: 'forever' | '7d' | '30d' | 'never') => void) => () => void;
  getProviderDataScopes: () => Promise<{ transcript?: boolean; screenshots?: boolean; reference_files?: boolean; profile_history?: boolean; embeddings?: boolean; post_call_summary?: boolean }>;
  setProviderDataScopes: (scopes: { transcript?: boolean; screenshots?: boolean; reference_files?: boolean; profile_history?: boolean; embeddings?: boolean; post_call_summary?: boolean }) => Promise<{ success: boolean; error?: string }>;
  onProviderDataScopesChanged: (callback: (scopes: { transcript?: boolean; screenshots?: boolean; reference_files?: boolean; profile_history?: boolean; embeddings?: boolean; post_call_summary?: boolean }) => void) => () => void;
  getScreenUnderstandingMode: () => Promise<'vision_first' | 'vision_only' | 'private_vision'>;
  setScreenUnderstandingMode: (mode: 'vision_first' | 'vision_only' | 'private_vision') => Promise<{ success: boolean; error?: string }>;
  onScreenUnderstandingModeChanged: (callback: (mode: 'vision_first' | 'vision_only' | 'private_vision') => void) => () => void;
  getTechnicalInterviewVisionFirst: () => Promise<boolean>;
  setTechnicalInterviewVisionFirst: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  onTechnicalInterviewVisionFirstChanged: (callback: (enabled: boolean) => void) => () => void;
  /** @obsoleto alias mantido para builds mais antigas do renderer — mapeia para technicalInterviewVisionFirst */
  getTechnicalInterviewDirectVision: () => Promise<boolean>;
  /** @obsoleto alias mantido para builds mais antigas do renderer — mapeia para technicalInterviewVisionFirst */
  setTechnicalInterviewDirectVision: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  /** @obsoleto alias mantido para builds mais antigas do renderer — mapeia para technicalInterviewVisionFirstChanged */
  onTechnicalInterviewDirectVisionChanged: (callback: (enabled: boolean) => void) => () => void;
  getLogFilePath: () => Promise<string | null>;
  openLogFile: () => Promise<{ success: boolean; error?: string }>;

  // Onboarding e flags de backup persistentes de gating
  onboardingGetFlags: () => Promise<{
    seenStartup: boolean;
    seenProfileOnboarding: boolean;
    seenModesOnboarding: boolean;
    permsShown: boolean;
    seenInteractiveTutorial: boolean;
  }>;
  onboardingSetFlag: (
    key: 'seenStartup' | 'seenProfileOnboarding' | 'seenModesOnboarding' | 'permsShown' | 'seenInteractiveTutorial',
    value: boolean,
  ) => Promise<{ success: boolean; error?: string }>;

  // Arquitetura
  getArch: () => Promise<string>;
  getOsVersion: () => Promise<string>;

  // API do Cropper
  cropperConfirmed: (bounds: { x: number; y: number; width: number; height: number }) => void;
  cropperCancelled: () => void;
  onResetCropper: (callback: (data: { hudPosition: { x: number; y: number } }) => void) => () => void;

  // Plataforma
  platform: string;

  // Language Learning
  languageLearningTranslate: (data: { transcript: string; sourceLanguage: string; targetLanguage: string }) => Promise<void>;
  onLanguageLearningToken: (callback: (data: { token: string; accumulated: string }) => void) => () => void;
  onLanguageLearningDone: (callback: (data: { full: string; translation: string; suggestedReply: string }) => void) => () => void;
  onLanguageLearningError: (callback: (data: { error: string }) => void) => () => void;

  // Replica Interview Coach
  replicaStartSession: (data: { modeType: string; language: string; title?: string }) => Promise<{ sessionId?: string; error?: string }>;
  replicaAskQuestion: (data: { sessionId: string; userAnswer: string; isFirst: boolean; modeType: string; language: string; questionHistory: Array<{ question: string; difficulty: string; category: string; userAnswer: string; feedback: string }> }) => Promise<void>;
  replicaEndSession: (data: { sessionId: string; questionHistory: Array<{ question: string; difficulty: string; category: string; userAnswer: string; feedback: string }>; modeType: string; startTime: number }) => Promise<void>;
  replicaOpenWindow: () => Promise<{ success: boolean; error?: string }>;
  replicaCloseWindow: () => Promise<{ success: boolean; error?: string }>;
  onReplicaQuestionToken: (callback: (data: { token: string; accumulated: string }) => void) => () => void;
  onReplicaQuestionDone: (callback: (data: { full: string; question: string; difficulty: string; category: string; hint?: string; feedback: string; isEndSession: boolean }) => void) => () => void;
  onReplicaQuestionError: (callback: (data: { error: string }) => void) => () => void;
  onReplicaEvaluationToken: (callback: (data: { token: string; accumulated: string }) => void) => () => void;
  onReplicaEvaluationDone: (callback: (data: { full: string; evaluation: any }) => void) => () => void;
  onReplicaEvaluationError: (callback: (data: { error: string }) => void) => () => void;

  // Role Twin — inteligência de oportunidade (company + role) para practice
  roleTwinList: () => Promise<RoleTwin[]>;
  roleTwinGetActive: () => Promise<RoleTwin | null>;
  roleTwinAnalyze: (input: {
    id?: string;
    company: string;
    roleTitle: string;
    jobDescription: string;
    forceResearch?: boolean;
  }) => Promise<{ success: boolean; twin?: RoleTwin; error?: string }>;
  roleTwinSetActive: (id: string | null) => Promise<{ success: boolean; error?: string }>;
  roleTwinDelete: (id: string) => Promise<{ success: boolean; error?: string }>;

  // LemonSqueezy — checkout Pro
  lemonsqueezyCreateCheckout: (params: { plan: 'monthly' | 'yearly' | 'lifetime'; email?: string }) => Promise<{
    success: boolean;
    checkoutId?: string;
    checkoutUrl?: string;
    error?: string;
  }>;
  lemonsqueezyPollLicense: (checkoutId: string) => Promise<{
    success: boolean;
    activated?: boolean;
    pending?: boolean;
    plan?: 'monthly' | 'yearly' | 'lifetime';
    error?: string;
  }>;

  // Ativação de compras em segundo plano (o main process é o dono do ciclo).
  // Espelha os métodos expostos em electron/preload.ts — sem isto, os botões de
  // checkout chamavam purchaseActivationTrack/onPurchaseActivationChanged sem tipo.
  purchaseActivationTrack: (params: {
    provider: 'pix' | 'lemonsqueezy';
    checkoutId: string;
    plan: string;
    email?: string;
  }) => Promise<{ ok: boolean; error?: string }>;
  purchaseActivationCancel: (checkoutId: string) => Promise<{ ok: boolean }>;
  purchaseActivationList: () => Promise<{
    ok: boolean;
    pending: Array<{
      provider: string;
      checkoutId: string;
      plan: string;
      email: string;
      startedAt: number;
      attempts?: number;
    }>;
  }>;
  onPurchaseActivationChanged: (
    callback: (data: {
      checkoutId: string;
      provider: string;
      status: 'pending' | 'activated' | 'needs_manual' | 'expired';
      plan?: string;
      licenseKey?: string;
      error?: string;
    }) => void,
  ) => () => void;

  // Skills
  skillsRefresh: () => Promise<SkillSummary[]>;
  skillsOpenFolder: () => Promise<{ success: boolean; path: string; error?: string }>;

  // Telefone Mirror
  phoneMirrorGetInfo: () => Promise<PhoneMirrorInfo>;
  phoneMirrorEnable: (exposeOnLan: boolean) => Promise<PhoneMirrorInfo | { error: string }>;
  phoneMirrorDisable: () => Promise<{ success: true }>;
  phoneMirrorSetLan: (exposeOnLan: boolean) => Promise<PhoneMirrorInfo | { error: string }>;
  phoneMirrorRotateToken: () => Promise<PhoneMirrorInfo | { error: string }>;
  // Armazenar a janela de pareamento de 60s para a extensão do navegador companion
  phoneMirrorArmExtension: () => Promise<{ armedMs: number } | { error: string }>;
  phoneMirrorListTabs: () => Promise<{ tabs: Array<{ id: number; title: string; url: string }>; error?: string }>;
  phoneMirrorCaptureTab: (tabId: number) => Promise<{ ok: boolean; reason?: string }>;
  // Smart Browser Contexto v2 — puxada automática de contexto pré-resposta. Resolve attached:true
  // quando a página de programação foi auto-anexada (chega via onDomContextReceived), caso contrário
  // attached:false (resposta prossegue sem contexto do navegador)
  phoneMirrorRequestAutoContext: () => Promise<{ attached: boolean; reason?: string; category?: string }>;
  // Smart Browser Contexto v2 — configurações de captura automática.
  browserContextGetSettings: () => Promise<BrowserContextSettings | { error: string }>;
  browserContextSetSettings: (
    patch: Partial<{
      browserAutoDetectCoding: boolean;
      browserAutoAttachCoding: boolean;
      browserAskBeforeUnknown: boolean;
      browserAiClassifierEnabled: boolean;
      browserAutoDetectJobDescriptions: boolean;
      browserAutoDetectDeveloperDocs: boolean;
      browserExperimentalFullPageCapture: boolean;
    }>,
  ) => Promise<BrowserContextSettings | { error: string }>;
  onPhoneMirrorStatus: (callback: (info: PhoneMirrorInfo) => void) => () => void;
  onPhoneMirrorIncomingChat: (
    callback: (data: { message: string; streamId: string }) => void,
  ) => () => void;
  onDomContextReceived: (
    callback: (dom: string, meta?: DomCaptureMeta, envelope?: ContextEnvelope) => void,
  ) => () => void;

  // Git Integration API
  gitSetCwd: (dirPath: string | null) => Promise<{ success: boolean; error?: string }>;
  gitGetCwd: () => Promise<{ path: string | null }>;
  gitStatus: () => Promise<{ branch: string; ahead: number; behind: number; files: Array<{ path: string; status: string; indexStatus: string; worktreeStatus: string }>; isDirty: boolean; isRebase: boolean; isMerge: boolean; error?: string }>;
  gitDiff: (filePath?: string) => Promise<Array<{ file: string; additions: number; deletions: number; patch: string }>>;
  gitLog: (count?: number) => Promise<Array<{ hash: string; shortHash: string; author: string; date: string; message: string }>>;
  gitCommit: (message: string, options?: { files?: string[]; amend?: boolean }) => Promise<{ success: boolean; hash?: string; error?: string }>;
  gitBranches: () => Promise<Array<{ name: string; isCurrent: boolean; isRemote: boolean; upstream?: string }>>;
  gitCreateBranch: (name: string) => Promise<{ success: boolean; error?: string }>;
  gitSwitchBranch: (name: string) => Promise<{ success: boolean; error?: string }>;
  gitPull: () => Promise<{ success: boolean; error?: string }>;
  gitPush: (options?: { force?: boolean }) => Promise<{ success: boolean; error?: string }>;
  gitStash: (message?: string) => Promise<{ success: boolean; error?: string }>;
  gitStashPop: () => Promise<{ success: boolean; error?: string }>;
  gitStashDrop: () => Promise<{ success: boolean; error?: string }>;
  gitRepoName: () => Promise<string>;
  gitIsRepository: () => Promise<boolean>;
  gitOpenInFileManager: () => Promise<{ success: boolean; error?: string }>;
}

/**
 * Metadados enviados pela extensão companion com a página capturada; direciona o
 * chip opcional "Contexto da Página". Espelha DomCaptureMeta em PhoneMirrorService.
 */
export interface DomCaptureMeta {
  title?: string;
  url?: string;
  source?: string;
  pageType?: string;
  firstLine?: string;
}

/* ─────────────── Smart Browser Contexto v2 (espelho do RENDERER) ───────────────
 * Duplicado por subsistema (o pacote da extensão + electron compilam separadamente
 * e não podem compartilhar um arquivo fonte canônico: refract-browser/src/capture/types.ts;
 * espelho desktop: electron/services/browser-context/types.ts. O teste de proteção contra deriva
 * em cada suíte compara os literais de union através de todas as três cópias. Manter
 * estes sincronizados ao editar uma union.
 */
export type BrowserContextCategory =
  | 'coding_problem'
  | 'coding_editor'
  | 'interview_assessment'
  | 'developer_docs'
  | 'job_description'
  | 'google_docs_visible'
  | 'notes'
  | 'article'
  | 'email'
  | 'chat'
  | 'banking'
  | 'auth'
  | 'unknown';

export type AutoPolicy =
  | 'auto'
  | 'auto_if_high_confidence'
  | 'ask'
  | 'manual'
  | 'blocked';

export type BrowserContextSensitivity = 'low' | 'medium' | 'high' | 'critical';

export type ClassificationConfidence = 'high' | 'medium' | 'low';

export type CaptureMode = 'auto' | 'manual' | 'selected_text' | 'screenshot_fallback';

export type ExtractionSource =
  | 'platform-selector'
  | 'embedded-state'
  | 'editor-dom'
  | 'selection'
  | 'readability'
  | 'innerText'
  | 'screenshot';

/**
 * A captura estruturada que o desktop encaminha para o overlay juntamente com a
 * string `dom` legada como `payload` é específica por categoria (problema de programação, notas,
 * documentação de desenvolvedor, …); o renderer apenas precisa do meta + categoria para renderizar um
 * chip mais rico e retornar o envelope dentro da requisição de resposta.
 */
export interface ContextEnvelope<TPayload = unknown> {
  envelopeVersion: 1;
  contextId: string;
  source: 'browser_extension';
  captureMode: CaptureMode;
  category: BrowserContextCategory;
  sensitivity: BrowserContextSensitivity;
  confidence: ClassificationConfidence;
  meta: {
    platform?: string;
    title?: string;
    host?: string;
    url?: string;
    urlHash?: string;
    capturedAt: number;
    charCount: number;
    extractionSource: ExtractionSource;
    /** Verdadeiro quando o extrator perdeu os campos essenciais para esta categoria. */
    partial?: boolean;
    /** Quais campos essenciais estavam faltando (direciona a dica do chip). */
    missing?: string[];
  };
  payload: TPayload;
}

export interface CodingProblemPayload {
  platform?: string;
  problemTitle?: string;
  problemStatement?: string;
  inputFormat?: string;
  outputFormat?: string;
  examples?: string;
  constraints?: string;
  starterCode?: string;
  visibleCode?: string;
  language?: string;
  selectedText?: string;
}

export interface NotesPayload {
  editorType:
    | 'google_docs'
    | 'notion'
    | 'textarea'
    | 'contenteditable'
    | 'prosemirror'
    | 'unknown';
  selectedText?: string;
  visibleText?: string;
}

export interface DeveloperDocsPayload {
  title?: string;
  headings?: string[];
  mainText?: string;
  codeBlocks?: string[];
  publicUrl?: string;
}

/** Configurações resolvidas de captura automática do Smart Browser Contexto (padrões aplicados). */
export interface BrowserContextSettings {
  autoDetectCoding: boolean;
  autoAttachCoding: boolean;
  askBeforeUnknown: boolean;
  aiClassifierEnabled: boolean;
  autoDetectJobDescriptions: boolean;
  autoDetectDeveloperDocs: boolean;
  experimentalFullPageCapture: boolean;
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  source: 'builtin' | 'userData';
}

export interface PhoneMirrorInfo {
  running: boolean;
  enabled: boolean;
  exposeOnLan: boolean;
  port: number;
  loopbackUrl: string | null;
  primaryUrl: string | null;
  lanUrls: string[];
  /** Token do Telefone (LAN) — embutido na URL de pareamento/QR. Não é o token da extensão */
  token: string | null;
  /** Token da extensão com escopo de loopback — usado para a string de pareamento manual `port:extToken` */
  extToken: string | null;
  qrDataUrl: string | null;
  clients: number;
  extensionConnected: boolean;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
