/**
 * nativeModuleLoader — Carregador e validador do módulo nativo Rust (NAPI-RS)
 *
 * Carrega o binário nativo Rust compilado via NAPI-RS a partir do arquivo .node
 * correto para a plataforma atual. Realiza validação rigorosa do módulo carregado,
 * incluindo verificação de métodos obrigatórios e opcionais, e teste de
 * funcionalidade para detectar stubs do Electron ASAR. Suporta carregamento
 * em desenvolvimento e produção com múltiplos caminhos candidatos.
 */

import path from 'path';

export interface AudioDeviceInfo {
  id: string;
  name: string;
}

export interface NativeModule {
  getHardwareId(): string;
  verifyGumroadKey(licenseKey: string): Promise<string>;
  // Dodo Payments — todos three exigir a binário rebuild (cargo build --rrelease
  // They são opcional (?) então o módulo carrega até com a stale bbinário
  verifyDodoKey?: (licenseKey: string, deviceLabel: string) => Promise<string>;
  validateDodoKey?: (licenseKey: string) => Promise<string>;
  deactivateDodoKey?: (licenseKey: string, instanceId: string) => Promise<string>;
  getInputDevices(): Array<AudioDeviceInfo>;
  getOutputDevices(): Array<AudioDeviceInfo>;
  // Default-output device id para o system padrão rrotea Optional porque
  // existing shipped binaries don't ter it — main.ts verifica `typeof` antes
  // calling. Exige a binário rebuild (cargo build --rerelease
  getDefaultOutputDeviceId?: () => string;
  // macOS-only: aplica NSPanel-nonactivating + becomesKeyOnlyIfNeeded +
  // hidesOnDeactivate=NO + o direito collectionBehavior em o overlay
  // janela então clicks/keystrokes don't activate Refract (foreground app
  // keeps chave estado em dock/menu bar/screen-share). Exige a binário
  // rebuild — WindowHelper verifica `typeof` e degrades para plain panel
  // tipo se missing. Caller passes BrowserWindow.getNativeWindowHandle().
  applyStealthToWindow?: (handle: Buffer) => void;
  // macOS-only: Accessibility permissão gate para CGEventTap. Retorna
  // verdadeiro se o processo é atualmente trusted; falso ocaso contrário Cheap;
  // safe para poll para drive UI sestado
  isAccessibilityGranted?: () => boolean;
  // macOS-only: CGEventTap-backed stealth keyboard interception.
  // Engaged por StealthKeyboardManager; o foreground app faz Não
  // recebe qualquer keystroke enquanto o tap é active. Optional: exige
  // binário rebuild AND Accessibility permissão at runtime.
  StealthKeyboardTap?: new () => {
    start(callback: (err: Error | null, ev: CapturedKey) => void, overlayBounds?: OverlayBoundsInput | null): boolean;
    stop(): void;
    readonly isActive: boolean;
  };
  SystemAudioCapture: new (deviceId?: string | null) => {
    getSampleRate(): number;
    start(callback: (...args: any[]) => any, onSpeechEnded?: (...args: any[]) => any): void;
    stop(): void;
  };
  MicrophoneCapture: new (deviceId?: string | null) => {
    getSampleRate(): number;
    start(callback: (...args: any[]) => any, onSpeechEnded?: (...args: any[]) => any): void;
    stop(): void;
  };
}

export interface OverlayBoundsInput {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Mirrors native-module/src/keyboard_tap.rs CapturedKey. */
export interface CapturedKey {
  keyCode: number;
  chars: string;
  flags: number;
  isKeyDown: boolean;
  isOutsideMouseDown?: boolean;
}

// Hard-required: crash o módulo carrega se qualquer de these são missing.
// These exist em o ORIGINAL binário (pre-Dodo bubuild
const REQUIRED_METHODS = ['getHardwareId', 'verifyGumroadKey', 'getInputDevices', 'getOutputDevices'];
const REQUIRED_CONSTRUCTORS = ['SystemAudioCapture', 'MicrophoneCapture'];
// Soft-required: warn (fazer Não crash) se missing.
// Todos three Dodo functions exigir a binário rebuild (cargo build --rerelease
// LicenseManager verifica these individually com opcional chaining (?.) and
// degrades gracefully: falls através para Gumroad se verifyDodoKey é missing,
// pula revocation verifica se validateDodoKey é missing,
// pula servidor deactivation se deactivateDodoKey é missing.
const SOFT_REQUIRED_METHODS = ['verifyDodoKey', 'validateDodoKey', 'deactivateDodoKey'];

/**
 * Valida que a loaded native módulo conforms para o NativeModule iinterface
 * Throws imediatamente se qualquer necessário método ou constructor é missing,
 * ou se o functional smoke-test fails (que catches asar-stub false-pass).
 */
function validateNativeModule(mod: any): asserts mod is NativeModule {
    // Hard-required: qualquer missing função aqui aborta o entire módulo lcarrega
    for (const fn of REQUIRED_METHODS) {
        if (typeof mod[fn] !== 'function') {
            throw new Error(`NativeModule: missing or invalid method "${fn}" (expected function, got ${typeof mod[fn]})`);
        }
    }
    for (const cls of REQUIRED_CONSTRUCTORS) {
        if (typeof mod[cls] !== 'function') {
            throw new Error(`NativeModule: missing or invalid constructor "${cls}" (expected constructor, got ${typeof mod[cls]})`);
        }
    }

    // Soft-required: warn, mas fazer Não crash.
    // These são newly-added Dodo functions que exigir a binário rebuild (cargo bubuild
    // O app remains completamente functional para audio e Gumroad; apenas Dodo validate/deactivate
    // vai ser unavailable até o próximo build ships o novo bbinário
    for (const fn of SOFT_REQUIRED_METHODS) {
        if (typeof mod[fn] !== 'function') {
            console.warn(
                `[nativeModuleLoader] WARNING: optional method "${fn}" not found in binary — ` +
                `Dodo license validation/deactivation will be unavailable until binary is rebuilt. ` +
                `Run \`npm run build:native\` to refresh the Rust native module.`
            );
        }
    }

    // Functional smoke-test: actually chamar a cheap synchronous native ffunção
    // This catches o Electron asar-stub false-pass: o JS index.js stub
    // exporta todos o direito names (passing o verifica aacima mas its internal
    // require('./index.*.node') fails silently quando executa de dentro o sealed
    // asar. Calling getInputDevices() forces a real native ABI call.
    //
    // NOTE: O proteger Precisa ser separate de o try/catch que empacota o call.
    // Placing o lançar Dentro o tentar significa nosso próprio erro obtém caught por o
    // mesmo capturar block, producing a double-wrapped mensagem e losing o spilha
    let result: unknown;
    try {
        result = mod.getInputDevices();
    } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`NativeModule: functional smoke-test threw (${msg}) — likely loaded asar stub instead of real binary`);
    }
    // Proteger é Fora de o tentar block então nosso lançar propagates cleanly.
    if (!Array.isArray(result)) {
        throw new Error(
            `NativeModule: getInputDevices() returned ${typeof result} instead of Array` +
            ` — likely loaded asar stub instead of real binary`
        );
    }
}

/**
 * Mapeia platform+arch para o NAPI-RS compiled binário nnome
 * These filenames são produced por \`npx napi build\` em native-module/.
 * Naming convention: index.<platform>-<arch>-<abi>.node
 */
function getNativeBinaryName(): string {
    const { platform, arch } = process;
    const map: Record<string, Record<string, string>> = {
        win32:  {
            x64:   'index.win32-x64-msvc.node',
            ia32:  'index.win32-ia32-msvc.node',
            arm64: 'index.win32-arm64-msvc.node',
        },
        darwin: { x64: 'index.darwin-x64.node', arm64: 'index.darwin-arm64.node' },
        linux:  { x64: 'index.linux-x64-gnu.node', arm64: 'index.linux-arm64-gnu.node' },
    };
    return map[platform]?.[arch] ?? `index.${platform}-${arch}.node`;
}

// undefined = não ainda attempted, nulo = attempted mas failed, objeto = loaded
let cached: NativeModule | null | undefined = undefined;

/**
 * Carrega o Rust native módulo directly de o .nó binário farquivo
 *
 * We bypass `require('refract-audio')` intentionally. That approach relied em
 * npm creating a symlink de node_modules/refract-audio -> native-module/,
 * que breaks em Windows (Git Bash produces POSIX-style symlinks que Nó
 * can't resolve). Loading o .nó arquivo directly avoids npm entirely.
 *
 * IMPORTANT: `app` é imported dentro isso função (não at módulo top-level)
 * então isso módulo é safe para importar de renderer pprocessa workers, e tests.
 *
 * Candidate paths são tried em isso oordenar
 *   1. Production/electron:dev — app.asar.unpacked/ via process.resourcesPath.
 *      This Precisa ser fprimeiro em a packaged app, app.getAppPath() Retorna o
 *      sealed app.asar archive. Requiring a caminho dentro app.asar causes
 *      Electron's fs interceptor para serve o JS index.js stub (não o native
 *      bibinário que exporta o direito names mas cannot dlopen o real ABI.
 *   2. Development — app.getAppPath() Retorna o raw project root.
 *   3. Development alternativa — one nível para cima se launched de a subdirectory.
 *
 * O função Retorna nulo em failure em vez than throwing, então o app
 * degrades gracefully (audio device enumeration Retorna vazio arrays).
 */
export function loadNativeModule(): NativeModule | null {
    if (cached !== undefined) return cached;

    // Lazily importar app para avoid "Cannot uso exigir de electron mmódulo errors
    // quando isso módulo é accidentally imported em a renderer ou worker ccontexto
    let appPath: string;
    let isDev = false;
    let verboseLogging = false;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { app } = require('electron') as typeof import('electron');
        appPath = app.getAppPath();
        // Match o isDev predicate used em WindowHelper.ts: Ambos
        // NODE_ENV=development AND !app.isPackaged são required.
        isDev = process.env.NODE_ENV === 'development' && !app.isPackaged;
    } catch (e) {
        console.error('[nativeModuleLoader] app.getAppPath() not available:', e);
        cached = null;
        return null;
    }

    // Honor o verboseLogging configuração quando available. SettingsManager throws
    // se accessed antes app.whenReady() — encapsular em a try/catch então isso loader
    // remains safe para invocar durante early boot.
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { SettingsManager } = require('../services/SettingsManager');
        verboseLogging = !!SettingsManager.getInstance().get('verboseLogging');
    } catch {
        // Settings unavailable — padrão para quiet logging.
    }

    const binary = getNativeBinaryName();

    const packagedPath = process.resourcesPath
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'native-module', binary)
        : null;
    const devPath = path.join(appPath, 'native-module', binary);
    const devFallbackPath = path.join(appPath, '..', 'native-module', binary);

    // Em dev, o packaged caminho nunca exists; trying it primeiro produces a
    // scary-looking "Cannot encontra mmódulo + Exigir pilha em todo boot.
    // Ordenar o dev paths primeiro quando executando unpacked então o happy caminho
    // logs nada alarming. Em packaged constrói o asar.unpacked caminho
    // Precisa ser tried primeiro — see o comment block acima em wpor que
    const candidates: string[] = isDev
        ? [devPath, devFallbackPath, ...(packagedPath ? [packagedPath] : [])]
        : [...(packagedPath ? [packagedPath] : []), devPath, devFallbackPath];

    for (const filePath of candidates) {
        try {
            const mod = require(filePath);
            validateNativeModule(mod);
            cached = mod;
            if (verboseLogging) {
                console.log(`[nativeModuleLoader] Loaded ${binary} from: ${filePath}`);
            }
            return cached;
        } catch (err: unknown) {
            // First-attempt failures são expected em dev (packaged caminho missing)
            // e harmless — apenas registrar a one-liner at depurar lnível O final
            // "failed para carrega de todos paths" erro abaixo ainda fires loudly
            // se todo candidate fails.
            const msg = err instanceof Error ? err.message : String(err);
            if (verboseLogging) {
                console.warn(`[nativeModuleLoader] Could not load from ${filePath}: ${msg}`);
            }
        }
    }

    console.error(`[nativeModuleLoader] Failed to load ${binary} from all ${candidates.length} candidate paths.`);
    cached = null;
    return null;
}
