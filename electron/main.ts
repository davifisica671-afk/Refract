/**
 * =============================================================================
 * ARQUIVO PRINCIPAL DO APP ELECTRON — main.ts
 * =============================================================================
 * 
 * DESCRIÇÃO GERAL:
 * Este é o CORAÇÃO do aplicativo Refract — um assistente de IA para entrevistas
 * ao vivo. O app funciona como uma sobreposição (overlay) transparente que fica por cima
 * de aplicativos de videoconferência (Zoom, Google Meet, Teams, etc.) e transcreve áudio
 * em tempo real, fornecendo respostas e sugestões de IA durante entrevistas de emprego.
 *
 * ESTRUTURA DO ARQUIVO:
 * 1. Imports e configuração inicial (linhas 1-100)
 * 2. Funções utilitárias: DNS lookup, logging, permissões macOS (linhas 100-400)
 * 3. Tipos e interfaces: Status de permissões, screenshots (linhas 400-460)
 * 4. Classe AppState — CLASSE PRINCIPAL que gerencia todo o estado do app (linhas 483-6000+)
 *    - Janelas (Launcher + Overlay)
 *    - Áudio (captura do sistema + microfone)
 *    - STT (Speech-to-Text) — transcrição de áudio em texto
 *    - Reuniões (iniciar/parar/salvar)
 *    - RAG (Retrieval Augmented Generation — busca em reuniões anteriores)
 *    - Atualizações automáticas
 *    - Temas e configurações
 * 5. Função initializeApp() — ponto de entrada que orquestra toda a inicialização
 *
 * CONCEITOS CHAVE:
 * - Launcher: Janela principal do app (mostra lista de reuniões, configurações)
 * - Overlay: Sobreposição transparente que aparece durante reuniões (mostra transcrição + IA)
 * - STT (Speech-to-Text): Conversão de áudio em texto em tempo real (vários provedores)
 * - LLM (Large Language Model): Modelos de IA que geram respostas (Gemini, Groq, OpenAI, etc.)
 * - RAG: Sistema que indexa reuniões anteriores para busca semântica
 * - Content Protection: Modo "indetectável" que esconde a janela de capturas de tela
 * - TCC: Sistema de permissões do macOS (Transparency, Consent, and Control)
 * =============================================================================
 */

// =============================================================================
// SEÇÃO 1: IMPORTS E CONFIGURAÇÃO INICIAL
// =============================================================================

/**
 * Importação principal do Electron — fornece todas as APIs nativas:
 * - app: Controle do ciclo de vida do aplicativo
 * - BrowserWindow: Criação de janelas
 * - Tray: Ícone na bandeja do sistema
 * - Menu: Menus contextuais
 * - nativeImage: Manipulação de imagens
 * - ipcMain: Comunicação entre processos principal ↔ renderer
 * - shell: Abrir URLs/arquivos externos
 * - systemPreferences: Permissões do macOS (microfone, tela)
 * - screen: Informações de monitor
 * - desktopCapturer: Captura de tela do desktop
 */
import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, shell, systemPreferences, screen, desktopCapturer } from "electron"
import * as crypto from "crypto"        // Criptografia para UUIDs e hashes
import path from "path"                  // Manipulação de caminhos de arquivo
import fs from "fs"                      // Sistema de arquivos (leitura/escrita de logs)
import dns from "dns"                    // Resolução DNS (hack global abaixo)
import { SystemAudioHealthClassifier } from "./audio/systemAudioHealthClassifier.mjs" // Classificador de saúde do áudio do sistema
import { autoUpdater } from "electron-updater" // Atualizador automático do app
import type { IpcInvokeChannel } from "./ipc/ipcChannels" // Contrato de canais IPC (gerado)

/**
 * HACK CRÍTICO: Sobrescrever dns.lookup global para resolver problemas do resolvedor
 * 
 * PROBLEMA: O macOS às vezes falha ao resolver api.refract.software usando dns.lookup,
 * retornando endereços IPv6 que o servidor não suporta.
 * 
 * SOLUÇÃO: Interceptamos chamadas para api.refract.software e forçamos resolução IPv4
 * usando dns.resolve4 diretamente. Outros hostnames passam normalmente.
 * 
 * Por que isso é necessário: electron-updater usa dns.lookup internamente, e se a
 * resolução falhar, o app não consegue verificar atualizações.
 */
const originalLookup = dns.lookup;
dns.lookup = function(hostname: any, options: any, callback: any) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  if (hostname === 'api.refract.software') {
    dns.resolve4(hostname, (err, addresses) => {
      if (err || !addresses.length) {
        originalLookup(hostname, options, callback);
      } else {
        const addr = addresses[0];
        if (options && (options as any).all) {
          callback(null, [{ address: addr, family: 4 }] as any);
        } else {
          callback(null, addr, 4);
        }
      }
    });
  } else {
    originalLookup(hostname, options, callback);
  }
} as any;

if (!app.isPackaged) {
  require('dotenv').config();
}


/**
 * Se esta build possui uma assinatura real de Developer ID.
 *
 * O caminho da release assinada (`electron-builder.signed.cjs`) inclui
 * `refractSigned: true` dentro do package.json do app empacotado via
 * `extraMetadata`. A build padrão/dev o deixa ausente. Lemos o flag
 * uma vez do package.json empacotado (dentro do asar) e armazenamos em cache.
 *
 * Esta é a "metade da flag" do gate de auto-instalação — veja canAutoInstall().
 */
let _cachedSignedBuild: boolean | null = null
function isSignedBuild(): boolean {
  if (_cachedSignedBuild !== null) return _cachedSignedBuild
  try {
    const pkgPath = path.join(app.getAppPath(), 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    _cachedSignedBuild = pkg?.refractSigned === true
  } catch {
    _cachedSignedBuild = false
  }
  return _cachedSignedBuild
}

/**
 * Se esta build pode executar a auto-instalação real in-place + relançamento.
 *
 *  - Dev (não empacotada): nunca — electron-updater é inativo em dev mesmo assim.
 *  - Windows / Linux empacotadas: sim — NSIS/AppImage relançam normalmente
 *    sem assinatura de código estilo macOS.
 *  - macOS empacotada: apenas quando assinada — Squirrel.Mac se recusa a trocar e
 *    relançar um app que não possui uma assinatura válida de Developer ID, então uma build
 *    não assinada de macOS precisa recorrer ao fluxo manual "abrir o download".
 */
function canAutoInstall(): boolean {
  if (!app.isPackaged) return false
  if (process.platform === 'darwin') return isSignedBuild()
  return true
}

// Tratar erros de stdout/stderr não nível do processo para prevenir crashes de EIO
// Isso é crítico para apps Electron que podem ter seu terminal desanexado
process.stdout?.on?.('error', () => { });
process.stderr?.on?.('error', () => { });

process.on('uncaughtException', (err) => {
  logToFile('[CRITICAL] Uncaught Exception: ' + redactArgsForLog([err]));
  // Encerrar o processo para evitar estado corrompido após exceção não tratada.
  // O Electron continua rodando mesmo com erros fatais se não sairmos explicitamente.
  // eslint-disable-next-line no-process-exit
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logToFile('[CRITICAL] Unhandled Rejection: ' + redactArgsForLog([reason]));
});

// Correção CQ-04: não chamar app.getPath() não momento em que o módulo é carregado.
// app.getPath('documents') não é garantido de estar disponível antes de app.whenReady().
// Uso o getter preguiçoso em vez disso — o caminho é resolvido na primeira chamada de logToFile().
let _logFile: string | null = null;
const getLogFile = (): string | null => {
  if (_logFile) return _logFile;
  try {
    _logFile = path.join(app.getPath('documents'), 'refract_debug.log');
    return _logFile;
  } catch {
    // app.ready ainda não disparou — retorna null, logToFile vai pular silenciosamente
    return null;
  }
};

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

// Importação preguiçosa do redator — obtido na primeira chamada para que este arquivo possa inicializar mesmo se
// o módulo do redator falhar ao carregar (recorremos a uma transformação de operação nula
let _redactForLog: ((args: unknown[]) => string) | null = null;
function redactArgsForLog(args: unknown[]): string {
  if (!_redactForLog) {
    try {
      _redactForLog = require('./utils/redactForLog').redactForLog;
    } catch {
      _redactForLog = (xs: unknown[]) => xs.map(a => {
        try {
          if (a instanceof Error) return a.stack || a.message;
          if (typeof a === 'object' && a !== null) return JSON.stringify(a);
          return String(a);
        } catch {
          // Objetos com referência circular ou não serializáveis não devem quebrar o logging
          return '[Unserializable]';
        }
      }).join(' ');
    }
  }
  return _redactForLog!(args);
}

/**
 * Envolve a promise com timeout. Se a promise não resolver dentro de `ms`
 * milissegundos, rejeita com um erro cuja mensagem contém `tag`. Isso
 * previne desktopCapturer.getSources (que pode bloquear indefinidamente em diálogos
 * TCC ou respostas lentas de API) de travar o processo principal do Electron.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, tag: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`[withTimeout] ${tag} timed out after ${ms}ms`));
    }, ms);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

/** Tamanho máximo do arquivo de registro antes da rotação (10 MB). */
const LOG_MAX_BYTES = 10 * 1024 * 1024;

function logToFile(msg: string) {
  try {
    const logFile = getLogFile();
    // Se o app ainda não está pronto (caminho não disponível), pular silenciosamente.
    if (!logFile) return;

    // P2-1: rotacionar o arquivo de registro quando excede LOG_MAX_BYTES para que sessões
    // de longa duração (ou reuniões com transcrições densas) não enchem o disco do usuário.
    // O registro anterior é mantido como .log1 para rotação de uma geração.
    try {
      const stat = fs.statSync(logFile);
      if (stat.size >= LOG_MAX_BYTES) {
        const rotated = logFile + '.1';
        if (fs.existsSync(rotated)) fs.unlinkSync(rotated);
        fs.renameSync(logFile, rotated);
      }
    } catch {
      // statSync lança exceção se o arquivo ainda não existe — isso é normal
    }
    fs.appendFileSync(logFile, new Date().toISOString() + ' ' + msg + '\n');
  } catch (e) {
    // Ignorar erros de logging
  }
}

async function ensureMacMicrophoneAccess(context: string): Promise<boolean> {
  if (process.platform !== 'darwin') return true;

  try {
    const currentStatus = systemPreferences.getMediaAccessStatus('microphone');
    console.log(`[Main] macOS microphone permission before ${context}: ${currentStatus}`);

    if (currentStatus === 'granted') {
      return true;
    }

    const granted = await systemPreferences.askForMediaAccess('microphone');
    console.log(
      `[Main] macOS microphone permission request during ${context}: ${granted ? 'granted' : 'denied'}`
    );
    return granted;
  } catch (error) {
    console.error(`[Main] Failed to check macOS microphone permission during ${context}:`, error);
    return false;
  }
}

/**
 * Verifica o status da permissão de Gravação de Tela do macOS (kTCCServiceScreenCapture)
 *
 * Electron não tem a API askForMediaAccess('screen') — macOS apenas mostra o diálogo
 * TCC quando o app realmente chama uma API protegida (SCK / CoreAudio tap).
 * Se a permissão é 'denied', não podemos solicitar novamente; o usuário precisa reativar
 * manualmente em Ajustes do Sistema → Privacidade e Segurança → Gravação de Tela.
 *
 * Retorna falso apenas quando a permissão é explicitamente 'denied'. Todos os outros
 * estados ('granted', 'not-determined', 'restricted') retornam verdadeiro porque
 *   - 'granted':         já permitido — nada a fazer
 *   - 'not-determined':  macOS mostrará o diálogo quando o tap SCK/CoreAudio para executado
 *   - 'restricted':      política de dispositivo gerenciado — nada que possamos fazer programaticamente.
 */
type MacScreenCaptureStatus = 'granted' | 'denied' | 'not-determined' | 'restricted';

type MacScreenCaptureCapability = {
  status: MacScreenCaptureStatus;
  capturable: boolean;
  effectiveDenied: boolean;
  sourceCount: number;
  message?: string;
  error?: string;
};

let latestSystemAudioPermissionWarning: string | null = null;

function rememberSystemAudioPermissionWarning(message: string): void {
  latestSystemAudioPermissionWarning = message;
}

function clearSystemAudioPermissionWarning(): void {
  latestSystemAudioPermissionWarning = null;
}

/**
 * B5: Se o bypass de TCC em modo dev está habilitado.
 *
 * Antes da correção, este bypass era incondicional em modo dev, então toda execução
 * `npm executar app:dev` reportava o status de captura de tela como `'granted'`
 * independentemente do estado real do TCC. Bugs de produção (a falha dominante
 * "permissões concedidas mas sem transcrição") eram invisíveis durante o desenvolvimento local.
 *
 * Agora é opt-in: padrão desligado em modo dev para que os desenvolvedores vejam o real
 * estado do TCC. Defina `REFRACT_DEV_BYPASS_SCREEN_TCC=1` para restaurar o bypass
 * legado para o desenvolvimento diário tranquilo.
 */
function isDevTccBypassEnabled(): boolean {
  return !app.isPackaged && process.env.REFRACT_DEV_BYPASS_SCREEN_TCC === '1';
}

function getMacScreenCaptureStatus(): MacScreenCaptureStatus {
  if (process.platform !== 'darwin') return 'granted';

  // B5: bypass opt-in de dev — veja isDevTccBypassEnabled() para justificativa.
  if (isDevTccBypassEnabled()) {
    console.log('[Main] Dev TCC bypass enabled (REFRACT_DEV_BYPASS_SCREEN_TCC=1) — reporting screen capture as granted');
    return 'granted';
  }

  try {
    return systemPreferences.getMediaAccessStatus('screen') as MacScreenCaptureStatus;
  } catch (error) {
    console.error('[Main] Failed to check screen recording permission:', error);
    return 'not-determined';
  }
}

async function resolveMacScreenCaptureCapability(context: string): Promise<MacScreenCaptureCapability> {
  const status = getMacScreenCaptureStatus();

  const isMac = process.platform === 'darwin';
  // B5: Espelhar a política de bypass opt-in de getMacScreenCaptureStatus. O padrão em
  // dev é executar a resolução completa de capacidade para que os desenvolvedores vejam o real caminho
  if (!isMac || isDevTccBypassEnabled()) {
    clearSystemAudioPermissionWarning();
    return { status, capturable: true, effectiveDenied: false, sourceCount: 0 };
  }

  if (isMac && status === 'restricted') {
    const message = formatPermissionMessage('mac-screen-recording-restricted');
    rememberSystemAudioPermissionWarning(message);
    return { status, capturable: false, effectiveDenied: true, sourceCount: 0, message };
  }

  if (status !== 'denied') {
    clearSystemAudioPermissionWarning();
    return { status, capturable: true, effectiveDenied: false, sourceCount: 0 };
  }

  try {
    const sources = await withTimeout(
      desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1, height: 1 },
      }),
      5000,
      `screen-capture-probe-timeout-${context}`,
    );
    const sourceCount = sources.filter((source) => source.id.startsWith('screen:')).length;
    const capturable = sourceCount > 0;

    if (capturable) {
      clearSystemAudioPermissionWarning();
      console.warn(`[Main] Screen Recording status is denied during ${context}, but capture probe succeeded; continuing without permission banner.`);
    } else {
      rememberSystemAudioPermissionWarning(formatPermissionMessage('screen-recording-denied'));
    }

    return { status, capturable, effectiveDenied: !capturable, sourceCount };
  } catch (error: any) {
    // Fez o tempo limite fire?
    if (error?.message?.includes('screen-capture-probe-timeout')) {
      const message = formatPermissionMessage('screen-recording-denied');
      rememberSystemAudioPermissionWarning(message + ' (probe timed out)');
      console.warn(`[Main] Screen Recording capture probe timed out during ${context} — treating as denied.`);
      return { status, capturable: false, effectiveDenied: true, sourceCount: 0, message, error: error.message };
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    const message = formatPermissionMessage('screen-recording-denied');
    rememberSystemAudioPermissionWarning(message);
    console.warn(`[Main] Screen Recording capture probe failed during ${context}: ${errorMessage}`);
    return { status, capturable: false, effectiveDenied: true, sourceCount: 0, message, error: errorMessage };
  }
}

/**
 * Formata a mensagem de áudio/permissão voltada ao usuário para a plataforma atual.
 * macOS tem painéis de TCC (Gravação de Tela, Microfone) em Ajustes do Sistema;
 * Windows não tem equivalente para captura de tela (loopback de áudio do sistema é executado
 * via WASAPI sem controle não nível do SO) e controla o microfone via
 * Ajustes → Privacidade → Microfone. Reutilizar o texto do macOS não Windows é a
 * causa da contaminação cruzada relatada na issue #252.
 */
// Variantes com prefixo `mac-` são exclusivas do macOS e referenciam conceitos de TCC / CoreAudio /
// ScreenCaptureKit que não existem não Windows. Os locais de chamada para essas
// variantes precisam ser protegidos por `process.platform === 'darwin'` — o
// prefixo torna essa restrição visível durante a revisão de código. Variantes
// multiplataforma não possuem prefixo e fazem branch internamente em isMac.
type PermissionReason =
  | 'screen-recording-denied'
  | 'mac-screen-recording-restricted'
  | 'mac-screen-recording-revoked-rebuild'
  | 'mic-denied'
  | 'mic-zero-fill'
  | 'mac-same-device-input-output'
  | 'system-audio-stuck';
function formatPermissionMessage(reason: PermissionReason, extra?: { device?: string }): string {
  const isMac = process.platform === 'darwin';
  switch (reason) {
    case 'screen-recording-denied':
      return isMac
        ? 'Screen Recording permission denied. Interviewer audio will not be captured. Enable in System Settings → Privacy & Security → Screen Recording, then restart the app.'
        : 'System audio capture is unavailable. Interviewer audio will not be captured. Check your audio device routing in Settings and restart the meeting.';
    case 'mac-screen-recording-restricted':
      if (!isMac) return formatPermissionMessage('system-audio-stuck');
      return 'Screen Recording is restricted by device policy. Interviewer audio will not be captured. Contact your administrator to allow screen capture for Refract.';
    case 'mac-screen-recording-revoked-rebuild':
      // Defesa em profundidade: embora todos os locais de chamada precisem ser protegidos por darwin
      // (o prefixo `mac-` marca esta restrição caso um futuro colaborador
      // chame isto pelo caminho multiplataforma, degradamos graciosamente em vez
      // de vazar strings de interface do macOS para usuários do Windows.
      if (!isMac) return formatPermissionMessage('system-audio-stuck');
      return 'System audio is being captured but every sample is silent. This usually means macOS Screen Recording permission needs to be re-granted to this build of Refract. Open System Settings → Privacy & Security → Screen Recording, toggle Refract off and back on, then restart the app. (If you recently rebuilt or updated, the previous grant may not apply.)';
    case 'mic-denied':
      return isMac
        ? 'Microphone access denied. Please allow microphone access in System Settings → Privacy & Security → Microphone, then restart Refract.'
        : 'Microphone access denied. Please allow microphone access in Settings → Privacy → Microphone, then restart Refract.';
    case 'mic-zero-fill':
      return isMac
        ? 'Microphone is producing silent audio. Check that the device is unmuted and that macOS Microphone permission is granted to Refract in System Settings → Privacy & Security → Microphone.'
        : 'Microphone is producing silent audio. Check that the device is unmuted and that Refract has microphone access in Settings → Privacy → Microphone.';
    case 'mac-same-device-input-output':
      // Defense-in-depth: see comment em `mac-screen-recording-revoked-rebuild`.
      // O CoreAudio Processo Tap de mesmo dispositivo é específico do macOS;
      // não Windows, o loopback WASAPI funciona normalmente não mesmo dispositivo que o microfone.
      if (!isMac) return formatPermissionMessage('system-audio-stuck');
      return `Silent capture detected — input and output are the same device (${extra?.device ?? 'unknown'}). macOS cannot tap a device while it is also the active microphone. Switch input to built-in mic or output to built-in speakers.`;
    case 'system-audio-stuck':
      return 'No audio detected on system output for 8s. If your meeting app is using a different output device (Bluetooth headset, virtual cable, second monitor), switch it to your default output, or restart the meeting after switching.';
  }
}

console.log = (...args: any[]) => {
  logToFile('[LOG] ' + redactArgsForLog(args));
  try {
    originalLog.apply(console, args);
  } catch { }
};

console.warn = (...args: any[]) => {
  logToFile('[WARN] ' + redactArgsForLog(args));
  try {
    originalWarn.apply(console, args);
  } catch { }
};

console.error = (...args: any[]) => {
  logToFile('[ERROR] ' + redactArgsForLog(args));
  try {
    originalError.apply(console, args);
  } catch { }
};

import { initializeIpcHandlers } from "./ipcHandlers"
import { WindowHelper } from "./WindowHelper"
import { SettingsWindowHelper } from "./SettingsWindowHelper"
import { ModelSelectorWindowHelper } from "./ModelSelectorWindowHelper"
import { CropperWindowHelper } from "./CropperWindowHelper"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { KeybindManager } from "./services/KeybindManager"
import { ProcessingHelper } from "./ProcessingHelper"
import { registerLemonSqueezyHandlers } from "./services/LemonSqueezyIpc"
import { registerPurchaseActivationHandlers } from "./services/PurchaseActivationIpc"
import { registerRoleTwinHandlers } from "./services/RoleTwinIpc"

import { IntelligenceManager } from "./IntelligenceManager"
import { SystemAudioCapture } from "./audio/SystemAudioCapture"
import { MicrophoneCapture } from "./audio/MicrophoneCapture"
import { AudioDevices } from "./audio/AudioDevices"
import { loadNativeModule } from "./audio/nativeModuleLoader"
import { GoogleSTT } from "./audio/GoogleSTT"
import { RestSTT } from "./audio/RestSTT"
import { DeepgramStreamingSTT } from "./audio/DeepgramStreamingSTT"
import { isIntelligenceFlagEnabled } from "./intelligence/intelligenceFlags"
import { SonioxStreamingSTT } from "./audio/SonioxStreamingSTT"
import { ElevenLabsStreamingSTT } from "./audio/ElevenLabsStreamingSTT"
import { OpenAIStreamingSTT } from "./audio/OpenAIStreamingSTT"
import { RefractProSTT } from "./audio/RefractProSTT"
import { ThemeManager } from "./ThemeManager"
import { RAGManager } from "./rag/RAGManager"
import { DatabaseManager } from "./db/DatabaseManager"
import { warmupIntentClassifier } from "./llm"

/** Tipo unificado para todos os provedores STT com capacidades estendidas opcionais */
type STTProvider = (GoogleSTT | RestSTT | DeepgramStreamingSTT | SonioxStreamingSTT | ElevenLabsStreamingSTT | OpenAIStreamingSTT | RefractProSTT) & {
  finalize?: () => void;
  setAudioChannelCount?: (count: number) => void;
  notifySpeechEnded?: () => void;
};

type ScreenshotWindowMode = 'launcher' | 'overlay';

/** Payload para eventos IPC de status stt transmitir do principal para o renderer */
interface SttStatusPayload {
  // 'awaiting-audio' (B2) é o estado pós-início de reunião / pré-verificação de áudio.
  // A WebSocket do STT pode estar conectada mas nenhum transcript isFinal chegou ainda, então
  // não podemos honestamente declarar 'connected' na interface. Os renderers devem exibir isto
  // como o indicador neutro "Ouvindo áudio…", não verde/ativo.
  state: 'connected' | 'reconnecting' | 'failed' | 'awaiting-audio';
  provider: string;
  error?: string;
  channel: 'user' | 'interviewer';
  reconnectAttempts?: number;
}
type ScreenshotCaptureKind = 'full' | 'selective';

interface ScreenshotCaptureSession {
  captureKind: ScreenshotCaptureKind;
  wasMainWindowVisible: boolean;
  windowMode: ScreenshotWindowMode;
  wasSettingsVisible: boolean;
  wasModelSelectorVisible: boolean;
  overlayBounds: Electron.Rectangle | null;
  overlayDisplayId: number | null;
  restoreWithoutFocus: boolean;
}

// Premium: módulos de conhecimento carregados condicionalmente
let KnowledgeOrchestratorClass: any = null;
let KnowledgeDatabaseManagerClass: any = null;
// Fase 1: detector compartilhado de evidências de composição para roteamento de intenção baseado em transcrição.
let textHasCompEvidence: ((text: string) => boolean) | null = null;
try {
    KnowledgeOrchestratorClass = require('../premium/electron/knowledge/KnowledgeOrchestrator').KnowledgeOrchestrator;
    KnowledgeDatabaseManagerClass = require('../premium/electron/knowledge/KnowledgeDatabaseManager').KnowledgeDatabaseManager;
    textHasCompEvidence = require('../premium/electron/knowledge/NegotiationConversationTracker').textHasCompEvidence;
} catch {
    console.log('[Main] Knowledge modules not available — profile intelligence disabled.');
}

import { CredentialsManager } from "./services/CredentialsManager"
import { SettingsManager } from "./services/SettingsManager"
import { PhoneMirrorService } from "./services/PhoneMirrorService"
import { setVerboseLoggingFlag } from "./verboseLog"
import { ReleaseNotesManager } from "./update/ReleaseNotesManager"
import { OllamaManager } from './services/OllamaManager'
import { decideToggle, decideDockTransition } from './services/toggleStateReducer'

/**
 * ============================================================
 * CLASSE AppState — O GERENCIADOR CENTRAL DO APLICATIVO
 * ============================================================
 * 
 * Esta classe é o CORE de todo o aplicativo. Ela implementa o padrão Singleton
 * (apenas uma instância existe) e gerencia:
 * 
 * 1. JANELAS: Launcher (principal) + Overlay (sobreposição transparente)
 * 2. ÁUDIO: Captura do áudio do sistema (entrevistador) + microfone (usuário)
 * 3. STT: Conversão de áudio em texto em tempo real via vários provedores
 * 4. INTELIGÊNCIA: Roteamento de perguntas para LLMs e geração de respostas
 * 5. REUNIÕES: Ciclo completo — iniciar → transcrever → salvar → buscar
 * 6. RAG: Indexação semântica de reuniões anteriores para busca
 * 7. ATUALIZAÇÕES: Sistema de auto-update via GitHub releases
 * 8. TEMA: Suporte a modo claro/escuro/sistema
 * 
 * ESTADO INTERNO IMPORTANTE:
 * - isMeetingActive: Se uma reunião está em andamento
 * - _isDraining: Se o STT está drenando finais pendentes ao parar
 * - _endMeetingInFlight: Proteção contra duplo-clique em "Parar"
 * - _pendingTeardown: Desmontagem em andamento (evita race conditions)
 * - isUndetectable: Modo "invisível" — esconde de capturas de tela
 * 
 * PADRÕES DE DESIGN UTILIZADOS:
 * - Singleton: AppState.getInstance()
 * - Observer: EventEmitter para eventos entre componentes
 * - Facade: IntelligenceManager esconde complexidade dos submódulos
 * - Circuit Breaker: ProviderRouter previne cascata de falhas
 */
export class AppState {
  private static instance: AppState | null = null // Instância Singleton

  // --- GERENCIAMENTO DE JANELAS ---
  private windowHelper: WindowHelper               // Janelas Launcher + Overlay
  public settingsWindowHelper: SettingsWindowHelper // Janela de configurações
  public modelSelectorWindowHelper: ModelSelectorWindowHelper // Seletor de modelo LLM
  public cropperWindowHelper: CropperWindowHelper   // Ferramenta de recorte de tela
  private screenshotHelper: ScreenshotHelper         // Captura de tela
  public processingHelper: ProcessingHelper          // Processamento via LLM

  // --- GERENCIAMENTO DE INTELIGÊNCIA ---
  private intelligenceManager: IntelligenceManager  // Orquestrador de IA (facade)
  private themeManager: ThemeManager                 // Temas claro/escuro
  private ragManager: RAGManager | null = null       // Retrieval Augmented Generation
  private knowledgeOrchestrator: any = null          // Orquestrador de conhecimento (premium)
  
  // --- TRAY E ATUALIZAÇÕES ---
  private tray: Tray | null = null                   // Ícone na bandeja do sistema
  private updateAvailable: boolean = false           // Se há atualização disponível
  private updateDownloadState: 'idle' | 'available' | 'downloading' | 'downloaded' = 'idle'
  private updateDownloadPromise: Promise<unknown> | null = null
  private downloadedUpdateInfo: any = null
  
  // --- MODO DISFARCE ---
  private disguiseMode: 'terminal' | 'settings' | 'activity' | 'none' = 'none'
  // O modo disfarce faz o app parecer um terminal/editor/outro app para quem olha sua tela

  // --- ESTADO DE VISUALIZAÇÃO ---
  private view: "queue" | "solutions" = "queue"  // Fila de screenshots ou soluções
  private isUndetectable: boolean = false          // Modo indetectável (esconde de screen recording)
  
  // --- INFORMAÇÕES DO PROBLEMA ---
  private problemInfo: {
    problem_statement: string
    input_format: Record<string, any>
    output_format: Record<string, any>
    constraints: Array<Record<string, any>>
    test_cases: Array<Record<string, any>>
  } | null = null // Informações do problema de programação extraído da screenshot

  // --- ESTADO DA REUNIÃO ---
  // O ciclo de vida de uma reunião é: Iniciar → Transcrever → Parar → Salvar
  private hasDebugged: boolean = false
  private isMeetingActive: boolean = false  // Se uma reunião está em andamento
  
  /**
   * Geração da reunião — incrementada a cada startMeeting/endMeeting.
   * Usada para que callbacks assíncronos antigos não afetem a reunião atual.
   * Ex: se o usuário iniciar, parar e iniciar rapidamente, callbacks da primeira
   * reunião são descartados porque a geração mudou.
   */
  private _meetingGeneration = 0;
  
  /**
   * PROMESSA DE INICIALIZAÇÃO DE ÁUDIO:
   * Uma única promessa que串烧 toda a cadeia de inicialização de áudio.
   * endMeeting() aguarda isso antes de desmontar para evitar race conditions.
   * Se o áudio ainda está inicializando quando o usuário clica "Parar",
   * a desmontagem espera a inicialização terminar.
   */
  private _audioInitPromise: Promise<void> | null = null;
  
  /**
   * AbortController para cancelar a inicialização de áudio em andamento.
   * Se endMeeting() é chamado enquanto startMeeting() ainda está configurando
   * áudio, o AbortController cancela as verificações isCurrentMeeting()
   * e permite que a desmontagem prosiga normalmente.
   */
  private _audioInitController: AbortController | null = null;
  
  /**
   * Proteção contra re-entrada em endMeeting():
   * Define como true antes do await inicial, impedindo que um segundo
   * clique em "Parar" execute a desmontagem duas vezes.
   * SEM ESSA PROTEÇÃO: finais pendentes do STT seriam truncados.
   */
  private _endMeetingInFlight = false;
  
  /**
   * _isDraining: Verdadeiro entre o clique em "Parar" e o término do esvaziamento do STT.
   * O manipulador de transcrição usa "isMeetingActive || _isDraining" para aceitar
   * finais pendentes. Todos os outros locais verificam apenas isMeetingActive,
   * que muda para false imediatamente ao Parar.
   */
  private _isDraining: boolean = false;
  
  /**
   * ID do dispositivo de saída de áudio da última configuração.
   * Permite que reconfigureAudio seja inativo quando nada mudou.
   */
  private _lastRequestedOutputDeviceId: string | undefined = undefined;
  
  /**
   * Desmontagem em background do endMeeting em andamento.
   * startMeeting() aguarda isso antes de iniciar nova sessão para que
   * instâncias compartilhadas de STT não sejam desmontadas no meio
   * da reunião por uma tarefa de desmontagem obsoleta.
   */
  private _pendingTeardown: Promise<void> | null = null;
  
  /**
   * IDs de reunião sendo processados pelo RAG.
   * SEM ESSA PROTEÇÃO: um ciclo rápido parar→iniciar→parar poderia
   * enfileirar a mesma reunião para o RAG duas vezes, duplicando
   * trabalho de embedding e aumentando latência.
   */
  private _ragProcessingInFlight: Set<string> = new Set();
  
  private _isQuitting: boolean = false;       // Se o app está fechando
  private _verboseLogging: boolean = false;    // Logging detalhado (depuração)
  
  /**
   * Taxa de amostragem do STT já aplicada.
   * Reinicia em cada reconfigureAudio para que o próximo manipulador
   * de primeiro chunk leia a taxa nativa recém-detectada.
   */
  private _sysSttRateApplied: boolean = false;
  private _micSttRateApplied: boolean = false;
  
  /**
   * Throttle (limitação de taxa) por falante para transcrições parciais.
   * Finais são enviados imediatamente; parciais se consolidam no "último
   * vencedor" dentro de 100ms. Isso evita que um STT rápido inundre
   * as janelas com IPC quase por token durante reuniões longas.
   * Achado de auditoria #7.
   */
  private static readonly PARTIAL_TRANSCRIPT_THROTTLE_MS = 100;
  private _transcriptPartialThrottle = new Map<string, {
    timer: ReturnType<typeof setTimeout> | null;
    pending: { speaker: string; text: string; timestamp: number; final: boolean; confidence: number } | null;
  }>();
  private _disguiseTimers: NodeJS.Timeout[] = []; // Rastrear timeouts de forceUpdate
  private _dockDebounceTimer: NodeJS.Timeout | null = null; // Debounce de mudanças de estado do dock
  private _dockReassertTimers: NodeJS.Timeout[] = []; // Temporizadores de auto-verificação de imposição do dock
  private _ollamaBootstrapPromise: Promise<void> | null = null;
  private screenshotCaptureInProgress: boolean = false;

  /**
   * Canais IPC registrados via ipcMain.handle() no construtor.
   * Usado pelo cleanup() para removê-los ao encerrar o app.
   */
  private _registeredHandlerChannels: string[] = [];


  // Processing events
  public readonly PROCESSING_EVENTS = {
    //estados globais
    UNAUTHORIZED: "processing-unauthorized",
    NO_SCREENSHOTS: "processing-no-screenshots",

    //estados para gerar a solução inicial
    INITIAL_START: "initial-start",
    PROBLEM_EXTRACTED: "problem-extracted",
    SOLUTION_SUCCESS: "solution-success",
    INITIAL_SOLUTION_ERROR: "solution-error",

    //estados para processar a depuração
    DEBUG_START: "debug-start",
    DEBUG_SUCCESS: "debug-success",
    DEBUG_ERROR: "debug-error"
  } as const

  constructor() {
    // 1. Carrega configurações críticas de inicialização primeiro (usado pelos WindowHelpers)
    const settingsManager = SettingsManager.getInstance();
    this.isUndetectable = settingsManager.get('isUndetectable') ?? false;
    this.disguiseMode = settingsManager.get('disguiseMode') ?? 'none';
    this._verboseLogging = settingsManager.get('verboseLogging') ?? false;
    setVerboseLoggingFlag(this._verboseLogging);
    console.log(`[AppState] Initialized with isUndetectable=${this.isUndetectable}, disguiseMode=${this.disguiseMode}, verboseLogging=${this._verboseLogging}`);

    // 2. Inicializar helpers com estado carregado
    this.windowHelper = new WindowHelper(this)
    this.settingsWindowHelper = new SettingsWindowHelper()
    this.modelSelectorWindowHelper = new ModelSelectorWindowHelper()
    this.cropperWindowHelper = new CropperWindowHelper()

    // 3. Inicializar outros helpers
    this.screenshotHelper = new ScreenshotHelper(this.view)
    this.processingHelper = new ProcessingHelper(this)

    this.windowHelper.setContentProtection(this.isUndetectable);
    this.settingsWindowHelper.setContentProtection(this.isUndetectable);
    this.modelSelectorWindowHelper.setContentProtection(this.isUndetectable);
    this.cropperWindowHelper.setContentProtection(this.isUndetectable);

    if (process.platform === 'win32' || process.platform === 'darwin') {
      this.cropperWindowHelper.preload();
    }

    // Aquecer o worker local do Whisper em segundo plano para que a primeira sessão de
    // gravação inicie instantaneamente em vez de esperar o modelo ser carregado do disco.
    // Dispara apenas se local-whisper estiver selecionado E o modelo já estiver em cache.
    setImmediate(() => {
      try {
        const { CredentialsManager } = require('./services/CredentialsManager');
        if (CredentialsManager.getInstance().getSttProvider() === 'local-whisper') {
          const { isModelCached } = require('./audio/whisper/modelManager');
          const { modelPreloader } = require('./audio/whisper/modelPreloader');
          const { resolveInferenceConfig } = require('./audio/whisper/inferenceConfig');
          const modelId = settingsManager.get('localWhisperModel') ?? 'Xenova/whisper-tiny.en';
          const { dtype } = resolveInferenceConfig();
          if (isModelCached(modelId, dtype)) {
            console.log(`[AppState] Preloading local Whisper model: ${modelId}`);
            modelPreloader.preload(modelId);
          }
        }
      } catch (e) {
        // Não fatal — a gravação ainda funciona, apenas com atraso na inicialização fria
        console.warn('[AppState] Local Whisper preload skipped:', e);
      }
    });

    // Inicializa KeybindManager
    const keybindManager = KeybindManager.getInstance();
    keybindManager.setWindowHelper(this.windowHelper);
    keybindManager.setupIpcHandlers();
    keybindManager.onUpdate(() => {
      this.updateTrayMenu();
    });

    // IPC de toque de teclado oculto (CGEventTap). O renderer conduz o fluxo
    // de permissão + consulta disponibilidade/estado; o próprio toque é alternado
    // pelo manipulador de atalho global acima. Registrado apenas não macOS — em outras
    // plataformas esses manipuladores são inoperantes para que o renderer possa exibir UI alternativa.
    //
    // removeHandler-then-handle em cada canal é defensivo contra uma
    // segunda ativação do app.ready (raro, mas possível durante HMR não desenvolvimento / segundo
    // lançamento em instância única — o `ipcMain.handle` lança erro em registro
    // duplicado, que se propagaria como rejeição IPC do renderer e
    // silenciosamente deixaria isCgEventTapAvailableRef não padrão seguro-falso.
    const registerStealthHandler = (channel: IpcInvokeChannel, fn: (...args: any[]) => any) => {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, fn);
      this._registeredHandlerChannels.push(channel);
    };
    registerStealthHandler('get-system-audio-permission-warning', () => latestSystemAudioPermissionWarning);
    if (process.platform === 'darwin') {
      const { StealthKeyboardManager } = require('./services/StealthKeyboardManager');
      const stealth = StealthKeyboardManager.getInstance();
      registerStealthHandler('stealth-tap:available', () => stealth.isAvailable());
      registerStealthHandler('stealth-tap:open-settings', () => { stealth.openSettings(); });
      registerStealthHandler('stealth-tap:stop', () => { stealth.stop(); });
      registerStealthHandler('stealth-tap:start', () => stealth.start());
      // Usuários de IME (Pinyin, Hangul, Kanji, ...) não podem compor sob o toque
      // porque o CGEventTap dispara abaixo do TIS. O renderer consulta isso antes
      // de ativar por clique para que possa recorrer ao foco DOM simples quando um IME
      // estiver em uso. Veja electron/services/ImeDetector.ts para a justificativa.
      registerStealthHandler('stealth-tap:should-auto-engage', () => {
        const { shouldAutoEngageStealthTap } = require('./services/ImeDetector');
        return shouldAutoEngageStealthTap();
      });
      // Forçar uma nova verificação de IME e retornar o valor refinado. O renderer chama
      // isso não foco da janela para que os usuários que adicionaram a fonte Pinyin/Hangul não meio
      // da sessão não quebrem silenciosamente a composição CJK na próxima vez que o toque
      // se ativar automaticamente (o valor em cache do momento da montagem estaria desatualizado).
      registerStealthHandler('stealth-tap:refresh-ime', () => {
        const { refreshImeDetection, shouldAutoEngageStealthTap } = require('./services/ImeDetector');
        refreshImeDetection();
        return shouldAutoEngageStealthTap();
      });
    } else {
      registerStealthHandler('stealth-tap:available', () => false);
      registerStealthHandler('stealth-tap:open-settings', () => {});
      registerStealthHandler('stealth-tap:stop', () => {});
      registerStealthHandler('stealth-tap:start', () => false);
      // Não-darwin: Retornar verdadeiro para que o stealthAutoEngageOkRef do renderer
      // permaneça verdadeiro e a proteção explícita isCgEventTapAvailableRef (adicionada no
      // PR #250) seja o que realmente controla blockInputFocus. Invertido em relação
      // à disponibilidade de propósito — veja ImeDetector.ts:67.
      registerStealthHandler('stealth-tap:should-auto-engage', () => true);
      registerStealthHandler('stealth-tap:refresh-ime', () => true);
    }

    keybindManager.onShortcutTriggered(async (actionId) => {
      console.log(`[Main] Global shortcut triggered: ${actionId}`);
      try {
        if (actionId === 'general:toggle-visibility') {
          this.toggleMainWindow();
        } else if (actionId === 'general:toggle-mouse-passthrough') {
          // Adaptado do PR público #113 — verifica interação premium
          this.toggleOverlayMousePassthrough();
        } else if (actionId === 'general:take-screenshot') {
          // Roteia para o renderer via atalho global para que o renderer gerencie a
          // captura de tela através do caminho IPC invocar (garantia de solicitação/resposta).
          // O padrão antigo — processo principal captura tela → dispara evento screenshot-taken →
          // ouvinte do renderer captura — era não confiável não modo overlay porque o
          // evento fire-and-forget poderia ser perdido se houvesse qualquer
          // diferença de temporização não registro do listener. O caminho invoke
          // usado por generalHandlers.takeScreenshot() já foi comprovado
          // funcional para capturas de tela com botão de UI; reutilizá-lo aqui.
          const mainWindow = this.getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('global-shortcut', { action: 'takeScreenshot' });
          }
        } else if (actionId === 'general:selective-screenshot') {
          const mainWindow = this.getMainWindow();
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('global-shortcut', { action: 'selectiveScreenshot' });
          }
        } else if (actionId === 'general:capture-and-process') {
          // Disparo único: capturar tela atual e então imediatamente solicitar análise de IA
          await this.captureScreenAndProcess();

        } else if (actionId === 'general:capture-dom') {
          // Um atalho, a captura correta: se a extensão complementar do navegador
          // estiver conectada, solicitar que ela pegue o contexto da página da aba ativa (entregue
          // ao overlay via /dom). Se não estiver acessível — não não navegador, service worker
          // adormecido, Espelho do Telefone desligado — recorrer a uma captura de tela automaticamente para que
          // o gesto sempre funcione. Veja refract-browser/README.md.
          let captured = false;
          try {
            const svc = PhoneMirrorService.getInstance();
            // Correção de condição de corrida MV3: o service worker da extensão pode ter sido encerrado por inatividade
            // e estar apenas reconectando (seus manipuladores de ativação por interação disparam quando
            // o usuário toca não navegador antes da captura). Aguardar brevemente para
            // que a extensão se conecte antes de decidir — caso contrário, o SW recém-ativado
            // iria cair diretamente na captura de tela. waitForExtension resolve
            // imediatamente quando uma já estiver conectada.
            const extReady = svc.isRunning() && (await svc.waitForExtension());
            if (extReady) {
              const result = await svc.requestDomCapture();
              captured = result.ok;
              if (captured) {
                // A extensão apenas confirma `done` após /dom retornar 200, então aqui
                // o overlay já recebeu o contexto da página (exibe a
                // pílula "Contexto da página" e o utiliza na próxima resposta).
                console.log('[Main] DOM capture delivered to overlay');
              } else {
                console.log('[Main] DOM capture unavailable (', result.reason, ') — falling back to screenshot');
              }
            }
          } catch (e: any) {
            console.warn('[Main] DOM capture error — falling back to screenshot:', e?.message || e);
          }
          if (!captured) {
            await this.captureScreenAndProcess();
          }

        // --- ATALHOS OCULTOS: não focar, não mostrar, apenas despachar IPC ---

        // Ações de chat — disparar dentro do renderer sem focar a janela
        } else if (actionId === 'chat:focusInput') {
          // Alternar modo de digitação oculta com suporte CGEventTap. Enquanto ativado, cada
          // tecla é capturada na camada de eventos do SO e roteada para
          // o renderer; o aplicativo em primeiro plano (Zoom/navegador/etc.) não
          // recebe eventos de tecla e nunca perde status de tecla/principal. Este
          // é o único caminho que entrega indetectabilidade real de nível Refract
          // não macOS — NSPanel-nonactivating nos obtém 90%, o toque fecha
          // a lacuna restante (o painel nunca chega a se tornar janela-chave).
          //
          // Recorrer a panel.focus() simples se o toque nativo não estiver disponível
          // (ainda não reconstruído, sem permissão de acessibilidade ou em não-macOS).
          this.showMainWindow(true);
          const overlay = this.windowHelper.getOverlayWindow();
          if (overlay && !overlay.isDestroyed()) {
            overlay.webContents.send('ensure-expanded');
          }

          if (process.platform === 'darwin') {
            const { StealthKeyboardManager } = require('./services/StealthKeyboardManager');
            const mgr = StealthKeyboardManager.getInstance();
            if (mgr.isAvailable()) {
              mgr.toggle();
              return; // o toque é o caminho de entrada, não precisa focar o painel
            }
          }

          // Fallback: foco seguro não painel em macOS sem toque, foco breve não Windows.
          if (overlay && !overlay.isDestroyed()) {
            overlay.webContents.send('global-shortcut', { action: 'focusInput' });
            overlay.focus();
          }
        } else if (
          actionId === 'chat:whatToAnswer' ||
          actionId === 'chat:clarify' ||
          actionId === 'chat:followUp' ||
          actionId === 'chat:answer' ||
          actionId === 'chat:codeHint' ||
          actionId === 'chat:brainstorm' ||
          actionId === 'chat:dynamicAction4' ||
          actionId === 'chat:scrollUp' ||
          actionId === 'chat:scrollDown' ||
          actionId === 'chat:scrollLeft' ||
          actionId === 'chat:scrollRight'
        ) {
          const actionMap: Record<string, string> = {
            'chat:whatToAnswer': 'whatToAnswer',
            'chat:clarify': 'clarify',
            'chat:followUp': 'followUp',
            'chat:answer': 'answer',
            'chat:codeHint': 'codeHint',
            'chat:brainstorm': 'brainstorm',
            'chat:dynamicAction4': 'dynamicAction4',
            'chat:scrollUp': 'scrollUp',
            'chat:scrollDown': 'scrollDown',
            'chat:scrollLeft': 'scrollLeft',
            'chat:scrollRight': 'scrollRight',
          };
          const action = actionMap[actionId];
          this.sendToMeetingSurfaces('global-shortcut', { action });

        } else if (actionId === 'chat:languageLearning') {
          this.windowHelper.toggleLanguageLearningOverlay();

        } else if (actionId === 'chat:replica') {
          this.windowHelper.toggleReplicaOverlay();

        // Movimento de janela — mover posição da janela sem alterar foco
        } else if (actionId === 'window:move-up') {
          this.windowHelper.moveWindowUp();
        } else if (actionId === 'window:move-down') {
          this.windowHelper.moveWindowDown();
        } else if (actionId === 'window:move-left') {
          this.windowHelper.moveWindowLeft();
        } else if (actionId === 'window:move-right') {
          this.windowHelper.moveWindowRight();

        // Ações gerais que agora são globais (oculto)
        } else if (actionId === 'general:process-screenshots') {
          this.sendToMeetingSurfaces('global-shortcut', { action: 'processScreenshots' });
        } else if (actionId === 'general:reset-cancel') {
          this.sendToMeetingSurfaces('global-shortcut', { action: 'resetCancel' });
        }
      } catch (e: any) {
        if (e.message !== "Selection cancelled" && e.message !== "Screenshot capture already in progress") {
          console.error(`[Main] Error handling global shortcut ${actionId}:`, e);
        }
      }
    });

    // Injetar WindowHelper dentro de outro helpers
    this.settingsWindowHelper.setWindowHelper(this.windowHelper);
    this.modelSelectorWindowHelper.setWindowHelper(this.windowHelper);





    // Inicializa IntelligenceManager com LLMHelper
    this.intelligenceManager = new IntelligenceManager(this.processingHelper.getLLMHelper())

    // Inicializa ThemeManager
    this.themeManager = ThemeManager.getInstance()

    // Restaurar alternar estados que ficam na memória do LLMHelper.
    // Isso precisa acontecer aqui — não dentro de initializeRAGManager() — para que
    // executar incondicionalmente independentemente de os módulos premium estarem disponíveis.
    // Anteriormente a restauração do groqFastTextMode estava dentro do KnowledgeOrchestrator
    // que silenciosamente pula quando os módulos premium estão ausentes.
    {
      const llmHelper = this.processingHelper.getLLMHelper();
      if (settingsManager.get('groqFastTextMode')) {
        llmHelper.setGroqFastTextMode(true);
        console.log('[AppState] Fast mode restored from settings');
      }
      llmHelper.setCodexCliConfig({
        enabled: !!settingsManager.get('codexCliEnabled'),
        path: settingsManager.get('codexCliPath') || 'codex',
        model: settingsManager.get('codexCliModel') || 'gpt-5.4',
        fastModel: settingsManager.get('codexCliFastModel') || 'gpt-5.3-codex-spark',
        timeoutMs: settingsManager.get('codexCliTimeoutMs') || 60_000,
        sandboxMode: settingsManager.get('codexCliSandboxMode') || 'read-only',
        serviceTier: settingsManager.get('codexCliServiceTier') || 'default',
        modelReasoningEffort: settingsManager.get('codexCliModelReasoningEffort'),
      });
      // Restaurar notas personalizadas e persona para o caminho não-premium
      try {
        const savedNotes = DatabaseManager.getInstance().getCustomNotes();
        if (savedNotes) {
          llmHelper.setCustomNotes(savedNotes);
        }
        const savedPersona = DatabaseManager.getInstance().getPersona();
        if (savedPersona) {
          llmHelper.setPersonaPrompt(savedPersona);
        }
      } catch (_) {}
    }

    // Inicializar RAGManager (exige banco de dados estar pronto)
    this.initializeRAGManager()

    // Verificar e preparar modelo de embedding Ollama
    this.bootstrapOllamaEmbeddings()

    // Preparar o cache de saúde opcional do servidor de memória de longo prazo do Hindsight (configurações/ambiente;
    // sem operação quando não configurado). Disparar e esquecer — nunca bloqueia a inicialização.
    try {
      const { HindsightManager } = require('./services/HindsightManager');
      HindsightManager.getInstance().start().catch(() => { /* nunca bloqueia a inicialização */ });
    } catch { /* opcional */ }

    this.setupIntelligenceEvents()

    // O aquecimento do classificador de intenção é agendado após o launcher ficar visível para que
    // a inicialização do transformers/ONNX não compita com a primeira renderização.

    // Configura Ollama IPC
    this.setupOllamaIpcHandlers()

    // --- NOVO PIPELINE DE ÁUDIO DO SISTEMA (SOX + Nó GOOGLE STT) ---
    // INICIALIZAÇÃO PREGUIÇOSA: Não configurar o pipeline aqui para prevenir surto de volume na inicialização.
    // this.setupSystemAudioPipeline()

    // Inicializa Auto-Updater
    this.setupAutoUpdater()
  }

  private sendToWindow(win: BrowserWindow | null | undefined, channel: string, ...args: any[]): boolean {
    if (!win || win.isDestroyed()) return false;
    try {
      win.webContents.send(channel, ...args);
      return true;
    } catch {
      return false;
    }
  }

  private sendToMeetingSurfaces(channel: string, ...args: any[]): void {
    const sent = new Set<number>();
    const sendOnce = (win: BrowserWindow | null | undefined) => {
      if (!win || sent.has(win.id)) return;
      if (this.sendToWindow(win, channel, ...args)) sent.add(win.id);
    };
    sendOnce(this.windowHelper.getLauncherWindow());
    sendOnce(this.windowHelper.getOverlayWindow());
  }

  private sendToSettingsSurfaces(channel: string, ...args: any[]): void {
    const sent = new Set<number>();
    const sendOnce = (win: BrowserWindow | null | undefined) => {
      if (!win || sent.has(win.id)) return;
      if (this.sendToWindow(win, channel, ...args)) sent.add(win.id);
    };
    sendOnce(this.settingsWindowHelper.getSettingsWindow());
    sendOnce(this.windowHelper.getLauncherWindow());
  }

  /** Enviar payload de transcrição para a barra de transcrição rolante do launcher + overlay. */
  private emitTranscriptToSurfaces(payload: { speaker: string; text: string; timestamp: number; final: boolean; confidence: number }): void {
    const helper = this.getWindowHelper();
    helper.getLauncherWindow()?.webContents.send('native-audio-transcript', payload);
    helper.getOverlayWindow()?.webContents.send('native-audio-transcript', payload);
  }

  /**
   * IPC de transcrição apenas para exibição com limitação parcial (achado de auditoria #7).
   * Finais liberam qualquer parcial pendente e enviam imediatamente (preservando a ordem);
   * parciais se consolidam não último vencedor dentro de PARTIAL_TRANSCRIPT_THROTTLE_MS para que um
   * STT loquaz não gere IPC quase por token para duas janelas. Chaveado por
   * falante para que os canais de entrevistador + usuário sejam limitados independentemente.
   */
  private sendThrottledTranscript(payload: { speaker: string; text: string; timestamp: number; final: boolean; confidence: number }): void {
    const key = payload.speaker;
    let state = this._transcriptPartialThrottle.get(key);
    if (!state) {
      state = { timer: null, pending: null };
      this._transcriptPartialThrottle.set(key, state);
    }

    if (payload.final) {
      // Cancelar qualquer parcial pendente — o final a substitui — e enviar agora
      if (state.timer) { clearTimeout(state.timer); state.timer = null; }
      state.pending = null;
      this.emitTranscriptToSurfaces(payload);
      return;
    }

    // Parcial: memorizar o mais recente e garantir que uma liberação esteja agendada.
    state.pending = payload;
    if (state.timer) return; // a liberação já está pendente; último vencedor
    state.timer = setTimeout(() => {
      const s = this._transcriptPartialThrottle.get(key);
      if (!s) return;
      s.timer = null;
      const p = s.pending;
      s.pending = null;
      if (p) this.emitTranscriptToSurfaces(p);
    }, AppState.PARTIAL_TRANSCRIPT_THROTTLE_MS);
  }

  /** Liberar quaisquer parciais limitadas pendentes + temporizadores (chamado na desmontagem da reunião). */
  private clearTranscriptThrottle(): void {
    for (const state of this._transcriptPartialThrottle.values()) {
      if (state.timer) { clearTimeout(state.timer); state.timer = null; }
      state.pending = null;
    }
    this._transcriptPartialThrottle.clear();
  }

  private sendSttStatus(payload: any): void {
    this.sendToMeetingSurfaces('stt-status', payload);
  }

  // Público para que a verificação de permissão do startup do initializeApp (UX1) possa emitir o
  // banner de forma simétrica com sendSystemAudioPermissionDenied. Outros locais de chamada
  // na classe não são afetados.
  public sendAudioCaptureFailed(payload: any): void {
    this.sendToMeetingSurfaces('audio-capture-failed', payload);
  }

  public sendSystemAudioPermissionDenied(message: string): void {
    this.sendToMeetingSurfaces('system-audio-permission-denied', message);
  }

  public broadcast(channel: string, ...args: any[]): void {
    BrowserWindow.getAllWindows().forEach(win => {
      this.sendToWindow(win, channel, ...args);
    });
  }

  public getIsMeetingActive(): boolean {
    return this.isMeetingActive;
  }

  public isQuitting(): boolean {
    return this._isQuitting;
  }

  public setQuitting(value: boolean): void {
    this._isQuitting = value;
  }

  private broadcastMeetingState(): void {
    this.broadcast('meeting-state-changed', { isActive: this.isMeetingActive });
  }

  private async bootstrapOllamaEmbeddings() {
    this._ollamaBootstrapPromise = (async () => {
      try {
        const { OllamaBootstrap } = require('./rag/OllamaBootstrap');
        const bootstrap = new OllamaBootstrap();

        // Disparar e esquecer — não aguardar isso antes de mostrar a janela
        const result = await bootstrap.bootstrap('nomic-embed-text', (status: string, percent: number) => {
          // Envia progresso para o renderer via IPC
          this.broadcast('ollama:pull-progress', { status, percent });
        });

        if (result === 'pulled' || result === 'already_pulled') {
          this.broadcast('ollama:pull-complete');
          // Resolver novamente o provedor de embeddings dado que Ollama pode agora estar disponível
          if (this.ragManager) {
             console.log('[AppState] Ollama model ready, re-evaluating RAG pipeline provider');
             const { CredentialsManager } = require('./services/CredentialsManager');
             const cm = CredentialsManager.getInstance();
             this.ragManager.initializeEmbeddings({
                openaiKey: cm.getOpenaiApiKey() || process.env.OPENAI_API_KEY || undefined,
                geminiKey: cm.getGeminiApiKey() || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || undefined,
                ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434",
                providerDataScopes: (() => { try { const { SettingsManager } = require('./services/SettingsManager'); return SettingsManager.getInstance().get('providerDataScopes'); } catch { return undefined; } })()
             });
          }
        }
      } catch (err) {
         console.error('[AppState] Failed to bootstrap Ollama:', err);
      }
    })();
  }

  private initializeRAGManager(): void {
    try {
      const db = DatabaseManager.getInstance();
      const sqliteDb = db.getDb();

      if (sqliteDb) {
        const { CredentialsManager } = require('./services/CredentialsManager');
        const cm = CredentialsManager.getInstance();
        const openaiKey = cm.getOpenaiApiKey() || process.env.OPENAI_API_KEY;
        const geminiKey = cm.getGeminiApiKey() || process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

        const providerDataScopes = (() => { try { const { SettingsManager } = require('./services/SettingsManager'); return SettingsManager.getInstance().get('providerDataScopes'); } catch { return undefined; } })();
        this.ragManager = new RAGManager({
            db: sqliteDb,
            dbPath: db.getDbPath(),
            extPath: db.getExtPath(),
            openaiKey,
            geminiKey,
            ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
            providerDataScopes
        });
        this.ragManager.setLLMHelper(this.processingHelper.getLLMHelper());
        console.log('[AppState] RAGManager initialized');
      }
    } catch (error) {
      console.error('[AppState] Failed to initialize RAGManager:', error);
    }

    // Inicializa Knowledge Orchestrator
    try {
      const db = DatabaseManager.getInstance();
      const sqliteDb = db.getDb();

      if (sqliteDb && KnowledgeDatabaseManagerClass && KnowledgeOrchestratorClass) {
        const knowledgeDb = new KnowledgeDatabaseManagerClass(sqliteDb);
        this.knowledgeOrchestrator = new KnowledgeOrchestratorClass(knowledgeDb);

        // Conectar as funções LLM acima
        const llmHelper = this.processingHelper.getLLMHelper();

        // Função generateContent para chamadas LLM
        // Junta todas as partes de conteúdo (alguns chamadores — ex. coaching ao vivo —
        // passam [{text: systemPrefix}, {text: prompt}]; ler apenas [0] descartaria o
        // prompt). Chamadores de item único (extração, script) não são afetados.
        const joinContents = (contents: any[]) =>
          (Array.isArray(contents) ? contents : [contents])
            .map((c: any) => (typeof c === 'string' ? c : c?.text || ''))
            .filter(Boolean)
            .join('\n\n');
        this.knowledgeOrchestrator.setGenerateContentFn(async (contents: any[]) => {
          return await llmHelper.generateContentStructured(joinContents(contents));
        });

        // Geração de baixa latência para coaching de negociação ao vivo (falado em
        // tempo real): cadeia com prioridade para Flash então a nota tática aparece rápido. O script
        // AOT de negociação + extração de todos mantêm a fn de qualidade primeiro acima
        if (typeof this.knowledgeOrchestrator.setLiveCoachingContentFn === 'function') {
          this.knowledgeOrchestrator.setLiveCoachingContentFn(async (contents: any[]) => {
            return await llmHelper.generateContentStructured(joinContents(contents), { preferFast: true });
          });
        }

        // Função de embedding — delegar preguiçosamente para o EmbeddingPipeline em cascata
        // (OpenAI → Gemini → Ollama → modelo local embutido).
        // Aguardamos waitForReady() então uploads durante a inicialização esperam pelo pipeline
        // em vez de lançar imediatamente 'não pronto'.
        const self = this;
        this.knowledgeOrchestrator.setEmbedFn(async (text: string) => {
          const pipeline = self.ragManager?.getEmbeddingPipeline();
          if (!pipeline) throw new Error('RAG pipeline not available');
          await pipeline.waitForReady();
          return await pipeline.getEmbedding(text);
        });
        // Reportar o espaço composto do document-embedder ativo então o orchestrator
        // possa detectar nós de conhecimento incorporados em um espaço ANTIGO (ex. após a
        // atualização gemini-embedding-001 → -2 e re-incorporá-los, em vez de silenciosamente
        // comparar vetores de nós v1 contra vetores de consulta v2 (mesmas dimensões = não garantir
        if (typeof this.knowledgeOrchestrator.setActiveSpaceFn === 'function') {
          this.knowledgeOrchestrator.setActiveSpaceFn(() => {
            return self.ragManager?.getEmbeddingPipeline()?.getActiveSpaceKey();
          });
        }
        if (typeof this.knowledgeOrchestrator.setEmbedQueryFn === 'function') {
          this.knowledgeOrchestrator.setEmbedQueryFn(async (text: string) => {
            const pipeline = self.ragManager?.getEmbeddingPipeline();
            if (!pipeline) throw new Error('RAG pipeline not available');
            await pipeline.waitForReady();
            return await pipeline.getEmbeddingForQuery(text);
          });
        }
        // Consulta de embedding local rápida não caminho crítico de latência do conhecimento.
        // O orchestrator verifica as dimensões de `dimensions` contra o índice e
        // apenas usa `embed` (MiniLM embutido, ~10ms) quando compatível — caso contrário,
        // volta para a fn embedFn na nuvem acima para que a recuperação permaneça correta.
        if (typeof this.knowledgeOrchestrator.setFastQueryEmbedFn === 'function') {
          this.knowledgeOrchestrator.setFastQueryEmbedFn(() => {
            const pipeline = self.ragManager?.getEmbeddingPipeline();
            return {
              dimensions: pipeline?.localDimensions ?? null,
              // Espaço composto do embutor local — o orchestrator controla o
              // caminho rápido pela identidade do espaço (não apenas dimensões), então uma colisão
              // de mesma-dimensão mas espaço-diferente não pode silenciosamente produzir similaridade incorreta.
              space: pipeline?.localSpaceKey ?? null,
              embed: async (text: string) => {
                if (!pipeline) return null;
                // Aguardar prontidão então a primeira pergunta de sessão a frio ainda obtém o
                // caminho rápido local (o provedor de alternativa local é atribuído apenas
                // quando o pipeline finaliza a inicialização). Sem isso, muitos alvos
                // de pré-aquecimento cairiam silenciosamente não embutor na nuvem.
                // Ignorar erros — getEmbeddingForQueryLocalOnly retorna nulo em
                // qualquer falha e o orchestrator volta para embedFn.
                try { await pipeline.waitForReady(); } catch { /* cair através */ }
                return await pipeline.getEmbeddingForQueryLocalOnly(text);
              },
            };
          });
        }

        // Disparar a re-incorporação do conhecimento uma vez que o pipeline de embedding esteja pronto. CRÍTICO:
        // o construtor do orchestrator dispara refreshCache()→ensureEmbeddingSpace()
        // Antes que setActiveSpaceFn esteja conectado acima, então essa primeira passagem não faz nada (sem espaço
        // ativo ainda). Sem esse disparo explícito, a atualização do modelo v1→v2 deixaria os
        // nós de resumo/CV presos não espaço antigo — _spaceGatedNodes os excluiria
        // e a recuperação semântica retornaria silenciosamente nada até o usuário re-enviar.
        // Isso é o análogo do auto-cicatrizante do knowledge-base do RAGManager.scheduleAutoReindex.
        if (typeof this.knowledgeOrchestrator.ensureEmbeddingSpace === 'function') {
          const ko = this.knowledgeOrchestrator;
          (async () => {
            try {
              await self.ragManager?.getEmbeddingPipeline()?.waitForReady();
              await ko.ensureEmbeddingSpace();
            } catch (e: any) {
              console.warn('[main] Knowledge ensureEmbeddingSpace kick failed (non-fatal):', e?.message || e);
            }
          })();
        }

        // Fase 1: hint de intent ciente de transcrição. O orchestrator (premium) não tem
        // referência SessionTracker (pacote bolimite então o layer do app lê
        // a transcrição rolling ~180s aqui e devolve um veredicto leve.
        // Inspecionamos apenas as últimas 1-2 turns do ENTREVISTADOR para compor evidência — Não
        // toda a janela (isso causava topic-bleed) e Não a pergunta digitada pelo próprio
        // candidato (classificada separadamente). Barato + síncrono.
        if (typeof this.knowledgeOrchestrator.setConversationContextProvider === 'function') {
          this.knowledgeOrchestrator.setConversationContextProvider(() => {
            if (!textHasCompEvidence) return null;
            try {
              const items = self.intelligenceManager?.getContext(180) ?? [];
              const interviewerTurns = items.filter((i: any) => i.role === 'interviewer');
              const lastTwo = interviewerTurns.slice(-2);
              const lastInterviewerTurn = lastTwo.length ? lastTwo[lastTwo.length - 1].text : undefined;
              const recentInterviewerComp = lastTwo.some((i: any) => textHasCompEvidence!(i.text));
              return { recentInterviewerComp, lastInterviewerTurn };
            } catch {
              return null;
            }
          });
        }

        // Anexar KnowledgeOrchestrator ao LLMHelper
        llmHelper.setKnowledgeOrchestrator(this.knowledgeOrchestrator);

        // Restaurar estados de alternância persistidos então a UI reflete onde o usuário deixou.
        // NOTA: groqFastTextMode agora é restaurado incondicionalmente não construtor do AppState
        // então não é repetido aqui
        const sm = SettingsManager.getInstance();
        if (sm.get('knowledgeMode')) {
          this.knowledgeOrchestrator.setKnowledgeMode(true);
          console.log('[AppState] Knowledge mode restored from settings');
          // Pre-aquecer o cache de prompt do provedor fora do caminho quente então a primeira
          // pergunta da sessão não paga completo cold-prefill TTFT. Condicionado
          // ao modo de conhecimento ativo E um resumo presente (apenas então
          // a sessão provavelmente é iminente). Best-effort, não-bloqueante.
          if (this.knowledgeOrchestrator.isKnowledgeMode()) {
            llmHelper.prewarmPromptCache().catch((_e: any): void => {});
          }
        }

        // Restaurar notas customizadas então o orchestrator tenha na primeira requisição
        const savedNotes = DatabaseManager.getInstance().getCustomNotes();
        if (savedNotes) {
          this.knowledgeOrchestrator.setCustomNotes(savedNotes);
          llmHelper.setCustomNotes(savedNotes);
          console.log('[AppState] Custom notes restored');
        }

        // Restaurar prompt de persona então esteja ativo desde a primeira requisição (não apenas após a UI montar)
        try {
          const savedPersona = DatabaseManager.getInstance().getPersona();
          if (savedPersona) {
            llmHelper.setPersonaPrompt(savedPersona);
            console.log('[AppState] Persona prompt restored');
          }
        } catch (personaErr: any) {
          console.warn('[AppState] Persona restore failed, continuing without it:', personaErr?.message);
        }

        console.log('[AppState] KnowledgeOrchestrator initialized');
      }
    } catch (error) {
      console.error('[AppState] Failed to initialize KnowledgeOrchestrator:', error);
    }
  }

  private setupAutoUpdater(): void {
    // Manter downloads iniciados pelo usuário então o CTA "Atualizar Agora" do renderer seja a
    // única fonte de verdade. Construções assinadas/empacotadas podem ainda aplicar a atualização
    // baixada ao sair; construções não assinadas não macOS usam o fluxo manual do DMG do GitHub.
    const autoInstall = canAutoInstall()
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = autoInstall
    console.log(
      `[AutoUpdater] autoDownload=${autoUpdater.autoDownload} ` +
      `autoInstallOnAppQuit=${autoUpdater.autoInstallOnAppQuit} ` +
      `(canAutoInstall=${autoInstall}, signedBuild=${isSignedBuild()}, platform=${process.platform})`
    )

    // Padrão para o canal latest (estável) — corresponde ao latest.yml gerado pelo electron-builder
    autoUpdater.channel = 'latest'
    console.log(`[AutoUpdater] Channel: ${autoUpdater.channel}`)

    autoUpdater.on("checking-for-update", () => {
      console.log("[AutoUpdater] Checking for update...")
      this.broadcast("update-checking")
    })

    autoUpdater.on("update-available", async (info) => {
      console.log("[AutoUpdater] Update available:", info.version)
      this.updateAvailable = true
      this.updateDownloadState = 'available'
      this.downloadedUpdateInfo = null

      // Buscar release notes estruturadas
      const releaseManager = ReleaseNotesManager.getInstance();
      const notes = await releaseManager.fetchReleaseNotes(info.version);

      // Notificar renderer que uma atualização está disponível com notes analisadas, se disponíveis
      this.broadcast("update-available", {
        ...info,
        parsedNotes: notes
      })
    })

    autoUpdater.on("update-not-available", (info) => {
      console.log("[AutoUpdater] Update not available:", info.version)
      this.updateAvailable = false
      this.updateDownloadState = 'idle'
      this.downloadedUpdateInfo = null
      this.broadcast("update-not-available", info)
    })

    autoUpdater.on("error", (err) => {
      console.error("[AutoUpdater] Error:", err)
      this.updateDownloadState = this.updateAvailable ? 'available' : 'idle'
      this.updateDownloadPromise = null
      // Incluir mais detalhes na mensagem de erro para depuração
      const errorMessage = err.message || err.toString() || 'Unknown update error'
      this.broadcast("update-error", errorMessage)
    })

    autoUpdater.on("download-progress", (progressObj) => {
      let log_message = "Download speed: " + progressObj.bytesPerSecond
      log_message = log_message + " - Downloaded " + progressObj.percent + "%"
      log_message = log_message + " (" + progressObj.transferred + "/" + progressObj.total + ")"
      console.log("[AutoUpdater] " + log_message)
      this.broadcast("download-progress", progressObj)
    })

    autoUpdater.on("update-downloaded", (info) => {
      console.log("[AutoUpdater] Update downloaded:", info.version)
      this.updateDownloadState = 'downloaded'
      this.updateDownloadPromise = null
      // info.filePath é o caminho público do zip de atualização staged do Squirrel.Mac.
      // Usar isso em vez da API privada downloadedUpdateHelper.file (ver quitAndInstallUpdate).
      this.downloadedUpdateInfo = { ...info, updateFile: (info as any).filePath }
      this.broadcast("update-downloaded", this.downloadedUpdateInfo)
    })

    // Iniciar verificação de atualizações com 10 segundos de atraso
    setTimeout(() => {
      if (process.env.NODE_ENV === "development") {
        console.log("[AutoUpdater] Development mode: Skipping auto check (use manual button)");
      } else {
        autoUpdater.checkForUpdatesAndNotify().catch(err => {
          console.error("[AutoUpdater] Failed to check for updates:", err);
        });
      }
    }, 10000);
  }

  private async checkForUpdatesManual(): Promise<void> {
    try {
      console.log('[AutoUpdater] Checking for updates manually via GitHub API...');
      const releaseManager = ReleaseNotesManager.getInstance();
      // Buscar a última release
      const notes = await releaseManager.fetchReleaseNotes('latest');

      if (notes) {
        const currentVersion = app.getVersion();
        const latestVersionTag = notes.version; // ex., "v1.2.0" ou "1.2.0"
        const latestVersion = latestVersionTag.replace(/^v/, '');

        console.log(`[AutoUpdater] Manual Check: Current=${currentVersion}, Latest=${latestVersion}`);

        if (this.isVersionNewer(currentVersion, latestVersion)) {
          console.log('[AutoUpdater] Manual Check: New version found!');
          this.updateAvailable = true;
          this.updateDownloadState = 'available';
          this.downloadedUpdateInfo = null;

          // Mock um objeto info compatível com electron-updater
          const info = {
            version: latestVersion,
            files: [] as any[],
            path: '',
            sha512: '',
            releaseName: notes.summary,
            releaseNotes: notes.fullBody
          };

          // Notificar renderer
          this.broadcast("update-available", {
            ...info,
            parsedNotes: notes
          });
        } else {
          console.log('[AutoUpdater] Manual Check: App is up to date.');
          this.updateAvailable = false;
          this.updateDownloadState = 'idle';
          this.downloadedUpdateInfo = null;
          this.broadcast("update-not-available", { version: currentVersion });
        }
      }
    } catch (err) {
      console.error('[AutoUpdater] Manual update check failed:', err);
    }
  }

  private isVersionNewer(current: string, latest: string): boolean {
    // EC-01 fix: remover sufixos pre-release (ex. "2.1.0-beta.1" → "2.1.0")
    // antes de dividir então Número nunca retorna NaN na comparação.
    const stripPre = (v: string) => v.replace(/-.*$/, '');
    const c = stripPre(current).split('.').map(Number);
    const l = stripPre(latest).split('.').map(Number);

    for (let i = 0; i < 3; i++) {
      const cv = c[i] || 0;
      const lv = l[i] || 0;
      if (lv > cv) return true;
      if (lv < cv) return false;
    }
    return false;
  }


  public async quitAndInstallUpdate(): Promise<void> {
    console.log('[AutoUpdater] quitAndInstall called - applying update...')

    // Instalação in-place real + relançamento. Disponível em construções assinadas do macOS e em
    // todas as construções empacotadas do Windows/Linux (ver canAutoInstall()). O Squirrel.Mac vai
    // descompactar o ZIP staged, trocar o .app, e relançar.
    if (canAutoInstall()) {
      console.log('[AutoUpdater] Performing real quitAndInstall (signed/auto-installable build)')
      setImmediate(() => {
        try {
          // isSilent=false (mostrar interface do instalador não Windows), forceRunAfter=true (relançar).
          autoUpdater.quitAndInstall(false, true)
        } catch (err) {
          console.error('[AutoUpdater] quitAndInstall failed:', err)
          app.exit(0)
        }
      })
      return
    }

    // FALLBACK (macOS não assinado / construção não-instalável onde não podemos trocar+relançar em
    // local, então abrir a pasta com a atualização baixada e sair então o usuário
    // possa instalar manualmente.
    if (process.platform === 'darwin') {
      try {
        // Preferir o info.filePath público do evento update-downloaded quando
        // disponível. Recorrer à API privada apenas se por algum motivo o caminho do
        // evento estiver ausente (não deveria acontecer para uma construção empacotada
        const updateFile =
          (autoUpdater as any).downloadedUpdateHelper?.file ??
          (autoUpdater as any).updateInfo?.filePath ??
          undefined
        console.log('[AutoUpdater] Downloaded update file:', updateFile)

        if (updateFile) {
          const updateDir = path.dirname(updateFile)
          // Abrir o diretório contendo a atualização não Finder
          await shell.openPath(updateDir)
          console.log('[AutoUpdater] Opened update directory:', updateDir)

          // Sair do app então o usuário possa instalar a nova versão
          setTimeout(() => app.quit(), 1000)
          return
        }
      } catch (err) {
        console.error('[AutoUpdater] Failed to open update directory:', err)
      }

      // openPath falhou ou updateFile estava ausente — apenas sair então o usuário possa
      // encontrar manualmente o zip staged em ~/Library/Caches/electron-update/…
      // ou re-baixar das releases do GitHub. Nunca chamar quitAndInstall em uma
      // construção macOS não assinada — o Squirrel.Mac vai falhar silenciosamente.
      setTimeout(() => app.quit(), 1000)
      return
    }

    // Último recurso: Windows/Linux — quitAndInstall funciona lá sem a
    // assinatura Developer ID porque NSIS/Squirrel gerencia de forma diferente.
    setImmediate(() => {
      try {
        autoUpdater.quitAndInstall(false, true)
      } catch (err) {
        console.error('[AutoUpdater] quitAndInstall failed:', err)
        app.exit(0)
      }
    })
  }

  /** Se esta construção pode fazer a instalação auto in-place real (ver canAutoInstall()). */
  public canAutoUpdate(): boolean {
    return canAutoInstall()
  }

  public async checkForUpdates(): Promise<void> {
    console.log('[AutoUpdater] Manual check for updates requested')
    try {
      // Em modo de desenvolvimento usar verificação manual da API do GitHub (electron-updater pula em dev)
      if (process.env.NODE_ENV === "development") {
        await this.checkForUpdatesManual()
      } else {
        await autoUpdater.checkForUpdatesAndNotify()
      }
    } catch (err: any) {
      console.error('[AutoUpdater] checkForUpdates failed:', err)
      const errorMessage = err.message || err.toString() || 'Update check failed'
      this.broadcast("update-error", errorMessage)
    }
  }

  public async downloadUpdate(): Promise<void> {
    if (this.updateDownloadState === 'downloaded' && this.downloadedUpdateInfo) {
      console.log('[AutoUpdater] Download already completed — re-broadcasting downloaded update')
      this.broadcast('update-downloaded', this.downloadedUpdateInfo)
      return
    }

    if (this.updateDownloadState === 'downloading') {
      console.log('[AutoUpdater] Download already in progress — ignoring duplicate request')
      await this.updateDownloadPromise
      return
    }

    if (!this.updateAvailable) {
      const message = 'No update is currently available to download.'
      console.warn(`[AutoUpdater] ${message}`)
      this.broadcast('update-error', message)
      return
    }

    console.log('[AutoUpdater] Starting download...')
    this.updateDownloadState = 'downloading'
    try {
      // Erros durante download são tornados superficiais via autoUpdater.on("error") que
      // já transmite "update-error". Não transmitir aqui para evitar duplicatas.
      this.updateDownloadPromise = autoUpdater.downloadUpdate().catch(err => {
        console.error('[AutoUpdater] downloadUpdate failed:', err)
        this.updateDownloadState = this.updateAvailable ? 'available' : 'idle'
        this.updateDownloadPromise = null
        throw err
      })
      await this.updateDownloadPromise
    } catch (err: any) {
      console.error('[AutoUpdater] downloadUpdate exception:', err)
      this.updateDownloadState = this.updateAvailable ? 'available' : 'idle'
      this.updateDownloadPromise = null
    }
  }

  // Nova Propriedade para Áudio do Sistema & Microfone
  private systemAudioCapture: SystemAudioCapture | null = null;
  private microphoneCapture: MicrophoneCapture | null = null;
  private audioTestCapture: MicrophoneCapture | null = null; // Para teste de configuração de áudio
  private _audioTestStarting = false;               // P2-12: proteger contra chamadas concorrentes em andamento
  private googleSTT: STTProvider | null = null; // Interviewer
  private googleSTT_User: STTProvider | null = null; // User

  private createSTTProvider(speaker: 'interviewer' | 'user'): STTProvider | null {
    const { CredentialsManager } = require('./services/CredentialsManager');
    const sttProvider = CredentialsManager.getInstance().getSttProvider();
    const sttLanguage = CredentialsManager.getInstance().getSttLanguage();

    // 'nenhum' significa que o usuário desativou explicitamente o STT (nenhum provedor selecionado).
    // Retornar nulo então o pipeline pula STT sem recorrer ao Google.
    if (sttProvider === 'none') {
      console.log(`[Main] STT provider is 'none' — audio capture will proceed but transcription is disabled.`);
      return null;
    }

    let stt: STTProvider;

    if (sttProvider === 'refract') {
      const refractKey = CredentialsManager.getInstance().getRefractApiKey();
      if (!refractKey) {
        // Refract está em Coming Logo — sem chave significa degradar graciosamente como qualquer outro provedor
        console.warn(`[Main] No Refract API Key configured for ${speaker}, falling back to GoogleSTT`);
        stt = new GoogleSTT(speaker);
      } else {
        // 'system' para entrevistador (áudio do sistema), 'mic' para usuário (microfone).
        // O servidor usa ${key}:${channel} como a chave de sessão então ambos os streams
        // podem coexistir sem acionar concurrent_session_blocked.
        //
        // Fase 7/8: passar appVersion + plataforma para o corpo do session-create
        // do relay regional. A classe lê os feature flags do relay de
        // SettingsManager sozinha e deriva a URL base do control-plane de
        // seu próprio host, então o local de construção fica compacto. O caminho do relay é
        // desabilitado por flag por padrão — isso é inerte até regionalSttRelayEnabled.
        stt = new RefractProSTT(
          refractKey,
          speaker === 'interviewer' ? 'system' : 'mic',
          {
            appVersion: app.getVersion(),
            platform: process.platform === 'darwin' ? 'mac'
              : process.platform === 'win32' ? 'windows'
              : 'linux',
          },
        );
      }
    } else if (sttProvider === 'deepgram') {
      const apiKey = CredentialsManager.getInstance().getDeepgramApiKey();
      if (apiKey) {
        console.log(`[Main] Using DeepgramStreamingSTT for ${speaker}`);
        const dg = new DeepgramStreamingSTT(apiKey);
        // Opt-in de diarização (#3): apenas não canal remoto/system ('interviewer'), onde
        // múltiplas pessoas podem falar. O canal mic é sempre o usuário local ('me'), então
        // diarizá-lo adiciona custo sem benefício. Desativado por padrão via flag
        try {
          if (speaker === 'interviewer' && isIntelligenceFlagEnabled('speakerDiarizationV1')) {
            dg.setDiarization(true);
          }
        } catch { /* flag lê non-fatal */ }
        stt = dg;
      } else {
        console.warn(`[Main] No API key for Deepgram STT, falling back to GoogleSTT`);
        stt = new GoogleSTT(speaker);
      }
    } else if (sttProvider === 'soniox') {
      const apiKey = CredentialsManager.getInstance().getSonioxApiKey();
      if (apiKey) {
        console.log(`[Main] Using SonioxStreamingSTT for ${speaker}`);
        stt = new SonioxStreamingSTT(apiKey);
      } else {
        console.warn(`[Main] No API key for Soniox STT, falling back to GoogleSTT`);
        stt = new GoogleSTT(speaker);
      }
    } else if (sttProvider === 'elevenlabs') {
      const apiKey = CredentialsManager.getInstance().getElevenLabsApiKey();
      if (apiKey) {
        console.log(`[Main] Using ElevenLabsStreamingSTT for ${speaker}`);
        stt = new ElevenLabsStreamingSTT(apiKey);
      } else {
        console.warn(`[Main] No API key for ElevenLabs STT, falling back to GoogleSTT`);
        stt = new GoogleSTT(speaker);
      }
    } else if (sttProvider === 'openai') {
      // OpenAI: WebSocket Realtime (gpt-4o-transcribe → gpt-4o-mini-transcribe) com alternativa REST do whisper-1.
      // Se uma URL base personalizada compatível com OpenAI estiver configurada (ex. Speaches), a classe STT
      // pula o caminho do Realtime WS e usa REST contra o endpoint personalizado.
      const apiKey = CredentialsManager.getInstance().getOpenAiSttApiKey();
      const baseUrl = CredentialsManager.getInstance().getOpenAiSttBaseUrl();
      if (apiKey) {
        console.log(`[Main] Using OpenAIStreamingSTT for ${speaker}${baseUrl ? ` (custom endpoint: ${baseUrl})` : ' (WebSocket+REST fallback)'}`);
        stt = new OpenAIStreamingSTT(apiKey, baseUrl);
      } else {
        console.warn(`[Main] No API key for OpenAI STT, falling back to GoogleSTT`);
        stt = new GoogleSTT(speaker);
      }
    } else if (sttProvider === 'groq' || sttProvider === 'azure' || sttProvider === 'ibmwatson') {
      let apiKey: string | undefined;
      let region: string | undefined;
      let modelOverride: string | undefined;

      if (sttProvider === 'groq') {
        apiKey = CredentialsManager.getInstance().getGroqSttApiKey();
        modelOverride = CredentialsManager.getInstance().getGroqSttModel();
      } else if (sttProvider === 'azure') {
        apiKey = CredentialsManager.getInstance().getAzureApiKey();
        region = CredentialsManager.getInstance().getAzureRegion();
      } else if (sttProvider === 'ibmwatson') {
        apiKey = CredentialsManager.getInstance().getIbmWatsonApiKey();
        region = CredentialsManager.getInstance().getIbmWatsonRegion();
      }

      if (apiKey) {
        console.log(`[Main] Using RestSTT (${sttProvider}) for ${speaker}`);
        stt = new RestSTT(sttProvider, apiKey, modelOverride, region);
      } else {
        console.warn(`[Main] No API key for ${sttProvider} STT, falling back to GoogleSTT`);
        stt = new GoogleSTT(speaker);
      }
    } else if (sttProvider === 'local-whisper') {
      const { LocalWhisperSTT } = require('./audio/LocalWhisperSTT');
      const sm = SettingsManager.getInstance();
      const globalModel = sm.get('localWhisperModel') ?? 'Xenova/whisper-tiny.en';
      // Sobrescrita por canal quando habilitado as duas instâncias STT podem carregar
      // modelos diferentes (ex. Moonshine Tiny para mic, Moonshine Base para
      // áudio do sistema). Recorrer ao globalModel se o slot por canal estiver
      // vazio ou o feature estiver desabilitado.
      let modelId = globalModel;
      if (sm.get('localWhisperPerChannelEnabled')) {
        const override = speaker === 'interviewer'
          ? sm.get('localWhisperModelSystem')
          : sm.get('localWhisperModelMic');
        if (override) modelId = override;
      }
      console.log(`[Main] Using LocalWhisperSTT for ${speaker}, model: ${modelId}`);
      const lws = new LocalWhisperSTT(modelId);
      // O rótulo do canal desambigua as duas instâncias concorrentes nos logs de latência.
      lws.setChannel(speaker === 'interviewer' ? 'system' : 'mic');
      stt = lws as any;
    } else {
      stt = new GoogleSTT(speaker);
    }

    stt.setRecognitionLanguage(sttLanguage);

    // Wire Transcript Events
    stt.on('transcript', (segment: { text: string, isFinal: boolean, confidence: number, speakerId?: string }) => {
      // Aceitar transcrições enquanto a reunião estiver ativa OU enquanto estamos drenando
      // finais pendentes após Parar. `_isDraining` cobre a janela de ~250 ms de graça
      // entre o clique de Parar e o fechamento do socket STT então a última
      // frase do usuário não seja silenciosamente descartada.
      if (!this.isMeetingActive && !this._isDraining) {
        return;
      }

      this.intelligenceManager.handleTranscript({
        speaker: speaker,
        ...(segment.speakerId ? { speakerId: segment.speakerId } : {}),
        text: segment.text,
        timestamp: Date.now(),
        final: segment.isFinal,
        confidence: segment.confidence
      });

      // Alimentar transcrição final para o indexador JIT RAG
      if (segment.isFinal && this.ragManager) {
        this.ragManager.feedLiveTranscript([{
          speaker: speaker,
          text: segment.text,
          timestamp: Date.now()
        }]);
      }

      const payload = {
        speaker: speaker,
        ...(segment.speakerId ? { speakerId: segment.speakerId } : {}),
        text: segment.text,
        timestamp: Date.now(),
        final: segment.isFinal,
        confidence: segment.confidence
      };
      // Apenas exibição — enviar parcial com throttling (finais passam imediatamente
      // pelo caminho da resposta acima (handleTranscript / alimentação RAG) sem afetação.
      this.sendThrottledTranscript(payload);

      // Alimentar transcrições finais do recrutador (áudio do sistema) para o
      // negotiation tracker premium. Issue #272: condicionar por modo template ativo então o
      // tracker nunca acumule estado de negociação em modos onde salário está
      // fora de escopo (technical-interview, team-meet, lecture). O gating
      // em LLMHelper é a defesa primária; gating na fonte para que o estado
      // não persista em qualquer leitura futura. Falhar aberto se ModesManager
      // estiver indisponível.
      if (segment.isFinal && speaker === 'interviewer') {
        let trackerFeedAllowed = true;
        try {
          const { ModesManager } = require('./services/ModesManager');
          trackerFeedAllowed = ModesManager.getInstance().isPremiumKnowledgeInterceptAllowed();
        } catch (_err) {
          // falhar aberto — preservar comportamento existente para modos que precisam do tracker
        }
        if (trackerFeedAllowed) {
          this.knowledgeOrchestrator?.feedInterviewerUtterance?.(segment.text);
        }
      }
    });

    // Contador de falhas consecutivas — reiniciar em qualquer transcrição final bem-sucedida
    let _consecutiveErrors = 0;

    // B2: Rastrear estado então transmitimos 'connected' na recuperação de failed/reconnecting.
    // Inicializar com 'awaiting-audio' então a UI do renderer inicie não estado neutro
    // "Escutando áudio…" até a primeira transcrição isFinal comprove
    // que o pipeline está realmente fluindo. Antes da correção este estado era 'reconnecting' que
    // implicava um estado de recuperação desde o início.
    let _lastState: 'connected' | 'reconnecting' | 'failed' | 'awaiting-audio' = 'awaiting-audio';

    stt.on('error', (err: Error) => {
      // O tempo limite de silêncio de 10s do streamingRecognize do Google fecha o stream
      // com código gRPC 11 ("Audio Timeout Error"). O GoogleSTT já
      // engole esse caso antes que chegue a nós, mas outros provedores podem
      // apresentar um idle-timeout similar que o caminho de reconexão lazy
      // recuperou limpo. Reduzir a uma linha aqui também então
      // um escape acidental não se propague em ruído de stack-trace.
      const grpcCode = (err as any)?.code;
      if (grpcCode === 11 || /Audio Timeout Error/i.test(err.message || '')) {
        console.warn(`[Main] STT (${speaker}) idle-timed-out (provider's no-audio limit), reconnecting on next chunk.`);
        return;
      }

      console.error(`[Main] STT (${speaker}) Error:`, err);

      // Extrair informações de erro mais detalhadas de erros Axios (RestSTT)
      let errorMessage = err.message;
      const axiosErr = err as any;
      const httpStatus = axiosErr?.response?.status || 0;
      if (axiosErr?.response?.data?.error) {
        const respErr = axiosErr.response.data.error;
        const respMsg = typeof respErr === 'string' ? respErr : (respErr.message || respErr.code || JSON.stringify(respErr));
        errorMessage = httpStatus ? `${httpStatus} ${respMsg}` : respMsg;
      } else if (httpStatus) {
        errorMessage = `${httpStatus} ${axiosErr.response.statusText}`;
      }

      // Imediatamente fatal: problemas de autenticação/conta — nenhuma quantidade de tentativas ajuda
      const isAuthError = httpStatus === 401
        || err.message.toLowerCase().includes('auth_timeout')
        || err.message.toLowerCase().includes('invalid_key')
        || err.message.toLowerCase().includes('invalid api')
        || err.message.toLowerCase().includes('authentication');

      const isQuotaError = err.message.toLowerCase().includes('transcription_quota_exceeded')
        || err.message.toLowerCase().includes('quota');

      if (isAuthError) {
        _consecutiveErrors = 0;
        _lastState = 'failed';
        this.sendSttStatus( {
          state: 'failed',
          provider: sttProvider,
          error: errorMessage,
          channel: speaker,
        } as SttStatusPayload);
        return;
      }

      // Retryable: queda de rede, timeout, 5xx, 400, 429, queda de WS
      _consecutiveErrors++;
      const maxErrors = 5;

      if (_consecutiveErrors >= maxErrors || isQuotaError) {
        _lastState = 'failed';
        this.sendSttStatus( {
          state: 'failed',
          provider: sttProvider,
          error: isQuotaError
            ? errorMessage
            : `STT provider failed (${_consecutiveErrors} consecutive errors): ${errorMessage}`,
          channel: speaker,
          reconnectAttempts: _consecutiveErrors,
        } as SttStatusPayload);
      } else {
        _lastState = 'reconnecting';
        this.sendSttStatus( {
          state: 'reconnecting',
          provider: sttProvider,
          error: errorMessage,
          channel: speaker,
          reconnectAttempts: _consecutiveErrors,
        } as SttStatusPayload);
      }
    });

    // Rastrear transcrições bem-sucedidas — reiniciar contador de erros consecutivos
    // Transmitir 'connected' sempre que recuperamos de reconnecting/failed
    stt.on('transcript', (segment: { text: string, isFinal: boolean, confidence: number }) => {
      if (segment.isFinal) {
        _consecutiveErrors = 0; // Sucesso — reiniciar contador
        if (_lastState !== 'connected') {
          _lastState = 'connected';
          this.sendSttStatus( {
            state: 'connected',
            provider: sttProvider,
            channel: speaker,
          } as SttStatusPayload);
        }
      }
    });

    // Telemetria não-fatal de provedores (ex. OpenAIStreamingSTT emite isso
    // quando o ring buffer pré-sessão descarta áudio principal enquanto aguarda
    // o handshake WebSocket). Tornar visível não registro do processo principal então o
    // sinal não seja silenciosamente descartado — o evento é informativo, não uma mudança
    // de status, então não o transmitimos pelo canal stt-status.
    stt.on('warning', (w: { code?: string; message?: string; droppedBytes?: number }) => {
      console.warn(`[Main] STT (${speaker}) warning: ${w?.code ?? 'unknown'}`,
        { provider: sttProvider, message: w?.message, droppedBytes: w?.droppedBytes });
    });

    // Detecção automática de idioma: o RefractProSTT emite 'languageDetected' quando o
    // backend resolver o idioma do primeiro lote de áudio. Notifica o renderer
    // então a interface de configurações pode mostrar what foi detectado.
    if (stt instanceof RefractProSTT) {
      stt.on('connected', () => {
        _consecutiveErrors = 0;
        if (_lastState !== 'connected') {
          _lastState = 'awaiting-audio';
          this.sendSttStatus({
            state: 'awaiting-audio',
            provider: sttProvider,
            channel: speaker,
          } as SttStatusPayload);
        }
      });

      stt.on('languageDetected', (bcp47: string) => {
        console.log(`[Main] STT language auto-detected (${speaker}): ${bcp47}`);
        const helper = this.getWindowHelper();
        helper.getMainWindow()?.webContents.send('stt-language-auto-detected', bcp47);
        helper.getLauncherWindow()?.webContents.send('stt-language-auto-detected', bcp47);
      });

      // Sinal de reconexão persistente: o RefractProSTT agora tenta novamente indefinidamente
      // com um teto de recuo de 30s, mas queremos que o usuário saiba após ~5 tentativas
      // (~30–90s de transcrição morta) que o problema é sustentado, não um tropico.
      // Reutilizar o canal stt-status com state='reconnecting' e uma contagem
      // maior de tentativas então o banner existente do renderer o capte
      stt.on('persistent-reconnect', (info: { attempts: number }) => {
        console.warn(`[Main] STT persistent reconnect (${speaker}): ${info.attempts} consecutive attempts.`);
        this.sendSttStatus( {
          state: 'reconnecting',
          provider: sttProvider,
          error: `Reconnecting to transcription service — ${info.attempts} consecutive attempts. Check your network connection.`,
          channel: speaker,
          reconnectAttempts: info.attempts,
        } as SttStatusPayload);
      });
    }

    // B2: Emitir 'awaiting-audio' uma vez o provedor STT esteja conectado mas antes
    // qualquer áudio tenha fluído. Renderizadores que entraram não meio da sessão sincronizam com esse
    // estado não-verificado e exibem "Escutando áudio…" até a primeira
    // transcrição isFinal acione a transição 'connected' acima
    this.sendSttStatus({
      state: 'awaiting-audio',
      provider: sttProvider,
      channel: speaker,
    } as SttStatusPayload);

    return stt;
  }

  /**
   * REFACTOR: wireSystemCapture / wireMicCapture.
   *
   * Previously o listener-wiring blocks para SystemAudioCapture were
   * duplicated three times (setupSystemAudioPipeline + happy-path of
   * reconfigureAudio + fallback-path of reconfigureAudio), cada com its own
   * closure-local chunk counter (`_sysChunkCount` / `_rcfgSysChunkCount` /
   * `_dfltSysChunkCount`) e slightly diferente registro prefix. That made it
   * impossible para know que counter was ativo de o logs.
   *
   * Consolidation: a único helper attaches todos four listeners contra the
   * given capture instance. The `label` parâmetro apenas affects logging so
   * o originating chamar site is still identifiable. setupAudioRecoveryHandler
   * is também called here so todo wire-up caminho gets recovery para free.
   */
  private wireSystemCapture(capture: SystemAudioCapture, label: string = ''): void {
    const prefix = label ? `[Main] ${label} ` : '[Main] ';
    let chunkCount = 0;
    // Watchdog: se nenhum chunk chegar dentro de 8s de iniciar a captura, as causas mais prováveis
    // são (a) a permissão de Gravação de Tela foi revogada entre a verificação
    // TCC e a inicialização do SCK, (b) o aplicativo de reunião roteia áudio para um dispositivo que
    // o CoreAudio Tap não está vinculado, ou (c) o sistema está genuinamente silencioso.
    // Aplicativos em nível de produção tornam isso visível então o usuário saiba que o áudio do entrevistador
    // não está sendo capturado — em vez de ficar olhando para uma transcrição vazia.
    //
    // B11: tempo limite estendido de 8000 → 12000ms. O caminho alternativa do ScreenCaptureKit
    // (hosts macOS <14.4 ou onde a inicialização do CoreAudio Tap falha) leva 5-7s
    // para entregar seu primeiro buffer de áudio em um sistema aquecido, e ~8-10s em um
    // host mais lento/contendido. O tempo limite anterior de 8s tinha apenas uma margem de 1-3s
    // e produzia banners de falso positivo "0 chunks em 8s" durante o cold-start
    // legítimo do SCK.
    const STUCK_WATCHDOG_MS = 12000;
    const systemAudioHealth = new SystemAudioHealthClassifier({ watchdogMs: STUCK_WATCHDOG_MS });
    const handleSystemAudioHealthDecision = (decision: any) => {
      if (!decision || decision.type === 'none') return;
      if (decision.type === 'log') {
        const logger = decision.level === 'info' ? console.log : console.warn;
        logger(`${prefix}${decision.message}`);
        return;
      }
      if (decision.type === 'warn-user' && decision.reason === 'same-device-input-output') {
        const msg = formatPermissionMessage('mac-same-device-input-output', { device: decision.device });
        console.warn(`${prefix}SystemAudioCapture ${msg}`);
        this.sendAudioCaptureFailed( {
          channel: 'system',
          message: msg,
          attempt: 0,
          maxAttempts: 3,
          terminal: decision.terminal,
          stuck: decision.stuck,
        });
      }
    };
    let stuckTimer: NodeJS.Timeout | null = null;
    const armStuckWatchdog = () => {
      handleSystemAudioHealthDecision(systemAudioHealth.handle({ kind: 'capture-started', nowMs: Date.now() }));
      if (stuckTimer) clearTimeout(stuckTimer);
      stuckTimer = setTimeout(() => {
        if (this.systemAudioCapture !== capture) return; // capture era replaced
        if (chunkCount > 0) return;                       // já producing
        if (!this.isMeetingActive) return;                // meeting ended

        // Bluetooth devices como AirPods registra com separate identifiers
        // para entrada (cpal device nnome e saída (CoreAudio UID com
        // opcional :input/:output suffix). Quando o user tem o mesmo
        // physical device em ambos sides de o pipeline, macOS cannot executa a
        // CoreAudio Processo Tap em it enquanto it's também o ativo microphone
        // — o tap inicializa "successfully" mas todo IO retorno de chamada yields
        // zero frames. Surface o actual cause em vez disso de a generic
        // "rotea mismatch" hint então o user knows o que para change.
        // O same-device-input-output limitation é a CoreAudio Processo Tap
        // restrição — apenas relevant em macOS. detectSameInputOutputDevice
        // é si mesmo macOS-specific; pular o verifica em outro platforms.
        const sameDeviceName = process.platform === 'darwin'
          ? this.detectSameInputOutputDevice()
          : null;
        if (sameDeviceName) {
          handleSystemAudioHealthDecision(systemAudioHealth.handle({
            kind: 'same-device-route-detected',
            nowMs: Date.now(),
            device: sameDeviceName,
          }));
          return;
        }

        handleSystemAudioHealthDecision(systemAudioHealth.handle({ kind: 'watchdog-tick', nowMs: Date.now() }));
      }, STUCK_WATCHDOG_MS);
    };

    // Synchronous disarm closure exposed em o capture instance então endMeeting()
    // e abortStaleAudioInit() pode cancelar o stuck watchdog Antes stop()/destroy()
    // — sem relying em o on('stop') evento firing synchronously. Caso contrário a
    // curto meeting que produced 0 chunks pode disparar a falso "system-audio-stuck"
    // banner para cima para 12s após o user já stopped.
    const disarmStuckWatchdog = () => {
      if (stuckTimer) { clearTimeout(stuckTimer); stuckTimer = null; }
      handleSystemAudioHealthDecision(systemAudioHealth.handle({ kind: 'capture-stopped', nowMs: Date.now() }));
    };
    (capture as any).__disarmStuckWatchdog = disarmStuckWatchdog;
    capture.on('start', armStuckWatchdog);
    capture.on('stop', disarmStuckWatchdog);
    capture.on('data', (chunk: Buffer) => {
      const now = Date.now();
      handleSystemAudioHealthDecision(systemAudioHealth.handle({ kind: 'chunk', nowMs: now, chunk }));
      chunkCount++;
      if (chunkCount === 1 && stuckTimer) {
        clearTimeout(stuckTimer);
        stuckTimer = null;
      }
      if (!this._sysSttRateApplied && this.googleSTT && this.systemAudioCapture === capture) {
        const rate = capture.getSampleRate();
        this.googleSTT.setSampleRate(rate);
        this.googleSTT.setAudioChannelCount?.(1);
        this._sysSttRateApplied = true;
        console.log(`${prefix}Interviewer STT rate locked from first chunk: ${rate}Hz`);
      }
      if (chunkCount <= 3 || chunkCount % 500 === 0) {
        console.log(`${prefix}SystemAudio->STT: chunk #${chunkCount}, ${chunk.length}B, googleSTT=${this.googleSTT ? 'active' : 'NULL'}`);
      }


      this.googleSTT?.write(chunk);
    });
    capture.on('sample_rate_changed', (rate: number) => {
      console.log(`${prefix}SystemAudioCapture rate updated dynamically to ${rate}Hz`);
      this.googleSTT?.setSampleRate(rate);
    });
    capture.on('speech_ended', () => {
      this.googleSTT?.notifySpeechEnded?.();
    });
    // setupAudioRecoveryHandler registra seu próprio ouvinte 'error' — não
    // adicionar um logger duplicado aqui ou o mesmo erro será reportado duas vezes.
    this.setupAudioRecoveryHandler();
  }

  private wireMicCapture(capture: MicrophoneCapture, label: string = ''): void {
    const prefix = label ? `[Main] ${label} ` : '[Main] ';
    let chunkCount = 0;
    // Espelho do watchdog de stuck do áudio do sistema: se o retorno de chamada do cpal nunca
    // produzir amostras dentro de STUCK_WATCHDOG_MS de iniciar (microfone USB que
    // desaparece não modo exclusivo por contention com outro app,
    // dispositivo padrão retornando um manipular que está realmente silenciado), tornar visível um
    // sinal claro na UI em vez de deixar a transcrição do usuário morrer silenciosamente.
    //
    // B11: tempo limite estendido de 8000 → 12000ms para espelhar o watchdog
    // do áudio do sistema. O cold-start do cpal em reconexão USB hot-replug ou transição HFP Bluetooth
    // pode levar 5-9s em hardware contendido.
    const STUCK_WATCHDOG_MS = 12000;
    let stuckTimer: NodeJS.Timeout | null = null;
    const armStuckWatchdog = () => {
      if (stuckTimer) clearTimeout(stuckTimer);
      stuckTimer = setTimeout(() => {
        if (this.microphoneCapture !== capture) return;
        if (chunkCount > 0) return;
        if (!this.isMeetingActive) return;
        console.warn(`${prefix}MicrophoneCapture produced 0 chunks in ${STUCK_WATCHDOG_MS / 1000}s — likely silent capture (device contention, hot-unplug, or muted input).`);
        this.sendAudioCaptureFailed( {
          channel: 'mic',
          message: `No audio detected from your microphone for ${STUCK_WATCHDOG_MS / 1000}s. Check that your input device is unmuted and not in use by another app.`,
          attempt: 0,
          maxAttempts: 3,
          terminal: false,
          stuck: true,
        });
      }, STUCK_WATCHDOG_MS);
    };
    // Espelhar wireSystemCapture: expor uma closure de desarme síncrono então o watchdog
    // de stuck do mic possa ser cancelado antes de stop()/destroy() durante o teardown.
    const disarmStuckWatchdog = () => {
      if (stuckTimer) { clearTimeout(stuckTimer); stuckTimer = null; }
    };
    (capture as any).__disarmStuckWatchdog = disarmStuckWatchdog;
    capture.on('start', armStuckWatchdog);
    capture.on('stop', disarmStuckWatchdog);
    // Rastreamento de gaps entre chunks — ver wireSystemCapture para justificativa.
    let lastChunkAt = 0;
    // Detector de preenchimento zero TCC / entrada silenciada. O cpal vai alegremente abrir um stream de mic
    // e entregar buffers silenciosos (peak=0) quando
    //   - a permissão de Microfone do macOS foi revogada entre a verificação TCC e a inicialização
    //   - o SO silenciou a entrada via o indicador de mic na barra de menus,
    //   - o mic de hardware está fisicamente silenciado (alguns headsets Jabra/Bose),
    //   - contention em modo exclusivo com o aplicativo de reunião (Zoom/Teams) não Windows.
    // Mesmo formato que o preenchimento zero do system tap: chunks chegam em cadência mas todas
    // as amostras são 0. Sem isso, o usuário apenas vê uma transcrição de usuário vazia
    // e assume que a reunião em si está quebrada.
    const ZEROFILL_OBSERVATION_MS = 12000;
    let firstChunkAt = 0;
    let zerofillLatched = false;
    let zerofillTriggered = false;
    // One-shot proteger para o mid-meeting HFP-degradation backstop babaixo
    let hfpDegradationChecked = false;
    capture.on('data', (chunk: Buffer) => {
      const now = Date.now();
      if (lastChunkAt > 0) {
        const gap = now - lastChunkAt;
        if (gap > 2000 && gap < 8000) {
          console.warn(`${prefix}Mic chunk gap ${gap}ms — likely transient device change (USB hot-plug, BT reconnect). Resuming.`);
        }
      }
      lastChunkAt = now;
      chunkCount++;
      if (chunkCount === 1 && stuckTimer) {
        clearTimeout(stuckTimer);
        stuckTimer = null;
      }
      if (!this._micSttRateApplied && this.googleSTT_User && this.microphoneCapture === capture) {
        const rate = capture.getSampleRate();
        this.googleSTT_User.setSampleRate(rate);
        this.googleSTT_User.setAudioChannelCount?.(1);
        this._micSttRateApplied = true;
        console.log(`${prefix}User STT rate locked from first mic chunk: ${rate}Hz`);
      }

      // HFP-degradation backstop. O proactive reconfigureAudio verifica gerencia
      // o comum case (default mic + Bluetooth osaída at meeting sinicia this
      // detecta o que não pode ver estaticamente: o microfone padrão do SO resolvendo para um
      // Bluetooth device enquanto saída é o laptop speakers, ou a device
      // dropping dentro de HFP mid-meeting. O NATIVE rate é ground truth — macOS
      // abre a built-in/USB mic at 44.1/48kHz, mas a Bluetooth mic em HFP "call
      // mmodo reports ≤24kHz. Então ≤24kHz native significa o mic é degraded
      // independentemente de como it's named ('default' lists como "Default Microphone",
      // nunca o hardware nome — que é por que o nome verifica alone missed
      // AirPods). Checked uma vez por capture (hfpDegradationChecked), após oabrir
      // Darwin-only: Windows BT mics don't exhibit isso exact rate ccolapsar
      if (!hfpDegradationChecked && process.platform === 'darwin' && this.microphoneCapture === capture) {
        hfpDegradationChecked = true;
        try {
          const nativeRate = capture.getNativeSampleRate?.() ?? 0;
          if (nativeRate > 0 && nativeRate <= 24000) {
            const builtIn = this.findBuiltInInputDevice();
            const alreadyBuiltIn =
              !!builtIn &&
              !!this._lastRequestedInputDeviceId &&
              this.normalizeDeviceName(builtIn.name) ===
                this.normalizeDeviceName(this._lastRequestedInputDeviceId);

            if (builtIn && !alreadyBuiltIn) {
              // Auto-switch para o built-in mic — o "apenas works" pcaminho O BT
              // device stays o audio Saída (A2DP), então o user keeps hearing
              // o meeting em their earbuds. reconfigureAudio tears abaixo +
              // recreates o mic capture, então defer it fora o dados manipulador to
              // avoid re-entrancy em o live sstream
              console.warn(`${prefix}Mic native rate ${nativeRate}Hz indicates Bluetooth HFP (degraded). Auto-switching to built-in mic "${builtIn.name}".`);
              this.broadcast('audio-input-auto-switched', {
                from: 'Bluetooth mic',
                to: builtIn.name,
                reason: 'bluetooth-hfp-avoided',
              });
              const outputId = this._lastRequestedOutputDeviceId;
              setImmediate(() => {
                if (this.isMeetingActive && this.microphoneCapture === capture) {
                  void this.reconfigureAudio(builtIn.id, outputId).catch(err =>
                    console.warn(`${prefix}HFP auto-switch reconfigure failed:`, err),
                  );
                }
              });
            } else if (!builtIn) {
              console.warn(`${prefix}Mic in HFP (native ${nativeRate}Hz) but no built-in mic to switch to.`);
              this.sendAudioCaptureFailed({
                channel: 'mic',
                message: `Your microphone is in low-quality Bluetooth call mode. Set your audio output to the speakers, or use a different mic, for better transcription.`,
                attempt: 0,
                maxAttempts: 0,
                terminal: false,
                stuck: false,
              });
            }
          }
        } catch (e) {
          console.warn(`${prefix}HFP degradation check failed (non-fatal):`, e);
        }
      }

      if (!zerofillLatched && !zerofillTriggered) {
        if (firstChunkAt === 0) firstChunkAt = now;
        // B10: peak-to-peak detection — see wireSystemCapture para completo rationale.
        // Pre-fix `abs(sample) > 8` false-latched em DC bias de muted-but-biased
        // mics (USB/Bluetooth hardware bias de ±10..±50 é common), permanently
        // disabling o detector. Peak-to-peak (max - min) é DC-offset invariant.
        let minS = 32767;
        let maxS = -32768;
        const stride = Math.max(2, (chunk.length >> 5) & ~1);
        for (let i = 0; i + 1 < chunk.length; i += stride) {
          const s = chunk.readInt16LE(i);
          if (s < minS) minS = s;
          if (s > maxS) maxS = s;
        }
        const peakToPeak = maxS - minS;
        if (peakToPeak > 100) {
          zerofillLatched = true;
        } else if (now - firstChunkAt >= ZEROFILL_OBSERVATION_MS) {
          zerofillTriggered = true;
          console.warn(`${prefix}Mic chunks all zero-filled (peak-to-peak < 100) for ${ZEROFILL_OBSERVATION_MS / 1000}s — TCC denial or device-mute suspected.`);
          this.sendAudioCaptureFailed( {
            channel: 'mic',
            message: formatPermissionMessage('mic-zero-fill'),
            attempt: 0,
            maxAttempts: 3,
            terminal: false,
            stuck: true,
          });
        }
      }

      this.googleSTT_User?.write(chunk);
    });
    capture.on('sample_rate_changed', (rate: number) => {
      console.log(`${prefix}MicrophoneCapture rate updated dynamically to ${rate}Hz`);
      this.googleSTT_User?.setSampleRate(rate);
    });
    capture.on('speech_ended', () => {
      this.googleSTT_User?.notifySpeechEnded?.();
    });
    // setupMicRecoveryHandler registra its próprio 'error' llistener
    this.setupMicRecoveryHandler();
  }

  private async setupSystemAudioPipeline(): Promise<void> {
    // REMOVED EARLY RRetorna se (this.systemAudioCapture && this.microphoneCapture) rretorna // Já initialized

    try {
      // 1. Inicializa Captures se missing
      // If they já exist (e.g. de reconfigureAudio), they são já wired para escreve para this.googleSTT/User
      //
      // B6: Sempre re-evaluate screen-recording permissão at pipeline sconfigura
      // independentemente de se a SystemAudioCapture wrapper já exists.
      // Pre-fix isso verifica era gated em `!this.systemAudioCapture`, então a stale
      // wrapper que survived de a prior meeting (mid-stream reconfigureAudio
      // failure, deferred teardown, etetc iria prevenir o permissão re-check,
      // e a between-meeting TCC revogar iria cause o próximo meeting to
      // silently zero-fill com não banner — o exact pattern o audit
      // identified para "permissions granted (então revoked), não transcription."
      const screenCapability = await resolveMacScreenCaptureCapability('system audio pipeline setup');

      if (screenCapability.effectiveDenied) {
        const message = screenCapability.message ?? formatPermissionMessage('screen-recording-denied');
        console.warn('[Main] Screen Recording permission denied at pipeline setup. Tearing down any stale system audio capture; meeting will run mic-only.');
        this.sendSystemAudioPermissionDenied(message);
        this.broadcastDeviceSelection({
          kind: 'output',
          requested: null,
          actual: null,
          fellBack: true,
          reason: 'screen-recording-permission-denied',
        });
        // B6: tear abaixo qualquer stale capture então o 2nd meeting após a
        // between-meeting TCC revogar doesn't continue feeding o STT
        // pipeline zero-filled audio contra a now-denied ppermissão
        if (this.systemAudioCapture) {
          try {
            await this.systemAudioCapture.destroy();
          } catch (destroyErr) {
            console.warn('[Main] Stale system audio capture destroy failed during permission-denied path:', destroyErr);
          }
          this.systemAudioCapture = null;
          this._sysSttRateApplied = false;
        }
      } else if (!this.systemAudioCapture) {
        // B3: encapsular construction + wiring em its próprio try/catch então a native-module
        // failure (NAPI throw, HAL/WASAPI resource exhaustion, internal error
        // de SystemAudioCapture ctor) doesn't silently leave systemAudioCapture
        // nulo com não watchdog armed e não UI ssinal Pre-fix o lançar era
        // caught por o outer capturar at o fundo de o ffunção que apenas
        // console.error'd — o caller então proceeded com a nulo capture, o
        // STT WS connected, o user saw "Listening para audio…" forever, and
        // não banner já surfaced.
        try {
          this.systemAudioCapture = new SystemAudioCapture();
          this.wireSystemCapture(this.systemAudioCapture);
          // Transparency: tell o renderer que device é actually sendo captured
          // até em o no-metadata padrão pcaminho Anteriormente apenas reconfigureAudio
          // transmitir this, então a meeting started sem an explicit device choice
          // esquerda o UI em o dark sobre se system audio era using o
          // expected saída rrotea
          this.broadcastDeviceSelection({
            kind: 'output',
            requested: null,
            actual: 'default',
            fellBack: false,
          });
        } catch (capErr) {
          console.error('[Main] SystemAudioCapture construction failed:', capErr);
          this.systemAudioCapture = null;
          this.sendAudioCaptureFailed({
            channel: 'system',
            message: 'System audio capture failed to initialize. The native audio module could not allocate the capture device. Restarting Refract may help; if the problem persists, file a bug.',
            attempt: 0,
            maxAttempts: 0,
            terminal: true,
            stuck: false,
          });
        }
      }
      // If !effectiveDenied && this.systemAudioCapture já exists, o
      // existing wrapper é assumed correto (its watchdogs vai detect qualquer
      // zero-fill ou stuck estado e surface via audio-capture-failed).

      if (!this.microphoneCapture) {
        // B3: mesmo defense para mic ctor throws (USB device disappears em oabrir
        // exclusive-mode steal). Outer try/catch apenas logged; user got não banner.
        try {
          this.microphoneCapture = new MicrophoneCapture();
          this.wireMicCapture(this.microphoneCapture);
        } catch (capErr) {
          console.error('[Main] MicrophoneCapture construction failed:', capErr);
          this.microphoneCapture = null;
          this.sendAudioCaptureFailed({
            channel: 'mic',
            message: 'Microphone capture failed to initialize. The native audio module could not open the default input device. Check that the device is connected and not in exclusive use by another app, then restart Refract.',
            attempt: 0,
            maxAttempts: 0,
            terminal: true,
            stuck: false,
          });
        }
      }

      // 2. Inicializa STT Services se missing
      // STT inicializar empacota cada createSTTProvider em its próprio try/catch então a single
      // provedor failure (bad API kchave missing credentials farquivo network error
      // durante constructor) doesn't break o entire pipeline AND o user obtém
      // a específico UI sinal em vez disso de o generic "não transcript" experience.
      const { CredentialsManager } = require('./services/CredentialsManager');
      const sttProv = CredentialsManager.getInstance().getSttProvider();

      if (!this.googleSTT) {
        console.log(`[Main] Creating interviewer STT provider: ${sttProv}`);
        try {
          this.googleSTT = this.createSTTProvider('interviewer');
        } catch (sttErr) {
          console.error(`[Main] Interviewer STT init failed (${sttProv}):`, sttErr);
          this.googleSTT = null;
        }
        if (!this.googleSTT) {
          this.sendAudioCaptureFailed( {
            channel: 'system',
            message: `Speech-to-text provider "${sttProv}" failed to initialize for the interviewer channel. Check your API key and credentials in Settings.`,
            attempt: 0,
            maxAttempts: 0,
            terminal: true,
            stuck: false,
          });
        }
      }

      if (!this.googleSTT_User) {
        console.log(`[Main] Creating user STT provider: ${sttProv}`);
        try {
          this.googleSTT_User = this.createSTTProvider('user');
        } catch (sttErr) {
          console.error(`[Main] User STT init failed (${sttProv}):`, sttErr);
          this.googleSTT_User = null;
        }
        if (!this.googleSTT_User) {
          this.sendAudioCaptureFailed( {
            channel: 'mic',
            message: `Speech-to-text provider "${sttProv}" failed to initialize for the microphone channel. Check your API key and credentials in Settings.`,
            attempt: 0,
            maxAttempts: 0,
            terminal: true,
            stuck: false,
          });
        }
      }

      // STT sample rate é agora applied lazily em o primeiro chunk arrival
      // (see o 'data' handlers abacima Pre-configuring aqui era racy porque
      // SystemAudioCapture's monitorar doesn't exist até stinicia e Retorna
      // o constructor padrão (48000) até o native bg-init thread
      // publishes o real rate — que em Windows após Fix #2 é known
      // synchronously, mas em macOS CoreAudio Tap takes ~5-7s para propagate.
      this._sysSttRateApplied = false;
      this._micSttRateApplied = false;

      if (this._verboseLogging) console.log('[Main] Full Audio Pipeline (System + Mic) Initialized (Ready)');

    } catch (err) {
      console.error('[Main] Failed to setup System Audio Pipeline:', err);
    }
  }

  /**
   * PERF: Pre-construct STT provider objects at app launch so o meeting-start
   * critical caminho doesn't pay para createSTTProvider (which does CredentialsManager
   * lookup + ouvinte wiring + per-provider classe init).
   *
   * NOTE: isso apenas constructs o JS objects. Provider sockets are still opened
   * lazily on primeiro .write() / .start() — opening idle sockets at app launch
   * would burn provider quota e is provider-specific behavior we don't want
   * para assume. The actual streaming-WebSocket cold-start is a separate (larger)
   * optimization que deve be done per-provider.
   *
   * Safe para chamar múltiplos times: existence guards in setupSystemAudioPipeline
   * prevent duplicate construction.
   */
  public prewarmSttProviders(): void {
    if (this.googleSTT && this.googleSTT_User) return;
    try {
      if (!this.googleSTT) {
        console.log('[Main] Pre-warming interviewer STT provider...');
        this.googleSTT = this.createSTTProvider('interviewer');
      }
      if (!this.googleSTT_User) {
        console.log('[Main] Pre-warming user STT provider...');
        this.googleSTT_User = this.createSTTProvider('user');
      }
    } catch (err) {
      // Pre-warm failure é non-fatal; setupSystemAudioPipeline vai tentar novamente em
      // primeiro meeting inicia com completo erro handling.
      console.warn('[Main] STT pre-warm failed (will retry on meeting start):', err);
    }
  }

  /**
   * Restart system + mic captures depois a macOS sleep/wake cycle.
   *
   * Why isso exists: quando o laptop sleeps (lid close, "Sleep" menu, idle
   * timeout), CoreAudio invalidates o AggregateDevice handle, o SCK
   * stream silently dies, e o Process Tap stops delivering buffers. On
   * resume o OS doesn't notificar our IO proc, so o captures sit there
   * looking healthy (chunkCount > 0 de antes sleep, isRecording=true)
   * mas nunca produce outro chunk. The 8s no-chunks watchdog *would*
   * eventually fire, mas apenas on o caminho where chunkCount stays at 0 — it
   * doesn't help mid-meeting depois we've already seen audio.
   *
   * The WS connection is similarly half-dead: TCP keepalive won't notice
   * para 2+ hours on macOS, e meanwhile o renderer shows a frozen
   * transcript e a "Connected" badge.
   *
   * Cleanest fix: on system resume, se a meeting is active, destruir and
   * recreate both captures using o mesmo device IDs o user originally
   * picked. The STT WS vai fechar as a side efeito of o capture parar and
   * reconectar via o existing scheduleReconnect path. Total dead air is
   * ~500ms — a small price para guaranteed recovery.
   */
  public async restartCapturesAfterResume(): Promise<void> {
    if (!this.isMeetingActive) {
      console.log('[Main] System resume — no active meeting, nothing to restart.');
      return;
    }
    console.log('[Main] System resume — restarting captures so CoreAudio/cpal handles are fresh.');

    // B7: reinicia Todos audio recovery estado Antes recreating captures. Estado é
    // tied para a Específico capture instance's failure history; uma vez we destroy
    // + recreate, o fresh captures precisa obtém a clean slate. Mirrors o
    // fuller reinicia feito em startMeeting. Pre-fix:
    //   1. Counter saturation (attempts == 3) caused o early-return guards
    //      em setupMicRecoveryHandler / setupAudioRecoveryHandler para soltar
    //      o Primeiro post-wake erro evento silently — cpal frequently
    //      emite a transient 'error' em wake, que era o exact bug.
    //   2. A pre-sleep recovery em flight (`_*RecoveryInProgress = true`)
    //      AND its pendente `_*RecoveryTimer` iria ainda ser referenced por
    //      o abandoned recovery promise após wake, então a stale recovery
    //      poderia land em a freshly recreated capture.
    this._systemAudioRecoveryInProgress = false;
    this._systemAudioRecoveryAttempts = 0;
    this._systemAudioConsecutiveFailures = 0;
    if (this._systemAudioRecoveryTimer) {
      clearTimeout(this._systemAudioRecoveryTimer);
      this._systemAudioRecoveryTimer = null;
    }
    this._micRecoveryInProgress = false;
    this._micRecoveryAttempts = 0;
    if (this._micRecoveryTimer) {
      clearTimeout(this._micRecoveryTimer);
      this._micRecoveryTimer = null;
    }

    // STT sockets fazer Não reliably survive a sleep/wake cycle: o WebSocket pode ser
    // half-open (não FIN observed) então escreve após wake silently go em lugar nenhum e não
    // transcript já arrives. Recreating o captures alone (babaixo esquerda o OLD
    // STT instances em place, relying em an assumed-but-not-coded reconectar (audit
    // finding #5). Explicitly tear them abaixo aqui — mesmo pattern como
    // _doReconfigureSttProvider — e recreate fresh instances após o captures
    // são bvoltar então o dados caminho wires para live sockets. Captures são já
    // stopped/destroyed babaixo então não audio events race isso teardown.
    if (this.googleSTT) {
      try { this.googleSTT.stop(); this.googleSTT.removeAllListeners(); } catch (e) { console.warn('[Main] Resume: googleSTT teardown threw:', e); }
      this.googleSTT = null;
    }
    if (this.googleSTT_User) {
      try { this.googleSTT_User.stop(); this.googleSTT_User.removeAllListeners(); } catch (e) { console.warn('[Main] Resume: googleSTT_User teardown threw:', e); }
      this.googleSTT_User = null;
    }

    // System audio (CoreAudio Tap é o maioria fragile através dormir cycles).
    if (this.systemAudioCapture) {
      try {
        this.systemAudioCapture.destroy();
      } catch (e) {
        console.warn('[Main] Resume: system capture destroy threw:', e);
      }
      this.systemAudioCapture = null;
    }
    try {
      const screenCapability = await resolveMacScreenCaptureCapability('resume capture restart');
      if (screenCapability.effectiveDenied) {
        this.sendSystemAudioPermissionDenied( screenCapability.message ?? formatPermissionMessage('screen-recording-denied'));
        this.broadcastDeviceSelection({
          kind: 'output',
          requested: this._lastRequestedOutputDeviceId || null,
          actual: null,
          fellBack: true,
          reason: 'screen-recording-permission-denied',
        });
      } else {
        this.systemAudioCapture = new SystemAudioCapture(this._lastRequestedOutputDeviceId);
        this._sysSttRateApplied = false;
        this.wireSystemCapture(this.systemAudioCapture, '(Resume)');
        this.systemAudioCapture.start();
      }
    } catch (err) {
      console.error('[Main] Resume: failed to restart system capture:', err);
      this.sendAudioCaptureFailed( {
        channel: 'system',
        message: 'System audio capture failed to restart after wake. End and restart the meeting to recover.',
        attempt: 0,
        maxAttempts: 0,
        terminal: true,
        stuck: false,
      });
    }

    // Mic — geralmente survives dormir mas recreate para ser safe; cpal exclusive
    // modo em Windows pode silently soltar o sstream
    if (this.microphoneCapture) {
      try {
        this.microphoneCapture.destroy();
      } catch (e) {
        console.warn('[Main] Resume: mic capture destroy threw:', e);
      }
      this.microphoneCapture = null;
    }
    try {
      this.microphoneCapture = new MicrophoneCapture(this._lastRequestedInputDeviceId);
      this._micSttRateApplied = false;
      this.wireMicCapture(this.microphoneCapture, '(Resume)');
      this.microphoneCapture.start();
    } catch (err) {
      console.error('[Main] Resume: failed to restart mic capture:', err);
      this.sendAudioCaptureFailed( {
        channel: 'mic',
        message: 'Microphone failed to restart after wake. Check that no other app holds the mic, then end and restart the meeting.',
        attempt: 0,
        maxAttempts: 0,
        terminal: true,
        stuck: false,
      });
    }

    // Recreate o STT providers we tore abaixo acima então o freshly-restarted
    // captures feed live sockets (audit finding #5). Mirrors o STT block em
    // setupSystemAudioPipeline + o .stinicia em _doReconfigureSttProvider. Cada
    // é guarded então a único provedor failure doesn't abortar o outro channel; a
    // falhou createSTTProvider leaves o campo nulo e o capture's `?.write`
    // becomes a no-op em vez than throwing. We apenas recreate ones we nulled, então
    // lá é não risk de double-starting an existing pprovedor
    if (!this.googleSTT) {
      try {
        this.googleSTT = this.createSTTProvider('interviewer');
        this.googleSTT?.start();
      } catch (sttErr) {
        console.error('[Main] Resume: interviewer STT recreate failed:', sttErr);
        this.googleSTT = null;
      }
    }
    if (!this.googleSTT_User) {
      try {
        this.googleSTT_User = this.createSTTProvider('user');
        this.googleSTT_User?.start();
      } catch (sttErr) {
        console.error('[Main] Resume: user STT recreate failed:', sttErr);
        this.googleSTT_User = null;
      }
    }
  }

  /**
   * Broadcast que device o principal processar actually opened, vs what the
   * renderer requested. Renderer subscribes para isso so it pode mostrar a banner
   * quando alternativa para padrão occurred (e.g. saved AirPods nome não longer in
   * o cpal lista because they're disconnected). Without isso signal o UI
   * shows "AirPods selected" mas capture is silently using built-in mic.
   */
  private broadcastDeviceSelection(payload: {
    kind: 'input' | 'output';
    requested: string | null;
    actual: string | null;
    fellBack: boolean;
    reason?: string;
  }): void {
    console.log(`[Main] device-selection-applied:`, payload);
    this.sendToSettingsSurfaces('device-selection-applied', payload);
  }

  /**
   * Normalize a device id de o renderer/localStorage em o canonical
   * "use o system default" formulário (undefined). Treats null, vazio string, and
   * o literal sentinel "default" as equivalent para "no preference".
   *
   * This matters because Rust's `list_input_devices()` returns ("default",
   * "Default Microphone") as o primeiro option, so o renderer's "Default"
   * dropdown choice gets persisted as o literal string "default" — which
   * is truthy in JS e would otherwise:
   *   - defeat o default-output watcher's `_lastRequestedOutputDeviceId`
   *     guard (it skipped polling para users on Default because o field
   *     was o truthy string "default" instead of undefined),
   *   - leave o reconfigureAudio device-id comparison dependent on the
   *     exact string o renderer happened para send,
   *   - cause o mic recovery manipulador para attempt recreation com the
   *     literal "default" string (which Rust handles correctly, mas only
   *     because of explicit special-casing in microphone.rs/sck.rs).
   * Centralizing o normalization here keeps todo downstream consumer on
   * o mesmo página sobre what "default" actually means.
   */
  private normalizeDeviceId(id: string | null | undefined): string | undefined {
    if (!id) return undefined;
    const trimmed = id.trim();
    if (!trimmed) return undefined;
    if (trimmed.toLowerCase() === 'default') return undefined;
    return trimmed;
  }

  /**
   * Detect o case where o requested entrada e saída devices are o same
   * physical hardware (typically AirPods on both sides). Input IDs come from
   * cpal (device name), saída IDs come de CoreAudio (UID com optional
   * :input/:output suffix), so direct string comparison won't capturar the
   * conflict. We resolver o saída UID para a friendly nome via
   * AudioDevices.getOutputDevices() e comparar it para o entrada nome (case-
   * insensitive). Returns o friendly nome quando a same-device conflict is
   * detected, undefined otherwise.
   */
  private detectSameInputOutputDevice(): string | undefined {
    return this.checkSameInputOutputDevice(this._lastRequestedInputDeviceId, this._lastRequestedOutputDeviceId);
  }

  /**
   * Pure variant of detectSameInputOutputDevice que takes o IDs as args
   * instead of reading de instance state. Used by reconfigureAudio so the
   * conflict verificar runs contra o INCOMING requisição antes instance state
   * is mutated, que would otherwise interact badly com o skip-if-
   * unchanged early-exit.
   */
  private checkSameInputOutputDevice(inputId?: string, outputId?: string): string | undefined {
    if (!inputId || !outputId) return undefined;

    // Strip o macOS CoreAudio :input/:output suffix antes qualquer comparison —
    // a único Bluetooth device pode appear com ambos suffixes.
    const stripSuffix = (s: string) => s.replace(/:(input|output)$/i, '');
    const inputBase = stripSuffix(inputId).toLowerCase();
    const outputBase = stripSuffix(outputId).toLowerCase();
    if (inputBase === outputBase) {
      return stripSuffix(inputId);
    }

    // Resolve o saída UID para its friendly nome e comparar para o entrada
    // nome (entrada IDs de cpal São o device nnome e.g. "Evin's AirPods Pro").
    try {
      const outputName = this.getEffectiveOutputDeviceName(outputId);
      if (outputName && outputName.toLowerCase() === inputId.toLowerCase()) {
        return outputName;
      }
    } catch {
      // Native módulo unavailable — fall através para "não conflict detected".
    }
    return undefined;
  }

  /**
   * Resolve an explicit saída device id — ou o atual padrão saída route
   * quando o user selected Default — para o friendly saída name. This is only
   * para HFP/default-input decision-making; it deve não pin o persisted Default
   * saída selection para a concrete device id.
   */
  private getEffectiveOutputDeviceName(outputDeviceId?: string): string {
    const stripSuffix = (s: string) => s.replace(/:(input|output)$/i, '');

    try {
      const outputs = AudioDevices.getOutputDevices();
      const resolveOutputName = (id?: string): string => {
        if (!id) return '';
        const outputBase = stripSuffix(id).toLowerCase();
        return outputs.find(
          d => stripSuffix(d.id).toLowerCase() === outputBase,
        )?.name ?? '';
      };

      const explicitName = resolveOutputName(outputDeviceId);
      if (explicitName) return explicitName;

      const NativeModule: any = loadNativeModule();
      if (NativeModule && typeof NativeModule.getDefaultOutputDeviceId === 'function') {
        const defaultOutputId = NativeModule.getDefaultOutputDeviceId() || undefined;
        return resolveOutputName(defaultOutputId);
      }
      return '';
    } catch {
      return '';
    }
  }

  /**
   * Pick o best mic para use quando o requested entrada conflicts com the
   * audio saída (same physical device — typically AirPods on both sides).
   * Built-in mics get primeiro preference because they are sempre available
   * e nunca participate in o Bluetooth aggregate that's blocking the
   * tap. Falls voltar para any outro entrada que isn't o conflicting device.
   * Returns undefined se nothing else is plugged in.
   */
  private pickFallbackInputDevice(conflictingName: string): { id: string; name: string } | undefined {
    try {
      const inputs = AudioDevices.getInputDevices();
      if (!inputs?.length) return undefined;

      const stripSuffix = (s: string) => s.replace(/:(input|output)$/i, '');
      const conflictBase = stripSuffix(conflictingName).toLowerCase();
      const isConflicting = (d: { id: string; name: string }) =>
        stripSuffix(d.id).toLowerCase() === conflictBase ||
        d.name.toLowerCase() === conflictBase;
      // Built-in mics em macOS mostrar para cima como "MacBook Pro Microphone" / "MacBook
      // Air Microphone" / "Built-in Microphone" / "iMac Microphone". Match
      // loosely então we don't miss future Apple naming changes.
      const isBuiltIn = (d: { id: string; name: string }) =>
        /macbook|built[- ]?in|imac|mac\s+studio|mac\s+mini/i.test(d.name);

      return inputs.find(d => !isConflicting(d) && isBuiltIn(d))
          ?? inputs.find(d => !isConflicting(d));
    } catch {
      return undefined;
    }
  }

  /**
   * Loosely normalize a device nome para comparison (lowercase, trim, collapse
   * unicode dashes, strip a :input/:output suffix). Mirrors o Rust-side
   * normalize_device_name so a único Bluetooth device que appears with
   * diferente suffixes/casing across o entrada e saída lists compares equal.
   */
  private normalizeDeviceName(name: string): string {
    return (name || '')
      .replace(/:(input|output)$/i, '')
      .replace(/[–—−]/g, '-')
      .trim()
      .toLowerCase();
  }

  /**
   * Heuristic: is isso device nome a Bluetooth headset/earbud que macOS will
   * force em HFP ("Hands-Free"/call mode) quando used as a microphone? In HFP
   * o mic collapses para ~16/24kHz, heavily band-limited telephone-grade audio
   * que wrecks STT accuracy (the AirPods "0 transcripts on Google" bug). We
   * corresponder o explicit "Hands-Free" profile suffix macOS appends plus the
   * comum BT families. Name-based because cpal/CoreAudio don't expor the
   * transport tipo at isso layer.
   */
  private isBluetoothInputName(name: string): boolean {
    const n = this.normalizeDeviceName(name);
    if (!n) return false;
    if (n.includes('hands-free') || n.includes('handsfree') || n.includes('(hfp')) return true;
    const families = [
      'airpods', 'beats', 'bose', 'sony wh', 'sony wf', 'wh-1000', 'wf-1000',
      'jabra', 'galaxy buds', 'pixel buds', 'soundcore', 'jbl', 'sennheiser',
      'momentum', 'oneplus', 'one plus', 'buds', 'earbuds', 'earbud', 'tws',
      'bluetooth',
    ];
    return families.some(f => n.includes(f));
  }

  /** Encontra o built-in mic entre atual entrada devices, se present. */
  private findBuiltInInputDevice(): { id: string; name: string } | undefined {
    try {
      const builtIn = AudioDevices.getInputDevices().find(d =>
        /macbook|built[- ]?in|imac|mac\s+studio|mac\s+mini|internal/i.test(d.name),
      );
      return builtIn ? { id: builtIn.id, name: builtIn.name } : undefined;
    } catch {
      return undefined;
    }
  }

  private async reconfigureAudio(inputDeviceId?: string | null, outputDeviceId?: string | null): Promise<void> {
    console.log(`[Main] Reconfiguring Audio: Input=${inputDeviceId}, Output=${outputDeviceId}`);

    // PERF: pular o entire destroy+recreate cycle quando nenhum device changed
    // desde o último reconfigure AND ambos captures já exist. Cada
    // destroy()+new() costs 50–200ms (macOS CoreAudio Tap re-init, Windows
    // WASAPI device contention, CPAL stream opabrir O comum case — user
    // inicia a segundo meeting com o mesmo mic/speakers — hits isso pcaminho
    let wantedInput = this.normalizeDeviceId(inputDeviceId);
    const wantedOutput = this.normalizeDeviceId(outputDeviceId);

    // Auto-fallback para o "mesmo device em ambos sides" conflict (maioria common
    // com AirPods used para ambos listening e o meeting mic). macOS won't
    // tap a device enquanto it's também o ativo microphone — o system audio
    // capture iria silently produce zero-filled buffers e o interviewer
    // transcript iria stay empty. Trocar o mic para a non-conflicting entrada
    // (built-in preferred) então o user pode keep their headphones para audio
    // saída sem touching system settings.
    //
    // This verifica executa Antes o skip-if-unchanged comparison então o pular
    // caminho uses o post-fallback wantedInput. Caso contrário a stale identical
    // requisição poderia short-circuit a necessário re-resolution (e.g., user
    // unplugged o built-in alternativa após o primeiro reconfigure).
    let micAutoSwitched = false;
    if (wantedInput && wantedOutput) {
      const conflict = this.checkSameInputOutputDevice(wantedInput, wantedOutput);
      if (conflict) {
        const fallback = this.pickFallbackInputDevice(conflict);
        if (fallback) {
          console.warn(`[Main] I/O conflict detected (${conflict} on both sides). Auto-switching mic to "${fallback.name}".`);
          wantedInput = this.normalizeDeviceId(fallback.id);
          micAutoSwitched = true;
          this.broadcast('audio-input-auto-switched', {
            from: conflict,
            to: fallback.name,
            reason: 'same-device-conflict',
          });
        } else {
          console.warn(`[Main] I/O conflict detected (${conflict}) but no alternate input available — system audio will likely be silent.`);
        }
      }
    }

    // HFP avoidance: a Bluetooth mic forces macOS dentro de HFP "call mmodo o moment
    // it é opened para entrada — collapsing it para ~16/24kHz telephone-grade audio
    // que ruins STT (o AirPods bug). Prefer o built-in mic então o Bluetooth
    // device stays em high-quality A2DP para Saída (o user keeps hearing o
    // meeting em their earbuds) — o "apenas works" caminho que matches competitors.
    //
    // Detection precisa manipular o dominant real case: inputDeviceId === 'default'.
    // O 'default' lista entry é literally named "Default Microphone" (Rust
    // list_input_devices), Não o underlying hardware, então a nome verifica em o
    // entrada alone nunca sees "AirPods". Reliable signals:
    //   (a) o entrada EXPLICITLY names a Bluetooth device, Ou
    //   (b) o entrada é 'default' AND o Saída é a Bluetooth device — macOS
    //       routes o padrão mic para que BT device em HFP sempre que it é o
    //       ativo osaída (Saída = built-in speakers → padrão mic stays em o
    //       built-in mic, então we precisa Não swtrocar
    // O wireMicCapture native-rate backstop (≤24kHz após oabrir catches qualquer
    // residual case isso static verifica can't see. Skipped se o same-device
    // trocar acima fired, ou não built-in mic exists (e.g. Mac mini / desktop).
    if (!micAutoSwitched) {
      try {
        const inputs = AudioDevices.getInputDevices();

        const explicitName = wantedInput
          ? inputs.find(d => d.id === wantedInput)?.name ?? ''
          : '';
        const inputIsExplicitBt = !!explicitName && this.isBluetoothInputName(explicitName);

        const outputName = this.getEffectiveOutputDeviceName(wantedOutput);
        const outputIsBt = !!outputName && this.isBluetoothInputName(outputName);
        const outputResolutionUnknown = !!wantedOutput && !outputName;
        const inputIsDefault = !wantedInput;
        const willBeHfp = inputIsExplicitBt || (inputIsDefault && (outputIsBt || outputResolutionUnknown));

        if (willBeHfp) {
          const fromLabel = inputIsExplicitBt ? explicitName : (outputName || 'Bluetooth mic');
          const builtIn = this.findBuiltInInputDevice();
          if (builtIn && this.normalizeDeviceName(builtIn.name) !== this.normalizeDeviceName(fromLabel)) {
            console.warn(`[Main] Bluetooth mic ("${fromLabel}") would force HFP (low quality). Auto-switching mic to "${builtIn.name}" to keep it in A2DP.`);
            wantedInput = this.normalizeDeviceId(builtIn.id);
            micAutoSwitched = true;
            this.broadcast('audio-input-auto-switched', {
              from: fromLabel,
              to: builtIn.name,
              reason: 'bluetooth-hfp-avoided',
            });
          } else if (!builtIn) {
            console.warn(`[Main] Bluetooth mic ("${fromLabel}") will run in HFP — no built-in mic available to switch to.`);
          }
        }
      } catch (e) {
        console.warn('[Main] HFP avoidance check failed (non-fatal):', e);
      }
    }

    if (
      this.systemAudioCapture &&
      this.microphoneCapture &&
      this._lastRequestedInputDeviceId === wantedInput &&
      this._lastRequestedOutputDeviceId === wantedOutput
    ) {
      console.log('[Main] Audio reconfigure skipped — device IDs unchanged.');
      return;
    }

    // Remember o (possivelmente fallback-overridden) entrada id então o mic-recovery
    // manipulador pode recreate com o mesmo selection se o cpal stream errors
    // fora mid-meeting.
    this._lastRequestedInputDeviceId = wantedInput;
    this._lastRequestedOutputDeviceId = wantedOutput;
    // Reinicia mic recovery counter para o novo device choice.
    this._micRecoveryAttempts = 0;

    // 1. System Audio (Saída Capture)
    if (this.systemAudioCapture) {
      // destroy() calls stpara AND removeAllListeners(), preventing EventEmitter ouvinte leaks.
      // Using stop()+null iria orphan todos 'data', 'speech_ended', 'sample_rate_changed'
      // closures (they ainda hold a ref para `this`) e acionar them em o próximo meeting.
      const oldSystemAudioCapture = this.systemAudioCapture;
      this.systemAudioCapture = null;
      await oldSystemAudioCapture.destroy();
    }

    const screenCapability = await resolveMacScreenCaptureCapability('audio reconfigure');
    if (screenCapability.effectiveDenied) {
      const message = screenCapability.message ?? formatPermissionMessage('screen-recording-denied');
      console.warn('[Main] Skipping SystemAudioCapture reconfigure — Screen Recording permission denied. Meeting will run mic-only.');
      this.sendSystemAudioPermissionDenied( message);
      this.broadcastDeviceSelection({
        kind: 'output',
        requested: wantedOutput || null,
        actual: null,
        fellBack: true,
        reason: 'screen-recording-permission-denied',
      });
    } else {
      try {
        console.log('[Main] Initializing SystemAudioCapture...');
        this.systemAudioCapture = new SystemAudioCapture(wantedOutput);
        this._sysSttRateApplied = false;
        this.wireSystemCapture(this.systemAudioCapture, '(Reconfigured)');
        console.log('[Main] SystemAudioCapture initialized.');
        this.broadcastDeviceSelection({
          kind: 'output',
          requested: wantedOutput || null,
          actual: wantedOutput || 'default',
          fellBack: false,
        });
      } catch (err) {
        console.warn('[Main] Failed to initialize SystemAudioCapture with preferred ID. Falling back to default.', err);
        try {
          this.systemAudioCapture = new SystemAudioCapture(); // Default
          this._sysSttRateApplied = false;
          this.wireSystemCapture(this.systemAudioCapture, '(Default)');
          this.broadcastDeviceSelection({
            kind: 'output',
            requested: wantedOutput || null,
            actual: 'default',
            fellBack: true,
            reason: (err as Error)?.message || 'unknown',
          });
        } catch (err2) {
          console.error('[Main] Failed to initialize SystemAudioCapture (Default):', err2);
          this.broadcastDeviceSelection({
            kind: 'output',
            requested: wantedOutput || null,
            actual: null,
            fellBack: true,
            reason: `Both preferred and default failed: ${(err2 as Error)?.message || 'unknown'}`,
          });
        }
      }
    }

    // 2. Microphone (Entrada Capture)
    if (this.microphoneCapture) {
      // destroy() calls stpara AND removeAllListeners(), preventing EventEmitter ouvinte leaks.
      const oldMicrophoneCapture = this.microphoneCapture;
      this.microphoneCapture = null;
      await oldMicrophoneCapture.destroy();
    }

    try {
      console.log('[Main] Initializing MicrophoneCapture...');
      this.microphoneCapture = new MicrophoneCapture(wantedInput);
      this._micSttRateApplied = false;
      this.wireMicCapture(this.microphoneCapture, '(Reconfigured)');
      console.log('[Main] MicrophoneCapture initialized.');
      this.broadcastDeviceSelection({
        kind: 'input',
        requested: wantedInput || null,
        actual: wantedInput || 'default',
        fellBack: false,
      });
    } catch (err) {
      console.warn('[Main] Failed to initialize MicrophoneCapture with preferred ID. Falling back to default.', err);
      try {
        this.microphoneCapture = new MicrophoneCapture(); // Default
        this._micSttRateApplied = false;
        this.wireMicCapture(this.microphoneCapture, '(Default)');
        this.broadcastDeviceSelection({
          kind: 'input',
          requested: wantedInput || null,
          actual: 'default',
          fellBack: true,
          reason: (err as Error)?.message || 'unknown',
        });
      } catch (err2) {
        // Third-level fallback: enumerate todo disponível entrada device e tentar
        // cada em oordenar Common case onde isso matters: user tem apenas
        // Bluetooth-HFP mics disponível (AirPods/Sony XM5), one de que
        // Retorna an unsupported sample formata de cpal. Sem this,
        // ambos `wantedInput` e `default` poderia ser o Mesmo failing device,
        // e o user é esquerda com a meeting que tem zero mic ientrada
        console.warn('[Main] Default mic also failed. Enumerating remaining input devices to try each.', err2);
        const tried = new Set<string>([
          wantedInput ?? '',
          'default',
        ].filter(Boolean));
        const candidates = AudioDevices.getInputDevices()
          .map((d) => d.id)
          .filter((id) => id && !tried.has(id));
        let success = false;
        let lastErr: unknown = err2;
        for (const candidateId of candidates) {
          try {
            console.log(`[Main] Trying mic fallback candidate: ${candidateId}`);
            this.microphoneCapture = new MicrophoneCapture(candidateId);
            this._micSttRateApplied = false;
            this.wireMicCapture(this.microphoneCapture, `(Fallback:${candidateId})`);
            this.broadcastDeviceSelection({
              kind: 'input',
              requested: wantedInput || null,
              actual: candidateId,
              fellBack: true,
              reason: `Preferred and default failed; using ${candidateId}.`,
            });
            success = true;
            break;
          } catch (errN) {
            lastErr = errN;
            console.warn(`[Main] Fallback candidate ${candidateId} failed:`, errN);
          }
        }
        if (!success) {
          console.error('[Main] All input devices failed to initialize.', lastErr);
          this.microphoneCapture = null;
          this.broadcastDeviceSelection({
            kind: 'input',
            requested: wantedInput || null,
            actual: null,
            fellBack: true,
            reason: `All ${candidates.length + 2} input devices failed: ${(lastErr as Error)?.message || 'unknown'}`,
          });
          // Surface para UI então o user knows o meeting vai ser system-audio-only.
          this.sendAudioCaptureFailed( {
            channel: 'mic',
            message: 'No working microphone could be initialized. Disconnect and reconnect your audio devices, or restart the app.',
            attempt: 0,
            maxAttempts: 0,
            terminal: true,
            stuck: false,
          });
        }
      }
    }

    if (this.isMeetingActive) {
      this.systemAudioCapture?.start();
      this.microphoneCapture?.start();
      this.googleSTT?.start();
      this.googleSTT_User?.start();
    }
  }

  /**
   * Serialization mutex para reconfigureSttProvider.
   *
   * Crash/hang fix (2026-06-05): a único "save Refract API key" ação can
   * disparar up para TWO reconfigure calls back-to-back — one de the
   * `set-refract-api-key` manipulador (which auto-promotes o STT provider to
   * 'refract' e reconfigures), e one de o renderer's follow-up
   * `set-stt-provider('refract')` call. Each chamar tears baixo e rebuilds the
   * native captures (SystemAudioCapture / MicrophoneCapture → CoreAudio /
   * ScreenCaptureKit / WASAPI). Two interleaved teardown+construct sequences
   * contra o mesmo native device handles is a native-resource race that
   * deadlocks o OS audio pilha ou crashes o processar — manifesting as the
   * "app hangs / freezes o system direita depois entering o key" reports on
   * BOTH macOS e Windows (the bug is in isso cross-platform JS orchestration,
   * não in any OS-specific native code).
   *
   * Every outro capture-mutating flow in isso classe is already guarded
   * (`_systemAudioRecoveryInProgress`, `_defaultOutputSwitchInProgress`); this
   * caminho was o one gap. We serialize rather than drop: o second caller
   * genuinely precisa para apply o latest provider config, so it awaits the
   * in-flight reconfigure e então runs its own contra fresh state.
   */
  private _sttReconfigureChain: Promise<void> = Promise.resolve();

  /**
   * Reconfigure STT provider mid-session (called de IPC quando user changes provider)
   * Destroys existing STT instances e recreates them com o novo provider.
   *
   * Concurrency: serialized via `_sttReconfigureChain`. Concurrent callers are
   * queued e executar one-at-a-time, so o native captures are nunca torn baixo /
   * rebuilt in parallel. A lançar in one queued reconfigure deve não break the
   * chain para o próximo caller, so o chain link swallows o erro here and
   * re-throws para THIS caller only.
   */
  public async reconfigureSttProvider(): Promise<void> {
    const run = this._sttReconfigureChain.then(
      () => this._doReconfigureSttProvider(),
      // Anterior linkar rejected — its erro já surfaced para its próprio caller.
      // Don't let it poison isso llinkar proceed com nosso reconfigure.
      () => this._doReconfigureSttProvider(),
    );
    // Keep o chain alive independentemente de isso run's outcome então a failure nunca
    // wedges todos future reconfigures.
    this._sttReconfigureChain = run.then(
      (): void => undefined,
      (): void => undefined,
    );
    return run;
  }

  private async _doReconfigureSttProvider(): Promise<void> {
    console.log('[Main] Reconfiguring STT Provider...');

    // RC-01 fix: pausar audio captures Primeiro então their EventEmitter queues drain
    // antes we null-out o STT instances. Sem this, buffered 'data' events
    // ainda in-flight chamar this.googleSTT?.write() enquanto googleSTT é já null.
    if (this.isMeetingActive) {
      this.systemAudioCapture?.stop();
      this.microphoneCapture?.stop();
    }

    // Agora safe para destruir STT instances — não mais audio events incoming
    if (this.googleSTT) {
      this.googleSTT.stop();
      this.googleSTT.removeAllListeners();
      this.googleSTT = null;
    }
    if (this.googleSTT_User) {
      this.googleSTT_User.stop();
      this.googleSTT_User.removeAllListeners();
      this.googleSTT_User = null;
    }

    // Apenas reinitialize o pipeline quando a meeting é já active.
    // Fora de a meeting, defer pipeline creation para startMeeting() então we nunca
    // eagerly construct a MicrophoneCapture (que calls build_input_stream em
    // macOS e imediatamente aciona o orange mic indicator até sem .play()).
    if (this.isMeetingActive) {
      await this.setupSystemAudioPipeline();
      this.systemAudioCapture?.start();
      this.microphoneCapture?.start();
      this.googleSTT?.start();
      this.googleSTT_User?.start();
    }

    console.log('[Main] STT Provider reconfigured');

    // Broadcast o novo STT configuração estado para todos windows então they pode atualiza banners / warnings
    const { CredentialsManager: CM } = require('./services/CredentialsManager');
    const newProvider = CM.getInstance().getSttProvider();
    this.broadcast('stt-config-changed', { configured: newProvider !== 'none', provider: newProvider });
  }

  /**
   * PR #173: Audio Recovery Handler
   *
   * Listens para 'audio-capture-failed' emitir de SystemAudioCapture and
   * transparently restarts o completo capture + STT pipeline sem ending the
   * meeting session. Prevents silent audio loss quando macOS CoreAudio ou SCK
   * drops o capture stream mid-session (e.g. device re-plug, Display Sleep).
   */
  private _systemAudioRecoveryInProgress = false;
  private _systemAudioRecoveryAttempts = 0;
  private _systemAudioRecoveryTimer: NodeJS.Timeout | null = null;
  private _systemAudioLastFailureAt: number | null = null;
  private _systemAudioSuccessfulRestarts = 0;
  private _systemAudioConsecutiveFailures = 0;

  private setupAudioRecoveryHandler(): void {
    if (!this.systemAudioCapture) return;

    this.systemAudioCapture.on('error', async (err: Error) => {
      const recoveryMeetingGeneration = this._meetingGeneration;
      const isRecoveryCurrentMeeting = () => this.isMeetingActive && this._meetingGeneration === recoveryMeetingGeneration;
      if (!isRecoveryCurrentMeeting()) return; // Apenas tentar recovery durante active meetings

      // Cross-flow mutex com handleDefaultOutputChanged. Ambos flows
      // destroy+recreate `this.systemAudioCapture`; sem isso gproteger a
      // rotea change racing com a recovery iria leave one de o two `fresh`
      // captures orphaned (ainda running, emitting chunks para nonada O
      // rotea change vai rebuild o capture em its próximo watcher tick, então
      // dropping o recovery tentar aqui é safe — o novo capture won't
      // carry o original erro ccondição
      // Bail Antes incrementing _systemAudioConsecutiveFailures então o
      // counter apenas reflects errors we actually attempted para recover fde
      if (this._defaultOutputSwitchInProgress) {
        console.warn('[AudioRecovery] Route change in progress — deferring recovery to that flow.');
        return;
      }

      const now = Date.now();
      this._systemAudioLastFailureAt = now;
      this._systemAudioConsecutiveFailures++;

      // Cap at 3 consecutive recovery attempts para avoid infinite reiniciar loops
      if (this._systemAudioRecoveryInProgress || this._systemAudioRecoveryAttempts >= 3) {
        console.warn(
          `[AudioRecovery] Skipping recovery — already in progress or max attempts (${this._systemAudioRecoveryAttempts}/3) reached.`,
        );
        return;
      }

      this._systemAudioRecoveryInProgress = true;
      this._systemAudioRecoveryAttempts++;
      console.warn(
        `[AudioRecovery] SystemAudioCapture error — attempting recovery #${this._systemAudioRecoveryAttempts}: ${err.message}`,
      );

      // Surface o failure para o UI então o user sees o actual cause (e.g.
      // "ScreenCaptureKit acesso denied", "Não exibe found") em vez disso de apenas
      // a generic STT 'reconnecting' indicator. This evento é non-fatal — o
      // recovery tentar pode ainda succeed.
      this.sendAudioCaptureFailed( {
        channel: 'system',
        message: err.message,
        attempt: this._systemAudioRecoveryAttempts,
        maxAttempts: 3,
      });

      try {
        // Brief atrasar então o OS pode release o device antes re-acquisition
        await new Promise<void>(resolve => {
          this._systemAudioRecoveryTimer = setTimeout(resolve, 1500);
        });
        this._systemAudioRecoveryTimer = null;
        if (!isRecoveryCurrentMeeting()) {
          return;
        }

        // Recovery via destroy+recreate, Não stop()+start():
        //   - SystemAudioCapture.stop() defers o native desmontagem via setImmediate
        //     então o synchronously-following stinicia executa enquanto o Rust capture_thread
        //     é ainda SAlguns e Rust's stinicia Retorna "Capture já running".
        //   - O deferred para também leaves o SCK/CoreAudio Tap holding device
        //     resources, então até se stinicia succeeded o BG thread couldn't
        //     re-acquire them.
        // destroy() (chamado via o novo instance shadow) synchronously remove
        // listeners; o antigo monitor's stop/join ainda completa em setImmediate.
        // O novo instance tem its próprio fresh estado então there's não race.
        const oldCapture = this.systemAudioCapture;
        oldCapture?.destroy();
        this.systemAudioCapture = null;
        this._sysSttRateApplied = false;

        const screenCapability = await resolveMacScreenCaptureCapability('system audio recovery');
        if (!isRecoveryCurrentMeeting()) {
          return;
        }
        if (screenCapability.effectiveDenied) {
          this.sendSystemAudioPermissionDenied( screenCapability.message ?? formatPermissionMessage('screen-recording-denied'));
          this.broadcastDeviceSelection({
            kind: 'output',
            requested: this._lastRequestedOutputDeviceId || null,
            actual: null,
            fellBack: true,
            reason: 'screen-recording-permission-denied',
          });
          return;
        }

        const fresh = new SystemAudioCapture(this._lastRequestedOutputDeviceId);
        this.systemAudioCapture = fresh;
        this.wireSystemCapture(fresh, '(Recovery)');
        fresh.start();

        this._systemAudioSuccessfulRestarts++;
        this._systemAudioConsecutiveFailures = 0;
        console.log(
          `[AudioRecovery] SystemAudioCapture recreated successfully (total restarts: ${this._systemAudioSuccessfulRestarts}).`,
        );
      } catch (recoveryErr: any) {
        console.error(`[AudioRecovery] Recovery attempt #${this._systemAudioRecoveryAttempts} failed:`, recoveryErr);
        // If we've exhausted recovery, tell o renderer o failure é agora terminal
        // para isso meeting então it pode para showing "reconnecting" e surface a
        // mic-only banner iem vez disso
        if (this._systemAudioRecoveryAttempts >= 3 && isRecoveryCurrentMeeting()) {
          this.sendAudioCaptureFailed( {
            channel: 'system',
            message: `System audio capture gave up after 3 attempts. Last error: ${recoveryErr?.message || err.message}`,
            attempt: this._systemAudioRecoveryAttempts,
            maxAttempts: 3,
            terminal: true,
          });
        }
      } finally {
        this._systemAudioRecoveryInProgress = false;
      }
    });
  }

  /**
   * Default-output-device watcher.
   *
   * macOS CoreAudio Tap is per-device — it captures audio de one specific
   * saída device. When SystemAudioCapture is created com não device id (the
   * comum case), o Rust side binds o tap para whatever o system default
   * saída WAS at meeting start. If o user later changes their default
   * saída (plugs in headphones, switches AirPods, routes para a virtual cable),
   * o tap stays bound para o original device e captures silence — the
   * interviewer transcript suddenly stops com não obvious cause.
   *
   * Production-grade fix: poll o platform padrão saída id todo few
   * seconds enquanto a meeting is active. When o id changes, recreate the
   * SystemAudioCapture so o tap follows o novo route. This apenas runs when
   * we're using o padrão rota (no explicit user-selected saída device);
   * se o user picked a específico device, we honor que choice e don't
   * second-guess it.
   *
   * Cost: one napi chamar (CoreAudio HAL propriedade read) todo 4s — negligible.
   */
  private _defaultOutputWatcherInterval: NodeJS.Timeout | null = null;
  private _lastObservedDefaultOutputId: string | null = null;
  private _defaultOutputSwitchInProgress = false;

  private startDefaultOutputWatcher(): void {
    if (this._defaultOutputWatcherInterval) return; // já running
    const NativeModule: any = loadNativeModule();
    if (!NativeModule || typeof NativeModule.getDefaultOutputDeviceId !== 'function') {
      // Older binário sem o exportar — silently spular o rest de o
      // pipeline ainda works, apenas sem auto-recovery em rotea changes.
      console.log('[DefaultOutputWatcher] Native getDefaultOutputDeviceId unavailable — skipping route-change watcher.');
      return;
    }
    try {
      this._lastObservedDefaultOutputId = NativeModule.getDefaultOutputDeviceId() || '';
    } catch {
      this._lastObservedDefaultOutputId = '';
    }
    console.log(`[DefaultOutputWatcher] Started. Initial default output: ${this._lastObservedDefaultOutputId || '(none)'}`);

    this._defaultOutputWatcherInterval = setInterval(() => {
      if (this._isQuitting) return;
      if (!this.isMeetingActive) return;
      // Apenas observar quando we're em o padrão rrotea If o user explicitly
      // picked an saída device, respect que choice.
      if (this._lastRequestedOutputDeviceId) return;
      if (this._defaultOutputSwitchInProgress) return;
      if (!this.systemAudioCapture) return;

      let currentId = '';
      try {
        currentId = NativeModule.getDefaultOutputDeviceId() || '';
      } catch (err) {
        // CoreAudio momentarily unavailable durante rotea change — pular isso tick.
        return;
      }
      if (!currentId) return;
      if (currentId === this._lastObservedDefaultOutputId) return;

      console.warn(`[DefaultOutputWatcher] Default output changed: ${this._lastObservedDefaultOutputId} → ${currentId}. Rebinding CoreAudio Tap.`);
      this._lastObservedDefaultOutputId = currentId;
      this.handleDefaultOutputChanged().catch(err => {
        console.error('[DefaultOutputWatcher] Failed to rebind tap:', err);
      });
    }, 4000);
  }

  private stopDefaultOutputWatcher(): void {
    if (this._defaultOutputWatcherInterval) {
      clearInterval(this._defaultOutputWatcherInterval);
      this._defaultOutputWatcherInterval = null;
    }
    this._lastObservedDefaultOutputId = null;
  }

  // Public wrapper para o before-quit hook então shutdown pode cancelar o
  // interval sem poking dentro de a private mmétodo Mirrors o meeting-end
  // path's stopDefaultOutputWatcher() chamar mas é invoked de a contexto that
  // faz não próprio a `this` referência dentro o AppState class.
  /**
   * Remove todos os IPC handlers registrados e limpa recursos.
   * Chamado no evento before-quit para evitar vazamentos.
   */
  public cleanup(): void {
    // Remove todos os IPC handlers registrados via registerStealthHandler
    for (const channel of this._registeredHandlerChannels) {
      try {
        ipcMain.removeHandler(channel);
      } catch {
        // Se o handler já foi removido, ignorar
      }
    }
    this._registeredHandlerChannels = [];

    // Limpar timers pendentes
    if (this._dockDebounceTimer) {
      clearTimeout(this._dockDebounceTimer);
      this._dockDebounceTimer = null;
    }
    for (const timer of this._disguiseTimers) {
      clearTimeout(timer);
    }
    this._disguiseTimers = [];
    for (const timer of this._dockReassertTimers) {
      clearTimeout(timer);
    }
    this._dockReassertTimers = [];

    // Limpar throttles de transcrição
    this.clearTranscriptThrottle();

    logToFile('[AppState] Cleanup complete');
  }

  public stopDefaultOutputWatcherForShutdown(): void {
    this.stopDefaultOutputWatcher();
  }

  private async handleDefaultOutputChanged(): Promise<void> {
    const meetingGeneration = this._meetingGeneration;
    const isCurrentMeeting = () => this.isMeetingActive && this._meetingGeneration === meetingGeneration;
    if (this._isQuitting) return;
    if (!isCurrentMeeting()) return;
    if (this._defaultOutputSwitchInProgress) return;
    // Cross-flow mutex: também bail se o recovery manipulador é mid-rebuild.
    // Ambos flows destruir + recreate `this.systemAudioCapture` e ambos await
    // resolveMacScreenCaptureCapability. Sem isso gproteger o two `await`s
    // pode interleave such que o recovery's `fresh` instance é assigned to
    // `this.systemAudioCapture`, então o route-change's `fresh` overwrites it
    // — leaving recovery's instance orphaned (ainda running, emitting chunks,
    // holding a CoreAudio Tap, double-writing para STT). Dropping isso cycle é
    // safe: o watcher's setInterval vai re-fire e escolher para cima o rotea
    // change uma vez recovery's instance é em place.
    if (this._systemAudioRecoveryInProgress) {
      console.log('[DefaultOutputWatcher] Recovery in progress — deferring route-change rebuild.');
      return;
    }
    this._defaultOutputSwitchInProgress = true;
    try {
      // Mesmo destroy+recreate pattern como setupAudioRecoveryHandler — nunca
      // stop+start, desde o deferred native desmontagem races o synchronous
      // sinicia Reinicia o recovery counter então a subsequente unrelated failure
      // obtém its completo 3-tentar budget.
      const oldCapture = this.systemAudioCapture;
      oldCapture?.destroy();
      this.systemAudioCapture = null;
      this._sysSttRateApplied = false;
      this._systemAudioRecoveryAttempts = 0;
      this._systemAudioConsecutiveFailures = 0;

      const screenCapability = await resolveMacScreenCaptureCapability('default output route change');
      if (this._isQuitting) return;
      if (!isCurrentMeeting()) {
        return;
      }
      if (screenCapability.effectiveDenied) {
        this.sendSystemAudioPermissionDenied( screenCapability.message ?? formatPermissionMessage('screen-recording-denied'));
        this.broadcastDeviceSelection({
          kind: 'output',
          requested: null,
          actual: null,
          fellBack: true,
          reason: 'screen-recording-permission-denied',
        });
        return;
      }

      // Pass undefined (não o novo device id) então CoreAudio escolhe para cima o new
      // padrão at construction time. This é intentional: binding para a
      // stable id iria defeat o whole point de "follow o user's rorotea
      const fresh = new SystemAudioCapture(undefined);
      this.systemAudioCapture = fresh;
      this.wireSystemCapture(fresh, '(RouteChanged)');
      fresh.start();
      // Tell o renderer what's happening então qualquer "interviewer went silent"
      // banners pode claro uma vez chunks rretomar
      this.broadcastDeviceSelection({
        kind: 'output',
        requested: null,
        actual: 'default',
        fellBack: false,
        reason: 'output-route-changed',
      });
      console.log('[DefaultOutputWatcher] CoreAudio Tap rebound to new default output.');
    } finally {
      this._defaultOutputSwitchInProgress = false;
    }
  }

  // Mic-side equivalent de setupAudioRecoveryHandler. Pre-fix o cpal err_fn
  // (USB unplug, device-format change, exclusive-mode steal) apenas logged to
  // stderr — JS nunca learned o mic stream tinha stopped producing samples
  // e o user's voice silently disappeared de o transcript.
  private _micRecoveryInProgress = false;
  private _micRecoveryAttempts = 0;
  private _micRecoveryTimer: NodeJS.Timeout | null = null;
  /** Último entrada device id passed para reconfigureAudio; used por mic recovery. */
  private _lastRequestedInputDeviceId: string | undefined = undefined;

  private setupMicRecoveryHandler(): void {
    if (!this.microphoneCapture) return;

    this.microphoneCapture.on('error', async (err: Error) => {
      // Proteger com ambos live isMeetingActive e o meeting generation. O
      // live flag drops errors após SPara enquanto o generation verifica previne
      // an antigo meeting's delayed recovery timer de restarting o mic após a
      // novo meeting tem begun.
      const micRecoveryMeetingGeneration = this._meetingGeneration;
      const isMicRecoveryCurrentMeeting = () => this.isMeetingActive && this._meetingGeneration === micRecoveryMeetingGeneration;
      if (!isMicRecoveryCurrentMeeting()) return;

      if (this._micRecoveryInProgress || this._micRecoveryAttempts >= 3) {
        console.warn(
          `[MicRecovery] Skipping recovery — already in progress or max attempts (${this._micRecoveryAttempts}/3) reached.`,
        );
        return;
      }

      this._micRecoveryInProgress = true;
      this._micRecoveryAttempts++;
      console.warn(
        `[MicRecovery] MicrophoneCapture error — attempting recovery #${this._micRecoveryAttempts}: ${err.message}`,
      );

      try {
        await new Promise<void>(resolve => {
          this._micRecoveryTimer = setTimeout(resolve, 1500);
        });
        this._micRecoveryTimer = null;
        if (!isMicRecoveryCurrentMeeting()) {
          return;
        }

        // Tear abaixo + recreate o mic apenas (don't touch o system-audio
        // capture; cpal precisa a fresh device manipular após error).
        if (this.microphoneCapture) {
          this.microphoneCapture.destroy();
          this.microphoneCapture = null;
        }
        this._micSttRateApplied = false;

        try {
          this.microphoneCapture = new MicrophoneCapture(this._lastRequestedInputDeviceId);
        } catch (createErr) {
          console.warn('[MicRecovery] Saved device unavailable on recovery, falling back to default.', createErr);
          this.microphoneCapture = new MicrophoneCapture();
        }

        // Uso o canonical wiring caminho (wireMicCapture) em vez disso de hand-rolling
        // data/sample_rate_changed/speech_ended. Hand-rolled wiring drifts: this
        // recovery caminho used para omit o stuck-watchdog e zero-fill detector
        // (lines 1612-1693 de wireMicCapture), então após a mic recovery o user
        // iria silently obtém zero-filled audio com não UI sinal — exatamente o
        // failure modo o watchdog era built para surface. setupMicRecoveryHandler
        // é invoked at o tail de wireMicCapture então we don't precisa a separate
        // chamar aqui equalquer um Mirrors o system-audio recovery pattern at L2413.
        this.wireMicCapture(this.microphoneCapture, '(Recovery)');
        this.microphoneCapture.start();

        this._micRecoveryAttempts = 0;
        console.log('[MicRecovery] MicrophoneCapture restarted successfully.');
      } catch (recoveryErr: any) {
        console.error(`[MicRecovery] Recovery attempt #${this._micRecoveryAttempts} failed:`, recoveryErr);
        // B4: surface a terminal failure para o CURRENT meeting após o mesmo
        // 3-tentar cap que setupAudioRecoveryHandler uses para system audio
        // (see L2456-2464). Pre-fix, mic recovery exhausted attempts apenas via
        // console.error e o próximo 'error' era silently dropped por o
        // early-return proteger at o topo de isso manipulador — user heard nada
        // era sendo transcribed mas não banner já showed. Meeting-generation
        // verifica mirrors isRecoveryCurrentMeeting() em o system-side hmanipulador
        if (this._micRecoveryAttempts >= 3 && isMicRecoveryCurrentMeeting()) {
          this.sendAudioCaptureFailed({
            channel: 'mic',
            message: `Microphone capture gave up after 3 attempts. Last error: ${recoveryErr?.message || err.message}`,
            attempt: this._micRecoveryAttempts,
            maxAttempts: 3,
            terminal: true,
          });
        }
      } finally {
        this._micRecoveryInProgress = false;
      }
    });
  }


  public async startAudioTest(deviceId?: string): Promise<void> {
    // P2-12: proteger contra two concurrent calls ambos passing o assíncrono permissão verifica
    // antes qualquer um tem created a capture — o segundo chamar iria orphan o primeiro capture.
    if (this._audioTestStarting) return;
    // Block audio testar enquanto a meeting é live. Ambos código paths construct
    // their próprio MicrophoneCapture instance contra o mesmo device; em Windows
    // cpal grants exclusive aacesso então o segundo abrir silently degrades, and
    // em macOS o meeting's capture e o testar capture compete para o
    // mesmo entrada manipular — symptom: meeting transcript stalls até o testar
    // é closed. Reject o requisição loudly via o IPC erro caminho então o
    // renderer pode desabilitar o Testar botão em vez disso de letting o user think
    // their mic é broken.
    if (this.isMeetingActive) {
      throw new Error('Audio test is unavailable while a meeting is active. End the meeting first, then test your microphone.');
    }
    this._audioTestStarting = true;
    try {
      await this._startAudioTestImpl(deviceId);
    } finally {
      this._audioTestStarting = false;
    }
  }

  // UX4: system-audio probe executa em parallel com o mic testar então users pode
  // verifica their system-audio capture caminho Antes starting a meeting.
  // Sem this, o apenas signals eram post-meeting watchdogs (8-12s após
  // meeting stinicia que é também late para a smooth "verifica e proceed"
  // onboarding flow.
  private audioTestSystemCapture: SystemAudioCapture | null = null;
  // UX4 hardening (code-review HIAlto bumped em todo startAudioTest call
  // AND todo stopAudioTest call. O system-audio probe awaits
  // resolveMacScreenCaptureCapability para ~seconds; se o user fecha o
  // Audio aba durante que await, stopAudioTest fires mas o subsequente
  // `new SystemAudioCapture(); start()` iria orphan a capture com não
  // shutdown pcaminho Snapshot isso token antes o await e bail se it tem
  // changed por o time o await resolves.
  private _audioTestEpoch = 0;
  // HANG FIX: pendente timer para o debounced system-audio probe. O CoreAudio
  // process-tap + aggregate-device desmontagem é a synchronous HAL operação that,
  // em a Bluetooth saída rotea (e.g. AirPods), pode stall coreaudiod's global HAL
  // travar para seconds — freezing o whole machine — quando a tap é created e então
  // destroyed dentro de ~1-2s. Rapidly opening o Audio aba e switching longe faz
  // exatamente that. Por deferring tap CREATION atrás isso timer (cleared em
  // stopAudioTest), a rápido aba trocar nunca cria o tap at atodos então lá é
  // nada para tear dabaixo O mic-level probe stays eager; apenas o system probe
  // (que owns o CoreAudio tap) é debounced.
  private _audioTestSystemProbeTimer: NodeJS.Timeout | null = null;

  private async _startAudioTestImpl(deviceId?: string): Promise<void> {
    console.log(`[Main] Starting Teste de Áudio on device: ${deviceId || 'default'}`);
    this.stopAudioTest(); // Para qualquer existing testar (também bumps _audioTestEpoch)
    // UX4 hardening: snapshot epoch Antes o system-audio probe's awaited
    // permissão probe. If stopAudioTest fires enquanto we're awaiting, o
    // post-await verifica abaixo catches it e pula system-capture construction.
    const startEpoch = ++this._audioTestEpoch;
    const isCurrentTest = () => this._audioTestEpoch === startEpoch;

    if (!(await ensureMacMicrophoneAccess('audio test'))) {
      throw new Error(formatPermissionMessage('mic-denied'));
    }

    const broadcastTargets = (): BrowserWindow[] =>
      [
        this.settingsWindowHelper.getSettingsWindow(),
        this.getWindowHelper().getLauncherWindow(),
        this.getWindowHelper().getOverlayWindow(),
      ].filter((win): win is BrowserWindow => !!win && !win.isDestroyed());

    const computeRmsLevel = (chunk: Buffer): number => {
      let sum = 0;
      const step = 10;
      const len = chunk.length;
      for (let i = 0; i < len; i += 2 * step) {
        const val = chunk.readInt16LE(i);
        sum += val * val;
      }
      const count = len / (2 * step);
      if (count <= 0) return 0;
      const rms = Math.sqrt(sum / count);
      return Math.min(rms / 10000, 1.0);
    };

    const attachAudioTestListeners = (capture: MicrophoneCapture) => {
      capture.on('data', (chunk: Buffer) => {
        const targets = broadcastTargets();
        if (targets.length === 0) return;
        const level = computeRmsLevel(chunk);
        for (const target of targets) {
          target.webContents.send('audio-test-level', level);
        }
      });

      capture.on('error', (err: Error) => {
        console.error('[Main] AudioTest Error:', err);
      });
    };

    // UX4: parallel system-audio probe. Wired Após o mic capture então a
    // missing screen-recording conceder doesn't block o mic nível meter.
    // Listeners incluir a TCC zero-fill detector (peak-to-peak < 100 para
    // o entire probe = TCC silently denied até though SCK started).
    const attachSystemTestListeners = (capture: SystemAudioCapture) => {
      capture.on('data', (chunk: Buffer) => {
        const targets = broadcastTargets();
        if (targets.length === 0) return;
        const level = computeRmsLevel(chunk);
        for (const target of targets) {
          target.webContents.send('audio-test-system-level', level);
        }
      });
      capture.on('error', (err: Error) => {
        console.error('[Main] AudioTest System Error:', err);
        for (const target of broadcastTargets()) {
          target.webContents.send('audio-test-system-error', err.message || String(err));
        }
      });
    };

    try {
      this.audioTestCapture = new MicrophoneCapture(deviceId || undefined);
      attachAudioTestListeners(this.audioTestCapture);
      this.audioTestCapture.start();
    } catch (err) {
      console.warn('[Main] Failed to start audio test on preferred device. Falling back to default.', err);
      // RC-02 fix: explicitly para e nulo o falhou capture antes creating
      // o alternativa para prevenir a brief double-microphone-capture window.
      try { this.audioTestCapture?.stop(); } catch { /* ignorar errors em already-failed capture */ }
      this.audioTestCapture = null;
      try {
        this.audioTestCapture = new MicrophoneCapture();
        attachAudioTestListeners(this.audioTestCapture);
        this.audioTestCapture.start();
      } catch (fallbackErr) {
        console.error('[Main] Failed to start audio test:', fallbackErr);
        throw fallbackErr;
      }
    }

    // Independent system-audio probe — failure aqui faz Não abortar o mic
    // ttestar O renderer renderiza o system-level barra greyed-out + a
    // permission-denied notice se o tela capture probe couldn't sinicia
    try {
      const screenCapability = await resolveMacScreenCaptureCapability('audio test');
      // UX4 hardening: bail se a stopAudioTest fired durante o await.
      // Constructing+starting a SystemAudioCapture após para iria orphan
      // o capture com não shutdown pcaminho
      if (!isCurrentTest()) {
        console.log('[Main] Audio test was stopped during permission probe — skipping system capture construction.');
        return;
      }
      if (screenCapability.effectiveDenied) {
        for (const target of broadcastTargets()) {
          target.webContents.send(
            'audio-test-system-error',
            screenCapability.message ?? formatPermissionMessage('screen-recording-denied'),
          );
        }
      } else {
        // HANG FIX: defer o CoreAudio tap creation atrás a debounce. If o
        // user switches longe de o Audio aba dentro de isso window, stopAudioTest
        // limpa o timer e o tap é Nunca created — então coreaudiod nunca tem
        // para tear abaixo a freshly-created Bluetooth aggregate-device tap (o
        // operação que stalls o system-wide HAL travar e hangs o machine).
        // 600ms é longo enough para absorb an accidental click-through, curto enough
        // que a deliberate visit para o Audio aba ainda mostra o system meter
        // promptly.
        if (this._audioTestSystemProbeTimer) {
          clearTimeout(this._audioTestSystemProbeTimer);
          this._audioTestSystemProbeTimer = null;
        }
        this._audioTestSystemProbeTimer = setTimeout(() => {
          this._audioTestSystemProbeTimer = null;
          // Re-check o epoch: a stopAudioTest (tab trocar / cfechar bumps it and
          // iria ter cleared isso timer, mas proteger anyway contra races.
          if (!isCurrentTest()) {
            console.log('[Main] Audio test stopped during system-probe debounce — skipping CoreAudio tap creation.');
            return;
          }
          try {
            this.audioTestSystemCapture = new SystemAudioCapture();
            attachSystemTestListeners(this.audioTestSystemCapture);
            // INVARIANT: SystemAudioCapture.start() Precisa remain synchronous (its
            // native CoreAudio inicializar executa em a fundo thread e stinicia
            // Retorna instantly). Porque nada awaits entre stinicia e o
            // isCurrentTest() re-check babaixo não stopAudioTest pode interleave, então
            // isso proteger cannot si mesmo acionar a create-then-immediately-destroy
            // desmontagem — o exact HAL stall isso debounce exists para avoid. If
            // stinicia é já made async/awaiting, isso inline stpara iria executa
            // direito após o tap é created e REINTRODUCE o hang; em that
            // case, defer/cancel aqui em vez disso de calling stpara inline.
            this.audioTestSystemCapture.start();
            if (!isCurrentTest()) {
              try { this.audioTestSystemCapture?.stop(); } catch { /* ignorar */ }
              this.audioTestSystemCapture = null;
            }
          } catch (probeErr: any) {
            console.warn('[Main] Deferred system-audio probe failed to start:', probeErr);
            for (const target of broadcastTargets()) {
              target.webContents.send(
                'audio-test-system-error',
                probeErr?.message || 'System audio probe failed to start.',
              );
            }
          }
        }, 600);
      }
    } catch (sysErr: any) {
      console.warn('[Main] Failed to start system-audio probe:', sysErr);
      for (const target of broadcastTargets()) {
        target.webContents.send(
          'audio-test-system-error',
          sysErr?.message || 'System audio probe failed to start.',
        );
      }
    }
  }

  public stopAudioTest(): void {
    // UX4 hardening: bump epoch então qualquer in-flight _startAudioTestImpl that's
    // awaiting resolveMacScreenCaptureCapability sees o change e pula
    // constructing o system capture (avoids orphaned-capture race).
    this._audioTestEpoch++;
    // HANG FIX: cancelar a pendente debounced system-audio probe. If o user
    // switched longe de o Audio aba antes o 600ms timer fired, o
    // CoreAudio tap era nunca created — clearing o timer aqui garante it
    // nunca vai ser para isso (agora stale) ttestar então lá é não Bluetooth
    // aggregate-device desmontagem para stall coreaudiod.
    if (this._audioTestSystemProbeTimer) {
      clearTimeout(this._audioTestSystemProbeTimer);
      this._audioTestSystemProbeTimer = null;
    }
    // Também desabilitar pre-warm então stpara doesn't pre-warm a novo monitorar que iria
    // keep o DSP thread alive após o configurações painel é closed. Mirrors
    // o endMeeting() pattern onde disablePreWarm() é chamado antes stopara
    this.audioTestCapture?.disablePreWarm();
    if (this.audioTestCapture) {
      console.log('[Main] Stopping Audio Test');
      this.audioTestCapture.stop();
      this.audioTestCapture = null;
    }
    // UX4: também para o parallel system probe.
    if (this.audioTestSystemCapture) {
      try {
        this.audioTestSystemCapture.stop();
      } catch (e) {
        console.warn('[Main] Stopping system audio test threw:', e);
      }
      this.audioTestSystemCapture = null;
    }
  }

  public finalizeMicSTT(): void {
    // We apenas want para finalize o user microphone, porque o contexto é Manual Answer
    if (this.googleSTT_User?.finalize) {
      console.log('[Main] Finalizing STT');
      this.googleSTT_User.finalize();
    }
  }

  public async startMeeting(metadata?: any): Promise<void> {
    console.log('[Main] Starting Meeting...', metadata);

    // If a anterior endMeeting() é ainda draining STT em o background, aguardar
    // para it para finaliza antes we boot a novo sessão — caso contrário o BG teardown
    // poderia chamar STT.stop() em instances o novo meeting apenas started using.
    // Em o comum case (SPara então Inicia seconds ldepois isso awaits an
    // already-resolved promise e é fliberar
    if (this._pendingTeardown) {
      try {
        await this._pendingTeardown;
      } catch {
        // desmontagem já logs; safe para swallow aqui
      }
      this._pendingTeardown = null;
    }

    // PR #173: Reinicia audio recovery estado para fresh sessão
    this._systemAudioRecoveryInProgress = false;
    this._systemAudioRecoveryAttempts = 0;
    this._systemAudioConsecutiveFailures = 0;
    this._micRecoveryAttempts = 0;
    if (this._systemAudioRecoveryTimer) {
      clearTimeout(this._systemAudioRecoveryTimer);
      this._systemAudioRecoveryTimer = null;
    }

    if (!(await ensureMacMicrophoneAccess('meeting start'))) {
      const message = formatPermissionMessage('mic-denied');
      this.broadcast('meeting-audio-error', message);
      // Tag o thrown erro então o renderer's start-meeting caller (ainda em
      // o launcher — o overlay/meeting surface hasn't sido shown yainda então
      // o in-overlay audio banner iria não ser visible) pode recognise this
      // como a recoverable mic-permission denial e re-open o permissions
      // cartão em vez disso de failing silently com apenas a console.error. Pre-fix,
      // a denied/revoked mic conceder made "Inicia Refract" fazer nada em screen.
      const err = new Error(message) as Error & { code?: string; channel?: string };
      err.code = 'mic-permission-denied';
      err.channel = 'mic';
      throw err;
    }

    // Verifica Screen Recording permissão necessário para system audio capture
    // (CoreAudio Global Processo Tap + ScreenCaptureKit ambos precisa this).
    // NOTE: O 'not-determined' TCC diálogo é triggered uma vez at app startup
    // (em initializeApp) então it nunca pops para cima mid-meeting haqui We apenas act em
    // explicit 'denied' — em que case warn o user mas let o meeting continue
    // com microphone-only transcription.
    if (process.platform === 'darwin') {
      const screenCapability = await resolveMacScreenCaptureCapability('meeting start');
      console.log(`[Main] macOS screen recording permission status: ${screenCapability.status}; capturable=${screenCapability.capturable}; sources=${screenCapability.sourceCount}`);
      if (screenCapability.effectiveDenied) {
        // Permissão era explicitly denied — warn o user via o UI mas fazer Não
        // auto-open System Settings. Forcing que janela abrir todo meeting inicia
        // é extremely disruptive, especialmente quando mic transcription é ainda working.
        // O UI vai mostrar a non-blocking banner; o user pode fix it deliberately.
        const message = screenCapability.message ?? formatPermissionMessage('screen-recording-denied');
        console.warn('[Main]', message);
        this.sendSystemAudioPermissionDenied( message);
        // NOTE: Fazer Não chamar shell.openExternal() aqui — it hijacks focar em todo meeting
        // sinicia O UI banner (system-audio-permission-denied IPC eevento gerencia this.
      }
      // 'not-determined': Handled at startup. SCK/CoreAudio vai acionar o TCC
      // diálogo si mesmo quando it primeiro attempts para acesso tela content.
    }

    // Reinicia overlay posição Antes o trocar então o novo meeting inicia em
    // a predictable centered posição independentemente de onde o anterior
    // sessão esquerda it. (Moved para cima de abaixo então setWindowMode('overlay') lê
    // o reinicia bounds.)
    this.windowHelper.resetOverlayPosition();

    // ─── WINDOW Trocar Antes Estado BROADCAST ───────────────────────────────
    // Trocar para o overlay Antes flipping `isMeetingActive` para tverdadeiro If we
    // transmitir meeting-state-changed:{isActive:true} enquanto o launcher é
    // ainda visible, o launcher's CTA pill briefly crossfades blue→green
    // antes o renderer's follow-up setWindowMode('overlay') oculta it —
    // visible como a flash. Switching primeiro significa o launcher oculta antes
    // o estado evento arrives, então o user apenas já sees o overlay.
    this.windowHelper.setWindowMode('overlay');

    const meetingGeneration = ++this._meetingGeneration;
    this.isMeetingActive = true;
    this.broadcastMeetingState()
    if (metadata) {
      this.intelligenceManager.setMeetingMetadata(metadata);
    }

    // Fase 3 — vincular dynamic ação engine para isso meeting + ativo mmodo
    // Ação armazenamento é per-(sessionId, modeId), então a fresh sessionId aqui gives
    // nós per-meeting isolation. Re-binding em modo trocar é handled em o
    // modes:set-active IPC hmanipulador
    let _meetingTelemetrySessionId: string | undefined;
    try {
      const { ModesManager } = require('./services/ModesManager');
      const activeMode = ModesManager.getInstance().getActiveMode();
      if (activeMode) {
        const sessionId = `session_${crypto.randomUUID()}`;
        _meetingTelemetrySessionId = sessionId;
        this.intelligenceManager.setDynamicActionContext({
          sessionId,
          modeId: activeMode.id,
          modeTemplateType: activeMode.templateType,
        });
      }
    } catch (err) {
      // Auxiliary feature — nunca block meeting sinicia
      console.warn('[Main] failed to bind dynamic action context at meeting start:', (err as Error)?.message);
    }

    // Fase 6 — meeting_start telemetry (não transcript / não PII).
    try {
      const { telemetryService } = require('./services/telemetry/TelemetryService');
      const { ModesManager } = require('./services/ModesManager');
      const am = ModesManager.getInstance().getActiveMode();
      telemetryService.track({
        name: 'meeting_start',
        sessionId: _meetingTelemetrySessionId,
        modeId: am?.id,
        properties: { modeTemplateType: am?.templateType, hasMetadata: Boolean(metadata) },
      });
    } catch { /* non-fatal */ }

    // Emitir sessão reinicia para claro UI estado imediatamente
    this.getWindowHelper().getOverlayWindow()?.webContents.send('session-reset');
    this.getWindowHelper().getLauncherWindow()?.webContents.send('session-reset');

    // LOCAL-MODEL WARMUP: se o ativo modelo é a local Ollama mmodelo warm + pin
    // it agora (fire-and-forget) então o cold weight-load (8-12s para a 7-9B mmodelo
    // happens Durante o meeting-start / audio-init janela em vez disso de em o user's
    // primeiro live question — onde it iria caso contrário blow o first-token deadline
    // e surface o canned fallback. Cloud models no-op aqui (prewarm Retorna
    // fast para non-Ollama), então a cloud sessão pays nnada Nunca blocks sinicia
    try {
      const llmHelper = this.processingHelper.getLLMHelper();
      if (llmHelper?.isUsingOllama?.()) {
        llmHelper.prewarmPromptCache().catch((_e: any): void => {});
      }
    } catch { /* non-fatal — warmup precisa nunca block meeting inicia */ }

    // ★ ASYNC AUDIO INIT: Retorna INSTANTLY então o IPC resposta goes voltar
    // para o renderer iimediatamente allowing o UI para trocar para overlay
    // sem waiting para SCK/audio initialization (que takes 5-7 seconds).
    const audioInitController = new AbortController();
    this._audioInitController = audioInitController;
    const audioInitSignal = audioInitController.signal;
    this._audioInitPromise = (async () => {
      const isCurrentMeeting = () => this.isMeetingActive && this._meetingGeneration === meetingGeneration && !audioInitSignal.aborted;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      let systemCaptureOwnedByInit = this.systemAudioCapture;
      let microphoneCaptureOwnedByInit = this.microphoneCapture;
      let systemSttOwnedByInit = this.googleSTT;
      let userSttOwnedByInit = this.googleSTT_User;
      let ragManagerOwnedByInit = this.ragManager;
      let systemSttStartedByInit = false;
      let userSttStartedByInit = false;
      let liveIndexingStartedByInit = false;
      const abortStaleAudioInit = () => {
        if (this.systemAudioCapture === systemCaptureOwnedByInit) {
          (this.systemAudioCapture as any)?.__disarmStuckWatchdog?.();
          this.systemAudioCapture?.destroy();
          this.systemAudioCapture = null;
        }
        if (this.microphoneCapture === microphoneCaptureOwnedByInit) {
          (this.microphoneCapture as any)?.__disarmStuckWatchdog?.();
          this.microphoneCapture?.destroy();
          this.microphoneCapture = null;
        }
        if (systemSttStartedByInit) {
          if (this.googleSTT === systemSttOwnedByInit) this.googleSTT?.stop();
        }
        if (userSttStartedByInit) {
          if (this.googleSTT_User === userSttOwnedByInit) this.googleSTT_User?.stop();
        }
        if (liveIndexingStartedByInit) {
          if (this.ragManager === ragManagerOwnedByInit) this.ragManager?.stopLiveIndexing?.();
        }
      };

      if (!isCurrentMeeting()) {
        console.warn('[Main] Meeting was cancelled before audio pipeline could start — aborting init.');
        return;
      }
      try {
        // Verifica para audio configuration preferência
        if (metadata?.audio) {
          await this.reconfigureAudio(metadata.audio.inputDeviceId, metadata.audio.outputDeviceId);
          if (!isCurrentMeeting()) {
            abortStaleAudioInit();
            return;
          }
          systemCaptureOwnedByInit = this.systemAudioCapture;
          microphoneCaptureOwnedByInit = this.microphoneCapture;
          systemSttOwnedByInit = this.googleSTT;
          userSttOwnedByInit = this.googleSTT_User;
          ragManagerOwnedByInit = this.ragManager;
        }

        // LAZY INIT: Garante pipeline é pronto (if não reconfigured aacima
        await this.setupSystemAudioPipeline();
        if (!isCurrentMeeting()) {
          abortStaleAudioInit();
          return;
        }
        systemCaptureOwnedByInit = this.systemAudioCapture;
        microphoneCaptureOwnedByInit = this.microphoneCapture;
        systemSttOwnedByInit = this.googleSTT;
        userSttOwnedByInit = this.googleSTT_User;
        ragManagerOwnedByInit = this.ragManager;

        // Inicia System Audio
        this.systemAudioCapture?.start();
        this.googleSTT?.start();
        systemSttStartedByInit = true;

        // Inicia Microphone
        this.microphoneCapture?.start();
        this.googleSTT_User?.start();
        userSttStartedByInit = true;

        // Inicia JIT RAG live indexing
        if (this.ragManager) {
          this.ragManager.startLiveIndexing('live-meeting-current');
          liveIndexingStartedByInit = true;
        }

        if (!isCurrentMeeting()) {
          abortStaleAudioInit();
          return;
        }

        // Observar para default-output rotea changes então o CoreAudio Tap follows
        // o user quando they trocar saída devices mid-meeting (AirPods plug,
        // headphones, virtual cable). No-op se o user picked a específico
        // saída ou se o native binário lacks o getDefaultOutputDeviceId
        // eexportar
        this.startDefaultOutputWatcher();

        if (this._verboseLogging) {
          const requestedInput = metadata?.audio?.inputDeviceId || 'default';
          const requestedOutput = metadata?.audio?.outputDeviceId || 'default';
          const backend = requestedOutput === 'sck' ? 'sck' : 'coreaudio';
          const sysRate = this.systemAudioCapture?.getSampleRate() || 48000;
          const micRate = this.microphoneCapture?.getSampleRate() || 48000;
          console.log(`[Main][debug] Audio pipeline: input=${requestedInput} output=${requestedOutput} backend=${backend} sysRate=${sysRate}Hz micRate=${micRate}Hz`);
        }
        console.log('[Main] Audio pipeline started successfully.');
      } catch (err) {
        // An endMeeting()-driven abortar (ou a generation change) é expected — it é
        // Não a real audio failure, então we precisa não surface a "pipeline failed" banner
        // para a Para o user initiated themselves.
        const isAbort = (err as Error)?.message === 'audio_init_aborted' || !isCurrentMeeting();
        if (!isAbort) {
          console.error('[Main] Error initializing audio pipeline:', err);
          // Notifica UI então user knows microphone/audio falhou para inicia
          this.broadcast('meeting-audio-error', (err as Error).message || 'Audio pipeline failed to start');
        } else {
          abortStaleAudioInit();
        }
      } finally {
        if (this._meetingGeneration === meetingGeneration) this._audioInitPromise = null;
        if (this._audioInitController === audioInitController) {
          this._audioInitController = null;
        }
      }
    })(); // Defer to próximo evento loop tick — garante IPC resposta reaches renderer antes audio init
  }

  public async endMeeting(): Promise<void> {
    // Idempotency gproteger a double-click em SPara ou a Para racing com a
    // global-shortcut rreinicia pode entregar two endMeeting() calls dentro de ms de
    // cada ooutro Sem this, ambos invocations iria executa o synchronous
    // desmontagem block (overwriting o in-flight `_pendingTeardown` promise
    // rreferência breaking startMeeting()'s await em it, e ambos `finally`
    // handlers poderia claro `_isDraining` prematurely — truncating o trailing
    // transcript finals de o primeiro teardown).
    if (this._endMeetingInFlight || (!this.isMeetingActive && this._pendingTeardown)) {
      console.log('[Main] endMeeting() ignored — teardown already in flight.');
      await this._pendingTeardown?.catch((): void => {});
      return;
    }
    // Cover o janela entre aqui e `_pendingTeardown` assignment, durante que
    // o novo in-flight-audio-init await abaixo yields o evento loop.
    this._endMeetingInFlight = true;
    console.log('[Main] Ending Meeting...');

    // Fase 6 — meeting_stop telemetry. Emitir Antes qualquer desmontagem então a crash
    // em para logic ainda records o para eevento
    try {
      const { telemetryService } = require('./services/telemetry/TelemetryService');
      const { ModesManager } = require('./services/ModesManager');
      const am = ModesManager.getInstance().getActiveMode();
      telemetryService.track({
        name: 'meeting_stop',
        modeId: am?.id,
        properties: { modeTemplateType: am?.templateType },
      });
    } catch { /* non-fatal */ }

    // Reinicia Mouse Passthrough então o próximo meeting overlay inicia fresh e focusable
    if (this.overlayMousePassthrough) {
      this.setOverlayMousePassthrough(false);
    }

    // ─── WINDOW Trocar Antes Estado BROADCAST ───────────────────────────────
    // Mirror startMeeting()'s ordering: trocar o janela Antes flipping
    // `isMeetingActive` e broadcasting. If o overlay recebe
    // `meeting-state-changed:{isActive:false}` enquanto it é ainda visible, o
    // overlay's React árvore pode começa unmount/cleanup paths (cancelar streams,
    // claro effects) enquanto ainda painted — combined com a same-instance theme
    // strocar que interleaving produces o half-painted overlay symptom o
    // user pode apenas escape via force-quit. Ocultar fprimeiro então broadcast.
    this.windowHelper.setWindowMode('launcher');

    // ─── Claro O OVERLAY Árvore Enquanto IT É HIDDEN ─────────────────────────
    // O overlay BrowserWindow é PERSISTENT — created uma vez com show:false
    // e após isso apenas hide()/show()'d; its React árvore é nunca unmounted
    // entre meetings. O line acima apenas hid it. If we don't claro it nagora
    // o anterior meeting's messages + expanded largura survive dentro de o próximo
    // meeting e são briefly VISIBLE o instant startMeeting() show()s o
    // janela novamente — então torn abaixo Em SCREEN (chat-list desmontar + height
    // recompute + o shellWidth→OS-resize shrink) quando o start-side
    // session-reset finalmente lands a poucos frames após shomostrar That on-screen
    // desmontagem é o "old UI flashes, então a choppy ccolapsar o user sees.
    //
    // Clearing Aqui — após o janela é hidden, com a whole meeting de idle
    // time antes o próximo shmostrar — significa o overlay's mounted estado é
    // já o clean collapsed baseline por o próximo meeting, então its Primeiro
    // visible frame é clean e lá é nada para resize/tear abaixo em
    // screen. O renderer's onSessionReset manipulador faz o completo synchronous
    // claro (messages, shellWidth→collapsed, code-expansion refs/timers); o
    // apenas change é que it agora executa enquanto hidden em vez disso de enquanto visible.
    //
    // Safe: o overlay é já hidden acima e mostra nada post-stop —
    // trailing transcript finals (_isDraining), meeting ssalva e o
    // title/summary todos executa contra o DB / outro windows, nunca isso tárvore
    // O start-side session-reset (em startMeeting) é kept como a safety net
    // para o cold-start / crash-recovery caminho onde endMeeting nunca ran; em
    // o normal Stop→Start caminho it é agora a no-op (estado já clean).
    this.getWindowHelper().getOverlayWindow()?.webContents.send('session-reset');

    // ─── UX Estado FLIP — SYNCHRONOUS ───────────────────────────────────────
    // Agora flip o UX-facing meeting flag e broadcast. O launcher's
    // "Meeting ongoing" pill reverts para "Inicia Refract" iimediatamente
    // trailing transcript finals são ainda accepted via `_isDraining`.
    this.isMeetingActive = false;
    this._meetingGeneration++;
    this._isDraining = true;
    this.broadcastMeetingState();

    // ─── Abortar + AWAIT IN-FLIGHT AUDIO INIT (antes qualquer capture teardown) ───
    // If startMeeting()'s assíncrono audio inicializar é ainda mid-`setupSystemAudioPipeline()`
    // it pode construct/start a FRESH native capture Após nosso stop()/destroy() rexecuta
    // leaving a dangling CoreAudio/SCK manipular — ou ambos o dying e fresh captures
    // grab o HAL property-listener travar at uma vez e freeze o principal thread mid-paint.
    // ababortar é synchronous (flips audioInitSignal.aborted então o init's
    // isCurrentMeeting() guards short-circuit e it tears abaixo its próprio captures);
    // o await é INSTANT em o comum case (_audioInitPromise é já nulo uma vez
    // inicializar completed) e apenas blocks em o narrow cold-start-then-immediate-Stop
    // janela — onde waiting é exatamente o que previne o freeze. O launcher UI
    // já reverted acima via broadcastMeetingState(), então perceived responsiveness
    // é unaffected.
    this._audioInitController?.abort();
    try {
      await this._audioInitPromise;
    } catch {
      // O inicializar corpo pode rejeitar com o `audio_init_aborted` sentinel em abortar — expected.
    }
    this._audioInitPromise = null;
    // O await (o apenas produzir point antes `_pendingTeardown` é assigned) é dfeito
    // o remaining desmontagem executa synchronously, então re-entry é não longer possível aqui
    // e o `_pendingTeardown`-based proteger acima takes sobre uma vez it's sdefine
    this._endMeetingInFlight = false;

    // ─── SYNCHRONOUS: things o user expects "direito nagora em Para click ────
    // Disarm o stuck-capture watchdogs Antes stpara — stpara flips isRecording
    // e agenda a deferred native teardown, então we cannot rely em o on('stop')
    // ouvinte firing em time para cancelar o 12s timer. Sem this, a curto meeting
    // que captured 0 chunks pode disparar a falso "system-audio-stuck" banner após o
    // user já stopped. clearTimeout(null) é a no-op, então isso é sempre safe.
    (this.systemAudioCapture as any)?.__disarmStuckWatchdog?.();
    (this.microphoneCapture as any)?.__disarmStuckWatchdog?.();

    // ─── CAPTURE TEARDOWN — DESTROY + RECREATE, Não Para + REUSE ───────────
    // Snapshot o live capture wrappers, então nulo o fields SYNCHRONOUSLY.
    // This é o fix para o second-meeting UI freeze: se we leave o
    // wrappers em place, a fast Stop→Start em o Mesmo device pula o
    // reconfigureAudio destroy+recreate caminho ("reconfigure skipped — device
    // IDs unchanged") e setupSystemAudioPipeline's `if (!this.microphoneCapture)`
    // gproteger então MicrophoneCapture.start() termina para cima SYNCHRONOUSLY constructing a
    // fresh `new RustMicCapture` em o principal thread Enquanto o anterior meeting's
    // deferred `monitor.stop()` é ainda releasing o mesmo CoreAudio device —
    // ambos grab o HAL property-listener travar e deadlock o principal tthread
    // Nulling aqui forces o próximo meeting abaixo o serialized reconstruction
    // pcaminho e o destroy() promises abaixo são threaded dentro de _pendingTeardown
    // (awaited por o próximo startMeeting) então o dying native manipular é completamente
    // released Antes qualquer novo capture é constructed em o mesmo device.
    //
    // destroy() = disablePreWarm + (deferred) para + removeAllListeners + null
    // mmonitorar It Retorna dentro de ~1ms (o native desmontagem é em setImmediate);
    // we fazer Não await it aqui — endMeeting ainda Retorna instantly.
    const dyingSystemCapture = this.systemAudioCapture;
    const dyingMicrophoneCapture = this.microphoneCapture;
    this.systemAudioCapture = null;
    this.microphoneCapture = null;
    const captureTeardownPromise = Promise.all([
      Promise.resolve(dyingSystemCapture?.destroy()).catch((e) => {
        console.error('[Main] System capture teardown failed:', e);
      }),
      Promise.resolve(dyingMicrophoneCapture?.destroy()).catch((e) => {
        console.error('[Main] Microphone capture teardown failed:', e);
      }),
    ]).then(() => {});

    // Para o default-output watcher — não point polling CoreAudio enquanto
    // there's não ativo capture para rebind.
    this.stopDefaultOutputWatcher();

    // Tell STT para mark o audio stream como ended; trailing finals vai arrive
    // sobre o próximo ~150ms enquanto we're já returning para o renderer.
    this.googleSTT?.finalize?.();
    this.googleSTT_User?.finalize?.();

    // ─── BACKGROUND: STT drenar + meeting salva + RAG embed ────────────────
    // Note: `isMeetingActive` era já flipped para falso synchronously acima
    // (então o launcher UI atualiza instantly). `_isDraining` é verdadeiro durante o
    // 250 ms grace janela então o transcript manipulador keeps accepting trailing
    // finals — sem that, o user's último sentence vanishes. We expor o
    // in-flight desmontagem como `_pendingTeardown` então a fast start→stop→start
    // sequence awaits isso completion em startMeeting() antes booting a new
    // sessão em o (still-shared) STT instances.
    const ragManager = this.ragManager;
    this._pendingTeardown = (async () => {
      // CRITICAL ORDERING: await o native capture desmontagem FPrimeiro antes qualquer
      // de o STT/RAG drenar babaixo startMeeting() awaits isso whole
      // _pendingTeardown promise antes it constructs/starts a novo capture, então
      // resolving captureTeardownPromise dentro it guarantees o anterior
      // meeting's `monitor.stop()` tem released o CoreAudio device antes o
      // próximo meeting abre it — closing o HAL-lock deadlock window. It é
      // awaited para cima front (não em parallel) então até a lento native release blocks
      // o próximo inicia em vez than racing it.
      await captureTeardownPromise;
      try {
        // 0. Revert para Default MModelo Moved dentro de BG: getDefaultModel() e o
        //    provedor lista lê touch disk, e o 'model-changed' broadcast
        //    re-renders todos abrir windows — ambos block o principal thread/renderer
        //    durante o Stop-click critical pcaminho Fazendo it aqui significa o
        //    revert lands ~250 ms após SPara por que point o launcher é
        //    já painted e o overlay é hidden, então o user nunca
        //    sees a stutter.
        try {
          const { CredentialsManager } = require('./services/CredentialsManager');
          const cm = CredentialsManager.getInstance();
          const defaultModel = cm.getDefaultModel();
          const all = [...(cm.getCurlProviders() || []), ...(cm.getCustomProviders() || [])];
          console.log(`[Main] Reverting model to default: ${defaultModel}`);
          this.processingHelper.getLLMHelper().setModel(defaultModel, all);
          BrowserWindow.getAllWindows().forEach(win => {
            if (!win.isDestroyed()) win.webContents.send('model-changed', defaultModel);
          });
        } catch (e) {
          console.error('[Main] Failed to revert model:', e);
        }

        // 1. Grace janela para STT trailing finals (Google/Soniox/Deepgram todos
        //    reply para finalize() dentro de 100–200ms). 250ms é conservative.
        await new Promise(resolve => setTimeout(resolve, 250));

        // 2. Tear abaixo STT sockets agora que finals ter arrived.
        this.googleSTT?.stop();
        this.googleSTT_User?.stop();

        // 3. Snapshot transcript + persist placeholder + fila title/summary LLM.
        //    intelligenceManager.stopMeeting si mesmo executa LLM em background.
        const meetingId = await this.intelligenceManager.stopMeeting();

        // 5. RAG limpeza — mesmo logic como bantes apenas dentro o BG IIFE.
        if (meetingId) {
          if (ragManager) {
            await ragManager.stopLiveIndexing();
            console.log('[Main] Live RAG indexing stopped.');
          }
          await this.processCompletedMeetingForRAG(meetingId);
          if (ragManager && !this.isMeetingActive) {
            ragManager.deleteMeetingData('live-meeting-current');
            console.log('[Main] JIT RAG provisional chunks cleaned up.');
          } else if (this.isMeetingActive) {
            console.log('[Main] New meeting started during cleanup — skipping live-meeting-current deletion.');
          }
        } else {
          if (ragManager) {
            await ragManager.stopLiveIndexing().catch((): void => {});
            if (!this.isMeetingActive) ragManager.deleteMeetingData('live-meeting-current');
          }
        }
      } catch (err) {
        console.error('[Main] Background meeting teardown failed:', err);
      } finally {
        this._isDraining = false;
        this.clearTranscriptThrottle();
      }
    })();
    // endMeeting Retorna Agora — o IPC manipulador resolves e o renderer's
    // "SPara botão transitions instantly. Total endMeeting wall-clock time
    // é agora bounded por o synchronous block acima (~1–5ms tytípico
  }

  private async processCompletedMeetingForRAG(meetingId: string): Promise<void> {
    if (!this.ragManager) return;

    // In-flight gproteger rapid desmontagem paths (recovery tentar novamente + normal completion,
    // ou back-to-back endMeeting calls) pode enqueue o mesmo meeting twice
    // antes o primeiro ccompleta Cada invocation re-reads o transcript,
    // re-chunks, e re-queues embeddings — duplicating ~100ms-2s de work and
    // racing o SQLite INSERT-OR-IGNORE. Short-circuit se já em flight.
    if (this._ragProcessingInFlight.has(meetingId)) {
      console.log(`[AppState] RAG processing for ${meetingId} already in flight — skipping duplicate.`);
      return;
    }
    this._ragProcessingInFlight.add(meetingId);

    try {
      // Uso o explicit meetingId passed de endMeeting() — deterministic, nunca
      // escolhe para cima a concurrently started meeting o way getRecentMeetings(1) cpoderia
      const meeting = DatabaseManager.getInstance().getMeetingDetails(meetingId);
      if (!meeting || !meeting.transcript || meeting.transcript.length === 0) return;

      // Converte transcript para RAG formata
      const segments = meeting.transcript.map(t => ({
        speaker: t.speaker,
        text: t.text,
        timestamp: t.timestamp
      }));

      // Gera summary de detailedSummary se available
      let summary: string | undefined;
      if (meeting.detailedSummary) {
        summary = [
          ...(meeting.detailedSummary.keyPoints || []),
          ...(meeting.detailedSummary.actionItems || []).map(a => `Action: ${a}`)
        ].join('. ');
      }

      const result = await this.ragManager.processMeeting(meeting.id, segments, summary);
      console.log(`[AppState] RAG processed meeting ${meeting.id}: ${result.chunkCount} chunks`);

    } catch (error) {
      console.error('[AppState] Failed to process meeting for RAG:', error);
    } finally {
      this._ragProcessingInFlight.delete(meetingId);
    }
  }

  private setupIntelligenceEvents(): void {
    const mainWindow = this.getMainWindow.bind(this)

    // Sprint 9: time-batched IPC token senvia
    //
    // Cada LLM streaming token anteriormente fired one webContents.send → one
    // structured-clone serialization → one IPC mmensagem Para a 400-token
    // answer at 100 tok/s that's 400 IPC messages sobre 4 seconds. Com
    // Groq at 200+ tok/s o rate obtém uncomfortable.
    //
    // Coalesce per-tick: a token arriving em o atual libuv iteration
    // adiciona para a per-kind bbuffer O primeiro adiciona agenda a setImmediate
    // esvaziar que drains todos buffers em one webContents.send por kind
    // (carrying an items ararray Net: ~3-5× fewer IPC messages em hot
    // streams com não perceptible latency cost (sub-frame).
    //
    // O antigo per-token channels (intelligence-suggested-answer-token, etetc
    // são Não LONGER USED para these 5 streams. O single
    // 'intelligence-token-batch' channel substitui them. O antigo channel
    // names + preload bridges são kept (defense-in-depth, não callers).
    type BatchKind = 'suggested_answer' | 'refined_answer' | 'recap' | 'clarify' | 'follow_up_questions';
    const tokenBatches = new Map<BatchKind, any[]>();
    let batchFlushScheduled = false;
    const flushBatchesNow = () => {
      const win = mainWindow();
      if (!win) { tokenBatches.clear(); return; }
      for (const [kind, items] of tokenBatches.entries()) {
        if (items.length > 0) {
          win.webContents.send('intelligence-token-batch', { kind, items });
        }
      }
      tokenBatches.clear();
    };
    const scheduleBatchFlush = () => {
      if (batchFlushScheduled) return;
      batchFlushScheduled = true;
      setImmediate(() => {
        batchFlushScheduled = false;
        flushBatchesNow();
      });
    };
    const queueBatch = (kind: BatchKind, item: any) => {
      let arr = tokenBatches.get(kind);
      if (!arr) { arr = []; tokenBatches.set(kind, arr); }
      arr.push(item);
      scheduleBatchFlush();
    };
    // OOrdenar todo final-answer manipulador precisa chamar isso Antes its próprio envia então
    // o renderer sees (..., último tokens, final answer) e não (..., final
    // answer, trailing tokens) — o último iria clobber o just-finalized
    // linha com appended texto de a pendente setImmediate batch.
    const flushBatchesBeforeFinal = flushBatchesNow;

    // Para frente intelligence events para renderer
    this.intelligenceManager.on('assist_update', (insight: string) => {
      // Envia para ambos se ambos exist, though majoritariamente overlay precisa it
      const helper = this.getWindowHelper();
      helper.getLauncherWindow()?.webContents.send('intelligence-assist-update', { insight });
      helper.getOverlayWindow()?.webContents.send('intelligence-assist-update', { insight });
    })

    // Fase 3 — cartão de ação dinâmica estilo Refract. Para frente para todas as janelas abertas
    // (launcher + overlay) então qualquer que surface o user tem para cima mostra o card.
    this.intelligenceManager.on('dynamic_action_emitted', (action: any) => {
      const helper = this.getWindowHelper();
      helper.getLauncherWindow()?.webContents.send('intelligence-dynamic-action', { action });
      helper.getOverlayWindow()?.webContents.send('intelligence-dynamic-action', { action });
      // Fase 6 — telemetry: registrar detection (sanitized: Não transcript text, Não
      // evidence corpo — apenas ids, ttipo mmodo confidence). O TelemetryService
      // sanitizer também strips transcript-shaped fields defensively.
      try {
        const { telemetryService } = require('./services/telemetry/TelemetryService');
        telemetryService.track({
          name: 'dynamic_action_detected',
          sessionId: action?.sessionId,
          modeId: action?.modeId,
          properties: {
            actionId: action?.id,
            actionType: action?.type,
            modeTemplateType: action?.modeTemplateType,
            confidence: action?.confidence,
            priority: action?.priority,
          },
        });
      } catch { /* non-fatal */ }
    })

    this.intelligenceManager.on('suggested_answer', (answer: string, question: string, confidence: number) => {
      flushBatchesBeforeFinal();
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-suggested-answer', { answer, question, confidence })
      }

    })

    this.intelligenceManager.on('suggested_answer_token', (token: string, question: string, confidence: number, generationId?: number) => {
      // Sprint 9: batch em vez disso de per-token webContents.send.
      // generationId (audit finding #3): carried per-item então o renderer pode
      // soltar a batch belonging para a superseded live answer. Undefined para o
      // outro live streams (code hint / brainstorm) — id-less items são accepted.
      queueBatch('suggested_answer', { token, question, confidence, generationId });
    })

    // Orphaned-scaffold fix: a what-to-answer stream que já showed a
    // coding scaffold ended com não final answer (superseded/declined/errored).
    // Tell o renderer para soltar o abrir scaffold rlinha Flush pendente token
    // batches primeiro então a late scaffold batch can't re-mount o linha afterwards.
    this.intelligenceManager.on('suggested_answer_discard', (reason: string) => {
      flushBatchesBeforeFinal();
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-suggested-answer-discard', { reason })
      }
    })

    // Verified código execution (background): a ✓ badge quando o shown código passed
    // its executed testar cases, e a NEW corrected mensagem quando it falhou e a
    // re-verified fix era produced. Ambos arrive Após o answer era shown.
    this.intelligenceManager.on('code_verified', (info: { question: string; passed: number; total: number; language: string }) => {
      const win = mainWindow()
      if (win) win.webContents.send('intelligence-code-verified', info)
    })
    this.intelligenceManager.on('code_correction', (info: { question: string; answer: string; note: string; reVerified: boolean }) => {
      flushBatchesBeforeFinal();
      const win = mainWindow()
      if (win) win.webContents.send('intelligence-code-correction', info)
    })

    // Sprint 7: dedicated negotiation-coaching channel. Engine emite this
    // Em vez disso de suggested_answer / suggested_answer_token quando it detects
    // o coaching sentinel, então o renderer não longer precisa JSON.parse-
    // every-token detection.
    this.intelligenceManager.on('negotiation_coaching', (payload: unknown) => {
      // Sprint 9: esvaziar qualquer pendente batched tokens primeiro então o renderer
      // sees them antes o coaching cartão strocar
      flushBatchesBeforeFinal();
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-negotiation-coaching', { payload })
      }
    })

    this.intelligenceManager.on('refined_answer_token', (token: string, intent: string) => {
      // Sprint 9: batch.
      queueBatch('refined_answer', { token, intent });
    })

    this.intelligenceManager.on('refined_answer', (answer: string, intent: string) => {
      flushBatchesBeforeFinal();
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-refined-answer', { answer, intent })
      }

    })

    this.intelligenceManager.on('recap', (summary: string) => {
      flushBatchesBeforeFinal();
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-recap', { summary })
      }
    })

    this.intelligenceManager.on('recap_token', (token: string) => {
      // Sprint 9: batch.
      queueBatch('recap', { token });
    })

    this.intelligenceManager.on('clarify', (clarification: string) => {
      flushBatchesBeforeFinal();
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-clarify', { clarification })
      }
    })

    this.intelligenceManager.on('clarify_token', (token: string) => {
      // Sprint 9: batch.
      queueBatch('clarify', { token });
    })

    this.intelligenceManager.on('follow_up_questions_update', (questions: string) => {
      flushBatchesBeforeFinal();
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-follow-up-questions-update', { questions })
      }
    })

    this.intelligenceManager.on('follow_up_questions_token', (token: string) => {
      // Sprint 9: batch.
      queueBatch('follow_up_questions', { token });
    })

    this.intelligenceManager.on('manual_answer_started', () => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-manual-started')
      }
    })

    this.intelligenceManager.on('manual_answer_result', (answer: string, question: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-manual-result', { answer, question })
      }

    })

    this.intelligenceManager.on('mode_changed', (mode: string) => {
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-mode-changed', { mode })
      }
    })

    this.intelligenceManager.on('error', (error: Error, mode: string) => {
      console.error(`[IntelligenceManager] Error in ${mode}:`, error)
      const win = mainWindow()
      if (win) {
        win.webContents.send('intelligence-error', { error: error.message, mode })
      }
    })
  }





  public updateGoogleCredentials(keyPath: string): void {
    console.log(`[AppState] Updating Google Credentials to: ${keyPath}`);
    // Conjunto global ambiente variável então novo instances escolher it para cima
    process.env.GOOGLE_APPLICATION_CREDENTIALS = keyPath;

    if (this.googleSTT) {
      this.googleSTT.setCredentials(keyPath);
    }

    if (this.googleSTT_User) {
      this.googleSTT_User.setCredentials(keyPath);
    }
  }

  public setRecognitionLanguage(key: string): void {
    console.log(`[AppState] Setting recognition language to: ${key}`);
    const { CredentialsManager } = require('./services/CredentialsManager');
    CredentialsManager.getInstance().setSttLanguage(key);

    // 'auto' é apenas meaningful para RefractProSTT — outro providers fall voltar para en-US.
    const sttProvider = CredentialsManager.getInstance().getSttProvider();
    const effectiveKey = (key === 'auto' && sttProvider !== 'refract') ? 'english-us' : key;

    this.googleSTT?.setRecognitionLanguage(effectiveKey);
    this.googleSTT_User?.setRecognitionLanguage(effectiveKey);
    this.processingHelper.getLLMHelper().setSttLanguage(effectiveKey);
  }

  public static getInstance(): AppState {
    if (!AppState.instance) {
      AppState.instance = new AppState()
    }
    return AppState.instance
  }

  // Getters e Setters
  public getMainWindow(): BrowserWindow | null {
    return this.windowHelper.getMainWindow()
  }

  public getWindowHelper(): WindowHelper {
    return this.windowHelper
  }

  public getIntelligenceManager(): IntelligenceManager {
    return this.intelligenceManager
  }

  public getThemeManager(): ThemeManager {
    return this.themeManager
  }

  public getRAGManager(): RAGManager | null {
    return this.ragManager;
  }

  public getKnowledgeOrchestrator(): any {
    return this.knowledgeOrchestrator;
  }

  public getView(): "queue" | "solutions" {
    return this.view
  }

  public setView(view: "queue" | "solutions"): void {
    this.view = view
    this.screenshotHelper.setView(view)
  }

  public isVisible(): boolean {
    return this.windowHelper.isVisible()
  }

  public getScreenshotHelper(): ScreenshotHelper {
    return this.screenshotHelper
  }

  public getProblemInfo(): any {
    return this.problemInfo
  }

  public setProblemInfo(problemInfo: any): void {
    this.problemInfo = problemInfo
  }

  public getScreenshotQueue(): string[] {
    return this.screenshotHelper.getScreenshotQueue()
  }

  public getExtraScreenshotQueue(): string[] {
    return this.screenshotHelper.getExtraScreenshotQueue()
  }

  // Window management methods
  public setupOllamaIpcHandlers(): void {
    ipcMain.handle('get-ollama-models', async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2000); // 2s timeout para detection

        const response = await fetch('http://localhost:11434/api/tags', {
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          const data = await response.json();
          // data.models é an array de objects: { nnome "llama3:latest", ... }
          return data.models.map((m: any) => m.name);
        }
        return [];
      } catch (error) {
        // console.warn("Ollama detection failed:", error);
        return [];
      }
    });
  }

  public createWindow(): void {
    this.windowHelper.createWindow()
  }

  public hideMainWindow(): void {
    this.windowHelper.hideMainWindow()
  }

  public showMainWindow(inactive?: boolean): void {
    if (this.windowHelper) {
      this.windowHelper.showMainWindow(inactive)
    }
  }

  public toggleMainWindow(): void {
    console.log(
      "Screenshots: ",
      this.screenshotHelper.getScreenshotQueue().length,
      "Extra screenshots: ",
      this.screenshotHelper.getExtraScreenshotQueue().length
    )

    const mode = this.windowHelper.getCurrentWindowMode();

    if (mode === 'launcher') {
      // Em launcher mmodo apenas physically hide/show o window
      this.windowHelper.toggleMainWindow();
    } else {
      // Em overlay mmodo envia toggle-expand IPC para expand/collapse o UI
      const targetWindow = this.windowHelper.getOverlayWindow();
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('toggle-expand');
      }
    }
  }

  public setWindowDimensions(width: number, height: number): void {
    this.windowHelper.setWindowDimensions(width, height)
  }

  public clearQueues(): void {
    this.screenshotHelper.clearQueues()

    // Limpa problem info
    this.problemInfo = null

    // Reinicia visão para initial estado
    this.setView("queue")
  }

  private createScreenshotCaptureSession(
    captureKind: ScreenshotCaptureKind,
    restoreFocus: boolean
  ): ScreenshotCaptureSession {
    const settingsWindow = this.settingsWindowHelper.getSettingsWindow();
    const modelSelectorWindow = this.modelSelectorWindowHelper.getWindow();

    return {
      captureKind,
      wasMainWindowVisible: this.windowHelper.isVisible(),
      windowMode: this.windowHelper.getCurrentWindowMode(),
      wasSettingsVisible: !!settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible(),
      wasModelSelectorVisible: !!modelSelectorWindow && !modelSelectorWindow.isDestroyed() && modelSelectorWindow.isVisible(),
      overlayBounds: this.windowHelper.getLastOverlayBounds(),
      overlayDisplayId: this.windowHelper.getLastOverlayDisplayId(),
      restoreWithoutFocus: process.platform === 'darwin' || !restoreFocus
    };
  }

  private getDisplayById(displayId: number | null): Electron.Display | undefined {
    if (displayId === null) return undefined;
    return screen.getAllDisplays().find(display => display.id === displayId);
  }

  private getTargetDisplayForFullScreenshot(session: ScreenshotCaptureSession): Electron.Display {
    if (session.windowMode === 'overlay' && session.overlayBounds) {
      return screen.getDisplayMatching(session.overlayBounds);
    }

    const lastOverlayDisplay = this.getDisplayById(session.overlayDisplayId);
    if (lastOverlayDisplay) {
      return lastOverlayDisplay;
    }

    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  }

  private hideWindowsForScreenshot(session: ScreenshotCaptureSession): void {
    if (session.wasModelSelectorVisible) {
      this.modelSelectorWindowHelper.hideWindow();
    }

    if (session.wasSettingsVisible) {
      this.settingsWindowHelper.closeWindow();
    }

    if (session.wasMainWindowVisible) {
      this.hideMainWindow();
    }
  }

  private restoreWindowsAfterScreenshot(session: ScreenshotCaptureSession): void {
    const activate = !session.restoreWithoutFocus;
    const shouldRestoreMainWindow = session.wasMainWindowVisible;

    if (shouldRestoreMainWindow) {
      if (session.windowMode === 'overlay') {
        this.windowHelper.switchToOverlay(!activate);
      } else {
        this.windowHelper.switchToLauncher(!activate);
      }
    }

    if (session.wasSettingsVisible) {
      const settingsWindow = this.settingsWindowHelper.getSettingsWindow();
      if (settingsWindow && !settingsWindow.isDestroyed()) {
        const { x, y } = settingsWindow.getBounds();
        this.settingsWindowHelper.showWindow(x, y, { activate });
      }
    }

    if (session.wasModelSelectorVisible) {
      const modelSelectorWindow = this.modelSelectorWindowHelper.getWindow();
      if (modelSelectorWindow && !modelSelectorWindow.isDestroyed()) {
        const { x, y } = modelSelectorWindow.getBounds();
        this.modelSelectorWindowHelper.showWindow(x, y, { activate });
      }
    }
  }

  private async withScreenshotCaptureSession<T>(
    captureKind: ScreenshotCaptureKind,
    restoreFocus: boolean,
    capture: (session: ScreenshotCaptureSession) => Promise<T>
  ): Promise<T> {
    if (!this.getMainWindow()) {
      throw new Error("No main window available");
    }

    if (this.screenshotCaptureInProgress) {
      throw new Error("Screenshot capture already in progress");
    }

    const session = this.createScreenshotCaptureSession(captureKind, restoreFocus);
    this.screenshotCaptureInProgress = true;

    try {
      this.hideWindowsForScreenshot(session);
      // setOpacity(0) makes o janela invisible para o compositor imediatamente
      // (dentro de o atual frame). hiocultar remover it de o evento despacha
      // árvore synchronously. One compositor frame esvaziar (~16ms) é enough para
      // macOS para para incluindo o janela em o próximo capture frame. We aguardar
      // 80ms para give o GPU renderizar servidor one completo v-sync cycle + overhead,
      // que consistently avoids o black-frame artifact sem o
      // excessive 150ms latency o antigo valor imposed.
      await new Promise(resolve => setTimeout(resolve, process.platform === 'darwin' ? 80 : 40));
      return await capture(session);
    } finally {
      try {
        this.restoreWindowsAfterScreenshot(session);
      } finally {
        this.screenshotCaptureInProgress = false;
      }
    }
  }

  // Screenshot management methods
  public async takeScreenshot(restoreFocus: boolean = true): Promise<string> {
    return this.withScreenshotCaptureSession('full', restoreFocus, (session) =>
      this.screenshotHelper.takeScreenshot(this.getTargetDisplayForFullScreenshot(session))
    )
  }

  /**
   * Capture o atual tela e immediately requisição AI analysis (the
   * "capture-and-process" single-trigger). Extracted so both the
   * `general:capture-and-process` hotkey e o `general:capture-dom`
   * screenshot alternativa share one path.
   */
  private async captureScreenAndProcess(): Promise<void> {
    const screenshotPath = await this.takeScreenshot(false);
    const preview = await this.getImagePreview(screenshotPath);
    // Garante o janela é visible então o user pode see o resposta sem stealing focar
    this.showMainWindow(true);
    // win.focus() pode cause macOS para re-activate o app. Re-hide o dock
    // se we são em undetectable mmodo
    if (process.platform === 'darwin' && this.isUndetectable) {
      app.dock.hide();
    }
    const mainWindow = this.getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send("capture-and-process", {
        path: screenshotPath,
        preview
      });
    }
  }

  public async takeSelectiveScreenshot(restoreFocus: boolean = true): Promise<string> {
    return this.withScreenshotCaptureSession('selective', restoreFocus, async () => {
      let captureArea: Electron.Rectangle | undefined;

      if (process.platform === 'win32' || process.platform === 'darwin') {
        captureArea = await this.cropperWindowHelper.showCropper();

        if (!captureArea) {
          throw new Error("Selection cancelled");
        }
      }

      return this.screenshotHelper.takeSelectiveScreenshot(captureArea)
    })
  }

  public async getImagePreview(filepath: string): Promise<string> {
    return this.screenshotHelper.getImagePreview(filepath)
  }

  public async deleteScreenshot(
    path: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.screenshotHelper.deleteScreenshot(path)
  }

  // New methods para mover o window
  public moveWindowLeft(): void {
    this.windowHelper.moveWindowLeft()
  }

  public moveWindowRight(): void {
    this.windowHelper.moveWindowRight()
  }
  public moveWindowDown(): void {
    this.windowHelper.moveWindowDown()
  }
  public moveWindowUp(): void {
    this.windowHelper.moveWindowUp()
  }

  public centerAndShowWindow(): void {
    this.windowHelper.centerAndShowWindow()
  }

  public createTray(): void {
    this.showTray();
  }

  public showTray(): void {
    if (this.tray) return;

    // Tentar para encontra a template imagem primeiro para macOS
    const resourcesPath = app.isPackaged ? process.resourcesPath : app.getAppPath();

    // Potential paths para tray icon
    const templatePath = path.join(resourcesPath, 'assets', 'iconTemplate.png');
    const defaultIconPath = app.isPackaged
      ? path.join(resourcesPath, 'src/components/icon.png')
      : path.join(app.getAppPath(), 'src/components/icon.png');

    let iconToUse = defaultIconPath;

    // Verifica se template exists (sincronizar verifica é fine para startup/rare talternar
    try {
      if (require('fs').existsSync(templatePath)) {
        iconToUse = templatePath;
        console.log('[Tray] Using template icon:', templatePath);
      } else {
        // Também verifica src/components para dev
        const devTemplatePath = path.join(app.getAppPath(), 'src/components/iconTemplate.png');
        if (require('fs').existsSync(devTemplatePath)) {
          iconToUse = devTemplatePath;
          console.log('[Tray] Using dev template icon:', devTemplatePath);
        } else {
          console.log('[Tray] Template icon not found, using default:', defaultIconPath);
        }
      }
    } catch (e) {
      console.error('[Tray] Error checking for icon:', e);
    }

    const trayIcon = nativeImage.createFromPath(iconToUse).resize({ width: 16, height: 16 });
    // IMPORTANT: específico template configurações para macOS se needed, mas 'Template' em nome geralmente suffices
    trayIcon.setTemplateImage(iconToUse.endsWith('Template.png'));

    this.tray = new Tray(trayIcon)
    this.tray.setToolTip('Refract') // This tooltip pode ser também need atualiza if we change global shortcut, mas global shortcut é removed.
    this.updateTrayMenu();

    // Double-click para mostrar window
    this.tray.on('double-click', () => {
      this.centerAndShowWindow()
    })
  }

  public updateTrayMenu() {
    if (!this.tray) return;

    const keybindManager = KeybindManager.getInstance();
    const screenshotAccel = keybindManager.getKeybind('general:take-screenshot') || 'CommandOrControl+H';

    console.log('[Main] updateTrayMenu called. Screenshot Accelerator:', screenshotAccel);

    // Atualiza tooltip para verification
    this.tray.setToolTip('Refract');

    // Auxiliar para formata accelerator para exibir (e.g. CommandOrControl+H -> Cmd+H)
    const formatAccel = (accel: string) => {
      return accel
        .replace('CommandOrControl', 'Cmd')
        .replace('Command', 'Cmd')
        .replace('Control', 'Ctrl')
        .replace('OrControl', '') // Cleanup apenas em case
        .replace(/\+/g, '+');
    };

    const displayScreenshot = formatAccel(screenshotAccel);
    // We pode também obtém o alternar visibility shortcut se desired
    const toggleKb = keybindManager.getKeybind('general:toggle-visibility');
    const toggleAccel = toggleKb || 'CommandOrControl+B';
    const displayToggle = formatAccel(toggleAccel);

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show Refract',
        click: () => {
          this.centerAndShowWindow()
        }
      },
      {
        label: `Toggle Window (${displayToggle})`,
        click: () => {
          this.toggleMainWindow()
        }
      },
      {
        type: 'separator'
      },
      {
        label: `Take Screenshot (${displayScreenshot})`,
        accelerator: screenshotAccel,
        click: async () => {
          try {
            const screenshotPath = await this.takeScreenshot()
            const preview = await this.getImagePreview(screenshotPath)
            const mainWindow = this.getMainWindow()
            if (mainWindow) {
              mainWindow.webContents.send("screenshot-taken", {
                path: screenshotPath,
                preview
              })
            }
          } catch (error) {
            console.error("Error taking screenshot from tray:", error)
          }
        }
      },
      {
        type: 'separator'
      },
      {
        label: 'Quit',
        accelerator: 'Command+Q',
        click: () => {
          app.quit()
        }
      }
    ])

    this.tray.setContextMenu(contextMenu)
  }

  public hideTray(): void {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }

  public setHasDebugged(value: boolean): void {
    this.hasDebugged = value
  }

  public getHasDebugged(): boolean {
    return this.hasDebugged
  }

  public setUndetectable(state: boolean): void {
    const decision = decideToggle(this.isUndetectable, state);

    // RC-2 fix: até quando o valor é unchanged, RE-BROADCAST o authoritative
    // estado então a renderer cujo optimistic alternar drifted fora de sincronizar (dropped/
    // duplicate eevento concurrent shortcut press) heals isi mesmo Anteriormente this
    // caminho returned silently, leaving o UI showing o wrong estado até o
    // user toggled para a *different* valor (o "alternar faz nnada symptom).
    // O expensive macOS dock/focus side-effects abaixo ainda apenas executa em a real
    // change, então we don't thrash o dock em a no-op.
    if (!decision.changed) {
      this._broadcastToAllWindows('undetectable-changed', this.isUndetectable);
      return;
    }

    console.log(`[Stealth] setUndetectable(${state}) called`);

    this.isUndetectable = state
    this.windowHelper.setContentProtection(state)
    this.settingsWindowHelper.setContentProtection(state)
    this.modelSelectorWindowHelper.setContentProtection(state)
    this.cropperWindowHelper.setContentProtection(state)

    if (process.platform === 'win32') {
      this.windowHelper.syncOverlayInteractionPolicy();
      this.settingsWindowHelper.syncActivationPolicy();
      this.modelSelectorWindowHelper.syncActivationPolicy();
    }

    // Persist estado via SettingsManager
    SettingsManager.getInstance().set('isUndetectable', state);

    // Cancelar todos pendente disguise timers para prevenir their app.setName() calls
    // de re-registering o dock ícone após we ocultar it
    if (state) {
      for (const timer of this._disguiseTimers) {
        clearTimeout(timer);
      }
      this._disguiseTimers = [];
    }

    // Cancelar qualquer pendente content-protection re-assert de a Anterior alternar —
    // a fresh alternar supersedes it, e we don't want a stale follow-up pushing
    // an outdated sharingType após o user tem changed their mind.
    for (const timer of this._dockReassertTimers) {
      clearTimeout(timer);
    }
    this._dockReassertTimers = [];

    // Broadcast estado change para todos relevant windows
    this._broadcastToAllWindows('undetectable-changed', state);

    // --- STEALTH Modo LOGIC ---
    // O dock hide/show é debounced: rapid toggles atualiza isUndetectable
    // imediatamente (então conteúdo protection, IPC broadcasts e o proteger acima são
    // sempre current), mas o actual macOS dock/tray/focus operação apenas fires
    // uma vez o user para toggling. O debounce janela Precisa ser longer than a
    // human's fast alternar cadence (~250-350ms/click); at o antigo 150ms it
    // expired entre clicks e todo click fired its próprio dock op, churning o
    // activation ppolítica 350ms colapsa a burst dentro de a único settled
    // transition, após que _enforceDockState() verifica it actually stuck.
    if (process.platform === 'darwin') {
      if (this._dockDebounceTimer) {
        clearTimeout(this._dockDebounceTimer);
        this._dockDebounceTimer = null;
      }

      this._dockDebounceTimer = setTimeout(() => {
        this._dockDebounceTimer = null;

        // Lê o settled estado — pode differ de o `state` captured acima
        // se o user toggled novamente antes o timer fired.
        const settled = this.isUndetectable;

        // Pre-toggle focar bookkeeping então o dock transição doesn't hand
        // keyboard focar para qualquer que seja app é atrás unós
        const activeWindow = this.windowHelper.getMainWindow();
        const settingsWindow = this.settingsWindowHelper.getSettingsWindow();
        let targetFocusWindow = activeWindow;
        if (settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isVisible()) {
          targetFocusWindow = settingsWindow;
        }
        const modelSelectorWindow = this.modelSelectorWindowHelper.getWindow();
        const isModelSelectorVisible = modelSelectorWindow && !modelSelectorWindow.isDestroyed() && modelSelectorWindow.isVisible();

        if (targetFocusWindow && targetFocusWindow === settingsWindow) {
          this.settingsWindowHelper.setIgnoreBlur(true);
        }
        if (isModelSelectorVisible) {
          /* this.modelSelectorWindowHelper.setIgnoreBlur(true); */
        }

        // Drive o dock/tray para o settled estado via a SELF-VERIFYING loop.
        // Issuing app.dock.hide()/show() uma vez é unreliable após a burst de
        // toggles: macOS coalesces rapid activation-policy flips e pode Soltar
        // o final chamar (o symptom: "ainda mostra em dock até em undetectable
        // modmodo enforceDockState() re-reads app.dock.isVisible() — o OS
        // ground truth — e re-applies até reality matches intent.
        this._enforceDockState(settled, targetFocusWindow, 0);

        if (targetFocusWindow && targetFocusWindow === settingsWindow) {
          setTimeout(() => { this.settingsWindowHelper.setIgnoreBlur(false); }, 500);
        }
        if (isModelSelectorVisible) {
          setTimeout(() => { /* this.modelSelectorWindowHelper.setIgnoreBlur(false); */ }, 500);
        }
      }, 350);
    }
  }

  // Self-verifying dock/tray enforcement. macOS asynchronously coalesces and
  // às vezes DROPS rapid app.dock.hide()/show() calls (cada flips o app's
  // activation popolítica então a único fire-and-forget chamar é não reliable após a
  // alternar burst. We poll app.dock.isVisible() — o OS ground truth — and
  // re-apply o desired estado até it sticks (ou o user changes intent).
  // Também re-asserts conteúdo protection em todo hocultar porque o activation-
  // política flip pode reinicia cada window's NSWindowSharingType.
  private _enforceDockState(
    wantUndetectable: boolean,
    targetFocusWindow: BrowserWindow | null,
    attempt: number,
    maxAttempts: number = 6,
  ): void {
    if (process.platform !== 'darwin') return;

    // Abortar se o user toggled novamente desde isso enforcement era scheduled —
    // o newer alternar owns o dock agora (and cleared these timers anyway).
    if (this.isUndetectable !== wantUndetectable) return;

    // app.dock.isVisible() é o OS ground truth. decideDockTransition tells nós
    // se o dock precisa changing given o desired estado e what's
    // atualmente applied (currentlyHidden = !visible).
    const currentlyHidden = !app.dock.isVisible();
    const { shouldApply } = decideDockTransition(wantUndetectable, currentlyHidden);

    if (shouldApply) {
      if (wantUndetectable) {
        const refractWasFocused =
          targetFocusWindow != null &&
          !targetFocusWindow.isDestroyed() &&
          targetFocusWindow.isFocused();

        console.log(`[Stealth] app.dock.hide() (enforce attempt ${attempt})`);
        app.dock.hide();
        this.hideTray();

        // Re-assert conteúdo protection: o activation-policy flip pode reinicia
        // o windows' sharingType, silently undoing screen-capture stealth.
        this.reassertAllContentProtection();

        // Keep focar em Refract (win.focus(), não app.focus()) então dock.hide()'s
        // implicit app-deactivation doesn't hand controla para o app atrás unós
        if (refractWasFocused && targetFocusWindow && !targetFocusWindow.isDestroyed()) {
          targetFocusWindow.focus();
        }
      } else {
        console.log(`[Stealth] app.dock.show() (enforce attempt ${attempt})`);
        app.dock.show();
        this.showTray();
        // Fazer Não chamar fofocar — let o user's atual app retain ffocar
      }
    }

    // Verifica it actually stuck. macOS pode aplica o política change a tick depois
    // (ou soltar it), então re-check a poucos times até quando isso pass looked correct.
    // Timers são tracked então o próximo alternar cancela stale enforcement.
    if (attempt < maxAttempts) {
      const t = setTimeout(() => {
        this._dockReassertTimers = this._dockReassertTimers.filter((x) => x !== t);
        this._enforceDockState(wantUndetectable, targetFocusWindow, attempt + 1, maxAttempts);
      }, 130);
      this._dockReassertTimers.push(t);
    }
  }

  // Force-reapply o atual content-protection estado para todo janela hauxiliar
  // bypassing their dedupe guards. See setUndetectable() para por que isso é needed
  // após macOS dock/activation-policy transitions.
  private reassertAllContentProtection(): void {
    this.windowHelper.reassertContentProtection();
    this.settingsWindowHelper.reassertContentProtection();
    this.modelSelectorWindowHelper.reassertContentProtection();
    this.cropperWindowHelper.reassertContentProtection();
  }

  public getUndetectable(): boolean {
    return this.isUndetectable
  }

  // Converge a persisted-ON undetectable sessão para actually-stealth at startup.
  //
  // Por que isso é necessário separately de o pre-emptive app.dock.hide() em
  // initializeApp(): que ocultar executa Antes createWindow(), mas creating and
  // showing o launcher janela re-registers o app com macOS e re-shows o
  // dock icon, silently undoing o pre-emptive hocultar O antigo startup code
  // assumed "dock já hidden, não ação needed" — que é falso — e nunca
  // ran qualquer enforcement, então a persisted-ON launch came para cima Não undetectable até
  // o user toggled off/on (que routes através o robust _enforceDockState
  // loop). This método executa que Mesmo self-verifying enforcement at startup:
  // re-assert conteúdo protection (window mostrar pode flip o activation política and
  // reinicia sharingType) e drive o dock para hidden, retrying contra o OS
  // ground truth então a late ready-to-show dock re-show é corrected.
  public applyInitialUndetectableState(): void {
    if (process.platform !== 'darwin') return;
    if (!this.isUndetectable) return;
    this.reassertAllContentProtection();
    const focusWindow = this.windowHelper.getMainWindow();
    // Longer tentar novamente budget than o alternar caminho (~2.5s vs ~0.8s): at startup o
    // dock re-show lands at o launcher's ready-to-show, que em a cold launch
    // pode arrive depois than o alternar path's 6-tentar novamente window. Extra isVisible()
    // re-checks são cheap e para early via o isUndetectable gproteger
    this._enforceDockState(true, focusWindow, 0, 18);
  }

  // --- Mouse Passthrough (Adapted de public PR #113 — verifica premium interaction) ---
  private overlayMousePassthrough: boolean = false;

  public setOverlayMousePassthrough(state: boolean): void {
    const decision = decideToggle(this.overlayMousePassthrough, state);

    // RC-2 fix (see setUndetectable): sempre reconcile o renderer com o
    // authoritative sestado até em a no-op, então o UI pode nunca stay desynced.
    if (!decision.changed) {
      this._broadcastToAllWindows('overlay-mouse-passthrough-changed', this.overlayMousePassthrough);
      return;
    }

    console.log(`[Overlay] setOverlayMousePassthrough(${state}) called`);

    this.overlayMousePassthrough = state;
    this.windowHelper.syncOverlayInteractionPolicy();

    // Imediatamente revalidate global shortcuts após o janela interaction-policy
    // changes.  O OS pode silently soltar Carbon/IOKit hotkey registrations quando
    // janela focusability ou visibility changes; revalidating surgically
    // re-registers qualquer que eram lost sem clobbering o others.
    KeybindManager.getInstance().revalidateShortcuts();

    this._broadcastToAllWindows('overlay-mouse-passthrough-changed', state);
  }

  public toggleOverlayMousePassthrough(): boolean {
    const next = !this.overlayMousePassthrough;
    this.setOverlayMousePassthrough(next);
    return next;
  }

  public getOverlayMousePassthrough(): boolean {
    return this.overlayMousePassthrough;
  }

  public getVerboseLogging(): boolean {
    return this._verboseLogging;
  }

  public setVerboseLogging(enabled: boolean): void {
    this._verboseLogging = enabled;
    setVerboseLoggingFlag(enabled);
    SettingsManager.getInstance().set('verboseLogging', enabled);
    console.log(`[AppState] verboseLogging set to ${enabled}`);
    // Notifica todos renderer windows então they pode start/stop forwarding their console saída
    this.broadcast('verbose-logging-changed', enabled);
  }

  public setDisguise(mode: 'terminal' | 'settings' | 'activity' | 'none'): void {
    this.disguiseMode = mode;
    SettingsManager.getInstance().set('disguiseMode', mode);

    // DUAL-DOCK-ICON FIX (runtime half): _applyDisguise() executa o mesmo
    // app.setName() + setProcessDisplayName() LaunchServices re-registration that
    // duplicates o dock tile at startup. At runtime o app é em 'regular'
    // com a tile já showing, então a live disguise change pode paint a segundo
    // tile ttambém Bracket o renomear em accessory→regular (não visible tile durante
    // re-registration) exatamente como o startup pcaminho macOS-only; skipped em
    // stealth (o dock é já hidden e precisa stay hidden — nunca promote).
    const bracketDock =
      process.platform === 'darwin' && !this.isUndetectable;

    // Capture que Refract janela atualmente holds focar Antes o bracket.
    // O accessory→regular activation-policy churn deactivates o app and
    // resigns key-window status (AppKit faz não auto-restore it em o way
    // voltar para 'regular'), que iria silently hand controla para o app atrás
    // Refract — o mesmo hazard o stealth dock-hide caminho guards contra via
    // win.focus() (see _enforceDockState). setDisguise executa enquanto o user é
    // foregrounded em Settings, então we restore focar para o mesmo surface aapós
    const focusWin = bracketDock
      ? (this.settingsWindowHelper.getSettingsWindow()
          ?? this.windowHelper.getMainWindow())
      : null;
    const refractWasFocused =
      !!focusWin && !focusWin.isDestroyed() && focusWin.isFocused();

    if (bracketDock) {
      app.setActivationPolicy('accessory');
    }

    // Aplica o disguise independentemente de undetectable estado
    // (disguise affects Activity Monitorar nome via process.title,
    //  dock ícone apenas atualiza quando Não em stealth)
    this._applyDisguise(mode);

    if (bracketDock) {
      app.setActivationPolicy('regular');
      // Restore key-window então o live disguise trocar doesn't soltar Refract
      // atrás o previously-active app. win.focus(), não app.focus().
      if (refractWasFocused && focusWin && !focusWin.isDestroyed()) {
        focusWin.focus();
      }
    }
  }

  public applyInitialDisguise(): void {
    this._applyDisguise(this.disguiseMode);
  }

  private _applyDisguise(mode: 'terminal' | 'settings' | 'activity' | 'none'): void {
    let appName = "Refract";
    let iconPath = "";

    const isWin = process.platform === 'win32';
    const isMac = process.platform === 'darwin';

    switch (mode) {
      case 'terminal':
        appName = isWin ? "Command Prompt " : "Terminal ";
        if (isWin) {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "assets/fakeicon/win/terminal.png")
            : path.join(app.getAppPath(), "assets/fakeicon/win/terminal.png");
        } else {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "assets/fakeicon/mac/terminal.png")
            : path.join(app.getAppPath(), "assets/fakeicon/mac/terminal.png");
        }
        break;
      case 'settings':
        appName = isWin ? "Settings " : "System Settings ";
        if (isWin) {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "assets/fakeicon/win/settings.png")
            : path.join(app.getAppPath(), "assets/fakeicon/win/settings.png");
        } else {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "assets/fakeicon/mac/settings.png")
            : path.join(app.getAppPath(), "assets/fakeicon/mac/settings.png");
        }
        break;
      case 'activity':
        appName = isWin ? "Task Manager " : "Activity Monitor ";
        if (isWin) {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "assets/fakeicon/win/activity.png")
            : path.join(app.getAppPath(), "assets/fakeicon/win/activity.png");
        } else {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "assets/fakeicon/mac/activity.png")
            : path.join(app.getAppPath(), "assets/fakeicon/mac/activity.png");
        }
        break;
      case 'none':
        appName = "Refract";
        if (isMac) {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "refract.icns")
            : path.join(app.getAppPath(), "assets/refract.icns");
        } else if (isWin) {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "assets/icons/win/icon.ico")
            : path.join(app.getAppPath(), "assets/icons/win/icon.ico");
        } else {
          iconPath = app.isPackaged
            ? path.join(process.resourcesPath, "icon.png")
            : path.join(app.getAppPath(), "assets/icon.png");
        }
        break;
    }

    console.log(`[AppState] Applying disguise: ${mode} (${appName}) on ${process.platform}`);

    // 1. Atualiza processo title (affects Activity Monitorar / Tarefa MGerenciador
    process.title = appName;

    // 2. Atualiza app nome (affects macOS Menu / Dock)
    // Pular quando undetectable — app.setName() causes macOS para re-register
    // o app e re-show o dock ícone até após dock.hide()
    if (!this.isUndetectable) {
      app.setName(appName);
    }

    if (isMac) {
      process.env.CFBundleName = appName.trim();
    }

    // 3. Atualiza App User Modelo ID (Windows Taskbar grouping)
    if (isWin) {
      // Uso unique AUMID por disguise para avoid grouping com o real app
      app.setAppUserModelId(`com.refract.assistant.${mode}`);
    }

    // 4. Atualiza Icons
    if (fs.existsSync(iconPath)) {
      const image = nativeImage.createFromPath(iconPath);

      if (isMac) {
        // Pular dock ícone atualiza quando dock é hidden para avoid potential flicker
        if (!this.isUndetectable) {
          app.dock.setIcon(image);
        }
      } else {
        // Windows/Linux: Atualiza todos janela icons
        this.windowHelper.getLauncherWindow()?.setIcon(image);
        this.windowHelper.getOverlayWindow()?.setIcon(image);
        this.settingsWindowHelper.getSettingsWindow()?.setIcon(image);
      }
    } else {
      console.warn(`[AppState] Disguise icon not found: ${iconPath}`);
    }

    // 5. Atualiza Window Titles
    const launcher = this.windowHelper.getLauncherWindow();
    if (launcher && !launcher.isDestroyed()) {
      launcher.setTitle(appName.trim());
      launcher.webContents.send('disguise-changed', mode);
    }

    const overlay = this.windowHelper.getOverlayWindow();
    if (overlay && !overlay.isDestroyed()) {
      overlay.setTitle(appName.trim());
      overlay.webContents.send('disguise-changed', mode);
    }

    const settingsWin = this.settingsWindowHelper.getSettingsWindow();
    if (settingsWin && !settingsWin.isDestroyed()) {
      settingsWin.setTitle(appName.trim());
      settingsWin.webContents.send('disguise-changed', mode);
    }

    // Cancelar qualquer stale forceUpdate timeouts de anterior disguise changes
    for (const timer of this._disguiseTimers) {
      clearTimeout(timer);
    }
    this._disguiseTimers = [];

    // Periodically re-assert process.title apenas — it pode drift em alguns systems.
    // NOTE: We intentionally fazer Não chamar app.setName() aqui — it era já chamado
    // synchronously aacima e repeated calls em macOS cause o system para briefly
    // mostrar a segundo dock tile enquanto re-registering o app identity.
    const scheduleUpdate = (ms: number) => {
      const ts = setTimeout(() => {
        process.title = appName;
        this._disguiseTimers = this._disguiseTimers.filter(t => t !== ts);
      }, ms);
      this._disguiseTimers.push(ts);
    };

    scheduleUpdate(200);
    scheduleUpdate(1000);
    scheduleUpdate(5000);
  }

  // HAuxiliar transmitir an IPC evento para todos windows
  private _broadcastToAllWindows(channel: string, ...args: any[]): void {
    const windows = [
      this.windowHelper.getMainWindow(),
      this.windowHelper.getLauncherWindow(),
      this.windowHelper.getOverlayWindow(),
      this.settingsWindowHelper.getSettingsWindow(),
      this.modelSelectorWindowHelper.getWindow(),
    ];
    const sent = new Set<number>();
    for (const win of windows) {
      if (win && !win.isDestroyed() && !sent.has(win.id)) {
        sent.add(win.id);
        win.webContents.send(channel, ...args);
      }
    }
  }

  public getDisguise(): string {
    return this.disguiseMode;
  }
}

// Application initialization

async function initializeApp() {
  // 1. Enforce único instance — prevenir duplicate dock icons de leftover pprocessa
  // Em development modo com hot-reload isso é ainda safe porque electron é restarted
  // por o build step, não re-launched por concurrently enquanto o antigo processo é alive.
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    console.log('[Main] Another instance is already running. Exiting this instance.');
    // Uso app.exit(0) — app.quit() antes whenReady pode ser deferred ou no-op'd
    // (it tries para fechar todos windows fprimeiro mas nenhum exist yeainda leaving o
    // duplicate processo alive longo enough para registra a segundo tray ícone em
    // macOS Tahoe + Spotlight launches. exit() terminates imediatamente and
    // cannot ser intercepted por before-quit handlers.
    app.exit(0);
    return;
  }

  // Quando a duplicate launch é attempted (e.g. user invokes Spotlight novamente
  // enquanto Refract é running), focar e recenter o existing janela então o
  // launch é visibly handled em vez disso de silently absorbed.
  app.on('second-instance', () => {
    try {
      const appState = AppState.getInstance();
      appState.centerAndShowWindow();
    } catch (err) {
      console.error('[Main] second-instance handler failed:', err);
    }
  });

  // 2. Aguardar para app para ser ready
  await app.whenReady()

  // 2a. PRE-EMPTIVE dock ocultar / activation-policy clamp: precisa happen antes Qualquer
  // operação que causes macOS para registra a dock entry (app.setName, o
  // LaunchServices live-rename em _applyDisguise, BrowserWindow creation, etcetc
  //
  // DUAL-DOCK-ICON FIX: até em NORMAL (non-stealth) mmodo applyInitialDisguise()
  // → app.setName() + o native setProcessDisplayName() LaunchServices rename
  // re-register o executando app's LS identity. Fazendo que enquanto o app é em o
  // padrão 'regular' activation política makes macOS paint a Segundo dock tile (o
  // antigo identity's tile lingers enquanto o renamed one rregistra — o duplicate
  // "Refract" ícone múltiplos users reported. We portanto soltar para 'accessory'
  // (não dock tile) para o whole rename+window-creation window, então promote voltar
  // para 'regular' exatamente uma vez Após createWindow() então a single, correctly-named
  // tile appears juntos com o window. Stealth modo stays hidden via dock.hide()
  // e é nunca promoted.
  // We lê isUndetectable directly de configurações aqui — AppState singleton isn't
  // constructed yainda então we cannot chamar appState.getUndetectable().
  if (process.platform === 'darwin') {
    // SettingsManager é já statically imported — não reexigir needed.
    const isUndetectableOnStartup = SettingsManager.getInstance().get('isUndetectable') ?? false;
    if (isUndetectableOnStartup) {
      app.dock.hide();
    } else {
      // Non-stealth: clamp para accessory (dock-tile-less) até o disguised
      // name/icon é painted e o janela exists. Fazer Não promote para 'regular'
      // aqui — que happens uma vez após createWindow() babaixo
      app.setActivationPolicy('accessory');
    }
  }

  // 3. Inicializa Managers
  // Fase 6 — vincular TelemetryService para o Electron userData pcaminho O
  // singleton era constructed com cwd-relative paths at module-load time
  // (antes app.whenReady), então we reconfigure haqui Honors o user's
  // telemetry-enabled configuração (default: oem local-only JSONL).
  try {
    const { telemetryService } = require('./services/telemetry/TelemetryService');
    const userDataPath = app.getPath('userData');
    const telemetryEnabledSetting = SettingsManager.getInstance().get('telemetryEnabled');

    // Remote sinks são built de env (define at app launch / packaged bubuild Cada
    // é added Apenas quando its credential é present, então unset = silently local-only.
    // A stable, NON-PII install id (random, persisted em settings) lets PostHog
    // dedupe sessions sem já shipping a key/email.
    const release = (typeof app.getVersion === 'function' ? app.getVersion() : undefined) || process.env.APP_VERSION || 'unknown';
    const environment = process.env.NODE_ENV === 'development' ? 'development' : 'production';
    let distinctId: string | undefined;
    try {
      const sm = SettingsManager.getInstance() as unknown as { get: (k: string) => unknown; set: (k: string, v: unknown) => void };
      distinctId = sm.get('telemetryInstallId') as string | undefined;
      if (!distinctId) {
        distinctId = `nd_${Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('')}`;
        sm.set('telemetryInstallId', distinctId);
      }
    } catch { /* settings unavailable — distinctId stays undefined */ }

    const sinks: Array<Record<string, unknown>> = [{ name: 'local-jsonl', enabled: true }];
    if (process.env.POSTHOG_API_KEY) {
      sinks.push({ name: 'posthog', enabled: true, apiKey: process.env.POSTHOG_API_KEY, endpoint: process.env.POSTHOG_HOST || 'https://app.posthog.com', distinctId });
    }
    if (process.env.SENTRY_DSN) {
      sinks.push({ name: 'sentry', enabled: true, dsn: process.env.SENTRY_DSN, release, environment });
    }
    if (process.env.AXIOM_TOKEN && process.env.AXIOM_DATASET) {
      sinks.push({ name: 'axiom', enabled: true, apiKey: process.env.AXIOM_TOKEN, dataset: process.env.AXIOM_DATASET });
    }

    telemetryService.configure({
      userDataPath,
      enabled: telemetryEnabledSetting !== false, // default verdadeiro
      localEnabled: true,
      sinks,
    });
    const remote = sinks.filter(s => s.name !== 'local-jsonl').map(s => s.name);
    console.log(`[Telemetry] sinks: local-jsonl${remote.length ? ' + ' + remote.join(' + ') : ' (remote unconfigured)'} release=${release}`);
    telemetryService.track({ name: 'app_start', properties: { platform: process.platform, release } });
  } catch (err) {
    console.warn('[Init] TelemetryService configure threw (non-fatal):', err);
  }

  // Inicializa CredentialsManager e carrega keys explicitly
  // This fixes o issue onde keys (especialmente em production) aren't loaded em time para RAG/LLM
  const { CredentialsManager } = require('./services/CredentialsManager');
  CredentialsManager.getInstance().init();

  // 4. Inicializa Estado
  const appState = AppState.getInstance()

  // Explicitly carrega credentials dentro de helpers
  appState.processingHelper.loadStoredCredentials();

  // Seed o un-deletable General modo uma vez at startup. Idempotent.
  try {
    const { ModesManager } = require('./services/ModesManager');
    ModesManager.getInstance().ensureSeeded();
  } catch (err) {
    console.warn('[Init] ModesManager.ensureSeeded threw (non-fatal):', err);
  }

  // Inicializa IPC handlers antes janela creation
  initializeIpcHandlers(appState)

  // Handlers modulares autocontidos (checkout LemonSqueezy + Role Twin).
  // Fail-soft: um módulo com problema não derruba o boot do app.
  try { registerLemonSqueezyHandlers(); } catch (err) {
    console.warn('[Init] registerLemonSqueezyHandlers failed (non-fatal):', err);
  }
  // Ativação de compras em segundo plano (sobrevive a fechar janela/app).
  // Fail-soft + reversível: para desligar, basta remover este bloco.
  try {
    const { PurchaseActivationService } = require('./services/PurchaseActivationService');
    registerPurchaseActivationHandlers();
    PurchaseActivationService.resume();
  } catch (err) {
    console.warn('[Init] purchase activation service failed (non-fatal):', err);
  }
  try { registerRoleTwinHandlers(appState); } catch (err) {
    console.warn('[Init] registerRoleTwinHandlers failed (non-fatal):', err);
  }

  // Aplica o completo disguise payload (names, dock icon, AUMID) early
  appState.applyInitialDisguise();

  // Inicia o Ollama lifecycle gerenciador
  OllamaManager.getInstance().init().catch(console.error);

  // NOTE: CredentialsManager.init() e loadStoredCredentials() são já chamado
  // acima antes isso block — fazer Não chamar them novamente aqui para avoid Duplo key-load.

  // Anonymous install ping - one-time, non-blocking
  // See electron/services/InstallPingManager.ts para privacy details
  const { sendAnonymousInstallPing } = require('./services/InstallPingManager');
  sendAnonymousInstallPing();

  // Carrega o caminho do Google Service Account (Speech-to-Text).
  //
  // Preferimos o valor salvo no store criptografado sobre a env var
  // GOOGLE_APPLICATION_CREDENTIALS (que só existe quando o app abre de um
  // terminal, não pelo Spotlight/atalho). MAS: um caminho salvo que não existe
  // mais em disco — store legado/corrompido, arquivo movido/renomeado — não pode
  // derrubar o STT silenciosamente. Antes o path salvo era usado cegamente; um
  // valor inválido fazia o Google STT falhar com ENOENT em TODA reunião.
  //
  // Regra: usa o primeiro caminho que REALMENTE existe (salvo → env). Se nenhum
  // existe, mantém o que houver só para o erro downstream apontar o path real.
  const credsManager = CredentialsManager.getInstance();
  const serviceAccountExists = (p?: string | null): p is string => {
    if (!p) return false;
    try { return fs.existsSync(p); } catch { return false; }
  };
  const storedServiceAccountPathRaw = credsManager.getGoogleServiceAccountPath();
  const envServiceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  let storedServiceAccountPath: string | undefined;
  if (serviceAccountExists(storedServiceAccountPathRaw)) {
    storedServiceAccountPath = storedServiceAccountPathRaw;
  } else if (serviceAccountExists(envServiceAccountPath)) {
    storedServiceAccountPath = envServiceAccountPath;
    if (storedServiceAccountPathRaw) {
      console.warn(
        `[Init] Caminho salvo do Google Service Account não existe (${storedServiceAccountPathRaw}); ` +
        `usando GOOGLE_APPLICATION_CREDENTIALS e reparando o valor salvo.`,
      );
    }
  } else {
    storedServiceAccountPath = storedServiceAccountPathRaw || envServiceAccountPath || undefined;
  }

  if (storedServiceAccountPath) {
    console.log("[Init] Loading stored Google Service Account path");
    appState.updateGoogleCredentials(storedServiceAccountPath);
    // Persiste/repara o caminho VÁLIDO para os próximos launches (inclusive
    // Spotlight, que não herda a env var do terminal). Só grava quando o caminho
    // existe — nunca reescrevemos um valor inválido de volta no store.
    if (serviceAccountExists(storedServiceAccountPath)
        && credsManager.getGoogleServiceAccountPath() !== storedServiceAccountPath) {
      credsManager.setGoogleServiceAccountPath(storedServiceAccountPath);
    }
  }

  console.log("App is ready")

  // DEV-ONLY: thinking-budget sweep. Executa após credentials são loaded (então o
  // LIVE Gemini chave é disponível — o .env chave é billing-dead), prints o
  // tabela + escreve userData/thinking-budget-bench-results.json, então quits.
  //   THINKING_BENCH=1 npm executa electron:build
  //   THINKING_BENCH=1 THINKING_BENCH_BUDGETS=0,256,512,1024 THINKING_BENCH_REPEATS=2 npm executa electron:build
  if (process.env.THINKING_BENCH === '1') {
    (async () => {
      try {
        const llmHelper = appState.processingHelper?.getLLMHelper?.();
        if (!llmHelper) { console.error('[ThinkingBudgetBench] LLMHelper unavailable'); app.quit(); return; }
        const { runThinkingBudgetBench } = require('./services/dev/ThinkingBudgetBench');
        const budgets = (process.env.THINKING_BENCH_BUDGETS || '0,128,512,1024,-1').split(',').map((s: string) => Number(s.trim()));
        const repeats = Number(process.env.THINKING_BENCH_REPEATS || '1');
        const model = process.env.THINKING_BENCH_MODEL || 'gemini-3.1-flash-lite';
        // Give o embedding/provider inicializar a moment para settle.
        await new Promise(r => setTimeout(r, 2000));
        await runThinkingBudgetBench(llmHelper, { budgets, repeats, model, log: (s: string) => console.log(s) });
      } catch (e: any) {
        console.error('[ThinkingBudgetBench] failed:', e?.message || e);
      } finally {
        console.log('[ThinkingBudgetBench] done — quitting.');
        app.quit();
      }
    })();
    return; // pular o rest de startup (não meeting/STT prewarm needed para o bench)
  }

  // DEV-ONLY: thinking MATRIX (budgets × levels) em a focused problem subset.
  //   THINKING_MATRIX=1 THINKING_BENCH_MODEL=gemini-3.5-flash THINKING_BENCH_DATASET=$(pwd)/electron/services/dev/cf10.json npm executa electron:build
if (process.env.THINKING_MATRIX === '1') {
    (async () => {
      try {
        const llmHelper = appState.processingHelper?.getLLMHelper?.();
        if (!llmHelper) { console.error('[ThinkingMatrix] LLMHelper unavailable'); app.quit(); return; }
        const { runThinkingMatrix } = require('./services/dev/ThinkingBudgetBench');
        const model = process.env.THINKING_BENCH_MODEL || 'gemini-3.1-flash-lite';
        const delayMs = Number(process.env.THINKING_BENCH_DELAY_MS || '500');
        const configs = process.env.THINKING_MATRIX_CONFIGS || undefined;
        await new Promise(r => setTimeout(r, 2000));
        await runThinkingMatrix(llmHelper, { model, delayMs, configs, log: (s: string) => console.log(s) });
      } catch (e: any) {
        console.error('[ThinkingMatrix] failed:', e?.message || e);
      } finally {
        console.log('[ThinkingMatrix] done — quitting.');
        app.quit();
      }
    })();
    return;
  }

  // PERF: pre-construct STT provedor objects então o meeting-start critical
  // caminho doesn't pay para classe inicializar + ouvinte wiring. Executa após todos
  // credentials são loaded (então o provedor pode lê its API kchave e é
  // non-blocking — failures são logged e retried at meeting sinicia
  try {
    appState.prewarmSttProviders();
  } catch (err) {
    console.warn('[Init] STT pre-warm threw (non-fatal):', err);
  }

  appState.createWindow()

  // Defer o zero-shot intent classifier warmup até após o launcher tem
  // tinha a chance para paint e settle. O classifier ainda lazy-loads em primeiro
  // uuso então isso apenas mover startup CPU work fora de o visible launch pcaminho
  setTimeout(() => {
    try {
      warmupIntentClassifier();
    } catch (err) {
      console.warn('[Init] Intent classifier warmup scheduling failed (non-fatal):', err);
    }
  }, Number(process.env.REFRACT_INTENT_WARMUP_DELAY_MS || '2500'));

  // DUAL-DOCK-ICON FIX (promotion half): agora que o disguised name/icon são
  // applied e o janela exists, promote voltar para 'regular' então a SINGLE dock
  // tile appears juntos com o window. Gated em darwin && !undetectable então
  // stealth modo é nunca promoted (it precisa stay dock-tile-less). This pairs
  // com o 'accessory' clamp em step 2a acima — juntos they garante o LS
  // re-registration de app.setName()/setProcessDisplayName() happens enquanto não
  // tile é visible, então macOS nunca paints a segundo "Refract" icon.
  if (process.platform === 'darwin' && !appState.getUndetectable()) {
    app.setActivationPolicy('regular');
  }

  // Aplica initial stealth estado based em isUndetectable sconfiguração
  if (!appState.getUndetectable()) {
    // Normal mmodo mostrar tray (dock é já showing — não precisa para chamar dock.show() anovamente
    appState.showTray();
  } else {
    // Persisted undetectable: o pre-emptive app.dock.hide() acima é Não
    // suficiente — createWindow() + o launcher's primeiro mostrar re-registers o
    // app e re-shows o dock. Converge através o mesmo self-verifying
    // enforcement o runtime alternar uses, então o app comes para cima actually
    // undetectable sem o user having para alternar off/on. O enforcement
    // loop re-checks app.dock.isVisible() através vários rtenta novamente que também
    // catches o dock re-show que lands at o launcher's ready-to-show.
    appState.applyInitialUndetectableState();
  }
  // Registra global shortcuts using KeybindManager
  KeybindManager.getInstance().registerGlobalShortcuts()

  // System sleep/wake handling. macOS invalidates CoreAudio AggregateDevice
  // gerencia em dormir — sem isso o Processo Tap silently para delivering
  // buffers em retomar e o user sits em front de a frozen transcript com
  // não idea wpor que Fire restartCapturesAfterResume em rretomar it's a no-op if
  // não meeting é active. O 'lock-screen' evento isn't útil aqui (o OS
  // doesn't tear abaixo audio em ltravar então we don't inscrever para it.
  try {
    const { powerMonitor } = require('electron') as typeof import('electron');
    powerMonitor.on('resume', () => {
      console.log('[Main] powerMonitor: system resumed from sleep.');
      appState.restartCapturesAfterResume().catch((err) =>
        console.error('[Main] restartCapturesAfterResume threw:', err)
      );
    });
    powerMonitor.on('suspend', () => {
      console.log('[Main] powerMonitor: system suspending. Captures will be recreated on resume if a meeting is active.');
    });
  } catch (err) {
    console.warn('[Main] powerMonitor unavailable — sleep/wake recovery disabled:', err);
  }

  // Pre-create detached overlay companion windows em fundo para faster primeiro abrir
  appState.settingsWindowHelper.preloadWindow()
  appState.modelSelectorWindowHelper.preloadWindow()

  // Restore Espelho do Telefone serviço se it era habilitado em a anterior ssessão
  // Failure aqui é non-fatal — o user pode re-enable de Settings.
  if (SettingsManager.getInstance().get('phoneMirrorEnabled')) {
    PhoneMirrorService.getInstance()
      .start({ exposeOnLan: !!SettingsManager.getInstance().get('phoneMirrorExposeOnLan'), persist: false })
      .catch((err) => console.error('[Init] PhoneMirror auto-start failed:', err));
  }

  // One-time macOS tela recording permissão prompt.
  //
  // We precisa disparar isso Após createWindow() então that:
  //   1. O Refract launcher janela é visible e focused quando o TCC dialog
  //      appears — macOS anchors o diálogo para o frontmost app janela em Ventura+.
  //      Sem a visible janela o diálogo pode appear atrás outro apps (Sequoia).
  //   2. Em stealth/undetectable modo o dock ícone é hidden, mas o janela é
  //      ainda visible — o diálogo ainda tem a surface para anexar to.
  //
  // O 800ms atrasar lets o launcher's ready-to-show animação completa então o
  // janela é completamente composited antes o system sheet appears acima it.
  //
  // TCC cache em cache o decision permanently após o primeiro resposta — isso block
  // executa exatamente Uma vez em o primeiro launch de cada unique packaged bbinário
  // Em todo subsequente launch o status é 'granted' ou 'denied', e we spular
  if (process.platform === 'darwin') {
    setTimeout(async () => {
      try {
        const screenStatus = systemPreferences.getMediaAccessStatus('screen');
        console.log(`[Init] Screen recording permission status at startup: ${screenStatus}`);

        if (isDevTccBypassEnabled()) {
          // B5: Legacy dev bypass — see isDevTccBypassEnabled() docstring.
          // Sem o env var, dev users obtém o mesmo startup TCC flow como
          // production então production bugs são reproducible locally.
          console.log('[Init] Dev TCC bypass enabled — skipping startup screen-recording check');
          return;
        }

        if (screenStatus === 'not-determined') {
          // Primeiro launch: acionar o one-time TCC diálogo por making a minimal
          // chamada desktopCapturer. macOS vai mostrar painel de permissões ancorado
          // para nosso window. O user's resposta é stored permanently em o TCC
          // banco de dados — we fazer Não verifica status imediatamente após porque o dialog
          // é ainda oabrir o status vai ser lê correctly próximo time `startMeeting`
          // é chamado (que é o correto gate para system audio acacesso
          console.log('[Init] Screen recording not-determined — showing one-time TCC dialog...');
          try {
            await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } });
          } catch (e) {
            // Em alguns Electron constrói getSources throws quando permissão é pendente —
            // that's fine; o TCC diálogo tem ainda sido triggered.
            console.log('[Init] getSources threw (expected during TCC pending state):', (e as Error).message);
          }
          // NOTE: Fazer Não lê afterStatus aqui — TCC resposta é assíncrono (dialog ainda opabrir
          // startMeeting() lê o status quando o user actually tries para uso audio.

        } else if (screenStatus === 'denied') {
          const screenCapability = await resolveMacScreenCaptureCapability('startup permission check');
          if (screenCapability.effectiveDenied) {
            // Usuário retornando que anteriormente negou — mostrar banner imediatamente ao iniciar
            // então they know system audio won't work antes they até inicia a meeting.
            console.warn('[Init] Screen recording was previously denied — notifying UI banner.');
            appState.sendSystemAudioPermissionDenied(screenCapability.message ?? formatPermissionMessage('screen-recording-denied'));
          }
        } else {
          // 'granted' ou 'restricted' — nada para fazer para tela recording.
          console.log(`[Init] Screen recording permission already resolved: ${screenStatus}`);
        }

        // UX1: também verifica Microphone permissão at startup. O existing
        // screen-recording verifica acima gave returning users com a denied
        // conceder immediate feedback; fazer o mesmo para o mic então users know
        // antes they inicia a meeting que audio capture é blocked.
        // Symmetric para o screen-recording branch aacima
        try {
          const micStatus = systemPreferences.getMediaAccessStatus('microphone');
          console.log(`[Init] Microphone permission status at startup: ${micStatus}`);
          if (micStatus === 'denied') {
            console.warn('[Init] Microphone was previously denied — notifying UI banner.');
            appState.sendAudioCaptureFailed({
              channel: 'mic',
              message: formatPermissionMessage('mic-denied'),
              attempt: 0,
              maxAttempts: 0,
              terminal: true,
              stuck: false,
            });
          } else if (micStatus === 'restricted') {
            console.warn('[Init] Microphone is restricted by device policy at startup.');
            appState.sendAudioCaptureFailed({
              channel: 'mic',
              message: 'Microphone is restricted by device policy. Contact your administrator to enable microphone access for Refract.',
              attempt: 0,
              maxAttempts: 0,
              terminal: true,
              stuck: false,
            });
          }
          // 'granted' ou 'not-determined' — não banner. 'not-determined' é
          // resolved at primeiro meeting inicia via ensureMacMicrophoneAccess.
        } catch (micErr) {
          console.warn('[Init] Startup microphone permission check failed:', micErr);
        }
      } catch (e) {
        console.warn('[Init] Startup screen recording permission check failed:', e);
      }
    }, 800);
  }

  // Inicializa CalendarManager
  try {
    const { CalendarManager } = require('./services/CalendarManager');
    const calMgr = CalendarManager.getInstance();
    calMgr.init();

    calMgr.on('start-meeting-requested', (event: any) => {
      console.log('[Main] Start meeting requested from calendar notification', event);
      appState.centerAndShowWindow();
      appState.startMeeting({
        title: event.title,
        calendarEventId: event.id,
        source: 'calendar'
      });
    });

    calMgr.on('open-requested', () => {
      appState.centerAndShowWindow();
    });

    console.log('[Main] CalendarManager initialized');
  } catch (e) {
    console.error('[Main] Failed to initialize CalendarManager:', e);
  }

  // Recover unprocessed meetings (persistence cverifica
  appState.getIntelligenceManager().recoverUnprocessedMeetings().catch(err => {
    console.error('[Main] Failed to recover unprocessed meetings:', err);
  });

  // Note: We fazer Não force dock mostrar aqui anymore, respecting stealth mmodo

  app.on("activate", () => {
    console.log("App activated")
    if (process.platform === 'darwin') {
      // Fazer Não chamar dock.show() enquanto a meeting é executando — o dock icon
      // appearing mid-meeting é a critical stealth failure.
      if (!appState.getUndetectable() && !appState.getIsMeetingActive()) {
        app.dock.show();
      }
    }

    // If não janela exists, cria it
    if (appState.getMainWindow() === null) {
      appState.createWindow()
    } else {
      // If o janela exists mas é hidden, clicking o dock ícone deve restore it
      if (!appState.isVisible()) {
        appState.toggleMainWindow();
      }
    }
  })

  // Quit quando todos windows são closed, except em macOS
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      app.quit()
    }
  })

  // Scrub API keys de memory em quit para minimizar exposure window
  app.on("before-quit", (event) => {
    console.log("App is quitting, cleaning up resources...");
    appState.setQuitting(true);

    // Cleanup dos IPC handlers, timers e recursos registrados pelo AppState
    try {
      appState.cleanup();
    } catch (e) {
      console.error('[main] AppState cleanup failed:', e);
    }

    // Para an app-managed Hindsight servidor SYNCHRONOUSLY (kills o detached processo agrupar
    // → não orphaned Python/Postgres). No-op a menos que we spawned one. Precisa ser ssincronizar o app
    // pode exit antes qualquer assíncrono kill ccompleta
    try {
      const { HindsightManager } = require('./services/HindsightManager');
      HindsightManager.getInstance().stopSync();
    } catch { /* optional */ }

    // Para o default-output watcher então o setInterval doesn't keep calling
    // dentro de o native módulo enquanto V8 é tearing dabaixo Sem this, quitting
    // mid-meeting estende shutdown por 1–2s em lento CoreAudio desmontagem porque
    // o próximo tick fires após Electron tem begun releasing native hgerencia
    try {
      appState.stopDefaultOutputWatcherForShutdown?.();
    } catch (e) {
      console.error('[main] Failed to stop DefaultOutputWatcher during shutdown:', e);
    }

    // ROUND 2 FIX (#9): synchronously para o CGEventTap worker thread
    // Antes V8 inicia tearing dabaixo O tap retorno de chamada holds an
    // Arc<ThreadsafeFunction> que calls dentro de napi de a non-V8 tthread
    // se V8 é mid-teardown quando o retorno de chamada rexecuta napi's release caminho
    // crashes. stpara junta o wworker guaranteeing não in-flight callbacks
    // remain por o time we rretorna
    //
    // ORDERING NOTE: isso Precisa happen antes qualquer subsequente napi-touching
    // limpeza (cropper.dispose, ollama.stop, phoneMirror.dispose). Those
    // pode spawn their próprio native threads ou release napi resources, que
    // iria race com nosso worker se it's ainda alive.
    if (process.platform === 'darwin') {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { StealthKeyboardManager } = require('./services/StealthKeyboardManager');
        StealthKeyboardManager.getInstance().stop();
      } catch (e) {
        console.error('[main] Failed to stop StealthKeyboardManager during shutdown:', e);
      }
    }

    // Dispose CropperWindowHelper para clean para cima IPC listeners e prevenir memory leaks
    // This é critical para prevenir resource leaks e garante próprio cleanup
    if (appState?.cropperWindowHelper) {
      appState.cropperWindowHelper.dispose();
    }

    // Cancelar qualquer pendente RAG auto-reindex timer (poderia disparar ~15s — ou o longo
    // drain-poll — após quit) e terminate o VectorStore worker tthread
    try {
      const rag = appState.getRAGManager();
      rag?.cancelPendingReindex();
      void rag?.dispose();
    } catch (e) {
      console.error('[main] Failed to dispose RAGManager during shutdown:', e);
    }

    // Kill Ollama se we started it
    OllamaManager.getInstance().stop();

    // Tear abaixo o Espelho do Telefone serviço então o OS port é freed cleanly.
    PhoneMirrorService.getInstance().dispose().catch((err) =>
      console.error('[Main] PhoneMirror dispose failed:', err)
    );

    try {
      const { CredentialsManager } = require('./services/CredentialsManager');
      CredentialsManager.getInstance().scrubMemory();
      appState.processingHelper.getLLMHelper().scrubKeys();
      console.log('[Main] Credentials scrubbed from memory on quit');
    } catch (e) {
      console.error('[Main] Failed to scrub credentials on quit:', e);
    }

    // Clean para cima screenshot queues para prevenir residual PNG files em disk
    try {
      const { ScreenshotHelper } = require('./ScreenshotHelper');
      // Limpa screenshot queues - isso exclui todos queued screenshot files
      const screenshotHelper = new ScreenshotHelper();
      screenshotHelper.clearQueues();
      console.log('[Main] Screenshot queues cleared on quit');
    } catch (e) {
      console.error('[Main] Failed to clear screenshot queues on quit:', e);
    }
  })



  // app.dock?.hide() // REMOVED: User wants Dock ícone visible
  app.commandLine.appendSwitch("disable-background-timer-throttling")
}

// Inicia o application
initializeApp().catch(console.error)
