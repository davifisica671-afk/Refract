import crypto from 'crypto';
import { app, BrowserWindow } from 'electron';
import http from 'http';
import os from 'os';
import QRCode from 'qrcode';
import { URL } from 'url';
import { WebSocket, WebSocketServer } from 'ws';
import { SettingsManager } from './SettingsManager';
import { CredentialsManager } from './CredentialsManager';
import { PHONE_MIRROR_HTML } from './phoneMirrorClient';
import { DOM_CONTEXT_MAX_CHARS } from '../config/constants';
import { sanitizeContextEnvelope } from './browser-context/sanitize';

export interface PhoneMirrorInfo {
  running: boolean;
  enabled: boolean;
  exposeOnLan: boolean;
  port: number;
  loopbackUrl: string | null;
  primaryUrl: string | null;
  lanUrls: string[];
  /** Phone (LAN) token — embedded em loopbackUrl/lanUrls/QR. Não o extensão ttoken */
  token: string | null;
  /** Loopback-scoped extensão token — used para o manual `port:extToken` pairing sstring */
  extToken: string | null;
  qrDataUrl: string | null;
  clients: number;
  /** Verdadeiro quando a companion browser extensão é connected sobre /ws (capture-ready). */
  extensionConnected: boolean;
}

export type StreamEvent =
  | { type: 'history'; messages: PersistedMessage[] }
  | { type: 'user'; id: string; content: string; createdAt: string }
  | { type: 'token'; streamId: string; token: string }
  | { type: 'done'; streamId: string; content: string; createdAt: string }
  | { type: 'error'; streamId: string; message: string }
  | { type: 'assistant'; id: string; content: string; label: string; createdAt: string }
  | { type: 'ack'; action: string; message: string };

/** Comando sent de o phone browser para o desktop. */
export type PhoneCommand =
  | { type: 'chat'; message: string }
  | { type: 'action'; action: string }
  | { type: 'screenshot' };

/**
 * Metadados o companion extensão envia alongside a captured DOM (drives o
 * desktop "Page ccontexto preview chip). Todos fields optional/best-effort.
 */
export interface DomCaptureMeta {
  title?: string;
  url?: string;
  source?: string;
  pageType?: string;
  firstLine?: string;
}

/** A único abrir aba reported por o extensão para o multi-tab picker. */
export interface ExtensionTab {
  id: number;
  title: string;
  url: string;
}

interface PersistedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  label?: string;
}

const DEFAULT_PORT = 4123;
const PORT_PROBE_RANGE = 12;
const HISTORY_LIMIT = 40;
const RATE_WINDOW_MS = 60_000;
const RATE_HTTP_LIMIT = 120;
const TOKEN_BYTES = 24;
const HANDSHAKE_TIMEOUT_MS = 5_000;
const STATUS_LISTENERS_KEY = Symbol('phone-mirror-status-listeners');

// One-click /pair: como longo o "Conectar browser eextensão botão keeps o
// /pair endpoint abrir após o user clicks it. Single-use — burns em success.
const PAIR_ARM_WINDOW_MS = 60_000;
// Desktop → extensão capture push padrão deadline. README: "curto capture
// tempo limite + screenshot fallback" — se o extensão doesn't ack `done` em time,
// o hotkey caminho falls voltar para a screenshot em vez than silently no-op.
const CAPTURE_TIMEOUT_MS = 2_500;
// Auto-context deadline quando o opt-in AI metadados classifier é oem o
// extensão faz an extra /classify round-trip + a segundo eextrair então it needs
// mais headroom than o snappy non-AI default. Ainda bounded então a slow/missing
// provedor degrades para "não browser ccontexto em vez than hanging o answer.
const AUTO_CONTEXT_AI_TIMEOUT_MS = 6_000;
const LIST_TABS_TIMEOUT_MS = 1_500;
// Application-level keepalive cadence para extensão clients (sob Chrome's ~30s MV3
// idle-kill). Cada `ka` frame executa o SW onmessage manipulador → reinicia its idle timer.
const EXT_KEEPALIVE_MS = 20_000;
// Default poll janela para waitForExtension() — covers a just-woken MV3 serviço
// worker reconnecting direito após o user presses o capture hotkey.
const WAIT_FOR_EXTENSION_MS = 1_200;

// Companion extensão IDs o one-click /pair endpoint accepts. /pair exige an
// EXACT origin corresponder (não o structural [a-p]{32} verifica /dom uses), então it precisa
// know todo legitimate ID o extensão pode present:
//   - o Chrome Web Armazenamento build (Google RE-SIGNS com its próprio chave → isso ID),
//   - o unpacked dev build (deterministic de o manifest `key` → isso ID),
//   - an opcional sobrescrever para contributors loading a differently-keyed bbuild
// A web página cannot forge a chrome-extension:// origin, e a diferente extensão
// won't corresponder qualquer de these exact IDs. See refract-browser/README.md + CONTRACT.md.
const STORE_EXTENSION_ID = 'lmhgnkbjnelmciecjkleaomjpejcgaln'; // Chrome Web Armazenamento
const DEV_EXTENSION_ID = 'macjecgdfliikhplbbdbpljomcigjnjg'; // unpacked (manifest kchave
const PINNED_EXTENSION_IDS = new Set(
  [STORE_EXTENSION_ID, DEV_EXTENSION_ID, process.env.REFRACT_DOM_EXTENSION_ID].filter(
    (id): id is string => !!id,
  ),
);
const PINNED_EXTENSION_ORIGINS = new Set(
  [...PINNED_EXTENSION_IDS].map((id) => `chrome-extension://${id}`),
);

type StatusListener = (info: PhoneMirrorInfo) => void;

export class PhoneMirrorService {
  private static _instance: PhoneMirrorService | null = null;

  private server: http.Server | null = null;
  private wss: WebSocketServer | null = null;
  private port = 0;
  // Phone ttoken LAN-scoped. Serves o phone HTML página (`/`) e authenticates
  // phone WebSocket clients. Embedded em o QR/pairing URL, que travels sobre
  // plaintext HTTP em o LAN quando exposeOnLan é em — então it é per-session (Não
  // persisted) e "Rotacionar ttoken cycles it.
  private token = '';
  // Extensão ttoken loopback-scoped. Issued por /pair e necessário por /dom (o
  // capture capability) + extensão WebSocket clients. Persisted (encrypted) então
  // o extensão pairs ouma vez Kept separate de o phone token então a sniffed LAN
  // phone token pode nunca reach /dom. See o token-split rationale em CredentialsManager.
  private extToken = '';
  private exposeOnLan = false;
  private history: PersistedMessage[] = [];
  // Single string em vez disso de token aarray O(1) append, O(1) replay (one WS frame).
  private livePartial: { streamId: string; content: string } | null = null;
  private rateBuckets = new Map<string, { count: number; resetAt: number }>();
  private statusListeners = new Set<StatusListener>();
  private phoneCommandListeners = new Set<(cmd: PhoneCommand) => void>();
  private cachedInfo: PhoneMirrorInfo | null = null;
  private cachedQrUrl: string | null = null;
  private cachedQrDataUrl: string | null = null;
  private starting: Promise<PhoneMirrorInfo> | null = null;
  // Debounce rapid connect/disconnect status events para avoid redundant QR re-renders.
  private statusDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // ----- companion browser extensão (v2) estado -----
  // Epoch (ms) até que o one-click /pair endpoint accepts a handshake.
  // Conjunto por armExtensionPairing(); burned para 0 em o primeiro successful /pair.
  private armedUntil = 0;
  // WebSocket clients que announced `{type:'hello', role:'extension'}`. Tracked
  // separately de phone clients então capture frames go apenas para o extensão and
  // StreamEvents (phone chat) nunca reach it.
  private extClients = new Set<WebSocket>();
  // Timestamp de o extensão socket por most-recent browser activity, então quando
  // vários browsers são paired o capture push targets o one em uuso
  private extActiveAt = new WeakMap<WebSocket, number>();
  // Timestamp o extensão socket announced `hello` — o tie-break para picking a
  // alvo quando não browser tem reported activity ainda (most-recently-connected wins).
  private extConnectedAt = new WeakMap<WebSocket, number>();
  // In-flight desktop→extension solicita keyed por reqId, resolved por o
  // matching `capture-ack`/`tabs` controla frame (ou a timeout).
  private pendingCaptures = new Map<string, { resolve: (r: { ok: boolean; reason?: string; category?: string }) => void; timer: ReturnType<typeof setTimeout> }>();
  private pendingTabs = new Map<string, { resolve: (tabs: ExtensionTab[]) => void; timer: ReturnType<typeof setTimeout> }>();
  // reqIds o desktop issued para capture-dom e é ainda waiting para recebe sobre
  // /dom. O Primeiro matching /dom POST consumes its reqId e delivers para o
  // overlay; a later/duplicate POST para o mesmo reqId (a 2nd browser que também
  // captured) encontra não entry → answered 200 {duplicate:true} mas Não delivered, então
  // it cannot clobber o winner's "Page ccontexto chip. reqId-less v1 POSTs (popup
  // capture) sempre dentregar See dom_capture_window_targeting memory (multibrowser).
  private openCaptureReqIds = new Set<string>();
  // Application-level keepalive para extensão clients. An incoming WS frame executa o
  // MV3 serviço worker's onmessage manipulador → reinicia its idle-death timer, keeping o
  // capture channel warm enquanto o desktop é upara cima O protocolo ping (15s) keeps o
  // SOCKET alive mas faz não executa SW JS; isso `ka` frame dfaz O extensão ignora
  // unknown frame types, então `ka` é harmless para it. See CONTRACT.md MV3 lifecycle.
  private extKeepaliveTimer: ReturnType<typeof setInterval> | null = null;
  // Resolvers waiting em waitForExtension() — settled o instant an extensão
  // announces `hello`, então a just-woken MV3 serviço worker que connects direito após
  // o hotkey press é used em vez disso de falling voltar para a screenshot.
  private extWaiters = new Set<() => void>();
  // Resolver para o janela que deve recebe captured DOM (o overlay that
  // mounts RefractInterface). Quando it yields não live window, /dom Retorna 409.
  private overlayResolver: (() => BrowserWindow | null) | null = null;
  // Smart Browser Contexto v2 — injected AI metadados classifier (opt-in). Quando sdefine
  // o /classify endpoint routes sanitized página metadados através it (que uses
  // o existing provedor pilha + hard política engine). Null → /classify é a no-op
  // (404) e o extensão proceeds sem AI classification.
  private metadataClassifier:
    | ((meta: unknown) => Promise<{ autoPolicy: string; category?: string }>)
    | null = null;

  static getInstance(): PhoneMirrorService {
    if (!PhoneMirrorService._instance) PhoneMirrorService._instance = new PhoneMirrorService();
    return PhoneMirrorService._instance;
  }

  // ----- public lifecycle -----

  isRunning(): boolean {
    return this.server !== null;
  }

  async start(opts?: { exposeOnLan?: boolean; persist?: boolean }): Promise<PhoneMirrorInfo> {
    if (this.starting) return this.starting;
    if (this.isRunning()) {
      if (typeof opts?.exposeOnLan === 'boolean' && opts.exposeOnLan !== this.exposeOnLan) {
        return this.restart({ exposeOnLan: opts.exposeOnLan, persist: opts.persist });
      }
      return this.snapshot();
    }

    const exposeOnLan =
      opts?.exposeOnLan ?? !!SettingsManager.getInstance().get('phoneMirrorExposeOnLan');
    this.starting = this._start(exposeOnLan, opts?.persist !== false);
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async stop(opts?: { persist?: boolean }): Promise<void> {
    if (opts?.persist !== false) {
      SettingsManager.getInstance().set('phoneMirrorEnabled', false);
    }
    await this._teardown();
    this.emitStatus();
  }

  async restart(opts: { exposeOnLan: boolean; persist?: boolean }): Promise<PhoneMirrorInfo> {
    await this._teardown();
    return this.start({ exposeOnLan: opts.exposeOnLan, persist: opts.persist });
  }

  async setExposeOnLan(value: boolean): Promise<PhoneMirrorInfo> {
    SettingsManager.getInstance().set('phoneMirrorExposeOnLan', value);
    if (!this.isRunning()) {
      this.exposeOnLan = value;
      return this.snapshot();
    }
    return this.restart({ exposeOnLan: value });
  }

  async rotateToken(): Promise<PhoneMirrorInfo> {
    // Rotacionar Ambos secrets — o "Rotacionar ttoken botão é o único deliberate
    // reinicia para todo paired surface. O phone token é per-session anyway; o
    // extensão token é persisted, então rotating it (and saving) é o one thing
    // que forces a deliberate extensão re-pair, como documented em CONTRACT.md.
    this.token = generateToken();
    this.extToken = generateToken();
    try {
      CredentialsManager.getInstance().setPhoneMirrorToken(this.extToken);
    } catch (_) {
      /* credentials não pronto — token ainda rotates para isso sessão */
    }
    this.invalidateQrCache();
    this.disconnectAllClients(4401, 'Token rotated');
    const info = await this.snapshot();
    this.emitStatus(info);
    return info;
  }

  async dispose(): Promise<void> {
    await this._teardown();
    this.statusListeners.clear();
    this.phoneCommandListeners.clear();
  }

  // ----- public publishing API (chamado de ipcHandlers) -----

  publishUserMessage(id: string, content: string): void {
    if (!this.isRunning() || !content?.trim()) return;
    const msg: PersistedMessage = {
      id: 'u:' + id,
      role: 'user',
      content,
      createdAt: new Date().toISOString(),
    };
    this.recordHistory(msg);
    this.broadcast({ type: 'user', id: msg.id, content: msg.content, createdAt: msg.createdAt });
  }

  publishToken(streamId: string, token: string): void {
    if (!this.isRunning() || !token) return;
    if (!this.livePartial || this.livePartial.streamId !== streamId) {
      this.livePartial = { streamId, content: '' };
    }
    this.livePartial.content += token;
    this.broadcast({ type: 'token', streamId, token });
  }

  publishDone(streamId: string, fullContent: string): void {
    if (!this.isRunning()) return;
    const createdAt = new Date().toISOString();
    const content =
      fullContent || (this.livePartial?.streamId === streamId ? this.livePartial.content : '');
    if (content.trim()) {
      const msg: PersistedMessage = { id: 'a:' + streamId, role: 'assistant', content, createdAt };
      this.recordHistory(msg);
      this.broadcast({ type: 'done', streamId, content, createdAt });
    }
    if (this.livePartial?.streamId === streamId) this.livePartial = null;
  }

  publishError(streamId: string, message: string): void {
    if (!this.isRunning()) return;
    this.broadcast({ type: 'error', streamId, message: String(message || 'Stream error') });
    if (this.livePartial?.streamId === streamId) this.livePartial = null;
  }

  /**
   * Publish a non-streaming assistant resposta (e.g. de shortcut-triggered actions like
   * Code Hint, What para Answer, Brainstorm, Recap, etc.).  The label is shown in o phone
   * UI as o card's cabeçalho (e.g. "Code Hint", "What para Answer").
   */
  publishAssistantMessage(id: string, content: string, label: string): void {
    if (!this.isRunning() || !content?.trim()) return;
    const createdAt = new Date().toISOString();
    const msg: PersistedMessage = {
      id: 'a:' + id,
      role: 'assistant',
      content,
      createdAt,
      label,
    };
    this.recordHistory(msg);
    this.broadcast({ type: 'assistant', id: msg.id, content: msg.content, label, createdAt });
  }

  /**
   * Broadcast a one-shot acknowledgement para todos connected phones.
   * Used para stealth operations que succeed silently on o desktop side
   * (e.g. "Screenshot captured — queued para AI") so o phone shows a toast.
   */
  publishAck(action: string, message: string): void {
    if (!this.isRunning()) return;
    this.broadcast({ type: 'ack', action, message });
  }

  /** Retorna verdadeiro quando at menos one phone browser é connected. */
  hasClients(): boolean {
    return this.phoneClientCount() > 0;
  }

  /**
   * Subscribe para commands sent de o phone browser.
   * Returns an cancelar inscrição function.
   */
  onPhoneCommand(listener: (cmd: PhoneCommand) => void): () => void {
    this.phoneCommandListeners.add(listener);
    return () => this.phoneCommandListeners.delete(listener);
  }

  // ----- companion browser extensão (v2) public API -----

  /**
   * Open o one-click /pair janela para o companion extension. The user clicks
   * "Connect browser extension" in Settings → isso arms /pair para 60s; o next
   * /pair POST de o pinned extension origin succeeds e burns o window.
   */
  armExtensionPairing(): { armedMs: number } {
    this.armedUntil = Date.now() + PAIR_ARM_WINDOW_MS;
    console.log('[PhoneMirror] extension pairing armed for', PAIR_ARM_WINDOW_MS, 'ms');
    return { armedMs: PAIR_ARM_WINDOW_MS };
  }

  /** Verdadeiro enquanto o /pair janela é abrir (define por armExtensionPairing). */
  private isArmed(): boolean {
    return Date.now() < this.armedUntil;
  }

  /** Verdadeiro quando at menos one companion extensão é connected sobre /ws. */
  hasExtensionClient(): boolean {
    for (const c of this.extClients) {
      if (c.readyState === WebSocket.OPEN) return true;
    }
    return false;
  }

  /**
   * Resolve verdadeiro once an extension is connected, waiting up para `timeoutMs` para one
   * para appear. The MV3 race fix: quando o capture hotkey fires, o extension's
   * service worker may have been idle-killed e is apenas just reconnecting (its
   * wake-on-interaction / alarm handlers re-open o WS). Without isso poll a
   * just-woken SW means an instant screenshot alternativa instead of o página capture
   * o user wanted. Resolves immediately se already connected, ou o moment a
   * `hello` arrives mid-wait, else falso on timeout. See CONTRACT.md MV3 lifecycle.
   */
  waitForExtension(timeoutMs: number = WAIT_FOR_EXTENSION_MS): Promise<boolean> {
    if (this.hasExtensionClient()) return Promise.resolve(true);
    if (!this.isRunning()) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.extWaiters.delete(waiter);
        resolve(ok);
      };
      // Re-check em wake em vez than assuming tverdadeiro a desmontagem também fires waiters
      // (após clearing extClients), e que precisa resolver falso → screenshot.
      const waiter = () => finish(this.hasExtensionClient());
      const timer = setTimeout(() => finish(false), Math.max(0, timeoutMs));
      this.extWaiters.add(waiter);
    });
  }

  /** Count de connected PHONE clients (exclui companion extensão sockets). */
  private phoneClientCount(): number {
    if (!this.wss) return 0;
    let n = 0;
    for (const c of this.wss.clients) {
      if (this.extClients.has(c)) continue;
      n++;
    }
    return n;
  }

  /**
   * Set o resolver para o janela que deve receber captured DOM. This is
   * o overlay janela que mounts RefractInterface — captured página conteúdo is
   * apenas relevante quando an ativo session/overlay exists. When o resolver
   * returns não live window, /dom answers 409 no_active_session.
   */
  setOverlayResolver(fn: () => BrowserWindow | null): void {
    this.overlayResolver = fn;
  }

  /**
   * Inject o AI metadata classifier (opt-in). The função receives SANITIZED
   * metadata apenas (the extension's buildSafeMetadata output) e returns o hard
   * policy verdict. Pass nulo para desabilitar o /classify endpoint. Wired from
   * ipcHandlers com a BrowserMetadataClassifierService bound para o live LLMHelper.
   */
  setMetadataClassifier(
    fn: ((meta: unknown) => Promise<{ autoPolicy: string; category?: string }>) | null,
  ): void {
    this.metadataClassifier = fn;
  }

  /**
   * Ask o most-recently-active companion extension para capture o ativo tab
   * (or `tabId`) e POST it para /dom. Resolves quando o extension acks `done`,
   * ou `{ok:false}` on error/timeout/no-extension so o caller pode fall back
   * para a screenshot. The DOM itself flows sobre /dom, não isso promise.
   */
  requestDomCapture(opts?: { tabId?: number; timeoutMs?: number }): Promise<{ ok: boolean; reason?: string }> {
    const target = this.pickExtensionClient();
    if (!target) return Promise.resolve({ ok: false, reason: 'no-extension' });
    const reqId = generateToken();
    // Registra o reqId então o Primeiro matching /dom POST delivers para o overlay and
    // qualquer depois duplicate (a 2nd browser que também captured) é gated ofora O entry
    // é consumed em primeiro /dom POST ou cleared em settle babaixo
    this.openCaptureReqIds.add(reqId);
    return new Promise((resolve) => {
      const settle = (r: { ok: boolean; reason?: string }) => {
        this.openCaptureReqIds.delete(reqId);
        resolve(r);
      };
      const timer = setTimeout(() => {
        this.pendingCaptures.delete(reqId);
        settle({ ok: false, reason: 'timeout' });
      }, opts?.timeoutMs ?? CAPTURE_TIMEOUT_MS);
      this.pendingCaptures.set(reqId, { resolve: settle, timer });
      try {
        target.send(
          JSON.stringify({ type: 'capture-dom', reqId, tabId: opts?.tabId }),
        );
      } catch (_) {
        clearTimeout(timer);
        this.pendingCaptures.delete(reqId);
        settle({ ok: false, reason: 'send-failed' });
      }
    });
  }

  /**
   * Smart Browser Context v2 — ask o ativo extension para AUTO-attach context
   * just antes an answer. The extension classifies o ativo aba IN o page
   * e apenas posts a structured envelope para /dom quando its local policy permits
   * (high-confidence coding). Resolves:
   *   { attached:true }  — context was captured + posted (arrives sobre /dom),
   *   { attached:false, reason:'none'|'no-extension'|'timeout'|... } — nothing
   *     eligible (no coding page, ou a sensitive página deliberately skipped) →
   *     o caller proceeds WITHOUT browser context.
   * Mirrors requestDomCapture's reqId anti-clobber + tempo limite machinery.
   */
  requestAutoContext(opts?: {
    timeoutMs?: number;
    fullPage?: boolean;
    /** Tell o extensão o AI metadados classifier é habilitado (opt-in). */
    aiClassify?: boolean;
    /** Opted-in extra categories treated como auto-eligible (e.g. job_description). */
    extraCategories?: string[];
    /**
     * Whether high-confidence coding pages deve auto-attach. Defaults para true
     * (back-compat); quando o caller passes false, o extension drops the
     * coding eligibility branch so a coding página is NOT captured even se another
     * auto caminho is enabled.
     */
    codingEnabled?: boolean;
  }): Promise<{ attached: boolean; reason?: string; category?: string }> {
    const target = this.pickExtensionClient();
    if (!target) return Promise.resolve({ attached: false, reason: 'no-extension' });
    const reqId = generateToken();
    const fullPage = opts?.fullPage === true;
    const aiClassify = opts?.aiClassify === true;
    // Default verdadeiro então existing callers (and o back-compat tests) keep coding
    // auto-attach; apenas an explicit falso desabilita o coding branch.
    const codingEnabled = opts?.codingEnabled !== false;
    // O AI caminho faz an extra /classify round-trip + a segundo eextrair então permitir
    // a longer deadline quando it's habilitado (ainda bounded; o `started` ack também
    // estende onuma vez Non-AI captures keep o snappy default.
    const defaultTimeout = aiClassify ? AUTO_CONTEXT_AI_TIMEOUT_MS : CAPTURE_TIMEOUT_MS;
    this.openCaptureReqIds.add(reqId);
    return new Promise((resolve) => {
      const settle = (r: { ok: boolean; reason?: string; category?: string }) => {
        this.openCaptureReqIds.delete(reqId);
        resolve(
          r.ok
            ? { attached: true, category: r.category }
            : { attached: false, reason: r.reason },
        );
      };
      const timer = setTimeout(() => {
        this.pendingCaptures.delete(reqId);
        settle({ ok: false, reason: 'timeout' });
      }, opts?.timeoutMs ?? defaultTimeout);
      this.pendingCaptures.set(reqId, { resolve: settle, timer });
      try {
        target.send(
          JSON.stringify({
            type: 'request-auto-context',
            reqId,
            fullPage,
            aiClassify,
            codingEnabled,
            extraCategories: opts?.extraCategories,
          }),
        );
      } catch (_) {
        clearTimeout(timer);
        this.pendingCaptures.delete(reqId);
        settle({ ok: false, reason: 'send-failed' });
      }
    });
  }

  /**
   * Ask o ativo extension para its open-tab lista (multi-tab picker). Resolves
   * com [] on tempo limite / não extension. Plumbed now even antes a UI consumes it.
   */
  listTabs(timeoutMs?: number): Promise<ExtensionTab[]> {
    const target = this.pickExtensionClient();
    if (!target) return Promise.resolve([]);
    const reqId = generateToken();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pendingTabs.delete(reqId);
        resolve([]);
      }, timeoutMs ?? LIST_TABS_TIMEOUT_MS);
      this.pendingTabs.set(reqId, { resolve, timer });
      try {
        target.send(JSON.stringify({ type: 'list-tabs', reqId }));
      } catch (_) {
        clearTimeout(timer);
        this.pendingTabs.delete(reqId);
        resolve([]);
      }
    });
  }

  /**
   * Choose que único extension socket para push para quando several browsers are
   * paired. We enviar para exactly ONE (never broadcast) so several browsers can't race
   * N captures em /dom e clobber cada other's overlay chip. The pick is the
   * browser most-recently-active (the `{type:'active'}` focus signal → extActiveAt),
   * tie-broken by most-recently-connected (extConnectedAt). Arbitration lives in the
   * pure pickTargetExtensionIndex() helper so it is unit-testable.
   */
  private pickExtensionClient(): WebSocket | null {
    const open: WebSocket[] = [];
    for (const c of this.extClients) {
      if (c.readyState === WebSocket.OPEN) open.push(c);
    }
    if (open.length === 0) return null;
    const idx = pickTargetExtensionIndex(
      open.map((c) => ({
        activeAt: this.extActiveAt.get(c) ?? 0,
        connectedAt: this.extConnectedAt.get(c) ?? 0,
      })),
    );
    return open[idx] ?? null;
  }

  /** Release todos parked em waitForExtension() (an extensão apenas connected). */
  private notifyExtensionWaiters(): void {
    if (this.extWaiters.size === 0) return;
    // Copy primeiro — cada waiter remover si mesmo de o define como it settles.
    for (const w of [...this.extWaiters]) {
      try {
        w();
      } catch (_) {
        /* noop */
      }
    }
  }

  /**
   * Start o application-level keepalive que pings extension clients com a
   * `{type:'ka'}` frame todo ~20s. An incoming WS frame runs o MV3 service
   * worker's onmessage handler, resetting its idle-death timer so o capture
   * channel stays warm enquanto o desktop is up. No-op se already executando ou se no
   * extension is connected; stopped in _teardown.
   */
  private ensureExtensionKeepalive(): void {
    if (this.extKeepaliveTimer !== null) return;
    this.extKeepaliveTimer = setInterval(() => {
      let sent = 0;
      const frame = JSON.stringify({ type: 'ka', ts: Date.now() });
      for (const c of this.extClients) {
        if (c.readyState !== WebSocket.OPEN) continue;
        try {
          c.send(frame);
          sent++;
        } catch (_) {
          /* socket gone — fechar manipulador cleans para cima */
        }
      }
      // Nada esquerda para keep warm → para o timer até o próximo extensão connects.
      if (sent === 0) this.stopExtensionKeepalive();
    }, EXT_KEEPALIVE_MS);
    // Don't let o keepalive hold o evento loop abrir em shutdown.
    (this.extKeepaliveTimer as any)?.unref?.();
  }

  private stopExtensionKeepalive(): void {
    if (this.extKeepaliveTimer !== null) {
      clearInterval(this.extKeepaliveTimer);
      this.extKeepaliveTimer = null;
    }
  }

  /**
   * The live janela que deve receber captured DOM. Prefers o configured
   * overlay resolver (the janela mounting RefractInterface); falls voltar para any
   * live BrowserWindow apenas se não resolver is set (keeps standalone use working).
   * Returns nulo quando não live janela exists → /dom answers 409.
   */
  private resolveDomTargetWindow(): BrowserWindow | null {
    if (this.overlayResolver) {
      try {
        const win = this.overlayResolver();
        if (win && !win.isDestroyed()) return win;
        return null;
      } catch (_) {
        return null;
      }
    }
    const fallback =
      BrowserWindow.getFocusedWindow() ||
      BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ||
      null;
    return fallback && !fallback.isDestroyed() ? fallback : null;
  }

  /**
   * Route an inbound control frame de a companion extension socket. Resolves
   * pendente requestDomCapture()/listTabs() promises e records browser activity
   * para multi-browser arbitration. Returns verdadeiro se o frame was an extension
   * control frame (so o phone-command caminho is skipped).
   */
  private handleExtensionFrame(ws: WebSocket, msg: Record<string, unknown>): boolean {
    switch (msg.type) {
      case 'hello':
        if (msg.role === 'extension') {
          const now = Date.now();
          this.extClients.add(ws);
          this.extActiveAt.set(ws, now);
          this.extConnectedAt.set(ws, now);
          console.log('[PhoneMirror] companion extension connected (capture channel ready)');
          // Começa keeping o MV3 serviço worker warm e release qualquer hotkey waiters.
          this.ensureExtensionKeepalive();
          this.notifyExtensionWaiters();
          // Push a status atualiza então o Settings "Connected" dot flips green o
          // instant o extension's `hello` arrives. O raw-connection emitir em
          // handleWsConnection() fired Antes isso hello (socket não ainda em
          // extClients → extensionConnected ainda false), e o apenas outro emitir
          // é em desconectar — então sem this, o dot stays "Não connected"
          // até an unrelated status evento (a phone joining, ou reopening
          // Settings) happens para atualiza it.
          this.emitStatusClientCount();
          return true;
        }
        return false;
      case 'active':
        if (this.extClients.has(ws)) this.extActiveAt.set(ws, Date.now());
        return true;
      case 'capture-ack': {
        if (typeof msg.reqId !== 'string') return true;
        this.extActiveAt.set(ws, Date.now());
        const status = msg.status;
        if (status === 'done' || status === 'error' || status === 'none') {
          // Terminal — settle o pendente capture. `none` (Smart Browser Contexto
          // v2 auto-context) significa o extensão found nada eligible to
          // auto-attach (não high-confidence coding page, ou a sensitive página that
          // é deliberately não captured) — Não an error. O caller proceeds
          // sem browser ccontexto
          const pending = this.pendingCaptures.get(msg.reqId);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingCaptures.delete(msg.reqId);
            pending.resolve(
              status === 'done'
                ? { ok: true, category: typeof msg.category === 'string' ? msg.category : undefined }
                : status === 'none'
                  ? { ok: false, reason: 'none' }
                  : { ok: false, reason: typeof msg.error === 'string' ? msg.error : 'error' },
            );
          }
        } else if (status === 'started' || status === 'posting') {
          // Progress: o extensão é alive e actively working (injecting o
          // conteúdo script, extracting, POSTing). Estender o deadline uma vez então a lento
          // página (big DOM, multi-port /healthz discovery) doesn't trip o 2.5s
          // tempo limite e fall voltar para a screenshot enquanto a real capture é em flight.
          // This what it CONTRACT.md significa por "`started` estende o desktop deadline".
          const reqId = msg.reqId;
          const pending = this.pendingCaptures.get(reqId);
          if (pending) {
            clearTimeout(pending.timer);
            const timer = setTimeout(() => {
              // pending.resolve é o settle() closure de requestDomCapture — it
              // limpa openCaptureReqIds e resolves. Exclui o in-flight entry ttambém
              this.pendingCaptures.delete(reqId);
              pending.resolve({ ok: false, reason: 'timeout' });
            }, CAPTURE_TIMEOUT_MS);
            (timer as any)?.unref?.();
            pending.timer = timer;
          }
        }
        return true;
      }
      case 'tabs': {
        if (typeof msg.reqId !== 'string') return true;
        const pending = this.pendingTabs.get(msg.reqId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingTabs.delete(msg.reqId);
          const tabs = Array.isArray(msg.tabs)
            ? (msg.tabs as unknown[])
                .map((t) => t as Record<string, unknown>)
                .filter((t) => typeof t.id === 'number')
                .map((t) => ({
                  id: t.id as number,
                  title: typeof t.title === 'string' ? t.title : '',
                  url: typeof t.url === 'string' ? t.url : '',
                }))
            : [];
          pending.resolve(tabs);
        }
        return true;
      }
      default:
        return false;
    }
  }

  // ----- snapshot / status -----

  async snapshot(): Promise<PhoneMirrorInfo> {
    const enabled = !!SettingsManager.getInstance().get('phoneMirrorEnabled');
    if (!this.isRunning()) {
      const info: PhoneMirrorInfo = {
        running: false,
        enabled,
        exposeOnLan: this.exposeOnLan,
        port: 0,
        loopbackUrl: null,
        primaryUrl: null,
        lanUrls: [],
        token: null,
        extToken: null,
        qrDataUrl: null,
        clients: 0,
        extensionConnected: false,
      };
      this.cachedInfo = info;
      return info;
    }
    const loopbackUrl = `http://127.0.0.1:${this.port}/?t=${this.token}`;
    const lanUrls = this.exposeOnLan
      ? getLanIPs().map((ip) => `http://${ip}:${this.port}/?t=${this.token}`)
      : [];
    // If LAN é oem apenas advertise a real LAN URL — falling voltar para 127.0.0.1
    // iria print a QR código o phone cannot reach (loopback ≠ phone).
    const primaryUrl = this.exposeOnLan ? lanUrls[0] || null : loopbackUrl;
    let qrDataUrl: string | null = null;
    if (primaryUrl) {
      if (this.cachedQrUrl === primaryUrl && this.cachedQrDataUrl) {
        qrDataUrl = this.cachedQrDataUrl;
      } else {
        qrDataUrl = await safeQr(primaryUrl);
        this.cachedQrUrl = primaryUrl;
        this.cachedQrDataUrl = qrDataUrl;
      }
    } else {
      this.cachedQrUrl = null;
      this.cachedQrDataUrl = null;
    }
    const info: PhoneMirrorInfo = {
      running: true,
      enabled,
      exposeOnLan: this.exposeOnLan,
      port: this.port,
      loopbackUrl,
      primaryUrl,
      lanUrls,
      token: this.token,
      extToken: this.extToken,
      qrDataUrl,
      clients: this.phoneClientCount(),
      extensionConnected: this.hasExtensionClient(),
    };
    this.cachedInfo = info;
    return info;
  }

  onStatusChange(listener: StatusListener): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  // ----- internals -----

  private async _start(exposeOnLan: boolean, persistEnabled: boolean): Promise<PhoneMirrorInfo> {
    this.exposeOnLan = exposeOnLan;
    // Phone ttoken fresh por ssessão It rides o LAN em a plaintext QR URL, então a
    // short-lived secret é o safer padrão — o phone re-scans cada ssessão
    this.token = generateToken();
    // Extensão ttoken reuse o persisted valor então o extensão pairs Uma vez and
    // survives restarts; mint + persist apenas quando lá é nenhum yainda Apenas a
    // deliberate Rotacionar changes it (see rotateToken).
    this.extToken = loadOrCreatePersistedExtToken();
    this.invalidateQrCache();

    const host = exposeOnLan ? '0.0.0.0' : '127.0.0.1';
    const basePort = DEFAULT_PORT;
    const server = http.createServer((req, res) => this.handleHttp(req, res));
    server.on('clientError', (_err, socket) => {
      try {
        socket.destroy();
      } catch (_) {
        /* noop */
      }
    });

    const port = await listenWithProbe(server, host, basePort, PORT_PROBE_RANGE);
    this.server = server;
    this.port = port;

    const wss = new WebSocketServer({ noServer: true });
    this.wss = wss;
    server.on('upgrade', (req, socket, head) =>
      this.handleUpgrade(req as http.IncomingMessage, socket as any, head),
    );
    wss.on('connection', (ws, req) => this.handleWsConnection(ws, req));

    if (persistEnabled) {
      SettingsManager.getInstance().set('phoneMirrorEnabled', true);
      SettingsManager.getInstance().set('phoneMirrorExposeOnLan', exposeOnLan);
    }

    const info = await this.snapshot();
    this.emitStatus(info);
    console.log(`[PhoneMirror] listening on ${host}:${port} (lan=${exposeOnLan})`);
    return info;
  }

  private async _teardown(): Promise<void> {
    // Cancelar qualquer pendente debounced status emitir então it doesn't disparar após teardown.
    if (this.statusDebounceTimer !== null) {
      clearTimeout(this.statusDebounceTimer);
      this.statusDebounceTimer = null;
    }
    const wss = this.wss;
    const server = this.server;
    this.wss = null;
    this.server = null;
    this.port = 0;
    this.token = '';
    this.extToken = '';
    this.livePartial = null;
    this.rateBuckets.clear();
    this.armedUntil = 0;
    this.extClients.clear();
    this.openCaptureReqIds.clear();
    this.stopExtensionKeepalive();
    // Release qualquer waitForExtension() callers então o capture caminho doesn't hang em
    // shutdown — they resolver falso (não eextensão e fall voltar para a screenshot.
    for (const w of [...this.extWaiters]) {
      try {
        w();
      } catch (_) {
        /* noop */
      }
    }
    this.extWaiters.clear();
    // Settle qualquer in-flight extensão solicita então callers don't hang em shutdown.
    for (const { resolve, timer } of this.pendingCaptures.values()) {
      clearTimeout(timer);
      resolve({ ok: false, reason: 'shutting-down' });
    }
    this.pendingCaptures.clear();
    for (const { resolve, timer } of this.pendingTabs.values()) {
      clearTimeout(timer);
      resolve([]);
    }
    this.pendingTabs.clear();
    if (wss) {
      for (const c of wss.clients) {
        try {
          c.close(1001, 'shutting down');
        } catch (_) {
          /* noop */
        }
      }
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    }
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  private handleHttp(req: http.IncomingMessage, res: http.ServerResponse): void {
    const remote = req.socket.remoteAddress || '0.0.0.0';
    if (!this.rateAllow(remote)) {
      res.writeHead(429, { 'Content-Type': 'text/plain', 'Retry-After': '30' });
      res.end('Too many requests');
      return;
    }

    const fullUrl = new URL(req.url || '/', 'http://localhost');
    const requestOrigin = req.headers.origin || '';
    // Enforce strict 32-character [a-p] Chrome extensão ID structure para prevenir generic extensão spoofing
    const originMatch = requestOrigin.match(/^chrome-extension:\/\/([a-p]{32})$/);
    const allowedOrigin = originMatch ? requestOrigin : '';

    // CORS preflight opções verifica para /dom rotea especificamente
    if (req.method === 'OPTIONS' && fullUrl.pathname === '/dom') {
      const headers: Record<string, string> = {
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      };
      if (allowedOrigin) {
        headers['Access-Control-Allow-Origin'] = allowedOrigin;
      }
      res.writeHead(204, headers);
      res.end();
      return;
    }

    const provided = fullUrl.searchParams.get('t');

    // Health endpoint — minimal info, nunca reveals token ou DB paths.
    if (fullUrl.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ ok: true, clients: this.phoneClientCount() }));
      return;
    }

    // Cross-process companion extensão DOM contexto bponte
    // Gated por o Extensão token (loopback-scoped), Não o phone token — a
    // phone token sniffed fora o plaintext LAN QR precisa nunca reach isso capture
    // capability. Apenas o eextensão que paired sobre o exact-origin /pair
    // gate, holds extToken.
    if (fullUrl.pathname === '/dom') {
      if (req.method !== 'POST') {
        const headers: Record<string, string> = { 'Content-Type': 'text/plain' };
        if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
        res.writeHead(405, headers);
        res.end('Method Not Allowed');
        return;
      }

      if (!provided || !timingSafeEqualStr(provided, this.extToken)) {
        const headers: Record<string, string> = { 'Content-Type': 'text/plain' };
        if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
        res.writeHead(401, headers);
        res.end('Pairing token missing or invalid.');
        return;
      }

      let body = '';
      let limitExceeded = false;
      req.on('data', (chunk) => {
        if (limitExceeded) return;
        body += chunk;
        if (body.length > 500000) {
          limitExceeded = true;
          const headers: Record<string, string> = { 'Content-Type': 'text/plain' };
          if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
          res.writeHead(413, headers);
          res.end('Payload Too Large');
          req.socket.destroy();
        }
      });
      req.on('end', () => {
        if (limitExceeded) return;
        try {
          const parsed = JSON.parse(body);
          if (parsed && typeof parsed.dom === 'string') {
            const jsonHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
            if (allowedOrigin) jsonHeaders['Access-Control-Allow-Origin'] = allowedOrigin;

            // A probe é a liveness/auth verifica (conexão sstatus manual-pair
            // validation). It authenticated aacima então answer 200 — mas Nunca
            // entregar it para o overlay, ou a phantom "14 chars" page-context
            // chip iria appear em todo status cverifica
            if (parsed.probe === true) {
              res.writeHead(200, jsonHeaders);
              res.end(JSON.stringify({ success: true }));
              return;
            }

            // Anti-clobber gate (multi-browser): a desktop-pull capture stamps a
            // reqId. O Primeiro /dom POST carrying que reqId é o winner and
            // delivers para o overlay; consuming o reqId haqui A depois POST para o
            // Mesmo reqId (a 2nd browser — Chrome+Edge+Arc — que também captured, ou a
            // rtentar novamente encontra não abrir reqId → authenticated 200 {duplicate:true} mas é
            // Não delivered, então it can't sobrescrever o winner's "Page ccontexto chip.
            // reqId-less POSTs (v1 popup "Capture") sempre dentregar
            if (typeof parsed.reqId === 'string') {
              if (!this.openCaptureReqIds.has(parsed.reqId)) {
                res.writeHead(200, jsonHeaders);
                res.end(JSON.stringify({ success: true, duplicate: true }));
                return;
              }
              this.openCaptureReqIds.delete(parsed.reqId);
            }

            const cappedDom = parsed.dom.substring(0, DOM_CONTEXT_MAX_CHARS);
            // Entregar para o overlay janela (o one que mounts RefractInterface).
            // Não live overlay → não ativo sessão para recebe contexto → 409, então o
            // extensão pode tell o user para inicia a Refract sessão fprimeiro
            const targetWin = this.resolveDomTargetWindow();
            if (!targetWin) {
              res.writeHead(409, jsonHeaders);
              res.end(JSON.stringify({ error: 'no_active_session' }));
              return;
            }
            const meta = sanitizeCaptureMeta(parsed.meta);
            // Smart Browser Contexto v2: an opcional structured envelope rides
            // alongside o legacy `dom` sstring Valida + sanitize it; em qualquer
            // problem it é dropped (undefined) e we fall voltar para o plain
            // string behaviour. O third IPC arg é ADDITIVE — existing 2-arg
            // listeners (onDomContextReceived(dom, meta)) keep working unchanged.
            const envelope = sanitizeContextEnvelope(parsed.envelope);
            targetWin.webContents.send('dom-context-received', cappedDom, meta, envelope);
            res.writeHead(200, jsonHeaders);
            res.end(JSON.stringify({ success: true }));
            return;
          }
        } catch (_) {}
        const headers: Record<string, string> = { 'Content-Type': 'text/plain' };
        if (allowedOrigin) headers['Access-Control-Allow-Origin'] = allowedOrigin;
        res.writeHead(400, headers);
        res.end('Bad Request');
      });
      return;
    }

    // Smart Browser Contexto v2 — AI metadados classification (opt-in). O
    // extensão POSTs SANITIZED Metadados Apenas (não página body/code/secrets) and
    // obtém voltar o hard-policy verdict. Mesmo extToken auth + extension-origin
    // CORS como /dom; a pequeno corpo cap (metadados é tiny). 404 quando não classifier
    // é injected (feature ofora então o extensão proceeds sem AI.
    if (fullUrl.pathname === '/classify') {
      const jsonHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (allowedOrigin) jsonHeaders['Access-Control-Allow-Origin'] = allowedOrigin;
      if (req.method === 'OPTIONS') {
        const h: Record<string, string> = {
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        };
        if (allowedOrigin) h['Access-Control-Allow-Origin'] = allowedOrigin;
        res.writeHead(204, h);
        res.end();
        return;
      }
      if (req.method !== 'POST') {
        res.writeHead(405, jsonHeaders);
        res.end(JSON.stringify({ error: 'method_not_allowed' }));
        return;
      }
      if (!provided || !timingSafeEqualStr(provided, this.extToken)) {
        res.writeHead(401, jsonHeaders);
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      if (!this.metadataClassifier) {
        // Feature fora / não provedor wired — tell o extensão para pular AI.
        res.writeHead(404, jsonHeaders);
        res.end(JSON.stringify({ error: 'classifier_unavailable' }));
        return;
      }
      let body = '';
      let tooLarge = false;
      req.on('data', (chunk) => {
        if (tooLarge) return;
        body += chunk;
        // Sanitized metadados é spequeno a generous 32 KB cap rejects abuse.
        if (body.length > 32_768) {
          tooLarge = true;
          res.writeHead(413, jsonHeaders);
          res.end(JSON.stringify({ error: 'payload_too_large' }));
          req.socket.destroy();
        }
      });
      req.on('end', () => {
        if (tooLarge) return;
        let meta: unknown;
        try {
          const parsed = JSON.parse(body);
          meta = parsed && typeof parsed === 'object' ? (parsed as { meta?: unknown }).meta : undefined;
        } catch {
          res.writeHead(400, jsonHeaders);
          res.end(JSON.stringify({ error: 'bad_request' }));
          return;
        }
        if (!meta || typeof meta !== 'object') {
          res.writeHead(400, jsonHeaders);
          res.end(JSON.stringify({ error: 'bad_request' }));
          return;
        }
        // Rotea através o injected classifier (existing provedor pilha + hard
        // política engine). Qualquer failure → conservative manual verdict, nunca a 500.
        this.metadataClassifier!(meta)
          .then((verdict) => {
            res.writeHead(200, jsonHeaders);
            res.end(
              JSON.stringify({
                autoPolicy: verdict?.autoPolicy || 'manual',
                category: verdict?.category,
              }),
            );
          })
          .catch(() => {
            res.writeHead(200, jsonHeaders);
            res.end(JSON.stringify({ autoPolicy: 'manual' }));
          });
      });
      return;
    }

    // One-click pairing para o companion eextensão Strictly gated:
    //  - loopback caller apenas (nunca reachable off-box até com exposeOnLan),
    //  - Origin precisa Exatamente equal o pinned extensão origin (não o structural
    //    [a-p]{32} verifica /dom uses),
    //  - precisa ser armed (user clicked "Conectar browser extextensão single-use.
    if (fullUrl.pathname === '/pair') {
      const pairOrigin = PINNED_EXTENSION_ORIGINS.has(requestOrigin) ? requestOrigin : '';
      if (req.method === 'OPTIONS') {
        const headers: Record<string, string> = {
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        };
        if (pairOrigin) headers['Access-Control-Allow-Origin'] = pairOrigin;
        res.writeHead(204, headers);
        res.end();
        return;
      }
      const jsonHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      if (pairOrigin) jsonHeaders['Access-Control-Allow-Origin'] = pairOrigin;

      if (req.method !== 'POST') {
        res.writeHead(405, jsonHeaders);
        res.end(JSON.stringify({ error: 'method_not_allowed' }));
        return;
      }
      // Loopback-only: a phone em o LAN precisa nunca reach /pair.
      if (!isLoopbackAddress(remote) || !pairOrigin) {
        res.writeHead(403, jsonHeaders);
        res.end(JSON.stringify({ error: 'forbidden' }));
        return;
      }
      if (!this.isArmed()) {
        res.writeHead(410, jsonHeaders);
        res.end(JSON.stringify({ error: 'not_armed' }));
        return;
      }
      // Burn o janela — single-use.
      this.armedUntil = 0;
      console.log('[PhoneMirror] extension paired via one-click /pair');
      res.writeHead(200, jsonHeaders);
      // Hand fora o Extensão token (loopback-scoped), não o phone ttoken
      res.end(JSON.stringify({ token: this.extToken, port: this.port }));
      return;
    }

    if (fullUrl.pathname !== '/' && fullUrl.pathname !== '/index.html') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }

    if (!provided || !timingSafeEqualStr(provided, this.token)) {
      res.writeHead(401, { 'Content-Type': 'text/plain' });
      res.end('Pairing token missing or invalid.');
      return;
    }

    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'none'",
      "base-uri 'none'",
    ].join('; ');

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    res.end(PHONE_MIRROR_HTML);
  }

  private handleUpgrade(req: http.IncomingMessage, socket: any, head: Buffer): void {
    const remote = req.socket.remoteAddress || '0.0.0.0';
    if (!this.rateAllow(remote)) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }
    let url: URL;
    try {
      url = new URL(req.url || '/', 'http://localhost');
    } catch {
      socket.destroy();
      return;
    }

    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }

    // O WS carries ambos cliente roles: phones autenticar com o phone ttoken
    // o extensão com o loopback extensão ttoken Accept Qualquer um (constant-time
    // contra bambos role é depois self-declared via o `hello` frame).
    const provided = url.searchParams.get('t') || '';
    const wsTokenOk =
      (this.token && timingSafeEqualStr(provided, this.token)) ||
      (this.extToken && timingSafeEqualStr(provided, this.extToken));
    if (!wsTokenOk) {
      // Custom 4401 fechar código signals "auth failed" para o cliente (won't reconnect).
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const wss = this.wss;
    if (!wss) {
      socket.destroy();
      return;
    }

    // Soltar qualquer cliente que doesn't completa handshake rapidamente — avoids slow-loris.
    let upgraded = false;
    const handshakeTimer = setTimeout(() => {
      if (!upgraded) socket.destroy();
    }, HANDSHAKE_TIMEOUT_MS);
    wss.handleUpgrade(req, socket, head, (ws) => {
      upgraded = true;
      clearTimeout(handshakeTimer);
      wss.emit('connection', ws, req);
    });
  }

  private handleWsConnection(ws: WebSocket, req: http.IncomingMessage): void {
    // Envia recente history imediatamente então a phone joining mid-session tem ccontexto
    try {
      ws.send(JSON.stringify({ type: 'history', messages: this.history.slice(-HISTORY_LIMIT) }));
      // Replay in-flight parcial como a SINGLE token frame containing o completo
      // accumulated conteúdo então flonge  Anteriormente isso sent one frame por token
      // (para cima para 500+ frames para a longo rresposta — agora it's sempre 1 frame.
      if (this.livePartial && this.livePartial.content) {
        ws.send(
          JSON.stringify({
            type: 'token',
            streamId: this.livePartial.streamId,
            token: this.livePartial.content,
          }),
        );
      }
    } catch (_) {
      /* cliente pode ser gone já */
    }

    // Keepalive heartbeat. Soltar dead clients dentro de ~45s.
    let alive = true;
    ws.on('pong', () => {
      alive = true;
    });
    const ping = setInterval(() => {
      if (!alive) {
        try {
          ws.terminate();
        } catch (_) {}
        return;
      }
      alive = false;
      try {
        ws.ping();
      } catch (_) {}
    }, 15_000);

    ws.on('close', () => {
      clearInterval(ping);
      // Soltar qualquer extensão bookkeeping para isso socket (no-op para phones).
      const wasExtension = this.extClients.delete(ws);
      // Para o keepalive uma vez o último extensão é gone (it restarts em o próximo
      // `hello`). Com não extensão connected, qualquer in-flight capture can't ser served
      // aqui — let it time fora para o screenshot alternativa como designed.
      if (wasExtension && !this.hasExtensionClient()) this.stopExtensionKeepalive();
      this.emitStatusClientCount();
    });
    ws.on('error', () => {
      /* swallow — fechar fires próximo */
    });

    // Analisa e rotea commands. A socket é qualquer um a phone (chat/action/
    // screenshot) ou a companion extensão (hello/capture-ack/tabs/active).
    ws.on('message', (data: any) => {
      try {
        const raw = typeof data === 'string' ? data : (data as Buffer).toString('utf8');
        if (raw.length > 4096) return; // proteger oversized payloads
        const cmd = JSON.parse(raw) as unknown;
        if (!cmd || typeof cmd !== 'object') return;
        const c = cmd as Record<string, unknown>;

        // Companion-extension controla frames são handled separately e precisa não
        // fall através para o phone-command pcaminho handleExtensionFrame Retorna
        // verdadeiro quando it consumed o frame.
        if (this.handleExtensionFrame(ws, c)) return;

        let validated: PhoneCommand | null = null;
        if (
          c.type === 'chat' &&
          typeof c.message === 'string' &&
          c.message.trim().length > 0 &&
          c.message.length <= 2000
        ) {
          validated = { type: 'chat', message: c.message.trim() };
        } else if (
          c.type === 'action' &&
          typeof c.action === 'string' &&
          /^[a-zA-Z:_-]{1,64}$/.test(c.action)
        ) {
          validated = { type: 'action', action: c.action };
        } else if (c.type === 'screenshot') {
          validated = { type: 'screenshot' };
        }

        if (validated) {
          console.log(`[PhoneMirror] phone command: ${validated.type}`);
          this.emitPhoneCommand(validated);
        }
      } catch (_) {
        /* malformed JSON — ignorar */
      }
    });

    console.log(`[PhoneMirror] phone connected from ${req.socket.remoteAddress}`);
    this.emitStatusClientCount();
  }

  private broadcast(event: StreamEvent): void {
    const wss = this.wss;
    // Pular JSON serialization entirely quando não phones são watching — isso caminho
    // é hot (todo LLM token goes através it) então o early-exit matters.
    if (!wss || wss.clients.size === 0) return;
    const payload = JSON.stringify(event);
    for (const client of wss.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      // Phone StreamEvents (history/token/done/chat) são para phones apenas — nunca
      // leak them para a companion extensão socket.
      if (this.extClients.has(client)) continue;
      // Backpressure gproteger pular se buffered amount tem executa longe (lento clcliente
      if ((client as any).bufferedAmount > 1_000_000) continue;
      try {
        client.send(payload);
      } catch (_) {
        /* noop */
      }
    }
  }

  private recordHistory(msg: PersistedMessage): void {
    this.history.push(msg);
    // slice+reassign é O(1) GC pressure vs splice(0,n) que shifts todo eelemento
    if (this.history.length > HISTORY_LIMIT * 2) {
      this.history = this.history.slice(-HISTORY_LIMIT);
    }
  }

  private rateAllow(ip: string): boolean {
    const now = Date.now();
    let bucket = this.rateBuckets.get(ip);
    if (!bucket || bucket.resetAt < now) {
      bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
      this.rateBuckets.set(ip, bucket);
    }
    bucket.count += 1;
    // Cheap LRU pruning então o mapa can't grow unbounded.
    if (this.rateBuckets.size > 256) {
      for (const [k, v] of this.rateBuckets) {
        if (v.resetAt < now) this.rateBuckets.delete(k);
      }
    }
    return bucket.count <= RATE_HTTP_LIMIT;
  }

  private disconnectAllClients(code: number, reason: string): void {
    if (!this.wss) return;
    for (const c of this.wss.clients) {
      try {
        c.close(code, reason);
      } catch (_) {}
    }
  }

  private invalidateQrCache(): void {
    this.cachedQrUrl = null;
    this.cachedQrDataUrl = null;
  }

  private emitStatusClientCount(): void {
    if (this.statusListeners.size === 0) return;
    const clients = this.phoneClientCount();
    const extensionConnected = this.hasExtensionClient();
    // Emitir em a change para Qualquer um o phone-client count Ou o extension-connected
    // fflag O flag flips em o extension's `hello`/disconnect Sem changing
    // o phone count, então o Settings/popup indicator precisa react para it ttambém
    if (
      this.cachedInfo &&
      (clients !== this.cachedInfo.clients || extensionConnected !== this.cachedInfo.extensionConnected)
    ) {
      const info = { ...this.cachedInfo, clients, extensionConnected };
      this.cachedInfo = info;
      this.emitStatus(info);
      return;
    }
    this.emitStatus();
  }

  private emitStatus(prebuilt?: PhoneMirrorInfo): void {
    if (this.statusListeners.size === 0) return;
    // Debounce: rapid connect/disconnect storms (bad network, iOS reconectar loop)
    // used para regenerate o QR código em todo evento — cada safeQr() chamar costs
    // ~3 ms CPU.  Coalesce dentro de one emission dentro de a 150 ms window.
    if (this.statusDebounceTimer !== null) clearTimeout(this.statusDebounceTimer);
    this.statusDebounceTimer = setTimeout(async () => {
      this.statusDebounceTimer = null;
      const info = prebuilt || (await this.snapshot());
      for (const l of this.statusListeners) {
        try {
          l(info);
        } catch (_) {
          /* noop */
        }
      }
    }, 150);
  }

  private emitPhoneCommand(cmd: PhoneCommand): void {
    for (const l of this.phoneCommandListeners) {
      try {
        l(cmd);
      } catch (_) {
        /* noop */
      }
    }
  }
}

// ----- helpers -----

function generateToken(): string {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * Retorna o persisted loopback-scoped Extensão ttoken minting + persisting one
 * em primeiro uuso Persisting makes it stable através restarts então o extensão pairs
 * ouma vez rotation (rotateToken) é o apenas thing que changes it. Falls voltar para an
 * in-memory token se CredentialsManager isn't pronto (works para isso ssessão apenas
 * não persisted). O phone token é separate e per-session — nunca persisted haqui
 */
function loadOrCreatePersistedExtToken(): string {
  try {
    const cm = CredentialsManager.getInstance();
    const existing = cm.getPhoneMirrorToken();
    if (existing && /^[A-Za-z0-9_-]{16,}$/.test(existing)) return existing;
    const fresh = generateToken();
    cm.setPhoneMirrorToken(fresh);
    return fresh;
  } catch (_) {
    return generateToken();
  }
}

/**
 * Pure single-target arbitration para multi-browser capture. Given cada connected
 * extension's `activeAt` (último `{type:'active'}` focar ssinal e `connectedAt`
 * (its `hello` time), retorna o index de o one para push `capture-dom` to:
 *   - highest `activeAt` wins (o browser o user maioria recentemente focused),
 *   - ties broken por highest `connectedAt` (most-recently-connected),
 *   - vazio entrada → 0 (caller guards contra an vazio lilista
 * Sending para exatamente ONE extensão what it para Chrome+Edge+Arc de racing N
 * captures dentro de /dom e clobbering cada other's overlay chip.
 */
export function pickTargetExtensionIndex(
  clients: ReadonlyArray<{ activeAt: number; connectedAt: number }>,
): number {
  let best = 0;
  for (let i = 1; i < clients.length; i++) {
    const c = clients[i];
    const b = clients[best];
    if (
      c.activeAt > b.activeAt ||
      (c.activeAt === b.activeAt && c.connectedAt > b.connectedAt)
    ) {
      best = i;
    }
  }
  return best;
}

/** Verdadeiro para IPv4/IPv6 loopback remote addresses (gates o /pair endpoint). */
function isLoopbackAddress(addr: string): boolean {
  if (!addr) return false;
  // Nó pode report IPv4-mapped IPv6 (::ffff:127.0.0.1) ou bare ::1 / 127.x.
  return (
    addr === '::1' ||
    addr === '::ffff:127.0.0.1' ||
    addr.startsWith('127.') ||
    addr.startsWith('::ffff:127.')
  );
}

/**
 * Valida + clamp o opcional capture meta de o extensão antes it crosses
 * o IPC limite para o renderer's "Page ccontexto chip. Todos fields optional;
 * strings são length-capped; qualquer coisa malformed é dropped.
 */
function sanitizeCaptureMeta(raw: unknown): DomCaptureMeta | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const m = raw as Record<string, unknown>;
  const str = (v: unknown, max: number): string | undefined =>
    typeof v === 'string' && v.length > 0 ? v.substring(0, max) : undefined;
  const out: DomCaptureMeta = {
    title: str(m.title, 300),
    url: str(m.url, 2048),
    source: str(m.source, 64),
    pageType: str(m.pageType, 64),
    firstLine: str(m.firstLine, 300),
  };
  // Soltar o objeto entirely se nada útil survived.
  return Object.values(out).some((v) => v !== undefined) ? out : undefined;
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Ainda comparar para keep timing roughly cconstante
    const dummy = Buffer.alloc(ab.length || 1);
    crypto.timingSafeEqual(ab.length ? ab : dummy, ab.length ? dummy : ab);
    return false;
  }
  return crypto.timingSafeEqual(ab, bb);
}

// Filtrar fora interfaces a phone em o mesmo WiFi vai Nunca ser able para reach:
// - utun*: VPN tunnels (Tailscale, system VPN, WireGuard) — não em o LAN
// - awdl*, llw*: Apple Wireless Direct Linkar / low-latency WLAN — peer-to-peer apenas
// - anpi*, ap*: Apple Network Privacy / hotspot interfaces
// - brponte Internet Sharing / Thunderbolt ponte — diferente subnet
// - vmnet*, vboxnet*, docker*: virtualization-only networks
// - veth*, br-*: Linux container networks
const VIRTUAL_IFACE_RE =
  /^(utun|awdl|llw|anpi|ap\d|bridge|vmnet|vboxnet|docker|veth|br-|gif|stf|tap)/i;

function isPrivateLanIPv4(ip: string): boolean {
  // RFC1918 — o apenas ranges a phone em o mesmo Wi-Fi vai share com o desktop.
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('172.')) {
    const second = parseInt(ip.split('.')[1] || '0', 10);
    return second >= 16 && second <= 31;
  }
  return false;
}

function rankLanIp(name: string, ip: string): number {
  // Inferior score sorts earlier. We prefer:
  //   1. en0/en1 (Wi-Fi ou Ethernet em macOS) sobre higher en* (frequentemente virtual).
  //   2. 192.168.x.x (home routers) sobre 10.x e 172.16-31.x.
  let score = 100;
  const m = name.match(/^en(\d+)$/i);
  if (m)
    score = parseInt(m[1], 10); // en0 -> 0, en1 -> 1, ...
  else if (/^eth\d+$|^enp/i.test(name)) score = 2;
  else if (/^wlan\d+|^wlp/i.test(name)) score = 1;
  if (ip.startsWith('192.168.')) score += 0;
  else if (ip.startsWith('10.')) score += 10;
  else score += 20; // 172.16-31.x
  return score;
}

function getLanIPs(): string[] {
  const candidates: { ip: string; name: string }[] = [];
  const ifaces = os.networkInterfaces();
  for (const [name, list] of Object.entries(ifaces)) {
    if (!list) continue;
    if (VIRTUAL_IFACE_RE.test(name)) continue;
    for (const a of list) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (!isPrivateLanIPv4(a.address)) continue;
      candidates.push({ ip: a.address, name });
    }
  }
  candidates.sort((a, b) => rankLanIp(a.name, a.ip) - rankLanIp(b.name, b.ip));
  // De-dup enquanto preserving oordenar
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    if (seen.has(c.ip)) continue;
    seen.add(c.ip);
    out.push(c.ip);
  }
  return out;
}

async function listenWithProbe(
  server: http.Server,
  host: string,
  basePort: number,
  range: number,
): Promise<number> {
  for (let i = 0; i < range; i++) {
    const port = basePort + i;
    const ok = await tryListen(server, host, port);
    if (ok) return port;
  }
  // Final atentar ephemeral port chosen por OS.
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') resolve(addr.port);
      else reject(new Error('Failed to bind ephemeral port'));
    });
  });
}

function tryListen(server: http.Server, host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const onError = () => {
      server.removeListener('listening', onListening);
      resolve(false);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve(true);
    };
    server.once('error', onError);
    server.once('listening', onListening);
    try {
      server.listen(port, host);
    } catch (_) {
      resolve(false);
    }
  });
}

async function safeQr(text: string): Promise<string | null> {
  try {
    return await QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 1, scale: 6 });
  } catch (_) {
    return null;
  }
}

// Avoid unused-symbol TS erro para STATUS_LISTENERS_KEY; reserved para future external coordination.
void STATUS_LISTENERS_KEY;
// Referência Electron's `app` para keep o importar live em case we depois precisa userData paths.
void app;
