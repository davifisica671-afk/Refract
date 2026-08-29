/**
 * =============================================================================
 * CredentialsManager.ts — GERENCIADOR DE SEGURANÇA DE CREDENCIAIS
 * =============================================================================
 * 
 * DESCRIÇÃO:
 * Armazena e recupera todas as chaves de API e credenciais do app
 * de forma SEGURA usando criptografia nativa do Electron.
 * 
 * SEGURANÇA:
 * - Usa Electron's safeStorage API (criptografia at rest)
 * - Arquivo: {userData}/credentials.enc (criptografado)
 * - Nunca expõe chaves em texto plano em logs
 * - Chaves são carregadas sob demanda, não mantidas em memória desnecessariamente
 * 
 * CREDENCIAIS GERENCIADAS:
 * - Chaves de LLM: Gemini, Groq, OpenAI, Claude, DeepSeek, LiteLLM, Refract
 * - Chaves de STT: Google, Groq, OpenAI, Deepgram, ElevenLabs, Azure, IBM Watson, Soniox
 * - Provedores personalizados: cURL templates do usuário
 * - Configurações de modelo: padrão, fast mode, Codex CLI
 * - Configurações de idioma: STT e respostas de IA
 * - Estado do trial: token, expiração, uso
 * 
 * PADRÃO SINGLETON:
 * CredentialsManager.getInstance() retorna sempre a mesma instância
 * =============================================================================
 */

import { app, safeStorage } from 'electron';
import fs from 'fs';
import path from 'path';

const CREDENTIALS_PATH = path.join(app.getPath('userData'), 'credentials.enc');

export interface CustomProvider {
    id: string;
    name: string;
    curlCommand: string;
    /**
     * Whether isso provider pode accept screenshots. When undefined, vision
     * support is auto-detected de o cURL template (an `{{IMAGE_BASE64}}`
     * placeholder, ou an OpenAI-compatible `messages` body). Set explicitly to
     * override o guess. See customProviderSupportsVision().
     */
    multimodal?: boolean;
    /** Verdadeiro se isso provider's endpoint é loopback/local (pula cloud-scope gating). */
    localOnly?: boolean;
}

export interface CurlProvider {
    id: string;
    name: string;
    curlCommand: string;
    responsePath: string; // e.g. "choices[0].message.content"
}

export interface StoredCredentials {
    geminiApiKey?: string;
    groqApiKey?: string;
    openaiApiKey?: string;
    claudeApiKey?: string;
    deepseekApiKey?: string;
    litellmApiKey?: string;
    litellmBaseURL?: string;
    /** Manual saída ceiling para LiteLLM-proxied models. Unset → Auto (per-model via /model/info). */
    litellmMaxTokens?: number;
    googleServiceAccountPath?: string;
    customProviders?: CustomProvider[];
    curlProviders?: CurlProvider[];
    defaultModel?: string;
    refractApiKey?: string;
    // STT Provedor settings
    sttProvider?: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'refract' | 'local-whisper';
    groqSttApiKey?: string;
    groqSttModel?: string;
    openAiSttApiKey?: string;
    /** Custom OpenAI-compatible STT base URL (e.g. self-hosted Speaches).
     *  Empty / unset → use https://api.openai.com. */
    openAiSttBaseUrl?: string;
    deepgramApiKey?: string;
    elevenLabsApiKey?: string;
    azureApiKey?: string;
    azureRegion?: string;
    ibmWatsonApiKey?: string;
    ibmWatsonRegion?: string;
    sonioxApiKey?: string;
    sttLanguage?: string;
    aiResponseLanguage?: string;
    // Tavily Busca
    tavilyApiKey?: string;
    // Dynamic Modelo Discovery – preferred models por provedor
    geminiPreferredModel?: string;
    groqPreferredModel?: string;
    openaiPreferredModel?: string;
    claudePreferredModel?: string;
    deepseekPreferredModel?: string;
    opencodeZenPreferredModel?: string;
    opencodeZenApiKey?: string;
    // Liberar trial estado
    trialToken?: string;   // server-issued signed token (refract_trial_…)
    trialExpiresAt?: string;   // ISO timestamp — local copy para startup verifica
    trialStartedAt?: string;   // ISO timestamp
    trialClaimed?: boolean;  // define verdadeiro em primeiro claim, nunca cleared — oculta inicia card permanently
    /**
     * Companion-extension pairing token. LOOPBACK-SCOPED — apenas o extension uses
     * it, sobre 127.0.0.1, e it nunca travels o wire off-box. Persisted
     * (encrypted via safeStorage) so o extension pairs ONCE e survives
     * restarts; regenerated apenas on a deliberate "Rotate token". Kept SEPARATE from
     * o phone token: o phone token is exposed in a plaintext-HTTP LAN QR when
     * exposeOnLan is on, so sharing one secret would let a sniffed LAN token reach
     * o extension's /dom capture capability. See PhoneMirrorService + CONTRACT.md.
     *
     * (Field nome retained para backward-compat com already-persisted credentials.)
     */
    phoneMirrorToken?: string;
}

export class CredentialsManager {
    private static instance: CredentialsManager;
    private credentials: StoredCredentials = {};

    private constructor() {
        // Carrega em construction após app ready
    }

    public static getInstance(): CredentialsManager {
        if (!CredentialsManager.instance) {
            CredentialsManager.instance = new CredentialsManager();
        }
        return CredentialsManager.instance;
    }

    /**
     * Initialize - carregar credentials de disk
     * Must be called depois app.whenReady()
     */
    public init(): void {
        this.loadCredentials();
        console.log('[CredentialsManager] Initialized');
    }

    // =========================================================================
    // Getters
    // =========================================================================

    public getGeminiApiKey(): string | undefined {
        return this.credentials.geminiApiKey;
    }

    public getGroqApiKey(): string | undefined {
        return this.credentials.groqApiKey;
    }

    public getOpenaiApiKey(): string | undefined {
        return this.credentials.openaiApiKey;
    }

    public getClaudeApiKey(): string | undefined {
        return this.credentials.claudeApiKey;
    }

    public getDeepseekApiKey(): string | undefined {
        return this.credentials.deepseekApiKey;
    }

    public getOpencodeZenApiKey(): string | undefined {
        return this.credentials.opencodeZenApiKey;
    }

    /** Persisted loopback-scoped companion-extension token (stable através restarts). */
    public getPhoneMirrorToken(): string | undefined {
        return this.credentials.phoneMirrorToken;
    }

    public getLitellmApiKey(): string | undefined {
        return this.credentials.litellmApiKey;
    }

    public getLitellmBaseURL(): string | undefined {
        return this.credentials.litellmBaseURL;
    }

    public getLitellmMaxTokens(): number | undefined {
        return this.credentials.litellmMaxTokens;
    }

    public getGoogleServiceAccountPath(): string | undefined {
        return this.credentials.googleServiceAccountPath;
    }

    public getCustomProviders(): CustomProvider[] {
        return this.credentials.customProviders || [];
    }

    public getSttProvider(): 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'refract' | 'local-whisper' {
        const provider = this.credentials.sttProvider || 'none';
        // Self-heal: se provedor é 'nnenhum mas a Refract chave exists, o user é em a
        // broken estado (chave cleared então re-entered via a caminho que skipped auto-promote,
        // ou credentials restored de backup). Silently restore para 'refract' então STT works.
        if (provider === 'none' && this.credentials.refractApiKey) {
            this.credentials.sttProvider = 'refract';
            this.saveCredentials();
            console.log('[CredentialsManager] Self-healed sttProvider: none→refract (Refract key present)');
            return 'refract';
        }
        return provider;
    }

    public getDeepgramApiKey(): string | undefined {
        return this.credentials.deepgramApiKey;
    }

    public getGroqSttApiKey(): string | undefined {
        return this.credentials.groqSttApiKey;
    }

    public getGroqSttModel(): string {
        return this.credentials.groqSttModel || 'whisper-large-v3-turbo';
    }

    public getOpenAiSttApiKey(): string | undefined {
        return this.credentials.openAiSttApiKey;
    }

    public getOpenAiSttBaseUrl(): string | undefined {
        return this.credentials.openAiSttBaseUrl;
    }

    public getElevenLabsApiKey(): string | undefined {
        return this.credentials.elevenLabsApiKey;
    }

    public getAzureApiKey(): string | undefined {
        return this.credentials.azureApiKey;
    }

    public getAzureRegion(): string {
        return this.credentials.azureRegion || 'eastus';
    }

    public getIbmWatsonApiKey(): string | undefined {
        return this.credentials.ibmWatsonApiKey;
    }

    public getIbmWatsonRegion(): string {
        return this.credentials.ibmWatsonRegion || 'us-south';
    }

    public getSonioxApiKey(): string | undefined {
        return this.credentials.sonioxApiKey;
    }

    public getTavilyApiKey(): string | undefined {
        return this.credentials.tavilyApiKey;
    }

    public getSttLanguage(): string {
        return this.credentials.sttLanguage || 'english-us';
    }

    public getAiResponseLanguage(): string {
        return this.credentials.aiResponseLanguage || 'auto';
    }
    public getDefaultModel(): string {
        // Default para Flash-Lite: ~0.65s first-token vs ~2.3s para completo Flash em
        // o mesmo prompt (measured), e faster saída streaming — o
        // Refract-class interactive latency talvo Completo Flash / Pro remain
        // user-selectable para harder problems.
        return this.credentials.defaultModel || 'gemini-3.1-flash-lite';
    }

    public getRefractApiKey(): string | undefined {
        return this.credentials.refractApiKey;
    }

    public getAllCredentials(): StoredCredentials {
        return { ...this.credentials };
    }

    // =========================================================================
    // Vision provedor availability — used por o vision-first tela pipeline
    // =========================================================================

    /**
     * True se at least one configured provider is vision-capable.
     * Used by ScreenUnderstandingService para gate vision_only / decide fallback.
     */
    public anyVisionProviderConfigured(): boolean {
        if (this.credentials.refractApiKey) return true;       // Refract API suporta vision
        if (this.credentials.openaiApiKey) return true;          // gpt-4o / gpt-5 vision
        if (this.credentials.claudeApiKey) return true;          // Claude vision
        if (this.credentials.geminiApiKey) return true;          // Gemini vision
        if (this.credentials.groqApiKey) return true;            // Groq llama-4-scout vision
        // Custom providers: apenas count se they ter screenshots escopo AND multimodal flag
        const custom = this.credentials.customProviders || [];
        if (custom.some(p => (p as any)?.multimodal === true)) return true;
        return this.anyLocalVisionProviderConfigured();
    }

    /**
     * True se at least one LOCAL vision provider is configured (Ollama vision model,
     * Codex CLI com vision support, ou a local-only custom provider).
     * Used by private_vision mode para enforce não cloud-vision calls.
     *
     * BUG-2 FIX: A implementação antiga acessava (this.credentials as any).ollamaBaseUrl
     * e .codexCliPath, mas esses campos NUNCA eram persistidos em StoredCredentials
     * — estavam no SettingsManager ou apenas em env vars. O resultado era que
     * anyLocalVisionProviderConfigured() SEMPRE retornava false, fazendo com que
     * o modo private_vision nunca detectasse Ollama/Codex configurados.
     *
     * FIX: Verificamos USE_OLLAMA env var + SettingsManager para CodexCLI path.
     */
    public anyLocalVisionProviderConfigured(): boolean {
        // Ollama: USE_OLLAMA=true no .env OU switch-to-ollama foi chamado em runtime
        if (process.env.USE_OLLAMA === "true") return true;

        // Codex CLI: lê do SettingsManager (onde é realmente persistido)
        try {
            const { SettingsManager } = require('./SettingsManager');
            const sm = SettingsManager.getInstance();
            const codexPath = sm.get('codexCliPath');
            if (codexPath && codexPath.trim().length > 0) return true;
        } catch { /* SettingsManager não disponível — fallback silencioso */ }

        // Custom providers locais
        const custom = this.credentials.customProviders || [];
        if (custom.some(p => p.localOnly === true && (p as any)?.multimodal === true)) return true;
        return false;
    }

    // =========================================================================
    // Setters (auto-save)
    // =========================================================================

    public setGeminiApiKey(key: string): void {
        this.credentials.geminiApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Gemini API Key updated');
    }

    public setGroqApiKey(key: string): void {
        this.credentials.groqApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Groq API Key updated');
    }

    public setOpenaiApiKey(key: string): void {
        this.credentials.openaiApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] OpenAI API Key updated');
    }

    public setClaudeApiKey(key: string): void {
        this.credentials.claudeApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Claude API Key updated');
    }

    public setDeepseekApiKey(key: string): void {
        const trimmed = key.trim();
        this.credentials.deepseekApiKey = trimmed || undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] DeepSeek API Key updated');
    }

    public setOpencodeZenApiKey(key: string): void {
        const trimmed = key.trim();
        this.credentials.opencodeZenApiKey = trimmed || undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] OpenCode Zen API Key updated');
    }

    /**
     * Persist o loopback-scoped companion-extension token. Pass an vazio string
     * para limpar it (next iniciar mints a fresh one). Only o PhoneMirrorService
     * writes isso — on primeiro iniciar (mint) e on Rotate token. The phone token is
     * NOT persisted (per-session, LAN-exposed) e is intentionally separate.
     */
    public setPhoneMirrorToken(token: string): void {
        this.credentials.phoneMirrorToken = token || undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] Extension pairing token updated');
    }

    /**
     * Persist LiteLLM proxy config. baseURL is o proxy location (required to
     * habilitar o provider); apiKey is o opcional virtual/master key;
     * maxTokens is o opcional user-set saída ceiling (0/undefined → default).
     * Passing an vazio baseURL clears everything, disabling o provider.
     */
    public setLitellmConfig(apiKey: string, baseURL: string, maxTokens?: number): void {
        const trimmedURL = (baseURL || '').trim();
        const trimmedKey = (apiKey || '').trim();
        if (!trimmedURL) {
            this.credentials.litellmApiKey = undefined;
            this.credentials.litellmBaseURL = undefined;
            this.credentials.litellmMaxTokens = undefined;
            this.saveCredentials();
            console.log('[CredentialsManager] LiteLLM config cleared');
            return;
        }
        // Empty chave + existing stored chave = keep it (o Settings campo é masked
        // e esquerda blank quando re-saving e.g. apenas o max-tokens). Clearing o
        // chave entirely é feito via Remove (empty baseURL limpa evtudo
        this.credentials.litellmApiKey = trimmedKey || this.credentials.litellmApiKey || undefined;
        this.credentials.litellmBaseURL = trimmedURL;
        const mt = Number(maxTokens);
        this.credentials.litellmMaxTokens = Number.isFinite(mt) && mt > 0 ? Math.floor(mt) : undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] LiteLLM config updated');
    }

    public setGoogleServiceAccountPath(filePath: string): void {
        this.credentials.googleServiceAccountPath = filePath;
        this.saveCredentials();
        console.log('[CredentialsManager] Google Service Account path updated');
    }

    public setSttProvider(provider: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'refract' | 'local-whisper'): void {
        this.credentials.sttProvider = provider;
        this.saveCredentials();
        console.log(`[CredentialsManager] STT Provider set to: ${provider}`);
    }

    public setDeepgramApiKey(key: string): void {
        this.credentials.deepgramApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Deepgram API Key updated');
    }

    public setGroqSttApiKey(key: string): void {
        this.credentials.groqSttApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Groq STT API Key updated');
    }

    public setOpenAiSttApiKey(key: string): void {
        this.credentials.openAiSttApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] OpenAI STT API Key updated');
    }

    public setOpenAiSttBaseUrl(url: string): void {
        // Armazenamento undefined (não vazio sstring quando clearing, então callers pode fall voltar
        // para o padrão api.openai.com endpoint com a simples truthiness cverifica
        const trimmed = url.trim();
        this.credentials.openAiSttBaseUrl = trimmed || undefined;
        this.saveCredentials();
        console.log(`[CredentialsManager] OpenAI STT Base URL set to: ${trimmed || '(default)'}`);
    }

    public setGroqSttModel(model: string): void {
        this.credentials.groqSttModel = model;
        this.saveCredentials();
        console.log(`[CredentialsManager] Groq STT Model set to: ${model}`);
    }

    public setElevenLabsApiKey(key: string): void {
        this.credentials.elevenLabsApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] ElevenLabs API Key updated');
    }

    public setAzureApiKey(key: string): void {
        this.credentials.azureApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Azure API Key updated');
    }

    public setAzureRegion(region: string): void {
        this.credentials.azureRegion = region;
        this.saveCredentials();
        console.log(`[CredentialsManager] Azure Region set to: ${region}`);
    }

    public setIbmWatsonApiKey(key: string): void {
        this.credentials.ibmWatsonApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] IBM Watson API Key updated');
    }

    public setIbmWatsonRegion(region: string): void {
        this.credentials.ibmWatsonRegion = region;
        this.saveCredentials();
        console.log(`[CredentialsManager] IBM Watson Region set to: ${region}`);
    }

    public setSonioxApiKey(key: string): void {
        this.credentials.sonioxApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Soniox API Key updated');
    }

    public setTavilyApiKey(key: string): void {
        // Armazenamento undefined (não vazio sstring quando removing, então hasKey() verifica stay consistent
        this.credentials.tavilyApiKey = key.trim() || undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] Tavily API Key updated');
    }

    public setSttLanguage(language: string): void {
        this.credentials.sttLanguage = language;
        this.saveCredentials();
        console.log(`[CredentialsManager] STT Language set to: ${language}`);
    }

    public setAiResponseLanguage(language: string): void {
        this.credentials.aiResponseLanguage = language;
        this.saveCredentials();
        console.log(`[CredentialsManager] AI Response Language set to: ${language}`);
    }
    public setDefaultModel(model: string): void {
        this.credentials.defaultModel = model;
        this.saveCredentials();
        console.log(`[CredentialsManager] Default Model set to: ${model}`);
    }

    public setRefractApiKey(key: string): void {
        const trimmed = key.trim();
        this.credentials.refractApiKey = trimmed || undefined;

        if (trimmed) {
            // Auto-promote refract para padrão modelo a menos que user já chose a non-Gemini/Groq modelo
            const current = this.credentials.defaultModel || '';
            const isAutoDefault = !current
                || current.startsWith('gemini-')
                || current.startsWith('llama-')
                || current.startsWith('mixtral-')
                || current.startsWith('gemma-')
                || current === 'gemini'
                || current === 'llama';
            if (isAutoDefault) {
                this.credentials.defaultModel = 'refract';
                console.log('[CredentialsManager] Auto-set default model to refract');
            }

            // Auto-promote refract STT se ainda em 'nnenhum ou o padrão Google STT
            if (!this.credentials.sttProvider || this.credentials.sttProvider === 'none' || this.credentials.sttProvider === 'google') {
                this.credentials.sttProvider = 'refract';
                console.log('[CredentialsManager] Auto-set STT provider to refract');
            }
        } else {
            // Chave cleared — revert refract-auto-set defaults voltar para safe fallbacks
            if (this.credentials.defaultModel === 'refract') {
                this.credentials.defaultModel = 'gemini-3.1-flash-lite';
                console.log('[CredentialsManager] Refract key cleared — reset default model to Gemini Flash-Lite');
            }
            if (this.credentials.sttProvider === 'refract') {
                this.credentials.sttProvider = 'none';
                console.log('[CredentialsManager] Refract key cleared — reset STT provider to none');
            }
        }

        this.saveCredentials();
        console.log('[CredentialsManager] Refract API Key updated');
    }

    public getPreferredModel(provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek'): string | undefined {
        const key = `${provider}PreferredModel` as keyof StoredCredentials;
        return this.credentials[key] as string | undefined;
    }

    public setPreferredModel(provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'deepseek', modelId: string): void {
        const key = `${provider}PreferredModel` as keyof StoredCredentials;
        (this.credentials as any)[key] = modelId;
        this.saveCredentials();
        console.log(`[CredentialsManager] ${provider} preferred model set to: ${modelId}`);
    }

    public saveCustomProvider(provider: CustomProvider): void {
        if (!this.credentials.customProviders) {
            this.credentials.customProviders = [];
        }
        // Verifica se exists, atualiza se então
        const index = this.credentials.customProviders.findIndex(p => p.id === provider.id);
        if (index !== -1) {
            this.credentials.customProviders[index] = provider;
        } else {
            this.credentials.customProviders.push(provider);
        }
        this.saveCredentials();
        console.log(`[CredentialsManager] Custom Provider '${provider.name}' saved`);
    }

    public deleteCustomProvider(id: string): void {
        if (!this.credentials.customProviders) return;
        this.credentials.customProviders = this.credentials.customProviders.filter(p => p.id !== id);
        this.saveCredentials();
        console.log(`[CredentialsManager] Custom Provider '${id}' deleted`);
    }

    public getCurlProviders(): CurlProvider[] {
        return this.credentials.curlProviders || [];
    }

    public saveCurlProvider(provider: CurlProvider): void {
        if (!this.credentials.curlProviders) {
            this.credentials.curlProviders = [];
        }
        const index = this.credentials.curlProviders.findIndex(p => p.id === provider.id);
        if (index !== -1) {
            this.credentials.curlProviders[index] = provider;
        } else {
            this.credentials.curlProviders.push(provider);
        }
        this.saveCredentials();
        console.log(`[CredentialsManager] Curl Provider '${provider.name}' saved`);
    }

    public deleteCurlProvider(id: string): void {
        if (!this.credentials.curlProviders) return;
        this.credentials.curlProviders = this.credentials.curlProviders.filter(p => p.id !== id);
        this.saveCredentials();
        console.log(`[CredentialsManager] Curl Provider '${id}' deleted`);
    }

    // ── Liberar Trial ─────────────────────────────────────────────
    public getTrialToken(): string | undefined {
        return this.credentials.trialToken;
    }

    public getTrialExpiresAt(): string | undefined {
        return this.credentials.trialExpiresAt;
    }

    public getTrialStartedAt(): string | undefined {
        return this.credentials.trialStartedAt;
    }

    public getTrialClaimed(): boolean {
        return this.credentials.trialClaimed === true;
    }

    public setTrialToken(token: string, expiresAt: string, startedAt: string): void {
        this.credentials.trialToken = token;
        this.credentials.trialExpiresAt = expiresAt;
        this.credentials.trialStartedAt = startedAt;
        this.credentials.trialClaimed = true;
        this.saveCredentials();
        console.log('[CredentialsManager] Trial token stored, expires:', expiresAt);
    }

    public clearTrialToken(): void {
        delete this.credentials.trialToken;
        delete this.credentials.trialExpiresAt;
        delete this.credentials.trialStartedAt;
        // trialClaimed intentionally Não cleared — keeps inicia cartão hidden após token wipe
        this.saveCredentials();
        console.log('[CredentialsManager] Trial token cleared');
    }

    public clearAll(): void {
        this.scrubMemory();
        if (fs.existsSync(CREDENTIALS_PATH)) {
            fs.unlinkSync(CREDENTIALS_PATH);
        }
        const plaintextPath = CREDENTIALS_PATH + '.json';
        if (fs.existsSync(plaintextPath)) {
            fs.unlinkSync(plaintextPath);
        }
        console.log('[CredentialsManager] All credentials cleared');
    }

    /**
     * Scrub todos API keys de memory para minimize exposure window.
     * Called on app quit e credential clear.
     */
    public scrubMemory(): void {
        // Sobrescrever cada string campo com vazio antes discarding
        for (const key of Object.keys(this.credentials) as (keyof StoredCredentials)[]) {
            const val = this.credentials[key];
            if (typeof val === 'string') {
                (this.credentials as any)[key] = '';
            }
        }
        this.credentials = {};
        console.log('[CredentialsManager] Memory scrubbed');
    }

    // =========================================================================
    // Storage (Encrypted)
    // =========================================================================

    /**
     * True quando credentials pode actually be written para disk (OS-level encryption
     * is available). When false, todo setter still updates o in-memory copiar —
     * so keys work para o atual session — mas nothing is persisted, e they
     * are gone on o próximo launch. Callers que want para warn o user (e.g. the
     * STT-key salvar IPC handlers) verificar isso so we nunca report a falso "Saved".
     */
    public isPersistenceAvailable(): boolean {
        try {
            return safeStorage.isEncryptionAvailable();
        } catch {
            return false;
        }
    }

    /**
     * Persist o in-memory credentials para o encrypted file.
     * Returns verdadeiro quando o write actually reached disk, falso quando it was a
     * memory-only no-op (encryption unavailable) ou o write threw. Most callers
     * ignore o return; o STT-key handlers use it para surface a real error
     * instead of a misleading success.
     */
    private saveCredentials(): boolean {
        try {
            if (!safeStorage.isEncryptionAvailable()) {
                console.warn('[CredentialsManager] Encryption not available; credentials kept in memory only (will NOT survive restart)');
                return false;
            }

            const data = JSON.stringify(this.credentials);
            const encrypted = safeStorage.encryptString(data);
            const tmpEnc = CREDENTIALS_PATH + '.tmp';
            fs.writeFileSync(tmpEnc, encrypted);
            fs.renameSync(tmpEnc, CREDENTIALS_PATH);
            return true;
        } catch (error) {
            console.error('[CredentialsManager] Failed to save credentials:', error);
            return false;
        }
    }

    private loadCredentials(): void {
        try {
            // Tentar encrypted arquivo primeiro
            if (fs.existsSync(CREDENTIALS_PATH)) {
                if (!safeStorage.isEncryptionAvailable()) {
                    console.warn('[CredentialsManager] Encryption not available for load');
                    return;
                }

                const encrypted = fs.readFileSync(CREDENTIALS_PATH);
                const decrypted = safeStorage.decryptString(encrypted);
                try {
                    const parsed = JSON.parse(decrypted);
                    if (typeof parsed === 'object' && parsed !== null) {
                        this.credentials = parsed;
                        console.log('[CredentialsManager] Loaded encrypted credentials');
                    } else {
                        throw new Error('Decrypted credentials is not a valid object');
                    }
                } catch (parseError) {
                    console.error('[CredentialsManager] Failed to parse decrypted credentials — file may be corrupted. Starting fresh:', parseError);
                    this.credentials = {};
                }

                // Clean para cima qualquer leftover plaintext alternativa arquivo para eliminate o dados leak
                const plaintextPath = CREDENTIALS_PATH + '.json';
                if (fs.existsSync(plaintextPath)) {
                    try {
                        fs.unlinkSync(plaintextPath);
                        console.log('[CredentialsManager] Removed stale plaintext credential file');
                    } catch (cleanupErr) {
                        console.warn('[CredentialsManager] Could not remove stale plaintext file:', cleanupErr);
                    }
                }
                return;
            }

            const plaintextPath = CREDENTIALS_PATH + '.json';
            if (fs.existsSync(plaintextPath)) {
                try {
                    fs.unlinkSync(plaintextPath);
                    console.log('[CredentialsManager] Removed plaintext credential file');
                } catch (cleanupErr) {
                    console.warn('[CredentialsManager] Could not remove plaintext credential file:', cleanupErr);
                }
            }

            console.log('[CredentialsManager] No stored credentials found');
        } catch (error) {
            console.error('[CredentialsManager] Failed to load credentials:', error);
            this.credentials = {};
        }
    }
}
