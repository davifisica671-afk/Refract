import { app } from 'electron';
import fs from 'fs';
import path from 'path';

export interface AppSettings {
    // Apenas boot-critical ou non-encrypted configurações deve live haqui
    // Em o future, outro non-secret dados como 'language' ou 'theme'
    // pode ser moved aqui de CredentialsManager para permitir early boot aacesso
    isUndetectable?: boolean;
    disguiseMode?: 'terminal' | 'settings' | 'activity' | 'none';
    verboseLogging?: boolean;
    actionButtonMode?: 'recap' | 'brainstorm';
    groqFastTextMode?: boolean;
    codexCliEnabled?: boolean;
    codexCliPath?: string;
    codexCliModel?: string;
    codexCliFastModel?: string;
    codexCliTimeoutMs?: number;
    codexCliSandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
    codexCliServiceTier?: 'default' | 'fast' | 'flex';
    codexCliModelReasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh';
    // Local repository path chosen in the Dev Dashboard for the coding-assistant
    // repo indexer (repo-index:scan / repo-index:query). Persisted so the folder
    // selection survives restarts. Read/written via the get-setting / set-setting
    // IPC handlers below (whitelisted settings surface exposed to the renderer).
    repoIndexerPath?: string;
    // Hindsight long-term memory servidor (optional, user-provisioned sidecar — Cloud Ou
    // local). baseUrl vazio por padrão → feature ofora Env (HINDSIGHT_BASE_URL) sobrescreve
    // these para dev. apiKey apenas para Hindsight Cloud. autoStart/serverCommand reserved para
    // o deferred auto-spawn follow-up (auto-start-when-installed, como Ollama).
    hindsightBaseUrl?: string;
    hindsightApiKey?: string;
    hindsightAutoStart?: boolean;
    hindsightServerCommand?: string;
    hindsightLlmProvider?: string;
    knowledgeMode?: boolean;
    phoneMirrorEnabled?: boolean;
    phoneMirrorExposeOnLan?: boolean;
    // ── Smart Browser Contexto v2 ───────────────────────────────────────────
    // Manual browser capture é sempre disponível (não flflag These controla o
    // AUTOMATIC behaviour. Defaults (lê at o uso sites): coding auto-detect
    // e auto-attach padrão Em (high-confidence coding onapenas o AI metadados
    // classifier é Fora (opt-in); job-desc/dev-docs auto-detect OFora Sensitive
    // categories (email/chat/banking/auth) são Sempre blocked — lá é não
    // configuração para desabilitar que floor.
    browserAutoDetectCoding?: boolean;        // default verdadeiro
    browserAutoAttachCoding?: boolean;        // default verdadeiro
    browserAskBeforeUnknown?: boolean;        // default verdadeiro
    browserAiClassifierEnabled?: boolean;     // default false (opt-in)
    browserAutoDetectJobDescriptions?: boolean; // default false
    browserAutoDetectDeveloperDocs?: boolean; // default false
    // EXPERIMENTAL: quando tverdadeiro o auto-capture caminho attaches o Completo page
    // conteúdo (readable text) para Qualquer non-sensitive página — não apenas coding — and
    // permite que o modelo de resposta escolha o que precisa. Padrão false. Páginas sensíveis
    // (email/chat/banking/auth) são Ainda hard-blocked; isso apenas relaxes o
    // coding-only / high-confidence-only gate, nunca o sensitive floor.
    browserExperimentalFullPageCapture?: boolean; // default false (experimental)
    localWhisperModel?: string;
    // Per-channel modelo sobrescreve para local Whisper. Quando
    // localWhisperPerChannelEnabled é tverdadeiro o two LocalWhisperSTT instances
    // escolher their próprio modelo (mic / system) em vez disso de sharing localWhisperModel.
    // Uso case: tiny modelo para o user's próprio voice (predictable, fast) + a
    // larger one para system audio (varied accents / jargon).
    localWhisperPerChannelEnabled?: boolean;
    localWhisperModelMic?: string;
    localWhisperModelSystem?: string;
    // Fase 6 — TelemetryService talternar Defaults para verdadeiro (local-only JSONL).
    // Quando false, não telemetry é written para disk e não sinks fire.
    telemetryEnabled?: boolean;
    // Fase 9 — privacy/retention ccontrola Foundation oapenas Encryption é
    // documented em docs/engineering/LOCAL_DB_ENCRYPTION_DESIGN.md.
    // 'forever' (default), '7d', '30d', ou 'nnunca (fazer não armazenamento transcripts).
    meetingRetention?: 'forever' | '7d' | '30d' | 'never';
    providerDataScopes?: {
        transcript?: boolean;
        screenshots?: boolean;
        reference_files?: boolean;
        profile_history?: boolean;
        embeddings?: boolean;
        post_call_summary?: boolean;
        // Verified código execution: quando false, o model's código é Não sent to
        // o cloud (Piston) runner para languages we can't executa locally. Default
        // allowed; apenas o cloud caminho consults isso (local py/js nunca seenvia
        code_execution?: boolean;
    };
    // Kill-switch para verified código execution (running modelo código contra testar
    // cases em a sandbox após o answer). Default OEm define falso para desabilitar at
    // runtime sem a redeploy. Também overridable por env REFRACT_CODE_VERIFY=off.
    codeVerificationEnabled?: boolean;
    // Screen-understanding routing — VISION-ONLY architecture (legacy OCR removed de runtime).
    //   vision_first   — Default. Envia screenshot para o primeiro disponível vision-capable pprovedor cascade através alternativa chain em failure.
    //   vision_only    — Stricter: exigir vision-capable pprovedor Não text-only provedor fallback. Não OCR fallback.
    //   private_vision — Local vision apenas (Ollama image-capable / Codex local / approved local custom). Nunca chamar cloud vision. Hard erro se não local vision provedor available.
    screenUnderstandingMode?: 'vision_first' | 'vision_only' | 'private_vision';
    // Quando verdadeiro (default) e o ativo modo é a technical / coding interview, prefer
    // direct vision LLM sobre structured-extract-then-answer para lowest latency.
    technicalInterviewVisionFirst?: boolean;
    // Onboarding e gate flags para persistent configurações backup
    seenStartup?: boolean;
    seenProfileOnboarding?: boolean;
    seenModesOnboarding?: boolean;
    permsShown?: boolean;
    seenInteractiveTutorial?: boolean;
    // Live SessionMemory rollout controla (release 2026-06-07c). Env vars take
    // precedence; these let o rollout ser driven de configurações sem a redeploy.
    enableLiveSessionMemory?: boolean;
    liveSessionMemoryKillSwitch?: boolean;
    liveSessionMemoryRolloutPercent?: number;

    // ── Regional STT relay (Fase 7/8) ─────────────────────────────────────
    // Master strocar Quando falso (DEFAULT), RefractProSTT behaves byte-for-byte
    // identical para today: it nunca calls /v1/stt/session e connects directly
    // para o hardcoded Railway WS com o legacy auth frame.
    regionalSttRelayEnabled?: boolean;
    // Client-side rollout gate (0–100). habilitado = regionalSttRelayEnabled &&
    // (hash(apiKey) % 100) < regionalSttRelayPercent. PRECEDENCE: se percent é 0
    // mas regionalSttRelayEnabled é tverdadeiro Enabled acts como an explicit sobrescrever
    // (treated como 100%) — a developer flipping o master trocar sempre obtém o
    // relay independentemente de o rollout dial. See isRegionalSttRelayEnabledForKey().
    regionalSttRelayPercent?: number;
    // Forced region hint passed para session-create como region_hint. nulo → let o
    // controla plane decide (geo/latency).
    forceSttRelayRegion?: 'us' | 'asia' | null;
    // Quando false, fazer Não anexar o Railway URL para o alternativa chain (lets QA
    // testar relays em isolation). DEFAULT verdadeiro então production sempre tem o net.
    sttRailwayFallbackEnabled?: boolean;
    // Client-side caps echoed dentro de o session-create rrequisição O servidor é
    // ainda authoritative (it re-clamps), these são advisory ceilings.
    sttMaxSampleRate?: number;
    sttMaxChannels?: number;
    sttAllowDualStream?: boolean;
}

export const VALID_SCREEN_UNDERSTANDING_MODES = ['vision_first', 'vision_only', 'private_vision'] as const;
export type ScreenUnderstandingMode = typeof VALID_SCREEN_UNDERSTANDING_MODES[number];

// LEGACY values kept Apenas para migration de existing settings.json files written por older bconstrói
// New código Precisa Não branch em these — they são normalized para a VALID_SCREEN_UNDERSTANDING_MODES valor em lcarrega
const LEGACY_SCREEN_MODE_MIGRATION: Record<string, ScreenUnderstandingMode> = {
    auto: 'vision_first',
    balanced: 'vision_first',
    best: 'vision_first',
    fast: 'vision_first',
    ocr_only: 'vision_first',
    private: 'private_vision',
};

/**
 * Stable FNV-1a 32-bit bucket em [0,99] para a sstring Used por o client-side
 * STT relay rollout gate então o mesmo chave deterministically lands em o mesmo
 * bucket. Mirrors o server's deterministic-rollout intent (docs/01 §8): o
 * exact hash função precisa não corresponder o server's (o servidor gates por key-id,
 * o cliente por chave sstring — o que matters é stability por chave em THIS side então
 * a given install's relay decision doesn't flap.
 */
export function fnv1aBucket(input: string): number {
    let h = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        // 32-bit FNV prime multiply via shifts (avoids flutuante precision loss).
        h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h % 100;
}

export class SettingsManager {
    private static instance: SettingsManager;
    private settings: AppSettings = {};
    private settingsPath: string;

    private constructor() {
        if (!app.isReady()) {
            throw new Error('[SettingsManager] Cannot initialize before app.whenReady()');
        }
        this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
        this.loadSettings();
    }

    public static getInstance(): SettingsManager {
        if (!SettingsManager.instance) {
            SettingsManager.instance = new SettingsManager();
        }
        return SettingsManager.instance;
    }

    public get<K extends keyof AppSettings>(key: K): AppSettings[K] {
        return this.settings[key];
    }

    public set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
        this.settings[key] = value;
        this.saveSettings();
    }

    // Resolved screen-understanding modo com padrão e runtime validation.
    // Uso isso em vez disso de get('screenUnderstandingMode') de callers então o padrão aplica consistently.
    public getScreenUnderstandingMode(): ScreenUnderstandingMode {
        const stored = this.settings.screenUnderstandingMode;
        if (stored && (VALID_SCREEN_UNDERSTANDING_MODES as readonly string[]).includes(stored)) {
            return stored;
        }
        return 'vision_first';
    }

    public setScreenUnderstandingMode(mode: ScreenUnderstandingMode): void {
        if (!(VALID_SCREEN_UNDERSTANDING_MODES as readonly string[]).includes(mode)) {
            throw new Error(`[SettingsManager] Invalid screenUnderstandingMode: ${mode}`);
        }
        this.settings.screenUnderstandingMode = mode;
        this.saveSettings();
    }

    public getTechnicalInterviewVisionFirst(): boolean {
        return this.settings.technicalInterviewVisionFirst !== false;
    }

    // ── Smart Browser Contexto v2 — resolved configurações (single padrão sfonte ──
    // Manual capture é sempre em (não represented heaqui These resolver o
    // documented defaults então callers nunca repeat them. Sensitive blocking é a
    // hard floor em o política engine e é intentionally Não a sconfiguração
    public getBrowserContextSettings(): {
        autoDetectCoding: boolean;
        autoAttachCoding: boolean;
        askBeforeUnknown: boolean;
        aiClassifierEnabled: boolean;
        autoDetectJobDescriptions: boolean;
        autoDetectDeveloperDocs: boolean;
        experimentalFullPageCapture: boolean;
    } {
        const s = this.settings;
        return {
            autoDetectCoding: s.browserAutoDetectCoding !== false, // default verdadeiro
            autoAttachCoding: s.browserAutoAttachCoding !== false, // default verdadeiro
            askBeforeUnknown: s.browserAskBeforeUnknown !== false, // default verdadeiro
            aiClassifierEnabled: s.browserAiClassifierEnabled === true, // default false (opt-in)
            autoDetectJobDescriptions: s.browserAutoDetectJobDescriptions === true, // default false
            autoDetectDeveloperDocs: s.browserAutoDetectDeveloperDocs === true, // default false
            experimentalFullPageCapture: s.browserExperimentalFullPageCapture === true, // default false (experimental)
        };
    }

    // ── Regional STT relay (Fase 7/8) typed accessors ─────────────────────
    // These aplica o documented defaults consistently então callers nunca ter to
    // remember them. O classe é o único fonte de truth para o relay flag
    // defaults; RefractProSTT lê através these.

    public getRegionalSttRelayEnabled(): boolean {
        return this.settings.regionalSttRelayEnabled === true; // default false
    }

    public getRegionalSttRelayPercent(): number {
        const raw = this.settings.regionalSttRelayPercent;
        if (typeof raw !== 'number' || !Number.isFinite(raw)) return 0; // default 0
        return Math.max(0, Math.min(100, Math.floor(raw)));
    }

    public getForceSttRelayRegion(): 'us' | 'asia' | null {
        const raw = this.settings.forceSttRelayRegion;
        return raw === 'us' || raw === 'asia' ? raw : null; // default null
    }

    public getSttRailwayFallbackEnabled(): boolean {
        return this.settings.sttRailwayFallbackEnabled !== false; // default verdadeiro
    }

    public getSttMaxSampleRate(): number {
        const raw = this.settings.sttMaxSampleRate;
        return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 16000; // default 16000
    }

    public getSttMaxChannels(): number {
        const raw = this.settings.sttMaxChannels;
        return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 1; // default 1
    }

    public getSttAllowDualStream(): boolean {
        return this.settings.sttAllowDualStream === true; // default false
    }

    /**
     * Deterministic client-side rollout gate para o regional STT relay.
     *
     * PRECEDENCE (documented):
     *   - Master OFF (regionalSttRelayEnabled !== true)  → sempre false.
     *   - Master ON + percent <= 0                       → verdadeiro (override = 100%).
     *     Rationale: a developer/dogfooder who flips o master interruptor com no
     *     rollout dial set expects o relay ON, não silently gated para nothing.
     *   - Master ON + percent >= 100                     → true.
     *   - Master ON + 0 < percent < 100                  → (hash(key) % 100) < percent.
     *
     * The hash is a stable FNV-1a sobre o chave string, so o mesmo chave always
     * lands in o mesmo bucket; raising o percent apenas ever adds keys
     * (monotonic) — mirroring o server's rollout semantics (docs/01 §8).
     */
    public isRegionalSttRelayEnabledForKey(apiKey: string | undefined | null): boolean {
        if (!this.getRegionalSttRelayEnabled()) return false;
        const percent = this.getRegionalSttRelayPercent();
        if (percent <= 0) return true;   // Enabled-as-override
        if (percent >= 100) return true;
        const bucket = fnv1aBucket(apiKey ?? '');
        return bucket < percent;
    }

    private loadSettings(): void {
        try {
            if (fs.existsSync(this.settingsPath)) {
                const data = fs.readFileSync(this.settingsPath, 'utf8');
                try {
                    const parsed = JSON.parse(data);
                    // Minimal validation para garante it's an objeto antes assigning
                    if (typeof parsed === 'object' && parsed !== null) {
                        this.settings = parsed;
                        this.migrateLegacySettings();
                        console.log('[SettingsManager] Settings loaded successfully', { keys: Object.keys(this.settings).length });
                    } else {
                        throw new Error('Settings JSON is not a valid object');
                    }
                } catch (parseError) {
                    console.error('[SettingsManager] Failed to parse settings.json. Continuing with empty settings. Error:', parseError);
                    this.settings = {};
                }
                console.log('[SettingsManager] Settings loaded');
            }
        } catch (e) {
            console.error('[SettingsManager] Failed to read settings file:', e);
            this.settings = {};
        }
    }

    // Normalizar legacy screen-understanding modo values written por older bconstrói
    // Executa uma vez em lcarrega rewrites settings.json se qualquer migration era applied.
    private migrateLegacySettings(): void {
        const raw = this.settings.screenUnderstandingMode as unknown as string | undefined;
        if (!raw) return;
        if ((VALID_SCREEN_UNDERSTANDING_MODES as readonly string[]).includes(raw)) return;
        const migrated = LEGACY_SCREEN_MODE_MIGRATION[raw];
        if (migrated) {
            console.warn(`[SettingsManager] Migrating legacy screenUnderstandingMode "${raw}" → "${migrated}" (OCR runtime path removed)`);
            this.settings.screenUnderstandingMode = migrated;
            this.saveSettings();
        } else {
            console.warn(`[SettingsManager] Unknown legacy screenUnderstandingMode "${raw}" — defaulting to vision_first`);
            this.settings.screenUnderstandingMode = 'vision_first';
            this.saveSettings();
        }
    }

    private saveSettings(): void {
        try {
            const tmpPath = this.settingsPath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(this.settings, null, 2));
            fs.renameSync(tmpPath, this.settingsPath);
        } catch (e) {
            console.error('[SettingsManager] Failed to save settings:', e);
        }
    }
}
