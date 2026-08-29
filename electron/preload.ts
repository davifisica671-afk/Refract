/**
 * =============================================================================
 * preload.ts — SCRIPT DE PRÉ-CARREGAMENTO DO ELECTRON
 * =============================================================================
 * 
 * DESCRIÇÃO:
 * Este arquivo é executado NO CONTEXTO DO RENDERER (front-end) mas com acesso
 * às APIs do Node.js. Ele atua como uma PONTE SEGURA entre o processo renderer
 * (React/Vite) e o processo principal do Electron.
 * 
 * POR QUE EXISTE:
 * O Electron tem um modelo de segurança onde o renderer NÃO pode acessar
 * diretamente APIs do sistema operacional. O preload.ts usa `contextBridge`
 * para expor APENAS as funções que definimos, criando uma API controlada
 * chamada `window.electronAPI`.
 * 
 * FLUXO DE COMUNICAÇÃO:
 *   Renderer (React) → electronAPI.metodo() → ipcRenderer.invoke() 
 *   → [Electron IPC] → ipcMain.handle() → Processo Principal
 *   → Resposta volta pelo mesmo caminho inverso
 * 
 * TIPOS DE COMUNICAÇÃO IPC:
 * 1. invoke/handle: Chamada REQUEST→RESPONSE (async/await)
 * 2. on/send: Evento fire-and-forget (renderer escuta eventos do principal)
 * 3. send/on: Evento fire-and-forget (principal envia para renderer)
 * 
 * SEGURANÇA:
 * - NUNCA exponha require(), process, ou child_process ao renderer
 * - Use contextBridge.exposeInMainWorld() para criar a barreira
 * - Cada método é uma thin wrapper que chama ipcRenderer.invoke()
 * - O renderer não tem acesso direto ao Electron
 * =============================================================================
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * Metadados que a extensão companion envia com a página capturada.
 * Controla o chip opcional "Page contexto" na interface.
 * Espelha DomCaptureMeta em PhoneMirrorService.
 * 
 * USE CASE: Quando o usuário usa a extensão do navegador, a página web
 * ativa é capturada e esses metadados ajudam a IA a entender o contexto.
 */
interface DomCaptureMeta {
  title?: string;   // Título da página web
  url?: string;     // URL da página
  source?: string;  // Fonte da captura (extensão, espelho, etc.)
  pageType?: string;  // Tipo de página (documentação, GitHub, StackOverflow, etc.)
  firstLine?: string; // Primeira linha visível da página
}

/**
 * Espelho estrutural de src/types/roleTwin.ts para tipar a ponte IPC sem
 * importar código do renderer para dentro do preload. Os objetos atravessam
 * estruturalmente iguais via IPC serializado.
 */
interface RoleTwinRequirement {
  id: string;
  label: string;
  category: string;
  priority: 'must' | 'important' | 'supporting';
  status: 'matched' | 'partial' | 'gap';
  evidence: string[];
  preparationNote: string;
}

interface RoleTwin {
  id: string;
  company: string;
  roleTitle: string;
  jobDescription: string;
  analysis: {
    roleSummary: string;
    level: string;
    location: string;
    keywords: string[];
    requirements: RoleTwinRequirement[];
    strengths: string[];
    gaps: string[];
    interviewThemes: string[];
    preparationPlan: string[];
    coverageScore: number;
  };
  companyDossier: {
    company?: string;
    summary?: string;
    products?: string[];
    culture?: string[];
    recent_news?: string[];
    interview_angles?: string[];
    talking_points?: string[];
    sources?: string[];
    generated_at?: string;
  } | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

// Tipos para a API do Electron exposta
interface ElectronAPI {
  // Agent Actions
  agentApproveAction: (actionId: string) => Promise<{ success: boolean; error?: string }>;
  agentRejectAction: (actionId: string) => Promise<{ success: boolean; error?: string }>;
  onAgentRequestApproval: (callback: (data: { actionId: string; action: any }) => void) => () => void;

  updateContentDimensions: (dimensions: { width: number; height: number }) => Promise<void>;
  updateContentDimensionsCentered: (dimensions: { width: number; height: number }) => Promise<void>;
  getRecognitionLanguages: () => Promise<Record<string, any>>;
  getScreenshots: () => Promise<Array<{ path: string; preview: string }>>;
  deleteScreenshot: (path: string) => Promise<{ success: boolean; error?: string }>;
  onScreenshotTaken: (callback: (data: { path: string; preview: string }) => void) => () => void;
  onScreenshotAttached: (callback: (data: { path: string; preview: string }) => void) => () => void;
  onCaptureAndProcess: (callback: (data: { path: string; preview: string }) => void) => () => void;
  onSolutionsReady: (callback: (solutions: string) => void) => () => void;
  onResetView: (callback: () => void) => () => void;
  onSolutionStart: (callback: () => void) => () => void;
  onDebugStart: (callback: () => void) => () => void;
  onDebugSuccess: (callback: (data: any) => void) => () => void;
  onSolutionError: (callback: (error: string) => void) => () => void;
  onProcessingNoScreenshots: (callback: () => void) => () => void;
  onProblemExtracted: (callback: (data: any) => void) => () => void;
  onSolutionSuccess: (callback: (data: any) => void) => () => void;

  onUnauthorized: (callback: () => void) => () => void;
  onDebugError: (callback: (error: string) => void) => () => void;
  takeScreenshot: () => Promise<void>;
  takeSelectiveScreenshot: () => Promise<{ path: string; preview: string; cancelled?: boolean }>;
  moveWindowLeft: () => Promise<void>;
  moveWindowRight: () => Promise<void>;
  moveWindowUp: () => Promise<void>;
  moveWindowDown: () => Promise<void>;
  windowMinimize: () => Promise<void>;
  windowMaximize: () => Promise<void>;
  windowClose: () => Promise<void>;
  windowIsMaximized: () => Promise<boolean>;

  analyzeImageFile: (path: string) => Promise<void>;
  quitApp: () => Promise<void>;

  // Gerenciamento de modelo LLM
  getCurrentLlmConfig: () => Promise<{
    provider: 'ollama' | 'gemini';
    model: string;
    isOllama: boolean;
  }>;
  getAvailableOllamaModels: () => Promise<string[]>;
  switchToOllama: (model?: string, url?: string) => Promise<{ success: boolean; error?: string }>;
  switchToGemini: (
    apiKey?: string,
    modelId?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  testLlmConnection: (
    provider: 'gemini' | 'groq' | 'openai' | 'claude',
    apiKey?: string,
  ) => Promise<{ success: boolean; error?: string }>;
  selectServiceAccount: () => Promise<{
    success: boolean;
    path?: string;
    cancelled?: boolean;
    error?: string;
  }>;

  // Gerenciamento de chave de API
  setGeminiApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setGroqApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setOpenaiApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setClaudeApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setDeepseekApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setOpencodeZenApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setLitellmConfig: (config: { apiKey: string; baseURL: string; maxTokens?: number }) => Promise<{ success: boolean; error?: string }>;
  getAvailableLiteLLMModels: () => Promise<string[]>;
  setRefractApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  getRefractPricing: () => Promise<{
    ok: boolean;
    currency?: string;
    fetchedAt?: string;
    stale?: boolean;
    products?: Record<string, {
      id: string;
      dodoProductId: string;
      name: string;
      amount: number | null;
      currency: string;
      formattedPrice: string | null;
      interval: 'month' | 'year' | 'lifetime';
      checkoutUrl: string;
      coupon: { code: string; eligible: boolean; discountPercent: number; reason?: string };
    }>;
    error?: string;
    status?: number;
  }>;
  getRefractUsage: () => Promise<{
    ok: boolean;
    plan?: string;
    quota?: {
      transcription: { used: number; limit: number; remaining: number };
      ai: { used: number; limit: number; remaining: number };
      search: { used: number; limit: number; remaining: number };
      resets_at: string;
    };
    member_since?: string;
    error?: string;
    status?: number;
  }>;
  getStoredCredentials: () => Promise<{
    hasGeminiKey: boolean;
    hasGroqKey: boolean;
    hasOpenaiKey: boolean;
    hasClaudeKey: boolean;
    hasDeepseekKey: boolean;
    hasRefractKey: boolean;
    googleServiceAccountPath: string | null;
    sttProvider: string;
    hasSttGroqKey: boolean;
    hasSttOpenaiKey: boolean;
    hasDeepgramKey: boolean;
    hasElevenLabsKey: boolean;
    hasAzureKey: boolean;
    azureRegion: string;
    hasIbmWatsonKey: boolean;
    ibmWatsonRegion: string;
    hasSonioxKey: boolean;
  }>;
  // Iniciar período de teste
  startTrial: () => Promise<{
    ok: boolean;
    hasToken?: boolean;
    started_at?: string;
    expires_at?: string;
    expired?: boolean;
    already_used?: boolean;
    converted_to?: string | null;
    usage?: { ai: number; stt_seconds: number; search: number };
    limits?: {
      duration_ms: number;
      ai_requests: number;
      stt_minutes: number;
      search_requests: number;
    };
    error?: string;
    status?: number;
  }>;
  getTrialStatus: () => Promise<{
    ok: boolean;
    expired?: boolean;
    remaining_ms?: number;
    started_at?: string;
    expires_at?: string;
    converted_to?: string | null;
    usage?: { ai: number; stt_seconds: number; search: number };
    limits?: object;
    error?: string;
  }>;
  getLocalTrial: () => Promise<{
    hasToken: boolean;
    trialClaimed?: boolean;
    expiresAt?: string;
    startedAt?: string;
    expired?: boolean;
  }>;
  convertTrial: (choice: string) => Promise<{ ok: boolean }>;
  endTrialByok: () => Promise<{ success: boolean; error?: string }>;
  onTrialEnded: (cb: (data: { choice: string }) => void) => () => void;
  onModesActiveCleared: (cb: () => void) => () => void;

  // Gerenciamento de provedor STT
  setSttProvider: (
    provider:
      | 'none'
      | 'google'
      | 'groq'
      | 'openai'
      | 'deepgram'
      | 'elevenlabs'
      | 'azure'
      | 'ibmwatson'
      | 'soniox'
      | 'refract'
      | 'local-whisper',
  ) => Promise<{ success: boolean; error?: string }>;
  localWhisperGetModels: () => Promise<{ models: any[]; activeModelId: string }>;
  localWhisperSetModel: (modelId: string) => Promise<{ success: boolean }>;
  localWhisperGetChannelConfig: () => Promise<{
    enabled: boolean;
    micModelId: string;
    systemModelId: string;
    globalModelId: string;
  }>;
  localWhisperSetChannelConfig: (cfg: {
    enabled?: boolean;
    micModelId?: string;
    systemModelId?: string;
    globalModelId?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  localWhisperDeleteModel: (modelId: string) => Promise<{ success: boolean; error?: string }>;
  localWhisperStartDownload: (modelId: string) => Promise<{ success: boolean; error?: string }>;
  onLocalWhisperDownloadProgress: (
    callback: (data: { modelId: string; progress: number }) => void,
  ) => () => void;
  onLocalWhisperDownloadComplete: (callback: (data: { modelId: string }) => void) => () => void;
  onLocalWhisperDownloadError: (
    callback: (data: { modelId: string; error: string }) => void,
  ) => () => void;
  localWhisperPreload: (
    modelId?: string,
  ) => Promise<{ success: boolean; reason?: string; error?: string }>;
  localWhisperGetHardware: () => Promise<{
    arch: string;
    platform: string;
    cpuModel: string;
    isAppleSilicon: boolean;
    totalRamGb: number;
    tier: string;
    recommendation: string;
    recommendedModel: string;
  }>;
  getSttProvider: () => Promise<string>;
  setGroqSttApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setOpenAiSttApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setOpenAiSttBaseUrl: (url: string) => Promise<{ success: boolean; error?: string }>;
  setDeepgramApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setElevenLabsApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setAzureApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setAzureRegion: (region: string) => Promise<{ success: boolean; error?: string }>;
  setIbmWatsonApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setGroqSttModel: (model: string) => Promise<{ success: boolean; error?: string }>;
  setSonioxApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;
  setIbmWatsonRegion: (region: string) => Promise<{ success: boolean; error?: string }>;
  testSttConnection: (
    provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox',
    apiKey: string,
    region?: string,
  ) => Promise<{ success: boolean; error?: string }>;

  // Eventos de configuração STT
  onSttConfigChanged: (
    callback: (data: { configured: boolean; provider: string }) => void,
  ) => () => void;
  onCredentialsChanged: (callback: () => void) => () => void;

  // Eventos do serviço de áudio nativo
  onNativeAudioTranscript: (
    callback: (transcript: { speaker: string; text: string; final: boolean }) => void,
  ) => () => void;
  onNativeAudioSuggestion: (
    callback: (suggestion: { context: string; lastQuestion: string; confidence: number }) => void,
  ) => () => void;
  onNativeAudioConnected: (callback: () => void) => () => void;
  onNativeAudioDisconnected: (callback: () => void) => () => void;
  onSuggestionGenerated: (
    callback: (data: { question: string; suggestion: string; confidence: number }) => void,
  ) => () => void;
  onSuggestionProcessingStart: (callback: () => void) => () => void;
  onSuggestionError: (callback: (error: { error: string }) => void) => () => void;
  generateSuggestion: (context: string, lastQuestion: string) => Promise<{ suggestion: string }>;
  getInputDevices: () => Promise<Array<{ id: string; name: string }>>;
  getOutputDevices: () => Promise<Array<{ id: string; name: string }>>;
  setRecognitionLanguage: (key: string) => Promise<{ success: boolean; error?: string }>;
  getAiResponseLanguages: () => Promise<Array<{ label: string; code: string }>>;
  setAiResponseLanguage: (language: string) => Promise<{ success: boolean; error?: string }>;
  getSttLanguage: () => Promise<string>;
  getAiResponseLanguage: () => Promise<string>;
  onSttLanguageAutoDetected: (callback: (bcp47: string) => void) => () => void;
  onSystemAudioPermissionDenied: (callback: (message: string) => void) => () => void;
  getSystemAudioPermissionWarning: () => Promise<string | null>;
  onDeviceSelectionApplied: (
    callback: (payload: {
      kind: 'input' | 'output';
      requested: string | null;
      actual: string | null;
      fellBack: boolean;
      reason?: string;
    }) => void,
  ) => () => void;
  onAudioCaptureFailed: (
    callback: (payload: {
      channel: 'system' | 'mic';
      message: string;
      attempt: number;
      maxAttempts: number;
      terminal?: boolean;
      stuck?: boolean;
    }) => void,
  ) => () => void;
  onAudioInputAutoSwitched: (
    callback: (payload: { from: string; to: string; reason: string; message?: string }) => void,
  ) => () => void;

  // Eventos de status STT
  onSttStatusChanged: (
    callback: (data: {
      state: 'connected' | 'reconnecting' | 'failed' | 'awaiting-audio';
      provider: string;
      error?: string;
      channel: 'user' | 'interviewer';
      reconnectAttempts?: number;
    }) => void,
  ) => () => void;

  // IPC do modo de inteligência
  generateAssist: () => Promise<{ insight: string | null }>;
  generateWhatToSay: (
    question?: string,
    imagePaths?: string[],
    options?: { promptInstruction?: string; domContext?: string; domContextEnvelope?: unknown },
  ) => Promise<{
    answer: string | null;
    question?: string;
    error?: string;
    screenContextStatus?: 'not_available' | 'available' | 'failed';
    ocrTextLength?: number;
    imageCount?: number;
    usedImageInput?: boolean;
  }>;
  generateFollowUp: (
    intent: string,
    userRequest?: string,
  ) => Promise<{ refined: string | null; intent: string }>;
  generateRecap: () => Promise<{ summary: string | null }>;
  submitManualQuestion: (question: string) => Promise<{ answer: string | null; question: string }>;
  getIntelligenceContext: () => Promise<{
    context: string;
    lastAssistantMessage: string | null;
    activeMode: string;
  }>;
  testInjectTranscript: (segment: {
    speaker: string;
    text: string;
    timestamp?: number;
    final?: boolean;
  }) => Promise<{ success: boolean; error?: string }>;
  testGetModeContext: () => Promise<{
    success: boolean;
    block?: string;
    suffix?: string;
    error?: string;
  }>;
  resetIntelligence: () => Promise<{ success: boolean; error?: string }>;

  // Ciclo de vida da reunião
  startMeeting: (metadata?: any) => Promise<{ success: boolean; error?: string }>;
  endMeeting: () => Promise<{ success: boolean; error?: string }>;
  finalizeMicSTT: () => Promise<void>;
  getRecentMeetings: () => Promise<
    Array<{ id: string; title: string; date: string; duration: string; summary: string }>
  >;
  getMeetingDetails: (id: string) => Promise<any>;
  searchGlobalMeetings: (query: string, filters?: any) => Promise<{ enabled: boolean; results: any[] }>;
  searchInMeeting: (query: string) => Promise<{ enabled: boolean; results: any[] }>;
  generateLectureNotes: (opts?: { title?: string; course?: string }) => Promise<{ enabled: boolean; notes: any }>;
  generateDiagram: (text?: string) => Promise<{ enabled: boolean; diagram: any }>;
  getIntelligenceFlags: () => Promise<Array<{ key: string; enabled: boolean; setting: string; env: string; default: boolean }>>;
  setIntelligenceFlag: (key: string, value: boolean | null) => Promise<{ success: boolean; enabled?: boolean; error?: string }>;
  getHindsightConfig: () => Promise<{ baseUrl: string; hasApiKey: boolean; autoStart: boolean; serverCommand: string; llmProvider: string; available: boolean }>;
  setHindsightConfig: (cfg: { baseUrl?: string; apiKey?: string; autoStart?: boolean; serverCommand?: string; llmProvider?: string }) => Promise<{ success: boolean; healthy?: boolean; error?: string }>;
  testHindsightConnection: () => Promise<{ healthy: boolean; error?: string }>;
  updateMeetingTitle: (id: string, title: string) => Promise<boolean>;
  updateMeetingSummary: (
    id: string,
    updates: {
      overview?: string;
      actionItems?: string[];
      keyPoints?: string[];
      actionItemsTitle?: string;
      keyPointsTitle?: string;
    },
  ) => Promise<boolean>;
  onMeetingsUpdated: (callback: () => void) => () => void;

  // Eventos do modo de inteligência
  onIntelligenceAssistUpdate: (callback: (data: { insight: string }) => void) => () => void;
  onIntelligenceSuggestedAnswer: (
    callback: (data: { answer: string; question: string; confidence: number }) => void,
  ) => () => void;
  onIntelligenceSuggestedAnswerDiscard: (
    callback: (data: { reason: string }) => void,
  ) => () => void;
  onIntelligenceCodeVerified: (
    callback: (data: { question: string; passed: number; total: number; language: string }) => void,
  ) => () => void;
  onIntelligenceCodeCorrection: (
    callback: (data: { question: string; answer: string; note: string; reVerified: boolean }) => void,
  ) => () => void;
  onIntelligenceRefinedAnswer: (
    callback: (data: { answer: string; intent: string }) => void,
  ) => () => void;
  onIntelligenceRecap: (callback: (data: { summary: string }) => void) => () => void;
  onIntelligenceClarify: (callback: (data: { clarification: string }) => void) => () => void;
  onIntelligenceClarifyToken: (callback: (data: { token: string }) => void) => () => void;
  onIntelligenceManualStarted: (callback: () => void) => () => void;
  onIntelligenceManualResult: (
    callback: (data: { answer: string; question: string }) => void,
  ) => () => void;
  onIntelligenceModeChanged: (callback: (data: { mode: string }) => void) => () => void;
  onIntelligenceError: (callback: (data: { error: string; mode: string }) => void) => () => void;
  // Sprint 7: canal dedicado de coaching de negociação. Substitui o
  // multiplex de strings sentinela através suggested_answer_token / suggested_answer.
  onIntelligenceNegotiationCoaching: (callback: (data: { payload: any }) => void) => () => void;
  // Sprint 9: canal de tokens IPC com lotes temporais. Transporta um lote de tokens
  // de transmissão para qualquer um dos 5 tipos de transmissão em uma única mensagem IPC.
  // Substitui o envio por token para os 5 canais individuais (que ainda existem como
  // pontes de defesa em profundidade não utilizadas).
  onIntelligenceTokenBatch: (
    callback: (data: {
      kind: 'suggested_answer' | 'refined_answer' | 'recap' | 'clarify' | 'follow_up_questions';
      items: any[];
    }) => void,
  ) => () => void;

  // Gerenciamento de modelo
  getDefaultModel: () => Promise<{ model: string }>;
  setModel: (modelId: string) => Promise<{ success: boolean; error?: string }>;
  setDefaultModel: (modelId: string) => Promise<{ success: boolean; error?: string }>;
  toggleModelSelector: (coords: { x: number; y: number; activate?: boolean }) => Promise<void>;
  modelSelectorCloseIfOpen: () => Promise<void>;
  forceRestartOllama: () => Promise<void>;

  // Janela de configurações
  toggleSettingsWindow: (coords?: { x: number; y: number }) => Promise<void>;

  // Modo de texto rápido Groq
  getGroqFastTextMode: () => Promise<{ enabled: boolean }>;
  setGroqFastTextMode: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  getCodexCliConfig: () => Promise<{
    enabled: boolean;
    path: string;
    model: string;
    fastModel: string;
    timeoutMs: number;
  }>;
  setCodexCliConfig: (config: {
    enabled: boolean;
    path: string;
    model: string;
    fastModel: string;
    timeoutMs: number;
  }) => Promise<{
    success: boolean;
    error?: string;
    config?: {
      enabled: boolean;
      path: string;
      model: string;
      fastModel: string;
      timeoutMs: number;
    };
  }>;
  testCodexCli: (config?: {
    enabled?: boolean;
    path?: string;
    model?: string;
    fastModel?: string;
    timeoutMs?: number;
  }) => Promise<{
    success: boolean;
    error?: string;
    resolvedPath?: string;
    config?: {
      enabled: boolean;
      path: string;
      model: string;
      fastModel: string;
      timeoutMs: number;
    };
  }>;

  // Demo
  seedDemo: () => Promise<{ success: boolean }>;

  // Provedores personalizados
  saveCustomProvider: (provider: any) => Promise<{ success: boolean; id?: string; error?: string }>;
  getCustomProviders: () => Promise<any[]>;
  deleteCustomProvider: (id: string) => Promise<{ success: boolean; error?: string }>;

  // E-mail de acompanhamento
  generateFollowupEmail: (input: any) => Promise<string>;
  extractEmailsFromTranscript: (transcript: Array<{ text: string }>) => Promise<string[]>;
  getCalendarAttendees: (eventId: string) => Promise<Array<{ email: string; name: string }>>;
  openMailto: (params: {
    to: string;
    subject: string;
    body: string;
  }) => Promise<{ success: boolean; error?: string }>;

  // Teste de áudio
  startAudioTest: (deviceId?: string) => Promise<{ success: boolean }>;
  stopAudioTest: () => Promise<{ success: boolean }>;
  onAudioTestLevel: (callback: (level: number) => void) => () => void;
  // UX4: sonda de áudio do sistema em paralelo — nível de áudio do sistema + eventos de erro
  // emitidos durante o mesmo ciclo de vida do startAudioTest.
  onAudioTestSystemLevel: (callback: (level: number) => void) => () => void;
  onAudioTestSystemError: (callback: (errorMessage: string) => void) => () => void;

  // Banco de dados
  flushDatabase: () => Promise<{ success: boolean }>;
  showWindow: () => Promise<void>;
  hideWindow: () => Promise<void>;
  showOverlay: () => Promise<void>;
  hideOverlay: () => Promise<void>;
  getMeetingActive: () => Promise<boolean>;
  onMeetingStateChanged: (callback: (data: { isActive: boolean }) => void) => () => void;
  onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => () => void;
  onEnsureExpanded: (callback: () => void) => () => void;
  onToggleExpand: (callback: () => void) => () => void;
  toggleAdvancedSettings: () => Promise<void>;
  openSettingsTab: (tab: string) => Promise<void>;
  onOpenSettingsTab: (callback: (tab: string) => void) => () => void;
  setOverlayMousePassthrough: (enabled: boolean) => Promise<{ success: boolean }>;
  toggleOverlayMousePassthrough: () => Promise<{ success: boolean; enabled: boolean }>;
  getOverlayMousePassthrough: () => Promise<boolean>;
  // Hover-gated click-through: verdadeiro quando o ponteiro está sobre o painel pintado,
  // falso quando sobre as margens transparentes da sobreposição de largura fixa (então os cliques
  // passam para o aplicativo por trás). Afeta apenas o modo interativo (não oculto).
  setOverlayInteractiveRegion: (overContent: boolean) => Promise<{ success: boolean }>;
  onOverlayMousePassthroughChanged: (callback: (enabled: boolean) => void) => () => void;

  // Ouvintes de transmissão
  streamGeminiChat: (
    message: string,
    imagePaths?: string[],
    context?: string,
    options?: { skipSystemPrompt?: boolean; ignoreKnowledgeMode?: boolean },
  ) => Promise<void>;
  onGeminiStreamToken: (callback: (token: string, meta?: { streamId?: number }) => void) => () => void;
  onGeminiStreamDone: (callback: (data?: { finalText?: string; streamId?: number }) => void) => () => void;
  onGeminiStreamError: (callback: (error: string) => void) => () => void;

  onUndetectableChanged: (callback: (state: boolean) => void) => () => void;
  onGroqFastTextChanged: (callback: (enabled: boolean) => void) => () => void;
  onModelChanged: (callback: (modelId: string) => void) => () => void;

  // Ollama
  onOllamaPullProgress: (
    callback: (data: { status: string; percent: number }) => void,
  ) => () => void;
  onOllamaPullComplete: (callback: () => void) => () => void;

  // API de tema
  getThemeMode: () => Promise<{ mode: 'system' | 'light' | 'dark'; resolved: 'light' | 'dark' }>;
  setThemeMode: (mode: 'system' | 'light' | 'dark') => Promise<void>;
  onThemeChanged: (
    callback: (data: { mode: 'system' | 'light' | 'dark'; resolved: 'light' | 'dark' }) => void,
  ) => () => void;

  // Calendário
  calendarConnect: () => Promise<{ success: boolean; error?: string }>;
  calendarDisconnect: () => Promise<{ success: boolean; error?: string }>;
  getCalendarStatus: () => Promise<{ connected: boolean; email?: string }>;
  getUpcomingEvents: () => Promise<
    Array<{
      id: string;
      title: string;
      startTime: string;
      endTime: string;
      link?: string;
      source: 'google';
    }>
  >;
  calendarRefresh: () => Promise<{ success: boolean; error?: string }>;

  // Atualização automática
  onUpdateAvailable: (callback: (info: any) => void) => () => void;
  onUpdateDownloaded: (callback: (info: any) => void) => () => void;
  onUpdateChecking: (callback: () => void) => () => void;
  onUpdateNotAvailable: (callback: (info: any) => void) => () => void;
  onUpdateError: (callback: (err: string) => void) => () => void;
  onDownloadProgress: (callback: (progressObj: any) => void) => () => void;
  restartAndInstall: () => Promise<void>;
  checkForUpdates: () => Promise<void>;
  downloadUpdate: () => Promise<void>;
  getCanAutoUpdate: () => Promise<{ canAutoUpdate: boolean }>;
  testReleaseFetch: () => Promise<{ success: boolean; error?: string }>;

  // API de RAG (Geração Aumentada por Recuperação)
  ragQueryMeeting: (
    meetingId: string,
    query: string,
  ) => Promise<{ success?: boolean; fallback?: boolean; error?: string }>;
  ragQueryLive: (
    query: string,
  ) => Promise<{ success?: boolean; fallback?: boolean; error?: string }>;
  ragQueryGlobal: (
    query: string,
  ) => Promise<{ success?: boolean; fallback?: boolean; error?: string }>;
  ragCancelQuery: (options: {
    meetingId?: string;
    global?: boolean;
  }) => Promise<{ success: boolean }>;
  ragIsMeetingProcessed: (meetingId: string) => Promise<boolean>;
  ragGetQueueStatus: () => Promise<{
    pending: number;
    processing: number;
    completed: number;
    failed: number;
  }>;
  ragRetryEmbeddings: () => Promise<{ success: boolean }>;
  onRAGStreamChunk: (
    callback: (data: { meetingId?: string; global?: boolean; chunk: string }) => void,
  ) => () => void;
  onRAGStreamComplete: (
    callback: (data: { meetingId?: string; global?: boolean }) => void,
  ) => () => void;
  onRAGStreamError: (
    callback: (data: { meetingId?: string; global?: boolean; error: string }) => void,
  ) => () => void;

  // Gerenciamento de atalhos de teclado
  getKeybinds: () => Promise<
    Array<{
      id: string;
      label: string;
      accelerator: string;
      isGlobal: boolean;
      defaultAccelerator: string;
    }>
  >;
  setKeybind: (id: string, accelerator: string) => Promise<boolean>;
  resetKeybinds: () => Promise<
    Array<{
      id: string;
      label: string;
      accelerator: string;
      isGlobal: boolean;
      defaultAccelerator: string;
    }>
  >;
  onKeybindsUpdate: (callback: (keybinds: Array<any>) => void) => () => void;

  // Eventos de atalho global (oculto: disparados mesmo quando a janela não está em foco)
  onGlobalShortcut: (callback: (data: { action: string }) => void) => () => void;

  // Tap de teclado oculto com suporte a CGEventTap (macOS). Retorna falso em
  // não-macOS ou quando o módulo nativo / permissão de Acessibilidade está ausente.
  // Limpeza M5: três IPCs de consulta mortos foram removidos — nunca tinham
  // manipuladores não lado principal; o estado do tap chega via onStealthTapState em vez disso
  stealthTapAvailable: () => Promise<boolean>;
  stealthTapOpenSettings: () => Promise<void>;
  stealthTapStop: () => Promise<void>;
  stealthTapStart: () => Promise<boolean>;
  /** Falso não macOS quando uma IME de composição (Pinyin/Hangul/Kanji/…) está
   *  habilitada — o tap captura abaixo da IME e interrompe a composição, então
   *  o renderer retorna ao foco DOM simples ao clicar. */
  stealthTapShouldAutoEngage: () => Promise<boolean>;
  onStealthTapState: (cb: (state: { active: boolean; reason?: string }) => void) => () => void;
  onStealthKeyCaptured: (
    cb: (ev: { keyCode: number; chars: string; flags: number; isKeyDown: boolean }) => void,
  ) => () => void;

  // API de doação
  getDonationStatus: () => Promise<{
    shouldShow: boolean;
    hasDonated: boolean;
    lifetimeShows: number;
  }>;
  markDonationToastShown: () => Promise<{ success: boolean }>;
  setDonationComplete: () => Promise<{ success: boolean }>;

  // API do motor de perfil
  profileUploadResume: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  profileGetStatus: () => Promise<{
    hasProfile: boolean;
    profileMode: boolean;
    name?: string;
    role?: string;
    totalExperienceYears?: number;
  }>;
  profileSetMode: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  profileDelete: () => Promise<{ success: boolean; error?: string }>;
  profileGetProfile: () => Promise<any>;
  profileSelectFile: () => Promise<{
    success?: boolean;
    cancelled?: boolean;
    filePath?: string;
    error?: string;
  }>;

  // API de JD e pesquisa
  profileUploadJD: (filePath: string) => Promise<{ success: boolean; error?: string }>;
  profileDeleteJD: () => Promise<{ success: boolean; error?: string }>;
  profileResearchCompany: (
    companyName: string,
  ) => Promise<{ success: boolean; dossier?: any; error?: string }>;
  profileGenerateNegotiation: (
    force?: boolean,
  ) => Promise<{ success: boolean; script?: any; error?: string }>;
  profileGetNegotiationState: () => Promise<{
    success: boolean;
    state?: any;
    isActive?: boolean;
    error?: string;
  }>;
  profileResetNegotiation: () => Promise<{ success: boolean; error?: string }>;

  // API de busca Tavily
  setTavilyApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>;

  // Opacidade da sobreposição (modo oculto)
  setOverlayOpacity: (opacity: number) => Promise<void>;
  onOverlayOpacityChanged: (callback: (opacity: number) => void) => () => void;

  // Registro detalhado / depuração
  getVerboseLogging: () => Promise<boolean>;
  setVerboseLogging: (enabled: boolean) => Promise<{ success: boolean }>;
  getMeetingRetention: () => Promise<'forever' | '7d' | '30d' | 'never'>;
  setMeetingRetention: (
    retention: 'forever' | '7d' | '30d' | 'never',
  ) => Promise<{ success: boolean; error?: string }>;
  onMeetingRetentionChanged: (
    callback: (retention: 'forever' | '7d' | '30d' | 'never') => void,
  ) => () => void;
  getProviderDataScopes: () => Promise<{
    transcript?: boolean;
    screenshots?: boolean;
    reference_files?: boolean;
    profile_history?: boolean;
    embeddings?: boolean;
    post_call_summary?: boolean;
  }>;
  setProviderDataScopes: (scopes: {
    transcript?: boolean;
    screenshots?: boolean;
    reference_files?: boolean;
    profile_history?: boolean;
    embeddings?: boolean;
    post_call_summary?: boolean;
  }) => Promise<{ success: boolean; error?: string }>;
  onProviderDataScopesChanged: (
    callback: (scopes: {
      transcript?: boolean;
      screenshots?: boolean;
      reference_files?: boolean;
      profile_history?: boolean;
      embeddings?: boolean;
      post_call_summary?: boolean;
    }) => void,
  ) => () => void;
  getScreenUnderstandingMode: () => Promise<'vision_first' | 'vision_only' | 'private_vision'>;
  setScreenUnderstandingMode: (
    mode: 'vision_first' | 'vision_only' | 'private_vision',
  ) => Promise<{ success: boolean; error?: string }>;
  onScreenUnderstandingModeChanged: (
    callback: (mode: 'vision_first' | 'vision_only' | 'private_vision') => void,
  ) => () => void;
  getTechnicalInterviewVisionFirst: () => Promise<boolean>;
  setTechnicalInterviewVisionFirst: (
    enabled: boolean,
  ) => Promise<{ success: boolean; error?: string }>;
  onTechnicalInterviewVisionFirstChanged: (callback: (enabled: boolean) => void) => () => void;
  /** @obsoleto alias para technicalInterviewVisionFirst — mantido para que renderers mais antigos continuem funcionando. */
  getTechnicalInterviewDirectVision: () => Promise<boolean>;
  /** @obsoleto alias para technicalInterviewVisionFirst — mantido para que renderers mais antigos continuem funcionando. */
  setTechnicalInterviewDirectVision: (
    enabled: boolean,
  ) => Promise<{ success: boolean; error?: string }>;
  /** @obsoleto alias para technicalInterviewVisionFirstChanged — mantido para que renderers mais antigos continuem funcionando. */
  onTechnicalInterviewDirectVisionChanged: (callback: (enabled: boolean) => void) => () => void;
  getLogFilePath: () => Promise<string | null>;
  openLogFile: () => Promise<{ success: boolean; error?: string }>;

  // Onboarding e controle de sinalizadores persistentes de backup
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

  // API de recorte
  cropperConfirmed: (bounds: Electron.Rectangle) => void;
  cropperCancelled: () => void;
  onResetCropper: (
    callback: (data: { hudPosition: { x: number; y: number } }) => void,
  ) => () => void;

  // Plataforma
  platform: NodeJS.Platform;

  // Checkout PIX (AbacatePay)
  pixCreateCheckout: (params: { plan: string; email: string }) => Promise<{
    ok: boolean;
    checkoutId?: string;
    url?: string;
    error?: string;
  }>;
  pixPollLicense: (checkoutId: string) => Promise<{
    ok: boolean;
    /** pending = aguardando pagamento; activated = Pro já ligado; paid = pago mas requer ativação manual */
    status?: 'pending' | 'activated' | 'paid';
    licenseKey?: string;
    error?: string;
  }>;

  // Ativação de compras em segundo plano (main process é o dono do ciclo)
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

  // API de modos
  modesGetAll: () => Promise<
    Array<{
      id: string;
      name: string;
      templateType: string;
      customContext: string;
      isActive: boolean;
      createdAt: string;
      referenceFileCount: number;
    }>
  >;
  modesGetActive: () => Promise<{
    id: string;
    name: string;
    templateType: string;
    customContext: string;
    isActive: boolean;
    createdAt: string;
  } | null>;
  modesCreate: (params: {
    name: string;
    templateType: string;
  }) => Promise<{ success: boolean; mode?: any; error?: string }>;
  modesUpdate: (
    id: string,
    updates: { name?: string; templateType?: string; customContext?: string },
  ) => Promise<{ success: boolean; error?: string }>;
  modesDelete: (id: string) => Promise<{ success: boolean; error?: string }>;
  modesSetActive: (id: string | null) => Promise<{ success: boolean; error?: string }>;
  modesGetReferenceFiles: (
    modeId: string,
  ) => Promise<
    Array<{ id: string; modeId: string; fileName: string; content: string; createdAt: string }>
  >;
  modesUploadReferenceFile: (
    modeId: string,
  ) => Promise<{ success: boolean; cancelled?: boolean; file?: any; error?: string }>;
  modesDeleteReferenceFile: (id: string) => Promise<{ success: boolean; error?: string }>;
  modesGetReferenceFileStatus: (
    modeId: string,
  ) => Promise<{ success: boolean; statuses?: Array<{ fileId: string; fileName: string; status: string; chunkCount: number }>; error?: string }>;
  onModeFileIndexStatus: (callback: (data: { modeId: string; fileId?: string }) => void) => () => void;
  modesGetNoteSections: (modeId: string) => Promise<
    Array<{
      id: string;
      modeId: string;
      title: string;
      description: string;
      sortOrder: number;
      createdAt: string;
    }>
  >;
  modesAddNoteSection: (
    modeId: string,
    title: string,
    description: string,
  ) => Promise<{ success: boolean; section?: any; error?: string }>;
  modesUpdateNoteSection: (
    id: string,
    updates: { title?: string; description?: string },
  ) => Promise<{ success: boolean; error?: string }>;
  modesDeleteNoteSection: (id: string) => Promise<{ success: boolean; error?: string }>;
  modesRemoveAllNoteSections: (modeId: string) => Promise<{ success: boolean; error?: string }>;

  // Tema da interface de reunião — propagação entre janelas. A janela de configurações
  // escreve o novo tema não localStorage e chama `setMeetingInterfaceTheme`,
  // que envia um IPC ao principal que retransmite para todas as janelas, para que o
  // estado React da janela de overlay permaneça sincronizado com o do launcher. Sem
  // isso, o overlay lê o tema desatualizado na próxima reunião (travamento de meia-pintura).
  setMeetingInterfaceTheme: (theme: string) => void;
  onMeetingInterfaceThemeChanged: (callback: (theme: string) => void) => () => void;

  // Cancelar o gemini-chat-stream em andamento. O renderer conecta isso às ações
  // do usuário "soltar a resposta atual" (Escape, navegação, desmontagem do chat-overlay).
  // Sem cancelamento explícito, o manipulador IPC do chat mantém os tokens de transmissão que
  // o renderer descarta silenciosamente — desperdiçando a cota do provedor e parecendo lento
  // porque o primeiro token da questão subsequente tem que aguardar a resposta anterior
  // drenar através da verificação de supersessão.
  cancelChatStream: () => void;
  onDomContextReceived: (
    callback: (dom: string, meta?: DomCaptureMeta, envelope?: unknown) => void,
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

  // Language Learning API
  languageLearningTranslate: (data: { transcript: string; sourceLanguage: string; targetLanguage: string }) => Promise<void>;
  onLanguageLearningToken: (callback: (data: { token: string; accumulated: string }) => void) => () => void;
  onLanguageLearningDone: (callback: (data: { full: string; translation: string; suggestedReply: string }) => void) => () => void;
  onLanguageLearningError: (callback: (data: { error: string }) => void) => () => void;

  // Replica / Interview Coach API
  replicaStartSession: (data: { modeType: string; language: string; title?: string }) => Promise<{ sessionId?: string; error?: string }>;
  replicaAskQuestion: (data: { sessionId: string; userAnswer: string; isFirst: boolean; modeType: string; language: string; questionHistory: Array<{ question: string; difficulty: string; category: string; userAnswer: string; feedback: string }> }) => Promise<void>;
  replicaEndSession: (data: { sessionId: string; questionHistory: Array<{ question: string; difficulty: string; category: string; userAnswer: string; feedback: string }>; modeType: string; startTime: number }) => Promise<void>;
  replicaGetSessions: () => Promise<Array<{ id: string; mode_type: string; language: string; title: string; score: number | null; grade: string | null; duration_ms: number | null; created_at: string }>>;
  replicaGetSessionDetail: (sessionId: string) => Promise<any>;
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

  // LemonSqueezy — checkout Pro (espelha o contrato do pix:*)
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
}

export const PROCESSING_EVENTS = {
  // Estilos globais
  UNAUTHORIZED: 'processing-unauthorized',
  NO_SCREENSHOTS: 'processing-no-screenshots',

  //estados para gerar a solução inicial
  INITIAL_START: 'initial-start',
  PROBLEM_EXTRACTED: 'problem-extracted',
  SOLUTION_SUCCESS: 'solution-success',
  INITIAL_SOLUTION_ERROR: 'solution-error',

  //estados para processar a depuração
  DEBUG_START: 'debug-start',
  DEBUG_SUCCESS: 'debug-success',
  DEBUG_ERROR: 'debug-error',
} as const;

// Expõe a API do Electron ao processo renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // ── Pontes de avaliação APENAS PARA TESTE (controladas não principal por NODE_ENV==='test') ──────────────
  // Exposto incondicionalmente mas inerte em produção: os manipuladores IPC subjacentes
  // ('test-inject-transcript') recusam a menos que NODE_ENV==='test'. Usado pela avaliação
  // real da UI (intelligence-eval-real-ui) para fornecer o caminho da transmissão de produção
  // e ler metadados de depuração do perfil sem contornar a UI ou vazar conteúdo.
  __evalInjectTranscript: (segment: { speaker: string; text: string; timestamp?: number; final?: boolean }) =>
    ipcRenderer.invoke('test-inject-transcript', segment),
  __evalProfileDebug: () => ipcRenderer.invoke('profile:get-status'),
  updateContentDimensions: (dimensions: { width: number; height: number }) =>
    ipcRenderer.invoke('update-content-dimensions', dimensions),
  updateContentDimensionsCentered: (dimensions: { width: number; height: number }) =>
    ipcRenderer.invoke('update-content-dimensions-centered', dimensions),
  getRecognitionLanguages: () => ipcRenderer.invoke('get-recognition-languages'),
  takeScreenshot: () => ipcRenderer.invoke('take-screenshot'),
  takeSelectiveScreenshot: () => ipcRenderer.invoke('take-selective-screenshot'),
  getScreenshots: () => ipcRenderer.invoke('get-screenshots'),
  deleteScreenshot: (path: string) => ipcRenderer.invoke('delete-screenshot', path),

  // Ouvintes de eventos
  onScreenshotTaken: (callback: (data: { path: string; preview: string }) => void) => {
    const subscription = (_: any, data: { path: string; preview: string }) => callback(data);
    ipcRenderer.on('screenshot-taken', subscription);
    return () => {
      ipcRenderer.removeListener('screenshot-taken', subscription);
    };
  },
  onScreenshotAttached: (callback: (data: { path: string; preview: string }) => void) => {
    const subscription = (_: any, data: { path: string; preview: string }) => callback(data);
    ipcRenderer.on('screenshot-attached', subscription);
    return () => {
      ipcRenderer.removeListener('screenshot-attached', subscription);
    };
  },
  onCaptureAndProcess: (callback: (data: { path: string; preview: string }) => void) => {
    const subscription = (_: any, data: { path: string; preview: string }) => callback(data);
    ipcRenderer.on('capture-and-process', subscription);
    return () => {
      ipcRenderer.removeListener('capture-and-process', subscription);
    };
  },
  onSolutionsReady: (callback: (solutions: string) => void) => {
    const subscription = (_: any, solutions: string) => callback(solutions);
    ipcRenderer.on('solutions-ready', subscription);
    return () => {
      ipcRenderer.removeListener('solutions-ready', subscription);
    };
  },
  onResetView: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('reset-view', subscription);
    return () => {
      ipcRenderer.removeListener('reset-view', subscription);
    };
  },
  onSolutionStart: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on(PROCESSING_EVENTS.INITIAL_START, subscription);
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.INITIAL_START, subscription);
    };
  },
  onDebugStart: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on(PROCESSING_EVENTS.DEBUG_START, subscription);
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_START, subscription);
    };
  },

  onDebugSuccess: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('debug-success', subscription);
    return () => {
      ipcRenderer.removeListener('debug-success', subscription);
    };
  },
  onDebugError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error);
    ipcRenderer.on(PROCESSING_EVENTS.DEBUG_ERROR, subscription);
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_ERROR, subscription);
    };
  },
  onSolutionError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error);
    ipcRenderer.on(PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, subscription);
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, subscription);
    };
  },
  onProcessingNoScreenshots: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on(PROCESSING_EVENTS.NO_SCREENSHOTS, subscription);
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.NO_SCREENSHOTS, subscription);
    };
  },

  onProblemExtracted: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on(PROCESSING_EVENTS.PROBLEM_EXTRACTED, subscription);
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.PROBLEM_EXTRACTED, subscription);
    };
  },
  onSolutionSuccess: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on(PROCESSING_EVENTS.SOLUTION_SUCCESS, subscription);
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.SOLUTION_SUCCESS, subscription);
    };
  },
  onUnauthorized: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on(PROCESSING_EVENTS.UNAUTHORIZED, subscription);
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.UNAUTHORIZED, subscription);
    };
  },
  moveWindowLeft: () => ipcRenderer.invoke('move-window-left'),
  moveWindowRight: () => ipcRenderer.invoke('move-window-right'),
  moveWindowUp: () => ipcRenderer.invoke('move-window-up'),
  moveWindowDown: () => ipcRenderer.invoke('move-window-down'),
  windowMinimize: () => ipcRenderer.invoke('window-minimize'),
  windowMaximize: () => ipcRenderer.invoke('window-maximize'),
  windowClose: () => ipcRenderer.invoke('window-close'),
  windowIsMaximized: () => ipcRenderer.invoke('window-is-maximized'),

  analyzeImageFile: (path: string) => ipcRenderer.invoke('analyze-image-file', path),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  toggleWindow: () => ipcRenderer.invoke('toggle-window'),
  showWindow: (inactive?: boolean) => ipcRenderer.invoke('show-window', inactive),
  hideWindow: () => ipcRenderer.invoke('hide-window'),
  showOverlay: () => ipcRenderer.invoke('show-overlay'),
  hideOverlay: () => ipcRenderer.invoke('hide-overlay'),
  getMeetingActive: () => ipcRenderer.invoke('get-meeting-active'),
  onMeetingStateChanged: (callback: (data: { isActive: boolean }) => void) => {
    const subscription = (_: any, data: { isActive: boolean }) => callback(data);
    ipcRenderer.on('meeting-state-changed', subscription);
    return () => {
      ipcRenderer.removeListener('meeting-state-changed', subscription);
    };
  },
  onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => {
    const subscription = (_: any, isMaximized: boolean) => callback(isMaximized);
    ipcRenderer.on('window-maximized-changed', subscription);
    return () => {
      ipcRenderer.removeListener('window-maximized-changed', subscription);
    };
  },
  onEnsureExpanded: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('ensure-expanded', subscription);
    return () => {
      ipcRenderer.removeListener('ensure-expanded', subscription);
    };
  },
  toggleAdvancedSettings: () => ipcRenderer.invoke('toggle-advanced-settings'),
  openSettingsTab: (tab: string) => ipcRenderer.invoke('settings:open-tab', tab),
  onOpenSettingsTab: (callback: (tab: string) => void) => {
    const subscription = (_: any, tab: string) => callback(tab);
    ipcRenderer.on('settings:open-tab', subscription);
    return () => {
      ipcRenderer.removeListener('settings:open-tab', subscription);
    };
  },
  openExternal: (url: string) => ipcRenderer.invoke('open-external', url),
  // UX2: reparo de TCC não aplicativo. Retorna { ok, bundleId, results, promptRelaunch, mensagem }.
  // O renderer deve exibir a mensagem e solicitar que o usuário encerre e reabra completamente.
  repairTccPermissions: () => ipcRenderer.invoke('repair-tcc-permissions'),
  setUndetectable: (state: boolean) => ipcRenderer.invoke('set-undetectable', state),
  getUndetectable: () => ipcRenderer.invoke('get-undetectable'),
  setOverlayMousePassthrough: (enabled: boolean) =>
    ipcRenderer.invoke('set-overlay-mouse-passthrough', enabled),
  toggleOverlayMousePassthrough: () => ipcRenderer.invoke('toggle-overlay-mouse-passthrough'),
  getOverlayMousePassthrough: () => ipcRenderer.invoke('get-overlay-mouse-passthrough'),
  setOverlayInteractiveRegion: (overContent: boolean) =>
    ipcRenderer.invoke('set-overlay-interactive-region', overContent),
  setOpenAtLogin: (open: boolean) => ipcRenderer.invoke('set-open-at-login', open),
  getOpenAtLogin: () => ipcRenderer.invoke('get-open-at-login'),
  setDisguise: (mode: 'terminal' | 'settings' | 'activity' | 'none') =>
    ipcRenderer.invoke('set-disguise', mode),
  getDisguise: () => ipcRenderer.invoke('get-disguise'),
  onDisguiseChanged: (callback: (mode: 'terminal' | 'settings' | 'activity' | 'none') => void) => {
    const subscription = (_: any, mode: any) => callback(mode);
    ipcRenderer.on('disguise-changed', subscription);
    return () => {
      ipcRenderer.removeListener('disguise-changed', subscription);
    };
  },

  // Habilidades — instruções locais de SKILL.md exibidas nas Configurações e não overlay.
  skillsRefresh: () => ipcRenderer.invoke('skills:list'),
  skillsOpenFolder: () => ipcRenderer.invoke('skills:open-folder'),

  // Espelho do Telefone — transmite respostas de IA ao vivo para um telefone pareado pela LAN.
  phoneMirrorGetInfo: () => ipcRenderer.invoke('phone-mirror:get-info'),
  phoneMirrorEnable: (exposeOnLan: boolean) =>
    ipcRenderer.invoke('phone-mirror:enable', exposeOnLan),
  phoneMirrorDisable: () => ipcRenderer.invoke('phone-mirror:disable'),
  phoneMirrorSetLan: (exposeOnLan: boolean) =>
    ipcRenderer.invoke('phone-mirror:set-lan', exposeOnLan),
  phoneMirrorRotateToken: () => ipcRenderer.invoke('phone-mirror:rotate-token'),
  phoneMirrorArmExtension: () => ipcRenderer.invoke('phone-mirror:arm-extension'),
  phoneMirrorListTabs: () => ipcRenderer.invoke('phone-mirror:list-tabs'),
  phoneMirrorCaptureTab: (tabId: number) => ipcRenderer.invoke('phone-mirror:capture-tab', tabId),
  phoneMirrorRequestAutoContext: () => ipcRenderer.invoke('phone-mirror:request-auto-context'),
  phoneMirrorPushScreenshot: (screenshotPath?: string) =>
    ipcRenderer.invoke('phone-mirror:push-screenshot', screenshotPath),
  // Contexto do Navegador Inteligente v2 — configurações de captura automática.
  browserContextGetSettings: () => ipcRenderer.invoke('browser-context:get-settings'),
  browserContextSetSettings: (patch: Record<string, boolean>) =>
    ipcRenderer.invoke('browser-context:set-settings', patch),
  onPhoneMirrorStatus: (callback: (info: any) => void) => {
    const subscription = (_: any, info: any) => callback(info);
    ipcRenderer.on('phone-mirror:status', subscription);
    return () => {
      ipcRenderer.removeListener('phone-mirror:status', subscription);
    };
  },
  onPhoneMirrorIncomingChat: (callback: (data: { message: string; streamId: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('phone-mirror:incoming-chat', subscription);
    return () => {
      ipcRenderer.removeListener('phone-mirror:incoming-chat', subscription);
    };
  },

  onSettingsVisibilityChange: (callback: (isVisible: boolean) => void) => {
    const subscription = (_: any, isVisible: boolean) => callback(isVisible);
    ipcRenderer.on('settings-visibility-changed', subscription);
    return () => {
      ipcRenderer.removeListener('settings-visibility-changed', subscription);
    };
  },

  onToggleExpand: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('toggle-expand', subscription);
    return () => {
      ipcRenderer.removeListener('toggle-expand', subscription);
    };
  },

  // Gerenciamento de modelo LLM
  getCurrentLlmConfig: () => ipcRenderer.invoke('get-current-llm-config'),
  getAvailableOllamaModels: () => ipcRenderer.invoke('get-available-ollama-models'),
  switchToOllama: (model?: string, url?: string) =>
    ipcRenderer.invoke('switch-to-ollama', model, url),
  switchToGemini: (apiKey?: string, modelId?: string) =>
    ipcRenderer.invoke('switch-to-gemini', apiKey, modelId),
  testLlmConnection: (provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', apiKey?: string) =>
    ipcRenderer.invoke('test-llm-connection', provider, apiKey),
  selectServiceAccount: () => ipcRenderer.invoke('select-service-account'),

  // Gerenciamento de chave de API
  setGeminiApiKey: (apiKey: string) => ipcRenderer.invoke('set-gemini-api-key', apiKey),
  setGroqApiKey: (apiKey: string) => ipcRenderer.invoke('set-groq-api-key', apiKey),
  setOpenaiApiKey: (apiKey: string) => ipcRenderer.invoke('set-openai-api-key', apiKey),
  setClaudeApiKey: (apiKey: string) => ipcRenderer.invoke('set-claude-api-key', apiKey),
  setDeepseekApiKey: (apiKey: string) => ipcRenderer.invoke('set-deepseek-api-key', apiKey),
  setOpencodeZenApiKey: (apiKey: string) => ipcRenderer.invoke('set-opencode-zen-api-key', apiKey),
  setLitellmConfig: (config: { apiKey: string; baseURL: string; maxTokens?: number }) => ipcRenderer.invoke('set-litellm-config', config),
  getAvailableLiteLLMModels: () => ipcRenderer.invoke('get-available-litellm-models'),
  setRefractApiKey: (apiKey: string) => ipcRenderer.invoke('set-refract-api-key', apiKey),
  getRefractPricing: () => ipcRenderer.invoke('get-refract-pricing'),
  getRefractUsage: () => ipcRenderer.invoke('get-refract-usage'),
  getStoredCredentials: () => ipcRenderer.invoke('get-stored-credentials'),

  // Permissões
  checkPermissions: () => ipcRenderer.invoke('permissions:check'),
  requestMicPermission: () => ipcRenderer.invoke('permissions:request-mic'),

  // Iniciar período de teste
  startTrial: () => ipcRenderer.invoke('trial:start'),
  getTrialStatus: () => ipcRenderer.invoke('trial:status'),
  getLocalTrial: () => ipcRenderer.invoke('trial:get-local'),
  convertTrial: (choice: string) => ipcRenderer.invoke('trial:convert', choice),
  endTrialByok: () => ipcRenderer.invoke('trial:end-byok'),
  wipeTrialProfileData: () => ipcRenderer.invoke('trial:wipe-profile-data'),
  onTrialEnded: (cb: (data: { choice: string }) => void) => {
    const sub = (_: any, data: any) => cb(data);
    ipcRenderer.on('trial-ended', sub);
    return () => ipcRenderer.removeListener('trial-ended', sub);
  },

  // Gerenciamento de provedor STT
  setSttProvider: (
    provider:
      | 'none'
      | 'google'
      | 'groq'
      | 'openai'
      | 'deepgram'
      | 'elevenlabs'
      | 'azure'
      | 'ibmwatson'
      | 'soniox'
      | 'refract'
      | 'local-whisper',
  ) => ipcRenderer.invoke('set-stt-provider', provider),
  getSttProvider: () => ipcRenderer.invoke('get-stt-provider'),
  setGroqSttApiKey: (apiKey: string) => ipcRenderer.invoke('set-groq-stt-api-key', apiKey),
  setOpenAiSttApiKey: (apiKey: string) => ipcRenderer.invoke('set-openai-stt-api-key', apiKey),
  setOpenAiSttBaseUrl: (url: string) => ipcRenderer.invoke('set-openai-stt-base-url', url),
  setDeepgramApiKey: (apiKey: string) => ipcRenderer.invoke('set-deepgram-api-key', apiKey),
  setElevenLabsApiKey: (apiKey: string) => ipcRenderer.invoke('set-elevenlabs-api-key', apiKey),
  setAzureApiKey: (apiKey: string) => ipcRenderer.invoke('set-azure-api-key', apiKey),
  setAzureRegion: (region: string) => ipcRenderer.invoke('set-azure-region', region),
  setIbmWatsonApiKey: (apiKey: string) => ipcRenderer.invoke('set-ibmwatson-api-key', apiKey),
  setGroqSttModel: (model: string) => ipcRenderer.invoke('set-groq-stt-model', model),
  setSonioxApiKey: (apiKey: string) => ipcRenderer.invoke('set-soniox-api-key', apiKey),
  setIbmWatsonRegion: (region: string) => ipcRenderer.invoke('set-ibmwatson-region', region),
  testSttConnection: (
    provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox',
    apiKey: string,
    region?: string,
  ) => ipcRenderer.invoke('test-stt-connection', provider, apiKey, region),
  localWhisperGetModels: () => ipcRenderer.invoke('local-whisper-get-models'),
  localWhisperSetModel: (modelId: string) => ipcRenderer.invoke('local-whisper-set-model', modelId),
  localWhisperGetChannelConfig: () => ipcRenderer.invoke('local-whisper-get-channel-config'),
  localWhisperSetChannelConfig: (cfg: {
    enabled?: boolean;
    micModelId?: string;
    systemModelId?: string;
    globalModelId?: string;
  }) => ipcRenderer.invoke('local-whisper-set-channel-config', cfg),
  localWhisperDeleteModel: (modelId: string) =>
    ipcRenderer.invoke('local-whisper-delete-model', modelId),
  localWhisperStartDownload: (modelId: string) =>
    ipcRenderer.invoke('local-whisper-start-download', modelId),
  onLocalWhisperDownloadProgress: (cb: (data: { modelId: string; progress: number }) => void) => {
    const listener = (_: any, data: any) => cb(data);
    ipcRenderer.on('local-whisper-download-progress', listener);
    return () => ipcRenderer.removeListener('local-whisper-download-progress', listener);
  },
  onLocalWhisperDownloadComplete: (cb: (data: { modelId: string }) => void) => {
    const listener = (_: any, data: any) => cb(data);
    ipcRenderer.on('local-whisper-download-complete', listener);
    return () => ipcRenderer.removeListener('local-whisper-download-complete', listener);
  },
  onLocalWhisperDownloadError: (cb: (data: { modelId: string; error: string }) => void) => {
    const listener = (_: any, data: any) => cb(data);
    ipcRenderer.on('local-whisper-download-error', listener);
    return () => ipcRenderer.removeListener('local-whisper-download-error', listener);
  },
  localWhisperPreload: (modelId?: string) => ipcRenderer.invoke('local-whisper-preload', modelId),
  localWhisperGetHardware: () => ipcRenderer.invoke('local-whisper-get-hardware'),

  // Eventos de configuração STT (Adaptado do PR público #173 — verifica interação com premium)
  onSttConfigChanged: (callback: (data: { configured: boolean; provider: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('stt-config-changed', subscription);
    return () => {
      ipcRenderer.removeListener('stt-config-changed', subscription);
    };
  },
  onCredentialsChanged: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('credentials-changed', subscription);
    return () => {
      ipcRenderer.removeListener('credentials-changed', subscription);
    };
  },

  // Eventos do serviço de áudio nativo
  onNativeAudioTranscript: (
    callback: (transcript: { speaker: string; text: string; final: boolean }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('native-audio-transcript', subscription);
    return () => {
      ipcRenderer.removeListener('native-audio-transcript', subscription);
    };
  },
  onNativeAudioSuggestion: (
    callback: (suggestion: { context: string; lastQuestion: string; confidence: number }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('native-audio-suggestion', subscription);
    return () => {
      ipcRenderer.removeListener('native-audio-suggestion', subscription);
    };
  },
  onNativeAudioConnected: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('native-audio-connected', subscription);
    return () => {
      ipcRenderer.removeListener('native-audio-connected', subscription);
    };
  },
  onNativeAudioDisconnected: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('native-audio-disconnected', subscription);
    return () => {
      ipcRenderer.removeListener('native-audio-disconnected', subscription);
    };
  },
  onSuggestionGenerated: (
    callback: (data: { question: string; suggestion: string; confidence: number }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('suggestion-generated', subscription);
    return () => {
      ipcRenderer.removeListener('suggestion-generated', subscription);
    };
  },
  onSuggestionProcessingStart: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('suggestion-processing-start', subscription);
    return () => {
      ipcRenderer.removeListener('suggestion-processing-start', subscription);
    };
  },
  onSuggestionError: (callback: (error: { error: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('suggestion-error', subscription);
    return () => {
      ipcRenderer.removeListener('suggestion-error', subscription);
    };
  },
  generateSuggestion: (context: string, lastQuestion: string) =>
    ipcRenderer.invoke('generate-suggestion', context, lastQuestion),

  getNativeAudioStatus: () => ipcRenderer.invoke('native-audio-status'),
  getInputDevices: () => ipcRenderer.invoke('get-input-devices'),
  getOutputDevices: () => ipcRenderer.invoke('get-output-devices'),
  setRecognitionLanguage: (key: string) => ipcRenderer.invoke('set-recognition-language', key),
  getAiResponseLanguages: () => ipcRenderer.invoke('get-ai-response-languages'),
  setAiResponseLanguage: (language: string) =>
    ipcRenderer.invoke('set-ai-response-language', language),
  getSttLanguage: () => ipcRenderer.invoke('get-stt-language'),
  getAiResponseLanguage: () => ipcRenderer.invoke('get-ai-response-language'),
  onSttLanguageAutoDetected: (callback: (bcp47: string) => void) => {
    const subscription = (_: any, bcp47: string) => callback(bcp47);
    ipcRenderer.on('stt-language-auto-detected', subscription);
    return () => {
      ipcRenderer.removeListener('stt-language-auto-detected', subscription);
    };
  },
  onSystemAudioPermissionDenied: (callback: (message: string) => void) => {
    const subscription = (_: any, message: string) => callback(message);
    ipcRenderer.on('system-audio-permission-denied', subscription);
    return () => {
      ipcRenderer.removeListener('system-audio-permission-denied', subscription);
    };
  },
  getSystemAudioPermissionWarning: () => ipcRenderer.invoke('get-system-audio-permission-warning'),
  onDeviceSelectionApplied: (
    callback: (payload: {
      kind: 'input' | 'output';
      requested: string | null;
      actual: string | null;
      fellBack: boolean;
      reason?: string;
    }) => void,
  ) => {
    const subscription = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('device-selection-applied', subscription);
    return () => {
      ipcRenderer.removeListener('device-selection-applied', subscription);
    };
  },
  onAudioCaptureFailed: (
    callback: (payload: {
      channel: 'system' | 'mic';
      message: string;
      attempt: number;
      maxAttempts: number;
      terminal?: boolean;
      stuck?: boolean;
    }) => void,
  ) => {
    const subscription = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('audio-capture-failed', subscription);
    return () => {
      ipcRenderer.removeListener('audio-capture-failed', subscription);
    };
  },
  onAudioInputAutoSwitched: (
    callback: (payload: { from: string; to: string; reason: string; message?: string }) => void,
  ) => {
    const subscription = (_: any, payload: any) => callback(payload);
    ipcRenderer.on('audio-input-auto-switched', subscription);
    return () => {
      ipcRenderer.removeListener('audio-input-auto-switched', subscription);
    };
  },

  // Eventos de status STT
  onSttStatusChanged: (
    callback: (data: {
      state: 'connected' | 'reconnecting' | 'failed';
      provider: string;
      error?: string;
      channel: 'user' | 'interviewer';
      reconnectAttempts?: number;
    }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('stt-status', subscription);
    return () => {
      ipcRenderer.removeListener('stt-status', subscription);
    };
  },

  // IPC do modo de inteligência
  generateAssist: () => ipcRenderer.invoke('generate-assist'),
  generateWhatToSay: (
    question?: string,
    imagePaths?: string[],
    options?: { promptInstruction?: string; domContext?: string; domContextEnvelope?: unknown },
  ) => ipcRenderer.invoke('generate-what-to-say', question, imagePaths, options),
  generateClarify: () => ipcRenderer.invoke('generate-clarify'),
  generateCodeHint: (imagePaths?: string[], problemStatement?: string) =>
    ipcRenderer.invoke('generate-code-hint', imagePaths, problemStatement),
  generateBrainstorm: (imagePaths?: string[], problemStatement?: string) =>
    ipcRenderer.invoke('generate-brainstorm', imagePaths, problemStatement),
  generateFollowUp: (intent: string, userRequest?: string) =>
    ipcRenderer.invoke('generate-follow-up', intent, userRequest),
  generateFollowUpQuestions: () => ipcRenderer.invoke('generate-follow-up-questions'),
  generateRecap: () => ipcRenderer.invoke('generate-recap'),
  submitManualQuestion: (question: string) =>
    ipcRenderer.invoke('submit-manual-question', question),
  getIntelligenceContext: () => ipcRenderer.invoke('get-intelligence-context'),
  testInjectTranscript: (segment: {
    speaker: string;
    text: string;
    timestamp?: number;
    final?: boolean;
  }) => ipcRenderer.invoke('test-inject-transcript', segment),
  testGetModeContext: () => ipcRenderer.invoke('test-get-mode-context'),
  resetIntelligence: () => ipcRenderer.invoke('reset-intelligence'),

  // Modo de botão de ação (alternância dinâmica Recap / Brainstorm)
  getActionButtonMode: () => ipcRenderer.invoke('get-action-button-mode'),
  setActionButtonMode: (mode: 'recap' | 'brainstorm') =>
    ipcRenderer.invoke('set-action-button-mode', mode),
  onActionButtonModeChanged: (callback: (mode: 'recap' | 'brainstorm') => void) => {
    const subscription = (_: any, mode: 'recap' | 'brainstorm') => callback(mode);
    ipcRenderer.on('action-button-mode-changed', subscription);
    return () => {
      ipcRenderer.removeListener('action-button-mode-changed', subscription);
    };
  },

  onModeChanged: (callback: (data: { id: string | null; name: string | null }) => void) => {
    const subscription = (_: any, data: { id: string | null; name: string | null }) =>
      callback(data);
    ipcRenderer.on('mode-changed', subscription);
    return () => {
      ipcRenderer.removeListener('mode-changed', subscription);
    };
  },

  // Ciclo de vida da reunião
  startMeeting: (metadata?: any) => ipcRenderer.invoke('start-meeting', metadata),
  endMeeting: () => ipcRenderer.invoke('end-meeting'),
  finalizeMicSTT: () => ipcRenderer.invoke('finalize-mic-stt'),
  getRecentMeetings: () => ipcRenderer.invoke('get-recent-meetings'),
  getMeetingDetails: (id: string) => ipcRenderer.invoke('get-meeting-details', id),
  searchGlobalMeetings: (query: string, filters?: any) => ipcRenderer.invoke('search:global-meetings', { query, filters }),
  searchInMeeting: (query: string) => ipcRenderer.invoke('search:in-meeting', { query }),
  generateLectureNotes: (opts?: { title?: string; course?: string }) => ipcRenderer.invoke('lecture:generate-notes', opts),
  generateDiagram: (text?: string) => ipcRenderer.invoke('diagram:generate', { text }),
  getIntelligenceFlags: () => ipcRenderer.invoke('intelligence-flags:get'),
  setIntelligenceFlag: (key: string, value: boolean | null) => ipcRenderer.invoke('intelligence-flags:set', { key, value }),
  getHindsightConfig: () => ipcRenderer.invoke('hindsight-config:get'),
  setHindsightConfig: (cfg: { baseUrl?: string; apiKey?: string; autoStart?: boolean; serverCommand?: string; llmProvider?: string }) => ipcRenderer.invoke('hindsight-config:set', cfg),
  testHindsightConnection: () => ipcRenderer.invoke('hindsight-config:test'),
  updateMeetingTitle: (id: string, title: string) =>
    ipcRenderer.invoke('update-meeting-title', { id, title }),
  updateMeetingSummary: (id: string, updates: any) =>
    ipcRenderer.invoke('update-meeting-summary', { id, updates }),
  regenerateMeetingSummary: (id: string, opts?: { templateType?: string; tone?: 'professional' | 'warm' | 'concise' | 'friendly' }) =>
    ipcRenderer.invoke('regenerate-meeting-summary', { id, templateType: opts?.templateType, tone: opts?.tone }),
  regenerateMeetingFollowUp: (id: string, tone?: 'professional' | 'warm' | 'concise' | 'friendly') =>
    ipcRenderer.invoke('regenerate-meeting-followup', { id, tone }),
  updateMeetingSpeakerLabels: (id: string, labels: Record<string, string>) =>
    ipcRenderer.invoke('update-meeting-speaker-labels', { id, labels }),
  deleteMeeting: (id: string) => ipcRenderer.invoke('delete-meeting', id),

  onMeetingsUpdated: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('meetings-updated', subscription);
    return () => {
      ipcRenderer.removeListener('meetings-updated', subscription);
    };
  },

  // Modo de Janela
  setWindowMode: (mode: 'launcher' | 'overlay', inactive?: boolean) =>
    ipcRenderer.invoke('set-window-mode', mode, inactive),

  // Eventos do modo de inteligência
  onIntelligenceAssistUpdate: (callback: (data: { insight: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-assist-update', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-assist-update', subscription);
    };
  },
  // Fase 3 — Cartões de Ação Dinâmicos
  onIntelligenceDynamicAction: (callback: (data: { action: any }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-dynamic-action', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-dynamic-action', subscription);
    };
  },
  acceptDynamicAction: (actionId: string) => ipcRenderer.invoke('dynamic-action:accept', actionId),
  dismissDynamicAction: (actionId: string) =>
    ipcRenderer.invoke('dynamic-action:dismiss', actionId),
  listDynamicActions: () => ipcRenderer.invoke('dynamic-action:list'),
  onIntelligenceSuggestedAnswerToken: (
    callback: (data: { token: string; question: string; confidence: number }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-suggested-answer-token', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-suggested-answer-token', subscription);
    };
  },
  onIntelligenceSuggestedAnswer: (
    callback: (data: { answer: string; question: string; confidence: number }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-suggested-answer', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-suggested-answer', subscription);
    };
  },
  // Correção de scaffolding órfão: descarta a linha de scaffolding aberta do what-to-answer quando a
  // transmissão termina sem resposta final (substituída / recusada / com erro).
  onIntelligenceSuggestedAnswerDiscard: (
    callback: (data: { reason: string }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-suggested-answer-discard', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-suggested-answer-discard', subscription);
    };
  },
  // Execução de código verificada: ✓ badge quando o código exibido passou nos testes executados.
  onIntelligenceCodeVerified: (
    callback: (data: { question: string; passed: number; total: number; language: string }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-code-verified', subscription);
    return () => { ipcRenderer.removeListener('intelligence-code-verified', subscription); };
  },
  // Execução de código verificada: nova mensagem corrigida quando o código exibido falhou.
  onIntelligenceCodeCorrection: (
    callback: (data: { question: string; answer: string; note: string; reVerified: boolean }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-code-correction', subscription);
    return () => { ipcRenderer.removeListener('intelligence-code-correction', subscription); };
  },
  // Sprint 7: canal dedicado de coaching de negociação.
  onIntelligenceNegotiationCoaching: (callback: (data: { payload: any }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-negotiation-coaching', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-negotiation-coaching', subscription);
    };
  },
  // Sprint 9: canal IPC de tokens em lote temporal.
  onIntelligenceTokenBatch: (callback: (data: { kind: string; items: any[] }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-token-batch', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-token-batch', subscription);
    };
  },
  onIntelligenceRefinedAnswerToken: (
    callback: (data: { token: string; intent: string }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-refined-answer-token', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-refined-answer-token', subscription);
    };
  },
  onIntelligenceRefinedAnswer: (callback: (data: { answer: string; intent: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-refined-answer', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-refined-answer', subscription);
    };
  },
  onIntelligenceRecapToken: (callback: (data: { token: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-recap-token', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-recap-token', subscription);
    };
  },
  onIntelligenceRecap: (callback: (data: { summary: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-recap', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-recap', subscription);
    };
  },
  onIntelligenceClarifyToken: (callback: (data: { token: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-clarify-token', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-clarify-token', subscription);
    };
  },
  onIntelligenceClarify: (callback: (data: { clarification: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-clarify', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-clarify', subscription);
    };
  },
  onIntelligenceFollowUpQuestionsToken: (callback: (data: { token: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-follow-up-questions-token', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-follow-up-questions-token', subscription);
    };
  },
  onIntelligenceFollowUpQuestionsUpdate: (callback: (data: { questions: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-follow-up-questions-update', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-follow-up-questions-update', subscription);
    };
  },
  onIntelligenceManualStarted: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('intelligence-manual-started', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-manual-started', subscription);
    };
  },
  onIntelligenceManualResult: (callback: (data: { answer: string; question: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-manual-result', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-manual-result', subscription);
    };
  },
  onIntelligenceModeChanged: (callback: (data: { mode: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-mode-changed', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-mode-changed', subscription);
    };
  },
  onIntelligenceError: (callback: (data: { error: string; mode: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('intelligence-error', subscription);
    return () => {
      ipcRenderer.removeListener('intelligence-error', subscription);
    };
  },
  onSessionReset: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('session-reset', subscription);
    return () => {
      ipcRenderer.removeListener('session-reset', subscription);
    };
  },

  // Chat com transmissão
  streamGeminiChat: (
    message: string,
    imagePaths?: string[],
    context?: string,
    options?: { skipSystemPrompt?: boolean; ignoreKnowledgeMode?: boolean },
  ) => ipcRenderer.invoke('gemini-chat-stream', message, imagePaths, context, options),

  onGeminiStreamToken: (callback: (token: string, meta?: { streamId?: number }) => void) => {
    // meta é um argumento opcional de 2ª posição contendo { streamId } (achado de auditoria #3). Os callbacks
    // (token) existentes ignoram-no; o renderer usa-o para descartar tokens de transações desatualizadas.
    const subscription = (_: any, token: string, meta?: { streamId?: number }) => callback(token, meta);
    ipcRenderer.on('gemini-stream-token', subscription);
    return () => {
      ipcRenderer.removeListener('gemini-stream-token', subscription);
    };
  },

  onGeminiStreamDone: (callback: (data?: { finalText?: string; streamId?: number }) => void) => {
    const subscription = (_: any, data?: { finalText?: string; streamId?: number }) => callback(data);
    ipcRenderer.on('gemini-stream-done', subscription);
    return () => {
      ipcRenderer.removeListener('gemini-stream-done', subscription);
    };
  },

  onGeminiStreamError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error);
    ipcRenderer.on('gemini-stream-error', subscription);
    return () => {
      ipcRenderer.removeListener('gemini-stream-error', subscription);
    };
  },

  // Gerenciamento de modelo
  getDefaultModel: () => ipcRenderer.invoke('get-default-model'),
  setModel: (modelId: string) => ipcRenderer.invoke('set-model', modelId),
  setDefaultModel: (modelId: string) => ipcRenderer.invoke('set-default-model', modelId),
  toggleModelSelector: (coords: { x: number; y: number; activate?: boolean }) =>
    ipcRenderer.invoke('toggle-model-selector', coords),
  modelSelectorCloseIfOpen: () => ipcRenderer.invoke('model-selector:close-if-open'),
  forceRestartOllama: () => ipcRenderer.invoke('force-restart-ollama'),

  // Janela de configurações
  toggleSettingsWindow: (coords?: { x: number; y: number }) =>
    ipcRenderer.invoke('toggle-settings-window', coords),

  // Modo de texto rápido Groq
  getGroqFastTextMode: () => ipcRenderer.invoke('get-groq-fast-text-mode'),
  setGroqFastTextMode: (enabled: boolean) => ipcRenderer.invoke('set-groq-fast-text-mode', enabled),
  getCodexCliConfig: () => ipcRenderer.invoke('get-codex-cli-config'),
  setCodexCliConfig: (config: {
    enabled: boolean;
    path: string;
    model: string;
    fastModel: string;
    timeoutMs: number;
  }) => ipcRenderer.invoke('set-codex-cli-config', config),
  testCodexCli: (config?: {
    enabled?: boolean;
    path?: string;
    model?: string;
    fastModel?: string;
    timeoutMs?: number;
  }) => ipcRenderer.invoke('test-codex-cli', config),

  // Demo
  seedDemo: () => ipcRenderer.invoke('seed-demo'),

  // Provedores personalizados
  saveCustomProvider: (provider: any) => ipcRenderer.invoke('save-custom-provider', provider),
  getCustomProviders: () => ipcRenderer.invoke('get-custom-providers'),
  deleteCustomProvider: (id: string) => ipcRenderer.invoke('delete-custom-provider', id),

  // E-mail de acompanhamento
  generateFollowupEmail: (input: any) => ipcRenderer.invoke('generate-followup-email', input),
  extractEmailsFromTranscript: (transcript: Array<{ text: string }>) =>
    ipcRenderer.invoke('extract-emails-from-transcript', transcript),
  getCalendarAttendees: (eventId: string) => ipcRenderer.invoke('get-calendar-attendees', eventId),
  openMailto: (params: { to: string; subject: string; body: string }) =>
    ipcRenderer.invoke('open-mailto', params),

  // Teste de áudio
  startAudioTest: (deviceId?: string) => ipcRenderer.invoke('start-audio-test', deviceId),
  stopAudioTest: () => ipcRenderer.invoke('stop-audio-test'),
  onAudioTestLevel: (callback: (level: number) => void) => {
    const subscription = (_: any, level: number) => callback(level);
    ipcRenderer.on('audio-test-level', subscription);
    return () => {
      ipcRenderer.removeListener('audio-test-level', subscription);
    };
  },
  // UX4: medição de nível de áudio do sistema em paralelo. Conectado durante o
  // startAudioTest existente para que os usuários vejam os níveis de áudio do microfone
  // E do sistema nas Configurações antes de iniciar uma reunião.
  onAudioTestSystemLevel: (callback: (level: number) => void) => {
    const subscription = (_: any, level: number) => callback(level);
    ipcRenderer.on('audio-test-system-level', subscription);
    return () => {
      ipcRenderer.removeListener('audio-test-system-level', subscription);
    };
  },
  onAudioTestSystemError: (callback: (errorMessage: string) => void) => {
    const subscription = (_: any, errorMessage: string) => callback(errorMessage);
    ipcRenderer.on('audio-test-system-error', subscription);
    return () => {
      ipcRenderer.removeListener('audio-test-system-error', subscription);
    };
  },

  // Banco de dados
  flushDatabase: () => ipcRenderer.invoke('flush-database'),

  onUndetectableChanged: (callback: (state: boolean) => void) => {
    const subscription = (_: any, state: boolean) => callback(state);
    ipcRenderer.on('undetectable-changed', subscription);
    return () => {
      ipcRenderer.removeListener('undetectable-changed', subscription);
    };
  },

  onOverlayMousePassthroughChanged: (callback: (enabled: boolean) => void) => {
    const subscription = (_: any, enabled: boolean) => callback(enabled);
    ipcRenderer.on('overlay-mouse-passthrough-changed', subscription);
    return () => {
      ipcRenderer.removeListener('overlay-mouse-passthrough-changed', subscription);
    };
  },

  onGroqFastTextChanged: (callback: (enabled: boolean) => void) => {
    const subscription = (_: any, enabled: boolean) => callback(enabled);
    ipcRenderer.on('groq-fast-text-changed', subscription);
    return () => {
      ipcRenderer.removeListener('groq-fast-text-changed', subscription);
    };
  },

  onModelChanged: (callback: (modelId: string) => void) => {
    const subscription = (_: any, modelId: string) => callback(modelId);
    ipcRenderer.on('model-changed', subscription);
    return () => {
      ipcRenderer.removeListener('model-changed', subscription);
    };
  },

  onOllamaPullProgress: (callback: (data: { status: string; percent: number }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('ollama:pull-progress', subscription);
    return () => {
      ipcRenderer.removeListener('ollama:pull-progress', subscription);
    };
  },

  onOllamaPullComplete: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('ollama:pull-complete', subscription);
    return () => {
      ipcRenderer.removeListener('ollama:pull-complete', subscription);
    };
  },

  // API de tema
  getThemeMode: () => ipcRenderer.invoke('theme:get-mode'),
  setThemeMode: (mode: 'system' | 'light' | 'dark') => ipcRenderer.invoke('theme:set-mode', mode),
  onThemeChanged: (
    callback: (data: { mode: 'system' | 'light' | 'dark'; resolved: 'light' | 'dark' }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('theme:changed', subscription);
    return () => {
      ipcRenderer.removeListener('theme:changed', subscription);
    };
  },

  // API de Calendário
  calendarConnect: () => ipcRenderer.invoke('calendar-connect'),
  calendarDisconnect: () => ipcRenderer.invoke('calendar-disconnect'),
  getCalendarStatus: () => ipcRenderer.invoke('get-calendar-status'),
  getUpcomingEvents: () => ipcRenderer.invoke('get-upcoming-events'),
  calendarRefresh: () => ipcRenderer.invoke('calendar-refresh'),

  // Atualização automática
  onUpdateAvailable: (callback: (info: any) => void) => {
    const subscription = (_: any, info: any) => callback(info);
    ipcRenderer.on('update-available', subscription);
    return () => {
      ipcRenderer.removeListener('update-available', subscription);
    };
  },
  onUpdateDownloaded: (callback: (info: any) => void) => {
    const subscription = (_: any, info: any) => callback(info);
    ipcRenderer.on('update-downloaded', subscription);
    return () => {
      ipcRenderer.removeListener('update-downloaded', subscription);
    };
  },
  onUpdateChecking: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('update-checking', subscription);
    return () => {
      ipcRenderer.removeListener('update-checking', subscription);
    };
  },
  onUpdateNotAvailable: (callback: (info: any) => void) => {
    const subscription = (_: any, info: any) => callback(info);
    ipcRenderer.on('update-not-available', subscription);
    return () => {
      ipcRenderer.removeListener('update-not-available', subscription);
    };
  },
  onUpdateError: (callback: (err: string) => void) => {
    const subscription = (_: any, err: string) => callback(err);
    ipcRenderer.on('update-error', subscription);
    return () => {
      ipcRenderer.removeListener('update-error', subscription);
    };
  },
  onDownloadProgress: (callback: (progressObj: any) => void) => {
    const subscription = (_: any, progressObj: any) => callback(progressObj);
    ipcRenderer.on('download-progress', subscription);
    return () => {
      ipcRenderer.removeListener('download-progress', subscription);
    };
  },
  restartAndInstall: () => ipcRenderer.invoke('quit-and-install-update'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('download-update'),
  getCanAutoUpdate: () => ipcRenderer.invoke('get-can-auto-update'),
  testReleaseFetch: () => ipcRenderer.invoke('test-release-fetch'),

  // API de RAG
  ragQueryMeeting: (meetingId: string, query: string) =>
    ipcRenderer.invoke('rag:query-meeting', { meetingId, query }),
  ragQueryLive: (query: string) => ipcRenderer.invoke('rag:query-live', { query }),
  ragQueryGlobal: (query: string) => ipcRenderer.invoke('rag:query-global', { query }),
  ragCancelQuery: (options: { meetingId?: string; global?: boolean }) =>
    ipcRenderer.invoke('rag:cancel-query', options),
  ragIsMeetingProcessed: (meetingId: string) =>
    ipcRenderer.invoke('rag:is-meeting-processed', meetingId),
  ragGetQueueStatus: () => ipcRenderer.invoke('rag:get-queue-status'),
  ragRetryEmbeddings: () => ipcRenderer.invoke('rag:retry-embeddings'),

  onIncompatibleProviderWarning: (
    callback: (data: { count: number; oldProvider: string; newProvider: string }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('embedding:incompatible-provider-warning', subscription);
    return () => {
      ipcRenderer.removeListener('embedding:incompatible-provider-warning', subscription);
    };
  },
  // Progresso de reindexação automática em segundo plano (disparado quando o espaço de embeddings muda,
  // ex. após o modelo de embedding Gemini ser atualizado → progresso* → completo
  onReindexProgress: (
    callback: (
      phase: 'started' | 'progress' | 'complete',
      data: { count?: number; done?: number; total?: number; space?: string; partial?: boolean },
    ) => void,
  ) => {
    const onStarted = (_: any, data: any) => callback('started', data);
    const onProgress = (_: any, data: any) => callback('progress', data);
    const onComplete = (_: any, data: any) => callback('complete', data);
    ipcRenderer.on('embedding:reindex-started', onStarted);
    ipcRenderer.on('embedding:reindex-progress', onProgress);
    ipcRenderer.on('embedding:reindex-complete', onComplete);
    return () => {
      ipcRenderer.removeListener('embedding:reindex-started', onStarted);
      ipcRenderer.removeListener('embedding:reindex-progress', onProgress);
      ipcRenderer.removeListener('embedding:reindex-complete', onComplete);
    };
  },
  reindexIncompatibleMeetings: () => ipcRenderer.invoke('rag:reindex-incompatible-meetings'),

  onRAGStreamChunk: (
    callback: (data: { meetingId?: string; global?: boolean; chunk: string }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('rag:stream-chunk', subscription);
    return () => {
      ipcRenderer.removeListener('rag:stream-chunk', subscription);
    };
  },
  onRAGStreamComplete: (callback: (data: { meetingId?: string; global?: boolean }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('rag:stream-complete', subscription);
    return () => {
      ipcRenderer.removeListener('rag:stream-complete', subscription);
    };
  },
  onRAGStreamError: (
    callback: (data: { meetingId?: string; global?: boolean; error: string }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('rag:stream-error', subscription);
    return () => {
      ipcRenderer.removeListener('rag:stream-error', subscription);
    };
  },

  // Gerenciamento de atalhos de teclado
  getKeybinds: () => ipcRenderer.invoke('keybinds:get-all'),
  setKeybind: (id: string, accelerator: string) =>
    ipcRenderer.invoke('keybinds:set', id, accelerator),
  resetKeybinds: () => ipcRenderer.invoke('keybinds:reset'),
  onKeybindsUpdate: (callback: (keybinds: Array<any>) => void) => {
    const subscription = (_: any, keybinds: any) => callback(keybinds);
    ipcRenderer.on('keybinds:update', subscription);
    return () => {
      ipcRenderer.removeListener('keybinds:update', subscription);
    };
  },
  onKeybindRegistrationFailed: (callback: (data: { id: string; accelerator: string }) => void) => {
    const subscription = (_: any, data: { id: string; accelerator: string }) => callback(data);
    ipcRenderer.on('keybinds:registration-failed', subscription);
    return () => {
      ipcRenderer.removeListener('keybinds:registration-failed', subscription);
    };
  },

  // Ouvinte de atalho global — disparado silenciosamente do processo principal sem focar a janela
  onGlobalShortcut: (callback: (data: { action: string }) => void) => {
    const subscription = (_: any, data: { action: string }) => callback(data);
    ipcRenderer.on('global-shortcut', subscription);
    return () => {
      ipcRenderer.removeListener('global-shortcut', subscription);
    };
  },

  // Tap de teclado oculto — três IPCs de consulta mortos foram descartados na
  // limpeza M5 — não tinham manipulador não lado principal e não eram chamados de
  // src/; o estado do tap chega via onStealthTapState em vez disso
  stealthTapAvailable: () => ipcRenderer.invoke('stealth-tap:available'),
  stealthTapOpenSettings: () => ipcRenderer.invoke('stealth-tap:open-settings'),
  stealthTapStop: () => ipcRenderer.invoke('stealth-tap:stop'),
  stealthTapStart: () => ipcRenderer.invoke('stealth-tap:start'),
  stealthTapShouldAutoEngage: () => ipcRenderer.invoke('stealth-tap:should-auto-engage'),
  onStealthTapState: (cb: (state: { active: boolean; reason?: string }) => void) => {
    const sub = (_: any, state: { active: boolean; reason?: string }) => cb(state);
    ipcRenderer.on('stealth-tap-state', sub);
    return () => {
      ipcRenderer.removeListener('stealth-tap-state', sub);
    };
  },
  onStealthKeyCaptured: (
    cb: (ev: { keyCode: number; chars: string; flags: number; isKeyDown: boolean }) => void,
  ) => {
    const sub = (
      _: any,
      ev: { keyCode: number; chars: string; flags: number; isKeyDown: boolean },
    ) => cb(ev);
    ipcRenderer.on('stealth-key-captured', sub);
    return () => {
      ipcRenderer.removeListener('stealth-key-captured', sub);
    };
  },

  // API de doação
  getDonationStatus: () => ipcRenderer.invoke('get-donation-status'),
  markDonationToastShown: () => ipcRenderer.invoke('mark-donation-toast-shown'),
  setDonationComplete: () => ipcRenderer.invoke('set-donation-complete'),

  // API do motor de perfil
  profileUploadResume: (filePath: string) => ipcRenderer.invoke('profile:upload-resume', filePath),
  profileGetStatus: () => ipcRenderer.invoke('profile:get-status'),
  profileSetMode: (enabled: boolean) => ipcRenderer.invoke('profile:set-mode', enabled),
  profileDelete: () => ipcRenderer.invoke('profile:delete'),
  profileGetProfile: () => ipcRenderer.invoke('profile:get-profile'),
  profileSelectFile: () => ipcRenderer.invoke('profile:select-file'),

  // API de JD e pesquisa
  profileUploadJD: (filePath: string) => ipcRenderer.invoke('profile:upload-jd', filePath),
  profileDeleteJD: () => ipcRenderer.invoke('profile:delete-jd'),
  profileResearchCompany: (companyName: string) =>
    ipcRenderer.invoke('profile:research-company', companyName),
  profileGenerateNegotiation: (force?: boolean) =>
    ipcRenderer.invoke('profile:generate-negotiation', force),
  profileGetNegotiationState: () => ipcRenderer.invoke('profile:get-negotiation-state'),
  profileResetNegotiation: () => ipcRenderer.invoke('profile:reset-negotiation'),
  profileGetNotes: () => ipcRenderer.invoke('profile:get-notes'),
  profileSaveNotes: (content: string) => ipcRenderer.invoke('profile:save-notes', content),
  profileGetPersona: () => ipcRenderer.invoke('profile:get-persona'),
  profileSavePersona: (content: string) => ipcRenderer.invoke('profile:save-persona', content),

  // API de busca Tavily
  setTavilyApiKey: (apiKey: string) => ipcRenderer.invoke('set-tavily-api-key', apiKey),

  // Descoberta dinâmica de modelos
  fetchProviderModels: (provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', apiKey: string) =>
    ipcRenderer.invoke('fetch-provider-models', provider, apiKey),
  setProviderPreferredModel: (provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', modelId: string) =>
    ipcRenderer.invoke('set-provider-preferred-model', provider, modelId),

  // Checkout PIX (AbacatePay) — cria a cobrança e faz polling até ativar
  pixCreateCheckout: (params: { plan: string; email: string }) =>
    ipcRenderer.invoke('pix:create-checkout', params),
  pixPollLicense: (checkoutId: string) => ipcRenderer.invoke('pix:poll-license', checkoutId),

  // Ativação de compras em segundo plano — o main process persiste a compra
  // pendente e continua o polling mesmo se esta janela fechar.
  purchaseActivationTrack: (params: { provider: 'pix' | 'lemonsqueezy'; checkoutId: string; plan: string; email?: string }) =>
    ipcRenderer.invoke('purchase-activation:track', params),
  purchaseActivationCancel: (checkoutId: string) =>
    ipcRenderer.invoke('purchase-activation:cancel', checkoutId),
  purchaseActivationList: () => ipcRenderer.invoke('purchase-activation:list'),
  onPurchaseActivationChanged: (
    callback: (data: {
      checkoutId: string;
      provider: string;
      status: 'pending' | 'activated' | 'needs_manual' | 'expired';
      plan?: string;
      licenseKey?: string;
      error?: string;
    }) => void,
  ) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('purchase-activation-changed', subscription);
    return () => {
      ipcRenderer.removeListener('purchase-activation-changed', subscription);
    };
  },

  // Gerenciamento de licença
  licenseActivate: (key: string) => ipcRenderer.invoke('license:activate', key),
  licenseCheckPremium: () => ipcRenderer.invoke('license:check-premium'),
  licenseGetDetails: () => ipcRenderer.invoke('license:get-details'),
  licenseCheckPremiumAsync: () => ipcRenderer.invoke('license:check-premium-async'),
  licenseDeactivate: () => ipcRenderer.invoke('license:deactivate'),
  licenseGetHardwareId: () => ipcRenderer.invoke('license:get-hardware-id'),
  onLicenseStatusChanged: (callback: (data: { isPremium: boolean; plan?: string }) => void) => {
    const subscription = (_: any, data: { isPremium: boolean; plan?: string }) => callback(data);
    ipcRenderer.on('license-status-changed', subscription);
    return () => {
      ipcRenderer.removeListener('license-status-changed', subscription);
    };
  },

  onModesActiveCleared: (callback: () => void) => {
    const subscription = () => callback();
    ipcRenderer.on('modes-active-cleared', subscription);
    return () => {
      ipcRenderer.removeListener('modes-active-cleared', subscription);
    };
  },

  // Opacidade da sobreposição (modo oculto)
  setOverlayOpacity: (opacity: number) => ipcRenderer.invoke('set-overlay-opacity', opacity),
  onOverlayOpacityChanged: (callback: (opacity: number) => void) => {
    const subscription = (_: any, opacity: number) => callback(opacity);
    ipcRenderer.on('overlay-opacity-changed', subscription);
    return () => {
      ipcRenderer.removeListener('overlay-opacity-changed', subscription);
    };
  },

  // Registro detalhado / depuração
  getVerboseLogging: () => ipcRenderer.invoke('get-verbose-logging'),
  setVerboseLogging: (enabled: boolean) => ipcRenderer.invoke('set-verbose-logging', enabled),
  getMeetingRetention: () => ipcRenderer.invoke('get-meeting-retention'),
  setMeetingRetention: (retention: 'forever' | '7d' | '30d' | 'never') =>
    ipcRenderer.invoke('set-meeting-retention', retention),
  onMeetingRetentionChanged: (
    callback: (retention: 'forever' | '7d' | '30d' | 'never') => void,
  ) => {
    const subscription = (_: any, retention: 'forever' | '7d' | '30d' | 'never') =>
      callback(retention);
    ipcRenderer.on('meeting-retention-changed', subscription);
    return () => {
      ipcRenderer.removeListener('meeting-retention-changed', subscription);
    };
  },
  getProviderDataScopes: () => ipcRenderer.invoke('get-provider-data-scopes'),
  setProviderDataScopes: (scopes: any) => ipcRenderer.invoke('set-provider-data-scopes', scopes),
  onProviderDataScopesChanged: (callback: (scopes: any) => void) => {
    const subscription = (_: any, scopes: any) => callback(scopes);
    ipcRenderer.on('provider-data-scopes-changed', subscription);
    return () => {
      ipcRenderer.removeListener('provider-data-scopes-changed', subscription);
    };
  },
  getScreenUnderstandingMode: () => ipcRenderer.invoke('get-screen-understanding-mode'),
  setScreenUnderstandingMode: (mode: 'vision_first' | 'vision_only' | 'private_vision') =>
    ipcRenderer.invoke('set-screen-understanding-mode', mode),
  onScreenUnderstandingModeChanged: (
    callback: (mode: 'vision_first' | 'vision_only' | 'private_vision') => void,
  ) => {
    const subscription = (_: any, mode: 'vision_first' | 'vision_only' | 'private_vision') =>
      callback(mode);
    ipcRenderer.on('screen-understanding-mode-changed', subscription);
    return () => {
      ipcRenderer.removeListener('screen-understanding-mode-changed', subscription);
    };
  },
  getTechnicalInterviewVisionFirst: () =>
    ipcRenderer.invoke('get-technical-interview-vision-first'),
  setTechnicalInterviewVisionFirst: (enabled: boolean) =>
    ipcRenderer.invoke('set-technical-interview-vision-first', enabled),
  onTechnicalInterviewVisionFirstChanged: (callback: (enabled: boolean) => void) => {
    const subscription = (_: any, enabled: boolean) => callback(enabled);
    ipcRenderer.on('technical-interview-vision-first-changed', subscription);
    return () => {
      ipcRenderer.removeListener('technical-interview-vision-first-changed', subscription);
    };
  },
  // Aliases obsoletos — mantidos para que o renderer compilado contra a API antiga continue funcionando.
  getTechnicalInterviewDirectVision: () =>
    ipcRenderer.invoke('get-technical-interview-direct-vision'),
  setTechnicalInterviewDirectVision: (enabled: boolean) =>
    ipcRenderer.invoke('set-technical-interview-direct-vision', enabled),
  onTechnicalInterviewDirectVisionChanged: (callback: (enabled: boolean) => void) => {
    const subscription = (_: any, enabled: boolean) => callback(enabled);
    ipcRenderer.on('technical-interview-vision-first-changed', subscription);
    return () => {
      ipcRenderer.removeListener('technical-interview-vision-first-changed', subscription);
    };
  },
  getLogFilePath: () => ipcRenderer.invoke('get-log-file-path'),
  openLogFile: () => ipcRenderer.invoke('open-log-file'),

  // Onboarding e controle de sinalizadores persistentes de backup
  onboardingGetFlags: () => ipcRenderer.invoke('onboarding:get-flags'),
  onboardingSetFlag: (
    key: 'seenStartup' | 'seenProfileOnboarding' | 'seenModesOnboarding' | 'permsShown' | 'seenInteractiveTutorial',
    value: boolean
  ) => ipcRenderer.invoke('onboarding:set-flag', key, value),

  // Arquitetura
  getArch: () => ipcRenderer.invoke('get-arch'),
  getOsVersion: () => ipcRenderer.invoke('get-os-version'),

  // API de recorte
  cropperConfirmed: (bounds: Electron.Rectangle) => ipcRenderer.send('cropper-confirmed', bounds),
  cropperCancelled: () => ipcRenderer.send('cropper-cancelled'),
  onResetCropper: (callback: (data: { hudPosition: { x: number; y: number } }) => void) => {
    const subscription = (
      _: Electron.IpcRendererEvent,
      data: { hudPosition: { x: number; y: number } },
    ) => callback(data);
    ipcRenderer.on('reset-cropper', subscription);
    return () => {
      ipcRenderer.removeListener('reset-cropper', subscription);
    };
  },

  // Plataforma
  platform: process.platform,

  // API de modos
  modesGetAll: () => ipcRenderer.invoke('modes:get-all'),
  modesGetActive: () => ipcRenderer.invoke('modes:get-active'),
  modesCreate: (params: { name: string; templateType: string }) =>
    ipcRenderer.invoke('modes:create', params),
  modesUpdate: (
    id: string,
    updates: { name?: string; templateType?: string; customContext?: string },
  ) => ipcRenderer.invoke('modes:update', id, updates),
  modesDelete: (id: string) => ipcRenderer.invoke('modes:delete', id),
  modesSetActive: (id: string | null) => ipcRenderer.invoke('modes:set-active', id),
  modesGetReferenceFiles: (modeId: string) =>
    ipcRenderer.invoke('modes:get-reference-files', modeId),
  modesUploadReferenceFile: (modeId: string) =>
    ipcRenderer.invoke('modes:upload-reference-file', modeId),
  modesDeleteReferenceFile: (id: string) => ipcRenderer.invoke('modes:delete-reference-file', id),
  modesGetReferenceFileStatus: (modeId: string) =>
    ipcRenderer.invoke('modes:get-reference-file-status', modeId),
  onModeFileIndexStatus: (callback: (data: { modeId: string; fileId?: string }) => void) => {
    const subscription = (_: any, data: { modeId: string; fileId?: string }) => callback(data);
    ipcRenderer.on('mode-file-index-status', subscription);
    return () => {
      ipcRenderer.removeListener('mode-file-index-status', subscription);
    };
  },
  modesGetNoteSections: (modeId: string) => ipcRenderer.invoke('modes:get-note-sections', modeId),
  modesAddNoteSection: (modeId: string, title: string, description: string) =>
    ipcRenderer.invoke('modes:add-note-section', modeId, title, description),
  modesUpdateNoteSection: (id: string, updates: { title?: string; description?: string }) =>
    ipcRenderer.invoke('modes:update-note-section', id, updates),
  modesDeleteNoteSection: (id: string) => ipcRenderer.invoke('modes:delete-note-section', id),
  modesRemoveAllNoteSections: (modeId: string) =>
    ipcRenderer.invoke('modes:remove-all-note-sections', modeId),

  // Tema da interface de reunião — consulte a interface ElectronAPI para justificativa.
  setMeetingInterfaceTheme: (theme: string) => {
    ipcRenderer.send('interface-theme:set', theme);
  },
  onMeetingInterfaceThemeChanged: (callback: (theme: string) => void) => {
    const handler = (_evt: unknown, theme: string) => callback(theme);
    ipcRenderer.on('interface-theme:changed', handler);
    return () => {
      ipcRenderer.removeListener('interface-theme:changed', handler);
    };
  },

  // Cancelar o chat em andamento. Consulte a interface ElectronAPI para justificativa.
  cancelChatStream: () => {
    ipcRenderer.send('gemini-chat-stream-stop');
  },
  onDomContextReceived: (
    callback: (dom: string, meta?: DomCaptureMeta, envelope?: unknown) => void,
  ) => {
    // O desktop envia (dom, meta?, envelope?) — meta controla o chip "Page contexto",
    // envelope (Contexto de navegador inteligente v2) transporta a captura estruturada.
    // Encaminhar os argumentos extras é retrocompatível: chamadores existentes que apenas
    // declaram (dom) ou (dom, meta) simplesmente ignoram o(s) argumento(s) adicionais(s).
    const subscription = (_: any, dom: string, meta?: DomCaptureMeta, envelope?: unknown) =>
      callback(dom, meta, envelope);
    ipcRenderer.on('dom-context-received', subscription);
    return () => {
      ipcRenderer.removeListener('dom-context-received', subscription);
    };
  },
  // ---- APIs do Assistente de Programação ----
  getRepoPath: () => ipcRenderer.invoke('get-setting', 'repoIndexerPath'),
  setRepoPath: (path: string) => ipcRenderer.invoke('set-setting', 'repoIndexerPath', path),
  selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  scanRepo: (repoPath: string) => ipcRenderer.invoke('repo-index:scan', repoPath),
  queryRepo: (query: string, topK?: number) => ipcRenderer.invoke('repo-index:query', query, topK),
  codeExplain: (code: string, language: string) => {
    const tokens: string[] = [];
    return new Promise((resolve, reject) => {
      const tokenHandler = (_: any, token: string) => tokens.push(token);
      ipcRenderer.on('code-stream-token', tokenHandler);
      ipcRenderer.invoke('code:explain', code, language)
        .then((res: any) => {
          ipcRenderer.removeListener('code-stream-token', tokenHandler);
          if (res.success) resolve(res.result);
          else reject(new Error(res.error));
        })
        .catch((err: any) => {
          ipcRenderer.removeListener('code-stream-token', tokenHandler);
          reject(err);
        });
    });
  },
  codeGenerate: (description: string, language: string) => {
    const tokens: string[] = [];
    return new Promise((resolve, reject) => {
      const tokenHandler = (_: any, token: string) => tokens.push(token);
      ipcRenderer.on('code-stream-token', tokenHandler);
      ipcRenderer.invoke('code:generate', description, language)
        .then((res: any) => {
          ipcRenderer.removeListener('code-stream-token', tokenHandler);
          if (res.success) resolve(res.result);
          else reject(new Error(res.error));
        })
        .catch((err: any) => {
          ipcRenderer.removeListener('code-stream-token', tokenHandler);
          reject(err);
        });
    });
  },
  codeReview: (code: string, language: string) => {
    const tokens: string[] = [];
    return new Promise((resolve, reject) => {
      const tokenHandler = (_: any, token: string) => tokens.push(token);
      ipcRenderer.on('code-stream-token', tokenHandler);
      ipcRenderer.invoke('code:review', code, language)
        .then((res: any) => {
          ipcRenderer.removeListener('code-stream-token', tokenHandler);
          if (res.success) resolve(res.result);
          else reject(new Error(res.error));
        })
        .catch((err: any) => {
          ipcRenderer.removeListener('code-stream-token', tokenHandler);
          reject(err);
        });
    });
  },
  codeRefactor: (code: string, language: string, target: string) => {
    const tokens: string[] = [];
    return new Promise((resolve, reject) => {
      const tokenHandler = (_: any, token: string) => tokens.push(token);
      ipcRenderer.on('code-stream-token', tokenHandler);
      ipcRenderer.invoke('code:refactor', code, language, target)
        .then((res: any) => {
          ipcRenderer.removeListener('code-stream-token', tokenHandler);
          if (res.success) resolve(res.result);
          else reject(new Error(res.error));
        })
        .catch((err: any) => {
          ipcRenderer.removeListener('code-stream-token', tokenHandler);
          reject(err);
        });
    });
  },
  codeTest: (code: string, language: string, framework?: string) => {
    const tokens: string[] = [];
    return new Promise((resolve, reject) => {
      const tokenHandler = (_: any, token: string) => tokens.push(token);
      ipcRenderer.on('code-stream-token', tokenHandler);
      ipcRenderer.invoke('code:test', code, language, framework)
        .then((res: any) => {
          ipcRenderer.removeListener('code-stream-token', tokenHandler);
          if (res.success) resolve(res.result);
          else reject(new Error(res.error));
        })
        .catch((err: any) => {
          ipcRenderer.removeListener('code-stream-token', tokenHandler);
          reject(err);
        });
    });
  },
  getCodingFlags: () => ipcRenderer.invoke('code:flags'),
  // ---- APIs do OpenCode ----
  opencodeHealth: () => ipcRenderer.invoke('opencode:health'),
  opencodePrompt: (prompt: string) => ipcRenderer.invoke('opencode:prompt', prompt),
  opencodeExplain: (code: string, language: string) => ipcRenderer.invoke('opencode:explain', code, language),
  opencodeGenerate: (description: string, language: string) => ipcRenderer.invoke('opencode:generate', description, language),
  opencodeSearch: (query: string) => ipcRenderer.invoke('opencode:search', query),

  // Git Integration API
  gitSetCwd: (dirPath: string | null) => ipcRenderer.invoke('git:set-cwd', dirPath),
  gitGetCwd: () => ipcRenderer.invoke('git:get-cwd'),
  gitStatus: () => ipcRenderer.invoke('git:status'),
  gitDiff: (filePath?: string) => ipcRenderer.invoke('git:diff', filePath),
  gitLog: (count?: number) => ipcRenderer.invoke('git:log', count),
  gitCommit: (message: string, options?: { files?: string[]; amend?: boolean }) => ipcRenderer.invoke('git:commit', message, options),
  gitBranches: () => ipcRenderer.invoke('git:branches'),
  gitCreateBranch: (name: string) => ipcRenderer.invoke('git:create-branch', name),
  gitSwitchBranch: (name: string) => ipcRenderer.invoke('git:switch-branch', name),
  gitPull: () => ipcRenderer.invoke('git:pull'),
  gitPush: (options?: { force?: boolean }) => ipcRenderer.invoke('git:push', options),
  gitStash: (message?: string) => ipcRenderer.invoke('git:stash', message),
  gitStashPop: () => ipcRenderer.invoke('git:stash-pop'),
  gitStashDrop: () => ipcRenderer.invoke('git:stash-drop'),
  gitRepoName: () => ipcRenderer.invoke('git:repo-name'),
  gitIsRepository: () => ipcRenderer.invoke('git:is-repository'),
  gitOpenInFileManager: () => ipcRenderer.invoke('git:open-in-file-manager'),

  // Language Learning API
  languageLearningTranslate: (data: { transcript: string; sourceLanguage: string; targetLanguage: string }) =>
    ipcRenderer.invoke('language-learning:translate', data),
  onLanguageLearningToken: (callback: (data: { token: string; accumulated: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('language-learning-translation-token', subscription);
    return () => { ipcRenderer.removeListener('language-learning-translation-token', subscription); };
  },
  onLanguageLearningDone: (callback: (data: { full: string; translation: string; suggestedReply: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('language-learning-translation-done', subscription);
    return () => { ipcRenderer.removeListener('language-learning-translation-done', subscription); };
  },
  onLanguageLearningError: (callback: (data: { error: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('language-learning-translation-error', subscription);
    return () => { ipcRenderer.removeListener('language-learning-translation-error', subscription); };
  },

  // Replica / Interview Coach API
  replicaStartSession: (data: { modeType: string; language: string; title?: string }) =>
    ipcRenderer.invoke('replica:start-session', data),
  replicaAskQuestion: (data: { sessionId: string; userAnswer: string; isFirst: boolean; modeType: string; language: string; questionHistory: Array<{ question: string; difficulty: string; category: string; userAnswer: string; feedback: string }> }) =>
    ipcRenderer.invoke('replica:ask-question', data),
  replicaEndSession: (data: { sessionId: string; questionHistory: Array<{ question: string; difficulty: string; category: string; userAnswer: string; feedback: string }>; modeType: string; startTime: number }) =>
    ipcRenderer.invoke('replica:end-session', data),
  replicaGetSessions: () =>
    ipcRenderer.invoke('replica:get-sessions'),
  replicaGetSessionDetail: (sessionId: string) =>
    ipcRenderer.invoke('replica:get-session-detail', sessionId),
  replicaOpenWindow: () =>
    ipcRenderer.invoke('replica:open-window'),
  replicaCloseWindow: () =>
    ipcRenderer.invoke('replica:close-window'),
  onReplicaQuestionToken: (callback: (data: { token: string; accumulated: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('replica-question-token', subscription);
    return () => { ipcRenderer.removeListener('replica-question-token', subscription); };
  },
  onReplicaQuestionDone: (callback: (data: { full: string; question: string; difficulty: string; category: string; hint?: string; feedback: string; isEndSession: boolean }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('replica-question-done', subscription);
    return () => { ipcRenderer.removeListener('replica-question-done', subscription); };
  },
  onReplicaQuestionError: (callback: (data: { error: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('replica-question-error', subscription);
    return () => { ipcRenderer.removeListener('replica-question-error', subscription); };
  },
  onReplicaEvaluationToken: (callback: (data: { token: string; accumulated: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('replica-evaluation-token', subscription);
    return () => { ipcRenderer.removeListener('replica-evaluation-token', subscription); };
  },
  onReplicaEvaluationDone: (callback: (data: { full: string; evaluation: any }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('replica-evaluation-done', subscription);
    return () => { ipcRenderer.removeListener('replica-evaluation-done', subscription); };
  },
  onReplicaEvaluationError: (callback: (data: { error: string }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('replica-evaluation-error', subscription);
    return () => { ipcRenderer.removeListener('replica-evaluation-error', subscription); };
  },

  // Agent Actions
  agentApproveAction: (actionId: string) => ipcRenderer.invoke('agent:approve_action', actionId),
  agentRejectAction: (actionId: string) => ipcRenderer.invoke('agent:reject_action', actionId),
  onAgentRequestApproval: (callback: (data: { actionId: string; action: any }) => void) => {
    const subscription = (_: any, data: any) => callback(data);
    ipcRenderer.on('agent:request_approval', subscription);
    return () => { ipcRenderer.removeListener('agent:request_approval', subscription); };
  },

  // Role Twin
  roleTwinList: () => ipcRenderer.invoke('role-twin:list'),
  roleTwinGetActive: () => ipcRenderer.invoke('role-twin:get-active'),
  roleTwinAnalyze: (input: {
    id?: string;
    company: string;
    roleTitle: string;
    jobDescription: string;
    forceResearch?: boolean;
  }) => ipcRenderer.invoke('role-twin:analyze', input),
  roleTwinSetActive: (id: string | null) => ipcRenderer.invoke('role-twin:set-active', id),
  roleTwinDelete: (id: string) => ipcRenderer.invoke('role-twin:delete', id),

  // LemonSqueezy
  lemonsqueezyCreateCheckout: (params: { plan: 'monthly' | 'yearly' | 'lifetime'; email?: string }) =>
    ipcRenderer.invoke('lemonsqueezy:create-checkout', params),
  lemonsqueezyPollLicense: (checkoutId: string) =>
    ipcRenderer.invoke('lemonsqueezy:poll-license', checkoutId),
} as ElectronAPI);