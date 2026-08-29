/**
 * =============================================================================
 * ProcessingHelper.ts — PROCESSAMENTO DE SCREENSHOTS VIA LLM
 * =============================================================================
 * 
 * DESCRIÇÃO:
 * Coordena o processamento de capturas de tela para gerar soluções
 * de problemas de programação. Funciona como o "cérebro" que conecta
 * screenshots → LLMHelper → respostas estruturadas.
 * 
 * FLUXO PRINCIPAL:
 * 1. Usuário tira screenshot de um problema de programação
 * 2. ProcessingHelper envia a imagem para o LLM (Gemini/Groq/etc)
 * 3. O LLM analisa e retorna uma solução estruturada
 * 4. A solução é dividida em 4 fases para o usuário:
 *    - Fase 1: Identificação do problema
 *    - Fase 2: Análise de complexidade (tempo/espaço)
 *    - Fase 3: Solução passo a passo
 *    - Fase 4: Código implementado
 * 
 * GERENCIAMENTO DE CHAVES:
 * Esta classe também é responsável por carregar as chaves de API
 * armazenadas (Gemini, Groq, OpenAI, Claude, etc.) e inicializar
 * o LLMHelper com elas. Isso é feito em loadStoredCredentials().
 * 
 * DEPENDÊNCIA CIRCULAR QUEBRADA:
 * ProcessingHelper ↔ AppState ↔ LLMHelper
 * O ProcessingHelper é criado DENTRO do AppState e recebe referência
 * ao AppState. O LLMHelper é criado DENTRO do ProcessingHelper.
 * =============================================================================
 */

// ProcessingHelper.ts

import { AppState } from "./main"
import { LLMHelper } from "./LLMHelper"
import { CredentialsManager } from "./services/CredentialsManager"
import { app } from "electron"
// importar dotenv de "dotenv" // Removed static importar

if (!app.isPackaged) {
  require("dotenv").config()
}

const isDev = process.env.NODE_ENV === "development"
const isDevTest = process.env.IS_DEV_TEST === "true"
const MOCK_API_WAIT_TIME = Number(process.env.MOCK_API_WAIT_TIME) || 500

export class ProcessingHelper {
  private appState: AppState
  private llmHelper: LLMHelper
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null

  constructor(appState: AppState) {
    this.appState = appState

    // Verifica se o usuário quer usar Ollama
    const useOllama = process.env.USE_OLLAMA === "true"
    const ollamaModel = process.env.OLLAMA_MODEL // Não definir padrão aqui, deixar o LLMHelper auto-detectar
    const ollamaUrl = process.env.OLLAMA_URL || "http://localhost:11434"

    if (useOllama) {
      // console.log("[ProcessingHelper] Inicializando com Ollama")
      this.llmHelper = new LLMHelper(undefined, true, ollamaModel, ollamaUrl)
    } else {
      // Tentar ambiente primeiro (para desenvolvimento)
      let apiKey = process.env.GEMINI_API_KEY
      let groqApiKey = process.env.GROQ_API_KEY
      let openaiApiKey = process.env.OPENAI_API_KEY
      let claudeApiKey = process.env.CLAUDE_API_KEY
      let deepseekApiKey = process.env.DEEPSEEK_API_KEY

      // Permitir inicialização sem chave (será carregada em loadStoredCredentials ou via Configurações)
      if (!apiKey) {
        console.warn("[ProcessingHelper] GEMINI_API_KEY not found in env. Will try CredentialsManager after ready.")
      }

      this.llmHelper = new LLMHelper(apiKey, false, undefined, undefined, groqApiKey, openaiApiKey, claudeApiKey, deepseekApiKey)
    }
  }

  /**
   * Load stored credentials de CredentialsManager
   * Should be called depois app.whenReady() quando CredentialsManager is initialized
   */
  public loadStoredCredentials(): void {
    const credManager = CredentialsManager.getInstance();

    const geminiKey = credManager.getGeminiApiKey();
    const groqKey = credManager.getGroqApiKey();
    const openaiKey = credManager.getOpenaiApiKey();
    const claudeKey = credManager.getClaudeApiKey();
    const deepseekKey = credManager.getDeepseekApiKey();

    if (geminiKey) {
      console.log("[ProcessingHelper] Loading stored Gemini API Key from CredentialsManager");
      this.llmHelper.setApiKey(geminiKey);
    }

    if (groqKey) {
      console.log("[ProcessingHelper] Loading stored Groq API Key from CredentialsManager");
      this.llmHelper.setGroqApiKey(groqKey);
    }

    if (openaiKey) {
      console.log("[ProcessingHelper] Loading stored OpenAI API Key from CredentialsManager");
      this.llmHelper.setOpenaiApiKey(openaiKey);
    }

    if (claudeKey) {
      console.log("[ProcessingHelper] Loading stored Claude API Key from CredentialsManager");
      this.llmHelper.setClaudeApiKey(claudeKey);
    }

    if (deepseekKey) {
      console.log("[ProcessingHelper] Loading stored DeepSeek API Key from CredentialsManager");
      this.llmHelper.setDeepseekApiKey(deepseekKey);
    }

    const litellmBaseURL = credManager.getLitellmBaseURL();
    if (litellmBaseURL) {
      console.log("[ProcessingHelper] Loading stored LiteLLM config from CredentialsManager");
      this.llmHelper.setLitellmConfig(credManager.getLitellmApiKey() || '', litellmBaseURL, credManager.getLitellmMaxTokens());
    }

    const refractKey = credManager.getRefractApiKey();
    if (refractKey) {
      console.log("[ProcessingHelper] Loading stored Refract API Key from CredentialsManager");
      this.llmHelper.setRefractKey(refractKey);
    }

    // CRÍTICO: Reinicializa o IntelligenceManager agora que as chaves foram carregadas
    // Isso corrige o problema onde os botões não funcionam em produção por causa do carregamento tardio de chaves
    this.appState.getIntelligenceManager().initializeLLMs();

    // CRÍTICO: Inicializa o RAGManager (Embeddings) com as chaves carregadas
    // Isso corrige "RAG indisponível" em produção onde process.env está vazio
    const ragManager = this.appState.getRAGManager();
    if (ragManager) {
      console.log("[ProcessingHelper] Initializing RAGManager embeddings with available keys");
      ragManager.initializeEmbeddings({
          openaiKey: openaiKey || undefined,
          geminiKey: geminiKey || undefined,
          // ollamaUrl ainda não é obtido do CredentialsManager por padrão, mas passamos essas chaves
          providerDataScopes: (() => { try { const { SettingsManager } = require('./services/SettingsManager'); return SettingsManager.getInstance().get('providerDataScopes'); } catch { return undefined; } })()
      });

      // CRÍTICO: Tentar novamente os embeddings pendentes agora que temos a chave
      // Isso garante que quaisquer reuniões que falharam ou estavam em fila durante a inicialização sejam processadas
      console.log("[ProcessingHelper] Retrying pending embeddings...");
      ragManager.retryPendingEmbeddings().catch(console.error);

      // CRÍTICO: Garante que a reunião de demonstração tenha chunks
      ragManager.ensureDemoMeetingProcessed().catch(console.error);

      // CRÍTICO: Limpa itens obsoletos da fila para prevenir erros de "Chunk não encontrado"
      ragManager.cleanupStaleQueueItems();
    }

    // Inicializa o gerenciador de versões de modelo auto-aprimorado (segundo plano, não bloqueante)
    this.llmHelper.initModelVersionManager().catch(err => {
      console.warn('[ProcessingHelper] ModelVersionManager initialization failed (non-critical):', err.message);
    });

    // NOVO: Carrega a Configuração de Modelo Padrão
    const defaultModel = credManager.getDefaultModel();
    if (defaultModel) {
      console.log(`[ProcessingHelper] Loading stored Default Model: ${defaultModel}`);
      const customProviders = credManager.getCustomProviders();
      const curlProviders = credManager.getCurlProviders();
      const allProviders = [...(customProviders || []), ...(curlProviders || [])];
      this.llmHelper.setModel(defaultModel, allProviders);
    }

    // Carrega Idiomas
    const sttLanguage = credManager.getSttLanguage();
    const aiResponseLanguage = credManager.getAiResponseLanguage();

    if (sttLanguage) {
      this.llmHelper.setSttLanguage(sttLanguage);
    }

    if (aiResponseLanguage) {
      this.llmHelper.setAiResponseLanguage(aiResponseLanguage);
    }
  }

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.appState.getMainWindow()
    if (!mainWindow) return

    const view = this.appState.getView()

    if (view === "queue") {
      const screenshotQueue = this.appState.getScreenshotHelper().getScreenshotQueue()
      if (screenshotQueue.length === 0) {
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.NO_SCREENSHOTS)
        return
      }



      const allPaths = this.appState.getScreenshotHelper().getScreenshotQueue();

      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_START)
      this.appState.setView("solutions")
      this.currentProcessingAbortController = new AbortController()
      try {
        // Gera o roteiro de entrevista estruturado em 4 fases
        const rollingScript = await this.llmHelper.generateRollingScript(allPaths);

        const problemInfo = {
          problem_statement: rollingScript.problem_identifier_script,
          input_format: { description: "Generated from screenshot", parameters: [] as any[] },
          output_format: { description: "Generated from screenshot", type: "string", subtype: "structured" },
          complexity: { time: rollingScript.time_complexity, space: rollingScript.space_complexity },
          test_cases: [] as any[],
          validation_type: "structured",
          difficulty: "custom"
        };
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.PROBLEM_EXTRACTED, problemInfo);
        this.appState.setProblemInfo(problemInfo);

        // Envia a solução estruturada completa para que o Solutions.tsx renderize as 4 fases
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.SOLUTION_SUCCESS, {
          solution: {
            problem_identifier_script: rollingScript.problem_identifier_script,
            brainstorm_script: rollingScript.brainstorm_script,
            code: rollingScript.code,
            dry_run_script: rollingScript.dry_run_script,
            time_complexity: rollingScript.time_complexity,
            space_complexity: rollingScript.space_complexity,
          }
        });
      } catch (error: any) {
        console.error("[ProcessingHelper] Rolling script generation failed:", error);
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, error.message)
      } finally {
        this.currentProcessingAbortController = null
      }
      return;

    } else {
      // Depurar modo
      const extraScreenshotQueue = this.appState.getScreenshotHelper().getExtraScreenshotQueue()
      if (extraScreenshotQueue.length === 0) {
        // console.log("No extra screenshots para prprocesso
        mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.NO_SCREENSHOTS)
        return
      }

      mainWindow.webContents.send(this.appState.PROCESSING_EVENTS.DEBUG_START)
      this.currentExtraProcessingAbortController = new AbortController()

      try {
        // Obtém problem info e atual solution
        const problemInfo = this.appState.getProblemInfo()
        if (!problemInfo) {
          throw new Error("No problem info available")
        }

        // Obtém atual solution de estado
        const currentSolution = await this.llmHelper.generateSolution(problemInfo)
        const currentCode = currentSolution.solution.code

        // Depurar o solution using vision modelo
        const debugResult = await this.llmHelper.debugSolutionWithImages(
          problemInfo,
          currentCode,
          extraScreenshotQueue
        )

        this.appState.setHasDebugged(true)
        mainWindow.webContents.send(
          this.appState.PROCESSING_EVENTS.DEBUG_SUCCESS,
          debugResult
        )

      } catch (error: any) {
        // console.error("Debug processing error:", error)
        mainWindow.webContents.send(
          this.appState.PROCESSING_EVENTS.DEBUG_ERROR,
          error.message
        )
      } finally {
        this.currentExtraProcessingAbortController = null
      }
    }
  }

  public cancelOngoingRequests(): void {
    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort()
      this.currentProcessingAbortController = null
    }

    if (this.currentExtraProcessingAbortController) {
      this.currentExtraProcessingAbortController.abort()
      this.currentExtraProcessingAbortController = null
    }

    this.appState.setHasDebugged(false)
  }



  public getLLMHelper() {
    return this.llmHelper;
  }
}
