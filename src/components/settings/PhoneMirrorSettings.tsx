import { Check, Copy, Lock, Puzzle, RefreshCw, ShieldAlert, ShieldCheck, Smartphone, Wifi, Zap } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { BrowserContextSettings, PhoneMirrorInfo } from '../../types/electron';
import { isMac } from '../../utils/platformUtils';

const EMPTY_BROWSER_CTX: BrowserContextSettings = {
  autoDetectCoding: true,
  autoAttachCoding: true,
  askBeforeUnknown: true,
  aiClassifierEnabled: false,
  autoDetectJobDescriptions: false,
  autoDetectDeveloperDocs: false,
  experimentalFullPageCapture: false,
};

const EMPTY_INFO: PhoneMirrorInfo = {
  running: false,
  enabled: false,
  exposeOnLan: false,
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

export const PhoneMirrorSettings: React.FC = () => {
  const [info, setInfo] = useState<PhoneMirrorInfo>(EMPTY_INFO);
  const [busy, setBusy] = useState<null | 'enable' | 'disable' | 'lan' | 'rotate'>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // Companion browser-extension pairing: countdown (seconds left) enquanto o 60s
  // one-click /pair janela é abrir após "Conectar browser exextensão
  const [armCountdown, setArmCountdown] = useState(0);
  const [armError, setArmError] = useState<string | null>(null);
  const [pairCopied, setPairCopied] = useState(false);
  const [showManualPair, setShowManualPair] = useState(false);
  const armTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Smart Browser Contexto v2 — auto-capture settings.
  const [ctx, setCtx] = useState<BrowserContextSettings>(EMPTY_BROWSER_CTX);

  const refresh = useCallback(async () => {
    try {
      const next = await window.electronAPI.phoneMirrorGetInfo();
      if (next && typeof next === 'object') setInfo(next as PhoneMirrorInfo);
    } catch (e: any) {
      setError(e?.message || 'Failed to load phone mirror status');
    }
  }, []);

  useEffect(() => {
    refresh();
    const off = window.electronAPI.onPhoneMirrorStatus((next) => {
      if (!next || typeof next !== 'object') return;
      setInfo((prev) => {
        const n = next as PhoneMirrorInfo;
        if (
          prev &&
          prev.qrDataUrl === n.qrDataUrl &&
          prev.primaryUrl === n.primaryUrl &&
          prev.token === n.token &&
          prev.extToken === n.extToken &&
          prev.running === n.running &&
          prev.clients === n.clients &&
          prev.extensionConnected === n.extensionConnected
        ) {
          return prev;
        }
        return n;
      });
    });
    return () => {
      off?.();
    };
  }, [refresh]);

  // Carrega Smart Browser Contexto configurações ouma vez
  useEffect(() => {
    (async () => {
      try {
        const res = await window.electronAPI.browserContextGetSettings?.();
        if (res && typeof res === 'object' && !('error' in res)) {
          setCtx(res as BrowserContextSettings);
        }
      } catch {
        /* keep documented defaults */
      }
    })();
  }, []);

  // Alternar one auto-capture configuração e persist it. Keys mapa 1:1 para o resolved
  // BrowserContextSettings fields → o IPC's browser* configuração keys.
  const onToggleCtx = useCallback(
    async (
      field: keyof BrowserContextSettings,
      ipcKey:
        | 'browserAutoDetectCoding'
        | 'browserAutoAttachCoding'
        | 'browserAskBeforeUnknown'
        | 'browserAiClassifierEnabled'
        | 'browserAutoDetectJobDescriptions'
        | 'browserAutoDetectDeveloperDocs'
        | 'browserExperimentalFullPageCapture',
    ) => {
      const next = !ctx[field];
      // Optimistic uatualiza reconcile com o persisted resolved settings.
      setCtx((prev) => ({ ...prev, [field]: next }));
      try {
        const res = await window.electronAPI.browserContextSetSettings?.({ [ipcKey]: next });
        if (res && typeof res === 'object' && !('error' in res)) {
          setCtx(res as BrowserContextSettings);
        }
      } catch (e: any) {
        setError(e?.message || 'Failed to save browser context setting');
        setCtx((prev) => ({ ...prev, [field]: !next })); // revert
      }
    },
    [ctx],
  );

  const apply = useCallback(
    async (key: 'enable' | 'disable' | 'lan' | 'rotate', fn: () => Promise<any>) => {
      setBusy(key);
      setError(null);
      try {
        const result = await fn();
        if (result && typeof result === 'object' && 'error' in result && result.error) {
          setError(String(result.error));
        } else if (result && typeof result === 'object' && 'running' in result) {
          setInfo(result as PhoneMirrorInfo);
        } else {
          await refresh();
        }
      } catch (e: any) {
        setError(e?.message || 'Action failed');
      } finally {
        setBusy(null);
      }
    },
    [refresh],
  );

  const onToggleEnable = useCallback(async () => {
    if (info.running) {
      await apply('disable', () => window.electronAPI.phoneMirrorDisable());
    } else {
      await apply('enable', () => window.electronAPI.phoneMirrorEnable(info.exposeOnLan));
    }
  }, [apply, info.running, info.exposeOnLan]);

  const onToggleLan = useCallback(async () => {
    await apply('lan', () => window.electronAPI.phoneMirrorSetLan(!info.exposeOnLan));
  }, [apply, info.exposeOnLan]);

  const onRotate = useCallback(async () => {
    await apply('rotate', () => window.electronAPI.phoneMirrorRotateToken());
  }, [apply]);

  const onCopy = useCallback(async () => {
    if (!info.primaryUrl) return;
    try {
      await navigator.clipboard.writeText(info.primaryUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch (_) {
      /* noop */
    }
  }, [info.primaryUrl]);

  // Limpa o countdown interval em udesmontar
  useEffect(() => {
    return () => {
      if (armTimerRef.current) clearInterval(armTimerRef.current);
    };
  }, []);

  // "Conectar browser eextensão — arm o 60s one-click pairing janela em o
  // desktop, então executa a local countdown então o user knows como longo they ter to
  // click "Conectar para Refract" em o extensão popup.
  const onArmExtension = useCallback(async () => {
    setArmError(null);
    try {
      const result = await window.electronAPI.phoneMirrorArmExtension();
      if (result && typeof result === 'object' && 'error' in result && result.error) {
        setArmError(String(result.error));
        return;
      }
      const seconds =
        result && typeof result === 'object' && 'armedMs' in result
          ? Math.round((result.armedMs as number) / 1000)
          : 60;
      if (armTimerRef.current) clearInterval(armTimerRef.current);
      setArmCountdown(seconds);
      armTimerRef.current = setInterval(() => {
        setArmCountdown((prev) => {
          if (prev <= 1) {
            if (armTimerRef.current) clearInterval(armTimerRef.current);
            armTimerRef.current = null;
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (e: any) {
      setArmError(e?.message || 'Failed to arm pairing');
    }
  }, []);

  // Manual fallback: copiar o raw `port:token` pairing string para o extension's
  // "Pair manually iem vez disso fcampo Apenas shown após o user expande it. Uses o
  // Extensão token (loopback-scoped), não o phone token — isso string pairs o
  // browser eextensão
  const onCopyPairString = useCallback(async () => {
    if (!info.port || !info.extToken) return;
    try {
      await navigator.clipboard.writeText(`${info.port}:${info.extToken}`);
      setPairCopied(true);
      setTimeout(() => setPairCopied(false), 1200);
    } catch (_) {
      /* noop */
    }
  }, [info.port, info.extToken]);

  const lanWarning = info.running && info.exposeOnLan;
  const showQr = info.running && info.qrDataUrl;
  const lanRequestedButMissing = info.running && info.exposeOnLan && info.lanUrls.length === 0;

  return (
    <div className="space-y-6 animated fadeIn">
      <header className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <p className="text-text-secondary text-[12px] leading-relaxed">
            Connect Refract to your phone and your browser. Stream live AI responses to a phone
            browser on the same network, and pair the companion browser extension to send the
            active tab's page context to the desktop.
          </p>
        </div>
        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
          Beta
        </span>
      </header>

      {/* Master alternar */}
      <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-5 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-text-primary font-medium text-sm">Enable Phone Mirror</div>
          <div className="text-text-secondary text-xs mt-1">
            {info.running
              ? `Running on port ${info.port} · ${info.clients} ${info.clients === 1 ? 'phone' : 'phones'} connected`
              : 'Off — no listener, no exposure.'}
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={info.running}
          disabled={busy !== null}
          onClick={onToggleEnable}
          className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${info.running ? 'bg-blue-500' : 'bg-bg-item-active'} ${busy !== null ? 'opacity-60 cursor-wait' : ''}`}
        >
          <span
            className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${info.running ? 'translate-x-5' : 'translate-x-1'}`}
          />
        </button>
      </div>

      {/* LAN trocar */}
      <div
        className={`bg-bg-item-surface rounded-xl border ${lanWarning ? 'border-amber-500/30' : 'border-border-subtle'} p-5 transition-colors`}
      >
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-text-primary font-medium text-sm flex items-center gap-2">
              <Wifi size={14} className="text-text-secondary" /> Allow LAN access
            </div>
            <div className="text-text-secondary text-xs mt-1">
              {info.exposeOnLan
                ? 'Phones on the same WiFi can connect with the pairing token.'
                : 'Loopback only — only this computer can connect (use SSH tunnel for remote access).'}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={info.exposeOnLan}
            disabled={busy !== null}
            onClick={onToggleLan}
            className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/40 ${info.exposeOnLan ? 'bg-amber-500' : 'bg-bg-item-active'} ${busy !== null ? 'opacity-60 cursor-wait' : ''}`}
          >
            <span
              className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${info.exposeOnLan ? 'translate-x-5' : 'translate-x-1'}`}
            />
          </button>
        </div>
        {lanWarning && (
          <div className="mt-3 flex items-start gap-2 text-amber-400/90 text-xs leading-relaxed">
            <ShieldAlert size={14} className="mt-0.5 flex-shrink-0" />
            <span>
              Anyone on this network with the pairing URL can read your AI responses. Use only on
              trusted networks. Rotate the token below if you suspect the URL was shared.
            </span>
          </div>
        )}
      </div>

      {/* No-LAN-IP warning */}
      {lanRequestedButMissing && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-300 text-xs leading-relaxed flex items-start gap-2">
          <ShieldAlert size={14} className="mt-0.5 flex-shrink-0" />
          <span>
            LAN access is on, but no Wi-Fi or Ethernet IP was detected. Connect this{' '}
            {isMac ? 'Mac' : 'PC'} to the same Wi-Fi as your phone (VPN tunnels and virtual
            interfaces don't count). If you've connected, also confirm{' '}
            {isMac ? (
              <strong>System Settings → Network → Firewall</strong>
            ) : (
              <strong>Windows Defender Firewall → Allowed apps</strong>
            )}{' '}
            is allowing incoming connections for this app.
          </span>
        </div>
      )}

      {/* Pairing card */}
      {info.running ? (
        <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-5 space-y-4">
          <div className="flex items-start gap-5">
            {showQr ? (
              <div className="flex-shrink-0 rounded-lg bg-white p-2 shadow-sm">
                <img
                  src={info.qrDataUrl!}
                  alt="Pairing QR code"
                  className="block w-36 h-36"
                  draggable={false}
                />
              </div>
            ) : (
              <div className="flex-shrink-0 w-36 h-36 rounded-lg border border-dashed border-border-subtle grid place-items-center text-text-secondary text-xs">
                generating QR…
              </div>
            )}
            <div className="flex-1 min-w-0 space-y-3">
              <div>
                <div className="text-text-secondary text-xs uppercase tracking-wider mb-1.5">
                  Scan with your phone
                </div>
                <div className="text-text-primary text-sm font-medium">
                  {info.exposeOnLan
                    ? 'Open the camera app and point at the code.'
                    : 'LAN access is off. Turn it on, or open the URL on this computer.'}
                </div>
              </div>
              <div>
                <div className="text-text-secondary text-xs uppercase tracking-wider mb-1.5">
                  Pairing URL
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 truncate font-mono text-xs px-2.5 py-2 rounded-md bg-bg-main border border-border-subtle text-text-primary">
                    {info.primaryUrl || '—'}
                  </code>
                  <button
                    type="button"
                    onClick={onCopy}
                    disabled={!info.primaryUrl}
                    className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-bg-item-active text-text-primary hover:bg-bg-item-active/70 disabled:opacity-50 transition-colors"
                  >
                    {copied ? (
                      <>
                        <Check size={13} /> Copied
                      </>
                    ) : (
                      <>
                        <Copy size={13} /> Copy
                      </>
                    )}
                  </button>
                </div>
              </div>
              {info.exposeOnLan && info.lanUrls.length > 1 && (
                <details className="text-xs">
                  <summary className="text-text-secondary cursor-pointer hover:text-text-primary">
                    Other LAN addresses ({info.lanUrls.length - 1})
                  </summary>
                  <ul className="mt-2 space-y-1 font-mono text-text-secondary">
                    {info.lanUrls.slice(1).map((u) => (
                      <li key={u} className="truncate">
                        {u}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          </div>
          <div className="flex items-center justify-between pt-3 border-t border-border-subtle">
            <div className="flex items-center gap-2 text-text-secondary text-xs">
              <Lock size={12} /> Pairing token gates every connection.
            </div>
            <button
              type="button"
              onClick={onRotate}
              disabled={busy !== null}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-bg-item-active/60 transition-colors disabled:opacity-50"
            >
              <RefreshCw size={12} className={busy === 'rotate' ? 'animate-spin' : ''} />
              Rotate token
            </button>
          </div>
        </div>
      ) : (
        <div className="bg-bg-item-surface/50 rounded-xl border border-dashed border-border-subtle p-6 text-center text-text-secondary text-sm">
          Turn on Espelho do Telefone to generate a pairing URL and QR code.
        </div>
      )}

      {/* Browser Extension card — pair the companion extension to send the active
          browser tab's page context to the desktop. Shares the Phone Mirror
          server + pairing token. */}
      <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-bg-main p-2 border border-border-subtle flex-shrink-0">
            <Puzzle size={16} className="text-indigo-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="text-text-primary font-medium text-sm">Browser Extension</div>
              {/* Live connection indicator: green = extension connected over the
                  capture WebSocket; grey = paired/installed but not connected. */}
              {info.running && (
                <span className="flex items-center gap-1.5 flex-shrink-0">
                  <span
                    className={`w-2 h-2 rounded-full ${
                      info.extensionConnected ? 'bg-green-500' : 'bg-text-secondary/40'
                    }`}
                  />
                  <span className="text-[11px] text-text-secondary">
                    {info.extensionConnected ? 'Connected' : 'Not connected'}
                  </span>
                </span>
              )}
            </div>
            <div className="text-text-secondary text-xs mt-1 leading-relaxed">
              Pair the Refract companion extension to send the active tab's page content
              to the desktop. Press{' '}
              <kbd className="px-1 py-0.5 rounded bg-bg-main border border-border-subtle font-mono text-[10px]">
                {isMac ? '⌘' : 'Ctrl'}+Shift+Y
              </kbd>{' '}
              to capture (falls back to a screenshot when no browser is reachable). Install
              steps are in the Help tab.
            </div>
          </div>
        </div>

        {info.running ? (
          <>
            <button
              type="button"
              onClick={onArmExtension}
              disabled={armCountdown > 0}
              className={`w-full inline-flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                armCountdown > 0
                  ? 'bg-blue-500/15 text-blue-300 cursor-default'
                  : 'bg-blue-500 text-white hover:bg-blue-400'
              }`}
            >
              {armCountdown > 0 ? (
                <>
                  <Zap size={14} className="animate-pulse" />
                  Open the extension and click “Connect to Refract” · {armCountdown}s
                </>
              ) : (
                <>
                  <Zap size={14} />
                  Connect browser extension
                </>
              )}
            </button>

            <details
              className="text-xs"
              open={showManualPair}
              onToggle={(e) => setShowManualPair((e.target as HTMLDetailsElement).open)}
            >
              <summary className="text-text-secondary cursor-pointer hover:text-text-primary select-none">
                Pair manually instead
              </summary>
              <div className="mt-2 space-y-2">
                <div className="text-text-secondary leading-relaxed">
                  In the extension popup, expand <strong>Pair manually instead</strong> and paste
                  this pairing string:
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 min-w-0 truncate font-mono text-xs px-2.5 py-2 rounded-md bg-bg-main border border-border-subtle text-text-primary">
                    {info.port && info.extToken ? `${info.port}:${info.extToken}` : '—'}
                  </code>
                  <button
                    type="button"
                    onClick={onCopyPairString}
                    disabled={!info.port || !info.extToken}
                    className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium bg-bg-item-active text-text-primary hover:bg-bg-item-active/70 disabled:opacity-50 transition-colors"
                  >
                    {pairCopied ? (
                      <>
                        <Check size={13} /> Copied
                      </>
                    ) : (
                      <>
                        <Copy size={13} /> Copy
                      </>
                    )}
                  </button>
                </div>
              </div>
            </details>

            {armError && (
              <div className="text-xs text-red-300">{armError}</div>
            )}
          </>
        ) : (
          <div className="text-text-secondary text-xs flex items-center gap-2">
            <Lock size={12} /> Enable Espelho do Telefone first to pair the browser extension.
          </div>
        )}
      </div>

      {/* Smart Browser Context — automatic coding/interview capture. Manual
          capture (the hotkey + popup) always works and is intentionally not a
          toggle here. Sensitive pages (email/chat/banking/auth) are ALWAYS
          blocked — that floor is enforced in the desktop policy engine and has
          no off switch. */}
      <div className="bg-bg-item-surface rounded-xl border border-border-subtle p-5 space-y-4">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-bg-main p-2 border border-border-subtle flex-shrink-0">
            <ShieldCheck size={16} className="text-emerald-400" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-text-primary font-medium text-sm">Smart Browser Context</div>
            <div className="text-text-secondary text-xs mt-1 leading-relaxed">
              Automatically detect coding/interview pages (LeetCode, HackerRank, CoderPad, and
              more) and attach the problem context when you ask for an answer. Manual capture
              always works regardless of these settings.
            </div>
          </div>
        </div>

        <CtxToggle
          label="Auto-detect coding problems"
          desc="Recognize high-confidence coding/interview pages locally (no page content is read in the background)."
          checked={ctx.autoDetectCoding}
          onChange={() => onToggleCtx('autoDetectCoding', 'browserAutoDetectCoding')}
        />
        <CtxToggle
          label="Auto-attach coding context when answering"
          desc="When you ask for an answer on a high-confidence coding page, capture and attach it just-in-time."
          checked={ctx.autoAttachCoding}
          onChange={() => onToggleCtx('autoAttachCoding', 'browserAutoAttachCoding')}
        />
        <CtxToggle
          label="Ask before attaching unknown pages"
          desc="For pages we can't classify confidently, ask first instead of attaching automatically."
          checked={ctx.askBeforeUnknown}
          onChange={() => onToggleCtx('askBeforeUnknown', 'browserAskBeforeUnknown')}
        />
        <CtxToggle
          label="AI page classifier (opt-in)"
          desc="For unknown pages, send sanitized metadata only (host + keywords, never page content) to your configured AI provider to classify the page. Off by default."
          checked={ctx.aiClassifierEnabled}
          onChange={() => onToggleCtx('aiClassifierEnabled', 'browserAiClassifierEnabled')}
        />
        <CtxToggle
          label="Auto-detect job descriptions"
          desc="Optional. Recognize job-posting pages so you can attach them when answering."
          checked={ctx.autoDetectJobDescriptions}
          onChange={() => onToggleCtx('autoDetectJobDescriptions', 'browserAutoDetectJobDescriptions')}
        />
        <CtxToggle
          label="Auto-detect developer docs"
          desc="Optional. Recognize documentation pages so you can attach them when answering."
          checked={ctx.autoDetectDeveloperDocs}
          onChange={() => onToggleCtx('autoDetectDeveloperDocs', 'browserAutoDetectDeveloperDocs')}
        />

        {/* EXPERIMENTAL: full-page capture. Relaxes the coding-only auto gate but
            NEVER the sensitive floor below — email/chat/banking/auth stay blocked. */}
        <CtxToggle
          label="Experimental: send full page to AI"
          desc="When on, attach the FULL page content (not just coding problems) when you ask for an answer, and let the AI pick what's relevant. Email, chat, banking, and auth pages are still never captured."
          checked={ctx.experimentalFullPageCapture}
          onChange={() => onToggleCtx('experimentalFullPageCapture', 'browserExperimentalFullPageCapture')}
          experimental
        />

        {/* O non-negotiable privacy floor — shown como a locked, always-on rlinha */}
        <div className="flex items-start justify-between gap-3 pt-1">
          <div className="min-w-0">
            <div className="text-text-primary text-sm flex items-center gap-1.5">
              <Lock size={12} className="text-text-secondary" />
              Never capture email, chat, banking, or auth pages
            </div>
            <div className="text-text-secondary text-xs mt-0.5 leading-relaxed">
              Always on. Sensitive pages are never auto-captured and are never sent to the AI
              classifier, even if a page looks like a coding problem.
            </div>
          </div>
          <span className="flex-shrink-0 text-[11px] text-emerald-400 font-medium mt-0.5">
            Enforced
          </span>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}

      <div className="text-text-secondary text-xs leading-relaxed">
        Espelho do Telefone runs entirely on your local network. No traffic leaves your machine — the
        bridge serves an HTML page and a WebSocket directly to your phone, gated by a per-session
        pairing token.
      </div>
    </div>
  );
};

/** A único labelled on/off linha para o Smart Browser Contexto configurações gagrupar */
const CtxToggle: React.FC<{
  label: string;
  desc: string;
  checked: boolean;
  onChange: () => void;
  /** Mostrar a subtle amber "Experimental" chip próximo para o label. */
  experimental?: boolean;
  /**
   * Mark o control as scaffolding para a not-yet-wired feature: shows a "Coming
   * soon" chip, dims o row, e disables o interruptor so it can't promise
   * behavior que doesn't exist yet. (The AI metadata classifier + JD/dev-docs
   * auto-detect are built + tested mas não yet wired em o live auto-context
   * caminho — tracked as a follow-up.)
   */
  comingSoon?: boolean;
}> = ({ label, desc, checked, onChange, experimental, comingSoon }) => (
  <div className={`flex items-start justify-between gap-3 ${comingSoon ? 'opacity-55' : ''}`}>
    <div className="min-w-0">
      <div className="text-text-primary text-sm flex items-center gap-2">
        {label}
        {experimental && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.08em] bg-amber-500/15 text-amber-400 border border-amber-500/30">
            Experimental
          </span>
        )}
        {comingSoon && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-[0.08em] bg-text-secondary/15 text-text-secondary border border-border-subtle">
            Coming soon
          </span>
        )}
      </div>
      <div className="text-text-secondary text-xs mt-0.5 leading-relaxed">{desc}</div>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={comingSoon ? false : checked}
      aria-label={label}
      disabled={comingSoon}
      onClick={comingSoon ? undefined : onChange}
      className={`flex-shrink-0 mt-0.5 relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
        comingSoon ? 'cursor-not-allowed bg-bg-item-active' : checked ? 'bg-blue-500' : 'bg-bg-item-active'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          !comingSoon && checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  </div>
);
